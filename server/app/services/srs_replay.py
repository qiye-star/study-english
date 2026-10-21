"""Offline replay core (L3 plan R12): compare Leitner and FSRS predictions on a recorded review history.

Pure: no database, no clock, no logging (R13). The CLI in `app/admin/fsrs_replay.py` feeds it one item at a time.

For each scored review (kind == "review" with a grade), BEFORE the review is applied:
  - Leitner's implied prediction: the current box interval as the stability, the same FSRS forgetting curve,
    elapsed time since the item's last Leitner review (R12). Leitner has no probability of its own.
  - FSRS prediction: retrievability of the FSRS state as it stands.
Then the outcome is y = 1 unless the grade was "forgot", and both engines advance with their own rules.

Known approximations (the report repeats them in `notes`): reviews happen at the times the old schedule chose, so
the replay can only say how each engine would have predicted that history; the start box comes from a self-rating
or the choice-question default; Easy never appears in stored events.
"""
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Sequence

from app.services import srs_fsrs
from app.services.scheduling import INTERVAL_DAYS, MAX_BOX, LEGACY_DIFFICULTY, next_review, seed_stability
from app.services.srs_fsrs import FsrsState

BINS = 10
_EPS = 1e-6
NOTES = (
    "Reviews are the times the old schedule chose: this measures how each engine would have predicted that history, "
    "not what would have happened if the user had followed it.",
    "Leitner has no probability; its prediction is the FSRS forgetting curve with the current box interval as stability.",
    "The start box comes from the first learn or relearn event (self-rating or 0 for choice questions).",
    "practice and blank events are not lapses (their wrong answers cannot be told apart from free practice).",
    "Easy is never recorded in events, so a fast correct answer is replayed as good.",
    "Retention changes only the intervals, not the predictions (stability does not depend on it).",
)


@dataclass(frozen=True)
class ReplayEvent:
    at: datetime
    kind: str
    start_box: int | None = None
    grade: str | None = None  # forgot | hard | good, from grading.event_grade; None for non-ratings


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _clip(p: float) -> float:
    return min(max(p, _EPS), 1 - _EPS)


class _Engine:
    """Running totals for one engine; every review adds one prediction and one outcome."""

    def __init__(self) -> None:
        self.n = 0
        self.sum_y = 0
        self.sum_p = 0.0
        self.log_loss = 0.0
        self.brier = 0.0
        self.interval_days = 0.0
        self.bins = [[0, 0, 0.0] for _ in range(BINS)]  # count, outcomes, predicted sum

    def add(self, p: float, y: int, interval_days: float) -> None:
        p = _clip(p)
        self.n += 1
        self.sum_y += y
        self.sum_p += p
        self.log_loss += -(y * math.log(p) + (1 - y) * math.log(1 - p))
        self.brier += (p - y) ** 2
        self.interval_days += interval_days
        b = self.bins[min(int(p * BINS), BINS - 1)]
        b[0] += 1
        b[1] += y
        b[2] += p

    def summary(self) -> dict:
        if self.n == 0:
            return {"reviews": 0}
        return {
            "reviews": self.n,
            "actual_recall_rate": round(self.sum_y / self.n, 6),
            "mean_predicted_recall": round(self.sum_p / self.n, 6),
            "log_loss": round(self.log_loss / self.n, 6),
            "brier": round(self.brier / self.n, 6),
            "mean_next_interval_days": round(self.interval_days / self.n, 4),
            "calibration": [
                {"bin": f"{i / BINS:.1f}-{(i + 1) / BINS:.1f}", "reviews": c, "mean_predicted": round(ps / c, 6),
                 "actual": round(ys / c, 6)} if c else {"bin": f"{i / BINS:.1f}-{(i + 1) / BINS:.1f}", "reviews": 0}
                for i, (c, ys, ps) in enumerate(self.bins)
            ],
        }


class Replay:
    """Accumulates the comparison over many items. Call `add` once per item, then `report`."""

    def __init__(self, retentions: Sequence[float]) -> None:
        for r in retentions:
            if not 0 < r < 1:
                raise ValueError("retention must be a probability strictly between 0 and 1")
        self.retentions = tuple(retentions)
        self.items = 0
        self.skipped = 0
        self.leitner = _Engine()
        self.fsrs = {r: _Engine() for r in self.retentions}

    def add(self, events: Iterable[ReplayEvent]) -> None:
        seq = sorted(events, key=lambda e: _utc(e.at))
        start = next((e for e in seq if e.start_box is not None), None)
        if start is None:
            self.skipped += 1
            return
        self.items += 1
        box = min(max(start.start_box, 0), MAX_BOX)
        leitner_last = _utc(start.at)
        states = {r: FsrsState(stability=seed_stability(box), difficulty=LEGACY_DIFFICULTY, state=srs_fsrs.STATE_REVIEW,
                               last_review=_utc(start.at)) for r in self.retentions}
        for e in seq:
            if e is start or e.kind != "review" or e.grade is None:
                continue
            at = _utc(e.at)
            y = 0 if e.grade == "forgot" else 1
            leitner_state = FsrsState(stability=float(INTERVAL_DAYS[box]), difficulty=LEGACY_DIFFICULTY,
                                      state=srs_fsrs.STATE_REVIEW, last_review=leitner_last)
            p_leitner = srs_fsrs.retrievability(leitner_state, at)
            leitner_next = next_review(box, e.grade, at)
            self.leitner.add(p_leitner, y, (leitner_next.due_at - at).total_seconds() / 86400)
            box, leitner_last = leitner_next.box, at
            for r in self.retentions:
                state = states[r]
                p_fsrs = srs_fsrs.retrievability(state, at)
                new_state, due = srs_fsrs.review(state, e.grade, at, retention=r)
                self.fsrs[r].add(p_fsrs, y, (due - at).total_seconds() / 86400)
                states[r] = new_state

    def report(self) -> dict:
        reviews = self.leitner.n
        p0 = self.leitner.sum_y / reviews if reviews else 0.0
        if reviews:
            q = _clip(p0)
            baseline = {
                "constant_rate": round(p0, 6),
                "log_loss": round(-(q * math.log(q) + (1 - q) * math.log(1 - q)), 6),
                "brier": round(q * (1 - q), 6),
            }
        else:
            baseline = {"constant_rate": None, "log_loss": None, "brier": None}
        return {
            "items": self.items,
            "skipped_items": self.skipped,
            "reviews": reviews,
            "baseline_constant": baseline,
            "engines": {
                "leitner": self.leitner.summary(),
                **{f"fsrs_retention_{round(r * 100)}": self.fsrs[r].summary() for r in self.retentions},
            },
            "notes": list(NOTES),
        }


def replay(items: Iterable[Sequence[ReplayEvent]], retentions: Sequence[float]) -> dict:
    """The whole comparison for an iterable of per-item histories."""
    acc = Replay(retentions)
    for events in items:
        acc.add(events)
    return acc.report()
