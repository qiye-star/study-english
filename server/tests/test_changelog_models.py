"""迁移 0020_changelog 与两张表(spec 2026-10-14-changelog-design §2.1,计划 2026-10-14-changelog S1)。"""
import sqlite3

from alembic import command
from alembic.script import ScriptDirectory

from tests.test_migrations import _config, _tables

TABLES = {"changelog_entries", "changelog_reads"}
ENTRY_COLUMNS = {"id", "published_at", "entry_date", "version", "title_zh", "title_en", "items", "created_by",
                 "created_at", "updated_at", "archived_at"}
READ_COLUMNS = {"user_id", "last_seen_id", "updated_at"}


def test_head_is_0024_and_the_chain_is_linear(tmp_path, monkeypatch):
    cfg, _db = _config(tmp_path, monkeypatch)
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0024"]
    assert script.get_revision("0020").down_revision == "0019"


def test_0020_creates_both_tables_and_round_trips(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0019")
    assert not TABLES & _tables(db)
    command.upgrade(cfg, "0020")
    assert TABLES <= _tables(db)
    con = sqlite3.connect(db)
    try:
        entry_cols = {r[1]: r for r in con.execute("pragma table_info(changelog_entries)")}
        read_cols = {r[1] for r in con.execute("pragma table_info(changelog_reads)")}
        assert set(entry_cols) == ENTRY_COLUMNS and read_cols == READ_COLUMNS
        assert entry_cols["published_at"][3] == 0 and entry_cols["version"][3] == 0 and entry_cols["archived_at"][3] == 0
        assert entry_cols["entry_date"][3] == 1 and entry_cols["title_zh"][3] == 1 and entry_cols["items"][3] == 1
        fks = {(r[2], r[3], r[6].upper()) for r in con.execute("pragma foreign_key_list(changelog_reads)")}
        assert fks == {("users", "user_id", "CASCADE")}
        assert "ix_changelog_entries_entry_date" in {r[1] for r in con.execute("pragma index_list(changelog_entries)")}
        con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'x', '2026-10-14')")
        con.execute("insert into changelog_entries (entry_date, title_zh, title_en, items, created_by, created_at, updated_at) "
                    "values ('2026-10-14', '标题', '', '[]', 'test', '2026-10-14', '2026-10-14')")
        con.execute("insert into changelog_reads (user_id, last_seen_id, updated_at) values (12345678, 1, '2026-10-14')")
        con.commit()
    finally:
        con.close()
    command.downgrade(cfg, "0019")
    tables = _tables(db)
    assert not TABLES & tables and "users" in tables
    command.upgrade(cfg, "0020")
    assert TABLES <= _tables(db)
