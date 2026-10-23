"""Storage usage for the admin data page (rooms v2 spec §14): room voice audio (kept forever), staged WAVs and
practice recordings. Database numbers come from `room_voice` / `assessments`; the staging size is one listing of the
object store (plan L1 Task 15). Grouping by month happens in Python (SQLite and Postgres date functions differ).
Never returns object keys or paths; the backend block carries names only (never an endpoint or a bucket)."""
from sqlalchemy import func, select

from app.models import Assessment, RoomVoice, User

TOP_USERS = 10
STAGING_PREFIX = "room_audio/_staging/"


def backend_info(blobs) -> dict:
    """`backend` is the primary store's name; with a read fallback the fallback's name and its hit count are shown."""
    primary = getattr(blobs, "primary", None)
    if primary is None:  # a single store
        return {"backend": blobs.name, "fallback": "", "fallback_hits": 0}
    return {"backend": primary.name, "fallback": blobs.secondary.name, "fallback_hits": blobs.hits}


async def _staging_bytes(blobs) -> int:
    return sum([info.size async for info in blobs.list(STAGING_PREFIX)])


async def storage_summary(session, blobs) -> dict:
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
    staging = await _staging_bytes(blobs)
    return {"room_audio": {"files": sum(f for f, _ in months.values()), "bytes": sum(b for _, b in months.values()),
                           "staging_bytes": staging, "by_month": by_month},
            "recordings": {"files": int(rec_files or 0), "bytes": int(rec_bytes or 0)},
            "top_voice_users": [{"user_id": uid, "username": name, "bytes": int(b or 0)} for uid, name, b in top],
            **backend_info(blobs)}
