"""简单英英释义的运维命令(计划 2026-10-27 S6):预填一本词书,或清除缓存行。只在用户要求时由人运行。

    docker compose exec server python -m app.wordbook.simplify_fill --book junior --limit 50 --dry-run
    docker compose exec server python -m app.wordbook.simplify_fill --book junior --limit 50
    docker compose exec server python -m app.wordbook.simplify_fill --purge --status failed

- 预填走和线上完全相同的批处理与额度(`simplify_defs_worker.run_once`);`--dry-run` 只计数,不调用模型、不写库。
- `--limit` = 最多入队的释义条数。
- 只读环境变量里的设置(不读后台的覆盖表):要生效的开关与额度请写在环境变量里。
- `--purge` 删除缓存行;正在运行的服务在 10 分钟内(或重启后)才看到变化。
- 输出只有计数与状态,不打印词、释义或改写文本。"""
import argparse
import asyncio
import json
from types import SimpleNamespace

import httpx
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.config import Settings
from app.core.db import make_engine
from app.models import WordbookSimpleDef
from app.services.prompts import PromptCache
from app.wordbook import simple_defs_worker
from app.wordbook.books import BOOK_IDS
from app.wordbook.index import dictionary
from app.wordbook.simple_defs import is_hard, simple_of, src_hash


def make_context() -> SimpleNamespace:
    """The few `app.state` fields the cache and the worker use; no FastAPI app, no background tasks."""
    settings = Settings()
    engine = make_engine(settings.database_url)
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    http = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))
    state = SimpleNamespace(settings=settings, engine=engine, sessionmaker=sessionmaker, http=http,
                            prompt_cache=PromptCache(sessionmaker))
    return SimpleNamespace(state=state)


async def _candidates(app, book: str, limit: int):
    """(key, word, pos, text) for every definition of the book that needs a rewrite and has no row yet."""
    simple = simple_of(app)
    ds = dictionary(app)
    await ds.definitions.warm()
    index = await ds.index(book)
    found = 0
    for word in index.keys:
        for d in ds.definitions.defs_for(word):
            if found >= limit:
                return
            key = (word, d["pos"], src_hash(d["text"]))
            if key in simple.rows:
                continue
            if is_hard([d["text"]], word, easy=simple.easy, lemma_of=simple.lemma_of):
                found += 1
                yield key, word, d["pos"], d["text"]


async def fill(app, *, book: str, limit: int, dry_run: bool) -> dict:
    simple = simple_of(app)
    await simple.warm(app.state.sessionmaker)
    if not simple.generating():
        return {"book": book, "status": "generation_off", "hint": "enable the switches and the upstream first"}
    if dry_run:
        pending = sum([1 async for _ in _candidates(app, book, limit)])
        return {"book": book, "dry_run": True, "pending": pending}
    queued = 0
    async for key, word, pos, text in _candidates(app, book, limit):
        simple.enqueue(key, word, pos, text)
        queued += 1
    calls = 0
    while True:  # the same batches, pacing and daily cap as the server; stops on cap, pause or an empty queue
        made = await simple_defs_worker.run_once(app)
        if not made:
            break
        calls += made
        await asyncio.sleep(simple_defs_worker.GAP_SECONDS)
    return {"book": book, "queued": queued, "calls": calls, "remaining": len(simple.queue)}


async def purge(app, *, status: str) -> int:
    stmt = delete(WordbookSimpleDef)
    if status != "all":
        stmt = stmt.where(WordbookSimpleDef.status == status)
    async with app.state.sessionmaker() as session:
        result = await session.execute(stmt)
        await session.commit()
        return result.rowcount or 0


async def _run(args) -> dict:
    app = make_context()
    try:
        if args.purge:
            deleted = await purge(app, status=args.status)
            return {"purged": deleted, "status": args.status,
                    "note": "running servers see this within 10 minutes or after a restart"}
        return await fill(app, book=args.book, limit=args.limit, dry_run=args.dry_run)
    finally:
        await app.state.http.aclose()
        await app.state.engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--book", default="junior", choices=BOOK_IDS)
    parser.add_argument("--limit", type=int, default=200, help="most definitions to queue (default 200)")
    parser.add_argument("--dry-run", action="store_true", help="count only: no model call, no write")
    parser.add_argument("--purge", action="store_true", help="delete cache rows instead of filling")
    parser.add_argument("--status", choices=("failed", "skip", "all"), default="failed", help="with --purge")
    args = parser.parse_args(argv)
    print(json.dumps(asyncio.run(_run(args)), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
