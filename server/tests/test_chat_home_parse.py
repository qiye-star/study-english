"""Greeting output parser and lines invariants (plan 2026-10-23 §4, §6.2, R17; S5)."""
import json

import pytest

from app.agents.greeting import parse as P, slots as slots_mod
from app.agents.greeting.facts import GreetingFacts

# The approved demo page v2 text (user name removed) as the MODEL writes it after R18: placeholders instead of facts.
FACTS = GreetingFacts(streak=23, due=12, slip_category="tense", slip_count=2, slip_wrong="have went", slip_right="have gone")
MODEL_ZH = [
    "早上好！这个周五上午，你已经{streak}，这份坚持真的很了不起。",
    "今天{due}；昨天出现了{mistake}，今天我们把它彻底说对。",
    "建议先花{practice_minutes}：用现在完成时讲几件你做过的事，再把待复习的单词过一遍，轻松收尾。",
]
MODEL_EN = [
    "Good morning! It's Friday morning, and you're on {streak} — that steady effort really adds up.",
    "You have {due}, and yesterday's slip was {mistake} — a quick {practice_minutes} will fix it.",
    "Today, let's spend {practice_minutes} telling a few short stories with the present perfect, then clear your list.",
]
MODEL_SUB = [
    "早上好！周五上午，你已{streak}。",
    "{due}；昨天的错点：{mistake}。",
    "今天先花{practice_minutes}用现在完成时讲几件事，再过一遍单词。",
]
# what the learner sees after substitution
DEMO_ZH = [
    "早上好！这个周五上午，你已经*连续学习第 23 天*，这份坚持真的很了不起。",
    "今天*有 12 个单词待复习*；昨天出现了*时态上的小错*，今天我们把它彻底说对。",
    "建议先花*10 分钟*：用现在完成时讲几件你做过的事，再把待复习的单词过一遍，轻松收尾。",
]
DEMO_EN = [
    "Good morning! It's Friday morning, and you're on *a 23-day streak* — that steady effort really adds up.",
    "You have *12 words to review*, and yesterday's slip was *have went → have gone* — a quick *10 minutes* will fix it.",
    "Today, let's spend *10 minutes* telling a few short stories with the present perfect, then clear your list.",
]
DEMO_SUB = [
    "早上好！周五上午，你已*连续学习第 23 天*。",
    "*有 12 个单词待复习*；昨天的错点：*have went → have gone*。",
    "今天先花*10 分钟*用现在完成时讲几件事，再过一遍单词。",
]


# what the model writes for a learner with no facts: no placeholder, no number
WELCOME_EN = [
    "Hi there, welcome! This is your daily English practice chat, a friendly little ritual for every day.",
    "There is nothing to review yet, and that is perfectly fine — we simply get to start fresh together.",
    "Today, tell me anything about your day in English, say it your way, and I'll help you polish it.",
]
WELCOME_ZH = [
    "你好，欢迎来到每日英语练习聊天，这里是你每天都可以来的轻松小角落。",
    "现在还没有需要复习的内容，没关系，我们正好从头开始。",
    "今天就用英语随便聊聊你的一天吧，说错了也没关系，我来帮你说得更地道。",
]
WELCOME_SUB = ["你好，欢迎来到每日英语练习聊天。", "现在还没有要复习的内容，我们从头开始。", "今天用英语聊聊你的一天，我来帮你润色。"]


def welcome(language):
    if language == "zh":
        return [{"zh": t} for t in WELCOME_ZH]
    if language == "en":
        return [{"en": t} for t in WELCOME_EN]
    return [{"en": e, "zh": z} for e, z in zip(WELCOME_EN, WELCOME_SUB)]


def slots(language):
    return slots_mod.build(FACTS, True, language)


def raw(items):
    return json.dumps({"lines": items}, ensure_ascii=False)


def model(language):
    if language == "zh":
        return [{"zh": t} for t in MODEL_ZH]
    if language == "en":
        return [{"en": t} for t in MODEL_EN]
    return [{"en": e, "zh": z} for e, z in zip(MODEL_EN, MODEL_SUB)]


def demo(language):
    if language == "zh":
        return [{"zh": t} for t in DEMO_ZH]
    if language == "en":
        return [{"en": t} for t in DEMO_EN]
    return [{"en": e, "zh": z} for e, z in zip(DEMO_EN, DEMO_SUB)]


@pytest.mark.parametrize("language", ["zh", "en", "bilingual"])
def test_demo_text_is_valid_and_code_adds_the_marks(language):
    lines = P.parse(raw(model(language)), language, slots(language))
    assert lines == demo(language) and P.check_lines(lines, language) is None
    if language == "en":
        assert lines[1]["en"].count("*") == 6  # three phrases carry the marks, the R17 limit


def test_fenced_json_is_accepted():
    assert P.parse("```json\n" + raw(model("en")) + "\n```", "en", slots("en")) == demo("en")


def bad(language, mutate, offered=True):
    items = model(language)
    mutate(items)
    with pytest.raises(P.GreetingInvalid) as err:
        P.parse(raw(items), language, slots(language) if offered else None)
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
    assert bad("zh", lambda i: i[0].update(zh="Good morning my dear friend")) == "latin_in_zh"  # no Chinese at all
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
    assert bad("en", lambda i: i[0].update(en="word " * 45)) == "length"
    edge = [{"en": "a" * 29 + "."}] * 3
    assert P.check_lines(edge, "en") is None  # exactly 30 characters is the lower bound
    assert P.check_lines([{"en": "a" * 29}] * 3, "en") == "length"
    ok180 = [{"en": "b" * 180}] * 3  # 540 in total exactly: allowed
    assert P.check_lines(ok180, "en") is None
    assert P.check_lines([{"en": "b" * 181}, {"en": "b" * 180}, {"en": "b" * 180}], "en") == "total"
    assert P.check_lines([{"en": "b" * 201}] * 3, "en") == "length"  # a real model answer of 190 characters is fine now
    assert P.check_lines([{"en": "b" * 190}, {"en": "b" * 175}, {"en": "b" * 170}], "en") is None
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


def test_the_models_own_asterisks_are_dropped_and_code_marks_at_most_three_phrases():
    items = model("en")
    items[0]["en"] = "Good **morning**! You are on *{streak}* — keep going with that steady effort today, {due} {mistake} {practice_minutes}."
    lines = P.parse(raw(items), "en", slots("en"))
    assert "morning" in lines[0]["en"] and "*morning*" not in lines[0]["en"]
    assert lines[0]["en"].count("*") == 6  # four phrases offered, the fourth stays plain (R17: at most 3 marks)
    assert lines[0]["en"].endswith("10 minutes.") and lines[2]["en"] == DEMO_EN[2]
    assert all(line["en"].count("*") % 2 == 0 for line in lines)  # never a lone star


def test_a_long_phrase_stays_plain_and_marks_are_sanitised():
    phrases = {"mistake": {"en": "x" * 30 + " <b>*\n{streak}", "zh": "好"}}
    out = P.fill("Yesterday: {mistake}.", phrases, "en")
    assert out == "Yesterday: " + "x" * 30 + " b streak."  # over 24 characters: no marks; * < > braces and newlines gone
    short = P.fill("Yesterday: {mistake}.", {"mistake": {"en": "a*b<c>\nd", "zh": ""}}, "en")
    assert short == "Yesterday: *abc d*."
    with pytest.raises(P.GreetingInvalid):
        P.fill("{mistake}", {"mistake": {"en": "*<>", "zh": ""}}, "en")


@pytest.mark.parametrize("text", [
    "You are on day 7 of practice today, keep going.", "You are on day ７ of practice today, keep going.",
    "Twenty words are due today, so let's begin together.", "You have thirty-one words waiting for you today.",
    "你已经连续学习七天了，今天继续保持下去哦。", "今天有二十个单词待复习，我们一起来加油吧。", "今天有 ２０ 个单词待复习，我们一起来加油吧。",
    "今天有几十个单词待复习，我们一起来加油吧，百分之百。", "今天复习两个单词，然后轻松收尾吧，加油哦朋友。",
    "第一天开始，我们慢慢来，加油哦朋友，别着急哦。", "Nothing is due today, 3 slips yesterday, so let's start.",
])
def test_numbers_outside_placeholders_are_rejected_in_every_language(text):
    key = "zh" if any("\u4e00" <= ch <= "\u9fff" for ch in text) else "en"
    for offered in (True, False):
        items = [{key: text}] * 3
        with pytest.raises(P.GreetingInvalid) as err:
            P.parse(raw(items), key, slots(key) if offered else None)
        assert err.value.reason == "number"
    bilingual = [{"en": "Good morning, a warm hello to you today, friend!", "zh": text if key == "zh" else "早上好，今天也一起练习英语吧，加油。"}] * 3
    if key == "zh":
        with pytest.raises(P.GreetingInvalid) as err:
            P.parse(raw(bilingual), "bilingual", slots("bilingual"))
        assert err.value.reason == "number"


def test_everyday_chinese_words_with_a_numeral_character_are_fine():
    text = "早上好，我们一起轻松练一会儿，一点一滴都在积累，今天是新的一天，十分期待你的表现。"
    assert P.model_text_error(text, {}) is None
    # seen in real model answers: 一 inside everyday words, reduplication and "一周" must not cost the whole greeting
    for ok in ("忙了一周还能坐下来练几句，这份坚持真的很棒。", "自己改一遍，再说给我听。", "练一练，理一理，说一说，看一看。",
               "先找出那几道错题，再说一遍正确的句子。", "今天周五，周末快到了，一定要放松一下。"):
        assert P.model_text_error(ok, {}) is None, ok
    for claim in ("你已经练习了一天。", "这是你的第一次。", "已经坚持一个月了。", "今天复习一个单词。", "只用一分钟就够了。", "昨天有一处小错。"):
        assert P.model_text_error(claim, {}) == "number", claim
    assert P.model_text_error("今天有几个词，多少都没关系，一直保持下去。", {}) is None
    assert P.model_text_error("Let's make this one small step together today.", {}) is None


def test_placeholders_unknown_unoffered_or_unbalanced_are_invalid():
    cases = {"Hello there {nothing} and a warm welcome to our daily practice chat.": "slot",
             "Hello there {streak and a warm welcome to our daily practice chat.": "braces",
             "Hello there streak} and a warm welcome to our daily practice chat.": "braces",
             "Hello there {{streak}} and a warm welcome to our daily practice chat.": "braces",
             "Hello there {Streak} and a warm welcome to our daily practice chat.": "slot",
             "Hello there {} and a warm welcome to our daily practice chat.": "braces"}
    for text, reason in cases.items():
        with pytest.raises(P.GreetingInvalid) as err:
            P.parse(raw([{"en": text}] * 3), "en", slots("en"))
        assert err.value.reason == reason, text
    offered_only_streak = {"streak": slots("en")["streak"]}
    with pytest.raises(P.GreetingInvalid) as err:  # a real slot, but not offered to this learner
        P.parse(raw([{"en": "Good morning, you have {due} waiting for you today, friend."}] * 3), "en", offered_only_streak)
    assert err.value.reason == "slot"
    with pytest.raises(P.GreetingInvalid):  # nothing offered: even a known name is refused
        P.parse(raw([{"en": "Good morning, you are on {streak} today, my dear friend."}] * 3), "en")


def test_markdown_prefixes_quotes_and_whitespace_are_cleaned():
    items = [{"en": '1.  "Good morning!   You are doing really well, keep going today."'},
             {"en": "- # Nothing is due today, so it is a calm day for relaxed speaking."},
             {"en": "* Let's talk about your plans for the day, say it your way."}]
    lines = P.parse(raw(items), "en")
    assert [x["en"][0] for x in lines] == ["G", "N", "L"]
    assert "  " not in lines[0]["en"] and not lines[0]["en"].endswith('"')


def test_message_text_strips_marks_and_joins_languages():
    line = demo("bilingual")[1]
    assert P.message_text(line) == (DEMO_EN[1] + "\n\n" + DEMO_SUB[1]).replace("*", "").replace("\n\n", "\n\n", 1)
    assert P.message_text({"zh": "好 *的*"}) == "好 的"


def test_unknown_language_and_non_list():
    assert P.check_lines(demo("en"), "fr") == "language"
    assert P.check_lines("x", "en") == "count"
    with pytest.raises(P.GreetingInvalid):
        P.parse(raw(demo("en")), "fr")
