"""accounts foundation: users.nickname / email_verified_at, access_tokens.expires_at / last_used_at,
user_identities (plan S1 of 2026-10-14-accounts-foundation-email; INDEX §3 renumbered 0021 -> 0023, X4)

Revision ID: 0023
Revises: 0022
Create Date: 2026-10-19 12:00:00.000000

Tokens that exist before this migration get expires_at = migration time + 30 days, so a deploy does not log
everyone out. The 30 is a constant on purpose: a migration must not read runtime settings (new tokens are
written by the app with access_token_ttl_days). New columns are nullable, so Postgres does not rewrite the
tables. SQLite rebuilds in batch mode. The downgrade drops the table and the columns; no data is kept for them.
"""
from datetime import datetime, timedelta, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0023'
down_revision: Union[str, Sequence[str], None] = '0022'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BACKFILL_DAYS = 30


def upgrade() -> None:
    with op.batch_alter_table('users') as b:
        b.add_column(sa.Column('nickname', sa.String(32), nullable=True))
        b.add_column(sa.Column('email_verified_at', sa.DateTime(timezone=True), nullable=True))

    with op.batch_alter_table('access_tokens') as b:
        b.add_column(sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True))
        b.add_column(sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True))

    tokens = sa.table('access_tokens', sa.column('expires_at', sa.DateTime(timezone=True)))
    expires = datetime.now(timezone.utc) + timedelta(days=BACKFILL_DAYS)
    op.execute(tokens.update().where(tokens.c.expires_at.is_(None)).values(expires_at=expires))

    op.create_table(
        'user_identities',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('provider', sa.String(16), nullable=False),
        sa.Column('subject_hmac', sa.String(64), nullable=False),
        sa.Column('subject_enc', sa.Text(), nullable=False),
        sa.Column('verified_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('provider', 'subject_hmac', name='uq_user_identities_provider_subject'),
        sa.UniqueConstraint('user_id', 'provider', name='uq_user_identities_user_provider'),
    )
    op.create_index('ix_user_identities_user_id', 'user_identities', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_user_identities_user_id', table_name='user_identities')
    op.drop_table('user_identities')

    with op.batch_alter_table('access_tokens') as b:
        b.drop_column('last_used_at')
        b.drop_column('expires_at')

    with op.batch_alter_table('users') as b:
        b.drop_column('email_verified_at')
        b.drop_column('nickname')
