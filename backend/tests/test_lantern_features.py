"""Lantern features: pantry portal, live shelf, community reports, visit planner, calendar, surplus board, AI guardrails."""
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace as NS

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.models import ChangeProposal, Location, ShelfUpdate
from app.services import ai
from app.services.schedule import TZ
from tests.conftest import USER_PW, login, make_user

ARL = {"lat": 38.86, "lon": -77.099, "radius_km": 60}


def _loc(db, name_like):
    return db.scalar(select(Location).where(Location.name.like(f"%{name_like}%")))


@pytest.fixture
def staff(db, client, published, admin):
    """A pantry volunteer approved for Maple pantry; returns (client, location)."""
    maple = _loc(db, "Maple")
    make_user(db, "vol@example.org", USER_PW)
    login(client, "vol@example.org", USER_PW)
    r = client.post("/api/provider/claims", json={"location_id": maple.id, "role_title": "Pantry coordinator", "note": "Call church office"})
    assert r.status_code == 201
    assert client.post(f"/api/provider/locations/{maple.id}/shelf", json={"status": "open"}).status_code == 403  # not approved yet
    from app.models import ProviderMembership

    m = db.get(ProviderMembership, r.json()["id"])
    m.status = "approved"
    db.commit()
    return client, maple


def test_claim_needs_account_and_admin_approval(client, db, published, admin):
    maple = _loc(db, "Maple")
    assert client.post("/api/provider/claims", json={"location_id": maple.id, "role_title": "x y"}).status_code == 401
    make_user(db, "vol@example.org", USER_PW)
    login(client, "vol@example.org", USER_PW)
    cid = client.post("/api/provider/claims", json={"location_id": maple.id, "role_title": "Volunteer lead"}).json()["id"]
    assert client.post("/api/provider/claims", json={"location_id": maple.id, "role_title": "Volunteer lead"}).status_code == 409
    client.post("/api/auth/logout")
    login(client, "admin@example.org", "admin-password-123")
    claims = client.get("/api/admin/claims").json()["items"]
    assert claims[0]["user_email"] == "vol@example.org" and claims[0]["location_phone"]
    assert client.post(f"/api/admin/claims/{cid}/decision", json={"decision": "approve"}).json()["status"] == "approved"


def test_portal_marks_listings_without_food_so_food_only_controls_can_be_hidden(staff, db):
    """The portal serves every kind of provider: /provider/me says whether the food-only controls apply."""
    from app.models import Service

    client, maple = staff
    assert client.get("/api/provider/me").json()["items"][0]["offers_food"] is True  # a food pantry
    for s in list(maple.services):
        db.delete(s)
    db.flush()
    db.add(Service(location_id=maple.id, service_type="health_clinic"))
    db.commit()
    assert client.get("/api/provider/me").json()["items"][0]["offers_food"] is False
    # a non-food provider can still post a plain status
    assert client.post(f"/api/provider/locations/{maple.id}/shelf", json={"status": "limited"}).status_code == 201


def test_live_shelf_shows_in_search_and_expires(staff, db):
    client, maple = staff
    r = client.post(f"/api/provider/locations/{maple.id}/shelf", json={
        "status": "open", "message": "Lots of fresh greens today!",
        "items": [{"food_type": "fresh_vegetables", "level": "plenty"}, {"food_type": "eggs", "level": "low"}]})
    assert r.status_code == 201 and r.json()["source"] == "pantry"
    res = client.get("/api/resources/search", params={**ARL, "live_food_group": "produce"}).json()
    assert [i["name"] for i in res["items"]] == [maple.name]
    assert res["items"][0]["live"]["message"] == "Lots of fresh greens today!"
    assert {"code": "on_shelf_today", "value": "produce"} in res["items"][0]["match_reasons"]
    assert client.get("/api/resources/search", params={**ARL, "live_open": True}).json()["total"] == 1
    d = client.get(f"/api/resources/{maple.id}").json()
    assert d["current_inventory"][0]["food_type"] == "fresh_vegetables"
    # expiry: an old post is never shown
    for u in db.scalars(select(ShelfUpdate)).all():
        u.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()
    assert client.get(f"/api/resources/{maple.id}").json()["live"] is None
    assert client.get("/api/resources/search", params={**ARL, "live_food_group": "produce"}).json()["total"] == 0


def test_pantry_closed_today_drops_from_open_today(staff):
    client, maple = staff
    client.post(f"/api/provider/locations/{maple.id}/shelf", json={"status": "closed", "message": "Burst pipe — closed today"})
    res = client.get("/api/resources/search", params={**ARL, "open_today": True}).json()
    assert maple.name not in {i["name"] for i in res["items"] + res["uncertain"]}
    any_day = client.get("/api/resources/search", params=ARL).json()
    item = next(i for i in any_day["items"] if i["id"] == maple.id)
    assert "closed_today_by_pantry" in item["warnings"]


def test_shelf_validation(staff):
    client, maple = staff
    assert client.post(f"/api/provider/locations/{maple.id}/shelf", json={"status": "open", "items": [{"food_type": "candy", "level": "plenty"}]}).status_code == 422
    far = (datetime.now(UTC) + timedelta(days=5)).isoformat()
    assert client.post(f"/api/provider/locations/{maple.id}/shelf", json={"status": "open", "expires_at": far}).status_code == 422


def test_events_and_closures_affect_schedule(staff, db):
    client, maple = staff
    start = (datetime.now(TZ) + timedelta(days=2)).replace(hour=9, minute=0, second=0, microsecond=0)
    r = client.post(f"/api/provider/locations/{maple.id}/events", json={
        "title": "Pop-up produce market", "starts_at": start.isoformat(), "ends_at": (start + timedelta(hours=2)).isoformat(),
        "offerings": ["fresh_fruits"], "appointment_required": "not_required"})
    assert r.status_code == 201
    d = client.get(f"/api/resources/{maple.id}").json()
    assert any(e["title"] == "Pop-up produce market" for e in d["events"])
    # closure on the next Tuesday removes that day's distribution window
    today = datetime.now(TZ).date()
    tue = today + timedelta(days=(1 - today.weekday()) % 7 or 7)
    assert client.post(f"/api/provider/locations/{maple.id}/closures", json={"date": tue.isoformat(), "reason": "Holiday"}).status_code == 201
    d = client.get(f"/api/resources/{maple.id}").json()
    assert tue.isoformat() not in {w["date"] for w in d["upcoming_windows"] if w["kind"] == "distribution"}
    assert client.post(f"/api/provider/locations/{maple.id}/closures", json={"date": "2020-01-01"}).status_code == 422


def test_provider_corrections_go_to_review_not_live(staff, db, admin):
    client, maple = staff
    r = client.post(f"/api/provider/locations/{maple.id}/change-requests", json={
        "phone": "703-555-0199", "schedules": [{"weekday": 4, "opens": "10:00", "closes": "12:00"}], "message_to_reviewer": "New hours"})
    assert r.status_code == 201
    db.refresh(maple)
    assert maple.phone == "(555) 010-0001"  # unchanged until reviewed
    cps = db.scalars(select(ChangeProposal).where(ChangeProposal.location_id == maple.id)).all()
    assert {c.origin for c in cps} == {"provider"} and {c.field for c in cps} == {"phone", "schedules"}
    from app.ingestion.verification.workflow import decide_change

    for c in cps:
        decide_change(db, c, admin, True)
    db.refresh(maple)
    assert maple.phone == "(703) 555-0199"
    assert any(s.weekday == 4 and s.service_id is None for s in maple.schedules)


def test_staff_cannot_touch_other_pantries(staff, db):
    client, _ = staff
    other = _loc(db, "Riverbend")
    assert client.post(f"/api/provider/locations/{other.id}/shelf", json={"status": "open"}).status_code == 403
    assert client.get(f"/api/provider/locations/{other.id}/reports").status_code == 403


def test_community_reports_anonymous_rate_limited_and_escalate(client, db, published):
    riv = _loc(db, "Riverbend")
    for _ in range(3):
        assert client.post(f"/api/resources/{riv.id}/reports", json={"kind": "was_closed", "note": "<b>locked</b> door"}).status_code == 201
    db.refresh(riv)
    assert riv.review_status == "needs_review" and riv.published  # flagged, still showing verified info
    assert client.get(f"/api/resources/{riv.id}").json()["open_reports"] == 3
    codes = [client.post(f"/api/resources/{riv.id}/reports", json={"kind": "other"}).status_code for _ in range(3)]
    assert 429 in codes
    from app.models import CommunityReport

    assert db.scalar(select(CommunityReport.note)) == "locked door"  # markup stripped
    assert client.post("/api/resources/999999/reports", json={"kind": "other"}).status_code in (404, 429)


def test_reports_visible_to_pantry_and_admin(staff, db):
    client, maple = staff
    client.post(f"/api/resources/{maple.id}/reports", json={"kind": "out_of_food"})
    reps = client.get(f"/api/provider/locations/{maple.id}/reports").json()["items"]
    assert reps[0]["kind"] == "out_of_food"
    r = client.post(f"/api/provider/locations/{maple.id}/reports/{reps[0]['id']}/response", json={"response": "Restocked at 2pm"})
    assert r.json()["status"] == "resolved"


def test_visit_plan_never_turns_unknown_into_not_needed(client, db, published):
    maple, riv, birch = _loc(db, "Maple"), _loc(db, "Riverbend"), _loc(db, "Birch")
    plan = {i["key"]: i["action"] for i in client.get(f"/api/resources/{maple.id}/visit-plan").json()["checklist"]}
    assert plan["photo_id"] == "not_needed" and plan["referral"] == "ask"
    assert {i["key"]: i["action"] for i in client.get(f"/api/resources/{riv.id}/visit-plan").json()["checklist"]}["photo_id"] == "bring"
    b = client.get(f"/api/resources/{birch.id}/visit-plan").json()
    assert all(i["action"] == "ask" for i in b["checklist"]) and "call_ahead" in b["suggestions"] and b["next_windows"] == []


def test_calendar_export(client, db, published):
    maple = _loc(db, "Maple")
    r = client.get(f"/api/resources/{maple.id}/calendar.ics")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/calendar")
    body = r.text
    assert body.startswith("BEGIN:VCALENDAR") and body.count("BEGIN:VEVENT") >= 8 and "DTSTART;TZID=America/New_York:" in body
    assert "Confirm with the pantry" in body


def test_surplus_board(staff, db, client):
    vol, maple = staff
    until = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    p = vol.post("/api/provider/surplus", json={"location_id": maple.id, "title": "200 lbs of apples", "food_types": ["fresh_fruits"],
                                                 "available_until": until}).json()
    assert vol.post(f"/api/provider/surplus/{p['id']}/claim", json={"location_id": maple.id}).status_code == 422
    # a second pantry's staff claims it
    from app.models import ProviderMembership, User

    vol.post("/api/auth/logout")
    make_user(db, "vol2@example.org", USER_PW)
    u2 = db.scalar(select(User).where(User.email == "vol2@example.org"))
    riv = _loc(db, "Riverbend")
    db.add(ProviderMembership(user_id=u2.id, location_id=riv.id, role_title="Lead", status="approved"))
    db.commit()
    login(vol, "vol2@example.org", USER_PW)
    assert [x["title"] for x in vol.get("/api/provider/surplus").json()["items"]] == ["200 lbs of apples"]
    assert vol.post(f"/api/provider/surplus/{p['id']}/claim", json={"location_id": riv.id}).json()["status"] == "claimed"
    assert vol.post(f"/api/provider/surplus/{p['id']}/claim", json={"location_id": riv.id}).status_code == 409
    vol.post("/api/auth/logout")
    make_user(db, "public@example.org", USER_PW)
    login(vol, "public@example.org", USER_PW)
    assert vol.get("/api/provider/surplus").status_code == 403  # not public


# --- AI (fake client; no network, no key) ------------------------------------------------------------------------

class FakeClaude:
    def __init__(self, outputs):
        self.outputs, self.calls = outputs, []
        self.messages = self

    def parse(self, **kw):
        self.calls.append(kw)
        out = self.outputs[kw["output_format"].__name__]
        return NS(parsed_output=kw["output_format"].model_validate(out), stop_reason="end_turn")


@pytest.fixture
def ai_on(monkeypatch):
    monkeypatch.setattr(get_settings(), "ai_enabled", True)
    yield
    ai.set_client(None)


def test_ai_endpoints_off_by_default(client, staff):
    vol, maple = staff
    assert client.post("/api/ai/search", json={"q": "halal food"}).status_code == 404
    assert vol.post(f"/api/provider/locations/{maple.id}/ai/announcement-draft", json={"text": "Drive thru Saturday"}).status_code == 404
    assert client.get("/api/meta/features").json()["ai"]["search"] is False
    assert client.get("/api/meta/features").json()["app_name"] == "Lantern"


def test_ai_structure_suggestions_drop_unquoted_facts():
    text = "Food distribution every Tuesday 10am-12pm. Bring photo ID."
    fake = FakeClaude({"StructureSuggestion": {
        "distribution_schedules": [
            {"weekday": 1, "opens": "10:00", "closes": "12:00", "week_of_month": None, "evidence": "every Tuesday 10am-12pm"},
            {"weekday": 4, "opens": "09:00", "closes": "11:00", "week_of_month": None, "evidence": "Fridays 9-11"},  # invented
        ],
        "eligibility": [
            {"requirement_type": "photo_id", "status": "required", "evidence": "Bring photo ID."},
            {"requirement_type": "income_documentation", "status": "not_required", "evidence": "no income proof needed"},  # invented
        ]}})
    ai.set_client(fake)
    get_settings().ai_enabled = True
    try:
        out = ai.suggest_structure(text)
    finally:
        get_settings().ai_enabled = False
        ai.set_client(None)
    assert [s.weekday for s in out.distribution_schedules] == [1]
    assert [e.requirement_type for e in out.eligibility] == ["photo_id"]
    assert "untrusted data" in fake.calls[0]["system"]
    assert fake.calls[0]["model"] == "claude-haiku-5-5"  # cheap model for high-volume tasks


def test_ai_suggestions_become_reviewable_proposals(admin_client, db, imported, ai_on):
    birch = _loc(db, "Birch")
    fake = FakeClaude({"StructureSuggestion": {"distribution_schedules": [
        {"weekday": 2, "opens": "10:00", "closes": "12:00", "week_of_month": None, "evidence": "Food pantry"}], "eligibility": []}})
    ai.set_client(fake)
    r = admin_client.post(f"/api/admin/resources/{birch.id}/ai-suggestions")
    assert r.status_code == 200 and r.json()["created_proposals"] == ["schedules"]
    cp = db.scalar(select(ChangeProposal).where(ChangeProposal.location_id == birch.id))
    assert cp.origin == "ai" and cp.status == "pending"
    db.refresh(birch)
    assert not birch.schedules  # nothing applied without a reviewer


def test_ai_announcement_draft_is_not_saved(staff, db, ai_on):
    vol, maple = staff
    ai.set_client(FakeClaude({"AnnouncementDraft": {
        "kind": "shelf_update", "status": "open", "message": "Fresh produce today", "items": [{"food_type": "fresh_vegetables", "level": "plenty"}],
        "event": None, "closure": None, "things_to_check": ["Confirm closing time"]}}))
    r = vol.post(f"/api/provider/locations/{maple.id}/ai/announcement-draft", json={"text": "Tons of veggies today, come by!"})
    assert r.status_code == 200 and r.json()["draft"]["kind"] == "shelf_update"
    assert db.scalar(select(ShelfUpdate)) is None


def test_ai_search_maps_to_filters_and_sends_no_location(client, ai_on):
    fake = FakeClaude({"SearchIntent": {"place": "22204", "food_groups": ["special_diet"], "service_groups": [],
                                        "eligibility": ["no_id_required"], "day": "saturday", "wheelchair": False,
                                        "explanation": "Special diets near 22204 on Saturday, no ID."}})
    ai.set_client(fake)
    r = client.post("/api/ai/search", json={"q": "halal food near 22204 saturday no id", "lang": "en"}).json()
    assert r["filters"]["eligibility"] == ["no_id_required"] and r["place"]["precision"] == "zip"
    assert datetime.fromisoformat(r["filters"]["date"]).weekday() == 5
    assert fake.calls[0]["messages"][0]["content"] == "halal food near 22204 saturday no id"  # only the typed words


def test_ai_failure_degrades_gracefully(client, ai_on):
    class Broken:
        messages = None

        def __init__(self):
            self.messages = self

        def parse(self, **kw):
            return NS(parsed_output=None, stop_reason="refusal")

    ai.set_client(Broken())
    assert client.post("/api/ai/search", json={"q": "food please"}).status_code == 503


# --- admin-uploaded API key -----------------------------------------------------------------------------------------

def test_admin_uploads_key_encrypted_never_returned(admin_client, db, monkeypatch, tmp_path):
    from app.models import AppSetting, AuditLog

    monkeypatch.setattr(get_settings(), "data_dir", tmp_path)  # isolated local secret.key
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    called = {}

    class Models:
        def retrieve(self, m):
            called["model"] = m
            return NS(id=m, display_name="Claude Sonnet 5.5")

    import anthropic

    real = anthropic.Anthropic

    def fake_ctor(api_key=None, **kw):
        called["key"] = api_key
        return NS(models=Models(), messages=None)

    monkeypatch.setattr(anthropic, "Anthropic", fake_ctor)
    ai.invalidate()
    st = admin_client.get("/api/admin/ai-settings").json()
    assert st["active"] is False and st["key_source"] == "none" and st["model"] == "claude-sonnet-5-5"
    assert admin_client.put("/api/admin/ai-settings/key", json={"api_key": "not-a-key-xxxxxxxxxxxxxxxx"}).status_code == 422
    secret = "sk-ant-test-" + "x" * 30 + "WXYZ"
    r = admin_client.put("/api/admin/ai-settings/key", json={"api_key": secret})
    body = r.json()
    assert r.status_code == 200 and body["active"] and body["key_source"] == "admin" and body["key_hint"] == "…WXYZ"
    assert body["test"]["ok"] and called["key"] == secret and body["test"]["fast_model"] == "claude-haiku-5-5"
    assert secret not in r.text and secret not in admin_client.get("/api/admin/ai-settings").text
    row = db.get(AppSetting, "anthropic_api_key")
    assert row.is_secret and secret not in row.value  # encrypted at rest
    assert secret not in str([a.after for a in db.query(AuditLog).all()])
    assert admin_client.get("/api/meta/features").json()["ai"]["search"] is True
    assert admin_client.patch("/api/admin/ai-settings", json={"enabled": False}).json()["active"] is False
    assert admin_client.patch("/api/admin/ai-settings", json={"model": "gpt-4"}).status_code == 422
    assert admin_client.delete("/api/admin/ai-settings/key").json()["key_source"] == "none"
    monkeypatch.setattr(anthropic, "Anthropic", real)
    ai.invalidate()


def test_ai_settings_admin_only(client, db):
    make_user(db, "u2@example.org", USER_PW)
    login(client, "u2@example.org", USER_PW)
    assert client.get("/api/admin/ai-settings").status_code == 403
    assert client.put("/api/admin/ai-settings/key", json={"api_key": "sk-ant-" + "x" * 30}).status_code == 403


def test_expanded_service_catalog_and_mental_health_filter(client, db, tmp_path):
    import json as _json

    from app.ingestion.base import Fetcher, SourceConfig
    from app.ingestion.pipeline import run_source

    cats = client.get("/api/meta/categories").json()
    assert {"mental_health", "benefits", "housing", "legal"} <= set(cats["service_groups"])
    f = tmp_path / "svc.json"
    f.write_text(_json.dumps({"records": [{"external_id": "s1", "organization_name": "Real Counseling Center", "address1": "1 A St",
                                            "zip": "22204", "lat": 38.861, "lon": -77.1,
                                            "services": [{"service_type": "mental_health_counseling"}, {"service_type": "crisis_support"}]}]}))
    src = SourceConfig(id="svc-open", name="County services", url="file://s", adapter="structured_json", jurisdictions=["arlington-county"],
                       publication="permitted_with_attribution")
    run_source(db, src, Fetcher(fixtures={"file://s": f}))
    res = client.get("/api/resources/search", params={"lat": 38.86, "lon": -77.1, "radius_km": 5, "service_group": "mental_health"}).json()
    assert [i["name"] for i in res["items"]] == ["Real Counseling Center"]
    from app.ingestion.normalization.text import SERVICE_KEYWORDS, match_keywords

    assert match_keywords("Help for families in crisis; budget counseling", SERVICE_KEYWORDS) == []


def test_ai_cache_budget_and_usage_log(client, ai_on, monkeypatch):
    """Identical requests are served from cache (no second API call); spending is logged; the monthly cap stops calls."""
    from app.models import AIUsage

    class Usage:
        input_tokens, output_tokens = 1000, 100

    out = {"place": None, "food_groups": ["produce"], "service_groups": [], "eligibility": [], "day": None,
           "wheelchair": False, "explanation": "Produce."}
    fake = FakeClaude({"SearchIntent": out})
    orig = fake.parse
    fake.parse = lambda **kw: NS(**{**vars(orig(**kw)), "usage": Usage()})
    ai.set_client(fake)
    assert client.post("/api/ai/search", json={"q": "Fresh  Produce please"}).status_code == 200
    assert client.post("/api/ai/search", json={"q": "fresh produce PLEASE"}).status_code == 200  # normalized -> cache hit
    assert len(fake.calls) == 1
    from app.db import session_factory

    with session_factory()() as db:
        rows = db.query(AIUsage).order_by(AIUsage.id).all()
    assert [r.cached for r in rows] == [False, True]
    assert abs(rows[0].cost_usd - (1000 * 0.10 + 100 * 0.50) / 1e6) < 1e-9  # Haiku pricing
    monkeypatch.setattr(get_settings(), "ai_monthly_budget_usd", 0.0)
    ai.invalidate()
    r = client.post("/api/ai/search", json={"q": "something new"})
    assert r.status_code == 503 and "budget" in r.json()["detail"].lower()
    assert len(fake.calls) == 1  # no paid call once the cap is reached


def test_ai_page_extraction_keeps_only_verbatim_facts(ai_on, tmp_path):
    page = ("Helping Hands Pantry\n123 Example Rd, Falls Church, VA 22046\nPhone: 555-010-4444\n"
            "Food distribution Tuesdays 10am-12pm. Photo ID required.\nWe provide groceries and fresh produce.")
    fake = FakeClaude({"PageExtraction": {"places": [
        {"organization_name": "Helping Hands Pantry", "location_name": None, "address1": "123 Example Rd", "city": "Falls Church",
         "zip": "22046", "phone": "555-010-4444", "website": None, "hours_text": "Food distribution Tuesdays 10am-12pm.",
         "eligibility_text": "Photo ID required.", "description": "We provide groceries and fresh produce.",
         "service_types": ["pantry_pickup"], "food_types": ["general_groceries"], "evidence": ["We provide groceries"]},
        {"organization_name": "Invented Clinic", "location_name": None, "address1": "9 Nowhere St", "city": None, "zip": None,
         "phone": None, "website": None, "hours_text": None, "eligibility_text": None, "description": None,
         "service_types": ["health_clinic"], "food_types": [], "evidence": ["free clinic"]},
        {"organization_name": "Helping Hands Pantry", "location_name": None, "address1": "123 Example Rd", "city": None,
         "zip": "22046", "phone": "555-010-9999", "website": None, "hours_text": "Open daily 24 hours", "eligibility_text": None,
         "description": None, "service_types": ["shelter"], "food_types": [], "evidence": ["we run a shelter"]}]}})
    ai.set_client(fake)
    places = ai.extract_places(page, "https://example.org/p")
    assert [p["organization_name"] for p in places] == ["Helping Hands Pantry", "Helping Hands Pantry"]  # invented org dropped
    good, bad = places
    assert good["phone"] == "555-010-4444" and good["service_types"] == ["pantry_pickup"]
    assert bad["phone"] is None and bad["hours_text"] is None and bad["service_types"] == []  # unquoted facts dropped
    # adapter turns it into a candidate with parsed schedule + eligibility, citing the page
    from app.ingestion.adapters.ai_extract import AIPageExtract
    from app.ingestion.base import FetchedDocument, load_source_configs

    ad = AIPageExtract(load_source_configs()["ai-web-pages"])
    recs = list(ad.parse(FetchedDocument("https://example.org/p", 200, f"<html><body><p>{page.replace(chr(10), '<br>')}</p></body></html>".encode(), "text/html", None)))
    c = ad.normalize(recs[0])
    assert c.source_url == "https://example.org/p" and c.services[0].schedules[0].weekday == 1
    assert {e.requirement_type: e.status for e in c.eligibility}["photo_id"] == "required"
    assert len(fake.calls) == 1  # second parse of the same page text came from the cache


def test_ai_discovery_uses_search_results_and_skips_aggregators(ai_on):
    class Resp:
        usage = NS(input_tokens=100, output_tokens=10, server_tool_use=NS(web_search_requests=1))
        content = [NS(type="web_search_tool_result", content=[NS(url="https://city.example.gov/food", title="City food help"),
                                                              NS(url="https://www.findhelp.org/x", title="Aggregator")]),
                   NS(type="text", text="See https://church.example.org/pantry")]

    class Fake:
        def __init__(self):
            self.messages, self.n = self, 0

        def create(self, **kw):
            self.n += 1
            assert kw["tools"][0]["max_uses"] == 2
            return Resp()

    f = Fake()
    ai.set_client(f)
    leads = ai.discover_leads("Falls Church", "food pantries")
    assert [x["url"] for x in leads] == ["https://city.example.gov/food", "https://church.example.org/pantry"]
    assert ai.discover_leads("falls church", "Food Pantries") == leads and f.n == 1  # cached


def test_auto_refresh_cycle_and_admin_status(admin_client, db, monkeypatch, tmp_path):
    from app.ingestion import pipeline
    from app.services import scheduler

    calls = {}

    def fake_run_all(db_, scope, only=None, fetcher=None, do_geocode=False, configs=None):
        calls["scope"] = scope
        return []

    monkeypatch.setattr(pipeline, "run_all", fake_run_all)
    r = admin_client.post("/api/admin/refresh").json()
    assert r["sources"] == 0 and "marked_stale" in r and calls["scope"]
    st = admin_client.get("/api/admin/refresh").json()
    assert st["last_run"] and st["hour_local"] == 4
    nxt = scheduler._next_run(datetime(2026, 10, 12, 12, 0, tzinfo=UTC))
    assert nxt.astimezone(TZ).hour == 4 and nxt > datetime(2026, 10, 12, 12, 0, tzinfo=UTC)
