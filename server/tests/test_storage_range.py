"""blob_response: the same Range answers for every backend (plan L1 Task 5, R8). Local = FileResponse, S3 = streamed."""
import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.storage import BlobNotFound
from app.storage import http as http_module
from app.storage.http import blob_response
from app.storage.local import LocalStore
from tests.storage_helpers import moto_bucket, s3_store

DATA = bytes(range(256)) * 40  # 10240 bytes, as in tests/test_library_range.py
KEY = "library/1/item/media.mp4"


class FakeRequest:
    def __init__(self, headers: dict, method: str = "GET"):
        self.headers = {k.lower(): v for k, v in headers.items()}
        self.method = method


class CountingStream:
    """A fake RangeStream that records aclose(); the disconnect test uses it."""

    def __init__(self, data: bytes):
        self.info = None
        self.start = 0
        self.end = len(data) - 1
        self._data = data
        self.closed = 0

    async def __aiter__(self):
        for i in range(0, len(self._data), 1024):
            yield self._data[i:i + 1024]

    async def aclose(self):
        self.closed += 1


@pytest.fixture(params=["local", "s3"])
async def backend(request, tmp_path):
    if request.param == "local":
        store = LocalStore(tmp_path / "data")
        await store.put_bytes(KEY, DATA, content_type="video/mp4")
        yield store
        return
    with moto_bucket() as bucket:
        store = s3_store(bucket)
        await store.put_bytes(KEY, DATA, content_type="video/mp4")
        yield store


@pytest.fixture
async def client(backend):
    app = FastAPI()

    @app.api_route("/m", methods=["GET", "HEAD"])
    async def media(request: Request):
        try:
            return await blob_response(backend, KEY, request, media_type="video/mp4")
        except BlobNotFound:
            return JSONResponse({"error": "Not Found"}, status_code=404)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield c


async def test_plain_get_is_200_with_the_full_body_and_validators(client):
    r = await client.get("/m")
    assert (r.status_code, r.content, r.headers["accept-ranges"]) == (200, DATA, "bytes")
    assert r.headers["content-length"] == str(len(DATA))
    assert r.headers["etag"] and r.headers["last-modified"]


@pytest.mark.parametrize("header, body, content_range", [
    ("bytes=0-1", DATA[:2], "bytes 0-1/10240"),
    ("bytes=100-", DATA[100:], "bytes 100-10239/10240"),
    ("bytes=-500", DATA[-500:], "bytes 9740-10239/10240"),
    ("bytes=10000-99999", DATA[10000:], "bytes 10000-10239/10240"),
], ids=["first-two", "open-end", "suffix", "end-past-size"])
async def test_single_ranges_are_206_with_the_exact_bytes(client, header, body, content_range):
    r = await client.get("/m", headers={"Range": header})
    assert (r.status_code, r.content, r.headers["content-range"]) == (206, body, content_range)
    assert r.headers["content-length"] == str(len(body))


async def test_a_start_past_the_end_is_416_with_the_size(client):
    r = await client.get("/m", headers={"Range": "bytes=10240-"})
    assert (r.status_code, r.headers["content-range"]) == (416, "bytes */10240")


async def test_malformed_and_foreign_units_are_400(client):
    assert (await client.get("/m", headers={"Range": "bytes=5-2"})).status_code == 400
    assert (await client.get("/m", headers={"Range": "items=0-1"})).status_code == 400


async def test_if_range_matches_the_etag_or_falls_back_to_the_whole_body(client):
    etag = (await client.get("/m")).headers["etag"]
    assert (await client.get("/m", headers={"Range": "bytes=0-1", "If-Range": etag})).status_code == 206
    r = await client.get("/m", headers={"Range": "bytes=0-1", "If-Range": '"other"'})
    assert (r.status_code, r.content) == (200, DATA)


async def test_head_returns_headers_and_no_body(client):
    r = await client.request("HEAD", "/m", headers={"Range": "bytes=0-9"})
    assert (r.status_code, r.content) == (206, b"")
    assert r.headers["content-range"] == "bytes 0-9/10240"


async def test_multiple_ranges_differ_by_backend_as_documented(client, backend):
    r = await client.get("/m", headers={"Range": "bytes=0-1,5-6"})
    if backend.name == "local":
        assert r.status_code == 206 and b"multipart" in r.headers["content-type"].encode()
    else:
        assert (r.status_code, r.content) == (200, DATA)  # R8: S3 path answers the whole body


async def test_a_missing_object_raises_blob_not_found_for_the_route_to_map(backend):
    with pytest.raises(BlobNotFound):
        await blob_response(backend, "library/1/none/media.mp4", FakeRequest({}), media_type="video/mp4")


async def test_a_client_disconnect_closes_the_underlying_range():
    stream = CountingStream(DATA)

    class FakeStore:
        name = "s3"

        async def stat(self, key):
            return http_module.BlobInfo(key=key, size=len(DATA), mtime=0.0, etag="e")

        async def open_range(self, key, start=0, end=None):
            return stream

    response = await blob_response(FakeStore(), KEY, FakeRequest({}), media_type="video/mp4")
    iterator = response.body_iterator
    assert await iterator.__anext__() == DATA[:1024]
    await iterator.aclose()  # what Starlette does when the client goes away
    assert stream.closed == 1
