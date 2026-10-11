"""评审 #1:history 总字数预算(AGENTS_HISTORY_CHARS_MAX)与提示词总长上界。"""
from app.agents import prompt
from app.agents.personas import Persona
from tests.agents_helpers import FakeLLM, enable_agents, new_conversation, turn_body, use_fake_llm


def _hist(sizes):
    return [{"role": "user" if i % 2 else "assistant", "content": chr(97 + i % 26) * n} for i, n in enumerate(sizes)]


def test_clamp_history_total_budget_keeps_newest_whole_items():
    history = _hist([1500, 1500, 1500, 1500, 1500])
    out = prompt.clamp_history(history, 50, 4000)
    assert out == history[-2:]  # newest two; never split mid-item
    assert sum(len(m["content"]) for m in prompt.clamp_history(_hist([2000] * 50), 50, 8000)) <= 8000
    # an item that does not fit stops the walk (no older item jumps over it)
    assert [len(m["content"]) for m in prompt.clamp_history(_hist([100, 900, 100]), 50, 500)] == [100]
    assert prompt.clamp_history(_hist([100]), 50, 50) == []


def test_total_prompt_chars_are_bounded_in_the_worst_case():
    from app.agents.context import BLOCK_MAX_CHARS
    persona = Persona(id="p", owner_id=1, name="n" * 5000, intro="", prompt="p" * 20000, level="B1", style="friendly")
    history = prompt.clamp_history(_hist([20000] * 50), 50, 8000)
    msgs = prompt.build_messages(persona, memory_block="m" * 5000,
                                 blocks=[("a", "b" * BLOCK_MAX_CHARS)] * 4, history=history, text="t" * 2000)
    total = sum(len(m["content"]) for m in msgs)
    fixed = 3000  # preamble, headers, tags, level / style lines, keys
    bound = (8000 + 2000 + 4 * BLOCK_MAX_CHARS + prompt.MEMORY_HARD_MAX + prompt.PERSONA_PROMPT_HARD_MAX
             + prompt.PERSONA_NAME_HARD_MAX + fixed)
    assert total <= bound
    assert prompt.PERSONA_PROMPT_HARD_MAX == 4000


async def test_history_total_chars_budget_is_enforced_and_hot_reloadable(app, client, auth_headers):
    fake = await use_fake_llm(app, FakeLLM())
    enable_agents(app, agents_history_chars_max=4000)
    history = _hist([2000] * 50)
    conv = await new_conversation(client, auth_headers)
    await client.post("/api/agents/turn", headers=auth_headers, json=turn_body(conv, history=history))
    sent = fake.requests[0]["messages"][1:-1]
    assert sent == history[-2:]
    enable_agents(app, agents_history_chars_max=6000)
    await client.post("/api/agents/turn", headers=auth_headers, json=turn_body(conv, history=history))
    assert len(fake.requests[1]["messages"][1:-1]) == 3
