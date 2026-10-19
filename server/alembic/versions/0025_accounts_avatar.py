"""accounts avatar: users.avatar_id (unique), avatar_reports (plan S2 of 2026-10-14-accounts-avatar;
INDEX §3 renumbered 0023 -> 0025, R-V6)

Revision ID: 0025
Revises: 0024
Create Date: 2026-10-19 16:00:00.000000

The new users column is nullable, so Postgres only adds a catalogue entry and a unique index on a column that is
all NULL. SQLite rebuilds users in batch mode. The unique index is named by hand (uq_users_avatar_id) so that the
model's __table_args__ and this migration agree. The downgrade drops the reports and the column; the image files
under DATA_DIR/avatars are not touched by a migration and stay on disk until they are removed by hand.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0025'
down_revision: Union[str, Sequence[str], None] = '0024'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users') as b:
        b.add_column(sa.Column('avatar_id', sa.String(32), nullable=True))
    op.create_index('uq_users_avatar_id', 'users', ['avatar_id'], unique=True)

    op.create_table(
        'avatar_reports',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('avatar_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('avatar_id', sa.String(32), nullable=False),
        sa.Column('reporter_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('reason', sa.String(16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('reporter_id', 'avatar_id', name='uq_avatar_reports_reporter_avatar'),
    )
    op.create_index('ix_avatar_reports_avatar_user_id', 'avatar_reports', ['avatar_user_id'])


def downgrade() -> None:
    op.drop_index('ix_avatar_reports_avatar_user_id', table_name='avatar_reports')
    op.drop_table('avatar_reports')

    op.drop_index('uq_users_avatar_id', table_name='users')
    with op.batch_alter_table('users') as b:
        b.drop_column('avatar_id')
