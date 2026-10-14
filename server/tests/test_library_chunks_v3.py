"""识别块 v3(plan 2026-10-14-library-alignment-v2 R-V5、R-V7、R-V8):硬切处重叠、状态文件带词、保留的识别结果。"""
import json

from app.library import asr_chunks as ac
from app.speech.timed import Utterance
from tests.library_words import chunk, utt


def test_hard_cuts_overlap_and_silence_cuts_do_not():
    assert [(c.start_ms, c.end_ms) for c in ac.plan_chunks(100_000, [], overlap_ms=2_000)] == [
        (0, 41_000), (39_000, 80_000), (78_000, 100_000)]
    silent = [ac.Silence(29_800, 30_400)]
    assert ac.plan_chunks(60_000, silent, overlap_ms=2_000) == ac.plan_chunks(60_000, silent)
    assert [(c.start_ms, c.end_ms) for c in ac.plan_chunks(100_000, [])] == [(0, 40_000), (40_000, 80_000), (80_000, 100_000)]


def test_fifteen_minutes_without_any_silence_costs_about_five_percent_more_with_overlap():
    """The worst case quoted in the plan (every cut is a hard cut): 900 s -> 944 s; 3 s would cost 981 s."""
    assert sum(c.seconds for c in ac.plan_chunks(900_000, [])) == 900
    assert sum(c.seconds for c in ac.plan_chunks(900_000, [], overlap_ms=2_000)) == 944
    assert sum(c.seconds for c in ac.plan_chunks(900_000, [], overlap_ms=3_000)) == 981


def test_state_v3_keeps_words_and_still_reads_v1_and_v2(tmp_path):
    path = tmp_path / "chunks.json"
    chunks = [chunk(0, 40_000, utt("Hello there.", 1_000)), ac.Chunk(40_000, 50_000, "x", []), ac.Chunk(50_000, 60_000)]
    ac.save_state(path, chunks)
    assert json.loads(path.read_text("utf-8"))["version"] == 3 and ac.load_state(path) == chunks
    path.write_text('{"version": 2, "chunks": [{"start_ms": 0, "end_ms": 9, "text": "a", "utterances": '
                    '[{"text": "a", "start_ms": 1, "end_ms": 5}]}]}', encoding="utf-8")
    assert ac.load_state(path) == [ac.Chunk(0, 9, "a", [Utterance("a", 1, 5)])]


def test_the_kept_transcript_round_trips_and_bad_files_read_as_none(tmp_path):
    path = tmp_path / "transcript.json"
    chunks = [chunk(0, 40_000, utt("Hello there.", 1_000))]
    ac.save_transcript(path, chunks, [ac.Silence(0, 900)])
    assert ac.load_transcript(path) == (chunks, [ac.Silence(0, 900)])
    for bad in ("", "{}", '{"version": 2, "chunks": [], "silences": []}', '{"version": 1, "chunks": [{}], "silences": []}'):
        path.write_text(bad, encoding="utf-8")
        assert ac.load_transcript(path) is None
    assert ac.load_transcript(tmp_path / "missing.json") is None


def test_transcript_size_for_fifteen_fast_minutes_is_in_the_low_hundreds_of_kilobytes(tmp_path):
    """The size estimate in the plan: ~3,600 words (20 chars/s for 900 s) -> well under 300 KB of JSON."""
    sentence = "this speaker talks quickly about her day in the city."
    chunks = []
    for n in range(23):
        utts = [utt(sentence, 1_000 + i * 4_000) for i in range(9)]
        chunks.append(chunk(n * 39_000, n * 39_000 + 41_000, *utts))
    path = tmp_path / "transcript.json"
    ac.save_transcript(path, chunks, [])
    words = sum(len(u.words) for c in chunks for u in c.utterances)
    assert 1_900 <= words <= 2_100 and path.stat().st_size < 150_000
    assert path.stat().st_size / words < 70  # bytes per word, text included
