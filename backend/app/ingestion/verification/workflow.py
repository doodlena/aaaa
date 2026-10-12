"""Manual verification workflow: Candidate → Needs Review → Verified → Published (+ rejected/stale/closed).

Every state change is made by an identified reviewer and recorded in verification_records + audit_log.
"""
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.ingestion.candidate import MATERIAL_FIELDS
from app.models import (
    AuditLog,
    ChangeProposal,
    DuplicateCandidate,
    Location,
    Organization,
    SourceRecord,
    User,
    VerificationRecord,
)
from app.services.resource_writer import coords_of, replace_structures, set_coords, structures_of


def snapshot(loc: Location) -> dict:
    return {
        "name": loc.name, "organization": loc.organization.name, "address1": loc.address1, "city": loc.city, "zip": loc.zip,
        "phone": loc.phone, "website": loc.website, "operating_status": loc.operating_status, "review_status": loc.review_status,
        "published": loc.published, "coordinates": coords_of(loc), **structures_of(loc),
    }


def audit(db: Session, actor: User | None, entity_type: str, entity_id: int, action: str, before=None, after=None,
          label: str | None = None) -> None:
    db.add(AuditLog(actor_id=actor.id if actor else None, actor_label=label or (f"user:{actor.id}" if actor else "system"),
                    entity_type=entity_type, entity_id=entity_id, action=action, before=before, after=after))


def has_source_attribution(db: Session, loc: Location) -> bool:
    return db.scalar(select(SourceRecord.id).where(SourceRecord.location_id == loc.id).limit(1)) is not None


DIRECT_METHODS = ("phone", "email", "in_person", "provider_submission")


def publication_allowed(db: Session, loc: Location) -> bool:
    """Publishable if a linked source permits republication with attribution, or the latest verification was made
    directly with the provider (then the published facts are the provider's, not a copy of a restricted dataset)."""
    from app.models import Source

    pubs = db.scalars(select(Source.config).join(SourceRecord, SourceRecord.source_id == Source.id)
                      .where(SourceRecord.location_id == loc.id)).all()
    if loc.is_synthetic or any((c or {}).get("publication") == "permitted_with_attribution" for c in pubs):
        return True
    last = db.scalar(select(VerificationRecord).where(VerificationRecord.location_id == loc.id, VerificationRecord.action == "verify")
                     .order_by(VerificationRecord.created_at.desc()).limit(1))
    return bool(last and last.method in DIRECT_METHODS)


def apply_action(db: Session, loc: Location, user: User, action: str, method: str = "none", notes: str | None = None) -> Location:
    now = datetime.now(UTC)
    before = {"review_status": loc.review_status, "published": loc.published, "operating_status": loc.operating_status}
    if action == "verify":
        if method == "none":
            raise HTTPException(422, "Verification requires a method (phone, email, website, in_person, official_source, provider_submission)")
        if loc.review_status == "rejected":
            raise HTTPException(409, "Reopen a rejected resource before verifying it")
        pending = db.scalar(select(ChangeProposal.id).where(ChangeProposal.location_id == loc.id, ChangeProposal.status == "pending").limit(1))
        if pending:
            raise HTTPException(409, "Resolve pending source changes before verifying")
        loc.review_status = "verified"
        loc.last_verified_at = now
    elif action == "publish":
        if loc.review_status not in ("verified", "stale"):
            raise HTTPException(409, "Only verified resources can be published")
        if loc.geom is None:
            raise HTTPException(409, "A resource needs map coordinates before publishing")
        if not has_source_attribution(db, loc):
            raise HTTPException(409, "A resource needs at least one source record before publishing")
        if not publication_allowed(db, loc):
            raise HTTPException(409, "Its sources do not permit republication. Verify directly with the provider "
                                     "(phone, email, in person, or provider submission) before publishing.")
        if loc.is_synthetic and get_settings().environment == "production":
            raise HTTPException(409, "Synthetic fixtures can never be published in production")
        loc.published = True
    elif action == "unpublish":
        loc.published = False
    elif action == "reject":
        loc.review_status = "rejected"
        loc.published = False
    elif action == "flag":
        loc.review_status = "needs_review"
    elif action == "close_temporary":
        loc.operating_status = "temporarily_closed"
    elif action == "close_permanent":
        loc.operating_status = "permanently_closed"
        loc.published = False
    elif action == "reopen":
        if loc.review_status == "rejected":
            loc.review_status = "needs_review"
        if loc.operating_status in ("temporarily_closed", "permanently_closed"):
            loc.operating_status = "open"
    else:
        raise HTTPException(422, f"Unknown action {action}")
    loc.last_reviewed_at = now
    db.add(VerificationRecord(location_id=loc.id, reviewer_id=user.id, action=action, method=method, notes=notes, snapshot=snapshot(loc)))
    audit(db, user, "location", loc.id, action, before,
          {"review_status": loc.review_status, "published": loc.published, "operating_status": loc.operating_status})
    db.commit()
    return loc


EDITABLE = ("name", "address1", "address2", "city", "zip", "jurisdiction_id", "phone", "email", "website", "registration_url",
            "operating_status", "wheelchair_accessible", "accessibility_notes", "parking_notes", "transit_notes", "entrance_notes",
            "languages", "notes")


def edit_with_payload(db: Session, loc: Location, user: User, body) -> Location:
    before = snapshot(loc)
    data = body.model_dump(exclude_unset=True)
    for f in EDITABLE:
        if f in data:
            setattr(loc, f, data[f])
    if "organization_name" in data and data["organization_name"]:
        loc.organization.name = data["organization_name"]
    if "organization_website" in data:
        loc.organization.website = data["organization_website"]
    if "lat" in data or "lon" in data:
        set_coords(loc, data.get("lat"), data.get("lon"), "manual")
    services = None
    if body.services is not None:
        services = [s.model_dump() for s in body.services]
        for s in services:
            s["schedules"], s["eligibility"] = [], []
    loc_sched = loc_elig = None
    if body.schedules is not None:
        loc_sched = []
        for sch in body.schedules:
            d = sch.model_dump()
            idx = d.pop("service_index")
            if idx is not None and services is not None and 0 <= idx < len(services):
                services[idx]["schedules"].append(d)
            else:
                loc_sched.append(d)
    if body.eligibility is not None:
        loc_elig = []
        for el in body.eligibility:
            d = el.model_dump()
            idx = d.pop("service_index")
            if idx is not None and services is not None and 0 <= idx < len(services):
                services[idx]["eligibility"].append(d)
            else:
                loc_elig.append(d)
    replace_structures(db, loc, services, loc_sched, loc_elig)
    db.flush()
    db.refresh(loc)
    loc.last_reviewed_at = datetime.now(UTC)
    after = snapshot(loc)
    db.add(VerificationRecord(location_id=loc.id, reviewer_id=user.id, action="edit", method="none", notes=body.edit_notes, snapshot=after))
    audit(db, user, "location", loc.id, "edit", before, after)
    db.commit()
    return loc


def decide_change(db: Session, cp: ChangeProposal, user: User, accept: bool, notes: str | None = None) -> None:
    if cp.status != "pending":
        raise HTTPException(409, "This change has already been decided")
    loc = db.get(Location, cp.location_id)
    now = datetime.now(UTC)
    if accept:
        v = cp.proposed_value
        if cp.field == "coordinates":
            set_coords(loc, v and v.get("lat"), v and v.get("lon"), "source")
        elif cp.field == "services":
            replace_structures(db, loc, v, None, None, cp.source_record_id)
        elif cp.field == "schedules":
            replace_structures(db, loc, None, v, None, cp.source_record_id)
        elif cp.field == "eligibility":
            replace_structures(db, loc, None, None, v, cp.source_record_id)
        elif cp.field == "organization_website":
            loc.organization.website = v
        else:
            setattr(loc, cp.field, v)
    cp.status = "accepted" if accept else "rejected"
    cp.decided_by_id, cp.decided_at = user.id, now
    audit(db, user, "change_proposal", cp.id, cp.status, {"field": cp.field, "value": cp.current_value},
          {"field": cp.field, "value": cp.proposed_value, "notes": notes})
    loc.last_reviewed_at = now
    db.commit()


def merge_locations(db: Session, keep: Location, drop: Location, user: User) -> None:
    """Merge `drop` into `keep`: re-point source records, hide `drop`. Keep's verified data is untouched."""
    db.execute(update(SourceRecord).where(SourceRecord.location_id == drop.id).values(location_id=keep.id, status="linked"))
    # Saved places are encrypted per account and follow merged_into_id when read (api/accounts.py).
    drop.merged_into_id = keep.id
    drop.published = False
    drop.review_status = "rejected"
    audit(db, user, "location", drop.id, "merged_into", None, {"keep": keep.id})
    db.add(VerificationRecord(location_id=keep.id, reviewer_id=user.id, action="merge", method="none",
                              notes=f"Merged location {drop.id} into {keep.id}", snapshot=snapshot(keep)))


def decide_duplicate(db: Session, dup: DuplicateCandidate, user: User, merge: bool, notes: str | None = None) -> None:
    from app.ingestion.pipeline import attach_record_to_location, create_location_from_record

    if dup.status != "pending":
        raise HTTPException(409, "This duplicate candidate has already been decided")
    now = datetime.now(UTC)
    keep = db.get(Location, dup.location_id)
    if dup.other_location_id:
        other = db.get(Location, dup.other_location_id)
        if merge:
            merge_locations(db, keep, other, user)
    elif dup.source_record_id:
        rec = db.get(SourceRecord, dup.source_record_id)
        if merge:
            attach_record_to_location(db, rec, keep, actor_label=f"user:{user.id}")
        else:
            others = db.scalar(select(DuplicateCandidate.id).where(DuplicateCandidate.source_record_id == rec.id,
                                                                     DuplicateCandidate.status == "pending",
                                                                     DuplicateCandidate.id != dup.id).limit(1))
            if not others and rec.location_id is None:
                create_location_from_record(db, rec)
    dup.status = "merged" if merge else "distinct"
    dup.decided_by_id, dup.decided_at = user.id, now
    audit(db, user, "duplicate_candidate", dup.id, dup.status, None, {"notes": notes})
    db.commit()


def mark_stale(db: Session, now: datetime | None = None) -> int:
    """Verified listings past the freshness threshold become 'stale' (still public, labelled) and re-enter review."""
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(days=get_settings().verification_fresh_days)
    rows = db.scalars(select(Location).where(Location.review_status == "verified", Location.last_verified_at < cutoff)).all()
    for loc in rows:
        loc.review_status = "stale"
        audit(db, None, "location", loc.id, "marked_stale", None, {"last_verified_at": loc.last_verified_at.isoformat()},
              label="system:freshness")
    db.commit()
    return len(rows)


def needs_review_after_change(loc: Location, fields: set[str]) -> bool:
    return loc.review_status in ("verified", "stale") and bool(fields & MATERIAL_FIELDS)


__all__ = ["apply_action", "edit_with_payload", "decide_change", "decide_duplicate", "mark_stale", "Organization"]
