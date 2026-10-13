"""library: imported audio / video, sentences and shadowing attempts (spec 2026-10-13-video-import §4)

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-13 12:00:00.000000

New tables only (no ALTER), so one path is safe on SQLite and Postgres. user_id references users.id and item_id
references library_items.id, both ON DELETE CASCADE. SQLite enforces neither: app/library/store.delete_item and
app/admin/users_admin.delete_user delete explicitly. library_attempts.assessment_id has no foreign key on purpose
(SET NULL semantics are kept by the application, plan R-SC14). library_segments carries the D8 columns zh / zh_lang /
analysis / analysis_lang from the start (spec §4: the migration is not written yet, no second revision).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0018'
down_revision: Union[str, Sequence[str], None] = '0017'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)


def _user() -> sa.Column:
    return sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)


def _item(primary_key: bool = False) -> sa.Column:
    return sa.Column('item_id', sa.String(36), sa.ForeignKey('library_items.id', ondelete='CASCADE'),
                     primary_key=primary_key, nullable=False)


def upgrade() -> None:
    op.create_table(
        'library_items',
        sa.Column('id', sa.String(36), primary_key=True),
        _user(),
        sa.Column('kind', sa.String(8), nullable=False),
        sa.Column('source', sa.String(8), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('status', sa.String(12), nullable=False),
        sa.Column('stage', sa.String(16), nullable=True),
        sa.Column('progress', sa.SmallInteger(), nullable=False, server_default='0'),
        sa.Column('error_kind', sa.String(24), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('next_run_at', TZ, nullable=True),
        sa.Column('source_host', sa.String(64), nullable=True),
        sa.Column('source_url', sa.Text(), nullable=True),
        sa.Column('upload_total', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('upload_received', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('duration_ms', sa.Integer(), nullable=True),
        sa.Column('media_path', sa.String(200), nullable=True),
        sa.Column('poster_path', sa.String(200), nullable=True),
        sa.Column('media_mime', sa.String(32), nullable=True),
        sa.Column('library_bytes', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('sub_source', sa.String(10), nullable=True),
        sa.Column('asr_seconds', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('seg_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('resume_ms', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('resume_idx', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('rate_pct', sa.Integer(), nullable=False, server_default='100'),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
        sa.Column('last_opened_at', TZ, nullable=True),
    )
    op.create_index('ix_library_items_user_id_created_at', 'library_items', ['user_id', 'created_at'])
    op.create_index('ix_library_items_status_next_run_at', 'library_items', ['status', 'next_run_at'])
    op.create_table(
        'library_segments',
        _item(primary_key=True),
        sa.Column('idx', sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column('start_ms', sa.Integer(), nullable=False),
        sa.Column('end_ms', sa.Integer(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('zh', sa.Text(), nullable=True),
        sa.Column('zh_lang', sa.String(8), nullable=True),
        sa.Column('analysis', sa.Text(), nullable=True),
        sa.Column('analysis_lang', sa.String(8), nullable=True),
    )
    op.create_table(
        'library_attempts',
        sa.Column('id', sa.String(36), primary_key=True),
        _user(),
        _item(),
        sa.Column('seg_idx', sa.Integer(), nullable=False),
        sa.Column('assessment_id', sa.String(36), nullable=True),
        sa.Column('text_hash', sa.String(16), nullable=False),
        sa.Column('score', sa.SmallInteger(), nullable=True),
        sa.Column('created_at', TZ, nullable=False),
    )
    op.create_index('ix_library_attempts_item_id_seg_idx', 'library_attempts', ['item_id', 'seg_idx'])


def downgrade() -> None:
    op.drop_index('ix_library_attempts_item_id_seg_idx', table_name='library_attempts')
    op.drop_table('library_attempts')
    op.drop_table('library_segments')
    op.drop_index('ix_library_items_status_next_run_at', table_name='library_items')
    op.drop_index('ix_library_items_user_id_created_at', table_name='library_items')
    op.drop_table('library_items')
