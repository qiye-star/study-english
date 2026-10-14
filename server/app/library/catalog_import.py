"""精选库一条目录条目的导入(spec 2026-10-14-curated-library §7;INDEX §7)。

取回(链接,`FetchRequest.system=True`)→ 探测 → 封面(视频源)→ `audio_only` → 上传的字幕 > 平台字幕 > 识别(系统付费,
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
from app.library import ai, catalog_store, paths, pipeline, segment, sentences as sentences_mod, store, subtitles
from app.library.errors import Aborted, LibraryError
from app.library.limits import AI_BATCH_MAX
from app.library.pipeline import FetchRequest, PipelineDeps
from app.models import CatalogItem

logger = logging.getLogger(__name__)

FEATURE = "cat_import"  # metering feature of the import job (<= 16 chars)
SYSTEM_USER = 0  # FetchRequest.user_id / transcriber argument for system jobs (R-SI1)


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


async def _media_stage(deps: PipelineDeps, row: CatalogItem, tmp: Path, progress: Progress) -> int:
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
    normalized = await deps.tools.audio_only(src, out_dir, duration_ms=info.duration_ms, home=tmp)
    await progress.set("transcode", t1)
    final = paths.catalog_dir(deps.data_dir, row.id)
    media_dst = final / "media.m4a"
    paths.replace(normalized.path, media_dst)
    if has_poster:
        paths.replace(poster, final / "poster.jpg")
    size = paths.file_bytes(media_dst) + (paths.file_bytes(final / "poster.jpg") if has_poster else 0)
    rel = paths.catalog_rel(row.id)
    async with deps.sessionmaker() as s:
        done = await s.execute(update(CatalogItem).where(CatalogItem.id == row.id,
                                                         CatalogItem.status == "processing").values(
            duration_ms=info.duration_ms, media_path=f"{rel}/media.m4a",
            poster_path=f"{rel}/poster.jpg" if has_poster else None, media_mime=normalized.mime,
            media_bytes=size, updated_at=deps.clock()))
        await s.commit()
    if done.rowcount != 1:
        paths.remove_tree(final)
        raise Aborted()
    src.unlink(missing_ok=True)  # the original download / upload is not kept
    logger.info("library catalog media ready catalog=%s duration_ms=%d bytes=%d poster=%s", row.id,
                info.duration_ms, size, "yes" if has_poster else "no")
    return info.duration_ms


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
        media = None
        if row.media_path:
            candidate = paths.absolute(deps.data_dir, row.media_path)
            media = candidate if candidate.is_file() else None
        if media is None:
            duration_ms = await _media_stage(deps, row, tmp, progress)
            row = await _load(deps, catalog_id)
            media = paths.absolute(deps.data_dir, row.media_path)
        else:
            duration_ms = row.duration_ms or 0
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
    _stored, failed = await _translate(deps, http, catalog_id, row.ai_lang, translate_template, progress)
    async with deps.sessionmaker() as s:
        done = await s.execute(update(CatalogItem).where(CatalogItem.id == catalog_id,
                                                         CatalogItem.status == "processing").values(
            status="ready", stage=None, progress=100, error_kind="upstream" if failed else None, source_url=None,
            updated_at=deps.clock()))
        await s.commit()
    if done.rowcount != 1:
        raise Aborted()
    paths.remove_tree(tmp)
    logger.info("library catalog ready catalog=%s", catalog_id)
