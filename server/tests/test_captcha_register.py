"""Captcha guard on registration (plan S11; spec §3, §12 desktop answers, R-C9, R-C14)."""
import base64
import json
import logging

from app.core.security import hash_password as real_hash_password
from tests.accounts_helpers import PEPPER, enable_email, last_code, register_body
from tests.background import drain_background
from tests.captcha_helpers import SECRET, enable_captcha, header_for

REQUIRED = {"error": "captcha_required"}
INVALID = {"error": "captcha_invalid"}
EMAIL = "newbie@example.com"


def _body(**overrides):
    body = {"username": "newcomer", "password": "password123"}
    body.update(overrides)
    return body


async def test_old_flow_needs_a_captcha(app, client):
    enable_captcha(app, "adaptive")
    r = await client.post("/api/users", json=_body())
    assert r.status_code == 428 and r.json() == REQUIRED


async def test_old_flow_with_a_solved_captcha_registers(app, client):
    enable_captcha(app, "adaptive")
    r = await client.post("/api/users", json=_body(), headers=await header_for(client))
    assert r.status_code == 200, r.text
    assert len(r.json()["access_token"]) >= 32


async def test_closed_registration_answers_first(app, client):
    enable_captcha(app, "adaptive", registration_mode="closed")
    r = await client.post("/api/users", json=_body())
    assert r.status_code == 403 and r.json() == {"error": "Registration is closed"}


async def test_desktop_friendly_message_answers_first(app, client):
    enable_email(app, email_registration_required=True)
    enable_captcha(app, "adaptive")
    r = await client.post("/api/users", json=_body())  # no email, no captcha: the desktop-visible 400 wins
    assert r.status_code == 400
    assert r.json() == {"error": "Email verification required: please register in the web app"}


async def test_no_password_hash_without_captcha(app, client, monkeypatch):
    enable_captcha(app, "adaptive")
    calls: list[str] = []

    def counting_hash(password: str) -> str:
        calls.append(password)
        return real_hash_password(password)

    monkeypatch.setattr("app.routers.sessions.hash_password", counting_hash)
    r = await client.post("/api/users", json=_body())
    assert r.status_code == 428 and calls == []
    r = await client.post("/api/users", json=_body(), headers=await header_for(client))
    assert r.status_code == 200 and len(calls) == 1  # the counter is live


async def test_email_registration_with_captcha(app, client):
    enable_email(app, email_registration_required=True)
    enable_captcha(app, "adaptive")
    first = await header_for(client)
    r = await client.post("/api/email/code", json={"email": EMAIL, "purpose": "register"}, headers=first)
    assert r.status_code == 200, r.text
    await drain_background(app)
    code = last_code(app, EMAIL)
    body = register_body(EMAIL, code, username="newcomer")
    r = await client.post("/api/users", json=body, headers=first)  # the same captcha, already used
    assert r.status_code == 428 and r.json() == INVALID
    r = await client.post("/api/users", json=body, headers=await header_for(client))
    assert r.status_code == 200, r.text


async def test_username_taken_still_burns_the_captcha(app, client):
    enable_captcha(app, "adaptive")
    r = await client.post("/api/users", json=_body(), headers=await header_for(client))
    assert r.status_code == 200
    second = await header_for(client)
    r = await client.post("/api/users", json=_body(), headers=second)
    assert r.status_code == 409 and r.json() == {"error": "Username already taken"}
    r = await client.post("/api/users", json=_body(username="other_one"), headers=second)
    assert r.status_code == 428 and r.json() == INVALID  # a 409 answer still spent the captcha (R-C14)


async def test_register_logs_no_payload(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    enable_captcha(app, "adaptive")
    captcha = await header_for(client)
    payload = captcha["X-Captcha"]
    decoded = json.loads(base64.b64decode(payload))
    signature = decoded["challenge"]["signature"]
    nonce = decoded["challenge"]["parameters"]["nonce"]
    r = await client.post("/api/users", json=_body(), headers=captcha)
    assert r.status_code == 200
    r = await client.post("/api/users", json=_body(username="another_one"), headers={"X-Captcha": "junk"})
    assert r.status_code == 428
    for secret in (payload, signature, nonce, SECRET, "password123", PEPPER):
        assert secret not in caplog.text
