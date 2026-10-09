"""rooms.owner_id nullable, ON DELETE SET NULL: deleting a user never deletes rooms or their messages

Owner ruling (admin console v2 integration): room messages are kept forever. A room whose owner is deleted and
that nobody else joined stays as a closed, read-only room without owner (the admin console shows 已删除用户).

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-09 23:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0009'
down_revision: Union[str, Sequence[str], None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OWNER_FK = 'fk_rooms_owner_id_users'  # named by 0007 on both SQLite and Postgres
# Names the FK as SQLite reflects it, so batch mode can drop it (same convention as 0007).
NAMING = {"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}


def _owner(ondelete: str, nullable: bool) -> None:
    """SQLite rebuilds `rooms` in batch mode (FKs are not enforced here, so the rebuild cascades nothing);
    Postgres swaps the constraint and the column's NULL rule in place."""
    if op.get_bind().dialect.name == 'sqlite':
        with op.batch_alter_table('rooms', naming_convention=NAMING) as b:
            b.drop_constraint(OWNER_FK, type_='foreignkey')
            b.alter_column('owner_id', existing_type=sa.Integer(), nullable=nullable)
            b.create_foreign_key(OWNER_FK, 'users', ['owner_id'], ['id'], ondelete=ondelete)
    else:
        op.drop_constraint(OWNER_FK, 'rooms', type_='foreignkey')
        op.alter_column('rooms', 'owner_id', existing_type=sa.Integer(), nullable=nullable)
        op.create_foreign_key(OWNER_FK, 'rooms', 'users', ['owner_id'], ['id'], ondelete=ondelete)


def upgrade() -> None:
    _owner('SET NULL', True)


def downgrade() -> None:
    ownerless = op.get_bind().execute(sa.text("SELECT COUNT(*) FROM rooms WHERE owner_id IS NULL")).scalar()
    if ownerless:
        # never delete kept rooms/messages to satisfy NOT NULL; an operator must assign owners first
        raise RuntimeError(f"{ownerless} ownerless rooms (owner deleted) block the downgrade; assign an owner_id first")
    _owner('RESTRICT', False)
