"""S3Store: any S3-compatible store through boto3, every call run in `asyncio.to_thread` (plan L1 R5).

Only this module and `config.py` may import boto3/botocore (tests/test_architecture.py). Errors are mapped to
StorageError codes by their class and error code, never by `str(exc)`: botocore messages carry bucket names and keys.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from collections.abc import AsyncIterator
from pathlib import Path

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.storage.base import BlobInfo, BlobNotFound, StorageError
from app.storage.keys import check_key, check_prefix

log = logging.getLogger(__name__)

SHA_META = "sha256"
MULTIPART_THRESHOLD = 64 * 1024 * 1024
MAX_CONCURRENCY = 4
READ_CHUNK = 256 * 1024
DELETE_BATCH = 1000
QUIET_LOGGERS = ("botocore", "boto3", "s3transfer", "urllib3")
_NOT_FOUND = {"404", "NoSuchKey", "NotFound"}
_DENIED = {"403", "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch", "AllAccessDisabled"}


def sha256_of_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _error_code(exc: ClientError) -> str:
    return str((exc.response or {}).get("Error", {}).get("Code", ""))


def _map(exc: Exception, op: str) -> StorageError:
    """Translate a vendor exception into a StorageError. Logs only the op and the code."""
    if isinstance(exc, ClientError):
        code = _error_code(exc)
        if code in _NOT_FOUND:
            return BlobNotFound()
        if code in _DENIED:
            mapped = StorageError("denied")
        elif code == "NoSuchBucket":
            mapped = StorageError("bad_config")
        else:
            mapped = StorageError("unavailable")
    else:  # connection, timeout, endpoint and other botocore failures
        mapped = StorageError("unavailable")
    log.warning("storage op=%s code=%s", op, mapped.code)
    return mapped


def _info_from_head(key: str, head: dict) -> BlobInfo:
    meta = head.get("Metadata") or {}
    return BlobInfo(
        key=key,
        size=int(head.get("ContentLength", 0)),
        mtime=head["LastModified"].timestamp(),
        etag=str(head.get("ETag", "")).strip('"'),
        sha256=meta.get(SHA_META),
        content_type=head.get("ContentType"),
    )


class _S3Range:
    def __init__(self, body, info: BlobInfo, start: int, end: int):
        self._body = body
        self.info = info
        self.start = start
        self.end = end

    async def __aiter__(self) -> AsyncIterator[bytes]:
        try:
            while True:
                chunk = await asyncio.to_thread(self._body.read, READ_CHUNK)
                if not chunk:
                    break
                yield chunk
        finally:
            await self.aclose()

    async def aclose(self) -> None:
        body, self._body = self._body, None
        if body is not None:
            await asyncio.to_thread(body.close)


class S3Store:
    name = "s3"

    def __init__(self, client, bucket: str, *, configured: bool = True):
        self._client = client
        self._bucket = bucket
        self._configured = configured

    @classmethod
    def from_settings(cls, *, endpoint: str, bucket: str, access_key: str, secret_key: str, region: str,
                      path_style: bool) -> "S3Store":
        """Only `config.py` calls this. The keys go to boto3 and nowhere else."""
        for name in QUIET_LOGGERS:  # botocore logs request lines that contain keys; keep them out of the app log
            logging.getLogger(name).setLevel(logging.WARNING)
        config = Config(
            s3={"addressing_style": "path" if path_style else "virtual"},
            retries={"mode": "standard", "max_attempts": 3},
            connect_timeout=5,
            read_timeout=60,
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        )
        client = boto3.client(
            "s3",
            endpoint_url=endpoint or None,
            aws_access_key_id=access_key or None,
            aws_secret_access_key=secret_key or None,
            region_name=region or None,
            config=config,
        )
        return cls(client, bucket)

    def __repr__(self) -> str:
        return f"S3Store(bucket={'configured' if self._bucket else 'unset'})"

    async def _call(self, op: str, fn, *args, **kwargs):
        try:
            return await asyncio.to_thread(fn, *args, **kwargs)
        except (BlobNotFound, StorageError):
            raise
        except (ClientError, BotoCoreError, OSError) as exc:
            raise _map(exc, op) from None

    async def _head(self, key: str, op: str) -> BlobInfo:
        head = await self._call(op, self._client.head_object, Bucket=self._bucket, Key=key)
        return _info_from_head(key, head)

    async def put_file(self, key: str, path: Path, *, content_type: str | None = None) -> BlobInfo:
        check_key(key)
        digest = await asyncio.to_thread(sha256_of_file, Path(path))
        extra: dict = {"Metadata": {SHA_META: digest}}
        if content_type:
            extra["ContentType"] = content_type
        transfer = TransferConfig(multipart_threshold=MULTIPART_THRESHOLD, max_concurrency=MAX_CONCURRENCY)
        await self._call("put_file", self._client.upload_file, str(path), self._bucket, key,
                         ExtraArgs=extra, Config=transfer)
        return await self._head(key, "put_file")

    async def put_bytes(self, key: str, data: bytes, *, content_type: str | None = None) -> BlobInfo:
        check_key(key)
        data = bytes(data)
        args: dict = {"Bucket": self._bucket, "Key": key, "Body": data,
                      "Metadata": {SHA_META: hashlib.sha256(data).hexdigest()}}
        if content_type:
            args["ContentType"] = content_type
        await self._call("put_bytes", self._client.put_object, **args)
        return await self._head(key, "put_bytes")

    async def get_bytes(self, key: str, *, max_bytes: int | None = None) -> bytes:
        check_key(key)
        info = await self._head(key, "get_bytes")
        if max_bytes is not None and info.size > max_bytes:
            raise StorageError("too_large")
        response = await self._call("get_bytes", self._client.get_object, Bucket=self._bucket, Key=key)
        body = response["Body"]
        try:
            return await asyncio.to_thread(body.read)
        finally:
            await asyncio.to_thread(body.close)

    async def download_to(self, key: str, path: Path) -> BlobInfo:
        check_key(key)
        target = Path(path)
        info = await self._head(key, "download_to")
        target.parent.mkdir(parents=True, exist_ok=True)
        part = target.with_name(target.name + ".part")
        transfer = TransferConfig(multipart_threshold=MULTIPART_THRESHOLD, max_concurrency=MAX_CONCURRENCY)
        try:
            await self._call("download_to", self._client.download_file, self._bucket, key, str(part), Config=transfer)
            os.replace(part, target)
        except BaseException:
            part.unlink(missing_ok=True)
            raise
        return info

    async def open_range(self, key: str, start: int = 0, end: int | None = None) -> _S3Range:
        check_key(key)
        info = await self._head(key, "open_range")
        last = info.size - 1 if end is None else min(end, info.size - 1)
        if start < 0 or start > last:
            raise ValueError("storage: range not satisfiable")
        response = await self._call("open_range", self._client.get_object, Bucket=self._bucket, Key=key,
                                    Range=f"bytes={start}-{last}")
        return _S3Range(response["Body"], info, start, last)

    async def stat(self, key: str) -> BlobInfo | None:
        check_key(key)
        try:
            return await self._head(key, "stat")
        except BlobNotFound:
            return None

    async def delete(self, key: str) -> bool:
        check_key(key)
        if await self.stat(key) is None:
            return False
        await self._call("delete", self._client.delete_object, Bucket=self._bucket, Key=key)
        return True

    async def delete_prefix(self, prefix: str) -> int:
        check_prefix(prefix)
        deleted = 0
        pages = await self._call("delete_prefix", self._pages, prefix)
        for page_keys in pages:
            for start in range(0, len(page_keys), DELETE_BATCH):
                batch = page_keys[start:start + DELETE_BATCH]
                deleted += await self._delete_batch(batch)
        return deleted

    def _pages(self, prefix: str) -> list[list[str]]:
        paginator = self._client.get_paginator("list_objects_v2")
        return [[obj["Key"] for obj in page.get("Contents", [])]
                for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix)]

    async def _delete_batch(self, keys: list[str]) -> int:
        if not keys:
            return 0
        try:
            await self._call("delete_prefix", self._client.delete_objects, Bucket=self._bucket,
                             Delete={"Objects": [{"Key": k} for k in keys], "Quiet": True})
            return len(keys)
        except StorageError as exc:
            if exc.code != "unavailable":
                raise
        # some S3-compatible endpoints do not implement DeleteObjects: fall back to one request per key
        removed = 0
        for key in keys:
            await self._call("delete_prefix", self._client.delete_object, Bucket=self._bucket, Key=key)
            removed += 1
        return removed

    async def list(self, prefix: str) -> AsyncIterator[BlobInfo]:
        check_prefix(prefix)
        token = None
        while True:
            page = await self._call("list", self._list_page, prefix, token)
            for obj in page.get("Contents", []):
                key = obj["Key"]
                try:
                    check_key(key)
                except ValueError:
                    continue
                yield BlobInfo(key=key, size=int(obj["Size"]), mtime=obj["LastModified"].timestamp(),
                               etag=str(obj.get("ETag", "")).strip('"'))
            if not page.get("IsTruncated"):
                break
            token = page.get("NextContinuationToken")

    def _list_page(self, prefix: str, token: str | None) -> dict:
        args = {"Bucket": self._bucket, "Prefix": prefix}
        if token:
            args["ContinuationToken"] = token
        return self._client.list_objects_v2(**args)

    async def probe(self) -> str:
        try:
            await asyncio.to_thread(self._client.head_bucket, Bucket=self._bucket)
        except ClientError as exc:
            code = _error_code(exc)
            if code in {"404", "NoSuchBucket", "NotFound"}:
                return "no_bucket"
            if code in _DENIED:
                return "denied"
            return "unreachable"
        except Exception:  # noqa: BLE001  (connection and timeout failures of any class)
            return "unreachable"
        return "ok"
