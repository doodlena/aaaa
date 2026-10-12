"""Jurisdictions, school divisions, and Title I research tables.

School divisions and local governments are modelled separately: e.g. Fairfax County Public Schools also serves
the City of Fairfax, so the relationship is many-to-many.
"""
from datetime import date, datetime

from geoalchemy2 import Geometry
from sqlalchemy import JSON, Column, Date, DateTime, Float, ForeignKey, Integer, String, Table, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models._common import check_in, created_at, updated_at
from app.vocab import JURISDICTION_STATUSES

JSONType = JSON().with_variant(JSONB, "postgresql")

division_jurisdictions = Table(
    "division_jurisdictions",
    Base.metadata,
    Column("division_id", ForeignKey("school_divisions.id", ondelete="CASCADE"), primary_key=True),
    Column("jurisdiction_id", ForeignKey("jurisdictions.id", ondelete="CASCADE"), primary_key=True),
)


class Jurisdiction(Base):
    __tablename__ = "jurisdictions"
    __table_args__ = (check_in("status", JURISDICTION_STATUSES),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # slug, e.g. "arlington-county"
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(32))  # county | city | town
    state_fips: Mapped[str] = mapped_column(String(2), default="51")
    county_fips: Mapped[str | None] = mapped_column(String(3))
    status: Mapped[str] = mapped_column(String(16), default="planned")
    boundary = mapped_column(Geometry("MULTIPOLYGON", srid=4326, spatial_index=True), nullable=True)
    boundary_source: Mapped[str | None] = mapped_column(Text)
    config: Mapped[dict] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = updated_at()

    divisions: Mapped[list["SchoolDivision"]] = relationship(secondary=division_jurisdictions, back_populates="jurisdictions")


class SchoolDivision(Base):
    __tablename__ = "school_divisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # VDOE division number
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    jurisdictions: Mapped[list[Jurisdiction]] = relationship(secondary=division_jurisdictions, back_populates="divisions")


class TitleIDivisionMetric(Base):
    """One row per division per school year per analysis run (latest retained via unique key)."""

    __tablename__ = "title_i_division_metrics"
    __table_args__ = (UniqueConstraint("division_id", "school_year", name="uq_title_i_division_year"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    division_id: Mapped[int] = mapped_column(ForeignKey("school_divisions.id", ondelete="CASCADE"))
    school_year: Mapped[str] = mapped_column(String(9))
    total_schools: Mapped[int | None] = mapped_column(Integer)
    title_i_schools: Mapped[int | None] = mapped_column(Integer)
    title_i_share: Mapped[float | None] = mapped_column(Float)
    directory_school_year: Mapped[str | None] = mapped_column(String(32))
    indicators: Mapped[dict] = mapped_column(JSONType, default=dict)
    sources: Mapped[list] = mapped_column(JSONType, default=list)
    warnings: Mapped[list] = mapped_column(JSONType, default=list)
    retrieved_on: Mapped[date] = mapped_column(Date)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class CoverageArea(Base):
    """A named boundary (e.g. a congressional district) used for filtering and coverage reports. Unlike jurisdictions,
    coverage areas may overlap localities, so they never drive a listing's jurisdiction assignment."""

    __tablename__ = "coverage_areas"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(32))
    boundary = mapped_column(Geometry("MULTIPOLYGON", srid=4326, spatial_index=True), nullable=False)
    source: Mapped[str | None] = mapped_column(Text)
    config: Mapped[dict] = mapped_column(JSONType, default=dict)
