"""/api/chat-home/*(计划 2026-10-23 §5):今天的默认对话与每日问候、问候设置。业务在 app/agents/greeting/。
开关 CHAT_HOME_ENABLED 关:除 GET /config 外一律 404。错误 `{"error": ...}`。URL 里只有 id;查询参数没有;
请求体只有数字、布尔与枚举;问候文本只在响应体里,从不进日志。"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.greeting import prefs as prefs_mod, service
from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings, limited_user
from app.models import User, iso_utc, utcnow
from app.routers.conversations import conversation_out

router = APIRouter(prefix="/api/chat-home")
GreetingId = Annotated[str, Path(max_length=64)]


def require_chat_home(settings: Settings = Depends(get_settings)) -> Settings:
    if not settings.chat_home_enabled:
        raise HTTPException(404, "Chat home is disabled")
    return settings


class TodayIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tz_offset_minutes: int = Field(ge=-720, le=840)  # the /api/stats convention
    client_request_id: uuid.UUID  # correlation only: the unique constraints make the call idempotent


@router.get("/config")
async def chat_home_config(user: User = Depends(current_user), settings: Settings = Depends(get_settings)):
    return {"enabled": settings.chat_home_enabled,
            "llm": settings.chat_greeting_llm_enabled and bool(settings.upstream_llm_base_url)}


@router.get("/settings", dependencies=[Depends(require_chat_home)])
async def get_chat_settings(user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    return (await prefs_mod.load(session, user.id)).out()


@router.patch("/settings", dependencies=[Depends(require_chat_home)])
async def patch_chat_settings(patch: dict = Body(...), user: User = Depends(current_user),
                              session: AsyncSession = Depends(get_session)):
    try:
        saved = await prefs_mod.save(session, user.id, patch)
    except prefs_mod.PrefsInvalid as exc:
        await session.rollback()
        return JSONResponse({"error": "invalid", "field": exc.field}, status_code=422)
    await session.commit()
    return saved.out()


@router.post("/today", dependencies=[Depends(require_chat_home)])
async def today(body: TodayIn, request: Request, user: User = Depends(limited_user),
                session: AsyncSession = Depends(get_session)):
    result = await service.ensure_today(request.app, session, user.id, body.tz_offset_minutes, utcnow())
    return {"local_date": result.local_date.isoformat(), "status": result.status,
            "conversation": conversation_out(result.conversation), "greeting": result.greeting}


@router.post("/greetings/{greeting_id}/seen", dependencies=[Depends(require_chat_home)])
async def greeting_seen(greeting_id: GreetingId, user: User = Depends(current_user),
                        session: AsyncSession = Depends(get_session)):
    seen = await service.mark_seen(session, user.id, greeting_id, utcnow())
    if seen is None:
        raise HTTPException(404, "Greeting not found")
    return {"first_seen_at": iso_utc(seen)}
