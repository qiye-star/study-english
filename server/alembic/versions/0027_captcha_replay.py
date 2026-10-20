"""captcha replay table: single-use ALTCHA challenge signatures (spec 2026-10-20-captcha-altcha §5, R-C7)

Revision ID: 0027
Revises: 0026
Create Date: 2026-10-20 10:00:00.000000

Only a new table with its expiry index. SQLite and Postgres take the same path (op.create_table), so no batch
mode is needed (batch exists for SQLite ALTERs, and this migration has none). The table holds no user id and no
IP: only the signature of a challenge that was already used, and the time after which it can be purged.
The downgrade drops the table; that only forgets signatures that were already used, and those expire within
the configured challenge lifetime (at most 30 minutes) anyway.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0027'
down_revision: Union[str, Sequence[str], None] = '0026'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'captcha_replays',
        sa.Column('signature', sa.String(64), primary_key=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_captcha_replays_expires_at', 'captcha_replays', ['expires_at'])


def downgrade() -> None:
    op.drop_index('ix_captcha_replays_expires_at', table_name='captcha_replays')
    op.drop_table('captcha_replays')
