from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi.responses import JSONResponse
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.db import get_db
from app.geospatial import geocode as geo
from app.geospatial.search import ELIGIBILITY_FILTERS, SearchParams, categories, public_visibility, search
from app.models import DistributionEvent, Jurisdiction, Location, Service, Source, SourceRecord, Translation
from app.auth import oauth
from app.auth.security import RateLimiter
from app.schemas import AISearchIn, GeocodeResponse, ReportIn, SearchResponse
from app.services import ai
from app.services.shelf import calendar_ics, current_shelf, file_report, open_report_counts, shelf_dict, visit_plan
from app.services.presenter import detail
from app.services.schedule import TZ, windows_on
from app.vocab import FOOD_GROUPS, SERVICE_GROUPS

router = APIRouter(prefix="/api", tags=["public"])

CSV = Annotated[list[str] | None, Query()]


def load_location(db: Session, location_id: int, public: bool = True) -> Location:
    q = select(Location).where(Location.id == location_id).options(
        selectinload(Location.organization),
        selectinload(Location.services).selectinload(Service.food_types),
        selectinload(Location.eligibility),
        selectinload(Location.schedules),
        selectinload(Location.exceptions),
        selectinload(Location.events).selectinload(DistributionEvent.offerings),
    )
    if public:
        q = q.where(public_visibility())
    loc = db.scalar(q)
    if not loc:
        raise HTTPException(404, "Resource not found")
    return loc


def location_sources(db: Session, location_id: int) -> list[dict]:
    rows = db.execute(
        select(SourceRecord, Source).join(Source).where(SourceRecord.location_id == location_id)
    ).all()
    return [
        {"source_id": s.id, "name": s.name, "url": r.source_url or s.url, "last_seen_at": r.last_seen_at.isoformat(),
         "is_synthetic": r.is_synthetic}
        for r, s in rows
    ]


def location_translations(db: Session, loc: Location, lang: str | None) -> dict:
    if not lang:
        return {}
    ids = {("location", loc.id), ("organization", loc.organization_id)} | {("service", s.id) for s in loc.services}
    rows = db.scalars(select(Translation).where(Translation.lang == lang)).all()
    out: dict = {}
    for t in rows:
        if (t.entity_type, t.entity_id) in ids:
            out[f"{t.entity_type}:{t.entity_id}:{t.field}"] = {"text": t.text, "is_machine": t.is_machine, "reviewed": t.reviewed}
    return out


def _split(values: list[str]) -> list[str]:
    return [v for item in values or [] for v in item.split(",") if v]


@router.get("/resources/search", response_model=SearchResponse)
def search_resources(
    db: Session = Depends(get_db),
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    radius_km: float = Query(16.09, gt=0, description="Default is 10 miles"),
    any_distance: bool = Query(False, description="No distance limit around lat/lon (radius_km is ignored)"),
    bbox: str | None = Query(None, description="min_lon,min_lat,max_lon,max_lat (viewport search)"),
    jurisdiction: str | None = None,
    q: str | None = Query(None, max_length=100, description="Name search (place or organization)"),
    fields: str | None = Query(None, pattern="^pins$", description="'pins' returns every match (up to 1000) with minimal fields for the map"),
    food_group: CSV = None,
    food_type: CSV = None,
    service_group: CSV = None,
    service_type: CSV = None,
    need_match: str = Query("all", pattern="^(all|any)$", description="any: selected needs are alternatives (OR)"),
    eligibility: CSV = None,
    date_: date | None = Query(None, alias="date"),
    open_today: bool = False,
    upcoming_days: int | None = Query(None, ge=1, le=60),
    wheelchair: bool = False,
    live_open: bool = Query(False, description="Pantry posted open/limited today"),
    live_food_group: CSV = None,
    language: str | None = Query(None, max_length=8),
    sort: str = Query("distance", pattern="^(distance|next_distribution|relevance|name)$"),
    include_uncertain: bool = True,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    if (lat is None) != (lon is None):
        raise HTTPException(422, "lat and lon must be provided together")
    if radius_km > get_settings().max_search_radius_km:
        raise HTTPException(422, f"radius_km may not exceed {get_settings().max_search_radius_km}")
    box = None
    if bbox:
        try:
            box = tuple(float(x) for x in bbox.split(","))
        except ValueError:
            raise HTTPException(422, "bbox must be four numbers") from None
        if len(box) != 4 or not (-180 <= box[0] < box[2] <= 180 and -90 <= box[1] < box[3] <= 90):
            raise HTTPException(422, "bbox must be min_lon,min_lat,max_lon,max_lat")
    fg, sg, el, lfg = _split(food_group), _split(service_group), _split(eligibility), _split(live_food_group)
    for vals, allowed, name in ((fg, FOOD_GROUPS, "food_group"), (lfg, FOOD_GROUPS, "live_food_group"), (sg, SERVICE_GROUPS, "service_group"), (el, ELIGIBILITY_FILTERS, "eligibility")):
        bad = [v for v in vals if v not in allowed]
        if bad:
            raise HTTPException(422, f"unknown {name}: {bad}")
    params = SearchParams(
        lat=lat, lon=lon, radius_km=None if any_distance else radius_km, bbox=box, jurisdiction=jurisdiction, q=(q or "").strip() or None, food_groups=fg, food_types=_split(food_type),
        service_groups=sg, service_types=_split(service_type), need_match=need_match, on_date=date_, open_today=open_today,
        upcoming_days=upcoming_days, eligibility=el, wheelchair=wheelchair, live_open=live_open, live_food_groups=lfg,
        language=language, sort=sort,
        include_uncertain=include_uncertain, page=page, page_size=page_size,
    )
    if fields == "pins":
        params.page, params.page_size = 1, 1000
        res = search(db, params)
        slim = lambda i: {k: i.get(k) for k in ("id", "name", "organization_name", "address", "phone", "next_distribution", "lat", "lon", "verification_label", "is_synthetic", "service_types")} | {  # noqa: E731
            "live": {"status": i["live"]["status"]} if i.get("live") else None}
        return JSONResponse({"items": [slim(i) for i in res["items"]], "uncertain": [slim(i) for i in res["uncertain"]],
                             "total": res["total"], "truncated": res["truncated"]})
    return search(db, params)


@router.get("/resources/{location_id}")
def resource_detail(location_id: int, lang: str | None = Query(None, max_length=8), db: Session = Depends(get_db)):
    loc = load_location(db, location_id)
    return detail_with_live(db, loc, lang)


def detail_with_live(db: Session, loc: Location, lang: str | None) -> dict:
    live = shelf_dict(current_shelf(db, [loc.id]).get(loc.id))
    return detail(loc, location_sources(db, loc.id), location_translations(db, loc, lang), live=live,
                  open_reports=open_report_counts(db, [loc.id]).get(loc.id, 0))


report_limiter = RateLimiter(5, 3600)
ai_search_limiter = RateLimiter(get_settings().ai_public_search_per_hour, 3600)


@router.post("/resources/{location_id}/reports", status_code=201)
def report_problem(location_id: int, body: ReportIn, request: Request, db: Session = Depends(get_db)):
    """Anonymous community report. Nothing identifying is stored; the IP is used only for in-memory rate limiting."""
    if not report_limiter.allow(f"report:{request.client.host if request.client else '-'}"):
        raise HTTPException(429, "Thanks — you've sent several reports recently. Please try again later.")
    loc = load_location(db, location_id)
    from app.ingestion.normalization.text import clean_text

    r = file_report(db, loc, body.kind, clean_text(body.note))
    return {"id": r.id, "status": r.status}


@router.get("/resources/{location_id}/visit-plan")
def resource_visit_plan(location_id: int, db: Session = Depends(get_db)):
    return visit_plan(load_location(db, location_id))


@router.get("/resources/{location_id}/calendar.ics")
def resource_calendar(location_id: int, db: Session = Depends(get_db)):
    loc = load_location(db, location_id)
    ics = calendar_ics(loc, get_settings().app_name)
    return Response(ics, media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="lantern-{loc.id}.ics"'})


enrich_limiter = RateLimiter(15, 3600)


def _missing_fields(d: dict) -> list[str]:
    m = []
    el = d.get("eligibility") or {}
    if any(v == "unknown" for v in el.values()):
        m += ["WHAT_TO_BRING", "ID_REQUIRED", "ELIGIBILITY"]
    if not d.get("has_distribution_schedule") and not (d.get("schedules") or {}).get("operating_hours"):
        m += ["HOURS", "DATES"]
    elif not d.get("upcoming_windows"):
        m.append("DATES")
    if not d.get("service_types") or not d.get("food_types") and any(s in d.get("service_types", []) for s in ("pantry_pickup", "walk_up")):
        m.append("SERVICES")
    if not d.get("languages"):
        m.append("LANGUAGES")
    if not d.get("phone"):
        m.append("PHONE")
    return list(dict.fromkeys(m)) or ["WHAT_TO_BRING"]


@router.get("/resources/{location_id}/ai-info")
def resource_ai_info(location_id: int, db: Session = Depends(get_db)):
    """Cached AI-found info for a listing (free to read). 'status' is 'ready' or 'none'."""
    load_location(db, location_id)
    hit = ai.enrich_cached(location_id)
    return {"status": "ready", **hit} if hit else {"status": "none", "available": ai.enabled()}


@router.post("/resources/{location_id}/ai-info")
def resource_ai_info_generate(location_id: int, request: Request, db: Session = Depends(get_db)):
    """Look up missing info for this listing with AI web search (cached 30 days; rate-limited; budget-capped)."""
    if not ai.enabled():
        raise HTTPException(404, "AI is not enabled")
    loc = load_location(db, location_id)
    hit = ai.enrich_cached(location_id)
    if hit:
        return {"status": "ready", **hit}
    if not enrich_limiter.allow(f"enrich:{request.client.host if request.client else '-'}"):
        raise HTTPException(429, "Too many AI lookups right now. Please try again later.")
    d = detail_with_live(db, loc, None)
    info = {"name": loc.name, "organization": loc.organization.name, "address": ", ".join(x for x in (loc.address1, loc.city, loc.state, loc.zip) if x),
            "website": loc.website or loc.organization.website, "phone": loc.phone}
    try:
        out = ai.enrich_listing(location_id, info, _missing_fields(d))
    except ai.AIUnavailable as e:
        raise HTTPException(503, str(e)) from None
    return {"status": "ready", **out}


@router.get("/meta/features")
def meta_features():
    s = get_settings()
    on = ai.enabled()
    return {"app_name": s.app_name, "demo_mode": s.show_synthetic, "contact_email": s.contact_email or None,
            "oauth": {"enabled": oauth.enabled(), "provider": oauth.provider_name()},
            "ai": {"search": on, "listing_lookup": on, "announcement_drafts": on, "structure_suggestions": on,
                   "translation": on and s.translation_provider == "claude", "model": ai.model() if on else None}}


@router.post("/ai/search")
def ai_search(body: AISearchIn, request: Request):
    """Natural-language search -> filters. Only the typed words are sent to the AI service (never location/account)."""
    if not ai.enabled():
        raise HTTPException(404, "AI search is not enabled")
    if not ai_search_limiter.allow(f"ai:{request.client.host if request.client else '-'}"):
        raise HTTPException(429, "Too many AI searches. Please use the regular filters or try later.")
    try:
        intent = ai.interpret_search(body.q, body.lang)
    except ai.AIUnavailable as e:
        raise HTTPException(503, str(e)) from None
    place = None
    if intent.place:
        results, _ = geo.geocode(intent.place)
        place = results[0] if results else None
    on_date = None
    if intent.day == "today":
        on_date = datetime.now(UTC).astimezone(TZ).date()
    elif intent.day:
        today = datetime.now(UTC).astimezone(TZ).date()
        wd = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].index(intent.day)
        on_date = today + timedelta(days=(wd - today.weekday()) % 7)
    return {"filters": {"food_group": intent.food_groups, "service_group": intent.service_groups,
                        "eligibility": intent.eligibility, "date": on_date.isoformat() if on_date else None,
                        "wheelchair": intent.wheelchair},
            "place": place, "place_text": intent.place, "explanation": intent.explanation,
            "notice": "Filters were suggested by an AI assistant. Results come only from verified listings."}


@router.get("/events/upcoming")
def upcoming(
    db: Session = Depends(get_db),
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    radius_km: float = Query(15, gt=0, le=80),
    days: int = Query(7, ge=1, le=31),
    jurisdiction: str | None = None,
):
    """Distribution windows (recurring + one-time events) in the next `days` days, soonest first."""
    res = search(db, SearchParams(lat=lat, lon=lon, radius_km=radius_km, jurisdiction=jurisdiction, include_uncertain=False,
                                  page_size=1000))
    ids = [i["id"] for i in res["items"]]
    dist = {i["id"]: i["distance_km"] for i in res["items"]}
    today = datetime.now(UTC).astimezone(TZ).date()
    out = []
    for lid in ids:
        loc = load_location(db, lid)
        for d in range(days):
            day = today + timedelta(days=d)
            for w in windows_on(day, loc.schedules, loc.exceptions, loc.events):
                out.append({"resource_id": loc.id, "resource_name": loc.name, "distance_km": dist[lid], **w.as_dict()})
    out.sort(key=lambda x: (x["date"], x["opens"] or "", x["distance_km"] or 0))
    return {"items": out[:200]}


@router.get("/geocode", response_model=GeocodeResponse)
def geocode(q: str = Query(..., min_length=3, max_length=200)):
    results, errors = geo.geocode(q)
    return {"results": list(results), "unavailable_providers": list(errors)}


@router.get("/meta/categories")
def meta_categories(db: Session = Depends(get_db)):
    return categories(db)


@router.get("/jurisdictions")
def jurisdictions(db: Session = Depends(get_db)):
    rows = db.scalars(select(Jurisdiction).order_by(Jurisdiction.name)).all()
    counts = dict(db.execute(select(Location.jurisdiction_id, func.count()).where(public_visibility()).group_by(Location.jurisdiction_id)).all())
    return [
        {"id": j.id, "name": j.name, "kind": j.kind, "status": j.status, "has_boundary": j.boundary is not None,
         "published_resources": counts.get(j.id, 0),
         "center": (j.config or {}).get("center")}
        for j in rows if j.status != "disabled"
    ]


@router.get("/meta/verification")
def meta_verification(db: Session = Depends(get_db)):
    s = get_settings()
    labels = db.execute(select(Location.review_status, func.count()).where(public_visibility()).group_by(Location.review_status)).all()
    sources = db.scalars(select(Source).where(Source.enabled.is_(True)).order_by(Source.name)).all()
    return {
        "fresh_days": s.verification_fresh_days,
        "published_by_status": dict(labels),
        "sources": [{"id": x.id, "name": x.name, "url": x.url, "owner": x.owner,
                     "last_success_at": x.last_success_at.isoformat() if x.last_success_at else None} for x in sources],
        "demo_mode": s.show_synthetic,
    }
