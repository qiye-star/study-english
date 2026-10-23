"""管理端只读查询。不带 user_id 过滤:调用方必须已通过 perms.require("viewer")。"""

from datetime import date, datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.avatars import avatar_url
from app.models import (
    Assessment, Conversation, Message, PracticeItem, User, VocabularyItem, iso_utc,
)


def _iso(value: datetime | None) -> str | None:
    return iso_utc(value) if value is not None else None


def _later(*values: datetime | None) -> datetime | None:
    present = [v if v.tzinfo else v.replace(tzinfo=timezone.utc) for v in values if v is not None]
    return max(present) if present else None


async def _count(session: AsyncSession, stmt) -> int:
    return int(await session.scalar(stmt) or 0)


async def paginate(session: AsyncSession, stmt, page: int, per_page: int):
    """取 per_page+1 行判断是否还有下一页(与用户端列表一致)。返回 (rows, next_page)。"""
    rows = (await session.execute(stmt.offset((page - 1) * per_page).limit(per_page + 1))).all()
    return rows[:per_page], (page + 1 if len(rows) > per_page else None)


# ---------- 概览 ----------

async def overview(session: AsyncSession, days: int) -> dict:
    totals = {
        "users": await _count(session, select(func.count()).select_from(User)),
        "conversations": await _count(session, select(func.count()).select_from(Conversation)),
        "messages": await _count(session, select(func.count()).select_from(Message)),
        "assessments": await _count(session, select(func.count()).select_from(Assessment)),
        "vocabulary": await _count(session, select(func.count()).select_from(VocabularyItem)),
        "practice_items": await _count(session, select(func.count()).select_from(PracticeItem)),
        "recording_bytes": await _count(session, select(func.coalesce(func.sum(Assessment.audio_bytes), 0))),
    }
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days - 1)
    since = datetime(start.year, start.month, start.day, tzinfo=timezone.utc)
    buckets: dict[date, dict] = {}
    for i in range(days):
        day = start + timedelta(days=i)
        buckets[day] = {"date": day.isoformat(), "new_users": 0, "messages": 0, "assessments": 0}
    for key, column in (
        ("new_users", User.created_at),
        ("messages", Message.created_at),
        ("assessments", Assessment.created_at),
    ):
        for (created,) in (await session.execute(select(column).where(column >= since))).all():
            moment = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
            day = moment.astimezone(timezone.utc).date()
            if day in buckets:
                buckets[day][key] += 1
    return {"totals": totals, "daily": list(buckets.values())}


# ---------- 用户 ----------

def _user_stats_columns():
    conversations = select(func.count()).where(Conversation.user_id == User.id).correlate(User).scalar_subquery()
    assessments = select(func.count()).where(Assessment.user_id == User.id).correlate(User).scalar_subquery()
    recording_bytes = (
        select(func.coalesce(func.sum(Assessment.audio_bytes), 0))
        .where(Assessment.user_id == User.id).correlate(User).scalar_subquery()
    )
    last_conv = select(func.max(Conversation.updated_at)).where(Conversation.user_id == User.id).correlate(User).scalar_subquery()
    last_assess = select(func.max(Assessment.created_at)).where(Assessment.user_id == User.id).correlate(User).scalar_subquery()
    return conversations, assessments, recording_bytes, last_conv, last_assess


def _user_row(row) -> dict:
    user, conversations, assessments, recording_bytes, last_conv, last_assess = row
    return {
        "id": user.id,
        "username": user.username,
        "nickname": user.nickname,
        "created_at": iso_utc(user.created_at),
        "conversations": int(conversations or 0),
        "assessments": int(assessments or 0),
        "recording_bytes": int(recording_bytes or 0),
        "last_active_at": _iso(_later(last_conv, last_assess)),
        "disabled_at": _iso(user.disabled_at),
    }


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def list_users(
    session: AsyncSession, q: str, page: int, per_page: int, *,
    status: Literal["all", "active", "disabled"] = "all", sort: Literal["recent", "created", "storage"] = "recent",
    email: Literal["all", "bound", "unbound"] = "all",
) -> dict:
    columns = _user_stats_columns()
    _, _, recording_bytes, last_conv, last_assess = columns
    stmt = select(User, *columns)
    count_stmt = select(func.count()).select_from(User)
    conds = []
    q = q.strip()
    if q:
        like = f"%{_escape_like(q)}%"
        cond = or_(User.username.ilike(like, escape="\\"), User.nickname.ilike(like, escape="\\"))
        if q.isdigit() and len(q) <= 9:
            cond = or_(cond, User.id == int(q))
        conds.append(cond)
    if status == "active":
        conds.append(User.disabled_at.is_(None))
    elif status == "disabled":
        conds.append(User.disabled_at.is_not(None))
    if email == "bound":
        conds.append(User.email_verified_at.is_not(None))
    elif email == "unbound":
        conds.append(User.email_verified_at.is_(None))
    if conds:
        stmt, count_stmt = stmt.where(*conds), count_stmt.where(*conds)
    if sort == "storage":
        order = (recording_bytes.desc(), User.created_at.desc(), User.id.desc())
    elif sort == "created":
        order = (User.created_at.desc(), User.id.desc())
    else:  # most recently active first; users without any activity fall back to their sign-up time
        latest = case((last_conv.is_(None), last_assess), (last_assess.is_(None), last_conv),
                      (last_conv > last_assess, last_conv), else_=last_assess)
        order = (func.coalesce(latest, User.created_at).desc(), User.id.desc())
    rows, nxt = await paginate(session, stmt.order_by(*order), page, per_page)
    return {
        "users": [_user_row(r) for r in rows],
        "page": page,
        "next": nxt,
        "total": await _count(session, count_stmt),
    }


async def get_user(session: AsyncSession, user_id: int) -> dict | None:
    row = (await session.execute(select(User, *_user_stats_columns()).where(User.id == user_id))).first()
    if row is None:
        return None
    base = _user_row(row)
    messages = await _count(
        session,
        select(func.count()).select_from(Message).join(Conversation, Conversation.id == Message.conversation_id)
        .where(Conversation.user_id == user_id),
    )
    practice = await _count(session, select(func.count()).select_from(PracticeItem).where(PracticeItem.user_id == user_id))
    vocab = await _count(session, select(func.count()).select_from(VocabularyItem).where(VocabularyItem.user_id == user_id))
    return {
        "id": base["id"],
        "username": base["username"],
        "nickname": base["nickname"],
        "avatar_url": avatar_url(row[0].avatar_id),
        "created_at": base["created_at"],
        "grammar_prompt": row[0].grammar_prompt,
        "counts": {
            "conversations": base["conversations"],
            "messages": messages,
            "assessments": base["assessments"],
            "practice_items": practice,
            "vocabulary": vocab,
        },
        "recording_bytes": base["recording_bytes"],
        "last_active_at": base["last_active_at"],
        "disabled_at": base["disabled_at"],
    }


# ---------- 对话 ----------

async def list_conversations(session: AsyncSession, user_id: int, page: int, per_page: int) -> dict:
    count = select(func.count()).where(Message.conversation_id == Conversation.id).correlate(Conversation).scalar_subquery()
    stmt = (
        select(Conversation, count).where(Conversation.user_id == user_id)
        .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
    )
    rows, nxt = await paginate(session, stmt, page, per_page)
    return {
        "conversations": [
            {
                "id": c.id, "name": c.name,
                "created_at": iso_utc(c.created_at), "updated_at": iso_utc(c.updated_at),
                "message_count": int(n or 0),
            }
            for c, n in rows
        ],
        "page": page,
        "next": nxt,
    }


def _scores_brief(assessment: Assessment | None) -> dict | None:
    if assessment is None:
        return None
    return {"id": assessment.id, "scores": assessment.scores, "duration_ms": assessment.duration_ms}


async def conversation_messages(session: AsyncSession, conversation_id: str) -> dict | None:
    row = (
        await session.execute(
            select(Conversation, User.username).join(User, User.id == Conversation.user_id)
            .where(Conversation.id == conversation_id)
        )
    ).first()
    if row is None:
        return None
    conversation, username = row
    rows = (
        await session.execute(
            select(Message, Assessment)
            .outerjoin(Assessment, Assessment.id == Message.assessment_id)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.asc(), Message.id.asc())
        )
    ).all()
    return {
        "conversation": {
            "id": conversation.id, "name": conversation.name,
            "user_id": conversation.user_id, "username": username, "config": conversation.config,
            "created_at": iso_utc(conversation.created_at), "updated_at": iso_utc(conversation.updated_at),
        },
        "messages": [
            {
                "id": m.id, "role": m.role, "content": m.content, "created_at": iso_utc(m.created_at),
                "grammar": m.grammar,
                "assessment_id": a.id if a is not None else None,
                "assessment": _scores_brief(a),
            }
            for m, a in rows
        ],
    }


# ---------- 评测与录音 ----------

def _assessment_item(a: Assessment, username: str | None = None) -> dict:
    item = {
        "id": a.id, "reference_text": a.reference_text, "language": a.language,
        "duration_ms": a.duration_ms, "audio_bytes": a.audio_bytes, "source": a.source,
        "scores": a.scores, "created_at": iso_utc(a.created_at),
    }
    if username is not None:
        item["user_id"] = a.user_id
        item["username"] = username
    return item


async def list_assessments(
    session: AsyncSession, source: str, page: int, per_page: int, user_id: int | None = None
) -> dict:
    stmt = select(Assessment, User.username).join(User, User.id == Assessment.user_id)
    if user_id is not None:
        stmt = stmt.where(Assessment.user_id == user_id)
    if source != "all":
        stmt = stmt.where(Assessment.source == source)
    rows, nxt = await paginate(session, stmt.order_by(Assessment.created_at.desc(), Assessment.id.desc()), page, per_page)
    return {
        "assessments": [_assessment_item(a, None if user_id is not None else name) for a, name in rows],
        "page": page,
        "next": nxt,
    }


async def get_assessment_row(session: AsyncSession, assessment_id: str) -> tuple[Assessment, str] | None:
    row = (
        await session.execute(
            select(Assessment, User.username).join(User, User.id == Assessment.user_id)
            .where(Assessment.id == assessment_id)
        )
    ).first()
    return (row[0], row[1]) if row else None


def assessment_detail(a: Assessment, username: str) -> dict:
    return {**_assessment_item(a, username), "result": a.result}


# ---------- 练习清单、词汇本 ----------

async def list_practice_items(session: AsyncSession, user_id: int, page: int, per_page: int) -> dict:
    stmt = (
        select(PracticeItem).where(PracticeItem.user_id == user_id)
        .order_by(PracticeItem.created_at.desc(), PracticeItem.id.desc())
    )
    rows, nxt = await paginate(session, stmt, page, per_page)
    return {
        "items": [
            {"id": p.id, "text": p.text, "source": p.source, "created_at": iso_utc(p.created_at)}
            for (p,) in rows
        ],
        "page": page,
        "next": nxt,
    }


async def list_vocabulary(session: AsyncSession, user_id: int, page: int, per_page: int) -> dict:
    stmt = (
        select(VocabularyItem).where(VocabularyItem.user_id == user_id)
        .order_by(VocabularyItem.created_at.desc(), VocabularyItem.id.desc())
    )
    rows, nxt = await paginate(session, stmt, page, per_page)
    return {
        "items": [
            {
                "id": v.id, "word": v.word, "meaning": v.meaning, "example": v.example, "source": v.source,
                "box": v.box, "due_at": iso_utc(v.due_at), "reps": v.reps, "lapses": v.lapses,
                "last_reviewed_at": _iso(v.last_reviewed_at), "created_at": iso_utc(v.created_at),
            }
            for (v,) in rows
        ],
        "page": page,
        "next": nxt,
    }
