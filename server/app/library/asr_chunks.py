"""无字幕转写(B 档,spec §6.4、E5):静音感知分块 → 逐块现有识别 → 按字符比例估算句边界并吸附到静音点。

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
from dataclasses import asdict, dataclass
from pathlib import Path

from app.library.errors import LibraryError
from app.library.limits import (
    ASR_CHUNK_MAX_MS, ASR_CHUNK_MIN_MS, ASR_CHUNK_RETRIES, ASR_CHUNK_TARGET_MS, ASR_CONCURRENCY, ASR_HARD_CUT_MS,
)
from app.library.segment import Aligned, Fragment, set_span

SNAP_WINDOW_MS = 800
STATE_VERSION = 1
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


def plan_chunks(duration_ms: int, silences: list[Silence]) -> list[Chunk]:
    """Greedy from 0: the rest fits in 50 s -> one last chunk; else cut at the middle of the longest silence whose
    middle lies 15-50 s after the chunk start (ties: closest to 25 s); no silence there -> hard cut at 40 s."""
    chunks: list[Chunk] = []
    start = 0
    while start < duration_ms:
        if duration_ms - start <= ASR_CHUNK_MAX_MS:
            chunks.append(Chunk(start, duration_ms))
            break
        lo, hi = start + ASR_CHUNK_MIN_MS, start + ASR_CHUNK_MAX_MS
        inside = [s for s in silences if lo <= s.mid_ms <= hi]
        if inside:
            best = max(inside, key=lambda s: (s.length_ms, -abs(s.mid_ms - (start + ASR_CHUNK_TARGET_MS))))
            cut = best.mid_ms
        else:
            cut = start + ASR_HARD_CUT_MS
        chunks.append(Chunk(start, cut))
        start = cut
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


def fragments(chunks: list[Chunk], silences: list[Silence]) -> list[Fragment]:
    out = []
    for chunk in chunks:
        text = " ".join((chunk.text or "").split())
        if text:
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

def load_state(path: Path) -> list[Chunk] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("version") != STATE_VERSION:
            return None
        return [Chunk(int(c["start_ms"]), int(c["end_ms"]), c.get("text")) for c in data["chunks"]]
    except (OSError, ValueError, KeyError, TypeError):
        return None


def save_state(path: Path, chunks: list[Chunk]) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"version": STATE_VERSION, "chunks": [asdict(c) for c in chunks]}), encoding="utf-8")
    os.replace(tmp, path)


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


async def transcribe_chunks(chunks: list[Chunk], *, read: Callable[[Chunk], Awaitable[bytes]],
                            transcribe: Callable[[bytes], Awaitable[str]], save: Callable[[list[Chunk]], None],
                            progress: Callable[[int, int], Awaitable[None]],
                            concurrency: int = ASR_CONCURRENCY, retries: int = ASR_CHUNK_RETRIES) -> int:
    """Fill `text` of every chunk that has none (concurrency <= 2, each chunk tried 1 + `retries` times).
    `save` runs after every finished chunk; `progress(done, total)` after every chunk. Returns the seconds actually
    transcribed in this call. Any chunk failing for good -> LibraryError("upstream") (the others finish first)."""
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
                    text = await transcribe(wav)
                    break
                except asyncio.CancelledError:
                    raise
                except Exception:  # noqa: BLE001 - recognizer errors are classified by kind only
                    if attempt == retries:
                        failed = True
                        return
            async with lock:
                chunk.text = " ".join((text or "").split())
                spent += chunk.seconds
                done += 1
                save(chunks)
        await progress(done, total)

    await asyncio.gather(*(one(c) for c in todo))
    if failed:
        raise LibraryError("upstream")
    return spent
