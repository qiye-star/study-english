"""LocalStore: the shared contract plus local-only behaviour (plan L1 Task 2, R4)."""
import os
import sys
from pathlib import Path

import pytest

from app.storage.local import LocalStore
from tests.storage_contract import *  # noqa: F401,F403  (the shared contract cases run against LocalStore)


@pytest.fixture
def store(tmp_path):
    return LocalStore(tmp_path / "data")


async def test_put_file_hard_links_on_the_same_volume(store, tmp_path):
    source = tmp_path / "work" / "normalized.mp4"
    source.parent.mkdir()
    source.write_bytes(b"media")
    await store.put_file("library/1/a/media.mp4", source)
    final = store.root / "library/1/a/media.mp4"
    if os.stat(source).st_ino == 0:
        pytest.skip("this filesystem reports no inode numbers")
    assert os.stat(source).st_ino == os.stat(final).st_ino


async def test_put_file_falls_back_to_a_copy_when_linking_fails(store, tmp_path, monkeypatch):
    def no_links(src, dst):
        raise OSError("cross-device link")

    monkeypatch.setattr("app.storage.local.os.link", no_links)
    source = tmp_path / "normalized.mp4"
    source.write_bytes(b"copied")
    await store.put_file("library/1/a/media.mp4", source)
    assert await store.get_bytes("library/1/a/media.mp4") == b"copied"
    assert source.read_bytes() == b"copied"


async def test_a_failed_replace_leaves_no_partial_file(store, monkeypatch):
    def boom(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr("app.storage.local.os.replace", boom)
    with pytest.raises(OSError):
        await store.put_bytes("avatars/x.webp", b"new")
    assert await store.stat("avatars/x.webp") is None
    leftovers = list(store.root.rglob("*.part")) if store.root.exists() else []
    assert leftovers == []


async def test_list_skips_partial_writes_and_staging_directories(store):
    await store.put_bytes("library/1/a/media.mp4", b"ok")
    stray = store.root / "library/1/a/media.mp4.deadbeef.part"
    stray.write_bytes(b"half")
    staging = store.root / "library/_tmp/item/in.mp4"  # not a legal key: must never be listed
    staging.parent.mkdir(parents=True)
    staging.write_bytes(b"tmp")
    keys = [info.key async for info in store.list("library/")]
    assert keys == ["library/1/a/media.mp4"]


async def test_path_of_refuses_keys_that_escape_the_root(store):
    with pytest.raises(ValueError):
        store.path_of("library/../../secret.db")
    with pytest.raises(ValueError):
        store.path_of("app.db")


async def test_probe_reports_ok_for_a_writable_root(store):
    assert await store.probe() == "ok"


@pytest.mark.skipif(sys.platform == "win32" or hasattr(os, "geteuid") and os.geteuid() == 0,
                    reason="POSIX permissions only; root ignores them")
async def test_probe_reports_not_writable_for_a_read_only_root(tmp_path):
    root = tmp_path / "ro"
    root.mkdir()
    root.chmod(0o500)
    try:
        assert await LocalStore(root).probe() == "not_writable"
    finally:
        root.chmod(0o700)


async def test_the_layout_on_disk_is_the_plain_relative_path(store):
    await store.put_bytes("library/1/item/media.mp4", b"x")
    assert Path(store.root, "library", "1", "item", "media.mp4").read_bytes() == b"x"
