"""Jurisdiction registry: config/jurisdictions/*.yaml (+ config/pilot.yaml) → database. Idempotent."""
import json
from pathlib import Path

import yaml
from geoalchemy2.shape import from_shape
from shapely.geometry import MultiPolygon, shape
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import CoverageArea, Jurisdiction, SchoolDivision


def load_jurisdiction_configs(config_dir: Path | None = None) -> list[dict]:
    d = (config_dir or get_settings().config_dir) / "jurisdictions"
    return [yaml.safe_load(p.read_text()) for p in sorted(d.glob("*.yaml"))]


def load_pilot_config(config_dir: Path | None = None) -> dict:
    p = (config_dir or get_settings().config_dir) / "pilot.yaml"
    return yaml.safe_load(p.read_text()) if p.exists() else {}


def active_scope(config_dir: Path | None = None) -> set[str]:
    """Jurisdictions whose sources may be ingested now: pilot + expansion statuses after applying pilot.yaml."""
    pilot = set(load_pilot_config(config_dir).get("pilot_jurisdictions", []))
    out = set()
    for j in load_jurisdiction_configs(config_dir):
        status = "pilot" if j["id"] in pilot else j.get("status", "planned")
        if status in ("pilot", "expansion"):
            out.add(j["id"])
    return out


def _boundaries(data_dir: Path) -> dict[str, object]:
    out = {}
    for p in (data_dir / "boundaries").glob("*.geojson"):
        for f in json.loads(p.read_text()).get("features", []):
            geoid = str((f.get("properties") or {}).get("GEOID", ""))
            if geoid and f.get("geometry"):
                g = shape(f["geometry"])
                out[geoid] = g if g.geom_type == "MultiPolygon" else MultiPolygon([g])
    return out


def sync_jurisdictions(db: Session, config_dir: Path | None = None, data_dir: Path | None = None) -> list[str]:
    s = get_settings()
    configs = load_jurisdiction_configs(config_dir)
    pilot = set(load_pilot_config(config_dir).get("pilot_jurisdictions", []))
    bounds = _boundaries(data_dir or s.data_dir)
    changed = []
    for c in configs:
        j = db.get(Jurisdiction, c["id"]) or Jurisdiction(id=c["id"])
        j.name, j.kind, j.county_fips = c["name"], c["kind"], c.get("county_fips")
        j.status = "pilot" if c["id"] in pilot else c.get("status", "planned")
        j.config = {k: c.get(k) for k in ("center", "sources", "refresh", "school_divisions")}
        b = c.get("boundary") or {}
        geom = bounds.get(str(b.get("geoid", "")))
        if geom is not None:
            j.boundary = from_shape(geom, srid=4326)
            j.boundary_source = f"{b.get('source')}:{b.get('geoid')}"
        db.add(j)
        db.flush()
        for d in c.get("school_divisions", []):
            div = db.get(SchoolDivision, d["vdoe_number"]) or SchoolDivision(id=d["vdoe_number"], slug=d["slug"])
            div.name = d["name"]
            if j not in div.jurisdictions:
                div.jurisdictions.append(j)
            db.add(div)
        changed.append(j.id)
    sync_coverage_areas(db, config_dir, data_dir)
    db.commit()
    return changed


def sync_coverage_areas(db: Session, config_dir: Path | None = None, data_dir: Path | None = None) -> list[str]:
    s = get_settings()
    d = (config_dir or s.config_dir) / "coverage"
    out = []
    for p in sorted(d.glob("*.yaml")) if d.exists() else []:
        c = yaml.safe_load(p.read_text())
        f = (data_dir or s.data_dir) / "boundaries" / c["boundary"]["file"]
        feats = [x for x in json.loads(f.read_text())["features"] if str(x["properties"].get("GEOID")) == str(c["boundary"]["geoid"])]
        if not feats:
            continue
        g = shape(feats[0]["geometry"])
        a = db.get(CoverageArea, c["id"]) or CoverageArea(id=c["id"])
        a.name, a.kind, a.source = c["name"], c["kind"], c.get("source")
        a.boundary = from_shape(g if g.geom_type == "MultiPolygon" else MultiPolygon([g]), srid=4326)
        a.config = {k: c.get(k) for k in ("localities",)}
        db.add(a)
        out.append(a.id)
    db.flush()
    return out
