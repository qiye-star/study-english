import base64
import json

import httpx
import pytest

from app.volcengine import StreamParser, VolcengineError, parse_stream, synthesize_stream

URL = "https://volc.test/api/v3/tts/unidirectional"
OVERRIDES = {
    "volcengine_tts_key": "volc-secret",
    "volcengine_tts_url": URL,
    "tts_models": "openai/tts-1,azure/speech,volcengine/seed-tts-2.0",
}
OPENAI_TTS = "https://tts.test/v1/audio/speech"
VOICE = "en_female_dacey_uranus_bigtts"


@pytest.fixture
def settings_overrides(request):
    return getattr(request, "param", OVERRIDES)


def obj(**kw) -> bytes:
    return json.dumps(kw, ensure_ascii=False).encode()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


BODY = b"\n".join([
    obj(code=0, message="", data=b64(b"ID3aaa")),
    obj(code=0, message="中文消息", data=None, sentence={"text": "hi"}),
    obj(code=0, message="", data=b64(b"bbb")),
    obj(code=20000000, message="ok", data=None),
])


@pytest.mark.parametrize("step", [1, 2, 3, 7, 64, len(BODY)])
def test_parser_is_independent_of_chunk_boundaries(step):
    parser = StreamParser()
    chunks = []
    for i in range(0, len(BODY), step):
        chunks += parser.feed(BODY[i:i + step])
    parser.finish()
    assert chunks == [b"ID3aaa", b"bbb"]
    assert parser.audio_bytes == 9


def test_parse_stream_keeps_its_contract():
    assert parse_stream(BODY) == b"ID3aaabbb"
    for bad in (b"{bad", obj(code=0, data=None), b"[1]", "é".encode("latin-1"), obj(code=45000000, message="x")):
        with pytest.raises(VolcengineError):
            parse_stream(bad)


async def test_synthesize_stream_yields_chunks(respx_mock):
    respx_mock.post(URL).mock(return_value=httpx.Response(200, content=BODY))
    async with httpx.AsyncClient() as http:
        out = [c async for c in synthesize_stream(http, URL, "k", "seed-tts-2.0", "hello", VOICE, "1", audio_format="pcm")]
    assert out == [b"ID3aaa", b"bbb"]
    sent = json.loads(respx_mock.calls.last.request.content)
    assert sent["req_params"]["audio_params"] == {"format": "pcm", "sample_rate": 24000}


@pytest.mark.parametrize("status,kind", [(403, "auth"), (500, "upstream")])
async def test_synthesize_stream_errors_before_the_first_chunk(respx_mock, status, kind):
    respx_mock.post(URL).mock(return_value=httpx.Response(status, json={"code": 1, "message": "no"}))
    async with httpx.AsyncClient() as http:
        with pytest.raises(VolcengineError) as e:
            [c async for c in synthesize_stream(http, URL, "k", "seed-tts-2.0", "hello", VOICE, "1")]
    assert e.value.kind == kind


async def speak(client, headers, **extra):
    return await client.post("/api/ai/audio/speech",
                             json={"input": "hello", "model": "volcengine/seed-tts-2.0", "voice": VOICE, **extra},
                             headers=headers)


async def test_stream_true_passes_chunks_through(client, auth_headers, respx_mock):
    respx_mock.post(URL).mock(return_value=httpx.Response(200, content=BODY))
    r = await speak(client, auth_headers, stream=True)
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/mpeg"
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["x-accel-buffering"] == "no"
    assert r.content == b"ID3aaabbb"


async def test_stream_true_error_before_first_chunk_is_json(client, auth_headers, respx_mock):
    respx_mock.post(URL).mock(return_value=httpx.Response(403, json={"code": 1}))
    r = await speak(client, auth_headers, stream=True)
    assert r.status_code == 502
    assert r.json() == {"error": "Upstream authentication failed"}


async def test_stream_true_truncates_after_a_late_error(client, auth_headers, respx_mock):
    respx_mock.post(URL).mock(return_value=httpx.Response(200, content=obj(code=0, data=b64(b"ID3aaa")) + b"\n{bad"))
    r = await speak(client, auth_headers, stream=True)
    assert r.status_code == 200
    assert r.content == b"ID3aaa"


async def test_stream_false_is_unchanged(client, auth_headers, respx_mock):
    respx_mock.post(URL).mock(return_value=httpx.Response(200, content=BODY))
    r = await speak(client, auth_headers)
    assert r.content == b"ID3aaabbb"
    assert "cache-control" not in r.headers


async def test_stream_is_ignored_for_other_providers(client, auth_headers, respx_mock):
    respx_mock.post(OPENAI_TTS).mock(return_value=httpx.Response(200, content=b"MP3"))
    r = await client.post("/api/ai/audio/speech", json={"input": "hi", "model": "openai/tts-1", "voice": "alloy", "stream": True},
                          headers=auth_headers)
    assert r.status_code == 200 and r.content == b"MP3"


def test_parser_handles_concatenated_json_without_separators():
    body = obj(code=0, data=b64(b"one")) + obj(code=0, data=b64(b"two")) + obj(code=20000000, data=None)
    parser = StreamParser()
    assert parser.feed(body) == [b"one", b"two"]
    parser.finish()


def test_parser_splits_inside_base64_and_multibyte_text():
    body = obj(code=0, message="中文", data=b64(b"x" * 30)) + obj(code=20000000, data=None)
    cut = body.index("中".encode()) + 1  # mid-character
    parser = StreamParser()
    out = parser.feed(body[:cut]) + parser.feed(body[cut:cut + 40]) + parser.feed(body[cut + 40:])
    parser.finish()
    assert out == [b"x" * 30]


def test_parser_error_code_mid_stream_raises_after_good_chunks():
    parser = StreamParser()
    assert parser.feed(obj(code=0, data=b64(b"ok")) + b"\n") == [b"ok"]
    with pytest.raises(VolcengineError):
        parser.feed(obj(code=45000000, message="quota"))


def test_parser_rejects_bad_base64_and_overflow_and_empty():
    with pytest.raises(VolcengineError):
        StreamParser().feed(obj(code=0, data="!!notbase64!!"))
    with pytest.raises(VolcengineError):
        StreamParser(max_buffer=16).feed(b'{"code": 0, "data": "' + b"A" * 64)
    empty = StreamParser()
    assert empty.feed(b"") == []
    with pytest.raises(VolcengineError):
        empty.finish()
    only_end = StreamParser()
    only_end.feed(obj(code=20000000, data=None))
    with pytest.raises(VolcengineError):
        only_end.finish()


async def test_stream_true_empty_upstream_body_is_json_502(client, auth_headers, respx_mock):
    respx_mock.post(URL).mock(return_value=httpx.Response(200, content=b""))
    r = await speak(client, auth_headers, stream=True)
    assert r.status_code == 502
    assert r.json() == {"error": "Upstream unavailable"}


async def test_stream_true_does_not_log_text(client, auth_headers, respx_mock, caplog):
    respx_mock.post(URL).mock(return_value=httpx.Response(200, content=BODY))
    caplog.set_level("DEBUG")
    r = await client.post("/api/ai/audio/speech", headers=auth_headers, json={
        "input": "zebra-sentinel-text", "model": "volcengine/seed-tts-2.0", "voice": VOICE, "stream": True})
    assert r.status_code == 200
    assert "zebra-sentinel-text" not in caplog.text and "volc-secret" not in caplog.text


class TrackedStream(httpx.AsyncByteStream):
    def __init__(self, parts):
        self.parts, self.closed = parts, False

    async def __aiter__(self):
        for p in self.parts:
            yield p

    async def aclose(self):
        self.closed = True


async def test_closing_the_generator_closes_the_upstream_response(respx_mock):
    stream = TrackedStream([obj(code=0, data=b64(b"aa")) + b"\n", obj(code=0, data=b64(b"bb"))])
    respx_mock.post(URL).mock(return_value=httpx.Response(200, stream=stream))
    async with httpx.AsyncClient() as http:
        gen = synthesize_stream(http, URL, "k", "seed-tts-2.0", "hello", VOICE, "1")
        assert await anext(gen) == b"aa"
        assert not stream.closed
        await gen.aclose()  # what the route does when the client disconnects
    assert stream.closed


async def test_error_status_closes_the_upstream_response(respx_mock):
    stream = TrackedStream([b'{"code": 1}'])
    respx_mock.post(URL).mock(return_value=httpx.Response(500, stream=stream))
    async with httpx.AsyncClient() as http:
        with pytest.raises(VolcengineError):
            [c async for c in synthesize_stream(http, URL, "k", "seed-tts-2.0", "hello", VOICE, "1")]
    assert stream.closed
