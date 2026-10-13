"""Spike S0 / E4 核对项:锁定的 Starlette(uv.lock 1.7.0)的 `FileResponse` 自带 Range 支持。iOS Safari 对媒体
必须拿到 206 才能 seek 与循环,所以这里直接钉住框架行为(不经跟读库的路由);升级 Starlette 时这组测试先红。"""
import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import FileResponse

DATA = bytes(range(256)) * 40  # 10240 bytes


@pytest.fixture
async def client(tmp_path):
    path = tmp_path / "media.mp4"
    path.write_bytes(DATA)
    app = FastAPI()

    @app.get("/m")
    async def media():
        return FileResponse(path, media_type="video/mp4")

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield c


async def test_plain_get_advertises_ranges(client):
    r = await client.get("/m")
    assert (r.status_code, r.content, r.headers["accept-ranges"]) == (200, DATA, "bytes")
    assert r.headers["content-length"] == str(len(DATA)) and r.headers["etag"] and r.headers["last-modified"]


@pytest.mark.parametrize("header, body, content_range", [
    ("bytes=0-1", DATA[:2], "bytes 0-1/10240"),
    ("bytes=100-", DATA[100:], "bytes 100-10239/10240"),
    ("bytes=-500", DATA[-500:], "bytes 9740-10239/10240"),
    ("bytes=10000-99999", DATA[10000:], "bytes 10000-10239/10240"),
], ids=["first-two", "open-end", "suffix", "end-past-size"])
async def test_single_ranges_are_206(client, header, body, content_range):
    r = await client.get("/m", headers={"Range": header})
    assert (r.status_code, r.content, r.headers["content-range"]) == (206, body, content_range)
    assert r.headers["content-length"] == str(len(body))


async def test_unsatisfiable_is_416_with_the_size(client):
    r = await client.get("/m", headers={"Range": "bytes=10240-"})
    assert (r.status_code, r.headers["content-range"]) == (416, "bytes */10240")


async def test_malformed_is_400_and_unknown_units_are_400(client):
    assert (await client.get("/m", headers={"Range": "bytes=5-2"})).status_code == 400
    assert (await client.get("/m", headers={"Range": "items=0-1"})).status_code == 400


async def test_if_range_matches_the_etag_or_falls_back_to_200(client):
    etag = (await client.get("/m")).headers["etag"]
    assert (await client.get("/m", headers={"Range": "bytes=0-1", "If-Range": etag})).status_code == 206
    r = await client.get("/m", headers={"Range": "bytes=0-1", "If-Range": '"other"'})
    assert (r.status_code, r.content) == (200, DATA)


async def test_multiple_ranges_are_multipart_byteranges(client):
    r = await client.get("/m", headers={"Range": "bytes=0-1,100-101"})
    assert r.status_code == 206 and r.headers["content-type"].startswith("multipart/byteranges; boundary=")
    assert DATA[:2] in r.content and DATA[100:102] in r.content
