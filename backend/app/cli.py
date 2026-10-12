"""`lantern` (alias `foodaccess`) command-line interface (also: `python -m app.cli`). All commands are idempotent and cron-safe."""
import argparse
import getpass
import json
import os
import sys
from datetime import UTC, datetime

from sqlalchemy import select

from app.config import REPO_ROOT, get_settings
from app.db import session_factory
from app.vocab import VERIFICATION_METHODS


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
        sealed = seal_account_data(db)
    print(f"bootstrap ok: {len(ids)} jurisdictions synced" + (f"; encrypted private data for {sealed} accounts" if sealed else ""))


def seal_account_data(db) -> int:
    """Encrypt any account whose preferences or saved places are still stored in the clear (rows written while no
    FOODACCESS_SECRET_KEY was set). Does nothing without a key. Safe to re-run."""
    from sqlalchemy import text

    from app.services import secrets

    if not secrets.available():
        print("WARNING: FOODACCESS_SECRET_KEY is not set, so search preferences and saved places are stored unencrypted.")
        return 0
    n = 0
    for user_id, prefs, places in db.execute(text("SELECT id, preferences, saved_places FROM users")).all():
        todo = {c: v for c, v in (("preferences", prefs), ("saved_places", places)) if v and not secrets.is_sealed(v)}
        for column, value in todo.items():
            db.execute(text(f"UPDATE users SET {column} = CAST(:v AS jsonb) WHERE id = :id"),
                       {"v": json.dumps(secrets.seal(value)), "id": user_id})
        n += bool(todo)
    db.commit()
    return n


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
        if a.pantry_email:
            _demo_live(db, a.pantry_email.lower())
    print("Synthetic demo records published. They are only visible when FOODACCESS_SHOW_SYNTHETIC=true and are labelled as test data.")


def cmd_verify_source(a):
    """A named admin attests that they checked a source's listings against it (one verification record each). The import
    itself never verifies. Listings with pending source changes or undecided duplicates are skipped."""
    from fastapi import HTTPException

    from app.ingestion.base import load_source_configs
    from app.ingestion.verification.workflow import apply_action
    from app.models import DuplicateCandidate, Location, SourceRecord, User

    cfg = load_source_configs().get(a.source)
    if not cfg or cfg.is_synthetic:
        sys.exit(f"unknown or synthetic source {a.source}")
    done, skipped = 0, []
    with _db() as db:
        admin = db.scalar(select(User).where(User.email == a.reviewer_email.lower(), User.role == "admin"))
        if not admin:
            sys.exit("reviewer must be an existing admin (foodaccess create-admin)")
        ids = db.scalars(select(Location.id).join(SourceRecord, SourceRecord.location_id == Location.id).where(
            SourceRecord.source_id == a.source, SourceRecord.status == "linked", Location.merged_into_id.is_(None),
            Location.review_status.in_(("candidate", "needs_review"))).distinct().order_by(Location.id)).all()
        for lid in ids:
            loc = db.get(Location, lid)
            if db.scalar(select(DuplicateCandidate.id).where(DuplicateCandidate.location_id == lid, DuplicateCandidate.status == "pending").limit(1)):
                skipped.append((lid, loc.name, "undecided duplicate"))
                continue
            step = "not verified"
            try:
                apply_action(db, loc, admin, "verify", a.method, a.notes)
                step = "verified, not published"
                if a.publish:
                    apply_action(db, loc, admin, "publish", "none", a.notes)
                done += 1
            except HTTPException as e:
                db.rollback()
                skipped.append((lid, loc.name, f"{step}: {e.detail}"))
    print(f"{done} listings verified{' and published' if a.publish else ''} by {a.reviewer_email.lower()} ({a.method}); {len(skipped)} skipped")
    for lid, name, why in skipped:
        print(f"  skipped {lid} {name}: {why}")


def _demo_live(db, email):
    """Demo pantry staff account + live shelf posts, a surplus offer and a community report (all on [TEST] pantries)."""
    from datetime import UTC, datetime, timedelta

    from app.auth.security import hash_password
    from app.models import CommunityReport, Location, ProviderMembership, ShelfUpdate, SurplusPost, User
    from app.services.shelf import end_of_local_day

    pw = os.environ.get("FOODACCESS_DEMO_PASSWORD")
    if not pw or len(pw) < 10:
        sys.exit("set FOODACCESS_DEMO_PASSWORD (min 10 chars) for the demo pantry account")
    user = db.scalar(select(User).where(User.email == email)) or User(email=email, role="user", preferences={})
    user.password_hash = hash_password(pw)
    db.add(user)
    db.flush()
    locs = {loc.name: loc for loc in db.scalars(select(Location).where(Location.is_synthetic.is_(True))).all()}
    pick = lambda frag: next(l for n, l in locs.items() if frag in n)  # noqa: E731
    maple, oak, willow, cedar = pick("Maple"), pick("Oak Street"), pick("Willow"), pick("Annandale")
    for loc in (maple, willow, cedar):
        if not db.scalar(select(ProviderMembership).where(ProviderMembership.user_id == user.id, ProviderMembership.location_id == loc.id)):
            db.add(ProviderMembership(user_id=user.id, location_id=loc.id, role_title="Demo coordinator", status="approved"))
    eod = end_of_local_day()
    db.add_all([
        ShelfUpdate(location_id=maple.id, posted_by_id=user.id, status="open", message="Fresh greens and eggs just arrived!",
                    items=[{"food_type": "fresh_vegetables", "level": "plenty"}, {"food_type": "eggs", "level": "some"},
                           {"food_type": "dairy", "level": "low"}], expires_at=eod, is_synthetic=True),
        ShelfUpdate(location_id=willow.id, posted_by_id=user.id, status="limited", message="Running low on protein today.",
                    items=[{"food_type": "bread", "level": "plenty"}, {"food_type": "meat", "level": "low"}], expires_at=eod, is_synthetic=True),
        ShelfUpdate(location_id=cedar.id, posted_by_id=user.id, status="closed", message="Closed today for staff training.",
                    items=[], expires_at=eod, is_synthetic=True),
    ])
    db.add(SurplusPost(location_id=willow.id, posted_by_id=user.id, title="[TEST] 40 cases of canned beans", food_types=["pantry_staples"],
                       quantity="40 cases", pickup_notes="Loading dock, weekdays 9-3 (fictional)",
                       available_until=datetime.now(UTC) + timedelta(days=3)))
    db.add(CommunityReport(location_id=oak.id, kind="wrong_info", note="Demo report: dinner started at 6 not 5:30"))
    db.commit()
    print(f"Demo pantry staff account ready: {email} (manages 3 [TEST] pantries)")


def cmd_translate(a):
    from app.services.translation import translate_pending

    with _db() as db:
        print(json.dumps(translate_pending(db, a.lang, limit=a.limit), indent=2))


def cmd_ai_suggest(a):
    """Reviewer aid: AI-structured suggestions (as pending change proposals) for listings whose hours are only free text."""
    from app.ingestion.candidate import CandidateResource
    from app.models import ChangeProposal, Location, SourceRecord
    from app.services import ai
    from app.services.resource_writer import structures_of

    if not ai.enabled():
        sys.exit("Set FOODACCESS_AI_ENABLED=true and ANTHROPIC_API_KEY to use AI suggestions")
    with _db() as db:
        done = 0
        for rec in db.scalars(select(SourceRecord).where(SourceRecord.status == "linked", SourceRecord.is_synthetic.is_(False))).all():
            c = CandidateResource(**rec.normalized)
            parsed = bool(c.schedules) or any(s.schedules for s in c.services)
            if parsed or not c.raw_hours_text or done >= a.limit:
                continue
            loc = db.get(Location, rec.location_id)
            try:
                sug = ai.suggest_structure("\n".join(filter(None, (c.raw_hours_text, c.raw_eligibility_text))))
            except ai.AIUnavailable as e:
                print(f"stopped: {e}")
                break
            if sug.distribution_schedules:
                db.add(ChangeProposal(location_id=loc.id, field="schedules", current_value=structures_of(loc)["schedules"], origin="ai",
                                      proposed_value=[{"kind": "distribution", "weekday": s.weekday, "opens": s.opens, "closes": s.closes,
                                                       "week_of_month": s.week_of_month, "notes": f"AI-suggested from: \"{s.evidence}\""}
                                                      for s in sug.distribution_schedules]))
                done += 1
        db.commit()
    print(f"{done} AI schedule suggestions queued for review")


SNAPSHOT_DIR = REPO_ROOT / "data" / "snapshots"


def cmd_ai_resolve_duplicates(a):
    """AI-assisted bulk triage of pending duplicate candidates (cheap model, cached). 'same_place' -> merge,
    'different_places' -> keep separate (creates the listing), 'unsure' -> left for a person. Every decision is
    recorded under the named admin with an 'AI-assisted' note in the audit log."""
    from app.ingestion.verification.workflow import decide_duplicate
    from app.models import DuplicateCandidate, Location, SourceRecord, User
    from app.services import ai

    if not ai.enabled():
        sys.exit("AI is not enabled (Admin → AI settings)")
    counts = {"same_place": 0, "different_places": 0, "unsure": 0, "error": 0}
    with _db() as db:
        admin = db.scalar(select(User).where(User.email == a.reviewer_email.lower(), User.role == "admin"))
        if not admin:
            sys.exit("reviewer must be an existing admin")
        pending = db.scalars(select(DuplicateCandidate).where(DuplicateCandidate.status == "pending").order_by(DuplicateCandidate.id)).all()
        for d in pending[: a.limit]:
            db.refresh(d)
            if d.status != "pending":
                continue
            loc = db.get(Location, d.location_id)
            rec = db.get(SourceRecord, d.source_record_id) if d.source_record_id else None
            other = db.get(Location, d.other_location_id) if d.other_location_id else None
            A = {"name": loc.name, "organization": loc.organization.name, "address": loc.address1, "zip": loc.zip, "phone": loc.phone,
                 "services": sorted({s.service_type for s in loc.services})}
            if rec:
                n = rec.normalized or {}
                B = {"name": n.get("location_name") or n.get("organization_name"), "organization": n.get("organization_name"),
                     "address": n.get("address1"), "zip": n.get("zip"), "phone": n.get("phone"),
                     "services": sorted({x.get("service_type") for x in n.get("services", [])})}
            else:
                B = {"name": other.name, "organization": other.organization.name, "address": other.address1, "zip": other.zip,
                     "phone": other.phone, "services": sorted({s.service_type for s in other.services})}
            try:
                op = ai.compare_records(A, B)
            except ai.AIUnavailable as e:
                counts["error"] += 1
                if "budget" in str(e).lower():
                    print(f"stopped: {e}")
                    break
                continue  # leave this pair for a person
            counts[op.verdict] += 1
            if op.verdict == "unsure":
                continue
            decide_duplicate(db, d, admin, merge=op.verdict == "same_place",
                             notes="AI-assisted (" + op.verdict + "): " + "; ".join(op.reasons)[:500])
    print(json.dumps(counts))


def _rebuild_from_linked(db, loc) -> None:
    from app.ingestion.candidate import CandidateResource
    from app.ingestion.pipeline import _apply_unverified
    from app.models import SourceRecord

    rest = db.scalars(select(SourceRecord).where(SourceRecord.location_id == loc.id, SourceRecord.status == "linked")
                      .order_by(SourceRecord.id)).all()
    if rest:
        db.flush()
        _apply_unverified(db, loc, CandidateResource(**rest[0].normalized), rest[0])


def _retract(db, source_id: str) -> int:
    """Reject every record from a withdrawn source and rebuild the unverified listings it touched."""
    from app.models import Location, SourceRecord

    recs = db.scalars(select(SourceRecord).where(SourceRecord.source_id == source_id,
                                                 SourceRecord.status.notin_(("rejected", "invalid")))).all()
    touched = {r.location_id for r in recs if r.location_id}
    for r in recs:
        r.status = "rejected"
    db.flush()
    n = 0
    for lid in touched:
        loc = db.get(Location, lid)
        if loc and loc.last_verified_at is None and loc.review_status != "rejected":
            _rebuild_from_linked(db, loc)
            n += 1
    db.commit()
    return n


def cmd_retract_source(a):
    """Withdraw a source's data everywhere: reject its records and rebuild affected unverified listings."""
    with _db() as db:
        print(f"{a.source_id}: {_retract(db, a.source_id)} listings rebuilt")


def cmd_rebuild_rejected(_a):
    """Rebuild unverified listings that have rejected source records, so rejected services disappear."""
    from app.models import Location, SourceRecord

    with _db() as db:
        ids = set(db.scalars(select(SourceRecord.location_id).where(SourceRecord.status == "rejected", SourceRecord.location_id.isnot(None))).all())
        n = 0
        for lid in ids:
            loc = db.get(Location, lid)
            if loc.last_verified_at is None and loc.review_status != "rejected":
                _rebuild_from_linked(db, loc)
                n += 1
        db.commit()
    print(f"rebuilt {n} listings")


def cmd_ai_check_categories(a):
    """(AI) Remove service categories that a listing clearly does not offer (never adds categories)."""
    from app.models import Location, SourceRecord
    from app.services import ai

    if not ai.enabled():
        sys.exit("AI is not enabled (Admin → AI settings)")
    with _db() as db:
        recs = db.scalars(select(SourceRecord).where(SourceRecord.status == "linked", SourceRecord.is_synthetic.is_(False))
                          .order_by(SourceRecord.id)).all()
        touched, changes = set(), []
        for start in range(0, len(recs), 25):
            batch = recs[start:start + 25]
            items = []
            for r in batch:
                n = r.normalized or {}
                items.append({"name": n.get("location_name") or n.get("organization_name"), "organization": n.get("organization_name"),
                              "assigned_types": [s.get("service_type") for s in n.get("services", [])],
                              "description": " ".join(filter(None, [s.get("description") for s in n.get("services", [])] + [n.get("notes")]))[:500]})
            try:
                checks = ai.check_service_types(items)
            except ai.AIUnavailable as e:
                print(f"stopped: {e}")
                break
            for c in checks:
                if not c.wrong_types or not 0 <= c.index < len(batch):
                    continue
                rec = batch[c.index]
                n = dict(rec.normalized)
                before = [s.get("service_type") for s in n.get("services", [])]
                kept = [s for s in n.get("services", []) if s.get("service_type") not in set(c.wrong_types)]
                if len(kept) == len(before):
                    continue
                if not kept:  # nothing left that fits: hide this record rather than guess a category
                    rec.status = "rejected"
                else:
                    n["services"] = kept
                    rec.normalized = n
                changes.append((items[c.index]["name"], sorted(set(before) - {s.get("service_type") for s in kept}), c.reason))
                if rec.location_id:
                    touched.add(rec.location_id)
            db.commit()
        for lid in touched:
            loc = db.get(Location, lid)
            if loc.last_verified_at is None and loc.review_status != "rejected":
                others = db.scalar(select(SourceRecord.id).where(SourceRecord.location_id == lid, SourceRecord.status == "linked").limit(1))
                if others:
                    _rebuild_from_linked(db, loc)
                else:
                    loc.review_status, loc.published = "rejected", False
        db.commit()
    for name, removed, why in changes:
        print(f"{name}: removed {', '.join(removed)} — {why}")
    print(f"{len(changes)} records corrected")


def cmd_ai_relevance(a):
    """(AI) Remove imported listings that are not direct-assistance services (e.g. sports or enrichment programs that a
    broad source category swept in). Rejected source records are hidden and excluded from the shared snapshot."""
    from app.ingestion.verification.workflow import audit
    from app.models import Location, SourceRecord
    from app.services import ai

    if not ai.enabled():
        sys.exit("AI is not enabled (Admin → AI settings)")
    with _db() as db:
        recs = db.scalars(select(SourceRecord).where(SourceRecord.source_id == a.source, SourceRecord.status.in_(("linked", "duplicate_candidate")))
                          .order_by(SourceRecord.id)).all()
        removed = []
        for start in range(0, len(recs), 25):
            batch = recs[start:start + 25]
            items = [{"name": (r.normalized or {}).get("location_name") or (r.normalized or {}).get("organization_name"),
                      "organization": (r.normalized or {}).get("organization_name"),
                      "services": [s.get("service_type") for s in (r.normalized or {}).get("services", [])],
                      "description": " ".join(filter(None, [s.get("description") for s in (r.normalized or {}).get("services", [])]))[:400]}
                     for r in batch]
            try:
                verdicts = ai.classify_relevance(items)
            except ai.AIUnavailable as e:
                print(f"stopped: {e}")
                break
            for v in verdicts:
                if v.keep or not 0 <= v.index < len(batch):
                    continue
                rec = batch[v.index]
                rec.status = "rejected"
                removed.append((items[v.index]["name"], v.reason))
                if rec.location_id:
                    loc = db.get(Location, rec.location_id)
                    others = db.scalar(select(SourceRecord.id).where(SourceRecord.location_id == loc.id, SourceRecord.id != rec.id,
                                                                     SourceRecord.status == "linked").limit(1))
                    if not others and loc.last_verified_at is None:
                        loc.review_status = "rejected"
                        loc.published = False
                    elif others and loc.last_verified_at is None:
                        _rebuild_from_linked(db, loc)  # drop services that came only from the rejected record
                    audit(db, None, "location", loc.id, "ai_relevance_rejected_record", None,
                          {"source_record": rec.id, "reason": v.reason}, label="ai:relevance")
            db.commit()
    for n, why in removed:
        print(f"removed: {n} — {why}")
    print(f"{len(removed)} of {len(recs)} records removed as not direct assistance")


def cmd_ai_enrich_sites(a):
    """(AI) Add hours/eligibility/what-to-bring from providers' own websites to listings missing them."""
    from app.ingestion.base import Fetcher, load_source_configs
    from app.ingestion.pipeline import run_source
    from app.research.enrich_sites import enrich
    from app.services import ai

    if not ai.enabled():
        sys.exit("AI is not enabled (Admin → AI settings)")
    with _db() as db:
        stats = enrich(db, limit=a.limit, jurisdiction=a.jurisdiction)
        print(json.dumps(stats))
        run = run_source(db, load_source_configs()["ai-website-enrichment"], Fetcher())
        print(f"import: {run.status} {json.dumps({k: v for k, v in run.counts.items() if v and k != 'extra'})}")
        # Each record was built FROM one listing (external_id site-<id>), so link it to that listing directly.
        from app.ingestion.pipeline import attach_record_to_location
        from app.models import DuplicateCandidate, Location, SourceRecord

        linked = 0
        for rec in db.scalars(select(SourceRecord).where(SourceRecord.source_id == "ai-website-enrichment",
                                                         SourceRecord.status == "duplicate_candidate")).all():
            loc = db.get(Location, int(rec.external_id.split("-", 1)[1]))
            if not loc:
                continue
            for d in db.scalars(select(DuplicateCandidate).where(DuplicateCandidate.source_record_id == rec.id,
                                                                 DuplicateCandidate.status == "pending")).all():
                d.status = "merged" if d.location_id == loc.id else "distinct"
            attach_record_to_location(db, rec, loc, actor_label="ai:site-enrichment")
            linked += 1
        db.commit()
        print(f"linked {linked} records directly to their listings")


def cmd_ai_lookup_missing(a):
    """(AI) Cited web lookup for listings missing hours/eligibility; imports the cited facts as structured data."""
    from app.ingestion.base import Fetcher, load_source_configs
    from app.ingestion.pipeline import attach_record_to_location, run_source
    from app.models import DuplicateCandidate, Location, SourceRecord
    from app.research.enrich_sites import lookup_missing
    from app.services import ai

    if not ai.enabled():
        sys.exit("AI is not enabled (Admin → AI settings)")
    with _db() as db:
        print(json.dumps(lookup_missing(db, limit=a.limit, food_only=not a.all)))
        run = run_source(db, load_source_configs()["ai-listing-lookup"], Fetcher())
        print(f"import: {run.status} {json.dumps({k: v for k, v in run.counts.items() if v and k != 'extra'})}")
        for rec in db.scalars(select(SourceRecord).where(SourceRecord.source_id == "ai-listing-lookup",
                                                         SourceRecord.status == "duplicate_candidate")).all():
            loc = db.get(Location, int(rec.external_id.split("-", 1)[1]))
            if loc:
                for d in db.scalars(select(DuplicateCandidate).where(DuplicateCandidate.source_record_id == rec.id,
                                                                     DuplicateCandidate.status == "pending")).all():
                    d.status = "merged" if d.location_id == loc.id else "distinct"
                attach_record_to_location(db, rec, loc, actor_label="ai:listing-lookup")
        db.commit()


def cmd_export_snapshot(_a):
    """Write every imported record from republishable sources to data/snapshots/ (committed), so a fresh database
    can be rebuilt without re-scraping. Sources whose terms need permission (publication != permitted_with_attribution)
    are never written to the repository; `load-data --live-restricted` fetches them live instead."""
    from app.ingestion.base import load_source_configs
    from app.models import IngestionRun, SourceRecord

    configs = load_source_configs()
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    with _db() as db:
        order = {sid: i for i, sid in enumerate(dict.fromkeys(db.scalars(select(IngestionRun.source_id).order_by(IngestionRun.id)).all()))}
        for sid, cfg in sorted(configs.items(), key=lambda kv: order.get(kv[0], 10**6)):
            if cfg.is_synthetic or cfg.publication != "permitted_with_attribution":
                continue
            recs = db.scalars(select(SourceRecord).where(SourceRecord.source_id == sid, SourceRecord.status.notin_(("invalid", "rejected")))
                              .order_by(SourceRecord.id)).all()
            if not recs:
                continue
            out = SNAPSHOT_DIR / f"{sid}.json"
            out.write_text(json.dumps({"_notice": f"Snapshot of normalized records imported from source '{sid}' ({cfg.name}). "
                                       "Unverified candidates; see config/sources/ for attribution and terms.",
                                       "source_id": sid, "records": [r.normalized for r in recs]}, indent=1, ensure_ascii=False, default=str))
            manifest.append({"source_id": sid, "file": out.name, "records": len(recs), "order": len(manifest)})
    # Reviewer duplicate decisions, keyed by stable (source_id, external_id), so a rebuilt database reaches the same places.
    from app.models import DuplicateCandidate

    decisions = []
    with _db() as db:
        for d in db.scalars(select(DuplicateCandidate).where(DuplicateCandidate.status.in_(("merged", "distinct")),
                                                            DuplicateCandidate.source_record_id.isnot(None))).all():
            rec = db.get(SourceRecord, d.source_record_id)
            target = db.scalar(select(SourceRecord).where(SourceRecord.location_id == d.location_id, SourceRecord.id != rec.id)
                               .order_by(SourceRecord.id).limit(1)) if rec else None
            if rec and target and not rec.is_synthetic:
                decisions.append({"record": [rec.source_id, rec.external_id], "decision": d.status,
                                  "target": [target.source_id, target.external_id]})
    (SNAPSHOT_DIR / "duplicate_decisions.json").write_text(json.dumps(decisions, indent=1))
    (SNAPSHOT_DIR / "manifest.json").write_text(json.dumps({"exported_at": datetime.now(UTC).isoformat(), "sources": manifest}, indent=1))
    print(f"exported {sum(m['records'] for m in manifest)} records from {len(manifest)} sources to {SNAPSHOT_DIR}")


def _apply_duplicate_decisions(db) -> None:
    """Replay committed reviewer decisions on pending duplicate candidates (matched by stable source keys)."""
    from app.ingestion.verification.workflow import decide_duplicate
    from app.models import DuplicateCandidate, SourceRecord, User

    path = SNAPSHOT_DIR / "duplicate_decisions.json"
    if not path.exists():
        return
    actor = db.scalar(select(User).where(User.role == "admin").order_by(User.id).limit(1))
    if actor is None:  # decisions must be attributable; create a system reviewer account without a usable password
        from app.auth.security import hash_password
        import secrets as _s

        actor = User(email="snapshot-loader@lantern.invalid", password_hash=hash_password(_s.token_urlsafe(32)), role="admin", preferences={})
        db.add(actor)
        db.flush()
    key = lambda r: (r.source_id, r.external_id)  # noqa: E731
    recs = {key(r): r for r in db.scalars(select(SourceRecord)).all()}
    applied = 0
    for d in json.loads(path.read_text()):
        rec, target = recs.get(tuple(d["record"])), recs.get(tuple(d["target"]))
        if not rec or not target or target.location_id is None:
            continue
        pend = db.scalars(select(DuplicateCandidate).where(DuplicateCandidate.source_record_id == rec.id,
                                                           DuplicateCandidate.status == "pending")).all()
        match = next((p for p in pend if p.location_id == target.location_id), None)
        if match is None:
            continue
        decide_duplicate(db, match, actor, merge=d["decision"] == "merged", notes="Replayed reviewer decision from data/snapshots")
        applied += 1
    print(f"replayed {applied} duplicate decisions")


def cmd_load_data(a):
    """Rebuild listings from data/snapshots/ (idempotent: re-running changes nothing). Optionally fetch restricted
    sources live for local/internal review."""
    from app.ingestion.base import Fetcher, load_source_configs
    from app.ingestion.pipeline import run_source, sync_source_row
    from app.models import Location
    from app.services.registry import active_scope, sync_jurisdictions

    configs = load_source_configs()
    man = json.loads((SNAPSHOT_DIR / "manifest.json").read_text())
    with _db() as db:
        sync_jurisdictions(db)
        if a.if_empty and db.scalar(select(Location.id).where(Location.is_synthetic.is_(False)).limit(1)):
            print("database already has real listings; skipping (use without --if-empty to refresh)")
            return
        for m in sorted(man["sources"], key=lambda m: m["order"]):
            cfg = configs.get(m["source_id"])
            if not cfg:
                continue
            snap = cfg.model_copy(update={"adapter": "structured_json", "url": f"snapshot://{m['file']}", "request_urls": [], "options": {}})
            run = run_source(db, snap, Fetcher(fixtures={snap.url: SNAPSHOT_DIR / m["file"]}), scope=None)
            sync_source_row(db, cfg)  # keep the real adapter/config on the source row
            db.commit()
            print(f"{cfg.id}: {run.status} {run.counts.get('inserted')} new, {run.counts.get('unchanged')} unchanged")
        _apply_duplicate_decisions(db)
        for cfg in configs.values():
            if cfg.retracted:
                print(f"{cfg.id}: retracted — {_retract(db, cfg.id)} listings rebuilt without it")
        if a.live_restricted:
            for cfg in configs.values():
                if cfg.enabled and not cfg.is_synthetic and cfg.publication != "permitted_with_attribution":
                    r = run_source(db, cfg, Fetcher(), active_scope())
                    print(f"{cfg.id} (live, restricted — local review only): {r.status} {r.counts.get('inserted')} new")
    print("done")


def cmd_ai_discover(a):
    """AI web search for provider pages in an area; adds new URLs to config/sources/ai-web-pages.yaml for review."""
    import yaml

    from app.services import ai

    if not ai.enabled():
        sys.exit("AI is not enabled (Admin → AI settings)")
    try:
        leads = ai.discover_leads(a.area, a.topic, max_searches=a.searches)
    except ai.AIUnavailable as e:
        sys.exit(str(e))
    p = get_settings().config_dir / "sources" / "ai-web-pages.yaml"
    cfg = yaml.safe_load(p.read_text())
    have = set(cfg.get("request_urls") or [])
    new = [x for x in leads if x["url"] not in have]
    cfg["request_urls"] = sorted(have | {x["url"] for x in new})
    p.write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True))
    for x in leads:
        print(("NEW  " if x in new else "seen ") + f"{x['url']}  {x['name']}")
    print(f"{len(new)} new page(s) queued. Review {p.name}, then: lantern ingest --source ai-web-pages --geocode")


def cmd_ai_usage(_a):
    from sqlalchemy import func

    from app.models import AIUsage
    from app.services import ai

    with _db() as db:
        rows = db.execute(select(AIUsage.feature, func.count(), func.sum(AIUsage.cost_usd), func.sum(AIUsage.input_tokens),
                                 func.sum(AIUsage.output_tokens)).group_by(AIUsage.feature)).all()
    for f, n, c, i, o in rows:
        print(f"{f:12s} calls={n:4d} tokens_in={i or 0:8d} out={o or 0:7d} cost=${c or 0:.4f}")
    print(f"this month: ${ai.month_spend():.4f} of ${ai.runtime()['monthly_budget_usd']:.2f} budget")


def cmd_evaluate(a):
    from app.research.evaluation import run_pilot_evaluation

    print(run_pilot_evaluation())


def cmd_import_transit(_a):
    from app.research.transit import import_transit

    print(json.dumps(import_transit()))


def cmd_import_reference(_a):
    from app.research.reference import import_reference_data

    print(json.dumps(import_reference_data(), indent=2))


def main(argv=None):
    p = argparse.ArgumentParser(prog="lantern", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate", help="apply database migrations").set_defaults(fn=cmd_migrate)
    sub.add_parser("bootstrap", help="migrate + sync jurisdiction/source registries (idempotent)").set_defaults(fn=cmd_bootstrap)
    sub.add_parser("sync-registry", help="re-read config/jurisdictions, config/pilot.yaml, config/sources").set_defaults(fn=cmd_sync_registry)
    sub.add_parser("import-transit", help="download Metro/VRE/bus stops for 'Getting there' (Open Data DC, CC BY 4.0)").set_defaults(fn=cmd_import_transit)
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
    d.add_argument("--pantry-email", help="also create a demo pantry-staff account with live shelf posts (needs FOODACCESS_DEMO_PASSWORD)")
    d.set_defaults(fn=cmd_demo)
    vs = sub.add_parser("verify-source", help="record a named admin's verification of the listings backed by one source")
    vs.add_argument("--source", required=True)
    vs.add_argument("--reviewer-email", required=True)
    vs.add_argument("--method", required=True, choices=VERIFICATION_METHODS)
    vs.add_argument("--notes", required=True, help="what was checked, against what, and when")
    vs.add_argument("--publish", action="store_true", help="also publish (same gates as the admin UI)")
    vs.set_defaults(fn=cmd_verify_source)
    tr = sub.add_parser("translate", help="machine-translate external descriptions (self-hosted provider)")
    tr.add_argument("--lang", default="es")
    tr.add_argument("--limit", type=int, default=200)
    tr.set_defaults(fn=cmd_translate)
    sub.add_parser("evaluate-pilot", help="write the pilot evaluation report").set_defaults(fn=cmd_evaluate)
    dsc = sub.add_parser("ai-discover", help="(AI) web-search for provider pages in an area and queue them for extraction")
    dsc.add_argument("area")
    dsc.add_argument("topic")
    dsc.add_argument("--searches", type=int, default=2, help="max web searches (each ~1 cent)")
    dsc.set_defaults(fn=cmd_ai_discover)
    sub.add_parser("ai-usage", help="(AI) spend by feature and this month's total vs budget").set_defaults(fn=cmd_ai_usage)
    rs = sub.add_parser("retract-source", help="withdraw a source's data (reject its records, rebuild listings)")
    rs.add_argument("source_id")
    rs.set_defaults(fn=cmd_retract_source)
    lm = sub.add_parser("ai-lookup-missing", help="(AI) cited web lookup for listings missing hours/eligibility")
    lm.add_argument("--limit", type=int, default=50)
    lm.add_argument("--all", action="store_true", help="include non-food services (default: food listings only)")
    lm.set_defaults(fn=cmd_ai_lookup_missing)
    es = sub.add_parser("ai-enrich-sites", help="(AI) fill hours/eligibility/what-to-bring from providers' own websites")
    es.add_argument("--limit", type=int, default=50)
    es.add_argument("--jurisdiction")
    es.set_defaults(fn=cmd_ai_enrich_sites)
    sub.add_parser("ai-check-categories", help="(AI) remove categories a listing clearly does not offer (never adds)").set_defaults(fn=cmd_ai_check_categories)
    sub.add_parser("rebuild-rejected", help="remove services that came only from rejected source records").set_defaults(fn=cmd_rebuild_rejected)
    rl = sub.add_parser("ai-relevance", help="(AI) remove imported listings that are not direct-assistance services")
    rl.add_argument("--source", required=True)
    rl.set_defaults(fn=cmd_ai_relevance)
    rd = sub.add_parser("ai-resolve-duplicates", help="(AI) triage pending duplicate candidates; 'unsure' stays for a person")
    rd.add_argument("--reviewer-email", required=True)
    rd.add_argument("--limit", type=int, default=500)
    rd.set_defaults(fn=cmd_ai_resolve_duplicates)
    sub.add_parser("export-snapshot", help="write imported republishable records to data/snapshots/ (commit these)").set_defaults(fn=cmd_export_snapshot)
    ld = sub.add_parser("load-data", help="rebuild listings from data/snapshots/ (no scraping needed)")
    ld.add_argument("--if-empty", action="store_true", help="only load when the database has no real listings yet")
    ld.add_argument("--live-restricted", action="store_true", help="also fetch permission-required sources live (local review only)")
    ld.set_defaults(fn=cmd_load_data)
    ais = sub.add_parser("ai-suggest", help="(optional, Claude) queue AI-structured hours suggestions for review")
    ais.add_argument("--limit", type=int, default=25)
    ais.set_defaults(fn=cmd_ai_suggest)
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
