"""One room socket's message handling (spec 2026-10-09 §5.4–5.7, plan P-6). Upstreams and counters are
injected through ConnDeps. Never logs message text, drafts or AI output."""
import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol

from app.core.ratelimit import RateLimiter
from app.providers.llm import LlmUnavailable
from app.rooms import assistant
from app.rooms.hub import Conn, Dropped, RoomHub
from app.rooms.protocol import (
    MAX_ASSIST_TEXT, PROTOCOL_VERSION, AssistMsg, HelloMsg, PingMsg, ProtocolError, ReactMsg, SayMsg, TypingMsg,
    VoiceRetryMsg, VoiceTranslateMsg, event, parse_client_message,
)
from app.rooms.rules import MAX_TEXT, RoomLimits, clean_text, mention
from app.rooms.store import RoomStore, message_out, room_out

logger = logging.getLogger(__name__)
GLOBAL = "*"


class VoiceHandler(Protocol):
    """Shared voice transcript translation and transcription retry (spec 2026-10-10 §4.4–4.5). Installed on
    `RoomsRuntime.voice` by `routers/rooms_voice.install` (lane SV); None = voice off (`notice voice_off`)."""

    async def on_translate(self, conn: "RoomConnection", seq: int) -> None: ...

    async def on_retry(self, conn: "RoomConnection", seq: int) -> None: ...


@dataclass
class ConnDeps:
    store: RoomStore
    hub: RoomHub
    limits: RoomLimits
    complete: Callable[[list[dict], int, float], Awaitable[str]]
    consume: Callable[[str, str, int], Awaitable[bool]]
    refund: Callable[[str, str], Awaitable[None]]
    clock: Callable[[], datetime]
    ai_gate: asyncio.Semaphore
    say_limiter: RateLimiter
    ai_room_limiter: RateLimiter
    ai_user_limiter: RateLimiter
    ai_available: bool
    assist_limiter: RateLimiter | None = None  # per user; plus at most one assist in flight (hub.assist_inflight)
    # The user's daily assist cap (admin per-user quota override); None = limits.assist_daily for everyone
    assist_daily_for: Callable[[int], Awaitable[int]] | None = None
    # Published admin prompt templates (admin v2 G2); None per key = the built-in default. Cached, no DB read per call.
    templates: Callable[[], Awaitable[dict[str, str | None]]] | None = None
    # ---- rooms v2 (plan P2-1/P2-3) ----
    voice: VoiceHandler | None = None
    react_limiter: RateLimiter | None = None  # SC4: 30/minute per room:user
    clock_mono: Callable[[], float] = time.monotonic  # SC4: typing/activity throttling

    async def template(self, key: str) -> str | None:
        return (await self.templates()).get(key) if self.templates is not None else None


def members_out(members, online: set[int]) -> list[dict]:
    return [{"user_id": m.user_id, "name": m.name, "role": m.role, "online": m.user_id in online} for m in members]


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
            assist_history=[message_out(m, n) for m, n in history],
            protocol=PROTOCOL_VERSION, reactions=await d.store.recent_reactions(self.room_id),
            join_requests=await d.store.pending_requests(self.room_id) if role == "owner" else []))
        for message in rows:
            await self._send(event("message", message=message))

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
        """Plan P2-3: accepted and ignored until SC4 (activity broadcast to the others)."""

    async def on_react(self, msg: ReactMsg) -> None:
        """Plan P2-3: accepted and ignored until SC4 (toggle + reaction broadcast)."""

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
        if msg.assist_id is not None:  # each assist reply marks exactly one send as assisted
            async with d.hub.lock(self.room_id):
                claimed = await d.store.claim_assist(msg.assist_id, self.user_id, self.room_id)
            if not claimed:
                await self._send(event("error", code="bad_assist"))
                return
        is_ai, question = mention(text)
        ask = await self._admit_ai() if is_ai else False
        try:
            async with d.hub.lock(self.room_id):
                m = await d.store.append(self.room_id, lane="public", sender_kind="user", sender_id=self.user_id,
                                         kind="text", text=text, now=now, assisted=msg.assist_id is not None,
                                         ai_status="pending" if ask else None, client_id=msg.client_id)
        except BaseException:
            if ask:  # the question was never stored: release its queue slot and quota
                d.hub.ai_leave(self.room_id)
                await d.refund("room_ai_global", GLOBAL)
            raise
        await self._send(event("ack", client_id=msg.client_id, seq=m.seq))
        await d.hub.broadcast(self.room_id, event("message", message=await d.store.out_one(m.id)))
        if ask:
            d.hub.spawn(self._answer(m.seq, m.id, question))

    async def _admit_ai(self) -> bool:
        d = self.deps
        room = await d.store.room(self.room_id)
        if not d.ai_available or room is None or not room.ai_public or room.ai_muted:
            await self._send(event("notice", code="ai_off"))
            return False
        if d.hub.ai_pending(self.room_id) >= d.limits.ai_queue:
            await self._send(event("notice", code="ai_busy"))
            return False
        d.hub.ai_enter(self.room_id)  # reserve the slot before any await (review #11)
        if (not d.ai_room_limiter.allow(self.room_id) or not d.ai_user_limiter.allow(str(self.user_id))
                or not await d.consume("room_ai_global", GLOBAL, d.limits.ai_global_daily)):
            d.hub.ai_leave(self.room_id)
            await self._send(event("notice", code="ai_quota"))
            return False
        return True

    async def _answer(self, seq: int, message_id: str, question: str) -> None:
        d = self.deps
        try:
            async with d.hub.ai_lock(self.room_id):
                await d.hub.broadcast(self.room_id, event("ai_typing", reply_to=seq))
                room = await d.store.room(self.room_id)
                recent = await d.store.recent_public(self.room_id, assistant.ANSWER_CONTEXT)
                try:
                    template = await d.template("rooms.answer")
                    async with d.ai_gate:
                        raw = await d.complete(assistant.answer_messages(room.topic, recent, self.name, question,
                                                                         template=template),
                                               assistant.ANSWER_MAX_TOKENS, assistant.ANSWER_TEMPERATURE)
                    text = assistant.clean_answer(raw)
                    if not text:
                        raise LlmUnavailable("empty")
                except Exception as e:  # LlmUnavailable, or anything unexpected: the question must not stay pending
                    logger.info("room ai answer failed kind=%s", getattr(e, "kind", type(e).__name__))
                    await d.store.set_ai_status(message_id, "failed")
                    await d.refund("room_ai_global", GLOBAL)
                    await d.hub.broadcast(self.room_id, event("ai_failed", reply_to=seq, code="upstream"))
                    return
                async with d.hub.lock(self.room_id):
                    answer = await d.store.append(self.room_id, lane="public", sender_kind="ai", sender_id=None,
                                                  kind="ai_answer", text=text, now=d.clock(), reply_to=seq)
                await d.store.set_ai_status(message_id, "done")
                await d.hub.broadcast(self.room_id, event("message", message=message_out(answer, None)))
        finally:
            d.hub.ai_leave(self.room_id)

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
            level = await d.store.user_level(self.user_id)
            template = await d.template("rooms.assist")
            async with d.ai_gate:
                raw = await d.complete(assistant.compose_messages(text, recent, level, template=template),
                                       assistant.ASSIST_MAX_TOKENS, assistant.ASSIST_TEMPERATURE)
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
