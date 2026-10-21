"""确定性拼写判分(spec §6.6,裁定 R-W7):正确 / 小笔误 / 词形不对 / 错误 + 逐字母对齐。不调用 LLM。"""
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from app.wordbook.textnorm import fold, inflections, lemma_candidates

Outcome = Literal["correct", "typo", "inflection", "wrong"]
CREDIT: dict[str, int] = {"correct": 100, "typo": 50, "inflection": 50, "wrong": 0}
_ORDER = ("correct", "typo", "inflection", "wrong")
MAX_ALIGN_GAP = 3


@dataclass(frozen=True)
class DiffOp:
    op: Literal["eq", "sub", "ins", "del"]
    a: str  # expected
    b: str  # typed


@dataclass(frozen=True)
class BlankResult:
    outcome: Outcome
    credit: int
    typed: str
    expected: str
    diff: tuple[DiffOp, ...]


def _table(a: str, b: str) -> list[list[int]]:
    d = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        d[i][0] = i
    for j in range(len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] != b[j - 1]))
    return d


def levenshtein(a: str, b: str) -> int:
    return _table(a, b)[len(a)][len(b)]


def align(expected: str, typed: str) -> tuple[DiffOp, ...]:
    """逐字母对齐:eq 相同、sub 写错、del 漏写(期望有、输入无)、ins 多写(输入有、期望无)。"""
    d = _table(expected, typed)
    i, j, ops = len(expected), len(typed), []
    while i or j:
        if i and j and d[i][j] == d[i - 1][j - 1] + (expected[i - 1] != typed[j - 1]):
            same = expected[i - 1] == typed[j - 1]
            ops.append(DiffOp("eq" if same else "sub", expected[i - 1], typed[j - 1]))
            i, j = i - 1, j - 1
        elif i and d[i][j] == d[i - 1][j] + 1:
            ops.append(DiffOp("del", expected[i - 1], ""))
            i -= 1
        else:
            ops.append(DiffOp("ins", "", typed[j - 1]))
            j -= 1
    return tuple(reversed(ops))


def typo_limit(n: int) -> int:
    return 1 if n <= 4 else 2


def grade_blank(expected: str, lemma: str, typed: str, *, hinted: bool = False) -> BlankResult:
    """expected = 句中的实际词形,lemma = 原形;typed 是用户输入(只用于判分,不得写日志)。"""
    e, t, base = fold(expected), fold(typed), fold(lemma)
    if t == e:
        outcome: Outcome = "correct"
    elif t and (t in inflections(base) or base in lemma_candidates(t)):
        outcome = "inflection"
    elif t and abs(len(t) - len(e)) <= typo_limit(len(e)) and levenshtein(e, t) <= typo_limit(len(e)):
        outcome = "typo"
    else:
        outcome = "wrong"
    credit = CREDIT[outcome] // (2 if hinted else 1)
    diff = align(e, t) if outcome in ("typo", "wrong") and t and abs(len(t) - len(e)) <= MAX_ALIGN_GAP else ()
    return BlankResult(outcome, credit, typed.strip(), expected, diff)


def worst(outcomes: Iterable[Outcome]) -> Outcome:
    return max(outcomes, key=_ORDER.index)


def srs_grade(outcome: str, hinted: bool) -> Literal["good", "hard", "forgot"]:
    if outcome == "wrong":
        return "forgot"
    if outcome == "correct" and not hinted:
        return "good"
    return "hard"


# ---- L3 (plan R5): Easy for a fast, clean typed review; the answer's `grade` field stays srs_grade ----
EASY_BASE_MS = 3000  # 占位,待回放 / 真实数据定稿(L3 R5)
EASY_PER_CHAR_MS = 350  # 占位
EASY_QTYPES = ("spell", "dictation")


def review_grade(outcome: str, hinted: bool, *, qtype: str, elapsed_ms: int | None, length: int) -> str:
    """The grade that goes into scheduling. Easy only for an unhinted correct typed answer within the time limit."""
    if (outcome == "correct" and not hinted and qtype in EASY_QTYPES and elapsed_ms is not None
            and elapsed_ms <= EASY_BASE_MS + EASY_PER_CHAR_MS * length):
        return "easy"
    return srs_grade(outcome, hinted)


def event_grade(qtype: str | None, outcome: str, credit: int) -> str | None:
    """Replay helper: the rating an event stands for, or None for events that are not ratings.
    Easy cannot be recovered from a stored event (L3 R8), so a fast correct answer reads as good."""
    if outcome in ("wrong", "unknown"):
        return "forgot"
    if outcome in ("know", "know_chk"):
        return "good"
    if outcome == "correct":
        return "good" if credit >= 100 else "hard"
    if outcome in ("typo", "inflection", "fuzzy"):
        return "hard"
    return None
