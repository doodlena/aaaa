"""AI-assisted extraction from web pages and manually downloaded files (data/sources/manual/).

Pages are fetched by the normal polite Fetcher (robots.txt, rate limits, cache); text is extracted locally; Claude
returns structured places whose fields are verified verbatim against the page text (app.services.ai.extract_places).
Unchanged pages are served from the AI cache at no cost.
"""
import io
from collections.abc import Iterable
from pathlib import Path

from bs4 import BeautifulSoup

from app.config import REPO_ROOT
from app.ingestion.adapters.generic import stable_id
from app.ingestion.base import Adapter, FetchedDocument, RawRecord, register
from app.ingestion.candidate import CandidateEligibility, CandidateResource, CandidateSchedule, CandidateService
from app.ingestion.normalization.text import (
    clean_text,
    eligibility_from_text,
    normalize_phone,
    normalize_url,
    normalize_zip,
    parse_schedule_text,
)

FOOD_SERVICES = {"pantry_pickup", "walk_up", "drive_through", "mobile_pantry", "community_meal", "home_delivery",
                 "delivery_qualifying", "emergency_food", "school_based", "appointment_distribution", "seasonal_program",
                 "senior_meals", "kids_meals"}


def page_text(doc: FetchedDocument) -> str:
    if doc.url.lower().endswith(".pdf") or doc.content[:4] == b"%PDF":
        import pdfplumber

        with pdfplumber.open(io.BytesIO(doc.content)) as pdf:
            return "\n".join(p.extract_text() or "" for p in pdf.pages)
    soup = BeautifulSoup(doc.text(), "lxml")
    for t in soup(["script", "style", "noscript", "template", "nav", "footer"]):
        t.decompose()
    return "\n".join(line.strip() for line in soup.get_text("\n").splitlines() if line.strip())


@register("ai_page_extract")
class AIPageExtract(Adapter):
    def discover(self) -> Iterable[str]:
        yield from self.config.request_urls
        d = self.config.options.get("manual_dir")
        if d:
            for p in sorted((REPO_ROOT / d).glob("*")):
                if p.suffix.lower() in (".pdf", ".html", ".htm", ".txt"):
                    yield f"file://{p.relative_to(REPO_ROOT)}"

    def parse(self, doc: FetchedDocument) -> Iterable[RawRecord]:
        from app.services import ai

        text = page_text(doc)
        if len(text) < 80:
            raise ValueError("page has no readable text")
        cite = self.config.options.get("citations", {}).get(Path(doc.url).name) if doc.url.startswith("file://") else None
        for place in ai.extract_places(text, cite or doc.url):
            yield RawRecord(stable_id(cite or doc.url, place["organization_name"], place.get("address1")), place, cite or doc.url)

    def normalize(self, raw: RawRecord) -> CandidateResource:
        d = raw.data
        hours = clean_text(d.get("hours_text"), keep_lines=True)
        sched = [CandidateSchedule(**r) for r in parse_schedule_text(hours)]
        codes = list(dict.fromkeys(d.get("service_types") or [])) or ["other"]
        services = [CandidateService(service_type=c, description=clean_text(d.get("description")) if i == 0 else None,
                                     food_types=d.get("food_types") or [] if c in FOOD_SERVICES else [],
                                     schedules=sched if i == 0 and c in FOOD_SERVICES else [],
                                     offering_status="regular" if sched else "unconfirmed") for i, c in enumerate(codes)]
        elig_text = clean_text(d.get("eligibility_text"))
        return CandidateResource(
            external_id=raw.external_id, source_url=raw.source_url, organization_name=clean_text(d["organization_name"]),
            location_name=clean_text(d.get("location_name")), address1=clean_text(d.get("address1")), city=clean_text(d.get("city")),
            zip=normalize_zip(d.get("zip")), phone=normalize_phone(d.get("phone")), website=normalize_url(d.get("website")),
            raw_hours_text=hours, raw_eligibility_text=elig_text,
            notes=("AI-extracted; quotes: " + " | ".join(d.get("evidence") or [])[:600]) if d.get("evidence") else "AI-extracted",
            services=services,
            schedules=[] if any(c in FOOD_SERVICES for c in codes) else [CandidateSchedule(**{**r, "kind": "operating_hours"}) for r in parse_schedule_text(hours)],
            eligibility=[CandidateEligibility(requirement_type=k, status=v, details=elig_text) for k, v in eligibility_from_text(elig_text).items()],
        )
