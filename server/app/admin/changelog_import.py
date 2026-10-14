"""导入更新日志草稿(spec 2026-10-14-changelog-design D5、§2.1;计划 R-12):

    python -m app.admin.changelog_import [--dir DIR] [--dry-run]
    docker compose exec server python -m app.admin.changelog_import

读取目录里的 `*.json`(每个文件是 `[{entry_date, version|null, title_zh, title_en, items:[{tag, zh, en}]}]`),按
`(entry_date, title_zh)` 幂等创建**草稿**:表里已有同一键的行(草稿、已发布、已被删除的都算)就跳过,不改内容、不改状态、不复活。
全有或全无:任何文件或条目校验失败,退出码 2、什么都不写,只打印「文件名[序号]: 字段名」。输出只有数量,不打印标题。
没有 `--dir` 时依次找 `<app 包上上级>/changelog`(镜像里是 /app/changelog)与 `<仓库根>/docs/changelog`。不放进迁移。
每条新草稿记一行审计 `changelog.import`(actor `cli`,只有条目 id)。本模块没有任何日志调用。
"""
import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.admin import audit, changelog
from app.core.config import Settings
from app.core.db import make_engine
from app.models import ChangelogEntry

IMPORT_NAME = "import"  # created_by of imported drafts
ALLOWED_KEYS = {"entry_date", "version", "title_zh", "title_en", "items"}
HERE = Path(__file__).resolve()
_ENGINES: list = []  # engines this CLI created (disposed by main(); tests patch _sessionmaker instead)


class DraftFileError(Exception):
    """`args[0]` = the list of problems, each `file[index]: …` (never contains entry text)."""


def candidate_dirs() -> list[Path]:
    return [HERE.parents[2] / "changelog", HERE.parents[3] / "docs" / "changelog"]


def default_dir() -> Path | None:
    return next((p for p in candidate_dirs() if p.is_dir()), None)


def _sessionmaker():
    engine = make_engine(Settings().database_url)
    _ENGINES.append(engine)
    return async_sessionmaker(engine, expire_on_commit=False)


def load_dir(directory: Path) -> list[tuple[str, int, dict]]:
    problems: list[str] = []
    found: list[tuple[str, int, dict]] = []
    for path in sorted(directory.glob("*.json")):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            problems.append(f"{path.name}: not readable JSON")
            continue
        if not isinstance(raw, list):
            problems.append(f"{path.name}: must be a JSON array")
            continue
        for index, item in enumerate(raw):
            if not isinstance(item, dict) or set(item) - ALLOWED_KEYS:
                problems.append(f"{path.name}[{index}]: unexpected shape")
                continue
            try:
                found.append((path.name, index, changelog.validate(item)))
            except changelog.ChangelogError as exc:
                problems.append(f"{path.name}[{index}]: invalid {', '.join(sorted(exc.fields or {}))}")
    if problems:
        raise DraftFileError(problems)
    return found


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.admin.changelog_import",
                                     description="Import changelog drafts from JSON files (idempotent, drafts only).")
    parser.add_argument("--dir", help="folder with the *.json drafts (default: /app/changelog in the image, docs/changelog in a checkout)")
    parser.add_argument("--dry-run", action="store_true", help="count what would be created and write nothing")
    return parser


async def run(argv: list[str]) -> int:
    args = _parser().parse_args(argv)
    directory = Path(args.dir) if args.dir else default_dir()
    if directory is None or not directory.is_dir():
        print("changelog folder not found (use --dir)", file=sys.stderr)
        return 1
    try:
        drafts = load_dir(directory)
    except DraftFileError as exc:
        for line in exc.args[0]:
            print(line, file=sys.stderr)
        print("nothing was imported", file=sys.stderr)
        return 2
    drafts.sort(key=lambda d: (d[2]["entry_date"], d[0], d[1]))  # ids then follow the date order (plan R-6)
    created = skipped = 0
    now = datetime.now(timezone.utc)
    async with _sessionmaker()() as s:
        known = {(day, title) for day, title in (await s.execute(select(ChangelogEntry.entry_date, ChangelogEntry.title_zh))).all()}
        for _file, _index, values in drafts:
            key = (values["entry_date"], values["title_zh"])
            if key in known:
                skipped += 1
                continue
            known.add(key)
            created += 1
            if args.dry_run:
                continue
            row = ChangelogEntry(**values, created_by=IMPORT_NAME, created_at=now, updated_at=now)
            s.add(row)
            await s.flush()
            await audit.record(s, audit.CLI_ACTOR, "changelog.import", target_type="changelog", target_id=row.id)
        await s.commit()
    print(f"{'would create' if args.dry_run else 'created'} {created}, skipped {skipped}")
    return 0


async def _main(argv: list[str]) -> int:
    try:
        return await run(argv)
    finally:
        for engine in _ENGINES:
            await engine.dispose()
        _ENGINES.clear()


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(_main(sys.argv[1:] if argv is None else argv))


if __name__ == "__main__":
    raise SystemExit(main())
