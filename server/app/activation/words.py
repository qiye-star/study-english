"""沉睡 / 萌芽 / 激活列表与提示词选词(plan L4 Task 11、R8、R18)。只读;每个请求 ≤ 2 条查询。

- 列表:已学词(`vocabulary_items.source LIKE 'wordbook:%'`,同一个词取最早的学习时间)按状态分组;
  排序:盒子高在前,再按学习时间。每页 PAGE 条。计数是三种状态的总数。
- 提示词:沉睡词中盒子 ≥ HINT_MIN_BOX、词不太长的,按 (用户, 本地日, 词) 的哈希稳定取 HINT_WORDS 个。
  同一用户同一本地日结果一样;换日变化。没有合格词 → words 为空、block 为 None。
"""
import hashlib
from datetime import datetime, timezone

from sqlalchemy import select

from app.activation.states import state_of
from app.models import VocabularyItem, WordUsage, iso_utc
from app.services.usage import local_day

PAGE = 50  # 每页条数(R8 / Task 11)
HINT_WORDS = 3  # 占位
HINT_MIN_BOX = 2  # 占位
HINT_WORD_MAX_LEN = 24  # 只用短词进提示,保证整段指令不超过 300 字符
SOURCE_PREFIX = "wordbook:"
STATES = ("dormant", "sprouting", "active")


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


async def _classified(session, user_id: int, now: datetime) -> list[dict]:
    """Every learned word once (earliest learning time wins), with its state (None = just learned)."""
    learned = (await session.scalars(select(VocabularyItem).where(
        VocabularyItem.user_id == user_id, VocabularyItem.source.like(f"{SOURCE_PREFIX}%"))
        .order_by(VocabularyItem.created_at, VocabularyItem.id))).all()
    usage = {r.lemma: r for r in (await session.scalars(select(WordUsage).where(WordUsage.user_id == user_id))).all()}
    seen: dict[str, dict] = {}
    for row in learned:
        if row.word in seen:
            continue
        used = usage.get(row.word)
        learned_at = _aware(row.created_at)
        last_used = _aware(used.last_used_at) if used is not None else None
        view = {"word": row.word, "book_id": row.source[len(SOURCE_PREFIX):], "learned_at": learned_at,
                "last_used_at": last_used, "use_count": used.use_count if used is not None else 0,
                "session_count": used.session_count if used is not None else 0, "box": row.box or 0}
        view["state"] = state_of(learned_at, _UsageView(last_used, view["use_count"], view["session_count"]) if used else None,
                                 now)
        seen[row.word] = view
    return list(seen.values())


class _UsageView:
    """The three fields `state_of` reads, normalised to UTC (SQLite hands back naive datetimes)."""

    def __init__(self, last_used_at, use_count: int, session_count: int) -> None:
        self.last_used_at, self.use_count, self.session_count = last_used_at, use_count, session_count


def _public(view: dict) -> dict:
    last = view["last_used_at"]
    return {"word": view["word"], "book_id": view["book_id"], "learned_at": iso_utc(view["learned_at"]),
            "last_used_at": iso_utc(last) if last is not None else None, "use_count": view["use_count"]}


async def list_words(session, user_id: int, state: str, page: int, now: datetime) -> dict:
    views = await _classified(session, user_id, now)
    counts = {name: sum(1 for v in views if v["state"] == name) for name in STATES}
    chosen = sorted((v for v in views if v["state"] == state),
                    key=lambda v: (-v["box"], v["learned_at"], v["word"]))
    start = page * PAGE
    end = start + PAGE
    return {"state": state, "items": [_public(v) for v in chosen[start:end]], "counts": counts,
            "next_page": page + 1 if end < len(chosen) else None}


async def prompt_hint(session, user_id: int, offset: int, now: datetime) -> dict:
    views = await _classified(session, user_id, now)
    candidates = sorted(v["word"] for v in views if v["state"] == "dormant" and v["box"] >= HINT_MIN_BOX
                        and len(v["word"]) <= HINT_WORD_MAX_LEN)
    if not candidates:
        return {"words": [], "block": None}
    day = local_day(now, offset)
    ranked = sorted(candidates, key=lambda w: hashlib.sha256(f"{user_id}:{day}:{w}".encode("utf-8")).hexdigest())
    words = ranked[:HINT_WORDS]
    block = (f"Words the learner knows but has not used yet: {', '.join(words)}. Give them a natural chance to use "
             "one or two in the conversation; do not list them or quiz them.")
    return {"words": words, "block": block}
