"""Administrator API. Every route requires role=admin (server-side) and, for writes, a valid CSRF token."""
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Integer, func, or_, select
from sqlalchemy.orm import Session

from app.api.public import load_location, location_sources, location_translations
from app.auth.security import require_admin
from app.config import get_settings
from app.db import get_db
from app.ingestion.verification.workflow import apply_action, decide_change, decide_duplicate, edit_with_payload
from app.models import (
    AuditLog,
    CommunityReport,
    ProviderMembership,
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
from app.schemas import ActionIn, AIKeyIn, AISettingsIn, DecisionIn, DecisionSimpleIn, ResourceEditIn
from app.services.presenter import detail, verification_label
from app.services import ai
from app.services.quality import quality_report
from app.services.shelf import open_report_counts
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
    rc = open_report_counts(db, ids)
    counts = dict(db.execute(select(Location.review_status, func.count()).where(Location.merged_into_id.is_(None)).group_by(Location.review_status)).all())
    return {
        "items": [{
            "id": loc.id, "name": loc.name, "organization_name": loc.organization.name, "address1": loc.address1, "city": loc.city,
            "zip": loc.zip, "jurisdiction_id": loc.jurisdiction_id, "review_status": loc.review_status,
            "verification_label": verification_label(loc), "published": loc.published, "operating_status": loc.operating_status,
            "has_coordinates": loc.geom is not None, "last_seen_at": _iso(loc.last_seen_at), "last_verified_at": _iso(loc.last_verified_at),
            "sources": sorted(set(srcs.get(loc.id, []))), "pending_changes": pc.get(loc.id, 0), "pending_duplicates": dc.get(loc.id, 0), "open_reports": rc.get(loc.id, 0),
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
    return {"id": c.id, "location_id": c.location_id, "field": c.field, "origin": c.origin, "submitted_by_id": c.submitted_by_id, "current_value": c.current_value, "proposed_value": c.proposed_value,
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


OVERVIEW_WEEKS = 8


@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    """Dashboard numbers: what is waiting for a reviewer, and reviewer actions per week. Counted from the database;
    synthetic listings are left out, as in the quality report."""
    real = Location.is_synthetic.is_(False)
    today = datetime.now(UTC).date()
    this_week = today - timedelta(days=today.weekday())  # Monday, UTC
    starts = [this_week - timedelta(weeks=i) for i in range(OVERVIEW_WEEKS - 1, -1, -1)]
    weeks = {d: {"week_start": d.isoformat(), "verified": 0, "published": 0} for d in starts}
    since = datetime.combine(starts[0], datetime.min.time(), UTC)
    rows = db.execute(select(VerificationRecord.action, VerificationRecord.created_at)
                      .join(Location, Location.id == VerificationRecord.location_id)
                      .where(real, VerificationRecord.action.in_(("verify", "publish")), VerificationRecord.created_at >= since)).all()
    for action, at in rows:
        day = at.astimezone(UTC).date()
        week = weeks.get(day - timedelta(days=day.weekday()))
        if week:
            week["verified" if action == "verify" else "published"] += 1
    return {
        "generated_at": datetime.now(UTC).isoformat(), "includes_synthetic": False,
        "pending_claims": db.scalar(select(func.count()).select_from(ProviderMembership)
                                    .join(Location, Location.id == ProviderMembership.location_id)
                                    .where(real, ProviderMembership.status == "pending")) or 0,
        "open_reports": db.scalar(select(func.count()).select_from(CommunityReport)
                                  .join(Location, Location.id == CommunityReport.location_id)
                                  .where(real, CommunityReport.status == "open")) or 0,
        "accounts": db.scalar(select(func.count()).select_from(User)) or 0,
        "weeks": list(weeks.values()),
    }


@router.get("/organizations/{org_id}")
def organization(org_id: int, db: Session = Depends(get_db)):
    o = db.get(Organization, org_id)
    if not o:
        raise HTTPException(404, "Organization not found")
    return {"id": o.id, "name": o.name, "website": o.website, "locations": [{"id": loc.id, "name": loc.name} for loc in o.locations]}


# --- Lantern: pantry staff access, community reports, AI suggestions ---------------------------------------------

@router.get("/claims")
def list_claims(status: str = "pending", db: Session = Depends(get_db)):
    rows = db.execute(select(ProviderMembership, User, Location).join(User, User.id == ProviderMembership.user_id)
                      .join(Location, Location.id == ProviderMembership.location_id)
                      .where(ProviderMembership.status == status).order_by(ProviderMembership.created_at)).all()
    return {"items": [{"id": m.id, "status": m.status, "role_title": m.role_title, "note": m.note, "user_email": u.email,
                       "location_id": loc.id, "location_name": loc.name, "location_phone": loc.phone or loc.organization.phone,
                       "created_at": _iso(m.created_at), "decision_note": m.decision_note,
                       "added_by_staff": m.added_by_id is not None} for m, u, loc in rows]}


@router.get("/claims/pending-count")
def pending_claims_count(db: Session = Depends(get_db)):
    """For the admin menu badge (there is no email notification service)."""
    return {"pending": db.query(ProviderMembership).filter_by(status="pending").count()}


@router.post("/claims/{claim_id}/decision")
def decide_claim(claim_id: int, body: DecisionSimpleIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    m = db.get(ProviderMembership, claim_id)
    if not m:
        raise HTTPException(404, "Request not found")
    new = {"approve": "approved", "reject": "rejected", "revoke": "revoked"}.get(body.decision)
    if not new:
        raise HTTPException(422, "decision must be approve, reject or revoke")
    from app.ingestion.verification.workflow import audit

    before = m.status
    m.status, m.decided_by_id, m.decided_at = new, user.id, datetime.now(UTC)
    m.decision_note = (body.notes or "").strip()[:1000] or None  # shown to the requester on their portal page
    audit(db, user, "provider_membership", m.id, new, {"status": before}, {"status": new, "notes": body.notes})
    db.commit()
    return {"id": m.id, "status": m.status}


@router.get("/reports")
def list_reports(status: str = "open", db: Session = Depends(get_db)):
    rows = db.execute(select(CommunityReport, Location).join(Location, Location.id == CommunityReport.location_id)
                      .where(CommunityReport.status == status).order_by(CommunityReport.created_at.desc()).limit(500)).all()
    return {"items": [{"id": r.id, "location_id": loc.id, "location_name": loc.name, "kind": r.kind, "note": r.note,
                       "status": r.status, "created_at": _iso(r.created_at), "provider_response": r.provider_response}
                      for r, loc in rows]}


@router.post("/reports/{report_id}/decision")
def decide_report(report_id: int, body: DecisionSimpleIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    r = db.get(CommunityReport, report_id)
    if not r:
        raise HTTPException(404, "Report not found")
    if body.decision not in ("resolve", "dismiss"):
        raise HTTPException(422, "decision must be resolve or dismiss")
    r.status = "resolved" if body.decision == "resolve" else "dismissed"
    r.resolved_by_id, r.resolved_at = user.id, datetime.now(UTC)
    db.commit()
    return {"id": r.id, "status": r.status}


@router.post("/resources/{location_id}/ai-suggestions")
def ai_suggestions(location_id: int, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Ask Claude to structure the free-text hours/eligibility kept from source records. Results become pending
    change proposals (origin=ai) — each schedule/requirement backed by a verbatim quote — for a reviewer to accept."""
    if not ai.enabled():
        raise HTTPException(404, "AI suggestions are not enabled")
    loc = load_location(db, location_id, public=False)
    texts = []
    for r in db.scalars(select(SourceRecord).where(SourceRecord.location_id == loc.id)).all():
        n = r.normalized or {}
        texts += [t for t in (n.get("raw_hours_text"), n.get("raw_eligibility_text"), n.get("notes")) if t]
        texts += [s.get("description") for s in n.get("services", []) if s.get("description")]
    text = "\n".join(dict.fromkeys(texts))
    if not text.strip():
        raise HTTPException(422, "No source text to analyze for this listing")
    try:
        sug = ai.suggest_structure(text)
    except ai.AIUnavailable as e:
        raise HTTPException(503, str(e)) from None
    from app.services.resource_writer import structures_of

    cur = structures_of(loc)
    created = []
    if sug.distribution_schedules:
        cp = ChangeProposal(location_id=loc.id, field="schedules", current_value=cur["schedules"], origin="ai", submitted_by_id=user.id,
                            proposed_value=[{"kind": "distribution", "weekday": s.weekday, "opens": s.opens, "closes": s.closes,
                                             "week_of_month": s.week_of_month, "notes": f"AI-suggested from: \"{s.evidence}\""}
                                            for s in sug.distribution_schedules])
        db.add(cp)
        created.append("schedules")
    if sug.eligibility:
        cp = ChangeProposal(location_id=loc.id, field="eligibility", current_value=cur["eligibility"], origin="ai", submitted_by_id=user.id,
                            proposed_value=[{"requirement_type": e.requirement_type, "status": e.status,
                                             "details": f"AI-suggested from: \"{e.evidence}\""} for e in sug.eligibility])
        db.add(cp)
        created.append("eligibility")
    db.commit()
    return {"created_proposals": created, "suggestions": sug.model_dump()}


# --- AI settings (admin-uploaded Anthropic key, stored encrypted) ---------------------------------------------------

def _ai_status() -> dict:
    cfg = ai.runtime()
    return {"enabled": cfg["enabled"], "active": ai.enabled(), "model": cfg["model"], "fast_model": cfg["fast_model"],
            "monthly_budget_usd": cfg["monthly_budget_usd"], "month_spend_usd": round(ai.month_spend(), 4),
            "allowed_models": list(ai.ALLOWED_MODELS),
            "key_source": cfg["key_source"], "key_hint": f"…{cfg['key'][-4:]}" if cfg.get("key") else None}


def _set(db: Session, key: str, value: str, user: User, secret: bool = False) -> None:
    from app.models import AppSetting

    row = db.get(AppSetting, key) or AppSetting(key=key)
    row.value, row.is_secret, row.updated_by_id, row.updated_at = value, secret, user.id, datetime.now(UTC)
    db.add(row)


@router.get("/ai-settings")
def get_ai_settings():
    return _ai_status()


@router.put("/ai-settings/key")
def put_ai_key(body: AIKeyIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    from app.ingestion.verification.workflow import audit
    from app.services.secrets import SecretUnavailable, encrypt

    try:
        _set(db, "anthropic_api_key", encrypt(body.api_key), user, secret=True)
    except SecretUnavailable as e:
        raise HTTPException(503, str(e)) from None
    from app.models import AppSetting

    if not db.get(AppSetting, "ai_enabled"):
        _set(db, "ai_enabled", "true", user)  # first key upload turns AI on
    audit(db, user, "app_setting", 0, "ai_key_updated", None, {"key_hint": f"…{body.api_key[-4:]}"})  # never the key itself
    db.commit()
    ai.invalidate()
    return {**_ai_status(), "test": ai.test_connection()}


@router.delete("/ai-settings/key")
def delete_ai_key(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    from app.ingestion.verification.workflow import audit
    from app.models import AppSetting

    row = db.get(AppSetting, "anthropic_api_key")
    if row:
        db.delete(row)
        audit(db, user, "app_setting", 0, "ai_key_removed", None, None)
        db.commit()
    ai.invalidate()
    return _ai_status()


@router.patch("/ai-settings")
def patch_ai_settings(body: AISettingsIn, user: User = Depends(require_admin), db: Session = Depends(get_db)):
    if body.enabled is not None:
        _set(db, "ai_enabled", "true" if body.enabled else "false", user)
    if body.model:
        _set(db, "ai_model", body.model, user)
    if body.fast_model:
        _set(db, "ai_fast_model", body.fast_model, user)
    if body.monthly_budget_usd is not None:
        _set(db, "ai_monthly_budget_usd", str(body.monthly_budget_usd), user)
    db.commit()
    ai.invalidate()
    return _ai_status()


@router.post("/ai-settings/test")
def test_ai_settings():
    ai.invalidate()
    return ai.test_connection()


@router.get("/ai-usage")
def ai_usage():
    from sqlalchemy import func as f

    from app.db import session_factory
    from app.models import AIUsage

    start = datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    with session_factory()() as db:
        rows = db.execute(select(AIUsage.feature, f.count(), f.sum(AIUsage.cost_usd), f.sum(f.cast(AIUsage.cached, Integer)))
                          .where(AIUsage.at >= start).group_by(AIUsage.feature)).all()
    cfg = ai.runtime()
    return {"month_spend_usd": round(ai.month_spend(), 4), "monthly_budget_usd": cfg["monthly_budget_usd"],
            "by_feature": [{"feature": r[0], "calls": r[1], "cost_usd": round(r[2] or 0, 4), "cached_calls": int(r[3] or 0)} for r in rows]}


@router.post("/duplicates/{dup_id}/ai-opinion")
def duplicate_ai_opinion(dup_id: int, db: Session = Depends(get_db)):
    """Advisory AI comparison of the two records behind a duplicate candidate (cached; reviewer still decides)."""
    if not ai.enabled():
        raise HTTPException(404, "AI is not enabled")
    d = db.get(DuplicateCandidate, dup_id)
    if not d:
        raise HTTPException(404, "Duplicate candidate not found")
    loc = db.get(Location, d.location_id)
    a = {"name": loc.name, "organization": loc.organization.name, "address": loc.address1, "city": loc.city, "zip": loc.zip,
         "phone": loc.phone, "services": sorted({s.service_type for s in loc.services})}
    if d.source_record_id:
        b = (db.get(SourceRecord, d.source_record_id).normalized or {})
        b = {k: b.get(k) for k in ("organization_name", "location_name", "address1", "city", "zip", "phone")} | {
            "services": sorted({s.get("service_type") for s in b.get("services", [])})}
    else:
        o = db.get(Location, d.other_location_id)
        b = {"name": o.name, "organization": o.organization.name, "address": o.address1, "city": o.city, "zip": o.zip,
             "phone": o.phone, "services": sorted({s.service_type for s in o.services})}
    try:
        op = ai.compare_records(a, b)
    except ai.AIUnavailable as e:
        raise HTTPException(503, str(e)) from None
    return {"verdict": op.verdict, "reasons": op.reasons, "advisory": True}


@router.get("/refresh")
def refresh_status():
    from app.services import scheduler

    return scheduler.status()


@router.post("/refresh")
def refresh_run():
    """Run a refresh now (blocks until done; unchanged sources are cheap)."""
    from app.services import scheduler

    return scheduler.refresh_now()
