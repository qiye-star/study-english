"""导师状态机(spec 2026-10-12-agents §7.2):不可变 TutorState + next_state,纯函数,自己写。

阶段 OPENING → ASK → AWAIT_ANSWER → FEEDBACK → (NEXT | REPEAT | WRAP_UP) → DONE。
FEEDBACK 与下一题的 ASK 在同一个模型回合里完成(点评 + 出题),所以持久化的阶段只有:
opening(等开场)/ ask(跳过后等智能体先开口)/ await_answer / wrap_up(最后一题已点评,等收尾)/ done。
难度由代码决定(R-T12);REPEAT = repeat / dictate 第一次 weak 时同题再来一次(R-T11)。
联机复用(A5):「谁来答」由 rooms 选择,这里不知道参与者。"""
from dataclasses import dataclass, replace
from typing import Union

from app.agents.tutor.plan import PlanItem

PHASES: tuple[str, ...] = ("opening", "ask", "await_answer", "feedback", "wrap_up", "done")
OPEN_PHASES = frozenset({"opening", "ask", "await_answer"})
VERDICTS: tuple[str, ...] = ("good", "ok", "weak", "skip")
LEVELS: tuple[str, ...] = ("A2", "B1", "B2", "C1")
DEFAULT_LEVEL = 1
STREAK_TO_MOVE = 2
HINTS_MAX = 2
REPEATS_MAX = 1
RETRY_KINDS = frozenset({"repeat", "dictate"})


class InvalidTransition(ValueError):
    """事件在当前阶段不合法:端点映射为 409,回合映射为 bad_request。"""


@dataclass(frozen=True)
class Answer:
    index: int
    kind: str
    verdict: str
    hints: int = 0


@dataclass(frozen=True)
class TutorState:
    plan: tuple[PlanItem, ...]
    phase: str = "opening"
    index: int = 0
    level: int = DEFAULT_LEVEL
    start_level: int = DEFAULT_LEVEL
    streak_good: int = 0
    streak_weak: int = 0
    hints: int = 0
    repeats: int = 0
    answers: tuple[Answer, ...] = ()
    hint_text: str = ""  # 模型给当前题的提示(META hint)
    say: str = ""        # 当前听写题的句子(META say;只在 dictate 题保留,不进可见文本)
    hint_zh: str = ""    # 模型给当前题的中文提示(META hint_zh;只随带练帧 / 提示端点下发,不进可见文本)


@dataclass(frozen=True)
class Asked:
    """智能体出了当前题(开场或跳过之后)。"""
    hint: str = ""
    say: str = ""
    hint_zh: str = ""


@dataclass(frozen=True)
class Answered:
    """模型对用户回答的评级;hint / say / hint_zh 属于下一题。"""
    verdict: str
    hint: str = ""
    say: str = ""
    hint_zh: str = ""


@dataclass(frozen=True)
class HintUsed:
    pass


@dataclass(frozen=True)
class Skipped:
    pass


@dataclass(frozen=True)
class Finished:
    pass


Event = Union[Asked, Answered, HintUsed, Skipped, Finished]


def level_index(name: object) -> int:
    return LEVELS.index(name) if isinstance(name, str) and name in LEVELS else DEFAULT_LEVEL


def new_state(plan: tuple[PlanItem, ...], level: str | None = None) -> TutorState:
    if not plan:
        raise ValueError("a tutor plan needs at least one item")
    lvl = level_index(level)
    return TutorState(plan=tuple(plan), level=lvl, start_level=lvl)


initial_state = new_state  # INDEX X6 的名字(A5 适配块);新代码用 new_state


def difficulty(state: TutorState) -> int:
    return state.level


def level_name(state: TutorState) -> str:
    return LEVELS[state.level]


def current_item(state: TutorState) -> PlanItem:
    return state.plan[state.index]


def step_number(state: TutorState) -> int:
    return state.index + 1


def is_last(state: TutorState) -> bool:
    return state.index + 1 >= len(state.plan)


def _say_for(state: TutorState, index: int, say: str) -> str:
    return say if state.plan[index].kind == "dictate" else ""


def _streaks(state: TutorState, verdict: str) -> tuple[int, int, int]:
    good, weak, level = state.streak_good, state.streak_weak, state.level
    if verdict == "good":
        good, weak = good + 1, 0
    elif verdict == "weak":
        good, weak = 0, weak + 1
    else:  # ok / skip 打断两种连续
        good, weak = 0, 0
    if good >= STREAK_TO_MOVE:
        level, good = min(len(LEVELS) - 1, level + 1), 0
    if weak >= STREAK_TO_MOVE:
        level, weak = max(0, level - 1), 0
    return good, weak, level


def _advance(state: TutorState, answer: Answer, next_phase: str, verdict: str, hint: str, say: str,
             hint_zh: str = "") -> TutorState:
    good, weak, level = _streaks(state, verdict)
    answers = state.answers + (answer,)
    if is_last(state):
        return replace(state, phase="wrap_up", answers=answers, streak_good=good, streak_weak=weak, level=level,
                       hints=0, repeats=0, hint_text="", hint_zh="", say="")
    nxt = state.index + 1
    return replace(state, phase=next_phase, index=nxt, answers=answers, streak_good=good, streak_weak=weak,
                   level=level, hints=0, repeats=0, hint_text=hint, hint_zh=hint_zh, say=_say_for(state, nxt, say))


def next_state(state: TutorState, event: Event) -> TutorState:
    if state.phase == "done":
        if isinstance(event, Finished):
            return state
        raise InvalidTransition("done")
    if isinstance(event, Finished):
        return replace(state, phase="done", hint_text="", hint_zh="", say="")
    if isinstance(event, Asked):
        if state.phase not in ("opening", "ask"):
            raise InvalidTransition(state.phase)
        return replace(state, phase="await_answer", hints=0, repeats=0, hint_text=event.hint,
                       hint_zh=event.hint_zh, say=_say_for(state, state.index, event.say))
    if state.phase != "await_answer":
        raise InvalidTransition(state.phase)
    item = state.plan[state.index]
    if isinstance(event, HintUsed):
        if state.hints >= HINTS_MAX:
            raise InvalidTransition("hints")
        return replace(state, hints=state.hints + 1)
    if isinstance(event, Skipped):
        return _advance(state, Answer(state.index, item.kind, "skip", state.hints), "ask", "skip", "", "")
    if isinstance(event, Answered):
        verdict = event.verdict if event.verdict in VERDICTS else "ok"
        if verdict == "weak" and item.kind in RETRY_KINDS and state.repeats < REPEATS_MAX:
            return replace(state, repeats=state.repeats + 1, hint_text=event.hint or state.hint_text,
                           hint_zh=event.hint_zh or state.hint_zh,
                           say=_say_for(state, state.index, event.say or state.say))
        return _advance(state, Answer(state.index, item.kind, verdict, state.hints), "await_answer", verdict,
                        event.hint, event.say, event.hint_zh)
    raise InvalidTransition(type(event).__name__)


def to_dict(state: TutorState) -> dict:
    return {"v": 1, "plan": [p.to_dict() for p in state.plan], "phase": state.phase, "index": state.index,
            "level": state.level, "start_level": state.start_level, "streak_good": state.streak_good,
            "streak_weak": state.streak_weak, "hints": state.hints, "repeats": state.repeats,
            "answers": [[a.index, a.kind, a.verdict, a.hints] for a in state.answers],
            "hint_text": state.hint_text, "hint_zh": state.hint_zh, "say": state.say}


def _int(value: object, lo: int, hi: int, default: int) -> int:
    try:
        n = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


def from_dict(data: dict) -> TutorState:
    """state JSON 只由 service 写入;读取时仍夹取每个数,坏阶段回到 opening,没有计划则 ValueError。"""
    raw_plan = data.get("plan") if isinstance(data, dict) else None
    if not isinstance(raw_plan, list) or not raw_plan:
        raise ValueError("tutor state without a plan")
    plan = tuple(PlanItem.from_dict(p) for p in raw_plan)
    last, top = len(plan) - 1, len(LEVELS) - 1
    answers = tuple(
        Answer(_int(a[0], 0, last, 0), str(a[1]), str(a[2]) if str(a[2]) in VERDICTS else "ok", _int(a[3], 0, HINTS_MAX, 0))
        for a in (data.get("answers") or []) if isinstance(a, (list, tuple)) and len(a) == 4)
    phase = data.get("phase")
    return TutorState(
        plan=plan, phase=phase if isinstance(phase, str) and phase in PHASES else "opening",
        index=_int(data.get("index"), 0, last, 0), level=_int(data.get("level"), 0, top, DEFAULT_LEVEL),
        start_level=_int(data.get("start_level"), 0, top, DEFAULT_LEVEL),
        streak_good=_int(data.get("streak_good"), 0, STREAK_TO_MOVE, 0),
        streak_weak=_int(data.get("streak_weak"), 0, STREAK_TO_MOVE, 0),
        hints=_int(data.get("hints"), 0, HINTS_MAX, 0), repeats=_int(data.get("repeats"), 0, REPEATS_MAX, 0),
        answers=answers, hint_text=str(data.get("hint_text") or ""),
        hint_zh=str(data.get("hint_zh") or ""), say=str(data.get("say") or ""))
