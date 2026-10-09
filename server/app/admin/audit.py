"""只追加的管理审计(spec §4.7)。哈希链:hash = sha256(prev_hash + canonical(row))。
永不写入密码、token、密钥明文、用户内容、提示词正文;密钥用 redact_setting 只留指纹。"""
import asyncio
import hashlib
import json
import re
import weakref
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select, update

from app.core.settings_registry import SPECS
from app.core.db import insert_ignore
from app.models import AdminAudit, AuditHead

GENESIS = "0" * 64
HEAD_ID = 1
# One lock per event loop: only saves DB lock waits within a process; `audit_head` is the real serialisation.
_LOCKS: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock]" = weakref.WeakKeyDictionary()


def _lock() -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    lock = _LOCKS.get(loop)
    if lock is None:
        lock = _LOCKS[loop] = asyncio.Lock()
    return lock


def _iso(value: datetime) -> str:
    """Canonical UTC timestamp: SQLite reads back naive UTC, Postgres may return another offset."""
    value = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    return value.isoformat()


@dataclass(frozen=True)
class Actor:
    name: str
    role: str
    session_id: str | None
    ip: str


CLI_ACTOR = Actor("cli", "superadmin", None, "local")


def redact_setting(key: str, value: object, fp: str) -> object:
    spec = SPECS.get(key)
    if spec is not None and spec.secret:
        return {"set": bool(value), "fp": fp}
    return value


def _canonical(prev_hash: str, row: AdminAudit) -> str:
    body = {
        "at": _iso(row.at), "actor": row.actor, "role": row.role, "session_id": row.session_id, "ip": row.ip,
        "action": row.action, "target_type": row.target_type, "target_id": row.target_id, "summary": row.summary,
        "before": row.before, "after": row.after, "reason": row.reason, "result": row.result,
    }
    return prev_hash + json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def row_hash(prev_hash: str, row: AdminAudit) -> str:
    return hashlib.sha256(_canonical(prev_hash, row).encode()).hexdigest()


async def _lock_head(session) -> str:
    """Take the chain's write lock (held until the caller commits) and return the newest hash.

    `UPDATE audit_head SET hash = hash` takes SQLite's RESERVED lock / the Postgres row lock before anything is read,
    so a concurrent writer (same or another process) waits for our commit and then chains after our row. The head row
    is created on first use from the newest existing audit row."""
    locked = await session.execute(update(AuditHead).where(AuditHead.id == HEAD_ID).values(hash=AuditHead.hash))
    if not locked.rowcount:
        last = await session.scalar(select(AdminAudit.hash).order_by(AdminAudit.id.desc()).limit(1))
        await session.execute(insert_ignore(session, AuditHead.__table__).values(id=HEAD_ID, hash=last or GENESIS))
        await session.execute(update(AuditHead).where(AuditHead.id == HEAD_ID).values(hash=AuditHead.hash))
    return await session.scalar(select(AuditHead.hash).where(AuditHead.id == HEAD_ID))


async def record(session, actor: Actor, action: str, *, target_type=None, target_id=None, summary: str = "",
                 before=None, after=None, reason=None, result: str = "ok") -> AdminAudit:
    """Append one row. The chain stays linear across requests and workers: the head lock taken here is released
    only when the caller's transaction commits or rolls back (so commit promptly after recording)."""
    async with _lock():
        prev = await _lock_head(session)
        row = AdminAudit(
            at=datetime.now(timezone.utc).replace(microsecond=0), actor=actor.name[:64], role=actor.role,
            session_id=actor.session_id, ip=actor.ip[:64], action=action[:48], target_type=target_type,
            target_id=None if target_id is None else str(target_id)[:64], summary=summary[:200],
            before=before, after=after, reason=None if reason is None else reason[:200], result=result,
            prev_hash=prev,
        )
        row.hash = row_hash(row.prev_hash, row)
        session.add(row)
        await session.flush()
        await session.execute(update(AuditHead).where(AuditHead.id == HEAD_ID).values(hash=row.hash))
        return row


async def _anchored(session, first: AdminAudit) -> bool:
    """The oldest remaining row may follow deleted rows only when an `audit.purge` row names it as its anchor
    (review m7): deleting the oldest rows straight in the database no longer verifies."""
    if first.prev_hash == GENESIS:
        return True
    purges = (await session.scalars(select(AdminAudit).where(AdminAudit.action == "audit.purge",
                                                           AdminAudit.id >= first.id))).all()
    for p in purges:
        anchor = (p.before or {}).get("anchor_id")
        if anchor == first.id or (anchor is None and p.id == first.id):
            return True
    return False


async def verify(session, *, start_id: int | None = None) -> tuple[bool, int | None]:
    query = select(AdminAudit).order_by(AdminAudit.id)
    if start_id is not None:
        query = query.where(AdminAudit.id >= start_id)
    prev: str | None = None
    for row in (await session.scalars(query)).all():
        if prev is None and start_id is None and not await _anchored(session, row):
            return False, row.id
        if prev is not None and row.prev_hash != prev:
            return False, row.id
        if row_hash(row.prev_hash, row) != row.hash:
            return False, row.id
        prev = row.hash
    return True, None


def audit_out(row: AdminAudit) -> dict:
    return {"id": row.id, "at": _iso(row.at), "actor": row.actor, "role": row.role, "ip": row.ip,
            "action": row.action, "target_type": row.target_type, "target_id": row.target_id,
            "summary": row.summary, "before": row.before, "after": row.after, "reason": row.reason,
            "result": row.result}


ACTION_PREFIX_RE = re.compile(r"^[a-z_.]{1,48}$")


async def listing(session, *, actor=None, action=None, target_type=None, target_id=None,
                  before_id=None, limit: int = 50, action_prefix: str | None = None) -> dict:
    """Newest first. `action_prefix` ("settings." / "auth.") matches with LIKE; only [a-z_.] is accepted, so it
    can carry no LIKE wildcards (ValueError otherwise)."""
    query = select(AdminAudit).order_by(AdminAudit.id.desc()).limit(limit + 1)
    if action_prefix is not None:
        if not ACTION_PREFIX_RE.fullmatch(action_prefix):
            raise ValueError("Invalid action prefix")
        query = query.where(AdminAudit.action.like(action_prefix.replace("_", r"\_") + "%", escape="\\"))
    for column, value in ((AdminAudit.actor, actor), (AdminAudit.action, action),
                          (AdminAudit.target_type, target_type), (AdminAudit.target_id, target_id)):
        if value is not None:
            query = query.where(column == value)
    if before_id is not None:
        query = query.where(AdminAudit.id < before_id)
    rows = list((await session.scalars(query)).all())
    more = len(rows) > limit
    rows = rows[:limit]
    return {"items": [audit_out(r) for r in rows], "next_before_id": rows[-1].id if more else None}
