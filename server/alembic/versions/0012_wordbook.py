"""wordbook tables (spec 2026-10-10-wordbook §5)

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-10 15:00:00.000000

New tables only (no ALTER on existing tables), so the same path is safe on SQLite and Postgres.
`alembic heads` before this migration: 0011 (head).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0012'
down_revision: Union[str, Sequence[str], None] = '0011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)
EVENT_INDEXES = (
    ('ix_wordbook_events_user_id_created_at', ['user_id', 'created_at']),
    ('ix_wordbook_events_user_id_day', ['user_id', 'day']),
    ('ix_wordbook_events_book_id_kind', ['book_id', 'kind']),
)


def upgrade() -> None:
    op.create_table(
        'wordbook_enrollments',
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('book_id', sa.String(16), primary_key=True),
        sa.Column('status', sa.String(8), nullable=False),
        sa.Column('order_mode', sa.String(8), nullable=False),
        sa.Column('seed', sa.Integer(), nullable=False),
        sa.Column('cursor', sa.Integer(), nullable=False),
        sa.Column('daily_new', sa.Integer(), nullable=False),
        sa.Column('review_cap', sa.Integer(), nullable=False),
        sa.Column('started_at', TZ, nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
    )
    op.create_table(
        'wordbook_events',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('book_id', sa.String(16), nullable=False),
        sa.Column('kind', sa.String(12), nullable=False),
        sa.Column('word', sa.String(100), nullable=False),
        sa.Column('item_id', sa.String(36), nullable=True),
        sa.Column('qtype', sa.String(12), nullable=True),
        sa.Column('outcome', sa.String(12), nullable=False),
        sa.Column('credit', sa.Integer(), nullable=False),
        sa.Column('day', sa.String(10), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
    )
    for name, columns in EVENT_INDEXES:
        op.create_index(name, 'wordbook_events', columns)
    op.create_table(
        'wordbook_explanations',
        sa.Column('word', sa.String(100), primary_key=True),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('model', sa.String(100), nullable=False),
        sa.Column('prompt_version', sa.Integer(), nullable=True),
        sa.Column('created_at', TZ, nullable=False),
    )
    op.create_table(
        'wordbook_reports',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('book_id', sa.String(16), nullable=False),
        sa.Column('word', sa.String(100), nullable=False),
        sa.Column('sentence_id', sa.String(16), nullable=False),
        sa.Column('kind', sa.String(12), nullable=False),
        sa.Column('reason', sa.String(16), nullable=False),
        sa.Column('status', sa.String(12), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
    )
    op.create_index('ix_wordbook_reports_status_created_at', 'wordbook_reports', ['status', 'created_at'])
    op.create_table(
        'wordbook_hidden_sentences',
        sa.Column('sentence_id', sa.String(16), primary_key=True),
        sa.Column('book_id', sa.String(16), nullable=False),
        sa.Column('hidden_by', sa.String(64), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
    )


def downgrade() -> None:
    op.drop_table('wordbook_hidden_sentences')
    op.drop_index('ix_wordbook_reports_status_created_at', table_name='wordbook_reports')
    op.drop_table('wordbook_reports')
    op.drop_table('wordbook_explanations')
    for name, _ in reversed(EVENT_INDEXES):
        op.drop_index(name, table_name='wordbook_events')
    op.drop_table('wordbook_events')
    op.drop_table('wordbook_enrollments')
