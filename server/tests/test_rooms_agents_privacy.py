"""caplog guard for every room-agents path (spec §11.5): no user text, replies, prompts, persona names, words or
tickets in any log record of the app, plus the privacy of the process frames (only the asker gets them) — success,
failure, report and selection. Scoped to logger `app` (aiosqlite's DEBUG logs print SQL parameters)."""
import json
import logging

from app.providers.llm import LlmUnavailable
from tests.test_rooms_agents_api import U1, add_persona, agents_client, room_of  # noqa: F401 (fixture)
from tests.test_rooms_agents_ws import until_answer
from tests.test_rooms_ws import until

SECRETS = ("SECRET-Q-7731", "SECRET-P-4410", "SECRET-N", "abandon")


def app_log_text(caplog) -> str:
    return "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("app"))


def test_room_agent_paths_log_no_text(agents_client, caplog, monkeypatch):
    app, client = agents_client
    caplog.set_level(logging.DEBUG, logger="app")
    room, alice, alice_id, bob, _ = room_of(client)
    add_persona(app, client, alice_id, name="SECRET-N", prompt="SECRET-P-4410")
    client.patch(f"/api/rooms/{room['id']}", json={"agents": [U1]}, headers=alice)
    assert client.get(f"/api/rooms/{room['id']}/agents", headers=bob).json()["agents"][0]["prompt"] is None
    ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=bob).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wb:
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        wb.send_text(json.dumps({"type": "say", "client_id": "q", "text": "@SECRET-N SECRET-Q-7731 abandon?"}))
        until_answer(wb)

        async def broken(deps, req):
            raise LlmUnavailable("http")
            yield  # an async generator

        monkeypatch.setattr(app.state.rooms.agents.deps, "run_turn", broken)
        wb.send_text(json.dumps({"type": "say", "client_id": "q2", "text": "@SECRET-N SECRET-Q-7731 again"}))
        until(wb, "ai_failed")
    client.post(f"/api/rooms/{room['id']}/agents/{U1}/report", json={"reason": "offensive"}, headers=bob)
    text = app_log_text(caplog)
    for secret in (*SECRETS, ticket):
        assert secret not in text, secret


def test_process_frames_and_traces_reach_the_asker_only(agents_client):
    """Two sockets: the asker gets agent_step / agent_thought and the private trace row; the other member gets
    none of it, live or in a later replay (welcome with last_seq=0)."""
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
        wb.send_text(json.dumps({"type": "say", "client_id": "q", "text": f"@{name} hello?"}))
        until_answer(wb)
        until_answer(wa)
        until(wb, "message")  # bob's private agent_trace row
    # a fresh connection of alice replays everything she may see: the question and the answer, no trace, no process
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(alice)}") as wa2:
        wa2.send_text('{"type":"hello","last_seq":0}')
        wa2.send_text('{"type":"ping"}')
        frames = until(wa2, "pong")  # welcome, then the replay, then the pong (frames are handled in order)
    kinds = []
    for frame in frames:
        if frame["type"] in ("welcome", "pong"):
            continue
        assert not frame["type"].startswith("agent_")
        kinds.append(frame["message"]["kind"])
    assert "agent_trace" not in kinds
    # and bob's replay does include his own trace
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(bob)}") as wb2:
        wb2.send_text('{"type":"hello","last_seq":0}')
        wb2.send_text('{"type":"ping"}')
        replay = until(wb2, "pong")
    assert any(f["type"] == "message" and f["message"]["kind"] == "agent_trace" for f in replay)
