"""vocabulary items

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-05 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('vocabulary_items',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('word', sa.String(length=100), nullable=False),
    sa.Column('meaning', sa.Text(), nullable=False),
    sa.Column('example', sa.Text(), nullable=True),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.Column('box', sa.Integer(), nullable=False),
    sa.Column('due_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('reps', sa.Integer(), nullable=False),
    sa.Column('lapses', sa.Integer(), nullable=False),
    sa.Column('last_reviewed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('vocabulary_items', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_vocabulary_items_user_id'), ['user_id'], unique=False)
        batch_op.create_index('ix_vocabulary_items_user_id_due_at', ['user_id', 'due_at'], unique=False)
        batch_op.create_index('ix_vocabulary_items_user_id_word', ['user_id', 'word'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('vocabulary_items', schema=None) as batch_op:
        batch_op.drop_index('ix_vocabulary_items_user_id_word')
        batch_op.drop_index('ix_vocabulary_items_user_id_due_at')
        batch_op.drop_index(batch_op.f('ix_vocabulary_items_user_id'))
    op.drop_table('vocabulary_items')
