import base64
import json

import httpx
import pytest

from app.core.config import Settings

ARK = "https://ark.test/api/v3/chat/completions"
CHAT = {
    "upstream_whisper_mode": "chat",
    "upstream_whisper_base_url": "https://ark.test/api/v3",
    "upstream_whisper_key": "ark-secret",
    "upstream_whisper_model": "doubao-seed-2-0-lite-260428",
}
WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 20


@pytest.fixture
def settings_overrides():
    return CHAT


def ok(content="  hello world \n", **extra):
    msg = {"content": content, **extra}
    return httpx.Response(200, json={"choices": [{"message": msg}]})


async def post(client, headers, data=WAV, name="a.wav", **form):
    return await client.post(
        "/api/ai/audio/transcriptions",
        files={"file": (name, data, "application/octet-stream")},
        data=form,
        headers=headers,
    )


async def test_success_request_shape(client, auth_headers, respx_mock):
    route = respx_mock.post(ARK).mock(return_value=ok())
    r = await post(client, auth_headers, model="whisper-1", response_format="verbose_json")
    assert r.status_code == 200
    assert r.json() == {"text": "hello world", "segments": []}
    assert r.headers["content-type"].startswith("application/json")
    sent = route.calls.last.request
    assert sent.headers["authorization"] == "Bearer ark-secret"
    body = json.loads(sent.content)
    assert body["model"] == "doubao-seed-2-0-lite-260428"
    assert body["temperature"] == 0
    first, second = body["messages"][0]["content"]
    assert first["type"] == "input_audio"
    assert first["input_audio"]["format"] == "wav"
    assert base64.b64decode(first["input_audio"]["data"]) == WAV
    assert second["type"] == "text" and "verbatim" in second["text"]
    assert "The audio language" not in second["text"]


async def test_reasoning_not_leaked(client, auth_headers, respx_mock):
    respx_mock.post(ARK).mock(
        return_value=ok("hi", reasoning_content="secret-reasoning", encrypted_content="secret-enc")
    )
    r = await post(client, auth_headers)
    assert r.status_code == 200
    assert "secret-reasoning" not in r.text and "secret-enc" not in r.text
    assert set(r.json()) == {"text", "segments"}


@pytest.mark.parametrize("head", [b"ID3\x04\x00", b"\xff\xfb\x90\x00"])
async def test_mp3_format(client, auth_headers, respx_mock, head):
    route = respx_mock.post(ARK).mock(return_value=ok())
    r = await post(client, auth_headers, data=head + b"x" * 10, name="a.mp3")
    assert r.status_code == 200
    body = json.loads(route.calls.last.request.content)
    assert body["messages"][0]["content"][0]["input_audio"]["format"] == "mp3"


async def test_unknown_format_is_400(client, auth_headers, respx_mock):
    route = respx_mock.post(ARK).mock(return_value=ok())
    r = await post(client, auth_headers, data=b"random bytes here")
    assert r.status_code == 400
    assert r.json() == {"error": "Unsupported audio format (wav or mp3)"}
    assert not route.called


async def test_language_hint(client, auth_headers, respx_mock):
    route = respx_mock.post(ARK).mock(return_value=ok())
    await post(client, auth_headers, language="en-US")
    text = json.loads(route.calls.last.request.content)["messages"][0]["content"][1]["text"]
    assert text.endswith(" The audio language is en.")


async def test_too_large_is_413(client, auth_headers, respx_mock, monkeypatch):
    monkeypatch.setattr("app.routers.ai_audio.MAX_CHAT_AUDIO_BYTES", 100)
    route = respx_mock.post(ARK).mock(return_value=ok())
    r = await post(client, auth_headers, data=WAV + b"x" * 500)
    assert r.status_code == 413
    assert r.json() == {"error": "Audio file is too large"}
    assert not route.called


@pytest.mark.parametrize("status", [401, 403])
async def test_upstream_auth_failure_is_502(client, auth_headers, respx_mock, status):
    respx_mock.post(ARK).mock(return_value=httpx.Response(status, text="secret-upstream-text"))
    r = await post(client, auth_headers)
    assert r.status_code == 502
    assert r.json() == {"error": "Upstream authentication failed"}
    assert "secret-upstream-text" not in r.text


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500, text="secret-upstream-text"),
        httpx.ConnectError("secret-upstream-text"),
        ok(""),
        ok("   "),
        httpx.Response(200, json={"choices": [{"message": {"reasoning_content": "secret-upstream-text"}}]}),
        httpx.Response(200, json={"choices": [], "x": "secret-upstream-text"}),
        httpx.Response(200, text="secret-upstream-text"),
    ],
)
async def test_upstream_problems_are_502(client, auth_headers, respx_mock, response):
    effect = response if isinstance(response, Exception) else None
    mock = respx_mock.post(ARK)
    if effect:
        mock.mock(side_effect=effect)
    else:
        mock.mock(return_value=response)
    r = await post(client, auth_headers)
    assert r.status_code == 502
    assert r.json() == {"error": "Upstream unavailable"}
    assert "secret-upstream-text" not in r.text


@pytest.mark.parametrize("override", [{"upstream_whisper_model": ""}, {"upstream_whisper_base_url": ""}])
async def test_unconfigured_is_503(app, client, auth_headers, override):
    for k, v in override.items():
        setattr(app.state.settings, k, v)
    r = await post(client, auth_headers)
    assert r.status_code == 503
    assert r.json() == {"error": "Whisper upstream is not configured"}


async def test_requires_auth(client):
    r = await client.post("/api/ai/audio/transcriptions", files={"file": ("a.wav", WAV)})
    assert r.status_code == 401


async def test_non_multipart_is_400(client, auth_headers):
    r = await client.post("/api/ai/audio/transcriptions", json={"a": 1}, headers=auth_headers)
    assert r.status_code == 400


async def test_missing_file_is_400(client, auth_headers):
    r = await client.post(
        "/api/ai/audio/transcriptions", data={"language": "en"}, files={"x": ("x", b"y")},
        headers=auth_headers,
    )
    assert r.status_code == 400


def test_settings_defaults():
    s = Settings(_env_file=None)
    assert s.upstream_whisper_mode == "openai"
    assert s.upstream_whisper_model == ""


async def test_cap_boundary(client, auth_headers, respx_mock):
    from app.routers.ai_audio import MAX_CHAT_AUDIO_BYTES

    assert MAX_CHAT_AUDIO_BYTES == 18_000_000
    assert MAX_CHAT_AUDIO_BYTES * 4 // 3 + 4 < 25_000_000
    route = respx_mock.post(ARK).mock(return_value=ok())
    r = await post(client, auth_headers, data=WAV + b"\x00" * (MAX_CHAT_AUDIO_BYTES - len(WAV)))
    assert r.status_code == 200
    n = len(route.calls)
    r = await post(client, auth_headers, data=WAV + b"\x00" * (MAX_CHAT_AUDIO_BYTES + 1 - len(WAV)))
    assert r.status_code == 413 and len(route.calls) == n
