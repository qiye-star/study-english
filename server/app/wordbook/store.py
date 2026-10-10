"""背单词数据层(spec §5)。除 enroll 与 usage 计数(consume_*)外不提交;提交由 service 负责。"""
import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy import update as update_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import VocabularyItem, WordbookEnrollment, WordbookEvent, WordbookHiddenSentence, WordbookReport
from app.services import usage
from app.services.stats import as_utc
from app.services.vocabulary import INTERVAL_DAYS, MAX_EXAMPLE, MAX_MEANING
from app.wordbook.entry import WordCard
from app.wordbook.index import DictionaryStore
from app.wordbook.plan import Known
from app.wordbook.recall import RATING_OUTCOMES, RECALL_QTYPE

ANSWERS_DAILY_MAX = 3000
REPORTS_DAILY_MAX = 20
SOURCE_PREFIX = "wordbook:"


def wordbook_source(book_id: str) -> str:
    return f"{SOURCE_PREFIX}{book_id}"


def _known(row) -> Known:
    return Known(row.id, row.box, as_utc(row.due_at), row.reps, row.source)


def _known_columns():
    return select(VocabularyItem.word, VocabularyItem.id, VocabularyItem.box, VocabularyItem.due_at,
                  VocabularyItem.reps, VocabularyItem.source)


async def known_words(session: AsyncSession, user_id: int) -> dict[str, Known]:
    """用户全部词条(任何来源)按词;重复行(R17)取最早的一行。"""
    rows = (await session.execute(_known_columns().where(VocabularyItem.user_id == user_id)
                                  .order_by(VocabularyItem.created_at, VocabularyItem.id))).all()
    out: dict[str, Known] = {}
    for row in rows:
        out.setdefault(row.word, _known(row))
    return out


async def known_one(session: AsyncSession, user_id: int, word: str) -> Known | None:
    row = (await session.execute(_known_columns().where(VocabularyItem.user_id == user_id, VocabularyItem.word == word)
                                 .order_by(VocabularyItem.created_at, VocabularyItem.id).limit(1))).first()
    return _known(row) if row else None


async def enrollments(session: AsyncSession, user_id: int) -> list[WordbookEnrollment]:
    return list((await session.scalars(select(WordbookEnrollment).where(WordbookEnrollment.user_id == user_id)
                                       .order_by(WordbookEnrollment.started_at, WordbookEnrollment.book_id))).all())


async def active_enrollment(session: AsyncSession, user_id: int) -> WordbookEnrollment | None:
    return await session.scalar(select(WordbookEnrollment).where(
        WordbookEnrollment.user_id == user_id, WordbookEnrollment.status == "active").limit(1))


async def get_enrollment(session: AsyncSession, user_id: int, book_id: str) -> WordbookEnrollment | None:
    return await session.get(WordbookEnrollment, (user_id, book_id))


async def enroll(session: AsyncSession, user_id: int, book_id: str, *, daily_new: int | None, review_cap: int | None,
                 order_mode: str | None, now: datetime, seed: int) -> WordbookEnrollment:
    """设为 active 并暂停其它书;再次选同一本只更新设置,不重置进度(改顺序时 cursor 归零,已学的词会被跳过)。提交。"""
    rows = await enrollments(session, user_id)
    for row in rows:
        if row.book_id != book_id and row.status == "active":
            row.status, row.updated_at = "paused", now
    def update(found: WordbookEnrollment) -> None:
        found.status = "active"
        if order_mode and order_mode != found.order_mode:
            found.order_mode, found.cursor = order_mode, 0
        if daily_new is not None:
            found.daily_new = daily_new
        if review_cap is not None:
            found.review_cap = review_cap
        found.updated_at = now

    found = next((r for r in rows if r.book_id == book_id), None)
    if found is None:
        found = WordbookEnrollment(user_id=user_id, book_id=book_id, status="active", order_mode=order_mode or "shuffle",
                                   seed=seed, cursor=0, daily_new=daily_new or 20, review_cap=review_cap or 100,
                                   started_at=now, updated_at=now)
        session.add(found)
    else:
        update(found)
    try:
        await session.commit()
    except IntegrityError:  # 同一本书的并发首次选书先写入了(review m8):改为更新那一行
        await session.rollback()
        found = await session.get(WordbookEnrollment, (user_id, book_id), populate_existing=True)
        update(found)
        await session.commit()
    # 并发选了另一本书的请求可能在我们读之后提交:提交后再暂停其它 active,保证最多一本 active(review m8)
    await session.execute(update_(WordbookEnrollment).where(
        WordbookEnrollment.user_id == user_id, WordbookEnrollment.book_id != book_id,
        WordbookEnrollment.status == "active").values(status="paused", updated_at=now)
        .execution_options(synchronize_session=False))
    await session.commit()
    return found


def card_meaning(card: WordCard, n: int = 3) -> str:
    return "；".join(f"{s.pos}. {s.text}" if s.pos else s.text for s in card.senses[:n])


async def create_item(session: AsyncSession, user_id: int, book_id: str, card: WordCard, *, box: int,
                      due_at: datetime, now: datetime) -> str:
    """新建一行 vocabulary_items(source='wordbook:<book>');flush 不提交。"""
    example = card.examples[0].en[:MAX_EXAMPLE] if card.examples else None
    row = VocabularyItem(id=str(uuid.uuid4()), user_id=user_id, word=card.key, meaning=card_meaning(card)[:MAX_MEANING],
                         example=example, source=wordbook_source(book_id), box=box, due_at=due_at, reps=0, lapses=0,
                         last_reviewed_at=None, created_at=now)
    session.add(row)
    await session.flush()
    return row.id


async def add_event(session: AsyncSession, *, user_id: int, book_id: str, kind: str, word: str, item_id: str | None,
                    qtype: str | None, outcome: str, credit: int, day: str, now: datetime) -> None:
    session.add(WordbookEvent(user_id=user_id, book_id=book_id, kind=kind, word=word[:100], item_id=item_id,
                              qtype=qtype, outcome=outcome, credit=credit, day=day, created_at=now))


def _today(user_id: int, book_id: str, day: str):
    return WordbookEvent.user_id == user_id, WordbookEvent.book_id == book_id, WordbookEvent.day == day


async def today_counts(session: AsyncSession, user_id: int, book_id: str, day: str) -> tuple[int, int]:
    """(今日学过的新词数(按词去重), 今日 review 事件数)。"""
    learned = await session.scalar(select(func.count(func.distinct(WordbookEvent.word))).where(
        *_today(user_id, book_id, day), WordbookEvent.kind == "learn"))
    reviews = await session.scalar(select(func.count()).select_from(WordbookEvent).where(
        *_today(user_id, book_id, day), WordbookEvent.kind == "review"))
    return int(learned or 0), int(reviews or 0)


async def ever_learned(session: AsyncSession, user_id: int, word: str) -> bool:
    """该用户是否已有这个词的 learn 事件(任何书、任何一天)。"""
    found = await session.scalar(select(WordbookEvent.id).where(
        WordbookEvent.user_id == user_id, WordbookEvent.word == word, WordbookEvent.kind == "learn").limit(1))
    return found is not None


async def open_report_id(session: AsyncSession, user_id: int, sentence_id: str) -> int | None:
    return await session.scalar(select(WordbookReport.id).where(
        WordbookReport.user_id == user_id, WordbookReport.sentence_id == sentence_id,
        WordbookReport.status == "open").limit(1))


async def spell_set_done(session: AsyncSession, user_id: int, set_id: str, day: str) -> bool:
    found = await session.scalar(select(WordbookEvent.id).where(
        WordbookEvent.user_id == user_id, WordbookEvent.kind == "spell_set", WordbookEvent.word == set_id,
        WordbookEvent.day == day).limit(1))
    return found is not None


async def today_learned_keys(session: AsyncSession, user_id: int, book_id: str, day: str) -> list[str]:
    rows = await session.scalars(select(WordbookEvent.word).where(*_today(user_id, book_id, day),
                                                                  WordbookEvent.kind == "learn")
                                 .order_by(WordbookEvent.id))
    return list(dict.fromkeys(rows.all()))


async def consume_answer(session: AsyncSession, user_id: int, day: str) -> bool:
    """每人每日作答上限(daily_usage 范围 wordbook_answers);usage.consume 会提交。"""
    return await usage.consume(session, "wordbook_answers", str(user_id), day, ANSWERS_DAILY_MAX)


async def consume_report(session: AsyncSession, user_id: int, day: str) -> bool:
    return await usage.consume(session, "wordbook_reports", str(user_id), day, REPORTS_DAILY_MAX)


async def set_cursor(session: AsyncSession, user_id: int, book_id: str, cursor: int) -> None:
    """cursor 只前进。不提交。"""
    row = await get_enrollment(session, user_id, book_id)
    if row is not None and cursor > row.cursor:
        row.cursor = cursor


async def hidden_ids(session: AsyncSession) -> Iterable[str]:
    return (await session.scalars(select(WordbookHiddenSentence.sentence_id))).all()


async def load_hidden(session: AsyncSession, ds: DictionaryStore) -> None:
    ds.set_hidden(await hidden_ids(session))


# ---- 背单词 v2 · 三档自评(设计文档 2026-10-11-wordbook-recall §5)----

_RATING_OUTCOMES = tuple(sorted(RATING_OUTCOMES))


async def last_rating(session: AsyncSession, user_id: int, word: str) -> str | None:
    """该用户该词最近一条自评事件的 outcome(任何书、任何一天);没有 → None。"""
    return await session.scalar(select(WordbookEvent.outcome).where(
        WordbookEvent.user_id == user_id, WordbookEvent.word == word, WordbookEvent.qtype == RECALL_QTYPE,
        WordbookEvent.outcome.in_(_RATING_OUTCOMES)).order_by(WordbookEvent.id.desc()).limit(1))


async def first_rating_on(session: AsyncSession, user_id: int, word: str, day: str) -> str | None:
    """该词在这个本地日的第一条自评事件的 outcome(决定当天小测的抽查规则);没有 → None。"""
    return await session.scalar(select(WordbookEvent.outcome).where(
        WordbookEvent.user_id == user_id, WordbookEvent.word == word, WordbookEvent.qtype == RECALL_QTYPE,
        WordbookEvent.day == day, WordbookEvent.outcome.in_(_RATING_OUTCOMES)).order_by(WordbookEvent.id).limit(1))


async def set_learn_box(session: AsyncSession, user_id: int, item_id: str, *, seen_box: int, to_box: int,
                        now: datetime) -> bool:
    """当天新词的盒子调整(抽查通过 / 小测答错 / 当天再评):不是一次复习 —— 不加 reps、不写 last_reviewed_at,
    所以不产生 vocab_review。乐观条件 reps = 0 且 box = 读到的值;降级时 lapses + 1。不提交。"""
    result = await session.execute(
        update_(VocabularyItem)
        .where(VocabularyItem.id == item_id, VocabularyItem.user_id == user_id, VocabularyItem.reps == 0,
               VocabularyItem.box == seen_box)
        .values(box=to_box, due_at=now + timedelta(days=INTERVAL_DAYS[to_box]),
                lapses=VocabularyItem.lapses + (1 if to_box < seen_box else 0))
        .execution_options(synchronize_session=False))
    return result.rowcount == 1
