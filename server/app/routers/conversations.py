import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.deps import current_user, get_session, get_settings
from app.models import Conversation, Message, User, iso_utc, utcnow

router = APIRouter(prefix="/api")

DEFAULT_NAME = "New conversation"
MAX_CONFIG_BYTES = 16 * 1024
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


def message_out(row: Message) -> dict:
    return {
        "id": row.id,
        "conversation_id": row.conversation_id,
        "role": row.role,
        "content": row.content,
        "created_at": iso_utc(row.created_at),
    }


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
):
    row = await owned_conversation(session, user, conversation_id)
    # SQLite 默认不开外键级联,显式删除消息
    await session.execute(delete(Message).where(Message.conversation_id == row.id))
    await session.delete(row)
    await session.commit()
    return {"id": conversation_id}


@router.get("/conversations/{conversation_id}/messages")
async def list_messages(
    conversation_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = await owned_conversation(session, user, conversation_id)
    messages = (
        await session.execute(
            select(Message)
            .where(Message.conversation_id == row.id)
            .order_by(Message.created_at.asc(), Message.id.asc())
        )
    ).scalars().all()
    return {"messages": [message_out(m) for m in messages]}


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
    last = await session.scalar(
        select(func.max(Message.created_at)).where(Message.conversation_id == conversation.id)
    )
    base = utcnow()
    if last is not None and _as_utc(last) >= base:
        base = _as_utc(last) + timedelta(microseconds=1)
    rows = [
        Message(
            id=str(uuid.uuid4()), conversation_id=conversation.id, role=m.role, content=m.content,
            created_at=base + timedelta(microseconds=i),
        )
        for i, m in enumerate(payload.messages)
    ]
    session.add_all(rows)
    conversation.updated_at = rows[-1].created_at
    await session.commit()
    return {"messages": [message_out(r) for r in rows]}


@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = (
        await session.execute(
            select(Message)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(Message.id == message_id, Conversation.user_id == user.id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Message not found")
    await session.delete(row)
    await session.commit()
    return {"id": message_id}
