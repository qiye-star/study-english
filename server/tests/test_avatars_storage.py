"""头像文件存储与上传开关(计划 S3;R-V2、R-V3、X16 之后的设置项)。

Plan L1 Task 14: avatars are objects under `avatars/<id>.webp` in the app's store; these tests drive the store API
against the local backend (the S3 path runs in the privacy sweep and the API tests)."""
import re
from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.settings_registry import SPECS
from app.services import avatars
from app.storage.local import LocalStore

ID_RE = re.compile(r"[0-9a-f]{32}")


def _settings(tmp_path: Path) -> Settings:
    return Settings(_env_file=None, data_dir=str(tmp_path))


async def test_save_writes_under_avatars_with_a_random_id(tmp_path):
    store = LocalStore(tmp_path)
    first = await avatars.save(store, b"RIFF....WEBPfirst")
    second = await avatars.save(store, b"RIFF....WEBPsecond")

    assert ID_RE.fullmatch(first) and ID_RE.fullmatch(second)
    assert first != second
    path = tmp_path / "avatars" / f"{first}.webp"
    assert path.read_bytes() == b"RIFF....WEBPfirst"
    assert avatars.avatar_key(first) == f"avatars/{first}.webp"
    # no temp residue next to the finished files
    assert not list((tmp_path / "avatars").glob("*.part"))


@pytest.mark.parametrize("bad", [
    "../x",
    "../../etc/passwd",
    "..\\x",
    "A" * 32,            # upper case is not what we generate
    "a" * 31,            # too short
    "a" * 33,            # too long
    "a" * 31 + "/",      # separator
    "",
])
def test_avatar_key_refuses_anything_but_a_32_hex_id(bad):
    with pytest.raises(ValueError):
        avatars.avatar_key(bad)


async def test_remove_is_idempotent_and_never_raises(tmp_path):
    store = LocalStore(tmp_path)
    avatar_id = await avatars.save(store, b"RIFF....WEBP")
    path = tmp_path / avatars.avatar_key(avatar_id)
    assert path.exists()

    await avatars.remove(store, avatar_id)
    assert not path.exists()
    await avatars.remove(store, avatar_id)  # missing object: no error
    await avatars.remove(store, "../../outside")  # not an id: no error, no deletion outside the directory
    await avatars.remove(store, None)


async def test_remove_swallows_a_store_failure(tmp_path, monkeypatch, caplog):
    store = LocalStore(tmp_path)

    async def broken(key):
        raise OSError("disk gone")

    monkeypatch.setattr(store, "delete", broken)
    await avatars.remove(store, "0" * 32)  # must not raise
    assert "avatar delete failed" in caplog.text


async def test_avatar_objects_round_trip_on_s3_too():
    """The same save / remove calls against a moto bucket (plan L1 Task 14: avatars are objects, not files)."""
    from tests.storage_helpers import moto_bucket, s3_store

    with moto_bucket() as bucket:
        store = s3_store(bucket)
        avatar_id = await avatars.save(store, b"RIFF....WEBPs3")
        assert await store.get_bytes(avatars.avatar_key(avatar_id)) == b"RIFF....WEBPs3"
        await avatars.remove(store, avatar_id)
        assert await store.stat(avatars.avatar_key(avatar_id)) is None


def test_avatar_url_is_relative_and_none_without_an_avatar():
    assert avatars.avatar_url(None) is None
    assert avatars.avatar_url("0" * 32) == "/api/avatars/" + "0" * 32


def test_upload_switch_is_a_hot_accounts_setting_on_by_default(tmp_path):
    assert Settings(_env_file=None).avatar_upload_enabled is True
    spec = SPECS["avatar_upload_enabled"]
    assert spec.group == "accounts"
    assert spec.kind == "bool"
