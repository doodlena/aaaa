"""Lantern two-sided features: pantry staff memberships, live shelf updates, community reports, surplus board."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models._common import check_in, created_at
from app.models.geo import JSONType

SHELF_STATUSES = ("open", "limited", "out", "closed")
STOCK_LEVELS = ("plenty", "some", "low")
REPORT_KINDS = ("was_closed", "wrong_info", "out_of_food", "other")


class ProviderMembership(Base):
    """A user's request (then admin-approved right) to post on behalf of one pantry location."""

    __tablename__ = "provider_memberships"
    __table_args__ = (
        check_in("status", ("pending", "approved", "rejected", "revoked")),
        UniqueConstraint("user_id", "location_id", name="uq_membership"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), index=True)
    role_title: Mapped[str] = mapped_column(String(120))
    note: Mapped[str | None] = mapped_column(Text)  # how an admin can confirm the person (e.g. org phone to call back)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    created_at: Mapped[datetime] = created_at()
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[str | None] = mapped_column(Text)  # shown to the requester (e.g. why access was declined)
    added_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))  # set when approved staff added a colleague


class ShelfUpdate(Base):
    """Live, pantry-posted status + what's on the shelf. Expires automatically; the newest unexpired row is current.

    This is the 'confirmed current inventory' tier: only approved pantry staff (or admins) can post it.
    """

    __tablename__ = "shelf_updates"
    __table_args__ = (check_in("status", SHELF_STATUSES),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), index=True)
    posted_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(16))
    message: Mapped[str | None] = mapped_column(String(280))
    items: Mapped[list] = mapped_column(JSONType, default=list)  # [{"food_type": "fresh_vegetables", "level": "plenty"}]
    posted_at: Mapped[datetime] = created_at()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    retracted: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_assisted: Mapped[bool] = mapped_column(Boolean, default=False)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class CommunityReport(Base):
    """Anonymous visitor report. Stores no personal data (no IP, no account, no location)."""

    __tablename__ = "community_reports"
    __table_args__ = (
        check_in("kind", REPORT_KINDS),
        check_in("status", ("open", "resolved", "dismissed")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    note: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(16), default="open")
    created_at: Mapped[datetime] = created_at()
    provider_response: Mapped[str | None] = mapped_column(String(500))
    resolved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SurplusPost(Base):
    """Pantry-to-pantry surplus board (visible only to approved pantry staff and admins)."""

    __tablename__ = "surplus_posts"
    __table_args__ = (check_in("status", ("open", "claimed", "closed")),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), index=True)
    posted_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(160))
    food_types: Mapped[list] = mapped_column(JSONType, default=list)
    quantity: Mapped[str | None] = mapped_column(String(160))
    pickup_notes: Mapped[str | None] = mapped_column(String(500))
    available_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default="open")
    claimed_by_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id", ondelete="SET NULL"))
    claimed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at()

    location = relationship("Location", foreign_keys=[location_id])
