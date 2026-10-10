"""背单词接口(设计文档 2026-10-10-wordbook §7)。业务在 app/wordbook/service.py。

WORDBOOK_ENABLED=false 时只有 GET /config 回答 {"enabled": false},其余端点经 require_wordbook 返回
404 {"error": "Wordbook is disabled"}。依赖顺序:先 current_user 再 require_wordbook(未登录 401 优先)。"""
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings
from app.models import User, utcnow
from app.wordbook import service
from app.wordbook.index import dictionary

router = APIRouter(prefix="/api/wordbook")
DISABLED = "Wordbook is disabled"
TZ_MIN, TZ_MAX = -840, 840


def require_wordbook(settings: Settings = Depends(get_settings)) -> Settings:
    if not settings.wordbook_enabled:
        raise HTTPException(404, DISABLED)
    return settings


def _raise(e: service.WordbookError):
    raise HTTPException(e.status, e.message) from None


class EnrollmentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    book_id: str = Field(max_length=16)
    daily_new: int | None = Field(None, ge=5, le=100)
    review_cap: int | None = Field(None, ge=20, le=500)
    order_mode: Literal["shuffle", "book"] | None = None


@router.get("/config")
async def wordbook_config(_: User = Depends(current_user), settings: Settings = Depends(get_settings)):
    return service.config_out(settings) if settings.wordbook_enabled else {"enabled": False}


@router.get("/books")
async def wordbook_books(request: Request, user: User = Depends(current_user),
                         session: AsyncSession = Depends(get_session), settings: Settings = Depends(require_wordbook)):
    return await service.books_out(session, dictionary(request.app), user.id, settings)


@router.put("/enrollment")
async def wordbook_enroll(payload: EnrollmentIn, user: User = Depends(current_user),
                          session: AsyncSession = Depends(get_session), settings: Settings = Depends(require_wordbook)):
    try:
        return await service.put_enrollment(session, user.id, settings, book_id=payload.book_id,
                                            daily_new=payload.daily_new, review_cap=payload.review_cap,
                                            order_mode=payload.order_mode, now=utcnow(),
                                            seed=secrets.randbelow(2**31))
    except service.WordbookError as e:
        _raise(e)


@router.get("/today")
async def wordbook_today(request: Request, tz_offset_minutes: int = Query(0, ge=TZ_MIN, le=TZ_MAX),
                         user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
                         settings: Settings = Depends(require_wordbook)):
    try:
        return await service.today_out(session, dictionary(request.app), user.id, settings, tz_offset_minutes, utcnow())
    except service.WordbookError as e:
        _raise(e)
