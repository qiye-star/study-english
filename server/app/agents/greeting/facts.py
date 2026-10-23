"""Learning data for the daily greeting (plan 2026-10-23 R3).

Each source opens its own read-only session, answers within SOURCE_TIMEOUT_MS and returns a dict of GreetingFacts fields
(or None when it has nothing to say; zero counts are None). gather() runs all sources in parallel under TOTAL_BUDGET_MS;
a slow or failing source is skipped (only its key and the exception class name are logged, never data).
Words live in memory only: chat_greetings.facts stores the numbers (GreetingFacts.numbers()).
Sources that need the dictionary (wordbook) are registered by app/links/greeting_facts.py."""
import asyncio
import logging
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Protocol

from sqlalchemy import func, select

from app.models import Assessment, Conversation, LinkMistakeWord, Message, VocabularyItem
from app.services import stats

log = logging.getLogger(__name__)

SOURCE_TIMEOUT_MS = 300
TOTAL_BUDGET_MS = 600
WORD_MAX = 3  # words that may reach the prompt, the slip pair counts as one
WORD_CHARS = 32
SLIP_CHARS = 16
ROWS_MAX = 200


@dataclass(frozen=True)
class FactCtx:
    user_id: int
    offset: int  # tz_offset_minutes
    now: datetime
    local_date: date


@dataclass(frozen=True)
class GreetingFacts:
    streak: int | None = None
    due: int | None = None  # words due for review today
    wordbook_streak: int | None = None
    slip_category: str | None = None  # a stats grammar category of yesterday's most common slip
    slip_count: int | None = None
    slip_wrong: str | None = None  # at most SLIP_CHARS each, both or neither
    slip_right: str | None = None
    wrong_words: int | None = None  # word-review answers wrong yesterday
    pron_words: int | None = None  # words with weak pronunciation yesterday
    words: tuple[str, ...] = field(default_factory=tuple)

    @property
    def yesterday_mistakes(self) -> int:
        return (self.slip_count or 0) + (self.wrong_words or 0) + (self.pron_words or 0)

    def numbers(self) -> dict:
        """The API / storage shape: numbers only, a missing item is a missing key."""
        out = {"streak": self.streak, "due": self.due, "yesterday_mistakes": self.yesterday_mistakes or None}
        return {k: v for k, v in out.items() if v}


class FactSource(Protocol):
    key: str

    async def load(self, ctx: FactCtx) -> dict | None: ...


class FactsRegistry:
    def __init__(self) -> None:
        self._sources: dict[str, FactSource] = {}

    def register(self, source: FactSource) -> None:
        self._sources[source.key] = source  # same key replaces: installing twice is a no-op

    def sources(self) -> list[FactSource]:
        return list(self._sources.values())


def _clip(word: object, limit: int = WORD_CHARS) -> str | None:
    text = word.strip() if isinstance(word, str) else ""
    return text if text and len(text) <= limit else None


def yesterday_window(ctx: FactCtx) -> tuple[datetime, datetime]:
    return (stats.local_midnight_utc(ctx.local_date - timedelta(days=1), ctx.offset),
            stats.local_midnight_utc(ctx.local_date, ctx.offset))


class _Source:
    def __init__(self, app):
        self.app = app


class Streak(_Source):
    """Same rule as /api/stats: a local day is active with a user message or an assessment."""
    key = "streak"

    async def load(self, ctx: FactCtx) -> dict | None:
        since = stats.local_midnight_utc(ctx.local_date - timedelta(days=stats.SCAN_DAYS), ctx.offset)
        async with self.app.state.sessionmaker() as s:
            messages = (await s.scalars(
                select(Message.created_at).join(Conversation, Conversation.id == Message.conversation_id)
                .where(Conversation.user_id == ctx.user_id, Message.role == "user", Message.created_at >= since)
                .order_by(Message.created_at.desc()).limit(stats.MAX_STATS_MESSAGES))).all()
            assessments = (await s.scalars(
                select(Assessment.created_at)
                .where(Assessment.user_id == ctx.user_id, Assessment.created_at >= since)
                .order_by(Assessment.created_at.desc()).limit(stats.MAX_STATS_ASSESSMENTS))).all()
        active = {stats.local_date(at, ctx.offset) for at in (*messages, *assessments)}
        days = stats.streak(active, ctx.local_date)
        return {"streak": days} if days else None


class DueVocab(_Source):
    key = "due_vocab"

    async def load(self, ctx: FactCtx) -> dict | None:
        async with self.app.state.sessionmaker() as s:
            count = await s.scalar(select(func.count()).select_from(VocabularyItem)
                                   .where(VocabularyItem.user_id == ctx.user_id, VocabularyItem.due_at <= ctx.now))
        return {"due": int(count)} if count else None


class YesterdayGrammar(_Source):
    """Most common grammar category among yesterday's user messages, with the latest short original -> corrected pair."""
    key = "yesterday_grammar"

    async def load(self, ctx: FactCtx) -> dict | None:
        start, end = yesterday_window(ctx)
        async with self.app.state.sessionmaker() as s:
            rows = (await s.scalars(
                select(Message.grammar).join(Conversation, Conversation.id == Message.conversation_id)
                .where(Conversation.user_id == ctx.user_id, Message.role == "user", Message.created_at >= start,
                       Message.created_at < end, Message.grammar.is_not(None))
                .order_by(Message.created_at.desc(), Message.id.desc()).limit(ROWS_MAX))).all()
        counts: Counter = Counter()
        for grammar in rows:
            counts.update(stats.grammar_categories(grammar))
        if not counts:
            return None
        category, count = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0]
        out: dict = {"slip_category": category, "slip_count": count}
        for grammar in rows:  # newest first
            for entry in grammar.get("errors", []) if isinstance(grammar, dict) else []:
                if not isinstance(entry, dict) or entry.get("category") != category:
                    continue
                wrong, right = _clip(entry.get("original"), SLIP_CHARS), _clip(entry.get("corrected"), SLIP_CHARS)
                if wrong and right and wrong != right:
                    return {**out, "slip_wrong": wrong, "slip_right": right}
        return out


class YesterdayPron(_Source):
    key = "yesterday_pron"

    async def load(self, ctx: FactCtx) -> dict | None:
        start, end = yesterday_window(ctx)
        async with self.app.state.sessionmaker() as s:
            results = (await s.scalars(
                select(Assessment.result)
                .where(Assessment.user_id == ctx.user_id, Assessment.created_at >= start, Assessment.created_at < end)
                .order_by(Assessment.created_at.desc()).limit(ROWS_MAX))).all()
        counts: Counter = Counter()
        for result in results:
            counts.update(stats.poor_words(result))
        if not counts:
            return None
        ranked = [w for w, _ in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]
        return {"pron_words": len(ranked), "words": [w for w in map(_clip, ranked[:WORD_MAX]) if w]}


class YesterdayWrong(_Source):
    key = "yesterday_wrong"

    async def load(self, ctx: FactCtx) -> dict | None:
        start, end = yesterday_window(ctx)
        where = (LinkMistakeWord.user_id == ctx.user_id, LinkMistakeWord.last_wrong_at >= start,
                 LinkMistakeWord.last_wrong_at < end)
        async with self.app.state.sessionmaker() as s:
            count = await s.scalar(select(func.count()).select_from(LinkMistakeWord).where(*where))
            if not count:
                return None
            words = (await s.scalars(select(LinkMistakeWord.word).where(*where)
                                     .order_by(LinkMistakeWord.wrong_count.desc(), LinkMistakeWord.word)
                                     .limit(WORD_MAX))).all()
        return {"wrong_words": int(count), "words": [w for w in map(_clip, words) if w]}


def facts_registry(app) -> FactsRegistry:
    """The one registry per app (app.state.greeting_facts), built with the built-in sources."""
    registry = getattr(app.state, "greeting_facts", None)
    if registry is None:
        registry = app.state.greeting_facts = FactsRegistry()
        for source in (Streak(app), DueVocab(app), YesterdayGrammar(app), YesterdayPron(app), YesterdayWrong(app)):
            registry.register(source)
    return registry


async def _run(source: FactSource, ctx: FactCtx) -> dict | None:
    try:
        return await asyncio.wait_for(source.load(ctx), SOURCE_TIMEOUT_MS / 1000)
    except asyncio.TimeoutError:
        log.info("greeting facts source skipped key=%s reason=timeout", source.key)
    except Exception as exc:  # noqa: BLE001 - a broken source must not break the greeting
        log.warning("greeting facts source failed key=%s error=%s", source.key, type(exc).__name__)
    return None


async def gather(app, ctx: FactCtx) -> GreetingFacts:
    """Run every source in parallel (per source 300 ms, total 600 ms); merge what came back."""
    sources = facts_registry(app).sources()
    tasks = [asyncio.ensure_future(_run(src, ctx)) for src in sources]
    done, pending = await asyncio.wait(tasks, timeout=TOTAL_BUDGET_MS / 1000)
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
        log.info("greeting facts budget exceeded skipped=%d", len(pending))
    merged: dict = {}
    words: list[str] = []
    for task in tasks:
        result = task.result() if task in done and not task.cancelled() else None
        for key, value in (result or {}).items():
            if key == "words":
                words.extend(w for w in value if w not in words)
            elif key in ("due", "wordbook_due"):
                merged["due"] = max(merged.get("due") or 0, value)  # wordbook and vocabulary overlap: never add
            else:
                merged.setdefault(key, value)
    slots = WORD_MAX - (1 if merged.get("slip_wrong") else 0)
    known = {f for f in GreetingFacts.__dataclass_fields__ if f != "words"}
    return GreetingFacts(**{k: v for k, v in merged.items() if k in known}, words=tuple(words[:slots]))


def focus_hint(facts: GreetingFacts) -> str:
    """fix_slip | review | free_talk (prompt and template share the rule, plan §6.1)."""
    if facts.slip_category or facts.wrong_words or facts.pron_words:
        return "fix_slip"
    return "review" if facts.due else "free_talk"
