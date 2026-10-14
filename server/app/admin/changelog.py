"""更新日志(spec 2026-10-14-changelog-design §2.1;计划 docs/superpowers/plans/2026-10-14-changelog.md)。

内容是公开的发布说明,不含用户数据;本模块没有任何日志调用,错误体与审计只带条目 id 与动作,不带标题或条目文字。
用户侧:`public_page`(已发布、按 entry_date 倒序、游标分页、带未读数与逐条 is_new)与 `mark_seen`(已读位置只前进)。
管理侧(任务 S3 追加在文件末尾):`validate`、`admin_listing`、`create`、`edit`、`publish`、`unpublish`、`remove`(软删除),
写操作在调用方的同一事务里写审计。
"""
import re
from datetime import date, datetime, timezone

from sqlalchemy import and_, func, or_, select, update

from app.core.db import insert_ignore
from app.models import ChangelogEntry, ChangelogRead, iso_utc

TAGS = ("new", "improve", "fix", "library", "other")
PAGE_SIZE = 20
FIRST_VISIT_UNREAD = 3  # a user without a read row sees at most this many entries as unread (spec D3)
CURSOR_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.(\d{1,9})$")


class ChangelogError(Exception):
    def __init__(self, status: int, message: str, fields: dict | None = None):
        super().__init__(message)
        self.status, self.message, self.fields = status, message, fields


def _live() -> tuple:
    """published and not deleted"""
    return (ChangelogEntry.published_at.is_not(None), ChangelogEntry.archived_at.is_(None))


def parse_cursor(cursor: str | None) -> tuple[date, int] | None:
    if not cursor:
        return None
    match = CURSOR_RE.match(cursor)
    if match is None:
        raise ChangelogError(422, "Invalid cursor")
    try:
        return date.fromisoformat(match.group(1)), int(match.group(2))
    except ValueError:
        raise ChangelogError(422, "Invalid cursor") from None


async def latest_id(session) -> int | None:
    return await session.scalar(select(func.max(ChangelogEntry.id)).where(*_live()))


async def _seen_id(session, user_id: int) -> int:
    """The user's read position: their row, or (first visit) the id of the 4th newest published entry, so at most
    FIRST_VISIT_UNREAD entries count as unread. A scalar select, never the identity map (a bulk UPDATE leaves
    loaded objects stale)."""
    stored = await session.scalar(select(ChangelogRead.last_seen_id).where(ChangelogRead.user_id == user_id))
    if stored is not None:
        return stored
    nth = await session.scalar(select(ChangelogEntry.id).where(*_live()).order_by(ChangelogEntry.id.desc())
                               .offset(FIRST_VISIT_UNREAD).limit(1))
    return nth or 0


async def _unread(session, seen: int) -> int:
    return await session.scalar(select(func.count()).select_from(ChangelogEntry).where(*_live(), ChangelogEntry.id > seen)) or 0


def public_out(row: ChangelogEntry, seen: int) -> dict:
    return {"id": row.id, "entry_date": row.entry_date.isoformat(), "version": row.version, "title_zh": row.title_zh,
            "title_en": row.title_en, "items": row.items, "published_at": iso_utc(row.published_at),
            "is_new": row.id > seen}


async def public_page(session, user_id: int, *, cursor: str | None, limit: int = PAGE_SIZE) -> dict:
    after = parse_cursor(cursor)
    seen = await _seen_id(session, user_id)
    query = select(ChangelogEntry).where(*_live()).order_by(ChangelogEntry.entry_date.desc(), ChangelogEntry.id.desc())
    if after is not None:
        day, last_id = after
        query = query.where(or_(ChangelogEntry.entry_date < day,
                                and_(ChangelogEntry.entry_date == day, ChangelogEntry.id < last_id)))
    rows = list((await session.scalars(query.limit(limit + 1))).all())
    page, more = rows[:limit], len(rows) > limit
    next_cursor = f"{page[-1].entry_date.isoformat()}.{page[-1].id}" if more and page else None
    return {"entries": [public_out(r, seen) for r in page], "next": next_cursor,
            "unread": await _unread(session, seen), "latest_id": await latest_id(session)}


async def mark_seen(session, user_id: int, upto_id: int) -> dict:
    """Advance the read position to `upto_id` (clamped to the newest published id; never backwards; idempotent)."""
    newest = await latest_id(session)
    if newest is None:
        return {"unread": 0, "last_seen_id": 0}
    target = max(await _seen_id(session, user_id), min(upto_id, newest))
    now = datetime.now(timezone.utc)
    await session.execute(insert_ignore(session, ChangelogRead.__table__).values(user_id=user_id, last_seen_id=0, updated_at=now))
    await session.execute(update(ChangelogRead).where(ChangelogRead.user_id == user_id, ChangelogRead.last_seen_id < target)
                          .values(last_seen_id=target, updated_at=now))
    await session.commit()
    seen = await _seen_id(session, user_id)
    return {"unread": await _unread(session, seen), "last_seen_id": seen}


# ---- admin (plan task S3 appends below) ----
