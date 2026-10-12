"""Duplicate scoring between an incoming candidate and existing locations.

Score is a rule-based heuristic in [0, 1] used only to route records (auto-link / review / new). It is NOT a
probability and is never shown to the public.
"""
from dataclasses import dataclass, field
from math import asin, cos, radians, sin, sqrt

from rapidfuzz import fuzz

AUTO_LINK = 0.85
REVIEW = 0.5


@dataclass
class MatchInput:
    name: str  # normalized org/location name
    address: str | None  # normalized address
    lat: float | None
    lon: float | None
    domain: str | None
    phone: str | None


@dataclass
class MatchResult:
    score: float
    reasons: list[str] = field(default_factory=list)


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    lat1, lon1, lat2, lon2 = map(radians, (lat1, lon1, lat2, lon2))
    a = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371000 * asin(sqrt(a))


def score(a: MatchInput, b: MatchInput) -> MatchResult:
    reasons: list[str] = []
    name_sim = fuzz.token_set_ratio(a.name, b.name) / 100 if a.name and b.name else 0.0
    same_addr = bool(a.address and b.address and a.address == b.address)
    near = None
    if None not in (a.lat, a.lon, b.lat, b.lon):
        near = haversine_m(a.lat, a.lon, b.lat, b.lon)
    same_domain = bool(a.domain and a.domain == b.domain)
    same_phone = bool(a.phone and a.phone == b.phone)

    s = 0.0
    if name_sim >= 0.9:
        s += 0.4
        reasons.append(f"name similarity {name_sim:.2f}")
    elif name_sim >= 0.7:
        s += 0.2
        reasons.append(f"partial name similarity {name_sim:.2f}")
    if same_addr:
        s += 0.45
        reasons.append("same normalized address")
    elif near is not None and near <= 75:
        s += 0.3
        reasons.append(f"within {near:.0f} m")
    elif near is not None and near <= 300:
        s += 0.1
        reasons.append(f"within {near:.0f} m")
    if same_phone:
        s += 0.15
        reasons.append("same phone")
    if same_domain:
        s += 0.1
        reasons.append("same website domain")
    # Same building, different organization (e.g. church hosting two pantries) must not auto-merge.
    if (same_addr or (near is not None and near <= 75)) and name_sim < 0.6:
        s = min(s, AUTO_LINK - 0.01)
        reasons.append("co-located but names differ")
    return MatchResult(min(s, 1.0), reasons)


def classify(result: MatchResult) -> str:
    if result.score >= AUTO_LINK:
        return "auto_link"
    if result.score >= REVIEW:
        return "review"
    return "distinct"
