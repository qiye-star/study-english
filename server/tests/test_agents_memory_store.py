from datetime import datetime, timedelta, timezone

import pytest

from app.agents.memory.profile import ProfileError
from app.agents.memory.store import MemoryNotFound, MemoryStore, ThreadKey, memory_counts
from app.agents.memory.tombstones import REDACTED
from tests.agents_memory_helpers import add_conversation, user_id_of

NOW = datetime(2026, 10, 12, 8, 0, tzinfo=timezone.utc)
IDLE = timedelta(minutes=30)


@pytest.fixture
async def uid(client, auth_headers):
    return await user_id_of(client, auth_headers)


@pytest.fixture
def store(app):
    return MemoryStore(app.state.sessionmaker, clock=lambda: NOW)


async def add(store, uid, text, **kw):
    return await store.add(uid, kind=kw.pop("kind", "fact"), text=text, importance=kw.pop("importance", 3),
                           persona_id=kw.pop("persona_id", None), source=kw.pop("source", "chat"))


async def test_add_dedupes_by_normalised_text_and_keeps_the_higher_importance(store, uid):
    a = await add(store, uid, "Wants to pass IELTS.", kind="goal", importance=2)
    b = await add(store, uid, "wants to pass ielts", kind="goal", importance=4, persona_id="builtin:coach")
    assert a is not None and b is not None and b.id == a.id and b.importance == 4
    rows, nxt = await store.items(uid)
    assert len(rows) == 1 and nxt is None and rows[0].persona_id is None


async def test_user_delete_buries_the_text_so_it_never_comes_back(store, uid):
    row = await add(store, uid, "Has a cat named Mimi")
    assert await store.delete(uid, row.id, by_user=True) is True
    assert await add(store, uid, "has a cat named mimi!", importance=5) is None
    assert (await store.items(uid))[0] == []
    other = await add(store, uid, "Has a dog")
    assert await store.update(uid, other.id, text="Has a cat named Mimi") is False
    assert await store.delete(uid, row.id, by_user=True) is False


async def test_agent_cannot_touch_pinned_items_and_agent_delete_is_not_a_tombstone(store, uid):
    row = await add(store, uid, "Practise every evening", kind="goal")
    assert (await store.pin(uid, row.id, True)).pinned is True
    assert await store.update(uid, row.id, importance=5) is False
    assert await store.delete(uid, row.id, by_user=False) is False
    await store.pin(uid, row.id, False)
    assert await store.update(uid, row.id, text="Practise every morning", importance=5) is True
    assert await store.delete(uid, row.id, by_user=False) is True
    assert await add(store, uid, "Practise every morning", kind="goal") is not None
    with pytest.raises(MemoryNotFound):
        await store.pin(uid, "missing", True)


async def test_items_filter_order_and_cursor(store, uid):
    for n in range(5):
        await add(store, uid, f"memory {n}", kind="goal" if n % 2 else "fact",
                  persona_id="builtin:coach" if n == 4 else None)
    first, nxt = await store.items(uid, limit=2)
    second, nxt2 = await store.items(uid, cursor=nxt, limit=2)
    third, nxt3 = await store.items(uid, cursor=nxt2, limit=2)
    assert (nxt, nxt2, nxt3) == ("2", "4", None)
    assert len({r.id for r in first + second + third}) == 5
    assert len((await store.items(uid, kind="fact"))[0]) == 3
    assert len((await store.items(uid, persona_id="shared"))[0]) == 4
    assert len((await store.items(uid, persona_id="builtin:coach"))[0]) == 1
    assert await store.persona_counts(uid) == [(None, 4), ("builtin:coach", 1)]
    with pytest.raises(ValueError):
        await store.items(uid, cursor="abc")


async def test_pinned_items_come_first(store, uid):
    a = await add(store, uid, "first memory")
    await add(store, uid, "second memory")
    await store.pin(uid, a.id, True)
    assert (await store.items(uid))[0][0].id == a.id


async def test_evict_keeps_pinned_and_drops_the_weakest(app, uid):
    clock = {"now": NOW - timedelta(days=90)}
    store = MemoryStore(app.state.sessionmaker, clock=lambda: clock["now"])
    await add(store, uid, "old weak memory", importance=1)
    pinned = await add(store, uid, "pinned memory", importance=1)
    await store.pin(uid, pinned.id, True)
    clock["now"] = NOW
    keep = await add(store, uid, "fresh strong memory", importance=5)
    assert await store.evict(uid, 2) == 1
    assert {r.id for r in (await store.items(uid))[0]} == {pinned.id, keep.id}
    assert await store.evict(uid, 2) == 0


async def test_profile_patch_and_proposals(store, uid):
    state = await store.patch_profile(uid, {"level": "B1", "goals": ["雅思 7 分"]}, [])
    assert state.data == {"level": "B1", "goals": ["雅思 7 分"]} and state.edited_keys == ["level", "goals"]
    assert await store.propose(uid, "level", "B2") == "proposed"
    assert await store.propose(uid, "native", "中文") == "applied"
    state = await store.profile(uid)
    assert state.proposals == {"level": "B2"} and state.data["native"] == "中文"
    with pytest.raises(ProfileError):
        await store.patch_profile(uid, {"level": "Z9"}, [])
    assert (await store.profile(uid)).data["level"] == "B1"


async def test_recaps_are_redacted_paged_and_deletable(store, uid):
    a = await store.add_recap(uid, source="conversation", text="聊了旅行,邮箱 a@b.co", persona_id="builtin:coach")
    assert "a@b.co" not in a.text and REDACTED in a.text
    b = await store.add_recap(uid, source="tutor", text="8 题答对 6 题", tutor_session_id="t-1")
    page, nxt = await store.recaps(uid, limit=1)
    assert len(page) == 1 and nxt == "1"
    assert {r.id for r in page + (await store.recaps(uid, cursor=nxt, limit=1))[0]} == {a.id, b.id}
    assert await store.delete_recap(uid, a.id) is True and await store.delete_recap(uid, a.id) is False


async def test_touch_thread_counts_turns_and_detects_the_idle_gap(store, app, uid):
    await add_conversation(app, uid)
    key = ThreadKey("conversation", "c1")
    t1 = await store.touch_thread(uid, key, at=NOW, text="one", count_turn=True, idle=IDLE)
    t2 = await store.touch_thread(uid, key, at=NOW + timedelta(minutes=5), text="two", count_turn=True, idle=IDLE)
    assert (t1.gap, t2.turns, t2.pending) == (False, 2, ("one", "two"))
    t3 = await store.touch_thread(uid, key, at=NOW + timedelta(minutes=40), text="three", count_turn=True, idle=IDLE)
    assert t3.gap and t3.gap_pending == ("one", "two") and (t3.turns, t3.pending) == (1, ("three",))
    assert t3.gap_segment == (NOW, NOW + timedelta(minutes=5))
    t4 = await store.touch_thread(uid, key, at=NOW + timedelta(minutes=41), text=None, count_turn=False, idle=IDLE)
    assert (t4.gap, t4.turns) == (False, 1)
    await store.clear_pending(uid, key)
    t5 = await store.touch_thread(uid, key, at=NOW + timedelta(minutes=42), text="x" * 400, count_turn=True, idle=IDLE)
    assert t5.turns == 1 and t5.pending == ("x" * 300,)


async def test_clear_persona_then_all_and_export(store, uid):
    shared = await add(store, uid, "shared memory")
    await add(store, uid, "coach memory", persona_id="builtin:coach")
    await store.add_recap(uid, source="tutor", text="tutor recap text", persona_id="builtin:coach")
    await store.patch_profile(uid, {"level": "B1"}, [])
    data = await store.export(uid)
    assert data["version"] == 1 and {i["text"] for i in data["items"]} == {"shared memory", "coach memory"}
    assert data["profile"]["data"] == {"level": "B1"} and len(data["recaps"]) == 1 and data["tombstones"] == 0
    assert set(data) == {"version", "exported_at", "profile", "items", "recaps", "threads", "tombstones"}
    assert await store.clear(uid, "persona", "builtin:coach") == {"items": 1, "recaps": 1, "threads": 0,
                                                                   "profile": False}
    assert [r.id for r in (await store.items(uid))[0]] == [shared.id]
    assert await store.clear(uid, "all") == {"items": 1, "recaps": 0, "threads": 0, "profile": True}
    assert (await store.export(uid))["tombstones"] == 2
    assert await add(store, uid, "coach memory") is None
    with pytest.raises(ValueError):
        await store.clear(uid, "persona")


async def test_memory_counts_are_numbers_only(app, store, uid):
    await add(store, uid, "one memory")
    async with app.state.sessionmaker() as s:
        counts = await memory_counts(s)
    assert counts == {"items": 1, "pinned_items": 0, "users_with_items": 1, "profiles": 0, "recaps": 0,
                      "thread_states": 0, "tombstones": 0}
