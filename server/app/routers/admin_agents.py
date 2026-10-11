"""/api/admin/agents*:智能体总览、角色审核、举报、函数调用探测(spec 2026-10-12-agents §10.2)。业务在 app/admin/agents_admin.py。
角色搜索用 POST JSON(R-C26):搜索词不进访问日志。"""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import agents_admin
from app.admin.perms import AdminContext, require, require_step_up
from app.core.deps import get_session
from app.models import utcnow

router = APIRouter(prefix="/api/admin/agents")
PersonaUuid = Annotated[str, Path(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")]


class ReasonIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=1, max_length=200)

    @field_validator("reason")
    @classmethod
    def _strip(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("reason is required")
        return value.strip()


class EditIn(ReasonIn):
    name: str | None = Field(default=None, max_length=200)
    intro: str | None = Field(default=None, max_length=400)
    prompt: str | None = Field(default=None, max_length=8000)


class ResolveIn(ReasonIn):
    action: Literal["dismiss", "disable"]


class QueryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    q: str | None = Field(default=None, max_length=40)
    status: Literal["all", "active", "disabled", "reported"] = "all"
    page: int = Field(default=1, ge=1, le=10000)


def _http(e: agents_admin.AgentsAdminError) -> HTTPException:
    return HTTPException(e.status, e.message)


@router.get("")
async def agents_overview(request: Request, _: AdminContext = Depends(require("viewer")),
                          session: AsyncSession = Depends(get_session)):
    return await agents_admin.overview(session, request.app, utcnow())


@router.post("/personas/query")
async def personas_query(body: QueryIn, _: AdminContext = Depends(require("viewer")),
                         session: AsyncSession = Depends(get_session)):
    return await agents_admin.personas(session, q=(body.q or "").strip() or None, status=body.status, page=body.page)


@router.post("/personas/{persona_id}/delete")  # registered before the {action} route below
async def persona_delete(body: ReasonIn, persona_id: PersonaUuid, ctx: AdminContext = Depends(require_step_up),
                         session: AsyncSession = Depends(get_session)):
    try:
        return await agents_admin.remove(session, ctx.actor, persona_id, reason=body.reason)
    except agents_admin.AgentsAdminError as e:
        raise _http(e) from None


@router.post("/personas/{persona_id}/{action}")
async def persona_toggle(body: ReasonIn, persona_id: PersonaUuid, action: Literal["disable", "restore"] = Path(),
                         ctx: AdminContext = Depends(require("operator")),
                         session: AsyncSession = Depends(get_session)):
    try:
        return await agents_admin.set_disabled(session, ctx.actor, persona_id, disabled=action == "disable",
                                               reason=body.reason, now=utcnow())
    except agents_admin.AgentsAdminError as e:
        raise _http(e) from None


@router.patch("/personas/{persona_id}")
async def persona_edit(body: EditIn, request: Request, persona_id: PersonaUuid,
                       ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    changes = body.model_dump(exclude={"reason"}, exclude_none=True)
    try:
        return await agents_admin.edit(session, ctx.actor, persona_id, changes, reason=body.reason,
                                       max_prompt_chars=request.app.state.settings.agents_prompt_max_chars,
                                       now=utcnow())
    except agents_admin.AgentsAdminError as e:
        raise _http(e) from None


@router.get("/reports")
async def persona_reports(_: AdminContext = Depends(require("viewer")), session: AsyncSession = Depends(get_session)):
    return {"reports": await agents_admin.reports(session)}


@router.post("/reports/{persona_id}/resolve")
async def persona_reports_resolve(body: ResolveIn, persona_id: PersonaUuid,
                                  ctx: AdminContext = Depends(require("operator")),
                                  session: AsyncSession = Depends(get_session)):
    try:
        return await agents_admin.resolve(session, ctx.actor, persona_id, action=body.action, reason=body.reason,
                                          now=utcnow())
    except agents_admin.AgentsAdminError as e:
        raise _http(e) from None


@router.post("/probe-tools")
async def probe_tools(request: Request, ctx: AdminContext = Depends(require("operator")),
                      session: AsyncSession = Depends(get_session)):
    return await agents_admin.probe_tools(session, request.app, ctx.actor)
