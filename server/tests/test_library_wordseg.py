"""词元 → 句子(plan 2026-10-14-library-alignment-v2 R-V10/R-V11):句子从首词起、到末词止,长停顿断开,短句不跨长间隔合并,
边界余量只占间隔的一部分、从不重叠。"""
import pytest

from app.library import wordseg as ws
from tests.library_words import run, tok


def spans(found):
    return [(s.start_ms, s.end_ms, s.text) for s in found]


def test_sentences_start_at_their_first_word_and_end_at_their_last_word_plus_a_small_pad():
    tokens = run("Hello there my friend. How are you today?".split(), start_ms=27_360, gaps={3: 900})
    got = ws.sentences(tokens, 60_000)
    assert [s.text for s in got] == ["Hello there my friend.", "How are you today?"]
    assert got[0].start_ms == 27_360 - 40  # the 40 ms lead: the media start is far away
    assert got[0].end_ms == tokens[3].end_ms + 80
    assert got[1].start_ms == tokens[4].start_ms - 40 and got[1].end_ms == tokens[-1].end_ms + 80


def test_pads_never_take_more_than_forty_percent_of_a_gap_so_sentences_never_touch_words_of_others():
    tokens = run("One two three. Four five six.".split(), gaps={2: 100})
    got = ws.sentences(tokens, 10_000)
    assert got[0].end_ms == tokens[2].end_ms + 40 and got[1].start_ms == tokens[3].start_ms - 40
    assert got[0].end_ms <= got[1].start_ms


def test_a_long_pause_inside_a_sentence_splits_it():
    tokens = run("So we went to the market and then we bought some apples.".split(), gaps={5: 2_400})
    got = ws.sentences(tokens, 30_000)
    assert [s.text for s in got] == ["So we went to the market", "and then we bought some apples."]
    assert got[0].end_ms < tokens[6].start_ms and got[1].start_ms > tokens[5].end_ms


def test_a_shorter_pause_splits_only_after_a_comma():
    plain = run("So we went to the market and then we bought some apples.".split(), gaps={5: 1_200})
    assert len(ws.sentences(plain, 30_000)) == 1
    comma = run("So we went to the market, and then we bought some apples.".split(), gaps={5: 1_200})
    assert [s.text for s in ws.sentences(comma, 30_000)] == ["So we went to the market,", "and then we bought some apples."]


def test_a_pause_never_leaves_a_single_word_behind():
    tokens = run("Well, we went to the market today.".split(), gaps={0: 2_500})
    assert len(ws.sentences(tokens, 30_000)) == 1


def test_a_short_sentence_is_not_merged_across_music():
    """The suspected cause of the reported 13.6 s / 19 character sentence: 'Okay.' merged over a long gap."""
    tokens = run(["Okay."], start_ms=382_300) + run("Let us go to the beach now.".split(), start_ms=394_000)
    got = ws.sentences(tokens, 400_000)
    assert [s.text for s in got] == ["Okay.", "Let us go to the beach now."]
    assert got[0].end_ms - got[0].start_ms < 1_000


def test_a_short_sentence_joins_the_closer_neighbour_when_the_gap_is_small():
    tokens = run("I see. Yes. That is right.".split(), gaps={1: 900, 2: 200})
    assert [s.text for s in ws.sentences(tokens, 30_000)] == ["I see.", "Yes. That is right."]


def test_an_overlong_sentence_is_cut_at_its_largest_gap():
    words = [f"w{i}" for i in range(50)]
    tokens = run(words, gaps={20: 500, 30: 450})
    got = ws.sentences(tokens, 60_000)
    assert [len(s.text.split()) for s in got] == [21, 29]


def test_an_overlong_sentence_prefers_a_comma_when_gaps_are_equal():
    words = [f"w{i}" for i in range(50)]
    words[34] = "w34,"
    got = ws.sentences(run(words), 60_000)
    assert got[0].text.endswith("w34,")


def test_the_text_comes_from_the_shared_splitter_and_tokens_without_letters_stay_with_the_previous_sentence():
    tokens = run(["Hello", "there.", "42!", "Yes."], gaps={2: 900})  # the splitter drops the letterless "42!"
    assert [s.text for s in ws.sentences(tokens, 30_000)] == ["Hello there. 42!", "Yes."]
    assert [s.text for s in ws.sentences(run(["Mr.", "Smith", "came", "in."]), 30_000)] == ["Mr. Smith came in."]


def test_a_sentence_has_at_least_200_ms_but_never_runs_into_the_next_word():
    tokens = [tok("Hi.", 1_000, 1_000, "interp"), tok("Okay", 1_100, 1_400), tok("then", 1_450, 1_700),
              tok("we", 1_750, 1_900), tok("go.", 1_950, 2_300)]
    got = ws.sentences(tokens, 10_000)
    assert got[0].end_ms > got[0].start_ms


def test_the_last_sentence_never_ends_after_the_media():
    tokens = run("The very last words.".split(), start_ms=9_000, word_ms=200)
    got = ws.sentences(tokens, tokens[-1].end_ms + 10)
    assert got[-1].end_ms == tokens[-1].end_ms + 4


@pytest.mark.parametrize("text_pieces, expected", [
    (["Hello", "there."], [(0, 1)]),
    (["Hi.", "Bye."], [(0, 0), (1, 1)]),
    ([], []),
])
def test_text_pieces(text_pieces, expected):
    got = ws.text_pieces(run(text_pieces)) if text_pieces else ws.text_pieces([])
    assert [(p.first, p.last) for p in got] == expected
