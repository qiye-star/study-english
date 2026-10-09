import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from starlette.testclient import TestClient

from app.core.db import Base
from app.main import create_app
from app.models import Room, RoomMessage, User, utcnow
from app.routers import rooms as rooms_router
from tests.conftest import make_settings

REAL_DEPS_FOR = rooms_router.deps_for
ASSIST = json.dumps({"reply_zh": "巧克力是 chocolate。", "glossary": [], "suggestions": [{"en": "I like chocolate.", "note_zh": "最常用"}]})


def make_client(tmp_path, monkeypatch, seed=None, **overrides):
    db = tmp_path / "rooms.db"
    engine = create_engine(f"sqlite:///{db.as_posix()}")
    Base.metadata.create_all(engine)  # before lifespan startup touches the tables
    if seed is not None:
        with Session(engine) as s:
            seed(s)
            s.commit()
    engine.dispose()
    app = create_app(make_settings(database_url=f"sqlite+aiosqlite:///{db.as_posix()}", **{"rooms_enabled": True, **overrides}))

    def fake_deps(app_, rt, settings):
        deps = REAL_DEPS_FOR(app_, rt, settings)

        async def complete(messages, max_tokens, temperature):
            return ASSIST if "<draft>" in messages[-1]["content"] else "It means starting a conversation."

        deps.complete = complete
        return deps

    monkeypatch.setattr(rooms_router, "deps_for", fake_deps)
    client = TestClient(app)
    client.__enter__()
    return app, client


@pytest.fixture
def rooms_client(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    yield app, client
    client.__exit__(None, None, None)


def login(client, name):
    r = client.post("/api/users", json={"username": name, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, int(r.json()["id"])


def until(ws, kind):
    events = []
    while True:
        message = ws.receive()
        if message["type"] == "websocket.close":
            raise AssertionError(f"closed {message.get('code')} before {kind}: {events}")
        events.append(json.loads(message["text"]))
        if events[-1]["type"] == kind:
            return events


def closed_code(ws):
    while True:
        message = ws.receive()
        if message["type"] == "websocket.close":
            return message.get("code", 1000)


def setup_room(client):
    alice, _ = login(client, "alice")
    bob, bob_id = login(client, "bob")
    room = client.post("/api/rooms", json={"topic": "美食"}, headers=alice).json()["room"]
    client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    ticket = lambda h: client.post(f"/api/rooms/{room['id']}/ticket", headers=h).json()["ticket"]
    return room, alice, bob, bob_id, ticket


def test_two_members_chat_ai_and_private_assist(rooms_client):
    app, client = rooms_client
    room, alice, bob, _, ticket = setup_room(client)
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(alice)}") as wa, \
            client.websocket_connect(f"/api/rooms/ws?ticket={ticket(bob)}") as wb:
        wa.send_text('{"type":"hello","last_seq":0}')
        welcome = until(wa, "welcome")[-1]
        assert welcome["room"]["topic"] == "美食" and welcome["me"]["role"] == "owner"
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        wa.send_text('{"type":"assist","request_id":"r1","text":"I like 巧克力"}')
        reply = until(wa, "assist_reply")[-1]["message"]
        wa.send_text(json.dumps({"type": "say", "client_id": "c1", "text": "I like chocolate.", "assist_id": reply["id"]}))
        got = until(wb, "message")
        public = [e for e in got if e["type"] == "message"][-1]["message"]
        while public["kind"] == "system":
            more = until(wb, "message")
            got += more
            public = more[-1]["message"]
        assert public["assisted"] is True and not any(e["type"] == "assist_reply" for e in got)
        wb.send_text('{"type":"say","client_id":"q","text":"@ai what does break the ice mean?"}')
        events = until(wa, "message")
        while not (events[-1]["type"] == "message" and events[-1]["message"]["kind"] == "ai_answer"):
            events = until(wa, "message")
        assert events[-1]["message"]["sender"]["kind"] == "ai"


def test_reconnect_replays_only_missing_messages(rooms_client):
    app, client = rooms_client
    room, alice, bob, _, ticket = setup_room(client)
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(bob)}") as wb:
        wb.send_text('{"type":"hello","last_seq":0}')
        last_seq = until(wb, "welcome")[-1]["last_seq"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(alice)}") as wa:
        wa.send_text('{"type":"hello","last_seq":0}')
        until(wa, "welcome")
        for i in range(2):
            wa.send_text(json.dumps({"type": "say", "client_id": f"c{i}", "text": f"m{i}"}))
            until(wa, "ack")
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(bob)}") as wb:
        wb.send_text(json.dumps({"type": "hello", "last_seq": last_seq}))
        welcome = until(wb, "welcome")[-1]
        assert welcome["last_seq"] == last_seq + 2 and welcome["truncated"] is False
        replay = [wb.receive_json(), wb.receive_json()]
        assert [e["message"]["text"] for e in replay] == ["m0", "m1"]


def test_close_codes(rooms_client, monkeypatch):
    app, client = rooms_client
    room, alice, bob, bob_id, ticket = setup_room(client)
    with client.websocket_connect("/api/rooms/ws?ticket=nope") as ws:
        assert closed_code(ws) == 4001
    t = ticket(bob)
    with client.websocket_connect(f"/api/rooms/ws?ticket={t}") as ws:
        ws.send_text('{"type":"ping"}')
        assert closed_code(ws) == 4400  # first frame must be hello
    with client.websocket_connect(f"/api/rooms/ws?ticket={t}") as ws:
        assert closed_code(ws) == 4001  # tickets are one-time
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(bob)}") as wb:
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        client.post(f"/api/rooms/{room['id']}/kick", json={"user_id": bob_id}, headers=alice)
        assert closed_code(wb) == 4010
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(alice)}") as wa:
        wa.send_text('{"type":"hello","last_seq":0}')
        until(wa, "welcome")
        client.portal.call(rooms_router.rooms_shutdown, app)
        assert closed_code(wa) == 1012


def test_owner_close_notifies_and_disconnects_with_4004(rooms_client):
    app, client = rooms_client
    room, alice, bob, _, ticket = setup_room(client)
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(bob)}") as wb:
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        client.post(f"/api/rooms/{room['id']}/close", headers=alice)
        assert until(wb, "closed")[-1] == {"type": "closed", "reason": "owner"}
        assert closed_code(wb) == 4004
    history = client.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": 100}, headers=bob)
    assert history.status_code == 200 and history.json()["messages"]  # closed rooms stay readable


def test_disabled_closes_4003(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch, rooms_enabled=False)
    try:
        with client.websocket_connect("/api/rooms/ws?ticket=x") as ws:
            assert closed_code(ws) == 4003
    finally:
        client.__exit__(None, None, None)


def test_sweep_closes_idle_rooms_and_notifies(rooms_client):
    app, client = rooms_client
    room, alice, *_ = setup_room(client)
    rt = rooms_router.runtime(app)
    closed = client.portal.call(rooms_router.sweep_once, rt, utcnow() + timedelta(minutes=31))
    assert closed == [(room["id"], "idle")]
    assert client.get("/api/rooms/mine", headers=alice).json()["rooms"][0]["status"] == "closed"
    msgs = client.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": 100}, headers=alice).json()["messages"]
    assert [m["text"] for m in msgs] == ["joined"]  # the sweeper never deletes messages by default


def test_startup_marks_pending_ai_failed_and_starts_sweeper(tmp_path, monkeypatch):
    now = datetime(2026, 10, 9, 9, 0, tzinfo=timezone.utc)

    def seed(s):
        s.add(User(id=11111111, username="alice", password_hash="x"))
        s.add(Room(id="r1", code="482913", last_code="482913", owner_id=11111111, topic="", status="open",
                   locked=False, ai_public=True, last_seq=1, created_at=now, last_active_at=now))
        s.add(RoomMessage(id="m1", room_id="r1", seq=1, lane="public", sender_kind="user", sender_id=11111111,
                          kind="text", text="@ai hi", ai_status="pending", created_at=now))

    app, client = make_client(tmp_path, monkeypatch, seed=seed)
    try:
        rt = rooms_router.runtime(app)
        assert rt.sweeper is not None and not rt.sweeper.done()

        async def status():
            async with app.state.sessionmaker() as s:
                return await s.scalar(select(RoomMessage.ai_status).where(RoomMessage.id == "m1"))

        assert client.portal.call(status) == "failed"
    finally:
        client.__exit__(None, None, None)
    assert rt.sweeper is None


def test_ticket_never_logged(rooms_client, caplog):
    app, client = rooms_client
    room, alice, _, _, ticket = setup_room(client)
    t = ticket(alice)
    with client.websocket_connect(f"/api/rooms/ws?ticket={t}") as wa:
        wa.send_text('{"type":"hello","last_seq":0}')
        until(wa, "welcome")
    assert t not in caplog.text
