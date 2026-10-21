"""跟读库接口 `/api/library/*`(spec 2026-10-13-video-import §8–§10)。

全部要求登录(媒体读取除外:它只认票据);`LIBRARY_ENABLED` 关 = 除 `GET /config` 外 404 `Library is disabled`
(先鉴权,未登录 401 优先)。URL 里只有 uuid、序号与票据,不出现标题、URL、文字;错误文本是固定英文(`ERRORS`,
契约夹具里有一份给网页的 `LIBRARY_SERVER_ERRORS`)。创建类端点(上传开始、媒体票据)走 `limited_user`;
分片与媒体读取不走每分钟限流。链接导入 `POST /imports` 在 `routers/library_import.py`(计划 S2)。
日志只有条目 id、序号、字节数;标题、文件名、字幕、票据一律不记。"""
import asyncio
import logging
import math
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path as PathParam, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile

from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings, limited_user
from app.core.quotas import effective
from app.library import ai as library_ai
from app.library import asr_chunks, catalog_store, limits, paths, segment, sentences, store, subtitles
from app.library.errors import API_ERRORS, LibraryError, api_error, http_error
from app.library.pipeline import TRANSCRIPT, UPLOADED_SUBS, INPUT_PREFIX
from app.library.worker import LibraryWorker
from app.storage import BlobNotFound, StorageError, get_store
from app.storage.http import blob_response
from app.models import Assessment, LibraryItem, User, utcnow
from app.services.prompts import prompt_cache
from app.services.uploads import parse_buffered_form

router = APIRouter(prefix="/api/library")
logger = logging.getLogger(__name__)

ERRORS = API_ERRORS  # the fixed English error texts (app/library/errors.py); recorded in the contract fixture
NO_STORE = {"Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff"}
ItemId = Annotated[str, PathParam(max_length=36)]


def fail(code: str) -> HTTPException:
    return api_error(code)


def require_library(_: User = Depends(current_user), settings: Settings = Depends(get_settings)) -> Settings:
    if not settings.library_enabled:
        raise fail("disabled")
    return settings


def runtime(request: Request) -> LibraryWorker:
    return request.app.state.library


async def owned(session: AsyncSession, user: User, item_id: str) -> LibraryItem:
    item = await store.get_owned(session, user.id, item_id)
    if item is None:
        raise fail("not_found")
    return item


async def read_body(request: Request, limit: int, code: str) -> bytes:
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise fail(code)
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise fail(code)
        chunks.append(chunk)
    return b"".join(chunks)


async def form_file(request: Request, field: str, limit: int, too_large: str, missing: str) -> bytes:
    body = await read_body(request, limit + limits.CHUNK_SLACK, too_large)
    form = await parse_buffered_form(request, body)
    try:
        upload = form.get(field)
        if not isinstance(upload, UploadFile):
            raise fail(missing)
        data = await upload.read()
    finally:
        await form.close()
    if len(data) > limit:
        raise fail(too_large)
    return data


# ---- config ----

@router.get("/config")
async def config(request: Request, user: User = Depends(current_user), settings: Settings = Depends(get_settings),
                 session: AsyncSession = Depends(get_session)):
    enabled = settings.library_available
    app = request.app
    return {
        "enabled": enabled,
        "link_import": enabled and settings.library_link_available,
        "asr": enabled and settings.library_asr_available,
        "ai": enabled and settings.library_ai_available,  # D8:关 = 译文 / 分析接口 404,网页不显示「译」与「分析」
        "catalog": enabled and settings.library_catalog_enabled,  # spec 2026-10-14-curated-library E12
        "limits": {
            "max_upload_mb": settings.library_max_upload_mb,
            "max_duration_minutes": settings.library_max_duration_minutes,
            "quota_mb": await effective(session, app, user.id, "library_quota_mb"),
            "used_bytes": await limits.used_bytes(session, user.id),
            "max_items": await effective(session, app, user.id, "library_max_items"),
            "chunk_bytes": limits.CHUNK_BYTES,
            "formats": list(limits.UPLOAD_EXTENSIONS),
        },
    }


# ---- uploads (spec §8) ----

class UploadIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filename: str = Field(min_length=1, max_length=255)
    size: int = Field(ge=1)
    title: str | None = Field(default=None, max_length=400)


def _part_file(data_dir, item_id: str):
    tmp = paths.tmp_dir(data_dir, item_id)
    return next(iter(sorted(tmp.glob("upload.*.part"))), None) if tmp.is_dir() else None


@router.post("/uploads")
async def start_upload(payload: UploadIn, request: Request, user: User = Depends(limited_user),
                       settings: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    ext = store.extension_of(payload.filename)
    if ext not in limits.UPLOAD_EXTENSIONS:
        raise fail("format")
    if payload.size > settings.library_max_upload_mb * limits.MB:
        raise fail("too_large")
    try:
        await limits.admit_new_item(session, request.app, user.id, size_bytes=payload.size, upload=True)
    except LibraryError as e:
        raise http_error(e) from None
    title = payload.title if payload.title and payload.title.strip() else store.title_from_filename(payload.filename)
    item = await store.create_upload(session, user.id, title=title, size=payload.size, ext=ext)
    tmp = paths.tmp_dir(settings.resolved_data_dir, item.id)
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / f"upload.{ext}.part").write_bytes(b"")
    logger.info("library upload started item=%s bytes=%d", item.id, payload.size)
    return {"item_id": item.id, "chunk_bytes": limits.CHUNK_BYTES}


def _upload_state(item: LibraryItem) -> dict:
    return {"item_id": item.id, "status": item.status, "upload_received": item.upload_received,
            "upload_total": item.upload_total, "chunk_bytes": limits.CHUNK_BYTES}


@router.get("/uploads/{item_id}")
async def upload_state(item_id: ItemId, user: User = Depends(current_user), _: Settings = Depends(require_library),
                       session: AsyncSession = Depends(get_session)):
    return _upload_state(await owned(session, user, item_id))


@router.put("/uploads/{item_id}/chunks/{n}")
async def put_chunk(request: Request, item_id: ItemId, n: int = PathParam(ge=0, le=1_000_000),
                    user: User = Depends(current_user), settings: Settings = Depends(require_library),
                    session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    if item.status != "uploading":
        raise fail("not_uploading")
    data = await form_file(request, "chunk", limits.CHUNK_BYTES, "chunk_too_large", "chunk_required")
    async with runtime(request).upload_lock(item.id):
        await session.refresh(item)
        if item.status != "uploading":
            raise fail("not_uploading")
        part = _part_file(settings.resolved_data_dir, item.id)
        if part is None:
            raise fail("upload_expired")
        size = limits.CHUNK_BYTES
        offset = n * size
        expected_len = min(size, item.upload_total - offset)
        if offset + len(data) <= item.upload_received and len(data) == expected_len:
            return _upload_state(item)  # a chunk we already have, sent again: idempotent
        if offset != item.upload_received:
            raise fail("unexpected_chunk")
        if expected_len <= 0 or len(data) != expected_len:
            raise fail("chunk_size")
        with part.open("ab") as fh:
            fh.write(data)
        item.upload_received += len(data)
        item.updated_at = utcnow()
        await session.commit()
    return _upload_state(item)


@router.put("/uploads/{item_id}/subtitles")
async def put_upload_subtitles(request: Request, item_id: ItemId, user: User = Depends(current_user),
                               settings: Settings = Depends(require_library),
                               session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    if item.status != "uploading":
        raise fail("not_uploading")
    data = await form_file(request, "file", limits.SUBTITLE_MAX_BYTES, "too_large", "file_required")
    try:
        cues = subtitles.parse(data)
    except LibraryError:
        raise fail("bad_subtitle") from None
    tmp = paths.tmp_dir(settings.resolved_data_dir, item.id)
    if not tmp.is_dir():
        raise fail("upload_expired")
    (tmp / UPLOADED_SUBS).write_bytes(data)
    return {"cue_count": len(cues)}


@router.post("/uploads/{item_id}/complete")
async def complete_upload(request: Request, item_id: ItemId, user: User = Depends(current_user),
                          settings: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    async with runtime(request).upload_lock(item.id):
        await session.refresh(item)
        if item.status != "uploading":
            raise fail("not_uploading")
        if item.upload_received != item.upload_total:
            raise fail("incomplete")
        part = _part_file(settings.resolved_data_dir, item.id)
        if part is None:
            raise fail("upload_expired")
        ext = part.name.split(".")[1]
        part.rename(part.with_name(f"{INPUT_PREFIX}{ext}"))
        item.status, item.updated_at = "queued", utcnow()
        await session.commit()
    runtime(request).wake()
    logger.info("library upload complete item=%s bytes=%d", item.id, item.upload_total)
    return {"item": store.item_out(item)}


# ---- items (spec §9) ----

@router.get("/items")
async def list_items(cursor: str | None = Query(None, max_length=36), user: User = Depends(current_user),
                     _: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    rows, next_cursor = await store.list_page(session, user.id, cursor)
    return {"items": [store.item_out(r) for r in rows], "next_cursor": next_cursor}


@router.get("/items/{item_id}")
async def get_item(item_id: ItemId, user: User = Depends(current_user), _: Settings = Depends(require_library),
                   session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    segs = await store.segments_of(session, item.id) if item.status == "ready" else []
    if item.status == "ready":
        item.last_opened_at = utcnow()
        await session.commit()
    return {"item": store.item_out(item), "segments": [store.segment_out(s) for s in segs]}


class ItemPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, max_length=400)
    resume_ms: int | None = Field(default=None, ge=0)
    resume_idx: int | None = Field(default=None, ge=0)
    rate_pct: int | None = Field(default=None, ge=limits.RATE_BOUNDS[0], le=limits.RATE_BOUNDS[1])


@router.patch("/items/{item_id}")
async def patch_item(payload: ItemPatch, item_id: ItemId, user: User = Depends(current_user),
                     _: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    changes = payload.model_dump(exclude_none=True)
    if not changes:
        raise fail("no_changes")
    item = await owned(session, user, item_id)
    if "resume_ms" in changes and changes["resume_ms"] > (item.duration_ms or 0):
        raise fail("bad_resume")
    if "resume_idx" in changes and changes["resume_idx"] >= max(1, item.seg_count):
        raise fail("bad_resume")
    if "title" in changes:
        item.title = store.clean_title(changes.pop("title"), item.title)
    for key, value in changes.items():
        setattr(item, key, value)
    item.updated_at = utcnow()
    await session.commit()
    return {"item": store.item_out(item)}


@router.delete("/items/{item_id}")
async def delete_item(request: Request, item_id: ItemId, user: User = Depends(current_user),
                      settings: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    catalog_id = item.catalog_id
    await store.delete_item(session, request.app, item)
    if catalog_id:  # spec 2026-10-14-curated-library R1: the last copy of a retired catalog item lets it go
        await catalog_store.collect_if_orphan(session, get_store(request.app), settings.resolved_data_dir, catalog_id)
    logger.info("library item deleted item=%s", item_id)
    return {"deleted": True}


async def _has_material(store, data_dir, item: LibraryItem) -> bool:
    if item.source == "link":
        return bool(item.source_url)
    if item.media_path and await store.stat(item.media_path) is not None:
        return True
    tmp = paths.tmp_dir(data_dir, item.id)
    return tmp.is_dir() and any(tmp.glob(INPUT_PREFIX + "*"))


@router.post("/items/{item_id}/retry")
async def retry_item(request: Request, item_id: ItemId, user: User = Depends(current_user),
                     settings: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    if item.status != "failed":
        raise fail("not_failed")
    if not settings.library_available:
        raise fail("unavailable")
    if not await _has_material(get_store(request.app), settings.resolved_data_dir, item):
        raise fail("no_material")
    item.status, item.stage, item.progress, item.error_kind = "queued", None, 0, None
    item.attempts, item.next_run_at, item.updated_at = 0, None, utcnow()
    await session.commit()
    runtime(request).wake()
    return {"item": store.item_out(item)}


@router.post("/items/{item_id}/cancel")
async def cancel_item(request: Request, item_id: ItemId, user: User = Depends(current_user),
                      _: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    if not await store.cancel_item(session, request.app, item):
        raise fail("not_active")
    return {"item": store.item_out(item)}


@router.post("/items/{item_id}/reprocess")
async def reprocess_item(request: Request, item_id: ItemId, user: User = Depends(current_user),
                         settings: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    """D7:重新识别一条 `ready` 的自动识别条目(裁定 R-R1…R-R6)。旧句子留到新句子写入(失败 / 取消回到原状);
    预检今天的识别额度(不扣,真实预留在流水线里);陈旧的 `_tmp`(chunks.json 等)在锁内清掉再入队。"""
    item = await owned(session, user, item_id)
    if item.source == "catalog":
        raise fail("catalog_locked")  # spec 2026-10-14-curated-library E9
    if item.status != "ready" or item.sub_source != "asr" or item.seg_count <= 0:
        raise fail("not_reprocessable")
    if not settings.library_available:
        raise fail("unavailable")
    if not settings.library_asr_available:
        raise fail("asr_unavailable")
    data_dir = settings.resolved_data_dir
    if not item.media_path or await get_store(request.app).stat(item.media_path) is None:
        raise fail("no_material")
    now = utcnow()
    need = max(1, math.ceil((item.duration_ms or 0) / 1000))
    if await limits.asr_seconds_left(session, user.id, settings, now) < need:
        raise fail("asr_daily")
    async with runtime(request).upload_lock(item.id):
        await session.refresh(item)
        if item.status != "ready":
            raise fail("not_reprocessable")
        paths.remove_tree(paths.tmp_dir(data_dir, item.id))
        item.status, item.stage, item.progress, item.error_kind = "queued", None, 0, None
        item.attempts, item.next_run_at, item.updated_at = 0, None, now
        await session.commit()
    runtime(request).wake()
    logger.info("library reprocess queued item=%s", item.id)
    return {"item": store.item_out(item)}


@router.post("/items/{item_id}/rebuild")
async def rebuild_item(request: Request, item_id: ItemId, user: User = Depends(limited_user),
                       settings: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    """plan v2 R-V16:用条目目录里保留的识别结果(transcript.json)按当前算法重新分句,不花识别额度、不排队。
    手动改过的句子被替换;文字没变的句子保留译文与分析。日志只有条目 id 与数字。"""
    item = await owned(session, user, item_id)
    if item.status != "ready" or item.sub_source != "asr" or not item.rebuildable:
        raise fail("not_rebuildable")
    blobs = get_store(request.app)
    async with runtime(request).upload_lock(item.id):
        try:
            raw = await blobs.get_bytes(paths.transcript_key(item.user_id, item.id), max_bytes=limits.TRANSCRIPT_MAX_BYTES)
        except (BlobNotFound, StorageError):  # missing, or larger than the ceiling: the same answer as before
            raw = None
        loaded = asr_chunks.parse_transcript(raw) if raw is not None else None
        if loaded is None:
            raise fail("not_rebuildable")
        built = await asyncio.to_thread(sentences.build, *loaded)
        await session.refresh(item)
        if not built.sentences or item.status != "ready":
            raise fail("not_rebuildable")
        await store.write_segments(session, item, built.sentences, flags=built.flags, keep_ai=True)
        item.low_confidence, item.updated_at = built.low_confidence, utcnow()
        await session.commit()
    segs = await store.segments_of(session, item.id)
    logger.info("library rebuilt item=%s algorithm=%s sentences=%d flagged=%d", item.id, built.algorithm,
                len(built.sentences), sum(1 for f in built.flags if f))
    return {"item": store.item_out(item), "segments": [store.segment_out(s) for s in segs]}


@router.put("/items/{item_id}/subtitles")
async def put_item_subtitles(request: Request, item_id: ItemId, user: User = Depends(current_user),
                             settings: Settings = Depends(require_library),
                             session: AsyncSession = Depends(get_session)):
    """ready → re-segment now from the new subtitles (R-SC21); failed(no_subtitles) → back to the queue."""
    item = await owned(session, user, item_id)
    if item.source == "catalog":
        raise fail("catalog_locked")  # spec 2026-10-14-curated-library E9
    if not (item.status == "ready" or (item.status == "failed" and item.error_kind == "no_subtitles")):
        raise fail("subs_state")
    data = await form_file(request, "file", limits.SUBTITLE_MAX_BYTES, "too_large", "file_required")
    try:
        cues = subtitles.parse(data)
    except LibraryError:
        raise fail("bad_subtitle") from None
    sentences = segment.build([segment.Fragment(c.start_ms, c.end_ms, c.text) for c in cues])
    if not sentences:
        raise fail("bad_subtitle")
    if item.status == "ready":
        await store.write_segments(session, item, sentences)
        item.sub_source, item.error_kind, item.low_confidence, item.updated_at = "uploaded", None, False, utcnow()
        item.rebuildable = False  # the recognizer's output is no longer the source (R-V8): drop it
        await session.commit()
        await get_store(request.app).delete(paths.transcript_key(item.user_id, item.id))
        segs = await store.segments_of(session, item.id)
        return {"item": store.item_out(item), "segments": [store.segment_out(s) for s in segs]}
    tmp = paths.tmp_dir(settings.resolved_data_dir, item.id)
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / UPLOADED_SUBS).write_bytes(data)
    item.status, item.stage, item.progress, item.error_kind = "queued", None, 0, None
    item.attempts, item.next_run_at, item.updated_at = 0, None, utcnow()
    await session.commit()
    runtime(request).wake()
    return {"item": store.item_out(item), "segments": []}


class SegmentPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, ge=0)
    text: str | None = Field(default=None, max_length=2000)


@router.patch("/items/{item_id}/segments/{idx}")
async def patch_segment(payload: SegmentPatch, item_id: ItemId, idx: int = PathParam(ge=0, le=1_000_000),
                        user: User = Depends(current_user), _: Settings = Depends(require_library),
                        session: AsyncSession = Depends(get_session)):
    changes = payload.model_dump(exclude_none=True)
    if not changes:
        raise fail("no_changes")
    item = await owned(session, user, item_id)
    if item.status != "ready":
        raise fail("not_ready")
    segs = await store.segments_of(session, item.id)
    if idx >= len(segs):
        raise fail("segment_missing")
    seg = segs[idx]
    if "text" in changes:
        text = " ".join(changes["text"].split())
        if not text or len(text) > limits.SEGMENT_TEXT_MAX or not any(c.isalpha() for c in text):
            raise fail("bad_text")
        if not store.same_text(text, seg.text):
            store.clear_ai(seg)  # E11: a changed sentence keeps no translation or analysis
        seg.text = text
    start, end = changes.get("start_ms", seg.start_ms), changes.get("end_ms", seg.end_ms)
    low = segs[idx - 1].end_ms if idx > 0 else 0
    high = segs[idx + 1].start_ms if idx + 1 < len(segs) else (item.duration_ms or end)
    if not (low <= start < end <= high):
        raise fail("bad_times")
    if (start, end) != (seg.start_ms, seg.end_ms):
        seg.flags = None  # R-V14: the learner set the times by ear
    seg.start_ms, seg.end_ms = start, end
    item.updated_at = utcnow()
    await session.commit()
    return {"segment": store.segment_out(seg)}


# ---- translations and analysis (D8 / E11 / E12) ----

def require_ai(settings: Settings = Depends(require_library)) -> Settings:
    """译文与分析需要 `library_ai_available`(子开关开且大模型已配置),否则 404,与 `config.ai: false` 一致。"""
    if not settings.library_ai_available:
        raise fail("ai_disabled")
    return settings


def language_of(code: str) -> str:
    if code not in library_ai.LANGS:
        raise fail("language")
    return code


class TranslateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    indices: list[Annotated[int, Field(ge=0, le=1_000_000)]] = Field(min_length=1, max_length=limits.AI_BATCH_MAX)
    native_language: str = Field(min_length=1, max_length=16)


@router.post("/items/{item_id}/translate")
async def translate_segments(payload: TranslateIn, request: Request, item_id: ItemId,
                             user: User = Depends(limited_user), settings: Settings = Depends(require_ai),
                             session: AsyncSession = Depends(get_session)):
    """E12:一次最多 20 句。已存且语言一致的照常返回;其余按额度批量生成并写回句子行。额度不够时能生成的先生成,
    缺的不生成并带 `limited: true`;模型失败 503。不存在的序号直接略过(网页的视野可能比刚替换的字幕旧)。"""
    language = language_of(payload.native_language)
    item = await owned(session, user, item_id)
    if item.status != "ready":
        raise fail("not_ready")
    segs = await store.segments_at(session, item.id, list(dict.fromkeys(payload.indices)))
    if item.catalog_id:  # spec 2026-10-14-curated-library R3: the catalog's stored translations are free
        if await catalog_store.fill_translations(session, item, segs, language):
            for seg in segs:  # expire_on_commit=False: re-read the rows the UPDATEs changed (R-SC6)
                await session.refresh(seg)
    _, template = await prompt_cache(request.app).get("library.translate")
    try:
        done, limited = await library_ai.translate(session, request.app.state.http, settings, user_id=user.id,
                                                   item_id=item.id, segments=segs, language=language,
                                                   template=template, now=utcnow())
    except library_ai.AiUnavailable:
        raise fail("ai_unavailable") from None
    return {"segments": [{"idx": idx, "zh": done[idx]} for idx in sorted(done)], "limited": limited}


class AnalysisIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    native_language: str = Field(min_length=1, max_length=16)


@router.post("/items/{item_id}/segments/{idx}/analysis")
async def analyze_segment(payload: AnalysisIn, request: Request, item_id: ItemId,
                          idx: int = PathParam(ge=0, le=1_000_000), user: User = Depends(limited_user),
                          settings: Settings = Depends(require_ai), session: AsyncSession = Depends(get_session)):
    """只在用户点「分析」时调用;命中已存的(同语言)直接返回 `cached: true`,不计额度;额度满 429,模型失败 503。"""
    language = language_of(payload.native_language)
    item = await owned(session, user, item_id)
    if item.status != "ready":
        raise fail("not_ready")
    segs = await store.segments_at(session, item.id, [idx])
    if not segs:
        raise fail("segment_missing")
    _, template = await prompt_cache(request.app).get("library.analyze")
    seg = segs[0]
    if item.catalog_id and not (seg.analysis and seg.analysis_lang == language):  # R-SC5: shared, system-paid
        cat = await catalog_store.get(session, item.catalog_id)
        shared = await catalog_store.segment_at(session, item.catalog_id, idx) if cat is not None else None
        if cat is not None and shared is not None and language == cat.ai_lang and store.same_text(shared.text, seg.text):
            user_text = seg.text
            try:
                text, cached = await library_ai.analyze_catalog(
                    session, request.app.state.http, settings, catalog_id=cat.id, idx=idx, text=user_text,
                    language=language, template=template, now=utcnow())
            except library_ai.AiUnavailable as e:
                raise fail({"global_cap": "ai_global_cap"}.get(e.kind, "ai_unavailable")) from None
            await store.set_analysis(session, item.id, idx, user_text, text, language)
            return {"analysis": text, "cached": cached}
    try:
        text, cached = await library_ai.analyze(session, request.app.state.http, settings, user_id=user.id,
                                                item_id=item.id, segment=segs[0], language=language,
                                                template=template, now=utcnow())
    except library_ai.AiUnavailable as e:
        raise fail({"user_cap": "ai_user_cap", "global_cap": "ai_global_cap"}.get(e.kind, "ai_unavailable")) from None
    return {"analysis": text, "cached": cached}


# ---- media (spec §10) ----

@router.post("/items/{item_id}/media-ticket")
async def media_ticket(request: Request, item_id: ItemId, user: User = Depends(limited_user),
                       _: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    if item.status != "ready" or not item.media_path:
        raise fail("not_ready")
    tickets = runtime(request).tickets
    token = tickets.issue(user.id, item.id)
    return {"url": f"/api/library/items/{item.id}/media?ticket={token}", "expires_in": tickets.ttl}


@router.get("/items/{item_id}/media")
@router.head("/items/{item_id}/media")
async def media(request: Request, item_id: ItemId, ticket: str | None = Query(None, max_length=128),
                settings: Settings = Depends(get_settings), session: AsyncSession = Depends(get_session)):
    """No Bearer: the ticket is the credential. Range / If-Range / 416 come from `storage.http.blob_response`
    (the local backend keeps Starlette's file response; pinned by tests/test_library_range.py and
    tests/test_storage_range.py). Every read re-checks the item and the user (one PK lookup each)."""
    if not settings.library_enabled:
        raise fail("disabled")
    user_id = runtime(request).tickets.resolve(ticket, item_id)
    if user_id is None:
        raise fail("ticket")
    user = await session.get(User, user_id)
    item = await store.get_owned(session, user_id, item_id)
    if user is None or user.disabled_at is not None or item is None or item.status != "ready" or not item.media_path:
        raise fail("not_found")
    try:  # the ticket and the rows were checked above; only now does the store get touched (plan L1 R8)
        return await blob_response(get_store(request.app), item.media_path, request,
                                   media_type=item.media_mime or "application/octet-stream", headers=NO_STORE)
    except (BlobNotFound, ValueError):
        raise fail("not_found") from None


@router.get("/items/{item_id}/poster")
async def poster(request: Request, item_id: ItemId, user: User = Depends(current_user),
                 settings: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    if not item.poster_path:
        raise fail("not_found")
    try:
        return await blob_response(get_store(request.app), item.poster_path, request, media_type="image/jpeg",
                                   headers=NO_STORE)
    except (BlobNotFound, ValueError):
        raise fail("not_found") from None


# ---- shadowing attempts ----

class AttemptIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seg_idx: int = Field(ge=0, le=1_000_000)
    assessment_id: str = Field(min_length=1, max_length=36)


@router.post("/items/{item_id}/attempts")
async def add_attempt(payload: AttemptIn, item_id: ItemId, user: User = Depends(current_user),
                      _: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    if item.status != "ready":
        raise fail("not_ready")
    segs = await store.segments_of(session, item.id)
    if payload.seg_idx >= len(segs):
        raise fail("segment_missing")
    seg = segs[payload.seg_idx]
    assessment = await session.scalar(select(Assessment).where(Assessment.id == payload.assessment_id,
                                                               Assessment.user_id == user.id))
    if assessment is None or assessment.source != "library" or not store.same_text(assessment.reference_text, seg.text):
        raise fail("assessment")
    raw = (assessment.scores or {}).get("pronunciation_score")
    score = round(raw) if isinstance(raw, (int, float)) and not isinstance(raw, bool) else None
    row = await store.add_attempt(session, user_id=user.id, item_id=item.id, seg_idx=seg.idx,
                                  assessment_id=assessment.id, text=seg.text, score=score, now=utcnow())
    return {"seg_idx": row.seg_idx, "score": row.score}


@router.get("/items/{item_id}/attempts")
async def list_attempts(item_id: ItemId, user: User = Depends(current_user),
                        _: Settings = Depends(require_library), session: AsyncSession = Depends(get_session)):
    item = await owned(session, user, item_id)
    return {"attempts": await store.best_attempts(session, item.id, await store.segments_of(session, item.id))}
