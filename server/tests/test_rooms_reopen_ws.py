import json
from pathlib import Path

from app.rooms.hub import Conn
from app.routers import rooms as rooms_router
from tests.test_rooms_ws import login, rooms_client, until  # noqa: F401  (rooms_client is a fixture)


class Recorder:
    """A hub connection that just records frames (nobody can be on a socket of an ended room, R-O3)."""

    def __init__(self):
        self.sent: list[dict] = []

    async def send_json(self, data):
        self.sent.append(data)

    async def close(self, code):
        pass


def test_reopen_broadcasts_reopened_and_the_room_accepts_sockets_again(rooms_client):
    app, client = rooms_client
    alice, alice_id = login(client, "alice")
    room = client.post("/api/rooms", json={"name": "美食角"}, headers=alice).json()["room"]
    assert client.post(f"/api/rooms/{room['id']}/close", headers=alice).status_code == 200
    rt = rooms_router.runtime(app)
    client.portal.call(rt.hub.drain)
    seen = Recorder()
    assert rt.hub.attach(room["id"], Conn(alice_id, seen))
    reopened = client.post(f"/api/rooms/{room['id']}/reopen", headers=alice).json()["room"]
    assert [e["type"] for e in seen.sent] == ["reopened", "message"]
    event = seen.sent[0]
    assert event["room"]["id"] == room["id"] and event["room"]["status"] == "open" and event["room"]["code"] == reopened["code"]
    assert event["room"]["my_role"] is None and seen.sent[1]["message"]["text"] == "reopened"
    ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=alice).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as ws:
        ws.send_text('{"type":"hello","last_seq":0,"v":2}')
        welcome = until(ws, "welcome")[-1]
        assert welcome["room"]["status"] == "open" and welcome["room"]["code"] == reopened["code"]
