"""Rooms show the display name (nickname, else login name) to other people (plan S7, INDEX X6 / X34).

The nickname is written straight into the DB here: the nickname endpoint lands on another branch (S6).
"""
import json

from sqlalchemy import update

from app.models import User
from app.rooms.summary_store import SummaryStore
from tests.test_rooms_agents_api import agents_client, room_of  # noqa: F401 (fixture)
from tests.test_rooms_agents_ws import until_answer
from tests.test_rooms_voice_api import _client, _upload  # noqa: F401 (helper)
from tests.test_rooms_ws import login, rooms_client, until  # noqa: F401 (fixture)


def set_nickname(client, user_id: int, nickname: str | None) -> None:
    async def go():
        async with client.app.state.sessionmaker() as s:
            await s.execute(update(User).where(User.id == user_id).values(nickname=nickname))
            await s.commit()
    client.portal.call(go)


def hello_and_say(client, headers, room_id: str, text: str, client_id: str) -> None:
    ticket = client.post(f"/api/rooms/{room_id}/ticket", headers=headers).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as ws:
        ws.send_text('{"type":"hello","last_seq":0}')
        until(ws, "welcome")
        ws.send_text(json.dumps({"type": "say", "client_id": client_id, "text": text}))
        sent = until(ws, "message")  # wait for the saved message: the socket must stay open until the server stored it
        while sent[-1]["message"].get("text") != text:
            sent = until(ws, "message")


def history(client, room_id: str, headers) -> list[dict]:
    return client.get(f"/api/rooms/{room_id}/messages", params={"before_seq": 100}, headers=headers).json()["messages"]


def test_members_show_nickname_or_username(rooms_client):
    app, client = rooms_client
    alice, alice_id = login(client, "alice")
    bob, bob_id = login(client, "bob")
    set_nickname(client, alice_id, "小明")
    room = client.post("/api/rooms", json={"topic": "美食"}, headers=alice).json()["room"]
    client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    detail = client.get(f"/api/rooms/{room['id']}", headers=bob).json()
    assert [m["name"] for m in detail["members"]] == ["小明", "bob"]


def test_message_sender_and_join_request_use_nickname(rooms_client):
    app, client = rooms_client
    alice, _ = login(client, "alice")
    bob, bob_id = login(client, "bob")
    carol, carol_id = login(client, "carol")
    set_nickname(client, bob_id, "小红")
    set_nickname(client, carol_id, "小绿")
    room = client.post("/api/rooms", json={"join_mode": "approval"}, headers=alice).json()["room"]
    client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)  # approval: a pending request
    client.post("/api/rooms/join", json={"code": room["code"]}, headers=carol)
    requests = client.get(f"/api/rooms/{room['id']}/requests", headers=alice).json()["requests"]
    assert sorted((r["user_id"], r["name"]) for r in requests) == sorted([(bob_id, "小红"), (carol_id, "小绿")])
    for r in requests:
        assert client.post(f"/api/rooms/{room['id']}/requests/{r['id']}/approve", headers=alice).status_code == 200
    hello_and_say(client, bob, room["id"], "hello", "b1")
    says = [m for m in history(client, room["id"], alice) if m["kind"] == "text"]
    assert [(m["sender"]["id"], m["sender"]["name"]) for m in says] == [(bob_id, "小红")]


def test_system_messages_snapshot_the_nickname(rooms_client):
    app, client = rooms_client
    alice, _ = login(client, "alice")
    bob, bob_id = login(client, "bob")
    set_nickname(client, bob_id, "小红")
    room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
    client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    hello_and_say(client, bob, room["id"], "hello", "b1")
    set_nickname(client, bob_id, "小蓝")
    msgs = history(client, room["id"], alice)
    joined = [m for m in msgs if m["kind"] == "system" and m["text"] == "joined"]
    assert joined and joined[-1]["meta"] == {"name": "小红"}  # the snapshot taken when bob joined
    says = [m for m in msgs if m["kind"] == "text"]
    assert says[-1]["sender"]["name"] == "小蓝"  # the sender's name is read live
    assert client.post(f"/api/rooms/{room['id']}/kick", json={"user_id": bob_id}, headers=alice).status_code == 200
    kicked = [m for m in history(client, room["id"], alice) if m["kind"] == "system" and m["text"] == "kicked"]
    assert kicked[-1]["meta"] == {"name": "小蓝"}


def test_default_room_name_uses_display_name(rooms_client):
    app, client = rooms_client
    alice, alice_id = login(client, "alice")
    set_nickname(client, alice_id, "小明")
    room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
    assert room["name"] == "小明的房间"


def test_summary_lines_use_display_name(rooms_client):
    app, client = rooms_client
    alice, alice_id = login(client, "alice")
    bob, bob_id = login(client, "bob")
    set_nickname(client, bob_id, "小红")
    room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
    client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    hello_and_say(client, bob, room["id"], "I like tea.", "b1")

    async def lines():
        return await SummaryStore(app.state.sessionmaker).lines(room["id"], 10)

    found = client.portal.call(lines)
    assert [(line.sender_id, line.name) for line in found] == [(bob_id, "小红")]


def test_voice_message_sender_name_is_display_name(tmp_path, monkeypatch):
    app, client, _rt = _client(tmp_path, monkeypatch)
    try:
        alice, alice_id = login(client, "alice")
        set_nickname(client, alice_id, "小明")
        room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        r = _upload(client, room["id"], alice)
        assert r.status_code == 200, r.text
        assert r.json()["message"]["sender"]["name"] == "小明"
        mid = r.json()["message"]["id"]
        voices = [m for m in history(client, room["id"], alice) if m["id"] == mid]
        assert voices[0]["sender"]["name"] == "小明"
    finally:
        client.__exit__(None, None, None)


def test_agent_asker_name_is_display_name(agents_client):
    app, client = agents_client
    room, alice, _alice_id, bob, bob_id = room_of(client)
    set_nickname(client, bob_id, "小红")
    client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach"]}, headers=alice)
    name = client.get(f"/api/rooms/{room['id']}/agents", headers=alice).json()["agents"][0]["name"]
    ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=alice).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wa:
        wa.send_text('{"type":"hello","last_seq":0}')
        until(wa, "welcome")
        bob_ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=bob).json()["ticket"]
        with client.websocket_connect(f"/api/rooms/ws?ticket={bob_ticket}") as wb:
            wb.send_text('{"type":"hello","last_seq":0}')
            until(wb, "welcome")
            wb.send_text(json.dumps({"type": "say", "client_id": "q", "text": f"@{name} can I use abandon here?"}))
            answer = until_answer(wa)[-1]["message"]
    assert answer["meta"]["asker"]["name"] == "小红"
