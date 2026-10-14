"""词级时间线(plan 2026-10-14-library-alignment-v2 §设计 2、R-V2…R-V6;纯函数,只依赖标准库与本包)。

识别块 → 一串带绝对时间的「词元」(`Token`:识别句文字按空白切开的一段,带标点,例如 `world.`):
- 可信块(`asr_chunks.usable_utterances`)里的每个识别句:词元按字母对齐到识别服务给的 `words`(`align_words`)。对上的取词的
  起止(`kind="word"`);对不上的(数字规范化 `25` ↔ `twenty five`、符号)在左右最近的已知时间之间按字符数摊(`kind="interp"`);
  整句没有 `words`、或不到一半的词元对得上 → 全句在识别句的起止之间摊(`interp`,= v1 的真实时间路径)。
  识别服务夹在真实词之间的占位条目(时间 -1/-1)在解析时已丢掉;这里对旧文件再丢一次(时间为负的词不是词)。
- 不可信 / 只有文字的块:在 `speech_span` 里按字符数摊(`kind="est"`,= v1 的估算)。
- 硬切的块两两重叠(`plan_chunks(..., overlap_ms)`):`merge_seams` 在重叠窗口里找一个离两边所有词元中点都最远的时刻 T,左块留
  中点 < T 的、右块留中点 >= T 的;两边文字对不上 → 窗口里留下的词元 `seam=True`。有一边没有词级时间时按文字去重。
"""
from collections.abc import Sequence
from dataclasses import dataclass, replace
from difflib import SequenceMatcher

from app.library.asr_chunks import Chunk, Silence, speech_span, usable_utterances
from app.speech.timed import Utterance, Word

WORD_SLACK_MS = 300  # a word may stick out of its utterance by this much (rounding)
MIN_WORD_MATCH = 0.5  # fewer tokens than this share matched to words -> the utterance's words are not believed
EDGE_GUARD_MS = 400  # words this close to the edge of the audio sent may be cut: the seam is not placed there
SEAM_AGREEMENT = 0.6  # SequenceMatcher ratio of the two sides' words inside the overlap window
MAX_TEXT_OVERLAP = 20  # tokens compared when de-duplicating a seam by text


@dataclass(frozen=True)
class Token:
    text: str
    start_ms: int
    end_ms: int
    kind: str  # "word" (the recognizer's word times) | "interp" (spread between known times) | "est" (v1 estimate)
    seam: bool = False  # near a hard-cut seam whose two recognitions disagreed

    @property
    def mid_ms(self) -> float:
        return (self.start_ms + self.end_ms) / 2


def norm(text: str) -> str:
    return "".join(c for c in text.lower() if c.isalnum())


def align_words(tokens: Sequence[str], words: Sequence[Word]) -> list[tuple[int, int] | None]:
    """For every text token the (start, end) of the recognizer word(s) it was matched to, or None.

    1. Tokens and words are compared as whole normalized words (letters and digits, lower case), in order
       (`SequenceMatcher` over the two lists): "Hello," matches "hello".
    2. Between two matched pairs, a run of tokens and a run of words whose letters are the same when joined
       ("well-known" vs "well" + "known", "can not" vs "cannot") are matched by letter position.
    3. Everything else stays None (number normalization "$25" vs "twenty five", symbols): the caller spreads it.
    A token whose start would go back in time becomes None, so the result is monotonic."""
    tn = [norm(t) or f"#t{i}" for i, t in enumerate(tokens)]
    wn = [norm(w.text) or f"#w{j}" for j, w in enumerate(words)]
    out: list[tuple[int, int] | None] = [None] * len(tokens)
    pairs: list[tuple[int, int, int, int]] = []  # (token from, token to, word from, word to) of equal runs
    i0 = j0 = 0
    for a, b, size in SequenceMatcher(None, tn, wn, autojunk=False).get_matching_blocks():
        pairs.append((i0, a, j0, b))  # the unmatched gap before this block
        for k in range(size):
            out[a + k] = (words[b + k].start_ms, words[b + k].end_ms)
        i0, j0 = a + size, b + size
    for t_from, t_to, w_from, w_to in pairs:
        if t_from == t_to or w_from == w_to or "".join(tn[t_from:t_to]) != "".join(wn[w_from:w_to]):
            continue
        bounds: list[tuple[int, int, int]] = []  # (letter from, letter to, word index)
        pos = 0
        for j in range(w_from, w_to):
            bounds.append((pos, pos + len(wn[j]), j))
            pos += len(wn[j])
        pos = 0
        for i in range(t_from, t_to):
            lo, hi = pos, pos + len(tn[i])
            hit = [j for a, b, j in bounds if a < hi and lo < b]
            out[i] = (min(words[j].start_ms for j in hit), max(words[j].end_ms for j in hit))
            pos = hi
    last_start = -1
    for i, span in enumerate(out):
        if span is None:
            continue
        if span[0] < last_start:
            out[i] = None
            continue
        last_start = span[0]
    return out


def spread(texts: Sequence[str], start_ms: int, end_ms: int, kind: str) -> list[Token]:
    """Tokens laid end to end over [start, end] in proportion to their length (one character per joining space): the
    first starts at `start`, the last ends at `end` (the v1 character-share estimate)."""
    total = sum(len(t) for t in texts) + max(0, len(texts) - 1)
    span = max(0, end_ms - start_ms)
    out: list[Token] = []
    pos = 0
    for text in texts:
        s = start_ms + round(span * pos / max(1, total))
        e = start_ms + round(span * (pos + len(text)) / max(1, total))
        out.append(Token(text, s, max(s, e), kind))
        pos += len(text) + 1
    return out


def _fill(texts: list[str], spans: list[tuple[int, int] | None], lo: int, hi: int) -> list[Token]:
    """Matched tokens keep their word times; every run of unmatched ones is spread between its neighbours' times."""
    out: list[Token | None] = [Token(t, sp[0], sp[1], "word") if sp else None for t, sp in zip(texts, spans)]
    i = 0
    while i < len(out):
        if out[i] is not None:
            i += 1
            continue
        j = i
        while j < len(out) and out[j] is None:
            j += 1
        left = out[i - 1].end_ms if i > 0 else lo
        right = out[j].start_ms if j < len(out) else hi
        out[i:j] = spread(texts[i:j], left, max(left, right), "interp")
        i = j
    return [t for t in out if t is not None]


def utterance_tokens(u: Utterance, offset: int, length: int) -> list[Token]:
    """One recognizer sentence -> tokens in absolute ms (`offset` = chunk start; times clamped into the audio sent)."""
    texts = u.text.split()
    if not texts:
        return []
    spans: list[tuple[int, int] | None] = [None] * len(texts)
    words = [w for w in u.words if w.start_ms >= 0 and w.end_ms >= 0]  # -1/-1 placeholders are not words
    if words:
        spans = align_words(texts, words)
        lo, hi = u.start_ms - WORD_SLACK_MS, u.end_ms + WORD_SLACK_MS
        spans = [sp if sp is not None and lo <= sp[0] and sp[1] <= hi else None for sp in spans]
        if sum(1 for sp in spans if sp is not None) < MIN_WORD_MATCH * len(texts):
            spans = [None] * len(texts)
    tokens = _fill(texts, spans, u.start_ms, u.end_ms)

    def clamp(ms: int) -> int:
        return offset + max(0, min(length, ms))

    return [replace(t, start_ms=clamp(t.start_ms), end_ms=clamp(t.end_ms)) for t in tokens]


def chunk_tokens(chunk: Chunk, silences: list[Silence]) -> list[Token]:
    text = " ".join((chunk.text or "").split())
    if not text:
        return []
    length = chunk.end_ms - chunk.start_ms
    utts = usable_utterances(chunk)
    if utts:
        out: list[Token] = []
        for u in utts:
            if u.start_ms < length:
                out += utterance_tokens(u, chunk.start_ms, length)
        return out
    s0, s1 = speech_span(chunk, silences)
    return spread(text.split(), s0, s1, "est")


def has_words(chunks: Sequence[Chunk]) -> bool:
    """True when at least one trusted chunk carries word times: the word path (v2) applies; else v1 (R-V9)."""
    return any(u.words for c in chunks for u in usable_utterances(c))


def _seam_by_time(left: list[Token], right: list[Token], lo: int, hi: int) -> tuple[list[Token], list[Token]]:
    a = [t for t in left if t.mid_ms >= lo]
    b = [t for t in right if t.mid_ms <= hi]
    g_lo, g_hi = lo + EDGE_GUARD_MS, hi - EDGE_GUARD_MS
    if g_lo >= g_hi:
        g_lo, g_hi = lo, hi
    center = (lo + hi) / 2
    candidates = [g_lo, g_hi, center]
    for side in (a, b):
        candidates += [(x.end_ms + y.start_ms) / 2 for x, y in zip(side, side[1:])]
    candidates = [c for c in candidates if g_lo <= c <= g_hi]
    mids = [t.mid_ms for t in a + b]
    cut = max(candidates, key=lambda c: (min((abs(c - m) for m in mids), default=0.0), -abs(c - center)))
    kept_left = [t for t in left if t.mid_ms < cut]
    kept_right = [t for t in right if t.mid_ms >= cut]
    words_a = [norm(t.text) for t in a if g_lo <= t.mid_ms <= g_hi]
    words_b = [norm(t.text) for t in b if g_lo <= t.mid_ms <= g_hi]
    agree = (not words_a and not words_b) or (
        bool(words_a) and bool(words_b) and SequenceMatcher(None, words_a, words_b, autojunk=False).ratio() >= SEAM_AGREEMENT)
    if not agree:
        kept_left = [replace(t, seam=True) if t.mid_ms >= lo else t for t in kept_left]
        kept_right = [replace(t, seam=True) if t.mid_ms <= hi else t for t in kept_right]
    return kept_left, kept_right


def text_overlap(left: Sequence[str], right: Sequence[str]) -> int:
    """How many leading tokens of `right` repeat the trailing tokens of `left` (normalized; at least 2, else 0)."""
    a = [norm(t) for t in left[-MAX_TEXT_OVERLAP:]]
    b = [norm(t) for t in right[:MAX_TEXT_OVERLAP]]
    for k in range(min(len(a), len(b)), 1, -1):
        if a[-k:] == b[:k]:
            return k
    return 0


def _seam_by_text(left: list[Token], right: list[Token], lo: int, hi: int) -> tuple[list[Token], list[Token]]:
    k = text_overlap([t.text for t in left], [t.text for t in right])
    if k:
        return left, right[k:]
    left = [replace(t, seam=True) if t.mid_ms >= lo else t for t in left]
    right = [replace(t, seam=True) if t.mid_ms <= hi else t for t in right]
    return left, right


def merge_seams(chunks: Sequence[Chunk], per_chunk: Sequence[list[Token]]) -> list[Token]:
    out: list[Token] = []
    for k, tokens in enumerate(per_chunk):
        nxt = list(tokens)
        if k == 0 or not out or not nxt or chunks[k].start_ms >= chunks[k - 1].end_ms:
            out += nxt
            continue
        lo, hi = chunks[k].start_ms, chunks[k - 1].end_ms
        window = [t for t in out if t.mid_ms >= lo] + [t for t in nxt if t.mid_ms <= hi]
        if all(t.kind == "word" for t in window):
            out, nxt = _seam_by_time(out, nxt, lo, hi)
        else:
            out, nxt = _seam_by_text(out, nxt, lo, hi)
        out += nxt
    return out


def monotonic(tokens: Sequence[Token]) -> list[Token]:
    """Starts never go back; an end is never before its start (a later token may still start before an earlier one ends)."""
    out: list[Token] = []
    last = 0
    for t in tokens:
        s = max(t.start_ms, last)
        out.append(replace(t, start_ms=s, end_ms=max(t.end_ms, s)))
        last = s
    return out


def tokens_for(chunks: Sequence[Chunk], silences: list[Silence]) -> list[Token]:
    return monotonic(merge_seams(chunks, [chunk_tokens(c, silences) for c in chunks]))


def trim_text_overlaps(chunks: Sequence[Chunk]) -> list[Chunk]:
    """The v1 path for overlapping chunks that have no word times (R-V9): the right chunk starts where the left one ends
    and loses the leading words that repeat the left chunk's last words. Its utterances are dropped (they no longer
    match its text), so v1 estimates it."""
    out: list[Chunk] = []
    for c in chunks:
        if out and c.start_ms < out[-1].end_ms:
            prev = out[-1]
            words = (c.text or "").split()
            k = text_overlap((prev.text or "").split(), words)
            c = Chunk(prev.end_ms, c.end_ms, " ".join(words[k:]) if c.text is not None else None,
                      None if c.utterances is None else [])
        out.append(c)
    return out
