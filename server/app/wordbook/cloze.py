"""按句拼写 · 模式 A 的句组(spec §6.6):第一阶段用数据集例句,一句只挖目标词,多词词头拆成连续空。纯函数。

无状态(P-W2):提交时客户端只回传 (key, sentence_id),用 `line_for(card, sentence_id)` 从词卡重新算出答案。
"""
import hashlib
from dataclasses import dataclass
from typing import Literal

from app.wordbook.entry import Example, WordCard
from app.wordbook.textnorm import find_form, fold, tokenize

MIN_LINES, MAX_LINES = 3, 6


@dataclass(frozen=True)
class Segment:
    t: Literal["text", "blank"]
    v: str = ""
    i: int = -1
    len: int = 0


@dataclass(frozen=True)
class ClozeLine:
    key: str
    sentence_id: str
    segments: tuple[Segment, ...]
    zh: str
    expected: tuple[str, ...]
    lemmas: tuple[str, ...]


@dataclass(frozen=True)
class ClozeSet:
    set_id: str
    lines: tuple[ClozeLine, ...]


def _rank(example: Example, key: str) -> tuple[int, int, int]:
    span = find_form(example.en, key)
    n = len(tokenize(example.en))
    exact = span is not None and fold(span[2]) == key
    return (0 if exact else 1, 0 if 8 <= n <= 16 else 1, abs(n - 12))


def best_example(card: WordCard) -> Example | None:
    """原形优先,其次变形;8–16 词优先,再取最接近 12 词的;平手取词卡里靠前的。"""
    usable = [e for e in card.examples if find_form(e.en, card.key)]
    return min(usable, key=lambda e: _rank(e, card.key)) if usable else None


def line_for(card: WordCard, sentence_id: str | None = None, *, start: int = 0) -> ClozeLine | None:
    if not card.spellable:
        return None
    example = best_example(card) if sentence_id is None else next(
        (e for e in card.examples if e.id == sentence_id), None)
    if example is None:
        return None
    span = find_form(example.en, card.key)
    if span is None:
        return None
    begin, end, _ = span
    words = [t for t in tokenize(example.en[begin:end])]
    segments: list[Segment] = [Segment("text", example.en[:begin])] if begin else []
    cursor = begin
    for j, token in enumerate(words):
        if j:
            segments.append(Segment("text", example.en[cursor: begin + token.start]))
        segments.append(Segment("blank", i=start + j, len=len(token.text)))
        cursor = begin + token.end
    if end < len(example.en):
        segments.append(Segment("text", example.en[end:]))
    return ClozeLine(card.key, example.id, tuple(segments), example.zh, tuple(t.text for t in words),
                     tuple(card.key.split()))


def set_id_for(lines: list[ClozeLine] | tuple[ClozeLine, ...]) -> str:
    raw = "|".join(f"{line.key}:{line.sentence_id}" for line in lines)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def build_set(cards: list[WordCard], *, size: int = 5) -> ClozeSet | None:
    """按 cards 顺序取能出题的词,每词一句、组内句子不重复;空从 0 连续编号。少于 MIN_LINES 句返回 None。"""
    size = max(MIN_LINES, min(size, MAX_LINES))
    lines: list[ClozeLine] = []
    used: set[str] = set()
    next_blank = 0
    for card in cards:
        line = line_for(card, start=next_blank)
        if line is None or line.sentence_id in used:
            continue
        lines.append(line)
        used.add(line.sentence_id)
        next_blank += len(line.expected)
        if len(lines) == size:
            break
    if len(lines) < MIN_LINES:
        return None
    return ClozeSet(set_id_for(lines), tuple(lines))
