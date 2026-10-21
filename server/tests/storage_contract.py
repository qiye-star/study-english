"""Behaviour every BlobStore must satisfy (plan L1 Task 2). Test modules import these functions and supply a `store`
fixture: LocalStore in test_storage_local.py, S3Store over moto in test_storage_s3.py, and so on.

Not collected by pytest on its own (the name does not start with test_)."""
import pytest

from app.storage import BlobNotFound, StorageError


async def test_put_bytes_then_stat_and_get(store):
    info = await store.put_bytes("library/1/item-a/media.mp4", b"hello")
    assert info.key == "library/1/item-a/media.mp4"
    assert info.size == 5
    assert info.mtime > 0
    assert info.etag
    stat = await store.stat("library/1/item-a/media.mp4")
    assert stat is not None and stat.size == 5
    assert await store.get_bytes("library/1/item-a/media.mp4") == b"hello"


async def test_get_bytes_enforces_the_size_limit(store):
    await store.put_bytes("library/1/a/x.bin", b"abcdef")
    assert await store.get_bytes("library/1/a/x.bin", max_bytes=6) == b"abcdef"
    with pytest.raises(StorageError) as caught:
        await store.get_bytes("library/1/a/x.bin", max_bytes=3)
    assert caught.value.code == "too_large"


async def test_put_file_does_not_consume_the_source(store, tmp_path):
    source = tmp_path / "source.bin"
    source.write_bytes(b"0123456789")
    info = await store.put_file("recordings/1/a.wav", source)
    assert info.size == 10
    assert source.read_bytes() == b"0123456789"
    assert await store.get_bytes("recordings/1/a.wav") == b"0123456789"


async def test_overwrite_returns_the_new_content(store):
    await store.put_bytes("avatars/x.webp", b"first")
    await store.put_bytes("avatars/x.webp", b"second!")
    assert await store.get_bytes("avatars/x.webp") == b"second!"


async def test_download_to_writes_the_target_without_leftovers(store, tmp_path):
    await store.put_bytes("library/1/a/media.mp4", b"video-bytes")
    target = tmp_path / "work" / "media.mp4"
    info = await store.download_to("library/1/a/media.mp4", target)
    assert info.size == len(b"video-bytes")
    assert target.read_bytes() == b"video-bytes"
    assert not list(target.parent.glob("*.part"))


async def test_open_range_returns_inclusive_slices(store):
    data = bytes(range(200))
    await store.put_bytes("library/1/a/media.mp4", data)
    first = await store.open_range("library/1/a/media.mp4", 0, 1)
    assert (first.start, first.end) == (0, 1)
    assert b"".join([chunk async for chunk in first]) == data[0:2]
    await first.aclose()
    tail = await store.open_range("library/1/a/media.mp4", 100, None)
    assert (tail.start, tail.end) == (100, 199)
    assert b"".join([chunk async for chunk in tail]) == data[100:]
    clipped = await store.open_range("library/1/a/media.mp4", 150, 999)
    assert clipped.end == 199
    assert b"".join([chunk async for chunk in clipped]) == data[150:]


async def test_stat_and_delete_of_a_missing_key(store):
    assert await store.stat("library/1/none/media.mp4") is None
    assert await store.delete("library/1/none/media.mp4") is False


async def test_delete_removes_one_object(store):
    await store.put_bytes("library/1/a/media.mp4", b"x")
    assert await store.delete("library/1/a/media.mp4") is True
    assert await store.stat("library/1/a/media.mp4") is None


async def test_delete_prefix_only_removes_objects_under_the_prefix(store):
    await store.put_bytes("library/1/a/media.mp4", b"1")
    await store.put_bytes("library/1/b/poster.jpg", b"2")
    await store.put_bytes("library/10/a/media.mp4", b"3")
    assert await store.delete_prefix("library/1/") == 2
    assert await store.stat("library/1/a/media.mp4") is None
    assert await store.get_bytes("library/10/a/media.mp4") == b"3"


async def test_list_is_sorted_and_limited_to_the_prefix(store):
    await store.put_bytes("library/1/z/media.mp4", b"z")
    await store.put_bytes("library/1/a/media.mp4", b"a")
    await store.put_bytes("library/2/a/media.mp4", b"b")
    keys = [info.key async for info in store.list("library/1/")]
    assert keys == ["library/1/a/media.mp4", "library/1/z/media.mp4"]


async def test_missing_objects_raise_blob_not_found(store, tmp_path):
    with pytest.raises(BlobNotFound):
        await store.get_bytes("library/1/none/media.mp4")
    with pytest.raises(BlobNotFound):
        await store.download_to("library/1/none/media.mp4", tmp_path / "x.mp4")
    with pytest.raises(BlobNotFound):
        await store.open_range("library/1/none/media.mp4", 0, None)


async def test_illegal_keys_and_prefixes_are_rejected(store):
    for key in ("library/../x", "app.db", "library/_tmp/in.mp4", "/library/1/x"):
        with pytest.raises(ValueError):
            await store.put_bytes(key, b"x")
    with pytest.raises(ValueError):
        await store.delete_prefix("library/1")
    with pytest.raises(ValueError):
        [info async for info in store.list("")]
