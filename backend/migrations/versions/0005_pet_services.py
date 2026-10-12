"""pet support service categories

Revision ID: 0005
Revises: 0004
"""
import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.vocab import SERVICE_TYPES

    for code, group in SERVICE_TYPES.items():
        op.execute(sa.text("INSERT INTO service_categories (code, kind, group_code) VALUES (:c, 'service_type', :g) "
                           "ON CONFLICT (code) DO UPDATE SET group_code = EXCLUDED.group_code").bindparams(c=code, g=group))


def downgrade() -> None:
    op.execute("DELETE FROM service_categories WHERE group_code = 'pets' "
               "AND code NOT IN (SELECT service_type FROM services)")
