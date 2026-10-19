"""头像文件存储与上传开关(计划 S3;R-V2、R-V3、X16 之后的设置项)。"""
import re
from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.settings_registry import SPECS
from app.services import avatars

ID_RE = re.compile(r"[0-9a-f]{32}")


def _settings(tmp_path: Path) -> Settings:
    return Settings(_env_file=None, data_dir=str(tmp_path))


def test_store_writes_under_data_dir_avatars_with_a_random_id(tmp_path):
    settings = _settings(tmp_path)
    first = avatars.store(settings, b"RIFF....WEBPfirst")
    second = avatars.store(settings, b"RIFF....WEBPsecond")

    assert ID_RE.fullmatch(first) and ID_RE.fullmatch(second)
    assert first != second
    path = tmp_path / "avatars" / f"{first}.webp"
    assert path.read_bytes() == b"RIFF....WEBPfirst"
    assert avatars.path_for(settings, first) == path
    # no temp residue next to the finished files
    assert not list((tmp_path / "avatars").glob("*.tmp"))


def test_store_failure_leaves_no_temp_file_and_raises(tmp_path, monkeypatch):
    settings = _settings(tmp_path)

    def broken_replace(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(avatars.os, "replace", broken_replace)
    with pytest.raises(OSError):
        avatars.store(settings, b"RIFF....WEBP")
    assert list((tmp_path / "avatars").iterdir()) == []  # the temp file is removed, nothing is left behind


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
def test_path_for_refuses_anything_but_a_32_hex_id(tmp_path, bad):
    with pytest.raises(ValueError):
        avatars.path_for(_settings(tmp_path), bad)


def test_remove_is_idempotent_and_never_raises(tmp_path):
    settings = _settings(tmp_path)
    avatar_id = avatars.store(settings, b"RIFF....WEBP")
    path = avatars.path_for(settings, avatar_id)
    assert path.exists()

    avatars.remove(settings, avatar_id)
    assert not path.exists()
    avatars.remove(settings, avatar_id)  # missing file: no error
    avatars.remove(settings, "../../outside")  # not an id: no error, no deletion outside the directory


def test_avatar_url_is_relative_and_none_without_an_avatar():
    assert avatars.avatar_url(None) is None
    assert avatars.avatar_url("0" * 32) == "/api/avatars/" + "0" * 32


def test_upload_switch_is_a_hot_accounts_setting_on_by_default(tmp_path):
    assert Settings(_env_file=None).avatar_upload_enabled is True
    spec = SPECS["avatar_upload_enabled"]
    assert spec.group == "accounts"
    assert spec.kind == "bool"
    assert spec.apply == "hot"
    assert spec.env_only is False and spec.secret is False
    # a kill switch must be quick: no step-up or typed confirmation
    assert not spec.danger


def test_env_example_documents_the_switch_with_a_chinese_comment():
    lines = (Path(__file__).resolve().parent.parent / ".env.example").read_text(encoding="utf-8").splitlines()
    idx = next(i for i, line in enumerate(lines) if line.startswith("AVATAR_UPLOAD_ENABLED="))
    assert lines[idx] == "AVATAR_UPLOAD_ENABLED=true"
    comment = lines[idx - 1]
    assert comment.startswith("#") and any("一" <= ch <= "鿿" for ch in comment)
