"""provider portal: decision note shown to the person who asked for access, and who added a colleague

Revision ID: 0010
Revises: 0009

Idempotent: some databases got these columns under an earlier numbering. 0012 re-checks both 0010 and 0011.
"""
import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("provider_memberships")}
    if "decision_note" not in have:
        op.add_column("provider_memberships", sa.Column("decision_note", sa.Text(), nullable=True))
    if "added_by_id" not in have:
        op.add_column("provider_memberships", sa.Column("added_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("provider_memberships", "added_by_id")
    op.drop_column("provider_memberships", "decision_note")
