"""Pure-logic unit tests: normalization, schedule parsing/evaluation, eligibility text, dedupe scoring."""
from datetime import date, datetime, time
from types import SimpleNamespace as NS

import pytest

from app.ingestion.deduplication.matcher import MatchInput, classify, score
from app.ingestion.normalization.text import (
    clean_text,
    eligibility_from_text,
    food_types_from_text,
    normalize_address,
    normalize_name,
    normalize_phone,
    normalize_url,
    parse_schedule_text,
    url_domain,
)
from app.services.schedule import TZ, next_distribution, windows_on


def test_clean_text_strips_markup_and_scripts_as_text():
    assert clean_text("<b>Food</b>\n  Pantry<script>alert(1)</script>") == "Food Pantry"
    assert clean_text("   ") is None


@pytest.mark.parametrize("raw,expected", [("703-555-0100", "(703) 555-0100"), ("1 (703) 555 0100", "(703) 555-0100"), ("555", None)])
def test_phone(raw, expected):
    assert normalize_phone(raw) == expected


def test_address_and_name_normalization():
    assert normalize_address("123 North Main Street, Suite 4", "22204-1234") == "123 n main st ste 4 22204"
    assert normalize_address("123 N. Main St. Ste 4", "22204") == "123 n main st ste 4 22204"
    assert normalize_name("The Food Pantry, Inc.") == "food pantry"


def test_url_normalization_rejects_non_http():
    assert normalize_url("example.org/help") == "https://example.org/help"
    assert normalize_url("javascript:alert(1)") is None
    assert url_domain("https://www.Example.org/x") == "example.org"


@pytest.mark.parametrize("text,expected", [
    ("Tuesdays 10am-12pm", [(1, "10:00", "12:00", None)]),
    ("Mon & Thu 9:00 - 11:30 AM", [(0, "09:00", "11:30", None), (3, "09:00", "11:30", None)]),
    ("2nd and 4th Saturday 9-11am", [(5, "09:00", "11:00", 2), (5, "09:00", "11:00", 4)]),
    ("Monday-Wednesday 11-1pm", [(0, "11:00", "13:00", None), (1, "11:00", "13:00", None), (2, "11:00", "13:00", None)]),
    ("Last Friday of the month 5pm to 7pm", [(4, "17:00", "19:00", -1)]),
])
def test_parse_schedule_text(text, expected):
    got = [(r["weekday"], r["opens"], r["closes"], r["week_of_month"]) for r in parse_schedule_text(text)]
    assert got == expected


@pytest.mark.parametrize("text", ["Call for hours", "Tuesday 10-12", "varies", None])
def test_schedule_parser_refuses_to_guess(text):
    assert parse_schedule_text(text) == []


def test_food_types_only_from_explicit_mentions():
    assert set(food_types_from_text("Fresh produce, canned goods and milk")) == {"fresh_fruits", "fresh_vegetables", "pantry_staples", "dairy"}
    assert food_types_from_text("Food pantry") == []


def test_eligibility_text_is_tristate_and_negation_wins():
    assert eligibility_from_text("No ID required. Proof of address needed.") == {"photo_id": "not_required", "proof_of_address": "required"}
    assert eligibility_from_text("Bring your photo ID")["photo_id"] == "required"
    assert eligibility_from_text("We serve everyone with love") == {}  # nothing stated => nothing inferred


def _rule(weekday, opens, closes, wom=None, kind="distribution", vf=None, vt=None):
    return NS(weekday=weekday, opens=time.fromisoformat(opens), closes=time.fromisoformat(closes), week_of_month=wom, kind=kind,
              valid_from=vf, valid_to=vt, appointment_only=False)


def test_monthly_and_last_week_rules():
    second_sat = _rule(5, "09:00", "11:00", 2)
    last_fri = _rule(4, "17:00", "19:00", -1)
    assert windows_on(date(2026, 10, 10), [second_sat], [], [])  # 2nd Saturday of Oct 2026
    assert not windows_on(date(2026, 10, 3), [second_sat], [], [])
    assert windows_on(date(2026, 10, 30), [last_fri], [], [])
    assert not windows_on(date(2026, 10, 23), [last_fri], [], [])


def test_operating_hours_are_not_distribution():
    office = _rule(0, "09:00", "17:00", kind="operating_hours")
    assert windows_on(date(2026, 10, 12), [office], [], []) == []
    assert windows_on(date(2026, 10, 12), [office], [], [], kind="operating_hours")


def test_exceptions_and_seasonal_bounds():
    r = _rule(0, "10:00", "12:00", vf=date(2026, 6, 1), vt=date(2026, 8, 31))
    assert not windows_on(date(2026, 10, 12), [r], [], [])
    weekly = _rule(0, "10:00", "12:00")
    closed = NS(date=date(2026, 10, 12), kind="closed", opens=None, closes=None)
    assert windows_on(date(2026, 10, 12), [weekly], [closed], []) == []


def test_next_distribution_skips_ended_window_and_includes_events():
    weekly = _rule(0, "10:00", "12:00")  # Mondays
    now = datetime(2026, 10, 12, 13, 0, tzinfo=TZ)  # Monday after window closed
    assert next_distribution(now, [weekly], [], []).date == date(2026, 10, 19)
    ev = NS(status="scheduled", starts_at=datetime(2026, 10, 14, 9, 0, tzinfo=TZ), ends_at=None, title="Pop-up", id=1,
            appointment_required="unknown")
    w = next_distribution(now, [weekly], [], [ev])
    assert (w.date, w.kind, w.title) == (date(2026, 10, 14), "event", "Pop-up")


def test_dedupe_scoring_routes_conservatively():
    a = MatchInput("maple community pantry", "100 test rd 22204", 38.86, -77.099, "example.org", "(555) 010-0001")
    same = MatchInput("maple community pantry", "100 test rd 22204", 38.8601, -77.0991, None, None)
    assert classify(score(a, same)) == "auto_link"
    cohost = MatchInput("st john youth soccer", "100 test rd 22204", 38.86, -77.099, None, None)
    assert classify(score(a, cohost)) != "auto_link"  # same building, different org: never auto-merge
    far = MatchInput("maple community pantry", None, 38.95, -77.3, None, None)
    assert classify(score(a, far)) == "distinct"


def test_schedule_parser_real_world_patterns():
    acts = ("Food distribution: Monday 9-11:30 a.m. and 1-3 p.m.; Tuesday 1-3:30 p.m. and 5-7 p.m.; Thursday 9-11:30 a.m. and "
            "1-3 p.m.; Friday CLOSED. New client enrollment: 1st and 2nd Wednesdays 10 a.m.-12:45 p.m.")
    got = {(r["weekday"], r["opens"], r["closes"]) for r in parse_schedule_text(acts)}
    assert got == {(0, "09:00", "11:30"), (0, "13:00", "15:00"), (1, "13:00", "15:30"), (1, "17:00", "19:00"),
                   (3, "09:00", "11:30"), (3, "13:00", "15:00")}
    assert parse_schedule_text("Monday - Friday: 10 am - 4 pm\nClothing/Thrift: Monday - Saturday 10 am - 5 pm") == [
        {"weekday": d, "opens": "10:00", "closes": "16:00", "week_of_month": None} for d in range(5)]
    third = parse_schedule_text("Food distribution is the third Thursday of each month, from 11:30 am - 1:00 pm.")
    assert third == [{"weekday": 3, "opens": "11:30", "closes": "13:00", "week_of_month": 3}]


def test_phone_with_extra_text():
    assert normalize_phone("703-441-8606 | Home delivery enrollment: 703-441-8606 ext. 288") == "(703) 441-8606"


def test_database_url_from_managed_host_uses_psycopg3():
    from app.config import Settings

    for given in ("postgres://u:p@db.example/x", "postgresql://u:p@db.example/x", "postgresql+psycopg://u:p@db.example/x"):
        assert Settings(database_url=given).database_url == "postgresql+psycopg://u:p@db.example/x"
