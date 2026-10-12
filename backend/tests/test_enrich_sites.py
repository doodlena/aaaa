from app.research import enrich_sites
from app.services import ai

FOOD_OK = {"pantry_pickup"}


def _rec(**kw):
    return {"schedules": [], "eligibility": [], "services": [{"service_type": "pantry_pickup", "schedules": []}],
            "raw_hours_text": "On Fridays our Food Pantry is open from 10 AM to 3 PM", "raw_eligibility_text": "No ID required.", **kw}


def test_ai_fill_uses_structure_step_when_parser_failed(monkeypatch):
    out = ai.StructureSuggestion(
        distribution_schedules=[ai.ScheduleSuggestion(weekday=4, opens="10:00", closes="15:00", week_of_month=None,
                                                      evidence="open from 10 AM to 3 PM")],
        eligibility=[ai.EligibilitySuggestion(requirement_type="photo_id", status="not_required", evidence="No ID required.")])
    monkeypatch.setattr(ai, "suggest_structure", lambda text: out)
    rec, stats = _rec(), {}
    enrich_sites._ai_fill(rec, FOOD_OK, stats)
    assert rec["services"][0]["schedules"][0] | {} == {"kind": "distribution", "weekday": 4, "opens": "10:00", "closes": "15:00",
                                                       "week_of_month": None, "appointment_only": False, "notes": None}
    assert rec["eligibility"][0]["status"] == "not_required"
    assert stats == {"ai_schedules": 1, "ai_eligibility": 1}


def test_ai_fill_never_attaches_times_to_non_food_or_already_parsed(monkeypatch):
    called = []
    monkeypatch.setattr(ai, "suggest_structure", lambda text: called.append(text))
    rec = _rec(services=[{"service_type": "legal_aid", "schedules": []}], raw_eligibility_text=None)
    enrich_sites._ai_fill(rec, FOOD_OK, {})
    parsed = _rec(schedules=[{"weekday": 1}], eligibility=[{"requirement_type": "id", "status": "required"}])
    enrich_sites._ai_fill(parsed, FOOD_OK, {})
    assert called == [] and rec["services"][0]["schedules"] == []


def _loc(types=("pantry_pickup",)):
    from types import SimpleNamespace as NS

    return NS(id=42, name="Hope Pantry", organization=NS(name="Hope Church"), address1="1 Main St", address2=None, city="Fairfax",
              zip="22030", phone=None, services=[NS(service_type=t) for t in types])


def test_lookup_record_built_only_from_cited_quotes(monkeypatch):
    seen = []

    def fake_structure(text):
        seen.append(text)
        return ai.StructureSuggestion(
            distribution_schedules=[ai.ScheduleSuggestion(weekday=5, opens="09:00", closes="11:00", week_of_month=None,
                                                          evidence="Saturdays 9-11 AM")],
            eligibility=[])

    monkeypatch.setattr(ai, "suggest_structure", fake_structure)
    monkeypatch.setattr(enrich_sites, "_coord", lambda loc: (38.85, -77.3))
    out = {"fields": [{"field": "hours", "value": "Saturdays 9 to 11 in the morning",
                       "sources": [{"url": "https://hope.example.org/pantry", "title": "", "quote": "Pantry: Saturdays 9-11 AM"}]}]}
    stats = {"with_hours": 0, "with_eligibility": 0, "nothing_found": 0}
    rec = enrich_sites._record_from_lookup(_loc(), out, stats)
    assert seen == ["Pantry: Saturdays 9-11 AM"]  # the AI's own wording is never used, only the page quote
    assert rec["source_url"] == "https://hope.example.org/pantry" and rec["external_id"] == "lookup-42"
    assert rec["services"][0]["schedules"][0]["weekday"] == 5
    assert "verified" not in json_dumps(rec)
    assert stats["with_hours"] == 1


def test_lookup_without_quotes_or_for_non_food_adds_no_times(monkeypatch):
    monkeypatch.setattr(enrich_sites, "_coord", lambda loc: (38.85, -77.3))
    stats = {"with_hours": 0, "with_eligibility": 0, "nothing_found": 0}
    assert enrich_sites._record_from_lookup(_loc(), {"fields": []}, stats) is None
    monkeypatch.setattr(ai, "suggest_structure", lambda text: ai.StructureSuggestion(
        distribution_schedules=[ai.ScheduleSuggestion(weekday=1, opens="09:00", closes="10:00", week_of_month=None, evidence="x")],
        eligibility=[]))
    out = {"fields": [{"field": "hours", "value": "v", "sources": [{"url": "https://c.example.org", "quote": "Mon 9-10"}]}]}
    assert enrich_sites._record_from_lookup(_loc(("legal_aid",)), out, stats) is None  # no distribution times on non-food
    assert stats["nothing_found"] == 2


def json_dumps(x):
    import json

    return json.dumps(x)
