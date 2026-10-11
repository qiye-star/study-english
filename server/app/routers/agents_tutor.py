"""导师模式接口(spec 2026-10-12-agents §4.5、§7;计划 A3 S7、R-T4)。回合本身走 A1 的 POST /api/agents/turn(mode=tutor)。
日志只记种类与数字;响应里的词只属于本人。来源只经 runtime(app).registry(INDEX X1)。"""
import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import limits
from app.agents import settings as agent_settings
from app.agents.context import SourceCtx, SourceRegistry, prefetch
from app.agents.orchestrator import runtime
from app.agents.personas import PersonaStore
from app.agents.tutor import service
from app.agents.tutor.memory_bridge import write_recap
from app.agents.tutor.plan import LENGTH_DEFAULT, LENGTH_MAX, LENGTH_MIN, PlanSources, clean_goal, sources_from
from app.core.deps import current_user, get_session, limited_user
from app.models import Conversation, User, utcnow

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agents/tutor")
SessionId = Annotated[str, Path(min_length=36, max_length=36)]
PLAN_SOURCES = ("due_words", "weak_words", "memory")
PREFETCH_BUDGET_MS = 250


class StartIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: str = Field(min_length=36, max_length=36)
    persona_id: str = Field(min_length=1, max_length=64)
    topic: Literal["free", "scenario", "today_words", "weak_words"] = "free"
    scenario: Literal["restaurant", "travel", "interview", "shopping", "small_talk"] | None = None
    length: int = Field(LENGTH_DEFAULT, ge=LENGTH_MIN, le=LENGTH_MAX)
    input: Literal["text", "voice"] = "text"
    client_start_id: str = Field(min_length=36, max_length=36)


def _require(request: Request):
    settings = request.app.state.settings
    if not (settings.agents_enabled and settings.agents_tutor_enabled):
        raise HTTPException(404, "Tutor is disabled")
    return settings


def _http(e: service.TutorError) -> HTTPException:
    return HTTPException(e.status, e.message)


async def _plan_sources(request: Request, user_id: int, persona, prefs, conversation_id: str) -> PlanSources:
    """一次并行预取(A1 prefetch,总预算 250 ms,超时的来源记为 skip),只取到期词 / 易错词 / 记忆;
    来源选择与开关判断(用户工具开关 × 角色工具 × AGENTS_TOOLS_MODE)复用 A1 的 `enabled`。"""
    full = runtime(request.app).registry
    wanted = SourceRegistry()
    for key in PLAN_SOURCES:
        source = full.get(key)
        if source is not None:
            wanted.register(source)
    if not wanted.keys():
        return PlanSources()
    settings = request.app.state.settings
    tools_mode = limits.effective_tools_mode(settings, getattr(request.app.state, "agents_tools_probe", None))
    ctx = SourceCtx(user_id=user_id, persona=persona, settings=prefs, text=None, thread_id=conversation_id,
                    in_room=False)
    outcomes = await prefetch(wanted, ctx, PREFETCH_BUDGET_MS, timeout_ms=settings.agents_source_timeout_ms,
                              tools_mode=tools_mode)
    return sources_from({o.key: o.result.params for o in outcomes if o.status == "done" and o.result is not None})


@router.post("/start")
async def start(payload: StartIn, request: Request, user: User = Depends(limited_user),
                session: AsyncSession = Depends(get_session)):
    settings = _require(request)
    conversation = await session.get(Conversation, payload.conversation_id)
    if conversation is None or conversation.user_id != user.id:
        raise HTTPException(404, "Not Found")
    persona = await PersonaStore(session).get(user.id, payload.persona_id)
    if persona is None:
        raise HTTPException(404, "Not Found")
    if persona.disabled:
        raise HTTPException(409, "Persona disabled")
    now = utcnow()
    try:
        existing = await service.find_existing(session, user.id, payload.conversation_id, payload.client_start_id, now)
    except service.TutorError as e:
        raise _http(e) from None
    if existing is not None:
        return service.out(existing, now, resumed=True)
    prefs = await agent_settings.load(session, user.id)
    goal = clean_goal({"topic": payload.topic, "scenario": payload.scenario, "length": payload.length,
                       "input": payload.input, "mix": prefs.tutor.get("mix")})
    sources = await _plan_sources(request, user.id, persona, prefs, payload.conversation_id)
    try:
        row, resumed = await service.start(
            session, settings, user_id=user.id, conversation_id=payload.conversation_id, persona_id=payload.persona_id,
            level=persona.level, goal=goal, sources=sources, client_start_id=payload.client_start_id, now=now)
    except service.TutorError as e:
        raise _http(e) from None
    return service.out(row, now, resumed=resumed)


@router.get("/active")  # 必须在 /{session_id} 之前
async def active(request: Request, conversation_id: Annotated[str, Query(min_length=36, max_length=36)],
                 user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    _require(request)
    now = utcnow()
    row = await service.active_for(session, user.id, conversation_id, now)
    return {"session": service.out(row, now) if row is not None else None}


@router.get("/{session_id}")
async def get_session_out(session_id: SessionId, request: Request, user: User = Depends(current_user),
                          session: AsyncSession = Depends(get_session)):
    _require(request)
    row = await service.load_owned(session, user.id, session_id)
    if row is None:
        raise HTTPException(404, "Not Found")
    return service.out(row, utcnow())


@router.post("/{session_id}/hint")
async def hint(session_id: SessionId, request: Request, user: User = Depends(current_user),
               session: AsyncSession = Depends(get_session)):
    _require(request)
    now = utcnow()
    try:
        row, text = await service.hint(session, user.id, session_id, now)
    except service.TutorError as e:
        raise _http(e) from None
    return {"hint": text, "session": service.out(row, now)}


@router.post("/{session_id}/skip")
async def skip(session_id: SessionId, request: Request, user: User = Depends(current_user),
               session: AsyncSession = Depends(get_session)):
    _require(request)
    now = utcnow()
    try:
        row = await service.skip(session, user.id, session_id, now)
    except service.TutorError as e:
        raise _http(e) from None
    return service.out(row, now)


@router.post("/{session_id}/finish")
async def finish(session_id: SessionId, request: Request, user: User = Depends(current_user),
                 session: AsyncSession = Depends(get_session)):
    _require(request)

    async def on_recap(row, data: dict) -> None:
        try:
            await write_recap(request.app, user_id=user.id, persona_id=row.persona_id,
                              conversation_id=row.conversation_id, session_id=row.id, recap=data)
        except Exception as e:  # noqa: BLE001 — 记忆尽力而为(spec §8.3),失败不影响结束
            logger.warning("tutor recap memory failed error=%s", type(e).__name__)

    try:
        return await service.finish(session, user.id, session_id, utcnow(), on_recap=on_recap)
    except service.TutorError as e:
        raise _http(e) from None
