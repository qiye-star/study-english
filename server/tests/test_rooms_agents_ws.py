import json

from tests.test_rooms_agents_api import agents_client, room_of  # noqa: F401 (fixture)
from tests.test_rooms_ws import until


def until_answer(ws):
    """Frames up to and including the next public ai_answer message (system/presence frames in between)."""
    events = []
    while True:
        events += until(ws, "message")
        if events[-1]["message"]["kind"] == "ai_answer":
            return events


def test_member_asks_an_agent_and_only_the_asker_sees_the_process(agents_client):
    app, client = agents_client
    room, alice, _, bob, _ = room_of(client)
    client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach"]}, headers=alice)
    name = client.get(f"/api/rooms/{room['id']}/agents", headers=alice).json()["agents"][0]["name"]

    def ticket(headers):
        return client.post(f"/api/rooms/{room['id']}/ticket", headers=headers).json()["ticket"]

    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(alice)}") as wa, \
            client.websocket_connect(f"/api/rooms/ws?ticket={ticket(bob)}") as wb:
        wa.send_text('{"type":"hello","last_seq":0}')
        until(wa, "welcome")
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        wb.send_text(json.dumps({"type": "say", "client_id": "q", "text": f"@{name} can I use abandon here?"}))
        bob_events = until_answer(wb)
        alice_events = until_answer(wa)
        assert [e["type"] for e in bob_events if e["type"].startswith("agent_")] == ["agent_step", "agent_thought"]
        assert not any(e["type"].startswith("agent_") for e in alice_events)
        answer = alice_events[-1]["message"]
        assert answer["meta"]["agent"]["persona_id"] == "builtin:coach"
        assert answer["meta"]["asker"]["name"] == "bob"
        trace = until(wb, "message")[-1]["message"]
        assert (trace["lane"], trace["kind"], trace["reply_to"]) == ("private", "agent_trace", answer["seq"])
