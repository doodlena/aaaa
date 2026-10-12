"""Public resource search.

Stage 1 (PostGIS/SQL): visibility rules, radius (ST_DWithin on geography), viewport (envelope), jurisdiction,
food/service category filters, distance (ST_Distance). Stage 2 (Python, on the spatially-bounded set): schedule
and tri-state eligibility evaluation, which need recurrence logic and must keep "unknown" separate from "confirmed".
"""
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from geoalchemy2 import Geography
from sqlalchemy import and_, cast, exists, func, select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.models import DistributionEvent, Jurisdiction, Location, Service, ServiceCategory, ServiceFoodType
from app.services.presenter import eligibility_state, summary
from app.services.schedule import TZ, windows_on
from app.vocab import FOOD_TYPES, PUBLIC_REVIEW_STATUSES, SERVICE_TYPES

MAX_CANDIDATES = 1000

# Eligibility filters: param name -> (requirement type, state that counts as a confirmed match)
ELIGIBILITY_FILTERS = {
    "no_id_required": ("photo_id", "not_required"),
    "no_income_docs_required": ("income_documentation", "not_required"),
    "no_proof_of_address_required": ("proof_of_address", "not_required"),
    "no_appointment_required": ("appointment", "not_required"),
    "no_referral_required": ("referral", "not_required"),
    "no_residency_restriction": ("residency", "not_required"),
    "student_affiliation": ("student_affiliation", "required"),  # programs specifically for students/families
}


@dataclass
class SearchParams:
    lat: float | None = None
    lon: float | None = None
    radius_km: float = 10.0
    bbox: tuple[float, float, float, float] | None = None  # min_lon, min_lat, max_lon, max_lat
    jurisdiction: str | None = None
    food_groups: list[str] = field(default_factory=list)
    food_types: list[str] = field(default_factory=list)
    service_groups: list[str] = field(default_factory=list)
    service_types: list[str] = field(default_factory=list)
    on_date: date | None = None
    open_today: bool = False
    upcoming_days: int | None = None
    eligibility: list[str] = field(default_factory=list)  # keys of ELIGIBILITY_FILTERS
    wheelchair: bool = False
    language: str | None = None
    sort: str = "distance"  # distance | next_distribution | relevance | name
    include_uncertain: bool = True
    page: int = 1
    page_size: int = 20


def public_visibility():
    s = get_settings()
    cond = [
        Location.published.is_(True),
        Location.review_status.in_(PUBLIC_REVIEW_STATUSES),
        Location.merged_into_id.is_(None),
        Location.operating_status != "permanently_closed",
        Location.geom.isnot(None),
    ]
    if not s.show_synthetic:
        cond.append(Location.is_synthetic.is_(False))
    return and_(*cond)


def _point(lat: float, lon: float):
    return cast(func.ST_SetSRID(func.ST_MakePoint(lon, lat), 4326), Geography)


def _food_filter(codes: list[str]):
    return exists(
        select(1).select_from(Service).join(ServiceFoodType, ServiceFoodType.service_id == Service.id)
        .where(Service.location_id == Location.id, ServiceFoodType.food_type.in_(codes))
    )


def _service_filter(codes: list[str]):
    return exists(select(1).where(Service.location_id == Location.id, Service.service_type.in_(codes)))


def search(db: Session, p: SearchParams, now: datetime | None = None) -> dict:
    now = now or datetime.now(UTC)
    today = now.astimezone(TZ).date()
    distance = None
    q = select(Location)
    conds = [public_visibility()]
    if p.lat is not None and p.lon is not None:
        pt = _point(p.lat, p.lon)
        distance = func.ST_Distance(Location.geom, pt)
        q = select(Location, distance.label("distance_m"))
        if not p.bbox:
            conds.append(func.ST_DWithin(Location.geom, pt, p.radius_km * 1000))
    if p.bbox:
        conds.append(func.ST_Intersects(Location.geom, cast(func.ST_MakeEnvelope(*p.bbox, 4326), Geography)))
    if p.jurisdiction:
        conds.append(Location.jurisdiction_id == p.jurisdiction)
    # Each selected food group / service group must be offered (AND across selections, any code within a group).
    for g in p.food_groups:
        conds.append(_food_filter([c for c, grp in FOOD_TYPES.items() if grp == g]))
    for c in p.food_types:
        conds.append(_food_filter([c]))
    for g in p.service_groups:
        conds.append(_service_filter([c for c, grp in SERVICE_TYPES.items() if grp == g]))
    for c in p.service_types:
        conds.append(_service_filter([c]))
    if p.wheelchair:
        conds.append(Location.wheelchair_accessible == "yes")
    if p.language:
        conds.append(Location.languages.any(p.language))
    q = q.where(*conds).limit(MAX_CANDIDATES).options(
        selectinload(Location.organization),
        selectinload(Location.services).selectinload(Service.food_types),
        selectinload(Location.eligibility),
        selectinload(Location.schedules),
        selectinload(Location.exceptions),
        selectinload(Location.events).selectinload(DistributionEvent.offerings),
    )
    if distance is not None:
        q = q.order_by(distance)
    rows = db.execute(q).all()

    target_date = today if p.open_today else p.on_date
    matched, uncertain = [], []
    for row in rows:
        loc = row[0]
        dist = row[1] if distance is not None else None
        item = summary(loc, dist, now, target_date)
        reasons, unknowns, failed = _evaluate(loc, item, p, target_date, today)
        item["match_reasons"] = reasons
        if failed:
            continue
        if unknowns:
            item["unconfirmed"] = unknowns
            uncertain.append(item)
        else:
            matched.append(item)

    _sort(matched, p.sort)
    _sort(uncertain, p.sort)
    start = (p.page - 1) * p.page_size
    return {
        "items": matched[start : start + p.page_size],
        "total": len(matched),
        "page": p.page,
        "page_size": p.page_size,
        "uncertain": uncertain[:50] if p.include_uncertain else [],
        "uncertain_total": len(uncertain),
        "truncated": len(rows) >= MAX_CANDIDATES,
        "coverage": coverage(db, p),
    }


def _evaluate(loc, item, p: SearchParams, target_date, today):
    """Return (reasons, unknown filter names, hard-failed?)."""
    reasons: list[dict] = []
    unknowns: list[str] = []
    if item["distance_km"] is not None:
        reasons.append({"code": "distance", "km": item["distance_km"]})
    for g in p.food_groups:
        reasons.append({"code": "food_group", "value": g})
    for g in p.service_groups:
        reasons.append({"code": "service_group", "value": g})
    if target_date:
        if not item["has_distribution_schedule"]:
            unknowns.append("schedule")
        elif windows_on(target_date, loc.schedules, loc.exceptions, loc.events):
            reasons.append({"code": "distributes_on", "date": target_date.isoformat()})
        else:
            return reasons, unknowns, True
    if p.upcoming_days:
        nd = item["next_distribution"]
        if not item["has_distribution_schedule"]:
            unknowns.append("schedule")
        elif nd and date.fromisoformat(nd["date"]) <= today + timedelta(days=p.upcoming_days):
            reasons.append({"code": "upcoming", "date": nd["date"]})
        else:
            return reasons, unknowns, True
    for key in p.eligibility:
        req, wanted = ELIGIBILITY_FILTERS[key]
        state = eligibility_state(loc, req)
        if state == wanted:
            reasons.append({"code": "eligibility_confirmed", "value": key})
        elif state == "unknown":
            unknowns.append(key)  # never treated as a confirmed match
        else:
            return reasons, unknowns, True
    return reasons, unknowns, False


def _sort(items: list[dict], how: str) -> None:
    far = float("inf")
    if how == "next_distribution":
        items.sort(key=lambda i: (i["next_distribution"] is None,
                                  (i["next_distribution"] or {}).get("date", ""), (i["next_distribution"] or {}).get("opens") or "",
                                  i["distance_km"] if i["distance_km"] is not None else far))
    elif how == "relevance":
        items.sort(key=lambda i: (-len(i["match_reasons"]), len(i["warnings"]), i["distance_km"] if i["distance_km"] is not None else far))
    elif how == "name":
        items.sort(key=lambda i: i["name"].lower())
    else:
        items.sort(key=lambda i: (i["distance_km"] if i["distance_km"] is not None else far, i["name"].lower()))


def coverage(db: Session, p: SearchParams) -> dict:
    """Tell users when the searched area extends beyond jurisdictions with active data collection."""
    active = db.scalars(select(Jurisdiction).where(Jurisdiction.status.in_(("pilot", "expansion")))).all()
    covered_ids = [j.id for j in active]
    complete = None
    if p.lat is not None and p.lon is not None and any(j.boundary is not None for j in active):
        area = func.ST_Buffer(_point(p.lat, p.lon), p.radius_km * 1000)
        complete = bool(db.scalar(select(func.ST_CoveredBy(
            area, cast(func.ST_Union(Jurisdiction.boundary), Geography),
        )).where(Jurisdiction.id.in_(covered_ids), Jurisdiction.boundary.isnot(None))))
    elif p.jurisdiction:
        complete = p.jurisdiction in covered_ids
    return {"covered_jurisdictions": covered_ids, "complete": complete}


def categories(db: Session) -> dict:
    cats = db.scalars(select(ServiceCategory)).all()
    return {
        "food_types": [{"code": c.code, "group": c.group_code} for c in cats if c.kind == "food_type"],
        "service_types": [{"code": c.code, "group": c.group_code} for c in cats if c.kind == "service_type"],
        "food_groups": sorted({c.group_code for c in cats if c.kind == "food_type"}),
        "service_groups": sorted({c.group_code for c in cats if c.kind == "service_type"}),
        "eligibility_filters": list(ELIGIBILITY_FILTERS),
    }
