"""Application settings, loaded from environment variables (see .env.example)."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", env_prefix="FOODACCESS_", extra="ignore")

    database_url: str = "postgresql+psycopg://localhost:5433/foodaccess"
    environment: str = "development"  # development | test | production
    # Synthetic fixtures are only ever visible publicly when this is true AND each record is flagged synthetic;
    # the API then labels them. Must be false in production.
    show_synthetic: bool = False

    cors_origins: list[str] = ["http://localhost:5173"]
    cookie_secure: bool = False  # set true behind HTTPS
    session_days: int = 14
    login_attempts_per_15min: int = 10

    # Data / config locations
    config_dir: Path = REPO_ROOT / "config"
    data_dir: Path = REPO_ROOT / "data"
    reports_dir: Path = REPO_ROOT / "reports"

    # Freshness (days) after which a verified listing is labelled stale and re-queued.
    verification_fresh_days: int = 90

    # Geocoding provider chain: census (US Census Bureau, free, no key), nominatim (respect usage policy), zip (local table)
    geocoders: list[str] = ["zip", "census", "nominatim"]
    nominatim_url: str = "https://nominatim.openstreetmap.org"
    http_user_agent: str = "Lantern/0.3 (+https://github.com/doodlena/aaaa; contact via repository issues)"

    # Optional machine translation: none | libretranslate | argos
    translation_provider: str = "none"
    libretranslate_url: str = "http://localhost:5000"

    max_search_radius_km: float = 80.0

    # Unverified-but-sourced listings. "permitted": show candidates backed by a source that allows republication with
    # attribution, labelled "source_reported". "internal_preview": also sources that need permission — local review
    # only, refused when environment=production. "off": verified listings only.
    source_reported: str = "permitted"

    # Branding (single place to rename the app; the UI reads it from /api/meta/features)
    app_name: str = "Lantern"

    # Community reports: this many open "was closed"/"wrong info" reports in 7 days send a verified listing to review
    report_review_threshold: int = 3

    # Optional Claude features (see app/services/ai.py). Credentials come from ANTHROPIC_API_KEY (never stored here).
    ai_enabled: bool = False
    ai_model: str = "claude-sonnet-5-5"
    secret_key: str | None = None  # Fernet key for encrypting stored secrets (required in production)
    ai_public_search_per_hour: int = 30

    # Optional sign-in with an OpenID Connect provider (see app/auth/oauth.py). Off unless issuer, id and secret are set.
    oidc_issuer: str | None = None  # e.g. https://accounts.google.com
    oidc_client_id: str | None = None
    oidc_client_secret: str | None = None
    oidc_provider_name: str = ""  # shown on the button, e.g. "Google"; a generic label is used when empty
    oidc_redirect_url: str | None = None  # defaults to <first CORS origin>/auth/callback; must be registered with the provider


@lru_cache
def get_settings() -> Settings:
    return Settings()
