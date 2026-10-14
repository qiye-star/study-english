"""Task 0 探针(plan 2026-10-14-library-alignment-v2)的纯函数与隐私:只输出字段名、条数、毫秒数,从不输出文字。"""
import pytest

from scripts.asr_words_probe import (
    main, pct, render, seam_stats, shift, time_grid, utterances_of, v1_offsets, word_stats,
)

SECRET = "SECRET-TRANSCRIPT"


def words(*rows):
    return [{"text": t, "start_time": s, "end_time": e} for t, s, e in rows]


RESULT = {"utterances": [
    {"text": f"{SECRET} one, two.", "start_time": 10_000, "end_time": 11_400, "definite": True, "additions": {"x": 1},
     "words": words((SECRET, 10_000, 10_400), ("one,", 10_450, 10_800), ("two", 10_850, 11_400))},
    {"text": "Three four five.", "start_time": 14_000, "end_time": 17_500, "definite": True,
     "words": words(("three", 14_000, 14_300), ("four", 16_200, 16_500), ("five", 16_550, 17_500))},
    "junk",
]}


def test_utterances_keep_numbers_and_field_names():
    utts = utterances_of(RESULT)
    assert len(utts) == 2 and utts[0]["fields"] == ["additions", "definite", "end_time", "start_time", "text", "words"]
    assert utts[0]["word_fields"] == ["end_time", "start_time", "text"] and utts[0]["addition_fields"] == ["x"]
    assert utts[0]["words"][1] == ("one", 10_450, 10_800, True)
    assert utterances_of(None) == [] and utterances_of({"utterances": "x"}) == []


def test_word_stats():
    st = word_stats(utterances_of(RESULT))
    assert (st["utterances"], st["words"], st["words_inside_their_utterance"], st["words_monotonic"]) == (2, 6, 6, True)
    assert st["time_grid_ms"] == 50 and st["gaps_over_1000"] == 1 and st["inner_max_gap_max"] == 1900
    assert st["word_punct"] == 2 and st["token_word_match"] == 1.0 and st["dur_zero"] == 0


def test_v1_offsets_measure_how_far_sentences_sit_from_their_words():
    v1 = v1_offsets(utterances_of(RESULT))
    assert v1["v1_sentences"] >= 1 and v1["v1_edge_max"] is not None and v1["v1_with_gap_over_1500"] == 1


def test_seam_stats_measure_cross_run_jitter():
    whole = utterances_of(RESULT)
    left = utterances_of({"utterances": [{"text": "x", "start_time": 10_000, "end_time": 11_400, "words": words(
        ("one", 10_470, 10_810), ("two", 10_860, 11_380))}]})
    right = shift(utterances_of({"utterances": [{"text": "x", "start_time": 0, "end_time": 1_400, "words": words(
        ("one", 430, 790), ("two", 850, 1_400))}]}), 10_000)
    seam = seam_stats(whole, left, right, 10_700)
    assert seam["seam_matched_left"] == 2 and seam["seam_matched_right"] == 2
    assert seam["jitter_max"] == 20 and seam["left_edge_word_cut"] is False


def test_the_markdown_never_contains_the_transcript():
    utts = utterances_of(RESULT)
    block = render("A-music", 60_000, {k: utts[0][k] for k in ("fields", "word_fields", "addition_fields")},
                   word_stats(utts), v1_offsets(utts), seam_stats(utts, utts, utts, 10_700))
    assert SECRET not in block and SECRET.lower() not in block and "A-music" in block and "jitter_p50" in block


def test_helpers():
    assert pct([], 50) is None and pct([3, 1, 2], 50) == 2 and pct([1, 2, 3, 4], 95) == 4
    assert time_grid([10_000, 10_450, 10_800]) == 50 and time_grid([]) == 0


@pytest.mark.parametrize("argv", [["--clip", "x.mp3"], ["--clip", "x.mp3", "--yes", "--seconds", "5"],
                                  ["--clip", "missing.mp3", "--yes"]])
def test_it_refuses_without_yes_bad_seconds_or_a_missing_clip(argv):
    assert main(argv) == 2
