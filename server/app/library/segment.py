"""「带时间的片段 → 句子」分句器(spec §6.3「分句」;纯函数)。字幕 cue 与识别块估算出的片段共用它(E6)。

1. 片段文本按一个空格连接,记下每个片段在连接串里的字符区间(`align`)。
2. 调 `app.speech.sentence_split.split_all`(不改它),用游标在连接串里依次定位每个句子。
3. 字符位置 → 时间:片段内按字符比例线性插值(计划 R-SC5;句首在片段开头时就是片段的 start)。
4. `finish`:超长(> 14 s 或 > 40 词)的句子优先在前后间隔 ≥ 400 ms 的片段边界断开,其次任意片段边界,
   最后是最靠近中点的词边界;短句(< 1 s 或 < 3 词)先并入前一句、不行再并入后一句(合并后仍不超限才合);
   句与句不重叠;每句 ≤ 600 字(`split_all` 每句 ≤ 200 字,合并受 600 字约束,所以硬切不会发生,计划 R-SC7)。
存原始起止毫秒;播放缓冲由网页加。
"""
from collections.abc import Callable
from dataclasses import dataclass, replace

from app.library.limits import SEGMENT_TEXT_MAX
from app.speech.sentence_split import split_all

MAX_MS = 14_000
MAX_WORDS = 40
MIN_MS = 1_000
MIN_WORDS = 3
PREFERRED_GAP_MS = 400


@dataclass(frozen=True)
class Fragment:
    start_ms: int
    end_ms: int
    text: str


@dataclass(frozen=True)
class Sentence:
    start_ms: int
    end_ms: int
    text: str


@dataclass(frozen=True)
class Span:
    """A sentence located in the joined text: [char_start, char_end) plus its times."""
    char_start: int
    char_end: int
    start_ms: int
    end_ms: int


@dataclass
class Aligned:
    joined: str
    pieces: list[tuple[int, int, Fragment]]  # (char_start, char_end, fragment) for every non-blank fragment
    spans: list[Span]

    def text(self, span: Span) -> str:
        return self.joined[span.char_start:span.char_end]

    def piece_at(self, pos: int) -> tuple[int, int, Fragment]:
        """The fragment that holds character `pos` (a joining space belongs to the next fragment)."""
        for start, end, frag in self.pieces:
            if pos < end:
                return start, end, frag
        return self.pieces[-1]

    def time_at(self, pos: int) -> int:
        """Linear interpolation inside the fragment that holds `pos` (pos == fragment end -> its end time)."""
        start, end, frag = self.piece_at(pos)
        if pos <= start:
            return frag.start_ms
        if pos >= end:
            return frag.end_ms
        return frag.start_ms + round((frag.end_ms - frag.start_ms) * (pos - start) / max(1, end - start))

    def end_time(self, char_end: int) -> int:
        """Time just after the last character (char_end is exclusive)."""
        start, end, frag = self.piece_at(max(0, char_end - 1))
        if char_end >= end:
            return frag.end_ms
        return frag.start_ms + round((frag.end_ms - frag.start_ms) * (char_end - start) / max(1, end - start))


def align(fragments: list[Fragment]) -> Aligned:
    pieces: list[tuple[int, int, Fragment]] = []
    parts: list[str] = []
    pos = 0
    for frag in fragments:
        if not frag.text.strip():
            continue
        if parts:
            parts.append(" ")
            pos += 1
        pieces.append((pos, pos + len(frag.text), frag))
        parts.append(frag.text)
        pos += len(frag.text)
    joined = "".join(parts)
    aligned = Aligned(joined, pieces, [])
    if not pieces:
        return aligned
    cursor = 0
    for sentence in split_all(joined):
        at = joined.find(sentence, cursor)
        if at < 0:  # cannot happen (split_all returns stripped substrings); skip rather than misplace
            continue
        end = at + len(sentence)
        aligned.spans.append(Span(at, end, aligned.time_at(at), aligned.end_time(end)))
        cursor = end
    return aligned


def _words(text: str) -> int:
    return len(text.split())


def _too_long(aligned: Aligned, span: Span) -> bool:
    return span.end_ms - span.start_ms > MAX_MS or _words(aligned.text(span)) > MAX_WORDS


def _cut_points(aligned: Aligned, span: Span) -> list[tuple[int, int, int]]:
    """(rank, char position, time) of every place the span may be cut: 0 = fragment boundary with a gap >= 400 ms,
    1 = other fragment boundary, 2 = word boundary inside a fragment. The position is the joining space."""
    points = []
    boundaries = {}
    for (s1, e1, f1), (s2, _e2, f2) in zip(aligned.pieces, aligned.pieces[1:]):
        boundaries[e1] = (0 if f2.start_ms - f1.end_ms >= PREFERRED_GAP_MS else 1, f1.end_ms)
    for pos in range(span.char_start + 1, span.char_end - 1):
        if aligned.joined[pos] != " " or aligned.joined[pos - 1] == " ":
            continue
        if pos in boundaries:
            rank, time = boundaries[pos]
        else:
            rank, time = 2, aligned.time_at(pos)
        points.append((rank, pos, time))
    return points


def _split_long(aligned: Aligned, span: Span) -> list[Span]:
    if not _too_long(aligned, span):
        return [span]
    points = _cut_points(aligned, span)
    if not points:
        return [span]
    middle = (span.start_ms + span.end_ms) / 2
    best_rank = min(p[0] for p in points)
    _rank, pos, _time = min((p for p in points if p[0] == best_rank),
                            key=lambda p: (abs(p[2] - middle), p[1]))
    left_end = pos
    right_start = pos + 1
    left = Span(span.char_start, left_end, span.start_ms, aligned.end_time(left_end))
    right = Span(right_start, span.char_end, max(left.end_ms, aligned.time_at(right_start)), span.end_ms)
    return _split_long(aligned, left) + _split_long(aligned, right)


def _merged(a: Span, b: Span) -> Span:
    return Span(a.char_start, b.char_end, min(a.start_ms, b.start_ms), max(a.end_ms, b.end_ms))


def _fits(aligned: Aligned, span: Span) -> bool:
    return not _too_long(aligned, span) and len(aligned.text(span)) <= SEGMENT_TEXT_MAX


def _short(aligned: Aligned, span: Span) -> bool:
    return span.end_ms - span.start_ms < MIN_MS or _words(aligned.text(span)) < MIN_WORDS


def _merge_short(aligned: Aligned, spans: list[Span]) -> list[Span]:
    out = list(spans)
    i = 0
    while i < len(out):
        if not _short(aligned, out[i]):
            i += 1
            continue
        if i > 0 and _fits(aligned, _merged(out[i - 1], out[i])):
            out[i - 1:i + 1] = [_merged(out[i - 1], out[i])]
            i -= 1
            continue
        if i + 1 < len(out) and _fits(aligned, _merged(out[i], out[i + 1])):
            out[i:i + 2] = [_merged(out[i], out[i + 1])]
            continue
        i += 1
    return out


def finish(aligned: Aligned) -> list[Sentence]:
    spans: list[Span] = []
    for span in aligned.spans:
        spans += _split_long(aligned, span)
    spans = _merge_short(aligned, spans)
    out: list[Sentence] = []
    previous_end = 0
    for span in spans:
        start = max(span.start_ms, previous_end)
        end = max(span.end_ms, start)
        text = " ".join(aligned.text(span).split())
        if not text:
            continue
        out.append(Sentence(start, end, text))
        previous_end = end
    return out


def build(fragments: list[Fragment], *, adjust: Callable[[Aligned], None] | None = None) -> list[Sentence]:
    """align → optional in-place boundary adjustment (the transcription path snaps to silences) → finish."""
    aligned = align(fragments)
    if adjust is not None:
        adjust(aligned)
    return finish(aligned)


def set_span(aligned: Aligned, index: int, **changes) -> None:
    aligned.spans[index] = replace(aligned.spans[index], **changes)
