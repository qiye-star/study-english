import asyncio
import json
import logging
from dataclasses import replace
from datetime import datetime, timezone

import pytest

from app.agents.trace import Delta, Done, Error, Step, Thought
from app.core.ratelimit import RateLimiter
from app.models import User
from app.rooms.agent_lane import AgentLane, AgentLaneDeps, AgentPrefs
from app.rooms.connection import ConnDeps, RoomConnection
from app.rooms.hub import Conn, RoomHub
from app.rooms.rules import RoomLimits
from app.rooms.store import RoomStore
from tests.test_rooms_agents_pure import FakeLookup, persona
from tests.test_rooms_hub import FakeSender

NOW = datetime(2026, 10, 12, 9, 0, tzinfo=timezone.utc)
A, B = 11111111, 22222222
EMMA = persona("builtin:coach", "Emma")
LEO = persona("0b6c1f3e-2a4d-4c5e-9f00-1234567890ab", "Leo", owner_id=A)
STEP = dict(id="s1", group="context", key="learned_words", status="done", label_key="agents.step.learned_words",
            params={"count": 6}, ms=12, private=True)


class Script:
    """A fake orchestrator: records (deps, req) and yields A1's event dataclasses."""

    def __init__(self):
        self.replies = {EMMA.id: "Sure, try: I never abandon a project halfway.", LEO.id: "The grammar is right."}
        self.calls = []
        self.error = None
        self.block: asyncio.Event | None = None

    async def run_turn(self, deps, req):
        self.calls.append((deps, req))
        yield Step(**STEP)
        yield Thought(source="summary", text="look up abandon")
        if self.block is not None:
            await self.block.wait()
        if self.error is not None:
            yield Error(code=self.error)
            return
        text = self.replies[req.persona.id]
        yield Delta(text=text)
        yield Done(usage=None, trace={"steps": [{"key": "learned_words", "status": "done"}]}, text_len=len(text))


class Env:
    def __init__(self, app):
        self.hub = RoomHub()
        self.store = RoomStore(app.state.sessionmaker, RoomLimits())
        self.quota = {"room_assist": 99, "room_ai_global": 99}
        self.refunds: list[str] = []
        self.script = Script()
        self.prefs = {A: AgentPrefs(), B: AgentPrefs()}
        self.feature = True
        self.ai_on = True
        self.lookup = FakeLookup(EMMA, LEO)

        async def consume(scope, subject, limit):
            self.quota[scope] = self.quota.get(scope, 99) - 1
            return self.quota[scope] >= 0

        async def refund(scope, subject):
            self.refunds.append(scope)

        async def complete(messages, max_tokens, temperature):
            return "It means starting a conversation."

        async def prefs(user_id):
            return self.prefs[user_id]

        self.lane = AgentLane(AgentLaneDeps(personas=self.lookup, run_turn=self.script.run_turn,
                                            turn_deps=lambda **kw: kw, prefs=prefs, feature_on=lambda: self.feature,
                                            turn_timeout=5.0), rooms=lambda: self.deps)
        self.deps = ConnDeps(self.store, self.hub, lambda: self.store.limits, complete, consume, refund, lambda: NOW,
                             asyncio.Semaphore(2), RateLimiter(20), RateLimiter(30, 3600), RateLimiter(5, 600),
                             lambda: self.ai_on, agents=self.lane)


@pytest.fixture
async def env(app):
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=A, username="alice", password_hash="x"), User(id=B, username="bob", password_hash="x")])
        await s.commit()
    e = Env(app)
    e.room = await e.store.create(A, "面试", NOW)
    await e.store.join(e.room.code, B, NOW)
    await e.store.set_agents(e.room.id, A, [EMMA.id, LEO.id])
    e.alice, e.bob = Conn(A, FakeSender()), Conn(B, FakeSender())
    e.hub.attach(e.room.id, e.alice)
    e.hub.attach(e.room.id, e.bob)
    e.ca = RoomConnection(e.deps, e.room.id, A, "alice", e.alice)
    e.cb = RoomConnection(e.deps, e.room.id, B, "bob", e.bob)
    return e


def types(conn):
    return [ev["type"] for ev in conn.sender.sent]


def say(text, client_id="q"):
    return json.dumps({"type": "say", "client_id": client_id, "text": text})


async def test_mention_runs_one_turn_and_keeps_the_process_private(env):
    await env.cb.handle(say("@Emma can I use abandon here?"))
    await env.hub.drain()
    assert types(env.bob) == ["ack", "message", "ai_typing", "agent_step", "agent_thought", "message", "message"]
    assert types(env.alice) == ["message", "ai_typing", "message"]
    question, answer = env.alice.sender.sent[0]["message"], env.alice.sender.sent[2]["message"]
    assert question["ai_status"] == "pending"
    assert (answer["kind"], answer["sender"]["kind"], answer["reply_to"]) == ("ai_answer", "ai", question["seq"])
    assert answer["meta"] == {"agent": {"persona_id": EMMA.id, "name": "Emma"}, "asker": {"id": B, "name": "bob"}}
    step = env.bob.sender.sent[3]
    assert step["reply_to"] == question["seq"] and step["step"]["key"] == "learned_words" and step["step"]["private"]
    trace = env.bob.sender.sent[-1]["message"]
    assert (trace["lane"], trace["kind"], trace["reply_to"]) == ("private", "agent_trace", answer["seq"])
    assert trace["meta"]["trace"] == {"steps": [{"key": "learned_words", "status": "done"}]}
    deps, req = env.script.calls[0]
    assert (req.user_id, req.in_room, req.mode, req.room_id, req.conversation_id) == (B, True, "chat", env.room.id, None)
    assert req.text == "bob: can I use abandon here?" and req.persona is EMMA
    assert deps["allow_private"] is True and deps["memory"] is True and deps["modes"]["chat"].name == "chat"
    rows, _ = await env.store.replay(env.room.id, A, 0, 10)
    assert rows[0][0].ai_status == "done" and all(m.kind != "agent_trace" for m, _ in rows)
    assert env.hub.ai_pending(env.room.id) == 0


async def test_rooms_without_agents_and_at_ai_keep_the_old_frames(env):
    await env.cb.handle(say("@ai what does break the ice mean?"))
    await env.hub.drain()
    assert types(env.alice) == ["message", "ai_typing", "message"]
    assert env.alice.sender.sent[2]["message"]["meta"] is None and env.script.calls == []
    await env.store.set_agents(env.room.id, A, [])
    await env.cb.handle(say("@Emma hi there", "q2"))
    await env.hub.drain()
    assert types(env.bob)[-2:] == ["ack", "message"] and env.bob.sender.sent[-1]["message"]["ai_status"] is None
    assert env.script.calls == []


async def test_unknown_names_are_plain_messages(env):
    await env.cb.handle(say("@Emmanuel hi"))
    await env.hub.drain()
    assert types(env.bob) == ["ack", "message"] and env.script.calls == []


async def test_gates_ai_muted_ai_public_switch_and_disabled_persona(env):
    # a refused route: notice (this connection only), then the message is stored as a plain one (ack + broadcast)
    await env.store.set_ai_muted(env.room.id, True)
    await env.cb.handle(say("@Emma hi"))
    assert types(env.bob)[-3:] == ["notice", "ack", "message"]
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "ai_off"}
    assert env.bob.sender.sent[-1]["message"]["ai_status"] is None
    assert {"type": "notice", "code": "ai_off"} not in env.alice.sender.sent
    await env.store.set_ai_muted(env.room.id, False)
    await env.store.update(env.room.id, A, ai_public=False)
    await env.cb.handle(say("@Emma hi", "q2"))
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "ai_off"}
    await env.store.update(env.room.id, A, ai_public=True)
    env.feature = False
    await env.cb.handle(say("@Emma hi", "q3"))
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "agent_off"}
    env.feature = True
    env.lookup.by_id[LEO.id] = replace(LEO, disabled=True)
    await env.cb.handle(say("@Leo hi", "q4"))
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "agent_off"}
    await env.hub.drain()
    assert env.script.calls == [] and env.hub.ai_pending(env.room.id) == 0


async def test_queue_cap_and_daily_quota_are_shared_with_at_ai(env):
    for _ in range(env.store.limits.ai_queue):
        env.hub.ai_enter(env.room.id)
    await env.cb.handle(say("@Emma one more"))
    assert {"type": "notice", "code": "ai_busy"} in env.bob.sender.sent
    for _ in range(env.store.limits.ai_queue):
        env.hub.ai_leave(env.room.id)
    env.quota["room_ai_global"] = 0
    await env.cb.handle(say("@Emma and another", "q2"))
    assert {"type": "notice", "code": "ai_quota"} in env.bob.sender.sent
    assert env.hub.ai_pending(env.room.id) == 0


async def test_agents_turn_limit_and_upstream_failures_refund_and_fail_the_question(env):
    env.script.error = "limit"
    await env.cb.handle(say("@Emma hi"))
    await env.hub.drain()
    assert env.alice.sender.sent[-1] == {"type": "ai_failed", "reply_to": 1, "code": "quota"}
    assert env.refunds == ["room_ai_global"]
    env.script.error = "llm_unavailable"
    await env.cb.handle(say("@Emma hi again", "q2"))
    await env.hub.drain()
    assert env.alice.sender.sent[-1]["code"] == "upstream"
    rows, _ = await env.store.replay(env.room.id, A, 0, 10)
    assert [m.ai_status for m, _ in rows] == ["failed", "failed"]


async def test_a_hanging_turn_times_out(env):
    env.script.block = asyncio.Event()
    env.lane.deps.turn_timeout = 0.05
    await env.cb.handle(say("@Emma hi"))
    await env.hub.drain()
    assert env.alice.sender.sent[-1] == {"type": "ai_failed", "reply_to": 1, "code": "upstream"}
    assert env.hub.ai_pending(env.room.id) == 0


async def test_one_agent_turn_per_room_at_a_time(env):
    env.script.block = asyncio.Event()
    await env.cb.handle(say("@Emma first"))
    await env.ca.handle(say("@Leo second", "a1"))
    for _ in range(20):
        await asyncio.sleep(0.01)
    assert len(env.script.calls) == 1  # the second waits for the room's AI lock
    env.script.block.set()
    await env.hub.drain()
    assert [req.persona.id for _, req in env.script.calls] == [EMMA.id, LEO.id]


async def test_hand_off_runs_once_with_depth_one(env):
    env.script.replies[EMMA.id] = "Good question. @Leo can check the grammar."
    env.script.replies[LEO.id] = "Looks right to me. @Emma agrees."
    await env.cb.handle(say("@Emma is this sentence right?"))
    await env.hub.drain()
    assert [req.persona.id for _, req in env.script.calls] == [EMMA.id, LEO.id]  # never a third turn
    answers = [e["message"] for e in env.alice.sender.sent if e["type"] == "message" and e["message"]["kind"] == "ai_answer"]
    assert answers[1]["meta"]["handoff_from"] == {"persona_id": EMMA.id, "name": "Emma"}
    assert answers[1]["reply_to"] == answers[0]["seq"] and answers[1]["meta"]["asker"]["id"] == B
    deps, req = env.script.calls[1]
    assert deps["memory"] is False and req.user_id == B
    assert req.history[-1] == {"role": "user", "content": "Emma: Good question. @Leo can check the grammar."}


async def test_share_in_rooms_memory_and_show_process_preferences(env):
    env.prefs[B] = AgentPrefs(share_in_rooms=False, memory_enabled=False, show_process=False)
    await env.cb.handle(say("@Emma hi"))
    await env.hub.drain()
    deps, _ = env.script.calls[0]
    assert deps["allow_private"] is False and deps["memory"] is False
    assert "agent_step" not in types(env.bob) and "agent_thought" not in types(env.bob)
    assert env.bob.sender.sent[-1]["message"]["kind"] == "agent_trace"  # the trace is still kept


async def test_logs_never_carry_text_names_or_words(env, caplog):
    caplog.set_level(logging.DEBUG, logger="app")  # the app's own records; aiosqlite DEBUG logs SQL parameters
    env.script.replies[EMMA.id] = "SECRET-REPLY-5521"
    await env.cb.handle(say("@Emma SECRET-QUESTION-8810"))
    await env.hub.drain()
    env.script.error = "llm_unavailable"
    await env.cb.handle(say("@Emma SECRET-QUESTION-8811", "q2"))
    await env.hub.drain()
    text = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("app"))
    for secret in ("SECRET-REPLY-5521", "SECRET-QUESTION-88", "Emma", "abandon", "bob"):
        assert secret not in text
    assert "room agent turn failed code=upstream" in text
