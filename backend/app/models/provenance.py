"""Sources, ingestion runs, raw source records, field provenance, change proposals, duplicates, verification, audit."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models._common import check_in, created_at
from app.models.geo import JSONType
from app.vocab import VERIFICATION_ACTIONS, VERIFICATION_METHODS


class Source(Base):
    """Mirror of config/sources/*.yaml plus run-time state (last success)."""

    __tablename__ = "sources"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(300))
    url: Mapped[str] = mapped_column(Text)
    owner: Mapped[str | None] = mapped_column(String(300))
    adapter: Mapped[str] = mapped_column(String(64))
    jurisdictions: Mapped[list] = mapped_column(JSONType, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    config: Mapped[dict] = mapped_column(JSONType, default=dict)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)


class IngestionRun(Base):
    __tablename__ = "ingestion_runs"
    __table_args__ = (check_in("status", ("running", "succeeded", "partial", "failed")),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id"), index=True)
    started_at: Mapped[datetime] = created_at()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default="running")
    counts: Mapped[dict] = mapped_column(JSONType, default=dict)
    errors: Mapped[list] = mapped_column(JSONType, default=list)
    report_path: Mapped[str | None] = mapped_column(Text)


class SourceRecord(Base):
    """A record as seen in a source. (source_id, external_id) is the idempotency key."""

    __tablename__ = "source_records"
    __table_args__ = (
        UniqueConstraint("source_id", "external_id", name="uq_source_external"),
        check_in("status", ("new", "linked", "duplicate_candidate", "invalid", "rejected", "gone")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("sources.id"), index=True)
    external_id: Mapped[str] = mapped_column(String(300))
    source_url: Mapped[str | None] = mapped_column(Text)  # page/listing the record came from
    raw: Mapped[dict | None] = mapped_column(JSONType)  # stored only when the source permits
    raw_hash: Mapped[str] = mapped_column(String(64))
    normalized: Mapped[dict] = mapped_column(JSONType, default=dict)
    validation: Mapped[list] = mapped_column(JSONType, default=list)
    status: Mapped[str] = mapped_column(String(24), default="new")
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id", ondelete="SET NULL"), index=True)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    first_seen_at: Mapped[datetime] = created_at()
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_run_id: Mapped[int | None] = mapped_column(ForeignKey("ingestion_runs.id", ondelete="SET NULL"))

    source: Mapped[Source] = relationship()


class FieldProvenance(Base):
    """Which source supplied each location field value, and when."""

    __tablename__ = "field_provenance"
    __table_args__ = (UniqueConstraint("location_id", "field", "source_record_id", name="uq_field_prov"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), index=True)
    field: Mapped[str] = mapped_column(String(64))
    value: Mapped[dict | list | str | None] = mapped_column(JSONType)
    source_record_id: Mapped[int | None] = mapped_column(ForeignKey("source_records.id", ondelete="SET NULL"))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ChangeProposal(Base):
    """A newly imported value that conflicts with a verified value. Never auto-applied."""

    __tablename__ = "change_proposals"
    __table_args__ = (
        check_in("status", ("pending", "accepted", "rejected", "superseded")),
        check_in("origin", ("import", "provider", "ai")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), index=True)
    field: Mapped[str] = mapped_column(String(64))
    current_value: Mapped[dict | list | str | None] = mapped_column(JSONType)
    proposed_value: Mapped[dict | list | str | None] = mapped_column(JSONType)
    source_record_id: Mapped[int | None] = mapped_column(ForeignKey("source_records.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    origin: Mapped[str] = mapped_column(String(16), default="import", server_default="import")
    submitted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = created_at()
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DuplicateCandidate(Base):
    """Possible match between an incoming source record and an existing location (or two locations)."""

    __tablename__ = "duplicate_candidates"
    __table_args__ = (
        check_in("status", ("pending", "merged", "distinct")),
        UniqueConstraint("source_record_id", "location_id", name="uq_dup_pair"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_record_id: Mapped[int | None] = mapped_column(ForeignKey("source_records.id", ondelete="CASCADE"))
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"))
    other_location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"))
    score: Mapped[float] = mapped_column(Float)
    reasons: Mapped[list] = mapped_column(JSONType, default=list)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    created_at: Mapped[datetime] = created_at()
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class VerificationRecord(Base):
    """Attributable reviewer action. reviewer_id is NOT NULL: there are no anonymous/automatic verifications."""

    __tablename__ = "verification_records"
    __table_args__ = (
        check_in("action", VERIFICATION_ACTIONS),
        check_in("method", VERIFICATION_METHODS + ("none",), "ck_verification_method"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), index=True)
    reviewer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(24))
    method: Mapped[str] = mapped_column(String(24), default="none")
    notes: Mapped[str | None] = mapped_column(Text)
    snapshot: Mapped[dict] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = created_at()


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    actor_label: Mapped[str] = mapped_column(String(64))  # "user:3" or "ingestion:<source>"
    entity_type: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[int] = mapped_column(Integer, index=True)
    action: Mapped[str] = mapped_column(String(48))
    before: Mapped[dict | None] = mapped_column(JSONType)
    after: Mapped[dict | None] = mapped_column(JSONType)
    at: Mapped[datetime] = created_at()
