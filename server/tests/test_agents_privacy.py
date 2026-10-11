"""隐私(spec §8.5、§11.5):每个智能体端点、失败路径、后台任务(回合后钩子、记忆整理)与学习数据来源的日志里没有
用户文本、人设、历史、回复、推理、记忆、词、用户 id 或上游错误原文;路由 URL 不带词(路径参数只有 id,查询参数只有
枚举 / 数字 / id)。caplog 只收 `app` 日志:根 logger 的 DEBUG 会带上 aiosqlite 绑定的 SQL 参数(测试环境的假象,生产不跑)。"""
import asyncio
import json
import logging

import pytest

from app.agents.orchestrator import runtime
from app.models import LinkMistakeWord, VocabularyItem, WordbookEvent, utcnow
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.agents_helpers import FakeLLM, new_conversation, parse_sse, turn_body, use_fake_llm

SECRETS = ("SECRET-USER-TEXT", "SECRET-PERSONA", "SECRET-HISTORY", "SECRET-REPLY", "SECRET-REASONING",
           "SECRET-MEMORY", "zebrafishword", "upstream-secret-body")
A1_ROUTES = {
    ("GET", "/api/agents/config"), ("GET", "/api/agents/personas"), ("POST", "/api/agents/personas"),
    ("GET", "/api/agents/personas/{persona_id}"), ("PATCH", "/api/agents/personas/{persona_id}"),
    ("DELETE", "/api/agents/personas/{persona_id}"), ("POST", "/api/agents/personas/{persona_id}/report"),
    ("POST", "/api/agents/personas/try"), ("GET", "/api/agents/settings"), ("PATCH", "/api/agents/settings"),
    ("POST", "/api/agents/turn"),
}
MEMORY_ROUTES = {
    ("GET", "/api/agents/memory/profile"), ("PATCH", "/api/agents/memory/profile"), ("GET", "/api/agents/memory/items"),
    ("DELETE", "/api/agents/memory/items/{item_id}"), ("POST", "/api/agents/memory/items/{item_id}/pin"),
    ("GET", "/api/agents/memory/recaps"), ("DELETE", "/api/agents/memory/recaps/{recap_id}"),
    ("GET", "/api/agents/memory/export"), ("DELETE", "/api/agents/memory"),
}
ADMIN_ROUTES = {
    ("GET", "/api/admin/agents"), ("POST", "/api/admin/agents/personas/query"),
    ("POST", "/api/admin/agents/personas/{persona_id}/delete"),
    ("POST", "/api/admin/agents/personas/{persona_id}/{action}"), ("PATCH", "/api/admin/agents/personas/{persona_id}"),
    ("GET", "/api/admin/agents/reports"), ("POST", "/api/admin/agents/reports/{persona_id}/resolve"),
    ("POST", "/api/admin/agents/probe-tools"),
}
TUTOR_ROUTES = {
    ("POST", "/api/agents/tutor/start"), ("GET", "/api/agents/tutor/active"), ("GET", "/api/agents/tutor/{session_id}"),
    ("POST", "/api/agents/tutor/{session_id}/hint"), ("POST", "/api/agents/tutor/{session_id}/skip"),
    ("POST", "/api/agents/tutor/{session_id}/finish"),
}
ALLOWED_PATH = {"persona_id", "item_id", "recap_id", "action", "session_id"}
ALLOWED_QUERY = {"kind", "persona_id", "cursor", "limit", "conversation_id"}  # memory filters + tutor active: enums, ids, numbers


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED, "agents_enabled": True}


class Boom:
    key, private = "boom_source", True

    async def load(self, ctx):
        raise RuntimeError(f"zebrafishword {ctx.text}")


def leaked(caplog, extra: tuple[str, ...] = ()) -> list[str]:
    found = []
    for record in caplog.records:
        text = f"{record.getMessage()} {record.args!r} {record.exc_text or ''}".lower()
        found += [s for s in (*SECRETS, *extra) if s.lower() in text]
    return found


async def settle(app) -> None:
    """In-memory SQLite shares one connection: let after-turn hooks and memory jobs finish before the next request."""
    await asyncio.gather(*list(runtime(app).tasks), return_exceptions=True)
    await app.state.agent_memory.worker.join()


MEMORY_OPS = json.dumps({"ops": [{"op": "add", "kind": "fact", "text": "likes SECRET-MEMORY and zebrafishword"}]})


async def test_logs_never_carry_user_text_persona_words_or_upstream_text(app, client, auth_headers, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    caplog.set_level(logging.INFO, logger="httpx")
    runtime(app).registry.register(Boom())
    seen = []

    async def hook(record):
        seen.append(record.turn_id)
        raise ValueError(record.reply)

    runtime(app).hooks.after_turn.append(hook)
    me = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    async with app.state.sessionmaker() as s:
        s.add(VocabularyItem(user_id=me, word="zebrafishword", source="manual", due_at=utcnow()))
        s.add(LinkMistakeWord(user_id=me, word="zebrafishword", book_id="junior", wrong_count=3, ok_streak=0,
                              last_event_at=utcnow(), last_wrong_at=utcnow()))
        s.add(WordbookEvent(user_id=me, book_id="junior", kind="learn", word="zebrafishword", outcome="ok",
                            day=utcnow().date().isoformat(), created_at=utcnow()))
        await s.commit()
    await use_fake_llm(app, FakeLLM(["SECRET-REPLY"], reasoning=["SECRET-REASONING"]))
    persona = (await client.post("/api/agents/personas", headers=auth_headers,
                                 json={"name": "Tom", "prompt": "SECRET-PERSONA", "deep_think": True})).json()
    assert (await client.get(f"/api/agents/personas/{persona['id']}", headers=auth_headers)).status_code == 200
    assert (await client.get("/api/agents/personas", headers=auth_headers)).status_code == 200
    assert (await client.get("/api/agents/config", headers=auth_headers)).status_code == 200
    assert (await client.get("/api/agents/settings", headers=auth_headers)).status_code == 200
    conv = await new_conversation(client, auth_headers)
    body = turn_body(conv, persona_id=persona["id"], text="SECRET-USER-TEXT zebrafishword",
                     history=[{"role": "user", "content": "SECRET-HISTORY"}])
    events = parse_sse((await client.post("/api/agents/turn", headers=auth_headers, json=body)).text)
    assert events[-1][0] == "done"
    due = next(d for e, d in events if e == "step" and d["key"] == "due_words" and d["status"] == "done")
    assert due["params"]["words"] == ["zebrafishword"]  # words may travel in SSE params (spec §4.4)
    assert any(e == "step" and d["key"] == "boom_source" and d["status"] == "fail" for e, d in events)
    await settle(app)
    assert seen
    # idempotent resend, over-long text and bad ids are rejected without echoing the text
    assert (await client.post("/api/agents/turn", headers=auth_headers, json=body)).status_code in (200, 409)
    bad = await client.post("/api/agents/turn", headers=auth_headers,
                            json=turn_body(conv, text="SECRET-USER-TEXT" * 400))
    assert bad.status_code == 422
    await settle(app)
    await client.patch("/api/agents/settings", headers=auth_headers, json={"show_process": False})
    await client.patch("/api/agents/settings", headers=auth_headers, json={"default_persona_id": "SECRET-PERSONA"})
    await client.post(f"/api/conversations/{conv}/messages", headers=auth_headers, json={"messages": [
        {"role": "assistant", "content": "SECRET-REPLY", "agent_trace": events[-1][1]["trace"]}]})
    await client.post(f"/api/agents/personas/{persona['id']}/report", headers=auth_headers, json={"reason": "spam"})
    await client.patch(f"/api/agents/personas/{persona['id']}", headers=auth_headers, json={"prompt": "SECRET-PERSONA 2"})
    # try-persona: success and failure
    tried = await client.post("/api/agents/personas/try", headers=auth_headers,
                              json={"persona": {"name": "Draft", "prompt": "SECRET-PERSONA"}, "text": "SECRET-USER-TEXT"})
    assert tried.status_code == 200
    await use_fake_llm(app, FakeLLM(status=402))
    failed_try = await client.post("/api/agents/personas/try", headers=auth_headers,
                                   json={"persona": {"name": "Draft", "prompt": "SECRET-PERSONA"},
                                         "text": "SECRET-USER-TEXT"})
    assert failed_try.status_code == 502 and "upstream-secret-body" not in failed_try.text
    failed = await client.post("/api/agents/turn", headers=auth_headers, json=turn_body(conv, text="SECRET-USER-TEXT"))
    assert parse_sse(failed.text)[-1] == ("error", {"code": "llm_unavailable"})
    assert "upstream-secret-body" not in failed.text
    h = await login_as(app, client, "operator")
    assert (await client.get("/api/admin/agents")).status_code == 200
    assert (await client.get("/api/admin/agents/reports")).status_code == 200
    assert (await client.post("/api/admin/agents/personas/query", headers=h,
                              json={"q": "SECRET-PERSONA", "status": "all"})).status_code == 200
    await client.patch(f"/api/admin/agents/personas/{persona['id']}", headers=h,
                       json={"reason": "moderation", "prompt": "SECRET-PERSONA v2"})
    await client.post(f"/api/admin/agents/reports/{persona['id']}/resolve", headers=h,
                      json={"action": "dismiss", "reason": "SECRET-PERSONA reviewed"})
    await client.post(f"/api/admin/agents/personas/{persona['id']}/disable", headers=h, json={"reason": "moderation"})
    await client.post(f"/api/admin/agents/personas/{persona['id']}/restore", headers=h, json={"reason": "moderation"})
    await use_fake_llm(app, FakeLLM(status=402, error_body=b"upstream-secret-body"))
    await client.post("/api/admin/agents/probe-tools", headers=h)
    await use_fake_llm(app, FakeLLM(["ok"]))
    await client.post("/api/admin/agents/probe-tools", headers=h)
    await client.post(f"/api/admin/agents/personas/{persona['id']}/delete", headers=h, json={"reason": "moderation"})
    assert leaked(caplog) == []
    assert not any(f"user_id={me}" in r.getMessage() or f"user={me}" in r.getMessage() for r in caplog.records)
    assert any("agents after_turn hook failed error=ValueError" in r.getMessage() for r in caplog.records)


async def test_memory_worker_and_endpoints_never_log_text_memory_or_user_id(app, client, auth_headers, caplog):
    """Four chat turns trigger a real extraction (fake upstream returns an add-op containing the secrets), then every
    memory endpoint runs over the stored item; summaries / recaps are exercised by the worker's own tests."""
    caplog.set_level(logging.DEBUG, logger="app")
    me = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    await use_fake_llm(app, FakeLLM([MEMORY_OPS]))
    conv = await new_conversation(client, auth_headers)
    for i in range(5):
        r = await client.post("/api/agents/turn", headers=auth_headers, json=turn_body(
            conv, text=f"SECRET-USER-TEXT number {i} zebrafishword",
            history=[{"role": "user", "content": "SECRET-HISTORY"}]))
        assert parse_sse(r.text)[-1][0] == "done"
        await settle(app)
    items = (await client.get("/api/agents/memory/items", headers=auth_headers)).json()["items"]
    assert items, "extraction should have stored the fake memory"
    base = "/api/agents/memory"
    await client.get(f"{base}/profile", headers=auth_headers)
    await client.patch(f"{base}/profile", headers=auth_headers, json={"values": {"schedule": "SECRET-MEMORY evenings"}})
    for path in ("/items?kind=fact&limit=5", "/recaps", "/export"):
        await client.get(base + path, headers=auth_headers)
    await client.post(f"{base}/items/{items[0]['id']}/pin", headers=auth_headers, json={"pinned": True})
    await client.delete(f"{base}/items/{items[0]['id']}", headers=auth_headers)
    # worker failure path: the upstream answers 402 with a secret body; a source failure is logged as class only
    await use_fake_llm(app, FakeLLM(status=402))
    for i in range(5):
        await client.post("/api/agents/turn", headers=auth_headers, json=turn_body(
            conv, text=f"SECRET-USER-TEXT again {i}"))
        await settle(app)
    await client.request("DELETE", base, headers=auth_headers, json={"confirm": True, "scope": "all"})
    assert leaked(caplog) == []
    assert any("agents memory" in r.getMessage() for r in caplog.records)
    assert not any(f"user_id={me}" in r.getMessage() or f"user={me}" in r.getMessage() for r in caplog.records)


async def test_learning_data_sources_and_failures_log_keys_and_classes_only(app, client, auth_headers, caplog):
    """links/agent_sources (learned / weak / due / lookup) run over rows and a text full of secrets; a dictionary
    failure is logged by agents.context as `key` + class only."""
    caplog.set_level(logging.DEBUG, logger="app")
    me = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    async with app.state.sessionmaker() as s:
        s.add(VocabularyItem(user_id=me, word="zebrafishword", source="manual", due_at=utcnow()))
        s.add(LinkMistakeWord(user_id=me, word="zebrafishword", book_id="junior", wrong_count=2, ok_streak=0,
                              last_event_at=utcnow(), last_wrong_at=utcnow()))
        s.add(WordbookEvent(user_id=me, book_id="junior", kind="learn", word="zebrafishword", outcome="ok",
                            day=utcnow().date().isoformat(), created_at=utcnow()))
        await s.commit()
    await use_fake_llm(app, FakeLLM(["SECRET-REPLY"]))
    runtime(app).registry.register(Boom())
    conv = await new_conversation(client, auth_headers)
    r = await client.post("/api/agents/turn", headers=auth_headers, json=turn_body(
        conv, text="SECRET-USER-TEXT zebrafishword abandon neighbour"))
    events = parse_sse(r.text)
    assert events[-1][0] == "done"
    keys = {d["key"] for e, d in events if e == "step"}
    assert {"learned_words", "weak_words", "due_words"} <= keys
    await settle(app)
    assert leaked(caplog) == []
    assert any("agents source failed key=boom_source error=RuntimeError" in r.getMessage() for r in caplog.records)


def tutor_reply(verdict: str, *, done: bool = False) -> list[str]:
    meta = {"verdict": verdict, "kind": "ask", "next_focus": "SECRET-MEMORY zebrafishword",
            "hint": "SECRET-HINT zebrafishword", "say": "SECRET-REPLY", "done": done}
    return ["SECRET-REPLY Question? ", "<<META>>" + json.dumps(meta)]


async def test_tutor_endpoints_and_turns_never_log_answers_words_hints_recaps_or_goal_text(app, client, auth_headers,
                                                                                         caplog):
    """Start / active / get / hint / skip / finish and tutor turns (opening, answers, a 402 upstream failure) over
    a plan full of secret words; the recap memory bridge and worker run for real (extraction on)."""
    import uuid

    from tests.agents_tutor_helpers import install_sources

    caplog.set_level(logging.DEBUG, logger="app")
    caplog.set_level(logging.INFO, logger="httpx")
    app.state.settings = app.state.settings.model_copy(update={"agents_tutor_enabled": True})
    install_sources(app, due_words=["zebrafishword", "SECRET-WORD-2", "SECRET-WORD-3"])
    me = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    conv = await new_conversation(client, auth_headers)
    started = await client.post("/api/agents/tutor/start", headers=auth_headers, json={
        "conversation_id": conv, "persona_id": "builtin:coach", "topic": "today_words", "length": 5, "input": "text",
        "client_start_id": str(uuid.uuid4())})
    assert started.status_code == 200, started.text
    sid = started.json()["id"]
    assert (await client.get("/api/agents/tutor/active", headers=auth_headers,
                             params={"conversation_id": conv})).json()["session"]["id"] == sid
    assert (await client.get(f"/api/agents/tutor/{sid}", headers=auth_headers)).status_code == 200

    def tutor_turn(text):
        return client.post("/api/agents/turn", headers=auth_headers, json=turn_body(
            conv, persona_id="builtin:coach", mode="tutor", tutor_session_id=sid, text=text))

    # upstream failure on the opening turn: logged as class only, body never echoed
    await use_fake_llm(app, FakeLLM(status=402))
    failed = await tutor_turn(None)
    assert "upstream-secret-body" not in failed.text and parse_sse(failed.text)[-1][0] == "error"
    await settle(app)
    await use_fake_llm(app, FakeLLM(tutor_reply("weak")))
    assert parse_sse((await tutor_turn(None)).text)[-1][0] == "done"
    await settle(app)
    for answer in ("SECRET-USER-TEXT one zebrafishword", "SECRET-USER-TEXT two"):
        assert parse_sse((await tutor_turn(answer)).text)[-1][0] == "done"
        await settle(app)
    assert (await client.post(f"/api/agents/tutor/{sid}/hint", headers=auth_headers)).status_code == 200
    assert (await client.post(f"/api/agents/tutor/{sid}/skip", headers=auth_headers)).status_code == 200
    await use_fake_llm(app, FakeLLM(status=402))  # recap extraction by the worker fails with a secret body
    finished = await client.post(f"/api/agents/tutor/{sid}/finish", headers=auth_headers)
    assert finished.status_code == 200 and "upstream-secret-body" not in finished.text
    await settle(app)
    assert (await client.get("/api/agents/memory/recaps", headers=auth_headers)).status_code == 200
    assert leaked(caplog, ("SECRET-WORD-2", "SECRET-WORD-3", "SECRET-HINT")) == []
    assert not any(f"user_id={me}" in r.getMessage() or f"user={me}" in r.getMessage() for r in caplog.records)
    assert any("tutor start" in r.getMessage() for r in caplog.records)


def test_agent_routes_carry_no_text_in_urls(app):
    """Read from the OpenAPI schema (route objects differ between FastAPI versions): path / query parameter names."""
    seen = set()
    expected = A1_ROUTES | MEMORY_ROUTES | ADMIN_ROUTES | TUTOR_ROUTES
    for path, item in app.openapi()["paths"].items():
        if not (path.startswith("/api/agents") or path.startswith("/api/admin/agents")):
            continue
        for method, op in item.items():
            if method.upper() not in {"GET", "POST", "PATCH", "PUT", "DELETE"}:
                continue
            assert (method.upper(), path) in expected, f"new agents route needs a privacy test: {method} {path}"
            seen.add((method.upper(), path))
            params = op.get("parameters", [])
            assert {p["name"] for p in params if p["in"] == "path"} <= ALLOWED_PATH, path
            assert {p["name"] for p in params if p["in"] == "query"} <= ALLOWED_QUERY, path
    assert seen == expected
