"""易错词(spec §6.3):背单词答错的词进生词本「易错词」虚拟视图;连续答对 2 次自动移出。不复制 vocabulary_items。"""
from functools import partial

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_session
from app.core.learning_events import WordAnswered
from app.links.gate import require_link
from app.links.spec import LinkSpec, WordIn
from app.models import LinkMistakeWord, User, VocabularyItem, iso_utc, utcnow
from app.services.stats import as_utc

WRONG = frozenset({"wrong", "inflection"})
RIGHT = frozenset({"correct", "know", "known"})  # known = A 之前写的旧行;A 之后 known:true 记为 know
LAPSE_KINDS = frozenset({"review", "practice"})  # 「不认识」只在已有词条上算错;新词第一次标不认识不算(INDEX R-E3)
CLEAR_AFTER = 2
ACTIVE_MAX = 200
PAGE = 20
M = LinkMistakeWord


def is_wrong(event: WordAnswered) -> bool:
    return event.outcome in WRONG or (event.outcome == "unknown" and event.kind in LAPSE_KINDS)


async def handle(app, event: WordAnswered) -> None:
    wrong = is_wrong(event)
    if not wrong and event.outcome not in RIGHT:
        return  # typo、fuzzy、know_chk、新词的 unknown:中性
    async with app.state.sessionmaker() as session:
        row = await session.get(M, (event.user_id, event.word))
        if row is None:
            if not wrong:
                return
            session.add(M(user_id=event.user_id, word=event.word, book_id=event.book_id, wrong_count=1, ok_streak=0,
                          last_event_at=event.at, last_wrong_at=event.at, cleared_at=None))
            try:
                await session.commit()
            except IntegrityError:  # a concurrent first insert won: fall back to the conditional update below
                await session.rollback()
                row = await session.get(M, (event.user_id, event.word), populate_existing=True)
            else:
                await _cap(session, event.user_id, event.at)
                return
        if as_utc(row.last_event_at) >= event.at:
            return  # replay or an older event
        if wrong:
            values = dict(wrong_count=M.wrong_count + 1, ok_streak=0, last_wrong_at=event.at, cleared_at=None,
                          book_id=event.book_id)
        elif row.cleared_at is not None:
            values = {}
        else:
            streak = row.ok_streak + 1
            values = dict(ok_streak=streak, cleared_at=event.at if streak >= CLEAR_AFTER else None)
        await session.execute(update(M).where(M.user_id == event.user_id, M.word == event.word,
                                              M.last_event_at < event.at)
                              .values(last_event_at=event.at, **values).execution_options(synchronize_session=False))
        await session.commit()
        if wrong:
            await _cap(session, event.user_id, event.at)


async def _cap(session: AsyncSession, user_id: int, at) -> None:
    active = await session.scalar(select(func.count()).select_from(M).where(M.user_id == user_id, M.cleared_at.is_(None)))
    extra = int(active or 0) - ACTIVE_MAX
    if extra <= 0:
        return
    oldest = (await session.scalars(select(M.word).where(M.user_id == user_id, M.cleared_at.is_(None))
                                    .order_by(M.last_wrong_at, M.word).limit(extra))).all()
    await session.execute(update(M).where(M.user_id == user_id, M.word.in_(oldest)).values(cleared_at=at)
                          .execution_options(synchronize_session=False))
    await session.commit()


router = APIRouter()


@router.get("/mistakes")
async def list_mistakes(page: int = Query(1, ge=1, le=100), user: User = Depends(require_link("mistakes")),
                        session: AsyncSession = Depends(get_session)):
    mine = (M.user_id == user.id, M.cleared_at.is_(None))
    total = await session.scalar(select(func.count()).select_from(M).where(*mine))
    rows = (await session.scalars(select(M).where(*mine).order_by(M.wrong_count.desc(), M.last_wrong_at.desc(), M.word)
                                  .offset((page - 1) * PAGE).limit(PAGE + 1))).all()
    words = [r.word for r in rows[:PAGE]]
    items: dict[str, VocabularyItem] = {}
    for v in (await session.scalars(select(VocabularyItem).where(VocabularyItem.user_id == user.id,
                                                                 VocabularyItem.word.in_(words))
                                    .order_by(VocabularyItem.created_at, VocabularyItem.id))).all():
        items.setdefault(v.word, v)  # 同用户同词最早一行(R17)
    out = []
    for r in rows[:PAGE]:
        v = items.get(r.word)
        out.append({"word": r.word, "wrong_count": r.wrong_count, "last_wrong_at": iso_utc(r.last_wrong_at),
                    "meaning": v.meaning if v else "", "box": v.box if v else None,
                    "due_at": iso_utc(v.due_at) if v else None, "book_id": r.book_id})
    return {"items": out, "next": page + 1 if len(rows) > PAGE else None, "total": int(total or 0)}


@router.post("/mistakes/dismiss")
async def dismiss(payload: WordIn, user: User = Depends(require_link("mistakes", limited=True)),
                  session: AsyncSession = Depends(get_session)):
    await session.execute(update(M).where(M.user_id == user.id, M.word == payload.word, M.cleared_at.is_(None))
                          .values(cleared_at=utcnow()).execution_options(synchronize_session=False))
    await session.commit()
    return {"word": payload.word}


def install(app, bus) -> None:
    bus.subscribe(WordAnswered, "mistakes", partial(handle, app))


SPEC = LinkSpec("mistakes", "易错词", "Mistakes", install=install, router=router)
