import logging
from datetime import datetime, timedelta, timezone

from app.routers import rooms as rooms_router
from tests.test_rooms_ws import login, make_client, until


def _users(client, *names):
    return {n: login(client, n) for n in names}  # name -> (headers, id)


def _approval_room(client, owner_headers, size=2):
    return client.post("/api/rooms", json={"join_mode": "approval", "max_members": size},
                       headers=owner_headers).json()["room"]


def test_request_approve_and_owner_events(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    try:
        u = _users(client, "alice", "bob")
        alice, (bob, bob_id) = u["alice"][0], u["bob"]
        room = _approval_room(client, alice)
        ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=alice).json()["ticket"]
        with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wa:
            wa.send_text('{"type":"hello","last_seq":0,"v":2}')
            until(wa, "welcome")
            r = client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
            assert r.status_code == 202
            req = r.json()["request"]
            assert (req["status"], req["user_id"], req["name"], req["room_name"]) == (
                "pending", bob_id, "bob", "alice的房间")
            assert until(wa, "join_request")[-1]["request"]["id"] == req["id"]
            again = client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob).json()["request"]
            assert again["id"] == req["id"]  # one pending request per user and room
            assert client.get(f"/api/rooms/{room['id']}/requests", headers=alice).json()["requests"][0]["id"] == req["id"]
            assert client.get(f"/api/rooms/{room['id']}/requests", headers=bob).status_code == 403
            assert client.get(f"/api/rooms/requests/{req['id']}", headers=alice).status_code == 404  # requester only
            assert client.post(f"/api/rooms/{room['id']}/requests/{req['id']}/approve", headers=bob).status_code == 403
            ok = client.post(f"/api/rooms/{room['id']}/requests/{req['id']}/approve", headers=alice)
            assert ok.json()["request"]["status"] == "approved"
            assert until(wa, "join_request_closed")[-1] == {"type": "join_request_closed", "id": req["id"],
                                                            "status": "approved"}
            joined = [e for e in until(wa, "presence") if e["type"] == "message"]
            assert joined[-1]["message"]["text"] == "joined" and joined[-1]["message"]["meta"] == {"name": "bob"}
            assert client.get(f"/api/rooms/requests/{req['id']}", headers=bob).json()["request"]["status"] == "approved"
            assert client.get(f"/api/rooms/{room['id']}", headers=bob).status_code == 200  # now a member
            again = client.post(f"/api/rooms/{room['id']}/requests/{req['id']}/deny", headers=alice)
            assert (again.status_code, again.json()) == (404, {"error": "Request not found"})
    finally:
        client.__exit__(None, None, None)


def test_full_and_locked_rooms_refuse_requests_and_approvals(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    try:
        u = _users(client, "alice", "bob", "carol", "dave")
        alice = u["alice"][0]
        room = _approval_room(client, alice, size=2)
        reqs = [client.post("/api/rooms/join", json={"code": room["code"]}, headers=u[n][0]).json()["request"]
                for n in ("bob", "carol")]
        client.post(f"/api/rooms/{room['id']}/requests/{reqs[0]['id']}/approve", headers=alice)
        full = client.post(f"/api/rooms/{room['id']}/requests/{reqs[1]['id']}/approve", headers=alice)
        assert (full.status_code, full.json()) == (409, {"error": "Room is full"})
        late = client.post("/api/rooms/join", json={"code": room["code"]}, headers=u["dave"][0])
        assert (late.status_code, late.json()) == (409, {"error": "Room is full"})
        client.patch(f"/api/rooms/{room['id']}", json={"locked": True, "max_members": 4}, headers=alice)
        locked = client.post("/api/rooms/join", json={"code": room["code"]}, headers=u["dave"][0])
        assert (locked.status_code, locked.json()) == (403, {"error": "Room is locked"})
        still = client.post(f"/api/rooms/{room['id']}/requests/{reqs[1]['id']}/approve", headers=alice)
        assert (still.status_code, still.json()) == (403, {"error": "Room is locked"})
    finally:
        client.__exit__(None, None, None)


def test_deny_cooldown_cancel_and_expiry(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    try:
        u = _users(client, "alice", "bob", "carol", "dave")
        alice = u["alice"][0]
        room = _approval_room(client, alice, size=4)
        req = client.post("/api/rooms/join", json={"code": room["code"]}, headers=u["bob"][0]).json()["request"]
        denied = client.post(f"/api/rooms/{room['id']}/requests/{req['id']}/deny", headers=alice)
        assert denied.json()["request"]["status"] == "denied"
        again = client.post("/api/rooms/join", json={"code": room["code"]}, headers=u["bob"][0])
        assert again.status_code == 429 and again.json() == {"error": "Try again later"}
        mine = client.post("/api/rooms/join", json={"code": room["code"]}, headers=u["carol"][0]).json()["request"]
        assert client.delete(f"/api/rooms/requests/{mine['id']}", headers=u["dave"][0]).status_code == 404
        cancelled = client.delete(f"/api/rooms/requests/{mine['id']}", headers=u["carol"][0]).json()["request"]
        assert cancelled["status"] == "cancelled"
        d = client.post("/api/rooms/join", json={"code": room["code"]}, headers=u["dave"][0]).json()["request"]
        rt = rooms_router.runtime(app)
        later = datetime.now(timezone.utc) + timedelta(minutes=11)
        assert client.portal.call(rt.store.expire_requests, later) == [(room["id"], d["id"])]
        assert client.get(f"/api/rooms/requests/{d['id']}", headers=u["dave"][0]).json()["request"]["status"] == "expired"
        assert client.portal.call(rt.store.expire_requests, later) == []
    finally:
        client.__exit__(None, None, None)


def test_sweep_expires_requests_and_tells_the_owner(tmp_path, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    app, client = make_client(tmp_path, monkeypatch)
    try:
        u = _users(client, "alice", "bob")
        alice = u["alice"][0]
        room = _approval_room(client, alice)
        req = client.post("/api/rooms/join", json={"code": room["code"]}, headers=u["bob"][0]).json()["request"]
        ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=alice).json()["ticket"]
        with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wa:
            wa.send_text('{"type":"hello","last_seq":0,"v":2}')
            assert [r["id"] for r in until(wa, "welcome")[-1]["join_requests"]] == [req["id"]]
            rt = rooms_router.runtime(app)
            assert rooms_router._expire_requests in rt.sweep_listeners
            later = datetime.now(timezone.utc) + timedelta(minutes=11)
            client.portal.call(rooms_router.sweep_once, rt, later)
            assert until(wa, "join_request_closed")[-1] == {"type": "join_request_closed", "id": req["id"],
                                                            "status": "expired"}
        logs = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("app"))
        assert "rooms join requests expired=1" in logs and req["id"] not in logs and "bob" not in logs
    finally:
        client.__exit__(None, None, None)


def test_too_many_pending_requests_per_room(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    try:
        alice = login(client, "alice")[0]
        room = _approval_room(client, alice)
        rt = rooms_router.runtime(app)
        rt.limits = rt.store.limits = type(rt.limits)(**{**rt.limits.__dict__, "join_pending_per_room": 1})
        bob = login(client, "bob")[0]
        assert client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob).status_code == 202
        r = client.post("/api/rooms/join", json={"code": room["code"]}, headers=login(client, "carol")[0])
        assert (r.status_code, r.json()) == (429, {"error": "Too many requests for this room"})
    finally:
        client.__exit__(None, None, None)


def test_switching_back_to_code_approves_pending_in_order(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    try:
        u = _users(client, "alice", "bob", "carol")
        alice = u["alice"][0]
        room = _approval_room(client, alice, size=2)  # one free seat
        ids = {n: client.post("/api/rooms/join", json={"code": room["code"]}, headers=u[n][0]).json()["request"]["id"]
               for n in ("bob", "carol")}
        client.patch(f"/api/rooms/{room['id']}", json={"join_mode": "code"}, headers=alice)
        status = {n: client.get(f"/api/rooms/requests/{ids[n]}", headers=u[n][0]).json()["request"]["status"]
                  for n in ids}
        assert status == {"bob": "approved", "carol": "expired"}
        assert client.get(f"/api/rooms/{room['id']}", headers=u["bob"][0]).status_code == 200
        msgs = client.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": 2_147_483_647},
                          headers=alice).json()["messages"]
        assert [(m["text"], m["meta"]) for m in msgs if m["kind"] == "system"][-1] == ("joined", {"name": "bob"})
    finally:
        client.__exit__(None, None, None)
