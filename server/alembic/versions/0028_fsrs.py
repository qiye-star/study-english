"""FSRS scheduling state and the review timestamp (spec 2026-10-21 §2.3; L3 plan R7, R8)

Revision ID: 0028
Revises: 0027
Create Date: 2026-10-21 09:00:00.000000

Adds, all nullable:
  vocabulary_items: stability FLOAT, difficulty FLOAT, fsrs_state SMALLINT, last_review TIMESTAMPTZ
  wordbook_events:  reviewed_at TIMESTAMPTZ (the time an event actually changed a card's schedule, R8)

Backfill (runs once, only writes the new columns; no existing column is ever read-modified):
  - rows with reps > 0: stability = INTERVAL_DAYS of the box (box <= 0 -> 1, 1..5 -> 2,4,7,15,30, above 5 -> 30),
    difficulty = 2.1181 (D0(Good) of fsrs 6.3.2 defaults, a literal here so this file never imports fsrs),
    fsrs_state = 2 (Review), last_review = COALESCE(last_reviewed_at, created_at);
  - rows with reps = 0: left NULL; the first review seeds them from the box (plan R6), the same as new words;
  - wordbook_events with kind = 'review': reviewed_at = created_at; other kinds stay NULL.

Reversibility: upgrade only adds columns and writes only those new columns. downgrade drops the five new columns,
so box, due_at, reps, lapses and last_reviewed_at survive exactly. What is lost is the FSRS state accumulated after
the upgrade and the reviewed_at stamps; those can be re-seeded from the Leitner columns, but the history cannot.

SQLite uses batch_alter_table (ALTER TABLE ADD COLUMN is not enough there, and batch also recreates the table on
drop); Postgres takes the same path. The backfill is plain SQL, so it runs unchanged on both.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0028'
down_revision: Union[str, Sequence[str], None] = '0027'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('vocabulary_items') as batch:
        batch.add_column(sa.Column('stability', sa.Float(), nullable=True))
        batch.add_column(sa.Column('difficulty', sa.Float(), nullable=True))
        batch.add_column(sa.Column('fsrs_state', sa.SmallInteger(), nullable=True))
        batch.add_column(sa.Column('last_review', sa.DateTime(timezone=True), nullable=True))
    with op.batch_alter_table('wordbook_events') as batch:
        batch.add_column(sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True))

    op.execute(
        """
        UPDATE vocabulary_items
        SET stability = CASE
                WHEN box <= 0 THEN 1.0
                WHEN box = 1 THEN 2.0
                WHEN box = 2 THEN 4.0
                WHEN box = 3 THEN 7.0
                WHEN box = 4 THEN 15.0
                ELSE 30.0
            END,
            difficulty = 2.1181,
            fsrs_state = 2,
            last_review = COALESCE(last_reviewed_at, created_at)
        WHERE reps > 0
        """
    )
    op.execute("UPDATE wordbook_events SET reviewed_at = created_at WHERE kind = 'review'")


def downgrade() -> None:
    with op.batch_alter_table('wordbook_events') as batch:
        batch.drop_column('reviewed_at')
    with op.batch_alter_table('vocabulary_items') as batch:
        batch.drop_column('last_review')
        batch.drop_column('fsrs_state')
        batch.drop_column('difficulty')
        batch.drop_column('stability')
