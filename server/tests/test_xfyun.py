import asyncio
import base64
import hashlib
import hmac
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
from websockets.asyncio.server import serve

from app.config import Settings
from app.xfyun import XfyunError, XfyunIse, XfyunNotConfigured, signed_url

FIXTURE_XML = (Path(__file__).parent / "fixtures" / "ise_good.xml").read_text(encoding="utf-8")
NOW = datetime(2026, 10, 3, 1, 2, 3, tzinfo=timezone.utc)


def _query(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}


def _expected_signature(host: str, path: str, secret: str, date: str) -> str:
    origin = f"host: {host}\ndate: {date}\nGET {path} HTTP/1.1"
    digest = hmac.new(secret.encode(), origin.encode(), hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


def test_signed_url_is_deterministic():
    url = signed_url("wss://ise-api.xfyun.cn/v2/open-ise", "key", "secret", now=NOW)
    assert url.startswith("wss://ise-api.xfyun.cn/v2/open-ise?")
    q = _query(url)
    assert q["date"] == "Sat, 03 Oct 2026 01:02:03 GMT"
    assert q["host"] == "ise-api.xfyun.cn"
    sig = _expected_signature("ise-api.xfyun.cn", "/v2/open-ise", "secret", q["date"])
    assert base64.b64decode(q["authorization"]).decode() == (
        f'api_key="key", algorithm="hmac-sha256", headers="host date request-line", signature="{sig}"'
    )
    assert signed_url("wss://ise-api.xfyun.cn/v2/open-ise", "key", "secret", now=NOW) == url


def test_signed_url_host_and_path_follow_ws_url():
    url = signed_url("ws://127.0.0.1:9999/custom", "key", "secret", now=NOW)
    assert url.startswith("ws://127.0.0.1:9999/custom?")
    q = _query(url)
    assert q["host"] == "127.0.0.1:9999"
    sig = _expected_signature("127.0.0.1:9999", "/custom", "secret", q["date"])
    assert f'signature="{sig}"' in base64.b64decode(q["authorization"]).decode()


class FakeIse:
    def __init__(self):
        self.frames: list[dict] = []
        self.mode = "ok"
        self.big = 0
        self.raw = ""
        self.url = ""

    async def handler(self, ws):
        async for raw in ws:
            frame = json.loads(raw)
            self.frames.append(frame)
            if self.mode == "silent":
                continue
            if self.mode in ("early_error", "early_close"):
                if self.mode == "early_error":
                    await ws.send(json.dumps({"code": 10163, "message": "bad param"}))
                await ws.close()
                return
            if self.mode == "raw":
                await ws.send(self.raw)
                return
            if self.mode == "error":
                await ws.send(json.dumps({"code": 10163, "message": "bad param", "data": None}))
                return
            if self.mode == "big_message":
                await ws.send("x" * self.big)
                return
            if self.mode == "big_xml":
                chunk = base64.b64encode(b"a" * self.big).decode()
                for _ in range(2):
                    await ws.send(json.dumps({"code": 0, "data": {"status": 1, "data": chunk}}))
                return
            if frame.get("data", {}).get("status") == 2:
                for _ in range(2):
                    await ws.send(json.dumps({"code": 0, "message": "success", "data": {"status": 1, "data": None}}))
                xml = base64.b64encode(FIXTURE_XML.encode()).decode()
                await ws.send(json.dumps({"code": 0, "message": "success", "data": {"status": 2, "data": xml}}))
                return


@pytest.fixture
async def fake():
    f = FakeIse()
    async with serve(f.handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        f.url = f"ws://127.0.0.1:{port}/v2/open-ise"
        yield f


def _client(url: str) -> XfyunIse:
    return XfyunIse("app123", "key", "secret", url)


async def test_evaluate_happy_path(fake):
    pcm = b"\x01\x02" * 3000
    xml = await _client(fake.url).evaluate(pcm=pcm, text="Hello world", ent="en_vip")
    assert xml == FIXTURE_XML

    first = fake.frames[0]
    assert first["common"]["app_id"] == "app123"
    b = first["business"]
    assert b["category"] == "read_sentence"
    assert b["sub"] == "ise"
    assert b["ent"] == "en_vip"
    assert b["cmd"] == "ssb"
    assert b["ise_unite"] == "1"
    assert b["rst"] == "entirety"
    assert b["extra_ability"] == "multi_dimension"
    assert b["auf"] == "audio/L16;rate=16000"
    assert b["text"] == "﻿[content]\nHello world"
    assert first["data"]["status"] == 0

    audio = fake.frames[1:]
    assert len(audio) >= 3
    chunks = [base64.b64decode(f["data"]["data"]) for f in audio]
    assert all(len(c) <= 1280 for c in chunks)
    assert b"".join(chunks) == pcm
    assert audio[0]["business"]["aus"] == 1
    assert audio[-1]["business"]["aus"] == 4
    assert audio[-1]["data"]["status"] == 2
    for f in audio[:-1]:
        assert f["data"]["status"] == 1
    for f in audio[1:-1]:
        assert f["business"]["aus"] == 2
    for f in audio:
        assert f["business"]["cmd"] == "auw"
        assert f["data"]["data_type"] == 1


async def test_single_chunk_audio_is_last_frame(fake):
    await _client(fake.url).evaluate(pcm=b"\x01\x02" * 100, text="Hi", ent="en_vip")
    audio = fake.frames[1:]
    assert len(audio) == 1
    assert audio[0]["data"]["status"] == 2
    assert audio[0]["business"]["aus"] == 4


async def test_error_code_raises(fake):
    fake.mode = "error"
    with pytest.raises(XfyunError) as exc:
        await _client(fake.url).evaluate(pcm=b"\x00\x00" * 100, text="Hi", ent="en_vip")
    assert exc.value.code == 10163
    assert "bad param" in exc.value.message
    assert "secret" not in str(exc.value) and "authorization=" not in str(exc.value)


async def test_timeout_raises_xfyun_error(fake):
    fake.mode = "silent"
    with pytest.raises(XfyunError) as exc:
        await _client(fake.url).evaluate(pcm=b"\x00\x00" * 100, text="Hi", ent="en_vip", timeout=0.3)
    assert exc.value.code is None
    assert "timed out" in exc.value.message


async def test_connection_refused_raises_xfyun_error():
    with pytest.raises(XfyunError) as exc:
        await _client("ws://127.0.0.1:1/v2/open-ise").evaluate(pcm=b"\x00\x00", text="Hi", ent="en_vip", timeout=5)
    assert exc.value.code is None
    assert "secret" not in str(exc.value) and "authorization=" not in str(exc.value)


async def test_oversized_message_raises(fake):
    fake.mode = "big_message"
    fake.big = 1024 * 1024 + 10
    with pytest.raises(XfyunError):
        await _client(fake.url).evaluate(pcm=b"\x00\x00" * 100, text="Hi", ent="en_vip")


async def test_oversized_accumulated_xml_raises(fake):
    fake.mode = "big_xml"
    fake.big = 600 * 1024
    with pytest.raises(XfyunError):
        await _client(fake.url).evaluate(pcm=b"\x00\x00" * 100, text="Hi", ent="en_vip")


def test_not_configured():
    c = XfyunIse("", "", "", "wss://x/y")
    assert c.configured is False
    with pytest.raises(XfyunNotConfigured):
        asyncio.run(c.evaluate(pcm=b"\x00\x00", text="Hi", ent="en_vip"))
    assert XfyunIse("a", "b", "c", "wss://x/y").configured is True


def test_settings_defaults():
    s = Settings(_env_file=None)
    assert s.xfyun_app_id == ""
    assert s.xfyun_api_key == ""
    assert s.xfyun_api_secret == ""
    assert s.xfyun_ws_url == "wss://ise-api.xfyun.cn/v2/open-ise"


async def test_early_error_frame_with_close_keeps_provider_code(fake):
    fake.mode = "early_error"
    with pytest.raises(XfyunError) as exc:
        await _client(fake.url).evaluate(pcm=b"\x01\x02" * 1_000_000, text="Hi", ent="en_vip")
    assert exc.value.code == 10163


async def test_close_without_frame_is_generic_error(fake):
    fake.mode = "early_close"
    with pytest.raises(XfyunError) as exc:
        await _client(fake.url).evaluate(pcm=b"\x01\x02" * 1_000_000, text="Hi", ent="en_vip")
    assert exc.value.code is None


async def test_early_close_after_small_send_reports_early_close(fake):
    fake.mode = "early_close"
    with pytest.raises(XfyunError) as exc:
        await _client(fake.url).evaluate(pcm=b"\x01\x02" * 10, text="Hi", ent="en_vip")
    assert exc.value.code is None
    assert "early" in exc.value.message


async def test_empty_pcm_sends_one_empty_last_frame(fake):
    xml = await _client(fake.url).evaluate(pcm=b"", text="Hi", ent="en_vip")
    assert xml == FIXTURE_XML
    audio = fake.frames[1:]
    assert len(audio) == 1
    assert audio[0]["business"]["aus"] == 4
    assert audio[0]["data"]["status"] == 2
    assert audio[0]["data"]["data"] == ""


@pytest.mark.parametrize(
    "raw",
    [
        "not json",
        "[1, 2]",
        '"str"',
        "5",
        '{"code": "0", "data": {"status": 2}}',
        '{"code": null}',
        '{"code": true}',
        '{"code": 0, "data": "oops"}',
        '{"code": 0, "data": [1]}',
        '{"code": 0, "data": {"status": 1, "data": 123}}',
        '{"code": 0, "data": {"status": 1, "data": "@@@"}}',
    ],
)
async def test_malformed_messages_raise_xfyun_error(fake, raw):
    fake.mode = "raw"
    fake.raw = raw
    with pytest.raises(XfyunError):
        await _client(fake.url).evaluate(pcm=b"\x00\x00" * 100, text="Hi", ent="en_vip")


async def test_provider_message_is_truncated_and_sanitised(fake):
    fake.mode = "raw"
    fake.raw = json.dumps({"code": 10163, "message": "a\x00b\n" + "x" * 500})
    with pytest.raises(XfyunError) as exc:
        await _client(fake.url).evaluate(pcm=b"\x00\x00" * 100, text="Hi", ent="en_vip")
    assert exc.value.code == 10163
    assert len(exc.value.message) <= 200
    assert "\x00" not in exc.value.message and "\n" not in exc.value.message


def test_signed_url_ignores_userinfo():
    url = signed_url("wss://user:pw@ise-api.xfyun.cn:8443/v2/open-ise", "key", "secret", now=NOW)
    assert "user" not in url and "pw@" not in url
    assert _query(url)["host"] == "ise-api.xfyun.cn:8443"


def test_get_xfyun_caches_on_app_state():
    from types import SimpleNamespace

    from app.xfyun import get_xfyun

    settings = Settings(_env_file=None, xfyun_app_id="a", xfyun_api_key="k", xfyun_api_secret="s")
    state = SimpleNamespace(settings=settings)
    request = SimpleNamespace(app=SimpleNamespace(state=state))
    first = get_xfyun(request)
    assert get_xfyun(request) is first
    assert state.xfyun is first
    assert first.configured is True
