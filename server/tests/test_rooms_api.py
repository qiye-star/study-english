import pytest

pytestmark = pytest.mark.parametrize("settings_overrides", [{"rooms_enabled": True, "rooms_max_members": 2}], indirect=True)


async def register(client, name):
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, int(r.json()["id"])


async def test_create_join_mine_and_detail(client, auth_headers):
    created = await client.post("/api/rooms", json={"topic": "美食"}, headers=auth_headers)
    assert created.status_code == 200
    room = created.json()["room"]
    assert len(room["code"]) == 6 and room["my_role"] == "owner" and room["member_count"] == 1
    bob, bob_id = await register(client, "bob")
    joined = await client.post("/api/rooms/join", json={"code": f" {room['code'][:3]} {room['code'][3:]} "}, headers=bob)
    assert joined.json()["room"]["my_role"] == "member"
    detail = (await client.get(f"/api/rooms/{room['id']}", headers=bob)).json()
    assert [m["name"] for m in detail["members"]] == ["alice", "bob"]
    msgs = (await client.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": 100}, headers=bob)).json()["messages"]
    assert [(m["kind"], m["text"], m["meta"]) for m in msgs] == [("system", "joined", {"name": "bob"})]
    mine = (await client.get("/api/rooms/mine", headers=bob)).json()["rooms"]
    assert [r["id"] for r in mine] == [room["id"]]


async def test_join_errors_are_distinct(client, auth_headers):
    room = (await client.post("/api/rooms", json={}, headers=auth_headers)).json()["room"]
    assert (await client.post("/api/rooms/join", json={"code": "abc"}, headers=auth_headers)).json() == {"error": "Room not found"}
    bob, _ = await register(client, "bob")
    carol, _ = await register(client, "carol")
    await client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    full = await client.post("/api/rooms/join", json={"code": room["code"]}, headers=carol)
    assert (full.status_code, full.json()) == (409, {"error": "Room is full"})
    await client.patch(f"/api/rooms/{room['id']}", json={"locked": True}, headers=auth_headers)
    await client.post(f"/api/rooms/{room['id']}/leave", headers=bob)
    locked = await client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    assert (locked.status_code, locked.json()) == (403, {"error": "Room is locked"})


async def test_owner_only_actions_kick_and_close(client, auth_headers):
    room = (await client.post("/api/rooms", json={}, headers=auth_headers)).json()["room"]
    bob, bob_id = await register(client, "bob")
    await client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    denied = await client.patch(f"/api/rooms/{room['id']}", json={"topic": "x"}, headers=bob)
    assert (denied.status_code, denied.json()) == (403, {"error": "Only the owner can do that"})
    assert (await client.post(f"/api/rooms/{room['id']}/kick", json={"user_id": bob_id}, headers=auth_headers)).status_code == 200
    again = await client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    assert again.json() == {"error": "Removed from room"}
    assert (await client.get(f"/api/rooms/{room['id']}", headers=bob)).status_code == 404
    closed = (await client.post(f"/api/rooms/{room['id']}/close", headers=auth_headers)).json()["room"]
    assert closed["status"] == "closed" and closed["code"] is None
    assert (await client.post(f"/api/rooms/{room['id']}/ticket", headers=auth_headers)).status_code == 404


async def test_closed_room_history_stays_readable(client, auth_headers):
    room = (await client.post("/api/rooms", json={"topic": "旅行"}, headers=auth_headers)).json()["room"]
    patched = await client.patch(f"/api/rooms/{room['id']}", json={"topic": "美食"}, headers=auth_headers)
    assert patched.json()["room"]["topic"] == "美食"
    await client.post(f"/api/rooms/{room['id']}/close", headers=auth_headers)
    detail = await client.get(f"/api/rooms/{room['id']}", headers=auth_headers)
    assert detail.status_code == 200 and detail.json()["room"]["status"] == "closed"
    msgs = (await client.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": 100}, headers=auth_headers)).json()
    # v2 (spec 2026-10-10 §3.2): a legacy topic patch renames the room and posts one `settings` message
    assert [(m["text"], m["meta"]) for m in msgs["messages"]] == [
        ("settings", {"changes": [{"field": "name", "value": "美食"}]})]
    assert (await client.patch(f"/api/rooms/{room['id']}", json={"locked": True}, headers=auth_headers)).status_code == 404
    mine = (await client.get("/api/rooms/mine", headers=auth_headers)).json()["rooms"]
    assert [(r["id"], r["status"]) for r in mine] == [(room["id"], "closed")]


async def test_ticket_report_and_limits(client, auth_headers):
    room = (await client.post("/api/rooms", json={}, headers=auth_headers)).json()["room"]
    ticket = (await client.post(f"/api/rooms/{room['id']}/ticket", headers=auth_headers)).json()
    assert len(ticket["ticket"]) > 30 and ticket["expires_in"] == 60
    bob, _ = await register(client, "bob")
    assert (await client.post(f"/api/rooms/{room['id']}/ticket", headers=bob)).status_code == 404
    for _ in range(2):
        await client.post("/api/rooms", json={}, headers=auth_headers)
    too_many = await client.post("/api/rooms", json={}, headers=auth_headers)
    assert (too_many.status_code, too_many.json()) == (429, {"error": "Too many rooms"})
    msgs = (await client.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": 100}, headers=auth_headers)).json()
    assert msgs == {"messages": []}
    bad = await client.post(f"/api/rooms/{room['id']}/messages/nope/report", json={"reason": "spam"}, headers=auth_headers)
    assert bad.status_code == 404


async def test_report_a_public_message(client, auth_headers):
    room = (await client.post("/api/rooms", json={}, headers=auth_headers)).json()["room"]
    bob, _ = await register(client, "bob")
    await client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    joined = (await client.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": 100}, headers=bob)).json()["messages"][0]
    url = f"/api/rooms/{room['id']}/messages/{joined['id']}/report"
    assert (await client.post(url, json={"reason": "spam"}, headers=auth_headers)).json() == {"ok": True}
    assert (await client.post(url, json={"reason": "spam"}, headers=auth_headers)).json() == {"ok": True}
    bad = await client.post(url, json={"reason": "nope"}, headers=auth_headers)
    assert (bad.status_code, bad.json()) == (400, {"error": "Invalid reason"})
