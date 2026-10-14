"""管理端「精选库」(spec 2026-10-14-curated-library §9、§11、R1、R5;plan SI)。

目录是系统内容:管理员可以看标题与句子(R5),但审计只记 id、动作、数字与布尔。数据库读写经 `app.library.catalog_store`
(车道 SC),任务经 `app.state.catalog`(`CatalogJobs`)。"""
import logging

from sqlalchemy import update

from app.admin import audit
from app.core import config as core_config
from app.library import ai, catalog_store, limits, paths, store, subtitles, urlcheck
from app.library.errors import LibraryError
from app.library.pipeline import INPUT_PREFIX, UPLOADED_SUBS
from app.models import CatalogItem, utcnow
from app.services import usage

logger = logging.getLogger(__name__)


class CatalogAdminError(Exception):
    def __init__(self, status: int, message: str, details: dict | None = None):
        super().__init__(message)
        self.status, self.message, self.details = status, message, details


def _err(status: int, message: str, details: dict | None = None) -> CatalogAdminError:
    return CatalogAdminError(status, message, details)


def jobs(app):
    return app.state.catalog


def data_dir(app):
    return app.state.library.deps.data_dir


def clean_meta(*, title=None, level=None, tags=None, license_note=None, ai_lang=None, partial: bool) -> dict:
    """Validated metadata (400 on a bad value). `partial` keeps absent keys absent (PATCH)."""
    out: dict = {}
    try:
        if title is not None or not partial:
            out["title"] = store.clean_title(title, fallback="")
        if level is not None or not partial:
            out["level"] = catalog_store.clean_level(level)
        if tags is not None or not partial:
            out["tags"] = catalog_store.clean_tags(tags)
        if license_note is not None or not partial:
            out["license_note"] = catalog_store.clean_license(license_note)
    except ValueError as e:
        raise _err(400, f"Invalid {e.args[0]}") from None
    if not partial:
        language = ai_lang or catalog_store.DEFAULT_AI_LANG
        if language not in ai.LANGS:
            raise _err(400, "Unsupported language")
        out["ai_lang"] = language
    return out


async def row_out(session, app, row: CatalogItem) -> dict:
    refs = await catalog_store.refs(session, row.id)
    translated = (await catalog_store.translated_counts(session, [row]))[row.id]
    return catalog_store.admin_out(row, refs=refs, translated=translated,
                                   media_missing=catalog_store.media_missing(data_dir(app), row))


async def state(session, app) -> dict:
    s = app.state.settings
    day = limits.day_of(utcnow())
    used = s.library_catalog_ai_daily - await usage.remaining(session, limits.SCOPE_CATALOG_AI, limits.GLOBAL, day,
                                                              s.library_catalog_ai_daily)
    return {"enabled": s.library_catalog_enabled, "available": s.library_available, "asr": s.library_asr_available,
            "ai": s.library_ai_available, "link": bool(s.library_enabled and core_config.ytdlp_present()),
            "proxy_configured": bool((s.library_ytdlp_proxy or "").strip()), "ai_daily": s.library_catalog_ai_daily,
            "ai_today": max(0, used), "languages": list(ai.LANGS), "levels": list(catalog_store.LEVELS),
            "chunk_bytes": limits.CHUNK_BYTES, "max_upload_mb": s.library_max_upload_mb,
            "formats": list(limits.UPLOAD_EXTENSIONS)}


async def list_items(session, app) -> dict:
    rows = await catalog_store.list_all(session)
    refs = await catalog_store.ref_counts(session, [r.id for r in rows])
    translated = await catalog_store.translated_counts(session, rows)
    return {"items": [catalog_store.admin_out(r, refs=refs.get(r.id, 0), translated=translated.get(r.id, 0),
                                              media_missing=catalog_store.media_missing(data_dir(app), r))
                      for r in rows],
            "state": await state(session, app)}


async def get_row(session, catalog_id: str) -> CatalogItem:
    row = await catalog_store.get(session, catalog_id)
    if row is None:
        raise _err(404, "Catalog item not found")
    return row


async def detail(session, app, catalog_id: str) -> dict:
    row = await get_row(session, catalog_id)
    segs = await catalog_store.segments_of(session, row.id)
    return {"item": await row_out(session, app, row), "segments": [catalog_store.segment_admin_out(s) for s in segs]}


async def create_import(session, app, actor, *, url: str, meta: dict) -> dict:
    s = app.state.settings
    if not s.library_available:
        raise _err(503, "Media tools are not installed")
    if not core_config.ytdlp_present():
        raise _err(503, "Link import is unavailable")
    try:
        checked = await urlcheck.precheck(urlcheck.extract_link(url), resolve=not (s.library_ytdlp_proxy or "").strip())
    except urlcheck.UrlRejected as e:
        logger.info("library catalog import rejected reason=%s", e.reason)
        raise _err(400, "Invalid link") from None
    row = await catalog_store.create(session, source="link", status="queued", source_url=checked.url,
                                     source_host=checked.source_host, **meta)
    await audit.record(session, actor, "catalog.import", target_type="catalog_item", target_id=row.id,
                       after={"source": "link"})
    await session.commit()
    jobs(app).kick()
    logger.info("library catalog import queued catalog=%s", row.id)
    return {"item": await row_out(session, app, row)}


async def start_upload(session, app, actor, *, filename: str, size: int, meta: dict) -> dict:
    s = app.state.settings
    if not s.library_available:
        raise _err(503, "Media tools are not installed")
    ext = store.extension_of(filename)
    if ext not in limits.UPLOAD_EXTENSIONS:
        raise _err(400, "Unsupported file type")
    if size > s.library_max_upload_mb * limits.MB:
        raise _err(413, "File is too large")
    if not meta.get("title"):
        meta = {**meta, "title": store.title_from_filename(filename)}
    row = await catalog_store.create(session, source="upload", status="uploading", upload_total=size, **meta)
    tmp = paths.catalog_tmp_dir(data_dir(app), row.id)
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / f"upload.{ext}.part").write_bytes(b"")
    await audit.record(session, actor, "catalog.upload", target_type="catalog_item", target_id=row.id,
                       after={"bytes": size})
    await session.commit()
    logger.info("library catalog upload started catalog=%s bytes=%d", row.id, size)
    return {"catalog_id": row.id, "chunk_bytes": limits.CHUNK_BYTES}


def upload_state(row: CatalogItem) -> dict:
    return {"catalog_id": row.id, "status": row.status, "upload_received": row.upload_received,
            "upload_total": row.upload_total, "chunk_bytes": limits.CHUNK_BYTES}


def _part(app, catalog_id: str):
    tmp = paths.catalog_tmp_dir(data_dir(app), catalog_id)
    return next(iter(sorted(tmp.glob("upload.*.part"))), None) if tmp.is_dir() else None


async def put_chunk(session, app, catalog_id: str, n: int, data: bytes) -> dict:
    """Same rules as the user upload (R-SI8): idempotent resend, strict order, exact size."""
    row = await get_row(session, catalog_id)
    async with jobs(app).upload_lock(row.id):
        await session.refresh(row)
        if row.status != "uploading":
            raise _err(409, "Upload is not in progress")
        part = _part(app, row.id)
        if part is None:
            raise _err(409, "Upload expired")
        offset = n * limits.CHUNK_BYTES
        expected = min(limits.CHUNK_BYTES, row.upload_total - offset)
        if offset + len(data) <= row.upload_received and len(data) == expected:
            return upload_state(row)
        if offset != row.upload_received:
            raise _err(409, "Unexpected chunk")
        if expected <= 0 or len(data) != expected:
            raise _err(400, "Wrong chunk size")
        with part.open("ab") as fh:
            fh.write(data)
        row.upload_received += len(data)
        row.updated_at = utcnow()
        await session.commit()
    return upload_state(row)


async def put_subtitles(session, app, catalog_id: str, data: bytes) -> dict:
    """While uploading, or to retry a `failed(no_subtitles)` item (then it is queued again)."""
    row = await get_row(session, catalog_id)
    if not (row.status == "uploading" or (row.status == "failed" and row.error_kind == "no_subtitles")):
        raise _err(409, "Subtitles cannot be changed now")
    try:
        cues = subtitles.parse(data)
    except LibraryError:
        raise _err(400, "Invalid subtitle file") from None
    tmp = paths.catalog_tmp_dir(data_dir(app), row.id)
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / UPLOADED_SUBS).write_bytes(data)
    if row.status == "failed":
        row.status, row.stage, row.progress, row.error_kind, row.updated_at = "queued", None, 0, None, utcnow()
        await session.commit()
        jobs(app).kick()
    return {"cue_count": len(cues)}


async def complete_upload(session, app, catalog_id: str) -> dict:
    row = await get_row(session, catalog_id)
    async with jobs(app).upload_lock(row.id):
        await session.refresh(row)
        if row.status != "uploading":
            raise _err(409, "Upload is not in progress")
        if row.upload_received != row.upload_total:
            raise _err(409, "Upload is incomplete")
        part = _part(app, row.id)
        if part is None:
            raise _err(409, "Upload expired")
        part.rename(part.with_name(f"{INPUT_PREFIX}{part.name.split('.')[1]}"))
        row.status, row.updated_at = "queued", utcnow()
        await session.commit()
    jobs(app).kick()
    return {"item": await row_out(session, app, row)}


async def patch_meta(session, app, actor, catalog_id: str, changes: dict) -> dict:
    row = await get_row(session, catalog_id)
    meta = clean_meta(**changes, partial=True)
    if "title" in meta:
        row.title = meta["title"] or row.title
    if "level" in changes:
        row.level = meta.get("level")
    if "tags" in meta:
        row.tags = ",".join(meta["tags"]) or None
    if "license_note" in changes:
        row.license_note = meta.get("license_note")
    row.updated_at = utcnow()
    await audit.record(session, actor, "catalog.edit", target_type="catalog_item", target_id=row.id,
                       after={"fields": len(changes)})
    await session.commit()
    return {"item": await row_out(session, app, row)}


async def set_published(session, app, actor, catalog_id: str, published: bool) -> dict:
    row = await get_row(session, catalog_id)
    if published:
        if row.retired_at is not None:
            raise _err(409, "Item is retired")
        if row.status != "ready" or row.seg_count <= 0:
            raise _err(409, "Item is not ready")
        if catalog_store.media_missing(data_dir(app), row):
            raise _err(409, "Media is missing")
        row.published, row.published_at = True, row.published_at or utcnow()
    else:
        row.published = False
    row.updated_at = utcnow()
    await audit.record(session, actor, "catalog.publish" if published else "catalog.unpublish",
                       target_type="catalog_item", target_id=row.id, after={"published": published})
    await session.commit()
    return {"item": await row_out(session, app, row)}
