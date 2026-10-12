"""encrypt private account data: search preferences and saved places

Saved places move from the `favorites` table (a readable account-to-listing link) into an encrypted list on the account,
and existing search preferences are encrypted in place. See app/services/secrets.py (seal/unseal).

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-12 23:30:00
"""
import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None

JSONB = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql')


def _write(bind, user_id, column, value):
    bind.execute(sa.text(f"UPDATE users SET {column} = CAST(:v AS jsonb) WHERE id = :id"), {"v": json.dumps(value), "id": user_id})


def upgrade() -> None:
    from app.services.secrets import is_sealed, seal

    op.add_column('users', sa.Column('saved_places', JSONB, server_default='[]', nullable=False))
    bind = op.get_bind()
    saved: dict[int, list] = {}
    for user_id, location_id, at in bind.execute(sa.text("SELECT user_id, location_id, created_at FROM favorites ORDER BY created_at, location_id")):
        saved.setdefault(user_id, []).append({"id": location_id, "at": at.isoformat(timespec="seconds")})
    for user_id, prefs in bind.execute(sa.text("SELECT id, preferences FROM users")).all():
        if user_id in saved:
            _write(bind, user_id, "saved_places", seal(saved[user_id]))
        if prefs and not is_sealed(prefs):
            _write(bind, user_id, "preferences", seal(prefs))
    op.drop_table('favorites')


def downgrade() -> None:
    from app.services.secrets import unseal

    op.create_table('favorites',
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('location_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['location_id'], ['locations.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'location_id')
    )
    bind = op.get_bind()
    for user_id, prefs, places in bind.execute(sa.text("SELECT id, preferences, saved_places FROM users")).all():
        _write(bind, user_id, "preferences", unseal(prefs, {}) or {})
        for f in unseal(places, []) or []:
            bind.execute(sa.text("INSERT INTO favorites (user_id, location_id, created_at) SELECT :u, :l, CAST(:at AS timestamptz) "
                                 "WHERE EXISTS (SELECT 1 FROM locations WHERE id = :l) ON CONFLICT DO NOTHING"),
                         {"u": user_id, "l": f["id"], "at": f["at"]})
    op.drop_column('users', 'saved_places')
