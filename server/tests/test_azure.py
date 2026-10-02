import httpx
import pytest

from app.azure import TOKEN_TTL, AzureError, AzureNotConfigured, AzureSpeech, build_ssml

STS = "https://eastus.api.cognitive.microsoft.com/sts/v1.0/issueToken"
TTS = "https://eastus.tts.speech.microsoft.com/cognitiveservices/v1"


def test_ssml_has_language_and_voice():
    ssml = build_ssml("Hello", "en-US-AvaNeural")
    assert "xml:lang='en-US'" in ssml
    assert "name='en-US-AvaNeural'" in ssml
    assert ">Hello</voice>" in ssml


def test_ssml_escapes_text():
    assert "a &lt; b &amp; c" in build_ssml("a < b & c", "en-US-AvaNeural")


def test_ssml_supports_regional_voice_names():
    assert "xml:lang='zh-CN'" in build_ssml("你好", "zh-CN-liaoning-XiaobeiNeural")


@pytest.mark.parametrize("voice", ["", "x", "en-US-Ava'Neural", "en-US-Ava Neural", "en-US-<b>"])
def test_ssml_rejects_bad_voice(voice):
    with pytest.raises(ValueError):
        build_ssml("hi", voice)


async def test_token_is_cached_until_ttl(respx_mock):
    now = [0.0]
    route = respx_mock.post(STS).mock(
        side_effect=[httpx.Response(200, text="t1"), httpx.Response(200, text="t2")]
    )
    async with httpx.AsyncClient() as http:
        az = AzureSpeech(http, "k", "eastus", clock=lambda: now[0])
        assert await az.get_token() == "t1"
        assert await az.get_token() == "t1"
        assert route.call_count == 1
        now[0] = TOKEN_TTL + 1
        assert await az.get_token() == "t2"
        assert route.call_count == 2
    assert route.calls[0].request.headers["ocp-apim-subscription-key"] == "k"


async def test_not_configured_raises():
    async with httpx.AsyncClient() as http:
        az = AzureSpeech(http, "", "")
        assert az.configured is False
        with pytest.raises(AzureNotConfigured):
            await az.get_token()
        with pytest.raises(AzureNotConfigured):
            await az.synthesize("hi", "en-US-AvaNeural")


async def test_sts_failure_raises_azure_error(respx_mock):
    respx_mock.post(STS).mock(return_value=httpx.Response(401, text="denied"))
    async with httpx.AsyncClient() as http:
        with pytest.raises(AzureError):
            await AzureSpeech(http, "k", "eastus").get_token()


async def test_synthesize_posts_ssml(respx_mock):
    route = respx_mock.post(TTS).mock(return_value=httpx.Response(200, content=b"MP3"))
    async with httpx.AsyncClient() as http:
        audio = await AzureSpeech(http, "k", "eastus").synthesize("Hello", "en-US-AvaNeural")
    assert audio == b"MP3"
    req = route.calls.last.request
    assert req.headers["content-type"] == "application/ssml+xml"
    assert req.headers["x-microsoft-outputformat"] == "audio-24khz-48kbitrate-mono-mp3"
    assert b"name='en-US-AvaNeural'" in req.content
