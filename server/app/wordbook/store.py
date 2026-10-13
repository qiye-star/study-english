"""背单词数据层(spec §5)。除 enroll 与 usage 计数(consume_*)外不提交;提交由 service 负责。"""
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy import update as update_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import VocabularyItem, WordbookEnrollment, WordbookEvent, WordbookHiddenSentence, WordbookReport
from app.services import usage
from app.services.stats import as_utc
from app.services.vocabulary import INTERVAL_DAYS, MAX_EXAMPLE, MAX_MEANING
from app.wordbook import learned
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
                                   seed=seed, cursor=0, daily_new=daily_new if daily_new is not None else 20,
                                   review_cap=review_cap if review_cap is not None else 100,
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
        *_today(user_id, book_id, day), WordbookEvent.kind.in_(LEARN_KINDS)))
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
                                                                  WordbookEvent.kind.in_(LEARN_KINDS))
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


# ---- 每日目标(goals v2,spec 2026-10-11)----

LEARN_KINDS = ("learn", "relearn")  # 计入「今天已学新词」(G-4);段位只读 learn
SETTINGS_DAILY_MAX = 60  # PATCH /enrollment、pause、resume、bonus 共用,每人每 UTC 日
RESETS_DAILY_MAX = 2


async def update_goals(session: AsyncSession, e: WordbookEnrollment, *, daily_new: int | None, review_cap: int | None,
                       order_mode: str | None, now: datetime) -> WordbookEnrollment:
    """只改给出的字段;改顺序时 cursor 归零(已学的词被跳过,同 enroll)。提交。"""
    if order_mode and order_mode != e.order_mode:
        e.order_mode, e.cursor = order_mode, 0
    if daily_new is not None:
        e.daily_new = daily_new
    if review_cap is not None:
        e.review_cap = review_cap
    e.updated_at = now
    await session.commit()
    return e


async def latest_paused(session: AsyncSession, user_id: int, enabled: Iterable[str]) -> WordbookEnrollment | None:
    """没有在学的书时,首页显示的那本已暂停的书(最近更新、仍启用)。"""
    return await session.scalar(select(WordbookEnrollment).where(
        WordbookEnrollment.user_id == user_id, WordbookEnrollment.status == "paused",
        WordbookEnrollment.book_id.in_(tuple(enabled))).order_by(WordbookEnrollment.updated_at.desc()).limit(1))


async def bonus_today(session: AsyncSession, user_id: int, book_id: str, day: str) -> int:
    total = await session.scalar(select(func.coalesce(func.sum(WordbookEvent.credit), 0)).where(
        *_today(user_id, book_id, day), WordbookEvent.kind == "bonus"))
    return int(total or 0)


async def mark_goal(session: AsyncSession, user_id: int, book_id: str, day: str, now: datetime) -> bool:
    """当天第一次达标写一行 goal(跨书一天一行);flush 不提交。已有则返回 False。"""
    found = await session.scalar(select(WordbookEvent.id).where(
        WordbookEvent.user_id == user_id, WordbookEvent.kind == "goal", WordbookEvent.day == day).limit(1))
    if found is not None:
        return False
    await add_event(session, user_id=user_id, book_id=book_id, kind="goal", word="goal", item_id=None, qtype=None,
                    outcome="met", credit=0, day=day, now=now)
    await session.flush()
    return True


async def goal_days(session: AsyncSession, user_id: int, since: str) -> list[str]:
    rows = await session.scalars(select(func.distinct(WordbookEvent.day)).where(
        WordbookEvent.user_id == user_id, WordbookEvent.kind == "goal", WordbookEvent.day >= since))
    return list(rows.all())


async def consume_settings(session: AsyncSession, user_id: int, day: str) -> bool:
    return await usage.consume(session, "wordbook_settings", str(user_id), day, SETTINGS_DAILY_MAX)


# ---- 释义显示偏好 def_lang(spec 2026-10-12-wordbook-definitions §4;计划 R-DS3:无迁移)----
# wordbook 没有「每用户设置」的表或 JSON 列,所以偏好存成 wordbook_events 里的一行 kind="defpref"(book_id 为空串,
# outcome = 值),取最新一行;段位只读 learn/spell_set,计划只数 learn/relearn/review,管理端按书统计的查询按 book_id 过滤,
# 都读不到它。每次改动占用「设置」每日 60 次里的一次,所以行数有上限。

# 默认值(spec 2026-10-13-defs-default-lookup-ios-design §2):没存过偏好的用户显示「仅英文」;缺英文释义的词由网页回退成中文。
# 已存过偏好的用户读到自己最新一行事件,不受默认值影响。
DEF_LANGS = ("both", "zh", "en")
DEFAULT_DEF_LANG = "en"
DEF_PREF_KIND = "defpref"


async def get_def_lang(session: AsyncSession, user_id: int) -> str:
    value = await session.scalar(select(WordbookEvent.outcome).where(
        WordbookEvent.book_id == "", WordbookEvent.kind == DEF_PREF_KIND, WordbookEvent.user_id == user_id)
        .order_by(WordbookEvent.id.desc()).limit(1))
    return value if value in DEF_LANGS else DEFAULT_DEF_LANG


async def set_def_lang(session: AsyncSession, user_id: int, value: str, day: str, now: datetime) -> None:
    """追加一行偏好事件;flush 不提交。"""
    await add_event(session, user_id=user_id, book_id="", kind=DEF_PREF_KIND, word=DEF_PREF_KIND, item_id=None,
                    qtype=None, outcome=value, credit=0, day=day, now=now)
    await session.flush()


async def pause_active(session: AsyncSession, user_id: int, now: datetime) -> WordbookEnrollment | None:
    """把当前在学的书设为 paused 并提交;没有在学的书返回 None。"""
    e = await active_enrollment(session, user_id)
    if e is not None:
        e.status, e.updated_at = "paused", now
        await session.commit()
    return e


async def reset_book(session: AsyncSession, user_id: int, book_id: str, *, seed: int, now: datetime) -> int:
    """重置进度(spec 2026-10-11 §8):删除本书来源(source='wordbook:<book>')的 vocabulary_items 行,
    取词位置归零并换新种子。事件、段位、别的来源的词不动。不提交;返回删除的行数。"""
    result = await session.execute(delete(VocabularyItem).where(
        VocabularyItem.user_id == user_id, VocabularyItem.source == wordbook_source(book_id))
        .execution_options(synchronize_session=False))
    e = await get_enrollment(session, user_id, book_id)
    e.cursor, e.seed, e.started_at, e.updated_at = 0, seed, now, now
    return int(result.rowcount or 0)


async def consume_reset(session: AsyncSession, user_id: int, day: str) -> bool:
    return await usage.consume(session, "wordbook_resets", str(user_id), day, RESETS_DAILY_MAX)


# ---- 已学词与自由复习(spec 2026-10-12 wordbook-review §1;计划 2026-10-12-wordbook-learned-review)----

FREE_STARTS_DAILY_MAX = 200           # 每人每 UTC 日开始自由复习的次数(挡住反复读词典;不是设置项)
FREE_PULLS_DAILY_MAX = 20             # 每人每 UTC 日最多把 20 个词「拉到今天到期」(R-L6 刷分防护 ③)
FREE_PULL_QUIET = timedelta(hours=24)  # 24 小时内正式复习过的词不能被拉(R-L6 防护 ②)


@dataclass(frozen=True)
class LearnedRow:
    id: str
    word: str
    book_id: str
    box: int
    lapses: int
    due_at: datetime
    created_at: datetime


def learned_sources(book_ids: Iterable[str]) -> list[str]:
    return [wordbook_source(b) for b in book_ids]


def _learned_where(user_id: int, sources: Sequence[str], *, tier: str | None, weak: bool, since: datetime | None,
                   until: datetime | None, prefix: str | None) -> list:
    conds = [VocabularyItem.user_id == user_id, VocabularyItem.source.in_(list(sources))]
    if tier is not None:
        low, high = learned.TIERS[tier]
        conds.append(VocabularyItem.box.between(low, high))
    if weak:
        conds += [VocabularyItem.lapses >= learned.WEAK_MIN_LAPSES, VocabularyItem.box <= learned.WEAK_MAX_BOX]
    if since is not None:
        conds.append(VocabularyItem.created_at >= since)
    if until is not None:
        conds.append(VocabularyItem.created_at < until)
    if prefix:  # R-L5:用户自己的行上的前缀匹配,% 与 _ 转义
        conds.append(VocabularyItem.word.startswith(prefix, autoescape=True))
    return conds


async def learned_page(session: AsyncSession, user_id: int, sources: Sequence[str], *, tier: str | None, weak: bool,
                       since: datetime | None, until: datetime | None, prefix: str | None,
                       after: tuple[datetime, str] | None, limit: int) -> tuple[list[LearnedRow], bool]:
    """已学词,新学的在前;游标 = (created_at, id)。多取一行判断还有没有下一页。"""
    stmt = select(VocabularyItem.id, VocabularyItem.word, VocabularyItem.source, VocabularyItem.box,
                  VocabularyItem.lapses, VocabularyItem.due_at, VocabularyItem.created_at).where(
        *_learned_where(user_id, sources, tier=tier, weak=weak, since=since, until=until, prefix=prefix))
    if after is not None:
        at, item_id = after
        stmt = stmt.where(or_(VocabularyItem.created_at < at,
                              and_(VocabularyItem.created_at == at, VocabularyItem.id < item_id)))
    found = (await session.execute(stmt.order_by(VocabularyItem.created_at.desc(), VocabularyItem.id.desc())
                                   .limit(limit + 1))).all()
    rows = [LearnedRow(r.id, r.word, r.source[len(SOURCE_PREFIX):], r.box, r.lapses, as_utc(r.due_at),
                       as_utc(r.created_at)) for r in found[:limit]]
    return rows, len(found) > limit


async def learned_counts(session: AsyncSession, user_id: int, sources: Sequence[str], *,
                         yesterday: tuple[datetime, datetime], last7_start: datetime
                         ) -> tuple[list[tuple[str, int, int]], int, int, int]:
    base = _learned_where(user_id, sources, tier=None, weak=False, since=None, until=None, prefix=None)
    grouped = (await session.execute(select(VocabularyItem.source, VocabularyItem.box, func.count())
                                     .where(*base).group_by(VocabularyItem.source, VocabularyItem.box))).all()

    async def count(*extra) -> int:
        return int(await session.scalar(select(func.count()).select_from(VocabularyItem).where(*base, *extra)) or 0)

    weak = await count(VocabularyItem.lapses >= learned.WEAK_MIN_LAPSES, VocabularyItem.box <= learned.WEAK_MAX_BOX)
    y = await count(VocabularyItem.created_at >= yesterday[0], VocabularyItem.created_at < yesterday[1])
    w = await count(VocabularyItem.created_at >= last7_start)
    return [(source, int(box), int(n)) for source, box, n in grouped], weak, y, w


async def free_pool(session: AsyncSession, user_id: int, sources: Sequence[str], *, tier: str | None, weak: bool,
                    since: datetime | None, until: datetime | None) -> list[tuple[str, str]]:
    """自由复习可抽的 (词, 书)。只有这个用户自己的已学词。"""
    rows = (await session.execute(select(VocabularyItem.word, VocabularyItem.source).where(
        *_learned_where(user_id, sources, tier=tier, weak=weak, since=since, until=until, prefix=None)))).all()
    return [(word, source[len(SOURCE_PREFIX):]) for word, source in rows]


async def pull_eligible(session: AsyncSession, user_id: int, item_id: str, now: datetime) -> bool:
    """这个词能不能被自由答错拉到今天到期:存在,且 24 小时内既没有正式复习过、也不是刚学的(R-L6)。
    没复习过的词以学习时间(`created_at`)计:刚学的词不能「学 → 自由答错 → 当天正式复习」刷一点。"""
    found = (await session.execute(select(VocabularyItem.id, VocabularyItem.last_reviewed_at,
                                          VocabularyItem.created_at).where(
        VocabularyItem.id == item_id, VocabularyItem.user_id == user_id))).first()
    if found is None:
        return False
    last = found.last_reviewed_at or found.created_at
    return last is None or as_utc(last) <= now - FREE_PULL_QUIET


async def pull_due(session: AsyncSession, user_id: int, item_id: str, now: datetime) -> bool:
    """自由复习答错:把还没到期的词改为「现在到期」(进入正式复习队列)。只动 due_at —— 盒子、reps、lapses、
    last_reviewed_at 都不变,所以不产生 vocab_review。已到期的词不动(返回 False)。不提交。"""
    result = await session.execute(
        update_(VocabularyItem)
        .where(VocabularyItem.id == item_id, VocabularyItem.user_id == user_id, VocabularyItem.due_at > now)
        .values(due_at=now).execution_options(synchronize_session=False))
    return result.rowcount == 1


async def consume_free_start(session: AsyncSession, user_id: int, day: str) -> bool:
    return await usage.consume(session, "wordbook_free_starts", str(user_id), day, FREE_STARTS_DAILY_MAX)


async def consume_free_pull(session: AsyncSession, user_id: int, day: str) -> bool:
    return await usage.consume(session, "wordbook_free_pulls", str(user_id), day, FREE_PULLS_DAILY_MAX)
