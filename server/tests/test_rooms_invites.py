import logging

from tests.test_rooms_ws import login, make_client, until


def _app_logs(caplog) -> str:
    """App loggers only: aiosqlite's DEBUG statement log echoes bound SQL parameters by design."""
    return "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("app"))


def test_invite_links_join_directly_and_rotate(tmp_path, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    app, client = make_client(tmp_path, monkeypatch)
    try:
        alice, _ = login(client, "alice")
        bob, _ = login(client, "bob")
        carol, _ = login(client, "carol")
        room = client.post("/api/rooms", json={"join_mode": "approval", "scenario": "cafe"}, headers=alice).json()["room"]
        client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)  # pending only
        assert client.post(f"/api/rooms/{room['id']}/invite", headers=bob).status_code == 404  # not a member yet
        link = client.post(f"/api/rooms/{room['id']}/invite", headers=alice).json()
        assert link["path"] == f"/rooms/invite/{link['token']}" and len(link["token"]) >= 20
        assert client.post(f"/api/rooms/{room['id']}/invite", headers=alice).json() == link  # stable until rotated
        preview = client.get(f"/api/rooms/invite/{link['token']}", headers=carol).json()["invite"]
        assert preview == {"room_id": room["id"], "name": "alice的房间", "scenario": "cafe", "level": "A2",
                           "member_count": 1, "max_members": 4, "joined": False}
        joined = client.post(f"/api/rooms/invite/{link['token']}/join", headers=carol)
        assert joined.status_code == 200 and joined.json()["room"]["my_role"] == "member"  # approval bypassed
        assert client.get(f"/api/rooms/invite/{link['token']}", headers=carol).json()["invite"]["joined"] is True
        again = client.post(f"/api/rooms/invite/{link['token']}/join", headers=carol)  # already a member: no-op
        assert again.status_code == 200 and again.json()["room"]["member_count"] == 2
        # members of an approval room cannot hand out links (they would bypass the owner)
        assert client.post(f"/api/rooms/{room['id']}/invite", headers=carol).status_code == 403
        new = client.post(f"/api/rooms/{room['id']}/invite/rotate", headers=alice).json()
        assert new["token"] != link["token"] and new["path"] == f"/rooms/invite/{new['token']}"
        assert client.get(f"/api/rooms/invite/{link['token']}", headers=bob).status_code == 404
        client.patch(f"/api/rooms/{room['id']}", json={"locked": True}, headers=alice)
        locked = client.post(f"/api/rooms/invite/{new['token']}/join", headers=bob)
        assert locked.status_code == 403 and locked.json() == {"error": "Room is locked"}
        logs = _app_logs(caplog)
        assert link["token"] not in logs and new["token"] not in logs
    finally:
        client.__exit__(None, None, None)


def test_invite_join_settles_a_pending_request_and_tells_the_owner(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    try:
        alice, _ = login(client, "alice")
        bob, _ = login(client, "bob")
        room = client.post("/api/rooms", json={"join_mode": "approval"}, headers=alice).json()["room"]
        req = client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob).json()["request"]
        token = client.post(f"/api/rooms/{room['id']}/invite", headers=alice).json()["token"]
        ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=alice).json()["ticket"]
        with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wa:
            wa.send_text('{"type":"hello","last_seq":0,"v":2}')
            until(wa, "welcome")
            assert client.post(f"/api/rooms/invite/{token}/join", headers=bob).status_code == 200
            assert until(wa, "join_request_closed")[-1] == {"type": "join_request_closed", "id": req["id"],
                                                            "status": "approved"}
            joined = [e for e in until(wa, "presence") if e["type"] == "message"]
            assert joined[-1]["message"]["meta"] == {"name": "bob"}
        assert client.get(f"/api/rooms/requests/{req['id']}", headers=bob).json()["request"]["status"] == "approved"
    finally:
        client.__exit__(None, None, None)


def test_members_of_code_rooms_can_share_and_closed_rooms_kill_links(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    try:
        alice, _ = login(client, "alice")
        bob, _ = login(client, "bob")
        carol, _ = login(client, "carol")
        room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
        token = client.post(f"/api/rooms/{room['id']}/invite", headers=bob).json()["token"]
        assert client.post(f"/api/rooms/{room['id']}/invite/rotate", headers=bob).status_code == 403
        bad = client.get("/api/rooms/invite/nope", headers=carol)
        assert (bad.status_code, bad.json()) == (404, {"error": "Room not found"})
        client.post(f"/api/rooms/{room['id']}/close", headers=alice)
        assert client.get(f"/api/rooms/invite/{token}", headers=bob).status_code == 404
        assert client.post(f"/api/rooms/invite/{token}/join", headers=carol).status_code == 404
        assert client.post(f"/api/rooms/{room['id']}/invite", headers=bob).status_code == 404
    finally:
        client.__exit__(None, None, None)


def test_kicked_users_and_full_rooms_refuse_invite_joins(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    try:
        alice, _ = login(client, "alice")
        bob, bob_id = login(client, "bob")
        carol, _ = login(client, "carol")
        room = client.post("/api/rooms", json={"max_members": 2}, headers=alice).json()["room"]
        token = client.post(f"/api/rooms/{room['id']}/invite", headers=alice).json()["token"]
        assert client.post(f"/api/rooms/invite/{token}/join", headers=bob).status_code == 200
        full = client.post(f"/api/rooms/invite/{token}/join", headers=carol)
        assert (full.status_code, full.json()) == (409, {"error": "Room is full"})
        client.post(f"/api/rooms/{room['id']}/kick", json={"user_id": bob_id}, headers=alice)
        kicked = client.post(f"/api/rooms/invite/{token}/join", headers=bob)
        assert (kicked.status_code, kicked.json()) == (403, {"error": "Removed from room"})
    finally:
        client.__exit__(None, None, None)
