"""API tests against PostGIS with synthetic fixtures."""
import json
from math import isclose

from sqlalchemy import select

from app.config import get_settings
from app.models import Location
from tests.conftest import USER_PW, login, make_user

ARL = {"lat": 38.8600, "lon": -77.0990}  # synthetic Maple pantry position


def names(items):
    return {i["name"] for i in items}


def test_search_requires_nothing_but_hides_unpublished(client, imported):
    r = client.get("/api/resources/search", params={**ARL, "radius_km": 50})
    assert r.status_code == 200
    assert r.json()["total"] == 0  # candidates are never public


def test_radius_search_distance_order_and_postgis_distance(client, published):
    r = client.get("/api/resources/search", params={**ARL, "radius_km": 5}).json()
    got = [i["name"] for i in r["items"]]
    assert got[0].startswith("[TEST] Maple")
    assert all("Woodbridge" not in n for n in got)
    riverbend = next(i for i in r["items"] if "Riverbend" in i["name"])
    # ~2.8 km between (38.86,-77.099) and (38.885,-77.095); geodesic from PostGIS
    assert isclose(riverbend["distance_km"], 2.8, abs_tol=0.15)
    dists = [i["distance_km"] for i in r["items"]]
    assert dists == sorted(dists)


def test_border_search_crosses_jurisdictions(client, published):
    r = client.get("/api/resources/search", params={**ARL, "radius_km": 8}).json()
    assert {"arlington-county", "alexandria-city"} <= {i["jurisdiction_id"] for i in r["items"]}


def test_viewport_search(client, published):
    r = client.get("/api/resources/search", params={"bbox": "-77.35,38.6,-77.2,38.7"}).json()
    assert names(r["items"]) == {"[TEST] Willow Mutual Aid", "[TEST] Aspen Home Delivery Program"}


def test_bad_params_rejected(client):
    assert client.get("/api/resources/search", params={"lat": 38.8}).status_code == 422
    assert client.get("/api/resources/search", params={"bbox": "1,2,3"}).status_code == 422
    assert client.get("/api/resources/search", params={**ARL, "radius_km": 500}).status_code == 422
    assert client.get("/api/resources/search", params={"food_group": "candy"}).status_code == 422


def test_food_and_service_filters(client, published):
    r = client.get("/api/resources/search", params={**ARL, "radius_km": 60, "food_group": "infant"}).json()
    assert names(r["items"]) == {"[TEST] Cedar Family Services — Annandale"}
    r = client.get("/api/resources/search", params={**ARL, "radius_km": 60, "food_group": ["produce", "dairy"]}).json()
    assert names(r["items"]) == {"[TEST] Maple Community Pantry — Main Site"}  # AND across groups
    r = client.get("/api/resources/search", params={**ARL, "radius_km": 60, "service_group": "drive_through"}).json()
    assert names(r["items"]) == {"[TEST] Riverbend Food Share"}
    assert r["items"][0]["match_reasons"][1] == {"code": "service_group", "value": "drive_through"}


def test_any_distance_removes_the_radius_limit_but_keeps_distance_order(client, published):
    near = client.get("/api/resources/search", params={**ARL, "radius_km": 1}).json()
    everywhere = client.get("/api/resources/search", params={**ARL, "radius_km": 1, "any_distance": "true"}).json()
    wide = client.get("/api/resources/search", params={**ARL, "radius_km": 80}).json()
    assert everywhere["total"] >= wide["total"] > near["total"]
    d = [i["distance_km"] for i in everywhere["items"]]
    assert d == sorted(d) and all(x is not None for x in d)
    assert everywhere["coverage"]["complete"] is False  # an unlimited search always reaches past covered areas


def test_need_match_any_treats_selected_needs_as_alternatives(client, published):
    both = {**ARL, "radius_km": 60, "food_group": "infant", "service_group": "drive_through"}
    assert names(client.get("/api/resources/search", params=both).json()["items"]) == set()  # default: must offer both
    r = client.get("/api/resources/search", params={**both, "need_match": "any"}).json()
    assert names(r["items"]) == {"[TEST] Cedar Family Services — Annandale", "[TEST] Riverbend Food Share"}
    # match reasons name only what each place really offers, never every selected need
    why = {i["name"]: [m for m in i["match_reasons"] if m["code"] in ("food_group", "service_group")] for i in r["items"]}
    assert why["[TEST] Cedar Family Services — Annandale"] == [{"code": "food_group", "value": "infant"}]
    assert why["[TEST] Riverbend Food Share"] == [{"code": "service_group", "value": "drive_through"}]
    # food groups stay a refinement of the one food need (still AND among themselves)
    r = client.get("/api/resources/search", params={**ARL, "radius_km": 60, "food_group": ["produce", "dairy"], "need_match": "any"}).json()
    assert names(r["items"]) == {"[TEST] Maple Community Pantry — Main Site"}
    assert client.get("/api/resources/search", params={**ARL, "need_match": "some"}).status_code == 422


def test_no_id_filter_excludes_unknown_and_required(client, published):
    """Scenario F: 'No ID required' never matches listings whose ID requirement is unknown."""
    r = client.get("/api/resources/search", params={**ARL, "radius_km": 60, "eligibility": "no_id_required"}).json()
    assert names(r["items"]) == {"[TEST] Maple Community Pantry — Main Site", "[TEST] Oak Street Community Kitchen"}
    assert "[TEST] Riverbend Food Share" not in names(r["items"]) | names(r["uncertain"])  # ID required
    unknown = names(r["uncertain"])
    assert "[TEST] Birch Hill Church Pantry" in unknown
    assert all("no_id_required" in i["unconfirmed"] for i in r["uncertain"])
    r2 = client.get("/api/resources/search", params={**ARL, "radius_km": 60, "eligibility": "no_id_required", "include_uncertain": False}).json()
    assert r2["uncertain"] == []


def test_date_filter_uses_distribution_schedule(client, published):
    # 2026-10-13 is a Tuesday: Maple distributes Tue; Oak St kitchen daily; Cedar Annandale is Wednesday.
    r = client.get("/api/resources/search", params={**ARL, "radius_km": 60, "date": "2026-10-13"}).json()
    got = names(r["items"])
    assert "[TEST] Maple Community Pantry — Main Site" in got and "[TEST] Oak Street Community Kitchen" in got
    assert "[TEST] Cedar Family Services — Annandale" not in got
    assert "[TEST] Birch Hill Church Pantry" in names(r["uncertain"])  # no schedule => uncertain, not a match
    # 2nd Saturday rule (Riverbend) on 2026-10-10 but not 2026-10-17
    assert "[TEST] Riverbend Food Share" in names(client.get("/api/resources/search", params={**ARL, "radius_km": 60, "date": "2026-10-10"}).json()["items"])
    assert "[TEST] Riverbend Food Share" not in names(client.get("/api/resources/search", params={**ARL, "radius_km": 60, "date": "2026-10-17"}).json()["items"])


def test_pagination(client, published):
    p1 = client.get("/api/resources/search", params={**ARL, "radius_km": 60, "page_size": 3}).json()
    p2 = client.get("/api/resources/search", params={**ARL, "radius_km": 60, "page_size": 3, "page": 2}).json()
    assert p1["total"] == 8 and len(p1["items"]) == 3 and not names(p1["items"]) & names(p2["items"])


def test_detail_has_structured_sections_and_unknowns(client, published, db):
    loc = db.scalar(select(Location).where(Location.name.like("%Maple%")))
    d = client.get(f"/api/resources/{loc.id}").json()
    assert d["organization"]["website"] == "https://example.org/maple"
    assert d["sources"] and d["sources"][0]["url"].startswith("https://example.org/synthetic")
    assert d["eligibility"]["photo_id"] == "not_required" and d["eligibility"]["referral"] == "unknown"
    assert {s["weekday"] for s in d["schedules"]["distribution"]} == {1, 3}
    assert len(d["schedules"]["operating_hours"]) == 5
    assert d["current_inventory"] is None
    assert d["directions"]["osm"].startswith("https://www.openstreetmap.org/directions")
    birch = db.scalar(select(Location).where(Location.name.like("%Birch%")))
    b = client.get(f"/api/resources/{birch.id}").json()
    assert "eligibility_unknown" in b["warnings"] and "schedule_unknown" in b["warnings"]
    assert b["organization"]["website"] is None  # never invented


def test_unpublished_detail_404_and_synthetic_hidden_when_disabled(client, imported, published, db, monkeypatch):
    loc = db.scalar(select(Location))
    monkeypatch.setattr(get_settings(), "show_synthetic", False)
    assert client.get(f"/api/resources/{loc.id}").status_code == 404
    assert client.get("/api/resources/search", params={**ARL, "radius_km": 60}).json()["total"] == 0


def test_categories_jurisdictions_and_events(client, published):
    c = client.get("/api/meta/categories").json()
    assert "produce" in c["food_groups"] and "no_id_required" in c["eligibility_filters"]
    j = client.get("/api/jurisdictions").json()
    assert {x["id"] for x in j} >= {"arlington-county", "fairfax-county"}
    assert all(x["has_boundary"] for x in j)
    ev = client.get("/api/events/upcoming", params={**ARL, "radius_km": 10, "days": 7}).json()["items"]
    assert ev and all(e["kind"] in ("distribution", "event") for e in ev)


def test_geocode_zip_offline(client):
    r = client.get("/api/geocode", params={"q": "22204"}).json()
    assert r["results"][0]["precision"] == "zip" and isclose(r["results"][0]["lat"], 38.86, abs_tol=0.01)


# --- accounts ---------------------------------------------------------------------------------------------------

def test_register_login_me_logout(client):
    r = client.post("/api/auth/register", json={"email": "Fam@Example.org", "password": "long-enough-pw", "preferred_language": "es"})
    assert r.status_code == 201 and r.json()["email"] == "fam@example.org"
    assert "nfa_session" in client.cookies
    assert client.get("/api/auth/me").json()["user"]["preferred_language"] == "es"
    assert client.post("/api/auth/register", json={"email": "fam@example.org", "password": "long-enough-pw"}).status_code == 409
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").json()["user"] is None


def test_password_hashed_with_argon2(db, client):
    client.post("/api/auth/register", json={"email": "a@example.org", "password": "long-enough-pw"})
    from app.models import User

    u = db.scalar(select(User).where(User.email == "a@example.org"))
    assert u.password_hash.startswith("$argon2") and "long-enough-pw" not in u.password_hash


def test_login_errors_and_rate_limit(client, db):
    make_user(db, "u@example.org", USER_PW)
    assert client.post("/api/auth/login", json={"email": "u@example.org", "password": "wrong"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "nobody@example.org", "password": "wrong"}).status_code == 401
    codes = [client.post("/api/auth/login", json={"email": "u@example.org", "password": "wrong"}).status_code for _ in range(12)]
    assert 429 in codes


def test_validation_errors_do_not_echo_passwords(client):
    r = client.post("/api/auth/register", json={"email": "bad", "password": "short-secret"})
    assert r.status_code == 422 and "short-secret" not in r.text


def test_favorites_flow_requires_csrf(client, db, published):
    """Scenario C (API level): save, sign out, sign in, still saved."""
    make_user(db, "u@example.org", USER_PW)
    loc_id = published[0].id
    assert client.post(f"/api/me/favorites/{loc_id}").status_code == 401
    login(client, "u@example.org", USER_PW)
    token = client.headers.pop("X-CSRF-Token")
    assert client.post(f"/api/me/favorites/{loc_id}").status_code == 403  # no CSRF header
    client.headers["X-CSRF-Token"] = token
    assert client.post(f"/api/me/favorites/{loc_id}").status_code == 201
    client.post("/api/auth/logout")
    login(client, "u@example.org", USER_PW)
    favs = client.get("/api/me/favorites").json()["items"]
    assert [f["id"] for f in favs] == [loc_id] and favs[0]["available"]
    assert client.delete(f"/api/me/favorites/{loc_id}").status_code == 204
    assert client.get("/api/me/favorites").json()["items"] == []


def test_cannot_favorite_unpublished(client, db, imported):
    make_user(db, "u@example.org", USER_PW)
    login(client, "u@example.org", USER_PW)
    loc = db.scalar(select(Location))
    assert client.post(f"/api/me/favorites/{loc.id}").status_code == 404


def test_preferences_reject_sensitive_keys_and_delete_account(client, db):
    make_user(db, "u@example.org", USER_PW)
    login(client, "u@example.org", USER_PW)
    assert client.patch("/api/me/preferences", json={"preferences": {"income": 100}}).status_code == 422
    r = client.patch("/api/me/preferences", json={"preferred_language": "es", "preferences": {"radius_km": 5}})
    assert r.json()["preferences"] == {"radius_km": 5}
    for lang in ("zh", "vi", "ko"):
        assert client.patch("/api/me/preferences", json={"preferred_language": lang}).json()["preferred_language"] == lang
    assert client.patch("/api/me/preferences", json={"preferred_language": "xx"}).status_code == 422
    assert client.request("DELETE", "/api/me", json={"password": "wrong"}).status_code == 401
    assert client.request("DELETE", "/api/me", json={"password": USER_PW}).status_code == 204
    assert client.post("/api/auth/login", json={"email": "u@example.org", "password": USER_PW}).status_code == 401


def _raw_account(db, email):
    """What someone reading the database (or a backup of it) would see for this account."""
    from sqlalchemy import text

    db.rollback()
    return db.execute(text("SELECT preferences::text, saved_places::text FROM users WHERE email = :e"), {"e": email}).one()


def test_preferences_and_saved_places_are_encrypted_at_rest(client, db, published):
    make_user(db, "u@example.org", USER_PW)
    login(client, "u@example.org", USER_PW)
    prefs = {"eligibility": ["no_id_required"], "service_groups": ["legal"], "radius_km": 5}
    assert client.patch("/api/me/preferences", json={"preferences": prefs}).json()["preferences"] == prefs
    loc_id = client.get("/api/resources/search", params={"lat": 38.86, "lon": -77.099, "radius_km": 60}).json()["items"][0]["id"]
    assert client.post(f"/api/me/favorites/{loc_id}").status_code == 201

    raw_prefs, raw_places = _raw_account(db, "u@example.org")
    for raw in (raw_prefs, raw_places):
        assert raw.startswith('{"_enc": "') and "no_id_required" not in raw and "legal" not in raw
    assert '"id"' not in raw_places and '"at"' not in raw_places  # no readable list of saved listings
    # there is no readable table linking accounts to listings any more
    from sqlalchemy import inspect

    assert "favorites" not in inspect(db.get_bind()).get_table_names()
    # the person still gets their own data back
    assert client.get("/api/auth/me").json()["user"]["preferences"] == prefs
    assert [i["id"] for i in client.get("/api/me/favorites").json()["items"]] == [loc_id]


def test_plain_rows_still_read_and_bootstrap_encrypts_them(client, db, published):
    """Rows written before encryption (or while no key was set) keep working and are sealed on the next bootstrap."""
    from sqlalchemy import text

    from app.cli import seal_account_data

    u = make_user(db, "old@example.org", USER_PW)
    db.execute(text("UPDATE users SET preferences = CAST(:p AS jsonb), saved_places = CAST(:s AS jsonb) WHERE id = :id"),
               {"p": json.dumps({"eligibility": ["no_id_required"]}), "s": json.dumps([{"id": 1, "at": "2026-10-01T00:00:00+00:00"}]), "id": u.id})
    db.commit()
    login(client, "old@example.org", USER_PW)
    assert client.get("/api/auth/me").json()["user"]["preferences"] == {"eligibility": ["no_id_required"]}
    assert seal_account_data(db) == 1 and seal_account_data(db) == 0  # idempotent
    raw_prefs, raw_places = _raw_account(db, "old@example.org")
    assert "no_id_required" not in raw_prefs and raw_places.startswith('{"_enc"')
    assert client.get("/api/auth/me").json()["user"]["preferences"] == {"eligibility": ["no_id_required"]}


def test_changed_key_loses_private_data_but_not_the_account(client, db, monkeypatch):
    from cryptography.fernet import Fernet

    make_user(db, "u@example.org", USER_PW)
    login(client, "u@example.org", USER_PW)
    client.patch("/api/me/preferences", json={"preferences": {"eligibility": ["no_id_required"]}})
    monkeypatch.setattr(get_settings(), "secret_key", Fernet.generate_key().decode())
    db.expire_all()
    me = client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["user"]["preferences"] == {}  # unreadable, not a crash
    assert client.get("/api/me/favorites").json()["items"] == []
    # a platform-generated secret that is not a Fernet key works too
    monkeypatch.setattr(get_settings(), "secret_key", "not-a-fernet-key/just+random==")
    assert client.patch("/api/me/preferences", json={"preferences": {"radius_km": 5}}).json()["preferences"] == {"radius_km": 5}


def test_without_a_key_in_production_accounts_keep_working_unencrypted(client, db, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "secret_key", None)
    monkeypatch.setattr(s, "environment", "production")
    make_user(db, "u@example.org", USER_PW)
    login(client, "u@example.org", USER_PW)
    assert client.patch("/api/me/preferences", json={"preferences": {"radius_km": 5}}).json()["preferences"] == {"radius_km": 5}
    assert _raw_account(db, "u@example.org")[0] == '{"radius_km": 5}'  # stored in the clear until a key is configured


def test_saved_place_follows_a_merge(client, db, published, admin):
    from app.ingestion.verification.workflow import merge_locations
    from app.models import Location

    make_user(db, "u@example.org", USER_PW)
    login(client, "u@example.org", USER_PW)
    items = client.get("/api/resources/search", params={"lat": 38.86, "lon": -77.099, "radius_km": 60}).json()["items"]
    drop_id, keep_id = items[0]["id"], items[1]["id"]
    assert client.post(f"/api/me/favorites/{drop_id}").status_code == 201
    merge_locations(db, db.get(Location, keep_id), db.get(Location, drop_id), admin)
    db.commit()
    assert [i["id"] for i in client.get("/api/me/favorites").json()["items"]] == [keep_id]
    assert client.post(f"/api/me/favorites/{keep_id}").status_code == 201  # already saved: no duplicate
    assert len(client.get("/api/me/favorites").json()["items"]) == 1
    assert client.delete(f"/api/me/favorites/{keep_id}").status_code == 204
    assert client.get("/api/me/favorites").json()["items"] == []


# --- admin ------------------------------------------------------------------------------------------------------

def test_admin_routes_protected(client, db, imported):
    assert client.get("/api/admin/queue").status_code == 401
    make_user(db, "u@example.org", USER_PW)
    login(client, "u@example.org", USER_PW)
    assert client.get("/api/admin/queue").status_code == 403
    assert client.post("/api/admin/resources/1/actions", json={"action": "publish"}).status_code == 403


def test_admin_review_approve_publish(admin_client, db, imported, client):
    """Scenario D (API level)."""
    q = admin_client.get("/api/admin/queue", params={"status": "candidate"}).json()
    assert q["total"] == 8 and q["counts_by_status"]["candidate"] == 8
    lid = next(i["id"] for i in q["items"] if "Maple" in i["name"])
    detail = admin_client.get(f"/api/admin/resources/{lid}").json()
    assert detail["source_records"][0]["source_id"] == "synthetic-fixtures" and detail["field_provenance"]
    assert admin_client.post(f"/api/admin/resources/{lid}/actions", json={"action": "publish"}).status_code == 409
    assert admin_client.post(f"/api/admin/resources/{lid}/actions", json={"action": "verify"}).status_code == 422
    r = admin_client.post(f"/api/admin/resources/{lid}/actions", json={"action": "verify", "method": "phone", "notes": "Called site"})
    assert r.json()["review_status"] == "verified"
    assert admin_client.post(f"/api/admin/resources/{lid}/actions", json={"action": "publish"}).json()["published"]
    hist = admin_client.get(f"/api/admin/resources/{lid}").json()["verification_history"]
    assert [h["action"] for h in hist] == ["publish", "verify"] and hist[1]["reviewer"] == "admin@example.org"
    pub = admin_client.get(f"/api/resources/{lid}").json()
    assert pub["verification_label"] == "verified"


def test_admin_edit_replaces_structures_and_audits(admin_client, db, imported):
    lid = db.scalar(select(Location.id).where(Location.name.like("%Birch%")))
    body = {
        "phone": "(555) 010-1234",
        "services": [{"service_type": "pantry_pickup", "food_types": ["general_groceries"], "offering_status": "regular"}],
        "schedules": [{"weekday": 2, "opens": "10:00", "closes": "12:00", "service_index": 0}],
        "eligibility": [{"requirement_type": "photo_id", "status": "required"}],
        "edit_notes": "Confirmed by phone",
    }
    d = admin_client.patch(f"/api/admin/resources/{lid}", json=body).json()
    assert d["phone"] == "(555) 010-1234"
    assert d["schedules"]["distribution"][0]["service_id"] == d["services"][0]["id"]
    assert d["eligibility"]["photo_id"] == "required"
    assert d["audit"][0]["action"] == "edit" and d["verification_history"][0]["action"] == "edit"


def test_admin_quality_and_runs(admin_client, imported):
    qr = admin_client.get("/api/admin/quality").json()["metrics"]
    assert qr["locations_total"] == 0  # synthetic excluded from real-data quality metrics by default
    runs = admin_client.get("/api/admin/ingestion/runs").json()["items"]
    assert runs[0]["counts"]["inserted"] == 8
    assert admin_client.get("/api/admin/sources").json()["items"][0]["is_synthetic"]


def test_admin_queue_unverified_lists_only_unconfirmed_listings(admin_client, imported):
    q = admin_client.get("/api/admin/queue", params={"unverified": "true"}).json()
    assert q["total"] == 8 and {"phone", "website"} <= set(q["items"][0])
    first, second = q["items"][0]["id"], q["items"][1]["id"]
    # a verification without a method is refused, so a listing cannot leave this list unattributed
    assert admin_client.post(f"/api/admin/resources/{first}/actions", json={"action": "verify"}).status_code == 422
    assert admin_client.post(f"/api/admin/resources/{first}/actions", json={"action": "verify", "method": "phone"}).status_code == 200
    assert admin_client.post(f"/api/admin/resources/{second}/actions", json={"action": "flag"}).status_code == 200
    q = admin_client.get("/api/admin/queue", params={"unverified": "true"}).json()
    ids = {i["id"] for i in q["items"]}
    assert q["total"] == 7 and first not in ids and second in ids  # needs_review still counts as unverified


def test_admin_overview_counts_real_listings_only(admin_client, published, db):
    from app.models import ProviderMembership

    user = make_user(db, "coordinator@example.org", USER_PW)

    ov = admin_client.get("/api/admin/overview").json()
    assert len(ov["weeks"]) == 8 and ov["pending_claims"] == 0 and ov["accounts"] == 2
    assert all(w["verified"] == 0 and w["published"] == 0 for w in ov["weeks"])  # synthetic listings are left out

    loc = db.scalars(select(Location)).first()
    loc.is_synthetic = False
    db.add(ProviderMembership(user_id=user.id, location_id=loc.id, role_title="Coordinator", status="pending"))
    db.commit()
    ov = admin_client.get("/api/admin/overview").json()
    assert ov["pending_claims"] == 1 and ov["open_reports"] == 0
    assert ov["weeks"][-1]["verified"] == 1 and ov["weeks"][-1]["published"] == 1
    assert sum(w["verified"] for w in ov["weeks"][:-1]) == 0


def test_admin_overview_requires_admin(client, db):
    make_user(db, "visitor@example.org", USER_PW)
    login(client, "visitor@example.org", USER_PW)
    assert client.get("/api/admin/overview").status_code == 403


def test_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["x-frame-options"] == "DENY"


def test_admin_edit_rejects_script_urls(admin_client, db, imported):
    lid = db.scalar(select(Location.id))
    r = admin_client.patch(f"/api/admin/resources/{lid}", json={"website": "javascript:alert(1)"})
    assert r.status_code == 422


def test_login_with_reserved_domain_admin_created_by_cli(client, db):
    make_user(db, "admin@localhost.test", "dev-admin-password-1", "admin")
    assert client.post("/api/auth/login", json={"email": "Admin@localhost.test", "password": "dev-admin-password-1"}).status_code == 200


def test_source_reported_real_listings_visible_only_from_permitted_sources(client, db, monkeypatch):
    """Unverified real candidates appear (labelled) only when their source allows republication; restricted
    datasets appear only in internal preview and never in production."""
    import json as _json

    from app.ingestion.base import Fetcher, SourceConfig
    from app.ingestion.pipeline import run_source

    f1, f2 = Path_tmp(db)
    open_src = SourceConfig(id="gov-open", name="County list", url="file://a", adapter="structured_json", jurisdictions=["arlington-county"],
                            publication="permitted_with_attribution")
    closed_src = SourceConfig(id="restricted", name="Restricted list", url="file://b", adapter="structured_json",
                              jurisdictions=["arlington-county"], publication="permission_required")
    f1.write_text(_json.dumps({"records": [{"external_id": "r1", "organization_name": "Real Pantry A", "address1": "1 A St", "zip": "22204", "lat": 38.861, "lon": -77.1}]}))
    f2.write_text(_json.dumps({"records": [{"external_id": "r2", "organization_name": "Real Pantry B", "address1": "9 B St", "zip": "22204", "lat": 38.87, "lon": -77.11}]}))
    run_source(db, open_src, Fetcher(fixtures={"file://a": f1}))
    run_source(db, closed_src, Fetcher(fixtures={"file://b": f2}))
    s = get_settings()
    res = client.get("/api/resources/search", params={**ARL, "radius_km": 10}).json()
    assert names(res["items"]) == {"Real Pantry A"}
    item = res["items"][0]
    assert item["verification_label"] == "source_reported" and "not_yet_verified" in item["warnings"]
    monkeypatch.setattr(s, "source_reported", "internal_preview")
    assert names(client.get("/api/resources/search", params={**ARL, "radius_km": 10}).json()["items"]) == {"Real Pantry A", "Real Pantry B"}
    monkeypatch.setattr(s, "environment", "production")
    assert names(client.get("/api/resources/search", params={**ARL, "radius_km": 10}).json()["items"]) == {"Real Pantry A"}
    monkeypatch.setattr(s, "source_reported", "off")
    assert client.get("/api/resources/search", params={**ARL, "radius_km": 10}).json()["total"] == 0


def Path_tmp(db):
    import tempfile
    from pathlib import Path

    d = Path(tempfile.mkdtemp())
    return d / "a.json", d / "b.json"


def test_search_responses_are_never_served_stale(client, published):
    r = client.get("/api/resources/search", params={**ARL, "radius_km": 5})
    assert r.headers["cache-control"] == "no-cache"  # counts/live status must revalidate
    assert client.get("/api/auth/me").headers["cache-control"] == "no-store"


def test_name_search_and_map_pins(client, published):
    r = client.get("/api/resources/search", params={**ARL, "radius_km": 60, "q": "cedar family"}).json()
    assert r["total"] == 2 and all("Cedar" in i["name"] for i in r["items"])
    assert client.get("/api/resources/search", params={"q": "TEST maple"}).json()["total"] == 1  # words AND'ed, case-insensitive
    pins = client.get("/api/resources/search", params={**ARL, "radius_km": 60, "page_size": 3, "fields": "pins"}).json()
    assert len(pins["items"]) == pins["total"] == 8  # every match, not just one page
    assert set(pins["items"][0]) >= {"id", "name", "lat", "lon", "verification_label"}


def test_paused_jurisdiction_is_hidden_from_public_search(client, db, published):
    from sqlalchemy import update

    from app.models import Jurisdiction

    before = client.get("/api/resources/search?fields=pins").json()["items"]
    assert before
    j = db.get(Location, before[0]["id"]).jurisdiction_id
    db.execute(update(Jurisdiction).where(Jurisdiction.id == j).values(status="planned"))
    db.commit()
    after = client.get("/api/resources/search?fields=pins").json()["items"]
    hidden = [i for i in before if db.get(Location, i["id"]).jurisdiction_id == j]
    assert hidden and not {i["id"] for i in hidden} & {i["id"] for i in after}
    assert client.get(f"/api/resources/{hidden[0]['id']}").status_code == 404


def test_each_source_listed_once_per_place(db, published):
    from app.api.public import location_sources
    from app.models import SourceRecord

    rec = db.scalars(select(SourceRecord).where(SourceRecord.location_id.isnot(None)).order_by(SourceRecord.id)).first()
    twin = SourceRecord(source_id=rec.source_id, external_id=rec.external_id + "-twin", location_id=rec.location_id, status=rec.status,
                        normalized=rec.normalized, raw_hash="twin", is_synthetic=rec.is_synthetic, last_changed_at=rec.last_changed_at,
                        first_seen_at=rec.first_seen_at, last_seen_at=rec.last_seen_at)
    db.add(twin)
    db.commit()
    names = [s["source_id"] for s in location_sources(db, rec.location_id)]
    assert names.count(rec.source_id) == 1
