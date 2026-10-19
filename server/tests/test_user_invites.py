"""Per-user permanent invite codes: eligibility, get-or-create, rotate, invitees (plan 2026-10-14-invites-v2 S5;
R-I6..R-I9, X18, X19, X32). The service takes the session, Settings, the clock and the SecretBox as parameters."""
import logging
from datetime import timedelta

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select

from app.core.secretbox import SecretBox
from app.models import InviteCode, InviteRedemption, User, utcnow
from app.services import invites, user_invites
from app.services.invites import hash_code, normalise

NOW = utcnow()
CAP = 10


def _box() -> SecretBox:
    return SecretBox(Fernet.generate_key().decode())


def _settings(app, **update):
    return app.state.settings.model_copy(update={"invites_user_min_account_days": 7,
                                                 "invites_user_code_max_uses": CAP, **update})


async def _user(app, uid: int, name: str, *, days_old: int = 10, verified: bool = True, nickname: str | None = None,
                disabled: bool = False) -> User:
    async with app.state.sessionmaker() as s:
        user = User(id=uid, username=name, password_hash="x", nickname=nickname,
                    created_at=NOW - timedelta(days=days_old),
                    email_verified_at=NOW if verified else None,
                    disabled_at=NOW if disabled else None)
        s.add(user)
        await s.commit()
        return user


async def _load(app, uid: int) -> User:
    async with app.state.sessionmaker() as s:
        return await s.get(User, uid)


async def _codes(app) -> list[InviteCode]:
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(InviteCode).order_by(InviteCode.id))).all())


async def _cap(_owner_id: int) -> int:
    return CAP


async def _run(app, fn, *args, **kwargs):
    async with app.state.sessionmaker() as s:
        return await fn(s, *args, **kwargs)


# ---- eligibility (pure) ----

def test_eligibility_reasons_are_distinct_and_ordered(app):
    settings = _settings(app)
    user = User(id=1, username="u", password_hash="x", created_at=NOW - timedelta(days=10), email_verified_at=NOW)
    assert user_invites.eligibility(user, NOW, settings, CAP) == (None, None)
    assert user_invites.eligibility(user, NOW, settings, 0) == ("invites_disabled", None)
    user.disabled_at = NOW
    assert user_invites.eligibility(user, NOW, settings, CAP) == ("disabled_by_admin", None)
    user.disabled_at = None
    user.email_verified_at = None
    assert user_invites.eligibility(user, NOW, settings, CAP) == ("email_unverified", None)
    user.email_verified_at = NOW
    user.created_at = NOW - timedelta(days=2)
    reason, ready = user_invites.eligibility(user, NOW, settings, CAP)
    assert reason == "too_new" and ready == user.created_at + timedelta(days=7)


def test_eligibility_min_days_zero_never_too_new(app):
    settings = _settings(app, invites_user_min_account_days=0)
    user = User(id=2, username="fresh", password_hash="x", created_at=NOW, email_verified_at=NOW)
    assert user_invites.eligibility(user, NOW, settings, CAP) == (None, None)


# ---- generate (get-or-create) ----

async def test_generate_is_idempotent_and_stores_only_hash_and_ciphertext(app):
    await _user(app, 40000001, "owner_a")
    box = _box()
    settings = _settings(app)
    first = await _run(app, user_invites.generate, settings, 40000001, box, NOW)
    second = await _run(app, user_invites.generate, settings, 40000001, box, NOW)
    assert first["code"] == second["code"] and first["eligible"] is True
    code = first["code"]
    assert len(normalise(code)) == 10 and code.count("-") == 1
    rows = await _codes(app)
    assert len(rows) == 1
    row = rows[0]
    assert row.kind == "user" and row.owner_user_id == 40000001 and row.revoked_at is None
    assert row.code_hash == hash_code(code) and row.uses == 0
    assert row.code_enc and code not in row.code_enc and normalise(code) not in row.code_enc
    assert code not in repr(vars(row)) and normalise(code) not in repr(vars(row))


async def test_generate_refuses_with_the_reason_and_writes_nothing(app):
    await _user(app, 40000002, "too_new_one", days_old=1)
    with pytest.raises(user_invites.NotEligible) as caught:
        await _run(app, user_invites.generate, _settings(app), 40000002, _box(), NOW)
    assert caught.value.reason == "too_new"
    assert await _codes(app) == []


async def test_generate_without_the_key_is_not_configured(app):
    await _user(app, 40000003, "no_key")
    with pytest.raises(user_invites.InvitesNotConfigured):
        await _run(app, user_invites.generate, _settings(app), 40000003, None, NOW)
    assert await _codes(app) == []


async def test_view_without_the_key_is_not_configured(app):
    await _user(app, 40000004, "no_key_view")
    with pytest.raises(user_invites.InvitesNotConfigured):
        await _run(app, user_invites.view, _settings(app), 40000004, None, NOW)


async def test_undecryptable_code_asks_for_rotation_and_generate_refuses(app):
    await _user(app, 40000005, "rekeyed")
    settings = _settings(app)
    await _run(app, user_invites.generate, settings, 40000005, _box(), NOW)  # written under another key
    other = _box()
    view = await _run(app, user_invites.view, settings, 40000005, other, NOW)
    assert view["code"] is None and view["reason"] == "rotate_required" and view["eligible"] is True
    with pytest.raises(user_invites.RotateRequired):
        await _run(app, user_invites.generate, settings, 40000005, other, NOW)
    assert len(await _codes(app)) == 1


async def test_cap_zero_hides_the_code_and_refuses_generation(app):
    await _user(app, 40000006, "cap_zero")
    settings = _settings(app, invites_user_code_max_uses=0)
    with pytest.raises(user_invites.NotEligible) as caught:
        await _run(app, user_invites.generate, settings, 40000006, _box(), NOW)
    assert caught.value.reason == "invites_disabled"


# ---- rotate ----

async def test_rotate_revokes_the_old_code_and_inherits_its_uses(app):
    await _user(app, 40000007, "rotator")
    box = _box()
    settings = _settings(app)
    old = (await _run(app, user_invites.generate, settings, 40000007, box, NOW))["code"]
    async with app.state.sessionmaker() as s:
        row = await s.scalar(select(InviteCode).where(InviteCode.code_hash == hash_code(old)))
        row.uses = 3
        await s.commit()
    new = (await _run(app, user_invites.rotate, settings, 40000007, box, NOW))["code"]
    assert new != old
    rows = await _codes(app)
    assert len(rows) == 2
    old_row, new_row = rows[0], rows[1]
    assert old_row.revoked_at is not None and old_row.code_enc is None
    assert new_row.revoked_at is None and new_row.uses == 3  # R-I8: the cap is cumulative, not multiplied
    async with app.state.sessionmaker() as s:
        with pytest.raises(invites.RedeemError) as caught:
            await invites.redeem(s, old, NOW, user_cap=_cap)
        assert caught.value.reason == "invalid"
        await s.rollback()
        row = await invites.redeem(s, new, NOW, user_cap=_cap)
        assert row.id == new_row.id


async def test_rotate_without_a_live_code_is_refused(app):
    await _user(app, 40000008, "nothing_to_replace")
    with pytest.raises(user_invites.NoCodeToReplace):
        await _run(app, user_invites.rotate, _settings(app), 40000008, _box(), NOW)


async def test_generate_after_revoke_inherits_the_cumulative_uses(app):
    await _user(app, 40000009, "revoked_then_new")
    box = _box()
    settings = _settings(app)
    await _run(app, user_invites.generate, settings, 40000009, box, NOW)
    async with app.state.sessionmaker() as s:
        row = await s.scalar(select(InviteCode).where(InviteCode.owner_user_id == 40000009))
        row.uses, row.revoked_at, row.code_enc = 4, NOW, None  # an admin revoked it
        await s.commit()
    fresh = (await _run(app, user_invites.generate, settings, 40000009, box, NOW))["code"]
    rows = await _codes(app)
    assert len(rows) == 2 and rows[1].uses == 4
    assert rows[1].code_hash == hash_code(fresh)


# ---- invitees ----

async def test_invitees_are_display_names_newest_first_and_capped_at_fifty(app):
    await _user(app, 40000010, "host")
    box = _box()
    settings = _settings(app, invites_user_code_max_uses=1000)
    code = (await _run(app, user_invites.generate, settings, 40000010, box, NOW))["code"]
    async with app.state.sessionmaker() as s:
        row = await s.scalar(select(InviteCode).where(InviteCode.code_hash == hash_code(code)))
        row.uses = 55  # what 55 real redemptions would have counted (redeem bumps uses atomically)
        for n in range(55):
            s.add(User(id=41000000 + n, username=f"guest{n}", password_hash="x",
                       nickname=("Nick" + str(n)) if n % 2 else None))
        await s.flush()
        for n in range(55):
            s.add(InviteRedemption(code_id=row.id, user_id=41000000 + n, redeemed_at=NOW + timedelta(seconds=n)))
        await s.commit()
    view = await _run(app, user_invites.view, settings, 40000010, box, NOW)
    assert len(view["invitees"]) == 50
    # newest first: n=54 is even, so it has no nickname and shows its username (display_of, INDEX X34)
    assert view["invitees"][0]["display_name"] == "guest54"
    assert view["invitees"][1]["display_name"] == "Nick53"  # n=53 is odd: nickname wins
    assert set(view["invitees"][0]) == {"display_name", "joined_at"}
    assert view["uses"] == 55 and view["cap"] == 1000


async def test_view_of_user_with_no_code_is_empty_but_eligible(app):
    await _user(app, 40000011, "no_code_yet", nickname="Shown")
    view = await _run(app, user_invites.view, _settings(app), 40000011, _box(), NOW)
    assert view == {"eligible": True, "reason": None, "available_at": None, "code": None, "uses": 0, "cap": CAP,
                    "invitees": []}


# ---- privacy: no DEBUG line carries a code ----

async def test_service_logs_never_carry_a_code(app, caplog):
    await _user(app, 40000012, "quiet_owner")
    caplog.set_level(logging.DEBUG, logger="app")
    box = _box()
    settings = _settings(app)
    code = (await _run(app, user_invites.generate, settings, 40000012, box, NOW))["code"]
    rotated = (await _run(app, user_invites.rotate, settings, 40000012, box, NOW))["code"]
    await _run(app, user_invites.view, settings, 40000012, box, NOW)
    for text in (code, rotated, normalise(code), normalise(rotated)):
        assert text not in caplog.text
