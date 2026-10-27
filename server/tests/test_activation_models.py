"""迁移 0030_activation 与 L4 模型(plan L4 Task 3 / R2 / R10):word_usage、segment_lemma。"""
import sqlite3
from datetime import datetime, timezone

from alembic import command
from alembic.script import ScriptDirectory

from app.models import SegmentLemma, WordUsage
from tests.test_migrations import _config, _tables

NOW = datetime(2026, 10, 21, 8, 0, tzinfo=timezone.utc)
UID = 22222222


def _indexes(con, table: str) -> dict[str, bool]:
    return {r[1]: bool(r[2]) for r in con.execute(f"pragma index_list({table})")}


def _cols(con, table: str) -> set[str]:
    return {r[1] for r in con.execute(f"pragma table_info({table})")}


def _pk(con, table: str) -> list[str]:
    rows = sorted((r[5], r[1]) for r in con.execute(f"pragma table_info({table})") if r[5])
    return [name for _, name in rows]


def test_head_is_0030_and_follows_0029(tmp_path, monkeypatch):
    cfg, _db = _config(tmp_path, monkeypatch)
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0032"]
    assert script.get_revision("0030").down_revision == "0029"


def test_0030_adds_the_two_tables_and_round_trips(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0029")
    con = sqlite3.connect(db)
    con.execute("insert into users (id, username, password_hash, created_at) values (?, 'u', 'x', '2026-10-21')", (UID,))
    con.commit()
    con.close()

    command.upgrade(cfg, "0030")
    assert {"word_usage", "segment_lemma"} <= _tables(db)
    con = sqlite3.connect(db)
    try:
        assert _cols(con, "word_usage") == {"user_id", "lemma", "first_used_at", "last_used_at", "use_count",
                                            "shadow_count", "session_count", "last_session", "sources"}
        assert _pk(con, "word_usage") == ["user_id", "lemma"]
        assert _cols(con, "segment_lemma") == {"scope", "owner_id", "idx", "lemma"}
        assert _pk(con, "segment_lemma") == ["scope", "owner_id", "idx", "lemma"]
        fks = {(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(word_usage)")}
        assert fks == {("users", "user_id", "CASCADE")}
        assert list(con.execute("pragma foreign_key_list(segment_lemma)")) == []  # R10: no foreign keys
        assert "ix_word_usage_user_id_last_used_at" in _indexes(con, "word_usage")
        assert "ix_segment_lemma_lemma_scope" in _indexes(con, "segment_lemma")
    finally:
        con.close()

    command.downgrade(cfg, "0029")
    assert "word_usage" not in _tables(db) and "segment_lemma" not in _tables(db)
    con = sqlite3.connect(db)
    try:
        assert con.execute("select count(*) from users where id = ?", (UID,)).fetchone() == (1,)
    finally:
        con.close()
    command.upgrade(cfg, "0030")
    assert {"word_usage", "segment_lemma"} <= _tables(db)


def test_models_declare_the_frozen_names():
    assert WordUsage.__tablename__ == "word_usage"
    assert SegmentLemma.__tablename__ == "segment_lemma"
    for col in ("user_id", "lemma", "first_used_at", "last_used_at", "use_count", "shadow_count", "session_count",
                "last_session", "sources"):
        assert col in WordUsage.__table__.columns
    for col in ("scope", "owner_id", "idx", "lemma"):
        assert col in SegmentLemma.__table__.columns
    assert not SegmentLemma.__table__.foreign_keys  # R10: owners of both scopes share the table, so no foreign key
    assert WordUsage.__table__.columns["last_session"].type.length == 16
    assert WordUsage.__table__.columns["sources"].type.length == 32
