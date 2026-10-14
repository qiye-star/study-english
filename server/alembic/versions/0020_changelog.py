"""changelog: entries and per-user read position (spec 2026-10-14-changelog-design §2.1, plan 2026-10-14-changelog)

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-14 12:00:00.000000

New tables only (no ALTER on existing tables), so one path is safe on SQLite and Postgres. changelog_reads.user_id
references users.id ON DELETE CASCADE; SQLite enforces no FK cascade, so app/admin/users_admin.delete_user deletes
explicitly (USER_ROWS). changelog_entries.created_by is the admin's name, not a foreign key.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0020'
down_revision: Union[str, Sequence[str], None] = '0019'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        'changelog_entries',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('published_at', TZ, nullable=True),
        sa.Column('entry_date', sa.Date(), nullable=False),
        sa.Column('version', sa.String(24), nullable=True),
        sa.Column('title_zh', sa.String(80), nullable=False),
        sa.Column('title_en', sa.String(80), nullable=False),
        sa.Column('items', sa.JSON(), nullable=False),
        sa.Column('created_by', sa.String(64), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
        sa.Column('archived_at', TZ, nullable=True),
    )
    op.create_index('ix_changelog_entries_entry_date', 'changelog_entries', ['entry_date'])
    op.create_table(
        'changelog_reads',
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('last_seen_id', sa.Integer(), nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
    )


def downgrade() -> None:
    op.drop_table('changelog_reads')
    op.drop_index('ix_changelog_entries_entry_date', table_name='changelog_entries')
    op.drop_table('changelog_entries')
