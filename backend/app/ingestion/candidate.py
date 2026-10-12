"""The normalized shape every adapter produces. Adapters fill only what their source states."""
from pydantic import BaseModel, Field, field_validator

from app.vocab import ELIGIBILITY_TYPES, FOOD_TYPES, SERVICE_TYPES, TRISTATE


class CandidateSchedule(BaseModel):
    kind: str = "distribution"  # distribution | operating_hours
    weekday: int = Field(ge=0, le=6)
    opens: str
    closes: str
    week_of_month: int | None = None
    appointment_only: bool = False
    notes: str | None = None


class CandidateEligibility(BaseModel):
    requirement_type: str
    status: str = "unknown"
    details: str | None = None
    values: dict = Field(default_factory=dict)

    @field_validator("requirement_type")
    @classmethod
    def _rt(cls, v):
        if v not in ELIGIBILITY_TYPES:
            raise ValueError(f"unknown eligibility type {v}")
        return v

    @field_validator("status")
    @classmethod
    def _st(cls, v):
        if v not in TRISTATE:
            raise ValueError(f"invalid status {v}")
        return v


class CandidateService(BaseModel):
    service_type: str
    description: str | None = None
    food_types: list[str] = Field(default_factory=list)
    offering_status: str = "unconfirmed"
    frequency: str | None = None
    appointment_required: str = "unknown"
    registration_required: str = "unknown"
    schedules: list[CandidateSchedule] = Field(default_factory=list)
    eligibility: list[CandidateEligibility] = Field(default_factory=list)

    @field_validator("service_type")
    @classmethod
    def _svc(cls, v):
        if v not in SERVICE_TYPES:
            raise ValueError(f"unknown service type {v}")
        return v

    @field_validator("food_types")
    @classmethod
    def _ft(cls, v):
        bad = [x for x in v if x not in FOOD_TYPES]
        if bad:
            raise ValueError(f"unknown food types {bad}")
        return list(dict.fromkeys(v))


class CandidateResource(BaseModel):
    external_id: str
    source_url: str | None = None  # listing page in the source (attribution)
    organization_name: str
    organization_website: str | None = None  # official provider site only when the source states it
    location_name: str | None = None
    address1: str | None = None
    address2: str | None = None
    city: str | None = None
    state: str = "VA"
    zip: str | None = None
    lat: float | None = None
    lon: float | None = None
    geocode_source: str | None = None
    jurisdiction_id: str | None = None
    phone: str | None = None
    email: str | None = None
    website: str | None = None
    registration_url: str | None = None
    languages: list[str] = Field(default_factory=list)
    notes: str | None = None
    raw_hours_text: str | None = None  # kept verbatim when schedule parsing fails
    raw_eligibility_text: str | None = None
    operating_status: str = "unknown"
    schedules: list[CandidateSchedule] = Field(default_factory=list)  # location-wide
    services: list[CandidateService] = Field(default_factory=list)
    eligibility: list[CandidateEligibility] = Field(default_factory=list)  # location-wide
    wheelchair_accessible: str = "unknown"
    parking_notes: str | None = None
    transit_notes: str | None = None


# Location fields compared for change detection / conflict proposals.
LOCATION_FIELDS = (
    "name", "address1", "address2", "city", "zip", "phone", "email", "website", "registration_url",
    "operating_status", "notes", "wheelchair_accessible", "parking_notes", "transit_notes",
)
# Changes to these on a verified listing send it back to needs_review.
MATERIAL_FIELDS = {"address1", "city", "zip", "operating_status", "services", "schedules", "eligibility", "coordinates"}
