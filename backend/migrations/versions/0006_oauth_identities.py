"""oauth identities

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-12 19:30:00
"""
from alembic import op
import sqlalchemy as sa


revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('oauth_identities',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('issuer', sa.String(length=255), nullable=False),
    sa.Column('subject', sa.String(length=255), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('issuer', 'subject')
    )
    op.create_index(op.f('ix_oauth_identities_user_id'), 'oauth_identities', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_oauth_identities_user_id'), table_name='oauth_identities')
    op.drop_table('oauth_identities')
