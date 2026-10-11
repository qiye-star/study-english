"""room agents: persona selection and room tutor snapshot (plan 2026-10-12-agents-rooms R-RA1)

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-12 12:00:00.000000

Two nullable JSON columns on `rooms`, no backfill. ADD COLUMN of a nullable column is a plain ALTER on SQLite and
Postgres (no table rewrite, no long lock); the downgrade uses batch mode for SQLite.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0017'
down_revision: Union[str, Sequence[str], None] = '0016'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('rooms', sa.Column('agent_config', sa.JSON(), nullable=True))
    op.add_column('rooms', sa.Column('agent_tutor', sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('rooms') as batch:
        batch.drop_column('agent_tutor')
        batch.drop_column('agent_config')
