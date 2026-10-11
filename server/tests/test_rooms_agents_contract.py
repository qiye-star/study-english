"""Pins the room-agents payloads the web reads (web/src/features/rooms/agents/room-agents-contract.test.ts).
Regenerate after an intentional change: `CONTRACT_UPDATE=1 uv run pytest -q tests/test_rooms_agents_contract.py`.
Values are recorded as-is (ids and times vary); the comparison is by shape."""
import json
import os
from pathlib import Path

from tests.test_rooms_agents_api import agents_client, room_of  # noqa: F401 (fixture)
from tests.test_rooms_agents_ws import until_answer
from tests.test_rooms_ws import until

FIXTURE = Path(__file__).parent / "fixtures" / "rooms_agents_contract.json"


def shape(value):
    if isinstance(value, dict):
        return {k: shape(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [shape(value[0])] if value else []
    return type(value).__name__


def record(client) -> dict:
    room, alice, _, bob, _ = room_of(client)
    patch = client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach"]}, headers=alice).json()
    agents = client.get(f"/api/rooms/{room['id']}/agents", headers=bob).json()
    name = agents["agents"][0]["name"]
    ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=bob).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wb:
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        wb.send_text(json.dumps({"type": "say", "client_id": "q", "text": f"@{name} can I use abandon here?"}))
        events = until_answer(wb)
        trace = until(wb, "message")[-1]
    first = {e["type"]: e for e in reversed(events)}
    return {"http": {"patch": patch, "agents": agents},
            "ws": {"agent_step": first["agent_step"], "agent_thought": first["agent_thought"],
                   "message_agent_answer": events[-1], "message_agent_trace": trace}}


def test_room_agents_payloads_match_the_web_contract(agents_client):
    _app, client = agents_client
    got = record(client)
    if os.environ.get("CONTRACT_UPDATE"):
        FIXTURE.write_text(json.dumps(got, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    assert shape(json.loads(FIXTURE.read_text(encoding="utf-8"))) == shape(got)
