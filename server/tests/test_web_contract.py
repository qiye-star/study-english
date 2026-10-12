"""Cross-lane contract: the rooms HTTP + WebSocket payloads the web client mirrors (F1).

The real app (test DB, fake LLM) drives one full room session; every response / event is compared by *shape*
(nested key sets) with `fixtures/rooms_contract.json`. The web side reads the same file in
`web/src/features/rooms/rooms-contract.test.ts` and checks its TypeScript mirrors (`protocol.ts`, `rooms-api.ts`)
key-for-key, so a field renamed on either side fails one of the two tests.
Rank has the same pair: `test_rank_api.py` <-> `rank_contract.json` <-> `web/src/features/rank/rank-contract.test.ts`.

Regenerate after an intentional change: `CONTRACT_UPDATE=1 pytest tests/test_web_contract.py` (tickets are redacted).
"""
import json
import os
from dataclasses import replace
from pathlib import Path

import pytest

from app.agents.trace import Done
from tests.test_rooms_agents_api import AGENTS_ON, fake_run_turn
from tests.test_rooms_ws import login, make_client, until

FIXTURE = Path(__file__).parent / "fixtures" / "rooms_contract.json"
LATEST_SEQ = 2_147_483_647  # web rooms-api.ts LATEST_SEQ


def shape(value):
    if isinstance(value, dict):
        return {k: shape(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [shape(value[0])] if value and isinstance(value[0], (dict, list)) else []
    return None


def first(events, type_, kind=None):
    for e in events:
        if e["type"] == type_ and (kind is None or e["message"]["kind"] == kind):
            return e
    raise AssertionError(f"no {type_}/{kind} in {[e['type'] for e in events]}")


def collect(client) -> dict:
    alice, _ = login(client, "alice")
    bob, bob_id = login(client, "bob")
    carol, _ = login(client, "carol")
    http: dict = {"config": client.get("/api/rooms/config", headers=alice).json()}
    http["create"] = client.post("/api/rooms", json={"topic": "美食"}, headers=alice).json()
    room = http["create"]["room"]
    rid = room["id"]
    http["join"] = client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob).json()
    tickets = [client.post(f"/api/rooms/{rid}/ticket", headers=h).json() for h in (alice, bob)]
    http["ticket"] = {**tickets[0], "ticket": "<redacted>"}
    seen: list[dict] = []
    with client.websocket_connect(f"/api/rooms/ws?ticket={tickets[0]['ticket']}") as wa, \
            client.websocket_connect(f"/api/rooms/ws?ticket={tickets[1]['ticket']}") as wb:
        wa.send_text('{"type":"hello","last_seq":0}')
        seen += until(wa, "welcome")
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        wa.send_text('{"type":"assist","request_id":"r1","text":"I like 巧克力"}')
        seen += until(wa, "assist_reply")
        wa.send_text('{"type":"say","client_id":"c1","text":"I like chocolate."}')
        seen += until(wa, "ack")
        wa.send_text('{"type":"say","client_id":"c2","text":"   "}')
        seen += until(wa, "error")
        wb.send_text('{"type":"say","client_id":"q1","text":"@ai what does break the ice mean?"}')
        while not any(e["type"] == "message" and e["message"]["kind"] == "ai_answer" for e in seen):
            seen += until(wa, "message")
        wa.send_text('{"type":"ping"}')
        seen += until(wa, "pong")
        http["patch"] = client.patch(f"/api/rooms/{rid}", json={"ai_public": False}, headers=alice).json()
        seen += until(wa, "room_update")
        wa.send_text('{"type":"say","client_id":"q2","text":"@ai hello?"}')
        seen += until(wa, "notice")
        http["detail"] = client.get(f"/api/rooms/{rid}", headers=alice).json()
        http["messages"] = client.get(f"/api/rooms/{rid}/messages", params={"before_seq": LATEST_SEQ, "limit": 50},
                                      headers=alice).json()
        http["mine"] = client.get("/api/rooms/mine", headers=alice).json()
        bob_msg = next(m for m in http["messages"]["messages"] if m["sender"]["id"] == bob_id and m["kind"] == "text")
        http["report"] = client.post(f"/api/rooms/{rid}/messages/{bob_msg['id']}/report", json={"reason": "spam"},
                                     headers=alice).json()
        client.post("/api/rooms/join", json={"code": room["code"]}, headers=carol)
        http["leave"] = client.post(f"/api/rooms/{rid}/leave", headers=carol).json()
        http["kick"] = client.post(f"/api/rooms/{rid}/kick", json={"user_id": bob_id}, headers=alice).json()
        http["close"] = client.post(f"/api/rooms/{rid}/close", headers=alice).json()
        seen += until(wa, "closed")
    ws = {
        "welcome": first(seen, "welcome"),
        "message_text": first(seen, "message", "text"),
        "message_system": first(seen, "message", "system"),
        "message_ai_answer": first(seen, "message", "ai_answer"),
        "ack": first(seen, "ack"),
        "presence": first(seen, "presence"),
        "ai_typing": first(seen, "ai_typing"),
        "assist_reply": first(seen, "assist_reply"),
        "error": first(seen, "error"),
        "notice": first(seen, "notice"),
        "room_update": first(seen, "room_update"),
        "pong": first(seen, "pong"),
        "closed": first(seen, "closed"),
    }
    return {"http": http, "ws": ws}


async def plain_run_turn(deps, req):
    """The scripted turn without a Chinese note: `meta.note_zh` belongs to rooms_agents_contract.json, so this
    fixture records only the keys every agent answer has (plan R3 ruling)."""
    async for ev in fake_run_turn(deps, req):
        yield replace(ev, note_zh=None) if isinstance(ev, Done) else ev


def test_rooms_payloads_match_the_web_contract(tmp_path, monkeypatch):
    monkeypatch.setattr("app.routers.rooms_agents.run_turn", plain_run_turn)  # `@ai` is the default agent now (D3)
    app, client = make_client(tmp_path, monkeypatch, **AGENTS_ON)
    try:
        actual = collect(client)
    finally:
        client.__exit__(None, None, None)
    assert "<redacted>" in json.dumps(actual) and not any(len(str(v)) > 30 for v in actual["http"]["ticket"].values())
    if os.environ.get("CONTRACT_UPDATE"):
        FIXTURE.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    contract = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert sorted(actual["http"]) == sorted(contract["http"])
    assert sorted(actual["ws"]) == sorted(contract["ws"])
    for group in ("http", "ws"):
        for name, body in actual[group].items():
            assert shape(body) == shape(contract[group][name]), f"{group}.{name} changed shape"
    # Pinned values the web client branches on
    ws = contract["ws"]
    assert ws["message_ai_answer"]["message"]["sender"] == {"kind": "ai", "id": None, "name": None}
    agent_meta = ws["message_ai_answer"]["message"]["meta"]
    assert agent_meta["agent"]["persona_id"] == "builtin:coach" and set(agent_meta) >= {"agent", "asker"}
    assert ws["room_update"]["room"]["my_role"] is None and contract["http"]["create"]["room"]["my_role"] == "owner"
    assert ws["notice"]["code"] == "ai_off" and ws["error"]["code"] == "empty" and ws["closed"]["reason"] == "owner"
    assert ws["assist_reply"]["message"]["lane"] == "private"
    assert set(ws["assist_reply"]["message"]["meta"]) == {"reply_zh", "suggestions", "glossary"}
    # Rooms v2 (spec 2026-10-10 §8–9)
    assert ws["welcome"]["protocol"] == 2 and ws["welcome"]["join_requests"] == []
    assert set(ws["message_text"]["message"]) >= {"quote", "voice", "reactions"}
    assert contract["http"]["config"]["reactions"] == ["like", "love", "haha", "wow", "clap", "thanks"]
    assert {"name", "scenario", "level", "join_mode", "max_members", "allow_voice"} <= set(contract["http"]["create"]["room"])


RANK = json.loads((Path(__file__).parent / "fixtures" / "rank_contract.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("settings_overrides", [{"rank_enabled": True}], indirect=True)
async def test_rank_top_level_payloads_match_the_web_contract(client, auth_headers):
    """test_rank_api.py pins tiers / stage tasks / match / verdict; this adds the remaining objects web reads."""
    config = (await client.get("/api/rank/config", headers=auth_headers)).json()
    assert set(config) == set(RANK["config"])
    if config["season"] is not None:
        assert set(config["season"]) == set(RANK["config"]["season"])
    me = (await client.get("/api/rank/me", params={"tz_offset_minutes": 480}, headers=auth_headers)).json()
    assert set(me["promotion"]) == set(RANK["me"]["promotion"])
    if me["season"] is not None:
        assert set(me["season"]) == set(RANK["me"]["season"])
    for event in me["recent_events"]:
        assert set(event) == set(RANK["me"]["recent_events"][0])
    missing = await client.get("/api/rank/matches/nope", headers=auth_headers)
    assert (missing.status_code, missing.json()) == (404, {"error": "Match not found"})
