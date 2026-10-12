"""Pilot evaluation (Phase 4/8): reproducible report built only from the database, run logs, and test result files.

Distinguishes raw source records, pending candidates, verified records, published resources, and synthetic fixtures.
Nothing is estimated; a metric with no data is reported as unavailable.
"""
import json
import xml.etree.ElementTree as ET
from datetime import UTC, datetime

from geoalchemy2.shape import to_shape
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import REPO_ROOT, get_settings
from app.db import session_factory
from app.ingestion.base import load_source_configs
from app.ingestion.deduplication.matcher import haversine_m
from app.models import IngestionRun, Jurisdiction, Location, Source, SourceRecord
from app.services.quality import quality_report
from app.services.registry import active_scope

TARGETS = {  # realistic pilot quality targets (see docs/pilot_research/EVALUATION_METHOD.md)
    "valid_coordinates_pct": 95, "valid_address_pct": 90, "with_source_attribution_pct": 100,
    "with_distribution_schedule_pct": 60, "with_service_types_pct": 90, "with_documented_eligibility_pct": 50,
    "with_official_website_pct": 50,
}
MIN_VERIFIED_SHARE = 0.25  # share of real candidates per pilot jurisdiction manually verified before expansion

ACCEPTANCE = [  # (criterion, evidence tests)
    ("All published verified listings have an attributable manual verification record", ["test_verification_requires_method_and_records_reviewer", "test_admin_review_approve_publish"]),
    ("All public listings have source attribution", ["test_admin_review_approve_publish"]),
    ("Unknown requirements are not interpreted as unrestricted", ["test_no_id_filter_excludes_unknown_and_required", "test_detail_has_structured_sections_and_unknowns"]),
    ("Imported records do not automatically overwrite verified fields", ["test_changes_to_verified_record_become_proposals_not_overwrites"]),
    ("Re-running an unchanged import does not create duplicates", ["test_reimport_is_idempotent"]),
    ("Nearby searches use correct spatial calculations", ["test_radius_search_distance_order_and_postgis_distance", "test_border_search_crosses_jurisdictions", "test_viewport_search"]),
    ("Filters correctly handle unknown and missing information", ["test_no_id_filter_excludes_unknown_and_required", "test_date_filter_uses_distribution_schedule"]),
    ("Guest search works without authentication", ["test_radius_search_distance_order_and_postgis_distance"]),
    ("Registered favorites persist", ["test_favorites_flow_requires_csrf"]),
    ("Administrator endpoints are protected", ["test_admin_routes_protected"]),
    ("Synthetic test records cannot be mistaken for published real resources", ["test_unpublished_detail_404_and_synthetic_hidden_when_disabled", "test_import_creates_unpublished_candidates_with_provenance"]),
    ("Map and list results remain synchronized", ['list ↔ map synchronisation > list "Show on map" selects with origin=list and the map pans to it',
                                                  "list ↔ map synchronisation > marker click selects with origin=map, highlights the card and scrolls it into view"]),
    ("English and Spanish interface translations function", ["language switching > switches UI text to Spanish and remembers the choice",
                                                             "language switching > has complete, matching English and Spanish catalogs"]),
    ("Restricted-license sources are not republished without direct provider verification", ["test_restricted_source_needs_direct_verification_to_publish"]),
]


def _junit() -> dict[str, str]:
    out = {}
    for p in (REPO_ROOT / "reports" / "test-results").glob("*.xml"):
        for tc in ET.parse(p).getroot().iter("testcase"):
            status = "failed" if tc.find("failure") is not None or tc.find("error") is not None else "skipped" if tc.find("skipped") is not None else "passed"
            out[tc.get("name", "").split("[")[0]] = status if out.get(tc.get("name", "").split("[")[0]) != "failed" else "failed"
    return out


def _per_source_completeness(db: Session) -> dict:
    out = {}
    for sid, in db.execute(select(Source.id)).all():
        recs = db.scalars(select(SourceRecord).where(SourceRecord.source_id == sid, SourceRecord.is_synthetic.is_(False))).all()
        if not recs:
            continue
        n = len(recs)

        def pct(pred):
            return round(100 * sum(1 for r in recs if pred(r.normalized)) / n, 1)

        out[sid] = {
            "records": n,
            "by_status": {s: sum(1 for r in recs if r.status == s) for s in {r.status for r in recs}},
            "with_coordinates_pct": pct(lambda c: c.get("lat") is not None),
            "with_parsed_schedule_pct": pct(lambda c: bool(c.get("schedules")) or any(s.get("schedules") for s in c.get("services", []))),
            "with_unparsed_hours_text_only_pct": pct(lambda c: bool(c.get("raw_hours_text")) and not (c.get("schedules") or any(s.get("schedules") for s in c.get("services", [])))),
            "with_food_types_pct": pct(lambda c: any(s.get("food_types") for s in c.get("services", []))),
            "with_eligibility_pct": pct(lambda c: bool(c.get("eligibility")) or any(s.get("eligibility") for s in c.get("services", []))),
            "with_official_website_pct": pct(lambda c: bool(c.get("organization_website"))),
            "with_phone_pct": pct(lambda c: bool(c.get("phone"))),
            "validation_errors": sum(1 for r in recs if any(i["severity"] == "error" for i in r.validation)),
        }
    return out


def _geo_checks(db: Session) -> dict:
    """Recompute jurisdiction by point-in-polygon and compare PostGIS geodesic distance with haversine."""
    locs = db.scalars(select(Location).where(Location.is_synthetic.is_(False), Location.geom.isnot(None))).all()
    mismatched, max_rel_err = [], 0.0
    ref = (38.8462, -77.3064)
    for loc in locs:
        p = to_shape(loc.geom)
        jid = db.scalar(select(Jurisdiction.id).where(func.ST_Contains(Jurisdiction.boundary, func.ST_SetSRID(func.ST_MakePoint(p.x, p.y), 4326))))
        if jid and jid != loc.jurisdiction_id:
            mismatched.append(loc.id)
        d_pg = db.scalar(select(func.ST_Distance(Location.geom, func.ST_GeogFromText(f"SRID=4326;POINT({ref[1]} {ref[0]})"))).where(Location.id == loc.id))
        d_h = haversine_m(p.y, p.x, *ref)
        if d_h > 1000:
            max_rel_err = max(max_rel_err, abs(d_pg - d_h) / d_h)
    return {"locations_checked": len(locs), "jurisdiction_mismatches": mismatched,
            "max_relative_difference_postgis_vs_haversine": round(max_rel_err, 4),
            "note": "PostGIS uses the WGS84 spheroid; haversine a sphere — differences up to ~0.5% are expected."}


def run_pilot_evaluation() -> str:
    s = get_settings()
    scope = sorted(active_scope())
    with session_factory()() as db:
        overall = quality_report(db)["metrics"]
        per_j = {j: quality_report(db, j)["metrics"] for j in scope}
        synthetic = {"locations": db.scalar(select(func.count()).select_from(Location).where(Location.is_synthetic.is_(True))),
                     "published": db.scalar(select(func.count()).select_from(Location).where(Location.is_synthetic.is_(True), Location.published.is_(True)))}
        runs = db.scalars(select(IngestionRun).order_by(IngestionRun.id)).all()
        per_source = _per_source_completeness(db)
        geo = _geo_checks(db)
    cfgs = {k: v for k, v in load_source_configs().items() if not v.is_synthetic}
    researched = json.loads((REPO_ROOT / "docs" / "pilot_research" / "source_discovery.json").read_text())["food_sources"]
    pilot = json.loads((REPO_ROOT / "reports" / "pilot_research" / "pilot_selection.json").read_text())
    tests = _junit()
    run_summary = {}
    for r in runs:
        if r.source_id in cfgs:
            agg = run_summary.setdefault(r.source_id, {"runs": 0, "succeeded": 0, "partial": 0, "failed": 0, "first_run_discovered": None})
            agg["runs"] += 1
            agg[r.status] = agg.get(r.status, 0) + 1
            if agg["first_run_discovered"] is None:
                agg["first_run_discovered"] = r.counts.get("discovered")
            agg["last_counts"] = r.counts
    targets = {k: {"target": t, "actual": overall.get(k), "met": overall.get(k) is not None and overall[k] >= t} for k, t in TARGETS.items()}
    real_candidates = overall["locations_total"]
    verified = overall["by_review_status"].get("verified", 0) + overall["by_review_status"].get("stale", 0)
    per_j_ready = {j: (m["by_review_status"].get("verified", 0) + m["by_review_status"].get("stale", 0)) / m["locations_total"] >= MIN_VERIFIED_SHARE
                   if m["locations_total"] else False for j, m in per_j.items()}
    acceptance = []
    for crit, names in ACCEPTANCE:
        st = [tests.get(n, "not run") for n in names]
        acceptance.append({"criterion": crit, "tests": names, "result": "pass" if all(x == "passed" for x in st) else "fail" if "failed" in st else "not evaluated"})
    report = {
        "generated_at": datetime.now(UTC).isoformat(), "pilot_jurisdictions": scope,
        "pilot_divisions": pilot["recommended_divisions"], "selection_rule": pilot["rule"],
        "sources_researched": len(researched), "sources_integrated": sorted(cfgs), "runs": run_summary,
        "real_data": {"raw_source_records": sum(v["records"] for v in per_source.values()), "candidate_locations": real_candidates,
                      "verified_or_stale": verified, "published": overall["published"], "by_review_status": overall["by_review_status"]},
        "synthetic_fixtures": synthetic, "overall_metrics": overall, "per_jurisdiction": per_j, "per_source": per_source,
        "geo_checks": geo, "quality_targets": targets, "acceptance": acceptance,
        "ready_for_expansion": all(per_j_ready.values()) and all(a["result"] == "pass" for a in acceptance) and all(t["met"] for t in targets.values()),
        "per_jurisdiction_verification_threshold_met": per_j_ready,
    }
    out = s.reports_dir / "pilot_evaluation"
    out.mkdir(parents=True, exist_ok=True)
    (out / "pilot_evaluation.json").write_text(json.dumps(report, indent=2, default=str))
    md = _markdown(report)
    (out / "PILOT_EVALUATION_REPORT.md").write_text(md)
    return str(out / "PILOT_EVALUATION_REPORT.md")


def _markdown(r: dict) -> str:
    rd = r["real_data"]
    L = ["# Pilot evaluation report", "", f"Generated {r['generated_at'][:19]}Z by `foodaccess evaluate-pilot`. All figures are computed from the "
         "database, ingestion run logs and test-result files at that moment; none are estimated.", "",
         f"**Verdict: {'READY for expansion' if r['ready_for_expansion'] else 'NOT YET READY for expansion'}.** "
         "Software readiness and real-world data verification are reported separately below.", "",
         "## Scope", "", f"- Pilot divisions (VDOE numbers): {r['pilot_divisions']}",
         f"- Pilot jurisdictions: {', '.join(r['pilot_jurisdictions'])}", f"- Selection: {r['selection_rule']} (reports/pilot_research/PILOT_SELECTION_REPORT.md)", "",
         "## Data status (real records only)", "", "| Stage | Count |", "|---|---:|",
         f"| Raw source records stored | {rd['raw_source_records']} |", f"| Candidate locations (all review states) | {rd['candidate_locations']} |",
         f"| Verified (incl. stale) by a named reviewer | {rd['verified_or_stale']} |", f"| Published | {rd['published']} |", "",
         f"By review status: `{json.dumps(rd['by_review_status'])}`", "",
         f"Synthetic fixtures (separate, never counted above): {r['synthetic_fixtures']['locations']} locations, "
         f"{r['synthetic_fixtures']['published']} published in the local demo database only.", "",
         f"## Sources — researched {r['sources_researched']}, integrated {len(r['sources_integrated'])}", "",
         "| Source | Runs | Succeeded | Failed | Discovered (first run) | Last run counts |", "|---|---:|---:|---:|---:|---|"]
    for sid in r["sources_integrated"]:
        x = r["runs"].get(sid)
        if x:
            lc = {k: v for k, v in x["last_counts"].items() if v and k != "extra"}
            L.append(f"| {sid} | {x['runs']} | {x.get('succeeded', 0)} | {x.get('failed', 0)} | {x['first_run_discovered']} | `{json.dumps(lc)}` |")
        else:
            L.append(f"| {sid} | 0 | — | — | — | not run |")
    L += ["", "## Field completeness by source (normalized records)", "",
          "| Source | Records | Coordinates | Parsed schedule | Hours text only (unparsed) | Food types | Eligibility | Official website | Phone |",
          "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for sid, m in r["per_source"].items():
        L.append(f"| {sid} | {m['records']} | {m['with_coordinates_pct']}% | {m['with_parsed_schedule_pct']}% | {m['with_unparsed_hours_text_only_pct']}% | "
                 f"{m['with_food_types_pct']}% | {m['with_eligibility_pct']}% | {m['with_official_website_pct']}% | {m['with_phone_pct']}% |")
    L += ["", "## Quality metrics vs targets (all real candidate locations)", "", "| Metric | Target | Actual | Met |", "|---|---:|---:|:---:|"]
    for k, t in r["quality_targets"].items():
        L.append(f"| {k} | ≥{t['target']}% | {t['actual'] if t['actual'] is not None else '—'}% | {'yes' if t['met'] else 'no'} |")
    om = r["overall_metrics"]
    L += ["", f"- Stale listings: {om['stale']}; pending conflicting source changes: {om['pending_conflicts']}; "
          f"locations with conflicting values across sources: {om['locations_with_conflicting_source_values']}; pending duplicate reviews: {om['pending_duplicates']}.",
          f"- Published listings without a verification record: {om['published_without_verification_record']}; without source attribution: {om['published_without_source']}.", "",
          "## Per jurisdiction", "", "| Jurisdiction | Locations | Verified share ≥ 25%? | Coordinates | Schedule | Eligibility | Website |", "|---|---:|:---:|---:|---:|---:|---:|"]
    for j, m in r["per_jurisdiction"].items():
        pc = lambda v: "—" if v is None else f"{v}%"  # noqa: E731
        L.append(f"| {j} | {m['locations_total']} | {'yes' if r['per_jurisdiction_verification_threshold_met'][j] else 'no'} | {pc(m['valid_coordinates_pct'])} | "
                 f"{pc(m['with_distribution_schedule_pct'])} | {pc(m['with_documented_eligibility_pct'])} | {pc(m['with_official_website_pct'])} |")
    g = r["geo_checks"]
    L += ["", "## Geographic checks", "", f"- Real locations checked: {g['locations_checked']}; jurisdiction mismatches after point-in-polygon recheck: {len(g['jurisdiction_mismatches'])}.",
          f"- Max relative difference PostGIS geodesic vs haversine: {g['max_relative_difference_postgis_vs_haversine']} ({g['note']})", "",
          "## Acceptance criteria (automated test evidence)", "", "| Criterion | Result | Tests |", "|---|:---:|---|"]
    for a in r["acceptance"]:
        L.append(f"| {a['criterion']} | {a['result']} | {', '.join(a['tests'])} |")
    L += ["", "Evidence: reports/test-results/backend-junit.xml (pytest) and frontend-junit.xml (Vitest). Playwright scenarios A–D and F are "
          "run separately against live dev servers (see PROJECT_PROGRESS.md).", "",
          "## Remaining manual verification work", "",
          f"- {om['by_review_status'].get('candidate', 0)} candidate and {om['by_review_status'].get('needs_review', 0)} needs-review real listings await a reviewer.",
          f"- {om['pending_duplicates']} duplicate candidates and {om['pending_conflicts']} conflicting changes await decisions.",
          "- CAFB and Fairfax County data may only be published after direct provider verification or written permission from the data owner.",
          f"- Expansion requires ≥{int(MIN_VERIFIED_SHARE * 100)}% of real candidates in each pilot jurisdiction to be manually verified (representative audit sample).", ""]
    return "\n".join(L)
