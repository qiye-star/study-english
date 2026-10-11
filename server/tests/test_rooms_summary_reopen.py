import json
import logging
from datetime import datetime, timedelta, timezone

import pytest

from app.models import User
from app.rooms.rules import RoomLimits
from app.rooms.store import RoomStore, opened_anchor
from app.rooms.summary_store import SummaryRunner, SummaryStore

T0 = datetime(2026, 10, 12, 9, 0, tzinfo=timezone.utc)
A = 11111111


def good(word):
    return json.dumps({"overview_zh": f"聊了{word}。", "words": [{"en": word, "zh": "词", "example": f"I like {word}."}], "fixes": []})


@pytest.fixture
async def env(app):
    async with app.state.sessionmaker() as s:
        s.add(User(id=A, username="alice", password_hash="x"))
        await s.commit()
    rooms = RoomStore(app.state.sessionmaker, RoomLimits(max_owned=5))
    room = await rooms.create(A, "", T0)
    st = {"now": T0, "raw": good("noodles"), "fail": False, "quota": 99}

    async def complete(messages, max_tokens, temperature):
        if st["fail"]:
            raise RuntimeError("upstream")
        return st["raw"]

    async def consume(scope, subject, limit):
        st["quota"] -= 1
        return st["quota"] >= 0

    async def refund(scope, subject):
        st["quota"] += 1

    async def template(key):
        return None

    async def room_info(_id):
        return ("B1", "Free conversation.", "alice")

    async def opened_of(room_id):
        r = await rooms.room(room_id)
        return opened_anchor(r) if r.reopen_count else None

    store = SummaryStore(app.state.sessionmaker)
    runner = SummaryRunner(store=store, complete=complete, consume=consume, refund=refund, template=template,
                           room_info=room_info, limits=lambda: RoomLimits(summary_min_messages=2),
                           available=lambda: True, model=lambda: "m", clock=lambda: st["now"], opened_of=opened_of)
    return rooms, room, store, runner, st


async def say(rooms, room, n, at, prefix="I go"):
    for i in range(n):
        await rooms.append(room.id, lane="public", sender_kind="user", sender_id=A, kind="text", text=f"{prefix} {i}", now=at)


async def end_and_reopen(rooms, room, st, hours):
    await rooms.close(room.id, "owner", st["now"])
    st["now"] = st["now"] + timedelta(hours=hours)
    await rooms.reopen(room.id, A, st["now"])


async def test_second_close_regenerates_and_overwrites(env):
    rooms, room, store, runner, st = env
    await say(rooms, room, 3, T0)
    assert await runner.run(room.id) == "done"
    first = await store.get(room.id)
    assert first.data["words"][0]["en"] == "noodles"
    await end_and_reopen(rooms, room, st, 1)
    await say(rooms, room, 3, st["now"], prefix="Then")
    await rooms.close(room.id, "owner", st["now"] + timedelta(minutes=5))
    st["now"] += timedelta(minutes=5)
    st["raw"] = good("coffee")
    assert await runner.run(room.id) == "done"
    row = await store.get(room.id)
    assert row.status == "done" and row.reason is None and row.data["words"][0]["en"] == "coffee"
    assert row.attempts == 1 and row.created_at > first.created_at


async def test_regeneration_failure_keeps_the_old_summary_readable(env, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    rooms, room, store, runner, st = env
    await say(rooms, room, 3, T0)
    await runner.run(room.id)
    old = (await store.get(room.id)).data
    await end_and_reopen(rooms, room, st, 1)
    await rooms.close(room.id, "idle", st["now"])
    st["fail"] = True
    assert await runner.run(room.id) == "failed"  # the run reports what happened ...
    row = await store.get(room.id)
    assert (row.status, row.reason, row.data) == ("done", "stale", old)  # ... the stored summary is the old one (R-O5)
    assert "noodles" not in caplog.text and "I go" not in caplog.text and room.id in caplog.text


async def test_stale_summary_can_be_retried_while_attempts_remain(env):
    rooms, room, store, runner, st = env
    await say(rooms, room, 3, T0)
    await runner.run(room.id)
    await end_and_reopen(rooms, room, st, 1)
    await rooms.close(room.id, "owner", st["now"])
    st["fail"] = True
    await runner.run(room.id)
    assert await store.start(room.id, st["now"], 2) is True  # attempts 1 < 2: the retry endpoint may claim it
    st["fail"] = False
    st["raw"] = good("tea")
    assert await runner.generate(room.id) == "done"
    row = await store.get(room.id)
    assert row.status == "done" and row.reason is None and row.data["words"][0]["en"] == "tea" and row.attempts == 2
    st["fail"] = True
    await store.start(room.id, st["now"], 2)  # no: attempts exhausted
    assert (await store.get(room.id)).attempts == 2


async def test_a_room_that_was_never_reopened_is_not_regenerated(env):
    rooms, room, store, runner, st = env
    await say(rooms, room, 3, T0)
    await runner.run(room.id)
    st["raw"] = good("coffee")
    assert await runner.run(room.id) == "done"
    assert (await store.get(room.id)).data["words"][0]["en"] == "noodles"


async def test_a_skipped_first_summary_is_regenerated_after_a_busier_second_session(env):
    rooms, room, store, runner, st = env
    await say(rooms, room, 1, T0)  # too few messages
    assert await runner.run(room.id) == "skipped"
    await end_and_reopen(rooms, room, st, 1)
    await say(rooms, room, 4, st["now"], prefix="More")
    await rooms.close(room.id, "owner", st["now"])
    assert await runner.run(room.id) == "done"
    assert (await store.get(room.id)).data["words"][0]["en"] == "noodles"


async def test_regeneration_still_spends_the_daily_budget(env):
    rooms, room, store, runner, st = env
    await say(rooms, room, 3, T0)
    await runner.run(room.id)
    spent = 99 - st["quota"]
    await end_and_reopen(rooms, room, st, 1)
    await rooms.close(room.id, "owner", st["now"])
    st["quota"] = 0
    await runner.run(room.id)
    row = await store.get(room.id)
    assert (row.status, row.reason) == ("done", "stale") and spent == 1  # the fixture runner has no owner_of: one global count; quota out -> old kept
