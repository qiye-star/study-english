"""SQLite backups with an object-store copy (plan L1 Task 16, R13): upload after the local VACUUM INTO, prune both
copies to BACKUP_KEEP, merge listings with `where`, and never fail a backup because the upload failed."""
from datetime import datetime, timezone

import pytest

from app.admin import backups
from app.storage import StorageError


def _when(minute: int) -> datetime:
    return datetime(2026, 10, 21, 3, minute, 0, tzinfo=timezone.utc)


@pytest.fixture
def settings_overrides(tmp_path):
    return {"data_dir": str(tmp_path / "data"), "backup_keep": 2}


@pytest.mark.parametrize("storage_backend", ["s3"], indirect=True)
async def test_each_backup_is_uploaded_and_both_copies_are_pruned(app, storage_backend):
    settings = app.state.settings
    for minute in (1, 2, 3):
        await backups.create_backup(app, _when(minute))
    local = sorted(p.name for p in settings.resolved_backup_dir.glob("app-*.db"))
    remote = sorted([i.key[len("backups/"):] async for i in app.state.storage.list("backups/")])
    assert len(local) == 2 and local == remote  # BACKUP_KEEP applies to each copy
    listing = await backups.list_all(settings, app.state.storage)
    assert {item["where"] for item in listing} == {"both"}
    assert [item["name"] for item in listing] == sorted(local, reverse=True)


@pytest.mark.parametrize("storage_backend", ["s3"], indirect=True)
async def test_an_upload_failure_keeps_the_local_backup_and_succeeds(app, storage_backend, monkeypatch, caplog):
    async def down(key, path, **kwargs):
        raise StorageError("unavailable")

    monkeypatch.setattr(app.state.storage, "put_file", down)
    out = await backups.create_backup(app, _when(5))
    assert backups.path_of(app.state.settings, out["name"]).is_file()
    assert "backup upload failed code=unavailable" in caplog.text


@pytest.mark.parametrize("storage_backend", ["s3"], indirect=True)
async def test_a_remote_only_copy_is_listed_linked_and_deleted(app, storage_backend):
    out = await backups.create_backup(app, _when(7))
    backups.path_of(app.state.settings, out["name"]).unlink()  # the local copy is gone (e.g. a new container)
    listing = await backups.list_all(app.state.settings, app.state.storage)
    assert [(i["name"], i["where"]) for i in listing] == [(out["name"], "remote")]
    assert await backups.exists_anywhere(app.state.settings, app.state.storage, out["name"]) is True
    await backups.delete_everywhere(app.state.settings, app.state.storage, out["name"])
    assert await backups.exists_anywhere(app.state.settings, app.state.storage, out["name"]) is False


async def test_a_local_primary_keeps_backups_only_on_disk(app):
    out = await backups.create_backup(app, _when(9))
    assert backups.remote_of(app.state.storage) is None  # no second copy: the local store keeps the one file
    assert [(i["name"], i["where"]) for i in await backups.list_all(app.state.settings, app.state.storage)] == [
        (out["name"], "local")]
