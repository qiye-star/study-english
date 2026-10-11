"""智能体的学习数据来源(spec 2026-10-12-agents §3.3、§4.6;裁定 R-A1;计划 R-C19、R-C20)。

links 是可读 wordbook 的顶层,所以这些来源在这里实现,由 main.create_app 注册进 app.state.agents.registry。
不受 LINKS_ENABLED 控制:只受 AGENTS_ENABLED(路由)与用户 / 角色的工具开关(agents.context.enabled)控制。
全部 private=True(读个人数据;联机里只在 share_in_rooms 时运行,过程只给提问者)。
只读、不写库、不记日志;词只进 SSE 的 step.params 与提示词。异常由 agents.context.prefetch 只记来源键与类名。"""
from datetime import timedelta

from sqlalchemy import func, select

from app.agents.context import SourceCtx, SourceResult
from app.agents.orchestrator import runtime
from app.models import LinkMistakeWord, LinkWeakWord, VocabularyItem, WordbookEvent, utcnow
from app.wordbook.entry import headword_key, meaning_line
from app.wordbook.index import DataUnavailable, dictionary
from app.wordbook.store import active_enrollment
from app.wordbook.textnorm import fold, lemma_candidates, tokenize

LEARNED_DAYS = 7
LEARNED_MAX = 12
WEAK_MAX = 8
PRON_MAX = 5
DUE_MAX = 10
LOOKUP_MAX = 3
LOOKUP_TOKENS_MAX = 8
LOOKUP_TOKEN_MIN = 4
PARAM_WORDS = 5
STOPWORDS = frozenset(
    "about above after again also always because been before being below between both could does doing down during "
    "each even every from have having here into just like little made make many more most much must never only other "
    "over said same should since some such than that their them then there these they thing think this those "
    "through very want well were what when where which while will with would your yours".split())


def _result(key: str, words: list[str], block: str) -> SourceResult | None:
    if not words:
        return None
    return SourceResult(f"agents.step.{key}", {"count": len(words), "words": words[:PARAM_WORDS]}, block)


class _Source:
    private = True

    def __init__(self, app):
        self.app = app


class LearnedWords(_Source):
    key = "learned_words"

    async def load(self, ctx: SourceCtx) -> SourceResult | None:
        since = utcnow() - timedelta(days=LEARNED_DAYS)
        last = func.max(WordbookEvent.created_at)
        async with self.app.state.sessionmaker() as s:
            rows = (await s.execute(
                select(WordbookEvent.word, last)
                .where(WordbookEvent.user_id == ctx.user_id, WordbookEvent.kind.in_(("learn", "relearn")),
                       WordbookEvent.created_at >= since)
                .group_by(WordbookEvent.word).order_by(last.desc()).limit(LEARNED_MAX))).all()
        words = [r[0] for r in rows]
        return _result(self.key, words, "Words the learner learned in the last 7 days (reuse one naturally if it "
                                        "fits; never list them): " + ", ".join(words))


class WeakWords(_Source):
    key = "weak_words"

    async def load(self, ctx: SourceCtx) -> SourceResult | None:
        async with self.app.state.sessionmaker() as s:
            wrong = list((await s.scalars(
                select(LinkMistakeWord.word)
                .where(LinkMistakeWord.user_id == ctx.user_id, LinkMistakeWord.cleared_at.is_(None))
                .order_by(LinkMistakeWord.wrong_count.desc(), LinkMistakeWord.last_wrong_at.desc(), LinkMistakeWord.word)
                .limit(WEAK_MAX))).all())
            pron = list((await s.scalars(
                select(LinkWeakWord.word)
                .where(LinkWeakWord.user_id == ctx.user_id, LinkWeakWord.cleared_at.is_(None))
                .order_by(LinkWeakWord.hits.desc(), LinkWeakWord.last_weak_at.desc(), LinkWeakWord.word)
                .limit(PRON_MAX))).all())
        parts = []
        if wrong:
            parts.append("often answered wrong: " + ", ".join(wrong))
        if pron:
            parts.append("often mispronounced: " + ", ".join(pron))
        words = list(dict.fromkeys([*wrong, *pron]))
        return _result(self.key, words, "The learner's weak words (practise gently, never list them) — "
                                        + "; ".join(parts))


class DueWords(_Source):
    key = "due_words"

    async def load(self, ctx: SourceCtx) -> SourceResult | None:
        async with self.app.state.sessionmaker() as s:
            rows = (await s.scalars(
                select(VocabularyItem.word)
                .where(VocabularyItem.user_id == ctx.user_id, VocabularyItem.due_at <= utcnow())
                .order_by(VocabularyItem.due_at, VocabularyItem.id).limit(DUE_MAX * 2))).all()
        words = list(dict.fromkeys(rows))[:DUE_MAX]
        return _result(self.key, words, "Words due for review today (a natural chance to reuse one is welcome): "
                                        + ", ".join(words))


def candidates(text: str) -> list[tuple[str, list[str]]]:
    """(词形, 规范化的原形候选) 列表:长度 ≥ 4、非常用虚词、去重,最多 8 个(纯函数)。"""
    out: list[tuple[str, list[str]]] = []
    seen: set[str] = set()
    for token in tokenize(text):
        form = fold(token.text)
        if len(form) < LOOKUP_TOKEN_MIN or form in STOPWORDS or form in seen or not form.isalpha():
            continue
        seen.add(form)
        keys = [k for k in (headword_key(c) for c in sorted(lemma_candidates(form), key=lambda c: (c != form, c))) if k]
        if keys:
            out.append((form, list(dict.fromkeys(keys))))
        if len(out) >= LOOKUP_TOKENS_MAX:
            break
    return out


class WordLookup(_Source):
    key = "word_lookup"

    async def load(self, ctx: SourceCtx) -> SourceResult | None:
        if not ctx.text or not self.app.state.settings.wordbook_enabled:
            return None
        wanted = candidates(ctx.text)
        if not wanted:
            return None
        store = dictionary(self.app)
        async with self.app.state.sessionmaker() as s:
            active = await active_enrollment(s, ctx.user_id)
        books = ([active.book_id] if active is not None else []) + [
            b for b in store.loaded() if active is None or b != active.book_id]
        found: dict[str, str] = {}
        for form, keys in wanted:
            for book in books:
                try:
                    cards = await store.cards(book, keys)
                except DataUnavailable:
                    continue
                card = next((cards[k] for k in keys if k in cards), None)
                if card is not None:
                    found.setdefault(card.key, f"{card.word} — {meaning_line(card, 40)}")
                    break
            if len(found) >= LOOKUP_MAX:
                break
        words = list(found)
        return _result(self.key, words, "Dictionary (data): " + "; ".join(found[w] for w in words))


def install(app) -> None:
    """main.create_app 在 app.state.agents 建好之后调用(R-C2:无条件注册,回合里由开关把关)。"""
    registry = runtime(app).registry
    for source in (LearnedWords(app), WeakWords(app), DueWords(app), WordLookup(app)):
        registry.register(source)
