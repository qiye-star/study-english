"""精选库一条目录条目的导入(spec 2026-10-14-curated-library §7;INDEX §7)。

取回(链接,`FetchRequest.system=True`)→ 探测 → 封面(视频源)→ 转码(视频源 `normalize` ≤ 720p / ≤ 1600 kbps,音频源 `audio_only`)→ 上传的字幕 > 平台字幕 > 识别(系统付费,
不预留每日额度)→ 分句 → 写 `catalog_segments` → 逐句翻译(`ai.translate_texts`,系统付费;失败不让导入失败)→ ready(未发布)。
已有句子的条目(补全译文,spec R9)只跑翻译。复用用户流水线的零件,不复用 `pipeline.process`(它绑定 LibraryItem 与用户额度)。
日志只有目录 id、阶段、种类与数字。"""
import asyncio
import logging
import time
from collections.abc import Callable
from pathlib import Path

from sqlalchemy import update

from app.core import metering
from app.core.learning_events import LibraryItemReady
from app.library import ai, catalog_store, paths, pipeline, segment, sentences as sentences_mod, store, subtitles
from app.library.errors import Aborted, LibraryError
from app.library.limits import AI_BATCH_MAX
from app.library.media import Normalized
from app.library.pipeline import FetchRequest, PipelineDeps
from app.library.segment import Sentence
from app.models import CatalogItem
from app.storage.base import StorageError

logger = logging.getLogger(__name__)

FEATURE = "cat_import"  # metering feature of the import job (<= 16 chars)
SYSTEM_USER = 0  # FetchRequest.user_id / transcriber argument for system jobs (R-SI1)
VIDEO_MAX_HEIGHT = 720  # plan 2026-10-15-catalog-keep-video R-KV2 (and never above library_transcode_max_height)
VIDEO_MAX_KBPS = 1600  # total; copy only below it, re-encode capped at it
REPLACE_MARK = "replace.flag"  # in the catalog _tmp dir: this upload replaces the media of an item with sentences


async def _transcode(deps: PipelineDeps, src: Path, info, out_dir: Path, tmp: Path) -> Normalized:
    """R-KV1: a video source keeps its picture (the user pipeline's normalizer, capped); audio stays mono 64 kbps."""
    if info.has_video:
        height = min(deps.settings().library_transcode_max_height, VIDEO_MAX_HEIGHT)
        return await deps.tools.normalize(src, info, out_dir, max_height=height, home=tmp, max_kbps=VIDEO_MAX_KBPS)
    return await deps.tools.audio_only(src, out_dir, duration_ms=info.duration_ms, home=tmp)


class Progress:
    """Throttled stage / progress writes on the catalog row; `Aborted` once it left `processing`."""

    def __init__(self, deps: PipelineDeps, catalog_id: str, monotonic: Callable[[], float] = time.monotonic):
        self._deps, self._id, self._monotonic = deps, catalog_id, monotonic
        self.stage: str | None = None
        self.value = -100
        self._at = float("-inf")

    async def set(self, stage: str, value: int) -> None:
        now = self._monotonic()
        if stage == self.stage and (value == self.value or (value - self.value < 2 and now - self._at < 1.0)):
            return
        async with self._deps.sessionmaker() as s:
            if not await catalog_store.set_progress(s, self._id, stage, value, self._deps.clock()):
                raise Aborted()
        self.stage, self.value, self._at = stage, value, now


async def _load(deps: PipelineDeps, catalog_id: str) -> CatalogItem:
    async with deps.sessionmaker() as s:
        row = await s.get(CatalogItem, catalog_id)
    if row is None or row.status != "processing":
        raise Aborted()
    return row


async def _media_stage(deps: PipelineDeps, row: CatalogItem, tmp: Path, progress: Progress) -> tuple[int, Path]:
    settings = deps.settings()
    link = row.source == "link"
    t0, t1 = (30, 45) if link else (0, 20)
    if link:
        await progress.set("fetch", 0)

        async def report(percent: int) -> None:
            await progress.set("fetch", round(30 * max(0, min(100, percent)) / 100))

        result = await deps.fetch().fetch(FetchRequest(
            item_id=row.id, user_id=SYSTEM_USER, url=row.source_url or "", tmp_dir=tmp, settings=settings,
            asr_available=settings.library_asr_available, report=report, system=True))
        src = result.media_path
        if result.subtitle_path is not None and result.subtitle_path.is_file():
            paths.replace(result.subtitle_path, tmp / pipeline.PLATFORM_SUBS)
        values = {}
        if result.title and not row.title:
            values["title"] = store.clean_title(result.title)
        if result.source_host and not row.source_host:
            values["source_host"] = result.source_host[:64]
        if values:
            async with deps.sessionmaker() as s:
                await s.execute(update(CatalogItem).where(CatalogItem.id == row.id).values(**values))
                await s.commit()
    else:
        src = pipeline.input_file(tmp)
        if src is None:
            raise LibraryError("corrupt")
    await progress.set("probe", t0)
    info = await deps.tools.probe(src, home=tmp)
    if not info.has_audio:
        raise LibraryError("no_audio")
    if info.duration_ms > settings.library_max_duration_minutes * 60_000:
        raise LibraryError("too_long")
    if paths.disk_free(tmp) < 2 * paths.file_bytes(src):
        raise LibraryError("disk_full")
    await progress.set("transcode", t0)
    out_dir = tmp / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    poster = out_dir / "poster.jpg"
    has_poster = info.has_video and await deps.tools.poster(src, poster, info.duration_ms, home=tmp)  # R-SI2
    normalized = await _transcode(deps, src, info, out_dir, tmp)
    await progress.set("transcode", t1)
    blobs = deps.storage()  # plan L1 Task 11 / R6: put first, commit second; the staging copy stays local (R7)
    media_key = paths.catalog_media_key(row.id, normalized.path.name)
    poster_key = paths.catalog_poster_key(row.id)
    written: list[str] = []
    try:
        media_info = await blobs.put_file(media_key, normalized.path, content_type=normalized.mime)
        written.append(media_key)
        size = media_info.size
        if has_poster:
            poster_info = await blobs.put_file(poster_key, poster, content_type="image/jpeg")
            written.append(poster_key)
            size += poster_info.size
    except StorageError as exc:
        await pipeline.forget_keys(blobs, written)
        raise LibraryError("network") from exc
    async with deps.sessionmaker() as s:
        done = await s.execute(update(CatalogItem).where(CatalogItem.id == row.id,
                                                         CatalogItem.status == "processing").values(
            duration_ms=info.duration_ms, media_path=media_key,
            poster_path=poster_key if has_poster else None, media_mime=normalized.mime,
            media_bytes=size, updated_at=deps.clock()))
        await s.commit()
    if done.rowcount != 1:
        await pipeline.forget_keys(blobs, written)
        raise Aborted()
    src.unlink(missing_ok=True)  # the original download / upload is not kept
    logger.info("library catalog media ready catalog=%s kind=%s duration_ms=%d bytes=%d poster=%s", row.id,
                normalized.kind, info.duration_ms, size, "yes" if has_poster else "no")
    return info.duration_ms, normalized.path


def _fresh_name(current_rel: str | None, wanted: str) -> str:
    """R-KV6: never write over the file copies are streaming; alternate media.mp4 <-> media-2.mp4."""
    if (current_rel or "").rsplit("/", 1)[-1] != wanted:
        return wanted
    stem, ext = wanted.rsplit(".", 1)
    return f"{stem}-2.{ext}"


def _same_length(new_ms: int, old_ms: int) -> bool:
    return abs(new_ms - old_ms) <= max(2000, old_ms // 50)  # R-KV7: 2 s or 2 %


def _uploaded_sentences(tmp: Path) -> list[Sentence] | None:
    """R-S4: subtitles that came with a replacement, parsed and split BEFORE anything is probed, so a bad file fails
    while the old media, sentences and copies are still untouched. None when no subtitles came."""
    path = tmp / pipeline.UPLOADED_SUBS
    if not path.is_file():
        return None
    try:
        cues = subtitles.parse(path.read_bytes())
    except LibraryError:
        raise LibraryError("bad_subtitle") from None
    built = segment.build(pipeline.fragments(cues))
    if not built:
        raise LibraryError("bad_subtitle")
    return built


async def _replace_stage(deps: PipelineDeps, row: CatalogItem, tmp: Path, progress: Progress) -> None:
    """R-KV5: new media for an item that keeps its sentences; the catalog row and every copy move in one commit,
    then the old file goes. A failure before the commit leaves the old media and the copies untouched.
    R-S4: with subtitles the sentences are rebuilt in that same commit (unchanged text keeps its translation)."""
    src = pipeline.input_file(tmp)
    if src is None:
        raise LibraryError("corrupt")
    new_sentences = _uploaded_sentences(tmp)
    await progress.set("probe", 0)
    info = await deps.tools.probe(src, home=tmp)
    if not info.has_audio:
        raise LibraryError("no_audio")
    if not _same_length(info.duration_ms, row.duration_ms or 0):
        raise LibraryError("unsupported_format")
    if paths.disk_free(tmp) < 2 * paths.file_bytes(src):
        raise LibraryError("disk_full")
    await progress.set("transcode", 5)
    out_dir = tmp / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    poster = out_dir / "poster.jpg"
    has_poster = info.has_video and await deps.tools.poster(src, poster, info.duration_ms, home=tmp)
    normalized = await _transcode(deps, src, info, out_dir, tmp)
    await progress.set("transcode", 80)
    blobs = deps.storage()
    rel = paths.catalog_rel(row.id)
    name = _fresh_name(row.media_path, normalized.path.name)  # R-KV6: a new key, never the one copies stream
    media_key = f"{rel}/{name}"
    poster_key = paths.catalog_poster_key(row.id)
    written: list[str] = []
    try:
        media_info = await blobs.put_file(media_key, normalized.path, content_type=normalized.mime)
        written.append(media_key)
        size = media_info.size
        poster_rel = row.poster_path
        if has_poster:
            poster_info = await blobs.put_file(poster_key, poster, content_type="image/jpeg")
            written.append(poster_key)
            size += poster_info.size
            poster_rel = poster_key
        elif poster_rel:  # the poster is kept: it still counts toward the catalog item's bytes
            kept = await blobs.stat(poster_rel)
            size += kept.size if kept is not None else 0
    except StorageError as exc:
        await pipeline.forget_keys(blobs, written)
        raise LibraryError("network") from exc
    old_rel = row.media_path
    async with deps.sessionmaker() as s:
        done = await s.execute(update(CatalogItem).where(CatalogItem.id == row.id,
                                                         CatalogItem.status == "processing").values(
            duration_ms=info.duration_ms, media_path=media_key, poster_path=poster_rel,
            media_mime=normalized.mime, media_bytes=size, updated_at=deps.clock()))
        if done.rowcount != 1:
            await s.rollback()
            await pipeline.forget_keys(blobs, written)  # only the new keys: copies still read the old file
            raise Aborted()
        fresh = await s.get(CatalogItem, row.id)
        if new_sentences is not None:
            await catalog_store.rewrite_segments(s, fresh, new_sentences)
        copies = await catalog_store.sync_copies(s, fresh, deps.clock())
        await s.commit()
    (tmp / REPLACE_MARK).unlink(missing_ok=True)
    if old_rel and old_rel != media_key:  # after the commit only: the old object is no longer referenced
        await pipeline.forget_keys(blobs, [old_rel])
    src.unlink(missing_ok=True)
    sentences = len(new_sentences) if new_sentences is not None else row.seg_count
    logger.info("library catalog media replaced catalog=%s kind=%s duration_ms=%d bytes=%d copies=%d sentences=%d",
                row.id, normalized.kind, info.duration_ms, size, copies, sentences)


async def _add_asr_seconds(deps: PipelineDeps, catalog_id: str, seconds: int) -> None:
    if seconds > 0:
        async with deps.sessionmaker() as s:
            await s.execute(update(CatalogItem).where(CatalogItem.id == catalog_id)
                            .values(asr_seconds=CatalogItem.asr_seconds + seconds))
            await s.commit()


async def _sentences(deps: PipelineDeps, row: CatalogItem, media: Path, duration_ms: int, tmp: Path,
                     progress: Progress):
    """(sentences, flags, sub_source, low_confidence) by the spec E6 priority."""
    settings = deps.settings()
    t0 = 45 if row.source == "link" else 20
    await progress.set("subtitles", t0)
    if (tmp / pipeline.UPLOADED_SUBS).is_file():
        cues = subtitles.parse((tmp / pipeline.UPLOADED_SUBS).read_bytes())
        built = segment.build(pipeline.fragments(cues))
        if not built:
            raise LibraryError("bad_subtitle")
        return built, None, "uploaded", False
    if (tmp / pipeline.PLATFORM_SUBS).is_file() and (cues := pipeline.platform_cues(tmp / pipeline.PLATFORM_SUBS)):
        return segment.build(pipeline.fragments(cues)), None, "platform", False
    if not settings.library_asr_available:
        raise LibraryError("no_subtitles")
    chunks, silences, wav, state_path = await pipeline.prepare_chunks(deps, media, duration_ms, tmp)
    transcribe = (deps.timed_transcriber(SYSTEM_USER) if deps.timed_transcriber is not None
                  else pipeline.untimed(deps.transcriber(SYSTEM_USER)))

    async def on_chunk(done: int, total: int) -> None:
        await progress.set("transcribe", t0 + (85 - t0) * done // max(1, total))

    await progress.set("transcribe", t0)
    before = sum(c.seconds for c in chunks if c.text is not None)
    try:
        spent = await pipeline.run_chunks(deps, chunks, wav, state_path, transcribe, on_chunk)
    except BaseException:
        await _add_asr_seconds(deps, row.id, sum(c.seconds for c in chunks if c.text is not None) - before)
        raise
    await _add_asr_seconds(deps, row.id, spent)
    built = await asyncio.to_thread(sentences_mod.build, chunks, silences)
    logger.info("library catalog transcribed catalog=%s chunks=%d seconds=%d sentences=%d", row.id, len(chunks),
                spent, len(built.sentences))
    return built.sentences, built.flags, "asr", built.low_confidence


async def _translate(deps: PipelineDeps, http, catalog_id: str, language: str, template: str | None,
                     progress: Progress) -> tuple[int, bool]:
    """(stored, any batch failed). Only sentences without a translation in `language`; R-SI5."""
    settings = deps.settings()
    if not settings.library_ai_available:
        return 0, False
    async with deps.sessionmaker() as s:
        todo = [(x.idx, x.text) for x in await catalog_store.segments_of(s, catalog_id)
                if not (x.zh and x.zh_lang == language)]
    stored, failed = 0, False
    for start in range(0, len(todo), AI_BATCH_MAX):
        batch = todo[start:start + AI_BATCH_MAX]
        await progress.set("translate", 85 + 14 * start // max(1, len(todo)))
        try:
            with metering.feature_scope(ai.FEATURE_CAT_TRANSLATE):
                got = await ai.translate_texts(http, settings, template=template, language=language,
                                               texts=[text for _idx, text in batch])
        except ai.AiUnavailable:
            failed = True
            continue
        async with deps.sessionmaker() as s:
            stored += len(await catalog_store.set_translations(
                s, catalog_id, [(batch[n][0], batch[n][1], zh) for n, zh in sorted(got.items())], language))
    logger.info("library catalog translated catalog=%s stored=%d todo=%d failed=%s", catalog_id, stored, len(todo),
                "yes" if failed else "no")
    return stored, failed


async def process(deps: PipelineDeps, catalog_id: str, *, http, translate_template: str | None) -> None:
    """Run one claimed catalog item to `ready` (unpublished). Raises LibraryError or Aborted (the job runner maps
    them). The caller binds no user and sets feature `cat_import`."""
    row = await _load(deps, catalog_id)
    tmp = paths.catalog_tmp_dir(deps.data_dir, row.id)
    tmp.mkdir(parents=True, exist_ok=True)
    progress = Progress(deps, row.id)
    if row.seg_count == 0:
        blobs = deps.storage()
        media: Path | None = None
        if not row.media_path or not await pipeline.is_stored(blobs, row.media_path):
            duration_ms, media = await _media_stage(deps, row, tmp, progress)
            row = await _load(deps, catalog_id)
        else:
            duration_ms = row.duration_ms or 0
        # recognition is the only reader of the media: fetch it locally just for that (R7), never for subtitles
        has_subs = (tmp / pipeline.UPLOADED_SUBS).is_file() or (tmp / pipeline.PLATFORM_SUBS).is_file()
        if media is None and not has_subs and deps.settings().library_asr_available:
            media = tmp / f"media{Path(row.media_path).suffix}"
            await pipeline.fetch_media(blobs, row.media_path, media)
        built, flags, sub_source, low = await _sentences(deps, row, media, duration_ms, tmp, progress)
        if not built:
            raise LibraryError("no_subtitles")
        await progress.set("segment", 85)
        async with deps.sessionmaker() as s:
            fresh = await s.get(CatalogItem, catalog_id)
            if fresh is None or fresh.status != "processing":
                raise Aborted()
            await catalog_store.write_segments(s, fresh, built, flags=flags)
            fresh.sub_source, fresh.low_confidence, fresh.updated_at = sub_source, low, deps.clock()
            await s.commit()
    elif (tmp / REPLACE_MARK).is_file():
        await _replace_stage(deps, row, tmp, progress)
    _stored, failed = await _translate(deps, http, catalog_id, row.ai_lang, translate_template, progress)
    async with deps.sessionmaker() as s:
        done = await s.execute(update(CatalogItem).where(CatalogItem.id == catalog_id,
                                                         CatalogItem.status == "processing").values(
            status="ready", stage=None, progress=100, error_kind="upstream" if failed else None, source_url=None,
            updated_at=deps.clock()))
        await s.commit()
    if done.rowcount != 1:
        raise Aborted()
    pipeline.announce(deps, LibraryItemReady(user_id=None, catalog_id=catalog_id))  # plan L4 Task 9: after the commit
    paths.remove_tree(tmp)
    logger.info("library catalog ready catalog=%s", catalog_id)
