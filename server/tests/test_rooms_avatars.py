"""Room payloads carry `avatar_url` (plan S8, R-V8, INDEX X29): members, the welcome and presence frames, message senders
and join requests. The field is additive: `PROTOCOL_VERSION` stays 2. The avatar id is written straight into the DB here
(the upload endpoint has its own tests); the payloads only ever carry the public path, or null without an avatar.
AI and system senders always carry null, even when their row has a sender id."""
from datetime import datetime, timezone

from sqlalchemy import update

from app.models import RoomMessage, User
from app.rooms.store import message_out
from tests.test_rooms_display_name import hello_and_say, history
from tests.test_rooms_ws import login, make_client, rooms_client, until  # noqa: F401 (fixture)

AVATAR = "0" * 31 + "a"  # a placeholder 32-digit id; the payloads never check that a file exists
PATH = f"/api/avatars/{AVATAR}"


def set_avatar(client, user_id: int, avatar_id: str | None) -> None:
    async def go():
        async with client.app.state.sessionmaker() as s:
            await s.execute(update(User).where(User.id == user_id).values(avatar_id=avatar_id))
            await s.commit()
    client.portal.call(go)


def say_live(client, alice, bob, room_id: str, text: str) -> dict:
    """Alice listens on her socket while bob says `text`; returns the live `message` event alice receives."""
    ticket = client.post(f"/api/rooms/{room_id}/ticket", headers=alice).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as listener:
        listener.send_text('{"type":"hello","last_seq":0}')
        until(listener, "welcome")
        hello_and_say(client, bob, room_id, text, "live-1")
        events = until(listener, "message")
        while events[-1]["message"].get("text") != text:
            events = until(listener, "message")
    return events[-1]["message"]


def test_member_list_carries_avatar_url_or_null(rooms_client):
    app, client = rooms_client
    alice, alice_id = login(client, "alice")
    bob, bob_id = login(client, "bob")
    set_avatar(client, alice_id, AVATAR)
    room = client.post("/api/rooms", json={"topic": "美食"}, headers=alice).json()["room"]
    client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    detail = client.get(f"/api/rooms/{room['id']}", headers=bob).json()
    by_name = {m["name"]: m for m in detail["members"]}
    assert by_name["alice"]["avatar_url"] == PATH
    assert by_name["bob"]["avatar_url"] is None
    assert set(by_name["alice"]) == {"user_id", "name", "role", "online", "avatar_url"}  # additive, nothing renamed


def test_welcome_and_presence_members_carry_avatar_url(rooms_client):
    app, client = rooms_client
    alice, alice_id = login(client, "alice")
    bob, _ = login(client, "bob")
    set_avatar(client, alice_id, AVATAR)
    room = client.post("/api/rooms", json={"topic": "美食"}, headers=alice).json()["room"]
    client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=alice).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as ws:
        ws.send_text('{"type":"hello","last_seq":0}')
        welcome = until(ws, "welcome")[-1]
        assert {m["name"]: m["avatar_url"] for m in welcome["members"]} == {"alice": PATH, "bob": None}
        bob_ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=bob).json()["ticket"]
        with client.websocket_connect(f"/api/rooms/ws?ticket={bob_ticket}") as bws:
            bws.send_text('{"type":"hello","last_seq":0}')
            until(bws, "welcome")
            presence = until(ws, "presence")[-1]
    assert {m["name"]: m["avatar_url"] for m in presence["members"]} == {"alice": PATH, "bob": None}


def test_message_sender_carries_avatar_url_in_history_and_live(rooms_client):
    app, client = rooms_client
    alice, alice_id = login(client, "alice")
    bob, bob_id = login(client, "bob")
    set_avatar(client, bob_id, AVATAR)
    room = client.post("/api/rooms", json={"topic": "美食"}, headers=alice).json()["room"]
    client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    live = say_live(client, alice, bob, room["id"], "hello there")
    assert live["sender"]["id"] == bob_id and live["sender"]["avatar_url"] == PATH
    says = [m for m in history(client, room["id"], alice) if m["kind"] == "text"]
    assert [(m["sender"]["name"], m["sender"]["avatar_url"]) for m in says] == [("bob", PATH)]


def test_system_senders_carry_null_avatar_url(rooms_client):
    app, client = rooms_client
    alice, alice_id = login(client, "alice")
    bob, _ = login(client, "bob")
    set_avatar(client, alice_id, AVATAR)
    room = client.post("/api/rooms", json={"topic": "美食"}, headers=alice).json()["room"]
    client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    msgs = history(client, room["id"], alice)
    joined = [m for m in msgs if m["kind"] == "system" and m["text"] == "joined"]
    assert joined and joined[-1]["sender"]["avatar_url"] is None  # system rows never show an avatar


def test_ai_and_system_rows_never_show_an_avatar_even_with_a_sender_id():
    """message_out only attaches an avatar to member messages; the row's sender id alone is not enough."""
    now = datetime(2026, 10, 19, tzinfo=timezone.utc)

    def row(kind: str, sender_kind: str, sender_id: int | None) -> RoomMessage:
        return RoomMessage(id="m" + kind, seq=1, lane="public", kind=kind, sender_kind=sender_kind,
                           sender_id=sender_id, text="x", assisted=False, reply_to=None, ai_status=None,
                           meta={}, created_at=now, hidden_at=None)

    assert message_out(row("text", "user", 7), "bob", avatar_id=AVATAR)["sender"]["avatar_url"] == PATH
    assert message_out(row("ai_answer", "ai", 7), "bob", avatar_id=AVATAR)["sender"]["avatar_url"] is None
    assert message_out(row("system", "system", None), None, avatar_id=AVATAR)["sender"]["avatar_url"] is None


def test_join_requests_carry_avatar_url(rooms_client):
    app, client = rooms_client
    alice, _ = login(client, "alice")
    bob, bob_id = login(client, "bob")
    carol, _ = login(client, "carol")
    set_avatar(client, bob_id, AVATAR)
    room = client.post("/api/rooms", json={"join_mode": "approval"}, headers=alice).json()["room"]
    client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    client.post("/api/rooms/join", json={"code": room["code"]}, headers=carol)
    requests = client.get(f"/api/rooms/{room['id']}/requests", headers=alice).json()["requests"]
    assert {r["name"]: r["avatar_url"] for r in requests} == {"bob": PATH, "carol": None}


def test_avatar_url_still_flows_when_uploads_are_switched_off(tmp_path, monkeypatch):
    """R-V3: the switch only gates uploads and reads; a stored avatar keeps its path in the payload."""
    app, client = make_client(tmp_path, monkeypatch, avatar_upload_enabled=False)
    try:
        alice, alice_id = login(client, "alice")
        bob, _ = login(client, "bob")
        set_avatar(client, alice_id, AVATAR)
        room = client.post("/api/rooms", json={"topic": "美食"}, headers=alice).json()["room"]
        client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
        detail = client.get(f"/api/rooms/{room['id']}", headers=bob).json()
        assert {m["name"]: m["avatar_url"] for m in detail["members"]} == {"alice": PATH, "bob": None}
    finally:
        client.__exit__(None, None, None)

