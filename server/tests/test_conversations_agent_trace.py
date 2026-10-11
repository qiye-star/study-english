"""messages.agent_trace(spec §4.4;计划 R-C17):只在 assistant 消息上,≤ 4 KB,原样返回。"""
from tests.agents_helpers import new_conversation

TRACE = {"v": 1, "tools": "prefetch", "steps": [{"key": "word_lookup", "group": "tool", "status": "done", "ms": 4,
                                                 "private": True, "label": "agents.step.word_lookup",
                                                 "params": {"words": ["abandon"]}}]}


async def post(client, headers, conv, messages):
    return await client.post(f"/api/conversations/{conv}/messages", headers=headers, json={"messages": messages})


async def test_assistant_trace_is_stored_and_returned(client, auth_headers):
    conv = await new_conversation(client, auth_headers)
    r = await post(client, auth_headers, conv, [{"role": "user", "content": "hi"},
                                                {"role": "assistant", "content": "hello", "agent_trace": TRACE}])
    assert r.status_code == 200, r.text
    assert [m["agent_trace"] for m in r.json()["messages"]] == [None, TRACE]
    listed = (await client.get(f"/api/conversations/{conv}/messages", headers=auth_headers)).json()["messages"]
    assert listed[1]["agent_trace"] == TRACE and listed[0]["agent_trace"] is None


async def test_trace_rules(client, auth_headers):
    conv = await new_conversation(client, auth_headers)
    cases = (
        ({"role": "user", "content": "hi", "agent_trace": TRACE}, "Only assistant messages can carry an agent trace"),
        ({"role": "assistant", "content": "x", "agent_trace": {"steps": []}}, "Invalid agent trace"),
        ({"role": "assistant", "content": "x", "agent_trace": {"v": 1, "pad": "y" * 5000}}, "Agent trace is too large"),
    )
    for message, error in cases:
        r = await post(client, auth_headers, conv, [message])
        assert (r.status_code, r.json()) == (422, {"error": error})
    ok = await post(client, auth_headers, conv, [{"role": "assistant", "content": "x", "agent_trace": None}])
    assert ok.json()["messages"][0]["agent_trace"] is None
