"""更新日志管理端(spec 2026-10-14-changelog-design §2.1、D6):`/api/admin/changelog`。读 = viewer,写 = operator(`perms.require`);
写操作与审计同一事务,审计只记条目 id 与动作。薄端点:逻辑在 `app/admin/changelog.py`。
新增路由要同时改 `tests/test_changelog_privacy.py` 里钉住的路由表。"""
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import changelog
from app.admin.changelog import ChangelogError
from app.admin.perms import AdminContext, require
from app.core.deps import get_session

router = APIRouter(prefix="/api/admin/changelog")


class EntryIn(BaseModel):
    """Loose on purpose: lengths, dates and tags are checked key by key in `changelog.validate` (R-8)."""
    model_config = ConfigDict(extra="forbid")
    entry_date: str | None = None
    version: str | None = None
    title_zh: str | None = None
    title_en: str | None = None
    items: list[dict[str, Any]] | None = None


def _error(e: ChangelogError) -> JSONResponse:
    payload: dict[str, Any] = {"error": e.message}
    if e.fields:
        payload["fields"] = e.fields
    return JSONResponse(payload, status_code=e.status)


@router.get("")
async def list_entries(_: AdminContext = Depends(require("viewer")), session: AsyncSession = Depends(get_session)):
    return {"entries": await changelog.admin_listing(session)}


@router.post("", status_code=201)
async def create_entry(body: EntryIn, ctx: AdminContext = Depends(require("operator")),
                       session: AsyncSession = Depends(get_session)):
    try:
        row = await changelog.create(session, ctx.actor, body.model_dump())
    except ChangelogError as e:
        return _error(e)
    await session.commit()
    return changelog.admin_out(row)


@router.patch("/{entry_id}")
async def edit_entry(entry_id: int, body: EntryIn, ctx: AdminContext = Depends(require("operator")),
                     session: AsyncSession = Depends(get_session)):
    try:
        row = await changelog.edit(session, ctx.actor, entry_id, body.model_dump(exclude_unset=True))
    except ChangelogError as e:
        return _error(e)
    await session.commit()
    return changelog.admin_out(row)


@router.post("/{entry_id}/publish")
async def publish_entry(entry_id: int, ctx: AdminContext = Depends(require("operator")),
                        session: AsyncSession = Depends(get_session)):
    try:
        row = await changelog.publish(session, ctx.actor, entry_id)
    except ChangelogError as e:
        return _error(e)
    await session.commit()
    return changelog.admin_out(row)


@router.post("/{entry_id}/unpublish")
async def unpublish_entry(entry_id: int, ctx: AdminContext = Depends(require("operator")),
                          session: AsyncSession = Depends(get_session)):
    try:
        row = await changelog.unpublish(session, ctx.actor, entry_id)
    except ChangelogError as e:
        return _error(e)
    await session.commit()
    return changelog.admin_out(row)


@router.delete("/{entry_id}")
async def delete_entry(entry_id: int, ctx: AdminContext = Depends(require("operator")),
                       session: AsyncSession = Depends(get_session)):
    try:
        row = await changelog.remove(session, ctx.actor, entry_id)
    except ChangelogError as e:
        return _error(e)
    await session.commit()
    return {"id": row.id, "deleted": True}
