"""替换媒体时同时换字幕(plan 2026-10-27-library-local-export-cloud-import R-S4)。假工具与假翻译,不联网。
副本的一切(句子、成绩、配音、续播、标题)在替换后逐项不变;只有目录的句子按新字幕重建。"""
import logging

import pytest
from sqlalchemy import select

from app.library import paths
from app.models import CatalogSegment, LibraryAttempt, LibraryDub, LibraryItem, LibrarySegment
from tests.admin_helpers import ADMIN_ENABLED
from tests.background import drain_background
from tests.library_helpers import fake_media, library_settings
from tests.test_admin_catalog_replace import BASE, _data_dir, _row, old_audio_item_with_a_copy

SUBS_NEW = (b"1\n00:00:00,400 --> 00:00:03,100\nHello there, my friend.\n\n"
            b"2\n00:00:03,200 --> 00:00:04,500\nA brand new second line.\n\n"
            b"3\n00:00:04,600 --> 00:00:06,000\nHow are you doing today?\n")
SUBS_BAD = b"this is not a subtitle file"


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, **library_settings(tmp_path, library_catalog_enabled=True, library_ai_enabled=True,
                                                upstream_llm_base_url="https://llm.test/v1")}


async def _start_with_subs(client, h, cid: str, data: bytes, subs: bytes):
    """Start a replacement, send the media chunks, then the subtitle file (the same endpoints as the plain one)."""
    r = await client.post(f"{BASE}/{cid}/replace-media", headers=h, json={"filename": "Talk.mp4", "size": len(data)})
    assert r.status_code == 200, r.text
    size = r.json()["chunk_bytes"]
    for n in range(max(1, (len(data) + size - 1) // size)):
        r = await client.put(f"{BASE}/uploads/{cid}/chunks/{n}", headers=h,
                             files={"chunk": ("blob", data[n * size:(n + 1) * size], "application/octet-stream")})
        assert r.status_code == 200, r.text
    return await client.put(f"{BASE}/uploads/{cid}/subtitles", headers=h,
                            files={"file": ("t.srt", subs, "application/x-subrip")})


async def _complete(client, h, cid: str) -> None:
    r = await client.post(f"{BASE}/uploads/{cid}/complete", headers=h)
    assert r.status_code == 200, r.text


async def _sentences(app, cid: str) -> list[tuple]:
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(CatalogSegment).where(CatalogSegment.catalog_id == cid)
                                .order_by(CatalogSegment.idx))).all()
        return [(r.idx, r.start_ms, r.end_ms, r.text, r.zh, r.zh_lang, r.analysis, r.speaker, r.flags) for r in rows]


async def _give_first_sentence_extras(app, cid: str) -> None:
    async with app.state.sessionmaker() as s:
        seg = await s.get(CatalogSegment, (cid, 0))
        seg.zh, seg.zh_lang, seg.analysis, seg.analysis_lang, seg.speaker = "旧译文", "zh-CN", "旧分析", "zh-CN", "A"
        await s.commit()


async def test_subtitles_are_accepted_during_a_replace_and_bad_ones_are_refused(app, client, monkeypatch):
    _tools, h, _uh, cid, _item = await old_audio_item_with_a_copy(app, client, monkeypatch)
    r = await _start_with_subs(client, h, cid, fake_media(6000, video=True), SUBS_NEW)
    assert (r.status_code, r.json()) == (200, {"cue_count": 3})
    r = await client.put(f"{BASE}/uploads/{cid}/subtitles", headers=h,
                         files={"file": ("t.srt", SUBS_BAD, "application/x-subrip")})
    assert (r.status_code, r.json()) == (400, {"error": "Invalid subtitle file"})
    assert (await _row(app, cid)).status == "uploading"
    await client.post(f"{BASE}/{cid}/cancel", headers=h, json={})
    r = await client.put(f"{BASE}/uploads/{cid}/subtitles", headers=h,
                         files={"file": ("t.srt", SUBS_NEW, "application/x-subrip")})
    assert (r.status_code, r.json()) == (409, {"error": "Subtitles cannot be changed now"})  # ready: refused again


async def test_a_replace_with_subtitles_rebuilds_sentences_and_keeps_the_unchanged_ones(app, client, monkeypatch,
                                                                                         caplog):
    from app.library import ai as ai_module
    caplog.set_level(logging.INFO)
    sent: list[list[str]] = []

    async def fake_translate(http, settings, *, template, language, texts):
        sent.append(list(texts))
        return {i: f"译{i}" for i in range(len(texts))}

    monkeypatch.setattr(ai_module, "translate_texts", fake_translate)
    _tools, h, _uh, cid, _item = await old_audio_item_with_a_copy(app, client, monkeypatch)
    sent.clear()  # the first upload translated the old sentences already; only the replacement's calls count
    await _give_first_sentence_extras(app, cid)
    r = await _start_with_subs(client, h, cid, fake_media(6000, video=True), SUBS_NEW)
    assert r.status_code == 200, r.text
    await _complete(client, h, cid)
    await drain_background(app)
    row = await _row(app, cid)
    assert (row.status, row.sub_source, row.low_confidence, row.seg_count) == ("ready", "uploaded", False, 3)
    by_text = {s[3]: s for s in await _sentences(app, cid)}
    hello = by_text["Hello there, my friend."]
    assert (hello[1], hello[2]) == (400, 3100)  # the new timing
    assert hello[4:8] == ("旧译文", "zh-CN", "旧分析", "A")  # same text: translation, analysis, speaker carried over
    assert hello[8] is None  # flags are cleared by a rebuild
    changed = [s for s in by_text.values() if "brand new" in s[3]]
    assert len(changed) == 1 and changed[0][4] == "译0"  # the sentence without a translation was filled by the pipeline
    assert by_text["How are you doing today?"][4] == "译1"  # unchanged text: the earlier translation is kept
    assert sent == [["A brand new second line."]]  # only the sentence without a translation was sent
    messages = " | ".join(r.getMessage() for r in caplog.records if not r.name.startswith("httpx"))
    assert "library catalog media replaced" in messages and "sentences=3" in messages
    assert "brand new" not in messages and "Hello there" not in messages and "旧译文" not in messages


async def test_a_replace_with_subtitles_leaves_the_copy_side_alone(app, client, monkeypatch):
    _tools, h, uh, cid, item = await old_audio_item_with_a_copy(app, client, monkeypatch)
    await _give_first_sentence_extras(app, cid)
    async with app.state.sessionmaker() as s:
        copy = await s.get(LibraryItem, item)
        copy.title, copy.resume_ms, copy.resume_idx = "My own title", 1234, 1
        seg1 = await s.get(LibrarySegment, (item, 1))
        seg1.text = "My own edited second sentence."  # a learner's edit
        s.add(LibraryAttempt(user_id=copy.user_id, item_id=item, seg_idx=0, text_hash="abcd1234", score=80))
        s.add(LibraryDub(user_id=copy.user_id, item_id=item, seg_from=0, seg_to=1, role="A", status="done",
                         total_score=77, lines={}))
        await s.commit()

    async def copy_state() -> dict:
        async with app.state.sessionmaker() as s:
            c = await s.get(LibraryItem, item)
            segs = (await s.scalars(select(LibrarySegment).where(LibrarySegment.item_id == item)
                                    .order_by(LibrarySegment.idx))).all()
            attempts = (await s.scalars(select(LibraryAttempt).where(LibraryAttempt.item_id == item))).all()
            dubs = (await s.scalars(select(LibraryDub).where(LibraryDub.item_id == item))).all()
            return {"title": c.title, "resume": (c.resume_ms, c.resume_idx), "media": c.media_path,
                    "segs": [(x.idx, x.start_ms, x.end_ms, x.text, x.zh, x.analysis, x.speaker) for x in segs],
                    "attempts": sorted((a.seg_idx, a.text_hash, a.score) for a in attempts),
                    "dubs": sorted((d.seg_from, d.seg_to, d.role, d.total_score) for d in dubs)}

    before = await copy_state()
    r = await _start_with_subs(client, h, cid, fake_media(6000, video=True), SUBS_NEW)
    assert r.status_code == 200, r.text
    await _complete(client, h, cid)
    await drain_background(app)
    after = await copy_state()
    assert after["media"] != before["media"]  # the copy follows the new media (R-KV5)
    assert {k: v for k, v in after.items() if k != "media"} == {k: v for k, v in before.items() if k != "media"}
    copy = (await client.get(f"/api/library/items/{item}", headers=uh)).json()["item"]
    assert (copy["kind"], copy["duration_ms"], copy["catalog_id"]) == ("video", 6000, cid)


async def test_a_bad_duration_with_subtitles_changes_nothing(app, client, monkeypatch):
    _tools, h, uh, cid, item = await old_audio_item_with_a_copy(app, client, monkeypatch)
    before = await _sentences(app, cid)
    old_media = (await _row(app, cid)).media_path
    r = await _start_with_subs(client, h, cid, fake_media(20_000, video=True), SUBS_NEW)
    assert r.status_code == 200, r.text
    await _complete(client, h, cid)
    await drain_background(app)
    row = await _row(app, cid)
    assert (row.status, row.error_kind, row.media_path) == ("ready", "unsupported_format", old_media)
    assert await _sentences(app, cid) == before
    assert (await client.get(f"/api/library/items/{item}", headers=uh)).json()["item"]["kind"] == "audio"
    assert not paths.catalog_tmp_dir(_data_dir(app), cid).exists()


async def test_bad_subtitles_fail_before_the_media_is_probed(app, client, monkeypatch):
    from app.library import segment
    tools, h, _uh, cid, _item = await old_audio_item_with_a_copy(app, client, monkeypatch)
    before = await _sentences(app, cid)
    monkeypatch.setattr(segment, "build", lambda fragments, **kw: [])  # parses, but yields no sentence
    calls = len(tools.calls)
    r = await _start_with_subs(client, h, cid, fake_media(6000, video=True), SUBS_NEW)
    assert r.status_code == 200, r.text
    await _complete(client, h, cid)
    await drain_background(app)
    row = await _row(app, cid)
    assert (row.status, row.error_kind) == ("ready", "bad_subtitle")
    assert "probe" not in tools.calls[calls:] and "normalize" not in tools.calls[calls:]
    assert await _sentences(app, cid) == before and row.media_path.endswith("/media.m4a")
