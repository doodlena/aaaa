"""Database + pipeline tests: idempotency, verified-data preservation, duplicates, provenance, failure isolation."""
import json
from pathlib import Path

import pytest
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


def test_verify_source_cli_is_attributed_and_respects_publication_gate(db, admin, tmp_path, capsys):
    from app.cli import main

    cfg = SourceConfig(id="arlington-food-resources", name="x", url="https://example.org/x", adapter="arlington_food_resources",
                       jurisdictions=["arlington-county"], publication="not_assessed")
    fixture = Path(__file__).parent / "fixtures" / "arlington_schema_synthetic.json"
    run_source(db, cfg, Fetcher(fixtures={cfg.url: fixture}))
    assert _count(db, Location) == 3 and _count(db, Location, Location.review_status == "verified") == 0  # import never verifies
    args = ["verify-source", "--source", cfg.id, "--method", "official_source", "--notes", "checked against the file", "--publish"]
    with pytest.raises(SystemExit):
        main([*args, "--reviewer-email", "nobody@example.org"])
    main([*args, "--reviewer-email", "admin@example.org"])
    db.expire_all()
    # a source without publication rights: nothing is verified-and-published on an official_source check
    assert _count(db, Location, Location.published.is_(True)) == 0 and "3 skipped" in capsys.readouterr().out
    main([a for a in args if a != "--publish"] + ["--reviewer-email", "admin@example.org"])
    db.expire_all()
    recs = db.scalars(select(VerificationRecord).where(VerificationRecord.action == "verify")).all()
    assert _count(db, Location, Location.review_status == "verified") == 3 and _count(db, Location, Location.published.is_(True)) == 0
    assert {(r.reviewer_id, r.method, r.notes) for r in recs} == {(admin.id, "official_source", "checked against the file")}


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


def test_rows_are_distinct_sends_co_located_programs_to_review(db, admin, tmp_path):
    f = tmp_path / "venue.json"
    base = {"location_name": "[TEST] Mill Community Center", "address1": "1 Test Way", "zip": "22204", "lat": 38.861, "lon": -77.1,
            "services": [{"service_type": "pantry_pickup"}]}
    f.write_text(json.dumps({"records": [{**base, "external_id": "a", "organization_name": "[TEST] Org A"},
                                         {**base, "external_id": "b", "organization_name": "[TEST] Org B"}]}))
    cfg = SourceConfig(id="syn-venue", name="venue", url="file://venue", adapter="structured_json", jurisdictions=["arlington-county"],
                       is_synthetic=True, rows_are_distinct=True)
    run = run_source(db, cfg, Fetcher(fixtures={"file://venue": f}))
    assert (run.counts["inserted"], run.counts["duplicate_candidates"]) == (1, 1) and _count(db, Location) == 1
    decide_duplicate(db, db.scalar(select(DuplicateCandidate)), admin, merge=False)
    assert {loc.organization.name for loc in db.scalars(select(Location)).all()} == {"[TEST] Org A", "[TEST] Org B"}


def test_flagged_verified_listing_stays_public_as_needs_recheck(db, imported, admin, client):
    loc = db.scalar(select(Location).where(Location.name.like("%Maple%")))
    apply_action(db, loc, admin, "verify", "phone")
    apply_action(db, loc, admin, "publish")
    apply_action(db, loc, admin, "flag")
    d = client.get(f"/api/resources/{loc.id}").json()
    assert d["verification_label"] == "stale"
    never = db.scalar(select(Location).where(Location.name.like("%Birch%")))
    apply_action(db, never, admin, "flag")
    assert client.get(f"/api/resources/{never.id}").status_code == 404  # never verified => never public


def test_long_geocode_source_label_does_not_break_import(db, tmp_path):
    f = tmp_path / "g.json"
    f.write_text(json.dumps({"records": [{"external_id": "g1", "organization_name": "[TEST] Clinic", "address1": "1 A St", "zip": "22204",
                                          "lat": 38.86, "lon": -77.1, "geocode_source": "US Census geocoder (Public_AR_Current); " + "x" * 120}]}))
    cfg = SourceConfig(id="syn-g", name="g", url="file://g", adapter="structured_json", jurisdictions=["arlington-county"], is_synthetic=True)
    run = run_source(db, cfg, Fetcher(fixtures={"file://g": f}))
    assert run.counts["inserted"] == 1 and run.counts["rejected"] == 0


def test_apply_audit_fixes_categories_and_hours_and_logs_evidence(db, imported, tmp_path, capsys):
    import json as _json

    from app.cli import main
    from app.models import Schedule, Service

    loc = db.scalars(select(Location).where(Location.is_synthetic.is_(True)).order_by(Location.id)).first()
    types = sorted({s.service_type for s in loc.services})
    findings = [
        {"listing_id": loc.id, "listing_name": loc.name, "field": "categories", "current": ",".join(types),
         "remove_types": [types[0]], "add_types": ["legal_aid"], "evidence_url": "https://example.org/p",
         "evidence_quote": "We offer free legal clinics", "reason": "test", "confidence": "high"},
        {"listing_id": loc.id, "listing_name": loc.name, "field": "hours", "current": "x",
         "new_hours": [{"kind": "operating_hours", "weekday": 2, "opens": "09:00", "closes": "17:00", "week_of_month": None}],
         "evidence_url": "https://example.org/p", "evidence_quote": "Wednesday 9am-5pm", "reason": "test", "confidence": "high"},
    ]
    f = tmp_path / "f.json"
    f.write_text(_json.dumps(findings))
    main(["apply-audit", str(f), "--date", "2026-01-01", "--out", str(tmp_path)])
    db.expire_all()
    got = {s.service_type for s in db.scalars(select(Service).where(Service.location_id == loc.id)).all()}
    assert types[0] not in got and "legal_aid" in got
    hrs = db.scalars(select(Schedule).where(Schedule.location_id == loc.id)).all()
    assert [(h.weekday, h.opens.strftime("%H:%M"), h.kind) for h in hrs] == [(2, "09:00", "operating_hours")]
    log = _json.loads((tmp_path / "2026-01-01-applied.json").read_text())
    assert len(log) == 2 and log[0]["evidence_quote"] == "We offer free legal clinics"
    assert "applied 2" in capsys.readouterr().out


def test_rejected_records_in_snapshot_are_replayed(db, imported, tmp_path, monkeypatch):
    import json as _json

    from app import cli
    from app.models import SourceRecord

    rec = db.scalars(select(SourceRecord).where(SourceRecord.status == "linked").order_by(SourceRecord.id)).first()
    (tmp_path / "rejected_records.json").write_text(_json.dumps([[rec.source_id, rec.external_id]]))
    monkeypatch.setattr(cli, "SNAPSHOT_DIR", tmp_path)
    cli._apply_rejections(db)
    db.expire_all()
    assert db.get(SourceRecord, rec.id).status == "rejected"


def test_rebuild_keeps_fields_from_still_accepted_sources(db, imported):
    from app.cli import _rebuild_from_linked

    loc = db.scalars(select(Location).where(Location.is_synthetic.is_(True)).order_by(Location.id)).first()
    before = (loc.name, loc.address1, loc.phone)
    _rebuild_from_linked(db, loc)
    db.flush()
    assert (loc.name, loc.address1, loc.phone) == before


def test_load_data_if_changed_skips_an_already_loaded_snapshot(db, tmp_path, monkeypatch, capsys):
    import json as _json

    from app import cli

    (tmp_path / "manifest.json").write_text(_json.dumps({"exported_at": "2026-01-01T00:00:00", "sources": []}))
    monkeypatch.setattr(cli, "SNAPSHOT_DIR", tmp_path)
    cli.main(["load-data", "--if-changed"])
    assert "already loaded" not in capsys.readouterr().out
    cli.main(["load-data", "--if-changed"])
    assert "already loaded; skipping" in capsys.readouterr().out


def test_apply_audit_structured_eligibility(db, imported, tmp_path):
    import json as _json

    from app.cli import main
    from app.models import EligibilityRequirement

    loc = db.scalars(select(Location).where(Location.is_synthetic.is_(True)).order_by(Location.id)).first()
    f = tmp_path / "f.json"
    f.write_text(_json.dumps([{"listing_id": loc.id, "listing_name": loc.name, "field": "eligibility", "current": "",
                               "eligibility_set": [{"requirement_type": "photo_id", "status": "required", "details": "Bring ID"},
                                                   {"requirement_type": "not_a_code", "status": "required"}],
                               "evidence_url": "u", "evidence_quote": "q", "reason": "r", "confidence": "high"}]))
    main(["apply-audit", str(f), "--date", "t", "--out", str(tmp_path)])
    db.expire_all()
    els = {e.requirement_type: e.status for e in db.scalars(select(EligibilityRequirement).where(EligibilityRequirement.location_id == loc.id)).all()}
    assert els.get("photo_id") == "required" and "not_a_code" not in els


def test_hold_hides_listing_publicly_and_is_replayed_from_snapshot(db, imported, tmp_path, monkeypatch, client):
    import json as _json

    from app import cli
    from app.geospatial.search import public_visibility
    from app.models import SourceRecord

    loc = db.scalars(select(Location).where(Location.is_synthetic.is_(True)).order_by(Location.id)).first()
    f = tmp_path / "h.json"
    f.write_text(_json.dumps([{"id": loc.id, "reason": "no evidence anywhere"}]))
    cli.main(["hold-unconfirmed", str(f)])
    db.expire_all()
    assert db.get(Location, loc.id).review_status == "on_hold"
    assert db.scalar(select(Location.id).where(public_visibility(), Location.id == loc.id)) is None
    # replay: put it back, then a committed held_listings.json re-holds it
    db.get(Location, loc.id).review_status = "candidate"
    db.commit()
    rec = db.scalars(select(SourceRecord).where(SourceRecord.location_id == loc.id).order_by(SourceRecord.id)).first()
    (tmp_path / "held_listings.json").write_text(_json.dumps([[rec.source_id, rec.external_id]]))
    monkeypatch.setattr(cli, "SNAPSHOT_DIR", tmp_path)
    assert cli._apply_holds(db) == 1
    db.expire_all()
    assert db.get(Location, loc.id).review_status == "on_hold"


def test_apply_audit_refuses_a_finding_for_a_differently_named_listing(db, imported, tmp_path, capsys):
    import json as _json

    from app.cli import main

    loc = db.scalars(select(Location).where(Location.is_synthetic.is_(True)).order_by(Location.id)).first()
    f = tmp_path / "f.json"
    f.write_text(_json.dumps([{"listing_id": loc.id, "listing_name": "Completely Different Clinic", "field": "phone", "current": "",
                               "new_value": "(703) 555-0000", "evidence_url": "u", "evidence_quote": "q", "reason": "r", "confidence": "high"}]))
    main(["apply-audit", str(f), "--date", "t", "--out", str(tmp_path)])
    assert "name mismatch" in capsys.readouterr().out
    db.expire_all()
    assert db.get(Location, loc.id).phone != "(703) 555-0000"


def test_curation_hides_and_merges_listings_and_is_idempotent(db, imported, admin, tmp_path, monkeypatch):
    import json as _json

    from app import cli
    from app.geospatial.search import public_visibility
    from app.models import SourceRecord

    locs = db.scalars(select(Location).where(Location.is_synthetic.is_(True)).order_by(Location.id)).all()
    key = lambda loc: [[r.source_id, r.external_id] for r in db.scalars(  # noqa: E731
        select(SourceRecord).where(SourceRecord.location_id == loc.id).order_by(SourceRecord.id))][0]
    hide, keep, drop = locs[0], locs[1], locs[2]
    (tmp_path / "curation.json").write_text(_json.dumps({
        "hide": [{"record": key(hide), "name": hide.name, "reason": "for_profit"}],
        "merge": [{"keep": key(keep), "drop": key(drop), "name": "dup"}],
    }))
    monkeypatch.setattr(cli, "SNAPSHOT_DIR", tmp_path)
    assert cli._apply_curation(db) == (1, 1, 0)
    db.expire_all()
    assert db.get(Location, hide.id).review_status == "rejected"
    assert db.scalar(select(Location.id).where(public_visibility(), Location.id == hide.id)) is None
    assert db.get(Location, drop.id).merged_into_id == keep.id
    assert db.scalar(select(SourceRecord.id).where(SourceRecord.location_id == drop.id)) is None  # records moved to keep
    assert cli._apply_curation(db) == (0, 0, 0)  # replaying changes nothing


def test_curation_adds_documented_limits_on_who_is_served(db, imported, tmp_path, monkeypatch):
    import json as _json

    from app import cli
    from app.models import SourceRecord
    from app.services.presenter import who_for

    loc = db.scalars(select(Location).where(Location.is_synthetic.is_(True)).order_by(Location.id)).first()
    rec = db.scalars(select(SourceRecord).where(SourceRecord.location_id == loc.id).order_by(SourceRecord.id)).first()
    add = {"requirement_type": "population", "status": "required", "details": "Women only", "values": {"groups": ["women"]}}
    (tmp_path / "curation.json").write_text(_json.dumps({"eligibility": [
        {"record": [rec.source_id, rec.external_id], "name": loc.name, "add": [add], "evidence": "Women only"}]}))
    monkeypatch.setattr(cli, "SNAPSHOT_DIR", tmp_path)
    assert cli._apply_curation(db) == (0, 0, 1)
    db.expire_all()
    assert who_for(db.get(Location, loc.id))[0] == {"type": "population", "details": "Women only", "groups": ["women"]}
    assert cli._apply_curation(db) == (0, 0, 0)  # replaying changes nothing
