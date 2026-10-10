"""对话用到今日词(spec 2026-10-11-learning-links §6.5):按词形还原检测,不需要大模型;不改盒子(L-R5)。

`MessageSent.text` 只在内存:不写表、不进日志 / 异常 / 计数。"""
from collections.abc import Iterable
from datetime import datetime, timedelta
from functools import partial

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import rank_sources
from app.core.deps import get_session
from app.core.learning_events import MessageSent
from app.links.gate import require_link
from app.links.spec import LinkSpec
from app.models import LinkCredit, LinkWordUse, User, WordbookEvent, utcnow
from app.wordbook.textnorm import find_form, fold, lemma_candidates, tokenize

KEY = "chat_words"
RANK_KEY = "rank_sources"
SOURCE = rank_sources.RankSource("word_in_chat", 1, "对话用到新词", "New word used in chat")
WINDOW = timedelta(hours=24)
TODAY_MAX = 200


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
        credited = await _credits(app, event, fresh) if credit else []
        for word in credited:
            session.add(LinkCredit(user_id=event.user_id, kind=SOURCE.kind, ref_id=f"wic:{today[word]}", score=None,
                                   created_at=event.at))
        try:
            await session.commit()
        except IntegrityError:  # replay, or another process recorded the same learn event first
            await session.rollback()


async def _credits(app, event: MessageSent, words: list[str]) -> list[str]:
    """确定性:全部计分。L5-2 在打开大模型用法检查时把它们交给 JudgeRunner(由它异步写 LinkCredit)。"""
    return words


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
    bus.subscribe(MessageSent, KEY, partial(handle, app))


SPEC = LinkSpec(KEY, "对话用到今日词", "New words in chat", install=install, router=router)
