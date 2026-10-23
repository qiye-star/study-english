"""Greeting output parser and lines invariants (plan 2026-10-23 §4, §6.2, R17; S5)."""
import json

import pytest

from app.agents.greeting import parse as P

# The approved demo page v2 text (user name removed), emphasis kept.
DEMO_ZH = [
    "早上好！这个周五上午，你已经连续学了 *23 天*，这份坚持真的很了不起。",
    "今天有 *12 个单词* 等你复习；昨天在现在完成时里把过去分词错用成了过去式，今天我们把它彻底说对。",
    "建议先花 *10 分钟*：用现在完成时讲三件你做过的事，再把待复习的单词过一遍，轻松收尾。",
]
DEMO_EN = [
    "Good morning! It's Friday morning, and you're on a *23-day streak* — that steady effort really adds up.",
    "You have *12 words* due for review, and yesterday's slip was *have went* — the right form is *have gone*.",
    "Today, let's spend *10 minutes* telling three short stories with *have + past participle*, then clear your review list.",
]
DEMO_SUB = [
    "早上好！周五上午，你已连续学习 23 天。",
    "12 个单词待复习；昨天的错点：have went → have gone。",
    "今天先花 10 分钟用现在完成时讲三件事，再过一遍单词。",
]


def raw(items):
    return json.dumps({"lines": items}, ensure_ascii=False)


def demo(language):
    if language == "zh":
        return [{"zh": t} for t in DEMO_ZH]
    if language == "en":
        return [{"en": t} for t in DEMO_EN]
    return [{"en": e, "zh": z} for e, z in zip(DEMO_EN, DEMO_SUB)]


@pytest.mark.parametrize("language", ["zh", "en", "bilingual"])
def test_demo_text_is_valid_and_keeps_its_marks(language):
    lines = P.parse(raw(demo(language)), language)
    assert lines == demo(language) and P.check_lines(lines, language) is None
    if language == "en":
        assert lines[1]["en"].count("*") == 6  # three marks in the second English paragraph are legal (R17)


def test_fenced_json_is_accepted():
    assert P.parse("```json\n" + raw(demo("en")) + "\n```", "en") == demo("en")


def bad(language, mutate):
    items = demo(language)
    mutate(items)
    with pytest.raises(P.GreetingInvalid) as err:
        P.parse(raw(items), language)
    return err.value.reason


def test_count_must_be_exactly_three_no_truncation_or_padding():
    for items in (demo("en")[:2], demo("en") + demo("en")[:1]):
        with pytest.raises(P.GreetingInvalid) as err:
            P.parse(raw(items), "en")
        assert err.value.reason == "count"


@pytest.mark.parametrize("text,reason", [
    ("not json", "json"), ("[]", "shape"), ('{"lines": 3}', "count"), ('{"lines": [1,2,3]}', "keys"),
    ('{"lines": [], "extra": 1}', "shape"), ("", "json"),
])
def test_envelope_errors(text, reason):
    with pytest.raises(P.GreetingInvalid) as err:
        P.parse(text, "en")
    assert err.value.reason == reason


def test_keys_must_match_the_language():
    assert bad("en", lambda i: i[0].update(zh="你好你好你好你好你好你好")) == "keys"
    assert bad("zh", lambda i: i[0].update(en="x")) == "keys"
    assert bad("bilingual", lambda i: i[1].pop("zh")) == "keys"
    assert bad("bilingual", lambda i: i[1].pop("en")) == "keys"
    assert bad("en", lambda i: i[0].update(en="")) == "keys"
    assert bad("en", lambda i: i[0].update(en=5)) == "keys"


def test_text_rules():
    assert bad("en", lambda i: i[0].update(en="Good morning, my friend! 今天也要加油，坚持练习英语哦，我们一起努力。")) == "cjk_in_en"
    assert bad("zh", lambda i: i[0].update(zh="早上好，今天的 streak 真棒，继续保持下去哦。")) == "latin_in_zh"
    assert bad("zh", lambda i: i[0].update(zh="早上好，ＡＢ今天的状态很不错，继续保持下去哦。")) == "latin_in_zh"
    assert bad("zh", lambda i: i[0].update(zh="1234567890123 → 12345678901234")) == "latin_in_zh"  # no Chinese at all
    assert bad("bilingual", lambda i: i[0].update(zh="Good!")) == "length"
    assert bad("bilingual", lambda i: i[0].update(zh="好的好的 ok ok ok ok")) == "zh_too_short"
    for forbidden in ("Visit https://x.test for more fun and practice with us.", "Great <b>job</b> today, keep practising!",
                      "Great job today and keep it up with us 😀 every day!", "See www.example.com for more things to do."):
        assert bad("en", lambda i: i[0].update(en=forbidden)) == "forbidden"


def test_zh_allows_digits_arrow_and_chinese_punctuation_and_bilingual_sub_allows_latin_words():
    ok = [{"zh": "今天有 12 个单词 → 20 个单词，加油！这是第一段问候哦。"}] * 3
    assert P.check_lines(ok, "zh") is None
    sub = demo("bilingual")
    assert "have gone" in sub[1]["zh"] and P.check_lines(sub, "bilingual") is None


def test_lengths_and_totals():
    assert bad("en", lambda i: i[0].update(en="Too short.")) == "length"
    assert bad("en", lambda i: i[0].update(en="word " * 40)) == "length"
    edge = [{"en": "a" * 29 + "."}] * 3
    assert P.check_lines(edge, "en") is None  # exactly 30 characters is the lower bound
    assert P.check_lines([{"en": "a" * 29}] * 3, "en") == "length"
    ok140 = [{"en": "b" * 140}] * 3  # 420 in total exactly: allowed
    assert P.check_lines(ok140, "en") is None
    assert P.check_lines([{"en": "b" * 141}, {"en": "b" * 140}, {"en": "b" * 140}], "en") == "total"
    assert P.check_lines([{"zh": "好" * 54}] * 3, "zh") == "total"
    assert P.check_lines([{"zh": "好" * 61}] * 3, "zh") == "length"
    stars = [{"en": "*" + "c" * 20 + "*" + "d" * 30}] * 3  # marks do not count: 50 characters
    assert P.check_lines(stars, "en") is None


def test_check_lines_zh_total_edge():
    assert P.check_lines([{"zh": "好" * 53}] * 3, "zh") is None


def test_sentence_limit():
    three = "First sentence is here. Second sentence follows it. Third sentence ends it!"
    assert bad("en", lambda i: i[2].update(en=three)) == "sentences"
    two = "First sentence is here. Second sentence follows it."
    assert P.parse(raw([{"en": two}] * 3), "en")[0]["en"] == two
    assert P.sentence_count("Pi is 3.14 for sure.") == 1 and P.sentence_count("好。好！好") == 3
    assert P.sentence_count("Well… maybe") == 2


@pytest.mark.parametrize("src,expected", [
    ("a **b** c", "a *b* c"),
    ("*a* and *b* and *c*", "*a* and *b* and *c*"),
    ("*a* *b* *c* *d*", "a b c d"),  # four marks: all removed
    ("*a* and b*", "a and b"),  # unpaired
    ("**", ""),  # empty pair
    ("** x", " x"),
    ("*" + "x" * 25 + "*", "x" * 25),  # 25 characters inside
    ("*" + "x" * 24 + "*", "*" + "x" * 24 + "*"),
    ("*a *b* c*", "a b c"),  # nested: whitespace-padded inner text is rejected
    ("*<b>*", "<b>"),
    ("plain", "plain"),
])
def test_normalize_marks(src, expected):
    assert P.normalize_marks(src) == expected


def test_a_bad_mark_strips_that_item_only_and_the_group_stays_valid():
    items = demo("en")
    items[0]["en"] = "Good morning! You are on a *23-day streak — keep going with that steady effort today."
    items[1]["en"] = "*a* *b* *c* *d* " + items[1]["en"].replace("*", "")
    lines = P.parse(raw(items), "en")
    assert "*" not in lines[0]["en"] and "*" not in lines[1]["en"]
    assert lines[2]["en"] == DEMO_EN[2]  # untouched
    assert all(line["en"].count("*") % 2 == 0 for line in lines)  # never a lone star


def test_markdown_prefixes_quotes_and_whitespace_are_cleaned():
    items = [{"en": '1.  "Good morning!   You are doing really well, keep going today."'},
             {"en": "- # Nothing is due today, so it is a calm day for relaxed speaking."},
             {"en": "* Let's talk about your plans for the day, say it your way."}]
    lines = P.parse(raw(items), "en")
    assert [x["en"][0] for x in lines] == ["G", "N", "L"]
    assert "  " not in lines[0]["en"] and not lines[0]["en"].endswith('"')


def test_message_text_strips_marks_and_joins_languages():
    line = demo("bilingual")[1]
    assert P.message_text(line) == (DEMO_EN[1].replace("*", "") + "\n\n" + DEMO_SUB[1])
    assert P.message_text({"zh": "好 *的*"}) == "好 的"


def test_unknown_language_and_non_list():
    assert P.check_lines(demo("en"), "fr") == "language"
    assert P.check_lines("x", "en") == "count"
    with pytest.raises(P.GreetingInvalid):
        P.parse(raw(demo("en")), "fr")
