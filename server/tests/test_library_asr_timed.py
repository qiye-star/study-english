"""句边界:识别服务给出的真实时间优先,持续背景音乐下不再平摊(plan 2026-10-13-library-alignment)。"""
import pytest

from app.library import asr_chunks as ac
from app.library.segment import Fragment, build
from app.speech.timed import TimedText, Utterance

LINES = ["Welcome back to the show everyone.", "Today we are talking about learning English.",
         "Let us begin with a simple question."]
TEXT = " ".join(LINES)
# 用户素材的形状:40 s 硬切块里,前 18 s 只有背景音乐,三句人声在已知的时间(没有任何静音可供 silencedetect 找到)
UTTS = [Utterance(LINES[0], 18_000, 21_200), Utterance(LINES[1], 22_000, 26_400), Utterance(LINES[2], 27_300, 30_100)]


def chunk_with(utts, text=TEXT, start=0, end=40_000):
    return ac.Chunk(start, end, text, utts)


def test_state_keeps_utterances_and_still_reads_version_1(tmp_path):
    path = tmp_path / "chunks.json"
    chunks = [ac.Chunk(0, 1000, "hi there", [Utterance("hi there", 100, 900)]), ac.Chunk(1000, 2000, "x", []),
              ac.Chunk(2000, 3000)]
    ac.save_state(path, chunks)
    assert ac.STATE_VERSION == 2 and ac.load_state(path) == chunks
    path.write_text('{"version": 1, "chunks": [{"start_ms": 0, "end_ms": 1000, "text": "old"}]}', encoding="utf-8")
    assert ac.load_state(path) == [ac.Chunk(0, 1000, "old")]
    path.write_text('{"version": 3, "chunks": []}', encoding="utf-8")
    assert ac.load_state(path) is None


GOOD = list(UTTS)
CASES = {
    "good": (GOOD, True),
    "case and punctuation differences are fine": (
        [Utterance(LINES[0].upper().replace(".", ""), 18_000, 21_200), *UTTS[1:]], True),
    "none": (None, False),
    "empty": ([], False),
    "ends beyond the chunk plus slack": ([*UTTS[:2], Utterance(LINES[2], 27_300, 41_600)], False),
    "overlap beyond tolerance": ([Utterance(LINES[0], 18_000, 23_000), *UTTS[1:]], False),
    "inverted times": ([Utterance(LINES[0], 21_200, 18_000), *UTTS[1:]], False),
    "text does not match": ([Utterance("Something else entirely different.", 18_000, 21_200)], False),
    "covers only part of the text": ([UTTS[0]], False),
}


@pytest.mark.parametrize("utts, ok", list(CASES.values()), ids=list(CASES))
def test_usable_utterances(utts, ok):
    assert bool(ac.usable_utterances(chunk_with(utts))) is ok


def test_a_chunk_without_text_never_has_usable_utterances():
    assert ac.usable_utterances(chunk_with(UTTS, text=None)) == []
    assert ac.usable_utterances(chunk_with(UTTS, text="")) == []


def test_a_chunk_whose_tail_has_no_utterance_is_still_trusted():
    """Real finding (Task 0, clip B): speech ends well before the chunk end and nothing is returned for the tail."""
    chunk = chunk_with(UTTS, end=60_000)  # utterances stop at 30.1 s, text has no more words than the utterances
    assert ac.usable_utterances(chunk) == UTTS
    assert ac.fragments([chunk], []) == [Fragment(18_000, 21_200, LINES[0]), Fragment(22_000, 26_400, LINES[1]),
                                          Fragment(27_300, 30_100, LINES[2])]


def test_fragments_use_the_recognizers_times_offset_by_the_chunk_start():
    out = ac.fragments([ac.Chunk(40_000, 80_000, TEXT, UTTS)], [])
    assert out == [Fragment(58_000, 61_200, LINES[0]), Fragment(62_000, 66_400, LINES[1]),
                   Fragment(67_300, 70_100, LINES[2])]


def test_an_untrusted_chunk_falls_back_to_the_estimate_and_trusted_ones_do_not():
    estimated = ac.Chunk(0, 40_000, TEXT, [])
    assert ac.fragments([estimated], []) == [Fragment(0, 40_000, TEXT)]
    mixed = ac.fragments([ac.Chunk(0, 40_000, TEXT, UTTS), ac.Chunk(40_000, 80_000, "No times here at all.")],
                         [ac.Silence(39_000, 41_000)])
    assert mixed[:3] == [Fragment(18_000, 21_200, LINES[0]), Fragment(22_000, 26_400, LINES[1]),
                         Fragment(27_300, 30_100, LINES[2])]
    assert mixed[3] == Fragment(41_000, 80_000, "No times here at all.")  # the old speech_span estimate


def test_an_utterance_slightly_past_the_chunk_end_is_clamped():
    chunk = ac.Chunk(0, 40_000, "Hello there my friend.", [Utterance("Hello there my friend.", 39_000, 40_900)])
    assert ac.fragments([chunk], []) == [Fragment(39_000, 40_000, "Hello there my friend.")]


def test_continuous_background_music_no_longer_spreads_the_first_sentences_flat():
    """Old behaviour (no silences found, text spread over the whole hard-cut chunk) vs real times."""
    old = build(ac.fragments([ac.Chunk(0, 40_000, TEXT)], []), adjust=ac.snapper([]))
    assert old[0].start_ms == 0 and old[0].end_ms > 10_000 and old[1].start_ms < 13_000  # the reported bug
    new = build(ac.fragments([chunk_with(UTTS)], []), adjust=ac.snapper([]))
    assert [(s.start_ms, s.end_ms, s.text) for s in new] == [
        (18_000, 21_200, LINES[0]), (22_000, 26_400, LINES[1]), (27_300, 30_100, LINES[2])]


def test_estimated_chunks_lists_only_chunks_that_have_text_but_no_trusted_times():
    chunks = [chunk_with(UTTS), ac.Chunk(40_000, 80_000, "No times."), ac.Chunk(80_000, 90_000, ""), ac.Chunk(90_000, 99_000)]
    assert ac.estimated_chunks(chunks) == [chunks[1]]


async def test_timed_transcription_stores_text_and_utterances_and_counts_only_new_seconds():
    chunks = [ac.Chunk(0, 10_000), ac.Chunk(10_000, 20_000, "kept")]
    seen = []

    async def read(chunk):
        return str(chunk.start_ms).encode()

    async def transcribe(wav):
        seen.append(wav)
        return TimedText(" Hi  there. ", (Utterance("Hi there.", 500, 1500),))

    async def progress(done, total):
        pass

    spent = await ac.transcribe_chunks_timed(chunks, read=read, transcribe=transcribe, save=lambda c: None, progress=progress)
    assert spent == 10 and seen == [b"0"]
    assert chunks[0].text == "Hi there." and chunks[0].utterances == [Utterance("Hi there.", 500, 1500)]
    assert chunks[1].utterances is None  # finished before: untouched
