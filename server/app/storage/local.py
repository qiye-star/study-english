"""LocalStore: blobs as files under one root directory (plan 2026-10-21-l1-object-storage, R4).

The root is `Settings.resolved_data_dir`, so with the default backend the on-disk layout and every test that reads
`data_dir / key` stay exactly as they were. Blocking filesystem calls run in `asyncio.to_thread`.
"""
from __future__ import annotations

import asyncio
import os
import secrets
import shutil
from collections.abc import AsyncIterator
from pathlib import Path

from app.storage.base import BlobInfo, BlobNotFound, StorageError
from app.storage.keys import check_key, check_prefix

CHUNK = 256 * 1024
PART_SUFFIX = ".part"


def _info(key: str, path: Path) -> BlobInfo:
    st = path.stat()
    return BlobInfo(key=key, size=st.st_size, mtime=st.st_mtime,
                    etag=f"{st.st_size:x}-{st.st_mtime_ns:x}")


def _temp_next_to(final: Path) -> Path:
    return final.with_name(f"{final.name}.{secrets.token_hex(8)}{PART_SUFFIX}")


class _LocalRange:
    """One inclusive byte range of a local file; closes the file on `aclose` (or when iteration ends)."""

    def __init__(self, path: Path, info: BlobInfo, start: int, end: int):
        self._path = path
        self.info = info
        self.start = start
        self.end = end
        self._file = None

    async def __aiter__(self) -> AsyncIterator[bytes]:
        try:
            self._file = await asyncio.to_thread(open, self._path, "rb")
            await asyncio.to_thread(self._file.seek, self.start)
            remaining = self.end - self.start + 1
            while remaining > 0:
                chunk = await asyncio.to_thread(self._file.read, min(CHUNK, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk
        finally:
            await self.aclose()

    async def aclose(self) -> None:
        if self._file is not None:
            file, self._file = self._file, None
            await asyncio.to_thread(file.close)


class LocalStore:
    name = "local"

    def __init__(self, root: Path):
        self.root = Path(root)

    def __repr__(self) -> str:
        return "LocalStore()"

    def _path(self, key: str) -> Path:
        check_key(key)
        path = self.root / key
        if not path.resolve().is_relative_to(self.root.resolve()):
            raise ValueError("storage: invalid key")
        return path

    def path_of(self, key: str) -> Path:
        """Local-only escape hatch for `storage/http.py` (FileResponse). Nothing outside app/storage may call it."""
        path = self._path(key)
        if not path.is_file():
            raise BlobNotFound()
        return path

    async def put_file(self, key: str, path: Path, *, content_type: str | None = None) -> BlobInfo:
        return await asyncio.to_thread(self._put_file, key, Path(path))

    def _put_file(self, key: str, source: Path) -> BlobInfo:
        final = self._path(key)
        final.parent.mkdir(parents=True, exist_ok=True)
        tmp = _temp_next_to(final)
        try:
            # same-volume hard link: O(1) and the source stays in place; the staging file is then only deleted, never
            # rewritten (see the K10 pitfall in app/storage/CLAUDE.md)
            try:
                os.link(source, tmp)
            except OSError:
                shutil.copyfile(source, tmp)
            os.replace(tmp, final)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        return _info(key, final)

    async def put_bytes(self, key: str, data: bytes, *, content_type: str | None = None) -> BlobInfo:
        return await asyncio.to_thread(self._put_bytes, key, bytes(data))

    def _put_bytes(self, key: str, data: bytes) -> BlobInfo:
        final = self._path(key)
        final.parent.mkdir(parents=True, exist_ok=True)
        tmp = _temp_next_to(final)
        try:
            tmp.write_bytes(data)
            os.replace(tmp, final)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        return _info(key, final)

    async def get_bytes(self, key: str, *, max_bytes: int | None = None) -> bytes:
        return await asyncio.to_thread(self._get_bytes, key, max_bytes)

    def _get_bytes(self, key: str, max_bytes: int | None) -> bytes:
        path = self.path_of(key)
        if max_bytes is not None and path.stat().st_size > max_bytes:
            raise StorageError("too_large")
        return path.read_bytes()

    async def download_to(self, key: str, path: Path) -> BlobInfo:
        return await asyncio.to_thread(self._download_to, key, Path(path))

    def _download_to(self, key: str, target: Path) -> BlobInfo:
        source = self.path_of(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        part = target.with_name(target.name + PART_SUFFIX)
        try:
            shutil.copyfile(source, part)
            os.replace(part, target)
        except BaseException:
            part.unlink(missing_ok=True)
            raise
        return _info(key, target)

    async def open_range(self, key: str, start: int = 0, end: int | None = None):
        path = self.path_of(key)
        info = await asyncio.to_thread(_info, key, path)
        last = info.size - 1 if end is None else min(end, info.size - 1)
        if start < 0 or start > last:
            raise ValueError("storage: range not satisfiable")
        return _LocalRange(path, info, start, last)

    async def stat(self, key: str) -> BlobInfo | None:
        return await asyncio.to_thread(self._stat, key)

    def _stat(self, key: str) -> BlobInfo | None:
        path = self._path(key)
        if not path.is_file():
            return None
        return _info(key, path)

    async def delete(self, key: str) -> bool:
        return await asyncio.to_thread(self._delete, key)

    def _delete(self, key: str) -> bool:
        path = self._path(key)
        try:
            path.unlink()
        except FileNotFoundError:
            return False
        return True

    async def delete_prefix(self, prefix: str) -> int:
        return await asyncio.to_thread(self._delete_prefix, prefix)

    def _delete_prefix(self, prefix: str) -> int:
        check_prefix(prefix)
        directory = self.root / prefix.rstrip("/")
        if not directory.is_dir():
            return 0
        count = sum(1 for _ in self._walk(prefix))
        shutil.rmtree(directory, ignore_errors=True)  # best effort, like the code it replaces
        return count

    async def list(self, prefix: str) -> AsyncIterator[BlobInfo]:
        for key in await asyncio.to_thread(self._keys, prefix):
            info = await asyncio.to_thread(self._stat, key)
            if info is not None:
                yield info

    def _keys(self, prefix: str) -> list[str]:
        return sorted(key for key, _ in self._walk(prefix))

    def _walk(self, prefix: str):
        """(key, path) for every stored file under `prefix`; skips partial writes and anything not a legal key."""
        check_prefix(prefix)
        base = self.root / prefix.rstrip("/")
        if not base.is_dir():
            return
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames.sort()
            for name in filenames:
                if name.endswith(PART_SUFFIX):
                    continue
                path = Path(dirpath, name)
                key = path.relative_to(self.root).as_posix()
                try:
                    check_key(key)
                except ValueError:
                    continue
                yield key, path

    async def probe(self) -> str:
        return await asyncio.to_thread(self._probe)

    def _probe(self) -> str:
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            marker = _temp_next_to(self.root / "probe")
            marker.write_bytes(b"")
            marker.unlink()
        except OSError:
            return "not_writable"
        return "ok"
