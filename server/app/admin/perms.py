"""管理端权限:启用判定、会话解析、CSRF/Origin、角色依赖(spec §4.2–4.3)。"""
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import sessions as sess
from app.admin.audit import Actor
from app.core.deps import client_ip, get_session
from app.models import AdminAccount, AdminSession

Role = Literal["viewer", "operator", "superadmin"]
ROLE_RANK = {"viewer": 0, "operator": 1, "superadmin": 2}
REQUIRED_ROLE_ATTR = "admin_min_role"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@dataclass(frozen=True)
class AdminContext:
    actor: Actor
    account_id: int | None
    role: Role
    session: AdminSession


def require_enabled(request: Request) -> None:
    settings = request.app.state.settings
    if not settings.admin_enabled:  # A7 adds the IP allowlist check here
        raise HTTPException(404, "Not Found")


def _origin_ok(request: Request) -> bool:
    origin = request.headers.get("origin")
    if not origin:
        return True
    return urlsplit(origin).netloc == request.headers.get("host", "")


async def current_admin(request: Request, session: AsyncSession = Depends(get_session)) -> AdminContext:
    require_enabled(request)
    settings = request.app.state.settings
    token = request.cookies.get(sess.cookie_name(settings), "")
    now = datetime.now(timezone.utc)
    row = await sess.resolve(session, token, now, settings.admin_idle_minutes) if token else None
    if row is None:
        raise HTTPException(401, "Unauthorized")
    role: Role = "superadmin"
    if row.account_id is not None:
        account = await session.get(AdminAccount, row.account_id)
        if account is None or account.disabled_at is not None:
            raise HTTPException(401, "Unauthorized")
        role = account.role  # type: ignore[assignment]
    if request.method not in SAFE_METHODS:
        if not _origin_ok(request) or not sess.check_csrf(row, request.headers.get("x-admin-csrf")):
            raise HTTPException(403, "CSRF check failed")
    await sess.touch(session, row, now)
    actor = Actor(row.username, role, row.id, client_ip(request))
    return AdminContext(actor, row.account_id, role, row)


def require(role: Role):
    async def dependency(ctx: AdminContext = Depends(current_admin)) -> AdminContext:
        if ROLE_RANK[ctx.role] < ROLE_RANK[role]:
            raise HTTPException(403, "Forbidden")
        return ctx

    setattr(dependency, REQUIRED_ROLE_ATTR, role)
    dependency.__name__ = f"require_{role}"
    return dependency


require_step_up = require("superadmin")  # A7 replaces with a real step-up check
