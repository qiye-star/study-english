"""Captcha guard on the three account endpoints (plan S10; spec §3, R-C2, R-C9, R-C14; INDEX X31).

POST /api/email/code, POST /api/me/email/code and POST /api/password/reset must check the captcha before any
expensive or state-changing work: no IP email budget spent, no password hashed, no password checked.
"""
import base64
import json
import logging

import pytest

from app.core.security import hash_password as real_hash_password
from tests.accounts_helpers import bind, enable_email, mail_code
from tests.captcha_helpers import SECRET, enable_captcha, header_for
from tests.test_admin_api import register

NEW = "newcomer@example.com"
EMAIL = "resetter@example.com"
PASSWORD = "password123"
NEW_PASSWORD = "brand-new-pass-456"
REQUIRED = {"error": "captcha_required"}
INVALID = {"error": "captcha_invalid"}
ENDPOINTS = ["email_code", "me_email_code", "reset"]


async def _world(app, client, mode="adaptive"):
    """A user with a verified email. The reset code is mailed while captcha is still off."""
    enable_email(app)
    uid, auth = await register(client, "resetter")
    await bind(app, uid, EMAIL)
    code = await mail_code(app, client, EMAIL, "reset")
    enable_captcha(app, mode)
    return uid, auth, code


async def _call(client, name, headers, code, password=PASSWORD):
    if name == "email_code":
        return await client.post("/api/email/code", json={"email": NEW, "purpose": "register"}, headers=headers)
    if name == "me_email_code":
        return await client.post("/api/me/email/code", json={"email": NEW, "current_password": password},
                                 headers=headers)
    return await client.post("/api/password/reset", json={"email": EMAIL, "code": code,
                                                          "new_password": NEW_PASSWORD}, headers=headers)


@pytest.mark.parametrize("name", ENDPOINTS)
async def test_missing_header_is_428_captcha_required(app, client, name):
    _uid, auth, code = await _world(app, client)
    r = await _call(client, name, auth, code)
    assert r.status_code == 428 and r.json() == REQUIRED


@pytest.mark.parametrize("name", ENDPOINTS)
async def test_garbage_header_is_428_captcha_invalid(app, client, name):
    _uid, auth, code = await _world(app, client)
    r = await _call(client, name, {**auth, "X-Captcha": "not-a-payload!!"}, code)
    assert r.status_code == 428 and r.json() == INVALID


async def test_solved_header_gets_the_original_answers(app, client):
    _uid, auth, code = await _world(app, client)
    r = await _call(client, "email_code", {**auth, **await header_for(client)}, code)
    assert r.status_code == 200 and r.json() == {"ok": True, "cooldown_seconds": 60}
    r = await _call(client, "me_email_code", {**auth, **await header_for(client)}, code)
    assert r.status_code == 200 and r.json() == {"ok": True, "cooldown_seconds": 60}
    r = await _call(client, "reset", {**auth, **await header_for(client)}, code)
    assert r.status_code == 204 and r.content == b""


async def test_unsolved_requests_do_not_spend_the_ip_email_budget(app, client):
    enable_email(app, email_codes_per_ip_hourly=1)
    enable_captcha(app, "adaptive")
    for _ in range(2):
        r = await client.post("/api/email/code", json={"email": NEW, "purpose": "register"})
        assert r.status_code == 428 and r.json() == REQUIRED
    r = await client.post("/api/email/code", json={"email": NEW, "purpose": "register"},
                          headers=await header_for(client))
    assert r.status_code == 200, r.text


async def test_reset_hashes_no_password_without_captcha(app, client, monkeypatch):
    _uid, _auth, code = await _world(app, client)
    calls: list[str] = []

    def counting_hash(password: str) -> str:
        calls.append(password)
        return real_hash_password(password)

    monkeypatch.setattr("app.routers.account.hash_password", counting_hash)
    r = await client.post("/api/password/reset", json={"email": EMAIL, "code": code,
                                                       "new_password": NEW_PASSWORD})
    assert r.status_code == 428 and r.json() == REQUIRED
    assert calls == []  # no hash before the captcha answer
    r = await client.post("/api/password/reset", json={"email": EMAIL, "code": code,
                                                       "new_password": NEW_PASSWORD},
                          headers=await header_for(client))
    assert r.status_code == 204
    assert len(calls) == 1  # the counter is live: a solved request does hash


async def test_me_email_code_checks_captcha_before_password(app, client):
    _uid, auth, _code = await _world(app, client)
    r = await _call(client, "me_email_code", auth, "", password="wrong-password")
    assert r.status_code == 428 and r.json() == REQUIRED  # not 403 "Wrong password"


async def test_off_mode_unchanged(app, client):
    _uid, auth, code = await _world(app, client, mode="off")
    assert (await _call(client, "email_code", auth, code)).status_code == 200
    assert (await _call(client, "me_email_code", auth, code)).status_code == 200
    assert (await _call(client, "reset", auth, code)).status_code == 204


async def test_account_endpoints_log_no_payload(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    _uid, auth, code = await _world(app, client)
    captcha = await header_for(client)
    payload = captcha["X-Captcha"]
    decoded = json.loads(base64.b64decode(payload))
    signature = decoded["challenge"]["signature"]
    nonce = decoded["challenge"]["parameters"]["nonce"]
    assert (await _call(client, "reset", {**auth, **captcha}, code)).status_code == 204
    assert (await _call(client, "email_code", {"X-Captcha": "junk-payload"}, code)).status_code == 428
    assert (await _call(client, "email_code", {}, code)).status_code == 428
    for secret in (payload, signature, nonce, SECRET, NEW_PASSWORD, PASSWORD):
        assert secret not in caplog.text
