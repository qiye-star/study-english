import asyncio
import logging
from dataclasses import replace

import pytest

from app.agents import limits
from app.agents.trace import Delta, Error, Meta
from app.agents.tutor import machine
from app.agents.tutor.plan import Goal, PlanSources, build_plan
from app.rooms.agent_tutor import ROOM_MIX, RoomTutor, RoomTutorMode, TutorError, _level, room_block, tutor_view
from tests.test_rooms_agents_lane import A, B, EMMA, Script, env, say  # noqa: F401 (fixture)


class TutorScript(Script):
    def __init__(self):
        super().__init__()
        self.tutor_reply = "Nice. Next question for you."
        self.meta = {"step_index": 1, "steps_total": 3, "verdict": "good", "kind": "ask", "done": False}

    async def run_turn(self, deps, req):
        if req.mode != "tutor":
            async for ev in super().run_turn(deps, req):
                yield ev
            return
        self.calls.append((deps, req))
        if self.block is not None:
            await self.block.wait()
        if self.error is not None:
            yield Error(code=self.error)
            return
        yield Delta(text=self.tutor_reply)
        if self.meta is not None:
            yield Meta(**self.meta)


class Clockwork:
    """Injected sleep: timers wait on futures the test resolves (no real 60 s waits)."""

    def __init__(self):
        self.pending: list[asyncio.Future] = []

    async def sleep(self, seconds):
        fut = asyncio.get_running_loop().create_future()
        self.pending.append(fut)
        await fut


@pytest.fixture
async def tenv(env):
    env.script = TutorScript()
    env.lane.deps.run_turn = env.script.run_turn
    env.lane.deps.tutor_on = lambda: True
    env.clock = Clockwork()
    env.tutor = RoomTutor(env.lane, sleep=env.clock.sleep)
    env.lane.tutor = env.tutor
    yield env
    await env.tutor.shutdown()


async def fire(env):
    """Let the current question's 60 s run out."""
    task = env.tutor._timers[env.room.id]
    while True:
        live = [f for f in env.clock.pending if not f.done()]  # earlier timers were cancelled by answers / skips
        if live:
            break
        await asyncio.sleep(0)
    live[0].set_result(None)
    await task
    await env.hub.drain()


def tutor_frames(conn):
    return [ev["tutor"] for ev in conn.sender.sent if ev["type"] == "agent_tutor"]


def messages(conn):
    return [ev["message"] for ev in conn.sender.sent if ev["type"] == "message"]


async def start(env, steps=3):
    view = await env.tutor.start(env.room.id, A, EMMA.id, steps)
    await env.hub.drain()
    return view


async def snapshot(env):
    return (await env.store.room(env.room.id)).agent_tutor


async def test_start_calls_on_the_first_online_member(tenv):
    view = await start(tenv)
    assert (view["phase"], view["steps_total"], view["persona_name"]) == ("generating", 3, "Emma")
    deps, req = tenv.script.calls[0]
    assert (req.mode, req.text, req.user_id, req.in_room, req.tutor_session_id) == ("tutor", None, A, True, None)
    assert deps["allow_private"] is False and deps["memory"] is False and deps["modes"]["tutor"].name == "tutor"
    got = messages(tenv.bob)
    assert (got[0]["kind"], got[0]["text"], got[0]["meta"]) == ("system", "tutor_started", {"name": "Emma"})
    question = got[-1]
    assert question["meta"]["agent"] == {"persona_id": EMMA.id, "name": "Emma"}
    assert question["meta"]["tutor"] == {"step_index": 1, "steps_total": 3, "to_user_id": A, "to_name": "alice",
                                         "final": False, "verdict_for": None, "verdict": None}
    last = tutor_frames(tenv.bob)[-1]
    assert (last["phase"], last["current_user_id"], last["current_name"], last["remaining_ms"]) == (
        "await_answer", A, "alice", 60_000)
    snap = await snapshot(tenv)
    assert snap["phase"] == "await_answer" and snap["question_seq"] == question["seq"] and snap["order"] == [A, B]
    state = machine.from_dict(snap["machine"])  # A3's state machine is persisted with every step
    assert (state.phase, state.index, len(state.plan)) == ("await_answer", 0, 3)
    assert {item.kind for item in state.plan} <= set(ROOM_MIX)  # text-only: no dictation, no word lists


async def test_the_called_member_answers_others_only_chip_in(tenv):
    await start(tenv)
    await tenv.cb.handle(say("I think it is great.", "b1"))  # bob is not being asked: context only
    await tenv.hub.drain()
    assert len(tenv.script.calls) == 1
    await tenv.ca.handle(say("I went hiking.", "a1"))
    await tenv.hub.drain()
    _, req = tenv.script.calls[1]
    assert req.text == "alice: I went hiking."
    assert {"role": "user", "content": "bob: I think it is great."} in req.history
    assert all("I went hiking." not in h["content"] for h in req.history)  # the answer is the turn's text, once
    q2 = messages(tenv.alice)[-1]
    assert q2["meta"]["tutor"]["to_user_id"] == B and q2["meta"]["tutor"]["step_index"] == 2
    assert (q2["meta"]["tutor"]["verdict_for"], q2["meta"]["tutor"]["verdict"]) == (A, "good")
    assert q2["reply_to"] is not None and tutor_frames(tenv.alice)[-1]["current_user_id"] == B
    state = machine.from_dict((await snapshot(tenv))["machine"])
    assert (state.index, [a.verdict for a in state.answers]) == (1, ["good"])


async def test_sixty_seconds_without_an_answer_skip_to_the_next_member(tenv):
    await start(tenv)
    tenv.script.meta = None  # no META line: the code decides (a skip is a skip, spec §7.3)
    await fire(tenv)
    _, req = tenv.script.calls[1]
    assert req.text is None
    tutor = messages(tenv.bob)[-1]["meta"]["tutor"]
    assert (tutor["verdict_for"], tutor["verdict"], tutor["to_user_id"]) == (A, "skip", B)
    state = machine.from_dict((await snapshot(tenv))["machine"])
    assert (state.phase, state.index, [a.verdict for a in state.answers]) == ("await_answer", 1, ["skip"])


async def test_skip_by_the_called_member_or_the_owner(tenv):
    await start(tenv)
    with pytest.raises(TutorError) as e:
        await tenv.tutor.skip(tenv.room.id, B)
    assert e.value.code == "forbidden"
    await tenv.tutor.skip(tenv.room.id, A)
    await tenv.hub.drain()
    assert tutor_frames(tenv.bob)[-1]["current_user_id"] == B
    await tenv.tutor.skip(tenv.room.id, A)  # the owner may skip bob
    await tenv.hub.drain()
    assert tutor_frames(tenv.bob)[-1]["current_user_id"] == A


async def test_the_round_ends_with_a_wrap_up(tenv):
    await start(tenv)
    for conn, cid in ((tenv.ca, "a1"), (tenv.cb, "b1"), (tenv.ca, "a2")):
        await conn.handle(say("My answer.", cid))
        await tenv.hub.drain()
    assert len(tenv.script.calls) == 4
    got = messages(tenv.bob)
    wrap = [m for m in got if m["kind"] == "ai_answer"][-1]
    assert wrap["meta"]["tutor"]["final"] is True and wrap["meta"]["tutor"]["to_user_id"] is None
    assert (got[-1]["kind"], got[-1]["text"]) == ("system", "tutor_done")
    assert got[-1]["meta"]["name"] == "Emma" and got[-1]["meta"]["recap"]["total"] == 3
    assert got[-1]["meta"]["recap"]["scores"]["good"] == 3
    assert tutor_frames(tenv.bob)[-1] is None
    assert (await snapshot(tenv)) is None and tenv.room.id not in tenv.tutor._timers


async def test_skipping_the_last_question_wraps_up_without_a_new_question(tenv):
    await start(tenv, steps=3)
    for conn, cid in ((tenv.ca, "a1"), (tenv.cb, "b1")):
        await conn.handle(say("My answer.", cid))
        await tenv.hub.drain()
    await fire(tenv)  # alice never answers question 3
    _, req = tenv.script.calls[-1]
    assert req.text is None
    wrap = [m for m in messages(tenv.bob) if m["kind"] == "ai_answer"][-1]
    assert wrap["meta"]["tutor"]["final"] is True and wrap["meta"]["tutor"]["verdict"] == "skip"
    assert messages(tenv.bob)[-1]["text"] == "tutor_done" and (await snapshot(tenv)) is None


async def test_a_weak_repeat_answer_asks_the_same_member_again(tenv):
    await start(tenv)
    snap = await snapshot(tenv)
    state = machine.from_dict(snap["machine"])
    plan = (replace(state.plan[0], kind="repeat"), *state.plan[1:])
    await tenv.store.set_tutor(tenv.room.id, {**snap, "machine": machine.to_dict(replace(state, plan=plan))})
    tenv.script.meta = {"step_index": 1, "steps_total": 3, "verdict": "weak", "kind": "repeat", "done": False}
    await tenv.ca.handle(say("I go park.", "a1"))
    await tenv.hub.drain()
    tutor = messages(tenv.bob)[-1]["meta"]["tutor"]
    assert (tutor["to_user_id"], tutor["step_index"], tutor["verdict"]) == (A, 1, "weak")
    assert machine.from_dict((await snapshot(tenv))["machine"]).repeats == 1


async def test_owner_stops_and_late_answers_do_nothing(tenv):
    await start(tenv)
    with pytest.raises(TutorError) as e:
        await tenv.tutor.stop(tenv.room.id, B)
    assert e.value.code == "forbidden"
    await tenv.tutor.stop(tenv.room.id, A)
    assert tutor_frames(tenv.bob)[-1] is None and messages(tenv.bob)[-1]["text"] == "tutor_stopped"
    await tenv.ca.handle(say("late answer", "a1"))
    await tenv.hub.drain()
    assert len(tenv.script.calls) == 1 and (await snapshot(tenv)) is None


async def test_restart_pauses_reconnects_see_it_and_the_owner_resumes(tenv):
    await start(tenv)
    await tenv.tutor.shutdown()
    fresh = RoomTutor(tenv.lane, sleep=tenv.clock.sleep)  # a new process: no timers, nothing active
    tenv.lane.tutor = tenv.tutor = fresh
    assert await fresh.pause_all() == 1
    snap = await snapshot(tenv)
    assert (snap["phase"], snap["paused_reason"], snap["deadline_at"]) == ("paused", "restart", None)
    await fresh.on_welcome(tenv.ca)
    assert tenv.alice.sender.sent[-1]["type"] == "agent_tutor"
    assert tenv.alice.sender.sent[-1]["tutor"]["paused_reason"] == "restart"
    await tenv.ca.handle(say("answer while paused", "a1"))
    await tenv.hub.drain()
    assert len(tenv.script.calls) == 1
    assert (await fresh.resume(tenv.room.id, A))["phase"] == "generating"
    await tenv.hub.drain()
    tutor = messages(tenv.bob)[-1]["meta"]["tutor"]
    assert (tutor["to_user_id"], tutor["step_index"], tutor["verdict_for"]) == (A, 1, None)  # the same question again
    assert machine.from_dict((await snapshot(tenv))["machine"]).answers == ()  # nothing was judged or skipped
    with pytest.raises(TutorError) as e:
        await fresh.resume(tenv.room.id, A)
    assert e.value.code == "not_paused"


async def test_upstream_failure_and_ai_mute_pause_the_round(tenv):
    tenv.script.error = "llm_unavailable"
    await start(tenv)
    last = tutor_frames(tenv.bob)[-1]
    assert (last["phase"], last["paused_reason"]) == ("paused", "upstream")
    assert tenv.refunds == ["room_ai_global"]
    tenv.script.error = None
    await tenv.store.set_ai_muted(tenv.room.id, True)  # admin mute also mutes the tutor (R-RA5)
    await tenv.tutor.resume(tenv.room.id, A)
    await tenv.hub.drain()
    assert tutor_frames(tenv.bob)[-1]["paused_reason"] == "ai_off" and len(tenv.script.calls) == 1
    await tenv.store.set_ai_muted(tenv.room.id, False)
    await tenv.tutor.resume(tenv.room.id, A)  # the first question never went out: it is asked now
    await tenv.hub.drain()
    assert tutor_frames(tenv.bob)[-1]["phase"] == "await_answer"
    assert machine.from_dict((await snapshot(tenv))["machine"]).phase == "await_answer"


async def test_start_rules(tenv):
    async def code(user_id, persona_id):
        with pytest.raises(TutorError) as e:
            await tenv.tutor.start(tenv.room.id, user_id, persona_id, 8)
        return e.value.code

    assert await code(B, EMMA.id) == "forbidden"
    assert await code(A, "builtin:waiter") == "not_agent"
    tenv.lane.deps.tutor_on = lambda: False
    assert await code(A, EMMA.id) == "disabled"
    tenv.lane.deps.tutor_on = lambda: True
    tenv.quota[limits.SCOPE_TUTOR_USER] = 0  # shared with the 1:1 tutor starts (INDEX X5)
    assert await code(A, EMMA.id) == "quota"
    tenv.quota[limits.SCOPE_TUTOR_USER] = 99
    tenv.hub.detach(tenv.room.id, tenv.alice)
    tenv.hub.detach(tenv.room.id, tenv.bob)
    assert await code(A, EMMA.id) == "no_participants"
    tenv.hub.attach(tenv.room.id, tenv.alice)
    tenv.hub.attach(tenv.room.id, tenv.bob)
    await tenv.tutor.start(tenv.room.id, A, EMMA.id, 8)
    assert await code(A, EMMA.id) == "active"
    await tenv.hub.drain()


def test_room_block_wraps_a_machine_block_and_names_the_members():
    goal = Goal(topic="free", length=3, mix=ROOM_MIX)
    state = machine.new_state(tuple(build_plan(goal, PlanSources())), "B2")
    opening = room_block(state, goal, prev_name=None, next_name="bob", retry_name=None)
    assert "<tutor_mode>" in opening and "Learner level right now: B2" in opening and "calling on bob" in opening
    assert "<<META>>" in opening and "Never read out anyone's personal learning data" in opening
    waiting = machine.next_state(state, machine.Asked())
    judge = room_block(waiting, goal, prev_name="alice", next_name="bob", retry_name="alice")
    assert "Judge it" in judge and "Any feedback is for alice" in judge and "call on alice instead" in judge
    again = room_block(replace(waiting, phase="ask"), goal, prev_name=None, next_name="alice", retry_name=None,
                       resume=True)
    assert "asked again after a pause" in again
    wrap = room_block(waiting, goal, prev_name="bob", next_name=None, retry_name=None, wrap=True, skipped=True)
    assert "did not answer the last question" in wrap and "Do not ask a new question" in wrap and '"done":true' in wrap
    assert "<tutor_mode>" in wrap and "Judge it" not in wrap
    assert tutor_view(None, None) is None


async def test_mode_block_and_meta_parsing():
    mode = RoomTutorMode(text="BLOCK alice", step_index=2, steps_total=5, answering=True, speaks_first=False)
    block = await mode.prepare(None)
    assert block.max_tokens == 350 and block.text == "BLOCK alice" and block.user_text is None
    meta = await mode.finish(None, 'Hi!\n<<META>>{"verdict":"good","kind":"ask","hint":"想想看","done":false}')
    assert meta == {"step_index": 2, "steps_total": 5, "verdict": "good", "done": False} and mode.hint == "想想看"
    assert (await mode.finish(None, "no meta here"))["verdict"] == "ok"  # missing META: answers count as ok
    first = RoomTutorMode(text="x", step_index=1, steps_total=5, answering=False, speaks_first=True)
    assert (await first.prepare(None)).user_text  # text=None turns carry the opening line
    assert (await first.finish(None, 'q?\n<<META>>{"verdict":"good"}'))["verdict"] is None


def test_the_room_level_maps_onto_the_tutor_levels():
    assert [_level(x) for x in ("A1", "A2", "B1", "B2", "C1", "?")] == ["A2", "A2", "B1", "B2", "C1", "B1"]


async def test_tutor_logs_no_text(tenv, caplog):
    caplog.set_level(logging.DEBUG, logger="app")  # the app's own records; aiosqlite DEBUG logs SQL parameters
    tenv.script.tutor_reply = "SECRET-TUTOR-1"
    await start(tenv)
    await tenv.ca.handle(say("SECRET-ANSWER-2", "a1"))
    await tenv.hub.drain()
    tenv.script.error = "llm_unavailable"
    await fire(tenv)
    text = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("app"))
    for secret in ("SECRET-TUTOR-1", "SECRET-ANSWER-2", "alice", "bob", "Emma"):
        assert secret not in text
    assert "room tutor paused reason=upstream" in text
