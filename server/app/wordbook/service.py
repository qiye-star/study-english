"""背单词编排(spec §6、§7)。路由只做校验与错误映射;这里组合 index / store / 纯模块。

响应里不出现以词为键的映射(网页客户端会把对象键 camelCase 化):列表里每项都带自己的 `key`。"""
import random
from dataclasses import asdict, dataclass
from datetime import timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import WordbookEnrollment, WordbookReport, iso_utc
from app.services.usage import local_day
from app.services.vocabulary import apply_review
from app.wordbook import plan as planning
from app.wordbook import store
from app.wordbook.books import BOOKS, BookSpec, book_by_id, enabled_books
from app.wordbook.cloze import ClozeSet, build_set, line_for
from app.wordbook.entry import WordCard
from app.wordbook.grading import grade_blank, srs_grade, worst
from app.wordbook.index import BookIndex, DataUnavailable, DictionaryStore
from app.wordbook.plan import Known
from app.wordbook.quiz import (CHOICE_QTYPES, Question, build_question, candidate_keys, check_choice, correct_option,
                               pick_distractors, pick_qtype, question_rng)


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
    # Ruling Z-e:expected = 词头;correct_option = 选择题正确项原文(打字题 / 「我认识」为 null)
    option = correct_option(p.qtype, card) if p.qtype in CHOICE_QTYPES and not p.known else None
    return {"correct": outcome in ("correct", "known"), "outcome": outcome, "grade": grade, "expected": card.word,
            "correct_option": option, "diff": diff,
            "item": item_out(await store.known_one(session, user_id, card.key)), "applied": applied}


# ---- 按句拼写、词卡、例句举报(S4;spec §6.6)----

SPELL_PASS = 60
SPELL_QTYPE = "spell_ctx"
SPELL_DUE_POOL = 200


@dataclass(frozen=True)
class SpellLine:
    key: str
    sentence_id: str
    answers: list[tuple[str, bool]]


@dataclass(frozen=True)
class SpellInput:
    book_id: str
    set_id: str
    lines: list[SpellLine]
    offset: int


def set_out(s: ClozeSet) -> dict:
    """文本段里没有答案;空给编号、长度与 `form`(句中实际词形,如 go → went)。

    Ruling Z-c:`form` 只供「首字母」提示(该空减半)与「听这句」朗读(TTS 本来就念出答案)使用,网页在提交前
    不把它渲染进空里;判分仍按 (key, sentence_id) 从词卡重算(P-W2),不信任客户端回传的任何答案。"""
    def line(l):
        forms = iter(l.expected)
        segs = [{"t": "text", "v": x.v} if x.t == "text" else {"t": "blank", "i": x.i, "len": x.len, "form": next(forms)}
                for x in l.segments]
        return {"key": l.key, "sentence_id": l.sentence_id, "segments": segs, "zh": l.zh}
    return {"set_id": s.set_id, "lines": [line(l) for l in s.lines]}


async def spell_sets(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, count: int,
                     size: int, offset: int, now, rng: random.Random | None = None) -> dict:
    """目标词池 = 本书到期词 + 今日新学 + 盒 ≤ 3 的词;前 2×count×size 个打乱后组句;组与组之间不重复词。"""
    e, index = await _active(session, ds, user_id, settings)
    rng = rng or random.Random()
    known = await store.known_words(session, user_id)
    today = await store.today_learned_keys(session, user_id, e.book_id, local_day(now, offset))
    due = planning.due_keys(index.keys, known, now, SPELL_DUE_POOL)
    low = [k for k in index.keys if k in known and known[k].box <= 3]
    ordered = [k for k in dict.fromkeys(due + today + low) if k in index]
    head = ordered[: count * size * 2]
    rng.shuffle(head)
    cards = list((await cards_or_fail(ds, e.book_id, head + ordered[len(head): count * size * 3])).values())
    sets: list[ClozeSet] = []
    while len(sets) < count:
        built = build_set(cards, size=size)
        if built is None:
            break
        sets.append(built)
        used = {line.key for line in built.lines}
        cards = [c for c in cards if c.key not in used]
    return {"book_id": e.book_id, "sets": [set_out(s) for s in sets]}


async def spell_submit(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, p: SpellInput,
                       now) -> dict:
    """无状态:按 (key, sentence_id) 从词卡重新定位句子与空;句子不在词卡里(数据更新/被屏蔽)或空数不对 → 422。"""
    book_or_fail(settings, p.book_id)
    await ensure_hidden(session, ds)
    cards = await cards_or_fail(ds, p.book_id, [line.key for line in p.lines])
    graded = []
    for line in p.lines:
        card = cards.get(line.key)
        if card is None:
            fail(WORD_NOT_FOUND)
        cloze = line_for(card, line.sentence_id)
        if cloze is None or len(cloze.expected) != len(line.answers):
            fail(SENTENCE_CHANGED)
        graded.append((card, cloze, line))
    day = local_day(now, p.offset)
    if not await store.consume_answer(session, user_id, day):
        fail(ANSWER_LIMIT)
    known = await store.known_words(session, user_id)
    words, next_blank, seen = [], 0, set()
    for card, cloze, line in graded:
        results = [grade_blank(exp, lemma, typed, hinted=hinted)
                   for exp, lemma, (typed, hinted) in zip(cloze.expected, cloze.lemmas, line.answers)]
        outcome = worst(r.outcome for r in results)
        hinted = any(h for _, h in line.answers)
        credit = round(sum(r.credit for r in results) / len(results))
        row, kind = known.get(card.key), "blank"
        if row is not None and card.key not in seen:  # 同一词在一次提交里只写一次盒子
            grade = srs_grade(outcome, hinted)
            due = row.due_at <= now
            applied = False
            if due or grade == "forgot":  # R-W5
                applied = await apply_review(session, user_id, row.item_id, seen_box=row.box, seen_reps=row.reps,
                                             grade=grade, now=now)
            kind = "review" if due and applied else "blank"
        seen.add(card.key)
        await store.add_event(session, user_id=user_id, book_id=p.book_id, kind=kind, word=card.key,
                              item_id=row.item_id if row else None, qtype=SPELL_QTYPE, outcome=outcome,
                              credit=credit, day=day, now=now)
        blanks = []
        for r in results:
            blanks.append({"i": next_blank, "outcome": r.outcome, "credit": r.credit, "typed": r.typed,
                           "expected": r.expected, "diff": [asdict(d) for d in r.diff]})
            next_blank += 1
        words.append({"key": card.key, "outcome": outcome, "credit": credit, "blanks": blanks, "card": card_out(card)})
    set_credit = round(sum(w["credit"] for w in words) / len(words))
    counted = set_credit >= SPELL_PASS
    if counted:
        await store.add_event(session, user_id=user_id, book_id=p.book_id, kind="spell_set", word=p.set_id[:100],
                              item_id=None, qtype=None, outcome="done", credit=set_credit, day=day, now=now)
    await session.commit()
    fresh = await store.known_words(session, user_id)
    for w in words:
        w["item"] = item_out(fresh.get(w["key"]))
    return {"credit": set_credit, "counted": counted, "words": words}


async def card_detail(session: AsyncSession, ds: DictionaryStore, settings: Settings, book_id: str, key: str) -> dict:
    book_or_fail(settings, book_id)
    await ensure_hidden(session, ds)
    card = (await cards_or_fail(ds, book_id, [key])).get(key)
    if card is None:
        fail(WORD_NOT_FOUND)
    return card_out(card)


async def find_card(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, key: str) -> WordCard:
    """按词找词卡(AI 讲解用):先当前在学的书,再其他启用的书;数据缺失的书跳过。都没有 → 404。"""
    await ensure_hidden(session, ds)
    e = await store.active_enrollment(session, user_id)
    enabled = enabled_books(settings.wordbook_books)
    books = [e.book_id] if e is not None and e.book_id in enabled else []
    books += [b for b in enabled if b not in books]
    for book_id in books:
        try:
            card = await ds.card(book_id, key)
        except DataUnavailable:
            continue
        if card is not None:
            return card
    fail(WORD_NOT_FOUND)


async def report(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, *, book_id: str,
                 key: str, sentence_id: str, reason: str, offset: int, now) -> dict:
    """例句举报(每人每日 REPORTS_DAILY_MAX 条);句子必须是该词卡当前的例句。"""
    book_or_fail(settings, book_id)
    await ensure_hidden(session, ds)
    card = (await cards_or_fail(ds, book_id, [key])).get(key)
    if card is None:
        fail(WORD_NOT_FOUND)
    if all(e.id != sentence_id for e in card.examples):
        fail(SENTENCE_CHANGED)
    if not await store.consume_report(session, user_id, local_day(now, offset)):
        fail(REPORT_LIMIT)
    row = WordbookReport(user_id=user_id, book_id=book_id, word=key, sentence_id=sentence_id, kind="sentence",
                         reason=reason, status="open", created_at=now)
    session.add(row)
    await session.commit()
    return {"id": row.id}
