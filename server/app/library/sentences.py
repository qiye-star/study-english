"""识别结果 → 句子 + 每句标记 + 条目的 `low_confidence`(plan 2026-10-14-library-alignment-v2 R-V9;纯函数)。

流水线(首次识别、重新识别)与「重建句子」(`POST /items/{id}/rebuild`,不再花识别钱)共用这一个入口,所以算法改进只要重建就生效。
- 至少一个可信块带词级时间 → 词路径(`timeline` → `wordseg` → `quality.sentence_flags`);
- 否则 → v1 原样(`segment.build` + 静音吸附 + `quality.is_low_confidence`;重叠的块先按文字去重),每句没有标记。
"""
from collections.abc import Sequence
from dataclasses import dataclass

from app.library import asr_chunks, quality, segment, timeline, wordseg
from app.library.asr_chunks import Chunk, Silence

WORDS = "words"
V1 = "v1"


@dataclass(frozen=True)
class Built:
    sentences: list[segment.Sentence]
    flags: list[tuple[str, ...]]  # one entry per sentence (empty tuples on the v1 path)
    low_confidence: bool
    algorithm: str  # WORDS | V1 (logged as a constant, never with text)


def build(chunks: Sequence[Chunk], silences: list[Silence]) -> Built:
    chunks = list(chunks)
    if timeline.has_words(chunks):
        tokens = timeline.tokens_for(chunks, silences)
        limit = max((c.end_ms for c in chunks), default=0)
        found = wordseg.sentences(tokens, limit)
        flags = quality.sentence_flags(tokens, found)
        out = [segment.Sentence(s.start_ms, s.end_ms, s.text) for s in found]
        return Built(out, flags, quality.item_low_confidence(flags), WORDS)
    return build_v1(chunks, silences)


def build_v1(chunks: Sequence[Chunk], silences: list[Silence]) -> Built:
    """The v1 algorithm, unchanged (also used by `scripts/library_alignment_eval.py` to compare on the same transcript)."""
    plain = timeline.trim_text_overlaps(list(chunks))
    found = segment.build(asr_chunks.fragments(plain, silences), adjust=asr_chunks.snapper(silences))
    return Built(found, [() for _ in found], quality.is_low_confidence(found, plain, silences), V1)
