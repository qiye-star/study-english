"""Privacy sweep for the captcha flow (plan S14; spec §8, R-C6, R-C7; INDEX X31).

One pass through config -> challenge -> register code -> register -> failed logins until flagged -> login with a
header -> reset code -> reset -> login -> bind code -> one replay -> missing-secret 503 -> purge. Afterwards none of
the captcha material may appear in: the DEBUG `app` log (caplog and the admin log buffer), any response body, the
admin audit rows or the settings revision rows. The checked material is every `X-Captcha` value that was sent, and
its `signature`, `nonce`, `salt`, `keySignature` and `derivedKey`, plus the test CAPTCHA_SECRET, the two derived
HMAC keys, the login names, emails, passwords and mailed codes.

Hex values are matched as whole tokens (not glued to other hex digits); emails and nicknames case-insensitively;
the header, the secret and the passwords by exact substring. The challenge response bodies are not in the response
corpus: they carry the signature and nonce by design. They are checked for the secret and the derived keys only.

The only allowed trace of the guard in the logs is the timing line (`timing event=captcha_verify ... solve_ms=N`),
one per successful verification. A marker line proves the corpora are not empty.
"""
import base64
import json
import logging
import re
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.admin import housekeeping
from app.core import captcha, log_buffer
from app.models import AdminAudit, CaptchaReplay, SettingRevision, utcnow
from tests.accounts_helpers import contains_code, enable_email, fake_sender, last_code, register_body
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD as ADMIN_PASSWORD, login_as
from tests.background import drain_background
from tests.captcha_helpers import SECRET, enable_captcha, solve

MARKER = "CAPSWEEP-MARKER-7731"
USERNAME = "capsweeper"
NICK = "CapSweepNick9"
EMAIL = "sweep.captcha@example.test"
BIND_EMAIL = "sweep.captcha.bind@example.test"
LATER_EMAIL = "sweep.captcha.later@example.test"
PASSWORD = "Cap-Sweep-Pass-7fQ2!xyz"
RESET_PASSWORD = "Cap-Sweep-Reset-3mW8!pq"
WRONG = "Cap-Sweep-Wrong-0000!zz"
TIMING = re.compile(r"^timing event=captcha_verify scope=(register|email_code|reset|login) solve_ms=\d+$")
REQUIRED = {"error": "captcha_required"}
INVALID = {"error": "captcha_invalid"}
NOT_CONFIGURED = {"error": "Captcha is not configured"}
HEX = r"(?<![0-9a-fA-F]){}(?![0-9a-fA-F])"


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED}


def _parts(header: str) -> dict[str, str]:
    """The captcha material inside one `X-Captcha` value (base64 JSON of challenge + solution)."""
    decoded = json.loads(base64.b64decode(header))
    params = decoded["challenge"]["parameters"]
    return {"signature": decoded["challenge"]["signature"], "nonce": params["nonce"], "salt": params["salt"],
            "keySignature": params["keySignature"], "derivedKey": decoded["solution"]["derivedKey"]}


def _hex_token(text: str, value: str) -> bool:
    return re.search(HEX.format(re.escape(value)), text) is not None


async def test_captcha_material_reaches_no_log_body_audit_or_revision(app, client, caplog, monkeypatch):
    caplog.set_level(logging.DEBUG, logger="app")
    log_buffer.install()
    log_buffer.BUFFER.clear()
    logging.getLogger("app.sweep").info("sweep marker %s", MARKER)
    sender = enable_email(app, email_registration_required=True)
    enable_captcha(app, "adaptive", captcha_login_failures=3)
    app.state.login_failures.reconfigure(3, 15 * 60)

    used: list[str] = []  # every X-Captcha value that was sent with a fresh solve
    challenge_bodies: list[str] = []  # checked for the secret and derived keys only
    bodies: list[str] = []  # every other response body (success and error)
    token_bodies: list[str] = []  # bodies that carry an access token (the owner gets them by design)
    urls: list[str] = []
    tokens: list[str] = []

    def keep(r):
        urls.append(str(r.request.url))
        if "access_token" in r.text:
            token_bodies.append(r.text)
            tokens.append(r.json()["access_token"])
        else:
            bodies.append(r.text)
        return r

    async def fresh() -> dict:
        r = await client.get("/api/captcha/challenge")
        assert r.status_code == 200, r.text
        challenge_bodies.append(r.text)
        value = solve(r.json())
        used.append(value)
        return {"X-Captcha": value}

    # --- config and challenge
    r = keep(await client.get("/api/captcha/config"))
    assert r.status_code == 200 and r.json() == {"mode": "adaptive"}

    # --- register: code first, then the account with a fresh header each time
    r = keep(await client.post("/api/email/code", json={"email": EMAIL, "purpose": "register"},
                               headers=await fresh()))
    assert r.status_code == 200, r.text
    await drain_background(app)
    code = last_code(app, EMAIL)
    r = keep(await client.post("/api/users", json=register_body(EMAIL, code, username=USERNAME,
                                                                password=PASSWORD, nickname=NICK),
                               headers=await fresh()))
    assert r.status_code == 200, r.text

    # --- failed logins until the name is flagged; the fourth needs a captcha
    for _ in range(3):
        r = keep(await client.post("/api/sessions", json={"provider": "password", "username": USERNAME,
                                                          "password": WRONG}))
        assert r.status_code == 401
    r = keep(await client.post("/api/sessions", json={"provider": "password", "username": USERNAME,
                                                      "password": PASSWORD}))
    assert r.status_code == 428 and r.json() == REQUIRED
    login_header = await fresh()
    r = keep(await client.post("/api/sessions", json={"provider": "password", "username": USERNAME,
                                                      "password": PASSWORD}, headers=login_header))
    assert r.status_code == 200, r.text

    # --- reset: code, then the reset itself, then a login with the new password (flagged, so a header again)
    r = keep(await client.post("/api/email/code", json={"email": EMAIL, "purpose": "reset"},
                               headers=await fresh()))
    assert r.status_code == 200, r.text
    await drain_background(app)
    rcode = last_code(app, EMAIL)
    r = keep(await client.post("/api/password/reset", json={"email": EMAIL, "code": rcode,
                                                            "new_password": RESET_PASSWORD},
                               headers=await fresh()))
    assert r.status_code == 204, r.text
    r = keep(await client.post("/api/sessions", json={"provider": "password", "username": USERNAME,
                                                      "password": RESET_PASSWORD}, headers=await fresh()))
    assert r.status_code == 200, r.text
    auth = {"Authorization": f"Bearer {r.json()['access_token']}"}

    # --- bind code, then one replay of a header that was already used (the login header)
    bind_body = {"email": BIND_EMAIL, "purpose": "change_email", "current_password": RESET_PASSWORD}
    r = keep(await client.post("/api/me/email/code", json=bind_body, headers={**auth, **await fresh()}))
    assert r.status_code == 200, r.text
    await drain_background(app)
    replay = keep(await client.post("/api/me/email/code", json=bind_body, headers={**auth, **login_header}))
    assert replay.status_code == 428 and replay.json() == INVALID

    # --- missing secret: 503 before any header is looked at, for the code route and the challenge route
    app.state.settings = app.state.settings.model_copy(update={"captcha_secret": ""})
    r = keep(await client.post("/api/email/code", json={"email": LATER_EMAIL, "purpose": "register"}))
    assert r.status_code == 503 and r.json() == NOT_CONFIGURED
    r = keep(await client.get("/api/captcha/challenge"))
    assert r.status_code == 503 and r.json() == NOT_CONFIGURED
    enable_captcha(app, "adaptive", captcha_login_failures=3)

    # --- an admin changes a non-danger captcha setting, so the revision log holds a captcha key
    h = await login_as(app, client, "superadmin")
    assert (await client.post("/api/admin/step-up", headers=h, json={"password": ADMIN_PASSWORD})).status_code == 200
    r = keep(await client.patch("/api/admin/settings", headers=h, json={
        "changes": {"captcha_ttl_seconds": 600}, "reason": "captcha sweep ttl"}))
    assert r.status_code == 200, r.text

    # --- purge: every row written by a successful verification expires and is deleted
    async with app.state.sessionmaker() as s:
        before = (await s.execute(select(func.count()).select_from(CaptchaReplay))).scalar_one()
        assert before == len(used) == 7, "one replay row per successful verification, none for the replay"
        counts = await housekeeping.purge_expired(s, utcnow() + timedelta(days=1))
        await s.commit()
        left = (await s.execute(select(func.count()).select_from(CaptchaReplay))).scalar_one()
    assert counts["captcha_replays"] == before and left == 0

    # --- collect the corpora
    async with app.state.sessionmaker() as s:
        audit_rows = (await s.scalars(select(AdminAudit))).all()
        revision_rows = (await s.scalars(select(SettingRevision))).all()
    assert any(row.action == "settings.update" for row in audit_rows)
    assert revision_rows, "the sweep must have written a settings revision"

    def rows_text(rows, model) -> str:
        return json.dumps([{c.name: getattr(row, c.name) for c in model.__table__.columns} for row in rows],
                          default=str, ensure_ascii=False)

    buffer_text = "\n".join(e.message for e in log_buffer.query(limit=2000))
    timing_lines = [rec.getMessage() for rec in caplog.records if rec.name == "app.timing"]
    corpora = {
        "caplog": caplog.text,
        "log_buffer": buffer_text,
        "response_bodies": "\n".join(bodies),
        "audit_rows": rows_text(audit_rows, AdminAudit),
        "revision_rows": rows_text(revision_rows, SettingRevision),
    }

    # the corpora are real: the marker is in both logs, and the only captcha log lines are the timing lines
    assert MARKER in caplog.text and MARKER in buffer_text
    assert len(timing_lines) == len(used) == 7
    assert all(TIMING.match(line) for line in timing_lines), timing_lines
    for rec in caplog.records:
        if "captcha" in rec.getMessage().lower():
            assert TIMING.match(rec.getMessage()), rec.getMessage()
    assert len(bodies) >= 3 and any(json.loads(b) == REQUIRED for b in bodies if b.startswith("{"))
    assert all("?" not in u for u in urls), "no captcha or other request carries a query string"

    # challenge bodies carry the signature by design: only the secret and the derived keys may not be there
    hmac_secret, hmac_key_secret = captcha.derived_keys(SECRET)
    for body in challenge_bodies:
        assert SECRET not in body and hmac_secret not in body and hmac_key_secret not in body
    assert len(challenge_bodies) == len(used)

    secrets_plain = {
        "x-captcha header": used,
        "captcha secret": [SECRET],
        "hmac derived key": [hmac_secret, hmac_key_secret],
    }
    hex_material = {}
    for value in used:
        for name, token in _parts(value).items():
            hex_material.setdefault(name, []).append(token)
    plain = {"password": [PASSWORD, RESET_PASSWORD, WRONG], "username": [USERNAME]}
    emails = {"email": [EMAIL, BIND_EMAIL, LATER_EMAIL], "nickname": [NICK]}
    mailed = set()
    for _to, _subject, body in fake_sender(app).outbox:
        mailed.update(re.findall(r"\b\d{6}\b", body))
    assert mailed, "the sweep must have mailed codes"

    for part, text in corpora.items():
        lowered = text.lower()
        for label, values in secrets_plain.items():
            for value in values:
                assert value not in text, f"{label} leaked into {part}"
        for label, values in hex_material.items():
            for value in values:
                assert not _hex_token(text, value), f"captcha {label} leaked into {part}"
        for label, values in plain.items():
            for value in values:
                assert value not in text, f"{label} leaked into {part}"
        for label, values in emails.items():
            for value in values:
                assert value.lower() not in lowered, f"{label} leaked into {part}"
        for code in mailed:
            assert not contains_code(text, code), f"a mailed code leaked into {part}"

    # tokens go to their owner in the token bodies; everywhere else they must not appear
    for part, text in {**corpora, "token_free_bodies": "\n".join(bodies)}.items():
        for i, token in enumerate(tokens):
            assert token not in text, f"access token {i} leaked into {part}"
