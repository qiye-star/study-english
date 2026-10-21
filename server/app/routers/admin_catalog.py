"""/api/admin/library/catalog*:精选库的导入、上传、审核、发布、编辑、删除(spec 2026-10-14-curated-library §9)。
业务在 app/admin/catalog_admin.py。URL 里只有 uuid 与序号。"""
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile

from app.admin import catalog_admin
from app.admin.perms import AdminContext, require, require_step_up
from app.core.deps import get_session
from app.library import limits, paths
from app.services.uploads import parse_buffered_form
from app.storage import BlobNotFound, get_store
from app.storage.http import blob_response

router = APIRouter(prefix="/api/admin/library/catalog")
CatalogUuid = Annotated[str, Path(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")]
NO_STORE = {"Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer"}


def _error(e: catalog_admin.CatalogAdminError) -> JSONResponse:
    body: dict = {"error": e.message}
    if e.details:
        body["details"] = e.details
    return JSONResponse(body, status_code=e.status)


async def _guard(session, call):
    try:
        return await call()
    except catalog_admin.CatalogAdminError as e:
        await session.rollback()
        return _error(e)


class Meta(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, max_length=400)
    level: str | None = Field(default=None, max_length=4)
    tags: list[Annotated[str, Field(max_length=64)]] | None = Field(default=None, max_length=10)
    license_note: str | None = Field(default=None, max_length=600)


class ImportIn(Meta):
    url: str = Field(min_length=1, max_length=4000)
    ai_lang: str | None = Field(default=None, max_length=16)


class UploadIn(Meta):
    filename: str = Field(min_length=1, max_length=255)
    size: int = Field(ge=1)
    ai_lang: str | None = Field(default=None, max_length=16)


class ReplaceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filename: str = Field(min_length=1, max_length=255)
    size: int = Field(ge=1)


class Empty(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SegmentPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str | None = Field(default=None, max_length=2000)
    zh: str | None = Field(default=None, max_length=2400)
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, ge=0)


class ReasonIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=1, max_length=200)
    confirm: str = Field("", max_length=40)


async def _form_bytes(request: Request, field: str, limit: int) -> bytes | catalog_admin.CatalogAdminError:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit + limits.CHUNK_SLACK:
        return catalog_admin.CatalogAdminError(413, "File is too large")
    body = b""
    async for chunk in request.stream():
        body += chunk
        if len(body) > limit + limits.CHUNK_SLACK:
            return catalog_admin.CatalogAdminError(413, "File is too large")
    form = await parse_buffered_form(request, body)
    try:
        upload = form.get(field)
        if not isinstance(upload, UploadFile):
            return catalog_admin.CatalogAdminError(400, "File is required")
        data = await upload.read()
    finally:
        await form.close()
    return data if len(data) <= limit else catalog_admin.CatalogAdminError(413, "File is too large")


@router.get("")
async def catalog_list(request: Request, _: AdminContext = Depends(require("viewer")),
                       session: AsyncSession = Depends(get_session)):
    return await catalog_admin.list_items(session, request.app)


@router.get("/{catalog_id}")
async def catalog_detail(catalog_id: CatalogUuid, request: Request, _: AdminContext = Depends(require("viewer")),
                         session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.detail(session, request.app, catalog_id))


@router.post("/imports")
async def catalog_import(body: ImportIn, request: Request, ctx: AdminContext = Depends(require("operator")),
                         session: AsyncSession = Depends(get_session)):
    async def call():
        meta = catalog_admin.clean_meta(title=body.title, level=body.level, tags=body.tags,
                                        license_note=body.license_note, ai_lang=body.ai_lang, partial=False)
        return await catalog_admin.create_import(session, request.app, ctx.actor, url=body.url, meta=meta)
    return await _guard(session, call)


@router.post("/uploads")
async def catalog_upload(body: UploadIn, request: Request, ctx: AdminContext = Depends(require("operator")),
                         session: AsyncSession = Depends(get_session)):
    async def call():
        meta = catalog_admin.clean_meta(title=body.title, level=body.level, tags=body.tags,
                                        license_note=body.license_note, ai_lang=body.ai_lang, partial=False)
        return await catalog_admin.start_upload(session, request.app, ctx.actor, filename=body.filename,
                                                size=body.size, meta=meta)
    return await _guard(session, call)


@router.put("/uploads/{catalog_id}/chunks/{n}")
async def catalog_chunk(catalog_id: CatalogUuid, request: Request, n: int = Path(ge=0, le=1_000_000),
                        _: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    data = await _form_bytes(request, "chunk", limits.CHUNK_BYTES)
    if isinstance(data, catalog_admin.CatalogAdminError):
        return _error(data)
    return await _guard(session, lambda: catalog_admin.put_chunk(session, request.app, catalog_id, n, data))


@router.put("/uploads/{catalog_id}/subtitles")
async def catalog_subtitles(catalog_id: CatalogUuid, request: Request, _: AdminContext = Depends(require("operator")),
                            session: AsyncSession = Depends(get_session)):
    data = await _form_bytes(request, "file", limits.SUBTITLE_MAX_BYTES)
    if isinstance(data, catalog_admin.CatalogAdminError):
        return _error(data)
    return await _guard(session, lambda: catalog_admin.put_subtitles(session, request.app, catalog_id, data))


@router.post("/uploads/{catalog_id}/complete")
async def catalog_complete(catalog_id: CatalogUuid, request: Request, _: AdminContext = Depends(require("operator")),
                           session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.complete_upload(session, request.app, catalog_id))


@router.post("/{catalog_id}/replace-media")
async def catalog_replace_media(catalog_id: CatalogUuid, body: ReplaceIn, request: Request,
                                ctx: AdminContext = Depends(require("operator")),
                                session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.start_replace(session, request.app, ctx.actor, catalog_id,
                                                                     filename=body.filename, size=body.size))


@router.patch("/{catalog_id}")
async def catalog_patch(catalog_id: CatalogUuid, body: Meta, request: Request,
                        ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return _error(catalog_admin.CatalogAdminError(400, "No changes"))
    return await _guard(session, lambda: catalog_admin.patch_meta(session, request.app, ctx.actor, catalog_id, changes))


@router.post("/{catalog_id}/publish")
async def catalog_publish(catalog_id: CatalogUuid, _body: Empty, request: Request,
                          ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.set_published(session, request.app, ctx.actor, catalog_id, True))


@router.post("/{catalog_id}/unpublish")
async def catalog_unpublish(catalog_id: CatalogUuid, _body: Empty, request: Request,
                            ctx: AdminContext = Depends(require("operator")),
                            session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.set_published(session, request.app, ctx.actor, catalog_id, False))


@router.post("/{catalog_id}/retry")
async def catalog_retry(catalog_id: CatalogUuid, _body: Empty, request: Request,
                        ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.retry(session, request.app, ctx.actor, catalog_id))


@router.post("/{catalog_id}/cancel")
async def catalog_cancel(catalog_id: CatalogUuid, _body: Empty, request: Request,
                         ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.cancel(session, request.app, ctx.actor, catalog_id))


@router.post("/{catalog_id}/translate")
async def catalog_translate(catalog_id: CatalogUuid, _body: Empty, request: Request,
                            ctx: AdminContext = Depends(require("operator")),
                            session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.translate(session, request.app, ctx.actor, catalog_id))


@router.patch("/{catalog_id}/segments/{idx}")
async def catalog_segment(catalog_id: CatalogUuid, body: SegmentPatch, request: Request,
                          idx: int = Path(ge=0, le=1_000_000), ctx: AdminContext = Depends(require("operator")),
                          session: AsyncSession = Depends(get_session)):
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return _error(catalog_admin.CatalogAdminError(400, "No changes"))
    return await _guard(session, lambda: catalog_admin.patch_segment(session, request.app, ctx.actor, catalog_id,
                                                                     idx, changes))


@router.post("/{catalog_id}/delete")
async def catalog_delete(catalog_id: CatalogUuid, body: ReasonIn, request: Request,
                         ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.delete(session, request.app, ctx.actor, catalog_id,
                                                              reason=body.reason.strip(), confirm=body.confirm))


@router.post("/{catalog_id}/purge")
async def catalog_purge(catalog_id: CatalogUuid, body: ReasonIn, request: Request,
                        ctx: AdminContext = Depends(require_step_up), session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: catalog_admin.purge(session, request.app, ctx.actor, catalog_id,
                                                             reason=body.reason.strip(), confirm=body.confirm))


async def _file(session, request: Request, catalog_id: str, column: str, mime: str | None):
    row = await catalog_admin.get_row(session, catalog_id)
    rel = getattr(row, column)
    if not rel:
        raise catalog_admin.CatalogAdminError(404, "Not Found")
    try:  # plan L1 Task 11: the admin preview streams from the store, Range included (R8)
        return await blob_response(get_store(request.app), rel, request,
                                   media_type=mime or row.media_mime or "application/octet-stream", headers=NO_STORE)
    except (BlobNotFound, ValueError):
        raise catalog_admin.CatalogAdminError(404, "Not Found") from None


@router.get("/{catalog_id}/media")
@router.head("/{catalog_id}/media")
async def catalog_media(catalog_id: CatalogUuid, request: Request, _: AdminContext = Depends(require("viewer")),
                        session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: _file(session, request, catalog_id, "media_path", None))


@router.get("/{catalog_id}/poster")
async def catalog_poster(catalog_id: CatalogUuid, request: Request, _: AdminContext = Depends(require("viewer")),
                         session: AsyncSession = Depends(get_session)):
    return await _guard(session, lambda: _file(session, request, catalog_id, "poster_path", "image/jpeg"))
