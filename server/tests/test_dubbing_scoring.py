"""打分(纯函数,穷举;plan L5 S4 / R11、R12)。权重与曲线全部是占位,待真机样本校准。"""
import math

import pytest

from app.dubbing import scoring
from app.dubbing.scoring import Span
from app.providers.xfyun_result import to_assessment
from tests.test_xfyun_result import REFERENCE, load

TICK = 10_000  # 100 ns ticks per millisecond


def wms(start_ms, dur_ms, error_type="None", text="w"):
    """A converted word with its offset and duration given in milliseconds (the result stores 100 ns ticks)."""
    return {"word": text, "offset": start_ms * TICK, "duration": dur_ms * TICK,
            "pronunciation_assessment": {"error_type": error_type}}


def result_with(words):
    return {"detail_result": {"words": words}}


# ---- constants ------------------------------------------------------------

def test_constants_are_the_placeholder_values():
    assert (scoring.W_PRON, scoring.W_FLUENCY, scoring.W_SYNC) == (0.6, 0.2, 0.2)
    assert scoring.SYNC_TOLERANCE_MS == 400
    assert scoring.TICKS_PER_MS == 10_000
    assert scoring.ONSET_FALLOFF_MS == 1000


# ---- spoken_span ------------------------------------------------------------

def test_spoken_span_of_the_real_ise_sample_starts_at_the_first_word():
    # the sample's last word ends at 5140 ms; the WAV length is not in the fixture, so 5200 ms is assumed here
    result = to_assessment(load("ise_good.xml"), REFERENCE)
    span = scoring.spoken_span(result, wav_ms=5200)
    assert span == Span(start_ms=10, end_ms=5140)  # hello: offset 1 frame = 10 ms
    assert scoring.spoken_span(result, wav_ms=5000) is None  # 5140 > 5000 + 100: the timing is not trusted


def test_silence_words_are_not_in_the_converted_result():
    result = to_assessment(load("ise_good.xml"), REFERENCE)
    texts = [w["word"] for w in result["detail_result"]["words"]]
    assert "sil" not in texts


def test_omission_words_are_skipped():
    words = [wms(10, 50, error_type="Omission", text="gone"), wms(20, 30, text="kept")]
    assert scoring.spoken_span(result_with(words), wav_ms=5000) == Span(start_ms=20, end_ms=50)


def test_zero_duration_words_are_skipped():
    words = [wms(10, 0), wms(40, 20)]
    assert scoring.spoken_span(result_with(words), wav_ms=5000) == Span(start_ms=40, end_ms=60)


@pytest.mark.parametrize("bad", [
    None,
    "not a dict",
    {},
    {"detail_result": None},
    {"detail_result": {}},
    {"detail_result": {"words": []}},
    {"detail_result": {"words": "nope"}},
])
def test_missing_or_malformed_results_give_none_without_raising(bad):
    assert scoring.spoken_span(bad, wav_ms=5000) is None


def test_offsets_that_go_backwards_give_none():
    assert scoring.spoken_span(result_with([wms(50, 10), wms(20, 10)]), wav_ms=5000) is None


def test_a_last_word_that_ends_more_than_100ms_past_the_wav_gives_none():
    words = [wms(10, 20), wms(100, 100)]  # the last word ends at 200 ms
    assert scoring.spoken_span(result_with(words), wav_ms=50) is None  # 200 > 50 + 100
    assert scoring.spoken_span(result_with(words), wav_ms=100) is not None  # 200 <= 100 + 100 (boundary holds)


def test_all_offsets_zero_give_none():
    assert scoring.spoken_span(result_with([wms(0, 30), wms(0, 30)]), wav_ms=5000) is None


def test_malformed_word_fields_are_skipped_not_raised():
    words = [{"word": "x", "offset": "1", "duration": 5}, wms(20, 30)]
    assert scoring.spoken_span(result_with(words), wav_ms=5000) == Span(start_ms=20, end_ms=50)


# ---- onset_score ------------------------------------------------------------

@pytest.mark.parametrize("err", [0, 400, -400])
def test_onset_inside_the_tolerance_is_full_marks(err):
    assert scoring.onset_score(err) == 100


def test_onset_just_outside_the_tolerance_is_just_below_full():
    assert 99 < scoring.onset_score(401) < 100


@pytest.mark.parametrize("err", [1400, 5000, -1400])
def test_onset_is_zero_at_and_after_the_falloff(err):
    assert scoring.onset_score(err) == 0


def test_onset_is_symmetric_and_linear_in_the_falloff():
    assert scoring.onset_score(900) == pytest.approx(50)  # 500 ms past tolerance of a 1000 ms falloff
    assert scoring.onset_score(-900) == pytest.approx(50)


@pytest.mark.parametrize("err", [math.nan, math.inf])
def test_onset_with_a_non_finite_error_is_zero(err):
    assert scoring.onset_score(err) == 0


# ---- ratio_score ------------------------------------------------------------

@pytest.mark.parametrize("ratio", [0.8, 1.0, 1.25])
def test_ratio_inside_the_band_is_full_marks(ratio):
    assert scoring.ratio_score(ratio) == 100


@pytest.mark.parametrize("ratio", [0.4, 0.3, 2.5, 9.0])
def test_ratio_at_or_beyond_the_zero_ends_is_zero(ratio):
    assert scoring.ratio_score(ratio) == 0


def test_ratio_is_linear_between_the_band_and_the_zero_ends():
    assert scoring.ratio_score(0.6) == pytest.approx(50)
    assert scoring.ratio_score(1.875) == pytest.approx(50)


@pytest.mark.parametrize("ratio", [0, -1, -0.5, math.nan, math.inf])
def test_ratio_that_is_not_positive_or_finite_is_zero(ratio):
    assert scoring.ratio_score(ratio) == 0


# ---- sync_score -------------------------------------------------------------

def _sync(**kw):
    base = dict(seg_start_ms=1000, seg_end_ms=3000, rec_start_ms=1000, capture="pcm",
                span=Span(start_ms=0, end_ms=2000), voiced_ms=None)
    base.update(kw)
    return scoring.sync_score(**base)


def test_pcm_with_usable_words_uses_onset_and_duration_and_says_words():
    assert _sync() == (100, "words")


def test_pcm_words_late_onset_lowers_the_score():
    value, basis = _sync(span=Span(start_ms=900, end_ms=2900))  # 900 ms late, same length
    assert basis == "words"
    assert value == round(0.5 * scoring.onset_score(900) + 0.5 * 100)


def test_recorder_capture_uses_only_the_word_span_and_says_duration():
    assert _sync(capture="recorder", span=Span(start_ms=0, end_ms=2000)) == (100, "duration")


def test_recorder_capture_ignores_the_onset_even_when_it_is_late():
    assert _sync(capture="recorder", span=Span(start_ms=2000, end_ms=4000)) == (100, "duration")


def test_no_usable_words_falls_back_to_voiced_ms_as_duration():
    assert _sync(span=None, voiced_ms=2000) == (100, "duration")


def test_voiced_ms_ratio_outside_the_band_is_scored_by_ratio():
    value, basis = _sync(span=None, voiced_ms=1000)  # 1000 / 2000 = 0.5
    assert basis == "duration"
    assert value == round(scoring.ratio_score(0.5))


def test_neither_words_nor_voiced_ms_is_none():
    assert _sync(span=None, voiced_ms=None) == (None, "none")


def test_a_zero_or_negative_length_original_is_none():
    assert _sync(seg_start_ms=1000, seg_end_ms=1000) == (None, "none")
    assert _sync(seg_start_ms=2000, seg_end_ms=1000) == (None, "none")


def test_pcm_without_a_record_start_cannot_use_the_words():
    assert _sync(rec_start_ms=None, voiced_ms=2000)[1] == "duration"


def test_negative_voiced_ms_is_ignored():
    assert _sync(span=None, voiced_ms=-5) == (None, "none")


# ---- line_score -------------------------------------------------------------

def test_line_score_weights_sixty_twenty_twenty():
    assert scoring.line_score(100, 100, 100) == 100
    assert scoring.line_score(100, 0, 0) == 60
    assert scoring.line_score(0, 100, 0) == 20
    assert scoring.line_score(0, 0, 100) == 20


def test_line_score_without_sync_renormalises_to_seventy_five_twenty_five():
    assert scoring.line_score(100, 0, None) == 75
    assert scoring.line_score(0, 100, None) == 25
    assert scoring.line_score(80, 40, None) == round(0.75 * 80 + 0.25 * 40)


def test_line_score_clamps_out_of_range_inputs():
    assert scoring.line_score(150, 150, 150) == 100
    assert scoring.line_score(-20, -20, -20) == 0


@pytest.mark.parametrize("bad", [True, False, None, math.nan, "80"])
def test_non_numbers_count_as_zero(bad):
    assert scoring.line_score(bad, 100, 100) == 40  # 0.2 * 100 + 0.2 * 100
    assert scoring.line_score(100, bad, 100) == 80  # 0.6 * 100 + 0.2 * 100


def test_line_score_is_an_int():
    assert isinstance(scoring.line_score(77, 66, 55), int)


# ---- take_summary -----------------------------------------------------------

def _line(score, pron, flu, sync):
    return {"score": score, "pronunciation": pron, "fluency": flu, "sync": sync}


def test_missing_lines_count_as_zero_in_the_total():
    lines = {0: _line(100, 100, 100, 100), 2: {"missing": "no_speech"}}
    total, summary = scoring.take_summary(lines, [0, 2])
    assert total == 50  # (100 + 0) / 2
    assert summary == {"pronunciation": 100, "fluency": 100, "sync": 100}


def test_summary_averages_only_the_recorded_lines_and_skips_none_sync():
    lines = {0: _line(80, 80, 60, None), 1: _line(40, 40, 20, 60)}
    total, summary = scoring.take_summary(lines, [0, 1])
    assert total == 60
    assert summary == {"pronunciation": 60, "fluency": 40, "sync": 60}


def test_no_role_lines_gives_total_none():
    assert scoring.take_summary({}, []) == (None, {"pronunciation": None, "fluency": None, "sync": None})


def test_string_keys_from_json_are_accepted():
    total, _ = scoring.take_summary({"0": _line(90, 90, 90, 90)}, [0])
    assert total == 90


def test_lines_outside_the_expected_role_lines_are_ignored():
    lines = {0: _line(100, 100, 100, 100), 5: _line(0, 0, 0, 0)}
    total, _ = scoring.take_summary(lines, [0])
    assert total == 100


def test_all_missing_is_zero_total_and_no_summary():
    total, summary = scoring.take_summary({}, [0, 1])
    assert total == 0
    assert summary == {"pronunciation": None, "fluency": None, "sync": None}
