"""Chat-recording housekeeping shared by the conversations/speech routers and realtime calls:
drop assessment rows (unlinking messages), remove their files after the commit, and reclaim
orphaned source=chat recordings. Never logs paths or user text."""
import logging
from datetime import timedelta

from sqlalchemy import delete, exists, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import Assessment, Message, User, utcnow
from app.services import recordings

IN_CHUNK = 500  # stay well under SQLite's bound-variable limit
logger = logging.getLogger(__name__)


def _chunks(items: list[str]):
    for i in range(0, len(items), IN_CHUNK):
        yield items[i : i + IN_CHUNK]


async def drop_assessments(session: AsyncSession, rows: list[Assessment]) -> list[str]:
    """删除评测行并断开所有引用(SQLite 默认不执行 ON DELETE SET NULL);返回待删的录音相对路径。"""
    for chunk in _chunks([row.id for row in rows]):
        await session.execute(update(Message).where(Message.assessment_id.in_(chunk)).values(assessment_id=None))
        await session.execute(delete(Assessment).where(Assessment.id.in_(chunk)))
    return [row.audio_path for row in rows]


async def remove_files(blobs, relpaths: list[str]) -> None:
    # 先提交数据库、再删文件;删除失败被 delete_recording 吞掉:行已删除,配额已释放,残留文件只占磁盘
    for relpath in relpaths:
        try:
            await recordings.delete_recording(blobs, relpath)
        except Exception:  # never raise after the commit
            logger.warning("Could not remove a chat recording file")


async def cleanup_orphan_chat_recordings(session: AsyncSession, blobs, settings: Settings, user: User) -> None:
    """Delete the caller's source=chat assessments that no message references and that are older than the grace
    window (a tab died / a late link failed). Rows first, files after the commit. Never raises."""
    try:
        cutoff = utcnow() - timedelta(hours=settings.chat_orphan_grace_hours)
        rows = (
            await session.execute(
                select(Assessment).where(
                    Assessment.user_id == user.id,
                    Assessment.source == "chat",
                    Assessment.created_at < cutoff,
                    ~exists().where(Message.assessment_id == Assessment.id),
                )
            )
        ).scalars().all()
        if not rows:
            return
        paths = await drop_assessments(session, list(rows))
        await session.commit()
    except Exception:
        logger.warning("Orphan chat recording cleanup failed")
        try:
            await session.rollback()
            await session.refresh(user)  # rollback expires the loaded user
        except Exception:
            pass
        return
    await remove_files(blobs, paths)
