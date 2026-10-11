import json

import pytest

from app.providers import llm
from tests.test_rooms_agents_api import AGENTS_ON, agents_client, room_of  # noqa: F401 (fixture)
from tests.test_rooms_ws import make_client, until


def until_waiting(ws):
    events = []
    while True:
        events += until(ws, "agent_tutor")
        if events[-1]["tutor"] and events[-1]["tutor"]["phase"] == "await_answer":
            return events


def test_owner_runs_the_room_tutor_and_reconnects_see_it(agents_client):
    app, client = agents_client
    room, alice, alice_id, bob, _ = room_of(client)
    base = f"/api/rooms/{room['id']}"
    client.patch(base, json={"agents": ["builtin:coach"]}, headers=alice)

    def ticket(headers):
        return client.post(f"{base}/ticket", headers=headers).json()["ticket"]

    body = {"persona_id": "builtin:coach", "steps": 3}
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(alice)}") as wa, \
            client.websocket_connect(f"/api/rooms/ws?ticket={ticket(bob)}") as wb:
        wa.send_text('{"type":"hello","last_seq":0}')
        until(wa, "welcome")
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        assert client.post(f"{base}/agents/tutor/start", json=body, headers=bob).json() == {
            "error": "Only the owner can do that"}
        started = client.post(f"{base}/agents/tutor/start", json=body, headers=alice)
        assert started.status_code == 200 and started.json()["tutor"]["steps_total"] == 3
        assert until_waiting(wb)[-1]["tutor"]["current_user_id"] == alice_id
        assert client.post(f"{base}/agents/tutor/start", json=body, headers=alice).json() == {
            "error": "Room tutor is running"}
        assert client.get(f"{base}/agents", headers=bob).json()["tutor"]["phase"] == "await_answer"
        assert client.post(f"{base}/agents/tutor/skip", headers=bob).status_code == 403
        assert client.patch(base, json={"agents": []}, headers=alice).json() == {"error": "Room tutor is running"}
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(bob)}") as wb2:
        wb2.send_text('{"type":"hello","last_seq":0}')
        events = until(wb2, "agent_tutor")  # right after welcome and the replay (R-RA8)
        assert any(e["type"] == "welcome" for e in events) and events[-1]["tutor"]["phase"] == "await_answer"
        assert client.post(f"{base}/agents/tutor/stop", headers=alice).json() == {"ok": True}
        assert until(wb2, "agent_tutor")[-1]["tutor"] is None
    assert client.post(f"{base}/agents/tutor/resume", headers=alice).json() == {"error": "Room tutor is not paused"}
    assert client.post(f"{base}/agents/tutor/start", json={"persona_id": "builtin:coach", "steps": 2},
                       headers=alice).status_code == 422


@pytest.fixture
def real_client(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch, **AGENTS_ON)  # the real run_turn (no agents_client patch)
    yield app, client
    client.__exit__(None, None, None)


def test_the_real_orchestrator_drives_a_room_turn_with_a_faked_llm_stream(real_client, monkeypatch):
    """No fake `run_turn`: A1's orchestrator and A3's mode block run, only the upstream stream is faked."""
    app, client = real_client
    prompts: list[str] = []

    async def fake_stream(http, settings, messages, **kwargs):
        prompts.append(json.dumps(messages, ensure_ascii=False))
        for chunk in ("Welcome ", "everyone! alice, how was your day?\n<<MET", 'A>>{"verdict":null,"kind":"ask"}'):
            yield llm.Delta(kind="text", text=chunk)

    monkeypatch.setattr("app.providers.llm.complete_stream", fake_stream)
    room, alice, _, bob, bob_id = room_of(client)
    base = f"/api/rooms/{room['id']}"
    client.patch(base, json={"agents": ["builtin:coach"]}, headers=alice)
    ticket = client.post(f"{base}/ticket", headers=bob).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wb:
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        started = client.post(f"{base}/agents/tutor/start", json={"persona_id": "builtin:coach", "steps": 3},
                              headers=alice)
        assert started.status_code == 200, started.text
        waiting = until_waiting(wb)
        question = [e["message"] for e in waiting if e["type"] == "message" and e["message"]["kind"] == "ai_answer"][-1]
    assert question["text"] == "Welcome everyone! alice, how was your day?"  # the META line never reaches the room
    assert question["meta"]["tutor"]["to_user_id"] == bob_id  # only bob is online and "<tutor_mode>" in prompts[0]
    assert "<room_tutor>" in prompts[0]
    client.post(f"{base}/agents/tutor/stop", headers=alice)
