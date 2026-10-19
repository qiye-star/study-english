"""Plan A2b: the SMTP host (and port) decide where the stored SMTP password is sent, so changing them without
re-entering the password is guarded exactly like the URL-kind upstream hosts."""
import json

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.models import AdminAudit, SettingRevision
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as

OLD_PASSWORD = "old-authcode-AAA111"
NEW_PASSWORD = "new-authcode-BBB222"
PAIR_ERROR = "Key would be sent to a new host"


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED, "settings_encryption_key": Fernet.generate_key().decode(), "registration_mode": "closed",
            "smtp_host": "smtp.mailhost.test", "smtp_port": 465, "smtp_user": "noreply@mailhost.test",
            "smtp_password": OLD_PASSWORD}


async def _su(app, client) -> dict:
    h = await login_as(app, client, "superadmin")
    assert (await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})).status_code == 200
    return h


async def _patch(client, h, changes, **extra):
    return await client.patch("/api/admin/settings", headers=h, json={"changes": changes, "reason": "迁移发信服务", **extra})


async def test_host_change_without_the_password_is_rejected(app, client):
    h = await _su(app, client)
    r = await _patch(client, h, {"smtp_host": "evil.example"}, confirm="SMTP_HOST")
    assert r.status_code == 409 and r.json()["error"] == PAIR_ERROR
    assert r.json()["details"] == {"pairs": ["smtp_host"], "hosts": {"smtp_host": "evil.example"}}
    assert app.state.settings.smtp_host == "smtp.mailhost.test"
    assert OLD_PASSWORD not in r.text


async def test_host_change_with_the_password_in_the_same_save_is_accepted(app, client):
    h = await _su(app, client)
    r = await _patch(client, h, {"smtp_host": "smtp.other.test", "smtp_password": NEW_PASSWORD}, confirm="SMTP_HOST")
    assert r.status_code == 200, r.text
    assert app.state.settings.smtp_host == "smtp.other.test" and app.state.settings.smtp_password == NEW_PASSWORD


async def test_host_change_can_be_confirmed_explicitly_like_url_settings(app, client):
    h = await _su(app, client)
    r = await _patch(client, h, {"smtp_host": "smtp.other.test"}, confirm="SMTP_HOST", confirm_pairs=["smtp_host"])
    assert r.status_code == 200 and app.state.settings.smtp_password == OLD_PASSWORD


async def test_host_change_needs_step_up_and_a_typed_confirmation(app, client):
    h = await login_as(app, client, "superadmin")
    r = await _patch(client, h, {"smtp_host": "smtp.other.test", "smtp_password": NEW_PASSWORD})
    assert r.status_code == 403 and r.json() == {"error": "Step-up required"}
    assert (await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})).status_code == 200
    r = await _patch(client, h, {"smtp_host": "smtp.other.test", "smtp_password": NEW_PASSWORD})
    assert r.status_code == 409 and r.json()["details"]["confirm"] == "SMTP_HOST"


async def test_port_change_without_the_password_is_rejected_with_it_accepted(app, client):
    h = await _su(app, client)
    r = await _patch(client, h, {"smtp_port": 25}, confirm="SMTP_PORT")
    assert r.status_code == 409 and r.json()["error"] == PAIR_ERROR and r.json()["details"]["pairs"] == ["smtp_port"]
    assert app.state.settings.smtp_port == 465
    r = await _patch(client, h, {"smtp_port": 587, "smtp_password": NEW_PASSWORD}, confirm="SMTP_PORT")
    assert r.status_code == 200 and app.state.settings.smtp_port == 587


async def test_case_only_host_change_and_other_smtp_settings_are_not_guarded(app, client):
    h = await _su(app, client)
    r = await _patch(client, h, {"smtp_user": "other@mailhost.test", "smtp_security": "starttls", "smtp_from": "x@y.test"})
    assert r.status_code == 200, r.text
    r = await _patch(client, h, {"smtp_host": "SMTP.MailHost.test"})
    assert r.status_code in (200, 409) and r.json().get("error") != PAIR_ERROR


async def test_first_time_setup_without_a_stored_password_needs_no_pair(app, client):
    app.state.settings = app.state.settings.model_copy(update={"smtp_password": ""})
    h = await _su(app, client)
    r = await _patch(client, h, {"smtp_host": "smtp.other.test"}, confirm="SMTP_HOST")
    assert r.status_code == 200, r.text


async def test_host_tricks_cannot_pass_as_the_same_host(app, client):
    h = await _su(app, client)
    for trick in ("smtp.mailhost.test@evil.example", "smtp.mailhost.test:25", "smtp.mailhost.test/x", "smtp.mailhost.test#"):
        r = await _patch(client, h, {"smtp_host": trick}, confirm="SMTP_HOST")
        assert r.status_code in (409, 422), trick
        assert r.status_code == 422 or r.json()["error"] == PAIR_ERROR, trick
        assert app.state.settings.smtp_host == "smtp.mailhost.test"


async def test_probe_with_an_unsaved_smtp_host_needs_step_up_and_confirmation(app, client, monkeypatch):
    from app.admin import probes as probes_mod
    from app.admin.probes import ProbeResult

    calls = []

    async def fake_probe(s, upstream, **kw):
        calls.append((upstream, s.smtp_host, s.smtp_password))
        return ProbeResult(True, 0, 5, "ok")

    monkeypatch.setattr(probes_mod, "probe", fake_probe)
    h = await login_as(app, client, "superadmin")
    r = await client.post("/api/admin/probes/smtp", headers=h, json={"values": {"smtp_host": "evil.example"}})
    assert r.status_code == 403 and calls == []
    assert (await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})).status_code == 200
    r = await client.post("/api/admin/probes/smtp", headers=h, json={"values": {"smtp_host": "evil.example"}})
    assert r.status_code == 409 and r.json()["details"]["pairs"] == ["smtp_host"] and calls == []
    r = await client.post("/api/admin/probes/smtp", headers=h,
                          json={"values": {"smtp_host": "evil.example", "smtp_password": NEW_PASSWORD}})
    assert r.status_code == 200 and calls == [("smtp", "evil.example", NEW_PASSWORD)]


async def test_audit_and_revision_history_never_contain_the_password(app, client):
    h = await _su(app, client)
    assert (await _patch(client, h, {"smtp_host": "smtp.other.test", "smtp_password": NEW_PASSWORD},
                         confirm="SMTP_HOST")).status_code == 200
    assert (await _patch(client, h, {"smtp_host": "evil.example"}, confirm="SMTP_HOST")).status_code == 409
    revisions = (await client.get("/api/admin/settings/revisions", headers=h)).text
    listing = (await client.get("/api/admin/settings", headers=h)).text
    async with app.state.sessionmaker() as s:
        rows = [json.dumps([a.before, a.after, a.summary, a.reason], default=str)
                for a in (await s.scalars(select(AdminAudit))).all()]
        rows += [json.dumps(r.changes, default=str) for r in (await s.scalars(select(SettingRevision))).all()]
    for blob in (revisions, listing, *rows):
        assert OLD_PASSWORD not in blob and NEW_PASSWORD not in blob
