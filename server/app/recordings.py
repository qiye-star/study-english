"""评测录音的落盘位置与配额统计(数据目录见 Settings.resolved_data_dir)。"""

import os
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


def write_recording(data_dir: Path, relpath: str, data: bytes) -> None:
    path = absolute_path(data_dir, relpath)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def delete_recording(data_dir: Path, relpath: str) -> None:
    try:
        absolute_path(data_dir, relpath).unlink(missing_ok=True)
    except (ValueError, OSError):
        pass


async def used_bytes(session: AsyncSession, user_id: int) -> int:
    total = await session.scalar(
        select(func.coalesce(func.sum(Assessment.audio_bytes), 0)).where(Assessment.user_id == user_id)
    )
    return int(total or 0)
