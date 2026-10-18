"""Site-wide switches admins flip at runtime (Admin → Site settings), stored in app_settings.

- demo_mode: the public site adds the fictional demo providers (app/services/demo.py) to the real listings and the admin
  dashboard shows only demo data, for filming and live demos. Real listings are never altered.
- district_only: the public site shows only listings inside Virginia's 8th congressional district (on by default).
- provider_features: live provider updates (today's status, "on the shelf today" filters, the home page feed).
  Off until providers are actually posting; demo mode always turns them on.
"""
import time

from sqlalchemy.exc import SQLAlchemyError

KEYS = ("demo_mode", "provider_features", "district_only")
_cache: tuple[float, dict] | None = None
_TTL = 10.0  # seconds; admin writes call invalidate() so this process sees them at once


def defaults() -> dict:
    return {"demo_mode": False, "provider_features": False, "district_only": True}


def flags() -> dict:
    global _cache
    if _cache and time.monotonic() - _cache[0] < _TTL:
        return _cache[1]
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
    return out


def invalidate() -> None:
    global _cache
    _cache = None


def demo_mode() -> bool:
    return flags()["demo_mode"]


def provider_features() -> bool:
    """Live provider updates are shown (always in demo mode, which has demo provider posts)."""
    f = flags()
    return f["demo_mode"] or f["provider_features"]


def district_only() -> bool:
    return flags()["district_only"]
