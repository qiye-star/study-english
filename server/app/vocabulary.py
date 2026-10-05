"""词汇本:词条规范化与盒子法(Leitner)排期(设计文档 §3.5,计划裁定 R17/R18)。纯函数,便于测试。"""
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

Grade = Literal["forgot", "hard", "good"]
INTERVAL_DAYS = (1, 2, 4, 7, 15, 30)  # 下标 = 盒子号
MAX_BOX = len(INTERVAL_DAYS) - 1
MAX_WORD = 100
MAX_MEANING = 1000
MAX_EXAMPLE = 500


def normalize_word(value: str) -> str:
    """NFC、压缩空白、去首尾、转小写:同一用户的 "Look up" 与 " look  up " 是同一个词条。"""
    return " ".join(unicodedata.normalize("NFC", value).split()).lower()


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
    box = min(max(box, 0), MAX_BOX)
    if grade == "forgot":
        return ReviewOutcome(0, now + timedelta(days=INTERVAL_DAYS[0]), True)
    if grade == "hard":
        return ReviewOutcome(box, now + timedelta(days=INTERVAL_DAYS[box] / 2), False)
    if grade == "good":
        new_box = min(box + 1, MAX_BOX)
        return ReviewOutcome(new_box, now + timedelta(days=INTERVAL_DAYS[new_box]), False)
    raise ValueError(f"unknown grade: {grade!r}")
