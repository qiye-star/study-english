"""跟读库的数据库读写(spec §4、§6.1、§6.5)。"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.library import store
from app.library.segment import Sentence
from app.models import LibraryAttempt, LibraryItem, LibrarySegment, User

NOW = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)


async def _users(app, *ids):
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=i, username=f"u{i}", password_hash="x") for i in ids])
        await s.commit()


async def _item(app, uid=11111111, **kw) -> str:
    values = dict(user_id=uid, kind="video", source="upload", title="t", status="queued", created_at=NOW,
                  updated_at=NOW)
    values.update(kw)
    async with app.state.sessionmaker() as s:
        row = LibraryItem(**values)
        s.add(row)
        await s.commit()
        return row.id


def test_titles_extensions_and_hashes():
    assert store.clean_title("  My \n  clip  ") == "My clip" and store.clean_title("   ") == "Untitled"
    assert store.clean_title("x" * 300) == "x" * 200
    assert store.title_from_filename("C:\\clips\\my_first_clip.MP4") == "my first clip"
    assert store.extension_of("a.b.MKV") == "mkv" and store.extension_of("noext") == ""
    assert store.text_hash("Hello  world") == store.text_hash(" Hello world ") != store.text_hash("Hello world.")
    assert len(store.text_hash("x")) == 16 and store.same_text("a  b", "a b")
    assert store.is_item_id("0f0e0d0c-0b0a-4908-8706-050403020100") and not store.is_item_id("../x")


async def test_owner_scoping_and_paging(app):
    await _users(app, 11111111, 22222222)
    ids = [await _item(app, created_at=NOW + timedelta(seconds=i)) for i in range(5)]
    theirs = await _item(app, uid=22222222)
    async with app.state.sessionmaker() as s:
        assert await store.get_owned(s, 11111111, theirs) is None
        assert await store.get_owned(s, 11111111, "not-a-uuid") is None
        page, cursor = await store.list_page(s, 11111111, None, limit=2)
        assert [r.id for r in page] == [ids[4], ids[3]] and cursor == ids[3]
        page, cursor = await store.list_page(s, 11111111, cursor, limit=2)
        assert [r.id for r in page] == [ids[2], ids[1]]
        page, cursor = await store.list_page(s, 11111111, cursor, limit=2)
        assert [r.id for r in page] == [ids[0]] and cursor is None
        page, _ = await store.list_page(s, 11111111, theirs, limit=10)
        assert len(page) == 5  # someone else's cursor is ignored


async def test_claim_is_atomic_and_respects_next_run_at(app):
    await _users(app, 11111111)
    due = await _item(app)
    later = await _item(app, next_run_at=NOW + timedelta(minutes=5), created_at=NOW - timedelta(seconds=1))
    await _item(app, status="uploading")
    async with app.state.sessionmaker() as a, app.state.sessionmaker() as b:
        first = await store.claim(a, NOW, 5)
        second = await store.claim(b, NOW, 5)
    assert [r.id for r in first] == [due] and second == []
    async with app.state.sessionmaker() as s:
        assert [r.id for r in await store.claim(s, NOW + timedelta(minutes=6), 5)] == [later]
        assert await store.claim(s, NOW, 0) == []


async def test_recover_progress_and_fail(app):
    await _users(app, 11111111)
    item = await _item(app, status="processing")
    async with app.state.sessionmaker() as s:
        assert await store.set_progress(s, item, "transcode", 140, NOW)
        row = await s.get(LibraryItem, item)
        assert (row.stage, row.progress) == ("transcode", 100)
        assert await store.fail(s, item, "network", retry_at=NOW + timedelta(seconds=30), now=NOW)
        await s.refresh(row)
        assert (row.status, row.attempts, row.error_kind, row.next_run_at is not None) == ("queued", 1, "network", True)
        assert not await store.set_progress(s, item, "probe", 1, NOW)  # not processing any more
        row.status = "processing"
        await s.commit()
        assert await store.recover(s, NOW) == 1
        await s.refresh(row)
        assert row.status == "queued" and row.attempts == 1
        row.status = "processing"
        await s.commit()
        assert await store.fail(s, item, "corrupt", retry_at=None, now=NOW)
        await s.refresh(row)
        assert (row.status, row.error_kind, row.next_run_at) == ("failed", "corrupt", None)


async def test_segments_attempts_and_explicit_delete(app):
    await _users(app, 11111111)
    item_id = await _item(app, status="ready")
    async with app.state.sessionmaker() as s:
        item = await s.get(LibraryItem, item_id)
        item.resume_idx = 9
        await store.write_segments(s, item, [Sentence(0, 900, "Hello there."), Sentence(900, 2000, "Bye now.")])
        await s.commit()
        segs = await store.segments_of(s, item_id)
        assert [store.segment_out(x) for x in segs] == [
            {"idx": 0, "start_ms": 0, "end_ms": 900, "text": "Hello there.", "zh": None, "zh_lang": None,
             "has_analysis": False, "analysis_lang": None},
            {"idx": 1, "start_ms": 900, "end_ms": 2000, "text": "Bye now.", "zh": None, "zh_lang": None,
             "has_analysis": False, "analysis_lang": None}]
        segs[0].zh, segs[0].zh_lang, segs[0].analysis, segs[0].analysis_lang = "你好。", "zh-CN", "### Grammar", "zh-CN"
        assert store.segment_out(segs[0]) == {"idx": 0, "start_ms": 0, "end_ms": 900, "text": "Hello there.",
                                              "zh": "你好。", "zh_lang": "zh-CN", "has_analysis": True,
                                              "analysis_lang": "zh-CN"}  # the analysis text itself is not listed
        assert (item.seg_count, item.resume_idx) == (2, 1)
        for aid, score, text in (("a1", 70, "Hello there."), ("a2", 90, "Hello  there."), ("a3", 99, "Old text."),
                                 ("a1", 10, "Hello there.")):
            await store.add_attempt(s, user_id=11111111, item_id=item_id, seg_idx=0, assessment_id=aid, text=text,
                                    score=score, now=NOW)
        best = await store.best_attempts(s, item_id, segs)
        assert best == [{"seg_idx": 0, "best_score": 90, "count": 2, "last_at": best[0]["last_at"]}]
        await store.delete_item_rows(s, item_id)
        await s.commit()
        for model in (LibraryItem, LibrarySegment, LibraryAttempt):
            assert await s.scalar(select(func.count()).select_from(model)) == 0


async def test_item_out_shape_and_upload_progress(app):
    await _users(app, 11111111)
    item_id = await _item(app, status="uploading", upload_total=400, upload_received=100)
    async with app.state.sessionmaker() as s:
        out = store.item_out(await s.get(LibraryItem, item_id))
    assert out["progress"] == 25 and out["has_poster"] is False and out["last_opened_at"] is None
    assert set(out) == {"id", "kind", "source", "title", "status", "stage", "progress", "error_kind", "duration_ms",
                        "seg_count", "library_bytes", "sub_source", "resume_ms", "resume_idx", "rate_pct", "has_poster",
                        "created_at", "last_opened_at"}


async def test_sweeps(app):
    await _users(app, 11111111)
    old = NOW - timedelta(days=8)
    expired = await _item(app, status="uploading", updated_at=NOW - timedelta(hours=25))
    fresh = await _item(app, status="uploading")
    stale = await _item(app, status="failed", updated_at=old)
    gone = await _item(app, status="canceled", updated_at=old)
    await _item(app, status="ready", updated_at=old)
    async with app.state.sessionmaker() as s:
        assert await store.expire_uploads(s, NOW) == [expired]
        assert sorted(i for _, i in await store.stale_items(s, NOW)) == sorted([stale, gone])
        assert (await store.statuses(s, [expired, fresh])) == {expired: "failed", fresh: "uploading"}
        assert (await s.get(LibraryItem, expired)).error_kind == "upload_expired"
        assert await store.active_count(s) == 1


async def test_create_item_for_plan_s2_and_upload_kinds(app):
    await _users(app, 11111111)
    async with app.state.sessionmaker() as s:
        row = await store.create_item(s, user_id=11111111, kind="video", source="link", status="queued", title="",
                                      source_url="https://www.youtube.com/watch?v=x", source_host="www.youtube.com")
        assert (row.status, row.source, row.title, row.source_host) == ("queued", "link", "", "www.youtube.com")
        audio = await store.create_upload(s, 11111111, title="  a  b ", size=10, ext="mp3")
        video = await store.create_upload(s, 11111111, title="", size=10, ext="mkv")
    assert (audio.kind, audio.title, audio.status, audio.upload_total) == ("audio", "a b", "uploading", 10)
    assert (video.kind, video.title) == ("video", "Untitled")
