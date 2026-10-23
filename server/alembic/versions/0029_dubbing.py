"""dubbing: speaker labels on sentences, role names on items, dub takes (plan L5 R2, INDEX §3)

Revision ID: 0029
Revises: 0027
Create Date: 2026-10-21 10:00:00.000000

Columns (all nullable, so existing rows are untouched):
- library_segments.speaker (String 2): A–F, NULL = not labelled (the dubbing feature reads NULL as "the other side").
- library_items.role_names (JSON): {"A": "name", ...} for the labelled roles; NULL = no roles.
- catalog_segments.speaker / catalog_items.role_names: the curated-catalog mirror of the two above; the copy in
  `add_to_library` carries them over one-to-one.
- library_attempts.dub_id (String 36, no foreign key, same meaning as assessment_id): the take a line belongs to.
  Indexed for the take lookups.
New table library_dubs: one dubbing take (a continuous clip played as one role), owned by a user and tied to an item
with ON DELETE CASCADE on both sides. `lines` holds the per-line scores as JSON.

SQLite and Postgres take the same path: ADD COLUMN / CREATE TABLE / CREATE INDEX need no batch mode; the downgrade drops
columns in batch mode (SQLite cannot drop a column in place). The downgrade loses the role labels and the dubbing
takes only; the library rows, sentences, attempts and assessments are kept.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0029'
down_revision: Union[str, Sequence[str], None] = '0028'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('library_segments', sa.Column('speaker', sa.String(2), nullable=True))
    op.add_column('library_items', sa.Column('role_names', sa.JSON(), nullable=True))
    op.add_column('catalog_segments', sa.Column('speaker', sa.String(2), nullable=True))
    op.add_column('catalog_items', sa.Column('role_names', sa.JSON(), nullable=True))
    op.add_column('library_attempts', sa.Column('dub_id', sa.String(36), nullable=True))
    op.create_index('ix_library_attempts_dub_id', 'library_attempts', ['dub_id'])
    op.create_table(
        'library_dubs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('item_id', sa.String(36), sa.ForeignKey('library_items.id', ondelete='CASCADE'), nullable=False),
        sa.Column('seg_from', sa.Integer(), nullable=False),
        sa.Column('seg_to', sa.Integer(), nullable=False),
        sa.Column('role', sa.String(2), nullable=False),
        sa.Column('status', sa.String(10), nullable=False),
        sa.Column('total_score', sa.SmallInteger(), nullable=True),
        sa.Column('summary', sa.JSON(), nullable=True),
        sa.Column('lines', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_library_dubs_user_id_item_id_created_at', 'library_dubs',
                    ['user_id', 'item_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_library_dubs_user_id_item_id_created_at', table_name='library_dubs')
    op.drop_table('library_dubs')
    op.drop_index('ix_library_attempts_dub_id', table_name='library_attempts')
    with op.batch_alter_table('library_attempts') as batch:
        batch.drop_column('dub_id')
    with op.batch_alter_table('catalog_items') as batch:
        batch.drop_column('role_names')
    with op.batch_alter_table('catalog_segments') as batch:
        batch.drop_column('speaker')
    with op.batch_alter_table('library_items') as batch:
        batch.drop_column('role_names')
    with op.batch_alter_table('library_segments') as batch:
        batch.drop_column('speaker')
