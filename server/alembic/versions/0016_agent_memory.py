"""agent memory tables (spec 2026-10-12-agents §4.1, §8; plan A2)

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-12 10:00:00.000000

New tables only (no ALTER), so one path is safe on SQLite and Postgres. Every user_id references users.id
ON DELETE CASCADE; thread states and recaps reference conversations.id ON DELETE CASCADE (rooms.id for room
threads). SQLite enforces none of this: app/admin/users_admin.USER_ROWS and
app.agents.memory.store.drop_conversation delete explicitly.

Shared with plan A3 (agents-tutor): A3 appends `agent_tutor_sessions` at the two marked lines below before 0016 is
ever deployed (plan A2 ruling R-M1). Do not deploy between the A2 and A3 merges.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0016'
down_revision: Union[str, Sequence[str], None] = '0015'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)


def _user(primary_key: bool = False) -> sa.Column:
    return sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=primary_key,
                     nullable=False)


def _conversation() -> sa.Column:
    return sa.Column('conversation_id', sa.String(36), sa.ForeignKey('conversations.id', ondelete='CASCADE'),
                     nullable=True)


def upgrade() -> None:
    op.create_table(
        'agent_memory_items',
        sa.Column('id', sa.String(36), primary_key=True),
        _user(),
        sa.Column('persona_id', sa.String(64), nullable=True),
        sa.Column('kind', sa.String(16), nullable=False),
        sa.Column('text', sa.String(200), nullable=False),
        sa.Column('text_hash', sa.String(64), nullable=False),
        sa.Column('importance', sa.Integer(), nullable=False),
        sa.Column('pinned', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('source', sa.String(16), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
        sa.Column('last_used_at', TZ, nullable=True),
        sa.UniqueConstraint('user_id', 'text_hash', name='uq_agent_memory_items_user_hash'),
    )
    op.create_index('ix_agent_memory_items_user_id_persona_id', 'agent_memory_items', ['user_id', 'persona_id'])
    op.create_table(
        'agent_profiles',
        _user(primary_key=True),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.Column('edited_keys', sa.JSON(), nullable=False),
        sa.Column('proposals', sa.JSON(), nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
    )
    op.create_table(
        'agent_thread_states',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        _user(),
        _conversation(),
        sa.Column('room_id', sa.String(36), sa.ForeignKey('rooms.id', ondelete='CASCADE'), nullable=True),
        sa.Column('summary', sa.Text(), nullable=False),
        sa.Column('summarized_count', sa.Integer(), nullable=False),
        sa.Column('rolls_since_recap', sa.Integer(), nullable=False),
        sa.Column('turns_since_extract', sa.Integer(), nullable=False),
        sa.Column('pending_texts', sa.JSON(), nullable=False),
        sa.Column('segment_started_at', TZ, nullable=True),
        sa.Column('last_turn_at', TZ, nullable=True),
        sa.Column('updated_at', TZ, nullable=False),
        sa.UniqueConstraint('user_id', 'conversation_id', name='uq_agent_thread_states_user_conversation'),
        sa.UniqueConstraint('user_id', 'room_id', name='uq_agent_thread_states_user_room'),
    )
    op.create_index('ix_agent_thread_states_conversation_id', 'agent_thread_states', ['conversation_id'])
    op.create_table(
        'agent_recaps',
        sa.Column('id', sa.String(36), primary_key=True),
        _user(),
        sa.Column('persona_id', sa.String(64), nullable=True),
        _conversation(),
        sa.Column('tutor_session_id', sa.String(36), nullable=True),
        sa.Column('source', sa.String(16), nullable=False),
        sa.Column('text', sa.String(400), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
    )
    op.create_index('ix_agent_recaps_user_id_created_at', 'agent_recaps', ['user_id', 'created_at'])
    op.create_index('ix_agent_recaps_conversation_id', 'agent_recaps', ['conversation_id'])
    op.create_table(
        'agent_memory_tombstones',
        _user(primary_key=True),
        sa.Column('text_hash', sa.String(64), primary_key=True),
        sa.Column('created_at', TZ, nullable=False),
    )
    # ---- A3 (agents-tutor): append op.create_table('agent_tutor_sessions', ...) and its indexes below this line ----
    op.create_table(
        'agent_tutor_sessions',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('conversation_id', sa.String(36), sa.ForeignKey('conversations.id', ondelete='CASCADE'),
                  nullable=True),
        sa.Column('room_id', sa.String(36), nullable=True),
        sa.Column('persona_id', sa.String(64), nullable=False),
        sa.Column('client_start_id', sa.String(36), nullable=False),
        sa.Column('status', sa.String(8), nullable=False),
        sa.Column('goal', sa.JSON(), nullable=False),
        sa.Column('state', sa.JSON(), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('recap', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('user_id', 'client_start_id', name='uq_agent_tutor_sessions_user_start'),
    )
    op.create_index('ix_agent_tutor_sessions_user_id_conversation_id_status', 'agent_tutor_sessions',
                    ['user_id', 'conversation_id', 'status'])
    op.create_index('ix_agent_tutor_sessions_user_id_created_at', 'agent_tutor_sessions', ['user_id', 'created_at'])


def downgrade() -> None:
    # ---- A3 (agents-tutor): drop agent_tutor_sessions and its indexes above this line ----
    op.drop_index('ix_agent_tutor_sessions_user_id_created_at', table_name='agent_tutor_sessions')
    op.drop_index('ix_agent_tutor_sessions_user_id_conversation_id_status', table_name='agent_tutor_sessions')
    op.drop_table('agent_tutor_sessions')
    op.drop_table('agent_memory_tombstones')
    op.drop_index('ix_agent_recaps_conversation_id', table_name='agent_recaps')
    op.drop_index('ix_agent_recaps_user_id_created_at', table_name='agent_recaps')
    op.drop_table('agent_recaps')
    op.drop_index('ix_agent_thread_states_conversation_id', table_name='agent_thread_states')
    op.drop_table('agent_thread_states')
    op.drop_table('agent_profiles')
    op.drop_index('ix_agent_memory_items_user_id_persona_id', table_name='agent_memory_items')
    op.drop_table('agent_memory_items')
