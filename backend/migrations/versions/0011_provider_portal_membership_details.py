"""provider portal: decision note shown to the person who asked for access, and who added a colleague

Revision ID: 0011
Revises: 0010

History: this was briefly published as revision "0010" at the same time as 0010_encrypt_account_data, so a database
stamped "0010" may have run either one. This migration is therefore idempotent and also applies the account-data
encryption if that never ran (no users.saved_places column), so every database ends up with both changes.
"""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "saved_places" not in _columns("users"):
        spec = importlib.util.spec_from_file_location("m0010_encrypt", Path(__file__).with_name("0010_encrypt_account_data.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.upgrade()
    have = _columns("provider_memberships")
    if "decision_note" not in have:
        op.add_column("provider_memberships", sa.Column("decision_note", sa.Text(), nullable=True))
    if "added_by_id" not in have:
        op.add_column("provider_memberships", sa.Column("added_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("provider_memberships", "added_by_id")
    op.drop_column("provider_memberships", "decision_note")
