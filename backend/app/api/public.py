from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.db import get_db
from app.geospatial import geocode as geo
from app.geospatial.search import ELIGIBILITY_FILTERS, SearchParams, categories, public_visibility, search
from app.models import DistributionEvent, Jurisdiction, Location, Service, Source, SourceRecord, Translation
from app.schemas import GeocodeResponse, SearchResponse
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
    radius_km: float = Query(10, gt=0),
    bbox: str | None = Query(None, description="min_lon,min_lat,max_lon,max_lat (viewport search)"),
    jurisdiction: str | None = None,
    food_group: CSV = None,
    food_type: CSV = None,
    service_group: CSV = None,
    service_type: CSV = None,
    eligibility: CSV = None,
    date_: date | None = Query(None, alias="date"),
    open_today: bool = False,
    upcoming_days: int | None = Query(None, ge=1, le=60),
    wheelchair: bool = False,
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
    fg, sg, el = _split(food_group), _split(service_group), _split(eligibility)
    for vals, allowed, name in ((fg, FOOD_GROUPS, "food_group"), (sg, SERVICE_GROUPS, "service_group"), (el, ELIGIBILITY_FILTERS, "eligibility")):
        bad = [v for v in vals if v not in allowed]
        if bad:
            raise HTTPException(422, f"unknown {name}: {bad}")
    params = SearchParams(
        lat=lat, lon=lon, radius_km=radius_km, bbox=box, jurisdiction=jurisdiction, food_groups=fg, food_types=_split(food_type),
        service_groups=sg, service_types=_split(service_type), on_date=date_, open_today=open_today,
        upcoming_days=upcoming_days, eligibility=el, wheelchair=wheelchair, language=language, sort=sort,
        include_uncertain=include_uncertain, page=page, page_size=page_size,
    )
    return search(db, params)


@router.get("/resources/{location_id}")
def resource_detail(location_id: int, lang: str | None = Query(None, max_length=8), db: Session = Depends(get_db)):
    loc = load_location(db, location_id)
    return detail(loc, location_sources(db, loc.id), location_translations(db, loc, lang))


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
