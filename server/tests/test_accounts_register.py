"""Registration with a verified email, one transaction (plan S17; R-F7, R-F3, INDEX X11)."""
import logging

from sqlalchemy import func, select

from app.core.secretbox import box_for
from app.models import AccessToken, InviteCode, User, UserIdentity, VerificationCode
from app.services import identities
from app.services.invites import hash_code
from tests.accounts_helpers import PEPPER, bind, enable_email, fake_sender, mail_code, register_body
from tests.background import drain_background
from tests.test_admin_api import register as plain_register

EMAIL = "newbie@example.com"
INVALID = {"error": "Invalid or expired code"}
INVITE = "GOOD-CODE-1234"


def _on(app, **overrides):
    return enable_email(app, **{"email_registration_required": True, **overrides})


def _set(app, **values):
    """Change settings of an app that already has email switched on (keeps the encryption key)."""
    app.state.base_settings = app.state.settings = app.state.settings.model_copy(update=values)


async def _seed(app, client, name, email):
    """An existing account with a verified email (the old username + password flow, then bind directly)."""
    _set(app, email_registration_required=False)
    uid, _ = await plain_register(client, name)
    await bind(app, uid, email)
    _set(app, email_registration_required=True)


async def _post(client, body):
    return await client.post("/api/users", json=body)


async def _users(app) -> int:
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(func.count()).select_from(User))


async def _last_code_row(app) -> VerificationCode:
    async with app.state.sessionmaker() as s:
        return (await s.execute(select(VerificationCode).order_by(VerificationCode.id.desc()))).scalars().first()


async def _add_invite(app, uses_allowed=1):
    async with app.state.sessionmaker() as s:
        s.add(InviteCode(code_hash=hash_code(INVITE), max_uses=uses_allowed, created_by="t"))
        await s.commit()


async def _invite_uses(app) -> int:
    async with app.state.sessionmaker() as s:
        return (await s.execute(select(InviteCode.uses))).scalar_one()


def _wrong(code: str) -> str:
    return "000000" if code != "000000" else "111111"


async def test_register_with_code_creates_user_identity_and_verified_flag(app, client):
    _on(app)
    code = await mail_code(app, client, EMAIL)
    r = await _post(client, register_body(EMAIL, code))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "newbie" and body["nickname"] == "Newbie" and body["access_token"]
    assert r.headers.get("cache-control") == "no-store"
    assert (await client.get("/api/me", headers={"Authorization": f"Bearer {body['access_token']}"})).status_code == 200
    async with app.state.sessionmaker() as s:
        user = (await s.execute(select(User).where(User.username == "newbie"))).scalar_one()
        ident = (await s.execute(select(UserIdentity))).scalar_one()
        assert user.email_verified_at is not None and ident.user_id == user.id and ident.provider == "email"
        assert identities.decrypt_email(box_for(app.state.settings), ident.subject_enc) == EMAIL
        assert ident.subject_hmac == identities.subject_hmac(PEPPER, EMAIL)
    assert (await _last_code_row(app)).consumed_at is not None


async def test_missing_email_is_a_friendly_400(app, client):
    _on(app)
    r = await _post(client, {"username": "olduser", "password": "password123"})  # what the desktop client sends
    assert r.status_code == 400
    assert r.json() == {"error": "Email verification required: please register in the web app"}
    assert await _users(app) == 0


async def test_nickname_and_code_are_required_when_email_is_required(app, client):
    _on(app)
    code = await mail_code(app, client, EMAIL)
    r = await _post(client, register_body(EMAIL, code, nickname=None))
    assert r.status_code == 422 and "nickname" in r.json()["error"]
    r = await _post(client, register_body(EMAIL, None))
    assert r.status_code == 422 and "email_code" in r.json()["error"]
    assert await _users(app) == 0
    assert (await _post(client, register_body(EMAIL, code))).status_code == 200  # the code was never touched


async def test_wrong_code_is_400_and_counts_an_attempt(app, client):
    _on(app)
    code = await mail_code(app, client, EMAIL)
    r = await _post(client, register_body(EMAIL, _wrong(code)))
    assert r.status_code == 400 and r.json() == INVALID
    assert (await _last_code_row(app)).attempts == 1
    assert await _users(app) == 0
    assert (await _post(client, register_body(EMAIL, code))).status_code == 200  # a wrong guess does not burn the code


async def test_five_wrong_codes_lock_the_right_one_out(app, client):
    _on(app)
    code = await mail_code(app, client, EMAIL)
    for _ in range(5):
        assert (await _post(client, register_body(EMAIL, _wrong(code)))).status_code == 400
    r = await _post(client, register_body(EMAIL, code))
    assert r.status_code == 400 and r.json() == INVALID


async def test_a_code_for_another_purpose_or_address_does_not_register(app, client):
    _on(app)
    await _seed(app, client, "someone", "someone@example.com")
    reset_code = await mail_code(app, client, "someone@example.com", "reset")
    r = await _post(client, register_body("someone@example.com", reset_code, username="thief"))
    assert r.status_code == 400 and r.json() == INVALID
    other = await mail_code(app, client, "other@example.com")
    r = await _post(client, register_body(EMAIL, other))
    assert r.status_code == 400 and r.json() == INVALID


async def test_invite_failure_rolls_back_code_consumption(app, client):
    _on(app, registration_mode="invite", invite_code="")
    await _add_invite(app)
    code = await mail_code(app, client, EMAIL)
    r = await _post(client, register_body(EMAIL, code, invite_code="WRONG-CODE"))
    assert r.status_code == 403 and r.json() == {"error": "Invalid invite code"}
    row = await _last_code_row(app)
    assert row.consumed_at is None and row.attempts == 0 and await _users(app) == 0  # a rejected invite is not a guess
    ok = await _post(client, register_body(EMAIL, code, invite_code=INVITE))
    assert ok.status_code == 200, ok.text
    assert await _invite_uses(app) == 1


async def test_username_taken_rolls_back_and_keeps_code_and_invite(app, client):
    _on(app, email_registration_required=False)
    await plain_register(client, "taken")  # the old flow, to have a login name in use
    _set(app, email_registration_required=True, registration_mode="invite", invite_code="")
    await _add_invite(app)
    code = await mail_code(app, client, EMAIL)
    r = await _post(client, register_body(EMAIL, code, username="taken", invite_code=INVITE))
    assert r.status_code == 409 and r.json() == {"error": "Username already taken"}
    row = await _last_code_row(app)
    assert row.consumed_at is None and row.attempts == 0  # a taken username is not a wrong code either
    assert await _invite_uses(app) == 0
    async with app.state.sessionmaker() as s:
        assert (await s.execute(select(UserIdentity))).first() is None
    ok = await _post(client, register_body(EMAIL, code, username="free_name", invite_code=INVITE))
    assert ok.status_code == 200, ok.text


async def test_email_taken_race_returns_the_invalid_code_error(app, client):
    _on(app)
    wrong = await _post(client, register_body(EMAIL, "000000"))  # the answer a wrong code gets, for comparison
    code = await mail_code(app, client, EMAIL)  # a real code ...
    await _seed(app, client, "racer", EMAIL)  # ... and the address is taken before the registration commits
    r = await _post(client, register_body(EMAIL, code))
    assert (r.status_code, r.content) == (wrong.status_code, wrong.content)
    assert r.status_code == 400 and r.json() == INVALID
    assert (await _last_code_row(app)).consumed_at is None
    async with app.state.sessionmaker() as s:
        assert (await s.execute(select(User).where(User.username == "newbie"))).first() is None


async def test_a_registered_address_and_an_unknown_one_fail_identically(app, client):
    """The enumeration check: same status and body for a hidden code, a wrong code and no code at all."""
    _on(app)
    await _seed(app, client, "owner", "owner@example.com")
    for address in ("owner@example.com", EMAIL):
        assert (await client.post("/api/email/code", json={"email": address, "purpose": "register"})
                ).status_code == 200  # the first gets a notice and a hidden row, the second a real code
    known = await _post(client, register_body("owner@example.com", "123456", username="u_one"))
    unknown = await _post(client, register_body(EMAIL, "123456", username="u_two"))
    never_asked = await _post(client, register_body("never@example.com", "123456", username="u_three"))
    assert {(r.status_code, r.content) for r in (known, unknown, never_asked)} == {(400, known.content)}
    assert known.json() == INVALID


async def test_plus_tag_counts_as_the_same_email(app, client):
    _on(app)
    await _seed(app, client, "plusser", "a+x@example.com")
    r = await client.post("/api/email/code", json={"email": "a@example.com", "purpose": "register"})
    assert r.status_code == 200
    await drain_background(app)
    assert fake_sender(app).purposes == ["notice_registered"]  # a notice, not a code
    for address in ("a@example.com", "a+other@example.com"):
        r = await _post(client, register_body(address, "123456", username="u_four"))
        assert r.status_code == 400 and r.json() == INVALID
    assert await _users(app) == 1


async def test_domain_policy_and_configuration_are_checked(app, client):
    _on(app)
    r = await _post(client, register_body("x@mailinator.com", "123456"))
    assert r.status_code == 422 and r.json() == {"error": "Email domain not allowed"}
    _set(app, identity_pepper="")
    r = await _post(client, register_body(EMAIL, "123456"))
    assert r.status_code == 503 and r.json() == {"error": "Email is not configured"}
    assert await _users(app) == 0


async def test_bad_email_is_422_without_echo(app, client):
    _on(app)
    r = await _post(client, register_body("not-an-email", "123456"))
    assert r.status_code == 422 and "not-an-email" not in r.text


async def test_switch_off_keeps_the_old_flow(app, client):
    _on(app, email_registration_required=False)
    r = await _post(client, {"username": "legacy", "password": "password123"})
    assert r.status_code == 200 and r.json()["access_token"]
    async with app.state.sessionmaker() as s:
        assert (await s.execute(select(UserIdentity))).first() is None
        assert (await s.execute(select(User.email_verified_at))).scalar_one() is None


async def test_closed_registration_is_still_403(app, client):
    _on(app, registration_mode="closed")
    r = await _post(client, register_body(EMAIL, "123456"))
    assert r.status_code == 403


async def test_registration_issues_one_token_in_the_same_commit(app, client):
    _on(app)
    code = await mail_code(app, client, EMAIL)
    assert (await _post(client, register_body(EMAIL, code))).status_code == 200
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(AccessToken)) == 1


async def test_register_logs_nothing_sensitive(app, client, caplog):
    _on(app)
    caplog.set_level(logging.DEBUG, logger="app")
    code = await mail_code(app, client, EMAIL)
    await _post(client, register_body(EMAIL, _wrong(code), username="log_one"))
    ok = await _post(client, register_body(EMAIL, code, username="log_two", password="very-secret-pass-77",
                                           nickname="Secret Nick"))
    token = ok.json()["access_token"]
    await drain_background(app)
    for secret in (EMAIL, "newbie@", code, "very-secret-pass-77", "Secret Nick", token, PEPPER):
        assert secret not in caplog.text
