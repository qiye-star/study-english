"""数据清理(spec §12):孤儿录音(先扫后删,文件集变化需重扫)、审计清理(不早于保留期,写锚点)、
每日自动清理过期的管理会话/锁定行/语音 token。孤儿录音只删 `recordings/` 下的文件;房间语音(rooms v2 §12,
永久保存,只能经此手动工具清理)只删 `room_audio/` 下的文件,从不自动运行。"""
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
from app.models import AdminAudit, AdminLoginState, AdminSession, Assessment, Room, RoomVoice, SpeechToken
from app.rooms.rules import RoomLimits

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


# ---- room voice audio (rooms v2 spec §12): kept forever; this manual, guarded tool is the only deletion path ----

ROOM_AUDIO = "room_audio"
STAGING_KEEP_DAYS = RoomLimits.staging_keep_days


@dataclass(frozen=True)
class RoomAudioScan(Scan):
    rooms: int = 0


@dataclass(frozen=True)
class _Target:
    rel: str
    size: int
    kind: str  # "audio" (row of an ended room) | "staging" (stale staged WAV of a row) | "orphan" (no row)
    message_id: str | None = None
    room_id: str | None = None


def _in_room_audio(rel: str | None) -> bool:
    return bool(rel) and rel.replace("\\", "/").startswith(ROOM_AUDIO + "/") and ".." not in rel.split("/")


def _room_audio_files(data_dir: Path, known: set[str], rows: list[tuple[str, str, str | None, str | None]],
                      grace: float, now: float) -> list[_Target]:
    """Stats the row targets ((kind, rel, message_id, room_id); a missing file counts 0 bytes) and walks
    `room_audio/` for files no row references (older than `grace` seconds: a file is written before its row)."""
    out = []
    for kind, rel, message_id, room_id in rows:
        try:
            size = (data_dir / rel).stat().st_size
        except OSError:
            size = 0
        out.append(_Target(rel, size, kind, message_id, room_id))
    root = data_dir / ROOM_AUDIO
    if root.is_dir():
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
                out.append(_Target(rel, stat.st_size, "orphan"))
    return sorted(out, key=lambda t: t.rel)


async def _room_audio_targets(session, settings, older_than_days: int, now: datetime, grace: float) -> list[_Target]:
    cutoff = now - timedelta(days=older_than_days)
    staging_cutoff = now - timedelta(days=STAGING_KEEP_DAYS)
    ended = (Room.status == "closed") & Room.closed_at.is_not(None)
    audio = (await session.execute(
        select(RoomVoice.message_id, RoomVoice.room_id, RoomVoice.audio_path).join(Room, Room.id == RoomVoice.room_id)
        .where(ended, Room.closed_at < cutoff, RoomVoice.audio_path.is_not(None)))).all()
    staging = (await session.execute(
        select(RoomVoice.message_id, RoomVoice.room_id, RoomVoice.staging_path).join(Room, Room.id == RoomVoice.room_id)
        .where(ended, Room.closed_at < staging_cutoff, RoomVoice.staging_path.is_not(None)))).all()
    known = set()
    for a, b in (await session.execute(select(RoomVoice.audio_path, RoomVoice.staging_path))).all():
        known.update(p for p in (a, b) if p)
    rows = [("audio", p, mid, rid) for mid, rid, p in audio if _in_room_audio(p)]
    rows += [("staging", p, mid, rid) for mid, rid, p in staging if _in_room_audio(p)]
    return await asyncio.to_thread(_room_audio_files, settings.resolved_data_dir, known, rows, grace, time.time())


async def scan_room_audio(session, settings, older_than_days: int, now: datetime, *,
                          grace: float = GRACE_SECONDS) -> RoomAudioScan:
    """Dry run: audio of rooms ended more than N days ago, orphan files under `room_audio/` and staged WAVs of
    rooms ended more than 7 days ago. Deletes nothing."""
    found = await _room_audio_targets(session, settings, older_than_days, now, grace)
    rooms = {t.room_id for t in found if t.kind == "audio"}
    return RoomAudioScan(_token([t.rel for t in found]), len(found), sum(t.size for t in found),
                         [t.rel for t in found[:MAX_SAMPLES]], rooms=len(rooms))


async def purge_room_audio_detail(session, settings, older_than_days: int, token: str, now: datetime, *,
                                  grace: float = GRACE_SECONDS, confirm: str | None = None) -> tuple[int, int]:
    """Rescans, requires the scan's token (`ValueError("Rescan required")`) and, when given, the typed phrase
    `DELETE {count} FILES` (`ValueError("Confirmation required")`); deletes only files under `room_audio/`,
    then sets `audio_path=NULL, purged_at=now` (transcripts and translations are kept) or clears the staging
    path. Returns (files, bytes). The caller audits and commits."""
    found = await _room_audio_targets(session, settings, older_than_days, now, grace)
    if _token([t.rel for t in found]) != token:
        raise ValueError("Rescan required")
    if confirm is not None and confirm != confirm_phrase(len(found)):
        raise ValueError("Confirmation required")
    root = settings.resolved_data_dir.resolve()

    def remove() -> None:
        for t in found:
            path = (root / t.rel).resolve()
            if not path.is_relative_to(root / ROOM_AUDIO):
                continue
            try:
                path.unlink()
            except FileNotFoundError:
                pass

    await asyncio.to_thread(remove)
    for t in found:
        if t.message_id is None:
            continue
        voice = await session.get(RoomVoice, t.message_id)
        if voice is None:
            continue
        if t.kind == "audio":
            voice.audio_path, voice.purged_at = None, now
        else:
            voice.staging_path = None
    await session.flush()
    return len(found), sum(t.size for t in found)


async def purge_room_audio(session, settings, older_than_days: int, token: str, now: datetime, *,
                           grace: float = GRACE_SECONDS, confirm: str | None = None) -> int:
    return (await purge_room_audio_detail(session, settings, older_than_days, token, now, grace=grace,
                                          confirm=confirm))[0]


def confirm_phrase(count: int) -> str:
    return f"DELETE {count} FILES"


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
    return {"admin_sessions": sessions.rowcount or 0, "admin_login_state": login.rowcount or 0,
            "speech_tokens": tokens.rowcount or 0}
