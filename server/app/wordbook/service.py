"""背单词编排(spec §6、§7)。路由只做校验与错误映射;这里组合 index / store / 纯模块。

响应里不出现以词为键的映射(网页客户端会把对象键 camelCase 化):列表里每项都带自己的 `key`。"""
import asyncio
import random
import secrets
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass, replace
from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import WORDBOOK_NEW_BOUNDS, WORDBOOK_REVIEW_BOUNDS, Settings
from app.models import WordbookEnrollment, WordbookEvent, WordbookReport, iso_utc
from app.services.usage import local_day, utc_day  # 用量上限按 UTC 日(review m4);计划与事件 day 仍按本地日
from app.services.scheduling import SchedulingPolicy, policy_for
from app.services.vocabulary import INTERVAL_DAYS, apply_lapse, apply_review, normalize_word
from app.wordbook import plan as planning
from app.wordbook import learned
from app.wordbook import recall, store
from app.wordbook.books import BOOKS, BookSpec, book_by_id, enabled_books
from app.wordbook.cloze import ClozeSet, build_set, line_for, set_id_for
from app.wordbook.entry import WordCard, meaning_line
from app.wordbook.grading import grade_blank, review_grade, srs_grade, worst
from app.wordbook.index import BookIndex, DataUnavailable, DictionaryStore
from app.wordbook.examples import provider_for
from app.wordbook.plan import GoalLimits, Known
from app.wordbook.quiz import (CHOICE_QTYPES, Question, build_question, candidate_keys, check_choice, correct_option,
                               pick_distractors, pick_qtype, question_rng, use_recall, free_choice_qtype, free_spellable)
from app.core import learning_events


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
NEW_LIMIT = (429, "Daily new-word limit reached")
BOOK_NOT_ACTIVE = (409, "Book is not active")
QTYPE_MISMATCH = (422, "Question type mismatch")
REPORT_LIMIT = (429, "Daily report limit reached")
RATING_REQUIRED = (422, "Rating is required")
NO_CHANGES = (422, "No changes")
SETTINGS_LIMIT = (429, "Too many settings changes today")
NOT_ENROLLED = (409, "Book not enrolled")
GOAL_NOT_DONE = (409, "Finish today's new words first")
BACKLOG = (409, "Clear the review backlog first")
BOOK_FINISHED = (409, "No new words left in this book")
BONUS_LIMIT = (429, "Daily bonus limit reached")
RESET_LIMIT = (429, "Daily reset limit reached")
CONFIRM_MISMATCH = (422, "Confirmation does not match")
INVALID_CURSOR = (422, "Invalid cursor")
INVALID_DATE = (422, "Invalid date")
INVALID_SCOPE = (422, "Invalid scope")
INVALID_DEF_LANG = (422, "Invalid definition language")
NOTHING_TO_REVIEW = (409, "No words to review")
FREE_LIMIT = (429, "Daily free-review limit reached")
STREAK_LOOKBACK_DAYS = 400
DEFAULT_LIMITS = GoalLimits(WORDBOOK_NEW_BOUNDS[0], WORDBOOK_NEW_BOUNDS[1], WORDBOOK_REVIEW_BOUNDS[0],
                            WORDBOOK_REVIEW_BOUNDS[1], True, 50)  # 没传 settings 的调用点(GP-1)


def limits_of(settings: Settings) -> GoalLimits:
    return GoalLimits(settings.wordbook_daily_new_min, settings.wordbook_daily_new_max,
                      settings.wordbook_review_cap_min, settings.wordbook_review_cap_max,
                      settings.wordbook_review_unlimited, settings.wordbook_bonus_max)


def limits_out(limits: GoalLimits) -> dict:
    return {"daily_new": {"min": limits.new_min, "max": limits.new_max},
            "review_cap": {"min": limits.review_min, "max": limits.review_max},
            "review_unlimited": limits.unlimited, "bonus_max": limits.bonus_max}


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
    await ds.definitions.warm()  # English definitions: read the file off the event loop once per process


def book_out(b: BookSpec, **extra) -> dict:
    return {"id": b.id, "title_zh": b.title_zh, "title_en": b.title_en, "level": b.level, "words": b.unique, **extra}


def config_out(settings: Settings, def_lang: str = store.DEFAULT_DEF_LANG) -> dict:
    """GET /api/wordbook/config(开关打开时)。available = 数据文件存在(校验和由管理端「诊断」检查)。"""
    data_dir = settings.resolved_wordbook_data_dir
    enabled = enabled_books(settings.wordbook_books)
    return {
        "enabled": True,
        "ai_available": settings.wordbook_ai_available,
        "defaults": {"daily_new": settings.wordbook_daily_new, "review_cap": settings.wordbook_review_cap},
        "learn": {"autoplay": settings.wordbook_autoplay, "show_example": settings.wordbook_show_example},  # recall §7
        "limits": limits_out(limits_of(settings)),  # goals §9
        "def_lang": def_lang,  # 释义显示偏好 both | zh | en(spec 2026-10-12-wordbook-definitions §4)
        "books": [book_out(b, available=(data_dir / b.file).is_file()) for b in BOOKS if b.id in enabled],
    }


async def def_lang_of(session: AsyncSession, user_id: int) -> str:
    return await store.get_def_lang(session, user_id)


def card_out(card: WordCard, ds: DictionaryStore) -> dict:
    """The one place a card object is built. `defs_en` (spec 2026-10-12 §4) is additive: absent = no English definition."""
    out = {"key": card.key, "word": card.word, "us": card.us, "uk": card.uk,
           "senses": [{"pos": s.pos, "text": s.text} for s in card.senses],
           "phrases": [{"en": en, "zh": zh} for en, zh in card.phrases],
           "examples": [{"id": e.id, "en": e.en, "zh": e.zh} for e in card.examples]}
    if defs := ds.definitions.defs_for(card.key):
        out["defs_en"] = defs
    return out


def item_out(known: Known | None) -> dict | None:
    return None if known is None else {"box": known.box, "due_at": iso_utc(known.due_at)}


def enrollment_out(e: WordbookEnrollment, limits: GoalLimits = DEFAULT_LIMITS) -> dict:
    """有效值(GP-2):超出当前范围的旧值夹到范围内;「不限」返回 review_cap 0 + review_unlimited true。"""
    daily_new, cap = planning.effective_goals(e.daily_new, e.review_cap, limits)
    return {"book_id": e.book_id, "status": e.status, "order_mode": e.order_mode, "daily_new": daily_new,
            "review_cap": planning.REVIEW_UNLIMITED if cap is None else cap, "started_at": iso_utc(e.started_at),
            "review_unlimited": cap is None}


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
                         daily_new: int | None, review_cap: int | None, order_mode: str | None, now, seed: int,
                         review_unlimited: bool = False) -> dict:
    book_or_fail(settings, book_id)
    limits = limits_of(settings)
    if error := planning.goals_error(limits, daily_new=daily_new, review_cap=review_cap, unlimited=review_unlimited):
        raise WordbookError(422, error)
    fresh = await store.get_enrollment(session, user_id, book_id) is None
    if review_unlimited:
        review_cap = planning.REVIEW_UNLIMITED
    e = await store.enroll(
        session, user_id, book_id,
        daily_new=daily_new if daily_new is not None else (settings.wordbook_daily_new if fresh else None),
        review_cap=review_cap if review_cap is not None else (settings.wordbook_review_cap if fresh else None),
        order_mode=order_mode, now=now, seed=seed)
    return enrollment_out(e, limits)


async def _day_plan(session: AsyncSession, user_id: int, e: WordbookEnrollment, index: BookIndex,
                    known: dict[str, Known], offset: int, now, *, settings: Settings | None = None) -> planning.DayPlan:
    """计划的唯一入口(GP-1):有效值、今日加练、本书剩余新词都在这里;作答与出题的检查因此自动包含它们。"""
    limits = limits_of(settings) if settings is not None else DEFAULT_LIMITS
    day = local_day(now, offset)
    new_done, review_done = await store.today_counts(session, user_id, e.book_id, day)
    daily_new, cap = planning.effective_goals(e.daily_new, e.review_cap, limits)
    return planning.compute_plan(daily_new=daily_new, review_cap=cap, new_done=new_done, review_done=review_done,
                                 review_due=planning.count_due(index.keys, known, now),
                                 bonus=await store.bonus_today(session, user_id, e.book_id, day),
                                 guard_threshold=limits.review_max,
                                 remaining=sum(1 for k in index.keys if k not in known))


async def _streak(session: AsyncSession, user_id: int, day: str) -> dict:
    since = (date.fromisoformat(day) - timedelta(days=STREAK_LOOKBACK_DAYS)).isoformat()
    days = await store.goal_days(session, user_id, since)
    return {"current": planning.streak_of(days, day), "today_met": day in days}


async def today_out(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, offset: int,
                    now) -> dict:
    limits = limits_of(settings)
    day = local_day(now, offset)
    enabled = enabled_books(settings.wordbook_books)
    e = await store.active_enrollment(session, user_id)
    if e is None or e.book_id not in enabled:  # R-W12:停用的书保留选书记录与学习记录
        paused = await store.latest_paused(session, user_id, enabled) if e is None else None
        return {"enrollment": enrollment_out(e, limits) if e else None, "book": None, "plan": None, "progress": None,
                "tomorrow_due": 0, "paused": enrollment_out(paused, limits) if paused else None,
                "streak": await _streak(session, user_id, day)}
    index = await index_or_fail(ds, e.book_id)
    known = await store.known_words(session, user_id)
    day_plan = await _day_plan(session, user_id, e, index, known, offset, now, settings=settings)
    # 达标一天写一行(G-6);维护模式(只读窗口)不写
    if day_plan.goal_met and settings.maintenance_mode == "off" and await store.mark_goal(
            session, user_id, e.book_id, day, now):
        await session.commit()
    return {"enrollment": enrollment_out(e, limits), "book": book_out(book_by_id(e.book_id), available=True),
            "plan": asdict(day_plan), "progress": asdict(planning.progress_of(index.keys, known)),
            "tomorrow_due": planning.count_due_before(index.keys, known, planning.day_end(now, offset, 1)),
            "paused": None, "streak": await _streak(session, user_id, day)}


# ---- 学新词、复习、作答(S3;盒子写入规则 spec §6.1 / R-W5)----

LEARN_DUE = timedelta(days=1)

OPTION_INFO_QTYPES = ("meaning", "word", "cloze")  # 答题后回填「选项 → 词」的题型(cloze 选项与 word 一样是词头)
MAX_ANSWER_PHRASES = 3
MAX_OPTION_DEFS_ZH = 4  # 与 lookup.MAX_ZH 相同


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
    rating: str | None = None          # 背单词 v2(spec recall §9.1):know | fuzzy | unknown
    revealed_before: bool = False
    elapsed_ms: int | None = None


def question_out(q: Question) -> dict:
    out = {"key": q.key, "qtype": q.qtype, "prompt": dict(q.prompt),
           "options": list(q.options) if q.options is not None else None, "length": q.length}
    if q.clip is not None:  # L4 R16: only the learner's own clip; old clients ignore the extra key
        out["clip"] = {"item_id": q.clip.item_id, "start_ms": q.clip.start_ms, "end_ms": q.clip.end_ms}
    return out


async def _active(session: AsyncSession, ds: DictionaryStore, user_id: int,
                  settings: Settings) -> tuple[WordbookEnrollment, BookIndex]:
    e = await store.active_enrollment(session, user_id)
    if e is None:
        fail(NO_ACTIVE)
    book_or_fail(settings, e.book_id)
    await ensure_hidden(session, ds)
    return e, await index_or_fail(ds, e.book_id)


def _option_text(qtype: str, card: WordCard) -> str:
    """与 quiz.build_question 放进 options 的那一项逐字相同:meaning = 释义行,word / cloze = 词头。"""
    return meaning_line(card) if qtype == "meaning" else card.word


async def _choice_extras(ds: DictionaryStore, user_id: int, p: AnswerInput, card: WordCard) -> dict:
    """/answers 的追加字段(spec 2026-10-13-review-after-answer §2.2),只给 meaning / word / cloze 选择题,全部可选:
    `phrases`(≤ 3)与 `example`(第一条例句)来自词卡,没有就省略键;`option_info` 来自出题时的备忘(R-A1),
    备忘取不到、你选的项或正确项不在其中、或有词卡读不出来时整个省略。只在判分之后调用:题面不泄露(R-A5)。"""
    if p.qtype not in OPTION_INFO_QTYPES:
        return {}
    out: dict = {}
    if card.phrases:
        out["phrases"] = [{"en": en, "zh": zh} for en, zh in card.phrases[:MAX_ANSWER_PHRASES]]
    if card.examples:
        e = card.examples[0]
        out["example"] = {"id": e.id, "en": e.en, "zh": e.zh}
    pairs = ds.option_memo.recall(user_id, p.book_id, card.key, p.qtype)
    if not pairs or p.choice is None or not {p.choice, correct_option(p.qtype, card)} <= {o for o, _ in pairs}:
        return out
    try:
        cards = await ds.cards(p.book_id, [k for _, k in pairs])
    except DataUnavailable:
        return out
    if not all(k in cards for _, k in pairs):
        return out
    out["option_info"] = [
        {"option": option, "word": cards[k].word,
         "defs_zh": [{"pos": s.pos, "text": s.text} for s in cards[k].senses[:MAX_OPTION_DEFS_ZH]],
         "defs_en": ds.definitions.defs_for(k)}
        for option, k in pairs]
    return out


async def _question(ds: DictionaryStore, index: BookIndex, card: WordCard, qtype: str, rng, *,
                    user_id: int | None = None, example=None) -> Question:
    distractors: list[WordCard] = []
    if qtype in CHOICE_QTYPES:
        pool = await cards_or_fail(ds, index.book_id, candidate_keys(index, card.key, rng))
        distractors = pick_distractors(card, list(pool.values()), qtype, rng)
    question = build_question(qtype, card, distractors, rng, example=example)
    if user_id is not None and qtype in OPTION_INFO_QTYPES and question.options is not None:
        # R-A1:出题时记下「选项原文 -> 词键」(与题面同序),答题后回填 option_info;对不上(重复文本等)就不记
        owners = {_option_text(qtype, c): c.key for c in (card, *distractors)}
        pairs = tuple((o, owners[o]) for o in question.options if o in owners)
        if len(owners) == len(question.options) == len(pairs):
            ds.option_memo.remember(user_id, index.book_id, card.key, qtype, pairs)
    return question


async def learn_batch(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, size: int,
                      offset: int, now) -> dict:
    """下一批新词(不建行):词卡 + 每词一道 meaning 小测 + 每词一道 word 再认(drill)。cursor 只在真正建行时前进。"""
    e, index = await _active(session, ds, user_id, settings)
    known = await store.known_words(session, user_id)
    left = (await _day_plan(session, user_id, e, index, known, offset, now, settings=settings)).new_left
    order = planning.permutation(len(index), e.seed, e.order_mode)
    keys, _ = planning.next_new(index.keys, order, e.cursor, known, min(size, left))
    cards = list((await cards_or_fail(ds, e.book_id, keys)).values())
    quiz = [question_out(await _question(ds, index, c, "meaning", question_rng(user_id, c.key, 0), user_id=user_id)) for c in cards]
    # spec recall §3.3:「不认识」的词在本轮小测里第二次出现时用看释义选词(随机源与 quiz 不同)
    drill = [question_out(await _question(ds, index, c, "word", question_rng(user_id, c.key, 1), user_id=user_id)) for c in cards]
    return {"book_id": e.book_id, "cards": [card_out(c, ds) for c in cards], "quiz": quiz, "drill": drill}


async def review_batch(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, size: int,
                       offset: int, now, *, tts: bool, recall_ok: bool = False) -> dict:
    """到期词(最久过期在前)各一道题;题型由 (user_id, key, reps) 决定,同一次复习结果稳定。
    `cards` 是列表(每张卡带 key),不是以词为键的映射。spec recall §4.1:客户端声明 `recall_ok` 且设置开时,
    按独立哈希把一部分题换成「快速回忆」(v1 的选题结果不变)。"""
    e, index = await _active(session, ds, user_id, settings)
    known = await store.known_words(session, user_id)
    left = (await _day_plan(session, user_id, e, index, known, offset, now, settings=settings)).review_left
    keys = planning.due_keys(index.keys, known, now, min(size, left))
    cards = list((await cards_or_fail(ds, e.book_id, keys)).values())
    recall_on = recall_ok and settings.wordbook_recall_enabled
    questions = []
    for card in cards:
        row = known[card.key]
        rng = question_rng(user_id, card.key, row.reps)
        qtype = "recall" if recall_on and use_recall(user_id, card.key, row.reps, row.box) else pick_qtype(
            row.box, card, rng, tts=tts)
        example = None  # L4 R13/R15: only a cloze question may take the learner's own sentence (port: no DB for dictionary)
        if qtype == "cloze":
            example = await provider_for(settings).cloze_example(session, user_id, card, row.reps)
        questions.append(question_out(await _question(ds, index, card, qtype, rng, user_id=user_id, example=example)))
    return {"book_id": e.book_id, "questions": questions, "cards": [card_out(c, ds) for c in cards]}


async def _write_srs(session: AsyncSession, user_id: int, row: Known, grade: str, now,
                     policy: SchedulingPolicy) -> tuple[bool, bool]:
    """(applied, due)。到期 → 一次复习(reps + 1,产生 vocab_review);未到期只有答错才改盒(R-W5),
    且走 apply_lapse:不加 reps,不产生段位事件(review B1);盒 0 已是「忘了」,不写。
    排期引擎由 policy 决定(L3 R10:同一用户同一时刻只有一种引擎)。"""
    due = row.due_at <= now
    if due:
        return await apply_review(session, user_id, row.item_id, seen_box=row.box, seen_reps=row.reps,
                                  grade=grade, now=now, policy=policy), True
    if grade == "forgot":
        return await apply_lapse(session, user_id, row.item_id, seen_box=row.box, seen_reps=row.reps, now=now,
                                 policy=policy), False
    return False, False


def _allowed_qtypes(user_id: int, row: Known, card: WordCard, *, recall_on: bool = False) -> set[str]:
    """review m2:到期复习(会改盒)的题型必须是 review_batch 按 (user_id, key, reps) 选的那个。TTS 设置可能在出题后
    变化,两种都接受;网页没有 TTS 时把听写换成看释义拼写(spec §11.4),所以听写也接受 spell。
    spec recall §4.1:快速回忆开着且这次复习选中了它时,另外接受 recall(旧客户端仍按 v1 题型作答)。"""
    allowed = {pick_qtype(row.box, card, question_rng(user_id, card.key, row.reps), tts=tts) for tts in (True, False)}
    if recall_on and use_recall(user_id, card.key, row.reps, row.box):
        allowed.add("recall")
    return allowed | ({"spell"} if "dictation" in allowed else set())


def _validate(p: AnswerInput) -> None:
    if p.known:
        if p.mode != "learn":
            raise WordbookError(422, "Known is only for new words")
    elif p.qtype == recall.RECALL_QTYPE:
        if p.rating not in recall.RATINGS:
            fail(RATING_REQUIRED)
    elif p.qtype in CHOICE_QTYPES:
        if p.choice is None:
            raise WordbookError(422, "Choice is required")
    elif p.typed is None:
        raise WordbookError(422, "Answer is required")


_learn_locks: dict[int, list] = {}  # user_id -> [asyncio.Lock, holders + waiters]


@asynccontextmanager
async def _learn_lock(user_id: int) -> AsyncIterator[None]:
    """同一用户的学新词作答串行(Z2):「读到没有这行 → 建行 → 记 learn」之间不能被同一用户的另一个请求插进来,
    否则连点 / 并发会建出重复行、记几次 learn(每次一个 word_learned 段位点)。只在本进程内有效(部署是单 worker)。"""
    entry = _learn_locks.setdefault(user_id, [asyncio.Lock(), 0])
    entry[1] += 1
    try:
        async with entry[0]:
            yield
    finally:
        entry[1] -= 1
        if entry[1] == 0:
            _learn_locks.pop(user_id, None)


async def answer(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, p: AnswerInput,
                 now) -> dict:
    """无状态判分(P-W2):只信任 (book_id, key, qtype),答案从词卡重新算。用户输入不记日志、不入库。
    qtype=recall 是三档自评(spec recall §5),盒子由服务端决定;其余是 v1 客观题。学新词模式按用户串行。"""
    if p.mode != "learn":
        return await _answer(session, ds, user_id, settings, p, now)
    async with _learn_lock(user_id):
        return await _answer(session, ds, user_id, settings, p, now)


async def _answer(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, p: AnswerInput,
                  now) -> dict:
    book_or_fail(settings, p.book_id)
    _validate(p)
    if p.mode == "free":  # 随时自由复习:与学新词 / 复习的写盒子路径完全隔离(R-L6、R-L8)
        return await _free_answer(session, ds, user_id, settings, p, now)
    if p.known:  # R-R7:v1 的「我认识」= 没偷看的「认识」,同样受抽查规则约束
        p = replace(p, qtype=recall.RECALL_QTYPE, rating="know", revealed_before=False, elapsed_ms=None, known=False)
    await ensure_hidden(session, ds)  # review m5:create_item 会复制例句,先载入屏蔽集合
    card = (await cards_or_fail(ds, p.book_id, [p.key])).get(p.key)
    if card is None:
        fail(WORD_NOT_FOUND)
    day = local_day(now, p.offset)
    row = await store.known_one(session, user_id, card.key)
    learning = p.mode == "learn" and row is None
    ctx: _LearnContext | None = None
    if learning:  # review M1:新词只在当前在学的书里学,且受每日新词数限制(服务器端)
        e = await store.active_enrollment(session, user_id)
        if e is None:
            fail(NO_ACTIVE)
        if e.book_id != p.book_id:
            fail(BOOK_NOT_ACTIVE)
        index = await index_or_fail(ds, p.book_id)
        known = await store.known_words(session, user_id)
        if (await _day_plan(session, user_id, e, index, known, p.offset, now, settings=settings)).new_left <= 0:
            fail(NEW_LIMIT)
        ctx = _LearnContext(e, index, known)
    if (p.mode == "review" and row is not None and row.due_at <= now
            and p.qtype not in _allowed_qtypes(user_id, row, card, recall_on=settings.wordbook_recall_enabled)):
        fail(QTYPE_MISMATCH)
    if not await store.consume_answer(session, user_id, utc_day(now)):
        fail(ANSWER_LIMIT)
    if p.qtype == recall.RECALL_QTYPE:
        return await _rating_answer(session, ds, user_id, settings, p, card, row, ctx, now)
    diff = None
    if p.qtype in CHOICE_QTYPES:
        outcome = "correct" if check_choice(p.qtype, card, p.choice) else "wrong"
        credit = 100 if outcome == "correct" else 0
    else:
        result = grade_blank(card.word, card.key, p.typed, hinted=p.hinted)
        outcome, credit = result.outcome, result.credit
        diff = [asdict(d) for d in result.diff] or None
    grade = srs_grade(outcome, p.hinted)  # the response field stays three-valued (L3 R5)
    write_grade = review_grade(outcome, p.hinted, qtype=p.qtype, elapsed_ms=p.elapsed_ms, length=len(card.word))
    applied, item_id, kind, reviewed_at = False, row.item_id if row else None, "practice", None
    if ctx is not None:
        kind = await _learn_kind(session, user_id, card.key)
        item_id = await _create_learned(session, user_id, p.book_id, card, 0, now, ctx)
        applied = True
    elif p.mode == "review" and row is not None:
        applied, due = await _write_srs(session, user_id, row, write_grade, now, policy_for(settings, user_id))
        kind = "review" if due and applied else "practice"
        reviewed_at = now if applied else None
    elif p.mode == "learn" and row is not None and row.reps == 0 and p.qtype in CHOICE_QTYPES:
        applied = await _learn_day_quiz(session, user_id, row, card.key, day, outcome == "correct", now,
                                        qtype=p.qtype)
    await store.add_event(session, user_id=user_id, book_id=p.book_id, kind=kind, word=card.key, item_id=item_id,
                          qtype=p.qtype, outcome=outcome, credit=credit, day=day, now=now, reviewed_at=reviewed_at)
    await session.commit()
    learning_events.publish(learning_events.WordAnswered(
        user_id=user_id, book_id=p.book_id, word=card.key, kind=kind, qtype=p.qtype, outcome=outcome, credit=credit,
        at=now))
    # Ruling Z-e:expected = 词头;correct_option = 选择题正确项原文(打字题为 null)
    option = correct_option(p.qtype, card) if p.qtype in CHOICE_QTYPES else None
    extras = await _choice_extras(ds, user_id, p, card) if p.qtype in CHOICE_QTYPES else None
    return _answer_out(outcome == "correct", outcome, grade, card, option, diff,
                       await store.known_one(session, user_id, card.key), applied, extras=extras)


@dataclass(frozen=True)
class _LearnContext:
    """新词建行所需(answer() 的前置校验已经读过):当前在学的书、它的索引、用户全部词条。"""
    enrollment: WordbookEnrollment
    index: BookIndex
    known: dict[str, Known]


def _answer_out(correct: bool, outcome: str, grade: str | None, card: WordCard, option: str | None, diff,
                known: Known | None, applied: bool, *, rating: str | None = None, spot_check: bool = False,
                check: dict | None = None, extras: dict | None = None) -> dict:
    """/answers 的响应。spec recall §9.1 追加 rating / spot_check / check(非自评题为 null / false / null)。"""
    out = {"correct": correct, "outcome": outcome, "grade": grade, "expected": card.word, "correct_option": option,
            "diff": diff, "item": item_out(known), "applied": applied, "rating": rating, "spot_check": spot_check,
            "check": check}
    if extras:
        out.update(extras)
    return out


async def _learn_kind(session: AsyncSession, user_id: int, key: str) -> str:
    """新词建行时的事件 kind:该用户第一次学这个词 → learn(计今日新词、产生 word_learned)。
    每个词只记一次 learn(以前学过的再学记 relearn:计入今日新词,不产生 word_learned;spec 2026-10-11 G-4)。
    v1 选择题路径与三档自评路径共用这一处(INDEX R-A2)。"""
    return "relearn" if await store.ever_learned(session, user_id, key) else "learn"


async def _create_learned(session: AsyncSession, user_id: int, book_id: str, card: WordCard, box: int, now,
                          ctx: _LearnContext) -> str:
    """新词建行并推进 cursor(两条学新词路径共用;cursor 只在真正建行时前进)。不提交。"""
    due = now + timedelta(days=INTERVAL_DAYS[box])
    item_id = await store.create_item(session, user_id, book_id, card, box=box, due_at=due, now=now)
    ctx.known[card.key] = Known(item_id, box, due, 0, store.wordbook_source(book_id))
    e = ctx.enrollment
    order = planning.permutation(len(ctx.index), e.seed, e.order_mode)
    _, cursor = planning.next_new(ctx.index.keys, order, e.cursor, ctx.known, 0)
    await store.set_cursor(session, user_id, book_id, cursor)
    return item_id


async def _learn_day_quiz(session: AsyncSession, user_id: int, row: Known, key: str, day: str, correct: bool,
                          now, *, qtype: str) -> bool:
    """spec recall §5.4:当天自评过的新词(reps = 0)在本轮小测里答错 → 盒 0;抽查(know_chk)答对 → 盒 2。
    不是复习:不加 reps,不产生段位事件。当天没有自评(从生词本加入的词、昨天学的词)→ 不改。
    Z2:只有选释义题能通过抽查(看释义选词的答案就是词头),且抽中之后又再评过(只降不升)就不再升。"""
    first = await store.first_rating_on(session, user_id, key, day)
    if not first:
        return False
    passes = qtype == "meaning" and await store.last_rating(session, user_id, key) == recall.KNOW_CHECK
    target = recall.learn_quiz_target(row.box, first, correct, passes_check=passes)
    if target is None:
        return False
    return await store.set_learn_box(session, user_id, row.item_id, seen_box=row.box, to_box=target, now=now)


async def _spot_seed(session: AsyncSession, user_id: int, book_id: str, row: Known | None) -> int:
    """抽查种子(P-R1):学这个词的那本书的选书 seed(服务端私有)。复习请求里的 book_id 由客户端给,
    换成一本没选过的书不能让种子退回可预测的 0(Z2);词不是从词书来的 → 请求的书 → 当前在学的书 → 0。"""
    books = [row.source[len(store.SOURCE_PREFIX):]] if row is not None and row.source.startswith(store.SOURCE_PREFIX) else []
    for b in [*books, book_id]:
        e = await store.get_enrollment(session, user_id, b)
        if e is not None:
            return e.seed
    e = await store.active_enrollment(session, user_id)
    return e.seed if e is not None else 0


async def _rating_answer(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings,
                         p: AnswerInput, card: WordCard, row: Known | None, ctx: _LearnContext | None, now) -> dict:
    """三档自评(spec recall §5):有效评级 → 学新词建行 / 当天再评只降 / 复习 good·hard·forgot,抽查两步。"""
    day = local_day(now, p.offset)
    rating = recall.effective_rating(p.rating, revealed_before=p.revealed_before,
                                     previous=await store.last_rating(session, user_id, card.key))
    seed = await _spot_seed(session, user_id, p.book_id, row)  # 私有种子:客户端算不出哪些词会被抽查(P-R1)
    pct = settings.wordbook_spot_check_pct
    applied, item_id, kind, outcome, spot = False, row.item_id if row else None, "practice", rating, False
    reviewed_at = None
    if ctx is not None:
        decision = recall.learn_decision(rating, recall.needs_check(
            rating, seed=seed, user_id=user_id, key=card.key, reps=0, pct=pct, elapsed_ms=p.elapsed_ms))
        kind = await _learn_kind(session, user_id, card.key)
        item_id = await _create_learned(session, user_id, p.book_id, card, decision.box, now, ctx)
        applied, outcome, spot = True, decision.outcome, decision.spot_check
    elif p.mode == "learn" and row is not None:
        if row.reps == 0 and await store.first_rating_on(session, user_id, card.key, day):
            target = recall.learn_rerate_target(row.box, rating)
            if target is not None:
                applied = await store.set_learn_box(session, user_id, row.item_id, seen_box=row.box, to_box=target,
                                                    now=now)
    elif p.mode == "review" and row is not None:
        due = row.due_at <= now
        if rating == "know" and p.choice is not None:  # 抽查的第二步:按选释义判
            outcome = "know" if check_choice("meaning", card, p.choice) else "unknown"
        elif due and recall.needs_check(rating, seed=seed, user_id=user_id, key=card.key, reps=row.reps, pct=pct,
                                        elapsed_ms=p.elapsed_ms):
            index = await index_or_fail(ds, p.book_id)
            q = await _question(ds, index, card, "meaning", question_rng(user_id, card.key, row.reps))
            await session.commit()  # 只扣了作答次数;不写盒、不记事件(R-R6)
            return _answer_out(False, "pending", None, card, None, None, row, False, rating="know", spot_check=True,
                               check=question_out(q))
        applied, due = await _write_srs(session, user_id, row, recall.GRADE[outcome], now,
                                        policy_for(settings, user_id))
        kind = "review" if due and applied else "practice"
        reviewed_at = now if applied else None
    eff = recall.as_rating(outcome)
    await store.add_event(session, user_id=user_id, book_id=p.book_id, kind=kind, word=card.key, item_id=item_id,
                          qtype=recall.RECALL_QTYPE, outcome=outcome, credit=100 if eff == "know" else 0, day=day,
                          now=now, reviewed_at=reviewed_at)
    await session.commit()
    learning_events.publish(learning_events.WordAnswered(
        user_id=user_id, book_id=p.book_id, word=card.key, kind=kind, qtype=recall.RECALL_QTYPE, outcome=outcome,
        credit=100 if eff == "know" else 0, at=now))
    checked = p.mode == "review" and p.choice is not None and rating == "know"
    return _answer_out(eff == "know", eff, recall.GRADE[eff], card, correct_option("meaning", card) if checked else None,
                       None, await store.known_one(session, user_id, card.key), applied, rating=eff, spot_check=spot)


# ---- 自由复习作答(spec 2026-10-12 §1.3;计划 2026-10-12-wordbook-learned-review S5)----

async def _free_answer(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, p: AnswerInput,
                       now) -> dict:
    """永不改盒子 / reps / last_reviewed_at,事件 kind 固定 practice。答错且(未到期、24h 内没复习、今日拉取未满)时
    只把 due_at 改为现在(R-L6);其余一律不动。答对与到期的词原样不变。"""
    await ensure_hidden(session, ds)
    card = (await cards_or_fail(ds, p.book_id, [p.key])).get(p.key)
    if card is None:
        fail(WORD_NOT_FOUND)
    row = await store.known_one(session, user_id, card.key)
    if row is None or row.source != store.wordbook_source(p.book_id):
        fail(WORD_NOT_FOUND)
    if not await store.consume_answer(session, user_id, utc_day(now)):
        fail(ANSWER_LIMIT)
    diff = option = rating = None
    if p.qtype == recall.RECALL_QTYPE:  # R-L7:有效评级只看这一次,不看历史
        rating = recall.effective_rating(p.rating, revealed_before=p.revealed_before, previous=None)
        outcome, credit, correct, wrong, grade = rating, 100 if rating == "know" else 0, rating == "know", \
            rating == "unknown", recall.GRADE[rating]
    elif p.qtype in CHOICE_QTYPES:
        correct = check_choice(p.qtype, card, p.choice)
        outcome, credit, wrong = ("correct", 100, False) if correct else ("wrong", 0, True)
        grade, option = srs_grade(outcome, p.hinted), correct_option(p.qtype, card)
    else:
        result = grade_blank(card.word, card.key, p.typed, hinted=p.hinted)
        outcome, credit, diff = result.outcome, result.credit, [asdict(d) for d in result.diff] or None
        grade = srs_grade(outcome, p.hinted)
        correct, wrong = outcome == "correct", grade == "forgot"
    queued = False
    if wrong and row.due_at > now and await store.pull_eligible(session, user_id, row.item_id, now) \
            and await store.consume_free_pull(session, user_id, utc_day(now)):
        queued = await store.pull_due(session, user_id, row.item_id, now)
    await store.add_event(session, user_id=user_id, book_id=p.book_id, kind="practice", word=card.key,
                          item_id=row.item_id, qtype=p.qtype, outcome=outcome, credit=credit,
                          day=local_day(now, p.offset), now=now)
    await session.commit()
    learning_events.publish(learning_events.WordAnswered(
        user_id=user_id, book_id=p.book_id, word=card.key, kind="practice", qtype=p.qtype, outcome=outcome,
        credit=credit, at=now))
    extras = await _choice_extras(ds, user_id, p, card) if p.qtype in CHOICE_QTYPES else None
    return _answer_out(correct, outcome, grade, card, option, diff, await store.known_one(session, user_id, card.key),
                       queued, rating=rating, extras=extras)


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
    if not await store.consume_answer(session, user_id, utc_day(now)):
        fail(ANSWER_LIMIT)
    known = await store.known_words(session, user_id)
    words, next_blank, seen = [], 0, set()
    answered: list = []
    for card, cloze, line in graded:
        results = [grade_blank(exp, lemma, typed, hinted=hinted)
                   for exp, lemma, (typed, hinted) in zip(cloze.expected, cloze.lemmas, line.answers)]
        outcome = worst(r.outcome for r in results)
        hinted = any(h for _, h in line.answers)
        credit = round(sum(r.credit for r in results) / len(results))
        row, kind, reviewed_at = known.get(card.key), "blank", None
        if row is not None and card.key not in seen:  # 同一词在一次提交里只写一次盒子
            applied, due = await _write_srs(session, user_id, row, srs_grade(outcome, hinted), now,
                                            policy_for(settings, user_id))
            kind = "review" if due and applied else "blank"
            reviewed_at = now if applied else None
        seen.add(card.key)
        await store.add_event(session, user_id=user_id, book_id=p.book_id, kind=kind, word=card.key,
                              item_id=row.item_id if row else None, qtype=SPELL_QTYPE, outcome=outcome,
                              credit=credit, day=day, now=now, reviewed_at=reviewed_at)
        answered.append(learning_events.WordAnswered(
            user_id=user_id, book_id=p.book_id, word=card.key, kind=kind, qtype=SPELL_QTYPE, outcome=outcome,
            credit=credit, at=now))
        blanks = []
        for r in results:
            blanks.append({"i": next_blank, "outcome": r.outcome, "credit": r.credit, "typed": r.typed,
                           "expected": r.expected, "diff": [asdict(d) for d in r.diff]})
            next_blank += 1
        words.append({"key": card.key, "outcome": outcome, "credit": credit, "blanks": blanks, "card": card_out(card, ds)})
    set_credit = round(sum(w["credit"] for w in words) / len(words))
    # 同一组(服务端按 (key, sentence_id) 重算的 set_id,不用客户端传的)每个本地日只计一次:「再练一遍」不再得分
    set_id = set_id_for([cloze for _, cloze, _ in graded])
    counted = set_credit >= SPELL_PASS and not await store.spell_set_done(session, user_id, set_id, day)
    if counted:
        await store.add_event(session, user_id=user_id, book_id=p.book_id, kind="spell_set", word=set_id,
                              item_id=None, qtype=None, outcome="done", credit=set_credit, day=day, now=now)
    await session.commit()
    for event in answered:
        learning_events.publish(event)
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
    return card_out(card, ds)


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
    existing = await store.open_report_id(session, user_id, sentence_id)
    if existing is not None:  # review m11:同一人对同一句只有一条 open 举报,不再占用每日次数
        return {"id": existing}
    if not await store.consume_report(session, user_id, utc_day(now)):
        fail(REPORT_LIMIT)
    row = WordbookReport(user_id=user_id, book_id=book_id, word=key, sentence_id=sentence_id, kind="sentence",
                         reason=reason, status="open", created_at=now)
    session.add(row)
    await session.commit()
    return {"id": row.id}


# ---- 每日目标(goals v2,spec 2026-10-11 §3、§9)----

async def patch_enrollment(session: AsyncSession, user_id: int, settings: Settings, *, daily_new: int | None,
                           review_cap: int | None, review_unlimited: bool, order_mode: str | None, now,
                           def_lang: str | None = None) -> dict:
    """改当前在学的书的每日设置,立即生效(今天的计数来自事件,不受影响)。先校验后扣次数。
    `def_lang`(释义显示偏好,按用户、不按书)可以单独传:这时不需要有在学的书;传了就在响应里带回 `def_lang`。
    值没变 = 不写、不扣次数。"""
    goals = not (daily_new is None and review_cap is None and not review_unlimited and order_mode is None)
    if not goals and def_lang is None:
        fail(NO_CHANGES)
    if def_lang is not None and def_lang not in store.DEF_LANGS:
        fail(INVALID_DEF_LANG)
    e = await store.active_enrollment(session, user_id)
    limits = limits_of(settings)
    if goals:
        if e is None:
            fail(NO_ACTIVE)
        book_or_fail(settings, e.book_id)
        if error := planning.goals_error(limits, daily_new=daily_new, review_cap=review_cap, unlimited=review_unlimited):
            raise WordbookError(422, error)
    change_lang = def_lang is not None and def_lang != await store.get_def_lang(session, user_id)
    if (goals or change_lang) and not await store.consume_settings(session, user_id, utc_day(now)):
        fail(SETTINGS_LIMIT)
    if change_lang:
        await store.set_def_lang(session, user_id, def_lang, utc_day(now), now)
    if goals:
        cap = planning.REVIEW_UNLIMITED if review_unlimited else review_cap
        e = await store.update_goals(session, e, daily_new=daily_new, review_cap=cap, order_mode=order_mode, now=now)
    elif change_lang:
        await session.commit()
    out = enrollment_out(e, limits) if e is not None else {}
    return {**out, "def_lang": def_lang} if def_lang is not None else out


BONUS_STEP_MAX = 20  # 每次最多加练 20 个(路由也校验)


async def grant_bonus(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, size: int,
                      offset: int, now) -> dict:
    """今天加练 size 个新词(spec §5):今天的新词学完、不在积压中、本书还有新词、不超过每日加练上限。
    提交后重算:并发双击超出上限的那一次删掉自己那行并返回 429,总量永不超过上限。"""
    e, index = await _active(session, ds, user_id, settings)
    limits = limits_of(settings)
    if limits.bonus_max <= 0:
        fail(BONUS_LIMIT)
    known = await store.known_words(session, user_id)
    plan = await _day_plan(session, user_id, e, index, known, offset, now, settings=settings)
    if plan.backlog_guard:
        fail(BACKLOG)
    if plan.new_left > 0:
        fail(GOAL_NOT_DONE)
    if not any(k not in known for k in index.keys):
        fail(BOOK_FINISHED)
    # 评审 Z1 R-1:今天已学超过目标(白天调低过每日新词)时,超出部分一起记进加练,保证加练 size 个真的能多学 size 个
    credit = size + max(0, plan.new_done - plan.new_target)
    if plan.bonus + credit > limits.bonus_max:
        fail(BONUS_LIMIT)
    if not await store.consume_settings(session, user_id, utc_day(now)):
        fail(SETTINGS_LIMIT)
    day = local_day(now, offset)
    event = WordbookEvent(user_id=user_id, book_id=e.book_id, kind="bonus", word="bonus", item_id=None, qtype=None,
                          outcome="granted", credit=credit, day=day, created_at=now)
    session.add(event)
    await session.commit()
    if await store.bonus_today(session, user_id, e.book_id, day) > limits.bonus_max:
        await session.delete(event)
        await session.commit()
        fail(BONUS_LIMIT)
    plan = await _day_plan(session, user_id, e, index, known, offset, now, settings=settings)
    return {"plan": asdict(plan), "bonus_left": max(0, limits.bonus_max - plan.bonus)}


async def pause(session: AsyncSession, user_id: int, settings: Settings, now) -> dict:
    if await store.active_enrollment(session, user_id) is None:
        fail(NO_ACTIVE)
    if not await store.consume_settings(session, user_id, utc_day(now)):
        fail(SETTINGS_LIMIT)
    e = await store.pause_active(session, user_id, now)
    if e is None:
        fail(NO_ACTIVE)
    return enrollment_out(e, limits_of(settings))


async def resume(session: AsyncSession, user_id: int, settings: Settings, *, book_id: str, now, seed: int) -> dict:
    """继续 = 设为 active 并暂停其它(同 PUT /enrollment 只传书 id);设置与进度不变。"""
    book_or_fail(settings, book_id)
    if await store.get_enrollment(session, user_id, book_id) is None:
        fail(NOT_ENROLLED)
    if not await store.consume_settings(session, user_id, utc_day(now)):
        fail(SETTINGS_LIMIT)
    return await put_enrollment(session, user_id, settings, book_id=book_id, daily_new=None, review_cap=None,
                                order_mode=None, now=now, seed=seed)


def confirm_matches(confirm: str, spec: BookSpec) -> bool:
    typed = confirm.strip().casefold()
    return bool(typed) and typed in {spec.id, spec.title_zh.casefold(), spec.title_en.casefold()}


async def reset_progress(session: AsyncSession, user_id: int, settings: Settings, *, book_id: str, confirm: str,
                         offset: int, now, seed: int,
                         before_delete: Callable[[], Awaitable[None]] | None = None) -> dict:
    """重置进度(spec §8,G-7)。确认文本不记日志。

    before_delete:路由层注入的段位预同步(wordbook 层不导入 rank)。只在全部校验通过、扣过次数之后、
    删除之前调用 —— 被拒的重置不触发同步(集成裁定 Z1-b)。"""
    spec = book_or_fail(settings, book_id)
    if await store.get_enrollment(session, user_id, book_id) is None:
        fail(NOT_ENROLLED)
    if not confirm_matches(confirm, spec):
        fail(CONFIRM_MISMATCH)
    if not await store.consume_reset(session, user_id, utc_day(now)):
        fail(RESET_LIMIT)
    if before_delete is not None:
        await before_delete()
    removed = await store.reset_book(session, user_id, book_id, seed=seed, now=now)
    await store.add_event(session, user_id=user_id, book_id=book_id, kind="reset", word=book_id, item_id=None,
                          qtype=None, outcome="reset", credit=0, day=local_day(now, offset), now=now)
    await session.commit()
    e = await store.get_enrollment(session, user_id, book_id)
    return {"removed": removed, "enrollment": enrollment_out(e, limits_of(settings))}


# ---- 已学词与自由复习(spec 2026-10-12 wordbook-review §1;计划 2026-10-12-wordbook-learned-review)----

@dataclass(frozen=True)
class LearnedQuery:
    book: str | None
    tier: str | None
    weak: bool
    since: str | None
    until: str | None
    q: str | None
    cursor: str | None
    limit: int
    offset: int


def _learned_sources(settings: Settings, book: str | None) -> list[str]:
    enabled = enabled_books(settings.wordbook_books)  # R-L2:停用的书保留记录但不列出
    if book is not None:
        if book not in enabled:
            fail(BOOK_NOT_FOUND)
        enabled = (book,)
    return store.learned_sources(enabled)


async def learned_summary(session: AsyncSession, user_id: int, settings: Settings, offset: int, now) -> dict:
    enabled = enabled_books(settings.wordbook_books)
    grouped, weak, y_count, w_count = await store.learned_counts(
        session, user_id, store.learned_sources(enabled),
        yesterday=(planning.day_end(now, offset, -2), planning.day_end(now, offset, -1)),
        last7_start=planning.day_end(now, offset, -7))
    by_box, by_book = [0] * 6, {}
    for source, box, n in grouped:
        by_box[min(max(box, 0), 5)] += n
        book_id = source[len(store.SOURCE_PREFIX):]
        by_book[book_id] = by_book.get(book_id, 0) + n
    return {"total": sum(by_box), "by_box": by_box,
            "by_tier": {name: sum(by_box[lo:hi + 1]) for name, (lo, hi) in learned.TIERS.items()},
            "by_book": [{"book_id": b, "count": by_book[b]} for b in enabled if b in by_book],  # 列表,不是映射(R-L16)
            "weak": weak, "yesterday": y_count, "last7": w_count}


async def learned_list(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, p: LearnedQuery,
                       now) -> dict:
    sources = _learned_sources(settings, p.book)
    try:
        since, until = learned.date_bounds(p.since, p.until, p.offset)
    except ValueError:
        fail(INVALID_DATE)
    after = None
    if p.cursor is not None:
        after = learned.decode_cursor(p.cursor)
        if after is None:
            fail(INVALID_CURSOR)
    prefix = normalize_word(p.q) if p.q else None
    rows, more = await store.learned_page(session, user_id, sources, tier=p.tier, weak=p.weak, since=since, until=until,
                                          prefix=prefix, after=after, limit=p.limit)
    await ensure_hidden(session, ds)
    heads: dict[tuple[str, str], str] = {}
    for book_id in dict.fromkeys(r.book_id for r in rows):  # R-L12:词典不可用的书退回规范化键
        try:
            found = await ds.cards(book_id, [r.word for r in rows if r.book_id == book_id])
        except DataUnavailable:
            continue
        heads.update({(book_id, k): c.word for k, c in found.items()})
    items = [{"book_id": r.book_id, "key": r.word, "word": heads.get((r.book_id, r.word), r.word), "box": r.box,
              "tier": learned.tier_of(r.box), "learned_at": iso_utc(r.created_at), "due_at": iso_utc(r.due_at),
              "weak": learned.is_weak(r.box, r.lapses)} for r in rows]
    return {"items": items,
            "next_cursor": learned.encode_cursor(rows[-1].created_at, rows[-1].id) if more and rows else None}


async def learned_card(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, book_id: str,
                       key: str) -> dict:
    """已学词的词卡(POST 体里带词,不进 URL;R-L4)。不是这个用户这本书里的已学词 → 404。"""
    book_or_fail(settings, book_id)
    row = await store.known_one(session, user_id, key)
    if row is None or row.source != store.wordbook_source(book_id):
        fail(WORD_NOT_FOUND)
    return await card_detail(session, ds, settings, book_id, key)


FREE_OVERSAMPLE = 3  # 拼写题多抽 3 倍再筛掉不可拼写的词


async def free_start(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, *, scope: str,
                     mode: str, count: int, book: str | None, tier: str | None, offset: int, now,
                     rng: random.Random | None = None) -> dict:
    """自由复习开始:服务端按范围抽词、出题(R-L9 / R-L10)。客户端不能指定词。先校验、再取池(空池不扣次数)、再扣次数。"""
    enabled = enabled_books(settings.wordbook_books)
    if scope == "book" and (book is None or book not in enabled):
        fail(INVALID_SCOPE)
    if scope == "tier" and tier is None:
        fail(INVALID_SCOPE)
    since, until = learned.scope_window(scope, now, offset)
    pool = await store.free_pool(session, user_id, store.learned_sources((book,) if scope == "book" else enabled),
                                 tier=tier if scope == "tier" else None, weak=scope == "weak", since=since, until=until)
    if not pool:
        fail(NOTHING_TO_REVIEW)
    if not await store.consume_free_start(session, user_id, utc_day(now)):
        fail(FREE_LIMIT)
    rng = rng or random.Random()
    pool.sort()
    picked = rng.sample(pool, min(len(pool), count * FREE_OVERSAMPLE if mode == "spell" else count))
    await ensure_hidden(session, ds)
    cards: dict[tuple[str, str], WordCard] = {}
    for book_id in dict.fromkeys(b for _, b in picked):
        found = await cards_or_fail(ds, book_id, [w for w, b in picked if b == book_id])
        cards.update({(book_id, k): c for k, c in found.items()})
    qrng = random.Random(rng.getrandbits(64))
    items: list[dict] = []
    for word, book_id in picked:
        card = cards.get((book_id, word))
        if card is None or (mode == "spell" and not free_spellable(card)):
            continue
        question = None
        if mode != "browse":
            qtype = "recall" if mode == "recall" else "spell" if mode == "spell" else free_choice_qtype(card, qrng)
            question = question_out(await _question(ds, await index_or_fail(ds, book_id), card, qtype, qrng, user_id=user_id))
        items.append({"book_id": book_id, "card": card_out(card, ds), "question": question})
        if len(items) == count:
            break
    if not items:
        fail(NOTHING_TO_REVIEW)
    return {"set_id": secrets.token_hex(6), "scope": scope, "mode": mode, "items": items}


async def word_spell_start(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, *,
                           count: int, offset: int, now, rng: random.Random | None = None) -> dict:
    """单词拼写出题(计划 2026-10-27 R-W3):词池同 spell_sets(到期 + 今日新学 + 盒 ≤ 3),只取本书来源且可拼写的词。
    不扣任何计数、不写 SRS;作答走 /answers 的 free 路径。词只在响应体里。"""
    e, index = await _active(session, ds, user_id, settings)
    rng = rng or random.Random()
    known = await store.known_words(session, user_id)
    today = await store.today_learned_keys(session, user_id, e.book_id, local_day(now, offset))
    due = planning.due_keys(index.keys, known, now, SPELL_DUE_POOL)
    low = [k for k in index.keys if k in known and known[k].box <= 3]
    source = store.wordbook_source(e.book_id)
    ordered = [k for k in dict.fromkeys(due + today + low) if k in index and k in known and known[k].source == source]
    rng.shuffle(ordered)
    picked = ordered[: count * FREE_OVERSAMPLE]
    cards = await cards_or_fail(ds, e.book_id, picked) if picked else {}
    chosen = [cards[k] for k in picked if k in cards and free_spellable(cards[k])][:count]
    if not chosen:
        fail(NOTHING_TO_REVIEW)
    qrng = random.Random(rng.getrandbits(64))
    items = [{"book_id": e.book_id, "card": card_out(card, ds),
              "question": question_out(await _question(ds, index, card, "spell", qrng))} for card in chosen]
    return {"set_id": secrets.token_hex(6), "book_id": e.book_id, "items": items}
