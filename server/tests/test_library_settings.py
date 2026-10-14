"""跟读库的设置、配额键与计量前缀(spec 2026-10-13-video-import §5.2、§2.2)。"""
import pytest

from app.core import config as config_module
from app.core import metering
from app.core.config import Settings
from app.core.quotas import QUOTA_KEYS
from app.core.settings_registry import ENV_ONLY, GROUPS, SECRETS, SPECS, field_bounds

LIBRARY_KEYS = {
    "library_enabled", "library_asr_enabled", "library_link_import_enabled", "library_quota_mb", "library_max_items",
    "library_max_upload_mb", "library_max_duration_minutes", "library_asr_minutes_daily_per_user",
    "library_asr_minutes_global_daily", "library_imports_daily_per_user", "library_job_concurrency",
    "library_transcode_max_height", "library_link_timeout_minutes", "library_link_allow_generic",
    "library_ytdlp_cookies_file", "library_ytdlp_proxy",
    # D8(spec §5.2):每句译文与句子分析
    "library_ai_enabled", "library_translate_daily_per_user", "library_analysis_daily_per_user",
    "library_ai_daily_global",
    # 精选库(spec 2026-10-14-curated-library)
    "library_catalog_enabled", "library_catalog_ai_daily",
}


def test_defaults_match_the_spec():
    s = Settings(_env_file=None)
    assert (s.library_enabled, s.library_asr_enabled, s.library_link_import_enabled, s.library_link_allow_generic,
            s.library_ai_enabled) == (False, False, False, False, False)
    assert (s.library_translate_daily_per_user, s.library_analysis_daily_per_user, s.library_ai_daily_global) == (
        500, 30, 5000)
    assert (s.library_quota_mb, s.library_max_items, s.library_max_upload_mb, s.library_max_duration_minutes,
            s.library_asr_minutes_daily_per_user, s.library_asr_minutes_global_daily, s.library_imports_daily_per_user,
            s.library_job_concurrency, s.library_transcode_max_height, s.library_link_timeout_minutes) == (
        2000, 100, 500, 90, 60, 600, 20, 1, 720, 20)
    assert (s.library_ytdlp_cookies_file, s.library_ytdlp_proxy) == ("", "")


def test_bounds_match_the_spec():
    assert field_bounds("library_quota_mb") == (1, 1_000_000)
    assert field_bounds("library_max_items") == (1, 10_000)
    assert field_bounds("library_max_upload_mb") == (1, 20_000)
    assert field_bounds("library_max_duration_minutes") == (1, 600)
    assert field_bounds("library_asr_minutes_daily_per_user") == (0, 2000)
    assert field_bounds("library_asr_minutes_global_daily") == (0, 100_000)
    assert field_bounds("library_imports_daily_per_user") == (0, 1000)
    assert field_bounds("library_job_concurrency") == (1, 4)
    assert field_bounds("library_transcode_max_height") == (240, 1080)
    assert field_bounds("library_link_timeout_minutes") == (1, 120)
    assert field_bounds("library_translate_daily_per_user") == (0, 20_000)
    assert field_bounds("library_analysis_daily_per_user") == (0, 1000)
    assert field_bounds("library_ai_daily_global") == (0, 1_000_000)
    assert field_bounds("library_catalog_ai_daily") == (0, 100_000)


def test_registry_entries():
    assert {k for k in Settings.model_fields if k.startswith("library_")} == LIBRARY_KEYS
    assert ("library", "跟读库") in GROUPS
    assert SPECS["library_enabled"].group == "features"
    assert {k for k in LIBRARY_KEYS if SPECS[k].group == "library"} == LIBRARY_KEYS - {"library_enabled"}
    assert {k for k in LIBRARY_KEYS if k in ENV_ONLY} == {"library_ytdlp_cookies_file", "library_ytdlp_proxy"}
    assert {k for k in LIBRARY_KEYS if k in SECRETS} == {"library_ytdlp_proxy"}
    hot = LIBRARY_KEYS - ENV_ONLY
    assert all(SPECS[k].apply == "hot" for k in hot)
    for key in ("library_asr_enabled", "library_link_import_enabled", "library_link_allow_generic",
                "library_asr_minutes_global_daily", "library_enabled", "library_ai_enabled", "library_ai_daily_global"):
        assert SPECS[key].danger, key
    assert "网址" in SPECS["library_link_import_enabled"].danger


def test_quota_keys_and_metering_prefix():
    assert QUOTA_KEYS["library_quota_mb"] == "library_quota_mb"
    assert QUOTA_KEYS["library_max_items"] == "library_max_items"
    assert metering.feature_for("/api/library/uploads") == "library"
    assert metering.feature_for("/api/libraryx") == "other"


@pytest.mark.parametrize("tools, enabled, expected", [(True, True, True), (False, True, False), (True, False, False)])
def test_library_available_needs_the_switch_and_ffmpeg(monkeypatch, tools, enabled, expected):
    monkeypatch.setattr(config_module, "media_tools_present", lambda: tools)
    assert Settings(_env_file=None, library_enabled=enabled).library_available is expected


def test_asr_available_needs_the_sub_switch_and_a_recognizer():
    no_asr = dict(upstream_whisper_base_url="", upstream_asr_mode="chat")
    assert Settings(_env_file=None, library_asr_enabled=True, **no_asr).library_asr_available is False
    whisper = dict(upstream_whisper_base_url="https://w.test/v1")
    assert Settings(_env_file=None, library_asr_enabled=True, **whisper).library_asr_available is True
    assert Settings(_env_file=None, library_asr_enabled=False, **whisper).library_asr_available is False
    volc = dict(upstream_asr_mode="volc_stream", volcengine_asr_key="k")
    assert Settings(_env_file=None, library_asr_enabled=True, **volc).library_asr_available is True


@pytest.mark.parametrize("present, enabled, expected", [(True, True, True), (False, True, False), (True, False, False)])
def test_link_available_needs_the_sub_switch_and_yt_dlp(monkeypatch, present, enabled, expected):
    monkeypatch.setattr(config_module, "ytdlp_present", lambda: present)
    assert Settings(_env_file=None, library_link_import_enabled=enabled).library_link_available is expected


@pytest.mark.parametrize("library, ai, llm, expected", [
    (True, True, "https://llm.test/v1", True), (False, True, "https://llm.test/v1", False),
    (True, False, "https://llm.test/v1", False), (True, True, "", False)])
def test_ai_available_needs_both_switches_and_a_configured_llm(library, ai, llm, expected):
    """D8:译文 / 分析调大模型;不需要 ffmpeg(已经处理好的条目在没有 ffmpeg 的机器上也能译)。"""
    s = Settings(_env_file=None, library_enabled=library, library_ai_enabled=ai, upstream_llm_base_url=llm)
    assert s.library_ai_available is expected
