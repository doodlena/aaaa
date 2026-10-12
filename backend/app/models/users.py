from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

from app.db import Base
from app.models._common import check_in, created_at
from app.models.geo import JSONType


class EncryptedJSON(TypeDecorator):
    """A JSON value encrypted at rest (app/services/secrets.py). The database holds {"_enc": "<token>"}: someone reading
    the table, a backup or a dump cannot see what a person searched for or saved. Assign a new value to change it
    (in-place mutation is not tracked)."""

    impl = JSONType
    cache_ok = True

    def __init__(self, empty=dict):
        super().__init__()
        self.empty = empty

    def process_bind_param(self, value, dialect):
        from app.services.secrets import seal

        return seal(self.empty() if value is None else value)

    def process_result_value(self, value, dialect):
        from app.services.secrets import unseal

        out = unseal(value, None)
        return self.empty() if out is None else out


class User(Base):
    __tablename__ = "users"
    __table_args__ = (check_in("role", ("user", "admin")),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(16), default="user")
    preferred_language: Mapped[str] = mapped_column(String(8), default="en")
    # Search preferences (filters, radius). Never income, status, or precise location. Encrypted at rest: a filter such
    # as "no ID required" says something about the person.
    preferences: Mapped[dict] = mapped_column(EncryptedJSON(dict), default=dict)
    # Saved places, newest last: [{"id": <location id>, "at": "<ISO time>"}]. Encrypted at rest for the same reason, so
    # there is deliberately no table linking accounts to listings.
    saved_places: Mapped[list] = mapped_column(EncryptedJSON(list), default=list, server_default="[]")
    created_at: Mapped[datetime] = created_at()


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = created_at()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class OAuthIdentity(Base):
    """A sign-in identity at an OpenID Connect provider, linked to one account. Only issuer + subject are stored."""

    __tablename__ = "oauth_identities"
    __table_args__ = (UniqueConstraint("issuer", "subject"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    issuer: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = created_at()


class AppSetting(Base):
    """Runtime settings editable by admins (e.g. AI on/off, model, encrypted API key). Secrets are stored encrypted."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(String(4000))
    is_secret: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = created_at()


class AIUsage(Base):
    """One row per Claude API call: feature, model, tokens, estimated cost (for the monthly budget cap)."""

    __tablename__ = "ai_usage"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    at: Mapped[datetime] = created_at()
    feature: Mapped[str] = mapped_column(String(32), index=True)
    model: Mapped[str] = mapped_column(String(48))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    web_searches: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    cached: Mapped[bool] = mapped_column(Boolean, default=False)


class AICache(Base):
    """Cached AI outputs keyed by a hash of (feature, model, input). Identical requests are never paid for twice;
    unchanged web pages are never re-extracted."""

    __tablename__ = "ai_cache"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    feature: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(48))
    output: Mapped[dict] = mapped_column(JSONType)
    created_at: Mapped[datetime] = created_at()
