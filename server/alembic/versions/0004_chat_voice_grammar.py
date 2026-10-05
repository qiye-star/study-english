"""chat voice, grammar and practice items

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-05 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FK_NAME = 'fk_messages_assessment_id_assessments'


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('grammar_prompt', sa.Text(), nullable=True))

    with op.batch_alter_table('assessments', schema=None) as batch_op:
        batch_op.add_column(sa.Column('source', sa.String(length=16), server_default='practice', nullable=False))

    # SQLite 不能 ALTER 加外键:batch 模式会重建 messages 表并拷贝数据;Postgres 上是普通 ALTER。
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.add_column(sa.Column('assessment_id', sa.String(length=36), nullable=True))
        batch_op.add_column(sa.Column('grammar', sa.JSON(), nullable=True))
        batch_op.create_index(batch_op.f('ix_messages_assessment_id'), ['assessment_id'], unique=False)
        batch_op.create_foreign_key(FK_NAME, 'assessments', ['assessment_id'], ['id'], ondelete='SET NULL')

    op.create_table('practice_items',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('practice_items', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_practice_items_user_id'), ['user_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('practice_items', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_practice_items_user_id'))
    op.drop_table('practice_items')

    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.drop_constraint(FK_NAME, type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_messages_assessment_id'))
        batch_op.drop_column('grammar')
        batch_op.drop_column('assessment_id')

    with op.batch_alter_table('assessments', schema=None) as batch_op:
        batch_op.drop_column('source')

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('grammar_prompt')
