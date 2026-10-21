"""Offline FSRS replay (L3 plan R12). Read-only: it never writes the database or the settings.

    python -m app.admin.fsrs_replay [--since YYYY-MM-DD] [--retention 85,90,95] [--out PATH]

Prints one JSON object of aggregate numbers: Leitner's implied predictions, FSRS at each retention, and a constant
baseline. It never prints words, user ids, item ids or message text, and it has no logging calls.
Events are streamed one item at a time, ordered by item and time, so the whole table is never in memory.
"""
import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.config import Settings
from app.core.db import make_engine
from app.models import WordbookEvent
from app.services.srs_replay import Replay, ReplayEvent
from app.wordbook.grading import event_grade
from app.wordbook.quiz import CHOICE_QTYPES
from app.wordbook.recall import LEARN_BOX

_ENGINES: list = []  # engines this CLI created (disposed by main(); tests patch _sessionmaker instead)
RETENTION_BOUNDS = (85, 95)


def _sessionmaker():
    engine = make_engine(Settings().database_url)
    _ENGINES.append(engine)
    return async_sessionmaker(engine, expire_on_commit=False)


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _to_replay(kind: str, qtype: str | None, outcome: str, credit: int, created_at: datetime) -> ReplayEvent | None:
    at = _aware(created_at)
    if kind in ("learn", "relearn"):
        start = 0 if qtype in CHOICE_QTYPES else LEARN_BOX.get(outcome, 0)
        return ReplayEvent(at=at, kind=kind, start_box=start)
    if kind == "review":
        return ReplayEvent(at=at, kind="review", grade=event_grade(qtype, outcome, credit))
    return None  # practice, blank, spell_set, goal, reset ... are not scheduled reviews


async def build_report(sessionmaker, *, since: datetime | None, retentions: list[int]) -> dict:
    acc = Replay([r / 100 for r in retentions])
    stmt = (
        select(WordbookEvent.item_id, WordbookEvent.kind, WordbookEvent.qtype, WordbookEvent.outcome,
               WordbookEvent.credit, WordbookEvent.created_at)
        .where(WordbookEvent.item_id.is_not(None))
        .order_by(WordbookEvent.item_id, WordbookEvent.created_at, WordbookEvent.id)
    )
    if since is not None:
        stmt = stmt.where(WordbookEvent.created_at >= since)
    async with sessionmaker() as session:
        current, group = None, []
        result = await session.stream(stmt)
        async for row in result:
            if row.item_id != current:
                if group:
                    acc.add(group)
                current, group = row.item_id, []
            ev = _to_replay(row.kind, row.qtype, row.outcome, row.credit, row.created_at)
            if ev is not None:
                group.append(ev)
        if group:
            acc.add(group)
    return acc.report()


def _retention_list(text: str) -> list[int]:
    try:
        values = [int(part) for part in text.split(",") if part.strip()]
    except ValueError as exc:
        raise argparse.ArgumentTypeError("retention values are whole percentages, e.g. 85,90,95") from exc
    low, high = RETENTION_BOUNDS
    if not values or any(not low <= v <= high for v in values):
        raise argparse.ArgumentTypeError(f"retention values must be between {low} and {high}")
    return values


def _since(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=timezone.utc)


async def _main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Compare Leitner and FSRS predictions on the review history (read-only).")
    parser.add_argument("--since", type=_since, default=None, help="only events on or after this UTC date (YYYY-MM-DD)")
    parser.add_argument("--retention", type=_retention_list, default=[90], help="comma-separated percentages, 85-95")
    parser.add_argument("--out", type=Path, default=None, help="also write the JSON to this path")
    args = parser.parse_args(argv)
    try:
        report = await build_report(_sessionmaker(), since=args.since, retentions=args.retention)
        text = json.dumps(report, ensure_ascii=False, indent=2)
        print(text)
        if args.out is not None:
            args.out.write_text(text + "\n", encoding="utf-8")
        return 0
    finally:
        for engine in _ENGINES:
            await engine.dispose()
        _ENGINES.clear()


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(_main(sys.argv[1:] if argv is None else argv))


if __name__ == "__main__":
    raise SystemExit(main())
