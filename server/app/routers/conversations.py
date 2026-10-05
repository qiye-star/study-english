import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import and_, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import recordings
from app.config import Settings
from app.deps import current_user, get_session, get_settings
from app.grammar import normalize_grammar
from app.models import Assessment, Conversation, Message, User, iso_utc, utcnow

router = APIRouter(prefix="/api")

DEFAULT_NAME = "New conversation"
MAX_CONFIG_BYTES = 16 * 1024
MAX_SUMMARY_WORDS = 300
RESULT_ROLE_ERROR = "Only user messages can carry assessment or grammar"
IN_CHUNK = 500  # stay well under SQLite's bound-variable limit
logger = logging.getLogger(__name__)
ItemId = Annotated[str, Path(max_length=64)]


def _clean_name(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        raise ValueError("must not be blank")
    return value


class ConversationIn(BaseModel):
    name: str = Field(default=DEFAULT_NAME, max_length=100)
    config: dict = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return _clean_name(value)


class ConversationPatch(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    config: dict | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        return _clean_name(value)


class MessageIn(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str = Field(min_length=1, max_length=20000)
    assessment_id: str | None = Field(default=None, max_length=64)
    grammar: dict | None = None


class MessagePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assessment_id: str | None = Field(default=None, max_length=64)
    grammar: dict | None = None


class MessagesIn(BaseModel):
    messages: list[MessageIn] = Field(min_length=1, max_length=10)


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _check_config(config: dict) -> None:
    if len(json.dumps(config, ensure_ascii=False).encode("utf-8")) > MAX_CONFIG_BYTES:
        raise HTTPException(400, "Config is too large")


def conversation_out(row: Conversation) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "config": row.config,
        "created_at": iso_utc(row.created_at),
        "updated_at": iso_utc(row.updated_at),
    }


def assessment_summary(row: Assessment | None) -> dict | None:
    """只读摘要(计划裁定 R9):总分 + 逐词的分数与错误类型,足够渲染徽标与"读得差的词"。"""
    if row is None:
        return None
    detail = row.result.get("detail_result") if isinstance(row.result, dict) else None
    words = detail.get("words") if isinstance(detail, dict) else None
    brief: list[dict] = []
    for word in words if isinstance(words, list) else []:
        if not isinstance(word, dict):
            continue
        pa = word.get("pronunciation_assessment")
        pa = pa if isinstance(pa, dict) else {}
        brief.append({"word": word.get("word"), "accuracy_score": pa.get("accuracy_score"), "error_type": pa.get("error_type")})
        if len(brief) == MAX_SUMMARY_WORDS:
            break
    return {"id": row.id, "scores": row.scores, "words": brief}


def message_out(row: Message, assessment: Assessment | None = None) -> dict:
    return {
        "id": row.id,
        "conversation_id": row.conversation_id,
        "role": row.role,
        "content": row.content,
        "created_at": iso_utc(row.created_at),
        "assessment_id": row.assessment_id,
        "grammar": row.grammar,
        "assessment": assessment_summary(assessment),
    }


def checked_grammar(raw: dict, content: str) -> dict:
    try:
        return normalize_grammar(raw, content)
    except ValueError:
        raise HTTPException(422, "Invalid grammar result")


def _chunks(items: list[str]):
    for i in range(0, len(items), IN_CHUNK):
        yield items[i : i + IN_CHUNK]


async def owned_assessments(session: AsyncSession, user: User, ids: set[str]) -> dict[str, Assessment]:
    found: dict[str, Assessment] = {}
    for chunk in _chunks(sorted(ids)):
        rows = (
            await session.execute(select(Assessment).where(Assessment.id.in_(chunk), Assessment.user_id == user.id))
        ).scalars().all()
        found.update({row.id: row for row in rows})
    if set(found) != ids:
        raise HTTPException(404, "Assessment not found")
    return found


async def owned_message(session: AsyncSession, user: User, message_id: str) -> Message:
    row = (
        await session.execute(
            select(Message)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(Message.id == message_id, Conversation.user_id == user.id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Message not found")
    return row


async def chat_assessments(session: AsyncSession, user: User, ids: list[str]) -> list[Assessment]:
    out: list[Assessment] = []
    for chunk in _chunks(sorted({i for i in ids if i})):
        out.extend((
            await session.execute(
                select(Assessment).where(Assessment.id.in_(chunk), Assessment.user_id == user.id, Assessment.source == "chat")
            )
        ).scalars().all())
    return out


async def drop_assessments(session: AsyncSession, rows: list[Assessment]) -> list[str]:
    """删除评测行并断开所有引用(SQLite 默认不执行 ON DELETE SET NULL);返回待删的录音相对路径。"""
    for chunk in _chunks([row.id for row in rows]):
        await session.execute(update(Message).where(Message.assessment_id.in_(chunk)).values(assessment_id=None))
        await session.execute(delete(Assessment).where(Assessment.id.in_(chunk)))
    return [row.audio_path for row in rows]


def remove_files(settings: Settings, relpaths: list[str]) -> None:
    # 先提交数据库、再删文件;删除失败被 delete_recording 吞掉:行已删除,配额已释放,残留文件只占磁盘
    for relpath in relpaths:
        try:
            recordings.delete_recording(settings.resolved_data_dir, relpath)
        except Exception:  # never raise after the commit
            logger.warning("Could not remove a chat recording file")


async def owned_conversation(session: AsyncSession, user: User, conversation_id: str) -> Conversation:
    row = (
        await session.execute(
            select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user.id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Conversation not found")
    return row


@router.get("/conversations")
async def list_conversations(
    page: int = Query(1, ge=1, le=10_000),
    per_page: int = Query(20, ge=1, le=50),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    rows = (
        await session.execute(
            select(Conversation)
            .where(Conversation.user_id == user.id)
            .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page + 1)
        )
    ).scalars().all()
    return {
        "conversations": [conversation_out(r) for r in rows[:per_page]],
        "page": page,
        "next": page + 1 if len(rows) > per_page else None,
    }


@router.post("/conversations")
async def create_conversation(
    payload: ConversationIn,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    _check_config(payload.config)
    count = await session.scalar(
        select(func.count()).select_from(Conversation).where(Conversation.user_id == user.id)
    )
    if count >= settings.max_conversations:
        raise HTTPException(429, "Conversation limit reached")
    now = utcnow()
    row = Conversation(
        id=str(uuid.uuid4()), user_id=user.id, name=payload.name, config=payload.config,
        created_at=now, updated_at=now,
    )
    session.add(row)
    await session.commit()
    return conversation_out(row)


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    return conversation_out(await owned_conversation(session, user, conversation_id))


@router.patch("/conversations/{conversation_id}")
async def update_conversation(
    payload: ConversationPatch,
    conversation_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = await owned_conversation(session, user, conversation_id)
    if payload.config is not None:
        _check_config(payload.config)
        row.config = payload.config
    if payload.name is not None:
        row.name = payload.name
    row.updated_at = utcnow()
    await session.commit()
    return conversation_out(row)


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    row = await owned_conversation(session, user, conversation_id)
    linked = (
        await session.execute(
            select(Message.assessment_id).where(Message.conversation_id == row.id, Message.assessment_id.is_not(None))
        )
    ).scalars().all()
    chat = await chat_assessments(session, user, list(linked))
    # SQLite 默认不开外键级联,显式删除消息
    await session.execute(delete(Message).where(Message.conversation_id == row.id))
    paths = await drop_assessments(session, chat)
    await session.delete(row)
    await session.commit()
    remove_files(settings, paths)
    return {"id": conversation_id}


@router.get("/conversations/{conversation_id}/messages")
async def list_messages(
    conversation_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = await owned_conversation(session, user, conversation_id)
    rows = (
        await session.execute(
            select(Message, Assessment)
            .outerjoin(Assessment, and_(Assessment.id == Message.assessment_id, Assessment.user_id == user.id))
            .where(Message.conversation_id == row.id)
            .order_by(Message.created_at.asc(), Message.id.asc())
        )
    ).all()
    return {"messages": [message_out(m, a) for m, a in rows]}


@router.post("/conversations/{conversation_id}/messages")
async def create_messages(
    payload: MessagesIn,
    conversation_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    conversation = await owned_conversation(session, user, conversation_id)
    existing = await session.scalar(
        select(func.count()).select_from(Message).where(Message.conversation_id == conversation.id)
    )
    if existing + len(payload.messages) > settings.max_messages_per_conversation:
        raise HTTPException(429, "Message limit reached")
    for m in payload.messages:
        if (m.assessment_id or m.grammar is not None) and m.role != "user":
            raise HTTPException(422, RESULT_ROLE_ERROR)
    linked = await owned_assessments(session, user, {m.assessment_id for m in payload.messages if m.assessment_id})
    grammars = [checked_grammar(m.grammar, m.content) if m.grammar is not None else None for m in payload.messages]
    last = await session.scalar(
        select(func.max(Message.created_at)).where(Message.conversation_id == conversation.id)
    )
    base = utcnow()
    if last is not None and _as_utc(last) >= base:
        base = _as_utc(last) + timedelta(microseconds=1)
    rows = [
        Message(
            id=str(uuid.uuid4()), conversation_id=conversation.id, role=m.role, content=m.content,
            assessment_id=m.assessment_id, grammar=grammars[i], created_at=base + timedelta(microseconds=i),
        )
        for i, m in enumerate(payload.messages)
    ]
    session.add_all(rows)
    conversation.updated_at = rows[-1].created_at
    await session.commit()
    return {"messages": [message_out(r, linked.get(r.assessment_id)) for r in rows]}


@router.patch("/messages/{message_id}")
async def update_message(
    payload: MessagePatch,
    message_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = await owned_message(session, user, message_id)
    if payload.assessment_id is None and payload.grammar is None:
        raise HTTPException(400, "Nothing to update")
    if row.role != "user":
        raise HTTPException(422, RESULT_ROLE_ERROR)
    assessment: Assessment | None = None
    if payload.assessment_id is not None:
        if row.assessment_id and row.assessment_id != payload.assessment_id:
            raise HTTPException(409, "Message already has an assessment")
        assessment = (await owned_assessments(session, user, {payload.assessment_id}))[payload.assessment_id]
        row.assessment_id = assessment.id
    elif row.assessment_id:
        assessment = await session.scalar(
            select(Assessment).where(Assessment.id == row.assessment_id, Assessment.user_id == user.id)
        )
    if payload.grammar is not None:
        row.grammar = checked_grammar(payload.grammar, row.content)
    await session.commit()
    return message_out(row, assessment)


@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    row = await owned_message(session, user, message_id)
    chat = await chat_assessments(session, user, [row.assessment_id] if row.assessment_id else [])
    await session.delete(row)
    paths = await drop_assessments(session, chat)
    await session.commit()
    remove_files(settings, paths)
    return {"id": message_id}
