"""catalog_items.source_md5: the fingerprint of the original file a catalog entry was imported from (plan
2026-10-27-library-local-export-cloud-import R-S1; the desktop app's videos.md5).

Nullable, no backfill, and deliberately NOT unique: failed, canceled or retired rows may share a fingerprint with a
new one. Only package imports set it. Goes through batch_alter_table like 0031 (SQLite rebuilds, Postgres runs ALTER).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0032'
down_revision: Union[str, Sequence[str], None] = '0031'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('catalog_items') as batch:
        batch.add_column(sa.Column('source_md5', sa.String(32), nullable=True))
    op.create_index('ix_catalog_items_source_md5', 'catalog_items', ['source_md5'])


def downgrade() -> None:
    op.drop_index('ix_catalog_items_source_md5', table_name='catalog_items')
    with op.batch_alter_table('catalog_items') as batch:
        batch.drop_column('source_md5')
