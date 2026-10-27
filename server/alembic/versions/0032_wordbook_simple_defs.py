"""wordbook_simple_defs: site-wide cache of simple English definitions (plan 2026-10-27 S3, R-S3)

Revision ID: 0032
Revises: 0031
Create Date: 2026-10-27 12:00:00.000000

One row per (word, pos, source-text hash). No user column and no foreign key, so deleting a user needs no cleanup.
A new table only: downgrade drops it, and the cache can be rebuilt by the model (the originals are always there).
Plain create_table works on SQLite and Postgres (no batch mode needed).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0032'
down_revision: Union[str, Sequence[str], None] = '0031'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        'wordbook_simple_defs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('word', sa.String(100), nullable=False),
        sa.Column('pos', sa.String(8), nullable=False),
        sa.Column('src_hash', sa.String(16), nullable=False),
        sa.Column('text', sa.Text(), nullable=True),
        sa.Column('status', sa.String(8), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('retry_after', TZ, nullable=True),
        sa.Column('model', sa.String(100), nullable=False),
        sa.Column('prompt_version', sa.Integer(), nullable=True),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
        sa.UniqueConstraint('word', 'pos', 'src_hash', name='uq_wordbook_simple_defs_word_pos_src'),
    )
    op.create_index('ix_wordbook_simple_defs_status', 'wordbook_simple_defs', ['status'])


def downgrade() -> None:
    op.drop_index('ix_wordbook_simple_defs_status', table_name='wordbook_simple_defs')
    op.drop_table('wordbook_simple_defs')
