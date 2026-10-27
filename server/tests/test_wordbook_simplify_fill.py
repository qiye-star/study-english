"""简单英英释义的运维命令(计划 2026-10-27 S6):预填 / 干跑 / 清除。假的 llm.complete,不访问网络。"""
import json
import re
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.models import WordbookSimpleDef
from app.providers import llm
from app.wordbook import simplify_fill
from app.wordbook.simple_defs import simple_of

NOW = datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc)


def _configure(app, *, generate=True, daily=0):
    app.state.settings = app.state.settings.model_copy(update={
        "wordbook_simple_defs_enabled": True, "wordbook_simple_defs_generate": generate,
        "wordbook_simple_defs_daily": daily, "upstream_llm_base_url": "https://llm.example"})
    return simple_of(app)


class EmptyRewrites:
    """Answers every item with an empty text: the check rejects it, so each row becomes `skip` (no real model)."""

    def __init__(self):
        self.calls = 0

    async def __call__(self, http, settings, messages, *, model, max_tokens, temperature, timeout=60.0):
        self.calls += 1
        ids = re.findall(r"<item id=(\d+) ", messages[0]["content"])
        return json.dumps({"items": [{"id": int(i), "text": ""} for i in ids]})


@pytest.fixture
def fake(monkeypatch):
    fake = EmptyRewrites()
    monkeypatch.setattr(llm, "complete", fake)
    return fake


async def _count(app, status=None) -> int:
    stmt = select(func.count()).select_from(WordbookSimpleDef)
    if status is not None:
        stmt = stmt.where(WordbookSimpleDef.status == status)
    async with app.state.sessionmaker() as session:
        return int(await session.scalar(stmt))


async def test_a_dry_run_counts_without_calling_the_model_or_writing(app, fake):
    _configure(app)
    result = await simplify_fill.fill(app, book="junior", limit=5, dry_run=True)
    assert result == {"book": "junior", "dry_run": True, "pending": result["pending"]}
    assert 0 < result["pending"] <= 5
    assert fake.calls == 0 and await _count(app) == 0


async def test_a_fill_queues_runs_the_batches_and_writes_the_rows(app, fake, monkeypatch):
    _configure(app)
    monkeypatch.setattr(simplify_fill.simple_defs_worker, "GAP_SECONDS", 0)
    result = await simplify_fill.fill(app, book="junior", limit=3, dry_run=False)
    assert result["queued"] == 3 and result["calls"] >= 1 and result["remaining"] == 0
    assert fake.calls == result["calls"]
    assert await _count(app, "skip") == 3  # every rewrite was rejected: the originals stay


async def test_a_fill_with_generation_off_does_nothing(app, fake):
    _configure(app, generate=False)
    result = await simplify_fill.fill(app, book="junior", limit=3, dry_run=False)
    assert result["status"] == "generation_off" and fake.calls == 0 and await _count(app) == 0


async def test_purge_deletes_only_the_chosen_status(app):
    async with app.state.sessionmaker() as session:
        for i, status in enumerate(["failed", "failed", "skip", "ok"]):
            session.add(WordbookSimpleDef(word=f"w{i}", pos="v", src_hash=f"{i:016d}", text=None if status != "ok" else "x",
                                          status=status, attempts=0, model="m", created_at=NOW, updated_at=NOW))
        await session.commit()
    assert await simplify_fill.purge(app, status="failed") == 2
    assert await _count(app) == 2
    assert await simplify_fill.purge(app, status="all") == 2
    assert await _count(app) == 0


async def test_the_output_carries_counts_and_status_only(app, fake):
    _configure(app)
    result = await simplify_fill.fill(app, book="junior", limit=2, dry_run=True)
    assert set(result) == {"book", "dry_run", "pending"}  # counts and names only, never a word


def test_bad_arguments_are_rejected_before_any_work():
    with pytest.raises(SystemExit):
        simplify_fill.main(["--book", "not-a-book"])
