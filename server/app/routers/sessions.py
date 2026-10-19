import asyncio
import re
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.deps import auth_rate_limit, current_user_unbound, get_session, get_settings
from app.models import AccessToken, User, display_of, utcnow
from app.core.security import hash_password, verify_password
from app.services import identities, invites
from app.services.nicknames import clean_nickname

router = APIRouter(prefix="/api")

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,32}$")
INVALID_LOGIN = "Invalid username or password"
# 用户不存在时也做一次等耗时的校验,避免通过响应时间枚举用户名。
_DUMMY_HASH = hash_password("dummy-password")


class LoginIn(BaseModel):
    provider: str = "password"
    username: str = Field(max_length=64)
    password: str = Field(max_length=128)


class RegisterIn(BaseModel):
    username: str
    password: str = Field(min_length=8, max_length=128)
    invite_code: str | None = None
    nickname: str | None = None

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


class UserOut(BaseModel):
    id: str
    name: str  # the login name (INDEX X7: kept for the desktop client)
    created_at: datetime
    access_token: str | None = None
    nickname: str | None = None  # absent when unset
    display_name: str


def _user_out(user: User, token: str | None = None) -> UserOut:
    return UserOut(id=str(user.id), name=user.username, created_at=user.created_at, access_token=token,
                   nickname=user.nickname, display_name=display_of(user))


async def _get_by_username(session: AsyncSession, username: str) -> User | None:
    result = await session.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()


async def _issue_token(session: AsyncSession, user: User, settings: Settings) -> str:
    token = identities.issue_token(session, user.id, settings, utcnow())
    await session.commit()
    return token


def _new_user_id() -> int:
    return secrets.randbelow(90_000_000) + 10_000_000


@router.post(
    "/users",
    response_model=UserOut,
    response_model_exclude_none=True,
    dependencies=[Depends(auth_rate_limit)],
)
async def register(
    payload: RegisterIn,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    if settings.registration_mode == "closed":
        raise HTTPException(403, "Registration is closed")
    # invite mode: the env INVITE_CODE (unlimited) or one use of a live DB code (admin v2 §7). The DB use is
    # taken in the same transaction as the new user, so a failed registration (409) does not consume it.
    db_code = settings.registration_mode == "invite" and not (
        settings.invite_code and secrets.compare_digest((payload.invite_code or "").encode(),
                                                        settings.invite_code.encode()))

    password_hash = await asyncio.to_thread(hash_password, payload.password)
    for _ in range(5):
        if db_code and not await invites.consume(session, payload.invite_code or "", utcnow()):
            await session.rollback()
            raise HTTPException(403, "Invalid invite code")
        user = User(id=_new_user_id(), username=payload.username, password_hash=password_hash,
                    nickname=payload.nickname)
        session.add(user)
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
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    if payload.provider != "password":
        raise HTTPException(400, "Unsupported login provider")
    user = await _get_by_username(session, payload.username.strip().lower())
    if user is None:
        await asyncio.to_thread(verify_password, _DUMMY_HASH, payload.password)
        raise HTTPException(401, INVALID_LOGIN)
    if not await asyncio.to_thread(verify_password, user.password_hash, payload.password):
        raise HTTPException(401, INVALID_LOGIN)
    if user.disabled_at is not None:  # after the password check: wrong passwords learn nothing about the account
        raise HTTPException(403, "Account disabled")
    return _user_out(user, await _issue_token(session, user, settings))


@router.get("/me", response_model=UserOut, response_model_exclude_none=True)
async def me(user: User = Depends(current_user_unbound)):
    return _user_out(user)


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
