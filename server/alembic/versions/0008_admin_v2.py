"""admin console v2: admin accounts/sessions/audit, setting overrides, rank rule sets, prompts, usage, quotas, invites

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-09 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0008'
down_revision: Union[str, Sequence[str], None] = '0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)
OPEN = "status IN ('active', 'grading_failed')"  # 0007's partial unique index on promotion_matches

NEW_TABLES = (
    'invite_codes', 'user_quota_overrides', 'usage_daily', 'upstream_calls', 'announcements', 'prompt_versions',
    'rank_profile_snapshots', 'rank_rule_sets', 'config_revisions', 'setting_revisions', 'setting_overrides',
    'admin_audit', 'admin_recovery_codes', 'admin_login_state', 'admin_sessions', 'admin_accounts',
)


def upgrade() -> None:
    with op.batch_alter_table('users') as b:
        b.add_column(sa.Column('disabled_at', TZ, nullable=True))
    with op.batch_alter_table('promotion_matches') as b:
        b.add_column(sa.Column('rules_version', sa.Integer(), nullable=True))
    with op.batch_alter_table('rooms') as b:
        b.add_column(sa.Column('ai_muted', sa.Boolean(), nullable=False, server_default=sa.false()))
    with op.batch_alter_table('room_messages') as b:
        b.add_column(sa.Column('hidden_at', TZ, nullable=True))
    with op.batch_alter_table('room_reports') as b:
        b.add_column(sa.Column('resolved_at', TZ, nullable=True))
        b.add_column(sa.Column('resolved_by', sa.String(length=32), nullable=True))
        b.add_column(sa.Column('resolution', sa.String(length=16), nullable=True))

    op.create_table('admin_accounts',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('username', sa.String(length=32), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('role', sa.String(length=16), nullable=False),
        sa.Column('totp_enc', sa.Text(), nullable=True),
        sa.Column('totp_last_step', sa.Integer(), nullable=True),
        sa.Column('disabled_at', TZ, nullable=True),
        sa.Column('created_by', sa.String(length=64), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('last_login_at', TZ, nullable=True),
        sa.Column('password_changed_at', TZ, nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('username'))
    op.create_table('admin_sessions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=True),
        sa.Column('username', sa.String(length=32), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('last_seen_at', TZ, nullable=False),
        sa.Column('expires_at', TZ, nullable=False),
        sa.Column('ip', sa.String(length=64), nullable=False),
        sa.Column('user_agent', sa.String(length=120), nullable=False),
        sa.Column('mfa_at', TZ, nullable=True),
        sa.Column('step_up_at', TZ, nullable=True),
        sa.Column('csrf_hash', sa.String(length=64), nullable=False),
        sa.Column('revoked_at', TZ, nullable=True),
        sa.ForeignKeyConstraint(['account_id'], ['admin_accounts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token_hash'))
    with op.batch_alter_table('admin_sessions') as b:
        b.create_index(b.f('ix_admin_sessions_account_id'), ['account_id'], unique=False)
    op.create_table('admin_login_state',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('username', sa.String(length=64), nullable=False),
        sa.Column('ip', sa.String(length=64), nullable=False),
        sa.Column('failures', sa.Integer(), nullable=False),
        sa.Column('lock_level', sa.Integer(), nullable=False),
        sa.Column('locked_until', TZ, nullable=True),
        sa.Column('updated_at', TZ, nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('username', 'ip', name='uq_admin_login_state_username_ip'))
    op.create_table('admin_recovery_codes',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=False),
        sa.Column('code_hash', sa.String(length=255), nullable=False),
        sa.Column('used_at', TZ, nullable=True),
        sa.ForeignKeyConstraint(['account_id'], ['admin_accounts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'))
    with op.batch_alter_table('admin_recovery_codes') as b:
        b.create_index(b.f('ix_admin_recovery_codes_account_id'), ['account_id'], unique=False)
    op.create_table('admin_audit',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('at', TZ, nullable=False),
        sa.Column('actor', sa.String(length=64), nullable=False),
        sa.Column('role', sa.String(length=16), nullable=False),
        sa.Column('session_id', sa.String(length=36), nullable=True),
        sa.Column('ip', sa.String(length=64), nullable=False),
        sa.Column('action', sa.String(length=48), nullable=False),
        sa.Column('target_type', sa.String(length=32), nullable=True),
        sa.Column('target_id', sa.String(length=64), nullable=True),
        sa.Column('summary', sa.String(length=200), nullable=False),
        sa.Column('before', sa.JSON(), nullable=True),
        sa.Column('after', sa.JSON(), nullable=True),
        sa.Column('reason', sa.String(length=200), nullable=True),
        sa.Column('result', sa.String(length=8), nullable=False),
        sa.Column('prev_hash', sa.String(length=64), nullable=False),
        sa.Column('hash', sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint('id'))
    with op.batch_alter_table('admin_audit') as b:
        b.create_index(b.f('ix_admin_audit_actor'), ['actor'], unique=False)
        b.create_index(b.f('ix_admin_audit_action'), ['action'], unique=False)
        b.create_index('ix_admin_audit_target', ['target_type', 'target_id'], unique=False)
    op.create_table('setting_overrides',
        sa.Column('key', sa.String(length=64), nullable=False),
        sa.Column('value', sa.Text(), nullable=False),
        sa.Column('secret', sa.Boolean(), nullable=False),
        sa.Column('env_fp', sa.String(length=16), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
        sa.Column('updated_by', sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint('key'))
    op.create_table('setting_revisions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('at', TZ, nullable=False),
        sa.Column('actor', sa.String(length=64), nullable=False),
        sa.Column('reason', sa.String(length=200), nullable=False),
        sa.Column('changes', sa.JSON(), nullable=False),
        sa.Column('reverted_by', sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint('id'))
    op.create_table('config_revisions',
        sa.Column('name', sa.String(length=32), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
        sa.PrimaryKeyConstraint('name'))
    op.create_table('rank_rule_sets',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('version', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=12), nullable=False),
        sa.Column('rules', sa.JSON(), nullable=False),
        sa.Column('note', sa.String(length=200), nullable=False),
        sa.Column('created_by', sa.String(length=64), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('published_by', sa.String(length=64), nullable=True),
        sa.Column('published_at', TZ, nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('version'))
    op.create_table('rank_profile_snapshots',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('batch_id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.Column('at', TZ, nullable=False),
        sa.PrimaryKeyConstraint('id'))
    with op.batch_alter_table('rank_profile_snapshots') as b:
        b.create_index(b.f('ix_rank_profile_snapshots_batch_id'), ['batch_id'], unique=False)
    op.create_table('prompt_versions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('key', sa.String(length=48), nullable=False),
        sa.Column('version', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=12), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('note', sa.String(length=200), nullable=False),
        sa.Column('created_by', sa.String(length=64), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('published_by', sa.String(length=64), nullable=True),
        sa.Column('published_at', TZ, nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('key', 'version', name='uq_prompt_versions_key_version'))
    with op.batch_alter_table('prompt_versions') as b:
        b.create_index(b.f('ix_prompt_versions_key'), ['key'], unique=False)
    op.create_table('announcements',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('level', sa.String(length=8), nullable=False),
        sa.Column('text_zh', sa.String(length=280), nullable=False),
        sa.Column('text_en', sa.String(length=280), nullable=False),
        sa.Column('starts_at', TZ, nullable=False),
        sa.Column('ends_at', TZ, nullable=True),
        sa.Column('dismissible', sa.Boolean(), nullable=False),
        sa.Column('created_by', sa.String(length=64), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('archived_at', TZ, nullable=True),
        sa.PrimaryKeyConstraint('id'))
    op.create_table('upstream_calls',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('at', TZ, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('feature', sa.String(length=16), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('provider', sa.String(length=32), nullable=False),
        sa.Column('model', sa.String(length=64), nullable=False),
        sa.Column('status', sa.Integer(), nullable=False),
        sa.Column('ms', sa.Integer(), nullable=False),
        sa.Column('units_in', sa.Integer(), nullable=False),
        sa.Column('units_out', sa.Integer(), nullable=False),
        sa.Column('unit', sa.String(length=8), nullable=False),
        sa.PrimaryKeyConstraint('id'))
    with op.batch_alter_table('upstream_calls') as b:
        b.create_index(b.f('ix_upstream_calls_at'), ['at'], unique=False)
        b.create_index('ix_upstream_calls_user_id_at', ['user_id', 'at'], unique=False)
    op.create_table('usage_daily',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('day', sa.String(length=10), nullable=False),
        sa.Column('feature', sa.String(length=16), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('provider', sa.String(length=32), nullable=False),
        sa.Column('model', sa.String(length=64), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('calls', sa.Integer(), nullable=False),
        sa.Column('errors', sa.Integer(), nullable=False),
        sa.Column('units_in', sa.Integer(), nullable=False),
        sa.Column('units_out', sa.Integer(), nullable=False),
        sa.Column('ms_total', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('day', 'feature', 'kind', 'provider', 'model', 'user_id', name='uq_usage_daily_bucket'))
    with op.batch_alter_table('usage_daily') as b:
        b.create_index(b.f('ix_usage_daily_day'), ['day'], unique=False)
    op.create_table('user_quota_overrides',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(length=40), nullable=False),
        sa.Column('value', sa.Integer(), nullable=False),
        sa.Column('expires_at', TZ, nullable=True),
        sa.Column('note', sa.String(length=200), nullable=False),
        sa.Column('updated_by', sa.String(length=64), nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'key'))
    op.create_table('invite_codes',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('code_hash', sa.String(length=64), nullable=False),
        sa.Column('label', sa.String(length=64), nullable=False),
        sa.Column('max_uses', sa.Integer(), nullable=False),
        sa.Column('uses', sa.Integer(), nullable=False),
        sa.Column('expires_at', TZ, nullable=True),
        sa.Column('created_by', sa.String(length=64), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('revoked_at', TZ, nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code_hash'))


def downgrade() -> None:
    for table in NEW_TABLES:
        op.drop_table(table)
    with op.batch_alter_table('room_reports') as b:
        b.drop_column('resolution')
        b.drop_column('resolved_by')
        b.drop_column('resolved_at')
    with op.batch_alter_table('room_messages') as b:
        b.drop_column('hidden_at')
    with op.batch_alter_table('rooms') as b:
        b.drop_column('ai_muted')
    # A SQLite batch rebuild would not carry 0007's partial unique index over reliably: drop it and recreate it.
    op.drop_index('uq_promotion_matches_user_open', table_name='promotion_matches')
    with op.batch_alter_table('promotion_matches') as b:
        b.drop_column('rules_version')
    op.create_index('uq_promotion_matches_user_open', 'promotion_matches', ['user_id'], unique=True,
                    sqlite_where=sa.text(OPEN), postgresql_where=sa.text(OPEN))
    with op.batch_alter_table('users') as b:
        b.drop_column('disabled_at')
