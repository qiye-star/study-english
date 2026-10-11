import logging

import pytest

from app.routers.rooms import runtime
from app.models import utcnow

pytestmark = pytest.mark.parametrize("settings_overrides", [{"rooms_enabled": True}], indirect=True)


async def register(client, name):
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, int(r.json()["id"])


async def _ended(client, headers):
    room = (await client.post("/api/rooms", json={"name": "美食角"}, headers=headers)).json()["room"]
    assert (await client.post(f"/api/rooms/{room['id']}/close", headers=headers)).status_code == 200
    await runtime(client._transport.app).hub.drain()  # the summary runner finishes before we look at it
    return room


async def test_mine_hides_ended_rooms_and_counts_them(client, auth_headers):
    ended = await _ended(client, auth_headers)
    live = (await client.post("/api/rooms", json={}, headers=auth_headers)).json()["room"]
    mine = (await client.get("/api/rooms/mine", headers=auth_headers)).json()
    assert [r["id"] for r in mine["rooms"]] == [live["id"]] and mine["ended_count"] == 1
    page = (await client.get("/api/rooms/ended", headers=auth_headers)).json()
    assert [r["id"] for r in page["rooms"]] == [ended["id"]] and page["next_cursor"] is None
    row = page["rooms"][0]
    assert row["status"] == "closed" and row["close_reason"] == "owner" and row["summary_status"] == "skipped"  # summaries are off here: the runner records skipped("disabled")
    assert row["code"] is None and row["my_role"] == "owner"


async def test_ended_pages_with_a_cursor_and_rejects_a_bad_one(client, auth_headers):
    ids = []
    for _ in range(3):
        ids.append((await _ended(client, auth_headers))["id"])
    first = (await client.get("/api/rooms/ended", params={"limit": 2}, headers=auth_headers)).json()
    assert len(first["rooms"]) == 2 and first["next_cursor"]
    second = (await client.get("/api/rooms/ended", params={"limit": 2, "cursor": first["next_cursor"]}, headers=auth_headers)).json()
    assert sorted(r["id"] for r in first["rooms"] + second["rooms"]) == sorted(ids) and second["next_cursor"] is None
    bad = await client.get("/api/rooms/ended", params={"cursor": "###"}, headers=auth_headers)
    assert bad.status_code == 400 and bad.json() == {"error": "Invalid cursor"}
    assert (await client.get("/api/rooms/ended", params={"limit": 51}, headers=auth_headers)).status_code == 422


async def test_owner_reopens_an_ended_room(client, auth_headers, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    ended = await _ended(client, auth_headers)
    r = await client.post(f"/api/rooms/{ended['id']}/reopen", headers=auth_headers)
    assert r.status_code == 200
    room = r.json()["room"]
    assert room["status"] == "open" and len(room["code"]) == 6 and room["close_reason"] is None and room["closed_at"] is None
    assert room["my_role"] == "owner" and room["id"] == ended["id"]
    mine = (await client.get("/api/rooms/mine", headers=auth_headers)).json()
    assert [x["id"] for x in mine["rooms"]] == [ended["id"]] and mine["ended_count"] == 0
    msgs = (await client.get(f"/api/rooms/{ended['id']}/messages", params={"before_seq": 100}, headers=auth_headers)).json()["messages"]
    assert [(m["kind"], m["text"], m["meta"]) for m in msgs] == [("system", "reopened", {"name": "alice"})]
    ticket = await client.post(f"/api/rooms/{ended['id']}/ticket", headers=auth_headers)
    assert ticket.status_code == 200  # a socket can be opened again
    assert room["code"] not in caplog.text and "美食角" not in caplog.text and "alice" not in caplog.text.replace("alice@", "")
    assert ended["id"] in caplog.text  # ids are fine


async def test_reopen_errors(client, auth_headers):
    bob, _ = await register(client, "bob")
    ended = await _ended(client, auth_headers)
    assert (await client.post(f"/api/rooms/{ended['id']}/reopen", headers=bob)).json() == {"error": "Only the owner can do that"}
    assert (await client.post("/api/rooms/nope/reopen", headers=auth_headers)).status_code == 404
    assert (await client.post(f"/api/rooms/{ended['id']}/reopen", headers=auth_headers)).status_code == 200
    again = await client.post(f"/api/rooms/{ended['id']}/reopen", headers=auth_headers)
    assert again.status_code == 409 and again.json() == {"error": "Room is not closed"}  # R-O6: a double tap is harmless
    room = (await client.get(f"/api/rooms/{ended['id']}", headers=auth_headers)).json()["room"]
    assert room["status"] == "open"


async def test_admin_closed_rooms_cannot_be_reopened_by_the_owner(app, client, auth_headers):
    room = (await client.post("/api/rooms", json={}, headers=auth_headers)).json()["room"]
    rt = runtime(app)
    await rt.store.close(room["id"], "admin", utcnow())
    r = await client.post(f"/api/rooms/{room['id']}/reopen", headers=auth_headers)
    assert r.status_code == 403 and r.json() == {"error": "Closed by an administrator"}


async def test_reopen_obeys_the_owner_room_cap_and_the_rate_limit(app, client, auth_headers):
    first = await _ended(client, auth_headers)
    for _ in range(3):  # rooms_max_owned defaults to 3
        assert (await client.post("/api/rooms", json={}, headers=auth_headers)).status_code == 200
    capped = await client.post(f"/api/rooms/{first['id']}/reopen", headers=auth_headers)
    assert capped.status_code == 429 and capped.json() == {"error": "Too many rooms"}
    runtime(app).reopen_limiter.limit = 1
    assert (await client.post(f"/api/rooms/{first['id']}/reopen", headers=auth_headers)).status_code == 429  # 1st call counted above
    limited = await client.post(f"/api/rooms/{first['id']}/reopen", headers=auth_headers)
    assert limited.json() == {"error": "Too many requests, please try again later"}
