import sqlite3
from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine

from app import models  # noqa: F401
from app.core.db import Base

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


VOCAB_COLUMNS = {
    "id", "user_id", "word", "meaning", "example", "source", "box", "due_at",
    "reps", "lapses", "last_reviewed_at", "created_at",
}
VOCAB_INDEXES = {"ix_vocabulary_items_user_id", "ix_vocabulary_items_user_id_due_at", "ix_vocabulary_items_user_id_word"}


def test_0005_vocabulary_table_keeps_data_and_round_trips(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0004")
    con = sqlite3.connect(db)
    try:
        con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'h', '2026-10-05 00:00:00')")
        con.execute("insert into practice_items (id, user_id, text, source, created_at) "
                    "values ('p', 12345678, 'Hi.', 'manual', '2026-10-05 00:00:00')")
        con.commit()
    finally:
        con.close()

    command.upgrade(cfg, "head")
    con = sqlite3.connect(db)
    try:
        assert _columns(con, "vocabulary_items") == VOCAB_COLUMNS
        # (seq, name, unique, origin, partial)
        indexes = {row[1]: row[2] for row in con.execute("pragma index_list(vocabulary_items)")}
        assert VOCAB_INDEXES <= set(indexes)
        assert not any(indexes[name] for name in VOCAB_INDEXES)  # 去重在应用层,不建唯一索引
        fks = con.execute("pragma foreign_key_list(vocabulary_items)").fetchall()
        assert any(r[2] == "users" and r[3] == "user_id" and r[6] == "CASCADE" for r in fks)
        assert con.execute("select text from practice_items where id = 'p'").fetchone() == ("Hi.",)
    finally:
        con.close()

    command.downgrade(cfg, "0004")
    assert "vocabulary_items" not in _tables(db)
    con = sqlite3.connect(db)
    try:
        assert con.execute("select text from practice_items where id = 'p'").fetchone() == ("Hi.",)
    finally:
        con.close()
    command.upgrade(cfg, "head")
    assert "vocabulary_items" in _tables(db)


def _match_row(con, match_id: str, status: str, started: str) -> None:
    con.execute("insert into promotion_matches (id, user_id, from_tier, to_tier, scenario_key, status, turn_limit, turns, "
                "threshold, attempt_no, started_at, expires_at) values (?, 12345678, 2, 3, 's', ?, 6, '[]', 68, 1, ?, ?)",
                (match_id, status, started, started))


def test_0007_dedupes_open_matches_and_round_trips(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0006")
    con = sqlite3.connect(db)
    try:
        con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'h', '2026-10-05 00:00:00')")
        _match_row(con, "old", "active", "2026-10-09 10:00:00")
        _match_row(con, "new", "grading_failed", "2026-10-09 11:00:00")
        _match_row(con, "done", "passed", "2026-10-08 11:00:00")
        con.execute("insert into rooms (id, code, last_code, owner_id, topic, status, locked, ai_public, last_seq, created_at, "
                    "last_active_at) values ('r', '482913', '482913', 12345678, 't', 'open', 0, 1, 1, '2026-10-09 10:00:00', "
                    "'2026-10-09 10:00:00')")
        con.execute("insert into room_messages (id, room_id, seq, lane, sender_kind, sender_id, kind, text, assisted, "
                    "created_at) values ('m', 'r', 1, 'public', 'user', 12345678, 'text', 'hi', 0, '2026-10-09 10:00:00')")
        con.commit()
    finally:
        con.close()

    command.upgrade(cfg, "0007")
    con = sqlite3.connect(db)
    try:
        statuses = dict(con.execute("select id, status from promotion_matches"))
        assert statuses == {"old": "expired", "new": "grading_failed", "done": "passed"}
        assert con.execute("select grade_attempts from promotion_matches where id = 'new'").fetchone() == (0,)
        # (seq, name, unique, origin, partial)
        index = next(r for r in con.execute("pragma index_list(promotion_matches)") if r[1] == "uq_promotion_matches_user_open")
        assert index[2] == 1 and index[4] == 1
        fks = con.execute("pragma foreign_key_list(rooms)").fetchall()
        assert [(r[2], r[3], r[6]) for r in fks] == [("users", "owner_id", "RESTRICT")]  # review #14
        assert con.execute("select text from room_messages where room_id = 'r'").fetchone() == ("hi",)
        assert con.execute("select code from rooms where id = 'r'").fetchone() == ("482913",)
        try:
            _match_row(con, "dup", "active", "2026-10-09 12:00:00")
            raise AssertionError("second open match was accepted")
        except sqlite3.IntegrityError:
            pass
    finally:
        con.close()
    command.downgrade(cfg, "0006")
    con = sqlite3.connect(db)
    try:
        assert "grade_attempts" not in _columns(con, "promotion_matches")
        assert [r[6] for r in con.execute("pragma foreign_key_list(rooms)")] == ["CASCADE"]
        assert con.execute("select text from room_messages where room_id = 'r'").fetchone() == ("hi",)
    finally:
        con.close()
    command.upgrade(cfg, "head")


ADMIN_V2_TABLES = {
    "admin_accounts", "admin_sessions", "admin_login_state", "admin_recovery_codes", "admin_audit",
    "setting_overrides", "setting_revisions", "config_revisions", "rank_rule_sets", "rank_profile_snapshots",
    "prompt_versions", "announcements", "upstream_calls", "usage_daily", "user_quota_overrides", "invite_codes",
}


def test_0008_admin_v2_tables_columns_and_round_trip(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0007")
    con = sqlite3.connect(db)
    try:
        con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'h', '2026-10-05 00:00:00')")
        _match_row(con, "open", "active", "2026-10-09 10:00:00")
        con.commit()
    finally:
        con.close()
    command.upgrade(cfg, "head")
    con = sqlite3.connect(db)
    try:
        assert ADMIN_V2_TABLES <= _tables(db)
        assert "disabled_at" in _columns(con, "users")
        assert "rules_version" in _columns(con, "promotion_matches")
        assert "ai_muted" in _columns(con, "rooms")
        assert "hidden_at" in _columns(con, "room_messages")
        assert {"resolved_at", "resolved_by", "resolution"} <= _columns(con, "room_reports")
        assert con.execute("select status, rules_version from promotion_matches").fetchone() == ("active", None)
        # 0007's partial unique index survives the column add
        assert any(r[1] == "uq_promotion_matches_user_open" for r in con.execute("pragma index_list(promotion_matches)"))
    finally:
        con.close()
    command.downgrade(cfg, "0007")
    con = sqlite3.connect(db)
    try:
        assert not (ADMIN_V2_TABLES & _tables(db))
        assert "disabled_at" not in _columns(con, "users")
        assert "rules_version" not in _columns(con, "promotion_matches")
        assert "ai_muted" not in _columns(con, "rooms")
        index = next(r for r in con.execute("pragma index_list(promotion_matches)") if r[1] == "uq_promotion_matches_user_open")
        assert index[2] == 1 and index[4] == 1
        assert [(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(rooms)")] == [("users", "owner_id", "RESTRICT")]
        assert con.execute("select status from promotion_matches").fetchone() == ("active",)
    finally:
        con.close()
    command.upgrade(cfg, "head")
    assert ADMIN_V2_TABLES <= _tables(db)


def test_0009_room_owner_nullable_set_null_keeps_rooms_and_round_trips(tmp_path, monkeypatch):
    """Owner ruling (integration): deleting a user never deletes rooms or messages; an ownerless room keeps NULL."""
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0008")
    con = sqlite3.connect(db)
    try:
        con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'h', '2026-10-05 00:00:00')")
        con.execute("insert into rooms (id, code, last_code, owner_id, topic, status, locked, ai_public, last_seq, created_at, "
                    "last_active_at, ai_muted) values ('r', '482913', '482913', 12345678, 't', 'open', 0, 1, 1, "
                    "'2026-10-09 10:00:00', '2026-10-09 10:00:00', 0)")
        con.execute("insert into room_messages (id, room_id, seq, lane, sender_kind, sender_id, kind, text, assisted, "
                    "created_at) values ('m', 'r', 1, 'public', 'user', 12345678, 'text', 'hi', 0, '2026-10-09 10:00:00')")
        con.commit()
    finally:
        con.close()
    command.upgrade(cfg, "head")
    con = sqlite3.connect(db)
    try:
        fks = con.execute("pragma foreign_key_list(rooms)").fetchall()
        assert [(r[2], r[3], r[6]) for r in fks] == [("users", "owner_id", "SET NULL")]
        notnull = {r[1]: r[3] for r in con.execute("pragma table_info(rooms)")}
        assert notnull["owner_id"] == 0
        assert con.execute("select owner_id, code, ai_muted from rooms where id = 'r'").fetchone() == (12345678, "482913", 0)
        assert con.execute("select text from room_messages where room_id = 'r'").fetchone() == ("hi",)
        con.execute("update rooms set owner_id = null where id = 'r'")
        con.commit()
    finally:
        con.close()
    try:  # an ownerless room cannot go back under NOT NULL: downgrade refuses instead of deleting it
        command.downgrade(cfg, "0008")
        raise AssertionError("downgrade dropped or broke an ownerless room")
    except RuntimeError as exc:
        assert "ownerless" in str(exc)
    con = sqlite3.connect(db)
    try:
        con.execute("update rooms set owner_id = 12345678 where id = 'r'")
        con.commit()
    finally:
        con.close()
    command.downgrade(cfg, "0008")
    con = sqlite3.connect(db)
    try:
        assert [(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(rooms)")] == [("users", "owner_id", "RESTRICT")]
        assert {r[1]: r[3] for r in con.execute("pragma table_info(rooms)")}["owner_id"] == 1
        assert con.execute("select text from room_messages where room_id = 'r'").fetchone() == ("hi",)
    finally:
        con.close()
    command.upgrade(cfg, "head")


def test_0010_admin_review_fixes_round_trip(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0009")
    con = sqlite3.connect(db)
    try:
        con.execute("insert into admin_sessions (id, token_hash, username, created_at, last_seen_at, expires_at, ip, "
                    "user_agent, csrf_hash) values ('s', 't', 'root', '2026-10-09 10:00:00', '2026-10-09 10:00:00', "
                    "'2026-10-09 18:00:00', '1', 'ua', 'c')")
        con.commit()
    finally:
        con.close()
    command.upgrade(cfg, "0010")
    assert {"app_secrets", "audit_head"} <= _tables(db)
    con = sqlite3.connect(db)
    try:
        assert con.execute("select mfa_failures from admin_sessions where id = 's'").fetchone() == (0,)
    finally:
        con.close()
    command.downgrade(cfg, "0009")
    assert not ({"app_secrets", "audit_head"} & _tables(db))
    con = sqlite3.connect(db)
    try:
        assert "mfa_failures" not in _columns(con, "admin_sessions")
    finally:
        con.close()
    command.upgrade(cfg, "head")
    assert "app_secrets" in _tables(db)


ROOMS_V2_TABLES = {"room_voice", "room_reactions", "room_join_requests", "room_summaries"}


def test_0011_rooms_v2_tables_columns_backfill_and_round_trip(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    assert ScriptDirectory.from_config(cfg).get_heads() == ["0011"]  # one head after the admin v2 merge
    previous = ScriptDirectory.from_config(cfg).get_revision("0011").down_revision
    assert previous == "0010"
    command.upgrade(cfg, previous)
    con = sqlite3.connect(db)
    con.execute("insert into users (id, username, password_hash, created_at) values (7, 'lily', 'x', '2026-10-09')")
    con.execute("insert into rooms (id, code, last_code, owner_id, topic, status, locked, ai_public, last_seq, created_at,"
                " last_active_at, ai_muted) values ('r1', '482913', '482913', 7, '美食', 'open', 0, 1, 0, '2026-10-09',"
                " '2026-10-09', 0), ('r2', null, '573920', 7, '', 'closed', 0, 1, 0, '2026-10-09', '2026-10-09', 0),"
                " ('r3', null, '684031', null, '', 'closed', 0, 1, 0, '2026-10-09', '2026-10-09', 0)")
    con.commit()
    con.close()
    command.upgrade(cfg, "head")
    con = sqlite3.connect(db)
    try:
        assert ROOMS_V2_TABLES <= _tables(db)
        rows = dict((r[0], r[1:]) for r in con.execute(
            "select id, name, scenario, level, join_mode, max_members, allow_voice, invite_token from rooms"))
        assert rows["r1"] == ("美食", "free", "B1", "code", 8, 1, None)
        assert rows["r2"][0] == "lily的房间"
        assert rows["r3"][0] == "房间"  # owner deleted (0009 SET NULL): the NOT NULL name still gets a value
        assert [(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(rooms)")] == [("users", "owner_id", "SET NULL")]
    finally:
        con.close()
    command.downgrade(cfg, previous)
    con = sqlite3.connect(db)
    try:
        assert not ROOMS_V2_TABLES & _tables(db)
        assert "name" not in {r[1] for r in con.execute("pragma table_info(rooms)")}
        assert [(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(rooms)")] == [("users", "owner_id", "SET NULL")]
    finally:
        con.close()
    command.upgrade(cfg, "head")
