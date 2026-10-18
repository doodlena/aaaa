"""Admin → Site settings: demo mode (fictional providers), live provider features, Virginia's 8th district only."""
from sqlalchemy import select

from app.models import Location, ShelfUpdate
from app.services import site_flags
from tests.conftest import USER_PW, login, make_user

# Inside VA-08 (Arlington) and outside it (Leesburg, Loudoun County)
ARLINGTON = (38.8618, -77.0866)


def _search(client, **params):
    q = {"lat": ARLINGTON[0], "lon": ARLINGTON[1], "any_distance": "true", "page_size": 100, **params}
    return client.get("/api/resources/search", params=q).json()


def _set(admin_client, **body):
    r = admin_client.patch("/api/admin/site-settings", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_site_settings_require_admin(client, db):
    make_user(db, "visitor@example.org", USER_PW)
    login(client, "visitor@example.org", USER_PW)
    assert client.get("/api/admin/site-settings").status_code == 403
    assert client.patch("/api/admin/site-settings", json={"demo_mode": True}).status_code == 403


def test_demo_mode_adds_verified_demo_providers_to_real_listings_and_turns_off(admin_client, published, db):
    real_names = {i["name"] for i in _search(admin_client)["items"]}
    assert real_names and all(n.startswith("[TEST]") for n in real_names)

    st = _set(admin_client, demo_mode=True)
    assert st["demo_mode"] and st["provider_features_active"] and st["demo_listings"] == 21
    meta = admin_client.get("/api/meta/features").json()
    assert meta["demo_mode"] and meta["provider_features"]

    res = _search(admin_client)
    items = res["items"] + res["uncertain"]
    assert {i["name"] for i in items} >= real_names  # real listings stay on the map
    demo_items = [i for i in items if i["name"] not in real_names]
    assert len(demo_items) == 18  # 3 demo listings wait unverified in the admin queue
    assert all(i["verification_label"] == "verified" and not i["is_synthetic"] and "synthetic" not in i["warnings"] for i in demo_items)
    items = demo_items
    detail = admin_client.get(f"/api/resources/{items[0]['id']}").json()
    assert detail["verification_label"] == "verified" and not any(s["is_synthetic"] for s in detail["sources"])

    # Places with a live update today come first
    ordered = _search(admin_client)["items"]
    flags = [i["live"] is not None for i in ordered]
    assert any(flags) and flags == sorted(flags, reverse=True)

    # Provider-based filters work on today's demo posts
    live = _search(admin_client, live_open="true")["items"]
    assert live and all(i["live"]["status"] in ("open", "limited") for i in live)
    halal = _search(admin_client, live_food_group="special_diet")["items"]
    assert {i["name"] for i in halal} >= {"Little Falls Food Closet"}

    # Loading twice does not duplicate anything
    _set(admin_client, demo_mode=False)
    _set(admin_client, demo_mode=True)
    assert db.scalar(select(Location.id).where(Location.name == "Little Falls Food Closet").offset(1)) is None

    _set(admin_client, demo_mode=False)
    names = {i["name"] for i in _search(admin_client)["items"]}
    assert names == real_names


def test_demo_mode_is_only_for_the_browser_that_turned_it_on(admin_client, published, db):
    from fastapi.testclient import TestClient

    from app.main import app

    visitor = TestClient(app)
    real_ids = {i["id"] for i in _search(visitor)["items"]}
    _set(admin_client, demo_mode=True)
    assert admin_client.cookies.get(site_flags.DEMO_COOKIE) == "1"
    demo_ids = {i["id"] for i in _search(admin_client)["items"]} - real_ids
    assert len(demo_ids) == 18
    # The dashboard's "On Find help" total is exactly what search shows, in demo mode too
    assert admin_client.get("/api/admin/overview").json()["public_listings"] == len(real_ids) + 18
    assert {i["id"] for i in _search(visitor)["items"]} == real_ids  # everyone else: the normal site
    assert visitor.get(f"/api/resources/{min(demo_ids)}").status_code == 404
    r = admin_client.get("/api/resources/search", params={"lat": ARLINGTON[0], "lon": ARLINGTON[1]})
    assert r.headers["cache-control"] == "private, no-store"
    _set(admin_client, demo_mode=False)
    assert not admin_client.cookies.get(site_flags.DEMO_COOKIE)
    assert admin_client.get("/api/admin/overview").json()["public_listings"] == len(real_ids)
    assert {i["id"] for i in _search(admin_client)["items"]} == real_ids


def test_demo_mode_scopes_admin_dashboard(admin_client, published, db):
    ov = admin_client.get("/api/admin/overview").json()
    assert ov["pending_claims"] == 0 and not ov["demo_mode"]
    _set(admin_client, demo_mode=True)
    ov = admin_client.get("/api/admin/overview").json()
    assert ov["demo_mode"] and ov["pending_claims"] == 3 and ov["open_reports"] == 3
    assert sum(w["verified"] for w in ov["weeks"]) == 18 and sum(w["published"] for w in ov["weeks"]) == 18
    q = admin_client.get("/api/admin/quality").json()["metrics"]
    assert q["locations_total"] == 21 and q["published"] == 18
    unverified = admin_client.get("/api/admin/queue", params={"unverified": "true"}).json()
    assert unverified["total"] == 3
    assert len(admin_client.get("/api/admin/claims").json()["items"]) == 3
    assert admin_client.get("/api/admin/claims/pending-count").json()["pending"] == 3
    assert [c["field"] for c in admin_client.get("/api/admin/changes").json()["items"]] == ["phone"]
    # A demo listing can be verified and published on camera
    lid = unverified["items"][0]["id"]
    assert admin_client.post(f"/api/admin/resources/{lid}/actions", json={"action": "verify", "method": "phone"}).status_code == 200
    assert admin_client.post(f"/api/admin/resources/{lid}/actions", json={"action": "publish"}).status_code == 200
    assert lid in {i["id"] for i in _search(admin_client)["items"] + _search(admin_client)["uncertain"]}

    _set(admin_client, demo_mode=False)
    assert admin_client.get("/api/admin/claims/pending-count").json()["pending"] == 0
    assert admin_client.get("/api/admin/changes").json()["items"] == []
    assert admin_client.get("/api/admin/queue").json()["total"] == 8  # only the [TEST] fixtures


def test_provider_features_switch_hides_live_updates(admin_client, published, db, admin):
    from app.services.shelf import end_of_local_day

    loc = db.scalars(select(Location)).first()
    db.add(ShelfUpdate(location_id=loc.id, posted_by_id=admin.id, status="open", items=[{"food_type": "eggs", "level": "plenty"}],
                       expires_at=end_of_local_day()))
    db.commit()
    assert len(_search(admin_client, live_open="true")["items"]) == 1
    st = _set(admin_client, provider_features=False)
    assert not st["provider_features_active"]
    assert admin_client.get("/api/meta/features").json()["provider_features"] is False
    res = _search(admin_client, live_open="true")  # filter ignored, no live status shown
    assert len(res["items"]) == 8 and all(i["live"] is None for i in res["items"])
    assert admin_client.get(f"/api/resources/{loc.id}").json()["live"] is None


def test_district_only_hides_listings_outside_va08_without_deleting(admin_client, published, db):
    from app.services.resource_writer import set_coords

    locs = db.scalars(select(Location).order_by(Location.id)).all()
    set_coords(locs[0], 38.8618, -77.0866, "test")  # Arlington: inside VA-08
    set_coords(locs[1], 39.1157, -77.5636, "test")  # Leesburg: outside
    db.commit()
    before = {i["id"] for i in _search(admin_client)["items"]}
    assert {locs[0].id, locs[1].id} <= before
    _set(admin_client, district_only=True)
    after = {i["id"] for i in _search(admin_client)["items"]}
    assert locs[0].id in after and locs[1].id not in after
    assert admin_client.get(f"/api/resources/{locs[1].id}").status_code == 404
    assert admin_client.get(f"/api/admin/resources/{locs[1].id}").status_code == 200  # still there for admins
    _set(admin_client, district_only=False)
    assert locs[1].id in {i["id"] for i in _search(admin_client)["items"]}


def test_flag_defaults_hide_provider_features_and_limit_to_va08(monkeypatch):
    monkeypatch.undo()  # the real defaults, not the test suite's
    site_flags.invalidate()
    assert site_flags.defaults() == {"demo_mode": False, "provider_features": False, "district_only": True}
