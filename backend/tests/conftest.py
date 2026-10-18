"""Tests run against a real PostgreSQL+PostGIS test database (FOODACCESS_TEST_DATABASE_URL), migrated from scratch
with Alembic, so migrations, constraints, and spatial SQL are exercised. No test touches the network."""
import os
from pathlib import Path

import pytest

TEST_DB = os.environ.get("FOODACCESS_TEST_DATABASE_URL", "postgresql+psycopg://localhost:5433/foodaccess_test")
os.environ["FOODACCESS_DATABASE_URL"] = TEST_DB
os.environ["FOODACCESS_ENVIRONMENT"] = "test"
os.environ["FOODACCESS_SHOW_SYNTHETIC"] = "true"
os.environ["FOODACCESS_GEOCODERS"] = '["zip"]'
os.environ["FOODACCESS_SOURCE_REPORTED"] = "permitted"  # never inherit a developer's local preview setting

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.auth.security import hash_password, login_limiter  # noqa: E402
from app.config import REPO_ROOT, get_settings  # noqa: E402
from app.db import get_engine, session_factory  # noqa: E402
from app.ingestion.base import Fetcher, load_source_configs  # noqa: E402
from app.models import User  # noqa: E402
from app.services.registry import sync_jurisdictions  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"
KEEP = {"service_categories", "spatial_ref_sys", "alembic_version"}
ADMIN_PW = "admin-password-123"
USER_PW = "user-password-123"


@pytest.fixture(scope="session", autouse=True)
def migrated_db():
    eng = get_engine()
    with eng.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    cfg = Config(str(REPO_ROOT / "backend" / "alembic.ini"))
    cfg.set_main_option("script_location", str(REPO_ROOT / "backend" / "migrations"))
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def clean(migrated_db, tmp_path, monkeypatch):
    eng = get_engine()
    with eng.begin() as c:
        tables = [r[0] for r in c.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public'"))]
        c.execute(text("TRUNCATE " + ", ".join(f'"{t}"' for t in tables if t not in KEEP) + " RESTART IDENTITY CASCADE"))
    monkeypatch.setattr(get_settings(), "reports_dir", tmp_path / "reports")
    login_limiter.reset()
    from app.api import provider, public

    for lim in (public.report_limiter, public.ai_search_limiter, public.enrich_limiter, provider.ai_limiter, provider.claim_limiter,
                provider.staff_limiter):
        lim.reset()
    with session_factory()() as db:
        sync_jurisdictions(db)
        # Fixtures sit in several jurisdictions; tests run with every jurisdiction switched on (the public-area switch
        # itself is covered by test_paused_jurisdiction_is_hidden_from_public_search).
        from sqlalchemy import update

        from app.models import Jurisdiction

        db.execute(update(Jurisdiction).values(status="expansion"))
        db.commit()
    # Same for the VA-08 area switch (fixtures lie outside it); test_site_settings.py covers it and demo mode.
    from app.services import demo, site_flags

    monkeypatch.setattr(site_flags, "defaults", lambda: {"demo_mode": False, "provider_features": True, "district_only": False})
    site_flags.invalidate()
    demo.reset_live_cache()
    yield
    site_flags.invalidate()


@pytest.fixture
def db():
    with session_factory()() as s:
        yield s


@pytest.fixture
def client():
    from app.main import app

    return TestClient(app)


def make_user(db, email, pw, role="user"):
    u = User(email=email, password_hash=hash_password(pw), role=role, preferences={})
    db.add(u)
    db.commit()
    return u


def login(client, email, pw):
    r = client.post("/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    client.headers["X-CSRF-Token"] = client.cookies.get("nfa_csrf")
    return r.json()


@pytest.fixture
def admin(db):
    return make_user(db, "admin@example.org", ADMIN_PW, "admin")


@pytest.fixture
def admin_client(client, admin):
    login(client, "admin@example.org", ADMIN_PW)
    return client


@pytest.fixture
def synthetic_cfg():
    return load_source_configs()["synthetic-fixtures"]


@pytest.fixture
def imported(db, synthetic_cfg):
    from app.ingestion.pipeline import run_source

    return run_source(db, synthetic_cfg, Fetcher(offline=True))


@pytest.fixture
def published(db, imported, admin):
    """All synthetic candidates verified + published by an identified admin."""
    from sqlalchemy import select

    from app.ingestion.verification.workflow import apply_action
    from app.models import Location

    for loc in db.scalars(select(Location)).all():
        apply_action(db, loc, admin, "verify", "phone", "test")
        apply_action(db, loc, admin, "publish")
    return db.scalars(select(Location).order_by(Location.id)).all()
