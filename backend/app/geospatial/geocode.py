"""Geocoding provider chain (all free, no API keys).

- zip:       local ZIP Code Tabulation Area centroids (US Census Gazetteer, public domain) — offline, instant.
- census:    US Census Bureau Geocoder (public, no key) for street addresses.
- nominatim: OpenStreetMap Nominatim. The public instance allows max 1 req/s and forbids heavy use; point
             FOODACCESS_NOMINATIM_URL at a self-hosted instance in production.

User-entered queries are never logged or stored.
"""
import csv
import re
import threading
import time
from functools import lru_cache

import httpx

from app.config import get_settings

NOVA_BBOX = (-78.2, 38.4, -76.9, 39.4)  # lon/lat bounds used to bias / sanity-check results


@lru_cache
def zip_centroids() -> dict[str, tuple[float, float]]:
    path = get_settings().data_dir / "reference" / "zcta_centroids_va_dc_md.csv"
    if not path.exists():
        return {}
    with path.open() as f:
        return {r["zcta"]: (float(r["lat"]), float(r["lon"])) for r in csv.DictReader(f)}


def _zip(q: str) -> list[dict]:
    m = re.fullmatch(r"\s*(\d{5})(-\d{4})?\s*", q)
    if not m:
        return []
    c = zip_centroids().get(m.group(1))
    if not c:
        return []
    return [{"label": f"ZIP {m.group(1)}", "lat": c[0], "lon": c[1], "source": "census_zcta", "precision": "zip"}]


def _census(q: str) -> list[dict]:
    if not re.search(r"\d", q) or len(q) < 6:
        return []
    r = httpx.get(
        "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
        params={"address": q if re.search(r"\bva\b|virginia", q, re.I) else f"{q}, VA", "benchmark": "Public_AR_Current", "format": "json"},
        timeout=10,
        headers={"User-Agent": get_settings().http_user_agent},
    )
    r.raise_for_status()
    out = []
    for m in r.json().get("result", {}).get("addressMatches", [])[:5]:
        out.append({"label": m["matchedAddress"], "lat": m["coordinates"]["y"], "lon": m["coordinates"]["x"],
                    "source": "census_geocoder", "precision": "address"})
    return out


_nominatim_lock = threading.Lock()
_nominatim_last = [0.0]


def _nominatim(q: str) -> list[dict]:
    s = get_settings()
    with _nominatim_lock:  # honour 1 request/second
        wait = 1.0 - (time.monotonic() - _nominatim_last[0])
        if wait > 0:
            time.sleep(wait)
        _nominatim_last[0] = time.monotonic()
    minx, miny, maxx, maxy = NOVA_BBOX
    r = httpx.get(
        f"{s.nominatim_url}/search",
        params={"q": q, "format": "jsonv2", "limit": 5, "countrycodes": "us", "viewbox": f"{minx},{maxy},{maxx},{miny}", "bounded": 1},
        timeout=10,
        headers={"User-Agent": s.http_user_agent},
    )
    r.raise_for_status()
    return [{"label": x["display_name"], "lat": float(x["lat"]), "lon": float(x["lon"]), "source": "nominatim",
             "precision": "address" if x.get("addresstype") in ("building", "house", "place") else "area"} for x in r.json()]


PROVIDERS = {"zip": _zip, "census": _census, "nominatim": _nominatim}


_cache: dict[str, tuple] = {}


def geocode(q: str) -> tuple[tuple[dict, ...], tuple[str, ...]]:
    """Returns (results, provider errors). Errors name the provider only, never the query. Only fully successful
    lookups are cached (in memory, bounded), so a transient provider outage is not remembered."""
    q = " ".join(q.lower().split())
    if q in _cache:
        return _cache[q]
    out = _geocode(q)
    if not out[1]:
        if len(_cache) > 2048:
            _cache.clear()
        _cache[q] = out
    return out


def _geocode(q: str) -> tuple[tuple[dict, ...], tuple[str, ...]]:
    errors = []
    for name in get_settings().geocoders:
        fn = PROVIDERS.get(name)
        if not fn:
            continue
        try:
            res = fn(q)
        except (httpx.HTTPError, ValueError, KeyError):
            errors.append(name)
            continue
        if res:
            return tuple(res), tuple(errors)
    return (), tuple(errors)
