"""Contract for the reopen endpoints and the `reopened` event (plan 2026-10-12-rooms-reopen S6).
web/src/features/rooms/rooms-reopen-contract.test.ts reads it. The new room code is a live value: stored as <redacted>."""
import json
import os
from pathlib import Path

from app.rooms.hub import Conn
from app.routers import rooms as rooms_router
from tests.test_rooms_reopen_ws import Recorder
from tests.test_rooms_ws import login, make_client
from tests.test_web_contract import shape

FIXTURE = Path(__file__).parent / "fixtures" / "rooms_reopen_contract.json"


def collect(app, client) -> dict:
    alice, alice_id = login(client, "alice")
    room = client.post("/api/rooms", json={"name": "美食角"}, headers=alice).json()["room"]
    client.post(f"/api/rooms/{room['id']}/close", headers=alice)
    rt = rooms_router.runtime(app)
    client.portal.call(rt.hub.drain)
    http = {"ended": client.get("/api/rooms/ended", headers=alice).json()}
    recorder = Recorder()
    rt.hub.attach(room["id"], Conn(alice_id, recorder))
    http["reopen"] = client.post(f"/api/rooms/{room['id']}/reopen", headers=alice).json()
    http["mine"] = client.get("/api/rooms/mine", headers=alice).json()
    ws = {"reopened": recorder.sent[0], "message_system": recorder.sent[1]}
    for payload in (http["reopen"]["room"], ws["reopened"]["room"]):
        payload["code"] = "<redacted>"
    return {"http": http, "ws": ws}


def test_reopen_payloads_match_the_web_contract(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    try:
        actual = collect(app, client)
    finally:
        client.__exit__(None, None, None)
    if os.environ.get("CONTRACT_UPDATE"):
        FIXTURE.write_text(json.dumps(shape(actual), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    assert shape(actual) == json.loads(FIXTURE.read_text(encoding="utf-8"))
