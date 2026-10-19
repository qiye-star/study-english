"""Registration writes who invited whom, and bad invite codes are counted per IP (plan 2026-10-14-invites-v2 S4;
R-I4, R-I5, X20). Both registration paths: the email path (EMAIL_REGISTRATION_REQUIRED on) and the legacy one."""
import logging

import pytest
from sqlalchemy import func, select

from app.models import InviteCode, InviteRedemption, User
from app.services.invites import hash_code
from tests.accounts_helpers import enable_email, mail_code, register_body

ENV_CODE = "ENV-CODE-123"
ADMIN_CODE = "ADMN-CODE-AAAA"
USER_CODE = "USER-CODE-BBBB"

@pytest.fixture
def settings_overrides():
    # the legacy registration path by default; email tests switch it on with enable_email()
    return {"registration_mode": "invite", "invite_code": ENV_CODE, "email_registration_required": False}

async def _code(app, code: str, *, kind: str = "admin", max_uses: int = 1, uses: int = 0, owner: int | None = None):
    async with app.state.sessionmaker() as s:
        s.add(InviteCode(code_hash=hash_code(code), max_uses=max_uses, uses=uses, created_by="op", kind=kind,
                         owner_user_id=owner))
        await s.commit()

async def _row(app, code: str) -> InviteCode:
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(InviteCode).where(InviteCode.code_hash == hash_code(code)))

async def _redemptions(app) -> list[InviteRedemption]:
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(InviteRedemption))).all())

async def _user_id(app, name: str) -> int:
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(User.id).where(User.username == name))

_owner_ids = iter(range(30000001, 30000500))

async def _owner(app, name: str) -> int:
    """An existing account made directly (the public registration is closed to these tests), returns its id."""
    uid = next(_owner_ids)
    async with app.state.sessionmaker() as s:
        s.add(User(id=uid, username=name, password_hash="x"))
        await s.commit()
    return uid

async def _users(app) -> int:
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(func.count()).select_from(User))

def _legacy(name: str, code: str | None, **extra) -> dict:
    body = {"username": name, "password": "password123"}
    if code is not None:
        body["invite_code"] = code
    body.update(extra)
    return body

async def _post(client, body):
    return await client.post("/api/users", json=body)

# ---- legacy registration path ----

async def test_legacy_admin_code_writes_one_attribution_row(app, client):
    await _code(app, ADMIN_CODE, max_uses=2)
    r = await _post(client, _legacy("guest_one", ADMIN_CODE))
    assert r.status_code == 200, r.text
    uid = await _user_id(app, "guest_one")
    row = await _row(app, ADMIN_CODE)
    rows = await _redemptions(app)
    assert row.uses == 1 and [(x.code_id, x.user_id) for x in rows] == [(row.id, uid)]

async def test_legacy_user_code_counts_against_its_owner(app, client):
    owner = await _owner(app, "owner_legacy")
    await _code(app, USER_CODE, kind="user", max_uses=10, owner=owner)
    assert (await _post(client, _legacy("guest_two", USER_CODE))).status_code == 200
    row = await _row(app, USER_CODE)
    assert row.uses == 1 and row.owner_user_id == owner
    rows = await _redemptions(app)
    assert len(rows) == 1 and rows[0].user_id == await _user_id(app, "guest_two") and rows[0].code_id == row.id

async def test_username_conflict_leaves_the_use_and_no_attribution(app, client):
    await _owner(app, "taken_name")
    await _code(app, ADMIN_CODE, max_uses=2)
    r = await _post(client, _legacy("taken_name", ADMIN_CODE))
    assert r.status_code == 409
    assert (await _row(app, ADMIN_CODE)).uses == 0 and await _redemptions(app) == []

async def test_env_code_and_open_mode_write_no_attribution(app, client):
    assert (await _post(client, _legacy("env_user", ENV_CODE))).status_code == 200
    assert await _redemptions(app) == []
    async with app.state.sessionmaker() as s:
        s.add(InviteCode(code_hash=hash_code(ADMIN_CODE), max_uses=1, uses=0, created_by="op"))
        await s.commit()
    app.state.base_settings = app.state.settings = app.state.settings.model_copy(update={"registration_mode": "open"})
    assert (await _post(client, _legacy("open_user", ADMIN_CODE))).status_code == 200  # X20: codes ignored
    assert (await _row(app, ADMIN_CODE)).uses == 0 and await _redemptions(app) == []

async def test_used_up_and_invalid_keep_their_two_messages(app, client):
    await _code(app, ADMIN_CODE, max_uses=1)
    assert (await _post(client, _legacy("first_g", ADMIN_CODE))).status_code == 200
    r = await _post(client, _legacy("second_g", ADMIN_CODE))
    assert r.status_code == 403 and r.json() == {"error": "Invite code used up"}
    r = await _post(client, _legacy("third_g", "NOPE-NOPE-NOPE"))
    assert r.status_code == 403 and r.json() == {"error": "Invalid invite code"}
    assert len(await _redemptions(app)) == 1

async def test_bad_codes_per_ip_block_even_the_right_code_then_expire_by_window(app, client):
    await _code(app, ADMIN_CODE, max_uses=5)
    for n in range(5):  # the default allowance: five bad codes per IP per hour
        assert (await _post(client, _legacy(f"bad_{n}", "BAD-BAD-BAD-BAD"))).status_code == 403
    r = await _post(client, _legacy("blocked_g", ADMIN_CODE))  # the right code is refused without being looked at
    assert r.status_code == 429 and r.json() == {"error": "Too many requests, please try again later"}
    assert (await _row(app, ADMIN_CODE)).uses == 0
    assert (await _post(client, _legacy("no_code_g", None))).status_code == 403  # a request without a code is not limited

async def test_bad_code_allowance_follows_the_hot_setting(app, client):
    app.state.base_settings = app.state.settings = app.state.settings.model_copy(
        update={"invite_failures_per_ip_hourly": 1})
    app.state.invite_fail_limiter.limit = 1
    assert (await _post(client, _legacy("hot_one", "BAD-BAD-BAD-BAD"))).status_code == 403
    assert (await _post(client, _legacy("hot_two", ENV_CODE))).status_code == 429

async def test_registration_logs_never_contain_a_code(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    await _code(app, ADMIN_CODE, max_uses=1)
    await _code(app, USER_CODE, kind="user", max_uses=10, owner=await _owner(app, "owner_log"))
    await _post(client, _legacy("log_one", ADMIN_CODE))
    await _post(client, _legacy("log_two", "BAD-BAD-BAD-BAD"))
    await _post(client, _legacy("log_three", USER_CODE))
    text = caplog.text + " ".join(str(r.__dict__) for r in caplog.records)
    for code in (ADMIN_CODE, USER_CODE, "ADMNCODEAAAA", "USERCODEBBBB", "BADBADBADBAD", ENV_CODE):
        assert code not in text

# ---- email registration path ----

def _email_on(app, **overrides):
    return enable_email(app, **{"email_registration_required": True, "registration_mode": "invite",
                                "invite_code": "", **overrides})

async def test_email_path_admin_code_writes_one_attribution_row(app, client):
    _email_on(app)
    await _code(app, ADMIN_CODE, max_uses=2)
    code = await mail_code(app, client, "mail_one@example.com")
    r = await _post(client, register_body("mail_one@example.com", code, username="mail_one", invite_code=ADMIN_CODE))
    assert r.status_code == 200, r.text
    rows = await _redemptions(app)
    assert len(rows) == 1 and rows[0].user_id == await _user_id(app, "mail_one")
    assert (await _row(app, ADMIN_CODE)).uses == 1

async def test_email_path_user_code_counts_against_its_owner(app, client):
    _email_on(app)
    owner = await _owner(app, "owner_mail")
    await _code(app, USER_CODE, kind="user", max_uses=10, owner=owner)
    code = await mail_code(app, client, "mail_two@example.com")
    r = await _post(client, register_body("mail_two@example.com", code, username="mail_two", invite_code=USER_CODE))
    assert r.status_code == 200, r.text
    assert (await _row(app, USER_CODE)).uses == 1
    assert [x.user_id for x in await _redemptions(app)] == [await _user_id(app, "mail_two")]

async def test_email_path_username_conflict_rolls_back_the_use_and_frees_the_code(app, client):
    _email_on(app)
    await _owner(app, "dup_mail")
    await _code(app, ADMIN_CODE, max_uses=1)
    code = await mail_code(app, client, "mail_three@example.com")
    r = await _post(client, register_body("mail_three@example.com", code, username="dup_mail", invite_code=ADMIN_CODE))
    assert r.status_code == 409
    assert (await _row(app, ADMIN_CODE)).uses == 0 and await _redemptions(app) == []
    r = await _post(client, register_body("mail_three@example.com", code, username="fresh_mail", invite_code=ADMIN_CODE))
    assert r.status_code == 200, r.text  # the use and the email code were both given back

async def test_email_path_bad_and_used_up_codes_answer_as_before_and_count_per_ip(app, client):
    _email_on(app)
    await _code(app, ADMIN_CODE, max_uses=1)
    code = await mail_code(app, client, "mail_four@example.com")
    r = await _post(client, register_body("mail_four@example.com", code, username="mail_four", invite_code="BAD-BAD-BAD-BAD"))
    assert r.status_code == 403 and r.json() == {"error": "Invalid invite code"}
    code = await mail_code(app, client, "mail_five@example.com")
    assert (await _post(client, register_body("mail_five@example.com", code, username="mail_five",
                                              invite_code=ADMIN_CODE))).status_code == 200
    code = await mail_code(app, client, "mail_six@example.com")
    r = await _post(client, register_body("mail_six@example.com", code, username="mail_six", invite_code=ADMIN_CODE))
    assert r.status_code == 403 and r.json() == {"error": "Invite code used up"}
    assert await _users(app) == 1 and len(await _redemptions(app)) == 1  # only mail_five was created
