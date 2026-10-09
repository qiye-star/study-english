"""Room endpoints (spec 2026-10-09 §7.2–7.3, §5.7–5.8). Off unless ROOMS_ENABLED; the config endpoint always
answers. State lives in the DB; `app.state.rooms` (RoomsRuntime) holds only the hub, tickets and rate windows.
Closed rooms stay readable (detail + messages) for their members; messages are kept forever by default.
Never logs tickets or message text."""
import asyncio
from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.core.config import Settings
from app.core.deps import auth_rate_limit, current_user, get_settings, limited_user
from app.core.ratelimit import RateLimiter
from app.models import User, utcnow
from app.providers import llm
from app.rooms.codes import normalize_code
from app.rooms.connection import ConnDeps, members_out
from app.rooms.hub import RoomHub
from app.rooms.protocol import CLOSE_KICKED, CLOSE_NORMAL, CLOSE_NOT_FOUND, MAX_ID, event
from app.rooms.rules import MAX_TEXT, RoomLimits
from app.rooms.store import RoomError, RoomStore, message_out, room_out
from app.rooms.tickets import RoomTicketStore
from app.services import usage

router = APIRouter(prefix="/api/rooms")
ROOM_ERRORS: dict[str, tuple[int, str]] = {
    "not_found": (404, "Room not found"), "locked": (403, "Room is locked"), "full": (409, "Room is full"),
    "kicked": (403, "Removed from room"), "capacity": (503, "Room capacity reached"), "too_many": (429, "Too many rooms"),
    "forbidden": (403, "Only the owner can do that"), "bad_reason": (400, "Invalid reason"),
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
    sweeper: asyncio.Task | None = None


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
            join_limiter=RateLimiter(limits.join_per_minute, 60))
        app.state.rooms = rt
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

    return ConnDeps(rt.store, rt.hub, rt.limits, complete, consume, refund, utcnow, rt.ai_gate, rt.say_limiter,
                    rt.ai_room_limiter, rt.ai_user_limiter, settings.rooms_ai_available)


def require_rooms(settings: Settings = Depends(get_settings)) -> Settings:
    if not settings.rooms_enabled:
        raise HTTPException(404, "Rooms are disabled")
    return settings


def _raise(e: RoomError):
    status, message = ROOM_ERRORS[e.code]
    raise HTTPException(status, message) from None


class CreateIn(BaseModel):
    topic: str = Field("", max_length=200)


class JoinIn(BaseModel):
    code: str = Field(min_length=1, max_length=32)


class PatchIn(BaseModel):
    topic: str | None = Field(None, max_length=200)
    locked: bool | None = None
    ai_public: bool | None = None


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


@router.get("/config")
async def rooms_config(_: User = Depends(current_user), settings: Settings = Depends(get_settings)):
    return {"enabled": settings.rooms_enabled, "ai_available": settings.rooms_ai_available,
            "max_members": settings.rooms_max_members, "max_text": MAX_TEXT}


@router.post("")
async def create_room(payload: CreateIn, request: Request, user: User = Depends(limited_user),
                      _: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    try:
        room = await rt.store.create(user.id, payload.topic, utcnow())
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
    try:
        room, joined = await rt.store.join(code, user.id, utcnow())
        _, member = await rt.store.membership(room.id, user.id)
    except RoomError as e:
        _raise(e)
    if joined:
        await system_message(rt, room.id, "joined", {"name": user.username})
        await presence(rt, room.id)
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
    return {"messages": [message_out(m, n) for m, n in await rt.store.history(room.id, user.id, before_seq, limit)]}


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
                      _: Settings = Depends(require_rooms)):
    rt = runtime(request.app)
    try:
        before = await rt.store.room(room_id[:MAX_ID])
        room = await rt.store.update(room_id[:MAX_ID], user.id, topic=payload.topic, locked=payload.locked,
                                     ai_public=payload.ai_public)
    except RoomError as e:
        _raise(e)
    if payload.topic is not None and before is not None and room.topic != before.topic:
        await system_message(rt, room.id, "topic", {"topic": room.topic})
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
