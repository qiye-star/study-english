"""POST /api/library/items/{id}/reprocess(spec D7、裁定 R-R1…R-R6):状态机、额度、失败 / 取消回到原状。"""
import logging

import pytest
from sqlalchemy import select

from app.library import limits, paths
from app.models import DailyUsage, LibraryItem
from tests.library_helpers import SRT, FakeAsr, FakeTools, enable, fake_media, library_settings, process, upload, use_fakes
from tests.test_library_privacy import leaked

OLD = ["Old words are spoken here today.", "More old words follow after that."]
FIRST = " ".join(OLD)
NEW = ["New words are spoken here now.", "And more new words follow after that."]
FRESH = " ".join(NEW)


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_asr_enabled=True)


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


def data_dir(app):
    return app.state.library.deps.data_dir


async def asr_item(app, client, h, text: str = FIRST) -> str:
    use_fakes(app, FakeTools(), FakeAsr([text]))
    item_id = await upload(client, h, fake_media(6000, video=False), filename="Pod.m4a", title="Pod")
    await process(app)
    return item_id


async def detail(client, h, item_id) -> dict:
    return (await client.get(f"/api/library/items/{item_id}", headers=h)).json()


def reprocess(client, h, item_id):
    return client.post(f"/api/library/items/{item_id}/reprocess", headers=h)


async def row(app, item_id) -> LibraryItem:
    async with app.state.sessionmaker() as s:
        return await s.get(LibraryItem, item_id)


async def test_only_a_ready_automatically_recognized_item_can_be_reprocessed(app, client, auth_headers):
    h = auth_headers
    use_fakes(app)
    subs = await upload(client, h, fake_media(), subs=SRT)
    waiting = await upload(client, h, fake_media(), subs=SRT)  # queued: not processed yet
    uploading = await upload(client, h, fake_media(), complete=False)
    await process(app)  # one worker round (concurrency 1): `subs` becomes ready with uploaded subtitles, `waiting` may still be queued
    expected = (409, {"error": "Item cannot be reprocessed"})
    for item_id in (subs, waiting, uploading):
        r = await reprocess(client, h, item_id)
        assert (r.status_code, r.json()) == expected, item_id
    assert (await reprocess(client, h, "0f0e0d0c-0b0a-4908-8706-050403020100")).status_code == 404
    bob = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    other = {"Authorization": f"Bearer {bob.json()['access_token']}"}
    mine = await asr_item(app, client, h)
    assert (await reprocess(client, other, mine)).status_code == 404
    assert (await client.post(f"/api/library/items/{mine}/reprocess")).status_code == 401


async def test_reprocess_replaces_the_sentences_keeps_title_and_resume_and_spends_the_allowance_again(app, client, auth_headers):
    h = auth_headers
    item_id = await asr_item(app, client, h)
    await client.patch(f"/api/library/items/{item_id}", headers=h, json={"title": "My pod", "resume_ms": 2000, "resume_idx": 1})
    assert [s["text"] for s in (await detail(client, h, item_id))["segments"]] == OLD
    r = await reprocess(client, h, item_id)
    assert r.status_code == 200
    item = r.json()["item"]
    assert (item["status"], item["progress"], item["error_kind"], item["title"], item["resume_idx"]) == ("queued", 0, None, "My pod", 1)
    assert (await detail(client, h, item_id))["segments"] == []  # not openable while it is re-recognized
    use_fakes(app, FakeTools(), FakeAsr([FRESH]))
    await process(app)
    after = await detail(client, h, item_id)
    assert (after["item"]["status"], after["item"]["sub_source"]) == ("ready", "asr")
    assert [s["text"] for s in after["segments"]] == NEW
    assert (after["item"]["title"], after["item"]["resume_ms"], after["item"]["resume_idx"]) == ("My pod", 2000, 1)
    async with app.state.sessionmaker() as s:
        assert (await s.get(LibraryItem, item_id)).asr_seconds == 12
        counts = {r.subject: r.count for r in (await s.scalars(select(DailyUsage).where(DailyUsage.scope == "library_asr"))).all()}
    assert set(counts.values()) == {12}


async def test_reprocess_clears_a_stale_checkpoint(app, client, auth_headers):
    item_id = await asr_item(app, client, auth_headers)
    tmp = paths.tmp_dir(data_dir(app), item_id)
    tmp.mkdir(parents=True, exist_ok=True)
    (tmp / "chunks.json").write_text("STALE", encoding="utf-8")
    assert (await reprocess(client, auth_headers, item_id)).status_code == 200
    assert not tmp.exists()


async def test_a_second_request_while_it_runs_is_refused(app, client, auth_headers):
    item_id = await asr_item(app, client, auth_headers)
    assert (await reprocess(client, auth_headers, item_id)).status_code == 200
    r = await reprocess(client, auth_headers, item_id)
    assert (r.status_code, r.json()) == (409, {"error": "Item cannot be reprocessed"})


async def test_a_failed_reprocess_gives_the_item_back_as_it_was(app, client, auth_headers):
    h = auth_headers
    item_id = await asr_item(app, client, h)
    await reprocess(client, h, item_id)
    use_fakes(app, FakeTools(fail={"speech_wav": "corrupt"}), FakeAsr([]))
    await process(app)
    body = await detail(client, h, item_id)
    assert (body["item"]["status"], body["item"]["error_kind"], body["item"]["seg_count"], body["item"]["progress"]) == ("ready", "corrupt", 2, 100)
    assert [s["text"] for s in body["segments"]] == OLD
    stored = await row(app, item_id)
    assert (data_dir(app) / stored.media_path).is_file() and not paths.tmp_dir(data_dir(app), item_id).exists()
    r = await reprocess(client, h, item_id)  # the note goes away with the next attempt
    assert r.json()["item"]["error_kind"] is None


async def test_a_transient_failure_keeps_re_recognizing_and_retries(app, client, auth_headers, monkeypatch):
    monkeypatch.setattr(limits, "ASR_CONCURRENCY", 1)
    h = auth_headers
    item_id = await asr_item(app, client, h)
    await reprocess(client, h, item_id)
    use_fakes(app, FakeTools(), FakeAsr([RuntimeError("x")] * 3))
    await process(app)
    item = (await detail(client, h, item_id))["item"]
    assert (item["status"], item["error_kind"]) == ("queued", "upstream")  # retry with backoff, still re-recognizing
    async with app.state.sessionmaker() as s:
        stored = await s.get(LibraryItem, item_id)
        stored.next_run_at = None
        await s.commit()
    use_fakes(app, FakeTools(), FakeAsr([FRESH]))
    await process(app)
    after = await detail(client, h, item_id)
    assert after["item"]["status"] == "ready" and [s["text"] for s in after["segments"]] == NEW


async def test_reprocess_respects_the_daily_recognition_allowance_without_spending_it(app, client, auth_headers):
    h = auth_headers
    item_id = await asr_item(app, client, h)  # 6 s spent today
    app.state.settings = app.state.settings.model_copy(update={"library_asr_minutes_daily_per_user": 0})
    r = await reprocess(client, h, item_id)
    assert (r.status_code, r.json()) == (429, {"error": "Daily transcription limit reached"})
    assert (await detail(client, h, item_id))["item"]["status"] == "ready"
    app.state.settings = app.state.settings.model_copy(update={"library_asr_minutes_daily_per_user": 60,
                                                               "library_asr_minutes_global_daily": 0})
    assert (await reprocess(client, h, item_id)).status_code == 429
    app.state.settings = app.state.settings.model_copy(update={"library_asr_minutes_global_daily": 600})
    assert (await reprocess(client, h, item_id)).status_code == 200
    async with app.state.sessionmaker() as s:
        counts = {r.subject: r.count for r in (await s.scalars(select(DailyUsage).where(DailyUsage.scope == "library_asr"))).all()}
    assert set(counts.values()) == {6}  # the pre-check spends nothing; the pipeline reserves when it runs


async def test_reprocess_needs_transcription_and_the_media_file(app, client, auth_headers):
    h = auth_headers
    item_id = await asr_item(app, client, h)
    app.state.settings = app.state.settings.model_copy(update={"library_asr_enabled": False})
    r = await reprocess(client, h, item_id)
    assert (r.status_code, r.json()) == (503, {"error": "Transcription is not available"})
    app.state.settings = app.state.settings.model_copy(update={"library_asr_enabled": True})
    (data_dir(app) / (await row(app, item_id)).media_path).unlink()
    r = await reprocess(client, h, item_id)
    assert (r.status_code, r.json()) == (409, {"error": "Nothing left to retry"})


async def test_canceling_a_reprocess_gives_the_item_back_with_its_media(app, client, auth_headers):
    h = auth_headers
    item_id = await asr_item(app, client, h)
    await reprocess(client, h, item_id)
    r = await client.post(f"/api/library/items/{item_id}/cancel", headers=h)
    assert r.status_code == 200 and r.json()["item"]["status"] == "ready"
    body = await detail(client, h, item_id)
    assert [s["text"] for s in body["segments"]] == OLD
    assert (data_dir(app) / (await row(app, item_id)).media_path).is_file()
    assert await app.state.library.run_once() == 0  # nothing is left in the queue


async def test_deleting_an_item_that_is_being_reprocessed_removes_everything(app, client, auth_headers):
    h = auth_headers
    item_id = await asr_item(app, client, h)
    uid = int((await client.get("/api/me", headers=h)).json()["id"])
    await reprocess(client, h, item_id)
    assert (await client.delete(f"/api/library/items/{item_id}", headers=h)).json() == {"deleted": True}
    assert not paths.item_dir(data_dir(app), uid, item_id).exists() and await row(app, item_id) is None


async def test_replacing_the_subtitles_of_a_ready_item_clears_the_failure_note_and_the_flag(app, client, auth_headers):
    h = auth_headers
    item_id = await asr_item(app, client, h)
    async with app.state.sessionmaker() as s:
        stored = await s.get(LibraryItem, item_id)
        stored.error_kind, stored.low_confidence = "corrupt", True
        await s.commit()
    r = await client.put(f"/api/library/items/{item_id}/subtitles", headers=h,
                         files={"file": ("t.srt", SRT, "application/x-subrip")})
    item = r.json()["item"]
    assert (item["sub_source"], item["error_kind"], item["low_confidence"]) == ("uploaded", None, False)


async def test_reprocess_never_logs_text(app, client, auth_headers, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    h = auth_headers
    item_id = await asr_item(app, client, h, "SECRET-TRANSCRIPT is spoken here today. And more words follow after that.")
    await reprocess(client, h, item_id)
    use_fakes(app, FakeTools(), FakeAsr([RuntimeError("SECRET-UPSTREAM")] * 3))
    await process(app)
    async with app.state.sessionmaker() as s:
        stored = await s.get(LibraryItem, item_id)
        stored.next_run_at = None
        await s.commit()
    use_fakes(app, FakeTools(fail={"speech_wav": "corrupt"}))
    await process(app)
    await reprocess(client, h, item_id)
    await client.post(f"/api/library/items/{item_id}/cancel", headers=h)
    assert any("library" in r.name for r in caplog.records)
    assert leaked(caplog) == []
