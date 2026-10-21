"""/api/admin/library/catalog/{id}/roles*:精选库的角色标注与智能建议(plan L5 S10)。业务在 app/admin/catalog_roles.py。

不受 `DUBBING_ENABLED` 影响(管理员可以提前标注)。URL 里只有 uuid;查询参数为空。
读取要 viewer,写入与建议要 operator。错误串与 `admin_catalog.py` 同一做法(`CatalogAdminError`)。
"""
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import catalog_admin, catalog_roles
from app.admin.perms import AdminContext, require
from app.core.deps import get_session

router = APIRouter(prefix="/api/admin/library/catalog")
CatalogUuid = Annotated[str, Path(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")]


def _error(e: catalog_admin.CatalogAdminError) -> JSONResponse:
    body: dict = {"error": e.message}
    if e.details:
        body["details"] = e.details
    return JSONResponse(body, status_code=e.status)


async def _guard(session: AsyncSession, call):
    try:
        return await call()
    except catalog_admin.CatalogAdminError as e:
        await session.rollback()
        return _error(e)


class SpeakerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idx: int
    speaker: str | None = None


class RolesIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    names: dict[str, str | None] = Field(default_factory=dict)
    speakers: list[SpeakerIn] = Field(default_factory=list)


class SuggestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seg_from: int = Field(ge=0, le=1_000_000)
    seg_to: int = Field(ge=0, le=1_000_000)


@router.get("/{catalog_id}/roles")
async def catalog_roles_get(catalog_id: CatalogUuid, ctx: AdminContext = Depends(require("viewer")),
                            session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_roles.get_roles(session, catalog_id))


@router.put("/{catalog_id}/roles")
async def catalog_roles_put(catalog_id: CatalogUuid, body: RolesIn, ctx: AdminContext = Depends(require("operator")),
                            session: AsyncSession = Depends(get_session)):
    speakers = [entry.model_dump() for entry in body.speakers]
    return await _guard(session, lambda: catalog_roles.put_roles(session, ctx.actor, catalog_id, names=body.names,
                                                                 speakers=speakers))


@router.post("/{catalog_id}/roles/suggest")
async def catalog_roles_suggest(catalog_id: CatalogUuid, body: SuggestIn, request: Request,
                                ctx: AdminContext = Depends(require("operator")),
                                session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_roles.suggest(session, request.app, ctx.actor, catalog_id,
                                                               seg_from=body.seg_from, seg_to=body.seg_to))
