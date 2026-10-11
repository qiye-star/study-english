"""评审 #3 #4 #5 #9 #10:账本在每条路径上释放、取消 / 异常时的退款边界、幂等键绑定请求、试聊并发与退款。"""
import asyncio
import contextlib
import json
import uuid

import pytest

from app.agents import limits, trace
from app.agents import settings as agent_settings
from app.agents.context import SourceRegistry
from app.agents.orchestrator import ModeBlock, ModeRegistry, run_turn, runtime
from app.services import usage
from tests.agents_helpers import (
    FakeLLM, enable_agents, make_deps, make_request, new_conversation, parse_sse, turn_body, use_fake_llm,
)
from tests.test_agents_orchestrator import UID, setup
from tests.test_agents_turn_api import _scope, uid


async def left(app, deps, cap=300) -> int:
    async with app.state.sessionmaker() as s:
        return await usage.remaining(s, limits.SCOPE_TURNS_USER, str(UID), usage.utc_day(deps.now()), cap)


# ---- #3 ledger released on every path ----

async def test_unstarted_stream_releases_the_ledger_entry(app, client, auth_headers):
    fake = await use_fake_llm(app, FakeLLM())
    enable_agents(app)
    body = turn_body(await new_conversation(client, auth_headers))
    raw = json.dumps(body).encode()
    sent = {"req": False}

    async def receive():
        if not sent["req"]:
            sent["req"] = True
            return {"type": "http.request", "body": raw, "more_body": False}
        await asyncio.sleep(10)
        return {"type": "http.disconnect"}

    async def send(message):
        raise OSError("client went away before the body started")

    with contextlib.suppress(Exception):
        await asyncio.wait_for(app(_scope(auth_headers, "2.4"), receive, send), 5)
    me = await uid(client, auth_headers)
    assert fake.requests == []  # the generator never started
    assert runtime(app).ledger.begin(me, body["client_turn_id"])[0] == "new"


async def test_cancelled_before_the_response_starts_releases_the_ledger_entry(app, client, auth_headers):
    await use_fake_llm(app, FakeLLM())
    enable_agents(app)
    body = turn_body(await new_conversation(client, auth_headers))
    raw = json.dumps(body).encode()
    entered = asyncio.Event()

    async def receive():
        return {"type": "http.request", "body": raw, "more_body": False}

    async def send(message):
        entered.set()
        await asyncio.sleep(30)

    task = asyncio.ensure_future(app(_scope(auth_headers, "2.4"), receive, send))
    await asyncio.wait_for(entered.wait(), 5)
    task.cancel()
    with contextlib.suppress(BaseException):
        await task
    me = await uid(client, auth_headers)
    assert runtime(app).ledger.begin(me, body["client_turn_id"])[0] == "new"


def test_stale_running_entries_expire_so_a_lost_entry_cannot_block_the_user():
    now = [0.0]
    ledger = limits.TurnLedger(clock=lambda: now[0])
    assert ledger.begin(1, "a")[0] == "new" and ledger.begin(1, "b")[0] == "new"
    assert ledger.begin(1, "c")[0] == "busy"
    now[0] = limits.RUNNING_TTL_SECONDS + 1
    assert ledger.begin(1, "c")[0] == "new"
    assert ledger.begin(1, "a")[0] == "new"


# ---- #4 cancellation refund boundary ----

async def _cancel_after(app, fake, *, stop_after_deltas: int):
    await setup(app, fake)
    deps, _ = make_deps(app)
    seen = []

    async def consume():
        async for event in run_turn(deps, make_request(UID)):
            seen.append(event)

    task = asyncio.ensure_future(consume())
    for _ in range(500):
        await asyncio.sleep(0.01)
        if fake.requests and sum(isinstance(e, trace.Delta) for e in seen) >= stop_after_deltas:
            break
    task.cancel()
    with contextlib.suppress(BaseException):
        await task
    return deps, seen


async def test_cancel_before_any_text_refunds(app):
    deps, seen = await _cancel_after(app, FakeLLM(["never"], gate=asyncio.Event(), first_delay=30), stop_after_deltas=0)
    assert not any(isinstance(e, trace.Delta) for e in seen)
    assert await left(app, deps) == 300  # no reply delivered: not charged


async def test_cancel_after_text_was_delivered_keeps_the_charge(app):
    deps, seen = await _cancel_after(app, FakeLLM(["first", "never"], gate=asyncio.Event()), stop_after_deltas=1)
    assert any(isinstance(e, trace.Delta) for e in seen)
    assert await left(app, deps) == 299  # Ruling: the learner already saw text (cost incurred): charged


# ---- #5 any exception before the first upstream byte refunds ----

async def test_unexpected_error_before_the_llm_call_refunds(app, monkeypatch):
    await setup(app)
    deps, _ = make_deps(app)

    async def boom(session, user_id):
        raise RuntimeError("db went away")

    monkeypatch.setattr(agent_settings, "load", boom)
    req = make_request(UID)
    req = type(req)(**{**req.__dict__, "agent_settings": None})
    with pytest.raises(RuntimeError):
        async for _ in run_turn(deps, req):
            pass
    assert await left(app, deps) == 300


async def test_unexpected_error_in_source_selection_refunds(app):
    await setup(app)

    class Broken(SourceRegistry):
        def selected(self, ctx, tools_mode):
            raise ValueError("bad registry")

    deps, _ = make_deps(app, registry=Broken())
    with pytest.raises(ValueError):
        async for _ in run_turn(deps, make_request(UID)):
            pass
    assert await left(app, deps) == 300


async def test_no_double_refund_when_a_known_failure_already_refunded(app):
    await setup(app, FakeLLM(status=402))
    deps, _ = make_deps(app)
    async with app.state.sessionmaker() as s:
        await usage.consume(s, limits.SCOPE_TURNS_USER, str(UID), usage.utc_day(deps.now()), 300)  # another turn: 1
    events = [e async for e in run_turn(deps, make_request(UID))]
    assert events[-1] == trace.Error("llm_unavailable")
    assert await left(app, deps) == 299  # exactly one refund


# ---- #9 idempotency key is bound to the request ----

async def test_reused_client_turn_id_with_a_different_request_is_a_conflict(app, client, auth_headers):
    fake = await use_fake_llm(app, FakeLLM(["Hi"]))
    enable_agents(app)
    conv = await new_conversation(client, auth_headers)
    body = turn_body(conv)
    assert parse_sse((await client.post("/api/agents/turn", headers=auth_headers, json=body)).text)[-1][0] == "done"
    same = await client.post("/api/agents/turn", headers=auth_headers, json=body)
    assert parse_sse(same.text)[-1][0] == "done" and len(fake.requests) == 1  # a true retry still replays
    for change in ({"text": "Another question"}, {"mode": "tutor"}, {"conversation_id": await new_conversation(client, auth_headers)},
                   {"persona_id": "builtin:coach"}, {"tutor_session_id": str(uuid.uuid4())}):
        r = await client.post("/api/agents/turn", headers=auth_headers, json={**body, **change})
        assert r.status_code == 409, change
        assert r.json() == {"error": "Client turn id already used for a different request"}
    assert len(fake.requests) == 1


async def test_a_running_turn_with_another_request_is_also_a_conflict(app, client, auth_headers):
    await use_fake_llm(app, FakeLLM())
    enable_agents(app)
    conv = await new_conversation(client, auth_headers)
    body = turn_body(conv)
    runtime(app).ledger.begin(await uid(client, auth_headers), body["client_turn_id"], "other-fingerprint")
    r = await client.post("/api/agents/turn", headers=auth_headers, json=body)
    assert r.status_code == 409 and r.json() == {"error": "Client turn id already used for a different request"}


# ---- #10 personas/try: concurrency guard and refund ----

TRY = {"persona": {"name": "Tom", "prompt": "Be Tom."}, "text": "Hi"}


async def test_persona_try_counts_toward_the_concurrent_cap(app, client, auth_headers):
    fake = await use_fake_llm(app, FakeLLM())
    enable_agents(app)
    me = await uid(client, auth_headers)
    runtime(app).ledger.begin(me, str(uuid.uuid4()))
    runtime(app).ledger.begin(me, str(uuid.uuid4()))
    r = await client.post("/api/agents/personas/try", headers=auth_headers, json=TRY)
    assert r.status_code == 429 and fake.requests == []
    assert len(runtime(app).ledger) == 2  # nothing leaked, nothing consumed


async def test_persona_try_releases_its_slot_and_refunds_on_unexpected_errors(app, client, auth_headers, monkeypatch):
    await use_fake_llm(app, FakeLLM())
    enable_agents(app, agents_turns_daily_per_user=1)

    async def boom(*args, **kwargs):
        raise RuntimeError("unexpected")

    monkeypatch.setattr("app.providers.llm.complete", boom)
    with pytest.raises(RuntimeError):
        await client.post("/api/agents/personas/try", headers=auth_headers, json=TRY)
    assert len(runtime(app).ledger) == 0
    monkeypatch.undo()
    assert (await client.post("/api/agents/personas/try", headers=auth_headers, json=TRY)).status_code == 200  # refunded
    assert len(runtime(app).ledger) == 0
