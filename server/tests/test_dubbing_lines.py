"""L5 S9:逐句关联与收尾评分(plan L5 R9–R11、R15)。评测行直接写库,形状取自真实的 ISE 样例经转换器得到。"""
import asyncio
import uuid

import pytest
from sqlalchemy import select

from app.library import store
from app.models import Assessment, LibraryAttempt, LibrarySegment
from app.providers.xfyun_result import to_assessment
from tests.dubbing_helpers import five_lines, make_item, user_id_of, dubbing_settings
from tests.library_helpers import enable
from tests.test_xfyun_result import REFERENCE, load

SPEAKERS = ["A", "B", "A", "B", "A"]


@pytest.fixture
def settings_overrides(request, tmp_path):
    return dubbing_settings(tmp_path, **getattr(request, "param", {}))


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


async def make_assessment(app, uid: int, text: str, *, source: str = "library", duration_ms: int = 5200) -> str:
    result = to_assessment(load("ise_good.xml"), REFERENCE)
    aid = str(uuid.uuid4())
    async with app.state.sessionmaker() as s:
        s.add(Assessment(id=aid, user_id=uid, reference_text=text, language="en", duration_ms=duration_ms,
                         audio_bytes=1, scores={"pronunciation_score": result["pronunciation_score"]}, result=result,
                         audio_path="x/y.wav", source=source))
        await s.commit()
    return aid


async def start_take(client, headers, item: str, seg_from: int = 0, seg_to: int = 4, role: str = "A") -> str:
    r = await client.post(f"/api/dubbing/items/{item}/takes", headers=headers,
                          json={"seg_from": seg_from, "seg_to": seg_to, "role": role})
    assert r.status_code == 201, r.text
    return r.json()["take"]["id"]


def line_body(aid: str, seg_idx: int, rec_start_ms: int, **extra) -> dict:
    body = {"seg_idx": seg_idx, "assessment_id": aid, "rec_start_ms": rec_start_ms, "voiced_ms": 800,
            "capture": "pcm"}
    body.update(extra)
    return body


async def test_a_line_is_scored_and_written_as_a_practice_attempt(app, client, auth_headers):
    uid = await user_id_of(app)
    item = await make_item(app, uid, five_lines(), speakers=SPEAKERS)
    take = await start_take(client, auth_headers, item)
    aid = await make_assessment(app, uid, "Hello there.")
    r = await client.post(f"/api/dubbing/takes/{take}/lines", headers=auth_headers, json=line_body(aid, 0, 0))
    assert r.status_code == 200, r.text
    line = r.json()["line"]
    assert set(line) == {"seg_idx", "pronunciation", "fluency", "sync", "sync_basis", "score"}
    assert line["seg_idx"] == 0 and line["sync_basis"] == "words" and 0 <= line["score"] <= 100
    async with app.state.sessionmaker() as s:
        attempt = await s.scalar(select(LibraryAttempt).where(LibraryAttempt.assessment_id == aid))
        assert attempt.dub_id == take and attempt.seg_idx == 0 and attempt.score == line["pronunciation"]
        assert [row["seg_idx"] for row in await store.best_attempts(s, item, await store.segments_of(s, item))] == [0]


@pytest.mark.parametrize("seg_idx, assess, body_extra, text", [
    (1, {}, {}, "Line is not in the take"),  # seg 1 is role B
    (9, {}, {}, "Line is not in the take"),  # outside the clip
    (0, {"source": "practice"}, {}, "Assessment does not match the line"),
    (0, {"sentence": "Some other sentence."}, {}, "Assessment does not match the line"),
    (0, {}, {"rec_start_ms": 2000}, "Invalid line timing"),
    (0, {}, {"capture": "mic"}, "Invalid line timing"),
    (0, {}, {"voiced_ms": 999999}, "Invalid line timing"),
])
async def test_bad_lines_are_refused_with_the_fixed_codes(app, client, auth_headers, seg_idx, assess, body_extra,
                                                          text):
    uid = await user_id_of(app)
    item = await make_item(app, uid, five_lines(), speakers=SPEAKERS)
    take = await start_take(client, auth_headers, item)
    sentence = assess.pop("sentence", "Hello there.")
    aid = await make_assessment(app, uid, sentence, **assess)
    body = {**line_body(aid, seg_idx, 0), **body_extra}
    r = await client.post(f"/api/dubbing/takes/{take}/lines", headers=auth_headers, json=body)
    expected_status = 400
    assert r.status_code == expected_status and r.json() == {"error": text}


async def test_someone_elses_assessment_is_not_accepted(app, client, auth_headers):
    from tests.dubbing_helpers import make_user
    bob = await make_user(app, 4444444, "bob")
    item = await make_item(app, await user_id_of(app), five_lines(), speakers=SPEAKERS)
    take = await start_take(client, auth_headers, item)
    aid = await make_assessment(app, bob, "Hello there.")
    r = await client.post(f"/api/dubbing/takes/{take}/lines", headers=auth_headers, json=line_body(aid, 0, 0))
    assert r.status_code == 400 and r.json() == {"error": "Assessment does not match the line"}


async def test_a_second_assessment_for_the_same_sentence_is_refused_but_a_replay_is_idempotent(app, client,
                                                                                               auth_headers):
    uid = await user_id_of(app)
    item = await make_item(app, uid, five_lines(), speakers=SPEAKERS)
    take = await start_take(client, auth_headers, item)
    first = await make_assessment(app, uid, "Hello there.")
    second = await make_assessment(app, uid, "Hello there.")
    url = f"/api/dubbing/takes/{take}/lines"
    original = (await client.post(url, headers=auth_headers, json=line_body(first, 0, 0))).json()["line"]
    r = await client.post(url, headers=auth_headers, json=line_body(second, 0, 0))
    assert r.status_code == 409 and r.json() == {"error": "Line already recorded"}
    again = await client.post(url, headers=auth_headers, json=line_body(first, 0, 0))
    assert again.status_code == 200 and again.json()["line"] == original


async def test_lines_posted_together_both_land(app, client, auth_headers):
    uid = await user_id_of(app)
    item = await make_item(app, uid, five_lines(), speakers=SPEAKERS)
    take = await start_take(client, auth_headers, item)
    a = await make_assessment(app, uid, "Hello there.")
    b = await make_assessment(app, uid, "I am fine.")
    url = f"/api/dubbing/takes/{take}/lines"
    ra, rb = await asyncio.gather(client.post(url, headers=auth_headers, json=line_body(a, 0, 0)),
                                  client.post(url, headers=auth_headers, json=line_body(b, 2, 2000)))
    assert ra.status_code == 200 and rb.status_code == 200, (ra.text, rb.text)
    got = (await client.get(f"/api/dubbing/takes/{take}", headers=auth_headers)).json()["take"]
    assert sorted(line["seg_idx"] for line in got["lines"]) == [0, 2]


async def test_finish_totals_the_role_and_marks_the_missing_lines(app, client, auth_headers):
    uid = await user_id_of(app)
    item = await make_item(app, uid, five_lines(), speakers=SPEAKERS)
    take = await start_take(client, auth_headers, item)
    aid = await make_assessment(app, uid, "Hello there.")
    line = (await client.post(f"/api/dubbing/takes/{take}/lines", headers=auth_headers,
                              json=line_body(aid, 0, 0))).json()["line"]
    r = await client.post(f"/api/dubbing/takes/{take}/finish", headers=auth_headers)
    assert r.status_code == 200, r.text
    done = r.json()["take"]
    assert done["status"] == "done" and done["finished_at"]
    assert done["total_score"] == round((line["score"] + 0 + 0) / 3)  # sentences 2 and 4 are missing: 0 each
    assert done["summary"]["pronunciation"] == line["pronunciation"]
    missing = {entry["seg_idx"] for entry in done["lines"] if entry.get("missing")}
    assert missing == {2, 4}
    assert (await client.post(f"/api/dubbing/takes/{take}/finish", headers=auth_headers)).status_code == 409


async def test_a_finished_take_refuses_new_lines(app, client, auth_headers):
    uid = await user_id_of(app)
    item = await make_item(app, uid, five_lines(), speakers=SPEAKERS)
    take = await start_take(client, auth_headers, item)
    await client.post(f"/api/dubbing/takes/{take}/finish", headers=auth_headers)
    aid = await make_assessment(app, uid, "Hello there.")
    r = await client.post(f"/api/dubbing/takes/{take}/lines", headers=auth_headers, json=line_body(aid, 0, 0))
    assert r.status_code == 409 and r.json() == {"error": "Take is finished"}


async def test_the_dubbed_line_counts_toward_the_best_score_of_the_sentence(app, client, auth_headers):
    uid = await user_id_of(app)
    item = await make_item(app, uid, five_lines(), speakers=SPEAKERS)
    take = await start_take(client, auth_headers, item)
    aid = await make_assessment(app, uid, "Hello there.")
    await client.post(f"/api/dubbing/takes/{take}/lines", headers=auth_headers, json=line_body(aid, 0, 0))
    async with app.state.sessionmaker() as s:
        segs = await store.segments_of(s, item)
        best = {row["seg_idx"]: row for row in await store.best_attempts(s, item, segs)}
    assert best[0]["count"] == 1 and best[0]["best_score"] is not None


async def test_timing_window_edges_are_accepted(app, client, auth_headers):
    uid = await user_id_of(app)
    item = await make_item(app, uid, five_lines(), speakers=SPEAKERS)
    take = await start_take(client, auth_headers, item)
    aid = await make_assessment(app, uid, "Hello there.")
    # sentence 0 starts at 0 ms: the window is [-1000, 500]; -1000 is the earliest allowed start
    early = await client.post(f"/api/dubbing/takes/{take}/lines", headers=auth_headers, json=line_body(aid, 0, -1000))
    assert early.status_code == 200, early.text
