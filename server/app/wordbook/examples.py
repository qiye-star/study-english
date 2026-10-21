"""复习例句端口 ExampleProvider(plan L4 R13;INDEX §4 冻结名)。wordbook 拥有,L4 在此实现两种来源。

- DictionaryExampleProvider:包装 `quiz.cloze_example`,行为逐字不变(不查数据库)。
- LibraryExampleProvider:先取用户自己的库句子(ready、非低置信、没有 flags、6–16 个词、词形折叠后等于词头),
  候选最多 LIB_CANDIDATES 条按 (item_id, idx) 排序后,用独立哈希 sha256("example:{user}:{key}:{reps}") 取一个,
  不消耗 `quiz.question_rng`(干扰项与选项顺序与今天逐字相同)。找不到回落词典。
- provider_for(settings):ACTIVATION_ENABLED 与 LIBRARY_ENABLED 都开才用库来源。

只读 app.models;不导入库层与激活层(架构测试与 tests/test_wordbook_examples.py 守着)。
句子文字只在内存里;不记日志。
"""
import hashlib
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import and_, select

from app.models import LibraryItem, LibrarySegment, SegmentLemma
from app.wordbook import quiz
from app.wordbook.textnorm import find_form, fold, tokenize

LIB_CANDIDATES = 50
MIN_TOKENS = 6
MAX_TOKENS = 16


@dataclass(frozen=True)
class Clip:
    item_id: str
    start_ms: int
    end_ms: int


@dataclass(frozen=True)
class ContextExample:
    en: str
    zh: str | None
    start: int  # 目标词在 en 里的起止(字符)
    end: int
    clip: Clip | None  # 只有用户自己的库句子才有


class ExampleProvider(Protocol):
    async def cloze_example(self, session, user_id: int, card, reps: int) -> ContextExample | None: ...


class DictionaryExampleProvider:
    async def cloze_example(self, session, user_id: int, card, reps: int) -> ContextExample | None:
        found = quiz.cloze_example(card)
        if found is None:
            return None
        example, start, end = found
        return ContextExample(en=example.en, zh=example.zh, start=start, end=end, clip=None)


def _pick_index(user_id: int, key: str, reps: int, size: int) -> int:
    digest = hashlib.sha256(f"example:{user_id}:{key}:{reps}".encode()).digest()
    return int.from_bytes(digest[:8], "big") % size


class LibraryExampleProvider:
    def __init__(self, fallback: ExampleProvider | None = None) -> None:
        self._fallback = fallback or DictionaryExampleProvider()

    async def cloze_example(self, session, user_id: int, card, reps: int) -> ContextExample | None:
        found = await self._from_library(session, user_id, card, reps)
        if found is not None:
            return found
        return await self._fallback.cloze_example(session, user_id, card, reps)

    async def _from_library(self, session, user_id: int, card, reps: int) -> ContextExample | None:
        rows = (await session.execute(
            select(LibrarySegment.item_id, LibrarySegment.idx, LibrarySegment.text, LibrarySegment.zh,
                   LibrarySegment.start_ms, LibrarySegment.end_ms)
            .join(SegmentLemma, and_(SegmentLemma.scope == "lib", SegmentLemma.owner_id == LibrarySegment.item_id,
                                     SegmentLemma.idx == LibrarySegment.idx))
            .join(LibraryItem, LibraryItem.id == LibrarySegment.item_id)
            .where(SegmentLemma.lemma == card.key, SegmentLemma.idx >= 0,
                   LibraryItem.user_id == user_id, LibraryItem.status == "ready",
                   LibraryItem.low_confidence == False,  # noqa: E712 - portable boolean test
                   LibrarySegment.flags.is_(None))
            .order_by(LibrarySegment.item_id, LibrarySegment.idx)
            .limit(LIB_CANDIDATES))).all()
        valid = []
        for row in rows:
            tokens = len(tokenize(row.text))
            if not MIN_TOKENS <= tokens <= MAX_TOKENS:
                continue
            span = find_form(row.text, card.key)  # the text may have changed since the index was built
            if span is None or fold(span[2]) != card.key:
                continue  # only the headword itself is blanked, as in quiz.cloze_example
            valid.append((row, span))
        if not valid:
            return None
        row, span = valid[_pick_index(user_id, card.key, reps, len(valid))]
        return ContextExample(en=row.text, zh=row.zh, start=span[0], end=span[1],
                              clip=Clip(item_id=row.item_id, start_ms=row.start_ms, end_ms=row.end_ms))


def provider_for(settings) -> ExampleProvider:
    if getattr(settings, "activation_enabled", False) and getattr(settings, "library_enabled", False):
        return LibraryExampleProvider()
    return DictionaryExampleProvider()
