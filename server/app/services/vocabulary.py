"""词汇本:词条规范化与盒子法(Leitner)排期(设计文档 §3.5,计划裁定 R17/R18)。
除 apply_review(唯一的复习写入点,不提交)外都是纯函数,便于测试。"""
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import VocabularyItem

Grade = Literal["forgot", "hard", "good"]
INTERVAL_DAYS = (1, 2, 4, 7, 15, 30)  # 下标 = 盒子号
MAX_BOX = len(INTERVAL_DAYS) - 1
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


@dataclass(frozen=True)
class ReviewOutcome:
    box: int
    due_at: datetime
    lapsed: bool


def next_review(box: int, grade: str, now: datetime) -> ReviewOutcome:
    """forgot → 盒 0、明天;hard → 盒不变、该盒间隔减半;good → 盒 +1(封顶 5)、新盒的间隔。

    box 超出 0..5 时夹到范围内;now 必须带时区(UTC)。
    """
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    now = now.astimezone(timezone.utc)
    box = min(max(box, 0), MAX_BOX)
    if grade == "forgot":
        return ReviewOutcome(0, now + timedelta(days=INTERVAL_DAYS[0]), True)
    if grade == "hard":
        return ReviewOutcome(box, now + timedelta(days=INTERVAL_DAYS[box] / 2), False)
    if grade == "good":
        new_box = min(box + 1, MAX_BOX)
        return ReviewOutcome(new_box, now + timedelta(days=INTERVAL_DAYS[new_box]), False)
    raise ValueError(f"unknown grade: {grade!r}")


async def apply_review(
    session: AsyncSession, user_id: int, item_id: str, *, seen_box: int, seen_reps: int, grade: str, now: datetime,
) -> bool:
    """按读到的快照写入一次复习;乐观条件 reps == seen_reps(reps 只增不减),
    并发/连点的第二个请求在这里命中 0 行 → False(R18)。不提交。
    生词本路由与背单词(app/wordbook)共用这一个写入点(计划 2026-10-10-wordbook P-W3)。"""
    outcome = next_review(seen_box, grade, now)
    result = await session.execute(
        update(VocabularyItem)
        .where(VocabularyItem.id == item_id, VocabularyItem.user_id == user_id, VocabularyItem.reps == seen_reps)
        .values(
            box=outcome.box, due_at=outcome.due_at, reps=seen_reps + 1,
            lapses=VocabularyItem.lapses + (1 if outcome.lapsed else 0), last_reviewed_at=now,
        )
        .execution_options(synchronize_session=False)
    )
    return result.rowcount == 1


async def apply_lapse(
    session: AsyncSession, user_id: int, item_id: str, *, seen_box: int, seen_reps: int, now: datetime,
) -> bool:
    """A wrong answer on a word that is not due (wordbook R-W5): back to box 0, due tomorrow, lapses + 1.

    It is not a review: `reps` and `last_reviewed_at` stay, so it never produces a `vocab_review` rank event
    (review B1). A box-0 item is already "forgotten" and is left alone. Optimistic guard: box and reps as read.
    Does not commit."""
    if seen_box <= 0:
        return False
    outcome = next_review(seen_box, "forgot", now)
    result = await session.execute(
        update(VocabularyItem)
        .where(VocabularyItem.id == item_id, VocabularyItem.user_id == user_id, VocabularyItem.reps == seen_reps,
               VocabularyItem.box == seen_box)
        .values(box=outcome.box, due_at=outcome.due_at, lapses=VocabularyItem.lapses + 1)
        .execution_options(synchronize_session=False)
    )
    return result.rowcount == 1
