"""Room endpoints (spec 2026-10-09 §7.2–7.3, §5.7–5.8). Off unless ROOMS_ENABLED; the config endpoint always
answers. State lives in the DB; `app.state.rooms` (RoomsRuntime) holds only the hub, tickets and rate windows.
Closed rooms stay readable (detail + messages) for their members; messages are kept forever by default.
Never logs tickets or message text.

Rooms v2 extension points (plan P2-1): `RoomsRuntime.voice`, `close_listeners`, `sweep_listeners` and
`startup_listeners` are filled by the install functions in `app.state.rooms_extensions` (set by `main.py` to
`routers/rooms_voice.install` and `routers/rooms_summary.install`), so this module never imports those routers."""
import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, WebSocket
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.websockets import WebSocketDisconnect, WebSocketState

from app.core.config import Settings
from app.core.deps import auth_rate_limit, current_user, get_settings, limited_user
from app.core.quotas import effective
from app.core.ratelimit import RateLimiter
from app.core.settings_registry import SPECS
from app.models import User, iso_utc, utcnow
from app.providers import llm
from app.rooms.codes import normalize_code
from app.rooms.connection import ConnDeps, RoomConnection, members_out
from app.rooms.hub import Conn, RoomHub
from app.rooms.protocol import (
    CLOSE_BUSY, CLOSE_DISABLED, CLOSE_KICKED, CLOSE_NORMAL, CLOSE_NOT_FOUND, CLOSE_PROTOCOL, CLOSE_RESTART,
    CLOSE_UNAUTHORIZED, HELLO_TIMEOUT, MAX_ID, HelloMsg, ProtocolError, event, parse_client_message,
)
from app.rooms.protocol import REACTION_KEYS
from app.rooms.rules import LEVELS, MAX_TEXT, NAME_MAX, RoomLimits, clean_settings, clean_text
from app.rooms.scenarios import SCENARIOS
from app.rooms.store import RoomError, RoomStore, message_out, room_out
from app.rooms.tickets import RoomTicketStore
from app.services import usage
from app.services.prompts import prompt_cache

router = APIRouter(prefix="/api/rooms")
logger = logging.getLogger(__name__)
IDLE_SECONDS = 60.0
SWEEP_SECONDS = 60.0
ROOM_ERRORS: dict[str, tuple[int, str]] = {
    "not_found": (404, "Room not found"), "locked": (403, "Room is locked"), "full": (409, "Room is full"),
    "kicked": (403, "Removed from room"), "capacity": (503, "Room capacity reached"), "too_many": (429, "Too many rooms"),
    "forbidden": (403, "Only the owner can do that"), "bad_reason": (400, "Invalid reason"),
    "below_members": (409, "Below current members"), "cooldown": (429, "Try again later"),
    "too_many_requests": (429, "Too many requests for this room"), "no_request": (404, "Request not found"),
}


@dataclass
class RoomsRuntime:
    store: RoomStore
    hub: RoomHub
    tickets: RoomTicketStore
    limits: RoomLimits
    ai_gate: asyncio.Semaphore
    say_limiter: RateLimiter
    ai_room_limiter: RateLimiter
    ai_user_limiter: RateLimiter
    join_limiter: RateLimiter
    assist_limiter: RateLimiter
    sweeper: asyncio.Task | None = None
    ai_concurrency: int = 0
    # ---- rooms v2 extension points (plan P2-1); filled by app.state.rooms_extensions ----
    voice: object | None = None  # connection.VoiceHandler (lane SV)
    close_listeners: list["CloseListener"] = field(default_factory=list)
    sweep_listeners: list["SweepListener"] = field(default_factory=list)
    startup_listeners: list["StartupListener"] = field(default_factory=list)
    app: object | None = None

    def reconfigure(self, settings: Settings, old: Settings | None = None) -> None:
        """Hot reload (admin v2 §3.6, §10): new limits for later requests/messages; live sockets close when rooms
        are switched off (4003) or maintenance starts (1012, clients reconnect and get the maintenance answer)."""
        limits = RoomLimits.from_settings(settings)
        self.limits = self.store.limits = limits
        self.ai_room_limiter.limit = limits.ai_per_room_hour
        self.say_limiter.limit = limits.say_per_minute
        self.ai_user_limiter.limit = limits.ai_per_user_10min
        self.join_limiter.limit = limits.join_per_minute
        self.assist_limiter.limit = limits.assist_per_minute
        self.tickets.set_ttl(settings.rooms_ticket_ttl_seconds)
        if settings.rooms_ai_concurrency != self.ai_concurrency:  # calls already holding the old gate finish on it
            self.ai_gate = asyncio.Semaphore(settings.rooms_ai_concurrency)
            self.ai_concurrency = settings.rooms_ai_concurrency
        code = None
        if not settings.rooms_enabled:
            code = CLOSE_DISABLED
        elif getattr(settings, "maintenance_mode", "off") != "off":
            code = CLOSE_RESTART
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return
        if code is not None and self.hub.active_rooms():
            self.hub.spawn(self.hub.close_all(code))
        if settings.rooms_enabled and old is not None and not old.rooms_enabled and self.sweeper is None:
            self.sweeper = asyncio.get_running_loop().create_task(_sweep_loop(self))  # switched on at runtime


CloseListener = Callable[[RoomsRuntime, str, str], Awaitable[None]]  # (rt, room_id, reason)
SweepListener = Callable[[RoomsRuntime, datetime], Awaitable[None]]  # (rt, now), after each sweep
StartupListener = Callable[[RoomsRuntime], Awaitable[None]]  # after fail_pending_ai at startup

RUNTIME_KEYS = frozenset({k for k in SPECS if k.startswith(("rooms_", "room_"))} | {"maintenance_mode"})


def runtime(app) -> RoomsRuntime:
    rt = getattr(app.state, "rooms", None)
    if rt is None:
        s = app.state.settings
        limits = RoomLimits.from_settings(s)
        rt = RoomsRuntime(
            store=RoomStore(app.state.sessionmaker, limits), hub=RoomHub(limits.connections_per_user),
            tickets=RoomTicketStore(s.rooms_ticket_ttl_seconds), limits=limits,
            ai_gate=asyncio.Semaphore(s.rooms_ai_concurrency), say_limiter=RateLimiter(limits.say_per_minute, 60),
            ai_room_limiter=RateLimiter(limits.ai_per_room_hour, 3600),
            ai_user_limiter=RateLimiter(limits.ai_per_user_10min, 600),
            join_limiter=RateLimiter(limits.join_per_minute, 60),
            assist_limiter=RateLimiter(limits.assist_per_minute, 60), ai_concurrency=s.rooms_ai_concurrency)
        rt.app = app
        rt.sweep_listeners.append(_expire_requests)
        app.state.rooms = rt
        for install in getattr(app.state, "rooms_extensions", ()):
            install(app, rt)
        hub = getattr(app.state, "settings_hub", None)
        if hub is not None:
            hub.subscribe("rooms_runtime", lambda old, new: rt.reconfigure(new, old), keys=RUNTIME_KEYS)
    return rt


def deps_for(app, rt: RoomsRuntime, settings: Settings) -> ConnDeps:
    http, sm = app.state.http, app.state.sessionmaker

    async def complete(messages: list[dict], max_tokens: int, temperature: float) -> str:
        return await llm.complete(http, settings, messages, model=settings.resolved_rooms_ai_model,
                                  max_tokens=max_tokens, temperature=temperature)

    async def consume(scope: str, subject: str, limit: int) -> bool:
        async with sm() as s:
            return await usage.consume(s, scope, subject, usage.utc_day(utcnow()), limit)

    async def refund(scope: str, subject: str) -> None:
        async with sm() as s:
            await usage.refund(s, scope, subject, usage.utc_day(utcnow()))

    async def assist_daily_for(user_id: int) -> int:
        async with sm() as s:
            return await effective(s, app, user_id, "rooms_assist_daily_per_user")

    async def templates() -> dict[str, str | None]:
        """Published admin templates (admin v2 G2); the prompt cache reads the DB once per key until a publish."""
        cache = prompt_cache(app)
        return {key: (await cache.get(key))[1]
                for key in ("rooms.assist", "rooms.answer", "rooms.voice_translate", "rooms.summary")}

    return ConnDeps(rt.store, rt.hub, rt.limits, complete, consume, refund, utcnow, rt.ai_gate, rt.say_limiter,
                    rt.ai_room_limiter, rt.ai_user_limiter, settings.rooms_ai_available, rt.assist_limiter,
                    assist_daily_for, templates, voice=rt.voice)


async def after_close(rt: RoomsRuntime, room_id: str, reason: str) -> None:
    """Runs every close listener (e.g. the learning summary) after a room closed; spawned on the hub."""
    for listener in list(rt.close_listeners):
        try:
            await listener(rt, room_id, reason)
        except Exception as e:  # a listener must never break closing
            logger.warning("rooms close listener failed error=%s", type(e).__name__)


def require_rooms(settings: Settings = Depends(get_settings)) -> Settings:
    if not settings.rooms_enabled:
        raise HTTPException(404, "Rooms are disabled")
    return settings


def _raise(e: RoomError):
    status, message = ROOM_ERRORS[e.code]
    raise HTTPException(status, message) from None


class SettingsIn(BaseModel):
    """The seven room settings (spec 2026-10-10 §3.1); values are checked by `rules.clean_settings`."""
    name: str | None = Field(None, max_length=200)
    scenario: str | None = Field(None, max_length=32)
    level: str | None = Field(None, max_length=8)
    join_mode: str | None = Field(None, max_length=16)
    max_members: int | None = None
    ai_public: bool | None = None
    allow_voice: bool | None = None


class CreateIn(SettingsIn):
    topic: str = Field("", max_length=200)  # v1 clients: seeds the name


class JoinIn(BaseModel):
    code: str = Field(min_length=1, max_length=32)


class PatchIn(SettingsIn):
    topic: str | None = Field(None, max_length=200)  # v1 clients: written to `name`, cut to 30 (R2-1)
    locked: bool | None = None


def _invalid_settings(errors: dict[str, str]) -> JSONResponse:
    return JSONResponse({"error": "Invalid settings", "fields": errors}, status_code=400)


class KickIn(BaseModel):
    user_id: int


class ReportIn(BaseModel):
    reason: str = Field(max_length=32)


async def _room_json(rt: RoomsRuntime, room, role: str | None) -> dict:
    return room_out(room, my_role=role, member_count=await rt.store.member_count(room.id),
                    online_count=len(rt.hub.online(room.id)))


async def system_message(rt: RoomsRuntime, room_id: str, key: str, meta: dict) -> None:
    """Plan P-7: system messages store only the template key; the web renders the text."""
    async with rt.hub.lock(room_id):
        m = await rt.store.append(room_id, lane="public", sender_kind="system", sender_id=None, kind="system",
                                  text=key, now=utcnow(), meta=meta)
    await rt.hub.broadcast(room_id, event("message", message=message_out(m, None)))


async def presence(rt: RoomsRuntime, room_id: str) -> None:
    if not rt.hub.online(room_id):
        return
    members = await rt.store.members(room_id)
    await rt.hub.broadcast(room_id, event("presence", members=members_out(members, rt.hub.online(room_id))))


async def _owner_event(rt: RoomsRuntime, room_id: str, data: dict) -> None:
    """Join-request events go to the owner's sockets only (spec 2026-10-10 §9)."""
    room = await rt.store.room(room_id)
    if room is not None:
        await rt.hub.broadcast(room_id, data, only_user=room.owner_id)


async def _request_closed(rt: RoomsRuntime, room_id: str, request_id: str, status: str) -> None:
    await _owner_event(rt, room_id, event("join_request_closed", id=request_id, status=status))


async def _admitted(rt: RoomsRuntime, room_id: str, user_ids: list[int]) -> None:
    for user_id in user_ids:
        await system_message(rt, room_id, "joined", {"name": await rt.store.username(user_id)})
    if user_ids:
        await presence(rt, room_id)


async def _expire_requests(rt: RoomsRuntime, now: datetime) -> None:
    """Sweep listener: pending join requests past `join_request_minutes` expire; the owner is told per request."""
    expired = await rt.store.expire_requests(now)
    for room_id, request_id in expired:
        await _request_closed(rt, room_id, request_id, "expired")
    if expired:
        logger.info("rooms join requests expired=%d", len(expired))


@router.get("/config")
async def rooms_config(_: User = Depends(current_user), settings: Settings = Depends(get_settings)):
    return {"enabled": settings.rooms_enabled, "ai_available": settings.rooms_ai_available,
            "max_members": settings.rooms_max_members, "max_text": MAX_TEXT,
            "scenarios": [{"key": s.key, "title_zh": s.title_zh, "title_en": s.title_en} for s in SCENARIOS],
            "levels": list(LEVELS), "default_max_members": min(RoomLimits.default_max_members, settings.rooms_max_members),
            "name_max": RoomLimits.name_max, "voice_available": settings.rooms_voice_available,
            "max_voice_ms": settings.rooms_voice_max_seconds * 1000,
            "summary_available": settings.rooms_summary_available, "reactions": list(REACTION_KEYS)}


@router.post("")
async def create_room(payload: CreateIn, request: Request, user: User = Depends(limited_user),
                      settings: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    values, errors = clean_settings(payload.model_dump(exclude_none=True, exclude={"topic"}),
                                    site_max_members=settings.rooms_max_members, partial=False)
    if errors:
        return _invalid_settings(errors)
    async with request.app.state.sessionmaker() as s:
        max_owned = await effective(s, request.app, user.id, "rooms_max_owned")
    try:
        room = await rt.store.create(user.id, payload.topic, utcnow(), max_owned=max_owned, settings=values)
    except RoomError as e:
        _raise(e)
    return {"room": await _room_json(rt, room, "owner")}


@router.post("/join", dependencies=[Depends(auth_rate_limit)])
async def join_room(payload: JoinIn, request: Request, user: User = Depends(current_user),
                    _: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    if not rt.join_limiter.allow(str(user.id)):
        raise HTTPException(429, "Too many requests, please try again later")
    code = normalize_code(payload.code)
    if code is None:
        raise HTTPException(404, "Room not found")
    now = utcnow()
    try:
        room, joined, pending = await rt.store.join(code, user.id, now)
        if pending is not None:
            request = await rt.store.request_view(pending.id)
            if request["created_at"] == iso_utc(now):  # a new request, not the user's existing pending one
                await _owner_event(rt, room.id, event("join_request", request=request))
            return JSONResponse({"request": request}, status_code=202)
        _, member = await rt.store.membership(room.id, user.id)
    except RoomError as e:
        _raise(e)
    if joined:
        await system_message(rt, room.id, "joined", {"name": user.username})
        await presence(rt, room.id)
    return {"room": await _room_json(rt, room, member.role)}


@router.get("/requests/{request_id}")
async def my_request(request_id: str, request: Request, user: User = Depends(current_user),
                     _: Settings = Depends(require_rooms)):
    """The requester polls the request (spec 2026-10-10 §3.4); `approved` means they are a member now."""
    rt = runtime(request.app)
    try:
        return {"request": await rt.store.get_request(request_id[:MAX_ID], user.id)}
    except RoomError as e:
        _raise(e)


@router.delete("/requests/{request_id}")
async def cancel_request(request_id: str, request: Request, user: User = Depends(current_user),
                         _: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    try:
        before = await rt.store.get_request(request_id[:MAX_ID], user.id)
        cancelled = await rt.store.cancel_request(request_id[:MAX_ID], user.id, utcnow())
    except RoomError as e:
        _raise(e)
    if before["status"] == "pending" and cancelled.status == "cancelled":
        await _request_closed(rt, cancelled.room_id, cancelled.id, "cancelled")
    return {"request": await rt.store.request_view(cancelled.id)}


# ---- invite links (spec 2026-10-10 §3.4, R2-4/R2-5). Registered before the /{room_id} routes; the token never
# reaches logs, audit or error texts (the access log redacts /api/rooms/invite/<token>). ----

MAX_TOKEN = 64


def _invite_out(token: str) -> dict:
    return {"token": token, "path": f"/rooms/invite/{token}"}


@router.get("/invite/{token}")
async def invite_preview(token: str, request: Request, user: User = Depends(current_user),
                         _: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    if not rt.join_limiter.allow(str(user.id)):
        raise HTTPException(429, "Too many requests, please try again later")
    try:
        return {"invite": await rt.store.invite_preview(token[:MAX_TOKEN], user.id)}
    except RoomError as e:
        _raise(e)


@router.post("/invite/{token}/join", dependencies=[Depends(auth_rate_limit)])
async def invite_join(token: str, request: Request, user: User = Depends(current_user),
                      _: Settings = Depends(require_rooms)):
    """Joins directly, also in an `approval` room (R2-4); locked, full, kicked and closed answer like v1."""
    rt = runtime(request.app)
    if not rt.join_limiter.allow(str(user.id)):
        raise HTTPException(429, "Too many requests, please try again later")
    token = token[:MAX_TOKEN]
    try:
        preview = await rt.store.invite_preview(token, user.id)
        pending = await rt.store.user_pending(preview["room_id"], user.id)
        room, joined = await rt.store.join_by_invite(token, user.id, utcnow())
        _, member = await rt.store.membership(room.id, user.id)
    except RoomError as e:
        _raise(e)
    if joined:
        for request_id in pending:
            await _request_closed(rt, room.id, request_id, "approved")
        await _admitted(rt, room.id, [user.id])
        logger.info("rooms invite join room=%s", room.id)
    return {"room": await _room_json(rt, room, member.role)}


@router.get("/mine")
async def my_rooms(request: Request, user: User = Depends(current_user), _: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    return {"rooms": [await _room_json(rt, room, role) for room, role in await rt.store.mine(user.id, utcnow())]}


@router.get("/{room_id}")
async def room_detail(room_id: str, request: Request, user: User = Depends(current_user),
                      _: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    try:
        room, member = await rt.store.membership(room_id[:MAX_ID], user.id)
    except RoomError as e:
        _raise(e)
    members = await rt.store.members(room.id)
    return {"room": await _room_json(rt, room, member.role), "members": members_out(members, rt.hub.online(room.id))}


@router.get("/{room_id}/messages")
async def room_messages(room_id: str, request: Request, before_seq: int = Query(..., ge=1),
                        limit: int = Query(50, ge=1, le=100), user: User = Depends(current_user),
                        _: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    try:
        room, _member = await rt.store.membership(room_id[:MAX_ID], user.id)
    except RoomError as e:
        _raise(e)
    return {"messages": await rt.store.history_out(room.id, user.id, before_seq, limit)}


@router.get("/{room_id}/requests")
async def room_requests(room_id: str, request: Request, user: User = Depends(current_user),
                        _: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    try:
        return {"requests": await rt.store.list_requests(room_id[:MAX_ID], user.id)}
    except RoomError as e:
        _raise(e)


async def _decide(request: Request, user: User, room_id: str, request_id: str, approve: bool) -> dict:
    rt = runtime(request.app)
    room_id = room_id[:MAX_ID]
    try:
        decided = await rt.store.decide_request(room_id, user.id, request_id[:MAX_ID], approve, utcnow())
    except RoomError as e:
        _raise(e)
    await _request_closed(rt, room_id, decided.id, decided.status)
    if approve:
        await _admitted(rt, room_id, [decided.user_id])
    return {"request": await rt.store.request_view(decided.id)}


@router.post("/{room_id}/requests/{request_id}/approve")
async def approve_request(room_id: str, request_id: str, request: Request, user: User = Depends(current_user),
                          _: Settings = Depends(require_rooms)):
    return await _decide(request, user, room_id, request_id, True)


@router.post("/{room_id}/requests/{request_id}/deny")
async def deny_request(room_id: str, request_id: str, request: Request, user: User = Depends(current_user),
                       _: Settings = Depends(require_rooms)):
    return await _decide(request, user, room_id, request_id, False)


@router.post("/{room_id}/invite")
async def room_invite(room_id: str, request: Request, user: User = Depends(current_user),
                      _: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    try:
        return _invite_out(await rt.store.invite_token(room_id[:MAX_ID], user.id))
    except RoomError as e:
        _raise(e)


@router.post("/{room_id}/invite/rotate")
async def rotate_invite(room_id: str, request: Request, user: User = Depends(current_user),
                        _: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    try:
        token = await rt.store.rotate_invite(room_id[:MAX_ID], user.id)
    except RoomError as e:
        _raise(e)
    logger.info("rooms invite rotated room=%s", room_id[:MAX_ID])
    return _invite_out(token)


@router.post("/{room_id}/ticket")
async def room_ticket(room_id: str, request: Request, user: User = Depends(limited_user),
                      settings: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    try:
        room, _member = await rt.store.membership(room_id[:MAX_ID], user.id)
    except RoomError as e:
        _raise(e)
    if room.status != "open":
        raise HTTPException(404, "Room not found")
    return {"ticket": rt.tickets.issue(user.id, room.id), "expires_in": settings.rooms_ticket_ttl_seconds}


@router.patch("/{room_id}")
async def update_room(room_id: str, payload: PatchIn, request: Request, user: User = Depends(current_user),
                      settings: Settings = Depends(require_rooms)):
    """Owner edit of any subset of the seven settings plus `locked` (spec 2026-10-10 §3.2). One `settings` system
    message lists every field that really changed; the v1 `topic` message is no longer produced."""
    rt = runtime(request.app)
    raw = payload.model_dump(exclude_none=True, exclude={"topic", "locked"})
    if payload.topic is not None and payload.name is None:
        raw["name"] = clean_text(payload.topic, NAME_MAX) or ""
    values, errors = clean_settings(raw, site_max_members=settings.rooms_max_members, partial=True)
    if errors:
        return _invalid_settings(errors)
    room_id = room_id[:MAX_ID]
    try:
        before = await rt.store.room(room_id)
        _room, changes = await rt.store.update_settings(room_id, user.id, values)
        room = await rt.store.update(room_id, user.id, locked=payload.locked)
    except RoomError as e:
        _raise(e)
    if changes:
        await system_message(rt, room.id, "settings", {"changes": changes})
    if before is not None and before.join_mode == "approval" and room.join_mode == "code":
        closed = await rt.store.approve_all(room.id, utcnow())  # spec 2026-10-10 §3.2
        for r in closed:
            await _request_closed(rt, room.id, r.id, r.status)
        await _admitted(rt, room.id, [r.user_id for r in closed if r.status == "approved"])
    await rt.hub.broadcast(room.id, event("room_update", room=await _room_json(rt, room, None)))
    return {"room": await _room_json(rt, room, "owner")}


@router.post("/{room_id}/kick")
async def kick_member(room_id: str, payload: KickIn, request: Request, user: User = Depends(current_user),
                      _: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    room_id = room_id[:MAX_ID]
    try:
        await rt.store.kick(room_id, user.id, payload.user_id, utcnow())
    except RoomError as e:
        _raise(e)
    await rt.hub.close_user(room_id, payload.user_id, CLOSE_KICKED)
    await system_message(rt, room_id, "kicked", {"name": await rt.store.username(payload.user_id)})
    await presence(rt, room_id)
    return {"ok": True}


@router.post("/{room_id}/leave")
async def leave_room(room_id: str, request: Request, user: User = Depends(current_user),
                     _: Settings = Depends(require_rooms)):
    """Leaving a closed room only removes it from the member's list (no system message)."""
    rt = runtime(request.app)
    room_id = room_id[:MAX_ID]
    try:
        new_owner = await rt.store.leave(room_id, user.id, utcnow())
    except RoomError as e:
        _raise(e)
    await rt.hub.close_user(room_id, user.id, CLOSE_NORMAL)
    room = await rt.store.room(room_id)
    if room is not None and room.status == "open":
        await system_message(rt, room_id, "left", {"name": user.username})
        if new_owner is not None:
            await system_message(rt, room_id, "owner", {"name": await rt.store.username(new_owner)})
            await rt.hub.broadcast(room_id, event("room_update", room=await _room_json(rt, room, None)))
        await presence(rt, room_id)
    return {"ok": True}


@router.post("/{room_id}/close")
async def close_room(room_id: str, request: Request, user: User = Depends(current_user),
                     _: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    try:
        room = await rt.store.close_by_owner(room_id[:MAX_ID], user.id, utcnow())
    except RoomError as e:
        _raise(e)
    await rt.hub.broadcast(room.id, event("closed", reason="owner"))
    await rt.hub.close_room(room.id, CLOSE_NOT_FOUND)
    rt.hub.forget(room.id)
    rt.hub.spawn(after_close(rt, room.id, "owner"))
    return {"room": await _room_json(rt, room, "owner")}


@router.post("/{room_id}/messages/{message_id}/report")
async def report_message(room_id: str, message_id: str, payload: ReportIn, request: Request,
                         user: User = Depends(current_user), _: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    room_id = room_id[:MAX_ID]
    try:
        await rt.store.membership(room_id, user.id)
        await rt.store.report(room_id, message_id[:MAX_ID], user.id, payload.reason, utcnow())
    except RoomError as e:
        _raise(e)
    return {"ok": True}


# ---- WebSocket, sweeper and restart behaviour (spec §5.2, §5.7–5.8) ----

class _WsSender:
    def __init__(self, websocket: WebSocket):
        self.ws = websocket

    async def send_json(self, data: dict) -> None:
        await self.ws.send_json(data)

    async def close(self, code: int) -> None:
        if WebSocketState.DISCONNECTED in (self.ws.application_state, self.ws.client_state):
            return
        await self.ws.close(code)


async def _receive_text(websocket: WebSocket, timeout: float) -> str:
    message = await asyncio.wait_for(websocket.receive(), timeout)
    if message["type"] == "websocket.disconnect":
        raise WebSocketDisconnect(message.get("code", 1000))
    text = message.get("text")
    if not isinstance(text, str):
        raise ProtocolError("binary frames are not accepted")
    return text


@router.websocket("/ws")
async def rooms_ws(websocket: WebSocket, ticket: str = ""):
    await websocket.accept()
    app = websocket.app
    settings = app.state.settings
    sender = _WsSender(websocket)
    if not settings.rooms_enabled:
        await sender.close(CLOSE_DISABLED)
        return
    rt = runtime(app)
    grant = rt.tickets.redeem(ticket)
    if grant is None:
        await sender.close(CLOSE_UNAUTHORIZED)
        return
    try:
        room, _member = await rt.store.membership(grant.room_id, grant.user_id)
    except RoomError:
        await sender.close(CLOSE_NOT_FOUND)
        return
    if room.status != "open":
        await sender.close(CLOSE_NOT_FOUND)
        return
    conn = Conn(grant.user_id, sender)
    if not rt.hub.attach(room.id, conn):
        await sender.close(CLOSE_BUSY)
        return
    if not await _still_member(rt, room.id, grant.user_id):  # kicked/closed before attach: nothing closed us
        rt.hub.detach(room.id, conn)
        await sender.close(CLOSE_NOT_FOUND)
        return
    stage = "hello"
    try:
        hello = parse_client_message(await _receive_text(websocket, HELLO_TIMEOUT))
        if not isinstance(hello, HelloMsg):
            raise ProtocolError("expected hello")
        stage = "live"
        connection = RoomConnection(deps_for(app, rt, settings), room.id, grant.user_id,
                                    await rt.store.username(grant.user_id), conn)
        await connection.welcome(hello.last_seq)
        rt.hub.spawn(_presence_quietly(rt, room.id))
        while True:
            await connection.handle(await _receive_text(websocket, IDLE_SECONDS))
    except (asyncio.TimeoutError, TimeoutError):
        await sender.close(CLOSE_PROTOCOL if stage == "hello" else CLOSE_NORMAL)
    except ProtocolError:
        await sender.close(CLOSE_PROTOCOL)
    except (WebSocketDisconnect, RuntimeError):  # client gone, or the socket was closed by kick/close/shutdown
        pass
    finally:
        rt.hub.detach(room.id, conn)
        rt.hub.spawn(_presence_quietly(rt, room.id))


async def _still_member(rt: RoomsRuntime, room_id: str, user_id: int) -> bool:
    try:
        room, _member = await rt.store.membership(room_id, user_id)
    except RoomError:
        return False
    return room.status == "open"


async def _presence_quietly(rt: RoomsRuntime, room_id: str) -> None:
    """Presence runs as a hub task, not in the socket task: a socket task can be cancelled when its client goes
    away, and cancelling it in the middle of a DB call can wedge the aiosqlite connection close."""
    try:
        await presence(rt, room_id)
    except Exception as e:
        logger.info("rooms presence failed error=%s", type(e).__name__)


async def sweep_once(rt: RoomsRuntime, now) -> list[tuple[str, str]]:
    """Close idle/expired rooms, notify and disconnect their members, drop their in-memory state.
    Messages are never deleted here unless ROOM_MESSAGE_RETENTION_DAYS > 0 (purge is a no-op at 0)."""
    closed = await rt.store.sweep(now, rt.hub.active_rooms())
    for room_id, reason in closed:
        await rt.hub.broadcast(room_id, event("closed", reason=reason))
        await rt.hub.close_room(room_id, CLOSE_NOT_FOUND)
        rt.hub.forget(room_id)
        rt.hub.spawn(after_close(rt, room_id, reason))
    await rt.store.purge(now)
    for listener in list(rt.sweep_listeners):
        try:
            await listener(rt, now)
        except Exception as e:
            logger.warning("rooms sweep listener failed error=%s", type(e).__name__)
    return closed


async def _sweep_loop(rt: RoomsRuntime) -> None:
    while True:
        await asyncio.sleep(SWEEP_SECONDS)
        try:
            closed = await sweep_once(rt, utcnow())
            if closed:
                logger.info("rooms sweep closed=%d", len(closed))
        except Exception as e:
            logger.warning("rooms sweep failed error=%s", type(e).__name__)


async def rooms_startup(app) -> None:
    """Spec §5.8: pending @ai questions from before a restart are marked failed; the sweeper starts."""
    if not app.state.settings.rooms_enabled:
        return
    rt = runtime(app)
    try:
        failed = await rt.store.fail_pending_ai()
        logger.info("rooms startup pending_ai_failed=%d", failed)
    except Exception as e:
        logger.warning("rooms startup cleanup failed error=%s", type(e).__name__)
    for listener in list(rt.startup_listeners):
        try:
            await listener(rt)
        except Exception as e:
            logger.warning("rooms startup listener failed error=%s", type(e).__name__)
    if rt.sweeper is None:
        rt.sweeper = asyncio.create_task(_sweep_loop(rt))


async def rooms_shutdown(app) -> None:
    rt = getattr(app.state, "rooms", None)
    if rt is None:
        return
    if rt.sweeper is not None:
        rt.sweeper.cancel()
        with suppress(asyncio.CancelledError):
            await rt.sweeper
        rt.sweeper = None
    await rt.hub.close_all(CLOSE_RESTART)
    await rt.hub.cancel_tasks()
