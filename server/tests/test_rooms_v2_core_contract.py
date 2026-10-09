"""Contract for rooms v2 core endpoints (lane SC). web/src/features/rooms/create/rooms-v2-contract.test.ts reads it.
Invite tokens are secrets (R2-5): the fixture stores them as `<redacted>`."""
import json
import os
from pathlib import Path

from tests.test_rooms_ws import login, make_client, until
from tests.test_web_contract import shape

FIXTURE = Path(__file__).parent / "fixtures" / "rooms_v2_core_contract.json"


def message_with(ws, text):
    """The `message` event carrying `text` (the welcome replay and system messages come first)."""
    while True:
        events = [e for e in until(ws, "message") if e["type"] == "message"]
        if events and events[-1]["message"]["text"] == text:
            return events[-1]


def collect(client) -> dict:
    alice, _ = login(client, "alice")
    bob, _ = login(client, "bob")
    carol, _ = login(client, "carol")
    http: dict = {"create": client.post("/api/rooms", json={"join_mode": "approval", "scenario": "cafe"},
                                        headers=alice).json()}
    rid, code = http["create"]["room"]["id"], http["create"]["room"]["code"]
    http["patch"] = client.patch(f"/api/rooms/{rid}", json={"level": "B1"}, headers=alice).json()
    ticket = client.post(f"/api/rooms/{rid}/ticket", headers=alice).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wa:
        wa.send_text('{"type":"hello","last_seq":0,"v":2}')
        until(wa, "welcome")
        http["join_pending"] = client.post("/api/rooms/join", json={"code": code}, headers=bob).json()
        req_id = http["join_pending"]["request"]["id"]
        ws = {"join_request": until(wa, "join_request")[-1]}
        http["request"] = client.get(f"/api/rooms/requests/{req_id}", headers=bob).json()
        http["requests"] = client.get(f"/api/rooms/{rid}/requests", headers=alice).json()
        http["approve"] = client.post(f"/api/rooms/{rid}/requests/{req_id}/approve", headers=alice).json()
        ws["join_request_closed"] = until(wa, "join_request_closed")[-1]
        http["invite"] = client.post(f"/api/rooms/{rid}/invite", headers=alice).json()
        token = http["invite"]["token"]
        http["invite_preview"] = client.get(f"/api/rooms/invite/{token}", headers=carol).json()
        http["invite_join"] = client.post(f"/api/rooms/invite/{token}/join", headers=carol).json()
        wa.send_text('{"type":"say","client_id":"a1","text":"hello"}')
        first = message_with(wa, "hello")["message"]
        wa.send_text(json.dumps({"type": "say", "client_id": "a2", "text": "again", "reply_to": first["seq"]}))
        ws["message_quote"] = message_with(wa, "again")
        wa.send_text(json.dumps({"type": "react", "seq": first["seq"], "key": "like", "on": True}))
        ws["reaction"] = until(wa, "reaction")[-1]
    http["invite"] = {"token": "<redacted>", "path": "/rooms/invite/<redacted>"}
    return {"http": http, "ws": ws}


def test_rooms_v2_core_payloads_match_the_web_contract(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    try:
        actual = collect(client)
    finally:
        client.__exit__(None, None, None)
    if os.environ.get("CONTRACT_UPDATE"):
        FIXTURE.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    contract = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for group in ("http", "ws"):
        assert sorted(actual[group]) == sorted(contract[group])
        for name, body in actual[group].items():
            assert shape(body) == shape(contract[group][name]), f"{group}.{name} changed shape"
    assert contract["http"]["join_pending"]["request"]["status"] == "pending"
    assert contract["http"]["approve"]["request"]["status"] == "approved"
    assert contract["ws"]["reaction"]["key"] == "like"
    assert contract["ws"]["message_quote"]["message"]["quote"]["text"] == "hello"
    assert contract["http"]["invite"] == {"token": "<redacted>", "path": "/rooms/invite/<redacted>"}
    assert "ticket" not in json.dumps(contract)
