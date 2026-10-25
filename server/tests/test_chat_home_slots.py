"""Fact slots of the daily greeting (plan 2026-10-23 addendum 2026-10-25, R18): phrases are built by code, pure functions."""
import pytest

from app.agents.greeting import parse as P, slots as S
from app.agents.greeting.facts import GreetingFacts

FULL = GreetingFacts(streak=7, due=20, slip_category="tense", slip_count=2, slip_wrong="have went", slip_right="have gone")


@pytest.mark.parametrize("due,minutes", [(None, 5), (0, 5), (1, 5), (5, 5), (6, 10), (20, 10), (21, 15), (400, 15)])
def test_practice_minutes_follow_the_amount_due(due, minutes):
    assert S.minutes_for(due) == minutes


def test_nothing_is_offered_without_facts_or_with_stats_off():
    for facts, stats in ((GreetingFacts(), True), (GreetingFacts(streak=0, due=0), True), (FULL, False)):
        for language in ("zh", "en", "bilingual"):
            assert S.build(facts, stats, language) == {}


def test_phrases_are_localized_by_code_in_every_language():
    en = S.build(FULL, True, "en")
    assert list(en) == ["streak", "due", "mistake", "practice_minutes"]
    assert en["streak"]["en"] == "a 7-day streak" and en["streak"]["zh"] == "连续学习第 7 天"
    assert en["due"]["en"] == "20 words to review" and en["due"]["zh"] == "有 20 个单词待复习"
    assert en["practice_minutes"] == {"en": "10 minutes", "zh": "10 分钟"}
    assert en["mistake"]["en"] == "have went → have gone"
    zh = S.build(FULL, True, "zh")
    assert zh["mistake"]["zh"] == "时态上的小错" and not any(c.isascii() and c.isalpha() for c in zh["mistake"]["zh"])
    bi = S.build(FULL, True, "bilingual")
    assert bi["mistake"] == {"en": "have went → have gone", "zh": "have went → have gone"}


def test_english_plural_is_handled_by_code():
    one = S.build(GreetingFacts(due=1), True, "en")
    assert one["due"]["en"] == "1 word to review" and one["due"]["zh"] == "有 1 个单词待复习"
    assert one["practice_minutes"]["en"] == "5 minutes"
    assert S.build(GreetingFacts(due=2), True, "en")["due"]["en"] == "2 words to review"
    assert S.build(GreetingFacts(streak=1), True, "en")["streak"]["en"] == "a 1-day streak"
    assert S.build(GreetingFacts(due=10 ** 7), True, "en")["due"]["en"] == "9999 words to review"


def test_mistake_comes_from_data_with_safe_fallbacks():
    cat = GreetingFacts(slip_category="article", slip_count=3, slip_wrong="x" * 3, slip_right="a<b")  # unsafe pair is dropped
    assert S.build(cat, True, "en")["mistake"]["en"] == "a slip with articles"
    long = GreetingFacts(slip_category="tense", slip_count=1, slip_wrong="w" * 17, slip_right="ok")
    assert S.build(long, True, "bilingual")["mistake"]["zh"] == "时态上的小错"
    words = GreetingFacts(wrong_words=3)
    assert S.build(words, True, "en")["mistake"] == {"en": "words that tripped you up", "zh": "没掌握好的单词"}
    for bad in ("a*b", "a<b", "a\nb", "a{b}"):
        phrase = S.build(GreetingFacts(slip_category="tense", slip_count=1, slip_wrong=bad, slip_right="fine"), True, "en")
        assert phrase["mistake"]["en"] == "a slip with verb tense" or "\n" not in phrase["mistake"]["en"]
    assert "mistake" not in S.build(GreetingFacts(due=3), True, "en")


def test_every_phrase_survives_substitution_and_the_final_rules():
    for language in ("zh", "en", "bilingual"):
        slots = S.build(FULL, True, language)
        keys = {"zh": ("zh",), "en": ("en",), "bilingual": ("en", "zh")}[language]
        text = {"en": "Good morning, my friend! You are on {streak}; {due}; fix {mistake} in {practice_minutes}.",
                "zh": "早上好，朋友们！你已经{streak}，{due}，花{practice_minutes}改正{mistake}。"}
        out = {k: P.fill(text[k], slots, k) for k in keys}
        assert all(out[k].count("*") <= 6 for k in keys)  # at most 3 marks per paragraph
        assert "{" not in "".join(out.values()) and "<" not in "".join(out.values())


def test_rules_block_lists_only_offered_slots_and_never_a_learner_value():
    block = S.rules_block(S.build(FULL, True, "en"), "en")
    for name in S.SLOT_NAMES:
        assert "{" + name + "}" in block
    assert "have went" not in block and "20" not in block and "7" not in block
    none = S.rules_block({}, "zh")
    assert "No placeholders are offered" in none and not any("{" + n + "}" in none for n in S.SLOT_NAMES)
    only = S.rules_block(S.build(GreetingFacts(streak=2), True, "en"), "en")
    assert "{streak}" in only and "{due}" not in only and "{mistake}" not in only
