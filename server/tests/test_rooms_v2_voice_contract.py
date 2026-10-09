"""Contract for room voice messages (lane SV). The web voice lane (WV1) reads
`fixtures/rooms_v2_voice_contract.json`; regenerate with CONTRACT_UPDATE=1. No tickets, no audio bytes."""
import json
import os
from pathlib import Path

from tests.test_rooms_voice_api import _client, _upload
from tests.test_rooms_ws import login, until
from tests.test_web_contract import shape

FIXTURE = Path(__file__).parent / "fixtures" / "rooms_v2_voice_contract.json"


def voice_message(ws) -> dict:
    """The `message` event of the voice message (the welcome replay and `joined` system messages come first)."""
    while True:
        events = [e for e in until(ws, "message") if e["type"] == "message"]
        if events and events[-1]["message"]["kind"] == "voice":
            return events[-1]


def voice_update(ws, done_key: str) -> dict:
    while True:
        update = until(ws, "voice_update")[-1]
        if update["voice"][done_key] == "done":
            return update


def collect(client, rt) -> dict:
    async def complete(messages, max_tokens, temperature):
        return "大家好。"

    rt.voice.deps.complete = complete
    alice, _ = login(client, "alice")
    bob, _ = login(client, "bob")
    room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
    client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=bob).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wb:
        wb.send_text('{"type":"hello","last_seq":0,"v":2}')
        until(wb, "welcome")
        http = {"upload": _upload(client, room["id"], alice).json()}
        ws = {"message_voice": voice_message(wb), "voice_update_transcript": voice_update(wb, "status")}
        wb.send_text(json.dumps({"type": "voice_translate", "seq": http["upload"]["seq"]}))
        ws["voice_update_translation"] = voice_update(wb, "translation_status")
    return {"http": http, "ws": ws}


def test_rooms_v2_voice_payloads_match_the_web_contract(tmp_path, monkeypatch):
    app, client, rt = _client(tmp_path, monkeypatch)
    try:
        actual = collect(client, rt)
    finally:
        client.__exit__(None, None, None)
    if os.environ.get("CONTRACT_UPDATE"):
        FIXTURE.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    contract = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for group in ("http", "ws"):
        assert sorted(actual[group]) == sorted(contract[group])
        for name, body in actual[group].items():
            assert shape(body) == shape(contract[group][name]), f"{group}.{name} changed shape"
    assert contract["http"]["upload"]["message"]["voice"]["status"] == "pending"
    assert contract["ws"]["message_voice"]["message"]["kind"] == "voice"
    assert contract["ws"]["voice_update_transcript"]["voice"]["status"] == "done"
    assert contract["ws"]["voice_update_translation"]["voice"]["translation_status"] == "done"
    assert "ticket" not in json.dumps(contract)
