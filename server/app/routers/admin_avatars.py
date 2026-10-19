"""头像管理端(计划 S7、R-V7):`/api/admin/avatar-reports`、`/api/admin/users/{id}/avatar`。每个端点声明最低角色。
薄端点:逻辑在 `app/admin/avatars_admin.py`(INDEX X31)。新增路由要同时加入 `tests/test_admin_avatars.py` 的覆盖。"""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import avatars_admin
from app.admin.perms import AdminContext, require, require_operator_step_up
from app.core.deps import get_session
from app.models import utcnow

router = APIRouter(prefix="/api/admin")

UserId = Annotated[int, Path(ge=1, le=2**31 - 1)]
Page = Annotated[int, Query(ge=1, le=10_000)]


class ReasonIn(BaseModel):
    reason: str = Field(min_length=1, max_length=200)

    @field_validator("reason")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("reason is required")
        return value


def _fail(e: avatars_admin.AvatarAdminError):
    raise HTTPException(e.status, e.error) from None


@router.get("/avatar-reports")
async def list_avatar_reports(status: Literal["open", "resolved"] = "open", page: Page = 1,
                              _: AdminContext = Depends(require("viewer")),
                              session: AsyncSession = Depends(get_session)):
    return await avatars_admin.reports(session, status=status, page=page)


@router.delete("/users/{user_id}/avatar")
async def remove_user_avatar(user_id: UserId, payload: ReasonIn, request: Request,
                             ctx: AdminContext = Depends(require_operator_step_up),
                             session: AsyncSession = Depends(get_session)):
    try:
        return await avatars_admin.remove(session, ctx.actor, request.app.state.settings, user_id,
                                          reason=payload.reason, now=utcnow())
    except avatars_admin.AvatarAdminError as e:
        _fail(e)


@router.post("/avatar-reports/{user_id}/dismiss")
async def dismiss_avatar_reports(user_id: UserId, ctx: AdminContext = Depends(require("operator")),
                                 session: AsyncSession = Depends(get_session)):
    try:
        return await avatars_admin.dismiss(session, ctx.actor, user_id, now=utcnow())
    except avatars_admin.AvatarAdminError as e:
        _fail(e)
