"""POST /api/password/reset: forgot password by email code (plan S19; R-F3, R-F9, INDEX X30, X31)."""
import logging

import pytest
from sqlalchemy import select

from app.models import AccessToken, VerificationCode
from tests.background import drain_background
from tests.accounts_helpers import PEPPER, bind, enable_email, fake_sender, last_code, mail_code
from tests.test_admin_api import register

EMAIL = "forgetful@example.com"
OLD = "password123"
NEW = "brand-new-pass-456"
INVALID = {"error": "Invalid or expired code"}


@pytest.fixture
def cuts(monkeypatch):
    seen: list[int] = []

    async def record(_app, user_id: int) -> None:
        seen.append(user_id)

    monkeypatch.setattr("app.routers.account.cut_connections", record)
    return seen


@pytest.fixture
async def account(app, client, cuts):
    enable_email(app)
    uid, first = await register(client, "forgetful")
    await bind(app, uid, EMAIL)
    r = await client.post("/api/sessions", json={"provider": "password", "username": "forgetful", "password": OLD})
    second = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return uid, first, second


async def _reset(client, email=EMAIL, code="000000", password=NEW):
    return await client.post("/api/password/reset", json={"email": email, "code": code, "new_password": password})


async def _login(client, password):
    return await client.post("/api/sessions", json={"provider": "password", "username": "forgetful",
                                                    "password": password})


async def test_reset_changes_the_password_and_revokes_every_token(app, client, account, cuts):
    uid, first, second = account
    code = await mail_code(app, client, EMAIL, "reset")
    r = await _reset(client, code=code)
    assert r.status_code == 204 and r.content == b""  # no body, so no token: the user logs in again
    for headers in (first, second):
        assert (await client.get("/api/me", headers=headers)).status_code == 401
    async with app.state.sessionmaker() as s:
        assert (await s.scalars(select(AccessToken).where(AccessToken.user_id == uid))).all() == []
    assert (await _login(client, OLD)).status_code == 401
    assert (await _login(client, NEW)).status_code == 200
    assert cuts == [uid]


async def test_the_address_is_matched_in_any_spelling(app, client, account):
    r = await client.post("/api/email/code", json={"email": "Forgetful+x@EXAMPLE.com", "purpose": "reset"})
    assert r.status_code == 200
    await drain_background(app)  # mailed to the stored address (F1)
    code = last_code(app, EMAIL)
    assert (await _reset(client, " forgetful@example.com ", code)).status_code == 204


async def test_a_code_works_once(app, client, account):
    code = await mail_code(app, client, EMAIL, "reset")
    assert (await _reset(client, code=code)).status_code == 204
    again = await _reset(client, code=code, password="another-pass-789")
    assert again.status_code == 400 and again.json() == INVALID
    assert (await _login(client, NEW)).status_code == 200


async def test_wrong_code_is_400_counts_an_attempt_and_changes_nothing(app, client, account, cuts):
    _uid, first, _second = account
    code = await mail_code(app, client, EMAIL, "reset")
    wrong = "000000" if code != "000000" else "111111"
    r = await _reset(client, code=wrong)
    assert r.status_code == 400 and r.json() == INVALID
    async with app.state.sessionmaker() as s:
        row = (await s.execute(select(VerificationCode).order_by(VerificationCode.id.desc()))).scalars().first()
        assert row.attempts == 1 and row.consumed_at is None
    assert (await client.get("/api/me", headers=first)).status_code == 200
    assert (await _login(client, OLD)).status_code == 200
    assert cuts == []
    assert (await _reset(client, code=code)).status_code == 204  # a wrong guess did not burn the code


async def test_five_wrong_guesses_lock_the_code(app, client, account):
    code = await mail_code(app, client, EMAIL, "reset")
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        assert (await _reset(client, code=wrong)).status_code == 400
    assert (await _reset(client, code=code)).status_code == 400


async def test_unknown_email_fails_exactly_like_a_wrong_code(app, client, account):
    code = await mail_code(app, client, EMAIL, "reset")
    wrong = "000000" if code != "000000" else "111111"
    ghost = "ghost@example.com"
    asked = await client.post("/api/email/code", json={"email": ghost, "purpose": "reset"})
    assert asked.status_code == 200  # a hidden row, nothing mailed
    known_wrong = await _reset(client, code=wrong)
    unknown_asked = await _reset(client, ghost, "123456")
    unknown_never_asked = await _reset(client, "never@example.com", "123456")
    assert {(r.status_code, r.content) for r in (known_wrong, unknown_asked, unknown_never_asked)} == {
        (400, known_wrong.content)}
    assert known_wrong.json() == INVALID
    assert [m[0] for m in fake_sender(app).outbox] == [EMAIL]


async def test_a_code_for_another_purpose_does_not_reset(app, client, account):
    code = await mail_code(app, client, "other@example.com", "register")
    assert (await _reset(client, "other@example.com", code)).status_code == 400
    code = await mail_code(app, client, EMAIL, "reset")
    r = await _reset(client, "other@example.com", code)  # a code is bound to its own address
    assert r.status_code == 400 and r.json() == INVALID


async def test_a_code_issued_to_a_previous_owner_of_the_address_is_refused(app, client, account):
    uid, _first, _second = account
    code = await mail_code(app, client, EMAIL, "reset")
    async with app.state.sessionmaker() as s:  # the address moves to another account before the code is used
        from app.models import User
        from app.services import identities
        await identities.clear_email(s, await s.get(User, uid))
        await s.commit()
    other_uid, _ = await register(client, "newowner")
    await bind(app, other_uid, EMAIL)
    r = await _reset(client, code=code)
    assert r.status_code == 400 and r.json() == INVALID
    assert (await client.post("/api/sessions", json={"provider": "password", "username": "newowner",
                                                     "password": OLD})).status_code == 200


async def test_password_rules_match_registration(app, client, account):
    code = await mail_code(app, client, EMAIL, "reset")
    r = await _reset(client, code=code, password="short")
    assert r.status_code == 422 and "short" not in r.text
    assert (await _reset(client, code=code)).status_code == 204  # the rejected request did not touch the code


async def test_bad_email_is_422_without_echo(app, client, account):
    r = await _reset(client, "not-an-email", "123456")
    assert r.status_code == 422 and "not-an-email" not in r.text


async def test_email_not_configured_is_503(app, client, account):
    app.state.settings = app.state.settings.model_copy(update={"email_backend": "off"})
    r = await _reset(client, code="123456")
    assert r.status_code == 503 and r.json() == {"error": "Email is not configured"}


@pytest.mark.parametrize("settings_overrides", [{"rate_limit_per_minute": 3}], indirect=True)
async def test_reset_is_rate_limited_per_ip(app, client, account):
    statuses = [(await _reset(client, code="123456")).status_code for _ in range(6)]  # (the fixture used some budget)
    assert statuses[-1] == 429 and set(statuses) <= {400, 429}


async def test_a_failure_to_cut_connections_does_not_undo_the_reset(app, client, account, monkeypatch, caplog):
    async def boom(_app, _uid):
        raise RuntimeError(f"socket of {EMAIL} gone")

    monkeypatch.setattr("app.routers.account.cut_connections", boom)
    caplog.set_level(logging.DEBUG, logger="app")
    code = await mail_code(app, client, EMAIL, "reset")
    assert (await _reset(client, code=code)).status_code == 204
    assert (await _login(client, NEW)).status_code == 200
    assert "RuntimeError" in caplog.text and EMAIL not in caplog.text  # only the class name is logged


async def test_reset_logs_nothing_sensitive(app, client, account, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    code = await mail_code(app, client, EMAIL, "reset")
    await _reset(client, code="000000" if code != "000000" else "111111")
    await _reset(client, "ghost@example.com", "123456")
    await _reset(client, code=code)
    for secret in (EMAIL, "forgetful@", "ghost@", code, NEW, OLD, PEPPER):
        assert secret not in caplog.text
