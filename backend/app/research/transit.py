"""Transit reference data (Metro, VRE, Metrobus + other bus stops) from Open Data DC's regional transportation
layers (WMATA-sourced; CC BY 4.0). Saved to data/reference/transit_stops.json and used offline for 'Getting there'."""
import json
from math import asin, cos, radians, sin, sqrt

import httpx

from app.config import REPO_ROOT, get_settings

BASE = "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Transportation_Rail_Bus_WebMercator/MapServer"
ENV = '{"xmin":-77.9,"ymin":38.5,"xmax":-76.95,"ymax":39.3,"spatialReference":{"wkid":4326}}'
LAYERS = {51: "metro", 99: "vre", 53: "bus", 56: "bus"}
OUT = REPO_ROOT / "data" / "reference" / "transit_stops.json"


def _features(client: httpx.Client, layer: int) -> list[dict]:
    feats, offset = [], 0
    while True:
        r = client.get(f"{BASE}/{layer}/query", params={
            "where": "1=1", "geometry": ENV, "geometryType": "esriGeometryEnvelope", "inSR": 4326,
            "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "outSR": 4326, "f": "geojson",
            "resultOffset": offset, "resultRecordCount": 2000})
        r.raise_for_status()
        page = r.json().get("features", [])
        feats += page
        if len(page) < 2000:
            return feats
        offset += 2000


def import_transit() -> dict:
    stops = []
    with httpx.Client(timeout=120, headers={"User-Agent": get_settings().http_user_agent}) as c:
        for layer, kind in LAYERS.items():
            for f in _features(c, layer):
                p, g = f.get("properties") or {}, f.get("geometry") or {}
                if g.get("type") != "Point":
                    continue
                lon, lat = g["coordinates"][:2]
                if kind == "bus":
                    name = " & ".join(x for x in (p.get("ON_STR"), p.get("AT_STR")) if x) or p.get("NAME") or "Bus stop"
                    routes = p.get("ROUTEID") or p.get("ROUTES") or p.get("ROUTE")
                    stops.append({"kind": "bus", "name": str(name).title()[:80], "routes": str(routes)[:120] if routes else None,
                                  "lat": round(lat, 6), "lon": round(lon, 6)})
                else:
                    stops.append({"kind": kind, "name": p.get("NAME"), "lines": p.get("LINE"), "lat": round(lat, 6), "lon": round(lon, 6)})
    OUT.write_text(json.dumps({"_source": "Open Data DC regional transportation layers (WMATA, VRE, regional bus); CC BY 4.0. "
                                          "Retrieved via maps2.dcgis.dc.gov Transportation_Rail_Bus MapServer layers 51, 99, 53, 56.",
                               "stops": stops}, separators=(",", ":")))
    return {k: sum(1 for s in stops if s["kind"] == k) for k in ("metro", "vre", "bus")}


_cache: list[dict] | None = None


def _stops() -> list[dict]:
    global _cache
    if _cache is None:
        _cache = json.loads(OUT.read_text())["stops"] if OUT.exists() else []
    return _cache


def _km(lat1, lon1, lat2, lon2) -> float:
    lat1, lon1, lat2, lon2 = map(radians, (lat1, lon1, lat2, lon2))
    a = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371 * asin(sqrt(a))


def getting_there(lat: float | None, lon: float | None) -> dict | None:
    """Nearest rail stations and nearby bus stops (straight-line distance; walking time estimated at 80 m/min)."""
    if lat is None or lon is None or not _stops():
        return None
    rail, bus = [], []
    for s in _stops():
        if abs(s["lat"] - lat) > 0.05 or abs(s["lon"] - lon) > 0.06:  # cheap prefilter (~5 km)
            continue
        d = _km(lat, lon, s["lat"], s["lon"])
        (bus if s["kind"] == "bus" else rail).append((d, s))
    rail.sort(key=lambda x: x[0])
    bus.sort(key=lambda x: x[0])
    near_bus, seen = [], set()
    for d, s in bus:
        if d > 0.4:
            break
        if s["name"] in seen:  # both sides of the street share a name
            continue
        seen.add(s["name"])
        near_bus.append((d, s))
    count_400 = sum(1 for d, _ in bus if d <= 0.4)
    fmt = lambda d, s: {**{k: v for k, v in s.items() if k not in ("lat", "lon")}, "distance_km": round(d, 2),  # noqa: E731
                        "walk_minutes": max(1, round(d * 1000 / 80))}
    return {
        "rail": [fmt(d, s) for d, s in rail[:2] if d <= 3],
        "bus_stops_within_400m": count_400,
        "nearest_bus": [fmt(d, s) for d, s in near_bus[:3]],
        "attribution": "Transit stops: Open Data DC / WMATA / VRE (CC BY 4.0). Distances are straight-line estimates.",
    }
