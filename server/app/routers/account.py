"""账号端点:改密(P1)、公开发码(P2);后续计划在此追加找回密码、绑定邮箱(INDEX X31:路由只做 HTTP,逻辑在 services/)。"""
import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.deps import (auth_rate_limit, client_ip, current_user, current_user_unbound, get_session,
                           get_settings)
from app.core.security import hash_password, verify_password
from app.routers import captcha_guard
from app.models import User, display_of, utcnow
from app.routers.live_connections import cut_connections
from app.services import email_accounts, email_codes, identities
from app.services.email_domains import domain_allowed
from app.services.identities import email_ready, mask_email, normalize_email
from app.services.email_accounts import INVALID_CODE
from app.services.verification import COOLDOWN, VerificationError
from app.services.nicknames import INVALID_DETAIL, clean_nickname, nickname_taken_by_login

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


class NicknameIn(BaseModel):
    nickname: str | None  # required key: null clears the nickname

    @field_validator("nickname")
    @classmethod
    def _clean(cls, value: str | None) -> str | None:
        return None if value is None else clean_nickname(value)


class EmailCodeIn(BaseModel):
    email: str = Field(max_length=254)
    purpose: Literal["register", "reset"]

    @field_validator("email")
    @classmethod
    def _normalise(cls, value: str) -> str:
        return normalize_email(value)  # fixed message, never echoes the address


TOO_MANY_CODES = "Too many codes, please wait"


def _mail_language(request: Request) -> str:
    """`zh` or `en` from the first Accept-Language tag; anything else gets Chinese (the default)."""
    first = request.headers.get("accept-language", "").split(",")[0].strip().lower()
    return "en" if first == "en" or first.startswith("en-") else "zh-CN"


class PasswordResetIn(BaseModel):
    email: str = Field(max_length=254)
    code: str = Field(max_length=16)
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def _normalise(cls, value: str) -> str:
        return normalize_email(value)  # fixed message, never echoes the address


class BindCodeIn(BaseModel):
    email: str = Field(max_length=254)
    purpose: Literal["bind", "change_email"] | None = None  # optional: the account state decides; a mismatch is a 409
    current_password: str | None = Field(None, max_length=128)  # required for change_email

    @field_validator("email")
    @classmethod
    def _normalise(cls, value: str) -> str:
        return normalize_email(value)  # fixed message, never echoes the address


class BindIn(BindCodeIn):
    code: str = Field(max_length=16)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


@router.patch("/me")
async def update_me(
    payload: NicknameIn,
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Set or clear the display nickname (R-F12: 10 changes per user per hour). Returns the two name fields."""
    if not request.app.state.nickname_limiter.allow(str(user.id)):
        raise HTTPException(429, "Too many requests, please try again later")
    if payload.nickname is not None and await nickname_taken_by_login(session, payload.nickname, user.id):
        raise HTTPException(422, INVALID_DETAIL)  # same text as any invalid nickname: the rule is not revealed
    user.nickname = payload.nickname
    await session.commit()
    return {"nickname": user.nickname, "display_name": display_of(user)}


@router.post("/me/password", dependencies=[Depends(auth_rate_limit)])
async def change_password(
    payload: PasswordChangeIn,
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    """Every other login is signed out; the caller gets one fresh token. Live calls and rooms are cut."""
    if not await asyncio.to_thread(verify_password, user.password_hash, payload.current_password):
        raise HTTPException(403, "Wrong password")
    new_hash = await asyncio.to_thread(hash_password, payload.new_password)
    token = await identities.change_password(session, user, new_hash, settings, utcnow())
    await session.commit()  # one transaction: the new password and the rotated tokens land together
    try:
        await cut_connections(request.app, user.id)
    except Exception as exc:  # the password is already changed: the caller must still get the new token
        logger.warning("cut_connections failed after a password change: %s", type(exc).__name__)
    return JSONResponse({"access_token": token}, headers={"Cache-Control": "no-store"})


@router.post("/email/code", dependencies=[Depends(auth_rate_limit)])
async def email_code(
    payload: EmailCodeIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    """Ask for a sign-up or password-reset code. Registered and unknown addresses get the same answer (INDEX X10);
    the mail is sent by a background task."""
    if not email_ready(settings):
        raise HTTPException(503, "Email is not configured")
    await captcha_guard.enforce(request, session, "email_code")
    if not request.app.state.email_ip_limiter.allow(client_ip(request)):
        raise HTTPException(429, TOO_MANY_CODES)
    if not domain_allowed(settings, payload.email):
        raise HTTPException(422, "Email domain not allowed")
    try:
        await email_codes.request_code(session, settings, request.app.state.mailer, payload.email, payload.purpose,
                                       utcnow(), _mail_language(request))
    except VerificationError as exc:
        if exc.kind == "global_daily":
            raise HTTPException(503, "Email temporarily unavailable") from None
        raise HTTPException(429, TOO_MANY_CODES, headers={"Retry-After": str(exc.retry_after or 60)}) from None
    return {"ok": True, "cooldown_seconds": int(COOLDOWN.total_seconds())}


@router.post("/password/reset", status_code=204, dependencies=[Depends(auth_rate_limit)])
async def reset_password(
    payload: PasswordResetIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    """Forgot password: an emailed code sets a new one. Every login is signed out and nobody is logged in (no token).
    Every failure, an address nobody owns included, is the same 400."""
    if not email_ready(settings):
        raise HTTPException(503, "Email is not configured")
    await captcha_guard.enforce(request, session, "reset")
    password_hash = await asyncio.to_thread(hash_password, payload.new_password)  # before any lookup: equal work
    try:
        user_id = await email_accounts.reset_password(
            session, settings, email=payload.email, code=payload.code,
            password_hash=password_hash, now=utcnow())
    except VerificationError:
        raise HTTPException(400, INVALID_CODE) from None
    try:
        await cut_connections(request.app, user_id)
    except Exception as exc:  # the password is already reset: the answer stays 204
        logger.warning("cut_connections failed after a password reset: %s", type(exc).__name__)
    return Response(status_code=204)


def _bind_purpose(user: User, declared: str | None) -> str:
    """`change_email` when the account already has a verified email, else `bind`. A client that names the other one
    gets a 409 (it concerns the caller's own account only)."""
    purpose = "change_email" if user.email_verified_at is not None else "bind"
    if declared is not None and declared != purpose:
        raise HTTPException(409, "Email already bound" if purpose == "change_email" else "No email to change")
    return purpose


async def _require_password_for_change(user: User, purpose: str, password: str | None) -> None:
    if purpose == "change_email" and (
            password is None or not await asyncio.to_thread(verify_password, user.password_hash, password)):
        raise HTTPException(403, "Wrong password")


@router.post("/me/email/code", dependencies=[Depends(auth_rate_limit)])
async def me_email_code(
    payload: BindCodeIn,
    request: Request,
    user: User = Depends(current_user_unbound),  # a user who is forced to bind must reach this (INDEX X3)
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    """Mail a code to the address the signed-in user wants to bind or switch to. An address another account owns
    gets a notice instead and the same answer (R-F6)."""
    if not email_ready(settings):
        raise HTTPException(503, "Email is not configured")
    await captcha_guard.enforce(request, session, "email_code")
    purpose = _bind_purpose(user, payload.purpose)
    await _require_password_for_change(user, purpose, payload.current_password)
    if not request.app.state.email_ip_limiter.allow(client_ip(request)):
        raise HTTPException(429, TOO_MANY_CODES)
    if not domain_allowed(settings, payload.email):
        raise HTTPException(422, "Email domain not allowed")
    try:
        await email_codes.request_bound_code(session, settings, request.app.state.mailer, user.id, payload.email,
                                             purpose, utcnow(), _mail_language(request))
    except VerificationError as exc:
        if exc.kind == "global_daily":
            raise HTTPException(503, "Email temporarily unavailable") from None
        raise HTTPException(429, TOO_MANY_CODES, headers={"Retry-After": str(exc.retry_after or 60)}) from None
    return {"ok": True, "cooldown_seconds": int(COOLDOWN.total_seconds())}


@router.post("/me/email", dependencies=[Depends(auth_rate_limit)])
async def me_email(
    payload: BindIn,
    request: Request,
    user: User = Depends(current_user_unbound),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    """Attach (or switch to) the verified address. Other logins stay signed in. The address is masked in the answer."""
    if not email_ready(settings):
        raise HTTPException(503, "Email is not configured")
    purpose = _bind_purpose(user, payload.purpose)
    await _require_password_for_change(user, purpose, payload.current_password)
    try:
        await email_accounts.bind_with_code(session, settings, user,
                                            email=payload.email, code=payload.code, purpose=purpose, now=utcnow())
    except VerificationError:
        raise HTTPException(400, INVALID_CODE) from None
    return {"email_masked": mask_email(payload.email), "email_verified": True}
