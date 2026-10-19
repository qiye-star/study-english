import asyncio
import re
import secrets
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.account_policy import binding_deadline, binding_state
from app.core.config import Settings
from app.core import quotas
from app.core.deps import auth_rate_limit, client_ip, current_user_unbound, get_session, get_settings
from app.models import AccessToken, User, display_of, utcnow
from app.core.security import hash_password, verify_password
from app.services import avatars, email_accounts, identities, invites
from app.services.email_accounts import INVALID_CODE
from app.services.email_domains import domain_allowed
from app.services.identities import email_ready, normalize_email
from app.services.nicknames import INVALID_DETAIL, clean_nickname, nickname_taken_by_login
from app.services.verification import VerificationError

router = APIRouter(prefix="/api")

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,32}$")
INVALID_LOGIN = "Invalid username or password"
# 用户不存在时也做一次等耗时的校验,避免通过响应时间枚举用户名。
_DUMMY_HASH = hash_password("dummy-password")


class LoginIn(BaseModel):
    provider: str = "password"
    username: str = Field(max_length=254)  # a login name or an email address (spec 4.3)
    password: str = Field(max_length=128)


class RegisterIn(BaseModel):
    username: str
    password: str = Field(min_length=8, max_length=128)
    invite_code: str | None = None
    nickname: str | None = None
    email: str | None = Field(None, max_length=254)  # used only while EMAIL_REGISTRATION_REQUIRED is on (INDEX X11)
    email_code: str | None = Field(None, max_length=16)

    @field_validator("email")
    @classmethod
    def _normalise_email(cls, value: str | None) -> str | None:
        return None if value is None else normalize_email(value)  # fixed message, never echoes the address

    @field_validator("nickname")
    @classmethod
    def _clean_nickname(cls, value: str | None) -> str | None:
        return None if value is None else clean_nickname(value)

    @field_validator("username")
    @classmethod
    def _normalize_username(cls, value: str) -> str:
        value = value.strip().lower()
        if not USERNAME_RE.match(value):
            raise ValueError("must be 3-32 characters of letters, digits or underscore")
        return value


class EmailBindingOut(BaseModel):
    state: Literal["none", "pending", "enforced"]
    deadline: str | None  # always present (null when not applicable)


class UserOut(BaseModel):
    id: str
    name: str  # the login name (INDEX X7: kept for the desktop client)
    created_at: datetime
    access_token: str | None = None
    nickname: str | None = None  # absent when unset
    display_name: str
    avatar_url: str | None = None  # relative /api/avatars/<id> (INDEX X17); absent when there is no avatar
    email_masked: str | None = None  # only on /api/me, absent when there is no email
    email_verified: bool | None = None  # only on /api/me
    email_binding: EmailBindingOut | None = None  # only on /api/me


def _user_out(user: User, token: str | None = None) -> UserOut:
    return UserOut(id=str(user.id), name=user.username, created_at=user.created_at, access_token=token,
                   nickname=user.nickname, display_name=display_of(user),
                   avatar_url=avatars.avatar_url(user.avatar_id))


async def _get_by_username(session: AsyncSession, username: str) -> User | None:
    result = await session.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()


async def _issue_token(session: AsyncSession, user: User, settings: Settings) -> str:
    token = identities.issue_token(session, user.id, settings, utcnow())
    await session.commit()
    return token


def _new_user_id() -> int:
    return secrets.randbelow(90_000_000) + 10_000_000


def _require_email_fields(payload: RegisterIn, settings: Settings) -> None:
    """INDEX X11 / R-F7: the checks that need no lookup. Nothing here depends on whether an address is registered."""
    if payload.email is None:
        raise HTTPException(400, "Email verification required: please register in the web app")  # desktop-visible text
    if not email_ready(settings):
        raise HTTPException(503, "Email is not configured")
    if payload.nickname is None:
        raise HTTPException(422, "nickname: Field required")
    if payload.email_code is None:
        raise HTTPException(422, "email_code: Field required")
    if not domain_allowed(settings, payload.email):
        raise HTTPException(422, "Email domain not allowed")


def _user_cap(request: Request, session: AsyncSession):
    """The live per-owner cap of a user code (invites v2 X19): read at each redemption, passed into the service."""
    async def cap(owner_id: int) -> int:
        return await quotas.effective(session, request.app, owner_id, "invites_user_code_max_uses")
    return cap


def _invite_rejected(request: Request, reason: str) -> HTTPException:
    """A failed invite attempt counts against its IP (invites v2 R-I5). The two answers are the existing pair:
    'invalid' and 'used up'; nothing else says whether a code exists."""
    request.app.state.invite_fail_limiter.allow(client_ip(request))
    return HTTPException(403, "Invite code used up" if reason == "used_up" else "Invalid invite code")


async def _register_with_email(payload: RegisterIn, request: Request, session: AsyncSession, settings: Settings,
                               password_hash: str, db_code: bool) -> UserOut:
    try:
        user, token = await email_accounts.register_with_email(
            session, settings, username=payload.username, password_hash=password_hash,
            nickname=payload.nickname, email=payload.email, code=payload.email_code,
            invite_code=(payload.invite_code or "") if db_code else None, new_user_id=_new_user_id, now=utcnow(),
            user_cap=_user_cap(request, session))
    except VerificationError:
        raise HTTPException(400, INVALID_CODE) from None
    except email_accounts.InviteRejected as e:
        raise _invite_rejected(request, e.reason) from None
    except email_accounts.UsernameTaken:
        raise HTTPException(409, "Username already taken") from None
    except email_accounts.IdAllocationFailed:
        raise HTTPException(500, "Could not allocate a user id") from None
    return _user_out(user, token)


@router.post(
    "/users",
    response_model=UserOut,
    response_model_exclude_none=True,
    dependencies=[Depends(auth_rate_limit)],
)
async def register(
    payload: RegisterIn,
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    if settings.registration_mode == "closed":
        raise HTTPException(403, "Registration is closed")
    response.headers["Cache-Control"] = "no-store"  # the body carries a login token
    # invites v2 R-I5: an IP that has used up its bad-code allowance is refused before any code is looked at
    if settings.registration_mode == "invite" and payload.invite_code and request.app.state.invite_fail_limiter.exhausted(
            client_ip(request)):
        raise HTTPException(429, "Too many requests, please try again later")
    if settings.email_registration_required:
        _require_email_fields(payload, settings)
    # a nickname may equal this account's own new login name, but not anyone else's (same fixed 422 as any bad nickname)
    if (payload.nickname is not None and payload.nickname.casefold() != payload.username
            and await nickname_taken_by_login(session, payload.nickname, None)):
        raise HTTPException(422, INVALID_DETAIL)
    # invite mode: the env INVITE_CODE (unlimited) or one use of a live DB code (admin v2 §7). The DB use is
    # taken in the same transaction as the new user, so a failed registration (409) does not consume it.
    db_code = settings.registration_mode == "invite" and not (
        settings.invite_code and secrets.compare_digest((payload.invite_code or "").encode(),
                                                        settings.invite_code.encode()))

    password_hash = await asyncio.to_thread(hash_password, payload.password)  # before any lookup (R-F7)
    if settings.email_registration_required:
        return await _register_with_email(payload, request, session, settings, password_hash, db_code)
    if await _get_by_username(session, payload.username) is not None:  # before any invite is looked at (no oracle)
        raise HTTPException(409, "Username already taken")
    user_cap = _user_cap(request, session)
    for _ in range(5):
        code_row = None
        if db_code:
            try:
                code_row = await invites.redeem(session, payload.invite_code or "", utcnow(), user_cap=user_cap)
            except invites.RedeemError as e:
                await session.rollback()
                raise _invite_rejected(request, e.reason) from None
        user = User(id=_new_user_id(), username=payload.username, password_hash=password_hash,
                    nickname=payload.nickname)
        session.add(user)
        if code_row is not None:  # the attribution row goes in the same commit as the user (invites v2 R-I4)
            invites.record_redemption(session, code_row, user.id, utcnow())
        try:
            await session.commit()
            break
        except IntegrityError:
            await session.rollback()
            if await _get_by_username(session, payload.username):
                raise HTTPException(409, "Username already taken")
    else:
        raise HTTPException(500, "Could not allocate a user id")

    return _user_out(user, await _issue_token(session, user, settings))


@router.post(
    "/sessions",
    response_model=UserOut,
    response_model_exclude_none=True,
    dependencies=[Depends(auth_rate_limit)],
)
async def login(
    payload: LoginIn,
    response: Response,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    if payload.provider != "password":
        raise HTTPException(400, "Unsupported login provider")
    response.headers["Cache-Control"] = "no-store"  # the body carries a login token
    typed = payload.username.strip().lower()
    # login names cannot contain "@", so it only ever means an email; a malformed or unknown address takes the
    # same dummy-hash path as an unknown user name (equal time, one 401 text)
    user = (await identities.find_user_by_email(session, settings, typed) if "@" in typed
            else await _get_by_username(session, typed))
    if user is None:
        await asyncio.to_thread(verify_password, _DUMMY_HASH, payload.password)
        raise HTTPException(401, INVALID_LOGIN)
    if not await asyncio.to_thread(verify_password, user.password_hash, payload.password):
        raise HTTPException(401, INVALID_LOGIN)
    if user.disabled_at is not None:  # after the password check: wrong passwords learn nothing about the account
        raise HTTPException(403, "Account disabled")
    return _user_out(user, await _issue_token(session, user, settings))


@router.get("/me", response_model=None)  # a dict: the nested deadline must stay a real null
async def me(
    request: Request,
    user: User = Depends(current_user_unbound),  # must keep working while binding is enforced (INDEX X3)
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    out = _user_out(user)
    out.email_verified = user.email_verified_at is not None
    out.email_masked = await identities.masked_email(session, settings, user)
    body = out.model_dump(mode="json", exclude_none=True)  # an unset nickname / email_masked is absent ...
    body["email_binding"] = EmailBindingOut(state=binding_state(settings, utcnow()),
                                            deadline=binding_deadline(settings)).model_dump()  # ... deadline is a real null
    return body


@router.delete("/sessions/current", status_code=204)
async def logout(
    request: Request,
    _: User = Depends(current_user_unbound),
    session: AsyncSession = Depends(get_session),
):
    """Delete only the token this request used; other devices stay signed in."""
    await session.execute(delete(AccessToken).where(AccessToken.id == request.state.access_token_id))
    await session.commit()
    return Response(status_code=204)
