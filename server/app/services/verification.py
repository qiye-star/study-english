"""邮箱验证码(计划 S14;spec §4.1;R-F2、R-F3、R-F4、R-F5、INDEX X10、X32)。

纯服务:会话、设置、时钟 `now`、会话工厂都由调用方传入;不读 `app.state`;不记录日志;错误不带目标或码。

- 6 位数字码用 `secrets` 生成,库里只存 `HMAC-SHA256(pepper, "<purpose>:<target_hmac>:<code>")`:码绑定到用途与目标,
  拿去别的用途或别的邮箱校验必然失败;比较用 `hmac.compare_digest`。
- 同一 `(target, purpose)` 新码生成时旧码作废;有效期 10 分钟、最多 5 次试错、同目标重发冷却 60 秒。
- 试错次数先在**独立事务**里原子认领并提交(`attempts < 5` 的条件 UPDATE,并发猜码也不能超过上限),
  再比较;比较成功立刻在独立事务里把这次认领还回去,所以「只有错误才计数」,调用方后续失败回滚时码仍可再用。
  验证成功只在调用方的事务里置 `consumed_at`(条件 UPDATE:同一个码不会被并发消费两次)。
- 「没有码 / 过期 / 次数用完 / 已消费 / 别的用途或目标 / 不匹配」得到同一个 `VerificationError("invalid")`。
- `hidden_issue`(X10):已注册邮箱的注册码、未注册邮箱的重置码也写一行从不发送的随机码,
  使冷却与每日上限对所有邮箱一视同仁,发码接口因此可以如实返回 429 而不泄露「是否已注册」。
- 全局日上限(R-F4):`email_daily_counts` 的条件 UPDATE 原子认领一个额度,多进程也准确;只在真的要发信时认领,
  并且放在其他检查之后,被拒绝的请求不会占额度(认领在调用方的事务里,调用方回滚即归还)。按 UTC 日计。
"""
import hashlib
import hmac
import math
import secrets
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.db import insert_ignore
from app.models import EmailDailyCount, VerificationCode
from app.services.identities import EmailNotConfigured

PURPOSES = frozenset({"register", "reset", "bind", "change_email"})
CHANNEL = "email"
CODE_TTL = timedelta(minutes=10)
MAX_ATTEMPTS = 5
COOLDOWN = timedelta(seconds=60)
TARGET_WINDOW = timedelta(hours=24)


class VerificationError(Exception):
    """`kind`: cooldown / target_daily / global_daily (issuing) or invalid (verifying). `str()` is the kind only."""

    def __init__(self, kind: str, retry_after: int | None = None):
        super().__init__(kind)
        self.kind = kind
        self.retry_after = retry_after


def _utc(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; they were written as UTC."""
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _pepper(settings: Settings) -> str:
    if not settings.identity_pepper:
        raise EmailNotConfigured("email is not configured")
    return settings.identity_pepper


def _purpose(purpose: str) -> str:
    if purpose not in PURPOSES:
        raise ValueError("unknown purpose")
    return purpose


def code_hmac(pepper: str, purpose: str, target_hmac: str, code: str) -> str:
    return hmac.new(pepper.encode(), f"{purpose}:{target_hmac}:{code}".encode(), hashlib.sha256).hexdigest()


def _new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


async def claim_global_quota(session: AsyncSession, cap: int, day: date) -> bool:
    """Take one unit of the day's global sending quota (R-F4). In the caller's transaction."""
    await session.execute(insert_ignore(session, EmailDailyCount.__table__).values(day=day, sent=0))
    result = await session.execute(
        update(EmailDailyCount).where(EmailDailyCount.day == day, EmailDailyCount.sent < cap)
        .values(sent=EmailDailyCount.sent + 1).execution_options(synchronize_session=False))
    return result.rowcount == 1


async def global_quota_left(session: AsyncSession, cap: int, day: date) -> bool:
    """Read-only twin of `claim_global_quota`: is there still room today? Used by the paths that send nothing
    (an unknown address asking for a reset) so that an exhausted quota answers them like everyone else (X10)."""
    sent = await session.scalar(select(EmailDailyCount.sent).where(EmailDailyCount.day == day))
    return (sent or 0) < cap


async def _guard(session: AsyncSession, settings: Settings, target_hmac: str, purpose: str, now: datetime) -> None:
    """Cooldown (per target + purpose) and the per-target daily cap (all purposes, hidden rows included)."""
    last = await session.scalar(select(func.max(VerificationCode.created_at)).where(
        VerificationCode.channel == CHANNEL, VerificationCode.target_hmac == target_hmac,
        VerificationCode.purpose == purpose))
    if last is not None:
        wait = COOLDOWN - (now - _utc(last))
        if wait > timedelta(0):
            raise VerificationError("cooldown", max(1, math.ceil(wait.total_seconds())))
    cap = settings.email_codes_per_target_daily
    recent = (await session.execute(
        select(VerificationCode.created_at).where(
            VerificationCode.channel == CHANNEL, VerificationCode.target_hmac == target_hmac,
            VerificationCode.created_at > now - TARGET_WINDOW).order_by(VerificationCode.created_at))).scalars().all()
    if len(recent) >= cap:
        frees_at = _utc(recent[len(recent) - cap]) + TARGET_WINDOW  # the row whose leaving makes room
        raise VerificationError("target_daily", max(1, math.ceil((frees_at - now).total_seconds())))


async def _write(session: AsyncSession, settings: Settings, target_hmac: str, purpose: str, now: datetime,
                 user_id: int | None) -> tuple[str, VerificationCode]:
    code = _new_code()
    await session.execute(
        update(VerificationCode).where(
            VerificationCode.channel == CHANNEL, VerificationCode.target_hmac == target_hmac,
            VerificationCode.purpose == purpose, VerificationCode.consumed_at.is_(None))
        .values(consumed_at=now).execution_options(synchronize_session=False))
    row = VerificationCode(
        channel=CHANNEL, purpose=purpose, target_hmac=target_hmac, user_id=user_id,
        code_hmac=code_hmac(_pepper(settings), purpose, target_hmac, code), expires_at=now + CODE_TTL, attempts=0,
        consumed_at=None, created_at=now)
    session.add(row)
    await session.flush()
    return code, row


async def issue(session: AsyncSession, settings: Settings, target_hmac: str, purpose: str, now: datetime, *,
                send: bool = True, user_id: int | None = None) -> tuple[str, VerificationCode]:
    """Create a code for `(target, purpose)` and return `(plaintext code, row)`. The caller commits and then hands
    the code to the mailer. `send=False` is for codes that will not be mailed (no global quota is taken).
    Raises VerificationError: cooldown / target_daily / global_daily."""
    _purpose(purpose)
    _pepper(settings)
    await _guard(session, settings, target_hmac, purpose, now)
    if send and not await claim_global_quota(session, settings.email_daily_global, now.astimezone(timezone.utc).date()):
        raise VerificationError("global_daily")
    return await _write(session, settings, target_hmac, purpose, now, user_id)


async def hidden_issue(session: AsyncSession, settings: Settings, target_hmac: str, purpose: str,
                       now: datetime) -> None:
    """Write a row exactly like `issue` but with a random code that is never returned or sent (X10, R-F6)."""
    _purpose(purpose)
    _pepper(settings)
    await _guard(session, settings, target_hmac, purpose, now)
    await _write(session, settings, target_hmac, purpose, now, None)


async def verify(session: AsyncSession, sessions: async_sessionmaker, settings: Settings, target_hmac: str,
                 purpose: str, code: str, now: datetime) -> VerificationCode:
    """Check `code` for `(target, purpose)`. On success the row is marked consumed in `session` (NOT committed: the
    caller commits it together with whatever the code unlocks). Failures raise `VerificationError("invalid")`; a
    wrong guess has already been counted and committed in its own transaction (R-F3)."""
    _purpose(purpose)
    expected = code_hmac(_pepper(settings), purpose, target_hmac, code.strip() if isinstance(code, str) else "")
    row = (await session.execute(
        select(VerificationCode).where(
            VerificationCode.channel == CHANNEL, VerificationCode.target_hmac == target_hmac,
            VerificationCode.purpose == purpose, VerificationCode.consumed_at.is_(None))
        .order_by(VerificationCode.id.desc()).limit(1))).scalar_one_or_none()
    if row is None:
        hmac.compare_digest(expected, expected)  # keep the no-code path from being noticeably cheaper
        raise VerificationError("invalid")
    async with sessions() as own:  # an attempt is claimed atomically before the comparison
        claim = await own.execute(
            update(VerificationCode).where(
                VerificationCode.id == row.id, VerificationCode.consumed_at.is_(None),
                VerificationCode.attempts < MAX_ATTEMPTS, VerificationCode.expires_at > now)
            .values(attempts=VerificationCode.attempts + 1).execution_options(synchronize_session=False))
        await own.commit()
    if claim.rowcount != 1 or not hmac.compare_digest(row.code_hmac, expected):
        raise VerificationError("invalid")
    async with sessions() as own:  # a correct code is not a failed attempt: give the claim back
        await own.execute(
            update(VerificationCode).where(VerificationCode.id == row.id, VerificationCode.attempts > 0)
            .values(attempts=VerificationCode.attempts - 1).execution_options(synchronize_session=False))
        await own.commit()
    consumed = await session.execute(
        update(VerificationCode).where(VerificationCode.id == row.id, VerificationCode.consumed_at.is_(None))
        .values(consumed_at=now).execution_options(synchronize_session=False))
    if consumed.rowcount != 1:
        raise VerificationError("invalid")
    await session.refresh(row)
    return row
