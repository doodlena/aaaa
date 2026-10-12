"""Adapters for bulk federal/regional datasets (public domain or no-restriction public data)."""
from collections.abc import Iterable
from urllib.parse import urlencode

from app.ingestion.adapters.generic import stable_id
from app.ingestion.base import Adapter, FetchedDocument, RawRecord, register
from app.ingestion.candidate import CandidateResource, CandidateService
from app.ingestion.normalization.text import clean_text, normalize_phone, normalize_url, normalize_zip


@register("samhsa_locator")
class SAMHSALocator(Adapter):
    """findtreatment.gov locator export (SAMHSA; US Government work). Radius queries from options.centers."""

    def discover(self) -> Iterable[str]:
        o = self.config.options
        for lat, lon in o["centers"]:
            yield "https://findtreatment.gov/locator/exportsAsJson/v2?" + urlencode(
                {"sAddr": f"{lat},{lon}", "limitType": 2, "limitValue": o.get("radius_m", 48280), "pageSize": 500, "page": 1, "sort": 0})

    def parse(self, doc: FetchedDocument) -> Iterable[RawRecord]:
        for r in doc.json().get("rows", []):
            yield RawRecord(stable_id("samhsa", r.get("name1"), r.get("street1"), r.get("zip"), r.get("typeFacility")), r,
                            "https://findtreatment.gov/")

    def normalize(self, raw: RawRecord) -> CandidateResource:
        r = raw.data
        svc = {s.get("f2"): s.get("f3") or "" for s in r.get("services") or []}
        care = (svc.get("TC") or "").lower()
        codes = []
        if "mental health" in care or r.get("typeFacility") == "MH":
            codes.append("mental_health_counseling")
        if "substance use" in care or r.get("typeFacility") in ("SA", "OTP", "BUPREN"):
            codes.append("substance_use_treatment")
        if "crisis" in (svc.get("ES") or "").lower() or "crisis" in care:
            codes.append("crisis_support")
        notes = "; ".join(f"{s.get('f1')}: {s.get('f3')}" for s in r.get("services") or [] if s.get("f2") in ("TC", "SET", "PAY", "AGE"))[:1500]
        return CandidateResource(
            external_id=raw.external_id, source_url=raw.source_url,
            organization_name=clean_text(" ".join(x for x in (r.get("name1"), r.get("name2")) if x)),
            organization_website=normalize_url(r.get("website")), address1=clean_text(r.get("street1")),
            address2=clean_text(r.get("street2")), city=clean_text(r.get("city")), zip=normalize_zip(r.get("zip")),
            lat=float(r["latitude"]) if r.get("latitude") else None, lon=float(r["longitude"]) if r.get("longitude") else None,
            geocode_source="samhsa", phone=normalize_phone(r.get("intake1") or r.get("phone")), website=normalize_url(r.get("website")),
            notes=notes or None,
            services=[CandidateService(service_type=c, offering_status="regular") for c in dict.fromkeys(codes or ["mental_health_counseling"])],
        )


@register("hrsa_health_centers")
class HRSAHealthCenters(Adapter):
    """HRSA health center service delivery sites (US Government work), pre-filtered NoVA extract."""

    def parse(self, doc: FetchedDocument) -> Iterable[RawRecord]:
        for r in doc.json()["rows"]:
            if (r.get("Site Status Description") or "").lower() != "active":
                continue
            yield RawRecord(stable_id("hrsa", r.get("BPHC Assigned Number"), r.get("Site Name"), r.get("Site Address")), r,
                            "https://data.hrsa.gov/data/download")

    def normalize(self, raw: RawRecord) -> CandidateResource:
        r = raw.data
        name = clean_text(r.get("Site Name"))
        codes = ["health_clinic"] + (["dental_care"] if "dental" in (name or "").lower() else [])
        sched = clean_text(r.get("Health Center Operational Schedule Description"))
        hours = clean_text(r.get("Operating Hours per Week"))
        return CandidateResource(
            external_id=raw.external_id, source_url=raw.source_url, organization_name=name, location_name=name,
            organization_website=normalize_url(r.get("Site Web Address")), address1=clean_text(r.get("Site Address")),
            city=clean_text(r.get("Site City")), zip=normalize_zip(r.get("Site Postal Code")),
            lat=float(r["Geocoding Artifact Address Primary Y Coordinate"]), lon=float(r["Geocoding Artifact Address Primary X Coordinate"]),
            geocode_source="hrsa", phone=normalize_phone(r.get("Site Telephone Number")),
            website=normalize_url(r.get("Site Web Address")),
            notes="; ".join(x for x in (f"{r.get('Health Center Type Description')}" if r.get("Health Center Type Description") else None,
                                        f"Schedule: {sched}" if sched else None, f"{hours} operating hours per week" if hours else None) if x) or None,
            services=[CandidateService(service_type=c, offering_status="regular",
                                       description="Federally funded health center: care regardless of ability to pay (sliding fee)."
                                       if c == "health_clinic" and "Federally Qualified" in (r.get("Health Center Type Description") or "") else None)
                      for c in codes],
        )


@register("nvrc_shelters")
class NVRCShelters(Adapter):
    """Northern Virginia Regional Commission homeless shelters layer (ArcGIS)."""

    def parse(self, doc: FetchedDocument) -> Iterable[RawRecord]:
        for f in doc.json().get("features", []):
            p = dict(f.get("properties") or {})
            g = f.get("geometry") or {}
            if g.get("type") == "Point":
                p["_lon"], p["_lat"] = g["coordinates"][:2]
            yield RawRecord(f"nvrc-{p.get('ObjectID') or p.get('OBJECTID') or stable_id(p.get('Name'))}", p, self.config.url)

    def normalize(self, raw: RawRecord) -> CandidateResource:
        p = raw.data
        full = clean_text(p.get("Full_Address")) or ""
        parts = [x.strip() for x in full.split(",")]
        name = clean_text(p.get("Name"))
        code = "housing_assistance" if "assessment" in (name or "").lower() or "intake" in (name or "").lower() else "shelter"
        elig = " ".join(x for x in (clean_text(p.get("Populations_Served")), clean_text(p.get("Minimum_Requirements")),
                                    clean_text(p.get("Mean_of_Referral"))) if x)
        return CandidateResource(
            external_id=raw.external_id, source_url=raw.source_url, organization_name=name, location_name=name,
            address1=parts[0] if parts else None, city=parts[1] if len(parts) > 2 else None, zip=normalize_zip(full),
            lat=p.get("_lat"), lon=p.get("_lon"), geocode_source="nvrc", phone=normalize_phone(p.get("Phone")),
            website=normalize_url(p.get("Website")), organization_website=normalize_url(p.get("Website")),
            raw_eligibility_text=elig or None, notes=(f"Populations served: {clean_text(p.get('Populations_Served'))}"
                                                      if p.get("Populations_Served") else None),
            services=[CandidateService(service_type=code, offering_status="regular")],
        )
