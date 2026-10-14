"""词级时间线(plan 2026-10-14-library-alignment-v2 R-V2…R-V6):词元对齐、回落、重叠接缝。"""
from app.library import asr_chunks as ac
from app.library import timeline as tl
from app.speech.timed import Utterance, Word
from tests.library_words import chunk, tok, utt


# ---- alignment of the sentence text to the recognizer's words ----

def test_every_token_takes_the_times_of_its_own_word():
    u = utt("Hello, world. How are you?", 1_000)
    assert tl.align_words(u.text.split(), u.words) == [(w.start_ms, w.end_ms) for w in u.words]


def test_split_and_joined_words_and_case_do_not_matter():
    words = [Word("well", 0, 200), Word("known", 220, 500), Word("FACT", 560, 900)]
    assert tl.align_words(["Well-known", "fact."], words) == [(0, 500), (560, 900)]


def test_tokens_the_recognizer_wrote_differently_stay_unmatched():
    words = [Word("it", 0, 100), Word("costs", 150, 500), Word("twenty", 550, 800), Word("five", 820, 1000),
             Word("dollars", 1050, 1500)]
    assert tl.align_words(["It", "costs", "$25", "now."], words)[:2] == [(0, 100), (150, 500)]
    assert tl.align_words(["It", "costs", "$25", "now."], words)[2:] == [None, None]


def test_unmatched_tokens_are_spread_between_their_known_neighbours():
    u = Utterance("It costs $25 dollars.", 0, 1500,
                  (Word("it", 0, 100), Word("costs", 150, 500), Word("twenty", 550, 800), Word("five", 820, 1000),
                   Word("dollars", 1050, 1500)))
    got = tl.utterance_tokens(u, 10_000, 40_000)
    assert [(t.text, t.kind) for t in got] == [("It", "word"), ("costs", "word"), ("$25", "interp"), ("dollars.", "word")]
    assert got[2].start_ms >= got[1].end_ms and got[2].end_ms <= got[3].start_ms
    assert (got[0].start_ms, got[-1].end_ms) == (10_000, 11_500)


def test_placeholder_words_timed_minus_one_are_never_believed():
    """A transcript written by something that kept the recognizer's -1/-1 placeholders still yields the real words only."""
    real = utt("Hello there my friend.", 1_000)
    mixed = []
    for w in real.words:
        mixed += [w, Word("x", -1, -1)]
    u = Utterance(real.text, real.start_ms, real.end_ms, tuple(mixed))
    got = tl.utterance_tokens(u, 0, 40_000)
    assert [t.kind for t in got] == ["word"] * 4
    assert [(t.start_ms, t.end_ms) for t in got] == [(w.start_ms, w.end_ms) for w in real.words]


def test_an_utterance_without_words_is_spread_over_its_own_span_like_v1():
    got = tl.utterance_tokens(Utterance("one two three", 2_000, 3_400), 0, 40_000)
    assert [t.kind for t in got] == ["interp"] * 3 and got[0].start_ms == 2_000 and got[-1].end_ms == 3_400


def test_words_that_mostly_do_not_match_are_not_believed():
    u = Utterance("alpha beta gamma delta", 0, 2000, (Word("zzz", 0, 500), Word("qqq", 600, 900)))
    assert [t.kind for t in tl.utterance_tokens(u, 0, 40_000)] == ["interp"] * 4


def test_word_times_are_clamped_into_the_audio_that_was_sent():
    u = utt("Hello there friend.", 39_500, word_ms=300)
    got = tl.utterance_tokens(u, 0, 40_000)
    assert got[-1].end_ms == 40_000 and all(t.end_ms <= 40_000 for t in got)


def test_untrusted_chunks_fall_back_to_the_speech_span_estimate():
    c = ac.Chunk(0, 10_000, "no times here at all")
    got = tl.chunk_tokens(c, [ac.Silence(0, 2_000)])
    assert {t.kind for t in got} == {"est"} and got[0].start_ms == 2_000 and got[-1].end_ms == 10_000


def test_has_words_needs_a_trusted_chunk_with_words():
    assert tl.has_words([chunk(0, 40_000, utt("Hello there my friend.", 18_000))])
    assert not tl.has_words([ac.Chunk(0, 40_000, "Hello there my friend.", [Utterance("Hello there my friend.", 0, 900)])])
    assert not tl.has_words([ac.Chunk(0, 40_000, "Hello there my friend.")])


# ---- seams between overlapping hard-cut chunks ----

LEFT_TEXT = "we walk along the river and then we stop"
RIGHT_TEXT = "and then we stop for a cup of tea today"


def seam_chunks(right_shift_ms: int = 0, right_text: str = RIGHT_TEXT):
    """A hard cut at 40 s with the 2 s overlap: the left chunk hears [0, 41 s), the right one [39 s, 80 s).
    'and then we stop' is spoken at 39.4-40.8 s and heard by both; the right side's times are jittered by
    `right_shift_ms` (two recognitions of the same audio never agree to the millisecond)."""
    left = utt(LEFT_TEXT, 37_600)  # word 5 ('and') starts at 37.6 + 5 x 0.36 = 39.4 s
    right = utt(right_text, 400 + right_shift_ms)  # relative to the right chunk's start (39 s)
    return [chunk(0, 41_000, left), chunk(39_000, 80_000, right)]


def texts(tokens):
    return " ".join(t.text for t in tokens)


def test_a_seam_keeps_every_word_once_and_is_not_flagged_when_both_sides_agree():
    chunks = seam_chunks()
    got = tl.tokens_for(chunks, [])
    assert texts(got) == "we walk along the river and then we stop for a cup of tea today"
    assert not any(t.seam for t in got)
    assert [t.start_ms for t in got] == sorted(t.start_ms for t in got)


def test_a_seam_survives_timing_jitter_between_the_two_recognitions():
    got = tl.tokens_for(seam_chunks(right_shift_ms=90), [])
    assert texts(got) == "we walk along the river and then we stop for a cup of tea today"


def test_two_recognitions_that_disagree_inside_the_overlap_are_flagged():
    got = tl.tokens_for(seam_chunks(right_text="hand den wee stomp for a cup of tea today"), [])
    assert any(t.seam for t in got)
    assert all(not t.seam for t in got if t.end_ms < 38_500 or t.start_ms > 41_500)


def test_a_side_without_word_times_is_deduplicated_by_text():
    left = chunk(0, 41_000, utt(LEFT_TEXT, 36_000))
    right = ac.Chunk(39_000, 80_000, "and then we stop for a cup of tea today")  # text-only fallback chunk
    got = tl.tokens_for([left, right], [])
    assert texts(got) == "we walk along the river and then we stop for a cup of tea today"
    assert {t.kind for t in got[9:]} == {"est"}


def test_text_overlap_needs_two_tokens():
    assert tl.text_overlap(["a", "b", "c."], ["B", "c", "d"]) == 2
    assert tl.text_overlap(["a", "b"], ["b", "x"]) == 0


def test_v1_overlaps_are_trimmed_by_text_and_lose_their_utterances():
    out = tl.trim_text_overlaps([ac.Chunk(0, 41_000, "we walk and then we stop"),
                                 ac.Chunk(39_000, 80_000, "and then we stop for tea", [])])
    assert out[1] == ac.Chunk(41_000, 80_000, "for tea", [])
    assert tl.trim_text_overlaps([ac.Chunk(0, 10, "a"), ac.Chunk(10, 20, "b")]) == [ac.Chunk(0, 10, "a"), ac.Chunk(10, 20, "b")]


def test_monotonic_never_lets_a_start_go_back():
    got = tl.monotonic([tok("a", 100, 300), tok("b", 90, 200), tok("c", 400, 350)])
    assert [(t.start_ms, t.end_ms) for t in got] == [(100, 300), (100, 200), (400, 400)]
