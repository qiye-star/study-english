"""Storage protocol, value types and errors (plan 2026-10-21-l1-object-storage, R3).

Nothing here imports a vendor SDK. Callers depend on `BlobStore` only.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class BlobInfo:
    key: str
    size: int
    mtime: float  # epoch seconds (UTC); S3 = LastModified, local = st_mtime
    etag: str  # opaque; used for HTTP ETag / If-Range on the S3 path
    sha256: str | None = None  # S3: object metadata `sha256`; local: None (computed on demand)
    content_type: str | None = None


class StorageError(OSError):
    """Any storage failure. `code` is one of: unavailable | denied | integrity | too_large | bad_config | not_found.

    The message never contains keys, bucket names, endpoints or credentials; only the code is meaningful.
    """

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code


class BlobNotFound(StorageError, FileNotFoundError):
    """The object does not exist. Also a FileNotFoundError, so existing `except FileNotFoundError` keeps working."""

    def __init__(self, message: str = "not_found"):
        StorageError.__init__(self, "not_found", message)


@runtime_checkable
class RangeStream(Protocol):
    """One byte range of an object: `start` and `end` are inclusive; iterate for bytes; `aclose` releases it."""

    info: BlobInfo
    start: int
    end: int

    def __aiter__(self) -> AsyncIterator[bytes]: ...

    async def aclose(self) -> None: ...


@runtime_checkable
class BlobStore(Protocol):
    name: str  # "local" | "s3" | "fallback" (diagnostics only; never contains the endpoint)

    async def put_file(self, key: str, path: Path, *, content_type: str | None = None) -> BlobInfo: ...

    async def put_bytes(self, key: str, data: bytes, *, content_type: str | None = None) -> BlobInfo: ...

    async def get_bytes(self, key: str, *, max_bytes: int | None = None) -> bytes: ...

    async def download_to(self, key: str, path: Path) -> BlobInfo: ...

    async def open_range(self, key: str, start: int = 0, end: int | None = None) -> RangeStream: ...

    async def stat(self, key: str) -> BlobInfo | None: ...

    async def delete(self, key: str) -> bool: ...

    async def delete_prefix(self, prefix: str) -> int: ...

    def list(self, prefix: str) -> AsyncIterator[BlobInfo]: ...

    async def probe(self) -> str: ...
