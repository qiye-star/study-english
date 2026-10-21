"""Library deletes go through the store, by prefix, after commit and never raise (plan L1 Task 8, R6.2).

Runs against LocalStore and S3Store (moto). The prefixes must not catch a neighbour: `library/1/` never takes
`library/10/`, and a copy's media is never deleted through the catalog's shared key."""
import logging

import pytest

from app.library import paths
from app.storage import StorageError
from app.storage.local import LocalStore
from tests.storage_helpers import moto_bucket, s3_store, keys_under_store

ITEM = "11111111-2222-4333-8444-555555555555"
OTHER = "66666666-7777-4888-8999-aaaaaaaaaaaa"
CATALOG = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"


@pytest.fixture(params=["local", "s3"])
async def blobs(request, tmp_path):
    if request.param == "local":
        yield LocalStore(tmp_path / "data")
        return
    with moto_bucket() as bucket:
        yield s3_store(bucket)


async def _seed(store, keys):
    for key in keys:
        await store.put_bytes(key, b"x")


async def test_removing_an_item_takes_only_its_own_prefix(blobs, tmp_path):
    await _seed(blobs, [
        f"library/1/{ITEM}/media.mp4", f"library/1/{ITEM}/poster.jpg",
        f"library/1/{OTHER}/media.mp4", f"library/10/{ITEM}/media.mp4",
    ])
    await paths.remove_item_files(blobs, tmp_path, 1, ITEM)
    assert await keys_under_store(blobs, "library/") == [f"library/1/{OTHER}/media.mp4",
                                                         f"library/10/{ITEM}/media.mp4"]


async def test_removing_a_user_takes_their_library_prefix_and_not_a_neighbours(blobs, tmp_path):
    await _seed(blobs, [f"library/7/{ITEM}/media.mp4", f"library/70/{ITEM}/media.mp4"])
    await paths.remove_user_files(blobs, tmp_path, 7, [ITEM])
    assert await keys_under_store(blobs, "library/") == [f"library/70/{ITEM}/media.mp4"]


async def test_removing_a_catalog_item_takes_only_its_shared_directory(blobs, tmp_path):
    other = "cccccccc-dddd-4eee-8fff-000000000000"
    await _seed(blobs, [f"library/_catalog/{CATALOG}/media.m4a", f"library/_catalog/{CATALOG}/poster.jpg",
                        f"library/_catalog/{other}/media.m4a", f"library/3/{ITEM}/media.m4a"])
    await paths.remove_catalog_files(blobs, tmp_path, CATALOG)
    assert await keys_under_store(blobs, "library/") == [f"library/3/{ITEM}/media.m4a",
                                                         f"library/_catalog/{other}/media.m4a"]


async def test_a_failed_delete_never_raises_and_logs_only_the_code(blobs, tmp_path, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    await _seed(blobs, [f"library/1/{ITEM}/media.mp4"])

    async def down(prefix):
        raise StorageError("unavailable", f"{prefix} bucket-x")

    monkeypatch.setattr(blobs, "delete_prefix", down)
    await paths.remove_item_files(blobs, tmp_path, 1, ITEM)  # must not raise
    lines = [r.getMessage() for r in caplog.records if "library delete failed" in r.getMessage()]
    assert lines == ["library delete failed op=delete_prefix code=unavailable"]
    assert ITEM not in " ".join(r.getMessage() for r in caplog.records)
