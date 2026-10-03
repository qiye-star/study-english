from fastapi import HTTPException, Request
from starlette.datastructures import FormData
from starlette.formparsers import MultiPartException
from starlette.requests import Request as StarletteRequest


async def read_limited_body(request: Request, limit: int) -> bytes:
    too_large = HTTPException(413, "Audio file is too large")
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise too_large
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise too_large
        chunks.append(chunk)
    return b"".join(chunks)


async def parse_buffered_form(request: Request, body: bytes) -> FormData:
    """Parse an already-buffered multipart body by replaying it to Starlette."""
    sent = False

    async def replay():
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    try:
        return await StarletteRequest(request.scope, replay).form()
    except (MultiPartException, ValueError):
        raise HTTPException(400, "Invalid multipart body")
