from datetime import datetime, timedelta, timezone

import pytest

from app.agents.context import SourceResult
from app.agents.memory.cache import SnapshotCache
from app.agents.memory.retrieve import MemoryBlock
from app.agents.memory.store import ThreadKey
from tests.agents_memory_helpers import add_conversation, ctx, enable_agents, user_id_of

NOW = datetime(2026, 10, 12, 8, 0, tzinfo=timezone.utc)


@pytest.fixture
async def uid(client, auth_headers):
    return await user_id_of(client, auth_headers)


async def remember(app, uid, text, **kw):
    return await app.state.agent_memory.store.add(uid, kind=kw.get("kind", "goal"), text=text,
                                                  importance=kw.get("importance", 4),
                                                  persona_id=kw.get("persona_id"), source="chat")


def test_cache_expires_evicts_and_invalidates_per_user():
    clock = {"t": 0.0}
    cache = SnapshotCache(ttl_seconds=300, max_entries=2, clock=lambda: clock["t"])
    a, b = MemoryBlock("a", ("1",), 1, 1), MemoryBlock("b", (), 1, 0)
    cache.put((1, "conversation", "c1", "p"), a)
    cache.put((2, "conversation", "c2", "p"), b)
    assert cache.get((1, "conversation", "c1", "p")) is a
    cache.put((1, "room", "r1", "p"), b)  # the third entry evicts the least recently used one (user 2)
    assert cache.get((2, "conversation", "c2", "p")) is None
    clock["t"] = 301
    assert cache.get((1, "conversation", "c1", "p")) is None
    cache.put((1, "conversation", "c1", "p"), a)
    cache.put((1, "room", "r1", "p"), b)
    cache.invalidate_user(1)
    assert cache.get((1, "conversation", "c1", "p")) is None and cache.get((1, "room", "r1", "p")) is None


async def test_source_builds_a_private_block_and_freezes_it_for_the_thread(app, uid):
    enable_agents(app)
    rt = app.state.agent_memory
    await remember(app, uid, "Preparing for the IELTS exam")
    await rt.store.patch_profile(uid, {"level": "B1"}, [])
    assert rt.source.key == "memory" and rt.source.private is True
    result = await rt.source.load(ctx(uid))
    assert isinstance(result, SourceResult)
    assert (result.label_key, result.params) == ("agents.step.memory", {"count": 1})
    assert "Preparing for the IELTS exam" in result.block and "[profile] level: B1" in result.block
    await remember(app, uid, "Has a cat called Mimi", kind="fact", importance=5)
    assert (await rt.source.load(ctx(uid))).block == result.block  # snapshot within the thread (spec §6.3)
    rt.cache.invalidate_user(uid)
    assert "Has a cat called Mimi" in (await rt.source.load(ctx(uid))).block


@pytest.mark.parametrize("server, prefs, in_room", [
    ({"agents_memory_enabled": False}, {}, False),
    ({}, {"memory_enabled": False}, False),
    ({}, {"tools": {"memory": False}}, False),
    ({}, {"share_in_rooms": False}, True),
])
async def test_source_is_skipped_when_any_switch_is_off(app, uid, server, prefs, in_room):
    enable_agents(app, **server)
    await remember(app, uid, "Preparing for IELTS")
    assert await app.state.agent_memory.source.load(
        ctx(uid, in_room=in_room, thread="r1" if in_room else "c1", **prefs)) is None


async def test_source_reads_shared_and_own_persona_items_only(app, uid):
    enable_agents(app)
    await remember(app, uid, "shared fact here", kind="fact")
    await remember(app, uid, "waiter only fact", kind="fact", persona_id="builtin:waiter")
    block = (await app.state.agent_memory.source.load(ctx(uid))).block
    assert "shared fact here" in block and "waiter only fact" not in block


async def test_source_includes_the_thread_summary(app, uid):
    enable_agents(app)
    await add_conversation(app, uid)
    store, key = app.state.agent_memory.store, ThreadKey("conversation", "c1")
    await store.touch_thread(uid, key, at=NOW, text="hi", count_turn=True, idle=timedelta(minutes=30))
    await store.save_summary(uid, key, summary="我们聊过点餐", summarized_count=6, rolls_since_recap=1)
    result = await app.state.agent_memory.source.load(ctx(uid))
    assert "[earlier in this chat] 我们聊过点餐" in result.block and result.params == {"count": 0}


async def test_source_returns_none_without_any_memory(app, uid):
    enable_agents(app)
    assert await app.state.agent_memory.source.load(ctx(uid)) is None
