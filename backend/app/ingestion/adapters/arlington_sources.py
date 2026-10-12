"""Arlington County 'Food Resources' map (my.arlingtonva.us/foodresources): the JSON file behind the county's page.

One row per program at a site. Every flag column is a string; many rows leave all of them "False", so only "True"
is treated as a statement. "False" never becomes `required` or "not offered".
"""
import re
from collections.abc import Iterable

from app.ingestion.adapters.generic import stable_id
from app.ingestion.base import Adapter, FetchedDocument, RawRecord, register
from app.ingestion.candidate import CandidateEligibility, CandidateResource, CandidateSchedule, CandidateService
from app.ingestion.normalization.text import (
    clean_text,
    eligibility_from_text,
    food_types_from_text,
    normalize_phone,
    normalize_url,
    normalize_zip,
    parse_schedule_text,
)

_TYPE_SERVICE = {"food pantry": "pantry_pickup", "produce bags": "pantry_pickup", "little free food pantry": "pantry_pickup",
                 "prepared meals": "community_meal", "discount groceries": "other"}
_FLAG_SERVICES = {"Other services provided - Diapers": "diapers", "Other services provided - Clothing": "clothing",
                  "Other services provided - Financial assistance": "financial_assistance"}
_FLAG_FOODS = {"Grocery Items": ["general_groceries"], "Fresh Produce": ["fresh_fruits", "fresh_vegetables"],
               "Prepared Meals": ["prepared_meals"]}
_LANGS = {"spanish": "es", "chinese": "zh", "arabic": "ar", "french": "fr", "urdu": "ur", "pashto": "ps", "korean": "ko",
          "vietnamese": "vi", "amharic": "am", "farsi": "fa"}
_DAY = re.compile(r"\b(mon|tue|wed|thu|fri|sat|sun)", re.I)
_ORDINAL = re.compile(r"\b(1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth|last)\b", re.I)
_NO_CONTACT = ("n/a", "same as main contact info.")


def _true(d: dict, key: str) -> bool:
    return str(d.get(key)).strip().lower() == "true"


def _schedules(d: dict) -> list[CandidateSchedule]:
    """Weekly/monthly rules only when the row is unambiguous. Seasonal rows, multi-line times, "3rd or 4th", and
    monthly/bi-weekly rows without an ordinal stay as raw text for a reviewer."""
    times, day = str(d.get("Times") or "").strip(), clean_text(d.get("Day")) or ""
    dates = (clean_text(d.get("Year-Round or Dates")) or "").lower()
    if not times or "\n" in times or dates != "year-round":
        return []
    text = clean_text(times) if _DAY.search(times) else f"{day} {clean_text(times)}"
    if re.search(r"\bor\b", text, re.I):
        return []
    if re.search(r"month|bi-?weekly|every other", f"{d.get('Frequency')} {day}", re.I) and not _ORDINAL.search(text):
        return []
    return [CandidateSchedule(**r) for r in parse_schedule_text(text)]


def _eligibility(d: dict) -> list[CandidateEligibility]:
    text = clean_text(d.get("Eligibility requirements")) or ""
    reg = clean_text(d.get("Registration Contact")) or ""
    both = f"{text} {reg}"
    out: dict[str, CandidateEligibility] = {}

    def put(rt, status, details=None, values=None):
        out.setdefault(rt, CandidateEligibility(requirement_type=rt, status=status, details=details, values=values or {}))

    stated = eligibility_from_text(text)
    for rt in ("photo_id", "proof_of_address"):
        if stated.get(rt) == "required":
            put(rt, "required", text)
    if _true(d, "No Photo ID Required"):
        put("photo_id", "not_required")
    if re.search(r"\bregist|\bsign up\b|\benroll", both, re.I):
        put("registration", "required", reg if reg.lower() not in _NO_CONTACT and reg else text)
    elif _true(d, "No Registration Required"):
        put("registration", "not_required")
    if re.search(r"\b(make an|by) appointment\b", both, re.I):
        put("appointment", "required", reg or text)
    if re.search(r"\breferral\b", text, re.I):
        put("referral", "required", text)
    restricted = _true(d, "Restricted access (only members of these communities)")
    if re.search(r"\bresidents?\b|\bmust live in\b|\blive within\b", text, re.I):
        put("residency", "required", text,
            {"jurisdictions": ["arlington-county"]} if re.search(r"\bArlington (County )?residents\b", text) else None)
    elif re.search(r"\bschool\b|\benrolled\b|\bstudents?\b", text, re.I) and restricted:
        put("student_affiliation", "required", text)
    elif restricted:
        put("other", "required", text or None)
    elif re.search(r"\bopen to all\b", text, re.I):
        put("residency", "not_required", text)
    if _true(d, "Age restrictions - for seniors only") or re.search(r"\baged? \d+|\byears or older\b", text, re.I):
        put("age", "required", text or None)
    elif _true(d, "Age restrictions - for children (or families of children) only") and "student_affiliation" not in out:
        put("age", "required", text or None)
    if re.search(r"\bregardless of income\b", text, re.I):
        put("income", "not_required", text)
    elif re.search(r"\bincome eligible\b", text, re.I):
        put("income", "required", text)
    freq = clean_text(d.get("Frequency")) or ""
    if re.search(r"\bonce (a|per) (week|month)\b", freq, re.I):
        put("visit_limit", "required", freq)
    return list(out.values())


@register("arlington_food_resources")
class ArlingtonFoodResources(Adapter):
    def parse(self, doc: FetchedDocument) -> Iterable[RawRecord]:
        rows = doc.json()
        if not isinstance(rows, list) or not rows:
            raise ValueError("expected a non-empty JSON list — file layout changed?")
        for r in rows:
            yield RawRecord(stable_id("arlington-food", r.get("Organization"), r.get("Location name"), r.get("Type")), r, self.config.url)

    def normalize(self, raw: RawRecord) -> CandidateResource:
        d, o = raw.data, self.config.options
        kind = (clean_text(d.get("Type")) or "").lower()
        if kind not in _TYPE_SERVICE:
            raise ValueError(f"unmapped Type {d.get('Type')!r}")
        org, site = clean_text(d.get("Organization")), clean_text(d.get("Location name"))
        if not org:
            raise ValueError("record has no organization name")
        elig = _eligibility(d)
        state = {e.requirement_type: e.status for e in elig}
        sched = _schedules(d)
        dates = clean_text(d.get("Year-Round or Dates"))
        year_round = (dates or "").lower() == "year-round"
        desc = clean_text(d.get("Description"))
        if kind not in ("food pantry", "prepared meals"):
            desc = ". ".join(x for x in (clean_text(d.get("Type")), desc) if x)
        foods = [f for flag, codes in _FLAG_FOODS.items() if _true(d, flag) for f in codes] + food_types_from_text(desc)
        service_type = "senior_meals" if kind == "prepared meals" and "age" in state else _TYPE_SERVICE[kind]
        services = [CandidateService(
            service_type=service_type, description=desc, food_types=foods, frequency=clean_text(d.get("Frequency")),
            offering_status="regular" if year_round else "seasonal" if dates else "unconfirmed",
            registration_required=state.get("registration", "unknown"), appointment_required=state.get("appointment", "unknown"),
            schedules=sched)]
        services += [CandidateService(service_type=code) for flag, code in _FLAG_SERVICES.items() if _true(d, flag)]

        spoken = [x.strip() for x in re.split(r",|\band\b", clean_text(d.get("Languages Spoken other than English")) or "") if x.strip()]
        reg = clean_text(d.get("Registration Contact"))
        notes = [
            f"Dates: {dates}." if dates and not year_round else None,
            f"Co-sponsor: {clean_text(d.get('Co-Sponsor'))}." if clean_text(d.get("Co-Sponsor")) else None,
            f"Registration: {reg.rstrip('.')}." if reg and reg.lower() not in _NO_CONTACT else None,
            "Delivery available." if _true(d, "Delivery Available") else None,
            "Accepts SNAP." if _true(d, "Accepts SNAP") else None,
            "Languages: " + ", ".join(spoken) + "." if any(x.lower() not in _LANGS for x in spoken) else None,
        ]
        reg_url = re.search(r"https?://\S+", reg or "")
        zip_code = normalize_zip(d.get("Zip Code"))
        return CandidateResource(
            external_id=raw.external_id, source_url=raw.source_url,
            organization_name=o.get("organization_aliases", {}).get(org, org),
            location_name=site if not site or site.startswith(org) else f"{org} – {site}",
            address1=clean_text(d.get("Location address")), city=o.get("city_by_zip", {}).get(zip_code), zip=zip_code,
            lat=float(d["Lat"]) if d.get("Lat") else None, lon=float(d["Lng"]) if d.get("Lng") else None,
            geocode_source="arlington_county" if d.get("Lat") else None,
            phone=normalize_phone(d.get("Phone")), email=clean_text(d.get("Email")), website=normalize_url(d.get("Website")),
            registration_url=normalize_url(reg_url.group(0).rstrip(".,)")) if reg_url else None,
            languages=sorted({_LANGS[x.lower()] for x in spoken if x.lower() in _LANGS}),
            notes=" ".join(n for n in notes if n) or None,
            raw_hours_text="; ".join(x for x in (clean_text(d.get("Day")), clean_text(d.get("Times"), keep_lines=True),
                                                 clean_text(d.get("Frequency")), dates) if x) or None,
            raw_eligibility_text=clean_text(d.get("Eligibility requirements")),
            services=services, eligibility=elig,
        )
