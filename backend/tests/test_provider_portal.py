"""Provider portal: access requests, decline reasons, colleagues, provider confirmation, tenant isolation, limits."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import Location, ProviderMembership, VerificationRecord
from tests.conftest import ADMIN_PW, USER_PW, login, make_user


def _loc(db, like):
    return db.scalar(select(Location).where(Location.name.like(f"%{like}%")))


def _client():
    from app.main import app

    return TestClient(app)


@pytest.fixture
def approved(db, client, published, admin):
    """vol@ approved for Maple via the real admin decision endpoint; returns (vol client, maple, admin client)."""
    maple = _loc(db, "Maple")
    make_user(db, "vol@example.org", USER_PW)
    login(client, "vol@example.org", USER_PW)
    cid = client.post("/api/provider/claims", json={"location_id": maple.id, "role_title": "Coordinator"}).json()["id"]
    adm = _client()
    login(adm, "admin@example.org", ADMIN_PW)
    assert adm.get("/api/admin/claims/pending-count").json() == {"pending": 1}
    assert adm.post(f"/api/admin/claims/{cid}/decision", json={"decision": "approve"}).status_code == 200
    assert adm.get("/api/admin/claims/pending-count").json() == {"pending": 0}
    return client, maple, adm


def test_declined_request_shows_reason_and_can_be_sent_again(db, client, published, admin):
    maple = _loc(db, "Maple")
    make_user(db, "vol@example.org", USER_PW)
    login(client, "vol@example.org", USER_PW)
    cid = client.post("/api/provider/claims", json={"location_id": maple.id, "role_title": "Volunteer"}).json()["id"]
    adm = _client()
    login(adm, "admin@example.org", ADMIN_PW)
    adm.post(f"/api/admin/claims/{cid}/decision", json={"decision": "reject", "notes": "Couldn't reach the church office"})
    mine = client.get("/api/provider/me").json()["items"][0]
    assert mine["status"] == "rejected" and mine["decision_note"] == "Couldn't reach the church office"
    r = client.post("/api/provider/claims", json={"location_id": maple.id, "role_title": "Volunteer lead", "note": "Call Pastor Kim"})
    assert r.status_code == 201 and r.json() == {"id": cid, "status": "pending"}
    mine = client.get("/api/provider/me").json()["items"][0]
    assert mine["status"] == "pending" and mine["decision_note"] is None
    # revoked access can't be re-requested by the person themselves
    adm.post(f"/api/admin/claims/{cid}/decision", json={"decision": "revoke"})
    assert client.post("/api/provider/claims", json={"location_id": maple.id, "role_title": "Volunteer"}).status_code == 409


def test_claims_are_rate_limited_and_withdrawable(db, client, published):
    make_user(db, "vol@example.org", USER_PW)
    login(client, "vol@example.org", USER_PW)
    ids = [loc.id for loc in db.scalars(select(Location).where(Location.published.is_(True))).all()]
    codes = [client.post("/api/provider/claims", json={"location_id": i, "role_title": "Volunteer"}).status_code for i in ids[:12]]
    assert codes.count(201) == min(len(ids), 10) and (len(ids) <= 10 or 429 in codes)
    mid = client.get("/api/provider/me").json()["items"][0]["membership_id"]
    assert client.delete(f"/api/provider/claims/{mid}").status_code == 204
    other = _client()
    make_user(db, "x@example.org", USER_PW)
    login(other, "x@example.org", USER_PW)
    mid2 = client.get("/api/provider/me").json()["items"][0]["membership_id"]
    assert other.delete(f"/api/provider/claims/{mid2}").status_code == 404  # someone else's request


def test_claim_input_limits(db, client, published):
    make_user(db, "vol@example.org", USER_PW)
    login(client, "vol@example.org", USER_PW)
    maple = _loc(db, "Maple")
    assert client.post("/api/provider/claims", json={"location_id": maple.id, "role_title": "x" * 121}).status_code == 422
    assert client.post("/api/provider/claims", json={"location_id": maple.id, "role_title": "ok", "note": "n" * 1001}).status_code == 422


def test_staff_add_colleague_list_and_remove(approved, db):
    client, maple, _ = approved
    assert client.post(f"/api/provider/locations/{maple.id}/staff", json={"email": "new@example.org", "role_title": "Volunteer"}).status_code == 404
    make_user(db, "new@example.org", USER_PW)
    r = client.post(f"/api/provider/locations/{maple.id}/staff", json={"email": "NEW@example.org", "role_title": "Volunteer"})
    assert r.status_code == 201
    staff = client.get(f"/api/provider/locations/{maple.id}/staff").json()["items"]
    assert {s["email"] for s in staff} == {"vol@example.org", "new@example.org"}
    assert next(s for s in staff if s["email"] == "vol@example.org")["is_you"] is True
    colleague = _client()
    login(colleague, "new@example.org", USER_PW)
    assert colleague.post(f"/api/provider/locations/{maple.id}/shelf", json={"status": "open"}).status_code == 201
    m = db.get(ProviderMembership, r.json()["membership_id"])
    assert m.added_by_id is not None
    assert client.post(f"/api/provider/locations/{maple.id}/staff", json={"email": "new@example.org", "role_title": "V"}).status_code == 422
    assert client.delete(f"/api/provider/locations/{maple.id}/staff/{m.id}").status_code == 204
    assert colleague.post(f"/api/provider/locations/{maple.id}/shelf", json={"status": "open"}).status_code == 403


def test_provider_confirmation_is_an_attributable_verification(approved, db):
    client, maple, _ = approved
    r = client.post(f"/api/provider/locations/{maple.id}/confirm", json={"notes": "Checked hours today"})
    assert r.status_code == 200 and r.json()["verification_label"] == "verified"
    rec = db.scalar(select(VerificationRecord).where(VerificationRecord.location_id == maple.id)
                    .order_by(VerificationRecord.created_at.desc()).limit(1))
    assert rec.action == "verify" and rec.method == "provider_submission" and "Checked hours today" in rec.notes
    from app.models import User

    assert db.get(User, rec.reviewer_id).email == "vol@example.org"
    # pending corrections must be reviewed before the listing can be confirmed as-is
    client.post(f"/api/provider/locations/{maple.id}/change-requests", json={"phone": "703-555-0123"})
    assert client.post(f"/api/provider/locations/{maple.id}/confirm", json={}).status_code == 409


def test_change_request_new_fields_and_validation(approved, db):
    from app.models import ChangeProposal

    client, maple, _ = approved
    before = (maple.email, maple.wheelchair_accessible, list(maple.languages or []))
    r = client.post(f"/api/provider/locations/{maple.id}/change-requests", json={
        "email": "Pantry@Example.org", "languages": ["EN", "es"], "wheelchair_accessible": "yes", "accessibility_notes": "Ramp at side door"})
    assert r.status_code == 201
    fields = {c.field: c.proposed_value for c in db.scalars(select(ChangeProposal).where(ChangeProposal.location_id == maple.id))}
    assert fields == {"email": "pantry@example.org", "languages": ["en", "es"], "wheelchair_accessible": "yes",
                      "accessibility_notes": "Ramp at side door"}
    db.refresh(maple)
    assert (maple.email, maple.wheelchair_accessible, list(maple.languages or [])) == before  # unchanged until reviewed
    from app.ingestion.verification.workflow import decide_change
    from app.models import User

    reviewer = db.scalar(select(User).where(User.email == "admin@example.org"))
    for c in db.scalars(select(ChangeProposal).where(ChangeProposal.location_id == maple.id)).all():
        decide_change(db, c, reviewer, True)
    db.refresh(maple)
    assert (maple.email, maple.wheelchair_accessible, maple.languages, maple.accessibility_notes) == (
        "pantry@example.org", "yes", ["en", "es"], "Ramp at side door")
    assert client.post(f"/api/provider/locations/{maple.id}/change-requests", json={"languages": ["<script>"]}).status_code == 422
    assert client.post(f"/api/provider/locations/{maple.id}/change-requests", json={"email": "not-an-email"}).status_code == 422
    assert client.post(f"/api/provider/locations/{maple.id}/change-requests", json={"wheelchair_accessible": "maybe"}).status_code == 422


def test_every_location_endpoint_denies_other_tenants(approved, db):
    client, maple, _ = approved
    other = _loc(db, "Riverbend")
    base = f"/api/provider/locations/{other.id}"
    calls = [
        ("post", f"{base}/shelf", {"status": "open"}), ("delete", f"{base}/shelf", None), ("get", f"{base}/shelf/history", None),
        ("post", f"{base}/events", {"title": "Distribution", "starts_at": "2030-01-01T10:00:00"}), ("delete", f"{base}/events/1", None),
        ("post", f"{base}/closures", {"date": "2030-01-01"}), ("post", f"{base}/change-requests", {"phone": "7035550100"}),
        ("get", f"{base}/reports", None), ("post", f"{base}/reports/1/response", {"response": "x"}),
        ("get", f"{base}/staff", None), ("post", f"{base}/staff", {"email": "vol@example.org", "role_title": "xx"}),
        ("delete", f"{base}/staff/1", None), ("post", f"{base}/confirm", {}),
        ("post", f"{base}/ai/announcement-draft", {"text": "closed monday"}),
        ("post", "/api/provider/surplus", {"location_id": other.id, "title": "Apples", "available_until": "2030-01-01T10:00:00"}),
        ("post", "/api/provider/surplus/1/claim", {"location_id": other.id}),
    ]
    for method, url, body in calls:
        r = getattr(client, method)(url, json=body) if body is not None else getattr(client, method)(url)
        assert r.status_code == 403, (method, url, r.status_code, r.text)


def test_provider_writes_need_csrf(approved):
    client, maple, _ = approved
    token = client.headers.pop("X-CSRF-Token")
    assert client.post(f"/api/provider/locations/{maple.id}/shelf", json={"status": "open"}).status_code in (401, 403)
    client.headers["X-CSRF-Token"] = token


# --- every kind of service, not only food ---------------------------------------------------------------------------

def _make_clinic(db, loc):
    """Turn a listing into a non-food-only one (a health clinic)."""
    from app.models import Service

    for s in list(loc.services):
        loc.services.remove(s)
    db.flush()
    db.add(Service(location_id=loc.id, service_type="health_clinic"))
    db.commit()
    db.refresh(loc)


def test_non_food_status_update_shows_publicly_without_food_items(approved, db):
    client, maple, _ = approved
    _make_clinic(db, maple)
    mine = client.get("/api/provider/me").json()["items"][0]
    assert mine["offers_food"] is False and mine["service_types"] == ["health_clinic"]
    r = client.post(f"/api/provider/locations/{maple.id}/shelf", json={"status": "limited", "message": "Walk-ins paused; about a 2 hour wait"})
    assert r.status_code == 201 and r.json()["items"] == []
    public = TestClient(client.app)  # anonymous visitor
    d = public.get(f"/api/resources/{maple.id}").json()
    assert d["live"]["status"] == "limited" and d["live"]["message"] == "Walk-ins paused; about a 2 hour wait"
    assert d["live"]["source"] == "pantry" and d["current_inventory"] == []
    res = public.get("/api/resources/search", params={"lat": 38.86, "lon": -77.099, "radius_km": 60}).json()
    assert next(i for i in res["items"] if i["id"] == maple.id)["live"]["status"] == "limited"


def test_non_food_listing_rejects_shelf_items_out_of_food_and_food_offerings(approved, db):
    from app.models import ShelfUpdate

    client, maple, _ = approved
    _make_clinic(db, maple)
    base = f"/api/provider/locations/{maple.id}"
    r = client.post(f"{base}/shelf", json={"status": "open", "items": [{"food_type": "eggs", "level": "low"}]})
    assert r.status_code == 422
    assert client.post(f"{base}/shelf", json={"status": "out"}).status_code == 422
    assert db.scalars(select(ShelfUpdate).where(ShelfUpdate.location_id == maple.id)).all() == []
    ev = {"title": "Flu shot clinic day", "starts_at": "2030-01-01T10:00:00"}
    assert client.post(f"{base}/events", json={**ev, "offerings": ["fresh_fruits"]}).status_code == 422
    assert client.post(f"{base}/events", json=ev).status_code == 201  # no food types needed
    assert client.post(f"{base}/shelf", json={"status": "closed", "message": "Staff training"}).status_code == 201


def test_food_listing_still_posts_shelf_items(approved):
    client, maple, _ = approved
    r = client.post(f"/api/provider/locations/{maple.id}/shelf", json={"status": "out", "items": []})
    assert r.status_code == 201
    r = client.post(f"/api/provider/locations/{maple.id}/shelf", json={"status": "open", "items": [{"food_type": "eggs", "level": "low"}]})
    assert r.status_code == 201 and r.json()["items"][0]["food_type"] == "eggs"


def test_category_change_goes_to_review_and_applies_only_when_accepted(approved, db):
    from app.models import ChangeProposal

    client, maple, adm = approved
    before = sorted(s.service_type for s in maple.services)
    assert before and "legal_aid" not in before
    drop = before[0]
    base = f"/api/provider/locations/{maple.id}/change-requests"
    assert client.post(base, json={"add_service_types": ["not_a_type"]}).status_code == 422
    assert client.post(base, json={"remove_service_types": before}).status_code == 422  # would leave no category
    assert client.post(base, json={"add_service_types": ["legal_aid"], "remove_service_types": ["legal_aid"]}).status_code == 422
    r = client.post(base, json={"add_service_types": ["legal_aid", "esl_classes"], "remove_service_types": [drop]})
    assert r.status_code == 201 and r.json()["status"] == "pending_review"
    cp = db.scalar(select(ChangeProposal).where(ChangeProposal.location_id == maple.id, ChangeProposal.field == "service_types"))
    assert cp.origin == "provider" and cp.current_value == before
    assert cp.proposed_value == {"add": ["legal_aid", "esl_classes"], "remove": [drop]}
    db.refresh(maple)
    assert sorted(s.service_type for s in maple.services) == before  # nothing applied yet
    # the admin queue shows it; rejecting changes nothing
    assert any(c["field"] == "service_types" for c in adm.get("/api/admin/changes").json()["items"])
    assert adm.post(f"/api/admin/changes/{cp.id}/decision", json={"decision": "reject"}).status_code == 200
    db.expire_all()
    assert sorted(s.service_type for s in db.get(Location, maple.id).services) == before
    # a second proposal, accepted, applies exactly the delta
    client.post(base, json={"add_service_types": ["legal_aid"], "remove_service_types": [drop]})
    cp2 = db.scalar(select(ChangeProposal).where(ChangeProposal.location_id == maple.id, ChangeProposal.field == "service_types",
                                                 ChangeProposal.status == "pending"))
    assert adm.post(f"/api/admin/changes/{cp2.id}/decision", json={"decision": "accept"}).status_code == 200
    db.expire_all()
    after = sorted(s.service_type for s in db.get(Location, maple.id).services)
    assert after == sorted([*(x for x in before if x != drop), "legal_aid"])
    public = TestClient(client.app).get(f"/api/resources/{maple.id}").json()
    assert "legal_aid" in str(public)
