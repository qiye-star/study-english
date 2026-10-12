"""回复语言纯模块(计划 addressing-server L1;spec 2026-10-12-agents-addressing §5)。"""
import random

import pytest

from app.agents import lang
from app.agents.tutor.parse import StreamFilter, parse_meta


def stream(filters, chunks):
    chain = lang.Chain(*filters)
    return "".join(chain.feed(c) for c in chunks) + chain.flush()


def test_want_note_follows_the_setting_and_the_level():
    assert lang.ZH_SETTINGS == ("auto", "always", "never")
    assert [lang.want_note("auto", lv) for lv in ("A1", "A2", "B1", "B2", "C1")] == [True, True, True, False, False]
    assert lang.want_note("always", "C1") is True and lang.want_note("never", "A2") is False
    assert lang.want_note("bogus", "A2") is True  # an unknown value behaves like auto


def test_chat_rule_offers_the_zh_line_only_when_wanted():
    assert "<<ZH>>" in lang.chat_rule(True) and "English only" in lang.chat_rule(True)
    assert "<<ZH>>" not in lang.chat_rule(False) and "Do not write any Chinese" in lang.chat_rule(False)


@pytest.mark.parametrize("sentence,expected", [
    ("Hello there. ", False),
    ("Hi 李华, nice to meet you.", False),  # a short name stays
    ("We use 苹果 here. ", False),
    ("你的发音很好。", True),  # fullwidth sentence punctuation
    ("中文:很好\n", True),  # mostly Chinese letters
    ("Great, 王小明和李华都来了", True),  # a run longer than four
    ("Hi 王小明", True),  # three of five letters are Chinese
    ("こんにちは everyone", True),  # kana count as Chinese letters
    ("Wait… really?", False),
])
def test_is_chinese(sentence, expected):
    assert lang.is_chinese(sentence) is expected


def test_sanitize_drops_chinese_sentences_from_their_first_chinese_character():
    assert lang.sanitize("Good job! 你的发音很好。Keep going.") == ("Good job! Keep going.", ["你的发音很好。"])
    assert lang.sanitize("Great!\n中文：很好\nTry again.") == ("Great!\nTry again.", ["中文：很好"])
    assert lang.sanitize("Chinese: 这个词的意思是放弃。") == ("Chinese: ", ["这个词的意思是放弃。"])
    assert lang.sanitize("Hi 李华, nice to meet you.") == ("Hi 李华, nice to meet you.", [])
    assert lang.sanitize("") == ("", [])


def test_split_marker_and_filter_hide_the_zh_line():
    assert lang.split_marker("Abandon means to leave.\n<<ZH>> 意思是放弃") == ("Abandon means to leave.", " 意思是放弃")
    assert lang.split_marker("No marker here ") == ("No marker here ", "")
    f = lang.MarkerFilter()
    out = "".join(f.feed(c) for c in ["Abandon means ", "to leave.\n<<Z", "H>> 意思", "是放弃"]) + f.flush()
    assert out == "Abandon means to leave." and f.tail == " 意思是放弃"
    g = lang.MarkerFilter()
    assert g.feed("a < b") + g.flush() == "a < b" and g.tail == ""  # a lone bracket is just text
    h = lang.MarkerFilter()
    assert h.feed("Ok «zh» 好") == "Ok" and h.tail == " 好"  # bracket variants and case, like <<META>>


def test_chain_with_the_tutor_meta_filter_keeps_note_and_meta_apart():
    raw = 'Nice!\n<<ZH>> 不错\n<<META>>{"verdict":"good"}'
    zh, gate = lang.MarkerFilter(), lang.SentenceGate()
    out = stream([StreamFilter(), zh, gate], list(raw))
    assert out == "Nice!" and lang.clean_note(zh.tail) == "不错" and gate.removed == []


def test_clean_and_resolve_note():
    assert lang.clean_note("  很好\n<b>  ") == "很好 ‹b›"
    assert lang.clean_note("很" * 100) == "很" * 80
    assert lang.clean_note(" ") is None and lang.clean_note(3) is None
    assert lang.resolve_note("auto", "模式", "标记", ["兜底"]) == "模式"
    assert lang.resolve_note("auto", "", " 标记 ", ["兜底"]) == "标记"
    assert lang.resolve_note("always", None, "", ["你好。", "再见。"]) == "你好。 再见。"
    assert lang.resolve_note("never", "模式", "标记", ["兜底"]) is None
    assert lang.resolve_note("auto", None, "", []) is None


POOL = ["Hello there. ", "Nice try! ", "Say it again?\n", "李华 is here. ", "你的发音很好。", "中文：很好\n",
        "We use 苹果 here. ", "<<ZH>> 意思是放弃", "<< zh >>补充", "«ZH» 说明", "3.5 is a number ", "Wait… ", "\n",
        "  ", "a < b ", "Hi 王小明", "!", "。"]


def _chunks(rng, text):
    if len(text) < 2:
        return [text]
    cuts = sorted(rng.sample(range(1, len(text)), k=min(len(text) - 1, rng.randint(0, 6))))
    return [text[i:j] for i, j in zip([0, *cuts], [*cuts, len(text)])]


def test_fuzz_any_split_equals_the_one_shot_result():
    rng = random.Random(20261012)
    for _ in range(3000):
        text = "".join(rng.choice(POOL) for _ in range(rng.randint(1, 8)))
        visible, tail = lang.split_marker(text)
        expected, removed = lang.sanitize(visible)
        zh, gate = lang.MarkerFilter(), lang.SentenceGate()
        assert stream([zh, gate], _chunks(rng, text)) == expected, text
        assert zh.tail == tail and gate.removed == removed, text


def test_fuzz_with_the_meta_filter_first():
    rng = random.Random(7)
    for _ in range(1000):
        text = "".join(rng.choice(POOL) for _ in range(rng.randint(1, 6))) + '\n<<META>>{"verdict":"ok"}'
        visible, tail = lang.split_marker(parse_meta(text)[0])
        expected, removed = lang.sanitize(visible)
        zh, gate = lang.MarkerFilter(), lang.SentenceGate()
        assert stream([StreamFilter(), zh, gate], _chunks(rng, text)) == expected, text
        assert zh.tail == tail and gate.removed == removed, text


def test_english_streams_through_without_waiting_for_the_sentence_end():
    gate = lang.SentenceGate()
    assert gate.feed("Hello") == "Hello" and gate.feed(" there") == " there"  # no added first-token delay
    assert gate.feed(" 你好。") == " " and gate.flush() == ""  # held from the first Chinese character, then dropped
    assert gate.removed == ["你好。"]


EXHAUSTIVE = [
    "Abandon means to leave.\n<<ZH>> 意思是放弃",
    "Good job! 你的发音很好。Keep going.\n<<ZH>>很好",
    "Ok «zh» 好 and << ZH >>> more",
    "A < B << C <<Z and <<ZH> x",
    'Nice!\n<<ZH>> 不错\n<<META>>{"verdict":"good"}',
    'Nice <<META>>{"verdict":"good"} <<ZH>> late',
    "Chinese: 这个词的意思是放弃。 Next.",
]


def _one_shot(text):
    visible, tail = lang.split_marker(parse_meta(text)[0])
    shown, removed = lang.sanitize(visible)
    return shown, tail, removed


def test_every_split_position_equals_the_one_shot_result():
    for text in EXHAUSTIVE:
        expected = _one_shot(text)
        cuts = range(len(text) + 1)
        splits = [[text[:i], text[i:]] for i in cuts]
        splits += [[text[:i], text[i:j], text[j:]] for i in cuts for j in range(i, len(text) + 1)]
        splits.append(list(text))  # one character at a time
        for chunks in splits:
            zh, gate = lang.MarkerFilter(), lang.SentenceGate()
            out = stream([StreamFilter(), zh, gate], chunks)
            assert (out, zh.tail, gate.removed) == expected, (text, chunks)


def test_a_closing_bracket_split_from_the_marker_stays_out_of_the_note():
    f = lang.MarkerFilter()
    assert f.feed("Hi <<ZH>") == "Hi" and f.feed(">") == "" and f.feed("> 好") == "" and f.tail == " 好"
