"""Phase 0 research: VDOE Title I schools + school meal eligibility + ACS indicators, per school division.

Reproducible: downloads are cached under data/research/raw/ with a manifest of URL, copy actually used,
retrieval time and SHA-256. Re-run with --offline to recompute from the cached files.

Title I designation is used as one *prioritization* signal. It is not a measure of household food insecurity,
and nothing here describes individual students or families.
"""
import csv
import hashlib
import io
import json
from datetime import UTC, date, datetime
from pathlib import Path

import httpx
import pandas as pd
import yaml

from app.config import REPO_ROOT, get_settings

RAW = REPO_ROOT / "data" / "research" / "raw"
OUT = REPO_ROOT / "reports" / "pilot_research"


def research_config() -> dict:
    return yaml.safe_load((get_settings().config_dir / "research" / "sources.yaml").read_text())


def _manifest_path() -> Path:
    return RAW / "manifest.json"


def _manifest() -> dict:
    p = _manifest_path()
    return json.loads(p.read_text()) if p.exists() else {}


def download(key: str, urls: list[str], suffix: str, offline: bool = False) -> tuple[Path, dict]:
    """Try each URL in order (official first). Returns (path, provenance)."""
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / f"{key}{suffix}"
    man = _manifest()
    if offline or (path.exists() and key in man):
        if not path.exists():
            raise FileNotFoundError(f"{path} not cached; run without --offline")
        return path, man[key]
    attempts = []
    headers = {"User-Agent": get_settings().http_user_agent}
    with httpx.Client(timeout=120, follow_redirects=True, headers=headers) as client:
        for url in urls:
            try:
                r = client.get(url)
            except httpx.HTTPError as e:
                attempts.append({"url": url, "error": type(e).__name__})
                continue
            if r.status_code == 200 and len(r.content) > 1000 and b"missing_key" not in r.content[:2000]:
                path.write_bytes(r.content)
                prov = {"key": key, "official_url": urls[0], "retrieved_from": url, "is_archive_copy": "web.archive.org" in url,
                        "retrieved_at": datetime.now(UTC).isoformat(), "sha256": hashlib.sha256(r.content).hexdigest(),
                        "bytes": len(r.content), "failed_attempts": attempts}
                man[key] = prov
                _manifest_path().write_text(json.dumps(man, indent=2))
                return path, prov
            attempts.append({"url": url, "status": r.status_code})
    raise RuntimeError(f"could not download {key}: {attempts}")


# --- parsers (pure functions, unit-tested with fixtures) ------------------------------------------------------

def parse_title_i(xlsx: bytes | Path, sheet: str = "DATA") -> pd.DataFrame:
    df = pd.read_excel(xlsx if isinstance(xlsx, Path) else io.BytesIO(xlsx), sheet_name=sheet, dtype=str)
    df.columns = [str(c).strip().upper() for c in df.columns]
    need = {"DIVISION NAME", "DIVISION NUMBER", "SCHOOL NAME", "SCHOOL NUMBER", "FOCUS AREA"}
    missing = need - set(df.columns)
    if missing:
        raise ValueError(f"Title I file missing columns {sorted(missing)}")
    df = df[df["DIVISION NUMBER"].notna()].copy()
    df["div"] = df["DIVISION NUMBER"].str.strip().astype(float).astype(int)
    df["school"] = pd.to_numeric(df["SCHOOL NUMBER"].str.strip(), errors="coerce").astype("Int64")
    df["school_name"] = df["SCHOOL NAME"].str.strip()
    df["focus"] = df["FOCUS AREA"].str.strip()
    return df[["div", "DIVISION NAME", "school", "school_name", "focus"]]


def parse_free_reduced(xlsx: bytes | Path) -> pd.DataFrame:
    """Print-layout report: keep rows where col A is a 3-digit division and col B a school number."""
    raw = pd.read_excel(xlsx if isinstance(xlsx, Path) else io.BytesIO(xlsx), sheet_name=0, header=None, dtype=str)
    rows = []
    for _, r in raw.iterrows():
        a, b = str(r[0]).strip(), str(r[1]).strip()
        if len(a) == 3 and a.isdigit() and b.isdigit():
            def num(i):
                v = pd.to_numeric(str(r[i]).replace(",", "").strip(), errors="coerce")
                return None if pd.isna(v) else float(v)

            rows.append({"div": int(a), "school": int(b), "school_name": str(r[2]).strip(), "cep": str(r[3]).strip().upper() == "X",
                         "school_type": str(r[4]).strip(), "membership": num(7), "free": num(8), "reduced": num(10), "fr_total": num(12)})
    if not rows:
        raise ValueError("no school rows found in free/reduced report — layout changed?")
    return pd.DataFrame(rows)


def parse_acs(text: str, geo_ids: set[str], cols: list[str]) -> dict[str, dict[str, float]]:
    out = {}
    reader = csv.DictReader(io.StringIO(text), delimiter="|")
    for row in reader:
        if row["GEO_ID"] in geo_ids:
            out[row["GEO_ID"]] = {c: float(row[c]) for c in cols}
    return out


def acs_nova_extract(b22003_path: Path, c17002_path: Path, fips: list[str]) -> dict[str, dict]:
    geo = {f"0500000US51{f}": f for f in fips}
    b = parse_acs(b22003_path.read_text(errors="replace"), set(geo), ["B22003_E001", "B22003_E002"])
    c = parse_acs(c17002_path.read_text(errors="replace"), set(geo),
                  ["C17002_E001", "C17002_E002", "C17002_E003", "C17002_E004", "C17002_E005", "C17002_E006"])
    out = {}
    for gid, f in geo.items():
        if gid in b and gid in c:
            out[f] = {
                "households": b[gid]["B22003_E001"], "snap_households": b[gid]["B22003_E002"],
                "pov_universe": c[gid]["C17002_E001"], "below_poverty": c[gid]["C17002_E002"] + c[gid]["C17002_E003"],
                "below_185pct": sum(c[gid][f"C17002_E00{i}"] for i in range(2, 7)),
            }
    return out


def division_summary(title_i: pd.DataFrame, fr: pd.DataFrame, acs: dict[str, dict], divisions: dict, cfg: dict) -> list[dict]:
    rows = []
    fr_keys = set(zip(fr["div"], fr["school"], strict=False))
    for div_no, d in divisions.items():
        div_no = int(div_no)
        ti = title_i[title_i["div"] == div_no]
        f = fr[fr["div"] == div_no]
        warnings = []
        total = len(f) if len(f) else None
        n_ti = len(ti)
        unmatched = [r.school_name for r in ti.itertuples() if (div_no, r.school) not in fr_keys]
        if unmatched:
            warnings.append(f"{len(unmatched)} Title I school(s) not found in the free/reduced report by school number: "
                            + "; ".join(unmatched))
        if total is None:
            warnings.append("No school rows in the free/reduced report; Title I share not computed.")
        warnings.append("Denominator = schools listed in the VDOE NSLP free/reduced eligibility report (NSLP-participating "
                        "public schools); it may differ slightly from other school counts.")
        mem = f["membership"].sum(skipna=True) if total else None
        frt = f["fr_total"].sum(skipna=True) if total else None
        cep = int(f["cep"].sum()) if total else None
        if cep:
            warnings.append(f"{cep} school(s) use the Community Eligibility Provision; VDOE computes their free counts from the "
                            "Identified Student Percentage, so free/reduced shares there are formula-based, not applications.")
        a = [acs[x] for x in d["fips"] if x in acs]
        ind = {}
        if a and len(a) == len(d["fips"]):
            hh, snap = sum(x["households"] for x in a), sum(x["snap_households"] for x in a)
            pu, bp, b185 = (sum(x[k] for x in a) for k in ("pov_universe", "below_poverty", "below_185pct"))
            ind = {"acs_snap_household_pct": round(100 * snap / hh, 1), "acs_poverty_pct": round(100 * bp / pu, 1),
                   "acs_below_185pct_fpl_pct": round(100 * b185 / pu, 1)}
            if len(d["fips"]) > 1:
                warnings.append(f"ACS values aggregate localities {', '.join(d['fips'])} served by this division.")
            warnings.append("ACS indicators are residence-based 5-year estimates with margins of error; school data are "
                            "enrollment-based. They are not interchangeable.")
        else:
            warnings.append("ACS indicators unavailable for one or more served localities.")
        rows.append({
            "division_number": div_no, "division_name": d["name"], "jurisdictions": d["jurisdictions"],
            "school_year": cfg["title_i"]["school_year"],
            "total_schools": total, "title_i_schools": n_ti,
            "title_i_share": round(n_ti / total, 3) if total else None,
            "title_i_schoolwide": int((ti["focus"] == "Title I - Schoolwide").sum()),
            "title_i_targeted": int((ti["focus"] == "Title I - Targeted Assistance").sum()),
            "fr_eligible_pct": round(100 * frt / mem, 1) if mem else None,
            "cep_schools": cep,
            **ind,
            "warnings": warnings,
        })
    return rows


def run_title_i_analysis(offline: bool = False, write_db: bool = True) -> dict:
    cfg = research_config()
    ti_path, ti_prov = download("title_i_2025_26", cfg["title_i"]["urls"], ".xlsx", offline)
    fr_path, fr_prov = download("free_reduced_by_school_2025_26", cfg["free_reduced_by_school"]["urls"], ".xlsx", offline)
    title_i = parse_title_i(ti_path, cfg["title_i"]["sheet"])
    fr = parse_free_reduced(fr_path)
    fips = sorted({f for d in cfg["divisions"].values() for f in d["fips"]})
    acs_extract = REPO_ROOT / "data" / "research" / "acs_2024_5yr_nova.json"
    acs_prov = {}
    try:
        b_path, b_prov = download("acs5_2024_b22003", [cfg["acs"]["b22003"]], ".dat", offline)
        c_path, c_prov = download("acs5_2024_c17002", [cfg["acs"]["c17002"]], ".dat", offline)
        acs = acs_nova_extract(b_path, c_path, fips)
        acs_prov = {"b22003": b_prov, "c17002": c_prov}
        acs_extract.write_text(json.dumps({"provenance": acs_prov, "values": acs}, indent=2))
    except (RuntimeError, FileNotFoundError):
        if acs_extract.exists():  # small committed extract keeps the analysis reproducible offline
            saved = json.loads(acs_extract.read_text())
            acs, acs_prov = saved["values"], {**saved["provenance"], "note": "from committed extract"}
        else:
            acs = {}
    summary = division_summary(title_i, fr, acs, cfg["divisions"], cfg)
    sources = [
        {"dataset": cfg["title_i"]["label"], **ti_prov},
        {"dataset": cfg["free_reduced_by_school"]["label"], **fr_prov},
        *({"dataset": cfg["acs"]["label"] + f" ({k})", **v} for k, v in acs_prov.items() if isinstance(v, dict)),
    ]
    OUT.mkdir(parents=True, exist_ok=True)
    payload = {"generated_at": datetime.now(UTC).isoformat(), "school_year": cfg["title_i"]["school_year"],
               "statewide_title_i_rows": int(len(title_i)), "divisions": summary, "sources": sources,
               "caveat": "Title I designation is a prioritization indicator, not a measure of household food insecurity. "
                         "No individual student or family circumstances are inferred."}
    jp = OUT / "title_i_division_summary.json"
    jp.write_text(json.dumps(payload, indent=2, default=str))
    cp = OUT / "title_i_division_summary.csv"
    keys = [k for k in summary[0] if k != "warnings"]
    with cp.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=keys + ["warnings"])
        w.writeheader()
        for r in summary:
            w.writerow({**{k: (";".join(r[k]) if isinstance(r[k], list) else r[k]) for k in keys}, "warnings": " | ".join(r["warnings"])})
    if write_db:
        _store(summary, sources)
    return {"summary": summary, "sources": sources, "summary_paths": [str(jp), str(cp)]}


def _store(summary: list[dict], sources: list[dict]) -> None:
    from sqlalchemy.exc import OperationalError

    from app.db import session_factory
    from app.models import SchoolDivision, TitleIDivisionMetric

    try:
        with session_factory()() as db:
            for r in summary:
                if not db.get(SchoolDivision, r["division_number"]):
                    continue  # registry not bootstrapped for this division
                m = db.query(TitleIDivisionMetric).filter_by(division_id=r["division_number"], school_year=r["school_year"]).first() \
                    or TitleIDivisionMetric(division_id=r["division_number"], school_year=r["school_year"])
                m.total_schools, m.title_i_schools, m.title_i_share = r["total_schools"], r["title_i_schools"], r["title_i_share"]
                m.directory_school_year = r["school_year"]
                m.indicators = {k: r.get(k) for k in ("fr_eligible_pct", "cep_schools", "acs_snap_household_pct", "acs_poverty_pct",
                                                      "acs_below_185pct_fpl_pct")}
                m.sources, m.warnings = sources, r["warnings"]
                m.retrieved_on, m.updated_at = date.today(), datetime.now(UTC)
                db.add(m)
            db.commit()
    except OperationalError:
        pass  # research can run without a database
