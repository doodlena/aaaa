"""Adapter parsing tests. No network access.
- CAFB and Fairfax County: SYNTHETIC fixtures that reproduce the real feeds' schemas (tests/fixtures/*_schema_synthetic),
  because those datasets may not be redistributed without permission.
- PWC and Manassas: small recorded samples of public government layers (docs/pilot_research/samples), used only to
  test parsing; tests never publish them."""
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.ingestion.base import FetchedDocument, Fetcher, load_source_configs
from app.ingestion.base import get_adapter
from app.ingestion.pipeline import run_source
from app.ingestion.verification.workflow import apply_action
from app.models import Location

SAMPLES = Path(__file__).resolve().parents[2] / "docs" / "pilot_research" / "samples"
FIXTURES = Path(__file__).parent / "fixtures"


def _parse(source_id, sample, base=SAMPLES):
    cfg = load_source_configs()[source_id]
    ad = get_adapter(cfg)
    doc = FetchedDocument("x", 200, (base / sample).read_bytes(), "application/json", None)
    return [ad.normalize(r) for r in ad.parse(doc)]


def test_cafb_slots_schedules_and_unknowns():
    recs = _parse("cafb-get-help", "cafb_schema_synthetic.geojson", FIXTURES)
    mol = next(r for r in recs if r.organization_name == "[TEST] Lantern Hall Pantry")
    assert mol.zip == "22305" and mol.lat and mol.organization_website is None  # CAFB has no website field: never invented
    types = {s.service_type for s in mol.services}
    assert {"walk_up", "delivery_qualifying"} <= types
    walk = next(s for s in mol.services if s.service_type == "walk_up")
    # sample: Monday–Saturday 10:00 AM-1:00 PM (Every week), one real slot per day
    assert {(s.weekday, s.opens, s.closes) for s in walk.schedules} == {(d, "10:00", "13:00") for d in range(6)}
    assert len(walk.schedules) == 6  # repeated start2/start3 values are not treated as extra slots
    assert "general_groceries" in walk.food_types


def test_fairfax_survey_answers_become_tristates():
    recs = _parse("fairfax-food-access", "fairfax_schema_synthetic.geojson", FIXTURES)
    st = next(r for r in recs if r.organization_name == "[TEST] Fixture Pantry 0")
    el = {e.requirement_type: e.status for e in st.eligibility}
    assert el["photo_id"] == "not_required" and el["income"] == "not_required"
    assert st.organization_website == "https://www.fixture0.example.org"
    pantry = next(s for s in st.services if s.service_type == "pantry_pickup")
    assert pantry.appointment_required == "not_required"  # ACCEPT_WALK_INS = Yes
    assert (3, "11:30", "13:00", 3) in {(s.weekday, s.opens, s.closes, s.week_of_month) for s in pantry.schedules}
    assert {"diapers", "hygiene_supplies"} <= {s.service_type for s in st.services}


def test_pwc_address_phone_photo_id():
    recs = _parse("pwc-cmn-resources", "pwc_cmn_food_first3.geojson")
    acts = next(r for r in recs if r.organization_name.startswith("Acts"))
    assert (acts.address1, acts.city, acts.zip) == ("3900 Acts Ln", "Dumfries", "22026")
    assert acts.phone == "(703) 441-8606"
    assert {e.requirement_type: e.status for e in acts.eligibility}["photo_id"] == "required"
    assert acts.languages == ["en", "es"]
    assert any(s.service_type == "delivery_qualifying" for s in acts.services)


def test_manassas_mapping_ignores_thrift_hours():
    recs = _parse("manassas-food-resources", "manassas_food_resources_first3.geojson")
    hom = next(r for r in recs if r.organization_name == "House of Mercy")
    s = hom.services[0]
    assert s.service_type == "pantry_pickup" and {x.closes for x in s.schedules} == {"16:00"}


def test_scoped_discovery_only_requests_pilot_jurisdictions():
    cfg = load_source_configs()["cafb-get-help"]
    ad = get_adapter(cfg)
    ad.scope = {"prince-william-county"}
    urls = list(ad.discover())
    assert len(urls) == 1 and "Prince+William" in urls[0]


def test_restricted_source_needs_direct_verification_to_publish(db, admin, tmp_path):
    # The Fairfax feed itself is published by owner decision; test the gate with a restricted copy of its config.
    cfg = load_source_configs()["fairfax-food-access"].model_copy(update={"publication": "permission_required"})
    fx = {u: FIXTURES / "fairfax_schema_synthetic.geojson" for u in get_adapter(cfg).discover()}
    run = run_source(db, cfg, Fetcher(fixtures=fx), scope={"fairfax-county", "fairfax-city"})
    assert run.counts["inserted"] >= 1
    loc = db.scalar(select(Location).limit(1))
    assert not loc.published  # source is flagged permission_required; fixture content is synthetic
    apply_action(db, loc, admin, "verify", "website")
    with pytest.raises(HTTPException) as e:
        apply_action(db, loc, admin, "publish")
    assert e.value.status_code == 409
    apply_action(db, loc, admin, "verify", "phone", "Confirmed hours with site coordinator")
    apply_action(db, loc, admin, "publish")
    assert loc.published


def test_afac_html_adapter_expands_day_abbreviations():
    cfg = load_source_configs()["afac-get-groceries"]
    ad = get_adapter(cfg)
    doc = FetchedDocument("x", 200, (FIXTURES / "afac_schema_synthetic.html").read_bytes(), "text/html", None)
    [c] = [ad.normalize(r) for r in ad.parse(doc)]
    got = {(s.weekday, s.opens, s.closes) for s in c.services[0].schedules}
    assert got == {(d, "09:00", "13:00") for d in range(5)} | {(1, "18:00", "19:00"), (3, "18:00", "19:00"), (5, "08:30", "12:30")}
    assert c.eligibility[0].requirement_type == "residency" and c.zip == "22204" and c.lat == 38.86


def test_arlington_food_resources_trusts_only_true_flags_and_explicit_text():
    cfg = load_source_configs()["arlington-food-resources"]
    ad = get_adapter(cfg)
    doc = FetchedDocument("x", 200, (FIXTURES / "arlington_schema_synthetic.json").read_bytes(), "application/json", None)
    raws = list(ad.parse(doc))
    pantry, senior, market = (ad.normalize(r) for r in raws[:3])

    state = {e.requirement_type: e.status for e in pantry.eligibility}
    # "No Photo ID Required: False" alone says nothing; "required" comes from the sentence
    assert state == {"photo_id": "required", "proof_of_address": "required", "referral": "required", "residency": "required",
                     "visit_limit": "required"}
    assert "registration" not in state  # flag "False" + "N/A" contact stays unknown
    assert [(s.weekday, s.opens, s.closes) for s in pantry.services[0].schedules] == [(0, "09:00", "11:00")]
    assert [s.service_type for s in pantry.services] == ["pantry_pickup", "diapers"]
    assert {"general_groceries", "fresh_fruits", "fresh_vegetables"} <= set(pantry.services[0].food_types)
    assert pantry.city == "Arlington" and pantry.zip == "22204" and pantry.phone == "(703) 555-0100"
    assert pantry.languages == ["es"] and "Aramaic" in pantry.notes and "Test Person" not in pantry.model_dump_json()
    assert pantry.organization_website is None  # the file's Website column is the listing's link, not a stated org site

    # every flag "False", but the text states the restrictions; monthly + plain "Friday" must not become every Friday
    assert {e.requirement_type: e.status for e in senior.eligibility} == {"residency": "required", "age": "required", "income": "required"}
    assert senior.services[0].schedules == [] and "Friday" in senior.raw_hours_text and senior.services[0].food_types == []
    assert senior.location_name == "[TEST] Food Bank – [TEST] Senior House"

    # discount groceries are not free food; a seasonal row keeps raw hours; "Senior ... Program" is not an age limit
    m = {e.requirement_type: e.status for e in market.eligibility}
    assert market.services[0].service_type == "other" and market.services[0].offering_status == "seasonal"
    assert market.services[0].schedules == [] and "May 5 - Oct. 27" in market.notes and "Accepts SNAP." in market.notes
    assert m == {"photo_id": "not_required", "registration": "not_required", "residency": "not_required"}

    with pytest.raises(ValueError, match="unmapped Type"):
        ad.normalize(raws[3])
