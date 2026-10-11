"""Room agents endpoints and wiring (plan 2026-10-12-agents-rooms, lanes S and T). `install(app, rt)` is listed in
`app.state.rooms_extensions` (main.py): it puts the AgentLane on `rt.agents` and the persona check on
`rt.agent_checker` (routers/rooms.py never imports this module). The agents runtime is reached only through
`app.agents.orchestrator.runtime(app)` / `deps_for(app)` (INDEX X1). Never logs persona text, names or user text."""
import dataclasses

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError

from app.agents import limits
from app.agents import settings as agent_settings
from app.agents.context import SourceRegistry
from app.agents.orchestrator import ModeRegistry, TurnHooks, run_turn
from app.agents.orchestrator import deps_for as agents_deps_for
from app.agents.personas import REPORT_REASONS, REPORTS_DAILY_MAX, Persona, PersonaStore
from app.core.config import Settings
from app.core.deps import current_user
from app.models import User, utcnow
from app.rooms import agent_config
from app.rooms.agent_lane import AgentLane, AgentLaneDeps, AgentPrefs
from app.rooms.protocol import MAX_ID
from app.rooms.store import RoomError
from app.routers.rooms import RoomsRuntime, _raise, deps_for, require_rooms, runtime
from app.services import usage

router = APIRouter(prefix="/api/rooms")


def feature_on(app) -> bool:
    s = app.state.settings
    return bool(s.agents_enabled and s.agents_rooms_enabled)


def tutor_on(app) -> bool:
    return feature_on(app) and bool(app.state.settings.agents_tutor_enabled)


class SessionPersonas:
    """`agent_config.PersonaLookup` over the session-bound `PersonaStore` (INDEX X4): one short session per call."""

    def __init__(self, sessions):
        self.sessions = sessions

    async def get(self, user_id: int, persona_id: str) -> Persona | None:
        async with self.sessions() as s:
            return await PersonaStore(s).get(user_id, persona_id)

    async def report(self, reporter_id: int, persona_id: str, reason: str) -> str:
        """"ok" | "duplicate" | "not_found" | "limit"; shares A1's daily report cap (`SCOPE_PERSONA_REPORTS`)."""
        day = usage.utc_day(utcnow())
        async with self.sessions() as s:
            if not await usage.consume(s, limits.SCOPE_PERSONA_REPORTS, str(reporter_id), day, REPORTS_DAILY_MAX):
                return "limit"
            try:
                result = await PersonaStore(s).report(reporter_id, persona_id, reason, utcnow())
                await s.commit()
            except IntegrityError:  # a concurrent identical report won the unique constraint
                await s.rollback()
                result = "duplicate"
            if result == "not_found":
                await usage.refund(s, limits.SCOPE_PERSONA_REPORTS, str(reporter_id), day)
            return result


def _without(registry, drop) -> SourceRegistry:
    """A copy of the context sources minus those `drop(source)` selects (the shared registry is never mutated)."""
    out = SourceRegistry()
    for key in registry.keys():
        source = registry.get(key)
        if not drop(source):
            out.register(source)
    return out


class _RoomModes(ModeRegistry):
    """The shared modes plus the room's own `chat` handler for one turn (the shared registry is not touched)."""

    def __init__(self, base: ModeRegistry, extra: dict):
        super().__init__()
        self._base, self._extra = base, extra

    def get(self, name: str):
        return self._extra.get(name) or self._base.get(name)

    def names(self) -> tuple[str, ...]:
        return tuple({*self._base.names(), *self._extra})


def install(app, rt: RoomsRuntime) -> None:
    """Called once by `routers.rooms.runtime(app)`; settings are read per call (hot reload)."""
    personas = SessionPersonas(app.state.sessionmaker)

    async def prefs(user_id: int) -> AgentPrefs:
        async with app.state.sessionmaker() as s:
            st = await agent_settings.load(s, user_id)
        return AgentPrefs(share_in_rooms=bool(st.share_in_rooms), memory_enabled=bool(st.memory_enabled),
                          show_process=bool(st.show_process))

    def turn_deps(*, allow_private: bool, memory: bool, modes: dict):
        base = agents_deps_for(app)  # X1: the one access point to the agents runtime
        registry = base.registry
        if not allow_private:  # share_in_rooms=false: no source that reads the asker's personal data (R-RA6)
            registry = _without(registry, lambda src: bool(getattr(src, "private", False)))
        if not memory:  # hand-off turns and memory-off askers: neither read nor write memory
            registry = _without(registry, lambda src: src.key == "memory")
        return dataclasses.replace(base, registry=registry, modes=_RoomModes(base.modes, modes),
                                   hooks=base.hooks if memory else TurnHooks(after_turn=[]))

    rt.agents = AgentLane(
        AgentLaneDeps(personas=personas, run_turn=run_turn, turn_deps=turn_deps, prefs=prefs,
                      feature_on=lambda: feature_on(app), tutor_on=lambda: tutor_on(app),
                      tutor_daily=lambda: int(app.state.settings.agents_tutor_daily_per_user)),
        rooms=lambda: deps_for(app, rt, app.state.settings))

    async def check(owner_id: int, ids: list[str]) -> tuple[str | None, list[str]]:
        if not feature_on(app):
            return "disabled", []
        found, problem = await agent_config.validate(personas, owner_id, ids)
        return problem, [p.name for p in found]

    rt.agent_checker = check


class AgentReportIn(BaseModel):
    reason: str = Field(max_length=32)


async def _member_room(request: Request, room_id: str, user: User):
    rt = runtime(request.app)
    try:
        room, member = await rt.store.membership(room_id[:MAX_ID], user.id)
    except RoomError as e:
        _raise(e)
    return rt, room, member


@router.get("/{room_id}/agents")
async def room_agents(room_id: str, request: Request, user: User = Depends(current_user),
                      _: Settings = Depends(require_rooms)):
    """Members see the room's agents: name, intro, level, style and, if public, the prompt (spec D3)."""
    rt, room, _member = await _member_room(request, room_id, user)
    lane: AgentLane = rt.agents
    if not feature_on(request.app):
        return {"available": False, "agents": [], "tutor": None}
    resolved = await agent_config.resolve(lane.deps.personas, agent_config.config_of(room))
    tutor = await lane.tutor.public_view(room) if lane.tutor is not None else None
    return {"available": True, "agents": [agent_config.persona_out(p) for p in resolved], "tutor": tutor}


@router.post("/{room_id}/agents/{persona_id}/report")
async def report_agent(room_id: str, persona_id: str, payload: AgentReportIn, request: Request,
                       user: User = Depends(current_user), _: Settings = Depends(require_rooms)):
    """A member reports one of this room's agents (spec §9.1); handled in the admin agents queue (A1)."""
    if payload.reason not in REPORT_REASONS:
        raise HTTPException(400, "Invalid reason")
    rt, room, _member = await _member_room(request, room_id, user)
    persona_id = persona_id[:MAX_ID]
    if persona_id not in agent_config.config_of(room).persona_ids:
        raise HTTPException(404, "Agent not found")
    result = await rt.agents.deps.personas.report(user.id, persona_id, payload.reason)
    if result == "limit":
        raise HTTPException(429, "Report limit reached")
    if result == "not_found":  # built-in or your own persona: nothing to report
        raise HTTPException(404, "Agent not found")
    return {"ok": True}
