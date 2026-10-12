from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models._common import check_in, created_at
from app.models.geo import JSONType


class User(Base):
    __tablename__ = "users"
    __table_args__ = (check_in("role", ("user", "admin")),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(16), default="user")
    preferred_language: Mapped[str] = mapped_column(String(8), default="en")
    # Non-sensitive search preferences only (filters, radius). Never income, status, or precise location.
    preferences: Mapped[dict] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = created_at()


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = created_at()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Favorite(Base):
    __tablename__ = "favorites"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = created_at()


class AppSetting(Base):
    """Runtime settings editable by admins (e.g. AI on/off, model, encrypted API key). Secrets are stored encrypted."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(String(4000))
    is_secret: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = created_at()
