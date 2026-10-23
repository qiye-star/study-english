"""回填:为已 ready 但还没有 v1 标记的条目建句子索引(plan L4 R12)。只在用户要求时运行,从不自动执行。

    python -m app.activation.backfill [--dry-run] [--chunk 50] [--limit N]

只打印数字(`items=… rows=…`),不打印标题、句子、用户或条目 id。可中断、可续跑:每个条目一次提交;
标记行决定哪些条目已经做过,所以再跑一遍只补剩下的。
"""
import argparse
import asyncio
import sys
from types import SimpleNamespace

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.activation.indexer import MARKER, MARKER_IDX, index_owner
from app.core.config import Settings
from app.core.db import make_engine
from app.models import CatalogItem, LibraryItem, SegmentLemma
from app.wordbook.forms import Forms, default_path

SCOPES = (("lib", LibraryItem), ("cat", CatalogItem))


async def pending_owners(session, model, scope: str, after: str, limit: int) -> list[str]:
    marked = select(SegmentLemma.owner_id).where(
        SegmentLemma.scope == scope, SegmentLemma.idx == MARKER_IDX, SegmentLemma.lemma == MARKER)
    stmt = (select(model.id).where(model.status == "ready", model.id > after, model.id.not_in(marked))
            .order_by(model.id).limit(limit))
    return list((await session.scalars(stmt)).all())


async def run(sessionmaker, *, lemma_of, dry_run: bool = False, chunk: int = 50, limit: int | None = None) -> dict:
    holder = SimpleNamespace(state=SimpleNamespace(sessionmaker=sessionmaker))  # index_owner reads only this
    size = max(1, chunk)
    counts = {"items": 0, "rows": 0}
    for scope, model in SCOPES:
        after = ""
        while True:
            async with sessionmaker() as session:
                owners = await pending_owners(session, model, scope, after, size)
            if not owners:
                break
            for owner in owners:
                if limit is not None and counts["items"] >= limit:
                    return counts
                counts["items"] += 1
                if not dry_run:
                    counts["rows"] += await index_owner(holder, scope, owner, lemma_of=lemma_of)
            after = owners[-1]
    return counts


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.activation.backfill",
                                     description="Build the sentence index for ready items that lack it (counts only).")
    parser.add_argument("--dry-run", action="store_true", help="count the items that would be indexed; write nothing")
    parser.add_argument("--chunk", type=int, default=50, help="items read per page (default 50)")
    parser.add_argument("--limit", type=int, default=None, help="stop after this many items")
    return parser


async def _main(argv: list[str], *, sessionmaker=None, lemma_of=None) -> str:
    args = _parser().parse_args(argv)
    engine = None
    if sessionmaker is None:  # the command line: build the engine and the word-form table from the settings
        settings = Settings()
        engine = make_engine(settings.database_url)
        sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
        forms = Forms(default_path(settings.resolved_wordbook_data_dir))
        await forms.warm()
        lemma_of = forms.lemma_of
    try:
        counts = await run(sessionmaker, lemma_of=lemma_of, dry_run=args.dry_run, chunk=args.chunk, limit=args.limit)
    finally:
        if engine is not None:
            await engine.dispose()
    return f"items={counts['items']} rows={counts['rows']}" + (" dry-run" if args.dry_run else "")


def main(argv: list[str] | None = None) -> int:
    print(asyncio.run(_main(sys.argv[1:] if argv is None else argv)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
