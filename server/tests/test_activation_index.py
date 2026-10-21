"""L4 Task 8: 句子倒排 segment_lemma 与 LibraryItemReady 处理器(plan R10、R11)。"""
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.learning_events import LibraryItemReady
from app.models import CatalogItem, CatalogSegment, LibraryItem, LibrarySegment, SegmentLemma, User
from tests.background import drain_background

AT = datetime(2026, 10, 21, 9, 0, tzinfo=timezone.utc)
UID = 44444444
ITEM = "11111111-2222-4333-8444-555555555555"
CAT = "66666666-7777-4888-8999-000000000000"
LEMMAS = {"talked": "talk", "walked": "walk"}
SENTENCES = [(0, "She walked home"), (1, "We talked a lot"), (2, "Plain words here")]


def lemma_of(form: str):
    return LEMMAS.get(form)


def enable(app, on: bool = True) -> None:
    app.state.settings = app.state.settings.model_copy(update={"activation_enabled": on})


async def seed_item(app, sentences=SENTENCES, catalog_id=None):
    async with app.state.sessionmaker() as s:
        if await s.get(User, UID) is None:
            s.add(User(id=UID, username="idx", password_hash="x"))
        s.add(LibraryItem(id=ITEM, user_id=UID, kind="video", source="upload", title="t", status="ready",
                          catalog_id=catalog_id, created_at=AT, updated_at=AT))
        for idx, text in sentences:
            s.add(LibrarySegment(item_id=ITEM, idx=idx, start_ms=idx * 1000, end_ms=idx * 1000 + 900, text=text))
        await s.commit()


async def seed_catalog(app, sentences=SENTENCES):
    async with app.state.sessionmaker() as s:
        s.add(CatalogItem(id=CAT, title="T", source="upload", status="ready", created_at=AT, updated_at=AT))
        for idx, text in sentences:
            s.add(CatalogSegment(catalog_id=CAT, idx=idx, start_ms=idx * 1000, end_ms=idx * 1000 + 900, text=text))
        await s.commit()


async def rows(app, scope: str, owner: str) -> set[tuple[int, str]]:
    async with app.state.sessionmaker() as s:
        found = (await s.scalars(select(SegmentLemma).where(
            SegmentLemma.scope == scope, SegmentLemma.owner_id == owner))).all()
        return {(r.idx, r.lemma) for r in found}


async def set_sentence(app, idx: int, text: str, item=ITEM) -> None:
    async with app.state.sessionmaker() as s:
        row = await s.get(LibrarySegment, (item, idx))
        row.text = text
        await s.commit()


EXPECTED = {(0, "walk"), (0, "home"), (1, "talk"), (1, "lot"), (2, "plain"), (2, "words"), (2, "here"), (-1, "#v1")}


async def test_index_owner_writes_the_lemmas_per_sentence_and_a_marker(app):
    from app.activation.indexer import index_owner

    await seed_item(app)
    written = await index_owner(app, "lib", ITEM, lemma_of=lemma_of)
    assert written == len(EXPECTED) - 1  # the marker is not a sentence row
    assert await rows(app, "lib", ITEM) == EXPECTED


async def test_rebuilding_is_idempotent_and_an_edited_sentence_drops_its_old_lemmas(app):
    from app.activation.indexer import index_owner

    await seed_item(app)
    await index_owner(app, "lib", ITEM, lemma_of=lemma_of)
    await index_owner(app, "lib", ITEM, lemma_of=lemma_of)
    assert await rows(app, "lib", ITEM) == EXPECTED
    await set_sentence(app, 1, "Nothing here")
    await index_owner(app, "lib", ITEM, lemma_of=lemma_of)
    got = await rows(app, "lib", ITEM)
    assert (1, "talk") not in got and (1, "nothing") in got and (1, "here") in got


async def test_a_catalog_copy_copies_the_catalog_index_without_tokenizing(app):
    from app.activation.indexer import index_owner

    await seed_catalog(app)
    await index_owner(app, "cat", CAT, lemma_of=lemma_of)
    await seed_item(app, catalog_id=CAT)
    calls: list[str] = []

    def counting(form: str):
        calls.append(form)
        return lemma_of(form)
    await index_owner(app, "lib", ITEM, lemma_of=counting)
    assert calls == []  # no tokenizing: the copy takes the catalog rows by idx
    assert await rows(app, "lib", ITEM) == await rows(app, "cat", CAT) == EXPECTED


async def test_a_copy_without_a_catalog_index_is_tokenized_itself(app):
    from app.activation.indexer import index_owner

    await seed_item(app, catalog_id=CAT)  # no 'cat' index exists yet
    calls: list[str] = []

    def counting(form: str):
        calls.append(form)
        return lemma_of(form)
    await index_owner(app, "lib", ITEM, lemma_of=counting)
    assert calls and await rows(app, "lib", ITEM) == EXPECTED


async def test_library_item_ready_builds_the_index_in_the_background(app):
    await seed_item(app)
    enable(app)
    assert app.state.learning_bus.publish(LibraryItemReady(user_id=UID, item_id=ITEM, at=AT)) is True
    await app.state.learning_bus.drain()
    await drain_background(app)
    assert (-1, "#v1") in await rows(app, "lib", ITEM)


async def test_catalog_ready_builds_the_catalog_index(app):
    await seed_catalog(app)
    enable(app)
    app.state.learning_bus.publish(LibraryItemReady(user_id=None, catalog_id=CAT, at=AT))
    await app.state.learning_bus.drain()
    await drain_background(app)
    assert (-1, "#v1") in await rows(app, "cat", CAT)


async def test_a_full_queue_drops_the_new_task_and_counts_it(app):
    await seed_item(app)
    enable(app)
    indexer = app.state.activation_indexer
    blockers = {asyncio.create_task(asyncio.sleep(3600)) for _ in range(200)}
    indexer.pending.update(blockers)
    try:
        assert app.state.learning_bus.publish(LibraryItemReady(user_id=UID, item_id=ITEM, at=AT)) is True
        await app.state.learning_bus.drain()  # must not raise
        assert app.state.learning_bus.stats()["activation.index"]["extra"]["overflow"] == 1
        assert await rows(app, "lib", ITEM) == set()
    finally:
        for task in blockers:
            task.cancel()
        await asyncio.gather(*blockers, return_exceptions=True)
        indexer.pending.difference_update(blockers)


async def test_switch_off_means_nothing_is_queued(app):
    await seed_item(app)
    enable(app, False)
    assert app.state.learning_bus.publish(LibraryItemReady(user_id=UID, item_id=ITEM, at=AT)) is False
    assert app.state.activation_indexer.pending == set()


async def test_the_index_never_logs_sentence_text(app, caplog):
    from app.activation.indexer import index_owner

    caplog.set_level(logging.DEBUG)
    await seed_item(app, sentences=[(0, "zygomorphic sentence here")])
    await index_owner(app, "lib", ITEM, lemma_of=lemma_of)
    # scoped to the app's own loggers, as the other privacy tests are (driver / SQL echo logs are not ours)
    assert all("zygomorphic" not in r.getMessage() for r in caplog.records if r.name.startswith("app"))
