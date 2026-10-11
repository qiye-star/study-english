import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.agents import limits
from app.agents.memory.store import ThreadKey
from app.agents.orchestrator import runtime
from app.agents.memory.worker import CAP_SCOPE, MemoryDeps, MemoryWorker, TutorFinished
from app.models import AgentMemoryItem, AgentThreadState
from app.providers import llm as llm_mod
from tests.agents_memory_helpers import (
    FakeLLM, FakeRecord, add_conversation, add_messages, ctx, enable_agents, user_id_of, user_prefs,
)

NOW = datetime(2026, 10, 12, 8, 0, tzinfo=timezone.utc)
ADD = json.dumps({"ops": [{"op": "add", "kind": "goal", "text": "准备雅思口语考试", "importance": 4}]},
                 ensure_ascii=False)


@pytest.fixture
async def uid(client, auth_headers):
    return await user_id_of(client, auth_headers)


def make_worker(app, llm, *, prefs=None, cap=True):
    calls = {"consume": 0, "refund": 0}
    clock = {"t": 0.0}

    async def consume(user_id, at):
        calls["consume"] += 1
        return cap

    async def refund(user_id, at):
        calls["refund"] += 1

    async def user_settings(user_id):
        return prefs or user_prefs()

    rt = app.state.agent_memory
    deps = MemoryDeps(store=rt.store, cache=rt.cache, settings=lambda: app.state.settings,
                      user_settings=user_settings, complete=llm, consume=consume, refund=refund)
    return MemoryWorker(deps, monotonic=lambda: clock["t"]), deps, calls, clock


async def turns(worker, uid, start, n, **kw):
    for i in range(n):
        await worker.after_turn(FakeRecord(uid, start + timedelta(minutes=i), text=f"turn {i} about IELTS", **kw))
        await worker.join()


async def test_install_registers_the_source_and_the_hook(app):
    rt = app.state.agent_memory
    assert rt.worker.after_turn in runtime(app).hooks.after_turn
    assert runtime(app).registry.get("memory") is rt.source


async def test_four_turns_trigger_one_extraction(app, uid):
    enable_agents(app)
    await add_conversation(app, uid)
    llm = FakeLLM(ADD)
    worker, deps, calls, _ = make_worker(app, llm)
    await turns(worker, uid, NOW, 4)
    assert len(llm.calls) == 1
    assert all(f"turn {i} about IELTS" in llm.calls[0][1]["content"] for i in range(4))
    rows, _ = await app.state.agent_memory.store.items(uid)
    assert [(r.text, r.source) for r in rows] == [("准备雅思口语考试", "chat")]
    assert deps.counters["ops_applied"] == 1 and calls["consume"] == 1


async def test_next_entry_after_thirty_idle_minutes_extracts_leftovers_and_writes_a_recap(app, uid):
    enable_agents(app)
    await add_conversation(app, uid)
    await add_messages(app, "c1", [("user", "I want a coffee"), ("assistant", "Sure"), ("user", "with milk"),
                                   ("assistant", "Done")], NOW)
    llm = FakeLLM(ADD, "练了点咖啡")
    worker, *_ = make_worker(app, llm)
    await worker.after_turn(FakeRecord(uid, NOW, text="I want a coffee"))
    await worker.join()
    await worker.after_turn(FakeRecord(uid, NOW + timedelta(minutes=3), text="with milk"))
    await worker.join()
    assert llm.calls == []
    await worker.after_turn(FakeRecord(uid, NOW + timedelta(hours=2), text="hello again"))
    await worker.join()
    assert len(llm.calls) == 2
    assert "I want a coffee" in llm.calls[0][1]["content"] and "hello again" not in llm.calls[0][1]["content"]
    recaps, _ = await app.state.agent_memory.store.recaps(uid)
    assert [(r.text, r.source, r.conversation_id) for r in recaps] == [("练了点咖啡", "conversation", "c1")]


async def test_messages_outside_the_window_roll_into_the_summary_and_every_third_roll_is_a_recap(app, uid):
    enable_agents(app, agents_history_max=2)
    await add_conversation(app, uid)
    await add_messages(app, "c1", [("user" if i % 2 == 0 else "assistant", f"line {i}") for i in range(8)],
                       NOW - timedelta(hours=1))
    llm = FakeLLM("摘要一")
    worker, *_ = make_worker(app, llm)
    await worker.after_turn(FakeRecord(uid, NOW, text=None, mode="tutor"))
    await worker.join()
    assert len(llm.calls) == 1
    assert "line 5" in llm.calls[0][1]["content"] and "line 6" not in llm.calls[0][1]["content"]

    async def state():
        async with app.state.sessionmaker() as s:
            row = await s.scalar(select(AgentThreadState).where(AgentThreadState.conversation_id == "c1"))
        return row.summary, row.summarized_count, row.rolls_since_recap

    assert await state() == ("摘要一", 6, 1)
    store = app.state.agent_memory.store
    await store.save_summary(uid, ThreadKey("conversation", "c1"), summary="摘要一", summarized_count=6,
                             rolls_since_recap=2)
    await add_messages(app, "c1", [("user", f"more {i}") for i in range(6)], NOW - timedelta(minutes=30))
    llm.replies.append("摘要二")
    await worker.after_turn(FakeRecord(uid, NOW + timedelta(minutes=1), text=None, mode="tutor"))
    await worker.join()
    assert await state() == ("摘要二", 12, 0)
    assert [r.text for r in (await store.recaps(uid))[0]] == ["摘要二"]


async def test_daily_cap_skips_without_calling_the_model(app, uid):
    enable_agents(app)
    await add_conversation(app, uid)
    llm = FakeLLM()
    worker, deps, _, _ = make_worker(app, llm, cap=False)
    await turns(worker, uid, NOW, 4)
    assert deps.counters["skipped_cap"] == 1 and llm.calls == []


async def test_upstream_failure_refunds_and_backs_off_for_a_minute(app, uid):
    enable_agents(app)
    await add_conversation(app, uid)
    llm = FakeLLM(llm_mod.LlmUnavailable("http"))
    worker, deps, calls, clock = make_worker(app, llm)
    await turns(worker, uid, NOW, 4)
    assert (deps.counters["extract_failed"], calls["refund"]) == (1, 1)
    await turns(worker, uid, NOW + timedelta(minutes=10), 4)
    assert deps.counters["skipped_backoff"] == 1 and len(llm.calls) == 1
    clock["t"] = 61
    await turns(worker, uid, NOW + timedelta(minutes=20), 4)
    assert len(llm.calls) == 2


@pytest.mark.parametrize("server, prefs", [({"agents_memory_enabled": False}, None),
                                           ({}, {"memory_enabled": False})])
async def test_paused_or_switched_off_memory_writes_nothing(app, uid, server, prefs):
    enable_agents(app, **server)
    await add_conversation(app, uid)
    llm = FakeLLM(ADD)
    worker, deps, _, _ = make_worker(app, llm, prefs=user_prefs(**prefs) if prefs else None)
    await turns(worker, uid, NOW, 4)
    assert worker.submit_tutor(TutorFinished(uid, "builtin:coach", "c1", "t-1", "8 题答对 6 题", NOW))
    await worker.join()
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(AgentThreadState)) == 0
        assert await s.scalar(select(func.count()).select_from(AgentMemoryItem)) == 0
    assert llm.calls == [] and deps.counters == {}


async def test_queue_overflow_is_counted(app, uid, monkeypatch):
    monkeypatch.setattr("app.agents.memory.worker.PENDING_MAX", 1)
    enable_agents(app)
    gate = asyncio.Event()

    async def slow(user_id):
        await gate.wait()
        return user_prefs()

    worker, deps, _, _ = make_worker(app, FakeLLM())
    deps.user_settings = slow
    await worker.after_turn(FakeRecord(uid, NOW))
    await worker.after_turn(FakeRecord(uid, NOW))
    assert deps.counters["skipped_overflow"] == 1
    gate.set()
    await worker.join()


async def test_tutor_finish_writes_a_recap_and_extracts_from_it(app, uid):
    enable_agents(app)
    await add_conversation(app, uid)
    llm = FakeLLM(json.dumps({"ops": [{"op": "add", "kind": "weakness", "text": "过去时态常出错", "importance": 4}]},
                             ensure_ascii=False))
    worker, *_ = make_worker(app, llm)
    assert worker.submit_tutor(TutorFinished(uid, "builtin:coach", "c1", "t-1", "8 题答对 6 题;过去时态常出错", NOW))
    await worker.join()
    store = app.state.agent_memory.store
    recaps, _ = await store.recaps(uid)
    assert [(r.source, r.tutor_session_id, r.persona_id) for r in recaps] == [("tutor", "t-1", "builtin:coach")]
    rows, _ = await store.items(uid)
    assert [(r.kind, r.source) for r in rows] == [("weakness", "tutor")]


async def test_items_used_in_the_snapshot_get_last_used_at(app, uid):
    enable_agents(app)
    await add_conversation(app, uid)
    rt = app.state.agent_memory
    row = await rt.store.add(uid, kind="goal", text="Preparing for IELTS", importance=4, persona_id=None, source="chat")
    assert (await rt.source.load(ctx(uid))) is not None
    worker, *_ = make_worker(app, FakeLLM())
    await worker.after_turn(FakeRecord(uid, NOW))
    await worker.join()
    assert (await rt.store.items(uid))[0][0].last_used_at is not None and row.last_used_at is None


async def test_worker_logs_carry_no_text_or_user_id(app, uid, caplog):
    caplog.set_level(logging.DEBUG, logger="app")  # not the root: driver DEBUG lines carry SQL parameters
    enable_agents(app)
    await add_conversation(app, uid)
    secret = "MAGENTA-PINEAPPLE-42"
    llm = FakeLLM(json.dumps({"ops": [{"op": "add", "kind": "fact", "text": f"likes {secret}"}]}),
                  llm_mod.LlmUnavailable("http"))
    worker, *_ = make_worker(app, llm)
    for i in range(8):
        await worker.after_turn(FakeRecord(uid, NOW + timedelta(minutes=i), text=f"I like {secret} number {i}"))
        await worker.join()
    assert len(llm.calls) == 2
    assert secret not in caplog.text and "likes" not in caplog.text and str(uid) not in caplog.text
    assert "agents memory" in caplog.text


async def test_a_failing_job_logs_only_the_exception_class(app, uid, caplog):
    enable_agents(app)

    async def boom(user_id):
        raise RuntimeError("user said MAGENTA")

    worker, deps, _, _ = make_worker(app, FakeLLM())
    deps.user_settings = boom
    await worker.after_turn(FakeRecord(uid, NOW))
    await worker.join()
    assert "RuntimeError" in caplog.text and "MAGENTA" not in caplog.text and deps.counters["jobs_failed"] == 1


async def test_extraction_keeps_the_new_item_when_pinned_items_fill_most_of_the_cap(app, uid):
    enable_agents(app, agents_memory_items_max=2)
    await add_conversation(app, uid)
    store = app.state.agent_memory.store
    pinned = await store.add(uid, kind="fact", text="pinned fact", importance=1, persona_id=None, source="chat")
    await store.pin(uid, pinned.id, True)
    await store.add(uid, kind="fact", text="old unpinned", importance=1, persona_id=None, source="chat")
    worker, deps, *_ = make_worker(app, FakeLLM(ADD))
    await turns(worker, uid, NOW, 4)
    texts = {r.text for r in (await store.items(uid))[0]}
    assert texts == {"pinned fact", "准备雅思口语考试"} and deps.counters["evicted"] == 1


async def test_extraction_with_every_slot_pinned_rejects_the_add_and_evicts_nothing(app, uid):
    enable_agents(app, agents_memory_items_max=2)
    await add_conversation(app, uid)
    store = app.state.agent_memory.store
    for text in ("pinned one", "pinned two"):
        await store.pin(uid, (await store.add(uid, kind="fact", text=text, importance=1, persona_id=None,
                                              source="chat")).id, True)
    worker, deps, *_ = make_worker(app, FakeLLM(ADD))
    await turns(worker, uid, NOW, 4)
    assert {r.text for r in (await store.items(uid))[0]} == {"pinned one", "pinned two"}
    assert deps.counters.get("evicted", 0) == 0 and deps.counters["add_rejected_full"] == 1


def test_the_cap_scope_is_the_shared_agents_memory_extract_scope():
    assert CAP_SCOPE == limits.SCOPE_MEMORY_USER
