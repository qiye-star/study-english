"""One room socket's message handling (spec 2026-10-09 §5.4–5.7, plan P-6). Upstreams and counters are
injected through ConnDeps. Never logs message text, drafts or AI output."""
import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Protocol

from app.core import metering
from app.core.ratelimit import RateLimiter
from app.rooms import assistant
from app.rooms.hub import Conn, Dropped, RoomHub
from app.rooms.protocol import (
    MAX_ASSIST_TEXT, PROTOCOL_VERSION, AssistMsg, HelloMsg, PingMsg, ProtocolError, ReactMsg, SayMsg, TypingMsg,
    VoiceRetryMsg, VoiceTranslateMsg, event, parse_client_message,
)
from app.rooms.rules import MAX_TEXT, RoomLimits, clean_text, mention
from app.rooms.scenarios import brief
from app.rooms.store import RoomStore, message_out, room_out, sender_avatar
from app.services.avatars import avatar_url

logger = logging.getLogger(__name__)
GLOBAL = "*"
ACTIVITY_REPEAT = 3.0  # seconds: the same state is re-broadcast at most this often (spec 2026-10-10 §6.5)


class VoiceHandler(Protocol):
    """Shared voice transcript translation and transcription retry (spec 2026-10-10 §4.4–4.5). Installed on
    `RoomsRuntime.voice` by `routers/rooms_voice.install` (lane SV); None = voice off (`notice voice_off`)."""

    async def on_translate(self, conn: "RoomConnection", seq: int) -> None: ...

    async def on_retry(self, conn: "RoomConnection", seq: int) -> None: ...


class AgentsHandler(Protocol):
    """Room agents (plan 2026-10-12-agents-rooms, addressing): `rooms.agent_lane.AgentLane`, installed on
    `RoomsRuntime.agents` by `routers/rooms_agents.install`. None = no agent code at all (rooms behave as plain chat;
    `@ai` and `say.to` then only give `notice agent_off`)."""

    async def route(self, conn: "RoomConnection", text: str, reply_to: int | None, to: str | None) -> Any | None: ...

    async def release(self, route: Any) -> None: ...

    async def answer(self, route: Any, seq: int, message_id: str) -> None: ...

    async def on_member_message(self, conn: "RoomConnection", message) -> None: ...

    async def on_welcome(self, conn: "RoomConnection") -> None: ...


@dataclass
class ConnDeps:
    store: RoomStore
    hub: RoomHub
    limits_of: Callable[[], RoomLimits]  # read per use: hot-reloaded limits reach live sockets (review m12)
    complete: Callable[[list[dict], int, float], Awaitable[str]]
    consume: Callable[[str, str, int], Awaitable[bool]]
    refund: Callable[[str, str], Awaitable[None]]
    clock: Callable[[], datetime]
    ai_gate: asyncio.Semaphore
    say_limiter: RateLimiter
    ai_room_limiter: RateLimiter
    ai_user_limiter: RateLimiter
    ai_available_of: Callable[[], bool]
    assist_limiter: RateLimiter | None = None  # per user; plus at most one assist in flight (hub.assist_inflight)
    # The user's daily assist cap (admin per-user quota override); None = limits.assist_daily for everyone
    assist_daily_for: Callable[[int], Awaitable[int]] | None = None
    # Published admin prompt templates (admin v2 G2); None per key = the built-in default. Cached, no DB read per call.
    templates: Callable[[], Awaitable[dict[str, str | None]]] | None = None
    # ---- rooms v2 (plan P2-1/P2-3) ----
    voice: VoiceHandler | None = None
    react_limiter: RateLimiter | None = None  # SC4: 30/minute per room:user
    clock_mono: Callable[[], float] = time.monotonic  # SC4: typing/activity throttling
    # ---- agents in rooms (plan 2026-10-12-agents-rooms) ----
    agents: AgentsHandler | None = None

    @property
    def limits(self) -> RoomLimits:
        return self.limits_of()

    @property
    def ai_available(self) -> bool:
        return self.ai_available_of()

    async def template(self, key: str) -> str | None:
        return (await self.templates()).get(key) if self.templates is not None else None


def members_out(members, online: set[int]) -> list[dict]:
    return [{"user_id": m.user_id, "name": m.name, "role": m.role, "online": m.user_id in online,
             "avatar_url": avatar_url(m.avatar_id)} for m in members]


class RoomConnection:
    def __init__(self, deps: ConnDeps, room_id: str, user_id: int, name: str, conn: Conn):
        self.deps, self.room_id, self.user_id, self.name, self.conn = deps, room_id, user_id, name, conn

    async def _send(self, data: dict) -> None:
        await self.deps.hub.send(self.room_id, self.conn, data)

    async def _to_me(self, data: dict) -> None:
        await self.deps.hub.broadcast(self.room_id, data, only_user=self.user_id)

    async def reply(self, data: dict) -> None:
        """Send to every connection of this user in this room (e.g. a voice_update only the requester needs)."""
        await self._to_me(data)

    async def send_self(self, data: dict) -> None:
        """Send to this connection only (e.g. an error for the frame it sent)."""
        await self._send(data)

    async def welcome(self, last_seq: int) -> None:
        d = self.deps
        room = await d.store.room(self.room_id)
        members = await d.store.members(self.room_id)
        online = d.hub.online(self.room_id)
        rows, truncated = await d.store.replay_out(self.room_id, self.user_id, last_seq, d.limits.replay_limit)
        history = await d.store.assist_history(self.room_id, self.user_id, d.limits.assist_history)
        role = next((m.role for m in members if m.user_id == self.user_id), "member")
        await self._send(event(
            "welcome", room=room_out(room, my_role=role, member_count=len(members), online_count=len(online)),
            me={"user_id": self.user_id, "role": role}, members=members_out(members, online),
            last_seq=room.last_seq, truncated=truncated,
            assist_history=[message_out(m, n, avatar_id=sender_avatar(m)) for m, n in history],
            protocol=PROTOCOL_VERSION, reactions=await d.store.recent_reactions(self.room_id),
            join_requests=await d.store.pending_requests(self.room_id) if role == "owner" else []))
        for message in rows:
            await self._send(event("message", message=message))
        if d.agents is not None:  # a running room tutor re-sends its state after the replay (R-RA8)
            await d.agents.on_welcome(self)

    async def handle(self, raw: str) -> None:
        if self.conn.dropped:  # the hub gave up on this socket (it stopped reading): end its receive loop
            raise Dropped("connection dropped")
        msg = parse_client_message(raw)
        if isinstance(msg, PingMsg):
            await self._send(event("pong"))
        elif isinstance(msg, HelloMsg):
            raise ProtocolError("duplicate hello")
        elif isinstance(msg, SayMsg):
            await self.on_say(msg)
        elif isinstance(msg, AssistMsg):
            await self.on_assist(msg)
        elif isinstance(msg, TypingMsg):
            await self.on_typing(msg)
        elif isinstance(msg, ReactMsg):
            await self.on_react(msg)
        elif isinstance(msg, (VoiceTranslateMsg, VoiceRetryMsg)):
            if self.deps.voice is None:
                await self._send(event("notice", code="voice_off"))
            elif isinstance(msg, VoiceTranslateMsg):
                await self.deps.voice.on_translate(self, msg.seq)
            else:
                await self.deps.voice.on_retry(self, msg.seq)

    async def on_typing(self, msg: TypingMsg) -> None:
        """Typing / recording / idle to the other members only; throttled per connection, never stored. A state is
        re-broadcast when it changes or after ACTIVITY_REPEAT seconds (spec 2026-10-10 §6.5)."""
        d = self.deps
        now = d.clock_mono()
        if not d.hub.activity_allow(self.conn, now, d.limits.typing_interval):
            return
        key = (self.room_id, self.user_id)
        last = d.hub.last_activity.get(key)
        if (last is None and msg.state == "idle") or (
                last is not None and last[0] == msg.state and now - last[1] < ACTIVITY_REPEAT):
            return
        d.hub.last_activity[key] = (msg.state, now)
        await d.hub.broadcast(self.room_id, event("activity", user_id=self.user_id, state=msg.state),
                              exclude_user=self.user_id)

    async def on_react(self, msg: ReactMsg) -> None:
        """Toggle one reaction; everyone gets the key's full user list (idempotent, spec 2026-10-10 §6.4)."""
        d = self.deps
        if d.react_limiter is not None and not d.react_limiter.allow(f"{self.room_id}:{self.user_id}"):
            await self._send(event("error", code="rate_limited"))
            return
        users = await d.store.toggle_reaction(self.room_id, msg.seq, self.user_id, msg.key, msg.on, d.clock())
        if users is None:
            await self._send(event("error", code="bad_seq"))
            return
        await d.hub.broadcast(self.room_id, event("reaction", seq=msg.seq, key=msg.key, user_ids=users))

    async def on_say(self, msg: SayMsg) -> None:
        d = self.deps
        now = d.clock()
        text = clean_text(msg.text, MAX_TEXT)
        if text is None:
            await self._send(event("error", code="empty"))
            return
        # A retried send (e.g. after a reconnect) gets its original ack even when the sender is rate limited.
        dup = await d.store.find_client(self.room_id, self.user_id, msg.client_id,
                                        now - timedelta(minutes=d.limits.dedupe_minutes))
        if dup is not None:
            await self._send(event("ack", client_id=msg.client_id, seq=dup.seq))
            return
        if not d.say_limiter.allow(f"{self.room_id}:{self.user_id}"):
            await self._send(event("error", code="rate_limited"))
            return
        quote = None
        if msg.reply_to is not None:  # a reply stores a snapshot of the quoted message (spec 2026-10-10 §6.4)
            quote = await d.store.quote_for(self.room_id, msg.reply_to)
            if quote is None:
                await self._send(event("error", code="bad_reply"))
                return
        if msg.assist_id is not None:  # each assist reply marks exactly one send as assisted
            async with d.hub.lock(self.room_id):
                claimed = await d.store.claim_assist(msg.assist_id, self.user_id, self.room_id)
            if not claimed:
                await self._send(event("error", code="bad_assist"))
                return
        route = None
        if d.agents is not None:  # `@ai` / `@name` / a reply to an agent / `to`: at most one turn per message (R-AS2)
            route = await d.agents.route(self, text, msg.reply_to, msg.to or None)
        elif msg.to or mention(text)[0]:  # no agent code at all: the message stays a plain one
            await self._send(event("notice", code="agent_off"))
        meta: dict = {}
        if quote:
            meta["quote"] = quote
        if route is not None and route.via == "to":  # R-AS19: only a `to` that actually routed leaves a trace
            meta["to_agent"] = route.persona.id
        try:
            async with d.hub.lock(self.room_id):
                m = await d.store.append(self.room_id, lane="public", sender_kind="user", sender_id=self.user_id,
                                         kind="text", text=text, now=now, assisted=msg.assist_id is not None,
                                         ai_status="pending" if route is not None else None,
                                         client_id=msg.client_id, reply_to=msg.reply_to, meta=meta or None)
        except BaseException:
            if route is not None:  # the question was never stored: release its queue slot and quota
                await d.agents.release(route)
            raise
        await self._send(event("ack", client_id=msg.client_id, seq=m.seq))
        await d.hub.broadcast(self.room_id, event("message", message=await d.store.out_one(m.id)))
        if route is not None:
            d.hub.spawn(d.agents.answer(route, m.seq, m.id))
        elif d.agents is not None:  # a room tutor may be waiting for this member's answer (R-RA8)
            await d.agents.on_member_message(self, m)

    async def on_assist(self, msg: AssistMsg) -> None:
        d = self.deps
        text = clean_text(msg.text, MAX_ASSIST_TEXT)
        if text is None:
            await self._send(event("error", code="empty"))
            return
        if not d.ai_available:
            await self._to_me(event("assist_failed", request_id=msg.request_id, code="upstream"))
            return
        room = await d.store.room(self.room_id)
        if room is not None and room.ai_muted:  # an admin turned AI off in this room: the tray request ends too
            await self._to_me(event("notice", code="ai_off"))
            await self._to_me(event("assist_failed", request_id=msg.request_id, code="upstream"))
            return
        uid = str(self.user_id)
        # Review #4: one assist in flight per user and a per-minute cap, so one user cannot flood the shared AI gate.
        if self.user_id in d.hub.assist_inflight or (d.assist_limiter is not None and not d.assist_limiter.allow(uid)):
            await self._to_me(event("assist_failed", request_id=msg.request_id, code="quota"))
            return
        d.hub.assist_inflight.add(self.user_id)
        spawned = False
        try:
            daily = d.limits.assist_daily if d.assist_daily_for is None else await d.assist_daily_for(self.user_id)
            if not await d.consume("room_assist", uid, daily):
                await self._to_me(event("assist_failed", request_id=msg.request_id, code="quota"))
                return
            if not await d.consume("room_ai_global", GLOBAL, d.limits.ai_global_daily):
                await d.refund("room_assist", uid)
                await self._to_me(event("assist_failed", request_id=msg.request_id, code="quota"))
                return
            async with d.hub.lock(self.room_id):
                await d.store.append(self.room_id, lane="private", audience_id=self.user_id, sender_kind="user",
                                     sender_id=self.user_id, kind="assist_request", text=text, now=d.clock())
            d.hub.spawn(self._assist(msg.request_id, text))
            spawned = True
        finally:
            if not spawned:
                d.hub.assist_inflight.discard(self.user_id)

    async def _assist(self, request_id: str, text: str) -> None:
        d = self.deps
        try:
            await self._assist_once(request_id, text)
        finally:
            d.hub.assist_inflight.discard(self.user_id)

    async def _assist_once(self, request_id: str, text: str) -> None:
        d = self.deps
        try:
            recent = await d.store.recent_public(self.room_id, assistant.ASSIST_CONTEXT)
            room = await d.store.room(self.room_id)  # the room's level and scenario, not the asker's rank
            template = await d.template("rooms.assist")
            messages = assistant.compose_messages(text, recent, room.level, template=template,
                                                  scenario=brief(room.scenario))
            metering.bind_user(self.user_id)
            with metering.feature_scope("rooms"):
                async with d.ai_gate:
                    raw = await d.complete(messages, assistant.ASSIST_MAX_TOKENS, assistant.ASSIST_TEMPERATURE)
            reply = assistant.parse_assist(raw)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # LlmUnavailable / AssistFormatError / unexpected: tell only the asker
            code = "format" if isinstance(e, assistant.AssistFormatError) else "upstream"
            logger.info("room assist failed code=%s kind=%s", code, getattr(e, "kind", type(e).__name__))
            if code == "upstream":  # a draft can force non-JSON output, so a format failure is not refunded
                await d.refund("room_assist", str(self.user_id))
                await d.refund("room_ai_global", GLOBAL)
            await self._to_me(event("assist_failed", request_id=request_id, code=code))
            return
        async with d.hub.lock(self.room_id):
            m = await d.store.append(self.room_id, lane="private", audience_id=self.user_id, sender_kind="ai",
                                     sender_id=None, kind="assist_reply", text=reply.reply_zh, now=d.clock(),
                                     meta=reply.meta())
        await self._to_me(event("assist_reply", request_id=request_id, message=message_out(m, None)))
