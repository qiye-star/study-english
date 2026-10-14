"""评估脚本(plan 2026-10-14-library-alignment-v2 Task 9):无参照的一致性报告、金标准模板与打分;只输出数字。"""
import json

from app.library.asr_chunks import save_transcript
from app.library.segment import Sentence
from scripts.library_alignment_eval import (
    cuts_inside_words, edge_offsets, gold_errors, main, sample_rows, verdict, violations, word_free_spans,
)
from tests.library_words import chunk, run, utt

SECRET = "SECRET-TRANSCRIPT"


def transcript(tmp_path):
    a = utt(f"{SECRET} welcome back to my channel.", 27_360, word_ms=250, gap_ms=40)
    b = utt("So we went to the market and then we bought food.", 31_000, word_ms=250, gap_ms=40, gaps={5: 3_000})
    c = utt("Okay.", 60_000, word_ms=300)
    path = tmp_path / "transcript.json"
    save_transcript(path, [chunk(0, 70_000, a, b, c)], [])
    return path


def test_report_prints_numbers_only_and_v2_never_cuts_a_word(tmp_path, capsys):
    assert main(["report", "--transcript", str(transcript(tmp_path)), "--label", "T"]) == 0
    out = capsys.readouterr().out
    assert SECRET not in out and "market" not in out
    now = json.loads(out.split("- now:")[1].splitlines()[0])
    v1 = json.loads(out.split("- v1:")[1].splitlines()[0])
    assert now["cuts_inside_words"] == 0 and now["violations"] == {"inverted": 0, "overlapping": 0, "not_monotonic": 0}
    assert now["lead"]["max"] <= 40 and now["pauses_over_1500_inside"] == 0
    assert v1["pauses_over_1500_inside"] >= 1  # v1 kept the 3 s pause inside a sentence
    assert "word_free_spans_s" in out


def test_sample_writes_a_times_only_template(tmp_path, capsys):
    out_file = tmp_path / "gold.json"
    assert main(["sample", "--transcript", str(transcript(tmp_path)), "--n", "3", "--out", str(out_file)]) == 0
    rows = json.loads(out_file.read_text("utf-8"))
    assert len(rows) == 3 and set(rows[0]) == {"ours_start_ms", "ours_end_ms", "true_start_ms", "true_end_ms"}
    assert SECRET not in capsys.readouterr().out


def test_score_against_a_gold_file(tmp_path, capsys):
    path = transcript(tmp_path)
    gold = tmp_path / "gold.json"
    gold.write_text(json.dumps([{"true_start_ms": 27_360, "true_end_ms": 29_060},
                                {"true_start_ms": 60_000, "true_end_ms": 60_300},
                                {"true_start_ms": None, "true_end_ms": None}]), encoding="utf-8")
    assert main(["score", "--transcript", str(path), "--gold", str(gold)]) == 0
    out = capsys.readouterr().out
    now = json.loads(out.split("- gold now:")[1].splitlines()[0])
    assert now["n"] == 2 and now["start_p95"] <= 40 and now["end_p95"] <= 80 and now["clip_rate"] == 0
    assert json.loads(out.split("- gold verdict:")[1].splitlines()[0])["start_p50"] == "PASS"


def test_pure_metrics():
    tokens = run(["a", "b", "c"], start_ms=1_000)  # 1000-1300, 1360-1660, 1720-2020
    inside = [Sentence(1_100, 1_700, "x")]
    assert cuts_inside_words(inside, tokens) == 1
    assert edge_offsets([Sentence(900, 2_100, "x")], tokens) == ([100], [80], 0)
    assert violations([Sentence(0, 10, "a"), Sentence(5, 4, "b")]) == {"inverted": 1, "overlapping": 1, "not_monotonic": 0}
    assert word_free_spans(tokens, 10_000) == [(2_020, 10_000)]
    assert sample_rows([], 5, 1) == []
    assert gold_errors([Sentence(1_000, 2_000, "x")], [{"true_start_ms": 900, "true_end_ms": 2_100}])["clip_rate"] == 1.0
    assert verdict({"n": 0})["start_p50"] is None
