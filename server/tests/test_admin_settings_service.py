import json

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.admin import settings_service as svc
from app.admin.audit import Actor
from app.models import AdminAudit, RankRuleSet, SettingOverride, SettingRevision
from tests.admin_helpers import ADMIN_ENABLED, assert_no_secrets

ROOT = Actor("root", "superadmin", "s1", "203.0.113.5")
KEY = Fernet.generate_key().decode()


# Ruling: the module fixture honours request.param (foundation note) and pins registration_mode=closed, because the
# Settings default is "open" and the danger test needs a real closed -> open change.
@pytest.fixture
def settings_overrides(request):
    return {**ADMIN_ENABLED, "settings_encryption_key": KEY, "upstream_llm_key": "sk-env-llm-123456",
            "registration_mode": "closed", **getattr(request, "param", {})}


async def _save(app, changes, **kw):
    async with app.state.sessionmaker() as s:
        result = await svc.save(s, app, ROOT, changes, **kw)
        return result


async def test_save_hot_setting_applies_audits_and_bumps_revision(app):
    result = await _save(app, {"rate_limit_per_minute": 25}, reason="spike")
    assert result.changed == ["rate_limit_per_minute"] and result.pending_restart == []
    assert app.state.settings.rate_limit_per_minute == 25 and app.state.limiter.limit == 25
    async with app.state.sessionmaker() as s:
        row = await s.get(SettingOverride, "rate_limit_per_minute")
        assert json.loads(row.value) == 25 and row.revision == result.revision
        audit = (await s.scalars(select(AdminAudit).order_by(AdminAudit.id))).all()
        assert audit[-1].action == "settings.update" and audit[-1].after == {"rate_limit_per_minute": 25}


async def test_restart_setting_is_saved_but_pending(app):
    result = await _save(app, {"asr_stream_max_concurrency": 6})
    assert result.pending_restart == ["asr_stream_max_concurrency"]
    assert app.state.settings.asr_stream_max_concurrency == 3


async def test_pending_restart_can_be_set_back_to_the_running_value(app):
    await _save(app, {"asr_stream_max_concurrency": 6})
    result = await _save(app, {"asr_stream_max_concurrency": 3})  # changed my mind: back to the running value
    assert result.changed == ["asr_stream_max_concurrency"] and result.pending_restart == []
    assert app.state.settings_hub.pending_restart == {}
    async with app.state.sessionmaker() as s:
        assert json.loads((await s.get(SettingOverride, "asr_stream_max_concurrency")).value) == 3
    with pytest.raises(svc.SettingsError) as exc:  # now really nothing to change
        await _save(app, {"asr_stream_max_concurrency": 3})
    assert exc.value.status == 409


async def test_invalid_values_report_fields_and_change_nothing(app):
    with pytest.raises(svc.SettingsError) as exc:
        await _save(app, {"rate_limit_per_minute": 0, "realtime_max_minutes": 5})
    assert exc.value.status == 422 and "rate_limit_per_minute" in exc.value.fields
    assert app.state.settings.realtime_max_minutes == 10
    with pytest.raises(svc.SettingsError) as exc:
        await _save(app, {"default_llm_model": "not-in-the-list"}, reason="x", confirm=None)
    assert exc.value.status == 422


async def test_env_only_and_managed_keys_are_rejected(app):
    with pytest.raises(svc.SettingsError) as exc:
        await _save(app, {"database_url": "sqlite+aiosqlite:///x.db"})
    assert exc.value.status == 400 and exc.value.error == "Setting is read-only"
    async with app.state.sessionmaker() as s:
        s.add(RankRuleSet(version=1, status="published", rules={}, created_by="root"))
        await s.commit()
    with pytest.raises(svc.SettingsError) as exc:
        await _save(app, {"rank_daily_rp_cap": 80})
    assert (exc.value.status, exc.value.error) == (409, "Managed by rank rules")


async def test_danger_needs_step_up_reason_and_typed_confirmation(app):
    with pytest.raises(svc.SettingsError) as exc:
        await _save(app, {"registration_mode": "open"})
    assert (exc.value.status, exc.value.error) == (403, "Step-up required")
    with pytest.raises(svc.SettingsError) as exc:
        await _save(app, {"registration_mode": "open"}, stepped_up=True, reason="ok")
    assert exc.value.status == 409 and exc.value.details["confirm"] == "REGISTRATION_MODE"
    result = await _save(app, {"registration_mode": "open"}, stepped_up=True, reason="活动期间", confirm="REGISTRATION_MODE")
    assert app.state.settings.registration_mode == "open" and result.changed == ["registration_mode"]


def test_danger_rules():
    assert svc.danger_reasons("registration_mode", "closed", "invite") == []
    assert svc.danger_reasons("registration_mode", "closed", "open")
    assert svc.danger_reasons("log_level", "INFO", "WARNING") == []
    assert svc.danger_reasons("log_level", "INFO", "DEBUG")
    assert svc.danger_reasons("upstream_llm_base_url", "https://a.com/v1", "https://a.com/v2") == []
    assert svc.danger_reasons("upstream_llm_base_url", "https://a.com/v1", "https://b.com/v1")
    assert svc.danger_reasons("room_message_retention_days", 0, 30)
    assert svc.danger_reasons("room_message_retention_days", 30, 0) == []
    assert svc.danger_reasons("ai_rate_limit_per_minute", 60, 600) == []
    assert svc.danger_reasons("ai_rate_limit_per_minute", 60, 601)
    assert svc.confirm_phrase(["registration_mode"]) == "REGISTRATION_MODE"
    assert svc.confirm_phrase(["registration_mode", "log_level"]) == "CONFIRM"


async def test_url_host_change_without_key_needs_pair_confirmation(app):
    with pytest.raises(svc.SettingsError) as exc:
        await _save(app, {"upstream_llm_base_url": "https://evil.example/v1"}, stepped_up=True, reason="迁移上游",
                    confirm="UPSTREAM_LLM_BASE_URL")
    assert (exc.value.status, exc.value.error) == (409, "Key would be sent to a new host")
    assert exc.value.details == {"pairs": ["upstream_llm_base_url"], "hosts": {"upstream_llm_base_url": "evil.example"}}
    await _save(app, {"upstream_llm_base_url": "https://new.example/v1", "upstream_llm_key": "sk-new-key-999999"},
                stepped_up=True, reason="迁移上游", confirm="UPSTREAM_LLM_BASE_URL")
    assert app.state.settings.upstream_llm_key == "sk-new-key-999999"
    await _save(app, {"upstream_llm_base_url": "https://other.example/v1"}, stepped_up=True, reason="再次迁移",
                confirm="UPSTREAM_LLM_BASE_URL", confirm_pairs=["upstream_llm_base_url"])
    assert app.state.settings.upstream_llm_key == "sk-new-key-999999"


async def test_secrets_are_encrypted_masked_and_never_listed(app):
    await _save(app, {"upstream_tts_key": "sk-tts-secret-777"}, reason="rotate")
    async with app.state.sessionmaker() as s:
        row = await s.get(SettingOverride, "upstream_tts_key")
        assert row.secret and "sk-tts-secret-777" not in row.value
        listing = await svc.list_settings(s, app)
        audit = [a.after for a in (await s.scalars(select(AdminAudit))).all()]
        revisions = await svc.list_revisions(s)
    assert_no_secrets(listing, app.state.settings)
    assert_no_secrets(audit, app.state.settings)
    assert_no_secrets(revisions, app.state.settings)
    assert "sk-tts-secret-777" not in json.dumps(revisions) and "gAAAA" not in json.dumps(revisions)
    item = next(i for i in listing["items"] if i["key"] == "upstream_tts_key")
    assert item["override_state"]["set"] is True and len(item["override_state"]["fp"]) == 8
    assert "override" not in item and "effective" not in item
    plain = next(i for i in listing["items"] if i["key"] == "rate_limit_per_minute")
    assert plain["effective"] == 1000 and plain["override"] is None and plain["source"] == "env"


async def test_secret_edits_need_encryption_key(app):
    app.state.base_settings = app.state.base_settings.model_copy(update={"settings_encryption_key": ""})
    with pytest.raises(svc.SettingsError) as exc:
        await _save(app, {"upstream_tts_key": "sk-x-000000"})
    assert (exc.value.status, exc.value.error) == (409, "Encryption key not configured")


async def test_reset_to_env_and_revert_with_conflicts(app):
    first = await _save(app, {"max_practice_items": 25, "max_conversations": 300})
    await _save(app, {"max_practice_items": 40})
    with pytest.raises(svc.SettingsError) as exc:
        async with app.state.sessionmaker() as s:
            await svc.revert(s, app, ROOT, first.revision, reason="undo", confirm=None, stepped_up=False,
                             acknowledge_conflicts=False)
    assert exc.value.status == 409 and exc.value.details == {"conflicts": ["max_practice_items"]}
    async with app.state.sessionmaker() as s:
        await svc.revert(s, app, ROOT, first.revision, reason="undo", confirm=None, stepped_up=False,
                         acknowledge_conflicts=True)
        assert await s.get(SettingOverride, "max_conversations") is None  # back to env
        assert (await s.get(SettingRevision, first.revision)).reverted_by is not None
    assert app.state.settings.max_conversations == app.state.base_settings.max_conversations
    await _save(app, {"max_vocab_items": 77})
    await _save(app, {"max_vocab_items": None})
    assert app.state.settings.max_vocab_items == app.state.base_settings.max_vocab_items
    with pytest.raises(svc.SettingsError) as exc:
        await _save(app, {"max_vocab_items": None})  # already on env
    assert (exc.value.status, exc.value.error) == (409, "Nothing to change")


async def test_date_values_round_trip(app):
    await _save(app, {"rank_season_anchor": "2026-12-07"})
    assert str(app.state.settings.rank_season_anchor) == "2026-12-07"
    async with app.state.sessionmaker() as s:
        listing = await svc.list_settings(s, app)
    item = next(i for i in listing["items"] if i["key"] == "rank_season_anchor")
    assert item["override"] == "2026-12-07" and item["source"] == "override"
    json.dumps(listing)


async def test_export_omits_secrets_and_import_previews_and_applies(app):
    await _save(app, {"max_practice_items": 25, "upstream_tts_key": "sk-tts-secret-777"})
    async with app.state.sessionmaker() as s:
        exported = await svc.export_overrides(s, app)
    assert exported["format"] == "enjoy-admin-settings" and exported["version"] == 1
    assert exported["overrides"] == {"MAX_PRACTICE_ITEMS": 25}
    assert exported["secrets_omitted"] == ["UPSTREAM_TTS_KEY"]
    payload = {**exported, "overrides": {"MAX_PRACTICE_ITEMS": 30, "MAX_VOCAB_ITEMS": 10, "DATABASE_URL": "x",
                                         "UPSTREAM_LLM_KEY": "k", "NOPE": 1, "REALTIME_MAX_MINUTES": 999}}
    async with app.state.sessionmaker() as s:
        preview = await svc.import_preview(s, app, payload)
    status = {i["env"]: i["status"] for i in preview["items"]}
    assert status == {"MAX_PRACTICE_ITEMS": "changed", "MAX_VOCAB_ITEMS": "changed", "DATABASE_URL": "read_only",
                      "UPSTREAM_LLM_KEY": "secret", "NOPE": "unknown", "REALTIME_MAX_MINUTES": "invalid"}
    async with app.state.sessionmaker() as s:
        result = await svc.import_apply(s, app, ROOT, payload, reason="同步", confirm=None, stepped_up=False)
    assert sorted(result.changed) == ["max_practice_items", "max_vocab_items"]
    with pytest.raises(svc.SettingsError):
        async with app.state.sessionmaker() as s:
            await svc.import_preview(s, app, {"format": "other", "version": 1, "overrides": {}})


async def test_safe_mode_saves_without_applying(app):
    app.state.settings_hub.safe_mode = True
    await _save(app, {"rate_limit_per_minute": 25})
    assert app.state.settings.rate_limit_per_minute == 1000
    async with app.state.sessionmaker() as s:
        assert await s.get(SettingOverride, "rate_limit_per_minute") is not None


@pytest.mark.parametrize("key,weaker,stronger", [
    ("rate_limit_per_minute", 5000, 5),
    ("admin_lockout_threshold", 20, 3),
    ("admin_lockout_minutes", 1, 60),
    ("admin_step_up_minutes", 30, 1),
    ("admin_idle_minutes", 240, 5),
    ("admin_token_ttl_minutes", 1440, 10),
    ("admin_audit_retention_days", 30, 3650),
])
async def test_weakening_security_settings_needs_step_up_and_confirmation(app, key, weaker, stronger):
    """Review security m1: an idle superadmin session must not quietly remove brute-force or session protections."""
    with pytest.raises(svc.SettingsError) as exc:
        await _save(app, {key: weaker})
    assert exc.value.status == 403 and exc.value.error == "Step-up required"
    with pytest.raises(svc.SettingsError) as exc:
        await _save(app, {key: weaker}, stepped_up=True)
    assert exc.value.status == 409 and exc.value.details["confirm"] == key.upper()
    await _save(app, {key: weaker}, stepped_up=True, reason="有意放宽", confirm=key.upper())
    await _save(app, {key: stronger})  # tightening stays a plain save


async def test_changing_the_invite_code_needs_step_up(app):
    with pytest.raises(svc.SettingsError) as exc:
        await _save(app, {"invite_code": "new-invite-code"})
    assert exc.value.status == 403
