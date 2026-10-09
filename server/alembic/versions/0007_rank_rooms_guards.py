"""rank and rooms guards: one open promotion match per user, grade attempt counter, rooms.owner_id RESTRICT

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-09 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0007'
down_revision: Union[str, Sequence[str], None] = '0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OPEN = "status IN ('active', 'grading_failed')"
OWNER_FK = 'fk_rooms_owner_id_users'
PG_OWNER_FK = 'rooms_owner_id_fkey'  # Postgres' name for the unnamed FK created by 0006
# Names the unnamed FK that SQLite reflects, so batch mode can drop it.
NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}


def _owner_fk(ondelete: str, old_pg_name: str, new_pg_name: str) -> None:
    """Deleting a room owner must never cascade to the room and every member's messages (review #14).
    SQLite rebuilds `rooms` in batch mode; FKs are not enforced on SQLite here, so the rebuild cascades nothing."""
    if op.get_bind().dialect.name == 'sqlite':
        with op.batch_alter_table('rooms', naming_convention=NAMING) as b:
            b.drop_constraint(OWNER_FK, type_='foreignkey')
            b.create_foreign_key(OWNER_FK, 'users', ['owner_id'], ['id'], ondelete=ondelete)
    else:
        op.drop_constraint(old_pg_name, 'rooms', type_='foreignkey')
        op.create_foreign_key(new_pg_name, 'rooms', 'users', ['owner_id'], ['id'], ondelete=ondelete)


def upgrade() -> None:
    bind = op.get_bind()
    # Duplicates from the start race (review #1) would block the unique index: keep each user's newest open match.
    rows = bind.execute(sa.text(
        f"SELECT id, user_id FROM promotion_matches WHERE {OPEN} ORDER BY user_id, started_at DESC, id")).all()
    seen = set()
    for match_id, user_id in rows:
        if user_id in seen:
            bind.execute(sa.text("UPDATE promotion_matches SET status = 'expired' WHERE id = :id"), {"id": match_id})
        seen.add(user_id)
    with op.batch_alter_table('promotion_matches') as b:
        b.add_column(sa.Column('grade_attempts', sa.Integer(), server_default='0', nullable=False))
    op.create_index('uq_promotion_matches_user_open', 'promotion_matches', ['user_id'], unique=True,
                    sqlite_where=sa.text(OPEN), postgresql_where=sa.text(OPEN))
    _owner_fk('RESTRICT', PG_OWNER_FK, OWNER_FK)


def downgrade() -> None:
    _owner_fk('CASCADE', OWNER_FK, PG_OWNER_FK)
    op.drop_index('uq_promotion_matches_user_open', table_name='promotion_matches')
    with op.batch_alter_table('promotion_matches') as b:
        b.drop_column('grade_attempts')
