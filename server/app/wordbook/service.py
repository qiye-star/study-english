"""背单词编排(spec §6、§7)。路由只做校验与错误映射;这里组合 index / store / 纯模块。

响应里不出现以词为键的映射(网页客户端会把对象键 camelCase 化):列表里每项都带自己的 `key`。"""
from dataclasses import asdict, dataclass
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import WordbookEnrollment, iso_utc
from app.services.usage import local_day
from app.services.vocabulary import apply_review
from app.wordbook import plan as planning
from app.wordbook import store
from app.wordbook.books import BOOKS, BookSpec, book_by_id, enabled_books
from app.wordbook.entry import WordCard
from app.wordbook.grading import grade_blank, srs_grade
from app.wordbook.index import BookIndex, DataUnavailable, DictionaryStore
from app.wordbook.plan import Known
from app.wordbook.quiz import (CHOICE_QTYPES, Question, build_question, candidate_keys, check_choice, pick_distractors,
                               pick_qtype, question_rng)


class WordbookError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


BOOK_NOT_FOUND = (404, "Book not found")
DATA_UNAVAILABLE = (503, "Wordbook data unavailable")
NO_ACTIVE = (409, "No active book")
WORD_NOT_FOUND = (404, "Word not found")
SENTENCE_CHANGED = (422, "Sentence changed")
ANSWER_LIMIT = (429, "Daily answer limit reached")
REPORT_LIMIT = (429, "Daily report limit reached")


def fail(error: tuple[int, str]):
    raise WordbookError(*error)


def book_or_fail(settings: Settings, book_id: str) -> BookSpec:
    if book_id not in enabled_books(settings.wordbook_books):
        fail(BOOK_NOT_FOUND)
    return book_by_id(book_id)


async def index_or_fail(ds: DictionaryStore, book_id: str) -> BookIndex:
    try:
        return await ds.index(book_id)
    except DataUnavailable:
        fail(DATA_UNAVAILABLE)


async def cards_or_fail(ds: DictionaryStore, book_id: str, keys: list[str]) -> dict[str, WordCard]:
    try:
        return await ds.cards(book_id, keys)
    except DataUnavailable:
        fail(DATA_UNAVAILABLE)


async def ensure_hidden(session: AsyncSession, ds: DictionaryStore) -> None:
    """进程里第一次用到例句前,从 wordbook_hidden_sentences 载入屏蔽集合(管理端屏蔽时会刷新)。"""
    if not ds.hidden_loaded:
        await store.load_hidden(session, ds)


def book_out(b: BookSpec, **extra) -> dict:
    return {"id": b.id, "title_zh": b.title_zh, "title_en": b.title_en, "level": b.level, "words": b.unique, **extra}


def config_out(settings: Settings) -> dict:
    """GET /api/wordbook/config(开关打开时)。available = 数据文件存在(校验和由管理端「诊断」检查)。"""
    data_dir = settings.resolved_wordbook_data_dir
    enabled = enabled_books(settings.wordbook_books)
    return {
        "enabled": True,
        "ai_available": settings.wordbook_ai_available,
        "defaults": {"daily_new": settings.wordbook_daily_new, "review_cap": settings.wordbook_review_cap},
        "books": [book_out(b, available=(data_dir / b.file).is_file()) for b in BOOKS if b.id in enabled],
    }


def card_out(card: WordCard) -> dict:
    return {"key": card.key, "word": card.word, "us": card.us, "uk": card.uk,
            "senses": [{"pos": s.pos, "text": s.text} for s in card.senses],
            "phrases": [{"en": en, "zh": zh} for en, zh in card.phrases],
            "examples": [{"id": e.id, "en": e.en, "zh": e.zh} for e in card.examples]}


def item_out(known: Known | None) -> dict | None:
    return None if known is None else {"box": known.box, "due_at": iso_utc(known.due_at)}


def enrollment_out(e: WordbookEnrollment) -> dict:
    return {"book_id": e.book_id, "status": e.status, "order_mode": e.order_mode, "daily_new": e.daily_new,
            "review_cap": e.review_cap, "started_at": iso_utc(e.started_at)}


async def books_out(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings) -> dict:
    known = await store.known_words(session, user_id)
    rows = {e.book_id: e for e in await store.enrollments(session, user_id)}
    enabled = enabled_books(settings.wordbook_books)
    out = []
    for b in BOOKS:
        if b.id not in enabled:
            continue
        try:
            progress = planning.progress_of((await ds.index(b.id)).keys, known)
            words, learned, mastered = progress.words, progress.learned, progress.mastered
        except DataUnavailable:
            words, learned, mastered = b.unique, 0, 0
        e = rows.get(b.id)
        out.append({**book_out(b), "words": words, "learned": learned, "mastered": mastered,
                    "enrolled": e is not None, "active": e is not None and e.status == "active"})
    return {"books": out}


async def put_enrollment(session: AsyncSession, user_id: int, settings: Settings, *, book_id: str,
                         daily_new: int | None, review_cap: int | None, order_mode: str | None, now, seed: int) -> dict:
    book_or_fail(settings, book_id)
    fresh = await store.get_enrollment(session, user_id, book_id) is None
    e = await store.enroll(
        session, user_id, book_id,
        daily_new=daily_new if daily_new is not None else (settings.wordbook_daily_new if fresh else None),
        review_cap=review_cap if review_cap is not None else (settings.wordbook_review_cap if fresh else None),
        order_mode=order_mode, now=now, seed=seed)
    return enrollment_out(e)


async def _day_plan(session: AsyncSession, user_id: int, e: WordbookEnrollment, index: BookIndex,
                    known: dict[str, Known], offset: int, now) -> planning.DayPlan:
    new_done, review_done = await store.today_counts(session, user_id, e.book_id, local_day(now, offset))
    return planning.compute_plan(daily_new=e.daily_new, review_cap=e.review_cap, new_done=new_done,
                                 review_done=review_done, review_due=planning.count_due(index.keys, known, now))


async def today_out(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, offset: int,
                    now) -> dict:
    e = await store.active_enrollment(session, user_id)
    empty = {"enrollment": enrollment_out(e) if e else None, "book": None, "plan": None, "progress": None,
             "tomorrow_due": 0}
    if e is None or e.book_id not in enabled_books(settings.wordbook_books):
        return empty  # R-W12:停用的书保留选书记录与学习记录
    index = await index_or_fail(ds, e.book_id)
    known = await store.known_words(session, user_id)
    day_plan = await _day_plan(session, user_id, e, index, known, offset, now)
    return {"enrollment": enrollment_out(e), "book": book_out(book_by_id(e.book_id), available=True),
            "plan": asdict(day_plan), "progress": asdict(planning.progress_of(index.keys, known)),
            "tomorrow_due": planning.count_due_before(index.keys, known, planning.day_end(now, offset, 1))}


# ---- 学新词、复习、作答(S3;盒子写入规则 spec §6.1 / R-W5)----

LEARN_DUE = timedelta(days=1)
KNOWN_BOX, KNOWN_DUE = 2, timedelta(days=4)


@dataclass(frozen=True)
class AnswerInput:
    book_id: str
    key: str
    mode: str
    qtype: str
    choice: str | None
    typed: str | None
    hinted: bool
    known: bool
    offset: int


def question_out(q: Question) -> dict:
    return {"key": q.key, "qtype": q.qtype, "prompt": dict(q.prompt),
            "options": list(q.options) if q.options is not None else None, "length": q.length}


async def _active(session: AsyncSession, ds: DictionaryStore, user_id: int,
                  settings: Settings) -> tuple[WordbookEnrollment, BookIndex]:
    e = await store.active_enrollment(session, user_id)
    if e is None:
        fail(NO_ACTIVE)
    book_or_fail(settings, e.book_id)
    await ensure_hidden(session, ds)
    return e, await index_or_fail(ds, e.book_id)


async def _question(ds: DictionaryStore, index: BookIndex, card: WordCard, qtype: str, rng) -> Question:
    distractors: list[WordCard] = []
    if qtype in CHOICE_QTYPES:
        pool = await cards_or_fail(ds, index.book_id, candidate_keys(index, card.key, rng))
        distractors = pick_distractors(card, list(pool.values()), qtype, rng)
    return build_question(qtype, card, distractors, rng)


async def learn_batch(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, size: int,
                      offset: int, now) -> dict:
    """下一批新词(不建行):词卡 + 每词一道 meaning 小测。cursor 只在真正建行时前进。"""
    e, index = await _active(session, ds, user_id, settings)
    known = await store.known_words(session, user_id)
    left = (await _day_plan(session, user_id, e, index, known, offset, now)).new_left
    order = planning.permutation(len(index), e.seed, e.order_mode)
    keys, _ = planning.next_new(index.keys, order, e.cursor, known, min(size, left))
    cards = list((await cards_or_fail(ds, e.book_id, keys)).values())
    quiz = [question_out(await _question(ds, index, c, "meaning", question_rng(user_id, c.key, 0))) for c in cards]
    return {"book_id": e.book_id, "cards": [card_out(c) for c in cards], "quiz": quiz}


async def review_batch(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, size: int,
                       offset: int, now, *, tts: bool) -> dict:
    """到期词(最久过期在前)各一道题;题型由 (user_id, key, reps) 决定,同一次复习结果稳定。
    `cards` 是列表(每张卡带 key),不是以词为键的映射。"""
    e, index = await _active(session, ds, user_id, settings)
    known = await store.known_words(session, user_id)
    left = (await _day_plan(session, user_id, e, index, known, offset, now)).review_left
    keys = planning.due_keys(index.keys, known, now, min(size, left))
    cards = list((await cards_or_fail(ds, e.book_id, keys)).values())
    questions = []
    for card in cards:
        row = known[card.key]
        rng = question_rng(user_id, card.key, row.reps)
        qtype = pick_qtype(row.box, card, rng, tts=tts)
        questions.append(question_out(await _question(ds, index, card, qtype, rng)))
    return {"book_id": e.book_id, "questions": questions, "cards": [card_out(c) for c in cards]}


def _validate(p: AnswerInput) -> None:
    if p.known:
        if p.mode != "learn":
            raise WordbookError(422, "Known is only for new words")
    elif p.qtype in CHOICE_QTYPES:
        if p.choice is None:
            raise WordbookError(422, "Choice is required")
    elif p.typed is None:
        raise WordbookError(422, "Answer is required")


async def answer(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, p: AnswerInput,
                 now) -> dict:
    """无状态判分(P-W2):只信任 (book_id, key, qtype),答案从词卡重新算。用户输入不记日志、不入库。"""
    book_or_fail(settings, p.book_id)
    _validate(p)
    card = (await cards_or_fail(ds, p.book_id, [p.key])).get(p.key)
    if card is None:
        fail(WORD_NOT_FOUND)
    day = local_day(now, p.offset)
    if not await store.consume_answer(session, user_id, day):
        fail(ANSWER_LIMIT)
    diff = None
    if p.known:
        outcome, credit = "known", 100
    elif p.qtype in CHOICE_QTYPES:
        outcome = "correct" if check_choice(p.qtype, card, p.choice) else "wrong"
        credit = 100 if outcome == "correct" else 0
    else:
        result = grade_blank(card.word, card.key, p.typed, hinted=p.hinted)
        outcome, credit = result.outcome, result.credit
        diff = [asdict(d) for d in result.diff] or None
    grade = "good" if outcome == "known" else srs_grade(outcome, p.hinted)
    row = await store.known_one(session, user_id, card.key)
    applied, item_id, kind = False, row.item_id if row else None, "practice"
    if p.mode == "learn" and row is None:
        box, due = (KNOWN_BOX, now + KNOWN_DUE) if p.known else (0, now + LEARN_DUE)
        item_id = await store.create_item(session, user_id, p.book_id, card, box=box, due_at=due, now=now)
        applied, kind = True, "learn"
        e = await store.get_enrollment(session, user_id, p.book_id)
        if e is not None:
            index = await index_or_fail(ds, p.book_id)
            known = await store.known_words(session, user_id)
            order = planning.permutation(len(index), e.seed, e.order_mode)
            _, cursor = planning.next_new(index.keys, order, e.cursor, known, 0)
            await store.set_cursor(session, user_id, p.book_id, cursor)
    elif p.mode == "review" and row is not None:
        due = row.due_at <= now
        if due or grade == "forgot":  # R-W5:未到期只有答错才改盒
            applied = await apply_review(session, user_id, row.item_id, seen_box=row.box, seen_reps=row.reps,
                                         grade=grade, now=now)
        kind = "review" if due and applied else "practice"
    await store.add_event(session, user_id=user_id, book_id=p.book_id, kind=kind, word=card.key, item_id=item_id,
                          qtype=p.qtype, outcome=outcome, credit=credit, day=day, now=now)
    await session.commit()
    return {"correct": outcome in ("correct", "known"), "outcome": outcome, "grade": grade, "expected": card.word,
            "diff": diff, "item": item_out(await store.known_one(session, user_id, card.key)), "applied": applied}
