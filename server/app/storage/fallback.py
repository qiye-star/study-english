"""FallbackStore: read the primary, then the old store, during a migration window (plan L1 R11, spec section 6).

Writes and deletes touch the primary only; the secondary is never modified (copy, do not move). `list` covers the
primary only, so the sweeper and reconciliation work on the new store. Hits are counted in-process and logged
without keys.
"""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from pathlib import Path

from app.storage.base import BlobInfo, BlobNotFound

log = logging.getLogger(__name__)


class FallbackStore:
    name = "fallback"

    def __init__(self, primary, secondary):
        self.primary = primary
        self.secondary = secondary
        self.hits = 0

    def __repr__(self) -> str:
        return "FallbackStore()"

    def _hit(self, op: str) -> None:
        self.hits += 1
        log.info("storage fallback hit op=%s", op)

    async def put_file(self, key: str, path: Path, *, content_type: str | None = None) -> BlobInfo:
        return await self.primary.put_file(key, path, content_type=content_type)

    async def put_bytes(self, key: str, data: bytes, *, content_type: str | None = None) -> BlobInfo:
        return await self.primary.put_bytes(key, data, content_type=content_type)

    async def get_bytes(self, key: str, *, max_bytes: int | None = None) -> bytes:
        try:
            return await self.primary.get_bytes(key, max_bytes=max_bytes)
        except BlobNotFound:
            data = await self.secondary.get_bytes(key, max_bytes=max_bytes)
            self._hit("get_bytes")
            return data

    async def download_to(self, key: str, path: Path) -> BlobInfo:
        try:
            return await self.primary.download_to(key, path)
        except BlobNotFound:
            info = await self.secondary.download_to(key, path)
            self._hit("download_to")
            return info

    async def open_range(self, key: str, start: int = 0, end: int | None = None):
        try:
            return await self.primary.open_range(key, start, end)
        except BlobNotFound:
            stream = await self.secondary.open_range(key, start, end)
            self._hit("open_range")
            return stream

    async def stat(self, key: str) -> BlobInfo | None:
        info = await self.primary.stat(key)
        if info is not None:
            return info
        info = await self.secondary.stat(key)
        if info is not None:
            self._hit("stat")
        return info

    async def delete(self, key: str) -> bool:
        return await self.primary.delete(key)

    async def delete_prefix(self, prefix: str) -> int:
        return await self.primary.delete_prefix(prefix)

    def list(self, prefix: str) -> AsyncIterator[BlobInfo]:
        return self.primary.list(prefix)

    async def probe(self) -> str:
        return await self.primary.probe()
