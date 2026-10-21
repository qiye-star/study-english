"""FallbackStore: reads fall back to the old store, writes and deletes never touch it (plan L1 Task 6, R11)."""
import logging

import pytest

from app.storage import BlobNotFound
from app.storage.fallback import FallbackStore
from app.storage.local import LocalStore
from tests.storage_contract import *  # noqa: F401,F403  (the contract holds for the wrapper too)
from tests.storage_helpers import moto_bucket, s3_store

KEY = "library/1/item/media.mp4"


@pytest.fixture(params=["local", "s3"])
def pair(request, tmp_path):
    """(primary, secondary). The secondary is always local; the primary is local or a moto bucket."""
    secondary = LocalStore(tmp_path / "old")
    if request.param == "local":
        yield LocalStore(tmp_path / "new"), secondary
        return
    with moto_bucket() as bucket:
        yield s3_store(bucket), secondary


@pytest.fixture
def store(pair):
    return FallbackStore(*pair)


async def test_primary_hit_does_not_count(store, pair, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    await pair[0].put_bytes(KEY, b"new")
    assert await store.get_bytes(KEY) == b"new"
    assert store.hits == 0
    assert not [r for r in caplog.records if "fallback hit" in r.getMessage()]


async def test_a_miss_on_the_primary_reads_the_secondary_and_logs_without_the_key(store, pair, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    await pair[1].put_bytes(KEY, b"old-bytes")
    assert await store.get_bytes(KEY) == b"old-bytes"
    assert store.hits == 1
    lines = [r.getMessage() for r in caplog.records if "fallback hit" in r.getMessage()]
    assert lines == ["storage fallback hit op=get_bytes"]
    assert all("item" not in line and "media" not in line for line in lines)


async def test_writes_go_to_the_primary_only(store, pair, tmp_path):
    await store.put_bytes(KEY, b"fresh")
    assert await pair[0].get_bytes(KEY) == b"fresh"
    assert await pair[1].stat(KEY) is None
    source = tmp_path / "src.mp4"
    source.write_bytes(b"from-file")
    await store.put_file("library/1/item/other.mp4", source)
    assert await pair[1].stat("library/1/item/other.mp4") is None


async def test_deletes_never_touch_the_secondary(store, pair):
    await pair[0].put_bytes(KEY, b"p")
    await pair[1].put_bytes(KEY, b"s")
    assert await store.delete(KEY) is True
    assert await pair[1].get_bytes(KEY) == b"s"
    await pair[0].put_bytes("library/1/item/a.mp4", b"p")
    await pair[1].put_bytes("library/1/item/b.mp4", b"s")
    assert await store.delete_prefix("library/1/") == 1
    assert await pair[1].get_bytes("library/1/item/b.mp4") == b"s"


async def test_listing_covers_the_primary_only(store, pair):
    await pair[0].put_bytes("library/1/item/a.mp4", b"p")
    await pair[1].put_bytes("library/1/item/b.mp4", b"s")
    assert [info.key async for info in store.list("library/1/")] == ["library/1/item/a.mp4"]


async def test_stat_and_open_range_fall_back_and_count(store, pair):
    await pair[1].put_bytes(KEY, b"0123456789")
    info = await store.stat(KEY)
    assert info is not None and info.size == 10
    stream = await store.open_range(KEY, 2, 4)
    assert b"".join([chunk async for chunk in stream]) == b"234"
    assert store.hits == 2


async def test_missing_everywhere_raises_blob_not_found(store, tmp_path):
    with pytest.raises(BlobNotFound):
        await store.get_bytes(KEY)
    with pytest.raises(BlobNotFound):
        await store.download_to(KEY, tmp_path / "x.mp4")
    with pytest.raises(BlobNotFound):
        await store.open_range(KEY, 0, None)
    assert await store.stat(KEY) is None
    assert store.hits == 0


async def test_download_falls_back_as_well(store, pair, tmp_path):
    await pair[1].put_bytes(KEY, b"down")
    target = tmp_path / "work" / "media.mp4"
    await store.download_to(KEY, target)
    assert target.read_bytes() == b"down"
    assert store.hits == 1
