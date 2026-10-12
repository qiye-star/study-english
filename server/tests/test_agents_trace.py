"""过程事件与压缩过程(spec §4.4;计划 R-C17、R-C23)。"""
import json
from types import SimpleNamespace

import pytest

from app.agents import trace


def outcome(key, status="done", params=None, label=None, ms=3, private=True):
    result = SimpleNamespace(label_key=label or f"agents.step.{key}", params=params or {}, block="x") \
        if status == "done" else None
    return SimpleNamespace(key=key, status=status, result=result, ms=ms, private=private)


def test_sse_lines_and_compact_json():
    assert trace.Start("t1").to_sse() == 'event: start\ndata: {"turn_id":"t1"}\n\n'
    assert trace.Delta("你好 <b>").to_sse() == 'event: delta\ndata: {"text":"你好 <b>"}\n\n'
    assert trace.Error("limit").to_dict() == {"code": "limit"}


def test_step_omits_missing_optional_fields_and_validates():
    step = trace.Step(id="s1", group="tool", key="word_lookup", status="run", label_key="agents.step.word_lookup",
                      private=True)
    assert step.to_dict() == {"id": "s1", "group": "tool", "key": "word_lookup", "status": "run",
                              "label_key": "agents.step.word_lookup", "private": True}
    done = trace.Step(id="s1", group="tool", key="word_lookup", status="done", label_key="x", private=True,
                      params={"words": ["abandon"]}, ms=4)
    assert done.to_dict()["params"] == {"words": ["abandon"]} and done.to_dict()["ms"] == 4
    with pytest.raises(ValueError):
        trace.Step(id="s1", group="tool", key="k", status="maybe", label_key="x", private=False)
    with pytest.raises(ValueError):
        trace.Error("upstream said no")
    with pytest.raises(ValueError):
        trace.Thought("guess", "x")


def test_done_usage_shape_and_meta_from_dict():
    done = trace.Done(text_len=5, trace={"v": 1}, usage=(12, 5))
    assert done.to_dict() == {"text_len": 5, "trace": {"v": 1}, "usage": {"in": 12, "out": 5}}
    assert "usage" not in trace.Done(text_len=0, trace={"v": 1}).to_dict()
    meta = trace.Meta.from_dict({"step_index": 2, "steps_total": 8, "verdict": "good", "kind": "ask", "done": False,
                                 "next_focus": "dropped"})
    assert meta.to_dict() == {"step_index": 2, "steps_total": 8, "verdict": "good", "kind": "ask", "done": False}
    extra = trace.Meta.from_dict({"step_index": 1, "steps_total": 3, "retry": True, "say": "Hi there"})
    assert extra.to_dict() == {"step_index": 1, "steps_total": 3, "retry": True, "say": "Hi there"}
    assert trace.Meta.from_dict({"verdict": "good"}) is None
    assert trace.Meta.from_dict({"step_index": "2", "steps_total": 8}) is None


def test_clean_params_limits_keys_strings_and_lists():
    params = {"words": [f"w{i}" * 30 for i in range(20)], "count": 3, "bad key": 1, "nested": {"a": 1},
              "flag": True, "text": "x" * 100, "sixth": 1, "seventh": 2}
    out = trace.clean_params(params)
    assert len(out["words"]) == 8 and all(len(w) <= 40 for w in out["words"])
    assert out["count"] == 3 and out["flag"] is True and len(out["text"]) == 40
    assert "bad key" not in out and "nested" not in out and len(out) <= 5


def test_compact_trace_shape_groups_and_labels():
    steps = [outcome("persona", private=False), outcome("learned_words", params={"count": 2, "words": ["a", "b"]}),
             outcome("word_lookup", status="skip", ms=150), outcome("history", private=False)]
    out = trace.compact_trace(steps, "prefetch", trace.Thought("reasoning", "because"), ms={"ctx": 12, "ttft": 300,
                                                                                         "total": 900})
    assert out["v"] == 1 and out["tools"] == "prefetch"
    assert [(s["key"], s["group"], s["status"]) for s in out["steps"]] == [
        ("persona", "context", "done"), ("learned_words", "tool", "done"), ("word_lookup", "tool", "skip"),
        ("history", "context", "done")]
    assert out["steps"][1]["params"] == {"count": 2, "words": ["a", "b"]}
    assert out["steps"][2]["label"] == "agents.step.word_lookup" and "params" not in out["steps"][2]
    assert out["thought"] == {"source": "reasoning", "text": "because", "chars": 7}
    assert out["ms"] == {"ctx": 12, "ttft": 300, "total": 900}


def test_compact_trace_always_fits_in_4_kb():
    steps = [outcome(f"src{i}", params={"words": ["x" * 40] * 8, "note": "y" * 40}) for i in range(40)]
    out = trace.compact_trace(steps, "prefetch", trace.Thought("reasoning", "z" * 5000))
    assert trace.size_of(out) <= trace.TRACE_MAX_BYTES
    assert out.get("truncated") is True or "thought" not in out or len(out["thought"]["text"]) <= 600


def test_check_stored():
    assert trace.check_stored({"v": 1, "steps": []}) == {"v": 1, "steps": []}
    for bad in ({"steps": []}, {"v": "1"}, {"v": True}, ["v"], "x"):
        with pytest.raises(ValueError, match="invalid"):
            trace.check_stored(bad)
    with pytest.raises(ValueError, match="too_large"):
        trace.check_stored({"v": 1, "pad": "x" * 5000})
    assert json.loads(trace.dumps({"a": "中"})) == {"a": "中"}


def test_done_carries_an_optional_note_and_the_compact_trace_keeps_it():
    from app.agents import trace as T

    assert "note_zh" not in T.Done(text_len=3, trace={"v": 1}).to_dict()
    assert T.Done(text_len=3, trace={"v": 1}, note_zh="意思是放弃").to_dict()["note_zh"] == "意思是放弃"
    assert T.compact_trace([], "prefetch", None, note_zh="很好" * 50)["note_zh"] == ("很好" * 50)[:80]
    assert "note_zh" not in T.compact_trace([], "prefetch", None)
    huge = {"v": 1, "tools": "prefetch", "note_zh": "很好", "steps": [
        {"key": "k" * 400, "group": "tool", "status": "done", "ms": 1, "private": False, "label": "l"}
        for _ in range(20)]}
    assert T.fit(huge) == {"v": 1, "tools": "prefetch", "steps": [], "truncated": True, "note_zh": "很好"}


def test_stored_trace_accepts_a_short_note_only():
    from app.agents import trace as T

    base = {"v": 1, "tools": "prefetch", "steps": []}
    assert T.check_stored({**base, "note_zh": "很好"})["note_zh"] == "很好"
    assert T.check_stored({**base, "note_zh": None})["note_zh"] is None
    for bad in ("很" * 81, 3, ["x"]):
        with pytest.raises(ValueError):
            T.check_stored({**base, "note_zh": bad})
