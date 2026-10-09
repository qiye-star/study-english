"""运维端点(spec §9、§12、§13):公告、维护模式。薄端点:业务在 app.admin.*,写操作同一事务审计。"""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import announcements
from app.admin.announcements import AnnouncementError
from app.admin.perms import AdminContext, require, step_up_until
from app.core.deps import get_session

router = APIRouter(prefix="/api/admin")


def _error(e: AnnouncementError) -> JSONResponse:
    return JSONResponse({"error": e.message, **(e.details or {})} if e.status == 422 else
                        {"error": e.message, **({"details": e.details} if e.details else {})}, status_code=e.status)


# ---- announcements (operator) ----

class AnnouncementIn(BaseModel):
    level: Literal["info", "warning"]
    text_zh: str = Field(min_length=1, max_length=280)
    text_en: str = Field("", max_length=280)
    starts_at: datetime
    ends_at: datetime | None = None
    dismissible: bool = True


class AnnouncementPatch(BaseModel):
    level: Literal["info", "warning"] | None = None
    text_zh: str | None = Field(None, min_length=1, max_length=280)
    text_en: str | None = Field(None, max_length=280)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    dismissible: bool | None = None


@router.get("/announcements")
async def list_announcements(_: AdminContext = Depends(require("operator")),
                             session: AsyncSession = Depends(get_session)):
    return {"announcements": await announcements.listing(session)}


@router.post("/announcements", status_code=201)
async def create_announcement(body: AnnouncementIn, ctx: AdminContext = Depends(require("operator")),
                              session: AsyncSession = Depends(get_session)):
    try:
        row = await announcements.create(session, ctx.actor, body.model_dump())
    except AnnouncementError as e:
        return _error(e)
    await session.commit()
    return announcements.admin_out(row, datetime.now(timezone.utc))


@router.patch("/announcements/{announcement_id}")
async def update_announcement(announcement_id: int, body: AnnouncementPatch,
                              ctx: AdminContext = Depends(require("operator")),
                              session: AsyncSession = Depends(get_session)):
    data = body.model_dump(exclude_unset=True)
    if data.get("level") is None:
        data.pop("level", None)
    try:
        row = await announcements.update(session, ctx.actor, announcement_id, data)
    except AnnouncementError as e:
        return _error(e)
    await session.commit()
    return announcements.admin_out(row, datetime.now(timezone.utc))


@router.delete("/announcements/{announcement_id}")
async def archive_announcement(announcement_id: int, ctx: AdminContext = Depends(require("operator")),
                               session: AsyncSession = Depends(get_session)):
    try:
        row = await announcements.archive(session, ctx.actor, announcement_id)
    except AnnouncementError as e:
        return _error(e)
    await session.commit()
    return announcements.admin_out(row, datetime.now(timezone.utc))


# ---- maintenance (superadmin; turning it on also needs step-up + typed confirmation) ----

class MaintenanceIn(BaseModel):
    mode: Literal["off", "read_only", "full"] | None = None
    message_zh: str | None = Field(None, max_length=280)
    message_en: str | None = Field(None, max_length=280)
    reason: str = Field(max_length=200)
    confirm: str | None = Field(None, max_length=64)


@router.get("/maintenance")
async def get_maintenance(request: Request, _: AdminContext = Depends(require("operator"))):
    return announcements.maintenance_out(request.app.state.settings)


@router.post("/maintenance")
async def set_maintenance(body: MaintenanceIn, request: Request, ctx: AdminContext = Depends(require("superadmin")),
                          session: AsyncSession = Depends(get_session)):
    changes = {"maintenance_mode": body.mode, "maintenance_message_zh": body.message_zh,
               "maintenance_message_en": body.message_en}
    try:
        result = await announcements.set_maintenance(
            session, request.app, ctx.actor, changes, reason=body.reason, confirm=body.confirm,
            stepped_up=step_up_until(request.app.state.settings, ctx.session) is not None)
    except AnnouncementError as e:
        return _error(e)
    return {"revision": result.revision, "changed": result.changed,
            **announcements.maintenance_out(request.app.state.settings)}
