from datetime import datetime, timezone

import pytest

from app.models import User
from app.rooms.rules import RoomLimits
from app.rooms.store import AI_NAME, RoomError, RoomStore, room_out

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


async def test_room_out_lists_agent_ids_and_set_agents_is_owner_only(env):
    store, room = env
    assert room_out(room, my_role="owner", member_count=2, online_count=0)["agent_ids"] == []
    with pytest.raises(RoomError) as e:
        await store.set_agents(room.id, B, ["builtin:coach"])
    assert e.value.code == "forbidden"
    updated, changed = await store.set_agents(room.id, A, ["builtin:coach", "builtin:interviewer"])
    assert changed and updated.agent_config == {"persona_ids": ["builtin:coach", "builtin:interviewer"], "chosen_by": A}
    assert room_out(updated, my_role=None, member_count=2, online_count=0)["agent_ids"] == ["builtin:coach", "builtin:interviewer"]
    _, again = await store.set_agents(room.id, A, ["builtin:coach", "builtin:interviewer"])
    assert again is False
    cleared, changed = await store.set_agents(room.id, A, [])
    assert changed and cleared.agent_config is None


async def test_tutor_snapshot_round_trip_and_blocks_agent_changes(env):
    store, room = env
    await store.set_agents(room.id, A, ["builtin:coach"])
    await store.set_tutor(room.id, {"phase": "await_answer", "run_id": "r1"})
    assert await store.tutor_rooms() == [(room.id, {"phase": "await_answer", "run_id": "r1"})]
    with pytest.raises(RoomError) as e:
        await store.set_agents(room.id, A, [])
    assert e.value.code == "tutor_active"
    await store.set_tutor(room.id, None)
    assert await store.tutor_rooms() == []
    assert (await store.room(room.id)).agent_tutor is None  # SQL NULL, not JSON 'null'


async def test_agent_answers_are_named_in_context_and_quotes(env):
    store, room = env
    q = await store.append(room.id, lane="public", sender_kind="user", sender_id=B, kind="text",
                           text="@Emma can I say this?", now=NOW)
    a = await store.append(room.id, lane="public", sender_kind="ai", sender_id=None, kind="ai_answer",
                           text="Sure.", now=NOW, reply_to=q.seq, meta={"agent": EMMA, "asker": {"id": B, "name": "bob"}})
    legacy = await store.append(room.id, lane="public", sender_kind="ai", sender_id=None, kind="ai_answer",
                                text="It means hello.", now=NOW, reply_to=q.seq)
    assert await store.recent_public(room.id, 10) == [("bob", "@Emma can I say this?"), ("Emma", "Sure."),
                                                      (AI_NAME, "It means hello.")]
    assert (await store.quote_for(room.id, a.seq))["name"] == "Emma"
    assert (await store.quote_for(room.id, legacy.seq))["name"] == AI_NAME
    assert await store.agent_context(room.id, 10, before_seq=legacy.seq) == [
        ("bob", "@Emma can I say this?", None), ("Emma", "Sure.", "builtin:coach")]


async def test_assist_history_ignores_agent_traces(env):
    store, room = env
    await store.append(room.id, lane="private", audience_id=B, sender_kind="user", sender_id=B, kind="assist_request",
                       text="巧克力", now=NOW)
    await store.append(room.id, lane="private", audience_id=B, sender_kind="ai", sender_id=None, kind="agent_trace",
                       text="", now=NOW, reply_to=1, meta={"turn_id": "t1", "trace": {"steps": []}})
    assert [m.kind for m, _ in await store.assist_history(room.id, B, 10)] == ["assist_request"]
