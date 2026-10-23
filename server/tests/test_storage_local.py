"""LocalStore: the shared contract plus local-only behaviour (plan L1 Task 2, R4)."""
import os
import sys
from pathlib import Path

import pytest

from app.storage.base import BlobNotFound
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


@pytest.mark.parametrize(
    "key",
    ["/etc/passwd", "C:/Windows/win.ini", "library\\..\\..\\app.db", "library/..", "./library/x.mp4",
     "library//x.mp4", "bundles/../../app.db", "recordings/%2e%2e/app.db", "library/_tmp/1/in.mp4"],
)
async def test_path_of_allowlist_refuses_traversal_and_foreign_roots(store, key):
    with pytest.raises(ValueError):
        store.path_of(key)


async def test_path_of_refuses_a_symlink_that_leaves_the_root(store, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.mp4").write_bytes(b"not ours")
    (store.root / "library").mkdir(parents=True)
    try:
        os.symlink(outside, store.root / "library" / "evil", target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks need privileges on this platform")
    # the target file exists, so the refusal must come from the root check, not from a missing file
    with pytest.raises(ValueError):
        store.path_of("library/evil/secret.mp4")
    with pytest.raises(ValueError):  # the other accessors refuse the same way: none of them follows the link out
        await store.stat("library/evil/secret.mp4")
    with pytest.raises(ValueError):
        await store.get_bytes("library/evil/secret.mp4")


async def test_path_of_returns_a_file_inside_the_root_for_a_valid_key(store):
    await store.put_bytes("library/1/a/media.mp4", b"media")
    path = store.path_of("library/1/a/media.mp4")
    assert path.is_file()
    assert path.resolve().is_relative_to(store.root.resolve())
    with pytest.raises(BlobNotFound):
        store.path_of("library/1/a/missing.mp4")


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
