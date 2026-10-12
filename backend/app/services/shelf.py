"""Live shelf status, community reports, visit planning, and calendar export."""
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.ingestion.verification.workflow import audit
from app.models import CommunityReport, Location, ShelfUpdate
from app.services.presenter import eligibility_state
from app.services.schedule import TZ, windows_on
from app.vocab import FOOD_TYPES


def end_of_local_day(now: datetime | None = None) -> datetime:
    now = (now or datetime.now(UTC)).astimezone(TZ)
    return datetime.combine(now.date(), time(23, 59, 59), tzinfo=TZ)


def current_shelf(db: Session, location_ids: list[int], now: datetime | None = None) -> dict[int, ShelfUpdate]:
    """Newest unexpired, unretracted shelf update per location. Expired status is never returned."""
    if not location_ids:
        return {}
    now = now or datetime.now(UTC)
    rows = db.scalars(select(ShelfUpdate).where(ShelfUpdate.location_id.in_(location_ids), ShelfUpdate.retracted.is_(False),
                                                ShelfUpdate.expires_at > now).order_by(ShelfUpdate.posted_at.desc())).all()
    out: dict[int, ShelfUpdate] = {}
    for r in rows:
        out.setdefault(r.location_id, r)
    return out


def shelf_dict(u: ShelfUpdate | None) -> dict | None:
    if not u:
        return None
    return {
        "status": u.status, "message": u.message,
        "items": [{**i, "group": FOOD_TYPES.get(i["food_type"])} for i in u.items or []],
        "posted_at": u.posted_at.isoformat(), "expires_at": u.expires_at.isoformat(),
        "source": "pantry", "ai_assisted": u.ai_assisted,
    }


# --- community reports ----------------------------------------------------------------------------------------------

def file_report(db: Session, loc: Location, kind: str, note: str | None) -> CommunityReport:
    r = CommunityReport(location_id=loc.id, kind=kind, note=note)
    db.add(r)
    db.flush()
    s = get_settings()
    since = datetime.now(UTC) - timedelta(days=7)
    recent = db.scalar(select(func.count()).select_from(CommunityReport).where(
        CommunityReport.location_id == loc.id, CommunityReport.status == "open",
        CommunityReport.kind.in_(("was_closed", "wrong_info")), CommunityReport.created_at >= since)) or 0
    if recent >= s.report_review_threshold and loc.review_status in ("verified", "stale"):
        loc.review_status = "needs_review"  # stays public with its verified data, flagged for a reviewer
        audit(db, None, "location", loc.id, "returned_to_review", None, {"reason": f"{recent} community reports in 7 days"},
              label="community_reports")
    db.commit()
    return r


def open_report_counts(db: Session, location_ids: list[int]) -> dict[int, int]:
    if not location_ids:
        return {}
    return dict(db.execute(select(CommunityReport.location_id, func.count()).where(
        CommunityReport.location_id.in_(location_ids), CommunityReport.status == "open").group_by(CommunityReport.location_id)).all())


# --- visit planner --------------------------------------------------------------------------------------------------

CHECKLIST = (  # requirement type -> checklist item key (labels live in the UI catalogs)
    ("photo_id", "photo_id"),
    ("proof_of_address", "proof_of_address"),
    ("income_documentation", "income_documentation"),
    ("benefit_documentation", "benefit_documentation"),
    ("referral", "referral"),
    ("appointment", "appointment"),
    ("registration", "registration"),
)


def visit_plan(loc: Location, now: datetime | None = None) -> dict:
    """What to bring / do, derived only from documented requirements. Unknown => 'ask', never 'not needed'."""
    items = []
    for req, key in CHECKLIST:
        st = eligibility_state(loc, req)
        items.append({"key": key, "action": {"required": "bring", "not_required": "not_needed", "unknown": "ask"}[st]})
    # Always-useful, non-requirement suggestions (clearly marked as suggestions)
    suggestions = ["bags"] + (["call_ahead"] if any(i["action"] == "ask" for i in items) else [])
    now = now or datetime.now(UTC)
    today = now.astimezone(TZ).date()
    windows = []
    for d in range(30):
        for w in windows_on(today + timedelta(days=d), loc.schedules, loc.exceptions, loc.events):
            if d == 0 and w.closes and w.closes <= now.astimezone(TZ).time():
                continue
            windows.append(w.as_dict())
    return {"checklist": items, "suggestions": suggestions, "next_windows": windows[:5]}


def _ics_escape(s: str) -> str:
    return s.replace("\r", "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def calendar_ics(loc: Location, app_name: str, days: int = 30, now: datetime | None = None) -> str:
    """iCalendar with the next distribution windows (recurring + events), local time zone."""
    now = now or datetime.now(UTC)
    today = now.astimezone(TZ).date()
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    addr = ", ".join(x for x in (loc.address1, loc.city, loc.state, loc.zip) if x)
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", f"PRODID:-//{app_name}//Food distribution//EN", "CALSCALE:GREGORIAN"]
    for d in range(days):
        day: date = today + timedelta(days=d)
        for w in windows_on(day, loc.schedules, loc.exceptions, loc.events):
            if not w.opens:
                continue
            start = datetime.combine(day, w.opens)
            end = datetime.combine(day, w.closes) if w.closes else start + timedelta(hours=1)
            lines += [
                "BEGIN:VEVENT", f"UID:{loc.id}-{day.isoformat()}-{w.opens.strftime('%H%M')}@lantern", f"DTSTAMP:{stamp}",
                f"DTSTART;TZID=America/New_York:{start.strftime('%Y%m%dT%H%M%S')}",
                f"DTEND;TZID=America/New_York:{end.strftime('%Y%m%dT%H%M%S')}",
                f"SUMMARY:{_ics_escape(w.title or ('Food distribution — ' + loc.name))}",
                f"LOCATION:{_ics_escape(addr)}",
                "DESCRIPTION:" + _ics_escape("Hours can change. Confirm with the pantry before you go."
                                             + (" Appointment required." if w.appointment_only else "")),
                "END:VEVENT",
            ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"
