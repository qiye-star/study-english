"""Daily counters shared by rank and rooms (`daily_usage`). Survive restarts, unlike RateLimiter.
Increments are a single conditional UPDATE, so concurrent coroutines cannot exceed the limit. The first row of a
day is created with INSERT ... ON CONFLICT DO NOTHING: these helpers never roll back the caller's session (a
rollback would expire every ORM object the request already loaded)."""
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import insert_ignore
from app.models import DailyUsage
from app.services.stats import as_utc


def utc_day(now: datetime) -> str:
    return as_utc(now).date().isoformat()


def local_day(now: datetime, offset_minutes: int) -> str:
    return (as_utc(now) + timedelta(minutes=offset_minutes)).date().isoformat()


def _match(scope: str, subject: str, day: str):
    return (DailyUsage.scope == scope, DailyUsage.subject == subject, DailyUsage.day == day)


async def _count(session: AsyncSession, scope: str, subject: str, day: str) -> int:
    value = await session.scalar(select(DailyUsage.count).where(*_match(scope, subject, day)))
    return value or 0


async def consume(session: AsyncSession, scope: str, subject: str, day: str, limit: int) -> bool:
    if limit <= 0:
        return False
    for _ in range(2):
        result = await session.execute(
            update(DailyUsage).where(*_match(scope, subject, day), DailyUsage.count < limit)
            .values(count=DailyUsage.count + 1))
        if result.rowcount:
            await session.commit()
            return True
        if await _count(session, scope, subject, day) >= limit:
            break
        inserted = await session.execute(
            insert_ignore(session, DailyUsage).values(scope=scope, subject=subject, day=day, count=1))
        if inserted.rowcount:
            await session.commit()
            return True
        # another coroutine inserted the row first: retry the UPDATE
    await session.commit()
    return False


async def remaining(session: AsyncSession, scope: str, subject: str, day: str, limit: int) -> int:
    return max(0, limit - await _count(session, scope, subject, day))


async def refund(session: AsyncSession, scope: str, subject: str, day: str) -> None:
    await session.execute(
        update(DailyUsage).where(*_match(scope, subject, day), DailyUsage.count > 0)
        .values(count=DailyUsage.count - 1))
    await session.commit()
