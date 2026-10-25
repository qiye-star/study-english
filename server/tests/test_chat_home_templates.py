"""Template greeting (plan 2026-10-23 §6.3, S5): pure functions, every situation x every language."""
import itertools
import re
from datetime import datetime, timedelta

import pytest

from app.agents.greeting import parse as P
from app.agents.greeting import templates as T
from app.agents.greeting.facts import GreetingFacts, focus_hint

NOW = datetime(2026, 10, 23, 8, 42)  # a Friday morning
LANGS = ("zh", "en", "bilingual")
LATIN = re.compile("[A-Za-zＡ-Ｚａ-ｚ]")

STREAKS = (None, 0, 1, 23)
DUES = (None, 0, 1, 12)
SLIPS = {
    "none": {},
    "pair": dict(slip_category="tense", slip_count=2, slip_wrong="have went", slip_right="have gone"),
    "category": dict(slip_category="article", slip_count=1),
    "words": dict(wrong_words=2, pron_words=1),
}


def facts(streak, due, slip):
    return GreetingFacts(streak=streak or None, due=due or None, **SLIPS[slip])


@pytest.mark.parametrize("language", LANGS)
@pytest.mark.parametrize("streak,due,slip,stats", list(itertools.product(STREAKS, DUES, SLIPS, (True, False))))
def test_every_combination_gives_exactly_three_valid_lines(language, streak, due, slip, stats):
    lines = T.template_lines(language, facts(streak, due, slip), include_stats=stats, local_now=NOW, user_id=7)
    assert len(lines) == 3 and P.check_lines(lines, language) is None
    text = " ".join(" ".join(line.values()) for line in lines)
    assert "{" not in text and "}" not in text and "0 天" not in text and "0 个" not in text and " 0 " not in text
    for line in lines:  # marks are legal as produced (R17)
        assert all(P.normalize_marks(v) == v for v in line.values())
    if language == "zh":
        assert not LATIN.search(text)
    if language == "bilingual":
        assert all(set(line) == {"en", "zh"} for line in lines)
    if not stats:
        assert not re.search(r"\d", text.replace("10 minutes", "").replace("10 分钟", "").replace("*10 分钟*", ""))
        assert "have went" not in text


def test_without_stats_the_facts_are_ignored_entirely():
    full = facts(23, 12, "pair")
    a = T.template_lines("en", full, include_stats=False, local_now=NOW, user_id=1)
    b = T.template_lines("en", GreetingFacts(), include_stats=False, local_now=NOW, user_id=1)
    assert a == b


def test_zh_never_carries_the_learner_words_but_en_and_bilingual_quote_the_pair_only():
    f = facts(5, 3, "pair")
    zh = " ".join(T.template_lines("zh", f, include_stats=True, local_now=NOW, user_id=1)[i]["zh"] for i in range(3))
    assert "have" not in zh and "时态" in zh
    en = T.template_lines("en", f, include_stats=True, local_now=NOW, user_id=1)
    assert "*have went*" in en[1]["en"] and "*have gone*" in en[1]["en"]
    bi = T.template_lines("bilingual", f, include_stats=True, local_now=NOW, user_id=1)
    assert "have went → have gone" in bi[1]["zh"]


def test_an_unsafe_slip_pair_is_dropped_instead_of_shipped():
    for wrong, right in (("a *b", "c"), ("café", "cafe"), ("你好", "hi"), ("see http://x", "y"), ("a<b", "c"), ("x" * 5 + ".", "y")):
        f = GreetingFacts(slip_category="tense", slip_count=2, slip_wrong=wrong, slip_right=right)
        lines = T.template_lines("en", f, include_stats=True, local_now=NOW, user_id=1)
        assert wrong not in lines[1]["en"] and "2 small slips" in lines[1]["en"]


def test_longest_fill_stays_inside_the_limits():
    worst = GreetingFacts(streak=9999, due=9999, slip_category="agreement", slip_count=9999,
                          slip_wrong="w" * 16, slip_right="r" * 16)
    for language in LANGS:
        for hour in (3, 8, 12, 15, 20):
            now = NOW.replace(hour=hour) + timedelta(days=hour % 7)
            lines = T.template_lines(language, worst, include_stats=True, local_now=now, user_id=99)
            assert P.check_lines(lines, language) is None
    unknown = GreetingFacts(streak=1, due=1, slip_category="mystery", slip_count=3)
    assert "语法" in T.template_lines("zh", unknown, include_stats=True, local_now=NOW, user_id=1)[1]["zh"]
    assert "grammar" in T.template_lines("en", unknown, include_stats=True, local_now=NOW, user_id=1)[2]["en"]


def test_numbers_are_capped_for_display():
    lines = T.template_lines("en", GreetingFacts(streak=123456, due=123456), include_stats=True, local_now=NOW, user_id=1)
    assert "9999-day" in lines[0]["en"] and "9999 words" in lines[1]["en"]


def test_focus_hint_priority_matches_the_plan():
    assert focus_hint(facts(5, 3, "pair")) == "fix_slip"
    assert focus_hint(facts(5, 3, "words")) == "fix_slip"
    assert focus_hint(GreetingFacts(pron_words=1)) == "fix_slip"
    assert focus_hint(facts(5, 3, "none")) == "review"
    assert focus_hint(facts(5, 0, "none")) == "free_talk"


def test_plan_paragraph_follows_the_focus_hint():
    kinds = {
        "pair": "verb tense", "category": "articles",
    }
    for slip, needle in kinds.items():
        assert needle in T.template_lines("en", facts(1, 2, slip), include_stats=True, local_now=NOW, user_id=1)[2]["en"]
    assert "tripped you up" in T.template_lines("en", facts(1, 2, "words"), include_stats=True, local_now=NOW,
                                                 user_id=1)[2]["en"]
    assert "clearing your 2 review words" in T.template_lines("en", facts(1, 2, "none"), include_stats=True,
                                                               local_now=NOW, user_id=1)[2]["en"]
    assert "talking about your plans" in T.template_lines("en", facts(1, 0, "none"), include_stats=True,
                                                           local_now=NOW, user_id=1)[2]["en"]


def test_opening_variants():
    en = lambda f, stats=True: T.template_lines("en", f, include_stats=stats, local_now=NOW, user_id=1)[0]["en"]  # noqa: E731
    assert "1-day streak" in en(GreetingFacts(streak=1))
    assert "fresh start" in en(GreetingFacts()) and "fresh start" in en(GreetingFacts(streak=0))
    assert "good to see you" in en(GreetingFacts(streak=9), stats=False)
    assert "Good morning" in en(GreetingFacts()) and "Friday morning" in en(GreetingFacts())


@pytest.mark.parametrize("hour,zh,en", [(4, "夜深了", "Still up"), (5, "早上好", "Good morning"), (10, "早上好", "Good morning"),
                                        (11, "中午好", "Good afternoon"), (13, "下午好", "Good afternoon"),
                                        (18, "晚上好", "Good evening"), (22, "晚上好", "Good evening"),
                                        (23, "夜深了", "Still up"), (0, "夜深了", "Still up")])
def test_time_of_day_boundaries_match_the_demo(hour, zh, en):
    got = T.time_of_day(hour)
    assert (got[0], got[2]) == (zh, en)


def test_weekday_names():
    assert "周五" in T.template_lines("zh", GreetingFacts(), include_stats=False, local_now=NOW, user_id=1)[0]["zh"]
    sunday = datetime(2026, 10, 25, 20, 0)
    assert "Sunday evening" in T.template_lines("en", GreetingFacts(), include_stats=False, local_now=sunday,
                                                user_id=1)[0]["en"]


def test_closing_phrase_is_stable_within_a_day_and_varies_across_days():
    f = GreetingFacts(streak=5)
    again = [T.template_lines("en", f, include_stats=True, local_now=NOW, user_id=3)[0] for _ in range(3)]
    assert again[0] == again[1] == again[2]
    seen = {T.template_lines("en", f, include_stats=True, local_now=NOW + timedelta(days=d), user_id=3)[0]["en"].split("—")[1]
            for d in range(30)}
    assert len(seen) == 3  # all three phrases show up over a month
    users = {T.template_lines("en", f, include_stats=True, local_now=NOW, user_id=u)[0]["en"].split("—")[1] for u in range(40)}
    assert len(users) > 1


def test_category_tables_cover_the_grammar_checker_categories():
    from app.services.grammar import CATEGORIES
    for category in set(CATEGORIES) - {"other"}:
        assert category in T.GRAMMAR_CATEGORY_ZH and category in T.GRAMMAR_CATEGORY_EN
    assert all(not LATIN.search(v) for v in T.GRAMMAR_CATEGORY_ZH.values())
    assert all(not LATIN.search(v) for v in T.TAILS_ZH + T.WEEKDAY_ZH)


@pytest.mark.parametrize("language", ["zh", "en", "bilingual"])
def test_template_for_a_learner_with_no_facts_claims_no_streak_amount_or_mistake(language):
    """R18: the fallback never invents data either; the only number is the suggested practice length."""
    import re
    from datetime import datetime
    from app.agents.greeting.facts import GreetingFacts
    from app.agents.greeting.templates import template_lines
    lines = template_lines(language, GreetingFacts(), include_stats=True, local_now=datetime(2026, 10, 23, 8, 42), user_id=1)
    text = " ".join(v for line in lines for v in line.values())
    assert re.sub(r"\*?10 (?:分钟|minutes)\*?", "", text).count("10") == 0
    assert not re.search(r"\d+\s*(?:天|个单词|words? due|-day streak|处)", text)
    assert "连续学了" not in text and "day streak" not in text
