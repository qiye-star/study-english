"""Storage usage for the admin data page (rooms v2 spec §14): room voice audio (kept forever), staged WAVs and
practice recordings. Database numbers come from `room_voice` / `assessments`; only the staging size is a
directory scan (in a worker thread). Grouping by month happens in Python (SQLite and Postgres date functions
differ). Never returns file paths."""
import asyncio
import os
from pathlib import Path

from sqlalchemy import func, select

from app.models import Assessment, RoomVoice, User

TOP_USERS = 10
STAGING_DIR = "room_audio/_staging"


def _dir_bytes(root: Path) -> int:
    if not root.is_dir():
        return 0
    total = 0
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            try:
                total += (Path(dirpath) / name).stat().st_size
            except OSError:
                continue
    return total


async def storage_summary(session, data_dir: Path) -> dict:
    stored = RoomVoice.audio_path.is_not(None)
    months: dict[str, list[int]] = {}
    for created_at, size in (await session.execute(select(RoomVoice.created_at, RoomVoice.audio_bytes)
                                                   .where(stored))).all():
        month = created_at.strftime("%Y-%m")
        bucket = months.setdefault(month, [0, 0])
        bucket[0] += 1
        bucket[1] += int(size or 0)
    by_month = [{"month": m, "files": f, "bytes": b} for m, (f, b) in sorted(months.items())]
    rec_files, rec_bytes = (await session.execute(
        select(func.count(), func.coalesce(func.sum(Assessment.audio_bytes), 0)).select_from(Assessment))).one()
    total = func.coalesce(func.sum(RoomVoice.audio_bytes), 0).label("bytes")
    top = (await session.execute(
        select(RoomVoice.sender_id, User.username, total).outerjoin(User, User.id == RoomVoice.sender_id)
        .where(stored).group_by(RoomVoice.sender_id, User.username)
        .order_by(total.desc(), RoomVoice.sender_id).limit(TOP_USERS))).all()
    staging = await asyncio.to_thread(_dir_bytes, data_dir / STAGING_DIR)
    return {"room_audio": {"files": sum(f for f, _ in months.values()), "bytes": sum(b for _, b in months.values()),
                           "staging_bytes": staging, "by_month": by_month},
            "recordings": {"files": int(rec_files or 0), "bytes": int(rec_bytes or 0)},
            "top_voice_users": [{"user_id": uid, "username": name, "bytes": int(b or 0)} for uid, name, b in top]}
