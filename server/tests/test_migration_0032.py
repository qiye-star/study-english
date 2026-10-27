"""Migration 0032 (plan 2026-10-27 S3): the wordbook_simple_defs cache table. Global cache, no user column."""
import sqlite3
from pathlib import Path

import pytest
from alembic import command
from alembic.script import ScriptDirectory

from tests.test_migrations import _config, _tables


def _indexes(db: Path, table: str) -> set[str]:
    con = sqlite3.connect(db)
    try:
        return {row[1] for row in con.execute(f"PRAGMA index_list({table})")}
    finally:
        con.close()


def _columns(db: Path, table: str) -> set[str]:
    con = sqlite3.connect(db)
    try:
        return {row[1] for row in con.execute(f"PRAGMA table_info({table})")}
    finally:
        con.close()


def _insert(db: Path, word: str, pos: str, src_hash: str) -> None:
    now = "2026-10-27 00:00:00"
    con = sqlite3.connect(db)
    try:
        con.execute(
            "INSERT INTO wordbook_simple_defs (word, pos, src_hash, text, status, attempts, model, created_at, updated_at)"
            " VALUES (?, ?, ?, 'x', 'ok', 0, 'm', ?, ?)", (word, pos, src_hash, now, now))
        con.commit()
    finally:
        con.close()


def test_0032_wordbook_simple_defs_follows_0031_and_0033_is_head(tmp_path, monkeypatch):
    cfg, _ = _config(tmp_path, monkeypatch)
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0033"]
    assert script.get_revision("0032").down_revision == "0031"


def test_upgrade_creates_table_columns_unique_and_index(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "head")
    assert "wordbook_simple_defs" in _tables(db)
    assert _columns(db, "wordbook_simple_defs") == {
        "id", "word", "pos", "src_hash", "text", "status", "attempts", "retry_after", "model", "prompt_version",
        "created_at", "updated_at"}
    con = sqlite3.connect(db)
    try:
        assert any(row[2] for row in con.execute("PRAGMA index_list(wordbook_simple_defs)"))  # the unique constraint
    finally:
        con.close()
    assert "ix_wordbook_simple_defs_status" in _indexes(db, "wordbook_simple_defs")
    assert "user_id" not in _columns(db, "wordbook_simple_defs")


def test_same_word_pos_and_source_hash_is_unique(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "head")
    _insert(db, "abate", "v", "0123456789abcdef")
    with pytest.raises(sqlite3.IntegrityError):
        _insert(db, "abate", "v", "0123456789abcdef")
    _insert(db, "abate", "v", "fedcba9876543210")  # a changed source text is a new row


def test_downgrade_drops_only_the_new_table(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "head")
    before = _tables(db) - {"wordbook_simple_defs"}
    command.downgrade(cfg, "0031")
    assert "wordbook_simple_defs" not in _tables(db)
    assert before <= _tables(db)
    command.upgrade(cfg, "head")
    assert "wordbook_simple_defs" in _tables(db)
