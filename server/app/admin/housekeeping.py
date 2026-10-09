"""数据清理(spec §12):孤儿录音(先扫后删,文件集变化需重扫)、审计清理(不早于保留期,写锚点)、
每日自动清理过期的管理会话/锁定行/语音 token。只删数据目录 `recordings/` 下的文件。"""
import asyncio
import hashlib
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import delete, func, or_, select

from app.admin import audit
from app.admin.audit import Actor
from app.admin.rank_ops import UNDO_DAYS
from app.models import AdminAudit, AdminLoginState, AdminSession, Assessment, RankProfileSnapshot, SpeechToken

MAX_SAMPLES = 20
# A recording is written to disk a moment before its row is committed: younger files are never orphans.
GRACE_SECONDS = 300


@dataclass(frozen=True)
class Scan:
    token: str
    count: int
    bytes: int
    samples: list[str]


def _walk(data_dir: Path, known: set[str], grace: float, now: float) -> list[tuple[str, int]]:
    root = data_dir / "recordings"
    if not root.is_dir():
        return []
    found = []
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            path = Path(dirpath) / name
            rel = path.relative_to(data_dir).as_posix()
            if rel in known:
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            if now - stat.st_mtime < grace:
                continue
            found.append((rel, stat.st_size))
    return sorted(found)


async def _orphans(session, settings, grace: float) -> list[tuple[str, int]]:
    known = set((await session.scalars(select(Assessment.audio_path))).all())
    return await asyncio.to_thread(_walk, settings.resolved_data_dir, known, grace, time.time())


def _token(paths: list[str]) -> str:
    return hashlib.sha256("\n".join(sorted(paths)).encode()).hexdigest()


async def scan_orphan_recordings(session, settings, *, grace: float = GRACE_SECONDS) -> Scan:
    found = await _orphans(session, settings, grace)
    return Scan(_token([p for p, _ in found]), len(found), sum(b for _, b in found), [p for p, _ in found[:MAX_SAMPLES]])


async def delete_orphan_recordings(session, settings, token: str, *, grace: float = GRACE_SECONDS) -> int:
    found = await _orphans(session, settings, grace)
    if _token([p for p, _ in found]) != token:
        raise ValueError("Rescan required")
    root = settings.resolved_data_dir.resolve()

    def remove() -> int:
        removed = 0
        for rel, _ in found:
            path = (root / rel).resolve()
            if not path.is_relative_to(root / "recordings"):
                continue
            try:
                path.unlink()
                removed += 1
            except FileNotFoundError:
                pass
        return removed

    return await asyncio.to_thread(remove)


async def audit_purgeable(session, older_than_days: int, now: datetime | None = None) -> int:
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=older_than_days)
    return int(await session.scalar(select(func.count()).select_from(AdminAudit).where(AdminAudit.at < cutoff)) or 0)


async def purge_audit(session, actor: Actor, older_than_days: int, *, retention_days: int,
                      now: datetime | None = None, reason: str | None = None) -> int:
    """Delete audit rows older than `older_than_days` (≥ retention) and record an `audit.purge` anchor:
    `before={"anchor_id": first kept id}` so `verify(start_id=anchor_id)` checks the remaining chain."""
    if older_than_days < retention_days:
        raise ValueError(f"older_than_days must be at least {retention_days}")
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=older_than_days)
    result = await session.execute(delete(AdminAudit).where(AdminAudit.at < cutoff))
    deleted = result.rowcount or 0
    anchor = await session.scalar(select(func.min(AdminAudit.id)))
    await audit.record(session, actor, "audit.purge", target_type="audit", summary=f"deleted {deleted} rows",
                       before={"anchor_id": anchor, "older_than_days": older_than_days}, reason=reason)
    return deleted


async def purge_expired(session, now: datetime) -> dict:
    sessions = await session.execute(delete(AdminSession).where(
        or_(AdminSession.expires_at < now - timedelta(days=7), AdminSession.revoked_at < now - timedelta(days=7))))
    login = await session.execute(delete(AdminLoginState).where(
        AdminLoginState.updated_at < now - timedelta(days=30),
        or_(AdminLoginState.locked_until.is_(None), AdminLoginState.locked_until < now)))
    tokens = await session.execute(delete(SpeechToken).where(SpeechToken.created_at < now - timedelta(days=1)))
    snapshots = await session.execute(delete(RankProfileSnapshot).where(  # spec §5.6: gone after the undo window
        RankProfileSnapshot.at < now - timedelta(days=UNDO_DAYS)))
    return {"admin_sessions": sessions.rowcount or 0, "admin_login_state": login.rowcount or 0,
            "speech_tokens": tokens.rowcount or 0, "rank_profile_snapshots": snapshots.rowcount or 0}
