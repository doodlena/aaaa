"""Source-specific HTML adapters (parsed with BeautifulSoup; content treated as untrusted text)."""
import re
from collections.abc import Iterable

from bs4 import BeautifulSoup

from app.ingestion.adapters.generic import stable_id
from app.ingestion.base import Adapter, FetchedDocument, RawRecord, register
from app.ingestion.candidate import CandidateEligibility, CandidateResource, CandidateSchedule, CandidateService
from app.ingestion.normalization.text import clean_text, normalize_zip, parse_schedule_text

_ABBR = [(r"\bM\b", "Monday"), (r"\bTu\b", "Tuesday"), (r"\bW\b", "Wednesday"), (r"\bTh\b", "Thursday"),
         (r"\bF\b", "Friday"), (r"\bSat\b", "Saturday"), (r"\bSun\b", "Sunday")]


def expand_day_abbreviations(text: str) -> str:
    """'M-F: 9am-1pm, Tu & Th: 6pm-7pm' -> full day names the shared schedule parser understands."""
    for pat, full in _ABBR:
        text = re.sub(pat, full, text)
    return text


@register("afac_locations")
class AFACLocations(Adapter):
    """Arlington Food Assistance Center 'Get Groceries' page: one .map-location block per distribution site."""

    def parse(self, doc: FetchedDocument) -> Iterable[RawRecord]:
        soup = BeautifulSoup(doc.text(), "lxml")
        intro = " ".join(t.get_text(" ", strip=True) for t in soup.find_all("p") if "resident" in t.get_text().lower())[:600]
        blocks = soup.select(".map-location")
        if not blocks:
            raise ValueError("no .map-location blocks — page layout changed?")
        for b in blocks:
            name = clean_text(b.select_one("h3").get_text(" ", strip=True)) if b.select_one("h3") else None
            parts = [p.get_text(strip=True) for p in b.select(".address-part")]
            hours_el = b.select_one(".map-location-hours")
            data = {
                "name": name, "address_parts": parts,
                "lat": (b.select_one(".location-data .lat") or {}).get_text(strip=True) if b.select_one(".location-data .lat") else None,
                "lng": b.select_one(".location-data .lng").get_text(strip=True) if b.select_one(".location-data .lng") else None,
                "hours": hours_el.get_text(" | ", strip=True) if hours_el else None, "intro": intro,
            }
            yield RawRecord(stable_id("afac", name, " ".join(parts[:2])), data, doc.url)

    def normalize(self, raw: RawRecord) -> CandidateResource:
        d = raw.data
        parts = d["address_parts"]
        hours = clean_text(d.get("hours"))
        sched = [CandidateSchedule(**r) for r in parse_schedule_text(expand_day_abbreviations(hours or "").replace("|", "\n"))]
        elig = []
        m = re.search(r"[^.]*\bArlington County resident[^.]*\.", d.get("intro") or "")
        if m:
            elig.append(CandidateEligibility(requirement_type="residency", status="required", details=clean_text(m.group(0)),
                                             values={"jurisdictions": ["arlington-county"]}))
        return CandidateResource(
            external_id=raw.external_id, source_url=raw.source_url, organization_name="Arlington Food Assistance Center",
            organization_website="https://afac.org/", location_name=d["name"],
            address1=" ".join(parts[:2]) if len(parts) >= 2 else None, city=parts[2] if len(parts) > 2 else None,
            zip=normalize_zip(parts[-1] if parts else None),
            lat=float(d["lat"]) if d.get("lat") else None, lon=float(d["lng"]) if d.get("lng") else None, geocode_source="afac",
            raw_hours_text=hours, services=[CandidateService(service_type="pantry_pickup", food_types=["general_groceries"],
                                                             offering_status="regular" if sched else "unconfirmed", schedules=sched)],
            eligibility=elig,
        )
