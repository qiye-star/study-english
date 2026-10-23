"""Migration 0028 (L3 Task 5): FSRS columns on vocabulary_items, the review timestamp on wordbook_events, and the backfill.

The Leitner columns (box, due_at, reps, lapses, last_reviewed_at) must be byte-identical before and after upgrade and
downgrade; that is the reversibility promise in the plan (R7).
"""
import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config

from tests.test_migrations import _config  # shared SQLite temp-database setup

ROOT = Path(__file__).resolve().parent.parent
LEGACY = ("box", "due_at", "reps", "lapses", "last_reviewed_at")
NEW_VOCAB = ("stability", "difficulty", "fsrs_state", "last_review")
LEGACY_DIFFICULTY = 2.1181

T_REV = "2026-10-01 09:00:00"
T_CREATED = "2026-09-01 08:00:00"


def _columns(db: Path, table: str) -> set[str]:
    con = sqlite3.connect(db)
    try:
        return {row[1] for row in con.execute(f"PRAGMA table_info({table})")}
    finally:
        con.close()


def _seed_0027(db: Path) -> None:
    con = sqlite3.connect(db)
    vocab = (
        # id, box, due_at, reps, lapses, last_reviewed_at, created_at
        ("v-new-box2", 2, "2026-10-05 00:00:00", 0, 0, None, T_CREATED),  # reps 0: stays NULL
        ("v-reviewed-box0", 0, "2026-10-02 00:00:00", 3, 2, T_REV, T_CREATED),
        ("v-reviewed-box3", 3, "2026-10-06 00:00:00", 3, 0, None, T_CREATED),  # no last_reviewed_at: created_at
        ("v-reviewed-box5", 5, "2026-11-01 00:00:00", 4, 1, T_REV, T_CREATED),
        ("v-reviewed-box7", 7, "2026-11-01 00:00:00", 3, 0, T_REV, T_CREATED),  # out of range: 30
    )
    for row in vocab:
        con.execute(
            "INSERT INTO vocabulary_items (id, user_id, word, meaning, example, source, box, due_at, reps, lapses,"
            " last_reviewed_at, created_at) VALUES (?, 1, ?, '', NULL, 'manual', ?, ?, ?, ?, ?, ?)",
            (row[0], row[0], row[1], row[2], row[3], row[4], row[5], row[6]),
        )
    events = (
        ("review", "2026-10-01 09:00:00"),
        ("practice", "2026-10-01 10:00:00"),
    )
    for kind, created in events:
        con.execute(
            "INSERT INTO wordbook_events (user_id, book_id, kind, word, item_id, qtype, outcome, credit, day, created_at)"
            " VALUES (1, 'cet4', ?, 'w', NULL, 'choice', 'correct', 100, '2026-10-01', ?)",
            (kind, created),
        )
    con.commit()
    con.close()


def _legacy_snapshot(db: Path) -> list[tuple]:
    con = sqlite3.connect(db)
    try:
        return list(con.execute(
            "SELECT id, box, due_at, reps, lapses, last_reviewed_at FROM vocabulary_items ORDER BY id"
        ))
    finally:
        con.close()


def _new_snapshot(db: Path) -> list[tuple]:
    con = sqlite3.connect(db)
    try:
        return list(con.execute(
            "SELECT id, stability, difficulty, fsrs_state, last_review FROM vocabulary_items ORDER BY id"
        ))
    finally:
        con.close()


def _event_snapshot(db: Path) -> list[tuple]:
    con = sqlite3.connect(db)
    try:
        return list(con.execute("SELECT kind, created_at, reviewed_at FROM wordbook_events ORDER BY id"))
    finally:
        con.close()


def test_upgrade_adds_the_columns_and_backfills_reviewed_rows(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0027")
    _seed_0027(db)
    before_legacy = _legacy_snapshot(db)
    command.upgrade(cfg, "0028")

    assert set(NEW_VOCAB) <= _columns(db, "vocabulary_items")
    assert "reviewed_at" in _columns(db, "wordbook_events")

    rows = {r[0]: r[1:] for r in _new_snapshot(db)}
    assert rows["v-new-box2"] == (None, None, None, None)  # reps 0 keeps NULL (seeded on the next review, R6)
    assert rows["v-reviewed-box0"] == (1.0, LEGACY_DIFFICULTY, 2, "2026-10-01 09:00:00")
    assert rows["v-reviewed-box3"] == (7.0, LEGACY_DIFFICULTY, 2, T_CREATED)  # COALESCE(last_reviewed_at, created_at)
    assert rows["v-reviewed-box5"] == (30.0, LEGACY_DIFFICULTY, 2, "2026-10-01 09:00:00")
    assert rows["v-reviewed-box7"] == (30.0, LEGACY_DIFFICULTY, 2, "2026-10-01 09:00:00")  # box > 5 caps at 30

    assert _legacy_snapshot(db) == before_legacy  # the Leitner columns are untouched

    events = _event_snapshot(db)
    assert events == [("review", "2026-10-01 09:00:00", "2026-10-01 09:00:00"), ("practice", "2026-10-01 10:00:00", None)]


def test_downgrade_drops_the_columns_and_keeps_the_leitner_state(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0027")
    _seed_0027(db)
    before_legacy = _legacy_snapshot(db)
    command.upgrade(cfg, "0028")
    first_new = _new_snapshot(db)
    command.downgrade(cfg, "0027")

    assert not (set(NEW_VOCAB) & _columns(db, "vocabulary_items"))
    assert "reviewed_at" not in _columns(db, "wordbook_events")
    assert _legacy_snapshot(db) == before_legacy

    command.upgrade(cfg, "0028")  # a second upgrade gives the same backfill
    assert _new_snapshot(db) == first_new
    assert _legacy_snapshot(db) == before_legacy


def test_the_migration_chain_has_one_head(tmp_path, monkeypatch):
    from alembic.script import ScriptDirectory

    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    assert ScriptDirectory.from_config(cfg).get_heads() == ["0031"]  # head moves with each later migration
