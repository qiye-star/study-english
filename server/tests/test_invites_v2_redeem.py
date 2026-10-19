"""Invite code generation and redemption (plan 2026-10-14-invites-v2 S3; R-I2, R-I3, X18, X19)."""
import re
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core import quotas
from app.models import InviteCode, InviteRedemption, User, UserQuotaOverride
from app.services import invites
from app.services.invites import RedeemError, generate_code, hash_code, record_redemption, redeem

NOW = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)
NEW_FORMAT = re.compile(r"^[A-HJKMNP-TV-Z2-9]{5}-[A-HJKMNP-TV-Z2-9]{5}$")

@pytest.fixture
def settings_overrides():
    return {"invites_user_code_max_uses": 10}

def _cap(session, app, key="invites_user_code_max_uses"):
    async def cap(owner_id: int) -> int:
        return await quotas.effective(session, app, owner_id, key)
    return cap

async def _user(session, uid: int, name: str, *, disabled: bool = False) -> None:
    session.add(User(id=uid, username=name, password_hash="x",
                     disabled_at=NOW if disabled else None))
    await session.flush()

async def _code(session, *, code: str, kind: str = "admin", max_uses: int = 1, uses: int = 0,
                owner: int | None = None, expires_at=None, revoked_at=None) -> InviteCode:
    row = InviteCode(code_hash=hash_code(code), max_uses=max_uses, uses=uses, created_by="op", kind=kind,
                     owner_user_id=owner, expires_at=expires_at, revoked_at=revoked_at)
    session.add(row)
    await session.flush()
    return row

def test_generated_codes_use_the_unambiguous_alphabet_and_do_not_repeat():
    codes = [generate_code() for _ in range(1000)]
    assert all(NEW_FORMAT.match(c) for c in codes)
    assert not any(set(c) & set("I L O U 0 1".split()) for c in codes)
    assert len(set(codes)) == 1000

async def test_old_twelve_character_admin_codes_still_redeem(app):
    async with app.state.sessionmaker() as s:
        await _code(s, code="ABCD-EFGH-JKMN", max_uses=2)
        await s.commit()
    async with app.state.sessionmaker() as s:
        row = await redeem(s, " abcd efgh - jkmn ", NOW, user_cap=_cap(s, app))
        assert row.kind == "admin"
        await s.commit()

async def test_admin_code_is_single_use_and_expiry_and_revocation_are_invalid(app):
    async with app.state.sessionmaker() as s:
        await _code(s, code="ONCE-ONCE-AA")
        await _code(s, code="LATE-LATE-AA", expires_at=NOW - timedelta(seconds=1))
        await _code(s, code="GONE-GONE-AA", revoked_at=NOW)
        await s.commit()
    async with app.state.sessionmaker() as s:
        await redeem(s, "ONCE-ONCE-AA", NOW, user_cap=_cap(s, app))
        await s.commit()
    async with app.state.sessionmaker() as s:
        with pytest.raises(RedeemError) as used:
            await redeem(s, "ONCE-ONCE-AA", NOW, user_cap=_cap(s, app))
        assert used.value.reason == "used_up"
        for dead in ("LATE-LATE-AA", "GONE-GONE-AA", "NOPE-NOPE-AA", ""):
            with pytest.raises(RedeemError) as bad:
                await redeem(s, dead, NOW, user_cap=_cap(s, app))
            assert bad.value.reason == "invalid"

async def test_user_code_caps_follow_the_live_quota(app):
    async with app.state.sessionmaker() as s:
        await _user(s, 20000001, "owner_a")
        await _code(s, code="USER-CODE-AA", kind="user", max_uses=10, owner=20000001)
        await s.commit()

    async def use() -> None:
        async with app.state.sessionmaker() as s:
            await redeem(s, "USER-CODE-AA", NOW, user_cap=_cap(s, app))
            await s.commit()

    for _ in range(10):  # the site default cap is 10
        await use()
    async with app.state.sessionmaker() as s:
        with pytest.raises(RedeemError) as full:
            await redeem(s, "USER-CODE-AA", NOW, user_cap=_cap(s, app))
        assert full.value.reason == "used_up"
        s.add(UserQuotaOverride(user_id=20000001, key="invites_user_code_max_uses", value=12, expires_at=None,
                                note="", updated_by="op", updated_at=NOW))
        await s.commit()
    quotas.quota_cache(app).invalidate(20000001)  # an admin write invalidates the cached overrides
    await use()
    await use()  # the raised cap applies to the very next redemption
    async with app.state.sessionmaker() as s:
        with pytest.raises(RedeemError):
            await redeem(s, "USER-CODE-AA", NOW, user_cap=_cap(s, app))
        row = await s.scalar(select(InviteCode).where(InviteCode.code_hash == hash_code("USER-CODE-AA")))
        assert row.uses == 12

async def test_user_cap_of_zero_is_used_up_at_once(app):
    async with app.state.sessionmaker() as s:
        await _user(s, 20000002, "owner_b")
        await _code(s, code="ZERO-CODE-AA", kind="user", max_uses=10, owner=20000002)
        s.add(UserQuotaOverride(user_id=20000002, key="invites_user_code_max_uses", value=0, expires_at=None,
                                note="", updated_by="op", updated_at=NOW))
        await s.commit()
    async with app.state.sessionmaker() as s:
        with pytest.raises(RedeemError) as zero:
            await redeem(s, "ZERO-CODE-AA", NOW, user_cap=_cap(s, app))
        assert zero.value.reason == "used_up"

async def test_disabled_or_deleted_owner_makes_the_user_code_invalid(app):
    async with app.state.sessionmaker() as s:
        await _user(s, 20000003, "owner_c", disabled=True)
        await _code(s, code="OFF-CODE-AAA", kind="user", max_uses=10, owner=20000003)
        await _code(s, code="ORPHAN-CODE", kind="user", max_uses=10, owner=None)
        await s.commit()
    async with app.state.sessionmaker() as s:
        for dead in ("OFF-CODE-AAA", "ORPHAN-CODE"):
            with pytest.raises(RedeemError) as bad:
                await redeem(s, dead, NOW, user_cap=_cap(s, app))
            assert bad.value.reason == "invalid"

async def test_two_redemptions_of_the_last_use_cannot_both_win(app, monkeypatch):
    """The race: our pre-check reads uses == 0, a competitor takes the last use and commits, then our conditional
    UPDATE runs. The UPDATE must refuse, so our redemption answers used_up and adds nothing."""
    async with app.state.sessionmaker() as s:
        await _code(s, code="RACE-CODE-AA", max_uses=1)
        await s.commit()

    real_live_row = invites._live_row
    competitor_ran = []

    async def stale_read(session, code_hash):
        row = await real_live_row(session, code_hash)
        if not competitor_ran:  # once: the competitor redeems between our read and our UPDATE
            competitor_ran.append(True)
            monkeypatch.setattr(invites, "_live_row", real_live_row)
            await redeem(session, "RACE-CODE-AA", NOW, user_cap=_cap(session, app))
            await session.commit()
        return row

    monkeypatch.setattr(invites, "_live_row", stale_read)
    async with app.state.sessionmaker() as s:
        with pytest.raises(RedeemError) as lost:
            await redeem(s, "RACE-CODE-AA", NOW, user_cap=_cap(s, app))
        assert lost.value.reason == "used_up"
        await s.rollback()
    assert competitor_ran == [True]
    async with app.state.sessionmaker() as s:
        row = await s.scalar(select(InviteCode).where(InviteCode.code_hash == hash_code("RACE-CODE-AA")))
        assert row.uses == 1  # the competitor's use only

async def test_redeem_does_not_commit_so_a_rollback_gives_the_use_back(app):
    async with app.state.sessionmaker() as s:
        await _code(s, code="HOLD-CODE-AA", max_uses=1)
        await s.commit()
    async with app.state.sessionmaker() as s:
        await redeem(s, "HOLD-CODE-AA", NOW, user_cap=_cap(s, app))
        await s.rollback()
    async with app.state.sessionmaker() as s:
        row = await s.scalar(select(InviteCode).where(InviteCode.code_hash == hash_code("HOLD-CODE-AA")))
        assert row.uses == 0

async def test_record_redemption_only_adds_to_the_session(app):
    async with app.state.sessionmaker() as s:
        await _user(s, 20000004, "guest_d")
        row = await _code(s, code="REC-CODE-AAA", max_uses=5)
        await s.commit()
    async with app.state.sessionmaker() as s:
        row = await s.scalar(select(InviteCode).where(InviteCode.code_hash == hash_code("REC-CODE-AAA")))
        record_redemption(s, row, 20000004, NOW)
        assert any(isinstance(obj, InviteRedemption) for obj in s.new)
        await s.rollback()
    async with app.state.sessionmaker() as s:
        assert (await s.scalars(select(InviteRedemption))).all() == []

