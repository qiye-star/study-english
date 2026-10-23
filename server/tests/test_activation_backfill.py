"""L4 Task 10: 回填命令与孤儿清扫(plan R12、R10)。回填只在用户要求时运行;这里只用假数据。"""
import re
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.activation import backfill, purge
from app.activation.indexer import MARKER, MARKER_IDX, index_owner
from app.models import CatalogItem, CatalogSegment, LibraryItem, LibrarySegment, SegmentLemma, User

AT = datetime(2026, 10, 21, 9, 0, tzinfo=timezone.utc)
UID = 55555555
LEMMAS = {"talked": "talk", "walked": "walk"}


def lemma_of(form: str):
    return LEMMAS.get(form)


def enable(app, on: bool = True) -> None:
    app.state.settings = app.state.settings.model_copy(update={"activation_enabled": on})


def item(item_id: str, status: str = "ready") -> LibraryItem:
    return LibraryItem(id=item_id, user_id=UID, kind="video", source="upload", title="t", status=status,
                       created_at=AT, updated_at=AT)


async def seed(app):
    """Two ready user items, one still processing, one ready and already indexed; one ready catalog item and one
    already indexed. Expected to be processed by one backfill run: A, B and the catalog item A (3 items)."""
    async with app.state.sessionmaker() as s:
        if await s.get(User, UID) is None:
            s.add(User(id=UID, username="bf", password_hash="x"))
        for item_id, status, text in (("aaaaaaaa-0000-4000-8000-000000000001", "ready", "She walked home"),
                                      ("aaaaaaaa-0000-4000-8000-000000000002", "ready", "We talked a lot"),
                                      ("aaaaaaaa-0000-4000-8000-000000000003", "processing", "Not yet ready"),
                                      ("aaaaaaaa-0000-4000-8000-000000000004", "ready", "Already indexed here")):
            s.add(item(item_id, status))
            s.add(LibrarySegment(item_id=item_id, idx=0, start_ms=0, end_ms=900, text=text))
        for cat_id, status, text in (("cccccccc-0000-4000-8000-000000000001", "ready", "They talked"),
                                     ("cccccccc-0000-4000-8000-000000000002", "ready", "Already indexed too")):
            s.add(CatalogItem(id=cat_id, title="T", source="upload", status=status, created_at=AT, updated_at=AT))
            s.add(CatalogSegment(catalog_id=cat_id, idx=0, start_ms=0, end_ms=900, text=text))
        await s.commit()
    await index_owner_directly(app, "lib", "aaaaaaaa-0000-4000-8000-000000000004")
    await index_owner_directly(app, "cat", "cccccccc-0000-4000-8000-000000000002")


async def index_owner_directly(app, scope: str, owner: str) -> None:
    await index_owner(app, scope, owner, lemma_of=lemma_of)


async def markers(app) -> set[tuple[str, str]]:
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(SegmentLemma).where(
            SegmentLemma.idx == MARKER_IDX, SegmentLemma.lemma == MARKER))).all()
        return {(r.scope, r.owner_id) for r in rows}


async def row_count(app) -> int:
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(func.count()).select_from(SegmentLemma))


async def test_backfill_indexes_only_ready_items_that_have_no_marker(app):
    await seed(app)
    counts = await backfill.run(app.state.sessionmaker, lemma_of=lemma_of)
    assert counts["items"] == 3
    assert await markers(app) == {
        ("lib", "aaaaaaaa-0000-4000-8000-000000000001"), ("lib", "aaaaaaaa-0000-4000-8000-000000000002"),
        ("lib", "aaaaaaaa-0000-4000-8000-000000000004"), ("cat", "cccccccc-0000-4000-8000-000000000001"),
        ("cat", "cccccccc-0000-4000-8000-000000000002")}
    assert "aaaaaaaa-0000-4000-8000-000000000003" not in {owner for _, owner in await markers(app)}


async def test_dry_run_counts_and_writes_nothing(app):
    await seed(app)
    before = await row_count(app)
    counts = await backfill.run(app.state.sessionmaker, dry_run=True, lemma_of=lemma_of)
    assert counts["items"] == 3 and counts["rows"] == 0
    assert await row_count(app) == before


async def test_small_chunks_give_the_same_result(app):
    await seed(app)
    counts = await backfill.run(app.state.sessionmaker, chunk=1, lemma_of=lemma_of)
    assert counts["items"] == 3 and len(await markers(app)) == 5


async def test_an_interrupted_run_is_finished_by_the_next_one(app, monkeypatch):
    await seed(app)
    calls = {"n": 0}
    real = backfill.index_owner

    async def flaky(app_, scope, owner, **kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("boom")
        return await real(app_, scope, owner, **kwargs)
    monkeypatch.setattr(backfill, "index_owner", flaky)
    with pytest.raises(RuntimeError):
        await backfill.run(app.state.sessionmaker, lemma_of=lemma_of)
    assert len(await markers(app)) == 3  # the two already indexed + the first one the run finished
    monkeypatch.setattr(backfill, "index_owner", real)
    counts = await backfill.run(app.state.sessionmaker, lemma_of=lemma_of)
    assert counts["items"] == 2 and len(await markers(app)) == 5


async def test_the_command_prints_only_numbers(app):
    await seed(app)
    line = await backfill._main(["--dry-run"], sessionmaker=app.state.sessionmaker, lemma_of=lemma_of)
    assert re.fullmatch(r"items=\d+ rows=\d+ dry-run", line), line
    line = await backfill._main([], sessionmaker=app.state.sessionmaker, lemma_of=lemma_of)
    assert re.fullmatch(r"items=\d+ rows=\d+", line), line
    assert "bf" not in line and "aaaa" not in line and "cccc" not in line


async def test_the_sweep_removes_rows_of_deleted_owners_only(app):
    await seed(app)
    await backfill.run(app.state.sessionmaker, lemma_of=lemma_of)
    async with app.state.sessionmaker() as s:
        await s.execute(LibrarySegment.__table__.delete().where(LibrarySegment.item_id == "aaaaaaaa-0000-4000-8000-000000000002"))
        await s.execute(LibraryItem.__table__.delete().where(LibraryItem.id == "aaaaaaaa-0000-4000-8000-000000000002"))
        await s.commit()
    removed = await purge.purge_orphans(app.state.sessionmaker)
    assert removed > 0
    owners = {owner for _, owner in await _pairs(app)}
    assert "aaaaaaaa-0000-4000-8000-000000000002" not in owners
    assert "aaaaaaaa-0000-4000-8000-000000000001" in owners and "cccccccc-0000-4000-8000-000000000001" in owners


async def _pairs(app) -> list[tuple[str, str]]:
    async with app.state.sessionmaker() as s:
        return [(r.scope, r.owner_id) for r in (await s.scalars(select(SegmentLemma))).all()]


async def test_the_sweep_deletes_at_most_the_batch_size(app):
    async with app.state.sessionmaker() as s:
        for i in range(10):
            s.add(SegmentLemma(scope="lib", owner_id="gone-owner-id-0001", idx=i, lemma=f"lemma{i:03d}"))
        await s.commit()
    assert await purge.purge_orphans(app.state.sessionmaker, batch=3) == 3
    assert await row_count(app) == 7


async def test_the_daily_sweep_does_nothing_while_the_switch_is_off(app):
    async with app.state.sessionmaker() as s:
        s.add(SegmentLemma(scope="lib", owner_id="gone-owner-id-0002", idx=0, lemma="orphan"))
        await s.commit()
    enable(app, False)
    assert await purge.run_once(app) == 0
    assert await row_count(app) == 1
    enable(app, True)
    assert await purge.run_once(app) == 1
    assert await row_count(app) == 0
