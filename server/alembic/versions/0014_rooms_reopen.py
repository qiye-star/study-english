"""rooms reopen: opened_at (nullable, backfilled) + reopen_count (spec 2026-10-12 part 2, plan R-O1)

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-12 09:00:00.000000

`opened_at` stays NULLABLE for good: readers use coalesce(opened_at, created_at) (`rooms.store.opened_anchor`). A later
SET NOT NULL would scan the table under an ACCESS EXCLUSIVE lock on Postgres and would break old processes during a
rolling deploy (they insert rooms without this column). ADD COLUMN (nullable, or NOT NULL with a constant default) is
metadata-only on Postgres; the backfill is one UPDATE on a small table. SQLite: batch ops (adding columns does not
recreate the table; the downgrade drop does, and keeps the owner FK and the invite-token unique constraint).
Linear: 0013 -> 0014; the agents plans use 0015 / 0016.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0014'
down_revision: Union[str, Sequence[str], None] = '0013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    with op.batch_alter_table('rooms') as b:
        b.add_column(sa.Column('opened_at', TZ, nullable=True))
        b.add_column(sa.Column('reopen_count', sa.Integer(), nullable=False, server_default='0'))
    op.execute("UPDATE rooms SET opened_at = created_at WHERE opened_at IS NULL")


def downgrade() -> None:
    with op.batch_alter_table('rooms') as b:
        b.drop_column('reopen_count')
        b.drop_column('opened_at')
