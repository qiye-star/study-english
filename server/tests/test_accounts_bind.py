"""Bind and change the account email: POST /api/me/email/code and POST /api/me/email (plan S20; R-F6, X3, X31)."""
import logging
import re

import pytest
from sqlalchemy import select

from app.core.deps import current_user_unbound
from app.models import AccessToken, User, UserIdentity, VerificationCode
from app.services.identities import decrypt_email, mask_email
from app.core.secretbox import box_for
from tests.accounts_helpers import PEPPER, age_codes, bind, enable_email, fake_sender, last_code
from tests.background import drain_background
from tests.test_admin_routes_guarded import api_routes
from tests.test_admin_api import register

NEW = "fresh.mail@example.com"
OLD = "old.mail@example.com"
PASSWORD = "password123"
INVALID = {"error": "Invalid or expired code"}
OK = {"ok": True, "cooldown_seconds": 60}


async def _ask(client, headers, email=NEW, **extra):
    return await client.post("/api/me/email/code", headers=headers, json={"email": email, **extra})


async def _confirm(client, headers, email=NEW, code="000000", **extra):
    return await client.post("/api/me/email", headers=headers, json={"email": email, "code": code, **extra})


async def _mailed(app, client, headers, email=NEW, **extra) -> str:
    r = await _ask(client, headers, email, **extra)
    assert r.status_code == 200, r.text
    await drain_background(app)
    return last_code(app, email)


async def _login(client, username, password=PASSWORD):
    return await client.post("/api/sessions", json={"provider": "password", "username": username, "password": password})


@pytest.fixture
async def fresh(app, client):
    """A user without an email."""
    enable_email(app)
    uid, headers = await register(client, "binder")
    return uid, headers


@pytest.fixture
async def bound(app, client):
    """A user who already has OLD as verified email."""
    enable_email(app)
    uid, headers = await register(client, "changer")
    await bind(app, uid, OLD)
    return uid, headers


async def _identity_email(app, uid) -> str | None:
    async with app.state.sessionmaker() as s:
        row = (await s.execute(select(UserIdentity).where(UserIdentity.user_id == uid))).scalar_one_or_none()
        return None if row is None else decrypt_email(box_for(app.state.settings), row.subject_enc)


# ---- bind ----

async def test_bind_sends_a_code_and_binds(app, client, fresh):
    uid, headers = fresh
    r = await _ask(client, headers)
    assert r.status_code == 200 and r.json() == OK
    await drain_background(app)
    assert fake_sender(app).purposes == ["bind"]
    code = last_code(app, NEW)
    done = await _confirm(client, headers, code=code)
    assert done.status_code == 200 and done.json() == {"email_masked": "f***@example.com", "email_verified": True}
    assert await _identity_email(app, uid) == NEW
    async with app.state.sessionmaker() as s:
        assert (await s.get(User, uid)).email_verified_at is not None
    assert (await _login(client, NEW)).status_code == 200


async def test_the_code_is_consumed_and_works_once(app, client, fresh):
    _uid, headers = fresh
    code = await _mailed(app, client, headers)
    assert (await _confirm(client, headers, code=code)).status_code == 200
    again = await _confirm(client, headers, code=code, current_password=PASSWORD)  # now it is a change
    assert again.status_code == 400 and again.json() == INVALID
    stale = await _confirm(client, headers, code=code, purpose="bind")
    assert stale.status_code == 409 and stale.json() == {"error": "Email already bound"}


async def test_wrong_code_is_400_counts_an_attempt_and_keeps_the_code(app, client, fresh):
    uid, headers = fresh
    code = await _mailed(app, client, headers)
    wrong = "000000" if code != "000000" else "111111"
    r = await _confirm(client, headers, code=wrong)
    assert r.status_code == 400 and r.json() == INVALID
    async with app.state.sessionmaker() as s:
        row = (await s.execute(select(VerificationCode).order_by(VerificationCode.id.desc()))).scalars().first()
        assert row.attempts == 1 and row.consumed_at is None and row.user_id == uid
    assert await _identity_email(app, uid) is None
    assert (await _confirm(client, headers, code=code)).status_code == 200


async def test_bind_when_already_bound_is_409(app, client, bound):
    _uid, headers = bound
    r = await _ask(client, headers, purpose="bind")
    assert r.status_code == 409 and r.json() == {"error": "Email already bound"}
    r = await _confirm(client, headers, code="123456", purpose="bind")
    assert r.status_code == 409 and r.json() == {"error": "Email already bound"}


async def test_change_without_an_email_is_409(app, client, fresh):
    _uid, headers = fresh
    r = await _ask(client, headers, purpose="change_email", current_password=PASSWORD)
    assert r.status_code == 409 and r.json() == {"error": "No email to change"}


async def test_a_code_for_someone_elses_request_cannot_bind(app, client, fresh):
    """Two users, one address: the code mailed to the address is bound to the user who asked for it."""
    _uid, headers = fresh
    _other, other_headers = await register(client, "bystander")
    code = await _mailed(app, client, headers)
    r = await _confirm(client, other_headers, code=code)
    assert r.status_code == 400 and r.json() == INVALID
    assert (await _confirm(client, headers, code=code)).status_code == 200


async def test_a_reset_or_register_code_cannot_bind(app, client, fresh):
    _uid, headers = fresh
    await client.post("/api/email/code", json={"email": NEW, "purpose": "register"})
    await drain_background(app)
    code = last_code(app, NEW)
    r = await _confirm(client, headers, code=code)
    assert r.status_code == 400 and r.json() == INVALID


# ---- an address that another account owns (R-F6) ----

async def test_a_taken_address_is_answered_like_a_free_one_and_gets_a_notice(app, client, fresh):
    _uid, headers = fresh
    owner, _ = await register(client, "owner")
    await bind(app, owner, "taken@example.com")
    free = await _ask(client, headers, NEW)
    taken = await _ask(client, headers, "taken@example.com")
    assert free.status_code == taken.status_code == 200
    assert free.content == taken.content
    await drain_background(app)
    assert fake_sender(app).purposes == ["bind", "notice_bind"]
    assert not re.search(r"\d{6}", " ".join(fake_sender(app).outbox[1][1:]))  # the notice carries no code


async def test_a_taken_address_cannot_be_bound_and_fails_like_a_wrong_code(app, client, fresh):
    uid, headers = fresh
    owner, _ = await register(client, "owner")
    await bind(app, owner, "taken@example.com")
    code = await _mailed(app, client, headers, NEW)
    wrong = await _confirm(client, headers, NEW, "000000" if code != "000000" else "111111")
    assert (await _ask(client, headers, "Taken+tag@EXAMPLE.com")).status_code == 200  # plus tag: the same key
    taken = await _confirm(client, headers, "taken+tag@example.com", "123456")
    assert (taken.status_code, taken.content) == (wrong.status_code, wrong.content)
    assert taken.json() == INVALID
    assert await _identity_email(app, uid) is None


async def test_losing_the_race_for_an_address_is_the_same_400(app, client, fresh):
    uid, headers = fresh
    code = await _mailed(app, client, headers)
    rival, _ = await register(client, "rival")
    await bind(app, rival, NEW)  # the address is taken after the code was mailed
    r = await _confirm(client, headers, code=code)
    assert r.status_code == 400 and r.json() == INVALID
    assert await _identity_email(app, uid) is None
    async with app.state.sessionmaker() as s:
        row = (await s.execute(select(VerificationCode).order_by(VerificationCode.id.desc()))).scalars().first()
        assert row.consumed_at is None  # rolled back


# ---- change ----

async def test_change_needs_the_current_password_to_ask_and_to_confirm(app, client, bound):
    uid, headers = bound
    for extra in ({}, {"current_password": "not-the-password"}):
        r = await _ask(client, headers, **extra)
        assert r.status_code == 403 and r.json() == {"error": "Wrong password"}
    await drain_background(app)
    assert fake_sender(app).outbox == []
    async with app.state.sessionmaker() as s:
        assert (await s.execute(select(VerificationCode))).first() is None
    code = await _mailed(app, client, headers, current_password=PASSWORD)
    assert fake_sender(app).purposes == ["bind"]  # the mail kind is shared; the stored code purpose is change_email
    for extra in ({}, {"current_password": "not-the-password"}):
        r = await _confirm(client, headers, code=code, **extra)
        assert r.status_code == 403 and r.json() == {"error": "Wrong password"}
    assert await _identity_email(app, uid) == OLD
    async with app.state.sessionmaker() as s:  # a wrong password is not a wrong guess: the code is untouched
        row = (await s.execute(select(VerificationCode).order_by(VerificationCode.id.desc()))).scalars().first()
        assert row.attempts == 0 and row.consumed_at is None


async def test_change_replaces_the_email_and_keeps_every_token(app, client, bound):
    uid, headers = bound
    other = await _login(client, "changer")
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    code = await _mailed(app, client, headers, current_password=PASSWORD)
    r = await _confirm(client, headers, code=code, current_password=PASSWORD)
    assert r.status_code == 200 and r.json() == {"email_masked": mask_email(NEW), "email_verified": True}
    assert await _identity_email(app, uid) == NEW
    assert (await _login(client, OLD)).status_code == 401
    assert (await _login(client, NEW)).status_code == 200
    for h in (headers, other_headers):  # the change does not sign anyone out
        assert (await client.get("/api/me", headers=h)).status_code == 200
    async with app.state.sessionmaker() as s:
        assert len((await s.scalars(select(AccessToken).where(AccessToken.user_id == uid))).all()) >= 2


async def test_changing_to_another_spelling_of_the_own_address_is_allowed(app, client, bound):
    uid, headers = bound
    spelled = "old.mail+work@example.com"
    code = await _mailed(app, client, headers, spelled, current_password=PASSWORD)
    r = await _confirm(client, headers, spelled, code, current_password=PASSWORD)
    assert r.status_code == 200
    assert await _identity_email(app, uid) == spelled


async def test_the_purpose_follows_the_account_state_when_omitted(app, client, bound):
    _uid, headers = bound
    assert (await _ask(client, headers, NEW, current_password=PASSWORD)).status_code == 200
    async with app.state.sessionmaker() as s:
        assert (await s.execute(select(VerificationCode.purpose))).scalar_one() == "change_email"
    _uid2, headers2 = await register(client, "plain_user")
    assert (await _ask(client, headers2, "another@example.com")).status_code == 200
    async with app.state.sessionmaker() as s:
        assert sorted((await s.execute(select(VerificationCode.purpose))).scalars().all()) == ["bind", "change_email"]


# ---- configuration, limits, routing ----

async def test_both_endpoints_use_the_unbound_dependency(app):
    wanted = {("POST", "/api/me/email/code"), ("POST", "/api/me/email")}
    found = set()
    for path, route in api_routes(app.routes):
        for method in route.methods:
            if (method, path) in wanted:
                assert current_user_unbound in [d.call for d in route.dependant.dependencies]
                found.add((method, path))
    assert found == wanted  # real routes (the behaviour tests above also prove they precede the stubs)


async def test_a_token_is_required(client):
    assert (await client.post("/api/me/email/code", json={"email": NEW})).status_code == 401
    assert (await client.post("/api/me/email", json={"email": NEW, "code": "123456"})).status_code == 401


async def test_not_configured_domain_policy_and_caps(app, client, fresh):
    _uid, headers = fresh
    r = await _ask(client, headers, "x@mailinator.com")
    assert r.status_code == 422 and r.json() == {"error": "Email domain not allowed"}
    assert (await _ask(client, headers, "not-an-email")).status_code == 422
    assert (await _ask(client, headers, NEW)).status_code == 200
    again = await _ask(client, headers, NEW)  # inside the 60 s cooldown
    assert again.status_code == 429 and again.json() == {"error": "Too many codes, please wait"}
    assert 1 <= int(again.headers["retry-after"]) <= 60
    await age_codes(app, seconds=61)
    app.state.settings = app.state.settings.model_copy(update={"email_daily_global": 1})
    assert (await _ask(client, headers, NEW)).status_code == 503  # the one unit of the day is used up
    app.state.settings = app.state.settings.model_copy(update={"email_backend": "off"})
    r = await _ask(client, headers, NEW)
    assert r.status_code == 503 and r.json() == {"error": "Email is not configured"}
    assert (await _confirm(client, headers)).status_code == 503


async def test_ip_hourly_cap_applies(app, client, fresh):
    _uid, headers = fresh
    enable_email(app, email_codes_per_ip_hourly=1)
    assert (await _ask(client, headers, "a1@example.com")).status_code == 200
    assert (await _ask(client, headers, "a2@example.com")).status_code == 429


async def test_bind_logs_nothing_sensitive(app, client, fresh, caplog):
    uid, headers = fresh
    caplog.set_level(logging.DEBUG, logger="app")
    owner, _ = await register(client, "owner")
    await bind(app, owner, "taken@example.com")
    await _ask(client, headers, "taken@example.com")
    code = await _mailed(app, client, headers, NEW)
    await _confirm(client, headers, NEW, "000000" if code != "000000" else "111111")
    assert (await _confirm(client, headers, NEW, code)).status_code == 200
    token = headers["Authorization"].split(" ", 1)[1]
    for secret in (NEW, "taken@example.com", "fresh.mail", code, PASSWORD, token, PEPPER):
        assert secret not in caplog.text
