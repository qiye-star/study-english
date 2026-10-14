"""媒体票据与 Range、封面、补传字幕、句子微调、跟读成绩、评测与练习清单的 `library` 来源(spec §9、§10)。"""
import pytest
from sqlalchemy import select

from app.models import Assessment, LibraryItem, User
from app.services.provider_clients import get_xfyun
from tests.library_helpers import SRT, enable, fake_media, library_settings, process, upload, use_fakes
from tests.test_assessment_save import GOOD_XML, FakeXfyun, make_wav

MEDIA = fake_media(6000) + bytes(range(256)) * 8  # 2 KiB+ of known bytes


@pytest.fixture
def settings_overrides(request, tmp_path):
    return library_settings(tmp_path, **getattr(request, "param", {}))


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


async def ready_item(app, client, headers) -> str:
    use_fakes(app)
    item_id = await upload(client, headers, MEDIA, subs=SRT)
    await process(app)
    return item_id


async def ticket_url(client, headers, item_id) -> str:
    r = await client.post(f"/api/library/items/{item_id}/media-ticket", headers=headers)
    assert r.status_code == 200 and r.json()["expires_in"] == 1800
    url = r.json()["url"]
    assert url.startswith(f"/api/library/items/{item_id}/media?ticket=")
    return url


async def test_media_needs_a_ticket_and_supports_ranges(app, client, auth_headers):
    item_id = await ready_item(app, client, auth_headers)
    url = await ticket_url(client, auth_headers, item_id)
    size = len(MEDIA)
    r = await client.get(url)  # no Authorization header: the ticket is the credential
    assert r.status_code == 200 and r.content == MEDIA and r.headers["content-type"] == "video/mp4"
    assert r.headers["accept-ranges"] == "bytes" and r.headers["cache-control"] == "private, no-store"
    assert r.headers["referrer-policy"] == "no-referrer"
    r = await client.get(url, headers={"Range": "bytes=0-1"})
    assert (r.status_code, r.content, r.headers["content-range"]) == (206, MEDIA[:2], f"bytes 0-1/{size}")
    r = await client.get(url, headers={"Range": "bytes=100-"})
    assert r.status_code == 206 and r.content == MEDIA[100:]
    r = await client.get(url, headers={"Range": "bytes=-500"})
    assert r.status_code == 206 and r.content == MEDIA[-500:]
    r = await client.get(url, headers={"Range": f"bytes={size}-"})
    assert r.status_code == 416 and r.headers["content-range"] == f"bytes */{size}"
    etag = (await client.get(url)).headers["etag"]
    assert (await client.get(url, headers={"Range": "bytes=0-1", "If-Range": etag})).status_code == 206
    assert (await client.get(url, headers={"Range": "bytes=0-1", "If-Range": '"stale"'})).status_code == 200
    assert (await client.head(url)).status_code == 200


async def test_bad_tickets_other_items_deleted_items_and_disabled_users(app, client, auth_headers):
    item_id = await ready_item(app, client, auth_headers)
    other_id = await ready_item(app, client, auth_headers)
    url = await ticket_url(client, auth_headers, item_id)
    base = f"/api/library/items/{item_id}/media"
    assert (await client.get(base)).json() == {"error": "Invalid ticket"}
    assert (await client.get(base + "?ticket=forged")).status_code == 401
    assert (await client.get(url.replace(item_id, other_id))).status_code == 401  # bound to its item
    async with app.state.sessionmaker() as s:
        user = (await s.scalars(select(User))).first()
        user.disabled_at = user.created_at
        await s.commit()
    assert (await client.get(url)).status_code == 404
    async with app.state.sessionmaker() as s:
        user = (await s.scalars(select(User))).first()
        user.disabled_at = None
        await s.commit()
    assert (await client.get(url)).status_code == 200


async def test_tickets_only_for_ready_items_and_poster_needs_bearer(app, client, auth_headers):
    item_id = await upload(client, auth_headers, MEDIA, complete=False)
    r = await client.post(f"/api/library/items/{item_id}/media-ticket", headers=auth_headers)
    assert (r.status_code, r.json()) == (409, {"error": "Item is not ready"})
    ready = await ready_item(app, client, auth_headers)
    assert (await client.get(f"/api/library/items/{ready}/poster")).status_code == 401
    r = await client.get(f"/api/library/items/{ready}/poster", headers=auth_headers)
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and r.content.startswith(b"\xff\xd8")


async def test_replacing_subtitles_resegments_a_ready_item(app, client, auth_headers):
    item_id = await ready_item(app, client, auth_headers)
    new = b"1\n00:00:01,000 --> 00:00:04,000\nA brand new first line here.\n"
    r = await client.put(f"/api/library/items/{item_id}/subtitles", headers=auth_headers,
                         files={"file": ("n.srt", new, "application/x-subrip")})
    body = r.json()
    assert body["item"]["seg_count"] == 1 and [(s["idx"], s["start_ms"], s["end_ms"], s["text"]) for s in body["segments"]] == [
        (0, 1000, 4000, "A brand new first line here.")]
    assert (body["segments"][0]["zh"], body["segments"][0]["has_analysis"]) == (None, False)  # E11: replaced = cleared
    r = await client.put(f"/api/library/items/{item_id}/subtitles", headers=auth_headers,
                         files={"file": ("n.srt", b"garbage", "text/plain")})
    assert r.json() == {"error": "Invalid subtitle file"}


async def test_subtitles_rescue_a_failed_no_subtitles_item(app, client, auth_headers):
    use_fakes(app)
    item_id = await upload(client, auth_headers, MEDIA)
    await process(app)
    item = (await client.get(f"/api/library/items/{item_id}", headers=auth_headers)).json()["item"]
    assert (item["status"], item["error_kind"]) == ("failed", "no_subtitles")
    r = await client.put(f"/api/library/items/{item_id}/subtitles", headers=auth_headers,
                         files={"file": ("s.srt", SRT, "application/x-subrip")})
    assert r.json()["item"]["status"] == "queued"
    await process(app)
    item = (await client.get(f"/api/library/items/{item_id}", headers=auth_headers)).json()["item"]
    assert (item["status"], item["sub_source"]) == ("ready", "uploaded")


async def test_segment_fine_tuning(app, client, auth_headers):
    item_id = await ready_item(app, client, auth_headers)  # sentences 500-3000, 3200-6000; duration 6000
    url = f"/api/library/items/{item_id}/segments"
    r = await client.patch(f"{url}/0", headers=auth_headers, json={"start_ms": 300, "end_ms": 3200,
                                                                   "text": "  Hello  there, my dear friend. "})
    assert r.json() == {"segment": {"idx": 0, "start_ms": 300, "end_ms": 3200, "text": "Hello there, my dear friend.",
                                    "zh": None, "zh_lang": None, "has_analysis": False, "analysis_lang": None,
                                    "flags": []}}
    for idx, body, error in (
        (0, {"end_ms": 3201}, "Invalid sentence times"),  # overlaps the next sentence
        (1, {"end_ms": 6001}, "Invalid sentence times"),  # beyond the media
        (1, {"start_ms": 6000}, "Invalid sentence times"),  # empty
        (0, {"text": "123 456"}, "Invalid sentence text"),
        (0, {"text": "a" * 601}, "Invalid sentence text"),
        (0, {}, "No changes"),
        (5, {"text": "Hi"}, "Sentence not found"),
    ):
        assert (await client.patch(f"{url}/{idx}", headers=auth_headers, json=body)).json() == {"error": error}


async def _assessment(app, uid, text, source="library", score=81.6) -> str:
    async with app.state.sessionmaker() as s:
        row = Assessment(user_id=uid, reference_text=text, language="en-US", duration_ms=500, audio_bytes=1,
                         scores={"pronunciation_score": score}, result={}, audio_path="x", source=source)
        s.add(row)
        await s.commit()
        return row.id


async def test_attempts_check_the_assessment_and_keep_the_best_score_per_current_text(app, client, auth_headers):
    item_id = await ready_item(app, client, auth_headers)
    uid = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    url = f"/api/library/items/{item_id}/attempts"
    good = await _assessment(app, uid, "Hello there,  my friend.")
    assert (await client.post(url, headers=auth_headers, json={"seg_idx": 0, "assessment_id": good})).json() == {
        "seg_idx": 0, "score": 82}
    better = await _assessment(app, uid, "Hello there, my friend.", score=95)
    await client.post(url, headers=auth_headers, json={"seg_idx": 0, "assessment_id": better})
    await client.post(url, headers=auth_headers, json={"seg_idx": 0, "assessment_id": better})  # counted once
    for aid, idx in ((await _assessment(app, uid, "Hello there, my friend.", source="practice"), 0),
                     (await _assessment(app, uid, "Something else."), 0), (good, 1)):
        r = await client.post(url, headers=auth_headers, json={"seg_idx": idx, "assessment_id": aid})
        assert r.json() == {"error": "Assessment does not match"}
    stats = (await client.get(url, headers=auth_headers)).json()["attempts"]
    assert [(a["seg_idx"], a["best_score"], a["count"]) for a in stats] == [(0, 95, 2)]
    await client.patch(f"/api/library/items/{item_id}/segments/0", headers=auth_headers, json={"text": "Hello friend."})
    assert (await client.get(url, headers=auth_headers)).json() == {"attempts": []}  # the text changed


async def test_speech_and_practice_items_accept_the_library_source(app, client, auth_headers):
    fake = FakeXfyun()
    app.dependency_overrides[get_xfyun] = lambda: fake
    r = await client.post("/api/speech/assessments", headers=auth_headers,
                          data={"reference": "Hello there", "language": "en-US", "save": "true", "source": "library"},
                          files={"file": ("a.wav", make_wav(), "audio/wav")})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        assert (await s.scalars(select(Assessment.source))).all() == ["library"]
    r = await client.post("/api/practice-items", headers=auth_headers, json={"text": "Hello there.", "source": "library"})
    assert r.status_code == 200 and r.json()["source"] == "library"
    assert GOOD_XML  # the fake upstream answers with this sample
    async with app.state.sessionmaker() as s:
        assert (await s.scalars(select(LibraryItem))).all() == []
