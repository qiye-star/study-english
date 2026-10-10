"""词汇本接口(设计文档 §3.5,计划裁定 R17/R18)。"""
import uuid
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.quotas import effective
from app.core.deps import current_user, get_session, get_settings
from app.models import User, VocabularyItem, iso_utc, utcnow
from app.services.vocabulary import MAX_EXAMPLE, MAX_MEANING, MAX_WORD, apply_review, validate_word

router = APIRouter(prefix="/api")

ItemId = Annotated[str, Path(max_length=64)]
# 背单词建的行(source='wordbook:<book>')不进生词本默认列表,也不占 max_vocab_items(wordbook spec R-W4)。
WORDBOOK_PREFIX = "wordbook:"
MINE = ~VocabularyItem.source.like(f"{WORDBOOK_PREFIX}%")
NOT_FOUND = "Vocabulary item not found"
NOT_DUE = "Vocabulary item is not due"
ALREADY_REVIEWED = "Vocabulary item was already reviewed"


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class VocabularyIn(BaseModel):
    word: str = Field(min_length=1, max_length=2 * MAX_WORD)
    meaning: str = Field(default="", max_length=MAX_MEANING)
    example: str | None = Field(default=None, max_length=MAX_EXAMPLE)
    source: Literal["lookup", "recap", "progress", "manual"] = "manual"

    @field_validator("word")
    @classmethod
    def _word(cls, value: str) -> str:
        return validate_word(value)

    @field_validator("meaning")
    @classmethod
    def _meaning(cls, value: str) -> str:
        return value.strip()

    @field_validator("example")
    @classmethod
    def _example(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class ReviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    grade: Literal["forgot", "hard", "good"]


def item_out(row: VocabularyItem) -> dict:
    return {
        "id": row.id,
        "word": row.word,
        "meaning": row.meaning,
        "example": row.example,
        "source": row.source,
        "box": row.box,
        "due_at": iso_utc(row.due_at),
        "reps": row.reps,
        "lapses": row.lapses,
        "last_reviewed_at": iso_utc(row.last_reviewed_at) if row.last_reviewed_at else None,
        "created_at": iso_utc(row.created_at),
    }


async def owned_item(session: AsyncSession, user: User, item_id: str) -> VocabularyItem:
    row = (
        await session.execute(select(VocabularyItem).where(VocabularyItem.id == item_id, VocabularyItem.user_id == user.id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, NOT_FOUND)
    return row


@router.get("/vocabulary")
async def list_vocabulary(
    page: int = Query(1, ge=1, le=10_000),
    per_page: int = Query(20, ge=1, le=50),
    due: bool = Query(False),
    scope: Literal["mine", "all"] = Query("mine"),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    now = utcnow()
    owner = [VocabularyItem.user_id == user.id] + ([MINE] if scope == "mine" else [])
    stmt = select(VocabularyItem).where(*owner)
    if due:
        stmt = stmt.where(VocabularyItem.due_at <= now).order_by(VocabularyItem.due_at.asc(), VocabularyItem.id.asc())
    else:
        stmt = stmt.order_by(VocabularyItem.created_at.desc(), VocabularyItem.id.desc())
    rows = (await session.execute(stmt.offset((page - 1) * per_page).limit(per_page + 1))).scalars().all()
    due_count = await session.scalar(
        select(func.count()).select_from(VocabularyItem).where(*owner, VocabularyItem.due_at <= now)
    )
    return {
        "vocabulary_items": [item_out(r) for r in rows[:per_page]],
        "page": page,
        "next": page + 1 if len(rows) > per_page else None,
        "due_count": due_count,
    }


@router.post("/vocabulary")
async def create_vocabulary_item(
    payload: VocabularyIn,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    rows = (
        await session.execute(
            select(VocabularyItem).where(VocabularyItem.user_id == user.id, VocabularyItem.word == payload.word)
            .order_by(VocabularyItem.created_at, VocabularyItem.id)
        )
    ).scalars().all()
    # 已知竞态:不建唯一索引(R17),两个并发的相同 POST 可能都插入;无害(重复一行),接受。
    mine = next((r for r in rows if not r.source.startswith(WORDBOOK_PREFIX)), None)
    if mine is not None:
        return item_out(mine)
    count = await session.scalar(select(func.count()).select_from(VocabularyItem).where(VocabularyItem.user_id == user.id, MINE))
    if count >= await effective(session, settings, user.id, "max_vocab_items"):
        raise HTTPException(429, "Vocabulary limit reached")
    if rows:
        # 背单词已有这个词(review M2):收进生词本(改 source,从此计入上限、出现在默认列表),保留盒子与复习进度;
        # 与 R-W3「词书采纳已有词」相反方向。用户给了释义/例句就用用户的。
        adopted = rows[0]
        adopted.source = payload.source
        if payload.meaning:
            adopted.meaning = payload.meaning
        if payload.example:
            adopted.example = payload.example
        await session.commit()
        return item_out(adopted)
    now = utcnow()
    row = VocabularyItem(
        id=str(uuid.uuid4()), user_id=user.id, word=payload.word, meaning=payload.meaning, example=payload.example,
        source=payload.source, box=0, due_at=now, reps=0, lapses=0, last_reviewed_at=None, created_at=now,
    )
    session.add(row)
    await session.commit()
    return item_out(row)


@router.delete("/vocabulary/{item_id}")
async def delete_vocabulary_item(
    item_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = await owned_item(session, user, item_id)
    await session.delete(row)
    await session.commit()
    return {"id": item_id}


@router.post("/vocabulary/{item_id}/review")
async def review_vocabulary_item(
    payload: ReviewIn,
    item_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = await owned_item(session, user, item_id)
    now = utcnow()
    if _as_utc(row.due_at) > now:
        raise HTTPException(409, NOT_DUE)
    item_pk, user_pk = row.id, user.id  # 读出来:rollback 会让 ORM 对象过期,之后不能再懒加载
    applied = await apply_review(session, user_pk, item_pk, seen_box=row.box, seen_reps=row.reps, grade=payload.grade, now=now)
    if not applied:
        await session.rollback()
        still = await session.scalar(select(VocabularyItem.id).where(VocabularyItem.id == item_pk, VocabularyItem.user_id == user_pk))
        raise HTTPException(404, NOT_FOUND) if still is None else HTTPException(409, ALREADY_REVIEWED)
    await session.commit()
    fresh = await session.scalar(
        select(VocabularyItem).where(VocabularyItem.id == item_pk).execution_options(populate_existing=True)
    )
    return item_out(fresh)
