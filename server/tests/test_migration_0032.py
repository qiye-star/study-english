"""Migration 0032 (plan 2026-10-27-library-local-export-cloud-import S1): catalog_items.source_md5, a nullable,
non-unique column with an index. Existing rows get NULL; downgrade removes the column and index and keeps the rows."""
import sqlite3

from alembic import command
from alembic.script import ScriptDirectory

from tests.test_migrations import _config

MD5 = "0123456789abcdef0123456789abcdef"


def _columns(db, table: str) -> set[str]:
    con = sqlite3.connect(db)
    try:
        return {row[1] for row in con.execute(f"PRAGMA table_info({table})")}
    finally:
        con.close()


def _indexes(db, table: str) -> set[str]:
    con = sqlite3.connect(db)
    try:
        return {row[1] for row in con.execute(f"PRAGMA index_list({table})")}
    finally:
        con.close()


def _insert(db, row_id: str, title: str, source_md5: str | None = None) -> None:
    con = sqlite3.connect(db)
    try:
        cols = "id, title, source, status, created_at, updated_at"
        vals = [row_id, title, "upload", "ready", "2026-10-27 08:00:00", "2026-10-27 08:00:00"]
        if source_md5 is not None:
            cols += ", source_md5"
            vals.append(source_md5)
        con.execute(f"INSERT INTO catalog_items ({cols}) VALUES ({', '.join('?' * len(vals))})", vals)
        con.commit()
    finally:
        con.close()


def test_the_migration_chain_has_head_0032(tmp_path, monkeypatch):
    cfg, _db = _config(tmp_path, monkeypatch)
    assert ScriptDirectory.from_config(cfg).get_heads() == ["0032"]


def test_upgrade_adds_a_nullable_indexed_column_and_keeps_old_rows(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0031")
    _insert(db, "old-row", "Old talk")
    command.upgrade(cfg, "head")
    assert "source_md5" in _columns(db, "catalog_items")
    assert "ix_catalog_items_source_md5" in _indexes(db, "catalog_items")
    con = sqlite3.connect(db)
    try:
        assert con.execute("SELECT title, source_md5 FROM catalog_items WHERE id = 'old-row'").fetchone() == (
            "Old talk", None)
    finally:
        con.close()


def test_the_index_is_not_unique_so_failed_or_retired_rows_can_share_a_package(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "head")
    _insert(db, "a", "First attempt", MD5)
    _insert(db, "b", "Second attempt", MD5)  # no IntegrityError: the index is not unique
    con = sqlite3.connect(db)
    try:
        assert con.execute("SELECT count(*) FROM catalog_items WHERE source_md5 = ?", (MD5,)).fetchone() == (2,)
    finally:
        con.close()


def test_downgrade_removes_the_column_and_index_and_keeps_the_rows(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "head")
    _insert(db, "kept", "Kept talk", MD5)
    command.downgrade(cfg, "0031")
    assert "source_md5" not in _columns(db, "catalog_items")
    assert "ix_catalog_items_source_md5" not in _indexes(db, "catalog_items")
    con = sqlite3.connect(db)
    try:
        assert con.execute("SELECT title, status FROM catalog_items WHERE id = 'kept'").fetchone() == (
            "Kept talk", "ready")
    finally:
        con.close()
    command.upgrade(cfg, "head")  # and back up again
    assert "source_md5" in _columns(db, "catalog_items")
