"""Source-specific normalizers for the pilot's ArcGIS FeatureServer feeds (schemas documented in
docs/pilot_research/SOURCE_DISCOVERY.md; samples in docs/pilot_research/samples/).

Each maps only what the source states. Yes/No survey answers become confirmed tri-states; blanks stay unknown.
"""
import re
from collections.abc import Iterable
from urllib.parse import urlencode

from app.ingestion.adapters.generic import ArcGISAdapter
from app.ingestion.base import RawRecord, register
from app.ingestion.candidate import CandidateEligibility, CandidateResource, CandidateSchedule, CandidateService
from app.ingestion.normalization.text import (
    SERVICE_KEYWORDS,
    clean_text,
    eligibility_from_text,
    food_types_from_text,
    match_keywords,
    normalize_phone,
    normalize_url,
    normalize_zip,
    parse_schedule_text,
)

DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
NON_FOOD = {"diapers", "hygiene_supplies", "household_essentials", "food_referral"}


class ScopedArcGIS(ArcGISAdapter):
    """Builds one query per in-scope jurisdiction from options.where_by_jurisdiction (keeps requests to the pilot)."""

    scope: set[str] | None = None

    def discover(self) -> Iterable[str]:
        o = self.config.options
        wheres = o.get("where_by_jurisdiction") or {}
        clauses = [w for j, w in wheres.items() if self.scope is None or j in self.scope] if wheres else [o.get("where", "1=1")]
        for w in clauses:
            yield f"{o['query_url']}?" + urlencode({"where": w, "outFields": "*", "outSR": 4326, "f": "geojson",
                                                     "resultRecordCount": o.get("page_size", 2000)})


def _yn(v) -> str:
    s = str(v or "").strip().lower()
    return "yes" if s.startswith("yes") or s == "true" else "no" if s.startswith("no") or s == "false" else "unknown"


def _el(rt, status, details=None, values=None):
    return CandidateEligibility(requirement_type=rt, status=status, details=details, values=values or {})


def _time12(t: str | None) -> str | None:
    m = re.match(r"\s*(\d{1,2}):(\d{2})\s*([AP]M)", str(t or ""), re.I)
    if not m:
        return None
    h, mi, ap = int(m.group(1)), int(m.group(2)), m.group(3).upper()
    h = (h % 12) + (12 if ap == "PM" else 0)
    return f"{h:02d}:{mi:02d}"


def _week_rule(freq: str) -> tuple[bool, int | None]:
    """('Every week' -> weekly). Ordinal weeks -> monthly. Anything else -> not representable (kept as notes)."""
    f = (freq or "").lower()
    if "every week" in f or f == "weekly":
        return True, None
    m = re.search(r"\b(1st|2nd|3rd|4th|5th|first|second|third|fourth|last)\b", f)
    if m:
        return True, {"1st": 1, "first": 1, "2nd": 2, "second": 2, "3rd": 3, "third": 3, "4th": 4, "fourth": 4, "5th": 5, "last": -1}[m.group(1)]
    return False, None


@register("cafb_get_help")
class CAFBGetHelp(ScopedArcGIS):
    """Capital Area Food Bank 'Get Help' partner map: 7 days x up to 3 distribution slots."""

    def normalize(self, raw: RawRecord) -> CandidateResource:
        d = raw.data
        services: dict[str, CandidateService] = {}
        elig: dict[str, CandidateEligibility] = {}
        notes = []
        for day_i, day in enumerate(DAYS):
            for k in (1, 2, 3):
                freq = clean_text(d.get(f"{day}_Frequency{k}"))
                if not freq:
                    continue  # CAFB repeats start/end into unused slots; Frequency marks a real slot
                start, end = _time12(d.get(f"{day}_start{k}")), _time12(d.get(f"{day}_end{k}"))
                ok, wom = _week_rule(freq)
                model = clean_text(d.get(f"{day}_Dmodel{k}")) or ""
                codes = match_keywords(model.replace("thru", "through"), SERVICE_KEYWORDS) or ["pantry_pickup"]
                appt = _yn(d.get(f"{day}_ApptOnly{k}")) == "yes"
                fmt = clean_text(d.get(f"{day}_FoodFormat{k}")) or ""
                foods = food_types_from_text(fmt) or (["general_groceries"] if "groceries" in fmt.lower() else [])
                for code in codes:
                    svc = services.setdefault(code, CandidateService(service_type=code, offering_status="regular", food_types=[],
                                                                     description=fmt or None))
                    svc.food_types = list(dict.fromkeys(svc.food_types + foods))
                    if ok and start and end and start < end and code != "home_delivery":
                        svc.schedules.append(CandidateSchedule(weekday=day_i, opens=start, closes=end, week_of_month=wom,
                                                               appointment_only=appt))
                    if code == "home_delivery":
                        svc.service_type = "delivery_qualifying"
                if not ok:
                    notes.append(f"{day}: {freq} {d.get(f'{day}_start{k}')}–{d.get(f'{day}_end{k}')}")
                if _yn(d.get(f"{day}_ResidentsOnly{k}")) == "yes":
                    elig["residency"] = _el("residency", "required", clean_text(d.get(f"{day}_Reqs{k}")))
                reqs = clean_text(d.get(f"{day}_Reqs{k}"))
                if reqs and reqs != "0":
                    for rt, st in eligibility_from_text(reqs).items():
                        elig.setdefault(rt, _el(rt, st, reqs))
                n = clean_text(d.get(f"{day}_Notes{k}"))
                if n and n != "0":
                    notes.append(f"{day}: {n}")
        # merge delivery code collisions
        svc_list = []
        seen = set()
        for s in services.values():
            if s.service_type in seen:
                continue
            seen.add(s.service_type)
            svc_list.append(s)
        return CandidateResource(
            external_id=str(d.get("agency_ref") or d.get("FID")), source_url=self.config.url,
            organization_name=clean_text(d.get("name")), location_name=clean_text(d.get("name")),
            address1=clean_text(d.get("address1")), address2=clean_text(d.get("address2")), city=clean_text(d.get("city")),
            zip=normalize_zip(d.get("zip")), lat=d.get("_lat") or d.get("latitude"), lon=d.get("_lon") or d.get("longitude"),
            geocode_source="cafb", phone=normalize_phone(d.get("phone")), email=clean_text(d.get("email")),
            notes="; ".join(notes) or None, raw_hours_text="; ".join(filter(None, (clean_text(d.get(f"{x}_Hours")) for x in DAYS))) or None,
            services=svc_list, eligibility=list(elig.values()),
        )


FFX_FOOD = {
    "grocery_items": ["general_groceries"], "nonperishable": ["pantry_staples"], "fresh_produce": ["fresh_fruits", "fresh_vegetables"],
    "produce": ["fresh_fruits", "fresh_vegetables"], "baby_food_baby_formula": ["baby_formula", "infant_food"], "frozen": ["frozen_foods"],
    "meat": ["meat"], "dairy": ["dairy"], "bread": ["bread"], "prepared_meals": ["prepared_meals"],
}
FFX_NONFOOD = {"diapers": "diapers", "toiletries_and_household_supplies": "hygiene_supplies"}


@register("fairfax_food_access")
class FairfaxFoodAccess(ScopedArcGIS):
    """Fairfax County 'Emergency Food Access Providers' Survey123 layer (provider-reported answers)."""

    def normalize(self, raw: RawRecord) -> CandidateResource:
        d = raw.data
        codes = [c.strip().lower() for c in str(d.get("TYPES_OF_FOODS") or "").split(",") if c.strip()]
        foods = [f for c in codes for f in FFX_FOOD.get(c, [])]
        if _yn(d.get("GROCERY_ITEMS")) == "yes":
            foods.append("general_groceries")
        if _yn(d.get("PREPARED_MEALS")) == "yes":
            foods.append("prepared_meals")
        if _yn(d.get("KOSHER_HALAL")) == "yes":
            foods.append("other_special_diet")  # survey does not say which; detail left for reviewer
        foods += food_types_from_text(d.get("SERVICE"))
        hours = clean_text(d.get("OPERATIONAL_HOURS_DETAIL"), keep_lines=True)
        sched = [CandidateSchedule(**r) for r in parse_schedule_text(hours)]
        walk_ins = _yn(d.get("ACCEPT_WALK_INS"))
        services = []
        if _yn(d.get("PICKUP")) == "yes" or not services:
            services.append(CandidateService(service_type="pantry_pickup", description=clean_text(d.get("SERVICE")),
                                             food_types=list(dict.fromkeys(foods)), offering_status="regular" if sched else "unconfirmed",
                                             schedules=sched,
                                             appointment_required={"yes": "not_required", "no": "required"}.get(walk_ins, "unknown")))
        if _yn(d.get("DELIVERY")) == "yes":
            services.append(CandidateService(service_type="home_delivery", offering_status="unconfirmed"))
        services += [CandidateService(service_type=FFX_NONFOOD[c], offering_status="regular") for c in codes if c in FFX_NONFOOD]
        elig = []
        for field, rt in (("IDENTIFICATION_REQUIREMENTS", "photo_id"), ("INCOME_REQUIREMENTS", "income")):
            yn = _yn(d.get(field))
            if yn != "unknown":
                elig.append(_el(rt, "required" if yn == "yes" else "not_required"))
        zips = clean_text(d.get("LIVING_ZIP")) or clean_text(d.get("REGION_ALL_ZIP"))
        if zips:
            elig.append(_el("zip_restriction", "required", zips, {"zips": re.findall(r"\b\d{5}\b", zips)}))
        detail = clean_text(d.get("ELIGIBILITY_REQUIREMENTS_DETAIL"))
        for rt, st in eligibility_from_text(" ".join(filter(None, (detail, clean_text(d.get("CRITERIA_TO_RECEIVE")))))).items():
            if rt not in {e.requirement_type for e in elig}:
                elig.append(_el(rt, st, detail))
        langs = [x.strip()[:2].lower() for x in str(d.get("FOOD_PROVIDER_LANGUAGES_SPOKEN") or "").split(",") if x.strip()]
        lang_codes = {"en": "en", "sp": "es", "es": "es", "ko": "ko", "vi": "vi", "ar": "ar", "am": "am", "fr": "fr", "ch": "zh", "ma": "zh", "fa": "fa", "ur": "ur"}
        website = normalize_url(d.get("FOOD_PROVIDER_WEBSITE"))
        return CandidateResource(
            external_id=str(d.get("globalid") or d.get("objectid")), source_url=self.config.url,
            organization_name=clean_text(d.get("FOOD_ORGANIZATION")) or clean_text(d.get("FOOD_PROVIDER_SITE_NAME")),
            organization_website=website,  # provider-reported in the county survey
            location_name=clean_text(d.get("FOOD_PROVIDER_SITE_NAME")),
            address1=clean_text(d.get("FOOD_PROVIDER_SITE_ADDRESS")), city=(clean_text(d.get("FOOD_PROVIDER_SITE_CITY")) or "").title() or None,
            zip=normalize_zip(d.get("FOOD_PROVIDER_SITE_ZIP")), lat=d.get("_lat"), lon=d.get("_lon"), geocode_source="fairfax_county",
            phone=normalize_phone(d.get("FOOD_PROVIDER_SITE_PHONE")), website=website,
            languages=sorted({lang_codes[x] for x in langs if x in lang_codes}),
            notes=clean_text(d.get("LOCATION_DESCRIPTION")), raw_hours_text=hours, raw_eligibility_text=detail,
            services=services, eligibility=elig,
        )


@register("pwc_cmn_resources")
class PWCCommunityMobilization(ScopedArcGIS):
    """Prince William County Community Mobilization Network public resource locations (Food Assistance category)."""

    def normalize(self, raw: RawRecord) -> CandidateResource:
        d = raw.data
        addr = clean_text(d.get("Address")) or ""
        parts = [p.strip() for p in addr.split(",")]
        address1 = parts[0] if parts else None
        city = parts[1] if len(parts) > 2 else None
        desc = clean_text(d.get("Service_Description"))
        access = clean_text(d.get("How_to_Access_Services"))
        hours = clean_text(d.get("Hours_of_Service"), keep_lines=True)
        sched = [CandidateSchedule(**r) for r in parse_schedule_text(hours)]
        cmap = self.config.options.get("category_map")
        if cmap:
            code = cmap.get(clean_text(d.get("Service_Category")) or "")
            if not code:
                raise ValueError(f"category not mapped: {d.get('Service_Category')}")
            codes = [code]
        else:
            codes = match_keywords(desc, SERVICE_KEYWORDS) or ["pantry_pickup"]
        foods = food_types_from_text(desc) if not cmap else []
        services = []
        for i, c in enumerate(dict.fromkeys(codes)):
            if c == "home_delivery":
                c = "delivery_qualifying"
            services.append(CandidateService(service_type=c, description=desc if i == 0 else None,
                                             food_types=[] if c in NON_FOOD else foods,
                                             schedules=sched if i == 0 else [], offering_status="regular" if sched and i == 0 else "unconfirmed"))
        elig = [_el(rt, st, access) for rt, st in eligibility_from_text(access).items()]
        photo = clean_text(d.get("Photo_ID_Required"))
        yn = _yn(photo)
        if yn != "unknown":
            elig = [e for e in elig if e.requirement_type != "photo_id"] + [_el("photo_id", "required" if yn == "yes" else "not_required", photo)]
        site = str(d.get("Website___Social_Media") or "").split("|")[0]
        langs = ["en", "es"] if re.search(r"\benglish and spanish\b", desc or "", re.I) else []
        return CandidateResource(
            external_id=str(d.get("GlobalID") or d.get("FID")), source_url=self.config.url,
            organization_name=clean_text(d.get("Organization_Name")), organization_website=normalize_url(site),
            address1=address1, city=city, zip=normalize_zip(addr), lat=d.get("_lat"), lon=d.get("_lon"), geocode_source="pwc_cmn",
            phone=normalize_phone(d.get("Phone_Number")), email=clean_text(d.get("Email")), website=normalize_url(site),
            languages=langs, raw_hours_text=hours, raw_eligibility_text=access, notes=access,
            services=services, eligibility=elig,
        )
