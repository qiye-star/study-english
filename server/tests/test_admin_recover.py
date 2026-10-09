import json

from app.admin import recover
from app.models import SettingOverride


async def test_clear_overrides_and_audit(app, monkeypatch):
    async with app.state.sessionmaker() as s:
        s.add(SettingOverride(key="rate_limit_per_minute", value=json.dumps(5), secret=False, env_fp="", revision=1, updated_by="t"))
        await s.commit()
    monkeypatch.setattr(recover, "_sessionmaker", lambda: app.state.sessionmaker)
    assert await recover.run(["list-overrides"]) == 0
    assert await recover.run(["clear-overrides", "--key", "rate_limit_per_minute"]) == 0
    async with app.state.sessionmaker() as s:
        assert await s.get(SettingOverride, "rate_limit_per_minute") is None


async def test_unlock_reset_totp_revoke_and_rotate(app, monkeypatch, capsys):
    from datetime import datetime, timezone

    from cryptography.fernet import Fernet
    from sqlalchemy import func, select

    from app.admin.audit import verify
    from app.core.secretbox import SecretBox
    from app.models import AdminAccount, AdminAudit, AdminLoginState, AdminSession, ConfigRevision

    old_key, new_key = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    now = datetime.now(timezone.utc)
    async with app.state.sessionmaker() as s:
        s.add(AdminAccount(id=7, username="ops", password_hash="x", role="operator", created_by="t",
                           totp_enc=SecretBox(old_key).encrypt("TOTPSECRET")))
        s.add(AdminLoginState(username="ops", ip="1.2.3.4", failures=0, lock_level=1, locked_until=now))
        s.add(AdminSession(id="s1", token_hash="h", account_id=7, username="ops", expires_at=now, ip="i",
                           user_agent="u", csrf_hash="c"))
        s.add(SettingOverride(key="upstream_llm_key", value=SecretBox(old_key).encrypt("sk-live-123456"), secret=True,
                              env_fp="", revision=1, updated_by="t"))
        await s.commit()
    monkeypatch.setattr(recover, "_sessionmaker", lambda: app.state.sessionmaker)
    assert await recover.run(["rotate-key", "--old", Fernet.generate_key().decode(), "--new", new_key]) == 1
    assert await recover.run(["rotate-key", "--old", old_key, "--new", new_key]) == 0
    assert await recover.run(["unlock", "OPS"]) == 0
    assert await recover.run(["revoke-sessions"]) == 0
    assert await recover.run(["reset-totp", "ops"]) == 0
    assert await recover.run(["reset-totp", "ghost"]) == 1
    out = capsys.readouterr()
    assert "sk-live-123456" not in out.out + out.err and old_key not in out.out + out.err
    async with app.state.sessionmaker() as s:
        row = await s.get(SettingOverride, "upstream_llm_key")
        assert SecretBox(new_key).decrypt(row.value) == "sk-live-123456"
        assert (await s.get(AdminAccount, 7)).totp_enc is None
        assert await s.scalar(select(func.count()).select_from(AdminLoginState)) == 0
        assert (await s.get(AdminSession, "s1")).revoked_at is not None
        assert (await s.get(ConfigRevision, "settings")).revision == 1
        actions = list(await s.scalars(select(AdminAudit.action).order_by(AdminAudit.id)))
        assert actions == ["settings.cli_rotate_key", "auth.cli_unlock", "auth.cli_revoke_all", "auth.cli_reset_totp"]
        assert await verify(s) == (True, None)
