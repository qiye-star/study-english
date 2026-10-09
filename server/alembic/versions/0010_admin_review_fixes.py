"""admin console v2 review fixes: app_secrets (stable admin session secret), audit_head (serialised audit chain)

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-10 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0010'
down_revision: Union[str, Sequence[str], None] = '0009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table('app_secrets',
        sa.Column('name', sa.String(length=32), nullable=False),
        sa.Column('value', sa.String(length=128), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.PrimaryKeyConstraint('name'))
    op.create_table('audit_head',
        sa.Column('id', sa.Integer(), autoincrement=False, nullable=False),
        sa.Column('hash', sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint('id'))


def downgrade() -> None:
    op.drop_table('audit_head')
    op.drop_table('app_secrets')
