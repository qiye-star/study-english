"""Storage key and prefix rules (plan 2026-10-21-l1-object-storage, Task 1 / R2)."""
import pytest

from app.storage import keys
from app.storage.base import BlobNotFound, StorageError

VALID = [
    "library/1/3f2a1b4c-0000-4000-8000-000000000001/media.mp4",
    "library/_catalog/3f2a1b4c-0000-4000-8000-000000000002/poster.jpg",
    "recordings/3/3f2a1b4c-0000-4000-8000-000000000003.wav",
    "room_audio/_staging/3f2a1b4c-0000-4000-8000-000000000004.wav",
    "room_audio/r1/m1.webm",
    "avatars/0123456789abcdef0123456789abcdef.webp",
    "backups/app-20261021-010203.db",
    "bundles/3f2a1b4c-0000-4000-8000-000000000005/manifest.json",
]

INVALID = [
    "",
    "/library/1/x",
    "library/1/x/",
    "library//1/x",
    "library/1/..",
    "library/./x",
    "library/../x",
    "library\\1\\x",
    "library/1/é.mp4",
    "library/" + "a" * 505,
    "app.db",
    "library/_tmp/3f2a/in.mp4",
    "library/_catalog/_tmp/3f2a/x",
    "secrets/x",
    "data/app.db",
]


@pytest.mark.parametrize("key", VALID)
def test_valid_keys_are_accepted(key):
    assert keys.check_key(key) == key


@pytest.mark.parametrize("key", INVALID)
def test_invalid_keys_are_rejected(key):
    with pytest.raises(ValueError):
        keys.check_key(key)


def test_a_513_character_key_is_rejected_and_512_is_accepted():
    ok = "library/" + "a" * 504  # 512 characters in total
    assert len(ok) == 512
    assert keys.check_key(ok) == ok
    with pytest.raises(ValueError):
        keys.check_key(ok + "a")


def test_prefixes_must_end_with_a_slash_and_cannot_be_empty():
    assert keys.check_prefix("library/1/") == "library/1/"
    assert keys.check_prefix("library/") == "library/"
    for bad in ("", "/", "library/1", "library/_tmp/", "../"):
        with pytest.raises(ValueError):
            keys.check_prefix(bad)


def test_join_builds_a_checked_key():
    assert keys.join("library", "1", "x.mp4") == "library/1/x.mp4"
    with pytest.raises(ValueError):
        keys.join("library", "..", "x")


def test_roots_are_the_documented_six():
    assert keys.ROOTS == ("library", "recordings", "room_audio", "avatars", "backups", "bundles")


def test_blob_not_found_is_both_a_storage_error_and_a_file_not_found():
    err = BlobNotFound()
    assert err.code == "not_found"
    assert isinstance(err, FileNotFoundError)
    assert isinstance(err, StorageError)
    assert isinstance(err, OSError)


def test_storage_error_keeps_its_code():
    err = StorageError("unavailable")
    assert err.code == "unavailable"
    assert isinstance(err, OSError)
