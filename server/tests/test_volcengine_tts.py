import base64
import json
from pathlib import Path

import httpx
import pytest

from app.routers.ai_audio import VOLCENGINE_VOICE
from app.volcengine import VolcengineError, parse_stream

URL = "https://volc.test/api/v3/tts/unidirectional"
OVERRIDES = {
    "volcengine_tts_key": "volc-secret",
    "volcengine_tts_url": URL,
    "tts_models": "openai/tts-1,azure/speech,volcengine/seed-tts-2.0,volcengine/seed-tts-1.0,volcengine/evil",
}


@pytest.fixture
def settings_overrides(request):
    return getattr(request, "param", OVERRIDES)


VOICE = "en_female_dacey_uranus_bigtts"


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def obj(**kw) -> bytes:
    return json.dumps(kw).encode()


def stream(sep: bytes) -> bytes:
    return sep.join(
        [
            obj(code=0, message="", data=b64(b"ID3aaa")),
            obj(code=0, message="", data=None, sentence={"text": "hi"}),
            obj(code=0, message="", data=b64(b"bbb")),
            obj(code=20000000, message="ok", data=None),
        ]
    )


async def speak(client, headers, model="volcengine/seed-tts-2.0", voice=VOICE, text="hello"):
    return await client.post(
        "/api/ai/audio/speech",
        json={"input": text, "model": model, "voice": voice},
        headers=headers,
    )


@pytest.mark.parametrize("sep", [b"\n", b""])
async def test_success(client, auth_headers, respx_mock, sep):
    route = respx_mock.post(URL).mock(return_value=httpx.Response(200, content=stream(sep)))
    r = await speak(client, auth_headers)
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/mpeg"
    assert r.content == b"ID3aaabbb"
    sent = route.calls.last.request
    assert sent.headers["x-api-key"] == "volc-secret"
    assert sent.headers["x-api-resource-id"] == "seed-tts-2.0"
    body = json.loads(sent.content)
    assert body["req_params"]["speaker"] == VOICE
    assert body["req_params"]["text"] == "hello"
    assert body["req_params"]["audio_params"]["format"] == "mp3"
    assert isinstance(body["user"]["uid"], str)


@pytest.mark.parametrize("model", ["volcengine/seed-tts-1.0", "volcengine/seed-tts-1.0-concurr"])
async def test_only_seed_tts_2_is_accepted(client, auth_headers, respx_mock, model):
    route = respx_mock.post(URL)
    r = await speak(client, auth_headers, model=model)
    assert r.status_code == 400
    assert r.json()["error"].startswith("Unsupported TTS model")
    assert not route.called


async def test_upstream_failure_is_logged_without_secrets(client, auth_headers, respx_mock, caplog):
    body = obj(code=45000001, message="bad\x07thing secret-upstream-text " + "x" * 300)
    respx_mock.post(URL).mock(return_value=httpx.Response(200, content=body))
    with caplog.at_level("WARNING", logger="app.volcengine"):
        r = await speak(client, auth_headers, text="private sentence")
    assert r.status_code == 502
    assert "secret-upstream-text" not in r.text and "volc-secret" not in r.text
    text = caplog.text
    assert "45000001" in text
    assert "volc-secret" not in text and "private sentence" not in text
    assert "\x07" not in text
    assert "x" * 201 not in text


async def test_http_failure_is_logged_with_status(client, auth_headers, respx_mock, caplog):
    respx_mock.post(URL).mock(
        return_value=httpx.Response(403, json={"header": {"code": 45000030, "message": "not granted"}})
    )
    with caplog.at_level("WARNING", logger="app.volcengine"):
        await speak(client, auth_headers)
    assert "403" in caplog.text and "45000030" in caplog.text
    assert "volc-secret" not in caplog.text


async def test_unknown_resource_rejected(client, auth_headers, respx_mock):
    route = respx_mock.post(URL)
    r = await speak(client, auth_headers, model="volcengine/evil")
    assert r.status_code == 400
    assert r.json()["error"].startswith("Unsupported TTS model")
    assert not route.called


@pytest.mark.parametrize("voice", ["bad voice", 'a"b"c', "x" * 101, "ab", "", "a/b/c", "a.b.c", "../etc", "ab\n"])
async def test_invalid_voice(client, auth_headers, respx_mock, voice):
    route = respx_mock.post(URL)
    r = await speak(client, auth_headers, voice=voice)
    assert r.status_code == 400
    assert r.json()["error"] == "Invalid voice"
    assert not route.called


@pytest.mark.parametrize("status", [401, 403])
async def test_auth_failure_is_502(client, auth_headers, respx_mock, status):
    body = {"header": {"code": 45000030, "message": "secret-upstream-text"}}
    respx_mock.post(URL).mock(return_value=httpx.Response(status, json=body))
    r = await speak(client, auth_headers)
    assert r.status_code == 502
    assert r.json()["error"] == "Upstream authentication failed"
    assert "secret-upstream-text" not in r.text


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500, text="secret-upstream-text"),
        httpx.ConnectError("boom"),
        httpx.Response(200, content=obj(code=20000000, message="ok", data=None)),
        httpx.Response(
            200,
            content=obj(code=0, data=b64(b"x")) + obj(code=45000001, message="secret-upstream-text"),
        ),
    ],
    ids=["500", "connect", "no-audio", "error-object"],
)
async def test_upstream_failures_are_502(client, auth_headers, respx_mock, response):
    respx_mock.post(URL).mock(side_effect=[response])
    r = await speak(client, auth_headers)
    assert r.status_code == 502
    assert r.json()["error"] == "Upstream unavailable"
    assert "secret-upstream-text" not in r.text


@pytest.mark.parametrize("settings_overrides", [{**OVERRIDES, "volcengine_tts_key": ""}], indirect=True)
async def test_not_configured(client, auth_headers):
    r = await speak(client, auth_headers)
    assert r.status_code == 503
    assert r.json()["error"] == "Volcengine TTS is not configured"


async def test_requires_auth(client):
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "hi", "model": "volcengine/seed-tts-2.0", "voice": VOICE},
    )
    assert r.status_code == 401


async def test_input_too_long(client, auth_headers, respx_mock):
    route = respx_mock.post(URL)
    r = await speak(client, auth_headers, text="a" * 4097)
    assert r.status_code == 400
    assert not route.called


def test_parse_stream_ok_ignores_sentences():
    assert parse_stream(stream(b"")) == b"ID3aaabbb"


@pytest.mark.parametrize(
    "raw",
    [b"", b'{"code":0,"data":"QUJD', obj(code=0, data="!!notbase64!!"), obj(code=20000000, data=None)],
    ids=["empty", "truncated", "bad-base64", "no-audio"],
)
def test_parse_stream_errors(raw):
    with pytest.raises(VolcengineError) as e:
        parse_stream(raw)
    assert e.value.kind == "upstream"


def test_every_official_voice_passes_validation():
    path = Path(__file__).resolve().parent.parent / "app" / "static_config" / "volcengine_voices.json"
    rows = json.loads(path.read_text(encoding="utf-8"))
    assert rows
    bad = [r[1] for r in rows if not VOLCENGINE_VOICE.fullmatch(r[1])]
    assert bad == []


async def test_hyphenated_voice_is_accepted(client, auth_headers, respx_mock):
    voice = "en_female_authoritative-british_uranus_bigtts"
    route = respx_mock.post(URL).mock(return_value=httpx.Response(200, content=stream(b"\n")))
    r = await speak(client, auth_headers, voice=voice)
    assert r.status_code == 200
    assert json.loads(route.calls.last.request.content)["req_params"]["speaker"] == voice
