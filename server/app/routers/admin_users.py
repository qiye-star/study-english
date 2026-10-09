"""/api/admin/* 用户治理、配额与邀请码(lane community, D1-D3)。每个端点必须声明最低角色:Depends(require(...))。

停用/撤销登录/重置密码/删除还要断开在线状态:作废一次性票据(语音通话、房间),
并以 4010 断开该用户的房间连接(`app.state.rooms` 存在时;admin 包不导入 routers)。
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import invites, users_admin
from app.admin.perms import AdminContext, deny, require, require_step_up, step_up_until
from app.core.deps import get_session
from app.core.quotas import QUOTA_KEYS, quota_cache
from app.models import utcnow
from app.realtime.realtime_protocol import CLOSE_UNAUTHORIZED
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
    """Revoke unredeemed tickets, end a live realtime call (4001) and close the user's live room sockets with 4010."""
    app.state.realtime_tickets.revoke_user(user_id)
    await app.state.realtime_registry.end_user(user_id, CLOSE_UNAUTHORIZED)
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
    quota_cache(request.app).invalidate(user_id)
    return result


# ---- per-user quota overrides (D2) ----

QuotaKey = Annotated[str, Path(max_length=40)]


class QuotaIn(BaseModel):
    value: int = Field(ge=0, le=10_000_000)
    expires_at: datetime | None = None
    note: str = Field("", max_length=200)


@router.get("/users/{user_id}/quotas")
async def user_quotas(user_id: UserId, request: Request, _: AdminContext = Depends(require("operator")),
                      session: AsyncSession = Depends(get_session)):
    try:
        return {"items": await users_admin.quotas(session, request.app.state.settings, user_id, utcnow())}
    except users_admin.UserAdminError as e:
        _fail(e)


@router.put("/users/{user_id}/quotas/{key}")
async def set_quota(user_id: UserId, key: QuotaKey, payload: QuotaIn, request: Request,
                    ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    expires = payload.expires_at
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    settings = request.app.state.settings
    if key in QUOTA_KEYS and payload.value > users_admin.operator_ceiling(settings, key):
        # unbounded upstream spend or disk: superadmin + step-up + a reason (the note), like the site-wide threshold
        if ctx.role != "superadmin":
            raise HTTPException(403, "Above operator limit")
        if step_up_until(settings, ctx.session) is None:
            await deny(request, session, ctx, "Step-up required")
        if len(payload.note.strip()) < 4:
            raise HTTPException(409, "Reason required")
    try:
        item = await users_admin.set_quota(session, ctx.actor, request.app.state.settings, user_id, key,
                                           value=payload.value, expires_at=expires, note=payload.note.strip(),
                                           now=utcnow())
    except users_admin.UserAdminError as e:
        _fail(e)
    quota_cache(request.app).invalidate(user_id)
    return item


@router.delete("/users/{user_id}/quotas/{key}", status_code=204)
async def clear_quota(user_id: UserId, key: QuotaKey, request: Request,
                      ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    try:
        await users_admin.clear_quota(session, ctx.actor, user_id, key)
    except users_admin.UserAdminError as e:
        _fail(e)
    quota_cache(request.app).invalidate(user_id)
    return Response(status_code=204)


# ---- invite codes (D3) ----

class InviteIn(BaseModel):
    label: str = Field("", max_length=64)
    max_uses: int = Field(ge=1, le=invites.MAX_USES)
    expires_at: datetime | None = None


@router.get("/invites")
async def list_invites(_: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    return {"invites": await invites.listing(session)}


@router.post("/invites", status_code=201)
async def create_invite(payload: InviteIn, ctx: AdminContext = Depends(require("operator")),
                        session: AsyncSession = Depends(get_session)):
    expires = payload.expires_at
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    try:
        row, code = await invites.create(session, ctx.actor, label=payload.label, max_uses=payload.max_uses,
                                         expires_at=expires, now=utcnow())
    except invites.InviteError as e:
        raise HTTPException(e.status, e.error) from None
    return JSONResponse({"invite": invites.invite_out(row, utcnow()), "code": code}, status_code=201,
                        headers={"Cache-Control": "no-store"})


@router.delete("/invites/{invite_id}", status_code=204)
async def revoke_invite(invite_id: Annotated[int, Path(ge=1, le=2**31 - 1)],
                        ctx: AdminContext = Depends(require("operator")),
                        session: AsyncSession = Depends(get_session)):
    try:
        await invites.revoke(session, ctx.actor, invite_id)
    except invites.InviteError as e:
        raise HTTPException(e.status, e.error) from None
    return Response(status_code=204)
