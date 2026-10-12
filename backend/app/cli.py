"""`foodaccess` command-line interface (also: `python -m app.cli`). All commands are idempotent and cron-safe."""
import argparse
import getpass
import json
import os
import sys
from datetime import UTC, datetime

from sqlalchemy import select

from app.config import REPO_ROOT, get_settings
from app.db import session_factory


def _db():
    return session_factory()()


def cmd_migrate(_a):
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(REPO_ROOT / "backend" / "alembic.ini"))
    cfg.set_main_option("script_location", str(REPO_ROOT / "backend" / "migrations"))
    command.upgrade(cfg, "head")


def cmd_bootstrap(a):
    """Migrate, then sync jurisdiction registry, boundaries, and source registry. Safe to re-run any time."""
    from app.ingestion.base import load_source_configs
    from app.ingestion.pipeline import sync_source_row
    from app.services.registry import sync_jurisdictions

    cmd_migrate(a)
    with _db() as db:
        ids = sync_jurisdictions(db)
        for cfg in load_source_configs().values():
            sync_source_row(db, cfg)
        db.commit()
    print(f"bootstrap ok: {len(ids)} jurisdictions synced")


def cmd_sync_registry(_a):
    from app.ingestion.base import load_source_configs
    from app.ingestion.pipeline import sync_source_row
    from app.services.registry import sync_jurisdictions

    with _db() as db:
        print("jurisdictions:", ", ".join(sync_jurisdictions(db)))
        for cfg in load_source_configs().values():
            sync_source_row(db, cfg)
        db.commit()


def cmd_title_i(a):
    from app.research.title_i import run_title_i_analysis

    out = run_title_i_analysis(offline=a.offline)
    print(json.dumps(out["summary_paths"], indent=2))


def cmd_pilot_report(a):
    from app.research.pilot_selection import run_pilot_selection

    out = run_pilot_selection()
    print(json.dumps({"recommended": out["recommended"], "report": out["report_path"]}, indent=2))


def cmd_ingest(a):
    from app.ingestion.base import Fetcher, load_source_configs
    from app.ingestion.pipeline import run_all
    from app.services.registry import active_scope

    configs = load_source_configs()
    scope = {a.jurisdiction} if a.jurisdiction else active_scope()
    if not scope and not a.source:
        sys.exit("No active pilot/expansion jurisdictions. Set config/pilot.yaml or pass --jurisdiction.")
    if a.source and a.source not in configs:
        sys.exit(f"unknown source {a.source}")
    if a.source and configs[a.source].is_synthetic:
        scope = None if not a.jurisdiction else scope
    with _db() as db:
        runs = run_all(db, scope, [a.source] if a.source else None, Fetcher(offline=a.offline), do_geocode=a.geocode, configs=configs)
        for r in runs:
            print(f"run {r.id} {r.source_id}: {r.status} {json.dumps(r.counts)} -> {r.report_path}")
        if not runs:
            print("no sources matched the requested scope")


def cmd_dedupe(_a):
    """Scan existing locations pairwise (within 300 m or same address) and queue possible duplicates for review."""
    from geoalchemy2 import Geography
    from sqlalchemy import cast, func
    from sqlalchemy.orm import aliased

    from app.ingestion.deduplication.matcher import MatchInput, classify, score
    from app.ingestion.normalization.text import normalize_name, url_domain
    from app.models import DuplicateCandidate, Location
    from app.services.resource_writer import coords_of

    a_, b_ = aliased(Location), aliased(Location)
    with _db() as db:
        pairs = db.execute(select(a_, b_).where(
            a_.id < b_.id, a_.merged_into_id.is_(None), b_.merged_into_id.is_(None), a_.review_status != "rejected",
            b_.review_status != "rejected",
            (func.ST_DWithin(cast(a_.geom, Geography), cast(b_.geom, Geography), 300)) | (a_.normalized_address == b_.normalized_address),
        )).all()
        n = 0
        for x, y in pairs:
            px, py = coords_of(x), coords_of(y)
            res = score(MatchInput(normalize_name(x.name), x.normalized_address, px and px["lat"], px and px["lon"],
                                   url_domain(x.website or x.organization.website), x.phone),
                        MatchInput(normalize_name(y.name), y.normalized_address, py and py["lat"], py and py["lon"],
                                   url_domain(y.website or y.organization.website), y.phone))
            if classify(res) == "distinct":
                continue
            exists_ = db.scalar(select(DuplicateCandidate).where(DuplicateCandidate.location_id == x.id, DuplicateCandidate.other_location_id == y.id))
            if not exists_:
                db.add(DuplicateCandidate(location_id=x.id, other_location_id=y.id, score=res.score, reasons=res.reasons))
                n += 1
        db.commit()
    print(f"{n} new location-pair duplicate candidates queued")


def cmd_validate(_a):
    """Re-run validation against stored normalized records (e.g. after rules change)."""
    from app.ingestion.base import get_adapter, load_source_configs
    from app.ingestion.candidate import CandidateResource
    from app.ingestion.pipeline import validate
    from app.models import SourceRecord

    configs = load_source_configs()
    with _db() as db:
        n = errs = 0
        for rec in db.scalars(select(SourceRecord)).all():
            cfg = configs.get(rec.source_id)
            if not cfg:
                continue
            rec.validation = validate(CandidateResource(**rec.normalized), get_adapter(cfg))
            n += 1
            errs += any(i["severity"] == "error" for i in rec.validation)
        db.commit()
    print(f"validated {n} source records; {errs} with errors")


def cmd_review_queue(a):
    from sqlalchemy import func

    from app.models import ChangeProposal, DuplicateCandidate, Location

    with _db() as db:
        counts = dict(db.execute(select(Location.review_status, func.count()).group_by(Location.review_status)).all())
        out = {"locations_by_status": counts,
               "pending_changes": db.scalar(select(func.count()).select_from(ChangeProposal).where(ChangeProposal.status == "pending")),
               "pending_duplicates": db.scalar(select(func.count()).select_from(DuplicateCandidate).where(DuplicateCandidate.status == "pending"))}
    print(json.dumps(out, indent=2))


def cmd_quality(a):
    from app.services.quality import quality_report
    from app.services.registry import load_jurisdiction_configs

    out_dir = get_settings().reports_dir / "quality"
    out_dir.mkdir(parents=True, exist_ok=True)
    with _db() as db:
        ids = [a.jurisdiction] if a.jurisdiction else [None] + [j["id"] for j in load_jurisdiction_configs()]
        reports = {jid or "all": quality_report(db, jid, include_synthetic=a.include_synthetic) for jid in ids}
    p = out_dir / f"quality-{datetime.now(UTC):%Y%m%d}.json"
    p.write_text(json.dumps(reports, indent=2, default=str))
    print(json.dumps(reports.get(a.jurisdiction or "all"), indent=2, default=str))
    print(f"written: {p}")


def cmd_mark_stale(_a):
    from app.ingestion.verification.workflow import mark_stale

    with _db() as db:
        print(f"{mark_stale(db)} verified listings marked stale")


def cmd_recheck_stale(a):
    """Re-run the sources behind stale / needs-review listings so reviewers see fresh source data."""
    from app.ingestion.base import Fetcher, load_source_configs
    from app.ingestion.pipeline import run_source
    from app.models import Location, SourceRecord
    from app.services.registry import active_scope

    configs = load_source_configs()
    with _db() as db:
        srcs = set(db.scalars(select(SourceRecord.source_id).join(Location, SourceRecord.location_id == Location.id)
                              .where(Location.review_status.in_(("stale", "needs_review")))).all())
        for sid in sorted(srcs):
            if sid in configs and configs[sid].enabled and not configs[sid].is_synthetic:
                r = run_source(db, configs[sid], Fetcher(offline=a.offline), active_scope())
                print(f"{sid}: {r.status}")


def cmd_create_admin(a):
    from app.auth.security import hash_password
    from app.models import User

    pw = os.environ.get("FOODACCESS_ADMIN_PASSWORD") or getpass.getpass("Admin password (min 12 chars): ")
    if len(pw) < 12:
        sys.exit("password too short")
    with _db() as db:
        u = db.scalar(select(User).where(User.email == a.email.lower()))
        if u:
            u.role = "admin"
            u.password_hash = hash_password(pw)
        else:
            db.add(User(email=a.email.lower(), password_hash=hash_password(pw), role="admin", preferences={}))
        db.commit()
    print(f"admin ready: {a.email.lower()}")


def cmd_demo(a):
    """Local demo only: import synthetic fixtures and have a named admin verify+publish them (labelled synthetic)."""
    from app.ingestion.base import Fetcher, load_source_configs
    from app.ingestion.pipeline import run_source
    from app.ingestion.verification.workflow import apply_action
    from app.models import Location, User

    s = get_settings()
    if s.environment == "production":
        sys.exit("refusing to load synthetic data in production")
    with _db() as db:
        admin = db.scalar(select(User).where(User.email == a.reviewer_email.lower(), User.role == "admin"))
        if not admin:
            sys.exit("reviewer must be an existing admin (foodaccess create-admin)")
        run = run_source(db, load_source_configs()["synthetic-fixtures"], Fetcher())
        print(f"synthetic import run {run.id}: {run.counts}")
        for loc in db.scalars(select(Location).where(Location.is_synthetic.is_(True), Location.review_status == "candidate")).all():
            apply_action(db, loc, admin, "verify", "provider_submission", "Synthetic demo data — not a real verification")
            apply_action(db, loc, admin, "publish", "none", "Synthetic demo data")
    print("Synthetic demo records published. They are only visible when FOODACCESS_SHOW_SYNTHETIC=true and are labelled as test data.")


def cmd_translate(a):
    from app.services.translation import translate_pending

    with _db() as db:
        print(json.dumps(translate_pending(db, a.lang, limit=a.limit), indent=2))


def cmd_evaluate(a):
    from app.research.evaluation import run_pilot_evaluation

    print(run_pilot_evaluation())


def cmd_import_reference(_a):
    from app.research.reference import import_reference_data

    print(json.dumps(import_reference_data(), indent=2))


def main(argv=None):
    p = argparse.ArgumentParser(prog="foodaccess", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate", help="apply database migrations").set_defaults(fn=cmd_migrate)
    sub.add_parser("bootstrap", help="migrate + sync jurisdiction/source registries (idempotent)").set_defaults(fn=cmd_bootstrap)
    sub.add_parser("sync-registry", help="re-read config/jurisdictions, config/pilot.yaml, config/sources").set_defaults(fn=cmd_sync_registry)
    sub.add_parser("import-reference", help="download boundaries + ZIP centroids (Census)").set_defaults(fn=cmd_import_reference)
    t = sub.add_parser("title-i", help="download + analyze VDOE Title I and directory data")
    t.add_argument("--offline", action="store_true", help="use cached downloads only")
    t.set_defaults(fn=cmd_title_i)
    sub.add_parser("pilot-report", help="score divisions and write the pilot selection report").set_defaults(fn=cmd_pilot_report)
    i = sub.add_parser("ingest", help="import resources for the active scope, one jurisdiction, or one source")
    i.add_argument("--source")
    i.add_argument("--jurisdiction")
    i.add_argument("--offline", action="store_true")
    i.add_argument("--geocode", action="store_true", help="geocode records lacking coordinates (Census geocoder)")
    i.set_defaults(fn=cmd_ingest)
    sub.add_parser("validate", help="re-validate staged source records").set_defaults(fn=cmd_validate)
    sub.add_parser("dedupe", help="queue possible duplicate locations for review").set_defaults(fn=cmd_dedupe)
    sub.add_parser("review-queue", help="summarize the manual review queue").set_defaults(fn=cmd_review_queue)
    q = sub.add_parser("quality-report", help="data-quality metrics overall and per jurisdiction")
    q.add_argument("--jurisdiction")
    q.add_argument("--include-synthetic", action="store_true")
    q.set_defaults(fn=cmd_quality)
    sub.add_parser("mark-stale", help="label verified listings past the freshness threshold as stale").set_defaults(fn=cmd_mark_stale)
    r = sub.add_parser("recheck-stale", help="re-import sources behind stale/needs-review listings")
    r.add_argument("--offline", action="store_true")
    r.set_defaults(fn=cmd_recheck_stale)
    c = sub.add_parser("create-admin", help="create or promote an administrator (password via prompt or FOODACCESS_ADMIN_PASSWORD)")
    c.add_argument("--email", required=True)
    c.set_defaults(fn=cmd_create_admin)
    d = sub.add_parser("demo", help="LOCAL DEMO: load + publish synthetic fixtures (never in production)")
    d.add_argument("--reviewer-email", required=True)
    d.set_defaults(fn=cmd_demo)
    tr = sub.add_parser("translate", help="machine-translate external descriptions (self-hosted provider)")
    tr.add_argument("--lang", default="es")
    tr.add_argument("--limit", type=int, default=200)
    tr.set_defaults(fn=cmd_translate)
    sub.add_parser("evaluate-pilot", help="write the pilot evaluation report").set_defaults(fn=cmd_evaluate)
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
