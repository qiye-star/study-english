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


def _open(client, room, headers):
    ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=headers).json()["ticket"]
    ws = client.websocket_connect(f"/api/rooms/ws?ticket={ticket}")
    return ws


def test_the_alias_replies_and_say_to_reach_agents_without_a_mention(agents_client):
    app, client = agents_client
    room, alice, _, bob, _ = room_of(client)
    with _open(client, room, bob) as wb:
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        # no agents configured: `@ai` is the built-in coach (R-AS5)
        wb.send_text(json.dumps({"type": "say", "client_id": "q0", "text": "@ai what is a latte?"}))
        first = until_answer(wb)[-1]["message"]
        assert first["meta"]["agent"]["persona_id"] == "builtin:coach" and first["meta"]["note_zh"]
        # a reply to the agent's answer needs no `@`
        wb.send_text(json.dumps({"type": "say", "client_id": "q1", "text": "and in the past tense?",
                                 "reply_to": first["seq"]}))
        second = until_answer(wb)[-1]["message"]
        assert second["meta"]["agent"]["persona_id"] == "builtin:coach" and second["seq"] > first["seq"]
        # `to` must belong to the room's agents: with none configured it is refused, the message is still published
        wb.send_text(json.dumps({"type": "say", "client_id": "q2", "text": "just checking", "to": "builtin:coach"}))
        assert until(wb, "notice")[-1] == {"type": "notice", "code": "agent_off"}
        until(wb, "ack")  # the message is published after the notice; do not close the socket before it is stored
        last_seq = until(wb, "message")[-1]["message"]["seq"]
    client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach"]}, headers=alice)
    with _open(client, room, bob) as wb:
        wb.send_text(json.dumps({"type": "hello", "last_seq": last_seq + 1}))  # no replay of the old answers
        until(wb, "welcome")
        wb.send_text(json.dumps({"type": "say", "client_id": "q3", "text": "talking to you", "to": "builtin:coach"}))
        third = until_answer(wb)[-1]["message"]
        assert third["meta"]["agent"]["persona_id"] == "builtin:coach"
    history = client.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": 2_147_483_647}, headers=bob).json()
    sent = next(m for m in history["messages"] if m["text"] == "talking to you")
    assert sent["meta"] == {"to_agent": "builtin:coach"} and sent["ai_status"] == "done"  # R-AS19, and replay carries it
    plain = next(m for m in history["messages"] if m["text"] == "just checking")
    assert plain["meta"] is None and plain["ai_status"] is None


def test_the_agents_endpoint_keeps_its_shape(agents_client):
    """R-AS18: the web pins these keys exactly; the default agent is derived from `agent_ids[0]`."""
    app, client = agents_client
    room, alice, _, bob, _ = room_of(client)
    patched = client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach"]}, headers=alice).json()
    body = client.get(f"/api/rooms/{room['id']}/agents", headers=bob).json()
    assert sorted(body) == ["agents", "available", "tutor"] and patched["room"]["agent_ids"] == ["builtin:coach"]
