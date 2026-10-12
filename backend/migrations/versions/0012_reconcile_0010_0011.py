"""reconcile: make sure both account-data encryption (0010) and the provider-portal columns (0011) are present

For a while the repository had two migrations sharing one revision id, so a database may be stamped at a revision
whose sibling never ran. Both steps are idempotent; this applies whichever is missing.

Revision ID: 0012
Revises: 0011
"""
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def upgrade() -> None:
    _load("0010_encrypt_account_data").upgrade()
    _load("0011_provider_portal_membership_details").upgrade()


def downgrade() -> None:
    pass
