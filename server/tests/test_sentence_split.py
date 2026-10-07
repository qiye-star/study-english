import json
import random
import re
from pathlib import Path

import pytest

from app.sentence_split import ABBREVIATIONS, MAX_SENTENCE_CHARS, SentenceSplitter, split_all

CASES = json.loads((Path(__file__).parent / "fixtures" / "sentence_cases.json").read_text(encoding="utf-8"))
WORDS = ["hello", "world", "Mr.", "Dr.", "v3.14", "e.g.", "coffee", "please", "\"quoted\"", "really", "you", "tomorrow"]
ENDINGS = [".", "!", "?", "?!", ".\"", "...", "…", "。"]
IDS = [f"{i}-{c['text'][:16]!r}" for i, c in enumerate(CASES)]


def normalized(text: str) -> str:
    return " ".join(text.split())


def generated(rng: random.Random) -> str:
    sentences = []
    for _ in range(rng.randint(1, 8)):
        words = [rng.choice(WORDS) for _ in range(rng.randint(1, 12))]
        sentences.append(rng.choice(["Hello", "Okay", "Yes", "Coffee"]) + " " + " ".join(words) + rng.choice(ENDINGS))
    return rng.choice([" ", "  ", "\n"]).join(sentences)


def run_chunks(text: str, chunks: list[str]) -> list[str]:
    s = SentenceSplitter()
    out: list[str] = []
    for chunk in chunks:
        out += s.feed(chunk)
    return out + s.flush()


def random_chunks(text: str, rng: random.Random, biggest: int) -> list[str]:
    chunks, i = [], 0
    while i < len(text):
        step = rng.randint(1, biggest)
        chunks.append(text[i:i + step])
        i += step
    return chunks


def test_the_fixture_is_large_and_well_formed():
    assert len(CASES) >= 50
    assert all(set(c) == {"text", "sentences"} for c in CASES)


def test_the_abbreviation_table_matches_the_web_table():
    web = Path(__file__).parents[2] / "web" / "src" / "features" / "chat" / "sentences.ts"
    block = re.search(r"new Set\(\[(.*?)\]\)", web.read_text(encoding="utf-8"), re.S).group(1)
    assert ABBREVIATIONS == frozenset(re.findall(r'"([^"]+)"', block))


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_shared_cases(case):
    assert split_all(case["text"]) == case["sentences"]


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_shared_cases_fed_one_character_at_a_time(case):
    assert run_chunks(case["text"], list(case["text"])) == case["sentences"]


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_shared_cases_split_into_two_chunks_at_every_position(case):
    text = case["text"]
    for k in range(len(text) + 1):
        assert run_chunks(text, [text[:k], text[k:]]) == case["sentences"], k


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_shared_cases_in_seeded_random_chunks(case):
    for seed in range(10):
        rng = random.Random(seed)
        assert run_chunks(case["text"], random_chunks(case["text"], rng, 7)) == case["sentences"], seed


def test_a_terminator_at_the_end_of_the_buffer_waits_for_more_text():
    s = SentenceSplitter()
    assert s.feed("Hello there.") == []
    assert s.feed(" How") == ["Hello there."]
    assert s.feed(" are you?") == []
    assert s.flush() == ["How are you?"]
    assert s.flush() == []


def test_a_cjk_terminator_waits_for_trailing_closers():
    s = SentenceSplitter()
    assert s.feed("他说“好。") == []
    assert s.feed("”然后") == ["他说“好。”"]
    assert s.flush() == ["然后"]


def test_an_ellipsis_split_across_chunks_does_not_break():
    s = SentenceSplitter()
    assert s.feed("Wait..") == []
    assert s.feed(". what? Yes") == ["Wait... what?"]
    assert s.flush() == ["Yes"]


def test_a_sentence_emitted_early_is_never_retracted():
    s = SentenceSplitter()
    assert s.feed("Hello there. How") == ["Hello there."]
    assert s.feed(" are you? I am fine.") == ["How are you?"]
    assert s.flush() == ["I am fine."]


def test_long_sentences_are_cut_at_a_comma_or_space():
    text = ", ".join(["word number"] * 40) + "."
    pieces = split_all(text)
    assert all(len(p) <= MAX_SENTENCE_CHARS for p in pieces)
    assert pieces[0].endswith(",")
    assert normalized(" ".join(pieces)) == normalized(text)
    assert split_all("x" * 450) == ["x" * 200, "x" * 200, "x" * 50]


def test_the_limit_is_configurable():
    assert SentenceSplitter(max_chars=10).feed("abcdefghijklmnop") == ["abcdefghij"]


@pytest.mark.parametrize("seed", range(200))
def test_properties_hold_for_random_texts_and_random_chunking(seed):
    rng = random.Random(seed)
    text = generated(rng)
    whole = split_all(text)
    # 1) 与分块方式无关
    assert run_chunks(text, random_chunks(text, rng, 15)) == whole
    # 2) 无空片段、不超长、不丢字
    assert all(p and p == p.strip() and len(p) <= MAX_SENTENCE_CHARS for p in whole)
    assert normalized(" ".join(whole)) == normalized(text)
    # 3) 从不在省略号中间断开:断点之后的片段不会以 "." 开头
    assert not any(p.startswith(".") for p in whole[1:])


@pytest.mark.parametrize("seed", range(100))
def test_long_unpunctuated_texts_are_chunking_independent(seed):
    rng = random.Random(1000 + seed)
    text = " ".join(rng.choice(["alpha", "be,", "see;", "d:", "eeeee", "x" * rng.randint(1, 30)]) for _ in range(rng.randint(40, 120)))
    whole = split_all(text)
    assert run_chunks(text, random_chunks(text, rng, 40)) == whole
    assert run_chunks(text, list(text)) == whole
    assert all(len(p) <= MAX_SENTENCE_CHARS for p in whole)


# Review 1.4-M1: lengths are Unicode code points (an emoji counts as 1, never split in half).
# Server-only for now: the web splitter still counts UTF-16 units, so these cases are NOT in the
# shared fixture until web/src/features/chat/sentence-stream.ts is aligned (then move them there).
EMOJI = "\U0001F600"
CODE_POINT_CASES = [
    ("x" * 199 + EMOJI + "x" * 10, ["x" * 199 + EMOJI, "x" * 10]),
    ("a" * 197 + EMOJI * 2 + ". Next one.", ["a" * 197 + EMOJI * 2 + ".", "Next one."]),
    (EMOJI * 150 + " " + "ok " * 30, [EMOJI * 150 + " ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok", "ok " * 13 + "ok"]),
]


@pytest.mark.parametrize("text,sentences", CODE_POINT_CASES, ids=["forced-cut", "terminator-at-limit", "emoji-run"])
def test_lengths_count_code_points_not_utf16_units(text, sentences):
    assert split_all(text) == sentences
    assert run_chunks(text, list(text)) == sentences
    for s in sentences:
        assert len(s) <= MAX_SENTENCE_CHARS
        s.encode("utf-8")  # no lone surrogate
