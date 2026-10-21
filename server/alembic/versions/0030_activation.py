"""word usage counts and the sentence lemma index for vocabulary activation (plan L4 R2, R10; INDEX §3)

Revision ID: 0030
Revises: 0029
Create Date: 2026-10-21 11:00:00.000000

New tables only; no existing row or column changes:
- word_usage: (user_id, lemma) counters of learned words used actively (first / last use, use / shadow / session
  counts, sources, last_session = a 16-hex digest of the session id). Only lemmas and counts, never text.
  user_id references users.id ON DELETE CASCADE (also listed in admin/users_admin.USER_ROWS).
- segment_lemma: (scope, owner_id, idx, lemma) index of lemmas per sentence. scope is 'lib' (library_items.id) or
  'cat' (catalog_items.id); the two owners share the table, so there is no foreign key (SQLite has no cascade for
  it either). Orphans are invisible to readers (they join the owner) and swept by activation/purge.py.

SQLite and Postgres take the same path: CREATE TABLE / CREATE INDEX need no batch mode. The downgrade loses only
the usage counters and the sentence index, which are rebuilt from the learning events and the library sentences.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0030'
down_revision: Union[str, Sequence[str], None] = '0029'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'word_usage',
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('lemma', sa.String(100), primary_key=True),
        sa.Column('first_used_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('use_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('shadow_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('session_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_session', sa.String(16), nullable=True),
        sa.Column('sources', sa.String(32), nullable=False, server_default=''),
    )
    op.create_index('ix_word_usage_user_id_last_used_at', 'word_usage', ['user_id', 'last_used_at'])
    op.create_table(
        'segment_lemma',
        sa.Column('scope', sa.String(3), primary_key=True),
        sa.Column('owner_id', sa.String(36), primary_key=True),
        sa.Column('idx', sa.Integer(), primary_key=True),
        sa.Column('lemma', sa.String(100), primary_key=True),
    )
    op.create_index('ix_segment_lemma_lemma_scope', 'segment_lemma', ['lemma', 'scope'])


def downgrade() -> None:
    op.drop_index('ix_segment_lemma_lemma_scope', table_name='segment_lemma')
    op.drop_table('segment_lemma')
    op.drop_index('ix_word_usage_user_id_last_used_at', table_name='word_usage')
    op.drop_table('word_usage')
