"""账号端点:改密(P1);后续计划在此追加邮箱验证码、找回密码、绑定邮箱(INDEX X31:路由只做 HTTP,逻辑在 services/)。"""
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.deps import auth_rate_limit, current_user, get_session, get_settings
from app.core.security import hash_password, verify_password
from app.models import User, display_of, utcnow
from app.routers.live_connections import cut_connections
from app.services import identities
from app.services.nicknames import INVALID_DETAIL, clean_nickname, nickname_taken_by_login

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")


class NicknameIn(BaseModel):
    nickname: str | None  # required key: null clears the nickname

    @field_validator("nickname")
    @classmethod
    def _clean(cls, value: str | None) -> str | None:
        return None if value is None else clean_nickname(value)


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
