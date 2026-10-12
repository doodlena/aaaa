"""Pydantic request/response models for the REST API."""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.vocab import ELIGIBILITY_TYPES, OFFERING_STATUSES, OPERATING_STATUSES, TRISTATE, VERIFICATION_METHODS, YES_NO_UNKNOWN

Lang = Literal["en", "es", "zh", "vi", "ko"]  # keep in sync with frontend/src/i18n/index.ts


class Address(BaseModel):
    address1: str | None
    address2: str | None
    city: str | None
    state: str | None
    zip: str | None


class NextWindow(BaseModel):
    date: str
    opens: str | None
    closes: str | None
    kind: str
    appointment_only: bool
    title: str | None = None
    event_id: int | None = None


class ResourceSummary(BaseModel):
    id: int
    name: str
    organization_name: str
    address: Address
    lat: float | None
    lon: float | None
    distance_km: float | None
    jurisdiction_id: str | None
    phone: str | None
    website: str | None
    verification_label: str
    last_verified_at: str | None
    operating_status: str
    food_types: list[str]
    food_groups: list[str]
    service_types: list[str]
    has_distribution_schedule: bool
    next_distribution: NextWindow | None
    distributing_on_date: bool | None
    eligibility: dict[str, str]
    wheelchair_accessible: str
    languages: list[str]
    warnings: list[str]
    is_synthetic: bool
    match_reasons: list[dict]
    unconfirmed: list[str] | None = None
    live: dict | None = None
    open_reports: int = 0


class Coverage(BaseModel):
    covered_jurisdictions: list[str]
    complete: bool | None


class SearchResponse(BaseModel):
    items: list[ResourceSummary]
    total: int
    page: int
    page_size: int
    uncertain: list[ResourceSummary]
    uncertain_total: int
    truncated: bool
    coverage: Coverage


class GeocodeResult(BaseModel):
    label: str
    lat: float
    lon: float
    source: str
    precision: str


class GeocodeResponse(BaseModel):
    results: list[GeocodeResult]
    unavailable_providers: list[str]


# --- accounts -------------------------------------------------------------------------------------------------

class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=200)
    preferred_language: Lang = "en"


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)  # lookup only; format is validated at registration
    password: str = Field(max_length=200)


class UserOut(BaseModel):
    id: int
    email: str
    role: str
    preferred_language: str
    preferences: dict


class MeOut(BaseModel):
    user: UserOut | None


ALLOWED_PREF_KEYS = {"radius_km", "food_groups", "service_groups", "eligibility", "sort", "wheelchair", "language_filter"}


class PreferencesIn(BaseModel):
    preferred_language: Lang | None = None
    preferences: dict | None = None

    @field_validator("preferences")
    @classmethod
    def _only_non_sensitive(cls, v):
        if v is None:
            return v
        bad = set(v) - ALLOWED_PREF_KEYS
        if bad:
            raise ValueError(f"unsupported preference keys: {sorted(bad)}")
        return v


class DeleteAccountIn(BaseModel):
    password: str = Field(max_length=200)


# --- admin ----------------------------------------------------------------------------------------------------

class ActionIn(BaseModel):
    action: Literal["verify", "publish", "unpublish", "reject", "flag", "close_temporary", "close_permanent", "reopen"]
    method: Literal[VERIFICATION_METHODS + ("none",)] = "none"  # type: ignore[valid-type]
    notes: str | None = Field(default=None, max_length=4000)


class DecisionIn(BaseModel):
    decision: Literal["accept", "reject", "merge", "distinct"]
    notes: str | None = Field(default=None, max_length=4000)


class ScheduleIn(BaseModel):
    kind: Literal["distribution", "operating_hours"] = "distribution"
    weekday: int = Field(ge=0, le=6)
    opens: str = Field(pattern=r"^\d{2}:\d{2}$")
    closes: str = Field(pattern=r"^\d{2}:\d{2}$")
    week_of_month: int | None = Field(default=None, ge=-1, le=5)
    valid_from: date | None = None
    valid_to: date | None = None
    appointment_only: bool = False
    notes: str | None = None
    service_index: int | None = None  # index into `services` of the same payload


class EligibilityIn(BaseModel):
    requirement_type: Literal[ELIGIBILITY_TYPES]  # type: ignore[valid-type]
    status: Literal[TRISTATE]  # type: ignore[valid-type]
    details: str | None = None
    values: dict = Field(default_factory=dict)
    service_index: int | None = None


class ServiceIn(BaseModel):
    service_type: str
    description: str | None = None
    offering_status: Literal[OFFERING_STATUSES] = "unconfirmed"  # type: ignore[valid-type]
    frequency: str | None = None
    appointment_required: Literal[TRISTATE] = "unknown"  # type: ignore[valid-type]
    registration_required: Literal[TRISTATE] = "unknown"  # type: ignore[valid-type]
    household_limit: str | None = None
    visit_limit: str | None = None
    notes: str | None = None
    food_types: list[str] = Field(default_factory=list)


class ResourceEditIn(BaseModel):
    """Partial edit. Nested lists (services/schedules/eligibility), when present, replace the existing set."""

    name: str | None = None
    organization_name: str | None = None
    organization_website: str | None = None
    address1: str | None = None
    address2: str | None = None
    city: str | None = None
    zip: str | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    jurisdiction_id: str | None = None
    phone: str | None = None
    email: str | None = None
    website: str | None = None
    registration_url: str | None = None
    operating_status: Literal[OPERATING_STATUSES] | None = None  # type: ignore[valid-type]
    wheelchair_accessible: Literal[YES_NO_UNKNOWN] | None = None  # type: ignore[valid-type]
    accessibility_notes: str | None = None
    parking_notes: str | None = None
    transit_notes: str | None = None
    entrance_notes: str | None = None
    languages: list[str] | None = None
    notes: str | None = None
    services: list[ServiceIn] | None = None
    schedules: list[ScheduleIn] | None = None
    eligibility: list[EligibilityIn] | None = None
    edit_notes: str | None = Field(default=None, max_length=4000)

    @field_validator("website", "registration_url", "organization_website")
    @classmethod
    def _http_only(cls, v):
        if v in (None, ""):
            return None
        from app.ingestion.normalization.text import normalize_url

        u = normalize_url(v)
        if not u:
            raise ValueError("must be an http(s) URL")
        return u


# --- Lantern: reports, pantry portal, AI -------------------------------------------------------------------------

class ReportIn(BaseModel):
    kind: Literal["was_closed", "wrong_info", "out_of_food", "other"]
    note: str | None = Field(default=None, max_length=500)


class ShelfItemIn(BaseModel):
    food_type: str
    level: Literal["plenty", "some", "low"]

    @field_validator("food_type")
    @classmethod
    def _ft(cls, v):
        from app.vocab import FOOD_TYPES

        if v not in FOOD_TYPES:
            raise ValueError("unknown food type")
        return v


class ShelfUpdateIn(BaseModel):
    status: Literal["open", "limited", "out", "closed"]
    message: str | None = Field(default=None, max_length=280)
    items: list[ShelfItemIn] = Field(default_factory=list, max_length=30)
    expires_at: datetime | None = None  # default: end of today (local); max 3 days ahead
    ai_assisted: bool = False


class ClaimIn(BaseModel):
    location_id: int
    role_title: str = Field(min_length=2, max_length=120)
    note: str | None = Field(default=None, max_length=1000)


class EventIn(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    starts_at: datetime
    ends_at: datetime | None = None
    registration_deadline: datetime | None = None
    appointment_required: Literal[TRISTATE] = "unknown"  # type: ignore[valid-type]
    notes: str | None = Field(default=None, max_length=1000)
    offerings: list[str] = Field(default_factory=list)
    ai_assisted: bool = False


class ClosureIn(BaseModel):
    date: date
    reason: str | None = Field(default=None, max_length=300)


class ChangeRequestIn(BaseModel):
    """Pantry-proposed corrections. They enter the review queue as change proposals (origin=provider)."""

    phone: str | None = None
    website: str | None = None
    registration_url: str | None = None
    notes: str | None = Field(default=None, max_length=2000)
    schedules: list[ScheduleIn] | None = None
    eligibility: list[EligibilityIn] | None = None
    message_to_reviewer: str | None = Field(default=None, max_length=1000)

    @field_validator("website", "registration_url")
    @classmethod
    def _http(cls, v):
        if v in (None, ""):
            return None
        from app.ingestion.normalization.text import normalize_url

        u = normalize_url(v)
        if not u:
            raise ValueError("must be an http(s) URL")
        return u


class ReportResponseIn(BaseModel):
    response: str | None = Field(default=None, max_length=500)
    resolve: bool = True


class SurplusIn(BaseModel):
    location_id: int
    title: str = Field(min_length=3, max_length=160)
    food_types: list[str] = Field(default_factory=list)
    quantity: str | None = Field(default=None, max_length=160)
    pickup_notes: str | None = Field(default=None, max_length=500)
    available_until: datetime


class SurplusClaimIn(BaseModel):
    location_id: int


class AnnouncementIn(BaseModel):
    text: str = Field(min_length=5, max_length=4000)


class AISearchIn(BaseModel):
    q: str = Field(min_length=3, max_length=300)
    lang: Lang = "en"


class DecisionSimpleIn(BaseModel):
    decision: Literal["approve", "reject", "revoke", "resolve", "dismiss"]
    notes: str | None = Field(default=None, max_length=2000)


class AIKeyIn(BaseModel):
    api_key: str = Field(min_length=20, max_length=300)

    @field_validator("api_key")
    @classmethod
    def _shape(cls, v):
        v = v.strip()
        if not v.startswith("sk-ant-") or any(c.isspace() for c in v):
            raise ValueError("This does not look like an Anthropic API key (it should start with sk-ant-)")
        return v


class AISettingsIn(BaseModel):
    enabled: bool | None = None
    model: Literal["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"] | None = None
