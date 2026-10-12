import asyncio
import logging
from dataclasses import replace

import pytest

from app.agents import limits
from app.agents.trace import Delta, Done, Error, Meta
from app.agents.tutor import machine
from app.agents.tutor.plan import Goal, PlanSources, build_plan
from app.rooms.agent_lane import AgentPrefs
from app.rooms.agent_tutor import ROOM_MIX, RoomTutor, RoomTutorMode, TutorError, _level, room_block, tutor_view
from tests.test_rooms_agents_lane import A, B, EMMA, NOW, Script, env, say  # noqa: F401 (fixture)


class TutorScript(Script):
    def __init__(self):
        super().__init__()
        self.tutor_reply = "Nice. Next question for you."
        self.meta = {"step_index": 1, "steps_total": 3, "verdict": "good", "kind": "ask", "done": False}
        self.note_zh = None

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
        yield Done(text_len=len(self.tutor_reply), trace={}, note_zh=self.note_zh)


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


async def _wait_for(predicate, tries=1000):
    for _ in range(tries):  # the database runs in a thread: yielding once is not enough
        if await predicate():
            return
        await asyncio.sleep(0.005)
    raise AssertionError("condition not reached")


async def _generating(tenv):
    return len(tenv.script.calls) == 1


async def test_stop_cancels_an_in_flight_turn_and_nothing_is_said_after_tutor_stopped(tenv):
    tenv.script.block = asyncio.Event()
    await tenv.tutor.start(tenv.room.id, A, EMMA.id, 3)
    await _wait_for(lambda: _generating(tenv))  # the opening turn is generating
    await tenv.tutor.stop(tenv.room.id, A)
    tenv.script.block.set()
    await tenv.hub.drain()
    got = messages(tenv.bob)
    assert [m["text"] for m in got if m["kind"] == "system"] == ["tutor_started", "tutor_stopped"]
    assert got[-1]["text"] == "tutor_stopped" and all(m["kind"] != "ai_answer" for m in got)
    assert (await snapshot(tenv)) is None and tutor_frames(tenv.bob)[-1] is None
    assert tenv.tutor._timers == {} and tenv.refunds == ["room_ai_global"]  # the cancelled turn gives its quota back


async def test_closing_the_room_cancels_an_in_flight_turn(tenv):
    tenv.script.block = asyncio.Event()
    await tenv.tutor.start(tenv.room.id, A, EMMA.id, 3)
    await _wait_for(lambda: _generating(tenv))
    await tenv.tutor.on_close(tenv.room.id)
    tenv.script.block.set()
    await tenv.hub.drain()
    assert [m["kind"] for m in messages(tenv.bob)] == ["system"] and (await snapshot(tenv)) is None


async def test_a_stale_turn_result_is_dropped_when_the_run_changed_before_it_is_stored(tenv, monkeypatch):
    """Even without the cancellation: the append re-checks run id and phase under the lock."""
    tenv.script.block = asyncio.Event()
    monkeypatch.setattr(tenv.tutor, "_cancel_turn", lambda room_id: None)
    await tenv.tutor.start(tenv.room.id, A, EMMA.id, 3)
    await _wait_for(lambda: _generating(tenv))
    snap = await snapshot(tenv)
    await tenv.store.set_tutor(tenv.room.id, {**snap, "run_id": "someone-else"})  # restarted / replaced meanwhile
    tenv.script.block.set()
    await tenv.hub.drain()
    assert all(m["kind"] != "ai_answer" for m in messages(tenv.bob))


async def test_nobody_online_pauses_the_lesson_instead_of_skipping_through_it(tenv):
    await start(tenv)
    calls = len(tenv.script.calls)
    tenv.hub.detach(tenv.room.id, tenv.alice)
    tenv.hub.detach(tenv.room.id, tenv.bob)
    await fire(tenv)  # the 60 s run out with the whole room gone
    assert len(tenv.script.calls) == calls  # no LLM call is made for an empty room
    snap = await snapshot(tenv)
    assert (snap["phase"], snap["paused_reason"]) == ("paused", "empty")
    assert machine.from_dict(snap["machine"]).answers == ()  # nothing was skipped
    assert tenv.refunds == [] and tenv.room.id not in tenv.tutor._timers


async def test_only_online_members_are_called_on(tenv):
    await start(tenv, steps=4)
    tenv.hub.detach(tenv.room.id, tenv.bob)  # bob left: he is next in the rotation but nobody calls on an absent member
    await tenv.ca.handle(say("My answer.", "a1"))
    await tenv.hub.drain()
    tutor = messages(tenv.alice)[-1]["meta"]["tutor"]
    assert tutor["to_user_id"] == A and tutor["final"] is False and tutor["verdict_for"] == A


async def test_a_late_arm_cannot_replace_the_timer_of_a_newer_question(tenv):
    await start(tenv, steps=4)
    real, state = tenv.tutor._broadcast, {"hit": False}

    async def at_step_three():
        cur = await snapshot(tenv)
        return bool(cur) and cur["step_index"] == 3 and cur["phase"] == "await_answer"

    async def slow(room_id, snap):
        if not state["hit"] and snap and snap.get("phase") == "await_answer" and snap["step_index"] == 2:
            state["hit"] = True  # question 2 is committed; bob answers before its broadcast has finished
            await tenv.cb.handle(say("Bob answers.", "b1"))
            await _wait_for(at_step_three)
        return await real(room_id, snap)

    tenv.tutor._broadcast = slow
    await tenv.ca.handle(say("Alice answers.", "a1"))
    await tenv.hub.drain()
    tenv.tutor._broadcast = real
    await fire(tenv)  # the live timer must be question 3's: it skips alice and asks question 4
    assert (await snapshot(tenv))["step_index"] == 4


async def test_a_malformed_snapshot_pauses_with_state_instead_of_hanging_in_generating(tenv):
    await start(tenv)
    snap = await snapshot(tenv)
    await tenv.store.set_tutor(tenv.room.id, {k: v for k, v in snap.items() if k != "order"})  # KeyError while planning
    await tenv.ca.handle(say("My answer.", "a1"))
    await tenv.hub.drain()
    last = tutor_frames(tenv.bob)[-1]
    assert (last["phase"], last["paused_reason"]) == ("paused", "state")
    assert tenv.refunds == ["room_ai_global"]


async def test_any_exception_in_a_turn_pauses_the_lesson(tenv, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    await start(tenv)

    async def boom(*args, **kwargs):
        raise RuntimeError("SECRET-BOOM-77")

    monkeypatch.setattr(tenv.store, "agent_context", boom)
    await tenv.ca.handle(say("My answer.", "a1"))
    await tenv.hub.drain()
    snap = await snapshot(tenv)
    assert (snap["phase"], snap["paused_reason"]) == ("paused", "upstream")
    assert "RuntimeError" in caplog.text and "SECRET-BOOM-77" not in caplog.text


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


async def test_the_mode_keeps_the_chinese_hint_only_when_asked_and_returns_the_note():
    raw = 'Hi!\n<<META>>{"verdict":"good","hint":"Think.","hint_zh":"想想","note_zh":"不错","done":false}'
    with_zh = RoomTutorMode(text="x", step_index=1, steps_total=3, answering=True, speaks_first=False, zh_note=True)
    assert (await with_zh.finish(None, raw))["note_zh"] == "不错" and with_zh.hint_zh == "想想"
    without = RoomTutorMode(text="x", step_index=1, steps_total=3, answering=True, speaks_first=False)
    assert (await without.finish(None, raw))["note_zh"] == "不错"  # the setting filters in the orchestrator
    assert without.hint == "Think." and without.hint_zh == ""  # a hint nobody asked for is not stored


def test_room_block_asks_for_chinese_fields_only_with_zh_note():
    goal = Goal(topic="free", length=3, mix=ROOM_MIX)
    state = machine.next_state(machine.new_state(tuple(build_plan(goal, PlanSources())), "B1"), machine.Asked())
    plain = room_block(state, goal, prev_name="alice", next_name="bob", retry_name="alice")
    zh = room_block(state, goal, prev_name="alice", next_name="bob", retry_name="alice", zh_note=True)
    assert "hint_zh" not in plain and "note_zh" not in plain and "Do not write any Chinese" in plain
    assert '"hint_zh"' in zh and '"note_zh"' in zh
    wrap = room_block(state, goal, prev_name="bob", next_name=None, retry_name=None, wrap=True)
    wrap_zh = room_block(state, goal, prev_name="bob", next_name=None, retry_name=None, wrap=True, zh_note=True)
    assert "English only" in wrap and "note_zh" not in wrap and '"note_zh"' in wrap_zh and '"done":true' in wrap_zh


async def test_the_started_by_setting_and_the_level_decide_the_prompt(tenv):
    await start(tenv)
    assert "hint_zh" in tenv.script.calls[0][0]["modes"]["tutor"].text  # default auto: A2 / B1 lessons get a note
    tenv.prefs[A] = AgentPrefs(zh_note="never")
    await tenv.tutor.stop(tenv.room.id, A)
    await start(tenv)
    assert "hint_zh" not in tenv.script.calls[1][0]["modes"]["tutor"].text
    tenv.prefs[A] = AgentPrefs(zh_note="always")
    await tenv.tutor.stop(tenv.room.id, A)
    await start(tenv)
    assert "hint_zh" in tenv.script.calls[2][0]["modes"]["tutor"].text


async def test_the_zh_note_goes_into_the_public_meta_and_the_hint_zh_into_the_frame(tenv):
    tenv.script.note_zh = "说得好"
    await start(tenv)
    question = messages(tenv.bob)[-1]
    assert question["meta"]["note_zh"] == "说得好" and set(question["meta"]) == {"agent", "tutor", "note_zh"}
    snap = await snapshot(tenv)
    state = machine.from_dict(snap["machine"])
    await tenv.store.set_tutor(tenv.room.id, {**snap, "machine": machine.to_dict(replace(state, hint_zh="想想你的周末"))})
    await tenv.tutor.on_welcome(tenv.ca)
    frame = tenv.alice.sender.sent[-1]["tutor"]
    assert frame["hint_zh"] == "想想你的周末" and "hint" not in frame  # R-AS18: no English hint key on the wire
    generating = {**snap, "phase": "generating", "machine": machine.to_dict(replace(state, hint_zh="x"))}
    assert "hint_zh" not in tutor_view(generating, None)  # only while a question is waiting
    assert "hint_zh" not in tutor_view({**snap, "machine": machine.to_dict(state)}, None)  # and only when there is one


async def test_no_note_means_no_key(tenv):
    await start(tenv)
    assert "note_zh" not in messages(tenv.bob)[-1]["meta"]


async def test_chinese_notes_never_reach_the_logs(tenv, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    tenv.script.note_zh = "SECRET-NOTE-ZH-9"
    await start(tenv)
    await tenv.ca.handle(say("SECRET-ANSWER-4", "a1"))
    await tenv.hub.drain()
    text = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("app"))
    assert "SECRET-NOTE-ZH-9" not in text and "SECRET-ANSWER-4" not in text


async def _voice(tenv, user_id, text, **meta):
    """A transcribed voice message as `VoiceStore.set_transcript` leaves it: kind voice, the transcript in `text`."""
    return await tenv.store.append(tenv.room.id, lane="public", sender_kind="user", sender_id=user_id, kind="voice",
                                   text=text, now=NOW, meta=meta or None)


async def test_waits_for_names_only_the_called_member(tenv):
    assert await tenv.tutor.waits_for(tenv.room.id, A) is False  # no lesson yet
    await start(tenv)
    assert await tenv.tutor.waits_for(tenv.room.id, A) is True and await tenv.tutor.waits_for(tenv.room.id, B) is False
    await tenv.tutor.stop(tenv.room.id, A)
    assert await tenv.tutor.waits_for(tenv.room.id, A) is False


async def test_a_transcribed_voice_message_of_the_called_member_is_the_answer(tenv):
    await start(tenv)
    clip = await _voice(tenv, A, "I went hiking last weekend.")
    assert await tenv.tutor.on_message(tenv.room.id, clip) is True
    await tenv.hub.drain()
    _, req = tenv.script.calls[1]
    assert req.text == "alice: I went hiking last weekend."
    state = machine.from_dict((await snapshot(tenv))["machine"])
    assert [a.verdict for a in state.answers] == ["good"] and tutor_frames(tenv.bob)[-1]["current_user_id"] == B


async def test_other_members_empty_or_old_voice_and_other_kinds_do_not_count(tenv):
    old = await _voice(tenv, A, "spoken before the question was asked")  # seq below the question
    await start(tenv)
    assert await tenv.tutor.on_message(tenv.room.id, old) is False  # R-AS15: only clips after the question
    assert await tenv.tutor.on_message(tenv.room.id, await _voice(tenv, B, "bob is not being asked")) is False
    assert await tenv.tutor.on_message(tenv.room.id, await _voice(tenv, A, "   ")) is False
    note = await tenv.store.append(tenv.room.id, lane="public", sender_kind="user", sender_id=A, kind="assist_request",
                                   text="not a chat message", now=NOW)
    assert await tenv.tutor.on_message(tenv.room.id, note) is False
    assert len(tenv.script.calls) == 1 and (await snapshot(tenv))["phase"] == "await_answer"
    assert tenv.tutor.timers()  # none of that reset or cancelled the question timer


async def test_text_answers_still_count_and_a_second_answer_does_not(tenv):
    await start(tenv)
    first = await tenv.store.append(tenv.room.id, lane="public", sender_kind="user", sender_id=A, kind="text",
                                    text="First answer.", now=NOW)
    assert await tenv.tutor.on_message(tenv.room.id, first) is True
    await tenv.hub.drain()
    again = await _voice(tenv, A, "I answer again but it is bob's turn")
    assert await tenv.tutor.on_message(tenv.room.id, again) is False


async def test_a_late_transcript_loses_to_the_sixty_second_skip(tenv):
    await start(tenv)
    clip = await _voice(tenv, A, "too late")  # uploaded while the question was open, transcribed after the skip
    await fire(tenv)  # the timer wins: alice is skipped, bob is asked
    calls = len(tenv.script.calls)
    assert await tenv.tutor.on_message(tenv.room.id, clip) is False
    await tenv.hub.drain()
    assert len(tenv.script.calls) == calls
    state = machine.from_dict((await snapshot(tenv))["machine"])
    assert [a.verdict for a in state.answers] == ["skip"]  # the late clip is neither an answer nor a second skip


async def test_an_answer_that_arrives_first_cancels_the_timer(tenv):
    await start(tenv)
    clip = await _voice(tenv, A, "just in time")
    assert await tenv.tutor.on_message(tenv.room.id, clip) is True
    await tenv.hub.drain()
    state = machine.from_dict((await snapshot(tenv))["machine"])
    assert [a.verdict for a in state.answers] == ["good"]  # the old timer never skipped alice afterwards
    assert tenv.clock.pending[0].cancelled()  # alice's timer died with her answer (bob's question armed a new one)


async def test_voice_answers_leave_no_text_in_the_logs(tenv, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    await start(tenv)
    await tenv.tutor.on_message(tenv.room.id, await _voice(tenv, A, "SECRET-VOICE-ANSWER-31"))
    await tenv.hub.drain()
    text = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("app"))
    assert "SECRET-VOICE-ANSWER-31" not in text


@pytest.mark.parametrize("answer_first", [True, False])
async def test_a_late_transcript_and_the_auto_skip_race_resolves_to_exactly_one_outcome(tenv, answer_first):
    """Both arrive while the tutor lock is held (the gate); the one queued first wins, the other is a no-op."""
    await start(tenv)
    clip = await _voice(tenv, A, "right at the deadline")
    timer = tenv.tutor._timers[tenv.room.id]
    live = [f for f in tenv.clock.pending if not f.done()][0]
    gate = tenv.tutor._lock(tenv.room.id)
    await gate.acquire()
    answer = None
    if answer_first:
        answer = asyncio.ensure_future(tenv.tutor.on_message(tenv.room.id, clip))
        for _ in range(20):
            await asyncio.sleep(0)
    live.set_result(None)  # the 60 s are up: the timer's skip now waits at the gate
    for _ in range(20):
        await asyncio.sleep(0)
    if not answer_first:
        answer = asyncio.ensure_future(tenv.tutor.on_message(tenv.room.id, clip))
        for _ in range(20):
            await asyncio.sleep(0)
    gate.release()
    taken = await asyncio.wait_for(answer, 10)
    await asyncio.wait({timer}, timeout=10)  # an answer that won has cancelled the waiting timer (disarm)
    assert timer.done()
    await tenv.hub.drain()
    assert taken is answer_first
    state = machine.from_dict((await snapshot(tenv))["machine"])
    assert [a.verdict for a in state.answers] == (["good"] if answer_first else ["skip"])
    assert len(tenv.script.calls) == 2  # one question, one follow-up turn: never two
