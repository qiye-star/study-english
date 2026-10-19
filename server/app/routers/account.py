"""账号端点:改密(P1);后续计划在此追加邮箱验证码、找回密码、绑定邮箱(INDEX X31:路由只做 HTTP,逻辑在 services/)。"""
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.deps import auth_rate_limit, current_user, get_session, get_settings
from app.core.security import hash_password, verify_password
from app.models import User, utcnow
from app.routers.live_connections import cut_connections
from app.services import identities

router = APIRouter(prefix="/api")


class PasswordChangeIn(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


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
    user.password_hash = await asyncio.to_thread(hash_password, payload.new_password)
    await identities.revoke_sessions(session, user.id)
    token = identities.issue_token(session, user.id, settings, utcnow())
    await session.commit()  # one transaction: the new password and the rotated tokens land together
    await cut_connections(request.app, user.id)
    return JSONResponse({"access_token": token}, headers={"Cache-Control": "no-store"})
