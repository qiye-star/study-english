"""只追加的管理审计(spec §4.7)。哈希链:hash = sha256(prev_hash + canonical(row))。
永不写入密码、token、密钥明文、用户内容、提示词正文;密钥用 redact_setting 只留指纹。"""
import asyncio
import hashlib
import json
import weakref
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.settings_registry import SPECS
from app.models import AdminAudit

GENESIS = "0" * 64
# One lock per event loop (P-5: serialises the chain within a process; tests run each case on its own loop).
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


async def record(session, actor: Actor, action: str, *, target_type=None, target_id=None, summary: str = "",
                 before=None, after=None, reason=None, result: str = "ok") -> AdminAudit:
    async with _lock():
        last = await session.scalar(select(AdminAudit.hash).order_by(AdminAudit.id.desc()).limit(1))
        row = AdminAudit(
            at=datetime.now(timezone.utc).replace(microsecond=0), actor=actor.name[:64], role=actor.role,
            session_id=actor.session_id, ip=actor.ip[:64], action=action[:48], target_type=target_type,
            target_id=None if target_id is None else str(target_id)[:64], summary=summary[:200],
            before=before, after=after, reason=None if reason is None else reason[:200], result=result,
            prev_hash=last or GENESIS,
        )
        row.hash = row_hash(row.prev_hash, row)
        session.add(row)
        await session.flush()
        return row


async def verify(session, *, start_id: int | None = None) -> tuple[bool, int | None]:
    query = select(AdminAudit).order_by(AdminAudit.id)
    if start_id is not None:
        query = query.where(AdminAudit.id >= start_id)
    prev: str | None = None
    for row in (await session.scalars(query)).all():
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


async def listing(session, *, actor=None, action=None, target_type=None, target_id=None,
                  before_id=None, limit: int = 50) -> dict:
    query = select(AdminAudit).order_by(AdminAudit.id.desc()).limit(limit + 1)
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
