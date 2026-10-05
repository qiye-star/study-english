"""GET /api/stats:只读、按用户、限流;在 Python 里对有界的最近数据汇总(设计文档 §3.4,计划裁定 R15)。"""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import stats as rules
from app.deps import get_session, limited_user
from app.models import Assessment, Conversation, Message, User, utcnow

router = APIRouter(prefix="/api")


@router.get("/stats")
async def get_stats(
    days: int = Query(7),
    tz_offset_minutes: int = Query(0, ge=-720, le=840),
    user: User = Depends(limited_user),
    session: AsyncSession = Depends(get_session),
):
    if days not in rules.PERIODS:
        raise HTTPException(422, "Invalid days")
    now = utcnow()
    today = rules.local_date(now, tz_offset_minutes)
    scan_start = rules.local_midnight_utc(today - timedelta(days=rules.SCAN_DAYS - 1), tz_offset_minutes)
    window_start = rules.local_midnight_utc(rules.window(now, days, tz_offset_minutes)[0], tz_offset_minutes)
    # 常量经模块属性读取(测试可 monkeypatch)
    max_messages, max_assessments = rules.MAX_STATS_MESSAGES, rules.MAX_STATS_ASSESSMENTS

    message_rows = (
        await session.execute(
            select(Message.created_at, Message.grammar)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(Conversation.user_id == user.id, Message.role == "user", Message.created_at >= scan_start)
            .order_by(Message.created_at.desc())
            .limit(max_messages + 1)
        )
    ).all()
    assessment_rows = (
        await session.execute(
            select(Assessment.created_at, Assessment.duration_ms, Assessment.scores)
            .where(Assessment.user_id == user.id, Assessment.created_at >= scan_start)
            .order_by(Assessment.created_at.desc())
            .limit(max_assessments + 1)
        )
    ).all()
    poor_results = (
        await session.execute(
            select(Assessment.result)
            .where(Assessment.user_id == user.id, Assessment.created_at >= window_start)
            .order_by(Assessment.created_at.desc())
            .limit(rules.MAX_POOR_WORD_ASSESSMENTS)
        )
    ).scalars().all()
    truncated = len(message_rows) > max_messages or len(assessment_rows) > max_assessments
    return rules.aggregate(
        now=now,
        days=days,
        offset_minutes=tz_offset_minutes,
        messages=[rules.MessageRow(r.created_at, r.grammar) for r in message_rows[:max_messages]],
        assessments=[rules.AssessmentRow(r.created_at, r.duration_ms, r.scores) for r in assessment_rows[:max_assessments]],
        poor_results=poor_results,
        truncated=truncated,
    )
