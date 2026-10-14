"""v2 合理性检查(plan 2026-10-14-library-alignment-v2 R-V13/R-V14):按这条素材自己的语速分布判断,每句给标记,
只有相当一部分句子可疑时条目才算 low_confidence。用户那条素材:中位 20 字符/秒、p90 25.1、最快 30.3 —— 快,但不是错。"""
import math

import pytest

from app.library import quality as q
from app.library import wordseg as ws
from tests.library_words import run, tok


def sentences_at(rates_cps: list[float], chars: int = 40) -> tuple[list, list]:
    """One sentence of 5 equal words per rate (`chars` // 5 - 1 letters each), its words spread evenly so the sentence
    has exactly that articulation rate; sentences 1.5 s apart."""
    tokens, found, t = [], [], 0
    for rate in rates_cps:
        text = ("x" * (chars // 5 - 1) + " ") * 5
        words = text.split()
        span = round(len(" ".join(words)) / rate * 1000)
        step = span // len(words)
        first = len(tokens)
        for i, w in enumerate(words):
            tokens.append(tok(w, t + i * step, t + (i + 1) * step))
        found.append(ws.WordSentence(t, t + step * len(words), " ".join(words), first, len(tokens) - 1))
        t += step * len(words) + 1_500
    return tokens, found


def test_robust_z_is_zero_at_the_median_and_floors_the_mad():
    assert q.robust_z([]) == []
    assert q.robust_z([1.0, 1.0, 1.0])[0] == 0.0
    assert q.robust_z([0.0, 0.0, 1.0])[2] == pytest.approx(0.6745 / q.MAD_FLOOR)


def test_a_fast_speaker_is_not_flagged_for_being_fast():
    """The user's numbers: median 20, p90 25.1, max 30.3 chars/s; v1 flagged all 12 sentences above 25."""
    rates = [16, 17, 18, 19, 19.5, 20, 20, 20, 20.5, 21, 22, 23, 24, 25.1, 26, 27, 28, 30.3]
    tokens, found = sentences_at(rates)
    flags = q.sentence_flags(tokens, found)
    assert not any(q.FLAG_RATE in f for f in flags)
    assert q.item_low_confidence(flags) is False


def test_a_sentence_stretched_over_a_gap_is_flagged_against_the_speakers_own_median():
    rates = [20] * 12 + [3.2]  # the reported 19 characters over 13.6 s is ~1.4; 3.2 is already far off for this speaker
    tokens, found = sentences_at(rates)
    flags = q.sentence_flags(tokens, found)
    assert q.FLAG_RATE in flags[-1] and not any(flags[:-1])


def test_few_sentences_fall_back_to_absurd_bounds_only():
    tokens, found = sentences_at([20, 33, 4.0])
    assert [q.FLAG_RATE in f for f in q.sentence_flags(tokens, found)] == [False, False, True]


def test_articulation_rate_ignores_pauses():
    tokens = run(["abcd", "efgh", "ijkl"], gaps={0: 2_000})
    assert q.articulation_cps(tokens, 0, 2) == pytest.approx(14 / ((tokens[2].end_ms - tokens[0].start_ms - 2_000) / 1000))


def test_pause_estimated_seam_and_timing_flags():
    tokens = (run(["one", "two", "three", "four."], gaps={1: 1_800})
              + [tok("five", 5_000, 5_300, "est"), tok("six", 5_400, 5_700, "est"), tok("seven.", 5_800, 6_100, "est")]
              + [tok("eight", 7_000, 7_300, seam=True), tok("nine", 7_350, 7_600), tok("ten.", 7_650, 7_900)]
              + [tok("x", 9_000, 9_000), tok("y", 9_100, 9_100, "interp"), tok("zed.", 9_200, 9_500)])
    found = [ws.WordSentence(0, 0, "a", 0, 3), ws.WordSentence(0, 0, "b", 4, 6), ws.WordSentence(0, 0, "c", 7, 9),
             ws.WordSentence(0, 0, "d", 10, 12)]
    flags = q.sentence_flags(tokens, found)
    assert q.FLAG_PAUSE in flags[0] and q.FLAG_ESTIMATED in flags[1] and q.FLAG_SEAM in flags[2]
    assert q.FLAG_TIMING in flags[3]  # 2 of 3 words have no length or no time of their own


def test_word_duration_outliers_are_judged_per_item():
    tokens = run([f"word{i}" for i in range(30)], word_ms=300)
    tokens[10] = tok("word10", tokens[10].start_ms, tokens[10].start_ms + 6_000)
    assert q.suspect_tokens(tokens)[10] is True and sum(q.suspect_tokens(tokens)) == 1


def test_the_item_is_low_confidence_only_when_a_sizeable_share_is_flagged():
    assert q.item_low_confidence([()] * 9 + [("rate",)]) is False
    assert q.item_low_confidence([()] * 8 + [("rate",), ("pause",)]) is True
    assert q.item_low_confidence([]) is False


def test_flags_come_in_a_fixed_order_and_fit_the_column():
    assert len(",".join(q.FLAG_ORDER)) <= 48
    assert math.isclose(q.ITEM_FLAG_SHARE, 0.15)
