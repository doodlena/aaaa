"""provider portal: decision note shown to the person who asked for access, and who added a colleague

Revision ID: 0010
Revises: 0009
"""
import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("provider_memberships", sa.Column("decision_note", sa.Text(), nullable=True))
    op.add_column("provider_memberships", sa.Column("added_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("provider_memberships", "added_by_id")
    op.drop_column("provider_memberships", "decision_note")
