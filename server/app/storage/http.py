"""Serve a stored blob over HTTP with byte ranges (plan 2026-10-21-l1-object-storage, R8).

LocalStore keeps Starlette's FileResponse (so `tests/test_library_range.py` still describes the real behaviour).
Other backends are streamed by the server with the same answers for the requests browsers send: single ranges
(206), unsatisfiable (416), malformed or non-byte units (400), If-Range against the ETag, and multiple ranges
answered with the whole body (200). The route checks its ticket and rows BEFORE calling this module.
"""
from __future__ import annotations

import re
from collections.abc import AsyncIterator
from email.utils import formatdate

from fastapi import Request
from fastapi.responses import FileResponse, Response, StreamingResponse

from app.storage.base import BlobInfo, BlobNotFound

_SINGLE = re.compile(r"^(\d*)-(\d*)$")  # the part after "bytes="
CHUNK = 256 * 1024


def _base_headers(info: BlobInfo, extra: dict | None, filename: str | None) -> dict:
    headers = dict(extra or {})
    headers["accept-ranges"] = "bytes"
    headers["etag"] = f'"{info.etag}"'
    headers["last-modified"] = formatdate(info.mtime, usegmt=True)
    if filename:
        headers["content-disposition"] = f'attachment; filename="{filename}"'
    return headers


def _parse(header: str | None, size: int) -> tuple[int, int] | None | str:
    """(start, end) inclusive for one satisfiable range; None = serve the whole body; "416" / "400" = error code."""
    if not header:
        return None
    if not header.startswith("bytes="):
        return "400"
    spec = header[len("bytes="):]
    if "," in spec:
        return None  # multiple ranges: RFC 9110 allows answering with the whole representation
    match = _SINGLE.match(spec.strip())
    if not match:
        return "400"
    first, last = match.group(1), match.group(2)
    if first == "" and last == "":
        return "400"
    if first == "":  # suffix range: the last N bytes
        suffix = int(last)
        if suffix == 0 or size == 0:
            return "416"
        return max(size - suffix, 0), size - 1
    start = int(first)
    if start >= size:
        return "416"
    if last == "":
        return start, size - 1
    end = int(last)
    if end < start:
        return "400"
    return start, min(end, size - 1)


async def _iterate(stream) -> AsyncIterator[bytes]:
    try:
        async for chunk in stream:
            yield chunk
    finally:
        await stream.aclose()  # runs on client disconnect too, when the response task is cancelled


async def blob_response(store, key: str, request: Request, *, media_type: str, headers: dict | None = None,
                        filename: str | None = None) -> Response:
    """Build the response for `key`. Raises BlobNotFound when the object is missing (routes map it to 404)."""
    if getattr(store, "name", "") == "local":
        return FileResponse(store.path_of(key), media_type=media_type, headers=headers, filename=filename)

    info = await store.stat(key)
    if info is None:
        raise BlobNotFound()
    size = info.size
    common = _base_headers(info, headers, filename)
    if_range = request.headers.get("if-range")
    ignore_range = bool(if_range) and if_range != f'"{info.etag}"'
    parsed = None if ignore_range else _parse(request.headers.get("range"), size)

    if parsed == "400":
        return Response(status_code=400, headers={"accept-ranges": "bytes"})
    if parsed == "416":
        return Response(status_code=416, headers={"content-range": f"bytes */{size}", "accept-ranges": "bytes"})

    if parsed is None:
        start, end, status = 0, size - 1, 200
    else:
        start, end = parsed
        status = 206
        common["content-range"] = f"bytes {start}-{end}/{size}"
    length = max(end - start + 1, 0)
    common["content-length"] = str(length)
    common.setdefault("content-type", media_type)

    if request.method == "HEAD" or length == 0:
        return Response(status_code=status, headers=common, media_type=media_type)

    stream = await store.open_range(key, start, end)
    return StreamingResponse(_iterate(stream), status_code=status, headers=common, media_type=media_type)
