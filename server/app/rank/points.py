"""RP rules, daily cap and stage tasks (spec 2026-10-09 §2.2–2.3). Pure."""
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta

CAPPED = frozenset({"assessment", "voice_turn", "chat_turn", "vocab_review"})
POINTS = {"chat_turn": 1, "vocab_review": 1, "active_day": 5, "streak_7": 15, "stage_task": 10}
STREAK_STEP = 7


def assessment_points(score: float | None, *, rules=None) -> int:
    """`rules` (admin v2, plan P-6): a RankRules read by duck typing; None = the built-in bands."""
    if rules is not None:
        bands = rules.points.assessment_bands
        if score is None:
            return bands[-1][1]
        return next((pts for floor, pts in bands if score >= floor), bands[-1][1])
    if score is None:
        return 1
    if score >= 85:
        return 4
    if score >= 70:
        return 3
    return 1


@dataclass(frozen=True)
class Candidate:
    kind: str
    ref_id: str
    day: str
    points: int
    score: int | None
    created_at: datetime


def cap_daily(candidates: list[Candidate], used: dict[str, int], cap: int) -> list[Candidate]:
    """Capped kinds share `cap` points per local day (already-used points count). Trimmed events keep
    their row with fewer (possibly 0) points so they are never re-evaluated."""
    spent = dict(used)
    out: list[Candidate] = []
    for item in sorted(candidates, key=lambda x: (x.created_at, x.kind, x.ref_id)):
        if item.kind in CAPPED:
            left = max(0, cap - spent.get(item.day, 0))
            points = min(item.points, left)
            spent[item.day] = spent.get(item.day, 0) + points
            out.append(replace(item, points=points))
        else:
            out.append(item)
    return out


def streak_ends(active: set[date]) -> list[date]:
    """Days on which a run of consecutive active days reaches a multiple of 7."""
    ends: list[date] = []
    for day in sorted(active):
        if day - timedelta(days=1) in active:
            continue
        length, cursor = 0, day
        while cursor in active:
            length += 1
            if length % STREAK_STEP == 0:
                ends.append(cursor)
            cursor += timedelta(days=1)
    return ends


@dataclass(frozen=True)
class StageTask:
    key: str
    kind: str
    target: int
    min_score: int | None = None


def _tasks(assess: tuple[int, int | None], second: tuple[str, int], third: tuple[str, int]) -> tuple[StageTask, ...]:
    return (StageTask("assess", "assess", assess[0], assess[1]),
            StageTask(second[0], second[0], second[1]), StageTask(third[0], third[0], third[1]))


STAGE_TASKS: dict[int, tuple[StageTask, ...]] = {
    0: _tasks((10, None), ("chat_turns", 20), ("vocab_reviews", 10)),
    1: _tasks((15, 70), ("chat_turns", 40), ("active_days", 5)),
    2: _tasks((20, 75), ("voice_turns", 20), ("vocab_reviews", 30)),
    3: _tasks((25, 80), ("voice_turns", 40), ("active_days", 10)),
    4: _tasks((30, 85), ("voice_turns", 60), ("vocab_reviews", 60)),
    5: _tasks((40, 85), ("voice_turns", 80), ("active_days", 15)),
    6: (),
}
_KIND_OF = {"chat_turns": "chat_turn", "voice_turns": "voice_turn", "vocab_reviews": "vocab_review"}


@dataclass(frozen=True)
class EventRow:
    kind: str
    score: int | None
    day: str


@dataclass(frozen=True)
class TaskProgress:
    key: str
    kind: str
    done: int
    target: int
    min_score: int | None
    complete: bool


def _done(task: StageTask, events: list[EventRow]) -> int:
    if task.kind == "assess":
        return sum(1 for e in events if e.kind == "assessment"
                   and (task.min_score is None or (e.score is not None and e.score >= task.min_score)))
    if task.kind == "active_days":
        return len({e.day for e in events if e.kind == "active_day"})
    return sum(1 for e in events if e.kind == _KIND_OF[task.kind])


def points_for(kind: str, *, rules=None) -> int:
    """Fixed points of a non-assessment kind (chat_turn, vocab_review, active_day, streak_7, stage_task)."""
    return getattr(rules.points, kind) if rules is not None else POINTS[kind]


def stage_tasks_for(tier: int, *, rules=None) -> tuple:
    return tuple(rules.stage_tasks.get(tier, ())) if rules is not None else STAGE_TASKS.get(tier, ())


def stage_progress(tier: int, events: list[EventRow], *, rules=None) -> list[TaskProgress]:
    out = []
    for task in stage_tasks_for(tier, rules=rules):
        done = _done(task, events)
        out.append(TaskProgress(task.key, task.kind, min(done, task.target), task.target, task.min_score, done >= task.target))
    return out
