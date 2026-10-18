"""eligibility type 'population': listings that serve only a specific group (women, families with children, survivors...)

Revision ID: 0014
Revises: 0013
"""
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

BASE = ("'residency', 'service_area', 'zip_restriction', 'income', 'household_size', 'age', 'student_affiliation', "
        "'referral', 'registration', 'appointment', 'photo_id', 'proof_of_address', 'income_documentation', "
        "'benefit_documentation', 'visit_limit', 'quantity_limit', 'first_come_first_served', 'other'")


def upgrade() -> None:
    op.execute("ALTER TABLE eligibility_requirements DROP CONSTRAINT IF EXISTS ck_requirement_type_values")
    op.execute(f"ALTER TABLE eligibility_requirements ADD CONSTRAINT ck_requirement_type_values "
               f"CHECK (requirement_type IN ({BASE}, 'population'))")


def downgrade() -> None:
    op.execute("DELETE FROM eligibility_requirements WHERE requirement_type = 'population'")
    op.execute("ALTER TABLE eligibility_requirements DROP CONSTRAINT IF EXISTS ck_requirement_type_values")
    op.execute(f"ALTER TABLE eligibility_requirements ADD CONSTRAINT ck_requirement_type_values CHECK (requirement_type IN ({BASE}))")
