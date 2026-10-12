"""RoomStore.agent_of / message_named (plan addressing-server R1)."""
from datetime import datetime, timezone

import pytest

from app.models import User
from app.rooms.rules import RoomLimits
from app.rooms.store import RoomStore

NOW = datetime(2026, 10, 12, 9, 0, tzinfo=timezone.utc)
A, B = 11111111, 22222222
EMMA = {"persona_id": "builtin:coach", "name": "Emma"}


@pytest.fixture
async def env(app):
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=A, username="alice", password_hash="x"), User(id=B, username="bob", password_hash="x")])
        await s.commit()
    store = RoomStore(app.state.sessionmaker, RoomLimits())
    room = await store.create(A, "面试", NOW)
    await store.join(room.code, B, NOW)
    return store, room


async def put(store, room, **kw):
    fields = dict(lane="public", sender_kind="ai", sender_id=None, kind="ai_answer", text="Sure.", now=NOW)
    return await store.append(room.id, **{**fields, **kw})


async def test_agent_of_reads_the_persona_of_a_public_visible_agent_answer(env):
    store, room = env
    answer = await put(store, room, meta={"agent": EMMA, "asker": {"id": B, "name": "bob"}})
    assert await store.agent_of(room.id, answer.seq) == "builtin:coach"
    legacy = await put(store, room)  # an old `@ai` answer: no meta
    human = await put(store, room, sender_kind="user", sender_id=A, kind="text", text="hi")
    voice = await put(store, room, sender_kind="user", sender_id=A, kind="voice", text="", meta={"to_agent": "builtin:coach"})
    trace = await put(store, room, lane="private", audience_id=B, kind="agent_trace", text="", meta={"agent": EMMA})
    odd = await put(store, room, meta={"agent": {"persona_id": 5, "name": "x"}})
    for m in (legacy, human, voice, trace, odd):
        assert await store.agent_of(room.id, m.seq) is None, m.kind
    assert await store.agent_of(room.id, 999) is None
    other = await store.create(B, "other", NOW)
    assert await store.agent_of(other.id, answer.seq) is None  # a seq of another room never matches


async def test_agent_of_ignores_hidden_answers(env):
    store, room = env
    answer = await put(store, room, meta={"agent": EMMA})
    await store.hide(room.id, answer.id, NOW)
    assert await store.agent_of(room.id, answer.seq) is None


async def test_message_named_returns_the_row_and_the_sender_name(env):
    store, room = env
    m = await put(store, room, sender_kind="user", sender_id=A, kind="voice", text="hello there",
                  meta={"to_agent": "builtin:coach"})
    row, name = await store.message_named(m.id)
    assert (row.id, row.kind, row.text, row.meta, name) == (m.id, "voice", "hello there",
                                                            {"to_agent": "builtin:coach"}, "alice")
    ai = await put(store, room)
    assert (await store.message_named(ai.id))[1] is None
    assert await store.message_named("nope") is None
