from datetime import datetime, timezone

import pytest

from app.agents.trace import Delta, Done, Meta, Step, Thought
from app.models import AgentPersona
from tests.test_rooms_ws import login, make_client

U1 = "0b6c1f3e-2a4d-4c5e-9f00-1234567890ab"
NOW = datetime(2026, 10, 12, 9, tzinfo=timezone.utc)
LATEST = 2_147_483_647
AGENTS_ON = {"agents_enabled": True, "agents_rooms_enabled": True, "agents_tutor_enabled": True}


async def fake_run_turn(deps, req):
    """Stands in for app.agents.orchestrator.run_turn (patched where rooms_agents looks it up)."""
    if req.mode == "tutor":
        yield Delta(text="Welcome! alice, tell me about your weekend.")
        yield Meta(step_index=1, steps_total=8, verdict="ok", kind="ask", done=False)
        return
    yield Step(id="s1", group="context", key="learned_words", status="done", label_key="agents.step.learned_words",
               params={"count": 6}, ms=12, private=True)
    yield Thought(source="summary", text="look up abandon")
    yield Delta(text="Sure, try: I never abandon a project halfway.")
    yield Done(usage=None, trace={"steps": [{"key": "learned_words", "status": "done"}]}, text_len=44)


@pytest.fixture
def agents_client(tmp_path, monkeypatch):
    monkeypatch.setattr("app.routers.rooms_agents.run_turn", fake_run_turn)
    app, client = make_client(tmp_path, monkeypatch, **AGENTS_ON)
    yield app, client
    client.__exit__(None, None, None)


def add_persona(app, client, owner_id, **over):
    fields = {"id": U1, "owner_id": owner_id, "name": "Leo", "intro": "点评官", "prompt": "You review grammar.",
              "level": "B1", "style": "strict", "voice": None, "tools": [], "prompt_public": False,
              "deep_think": False, "disabled_at": None, "created_at": NOW, "updated_at": NOW, **over}

    async def go():
        async with app.state.sessionmaker() as s:
            s.add(AgentPersona(**fields))
            await s.commit()

    client.portal.call(go)


def room_of(client):
    alice, alice_id = login(client, "alice")
    bob, bob_id = login(client, "bob")
    room = client.post("/api/rooms", json={"topic": "面试"}, headers=alice).json()["room"]
    client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    return room, alice, alice_id, bob, bob_id


def test_owner_sets_agents_and_members_read_them(agents_client):
    app, client = agents_client
    room, alice, alice_id, bob, _ = room_of(client)
    add_persona(app, client, alice_id)
    r = client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach", U1]}, headers=alice)
    assert r.status_code == 200 and r.json()["room"]["agent_ids"] == ["builtin:coach", U1]
    listed = client.get(f"/api/rooms/{room['id']}/agents", headers=bob).json()
    assert listed["available"] is True and listed["tutor"] is None
    assert next(a for a in listed["agents"] if a["id"] == U1) == {
        "id": U1, "name": "Leo", "intro": "点评官", "level": "B1", "style": "strict", "builtin": False,
        "prompt_public": False, "prompt": None, "disabled": False}
    coach = next(a for a in listed["agents"] if a["id"] == "builtin:coach")
    assert coach["builtin"] is True and coach["name"]
    history = client.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": LATEST}, headers=bob).json()["messages"]
    system = [m for m in history if m["kind"] == "system" and m["text"] == "agents"]
    assert system and "Leo" in system[-1]["meta"]["names"]
    assert client.patch(f"/api/rooms/{room['id']}", json={"agents": []}, headers=alice).json()["room"]["agent_ids"] == []
    history = client.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": LATEST}, headers=bob).json()["messages"]
    assert history[-1]["text"] == "agents_off"


def test_selection_errors(agents_client):
    app, client = agents_client
    room, alice, _, bob, bob_id = room_of(client)
    add_persona(app, client, bob_id)  # bob's persona is not alice's to pick

    def patch(body, headers=alice):
        return client.patch(f"/api/rooms/{room['id']}", json=body, headers=headers)

    assert patch({"agents": ["builtin:coach", "builtin:interviewer", U1]}).json() == {
        "error": "Invalid settings", "fields": {"agents": "too_many"}}
    assert patch({"agents": [U1]}).json()["fields"] == {"agents": "unknown"}
    assert patch({"agents": ["builtin:coach"], "name": "x" * 31}).json()["fields"] == {"name": "too_long"}
    assert patch({"agents": ["builtin:coach"]}, bob).status_code == 403
    carol, _ = login(client, "carol")
    assert client.get(f"/api/rooms/{room['id']}/agents", headers=carol).status_code == 404


def test_agents_switched_off(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)  # AGENTS_ENABLED stays false
    try:
        room, alice, *_ = room_of(client)
        r = client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach"]}, headers=alice)
        assert r.status_code == 400 and r.json()["fields"] == {"agents": "disabled"}
        assert client.patch(f"/api/rooms/{room['id']}", json={"agents": []}, headers=alice).status_code == 200
        cfg = client.get("/api/rooms/config", headers=alice).json()
        assert (cfg["agents_available"], cfg["agent_tutor_available"], cfg["max_agents"]) == (False, False, 2)
        assert client.get(f"/api/rooms/{room['id']}/agents", headers=alice).json() == {
            "available": False, "agents": [], "tutor": None}
    finally:
        client.__exit__(None, None, None)


def test_report_is_for_members_and_room_agents_only(agents_client, monkeypatch):
    app, client = agents_client
    room, alice, alice_id, bob, bob_id = room_of(client)
    add_persona(app, client, alice_id)
    client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach", U1]}, headers=alice)
    base = f"/api/rooms/{room['id']}/agents"
    # a custom persona goes through A1's report table; reporting twice is idempotent
    assert client.post(f"{base}/{U1}/report", json={"reason": "offensive"}, headers=bob).json() == {"ok": True}
    assert client.post(f"{base}/{U1}/report", json={"reason": "offensive"}, headers=bob).json() == {"ok": True}
    assert client.post(f"{base}/{U1}/report", json={"reason": "spam"}, headers=alice).status_code == 404  # own persona
    # the builtin one is a member's report to the lane's persona adapter
    calls = []

    async def report(reporter_id, persona_id, reason):
        calls.append((reporter_id, persona_id, reason))
        return "ok"

    monkeypatch.setattr(app.state.rooms.agents.deps.personas, "report", report)
    assert client.post(f"{base}/builtin:coach/report", json={"reason": "unsafe"}, headers=bob).json() == {"ok": True}
    assert calls == [(bob_id, "builtin:coach", "unsafe")]
    assert client.post(f"{base}/builtin:waiter/report", json={"reason": "spam"}, headers=bob).status_code == 404
    assert client.post(f"{base}/builtin:coach/report", json={"reason": "nope"}, headers=bob).status_code == 400
    carol, _ = login(client, "carol")
    assert client.post(f"{base}/builtin:coach/report", json={"reason": "spam"}, headers=carol).status_code == 404
