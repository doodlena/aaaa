"""Switches admins flip at runtime (Admin → Site settings). provider_features and district_only are site-wide, stored
in app_settings; demo_mode is per browser.

- demo_mode: only for the browser that turned it on (the `lantern_demo` cookie, read per request by the middleware in
  app/main.py). That browser sees the fictional demo providers (app/services/demo.py) added to the real listings, and
  its admin dashboard shows only demo data, for filming and live demos. Everyone else sees the normal site; real
  listings are never altered.
- district_only: the public site shows only listings inside Virginia's 8th congressional district (on by default).
- provider_features: live provider updates (today's status, "on the shelf today" filters, the home page feed).
  Off until providers are actually posting; demo mode always turns them on.
"""
import time
from contextvars import ContextVar

from sqlalchemy.exc import SQLAlchemyError

KEYS = ("provider_features", "district_only")  # site-wide, stored; demo_mode is per browser
DEMO_COOKIE = "lantern_demo"
_demo: ContextVar[bool] = ContextVar("demo_mode", default=False)
_cache: tuple[float, dict] | None = None
_TTL = 10.0  # seconds; admin writes call invalidate() so this process sees them at once


def defaults() -> dict:
    return {"demo_mode": False, "provider_features": False, "district_only": True}


def flags() -> dict:
    global _cache
    if _cache and time.monotonic() - _cache[0] < _TTL:
        return {**_cache[1], "demo_mode": demo_mode()}
    out = defaults()
    try:
        from app.db import session_factory
        from app.models import AppSetting

        with session_factory()() as db:
            for row in db.query(AppSetting).filter(AppSetting.key.in_(KEYS)).all():
                out[row.key] = row.value == "true"
    except SQLAlchemyError:
        pass
    _cache = (time.monotonic(), out)
    return {**out, "demo_mode": demo_mode()}


def invalidate() -> None:
    global _cache
    _cache = None


def set_demo_mode(on: bool) -> None:
    """For the current request only (set from the browser's cookie)."""
    _demo.set(on)


def demo_mode() -> bool:
    return _demo.get()


def provider_features() -> bool:
    """Live provider updates are shown (always in demo mode, which has demo provider posts)."""
    f = flags()
    return f["demo_mode"] or f["provider_features"]


def district_only() -> bool:
    return flags()["district_only"]
