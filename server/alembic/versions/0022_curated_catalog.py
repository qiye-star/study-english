"""curated catalog: system-owned catalog items + sentences, and library_items.catalog_id
(spec 2026-10-14-curated-library §5)

Revision ID: 0022
Revises: 0021
Create Date: 2026-10-14 18:00:00.000000

Two new tables (no user_id: the catalog belongs to the system) and one nullable column on library_items with a unique
index (user_id, catalog_id): NULLs are distinct on SQLite and Postgres, so plain items are unaffected and a second copy
of one catalog item for one user is refused (idempotent "add"). No FK from library_items.catalog_id (plan R-SC1).
ADD COLUMN / CREATE TABLE / CREATE INDEX need no batch on SQLite; the downgrade drops the column in batch mode.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0022'
down_revision: Union[str, Sequence[str], None] = '0021'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'catalog_items',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('level', sa.String(2), nullable=True),
        sa.Column('tags', sa.String(120), nullable=True),
        sa.Column('license_note', sa.String(300), nullable=True),
        sa.Column('source', sa.String(8), nullable=False),
        sa.Column('source_host', sa.String(64), nullable=True),
        sa.Column('source_url', sa.Text(), nullable=True),
        sa.Column('status', sa.String(12), nullable=False),
        sa.Column('stage', sa.String(16), nullable=True),
        sa.Column('progress', sa.SmallInteger(), nullable=False, server_default='0'),
        sa.Column('error_kind', sa.String(24), nullable=True),
        sa.Column('upload_total', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('upload_received', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('duration_ms', sa.Integer(), nullable=True),
        sa.Column('media_path', sa.String(200), nullable=True),
        sa.Column('poster_path', sa.String(200), nullable=True),
        sa.Column('media_mime', sa.String(32), nullable=True),
        sa.Column('media_bytes', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('sub_source', sa.String(10), nullable=True),
        sa.Column('asr_seconds', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('seg_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('low_confidence', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('ai_lang', sa.String(8), nullable=False, server_default='zh-CN'),
        sa.Column('published', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('retired_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_catalog_items_status_created_at', 'catalog_items', ['status', 'created_at'])
    op.create_table(
        'catalog_segments',
        sa.Column('catalog_id', sa.String(36), sa.ForeignKey('catalog_items.id', ondelete='CASCADE'),
                  primary_key=True),
        sa.Column('idx', sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column('start_ms', sa.Integer(), nullable=False),
        sa.Column('end_ms', sa.Integer(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('zh', sa.Text(), nullable=True),
        sa.Column('zh_lang', sa.String(8), nullable=True),
        sa.Column('analysis', sa.Text(), nullable=True),
        sa.Column('analysis_lang', sa.String(8), nullable=True),
        sa.Column('flags', sa.String(48), nullable=True),
    )
    op.add_column('library_items', sa.Column('catalog_id', sa.String(36), nullable=True))
    op.create_index('ux_library_items_user_id_catalog_id', 'library_items', ['user_id', 'catalog_id'], unique=True)


def downgrade() -> None:
    op.drop_index('ux_library_items_user_id_catalog_id', table_name='library_items')
    with op.batch_alter_table('library_items') as batch:
        batch.drop_column('catalog_id')
    op.drop_table('catalog_segments')
    op.drop_index('ix_catalog_items_status_created_at', table_name='catalog_items')
    op.drop_table('catalog_items')
