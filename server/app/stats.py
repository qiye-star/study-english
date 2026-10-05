"""学习进度统计(设计文档 §3.4,计划裁定 R15/R16)。纯函数:输入有界的已查询行,输出 GET /api/stats 的响应体。"""
import math
import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

SCAN_DAYS = 90
MAX_STATS_MESSAGES = 5000
MAX_STATS_ASSESSMENTS = 2000
MAX_POOR_WORD_ASSESSMENTS = 200
POOR_ACCURACY = 60
TOP_CATEGORIES = 5
TOP_WORDS = 10
PERIODS = (7, 30, 90)
_EDGES = re.compile(r"^[^\w']+|[^\w']+$")


@dataclass(frozen=True)
class MessageRow:
    created_at: datetime
    grammar: dict | None


@dataclass(frozen=True)
class AssessmentRow:
    created_at: datetime
    duration_ms: int | None
    scores: dict | None


def as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def local_date(value: datetime, offset_minutes: int) -> date:
    return (as_utc(value) + timedelta(minutes=offset_minutes)).date()


def local_midnight_utc(day: date, offset_minutes: int) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc) - timedelta(minutes=offset_minutes)


def window(now: datetime, days: int, offset_minutes: int) -> tuple[date, date]:
    today = local_date(now, offset_minutes)
    return today - timedelta(days=days - 1), today


def streak(active: set[date], today: date) -> int:
    """从今天往回数连续活跃日;今天还没活跃时从昨天开始数(R16)。"""
    day = today if today in active else today - timedelta(days=1)
    count = 0
    while day in active and count < SCAN_DAYS:
        count += 1
        day -= timedelta(days=1)
    return count


def grammar_categories(grammar: object) -> list[str]:
    errors = grammar.get("errors") if isinstance(grammar, dict) else None
    out: list[str] = []
    for entry in errors if isinstance(errors, list) else []:
        category = entry.get("category") if isinstance(entry, dict) else None
        if isinstance(category, str) and category:
            out.append(category)
    return out


def _finite(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def pronunciation(scores: object) -> float | None:
    return _finite(scores.get("pronunciation_score")) if isinstance(scores, dict) else None


def poor_words(result: object) -> set[str]:
    """与网页端 isPoorWord 相同:Insertion 不算;Mispronunciation/Omission 或准确度 < 60 算。同一评测里只计一次。"""
    detail = result.get("detail_result") if isinstance(result, dict) else None
    words = detail.get("words") if isinstance(detail, dict) else None
    out: set[str] = set()
    for item in words if isinstance(words, list) else []:
        if not isinstance(item, dict):
            continue
        pa = item.get("pronunciation_assessment")
        pa = pa if isinstance(pa, dict) else {}
        kind = pa.get("error_type")
        score = _finite(pa.get("accuracy_score"))
        if kind == "Insertion":
            continue
        if kind in ("Mispronunciation", "Omission") or (score is not None and score < POOR_ACCURACY):
            text = _EDGES.sub("", str(item.get("word") or "").lower())
            if text:
                out.add(text)
    return out


def _top(counter: Counter, limit: int, key: str) -> list[dict]:
    ranked = sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]
    return [{key: name, "count": count} for name, count in ranked]


def _mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def aggregate(
    *,
    now: datetime,
    days: int,
    offset_minutes: int,
    messages: Iterable[MessageRow],
    assessments: Iterable[AssessmentRow],
    poor_results: Iterable[object],
    truncated: bool,
) -> dict:
    start, today = window(now, days, offset_minutes)
    dates = [start + timedelta(days=i) for i in range(days)]
    per = {d: {"user_messages": 0, "assessments": 0, "speaking_ms": 0, "scores": []} for d in dates}
    active: set[date] = set()
    categories: Counter = Counter()
    for m in messages:
        day = local_date(m.created_at, offset_minutes)
        active.add(day)
        if day in per:
            per[day]["user_messages"] += 1
            categories.update(grammar_categories(m.grammar))
    for a in assessments:
        day = local_date(a.created_at, offset_minutes)
        active.add(day)
        if day in per:
            bucket = per[day]
            bucket["assessments"] += 1
            bucket["speaking_ms"] += max(int(a.duration_ms or 0), 0)
            score = pronunciation(a.scores)
            if score is not None:
                bucket["scores"].append(score)
    words: Counter = Counter()
    for r in poor_results:
        words.update(poor_words(r))
    daily = [
        {
            "date": d.isoformat(),
            "active": per[d]["user_messages"] > 0 or per[d]["assessments"] > 0,
            "user_messages": per[d]["user_messages"],
            "assessments": per[d]["assessments"],
            "speaking_seconds": round(per[d]["speaking_ms"] / 1000, 1),
            "avg_pronunciation": _mean(per[d]["scores"]),
        }
        for d in dates
    ]
    return {
        "days": days,
        "tz_offset_minutes": offset_minutes,
        "today": today.isoformat(),
        "daily": daily,
        "active_days": sum(1 for d in daily if d["active"]),
        "streak_days": streak(active, today),
        "user_messages": sum(per[d]["user_messages"] for d in dates),
        "assessments": sum(per[d]["assessments"] for d in dates),
        "speaking_seconds": round(sum(per[d]["speaking_ms"] for d in dates) / 1000, 1),
        "avg_pronunciation": _mean([s for d in dates for s in per[d]["scores"]]),
        "grammar_top": _top(categories, TOP_CATEGORIES, "category"),
        "poor_words": _top(words, TOP_WORDS, "word"),
        "truncated": truncated,
    }
