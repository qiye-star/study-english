"""invites v2: invite_codes.kind / owner_user_id / code_enc, a partial unique index "one live user code per owner",
and invite_redemptions (plan 2026-10-14-invites-v2 S1; INDEX §3 renumbered 0024 -> 0026, R-I1)

Revision ID: 0026
Revises: 0025
Create Date: 2026-10-19 18:00:00.000000

Existing rows become kind='admin' through the server default; they have no owner and no encrypted copy.
The partial unique index is spelled for both dialects (sqlite_where / postgresql_where) so that SQLite and
Postgres enforce the same rule: at most one un-revoked user code per owner. invite_codes is altered in batch mode
for SQLite; Postgres only adds nullable columns and an index. The downgrade drops the redemptions table and the
three columns; codes that were user codes lose their owner, so the downgrade is only safe before users get codes.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0026'
down_revision: Union[str, Sequence[str], None] = '0025'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LIVE_OWNER = sa.text('revoked_at IS NULL AND owner_user_id IS NOT NULL')


def upgrade() -> None:
    with op.batch_alter_table('invite_codes') as b:
        b.add_column(sa.Column('kind', sa.String(8), nullable=False, server_default='admin'))
        b.add_column(sa.Column('owner_user_id', sa.Integer(), nullable=True))
        b.add_column(sa.Column('code_enc', sa.Text(), nullable=True))
        # named, because batch mode (SQLite rebuild) refuses unnamed constraints
        b.create_foreign_key('fk_invite_codes_owner_user_id', 'users', ['owner_user_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_invite_codes_owner_user_id', 'invite_codes', ['owner_user_id'])
    op.create_index('uq_invite_codes_owner_active', 'invite_codes', ['owner_user_id'], unique=True,
                    sqlite_where=_LIVE_OWNER, postgresql_where=_LIVE_OWNER)

    op.create_table(
        'invite_redemptions',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('code_id', sa.Integer(), sa.ForeignKey('invite_codes.id'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('redeemed_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('user_id', name='uq_invite_redemptions_user_id'),
    )
    op.create_index('ix_invite_redemptions_code_id', 'invite_redemptions', ['code_id'])


def downgrade() -> None:
    op.drop_index('ix_invite_redemptions_code_id', table_name='invite_redemptions')
    op.drop_table('invite_redemptions')

    op.drop_index('uq_invite_codes_owner_active', table_name='invite_codes')
    op.drop_index('ix_invite_codes_owner_user_id', table_name='invite_codes')
    with op.batch_alter_table('invite_codes') as b:
        b.drop_constraint('fk_invite_codes_owner_user_id', type_='foreignkey')
        b.drop_column('code_enc')
        b.drop_column('owner_user_id')
        b.drop_column('kind')
