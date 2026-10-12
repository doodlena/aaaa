"""Discover → Retrieve → Parse → Normalize → Validate → Deduplicate → Stage → (manual) Review → Publish.

Nothing in this module publishes or verifies anything. New records become `candidate` locations (unpublished).
Records linked to verified locations never overwrite them: differences become ChangeProposals for a reviewer.
"""
import hashlib
import json
import logging
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

from geoalchemy2 import Geography
from sqlalchemy import cast, func, or_, select, true
from sqlalchemy.orm import Session

from app.config import get_settings
from app.geospatial.geocode import NOVA_BBOX, geocode
from app.ingestion.base import Adapter, Fetcher, FetchError, RunCounts, SourceConfig, get_adapter, load_source_configs
from app.ingestion.candidate import LOCATION_FIELDS, CandidateResource
from app.ingestion.deduplication.matcher import MatchInput, classify, score
from app.ingestion.normalization.text import normalize_address, normalize_name, normalize_phone, url_domain
from app.ingestion.verification.workflow import audit, needs_review_after_change
from app.models import (
    ChangeProposal,
    DuplicateCandidate,
    FieldProvenance,
    IngestionRun,
    Jurisdiction,
    Location,
    Organization,
    Source,
    SourceRecord,
)
from app.services.resource_writer import (
    comparable_eligibility,
    comparable_schedules,
    comparable_services,
    coords_of,
    replace_structures,
    set_coords,
    structures_of,
)

log = logging.getLogger("ingestion")

UNVERIFIED = ("candidate", "needs_review")


# --- validation -----------------------------------------------------------------------------------------------

def validate(c: CandidateResource, adapter: Adapter) -> list[dict]:
    issues = []

    def add(fieldname, code, severity="warning"):
        issues.append({"field": fieldname, "code": code, "severity": severity})

    if not c.organization_name.strip():
        add("organization_name", "missing", "error")
    if not c.address1 and (c.lat is None or c.lon is None):
        add("address1", "no_address_or_coordinates", "error")
    if c.lat is not None and c.lon is not None:
        minx, miny, maxx, maxy = NOVA_BBOX
        if not (minx <= c.lon <= maxx and miny <= c.lat <= maxy):
            add("coordinates", "outside_region", "error")
    if c.address1 and not c.zip:
        add("zip", "missing")
    if c.phone and not normalize_phone(c.phone):
        add("phone", "invalid")
    has_sched = bool(c.schedules) or any(s.schedules for s in c.services)
    if not has_sched:
        add("schedules", "missing_distribution_schedule")
    if not c.services:
        add("services", "no_structured_services")
    if not c.eligibility and not any(s.eligibility for s in c.services):
        add("eligibility", "eligibility_undocumented")
    if not c.organization_website:
        add("organization_website", "unknown")
    issues += adapter.validate(c)
    return issues


def record_hash(c: CandidateResource) -> str:
    return hashlib.sha256(json.dumps(c.model_dump(), sort_keys=True, default=str).encode()).hexdigest()


# --- jurisdiction ---------------------------------------------------------------------------------------------

def assign_jurisdiction(db: Session, c: CandidateResource, cfg: SourceConfig) -> str | None:
    if c.lat is not None and c.lon is not None:
        jid = db.scalar(select(Jurisdiction.id).where(
            Jurisdiction.boundary.isnot(None),
            func.ST_Contains(Jurisdiction.boundary, func.ST_SetSRID(func.ST_MakePoint(c.lon, c.lat), 4326)),
        ).limit(1))
        if jid:
            return jid
    if c.jurisdiction_id:
        return c.jurisdiction_id
    if len(cfg.jurisdictions) == 1:
        return cfg.jurisdictions[0]
    return None


# --- locations ------------------------------------------------------------------------------------------------

def _candidate(rec: SourceRecord) -> CandidateResource:
    return CandidateResource(**rec.normalized)


def _find_org(db: Session, c: CandidateResource) -> Organization | None:
    norm = normalize_name(c.organization_name)
    dom = url_domain(c.organization_website)
    for org in db.scalars(select(Organization).where(Organization.normalized_name == norm)).all():
        if not dom or not org.website or url_domain(org.website) == dom:
            return org
    return None


def _write_provenance(db: Session, loc: Location, c: CandidateResource, rec: SourceRecord) -> None:
    now = datetime.now(UTC)
    for f in LOCATION_FIELDS:
        v = getattr(c, "location_name" if f == "name" else f, None)
        if v in (None, "", "unknown"):
            continue
        fp = db.scalar(select(FieldProvenance).where(FieldProvenance.location_id == loc.id, FieldProvenance.field == f,
                                                     FieldProvenance.source_record_id == rec.id))
        if fp:
            fp.value, fp.observed_at = v, now
        else:
            db.add(FieldProvenance(location_id=loc.id, field=f, value=v, source_record_id=rec.id, observed_at=now))


def _location_values(c: CandidateResource) -> dict:
    return {
        "name": c.location_name or c.organization_name, "address1": c.address1, "address2": c.address2, "city": c.city,
        "zip": c.zip, "phone": normalize_phone(c.phone), "email": c.email, "website": c.website,
        "registration_url": c.registration_url, "operating_status": c.operating_status, "notes": c.notes,
        "wheelchair_accessible": c.wheelchair_accessible, "parking_notes": c.parking_notes, "transit_notes": c.transit_notes,
    }


def _services_payload(c: CandidateResource) -> list[dict]:
    return [s.model_dump() for s in c.services]


def _apply_unverified(db: Session, loc: Location, c: CandidateResource, rec: SourceRecord) -> None:
    for k, v in _location_values(c).items():
        if v is not None:
            setattr(loc, k, v)
    if c.languages:
        loc.languages = c.languages
    loc.normalized_address = normalize_address(c.address1, c.zip)
    if c.lat is not None:
        set_coords(loc, c.lat, c.lon, c.geocode_source or rec.source_id)
    if c.jurisdiction_id:
        loc.jurisdiction_id = c.jurisdiction_id
    if c.organization_website and not loc.organization.website:
        loc.organization.website = c.organization_website
    services, schedules, eligibility = _merged_structures(db, loc, c, rec)
    replace_structures(db, loc, services, schedules, eligibility, rec.id)
    _write_provenance(db, loc, c, rec)


def _merged_structures(db: Session, loc: Location, c: CandidateResource, rec: SourceRecord):
    """Union of services/schedules/eligibility from every source record linked to this unverified location, so one
    record (or source) never erases another's documented services. Eligibility: 'required' beats 'not_required'
    beats 'unknown' (the conservative reading); disagreements are visible to reviewers via source records."""
    others = [CandidateResource(**r.normalized) for r in db.scalars(select(SourceRecord).where(
        SourceRecord.location_id == loc.id, SourceRecord.status == "linked", SourceRecord.id != rec.id)).all()]
    cands = [c, *others]
    by_type: dict[str, dict] = {}
    for cand in cands:
        for svc in cand.services:
            d = svc.model_dump()
            cur = by_type.get(d["service_type"])
            if not cur:
                by_type[d["service_type"]] = d
                continue
            cur["food_types"] = list(dict.fromkeys(cur["food_types"] + d["food_types"]))
            skey = lambda x: (x.get("kind", "distribution"), x["weekday"], x["opens"], x["closes"], x.get("week_of_month"))  # noqa: E731
            have = {skey(x) for x in cur["schedules"]}
            cur["schedules"] += [x for x in d["schedules"] if skey(x) not in have]
            cur["eligibility"] = _merge_elig(cur["eligibility"] + d["eligibility"])
            cur["description"] = cur["description"] or d["description"]
    schedules, seen = [], set()
    for cand in cands:
        for x in cand.schedules:
            d = x.model_dump()
            k = (d["kind"], d["weekday"], d["opens"], d["closes"], d["week_of_month"])
            if k not in seen:
                seen.add(k)
                schedules.append(d)
    eligibility = _merge_elig([e.model_dump() for cand in cands for e in cand.eligibility])
    return list(by_type.values()), schedules, eligibility


_RANK = {"required": 2, "not_required": 1, "unknown": 0}


def _merge_elig(items: list[dict]) -> list[dict]:
    out: dict[str, dict] = {}
    for e in items:
        cur = out.get(e["requirement_type"])
        if not cur or _RANK[e["status"]] > _RANK[cur["status"]]:
            out[e["requirement_type"]] = e
    return list(out.values())


def _propose_changes(db: Session, loc: Location, c: CandidateResource, rec: SourceRecord) -> set[str]:
    """Compare against a verified location; stage differences as proposals. Returns changed field names."""
    changed: set[str] = set()
    current = {k: getattr(loc, k) for k in _location_values(c)}
    proposals: dict[str, tuple] = {}
    for k, v in _location_values(c).items():
        if v is None or v == current[k] or (k == "operating_status" and v == "unknown"):
            continue  # a source omitting a value is not evidence the value changed
        proposals[k] = (current[k], v)
    if c.organization_website and c.organization_website != loc.organization.website:
        proposals["organization_website"] = (loc.organization.website, c.organization_website)
    if c.lat is not None:
        cur = coords_of(loc)
        new = {"lat": round(c.lat, 6), "lon": round(c.lon, 6)}
        if not cur or abs(cur["lat"] - new["lat"]) > 0.0005 or abs(cur["lon"] - new["lon"]) > 0.0005:
            proposals["coordinates"] = (cur, new)
    existing = structures_of(loc)
    if c.services and comparable_services(_services_payload(c)) != existing["services"]:
        proposals["services"] = (existing["services"], _services_payload(c))
    if c.schedules and comparable_schedules([s.model_dump() for s in c.schedules]) != existing["schedules"]:
        proposals["schedules"] = (existing["schedules"], [s.model_dump() for s in c.schedules])
    if c.eligibility and comparable_eligibility([e.model_dump() for e in c.eligibility]) != existing["eligibility"]:
        proposals["eligibility"] = (existing["eligibility"], [e.model_dump() for e in c.eligibility])
    for f, (cur_v, new_v) in proposals.items():
        pending = db.scalars(select(ChangeProposal).where(ChangeProposal.location_id == loc.id, ChangeProposal.field == f,
                                                          ChangeProposal.status == "pending")).all()
        if any(p.proposed_value == new_v for p in pending):
            continue  # same proposal already waiting
        for p in pending:
            if p.source_record_id == rec.id:
                p.status = "superseded"
        db.add(ChangeProposal(location_id=loc.id, field=f, current_value=cur_v, proposed_value=new_v, source_record_id=rec.id))
        changed.add(f)
    return changed


def attach_record_to_location(db: Session, rec: SourceRecord, loc: Location, actor_label: str = "ingestion") -> str:
    """Link a source record to a location and bring its data in safely. Returns 'updated' | 'conflict' | 'unchanged'."""
    rec.location_id = loc.id
    rec.status = "linked"
    c = _candidate(rec)
    loc.last_seen_at = datetime.now(UTC)
    if loc.review_status in UNVERIFIED and loc.last_verified_at is None:
        _apply_unverified(db, loc, c, rec)
        return "updated"
    changed = _propose_changes(db, loc, c, rec)
    _write_provenance(db, loc, c, rec)
    if not changed:
        return "unchanged"
    if needs_review_after_change(loc, changed):
        before = loc.review_status
        loc.review_status = "needs_review"  # stays published with its verified values until a reviewer acts
        audit(db, None, "location", loc.id, "returned_to_review", {"review_status": before},
              {"review_status": "needs_review", "fields": sorted(changed)}, label=actor_label)
    return "conflict"


def create_location_from_record(db: Session, rec: SourceRecord) -> Location:
    c = _candidate(rec)
    org = _find_org(db, c)
    if not org:
        org = Organization(name=c.organization_name, normalized_name=normalize_name(c.organization_name),
                           website=c.organization_website, phone=normalize_phone(c.phone), is_synthetic=rec.is_synthetic)
        db.add(org)
        db.flush()
    now = datetime.now(UTC)
    loc = Location(organization=org, name=c.location_name or c.organization_name, review_status="candidate", published=False,
                   is_synthetic=rec.is_synthetic, first_imported_at=now, last_seen_at=now, languages=[])
    db.add(loc)
    db.flush()
    _apply_unverified(db, loc, c, rec)
    rec.location_id = loc.id
    rec.status = "linked"
    audit(db, None, "location", loc.id, "created_from_import", None, {"source_record": rec.id}, label=f"ingestion:{rec.source_id}")
    return loc


def _match_inputs(c: CandidateResource) -> MatchInput:
    return MatchInput(normalize_name(c.location_name or c.organization_name), normalize_address(c.address1, c.zip), c.lat, c.lon,
                      url_domain(c.organization_website or c.website), normalize_phone(c.phone))


def find_duplicates(db: Session, c: CandidateResource, exclude_source: str | None = None) -> list[tuple[Location, object]]:
    """Existing (non-merged) locations near or textually matching the candidate, scored."""
    conds = []
    if c.lat is not None and c.lon is not None:
        pt = cast(func.ST_SetSRID(func.ST_MakePoint(c.lon, c.lat), 4326), Geography)
        conds.append(func.ST_DWithin(Location.geom, pt, 500))
    na = normalize_address(c.address1, c.zip)
    if na:
        conds.append(Location.normalized_address == na)
    nn = normalize_name(c.location_name or c.organization_name)
    conds.append(func.lower(Location.name) == (c.location_name or c.organization_name).lower())
    if not conds:
        return []
    locs = db.scalars(select(Location).where(or_(*conds), Location.merged_into_id.is_(None), Location.review_status != "rejected")).all()
    out = []
    inp = _match_inputs(c)
    for loc in locs:
        p = coords_of(loc)
        res = score(inp, MatchInput(normalize_name(loc.name), loc.normalized_address, p and p["lat"], p and p["lon"],
                                    url_domain(loc.organization.website or loc.website), loc.phone))
        out.append((loc, res))
    del nn
    return sorted(out, key=lambda x: -x[1].score)


# --- staging --------------------------------------------------------------------------------------------------

def stage(db: Session, cfg: SourceConfig, run: IngestionRun, c: CandidateResource, issues: list[dict], raw: dict | None,
          counts: RunCounts) -> None:
    now = datetime.now(UTC)
    h = record_hash(c)
    rec = db.scalar(select(SourceRecord).where(SourceRecord.source_id == cfg.id, SourceRecord.external_id == c.external_id))
    errors = [i for i in issues if i["severity"] == "error"]
    if rec and rec.raw_hash == h and rec.status not in ("gone",):
        rec.last_seen_at, rec.last_run_id = now, run.id
        if rec.location_id:
            db.get(Location, rec.location_id).last_seen_at = now
        counts.unchanged += 1
        return
    is_new = rec is None
    if is_new:
        rec = SourceRecord(source_id=cfg.id, external_id=c.external_id, first_seen_at=now, is_synthetic=cfg.is_synthetic)
        db.add(rec)
    rec.source_url = c.source_url
    rec.raw = raw if cfg.store_raw else None
    rec.raw_hash = h
    rec.normalized = c.model_dump(mode="json")
    rec.validation = issues
    rec.last_seen_at = rec.last_changed_at = now
    rec.last_run_id = run.id
    db.flush()
    if errors:
        rec.status = "invalid"
        counts.rejected += 1
        return
    if rec.location_id:
        loc = db.get(Location, rec.location_id)
        outcome = attach_record_to_location(db, rec, loc, f"ingestion:{cfg.id}")
        counts.updated += outcome == "updated"
        counts.conflicts += outcome == "conflict"
        counts.unchanged += outcome == "unchanged"
        return
    if rec.status == "duplicate_candidate":
        counts.duplicate_candidates += 1  # still waiting for a reviewer; refresh its data only
        return
    matches = find_duplicates(db, c)
    auto = [m for m in matches if classify(m[1]) == "auto_link"]
    review = [m for m in matches if classify(m[1]) == "review"]
    if cfg.rows_are_distinct and auto:
        # a listing that already carries another row of this source is a co-located program: a reviewer decides
        taken = set(db.scalars(select(SourceRecord.location_id).where(SourceRecord.source_id == cfg.id,
                                                                      SourceRecord.location_id.in_([m[0].id for m in auto]))))
        review += [m for m in auto if m[0].id in taken]
        auto = [m for m in auto if m[0].id not in taken]
    if len(auto) == 1 and not review:
        outcome = attach_record_to_location(db, rec, auto[0][0], f"ingestion:{cfg.id}")
        counts.updated += outcome == "updated"
        counts.conflicts += outcome == "conflict"
        counts.unchanged += outcome == "unchanged"
        counts.extra["auto_linked"] = counts.extra.get("auto_linked", 0) + 1
        return
    if auto or review:
        rec.status = "duplicate_candidate"
        for loc, res in (auto + review)[:5]:
            exists_ = db.scalar(select(DuplicateCandidate).where(DuplicateCandidate.source_record_id == rec.id,
                                                                  DuplicateCandidate.location_id == loc.id))
            if not exists_:
                db.add(DuplicateCandidate(source_record_id=rec.id, location_id=loc.id, score=res.score, reasons=res.reasons))
        counts.duplicate_candidates += 1
        return
    create_location_from_record(db, rec)
    counts.inserted += 1


def sync_source_row(db: Session, cfg: SourceConfig) -> Source:
    src = db.get(Source, cfg.id) or Source(id=cfg.id)
    src.name, src.url, src.owner, src.adapter = cfg.name, cfg.url, cfg.owner, cfg.adapter
    src.jurisdictions, src.enabled = cfg.jurisdictions, cfg.enabled
    src.config = cfg.model_dump(mode="json")
    db.add(src)
    db.flush()
    return src


def run_source(db: Session, cfg: SourceConfig, fetcher: Fetcher | None = None, scope: set[str] | None = None,
               do_geocode: bool = False, report_dir: Path | None = None) -> IngestionRun:
    """Run one source end to end. Failures are recorded on the run; they never raise past this function."""
    fetcher = fetcher or Fetcher()
    src = sync_source_row(db, cfg)
    run = IngestionRun(source_id=cfg.id, status="running")
    db.add(run)
    db.commit()
    counts = RunCounts()
    errors: list[dict] = []
    seen: set[str] = set()
    adapter = get_adapter(cfg)
    adapter.scope = scope
    src.last_attempt_at = datetime.now(UTC)
    for url in adapter.discover():
        try:
            doc = fetcher.get(url, cfg)
        except FetchError as e:
            counts.fetch_errors += 1
            errors.append({"stage": "retrieve", "url": url, "error": str(e)})
            continue
        try:
            raws = list(adapter.parse(doc))
        except Exception as e:  # changed layouts / malformed files must not abort other URLs
            counts.parse_errors += 1
            errors.append({"stage": "parse", "url": url, "error": f"{type(e).__name__}: {e}"})
            continue
        for raw in raws:
            counts.discovered += 1
            try:
                c = adapter.normalize(raw)
            except Exception as e:
                counts.rejected += 1
                errors.append({"stage": "normalize", "external_id": raw.external_id, "error": f"{type(e).__name__}: {e}"})
                continue
            if c.lat is None and c.address1 and do_geocode:
                results, _ = geocode(f"{c.address1}, {c.city or ''} VA {c.zip or ''}")
                addr = [r for r in results if r["precision"] == "address"]
                if addr:
                    c.lat, c.lon, c.geocode_source = addr[0]["lat"], addr[0]["lon"], addr[0]["source"]
            c.jurisdiction_id = assign_jurisdiction(db, c, cfg)
            if scope is not None and c.jurisdiction_id not in scope:
                counts.out_of_scope += 1
                continue
            seen.add(c.external_id)
            issues = validate(c, adapter)
            try:
                with db.begin_nested():
                    stage(db, cfg, run, c, issues, raw.data, counts)
            except Exception as e:
                counts.rejected += 1
                errors.append({"stage": "stage", "external_id": c.external_id, "error": f"{type(e).__name__}: {e}"})
    total_failure = counts.discovered == 0 and (counts.fetch_errors or counts.parse_errors)
    if not total_failure and not counts.fetch_errors and not counts.parse_errors:
        # Records that disappeared from a fully successful run: flag for investigation, never auto-close.
        gone = db.scalars(select(SourceRecord).where(SourceRecord.source_id == cfg.id, SourceRecord.status == "linked",
                                                     SourceRecord.external_id.notin_(seen) if seen else true())).all()
        for rec in gone:
            if scope is not None and rec.normalized.get("jurisdiction_id") not in scope:
                continue
            rec.status = "gone"
            counts.gone += 1
            loc = db.get(Location, rec.location_id) if rec.location_id else None
            if loc and loc.review_status in ("verified", "stale"):
                loc.review_status = "needs_review"
                audit(db, None, "location", loc.id, "missing_from_source", None, {"source": cfg.id}, label=f"ingestion:{cfg.id}")
    counts.needs_review = db.scalar(select(func.count()).select_from(Location).where(Location.review_status.in_(UNVERIFIED))) or 0
    run.status = "failed" if total_failure else "partial" if errors else "succeeded"
    run.finished_at = datetime.now(UTC)
    run.counts = asdict(counts)
    run.errors = errors[:500]
    if run.status != "failed":
        src.last_success_at = run.finished_at
        src.last_error = None
    else:
        src.last_error = errors[0]["error"] if errors else "unknown"
    db.commit()
    write_run_report(db, run, cfg, report_dir)
    return run


def write_run_report(db: Session, run: IngestionRun, cfg: SourceConfig, report_dir: Path | None = None) -> Path:
    report_dir = report_dir or get_settings().reports_dir / "ingestion"
    report_dir.mkdir(parents=True, exist_ok=True)
    recs = db.scalars(select(SourceRecord).where(SourceRecord.last_run_id == run.id)).all()
    review = [{"external_id": r.external_id, "status": r.status, "location_id": r.location_id,
               "issues": [i for i in r.validation if i["severity"] == "error" or i["code"] in ("missing_distribution_schedule",)]}
              for r in recs if r.status in ("invalid", "duplicate_candidate") or r.validation]
    report = {
        "run_id": run.id, "source": {"id": cfg.id, "name": cfg.name, "url": cfg.url, "adapter": cfg.adapter,
                                     "is_synthetic": cfg.is_synthetic, "known_limitations": cfg.known_limitations},
        "status": run.status, "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None, "counts": run.counts, "errors": run.errors,
        "records_requiring_review": review[:1000],
        "note": "Imported records are unverified candidates. Nothing in this run was published or marked verified.",
    }
    stem = f"run-{run.id:05d}-{cfg.id}"
    jp = report_dir / f"{stem}.json"
    jp.write_text(json.dumps(report, indent=2, default=str))
    c = run.counts
    md = [f"# Ingestion run {run.id} — {cfg.name}", "", f"- Status: **{run.status}**", f"- Source: {cfg.url}",
          f"- Synthetic fixture source: {'yes' if cfg.is_synthetic else 'no'}", ""]
    md += ["| Metric | Count |", "|---|---|"] + [f"| {k} | {v} |" for k, v in c.items() if k != "extra"]
    for k, v in (c.get("extra") or {}).items():
        md.append(f"| {k} | {v} |")
    if run.errors:
        md += ["", "## Errors", ""] + [f"- [{e['stage']}] {e.get('url') or e.get('external_id')}: {e['error']}" for e in run.errors[:50]]
    md += ["", "Imported records are unverified candidates; nothing was published or verified by this run."]
    (report_dir / f"{stem}.md").write_text("\n".join(md))
    run.report_path = str(jp)
    db.commit()
    return jp


def run_all(db: Session, scope: set[str] | None, only: list[str] | None = None, fetcher: Fetcher | None = None,
            do_geocode: bool = False, configs: dict[str, SourceConfig] | None = None) -> list[IngestionRun]:
    configs = configs or load_source_configs()
    runs = []
    for cfg in configs.values():
        if only and cfg.id not in only:
            continue
        if not cfg.enabled or cfg.is_synthetic and not only:
            continue
        if scope is not None and not (set(cfg.jurisdictions) & scope):
            continue
        try:
            runs.append(run_source(db, cfg, fetcher, scope, do_geocode))
        except Exception as e:  # one failing source must not stop the others
            db.rollback()
            log.exception("source %s failed: %s", cfg.id, e)
    return runs
