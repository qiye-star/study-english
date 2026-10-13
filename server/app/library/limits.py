"""跟读库的代码常量(spec §5.2 末段)、每日计数与新建条目的准入检查。

每日计数用现有的 `daily_usage`(不新增表):`library_imports`(每人每天新建条目次数,subject = 用户 id)与
`library_asr`(识别秒数,subject = 用户 id 与 `*`)。`reserve` 一次加 N(识别按秒预留),条件 UPDATE 保证并发也不超限。
"""
from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import insert_ignore
from app.core.quotas import effective
from app.library.errors import LibraryError
from app.models import DailyUsage, LibraryItem
from app.services import usage

MB = 1_048_576
CHUNK_BYTES = 8 * MB  # one upload chunk (spec §8)
CHUNK_SLACK = 64 * 1024  # multipart framing around one chunk
MAX_PARALLEL_UPLOADS = 2
UPLOAD_EXTENSIONS = ("mp4", "m4v", "mov", "webm", "mkv", "mp3", "m4a", "aac", "wav", "ogg", "opus", "flac")
AUDIO_EXTENSIONS = frozenset({"mp3", "m4a", "aac", "wav", "ogg", "opus", "flac"})  # the kind shown until the probe
SUBTITLE_MAX_BYTES = 2 * MB
SUBTITLE_MAX_CUES = 20_000
SEGMENT_TEXT_MAX = 600
TITLE_MAX = 200
RATE_BOUNDS = (50, 125)
AUTO_RETRIES = 2
BACKOFF_SECONDS = (30, 120)
FAILED_KEEP_DAYS = 7
UPLOAD_EXPIRE_HOURS = 24
TICKET_TTL_SECONDS = 30 * 60
TICKET_MAX = 1000
ASR_CHUNK_MIN_MS = 15_000
ASR_CHUNK_TARGET_MS = 25_000
ASR_CHUNK_MAX_MS = 50_000
ASR_HARD_CUT_MS = 40_000
ASR_CONCURRENCY = 2
ASR_CHUNK_RETRIES = 2
POLL_SECONDS = 2.0
SHUTDOWN_WAIT_SECONDS = 2.0
LIST_LIMIT = 50
ACTIVE = ("uploading", "queued", "processing")

SCOPE_IMPORTS = "library_imports"
SCOPE_ASR = "library_asr"
GLOBAL = "*"


def day_of(now: datetime) -> str:
    return usage.utc_day(now)


async def reserve(session: AsyncSession, scope: str, subject: str, day: str, amount: int, limit: int) -> bool:
    """Add `amount` to today's counter unless that would pass `limit` (commits). amount <= 0 always succeeds."""
    if amount <= 0:
        return True
    if amount > limit:
        return False
    match = (DailyUsage.scope == scope, DailyUsage.subject == subject, DailyUsage.day == day)
    for _ in range(2):
        result = await session.execute(update(DailyUsage).where(*match, DailyUsage.count + amount <= limit)
                                       .values(count=DailyUsage.count + amount))
        if result.rowcount:
            await session.commit()
            return True
        if await session.scalar(select(DailyUsage.id).where(*match)) is not None:
            break
        inserted = await session.execute(
            insert_ignore(session, DailyUsage).values(scope=scope, subject=subject, day=day, count=amount))
        if inserted.rowcount:
            await session.commit()
            return True
    await session.commit()
    return False


async def release(session: AsyncSession, scope: str, subject: str, day: str, amount: int) -> None:
    """Give back up to `amount` (never below zero; commits)."""
    if amount <= 0:
        return
    match = (DailyUsage.scope == scope, DailyUsage.subject == subject, DailyUsage.day == day)
    current = await session.scalar(select(DailyUsage.count).where(*match))
    if current:
        await session.execute(update(DailyUsage).where(*match).values(count=max(0, current - amount)))
    await session.commit()


async def used_bytes(session: AsyncSession, user_id: int) -> int:
    """Stored media + posters, plus the announced size of items still being uploaded or processed."""
    stored = await session.scalar(select(func.coalesce(func.sum(LibraryItem.library_bytes), 0))
                                  .where(LibraryItem.user_id == user_id))
    pending = await session.scalar(select(func.coalesce(func.sum(LibraryItem.upload_total), 0)).where(
        LibraryItem.user_id == user_id, LibraryItem.status.in_(ACTIVE), LibraryItem.library_bytes == 0))
    return int(stored or 0) + int(pending or 0)


async def item_count(session: AsyncSession, user_id: int) -> int:
    return int(await session.scalar(select(func.count()).select_from(LibraryItem).where(
        LibraryItem.user_id == user_id, LibraryItem.status != "canceled")) or 0)


async def uploads_in_progress(session: AsyncSession, user_id: int) -> int:
    return int(await session.scalar(select(func.count()).select_from(LibraryItem).where(
        LibraryItem.user_id == user_id, LibraryItem.status == "uploading")) or 0)


async def admit_new_item(session: AsyncSession, app, user_id: int, *, size_bytes: int = 0,
                         upload: bool = False) -> None:
    """A new item (upload or link) may be created, and today's import count was taken; else
    `LibraryError(code)` with code `unavailable` | `max_items` | `quota` | `uploads` | `daily`
    (`errors.http_error` turns it into the fixed HTTP error). The daily count is taken last, so a refused request
    never spends it; a caller that fails after this call gives it back with `refund_new_item`."""
    settings = app.state.settings
    if not settings.library_available:
        raise LibraryError("unavailable")
    if await item_count(session, user_id) >= await effective(session, app, user_id, "library_max_items"):
        raise LibraryError("max_items")
    quota = await effective(session, app, user_id, "library_quota_mb") * MB
    if await used_bytes(session, user_id) + max(0, size_bytes) > quota:
        raise LibraryError("quota")
    if upload and await uploads_in_progress(session, user_id) >= MAX_PARALLEL_UPLOADS:
        raise LibraryError("uploads")
    if not await usage.consume(session, SCOPE_IMPORTS, str(user_id), day_of(datetime.now(timezone.utc)),
                               settings.library_imports_daily_per_user):
        raise LibraryError("daily")


async def refund_new_item(session: AsyncSession, app, user_id: int) -> None:
    await usage.refund(session, SCOPE_IMPORTS, str(user_id), day_of(datetime.now(timezone.utc)))
