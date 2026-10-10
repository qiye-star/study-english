"""段位点来源注册表(spec 2026-10-11-learning-links §5.1)。联动在启动时登记新来源;段位经 app.models.LinkCredit 读。

只依赖标准库。进程级注册表:同一内容重复登记是空操作(测试里会多次 create_app)。"""
import re
from dataclasses import dataclass

RESERVED_KINDS = frozenset({"assessment", "voice_turn", "chat_turn", "vocab_review", "active_day", "streak_7",
                            "stage_task", "word_learned", "spelling_set"})
_KIND = re.compile(r"^[a-z_]{1,16}$")


@dataclass(frozen=True)
class RankSource:
    kind: str
    default_points: int
    label_zh: str
    label_en: str


_sources: dict[str, RankSource] = {}


def register(source: RankSource) -> None:
    if not _KIND.fullmatch(source.kind) or source.kind in RESERVED_KINDS:
        raise ValueError(f"invalid rank source kind {source.kind!r}")
    if not 0 <= source.default_points <= 100:
        raise ValueError("default_points must be 0..100")
    existing = _sources.get(source.kind)
    if existing is not None and existing != source:
        raise ValueError(f"rank source {source.kind!r} already registered differently")
    _sources[source.kind] = source


def registered() -> tuple[RankSource, ...]:
    return tuple(_sources.values())


def kinds() -> frozenset[str]:
    return frozenset(_sources)


def get(kind: str) -> RankSource | None:
    return _sources.get(kind)


def clear_for_tests() -> None:
    _sources.clear()
