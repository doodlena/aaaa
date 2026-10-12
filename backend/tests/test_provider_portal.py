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
