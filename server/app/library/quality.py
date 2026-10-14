"""句边界的合理性检查(spec §4.3.4、裁定 R-Q1;纯函数)。

不是判官,只是给学习者一个提示:这条素材的句边界可能不准(列表与播放页显示「可重新识别或微调」)。两条规则,任一成立即可疑:
1. 某个够长(≥ 20 个字符,含空格)的句子,字符速度 < 6 或 > 25 字符 / 秒。正常语速约 12–17,慢速教学音频约 7–9;
   用户那条素材 62 个字符被摊成 13 s = 4.8 字符 / 秒,会被抓到。
2. 某个**估算**块(识别服务没给可信的时间)里说话占比(`speech_span` / 块长)< 40%。
有可信真实时间的块不看说话占比:背景音乐 + 少量人声是合法的。
v2(plan 2026-10-14-library-alignment-v2):有词级时间时改用 `sentence_flags` + `item_low_confidence`(按这条素材自己的分布判断,每句给标记);上面两条只用于 v1 路径。
"""
import math
from collections.abc import Sequence

from app.library.asr_chunks import Chunk, Silence, estimated_chunks, speech_span
from app.library.segment import Sentence
from app.library.timeline import Token, norm
from app.library.wordseg import WordSentence, gap_after

MIN_CHARS = 20
MIN_CPS = 6.0
MAX_CPS = 25.0
MIN_SPEECH_SHARE = 0.4


def rate_outliers(sentences: Sequence[Sentence]) -> int:
    count = 0
    for s in sentences:
        if len(s.text) < MIN_CHARS:
            continue
        seconds = (s.end_ms - s.start_ms) / 1000
        if seconds <= 0 or not MIN_CPS <= len(s.text) / seconds <= MAX_CPS:
            count += 1
    return count


def estimated_share(chunk: Chunk, silences: list[Silence]) -> float:
    s0, s1 = speech_span(chunk, silences)
    return (s1 - s0) / max(1, chunk.end_ms - chunk.start_ms)


def is_low_confidence(sentences: Sequence[Sentence], chunks: list[Chunk], silences: list[Silence]) -> bool:
    if rate_outliers(sentences) > 0:
        return True
    return any(estimated_share(c, silences) < MIN_SPEECH_SHARE for c in estimated_chunks(chunks))


# ---- v2: per-sentence flags from word times, judged against the item's own distribution (plan v2 R-V13/R-V14) ----

FLAG_RATE = "rate"  # articulation rate far from this speaker's own median (robust z)
FLAG_PAUSE = "pause"  # a pause > 1.5 s is still inside the sentence
FLAG_TIMING = "timing"  # >= 30 % of its words have untrustworthy times (unmatched, zero-length, duration outliers)
FLAG_ESTIMATED = "estimated"  # some words have no recognizer time at all (v1 estimate)
FLAG_SEAM = "seam"  # touches a hard-cut seam where the two recognitions disagreed
FLAG_ORDER = (FLAG_RATE, FLAG_PAUSE, FLAG_TIMING, FLAG_ESTIMATED, FLAG_SEAM)
ROBUST_Z = 3.5
MAD_FLOOR = 0.05  # natural-log units: a perfectly even speaker must not turn every small wobble into an outlier
MIN_RATE_CHARS = 12
MIN_RATE_SAMPLES = 8
FALLBACK_CPS = (5.0, 35.0)  # too few sentences for a distribution: only absurd rates are flagged
ARTICULATION_GAP_MS = 300  # gaps longer than this are pauses, not speech, when measuring the rate
PAUSE_FLAG_MS = 1_500
MIN_WORD_SAMPLES = 20
SUSPECT_SHARE = 0.3
ITEM_FLAG_SHARE = 0.15  # the item is low confidence when at least this share of its sentences is flagged


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    n = len(ordered)
    return ordered[n // 2] if n % 2 else (ordered[n // 2 - 1] + ordered[n // 2]) / 2


def robust_z(values: list[float]) -> list[float]:
    """0.6745 * (x - median) / MAD, with the MAD floored at `MAD_FLOOR` ([] for no values)."""
    if not values:
        return []
    med = _median(values)
    mad = max(_median([abs(v - med) for v in values]), MAD_FLOOR)
    return [0.6745 * (v - med) / mad for v in values]


def articulation_cps(tokens: Sequence[Token], first: int, last: int) -> float | None:
    """Characters (spaces included) per second of speech: the span minus every inner gap > 300 ms."""
    span = tokens[last].end_ms - tokens[first].start_ms
    pauses = sum(g for g in (gap_after(tokens, k) for k in range(first, last)) if g > ARTICULATION_GAP_MS)
    speech = span - pauses
    if speech <= 0:
        return None
    chars = len(" ".join(t.text for t in tokens[first:last + 1]))
    return chars / (speech / 1000)


def suspect_tokens(tokens: Sequence[Token]) -> list[bool]:
    """Per token: is its time untrustworthy? `interp` always; a `word` when it has no length or (with >= 20 words of
    two or more letters) its milliseconds per letter is a robust outlier of this item; `est` is judged separately."""
    suspect = [t.kind == "interp" or (t.kind == "word" and t.end_ms <= t.start_ms) for t in tokens]
    sample = [(i, math.log((t.end_ms - t.start_ms) / len(norm(t.text)))) for i, t in enumerate(tokens)
              if t.kind == "word" and t.end_ms > t.start_ms and len(norm(t.text)) >= 2]
    if len(sample) >= MIN_WORD_SAMPLES:
        for (i, _v), z in zip(sample, robust_z([v for _i, v in sample])):
            if abs(z) > ROBUST_Z:
                suspect[i] = True
    return suspect


def sentence_flags(tokens: Sequence[Token], sentences: Sequence[WordSentence]) -> list[tuple[str, ...]]:
    """`sentences` are `wordseg.sentences(tokens, ...)`. Returns the flags of each, in `FLAG_ORDER`."""
    flags: list[set[str]] = [set() for _ in sentences]
    suspect = suspect_tokens(tokens)
    rates: list[tuple[int, float]] = []
    for n, s in enumerate(sentences):
        part = tokens[s.first:s.last + 1]
        if any(t.kind == "est" for t in part):
            flags[n].add(FLAG_ESTIMATED)
        if any(t.seam for t in part):
            flags[n].add(FLAG_SEAM)
        if max((gap_after(tokens, k) for k in range(s.first, s.last)), default=0) > PAUSE_FLAG_MS:
            flags[n].add(FLAG_PAUSE)
        if sum(suspect[s.first:s.last + 1]) >= SUSPECT_SHARE * len(part):
            flags[n].add(FLAG_TIMING)
        if FLAG_ESTIMATED not in flags[n] and len(s.text) >= MIN_RATE_CHARS:
            cps = articulation_cps(tokens, s.first, s.last)
            if cps is None:
                flags[n].add(FLAG_RATE)
            else:
                rates.append((n, cps))
    if len(rates) >= MIN_RATE_SAMPLES:
        for (n, _cps), z in zip(rates, robust_z([math.log(c) for _n, c in rates])):
            if abs(z) > ROBUST_Z:
                flags[n].add(FLAG_RATE)
    else:
        for n, cps in rates:
            if not FALLBACK_CPS[0] <= cps <= FALLBACK_CPS[1]:
                flags[n].add(FLAG_RATE)
    return [tuple(f for f in FLAG_ORDER if f in got) for got in flags]


def item_low_confidence(flags: Sequence[tuple[str, ...]]) -> bool:
    return bool(flags) and sum(1 for f in flags if f) / len(flags) >= ITEM_FLAG_SHARE
