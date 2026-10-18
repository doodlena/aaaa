"""Demo mode: fictional providers for demo videos and live demos (Admin → Site settings → Demo mode).

The providers come from data/fixtures/demo_providers.json (source `demo-providers`, all `is_synthetic`). Loading them
is idempotent. While demo mode is on, the public site shows only the published demo listings (all verified) with
today's provider posts, and the admin dashboard counts and queues only demo data; real listings are hidden, never
changed. Turning demo mode off hides the demo data again.
"""
import hashlib
import json
import secrets
from datetime import UTC, datetime, time, timedelta

from sqlalchemy import exists, not_, select
from sqlalchemy.orm import Session

from app.auth.security import hash_password
from app.config import REPO_ROOT
from app.ingestion.base import load_source_configs
from app.ingestion.candidate import CandidateResource
from app.ingestion.pipeline import assign_jurisdiction, create_location_from_record, sync_source_row
from app.ingestion.verification.workflow import audit
from app.models import (ChangeProposal, CommunityReport, DistributionEvent, Location, ProviderMembership, ShelfUpdate,
                        SourceRecord, User, VerificationRecord)
from app.services import site_flags
from app.services.schedule import TZ
from app.services.shelf import end_of_local_day

DEMO_SOURCE = "demo-providers"
FIXTURE = REPO_ROOT / "data" / "fixtures" / "demo_providers.json"
DEMO_NOTE = "Demo data (fictional provider)"

# Admin-side demo content: provider access requests, community reports and a provider-proposed change.
DEMO_CLAIMS = [("jrivera@example.org", "demo-001", "Pantry coordinator", "Call the pantry line and ask for Jordan."),
               ("pastor.kim@example.org", "demo-007", "Volunteer lead", "I run Thursday distributions."),
               ("ops@example.org", "demo-011", "Operations manager", "Office phone is on the listing.")]
DEMO_REPORTS = [("demo-005", "wrong_info", "The truck was at the library lot, not Duke St."),
                ("demo-011", "out_of_food", "Out of frozen food by 11am."),
                ("demo-004", "other", "Could you add Saturday hours?")]
DEMO_PHONE_CHANGE = ("demo-009", "(703) 555-0129")


def demo_location_ids():
    return select(SourceRecord.location_id).where(SourceRecord.source_id == DEMO_SOURCE, SourceRecord.location_id.isnot(None))


def is_demo_location():
    """SQL condition: the location came from the demo fixture."""
    return Location.id.in_(demo_location_ids())


def demo_mode_on() -> bool:
    return site_flags.demo_mode()


def admin_scope():
    """What the admin dashboard works on: only demo listings in demo mode, everything except them otherwise."""
    return is_demo_location() if site_flags.demo_mode() else not_(is_demo_location())


def _records() -> list[dict]:
    return json.loads(FIXTURE.read_text())["records"]


def _by_external_id(db: Session) -> dict[str, Location]:
    rows = db.execute(select(SourceRecord.external_id, Location).join(Location, Location.id == SourceRecord.location_id)
                      .where(SourceRecord.source_id == DEMO_SOURCE)).all()
    return {ext: loc for ext, loc in rows}


def load(db: Session, admin: User) -> int:
    """Create any missing demo listings (and their admin queue items). Returns how many listings were created."""
    cfg = load_source_configs()[DEMO_SOURCE]
    sync_source_row(db, cfg)
    existing = _by_external_id(db)
    now = datetime.now(UTC)
    created = 0
    for i, raw in enumerate(_records()):
        if raw["external_id"] in existing:
            continue
        demo = raw.get("demo") or {}
        c = CandidateResource(**{k: v for k, v in raw.items() if k != "demo"})
        c.jurisdiction_id = assign_jurisdiction(db, c, cfg)
        normalized = c.model_dump(mode="json")
        rec = SourceRecord(source_id=DEMO_SOURCE, external_id=c.external_id, source_url=None, is_synthetic=True,
                           raw_hash=hashlib.sha256(json.dumps(normalized, sort_keys=True).encode()).hexdigest(),
                           normalized=normalized, validation=[], status="new", last_seen_at=now, last_changed_at=now)
        db.add(rec)
        db.flush()
        loc = create_location_from_record(db, rec)
        loc.operating_status = c.operating_status
        if demo.get("status") == "verified":
            # Spread the demo verifications over the last 8 weeks so the dashboard's weekly chart has a shape.
            at = now - timedelta(days=(i * 3) % 54 + 1, hours=i % 7)
            method = ("phone", "provider_submission", "in_person", "email")[i % 4]
            db.add(VerificationRecord(location_id=loc.id, reviewer_id=admin.id, action="verify", method=method, notes=DEMO_NOTE, created_at=at))
            db.add(VerificationRecord(location_id=loc.id, reviewer_id=admin.id, action="publish", method="none", notes=DEMO_NOTE,
                                      created_at=at + timedelta(minutes=5)))
            loc.review_status, loc.published = "verified", True
            loc.last_verified_at = loc.last_reviewed_at = at
        existing[c.external_id] = loc
        created += 1
    db.flush()
    if created:
        _load_admin_items(db, existing, admin)
        audit(db, admin, "app_setting", 0, "demo_data_loaded", None, {"listings": created})
    db.commit()
    return created


def _load_admin_items(db: Session, locs: dict[str, Location], admin: User) -> None:
    for email, ext, role, note in DEMO_CLAIMS:
        user = db.scalar(select(User).where(User.email == email))
        if not user:
            user = User(email=email, role="user", preferences={}, password_hash=hash_password(secrets.token_urlsafe(24)))
            db.add(user)
            db.flush()
        if ext in locs and not db.scalar(select(ProviderMembership.id).where(ProviderMembership.user_id == user.id,
                                                                            ProviderMembership.location_id == locs[ext].id)):
            db.add(ProviderMembership(user_id=user.id, location_id=locs[ext].id, role_title=role, note=note, status="pending"))
    for ext, kind, note in DEMO_REPORTS:
        if ext in locs:
            db.add(CommunityReport(location_id=locs[ext].id, kind=kind, note=note))
    ext, phone = DEMO_PHONE_CHANGE
    if ext in locs:
        db.add(ChangeProposal(location_id=locs[ext].id, field="phone", current_value=locs[ext].phone, proposed_value=phone,
                              origin="provider", submitted_by_id=admin.id))


_live_day = None  # local date the demo posts were last confirmed current (per process)


def ensure_live(db: Session, now: datetime | None = None) -> None:
    """In demo mode, make sure today's demo provider posts and upcoming demo events exist (they expire daily)."""
    global _live_day
    if not site_flags.demo_mode():
        return
    now = now or datetime.now(UTC)
    local = now.astimezone(TZ)
    if _live_day == local.date():
        return
    locs = _by_external_id(db)
    if not locs:
        return
    ids = [loc.id for loc in locs.values()]
    poster = db.scalar(select(User.id).where(User.role == "admin").order_by(User.id).limit(1))
    if poster is None:
        return
    has_posts = db.scalar(select(exists().where(ShelfUpdate.location_id.in_(ids), ShelfUpdate.is_synthetic.is_(True),
                                                ShelfUpdate.retracted.is_(False), ShelfUpdate.expires_at > now)))
    minutes_today = max(1, int((local - local.replace(hour=0, minute=0, second=0, microsecond=0)).total_seconds() // 60) - 1)
    for raw in _records():
        loc = locs.get(raw["external_id"])
        demo = raw.get("demo") or {}
        if not loc:
            continue
        live = demo.get("live")
        if live and not has_posts:
            db.add(ShelfUpdate(location_id=loc.id, posted_by_id=poster, status=live["status"], message=live["message"],
                               items=[{"food_type": f, "level": lvl} for f, lvl in live["items"]],
                               posted_at=now - timedelta(minutes=min(live["minutes_ago"], minutes_today)),
                               expires_at=end_of_local_day(now), is_synthetic=True))
        for ev in demo.get("events", []):
            upcoming = db.scalar(select(DistributionEvent.id).where(DistributionEvent.location_id == loc.id, DistributionEvent.title == ev["title"],
                                                                   DistributionEvent.starts_at > now).limit(1))
            if upcoming:
                continue
            day = local.date() + timedelta(days=ev["day_offset"])
            start = datetime.combine(day, time.fromisoformat(ev["opens"]), tzinfo=TZ)
            end = datetime.combine(day, time.fromisoformat(ev["closes"]), tzinfo=TZ)
            db.add(DistributionEvent(location_id=loc.id, title=ev["title"], starts_at=start, ends_at=end, notes=ev.get("notes"),
                                     appointment_required="not_required", status="scheduled", posted_by_id=poster))
    db.commit()
    _live_day = local.date()


def reset_live_cache() -> None:
    global _live_day
    _live_day = None
