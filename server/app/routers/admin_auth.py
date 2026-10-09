"""管理端登录/登出/会话(spec §4.3)。登录失败统一 401;成功与失败都写审计(不含密码)。"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import audit, sessions as sess
from app.admin.accounts import authenticate
from app.admin.audit import Actor
from app.admin.perms import AdminContext, current_admin, require, require_enabled
from app.core.deps import auth_rate_limit, client_ip, get_session
from app.core.secretbox import box_for
from app.models import iso_utc

router = APIRouter(prefix="/api/admin")


class LoginIn(BaseModel):
    username: str = Field(max_length=100)
    password: str = Field(max_length=200)


def _out(request: Request, ctx_role: str, username: str, row, csrf: str, mfa_required: bool) -> dict:
    s = request.app.state.settings
    return {"username": username, "role": ctx_role, "csrf_token": csrf, "expires_at": iso_utc(row.expires_at),
            "mfa_required": mfa_required, "step_up_until": None, "totp_enabled": False,
            "safe_mode": request.app.state.settings_hub.safe_mode, "maintenance_mode": s.maintenance_mode}


@router.post("/login", dependencies=[Depends(require_enabled), Depends(auth_rate_limit)])
async def login(body: LoginIn, request: Request, response: Response, session: AsyncSession = Depends(get_session)):
    settings = request.app.state.settings
    ip = client_ip(request)
    principal = await authenticate(session, settings, box_for(settings), body.username, body.password)
    if principal is None:
        await audit.record(session, Actor(body.username.strip()[:64], "-", None, ip), "auth.login.fail", result="denied")
        await session.commit()
        raise HTTPException(401, "Invalid username or password")
    now = datetime.now(timezone.utc)
    row, token, csrf = await sess.create(session, principal, secret=request.app.state.admin_secret, ip=ip, user_agent=request.headers.get("user-agent", ""),
                                         now=now, ttl_minutes=settings.admin_token_ttl_minutes,
                                         mfa_done=principal.totp_secret is None)
    await audit.record(session, Actor(principal.username, principal.role, row.id, ip), "auth.login")
    await session.commit()
    sess.set_cookie(response, settings, token, settings.admin_token_ttl_minutes * 60)
    return _out(request, principal.role, principal.username, row, csrf, principal.totp_secret is not None)


@router.post("/logout", status_code=204)
async def logout(request: Request, ctx: AdminContext = Depends(require("viewer")),
                 session: AsyncSession = Depends(get_session)):
    await sess.revoke(session, ctx.session.id, datetime.now(timezone.utc))
    await audit.record(session, ctx.actor, "auth.logout")
    await session.commit()
    response = Response(status_code=204)
    sess.clear_cookie(response, request.app.state.settings)
    return response


@router.get("/session")
async def get_admin_session(request: Request, ctx: AdminContext = Depends(require("viewer"))):
    # get_session 是请求级缓存的依赖:ctx.session 属于本请求的数据库会话
    csrf = sess.csrf_for(request.app.state.admin_secret, ctx.session.id)
    return _out(request, ctx.role, ctx.actor.name, ctx.session, csrf, False)
