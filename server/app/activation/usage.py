"""使用记录处理器(plan L4 Task 6 / R6、R7、R9)。

- chat(`MessageSent`)与 realtime(`RealtimeTurnFinished`):主动使用 → use_count、session_count、sources。
- shadow(`AssessmentFinished`,source ∈ practice / library):跟读里的词只记 shadow_count(R7),不算主动使用。
- 只写 `word_usage`。永远不写 `vocabulary_items` 的调度列(R9:用过 ≠ 记得)。
- 只读取已学词(`vocabulary_items.source LIKE 'wordbook:%'`),与候选原形求交;单查询 ≤ 200 个候选。
- 日志与计数名里没有词、文本、用户 id;会话只存 sha256 前 16 位。
"""
import functools
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.activation import matcher
from app.activation.states import session_key
from app.core.learning_events import AssessmentFinished, MessageSent, RealtimeTurnFinished
from app.models import VocabularyItem, WordUsage
from app.wordbook.lookup import lookup_service

FLAG = "activation_enabled"
SHADOW_SOURCES = ("practice", "library")  # R7: chat-source assessments are ignored (the message already counted)
SOURCES_MAX = 32


def _add_source(current: str | None, source: str) -> str:
    parts = [p for p in (current or "").split(",") if p]
    if source not in parts:
        parts.append(source)
    return ",".join(parts)[:SOURCES_MAX]


async def _lemma_of(app):
    service = lookup_service(app)
    await service.forms.warm()
    return service.forms.lemma_of


async def _learned_hits(app, user_id: int, text: str) -> set[str]:
    """文本里出现的已学词(词头)。文本只在内存里参与求交,不落库、不记日志。"""
    found, truncated = matcher.candidates(text, await _lemma_of(app))
    if truncated:
        app.state.learning_bus.count("activation.usage", "truncated")
    if not found:
        return set()
    async with app.state.sessionmaker() as session:
        rows = await session.scalars(select(VocabularyItem.word).where(
            VocabularyItem.user_id == user_id, VocabularyItem.source.like("wordbook:%"),
            VocabularyItem.word.in_(sorted(found))))
        return set(rows.all())


async def _record_active(app, user_id: int, lemmas: set[str], *, source: str, session_id: str, at: datetime,
                         retry: bool = True) -> None:
    key = session_key("conv", session_id)
    async with app.state.sessionmaker() as session:
        existing = {r.lemma: r for r in (await session.scalars(select(WordUsage).where(
            WordUsage.user_id == user_id, WordUsage.lemma.in_(sorted(lemmas))))).all()}
        for lemma in sorted(lemmas):
            row = existing.get(lemma)
            if row is None:
                session.add(WordUsage(user_id=user_id, lemma=lemma, first_used_at=at, last_used_at=at, use_count=1,
                                      shadow_count=0, session_count=1, last_session=key, sources=source))
                continue
            row.use_count = (row.use_count or 0) + 1
            row.last_used_at = at
            if row.last_session != key:
                row.session_count = (row.session_count or 0) + 1
                row.last_session = key
            row.sources = _add_source(row.sources, source)
        try:
            await session.commit()
        except IntegrityError:  # a concurrent first insert of the same lemma: one retry sees the winner's row
            await session.rollback()
            if not retry:
                raise
            await _record_active(app, user_id, lemmas, source=source, session_id=session_id, at=at, retry=False)


async def _record_shadow(app, user_id: int, lemmas: set[str], *, at: datetime, retry: bool = True) -> None:
    async with app.state.sessionmaker() as session:
        existing = {r.lemma: r for r in (await session.scalars(select(WordUsage).where(
            WordUsage.user_id == user_id, WordUsage.lemma.in_(sorted(lemmas))))).all()}
        for lemma in sorted(lemmas):
            row = existing.get(lemma)
            if row is None:
                session.add(WordUsage(user_id=user_id, lemma=lemma, first_used_at=at, last_used_at=at, use_count=0,
                                      shadow_count=1, session_count=0, last_session=None, sources="shadow"))
                continue
            row.shadow_count = (row.shadow_count or 0) + 1
            row.sources = _add_source(row.sources, "shadow")
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            if not retry:
                raise
            await _record_shadow(app, user_id, lemmas, at=at, retry=False)


async def handle_chat(app, event: MessageSent) -> None:
    hits = await _learned_hits(app, event.user_id, event.text)
    if hits:
        await _record_active(app, event.user_id, hits, source="chat", session_id=event.conversation_id, at=event.at)
    app.state.learning_bus.count("activation.chat", "matched", len(hits))


async def handle_realtime(app, event: RealtimeTurnFinished) -> None:
    hits = await _learned_hits(app, event.user_id, event.text)
    if hits:
        await _record_active(app, event.user_id, hits, source="realtime", session_id=event.conversation_id,
                             at=event.at)
    app.state.learning_bus.count("activation.realtime", "matched", len(hits))


async def handle_shadow(app, event: AssessmentFinished) -> None:
    if event.source not in SHADOW_SOURCES:
        return
    words = [*event.good_words, *(w.word for w in event.weak_words)]
    hits = await _learned_hits(app, event.user_id, " ".join(words)) if words else set()
    if hits:
        await _record_shadow(app, event.user_id, hits, at=event.at)
    app.state.learning_bus.count("activation.shadow", "matched", len(hits))


def install(app, bus) -> None:
    bus.subscribe(MessageSent, "activation.chat", functools.partial(handle_chat, app), flag=FLAG)
    bus.subscribe(RealtimeTurnFinished, "activation.realtime", functools.partial(handle_realtime, app), flag=FLAG)
    bus.subscribe(AssessmentFinished, "activation.shadow", functools.partial(handle_shadow, app), flag=FLAG)
