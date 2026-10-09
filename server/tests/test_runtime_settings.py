import json

import pytest
from cryptography.fernet import Fernet

from app.core.runtime_settings import (
    OverrideError, SettingsHub, coerce, compose, load_overrides, reload_from_db, runtime_problems,
)
from app.core.secretbox import SecretBox
from app.core.settings_registry import SPECS
from app.models import SettingOverride
from tests.conftest import make_settings

KEY = Fernet.generate_key().decode()


def test_compose_overrides_win_and_are_validated_by_settings():
    base = make_settings(rate_limit_per_minute=10)
    s = compose(base, {"rate_limit_per_minute": 20, "registration_mode": "invite", "invite_code": "abc"})
    assert (s.rate_limit_per_minute, s.registration_mode) == (20, "invite")
    assert base.rate_limit_per_minute == 10  # base untouched
    with pytest.raises(OverrideError) as exc:
        compose(base, {"realtime_max_minutes": 999})  # Field(le=60)
    assert "realtime_max_minutes" in exc.value.fields


def test_compose_enforces_registry_bounds_and_hides_secret_values():
    base = make_settings()
    with pytest.raises(OverrideError) as exc:
        compose(base, {"rate_limit_per_minute": 0})
    assert "rate_limit_per_minute" in exc.value.fields
    with pytest.raises(OverrideError) as exc:
        compose(base, {"settings_encryption_key": "x"})  # env-only
    assert exc.value.fields == {"settings_encryption_key": "Setting is read-only"}


def test_coerce_normalises_csv_urls_and_rejects_credentials_in_urls():
    assert coerce(SPECS["llm_models"], " a, b ,,a ") == "a,b"
    assert coerce(SPECS["upstream_llm_base_url"], " https://api.deepseek.com/v1 ") == "https://api.deepseek.com/v1"
    for bad in ("ftp://x", "https://user:pw@host/v1", "https://host/v1#frag", "javascript:alert(1)"):
        with pytest.raises(OverrideError):
            coerce(SPECS["upstream_llm_base_url"], bad)
    assert coerce(SPECS["xfyun_ws_url"], "wss://ise-api.xfyun.cn/v2/open-ise").startswith("wss://")
    with pytest.raises(OverrideError):
        coerce(SPECS["usage_prices_json"], "{not json")
    with pytest.raises(OverrideError):
        coerce(SPECS["maintenance_message_zh"], "长" * 281)


def test_runtime_problems_match_create_app_rules():
    assert runtime_problems(make_settings(registration_mode="invite", invite_code="")) == [
        "REGISTRATION_MODE=invite requires INVITE_CODE"]
    assert runtime_problems(make_settings(default_llm_model="nope")) == ["DEFAULT_LLM_MODEL must be one of LLM_MODELS"]


class State:
    def __init__(self, settings):
        self.settings = settings


def test_hub_publishes_prepares_and_keeps_restart_keys():
    state = State(make_settings(rate_limit_per_minute=10, asr_stream_max_concurrency=3))
    hub = SettingsHub(state)
    seen = []
    hub.subscribe("limiter", lambda old, new: seen.append((old.rate_limit_per_minute, new.rate_limit_per_minute)),
                  keys=frozenset({"rate_limit_per_minute"}))
    hub.subscribe("other", lambda old, new: seen.append("other"), keys=frozenset({"log_level"}))
    new = compose(state.settings, {"rate_limit_per_minute": 30, "asr_stream_max_concurrency": 8})
    assert hub.publish(new) == []
    assert state.settings.rate_limit_per_minute == 30
    assert state.settings.asr_stream_max_concurrency == 3  # restart key keeps the old value
    assert hub.pending_restart == {"asr_stream_max_concurrency": 8}
    assert seen == [(10, 30)]


def test_hub_prepare_failure_aborts_and_apply_failure_is_reported():
    state = State(make_settings())
    hub = SettingsHub(state)

    def bad_prepare(new):
        raise RuntimeError("GRAMMAR_PROMPT is longer than 4000 characters")

    hub.subscribe("grammar", lambda o, n: None, keys=frozenset({"grammar_prompt"}), prepare=bad_prepare)
    with pytest.raises(OverrideError):
        hub.prepare(compose(state.settings, {"grammar_prompt": "x"}))

    def boom(old, new):
        raise ValueError("secret-value-should-not-leak")

    hub2 = SettingsHub(state)
    hub2.subscribe("boom", boom, keys=frozenset({"log_level"}))
    assert hub2.publish(compose(state.settings, {"log_level": "WARNING"})) == ["boom: ValueError"]
    assert state.settings.log_level == "WARNING"


async def test_load_overrides_skips_invalid_and_undecryptable(app):
    box = SecretBox(KEY)
    other = SecretBox(Fernet.generate_key().decode())
    async with app.state.sessionmaker() as s:
        s.add_all([
            SettingOverride(key="rate_limit_per_minute", value=json.dumps(25), secret=False, env_fp="", revision=1, updated_by="t"),
            SettingOverride(key="realtime_max_minutes", value=json.dumps(999), secret=False, env_fp="", revision=1, updated_by="t"),
            SettingOverride(key="upstream_llm_key", value=box.encrypt("sk-new"), secret=True, env_fp="", revision=1, updated_by="t"),
            SettingOverride(key="upstream_tts_key", value=other.encrypt("sk-x"), secret=True, env_fp="", revision=1, updated_by="t"),
            SettingOverride(key="no_such_setting", value="1", secret=False, env_fp="", revision=1, updated_by="t"),
        ])
        await s.commit()
        values, invalid = await load_overrides(s, box)
    assert values == {"rate_limit_per_minute": 25, "upstream_llm_key": "sk-new"}
    assert invalid == {"realtime_max_minutes": "invalid", "upstream_tts_key": "undecryptable", "no_such_setting": "unknown"}


@pytest.mark.parametrize("settings_overrides", [{"settings_encryption_key": KEY}], indirect=True)
async def test_reload_from_db_applies_and_safe_mode_ignores(app):
    async with app.state.sessionmaker() as s:
        s.add(SettingOverride(key="rate_limit_per_minute", value="42", secret=False, env_fp="", revision=1, updated_by="t"))
        await s.commit()
    await reload_from_db(app, startup=True)
    assert app.state.settings.rate_limit_per_minute == 42
    assert app.state.limiter.limit == 42
    app.state.base_settings = app.state.base_settings.model_copy(update={"admin_settings_safe_mode": True})
    await reload_from_db(app)
    assert app.state.settings.rate_limit_per_minute == app.state.base_settings.rate_limit_per_minute
    assert app.state.settings_hub.safe_mode is True


async def test_startup_hooks_run_once_each_and_failures_are_isolated(app):
    from app.core import runtime_settings as rs

    seen = []

    async def ok(app_):
        seen.append("ok")

    async def boom(app_):
        raise RuntimeError("x")

    saved = list(rs.STARTUP_HOOKS)
    try:
        rs.register_startup_hook(ok)
        rs.register_startup_hook(ok)
        rs.register_startup_hook(boom)
        await rs.run_startup_hooks(app)
    finally:
        rs.STARTUP_HOOKS[:] = saved
    assert seen == ["ok"]


async def test_revision_poll_reloads_settings_and_runs_callbacks(app):
    from app.core.runtime_settings import bump_revision, check_revisions, on_revision

    calls = []

    async def rank_changed():
        calls.append("rank")

    def broken():
        raise RuntimeError("x")

    on_revision(app, "rank_rules", broken)
    on_revision(app, "rank_rules", rank_changed)
    on_revision(app, "rank_rules", rank_changed)  # registered once
    seen = await check_revisions(app, None)  # first poll only records
    async with app.state.sessionmaker() as s:
        s.add(SettingOverride(key="rate_limit_per_minute", value="77", secret=False, env_fp="", revision=1, updated_by="t"))
        assert await bump_revision(s, "settings") == 1
        await bump_revision(s, "rank_rules")
        await s.commit()
    seen = await check_revisions(app, seen)
    assert seen == {"settings": 1, "rank_rules": 1}
    assert app.state.settings.rate_limit_per_minute == 77
    assert calls == ["rank"]
    await check_revisions(app, seen)
    assert calls == ["rank"]  # unchanged revisions do nothing


async def test_reload_survives_a_database_without_the_overrides_table(app):
    from sqlalchemy import text

    async with app.state.engine.begin() as conn:
        await conn.execute(text("DROP TABLE setting_overrides"))
    before = app.state.settings
    await reload_from_db(app, startup=True)
    assert app.state.settings is before
    assert app.state.settings_hub.load_error
