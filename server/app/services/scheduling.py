"""Review scheduling port (L3 plan R1–R3, R5, R6, R10): the Leitner rules and the FSRS engine behind one `decide`.

Pure except `srs_fsrs` (which is the only module that imports the `fsrs` package). Never imports logging (R13).

Double write (R2): every decision computes BOTH the Leitner result and the FSRS shadow state. The policy decides only
which result sets `box` and `due_at`. `app.services.vocabulary` re-exports the Leitner rules from here, so the
import graph has no cycle (vocabulary -> scheduling -> srs_fsrs).
"""
import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from app.services import srs_fsrs
from app.services.srs_fsrs import FsrsState

# ---- Leitner rules (moved here unchanged from services/vocabulary.py; the golden tests pin them) ----

INTERVAL_DAYS = (1, 2, 4, 7, 15, 30)  # index = box
MAX_BOX = len(INTERVAL_DAYS) - 1

Grade = Literal["forgot", "hard", "good", "easy"]
GRADES = ("forgot", "hard", "good", "easy")
Engine = Literal["leitner", "fsrs"]
LEGACY_DIFFICULTY = 2.1181  # D0(Good) of fsrs 6.3.2 default parameters, 4 d.p. (L3 results Task 0); placeholder until replay


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


# ---- port ----

@dataclass(frozen=True)
class SchedulingPolicy:
    engine: Engine
    retention: float


LEITNER = SchedulingPolicy("leitner", 0.9)


@dataclass(frozen=True)
class SrsSnapshot:
    """What a write reads from one vocabulary row (the four FSRS columns may be NULL)."""

    box: int
    stability: float | None
    difficulty: float | None
    fsrs_state: int | None
    last_review: datetime | None
    last_reviewed_at: datetime | None
    created_at: datetime


@dataclass(frozen=True)
class SrsDecision:
    box: int
    due_at: datetime
    lapsed: bool
    fsrs: FsrsState


def _utc(value: datetime) -> datetime:
    """SQLite returns naive datetimes that were written as UTC; Postgres returns aware ones."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def seed_stability(box: int) -> float:
    """Stability that a box stands for: its Leitner interval in days (R3)."""
    return float(INTERVAL_DAYS[min(max(box, 0), MAX_BOX)])


def derive_box(stability: float) -> int:
    """The largest box whose interval the stability reaches; below one day is box 0 (R3, inverse of seed_stability)."""
    box = 0
    for b, days in enumerate(INTERVAL_DAYS):
        if stability >= days:
            box = b
    return box


def seeded(s: SrsSnapshot) -> FsrsState:
    """The FSRS state to score from. Any NULL FSRS column means "seed from the box now" (R6)."""
    if s.stability is None or s.difficulty is None or s.fsrs_state is None or s.last_review is None:
        last = s.last_reviewed_at or s.created_at
        return FsrsState(
            stability=seed_stability(s.box),
            difficulty=LEGACY_DIFFICULTY,
            state=srs_fsrs.STATE_REVIEW,
            last_review=_utc(last),
        )
    return FsrsState(
        stability=float(s.stability),
        difficulty=float(s.difficulty),
        state=int(s.fsrs_state),
        last_review=_utc(s.last_review),
    )


def bucket(user_id: int) -> int:
    """Stable rollout bucket in [0, 100) (R10). Pure hash: no state, the same answer in every process."""
    return int.from_bytes(hashlib.sha256(f"fsrs-rollout:{user_id}".encode()).digest()[:4], "big") % 100


def policy_for(settings, user_id: int) -> SchedulingPolicy:
    """The engine for this user at the current percentage, and the retention used by the shadow state."""
    engine: Engine = "fsrs" if bucket(user_id) < settings.wordbook_fsrs_pct else "leitner"
    return SchedulingPolicy(engine, settings.wordbook_fsrs_retention_pct / 100)


def decide(policy: SchedulingPolicy, s: SrsSnapshot, grade: str, now: datetime) -> SrsDecision:
    """Score one review. Leitner maps easy to good; FSRS receives the real grade (R5)."""
    if grade not in GRADES:
        raise ValueError(f"unknown grade: {grade!r}")
    leitner = next_review(s.box, "good" if grade == "easy" else grade, now)
    shadow, fsrs_due = srs_fsrs.review(seeded(s), grade, now, retention=policy.retention)
    if policy.engine == "fsrs":
        return SrsDecision(box=derive_box(shadow.stability), due_at=fsrs_due, lapsed=grade == "forgot", fsrs=shadow)
    return SrsDecision(box=leitner.box, due_at=leitner.due_at, lapsed=leitner.lapsed, fsrs=shadow)
