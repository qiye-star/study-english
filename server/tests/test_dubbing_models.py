"""迁移 0029_dubbing 与 L5 模型(plan L5 S1 / R2):角色列、library_dubs、library_attempts.dub_id。"""
import sqlite3
from datetime import datetime, timezone

from alembic import command
from alembic.script import ScriptDirectory

from app.library import store
from app.models import CatalogItem, CatalogSegment, LibraryAttempt, LibraryDub, LibraryItem, LibrarySegment, User
from tests.test_migrations import _config, _tables

NOW = datetime(2026, 10, 21, 8, 0, tzinfo=timezone.utc)
UID = 12345678
IID = "0f0e0d0c-0b0a-4908-8706-050403020100"
CID = "1f0e0d0c-0b0a-4908-8706-050403020101"


def _indexes(con, table: str) -> dict[str, bool]:
    return {r[1]: bool(r[2]) for r in con.execute(f"pragma index_list({table})")}


def _cols(con, table: str) -> set[str]:
    return {r[1] for r in con.execute(f"pragma table_info({table})")}


def test_head_is_0029_and_follows_the_previous_head(tmp_path, monkeypatch):
    cfg, _db = _config(tmp_path, monkeypatch)
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0029"]
    assert script.get_revision("0029").down_revision == "0027"


def test_0029_adds_columns_and_dubs_and_round_trips(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0027")
    con = sqlite3.connect(db)
    con.execute("insert into users (id, username, password_hash, created_at) values (?, 'u', 'x', '2026-10-21')", (UID,))
    con.execute("insert into library_items (id, user_id, kind, source, title, status, created_at, updated_at) "
                "values (?, ?, 'video', 'upload', 't', 'ready', '2026-10-21', '2026-10-21')", (IID, UID))
    con.execute("insert into library_segments (item_id, idx, start_ms, end_ms, text) values (?, 0, 0, 900, 'hi')", (IID,))
    con.execute("insert into library_attempts (id, user_id, item_id, seg_idx, text_hash, created_at) "
                "values ('a1', ?, ?, 0, 'h', '2026-10-21')", (UID, IID))
    con.execute("insert into catalog_items (id, title, source, status, created_at, updated_at) "
                "values (?, 'T', 'upload', 'ready', '2026-10-21', '2026-10-21')", (CID,))
    con.execute("insert into catalog_segments (catalog_id, idx, start_ms, end_ms, text) values (?, 0, 0, 900, 'hi')", (CID,))
    con.commit()
    con.close()

    command.upgrade(cfg, "0029")
    assert "library_dubs" in _tables(db)
    con = sqlite3.connect(db)
    try:
        assert "speaker" in _cols(con, "library_segments") and "role_names" in _cols(con, "library_items")
        assert "speaker" in _cols(con, "catalog_segments") and "role_names" in _cols(con, "catalog_items")
        assert "dub_id" in _cols(con, "library_attempts")
        assert con.execute("select speaker from library_segments").fetchone() == (None,)
        assert con.execute("select role_names from library_items").fetchone() == (None,)
        assert con.execute("select dub_id from library_attempts where id='a1'").fetchone() == (None,)
        fks = {(r[2], r[3], r[6]) for r in con.execute("pragma foreign_key_list(library_dubs)")}
        assert fks == {("users", "user_id", "CASCADE"), ("library_items", "item_id", "CASCADE")}
        assert "ix_library_attempts_dub_id" in _indexes(con, "library_attempts")
        assert "ix_library_dubs_user_id_item_id_created_at" in _indexes(con, "library_dubs")
    finally:
        con.close()

    command.downgrade(cfg, "0027")
    assert "library_dubs" not in _tables(db)
    con = sqlite3.connect(db)
    try:
        assert "speaker" not in _cols(con, "library_segments")
        assert "role_names" not in _cols(con, "library_items")
        assert "dub_id" not in _cols(con, "library_attempts")
        assert con.execute("select count(*) from library_items").fetchone() == (1,)
        assert con.execute("select count(*) from library_segments").fetchone() == (1,)
        assert con.execute("select count(*) from library_attempts").fetchone() == (1,)
        assert con.execute("select count(*) from catalog_segments").fetchone() == (1,)
    finally:
        con.close()
    command.upgrade(cfg, "0029")
    assert "library_dubs" in _tables(db)


def test_models_declare_the_frozen_names():
    assert "speaker" in LibrarySegment.__table__.columns
    assert "role_names" in LibraryItem.__table__.columns
    assert "speaker" in CatalogSegment.__table__.columns
    assert "role_names" in CatalogItem.__table__.columns
    assert "dub_id" in LibraryAttempt.__table__.columns
    assert LibraryDub.__tablename__ == "library_dubs"


async def test_deleting_an_item_deletes_its_dubs(app):
    async with app.state.sessionmaker() as s:
        s.add(User(id=11111111, username="u1", password_hash="x"))
        s.add(LibraryItem(id=IID, user_id=11111111, kind="video", source="upload", title="t", status="ready",
                          created_at=NOW, updated_at=NOW))
        s.add(LibraryDub(id="d1", user_id=11111111, item_id=IID, seg_from=0, seg_to=0, role="A", status="done",
                         lines={}, created_at=NOW))
        s.add(LibraryDub(id="d2", user_id=11111111, item_id=IID, seg_from=0, seg_to=0, role="B", status="done",
                         lines={}, created_at=NOW))
        await s.commit()
    async with app.state.sessionmaker() as s:
        item = await s.get(LibraryItem, IID)
        await store.delete_item_rows(s, IID)
        await s.commit()
    async with app.state.sessionmaker() as s:
        from sqlalchemy import select
        left = (await s.scalars(select(LibraryDub).where(LibraryDub.item_id == IID))).all()
        assert left == []
    assert item is not None
