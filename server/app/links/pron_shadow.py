"""发音弱词 ↔ 跟读(spec §6.4)。只收跟读评测(source="practice",L-R3);今日新词例句复用背单词词卡。

不发任何上游请求:弱词来自已经做完(已扣配额)的跟读评测;「跟读」入口只是把参考文本交给现有评测流程。
"""
from functools import partial

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_session
from app.core.learning_events import AssessmentFinished
from app.links.gate import require_link
from app.links.spec import LinkSpec, WordIn
from app.models import LinkWeakWord, User, VocabularyItem, iso_utc, utcnow
from app.services.stats import as_utc
from app.services.usage import local_day
from app.wordbook import service, store
from app.wordbook.books import enabled_books
from app.wordbook.index import DataUnavailable, dictionary

CLEAR_AFTER = 2
ACTIVE_MAX = 200
LIST_MAX = 50
TODAY_MAX = 20
SOURCE = "practice"
W = LinkWeakWord


async def handle(app, event: AssessmentFinished) -> None:
    if event.source != SOURCE:
        return
    weak = {w.word[:100]: w.score for w in event.weak_words if w.word}
    good = list(dict.fromkeys(g[:100] for g in event.good_words if g and g[:100] not in weak))
    if not weak and not good:
        return
    for attempt in range(2):  # one retry if a concurrent first insert collides
        async with app.state.sessionmaker() as session:
            rows = {r.word: r for r in (await session.scalars(select(W).where(
                W.user_id == event.user_id, W.word.in_(list(weak) + good)))).all()}
            for word, score in weak.items():
                row = rows.get(word)
                if row is None:
                    session.add(W(user_id=event.user_id, word=word, hits=1, last_score=score, ok_streak=0,
                                  last_event_at=event.at, last_weak_at=event.at, cleared_at=None))
                elif as_utc(row.last_event_at) < event.at:
                    row.hits, row.last_score, row.ok_streak = row.hits + 1, score, 0
                    row.last_weak_at, row.last_event_at, row.cleared_at = event.at, event.at, None
            for word in good:
                row = rows.get(word)
                if row is not None and row.cleared_at is None and as_utc(row.last_event_at) < event.at:
                    row.ok_streak += 1
                    row.last_event_at = event.at
                    if row.ok_streak >= CLEAR_AFTER:
                        row.cleared_at = event.at
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                if attempt:
                    raise
                continue
            await _cap(session, event.user_id, event.at)
            return


async def _cap(session: AsyncSession, user_id: int, at) -> None:
    active = await session.scalar(select(func.count()).select_from(W).where(W.user_id == user_id, W.cleared_at.is_(None)))
    extra = int(active or 0) - ACTIVE_MAX
    if extra > 0:
        oldest = (await session.scalars(select(W.word).where(W.user_id == user_id, W.cleared_at.is_(None))
                                        .order_by(W.last_weak_at, W.word).limit(extra))).all()
        await session.execute(update(W).where(W.user_id == user_id, W.word.in_(oldest)).values(cleared_at=at)
                              .execution_options(synchronize_session=False))
        await session.commit()


router = APIRouter()


@router.get("/weak-words")
async def weak_words(user: User = Depends(require_link("pron_shadow")), session: AsyncSession = Depends(get_session)):
    mine = (W.user_id == user.id, W.cleared_at.is_(None))
    total = await session.scalar(select(func.count()).select_from(W).where(*mine))
    rows = (await session.scalars(select(W).where(*mine).order_by(W.hits.desc(), W.last_weak_at.desc(), W.word)
                                  .limit(LIST_MAX))).all()
    examples: dict[str, str | None] = {}
    if rows:
        for word, example in (await session.execute(select(VocabularyItem.word, VocabularyItem.example).where(
                VocabularyItem.user_id == user.id, VocabularyItem.word.in_([r.word for r in rows]))
                .order_by(VocabularyItem.created_at, VocabularyItem.id))).all():
            examples.setdefault(word, example or None)
    return {"items": [{"word": r.word, "hits": r.hits, "last_score": r.last_score,
                       "last_weak_at": iso_utc(r.last_weak_at), "example": examples.get(r.word)} for r in rows],
            "total": int(total or 0)}


@router.post("/weak-words/dismiss")
async def dismiss(payload: WordIn, user: User = Depends(require_link("pron_shadow", limited=True)),
                  session: AsyncSession = Depends(get_session)):
    await session.execute(update(W).where(W.user_id == user.id, W.word == payload.word, W.cleared_at.is_(None))
                          .values(cleared_at=utcnow()).execution_options(synchronize_session=False))
    await session.commit()
    return {"word": payload.word}


@router.get("/today-words")
async def today_words(request: Request, offset: int = Query(0, ge=-720, le=840),
                      user: User = Depends(require_link("pron_shadow")), session: AsyncSession = Depends(get_session)):
    settings = request.app.state.settings
    if not settings.wordbook_enabled:
        return {"items": []}
    e = await store.active_enrollment(session, user.id)
    if e is None or e.book_id not in enabled_books(settings.wordbook_books):
        return {"items": []}
    keys = (await store.today_learned_keys(session, user.id, e.book_id, local_day(utcnow(), offset)))[:TODAY_MAX]
    if not keys:
        return {"items": []}
    ds = dictionary(request.app)
    await service.ensure_hidden(session, ds)
    try:
        cards = await ds.cards(e.book_id, keys)
    except DataUnavailable:
        return {"items": []}
    items = []
    for key in keys:
        card = cards.get(key)
        if card is None:
            continue
        first = card.examples[0] if card.examples else None
        items.append({"key": key, "word": card.word, "example": {"en": first.en, "zh": first.zh} if first else None})
    return {"items": items}


def install(app, bus) -> None:
    bus.subscribe(AssessmentFinished, SPEC.key, partial(handle, app))


SPEC = LinkSpec("pron_shadow", "发音弱词与跟读", "Weak pronunciation & shadowing", install=install, router=router)
