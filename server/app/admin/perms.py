"""管理端权限:启用判定(含 IP 白名单)、会话解析、MFA、CSRF/Origin、角色与二次验证依赖(spec §4.2–4.6)。

每个 /api/admin/* 端点声明最低角色:`Depends(require("viewer"|"operator"|"superadmin"))`,
危险操作用 `require_step_up`(superadmin)或 `require_operator_step_up`;tests/test_admin_routes_guarded.py 强制。
"""
import ipaddress
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import audit, sessions as sess
from app.admin.audit import Actor
from app.core.deps import client_ip, get_session
from app.models import AdminAccount, AdminAudit, AdminSession

Role = Literal["viewer", "operator", "superadmin"]
ROLE_RANK = {"viewer": 0, "operator": 1, "superadmin": 2}
REQUIRED_ROLE_ATTR = "admin_min_role"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# Writes a superadmin may still make while ADMIN_REQUIRE_TOTP blocks everything else (to bind TOTP or leave).
TOTP_EXEMPT_PATHS = ("/api/admin/logout", "/api/admin/step-up", "/api/admin/me/totp", "/api/admin/me/password")


@dataclass(frozen=True)
class AdminContext:
    actor: Actor
    account_id: int | None
    role: Role
    session: AdminSession
    totp_enabled: bool = False


def _utc(v: datetime) -> datetime:
    return v if v.tzinfo else v.replace(tzinfo=timezone.utc)


def ip_allowed(settings, ip: str) -> bool:
    networks = settings.admin_ip_networks
    if not networks:
        return True
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(address in net for net in networks)


def require_enabled(request: Request) -> None:
    """404 (indistinguishable from "admin off") when the console is disabled or the client IP is not allowed."""
    settings = request.app.state.settings
    if not settings.admin_enabled or not ip_allowed(settings, client_ip(request)):
        raise HTTPException(404, "Not Found")


def _origin_ok(request: Request) -> bool:
    origin = request.headers.get("origin")
    if not origin:
        return True
    return urlsplit(origin).netloc == request.headers.get("host", "")


def check_unsafe(request: Request, row: AdminSession) -> None:
    """Non-GET requests need the session's CSRF token in X-Admin-CSRF and, when sent, a same-origin Origin."""
    if request.method not in SAFE_METHODS:
        if not _origin_ok(request) or not sess.check_csrf(row, request.headers.get("x-admin-csrf")):
            raise HTTPException(403, "CSRF check failed")


async def resolve_admin(request: Request, session: AsyncSession) -> tuple[AdminSession, AdminAccount | None]:
    """Live session + its account (None = env emergency account), MFA not checked. 404/401 otherwise."""
    require_enabled(request)
    await sess.ensure_secret(request.app)  # first admin request of this process: stable secret (review B1)
    settings = request.app.state.settings
    token = request.cookies.get(sess.cookie_name(settings), "")
    now = datetime.now(timezone.utc)
    row = await sess.resolve(session, token, now, settings.admin_idle_minutes) if token else None
    if row is None:
        raise HTTPException(401, "Unauthorized")
    account = None
    if row.account_id is not None:
        account = await session.get(AdminAccount, row.account_id)
        if account is None or account.disabled_at is not None:
            raise HTTPException(401, "Unauthorized")
    elif row.username != settings.admin_username.strip():
        raise HTTPException(401, "Unauthorized")  # env account renamed since login
    return row, account


def totp_bound(settings, account: AdminAccount | None) -> bool:
    return bool(account.totp_enc) if account is not None else bool(settings.admin_totp_secret.strip())


async def current_admin(request: Request, session: AsyncSession = Depends(get_session)) -> AdminContext:
    settings = request.app.state.settings
    row, account = await resolve_admin(request, session)
    bound = totp_bound(settings, account)
    if bound and row.mfa_at is None:
        raise HTTPException(401, "Unauthorized")  # password ok, TOTP step still pending (POST /login/totp)
    role: Role = account.role if account is not None else "superadmin"  # type: ignore[assignment]
    check_unsafe(request, row)
    if (settings.admin_require_totp and role == "superadmin" and not bound and request.method not in SAFE_METHODS
            and not request.url.path.startswith(TOTP_EXEMPT_PATHS)):
        raise HTTPException(403, "TOTP required")
    now = datetime.now(timezone.utc)
    await sess.touch(session, row, now)
    actor = Actor(row.username, role, row.id, client_ip(request))
    return AdminContext(actor, row.account_id, role, row, bound)


async def deny(request: Request, session: AsyncSession, ctx: AdminContext, error: str) -> None:
    """Audit `auth.denied` (target = route path), at most once per session, path and minute (spec §4.7, review
    security m8), then raise 403 `error`."""
    path = request.url.path[:64]
    minute = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    seen = await session.scalar(select(AdminAudit.id).where(
        AdminAudit.action == "auth.denied", AdminAudit.session_id == ctx.session.id, AdminAudit.target_id == path,
        AdminAudit.at >= minute).limit(1))
    if seen is None:
        await audit.record(session, ctx.actor, "auth.denied", target_type="route", target_id=path, summary=error,
                           result="denied")
        await session.commit()
    raise HTTPException(403, error)


def require(role: Role):
    async def dependency(request: Request, ctx: AdminContext = Depends(current_admin),
                         session: AsyncSession = Depends(get_session)) -> AdminContext:
        if ROLE_RANK[ctx.role] < ROLE_RANK[role]:
            await deny(request, session, ctx, "Forbidden")
        return ctx

    setattr(dependency, REQUIRED_ROLE_ATTR, role)
    dependency.__name__ = f"require_{role}"
    return dependency


def step_up_until(settings, row: AdminSession) -> datetime | None:
    if row.step_up_at is None:
        return None
    until = _utc(row.step_up_at) + timedelta(minutes=settings.admin_step_up_minutes)
    return until if until > datetime.now(timezone.utc) else None


def _step_up(min_role: Role):
    base = require(min_role)

    async def dependency(request: Request, ctx: AdminContext = Depends(base),
                         session: AsyncSession = Depends(get_session)) -> AdminContext:
        if step_up_until(request.app.state.settings, ctx.session) is None:
            await deny(request, session, ctx, "Step-up required")
        return ctx

    setattr(dependency, REQUIRED_ROLE_ATTR, min_role)
    dependency.__name__ = f"require_{min_role}_step_up"
    return dependency


require_step_up = _step_up("superadmin")
require_operator_step_up = _step_up("operator")
require_self_step_up = _step_up("viewer")  # own-account changes (e.g. removing one's TOTP)
