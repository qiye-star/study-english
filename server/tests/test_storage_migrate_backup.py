"""The migration's preconditions and the rollback drill (plan L1 Task 20, R12, spec section 6): a database backup comes
first and a failed backup writes nothing; PostgreSQL needs the operator's word; after a move, reading through the
fallback works and counts hits, and switching back to local reads the same bytes."""
import asyncio
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.admin import backups
from app.storage import migrate
from app.storage.fallback import FallbackStore
from app.storage.local import LocalStore
from tests.storage_helpers import moto_bucket, s3_store
from tests.test_storage_migrate import ITEM, MEDIA, PRIMARY, _settings

WHEN = datetime(2026, 10, 21, 4, 5, 6, tzinfo=timezone.utc)


@pytest.fixture
def bucket():
    with moto_bucket(PRIMARY):
        yield PRIMARY


def _run(settings, *argv, now=WHEN):
    lines = []
    args = migrate.parse_args(list(argv))
    return asyncio.run(migrate.migrate(settings, args, out=lines.append, now=now)), lines


def test_a_real_run_snapshots_the_database_first_under_the_admin_name(tmp_path, bucket):
    settings = _settings(tmp_path)
    asyncio.run(LocalStore(Path(settings.resolved_data_dir)).put_bytes(f"library/{ITEM}/media.mp4", MEDIA))
    code, lines = _run(settings, "--from", "local", "--to", "s3")
    assert code == migrate.EXIT_OK and "database backup written" in lines
    listed = [item["name"] for item in backups.list_backups(settings)]
    assert listed == ["app-20261021-040506.db"]


def test_a_failed_backup_refuses_the_run_and_writes_nothing(tmp_path, bucket):
    settings = _settings(tmp_path)
    blocker = tmp_path / "not-a-directory"
    blocker.write_text("x", encoding="utf-8")
    settings.backup_dir = str(blocker)  # the backup folder cannot be created
    asyncio.run(LocalStore(Path(settings.resolved_data_dir)).put_bytes(f"library/{ITEM}/media.mp4", MEDIA))
    with pytest.raises(migrate.MigrationError) as caught:
        _run(settings, "--from", "local", "--to", "s3")
    assert "database backup failed" in str(caught.value)
    assert asyncio.run(s3_store(PRIMARY).stat(f"library/{ITEM}/media.mp4")) is None


def test_postgresql_needs_the_operator_to_confirm_the_dump(tmp_path, bucket):
    settings = _settings(tmp_path, database_url="postgresql+asyncpg://user:pw@db.invalid/enjoy")
    with pytest.raises(migrate.MigrationError) as caught:
        asyncio.run(migrate.backup_database(settings, now=WHEN, pg_backup_done=False))
    assert "pg_dump" in str(caught.value) and "pw" not in str(caught.value)
    assert asyncio.run(migrate.backup_database(settings, now=WHEN, pg_backup_done=True)) is None


def test_the_rollback_drill_reads_through_the_fallback_and_back(tmp_path, bucket):
    settings = _settings(tmp_path)
    local = LocalStore(Path(settings.resolved_data_dir))
    asyncio.run(local.put_bytes(f"library/{ITEM}/media.mp4", MEDIA))
    assert _run(settings, "--from", "local", "--to", "s3")[0] == migrate.EXIT_OK

    primary = s3_store(PRIMARY)
    store = FallbackStore(primary, local)  # STORAGE_BACKEND=s3, STORAGE_FALLBACK=local
    asyncio.run(primary.delete(f"library/{ITEM}/media.mp4"))  # a target object goes missing
    assert asyncio.run(store.get_bytes(f"library/{ITEM}/media.mp4")) == MEDIA
    assert store.hits == 1
    assert asyncio.run(local.get_bytes(f"library/{ITEM}/media.mp4")) == MEDIA  # STORAGE_BACKEND=local: source untouched
