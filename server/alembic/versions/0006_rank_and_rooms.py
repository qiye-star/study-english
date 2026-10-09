"""rank and rooms

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-09 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0006'
down_revision: Union[str, Sequence[str], None] = '0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table('rank_profiles',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('tier', sa.Integer(), nullable=False),
        sa.Column('division', sa.Integer(), nullable=False),
        sa.Column('rp', sa.Integer(), nullable=False),
        sa.Column('stars', sa.Integer(), nullable=False),
        sa.Column('best_tier', sa.Integer(), nullable=False),
        sa.Column('tier_started_at', TZ, nullable=False),
        sa.Column('synced_at', TZ, nullable=True),
        sa.Column('cooldown_until', TZ, nullable=True),
        sa.Column('updated_at', TZ, nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'))
    op.create_table('xp_events',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('ref_id', sa.String(length=80), nullable=False),
        sa.Column('points', sa.Integer(), nullable=False),
        sa.Column('score', sa.Integer(), nullable=True),
        sa.Column('day', sa.String(length=10), nullable=False),
        sa.Column('tier', sa.Integer(), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'kind', 'ref_id', name='uq_xp_events_user_kind_ref'))
    with op.batch_alter_table('xp_events') as b:
        b.create_index('ix_xp_events_user_id_day', ['user_id', 'day'], unique=False)
        b.create_index('ix_xp_events_user_id_created_at', ['user_id', 'created_at'], unique=False)
    op.create_table('promotion_matches',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('from_tier', sa.Integer(), nullable=False),
        sa.Column('to_tier', sa.Integer(), nullable=False),
        sa.Column('scenario_key', sa.String(length=64), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('turn_limit', sa.Integer(), nullable=False),
        sa.Column('turns', sa.JSON(), nullable=False),
        sa.Column('result', sa.JSON(), nullable=True),
        sa.Column('total', sa.Integer(), nullable=True),
        sa.Column('threshold', sa.Integer(), nullable=False),
        sa.Column('attempt_no', sa.Integer(), nullable=False),
        sa.Column('started_at', TZ, nullable=False),
        sa.Column('expires_at', TZ, nullable=False),
        sa.Column('finished_at', TZ, nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'))
    with op.batch_alter_table('promotion_matches') as b:
        b.create_index(b.f('ix_promotion_matches_user_id'), ['user_id'], unique=False)
        b.create_index('ix_promotion_matches_user_id_started_at', ['user_id', 'started_at'], unique=False)
    op.create_table('user_achievements',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(length=48), nullable=False),
        sa.Column('unlocked_at', TZ, nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'key', name='uq_user_achievements_user_key'))
    with op.batch_alter_table('user_achievements') as b:
        b.create_index(b.f('ix_user_achievements_user_id'), ['user_id'], unique=False)
    op.create_table('daily_usage',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('scope', sa.String(length=32), nullable=False),
        sa.Column('subject', sa.String(length=64), nullable=False),
        sa.Column('day', sa.String(length=10), nullable=False),
        sa.Column('count', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('scope', 'subject', 'day', name='uq_daily_usage_scope_subject_day'))
    op.create_table('rooms',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('code', sa.String(length=6), nullable=True),
        sa.Column('last_code', sa.String(length=6), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('topic', sa.String(length=100), nullable=False),
        sa.Column('status', sa.String(length=8), nullable=False),
        sa.Column('locked', sa.Boolean(), nullable=False),
        sa.Column('ai_public', sa.Boolean(), nullable=False),
        sa.Column('last_seq', sa.Integer(), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('last_active_at', TZ, nullable=False),
        sa.Column('closed_at', TZ, nullable=True),
        sa.Column('close_reason', sa.String(length=16), nullable=True),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code'))
    with op.batch_alter_table('rooms') as b:
        b.create_index(b.f('ix_rooms_owner_id'), ['owner_id'], unique=False)
        b.create_index('ix_rooms_status_last_active_at', ['status', 'last_active_at'], unique=False)
    op.create_table('room_members',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('room_id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('role', sa.String(length=8), nullable=False),
        sa.Column('joined_at', TZ, nullable=False),
        sa.Column('left_at', TZ, nullable=True),
        sa.Column('kicked', sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('room_id', 'user_id', name='uq_room_members_room_user'))
    with op.batch_alter_table('room_members') as b:
        b.create_index(b.f('ix_room_members_user_id'), ['user_id'], unique=False)
    op.create_table('room_messages',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('room_id', sa.String(length=36), nullable=False),
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.Column('lane', sa.String(length=8), nullable=False),
        sa.Column('audience_id', sa.Integer(), nullable=True),
        sa.Column('sender_kind', sa.String(length=8), nullable=False),
        sa.Column('sender_id', sa.Integer(), nullable=True),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('assisted', sa.Boolean(), nullable=False),
        sa.Column('reply_to', sa.Integer(), nullable=True),
        sa.Column('ai_status', sa.String(length=8), nullable=True),
        sa.Column('client_id', sa.String(length=64), nullable=True),
        sa.Column('meta', sa.JSON(), nullable=True),
        sa.Column('created_at', TZ, nullable=False),
        sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('room_id', 'seq', name='uq_room_messages_room_seq'))
    with op.batch_alter_table('room_messages') as b:
        b.create_index('ix_room_messages_room_id_audience_id_seq', ['room_id', 'audience_id', 'seq'], unique=False)
        b.create_index('ix_room_messages_sender_id', ['sender_id'], unique=False)
    op.create_table('room_reports',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('room_id', sa.String(length=36), nullable=False),
        sa.Column('message_id', sa.String(length=36), nullable=False),
        sa.Column('reporter_id', sa.Integer(), nullable=False),
        sa.Column('reason', sa.String(length=32), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['reporter_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('message_id', 'reporter_id', name='uq_room_reports_message_reporter'))
    with op.batch_alter_table('room_reports') as b:
        b.create_index(b.f('ix_room_reports_room_id'), ['room_id'], unique=False)


def downgrade() -> None:
    for table in ('room_reports', 'room_messages', 'room_members', 'rooms', 'daily_usage',
                  'user_achievements', 'promotion_matches', 'xp_events', 'rank_profiles'):
        op.drop_table(table)
