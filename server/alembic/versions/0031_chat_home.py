"""chat home: daily default conversations, daily greetings, chat prefs (plan 2026-10-23-chat-home-daily-greeting §4)

Revision ID: 0031
Revises: 0030
Create Date: 2026-10-23 12:00:00.000000

conversations.daily_date (nullable) + UNIQUE(user_id, daily_date): NULLs never conflict on SQLite or Postgres, so
ordinary conversations are unaffected. The column and constraint go through batch_alter_table (SQLite rebuilds the
table, Postgres runs a plain ALTER). chat_greetings / chat_prefs are new tables; their user_id foreign keys cascade
on Postgres, SQLite enforces none, so app/admin/users_admin.delete_user deletes them explicitly (USER_ROWS).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0031'
down_revision: Union[str, Sequence[str], None] = '0030'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    with op.batch_alter_table('conversations') as batch:
        batch.add_column(sa.Column('daily_date', sa.Date(), nullable=True))
        batch.create_unique_constraint('uq_conversations_user_daily_date', ['user_id', 'daily_date'])
    op.create_table(
        'chat_greetings',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('local_date', sa.Date(), nullable=False),
        sa.Column('conversation_id', sa.String(36), sa.ForeignKey('conversations.id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('message_ids', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(8), nullable=False),
        sa.Column('source', sa.String(8), nullable=True),
        sa.Column('language', sa.String(10), nullable=False),
        sa.Column('persona_id', sa.String(64), nullable=False),
        sa.Column('lines', sa.JSON(), nullable=False),
        sa.Column('prompt_version', sa.Integer(), nullable=True),
        sa.Column('facts', sa.JSON(), nullable=False),
        sa.Column('error_kind', sa.String(16), nullable=True),
        sa.Column('first_seen_at', TZ, nullable=True),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
        sa.UniqueConstraint('user_id', 'local_date', name='uq_chat_greetings_user_local_date'),
    )
    op.create_table(
        'chat_prefs',
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
    )


def downgrade() -> None:
    op.drop_table('chat_prefs')
    op.drop_table('chat_greetings')
    with op.batch_alter_table('conversations') as batch:
        batch.drop_constraint('uq_conversations_user_daily_date', type_='unique')
        batch.drop_column('daily_date')
