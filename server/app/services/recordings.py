"""评测录音的存放键与配额统计(plan L1 Task 12:录音经 `app.state.storage` 存取,键 = recordings/<uid>/<id>.wav)。

`absolute_path` 只给仍然读本地文件的少数位置用(房间语音与管理端房间,Task 13 之后移除);新代码一律用 store。
"""

from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Assessment


def recording_relpath(user_id: int, assessment_id: str) -> str:
    return f"recordings/{user_id}/{assessment_id}.wav"


def absolute_path(data_dir: Path, relpath: str) -> Path:
    root = data_dir.resolve()
    path = (root / relpath).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Recording path escapes the data directory")
    return path


async def write_recording(blobs, relpath: str, data: bytes) -> None:
    """Store the WAV under its key. Raises ValueError for a bad key and StorageError when the store fails."""
    await blobs.put_bytes(relpath, data, content_type="audio/wav")


async def delete_recording(blobs, relpath: str) -> None:
    """Delete one recording; a missing or illegal key is fine, a store failure is logged by the caller's sweep. Never
    raises (called after commits)."""
    try:
        await blobs.delete(relpath)
    except (ValueError, OSError):
        pass


async def used_bytes(session: AsyncSession, user_id: int) -> int:
    total = await session.scalar(
        select(func.coalesce(func.sum(Assessment.audio_bytes), 0)).where(Assessment.user_id == user_id)
    )
    return int(total or 0)
