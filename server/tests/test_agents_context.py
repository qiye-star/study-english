"""上下文来源(spec §4.6;计划 R-C15、R-C22):开关矩阵、逐源超时、总预算、失败与空结果。"""
import asyncio
import logging
import time
from types import SimpleNamespace

import pytest

from app.agents.context import (
    TOOL_KEYS, SourceCtx, SourceRegistry, SourceResult, enabled, prefetch,
)


class Fake:
    def __init__(self, key, *, private=True, sleep=0.0, result="block", boom=False):
        self.key, self.private, self.sleep, self.result, self.boom = key, private, sleep, result, boom
        self.calls = 0

    async def load(self, ctx):
        self.calls += 1
        if self.sleep:
            await asyncio.sleep(self.sleep)
        if self.boom:
            raise RuntimeError(f"secret {ctx.text}")
        if self.result is None:
            return None
        return SourceResult(f"agents.step.{self.key}", {"count": 1}, self.result)


def ctx(*, tools=None, persona_tools=TOOL_KEYS, memory=True, share=True, in_room=False, text="hello"):
    settings = SimpleNamespace(tools={k: True for k in TOOL_KEYS} | (tools or {}), memory_enabled=memory,
                               share_in_rooms=share)
    return SourceCtx(1, SimpleNamespace(tools=tuple(persona_tools)), settings, text, "c1", in_room)


def registry(*sources):
    r = SourceRegistry()
    for s in sources:
        r.register(s)
    return r


def test_register_rejects_builtin_keys_and_duplicates():
    r = SourceRegistry()
    a = Fake("learned_words")
    r.register(a)
    r.register(a)  # same object again is a no-op
    with pytest.raises(ValueError):
        r.register(Fake("learned_words"))
    for key in ("persona", "history", ""):
        with pytest.raises(ValueError):
            r.register(Fake(key))
    assert r.keys() == ("learned_words",)


def test_enabled_matrix():
    lookup, memory, custom = Fake("word_lookup"), Fake("memory"), Fake("tutor_plan", private=False)
    assert enabled(lookup, ctx(), "prefetch") and enabled(lookup, ctx(), "native")
    assert not enabled(lookup, ctx(), "off") and enabled(memory, ctx(), "off")
    assert not enabled(lookup, ctx(tools={"lookup": False}), "prefetch")
    assert not enabled(lookup, ctx(persona_tools=("memory",)), "prefetch")
    assert not enabled(memory, ctx(memory=False), "prefetch")
    assert not enabled(memory, ctx(persona_tools=("lookup",)), "prefetch")
    assert not enabled(lookup, ctx(in_room=True, share=False), "prefetch")
    assert enabled(lookup, ctx(in_room=True, share=True), "prefetch")
    assert enabled(custom, ctx(in_room=True, share=False), "off") is False
    assert enabled(custom, ctx(in_room=True, share=False), "prefetch")  # not private, not a tool


async def test_prefetch_runs_in_parallel_and_reports_each_status(caplog):
    caplog.set_level(logging.DEBUG)
    fast, slow, broken, empty = (Fake("learned_words", sleep=0.01), Fake("due_words", sleep=1.0),
                                 Fake("weak_words", boom=True), Fake("word_lookup", result=None))
    t0 = time.perf_counter()
    out = await prefetch(registry(fast, slow, broken, empty), ctx(text="SECRET-TEXT"), 250, timeout_ms=100)
    elapsed = time.perf_counter() - t0
    by = {o.key: o for o in out}
    assert [o.key for o in out] == ["learned_words", "due_words", "weak_words", "word_lookup"]
    assert by["learned_words"].status == "done" and by["learned_words"].result.block == "block"
    assert by["due_words"].status == "skip" and by["due_words"].result is None
    assert by["weak_words"].status == "fail" and by["word_lookup"].status == "done"
    assert by["word_lookup"].result is None and all(o.private for o in out)
    assert elapsed < 0.6
    assert "SECRET-TEXT" not in caplog.text and "key=weak_words error=RuntimeError" in caplog.text


async def test_total_budget_caps_the_per_source_timeout():
    t0 = time.perf_counter()
    out = await prefetch(registry(Fake("learned_words", sleep=1.0)), ctx(), 50, timeout_ms=150)
    assert out[0].status == "skip" and time.perf_counter() - t0 < 0.4


async def test_disabled_sources_are_not_called_and_blocks_are_truncated():
    off, long = Fake("word_lookup"), Fake("learned_words", result="x" * 5000)
    out = await prefetch(registry(off, long), ctx(tools={"lookup": False}), 250, timeout_ms=150)
    assert off.calls == 0 and [o.key for o in out] == ["learned_words"]
    assert len(out[0].result.block) == 800 and out[0].result.ms >= 0


async def test_nothing_selected_returns_empty_list():
    assert await prefetch(registry(Fake("word_lookup")), ctx(), 250, tools_mode="off") == []
