"""Data-quality metrics (overall and per jurisdiction). All numbers are computed from the database; nothing estimated."""
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.models import (
    ChangeProposal,
    DuplicateCandidate,
    IngestionRun,
    Location,
    Organization,
    Service,
    SourceRecord,
    VerificationRecord,
)


def _pct(n: int, d: int) -> float | None:
    return round(100 * n / d, 1) if d else None


def quality_report(db: Session, jurisdiction: str | None = None, include_synthetic: bool = False) -> dict:
    conds = [Location.merged_into_id.is_(None)]
    if jurisdiction:
        conds.append(Location.jurisdiction_id == jurisdiction)
    if not include_synthetic:
        conds.append(Location.is_synthetic.is_(False))
    locs = db.scalars(select(Location).where(*conds).options(
        selectinload(Location.organization), selectinload(Location.services).selectinload(Service.food_types),
        selectinload(Location.schedules), selectinload(Location.eligibility), selectinload(Location.events))).all()
    ids = [loc.id for loc in locs]
    n = len(locs)
    by_status: dict[str, int] = {}
    for loc in locs:
        by_status[loc.review_status] = by_status.get(loc.review_status, 0) + 1
    published = [loc for loc in locs if loc.published]
    verified_ids = set(db.scalars(select(VerificationRecord.location_id).where(VerificationRecord.action == "verify",
                                                                               VerificationRecord.location_id.in_(ids))).all())
    sourced_ids = set(db.scalars(select(SourceRecord.location_id).where(SourceRecord.location_id.in_(ids))).all())
    cutoff = datetime.now(UTC) - timedelta(days=get_settings().verification_fresh_days)

    def count(pred):
        return sum(1 for loc in locs if pred(loc))

    rec_conds = [SourceRecord.is_synthetic.is_(False)] if not include_synthetic else []
    per_source = dict(db.execute(select(SourceRecord.source_id, func.count()).where(*rec_conds).group_by(SourceRecord.source_id)).all())
    rec_status = dict(db.execute(select(SourceRecord.status, func.count()).where(*rec_conds).group_by(SourceRecord.status)).all())
    runs = db.execute(select(IngestionRun.status, func.count()).group_by(IngestionRun.status)).all()
    metrics = {
        "locations_total": n,
        "by_review_status": by_status,
        "published": len(published),
        "published_without_verification_record": sum(1 for loc in published if loc.id not in verified_ids),
        "published_without_source": sum(1 for loc in published if loc.id not in sourced_ids),
        "valid_address_pct": _pct(count(lambda l: bool(l.address1 and l.city and l.zip)), n),
        "valid_coordinates_pct": _pct(count(lambda l: l.geom is not None), n),
        "with_service_types_pct": _pct(count(lambda l: bool(l.services)), n),
        "with_food_types_pct": _pct(count(lambda l: any(s.food_types for s in l.services)), n),
        "with_distribution_schedule_pct": _pct(count(lambda l: any(s.kind == "distribution" for s in l.schedules) or bool(l.events)), n),
        "with_documented_eligibility_pct": _pct(count(lambda l: any(e.status != "unknown" for e in l.eligibility)), n),
        "with_official_website_pct": _pct(count(lambda l: bool(l.organization.website or l.website)), n),
        "with_source_attribution_pct": _pct(count(lambda l: l.id in sourced_ids), n),
        "with_verification_timestamp_pct": _pct(count(lambda l: l.last_verified_at is not None), n),
        "stale": count(lambda l: l.review_status == "stale" or (l.review_status == "verified" and l.last_verified_at and l.last_verified_at < cutoff)),
        "pending_conflicts": db.scalar(select(func.count()).select_from(ChangeProposal).where(ChangeProposal.status == "pending",
                                                                                                ChangeProposal.location_id.in_(ids))) or 0,
        "locations_with_conflicting_source_values": _conflicting(db, ids),
        "pending_duplicates": db.scalar(select(func.count()).select_from(DuplicateCandidate).where(DuplicateCandidate.status == "pending")) or 0,
        "source_records_by_source": per_source,
        "source_records_by_status": rec_status,
        "ingestion_runs_by_status": dict(runs),
        "organizations": db.scalar(select(func.count()).select_from(Organization).where(*( [Organization.is_synthetic.is_(False)] if not include_synthetic else []))),
    }
    return {"jurisdiction": jurisdiction, "generated_at": datetime.now(UTC).isoformat(), "includes_synthetic": include_synthetic,
            "metrics": metrics}


def _conflicting(db: Session, ids: list[int]) -> int:
    """Locations where two source records report different values for the same field (field-level provenance)."""
    from app.models import FieldProvenance

    rows = db.execute(select(FieldProvenance.location_id, FieldProvenance.field, FieldProvenance.value)
                      .where(FieldProvenance.location_id.in_(ids))).all()
    seen: dict[tuple, set] = {}
    for lid, f, v in rows:
        seen.setdefault((lid, f), set()).add(str(v).strip().lower())
    return len({lid for (lid, _f), vals in seen.items() if len(vals) > 1})
