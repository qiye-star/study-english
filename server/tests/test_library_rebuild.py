"""「重新分句」(plan 2026-10-14-library-alignment-v2 R-V8、R-V14、R-V16):用保留的识别结果按当前算法重建句子,不花识别额度;
没有识别结果就拒绝;换字幕删掉识别结果;手动改时间清掉这句的标记。"""
import logging

from sqlalchemy import select

from app.library import wordseg
from app.models import DailyUsage, LibrarySegment
from tests.library_helpers import SRT, FakeAsr, FakeTimedAsr, FakeTools, fake_media, process, upload, use_fakes
from tests.library_words import utt
from tests.test_library_privacy import leaked
from tests.test_library_words_pipeline import (  # noqa: F401  (`settings_overrides` and `_tools` are fixtures)
    A, B, _tools, detail, mismatched, settings_overrides, timed, transcript_path, uid_of, word_item,
)


async def test_rebuild_uses_the_current_algorithm_without_paying_again(app, client, auth_headers, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    fake = FakeTimedAsr([timed(utt(A, 27_360), utt(B, 31_000))])
    use_fakes(app, FakeTools(silences=[]), timed_asr=fake)
    item_id = await upload(client, auth_headers, fake_media(40_000, video=False), filename="Pod.m4a")
    await process(app)
    async with app.state.sessionmaker() as s:
        spent = (await s.scalars(select(DailyUsage.count).where(DailyUsage.scope == "library_asr"))).all()
    before = (await detail(client, auth_headers, item_id))["segments"]
    monkeypatch.setattr(wordseg, "TAIL_PAD_MS", 0)  # stands for "the algorithm improved after recognition"
    r = await client.post(f"/api/library/items/{item_id}/rebuild", headers=auth_headers)
    assert r.status_code == 200, r.text
    after = r.json()["segments"]
    assert [s["text"] for s in after] == [s["text"] for s in before]
    assert after[0]["end_ms"] == before[0]["end_ms"] - 80  # the new rule, applied to the kept words
    assert len(fake.calls) == 1  # no new recognition
    async with app.state.sessionmaker() as s:
        assert (await s.scalars(select(DailyUsage.count).where(DailyUsage.scope == "library_asr"))).all() == spent
    assert leaked(caplog) == []


async def test_rebuild_replaces_edits_but_keeps_translations_of_unchanged_sentences(app, client, auth_headers):
    item_id = await word_item(app, client, auth_headers, timed(utt(A, 27_360), utt(B, 31_000)))
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(LibrarySegment).where(LibrarySegment.item_id == item_id)
                                .order_by(LibrarySegment.idx))).all()
        rows[0].zh, rows[0].zh_lang = "欢迎回来。", "zh-CN"
        rows[1].zh, rows[1].zh_lang = "今天聊城市。", "zh-CN"
        await s.commit()
    await client.patch(f"/api/library/items/{item_id}/segments/1", headers=auth_headers, json={"text": "Edited words here."})
    after = (await client.post(f"/api/library/items/{item_id}/rebuild", headers=auth_headers)).json()["segments"]
    assert [(s["text"], s["zh"]) for s in after] == [(A, "欢迎回来。"), (B, None)]


async def test_rebuild_is_refused_without_a_kept_transcript(app, client, auth_headers):
    h = auth_headers
    use_fakes(app)
    subs = await upload(client, h, fake_media(), subs=SRT)
    await process(app)
    r = await client.post(f"/api/library/items/{subs}/rebuild", headers=h)
    assert (r.status_code, r.json()) == (409, {"error": "Item cannot be rebuilt"})
    item_id = await word_item(app, client, h, timed(utt(A, 27_360)))
    transcript_path(app, await uid_of(client, h), item_id).unlink()
    r = await client.post(f"/api/library/items/{item_id}/rebuild", headers=h)
    assert (r.status_code, r.json()) == (409, {"error": "Item cannot be rebuilt"})
    other = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    bob = {"Authorization": f"Bearer {other.json()['access_token']}"}
    assert (await client.post(f"/api/library/items/{item_id}/rebuild", headers=bob)).status_code == 404


async def test_text_only_items_keep_their_transcript_too(app, client, auth_headers):
    use_fakes(app, FakeTools(silences=[]), asr=FakeAsr([f"{A} {B}"]))
    item_id = await upload(client, auth_headers, fake_media(40_000, video=False), filename="Pod.m4a")
    await process(app)
    before = (await detail(client, auth_headers, item_id))["segments"]
    r = await client.post(f"/api/library/items/{item_id}/rebuild", headers=auth_headers)
    assert r.status_code == 200 and r.json()["segments"] == before  # v1 again: the same sentences


async def test_new_subtitles_drop_the_transcript(app, client, auth_headers):
    item_id = await word_item(app, client, auth_headers, timed(utt(A, 27_360)))
    path = transcript_path(app, await uid_of(client, auth_headers), item_id)
    assert path.is_file()
    r = await client.put(f"/api/library/items/{item_id}/subtitles", headers=auth_headers,
                         files={"file": ("t.srt", SRT, "application/x-subrip")})
    assert r.status_code == 200 and r.json()["item"]["rebuildable"] is False and not path.exists()


async def test_moving_a_sentence_by_hand_clears_its_flags_but_editing_text_does_not(app, client, auth_headers):
    item_id = await word_item(app, client, auth_headers, timed(utt(A, 27_360), mismatched()))
    url = f"/api/library/items/{item_id}/segments/1"
    seg = (await client.patch(url, headers=auth_headers, json={"text": "It costs 25 dollars, honestly."})).json()["segment"]
    assert "timing" in seg["flags"]
    seg = (await client.patch(url, headers=auth_headers, json={"start_ms": seg["start_ms"] + 100})).json()["segment"]
    assert seg["flags"] == []
