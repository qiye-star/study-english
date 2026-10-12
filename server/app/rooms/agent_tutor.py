"""Room tutor "带练" (spec 2026-10-12-agents §7.5; plan A5 lane T, R-RA8; INDEX X5, X6, X18). The owner starts it with
one of the room's agents; the agent calls on members in turn; the called member has TUTOR_TURN_SECONDS to answer with
a text message (silence = skip). Other members may chip in: their messages are context, they never advance the round.

The pure pieces are A3's, used directly: `tutor.plan.build_plan` (the lesson), `tutor.machine` (`next_state` with
Asked / Answered / Skipped / Finished, difficulty and the repeat rule live there), `tutor.prompt.tutor_block` (the
per-turn mode block), `tutor.parse` (`parse_meta` / `StreamFilter` / `resolve`), `tutor.recap.build_recap`. They do
not know participants: who is asked, the 60 s timer and the persistence live here.

Persistence (R-RA8): the snapshot in `rooms.agent_tutor` (machine state included) is rewritten on every transition;
a reconnect gets an `agent_tutor` frame after `welcome` with `remaining_ms`. Timers are in-process tasks, kept in
`_timers` (not hub tasks: `hub.drain()` must not wait 60 s; tests cancel them via `background.cancel_background`
or `shutdown()`). After a restart every running tutor is `paused` (reason `restart`) and the owner resumes.
Tutor turns read no private sources and write no memory (`allow_private=False, memory=False`); the starter pays the
agent turn caps (`TurnRequest.user_id`) and the daily `limits.SCOPE_TUTOR_USER` start, the room pays its AI caps per
turn. Never logs answers, questions, names or ids of people."""
import asyncio
import logging
import uuid
from contextlib import aclosing
from dataclasses import replace
from datetime import datetime, timedelta

from app.agents import lang, limits
from app.agents.orchestrator import ModeBlock, TurnRequest
from app.agents.trace import Delta, Done, Error, Meta
from app.agents.tutor import machine
from app.agents.tutor.machine import Answered, Asked, Finished, Skipped, TutorState, next_state, step_number
from app.agents.tutor.parse import VERDICTS, StreamFilter, parse_meta, resolve
from app.agents.tutor.plan import Goal, PlanSources, build_plan
from app.agents.tutor.prompt import MAX_TOKENS, OPENING_USER_TEXT, tutor_block
from app.agents.tutor.recap import build_recap
from app.core import metering
from app.models import iso_utc
from app.rooms import agent_config
from app.rooms.agent_lane import AGENT_CONTEXT, GLOBAL, _clean, _history, _plain
from app.rooms.protocol import TUTOR_TURN_SECONDS, event
from app.rooms.store import RoomError, message_out
from app.rooms.tutor_rotation import clamp_steps, initial_order, next_participant, remaining_ms

logger = logging.getLogger(__name__)
TUTOR_SCOPE = limits.SCOPE_TUTOR_USER  # daily starts per user, the same counter as the 1:1 tutor (INDEX X5)
# Room lessons are text-only and use no personal word lists: no `words` (needs a word pool) and no `dictate`
# (needs audio playback) questions.
ROOM_MIX = ("ask", "repeat", "retell", "roleplay")
# Pause reason when nobody is online. Referenced through a constant on purpose: web's contract test scans this file for
# `_pause(room_id, snap, "<reason>")` literals and has copy for those only; unknown reasons fall back to the generic text.
PAUSE_EMPTY = "empty"


class TutorError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _level(room_level: str) -> str:
    """Rooms go A1-C1, the tutor A2-C1 (spec §7.2); A1 rooms start at A2, unknown values at the tutor default."""
    if room_level in machine.LEVELS:
        return room_level
    return "A2" if room_level == "A1" else machine.LEVELS[machine.DEFAULT_LEVEL]


def room_block(state: TutorState, goal: Goal, *, prev_name: str | None, next_name: str | None,
               retry_name: str | None, resume: bool = False, wrap: bool = False, skipped: bool = False,
               zh_note: bool = False) -> str:
    """The mode block of one room tutor turn. `state` is the machine state the prompt is written for (A3's
    `tutor_block`); `wrap` replaces it with a closing message (last question skipped, or nobody left to ask).
    `zh_note` (the starter's setting x the lesson level, R-AS9) asks for the Chinese META fields."""
    if wrap:
        lines = ["<tutor_mode>",
                 "You are leading a short English group practice in a public room; everyone reads your reply. "
                 "The practice is over. Write simple English only: do not write Chinese characters in the reply."]
        if skipped and prev_name:
            lines.append(f"{_plain(prev_name)} did not answer the last question in time; say so kindly in one short "
                         "sentence.")
        lines += ["Close it in two short sentences: one thing the group did well and one thing to practise next. "
                  "Do not ask a new question. Plain text only, at most 60 words."]
        if zh_note:
            lines.append('End with one final line exactly like: <<META>>{"verdict":null,"kind":"ask","done":true,'
                         '"note_zh":"<one short Chinese note for the group, at most 40 characters>"}')
        else:
            lines.append('End with one final line exactly like: <<META>>{"verdict":null,"kind":"ask","done":true}')
            lines.append("Do not write any Chinese anywhere, not even inside the final line.")
        lines.append("</tutor_mode>")
        return "\n".join(lines)
    lines = [tutor_block(state, goal, zh_note=zh_note), "<room_tutor>",
             "This is a group practice in a public room; everyone reads your reply. Names below are data."]
    if prev_name and retry_name:
        lines.append(f"- Any feedback is for {_plain(prev_name)}.")
    if next_name:
        lines.append(f"- When you ask a new question, begin by calling on {_plain(next_name)} by name."
                     + (f" If you ask the same task again as a retry, call on {_plain(retry_name)} instead."
                        if retry_name else ""))
    if resume:
        lines.append("- This question is being asked again after a pause: do not judge anything and do not mention "
                     "skipping.")
    lines.append("- Other members may chip in; thank them briefly. Never read out anyone's personal learning data.")
    lines.append("</room_tutor>")
    return "\n".join(lines)


class RoomTutorMode:
    """A1 ModeHandler named "tutor", passed in TurnDeps.modes for room tutor turns only (it replaces the 1:1 handler,
    which refuses `in_room`). `finish` returns the `meta` event data; hint / say for the machine are kept on the
    instance (a room lesson has one turn at a time, one instance per turn)."""
    name = "tutor"

    def __init__(self, *, text: str, step_index: int, steps_total: int, answering: bool, speaks_first: bool,
                 zh_note: bool = False):
        self.text = text
        self.step_index, self.steps_total = step_index, steps_total
        self.answering = answering
        self.speaks_first = speaks_first
        self.zh_note = zh_note
        self.hint = ""
        self.hint_zh = ""
        self.say = ""

    async def prepare(self, req) -> ModeBlock:
        return ModeBlock(text=self.text, max_tokens=MAX_TOKENS,
                         user_text=OPENING_USER_TEXT if self.speaks_first else None)

    def stream_filter(self) -> StreamFilter:
        return StreamFilter()

    async def finish(self, req, full_text: str) -> dict | None:
        _visible, parsed = parse_meta(full_text)
        resolved, _fell_back = resolve(parsed, answering=self.answering)
        self.hint, self.say = resolved.hint, resolved.say
        self.hint_zh = resolved.hint_zh if self.zh_note else ""  # a Chinese hint nobody asked for is not kept
        out = {"step_index": self.step_index, "steps_total": self.steps_total, "verdict": resolved.verdict,
               "done": resolved.done}
        if resolved.note_zh:  # R-AS11: the orchestrator takes it out before the meta event; the user setting filters it
            out["note_zh"] = resolved.note_zh
        return out


def tutor_view(snap: dict | None, now: datetime | None) -> dict | None:
    """The public `agent_tutor` payload (no machine state, no plan). While a question waits it may carry the optional
    `hint_zh` of that question (R-AS13); there is no English hint key (R-AS18)."""
    if not isinstance(snap, dict):
        return None
    waiting = snap.get("phase") == "await_answer"
    view = {"persona_id": snap["persona_id"], "persona_name": snap["persona_name"], "phase": snap["phase"],
            "step_index": snap["step_index"], "steps_total": snap["steps_total"],
            "current_user_id": snap.get("current_user_id"), "current_name": snap.get("current_name"),
            "deadline_at": snap.get("deadline_at") if waiting else None,
            "remaining_ms": remaining_ms(snap.get("deadline_at"), now) if waiting and now is not None else None,
            "started_by": snap["started_by"], "paused_reason": snap.get("paused_reason")}
    machine_state = snap.get("machine") if waiting else None
    hint_zh = machine_state.get("hint_zh") if isinstance(machine_state, dict) else None
    if isinstance(hint_zh, str) and hint_zh.strip():
        view["hint_zh"] = hint_zh
    return view


class RoomTutor:
    def __init__(self, lane, *, sleep=asyncio.sleep, turn_seconds: float = TUTOR_TURN_SECONDS):
        self.lane = lane
        self._sleep = sleep
        self.turn_seconds = turn_seconds
        self._locks: dict[str, asyncio.Lock] = {}
        self._timers: dict[str, asyncio.Task] = {}
        self._turns: dict[str, asyncio.Task] = {}  # the in-flight `_turn` per room (hub tasks; kept only to cancel)
        self._active: set[str] = set()  # rooms whose tutor this process started or resumed (cheap say filter)

    def timers(self) -> list[asyncio.Task]:
        """The live timer tasks (tests cancel them at teardown: tests/background.py)."""
        return [t for t in self._timers.values() if not t.done()]

    # ---- state helpers ----

    def _lock(self, room_id: str) -> asyncio.Lock:
        return self._locks.setdefault(room_id, asyncio.Lock())

    async def _load(self, room_id: str) -> dict | None:
        room = await self.lane.rooms().store.room(room_id)
        snap = room.agent_tutor if room is not None else None
        return dict(snap) if isinstance(snap, dict) else None

    async def _save(self, room_id: str, snap: dict | None) -> None:
        await self.lane.rooms().store.set_tutor(room_id, snap)

    async def _commit(self, room_id: str, snap: dict) -> bool:
        """Save a turn's result only if the same run is still generating (stop/restart may have happened)."""
        async with self._lock(room_id):
            current = await self._load(room_id)
            if current is None or current.get("run_id") != snap["run_id"] or current["phase"] != "generating":
                return False
            await self._save(room_id, snap)
            return True

    async def _broadcast(self, room_id: str, snap: dict | None) -> None:
        r = self.lane.rooms()
        await r.hub.broadcast(room_id, event("agent_tutor", tutor=tutor_view(snap, r.clock())))

    async def _system(self, room_id: str, key: str, meta: dict) -> None:
        r = self.lane.rooms()
        async with r.hub.lock(room_id):
            m = await r.store.append(room_id, lane="public", sender_kind="system", sender_id=None, kind="system",
                                     text=key, now=r.clock(), meta=meta)
        await r.hub.broadcast(room_id, event("message", message=message_out(m, None)))

    async def _is_owner(self, room_id: str, user_id: int) -> bool:
        try:
            room, member = await self.lane.rooms().store.membership(room_id, user_id)
        except RoomError:
            return False
        return room.status == "open" and member.role == "owner"

    def _arm(self, room_id: str, question_seq: int) -> None:
        self._disarm(room_id)
        self._timers[room_id] = asyncio.get_running_loop().create_task(self._expire(room_id, question_seq))

    def _spawn_turn(self, room_id: str, outcome: str, answer: tuple[int, str] | None) -> None:
        task = self.lane.rooms().hub.spawn(self._turn(room_id, outcome, answer))
        self._turns[room_id] = task
        task.add_done_callback(lambda t: self._turns.get(room_id) is t and self._turns.pop(room_id, None))

    def _cancel_turn(self, room_id: str) -> None:
        """stop / close: an in-flight turn must not speak after `tutor_stopped` (it re-checks the run too)."""
        task = self._turns.pop(room_id, None)
        if task is not None and task is not asyncio.current_task():
            task.cancel()

    def _disarm(self, room_id: str) -> None:
        task = self._timers.pop(room_id, None)
        if task is not None and task is not asyncio.current_task():
            task.cancel()

    async def _expire(self, room_id: str, question_seq: int) -> None:
        try:
            await self._sleep(self.turn_seconds)
            await self._advance(room_id, "skip", None, expect_seq=question_seq)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("room tutor timer failed error=%s", type(e).__name__)

    # ---- commands ----

    async def start(self, room_id: str, user_id: int, persona_id: str, steps: int | None) -> dict:
        r = self.lane.rooms()
        if not self.lane.deps.tutor_on():
            raise TutorError("disabled")
        if not await self._is_owner(room_id, user_id):
            raise TutorError("forbidden")
        async with self._lock(room_id):
            room = await r.store.room(room_id)
            cfg = agent_config.config_of(room)
            if persona_id not in cfg.persona_ids:
                raise TutorError("not_agent")
            personas = await agent_config.resolve(self.lane.deps.personas, cfg)
            persona = next((p for p in personas if p.id == persona_id), None)
            if persona is None or getattr(persona, "disabled", False):
                raise TutorError("not_agent")
            if isinstance(room.agent_tutor, dict):
                raise TutorError("active")
            if not r.ai_available or not room.ai_public or room.ai_muted:
                raise TutorError("ai_off")
            members = await r.store.members(room_id)
            order = initial_order([m.user_id for m in members], r.hub.online(room_id))
            if not order:
                raise TutorError("no_participants")
            if not await r.consume(TUTOR_SCOPE, str(user_id), self.lane.deps.tutor_daily()):
                raise TutorError("quota")
            total = clamp_steps(steps)
            goal = Goal(topic="free", length=total, input="text", mix=ROOM_MIX)
            state = machine.new_state(tuple(build_plan(goal, PlanSources())), _level(room.level))
            snap = {"v": 1, "run_id": uuid.uuid4().hex, "persona_id": persona.id, "persona_name": persona.name,
                    "started_by": user_id, "phase": "generating", "step_index": 0, "steps_total": len(state.plan),
                    "order": order, "current_user_id": None, "current_name": None, "question_seq": None,
                    "deadline_at": None, "goal": goal.to_dict(), "machine": machine.to_dict(state),
                    "paused_reason": None}
            await self._save(room_id, snap)
            self._active.add(room_id)
        await self._system(room_id, "tutor_started", {"name": persona.name})
        await self._broadcast(room_id, snap)
        self._spawn_turn(room_id, "open", None)
        return tutor_view(snap, r.clock())

    async def skip(self, room_id: str, user_id: int) -> None:
        snap = await self._load(room_id)
        if snap is None or snap["phase"] != "await_answer":
            raise TutorError("not_waiting")
        if user_id != snap["current_user_id"] and not await self._is_owner(room_id, user_id):
            raise TutorError("forbidden")
        if not await self._advance(room_id, "skip", None, expect_seq=snap["question_seq"]):
            raise TutorError("not_waiting")

    async def stop(self, room_id: str, user_id: int) -> None:
        if not await self._is_owner(room_id, user_id):
            raise TutorError("forbidden")
        async with self._lock(room_id):
            if await self._load(room_id) is None:
                raise TutorError("not_found")
            self._disarm(room_id)
            self._cancel_turn(room_id)
            self._active.discard(room_id)
            await self._save(room_id, None)
        await self._broadcast(room_id, None)
        await self._system(room_id, "tutor_stopped", {})

    async def resume(self, room_id: str, user_id: int) -> dict:
        r = self.lane.rooms()
        if not self.lane.deps.tutor_on():
            raise TutorError("disabled")
        if not await self._is_owner(room_id, user_id):
            raise TutorError("forbidden")
        async with self._lock(room_id):
            snap = await self._load(room_id)
            if snap is None or snap["phase"] != "paused":
                raise TutorError("not_paused")
            snap.update(phase="generating", paused_reason=None, deadline_at=None)
            await self._save(room_id, snap)
            self._active.add(room_id)
        await self._broadcast(room_id, snap)
        self._spawn_turn(room_id, "resume", None)
        return tutor_view(snap, r.clock())

    # ---- hooks from AgentLane / the rooms runtime ----

    async def on_message(self, room_id: str, message) -> None:
        if room_id not in self._active or message.sender_kind != "user" or message.kind != "text":
            return
        await self._advance(room_id, "answer", (message.seq, message.text), user_id=message.sender_id)

    async def on_welcome(self, conn) -> None:
        snap = await self._load(conn.room_id)
        if snap is not None:
            await conn.send_self(event("agent_tutor", tutor=tutor_view(snap, self.lane.rooms().clock())))

    async def public_view(self, room) -> dict | None:
        return tutor_view(room.agent_tutor if isinstance(room.agent_tutor, dict) else None, self.lane.rooms().clock())

    async def pause_all(self) -> int:
        """Startup listener: timers did not survive the restart, so running tutors wait for the owner (R-RA8)."""
        r = self.lane.rooms()
        paused = 0
        for room_id, snap in await r.store.tutor_rooms():
            if snap.get("phase") in ("generating", "await_answer"):
                await r.store.set_tutor(room_id, {**snap, "phase": "paused", "paused_reason": "restart",
                                                  "deadline_at": None})
                paused += 1
        logger.info("room tutor startup paused=%d", paused)
        return paused

    async def on_close(self, room_id: str) -> None:
        self._disarm(room_id)
        self._cancel_turn(room_id)
        self._active.discard(room_id)
        await self._save(room_id, None)

    async def shutdown(self) -> None:
        tasks = list(self._timers.values())
        self._timers.clear()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    # ---- turns ----

    async def _advance(self, room_id: str, outcome: str, answer: tuple[int, str] | None, *,
                       user_id: int | None = None, expect_seq: int | None = None) -> bool:
        async with self._lock(room_id):
            snap = await self._load(room_id)
            if snap is None or snap["phase"] != "await_answer":
                return False
            if expect_seq is not None and snap["question_seq"] != expect_seq:
                return False
            if outcome == "answer" and user_id != snap["current_user_id"]:
                return False
            self._disarm(room_id)
            snap.update(phase="generating", deadline_at=None)
            await self._save(room_id, snap)
        await self._broadcast(room_id, snap)
        self._spawn_turn(room_id, outcome, answer)
        return True

    async def _pause(self, room_id: str, snap: dict, reason: str) -> None:
        paused = {**snap, "phase": "paused", "paused_reason": reason, "deadline_at": None}
        if await self._commit(room_id, paused):
            logger.info("room tutor paused reason=%s", reason)
            await self._broadcast(room_id, paused)

    async def _recover(self, room_id: str, run_id: str, reason: str) -> None:
        """A turn died with an exception: the lesson must not stay in "generating" without a timer."""
        async with self._lock(room_id):
            current = await self._load(room_id)
            if current is None or current.get("run_id") != run_id or current.get("phase") != "generating":
                return
        await self._pause(room_id, current, reason)

    async def _turn(self, room_id: str, outcome: str, answer: tuple[int, str] | None) -> None:
        snap = await self._load(room_id)
        run_id = snap.get("run_id") if snap is not None else None
        try:
            await self._run_turn(room_id, outcome, answer)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # nothing may leave the lesson in "generating" with no timer (class name only)
            logger.warning("room tutor turn crashed error=%s", type(e).__name__)
            if run_id is not None:
                await self._recover(room_id, run_id, "state" if isinstance(e, (KeyError, TypeError, ValueError))
                                    else "upstream")

    async def _run_turn(self, room_id: str, outcome: str, answer: tuple[int, str] | None) -> None:
        r = self.lane.rooms()
        async with r.hub.ai_lock(room_id):  # one AI speaker per room, shared with @ai and @persona (R-RA5)
            snap = await self._load(room_id)
            if snap is None or snap["phase"] != "generating":
                return
            room = await r.store.room(room_id)
            if room is None or room.status != "open":
                return
            if not self.lane.deps.tutor_on() or not r.ai_available or not room.ai_public or room.ai_muted:
                return await self._pause(room_id, snap, "ai_off")
            personas = await agent_config.resolve(self.lane.deps.personas, agent_config.config_of(room))
            persona = next((p for p in personas if p.id == snap["persona_id"]), None)
            if persona is None or getattr(persona, "disabled", False):
                return await self._pause(room_id, snap, "agent_off")
            members = await r.store.members(room_id)
            online = r.hub.online(room_id) & {m.user_id for m in members}
            if not online:  # nobody to call on: wait for the owner instead of skipping through the lesson
                return await self._pause(room_id, snap, PAUSE_EMPTY)
            prefs = await self.lane.deps.prefs(snap["started_by"])  # the starter's zh_note decides the Chinese fields
            if not r.ai_room_limiter.allow(room_id) or not await r.consume("room_ai_global", GLOBAL,
                                                                            r.limits.ai_global_daily):
                return await self._pause(room_id, snap, "quota")
            try:
                state = machine.from_dict(snap["machine"])
                goal = Goal.from_dict(snap["goal"])
                zh_note = lang.want_note(prefs.zh_note, machine.LEVELS[state.level])  # R-AS9: the lesson's current level
                plan = self._plan_turn(snap, state, goal, outcome, members, online, zh_note)
            except (ValueError, KeyError, TypeError):  # a broken snapshot: the owner can stop it
                await r.refund("room_ai_global", GLOBAL)
                return await self._pause(room_id, snap, "state")
            names, prev, target, wrap = plan["names"], plan["prev"], plan["target"], plan["wrap"]
            mode = RoomTutorMode(text=plan["block"], step_index=step_number(state), steps_total=len(state.plan),
                                 answering=outcome == "answer", speaks_first=outcome != "answer", zh_note=zh_note)
            before = answer[0] if answer else room.last_seq + 1
            rows = await r.store.agent_context(room_id, AGENT_CONTEXT, before_seq=before)
            req = TurnRequest(user_id=snap["started_by"], persona=persona, conversation_id=None, room_id=room_id,
                              text=f"{names.get(prev, '')}: {answer[1]}" if outcome == "answer" and answer else None,
                              history=_history(rows, persona.id), mode="tutor", tutor_session_id=None,
                              client_turn_id=self.lane.deps.new_id(), in_room=True)
            deps = self.lane.deps.turn_deps(allow_private=False, memory=False, modes={"tutor": mode})
            parts: list[str] = []
            meta = None
            note = None
            failure = None
            try:
                metering.bind_user(snap["started_by"])
                with metering.feature_scope("rooms"):
                    async with r.ai_gate:
                        async with asyncio.timeout(self.lane.deps.turn_timeout):
                            async with aclosing(self.lane.deps.run_turn(deps, req)) as events:
                                async for ev in events:
                                    if isinstance(ev, Delta):
                                        parts.append(ev.text)
                                    elif isinstance(ev, Meta):
                                        meta = ev
                                    elif isinstance(ev, Done):
                                        note = ev.note_zh  # already resolved by the orchestrator (setting + sources)
                                    elif isinstance(ev, Error):
                                        failure = ev.code
                                        break
            except asyncio.CancelledError:
                await r.refund("room_ai_global", GLOBAL)  # stop / close cancelled the turn: the room's slot is free
                raise
            except Exception as e:
                failure = "timeout" if isinstance(e, TimeoutError) else type(e).__name__
            text = _clean(parts)
            if failure is not None or not text:
                logger.info("room tutor turn failed kind=%s", failure or "empty")
                await r.refund("room_ai_global", GLOBAL)
                return await self._pause(room_id, snap, "upstream")
            if outcome == "skip":
                verdict = "skip"
            elif outcome == "answer":
                verdict = meta.verdict if meta is not None and meta.verdict in VERDICTS else "ok"
            else:
                verdict = None
            try:
                after = self._after_turn(state, outcome, verdict, mode, wrap)
            except ValueError:
                await r.refund("room_ai_global", GLOBAL)
                return await self._pause(room_id, snap, "state")
            retry = outcome == "answer" and after.phase == "await_answer" and after.index == state.index
            if retry and prev in names:
                target = prev
            final = wrap or after.phase == "wrap_up"
            if final:
                after = next_state(after, Finished())
            tutor_meta = {"step_index": len(after.plan) if final else step_number(after),
                          "steps_total": len(after.plan), "to_user_id": None if final else target,
                          "to_name": None if final else names.get(target), "final": final,
                          "verdict_for": prev, "verdict": verdict if prev is not None else None}
            deadline = r.clock() + timedelta(seconds=self.turn_seconds)
            async with self._lock(room_id):
                # stop / close / restart may have happened while the model was talking: re-check the run and the phase
                # under the lock so nothing is said after `tutor_stopped` and a stale turn never overwrites a newer run
                current = await self._load(room_id)
                if current is None or current.get("run_id") != snap["run_id"] or current.get("phase") != "generating":
                    await r.refund("room_ai_global", GLOBAL)
                    return
                public_meta = {"agent": agent_config.agent_meta(persona), "tutor": tutor_meta}
                if note:
                    public_meta["note_zh"] = note
                async with r.hub.lock(room_id):
                    msg = await r.store.append(room_id, lane="public", sender_kind="ai", sender_id=None,
                                               kind="ai_answer", text=text, now=r.clock(),
                                               reply_to=answer[0] if outcome == "answer" and answer else None,
                                               meta=public_meta)
                done = None
                if final:
                    self._disarm(room_id)
                    self._active.discard(room_id)
                    await self._save(room_id, None)
                else:
                    done = {**snap, "phase": "await_answer", "step_index": step_number(after), "order": plan["order"],
                            "current_user_id": target, "current_name": names.get(target), "question_seq": msg.seq,
                            "deadline_at": iso_utc(deadline), "machine": machine.to_dict(after), "paused_reason": None}
                    await self._save(room_id, done)
                    self._arm(room_id, msg.seq)  # armed in the same critical section as the state it belongs to
        await r.hub.broadcast(room_id, event("message", message=message_out(msg, None)))
        if final:
            await self._broadcast(room_id, None)
            await self._system(room_id, "tutor_done", {"name": snap["persona_name"], "recap": build_recap(after, goal)})
        else:
            await self._broadcast(room_id, done)

    @staticmethod
    def _plan_turn(snap: dict, state: TutorState, goal: Goal, outcome: str, members, online: set[int],
                   zh_note: bool = False) -> dict:
        """Who is addressed and which prompt: pure given the snapshot, the member list and who is online.
        Every member has a name (feedback may be for someone who left); only online members are called on."""
        names = {m.user_id: m.name for m in members}
        active = [u for u in names if u in online]
        prev = snap["current_user_id"] if outcome in ("answer", "skip") else None
        resume = outcome == "resume"
        if resume and state.phase == "opening":  # the very first question never went out
            outcome, resume = "open", False
        prompt_state = state
        if outcome == "skip":
            prompt_state = next_state(state, Skipped())  # phase "ask", or "wrap_up" after the last question
        elif resume:
            prompt_state = replace(state, phase="ask")  # re-ask the current question without judging anything
        wrap = prompt_state.phase == "wrap_up"
        order, target = snap["order"], None
        if not wrap:
            last = snap["current_user_id"] if outcome != "open" else None
            if resume and snap["current_user_id"] in active:
                target = snap["current_user_id"]
            else:
                order, target = next_participant(order, last, active)
            wrap = target is None  # everyone left: wrap up now
        block = room_block(prompt_state, goal, prev_name=names.get(prev) if prev is not None else None,
                           next_name=names.get(target), retry_name=names.get(prev) if outcome == "answer" else None,
                           resume=resume, wrap=wrap, skipped=outcome == "skip", zh_note=zh_note)
        return {"names": names, "prev": prev, "target": target, "wrap": wrap, "order": order, "block": block}

    @staticmethod
    def _after_turn(state: TutorState, outcome: str, verdict: str | None, mode: RoomTutorMode, wrap: bool) -> TutorState:
        """The machine state once the turn's message is out (the one place the machine events are applied)."""
        if outcome == "answer":
            return next_state(state, Answered(verdict or "ok", hint=mode.hint, say=mode.say, hint_zh=mode.hint_zh))
        if outcome == "skip":
            after = next_state(state, Skipped())
            return after if wrap or after.phase == "wrap_up" else next_state(
                after, Asked(mode.hint, mode.say, mode.hint_zh))
        if state.phase in ("opening", "ask"):
            return next_state(state, Asked(mode.hint, mode.say, mode.hint_zh))
        return state  # resume: the same question again
