"""B 档转写的纯函数与逐块调度(spec §6.4)。"""
import asyncio
import io
import wave

import pytest

from app.library import asr_chunks as ac
from app.library.errors import LibraryError
from app.library.segment import build

LOG = """[Parsed_silencedetect_0 @ 000001] silence_start: -0.01
[Parsed_silencedetect_0 @ 000001] silence_end: 0.4 | silence_duration: 0.41
[aac @ 000002] Qavg: 20622.104
[Parsed_silencedetect_0 @ 000001] silence_start: 2
[Parsed_silencedetect_0 @ 000001] silence_end: 3.000023 | silence_duration: 1.000023
[Parsed_silencedetect_0 @ 000001] silence_start: 9.5
"""


def test_parse_silences_clips_and_closes_the_last_one():
    assert ac.parse_silences(LOG, 10_000) == [ac.Silence(0, 400), ac.Silence(2000, 3000), ac.Silence(9500, 10_000)]
    assert ac.parse_silences("", 5000) == []


def test_short_media_is_one_chunk():
    assert ac.plan_chunks(50_000, []) == [ac.Chunk(0, 50_000)]
    assert ac.plan_chunks(0, []) == []


def test_cut_at_the_longest_silence_in_the_window():
    silences = [ac.Silence(10_000, 11_000), ac.Silence(20_000, 20_500), ac.Silence(30_000, 31_200),
                ac.Silence(60_000, 60_400)]
    chunks = ac.plan_chunks(100_000, silences)
    assert [(c.start_ms, c.end_ms) for c in chunks] == [(0, 30_600), (30_600, 60_200), (60_200, 100_000)]


def test_ties_prefer_the_target_and_no_silence_means_a_hard_cut_at_40_s():
    silences = [ac.Silence(17_000, 17_500), ac.Silence(24_800, 25_300)]
    assert ac.plan_chunks(70_000, silences)[0].end_ms == 25_050
    chunks = ac.plan_chunks(130_000, [])
    assert [(c.start_ms, c.end_ms) for c in chunks] == [(0, 40_000), (40_000, 80_000), (80_000, 130_000)]
    assert all(c.end_ms - c.start_ms <= 50_000 for c in chunks)


def test_speech_span_drops_edge_silences():
    chunk = ac.Chunk(10_000, 30_000)
    silences = [ac.Silence(9_000, 11_000), ac.Silence(29_000, 31_000), ac.Silence(20_000, 21_000)]
    assert ac.speech_span(chunk, silences) == (11_000, 29_000)
    assert ac.speech_span(chunk, [ac.Silence(5_000, 40_000)]) == (10_000, 30_000)


def test_fragments_skip_empty_chunks():
    chunks = [ac.Chunk(0, 10_000, "  Hello   there. "), ac.Chunk(10_000, 20_000, ""), ac.Chunk(20_000, 30_000, None)]
    assert ac.fragments(chunks, []) == [ac.Fragment(0, 10_000, "Hello there.")]


def test_boundaries_inside_a_chunk_snap_to_the_nearest_silence():
    chunk = ac.Chunk(0, 10_000, "One two three four five. Six seven eight nine ten.")
    silences = [ac.Silence(5_300, 5_900)]
    frags = ac.fragments([chunk], silences)
    out = build(frags, adjust=ac.snapper(silences))
    assert [(s.start_ms, s.end_ms) for s in out] == [(0, 5_600), (5_600, 10_000)]


def test_far_silences_do_not_move_a_boundary():
    chunk = ac.Chunk(0, 10_000, "One two three four five. Six seven eight nine ten.")
    out = build(ac.fragments([chunk], [ac.Silence(8_000, 8_500)]), adjust=ac.snapper([ac.Silence(8_000, 8_500)]))
    assert (out[0].end_ms, out[1].start_ms) == (4_800, 5_000)  # plain character-share estimate


def test_state_round_trip_and_bad_files(tmp_path):
    path = tmp_path / "chunks.json"
    chunks = [ac.Chunk(0, 1000, "hi"), ac.Chunk(1000, 2000)]
    ac.save_state(path, chunks)
    assert ac.load_state(path) == chunks
    path.write_text("{not json", encoding="utf-8")
    assert ac.load_state(path) is None
    assert ac.load_state(tmp_path / "missing.json") is None
    path.write_text('{"version": 99, "chunks": []}', encoding="utf-8")
    assert ac.load_state(path) is None


def _wav(path, seconds: float, rate=16000):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x01\x00" * int(rate * seconds))


def test_slice_wav(tmp_path):
    _wav(tmp_path / "a.wav", 3)
    data = ac.slice_wav(tmp_path / "a.wav", 1000, 2500)
    with wave.open(io.BytesIO(data)) as w:
        assert (w.getframerate(), w.getnchannels(), w.getnframes()) == (16000, 1, 24000)
    assert len(ac.slice_wav(tmp_path / "a.wav", 2500, 9000)) == 44 + 2 * 8000
    _wav(tmp_path / "b.wav", 1, rate=8000)
    with pytest.raises(LibraryError):
        ac.slice_wav(tmp_path / "b.wav", 0, 500)


async def test_transcribe_chunks_resumes_and_counts_only_new_seconds():
    chunks = [ac.Chunk(0, 25_000, "done before"), ac.Chunk(25_000, 50_000), ac.Chunk(50_000, 60_500)]
    saved, seen = [], []

    async def read(chunk):
        return f"{chunk.start_ms}".encode()

    async def transcribe(wav):
        seen.append(wav)
        return f" text  {wav.decode()} "

    async def progress(done, total):
        seen.append((done, total))

    spent = await ac.transcribe_chunks(chunks, read=read, transcribe=transcribe,
                                       save=lambda c: saved.append([x.text for x in c]), progress=progress)
    assert spent == 25 + 11
    assert [c.text for c in chunks] == ["done before", "text 25000", "text 50000"]
    assert sorted(w for w in seen if isinstance(w, bytes)) == [b"25000", b"50000"]
    assert saved[-1] == ["done before", "text 25000", "text 50000"] and (3, 3) in seen


async def test_transcribe_chunks_retries_then_fails_and_keeps_finished_chunks():
    chunks = [ac.Chunk(0, 10_000), ac.Chunk(10_000, 20_000)]
    calls = {"b": 0}

    async def read(chunk):
        return b"a" if chunk.start_ms == 0 else b"b"

    async def transcribe(wav):
        if wav == b"b":
            calls["b"] += 1
            raise RuntimeError("upstream text that must never be shown")
        await asyncio.sleep(0)
        return "ok"

    async def progress(done, total):
        pass

    with pytest.raises(LibraryError) as e:
        await ac.transcribe_chunks(chunks, read=read, transcribe=transcribe, save=lambda c: None, progress=progress)
    assert e.value.kind == "upstream" and calls["b"] == 3
    assert chunks[0].text == "ok" and chunks[1].text is None
