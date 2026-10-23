"""句子倒排 segment_lemma(plan L4 Task 8 / R10、R11)与 LibraryItemReady 处理器。

- 索引在总线之外建:处理器只把 (scope, owner_id) 交给进程内 `Indexer`(待办 ≤ MAX_PENDING、一次一个、
  分块 CHUNK 句、分词放线程),不在 2 秒处理器超时内做重活。
- 重建 = 同一事务内删掉该 owner 的全部行再插入,幂等;末尾写一行标记 (idx = -1, lemma = "#v1")。
- 精选库副本(library_items.catalog_id 非空)若 'cat' 作用域已有标记,则按 idx 复制行,不重新分词。
- 日志只记 scope、计数与异常类名;句子文字、词元永不进日志。
"""
import asyncio
import functools
import logging

from sqlalchemy import delete, select

from app.activation import matcher
from app.activation.usage import lemma_source
from app.core.learning_events import LibraryItemReady
from app.models import CatalogItem, CatalogSegment, LibraryItem, LibrarySegment, SegmentLemma

logger = logging.getLogger(__name__)

FLAG = "activation_enabled"
MARKER = "#v1"  # bump the marker when the indexing rule changes; backfill keys on it (R10, R12)
MARKER_IDX = -1
MAX_PENDING = 200  # R11: bounded queue, overflow is dropped and counted
CHUNK = 500  # sentences per read / tokenize step


def _sentence_lemmas(sentences: list[tuple[int, str]], lemma_of) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    for idx, text in sentences:
        out.extend((idx, lemma) for lemma in sorted(matcher.segment_lemmas(text, lemma_of)))
    return out


async def _owner_is_ready(session, scope: str, owner_id: str) -> bool:
    model = LibraryItem if scope == "lib" else CatalogItem
    return (await session.scalar(select(model.status).where(model.id == owner_id))) == "ready"


async def _copy_source(session, scope: str, owner_id: str) -> str | None:
    """A library copy of a catalog item reuses the catalog's rows when they exist (R11)."""
    if scope != "lib":
        return None
    catalog_id = await session.scalar(select(LibraryItem.catalog_id).where(LibraryItem.id == owner_id))
    if not catalog_id:
        return None
    marked = await session.scalar(select(SegmentLemma.owner_id).where(
        SegmentLemma.scope == "cat", SegmentLemma.owner_id == catalog_id,
        SegmentLemma.idx == MARKER_IDX, SegmentLemma.lemma == MARKER))
    return catalog_id if marked else None


async def index_owner(app, scope: str, owner_id: str, *, lemma_of=None) -> int:
    """Rebuild one owner's rows. Returns the number of lemma rows written (the marker is not counted)."""
    if scope not in ("lib", "cat"):
        raise ValueError("scope must be lib or cat")
    if lemma_of is None:
        lemma_of = await lemma_source(app)
    written = 0
    async with app.state.sessionmaker() as session:
        if not await _owner_is_ready(session, scope, owner_id):
            return 0
        await session.execute(delete(SegmentLemma).where(SegmentLemma.scope == scope,
                                                         SegmentLemma.owner_id == owner_id))
        source = await _copy_source(session, scope, owner_id)
        if source is not None:
            for row in (await session.scalars(select(SegmentLemma).where(
                    SegmentLemma.scope == "cat", SegmentLemma.owner_id == source))).all():
                if row.idx >= 0:
                    session.add(SegmentLemma(scope=scope, owner_id=owner_id, idx=row.idx, lemma=row.lemma))
                    written += 1
        else:
            seg_model, fk = (LibrarySegment, LibrarySegment.item_id) if scope == "lib" else (
                CatalogSegment, CatalogSegment.catalog_id)
            cursor = -1
            while True:
                chunk = (await session.execute(select(seg_model.idx, seg_model.text).where(
                    fk == owner_id, seg_model.idx > cursor).order_by(seg_model.idx).limit(CHUNK))).all()
                if not chunk:
                    break
                cursor = chunk[-1].idx
                pairs = await asyncio.to_thread(_sentence_lemmas, [(r.idx, r.text) for r in chunk], lemma_of)
                for idx, lemma in pairs:
                    session.add(SegmentLemma(scope=scope, owner_id=owner_id, idx=idx, lemma=lemma))
                written += len(pairs)
                if len(chunk) < CHUNK:
                    break
        session.add(SegmentLemma(scope=scope, owner_id=owner_id, idx=MARKER_IDX, lemma=MARKER))
        await session.commit()
    return written


class Indexer:
    """Process-local queue: at most MAX_PENDING builds waiting, one build running at a time."""

    def __init__(self, app) -> None:
        self.app = app
        self.pending: set[asyncio.Task] = set()
        self._lock = asyncio.Lock()

    def submit(self, scope: str, owner_id: str) -> bool:
        if len(self.pending) >= MAX_PENDING:
            self.app.state.learning_bus.count("activation.index", "overflow")
            return False
        task = asyncio.get_running_loop().create_task(self._run(scope, owner_id))
        self.pending.add(task)
        task.add_done_callback(self.pending.discard)
        return True

    async def _run(self, scope: str, owner_id: str) -> None:
        async with self._lock:
            try:
                written = await index_owner(self.app, scope, owner_id)
            except Exception as exc:  # noqa: BLE001 - a failed build is retried by the next ready event or backfill
                logger.warning("activation index failed scope=%s error=%s", scope, type(exc).__name__)
                return
            self.app.state.learning_bus.count("activation.index", "rows", written)


async def handle_ready(app, event: LibraryItemReady) -> None:
    indexer = app.state.activation_indexer
    if event.item_id:
        indexer.submit("lib", event.item_id)
    elif event.catalog_id:
        indexer.submit("cat", event.catalog_id)


def install(app, bus) -> None:
    bus.subscribe(LibraryItemReady, "activation.index", functools.partial(handle_ready, app), flag=FLAG)
