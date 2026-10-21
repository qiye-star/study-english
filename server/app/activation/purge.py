"""孤儿句子索引的每日清扫(plan L4 R10):属主(library_items / catalog_items)已经不存在的 segment_lemma 行。

读侧本来就 join 属主表,所以孤儿不可见;这里只回收空间。一次最多删 PURGE_BATCH 行;开关关时什么都不做。
日志只记删除的行数与异常类名。
"""
import asyncio
import logging

from sqlalchemy import delete, select, tuple_

from app.models import CatalogItem, LibraryItem, SegmentLemma

logger = logging.getLogger(__name__)
PURGE_BATCH = 5000  # rows per sweep
CHUNK = 500  # rows per delete statement
DAILY_SECONDS = 21600.0


def _orphan_keys(scope: str, limit: int):
    model = LibraryItem if scope == "lib" else CatalogItem
    return (select(SegmentLemma.scope, SegmentLemma.owner_id, SegmentLemma.idx, SegmentLemma.lemma)
            .where(SegmentLemma.scope == scope, SegmentLemma.owner_id.not_in(select(model.id)))
            .limit(limit))


async def purge_orphans(sessionmaker, *, batch: int = PURGE_BATCH) -> int:
    """Delete at most `batch` orphan rows. Returns the number deleted."""
    removed = 0
    async with sessionmaker() as session:
        for scope in ("lib", "cat"):
            while removed < batch:
                keys = [tuple(row) for row in (await session.execute(
                    _orphan_keys(scope, min(CHUNK, batch - removed)))).all()]
                if not keys:
                    break
                result = await session.execute(delete(SegmentLemma).where(tuple_(
                    SegmentLemma.scope, SegmentLemma.owner_id, SegmentLemma.idx, SegmentLemma.lemma).in_(keys)))
                await session.commit()
                if not result.rowcount:
                    break  # nothing was removed (a concurrent sweep): stop rather than loop
                removed += result.rowcount
    return removed


async def run_once(app) -> int:
    """One sweep, only while `ACTIVATION_ENABLED` is on (read per call)."""
    if not app.state.settings.activation_enabled:
        return 0
    return await purge_orphans(app.state.sessionmaker)


async def daily_loop(app, interval: float = DAILY_SECONDS) -> None:
    while True:
        try:
            removed = await run_once(app)
            if removed:
                logger.info("activation purge rows=%d", removed)
        except Exception as exc:  # noqa: BLE001 - housekeeping must not die
            logger.warning("activation purge failed error=%s", type(exc).__name__)
        await asyncio.sleep(interval)
