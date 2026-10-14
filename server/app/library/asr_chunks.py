"""无字幕转写(B 档,spec §6.4、E5):静音感知分块 → 逐块现有识别 → 按字符比例估算句边界并吸附到静音点。
带时间的识别(plan 2026-10-13-library-alignment):块里存识别服务给的 `utterances`,`usable_utterances` 判断可信,`fragments`
对可信的块给出每个识别句一个真实时间的片段,其余块回落到估算。

纯函数:`parse_silences`(ffmpeg silencedetect 的输出,只取数字)、`plan_chunks`(15–50 s 窗口里最长静音的中点切,
没有静音就在 40 s 处硬切)、`speech_span`(扣掉块首尾静音)、`fragments`、`snapper`(句边界吸附到 ±0.8 s 内最近的
静音中点)。异步:`transcribe_chunks`(并发 ≤ 2、每块重试 2 次、每完成一块就写 `chunks.json`,重试从断点继续,
已完成的块不再花钱)。识别结果与 ffmpeg 输出永远不进日志。"""
import asyncio
import io
import json
import math
import os
import re
import wave
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

from app.library.errors import LibraryError
from app.library.limits import (
    ASR_CHUNK_MAX_MS, ASR_CHUNK_MIN_MS, ASR_CHUNK_RETRIES, ASR_CHUNK_TARGET_MS, ASR_CONCURRENCY, ASR_HARD_CUT_MS,
)
from app.library.segment import Aligned, Fragment, set_span
from app.speech.timed import TimedText, Utterance, Word

SNAP_WINDOW_MS = 800
STATE_VERSION = 3  # plan v2 R-V7: utterances carry their words ([text, start_ms, end_ms] lists)
READABLE_VERSIONS = (1, 2, 3)  # version 1 chunks carry no utterances, version 2 no words: still usable (R-A6, R-V7)
TRANSCRIPT_VERSION = 1  # the kept recognizer output of a ready item (plan v2 R-V8)
UTTERANCE_SLACK_MS = 1500  # an utterance may end this far past the chunk (rounding, trailing silence)
UTTERANCE_OVERLAP_MS = 250  # an utterance may start this far before the previous one ended
TEXT_AGREEMENT = 0.9  # SequenceMatcher ratio between the chunk text and the utterance texts (letters and digits only)
_START = re.compile(r"silence_start:\s*(-?\d+(?:\.\d+)?)")
_END = re.compile(r"silence_end:\s*(-?\d+(?:\.\d+)?)")


@dataclass(frozen=True)
class Silence:
    start_ms: int
    end_ms: int

    @property
    def mid_ms(self) -> int:
        return (self.start_ms + self.end_ms) // 2

    @property
    def length_ms(self) -> int:
        return self.end_ms - self.start_ms


@dataclass
class Chunk:
    start_ms: int
    end_ms: int
    text: str | None = None  # None = not transcribed yet
    # the recognizer's own sentences, ms from the chunk start; None = never asked / legacy state, [] = none returned
    utterances: list[Utterance] | None = None

    @property
    def seconds(self) -> int:
        return math.ceil((self.end_ms - self.start_ms) / 1000)


def parse_silences(log: str, duration_ms: int) -> list[Silence]:
    """ffmpeg `silencedetect` lines → silences clipped to [0, duration]; an open silence runs to the end."""
    out: list[Silence] = []
    start: int | None = None
    for line in log.splitlines():
        if (m := _START.search(line)) is not None:
            start = max(0, round(float(m.group(1)) * 1000))
        elif (m := _END.search(line)) is not None and start is not None:
            end = min(duration_ms, round(float(m.group(1)) * 1000))
            if end > start:
                out.append(Silence(start, end))
            start = None
    if start is not None and start < duration_ms:
        out.append(Silence(start, duration_ms))
    return out


def plan_chunks(duration_ms: int, silences: list[Silence], overlap_ms: int = 0) -> list[Chunk]:
    """Greedy from 0: the rest fits in 50 s -> one last chunk; else cut at the middle of the longest silence whose
    middle lies 15-50 s after the chunk start (ties: closest to 25 s); no silence there -> hard cut at 40 s.
    `overlap_ms` > 0 (plan v2 R-V5, only with word times): a hard cut is not a pause, so both chunks hear
    `overlap_ms` around it (the left one ends overlap/2 after the cut, the right one starts overlap/2 before it) and
    `timeline.merge_seams` keeps each word once. Silence cuts never overlap."""
    chunks: list[Chunk] = []
    start = 0
    half = max(0, overlap_ms) // 2
    while start < duration_ms:
        if duration_ms - start <= ASR_CHUNK_MAX_MS:
            chunks.append(Chunk(start, duration_ms))
            break
        lo, hi = start + ASR_CHUNK_MIN_MS, start + ASR_CHUNK_MAX_MS
        inside = [s for s in silences if lo <= s.mid_ms <= hi]
        if inside:
            best = max(inside, key=lambda s: (s.length_ms, -abs(s.mid_ms - (start + ASR_CHUNK_TARGET_MS))))
            cut = best.mid_ms
            chunks.append(Chunk(start, cut))
            start = cut
        else:
            cut = start + ASR_HARD_CUT_MS
            chunks.append(Chunk(start, min(duration_ms, cut + half)))
            start = cut - half
    return chunks


def speech_span(chunk: Chunk, silences: list[Silence]) -> tuple[int, int]:
    """The chunk minus a silence touching its start and one touching its end (whole chunk if nothing is left)."""
    s0, s1 = chunk.start_ms, chunk.end_ms
    for s in silences:
        if s.start_ms <= s0 < s.end_ms:
            s0 = min(s.end_ms, chunk.end_ms)
        if s.start_ms < s1 <= s.end_ms:
            s1 = max(s.start_ms, chunk.start_ms)
    return (s0, s1) if s1 > s0 else (chunk.start_ms, chunk.end_ms)


def _letters(text: str) -> str:
    return "".join(c for c in text.lower() if c.isalnum())


def usable_utterances(chunk: Chunk) -> list[Utterance]:
    """The chunk's recognizer-reported sentences when they can be trusted, else [] (R-A4): every one inside the chunk (plus
    slack), in order (small overlap allowed), and their texts agree with the chunk text. A time list that does not
    match the words must not be believed: the caller then estimates this chunk the old way. A chunk whose tail has no
    utterance (speech ended early, nothing returned for the rest) is still trusted as long as the words agree."""
    utts = chunk.utterances or []
    if not utts or not chunk.text:
        return []
    length = chunk.end_ms - chunk.start_ms
    previous_end = 0
    for u in utts:
        if not 0 <= u.start_ms < u.end_ms <= length + UTTERANCE_SLACK_MS or u.start_ms < previous_end - UTTERANCE_OVERLAP_MS:
            return []
        previous_end = u.end_ms
    a, b = _letters(chunk.text), _letters("".join(u.text for u in utts))
    if not a or not b or SequenceMatcher(None, a, b, autojunk=False).ratio() < TEXT_AGREEMENT:
        return []
    return list(utts)


def estimated_chunks(chunks: list[Chunk]) -> list[Chunk]:
    """Chunks that have text but no trustworthy times: their sentence times are character-share estimates."""
    return [c for c in chunks if " ".join((c.text or "").split()) and not usable_utterances(c)]


def fragments(chunks: list[Chunk], silences: list[Silence]) -> list[Fragment]:
    """One fragment per recognizer sentence for a trusted chunk (real times, offset by the chunk start); one fragment for
    the whole speech span of any other chunk (the character-share estimate, silences trimmed at both edges)."""
    out: list[Fragment] = []
    for chunk in chunks:
        text = " ".join((chunk.text or "").split())
        if not text:
            continue
        length = chunk.end_ms - chunk.start_ms
        real = [Fragment(chunk.start_ms + u.start_ms, chunk.start_ms + min(length, u.end_ms), u.text)
                for u in usable_utterances(chunk) if u.start_ms < length]
        if real:
            out += real
            continue
        s0, s1 = speech_span(chunk, silences)
        out.append(Fragment(s0, s1, text))
    return out


def nearest_mid(t: int, silences: list[Silence], window: int = SNAP_WINDOW_MS) -> int | None:
    best = min(silences, key=lambda s: abs(s.mid_ms - t), default=None)
    return best.mid_ms if best is not None and abs(best.mid_ms - t) <= window else None


def snapper(silences: list[Silence]) -> Callable[[Aligned], None]:
    """Boundary between two consecutive sentences of the same chunk -> both sides move to the nearest silence
    middle within ±0.8 s (kept inside that chunk). Chunk edges already sit in silences: they are not moved."""
    def adjust(aligned: Aligned) -> None:
        for i in range(len(aligned.spans) - 1):
            a, b = aligned.spans[i], aligned.spans[i + 1]
            piece_a = aligned.piece_at(max(a.char_start, a.char_end - 1))
            piece_b = aligned.piece_at(b.char_start)
            if piece_a[0] != piece_b[0]:  # the boundary is a chunk edge (already in a silence)
                continue
            frag = piece_a[2]
            mid = nearest_mid((a.end_ms + b.start_ms) // 2, silences)
            if mid is None or not frag.start_ms < mid < frag.end_ms or not a.start_ms < mid < b.end_ms:
                continue
            set_span(aligned, i, end_ms=mid)
            set_span(aligned, i + 1, start_ms=mid)
    return adjust


# ---- state file and WAV slices ----

def _load_utterances(raw) -> list[Utterance] | None:
    if not isinstance(raw, list):
        return None
    return [Utterance(str(u["text"]), int(u["start_ms"]), int(u["end_ms"]),
                      tuple(Word(str(w[0]), int(w[1]), int(w[2])) for w in u.get("words") or ()))
            for u in raw]


def _utterance_json(u: Utterance) -> dict:
    out = {"text": u.text, "start_ms": u.start_ms, "end_ms": u.end_ms}
    if u.words:
        out["words"] = [[w.text, w.start_ms, w.end_ms] for w in u.words]
    return out


def _chunk_json(c: Chunk) -> dict:
    return {"start_ms": c.start_ms, "end_ms": c.end_ms, "text": c.text,
            "utterances": None if c.utterances is None else [_utterance_json(u) for u in c.utterances]}


def _chunks_from(raw) -> list[Chunk]:
    return [Chunk(int(c["start_ms"]), int(c["end_ms"]), c.get("text"), _load_utterances(c.get("utterances")))
            for c in raw]


def _write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, path)


def load_state(path: Path) -> list[Chunk] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("version") not in READABLE_VERSIONS:
            return None
        return _chunks_from(data["chunks"])
    except (OSError, ValueError, KeyError, TypeError, AttributeError, IndexError):
        return None


def save_state(path: Path, chunks: list[Chunk]) -> None:
    _write_json(path, {"version": STATE_VERSION, "chunks": [_chunk_json(c) for c in chunks]})


def save_transcript(path: Path, chunks: list[Chunk], silences: list[Silence]) -> None:
    """The recognizer's whole output for a ready item (plan v2 R-V8): every chunk with its text, utterances and words,
    plus the silence table. Kept in the item directory so sentences can be rebuilt without paying again; deleted with
    the item. Holds transcript text: never log it, never copy it elsewhere."""
    _write_json(path, {"version": TRANSCRIPT_VERSION, "chunks": [_chunk_json(c) for c in chunks],
                       "silences": [[x.start_ms, x.end_ms] for x in silences]})


def load_transcript(path: Path) -> tuple[list[Chunk], list[Silence]] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("version") != TRANSCRIPT_VERSION:
            return None
        return _chunks_from(data["chunks"]), [Silence(int(a), int(b)) for a, b in data["silences"]]
    except (OSError, ValueError, KeyError, TypeError, AttributeError, IndexError):
        return None


def slice_wav(path: Path, start_ms: int, end_ms: int) -> bytes:
    """[start, end) of a 16 kHz mono 16-bit WAV as its own WAV."""
    with wave.open(str(path), "rb") as src:
        rate = src.getframerate()
        if rate != 16000 or src.getnchannels() != 1 or src.getsampwidth() != 2:
            raise LibraryError("corrupt")
        first = max(0, start_ms * rate // 1000)
        count = max(0, min(src.getnframes(), end_ms * rate // 1000) - first)
        src.setpos(min(first, src.getnframes()))
        pcm = src.readframes(count)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(16000)
        out.writeframes(pcm)
    return buf.getvalue()


async def transcribe_chunks_timed(chunks: list[Chunk], *, read: Callable[[Chunk], Awaitable[bytes]],
                                  transcribe: Callable[[bytes], Awaitable[TimedText]],
                                  save: Callable[[list[Chunk]], None],
                                  progress: Callable[[int, int], Awaitable[None]],
                                  concurrency: int = ASR_CONCURRENCY, retries: int = ASR_CHUNK_RETRIES) -> int:
    """Fill `text` (and `utterances`) of every chunk that has no text (concurrency <= 2, each chunk tried 1 + `retries`
    times). `save` runs after every finished chunk; `progress(done, total)` after every chunk. Returns the seconds
    actually transcribed in this call. Any chunk failing for good -> LibraryError("upstream") (the others finish first)."""
    todo = [c for c in chunks if c.text is None]
    total, done = len(chunks), len(chunks) - len(todo)
    gate = asyncio.Semaphore(max(1, concurrency))
    spent = 0
    failed = False
    lock = asyncio.Lock()

    async def one(chunk: Chunk) -> None:
        nonlocal spent, done, failed
        async with gate:
            if failed:
                return
            wav = await read(chunk)
            for attempt in range(retries + 1):
                try:
                    result = await transcribe(wav)
                    break
                except asyncio.CancelledError:
                    raise
                except Exception:  # noqa: BLE001 - recognizer errors are classified by kind only
                    if attempt == retries:
                        failed = True
                        return
            async with lock:
                chunk.text = " ".join((result.text or "").split())
                chunk.utterances = list(result.utterances)
                spent += chunk.seconds
                done += 1
                save(chunks)
        await progress(done, total)

    await asyncio.gather(*(one(c) for c in todo))
    if failed:
        raise LibraryError("upstream")
    return spent


async def transcribe_chunks(chunks: list[Chunk], *, read: Callable[[Chunk], Awaitable[bytes]],
                            transcribe: Callable[[bytes], Awaitable[str]], save: Callable[[list[Chunk]], None],
                            progress: Callable[[int, int], Awaitable[None]],
                            concurrency: int = ASR_CONCURRENCY, retries: int = ASR_CHUNK_RETRIES) -> int:
    """The text-only form (no times): `transcribe_chunks_timed` with every result wrapped as `TimedText(text)`."""
    async def timed(wav: bytes) -> TimedText:
        return TimedText(await transcribe(wav))

    return await transcribe_chunks_timed(chunks, read=read, transcribe=timed, save=save, progress=progress,
                                         concurrency=concurrency, retries=retries)
