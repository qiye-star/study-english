import sqlite3
from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine

from app import models  # noqa: F401
from app.db import Base

ROOT = Path(__file__).resolve().parent.parent

NEW_COLUMNS = {
    "conversations": {"id", "user_id", "name", "config", "created_at", "updated_at"},
    "messages": {"id", "conversation_id", "role", "content", "created_at"},
    "assessments": {
        "id", "user_id", "reference_text", "language", "duration_ms",
        "audio_bytes", "scores", "result", "audio_path", "created_at",
    },
}


def _config(tmp_path, monkeypatch) -> tuple[Config, Path]:
    db = tmp_path / "m.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db.as_posix()}")
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    return cfg, db


def _tables(db: Path) -> set[str]:
    con = sqlite3.connect(db)
    try:
        return {row[0] for row in con.execute("select name from sqlite_master where type='table'")}
    finally:
        con.close()


def test_upgrade_head_creates_tables(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "head")
    assert {"users", "access_tokens", "speech_tokens", "alembic_version", *NEW_COLUMNS} <= _tables(db)


def test_0003_columns_and_round_trip(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0003")
    con = sqlite3.connect(db)
    try:
        for table, expected in NEW_COLUMNS.items():
            columns = {row[1] for row in con.execute(f"pragma table_info({table})")}
            assert columns == expected, table
    finally:
        con.close()
    command.downgrade(cfg, "0002")
    tables = _tables(db)
    assert not (set(NEW_COLUMNS) & tables)
    assert "speech_tokens" in tables
    command.upgrade(cfg, "0003")
    assert set(NEW_COLUMNS) <= _tables(db)


def test_models_match_migrations(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "head")
    engine = create_engine(f"sqlite:///{db.as_posix()}")
    try:
        with engine.connect() as conn:
            diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    finally:
        engine.dispose()
    assert diff == []


NEW_0004 = {
    "users": {"grammar_prompt"},
    "messages": {"assessment_id", "grammar"},
    "assessments": {"source"},
    "practice_items": {"id", "user_id", "text", "source", "created_at"},
}


def _columns(con, table: str) -> set[str]:
    return {row[1] for row in con.execute(f"pragma table_info({table})")}


def test_0004_adds_columns_keeps_data_and_round_trips(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0003")
    con = sqlite3.connect(db)
    try:
        con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'h', '2026-10-05 00:00:00')")
        con.execute("insert into conversations (id, user_id, name, config, created_at, updated_at) "
                    "values ('c', 12345678, 'n', '{}', '2026-10-05 00:00:00', '2026-10-05 00:00:00')")
        con.execute("insert into messages (id, conversation_id, role, content, created_at) "
                    "values ('m', 'c', 'user', 'hi', '2026-10-05 00:00:00')")
        con.execute("insert into assessments (id, user_id, reference_text, language, duration_ms, audio_bytes, scores, "
                    "result, audio_path, created_at) values ('a', 12345678, 'r', 'en-US', 1, 1, '{}', '{}', 'p', '2026-10-05 00:00:00')")
        con.commit()
    finally:
        con.close()

    command.upgrade(cfg, "head")
    con = sqlite3.connect(db)
    try:
        for table, expected in NEW_0004.items():
            assert expected <= _columns(con, table), table
        assert con.execute("select source from assessments where id = 'a'").fetchone() == ("practice",)
        assert con.execute("select content, assessment_id, grammar from messages where id = 'm'").fetchone() == ("hi", None, None)
        assert con.execute("select grammar_prompt from users").fetchone() == (None,)
        fks = con.execute("pragma foreign_key_list(messages)").fetchall()
        # (id, seq, table, from, to, on_update, on_delete, match)
        assert any(r[2] == "assessments" and r[3] == "assessment_id" and r[6] == "SET NULL" for r in fks)
    finally:
        con.close()

    command.downgrade(cfg, "0003")
    con = sqlite3.connect(db)
    try:
        assert "practice_items" not in _tables(db)
        assert "assessment_id" not in _columns(con, "messages") and "grammar" not in _columns(con, "messages")
        assert "source" not in _columns(con, "assessments")
        assert "grammar_prompt" not in _columns(con, "users")
        assert con.execute("select content from messages where id = 'm'").fetchone() == ("hi",)
    finally:
        con.close()
    command.upgrade(cfg, "head")
    assert "practice_items" in _tables(db)
