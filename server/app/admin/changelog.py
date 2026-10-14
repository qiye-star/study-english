"""更新日志(spec 2026-10-14-changelog-design §2.1;计划 docs/superpowers/plans/2026-10-14-changelog.md)。

内容是公开的发布说明,不含用户数据;本模块没有任何日志调用,错误体与审计只带条目 id 与动作,不带标题或条目文字。
用户侧:`public_page`(已发布、按 entry_date 倒序、游标分页、带未读数与逐条 is_new)与 `mark_seen`(已读位置只前进)。
管理侧(任务 S3 追加在文件末尾):`validate`、`admin_listing`、`create`、`edit`、`publish`、`unpublish`、`remove`(软删除),
写操作在调用方的同一事务里写审计。
"""
import re
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import and_, func, or_, select, update

from app.admin import audit
from app.admin.audit import Actor
from app.core.db import insert_ignore
from app.models import ChangelogEntry, ChangelogRead, iso_utc

TAGS = ("new", "improve", "fix", "library", "other")
PAGE_SIZE = 20
FIRST_VISIT_UNREAD = 3  # a user without a read row sees at most this many entries as unread (spec D3)
CURSOR_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.(\d{1,9})$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")  # date.fromisoformat alone also takes 20261014 / 2026-W42-1
VERSION_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._+\-]*$")
MAX_ITEMS = 20
MAX_TEXT = 200
MAX_TITLE = 80
MAX_VERSION = 24
ITEM_KEYS = {"tag", "zh", "en"}


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

def _text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) else None


def validate(data: dict) -> dict:
    """Strict, key by key. Returns the column values; on failure raises ChangelogError(422, fields) whose keys and rules
    never contain the offending text (plan R-8)."""
    fields: dict[str, str] = {}
    entry_date = None
    raw_date = data.get("entry_date")
    if isinstance(raw_date, str) and DATE_RE.match(raw_date.strip()):
        try:
            entry_date = date.fromisoformat(raw_date.strip())
        except ValueError:
            pass
    if entry_date is None:
        fields["entry_date"] = "must be a date like 2026-10-14"

    version = data.get("version")
    if version is None or (isinstance(version, str) and not version.strip()):
        version = None
    elif isinstance(version, str) and len(version.strip()) <= MAX_VERSION and VERSION_RE.match(version.strip()):
        version = version.strip()
    else:
        fields["version"] = f"at most {MAX_VERSION} letters, digits or . _ + -"

    title_zh = _text(data.get("title_zh"))
    if not title_zh or len(title_zh) > MAX_TITLE:
        fields["title_zh"] = f"1–{MAX_TITLE} characters"
    raw_en = data.get("title_en")
    title_en = "" if raw_en is None else _text(raw_en)
    if title_en is None or len(title_en) > MAX_TITLE:
        fields["title_en"] = f"at most {MAX_TITLE} characters"

    clean: list[dict] = []
    items = data.get("items")
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_ITEMS:
        fields["items"] = f"1–{MAX_ITEMS} items"
    else:
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                fields[f"items.{i}"] = "must be an object"
                continue
            if set(item) - ITEM_KEYS:
                fields[f"items.{i}"] = "unknown key"  # the key itself is never echoed
            tag = item.get("tag")
            zh = _text(item.get("zh"))
            raw_item_en = item.get("en")
            en = "" if raw_item_en is None else _text(raw_item_en)
            if not isinstance(tag, str) or tag not in TAGS:
                fields[f"items.{i}.tag"] = "must be one of " + ", ".join(TAGS)
            if not zh or len(zh) > MAX_TEXT:
                fields[f"items.{i}.zh"] = f"1–{MAX_TEXT} characters"
            if en is None or len(en) > MAX_TEXT:
                fields[f"items.{i}.en"] = f"at most {MAX_TEXT} characters"
            clean.append({"tag": tag, "zh": zh, "en": en})
    if fields:
        raise ChangelogError(422, "Invalid changelog entry", fields)
    return {"entry_date": entry_date, "version": version, "title_zh": title_zh, "title_en": title_en, "items": clean}


def admin_out(row: ChangelogEntry) -> dict:
    return {"id": row.id, "status": "published" if row.published_at is not None else "draft",
            "entry_date": row.entry_date.isoformat(), "version": row.version, "title_zh": row.title_zh,
            "title_en": row.title_en, "items": row.items, "created_by": row.created_by,
            "created_at": iso_utc(row.created_at), "updated_at": iso_utc(row.updated_at),
            "published_at": iso_utc(row.published_at) if row.published_at is not None else None}


async def admin_listing(session) -> list[dict]:
    rows = (await session.scalars(select(ChangelogEntry).where(ChangelogEntry.archived_at.is_(None))
                                  .order_by(ChangelogEntry.entry_date.desc(), ChangelogEntry.id.desc()).limit(500))).all()
    return [admin_out(r) for r in rows]


async def _get(session, entry_id: int) -> ChangelogEntry:
    row = await session.get(ChangelogEntry, entry_id)
    if row is None or row.archived_at is not None:
        raise ChangelogError(404, "Not Found")
    return row


async def _record(session, actor: Actor, action: str, row: ChangelogEntry) -> None:
    # id and action only: no summary, before/after or reason (spec §3, plan R-10)
    await audit.record(session, actor, action, target_type="changelog", target_id=row.id)


async def create(session, actor: Actor, data: dict) -> ChangelogEntry:
    now = datetime.now(timezone.utc)
    row = ChangelogEntry(**validate(data), created_by=actor.name[:64], created_at=now, updated_at=now)
    session.add(row)
    await session.flush()
    await _record(session, actor, "changelog.create", row)
    return row


async def edit(session, actor: Actor, entry_id: int, data: dict) -> ChangelogEntry:
    row = await _get(session, entry_id)
    current = {"entry_date": row.entry_date.isoformat(), "version": row.version, "title_zh": row.title_zh,
               "title_en": row.title_en, "items": row.items}
    for key, value in validate({**current, **data}).items():
        setattr(row, key, value)
    row.updated_at = datetime.now(timezone.utc)
    await _record(session, actor, "changelog.update", row)
    return row


async def publish(session, actor: Actor, entry_id: int) -> ChangelogEntry:
    row = await _get(session, entry_id)
    if row.published_at is None:
        row.published_at = row.updated_at = datetime.now(timezone.utc)
        await _record(session, actor, "changelog.publish", row)
    return row


async def unpublish(session, actor: Actor, entry_id: int) -> ChangelogEntry:
    row = await _get(session, entry_id)
    if row.published_at is not None:
        row.published_at = None
        row.updated_at = datetime.now(timezone.utc)
        await _record(session, actor, "changelog.unpublish", row)
    return row


async def remove(session, actor: Actor, entry_id: int) -> ChangelogEntry:
    """Soft delete (`archived_at`): the import command never revives it (plan R-9, R-12)."""
    row = await _get(session, entry_id)
    row.archived_at = row.updated_at = datetime.now(timezone.utc)
    await _record(session, actor, "changelog.delete", row)
    return row
