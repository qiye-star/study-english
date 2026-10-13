"""Task 0 探针的纯函数与隐私:只输出字段名、条数、数字,从不输出文字、密钥或 URL。"""
import json

import pytest

from scripts.asr_timing_probe import (
    compare_truth, field_names, main, render_markdown, summarize_frames, summarize_utterances, summarize_whisper,
    unit_guess,
)

SECRET = "SECRET-TRANSCRIPT"
RAW = [
    {"text": f"{SECRET} one.", "start_time": 120, "end_time": 2400, "definite": True,
     "words": [{"text": SECRET, "start_time": 120, "end_time": 500, "blank_duration": 0}]},
    {"text": f"{SECRET} two.", "start_time": 2900, "end_time": 5100, "definite": True},
    {"text": f"{SECRET} three.", "start_time": 2000, "end_time": 1500},  # inverted, earlier than the one before, overlapping
    "not a dict",
]


def test_field_names_are_identifiers_only_and_never_values():
    assert field_names({"text": SECRET, "start_time": 1, f"{SECRET} words": 2, "": 3}) == ["<other>", "start_time", "text"]
    assert field_names(None) == [] and field_names([1, 2]) == []


@pytest.mark.parametrize("max_end, audio_ms, expected", [
    (None, 60_000, "none"), (58_400, 60_000, "ms"), (59.2, 60_000, "seconds?"), (900_000, 60_000, "out_of_range"),
    (3.0, 5_000, "ms"),  # a short clip cannot tell seconds from milliseconds: ms wins (>= 20 s needed to guess seconds)
])
def test_unit_guess(max_end, audio_ms, expected):
    assert unit_guess(max_end, audio_ms) == expected


def test_summary_counts_shapes_and_checks_without_any_text():
    s = summarize_utterances(RAW, 60_000)
    assert s["count"] == 3 and s["unit_guess"] == "ms"
    assert s["monotonic"] is False and s["overlaps"] == 1 and s["negative_or_inverted"] == 1
    assert (s["first_start"], s["last_end"]) == (120.0, 1500.0)
    assert s["rows"][0]["fields"] == ["definite", "end_time", "start_time", "text", "words"]
    assert s["rows"][0]["word_fields"] == ["blank_duration", "end_time", "start_time", "text"]
    assert s["rows"][0]["chars"] == len(f"{SECRET} one.") and s["rows"][0]["definite"] is True
    assert SECRET not in json.dumps(s)


def test_frames_summary_and_markdown_never_contain_the_transcript():
    frames = [
        {"last": False, "sequence": 1, "payload": {"result": {"text": SECRET}}},
        {"last": True, "sequence": -2, "payload": {"result": {"text": f"{SECRET} one. {SECRET} two.", "utterances": RAW},
                                                   "audio_info": {"duration": 5000}}},
    ]
    stream = {**summarize_frames(frames, 60_000), "seconds": 1.5}
    assert stream["frames"] == 2 and stream["error_code"] is None
    assert stream["final"]["has_utterances"] is True and stream["final"]["result_fields"] == ["text", "utterances"]
    assert stream["final"]["payload_fields"] == ["audio_info", "result"]
    text = render_markdown("A-music", 60_000, stream, None, [])
    assert SECRET not in text and "A-music" in text and "utterances" in text and "ms" in text


def test_no_utterances_is_reported_plainly():
    frames = [{"last": True, "sequence": -2, "payload": {"result": {"text": SECRET}}}]
    stream = {**summarize_frames(frames, 60_000), "seconds": 0.4}
    assert stream["final"]["has_utterances"] is False
    assert "没有" in render_markdown("B", 60_000, stream, None, [])


def test_an_error_frame_keeps_only_its_code():
    stream = {**summarize_frames([{"error": True, "code": 45000001}], 60_000), "seconds": 0.1}
    assert stream["error_code"] == 45000001 and stream["final"] is None
    assert "45000001" in render_markdown("A", 60_000, stream, None, [])


def test_whisper_summary_reads_segments_in_seconds():
    payload = {"text": SECRET, "segments": [{"id": 0, "start": 0.0, "end": 2.4, "text": SECRET},
                                            {"id": 1, "start": 2.9, "end": 5.1, "text": SECRET}]}
    s = summarize_whisper(200, payload, 60_000)
    assert s["has_segments"] is True and s["segments"]["count"] == 2 and s["segments"]["unit_guess"] == "seconds?"
    assert s["payload_fields"] == ["segments", "text"] and SECRET not in json.dumps(s)
    assert summarize_whisper(400, None, 60_000)["has_segments"] is False
    # a 60 s clip whose largest end is 58.4 means seconds (what Whisper really returns)
    far = summarize_whisper(200, {"segments": [{"start": 1.0, "end": 58.4, "text": "x"}]}, 60_000)
    assert far["segments"]["unit_guess"] == "seconds?"


def test_compare_truth_reports_signed_millisecond_errors():
    rows = summarize_utterances(RAW[:2], 60_000)["rows"]
    assert compare_truth(rows, [[100, 2500], [3000, 5000]]) == [
        {"index": 0, "start_error_ms": 20, "end_error_ms": -100}, {"index": 1, "start_error_ms": -100, "end_error_ms": 100}]
    sec = summarize_whisper(200, {"segments": [{"start": 0.1, "end": 2.5, "text": "x"}]}, 60_000)["segments"]["rows"]
    assert compare_truth(sec, [[100, 2400]], scale=1000.0) == [{"index": 0, "start_error_ms": 0, "end_error_ms": 100}]
    assert compare_truth(rows, "garbage") == []


def test_main_refuses_without_yes_and_with_bad_seconds(capsys):
    assert main(["--clip", "nothing.mp3"]) == 2
    assert main(["--clip", "nothing.mp3", "--yes", "--seconds", "500"]) == 2
    assert main(["--clip", "does-not-exist.mp3", "--yes"]) == 2
    out = capsys.readouterr()
    assert "--yes" in out.err
