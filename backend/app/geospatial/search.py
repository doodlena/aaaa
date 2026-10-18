"""Public resource search.

Stage 1 (PostGIS/SQL): visibility rules, radius (ST_DWithin on geography), viewport (envelope), jurisdiction,
food/service category filters, distance (ST_Distance). Stage 2 (Python, on the spatially-bounded set): schedule
and tri-state eligibility evaluation, which need recurrence logic and must keep "unknown" separate from "confirmed".
"""
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from geoalchemy2 import Geography
from sqlalchemy import and_, cast, exists, func, not_, or_, select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.models import DistributionEvent, Jurisdiction, Location, Service, ServiceCategory, ServiceFoodType, Source, SourceRecord
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
    radius_km: float | None = 16.09  # 10 miles; None = no distance limit (results are still sorted from lat/lon)
    bbox: tuple[float, float, float, float] | None = None  # min_lon, min_lat, max_lon, max_lat
    jurisdiction: str | None = None
    q: str | None = None  # name search (place or organization), e.g. "church", "catholic charities"
    food_groups: list[str] = field(default_factory=list)
    food_types: list[str] = field(default_factory=list)
    service_groups: list[str] = field(default_factory=list)
    service_types: list[str] = field(default_factory=list)
    # "all": every selected group must be offered. "any": needs are alternatives — a place matches when it offers any
    # selected service group, or the food need (all selected food groups together).
    need_match: str = "all"
    on_date: date | None = None
    open_today: bool = False
    upcoming_days: int | None = None
    eligibility: list[str] = field(default_factory=list)  # keys of ELIGIBILITY_FILTERS
    wheelchair: bool = False
    live_open: bool = False  # pantry posted "open"/"limited" today
    live_food_groups: list[str] = field(default_factory=list)  # pantry-confirmed on the shelf today
    language: str | None = None
    sort: str = "distance"  # distance | next_distribution | relevance | name
    include_uncertain: bool = True
    page: int = 1
    page_size: int = 20


def source_reported_condition():
    """Unverified real candidates whose linked source permits public display (labelled 'source_reported')."""
    s = get_settings()
    allowed = {"permitted": ["permitted_with_attribution"],
               "internal_preview": ["permitted_with_attribution", "permission_required", "not_assessed"]}.get(s.source_reported)
    if s.source_reported == "internal_preview" and s.environment == "production":
        allowed = ["permitted_with_attribution"]  # restricted datasets are never shown publicly
    if not allowed:
        return None
    return and_(
        Location.review_status.in_(("candidate", "needs_review")),
        Location.last_verified_at.is_(None),
        Location.is_synthetic.is_(False),
        exists(select(1).select_from(SourceRecord).join(Source, Source.id == SourceRecord.source_id).where(
            SourceRecord.location_id == Location.id, SourceRecord.status == "linked",
            Source.config["publication"].as_string().in_(allowed))),
    )


def public_visibility():
    from app.services import demo, site_flags

    from app.geospatial import district

    area = [district.contains(Location.geom)] if site_flags.district_only() else []
    if site_flags.demo_mode():
        # Demo mode: only the published fictional demo providers; real listings are hidden while it is on.
        return and_(demo.is_demo_location(), Location.published.is_(True), Location.review_status.in_(PUBLIC_REVIEW_STATUSES),
                    Location.merged_into_id.is_(None), Location.operating_status != "permanently_closed", Location.geom.isnot(None),
                    *area)
    s = get_settings()
    verified = and_(
        Location.published.is_(True),
        # verified/stale, or previously verified and now flagged for re-check (keeps its verified data visible)
        Location.review_status.in_(PUBLIC_REVIEW_STATUSES)
        | ((Location.review_status == "needs_review") & Location.last_verified_at.isnot(None)),
    )
    sr = source_reported_condition()
    cond = [
        or_(verified, sr) if sr is not None else verified,
        # Only places in jurisdictions that are switched on (pilot/expansion); others stay in the database, unshown.
        Location.jurisdiction_id.in_(select(Jurisdiction.id).where(Jurisdiction.status.in_(("pilot", "expansion")))),
        Location.merged_into_id.is_(None),
        Location.operating_status != "permanently_closed",
        Location.geom.isnot(None),
        *area,  # e.g. only Virginia's 8th congressional district (Admin → Site settings)
    ]
    if not s.show_synthetic:
        cond.append(Location.is_synthetic.is_(False))
    else:
        cond.append(not_(demo.is_demo_location()))
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
        if not p.bbox and p.radius_km is not None:
            conds.append(func.ST_DWithin(Location.geom, pt, p.radius_km * 1000))
    if p.bbox:
        conds.append(func.ST_Intersects(Location.geom, cast(func.ST_MakeEnvelope(*p.bbox, 4326), Geography)))
    if p.jurisdiction:
        conds.append(Location.jurisdiction_id == p.jurisdiction)
    if p.q:
        from app.models import Organization

        for term in p.q.lower().split()[:6]:  # every word must match the place or organization name
            like = f"%{term}%"
            conds.append(or_(func.lower(Location.name).like(like),
                             exists(select(1).where(Organization.id == Location.organization_id, func.lower(Organization.name).like(like)))))
    # Each selected food group / service group must be offered (AND across selections, any code within a group),
    # unless need_match="any" makes the selected needs alternatives.
    food = [_food_filter([c for c, grp in FOOD_TYPES.items() if grp == g]) for g in p.food_groups]
    service = [_service_filter([c for c, grp in SERVICE_TYPES.items() if grp == g]) for g in p.service_groups]
    if p.need_match == "any":
        alternatives = service + ([and_(*food)] if food else [])
        if alternatives:
            conds.append(or_(*alternatives))
    else:
        conds += food + service
    for c in p.food_types:
        conds.append(_food_filter([c]))
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

    from app.services.shelf import current_shelf, open_report_counts, shelf_dict

    target_date = today if p.open_today else p.on_date
    ids = [row[0].id for row in rows]
    from app.services.site_flags import provider_features

    live_on = provider_features()  # live provider updates switched off: no posts shown, live filters ignored
    shelves = current_shelf(db, ids, now) if live_on else {}
    if not live_on:
        p.live_open, p.live_food_groups = False, []
    reports = open_report_counts(db, ids)
    matched, uncertain = [], []
    for row in rows:
        loc = row[0]
        dist = row[1] if distance is not None else None
        live = shelf_dict(shelves.get(loc.id))
        if p.live_open and not (live and live["status"] in ("open", "limited")):
            continue
        if p.live_food_groups and not (live and set(p.live_food_groups) <= {i["group"] for i in live["items"]}):
            continue
        item = summary(loc, dist, now, target_date, live, reports.get(loc.id, 0))
        closed_today = bool(live and live["status"] in ("closed", "out"))
        if closed_today:
            item["warnings"].append("closed_today_by_pantry" if live["status"] == "closed" else "out_today_by_pantry")
        if closed_today and target_date == today:
            continue  # the pantry itself says no food today
        reasons, unknowns, failed = _evaluate(loc, item, p, target_date, today)
        reasons += [{"code": "on_shelf_today", "value": g} for g in p.live_food_groups]
        if p.live_open:
            reasons.append({"code": "open_today_by_pantry"})
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
    # With need_match="any" a place may offer only some of the selected needs: list the ones it really offers.
    any_need = p.need_match == "any"
    offered_food = set(item["food_groups"])
    offered_service = {SERVICE_TYPES[s] for s in item["service_types"] if s in SERVICE_TYPES}
    for g in p.food_groups:
        if not any_need or g in offered_food:
            reasons.append({"code": "food_group", "value": g})
    for g in p.service_groups:
        if not any_need or g in offered_service:
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
    if p.lat is not None and p.lon is not None and p.radius_km is None:
        complete = False  # no distance limit always reaches beyond the places where data is being collected
    elif p.lat is not None and p.lon is not None and any(j.boundary is not None for j in active):
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
