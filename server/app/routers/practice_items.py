import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings
from app.models import PracticeItem, User, iso_utc, utcnow

router = APIRouter(prefix="/api")

ItemId = Annotated[str, Path(max_length=64)]


class PracticeItemIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    source: Literal["chat", "lookup", "grammar", "manual"] = "manual"

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("must not be blank")
        return value


def item_out(row: PracticeItem) -> dict:
    return {"id": row.id, "text": row.text, "source": row.source, "created_at": iso_utc(row.created_at)}


@router.get("/practice-items")
async def list_practice_items(
    page: int = Query(1, ge=1, le=10_000),
    per_page: int = Query(20, ge=1, le=50),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    rows = (
        await session.execute(
            select(PracticeItem)
            .where(PracticeItem.user_id == user.id)
            .order_by(PracticeItem.created_at.desc(), PracticeItem.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page + 1)
        )
    ).scalars().all()
    return {
        "practice_items": [item_out(r) for r in rows[:per_page]],
        "page": page,
        "next": page + 1 if len(rows) > per_page else None,
    }


@router.post("/practice-items")
async def create_practice_item(
    payload: PracticeItemIn,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    existing = (
        await session.execute(
            select(PracticeItem).where(PracticeItem.user_id == user.id, PracticeItem.text == payload.text).limit(1)
        )
    ).scalar_one_or_none()
    # Known race: no unique index on text (Postgres btree size limit), so two concurrent
    # identical POSTs may both insert; harmless (duplicate row), accepted.
    if existing is not None:
        return item_out(existing)
    count = await session.scalar(select(func.count()).select_from(PracticeItem).where(PracticeItem.user_id == user.id))
    if count >= settings.max_practice_items:
        raise HTTPException(429, "Practice item limit reached")
    row = PracticeItem(id=str(uuid.uuid4()), user_id=user.id, text=payload.text, source=payload.source, created_at=utcnow())
    session.add(row)
    await session.commit()
    return item_out(row)


@router.delete("/practice-items/{item_id}")
async def delete_practice_item(
    item_id: ItemId,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    row = (
        await session.execute(select(PracticeItem).where(PracticeItem.id == item_id, PracticeItem.user_id == user.id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Practice item not found")
    await session.delete(row)
    await session.commit()
    return {"id": item_id}
