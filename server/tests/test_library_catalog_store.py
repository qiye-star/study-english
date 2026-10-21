"""catalog_store(plan 2026-10-14-curated-library-server-core Task 3–4)。"""
import pytest
from sqlalchemy import func, select

from app.library import catalog_store, store
from app.library.segment import Sentence
from app.models import CatalogSegment, LibraryItem, utcnow
from tests.catalog_helpers import SEGMENTS, data_dir_of, make_catalog, media_file
from tests.library_helpers import library_settings


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_catalog_enabled=True)


def test_clean_level_and_tags():
    assert catalog_store.clean_level(" b1 ") == "B1" and catalog_store.clean_level("") is None
    assert catalog_store.clean_level(None) is None
    with pytest.raises(ValueError):
        catalog_store.clean_level("D1")
    assert catalog_store.clean_tags([" News ", "news", "科技", "  "]) == ["News", "科技"]
    for bad in (["a,b"], ["x" * 17], ["1", "2", "3", "4", "5", "6"], [3]):
        with pytest.raises(ValueError):
            catalog_store.clean_tags(bad)
    assert catalog_store.clean_license("  VOA   Learning ") == "VOA Learning"
    assert catalog_store.clean_license("   ") is None
    with pytest.raises(ValueError):
        catalog_store.clean_license("x" * 301)


async def test_create_get_and_outputs(app):
    async with app.state.sessionmaker() as s:
        row = await catalog_store.create(s, source="link", status="queued", title="A talk", level="A2",
                                         tags=["news", "health"], license_note="TED · CC BY-NC-ND 4.0",
                                         ai_lang="zh-CN", source_url="https://example.invalid/x",
                                         source_host="example.invalid")
        assert (await catalog_store.get(s, row.id)).title == "A talk"
        assert await catalog_store.get(s, "../etc") is None
        assert catalog_store.tags_of(row) == ["news", "health"]
        out = catalog_store.admin_out(row, refs=2, translated=0, media_missing=False)
        assert set(out) == {"id", "title", "level", "tags", "license_note", "source", "source_host", "status", "stage",
                            "progress", "error_kind", "duration_ms", "seg_count", "translated", "sub_source",
                            "low_confidence", "kind", "media_bytes", "has_poster", "media_missing", "ai_lang",
                            "published",
                            "published_at", "retired", "refs", "upload_received", "upload_total", "created_at",
                            "updated_at"}
        assert "source_url" not in out and out["refs"] == 2 and out["retired"] is False
        card = catalog_store.public_out(row, None)
        assert set(card) == {"id", "title", "level", "tags", "license_note", "duration_ms", "seg_count", "has_poster",
                             "published_at", "added_item_id"}


async def test_list_published_hides_drafts_retired_and_unready(app):
    shown = await make_catalog(app, title="shown")
    await make_catalog(app, title="draft", published=False)
    await make_catalog(app, title="retired", retired=True)
    await make_catalog(app, title="busy", status="processing")
    async with app.state.sessionmaker() as s:
        rows = await catalog_store.list_published(s, user_id=1)
        assert [(r.id, added) for r, added in rows] == [(shown, None)]
        assert await catalog_store.get_published(s, shown) is not None
        assert len(await catalog_store.list_all(s)) == 4


async def test_write_segments_and_guarded_ai_writes(app):
    cid = await make_catalog(app, segments=[])
    async with app.state.sessionmaker() as s:
        row = await catalog_store.get(s, cid)
        await catalog_store.write_segments(s, row, [Sentence(0, 1000, "One."), Sentence(1000, 2000, "Two.")],
                                           flags=[("rate",), ()])
        await s.commit()
        segs = await catalog_store.segments_of(s, cid)
        assert [(x.idx, x.text, x.flags) for x in segs] == [(0, "One.", "rate"), (1, "Two.", None)]
        assert row.seg_count == 2
        stored = await catalog_store.set_translations(s, cid, [(0, "One.", "一。"), (1, "stale text", "二。")], "zh-CN")
        assert stored == {0}
        assert await catalog_store.set_analysis(s, cid, 1, "Two.", "### 分析", "zh-CN") is True
        assert await catalog_store.set_analysis(s, cid, 1, "changed", "### x", "zh-CN") is False
        counts = await catalog_store.translated_counts(s, [row])
        assert counts == {cid: 1}
        assert catalog_store.segment_admin_out((await catalog_store.segments_of(s, cid))[1])["has_analysis"] is True


async def test_queue_claim_recover_and_fail(app):
    now = utcnow()
    async with app.state.sessionmaker() as s:
        a = await catalog_store.create(s, source="upload", status="queued", title="a", level=None, tags=[],
                                       license_note=None, ai_lang="zh-CN")
        b = await catalog_store.create(s, source="upload", status="queued", title="b", level=None, tags=[],
                                       license_note=None, ai_lang="zh-CN")
        first = await catalog_store.claim_next(s, now)
        assert first.id == a.id and first.status == "processing"
        assert (await catalog_store.claim_next(s, now)).id == b.id
        assert await catalog_store.claim_next(s, now) is None
        assert await catalog_store.set_progress(s, a.id, "probe", 10, now) is True
        assert await catalog_store.recover(s, now) == 2
        assert (await catalog_store.claim_next(s, now)).id == a.id
        assert await catalog_store.fail(s, a.id, "no_audio", now) is True
        await s.refresh(a)
        assert (a.status, a.error_kind) == ("failed", "no_audio")
        assert await catalog_store.set_progress(s, a.id, "probe", 20, now) is False  # not processing any more


async def test_fail_of_a_translate_only_rerun_gives_the_item_back_ready(app):
    cid = await make_catalog(app, status="processing", published=False)
    async with app.state.sessionmaker() as s:
        assert await catalog_store.fail(s, cid, "upstream", utcnow()) is True
        row = await catalog_store.get(s, cid)
        await s.refresh(row)
        assert (row.status, row.error_kind, row.progress) == ("ready", "upstream", 100)


async def test_media_missing(app):
    cid = await make_catalog(app)
    async with app.state.sessionmaker() as s:
        row = await catalog_store.get(s, cid)
        assert catalog_store.media_missing(data_dir_of(app), row) is False
        media_file(app, cid).unlink()
        assert catalog_store.media_missing(data_dir_of(app), row) is True


async def _uid(app, name="alice") -> int:
    """users.id is an application-generated 8-digit number (no autoincrement)."""
    from app.models import User
    uid = 20000000 + sum(name.encode()) + 1000 * len(name)
    async with app.state.sessionmaker() as s:
        s.add(User(id=uid, username=name, password_hash="x"))
        await s.commit()
    return uid


async def test_add_copies_the_item_and_sentences_pointing_at_the_shared_file(app):
    cid = await make_catalog(app)
    uid = await _uid(app)
    async with app.state.sessionmaker() as s:
        item, created = await catalog_store.add_to_library(s, app.state.storage, user_id=uid, catalog_id=cid,
                                                           now=utcnow())
        assert created is True
        assert (item.source, item.kind, item.status, item.library_bytes, item.catalog_id) == (
            "catalog", "audio", "ready", 0, cid)
        cat = await catalog_store.get(s, cid)
        assert item.media_path == cat.media_path and item.poster_path == cat.poster_path
        assert item.rebuildable is False and item.seg_count == len(SEGMENTS)
        segs = await store.segments_of(s, item.id)
        assert [(x.text, x.zh, x.zh_lang) for x in segs] == [(t, zh, "zh-CN") for _a, _b, t, zh in SEGMENTS]
        again, created = await catalog_store.add_to_library(s, app.state.storage, user_id=uid, catalog_id=cid,
                                                            now=utcnow())
        assert (again.id, created) == (item.id, False)
        assert await catalog_store.refs(s, cid) == 1
        assert await s.scalar(select(func.count()).select_from(LibraryItem)) == 1


async def test_add_refuses_unpublished_retired_and_missing_media(app):
    uid = await _uid(app)
    draft = await make_catalog(app, published=False)
    retired = await make_catalog(app, retired=True)
    gone = await make_catalog(app, with_files=False)
    async with app.state.sessionmaker() as s:
        for cid in (draft, retired, gone, "not-a-uuid"):
            with pytest.raises(LookupError):
                await catalog_store.add_to_library(s, app.state.storage, user_id=uid, catalog_id=cid, now=utcnow())


async def test_a_second_add_racing_the_first_returns_the_existing_copy(app):
    """The unique index (user_id, catalog_id) decides; the loser reads the winner's row back."""
    cid = await make_catalog(app)
    uid = await _uid(app)
    async with app.state.sessionmaker() as s1, app.state.sessionmaker() as s2:
        first, _ = await catalog_store.add_to_library(s1, app.state.storage, user_id=uid, catalog_id=cid, now=utcnow())
        original = catalog_store._copy_of

        async def blind(session, user_id, catalog_id):  # s2 does not see s1's row on its first look
            blind.calls += 1
            return None if blind.calls == 1 else await original(session, user_id, catalog_id)
        blind.calls = 0
        catalog_store._copy_of = blind
        try:
            second, created = await catalog_store.add_to_library(s2, app.state.storage, user_id=uid, catalog_id=cid,
                                                                 now=utcnow())
        finally:
            catalog_store._copy_of = original
        assert (second.id, created) == (first.id, False)


async def test_fill_translations_copies_only_same_language_and_same_text(app):
    cid = await make_catalog(app, segments=[(0, 1000, "One.", None), (1000, 2000, "Two.", None)])
    uid = await _uid(app)
    async with app.state.sessionmaker() as s:
        item, _ = await catalog_store.add_to_library(s, app.state.storage, user_id=uid, catalog_id=cid, now=utcnow())
        await catalog_store.set_translations(s, cid, [(0, "One.", "一。"), (1, "Two.", "二。")], "zh-CN")
        segs = await store.segments_of(s, item.id)
        segs[1].text = "Two, edited."
        await s.commit()
        assert await catalog_store.fill_translations(s, item, segs, "ja-JP") == 0  # not the catalog's language
        assert await catalog_store.fill_translations(s, item, segs, "zh-CN") == 1  # sentence 1 was edited
        for seg in segs:
            await s.refresh(seg)
        assert [x.zh for x in segs] == ["一。", None]


async def test_retired_items_are_collected_only_without_copies(app):
    cid = await make_catalog(app)
    uid = await _uid(app)
    async with app.state.sessionmaker() as s:
        item, _ = await catalog_store.add_to_library(s, app.state.storage, user_id=uid, catalog_id=cid, now=utcnow())
        row = await catalog_store.get(s, cid)
        row.published, row.retired_at = False, utcnow()
        await s.commit()
        assert await catalog_store.collect_if_orphan(s, app.state.storage, data_dir_of(app), cid) is False
        assert media_file(app, cid).is_file()
        await store.delete_item_rows(s, item.id)
        await s.commit()
        assert await catalog_store.collect_retired(s, app.state.storage, data_dir_of(app)) == 1
        assert await catalog_store.get(s, cid) is None
        assert await s.scalar(select(func.count()).select_from(CatalogSegment)) == 0
    assert not media_file(app, cid).exists()


async def test_collect_never_touches_live_items(app):
    cid = await make_catalog(app)
    async with app.state.sessionmaker() as s:
        assert await catalog_store.collect_if_orphan(s, app.state.storage, data_dir_of(app), cid) is False
    assert media_file(app, cid).is_file()


async def test_purge_deletes_every_copy_then_the_catalog_item(app):
    cid = await make_catalog(app)
    other = await make_catalog(app, title="other")
    a, b = await _uid(app, "a"), await _uid(app, "b")
    async with app.state.sessionmaker() as s:
        ia, _ = await catalog_store.add_to_library(s, app.state.storage, user_id=a, catalog_id=cid, now=utcnow())
        await catalog_store.add_to_library(s, app.state.storage, user_id=b, catalog_id=cid, now=utcnow())
        keep, _ = await catalog_store.add_to_library(s, app.state.storage, user_id=a, catalog_id=other, now=utcnow())
        token = app.state.library.tickets.issue(a, ia.id)
        assert await catalog_store.purge(s, app, cid) == (2, 2)
        assert await s.scalar(select(func.count()).select_from(LibraryItem)) == 1
        assert await s.get(LibraryItem, keep.id) is not None
        assert await catalog_store.get(s, cid) is None
    assert app.state.library.tickets.resolve(token, ia.id) is None
    assert not media_file(app, cid).exists() and media_file(app, other).is_file()


def test_kind_of_follows_the_media_mime():
    from app.models import CatalogItem
    assert catalog_store.kind_of(CatalogItem(media_mime=None)) == "audio"
    assert catalog_store.kind_of(CatalogItem(media_mime="audio/mpeg")) == "audio"
    assert catalog_store.kind_of(CatalogItem(media_mime="video/mp4")) == "video"


async def test_a_video_catalog_item_is_copied_as_video(app):
    cid = await make_catalog(app, kind="video")
    uid = await _uid(app)
    async with app.state.sessionmaker() as s:
        row = await catalog_store.get(s, cid)
        assert row.media_path.endswith("/media.mp4")
        assert catalog_store.admin_out(row, refs=0, translated=0, media_missing=False)["kind"] == "video"
        item, created = await catalog_store.add_to_library(s, app.state.storage, user_id=uid, catalog_id=cid,
                                                           now=utcnow())
        assert created and (item.kind, item.media_mime, item.media_path, item.library_bytes) == (
            "video", "video/mp4", row.media_path, 0)


async def test_sync_copies_moves_every_copy_to_the_catalog_media(app):
    cid = await make_catalog(app)
    a, b = await _uid(app, "alice"), await _uid(app, "bob")
    async with app.state.sessionmaker() as s:
        for uid in (a, b):
            await catalog_store.add_to_library(s, app.state.storage, user_id=uid, catalog_id=cid, now=utcnow())
        row = await catalog_store.get(s, cid)
        row.media_path = row.media_path.replace("media.m4a", "media.mp4")
        row.media_mime, row.duration_ms = "video/mp4", 6100
        assert await catalog_store.sync_copies(s, row, utcnow()) == 2
        await s.commit()
        copies = (await s.scalars(select(LibraryItem).where(LibraryItem.catalog_id == cid)
                                  .execution_options(populate_existing=True))).all()
        assert {(c.kind, c.media_path, c.media_mime, c.poster_path, c.duration_ms, c.library_bytes) for c in copies} == {
            ("video", row.media_path, "video/mp4", row.poster_path, 6100, 0)}
