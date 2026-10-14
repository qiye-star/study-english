"""迁移 0018_library 与三张表(spec 2026-10-13-video-import §4)。"""
import sqlite3

from alembic import command
from alembic.script import ScriptDirectory

from app.models import LibraryAttempt, LibraryItem, LibrarySegment
from tests.test_migrations import _config, _tables

LIBRARY_TABLES = {"library_items", "library_segments", "library_attempts"}


def test_chain_through_0019_is_linear_and_head_is_0020(tmp_path, monkeypatch):
    cfg, _db = _config(tmp_path, monkeypatch)
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0020"]
    assert script.get_revision("0019").down_revision == "0018"
    assert script.get_revision("0018").down_revision == "0017"


def test_0019_adds_low_confidence_keeps_rows_and_round_trips(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0018")
    con = sqlite3.connect(db)
    con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'x', '2026-10-13')")
    con.execute("insert into library_items (id, user_id, kind, source, title, status, created_at, updated_at) "
                "values ('i1', 12345678, 'video', 'upload', 't', 'ready', '2026-10-13', '2026-10-13')")
    con.commit()
    con.close()
    command.upgrade(cfg, "0019")
    con = sqlite3.connect(db)
    assert "low_confidence" in {r[1] for r in con.execute("pragma table_info(library_items)")}
    assert con.execute("select low_confidence from library_items where id = 'i1'").fetchone() == (0,)
    con.close()
    command.downgrade(cfg, "0018")
    con = sqlite3.connect(db)
    assert "low_confidence" not in {r[1] for r in con.execute("pragma table_info(library_items)")}
    assert con.execute("select count(*) from library_items").fetchone() == (1,)
    assert {"ix_library_items_user_id_created_at", "ix_library_items_status_next_run_at"} <= {
        r[1] for r in con.execute("pragma index_list(library_items)")}
    con.close()
    command.upgrade(cfg, "head")


def test_0018_creates_the_tables_with_their_keys_and_round_trips(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0017")
    assert not LIBRARY_TABLES & _tables(db)
    command.upgrade(cfg, "0018")
    assert LIBRARY_TABLES <= _tables(db)
    con = sqlite3.connect(db)
    try:
        item_cols = {r[1] for r in con.execute("pragma table_info(library_items)")}
        seg_info = list(con.execute("pragma table_info(library_segments)"))
        seg_pk = [r[1] for r in sorted(seg_info, key=lambda r: r[5]) if r[5]]
        item_idx = {r[1] for r in con.execute("pragma index_list(library_items)")}
        attempt_idx = {r[1] for r in con.execute("pragma index_list(library_attempts)")}
        item_fks = {(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(library_items)")}
        seg_fks = {(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(library_segments)")}
        attempt_fks = {(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(library_attempts)")}
        con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'x', '2026-10-13')")
        con.execute("insert into library_items (id, user_id, kind, source, title, status, created_at, updated_at) "
                    "values ('i1', 12345678, 'video', 'upload', 't', 'uploading', '2026-10-13', '2026-10-13')")
        defaults = con.execute("select progress, attempts, upload_total, upload_received, library_bytes, asr_seconds, "
                               "seg_count, resume_ms, resume_idx, rate_pct from library_items").fetchone()
        con.execute("insert into library_segments (item_id, idx, start_ms, end_ms, text) values ('i1', 0, 0, 900, 'Hi.')")
        try:
            con.execute("insert into library_segments (item_id, idx, start_ms, end_ms, text) "
                        "values ('i1', 0, 0, 900, 'Again.')")
            raise AssertionError("duplicate (item_id, idx) was accepted")
        except sqlite3.IntegrityError:
            pass
        con.commit()
    finally:
        con.close()
    assert {"id", "user_id", "kind", "source", "title", "status", "stage", "progress", "error_kind", "attempts",
            "next_run_at", "source_host", "source_url", "upload_total", "upload_received", "duration_ms", "media_path",
            "poster_path", "media_mime", "library_bytes", "sub_source", "asr_seconds", "seg_count", "resume_ms",
            "resume_idx", "rate_pct", "created_at", "updated_at", "last_opened_at"} == item_cols
    assert seg_pk == ["item_id", "idx"]
    # D8:译文与分析四列,都可空(旧句子没有译文),与 spec §4 的长度一致
    assert {r[1]: (r[2], r[3]) for r in seg_info if r[1] in ("zh", "zh_lang", "analysis", "analysis_lang")} == {
        "zh": ("TEXT", 0), "zh_lang": ("VARCHAR(8)", 0), "analysis": ("TEXT", 0), "analysis_lang": ("VARCHAR(8)", 0)}
    assert {"ix_library_items_user_id_created_at", "ix_library_items_status_next_run_at"} <= item_idx
    assert "ix_library_attempts_item_id_seg_idx" in attempt_idx
    assert item_fks == {("users", "user_id", "CASCADE")}
    assert seg_fks == {("library_items", "item_id", "CASCADE")}
    assert attempt_fks == {("users", "user_id", "CASCADE"), ("library_items", "item_id", "CASCADE")}
    assert defaults == (0, 0, 0, 0, 0, 0, 0, 0, 0, 100)
    command.downgrade(cfg, "0017")
    assert not LIBRARY_TABLES & _tables(db)
    command.upgrade(cfg, "head")
    assert LIBRARY_TABLES <= _tables(db)


def test_model_defaults():
    item = LibraryItem(user_id=1, kind="video", source="upload", title="t", status="uploading")
    assert item.id is None  # default applied on flush (new_uuid)
    assert LibraryItem.__table__.c.rate_pct.default.arg == 100
    assert LibrarySegment.__table__.primary_key.columns.keys() == ["item_id", "idx"]
    seg = LibrarySegment(item_id="i", idx=0, start_ms=0, end_ms=1, text="Hi.")
    assert (seg.zh, seg.zh_lang, seg.analysis, seg.analysis_lang) == (None, None, None, None)
    assert LibraryAttempt.__table__.c.assessment_id.foreign_keys == set()
