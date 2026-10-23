"""迁移 0022_curated_catalog 与精选库模型(spec 2026-10-14-curated-library §5)。"""
import sqlite3

import pytest
from alembic import command
from alembic.script import ScriptDirectory

from app.core import metering
from app.core.config import Settings
from app.core.settings_registry import SPECS
from app.library import errors, limits, paths
from app.models import CatalogItem, CatalogSegment, LibraryItem
from tests.test_migrations import _config, _tables

CATALOG_TABLES = {"catalog_items", "catalog_segments"}
CID = "0f0e0d0c-0b0a-4908-8706-050403020100"


def _indexes(con, table: str) -> dict[str, bool]:
    return {r[1]: bool(r[2]) for r in con.execute(f"pragma index_list({table})")}


def test_head_is_0025_and_0022_follows_0021(tmp_path, monkeypatch):
    cfg, _db = _config(tmp_path, monkeypatch)
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0031"]
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
                    "low_confidence", "ai_lang", "role_names", "published", "published_at", "retired_at", "created_at",
                    "updated_at"}  # role_names: plan L5 R2 (0029)
    assert set(CatalogSegment.__table__.columns.keys()) == {"catalog_id", "idx", "start_ms", "end_ms", "text", "zh",
                                                            "zh_lang", "analysis", "analysis_lang", "flags", "speaker"}  # plan L5 R2
    assert "catalog_id" in LibraryItem.__table__.columns
    assert not LibraryItem.__table__.columns["catalog_id"].foreign_keys  # R-SC1


def test_new_settings_have_defaults_and_specs():
    s = Settings()
    assert s.library_catalog_enabled is False and s.library_catalog_ai_daily == 300
    assert SPECS["library_catalog_enabled"].group == "library"
    assert SPECS["library_catalog_ai_daily"].danger  # costs money (system-paid analyses)


def test_new_error_codes_are_fixed_english():
    assert errors.API_ERRORS["catalog_disabled"] == (404, "Built-in library is disabled")
    assert errors.API_ERRORS["catalog_not_found"] == (404, "Built-in item not found")
    assert errors.API_ERRORS["catalog_locked"] == (409, "Built-in items cannot be changed this way")


def test_catalog_paths_live_beside_user_dirs_and_reject_bad_ids(tmp_path):
    assert paths.catalog_rel(CID) == f"library/_catalog/{CID}"
    assert paths.catalog_tmp_rel(CID) == f"library/_catalog/_tmp/{CID}"
    assert paths.catalog_dir(tmp_path, CID) == (tmp_path / "library" / "_catalog" / CID).resolve()
    assert paths.catalog_tmp_dir(tmp_path, CID) == (tmp_path / "library" / "_catalog" / "_tmp" / CID).resolve()
    for bad in ("../x", "_tmp", "", CID.upper()):
        with pytest.raises(ValueError):
            paths.catalog_rel(bad)
    # the user library's staging root is elsewhere: its sweep never sees catalog staging
    assert not paths.catalog_tmp_dir(tmp_path, CID).is_relative_to(paths.tmp_root(tmp_path))


async def test_remove_catalog_files_takes_both_dirs_only(tmp_path):
    from app.storage.local import LocalStore

    keep = paths.item_dir(tmp_path, 7, CID)
    keep.mkdir(parents=True)
    for d in (paths.catalog_dir(tmp_path, CID), paths.catalog_tmp_dir(tmp_path, CID)):
        d.mkdir(parents=True)
        (d / "x").write_bytes(b"1")
    await paths.remove_catalog_files(LocalStore(tmp_path), tmp_path, CID)
    assert not paths.catalog_dir(tmp_path, CID).exists() and not paths.catalog_tmp_dir(tmp_path, CID).exists()
    assert keep.is_dir()


def test_catalog_ai_scope_name_fits_daily_usage():
    assert limits.SCOPE_CATALOG_AI == "library_cat_ai"


def test_system_scope_unbinds_the_user_and_restores_it():
    metering.bind_user(42)
    with metering.system_scope():
        assert metering.current_user_id() is None
    assert metering.current_user_id() == 42
    metering.bind_user(None)
