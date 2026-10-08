import io
import json
import logging
import wave

import httpx
import pytest

from app.speech.asr_stream import AsrStreamError

ARK = "https://ark.test/api/v3/chat/completions"
WHISPER = "https://whisper.test/v1/audio/transcriptions"
CHAT = {
    "upstream_whisper_mode": "chat",
    "upstream_whisper_base_url": "https://ark.test/api/v3",
    "upstream_whisper_key": "ark-secret",
    "upstream_whisper_model": "doubao-seed-2-0-lite-260428",
}
VOLC = {"upstream_asr_mode": "volc_stream", "volcengine_tts_key": "volc-secret"}


def make_wav(rate=16000, channels=1, frames=16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x02\x00" * frames * channels)
    return buf.getvalue()


WAV16 = make_wav()


def ok(content="chat text"):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


async def post(client, headers, data=WAV16, name="a.wav", **form):
    return await client.post(
        "/api/ai/audio/transcriptions",
        files={"file": (name, data, "application/octet-stream")},
        data=form,
        headers=headers,
    )


class Calls(list):
    state: dict


@pytest.fixture
def stream_calls(monkeypatch):
    calls = Calls()
    state = {"result": "stream text"}

    async def fake(settings, pcm, uid="server"):
        calls.append(pcm)
        result = state["result"]
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr("app.routers.ai_audio.transcribe_pcm", fake)
    calls.state = state
    return calls


@pytest.mark.parametrize("settings_overrides", [{**CHAT, **VOLC}], indirect=True)
async def test_stream_success_skips_chat(client, auth_headers, respx_mock, stream_calls, caplog):
    route = respx_mock.post(ARK).mock(return_value=ok())
    caplog.set_level(logging.INFO, logger="app.routers.ai_audio")
    r = await post(client, auth_headers, model="whisper-1", language="en-US")
    assert r.status_code == 200
    assert r.json() == {"text": "stream text", "segments": []}
    assert r.headers["content-type"].startswith("application/json")
    assert not route.called
    assert len(stream_calls) == 1 and len(stream_calls[0]) == 32000
    timing = [m for m in caplog.messages if "asr" in m and "ms" in m]
    assert timing and "audio_s=1.00" in timing[0]
    assert all("stream text" not in m and "volc-secret" not in m for m in caplog.messages)


@pytest.mark.parametrize("settings_overrides", [{**CHAT, **VOLC}], indirect=True)
@pytest.mark.parametrize("kind", ["auth", "quota", "timeout", "protocol", "upstream", "empty", "not_configured"])
async def test_stream_failure_falls_back_to_chat(client, auth_headers, respx_mock, stream_calls, caplog, kind):
    stream_calls.state["result"] = AsrStreamError(kind, "code=1 message=x")
    route = respx_mock.post(ARK).mock(return_value=ok())
    caplog.set_level(logging.INFO, logger="app.routers.ai_audio")
    r = await post(client, auth_headers)
    assert r.status_code == 200
    assert r.json() == {"text": "chat text", "segments": []}
    assert route.called
    assert any(f"kind={kind}" in m for m in caplog.messages)
    assert all("chat text" not in m and "volc-secret" not in m for m in caplog.messages)


@pytest.mark.parametrize("settings_overrides", [{**CHAT, **VOLC}], indirect=True)
@pytest.mark.parametrize(
    "data,name",
    [(make_wav(rate=44100), "a.wav"), (make_wav(channels=2), "a.wav"), (b"ID3\x04\x00" + b"x" * 10, "a.mp3")],
    ids=["44k", "stereo", "mp3"],
)
async def test_unsuitable_audio_goes_straight_to_chat(client, auth_headers, respx_mock, stream_calls, data, name):
    route = respx_mock.post(ARK).mock(return_value=ok())
    r = await post(client, auth_headers, data=data, name=name)
    assert r.status_code == 200 and r.json() == {"text": "chat text", "segments": []}
    assert not stream_calls and route.called


@pytest.mark.parametrize("settings_overrides", [{**CHAT, **VOLC}], indirect=True)
async def test_unknown_format_still_400(client, auth_headers, respx_mock, stream_calls):
    respx_mock.post(ARK).mock(return_value=ok())
    r = await post(client, auth_headers, data=b"random bytes here")
    assert r.status_code == 400
    assert r.json() == {"error": "Unsupported audio format (wav or mp3)"}
    assert not stream_calls


@pytest.mark.parametrize(
    "settings_overrides", [{**VOLC, "upstream_whisper_mode": "chat", "upstream_whisper_base_url": ""}], indirect=True
)
@pytest.mark.parametrize(
    "kind,error",
    [
        ("auth", "Upstream authentication failed"),
        ("quota", "Upstream unavailable"),
        ("timeout", "Upstream unavailable"),
        ("protocol", "Upstream unavailable"),
        ("upstream", "Upstream unavailable"),
        ("empty", "Upstream unavailable"),
    ],
)
async def test_no_fallback_translates_error(client, auth_headers, stream_calls, kind, error):
    stream_calls.state["result"] = AsrStreamError(kind, "secret-upstream-detail")
    r = await post(client, auth_headers)
    assert r.status_code == 502
    assert r.json() == {"error": error}
    assert "secret-upstream-detail" not in r.text


@pytest.mark.parametrize(
    "settings_overrides", [{**VOLC, "upstream_whisper_mode": "chat", "upstream_whisper_base_url": ""}], indirect=True
)
async def test_no_fallback_and_no_key_is_503(client, auth_headers, stream_calls):
    stream_calls.state["result"] = AsrStreamError("not_configured")
    r = await post(client, auth_headers)
    assert r.status_code == 503
    assert r.json() == {"error": "Whisper upstream is not configured"}


@pytest.mark.parametrize("settings_overrides", [{**VOLC}], indirect=True)
async def test_openai_fallback_forwards_original_multipart(client, auth_headers, respx_mock, stream_calls):
    stream_calls.state["result"] = AsrStreamError("timeout")
    route = respx_mock.post(WHISPER).mock(return_value=httpx.Response(200, json={"text": "whisper text"}))
    r = await post(client, auth_headers, model="whisper-1")
    assert r.status_code == 200 and r.json() == {"text": "whisper text"}
    sent = route.calls.last.request
    assert sent.headers["authorization"] == "Bearer wh-secret"
    assert sent.headers["content-type"].startswith("multipart/form-data")
    assert WAV16 in sent.content and b"whisper-1" in sent.content


@pytest.mark.parametrize("settings_overrides", [{**CHAT, **VOLC}], indirect=True)
async def test_missing_file_is_400(client, auth_headers, stream_calls):
    r = await client.post(
        "/api/ai/audio/transcriptions", data={"language": "en"}, files={"x": ("x", b"y")}, headers=auth_headers
    )
    assert r.status_code == 400
    assert r.json() == {"error": "Audio file is required"}
    assert not stream_calls


@pytest.mark.parametrize("settings_overrides", [{**CHAT, **VOLC}], indirect=True)
async def test_too_large_is_413(client, auth_headers, stream_calls, monkeypatch):
    monkeypatch.setattr("app.routers.ai_audio.MAX_AUDIO_BYTES", 100)
    r = await post(client, auth_headers)
    assert r.status_code == 413
    assert r.json() == {"error": "Audio file is too large"}
    assert not stream_calls


@pytest.mark.parametrize("settings_overrides", [{**CHAT, **VOLC}], indirect=True)
async def test_non_multipart_is_400(client, auth_headers, stream_calls):
    r = await client.post("/api/ai/audio/transcriptions", json={"a": 1}, headers=auth_headers)
    assert r.status_code == 400 and not stream_calls


@pytest.mark.parametrize("settings_overrides", [{**CHAT, "volcengine_tts_key": "volc-secret"}], indirect=True)
async def test_default_mode_never_streams(client, auth_headers, respx_mock, stream_calls):
    respx_mock.post(ARK).mock(return_value=ok())
    r = await post(client, auth_headers)
    assert r.status_code == 200 and r.json()["text"] == "chat text"
    assert not stream_calls


@pytest.mark.parametrize("settings_overrides", [{**CHAT, **VOLC}], indirect=True)
async def test_end_to_end_with_fake_ws_server(app, client, auth_headers, respx_mock):
    """Real asr_stream client against a local fake server (no network)."""
    import gzip
    import struct

    from websockets.asyncio.server import serve

    received = []

    async def handler(ws):
        await ws.recv()
        async for raw in ws:
            received.append(raw)
            if raw[1] & 0x0F == 0b0010:
                body = json.dumps({"result": {"text": "Fake server text."}}).encode()
                await ws.send(bytes([0x11, 0x93, 0x10, 0]) + struct.pack(">iI", 9, len(body)) + body)
                return

    route = respx_mock.post(ARK).mock(return_value=ok())
    async with serve(handler, "127.0.0.1", 0) as server:
        port = server.sockets[0].getsockname()[1]
        app.state.settings.asr_stream_url = f"ws://127.0.0.1:{port}/sauc"
        r = await post(client, auth_headers)
    assert r.status_code == 200
    assert r.json() == {"text": "Fake server text.", "segments": []}
    assert not route.called
    assert sum(len(gzip.decompress(f[8:])) for f in received) == 32000


# ---- response_format (openai mode keeps Whisper's formats) ----


@pytest.mark.parametrize("settings_overrides", [{**VOLC}], indirect=True)
@pytest.mark.parametrize("fmt", ["verbose_json", "text", "srt", "vtt"])
async def test_openai_mode_non_json_format_skips_stream(client, auth_headers, respx_mock, stream_calls, fmt):
    route = respx_mock.post(WHISPER).mock(return_value=httpx.Response(200, text="whisper says"))
    r = await post(client, auth_headers, model="whisper-1", response_format=fmt)
    assert r.status_code == 200 and r.text == "whisper says"
    assert not stream_calls
    assert f"response_format".encode() in route.calls.last.request.content
    assert fmt.encode() in route.calls.last.request.content


@pytest.mark.parametrize("settings_overrides", [{**VOLC}], indirect=True)
@pytest.mark.parametrize("fmt", [None, "", "json"], ids=["absent", "blank", "json"])
async def test_openai_mode_json_format_streams(client, auth_headers, respx_mock, stream_calls, fmt):
    route = respx_mock.post(WHISPER).mock(return_value=httpx.Response(200, json={"text": "w"}))
    form = {} if fmt is None else {"response_format": fmt}
    r = await post(client, auth_headers, **form)
    assert r.status_code == 200 and r.json() == {"text": "stream text", "segments": []}
    assert len(stream_calls) == 1 and not route.called


@pytest.mark.parametrize("settings_overrides", [{**CHAT, **VOLC}], indirect=True)
async def test_chat_mode_streams_regardless_of_format(client, auth_headers, respx_mock, stream_calls):
    route = respx_mock.post(ARK).mock(return_value=ok())
    r = await post(client, auth_headers, response_format="verbose_json")
    assert r.json() == {"text": "stream text", "segments": []}
    assert len(stream_calls) == 1 and not route.called


# ---- gate ----


@pytest.mark.parametrize("settings_overrides", [{**CHAT, **VOLC, "asr_stream_max_concurrency": 1}], indirect=True)
async def test_busy_gate_goes_straight_to_fallback(app, client, auth_headers, respx_mock, stream_calls, caplog):
    from app.speech.asr_stream import AsrGate

    gate = AsrGate(1)
    assert await gate.try_enter() is None  # occupy the only slot
    app.state.asr_gate = gate
    route = respx_mock.post(ARK).mock(return_value=ok())
    caplog.set_level(logging.INFO, logger="app.routers.ai_audio")
    r = await post(client, auth_headers)
    assert r.json() == {"text": "chat text", "segments": []}
    assert not stream_calls and route.called
    assert any("skipped reason=busy" in m for m in caplog.messages)


@pytest.mark.parametrize(
    "settings_overrides", [{**VOLC, "upstream_whisper_mode": "chat", "upstream_whisper_base_url": ""}], indirect=True
)
async def test_busy_gate_without_fallback_is_502(app, client, auth_headers, stream_calls):
    from app.speech.asr_stream import AsrGate

    gate = AsrGate(1)
    await gate.try_enter()
    app.state.asr_gate = gate
    r = await post(client, auth_headers)
    assert r.status_code == 502 and r.json() == {"error": "Upstream unavailable"}
    assert not stream_calls


@pytest.mark.parametrize("settings_overrides", [{**CHAT, **VOLC}], indirect=True)
async def test_breaker_skips_stream_after_repeated_auth_failures(client, auth_headers, respx_mock, stream_calls):
    from app.speech.asr_stream import BREAKER_THRESHOLD

    stream_calls.state["result"] = AsrStreamError("auth")
    respx_mock.post(ARK).mock(return_value=ok())
    for _ in range(BREAKER_THRESHOLD):
        assert (await post(client, auth_headers)).status_code == 200
    assert len(stream_calls) == BREAKER_THRESHOLD
    r = await post(client, auth_headers)
    assert r.json() == {"text": "chat text", "segments": []}
    assert len(stream_calls) == BREAKER_THRESHOLD  # not attempted while the breaker is open


@pytest.mark.parametrize("settings_overrides", [{**CHAT, **VOLC}], indirect=True)
async def test_slot_released_after_failure(app, client, auth_headers, respx_mock, stream_calls):
    stream_calls.state["result"] = AsrStreamError("timeout")
    respx_mock.post(ARK).mock(return_value=ok())
    for _ in range(5):
        await post(client, auth_headers)
    assert len(stream_calls) == 5
    assert not app.state.asr_gate._sem.locked()


# ---- unexpected exceptions still fall back (real transcribe_pcm) ----


@pytest.mark.parametrize("settings_overrides", [{**CHAT, **VOLC}], indirect=True)
@pytest.mark.parametrize("exc", [RecursionError, MemoryError, ValueError, KeyError])
async def test_unexpected_exception_falls_back(client, auth_headers, respx_mock, monkeypatch, caplog, exc):
    async def boom(*a, **k):
        raise exc("secret-detail")

    monkeypatch.setattr("app.speech.asr_stream._transcribe", boom)
    route = respx_mock.post(ARK).mock(return_value=ok())
    caplog.set_level(logging.INFO, logger="app.routers.ai_audio")
    r = await post(client, auth_headers)
    assert r.status_code == 200 and r.json() == {"text": "chat text", "segments": []}
    assert route.called
    line = next(m for m in caplog.messages if "volc_stream failed" in m)
    assert "kind=protocol" in line and exc.__name__ in line and "connect_id=" in line
    assert "secret-detail" not in caplog.text
