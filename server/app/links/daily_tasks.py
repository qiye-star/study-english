"""今日任务聚合卡(spec §6.2)的服务端计数:只返回数字,按用户本地日。

没有处理器、不写表;背单词与段位的行由网页提供方直接读各自的接口(`/api/wordbook/today`、`/api/rank/me`)。
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_session
from app.links.gate import require_link
from app.links.spec import LinkSpec
from app.models import Assessment, Conversation, Message, User, utcnow
from app.services.stats import local_date, local_midnight_utc

router = APIRouter()


@router.get("/today")
async def today(offset: int = Query(0, ge=-720, le=840), user: User = Depends(require_link("daily_tasks")),
                session: AsyncSession = Depends(get_session)):
    start = local_midnight_utc(local_date(utcnow(), offset), offset)
    practice = await session.scalar(select(func.count()).select_from(Assessment).where(
        Assessment.user_id == user.id, Assessment.source == "practice", Assessment.created_at >= start))
    mine = (select(Message.conversation_id).join(Conversation, Conversation.id == Message.conversation_id)
            .where(Conversation.user_id == user.id, Message.role == "user", Message.created_at >= start).subquery())
    messages = await session.scalar(select(func.count()).select_from(mine))
    conversations = await session.scalar(select(func.count(func.distinct(mine.c.conversation_id))))
    return {"practice_today": int(practice or 0), "chat_messages_today": int(messages or 0),
            "conversations_today": int(conversations or 0)}


SPEC = LinkSpec("daily_tasks", "今日任务聚合卡", "Daily tasks", router=router)
