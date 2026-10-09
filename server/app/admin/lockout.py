"""登录锁定(spec §4.4):按 (用户名, IP) 锁,指数翻倍封顶 24 小时;按用户名的全局计数(ip="*")只告警不锁,
避免攻击者把应急账号锁死。不存在的用户名同样计数。"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models import AdminLoginState

MAX_LOCK = timedelta(hours=24)
GLOBAL_FACTOR = 4
GLOBAL_IP = "*"


def _u(v: datetime | None) -> datetime | None:
    return v if v is None or v.tzinfo else v.replace(tzinfo=timezone.utc)


def _name(username: str) -> str:
    return username.strip().lower()[:64]


async def _find(session, username: str, ip: str) -> AdminLoginState | None:
    return await session.scalar(
        select(AdminLoginState).where(AdminLoginState.username == _name(username), AdminLoginState.ip == ip[:64]))


async def _row(session, username: str, ip: str) -> AdminLoginState:
    row = await _find(session, username, ip)
    if row is None:
        row = AdminLoginState(username=_name(username), ip=ip[:64], failures=0, lock_level=0)
        session.add(row)
    return row


async def check(session, username: str, ip: str, now: datetime) -> datetime | None:
    """When the (username, ip) pair is locked: until when; else None."""
    row = await _find(session, username, ip)
    until = _u(row.locked_until) if row is not None else None
    return until if until and until > now else None


async def fail(session, username: str, ip: str, now: datetime, *, threshold: int, minutes: int) -> datetime | None:
    """Count one failure; returns the new lock end when this failure triggered a lock."""
    row = await _row(session, username, ip)
    row.failures += 1
    row.updated_at = now
    glob = await _row(session, username, GLOBAL_IP)
    glob.failures += 1
    glob.updated_at = now
    if row.failures >= threshold:
        duration = min(timedelta(minutes=minutes) * (2 ** row.lock_level), MAX_LOCK)
        row.locked_until, row.lock_level, row.failures = now + duration, row.lock_level + 1, 0
        return row.locked_until
    return None


async def global_failures(session, username: str) -> int:
    row = await _find(session, username, GLOBAL_IP)
    return row.failures if row is not None else 0


def global_alarm(glob_failures: int, threshold: int) -> bool:
    """True once per `threshold * GLOBAL_FACTOR` failures from any IP (audit `auth.login.alarm`)."""
    step = threshold * GLOBAL_FACTOR
    return glob_failures > 0 and glob_failures % step == 0


async def succeed(session, username: str, ip: str) -> None:
    row = await _find(session, username, ip)
    if row is not None:
        row.failures, row.lock_level, row.locked_until = 0, 0, None
