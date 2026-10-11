"""对话用到今日词(spec 2026-10-11-learning-links §6.5):按词形还原检测,不需要大模型;不改盒子(L-R5)。

`MessageSent.text` 只在内存:不写表、不进日志 / 异常 / 计数。"""
import asyncio
import json
import logging
import time
from collections.abc import Iterable
from datetime import datetime, timedelta
from functools import partial

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import metering, rank_sources
from app.core.deps import get_session
from app.core.learning_events import MessageSent
from app.links.gate import require_link
from app.links.spec import LinkSpec
from app.models import LinkCredit, LinkWordUse, User, WordbookEvent, utcnow
from app.providers import llm
from app.services import usage
from app.wordbook.textnorm import find_form, fold, lemma_candidates, tokenize

logger = logging.getLogger(__name__)

KEY = "chat_words"
RANK_KEY = "rank_sources"
SOURCE = rank_sources.RankSource("word_in_chat", 1, "对话用到新词", "New word used in chat")
WINDOW = timedelta(hours=24)
TODAY_MAX = 200

LLM_SCOPE = "links_llm"
JUDGE_TIMEOUT = 8.0
JUDGE_CONCURRENCY = 2
JUDGE_PENDING_MAX = 50
JUDGE_BACKOFF_SECONDS = 60.0
JUDGE_TEXT_MAX = 600


def matches(text: str, keys: Iterable[str]) -> set[str]:
    """命中的今日词键(纯函数)。单词键:任一 token 的原形候选含该键(候选能变回原形,bed 不算 be);多词键整体匹配。"""
    forms: set[str] = set()
    for token in tokenize(text):
        forms |= lemma_candidates(token.text)
    out: set[str] = set()
    for key in keys:
        folded = fold(key)
        if not folded:
            continue
        if " " in folded:
            if find_form(text, folded) is not None:
                out.add(key)
        elif folded in forms:
            out.add(key)
    return out


async def todays_words(session: AsyncSession, user_id: int, at: datetime) -> dict[str, int]:
    """(at − 24h, at] 内的 learn 事件:词 → 第一条事件 id(L-R4)。只看 learn,不看 B 的 relearn(INDEX R-P4)。"""
    rows = (await session.execute(select(WordbookEvent.id, WordbookEvent.word).where(
        WordbookEvent.user_id == user_id, WordbookEvent.kind == "learn", WordbookEvent.created_at >= at - WINDOW,
        WordbookEvent.created_at <= at).order_by(WordbookEvent.id).limit(TODAY_MAX))).all()
    out: dict[str, int] = {}
    for id_, word in rows:
        out.setdefault(word, id_)
    return out


async def handle(app, event: MessageSent) -> None:
    settings = app.state.settings
    async with app.state.sessionmaker() as session:
        today = await todays_words(session, event.user_id, event.at)
        hit = matches(event.text, today) if today else set()
        if not hit:
            return
        used = set((await session.scalars(select(LinkWordUse.learn_event_id).where(
            LinkWordUse.user_id == event.user_id, LinkWordUse.learn_event_id.in_([today[w] for w in hit])))).all())
        recent = await session.scalar(select(func.count()).select_from(LinkWordUse).where(
            LinkWordUse.user_id == event.user_id, LinkWordUse.created_at > event.at - WINDOW))
        room = max(0, settings.link_chat_words_daily_max - int(recent or 0))
        fresh = sorted(w for w in hit if today[w] not in used)[:room]
        if not fresh:
            return
        credit = await app.state.link_gate(RANK_KEY, event.user_id)  # spec §4.5-5:写段位来源前问 rank_sources
        for word in fresh:
            session.add(LinkWordUse(user_id=event.user_id, word=word, learn_event_id=today[word],
                                    message_id=event.message_id, created_at=event.at))
        credited = await _credits(app, event, fresh, {w: today[w] for w in fresh}) if credit else []
        for word in credited:
            session.add(LinkCredit(user_id=event.user_id, kind=SOURCE.kind, ref_id=f"wic:{today[word]}", score=None,
                                   created_at=event.at))
        try:
            await session.commit()
        except IntegrityError:  # replay, or another process recorded the same learn event first
            await session.rollback()


async def _credits(app, event: MessageSent, words: list[str], ids: dict[str, int]) -> list[str]:
    """本次要同步写 LinkCredit 的词。大模型用法检查关(默认)→ 全部(确定性);开 → 交给 JudgeRunner 异步写,
    待办满 → 退回确定性(P-L10)。"""
    if not app.state.settings.link_chat_words_llm_enabled:
        return words
    if app.state.links_judge.submit(event, words, ids):
        return []
    _count(app, "llm_degraded")
    return words


# ---- 可选的大模型用法检查(spec §6.5;默认关、全站日额度、402 等失败一律降级为确定性结果)----

def _count(app, name: str, n: int = 1) -> None:
    app.state.learning_bus.count(KEY, name, n)


_JUDGE_SYSTEM = ("你是英语老师。判断下面学习者的句子里,这些单词的用法是否正确(拼写变形算对)。"
                 '只输出 JSON:{"ok": [用法正确的词]}。')
_ANGLE = str.maketrans({"<": "‹", ">": "›"})


def render_judge(text: str, words: list[str]) -> list[dict]:
    """提示词:学习者原文用 <learner> 包裹(尖括号换成形近字符、截断 600 字符),不能伪造标签。"""
    learner = text[:JUDGE_TEXT_MAX].translate(_ANGLE)
    return [{"role": "system", "content": _JUDGE_SYSTEM},
            {"role": "user", "content": f"单词:{', '.join(words)}\n<learner>{learner}</learner>"}]


def _parse(reply: str, words: list[str]) -> set[str] | None:
    body = reply.strip()
    if body.startswith("```"):  # Ruling:允许整段被代码围栏包住,其余仍严格
        body = body.strip("`").strip()
        if body.lower().startswith("json"):
            body = body[4:]
    try:
        data = json.loads(body)
    except ValueError:
        return None
    ok = data.get("ok") if isinstance(data, dict) else None
    if not isinstance(ok, list) or not all(isinstance(w, str) for w in ok):
        return None
    return {fold(w) for w in ok} & set(words)


def parse_judge(reply: str, words: list[str]) -> set[str]:
    """严格解析 {"ok": [...]};任何不合格式的回复 → 全部词(降级)。"""
    approved = _parse(reply, words)
    return set(words) if approved is None else approved


class JudgeRunner:
    """在通道处理器之外异步判定(P-L10):并发 ≤ 2、待办 ≤ 50、单次 8 秒;上游失败后退避一段时间不再调用。
    进程关停时未完成的判定随之丢失(尽力而为;「用过」已在处理器里写下)。"""

    def __init__(self, app, *, clock=time.monotonic) -> None:
        self._app = app
        self._clock = clock
        self._sem = asyncio.Semaphore(JUDGE_CONCURRENCY)
        self._backoff_until = 0.0
        self.pending: set[asyncio.Task] = set()

    def submit(self, event: MessageSent, words: list[str], ids: dict[str, int]) -> bool:
        if len(self.pending) >= JUDGE_PENDING_MAX:
            _count(self._app, "llm_overflow")
            return False
        task = asyncio.get_running_loop().create_task(self._run(event, list(words), dict(ids)))
        self.pending.add(task)
        task.add_done_callback(self.pending.discard)
        return True

    async def join(self) -> None:
        while self.pending:
            await asyncio.gather(*list(self.pending), return_exceptions=True)

    async def _run(self, event: MessageSent, words: list[str], ids: dict[str, int]) -> None:
        try:
            async with self._sem:
                approved = await self._judge(event, words)
        except Exception as e:  # noqa: BLE001 - never lose the credit because of the optional check
            logger.warning("links judge failed error=%s", type(e).__name__)
            approved = set(words)
        try:
            await self._write(event, sorted(approved), ids)
        except Exception as e:  # noqa: BLE001
            logger.warning("links judge write failed error=%s", type(e).__name__)

    def _degrade(self, kind: str, words: list[str]) -> set[str]:
        _count(self._app, "llm_degraded")
        logger.info("links judge degraded kind=%s", kind)
        return set(words)

    async def _judge(self, event: MessageSent, words: list[str]) -> set[str]:
        app = self._app
        settings = app.state.settings
        if not settings.upstream_llm_base_url:
            return self._degrade("config", words)
        if self._clock() < self._backoff_until:
            return self._degrade("backoff", words)
        async with app.state.sessionmaker() as session:
            allowed = await usage.consume(session, LLM_SCOPE, "global", usage.utc_day(event.at),
                                          settings.link_chat_words_llm_global_daily)
        if not allowed:
            return self._degrade("cap", words)
        _count(app, "llm_calls")
        try:
            metering.bind_user(event.user_id)  # this task's own context copy
            with metering.feature_scope("links"):
                reply = await asyncio.wait_for(
                    llm.complete(app.state.http, settings, render_judge(event.text, words),
                                 model=settings.default_llm_model, max_tokens=60, temperature=0,
                                 timeout=JUDGE_TIMEOUT), JUDGE_TIMEOUT)
        except llm.LlmUnavailable as e:
            if e.kind in ("http", "network"):  # 402 / 429 / 5xx / network: stop calling for a while
                self._backoff_until = self._clock() + JUDGE_BACKOFF_SECONDS
            return self._degrade(e.kind, words)
        except TimeoutError:
            return self._degrade("timeout", words)
        approved = _parse(reply, words) if isinstance(reply, str) else None
        if approved is None:
            return self._degrade("format", words)
        if len(words) > len(approved):
            _count(app, "llm_rejected", len(words) - len(approved))
        return approved

    async def _write(self, event: MessageSent, words: list[str], ids: dict[str, int]) -> None:
        if not words:
            return
        async with self._app.state.sessionmaker() as session:
            for word in words:
                session.add(LinkCredit(user_id=event.user_id, kind=SOURCE.kind, ref_id=f"wic:{ids[word]}",
                                       score=None, created_at=event.at))
            try:
                await session.commit()
            except IntegrityError:  # replayed event: the credit already exists
                await session.rollback()


router = APIRouter()


@router.get("/chat-words")
async def get_chat_words(offset: int = Query(0, ge=-720, le=840), user: User = Depends(require_link(KEY)),
                         session: AsyncSession = Depends(get_session)):
    """今日词与是否已在对话里用过。`offset` 预留给将来按本地日;v1 与处理器一致用滚动 24 小时。"""
    today = await todays_words(session, user.id, utcnow())
    used = set((await session.scalars(select(LinkWordUse.learn_event_id).where(
        LinkWordUse.user_id == user.id, LinkWordUse.learn_event_id.in_(list(today.values()) or [-1])))).all())
    items = [{"word": w, "used": today[w] in used} for w in today]
    return {"today": items, "used_count": sum(1 for i in items if i["used"])}


def install(app, bus) -> None:
    rank_sources.register(SOURCE)
    app.state.links_judge = JudgeRunner(app)
    bus.subscribe(MessageSent, KEY, partial(handle, app))


SPEC = LinkSpec(KEY, "对话用到今日词", "New words in chat", install=install, router=router)
