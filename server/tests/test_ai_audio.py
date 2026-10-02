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
