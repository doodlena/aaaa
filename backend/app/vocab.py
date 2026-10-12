"""Controlled vocabularies shared by the database, API, ingestion pipeline, and frontend.

Codes are stable identifiers; human labels live in the frontend i18n catalogs (en/es) keyed by these codes.
"""

# Review / publication lifecycle of a location (see docs/verification/VERIFICATION_GUIDE.md)
REVIEW_STATUSES = ("candidate", "needs_review", "verified", "stale", "rejected")
PUBLIC_REVIEW_STATUSES = ("verified", "stale")
OPERATING_STATUSES = ("open", "temporarily_closed", "permanently_closed", "unknown")

# Tri-state used for every eligibility condition: never collapse "unknown" into "not_required".
TRISTATE = ("required", "not_required", "unknown")
YES_NO_UNKNOWN = ("yes", "no", "unknown")

ELIGIBILITY_TYPES = (
    "residency",
    "service_area",
    "zip_restriction",
    "income",
    "household_size",
    "age",
    "student_affiliation",
    "referral",
    "registration",
    "appointment",
    "photo_id",
    "proof_of_address",
    "income_documentation",
    "benefit_documentation",
    "visit_limit",
    "quantity_limit",
    "first_come_first_served",
    "other",
)

# code -> parent filter group. Groups are what the public filter UI exposes.
FOOD_TYPES = {
    "general_groceries": "groceries",
    "pantry_staples": "groceries",
    "fresh_fruits": "produce",
    "fresh_vegetables": "produce",
    "meat": "protein",
    "poultry": "protein",
    "fish": "protein",
    "dairy": "dairy",
    "eggs": "dairy",
    "frozen_foods": "groceries",
    "bread": "bakery",
    "baked_goods": "bakery",
    "prepared_meals": "prepared_meals",
    "community_meals": "prepared_meals",
    "emergency_food_packages": "groceries",
    "baby_formula": "infant",
    "infant_food": "infant",
    "culturally_specific": "special_diet",
    "vegetarian": "special_diet",
    "halal": "special_diet",
    "kosher": "special_diet",
    "other_special_diet": "special_diet",
}
FOOD_GROUPS = ("groceries", "produce", "protein", "dairy", "bakery", "prepared_meals", "infant", "special_diet")

SERVICE_TYPES = {
    "pantry_pickup": "pantry",
    "walk_up": "walk_up",
    "drive_through": "drive_through",
    "mobile_pantry": "mobile",
    "community_meal": "community_meal",
    "home_delivery": "delivery",
    "delivery_qualifying": "delivery",
    "emergency_food": "emergency",
    "school_based": "school",
    "appointment_distribution": "pantry",
    "seasonal_program": "seasonal",
    "grocery_voucher": "voucher",
    "diapers": "non_food",
    "hygiene_supplies": "non_food",
    "household_essentials": "non_food",
    "food_referral": "referral",
    "other": "other",
}
SERVICE_GROUPS = tuple(dict.fromkeys(SERVICE_TYPES.values()))

OFFERING_STATUSES = ("regular", "seasonal", "event_specific", "unconfirmed")
SCHEDULE_KINDS = ("operating_hours", "distribution")
EXCEPTION_KINDS = ("closed", "cancelled", "special_hours")
VERIFICATION_METHODS = ("phone", "email", "website", "in_person", "official_source", "provider_submission")
VERIFICATION_ACTIONS = (
    "verify",
    "publish",
    "unpublish",
    "reject",
    "flag",
    "close_temporary",
    "close_permanent",
    "reopen",
    "edit",
    "merge",
)
JURISDICTION_STATUSES = ("pilot", "expansion", "planned", "disabled")
