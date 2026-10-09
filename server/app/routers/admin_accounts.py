"""/api/admin/* 管理员账号、会话与本人安全状态(lane settings, B5);审计日志查询(B6)。
每个端点声明最低角色:Depends(require(...));账号写操作用 require_step_up(超级管理员 + 二次验证)。
响应与审计从不包含密码、密码哈希、TOTP 密钥、恢复码、会话 token 或 CSRF。"""
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import accounts, audit, sessions as sess
from app.admin.perms import AdminContext, require, require_step_up, step_up_until
from app.core.deps import get_session
from app.core.secretbox import box_for
from app.models import AdminAccount, AdminRecoveryCode, AdminSession

router = APIRouter(prefix="/api/admin")

RoleName = Literal["viewer", "operator", "superadmin"]


class CreateIn(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=12, max_length=200)
    role: RoleName


class UpdateIn(BaseModel):
    role: RoleName | None = None
    disabled: bool | None = None
    password: str | None = Field(None, min_length=12, max_length=200)


def _utc(v: datetime) -> datetime:
    return v if v.tzinfo else v.replace(tzinfo=timezone.utc)


async def _account(session: AsyncSession, account_id: int) -> AdminAccount:
    account = await session.get(AdminAccount, account_id)
    if account is None:
        raise HTTPException(404, "Account not found")
    return account


@router.get("/accounts")
async def list_accounts(request: Request, _: AdminContext = Depends(require("superadmin")),
                        session: AsyncSession = Depends(get_session)):
    return {"accounts": await accounts.list_accounts(session, request.app.state.settings)}


@router.post("/accounts", status_code=201)
async def create_account(body: CreateIn, request: Request, ctx: AdminContext = Depends(require_step_up),
                         session: AsyncSession = Depends(get_session)):
    name = body.username.strip().lower()
    if name == request.app.state.settings.admin_username.strip().lower():
        raise HTTPException(409, "Username is reserved")
    if await session.scalar(select(AdminAccount.id).where(AdminAccount.username == name)):
        raise HTTPException(409, "Username already exists")
    try:
        account = await accounts.create_account(session, username=name, password=body.password, role=body.role,
                                                created_by=ctx.actor.name)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    await audit.record(session, ctx.actor, "admin.account.create", target_type="admin", target_id=account.username,
                       summary=f"role={account.role}", after={"role": account.role})
    await session.commit()
    return accounts.account_out(account)


@router.patch("/accounts/{account_id}")
async def update_account(account_id: int, body: UpdateIn, request: Request, ctx: AdminContext = Depends(require_step_up),
                         session: AsyncSession = Depends(get_session)):
    account = await _account(session, account_id)
    before = {"role": account.role, "disabled": account.disabled_at is not None}
    try:
        if body.role is not None or body.disabled is not None:
            await accounts.update_account(session, account_id, role=body.role, disabled=body.disabled)
        if body.password is not None:
            await accounts.set_password(session, account_id, body.password)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
    after = {"role": account.role, "disabled": account.disabled_at is not None}
    revoked = 0
    if body.disabled or body.password is not None:
        revoked = await sess.revoke_all(session, account_id=account.id, username=account.username,
                                        now=datetime.now(timezone.utc))
    if before != after:
        await audit.record(session, ctx.actor, "admin.account.update", target_type="admin", target_id=account.username,
                           summary=f"revoked {revoked} sessions", before=before, after=after)
    if body.password is not None:
        await audit.record(session, ctx.actor, "admin.account.password", target_type="admin",
                           target_id=account.username, summary=f"revoked {revoked} sessions")
    await session.commit()
    return accounts.account_out(account)


@router.post("/accounts/{account_id}/reset-totp")
async def reset_totp(account_id: int, ctx: AdminContext = Depends(require_step_up),
                     session: AsyncSession = Depends(get_session)):
    account = await _account(session, account_id)
    await accounts.reset_totp(session, account_id)
    revoked = await sess.revoke_all(session, account_id=account.id, username=account.username,
                                    now=datetime.now(timezone.utc))
    await audit.record(session, ctx.actor, "admin.account.reset_totp", target_type="admin",
                       target_id=account.username, summary=f"revoked {revoked} sessions")
    await session.commit()
    return accounts.account_out(account)


def _live(row: AdminSession, now: datetime, idle_minutes: int) -> bool:
    return (row.revoked_at is None and _utc(row.expires_at) > now
            and _utc(row.last_seen_at) + timedelta(minutes=idle_minutes) > now)


def _own(ctx: AdminContext, row: AdminSession) -> bool:
    return row.username == ctx.actor.name and row.account_id == ctx.account_id


@router.get("/sessions")
async def list_sessions(request: Request, all: bool = Query(False), ctx: AdminContext = Depends(require("viewer")),
                        session: AsyncSession = Depends(get_session)):
    """Live sessions: the caller's own; `all=1` (superadmin) every admin's."""
    if all and ctx.role != "superadmin":
        raise HTTPException(403, "Forbidden")
    query = select(AdminSession).where(AdminSession.revoked_at.is_(None)).order_by(AdminSession.last_seen_at.desc())
    if not all:
        query = query.where(AdminSession.username == ctx.actor.name)
    now = datetime.now(timezone.utc)
    idle = request.app.state.settings.admin_idle_minutes
    rows = [r for r in (await session.scalars(query.limit(500))).all() if _live(r, now, idle) and (all or _own(ctx, r))]
    return {"sessions": [{**sess.session_out(r, ctx.session.id), "env": r.account_id is None} for r in rows]}


@router.delete("/sessions/{session_id}", status_code=204)
async def revoke_session(session_id: str, request: Request, ctx: AdminContext = Depends(require("viewer")),
                         session: AsyncSession = Depends(get_session)):
    """Own sessions: anyone. Another admin's session: superadmin + step-up."""
    row = await session.get(AdminSession, session_id[:36])
    if row is None or row.revoked_at is not None:
        raise HTTPException(404, "Session not found")
    if not _own(ctx, row):
        if ctx.role != "superadmin":
            raise HTTPException(403, "Forbidden")
        if step_up_until(request.app.state.settings, ctx.session) is None:
            raise HTTPException(403, "Step-up required")
    await sess.revoke(session, row.id, datetime.now(timezone.utc))
    await audit.record(session, ctx.actor, "auth.session.revoke", target_type="admin", target_id=row.username,
                       summary="own session" if _own(ctx, row) else "other admin's session")
    await session.commit()
    response = Response(status_code=204)
    if row.id == ctx.session.id:
        sess.clear_cookie(response, request.app.state.settings)
    return response


@router.get("/me/security")
async def my_security(request: Request, ctx: AdminContext = Depends(require("viewer")),
                      session: AsyncSession = Depends(get_session)):
    """What the security page needs about the signed-in admin (no secrets)."""
    codes_left = None
    if ctx.account_id is not None:
        codes_left = await session.scalar(select(func.count()).select_from(AdminRecoveryCode).where(
            AdminRecoveryCode.account_id == ctx.account_id, AdminRecoveryCode.used_at.is_(None))) or 0
    settings = request.app.state.settings
    return {"username": ctx.actor.name, "role": ctx.role, "env": ctx.account_id is None,
            "totp_enabled": ctx.totp_enabled, "encryption": box_for(settings) is not None,
            "require_totp": settings.admin_require_totp, "recovery_codes_left": codes_left}
