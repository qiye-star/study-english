"""FSRS adapter (L3 plan R1, R4, R13): the ONLY module in the repo that imports `fsrs`.

Plain dataclasses and UTC datetimes in and out. Learning steps and fuzzing are off (R4): the product counts by local
day, and fuzzing draws from the global random module, which would make golden tests and replay non-reproducible.
Never logs (R13). MAX_INTERVAL_DAYS is a placeholder until the replay fixes it (R4).
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache

from fsrs import Card, Rating, Scheduler, State

MAX_INTERVAL_DAYS = 365  # placeholder: Leitner caps at 30 days; the replay decides the real cap
STATE_REVIEW = int(State.Review)
RATING = {"forgot": int(Rating.Again), "hard": int(Rating.Hard), "good": int(Rating.Good), "easy": int(Rating.Easy)}


@dataclass(frozen=True)
class FsrsState:
    """The four FSRS columns of a vocabulary row (see models.VocabularyItem)."""

    stability: float
    difficulty: float
    state: int
    last_review: datetime


@lru_cache(maxsize=16)
def _scheduler(retention: float) -> Scheduler:
    return Scheduler(
        learning_steps=(),
        relearning_steps=(),
        enable_fuzzing=False,
        maximum_interval=MAX_INTERVAL_DAYS,
        desired_retention=retention,
    )


def _utc(value: datetime, name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be timezone-aware")
    return value.astimezone(timezone.utc)


def review(state: FsrsState, grade: str, now: datetime, *, retention: float) -> tuple[FsrsState, datetime]:
    """Score one review at `now`. Returns (new state, next due). The card stays in the Review state."""
    if grade not in RATING:
        raise ValueError(f"unknown grade: {grade!r}")
    if state.state != STATE_REVIEW:
        raise ValueError("only Review-state cards are scheduled here")
    if not 0 < retention < 1:
        raise ValueError("retention must be a probability strictly between 0 and 1")
    now = _utc(now, "now")
    last = _utc(state.last_review, "last_review")
    card = Card(
        card_id=0,  # a fixed id: Card() would otherwise sleep a millisecond to make one
        state=State.Review,
        step=None,
        stability=state.stability,
        difficulty=state.difficulty,
        due=last,
        last_review=last,
    )
    new_card, _log = _scheduler(retention).review_card(card, Rating(RATING[grade]), review_datetime=now)
    new_state = FsrsState(
        stability=float(new_card.stability),
        difficulty=float(new_card.difficulty),
        state=int(new_card.state),
        last_review=now,
    )
    return new_state, new_card.due.astimezone(timezone.utc)


def retrievability(state: FsrsState, at: datetime) -> float:
    """Predicted probability of recall at `at` (the retention definition the replay uses)."""
    last = _utc(state.last_review, "last_review")
    card = Card(
        card_id=0,
        state=State.Review,
        step=None,
        stability=state.stability,
        difficulty=state.difficulty,
        due=last,
        last_review=last,
    )
    return float(_scheduler(0.9).get_card_retrievability(card, current_datetime=_utc(at, "at")))
