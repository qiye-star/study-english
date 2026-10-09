"""管理端登录/登出/会话、TOTP、二次验证、改密(spec §4.3–4.6)。

登录失败统一 401(不存在的用户名同样计数、同样响应);锁定期间不论密码对错 429 `Too many attempts`。
审计只记动作与结果,永不记密码、验证码、恢复码、token、CSRF。
"""
import json
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import audit, lockout, sessions as sess, totp
from app.admin.accounts import (
    authenticate, check_password, replace_recovery_codes, totp_secret, use_recovery_code,
)
from app.admin.audit import Actor
from app.admin.perms import (
    AdminContext, check_unsafe, require, require_enabled, require_self_step_up, resolve_admin, step_up_until,
)
from app.core.deps import auth_rate_limit, client_ip, get_session
from app.core.secretbox import SecretBoxError, box_for
from app.core.security import hash_password
from app.core.db import insert_ignore
from app.models import AdminAccount, AdminLoginState, AdminRecoveryCode, iso_utc

router = APIRouter(prefix="/api/admin")
MFA_SESSION_CAP = 5  # wrong TOTP/recovery codes per pending session before it is revoked (review M5)


class LoginIn(BaseModel):
    username: str = Field(max_length=100)
    password: str = Field(max_length=200)


class CodeIn(BaseModel):
    code: str = Field(max_length=32)


class StepUpIn(BaseModel):
    password: str = Field(max_length=200)
    code: str | None = Field(None, max_length=32)


class PasswordIn(BaseModel):
    current: str = Field(max_length=200)
    new: str = Field(min_length=12, max_length=200)


class TotpConfirmIn(BaseModel):
    enrolment: str = Field(max_length=1000)
    code: str = Field(max_length=32)


def _out(request: Request, role: str, username: str, row, csrf: str, *, mfa_required: bool,
         totp_enabled: bool) -> dict:
    s = request.app.state.settings
    until = step_up_until(s, row)
    return {"username": username, "role": role, "csrf_token": csrf, "expires_at": iso_utc(row.expires_at),
            "mfa_required": mfa_required, "step_up_until": until.isoformat() if until else None,
            "totp_enabled": totp_enabled, "safe_mode": request.app.state.settings_hub.safe_mode,
            "maintenance_mode": s.maintenance_mode}


async def _locked(request: Request, session: AsyncSession, username: str, ip: str, now: datetime, *,
                  key: str | None = None) -> None:
    """429 while (username, ip) — or (username, key) such as lockout.MFA_KEY — is locked."""
    if await lockout.check(session, username, key or ip, now):
        await audit.record(session, Actor(username.strip()[:64], "-", None, ip), "auth.login.locked", result="denied")
        await session.commit()
        raise HTTPException(429, "Too many attempts")


async def _failed(request: Request, session: AsyncSession, username: str, ip: str, now: datetime,
                  action: str, *, session_id: str | None = None) -> None:
    s = request.app.state.settings
    actor = Actor(username.strip()[:64], "-", session_id, ip)
    await audit.record(session, actor, action, result="denied")
    if await lockout.fail(session, username, ip, now, threshold=s.admin_lockout_threshold,
                          minutes=s.admin_lockout_minutes):
        await audit.record(session, actor, "auth.lockout", result="denied")
    if lockout.global_alarm(await lockout.global_failures(session, username), s.admin_lockout_threshold):
        await audit.record(session, actor, "auth.login.alarm", result="denied")
    await session.commit()


ENV_TOTP_KEY = "totp"  # admin_login_state row (env username, ip="totp"): the env account's last used TOTP step


async def _check_totp(session: AsyncSession, request: Request, secret: str, code: str,
                      account: AdminAccount | None) -> bool:
    """Verify and consume a TOTP code with a conditional UPDATE (review m6): of concurrent requests, or requests in
    different workers, presenting the same code exactly one wins. The env account's last step lives in the DB too."""
    if account is not None:
        await session.refresh(account, ["totp_last_step"])
        step = totp.verify(secret, code, time.time(), account.totp_last_step)
        if step is None:
            return False
        won = await session.execute(update(AdminAccount).where(
            AdminAccount.id == account.id,
            or_(AdminAccount.totp_last_step.is_(None), AdminAccount.totp_last_step < step))
            .values(totp_last_step=step).execution_options(synchronize_session=False))
        return won.rowcount == 1
    name = request.app.state.settings.admin_username.strip().lower()[:64]
    now = datetime.now(timezone.utc)
    await session.execute(insert_ignore(session, AdminLoginState.__table__).values(
        username=name, ip=ENV_TOTP_KEY, failures=-1, lock_level=0, updated_at=now))
    last = await session.scalar(select(AdminLoginState.failures).where(
        AdminLoginState.username == name, AdminLoginState.ip == ENV_TOTP_KEY))
    step = totp.verify(secret, code, time.time(), None if last is None or last < 0 else last)
    if step is None:
        return False
    won = await session.execute(update(AdminLoginState).where(
        AdminLoginState.username == name, AdminLoginState.ip == ENV_TOTP_KEY, AdminLoginState.failures < step)
        .values(failures=step, updated_at=now).execution_options(synchronize_session=False))
    return won.rowcount == 1


@router.post("/login", dependencies=[Depends(require_enabled), Depends(auth_rate_limit)])
async def login(body: LoginIn, request: Request, response: Response, session: AsyncSession = Depends(get_session)):
    settings = request.app.state.settings
    ip = client_ip(request)
    now = datetime.now(timezone.utc)
    secret = await sess.ensure_secret(request.app)
    await _locked(request, session, body.username, ip, now)
    principal = await authenticate(session, settings, box_for(settings), body.username, body.password)
    if principal is None:
        await _failed(request, session, body.username, ip, now, "auth.login.fail")
        raise HTTPException(401, "Invalid username or password")
    await lockout.succeed(session, body.username, ip)
    mfa_required = principal.totp_secret is not None
    row, token, csrf = await sess.create(session, principal, secret=secret, ip=ip,
                                         user_agent=request.headers.get("user-agent", ""), now=now,
                                         ttl_minutes=settings.admin_token_ttl_minutes, mfa_done=not mfa_required)
    await audit.record(session, Actor(principal.username, principal.role, row.id, ip),
                       "auth.login.password" if mfa_required else "auth.login")
    await session.commit()
    sess.set_cookie(response, settings, token, settings.admin_token_ttl_minutes * 60)
    return _out(request, principal.role, principal.username, row, csrf, mfa_required=mfa_required,
                totp_enabled=mfa_required)


@router.post("/login/totp", dependencies=[Depends(auth_rate_limit)])
async def login_totp(body: CodeIn, request: Request, session: AsyncSession = Depends(get_session)):
    """Second login step: a TOTP code or an unused recovery code completes MFA for the pending session."""
    settings = request.app.state.settings
    row, account = await resolve_admin(request, session)
    check_unsafe(request, row)
    ip = client_ip(request)
    now = datetime.now(timezone.utc)
    await _locked(request, session, row.username, ip, now)
    await _locked(request, session, row.username, ip, now, key=lockout.MFA_KEY)  # per username, any IP (review M5)
    secret = totp_secret(settings, box_for(settings), account)
    ok = bool(secret) and await _check_totp(session, request, secret, body.code, account)
    if not ok and account is not None:
        ok = await use_recovery_code(session, account.id, body.code, now)
    if not ok:
        row.mfa_failures = (row.mfa_failures or 0) + 1
        if row.mfa_failures >= MFA_SESSION_CAP:
            row.revoked_at = now  # this pending session is spent: log in with the password again
        if await lockout.fail(session, row.username, lockout.MFA_KEY, now, count_global=False,
                              threshold=settings.admin_lockout_threshold * lockout.MFA_FACTOR,
                              minutes=settings.admin_lockout_minutes):
            await audit.record(session, Actor(row.username, "-", row.id, ip), "auth.mfa.lockout", result="denied")
        await _failed(request, session, row.username, ip, now, "auth.mfa.fail", session_id=row.id)
        raise HTTPException(401, "Invalid code")
    await lockout.succeed(session, row.username, ip)
    await lockout.succeed(session, row.username, lockout.MFA_KEY)
    row.mfa_at = now
    role = account.role if account is not None else "superadmin"
    await audit.record(session, Actor(row.username, role, row.id, ip), "auth.login")
    await session.commit()
    csrf = sess.csrf_for(request.app.state.admin_secret, row.id)
    return _out(request, role, row.username, row, csrf, mfa_required=False, totp_enabled=True)


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
    csrf = sess.csrf_for(request.app.state.admin_secret, ctx.session.id)
    return _out(request, ctx.role, ctx.actor.name, ctx.session, csrf, mfa_required=False,
                totp_enabled=ctx.totp_enabled)


@router.post("/step-up")
async def step_up(body: StepUpIn, request: Request, ctx: AdminContext = Depends(require("viewer")),
                  session: AsyncSession = Depends(get_session)):
    """Re-enter the password (+ TOTP when bound); dangerous endpoints then pass for ADMIN_STEP_UP_MINUTES."""
    settings = request.app.state.settings
    now = datetime.now(timezone.utc)
    ip = ctx.actor.ip
    await _locked(request, session, ctx.actor.name, ip, now)
    ok = await check_password(session, settings, ctx.account_id, ctx.actor.name, body.password)
    if ok and ctx.totp_enabled:
        account = await session.get(AdminAccount, ctx.account_id) if ctx.account_id is not None else None
        secret = totp_secret(settings, box_for(settings), account)
        ok = bool(secret) and bool(body.code) and await _check_totp(session, request, secret, body.code or "", account)
    if not ok:
        await _failed(request, session, ctx.actor.name, ip, now, "auth.step_up.fail", session_id=ctx.session.id)
        raise HTTPException(401, "Invalid credentials")
    ctx.session.step_up_at = now
    await audit.record(session, ctx.actor, "auth.step_up")
    await session.commit()
    return {"step_up_until": step_up_until(settings, ctx.session).isoformat()}


@router.post("/me/password", status_code=204)
async def change_password(body: PasswordIn, request: Request, ctx: AdminContext = Depends(require("viewer")),
                          session: AsyncSession = Depends(get_session)):
    if ctx.account_id is None:
        raise HTTPException(400, "Env account password is managed in .env")
    settings = request.app.state.settings
    now = datetime.now(timezone.utc)
    await _locked(request, session, ctx.actor.name, ctx.actor.ip, now)
    if not await check_password(session, settings, ctx.account_id, ctx.actor.name, body.current):
        await _failed(request, session, ctx.actor.name, ctx.actor.ip, now, "auth.password.fail",
                      session_id=ctx.session.id)
        raise HTTPException(401, "Invalid credentials")
    account = await session.get(AdminAccount, ctx.account_id)
    account.password_hash = hash_password(body.new)
    account.password_changed_at = now
    revoked = await sess.revoke_all(session, account_id=ctx.account_id, username=ctx.actor.name, now=now,
                                    except_id=ctx.session.id)
    await audit.record(session, ctx.actor, "auth.password.change", target_type="admin", target_id=ctx.actor.name,
                       summary=f"revoked {revoked} other sessions")
    await session.commit()
    return Response(status_code=204)


ENROLMENT_TTL = 600  # seconds between /me/totp/begin and /me/totp/confirm


@router.post("/me/totp/begin")
async def totp_begin(request: Request, ctx: AdminContext = Depends(require_self_step_up)):
    """Nothing is stored yet: `enrolment` is the server-encrypted {account, secret} the confirm step sends back.
    Step-up first (review M3): a hijacked session must not bind its own authenticator."""
    if ctx.account_id is None:
        raise HTTPException(400, "Env account TOTP is managed in .env")
    box = box_for(request.app.state.settings)
    if box is None:
        raise HTTPException(409, "Encryption key not configured")
    if ctx.totp_enabled:
        raise HTTPException(409, "TOTP already enabled")
    secret = totp.generate_secret()
    enrolment = box.encrypt(json.dumps({"a": ctx.account_id, "s": secret}))
    return {"secret": secret, "uri": totp.provisioning_uri(secret, ctx.actor.name), "enrolment": enrolment}


@router.post("/me/totp/confirm")
async def totp_confirm(body: TotpConfirmIn, request: Request, ctx: AdminContext = Depends(require_self_step_up),
                       session: AsyncSession = Depends(get_session)):
    """Binds only when no TOTP is bound (re-binding = disable with step-up, then bind), with an enrolment issued to
    this account within ENROLMENT_TTL (review M3)."""
    if ctx.account_id is None:
        raise HTTPException(400, "Env account TOTP is managed in .env")
    box = box_for(request.app.state.settings)
    if box is None:
        raise HTTPException(409, "Encryption key not configured")
    if ctx.totp_enabled:
        raise HTTPException(409, "TOTP already enabled")
    try:
        data = json.loads(box.decrypt(body.enrolment, ttl=ENROLMENT_TTL))
        secret = data["s"] if isinstance(data, dict) and data.get("a") == ctx.account_id else None
    except (SecretBoxError, ValueError, KeyError, TypeError):
        secret = None
    if not isinstance(secret, str):
        raise HTTPException(400, "Invalid enrolment")
    step = totp.verify(secret, body.code, time.time(), None)
    if step is None:
        raise HTTPException(400, "Invalid code")
    account = await session.get(AdminAccount, ctx.account_id)
    if account.totp_enc:  # bound meanwhile by a parallel request
        raise HTTPException(409, "TOTP already enabled")
    account.totp_enc, account.totp_last_step = box.encrypt(secret), step
    codes = await replace_recovery_codes(session, account.id)
    ctx.session.mfa_at = datetime.now(timezone.utc)
    await audit.record(session, ctx.actor, "auth.totp.enable", target_type="admin", target_id=ctx.actor.name)
    await session.commit()
    return {"recovery_codes": codes}


@router.delete("/me/totp", status_code=204)
async def totp_disable(ctx: AdminContext = Depends(require_self_step_up), session: AsyncSession = Depends(get_session)):
    if ctx.account_id is None:
        raise HTTPException(400, "Env account TOTP is managed in .env")
    account = await session.get(AdminAccount, ctx.account_id)
    account.totp_enc, account.totp_last_step = None, None
    await session.execute(delete(AdminRecoveryCode).where(AdminRecoveryCode.account_id == account.id))
    await audit.record(session, ctx.actor, "auth.totp.disable", target_type="admin", target_id=ctx.actor.name)
    await session.commit()
    return Response(status_code=204)
