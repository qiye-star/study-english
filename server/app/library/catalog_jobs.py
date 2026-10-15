"""精选库的导入任务(spec 2026-10-14-curated-library E6):`app.state.catalog`。

一次一个、没有轮询循环:建条目、重试、补全译文、启动恢复时 `kick()`;`run_once()` 连续认领直到队列为空。
工具、取回阶段、识别器取自 `app.state.library.deps`(测试的 use_fakes / set_fetch_stage 自动生效)。
不自动重试(管理员按「重试」)。每个任务 `bind_user(None)` + feature `cat_import`。日志只有目录 id、种类与数字。"""
import asyncio
import logging
import time
import weakref

from app.core import metering
from app.library import catalog_import, catalog_store, paths
from app.library.errors import Aborted, LibraryError
from app.library.pipeline import PipelineDeps
from app.library.worker import DROP_STAGING
from app.services.prompts import prompt_cache

logger = logging.getLogger(__name__)

CANCEL_WAIT_SECONDS = 5.0


class CatalogJobs:
    def __init__(self, app, *, monotonic=time.monotonic):
        self._app = app
        self._monotonic = monotonic
        self.pending: set[asyncio.Task] = set()
        self.running: dict[str, asyncio.Task] = {}
        self._runner: asyncio.Task | None = None
        self._again = False
        self._canceled: set[str] = set()
        self._locks: weakref.WeakValueDictionary[str, asyncio.Lock] = weakref.WeakValueDictionary()

    @property
    def deps(self) -> PipelineDeps:
        return self._app.state.library.deps

    def upload_lock(self, catalog_id: str) -> asyncio.Lock:
        lock = self._locks.get(catalog_id)
        if lock is None:
            lock = self._locks[catalog_id] = asyncio.Lock()
        return lock

    def kick(self) -> None:
        if self._runner is not None and not self._runner.done():
            self._again = True
            return
        task = asyncio.get_running_loop().create_task(self.run_once())
        self._runner = task
        self.pending.add(task)
        task.add_done_callback(self.pending.discard)

    async def run_once(self) -> int:
        count = 0
        while True:
            if not self.deps.settings().library_available:
                return count
            self._again = False
            async with self.deps.sessionmaker() as s:
                row = await catalog_store.claim_next(s, self.deps.clock())
            if row is None:
                if self._again:
                    continue
                return count
            job = asyncio.get_running_loop().create_task(self._job(row.id))
            self.running[row.id] = job
            self.pending.add(job)
            job.add_done_callback(self.pending.discard)
            await asyncio.gather(job, return_exceptions=True)
            count += 1

    async def _job(self, catalog_id: str) -> None:
        started = self._monotonic()
        metering.bind_user(None)  # the system pays (spec R4); this task's own context copy
        try:
            _version, template = await prompt_cache(self._app).get("library.translate")
            with metering.feature_scope(catalog_import.FEATURE):
                await catalog_import.process(self.deps, catalog_id, http=self._app.state.http,
                                             translate_template=template)
        except Aborted:
            logger.info("library catalog job aborted catalog=%s", catalog_id)
        except asyncio.CancelledError:
            if catalog_id not in self._canceled:
                raise  # shutdown: the row stays `processing`, recovered at the next start
            logger.info("library catalog job canceled catalog=%s", catalog_id)
        except LibraryError as e:
            await self._failed(catalog_id, e.kind)
        except Exception as e:  # noqa: BLE001 - a bug: classify as upstream, log the class only
            logger.warning("library catalog job crashed catalog=%s error=%s", catalog_id, type(e).__name__)
            await self._failed(catalog_id, "upstream")
        else:
            logger.info("library catalog job done catalog=%s ms=%d", catalog_id, (self._monotonic() - started) * 1000)
        finally:
            self.running.pop(catalog_id, None)
            self._canceled.discard(catalog_id)

    async def _failed(self, catalog_id: str, kind: str) -> None:
        async with self.deps.sessionmaker() as s:
            await catalog_store.fail(s, catalog_id, kind, self.deps.clock())
        tmp = paths.catalog_tmp_dir(self.deps.data_dir, catalog_id)
        if kind in DROP_STAGING or (tmp / catalog_import.REPLACE_MARK).is_file():  # R-KV9
            paths.remove_tree(tmp)
        logger.info("library catalog job failed catalog=%s kind=%s", catalog_id, kind)

    async def cancel(self, catalog_id: str) -> None:
        """Stop a running job (the caller already changed the row) and wait for its subprocesses."""
        task = self.running.get(catalog_id)
        if task is None or task.done():
            return
        self._canceled.add(catalog_id)
        task.cancel()
        try:
            await asyncio.wait_for(asyncio.shield(asyncio.gather(task, return_exceptions=True)), CANCEL_WAIT_SECONDS)
        except (TimeoutError, asyncio.TimeoutError):
            logger.warning("library catalog cancel slow catalog=%s", catalog_id)

    async def recover(self) -> int:
        try:
            async with self.deps.sessionmaker() as s:
                count = await catalog_store.recover(s, self.deps.clock())
        except Exception as e:  # noqa: BLE001 - an unmigrated schema must not kill the lifespan; class name only
            logger.warning("library catalog recovery failed error=%s", type(e).__name__)
            return 0
        logger.info("library catalog recovered=%d", count)
        self.kick()
        return count

    async def shutdown(self, wait: float = 2.0) -> None:
        tasks = [t for t in self.pending if not t.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            try:
                await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), wait)
            except (TimeoutError, asyncio.TimeoutError):
                logger.warning("library catalog shutdown left jobs=%d", len([t for t in tasks if not t.done()]))


def install(app) -> CatalogJobs:
    """Build the one runner on `app.state.catalog` (called from `create_app` at plan SC's anchor)."""
    jobs = CatalogJobs(app)
    app.state.catalog = jobs
    return jobs
