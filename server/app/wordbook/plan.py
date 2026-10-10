"""每日计划、进度、洗牌排列与下一批新词(spec §6.1–6.2)。纯函数。"""
import random
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

MASTERED_BOX = 4
BACKLOG_NEW = 5
REVIEW_UNLIMITED = 0  # wordbook_enrollments.review_cap 的「不限」哨兵(合法上限 ≥ 10;spec 2026-10-11 §3.1)


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
    bonus: int = 0
    goal_met: bool = False


@dataclass(frozen=True)
class Progress:
    words: int
    learned: int
    mastered: int
    remaining: int


@dataclass(frozen=True)
class GoalLimits:
    """管理员允许的范围(设置注册表 wordbook_*_min/max 等,spec 2026-10-11 §10)。"""
    new_min: int
    new_max: int
    review_min: int
    review_max: int
    unlimited: bool
    bonus_max: int


def compute_plan(*, daily_new: int, review_cap: int | None, new_done: int, review_done: int, review_due: int,
                 bonus: int = 0, guard_threshold: int | None = None, remaining: int | None = None) -> DayPlan:
    """review_cap=None 表示「不限」,积压阈值改用 guard_threshold。

    积压保护(G-3):到期数超过阈值时,今天的新词总数(含加练)最多 BACKLOG_NEW 个 —— v1 写成
    min(new_left, 5),每学完 5 个又给 5 个,保护不生效。remaining = 本书未学的词数(None = 不限制)。
    达标(G-6)= 新词学满(不含加练;积压时 5 个;书快学完时按剩余)+ review_left 为 0 + 当天有活动。"""
    threshold = review_cap if review_cap is not None else guard_threshold
    guard = threshold is not None and review_due > threshold
    target = daily_new + bonus
    new_left = max(0, (min(target, BACKLOG_NEW) if guard else target) - new_done)
    if remaining is not None:
        new_left = min(new_left, max(0, remaining))
    review_left = review_due if review_cap is None else min(review_due, max(0, review_cap - review_done))
    goal_new = min(daily_new, BACKLOG_NEW) if guard else daily_new
    if remaining is not None:
        goal_new = min(goal_new, new_done + max(0, remaining))
    met = new_done + review_done > 0 and new_done >= goal_new and review_left == 0
    return DayPlan(target, new_done, new_left, review_due, review_done, review_left, guard, bonus, met)


def effective_goals(daily_new: int, review_cap: int, limits: GoalLimits) -> tuple[int, int | None]:
    """库里的值夹到当前范围(GP-2);(新词, 复习上限 | None=不限)。管理员关掉「不限」时按 review_max。"""
    new = min(max(daily_new, limits.new_min), limits.new_max)
    if review_cap == REVIEW_UNLIMITED:
        return new, None if limits.unlimited else limits.review_max
    return new, min(max(review_cap, limits.review_min), limits.review_max)


def goals_error(limits: GoalLimits, *, daily_new: int | None, review_cap: int | None, unlimited: bool) -> str | None:
    """用户提交的值在管理员范围内吗?返回错误原文(spec §9)或 None。"""
    if unlimited and review_cap is not None:
        return "Conflicting review cap"
    if daily_new is not None and not limits.new_min <= daily_new <= limits.new_max:
        return "Daily new words out of range"
    if review_cap is not None and not limits.review_min <= review_cap <= limits.review_max:
        return "Review cap out of range"
    if unlimited and not limits.unlimited:
        return "Unlimited reviews are off"
    return None


def streak_of(days: Iterable[str], today: str) -> int:
    """连续达标天数:今天已达标从今天往回数,否则从昨天往回数(G-6,无冻结)。days 为 ISO 本地日。"""
    have = {date.fromisoformat(d) for d in days}
    cur = date.fromisoformat(today)
    if cur not in have:
        cur -= timedelta(days=1)
    n = 0
    while cur in have:
        n += 1
        cur -= timedelta(days=1)
    return n


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
