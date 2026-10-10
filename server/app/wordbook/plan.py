"""每日计划、进度、洗牌排列与下一批新词(spec §6.1–6.2)。纯函数。"""
import random
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

MASTERED_BOX = 4
BACKLOG_NEW = 5


@dataclass(frozen=True)
class Known:
    """用户已有的一行 vocabulary_items(任何来源)。"""
    item_id: str
    box: int
    due_at: datetime
    reps: int
    source: str


@dataclass(frozen=True)
class DayPlan:
    new_target: int
    new_done: int
    new_left: int
    review_due: int
    review_done: int
    review_left: int
    backlog_guard: bool


@dataclass(frozen=True)
class Progress:
    words: int
    learned: int
    mastered: int
    remaining: int


def compute_plan(*, daily_new: int, review_cap: int, new_done: int, review_done: int, review_due: int) -> DayPlan:
    guard = review_due > review_cap
    new_left = max(0, daily_new - new_done)
    if guard:
        new_left = min(new_left, BACKLOG_NEW)
    review_left = min(review_due, max(0, review_cap - review_done))
    return DayPlan(daily_new, new_done, new_left, review_due, review_done, review_left, guard)


def progress_of(keys: Sequence[str], known: Mapping[str, Known]) -> Progress:
    learned = [k for k in keys if k in known]
    mastered = sum(1 for k in learned if known[k].box >= MASTERED_BOX)
    return Progress(len(keys), len(learned), mastered, len(keys) - len(learned))


def due_keys(keys: Sequence[str], known: Mapping[str, Known], now: datetime, limit: int) -> list[str]:
    """本书已学且到期的键:最久过期在前,同时刻盒小在前。"""
    due = [k for k in keys if k in known and known[k].due_at <= now]
    due.sort(key=lambda k: (known[k].due_at, known[k].box))
    return due[: max(0, limit)]


def count_due(keys: Sequence[str], known: Mapping[str, Known], now: datetime) -> int:
    return sum(1 for k in keys if k in known and known[k].due_at <= now)


def count_due_before(keys: Sequence[str], known: Mapping[str, Known], when: datetime) -> int:
    return sum(1 for k in keys if k in known and known[k].due_at < when)


def day_end(now: datetime, offset_minutes: int, days: int = 0) -> datetime:
    """用户本地日(UTC 偏移 offset_minutes)结束的 UTC 时刻;days=1 为明天结束。"""
    local = now.astimezone(timezone.utc) + timedelta(minutes=offset_minutes)
    midnight = datetime(local.year, local.month, local.day, tzinfo=timezone.utc) + timedelta(days=days + 1)
    return midnight - timedelta(minutes=offset_minutes)


def permutation(n: int, seed: int, mode: str) -> list[int]:
    order = list(range(n))
    if mode == "shuffle":
        random.Random(seed).shuffle(order)
    return order


def next_new(keys: Sequence[str], order: Sequence[int], cursor: int, known: Mapping[str, Known],
             n: int) -> tuple[list[str], int]:
    """从 cursor 起按 order 取 n 个未学的键;第二个返回值是「第一个未学的位置」(新的 cursor)。"""
    pos = min(max(0, cursor), len(order))  # 书变小(数据更新)时 cursor 可能越界
    while pos < len(order) and keys[order[pos]] in known:
        pos += 1
    first_unlearned = pos
    out: list[str] = []
    while pos < len(order) and len(out) < n:
        key = keys[order[pos]]
        if key not in known:
            out.append(key)
        pos += 1
    return out, first_unlearned
