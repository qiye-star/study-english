"""library: per-sentence timing flags and the rebuildable mark (plan 2026-10-14-library-alignment-v2 R-V14, R-V8)

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-14 13:00:00.000000

Two plain ADD COLUMNs (no table rewrite on Postgres 11+, no batch needed on SQLite for adding):
library_segments.flags VARCHAR(48) NULL (comma-separated codes such as "rate,pause"; NULL = nothing suspicious) and
library_items.rebuildable BOOLEAN NOT NULL DEFAULT false (the recognizer output is kept, so sentences can be rebuilt
without paying again). Existing rows read NULL / false. The downgrade uses batch mode for SQLite (like 0019).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0021'
down_revision: Union[str, Sequence[str], None] = '0020'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('library_segments', sa.Column('flags', sa.String(48), nullable=True))
    op.add_column('library_items', sa.Column('rebuildable', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table('library_items') as batch:
        batch.drop_column('rebuildable')
    with op.batch_alter_table('library_segments') as batch:
        batch.drop_column('flags')
