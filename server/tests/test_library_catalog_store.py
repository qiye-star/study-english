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
                            "low_confidence", "media_bytes", "has_poster", "media_missing", "ai_lang", "published",
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
