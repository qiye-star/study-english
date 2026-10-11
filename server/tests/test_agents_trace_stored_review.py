"""评审 #11:回存的 agent_trace 只能是 compact_trace 产出的已知结构。"""
import copy

import pytest

from app.agents import trace
from app.agents.context import SourceOutcome, SourceResult
from tests.agents_helpers import new_conversation

STEP = {"key": "word_lookup", "group": "tool", "status": "done", "ms": 4, "private": True,
        "label": "agents.step.word_lookup", "params": {"words": ["abandon"], "count": 1}}
GOOD = {"v": 1, "tools": "prefetch", "steps": [STEP], "thought": {"source": "reasoning", "text": "hmm", "chars": 3},
        "ms": {"ctx": 3, "ttft": -1, "total": 40}}
# what the web saves: its UI shape (ids, label_key, numeric ms, thought null)
WEB = {"v": 1, "ms": 1200, "thought": None,
       "steps": [{"id": "s1", "group": "context", "key": "persona", "status": "done", "label_key": "agents.step.persona",
                  "ms": 0, "private": False}]}


def outcomes(n: int, big: bool = False):
    result = lambda i: SourceResult("agents.step.word_lookup", {"words": [f"w{i}" * (30 if big else 1)] * 8}, "b")  # noqa: E731
    return [SourceOutcome(f"learned_words{i}", "done", result(i), i, True) for i in range(n)]


def test_everything_compact_trace_produces_is_accepted():
    thought = trace.Thought("reasoning", "t" * 5000)
    for n, big, with_thought in ((0, False, False), (3, False, True), (12, True, True), (60, True, True)):
        out = trace.compact_trace(outcomes(n, big), "prefetch", thought if with_thought else None,
                                  ms={"ctx": 5, "ttft": -1, "total": 99})
        assert trace.check_stored(out) is out


def test_web_ui_shape_and_minimal_shapes_are_accepted():
    for ok in (GOOD, WEB, {"v": 1, "steps": []}, {"v": 1, "tools": "off", "steps": [], "truncated": True},
               {"v": 1, "tools": "", "steps": [], "truncated": True}):
        assert trace.check_stored(ok) is ok


@pytest.mark.parametrize("mutate", [
    lambda t: t.update(extra="x"),
    lambda t: t.update(steps="nope"),
    lambda t: t.update(steps=[{"key": "a", "group": "tool", "status": "done"}] * 33),
    lambda t: t.update(tools="x" * 17),
    lambda t: t.update(tools=5),
    lambda t: t.update(truncated="yes"),
    lambda t: t.update(v=0),
    lambda t: t.update(v=10 ** 6),
    lambda t: t.update(ms={"a": {"b": 1}}),
    lambda t: t.update(ms={f"k{i}": 1 for i in range(9)}),
    lambda t: t.update(ms="slow"),
    lambda t: t.update(thought="text"),
    lambda t: t.update(thought={"source": "other", "text": "x"}),
    lambda t: t.update(thought={"source": "summary", "text": ["x"]}),
    lambda t: t.update(thought={"source": "summary", "text": "x", "evil": 1}),
    lambda t: t["steps"][0].update(evil=1),
    lambda t: t["steps"][0].update(status="exploded"),
    lambda t: t["steps"][0].update(group="admin"),
    lambda t: t["steps"][0].update(key="k" * 65),
    lambda t: t["steps"][0].update(key=""),
    lambda t: t["steps"][0].update(label=["x"]),
    lambda t: t["steps"][0].update(private="no"),
    lambda t: t["steps"][0].update(ms="4"),
    lambda t: t["steps"][0].update(params={"a": {"nested": 1}}),
    lambda t: t["steps"][0].update(params={f"p{i}": 1 for i in range(6)}),
    lambda t: t["steps"][0].update(params={"bad key": 1}),
    lambda t: t["steps"][0].update(params={"w": "x" * 41}),
    lambda t: t["steps"][0].update(params={"w": ["x"] * 9}),
    lambda t: t["steps"][0].update(params={"w": [1]}),
    lambda t: t["steps"][0].update(params=[1]),
    lambda t: t["steps"].append("not a step"),
])
def test_unknown_or_malformed_structures_are_invalid(mutate):
    bad = copy.deepcopy(GOOD)
    mutate(bad)
    with pytest.raises(ValueError, match="invalid"):
        trace.check_stored(bad)


async def test_api_rejects_arbitrary_json_with_422(client, auth_headers):
    conv = await new_conversation(client, auth_headers)
    for bad in ({"v": 1, "payload": {"deep": [1, 2, 3]}}, {"v": 1, "steps": [{"key": "x", "group": "tool", "status": "done",
                                                                            "html": "<script>"}]}):
        r = await client.post(f"/api/conversations/{conv}/messages", headers=auth_headers,
                              json={"messages": [{"role": "assistant", "content": "x", "agent_trace": bad}]})
        assert (r.status_code, r.json()) == (422, {"error": "Invalid agent trace"})
    ok = await client.post(f"/api/conversations/{conv}/messages", headers=auth_headers,
                           json={"messages": [{"role": "assistant", "content": "x", "agent_trace": WEB}]})
    assert ok.status_code == 200 and ok.json()["messages"][0]["agent_trace"] == WEB
