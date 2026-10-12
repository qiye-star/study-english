"""AgentLane.on_voice (plan addressing-server V2; spec addressing §3.2 #1–#3, §3.4; rulings R-AS2, R-AS3, R-AS7,
R-AS8, R-AS15, R-AS20, R-AS22)."""
import logging
from dataclasses import replace
from pathlib import Path

import pytest

from app.rooms import agent_lane
from app.routers import rooms as rooms_router
from tests.fixtures.audio import wav_bytes
from tests.test_rooms_agent_tutor import fire, snapshot, start, tenv, tutor_frames  # noqa: F401 (fixtures)
from tests.test_rooms_agents_api import AGENTS_ON, fake_run_turn, room_of
from tests.test_rooms_agents_lane import A, B, EMMA, LEO, NOW, env, say, types  # noqa: F401 (fixtures)
from tests.test_rooms_agents_ws import until_answer
from tests.test_rooms_ws import make_client, until

UNCLEAR = {"type": "notice", "code": "voice_unclear"}


async def clip(env, user_id, text, *, reply_to=None, to_agent=None):
    """A voice message as the voice service leaves it after a transcription: kind voice, the transcript in `text`
    (empty for empty / failed), the sender's target in the message's own meta (R-AS1)."""
    return await env.store.append(env.room.id, lane="public", sender_kind="user", sender_id=user_id, kind="voice",
                                  text=text, now=NOW, reply_to=reply_to,
                                  meta={"to_agent": to_agent} if to_agent else None)


def called(env):
    return [req.persona.id for _, req in env.script.calls]


async def test_a_clip_addressed_to_an_agent_is_answered_with_its_transcript_as_the_question(env):
    m = await clip(env, B, "what does abandon mean", to_agent=EMMA.id)
    await env.lane.on_voice(env.room.id, m.id, "done")
    await env.hub.drain()
    assert called(env) == [EMMA.id]
    _, req = env.script.calls[0]
    assert req.text == "bob: what does abandon mean" and req.user_id == B and req.in_room is True
    answer = next(e["message"] for e in env.alice.sender.sent if e["type"] == "message")
    assert (answer["kind"], answer["reply_to"]) == ("ai_answer", m.seq)
    assert answer["meta"]["agent"] == {"persona_id": EMMA.id, "name": "Emma"} and answer["meta"]["asker"]["id"] == B
    assert "agent_step" in types(env.bob) and "agent_step" not in types(env.alice)  # the process stays private
    row, _ = await env.store.message_named(m.id)
    assert row.ai_status == "done" and env.hub.ai_pending(env.room.id) == 0


async def test_a_voice_reply_to_an_agent_answer_needs_no_target_and_the_reply_beats_to_agent(env):
    await env.cb.handle(say("@Emma hi", "seed"))
    await env.hub.drain()
    seq = next(e["message"]["seq"] for e in env.alice.sender.sent if e["type"] == "message" and e["message"]["kind"] == "ai_answer")
    m = await clip(env, A, "and the past tense", reply_to=seq)
    await env.lane.on_voice(env.room.id, m.id, "done")
    n = await clip(env, A, "one more", reply_to=seq, to_agent=LEO.id)
    await env.lane.on_voice(env.room.id, n.id, "done")
    await env.hub.drain()
    assert called(env) == [EMMA.id, EMMA.id, EMMA.id]  # R-AS2: reply > to_agent


async def test_a_plain_clip_triggers_nothing_and_voice_never_parses_at(env):
    m = await clip(env, B, "@Emma what is a latte")  # spoken words are not a mention
    before = len(env.bob.sender.sent)
    await env.lane.on_voice(env.room.id, m.id, "done")
    await env.hub.drain()
    assert env.script.calls == [] and len(env.bob.sender.sent) == before and len(env.alice.sender.sent) == 0


async def test_a_target_outside_the_rooms_agents_gets_agent_off_for_the_sender_only(env):
    m = await clip(env, B, "hello", to_agent="builtin:partner")  # a valid shape, not one of this room's agents (R-AS7)
    await env.lane.on_voice(env.room.id, m.id, "done")
    assert env.bob.sender.sent[-1] == {"type": "notice", "code": "agent_off"}
    assert {"type": "notice", "code": "agent_off"} not in env.alice.sender.sent and env.script.calls == []
    env.lookup.by_id[LEO.id] = replace(LEO, disabled=True)
    n = await clip(env, B, "hello Leo", to_agent=LEO.id)
    await env.lane.on_voice(env.room.id, n.id, "done")
    assert env.bob.sender.sent[-1] == {"type": "notice", "code": "agent_off"}
    env.feature = False
    o = await clip(env, B, "hello Emma", to_agent=EMMA.id)
    await env.lane.on_voice(env.room.id, o.id, "done")
    assert env.bob.sender.sent[-1] == {"type": "notice", "code": "agent_off"} and env.script.calls == []


async def test_an_empty_or_failed_transcript_of_an_addressed_clip_says_voice_unclear(env):
    m = await clip(env, B, "", to_agent=EMMA.id)
    await env.lane.on_voice(env.room.id, m.id, "empty")
    await env.lane.on_voice(env.room.id, m.id, "failed")
    assert env.bob.sender.sent[-2:] == [UNCLEAR, UNCLEAR] and UNCLEAR not in env.alice.sender.sent
    assert env.script.calls == [] and env.refunds == [] and env.quota["room_ai_global"] == 99  # nothing was charged
    plain = await clip(env, B, "")
    before = len(env.bob.sender.sent)
    await env.lane.on_voice(env.room.id, plain.id, "empty")
    assert len(env.bob.sender.sent) == before  # nobody was addressed: no notice


async def test_room_gates_notify_the_sender_and_the_clip_stays_published(env):
    await env.store.set_ai_muted(env.room.id, True)
    m = await clip(env, B, "hello", to_agent=EMMA.id)
    await env.lane.on_voice(env.room.id, m.id, "done")
    assert env.bob.sender.sent[-1] == {"type": "notice", "code": "ai_off"}
    await env.store.set_ai_muted(env.room.id, False)
    for _ in range(env.store.limits.ai_queue):
        env.hub.ai_enter(env.room.id)
    await env.lane.on_voice(env.room.id, m.id, "done")
    assert env.bob.sender.sent[-1] == {"type": "notice", "code": "ai_busy"}
    for _ in range(env.store.limits.ai_queue):
        env.hub.ai_leave(env.room.id)
    env.quota["room_ai_global"] = 0
    await env.lane.on_voice(env.room.id, m.id, "done")
    assert env.bob.sender.sent[-1] == {"type": "notice", "code": "ai_quota"}
    row, _ = await env.store.message_named(m.id)
    assert row.text == "hello" and row.ai_status is None and env.script.calls == [] and env.hub.ai_pending(env.room.id) == 0


async def test_hidden_clips_other_kinds_and_unknown_ids_trigger_nothing(env):
    m = await clip(env, B, "secret words", to_agent=EMMA.id)
    await env.store.hide(env.room.id, m.id, NOW)
    await env.lane.on_voice(env.room.id, m.id, "done")
    text = await env.store.append(env.room.id, lane="public", sender_kind="user", sender_id=B, kind="text",
                                  text="typed", now=NOW, meta={"to_agent": EMMA.id})
    await env.lane.on_voice(env.room.id, text.id, "done")
    await env.lane.on_voice(env.room.id, "no-such-id", "done")
    await env.lane.on_voice("another-room", m.id, "done")
    await env.hub.drain()
    assert env.script.calls == [] and env.bob.sender.sent == []


async def test_a_running_tutor_closes_the_implicit_ways_for_voice_too(env):
    await env.store.set_tutor(env.room.id, {"phase": "await_answer", "persona_id": EMMA.id, "current_user_id": A})
    m = await clip(env, B, "tutor chat", to_agent=EMMA.id)  # not the called member, `to_agent` set: context only (R-AS3)
    await env.lane.on_voice(env.room.id, m.id, "done")
    await env.hub.drain()
    assert env.script.calls == [] and env.bob.sender.sent == []


async def test_the_called_members_transcribed_clip_is_the_tutor_answer_even_with_a_target(tenv):
    await start(tenv)
    m = await clip(tenv, A, "I went hiking last weekend.", to_agent=EMMA.id)
    await tenv.lane.on_voice(tenv.room.id, m.id, "done")
    await tenv.hub.drain()
    assert [req.mode for _, req in tenv.script.calls] == ["tutor", "tutor"]  # one turn: the tutor's, not a chat turn
    assert tenv.script.calls[1][1].text == "alice: I went hiking last weekend."
    assert tutor_frames(tenv.bob)[-1]["current_user_id"] == B


async def test_an_unclear_clip_of_the_called_member_keeps_the_question_and_the_timer(tenv):
    await start(tenv)
    task = tenv.tutor._timers[tenv.room.id]
    snap_before = await snapshot(tenv)
    m = await clip(tenv, A, "")
    await tenv.lane.on_voice(tenv.room.id, m.id, "empty")
    await tenv.lane.on_voice(tenv.room.id, m.id, "failed")
    assert tenv.alice.sender.sent[-2:] == [UNCLEAR, UNCLEAR] and UNCLEAR not in tenv.bob.sender.sent
    assert tenv.tutor._timers[tenv.room.id] is task and not task.done()  # R-AS8: the 60 s clock is not reset
    assert await snapshot(tenv) == snap_before and len(tenv.script.calls) == 1  # nothing was counted or skipped


async def test_a_clip_of_someone_who_is_not_called_on_never_advances_the_lesson(tenv):
    await start(tenv)
    m = await clip(tenv, B, "chipping in")
    await tenv.lane.on_voice(tenv.room.id, m.id, "done")
    await tenv.hub.drain()
    assert len(tenv.script.calls) == 1 and (await snapshot(tenv))["phase"] == "await_answer"
    assert UNCLEAR not in tenv.bob.sender.sent


async def test_a_late_transcript_after_the_sixty_second_skip_is_neither_counted_nor_announced(tenv):
    await start(tenv)
    m = await clip(tenv, A, "too late")
    await fire(tenv)  # the timer wins: alice was skipped, bob is asked
    calls, seen = len(tenv.script.calls), len(tenv.alice.sender.sent)
    await tenv.lane.on_voice(tenv.room.id, m.id, "done")
    await tenv.hub.drain()
    assert len(tenv.script.calls) == calls and UNCLEAR not in tenv.alice.sender.sent[seen:]


def test_the_notice_literal_the_web_greps_for_exists_in_the_lane():
    src = Path(agent_lane.__file__).read_text(encoding="utf-8")
    assert 'code="voice_unclear"' in src  # web room-agents-contract.test.ts (Cross-plan S-3)


async def test_voice_routing_logs_no_transcripts_names_or_ids(env, caplog):
    caplog.set_level(logging.DEBUG, logger="app")  # the app's own records; aiosqlite DEBUG logs SQL parameters
    m = await clip(env, B, "SECRET-VOICE-QUESTION-55", to_agent=EMMA.id)
    await env.lane.on_voice(env.room.id, m.id, "done")
    await env.hub.drain()  # the answer takes the room lock: append the next clip only after it (seq race otherwise)
    n = await clip(env, B, "", to_agent=LEO.id)
    await env.lane.on_voice(env.room.id, n.id, "failed")
    env.script.error = "llm_unavailable"
    o = await clip(env, B, "SECRET-VOICE-FAIL-56", to_agent=EMMA.id)
    await env.lane.on_voice(env.room.id, o.id, "done")
    await env.hub.drain()
    text = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("app"))
    for secret in ("SECRET-VOICE", "Emma", "Leo", "bob", EMMA.id, LEO.id):
        assert secret not in text
    assert "room agent turn failed code=upstream" in text


@pytest.fixture
def voice_agents(tmp_path, monkeypatch):
    """A real app with voice and agents on; a recording stand-in for the orchestrator and a fake transcriber."""
    seen: list[tuple[str, str]] = []

    async def recording_run_turn(deps, req):
        seen.append((req.text, req.persona.id))
        async for ev in fake_run_turn(deps, req):
            yield ev

    monkeypatch.setattr("app.routers.rooms_agents.run_turn", recording_run_turn)
    app, client = make_client(tmp_path, monkeypatch, rooms_voice_enabled=True, upstream_whisper_base_url="http://w",
                              upstream_whisper_mode="openai", data_dir=str(tmp_path / "data"), **AGENTS_ON)
    state = {"text": "What does abandon mean?"}

    async def transcribe(wav, sender_id):
        return state["text"]

    rooms_router.runtime(app).voice.deps.transcribe = transcribe
    yield app, client, seen, state
    client.__exit__(None, None, None)


def test_a_voice_message_addressed_to_an_agent_is_answered_after_transcription(voice_agents, caplog):
    app, client, seen, state = voice_agents
    caplog.set_level(logging.DEBUG, logger="app")
    room, alice, _, bob, _ = room_of(client)
    client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach"]}, headers=alice)
    ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=bob).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wb:
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        files = {"file": ("v.wav", wav_bytes(2.0), "audio/wav")}
        r = client.post(f"/api/rooms/{room['id']}/voice", files=files,
                        data={"client_id": "v1", "to_agent": "builtin:coach"}, headers=bob)
        assert r.status_code == 200 and r.json()["message"]["meta"] == {"to_agent": "builtin:coach"}
        answer = until_answer(wb)[-1]["message"]
    assert answer["meta"]["agent"]["persona_id"] == "builtin:coach" and answer["reply_to"] == r.json()["seq"]
    assert seen and seen[0][1] == "builtin:coach" and seen[0][0].endswith("What does abandon mean?")  # the transcript
    text = "\n".join(rec.getMessage() for rec in caplog.records if rec.name.startswith("app"))
    assert "abandon" not in text


def test_an_unaddressed_voice_message_is_not_answered_and_an_unclear_one_is_announced(voice_agents):
    app, client, seen, state = voice_agents
    room, alice, _, bob, _ = room_of(client)
    ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=bob).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wb:
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        files = {"file": ("v.wav", wav_bytes(2.0), "audio/wav")}
        client.post(f"/api/rooms/{room['id']}/voice", files=files, data={"client_id": "v1"}, headers=bob)
        until(wb, "voice_update")
        state["text"] = "  "  # an empty transcript of a clip addressed to an agent
        client.post(f"/api/rooms/{room['id']}/voice", files=files,
                    data={"client_id": "v2", "to_agent": "builtin:coach"}, headers=bob)
        assert until(wb, "notice")[-1] == UNCLEAR  # the target is not (yet) one of the room's agents, but unclear wins
    assert seen == []
