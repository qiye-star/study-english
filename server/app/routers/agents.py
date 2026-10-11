"""/api/agents/*(spec 2026-10-12-agents §4.4、§4.5;计划 R-C5、R-C16、R-C24、R-C25):配置、角色 CRUD 与举报、用户设置、
回合 SSE。业务在 app/agents/。总开关关:除 GET /config 外一律 404 `Agents are disabled`。错误 `{"error": ...}`。
URL 里没有词或文本(角色 id 是 uuid / builtin: 键;没有查询参数);请求体与回复从不进日志。"""
import uuid
from contextlib import aclosing
from typing import Annotated, Any, Literal

import anyio
from fastapi import APIRouter, Body, Depends, HTTPException, Path, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import limits, prompt, trace
from app.agents import settings as agent_settings
from app.agents.context import TOOL_KEYS
from app.agents.orchestrator import TurnRequest, deps_for, run_turn, runtime
from app.agents.personas import (
    BUILTIN_PREFIX, ID_PATTERN, ID_RE, LEVELS, REPORTS_DAILY_MAX, STYLES, Persona, PersonaInvalid, PersonaStore,
    clean_persona,
)
from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings, limited_user
from app.models import User, utcnow
from app.providers import llm
from app.routers.conversations import owned_conversation
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


# ---- 试聊(AX-1 第 4 项)----

class TryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    persona: dict[str, Any]
    text: str = Field(min_length=1, max_length=limits.TEXT_MAX_CHARS)


@router.post("/personas/try")
async def try_persona(body: TryIn, request: Request, user: User = Depends(limited_user),
                      settings: Settings = Depends(require_agents), session: AsyncSession = Depends(get_session)):
    """人设草稿试聊:非流式、一问一答。套安全前言与 clean_persona 校验;计入每日回合额度;不写会话、记忆或人设。"""
    if not body.text.strip():
        raise HTTPException(422, "Text is required")
    try:
        clean = clean_persona(body.persona, max_prompt_chars=settings.agents_prompt_max_chars)
    except PersonaInvalid as e:
        raise _invalid(e.field) from None
    now = utcnow()
    if await limits.consume_turn(session, request.app, settings, user.id, now) is not None:
        raise HTTPException(429, "Turn limit reached")
    draft = Persona(id="draft", owner_id=user.id, **{**clean, "tools": tuple(clean["tools"])})
    messages = prompt.build_messages(draft, memory_block=None, blocks=[], history=[], text=body.text)
    try:
        reply = await llm.complete(request.app.state.http, settings, messages, model=settings.resolved_agents_model,
                                   max_tokens=settings.agents_chat_max_tokens, temperature=limits.CHAT_TEMPERATURE)
    except llm.LlmUnavailable:
        await limits.refund_turn(session, user.id, now)
        raise HTTPException(502, "Upstream unavailable") from None
    return {"text": reply}


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


# ---- 回合 SSE ----

UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"


class HistoryItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(max_length=20000)


class TurnIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    persona_id: str = Field(pattern=ID_PATTERN, max_length=48)
    conversation_id: str = Field(min_length=1, max_length=64)
    text: str | None = Field(default=None, max_length=limits.TEXT_MAX_CHARS)
    history: list[HistoryItem] = Field(default_factory=list, max_length=limits.HISTORY_HARD_MAX)
    mode: Literal["chat", "tutor"] = "chat"
    tutor_session_id: str | None = Field(default=None, pattern=UUID_PATTERN)
    client_turn_id: str = Field(pattern=UUID_PATTERN)


class AgentStream(StreamingResponse):
    """SSE 响应:无论正常结束、客户端断开(ASGI < 2.4 取消作用域;≥ 2.4 send 抛 OSError)还是被取消,都在 finally 里
    关闭事件迭代器,上游模型流随之立即关闭(R-C14)。"""

    def __init__(self, events):
        super().__init__(events, media_type="text/event-stream",
                         headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
        self._events = events

    async def __call__(self, scope, receive, send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            with anyio.CancelScope(shield=True):
                await self._events.aclose()


async def _replay(events: list):
    for event in events:
        yield event.to_sse()


async def _recorded(ledger: limits.TurnLedger, user_id: int, client_turn_id: str, events):
    """把事件转成 SSE,并记下重放所需(start、全文、meta、done);没走到 done 就从账本删掉(R-C6)。"""
    start = meta = done = None
    texts: list[str] = []
    try:
        async with aclosing(events) as stream:
            async for event in stream:
                if isinstance(event, trace.Start):
                    start = event
                elif isinstance(event, trace.Delta):
                    texts.append(event.text)
                elif isinstance(event, trace.Meta):
                    meta = event
                elif isinstance(event, trace.Done):
                    done = event
                yield event.to_sse()
    finally:
        if done is not None and start is not None:
            replay = [start, *([trace.Delta("".join(texts))] if texts else []), *([meta] if meta else []), done]
            ledger.finish(user_id, client_turn_id, replay)
        else:
            ledger.drop(user_id, client_turn_id)


@router.post("/turn")
async def turn(body: TurnIn, request: Request, user: User = Depends(limited_user),
               settings: Settings = Depends(require_agents), session: AsyncSession = Depends(get_session)):
    if body.mode == "tutor" and not settings.agents_tutor_enabled:
        raise HTTPException(404, "Tutor is disabled")
    if body.mode == "chat" and not (body.text or "").strip():
        raise HTTPException(422, "Text is required")
    await owned_conversation(session, user, body.conversation_id)
    persona = await PersonaStore(session).get(user.id, body.persona_id)
    if persona is None:
        raise HTTPException(404, "Persona not found")
    agent = await agent_settings.load(session, user.id)
    await session.close()  # the stream opens its own short sessions; do not hold a connection for its duration
    rt = runtime(request.app)
    state, entry = rt.ledger.begin(user.id, body.client_turn_id)
    if state == "running":
        raise HTTPException(409, "Turn is busy")
    if state == "done":
        return AgentStream(_replay(entry.replay))
    if state == "busy":
        return AgentStream(_replay([trace.Start(str(uuid.uuid4())), trace.Error("busy")]))
    req = TurnRequest(user_id=user.id, persona=persona, conversation_id=body.conversation_id, room_id=None,
                      text=body.text, history=[h.model_dump() for h in body.history], mode=body.mode,
                      tutor_session_id=body.tutor_session_id, client_turn_id=body.client_turn_id, in_room=False,
                      agent_settings=agent)
    return AgentStream(_recorded(rt.ledger, user.id, body.client_turn_id, run_turn(deps_for(request.app), req)))


# ---- memory endpoints (plan A2) below ----
# ---- tutor endpoints (plan A3) below ----
