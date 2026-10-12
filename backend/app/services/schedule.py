"""Schedule evaluation: is food being distributed on a date, and when is the next distribution?

Only `distribution` schedules and events answer "is food available"; `operating_hours` describe when the office is open.
Works on plain objects (ORM rows or dataclasses) with the attributes used below.
"""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/New_York")


@dataclass
class Window:
    date: date
    opens: time | None
    closes: time | None
    kind: str  # distribution | operating_hours | event
    appointment_only: bool = False
    title: str | None = None
    event_id: int | None = None

    def as_dict(self) -> dict:
        return {
            "date": self.date.isoformat(),
            "opens": self.opens.strftime("%H:%M") if self.opens else None,
            "closes": self.closes.strftime("%H:%M") if self.closes else None,
            "kind": self.kind,
            "appointment_only": self.appointment_only,
            "title": self.title,
            "event_id": self.event_id,
        }


def week_of_month(d: date) -> int:
    return (d.day - 1) // 7 + 1


def is_last_weekday_of_month(d: date) -> bool:
    return (d + timedelta(days=7)).month != d.month


def rule_applies(rule, d: date) -> bool:
    if rule.weekday != d.weekday():
        return False
    if rule.valid_from and d < rule.valid_from:
        return False
    if rule.valid_to and d > rule.valid_to:
        return False
    wom = rule.week_of_month
    if wom is None:
        return True
    if wom == -1:
        return is_last_weekday_of_month(d)
    return week_of_month(d) == wom


def windows_on(d: date, schedules, exceptions, events, kind: str = "distribution") -> list[Window]:
    """Windows of the given kind on date d after applying exceptions. Events count as distribution windows."""
    day_exc = [e for e in exceptions if e.date == d]
    if any(e.kind in ("closed", "cancelled") for e in day_exc):
        return []
    special = [e for e in day_exc if e.kind == "special_hours"]
    out: list[Window] = []
    if special:
        out = [Window(d, e.opens, e.closes, kind) for e in special]
    else:
        out = [
            Window(d, s.opens, s.closes, kind, s.appointment_only)
            for s in schedules
            if s.kind == kind and rule_applies(s, d)
        ]
    if kind == "distribution":
        for ev in events:
            if ev.status != "scheduled":
                continue
            start = ev.starts_at.astimezone(TZ)
            if start.date() == d:
                end = ev.ends_at.astimezone(TZ).time() if ev.ends_at else None
                out.append(
                    Window(d, start.time(), end, "event", ev.appointment_required == "required", ev.title, ev.id)
                )
    return sorted(out, key=lambda w: (w.opens or time.min))


def next_distribution(now: datetime, schedules, exceptions, events, horizon_days: int = 60) -> Window | None:
    """First distribution window that has not yet ended, searching forward from `now` (aware datetime)."""
    local = now.astimezone(TZ)
    for offset in range(horizon_days + 1):
        d = local.date() + timedelta(days=offset)
        for w in windows_on(d, schedules, exceptions, events):
            if offset == 0 and w.closes and w.closes <= local.time():
                continue
            return w
    return None


def has_any_distribution_info(schedules, events) -> bool:
    return any(s.kind == "distribution" for s in schedules) or any(e.status == "scheduled" for e in events)
