"""/api/admin/wordbook*:词书统计、重新加载、例句举报(spec 2026-10-10-wordbook §9)。业务在 app/admin/wordbook_admin.py。"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import wordbook_admin
from app.admin.perms import AdminContext, require
from app.core.deps import get_session
from app.models import utcnow

router = APIRouter(prefix="/api/admin")


class ReasonIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=1, max_length=200)

    @field_validator("reason")
    @classmethod
    def _strip(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("reason is required")
        return value.strip()


class ReloadIn(ReasonIn):
    book_id: Literal["junior", "senior", "cet4", "cet6", "kaoyan", "toefl", "sat"] | None = None


@router.get("/wordbook")
async def wordbook_overview(request: Request, _: AdminContext = Depends(require("viewer")),
                            session: AsyncSession = Depends(get_session)):
    return await wordbook_admin.overview(session, request.app, utcnow())


@router.post("/wordbook/reload")
async def wordbook_reload(body: ReloadIn, request: Request, ctx: AdminContext = Depends(require("operator")),
                          session: AsyncSession = Depends(get_session)):
    await wordbook_admin.reload(session, request.app, ctx.actor, book_id=body.book_id, reason=body.reason)
    return {"ok": True}


@router.get("/wordbook/reports")
async def wordbook_reports(request: Request, _: AdminContext = Depends(require("viewer")),
                           session: AsyncSession = Depends(get_session)):
    return {"reports": await wordbook_admin.reports(session, request.app)}


@router.post("/wordbook/reports/{report_id}/{action}")
async def wordbook_resolve(body: ReasonIn, request: Request, report_id: int = Path(ge=1, le=2**31 - 1),
                           action: Literal["hide", "dismiss"] = Path(),
                           ctx: AdminContext = Depends(require("operator")),
                           session: AsyncSession = Depends(get_session)):
    try:
        await wordbook_admin.resolve(session, request.app, ctx.actor, report_id, action=action, reason=body.reason)
    except wordbook_admin.WordbookAdminError as e:
        raise HTTPException(e.status, e.message) from None
    return {"ok": True}
