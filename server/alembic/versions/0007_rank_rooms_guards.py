"""rank and rooms guards: one open promotion match per user, grade attempt counter

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


def downgrade() -> None:
    op.drop_index('uq_promotion_matches_user_open', table_name='promotion_matches')
    with op.batch_alter_table('promotion_matches') as b:
        b.drop_column('grade_attempts')
