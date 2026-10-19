"""accounts email: verification_codes, email_daily_counts (plan S10 of 2026-10-14-accounts-foundation-email;
INDEX §3 renumbered 0022 -> 0024, R-F2, R-F4)

Revision ID: 0024
Revises: 0023
Create Date: 2026-10-19 14:00:00.000000

Two new tables, no change to existing ones, so Postgres has nothing to rewrite and SQLite needs no batch rebuild
(batch is only for ALTER of existing tables). The downgrade drops both tables; the unspent codes and the day
counters they hold are disposable.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0024'
down_revision: Union[str, Sequence[str], None] = '0023'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'verification_codes',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('channel', sa.String(8), nullable=False),
        sa.Column('purpose', sa.String(16), nullable=False),
        sa.Column('target_hmac', sa.String(64), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=True),
        sa.Column('code_hmac', sa.String(64), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('consumed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_verification_codes_user_id', 'verification_codes', ['user_id'])
    op.create_index('ix_verification_codes_created_at', 'verification_codes', ['created_at'])
    op.create_index('ix_verification_codes_target_purpose_created', 'verification_codes',
                    ['target_hmac', 'purpose', 'created_at'])

    op.create_table(
        'email_daily_counts',
        sa.Column('day', sa.Date(), primary_key=True),
        sa.Column('sent', sa.Integer(), nullable=False, server_default='0'),
    )


def downgrade() -> None:
    op.drop_table('email_daily_counts')
    op.drop_index('ix_verification_codes_target_purpose_created', table_name='verification_codes')
    op.drop_index('ix_verification_codes_created_at', table_name='verification_codes')
    op.drop_index('ix_verification_codes_user_id', table_name='verification_codes')
    op.drop_table('verification_codes')
