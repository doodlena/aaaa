"""Pantry portal API. Any signed-in user may request access to a listing; an admin approves it after confirming the
person with the pantry. Approved staff post live status, events, closures and surplus, and propose corrections.

Trust model: live posts (status/items, events, closures) publish immediately, labelled "Posted by the pantry", because
they come from admin-approved staff and expire on their own. Corrections to hours/eligibility/contact details are
*proposals* that go through the normal review queue and never overwrite verified data directly.
"""
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.public import load_location
from app.auth.security import RateLimiter, require_user
from app.db import get_db
from app.ingestion.normalization.text import clean_text, normalize_phone
from app.ingestion.verification.workflow import audit
from app.models import (
    ChangeProposal,
    CommunityReport,
    DistributionEvent,
    EventOffering,
    Location,
    ProviderMembership,
    ScheduleException,
    ShelfUpdate,
    SurplusPost,
    User,
)
from app.schemas import (
    AnnouncementIn,
    ChangeRequestIn,
    ClaimIn,
    ClosureIn,
    EventIn,
    ReportResponseIn,
    ShelfUpdateIn,
    SurplusClaimIn,
    SurplusIn,
)
from app.services import ai
from app.services.resource_writer import structures_of
from app.services.schedule import TZ
from app.services.shelf import current_shelf, end_of_local_day, shelf_dict
from app.vocab import FOOD_TYPES

router = APIRouter(prefix="/api/provider", tags=["pantry portal"])
ai_limiter = RateLimiter(60, 3600)


def _iso(d):
    return d.isoformat() if d else None


def staff_location_ids(db: Session, user: User) -> list[int]:
    return list(db.scalars(select(ProviderMembership.location_id).where(ProviderMembership.user_id == user.id,
                                                                        ProviderMembership.status == "approved")).all())


def require_staff(db: Session, user: User, location_id: int) -> Location:
    if user.role != "admin" and location_id not in staff_location_ids(db, user):
        raise HTTPException(403, "You are not approved to manage this pantry")
    loc = db.get(Location, location_id)
    if not loc or loc.merged_into_id:
        raise HTTPException(404, "Pantry not found")
    return loc


# --- membership ----------------------------------------------------------------------------------------------------

@router.post("/claims", status_code=201)
def request_access(body: ClaimIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    load_location(db, body.location_id)  # only public listings can be claimed
    m = ProviderMembership(user_id=user.id, location_id=body.location_id, role_title=clean_text(body.role_title),
                           note=clean_text(body.note))
    db.add(m)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "You already requested access to this pantry") from None
    return {"id": m.id, "status": m.status}


@router.get("/me")
def my_pantries(user: User = Depends(require_user), db: Session = Depends(get_db)):
    rows = db.execute(select(ProviderMembership, Location).join(Location, Location.id == ProviderMembership.location_id)
                      .where(ProviderMembership.user_id == user.id)).all()
    shelves = current_shelf(db, [loc.id for m, loc in rows if m.status == "approved"])
    out = []
    for m, loc in rows:
        item = {"membership_id": m.id, "status": m.status, "role_title": m.role_title, "location_id": loc.id,
                "name": loc.name, "address1": loc.address1, "city": loc.city}
        if m.status == "approved":
            item.update({
                "live": shelf_dict(shelves.get(loc.id)),
                "open_reports": db.query(CommunityReport).filter_by(location_id=loc.id, status="open").count(),
                "pending_changes": db.query(ChangeProposal).filter_by(location_id=loc.id, status="pending", origin="provider").count(),
            })
        out.append(item)
    return {"items": out, "food_types": list(FOOD_TYPES)}


# --- live shelf ----------------------------------------------------------------------------------------------------

@router.post("/locations/{location_id}/shelf", status_code=201)
def post_shelf(location_id: int, body: ShelfUpdateIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    loc = require_staff(db, user, location_id)
    now = datetime.now(UTC)
    expires = body.expires_at or end_of_local_day(now)
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=TZ)
    if not now < expires <= now + timedelta(days=3):
        raise HTTPException(422, "Status can be set for at most 3 days")
    u = ShelfUpdate(location_id=loc.id, posted_by_id=user.id, status=body.status, message=clean_text(body.message),
                    items=[i.model_dump() for i in body.items], expires_at=expires, ai_assisted=body.ai_assisted,
                    is_synthetic=loc.is_synthetic)
    db.add(u)
    audit(db, user, "location", loc.id, "shelf_update", None, {"status": body.status, "items": len(body.items)})
    db.commit()
    return shelf_dict(u)


@router.delete("/locations/{location_id}/shelf", status_code=204)
def clear_shelf(location_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    loc = require_staff(db, user, location_id)
    for u in db.scalars(select(ShelfUpdate).where(ShelfUpdate.location_id == loc.id, ShelfUpdate.retracted.is_(False))).all():
        u.retracted = True
    db.commit()


@router.get("/locations/{location_id}/shelf/history")
def shelf_history(location_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    loc = require_staff(db, user, location_id)
    rows = db.scalars(select(ShelfUpdate).where(ShelfUpdate.location_id == loc.id).order_by(ShelfUpdate.posted_at.desc()).limit(30)).all()
    return {"items": [{**shelf_dict(u), "id": u.id, "retracted": u.retracted} for u in rows]}


# --- events & closures (public immediately, labelled as posted by the pantry) -------------------------------------

@router.post("/locations/{location_id}/events", status_code=201)
def post_event(location_id: int, body: EventIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    loc = require_staff(db, user, location_id)
    starts = body.starts_at if body.starts_at.tzinfo else body.starts_at.replace(tzinfo=TZ)
    ends = (body.ends_at if body.ends_at.tzinfo else body.ends_at.replace(tzinfo=TZ)) if body.ends_at else None
    if starts < datetime.now(UTC) - timedelta(hours=1) or (ends and ends <= starts):
        raise HTTPException(422, "Event must be in the future and end after it starts")
    bad = [f for f in body.offerings if f not in FOOD_TYPES]
    if bad:
        raise HTTPException(422, f"unknown food types {bad}")
    ev = DistributionEvent(location_id=loc.id, title=clean_text(body.title), starts_at=starts, ends_at=ends,
                           registration_deadline=body.registration_deadline, appointment_required=body.appointment_required,
                           notes=clean_text(body.notes), posted_by_id=user.id, ai_assisted=body.ai_assisted)
    ev.offerings = [EventOffering(food_type=f) for f in dict.fromkeys(body.offerings)]
    db.add(ev)
    db.flush()
    audit(db, user, "location", loc.id, "event_posted", None, {"event_id": ev.id, "starts_at": starts.isoformat()})
    db.commit()
    return {"id": ev.id}


@router.delete("/locations/{location_id}/events/{event_id}", status_code=204)
def cancel_event(location_id: int, event_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    loc = require_staff(db, user, location_id)
    ev = db.get(DistributionEvent, event_id)
    if not ev or ev.location_id != loc.id:
        raise HTTPException(404, "Event not found")
    ev.status = "cancelled"
    audit(db, user, "location", loc.id, "event_cancelled", None, {"event_id": ev.id})
    db.commit()


@router.post("/locations/{location_id}/closures", status_code=201)
def post_closure(location_id: int, body: ClosureIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    loc = require_staff(db, user, location_id)
    if body.date < datetime.now(UTC).astimezone(TZ).date():
        raise HTTPException(422, "Closure date is in the past")
    ex = ScheduleException(location_id=loc.id, date=body.date, kind="closed", reason=clean_text(body.reason), posted_by_id=user.id)
    db.add(ex)
    db.flush()
    audit(db, user, "location", loc.id, "closure_posted", None, {"date": body.date.isoformat()})
    db.commit()
    return {"id": ex.id}


# --- corrections -> review queue -----------------------------------------------------------------------------------

@router.post("/locations/{location_id}/change-requests", status_code=201)
def request_changes(location_id: int, body: ChangeRequestIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    loc = require_staff(db, user, location_id)
    current = structures_of(loc)
    proposed = {}
    if body.phone:
        if not normalize_phone(body.phone):
            raise HTTPException(422, "Phone number not recognized")
        proposed["phone"] = (loc.phone, normalize_phone(body.phone))
    for f in ("website", "registration_url"):
        if getattr(body, f):
            proposed[f] = (getattr(loc, f), getattr(body, f))
    if body.notes:
        proposed["notes"] = (loc.notes, clean_text(body.notes))
    if body.schedules is not None:
        proposed["schedules"] = (current["schedules"], [s.model_dump(mode="json", exclude={"service_index"}) for s in body.schedules])
    if body.eligibility is not None:
        proposed["eligibility"] = (current["eligibility"], [e.model_dump(exclude={"service_index"}) for e in body.eligibility])
    if not proposed:
        raise HTTPException(422, "Nothing to change")
    ids = []
    for field, (cur, new) in proposed.items():
        cp = ChangeProposal(location_id=loc.id, field=field, current_value=cur, proposed_value=new, origin="provider",
                            submitted_by_id=user.id)
        db.add(cp)
        db.flush()
        ids.append(cp.id)
    audit(db, user, "location", loc.id, "provider_change_request", None, {"fields": sorted(proposed), "message": body.message_to_reviewer})
    db.commit()
    return {"change_proposal_ids": ids, "status": "pending_review"}


# --- community reports about my pantry -----------------------------------------------------------------------------

@router.get("/locations/{location_id}/reports")
def my_reports(location_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    loc = require_staff(db, user, location_id)
    rows = db.scalars(select(CommunityReport).where(CommunityReport.location_id == loc.id).order_by(CommunityReport.created_at.desc()).limit(100)).all()
    return {"items": [{"id": r.id, "kind": r.kind, "note": r.note, "status": r.status, "created_at": _iso(r.created_at),
                       "provider_response": r.provider_response} for r in rows]}


@router.post("/locations/{location_id}/reports/{report_id}/response")
def respond_report(location_id: int, report_id: int, body: ReportResponseIn, user: User = Depends(require_user),
                   db: Session = Depends(get_db)):
    loc = require_staff(db, user, location_id)
    r = db.get(CommunityReport, report_id)
    if not r or r.location_id != loc.id:
        raise HTTPException(404, "Report not found")
    r.provider_response = clean_text(body.response)
    if body.resolve:
        r.status, r.resolved_by_id, r.resolved_at = "resolved", user.id, datetime.now(UTC)
    db.commit()
    return {"id": r.id, "status": r.status}


# --- surplus board (staff only) ------------------------------------------------------------------------------------

def _surplus(p: SurplusPost, db: Session) -> dict:
    loc = db.get(Location, p.location_id)
    return {"id": p.id, "location_id": p.location_id, "pantry": loc.name, "city": loc.city, "title": p.title,
            "food_types": p.food_types, "quantity": p.quantity, "pickup_notes": p.pickup_notes,
            "available_until": _iso(p.available_until), "status": p.status, "claimed_by_location_id": p.claimed_by_location_id,
            "created_at": _iso(p.created_at)}


def _require_any_staff(db: Session, user: User) -> list[int]:
    ids = staff_location_ids(db, user)
    if not ids and user.role != "admin":
        raise HTTPException(403, "The surplus board is for approved pantry staff")
    return ids


@router.get("/surplus")
def list_surplus(user: User = Depends(require_user), db: Session = Depends(get_db)):
    _require_any_staff(db, user)
    now = datetime.now(UTC)
    rows = db.scalars(select(SurplusPost).where(SurplusPost.available_until > now, SurplusPost.status != "closed")
                      .order_by(SurplusPost.available_until)).all()
    return {"items": [_surplus(p, db) for p in rows]}


@router.post("/surplus", status_code=201)
def post_surplus(body: SurplusIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    loc = require_staff(db, user, body.location_id)
    until = body.available_until if body.available_until.tzinfo else body.available_until.replace(tzinfo=TZ)
    if until <= datetime.now(UTC):
        raise HTTPException(422, "Availability must end in the future")
    if any(f not in FOOD_TYPES for f in body.food_types):
        raise HTTPException(422, "unknown food type")
    p = SurplusPost(location_id=loc.id, posted_by_id=user.id, title=clean_text(body.title), food_types=body.food_types,
                    quantity=clean_text(body.quantity), pickup_notes=clean_text(body.pickup_notes), available_until=until)
    db.add(p)
    db.commit()
    return _surplus(p, db)


@router.post("/surplus/{post_id}/claim")
def claim_surplus(post_id: int, body: SurplusClaimIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    loc = require_staff(db, user, body.location_id)
    p = db.get(SurplusPost, post_id)
    if not p or p.status != "open" or p.available_until <= datetime.now(UTC):
        raise HTTPException(409, "This surplus is no longer available")
    if p.location_id == loc.id:
        raise HTTPException(422, "You cannot claim your own surplus")
    p.status, p.claimed_by_location_id, p.claimed_by_id, p.claimed_at = "claimed", loc.id, user.id, datetime.now(UTC)
    db.commit()
    return _surplus(p, db)


@router.post("/surplus/{post_id}/close")
def close_surplus(post_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    p = db.get(SurplusPost, post_id)
    if not p:
        raise HTTPException(404, "Not found")
    require_staff(db, user, p.location_id)
    p.status = "closed"
    db.commit()
    return _surplus(p, db)


# --- AI: paste an announcement -> draft (never saved automatically) -----------------------------------------------

@router.post("/locations/{location_id}/ai/announcement-draft")
def announcement_draft(location_id: int, body: AnnouncementIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    loc = require_staff(db, user, location_id)
    if not ai.enabled():
        raise HTTPException(404, "AI drafts are not enabled")
    if not ai_limiter.allow(f"user:{user.id}"):
        raise HTTPException(429, "Too many drafts this hour")
    try:
        draft = ai.draft_announcement(body.text, datetime.now(UTC).astimezone(TZ).date().isoformat(), loc.name)
    except ai.AIUnavailable as e:
        raise HTTPException(503, str(e)) from None
    return {"draft": draft.model_dump(), "notice": "Draft only — review every field before posting."}

