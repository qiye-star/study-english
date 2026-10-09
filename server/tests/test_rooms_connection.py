import asyncio
import json
from datetime import datetime, timezone

import pytest

from app.core.ratelimit import RateLimiter
from app.models import User
from app.providers.llm import LlmUnavailable
from app.rooms.connection import ConnDeps, RoomConnection
from app.rooms.hub import Conn, Dropped, RoomHub
from app.rooms.protocol import ProtocolError
from app.rooms.rules import RoomLimits
from app.rooms.store import RoomStore
from tests.test_rooms_hub import FakeSender

NOW = datetime(2026, 10, 9, 9, 0, tzinfo=timezone.utc)
A, B = 11111111, 22222222
ASSIST = json.dumps({"reply_zh": "巧克力是 chocolate。", "glossary": [{"src": "巧克力", "en": "chocolate"}],
                     "suggestions": [{"en": "I like chocolate.", "note_zh": "最常用"}]})


class Env:
    def __init__(self, app):
        self.hub = RoomHub()
        self.store = RoomStore(app.state.sessionmaker, RoomLimits(say_per_minute=3))
        self.replies = {"answer": "It means starting a conversation.", "assist": ASSIST}
        self.fail = False
        self.quota = {"room_assist": 99, "room_ai_global": 99}
        self.refunds = []

    def deps(self, ai_available=True):
        async def complete(messages, max_tokens, temperature):
            if self.fail:
                raise LlmUnavailable("http")
            return self.replies["assist"] if "<draft>" in messages[-1]["content"] else self.replies["answer"]

        async def consume(scope, subject, limit):
            self.quota[scope] -= 1
            return self.quota[scope] >= 0

        async def refund(scope, subject):
            self.refunds.append(scope)

        return ConnDeps(self.store, self.hub, self.store.limits, complete, consume, refund, lambda: NOW,
                        asyncio.Semaphore(2), RateLimiter(3), RateLimiter(30, 3600), RateLimiter(5, 600), ai_available)


@pytest.fixture
async def env(app):
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=A, username="alice", password_hash="x"), User(id=B, username="bob", password_hash="x")])
        await s.commit()
    e = Env(app)
    room = await e.store.create(A, "美食", NOW)
    await e.store.join(room.code, B, NOW)
    e.room = room
    e.alice, e.bob = Conn(A, FakeSender()), Conn(B, FakeSender())
    e.hub.attach(room.id, e.alice)
    e.hub.attach(room.id, e.bob)
    e.ca = RoomConnection(e.deps(), room.id, A, "alice", e.alice)
    e.cb = RoomConnection(e.deps(), room.id, B, "bob", e.bob)
    return e


def types(conn):
    return [ev["type"] for ev in conn.sender.sent]


async def test_say_acks_broadcasts_and_dedupes(env):
    await env.ca.handle('{"type":"say","client_id":"c1","text":"  hello  "}')
    assert types(env.alice) == ["ack", "message"] and types(env.bob) == ["message"]
    assert env.bob.sender.sent[0]["message"]["text"] == "hello"
    await env.ca.handle('{"type":"say","client_id":"c1","text":"hello"}')
    assert env.alice.sender.sent[-1] == {"type": "ack", "client_id": "c1", "seq": 1} and len(env.bob.sender.sent) == 1


async def test_rate_limit_and_empty(env):
    for i in range(3):
        await env.ca.handle(json.dumps({"type": "say", "client_id": f"c{i}", "text": "x"}))
    await env.ca.handle('{"type":"say","client_id":"c9","text":"x"}')
    assert env.alice.sender.sent[-1] == {"type": "error", "code": "rate_limited"}
    await env.ca.handle('{"type":"say","client_id":"c1","text":"x"}')  # a retried send still gets its ack
    assert env.alice.sender.sent[-1] == {"type": "ack", "client_id": "c1", "seq": 2}
    await env.cb.handle('{"type":"say","client_id":"z","text":"\\u0007"}')
    assert env.bob.sender.sent[-1] == {"type": "error", "code": "empty"}


async def test_at_ai_answers_publicly(env):
    await env.cb.handle('{"type":"say","client_id":"q","text":"@ai what does break the ice mean?"}')
    await env.hub.drain()
    assert types(env.alice) == ["message", "ai_typing", "message"]
    question, answer = env.alice.sender.sent[0]["message"], env.alice.sender.sent[2]["message"]
    assert question["ai_status"] == "pending"
    assert (answer["kind"], answer["sender"]["kind"], answer["reply_to"]) == ("ai_answer", "ai", question["seq"])
    rows, _ = await env.store.replay(env.room.id, A, 0, 10)
    assert rows[0][0].ai_status == "done"
    assert env.hub.ai_pending(env.room.id) == 0


async def test_at_ai_respects_owner_switch_and_failures(env):
    await env.store.update(env.room.id, A, ai_public=False)
    await env.cb.handle('{"type":"say","client_id":"q","text":"@ai hi there"}')
    assert {"type": "notice", "code": "ai_off"} in env.bob.sender.sent
    assert {"type": "notice", "code": "ai_off"} not in env.alice.sender.sent
    assert env.bob.sender.sent[-1]["message"]["ai_status"] is None
    await env.store.update(env.room.id, A, ai_public=True)
    env.fail = True
    await env.cb.handle('{"type":"say","client_id":"q2","text":"@ai hi again"}')
    await env.hub.drain()
    assert env.alice.sender.sent[-1]["type"] == "ai_failed" and env.alice.sender.sent[-1]["code"] == "upstream"
    assert env.refunds == ["room_ai_global"]
    rows, _ = await env.store.replay(env.room.id, A, 0, 10)
    assert rows[-1][0].ai_status == "failed"


async def test_at_ai_queue_is_bounded(env):
    for _ in range(env.store.limits.ai_queue):
        env.hub.ai_enter(env.room.id)
    await env.cb.handle('{"type":"say","client_id":"q","text":"@ai one more"}')
    assert {"type": "notice", "code": "ai_busy"} in env.bob.sender.sent
    env.quota["room_ai_global"] = 0
    for _ in range(env.store.limits.ai_queue):
        env.hub.ai_leave(env.room.id)
    await env.cb.handle('{"type":"say","client_id":"q2","text":"@ai and another"}')
    assert {"type": "notice", "code": "ai_quota"} in env.bob.sender.sent


async def test_assist_is_private_and_send_is_marked_assisted(env):
    await env.ca.handle('{"type":"assist","request_id":"r1","text":"I like 巧克力"}')
    await env.hub.drain()
    assert types(env.alice) == ["assist_reply"] and env.bob.sender.sent == []
    reply = env.alice.sender.sent[0]["message"]
    assert reply["lane"] == "private" and reply["meta"]["suggestions"][0]["en"] == "I like chocolate."
    await env.ca.handle(json.dumps({"type": "say", "client_id": "s1", "text": "I like chocolate.", "assist_id": reply["id"]}))
    assert env.bob.sender.sent[-1]["message"]["assisted"] is True
    await env.cb.handle(json.dumps({"type": "say", "client_id": "s2", "text": "steal", "assist_id": reply["id"]}))
    assert env.bob.sender.sent[-1] == {"type": "error", "code": "bad_assist"}
    # review #9: one suggestion marks one send; a reused assist_id is rejected, a retried send still gets its ack
    await env.ca.handle(json.dumps({"type": "say", "client_id": "s3", "text": "hi", "assist_id": reply["id"]}))
    assert env.alice.sender.sent[-1] == {"type": "error", "code": "bad_assist"}
    await env.ca.handle(json.dumps({"type": "say", "client_id": "s1", "text": "I like chocolate.", "assist_id": reply["id"]}))
    assert env.alice.sender.sent[-1]["type"] == "ack"


async def test_assist_quota_format_and_refunds(env):
    env.quota["room_assist"] = 0
    await env.ca.handle('{"type":"assist","request_id":"r1","text":"hi"}')
    assert env.alice.sender.sent[-1] == {"type": "assist_failed", "request_id": "r1", "code": "quota"}
    env.quota["room_assist"] = 5
    env.replies["assist"] = "no json here"
    await env.ca.handle('{"type":"assist","request_id":"r2","text":"hi"}')
    await env.hub.drain()
    assert env.alice.sender.sent[-1] == {"type": "assist_failed", "request_id": "r2", "code": "format"}
    assert env.refunds == []  # review #4: a draft can force non-JSON output, so a format failure still costs quota
    env.replies["assist"] = ASSIST
    env.fail = True
    await env.ca.handle('{"type":"assist","request_id":"r3","text":"hi"}')
    await env.hub.drain()
    assert env.alice.sender.sent[-1] == {"type": "assist_failed", "request_id": "r3", "code": "upstream"}
    assert env.refunds == ["room_assist", "room_ai_global"]


async def test_assist_one_in_flight_per_user_and_per_minute_limit(env):
    """Review #4: one user must not queue dozens of assist calls on the shared AI gate."""
    release = asyncio.Event()
    calls = []

    async def slow_complete(messages, max_tokens, temperature):
        calls.append(1)
        await release.wait()
        return ASSIST

    env.ca.deps.complete = slow_complete
    for i in range(3):
        await env.ca.handle(json.dumps({"type": "assist", "request_id": f"r{i}", "text": "hi"}))
    await asyncio.sleep(0)
    failed = [e for e in env.alice.sender.sent if e["type"] == "assist_failed"]
    assert [(e["request_id"], e["code"]) for e in failed] == [("r1", "quota"), ("r2", "quota")]
    assert env.quota["room_assist"] == 98  # only the admitted request consumed quota
    release.set()
    await env.hub.drain()
    assert len(calls) == 1 and env.alice.sender.sent[-1]["type"] == "assist_reply"
    env.ca.deps.assist_limiter = RateLimiter(1, 60)
    await env.ca.handle('{"type":"assist","request_id":"m1","text":"hi"}')
    await env.hub.drain()
    await env.ca.handle('{"type":"assist","request_id":"m2","text":"hi"}')
    assert env.alice.sender.sent[-1] == {"type": "assist_failed", "request_id": "m2", "code": "quota"}


async def test_welcome_replays_without_others_private_lane(env):
    await env.ca.handle('{"type":"assist","request_id":"r1","text":"I like 巧克力"}')
    await env.hub.drain()
    await env.ca.handle('{"type":"say","client_id":"c1","text":"hello"}')
    late = Conn(B, FakeSender())
    env.hub.attach(env.room.id, late)
    await RoomConnection(env.deps(), env.room.id, B, "bob", late).welcome(0)
    welcome = late.sender.sent[0]
    assert welcome["type"] == "welcome" and welcome["me"] == {"user_id": B, "role": "member"}
    assert welcome["assist_history"] == [] and {m["user_id"] for m in welcome["members"]} == {A, B}
    assert [e["message"]["lane"] for e in late.sender.sent[1:]] == ["public"]
    mine = Conn(A, FakeSender())
    env.hub.attach(env.room.id, mine)
    await RoomConnection(env.deps(), env.room.id, A, "alice", mine).welcome(3)
    assert [m["kind"] for m in mine.sender.sent[0]["assist_history"]] == ["assist_request", "assist_reply"]
    assert len(mine.sender.sent) == 1  # nothing after seq 3


async def test_dropped_connection_ends_its_receive_loop(env):
    env.hub.drop(env.room.id, env.alice)
    with pytest.raises(Dropped):
        await env.ca.handle('{"type":"ping"}')
    await env.hub.drain()
    assert env.alice.sender.closed == 1000 and env.hub.online(env.room.id) == {B}


async def test_protocol_errors(env):
    with pytest.raises(ProtocolError):
        await env.ca.handle('{"type":"hello","last_seq":0}')
    with pytest.raises(ProtocolError):
        await env.ca.handle("garbage")
    await env.ca.handle('{"type":"ping"}')
    assert env.alice.sender.sent[-1] == {"type": "pong"}
