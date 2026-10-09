import json
import logging
from datetime import datetime, timezone

import pytest
from sqlalchemy import update

from app.core import metering
from app.models import RoomMessage, RoomSummary, RoomVoice, User
from app.rooms.rules import RoomLimits
from app.rooms.store import RoomStore
from app.rooms.summary_store import SummaryRunner, SummaryStore

NOW = datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)
A = 11111111
GOOD = json.dumps({"overview_zh": "聊了面馆。", "words": [{"en": "noodles", "zh": "面条", "example": "I love noodles."}],
                   "fixes": [{"seq": 1, "better": "I went there yesterday.", "note_zh": "过去时"}]})


@pytest.fixture
async def env(app):
    async with app.state.sessionmaker() as s:
        s.add(User(id=A, username="alice", password_hash="x"))
        await s.commit()
    rooms = RoomStore(app.state.sessionmaker, RoomLimits())
    room = await rooms.create(A, "", NOW)
    state = {"raw": GOOD, "quota": 9, "refunds": [], "fail": False, "available": True, "calls": [],
             "template": None}

    async def complete(messages, max_tokens, temperature):
        state["calls"].append({"messages": messages, "max_tokens": max_tokens, "temperature": temperature,
                               "feature": metering.current_feature(), "user": metering.current_user_id()})
        if state["fail"]:
            raise RuntimeError("upstream")
        return state["raw"]

    async def consume(scope, subject, limit):
        state["quota"] -= 1
        return state["quota"] >= 0

    async def refund(scope, subject):
        state["refunds"].append(scope)

    async def template(key):
        assert key == "rooms.summary"
        return state["template"]

    async def room_info(_room_id):
        return ("B1", "Free conversation.", "alice")

    store = SummaryStore(app.state.sessionmaker)
    runner = SummaryRunner(store=store, complete=complete, consume=consume, refund=refund, template=template,
                           room_info=room_info, limits=lambda: RoomLimits(summary_min_messages=2),
                           available=lambda: state["available"], model=lambda: "m", clock=lambda: NOW)
    return rooms, room, store, runner, state


async def _say(rooms, room, n):
    for i in range(n):
        await rooms.append(room.id, lane="public", sender_kind="user", sender_id=A, kind="text",
                           text=f"I go there {i}", now=NOW)


async def test_summary_done_once(env, caplog):
    caplog.set_level(logging.DEBUG, logger="app")  # aiosqlite DEBUG echoes SQL parameters, not our logs
    rooms, room, store, runner, state = env
    await _say(rooms, room, 3)
    assert await runner.run(room.id) == "done"
    row = await store.get(room.id)
    assert row.data["fixes"][0]["original"] == "I go there 0" and row.attempts == 1
    assert row.model == "m" and row.finished_at is not None and row.reason is None
    assert await runner.run(room.id) == "done"  # not generated twice
    assert state["quota"] == 8 and "noodles" not in caplog.text and "I go there" not in caplog.text
    assert room.id in caplog.text
    call = state["calls"][0]
    assert len(state["calls"]) == 1 and call["max_tokens"] == 1200 and call["temperature"] == 0.3
    assert call["feature"] == "rooms_summary" and call["user"] is None
    assert "#3 alice: I go there 2" in call["messages"][-1]["content"]


async def test_skip_reasons_and_retry_after_failure(env):
    rooms, room, store, runner, state = env
    await _say(rooms, room, 1)
    assert await runner.run(room.id) == "skipped" and (await store.get(room.id)).reason == "few_messages"
    other = await rooms.create(A, "", NOW)
    await _say(rooms, other, 3)
    state["fail"] = True
    assert await runner.run(other.id) == "failed" and state["refunds"] == ["room_summary_global"]
    assert (await store.get(other.id)).reason == "upstream"
    state["fail"] = False
    assert await runner.run(other.id) == "done"
    third = await rooms.create(A, "", NOW)
    await _say(rooms, third, 3)
    state["raw"] = "not json"
    assert await runner.run(third.id) == "failed" and (await store.get(third.id)).reason == "format"
    assert state["refunds"] == ["room_summary_global"]  # format errors keep the global count
    assert await runner.run(third.id) == "failed"  # second (last) attempt
    row = await store.get(third.id)
    assert row.attempts == 2
    assert await store.start(third.id, NOW, 2) is False  # attempts exhausted
    assert await runner.run(third.id) == "failed" and (await store.get(third.id)).attempts == 2


async def test_disabled_and_quota_skips(env):
    rooms, room, store, runner, state = env
    await _say(rooms, room, 3)
    state["available"] = False
    assert await runner.run(room.id) == "skipped" and (await store.get(room.id)).reason == "disabled"
    state["available"] = True
    other = await rooms.create(A, "", NOW)
    await _say(rooms, other, 3)
    state["quota"] = 0
    assert await runner.run(other.id) == "skipped" and (await store.get(other.id)).reason == "quota"
    assert state["calls"] == [] and state["refunds"] == []


async def test_lines_are_public_visible_member_and_ai_messages(env, app):
    rooms, room, store, runner, state = env
    await _say(rooms, room, 2)  # seq 1, 2
    await rooms.append(room.id, lane="private", sender_kind="user", sender_id=A, kind="assist_reply",
                       text="private help", now=NOW, audience_id=A)  # 3
    await rooms.append(room.id, lane="public", sender_kind="ai", sender_id=None, kind="ai_answer",
                       text="Use the past tense.", now=NOW)  # 4
    hidden = await rooms.append(room.id, lane="public", sender_kind="user", sender_id=A, kind="text",
                                text="rude", now=NOW)  # 5
    await rooms.append(room.id, lane="public", sender_kind="system", sender_id=None, kind="system",
                       text="joined", now=NOW)  # 6
    pending_voice = await rooms.append(room.id, lane="public", sender_kind="user", sender_id=A, kind="voice",
                                       text="", now=NOW)  # 7
    done_voice = await rooms.append(room.id, lane="public", sender_kind="user", sender_id=A, kind="voice",
                                    text="spoken words", now=NOW)  # 8
    async with app.state.sessionmaker() as s:
        await s.execute(update(RoomMessage).where(RoomMessage.id == hidden.id).values(hidden_at=NOW))
        for m, status in ((pending_voice, "pending"), (done_voice, "done")):
            s.add(RoomVoice(message_id=m.id, room_id=room.id, sender_id=A, duration_ms=1000, audio_bytes=1,
                            audio_format="mp3", status=status, created_at=NOW))
        await s.commit()
    lines = await store.lines(room.id, 150)
    assert [(line.seq, line.sender_id, line.name, line.kind) for line in lines] == [
        (1, A, "alice", "text"), (2, A, "alice", "text"), (4, None, "AI 助手", "ai_answer"), (8, A, "alice", "voice")]
    assert [line.seq for line in await store.lines(room.id, 2)] == [4, 8]


async def test_startup_resume_and_pending(env, app):
    rooms, room, store, runner, state = env
    await _say(rooms, room, 3)
    other = await rooms.create(A, "", NOW)
    async with app.state.sessionmaker() as s:  # two generations interrupted by a restart
        s.add(RoomSummary(room_id=room.id, status="pending", attempts=1, created_at=NOW))
        s.add(RoomSummary(room_id=other.id, status="pending", attempts=2, created_at=NOW))
        await s.commit()
    assert sorted(await store.pending(20)) == sorted([room.id, other.id])
    assert await store.pending(1) != []
    assert await runner.run(room.id) == "pending"  # an ordinary run never steals a pending row
    assert await runner.run(room.id, resume=True) == "done"
    assert (await store.get(room.id)).attempts == 2
    assert await runner.run(other.id, resume=True) == "failed"  # no attempts left: not stuck pending forever
    assert (await store.get(other.id)).reason == "restart"
    assert await store.pending(20) == []


async def test_template_and_room_info_feed_the_prompt(env):
    rooms, room, store, runner, state = env
    await _say(rooms, room, 2)
    state["template"] = "Custom {level} {scenario} {members}\n<chat>\n{chat}\n</chat>"
    assert await runner.run(room.id) == "done"
    content = state["calls"][0]["messages"][0]["content"]
    assert content.startswith("Custom B1 Free conversation. alice") and "#1 alice: I go there 0" in content


async def test_one_owner_cannot_burn_the_site_summary_budget(env):
    """Review m9: rooms owned by one account get at most `summary_owner_daily` summaries a day, counted before the
    global budget; an upstream failure gives both counts back."""
    rooms, room, store, base, state = env
    counts: dict[tuple[str, str], int] = {}
    refunds: list[tuple[str, str]] = []

    async def consume(scope, subject, limit):
        counts[(scope, subject)] = counts.get((scope, subject), 0) + 1
        return counts[(scope, subject)] <= limit

    async def refund(scope, subject):
        refunds.append((scope, subject))
        counts[(scope, subject)] -= 1

    async def owner_of(_room_id):
        return A

    runner = SummaryRunner(store=store, complete=base.complete, consume=consume, refund=refund,
                           template=base.template, room_info=base.room_info,
                           limits=lambda: RoomLimits(summary_min_messages=2, summary_owner_daily=2),
                           available=base.available, model=base.model, clock=base.clock, owner_of=owner_of)
    await rooms.close(room.id, "owner", NOW)
    made = []
    for _ in range(3):  # one account opens and ends room after room
        r = await rooms.create(A, "", NOW)
        await _say(rooms, r, 3)
        await rooms.close(r.id, "owner", NOW)
        made.append(r)
    state["fail"] = True
    assert await runner.run(made[0].id) == "failed"
    assert sorted(refunds) == [("room_summary_global", "*"), ("room_summary_owner", str(A))]
    state["fail"] = False
    assert [await runner.run(r.id) for r in made] == ["done", "done", "skipped"]
    assert (await store.get(made[2].id)).reason == "quota"
    assert counts[("room_summary_global", "*")] == 2  # the over-cap room never touched the global budget
