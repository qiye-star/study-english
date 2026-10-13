"""合理性检查(spec §4.3.4、裁定 R-Q1):表驱动。用户那条素材:62 个字符摊在 13 s = 4.8 字符/秒 → 必须被抓到。"""
import pytest

from app.library import quality
from app.library.asr_chunks import Chunk, Silence
from app.library.segment import Sentence
from app.speech.timed import Utterance


def sentence(chars: int, seconds: float) -> Sentence:
    return Sentence(0, round(seconds * 1000), "x" * chars)


@pytest.mark.parametrize("chars, seconds, outlier", [
    (62, 13.0, True),    # the reported case: 4.77 chars/s
    (62, 4.5, False),    # normal speech: 13.8 chars/s
    (62, 2.0, True),     # 31 chars/s: faster than anyone speaks
    (19, 20.0, False),   # too short to judge
    (100, 16.0, False),  # 6.25 chars/s: slow but real
    (100, 17.0, True),   # 5.88 chars/s
    (150, 6.0, False),   # exactly 25 chars/s
    (151, 6.0, True),
    (60, 0.0, True),     # no duration at all
])
def test_a_long_enough_sentence_outside_the_normal_speed_range_is_an_outlier(chars, seconds, outlier):
    assert quality.rate_outliers([sentence(chars, seconds)]) == int(outlier)


def test_outliers_are_counted_across_sentences():
    assert quality.rate_outliers([sentence(62, 4.5), sentence(62, 13.0), sentence(62, 2.0)]) == 2
    assert quality.rate_outliers([]) == 0


def test_an_estimated_chunk_that_is_mostly_silence_is_flagged():
    chunk = Chunk(0, 30_000, "some words that were said somewhere in here")
    silences = [Silence(0, 20_000)]
    assert quality.estimated_share(chunk, silences) == pytest.approx(1 / 3)
    assert quality.is_low_confidence([], [chunk], silences) is True
    assert quality.is_low_confidence([], [chunk], [Silence(0, 1000)]) is False  # 29 of 30 s are speech


def test_a_chunk_with_trusted_real_times_is_never_judged_by_its_speech_share():
    text = "Welcome back to the show everyone."
    chunk = Chunk(0, 30_000, text, [Utterance(text, 18_000, 21_200)])
    assert quality.is_low_confidence([sentence(34, 3.2)], [chunk], [Silence(0, 20_000)]) is False


def test_the_two_rules_combine_and_empty_input_is_fine():
    flat = [Chunk(0, 40_000, "x" * 40)]
    assert quality.is_low_confidence([sentence(62, 13.0)], flat, []) is True
    assert quality.is_low_confidence([sentence(62, 4.5)], flat, []) is False
    assert quality.is_low_confidence([], [], []) is False
