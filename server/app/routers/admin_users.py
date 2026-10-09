"""/api/admin/* 用户治理、配额与邀请码(lane community, D1-D3)。每个端点必须声明最低角色:Depends(require(...))。

停用/撤销登录/重置密码/删除还要断开在线状态:作废一次性票据(语音通话、房间),
并以 4010 断开该用户的房间连接(`app.state.rooms` 存在时;admin 包不导入 routers)。
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import users_admin
from app.admin.perms import AdminContext, require, require_step_up
from app.core.deps import get_session
from app.models import utcnow
from app.rooms.protocol import CLOSE_KICKED, CLOSE_NOT_FOUND, event

router = APIRouter(prefix="/api/admin")

UserId = Annotated[int, Path(ge=1, le=2**31 - 1)]


class ReasonIn(BaseModel):
    reason: str = Field(min_length=1, max_length=200)

    @field_validator("reason")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("reason is required")
        return value


class DeleteIn(ReasonIn):
    confirm_username: str = Field(max_length=64)


def _fail(e: users_admin.UserAdminError):
    raise HTTPException(e.status, e.error) from None


async def cut_connections(app, user_id: int) -> None:
    """Revoke unredeemed tickets and close the user's live room sockets with 4010."""
    app.state.realtime_tickets.revoke_user(user_id)
    rt = getattr(app.state, "rooms", None)
    if rt is None:
        return
    rt.tickets.revoke_user(user_id)
    for room_id in rt.hub.active_rooms():
        if user_id in rt.hub.online(room_id):
            await rt.hub.close_user(room_id, user_id, CLOSE_KICKED)


async def _close_rooms(app, room_ids: list[str]) -> None:
    rt = getattr(app.state, "rooms", None)
    if rt is None:
        return
    for room_id in room_ids:
        await rt.hub.broadcast(room_id, event("closed", reason="admin"))
        await rt.hub.close_room(room_id, CLOSE_NOT_FOUND)
        rt.hub.forget(room_id)


@router.post("/users/{user_id}/disable")
async def disable_user(user_id: UserId, payload: ReasonIn, request: Request,
                       ctx: AdminContext = Depends(require("operator")),
                       session: AsyncSession = Depends(get_session)):
    try:
        result = await users_admin.set_disabled(session, ctx.actor, user_id, True, reason=payload.reason,
                                                now=utcnow())
    except users_admin.UserAdminError as e:
        _fail(e)
    await cut_connections(request.app, user_id)
    return result


@router.post("/users/{user_id}/enable")
async def enable_user(user_id: UserId, payload: ReasonIn, ctx: AdminContext = Depends(require("operator")),
                      session: AsyncSession = Depends(get_session)):
    try:
        return await users_admin.set_disabled(session, ctx.actor, user_id, False, reason=payload.reason,
                                              now=utcnow())
    except users_admin.UserAdminError as e:
        _fail(e)


@router.post("/users/{user_id}/revoke-tokens")
async def revoke_tokens(user_id: UserId, request: Request, ctx: AdminContext = Depends(require("operator")),
                        session: AsyncSession = Depends(get_session)):
    try:
        revoked = await users_admin.revoke_tokens(session, ctx.actor, user_id)
    except users_admin.UserAdminError as e:
        _fail(e)
    await cut_connections(request.app, user_id)
    return {"revoked": revoked}


@router.post("/users/{user_id}/reset-password")
async def reset_password(user_id: UserId, request: Request, ctx: AdminContext = Depends(require("operator")),
                         session: AsyncSession = Depends(get_session)):
    try:
        password = await users_admin.reset_password(session, ctx.actor, user_id)
    except users_admin.UserAdminError as e:
        _fail(e)
    await cut_connections(request.app, user_id)
    return JSONResponse({"password": password}, headers={"Cache-Control": "no-store"})


@router.delete("/users/{user_id}")
async def delete_user(user_id: UserId, payload: DeleteIn, request: Request,
                      ctx: AdminContext = Depends(require_step_up), session: AsyncSession = Depends(get_session)):
    settings = request.app.state.settings
    try:
        result = await users_admin.delete_user(session, ctx.actor, settings, user_id,
                                               confirm_username=payload.confirm_username, reason=payload.reason,
                                               now=utcnow())
    except users_admin.UserAdminError as e:
        _fail(e)
    await _close_rooms(request.app, result.pop("closed_rooms"))
    await cut_connections(request.app, user_id)
    return result
