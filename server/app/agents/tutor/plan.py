"""导师出题计划(spec 2026-10-12-agents §7.1):纯函数,确定性。

题目来源混合:主题、用户的到期词 / 易错词(经上下文来源,agents 不导入 wordbook)、记忆里的弱点短语。
主题与场景都是固定键,目标里没有用户自由文本(R-T15)。"""
import re
from dataclasses import dataclass

KINDS: tuple[str, ...] = ("ask", "words", "repeat", "retell", "roleplay", "dictate")
TOPICS: tuple[str, ...] = ("free", "scenario", "today_words", "weak_words")
SCENARIOS: tuple[str, ...] = ("restaurant", "travel", "interview", "shopping", "small_talk")
INPUTS: tuple[str, ...] = ("text", "voice")
LENGTH_MIN, LENGTH_MAX, LENGTH_DEFAULT = 3, 12, 8
WORDS_PER_ITEM = 2
MAX_POOL = 24
MAX_FOCUS = 40
MAX_MEMORY_FOCUS = 3

ROTATION: dict[str, tuple[str, ...]] = {
    "free": ("ask", "words", "retell", "ask", "roleplay", "repeat", "dictate", "words"),
    "scenario": ("roleplay", "ask", "roleplay", "repeat", "words", "roleplay", "retell", "dictate"),
    "today_words": ("words", "repeat", "words", "dictate", "words", "ask", "words", "retell"),
    "weak_words": ("words", "repeat", "words", "dictate", "words", "ask", "words", "retell"),
}
NEEDS_WORDS = frozenset({"words"})              # 没有词 → 改成 ask
TAKES_ONE_WORD = frozenset({"repeat", "dictate"})  # 有词时带 1 个

_WORD = re.compile(r"^[a-z](?:[a-z' -]{0,38}[a-z])?$")
_UNSAFE = re.compile("[\\x00-\\x1f\\x7f-\\x9f   \"<>{}\\[\\]`]+")


@dataclass(frozen=True)
class Goal:
    topic: str = "free"
    length: int = LENGTH_DEFAULT
    scenario: str | None = None
    input: str = "text"
    mix: tuple[str, ...] = KINDS

    def to_dict(self) -> dict:
        return {"topic": self.topic, "scenario": self.scenario, "length": self.length, "input": self.input,
                "mix": list(self.mix)}

    @classmethod
    def from_dict(cls, data: dict) -> "Goal":
        return clean_goal(data if isinstance(data, dict) else {})


@dataclass(frozen=True)
class PlanItem:
    kind: str
    focus: str
    words: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        return {"kind": self.kind, "focus": self.focus, "words": list(self.words)}

    @classmethod
    def from_dict(cls, data: object) -> "PlanItem":
        if not isinstance(data, dict):
            raise ValueError("plan item must be an object")
        kind = data.get("kind")
        words = data.get("words")
        return cls(kind if isinstance(kind, str) and kind in KINDS else "ask", str(data.get("focus") or ""),
                   tuple(str(w) for w in words) if isinstance(words, list) else ())


@dataclass(frozen=True)
class PlanSources:
    due_words: tuple[str, ...] = ()
    weak_words: tuple[str, ...] = ()
    memory_focus: tuple[str, ...] = ()


def clamp_length(value: object) -> int:
    try:
        n = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return LENGTH_DEFAULT
    return max(LENGTH_MIN, min(LENGTH_MAX, n))


def clean_words(values: object) -> tuple[str, ...]:
    out: list[str] = []
    if not isinstance(values, (list, tuple)):
        return ()
    for value in values:
        if not isinstance(value, str):
            continue
        word = " ".join(value.strip().lower().split())
        if _WORD.fullmatch(word) and word not in out:
            out.append(word)
        if len(out) >= MAX_POOL:
            break
    return tuple(out)


def clean_focus(text: object) -> str:
    if not isinstance(text, str):
        return ""
    return " ".join(_UNSAFE.sub(" ", text).split())[:MAX_FOCUS]


def clean_goal(data: dict) -> Goal:
    topic = data.get("topic")
    topic = topic if isinstance(topic, str) and topic in TOPICS else "free"
    scenario = data.get("scenario")
    scenario = scenario if isinstance(scenario, str) and scenario in SCENARIOS else None
    scenario = (scenario or SCENARIOS[0]) if topic == "scenario" else None
    raw_mix = data.get("mix")
    mix = tuple(k for k in KINDS if isinstance(raw_mix, (list, tuple)) and k in raw_mix) or KINDS
    input_ = data.get("input")
    return Goal(topic=topic, length=clamp_length(data.get("length", LENGTH_DEFAULT)), scenario=scenario,
                input=input_ if isinstance(input_, str) and input_ in INPUTS else "text", mix=mix)


def sources_from(params_by_key: dict) -> PlanSources:
    """上下文来源结果(`SourceResult.params`)→ 计划用的词与弱点;形状不对的一律忽略。"""
    def words(key: str) -> tuple[str, ...]:
        params = params_by_key.get(key)
        return clean_words(params.get("words")) if isinstance(params, dict) else ()

    memory = params_by_key.get("memory")
    raw_focus = memory.get("focus") if isinstance(memory, dict) else None
    focus = tuple(f for f in (clean_focus(x) for x in raw_focus[:MAX_MEMORY_FOCUS]) if f) \
        if isinstance(raw_focus, list) else ()
    return PlanSources(words("due_words"), words("weak_words"), focus)


def _interleave(a: tuple[str, ...], b: tuple[str, ...]) -> list[str]:
    out: list[str] = []
    for i in range(max(len(a), len(b))):
        for seq in (a, b):
            if i < len(seq) and seq[i] not in out:
                out.append(seq[i])
    return out[:MAX_POOL]


def _pool(goal: Goal, sources: PlanSources) -> list[str]:
    if goal.topic == "today_words":
        first, second = sources.due_words, sources.weak_words
    elif goal.topic == "weak_words":
        first, second = sources.weak_words, sources.due_words
    else:
        return _interleave(sources.due_words, sources.weak_words)
    return (list(first) + [w for w in second if w not in first])[:MAX_POOL]


def build_plan(goal: Goal, sources: PlanSources) -> list[PlanItem]:
    rotation = [k for k in ROTATION[goal.topic] if k in goal.mix] or ["ask"]
    pool = _pool(goal, sources)
    default_focus = goal.scenario if goal.topic == "scenario" and goal.scenario else goal.topic
    memory = list(sources.memory_focus)
    items: list[PlanItem] = []
    cursor = 0
    for i in range(clamp_length(goal.length)):
        kind = rotation[i % len(rotation)]
        words: tuple[str, ...] = ()
        if kind in NEEDS_WORDS or kind in TAKES_ONE_WORD:
            if pool:
                take = min(WORDS_PER_ITEM if kind in NEEDS_WORDS else 1, len(pool))
                words = tuple(pool[(cursor + j) % len(pool)] for j in range(take))
                cursor += take
            elif kind in NEEDS_WORDS:
                kind = "ask"
        focus = memory.pop(0) if kind == "ask" and memory else default_focus
        items.append(PlanItem(kind, focus, words))
    return items
