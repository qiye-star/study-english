"""片段规则(纯函数,plan L5 R3、R6)。只依赖标准库。

`check` 返回固定错误码(见 `app/dubbing/errors.py`)或 None;路由把码映射成 HTTP 错误。
上限是占位:未用真实素材校准(plan L5 风险一节),经 `GET /api/dubbing/config` 下发给网页,网页只做提示,以服务端为准。
"""
from dataclasses import dataclass
from typing import Protocol

# PLACEHOLDER: 12 lines / 90 s are not calibrated against real clips (plan L5 R6). Change only with a plan addendum.
MAX_LINES = 12
MAX_MS = 90_000
ROLE_KEYS = ("A", "B", "C", "D", "E", "F")  # plan L5 R3; a clip never has more roles than this
MAX_ROLES = 6
NAME_MAX = 24


class SegLike(Protocol):
    start_ms: int
    end_ms: int
    speaker: str | None


@dataclass(frozen=True)
class Seg:
    start_ms: int
    end_ms: int
    speaker: str | None = None


def check(segs: list[SegLike], seg_from: int, seg_to: int, role: str) -> str | None:
    """Return the error code for a clip [seg_from, seg_to] played as `role`, or None when it is valid.

    Order: the range first ("clip"), then the size limits ("clip_too_long"), then the role ("role_missing")."""
    if not all(isinstance(v, int) and not isinstance(v, bool) for v in (seg_from, seg_to)):
        return "clip"
    if seg_from < 0 or seg_to < seg_from or seg_to >= len(segs):
        return "clip"
    if seg_to - seg_from + 1 > MAX_LINES:
        return "clip_too_long"
    if segs[seg_to].end_ms - segs[seg_from].start_ms > MAX_MS:
        return "clip_too_long"
    if role not in ROLE_KEYS or not any(s.speaker == role for s in segs[seg_from:seg_to + 1]):
        return "role_missing"
    return None


def mine(segs: list[SegLike], seg_from: int, seg_to: int, role: str) -> list[int]:
    """Sentence indexes inside the clip that belong to `role`, in order."""
    return [i for i in range(seg_from, seg_to + 1) if segs[i].speaker == role]


def speakers_in(segs: list[SegLike], seg_from: int, seg_to: int) -> list[str]:
    """The role letters that occur in the clip, sorted (unlabelled lines are not listed)."""
    return sorted({s.speaker for s in segs[seg_from:seg_to + 1] if s.speaker in ROLE_KEYS})


def clean_role(raw: object) -> str | None:
    """A role letter, upper-cased and trimmed; anything else (including non-strings) is None."""
    if not isinstance(raw, str):
        return None
    value = raw.strip().upper()
    return value if value in ROLE_KEYS else None


def clean_name(raw: object) -> str | None:
    """A role display name: spaces collapsed, 1..24 characters. Names are user content: never logged."""
    if not isinstance(raw, str):
        return None
    value = " ".join(raw.split())
    return value if 1 <= len(value) <= NAME_MAX else None
