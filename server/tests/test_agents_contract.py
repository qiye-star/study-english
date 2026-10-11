"""智能体 REST / SSE 形状(spec §11.3;AX-1 第 5 项)。重录:`CONTRACT_UPDATE=1 uv run pytest -q tests/test_agents_contract.py`
(PowerShell:`$env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_agents_contract.py; Remove-Item Env:CONTRACT_UPDATE`)。
随机 uuid、时间戳和毫秒数在写入前被固定(`agents_helpers.stable`),所以重录两次文件内容相同。"""
import json
from pathlib import Path

from app.agents import trace
from app.agents.personas import builtin_by_id
from tests.agents_helpers import (
    FakeLLM, check_contract, enable_agents, new_conversation, parse_sse, turn_body, use_fake_llm,
)

ERRORS = ["Agents are disabled", "Tutor is disabled", "Persona not found", "Built-in personas are read-only",
          "Persona limit reached", "Report limit reached", "Unknown persona", "Text is required", "Turn is busy",
          "Conversation not found", "Only assistant messages can carry an agent trace", "Agent trace is too large",
          "Invalid agent trace"]
REQUIRED_KEYS = ("config", "personas", "persona_created", "settings", "turn_sse", "turn_error_sse",
                 "message_with_trace", "persona_try", "persona_report")


def listed(events: list[tuple[str, dict]]) -> list[dict]:
    return [{"event": event, "data": data} for event, data in events]


async def test_agents_contract(app, client, auth_headers):
    config_off = (await client.get("/api/agents/config", headers=auth_headers)).json()
    await use_fake_llm(app, FakeLLM(["Hello", " there."], reasoning=["Thinking about tense."]))
    enable_agents(app)
    config = (await client.get("/api/agents/config", headers=auth_headers)).json()
    persona = (await client.post("/api/agents/personas", headers=auth_headers, json={
        "name": "Tom", "intro": "A cat", "prompt": "You are Tom the cat.", "level": "B2", "style": "humor",
        "deep_think": True})).json()
    personas = (await client.get("/api/agents/personas", headers=auth_headers)).json()["personas"]
    settings = (await client.get("/api/agents/settings", headers=auth_headers)).json()
    conv = await new_conversation(client, auth_headers)
    events = parse_sse((await client.post("/api/agents/turn", headers=auth_headers, json=turn_body(
        conv, persona_id=persona["id"], text="I have went home"))).text)
    by_type: dict = {}
    for event, data in events:
        by_type.setdefault(event, data)
    step_done = next(d for e, d in events if e == "step" and d["status"] == "done" and d["key"] == "history")
    message = (await client.post(f"/api/conversations/{conv}/messages", headers=auth_headers, json={"messages": [
        {"role": "assistant", "content": "Hello there.", "agent_trace": by_type["done"]["trace"]}]})).json()
    bob = {"Authorization": "Bearer " + (await client.post("/api/users", json={
        "username": "bob", "password": "password123"})).json()["access_token"]}
    report = (await client.post(f"/api/agents/personas/{persona['id']}/report", headers=bob,
                                json={"reason": "spam"})).json()
    tried = (await client.post("/api/agents/personas/try", headers=auth_headers, json={
        "persona": {"name": "Tom", "prompt": "You are Tom the cat."}, "text": "Hi"})).json()
    enable_agents(app, agents_turns_global_daily=0)
    error_events = parse_sse((await client.post("/api/agents/turn", headers=auth_headers, json=turn_body(conv))).text)
    check_contract("agents_contract", {
        "config_off": config_off,
        "config": config,
        "personas": [personas[0], personas[-1]],
        "persona": persona,
        "persona_created": persona,
        "settings": settings,
        "turn_sse": listed(events),
        "turn_error_sse": listed(error_events),
        "events": {
            "start": by_type["start"], "step": step_done, "thought": by_type["thought"], "delta": by_type["delta"],
            "meta": trace.Meta(step_index=1, steps_total=8, verdict="good", kind="ask", done=False).to_dict(),
            "done": by_type["done"], "error": trace.Error("limit").to_dict(),
        },
        "message_with_trace": message["messages"][0],
        "persona_try": tried,
        "persona_report": report,
        "errors": ERRORS,
    })
    assert personas[0]["id"] == builtin_by_id("builtin:coach").id and personas[-1]["id"] == persona["id"]
    assert error_events[-1] == ("error", {"code": "limit"}) and tried["text"] == "Hello there."


def test_fixture_has_the_keys_the_web_reads():
    data = json.loads((Path(__file__).parent / "fixtures" / "agents_contract.json").read_text(encoding="utf-8"))
    assert all(key in data for key in REQUIRED_KEYS)
    assert data["persona_report"] == {"ok": True}
