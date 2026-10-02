import json

import httpx
import pytest

AZURE_TTS = "https://eastus.tts.speech.microsoft.com/cognitiveservices/v1"
OPENAI_TTS = "https://tts.test/v1/audio/speech"
WHISPER = "https://whisper.test/v1/audio/transcriptions"


async def test_speech_requires_auth(client):
    r = await client.post("/api/ai/audio/speech", json={"input": "hi", "model": "azure/speech"})
    assert r.status_code == 401


async def test_azure_speech(client, auth_headers, respx_mock):
    route = respx_mock.post(AZURE_TTS).mock(return_value=httpx.Response(200, content=b"MP3DATA"))
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "a < b", "model": "azure/speech", "voice": "en-US-AvaNeural"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.content == b"MP3DATA"
    assert r.headers["content-type"] == "audio/mpeg"
    sent = route.calls.last.request
    assert sent.headers["ocp-apim-subscription-key"] == "az-secret"
    assert b"a &lt; b" in sent.content and b"xml:lang='en-US'" in sent.content


async def test_azure_speech_rejects_bad_voice(client, auth_headers):
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "hi", "model": "azure/speech", "voice": "bad voice"},
        headers=auth_headers,
    )
    assert r.status_code == 400


async def test_azure_speech_failure_is_502(client, auth_headers, respx_mock):
    respx_mock.post(AZURE_TTS).mock(return_value=httpx.Response(500))
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "hi", "model": "azure/speech", "voice": "en-US-AvaNeural"},
        headers=auth_headers,
    )
    assert r.status_code == 502


async def test_openai_speech_strips_prefix_and_uses_server_key(client, auth_headers, respx_mock):
    route = respx_mock.post(OPENAI_TTS).mock(
        return_value=httpx.Response(200, content=b"AUDIO", headers={"content-type": "audio/mpeg"})
    )
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "hello", "model": "openai/tts-1", "voice": "alloy"},
        headers=auth_headers,
    )
    assert r.status_code == 200 and r.content == b"AUDIO"
    sent = route.calls.last.request
    assert sent.headers["authorization"] == "Bearer tts-secret"
    body = json.loads(sent.content)
    assert body["model"] == "tts-1" and body["input"] == "hello" and body["voice"] == "alloy"


async def test_unsupported_tts_model_is_400(client, auth_headers):
    r = await client.post(
        "/api/ai/audio/speech", json={"input": "hi", "model": "openai/tts-1-hd"}, headers=auth_headers
    )
    assert r.status_code == 400


async def test_too_long_input_is_400(client, auth_headers):
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "x" * 4097, "model": "openai/tts-1", "voice": "alloy"},
        headers=auth_headers,
    )
    assert r.status_code == 400


@pytest.mark.parametrize("settings_overrides", [{"upstream_tts_base_url": ""}], indirect=True)
async def test_openai_tts_unconfigured_is_503(client, auth_headers):
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "hi", "model": "openai/tts-1", "voice": "alloy"},
        headers=auth_headers,
    )
    assert r.status_code == 503


@pytest.mark.parametrize(
    "settings_overrides", [{"azure_speech_key": "", "azure_speech_region": ""}], indirect=True
)
async def test_azure_tts_unconfigured_is_503(client, auth_headers):
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "hi", "model": "azure/speech", "voice": "en-US-AvaNeural"},
        headers=auth_headers,
    )
    assert r.status_code == 503


async def test_transcriptions_forward_multipart(client, auth_headers, respx_mock):
    route = respx_mock.post(WHISPER).mock(
        return_value=httpx.Response(200, json={"text": "hello", "segments": []})
    )
    r = await client.post(
        "/api/ai/audio/transcriptions",
        files={"file": ("audio.mp3", b"FAKE-AUDIO", "audio/mpeg")},
        data={"model": "whisper-1", "response_format": "verbose_json"},
        headers=auth_headers,
    )
    assert r.status_code == 200 and r.json()["text"] == "hello"
    sent = route.calls.last.request
    assert sent.headers["authorization"] == "Bearer wh-secret"
    assert sent.headers["content-type"].startswith("multipart/form-data")
    assert b"FAKE-AUDIO" in sent.content and b"whisper-1" in sent.content


async def test_transcriptions_reject_non_multipart(client, auth_headers):
    r = await client.post("/api/ai/audio/transcriptions", json={"a": 1}, headers=auth_headers)
    assert r.status_code == 400


@pytest.mark.parametrize("settings_overrides", [{"upstream_whisper_base_url": ""}], indirect=True)
async def test_transcriptions_unconfigured_is_503(client, auth_headers):
    r = await client.post(
        "/api/ai/audio/transcriptions",
        files={"file": ("a.mp3", b"x", "audio/mpeg")},
        headers=auth_headers,
    )
    assert r.status_code == 503


async def test_transcriptions_require_auth(client):
    r = await client.post(
        "/api/ai/audio/transcriptions", files={"file": ("a.mp3", b"x", "audio/mpeg")}
    )
    assert r.status_code == 401


@pytest.mark.parametrize("status", [401, 403])
async def test_openai_tts_upstream_auth_failure_is_502(client, auth_headers, respx_mock, status):
    respx_mock.post(OPENAI_TTS).mock(return_value=httpx.Response(status, text="bad key"))
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "hi", "model": "openai/tts-1", "voice": "alloy"},
        headers=auth_headers,
    )
    assert r.status_code == 502
    assert r.json()["error"] == "Upstream authentication failed"


@pytest.mark.parametrize("status", [401, 403])
async def test_whisper_upstream_auth_failure_is_502(client, auth_headers, respx_mock, status):
    respx_mock.post(WHISPER).mock(return_value=httpx.Response(status, text="bad key"))
    r = await client.post(
        "/api/ai/audio/transcriptions",
        files={"file": ("a.mp3", b"x", "audio/mpeg")},
        headers=auth_headers,
    )
    assert r.status_code == 502
    assert r.json()["error"] == "Upstream authentication failed"


async def test_whisper_upstream_other_error_passes_through(client, auth_headers, respx_mock):
    respx_mock.post(WHISPER).mock(return_value=httpx.Response(429, json={"e": 1}))
    r = await client.post(
        "/api/ai/audio/transcriptions",
        files={"file": ("a.mp3", b"x", "audio/mpeg")},
        headers=auth_headers,
    )
    assert r.status_code == 429


async def test_whisper_too_large_by_content_length_is_413(client, auth_headers, monkeypatch):
    monkeypatch.setattr("app.routers.ai_audio.MAX_AUDIO_BYTES", 100)
    r = await client.post(
        "/api/ai/audio/transcriptions",
        files={"file": ("a.mp3", b"x" * 500, "audio/mpeg")},
        headers=auth_headers,
    )
    assert r.status_code == 413
    assert r.json()["error"] == "Audio file is too large"


async def test_whisper_too_large_without_content_length_is_413(client, auth_headers, monkeypatch):
    monkeypatch.setattr("app.routers.ai_audio.MAX_AUDIO_BYTES", 100)
    body = b"--b\r\n\r\n" + b"x" * 500 + b"\r\n--b--\r\n"

    async def gen():
        yield body

    r = await client.post(
        "/api/ai/audio/transcriptions",
        content=gen(),
        headers={**auth_headers, "Content-Type": "multipart/form-data; boundary=b"},
    )
    assert r.status_code == 413


async def test_whisper_content_type_is_case_insensitive(client, auth_headers, respx_mock):
    respx_mock.post(WHISPER).mock(return_value=httpx.Response(200, json={"text": "ok"}))
    r = await client.post(
        "/api/ai/audio/transcriptions",
        content=b"--b\r\n\r\nx\r\n--b--\r\n",
        headers={**auth_headers, "Content-Type": "Multipart/Form-Data; boundary=b"},
    )
    assert r.status_code == 200


@pytest.mark.parametrize("settings_overrides", [{"tts_models": "openai/tts-1,other/x"}], indirect=True)
async def test_listed_but_unknown_provider_tts_model_is_400(client, auth_headers):
    r = await client.post(
        "/api/ai/audio/speech", json={"input": "hi", "model": "other/x"}, headers=auth_headers
    )
    assert r.status_code == 400


async def test_bare_model_name_is_normalised_and_forwarded_bare(client, auth_headers, respx_mock):
    route = respx_mock.post(OPENAI_TTS).mock(
        return_value=httpx.Response(200, content=b"AUDIO", headers={"content-type": "audio/mpeg"})
    )
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "hello", "model": "tts-1", "voice": "alloy"},
        headers=auth_headers,
    )
    assert r.status_code == 200 and r.content == b"AUDIO"
    assert json.loads(route.calls.last.request.content)["model"] == "tts-1"


async def test_prefixed_model_still_works(client, auth_headers, respx_mock):
    route = respx_mock.post(OPENAI_TTS).mock(return_value=httpx.Response(200, content=b"A"))
    r = await client.post(
        "/api/ai/audio/speech", json={"input": "hi", "model": "openai/tts-1"}, headers=auth_headers
    )
    assert r.status_code == 200
    assert json.loads(route.calls.last.request.content)["model"] == "tts-1"


async def test_bare_unknown_model_is_400(client, auth_headers):
    r = await client.post(
        "/api/ai/audio/speech", json={"input": "hi", "model": "tts-1-hd"}, headers=auth_headers
    )
    assert r.status_code == 400


async def test_bare_speech_never_maps_to_azure(client, auth_headers, respx_mock):
    route = respx_mock.post(AZURE_TTS).mock(return_value=httpx.Response(200, content=b"A"))
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "hi", "model": "speech", "voice": "en-US-AvaNeural"},
        headers=auth_headers,
    )
    assert r.status_code == 400 and not route.called


async def test_unencodable_input_is_invalid_input_not_invalid_voice(client, auth_headers):
    r = await client.post(
        "/api/ai/audio/speech",
        content=b'{"input": "bad \ud800 text", "model": "azure/speech", "voice": "en-US-AvaNeural"}',
        headers={**auth_headers, "content-type": "application/json"},
    )
    assert r.status_code == 400 and r.json() == {"error": "Invalid input"}
