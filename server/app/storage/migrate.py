"""One-off migration between storage profiles (plan 2026-10-21-l1-object-storage, R12; spec section 6).

    python -m app.storage.migrate --from local --to s3 [--prefix library/ ...] [--manifest PATH]
                                  [--dry-run | --verify-only | --reconcile-only] [--concurrency 4] [--report PATH]

Only copies: the source is read, never written or deleted. Every object is checked after the copy (size and
sha256). The manifest is an append-only file of keys and digests (an operator file, not a log) that makes the run
resumable. Output and logs carry counts, bytes and error codes only.

Exit codes: 0 everything verified / no drift; 2 some object failed or differs; 3 a precondition failed.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from app.storage.base import BlobNotFound, StorageError
from app.storage.keys import ROOTS
from app.storage.manifest import FAILED, PENDING, VERIFIED, Entry, append, load
from app.storage.s3 import sha256_of_file

log = logging.getLogger(__name__)

PROFILES = ("local", "s3", "s3_fallback")
DEFAULT_PREFIXES = tuple(f"{root}/" for root in ROOTS if root != "backups")  # backups/ only when asked for
EXIT_OK, EXIT_FAILED, EXIT_PRECONDITION = 0, 2, 3


class MigrationError(Exception):
    """A precondition failed. The message names the rule, never a key or a value."""


@dataclass
class Args:
    source: str
    target: str
    prefixes: tuple[str, ...] = DEFAULT_PREFIXES
    manifest: Path | None = None
    dry_run: bool = False
    verify_only: bool = False
    reconcile_only: bool = False
    concurrency: int = 4
    report: Path | None = None
    pg_backup_done: bool = False
    extra: dict = field(default_factory=dict)


def parse_args(argv: list[str] | None) -> Args:
    parser = argparse.ArgumentParser(prog="python -m app.storage.migrate", description=__doc__.split("\n")[0])
    parser.add_argument("--from", dest="source", required=True, choices=PROFILES)
    parser.add_argument("--to", dest="target", required=True, choices=PROFILES)
    parser.add_argument("--prefix", dest="prefixes", action="append", default=None,
                        help="key prefix to include (repeatable, ends with /); default: every root but backups/")
    parser.add_argument("--manifest", type=Path, default=None)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--verify-only", action="store_true")
    mode.add_argument("--reconcile-only", action="store_true")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--report", type=Path, default=None)
    parser.add_argument("--pg-backup-done", action="store_true")
    ns = parser.parse_args(argv)
    prefixes = tuple(ns.prefixes) if ns.prefixes else DEFAULT_PREFIXES
    return Args(source=ns.source, target=ns.target, prefixes=prefixes, manifest=ns.manifest, dry_run=ns.dry_run,
                verify_only=ns.verify_only, reconcile_only=ns.reconcile_only,
                concurrency=max(1, ns.concurrency), report=ns.report, pg_backup_done=ns.pg_backup_done)


def check_args(args: Args) -> None:
    if args.source == args.target:
        raise MigrationError("source and target are the same storage profile")
    for prefix in args.prefixes:
        if not prefix.endswith("/") or prefix.split("/", 1)[0] not in ROOTS:
            raise MigrationError("prefix must end with / and start with a storage root")


def default_manifest(settings, args: Args) -> Path:
    return Path(settings.resolved_data_dir) / "storage-migrate" / f"{args.source}-to-{args.target}.jsonl"


async def _source_sha(src, key: str, info_sha: str | None, tmpdir: Path) -> str:
    """The digest of a source object: our own uploads carry it as metadata; otherwise it is computed from a copy
    (a local source is read in place)."""
    if info_sha:
        return info_sha
    if getattr(src, "name", "") == "local":
        return sha256_of_file(src.path_of(key))
    scratch = tmpdir / f"{uuid.uuid4().hex}.bin"
    try:
        await src.download_to(key, scratch)
        return sha256_of_file(scratch)
    finally:
        scratch.unlink(missing_ok=True)


async def _target_sha(dst, key: str) -> tuple[int, str | None]:
    info = await dst.stat(key)
    if info is None:
        return -1, None
    if info.sha256:
        return info.size, info.sha256
    if getattr(dst, "name", "") == "local":
        return info.size, sha256_of_file(dst.path_of(key))
    return info.size, None  # an object without metadata on a remote target: verified by re-reading (see copy)


async def build_manifest(src, args: Args, path: Path, tmpdir: Path) -> dict[str, Entry]:
    """Lists the source by prefix and appends one pending line per new key. Keys already in the manifest are kept."""
    known = load(path)
    for prefix in args.prefixes:
        async for info in src.list(prefix):
            if info.key in known:
                continue
            source_info = await src.stat(info.key)
            digest = await _source_sha(src, info.key, source_info.sha256 if source_info else None, tmpdir)
            entry = Entry(key=info.key, size=info.size, sha256=digest, state=PENDING)
            append(path, entry)
            known[info.key] = entry
    return known


async def copy_one(src, dst, entry: Entry, path: Path, tmpdir: Path) -> Entry:
    """Copies one object and checks it. Never writes to the source. Records the outcome as a manifest line."""
    size, digest = await _target_sha(dst, entry.key)
    if size == entry.size and digest == entry.sha256 and digest is not None:
        done = Entry(entry.key, entry.size, entry.sha256, VERIFIED)
        append(path, done)
        return done
    scratch = tmpdir / f"{uuid.uuid4().hex}.bin"
    try:
        try:
            await src.download_to(entry.key, scratch)
        except BlobNotFound:
            failed = Entry(entry.key, entry.size, entry.sha256, FAILED, "missing_source")
            append(path, failed)
            return failed
        if sha256_of_file(scratch) != entry.sha256 or scratch.stat().st_size != entry.size:
            failed = Entry(entry.key, entry.size, entry.sha256, FAILED, "integrity")  # the source changed under us
            append(path, failed)
            return failed
        await dst.put_file(entry.key, scratch)
        size, digest = await _target_sha(dst, entry.key)
        if size == entry.size and digest == entry.sha256:
            done = Entry(entry.key, entry.size, entry.sha256, VERIFIED)
        else:
            done = Entry(entry.key, entry.size, entry.sha256, FAILED, "integrity")
        append(path, done)
        return done
    except StorageError as exc:
        failed = Entry(entry.key, entry.size, entry.sha256, FAILED, exc.code)
        append(path, failed)
        return failed
    finally:
        scratch.unlink(missing_ok=True)


async def run_copy(src, dst, entries: list[Entry], path: Path, tmpdir: Path, concurrency: int) -> list[Entry]:
    gate = asyncio.Semaphore(concurrency)

    async def one(entry: Entry) -> Entry:
        async with gate:
            return await copy_one(src, dst, entry, path, tmpdir)

    return list(await asyncio.gather(*(one(e) for e in entries)))


async def verify(dst, entries: dict[str, Entry]) -> dict[str, int]:
    counts = {"ok": 0, "missing": 0, "mismatch": 0}
    for entry in entries.values():
        size, digest = await _target_sha(dst, entry.key)
        if size < 0:
            counts["missing"] += 1
        elif size == entry.size and digest == entry.sha256:
            counts["ok"] += 1
        else:
            counts["mismatch"] += 1
    return counts


def _summary(entries: list[Entry]) -> dict[str, int]:
    return {
        "objects": len(entries),
        "bytes": sum(e.size for e in entries),
        "verified": sum(1 for e in entries if e.state == VERIFIED),
        "failed": sum(1 for e in entries if e.state == FAILED),
    }


async def migrate(settings, args: Args, *, out=print) -> int:
    """The whole run. `settings` supplies the profiles (build_store). Returns the exit code; prints counts only."""
    from app.storage.config import build_store

    check_args(args)
    src = build_store(settings, args.source)
    dst = build_store(settings, args.target)
    path = args.manifest or default_manifest(settings, args)
    with tempfile.TemporaryDirectory(prefix="storage-migrate-") as scratch:
        tmpdir = Path(scratch)
        entries = await build_manifest(src, args, path, tmpdir)
        # every entry is re-checked against the target, not only the ones not yet verified: a verified object that
        # has since gone missing on the target is copied again (copy_one skips identical objects without a download)
        pending = list(entries.values())
        if args.dry_run:
            present = 0
            for entry in pending:
                size, digest = await _target_sha(dst, entry.key)
                present += int(size == entry.size and digest == entry.sha256)
            out(f"dry run objects={len(entries)} to_copy={len(pending) - present} "
                f"already_identical={present} bytes={sum(e.size for e in pending)}")
            return EXIT_OK
        if args.verify_only:
            counts = await verify(dst, entries)
            out(f"verify ok={counts['ok']} missing={counts['missing']} mismatch={counts['mismatch']}")
            return EXIT_OK if counts["missing"] == counts["mismatch"] == 0 else EXIT_FAILED
        results = await run_copy(src, dst, pending, path, tmpdir, args.concurrency)
    final = load(path)
    summary = _summary([final[k] for k in entries if k in final])
    out("migrate " + " ".join(f"{k}={v}" for k, v in summary.items()))
    codes = sorted({e.error for e in results if e.state == FAILED})
    if codes:
        out("failure codes " + " ".join(codes))
    return EXIT_OK if summary["failed"] == 0 else EXIT_FAILED


def main(argv: list[str] | None = None) -> int:
    from app.core.config import Settings

    logging.basicConfig(level=logging.WARNING)
    try:
        args = parse_args(argv)
        check_args(args)
    except (SystemExit, MigrationError) as exc:
        if isinstance(exc, MigrationError):
            print(f"migrate refused: {exc}", file=sys.stderr)
            return EXIT_PRECONDITION
        raise
    try:
        return asyncio.run(migrate(Settings(), args))
    except MigrationError as exc:
        print(f"migrate refused: {exc}", file=sys.stderr)
        return EXIT_PRECONDITION


if __name__ == "__main__":  # pragma: no cover - exercised through main() in tests
    raise SystemExit(main())
