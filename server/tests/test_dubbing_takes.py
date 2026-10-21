"""L5 S8:配音记录(take)的建立、列表、详情与删除(plan L5 S8 / R6、R10、R23)。"""
import uuid

import pytest
from sqlalchemy import select, update

from app.library import store
from app.models import LibraryAttempt, LibraryDub, LibrarySegment
from tests.dubbing_helpers import five_lines, make_item, make_user, user_id_of, dubbing_settings
from tests.library_helpers import enable


@pytest.fixture
def settings_overrides(request, tmp_path):
    return dubbing_settings(tmp_path, **getattr(request, "param", {}))


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


SPEAKERS = ["A", "B", "A", "B", "A"]


async def test_create_a_take_returns_the_expected_lines_and_starts_recording(app, client, auth_headers):
    item = await make_item(app, await user_id_of(app), five_lines(), speakers=SPEAKERS)
    r = await client.post(f"/api/dubbing/items/{item}/takes", headers=auth_headers,
                          json={"seg_from": 0, "seg_to": 4, "role": "A"})
    assert r.status_code == 201, r.text
    take = r.json()["take"]
    assert take["item_id"] == item and take["status"] == "recording"
    assert take["role"] == "A" and take["expected"] == [0, 2, 4]
    assert take["total_score"] is None and take["summary"] is None and take["lines"] == []
    assert take["finished_at"] is None and take["created_at"]
    assert "Hello" not in r.text  # no sentence text in a take


@pytest.mark.parametrize("body, code, text", [
    ({"seg_from": 3, "seg_to": 1, "role": "A"}, 400, "Invalid clip"),
    ({"seg_from": 0, "seg_to": 9, "role": "A"}, 400, "Invalid clip"),
    ({"seg_from": 0, "seg_to": 1, "role": "C"}, 400, "Role has no lines in the clip"),
    ({"seg_from": 0, "seg_to": 1, "role": "Z"}, 400, "Role has no lines in the clip"),
])
async def test_create_refuses_bad_clips_and_missing_roles(app, client, auth_headers, body, code, text):
    item = await make_item(app, await user_id_of(app), five_lines(), speakers=SPEAKERS)
    r = await client.post(f"/api/dubbing/items/{item}/takes", headers=auth_headers, json=body)
    assert r.status_code == code and r.json() == {"error": text}


async def test_create_refuses_an_item_that_is_not_ready(app, client, auth_headers):
    item = await make_item(app, await user_id_of(app), five_lines(), status="queued", speakers=SPEAKERS)
    r = await client.post(f"/api/dubbing/items/{item}/takes", headers=auth_headers,
                          json={"seg_from": 0, "seg_to": 0, "role": "A"})
    assert r.status_code == 409 and r.json() == {"error": "Item is not ready"}


async def test_list_is_newest_first_capped_at_twenty_and_only_mine(app, client, auth_headers):
    uid = await user_id_of(app)
    bob = await make_user(app, 3333333, "bob")
    item = await make_item(app, uid, five_lines(), speakers=SPEAKERS)
    theirs = await make_item(app, bob, five_lines(), speakers=SPEAKERS)
    created = []
    for _ in range(21):
        r = await client.post(f"/api/dubbing/items/{item}/takes", headers=auth_headers,
                              json={"seg_from": 0, "seg_to": 0, "role": "A"})
        created.append(r.json()["take"]["id"])
    await client.post(f"/api/dubbing/items/{theirs}/takes", headers=auth_headers,
                      json={"seg_from": 0, "seg_to": 0, "role": "A"})
    takes = (await client.get(f"/api/dubbing/items/{item}/takes", headers=auth_headers)).json()["takes"]
    assert len(takes) == 20
    assert takes[0]["id"] == created[-1]
    assert all(t["item_id"] == item for t in takes)


async def test_someone_elses_take_and_a_non_uuid_are_404(app, client, auth_headers):
    bob = await make_user(app, 3333333, "bob")
    theirs = await make_item(app, bob, five_lines(), speakers=SPEAKERS)
    item = await make_item(app, await user_id_of(app), five_lines(), speakers=SPEAKERS)
    take_id = (await client.post(f"/api/dubbing/items/{item}/takes", headers=auth_headers,
                                 json={"seg_from": 0, "seg_to": 0, "role": "A"})).json()["take"]["id"]
    assert (await client.get(f"/api/dubbing/takes/{take_id}", headers=auth_headers)).status_code == 200
    async with app.state.sessionmaker() as s:
        bob_take = LibraryDub(id=str(uuid.uuid4()), user_id=bob, item_id=theirs, seg_from=0, seg_to=0, role="A",
                              status="recording", lines={})
        s.add(bob_take)
        await s.commit()
        bob_take_id = bob_take.id
    r = await client.get(f"/api/dubbing/takes/{bob_take_id}", headers=auth_headers)
    assert r.status_code == 404 and r.json() == {"error": "Not Found"}
    assert (await client.get("/api/dubbing/takes/not-a-uuid", headers=auth_headers)).status_code == 404


async def test_a_line_whose_sentence_changed_is_marked_stale(app, client, auth_headers):
    uid = await user_id_of(app)
    item = await make_item(app, uid, five_lines(), speakers=SPEAKERS)
    take_id = (await client.post(f"/api/dubbing/items/{item}/takes", headers=auth_headers,
                                 json={"seg_from": 0, "seg_to": 0, "role": "A"})).json()["take"]["id"]
    async with app.state.sessionmaker() as s:
        take = await s.get(LibraryDub, take_id)
        take.lines = {"0": {"assessment_id": "a1", "pronunciation": 80, "fluency": 70, "sync": None,
                            "sync_basis": "none", "score": 77}}
        s.add(LibraryAttempt(user_id=uid, item_id=item, seg_idx=0, assessment_id="a1",
                             text_hash=store.text_hash("Hello there."), score=80, dub_id=take_id))
        await s.commit()
    fresh = (await client.get(f"/api/dubbing/takes/{take_id}", headers=auth_headers)).json()["take"]
    assert fresh["lines"][0]["stale"] is False and fresh["lines"][0]["score"] == 77
    async with app.state.sessionmaker() as s:
        seg = await s.get(LibrarySegment, (item, 0))
        seg.text = "Hello there, friend."
        await s.commit()
    changed = (await client.get(f"/api/dubbing/takes/{take_id}", headers=auth_headers)).json()["take"]
    assert changed["lines"][0]["stale"] is True


async def test_delete_removes_the_take_and_detaches_its_attempts(app, client, auth_headers):
    uid = await user_id_of(app)
    item = await make_item(app, uid, five_lines(), speakers=SPEAKERS)
    take_id = (await client.post(f"/api/dubbing/items/{item}/takes", headers=auth_headers,
                                 json={"seg_from": 0, "seg_to": 0, "role": "A"})).json()["take"]["id"]
    async with app.state.sessionmaker() as s:
        s.add(LibraryAttempt(user_id=uid, item_id=item, seg_idx=0, assessment_id="a9",
                             text_hash=store.text_hash("Hello there."), score=60, dub_id=take_id))
        await s.commit()
    r = await client.delete(f"/api/dubbing/takes/{take_id}", headers=auth_headers)
    assert r.status_code == 204
    assert (await client.get(f"/api/dubbing/takes/{take_id}", headers=auth_headers)).status_code == 404
    async with app.state.sessionmaker() as s:
        attempt = await s.scalar(select(LibraryAttempt).where(LibraryAttempt.assessment_id == "a9"))
        assert attempt is not None and attempt.dub_id is None
    assert (await client.delete(f"/api/dubbing/takes/{take_id}", headers=auth_headers)).status_code == 404
