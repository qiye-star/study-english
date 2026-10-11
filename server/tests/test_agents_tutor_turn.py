"""Tutor turns (through A1 POST /api/agents/turn, mode=tutor; plan A3 S8): META stripping, meta event, fallback, retry,
finish + memory, concurrency, log hygiene."""
import json

from app.agents.tutor import service
from app.agents.tutor.machine import LEVELS
from app.agents.tutor.parse import Meta
from app.models import AgentTutorSession, utcnow
from tests.background import drain_background
from tests.agents_tutor_helpers import (conversation, enable_agents, fake_stream, install_sources, login, set_state,
                                        start_body, turn)

OPENING = ["Hi! Let's start.\nQuestion 1: tell me ", "about your day.\n<<ME",
           'TA>>{"verdict":null,"kind":"ask","next_focus":"daily routine","hint":"从早上起床说起","say":"","done":false}']


def reply(verdict: str = "good", *, done: bool = False, hint: str = "想一个周末的例子") -> list[str]:
    return ["Nice answer!\n简评:表达清楚。\nMore natural: I usually get up at seven.\n", "Question 2: and at weekends?\n<<META>>",
            json.dumps({"verdict": verdict, "kind": "ask", "next_focus": "weekend", "hint": hint, "say": "", "done": done},
                       ensure_ascii=False)]


def deltas(events) -> str:
    return "".join(d["text"] for k, d in events if k == "delta")


def metas(events) -> list[dict]:
    return [d for k, d in events if k == "meta"]


async def _settle(app) -> None:
    """After-turn hooks share the in-memory SQLite connection with the request: wait for them before the next call."""
    await drain_background(app)


async def _session(app, client, *, length: int = 3, **kw):
    enable_agents(app)
    h = await login(client)
    cid = await conversation(client, h)
    r = await client.post("/api/agents/tutor/start", json=start_body(cid, length=length, **kw), headers=h)
    assert r.status_code == 200, r.text
    return h, cid, r.json()["id"]


async def test_opening_streams_without_meta_and_emits_meta_before_done(app, client, monkeypatch):
    h, cid, sid = await _session(app, client)
    calls = fake_stream(monkeypatch, OPENING)
    events = await turn(client, h, cid, sid, None)
    assert deltas(events) == "Hi! Let's start.\nQuestion 1: tell me about your day."
    assert "META" not in json.dumps(events) and "daily routine" not in json.dumps(events)
    [meta] = metas(events)
    # A1's Event.to_dict omits null keys on the wire: an absent verdict / say means null (web reads them that way)
    assert meta == {"step_index": 1, "steps_total": 3, "kind": "ask", "done": False, "retry": False}
    kinds = [k for k, _ in events]
    assert kinds.index("meta") < kinds.index("done")
    prompt = json.dumps(calls[0], default=str)
    assert "<tutor_mode>" in prompt and "question 1 of 3" in prompt
    assert calls[0]["kwargs"].get("max_tokens", 350) <= 350
    await _settle(app)
    got = (await client.get(f"/api/agents/tutor/{sid}", headers=h)).json()
    assert got["phase"] == "await_answer"
    assert (await client.post(f"/api/agents/tutor/{sid}/hint", headers=h)).json()["hint"] == "从早上起床说起"


async def test_answer_turn_advances_with_the_model_verdict(app, client, monkeypatch):
    h, cid, sid = await _session(app, client)
    fake_stream(monkeypatch, OPENING, reply("good"))
    await turn(client, h, cid, sid, None)
    await _settle(app)
    events = await turn(client, h, cid, sid, "I get up at seven and go to work.")
    [meta] = metas(events)
    assert (meta["step_index"], meta["verdict"], meta["done"], meta["retry"]) == (2, "good", False, False)
    assert deltas(events).endswith("Question 2: and at weekends?")


async def test_missing_or_broken_meta_falls_back_to_ok_and_the_plan(app, client, monkeypatch):
    h, cid, sid = await _session(app, client)
    fake_stream(monkeypatch, ["Hello. What did you eat today?"], ["Good.\nQuestion 2?\n<<META>>{not json"])
    first = metas(await turn(client, h, cid, sid, None))[0]
    assert (first["step_index"], first["kind"], first.get("verdict")) == (1, "ask", None)
    await _settle(app)
    events = await turn(client, h, cid, sid, "Rice.")
    assert deltas(events) == "Good.\nQuestion 2?"
    second = metas(events)[0]
    assert (second["step_index"], second["verdict"], second["kind"]) == (2, "ok", "ask")


async def test_text_in_the_opening_phase_is_rejected(app, client, monkeypatch):
    h, cid, sid = await _session(app, client)
    fake_stream(monkeypatch, OPENING)
    events = await turn(client, h, cid, sid, "hello")
    assert ("error", {"code": "bad_request"}) in events
    assert (await client.get(f"/api/agents/tutor/{sid}", headers=h)).json()["phase"] == "opening"


async def test_marker_split_into_single_characters_never_leaks(app, client, monkeypatch):
    h, cid, sid = await _session(app, client)
    text = 'Great.\n<<META>>{"verdict":null,"kind":"ask","next_focus":"LEAK_CHECK","hint":"","say":"","done":false}'
    fake_stream(monkeypatch, list(text))
    events = await turn(client, h, cid, sid, None)
    assert deltas(events) == "Great." and "LEAK_CHECK" not in json.dumps(events)


async def test_weak_repeat_gets_one_retry(app, client, monkeypatch):
    install_sources(app, due_words=["apple", "banana", "cherry"])
    h, cid, sid = await _session(app, client, topic="today_words")  # plan: words, repeat, words
    fake_stream(monkeypatch, OPENING, reply("good"), reply("weak"), reply("good"))
    await turn(client, h, cid, sid, None)
    await _settle(app)
    await turn(client, h, cid, sid, "Apples and bananas are sweet.")
    await _settle(app)
    retry = metas(await turn(client, h, cid, sid, "cherry ... something"))[0]
    assert (retry["step_index"], retry["verdict"], retry["retry"], retry["kind"]) == (2, "weak", True, "repeat")
    await _settle(app)
    moved = metas(await turn(client, h, cid, sid, "I would like a cherry."))[0]
    assert (moved["step_index"], moved["retry"]) == (3, False)


async def test_last_answer_marks_done_and_finish_writes_recap_and_memory(app, client, monkeypatch):
    h, cid, sid = await _session(app, client)
    fake_stream(monkeypatch, OPENING, reply("weak"), reply("weak"), reply("good", done=True))
    await turn(client, h, cid, sid, None)
    await _settle(app)
    m1 = metas(await turn(client, h, cid, sid, "a1"))[0]
    await _settle(app)
    m2 = metas(await turn(client, h, cid, sid, "a2"))[0]
    await _settle(app)
    m3 = metas(await turn(client, h, cid, sid, "a3"))[0]
    await _settle(app)
    assert (m1["step_index"], m2["step_index"], m3["step_index"], m3["done"], m3.get("kind")) == (2, 3, 3, True, None)
    done = (await client.post(f"/api/agents/tutor/{sid}/finish", headers=h)).json()
    await app.state.agent_memory.worker.join()
    recap = done["recap"]
    assert recap["scores"] == {"good": 1, "ok": 0, "weak": 2, "skip": 0}
    assert LEVELS.index(recap["level_end"]) == max(0, LEVELS.index(recap["level_start"]) - 1)
    recaps = (await client.get("/api/agents/memory/recaps", headers=h)).json()
    assert len(recaps["recaps"]) == 1
    items = (await client.get("/api/agents/memory/items", params={"kind": "weakness"}, headers=h)).json()
    assert any(i["text"].startswith("Tutor lessons:") for i in items["items"])


async def test_memory_off_writes_nothing(app, client, monkeypatch):
    h, cid, sid = await _session(app, client)
    assert (await client.patch("/api/agents/settings", json={"memory_enabled": False}, headers=h)).status_code == 200
    fake_stream(monkeypatch, OPENING, reply("good"))
    await turn(client, h, cid, sid, None)
    await _settle(app)
    await turn(client, h, cid, sid, "a1")
    await _settle(app)
    await client.post(f"/api/agents/tutor/{sid}/finish", headers=h)
    await app.state.agent_memory.worker.join()
    assert (await client.get("/api/agents/memory/recaps", headers=h)).json()["recaps"] == []


async def test_a_stale_turn_result_does_not_move_the_lesson_twice(app, client):
    h, cid, sid = await _session(app, client)
    await set_state(app, sid, phase="await_answer")
    async with app.state.sessionmaker() as s:
        version = (await s.get(AgentTutorSession, sid)).version
    await client.post(f"/api/agents/tutor/{sid}/skip", headers=h)
    uid = int((await client.get("/api/me", headers=h)).json()["id"])
    async with app.state.sessionmaker() as s:
        result = await service.apply_turn(s, uid, sid, version, Meta(verdict="good"), True, utcnow())
    assert (result["step_index"], result["verdict"], result["retry"]) == (2, None, False)
    got = (await client.get(f"/api/agents/tutor/{sid}", headers=h)).json()
    assert [a["verdict"] for a in got["answers"]] == ["skip"]


async def test_turn_flow_logs_no_user_text_words_or_hints(app, client, monkeypatch, caplog):
    install_sources(app, due_words=["zephyrine", "quixotic", "laconic"])
    h, cid, sid = await _session(app, client, topic="today_words")
    fake_stream(monkeypatch, OPENING, reply("good", hint="HINT_PRIVATE"), reply("good"))
    with caplog.at_level("DEBUG", logger="app"):
        await turn(client, h, cid, sid, None)
        await _settle(app)
        await turn(client, h, cid, sid, "MY_PRIVATE_ANSWER one")
        await _settle(app)
        await client.post(f"/api/agents/tutor/{sid}/hint", headers=h)
        await client.post(f"/api/agents/tutor/{sid}/skip", headers=h)
        await client.post(f"/api/agents/tutor/{sid}/finish", headers=h)
        await app.state.agent_memory.worker.join()
    for private in ("MY_PRIVATE_ANSWER", "zephyrine", "quixotic", "laconic", "HINT_PRIVATE", "从早上起床说起",
                    "daily routine", "简评"):
        assert private not in caplog.text
