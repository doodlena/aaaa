"""Built-in automatic refresh: once a day (at FOODACCESS_REFRESH_HOUR local time) re-run every enabled source in the
active scope, then label listings past the freshness threshold. Unchanged records cost nothing (hash check, HTTP cache,
AI cache). A Postgres advisory lock guarantees only one API worker runs it. Disable with FOODACCESS_AUTO_REFRESH=false.
"""
import logging
import threading
import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import text

from app.config import get_settings
from app.services.schedule import TZ

log = logging.getLogger("scheduler")
LOCK_ID = 7_200_123
_state = {"last_run": None, "last_result": None, "running": False, "next_run": None}


def _next_run(now: datetime) -> datetime:
    local = now.astimezone(TZ)
    nxt = local.replace(hour=get_settings().refresh_hour, minute=0, second=0, microsecond=0)
    if nxt <= local:
        nxt += timedelta(days=1)
    return nxt.astimezone(UTC)


def refresh_now() -> dict:
    """Run one refresh cycle (also used by the admin 'Refresh now' button and tests)."""
    from app.db import session_factory
    from app.ingestion.base import Fetcher
    from app.ingestion.pipeline import run_all
    from app.ingestion.verification.workflow import mark_stale
    from app.services.registry import active_scope

    with session_factory()() as db:
        got = db.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": LOCK_ID}).scalar()
        if not got:
            return {"skipped": "another refresh is running"}
        _state["running"] = True
        try:
            runs = run_all(db, active_scope(), fetcher=Fetcher())
            stale = mark_stale(db)
            result = {"sources": len(runs), "inserted": sum(r.counts.get("inserted", 0) for r in runs),
                      "updated": sum(r.counts.get("updated", 0) for r in runs), "failed": [r.source_id for r in runs if r.status == "failed"],
                      "marked_stale": stale}
        finally:
            db.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": LOCK_ID})
            db.commit()
            _state["running"] = False
    _state["last_run"], _state["last_result"] = datetime.now(UTC).isoformat(), result
    log.info("auto refresh finished: %s", result)
    return result


def _loop(stop: threading.Event) -> None:
    while not stop.is_set():
        nxt = _next_run(datetime.now(UTC))
        _state["next_run"] = nxt.isoformat()
        if stop.wait(max(1.0, (nxt - datetime.now(UTC)).total_seconds())):
            return
        try:
            refresh_now()
        except Exception:  # never kill the API because a refresh failed; the next cycle retries
            log.exception("auto refresh failed")
            time.sleep(60)


_stop = threading.Event()


def start() -> None:
    s = get_settings()
    if not s.auto_refresh or s.environment == "test":
        return
    threading.Thread(target=_loop, args=(_stop,), name="lantern-auto-refresh", daemon=True).start()


def stop() -> None:
    _stop.set()


def status() -> dict:
    s = get_settings()
    return {"enabled": bool(s.auto_refresh), "hour_local": s.refresh_hour, **_state}
