"""Administrator API. Every route requires role=admin (server-side) and, for writes, a valid CSRF token."""
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.public import load_location, location_sources, location_translations
from app.auth.security import require_admin
from app.config import get_settings
from app.db import get_db
from app.ingestion.verification.workflow import apply_action, decide_change, decide_duplicate, edit_with_payload
from app.models import (
    AuditLog,
    ChangeProposal,
    DuplicateCandidate,
    FieldProvenance,
    IngestionRun,
    Location,
    Organization,
    Source,
    SourceRecord,
    User,
    VerificationRecord,
)
from app.schemas import ActionIn, DecisionIn, ResourceEditIn
from app.services.presenter import detail, verification_label
from app.services.quality import quality_report
from app.vocab import REVIEW_STATUSES

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _iso(dt):
    return dt.isoformat() if dt else None


@router.get("/queue")
def queue(
    db: Session = Depends(get_db),
    status: str | None = Query(None),
    jurisdiction: str | None = None,
    q: str | None = Query(None, max_length=100),
    published: bool | None = None,
    stale_only: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    if status and status not in REVIEW_STATUSES:
        raise HTTPException(422, "unknown status")
    conds = [Location.merged_into_id.is_(None)]
    if status:
        conds.append(Location.review_status == status)
    if jurisdiction:
        conds.append(Location.jurisdiction_id == jurisdiction)
    if published is not None:
        conds.append(Location.published.is_(published))
    if q:
        like = f"%{q.lower()}%"
        conds.append(or_(func.lower(Location.name).like(like), func.lower(Location.address1).like(like)))
    if stale_only:
        cutoff = datetime.now(UTC) - timedelta(days=get_settings().verification_fresh_days)
        conds.append(or_(Location.review_status == "stale",
                         (Location.review_status == "verified") & (Location.last_verified_at < cutoff)))
    total = db.scalar(select(func.count()).select_from(Location).where(*conds))
    locs = db.scalars(select(Location).where(*conds).order_by(Location.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    ids = [loc.id for loc in locs]
    pc = dict(db.execute(select(ChangeProposal.location_id, func.count()).where(ChangeProposal.location_id.in_(ids),
                                                                               ChangeProposal.status == "pending").group_by(ChangeProposal.location_id)).all())
    dc = dict(db.execute(select(DuplicateCandidate.location_id, func.count()).where(DuplicateCandidate.location_id.in_(ids),
                                                                                   DuplicateCandidate.status == "pending").group_by(DuplicateCandidate.location_id)).all())
    srcs: dict[int, list[str]] = {}
    for lid, sid in db.execute(select(SourceRecord.location_id, SourceRecord.source_id).where(SourceRecord.location_id.in_(ids))).all():
        srcs.setdefault(lid, []).append(sid)
    counts = dict(db.execute(select(Location.review_status, func.count()).where(Location.merged_into_id.is_(None)).group_by(Location.review_status)).all())
    return {
        "items": [{
            "id": loc.id, "name": loc.name, "organization_name": loc.organization.name, "address1": loc.address1, "city": loc.city,
            "zip": loc.zip, "jurisdiction_id": loc.jurisdiction_id, "review_status": loc.review_status,
            "verification_label": verification_label(loc), "published": loc.published, "operating_status": loc.operating_status,
            "has_coordinates": loc.geom is not None, "last_seen_at": _iso(loc.last_seen_at), "last_verified_at": _iso(loc.last_verified_at),
            "sources": sorted(set(srcs.get(loc.id, []))), "pending_changes": pc.get(loc.id, 0), "pending_duplicates": dc.get(loc.id, 0),
            "is_synthetic": loc.is_synthetic,
        } for loc in locs],
        "total": total, "page": page, "page_size": page_size, "counts_by_status": counts,
    }


@router.get("/resources/{location_id}")
def resource_review(location_id: int, db: Session = Depends(get_db)):
    loc = load_location(db, location_id, public=False)
    out = detail(loc, location_sources(db, loc.id), location_translations(db, loc, "es"))
    out["review_status"] = loc.review_status
    out["published"] = loc.published
    out["merged_into_id"] = loc.merged_into_id
    out["raw_hours_text"] = None
    recs = db.execute(select(SourceRecord, Source).join(Source).where(SourceRecord.location_id == loc.id)).all()
    out["source_records"] = [{
        "id": r.id, "source_id": s.id, "source_name": s.name, "source_url": r.source_url or s.url, "external_id": r.external_id,
        "status": r.status, "raw": r.raw, "normalized": r.normalized, "validation": r.validation,
        "first_seen_at": _iso(r.first_seen_at), "last_seen_at": _iso(r.last_seen_at), "is_synthetic": r.is_synthetic,
    } for r, s in recs]
    out["change_proposals"] = [_cp(c) for c in db.scalars(select(ChangeProposal).where(ChangeProposal.location_id == loc.id)
                                                           .order_by(ChangeProposal.created_at.desc())).all()]
    out["duplicates"] = [_dup(db, d) for d in db.scalars(select(DuplicateCandidate).where(
        or_(DuplicateCandidate.location_id == loc.id, DuplicateCandidate.other_location_id == loc.id))).all()]
    out["verification_history"] = [{
        "id": v.id, "action": v.action, "method": v.method, "notes": v.notes, "created_at": _iso(v.created_at),
        "reviewer": db.get(User, v.reviewer_id).email, "snapshot": v.snapshot,
    } for v in db.scalars(select(VerificationRecord).where(VerificationRecord.location_id == loc.id).order_by(VerificationRecord.created_at.desc())).all()]
    out["audit"] = [{"action": a.action, "actor": a.actor_label, "at": _iso(a.at), "before": a.before, "after": a.after}
                    for a in db.scalars(select(AuditLog).where(AuditLog.entity_type == "location", AuditLog.entity_id == loc.id)
                                        .order_by(AuditLog.at.desc()).limit(100)).all()]
    out["field_provenance"] = [{"field": f.field, "value": f.value, "source_record_id": f.source_record_id, "observed_at": _iso(f.observed_at)}
                               for f in db.scalars(select(FieldProvenance).where(FieldProvenance.location_id == loc.id)).all()]
    return out


def _cp(c: ChangeProposal) -> dict:
    return {"id": c.id, "location_id": c.location_id, "field": c.field, "current_value": c.current_value, "proposed_value": c.proposed_value,
            "source_record_id": c.source_record_id, "status": c.status, "created_at": _iso(c.created_at), "decided_at": _iso(c.decided_at)}


def _dup(db: Session, d: DuplicateCandidate) -> dict:
    rec = db.get(SourceRecord, d.source_record_id) if d.source_record_id else None
    loc = db.get(Location, d.location_id)
    return {"id": d.id, "location_id": d.location_id, "location_name": loc.name, "location_address": loc.address1,
            "other_location_id": d.other_location_id, "source_record_id": d.source_record_id,
            "incoming": rec.normalized if rec else None, "incoming_source": rec.source_id if rec else None,
            "score": round(d.score, 2), "reasons": d.reasons, "status": d.status, "created_at": _iso(d.created_at)}


@router.patch("/resources/{location_id}")
def edit_resource(location_id: int, body: ResourceEditIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    loc = load_location(db, location_id, public=False)
    edit_with_payload(db, loc, user, body)
    return resource_review(location_id, db)


@router.post("/resources/{location_id}/actions")
def resource_action(location_id: int, body: ActionIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    loc = load_location(db, location_id, public=False)
    apply_action(db, loc, user, body.action, body.method, body.notes)
    return {"id": loc.id, "review_status": loc.review_status, "published": loc.published, "operating_status": loc.operating_status}


@router.get("/changes")
def list_changes(status: str = "pending", db: Session = Depends(get_db)):
    return {"items": [_cp(c) for c in db.scalars(select(ChangeProposal).where(ChangeProposal.status == status)
                                                 .order_by(ChangeProposal.created_at.desc()).limit(500)).all()]}


@router.post("/changes/{change_id}/decision")
def change_decision(change_id: int, body: DecisionIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    cp = db.get(ChangeProposal, change_id)
    if not cp:
        raise HTTPException(404, "Change not found")
    if body.decision not in ("accept", "reject"):
        raise HTTPException(422, "decision must be accept or reject")
    decide_change(db, cp, user, body.decision == "accept", body.notes)
    return _cp(cp)


@router.get("/duplicates")
def list_duplicates(status: str = "pending", db: Session = Depends(get_db)):
    return {"items": [_dup(db, d) for d in db.scalars(select(DuplicateCandidate).where(DuplicateCandidate.status == status)
                                                      .order_by(DuplicateCandidate.score.desc()).limit(500)).all()]}


@router.post("/duplicates/{dup_id}/decision")
def duplicate_decision(dup_id: int, body: DecisionIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    d = db.get(DuplicateCandidate, dup_id)
    if not d:
        raise HTTPException(404, "Duplicate candidate not found")
    if body.decision not in ("merge", "distinct"):
        raise HTTPException(422, "decision must be merge or distinct")
    decide_duplicate(db, d, user, body.decision == "merge", body.notes)
    return _dup(db, d)


@router.get("/ingestion/runs")
def ingestion_runs(source: str | None = None, limit: int = Query(50, le=500), db: Session = Depends(get_db)):
    q = select(IngestionRun).order_by(IngestionRun.id.desc()).limit(limit)
    if source:
        q = q.where(IngestionRun.source_id == source)
    return {"items": [{"id": r.id, "source_id": r.source_id, "status": r.status, "started_at": _iso(r.started_at),
                       "finished_at": _iso(r.finished_at), "counts": r.counts, "errors": r.errors[:20]} for r in db.scalars(q).all()]}


@router.get("/sources")
def sources(db: Session = Depends(get_db)):
    return {"items": [{"id": s.id, "name": s.name, "url": s.url, "owner": s.owner, "adapter": s.adapter, "jurisdictions": s.jurisdictions,
                       "enabled": s.enabled, "last_success_at": _iso(s.last_success_at), "last_attempt_at": _iso(s.last_attempt_at),
                       "last_error": s.last_error, "known_limitations": (s.config or {}).get("known_limitations", []),
                       "is_synthetic": (s.config or {}).get("is_synthetic", False)}
                      for s in db.scalars(select(Source).order_by(Source.id)).all()]}


@router.get("/quality")
def quality(jurisdiction: str | None = None, db: Session = Depends(get_db)):
    return quality_report(db, jurisdiction)


@router.get("/organizations/{org_id}")
def organization(org_id: int, db: Session = Depends(get_db)):
    o = db.get(Organization, org_id)
    if not o:
        raise HTTPException(404, "Organization not found")
    return {"id": o.id, "name": o.name, "website": o.website, "locations": [{"id": loc.id, "name": loc.name} for loc in o.locations]}
