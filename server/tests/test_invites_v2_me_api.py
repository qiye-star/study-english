"""The owner's permanent invite code endpoints (plan 2026-10-14-invites-v2 S6; R-I6..R-I9, X3, X19).

GET /api/me/invite, POST /api/me/invite (generate, idempotent), POST /api/me/invite/rotate {"confirm": true}.
Every response is `Cache-Control: no-store`; the plain code appears only in these owner responses."""
import logging
import re
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models import InviteCode, User, utcnow
from tests.accounts_helpers import bind, enable_email

CODE_RE = re.compile(r"^[A-HJKMNP-TV-Z2-9]{5}-[A-HJKMNP-TV-Z2-9]{5}$")
VIEW_KEYS = {"eligible", "reason", "available_at", "code", "uses", "cap", "invitees"}


def _set(app, **update):
    app.state.base_settings = app.state.settings = app.state.settings.model_copy(update=update)


async def _owner(app, client, name: str, *, days_old: int = 10, verified: bool = True) -> tuple[dict, int]:
    """A registered account (legacy path, no email code needed), aged and optionally bound to a verified email."""
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    assert r.status_code == 200, r.text
    uid = int(r.json()["id"])
    async with app.state.sessionmaker() as s:
        user = await s.get(User, uid)
        user.created_at = utcnow() - timedelta(days=days_old)
        await s.commit()
    if verified:
        await bind(app, uid, f"{name}@example.com")
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, uid


async def _ready(app, client, name: str = "owner_ready") -> tuple[dict, int]:
    enable_email(app)
    return await _owner(app, client, name)


async def _redeem_in_invite_mode(app, client, code: str, username: str):
    _set(app, registration_mode="invite")
    return await client.post("/api/users", json={"username": username, "password": "password123",
                                                 "invite_code": code})


def _no_store(r) -> None:
    assert r.headers.get("cache-control") == "no-store"


# ---- shapes and refusals ----

async def test_get_for_a_new_account_is_refused_with_reason_and_date(app, client):
    enable_email(app)
    headers, _ = await _owner(app, client, "fresh_one", days_old=1)
    r = await client.get("/api/me/invite", headers=headers)
    assert r.status_code == 200, r.text
    _no_store(r)
    body = r.json()
    assert set(body) == VIEW_KEYS
    assert body["eligible"] is False and body["reason"] == "too_new"
    assert body["code"] is None and body["uses"] == 0 and body["cap"] == 10 and body["invitees"] == []
    assert body["available_at"] is not None and body["available_at"].startswith(
        (utcnow() + timedelta(days=6)).strftime("%Y-%m-%d"))


async def test_get_without_a_verified_email_says_so(app, client):
    enable_email(app)
    headers, _ = await _owner(app, client, "no_mail", verified=False)
    body = (await client.get("/api/me/invite", headers=headers)).json()
    assert body["eligible"] is False and body["reason"] == "email_unverified" and body["available_at"] is None


async def test_site_cap_zero_says_invites_are_disabled_and_refuses_generation(app, client):
    headers, _ = await _ready(app, client, "capped")
    _set(app, invites_user_code_max_uses=0)
    body = (await client.get("/api/me/invite", headers=headers)).json()
    assert body["eligible"] is False and body["reason"] == "invites_disabled" and body["code"] is None
    r = await client.post("/api/me/invite", headers=headers)
    assert r.status_code == 403
    assert r.json()["reason"] == "invites_disabled" and "code" not in r.json()
    _no_store(r)


async def test_post_refused_for_a_new_account_names_the_reason(app, client):
    enable_email(app)
    headers, _ = await _owner(app, client, "fresh_two", days_old=2)
    r = await client.post("/api/me/invite", headers=headers)
    assert r.status_code == 403 and r.json()["reason"] == "too_new" and r.json()["available_at"]
    assert "code" not in r.json()
    _no_store(r)


# ---- generate (idempotent) and view ----

async def test_generate_returns_the_code_and_it_stays_the_same(app, client):
    headers, _ = await _ready(app, client, "maker")
    first = await client.post("/api/me/invite", headers=headers)
    assert first.status_code == 200, first.text
    _no_store(first)
    code = first.json()["code"]
    assert CODE_RE.match(code) and first.json()["eligible"] is True
    again = await client.post("/api/me/invite", headers=headers)
    assert again.json()["code"] == code
    seen = await client.get("/api/me/invite", headers=headers)
    _no_store(seen)
    assert seen.json()["code"] == code and set(seen.json()) == VIEW_KEYS
    async with app.state.sessionmaker() as s:
        rows = list((await s.scalars(select(InviteCode))).all())
    assert len(rows) == 1 and rows[0].kind == "user" and rows[0].code_enc and code not in rows[0].code_enc


async def test_invitees_show_display_names_and_time_only(app, client):
    headers, _ = await _ready(app, client, "host_view")
    code = (await client.post("/api/me/invite", headers=headers)).json()["code"]
    guest = await _redeem_in_invite_mode(app, client, code, "guest_view")
    assert guest.status_code == 200, guest.text
    body = (await client.get("/api/me/invite", headers=headers)).json()
    assert body["uses"] == 1 and body["cap"] == 10
    assert [set(i) for i in body["invitees"]] == [{"display_name", "joined_at"}]
    assert body["invitees"][0]["display_name"] == "guest_view"  # no nickname set: display_of falls back to the login
    assert "guest_view@" not in repr(body)


async def test_no_key_is_503_for_every_method(app, client):
    headers, _ = await _owner(app, client, "keyless", verified=False)  # no enable_email: no SETTINGS_ENCRYPTION_KEY
    for method, path in (("get", "/api/me/invite"), ("post", "/api/me/invite"),
                         ("post", "/api/me/invite/rotate")):
        body = {"confirm": True} if path.endswith("rotate") else None
        r = await client.request(method, path, headers=headers, json=body)
        assert r.status_code == 503 and r.json() == {"error": "Invites are not configured"}, (method, path, r.text)


# ---- rotate ----

async def test_rotate_needs_an_explicit_confirm(app, client):
    headers, _ = await _ready(app, client, "careful")
    await client.post("/api/me/invite", headers=headers)
    for body in ({}, {"confirm": False}):
        r = await client.post("/api/me/invite/rotate", headers=headers, json=body)
        assert r.status_code == 422, r.text


async def test_rotate_replaces_the_code_and_the_old_one_stops_working(app, client):
    headers, _ = await _ready(app, client, "rotator_api")
    old = (await client.post("/api/me/invite", headers=headers)).json()["code"]
    r = await client.post("/api/me/invite/rotate", headers=headers, json={"confirm": True})
    assert r.status_code == 200, r.text
    _no_store(r)
    new = r.json()["code"]
    assert new != old and CODE_RE.match(new)
    refused = await _redeem_in_invite_mode(app, client, old, "late_guest")
    assert refused.status_code == 403 and refused.json() == {"error": "Invalid invite code"}
    accepted = await _redeem_in_invite_mode(app, client, new, "new_guest")
    assert accepted.status_code == 200, accepted.text


async def test_rotate_without_a_live_code_is_409(app, client):
    headers, _ = await _ready(app, client, "nothing_yet")
    r = await client.post("/api/me/invite/rotate", headers=headers, json={"confirm": True})
    assert r.status_code == 409 and r.json() == {"error": "No invite code to replace"}


# ---- budget, auth, binding ----

async def test_generate_and_rotate_share_five_actions_per_day(app, client):
    headers, _ = await _ready(app, client, "budget")
    assert (await client.post("/api/me/invite", headers=headers)).status_code == 200
    for _ in range(4):
        assert (await client.post("/api/me/invite/rotate", headers=headers, json={"confirm": True})).status_code == 200
    r = await client.post("/api/me/invite/rotate", headers=headers, json={"confirm": True})
    assert r.status_code == 429 and r.json() == {"error": "Too many requests, please try again later"}


async def test_anonymous_requests_are_401(app, client):
    assert (await client.get("/api/me/invite")).status_code == 401
    assert (await client.post("/api/me/invite")).status_code == 401


async def test_a_user_forced_to_bind_is_blocked_by_the_shared_gate(app, client):
    headers, _ = await _owner(app, client, "must_bind", verified=False)
    enable_email(app, email_binding_required=True, email_binding_deadline="")
    r = await client.get("/api/me/invite", headers=headers)
    assert r.status_code == 403 and r.json() == {"error": "email_binding_required"}


# ---- privacy ----

async def test_no_debug_line_and_no_refusal_body_carries_a_code(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    headers, _ = await _ready(app, client, "quiet_me")
    code = (await client.post("/api/me/invite", headers=headers)).json()["code"]
    rotated = (await client.post("/api/me/invite/rotate", headers=headers, json={"confirm": True})).json()["code"]
    await client.get("/api/me/invite", headers=headers)
    for text in (code, rotated, code.replace("-", ""), rotated.replace("-", "")):
        assert text not in caplog.text
    _set(app, invites_user_code_max_uses=0)
    refusal = await client.post("/api/me/invite", headers=headers)
    assert rotated not in refusal.text and code not in refusal.text
