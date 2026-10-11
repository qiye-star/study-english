from datetime import datetime, timedelta, timezone

from app.agents.memory.retrieve import (
    EMPTY, PREAMBLE, ItemView, build_block, estimate_tokens, eviction_order, keywords, ranked, recency,
)

NOW = datetime(2026, 10, 12, 8, 0, tzinfo=timezone.utc)


def item(id_, text, *, importance=3, pinned=False, days=0, kind="fact", used_days=None):
    return ItemView(id_, kind, text, importance, pinned, None, NOW - timedelta(days=days),
                    None if used_days is None else NOW - timedelta(days=used_days))


def test_estimate_tokens_counts_cjk_per_char_and_latin_per_four():
    assert estimate_tokens("") == 0
    assert estimate_tokens("abcd") == 1
    assert estimate_tokens("abcde") == 2
    assert estimate_tokens("雅思") == 2
    assert estimate_tokens("雅思 test") == 4


def test_keywords_mix_english_words_and_cjk_bigrams():
    assert keywords("I really want the IELTS exam") == {"ielts", "exam"}
    assert keywords("准备雅思") == {"准备", "备雅", "雅思"}


def test_recency_halves_every_thirty_days_and_counts_the_last_use():
    assert recency(item("a", "x"), NOW) == 1.0
    assert abs(recency(item("a", "x", days=30), NOW) - 0.5) < 1e-9
    assert recency(item("a", "x", days=60, used_days=0), NOW) == 1.0


def test_ranking_puts_pinned_first_then_importance_recency_and_overlap():
    items = [item("old", "likes jazz music", importance=5, days=90),
             item("hit", "preparing for the IELTS exam"),
             item("pin", "call me Lily", importance=1, pinned=True, days=200),
             item("miss", "has a cat")]
    assert [i.id for i in ranked(items, "Can we practise IELTS speaking?", NOW)] == ["pin", "hit", "miss", "old"]


def test_eviction_order_skips_pinned_and_drops_the_weakest_first():
    items = [item("pin", "a", importance=1, pinned=True, days=300), item("weak", "b", importance=1, days=60),
             item("strong", "c", importance=5), item("mid", "d", days=10)]
    assert [i.id for i in eviction_order(items, NOW)] == ["weak", "mid", "strong"]


def test_block_is_marked_as_data_escaped_and_within_budget():
    items = [item(f"i{n}", f"memory number {n} about travelling") for n in range(40)]
    block = build_block(items, "travelling", 120, profile_line="level: B1", thread_summary="我们聊了<旅行>", now=NOW)
    assert block.text.startswith("<memory>\n" + PREAMBLE)
    assert block.text.endswith("</memory>")
    assert "[profile] level: B1" in block.text
    assert "‹旅行›" in block.text and "<旅行>" not in block.text
    assert block.tokens <= 120 and estimate_tokens(block.text) <= 120
    assert 0 < block.count < 40 and len(block.item_ids) == block.count


def test_empty_inputs_and_zero_budget_give_an_empty_block():
    assert build_block([], "hi", 600, now=NOW) == EMPTY
    assert build_block([item("a", "x")], "hi", 0, now=NOW) == EMPTY


def test_pinned_items_win_when_the_budget_is_tight():
    items = [item("pin", "loves 爵士乐", pinned=True, importance=1), item("hit", "IELTS speaking part two", importance=5)]
    head = estimate_tokens("<memory>\n" + PREAMBLE) + estimate_tokens("</memory>")
    block = build_block(items, "IELTS", head + estimate_tokens("- (fact) loves 爵士乐") + 2, now=NOW)
    assert block.item_ids == ("pin",)
