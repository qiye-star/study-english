"""分句器(spec §6.3「分句」)。前三组用共享夹具 sentence_cases.json 的全部用例(D3,夹具与切句器都不改)。"""
import json
import random
from pathlib import Path

import pytest

from app.library.segment import Fragment, Sentence, align, build, finish

CASES = json.loads((Path(__file__).parent / "fixtures" / "sentence_cases.json").read_text(encoding="utf-8"))
IDS = [f"case{i}" for i in range(len(CASES))]


def test_the_shared_fixture_has_64_cases():
    assert len(CASES) == 64


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_a_whole_text_in_one_fragment_gives_the_fixture_sentences(case):
    aligned = align([Fragment(0, 10_000, case["text"])])
    assert [aligned.text(s) for s in aligned.spans] == case["sentences"]


def _split_points(text: str) -> list[int]:
    """Single spaces between two non-space characters: splitting there and re-joining with one space is exact."""
    return [i for i in range(1, len(text) - 1)
            if text[i] == " " and not text[i - 1].isspace() and not text[i + 1].isspace()]


def _fragments(text: str, rng: random.Random) -> list[Fragment]:
    points = _split_points(text)
    k = min(len(points), rng.randint(1, 5))
    cuts = sorted(rng.sample(points, k))
    pieces, last = [], 0
    for c in cuts:
        pieces.append(text[last:c])
        last = c + 1
    pieces.append(text[last:])
    frags, t = [], 0
    for piece in pieces:
        dur = 300 + 40 * len(piece)
        frags.append(Fragment(t, t + dur, piece))
        t += dur + rng.choice([0, 150, 500])
    return frags


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_b_the_same_text_cut_into_2_to_6_fragments_gives_the_same_sentences(case):
    rng = random.Random(20261013 + CASES.index(case))
    frags = _fragments(case["text"], rng)
    aligned = align(frags)
    assert aligned.joined == (case["text"] if case["text"].strip() else "")
    assert [aligned.text(s) for s in aligned.spans] == case["sentences"]


@pytest.mark.parametrize("case", CASES, ids=IDS)
def test_c_sentence_times_stay_inside_the_fragments_they_cover(case):
    rng = random.Random(7 + CASES.index(case))
    aligned = align(_fragments(case["text"], rng))
    for span in aligned.spans:
        first = aligned.piece_at(span.char_start)[2]
        last = aligned.piece_at(span.char_end - 1)[2]
        assert first.start_ms <= span.start_ms <= span.end_ms <= last.end_ms


def test_interpolation_inside_one_cue():
    aligned = align([Fragment(1000, 3000, "First one here. Second one here.")])
    first, second = aligned.spans
    assert (first.start_ms, second.end_ms) == (1000, 3000)
    assert first.end_ms <= second.start_ms
    assert 1900 <= first.end_ms <= 2000  # 15 of 32 characters


def test_blank_fragments_are_ignored_and_nothing_gives_nothing():
    assert align([]).spans == [] and finish(align([Fragment(0, 1, "  ")])) == []
    aligned = align([Fragment(0, 1000, "Hi there you."), Fragment(1000, 2000, "   "), Fragment(2000, 3000, "Yes it is.")])
    assert aligned.joined == "Hi there you. Yes it is."


def test_long_sentences_split_at_the_widest_cue_gap_first():
    frags = [Fragment(0, 5000, "one two three four five"), Fragment(5100, 10_000, "six seven eight nine ten"),
             Fragment(10_600, 16_000, "eleven twelve thirteen fourteen fifteen")]
    out = build(frags)
    assert [s.text for s in out] == ["one two three four five six seven eight nine ten",
                                     "eleven twelve thirteen fourteen fifteen"]
    assert out[0] == Sentence(0, 10_000, out[0].text) and out[1].start_ms == 10_600


def test_long_sentences_without_cues_split_at_word_boundaries():
    words = " ".join(f"w{i}" for i in range(90))  # 90 words, no punctuation: one 200-char cut by split_all at most
    out = build([Fragment(0, 60_000, words)])
    assert all(len(s.text.split()) <= 40 and s.end_ms - s.start_ms <= 14_000 for s in out)
    assert " ".join(s.text for s in out) == words
    assert all(a.end_ms <= b.start_ms for a, b in zip(out, out[1:]))


def test_short_sentences_merge_backwards_then_forwards():
    frags = [Fragment(0, 3000, "This is the first sentence."), Fragment(3000, 3400, "Yes."),
             Fragment(3500, 3900, "Ok."), Fragment(4000, 7000, "And here is the last one.")]
    assert [s.text for s in build(frags)] == ["This is the first sentence. Yes. Ok.", "And here is the last one."]
    first = build([Fragment(0, 400, "Right."), Fragment(500, 4000, "Then we start the lesson.")])
    assert [s.text for s in first] == ["Right. Then we start the lesson."]
    assert first[0].start_ms == 0 and first[0].end_ms == 4000


def test_a_short_sentence_stays_when_both_merges_would_be_too_long():
    long_a = " ".join(["go"] * 40) + "."  # 40 words (the cap), 120 characters (split_all cuts at 200)
    long_b = " ".join(["no"] * 40) + "."
    out = build([Fragment(0, 13_000, long_a), Fragment(13_000, 13_500, "Hm."), Fragment(13_500, 26_000, long_b)])
    assert [s.text for s in out] == [long_a, "Hm.", long_b]


def test_overlapping_cues_never_give_overlapping_sentences():
    out = build([Fragment(0, 4000, "We start here today."), Fragment(3000, 8000, "Then we go on and on.")])
    assert all(a.end_ms <= b.start_ms for a, b in zip(out, out[1:]))
    assert all(s.start_ms <= s.end_ms for s in out)


def test_every_sentence_fits_the_text_cap():
    text = ". ".join(["word " * 30] * 10)
    assert all(len(s.text) <= 600 for s in build([Fragment(0, 600_000, text)]))


def test_adjust_hook_runs_between_align_and_finish():
    seen = []
    build([Fragment(0, 2000, "Hello there friend.")], adjust=lambda a: seen.append(len(a.spans)))
    assert seen == [1]
