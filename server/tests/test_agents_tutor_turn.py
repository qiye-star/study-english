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
           'TA>>{"verdict":null,"kind":"ask","next_focus":"daily routine","hint":"Start with when you get up.",'
           '"hint_zh":"从早上起床说起","say":"","done":false}']


def reply(verdict: str = "good", *, done: bool = False, hint: str = "Think of a weekend example.",
          hint_zh: str = "想一个周末的例子", note_zh: str = "表达清楚。") -> list[str]:
    return ["Nice answer!\nMore natural: I usually get up at seven.\n", "Question 2: and at weekends?\n<<META>>",
            json.dumps({"verdict": verdict, "kind": "ask", "next_focus": "weekend", "hint": hint, "hint_zh": hint_zh,
                        "note_zh": note_zh, "say": "", "done": done}, ensure_ascii=False)]


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
    hint = (await client.post(f"/api/agents/tutor/{sid}/hint", headers=h)).json()
    assert (hint["hint"], hint["hint_zh"]) == ("Start with when you get up.", "从早上起床说起")


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


async def test_hint_and_skip_are_rejected_as_busy_while_a_turn_is_generating(app, client, monkeypatch):
    from app.providers import llm

    h, cid, sid = await _session(app, client)
    seen = []

    async def watching(*args, **kwargs):
        seen.append(service.is_generating(sid))
        yield llm.Delta(kind="text", text="Hello.\n")
        yield llm.Delta(kind="text", text='<<META>>{"verdict":null,"kind":"ask","done":false}')

    monkeypatch.setattr("app.providers.llm.complete_stream", watching)
    await turn(client, h, cid, sid, None)
    await _settle(app)
    assert seen == [True] and not service.is_generating(sid)
    await set_state(app, sid, phase="await_answer")
    service.mark_generating(sid)
    for action in ("hint", "skip"):
        r = await client.post(f"/api/agents/tutor/{sid}/{action}", headers=h)
        assert r.status_code == 409 and r.json()["error"] == "Tutor is generating", action
    service.clear_generating(sid)
    assert (await client.post(f"/api/agents/tutor/{sid}/skip", headers=h)).status_code == 200


async def test_a_stale_generating_mark_expires(app, client):
    h, cid, sid = await _session(app, client)
    service.mark_generating(sid, now=0.0)
    assert service.is_generating(sid, now=service.GENERATING_TTL - 1)
    assert not service.is_generating(sid, now=service.GENERATING_TTL + 1)


async def test_two_finishes_racing_return_the_same_recap(app, client, monkeypatch):
    h, cid, sid = await _session(app, client)
    uid = int((await client.get("/api/me", headers=h)).json()["id"])
    real, calls = service.build_recap, []

    async def second_finish():
        async with app.state.sessionmaker() as s2:
            return await service.finish(s2, uid, sid, utcnow())

    def racing(state, goal):
        calls.append(1)
        data = real(state, goal)
        racing.pending = data
        return data

    racing.pending = None
    monkeypatch.setattr(service, "build_recap", racing)
    real_save, state = service._save, {"raced": False}

    async def save(session, row, st, now, **extra):
        if not state["raced"]:  # the other request commits first, between our read and our write
            state["raced"] = True
            state["other"] = await second_finish()
        return await real_save(session, row, st, now, **extra)

    monkeypatch.setattr(service, "_save", save)
    async with app.state.sessionmaker() as s1:
        first = await service.finish(s1, uid, sid, utcnow())
    assert state["other"]["recap"] == first["recap"] and first["status"] == "done" and first["recap"] is not None


async def test_turn_flow_logs_no_user_text_words_or_hints(app, client, monkeypatch, caplog):
    install_sources(app, due_words=["zephyrine", "quixotic", "laconic"])
    h, cid, sid = await _session(app, client, topic="today_words")
    fake_stream(monkeypatch, OPENING, reply("good", hint="HINT_PRIVATE", hint_zh="HINTZH_PRIVATE", note_zh="NOTEZH_PRIVATE"),
                reply("good"))
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
                    "HINTZH_PRIVATE", "NOTEZH_PRIVATE", "Start with when you get up.", "daily routine", "表达清楚"):
        assert private not in caplog.text


async def test_the_zh_note_and_hint_zh_never_reach_the_visible_text(app, client, monkeypatch):
    h, cid, sid = await _session(app, client)
    assert (await client.patch("/api/agents/settings", json={"zh_note": "always"}, headers=h)).status_code == 200
    calls = fake_stream(monkeypatch, OPENING, reply("good"))
    opening = await turn(client, h, cid, sid, None)
    assert "hint_zh" in json.dumps(calls[0], default=str, ensure_ascii=False)
    await _settle(app)
    answer = await turn(client, h, cid, sid, "I get up at seven and go to work.")
    for events in (opening, answer):
        assert not any(ord(ch) > 0x2E80 for ch in deltas(events))  # nothing Chinese in the streamed text
    [meta] = metas(answer)
    assert "note_zh" not in meta and "hint_zh" not in meta  # R-AS11: the note is not a meta field
    done = next(d for k, d in answer if k == "done")
    assert done["note_zh"] == "表达清楚。" and done["trace"]["note_zh"] == "表达清楚。"
    await _settle(app)
    hint = (await client.post(f"/api/agents/tutor/{sid}/hint", headers=h)).json()
    assert (hint["hint"], hint["hint_zh"]) == ("Think of a weekend example.", "想一个周末的例子")


async def test_zh_note_never_removes_the_chinese_rules_the_note_and_the_hint_zh(app, client, monkeypatch):
    h, cid, sid = await _session(app, client)
    assert (await client.patch("/api/agents/settings", json={"zh_note": "never"}, headers=h)).status_code == 200
    calls = fake_stream(monkeypatch, OPENING, reply("good"))
    await turn(client, h, cid, sid, None)
    prompt = json.dumps(calls[0], default=str, ensure_ascii=False)
    assert "Do not write any Chinese" in prompt and "hint_zh" not in prompt and "note_zh" not in prompt
    await _settle(app)
    answer = await turn(client, h, cid, sid, "I get up at seven.")  # the model wrote a note anyway: dropped
    done = next(d for k, d in answer if k == "done")
    assert "note_zh" not in done and "note_zh" not in done["trace"]
    await _settle(app)
    hint = (await client.post(f"/api/agents/tutor/{sid}/hint", headers=h)).json()
    assert "hint_zh" not in hint and hint["hint"]


async def test_auto_note_follows_the_current_level(app, client, monkeypatch):
    h, cid, sid = await _session(app, client)
    await set_state(app, sid, level=LEVELS.index("B2"))
    calls = fake_stream(monkeypatch, OPENING)
    await turn(client, h, cid, sid, None)
    assert "hint_zh" not in json.dumps(calls[0], default=str)  # B2 and up: no Chinese note by default
