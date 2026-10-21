"""Reconciliation between the database and the store (plan L1 Task 20): read-only, counts per root, and the key
formulas the storage layer copies from the rest of the app must stay equal to the originals."""
import asyncio
import json
import stat
import sys

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models import LibraryItem, User
from app.storage import reconcile
from app.storage.local import LocalStore

ITEM = "11111111-2222-4333-8444-555555555555"
AVATAR = "0123456789abcdef0123456789abcdef"


@pytest.fixture
def db(tmp_path):
    url = f"sqlite+aiosqlite:///{tmp_path / 'app.db'}"
    engine = create_async_engine(url)

    async def schema():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(schema())
    yield async_sessionmaker(engine, expire_on_commit=False), engine
    asyncio.run(engine.dispose())


async def test_db_only_and_store_only_are_counted_per_root_and_nothing_is_deleted(tmp_path, db):
    maker, _engine = db
    blobs = LocalStore(tmp_path / "store")
    await blobs.put_bytes(f"library/1/{ITEM}/media.mp4", b"here")  # referenced and present
    await blobs.put_bytes("recordings/9/orphan.wav", b"unreferenced")  # present, nobody points at it
    async with maker() as s:
        s.add(User(id=1, username="ann", password_hash="x", avatar_id=AVATAR))  # avatar object is missing
        s.add(LibraryItem(id=ITEM, user_id=1, kind="video", source="upload", title="t", status="ready",
                          media_path=f"library/1/{ITEM}/media.mp4", rebuildable=False))
        await s.commit()
    before = sorted(
        [i.key async for i in blobs.list("library/")] + [i.key async for i in blobs.list("recordings/")])
    async with maker() as s:
        diff = await reconcile.reconcile(s, blobs)
    assert diff == {"db_only": {"avatars": 1}, "store_only": {"recordings": 1}}
    after = sorted(
        [i.key async for i in blobs.list("library/")] + [i.key async for i in blobs.list("recordings/")])
    assert after == before  # read-only: the store is untouched


async def test_a_catalog_copy_is_neither_missing_nor_counted_twice(tmp_path, db):
    maker, _engine = db
    blobs = LocalStore(tmp_path / "store")
    cid = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"
    await blobs.put_bytes(f"library/_catalog/{cid}/media.m4a", b"shared")
    async with maker() as s:
        s.add(User(id=2, username="bo", password_hash="x"))
        s.add(LibraryItem(id=ITEM, user_id=2, kind="audio", source="catalog", title="t", status="ready",
                          media_path=f"library/_catalog/{cid}/media.m4a", catalog_id=cid))
        await s.commit()
    async with maker() as s:
        diff = await reconcile.reconcile(s, blobs)
    assert diff == {"db_only": {}, "store_only": {}}


async def test_the_report_holds_keys_in_a_private_file(tmp_path, db):
    maker, _engine = db
    blobs = LocalStore(tmp_path / "store")
    async with maker() as s:
        s.add(User(id=3, username="cy", password_hash="x", avatar_id=AVATAR))
        await s.commit()
    report = tmp_path / "report.jsonl"
    async with maker() as s:
        await reconcile.reconcile(s, blobs, report=report)
    rows = [json.loads(line) for line in report.read_text(encoding="utf-8").splitlines()]
    assert rows == [{"kind": "db_only", "key": f"avatars/{AVATAR}.webp"}]
    if sys.platform != "win32":  # POSIX only: Windows does not keep the mode bits
        assert stat.S_IMODE(report.stat().st_mode) == 0o600


def test_the_storage_copies_of_the_key_formulas_match_the_app(tmp_path):
    from app.library import paths
    from app.services import avatars

    assert reconcile.transcript_key(12, ITEM) == paths.transcript_key(12, ITEM)
    assert reconcile.avatar_key(AVATAR) == avatars.avatar_key(AVATAR)


def test_the_backup_name_pattern_matches_the_admin_backups_and_lists_a_migration_snapshot(tmp_path):
    from app.admin import backups
    from app.storage import migrate

    assert migrate.BACKUP_RE.pattern == backups.BACKUP_RE.pattern
    assert migrate.PG_HINT and "pg_dump" in migrate.PG_HINT

    class Settings:
        resolved_backup_dir = tmp_path / "backups"

    Settings.resolved_backup_dir.mkdir()
    (Settings.resolved_backup_dir / "app-20261021-030405.db").write_bytes(b"sqlite")
    assert [item["name"] for item in backups.list_backups(Settings)] == ["app-20261021-030405.db"]
