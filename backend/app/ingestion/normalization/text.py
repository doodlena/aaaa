"""Normalization helpers for names, addresses, phones, URLs, and free-text schedules/categories.

Everything here treats input as untrusted text: we strip markup, never execute it, and never guess values.
"""
import re
from datetime import time
from urllib.parse import urlparse

from bs4 import BeautifulSoup

_WS = re.compile(r"\s+")
_ORG_STOP = {"inc", "the", "of", "llc", "corp", "corporation", "incorporated", "and", "&"}
_STREET_ABBR = {
    "street": "st", "avenue": "ave", "road": "rd", "drive": "dr", "boulevard": "blvd", "lane": "ln",
    "court": "ct", "place": "pl", "parkway": "pkwy", "highway": "hwy", "pike": "pike", "circle": "cir",
    "terrace": "ter", "square": "sq", "way": "way", "north": "n", "south": "s", "east": "e", "west": "w",
    "suite": "ste", "#": "ste",
}


def clean_text(value, keep_lines: bool = False) -> str | None:
    """Strip HTML tags/control chars and collapse whitespace (optionally keeping line breaks). None for empty."""
    if value is None:
        return None
    s = str(value)
    if "<" in s and ">" in s:
        soup = BeautifulSoup(s, "lxml")
        for tag in soup(["script", "style", "noscript", "template"]):
            tag.decompose()  # drop executable/hidden content entirely
        s = soup.get_text(" ")
    s = "".join(ch for ch in s if ch.isprintable() or ch in "\n\t")
    if keep_lines:
        s = "\n".join(_WS.sub(" ", line).strip() for line in s.replace("\r", "\n").split("\n") if line.strip())
    else:
        s = _WS.sub(" ", s).strip()
    return s or None


def normalize_name(name: str | None) -> str:
    s = (clean_text(name) or "").lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return " ".join(t for t in s.split() if t not in _ORG_STOP)


def normalize_address(address1: str | None, zip_code: str | None = None) -> str | None:
    s = (clean_text(address1) or "").lower().replace(".", "").replace(",", " ")
    if not s:
        return None
    toks = [_STREET_ABBR.get(t, t) for t in s.split()]
    out = " ".join(toks)
    z = normalize_zip(zip_code)
    return f"{out} {z}" if z else out


def normalize_zip(value) -> str | None:
    """The ZIP in a ZIP field or a full address. In "10056 Dean Dr, Manassas, VA 20110" the house number also has
    five digits, so take the LAST five-digit group, and never a number that starts a street address."""
    if value is None:
        return None
    text = str(value).strip()
    found = list(re.finditer(r"\b(\d{5})(?:-\d{4})?\b", text))
    if not found:
        return None
    if len(found) == 1 and found[0].start() == 0 and re.match(r"\d{5}\s+\S", text) and not re.fullmatch(r"\d{5}(-\d{4})?", text):
        return None  # "10056 Dean Drive, Manassas": that's a house number, and no ZIP is given
    return found[-1].group(1)


_UNIT = re.compile(r"^(suite|ste\.?|#|unit|apt\.?|apartment|room|rm\.?|bldg\.?|building|floor|fl\.?|\d+(st|nd|rd|th) floor)\b", re.I)
_STATE_ZIP = re.compile(r"^(va|virginia|dc|md)?\s*(\d{5}(-\d{4})?)?$", re.I)


def split_address(text: str | None) -> tuple[str | None, str | None, str | None]:
    """'8033 Ashton Ave, Suite 103, Manassas, VA 20109' -> ('8033 Ashton Ave', 'Suite 103', 'Manassas').
    Unit parts go to address2; the city is the last part before the state/ZIP that isn't a unit."""
    parts = [p.strip() for p in (text or "").split(",") if p.strip()]
    if not parts:
        return None, None, None
    address1, rest = parts[0], parts[1:]
    while rest and _STATE_ZIP.match(rest[-1]):
        rest = rest[:-1]
    units = [p for p in rest if _UNIT.match(p)]
    others = [p for p in rest if not _UNIT.match(p)]
    city = others[-1] if others else None
    if city:
        city = re.sub(r"\s+(va|virginia)(\s+\d{5}(-\d{4})?)?$", "", city, flags=re.I).strip() or None
    return address1, (", ".join(units) or None), city


def normalize_phone(value) -> str | None:
    """First US phone number in the text (sources often append extensions or second numbers)."""
    m = re.search(r"(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}", str(value or ""))
    digits = re.sub(r"\D", "", m.group(0)) if m else ""
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return None
    return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"


def normalize_url(value) -> str | None:
    s = clean_text(value)
    if not s:
        return None
    if not re.match(r"^https?://", s, re.I):
        if re.match(r"^[\w.-]+\.[a-z]{2,}(/.*)?$", s, re.I):
            s = "https://" + s
        else:
            return None
    p = urlparse(s)
    if p.scheme not in ("http", "https") or not p.netloc:
        return None
    return s


def url_domain(value) -> str | None:
    u = normalize_url(value)
    if not u:
        return None
    host = urlparse(u).netloc.lower()
    return host[4:] if host.startswith("www.") else host


# --- Free-text schedule parsing --------------------------------------------------------------------------------

_DAYS = {
    "monday": 0, "mon": 0, "tuesday": 1, "tue": 1, "tues": 1, "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3, "thur": 3, "thurs": 3, "friday": 4, "fri": 4, "saturday": 5, "sat": 5,
    "sunday": 6, "sun": 6,
}
_ORDINAL = {"1st": 1, "first": 1, "2nd": 2, "second": 2, "3rd": 3, "third": 3, "4th": 4, "fourth": 4, "5th": 5,
            "fifth": 5, "last": -1}
_TIME = r"(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|noon)?"
_RANGE = re.compile(_TIME + r"\s*(?:-|–|—|to|until)\s*" + _TIME, re.I)
_DAY_RE = "|".join(sorted(_DAYS, key=len, reverse=True))
_NON_DISTRIBUTION = re.compile(r"\b(enrollment|enroll|registration|office|thrift|clothing|donations?|closed)\b")


def _to_time(h: str, m: str | None, ampm: str | None, fallback_ampm: str | None = None) -> time | None:
    hour, minute = int(h), int(m or 0)
    mer = (ampm or fallback_ampm or "").lower().replace(".", "")
    if mer == "noon":
        return time(12, 0)
    if mer == "pm" and hour < 12:
        hour += 12
    if mer == "am" and hour == 12:
        hour = 0
    if not (0 <= hour < 24 and 0 <= minute < 60):
        return None
    return time(hour, minute)


def parse_schedule_text(text: str | None) -> list[dict]:
    """Parse simple English schedule phrases into weekly/monthly rules.

    Handles e.g. "Tuesdays 10am-12pm", "Mon & Thu 9:00 - 11:30 AM", "2nd and 4th Saturday 9-11am",
    "Monday-Friday 9am-5pm". Returns [] when it cannot parse confidently — callers must then keep the raw text
    for manual review rather than inventing hours. Times without am/pm are only accepted when the closing time
    carries a meridiem.
    """
    if not text:
        return []
    rules: list[dict] = []
    sentences = re.split(r"(?<=[a-z0-9)])\.\s+(?=[A-Z])", text)  # "…1:00 pm. At other times…" (not "a.m. and")
    for segment in (p for s_ in sentences for p in re.split(r"[;\n]|(?<=[ap]m)\s*,\s*", s_, flags=re.I)):
        seg = segment.strip().lower()
        if not seg or _NON_DISTRIBUTION.search(seg):
            continue  # enrollment, office, thrift... windows are not food distribution
        ranges = list(_RANGE.finditer(seg))
        if not ranges:
            continue
        def days_in(part: str) -> tuple[list[int], list]:
            span = re.search(rf"\b({_DAY_RE})s?\b\s*(?:-|–|through|thru|to)\s*\b({_DAY_RE})s?\b", part)
            if span:
                a, b = _DAYS[span.group(1)], _DAYS[span.group(2)]
                ds = list(range(a, b + 1)) if a <= b else []
            else:
                ds = [_DAYS[m] for m in re.findall(rf"\b({_DAY_RE})s?\b", part)]
            os_ = [_ORDINAL[o] for o in re.findall(r"\b(1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth|last)\b", part)]
            return ds, os_

        # Each time range belongs to the days written just before it ("Tue 1-2 PM Thu 6-7 PM"); a range with no
        # days of its own shares the previous range's days ("Mon & Thu 9-11am, 1-3pm").
        days, ords = [], []
        prev_end = 0
        for rng in ranges:
            d_here, o_here = days_in(seg[prev_end: rng.start()])
            if d_here:
                days, ords = d_here, o_here
            prev_end = rng.end()
            if not days:
                continue
            h1, m1, a1, h2, m2, a2 = rng.groups()
            if not a2 and not a1:
                continue
            closes = _to_time(h2, m2, a2, a1)
            opens = _to_time(h1, m1, a1, a2)
            if opens and closes and opens >= closes and not a1 and a2 and a2.lower().startswith("p"):
                opens = _to_time(h1, m1, "am")  # "11-1pm" => 11am-1pm
            if not opens or not closes or opens >= closes:
                continue
            for d in dict.fromkeys(days):
                for w in ords or [None]:
                    rule = {"weekday": d, "opens": opens.strftime("%H:%M"), "closes": closes.strftime("%H:%M"), "week_of_month": w}
                    if rule not in rules:
                        rules.append(rule)
    return rules


# --- Category keyword mapping ----------------------------------------------------------------------------------
# Only explicit mentions map to a category. Absence of a keyword never implies absence of the food type.

FOOD_KEYWORDS = {
    "general_groceries": [r"\bgrocer(y|ies)\b"],
    "pantry_staples": [r"\bcanned\b", r"\bnon-?perishable", r"\bpantry staples?\b", r"\bdry goods\b", r"\bshelf[- ]stable\b"],
    "fresh_fruits": [r"\bfruits?\b"],
    "fresh_vegetables": [r"\bvegetables?\b", r"\bveggies\b"],
    "meat": [r"\bmeats?\b", r"\bbeef\b", r"\bpork\b"],
    "poultry": [r"\bpoultry\b", r"\bchicken\b", r"\bturkeys?\b"],
    "fish": [r"\bfish\b", r"\bseafood\b"],
    "dairy": [r"\bdairy\b", r"\bmilk\b", r"\bcheese\b", r"\byogurt\b"],
    "eggs": [r"\beggs?\b"],
    "frozen_foods": [r"\bfrozen\b"],
    "bread": [r"\bbread\b"],
    "baked_goods": [r"\bbaked goods\b", r"\bpastr(y|ies)\b"],
    "prepared_meals": [r"\bprepared meals?\b", r"\bhot meals?\b", r"\bmeals? to go\b"],
    "community_meals": [r"\bcommunity meals?\b", r"\bsoup kitchen\b", r"\bfree (lunch|dinner|breakfast)\b"],
    "emergency_food_packages": [r"\bemergency food\b", r"\bemergency (bags?|boxes|packages?)\b"],
    "baby_formula": [r"\bformula\b"],
    "infant_food": [r"\bbaby food\b", r"\binfant food\b"],
    "halal": [r"\bhalal\b"],
    "kosher": [r"\bkosher\b"],
    "vegetarian": [r"\bvegetarian\b", r"\bvegan\b"],
    "culturally_specific": [r"\bculturally (specific|appropriate|relevant)\b", r"\blatin[oa]? foods?\b"],
}
PRODUCE_GENERIC = re.compile(r"\b(fresh )?produce\b", re.I)

SERVICE_KEYWORDS = {
    "drive_through": [r"\bdrive[- ]?(thru|through|up)\b"],
    "walk_up": [r"\bwalk[- ]?up\b", r"\bwalk[- ]?in\b"],
    "mobile_pantry": [r"\bmobile (pantry|market|food)\b"],
    "community_meal": [r"\bcommunity meals?\b", r"\bsoup kitchen\b", r"\bhot meals?\b"],
    "home_delivery": [r"\bhome delivery\b", r"\bdelivers? to (your )?home\b", r"\bhomebound\b"],
    "school_based": [r"\bschool[- ]based\b", r"\bbackpack program\b", r"\bweekend (food|meals?) for (kids|students)\b"],
    "emergency_food": [r"\bemergency food\b"],
    "grocery_voucher": [r"\bvouchers?\b", r"\bgift cards?\b"],
    "diapers": [r"\bdiapers?\b"],
    "hygiene_supplies": [r"\bhygiene\b", r"\btoiletries\b"],
    "household_essentials": [r"\bhousehold (items|essentials|supplies)\b", r"\bcleaning supplies\b"],
    "pantry_pickup": [r"\bfood pantry\b", r"\bpantry\b"],
    "snap_application_help": [r"\bsnap (application|enrollment|sign[- ]?up)\b", r"\bapply for snap\b"],
    "wic_services": [r"\bwic\b"],
    "mental_health_counseling": [r"\bmental health (services|counseling|care|treatment)\b", r"\bbehavioral health\b", r"\bpsychotherapy\b"],
    "crisis_support": [r"\bcrisis (counseling|intervention|stabilization|line|hotline)\b", r"\bsuicide prevention\b"],
    "substance_use_treatment": [r"\bsubstance use\b", r"\baddiction\b"],
    "health_clinic": [r"\bhealth clinic\b", r"\bmedical care\b"],
    "clothing": [r"\bclothing\b", r"\bclothes closet\b"],
    "utility_assistance": [r"\butility (bill )?assistance\b"],
    "housing_assistance": [r"\brent(al)? assistance\b", r"\bhousing assistance\b"],
    "legal_aid": [r"\blegal aid\b", r"\blegal services\b"],
    "esl_classes": [r"\besl\b", r"\benglish classes\b"],
    "job_training": [r"\bjob training\b", r"\bemployment services\b"],
    "reproductive_health": [r"\bfamily planning\b", r"\bbirth control\b", r"\bcontracepti", r"\bsti testing\b", r"\bplanned parenthood\b",
                            r"\breproductive health\b"],
    "prenatal_care": [r"\bprenatal\b", r"\bpregnancy care\b"],
    "pet_food": [r"\bpet food\b", r"\b(dog|cat) food\b"],
    "veterinary_care": [r"\b(low[- ]cost|free) (vet|veterinary)\b", r"\bveterinary (care|clinic)\b"],
    "pet_friendly_shelter": [r"\bpet[- ]friendly shelter\b", r"\bshelter (that )?accepts? pets\b"],
}


def match_keywords(text: str | None, table: dict[str, list[str]]) -> list[str]:
    if not text:
        return []
    return [code for code, pats in table.items() if any(re.search(p, text, re.I) for p in pats)]


def food_types_from_text(text: str | None) -> list[str]:
    found = match_keywords(text, FOOD_KEYWORDS)
    if text and PRODUCE_GENERIC.search(text):
        found += [c for c in ("fresh_fruits", "fresh_vegetables") if c not in found]
    return found


def tristate_from_text(text: str | None, required_patterns: list[str], not_required_patterns: list[str]) -> str:
    """'required' / 'not_required' only on explicit wording; otherwise 'unknown'. Negations win over mentions."""
    if not text:
        return "unknown"
    if any(re.search(p, text, re.I) for p in not_required_patterns):
        return "not_required"
    if any(re.search(p, text, re.I) for p in required_patterns):
        return "required"
    return "unknown"


ELIGIBILITY_PATTERNS = {
    "photo_id": ([r"\b(photo )?id(entification)? (is )?required\b", r"\bbring (a |your )?(photo )?id\b", r"\bmust (show|present) (a )?(photo )?id"],
                 [r"\bno id(entification)? (is )?(required|needed)\b", r"\bid (is )?not required\b"]),
    "proof_of_address": ([r"\bproof of (address|residen(ce|cy))\b"], [r"\bno proof of (address|residen(ce|cy)) (required|needed)\b"]),
    "income_documentation": ([r"\bproof of income\b", r"\bincome (verification|documentation)\b", r"\bpay ?stubs?\b"],
                             [r"\bno (proof of )?income (verification|documentation|proof)? ?(is )?(required|needed)\b"]),
    "referral": ([r"\breferral (is )?required\b", r"\bby referral( only)?\b", r"\bmust be referred\b"], [r"\bno referral (is )?(required|needed)\b"]),
    "appointment": ([r"\bby appointment( only)?\b", r"\bappointment (is )?required\b", r"\bcall (ahead|to schedule)\b"],
                    [r"\bno appointment (is )?(required|needed|necessary)\b", r"\bwalk[- ]?ins? welcome\b"]),
    "registration": ([r"\bregistration (is )?required\b", r"\bmust (pre-?)?register\b", r"\bpre-?registration\b"],
                     [r"\bno (pre-?)?registration (is )?(required|needed)\b"]),
    "residency": ([r"\bresidents? only\b", r"\bmust (live|reside) in\b", r"\bserves? residents of\b"], [r"\bopen to (all|everyone|anyone)\b", r"\bno residency requirement\b"]),
    "first_come_first_served": ([r"\bfirst[- ]come,? first[- ]serve"], []),
}


def eligibility_from_text(text: str | None) -> dict[str, str]:
    """Return only conditions explicitly stated in the text; omitted conditions remain unknown."""
    out = {}
    for code, (req, notreq) in ELIGIBILITY_PATTERNS.items():
        state = tristate_from_text(text, req, notreq)
        if state != "unknown":
            out[code] = state
    return out
