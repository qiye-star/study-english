"""agents core tables (spec 2026-10-12-agents §4.1; plan R-C3)

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-12 10:00:00.000000

Three new tables plus one nullable JSON column on `messages`. The column goes through batch mode so SQLite (table
copy only on drop) and Postgres (plain ALTER ... ADD COLUMN, nullable, metadata-only: no table rewrite, no
SET NOT NULL scan, old processes that do not know the column keep working) share one path. The new tables are
empty, so their NOT NULL columns cost nothing. Every FK is ON DELETE CASCADE and mirrors the models;
`admin.users_admin.USER_ROWS` deletes the same rows explicitly because SQLite does not enforce FK cascades.
Linear: 0014 -> 0015 (the agents memory / tutor plans use 0016).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0015'
down_revision: Union[str, Sequence[str], None] = '0014'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        'agent_personas',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('owner_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(20), nullable=False),
        sa.Column('intro', sa.String(60), nullable=False, server_default=''),
        sa.Column('prompt', sa.Text(), nullable=False),
        sa.Column('level', sa.String(2), nullable=False, server_default='B1'),
        sa.Column('style', sa.String(12), nullable=False, server_default='friendly'),
        sa.Column('voice', sa.String(64), nullable=True),
        sa.Column('tools', sa.JSON(), nullable=False),
        sa.Column('prompt_public', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('deep_think', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('disabled_at', TZ, nullable=True),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
    )
    op.create_index('ix_agent_personas_owner_id_created_at', 'agent_personas', ['owner_id', 'created_at'])
    op.create_table(
        'agent_user_settings',
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True,
                  nullable=False),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
    )
    op.create_table(
        'agent_persona_reports',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('persona_id', sa.String(36), sa.ForeignKey('agent_personas.id', ondelete='CASCADE'), nullable=False),
        sa.Column('reporter_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('reason', sa.String(16), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('resolved_at', TZ, nullable=True),
        sa.Column('resolved_by', sa.String(64), nullable=True),
        sa.Column('resolution', sa.String(16), nullable=True),
        sa.UniqueConstraint('persona_id', 'reporter_id', name='uq_agent_persona_reports_persona_reporter'),
    )
    op.create_index('ix_agent_persona_reports_persona_id', 'agent_persona_reports', ['persona_id'])
    op.create_index('ix_agent_persona_reports_resolved_at_created_at', 'agent_persona_reports',
                    ['resolved_at', 'created_at'])
    with op.batch_alter_table('messages') as batch:
        batch.add_column(sa.Column('agent_trace', sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('messages') as batch:
        batch.drop_column('agent_trace')
    op.drop_index('ix_agent_persona_reports_resolved_at_created_at', table_name='agent_persona_reports')
    op.drop_index('ix_agent_persona_reports_persona_id', table_name='agent_persona_reports')
    op.drop_table('agent_persona_reports')
    op.drop_table('agent_user_settings')
    op.drop_index('ix_agent_personas_owner_id_created_at', table_name='agent_personas')
    op.drop_table('agent_personas')
