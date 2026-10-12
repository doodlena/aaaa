"""Fill in hours, eligibility, what-to-bring and food details for listings from each provider's OWN website.

- Pages are fetched politely (robots.txt, rate limit, HTTP cache); blocked sites are skipped.
- AI (cheap model) extracts places from the page text; every kept value must appear verbatim on the page.
- Only details are added to a listing's EXISTING categories — this never adds new service categories.
- Results are written to data/sources/ai_website_enrichment.json and imported like any other cited source, so they
  merge into the listing with field provenance and the page linked as the source.
"""
import json
import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from rapidfuzz import fuzz
from sqlalchemy import select

from app.config import REPO_ROOT
from app.ingestion.adapters.ai_extract import page_text
from app.ingestion.base import Fetcher, FetchError, SourceConfig
from app.ingestion.normalization.text import normalize_address, normalize_name, normalize_url
from app.models import EligibilityRequirement, Location, Schedule
from app.services import ai

OUT = REPO_ROOT / "data" / "sources" / "ai_website_enrichment.json"
KEYWORDS = re.compile(r"food|pantry|meal|hours|eligib|services|get[- ]help|assistance|programs|clinic|what to bring|visit", re.I)
POLITE = SourceConfig(id="ai-website-enrichment", name="Provider websites", url="https://example.org", adapter="structured_json",
                      jurisdictions=["*"], min_seconds_between_requests=2.0, cache_ttl_hours=24 * 14)
GENERIC_DOMAINS = ("inova.org", "facebook.com", "instagram.com", "fairfaxcounty.gov", "arlingtonva.us", "pwcva.gov", "loudoun.gov",
                   "alexandriava.gov", "vdh.virginia.gov", "findtreatment.gov", "data.hrsa.gov")


def _links(html: str, base: str) -> list[str]:
    soup = BeautifulSoup(html, "lxml")
    host = urlparse(base).netloc
    out = []
    for a in soup.find_all("a", href=True):
        u = urljoin(base, a["href"]).split("#")[0]
        if urlparse(u).netloc == host and u != base and KEYWORDS.search((a.get_text(" ") or "") + " " + u):
            out.append(u)
    return list(dict.fromkeys(out))[:2]


def _match(places: list[dict], loc: Location) -> dict | None:
    want_addr = normalize_address(loc.address1, loc.zip) or ""
    num = (re.match(r"\d+", want_addr) or [None])[0] if want_addr else None
    best, score = None, 0.0
    for p in places:
        s = fuzz.token_set_ratio(normalize_name(p.get("location_name") or p["organization_name"]), normalize_name(loc.name)) / 100
        a = normalize_address(p.get("address1"), p.get("zip")) or ""
        if num and a.startswith(num + " "):
            s += 0.6
        elif a and num and not a.startswith(num + " "):
            s -= 0.5  # a different street address on the page: that's another site
        if s > score:
            best, score = p, s
    if best and (score >= 0.9 or (len(places) == 1 and score >= 0.5)):
        return best
    return None


def enrich(db, limit: int = 50, jurisdiction: str | None = None) -> dict:
    existing = json.loads(OUT.read_text())["records"] if OUT.exists() else []
    by_id = {r["external_id"]: r for r in existing}
    q = select(Location).where(Location.is_synthetic.is_(False), Location.merged_into_id.is_(None),
                               Location.review_status.in_(("candidate", "needs_review")), Location.last_verified_at.is_(None))
    if jurisdiction:
        q = q.where(Location.jurisdiction_id == jurisdiction)
    fetcher = Fetcher()
    stats = {"checked": 0, "enriched": 0, "no_site": 0, "blocked": 0, "no_match": 0, "already": 0}
    for loc in db.scalars(q.order_by(Location.id)).all():
        if stats["checked"] >= limit:
            break
        has_sched = db.scalar(select(Schedule.id).where(Schedule.location_id == loc.id).limit(1))
        has_elig = db.scalar(select(EligibilityRequirement.id).where(EligibilityRequirement.location_id == loc.id,
                                                                     EligibilityRequirement.status != "unknown").limit(1))
        if has_sched and has_elig:
            continue
        if f"site-{loc.id}" in by_id:
            stats["already"] += 1
            continue
        site = normalize_url(loc.website or loc.organization.website)
        if not site or any(d in site for d in GENERIC_DOMAINS):
            stats["no_site"] += 1
            continue
        stats["checked"] += 1
        try:
            home = fetcher.get(site, POLITE)
        except FetchError:
            stats["blocked"] += 1
            continue
        pages = [home]
        for u in _links(home.text(), home.url):
            try:
                pages.append(fetcher.get(u, POLITE))
            except FetchError:
                pass
        hit = None
        for doc in pages:
            try:
                text = page_text(doc)
                if len(text) < 200:
                    continue
                places = ai.extract_places(text, doc.url, feature="site_extract")
            except ai.AIUnavailable as e:
                stats["stopped"] = str(e)
                return _save(by_id, stats)
            except Exception:  # unreadable page
                continue
            m = _match(places, loc)
            if m and (m.get("hours_text") or m.get("eligibility_text") or m.get("food_types")):
                hit = (m, doc.url)
                break
        if not hit:
            stats["no_match"] += 1
            continue
        m, url = hit
        types = sorted({s.service_type for s in loc.services}) or ["other"]
        food_ok = {"pantry_pickup", "walk_up", "drive_through", "mobile_pantry", "community_meal", "emergency_food",
                   "senior_meals", "kids_meals", "school_based", "delivery_qualifying", "home_delivery"}
        by_id[f"site-{loc.id}"] = {
            "external_id": f"site-{loc.id}", "source_url": url, "organization_name": loc.organization.name,
            "location_name": loc.name, "address1": loc.address1, "address2": loc.address2, "city": loc.city, "zip": loc.zip,
            "lat": _coord(loc)[0], "lon": _coord(loc)[1], "geocode_source": "existing listing", "phone": loc.phone,
            "raw_hours_text": m.get("hours_text"), "raw_eligibility_text": m.get("eligibility_text"),
            "notes": "From the provider's website (AI-extracted, verbatim-checked): " + " | ".join(m.get("evidence") or [])[:500],
            # existing categories only; details attach to them
            "service_types": types, "food_types": [f for f in (m.get("food_types") or [])] if set(types) & food_ok else [],
            "description": m.get("description"),
        }
        stats["enriched"] += 1
    return _save(by_id, stats)


def _coord(loc: Location):
    from app.services.resource_writer import coords_of

    c = coords_of(loc) or {}
    return c.get("lat"), c.get("lon")


def _save(by_id: dict, stats: dict) -> dict:
    from app.ingestion.candidate import CandidateEligibility, CandidateResource, CandidateSchedule, CandidateService
    from app.ingestion.normalization.text import clean_text, eligibility_from_text, parse_schedule_text

    food_ok = {"pantry_pickup", "walk_up", "drive_through", "mobile_pantry", "community_meal", "emergency_food", "senior_meals",
               "kids_meals", "school_based", "delivery_qualifying", "home_delivery"}
    records = []
    for r in by_id.values():
        if "services" in r:  # already in final shape
            records.append(r)
            continue
        hours = clean_text(r.get("raw_hours_text"), keep_lines=True)
        sched = parse_schedule_text(hours)
        food_ok = {"pantry_pickup", "walk_up", "drive_through", "mobile_pantry", "community_meal", "emergency_food", "senior_meals",
                   "kids_meals", "school_based", "delivery_qualifying", "home_delivery"}
        services = []
        for i, t in enumerate(r["service_types"]):
            services.append(CandidateService(service_type=t, description=r.get("description") if i == 0 else None,
                                             food_types=r["food_types"] if t in food_ok else [],
                                             schedules=[CandidateSchedule(**x) for x in sched] if i == 0 and t in food_ok else []).model_dump())
        elig = [CandidateEligibility(requirement_type=k, status=v, details=clean_text(r.get("raw_eligibility_text"))).model_dump()
                for k, v in eligibility_from_text(r.get("raw_eligibility_text")).items()]
        loc_sched = [] if set(r["service_types"]) & food_ok else [CandidateSchedule(**{**x, "kind": "operating_hours"}).model_dump() for x in sched]
        rec = {k: v for k, v in r.items() if k not in ("service_types", "food_types", "description")}
        rec.update({"services": services, "eligibility": elig, "schedules": loc_sched})
        CandidateResource(**rec)  # validate
        records.append(rec)
    for rec in records:
        _ai_fill(rec, food_ok, stats)
    OUT.write_text(json.dumps({"_notice": "Details extracted with AI from each provider's own website; every value appears verbatim "
                                          "on the cited page (source_url). Unverified.", "records": records}, indent=1, ensure_ascii=False))
    return stats


def _ai_fill(rec: dict, food_ok: set, stats: dict) -> None:
    """When the rule parser couldn't read the hours/eligibility wording, ask the AI 'structure' step.

    Every schedule/requirement it returns is backed by a verbatim quote of the page text (checked in ai.suggest_structure).
    Distribution times are only attached to food services; nothing is invented when the text is absent.
    """
    has_sched = bool(rec["schedules"]) or any(s["schedules"] for s in rec["services"])
    text = "\n".join(t for t in (rec.get("raw_hours_text"), rec.get("raw_eligibility_text")) if t)
    food = [s for s in rec["services"] if s["service_type"] in food_ok]
    want_sched = not has_sched and rec.get("raw_hours_text") and food
    want_elig = not rec["eligibility"] and rec.get("raw_eligibility_text")
    if not text or not (want_sched or want_elig):
        return
    try:
        out = ai.suggest_structure(text)
    except ai.AIUnavailable:
        return
    if want_sched and out.distribution_schedules:
        food[0]["schedules"] = [{"kind": "distribution", "weekday": x.weekday, "opens": x.opens, "closes": x.closes,
                                 "week_of_month": x.week_of_month, "appointment_only": False, "notes": None}
                                for x in out.distribution_schedules]
        stats["ai_schedules"] = stats.get("ai_schedules", 0) + 1
    if want_elig and out.eligibility:
        rec["eligibility"] = [{"requirement_type": e.requirement_type, "status": e.status, "details": e.evidence, "values": {}}
                              for e in out.eligibility]
        stats["ai_eligibility"] = stats.get("ai_eligibility", 0) + 1


LOOKUP_OUT = REPO_ROOT / "data" / "sources" / "ai_listing_lookup.json"
FOOD_TYPES = {"pantry_pickup", "walk_up", "drive_through", "mobile_pantry", "community_meal", "emergency_food", "senior_meals",
              "kids_meals", "school_based", "delivery_qualifying", "home_delivery"}


def lookup_missing(db, limit: int = 50, food_only: bool = True) -> dict:
    """Per-listing AI web lookup (cited) for listings missing hours or eligibility, then turn the CITED QUOTES into
    structured schedules/eligibility (verbatim-checked against the quoted page text). Never marks anything verified."""
    from app.api.public import _missing_fields, detail_with_live, load_location  # same 'what is missing' logic as the button

    existing = json.loads(LOOKUP_OUT.read_text())["records"] if LOOKUP_OUT.exists() else []
    by_id = {r["external_id"]: r for r in existing}
    stats = {"looked_up": 0, "cached": 0, "with_hours": 0, "with_eligibility": 0, "nothing_found": 0}
    q = select(Location).where(Location.is_synthetic.is_(False), Location.merged_into_id.is_(None),
                               Location.review_status.in_(("candidate", "needs_review", "stale")), Location.last_verified_at.is_(None))
    locs = db.scalars(q.order_by(Location.id)).all()
    is_food = lambda l: bool({s.service_type for s in l.services} & FOOD_TYPES)  # noqa: E731
    locs = sorted(locs, key=lambda l: not is_food(l))
    for loc in locs:
        if stats["looked_up"] >= limit:
            break
        if food_only and not is_food(loc):
            continue
        has_sched = db.scalar(select(Schedule.id).where(Schedule.location_id == loc.id).limit(1))
        has_elig = db.scalar(select(EligibilityRequirement.id).where(EligibilityRequirement.location_id == loc.id,
                                                                     EligibilityRequirement.status != "unknown").limit(1))
        if has_sched and has_elig:
            continue
        try:
            d = detail_with_live(db, load_location(db, loc.id), None)
        except Exception:
            continue
        missing = _missing_fields(d)
        cached = ai.enrich_cached(loc.id)
        info = {"name": loc.name, "organization": loc.organization.name, "address": ", ".join(x for x in (loc.address1, loc.city, loc.zip) if x),
                "website": loc.website or loc.organization.website, "phone": loc.phone}
        try:
            out = cached if cached is not None else ai.enrich_listing(loc.id, info, missing)
        except ai.AIUnavailable as e:
            stats["stopped"] = str(e)
            break
        stats["cached" if cached is not None else "looked_up"] += 1
        rec = _record_from_lookup(loc, out, stats)
        if rec:
            by_id[rec["external_id"]] = rec
        LOOKUP_OUT.write_text(json.dumps({"_notice": "Hours/eligibility from a per-listing AI web lookup. Every value is backed by "
                                                     "a quote from the cited page (source_url). Unverified.",
                                          "records": list(by_id.values())}, indent=1, ensure_ascii=False))
    return stats


def _record_from_lookup(loc: Location, out: dict, stats: dict) -> dict | None:
    fields = {f["field"]: f for f in out.get("fields", [])}
    hours = [f for k, f in fields.items() if k in ("hours", "dates")]
    elig = [f for k, f in fields.items() if k in ("eligibility", "id_required")]
    # The structure step only sees text quoted from the cited pages, so every value is checked against the page itself.
    quotes = lambda fs: "\n".join(s["quote"] for f in fs for s in f["sources"] if s.get("quote"))  # noqa: E731
    text = "\n".join(t for t in (quotes(hours), quotes(elig)) if t)
    if not text.strip():
        stats["nothing_found"] += 1
        return None
    try:
        st = ai.suggest_structure(text)
    except ai.AIUnavailable:
        return None
    types = sorted({s.service_type for s in loc.services}) or ["other"]
    food = [t for t in types if t in FOOD_TYPES]
    sched = [{"kind": "distribution", "weekday": x.weekday, "opens": x.opens, "closes": x.closes, "week_of_month": x.week_of_month,
              "appointment_only": False, "notes": None} for x in st.distribution_schedules] if food else []
    eligibility = [{"requirement_type": e.requirement_type, "status": e.status, "details": e.evidence, "values": {}} for e in st.eligibility]
    if not sched and not eligibility:
        stats["nothing_found"] += 1
        return None
    stats["with_hours"] += bool(sched)
    stats["with_eligibility"] += bool(eligibility)
    src = next((s["url"] for f in (hours if sched else []) + elig + hours for s in f["sources"]), None)
    lat, lon = _coord(loc)
    services = [{"service_type": t, "description": None, "food_types": [], "schedules": sched if t == (food[0] if food else None) else []}
                for t in types]
    from app.ingestion.candidate import CandidateResource

    rec = {"external_id": f"lookup-{loc.id}", "source_url": src, "organization_name": loc.organization.name, "location_name": loc.name,
           "address1": loc.address1, "address2": loc.address2, "city": loc.city, "zip": loc.zip, "lat": lat, "lon": lon,
           "geocode_source": "existing listing", "phone": loc.phone, "services": services, "eligibility": eligibility, "schedules": [],
           "notes": "AI web lookup, cited: " + " | ".join(s["quote"][:150] for f in hours + elig for s in f["sources"][:1])[:600]}
    CandidateResource(**rec)  # validate
    return rec
