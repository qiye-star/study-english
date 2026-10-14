"""词元 → 句子(plan 2026-10-14-library-alignment-v2 §设计 3、R-V10/R-V11;纯函数)。

1. 句子文字仍由 `app.speech.sentence_split.split_all` 决定(不改它,与网页切句同一规则):词元按一个空格连接,每个句子从它首字符
   所在的词元开始(切点落在词元中间时,这个词元归前一句)。没有字母、被切句器丢掉的词元跟着前一句。
2. 句内长停顿断开:相邻两个有时间的词元间隔 >= 2 s,或 >= 1 s 且前一个词元以 `, ; : -` 结尾,两边各 >= 2 个词才断。
3. 超长(> 14 s 或 > 40 词)的句子在「最大的间隔」处断(同档时优先逗号等后面、再靠近中点),递归。
4. 短句(< 1 s 或 < 3 词)并到间隔更小的一侧,但间隔 > 700 ms 就不并(短句本身是合法的一句,不能跨音乐 / 长停顿拉长)。
5. 起止 = 首词起点 / 末词终点,再各加一点余量(前 40 ms、后 80 ms),每侧最多占到与相邻词间隔的 40%,所以句与句不重叠、
   也不伸进别人的词;每句至少 200 ms(网页微调的最小长度)但不越过下一个词;最后一句不超过素材长度。
"""
from bisect import bisect_right
from collections.abc import Sequence
from dataclasses import dataclass

from app.library.limits import SEGMENT_TEXT_MAX
from app.library.timeline import Token
from app.speech.sentence_split import split_all

MAX_MS = 14_000
MAX_WORDS = 40
MIN_MS = 1_000
MIN_WORDS = 3
HARD_PAUSE_MS = 2_000
SOFT_PAUSE_MS = 1_000
MIN_SPLIT_WORDS = 2
MERGE_GAP_MS = 700
PREFERRED_GAP_MS = 400
LEAD_PAD_MS = 40
TAIL_PAD_MS = 80
PAD_GAP_SHARE = 0.4
MIN_SPAN_MS = 200
CLAUSE_END = (",", ";", ":", "-", "–", "—")


@dataclass(frozen=True)
class Piece:
    first: int
    last: int  # inclusive


@dataclass(frozen=True)
class WordSentence:
    start_ms: int
    end_ms: int
    text: str
    first: int  # token range [first, last]
    last: int


def gap_after(tokens: Sequence[Token], k: int) -> int:
    """Silence between token k and token k + 1 (0 when they touch or overlap, or when k is the last)."""
    if k + 1 >= len(tokens):
        return 0
    return max(0, tokens[k + 1].start_ms - tokens[k].end_ms)


def _text(tokens: Sequence[Token], p: Piece) -> str:
    return " ".join(t.text for t in tokens[p.first:p.last + 1])


def _duration(tokens: Sequence[Token], p: Piece) -> int:
    return tokens[p.last].end_ms - tokens[p.first].start_ms


def _words(p: Piece) -> int:
    return p.last - p.first + 1


def text_pieces(tokens: Sequence[Token]) -> list[Piece]:
    if not tokens:
        return []
    starts: list[int] = []
    pos = 0
    for t in tokens:
        starts.append(pos)
        pos += len(t.text) + 1
    joined = " ".join(t.text for t in tokens)
    firsts = {0}
    cursor = 0
    for sentence in split_all(joined):
        at = joined.find(sentence, cursor)
        if at < 0:
            continue
        cursor = at + len(sentence)
        k = bisect_right(starts, at) - 1
        if starts[k] < at:  # the sentence starts inside a token: that token stays with the previous sentence
            k += 1
        if k < len(tokens):
            firsts.add(k)
    edges = sorted(firsts)
    return [Piece(a, b - 1) for a, b in zip(edges, edges[1:] + [len(tokens)])]


def _pause_cut(tokens: Sequence[Token], p: Piece) -> int | None:
    best: tuple[int, int] | None = None
    for k in range(p.first + MIN_SPLIT_WORDS - 1, p.last - MIN_SPLIT_WORDS + 1):
        if tokens[k].kind == "est" or tokens[k + 1].kind == "est":
            continue
        gap = gap_after(tokens, k)
        if gap >= HARD_PAUSE_MS or (gap >= SOFT_PAUSE_MS and tokens[k].text.endswith(CLAUSE_END)):
            if best is None or gap > best[0]:
                best = (gap, k)
    return None if best is None else best[1]


def split_pauses(tokens: Sequence[Token], p: Piece) -> list[Piece]:
    k = _pause_cut(tokens, p)
    if k is None:
        return [p]
    return split_pauses(tokens, Piece(p.first, k)) + split_pauses(tokens, Piece(k + 1, p.last))


def _too_long(tokens: Sequence[Token], p: Piece) -> bool:
    return _duration(tokens, p) > MAX_MS or _words(p) > MAX_WORDS


def split_long(tokens: Sequence[Token], p: Piece) -> list[Piece]:
    if not _too_long(tokens, p) or p.first == p.last:
        return [p]
    middle = (tokens[p.first].start_ms + tokens[p.last].end_ms) / 2
    lo, hi = p.first, p.last - 1
    if _words(p) >= 2 * MIN_SPLIT_WORDS:
        lo, hi = p.first + MIN_SPLIT_WORDS - 1, p.last - MIN_SPLIT_WORDS

    def score(k: int):
        gap = gap_after(tokens, k)
        return (gap >= PREFERRED_GAP_MS, tokens[k].text.endswith(CLAUSE_END + (".", "!", "?")), gap,
                -abs(tokens[k].end_ms - middle))

    k = max(range(lo, hi + 1), key=score)
    return split_long(tokens, Piece(p.first, k)) + split_long(tokens, Piece(k + 1, p.last))


def _short(tokens: Sequence[Token], p: Piece) -> bool:
    return _duration(tokens, p) < MIN_MS or _words(p) < MIN_WORDS


def _fits(tokens: Sequence[Token], p: Piece) -> bool:
    return not _too_long(tokens, p) and len(_text(tokens, p)) <= SEGMENT_TEXT_MAX


def merge_short(tokens: Sequence[Token], pieces: list[Piece]) -> list[Piece]:
    out = list(pieces)
    i = 0
    while i < len(out):
        p = out[i]
        if not _short(tokens, p):
            i += 1
            continue
        options = []
        if i > 0:
            options.append((gap_after(tokens, out[i - 1].last), i - 1))
        if i + 1 < len(out):
            options.append((gap_after(tokens, p.last), i))
        merged = False
        for gap, left in sorted(options):
            joined = Piece(out[left].first, out[left + 1].last)
            if gap <= MERGE_GAP_MS and _fits(tokens, joined):
                out[left:left + 2] = [joined]
                i = left
                merged = True
                break
        if not merged:
            i += 1
    return out


def sentences(tokens: Sequence[Token], limit_ms: int) -> list[WordSentence]:
    """Tokens (monotonic starts, see `timeline.monotonic`) -> sentences with padded, non-overlapping times."""
    pieces: list[Piece] = []
    for p in text_pieces(tokens):
        for q in split_pauses(tokens, p):
            pieces += split_long(tokens, q)
    pieces = merge_short(tokens, pieces)
    out: list[WordSentence] = []
    previous_end = 0
    for p in pieces:
        text = " ".join(_text(tokens, p).split())
        if not text:
            continue
        s, e = tokens[p.first].start_ms, tokens[p.last].end_ms
        before = s - tokens[p.first - 1].end_ms if p.first > 0 else s
        after = tokens[p.last + 1].start_ms - e if p.last + 1 < len(tokens) else max(0, limit_ms - e)
        start = max(previous_end, s - min(LEAD_PAD_MS, int(max(0, before) * PAD_GAP_SHARE)))
        end = e + min(TAIL_PAD_MS, int(max(0, after) * PAD_GAP_SHARE))
        if end - start < MIN_SPAN_MS:
            ceiling = tokens[p.last + 1].start_ms if p.last + 1 < len(tokens) else limit_ms
            end = max(end, min(start + MIN_SPAN_MS, ceiling))
        end = min(end, limit_ms) if limit_ms > start else end
        end = max(end, start + 1)
        out.append(WordSentence(start, end, text, p.first, p.last))
        previous_end = end
    return out
