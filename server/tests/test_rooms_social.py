import json
import logging
from datetime import datetime, timezone

from app.rooms.hub import Conn, RoomHub
from app.routers import rooms as rooms_router
from tests.test_rooms_hub import FakeSender
from tests.test_rooms_ws import make_client, setup_room, until

LATEST = 2_147_483_647


def hello(ws):
    """Hello, then read past the welcome replay so `last_message` only sees new messages."""
    ws.send_text('{"type":"hello","last_seq":0,"v":2}')
    welcome = until(ws, "welcome")[-1]
    while welcome["last_seq"] and until(ws, "message")[-1]["message"]["seq"] < welcome["last_seq"]:
        pass
    return welcome


def last_message(ws):
    return [e for e in until(ws, "message") if e["type"] == "message"][-1]["message"]


def test_quote_reactions_and_activity(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    try:
        room, alice, bob, bob_id, ticket = setup_room(client)
        with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(alice)}") as wa, \
                client.websocket_connect(f"/api/rooms/ws?ticket={ticket(bob)}") as wb:
            hello(wa)
            hello(wb)
            wb.send_text(json.dumps({"type": "say", "client_id": "b1", "text": "Any food recommendations?"}))
            first = last_message(wa)
            assert last_message(wb)["seq"] == first["seq"]  # bob's own copy
            wa.send_text(json.dumps({"type": "say", "client_id": "a1", "text": "Try the noodles.",
                                     "reply_to": first["seq"]}))
            reply = last_message(wb)
            alice_id = reply["sender"]["id"]
            assert reply["reply_to"] == first["seq"] and reply["quote"] == {
                "seq": first["seq"], "name": "bob", "kind": "text", "text": "Any food recommendations?"}
            wa.send_text(json.dumps({"type": "say", "client_id": "a2", "text": "x", "reply_to": 9999}))
            assert until(wa, "error")[-1]["code"] == "bad_reply"
            system_seq = 1  # bob's "joined" system message (a new room has no messages)
            wa.send_text(json.dumps({"type": "say", "client_id": "a3", "text": "x", "reply_to": system_seq}))
            assert until(wa, "error")[-1]["code"] == "bad_reply"  # system messages cannot be quoted

            def react(ws, on):
                ws.send_text(json.dumps({"type": "react", "seq": first["seq"], "key": "like", "on": on}))
                got = [until(w, "reaction")[-1] for w in (wa, wb)]  # everyone, the sender included
                assert got[0] == got[1]
                return got[0]

            assert react(wa, True) == {"type": "reaction", "seq": first["seq"], "key": "like", "user_ids": [alice_id]}
            assert react(wb, True)["user_ids"] == [alice_id, bob_id]
            assert react(wb, True)["user_ids"] == [alice_id, bob_id]  # idempotent
            assert react(wa, False)["user_ids"] == [bob_id]
            wa.send_text(json.dumps({"type": "react", "seq": 9999, "key": "like", "on": True}))
            assert until(wa, "error")[-1]["code"] == "bad_seq"
            wa.send_text(json.dumps({"type": "react", "seq": system_seq, "key": "like", "on": True}))
            assert until(wa, "error")[-1]["code"] == "bad_seq"

            wa.send_text('{"type":"typing","state":"typing"}')
            assert until(wb, "activity")[-1] == {"type": "activity", "user_id": alice_id, "state": "typing"}
            wa.send_text('{"type":"ping"}')
            assert all(e["type"] != "activity" for e in until(wa, "pong"))  # never echoed to the sender
        msgs = client.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": LATEST},
                          headers=alice).json()["messages"]
        assert [m["reactions"] for m in msgs if m["seq"] == first["seq"]] == [[{"key": "like", "user_ids": [bob_id]}]]
    finally:
        client.__exit__(None, None, None)


def test_hiding_a_quoted_message_clears_quote_snapshots(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    try:
        room, alice, bob, bob_id, ticket = setup_room(client)
        with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(alice)}") as wa:
            hello(wa)
            wa.send_text(json.dumps({"type": "say", "client_id": "a1", "text": "secret"}))
            m = last_message(wa)
            wa.send_text(json.dumps({"type": "say", "client_id": "a2", "text": "quoting", "reply_to": m["seq"]}))
            until(wa, "ack")
        rt = rooms_router.runtime(app)
        client.portal.call(rt.store.hide, room["id"], m["id"], datetime.now(timezone.utc))
        msgs = client.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": LATEST},
                          headers=alice).json()["messages"]
        assert [x for x in msgs if x["text"] == "quoting"][0]["quote"]["text"] == ""
        # hidden messages can be neither quoted nor reacted to any more
        assert client.portal.call(rt.store.quote_for, room["id"], m["seq"]) is None
        assert client.portal.call(rt.store.toggle_reaction, room["id"], m["seq"], bob_id, "like", True,
                                  datetime.now(timezone.utc)) is None
    finally:
        client.__exit__(None, None, None)


def test_quotes_of_ai_answers_and_long_texts(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    try:
        room, alice, bob, bob_id, ticket = setup_room(client)
        with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(alice)}") as wa:
            hello(wa)
            wa.send_text(json.dumps({"type": "say", "client_id": "a1", "text": "长" * 100}))
            long = last_message(wa)
        rt = rooms_router.runtime(app)

        async def seed():
            now = datetime.now(timezone.utc)
            legacy = await rt.store.append(room["id"], lane="public", sender_kind="ai", sender_id=None,
                                           kind="ai_answer", text="It means starting a conversation.", now=now)
            agent = await rt.store.append(room["id"], lane="public", sender_kind="ai", sender_id=None, kind="ai_answer",
                                          text="Try it.", now=now,
                                          meta={"agent": {"persona_id": "builtin:coach", "name": "Emma"}})
            return legacy, agent

        legacy, agent = client.portal.call(seed)
        assert client.portal.call(rt.store.quote_for, room["id"], long["seq"])["text"] == "长" * 80
        assert client.portal.call(rt.store.quote_for, room["id"], legacy.seq) == {
            "seq": legacy.seq, "name": "AI 助手", "kind": "ai_answer", "text": "It means starting a conversation."}
        assert client.portal.call(rt.store.quote_for, room["id"], agent.seq)["name"] == "Emma"
    finally:
        client.__exit__(None, None, None)


def test_disconnect_while_typing_sends_idle_for_the_user(tmp_path, monkeypatch, caplog):
    caplog.set_level(logging.INFO)
    app, client = make_client(tmp_path, monkeypatch)
    try:
        room, alice, bob, bob_id, ticket = setup_room(client)
        with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(alice)}") as wa:
            hello(wa)
            with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(bob)}") as wb:
                hello(wb)
                wb.send_text('{"type":"typing","state":"recording"}')
                assert until(wa, "activity")[-1] == {"type": "activity", "user_id": bob_id, "state": "recording"}
            assert until(wa, "activity")[-1] == {"type": "activity", "user_id": bob_id, "state": "idle"}
        assert "rooms activity idle failed" not in caplog.text
    finally:
        client.__exit__(None, None, None)


def test_reactions_are_rate_limited_per_room_and_user(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    try:
        room, alice, bob, bob_id, ticket = setup_room(client)
        rt = rooms_router.runtime(app)
        rt.react_limiter.limit = 1
        with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(alice)}") as wa:
            hello(wa)
            wa.send_text(json.dumps({"type": "say", "client_id": "a1", "text": "hi"}))
            m = last_message(wa)
            wa.send_text(json.dumps({"type": "react", "seq": m["seq"], "key": "wow", "on": True}))
            until(wa, "reaction")
            wa.send_text(json.dumps({"type": "react", "seq": m["seq"], "key": "clap", "on": True}))
            assert until(wa, "error")[-1]["code"] == "rate_limited"
        with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(bob)}") as wb:
            welcome = hello(wb)
        assert welcome["reactions"] == [{"seq": m["seq"], "key": "wow", "user_ids": [m["sender"]["id"]]}]
    finally:
        client.__exit__(None, None, None)


async def test_hub_activity_throttle_and_exclude_user():
    hub = RoomHub()
    a1, a2, b = Conn(1, FakeSender()), Conn(1, FakeSender()), Conn(2, FakeSender())
    for c in (a1, a2, b):
        hub.attach("r", c)
    assert hub.activity_allow(a1, 10.0, 1.0) is True
    assert hub.activity_allow(a1, 10.5, 1.0) is False
    assert hub.activity_allow(a2, 10.5, 1.0) is True  # per connection
    assert hub.activity_allow(a1, 11.0, 1.0) is True
    await hub.broadcast("r", {"type": "pong"}, exclude_user=1)
    assert (a1.sender.sent, a2.sender.sent, b.sender.sent) == ([], [], [{"type": "pong"}])
    hub.last_activity[("r", 1)] = ("typing", 1.0)
    hub.detach("r", a1)
    hub.detach("r", a2)
    hub.detach("r", b)
    hub.forget("r")
    assert hub.last_activity == {} and hub.activity_allow(a1, 11.1, 1.0) is True  # detach cleared the throttle
