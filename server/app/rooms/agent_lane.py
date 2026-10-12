"""Agent turns in a room (spec 2026-10-12-agents §4.4, §5, §9.2; plan A5 R-RA2/R-RA5/R-RA6/R-RA7).

Which agent a message goes to is decided in `AgentLane.route`: `@ai` (the room's default agent) > `@name` > a reply to
an agent's answer > the sender's `say.to` (spec addressing; R-AS2); a running room tutor closes the implicit ways (R-AS3).
A member's `@<persona> question` becomes one orchestrator turn (`run_turn`, `in_room=True`); the reply is a normal
public `ai_answer` message with `meta.agent`. The process (`agent_step` / `agent_thought`) and the compact trace (a
private `agent_trace` row) go only to the asker. Shares the `@ai` gates: the per-room AI lock (one AI speaker at a
time), the AI queue cap, the per-room / per-user windows, `room_ai_global`, `ai_public` and `ai_muted`.
Never logs text, names, prompts or words: only codes, kinds and depths."""
import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import aclosing
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from app.agents.orchestrator import ModeBlock, PassThrough, TurnRequest
from app.agents.prompt import escape
from app.agents.trace import Delta, Done, Error, Step, Thought
from app.core import metering
from app.rooms import agent_config
from app.rooms.agent_mentions import agent_mention, find_handoff
from app.rooms.protocol import event
from app.rooms.rules import mention
from app.rooms.store import message_out

if TYPE_CHECKING:
    from app.rooms.connection import ConnDeps, RoomConnection

logger = logging.getLogger(__name__)
GLOBAL = "*"
AGENT_CONTEXT = 20  # recent public messages given to a room agent turn (R-RA15)
AGENT_TURN_TIMEOUT = 45.0  # seconds for one whole turn, prefetch to the last delta (R-RA5)
MAX_AGENT_TEXT = 1200  # code points kept from an agent reply
HANDOFF_DEPTH = 1  # A may hand over to B once; B never hands over again (R-RA7)
FAIL_CODES = {"limit": "quota", "busy": "quota"}  # run_turn error code -> ai_failed code; anything else "upstream"
DEFAULT_PERSONA_ID = "builtin:coach"  # R-AS5: where `@ai` goes when the room has no (resolvable) agent configured
ROOM_RULES = (
    "You are answering in a public multiplayer practice room; every member reads your reply.\n"
    "- Answer {asker}'s message directly in at most 80 words of simple English. Reply in English only.\n"
    "- Never read out, list or quote {asker}'s personal learning data (learned, weak or due words, memories, "
    "profile) in the reply; use it only to choose what to say.\n"
    "- Other agents in this room: {others}. Only if one of them clearly fits better, end with one line "
    "\"@<their name>\" to hand over. Never hand over to yourself.\n"
)


def _plain(value: str) -> str:
    """User-chosen names go into the mode block as one short line (no newlines, no prompt structure)."""
    return escape(" ".join(str(value or "").split())[:40])


def _clean(parts: list[str]) -> str:
    return "".join(parts).strip()[:MAX_AGENT_TEXT].strip()


def _history(rows: list[tuple[str, str, str | None]], persona_id: str) -> list[dict]:
    """Room messages as chat history: this persona's own answers are `assistant`, everything else `user` with the
    speaker's name (the orchestrator clamps and escapes, spec §4.4)."""
    return [{"role": "assistant", "content": text} if pid == persona_id else {"role": "user", "content": f"{name}: {text}"}
            for name, text, pid in rows]


@dataclass(frozen=True)
class AgentPrefs:
    """The asker's agent settings that matter in a room (spec §4.3)."""
    share_in_rooms: bool = True
    memory_enabled: bool = True
    show_process: bool = True
    zh_note: str = "auto"  # the user's `zh_note` setting (addressing §5.1); the room tutor reads the starter's


@dataclass(frozen=True)
class AgentRoute:
    room_id: str
    asker_id: int
    asker_name: str
    persona: Any
    personas: tuple
    question: str
    depth: int = 0
    handoff_from: Any = None
    via: str = "name"  # alias | name | reply | to | handoff (R-AS19)


@dataclass(frozen=True)
class Target:
    """Who a message is addressed to, before admission. `persona` None = addressed but unusable (an id that is not
    one of the room's agents, or nobody resolvable)."""
    persona: Any | None
    via: str  # alias | name | reply | to


@dataclass
class AgentLaneDeps:
    personas: agent_config.PersonaLookup
    run_turn: Callable[[Any, TurnRequest], AsyncIterator[Any]]
    turn_deps: Callable[..., Any]  # (*, allow_private: bool, memory: bool, modes: dict) -> app.agents TurnDeps
    prefs: Callable[[int], Awaitable[AgentPrefs]]
    feature_on: Callable[[], bool]
    tutor_on: Callable[[], bool] = lambda: False
    tutor_daily: Callable[[], int] = lambda: 20
    turn_timeout: float = AGENT_TURN_TIMEOUT
    new_id: Callable[[], str] = lambda: uuid.uuid4().hex


class RoomChatMode:
    """ModeHandler for `@<persona>` in a room (A1 protocol): the room rules ride in the mode block, after the safety
    preamble and the persona (A1's fixed prompt order); no stream filter, no meta."""
    name = "chat"

    def __init__(self, asker_name: str, others: list[str]):
        self.asker_name = _plain(asker_name)
        self.others = [_plain(n) for n in others]

    async def prepare(self, req) -> ModeBlock:
        others = ", ".join(f"@{n}" for n in self.others) or "none"
        return ModeBlock(text=ROOM_RULES.replace("{asker}", self.asker_name).replace("{others}", others),
                         max_tokens=300)

    def stream_filter(self):
        return PassThrough()

    async def finish(self, req, full_text: str) -> dict | None:
        return None


class AgentLane:
    """`ConnDeps.agents` (connection.AgentsHandler). `rooms()` returns the live ConnDeps (hot-reloaded limits,
    the current AI gate); `tutor` is the RoomTutor installed by lane T (agent_tutor.py), None until then."""

    def __init__(self, deps: AgentLaneDeps, rooms: Callable[[], "ConnDeps"]):
        self.deps = deps
        self.rooms = rooms
        self.tutor = None

    async def route(self, conn: "RoomConnection", text: str, reply_to: int | None = None,
                    to: str | None = None) -> AgentRoute | None:
        """Route one say (spec addressing §3.4, §4; R-AS2): `@ai` (the default agent) > `@name` > the reply rule >
        `to`. None = a plain message: nothing addressed, no match, or refused with a notice to this connection.
        On success the AI queue slot and `room_ai_global` are reserved (release() undoes)."""
        r = self.rooms()
        room = await r.store.room(conn.room_id)
        if room is None:
            return None
        cfg = agent_config.config_of(room)
        personas = await self._personas(cfg)
        target: Target | None = None
        question = text
        alias, asked = mention(text)
        if alias:
            target, question = Target(await self.default_persona(cfg, personas), "alias"), asked
        elif text.startswith("@") and personas:
            index, asked = agent_mention(text, [p.name for p in personas])
            if index is not None:
                target, question = Target(personas[index], "name"), asked
        if target is None:  # R-AS21: an `@` that names nobody we know falls through to the implicit rules
            target = await self._implicit(room, personas, reply_to, to)
        if target is None:
            return None
        return await self._admit(conn.send_self, target, room_id=conn.room_id, asker_id=conn.user_id,
                                 asker_name=conn.name, personas=personas, question=question)

    async def _personas(self, cfg: agent_config.AgentConfig) -> list:
        """The room's configured personas that still exist, in the owner's order."""
        return await agent_config.resolve(self.deps.personas, cfg) if cfg.persona_ids else []

    async def default_persona(self, cfg: agent_config.AgentConfig, personas: list):
        """R-AS5: the first resolvable configured persona, else the built-in coach (looked up as the chooser)."""
        if personas:
            return personas[0]
        return await self.deps.personas.get(cfg.chosen_by or 0, DEFAULT_PERSONA_ID)

    async def _implicit(self, room, personas: list, reply_to: int | None, to: str | None) -> Target | None:
        """The ways that need no `@`: a reply to an agent's answer, then the sender's `to` (R-AS2). A running room
        tutor closes both (R-AS3): its called member's answers go to the tutor, everyone else's are context."""
        if isinstance(room.agent_tutor, dict):
            return None
        if reply_to is not None:
            persona_id = await self.rooms().store.agent_of(room.id, reply_to)
            persona = next((p for p in personas if p.id == persona_id), None) if persona_id else None
            if persona is not None:  # an agent that left the room's config makes the reply a plain message
                return Target(persona, "reply")
        if to is not None:
            return Target(next((p for p in personas if p.id == to), None), "to")
        return None

    async def _admit(self, tell: Callable[[dict], Awaitable[None]], target: Target, *, room_id: str, asker_id: int,
                     asker_name: str, personas: list, question: str) -> AgentRoute | None:
        """Switches, persona state and the shared room gates. Explicit ways get `agent_off` when refused; a refused
        reply is silent (R-AS4). `_reserve` tells about `ai_off` / `ai_busy` / `ai_quota` for every way (R-AS22)."""
        persona = target.persona
        if not self.deps.feature_on() or persona is None or getattr(persona, "disabled", False):
            if target.via != "reply":
                await tell(event("notice", code="agent_off"))
            return None
        route = AgentRoute(room_id, asker_id, asker_name, persona, tuple(personas) or (persona,), question,
                           via=target.via)
        return route if await self._reserve(route, tell) else None

    async def _reserve(self, route: AgentRoute, tell: Callable[[dict], Awaitable[None]]) -> bool:
        r = self.rooms()
        room = await r.store.room(route.room_id)
        if not r.ai_available or room is None or room.status != "open" or not room.ai_public or room.ai_muted:
            await tell(event("notice", code="ai_off"))
            return False
        if r.hub.ai_pending(route.room_id) >= r.limits.ai_queue:
            await tell(event("notice", code="ai_busy"))
            return False
        r.hub.ai_enter(route.room_id)  # reserve before any await, like _admit_ai (review #11)
        if (not r.ai_room_limiter.allow(route.room_id) or not r.ai_user_limiter.allow(str(route.asker_id))
                or not await r.consume("room_ai_global", GLOBAL, r.limits.ai_global_daily)):
            r.hub.ai_leave(route.room_id)
            await tell(event("notice", code="ai_quota"))
            return False
        return True

    async def release(self, route: AgentRoute) -> None:
        """The question was never stored: give back the queue slot and the quota."""
        r = self.rooms()
        r.hub.ai_leave(route.room_id)
        await r.refund("room_ai_global", GLOBAL)

    async def answer(self, route: AgentRoute, seq: int, message_id: str) -> None:
        """Hub task: one turn under the room's AI lock, then at most one hand-off."""
        r = self.rooms()
        done = None
        try:
            async with r.hub.ai_lock(route.room_id):
                done = await self._turn(r, route, seq, message_id)
        finally:
            r.hub.ai_leave(route.room_id)
        if done is not None and route.depth < HANDOFF_DEPTH:
            await self._handoff(route, *done)

    async def _turn(self, r: "ConnDeps", route: AgentRoute, seq: int, message_id: str) -> tuple[int, str, str] | None:
        if route.depth == 0:  # a hand-off continues a delivered answer: no typing / failure frames under it
            await r.hub.broadcast(route.room_id, event("ai_typing", reply_to=seq))
        turn_id = self.deps.new_id()
        parts: list[str] = []
        trace = None
        failure: str | None = None
        note: str | None = None
        try:
            prefs = await self.deps.prefs(route.asker_id)
            # A hand-off sees the answer it continues (seq = that answer); a direct ask excludes its own question.
            rows = await r.store.agent_context(route.room_id, AGENT_CONTEXT,
                                               before_seq=seq if route.depth == 0 else seq + 1)
            others = [p.name for p in route.personas if p.id != route.persona.id]
            req = TurnRequest(user_id=route.asker_id, persona=route.persona, conversation_id=None,
                              room_id=route.room_id, text=self._input(route), history=_history(rows, route.persona.id),
                              mode="chat", tutor_session_id=None, client_turn_id=turn_id, in_room=True)
            # The persona is its OWNER's text: another member's persona (and any hand-off target) must never receive
            # the asker's private sources or memory, whatever its prompt says (ROOM_RULES is only a prompt).
            mine = route.depth == 0 and (route.persona.builtin or route.persona.owner_id == route.asker_id)
            deps = self.deps.turn_deps(allow_private=prefs.share_in_rooms and mine,
                                       memory=prefs.memory_enabled and mine,
                                       modes={"chat": RoomChatMode(route.asker_name, others)})
            metering.bind_user(route.asker_id)  # the asker pays (admin usage), like @ai
            with metering.feature_scope("rooms"):
                async with r.ai_gate:
                    async with asyncio.timeout(self.deps.turn_timeout):
                        async with aclosing(self.deps.run_turn(deps, req)) as events:
                            async for ev in events:
                                if isinstance(ev, Delta):
                                    parts.append(ev.text)
                                elif isinstance(ev, (Step, Thought)):
                                    if prefs.show_process:
                                        await self._private(route, turn_id, seq, ev)
                                elif isinstance(ev, Done):
                                    trace = ev.trace
                                    note = ev.note_zh  # resolved by the orchestrator (setting, <<ZH>>, fallback)
                                elif isinstance(ev, Error):
                                    failure = ev.code
                                    break
        except asyncio.CancelledError:
            raise
        except Exception as e:  # LlmUnavailable, TimeoutError, anything unexpected: the question must not stay pending
            failure = "timeout" if isinstance(e, TimeoutError) else (getattr(e, "kind", None) or type(e).__name__)
        text = _clean(parts)
        if failure is not None or not text:
            code = FAIL_CODES.get(failure or "", "upstream")
            logger.info("room agent turn failed code=%s kind=%s depth=%d", code, failure or "empty", route.depth)
            await r.refund("room_ai_global", GLOBAL)
            if route.depth > 0:  # `message_id` is the first agent's already delivered answer: it stays "done"
                await r.store.set_ai_status(message_id, "done")
                return None
            await r.store.set_ai_status(message_id, "failed")
            await r.hub.broadcast(route.room_id, event("ai_failed", reply_to=seq, code=code))
            return None
        meta = {"agent": agent_config.agent_meta(route.persona), "asker": {"id": route.asker_id, "name": route.asker_name}}
        if note:
            meta["note_zh"] = note  # spec addressing §5.2: never part of the public text, never read aloud
        if route.handoff_from is not None:
            meta["handoff_from"] = agent_config.agent_meta(route.handoff_from)
        private = None
        async with r.hub.lock(route.room_id):
            answer = await r.store.append(route.room_id, lane="public", sender_kind="ai", sender_id=None,
                                          kind="ai_answer", text=text, now=r.clock(), reply_to=seq, meta=meta)
            if trace:
                private = await r.store.append(route.room_id, lane="private", audience_id=route.asker_id,
                                               sender_kind="ai", sender_id=None, kind="agent_trace", text="",
                                               now=r.clock(), reply_to=answer.seq,
                                               meta={"turn_id": turn_id, "trace": trace})
        await r.store.set_ai_status(message_id, "done")
        await r.hub.broadcast(route.room_id, event("message", message=message_out(answer, None)))
        if private is not None:
            await r.hub.broadcast(route.room_id, event("message", message=message_out(private, None)),
                                  only_user=route.asker_id)
        return answer.seq, answer.id, text

    @staticmethod
    def _input(route: AgentRoute) -> str:
        if route.handoff_from is None:
            return f"{route.asker_name}: {route.question}"
        return f"{route.asker_name}: {route.question}\n({_plain(route.handoff_from.name)} handed this question to you.)"

    async def _private(self, route: AgentRoute, turn_id: str, seq: int, ev) -> None:
        data = dict(ev.to_dict())
        data.pop("type", None)
        frame = (event("agent_step", turn_id=turn_id, reply_to=seq, step=data) if isinstance(ev, Step)
                 else event("agent_thought", turn_id=turn_id, reply_to=seq, thought=data))
        await self.rooms().hub.broadcast(route.room_id, frame, only_user=route.asker_id)

    async def _handoff(self, route: AgentRoute, answer_seq: int, answer_id: str, text: str) -> None:
        names = [p.name for p in route.personas]
        current = next(i for i, p in enumerate(route.personas) if p.id == route.persona.id)
        index = find_handoff(text, names, current)
        if index is None:
            return
        target = route.personas[index]
        if not self.deps.feature_on() or getattr(target, "disabled", False):
            return
        nxt = AgentRoute(route.room_id, route.asker_id, route.asker_name, target, route.personas, route.question,
                         depth=route.depth + 1, handoff_from=route.persona, via="handoff")
        r = self.rooms()

        async def tell(frame: dict) -> None:
            await r.hub.broadcast(route.room_id, frame, only_user=route.asker_id)

        if not await self._reserve(nxt, tell):
            return
        await r.store.set_ai_status(answer_id, "pending")
        r.hub.spawn(self.answer(nxt, answer_seq, answer_id))

    # ---- room tutor hooks (lane T installs `self.tutor`) ----

    async def on_member_message(self, conn: "RoomConnection", message) -> None:
        if self.tutor is not None:
            await self.tutor.on_message(conn.room_id, message)

    async def on_welcome(self, conn: "RoomConnection") -> None:
        if self.tutor is not None:
            await self.tutor.on_welcome(conn)
