"""/api/agents/*(spec 2026-10-12-agents §4.4、§4.5;计划 R-C5、R-C16、R-C24、R-C25):配置、角色 CRUD 与举报、用户设置、
回合 SSE。业务在 app/agents/。总开关关:除 GET /config 外一律 404 `Agents are disabled`。错误 `{"error": ...}`。
URL 里没有词或文本(角色 id 是 uuid / builtin: 键;没有查询参数);请求体与回复从不进日志。"""
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import limits
from app.agents import settings as agent_settings
from app.agents.context import TOOL_KEYS
from app.agents.personas import (
    BUILTIN_PREFIX, ID_PATTERN, ID_RE, LEVELS, REPORTS_DAILY_MAX, STYLES, PersonaInvalid, PersonaStore, clean_persona,
)
from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings
from app.models import User, utcnow
from app.services import usage

router = APIRouter(prefix="/api/agents")
PersonaId = Annotated[str, Path(pattern=ID_PATTERN, max_length=48)]


def require_agents(settings: Settings = Depends(get_settings)) -> Settings:
    if not settings.agents_enabled:
        raise HTTPException(404, "Agents are disabled")
    return settings


def _invalid(field: str) -> HTTPException:
    return HTTPException(422, f"Invalid {field}")


@router.get("/config")
async def agents_config(request: Request, user: User = Depends(current_user),
                        session: AsyncSession = Depends(get_session), settings: Settings = Depends(get_settings)):
    if not settings.agents_enabled:
        return {"enabled": False}
    return {
        "enabled": True, "available": settings.agents_available, "tutor": settings.agents_tutor_enabled,
        "memory": settings.agents_memory_enabled, "rooms": settings.agents_rooms_enabled and settings.rooms_enabled,
        "tools_mode": settings.agents_tools_mode,
        "limits": {"personas_max": await limits.personas_cap(session, request.app, user.id),
                   "prompt_max_chars": settings.agents_prompt_max_chars, "history_max": settings.agents_history_max,
                   "text_max_chars": limits.TEXT_MAX_CHARS},
        "levels": list(LEVELS), "styles": list(STYLES), "tools": list(TOOL_KEYS),
    }


# ---- 角色 ----

@router.get("/personas")
async def list_personas(user: User = Depends(current_user), _: Settings = Depends(require_agents),
                        session: AsyncSession = Depends(get_session)):
    return {"personas": [p.out(user.id) for p in await PersonaStore(session).list_for(user.id)]}


@router.post("/personas")
async def create_persona(request: Request, payload: dict[str, Any] = Body(...), user: User = Depends(current_user),
                         settings: Settings = Depends(require_agents), session: AsyncSession = Depends(get_session)):
    store = PersonaStore(session)
    if await store.count_owned(user.id) >= await limits.personas_cap(session, request.app, user.id):
        raise HTTPException(429, "Persona limit reached")
    try:
        clean = clean_persona(payload, max_prompt_chars=settings.agents_prompt_max_chars)
    except PersonaInvalid as e:
        raise _invalid(e.field) from None
    persona = await store.create(user.id, clean, utcnow())
    await session.commit()
    return persona.out(user.id)


@router.get("/personas/{persona_id}")
async def get_persona(persona_id: PersonaId, user: User = Depends(current_user), _: Settings = Depends(require_agents),
                      session: AsyncSession = Depends(get_session)):
    persona = await PersonaStore(session).get(user.id, persona_id)
    if persona is None:
        raise HTTPException(404, "Persona not found")
    return persona.out(user.id)


@router.patch("/personas/{persona_id}")
async def update_persona(persona_id: PersonaId, payload: dict[str, Any] = Body(...), user: User = Depends(current_user),
                         settings: Settings = Depends(require_agents), session: AsyncSession = Depends(get_session)):
    if persona_id.startswith(BUILTIN_PREFIX):
        raise HTTPException(403, "Built-in personas are read-only")
    try:
        clean = clean_persona(payload, max_prompt_chars=settings.agents_prompt_max_chars, partial=True)
    except PersonaInvalid as e:
        raise _invalid(e.field) from None
    persona = await PersonaStore(session).update(user.id, persona_id, clean, utcnow())
    if persona is None:
        raise HTTPException(404, "Persona not found")
    await session.commit()
    return persona.out(user.id)


@router.delete("/personas/{persona_id}")
async def delete_persona(persona_id: PersonaId, user: User = Depends(current_user),
                         _: Settings = Depends(require_agents), session: AsyncSession = Depends(get_session)):
    if persona_id.startswith(BUILTIN_PREFIX):
        raise HTTPException(403, "Built-in personas are read-only")
    if not await PersonaStore(session).delete(user.id, persona_id):
        raise HTTPException(404, "Persona not found")
    await session.commit()
    return {"id": persona_id}


class ReportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: Literal["offensive", "unsafe", "spam", "other"]


@router.post("/personas/{persona_id}/report")
async def report_persona(body: ReportIn, persona_id: PersonaId, user: User = Depends(current_user),
                         _: Settings = Depends(require_agents), session: AsyncSession = Depends(get_session)):
    day = usage.utc_day(utcnow())
    if not await usage.consume(session, limits.SCOPE_PERSONA_REPORTS, str(user.id), day, REPORTS_DAILY_MAX):
        raise HTTPException(429, "Report limit reached")
    try:
        result = await PersonaStore(session).report(user.id, persona_id, body.reason, utcnow())
        await session.commit()
    except IntegrityError:  # a concurrent identical report won the unique constraint
        await session.rollback()
        result = "duplicate"
    if result == "not_found":
        await usage.refund(session, limits.SCOPE_PERSONA_REPORTS, str(user.id), day)
        raise HTTPException(404, "Persona not found")
    return {"ok": True}


# ---- 用户设置 ----

@router.get("/settings")
async def get_agent_settings(user: User = Depends(current_user), _: Settings = Depends(require_agents),
                             session: AsyncSession = Depends(get_session)):
    return (await agent_settings.load(session, user.id)).out()


@router.patch("/settings")
async def patch_agent_settings(payload: dict[str, Any] = Body(...), user: User = Depends(current_user),
                               _: Settings = Depends(require_agents), session: AsyncSession = Depends(get_session)):
    pid = payload.get("default_persona_id")
    if isinstance(pid, str) and ID_RE.fullmatch(pid) and await PersonaStore(session).get(user.id, pid) is None:
        raise HTTPException(422, "Unknown persona")
    try:
        saved = await agent_settings.save(session, user.id, payload)
    except agent_settings.SettingsInvalid as e:
        raise _invalid(e.field) from None
    await session.commit()
    return saved.out()


# ---- memory endpoints (plan A2) below ----
# ---- tutor endpoints (plan A3) below ----
