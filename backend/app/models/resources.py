"""Organizations, locations, services, eligibility, schedules, events, and availability.

Organization-wide facts live on Organization; everything site-specific (hours, services, eligibility) hangs off
Location so that one organization's sites can differ.
"""
from datetime import date, datetime, time

from geoalchemy2 import Geography
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models._common import check_in, created_at, updated_at
from app.models.geo import JSONType
from app.vocab import (
    ELIGIBILITY_TYPES,
    EXCEPTION_KINDS,
    OFFERING_STATUSES,
    OPERATING_STATUSES,
    REVIEW_STATUSES,
    SCHEDULE_KINDS,
    TRISTATE,
    YES_NO_UNKNOWN,
)


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(300))
    public_name: Mapped[str | None] = mapped_column(String(300))
    normalized_name: Mapped[str] = mapped_column(String(300), index=True)
    website: Mapped[str | None] = mapped_column(Text)  # official provider website, never a directory/source URL
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    description_lang: Mapped[str | None] = mapped_column(String(8))
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()

    locations: Mapped[list["Location"]] = relationship(back_populates="organization")


class Location(Base):
    __tablename__ = "locations"
    __table_args__ = (
        check_in("review_status", REVIEW_STATUSES),
        check_in("operating_status", OPERATING_STATUSES),
        check_in("wheelchair_accessible", YES_NO_UNKNOWN),
        Index("ix_locations_public", "published", "review_status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str] = mapped_column(String(300))
    address1: Mapped[str | None] = mapped_column(String(300))
    address2: Mapped[str | None] = mapped_column(String(300))
    city: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str] = mapped_column(String(2), default="VA")
    zip: Mapped[str | None] = mapped_column(String(10), index=True)
    normalized_address: Mapped[str | None] = mapped_column(String(400), index=True)
    jurisdiction_id: Mapped[str | None] = mapped_column(ForeignKey("jurisdictions.id"), index=True)
    geom = mapped_column(Geography("POINT", srid=4326, spatial_index=True), nullable=True)
    geocode_source: Mapped[str | None] = mapped_column(String(64))
    operating_status: Mapped[str] = mapped_column(String(24), default="unknown")
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(200))
    website: Mapped[str | None] = mapped_column(Text)
    registration_url: Mapped[str | None] = mapped_column(Text)
    wheelchair_accessible: Mapped[str] = mapped_column(String(8), default="unknown")
    accessibility_notes: Mapped[str | None] = mapped_column(Text)
    parking_notes: Mapped[str | None] = mapped_column(Text)
    transit_notes: Mapped[str | None] = mapped_column(Text)
    entrance_notes: Mapped[str | None] = mapped_column(Text)
    languages: Mapped[list[str]] = mapped_column(ARRAY(String(8)), default=list)
    notes: Mapped[str | None] = mapped_column(Text)
    notes_lang: Mapped[str | None] = mapped_column(String(8))

    review_status: Mapped[str] = mapped_column(String(16), default="candidate")
    published: Mapped[bool] = mapped_column(Boolean, default=False)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    merged_into_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    first_imported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()

    organization: Mapped[Organization] = relationship(back_populates="locations")
    services: Mapped[list["Service"]] = relationship(back_populates="location", cascade="all, delete-orphan")
    eligibility: Mapped[list["EligibilityRequirement"]] = relationship(back_populates="location", cascade="all, delete-orphan")
    schedules: Mapped[list["Schedule"]] = relationship(back_populates="location", cascade="all, delete-orphan")
    exceptions: Mapped[list["ScheduleException"]] = relationship(back_populates="location", cascade="all, delete-orphan")
    events: Mapped[list["DistributionEvent"]] = relationship(back_populates="location", cascade="all, delete-orphan")


class ServiceCategory(Base):
    """Seeded from app.vocab; kind is food_type | service_type."""

    __tablename__ = "service_categories"

    code: Mapped[str] = mapped_column(String(48), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))
    group_code: Mapped[str] = mapped_column(String(48))


class Service(Base):
    __tablename__ = "services"
    __table_args__ = (
        check_in("offering_status", OFFERING_STATUSES),
        check_in("appointment_required", TRISTATE, "ck_service_appointment"),
        check_in("registration_required", TRISTATE, "ck_service_registration"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), index=True)
    service_type: Mapped[str] = mapped_column(ForeignKey("service_categories.code"))
    description: Mapped[str | None] = mapped_column(Text)
    description_lang: Mapped[str | None] = mapped_column(String(8))
    offering_status: Mapped[str] = mapped_column(String(16), default="unconfirmed")
    frequency: Mapped[str | None] = mapped_column(String(200))
    appointment_required: Mapped[str] = mapped_column(String(16), default="unknown")
    registration_required: Mapped[str] = mapped_column(String(16), default="unknown")
    household_limit: Mapped[str | None] = mapped_column(Text)
    visit_limit: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    source_record_id: Mapped[int | None] = mapped_column(ForeignKey("source_records.id", ondelete="SET NULL"))
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    location: Mapped[Location] = relationship(back_populates="services")
    food_types: Mapped[list["ServiceFoodType"]] = relationship(cascade="all, delete-orphan", back_populates="service")


class ServiceFoodType(Base):
    """Typical offerings: food categories a service normally distributes (per source documentation)."""

    __tablename__ = "service_food_types"

    service_id: Mapped[int] = mapped_column(ForeignKey("services.id", ondelete="CASCADE"), primary_key=True)
    food_type: Mapped[str] = mapped_column(ForeignKey("service_categories.code"), primary_key=True, index=True)
    source_record_id: Mapped[int | None] = mapped_column(ForeignKey("source_records.id", ondelete="SET NULL"))
    service: Mapped[Service] = relationship(back_populates="food_types")


class EligibilityRequirement(Base):
    """One condition. service_id NULL means it applies to every service at the location."""

    __tablename__ = "eligibility_requirements"
    __table_args__ = (
        check_in("requirement_type", ELIGIBILITY_TYPES),
        check_in("status", TRISTATE),
        UniqueConstraint(
            "location_id", "service_id", "requirement_type", name="uq_eligibility_scope", postgresql_nulls_not_distinct=True
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), index=True)
    service_id: Mapped[int | None] = mapped_column(ForeignKey("services.id", ondelete="CASCADE"))
    requirement_type: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="unknown")
    details: Mapped[str | None] = mapped_column(Text)
    values: Mapped[dict] = mapped_column(JSONType, default=dict)  # e.g. {"zips": [...]}, {"min_age": 60}
    source_record_id: Mapped[int | None] = mapped_column(ForeignKey("source_records.id", ondelete="SET NULL"))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    location: Mapped[Location] = relationship(back_populates="eligibility")


class Schedule(Base):
    """Recurring window. weekday 0=Monday..6=Sunday. week_of_month 1-5 or -1 (last) for monthly rules;
    NULL means every week. valid_from/valid_to bound seasonal schedules."""

    __tablename__ = "schedules"
    __table_args__ = (check_in("kind", SCHEDULE_KINDS),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), index=True)
    service_id: Mapped[int | None] = mapped_column(ForeignKey("services.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))
    weekday: Mapped[int] = mapped_column(SmallInteger)
    opens: Mapped[time] = mapped_column(Time)
    closes: Mapped[time] = mapped_column(Time)
    week_of_month: Mapped[int | None] = mapped_column(SmallInteger)
    valid_from: Mapped[date | None] = mapped_column(Date)
    valid_to: Mapped[date | None] = mapped_column(Date)
    appointment_only: Mapped[bool] = mapped_column(Boolean, default=False)
    timezone: Mapped[str] = mapped_column(String(40), default="America/New_York")
    notes: Mapped[str | None] = mapped_column(Text)
    source_record_id: Mapped[int | None] = mapped_column(ForeignKey("source_records.id", ondelete="SET NULL"))

    location: Mapped[Location] = relationship(back_populates="schedules")


class ScheduleException(Base):
    __tablename__ = "schedule_exceptions"
    __table_args__ = (check_in("kind", EXCEPTION_KINDS),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), index=True)
    service_id: Mapped[int | None] = mapped_column(ForeignKey("services.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(16))
    opens: Mapped[time | None] = mapped_column(Time)
    closes: Mapped[time | None] = mapped_column(Time)
    reason: Mapped[str | None] = mapped_column(Text)
    posted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))  # set when posted by pantry staff

    location: Mapped[Location] = relationship(back_populates="exceptions")


class DistributionEvent(Base):
    """One-time or irregular distribution with its own date, offerings, and registration deadline."""

    __tablename__ = "distribution_events"
    __table_args__ = (
        check_in("status", ("scheduled", "cancelled", "completed")),
        check_in("appointment_required", TRISTATE, "ck_event_appointment"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), index=True)
    service_id: Mapped[int | None] = mapped_column(ForeignKey("services.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(300))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    registration_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    appointment_required: Mapped[str] = mapped_column(String(16), default="unknown")
    status: Mapped[str] = mapped_column(String(16), default="scheduled")
    notes: Mapped[str | None] = mapped_column(Text)
    source_record_id: Mapped[int | None] = mapped_column(ForeignKey("source_records.id", ondelete="SET NULL"))
    posted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))  # set when posted by pantry staff
    ai_assisted: Mapped[bool] = mapped_column(Boolean, default=False)

    location: Mapped[Location] = relationship(back_populates="events")
    offerings: Mapped[list["EventOffering"]] = relationship(cascade="all, delete-orphan")


class EventOffering(Base):
    """Scheduled offerings: categories announced for a specific event."""

    __tablename__ = "event_offerings"

    event_id: Mapped[int] = mapped_column(ForeignKey("distribution_events.id", ondelete="CASCADE"), primary_key=True)
    food_type: Mapped[str] = mapped_column(ForeignKey("service_categories.code"), primary_key=True)


class Translation(Base):
    """Translated copy of externally sourced text. The original stays on the source row."""

    __tablename__ = "translations"
    __table_args__ = (UniqueConstraint("entity_type", "entity_id", "field", "lang", name="uq_translation"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[int] = mapped_column(Integer)
    field: Mapped[str] = mapped_column(String(64))
    lang: Mapped[str] = mapped_column(String(8))
    text: Mapped[str] = mapped_column(Text)
    source_hash: Mapped[str] = mapped_column(String(64))  # hash of original text; mismatch => outdated translation
    is_machine: Mapped[bool] = mapped_column(Boolean, default=True)
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False)
    provider: Mapped[str | None] = mapped_column(String(32))
    created_at: Mapped[datetime] = created_at()
