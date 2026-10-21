"""词汇本:词条规范化与盒子法(Leitner)排期(设计文档 §3.5,计划裁定 R17/R18)。
除 apply_review(唯一的复习写入点,不提交)外都是纯函数,便于测试。"""
import unicodedata
from datetime import datetime
from typing import Literal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import VocabularyItem
# The Leitner rules and the port live in scheduling (L3 R1); the Leitner names are re-exported so existing imports work.
from app.services.scheduling import (  # noqa: F401
    INTERVAL_DAYS, LEITNER, MAX_BOX, ReviewOutcome, SchedulingPolicy, SrsSnapshot, decide, next_review,
)

Grade = Literal["forgot", "hard", "good", "easy"]
MAX_WORD = 100
MAX_MEANING = 1000
MAX_EXAMPLE = 500


_FOLD = str.maketrans({"’": "'", "‘": "'", "ʼ": "'", "‐": "-", "‑": "-"})


def normalize_word(value: str) -> str:
    """NFC、折叠排版撇号/连字符、去 Cf 不可见字符、压缩空白、去首尾、转小写(不用 NFKC)。

    同一用户的 "Look up" 与 " look  up "、"don't" 与 "don’t" 是同一个词条。
    """
    text = unicodedata.normalize("NFC", value).translate(_FOLD)
    text = "".join(c for c in text if unicodedata.category(c) != "Cf")
    return " ".join(text.split()).lower()


def validate_word(value: str) -> str:
    """规范化并校验词条:空、超长(>MAX_WORD)或含控制字符时抛 ValueError。返回规范化结果。"""
    if any(unicodedata.category(c) == "Cc" and not c.isspace() for c in value):
        raise ValueError("word contains control characters")
    word = normalize_word(value)
    if not word:
        raise ValueError("word is empty")
    if len(word) > MAX_WORD:
        raise ValueError(f"word is longer than {MAX_WORD} characters")
    return word


async def _read_snapshot(session: AsyncSession, user_id: int, item_id: str, *, seen_reps: int, seen_box: int | None,
                         seen_box_guard: bool) -> SrsSnapshot | None:
    """The row as the scheduler needs it, read in the caller's transaction under the same optimistic guard as the
    UPDATE (L3 R11). None when the guard matches nothing (the UPDATE would be 0 rows as well)."""
    stmt = select(
        VocabularyItem.stability, VocabularyItem.difficulty, VocabularyItem.fsrs_state, VocabularyItem.last_review,
        VocabularyItem.last_reviewed_at, VocabularyItem.created_at,
    ).where(VocabularyItem.id == item_id, VocabularyItem.user_id == user_id, VocabularyItem.reps == seen_reps)
    if seen_box_guard:
        stmt = stmt.where(VocabularyItem.box == seen_box)
    row = (await session.execute(stmt)).first()
    if row is None:
        return None
    return SrsSnapshot(
        box=seen_box if seen_box is not None else 0, stability=row.stability, difficulty=row.difficulty,
        fsrs_state=row.fsrs_state, last_review=row.last_review, last_reviewed_at=row.last_reviewed_at,
        created_at=row.created_at,
    )


async def apply_review(
    session: AsyncSession, user_id: int, item_id: str, *, seen_box: int, seen_reps: int, grade: str, now: datetime,
    policy: SchedulingPolicy = LEITNER,
) -> bool:
    """按读到的快照写入一次复习;乐观条件 reps == seen_reps(reps 只增不减),
    并发/连点的第二个请求在这里命中 0 行 → False(R18)。不提交。
    生词本路由与背单词(app/wordbook)共用这一个写入点(计划 2026-10-10-wordbook P-W3)。
    排期经调度端口(L3 R2):policy 默认 Leitner,此时 box / due_at 与旧行为逐位相同,FSRS 四列为影子状态。"""
    snapshot = await _read_snapshot(session, user_id, item_id, seen_reps=seen_reps, seen_box=seen_box,
                                    seen_box_guard=False)
    if snapshot is None:
        return False
    d = decide(policy, snapshot, grade, now)
    result = await session.execute(
        update(VocabularyItem)
        .where(VocabularyItem.id == item_id, VocabularyItem.user_id == user_id, VocabularyItem.reps == seen_reps)
        .values(
            box=d.box, due_at=d.due_at, reps=seen_reps + 1,
            lapses=VocabularyItem.lapses + (1 if d.lapsed else 0), last_reviewed_at=now,
            stability=d.fsrs.stability, difficulty=d.fsrs.difficulty, fsrs_state=d.fsrs.state,
            last_review=d.fsrs.last_review,
        )
        .execution_options(synchronize_session=False)
    )
    return result.rowcount == 1


async def apply_lapse(
    session: AsyncSession, user_id: int, item_id: str, *, seen_box: int, seen_reps: int, now: datetime,
    policy: SchedulingPolicy = LEITNER,
) -> bool:
    """A wrong answer on a word that is not due (wordbook R-W5): back to box 0, due tomorrow, lapses + 1.

    It is not a review: `reps` and `last_reviewed_at` stay, so it never produces a `vocab_review` rank event
    (review B1). A box-0 item is already "forgotten" and is left alone. Optimistic guard: box and reps as read.
    Scheduled through the port (L3 R2): under FSRS the box and due come from the Again rating instead.
    Does not commit."""
    if seen_box <= 0:
        return False
    snapshot = await _read_snapshot(session, user_id, item_id, seen_reps=seen_reps, seen_box=seen_box,
                                    seen_box_guard=True)
    if snapshot is None:
        return False
    d = decide(policy, snapshot, "forgot", now)
    result = await session.execute(
        update(VocabularyItem)
        .where(VocabularyItem.id == item_id, VocabularyItem.user_id == user_id, VocabularyItem.reps == seen_reps,
               VocabularyItem.box == seen_box)
        .values(
            box=d.box, due_at=d.due_at, lapses=VocabularyItem.lapses + 1,
            stability=d.fsrs.stability, difficulty=d.fsrs.difficulty, fsrs_state=d.fsrs.state,
            last_review=d.fsrs.last_review,
        )
        .execution_options(synchronize_session=False)
    )
    return result.rowcount == 1
