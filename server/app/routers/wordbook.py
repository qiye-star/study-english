"""背单词接口(设计文档 2026-10-10-wordbook §7)。业务在 app/wordbook/service.py。

WORDBOOK_ENABLED=false 时只有 GET /config 回答 {"enabled": false},其余端点经 require_wordbook 返回
404 {"error": "Wordbook is disabled"}。依赖顺序:先 current_user 再 require_wordbook(未登录 401 优先)。"""
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings, limited_user
from app.models import User, utcnow
from app.services.prompts import prompt_cache
from app.services.vocabulary import normalize_word
from app.wordbook import explain as wb_explain
from app.wordbook import service
from app.wordbook.index import dictionary

router = APIRouter(prefix="/api/wordbook")
DISABLED = "Wordbook is disabled"
AI_UNAVAILABLE = "AI explanation unavailable"
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


class LearnIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    size: int = Field(5, ge=1, le=10)
    tz_offset_minutes: int = Field(0, ge=TZ_MIN, le=TZ_MAX)


class ReviewIn(LearnIn):
    size: int = Field(20, ge=1, le=20)
    recall: bool = False  # spec recall §4.1:客户端声明能显示「快速回忆」(旧客户端不传 → 不出此题)


class AnswerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    book_id: str = Field(max_length=16)
    key: str = Field(min_length=1, max_length=100)
    mode: Literal["learn", "review"]
    qtype: Literal["meaning", "word", "cloze", "dictation", "spell", "recall"]
    choice: str | None = Field(None, max_length=200)
    typed: str | None = Field(None, max_length=100)
    hinted: bool = False
    known: bool = False
    tz_offset_minutes: int = Field(0, ge=TZ_MIN, le=TZ_MAX)
    rating: Literal["know", "fuzzy", "unknown"] | None = None  # spec recall §9.1
    revealed_before: bool = False
    elapsed_ms: int | None = Field(None, ge=0, le=600_000)


@router.post("/learn/batch")
async def wordbook_learn(payload: LearnIn, request: Request, user: User = Depends(current_user),
                         session: AsyncSession = Depends(get_session), settings: Settings = Depends(require_wordbook)):
    try:
        return await service.learn_batch(session, dictionary(request.app), user.id, settings, payload.size,
                                         payload.tz_offset_minutes, utcnow())
    except service.WordbookError as e:
        _raise(e)


@router.post("/review/batch")
async def wordbook_review(payload: ReviewIn, request: Request, user: User = Depends(current_user),
                          session: AsyncSession = Depends(get_session), settings: Settings = Depends(require_wordbook)):
    try:
        return await service.review_batch(session, dictionary(request.app), user.id, settings, payload.size,
                                          payload.tz_offset_minutes, utcnow(), tts=bool(settings.tts_model_list),
                                          recall_ok=payload.recall)
    except service.WordbookError as e:
        _raise(e)


@router.post("/answers")
async def wordbook_answer(payload: AnswerIn, request: Request, user: User = Depends(current_user),
                          session: AsyncSession = Depends(get_session), settings: Settings = Depends(require_wordbook)):
    p = service.AnswerInput(payload.book_id, normalize_word(payload.key), payload.mode, payload.qtype, payload.choice,
                            payload.typed, payload.hinted, payload.known, payload.tz_offset_minutes, payload.rating,
                            payload.revealed_before, payload.elapsed_ms)
    try:
        return await service.answer(session, dictionary(request.app), user.id, settings, p, utcnow())
    except service.WordbookError as e:
        _raise(e)


SENTENCE_ID = r"^[0-9a-f]{16}$"


class SpellSetsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    count: int = Field(2, ge=1, le=4)
    size: int = Field(5, ge=3, le=6)
    tz_offset_minutes: int = Field(0, ge=TZ_MIN, le=TZ_MAX)


class SpellAnswerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    typed: str = Field(max_length=100)
    hinted: bool = False


class SpellLineIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(min_length=1, max_length=100)
    sentence_id: str = Field(pattern=SENTENCE_ID)
    answers: list[SpellAnswerIn] = Field(min_length=1, max_length=6)


class SpellSubmitIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    book_id: str = Field(max_length=16)
    set_id: str = Field(min_length=1, max_length=12)
    lines: list[SpellLineIn] = Field(min_length=1, max_length=6)
    tz_offset_minutes: int = Field(0, ge=TZ_MIN, le=TZ_MAX)


class ReportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    book_id: str = Field(max_length=16)
    key: str = Field(min_length=1, max_length=100)
    sentence_id: str = Field(pattern=SENTENCE_ID)
    reason: Literal["wrong", "offensive", "other"]
    tz_offset_minutes: int = Field(0, ge=TZ_MIN, le=TZ_MAX)


@router.post("/spell/sets")
async def wordbook_spell_sets(payload: SpellSetsIn, request: Request, user: User = Depends(current_user),
                              session: AsyncSession = Depends(get_session),
                              settings: Settings = Depends(require_wordbook)):
    try:
        return await service.spell_sets(session, dictionary(request.app), user.id, settings, payload.count,
                                        payload.size, payload.tz_offset_minutes, utcnow())
    except service.WordbookError as e:
        _raise(e)


@router.post("/spell/submit")
async def wordbook_spell_submit(payload: SpellSubmitIn, request: Request, user: User = Depends(current_user),
                                session: AsyncSession = Depends(get_session),
                                settings: Settings = Depends(require_wordbook)):
    p = service.SpellInput(payload.book_id, payload.set_id, [
        service.SpellLine(normalize_word(line.key), line.sentence_id, [(a.typed, a.hinted) for a in line.answers])
        for line in payload.lines], payload.tz_offset_minutes)
    try:
        return await service.spell_submit(session, dictionary(request.app), user.id, settings, p, utcnow())
    except service.WordbookError as e:
        _raise(e)


@router.get("/cards/{book_id}/{key}")
async def wordbook_card(request: Request, book_id: str = Path(max_length=16), key: str = Path(max_length=100),
                        _: User = Depends(current_user), session: AsyncSession = Depends(get_session),
                        settings: Settings = Depends(require_wordbook)):
    try:
        return await service.card_detail(session, dictionary(request.app), settings, book_id, normalize_word(key))
    except service.WordbookError as e:
        _raise(e)


@router.post("/reports")
async def wordbook_report(payload: ReportIn, request: Request, user: User = Depends(current_user),
                          session: AsyncSession = Depends(get_session), settings: Settings = Depends(require_wordbook)):
    try:
        return await service.report(session, dictionary(request.app), user.id, settings, book_id=payload.book_id,
                                    key=normalize_word(payload.key), sentence_id=payload.sentence_id,
                                    reason=payload.reason, offset=payload.tz_offset_minutes, now=utcnow())
    except service.WordbookError as e:
        _raise(e)


class ExplainIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(min_length=1, max_length=100)


@router.post("/explain")
async def wordbook_explain(payload: ExplainIn, request: Request, user: User = Depends(limited_user),
                           session: AsyncSession = Depends(get_session), settings: Settings = Depends(require_wordbook)):
    """AI「为什么」讲解(走 limited_user 的每分钟 AI 限流)。不可用(开关、未配置、额度、上游 402/5xx)一律 503。"""
    key = normalize_word(payload.key)
    try:
        card = await service.find_card(session, dictionary(request.app), user.id, settings, key)
    except service.WordbookError as e:
        _raise(e)
    version, body = await prompt_cache(request.app).get("wordbook.explain")
    try:
        text, cached = await wb_explain.explain(session, request.app.state.http, settings, card, user.id, utcnow(),
                                                template=body or wb_explain.DEFAULT_EXPLAIN_TEMPLATE,
                                                prompt_version=version if body else None)
    except wb_explain.ExplainUnavailable:
        raise HTTPException(503, AI_UNAVAILABLE) from None
    return {"key": key, "text": text, "cached": cached}
