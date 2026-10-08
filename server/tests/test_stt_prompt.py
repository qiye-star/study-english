import io
import json
import wave

import httpx
import pytest

from app.speech.stt import CHAT_PROMPT, NO_SPEECH_TOKEN, pcm_to_wav, transcribe_wav
from tests.conftest import make_settings

ARK = "https://ark.test/api/v3/chat/completions"
WHISPER = "https://whisper.test/v1/audio/transcriptions"
CHAT = {
    "upstream_whisper_mode": "chat",
    "upstream_whisper_base_url": "https://ark.test/api/v3",
    "stt_disable_thinking": "true",
    "upstream_whisper_key": "ark-secret",
    "upstream_whisper_model": "doubao-seed-2-0-lite-260428",
}
WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 20


def ok(content):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


async def post(client, headers, **form):
    return await client.post("/api/ai/audio/transcriptions", files={"file": ("a.wav", WAV, "audio/wav")},
                             data=form, headers=headers)


def test_prompt_keeps_verbatim_and_adds_foreground_rules():
    assert "verbatim" in CHAT_PROMPT
    assert "nearest, clearest speaker" in CHAT_PROMPT
    assert NO_SPEECH_TOKEN == "<none>" and NO_SPEECH_TOKEN in CHAT_PROMPT


@pytest.mark.parametrize("settings_overrides", [CHAT], indirect=True)
async def test_body_has_speed_parameters(client, auth_headers, respx_mock):
    route = respx_mock.post(ARK).mock(return_value=ok("hi"))
    assert (await post(client, auth_headers)).status_code == 200
    body = json.loads(route.calls.last.request.content)
    assert body["max_tokens"] == 512
    assert body["thinking"] == {"type": "disabled"}


@pytest.mark.parametrize("settings_overrides", [{**CHAT, "stt_disable_thinking": "false", "stt_max_tokens": 64}], indirect=True)
async def test_speed_parameters_follow_settings(client, auth_headers, respx_mock):
    route = respx_mock.post(ARK).mock(return_value=ok("hi"))
    await post(client, auth_headers)
    body = json.loads(route.calls.last.request.content)
    assert body["max_tokens"] == 64 and "thinking" not in body


@pytest.mark.parametrize("settings_overrides", [CHAT], indirect=True)
@pytest.mark.parametrize("content", ["<none>", " <NONE>\n", "<None>"])
async def test_no_speech_token_is_an_empty_transcript(client, auth_headers, respx_mock, content):
    respx_mock.post(ARK).mock(return_value=ok(content))
    r = await post(client, auth_headers)
    assert r.status_code == 200
    assert r.json() == {"text": "", "segments": []}


@pytest.mark.parametrize("settings_overrides", [CHAT], indirect=True)
async def test_language_hint_still_appended(client, auth_headers, respx_mock):
    route = respx_mock.post(ARK).mock(return_value=ok("hi"))
    await post(client, auth_headers, language="en-US")
    text = json.loads(route.calls.last.request.content)["messages"][0]["content"][1]["text"]
    assert text.endswith("The audio language is en.")


def test_pcm_to_wav_is_16k_mono_16bit():
    data = pcm_to_wav(b"\x01\x00" * 1600)
    with wave.open(io.BytesIO(data)) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()) == (1, 2, 16000, 1600)


async def test_transcribe_wav_dispatches_by_mode(respx_mock):
    async with httpx.AsyncClient() as http:
        respx_mock.post(ARK).mock(return_value=ok("chat text"))
        assert await transcribe_wav(http, make_settings(**CHAT), pcm_to_wav(b"\x00\x00" * 160)) == "chat text"
        route = respx_mock.post(WHISPER).mock(return_value=httpx.Response(200, json={"text": " whisper text "}))
        assert await transcribe_wav(http, make_settings(), pcm_to_wav(b"\x00\x00" * 160), "en") == "whisper text"
        assert b'name="language"' in route.calls.last.request.content
