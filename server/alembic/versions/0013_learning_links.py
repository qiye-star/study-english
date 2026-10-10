"""learning links tables (spec 2026-10-11-learning-links §10)

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-11 10:00:00.000000

New tables only (no ALTER on existing tables), so the same path is safe on SQLite and Postgres.
`alembic heads` before this migration: 0012 (head) — plans A (wordbook recall) and B (wordbook goals) add no migration;
merge order A -> B -> C (this). If A or B ever adds one, renumber this file to head + 1 (INDEX 2026-10-11 §5).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0013'
down_revision: Union[str, Sequence[str], None] = '0012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)


def _user(primary_key: bool = False) -> sa.Column:
    return sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=primary_key,
                     nullable=False)


def upgrade() -> None:
    op.create_table(
        'user_link_prefs',
        _user(primary_key=True),
        sa.Column('link_key', sa.String(24), primary_key=True),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
    )
    op.create_table(
        'link_mistake_words',
        _user(primary_key=True),
        sa.Column('word', sa.String(100), primary_key=True),
        sa.Column('book_id', sa.String(16), nullable=False),
        sa.Column('wrong_count', sa.Integer(), nullable=False),
        sa.Column('ok_streak', sa.Integer(), nullable=False),
        sa.Column('last_event_at', TZ, nullable=False),
        sa.Column('last_wrong_at', TZ, nullable=False),
        sa.Column('cleared_at', TZ, nullable=True),
    )
    op.create_index('ix_link_mistake_words_user_id_cleared_at', 'link_mistake_words', ['user_id', 'cleared_at'])
    op.create_table(
        'link_weak_words',
        _user(primary_key=True),
        sa.Column('word', sa.String(100), primary_key=True),
        sa.Column('hits', sa.Integer(), nullable=False),
        sa.Column('last_score', sa.Integer(), nullable=True),
        sa.Column('ok_streak', sa.Integer(), nullable=False),
        sa.Column('last_event_at', TZ, nullable=False),
        sa.Column('last_weak_at', TZ, nullable=False),
        sa.Column('cleared_at', TZ, nullable=True),
    )
    op.create_index('ix_link_weak_words_user_id_cleared_at', 'link_weak_words', ['user_id', 'cleared_at'])
    op.create_table(
        'link_word_uses',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        _user(),
        sa.Column('word', sa.String(100), nullable=False),
        sa.Column('learn_event_id', sa.Integer(), nullable=False),
        sa.Column('message_id', sa.String(36), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.UniqueConstraint('user_id', 'learn_event_id', name='uq_link_word_uses_user_learn'),
    )
    op.create_index('ix_link_word_uses_user_id_created_at', 'link_word_uses', ['user_id', 'created_at'])
    op.create_table(
        'link_credits',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        _user(),
        sa.Column('kind', sa.String(16), nullable=False),
        sa.Column('ref_id', sa.String(80), nullable=False),
        sa.Column('score', sa.Integer(), nullable=True),
        sa.Column('created_at', TZ, nullable=False),
        sa.UniqueConstraint('user_id', 'kind', 'ref_id', name='uq_link_credits_user_kind_ref'),
    )
    op.create_index('ix_link_credits_user_id_created_at', 'link_credits', ['user_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_link_credits_user_id_created_at', table_name='link_credits')
    op.drop_table('link_credits')
    op.drop_index('ix_link_word_uses_user_id_created_at', table_name='link_word_uses')
    op.drop_table('link_word_uses')
    op.drop_index('ix_link_weak_words_user_id_cleared_at', table_name='link_weak_words')
    op.drop_table('link_weak_words')
    op.drop_index('ix_link_mistake_words_user_id_cleared_at', table_name='link_mistake_words')
    op.drop_table('link_mistake_words')
    op.drop_table('user_link_prefs')
