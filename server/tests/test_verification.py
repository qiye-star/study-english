"""邮箱验证码服务(计划 S14;R-F2、R-F3、R-F4、R-F5、X10)。假时钟:`now` 是参数。"""
import hashlib
import inspect
import re
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.models import EmailDailyCount, User, VerificationCode
from app.services import verification
from app.services.identities import EmailNotConfigured, subject_hmac
from app.services.verification import (MAX_ATTEMPTS, VerificationError, claim_global_quota, hidden_issue, issue,
                                       release_attempt, verify)
from tests.accounts_helpers import contains_code
from tests.conftest import make_settings

PEPPER = "p" * 40
T0 = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)
TARGET = subject_hmac(PEPPER, "alice@example.com")
OTHER = subject_hmac(PEPPER, "bob@example.com")


def _settings(**kw):
    base = dict(identity_pepper=PEPPER, email_codes_per_target_daily=10, email_daily_global=200)
    base.update(kw)
    return make_settings(**base)


async def _rows(app):
    async with app.state.sessionmaker() as s:
        return (await s.execute(select(VerificationCode).order_by(VerificationCode.id))).scalars().all()


async def test_issue_returns_a_six_digit_code_and_stores_only_the_hmac(app):
    settings = _settings()
    async with app.state.sessionmaker() as s:
        code, row = await issue(s, settings, TARGET, "register", T0)
        await s.commit()
    assert re.fullmatch(r"\d{6}", code)
    assert row.purpose == "register" and row.channel == "email" and row.target_hmac == TARGET
    assert row.expires_at - T0 == timedelta(minutes=10) or row.expires_at.replace(tzinfo=timezone.utc) - T0 == timedelta(minutes=10)
    (stored,) = await _rows(app)
    assert stored.attempts == 0 and stored.consumed_at is None
    for column in ("channel", "purpose", "target_hmac", "code_hmac"):
        assert code != getattr(stored, column)
    assert stored.code_hmac != hashlib.sha256(code.encode()).hexdigest()  # keyed, not a plain hash
    assert len(stored.code_hmac) == 64
    assert not contains_code(stored.code_hmac, code)


async def test_code_hmac_binds_purpose_target_and_code(app):
    a = verification.code_hmac(PEPPER, "register", TARGET, "123456")
    assert a == verification.code_hmac(PEPPER, "register", TARGET, "123456")
    assert a != verification.code_hmac(PEPPER, "reset", TARGET, "123456")
    assert a != verification.code_hmac(PEPPER, "register", OTHER, "123456")
    assert a != verification.code_hmac(PEPPER, "register", TARGET, "123457")
    assert a != verification.code_hmac("q" * 40, "register", TARGET, "123456")


async def test_issuing_a_new_code_voids_the_older_one(app):
    settings = _settings()
    async with app.state.sessionmaker() as s:
        first, _ = await issue(s, settings, TARGET, "register", T0)
        await s.commit()
    async with app.state.sessionmaker() as s:
        second, _ = await issue(s, settings, TARGET, "register", T0 + timedelta(seconds=61))
        await s.commit()
    rows = await _rows(app)
    assert rows[0].consumed_at is not None and rows[1].consumed_at is None
    async with app.state.sessionmaker() as s:
        with pytest.raises(VerificationError) as info:
            await verify(s, settings, TARGET, "register", first, T0 + timedelta(seconds=62))
        assert info.value.kind == "invalid"
    async with app.state.sessionmaker() as s:
        await verify(s, settings, TARGET, "register", second, T0 + timedelta(seconds=63))


async def test_other_purposes_and_targets_are_not_voided(app):
    settings = _settings()
    async with app.state.sessionmaker() as s:
        await issue(s, settings, TARGET, "register", T0)
        await issue(s, settings, TARGET, "reset", T0)
        await issue(s, settings, OTHER, "register", T0)
        await s.commit()
    assert all(r.consumed_at is None for r in await _rows(app))


async def test_cooldown_blocks_a_second_code_for_60_seconds(app):
    settings = _settings()
    async with app.state.sessionmaker() as s:
        await issue(s, settings, TARGET, "register", T0)
        await s.commit()
    async with app.state.sessionmaker() as s:
        with pytest.raises(VerificationError) as info:
            await issue(s, settings, TARGET, "register", T0 + timedelta(seconds=20))
    assert info.value.kind == "cooldown"
    assert info.value.retry_after == 40
    async with app.state.sessionmaker() as s:
        await issue(s, settings, TARGET, "register", T0 + timedelta(seconds=60))  # exactly 60 s later is allowed
        await s.commit()


async def test_cooldown_is_per_target_and_purpose(app):
    settings = _settings()
    async with app.state.sessionmaker() as s:
        await issue(s, settings, TARGET, "register", T0)
        await issue(s, settings, TARGET, "reset", T0)
        await issue(s, settings, OTHER, "register", T0)
        await s.commit()


async def test_hidden_rows_count_for_cooldown_and_daily_cap_like_real_ones(app):
    settings = _settings(email_codes_per_target_daily=2)
    async with app.state.sessionmaker() as s:
        assert await hidden_issue(s, settings, TARGET, "reset", T0) is None
        await s.commit()
    async with app.state.sessionmaker() as s:
        with pytest.raises(VerificationError) as info:
            await issue(s, settings, TARGET, "reset", T0 + timedelta(seconds=5), send=False)
        assert info.value.kind == "cooldown"
    async with app.state.sessionmaker() as s:
        await hidden_issue(s, settings, TARGET, "reset", T0 + timedelta(seconds=61))
        await s.commit()
    async with app.state.sessionmaker() as s:
        with pytest.raises(VerificationError) as info:
            await hidden_issue(s, settings, TARGET, "reset", T0 + timedelta(seconds=130))
        assert info.value.kind == "target_daily"


async def test_target_daily_cap_counts_all_purposes_for_24_hours(app):
    settings = _settings(email_codes_per_target_daily=3)
    t = T0
    async with app.state.sessionmaker() as s:
        for purpose in ("register", "reset", "register"):
            await issue(s, settings, TARGET, purpose, t)
            t += timedelta(seconds=61)
        await s.commit()
    async with app.state.sessionmaker() as s:
        with pytest.raises(VerificationError) as info:
            await issue(s, settings, TARGET, "bind", t)
    assert info.value.kind == "target_daily"
    assert info.value.retry_after and info.value.retry_after > 0
    async with app.state.sessionmaker() as s:  # 24 h after the first row it frees up again
        await issue(s, settings, TARGET, "bind", T0 + timedelta(hours=24, seconds=1))
        await s.commit()


async def test_the_eleventh_code_in_24_hours_is_refused_with_the_default_cap(app):
    settings = _settings()
    t = T0
    async with app.state.sessionmaker() as s:
        for _ in range(10):
            await issue(s, settings, TARGET, "register", t, send=False)
            t += timedelta(seconds=61)
        await s.commit()
    async with app.state.sessionmaker() as s:
        with pytest.raises(VerificationError) as info:
            await issue(s, settings, TARGET, "register", t, send=False)
    assert info.value.kind == "target_daily"


async def test_global_cap_is_claimed_atomically_and_only_when_sending(app):
    settings = _settings(email_daily_global=2)
    async with app.state.sessionmaker() as s:
        await issue(s, settings, TARGET, "register", T0)
        await issue(s, settings, OTHER, "register", T0)
        await s.commit()
    async with app.state.sessionmaker() as s:
        with pytest.raises(VerificationError) as info:
            await issue(s, settings, subject_hmac(PEPPER, "carol@example.com"), "register", T0)
        assert info.value.kind == "global_daily"
        await s.rollback()
    async with app.state.sessionmaker() as s:
        count = (await s.execute(select(EmailDailyCount))).scalar_one()
        assert count.sent == 2 and count.day == date(2026, 10, 19)
        # an unsent (hidden) code does not need quota
        await issue(s, settings, subject_hmac(PEPPER, "carol@example.com"), "register", T0, send=False)
        await hidden_issue(s, settings, subject_hmac(PEPPER, "dave@example.com"), "reset", T0)
        await s.commit()
        assert (await s.execute(select(EmailDailyCount))).scalar_one().sent == 2


async def test_global_cap_is_per_day_and_a_refused_issue_takes_no_quota(app):
    settings = _settings(email_daily_global=1, email_codes_per_target_daily=1)
    async with app.state.sessionmaker() as s:
        await issue(s, settings, TARGET, "register", T0)
        await s.commit()
    async with app.state.sessionmaker() as s:
        with pytest.raises(VerificationError) as info:  # refused by the per-target cap BEFORE it can take quota
            await issue(s, settings, TARGET, "register", T0 + timedelta(minutes=5))
        assert info.value.kind == "target_daily"
    async with app.state.sessionmaker() as s:
        assert await claim_global_quota(s, 1, date(2026, 10, 20))
        assert not await claim_global_quota(s, 1, date(2026, 10, 20))
        await s.commit()
        days = {r.day: r.sent for r in (await s.execute(select(EmailDailyCount))).scalars()}
        assert days == {date(2026, 10, 19): 1, date(2026, 10, 20): 1}


async def test_verify_consumes_without_committing(app):
    settings = _settings()
    async with app.state.sessionmaker() as s:
        code, _ = await issue(s, settings, TARGET, "register", T0)
        await s.commit()
    async with app.state.sessionmaker() as s:
        row = await verify(s, settings, TARGET, "register", code, T0 + timedelta(minutes=1))
        assert row.consumed_at is not None
        await s.rollback()  # the caller failed later: the code can be used again
    async with app.state.sessionmaker() as s:
        row = await verify(s, settings, TARGET, "register", code, T0 + timedelta(minutes=2))
        assert row.consumed_at is not None
        await s.commit()
    async with app.state.sessionmaker() as s:
        with pytest.raises(VerificationError):  # one-shot
            await verify(s, settings, TARGET, "register", code, T0 + timedelta(minutes=3))


async def test_a_wrong_code_counts_an_attempt_in_its_own_committed_transaction(app):
    settings = _settings()
    async with app.state.sessionmaker() as s:
        code, _ = await issue(s, settings, TARGET, "register", T0)
        await s.commit()
    wrong = "000000" if code != "000000" else "000001"
    async with app.state.sessionmaker() as s:
        with pytest.raises(VerificationError) as info:
            await verify(s, settings, TARGET, "register", wrong, T0 + timedelta(minutes=1))
        assert info.value.kind == "invalid"
        await s.rollback()  # even if the caller rolls back, the attempt stays counted
    (row,) = await _rows(app)
    assert row.attempts == 1 and row.consumed_at is None


async def test_a_correct_code_does_not_burn_an_attempt_when_the_caller_rolls_back_and_releases(app):
    settings = _settings()
    async with app.state.sessionmaker() as s:
        code, _ = await issue(s, settings, TARGET, "register", T0)
        await s.commit()
    for i in range(MAX_ATTEMPTS + 2):  # more successful verifications than the failure limit
        async with app.state.sessionmaker() as s:
            row = await verify(s, settings, TARGET, "register", code, T0 + timedelta(seconds=10 + i))
            row_id = row.id
            await s.rollback()
            await release_attempt(s, row_id)  # the caller failed after a valid code: the code stays usable
    (row,) = await _rows(app)
    assert row.attempts == 0 and row.consumed_at is None


async def test_the_fifth_failure_kills_the_code_even_for_the_right_one(app):
    settings = _settings()
    async with app.state.sessionmaker() as s:
        code, _ = await issue(s, settings, TARGET, "register", T0)
        await s.commit()
    wrong = "000000" if code != "000000" else "000001"
    for i in range(MAX_ATTEMPTS):
        async with app.state.sessionmaker() as s:
            with pytest.raises(VerificationError):
                await verify(s, settings, TARGET, "register", wrong, T0 + timedelta(seconds=i))
    async with app.state.sessionmaker() as s:
        with pytest.raises(VerificationError) as info:
            await verify(s, settings, TARGET, "register", code, T0 + timedelta(seconds=30))
    assert info.value.kind == "invalid"
    (row,) = await _rows(app)
    assert row.attempts == MAX_ATTEMPTS  # no more counting once it is dead


async def test_expired_consumed_wrong_purpose_wrong_target_and_missing_all_look_the_same(app):
    settings = _settings()
    async with app.state.sessionmaker() as s:
        code, _ = await issue(s, settings, TARGET, "register", T0)
        await s.commit()
    cases = [
        (TARGET, "register", code, T0 + timedelta(minutes=10, seconds=1)),  # expired
        (TARGET, "reset", code, T0 + timedelta(minutes=1)),  # another purpose
        (OTHER, "register", code, T0 + timedelta(minutes=1)),  # another target
        (TARGET, "register", "999999" if code != "999999" else "999998", T0 + timedelta(minutes=1)),  # wrong
        (subject_hmac(PEPPER, "nobody@example.com"), "register", code, T0 + timedelta(minutes=1)),  # no code at all
    ]
    messages = set()
    for target, purpose, attempt, now in cases:
        async with app.state.sessionmaker() as s:
            with pytest.raises(VerificationError) as info:
                await verify(s, settings, target, purpose, attempt, now)
        assert info.value.kind == "invalid"
        messages.add((str(info.value), info.value.retry_after))
    assert len(messages) == 1


async def test_a_code_cannot_be_used_after_expiry_even_with_attempts_left(app):
    settings = _settings()
    async with app.state.sessionmaker() as s:
        code, _ = await issue(s, settings, TARGET, "bind", T0)
        await s.commit()
    async with app.state.sessionmaker() as s:
        await verify(s, settings, TARGET, "bind", code, T0 + timedelta(minutes=9, seconds=59))
        await s.rollback()
    async with app.state.sessionmaker() as s:
        with pytest.raises(VerificationError):
            await verify(s, settings, TARGET, "bind", code, T0 + timedelta(minutes=10))


async def test_hidden_issue_writes_a_row_nobody_can_satisfy(app):
    settings = _settings()
    async with app.state.sessionmaker() as s:
        assert await hidden_issue(s, settings, TARGET, "reset", T0) is None
        await s.commit()
    (row,) = await _rows(app)
    assert row.purpose == "reset" and row.target_hmac == TARGET and row.consumed_at is None
    assert len(row.code_hmac) == 64
    for guess in ("000000", "123456", "111111"):  # a hidden code is random: guesses only burn attempts
        async with app.state.sessionmaker() as s:
            with pytest.raises(VerificationError):
                await verify(s, settings, TARGET, "reset", guess, T0 + timedelta(seconds=1))


async def test_hidden_and_real_rows_have_the_same_shape(app):
    settings = _settings()
    async with app.state.sessionmaker() as s:
        await issue(s, settings, TARGET, "register", T0)
        await hidden_issue(s, settings, OTHER, "register", T0)
        await s.commit()
    real, hidden = await _rows(app)
    assert (real.channel, real.purpose, real.attempts, real.consumed_at) == (
        hidden.channel, hidden.purpose, hidden.attempts, hidden.consumed_at)
    assert real.expires_at == hidden.expires_at and real.created_at == hidden.created_at
    assert real.user_id == hidden.user_id


async def test_user_id_is_stored_for_bind_codes(app):
    settings = _settings()
    async with app.state.sessionmaker() as s:
        s.add(User(id=11111111, username="alice", password_hash="x"))
        await s.commit()
    async with app.state.sessionmaker() as s:
        await issue(s, settings, TARGET, "bind", T0, user_id=11111111)
        await s.commit()
    (row,) = await _rows(app)
    assert row.user_id == 11111111


async def test_unknown_purpose_and_missing_pepper_are_programming_errors(app):
    async with app.state.sessionmaker() as s:
        with pytest.raises(ValueError):
            await issue(s, _settings(), TARGET, "delete_account", T0)
        with pytest.raises(EmailNotConfigured):
            await issue(s, _settings(identity_pepper=""), TARGET, "register", T0)


def test_module_never_logs():
    assert "logging" not in inspect.getsource(verification)
    assert "logger" not in inspect.getsource(verification)


async def test_global_quota_left_is_read_only(app):
    from app.services.verification import global_quota_left

    day = date(2026, 10, 19)
    async with app.state.sessionmaker() as s:
        assert await global_quota_left(s, 1, day)
        assert await claim_global_quota(s, 1, day)
        assert not await global_quota_left(s, 1, day)
        assert await global_quota_left(s, 2, day)
        assert await global_quota_left(s, 1, date(2026, 10, 20))
        await s.commit()
        assert (await s.execute(select(EmailDailyCount))).scalar_one().sent == 1  # reading never claims


async def test_verify_takes_no_session_factory_and_works_on_a_one_connection_pool(app, tmp_path):
    """F2: the caller's connection is the only one verify may hold (a second checkout would starve the pool)."""
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.core.db import Base

    assert "sessions" not in inspect.signature(verify).parameters
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'pool.db'}", pool_size=1, max_overflow=0,
                                 pool_timeout=2)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        settings = _settings()
        async with maker() as s:
            code, _ = await issue(s, settings, TARGET, "register", T0)
            await s.commit()
        async with maker() as s:
            row = await verify(s, settings, TARGET, "register", code, T0 + timedelta(minutes=1))
            assert row.consumed_at is not None
            await s.commit()
        async with maker() as s:
            with pytest.raises(VerificationError):  # a wrong guess also needs only the one connection
                await verify(s, settings, TARGET, "register", "000000", T0 + timedelta(minutes=1))
    finally:
        await engine.dispose()


async def test_parallel_wrong_guesses_cannot_exceed_the_attempt_limit(tmp_path):
    """Real separate connections (a file database): the StaticPool test connection would mix the transactions."""
    import asyncio

    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.core.db import Base

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'race.db'}", pool_size=10)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        settings = _settings()
        async with maker() as s:
            code, _ = await issue(s, settings, TARGET, "register", T0)
            await s.commit()
        wrong = "000000" if code != "000000" else "000001"

        async def guess():
            async with maker() as s:
                try:
                    await verify(s, settings, TARGET, "register", wrong, T0 + timedelta(seconds=5))
                except VerificationError:
                    return False
                return True

        results = await asyncio.gather(*(guess() for _ in range(MAX_ATTEMPTS + 1)))
        assert not any(results)
        async with maker() as s:
            (row,) = (await s.execute(select(VerificationCode))).scalars().all()
            assert row.attempts == MAX_ATTEMPTS
            with pytest.raises(VerificationError):  # the right code is dead as well
                await verify(s, settings, TARGET, "register", code, T0 + timedelta(seconds=10))
    finally:
        await engine.dispose()


async def test_a_correct_code_leaves_attempts_unchanged_once_the_caller_commits(app):
    settings = _settings()
    async with app.state.sessionmaker() as s:
        code, _ = await issue(s, settings, TARGET, "register", T0)
        await s.commit()
    wrong = "000000" if code != "000000" else "000001"
    async with app.state.sessionmaker() as s:
        with pytest.raises(VerificationError):
            await verify(s, settings, TARGET, "register", wrong, T0 + timedelta(seconds=5))
    (before,) = await _rows(app)
    async with app.state.sessionmaker() as s:
        await verify(s, settings, TARGET, "register", code, T0 + timedelta(seconds=10))
        await s.commit()
    (after,) = await _rows(app)
    assert after.attempts == before.attempts == 1 and after.consumed_at is not None


async def test_a_caller_rollback_keeps_the_claim_until_release_attempt(app):
    settings = _settings()
    async with app.state.sessionmaker() as s:
        code, _ = await issue(s, settings, TARGET, "register", T0)
        await s.commit()
    async with app.state.sessionmaker() as s:
        row = await verify(s, settings, TARGET, "register", code, T0 + timedelta(seconds=10))
        row_id = row.id
        await s.rollback()
        assert (await _rows(app))[0].attempts == 1  # the refund went with the rollback
        await release_attempt(s, row_id)
    (row,) = await _rows(app)
    assert row.attempts == 0 and row.consumed_at is None


async def test_verify_refuses_to_run_after_a_pending_write(app):
    settings = _settings()
    async with app.state.sessionmaker() as s:
        code, _ = await issue(s, settings, TARGET, "register", T0)
        await s.commit()
    async with app.state.sessionmaker() as s:
        s.add(User(id=22222222, username="pending", password_hash="x"))
        with pytest.raises(RuntimeError, match="verify must run before any pending write"):
            await verify(s, settings, TARGET, "register", code, T0 + timedelta(seconds=10))


async def test_a_lost_race_does_not_refund_an_attempt_even_if_the_caller_commits_anyway(app):
    """Two requests use the same correct code. The loser's consume matches 0 rows: it must raise before giving the
    attempt back, so a caller that catches the error and commits cannot lower `attempts` (G2)."""
    settings = _settings()
    async with app.state.sessionmaker() as s:
        code, _ = await issue(s, settings, TARGET, "register", T0)
        await s.commit()
    (issued,) = await _rows(app)
    async with app.state.sessionmaker() as loser:
        real_commit = loser.commit
        raced: list[bool] = []

        async def commit_then_lose_the_race():
            await real_commit()  # the attempt claim is committed here
            if not raced:
                raced.append(True)
                async with app.state.sessionmaker() as winner:  # the rival request consumes the code first
                    await winner.execute(update(VerificationCode).where(VerificationCode.id == issued.id)
                                         .values(consumed_at=T0 + timedelta(seconds=11)))
                    await winner.commit()

        loser.commit = commit_then_lose_the_race
        with pytest.raises(VerificationError) as info:
            await verify(loser, settings, TARGET, "register", code, T0 + timedelta(seconds=10))
        assert info.value.kind == "invalid" and raced == [True]
        await loser.commit()  # a future caller that catches VerificationError and commits
    (row,) = await _rows(app)
    assert row.attempts == 1  # the claim stands: the losing request did not refund an attempt
    assert row.consumed_at is not None
