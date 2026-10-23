"""Privacy sweep for the accounts v2 flows (plan Z1).

One pass through register, login, nickname, password change, reset, change email, bind, forced binding (403),
admin clear and the SMTP probe, with distinctive test values. Afterwards none of those values may appear in:
the DEBUG `app` log (caplog and the admin log buffer), any error response body, the admin audit rows, the settings
revision rows, or the contract fixture. Access tokens are returned to their owner by design, so they are only
checked against the logs, the audit and the revision rows.

Six-digit codes are matched as whole tokens (`contains_code`); emails and nicknames case-insensitively; passwords,
the pepper, the SMTP password and the settings key by exact substring.
"""
import json
import logging
import re
import smtplib
from pathlib import Path

import pytest
from sqlalchemy import select

from app.admin import probes as probes_mod
from app.core import log_buffer
from app.models import AdminAudit, SettingRevision
from tests.accounts_helpers import PEPPER, contains_code, enable_email, fake_sender, last_code, register_body
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD as ADMIN_PASSWORD, login_as
from tests.background import drain_background
from tests.test_admin_probes import fake_smtp  # noqa: F401  (fixture: patches smtplib)

FIXTURE_TEXT = (Path(__file__).parent / "fixtures" / "accounts_contract.json").read_text(encoding="utf-8")

REG_EMAIL = "sweep.user@example.test"
BIND_EMAIL = "sweep.bind@example.test"
CHANGE_EMAIL = "sweep.change@example.test"
NICK = "Sweepy7Nick"
PASSWORD = "Sweep-Pass-7fQ2!xyz"
NEW_PASSWORD = "Sweep-NewPass-9kT4!abc"
RESET_PASSWORD = "Sweep-Reset-3mW8!pq"
LEGACY_PASSWORD = "Sweep-Legacy-5vB6!hj"
WRONG_PASSWORD = "Sweep-Wrong-0000!zz"
SMTP_PASSWORD = "smtp-sweep-authcode-ZX81"
SMTP_HOST = "smtp.sweep-mail.test"
PAST_DEADLINE = "2020-01-01T00:00:00+00:00"  # already passed: enforcement is on


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED}


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_no_sensitive_value_reaches_logs_errors_audit_revisions_or_fixture(app, client, caplog, fake_smtp,
                                                                                 monkeypatch):
    caplog.set_level(logging.DEBUG, logger="app")
    log_buffer.install()
    log_buffer.BUFFER.clear()
    enable_email(app, email_registration_required=True)
    errors: list[str] = []

    def keep(r):
        if r.status_code >= 400:
            errors.append(r.text)
        return r

    async def mailed_code(email: str, purpose: str, headers=None, **extra) -> str:
        """Ask for a code (public route, or signed-in route for bind / change) and return the code that was mailed."""
        if purpose in ("bind", "change_email"):
            r = await client.post("/api/me/email/code", headers=headers,
                                  json={"email": email, "purpose": purpose, **extra})
        else:
            r = await client.post("/api/email/code", json={"email": email, "purpose": purpose})
        keep(r)
        assert r.status_code == 200, r.text
        await drain_background(app)
        return last_code(app, email)

    # --- register with email: a wrong code first (error body), then the real one
    code = await mailed_code(REG_EMAIL, "register")
    wrong = keep(await client.post("/api/users", json=register_body(REG_EMAIL, "000000", username="sweeper",
                                                                     password=PASSWORD, nickname=NICK)))
    assert wrong.status_code == 400
    r = keep(await client.post("/api/users", json=register_body(REG_EMAIL, code, username="sweeper",
                                                                password=PASSWORD, nickname=NICK)))
    assert r.status_code == 200, r.text
    tokens = [r.json()["access_token"]]

    # --- login by username and by email; a wrong password by email (error body)
    assert keep(await client.post("/api/sessions", json={"provider": "password", "username": "sweeper",
                                                         "password": PASSWORD})).status_code == 200
    assert keep(await client.post("/api/sessions", json={"provider": "password", "username": REG_EMAIL,
                                                         "password": PASSWORD})).status_code == 200
    bad = keep(await client.post("/api/sessions", json={"provider": "password", "username": REG_EMAIL,
                                                        "password": WRONG_PASSWORD}))
    assert bad.status_code >= 400

    # --- nickname change, then password change (wrong current password first)
    headers = _bearer(tokens[0])
    assert keep(await client.patch("/api/me", headers=headers, json={"nickname": NICK})).status_code == 200
    wrong_pw = keep(await client.post("/api/me/password", headers=headers,
                                      json={"current_password": WRONG_PASSWORD, "new_password": NEW_PASSWORD}))
    assert wrong_pw.status_code >= 400
    r = keep(await client.post("/api/me/password", headers=headers,
                               json={"current_password": PASSWORD, "new_password": NEW_PASSWORD}))
    assert r.status_code == 200, r.text
    tokens.append(r.json()["access_token"])

    # --- password reset by email code (a wrong code first)
    rcode = await mailed_code(REG_EMAIL, "reset")
    wrong_reset = keep(await client.post("/api/password/reset", json={
        "email": REG_EMAIL, "code": "000000", "new_password": RESET_PASSWORD}))
    assert wrong_reset.status_code == 400
    r = keep(await client.post("/api/password/reset", json={
        "email": REG_EMAIL, "code": rcode, "new_password": RESET_PASSWORD}))
    assert r.status_code == 204, r.text
    r = keep(await client.post("/api/sessions", json={"provider": "password", "username": REG_EMAIL,
                                                      "password": RESET_PASSWORD}))
    assert r.status_code == 200
    tokens.append(r.json()["access_token"])
    headers = _bearer(tokens[-1])

    # --- change the bound email: needs the current password; a wrong code first, then the real one
    ccode = await mailed_code(CHANGE_EMAIL, "change_email", headers=headers, current_password=RESET_PASSWORD)
    wrong_change = keep(await client.post("/api/me/email", headers=headers, json={
        "email": CHANGE_EMAIL, "code": "000000", "purpose": "change_email", "current_password": RESET_PASSWORD}))
    assert wrong_change.status_code == 400
    r = keep(await client.post("/api/me/email", headers=headers, json={
        "email": CHANGE_EMAIL, "code": ccode, "purpose": "change_email", "current_password": RESET_PASSWORD}))
    assert r.status_code == 200, r.text

    # --- a legacy user without email: enforced binding answers 403, then the bind succeeds
    app.state.settings = app.state.settings.model_copy(update={"email_registration_required": False})
    r = keep(await client.post("/api/users", json={"username": "legacy", "password": LEGACY_PASSWORD}))
    assert r.status_code == 200, r.text
    legacy_headers = _bearer(r.json()["access_token"])
    app.state.settings = app.state.settings.model_copy(update={
        "email_binding_required": True, "email_binding_deadline": PAST_DEADLINE})
    gated = keep(await client.get("/api/conversations", headers=legacy_headers))
    assert gated.status_code == 403 and "email_binding_required" in gated.text
    bcode = await mailed_code(BIND_EMAIL, "bind", headers=legacy_headers)
    wrong_bind = keep(await client.post("/api/me/email", headers=legacy_headers,
                                        json={"email": BIND_EMAIL, "code": "000000"}))
    assert wrong_bind.status_code == 400
    r = keep(await client.post("/api/me/email", headers=legacy_headers, json={"email": BIND_EMAIL, "code": bcode}))
    assert r.status_code == 200, r.text
    assert (await client.get("/api/conversations", headers=legacy_headers)).status_code == 200
    app.state.settings = app.state.settings.model_copy(update={"email_binding_required": False})
    legacy_id = (await client.get("/api/me", headers=legacy_headers)).json()["id"]

    # --- logout of the reset session
    r = keep(await client.delete("/api/sessions/current", headers=headers))
    assert r.status_code == 204

    # --- admin: store the SMTP password (settings revision), probe it, clear the legacy user's email
    settings_key = app.state.settings.settings_encryption_key
    h = await login_as(app, client, "superadmin")
    assert (await client.post("/api/admin/step-up", headers=h, json={"password": ADMIN_PASSWORD})).status_code == 200
    r = keep(await client.patch("/api/admin/settings", headers=h, json={
        "changes": {"smtp_host": SMTP_HOST, "smtp_password": SMTP_PASSWORD, "smtp_user": "noreply@sweep-mail.test"},
        "reason": "sweep smtp setup", "confirm": "SMTP_HOST"}))
    assert r.status_code == 200, r.text

    async def public(host, resolver=None):
        return "93.184.216.34"

    monkeypatch.setattr(probes_mod, "resolve_public", public)
    fake_smtp.plan = {"login": smtplib.SMTPAuthenticationError(535, b"nope")}
    probe_bad = keep(await client.post("/api/admin/probes/smtp", headers=h, json={}))
    fake_smtp.plan = {}
    probe_ok = keep(await client.post("/api/admin/probes/smtp", headers=h, json={}))
    assert probe_bad.status_code == 200 and probe_ok.status_code == 200
    r = keep(await client.post(f"/api/admin/users/{legacy_id}/email/clear", headers=h, json={"reason": "sweep clear"}))
    assert r.status_code == 200, r.text

    # --- collect the corpora the spec names
    async with app.state.sessionmaker() as s:
        audit_rows = (await s.scalars(select(AdminAudit))).all()
        revision_rows = (await s.scalars(select(SettingRevision))).all()
    assert any(row.action == "user.email.clear" for row in audit_rows)
    assert any(row.action == "probe.run" for row in audit_rows)
    assert revision_rows, "the sweep must have written a settings revision"

    def rows_text(rows, model) -> str:
        return json.dumps([{c.name: getattr(row, c.name) for c in model.__table__.columns} for row in rows],
                          default=str, ensure_ascii=False)

    corpora = {
        "caplog": caplog.text,
        "log_buffer": "\n".join(e.message for e in log_buffer.query(limit=2000)),
        "error_bodies": "\n".join(errors),
        "audit_rows": rows_text(audit_rows, AdminAudit),
        "revision_rows": rows_text(revision_rows, SettingRevision),
        "contract_fixture": FIXTURE_TEXT,
    }
    plain_secrets = {
        "pepper": PEPPER, "smtp_password": SMTP_PASSWORD, "settings_encryption_key": settings_key,
        "password": PASSWORD, "new_password": NEW_PASSWORD, "reset_password": RESET_PASSWORD,
        "legacy_password": LEGACY_PASSWORD,
    }
    emails = {"reg_email": REG_EMAIL, "bind_email": BIND_EMAIL, "change_email": CHANGE_EMAIL}
    mailed_codes = set()
    for _to, _subject, body in fake_sender(app).outbox:
        mailed_codes.update(re.findall(r"\b\d{6}\b", body))
    assert mailed_codes, "the sweep must have mailed codes"

    for part, text in corpora.items():
        lowered = text.lower()
        for label, value in plain_secrets.items():
            assert value not in text, f"{label} leaked into {part}"
        for label, value in emails.items():
            assert value.lower() not in lowered, f"{label} leaked into {part}"
        assert NICK.lower() not in lowered, f"nickname leaked into {part}"
        if part != "error_bodies":  # tokens go to their owner in response bodies; never to logs, audit or revisions
            for i, token in enumerate(tokens):
                assert token not in text, f"access token {i} leaked into {part}"
        for code in mailed_codes:
            assert not contains_code(text, code), f"a mailed code leaked into {part}"
