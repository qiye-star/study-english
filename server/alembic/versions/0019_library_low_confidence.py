"""library: low_confidence flag on items (plan 2026-10-13-library-alignment, spec D5 §4.3.4)

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-13 18:00:00.000000

One NOT NULL boolean with a server default on library_items: a plain ADD COLUMN on SQLite and Postgres (no table
rewrite on Postgres 11+), existing rows read false. The downgrade uses batch mode for SQLite (like 0017).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0019'
down_revision: Union[str, Sequence[str], None] = '0018'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('library_items', sa.Column('low_confidence', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table('library_items') as batch:
        batch.drop_column('low_confidence')
