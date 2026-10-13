"""一个条目的处理流水线(spec §6.2):取回(仅链接)→ 探测 → 转码 → 字幕 → 转写 → 分句 → 完成。

每个阶段都以「产物在不在」为准,所以自动 / 手动重试从断点继续:规范化后的媒体已在成品目录就跳过取回与转码,
`_tmp/<id>/chunks.json` 里已转写的块不再花钱。进度按权重写库(链接:取回 0–40、转码 40–60、转写 60–95、
分句与收尾 95–100;上传:转码 0–50、转写 50–95),变化 ≥ 2 个百分点或距上次 ≥ 1 秒才写;写库发现条目已不在
`processing`(取消 / 删除)就抛 `Aborted`。

取回阶段只有一个接口 `FetchStage`;默认实现 `NoFetch` 抛 `unsupported_site`,计划 S2 在 `main.py` 的锚点处换成
yt-dlp 的实现(spec §15)。日志只记条目 id、阶段、错误种类、字节数与毫秒数。
"""
import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from sqlalchemy import update

from app.library import asr_chunks, limits, paths, segment, store, subtitles
from app.library.errors import Aborted, LibraryError
from app.library.media import ProbeInfo
from app.models import LibraryItem

logger = logging.getLogger(__name__)

UPLOADED_SUBS = "subs.raw"
PLATFORM_SUBS = "platform.srt"
SILENCES = "silences.json"
SPEECH_WAV = "speech.wav"
CHUNKS = "chunks.json"
INPUT_PREFIX = "in."


# ---- the fetch stage interface (implemented by plan S2) ----

@dataclass(frozen=True)
class FetchRequest:
    item_id: str
    user_id: int
    url: str
    tmp_dir: Path  # the item's `_tmp` directory: write every output here, never elsewhere
    settings: Any  # the current Settings (read the library_* limits from it)
    asr_available: bool  # transcription is possible: then skip platform auto-captions (E6)
    report: Callable[[int], Awaitable[None]]  # progress 0-100 inside the fetch stage; raises Aborted when canceled


@dataclass(frozen=True)
class FetchResult:
    media_path: Path  # the downloaded file, inside tmp_dir
    title: str | None = None  # the page title; used only when the item's title is "" (never logged)
    duration_ms: int | None = None  # informational; the probe decides
    subtitle_path: Path | None = None  # an SRT inside tmp_dir (manual subtitles, or auto ones only without ASR)
    subtitle_auto: bool = False  # platform auto-captions (the parser already drops rolling repeats)
    source_host: str | None = None


class FetchStage(Protocol):
    async def fetch(self, req: FetchRequest) -> FetchResult: ...


class NoFetch:
    """Until plan S2 registers yt-dlp: every link fails as `unsupported_site`."""

    async def fetch(self, req: FetchRequest) -> FetchResult:
        raise LibraryError("unsupported_site")


# ---- dependencies ----

class MediaTools(Protocol):
    async def probe(self, src: Path, *, home: Path) -> ProbeInfo: ...

    async def normalize(self, src: Path, info: ProbeInfo, out_dir: Path, *, max_height: int, home: Path,
                        progress: Callable[[float], Awaitable[None]] | None = None) -> Any: ...

    async def poster(self, media: Path, dst: Path, duration_ms: int, *, home: Path) -> bool: ...

    async def speech_wav(self, src: Path, dst: Path, duration_ms: int, *, home: Path) -> list: ...


@dataclass
class PipelineDeps:
    sessionmaker: Any
    settings: Callable[[], Any]
    data_dir: Path
    tools: MediaTools
    fetch: Callable[[], FetchStage]  # read at run time: S2 may replace the stage after startup
    transcriber: Callable[[int], Callable[[bytes], Awaitable[str]]]  # user id -> (16 kHz WAV -> text)
    clock: Callable[[], datetime]


class Progress:
    """Throttled stage / progress writes. `Aborted` once the item left `processing`."""

    def __init__(self, deps: PipelineDeps, item_id: str, monotonic: Callable[[], float] = time.monotonic):
        self._deps = deps
        self._item_id = item_id
        self._monotonic = monotonic
        self.stage: str | None = None
        self.value = -100
        self._at = float("-inf")

    async def set(self, stage: str, value: int) -> None:
        now = self._monotonic()
        if stage == self.stage and (value == self.value or (value - self.value < 2 and now - self._at < 1.0)):
            return
        async with self._deps.sessionmaker() as s:
            if not await store.set_progress(s, self._item_id, stage, value, self._deps.clock()):
                raise Aborted()
        self.stage, self.value, self._at = stage, value, now


def _input_file(tmp: Path) -> Path | None:
    return next((p for p in sorted(tmp.glob(INPUT_PREFIX + "*")) if p.is_file()), None)


def _fragments(cues: list[subtitles.Cue]) -> list[segment.Fragment]:
    return [segment.Fragment(c.start_ms, c.end_ms, c.text) for c in cues]


async def _media_stage(deps: PipelineDeps, item: LibraryItem, tmp: Path, progress: Progress) -> int:
    """Fetch (links) or take the upload, probe, normalize and move into the item directory. Returns the duration."""
    settings = deps.settings()
    link = item.source == "link"
    t0, t1 = (40, 60) if link else (0, 50)
    if link:
        await progress.set("fetch", 0)
        result = await deps.fetch().fetch(fetch_request(item, tmp, settings, progress))
        src = result.media_path
        if result.subtitle_path is not None and result.subtitle_path.is_file():
            paths.replace(result.subtitle_path, tmp / PLATFORM_SUBS)
        values = {}
        if result.title and not item.title:  # the user gave no title (R-SC22)
            values["title"] = store.clean_title(result.title)
        if result.source_host and not item.source_host:
            values["source_host"] = result.source_host[:64]
        if values:
            async with deps.sessionmaker() as s:
                await s.execute(update(LibraryItem).where(LibraryItem.id == item.id).values(**values))
                await s.commit()
    else:
        src = _input_file(tmp)
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

    async def on_progress(fraction: float) -> None:
        await progress.set("transcode", t0 + round((t1 - t0) * fraction))

    normalized = await deps.tools.normalize(src, info, out_dir, max_height=settings.library_transcode_max_height,
                                            home=tmp, progress=on_progress)
    poster = out_dir / "poster.jpg"
    has_poster = normalized.kind == "video" and await deps.tools.poster(normalized.path, poster, info.duration_ms,
                                                                        home=tmp)
    final = paths.item_dir(deps.data_dir, item.user_id, item.id)
    media_dst = final / normalized.path.name
    paths.replace(normalized.path, media_dst)
    poster_dst = final / "poster.jpg"
    if has_poster:
        paths.replace(poster, poster_dst)
    size = paths.file_bytes(media_dst) + (paths.file_bytes(poster_dst) if has_poster else 0)
    rel = paths.item_rel(item.user_id, item.id)
    async with deps.sessionmaker() as s:
        done = await s.execute(update(LibraryItem).where(LibraryItem.id == item.id,
                                                         LibraryItem.status == "processing").values(
            kind=normalized.kind, duration_ms=info.duration_ms, media_path=f"{rel}/{media_dst.name}",
            poster_path=f"{rel}/poster.jpg" if has_poster else None, media_mime=normalized.mime,
            library_bytes=size, updated_at=deps.clock()))
        await s.commit()
    if done.rowcount != 1:
        paths.remove_tree(final)
        raise Aborted()
    src.unlink(missing_ok=True)  # the original upload / download is not kept (spec §5.1)
    logger.info("library media ready item=%s kind=%s duration_ms=%d bytes=%d", item.id, normalized.kind,
                info.duration_ms, size)
    return info.duration_ms


def fetch_request(item: LibraryItem, tmp: Path, settings, progress: Progress) -> FetchRequest:
    async def report(percent: int) -> None:
        await progress.set("fetch", round(40 * max(0, min(100, percent)) / 100))

    return FetchRequest(item_id=item.id, user_id=item.user_id, url=item.source_url or "", tmp_dir=tmp,
                        settings=settings, asr_available=settings.library_asr_available, report=report)


async def _add_asr_seconds(deps: PipelineDeps, item_id: str, seconds: int) -> None:
    if seconds <= 0:
        return
    async with deps.sessionmaker() as s:
        await s.execute(update(LibraryItem).where(LibraryItem.id == item_id)
                        .values(asr_seconds=LibraryItem.asr_seconds + seconds))
        await s.commit()


async def _transcribe(deps: PipelineDeps, item: LibraryItem, media: Path, duration_ms: int, tmp: Path,
                      progress: Progress, t0: int) -> list[segment.Sentence]:
    settings = deps.settings()
    wav, state_path, silences_path = tmp / SPEECH_WAV, tmp / CHUNKS, tmp / SILENCES
    chunks = asr_chunks.load_state(state_path)
    silences: list[asr_chunks.Silence] | None = None
    try:
        silences = [asr_chunks.Silence(int(a), int(b)) for a, b in json.loads(silences_path.read_text("utf-8"))]
    except (OSError, ValueError, TypeError):
        silences = None
    if silences is None or not wav.is_file():
        silences = await deps.tools.speech_wav(media, wav, duration_ms, home=tmp)
        silences_path.write_text(json.dumps([[s.start_ms, s.end_ms] for s in silences]), encoding="utf-8")
    if chunks is None:
        chunks = asr_chunks.plan_chunks(duration_ms, silences)
        asr_chunks.save_state(state_path, chunks)
    need = sum(c.seconds for c in chunks if c.text is None)
    uid, day = str(item.user_id), limits.day_of(deps.clock())
    async with deps.sessionmaker() as s:
        if not await limits.reserve(s, limits.SCOPE_ASR, uid, day, need,
                                    settings.library_asr_minutes_daily_per_user * 60):
            raise LibraryError("quota")
        if not await limits.reserve(s, limits.SCOPE_ASR, limits.GLOBAL, day, need,
                                    settings.library_asr_minutes_global_daily * 60):
            await limits.release(s, limits.SCOPE_ASR, uid, day, need)
            raise LibraryError("quota")
    t1 = 95

    async def read(chunk: asr_chunks.Chunk) -> bytes:
        return await asyncio.to_thread(asr_chunks.slice_wav, wav, chunk.start_ms, chunk.end_ms)

    async def on_chunk(done: int, total: int) -> None:
        await progress.set("transcribe", t0 + (t1 - t0) * done // max(1, total))

    await progress.set("transcribe", t0)
    try:
        spent = await asr_chunks.transcribe_chunks(
            chunks, read=read, transcribe=deps.transcriber(item.user_id),
            save=lambda c: asr_chunks.save_state(state_path, c), progress=on_chunk,
            concurrency=limits.ASR_CONCURRENCY, retries=limits.ASR_CHUNK_RETRIES)
    except BaseException:
        unspent = sum(c.seconds for c in chunks if c.text is None)
        async with deps.sessionmaker() as s:  # give back what was not transcribed (spec §6.4 step 7)
            await limits.release(s, limits.SCOPE_ASR, uid, day, unspent)
            await limits.release(s, limits.SCOPE_ASR, limits.GLOBAL, day, unspent)
        await _add_asr_seconds(deps, item.id, need - unspent)
        raise
    await _add_asr_seconds(deps, item.id, spent)
    logger.info("library transcribed item=%s chunks=%d seconds=%d", item.id, len(chunks), spent)
    return segment.build(asr_chunks.fragments(chunks, silences), adjust=asr_chunks.snapper(silences))


async def process(deps: PipelineDeps, item_id: str) -> None:
    """Run one claimed item to `ready`. Raises LibraryError (classified failure) or Aborted (canceled / deleted)."""
    async with deps.sessionmaker() as s:
        item = await s.get(LibraryItem, item_id)
        if item is None or item.status != "processing":
            raise Aborted()
    settings = deps.settings()
    tmp = paths.tmp_dir(deps.data_dir, item.id)
    tmp.mkdir(parents=True, exist_ok=True)
    progress = Progress(deps, item.id)
    media = deps.data_dir / item.media_path if item.media_path else None
    if media is None or not media.is_file():
        duration_ms = await _media_stage(deps, item, tmp, progress)
        async with deps.sessionmaker() as s:
            item = await s.get(LibraryItem, item_id)
        media = deps.data_dir / item.media_path
    else:
        duration_ms = item.duration_ms or 0
    t0 = 60 if item.source == "link" else 50
    await progress.set("subtitles", t0)
    sentences: list[segment.Sentence]
    if (tmp / UPLOADED_SUBS).is_file():
        cues = subtitles.parse((tmp / UPLOADED_SUBS).read_bytes())
        sentences, sub_source = segment.build(_fragments(cues)), "uploaded"
        if not sentences:
            raise LibraryError("bad_subtitle")
    elif (tmp / PLATFORM_SUBS).is_file() and (cues := _platform_cues(tmp / PLATFORM_SUBS)):
        sentences, sub_source = segment.build(_fragments(cues)), "platform"
    elif settings.library_asr_available:
        sentences, sub_source = await _transcribe(deps, item, media, duration_ms, tmp, progress, t0), "asr"
    else:
        raise LibraryError("no_subtitles")
    if not sentences:
        raise LibraryError("no_subtitles")
    await progress.set("segment", 95)
    async with deps.sessionmaker() as s:
        row = await s.get(LibraryItem, item_id)
        if row is None or row.status != "processing":
            raise Aborted()
        await store.write_segments(s, row, sentences)
        row.sub_source, row.status, row.stage, row.progress = sub_source, "ready", None, 100
        row.error_kind, row.source_url, row.next_run_at, row.attempts = None, None, None, 0
        row.updated_at = deps.clock()
        await s.commit()
    paths.remove_tree(tmp)
    logger.info("library item ready item=%s sentences=%d sub_source=%s", item_id, len(sentences), sub_source)


def _platform_cues(path: Path) -> list[subtitles.Cue]:
    try:
        return subtitles.parse(path.read_bytes())
    except LibraryError:
        return []  # unusable platform subtitles: fall through to transcription
