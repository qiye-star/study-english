"""rooms v2: room settings, voice messages, reactions, join requests, summaries

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-10 09:00:00.000000

Written as 0010 after 0008; renumbered to 0011 after 0010 when admin-v2-plan merged (it carries 0009 room owner
SET NULL and 0010 admin review fixes). Rooms whose owner was deleted (owner_id NULL since 0009) are named "房间".
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0011'
down_revision: Union[str, Sequence[str], None] = '0010'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)
ROOM_COLUMNS = ('invite_token', 'allow_voice', 'max_members', 'join_mode', 'level', 'scenario', 'name')


def upgrade() -> None:
    with op.batch_alter_table('rooms') as b:
        b.add_column(sa.Column('name', sa.String(30), nullable=False, server_default=''))
        b.add_column(sa.Column('scenario', sa.String(24), nullable=False, server_default='free'))
        b.add_column(sa.Column('level', sa.String(2), nullable=False, server_default='B1'))
        b.add_column(sa.Column('join_mode', sa.String(8), nullable=False, server_default='code'))
        b.add_column(sa.Column('max_members', sa.Integer(), nullable=False, server_default='4'))
        b.add_column(sa.Column('allow_voice', sa.Boolean(), nullable=False, server_default=sa.true()))
        b.add_column(sa.Column('invite_token', sa.String(32), nullable=True))
        b.create_unique_constraint('uq_rooms_invite_token', ['invite_token'])
    # v1 rooms keep the v1 site cap; names: topic, else "<owner>的房间" (spec §3.1 R2-1)
    op.execute("UPDATE rooms SET max_members = 8")
    op.execute("UPDATE rooms SET name = substr(topic, 1, 30) WHERE topic IS NOT NULL AND topic != ''")
    op.execute("UPDATE rooms SET name = substr(COALESCE((SELECT username FROM users WHERE users.id = rooms.owner_id)"
               " || '的房间', '房间'), 1, 30) WHERE name = ''")
    op.create_table(
        'room_voice',
        sa.Column('message_id', sa.String(36), sa.ForeignKey('room_messages.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('room_id', sa.String(36), sa.ForeignKey('rooms.id', ondelete='CASCADE'), nullable=False),
        sa.Column('sender_id', sa.Integer(), nullable=False),
        sa.Column('duration_ms', sa.Integer(), nullable=False),
        sa.Column('audio_path', sa.String(200), nullable=True),
        sa.Column('audio_bytes', sa.Integer(), nullable=False),
        sa.Column('audio_format', sa.String(8), nullable=False),
        sa.Column('staging_path', sa.String(200), nullable=True),
        sa.Column('status', sa.String(8), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('transcript', sa.Text(), nullable=True),
        sa.Column('lang', sa.String(2), nullable=True),
        sa.Column('translation', sa.Text(), nullable=True),
        sa.Column('translation_status', sa.String(8), nullable=True),
        sa.Column('translation_attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('transcribed_at', TZ, nullable=True),
        sa.Column('purged_at', TZ, nullable=True),
    )
    op.create_index('ix_room_voice_room_id', 'room_voice', ['room_id'])
    op.create_index('ix_room_voice_sender_id_created_at', 'room_voice', ['sender_id', 'created_at'])
    op.create_table(
        'room_reactions',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('room_id', sa.String(36), sa.ForeignKey('rooms.id', ondelete='CASCADE'), nullable=False),
        sa.Column('message_id', sa.String(36), sa.ForeignKey('room_messages.id', ondelete='CASCADE'), nullable=False),
        sa.Column('seq', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(8), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.UniqueConstraint('message_id', 'user_id', 'key', name='uq_room_reactions_message_user_key'),
    )
    op.create_index('ix_room_reactions_room_id_seq', 'room_reactions', ['room_id', 'seq'])
    op.create_table(
        'room_join_requests',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('room_id', sa.String(36), sa.ForeignKey('rooms.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('status', sa.String(10), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('decided_at', TZ, nullable=True),
        sa.Column('decided_by', sa.Integer(), nullable=True),
    )
    op.create_index('ix_room_join_requests_room_id_status', 'room_join_requests', ['room_id', 'status'])
    op.create_index('ix_room_join_requests_user_id_status', 'room_join_requests', ['user_id', 'status'])
    op.create_table(
        'room_summaries',
        sa.Column('room_id', sa.String(36), sa.ForeignKey('rooms.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('status', sa.String(8), nullable=False),
        sa.Column('reason', sa.String(16), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('data', sa.JSON(), nullable=True),
        sa.Column('model', sa.String(64), nullable=True),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('finished_at', TZ, nullable=True),
    )


def downgrade() -> None:
    op.drop_table('room_summaries')
    op.drop_index('ix_room_join_requests_user_id_status', table_name='room_join_requests')
    op.drop_index('ix_room_join_requests_room_id_status', table_name='room_join_requests')
    op.drop_table('room_join_requests')
    op.drop_index('ix_room_reactions_room_id_seq', table_name='room_reactions')
    op.drop_table('room_reactions')
    op.drop_index('ix_room_voice_sender_id_created_at', table_name='room_voice')
    op.drop_index('ix_room_voice_room_id', table_name='room_voice')
    op.drop_table('room_voice')
    with op.batch_alter_table('rooms') as b:
        b.drop_constraint('uq_rooms_invite_token', type_='unique')
        for name in ROOM_COLUMNS:
            b.drop_column(name)
