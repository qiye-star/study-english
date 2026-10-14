"""迁移 0022_curated_catalog 与精选库模型(spec 2026-10-14-curated-library §5)。"""
import sqlite3

import pytest
from alembic import command
from alembic.script import ScriptDirectory

from app.models import CatalogItem, CatalogSegment, LibraryItem
from tests.test_migrations import _config, _tables

CATALOG_TABLES = {"catalog_items", "catalog_segments"}


def _indexes(con, table: str) -> dict[str, bool]:
    return {r[1]: bool(r[2]) for r in con.execute(f"pragma index_list({table})")}


def test_head_is_0022_and_follows_0021(tmp_path, monkeypatch):
    cfg, _db = _config(tmp_path, monkeypatch)
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0022"]
    assert script.get_revision("0022").down_revision == "0021"


def test_0022_creates_catalog_tables_and_the_copy_column_and_round_trips(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0021")
    con = sqlite3.connect(db)
    con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'x', '2026-10-14')")
    con.execute("insert into library_items (id, user_id, kind, source, title, status, created_at, updated_at) "
                "values ('i1', 12345678, 'video', 'upload', 't', 'ready', '2026-10-14', '2026-10-14')")
    con.commit()
    con.close()
    command.upgrade(cfg, "0022")
    assert CATALOG_TABLES <= _tables(db)
    con = sqlite3.connect(db)
    try:
        cols = {r[1] for r in con.execute("pragma table_info(library_items)")}
        assert "catalog_id" in cols
        assert con.execute("select catalog_id from library_items where id='i1'").fetchone() == (None,)
        assert _indexes(con, "library_items")["ux_library_items_user_id_catalog_id"] is True
        assert "ix_catalog_items_status_created_at" in _indexes(con, "catalog_items")
        fks = {(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(catalog_segments)")}
        assert fks == {("catalog_items", "catalog_id", "CASCADE")}
        con.execute("insert into catalog_items (id, title, source, status, created_at, updated_at) "
                    "values ('c1', 'T', 'upload', 'queued', '2026-10-14', '2026-10-14')")
        row = con.execute("select ai_lang, published, progress, media_bytes, seg_count from catalog_items").fetchone()
        assert row == ("zh-CN", 0, 0, 0, 0)
        # two plain items of one user (catalog_id NULL) never collide; two copies of one catalog item do
        con.execute("insert into library_items (id, user_id, kind, source, title, status, created_at, updated_at) "
                    "values ('i2', 12345678, 'audio', 'upload', 't', 'ready', '2026-10-14', '2026-10-14')")
        con.execute("insert into library_items (id, user_id, kind, source, title, status, catalog_id, created_at, "
                    "updated_at) values ('i3', 12345678, 'audio', 'catalog', 't', 'ready', 'c1', '2026-10-14', "
                    "'2026-10-14')")
        with pytest.raises(sqlite3.IntegrityError):
            con.execute("insert into library_items (id, user_id, kind, source, title, status, catalog_id, "
                        "created_at, updated_at) values ('i4', 12345678, 'audio', 'catalog', 't', 'ready', 'c1', "
                        "'2026-10-14', '2026-10-14')")
        con.commit()
    finally:
        con.close()
    command.downgrade(cfg, "0021")
    assert not (CATALOG_TABLES & _tables(db))
    con = sqlite3.connect(db)
    try:
        assert "catalog_id" not in {r[1] for r in con.execute("pragma table_info(library_items)")}
        assert con.execute("select count(*) from library_items").fetchone() == (3,)
    finally:
        con.close()
    command.upgrade(cfg, "0022")
    assert CATALOG_TABLES <= _tables(db)


def test_models_declare_the_frozen_names():
    assert CatalogItem.__tablename__ == "catalog_items" and CatalogSegment.__tablename__ == "catalog_segments"
    cols = set(CatalogItem.__table__.columns.keys())
    assert cols == {"id", "title", "level", "tags", "license_note", "source", "source_host", "source_url", "status",
                    "stage", "progress", "error_kind", "upload_total", "upload_received", "duration_ms", "media_path",
                    "poster_path", "media_mime", "media_bytes", "sub_source", "asr_seconds", "seg_count",
                    "low_confidence", "ai_lang", "published", "published_at", "retired_at", "created_at", "updated_at"}
    assert set(CatalogSegment.__table__.columns.keys()) == {"catalog_id", "idx", "start_ms", "end_ms", "text", "zh",
                                                            "zh_lang", "analysis", "analysis_lang", "flags"}
    assert "catalog_id" in LibraryItem.__table__.columns
    assert not LibraryItem.__table__.columns["catalog_id"].foreign_keys  # R-SC1
