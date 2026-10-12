"""Turn ORM rows into API dicts. Unknowns stay explicit (`unknown` / null) — never defaulted to permissive values."""
from datetime import UTC, date, datetime, timedelta

from app.config import get_settings
from app.models import Location
from app.services.schedule import TZ, has_any_distribution_info, next_distribution, windows_on
from app.vocab import FOOD_TYPES

SUMMARY_ELIGIBILITY = ("photo_id", "proof_of_address", "income_documentation", "appointment", "residency", "referral",
                       "registration", "student_affiliation")


def verification_label(loc: Location, now: datetime | None = None) -> str:
    """verified | stale | source_reported | needs_review | rejected | candidate (public API only ever sees the first two)."""
    if loc.review_status in ("verified", "stale"):
        fresh = timedelta(days=get_settings().verification_fresh_days)
        now = now or datetime.now(UTC)
        if loc.review_status == "stale" or not loc.last_verified_at or now - loc.last_verified_at > fresh:
            return "stale"
        return "verified"
    return {"candidate": "source_reported"}.get(loc.review_status, loc.review_status)


def eligibility_state(loc: Location, requirement: str, service_ids: set[int] | None = None) -> str:
    """Effective state for a requirement at a location.

    'required' if any applicable row says required; 'not_required' only if at least one applicable row confirms it
    and none require it; otherwise 'unknown'. Service-scoped rows apply only when that service is in scope.
    """
    rows = [
        e for e in loc.eligibility
        if e.requirement_type == requirement and (e.service_id is None or service_ids is None or e.service_id in service_ids)
    ]
    if any(e.status == "required" for e in rows):
        return "required"
    if any(e.status == "not_required" for e in rows):
        return "not_required"
    if requirement == "appointment":
        svc = [s.appointment_required for s in loc.services if service_ids is None or s.id in service_ids]
        if "required" in svc:
            return "required"
        if svc and all(v == "not_required" for v in svc):
            return "not_required"
    return "unknown"


def food_types_of(loc: Location) -> list[str]:
    return sorted({f.food_type for s in loc.services for f in s.food_types})


def summary(loc: Location, distance_m: float | None = None, now: datetime | None = None, on_date: date | None = None) -> dict:
    now = now or datetime.now(UTC)
    ftypes = food_types_of(loc)
    nxt = next_distribution(now, loc.schedules, loc.exceptions, loc.events)
    has_sched = has_any_distribution_info(loc.schedules, loc.events)
    label = verification_label(loc, now)
    warnings = []
    if label == "stale":
        warnings.append("stale")
    if not has_sched:
        warnings.append("schedule_unknown")
    elig = {r: eligibility_state(loc, r) for r in SUMMARY_ELIGIBILITY}
    if all(v == "unknown" for v in elig.values()):
        warnings.append("eligibility_unknown")
    if loc.operating_status in ("temporarily_closed", "permanently_closed"):
        warnings.append(loc.operating_status)
    if loc.is_synthetic:
        warnings.append("synthetic")
    lat = lon = None
    if loc.geom is not None:
        from geoalchemy2.shape import to_shape

        pt = to_shape(loc.geom)
        lat, lon = pt.y, pt.x
    return {
        "id": loc.id,
        "name": loc.name,
        "organization_name": loc.organization.public_name or loc.organization.name,
        "address": {"address1": loc.address1, "address2": loc.address2, "city": loc.city, "state": loc.state, "zip": loc.zip},
        "lat": lat,
        "lon": lon,
        "distance_km": round(distance_m / 1000, 2) if distance_m is not None else None,
        "jurisdiction_id": loc.jurisdiction_id,
        "phone": loc.phone or loc.organization.phone,
        "website": loc.website or loc.organization.website,
        "verification_label": label,
        "last_verified_at": loc.last_verified_at.isoformat() if loc.last_verified_at else None,
        "operating_status": loc.operating_status,
        "food_types": ftypes,
        "food_groups": sorted({FOOD_TYPES[f] for f in ftypes}),
        "service_types": sorted({s.service_type for s in loc.services}),
        "has_distribution_schedule": has_sched,
        "next_distribution": nxt.as_dict() if nxt else None,
        "distributing_on_date": (bool(windows_on(on_date, loc.schedules, loc.exceptions, loc.events)) if has_sched else None)
        if on_date else None,
        "eligibility": elig,
        "wheelchair_accessible": loc.wheelchair_accessible,
        "languages": loc.languages or [],
        "warnings": warnings,
        "is_synthetic": loc.is_synthetic,
        "match_reasons": [],
    }


def _sched(s) -> dict:
    return {
        "weekday": s.weekday, "opens": s.opens.strftime("%H:%M"), "closes": s.closes.strftime("%H:%M"),
        "week_of_month": s.week_of_month, "valid_from": s.valid_from.isoformat() if s.valid_from else None,
        "valid_to": s.valid_to.isoformat() if s.valid_to else None, "appointment_only": s.appointment_only,
        "notes": s.notes, "service_id": s.service_id,
    }


def _elig(e) -> dict:
    return {
        "requirement_type": e.requirement_type, "status": e.status, "details": e.details, "values": e.values or {},
        "scope": "service" if e.service_id else "location", "service_id": e.service_id,
        "verified_at": e.verified_at.isoformat() if e.verified_at else None,
    }


def detail(loc: Location, sources: list[dict], translations: dict, now: datetime | None = None) -> dict:
    now = now or datetime.now(UTC)
    out = summary(loc, now=now)
    today = now.astimezone(TZ).date()
    windows = []
    for i in range(14):
        windows += [w.as_dict() for w in windows_on(today + timedelta(days=i), loc.schedules, loc.exceptions, loc.events)]
    org = loc.organization
    out.update({
        "organization": {"name": org.name, "public_name": org.public_name, "website": org.website, "phone": org.phone,
                         "description": org.description, "description_lang": org.description_lang},
        "location_website": loc.website,
        "email": loc.email,
        "registration_url": loc.registration_url,
        "accessibility": {"wheelchair_accessible": loc.wheelchair_accessible, "notes": loc.accessibility_notes,
                          "parking": loc.parking_notes, "transit": loc.transit_notes, "entrance": loc.entrance_notes},
        "notes": loc.notes,
        "notes_lang": loc.notes_lang,
        "services": [
            {
                "id": s.id, "service_type": s.service_type, "description": s.description, "description_lang": s.description_lang,
                "offering_status": s.offering_status, "frequency": s.frequency, "appointment_required": s.appointment_required,
                "registration_required": s.registration_required, "household_limit": s.household_limit,
                "visit_limit": s.visit_limit, "notes": s.notes, "food_types": sorted(f.food_type for f in s.food_types),
                "last_verified_at": s.last_verified_at.isoformat() if s.last_verified_at else None,
            }
            for s in loc.services
        ],
        "eligibility_details": [_elig(e) for e in loc.eligibility],
        "schedules": {
            "distribution": [_sched(s) for s in loc.schedules if s.kind == "distribution"],
            "operating_hours": [_sched(s) for s in loc.schedules if s.kind == "operating_hours"],
        },
        "upcoming_windows": windows,
        "exceptions": [
            {"date": e.date.isoformat(), "kind": e.kind, "reason": e.reason,
             "opens": e.opens.strftime("%H:%M") if e.opens else None, "closes": e.closes.strftime("%H:%M") if e.closes else None}
            for e in loc.exceptions if e.date >= today
        ],
        "events": [
            {"id": e.id, "title": e.title, "starts_at": e.starts_at.isoformat(), "ends_at": e.ends_at.isoformat() if e.ends_at else None,
             "registration_deadline": e.registration_deadline.isoformat() if e.registration_deadline else None,
             "appointment_required": e.appointment_required, "status": e.status, "notes": e.notes,
             "offerings": sorted(o.food_type for o in e.offerings)}
            for e in sorted(loc.events, key=lambda e: e.starts_at) if e.starts_at >= now - timedelta(days=1)
        ],
        "current_inventory": None,  # no provider-confirmed inventory feed exists yet; UI says selection may vary
        "sources": sources,
        "translations": translations,
        "directions": directions(out["lat"], out["lon"]),
    })
    return out


def directions(lat, lon) -> dict | None:
    if lat is None or lon is None:
        return None
    return {
        "osm": f"https://www.openstreetmap.org/directions?route=%3B{lat}%2C{lon}",
        "geo": f"geo:{lat},{lon}",
        "apple": f"https://maps.apple.com/?daddr={lat},{lon}",
        "google": f"https://www.google.com/maps/dir/?api=1&destination={lat},{lon}",
    }
