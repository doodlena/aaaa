"""Write normalized structures (services, schedules, eligibility, coordinates) onto a Location.

Used by ingestion (for unverified candidates), by admin edits, and when accepting change proposals.
"""
from datetime import date, time

from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import Point

from app.models import EligibilityRequirement, Location, Schedule, Service, ServiceFoodType


def _t(v: str) -> time:
    h, m = v.split(":")
    return time(int(h), int(m))


def set_coords(loc: Location, lat: float | None, lon: float | None, source: str | None) -> None:
    if lat is None or lon is None:
        loc.geom = None
        loc.geocode_source = None
        return
    loc.geom = from_shape(Point(lon, lat), srid=4326)
    loc.geocode_source = (source or "")[:64] or None  # free-text labels from research files can be long


def coords_of(loc: Location) -> dict | None:
    if loc.geom is None:
        return None
    p = to_shape(loc.geom)
    return {"lat": round(p.y, 6), "lon": round(p.x, 6)}


def _d(v):
    return date.fromisoformat(v) if isinstance(v, str) else v


def _schedule(d: dict, loc: Location, service: Service | None, src: int | None) -> Schedule:
    return Schedule(
        location=loc, service_id=service.id if service else None, kind=d.get("kind", "distribution"), weekday=d["weekday"],
        opens=_t(d["opens"]), closes=_t(d["closes"]), week_of_month=d.get("week_of_month"), valid_from=_d(d.get("valid_from")),
        valid_to=_d(d.get("valid_to")), appointment_only=d.get("appointment_only", False), notes=d.get("notes"), source_record_id=src,
    )


def replace_structures(db, loc: Location, services: list[dict] | None, schedules: list[dict] | None,
                       eligibility: list[dict] | None, source_record_id: int | None = None) -> None:
    """Replace whichever of the three sets is not None. services[i] may carry nested schedules/eligibility."""
    if services is not None:
        for s in list(loc.services):
            loc.services.remove(s)
        # service-scoped rows are removed with their service via FK cascade; drop them from the session too
        loc.schedules[:] = [s for s in loc.schedules if s.service_id is None]
        loc.eligibility[:] = [e for e in loc.eligibility if e.service_id is None]
        db.flush()
        for sd in services:
            svc = Service(
                location=loc, service_type=sd["service_type"], description=sd.get("description"),
                description_lang=sd.get("description_lang"), offering_status=sd.get("offering_status", "unconfirmed"),
                frequency=sd.get("frequency"), appointment_required=sd.get("appointment_required", "unknown"),
                registration_required=sd.get("registration_required", "unknown"), household_limit=sd.get("household_limit"),
                visit_limit=sd.get("visit_limit"), notes=sd.get("notes"), source_record_id=source_record_id,
            )
            svc.food_types = [ServiceFoodType(food_type=f, source_record_id=source_record_id) for f in dict.fromkeys(sd.get("food_types", []))]
            db.add(svc)
            db.flush()
            for sch in sd.get("schedules", []):
                db.add(_schedule(sch, loc, svc, source_record_id))
            for el in sd.get("eligibility", []):
                db.add(EligibilityRequirement(location=loc, service_id=svc.id, requirement_type=el["requirement_type"],
                                              status=el["status"], details=el.get("details"), values=el.get("values") or {},
                                              source_record_id=source_record_id))
    if schedules is not None:
        loc.schedules[:] = [s for s in loc.schedules if s.service_id is not None]
        db.flush()
        for sch in schedules:
            db.add(_schedule(sch, loc, None, source_record_id))
    if eligibility is not None:
        loc.eligibility[:] = [e for e in loc.eligibility if e.service_id is not None]
        db.flush()
        for el in eligibility:
            db.add(EligibilityRequirement(location=loc, service_id=None, requirement_type=el["requirement_type"],
                                          status=el["status"], details=el.get("details"), values=el.get("values") or {},
                                          source_record_id=source_record_id))
    db.flush()


def apply_service_type_delta(db, loc: Location, add: list[str], remove: list[str]) -> None:
    """Add/remove whole service categories without touching the other services' details (an accepted category change).

    Added categories start as `unconfirmed` with nothing else filled in; removed ones drop their service-scoped rows.
    """
    from app.vocab import SERVICE_TYPES

    removed_ids = {s.id for s in loc.services if s.service_type in remove}
    for s in [s for s in loc.services if s.id in removed_ids]:
        loc.services.remove(s)
    loc.schedules[:] = [s for s in loc.schedules if s.service_id not in removed_ids]
    loc.eligibility[:] = [e for e in loc.eligibility if e.service_id not in removed_ids]
    db.flush()
    have = {s.service_type for s in loc.services}
    for code in dict.fromkeys(add):
        if code in SERVICE_TYPES and code not in have:
            db.add(Service(location=loc, service_type=code, offering_status="unconfirmed"))
    db.flush()


def structures_of(loc: Location) -> dict:
    """Comparable representation of the nested structures (used for change detection)."""
    def sched(s):
        return {"kind": s.kind, "weekday": s.weekday, "opens": s.opens.strftime("%H:%M"), "closes": s.closes.strftime("%H:%M"),
                "week_of_month": s.week_of_month, "appointment_only": s.appointment_only}

    def elig(e):
        return {"requirement_type": e.requirement_type, "status": e.status}

    services = []
    for s in sorted(loc.services, key=lambda s: s.service_type):
        services.append({
            "service_type": s.service_type, "food_types": sorted(f.food_type for f in s.food_types),
            "appointment_required": s.appointment_required, "registration_required": s.registration_required,
            "schedules": sorted((sched(x) for x in loc.schedules if x.service_id == s.id), key=str),
            "eligibility": sorted((elig(x) for x in loc.eligibility if x.service_id == s.id), key=str),
        })
    return {
        "services": services,
        "schedules": sorted((sched(x) for x in loc.schedules if x.service_id is None), key=str),
        "eligibility": sorted((elig(x) for x in loc.eligibility if x.service_id is None), key=str),
    }


def comparable_services(services: list[dict]) -> list[dict]:
    out = []
    for s in sorted(services, key=lambda s: s["service_type"]):
        out.append({
            "service_type": s["service_type"], "food_types": sorted(set(s.get("food_types", []))),
            "appointment_required": s.get("appointment_required", "unknown"),
            "registration_required": s.get("registration_required", "unknown"),
            "schedules": sorted(({k: x.get(k, d) for k, d in (("kind", "distribution"), ("weekday", None), ("opens", None),
                                 ("closes", None), ("week_of_month", None), ("appointment_only", False))}
                                 for x in s.get("schedules", [])), key=str),
            "eligibility": sorted(({"requirement_type": e["requirement_type"], "status": e["status"]} for e in s.get("eligibility", [])), key=str),
        })
    return out


def comparable_schedules(items: list[dict]) -> list[dict]:
    return sorted(({k: x.get(k, d) for k, d in (("kind", "distribution"), ("weekday", None), ("opens", None), ("closes", None),
                    ("week_of_month", None), ("appointment_only", False))} for x in items), key=str)


def comparable_eligibility(items: list[dict]) -> list[dict]:
    return sorted(({"requirement_type": e["requirement_type"], "status": e["status"]} for e in items), key=str)
