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
        assert _columns(con, "vocabulary_items") == VOCAB_COLUMNS | {"stability", "difficulty", "fsrs_state", "last_review"}  # 0028 adds the FSRS state
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
    assert ScriptDirectory.from_config(cfg).get_heads() == ["0032"]  # one head after the admin v2 merge
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


WORDBOOK_TABLES = {"wordbook_enrollments", "wordbook_events", "wordbook_explanations", "wordbook_reports",
                   "wordbook_hidden_sentences"}


def test_0012_wordbook_tables_round_trip(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0011")
    assert not WORDBOOK_TABLES & _tables(db)
    command.upgrade(cfg, "0012")
    assert WORDBOOK_TABLES <= _tables(db)
    con = sqlite3.connect(db)
    try:
        cols = {r[1] for r in con.execute("pragma table_info(wordbook_events)")}
        pk = [r[1] for r in sorted(con.execute("pragma table_info(wordbook_enrollments)"), key=lambda r: r[5]) if r[5]]
        indexes = {r[1] for r in con.execute("pragma index_list(wordbook_events)")}
    finally:
        con.close()
    assert {"user_id", "book_id", "kind", "word", "item_id", "qtype", "outcome", "credit", "day", "created_at"} <= cols
    assert pk == ["user_id", "book_id"]
    assert {"ix_wordbook_events_user_id_created_at", "ix_wordbook_events_user_id_day",
            "ix_wordbook_events_book_id_kind"} <= indexes
    command.downgrade(cfg, "0011")
    assert not WORDBOOK_TABLES & _tables(db)
    command.upgrade(cfg, "head")
    assert WORDBOOK_TABLES <= _tables(db)


LINK_TABLES = {"user_link_prefs", "link_mistake_words", "link_weak_words", "link_word_uses", "link_credits"}


def test_0013_learning_links_tables_round_trip(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    assert ScriptDirectory.from_config(cfg).get_heads() == ["0032"]
    command.upgrade(cfg, "0012")
    assert not LINK_TABLES & _tables(db)
    command.upgrade(cfg, "0013")
    assert LINK_TABLES <= _tables(db)
    con = sqlite3.connect(db)
    try:
        pk = [r[1] for r in sorted(con.execute("pragma table_info(link_mistake_words)"), key=lambda r: r[5]) if r[5]]
        credit_idx = {r[1] for r in con.execute("pragma index_list(link_credits)")}
        uses_idx = {r[1] for r in con.execute("pragma index_list(link_word_uses)")}
        con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'x', '2026-10-11')")
        con.execute("insert into link_credits (user_id, kind, ref_id, created_at) values (12345678, 'word_in_chat', 'wic:1', '2026-10-11')")
        con.commit()
    finally:
        con.close()
    assert pk == ["user_id", "word"]
    assert "ix_link_credits_user_id_created_at" in credit_idx and "ix_link_word_uses_user_id_created_at" in uses_idx
    command.downgrade(cfg, "0012")
    assert not LINK_TABLES & _tables(db)
    command.upgrade(cfg, "head")
    assert LINK_TABLES <= _tables(db)


def test_0014_rooms_reopen_columns_backfill_and_round_trip(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    assert ScriptDirectory.from_config(cfg).get_revision("0015").down_revision == "0014"
    assert ScriptDirectory.from_config(cfg).get_revision("0014").down_revision == "0013"
    command.upgrade(cfg, "0013")
    con = sqlite3.connect(db)
    con.execute("insert into users (id, username, password_hash, created_at) values (7, 'lily', 'x', '2026-10-09')")
    con.execute("insert into rooms (id, code, last_code, owner_id, topic, status, locked, ai_public, last_seq, created_at,"
                " last_active_at, ai_muted) values ('r1', '482913', '482913', 7, '', 'open', 0, 1, 0, '2026-10-09 08:00:00',"
                " '2026-10-09 08:30:00', 0), ('r2', null, '573920', 7, '', 'closed', 0, 1, 0, '2026-10-08 08:00:00',"
                " '2026-10-08 09:00:00', 0)")
    con.commit()
    con.close()
    command.upgrade(cfg, "0014")
    con = sqlite3.connect(db)
    try:
        # backfilled to created_at, and the column stays nullable (R-O1: code coalesces, no SET NOT NULL)
        assert dict(con.execute("select id, opened_at from rooms")) == {"r1": "2026-10-09 08:00:00", "r2": "2026-10-08 08:00:00"}
        assert {r[0] for r in con.execute("select reopen_count from rooms")} == {0}
        cols = {r[1]: r for r in con.execute("pragma table_info(rooms)")}
        assert cols["opened_at"][3] == 0  # notnull flag
        assert cols["reopen_count"][3] == 1 and cols["reopen_count"][4] == "'0'"
    finally:
        con.close()
    command.downgrade(cfg, "0013")
    con = sqlite3.connect(db)
    try:
        cols = {r[1] for r in con.execute("pragma table_info(rooms)")}
        assert "opened_at" not in cols and "reopen_count" not in cols
        assert [(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(rooms)")] == [("users", "owner_id", "SET NULL")]
        assert any(r[1] == "uq_rooms_invite_token" or r[2] for r in con.execute("pragma index_list(rooms)"))
        assert con.execute("select count(*) from rooms").fetchone()[0] == 2  # rooms are never lost
    finally:
        con.close()
    command.upgrade(cfg, "head")


AGENT_TABLES = {"agent_personas", "agent_user_settings", "agent_persona_reports"}


def test_0015_agents_tables_trace_column_and_round_trip(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    assert ScriptDirectory.from_config(cfg).get_heads() == ["0032"]
    command.upgrade(cfg, "0014")
    assert not AGENT_TABLES & _tables(db)
    con = sqlite3.connect(db)
    try:
        con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'x', '2026-10-12')")
        con.execute("insert into conversations (id, user_id, name, config, created_at, updated_at) "
                    "values ('c1', 12345678, 'n', '{}', '2026-10-12', '2026-10-12')")
        con.execute("insert into messages (id, conversation_id, role, content, created_at) "
                    "values ('m1', 'c1', 'assistant', 'hi', '2026-10-12')")
        con.commit()
    finally:
        con.close()
    command.upgrade(cfg, "0015")
    assert AGENT_TABLES <= _tables(db)
    con = sqlite3.connect(db)
    try:
        assert "agent_trace" in _columns(con, "messages")
        assert con.execute("select content, agent_trace from messages where id = 'm1'").fetchone() == ("hi", None)
        con.execute("update messages set agent_trace = ? where id = 'm1'", ('{"v": 1}',))
        con.execute("insert into agent_personas (id, owner_id, name, intro, prompt, level, style, tools, prompt_public, "
                    "deep_think, created_at, updated_at) values ('p1', 12345678, 'Tom', '', 'x', 'B1', 'friendly', '[]', "
                    "1, 0, '2026-10-12', '2026-10-12')")
        con.execute("insert into agent_persona_reports (persona_id, reporter_id, reason, created_at) "
                    "values ('p1', 12345678, 'spam', '2026-10-12')")
        con.commit()
        persona_idx = {r[1] for r in con.execute("pragma index_list(agent_personas)")}
        report_idx = {r[1] for r in con.execute("pragma index_list(agent_persona_reports)")}
    finally:
        con.close()
    assert "ix_agent_personas_owner_id_created_at" in persona_idx
    assert {"ix_agent_persona_reports_persona_id", "ix_agent_persona_reports_resolved_at_created_at"} <= report_idx
    command.downgrade(cfg, "0014")
    assert not AGENT_TABLES & _tables(db)
    con = sqlite3.connect(db)
    try:
        assert "agent_trace" not in _columns(con, "messages")
        assert con.execute("select content from messages where id = 'm1'").fetchone() == ("hi",)
    finally:
        con.close()
    command.upgrade(cfg, "head")
    assert AGENT_TABLES <= _tables(db)


AGENT_MEMORY_TABLES = {"agent_memory_items", "agent_profiles", "agent_thread_states", "agent_recaps",
                       "agent_memory_tombstones"}


def test_0016_agent_memory_tables_round_trip(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0032"]
    assert script.get_revision("0016").down_revision == "0015"
    command.upgrade(cfg, "0015")
    assert not AGENT_MEMORY_TABLES & _tables(db)
    command.upgrade(cfg, "0016")
    assert AGENT_MEMORY_TABLES <= _tables(db)
    con = sqlite3.connect(db)
    try:
        assert _columns(con, "agent_memory_items") == {
            "id", "user_id", "persona_id", "kind", "text", "text_hash", "importance", "pinned", "source",
            "created_at", "updated_at", "last_used_at"}
        assert _columns(con, "agent_thread_states") == {
            "id", "user_id", "conversation_id", "room_id", "summary", "summarized_count", "rolls_since_recap",
            "turns_since_extract", "pending_texts", "segment_started_at", "last_turn_at", "updated_at"}
        tomb_pk = [r[1] for r in sorted(con.execute("pragma table_info(agent_memory_tombstones)"), key=lambda r: r[5])
                   if r[5]]
        item_idx = {r[1] for r in con.execute("pragma index_list(agent_memory_items)")}
        recap_idx = {r[1] for r in con.execute("pragma index_list(agent_recaps)")}
        thread_fks = {(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(agent_thread_states)")}
        recap_fks = {(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(agent_recaps)")}
        con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'x', '2026-10-12')")
        insert = ("insert into agent_memory_items (id, user_id, persona_id, kind, text, text_hash, importance, pinned, "
                  "source, created_at, updated_at) values (?, 12345678, ?, 'goal', 't', 'h', 3, 0, 'chat', "
                  "'2026-10-12', '2026-10-12')")
        con.execute(insert, ("m1", None))
        con.commit()
        try:
            con.execute(insert, ("m2", "builtin:coach"))
            raise AssertionError("a second item with the same text hash was accepted")
        except sqlite3.IntegrityError:
            pass
    finally:
        con.close()
    assert tomb_pk == ["user_id", "text_hash"]
    assert "ix_agent_memory_items_user_id_persona_id" in item_idx
    assert {"ix_agent_recaps_user_id_created_at", "ix_agent_recaps_conversation_id"} <= recap_idx
    assert thread_fks == {("users", "user_id", "CASCADE"), ("conversations", "conversation_id", "CASCADE"),
                          ("rooms", "room_id", "CASCADE")}
    assert recap_fks == {("users", "user_id", "CASCADE"), ("conversations", "conversation_id", "CASCADE")}
    command.downgrade(cfg, "0015")
    assert not AGENT_MEMORY_TABLES & _tables(db)
    command.upgrade(cfg, "head")
    assert AGENT_MEMORY_TABLES <= _tables(db)


def test_user_foreign_keys_in_the_migrated_schema_carry_the_models_on_delete(tmp_path, monkeypatch):
    """Postgres enforces ON DELETE from the migrations; delete_user mirrors the models' ondelete on SQLite
    (tests/test_admin_users.py). Both must agree for every column that references users.id."""
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "head")
    expected = set()
    for table in Base.metadata.sorted_tables:
        for fk in table.foreign_keys:
            if fk.column.table.name == "users":
                expected.add((table.name, fk.parent.name, (fk.ondelete or "NO ACTION").upper()))
    con = sqlite3.connect(db)
    try:
        actual = set()
        for (name,) in con.execute("select name from sqlite_master where type='table'"):
            for row in con.execute(f"pragma foreign_key_list('{name}')"):
                if row[2] == "users":  # (id, seq, table, from, to, on_update, on_delete, match)
                    actual.add((name, row[3], row[6].upper()))
    finally:
        con.close()
    assert actual == expected
    wordbook_and_links = {(t, c, d) for t, c, d in actual if t.startswith(("wordbook_", "link_", "user_link_"))}
    assert wordbook_and_links == {
        ("wordbook_enrollments", "user_id", "CASCADE"), ("wordbook_events", "user_id", "CASCADE"),
        ("wordbook_reports", "user_id", "SET NULL"), ("user_link_prefs", "user_id", "CASCADE"),
        ("link_mistake_words", "user_id", "CASCADE"), ("link_weak_words", "user_id", "CASCADE"),
        ("link_word_uses", "user_id", "CASCADE"), ("link_credits", "user_id", "CASCADE"),
    }


TUTOR_TABLE = "agent_tutor_sessions"


def test_0016_agent_tutor_sessions_round_trip(tmp_path, monkeypatch):
    """A3 appends the tutor session table to A2's 0016 (plan 2026-10-12-agents-tutor R-T7)."""
    cfg, db = _config(tmp_path, monkeypatch)
    assert ScriptDirectory.from_config(cfg).get_heads() == ["0032"]
    command.upgrade(cfg, "0015")
    assert TUTOR_TABLE not in _tables(db)
    command.upgrade(cfg, "0016")
    assert TUTOR_TABLE in _tables(db)
    con = sqlite3.connect(db)
    try:
        idx = {r[1] for r in con.execute(f"pragma index_list({TUTOR_TABLE})")}
        fks = {(r[2], r[3], r[6]) for r in con.execute(f"pragma foreign_key_list({TUTOR_TABLE})")}
        con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'x', '2026-10-12')")
        con.execute("insert into agent_tutor_sessions (id, user_id, persona_id, client_start_id, status, goal, state, "
                    "created_at, updated_at) values ('s1', 12345678, 'builtin:coach', 'c1', 'active', '{}', '{}', "
                    "'2026-10-12', '2026-10-12')")
        version = con.execute("select version from agent_tutor_sessions").fetchone()[0]
        con.commit()
    finally:
        con.close()
    assert {"ix_agent_tutor_sessions_user_id_conversation_id_status", "ix_agent_tutor_sessions_user_id_created_at"} <= idx
    assert ("users", "user_id", "CASCADE") in fks and ("conversations", "conversation_id", "CASCADE") in fks
    assert version == 0
    command.downgrade(cfg, "0015")
    assert TUTOR_TABLE not in _tables(db)
    command.upgrade(cfg, "head")
    assert TUTOR_TABLE in _tables(db)


def test_0017_room_agents_columns_round_trip(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "head")
    con = sqlite3.connect(db)
    assert {"agent_config", "agent_tutor"} <= {r[1] for r in con.execute("pragma table_info(rooms)")}
    con.close()
    command.downgrade(cfg, "0016")
    con = sqlite3.connect(db)
    assert not {"agent_config", "agent_tutor"} & {r[1] for r in con.execute("pragma table_info(rooms)")}
    con.close()
    command.upgrade(cfg, "head")
