"""POST /api/agents/turn(spec §4.4;计划 R-C5、R-C6、R-C13、R-C14)。假上游;断开测试直接驱动 ASGI。"""
import asyncio
import contextlib
import json
import uuid

from app.agents.orchestrator import runtime
from app.core.quotas import quota_cache
from app.models import AgentPersona, UserQuotaOverride, utcnow
from tests.agents_helpers import FakeLLM, enable_agents, new_conversation, parse_sse, turn_body, use_fake_llm


async def uid(client, headers) -> int:
    return int((await client.get("/api/me", headers=headers)).json()["id"])


async def post_turn(client, headers, body):
    return await client.post("/api/agents/turn", headers=headers, json=body)


async def test_disabled_is_404(client, auth_headers):
    r = await post_turn(client, auth_headers, turn_body(str(uuid.uuid4())))
    assert (r.status_code, r.json()) == (404, {"error": "Agents are disabled"})


async def test_streams_events_with_sse_headers(app, client, auth_headers):
    fake = await use_fake_llm(app, FakeLLM(["Hi", " there"]))
    enable_agents(app)
    r = await post_turn(client, auth_headers, turn_body(await new_conversation(client, auth_headers)))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    assert r.headers["cache-control"] == "no-cache" and r.headers["x-accel-buffering"] == "no"
    events = parse_sse(r.text)
    assert events[0][0] == "start" and events[-1][0] == "done"
    assert "".join(d["text"] for e, d in events if e == "delta") == "Hi there"
    assert events[-1][1]["usage"] == {"in": 12, "out": 5} and events[-1][1]["text_len"] == 8
    assert len(fake.requests) == 1


async def test_ownership_persona_text_and_shape_checks(app, client, auth_headers):
    await use_fake_llm(app, FakeLLM())
    enable_agents(app)
    bob = {"Authorization": "Bearer " + (await client.post("/api/users", json={
        "username": "bob", "password": "password123"})).json()["access_token"]}
    bobs = await new_conversation(client, bob)
    r = await post_turn(client, auth_headers, turn_body(bobs))
    assert (r.status_code, r.json()) == (404, {"error": "Conversation not found"})
    mine = await new_conversation(client, auth_headers)
    r = await post_turn(client, auth_headers, turn_body(mine, persona_id=str(uuid.uuid4())))
    assert (r.status_code, r.json()) == (404, {"error": "Persona not found"})
    r = await post_turn(client, auth_headers, turn_body(mine, text="  "))
    assert (r.status_code, r.json()) == (422, {"error": "Text is required"})
    assert (await post_turn(client, auth_headers, turn_body(mine, client_turn_id="abc"))).status_code == 422
    history = [{"role": "user", "content": "x"}] * 51
    assert (await post_turn(client, auth_headers, turn_body(mine, history=history))).status_code == 422
    assert (await post_turn(client, auth_headers, turn_body(mine, text="x" * 2001))).status_code == 422


async def test_tutor_mode_switch_and_missing_handler(app, client, auth_headers):
    await use_fake_llm(app, FakeLLM())
    enable_agents(app, agents_tutor_enabled=False)
    conv = await new_conversation(client, auth_headers)
    r = await post_turn(client, auth_headers, turn_body(conv, mode="tutor", text=None))
    assert (r.status_code, r.json()) == (404, {"error": "Tutor is disabled"})
    enable_agents(app, agents_tutor_enabled=True)
    events = parse_sse((await post_turn(client, auth_headers, turn_body(conv, mode="tutor", text=None))).text)
    if "tutor" not in runtime(app).modes.names():  # plan A3 not merged yet
        assert events[-1] == ("error", {"code": "bad_request"})


async def test_same_client_turn_id_replays_and_running_is_409(app, client, auth_headers):
    fake = await use_fake_llm(app, FakeLLM(["Hi", " there"]))
    enable_agents(app)
    body = turn_body(await new_conversation(client, auth_headers))
    first = parse_sse((await post_turn(client, auth_headers, body)).text)
    second = parse_sse((await post_turn(client, auth_headers, body)).text)
    assert [e for e, _ in second] == ["start", "delta", "done"]
    assert second[0][1] == first[0][1] and second[1][1] == {"text": "Hi there"} and second[-1][1] == first[-1][1]
    assert len(fake.requests) == 1
    other = turn_body(body["conversation_id"])
    runtime(app).ledger.begin(await uid(client, auth_headers), other["client_turn_id"])
    r = await post_turn(client, auth_headers, other)
    assert (r.status_code, r.json()) == (409, {"error": "Turn is busy"})


async def test_two_running_turns_make_the_third_busy(app, client, auth_headers):
    await use_fake_llm(app, FakeLLM())
    enable_agents(app)
    me = await uid(client, auth_headers)
    runtime(app).ledger.begin(me, str(uuid.uuid4()))
    runtime(app).ledger.begin(me, str(uuid.uuid4()))
    events = parse_sse((await post_turn(client, auth_headers, turn_body(await new_conversation(client, auth_headers)))).text)
    assert [e for e, _ in events] == ["start", "error"] and events[-1][1] == {"code": "busy"}


async def test_daily_caps_and_per_user_override(app, client, auth_headers):
    fake = await use_fake_llm(app, FakeLLM())
    enable_agents(app, agents_turns_daily_per_user=1)
    conv = await new_conversation(client, auth_headers)
    assert parse_sse((await post_turn(client, auth_headers, turn_body(conv))).text)[-1][0] == "done"
    assert parse_sse((await post_turn(client, auth_headers, turn_body(conv))).text)[-1] == ("error", {"code": "limit"})
    async with app.state.sessionmaker() as s:
        s.add(UserQuotaOverride(user_id=await uid(client, auth_headers), key="agents_turns_daily_per_user", value=2,
                                updated_by="t"))
        await s.commit()
    quota_cache(app).invalidate()
    assert parse_sse((await post_turn(client, auth_headers, turn_body(conv))).text)[-1][0] == "done"
    enable_agents(app, agents_turns_global_daily=0)
    assert parse_sse((await post_turn(client, auth_headers, turn_body(conv))).text)[-1] == ("error", {"code": "limit"})
    assert len(fake.requests) == 2


async def test_history_is_clamped_server_side(app, client, auth_headers):
    fake = await use_fake_llm(app, FakeLLM())
    enable_agents(app, agents_history_max=4)
    history = [{"role": "user" if i % 2 else "assistant", "content": f"m{i}"} for i in range(30)]
    await post_turn(client, auth_headers, turn_body(await new_conversation(client, auth_headers), history=history))
    assert len(fake.requests[0]["messages"]) == 1 + 4 + 1


async def test_disabled_persona_and_upstream_failure_events(app, client, auth_headers):
    await use_fake_llm(app, FakeLLM(status=402))
    enable_agents(app)
    conv = await new_conversation(client, auth_headers)
    r = await post_turn(client, auth_headers, turn_body(conv))
    assert parse_sse(r.text)[-1] == ("error", {"code": "llm_unavailable"}) and "upstream-secret-body" not in r.text
    tom = (await client.post("/api/agents/personas", headers=auth_headers,
                             json={"name": "Tom", "prompt": "Be Tom."})).json()
    async with app.state.sessionmaker() as s:
        (await s.get(AgentPersona, tom["id"])).disabled_at = utcnow()
        await s.commit()
    events = parse_sse((await post_turn(client, auth_headers, turn_body(conv, persona_id=tom["id"]))).text)
    assert [e for e, _ in events] == ["start", "error"] and events[-1][1] == {"code": "disabled"}


def _scope(headers: dict, spec_version: str) -> dict:
    return {"type": "http", "asgi": {"version": "3.0", "spec_version": spec_version}, "http_version": "1.1",
            "method": "POST", "scheme": "http", "path": "/api/agents/turn", "raw_path": b"/api/agents/turn",
            "query_string": b"", "root_path": "", "client": ("127.0.0.1", 5000), "server": ("test", 80),
            "headers": [(b"host", b"test"), (b"content-type", b"application/json"),
                        (b"authorization", headers["Authorization"].encode())]}


async def _disconnect_case(app, client, auth_headers, spec_version: str):
    fake = await use_fake_llm(app, FakeLLM(["first", "never"], gate=asyncio.Event()))
    enable_agents(app)
    body = turn_body(await new_conversation(client, auth_headers))
    raw = json.dumps(body).encode()
    gone, state = asyncio.Event(), {"sent": False}

    async def receive():
        if not state["sent"]:
            state["sent"] = True
            return {"type": "http.request", "body": raw, "more_body": False}
        await gone.wait()
        return {"type": "http.disconnect"}

    async def send(message):
        if message["type"] == "http.response.body" and b"event: delta" in message.get("body", b""):
            if spec_version >= "2.4":
                raise OSError("client went away")
            gone.set()

    with contextlib.suppress(Exception):
        await asyncio.wait_for(app(_scope(auth_headers, spec_version), receive, send), 5)
    assert fake.streams and fake.streams[0].closed
    return body


async def test_disconnect_closes_the_upstream_with_asgi_spec_2_3(app, client, auth_headers):
    body = await _disconnect_case(app, client, auth_headers, "2.3")
    me = await uid(client, auth_headers)
    assert runtime(app).ledger.begin(me, body["client_turn_id"])[0] == "new"  # dropped: a retry runs again


async def test_disconnect_closes_the_upstream_with_asgi_spec_2_4(app, client, auth_headers):
    await _disconnect_case(app, client, auth_headers, "2.4")


async def test_persona_try_is_one_shot_counts_the_cap_and_validates(app, client, auth_headers):
    fake = await use_fake_llm(app, FakeLLM(["Meow."]))
    enable_agents(app, agents_turns_daily_per_user=1)
    body = {"persona": {"name": "Tom", "prompt": "You are Tom the cat."}, "text": "Hi"}
    r = await client.post("/api/agents/personas/try", headers=auth_headers, json=body)
    assert (r.status_code, r.json()) == (200, {"text": "Meow."})
    system = fake.requests[0]["messages"][0]["content"]
    assert "You are Tom the cat." in system and fake.requests[0].get("stream") is False
    capped = await client.post("/api/agents/personas/try", headers=auth_headers, json=body)
    assert capped.status_code == 429
    enable_agents(app, agents_turns_daily_per_user=5)
    bad = await client.post("/api/agents/personas/try", headers=auth_headers, json={**body, "persona": {"name": "", "prompt": "x"}})
    assert (bad.status_code, bad.json()) == (422, {"error": "Invalid name"})
    blank = await client.post("/api/agents/personas/try", headers=auth_headers, json={**body, "text": "  "})
    assert (blank.status_code, blank.json()) == (422, {"error": "Text is required"})
    assert (await client.get("/api/agents/personas", headers=auth_headers)).json()["personas"][-1]["builtin"]  # nothing saved
    assert len(fake.requests) == 1


async def test_persona_try_refunds_when_the_upstream_fails_and_is_404_when_disabled(app, client, auth_headers):
    body = {"persona": {"name": "Tom", "prompt": "Be Tom."}, "text": "Hi"}
    assert (await client.post("/api/agents/personas/try", headers=auth_headers, json=body)).status_code == 404
    await use_fake_llm(app, FakeLLM(status=402))
    enable_agents(app, agents_turns_daily_per_user=1)
    r = await client.post("/api/agents/personas/try", headers=auth_headers, json=body)
    assert (r.status_code, r.json()) == (502, {"error": "Upstream unavailable"}) and "upstream-secret-body" not in r.text
    await use_fake_llm(app, FakeLLM(["ok"]))
    assert (await client.post("/api/agents/personas/try", headers=auth_headers, json=body)).status_code == 200  # refunded
