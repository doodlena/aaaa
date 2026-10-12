"""Database + pipeline tests: idempotency, verified-data preservation, duplicates, provenance, failure isolation."""
import json

from sqlalchemy import func, select

from app.ingestion.base import Fetcher, SourceConfig
from app.ingestion.pipeline import run_all, run_source
from app.ingestion.verification.workflow import apply_action, decide_change, decide_duplicate
from app.models import (
    AuditLog,
    ChangeProposal,
    DuplicateCandidate,
    EligibilityRequirement,
    FieldProvenance,
    Location,
    SourceRecord,
    VerificationRecord,
)


def _count(db, model, *where):
    return db.scalar(select(func.count()).select_from(model).where(*where))


def test_import_creates_unpublished_candidates_with_provenance(db, imported):
    assert imported.status == "succeeded"
    assert imported.counts["inserted"] == 8
    locs = db.scalars(select(Location)).all()
    assert all(loc.review_status == "candidate" and not loc.published for loc in locs)
    assert all(loc.is_synthetic for loc in locs)
    assert _count(db, FieldProvenance) > 0
    # jurisdiction assigned by point-in-polygon against TIGER boundaries
    syn1 = db.scalar(select(Location).where(Location.name.like("%Maple%")))
    assert syn1.jurisdiction_id == "arlington-county"
    alex = db.scalar(select(Location).where(Location.name.like("%Oak Street%")))
    assert alex.jurisdiction_id == "alexandria-city"
    # two Cedar sites share one organization but keep their own services
    cedar = db.scalars(select(Location).where(Location.name.like("%Cedar%"))).all()
    assert len({c.organization_id for c in cedar}) == 1
    assert {s.service_type for s in cedar[0].services} != {s.service_type for s in cedar[1].services}


def test_report_files_written(imported, tmp_path):
    report = json.loads(open(imported.report_path).read())
    assert report["counts"]["inserted"] == 8
    assert "unverified candidates" in report["note"]


def test_reimport_is_idempotent(db, imported, synthetic_cfg):
    again = run_source(db, synthetic_cfg, Fetcher(offline=True))
    assert again.counts["inserted"] == 0 and again.counts["unchanged"] == 8
    assert _count(db, Location) == 8
    assert _count(db, SourceRecord) == 8


def _mutated_fixture(tmp_path, synthetic_cfg, mutate):
    data = json.loads(open("../data/fixtures/synthetic_resources.json").read())
    mutate(data["records"])
    p = tmp_path / "changed.json"
    p.write_text(json.dumps(data))
    return Fetcher(fixtures={synthetic_cfg.url: p})


def test_changes_to_verified_record_become_proposals_not_overwrites(db, imported, admin, synthetic_cfg, tmp_path):
    loc = db.scalar(select(Location).where(Location.name.like("%Maple%")))
    apply_action(db, loc, admin, "verify", "phone")
    apply_action(db, loc, admin, "publish")

    def mutate(records):
        r = records[0]
        r["phone"] = "(555) 010-9999"
        r["services"][0]["schedules"] = [{"weekday": 4, "opens": "10:00", "closes": "12:00"}]

    run = run_source(db, synthetic_cfg, _mutated_fixture(tmp_path, synthetic_cfg, mutate))
    db.refresh(loc)
    assert run.counts["conflicts"] == 1 and run.counts["inserted"] == 0
    assert loc.phone == "(555) 010-0001"  # verified value preserved
    assert loc.review_status == "needs_review"  # material (schedule) change sends it back to review
    assert loc.published  # verified values stay public meanwhile
    fields = {c.field for c in db.scalars(select(ChangeProposal).where(ChangeProposal.location_id == loc.id))}
    assert fields == {"phone", "services"}
    # running the same changed import again does not duplicate proposals
    run_source(db, synthetic_cfg, _mutated_fixture(tmp_path, synthetic_cfg, mutate))
    assert _count(db, ChangeProposal, ChangeProposal.location_id == loc.id, ChangeProposal.status == "pending") == 2
    # reviewer accepts phone, rejects schedule
    for cp in db.scalars(select(ChangeProposal).where(ChangeProposal.location_id == loc.id)).all():
        decide_change(db, cp, admin, cp.field == "phone")
    db.refresh(loc)
    assert loc.phone == "(555) 010-9999"
    assert {s.weekday for s in loc.schedules if s.kind == "distribution"} == {1, 3}
    assert _count(db, AuditLog, AuditLog.entity_type == "change_proposal") == 2


def test_unverified_candidates_are_refreshed_in_place(db, imported, synthetic_cfg, tmp_path):
    def mutate(records):
        records[6]["phone"] = "(555) 010-7777"

    run = run_source(db, synthetic_cfg, _mutated_fixture(tmp_path, synthetic_cfg, mutate))
    assert run.counts["updated"] == 1
    loc = db.scalar(select(Location).where(Location.name.like("%Birch%")))
    assert loc.phone == "(555) 010-7777"


def test_cross_source_duplicate_goes_to_review_and_merge_links(db, imported, admin, tmp_path):
    other = tmp_path / "other.json"
    other.write_text(json.dumps({"records": [{
        "external_id": "x-1", "organization_name": "[TEST] Maple Community Pantry Inc", "location_name": "[TEST] Maple Community Pantry",
        "address1": "102 Synthetic Test Road", "zip": "22204", "lat": 38.8605, "lon": -77.0985,
    }]}))
    cfg = SourceConfig(id="synthetic-other", name="Other synthetic", url="file://x", adapter="structured_json",
                       jurisdictions=["arlington-county"], is_synthetic=True)
    run = run_source(db, cfg, Fetcher(fixtures={"file://x": other}))
    assert run.counts["duplicate_candidates"] == 1 and run.counts["inserted"] == 0
    dup = db.scalar(select(DuplicateCandidate))
    decide_duplicate(db, dup, admin, merge=True)
    rec = db.scalar(select(SourceRecord).where(SourceRecord.source_id == "synthetic-other"))
    assert rec.location_id == dup.location_id and rec.status == "linked"
    assert _count(db, Location) == 8


def test_distinct_duplicate_decision_creates_new_candidate(db, imported, admin, tmp_path):
    other = tmp_path / "other.json"
    other.write_text(json.dumps({"records": [{
        "external_id": "x-2", "organization_name": "[TEST] Maple Seniors Club", "location_name": "[TEST] Maple Community Pantry Seniors",
        "address1": "100 Synthetic Test Rd", "zip": "22204", "lat": 38.8600, "lon": -77.0990,
    }]}))
    cfg = SourceConfig(id="synthetic-other", name="Other", url="file://y", adapter="structured_json", jurisdictions=["arlington-county"],
                       is_synthetic=True)
    run_source(db, cfg, Fetcher(fixtures={"file://y": other}))
    dup = db.scalar(select(DuplicateCandidate))
    assert dup is not None
    decide_duplicate(db, dup, admin, merge=False)
    assert _count(db, Location) == 9


def test_invalid_records_rejected_and_bad_source_isolated(db, synthetic_cfg, tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"records": [
        {"external_id": "b1", "organization_name": "No address anywhere"},
        {"external_id": "b2", "organization_name": "Far away", "lat": 40.7, "lon": -74.0},
    ]}))
    broken = tmp_path / "broken.json"
    broken.write_text("{not json")
    good = SourceConfig(id="syn-bad", name="bad", url="file://bad", adapter="structured_json", jurisdictions=["arlington-county"], is_synthetic=True)
    worse = SourceConfig(id="syn-broken", name="broken", url="file://broken", adapter="structured_json", jurisdictions=["arlington-county"], is_synthetic=True)
    missing = SourceConfig(id="syn-missing", name="missing", url="https://unreachable.invalid/x", adapter="structured_json",
                           jurisdictions=["arlington-county"], is_synthetic=True)
    fetcher = Fetcher(fixtures={"file://bad": bad, "file://broken": broken}, offline=True)
    runs = run_all(db, None, ["syn-bad", "syn-broken", "syn-missing"], fetcher,
                   configs={c.id: c for c in (good, worse, missing)})
    by = {r.source_id: r for r in runs}
    assert by["syn-bad"].counts["rejected"] == 2 and by["syn-bad"].status == "succeeded"
    assert by["syn-broken"].status == "failed" and by["syn-broken"].counts["parse_errors"] == 1
    assert by["syn-missing"].status == "failed" and by["syn-missing"].counts["fetch_errors"] == 1
    assert _count(db, Location) == 0


def test_scope_limits_ingestion(db, synthetic_cfg):
    run = run_source(db, synthetic_cfg, Fetcher(offline=True), scope={"arlington-county"})
    assert run.counts["inserted"] == 2 and run.counts["out_of_scope"] == 6


def test_record_missing_from_source_flags_verified_listing(db, imported, admin, synthetic_cfg, tmp_path):
    loc = db.scalar(select(Location).where(Location.name.like("%Riverbend%")))
    apply_action(db, loc, admin, "verify", "website")
    run = run_source(db, synthetic_cfg, _mutated_fixture(tmp_path, synthetic_cfg, lambda r: r.pop(1)))
    db.refresh(loc)
    assert run.counts["gone"] == 1
    assert loc.review_status == "needs_review"
    assert loc.operating_status != "permanently_closed"  # disappearance is a reason to investigate, not to close


def test_verification_requires_method_and_records_reviewer(db, imported, admin):
    import pytest
    from fastapi import HTTPException

    loc = db.scalar(select(Location))
    with pytest.raises(HTTPException):
        apply_action(db, loc, admin, "verify")  # no method
    with pytest.raises(HTTPException):
        apply_action(db, loc, admin, "publish")  # not verified
    apply_action(db, loc, admin, "verify", "phone", "called")
    v = db.scalar(select(VerificationRecord).where(VerificationRecord.action == "verify"))
    assert v.reviewer_id == admin.id and v.snapshot["name"] == loc.name


def test_eligibility_unique_scope_constraint(db, imported):
    import pytest
    from sqlalchemy.exc import IntegrityError

    loc = db.scalar(select(Location).where(Location.name.like("%Riverbend%")))
    db.add(EligibilityRequirement(location_id=loc.id, service_id=None, requirement_type="photo_id", status="unknown"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_two_records_same_site_keep_both_services(db, tmp_path):
    f = tmp_path / "two.json"
    base = {"organization_name": "[TEST] Shared Church", "location_name": "[TEST] Shared Church", "address1": "1 Test Way", "zip": "22204",
            "lat": 38.861, "lon": -77.1}
    f.write_text(json.dumps({"records": [
        {**base, "external_id": "p1", "services": [{"service_type": "pantry_pickup", "food_types": ["general_groceries"]}],
         "eligibility": [{"requirement_type": "photo_id", "status": "not_required"}]},
        {**base, "external_id": "p2", "services": [{"service_type": "mobile_pantry", "food_types": ["fresh_vegetables"]}],
         "eligibility": [{"requirement_type": "photo_id", "status": "required"}]},
    ]}))
    cfg = SourceConfig(id="syn-two", name="two", url="file://two", adapter="structured_json", jurisdictions=["arlington-county"], is_synthetic=True)
    run_source(db, cfg, Fetcher(fixtures={"file://two": f}))
    loc = db.scalar(select(Location))
    assert _count(db, Location) == 1
    assert {s.service_type for s in loc.services} == {"pantry_pickup", "mobile_pantry"}
    assert [e.status for e in loc.eligibility if e.requirement_type == "photo_id"] == ["required"]  # conservative merge
