"""管理端「跟读库」(计划 docs/superpowers/plans/2026-10-13-video-import-admin.md;spec 2026-10-13-video-import §5.2、§12、E10)。

条目直接写库造数据(学习者端点由 S1 测);删除与取消经 S1 的 `app.library.store`(计划 R-A3)。"""
import os
import stat
from dataclasses import replace

import pytest

from app.admin.doctor import CODES, _cookies_state, diagnose
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.conftest import make_settings
from tests.test_admin_doctor import OK

LIBRARY_CODES = {"library_ffmpeg_missing", "library_ytdlp_missing", "library_asr_unavailable", "library_cookies_missing"}
NO_ASR = {"upstream_whisper_base_url": ""}  # make_settings 默认配了 Whisper;流式识别默认没开


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "data"), "library_enabled": True}


def lib_codes(settings, facts=OK) -> dict:
    return {f.code: f for f in diagnose(settings, facts) if f.code.startswith("library_")}


def fake_stat(mode: int):
    return lambda _path: os.stat_result((mode, 0, 0, 1, 0, 0, 10, 0, 0, 0))


def test_new_codes_are_registered():
    assert LIBRARY_CODES <= set(CODES)


def test_nothing_is_reported_while_the_library_is_off():
    facts = replace(OK, library_ffmpeg_ok=False, library_ytdlp_ok=False, library_cookies="missing")
    s = make_settings(library_enabled=False, library_link_import_enabled=True, library_asr_enabled=True,
                      library_ytdlp_cookies_file="/srv/cookies.txt", **NO_ASR)
    assert lib_codes(s, facts) == {}


def test_healthy_library_has_no_findings():
    s = make_settings(library_enabled=True, library_link_import_enabled=True, library_asr_enabled=True)
    assert lib_codes(s) == {}


def test_missing_ffmpeg_is_an_error():
    found = lib_codes(make_settings(library_enabled=True), replace(OK, library_ffmpeg_ok=False))
    assert set(found) == {"library_ffmpeg_missing"}
    assert found["library_ffmpeg_missing"].level == "error"
    assert found["library_ffmpeg_missing"].keys == ("library_enabled",)


def test_missing_ytdlp_only_matters_with_link_import_on():
    facts = replace(OK, library_ytdlp_ok=False)
    assert lib_codes(make_settings(library_enabled=True), facts) == {}
    found = lib_codes(make_settings(library_enabled=True, library_link_import_enabled=True), facts)
    assert found["library_ytdlp_missing"].level == "warn"
    assert found["library_ytdlp_missing"].keys == ("library_link_import_enabled",)


def test_asr_switch_without_a_recognizer():
    assert lib_codes(make_settings(library_enabled=True, library_asr_enabled=True)) == {}  # Whisper 已配
    found = lib_codes(make_settings(library_enabled=True, library_asr_enabled=True, **NO_ASR))
    assert found["library_asr_unavailable"].level == "warn"
    assert found["library_asr_unavailable"].keys == ("library_asr_enabled",)
    assert lib_codes(make_settings(library_enabled=True, **NO_ASR)) == {}  # 子开关没开就不报


def test_cookie_file_states():
    assert _cookies_state("") == "unset"
    assert _cookies_state("   ") == "unset"
    assert _cookies_state(None) == "unset"

    def boom(_path):
        raise FileNotFoundError("nope")

    assert _cookies_state("/x", stat_fn=boom, posix=True) == "missing"
    assert _cookies_state("/x", stat_fn=fake_stat(stat.S_IFDIR | 0o700), posix=True) == "missing"
    assert _cookies_state("/x", stat_fn=fake_stat(stat.S_IFREG | 0o644), posix=True) == "too_open"
    assert _cookies_state("/x", stat_fn=fake_stat(stat.S_IFREG | 0o600), posix=True) == "ok"
    assert _cookies_state("/x", stat_fn=fake_stat(stat.S_IFREG | 0o400), posix=True) == "ok"
    assert _cookies_state("/x", stat_fn=fake_stat(stat.S_IFREG | 0o644), posix=False) == "ok"  # Windows 不判权限


def test_cookie_findings_never_echo_the_path():
    path = "/srv/secret-dir/yt-cookies.txt"
    s = make_settings(library_enabled=True, library_ytdlp_cookies_file=path)
    messages = set()
    for state in ("missing", "too_open"):
        found = lib_codes(s, replace(OK, library_cookies=state))
        assert set(found) == {"library_cookies_missing"}
        assert found["library_cookies_missing"].level == "warn"
        assert found["library_cookies_missing"].keys == ("library_ytdlp_cookies_file",)
        assert path not in found["library_cookies_missing"].message_zh
        messages.add(found["library_cookies_missing"].message_zh)
    assert len(messages) == 2  # 不存在与权限过宽是两种文案
    assert lib_codes(s, replace(OK, library_cookies="ok")) == {}


async def test_doctor_endpoint_gathers_library_facts(app, client, monkeypatch):
    monkeypatch.setattr("app.admin.doctor._library_ffmpeg_ok", lambda: False)
    monkeypatch.setattr("app.admin.doctor._library_ytdlp_ok", lambda: True)
    await login_as(app, client, "viewer")
    r = await client.get("/api/admin/doctor")
    assert r.status_code == 200, r.text
    found = {f["code"]: f for f in r.json()["findings"]}
    assert found["library_ffmpeg_missing"]["level"] == "error"
    assert "library_ytdlp_missing" not in found and "library_cookies_missing" not in found
