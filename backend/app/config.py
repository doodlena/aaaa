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
    http_user_agent: str = "NoVAFoodAccess/0.1 (+https://github.com/; contact via repository issues)"

    # Optional machine translation: none | libretranslate | argos
    translation_provider: str = "none"
    libretranslate_url: str = "http://localhost:5000"

    max_search_radius_km: float = 80.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
