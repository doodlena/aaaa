"""Transparent, configurable pilot prioritization score (config/pilot_selection.yaml).

score(division) = Σ w_f · norm_f(division) / Σ w_f over factors with data for that division.
norm_f is min–max across candidates (0 = lowest candidate, 1 = highest). Missing values are excluded (weight
renormalized) and flagged — never imputed. Scores are relative rankings among these candidates, not measures of need.
"""
import json
from datetime import UTC, datetime

import yaml

from app.config import get_settings
from app.research.title_i import OUT


def load_selection_config() -> dict:
    return yaml.safe_load((get_settings().config_dir / "pilot_selection.yaml").read_text())


def score_divisions(rows: list[dict], cfg: dict) -> list[dict]:
    evidence = {int(k): v for k, v in (cfg.get("food_data_evidence") or {}).items()}
    cands = [dict(r, **{k: v for k, v in evidence.get(r["division_number"], {}).items()})
             for r in rows if r["division_number"] in cfg["candidates"]]
    ranges = {}
    for name, f in cfg["factors"].items():
        vals = [c.get(f["field"]) for c in cands if c.get(f["field"]) is not None]
        ranges[name] = (min(vals), max(vals)) if vals else None
    out = []
    for c in cands:
        parts, missing, wsum, total = {}, [], 0.0, 0.0
        for name, f in cfg["factors"].items():
            v = c.get(f["field"])
            rng = ranges[name]
            if v is None or rng is None:
                missing.append(name)
                continue
            lo, hi = rng
            n = 0.5 if hi == lo else (v - lo) / (hi - lo)
            parts[name] = {"value": v, "normalized": round(n, 3), "weight": f["weight"]}
            total += f["weight"] * n
            wsum += f["weight"]
        out.append({"division_number": c["division_number"], "division_name": c["division_name"], "jurisdictions": c["jurisdictions"],
                    "score": round(total / wsum, 3) if wsum else None, "weight_coverage": round(wsum / sum(f["weight"] for f in cfg["factors"].values()), 2),
                    "factors": parts, "missing_factors": missing, "evidence_notes": evidence.get(c["division_number"], {}).get("notes")})
    out.sort(key=lambda r: (r["score"] is None, -(r["score"] or 0)))
    for i, r in enumerate(out, 1):
        r["rank"] = i
    return out


def run_pilot_selection() -> dict:
    cfg = load_selection_config()
    summary_path = OUT / "title_i_division_summary.json"
    if not summary_path.exists():
        raise SystemExit("Run `foodaccess title-i` first")
    summary = json.loads(summary_path.read_text())
    ranked = score_divisions(summary["divisions"], cfg)
    eq_cfg = {**cfg, "factors": {k: {**f, "weight": 1.0} for k, f in cfg["factors"].items()}}
    sensitivity = [{"division_number": r["division_number"], "division_name": r["division_name"], "score": r["score"], "rank": r["rank"]}
                   for r in score_divisions(summary["divisions"], eq_cfg)]
    eligible = [r for r in ranked if r["score"] is not None and r["weight_coverage"] >= 0.8]
    recommended = eligible[: cfg.get("pilot_size", 3)]
    report = {"generated_at": datetime.now(UTC).isoformat(), "config": cfg, "ranking": ranked,
              "recommended_divisions": [r["division_number"] for r in recommended],
              "recommended_jurisdictions": sorted({j for r in recommended for j in r["jurisdictions"]}),
              "sensitivity_equal_weights": sensitivity, "rule": "Top `pilot_size` divisions by score among those with ≥80% of factor weight available.",
              "sources": summary["sources"]}
    (OUT / "pilot_selection.json").write_text(json.dumps(report, indent=2, default=str))
    md = _markdown(report, summary, cfg)
    p = OUT / "PILOT_SELECTION_REPORT.md"
    p.write_text(md)
    return {"recommended": report["recommended_jurisdictions"], "report_path": str(p), "ranking": ranked}


def _fmt(v, pct=False):
    if v is None:
        return "—"
    if pct:
        return f"{v * 100:.1f}%"
    return f"{v:g}" if isinstance(v, (int, float)) else str(v)


def _markdown(report: dict, summary: dict, cfg: dict) -> str:
    divs = {d["division_number"]: d for d in summary["divisions"]}
    L = ["# Pilot division selection report", "",
         f"Generated {report['generated_at'][:19]}Z by `foodaccess pilot-report` from `reports/pilot_research/title_i_division_summary.json`.",
         "", "> Title I designation and the other indicators below are **prioritization signals**, not measurements of household "
         "food insecurity. No individual student or family circumstances are inferred. Scores rank these eight candidates "
         "relative to each other only.", "",
         "## Division indicators (official data)", "",
         "| Division | Schools | Title I | Title I share | F/R eligible % | CEP schools | ACS <185% FPL | ACS SNAP hh % |",
         "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for d in summary["divisions"]:
        L.append(f"| {d['division_name']} ({d['division_number']}) | {_fmt(d['total_schools'])} | {d['title_i_schools']} | "
                 f"{_fmt(d['title_i_share'], True)} | {_fmt(d['fr_eligible_pct'])} | {_fmt(d['cep_schools'])} | "
                 f"{_fmt(d.get('acs_below_185pct_fpl_pct'))} | {_fmt(d.get('acs_snap_household_pct'))} |")
    L += ["", f"School year: {summary['school_year']} (Title I and meal-eligibility files); ACS: 2020–2024 5-year estimates.", "",
          "## Scoring", "", "| Factor | Weight |", "|---|---:|"]
    L += [f"| {f['label']} | {f['weight']} |" for f in cfg["factors"].values()]
    L += ["", "Each factor is min–max normalized across the candidates; missing factors are excluded and the remaining weights "
          "renormalized (shown as weight coverage). Divisions with <80% weight coverage are not eligible for selection.", "",
          "| Rank | Division | Score | Weight coverage | Missing factors |", "|---:|---|---:|---:|---|"]
    for r in report["ranking"]:
        L.append(f"| {r['rank']} | {r['division_name']} | {_fmt(r['score'])} | {r['weight_coverage']} | {', '.join(r['missing_factors']) or '—'} |")
    L += ["", "## Result", "",
          f"Recommended pilot divisions: **{', '.join(divs[n]['division_name'] for n in report['recommended_divisions'])}**",
          f"→ jurisdictions `{', '.join(report['recommended_jurisdictions'])}`.", "",
          "Apply by listing these jurisdictions in `config/pilot.yaml` and running `foodaccess sync-registry`.", "",
          "### Sensitivity: equal weights", "", "| Rank | Division | Score |", "|---:|---|---:|"]
    L += [f"| {r['rank']} | {r['division_name']} | {_fmt(r['score'])} |" for r in report["sensitivity_equal_weights"]]
    L += ["", "## Food-data evidence used", ""]
    L += [f"- **{r['division_name']}**: {r['evidence_notes'] or 'n/a'}" for r in report["ranking"]]
    L += ["", "## Data warnings per division", ""]
    for d in summary["divisions"]:
        L.append(f"**{d['division_name']}**")
        L += [f"- {w}" for w in d["warnings"]]
        L.append("")
    L += ["## Sources", ""]
    for s in summary["sources"]:
        L.append(f"- {s['dataset']}: official URL {s.get('official_url')}; retrieved from {s.get('retrieved_from')} "
                 f"({'Internet Archive copy of the official file' if s.get('is_archive_copy') else 'official host'}) on "
                 f"{str(s.get('retrieved_at'))[:10]}; sha256 {str(s.get('sha256'))[:16]}…")
    L += ["", "## Limitations", "",
          "- VDOE's site refused automated requests (HTTP 403) during research; the identical official files were obtained from "
          "Internet Archive snapshots of the official URLs. Re-run from a network VDOE permits to confirm checksums.",
          "- The school-count denominator is NSLP-participating schools in the meal-eligibility report; alternative directories "
          "count specialty/preschool programs differently.",
          "- CEP schools report formula-based free-meal counts, inflating F/R percentages relative to application-based schools.",
          "- Food-data availability reflects one research pass (2026-10-12); Loudoun and Falls Church were not researched and "
          "are therefore not eligible this round rather than scored as zero.",
          "- Small divisions (Manassas Park: 4 schools) produce volatile shares.", ""]
    return "\n".join(L)
