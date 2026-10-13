"""/api/admin/library*:跟读库总览、条目、占用排行、单个用户占用;删除 / 取消 / 清理失败项(spec 2026-10-13-video-import §12)。
业务在 app/admin/library_admin.py。URL 里只有条目 uuid、用户 id、状态、种类与页码(没有标题或网址)。"""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import library_admin
from app.admin.perms import AdminContext, require
from app.core.deps import get_session
from app.models import utcnow

router = APIRouter(prefix="/api/admin/library")
ItemUuid = Annotated[str, Path(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")]
UserId = Annotated[int, Path(ge=1, le=2**31 - 1)]
Status = Literal["uploading", "queued", "processing", "ready", "failed", "canceled"]


def _error(e: library_admin.LibraryAdminError) -> JSONResponse:
    body: dict = {"error": e.message}
    if e.details:
        body["details"] = e.details
    return JSONResponse(body, status_code=e.status)


@router.get("")
async def library_overview(request: Request, _: AdminContext = Depends(require("viewer")),
                           session: AsyncSession = Depends(get_session)):
    return await library_admin.overview(session, request.app, utcnow())


@router.get("/items")
async def library_items(_: AdminContext = Depends(require("viewer")), session: AsyncSession = Depends(get_session),
                        status: Status | None = Query(None), kind: Literal["audio", "video"] | None = Query(None),
                        user_id: int | None = Query(None, ge=1, le=2**31 - 1),
                        page: int = Query(1, ge=1, le=10_000)):
    return await library_admin.items(session, status=status, user_id=user_id, kind=kind, page=page)


@router.get("/top-users")
async def library_top_users(_: AdminContext = Depends(require("viewer")),
                            session: AsyncSession = Depends(get_session)):
    return {"users": await library_admin.top_users(session)}


@router.get("/users/{user_id}")
async def library_user(user_id: UserId, request: Request, _: AdminContext = Depends(require("viewer")),
                       session: AsyncSession = Depends(get_session)):
    try:
        return await library_admin.user_usage(session, request.app.state.settings, user_id, utcnow())
    except library_admin.LibraryAdminError as e:
        return _error(e)
