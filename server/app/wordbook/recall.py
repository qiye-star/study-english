"""快速回忆与三档自评(spec 2026-10-11-wordbook-recall §5)。纯函数:有效评级、抽查判定、学新词盒子、当天后续作答。"""
import hashlib
from dataclasses import dataclass
from typing import Literal

Rating = Literal["know", "fuzzy", "unknown"]
RATINGS: tuple[Rating, ...] = ("know", "fuzzy", "unknown")
KNOW_CHECK = "know_chk"  # 事件 outcome:抽中抽查的「认识」(学新词)
RATING_OUTCOMES = frozenset({"know", KNOW_CHECK, "fuzzy", "unknown"})
RECALL_QTYPE = "recall"
FAST_MS = 1000           # 比这更快的「认识」必抽(pct > 0 时)
LEARN_BOX: dict[str, int] = {"know": 2, "fuzzy": 1, "unknown": 0}
PENDING_BOX = 1          # R-R3:抽中的「认识」先记盒 1
GRADE: dict[str, str] = {"know": "good", "fuzzy": "hard", "unknown": "forgot"}


def as_rating(outcome: str | None) -> Rating | None:
    """事件 outcome → 评级(know_chk 视为 know);不是自评事件 → None。"""
    if outcome == KNOW_CHECK:
        return "know"
    return outcome if outcome in RATINGS else None  # type: ignore[return-value]


def effective_rating(rating: Rating, *, revealed_before: bool, previous: str | None) -> Rating:
    """偷看后认识 = 模糊;与上一次自评连续两次模糊 = 不认识(被改记的那次不再与下一次连续)。"""
    r: Rating = "fuzzy" if rating == "know" and revealed_before else rating
    if r == "fuzzy" and as_rating(previous) == "fuzzy":
        return "unknown"
    return r


def spot_hit(seed: int, user_id: int, key: str, reps: int, pct: int) -> bool:
    if pct <= 0:
        return False
    if pct >= 100:
        return True
    digest = hashlib.sha256(f"spot:{seed}:{user_id}:{key}:{reps}".encode()).digest()
    return int.from_bytes(digest[:4], "big") % 100 < pct


def needs_check(rating: Rating, *, seed: int, user_id: int, key: str, reps: int, pct: int,
                elapsed_ms: int | None) -> bool:
    if rating != "know" or pct <= 0:
        return False
    return spot_hit(seed, user_id, key, reps, pct) or (elapsed_ms is not None and elapsed_ms < FAST_MS)


@dataclass(frozen=True)
class LearnDecision:
    box: int
    outcome: str      # know | know_chk | fuzzy | unknown(写进 wordbook_events.outcome)
    spot_check: bool


def learn_decision(rating: Rating, check: bool) -> LearnDecision:
    if rating == "know" and check:
        return LearnDecision(PENDING_BOX, KNOW_CHECK, True)
    return LearnDecision(LEARN_BOX[rating], rating, False)


def learn_quiz_target(box: int, today_outcome: str, correct: bool) -> int | None:
    """当天新词(reps = 0)在本轮小测里作答后的目标盒;None = 不改。"""
    if not correct:
        return 0 if box > 0 else None
    if today_outcome == KNOW_CHECK and box == PENDING_BOX:
        return LEARN_BOX["know"]
    return None


def learn_rerate_target(box: int, rating: Rating) -> int | None:
    """当天再次自评(「记错了」):只降不升。"""
    target = LEARN_BOX[rating]
    return target if target < box else None
