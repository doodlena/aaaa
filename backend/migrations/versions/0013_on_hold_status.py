"""review_status 'on_hold': listings no source can confirm, hidden until someone confirms them by phone

Revision ID: 0013
Revises: 0012
"""
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

NEW = "('candidate', 'needs_review', 'verified', 'stale', 'rejected', 'on_hold')"
OLD = "('candidate', 'needs_review', 'verified', 'stale', 'rejected')"


def upgrade() -> None:
    op.execute("ALTER TABLE locations DROP CONSTRAINT IF EXISTS ck_review_status_values")
    op.execute(f"ALTER TABLE locations ADD CONSTRAINT ck_review_status_values CHECK (review_status IN {NEW})")


def downgrade() -> None:
    op.execute("UPDATE locations SET review_status = 'candidate' WHERE review_status = 'on_hold'")
    op.execute("ALTER TABLE locations DROP CONSTRAINT IF EXISTS ck_review_status_values")
    op.execute(f"ALTER TABLE locations ADD CONSTRAINT ck_review_status_values CHECK (review_status IN {OLD})")
