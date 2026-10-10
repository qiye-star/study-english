"""学习联动接口(spec 2026-10-11-learning-links §7.2、§11);各联动的子路由由 registry 挂进来。"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import current_user, get_session, limited_user
from app.links import prefs
from app.links.registry import LINKS, keys
from app.links.setup import config_out
from app.models import User, utcnow

router = APIRouter(prefix="/api/links")


class PrefIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, max_length=24)
    enabled: bool


@router.get("/config")
async def get_config(request: Request, user: User = Depends(current_user),
                     session: AsyncSession = Depends(get_session)):
    return await config_out(request.app, session, user.id)


@router.put("/prefs")
async def put_pref(payload: PrefIn, request: Request, user: User = Depends(limited_user),
                   session: AsyncSession = Depends(get_session)):
    if not request.app.state.settings.links_enabled:
        raise HTTPException(404, "Links are disabled")
    if payload.key not in keys():
        raise HTTPException(422, "Unknown link")
    await prefs.save(session, user.id, payload.key, payload.enabled, utcnow())
    request.app.state.link_gate.invalidate(user.id)
    return await config_out(request.app, session, user.id)


for _spec in LINKS:
    if _spec.router is not None:
        router.include_router(_spec.router)
