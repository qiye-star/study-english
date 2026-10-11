"""过程事件(spec 2026-10-12-agents §4.4):数据类 → SSE 文本 / 字典;compact_trace 压缩过程(≤ 4 KB,随 assistant 消息
写进 messages.agent_trace)。纯函数。

事件里允许出现词(`Step.params`,如查词 abandon),永远没有完整用户消息、账号信息或上游错误原文(`Error` 只有错误码)。"""
import json
from dataclasses import asdict, dataclass
from typing import ClassVar

TRACE_VERSION = 1
TRACE_MAX_BYTES = 4096
ERROR_CODES = ("disabled", "limit", "llm_unavailable", "bad_request", "busy")
STEP_STATUSES = ("run", "done", "fail", "skip")
STEP_GROUPS = ("context", "tool")
THOUGHT_SOURCES = ("summary", "reasoning")
CONTEXT_KEYS = frozenset({"persona", "memory", "history"})
META_KEYS = ("step_index", "steps_total", "verdict", "kind", "done", "retry", "say")  # retry / say: AX-1 (A3 R-T3)
PARAM_KEYS_MAX = 5
PARAM_TEXT_MAX = 40
PARAM_LIST_MAX = 8
THOUGHT_TRACE_MAX = 600
THOUGHT_TRACE_SHORT = 200
STEPS_KEEP = 12


def dumps(data) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def size_of(data) -> int:
    return len(dumps(data).encode("utf-8"))


def group_of(key: str) -> str:
    return "context" if key in CONTEXT_KEYS else "tool"


def label_of(key: str) -> str:
    return f"agents.step.{key}"


def clean_params(params) -> dict:
    """≤ 5 个键(标识符,≤ 24 字符);整数 / 布尔原样,字符串 ≤ 40 字符,列表只留字符串且 ≤ 8 项;其他丢弃。"""
    out: dict = {}
    if not isinstance(params, dict):
        return out
    for key, value in params.items():
        if len(out) >= PARAM_KEYS_MAX:
            break
        if not isinstance(key, str) or not key.isidentifier() or len(key) > 24:
            continue
        if isinstance(value, (bool, int)):
            out[key] = value
        elif isinstance(value, str):
            out[key] = value[:PARAM_TEXT_MAX]
        elif isinstance(value, (list, tuple)):
            out[key] = [v[:PARAM_TEXT_MAX] for v in value if isinstance(v, str)][:PARAM_LIST_MAX]
    return out


class Event:
    type: ClassVar[str] = ""

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}

    def to_sse(self) -> str:
        return f"event: {self.type}\ndata: {dumps(self.to_dict())}\n\n"


@dataclass(frozen=True)
class Start(Event):
    type: ClassVar[str] = "start"
    turn_id: str


@dataclass(frozen=True)
class Step(Event):
    type: ClassVar[str] = "step"
    id: str
    group: str
    key: str
    status: str
    label_key: str
    private: bool
    params: dict | None = None
    ms: int | None = None

    def __post_init__(self):
        if self.status not in STEP_STATUSES or self.group not in STEP_GROUPS:
            raise ValueError("bad step")


@dataclass(frozen=True)
class Thought(Event):
    type: ClassVar[str] = "thought"
    source: str
    text: str

    def __post_init__(self):
        if self.source not in THOUGHT_SOURCES:
            raise ValueError("bad thought source")


@dataclass(frozen=True)
class Delta(Event):
    type: ClassVar[str] = "delta"
    text: str


@dataclass(frozen=True)
class Meta(Event):
    type: ClassVar[str] = "meta"
    step_index: int
    steps_total: int
    verdict: str | None = None
    kind: str | None = None
    done: bool | None = None
    retry: bool | None = None
    say: str | None = None

    @classmethod
    def from_dict(cls, data) -> "Meta | None":
        if not isinstance(data, dict):
            return None
        try:
            meta = cls(**{k: data[k] for k in META_KEYS if k in data})
        except TypeError:
            return None
        if not all(isinstance(v, int) and not isinstance(v, bool) for v in (meta.step_index, meta.steps_total)):
            return None
        return meta


@dataclass(frozen=True)
class Done(Event):
    type: ClassVar[str] = "done"
    text_len: int
    trace: dict
    usage: tuple[int, int] | None = None

    def to_dict(self) -> dict:
        out = {"text_len": self.text_len, "trace": self.trace}
        if self.usage is not None:
            out["usage"] = {"in": self.usage[0], "out": self.usage[1]}
        return out


@dataclass(frozen=True)
class Error(Event):
    type: ClassVar[str] = "error"
    code: str

    def __post_init__(self):
        if self.code not in ERROR_CODES:
            raise ValueError("bad error code")


def compact_trace(outcomes, tools: str, thought: Thought | None, *, ms: dict | None = None) -> dict:
    """压缩过程:每步 key / group / status / ms / private / label(+ 清洗过的 params)、生效的工具方式、思路(≤ 600 字)、
    耗时。`outcomes` 是有 key / status / result / ms / private 属性的对象(context.SourceOutcome)。"""
    steps = []
    for o in outcomes:
        result = getattr(o, "result", None)
        step = {"key": o.key, "group": group_of(o.key), "status": o.status, "ms": int(o.ms), "private": bool(o.private),
                "label": result.label_key if result is not None else label_of(o.key)}
        params = clean_params(result.params) if result is not None else {}
        if params:
            step["params"] = params
        steps.append(step)
    out: dict = {"v": TRACE_VERSION, "tools": str(tools)[:16], "steps": steps}
    if thought is not None and thought.text:
        out["thought"] = {"source": thought.source, "text": thought.text[:THOUGHT_TRACE_MAX], "chars": len(thought.text)}
    if ms:
        out["ms"] = {k: int(v) for k, v in ms.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
    return fit(out)


def fit(data: dict) -> dict:
    """缩到 ≤ 4 KB:思路截到 200 字 → 去掉思路 → 去掉 params → 只留前 12 步 → 只留版本与工具方式。"""
    if size_of(data) <= TRACE_MAX_BYTES:
        return data
    t = json.loads(dumps(data))
    if "thought" in t:
        t["thought"]["text"] = t["thought"]["text"][:THOUGHT_TRACE_SHORT]
        if size_of(t) <= TRACE_MAX_BYTES:
            return t
        del t["thought"]
        if size_of(t) <= TRACE_MAX_BYTES:
            return t
    for step in t["steps"]:
        step.pop("params", None)
    if size_of(t) <= TRACE_MAX_BYTES:
        return t
    t["steps"] = t["steps"][:STEPS_KEEP]
    t["truncated"] = True
    if size_of(t) <= TRACE_MAX_BYTES:
        return t
    return {"v": TRACE_VERSION, "tools": t.get("tools", ""), "steps": [], "truncated": True}


def check_stored(raw: object) -> dict:
    """客户端随 assistant 消息回存的 agent_trace:带整数 `v` 的对象,JSON ≤ 4 KB(R-C17)。"""
    if not isinstance(raw, dict) or isinstance(raw.get("v"), bool) or not isinstance(raw.get("v"), int):
        raise ValueError("invalid")
    if size_of(raw) > TRACE_MAX_BYTES:
        raise ValueError("too_large")
    return raw
