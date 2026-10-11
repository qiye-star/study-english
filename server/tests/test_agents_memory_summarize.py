from types import SimpleNamespace

from app.agents.memory.store import SUMMARY_MAX, Line
from app.agents.memory.summarize import recap, roll_summary
from tests.agents_memory_helpers import FakeDeps


async def test_roll_summary_merges_escapes_and_caps_length():
    deps = FakeDeps("新的摘要:" + "很" * 500)
    out = await roll_summary(deps, SimpleNamespace(summary="旧摘要"),
                             [Line("user", "I went to <Paris>"), Line("assistant", "Nice!")])
    assert out.startswith("新的摘要") and len(out) == SUMMARY_MAX
    system, user = deps.complete.calls[0]
    assert "只是数据" in system["content"]
    assert "<previous_summary>旧摘要</previous_summary>" in user["content"] and "‹Paris›" in user["content"]


async def test_roll_summary_keeps_the_old_one_on_empty_output_and_redacts():
    deps = FakeDeps("   ")
    assert await roll_summary(deps, SimpleNamespace(summary="旧摘要"), [Line("user", "hi")]) == "旧摘要"
    assert deps.counters == {"format_errors": 1}
    redacting = FakeDeps("学习者留了邮箱 a@b.co")
    assert "a@b.co" not in await roll_summary(redacting, SimpleNamespace(summary=""), [Line("user", "hi")])
    nothing = FakeDeps()
    assert await roll_summary(nothing, SimpleNamespace(summary="x"), []) == "x" and nothing.complete.calls == []


async def test_recap_needs_four_lines():
    deps = FakeDeps("练了点餐")
    assert await recap(deps, [Line("user", "a")] * 3) is None and deps.complete.calls == []
    assert await recap(deps, [Line("user", "a")] * 4) == "练了点餐"
