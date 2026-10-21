"""进程内后台队列(spec §6.1、§6.5):`app.state.library` 是唯一的 `LibraryWorker`。

- `loop()`(lifespan 里的 `tasks["library"]`):启动时把 `processing` 恢复为 `queued` 并清扫一次,之后每 2 秒或被
  `wake()` 唤醒时 `run_once()`;每天清扫一次。循环本身不在 `pending` 里(它按设计一直在睡)。
- `run_once()`:按 `created_at` 原子认领到期的 `queued` 条目,最多 `library_job_concurrency` 个同时运行;
  运行中的任务在 `pending`(完成自己移除;`tests/background.py` 等它)。测试不起循环,手动调 `run_once()`。
- 失败:瞬时错误(upstream / network / ytdlp_transient)自动重试 ≤ 2 次,退避 30 s、120 s;其余直接 `failed`。
  意外异常按 `upstream` 处理(计划 R-SC18)。取消 = 结束子进程、清 `_tmp`;关停 = 取消所有任务,条目留在
  `processing`,下次启动恢复。
- 每个任务都 `metering.bind_user(所有者)` + `feature_scope("library")`(spec §2.2「用量归属」)。
日志只有条目 id、错误种类、异常类名与数字。"""
import asyncio
import logging
import time
import weakref
from datetime import datetime, timedelta
from pathlib import Path

from app.core import metering
from app.library import catalog_store, limits, paths, pipeline, store
from app.library.errors import LINK, TRANSIENT, Aborted, LibraryError
from app.library.media import Ffmpeg
from app.library.pipeline import FetchStage, NoFetch, PipelineDeps
from app.library.tickets import MediaTicketStore
from app.models import LibraryItem, utcnow
from app.speech.asr import make_timed_transcriber, make_transcriber, shared_asr_gate

logger = logging.getLogger(__name__)

FEATURE = "library"
SWEEP_EVERY_SECONDS = 24 * 3600
CANCEL_WAIT_SECONDS = 5.0
# permanent failures whose staging files are useless for a retry (the upload / download is broken or refused)
DROP_STAGING = frozenset({"corrupt", "too_long", "no_audio", "unsupported_format", "too_large", "upload_expired",
                          "bad_subtitle"}) | LINK


class LibraryWorker:
    def __init__(self, deps: PipelineDeps, *, monotonic=time.monotonic):
        self.deps = deps
        self.fetch_stage: FetchStage = NoFetch()
        self.tickets = MediaTicketStore()
        self.pending: set[asyncio.Task] = set()
        self.running: dict[str, asyncio.Task] = {}
        self._canceled: set[str] = set()
        self._locks: weakref.WeakValueDictionary[str, asyncio.Lock] = weakref.WeakValueDictionary()
        self._wake: asyncio.Event | None = None
        self._monotonic = monotonic

    # ---- hooks for the routers ----

    def set_fetch_stage(self, stage: FetchStage) -> None:
        """Plan S2 registers the yt-dlp stage here (main.py anchor)."""
        self.fetch_stage = stage

    def wake(self) -> None:
        if self._wake is not None:
            self._wake.set()

    def upload_lock(self, item_id: str) -> asyncio.Lock:
        lock = self._locks.get(item_id)
        if lock is None:
            lock = self._locks[item_id] = asyncio.Lock()
        return lock

    async def cancel(self, item_id: str) -> None:
        """Stop a running job (the caller already changed the row) and wait for its subprocesses to end."""
        task = self.running.get(item_id)
        if task is None or task.done():
            return
        self._canceled.add(item_id)
        task.cancel()
        try:
            await asyncio.wait_for(asyncio.shield(asyncio.gather(task, return_exceptions=True)), CANCEL_WAIT_SECONDS)
        except (TimeoutError, asyncio.TimeoutError):
            logger.warning("library cancel slow item=%s", item_id)

    # ---- queue ----

    async def run_once(self) -> int:
        settings = self.deps.settings()
        if not settings.library_available:
            return 0
        free = settings.library_job_concurrency - len(self.running)
        async with self.deps.sessionmaker() as s:
            claimed = await store.claim(s, self.deps.clock(), free)
        for item in claimed:
            task = asyncio.get_running_loop().create_task(self._job(item.id, item.user_id))
            self.running[item.id] = task
            self.pending.add(task)
            task.add_done_callback(self.pending.discard)
        return len(claimed)

    async def _job(self, item_id: str, user_id: int) -> None:
        started = self._monotonic()
        metering.bind_user(user_id)  # this task's own context copy
        try:
            with metering.feature_scope(FEATURE):
                await pipeline.process(self.deps, item_id)
        except Aborted:
            self._drop_staging(item_id)
            logger.info("library job aborted item=%s", item_id)
        except asyncio.CancelledError:
            if item_id not in self._canceled:
                raise  # shutdown: the row stays `processing` and is recovered at the next start
            self._drop_staging(item_id)
            logger.info("library job canceled item=%s", item_id)
        except LibraryError as e:
            await self._failed(item_id, e.kind)
        except Exception as e:  # noqa: BLE001 - an unexpected bug: classify as transient, log the class only
            logger.warning("library job crashed item=%s error=%s", item_id, type(e).__name__)
            await self._failed(item_id, "upstream")
        else:
            logger.info("library job done item=%s ms=%d", item_id, (self._monotonic() - started) * 1000)
        finally:
            self.running.pop(item_id, None)
            self._canceled.discard(item_id)

    async def _failed(self, item_id: str, kind: str) -> None:
        now = self.deps.clock()
        async with self.deps.sessionmaker() as s:
            row = await s.get(LibraryItem, item_id)
            if row is None:
                return
            retry_at = None
            if kind in TRANSIENT and row.attempts < limits.AUTO_RETRIES:
                retry_at = now + timedelta(seconds=limits.BACKOFF_SECONDS[row.attempts])
            await store.fail(s, item_id, kind, retry_at=retry_at, now=now)
            await s.refresh(row)
            restored = row.status == "ready"  # a failed re-recognition: the item is playable again (R-R3)
        if retry_at is None and (kind in DROP_STAGING or restored):
            self._drop_staging(item_id)
        logger.info("library job failed item=%s kind=%s retry=%s", item_id, kind, retry_at is not None)

    def _drop_staging(self, item_id: str) -> None:
        try:
            paths.remove_tree(paths.tmp_dir(self.deps.data_dir, item_id))
        except ValueError:
            pass

    # ---- loop, sweep, shutdown ----

    async def loop(self) -> None:
        self._wake = asyncio.Event()
        async with self.deps.sessionmaker() as s:
            recovered = await store.recover(s, self.deps.clock())
        logger.info("library worker started recovered=%d", recovered)
        await self._safe_sweep()
        last_sweep = self._monotonic()
        while True:
            try:
                await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - keep polling
                logger.warning("library worker poll failed error=%s", type(e).__name__)
            if self._monotonic() - last_sweep >= SWEEP_EVERY_SECONDS:
                await self._safe_sweep()
                last_sweep = self._monotonic()
            try:
                await asyncio.wait_for(self._wake.wait(), limits.POLL_SECONDS)
            except (TimeoutError, asyncio.TimeoutError):
                pass
            self._wake.clear()

    async def _safe_sweep(self) -> None:
        try:
            await self.sweep(self.deps.clock())
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            logger.warning("library sweep failed error=%s", type(e).__name__)

    async def sweep(self, now: datetime) -> dict[str, int]:
        """Expire 24 h old uploads, purge failed / canceled items after 7 days (rows + files), and remove staging
        directories whose item is gone, ready or canceled (failed items keep theirs for a retry; R-SC17)."""
        data_dir = self.deps.data_dir
        async with self.deps.sessionmaker() as s:
            expired = await store.expire_uploads(s, now)
            stale = await store.stale_items(s, now)
            for _user, item_id in stale:
                if item_id not in self.running:
                    await store.delete_item_rows(s, item_id)
            await s.commit()
        for item_id in expired:
            self._drop_staging(item_id)
        for user_id, item_id in stale:
            if item_id not in self.running:
                await paths.remove_item_files(self.deps.storage(), data_dir, user_id, item_id)
        orphans = 0
        root = paths.tmp_root(data_dir)
        if root.is_dir():
            names = [p.name for p in root.iterdir() if p.is_dir() and store.is_item_id(p.name)]
            async with self.deps.sessionmaker() as s:
                known = await store.statuses(s, names)
            for name in names:
                if name not in self.running and known.get(name) in (None, "ready", "canceled"):
                    paths.remove_tree(root / name)
                    orphans += 1
        try:  # spec 2026-10-14-curated-library R1: retired catalog items nobody uses any more
            async with self.deps.sessionmaker() as s:
                collected = await catalog_store.collect_retired(s, self.deps.storage(), data_dir)
            if collected:
                logger.info("library sweep catalog collected=%d", collected)
        except Exception as e:  # noqa: BLE001 - the user library's sweep must not fail because of the catalog
            logger.warning("library sweep catalog failed error=%s", type(e).__name__)
        counts = {"expired": len(expired), "purged": len(stale), "orphans": orphans}
        logger.info("library sweep expired=%d purged=%d orphans=%d", *counts.values())
        return counts

    async def join(self) -> None:
        while self.pending:
            await asyncio.gather(*list(self.pending), return_exceptions=True)

    async def shutdown(self, wait: float = limits.SHUTDOWN_WAIT_SECONDS) -> None:
        """Cancel running jobs (rows stay `processing`, recovered at the next start); wait at most `wait` seconds."""
        tasks = [t for t in self.pending if not t.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            try:
                await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), wait)
            except (TimeoutError, asyncio.TimeoutError):
                logger.warning("library shutdown left jobs=%d", len([t for t in tasks if not t.done()]))


def install(app) -> LibraryWorker:
    """Build the one worker on `app.state.library` (called from `create_app`). Settings are read per call;
    the data directory is fixed at startup (DATA_DIR is env-only)."""
    state = app.state

    def settings():
        return state.settings

    def transcriber(user_id: int):
        s = settings()
        return make_transcriber(state.http, s, "en", gate=shared_asr_gate(state, s), uid=str(user_id))

    def timed_transcriber(user_id: int):
        s = settings()
        return make_timed_transcriber(state.http, s, "en", gate=shared_asr_gate(state, s), uid=str(user_id),
                                      final_empty=True)  # plan v2 R-V12: an empty answer = no speech, no fallback

    worker: LibraryWorker | None = None
    deps = PipelineDeps(sessionmaker=state.sessionmaker, settings=settings,
                        data_dir=Path(state.settings.resolved_data_dir), storage=lambda: state.storage,
                        tools=Ffmpeg(),
                        fetch=lambda: worker.fetch_stage, transcriber=transcriber, clock=utcnow,
                        timed_transcriber=timed_transcriber)
    worker = LibraryWorker(deps)
    state.library = worker
    return worker
