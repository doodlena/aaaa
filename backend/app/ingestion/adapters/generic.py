"""Generic adapters driven by `field_mappings` in the source YAML.

field_mappings maps candidate fields to source keys, e.g.
  organization_name: NAME
  address1: ADDRESS
  hours_text: HOURS          # free text, parsed conservatively
  eligibility_text: ELIG     # free text, only explicit statements become conditions
  services_text: [SERVICES, DESCRIPTION]   # keyword-mapped to service + food types
"""
import csv
import hashlib
import io
from collections.abc import Iterable

from app.ingestion.base import Adapter, FetchedDocument, RawRecord, register
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


def _get(data: dict, keys, keep_lines: bool = False) -> str | None:
    if keys is None:
        return None
    if isinstance(keys, str):
        keys = [keys]
    parts = [clean_text(data.get(k), keep_lines) for k in keys if data.get(k) not in (None, "")]
    parts = [p for p in parts if p]
    return ("\n" if keep_lines else " ").join(parts) if parts else None


def candidate_from_mapping(raw: RawRecord, m: dict, options: dict) -> CandidateResource:
    d = raw.data
    org = _get(d, m.get("organization_name"))
    if not org:
        raise ValueError("record has no organization name")
    hours = _get(d, m.get("hours_text"), keep_lines=True)
    elig_text = _get(d, m.get("eligibility_text"))
    svc_text = _get(d, m.get("services_text"))
    all_text = " ".join(x for x in (svc_text, elig_text, hours) if x)

    schedules = [CandidateSchedule(**r) for r in parse_schedule_text(hours)]
    elig = eligibility_from_text(elig_text or all_text)
    eligibility = [CandidateEligibility(requirement_type=k, status=v, details=None) for k, v in elig.items()]
    default_service = options.get("default_service_type")  # e.g. "pantry_pickup" when the whole source is pantries
    svc_codes = match_keywords(svc_text, SERVICE_KEYWORDS) or ([default_service] if default_service else [])
    if "pantry_pickup" in svc_codes and len(svc_codes) > 1 and "food pantry" not in (svc_text or "").lower():
        svc_codes.remove("pantry_pickup")
    food = food_types_from_text(svc_text)
    services = [
        CandidateService(service_type=code, description=svc_text if i == 0 else None,
                         food_types=food if code not in ("diapers", "hygiene_supplies", "household_essentials") else [],
                         offering_status="regular" if schedules else "unconfirmed",
                         schedules=schedules if code not in ("diapers", "hygiene_supplies", "household_essentials") and i == 0 else [])
        for i, code in enumerate(svc_codes)
    ]
    loc_sched = [] if services else schedules
    lat = d.get(m.get("lat")) if m.get("lat") else None
    lon = d.get(m.get("lon")) if m.get("lon") else None
    return CandidateResource(
        external_id=raw.external_id,
        source_url=raw.source_url,
        organization_name=org,
        organization_website=normalize_url(_get(d, m.get("organization_website"))) if options.get("website_is_official") else None,
        location_name=_get(d, m.get("location_name")),
        address1=_get(d, m.get("address1")),
        address2=_get(d, m.get("address2")),
        city=_get(d, m.get("city")),
        zip=normalize_zip(_get(d, m.get("zip"))),
        lat=float(lat) if lat not in (None, "") else None,
        lon=float(lon) if lon not in (None, "") else None,
        geocode_source=options.get("coordinate_source"),
        phone=normalize_phone(_get(d, m.get("phone"))),
        email=_get(d, m.get("email")),
        website=normalize_url(_get(d, m.get("website"))),
        notes=_get(d, m.get("notes")),
        raw_hours_text=hours,
        raw_eligibility_text=elig_text,
        schedules=loc_sched,
        services=services,
        eligibility=eligibility,
    )


def stable_id(*parts) -> str:
    return hashlib.sha1("|".join(str(p or "").lower().strip() for p in parts).encode()).hexdigest()[:16]


@register("structured_json")
class StructuredJSONAdapter(Adapter):
    """Records already in CandidateResource shape (used for synthetic fixtures and hand-curated official data files)."""

    def parse(self, doc: FetchedDocument) -> Iterable[RawRecord]:
        data = doc.json()
        for item in data["records"] if isinstance(data, dict) else data:
            yield RawRecord(item["external_id"], item, item.get("source_url") or doc.url)

    def normalize(self, raw: RawRecord) -> CandidateResource:
        return CandidateResource(**raw.data)


@register("csv_table")
class CSVAdapter(Adapter):
    def parse(self, doc: FetchedDocument) -> Iterable[RawRecord]:
        reader = csv.DictReader(io.StringIO(doc.content.decode("utf-8-sig", errors="replace")))
        idf = self.config.options.get("id_field")
        m = self.config.field_mappings
        for row in reader:
            ext = row.get(idf) if idf else stable_id(_get(row, m.get("organization_name")), _get(row, m.get("address1")))
            yield RawRecord(str(ext), row, self.config.url)

    def normalize(self, raw: RawRecord) -> CandidateResource:
        return candidate_from_mapping(raw, self.config.field_mappings, self.config.options)


@register("arcgis_feature_layer")
class ArcGISAdapter(Adapter):
    """ArcGIS FeatureServer/MapServer `query` endpoint returning GeoJSON (f=geojson, outSR=4326)."""

    def parse(self, doc: FetchedDocument) -> Iterable[RawRecord]:
        data = doc.json()
        if "error" in data:
            raise ValueError(f"ArcGIS error: {data['error']}")
        idf = self.config.options.get("id_field", "OBJECTID")
        for f in data.get("features", []):
            props = dict(f.get("properties") or {})
            geom = f.get("geometry") or {}
            if geom.get("type") == "Point":
                props["_lon"], props["_lat"] = geom["coordinates"][:2]
            yield RawRecord(str(props.get(idf) or f.get("id")), props, self.config.url)

    def normalize(self, raw: RawRecord) -> CandidateResource:
        m = {"lat": "_lat", "lon": "_lon", **self.config.field_mappings}
        return candidate_from_mapping(raw, m, {"coordinate_source": self.config.id, **self.config.options})


@register("osm_overpass")
class OverpassAdapter(Adapter):
    """OpenStreetMap via Overpass. Supplementary discovery only: OSM tags rarely carry schedules or eligibility,
    and every OSM-derived candidate still requires manual verification. Data © OpenStreetMap contributors (ODbL)."""

    def discover(self) -> Iterable[str]:
        from urllib.parse import quote

        bbox = self.config.options["bbox"]  # south,west,north,east
        q = self.config.options.get("query") or (
            "[out:json][timeout:60];("
            f'nwr["social_facility"="food_bank"]({bbox});'
            f'nwr["amenity"="food_bank"]({bbox});'
            f'nwr["social_facility"="soup_kitchen"]({bbox});'
            ");out center tags;"
        )
        return [f"{self.config.options.get('endpoint', 'https://overpass-api.de/api/interpreter')}?data={quote(q)}"]

    def parse(self, doc: FetchedDocument) -> Iterable[RawRecord]:
        for el in doc.json().get("elements", []):
            tags = el.get("tags") or {}
            lat = el.get("lat") or (el.get("center") or {}).get("lat")
            lon = el.get("lon") or (el.get("center") or {}).get("lon")
            yield RawRecord(f"{el['type']}/{el['id']}", {**tags, "_lat": lat, "_lon": lon},
                            f"https://www.openstreetmap.org/{el['type']}/{el['id']}")

    def normalize(self, raw: RawRecord) -> CandidateResource:
        t = raw.data
        name = clean_text(t.get("name"))
        if not name:
            raise ValueError("OSM feature without a name")
        street = " ".join(x for x in (t.get("addr:housenumber"), t.get("addr:street")) if x) or None
        kind = t.get("social_facility") or t.get("amenity")
        svc = "community_meal" if kind == "soup_kitchen" else "pantry_pickup"
        hours = t.get("opening_hours")
        # OSM opening_hours syntax ("Tu 10:00-12:00") is not parsed into distribution windows automatically: OSM
        # hours usually describe the building, not food distribution. Kept as raw text for the reviewer.
        return CandidateResource(
            external_id=raw.external_id, source_url=raw.source_url, organization_name=clean_text(t.get("operator")) or name,
            location_name=name, address1=street, city=t.get("addr:city"), zip=normalize_zip(t.get("addr:postcode")),
            lat=raw.data["_lat"], lon=raw.data["_lon"], geocode_source="openstreetmap",
            phone=normalize_phone(t.get("phone") or t.get("contact:phone")),
            website=normalize_url(t.get("website") or t.get("contact:website")),
            raw_hours_text=hours, services=[CandidateService(service_type=svc, offering_status="unconfirmed")],
            wheelchair_accessible={"yes": "yes", "no": "no"}.get(t.get("wheelchair"), "unknown"),
        )


@register("pdf_table")
class PDFTableAdapter(Adapter):
    """Tables extracted with pdfplumber. options.columns lists header names in order when the PDF has no header row."""

    def parse(self, doc: FetchedDocument) -> Iterable[RawRecord]:
        import pdfplumber

        cols = self.config.options.get("columns")
        m = self.config.field_mappings
        with pdfplumber.open(io.BytesIO(doc.content)) as pdf:
            for page in pdf.pages:
                for table in page.extract_tables():
                    header = cols or [clean_text(h) or f"col{i}" for i, h in enumerate(table[0])]
                    for row in table if cols else table[1:]:
                        rec = {h: clean_text(v) for h, v in zip(header, row, strict=False)}
                        if not _get(rec, m.get("organization_name")):
                            continue
                        yield RawRecord(stable_id(_get(rec, m.get("organization_name")), _get(rec, m.get("address1"))), rec, doc.url)

    def normalize(self, raw: RawRecord) -> CandidateResource:
        return candidate_from_mapping(raw, self.config.field_mappings, self.config.options)
