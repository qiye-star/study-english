"""/api/admin/* room moderation (lane community, D4; spec §6). Every endpoint declares a minimum role.

Live actions go through the room runtime (`app.routers.rooms.runtime`): close → `closed{reason:"admin"}` + 4004;
kick → system message `kicked` + 4010; hide → `message_hidden{seq}` (the row is kept: R-6); AI mute →
`room_update`. Each action is applied through the room store, then audited (`room.*`) and committed.
Reading private assistant lanes is audited as `room.view_private`. Never logs message text."""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import rooms_admin
from app.admin.perms import AdminContext, require
from app.core.deps import get_session
from app.models import utcnow
from app.rooms.protocol import CLOSE_KICKED, CLOSE_NOT_FOUND, MAX_ID, event
from app.rooms.store import RoomError
from app.routers.rooms import RoomsRuntime, after_close, presence, runtime, system_message, _room_json

router = APIRouter(prefix="/api/admin")

RoomId = Annotated[str, Path(max_length=MAX_ID)]
Page = Annotated[int, Query(ge=1, le=10_000)]


class ReasonIn(BaseModel):
    reason: str = Field(min_length=1, max_length=200)

    @field_validator("reason")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("reason is required")
        return value


class KickIn(ReasonIn):
    user_id: int = Field(ge=1, le=2**31 - 1)


class MuteIn(ReasonIn):
    muted: bool


class ResolveIn(ReasonIn):
    resolution: Literal["dismissed", "removed_message", "kicked", "closed_room"]


def _fail(e: rooms_admin.RoomAdminError):
    raise HTTPException(e.status, e.error) from None


async def _close(rt: RoomsRuntime, room_id: str) -> bool:
    room = await rt.store.close(room_id, "admin", utcnow())
    if room is None:
        return False
    await rt.hub.broadcast(room_id, event("closed", reason="admin"))
    await rt.hub.close_room(room_id, CLOSE_NOT_FOUND)
    rt.hub.forget(room_id)
    rt.hub.spawn(after_close(rt, room_id, "admin"))
    return True


async def _kick(rt: RoomsRuntime, room_id: str, user_id: int) -> None:
    await rt.store.admin_kick(room_id, user_id, utcnow())  # RoomError("not_found") when never a member
    await rt.hub.close_user(room_id, user_id, CLOSE_KICKED)
    rt.tickets.revoke_user(user_id)
    room = await rt.store.room(room_id)
    if room is not None and room.status == "open":
        await system_message(rt, room_id, "kicked", {"name": await rt.store.username(user_id)})
        await rt.hub.broadcast(room_id, event("room_update", room=await _room_json(rt, room, None)))
        await presence(rt, room_id)


async def _hide(rt: RoomsRuntime, room_id: str, message_id: str) -> int:
    seq = await rt.store.hide(room_id, message_id, utcnow())
    await rt.hub.broadcast(room_id, event("message_hidden", seq=seq))
    return seq


@router.get("/rooms")
async def list_rooms(request: Request, status: Literal["open", "closed", "all"] = "open",
                     q: Annotated[str, Query(max_length=64)] = "", page: Page = 1,
                     per_page: Annotated[int, Query(ge=1, le=50)] = 20,
                     _: AdminContext = Depends(require("viewer")), session: AsyncSession = Depends(get_session)):
    rt = getattr(request.app.state, "rooms", None)
    online = {} if rt is None else {rid: len(rt.hub.online(rid)) for rid in rt.hub.active_rooms()}
    return await rooms_admin.list_rooms(session, status=status, q=q, page=page, per_page=per_page, online=online)


@router.get("/rooms/{room_id}")
async def room_detail(room_id: RoomId, request: Request, _: AdminContext = Depends(require("viewer")),
                      session: AsyncSession = Depends(get_session)):
    rt = getattr(request.app.state, "rooms", None)
    detail = await rooms_admin.room_detail(session, room_id, set() if rt is None else rt.hub.online(room_id))
    if detail is None:
        raise HTTPException(404, "Room not found")
    return detail


@router.get("/rooms/{room_id}/messages")
async def room_messages(room_id: RoomId, lane: Literal["public", "all"] = "public",
                        before_seq: Annotated[int | None, Query(ge=1)] = None,
                        limit: Annotated[int, Query(ge=1, le=200)] = 100,
                        ctx: AdminContext = Depends(require("viewer")), session: AsyncSession = Depends(get_session)):
    if await rooms_admin.room_detail(session, room_id, set()) is None:
        raise HTTPException(404, "Room not found")
    if lane == "all":
        await rooms_admin.record(session, ctx.actor, "room.view_private", room_id)
    return await rooms_admin.room_messages(session, room_id, lane=lane, before_seq=before_seq, limit=limit)


@router.post("/rooms/{room_id}/close")
async def close_room(room_id: RoomId, payload: ReasonIn, request: Request,
                     ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    rt = runtime(request.app)
    closed = await _close(rt, room_id)
    if not closed:
        raise HTTPException(404, "Room not found")
    await rooms_admin.record(session, ctx.actor, "room.close", room_id, reason=payload.reason)
    return {"ok": True}


@router.post("/rooms/{room_id}/kick")
async def kick_member(room_id: RoomId, payload: KickIn, request: Request,
                      ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    rt = runtime(request.app)
    try:
        await _kick(rt, room_id, payload.user_id)
    except RoomError:
        raise HTTPException(404, "Member not found") from None
    await rooms_admin.record(session, ctx.actor, "room.kick", room_id, after={"user_id": payload.user_id},
                             reason=payload.reason)
    return {"ok": True}


@router.post("/rooms/{room_id}/ai")
async def mute_ai(room_id: RoomId, payload: MuteIn, request: Request,
                  ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    rt = runtime(request.app)
    try:
        room = await rt.store.set_ai_muted(room_id, payload.muted)
    except RoomError:
        raise HTTPException(404, "Room not found") from None
    await rt.hub.broadcast(room_id, event("room_update", room=await _room_json(rt, room, None)))
    await rooms_admin.record(session, ctx.actor, "room.ai_mute" if payload.muted else "room.ai_unmute", room_id,
                             after={"ai_muted": payload.muted}, reason=payload.reason)
    return {"ai_muted": bool(room.ai_muted)}


@router.post("/rooms/{room_id}/messages/{message_id}/hide")
async def hide_message(room_id: RoomId, message_id: Annotated[str, Path(max_length=MAX_ID)], payload: ReasonIn,
                       request: Request, ctx: AdminContext = Depends(require("operator")),
                       session: AsyncSession = Depends(get_session)):
    rt = runtime(request.app)
    try:
        seq = await _hide(rt, room_id, message_id)
    except RoomError:
        raise HTTPException(404, "Message not found") from None
    await rooms_admin.record(session, ctx.actor, "room.hide_message", room_id,
                             after={"message_id": message_id, "seq": seq}, reason=payload.reason)
    return {"ok": True, "seq": seq}


@router.get("/reports")
async def list_reports(status: Literal["open", "resolved"] = "open", page: Page = 1,
                       _: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    return await rooms_admin.list_reports(session, status=status, page=page)


@router.post("/reports/{report_id}/resolve")
async def resolve_report(report_id: Annotated[int, Path(ge=1, le=2**31 - 1)], payload: ResolveIn, request: Request,
                         ctx: AdminContext = Depends(require("operator")),
                         session: AsyncSession = Depends(get_session)):
    try:
        rep, msg = await rooms_admin.report_target(session, report_id)
    except rooms_admin.RoomAdminError as e:
        _fail(e)
    room_id = rep.room_id
    if payload.resolution != "dismissed":
        rt = runtime(request.app)
        if payload.resolution == "removed_message":
            if msg is None:
                raise HTTPException(404, "Message not found")
            await _hide(rt, room_id, msg.id)
        elif payload.resolution == "kicked":
            if msg is None or msg.sender_kind != "user" or msg.sender_id is None:
                raise HTTPException(409, "Message has no member sender")
            try:
                await _kick(rt, room_id, msg.sender_id)
            except RoomError:
                pass  # the sender's membership is gone (e.g. deleted user): nothing left to remove
        else:
            await _close(rt, room_id)  # already closed: nothing to do
    try:
        return await rooms_admin.resolve_report(session, ctx.actor, report_id, payload.resolution, utcnow(),
                                                reason=payload.reason)
    except rooms_admin.RoomAdminError as e:
        _fail(e)
