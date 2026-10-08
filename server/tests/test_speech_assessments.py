import io
import wave
from pathlib import Path

import pytest

from app.routers import speech as speech_module
from app.services.provider_clients import get_xfyun
from app.providers.xfyun import XfyunError, XfyunNotConfigured

FIXTURES = Path(__file__).parent / "fixtures"
GOOD_XML = (FIXTURES / "ise_good.xml").read_text(encoding="utf-8")
REFERENCE = "Hello, nice to meet you. I would like a cup of coffee, please."
URL = "/api/speech/assessments"
BAD_WAV = "Audio must be a 16 kHz mono 16-bit WAV"


def make_wav(rate=16000, channels=1, width=2, seconds=0.5) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes(b"\x00" * int(rate * seconds) * channels * width)
    return buf.getvalue()


class FakeXfyun:
    def __init__(self):
        self.calls = []
        self.configured = True
        self.error = None
        self.xml = GOOD_XML

    async def evaluate(self, pcm, text, ent, timeout=60.0):
        self.calls.append({"pcm": pcm, "text": text, "ent": ent, "timeout": timeout})
        if self.error:
            raise self.error
        return self.xml


@pytest.fixture
def fake(app):
    f = FakeXfyun()
    app.dependency_overrides[get_xfyun] = lambda: f
    return f


def post(client, headers, wav=None, reference=REFERENCE, language="en-US"):
    data = {"reference": reference, "language": language}
    files = {"file": ("audio.wav", make_wav() if wav is None else wav, "audio/wav")}
    return client.post(URL, headers=headers, data=data, files=files)


async def test_requires_login(client, fake):
    r = await client.post(URL, files={"file": ("a.wav", make_wav(), "audio/wav")}, data={"reference": "x"})
    assert r.status_code == 401
    assert fake.calls == []


async def test_success(client, auth_headers, fake):
    wav = make_wav()
    r = await post(client, auth_headers, wav=wav)
    assert r.status_code == 200, r.text
    assert r.json()["pronunciation_score"] == pytest.approx(98.87, abs=0.01)
    call = fake.calls[0]
    with wave.open(io.BytesIO(wav), "rb") as w:
        expected = w.readframes(w.getnframes())
    assert expected and call["pcm"] == expected
    assert call["ent"] == "en_vip"
    assert call["text"] == REFERENCE


@pytest.mark.parametrize("language", ["zh-CN", "zh", "fr-FR", "", "english"])
async def test_non_english_languages_rejected(client, auth_headers, fake, language):
    r = await post(client, auth_headers, language=language)
    assert r.status_code == 400
    assert r.json() == {"error": "Unsupported language"}
    assert fake.calls == []


@pytest.mark.parametrize("language", ["en", "en-US", "en_GB", "EN-us"])
async def test_english_variants(client, auth_headers, fake, language):
    r = await post(client, auth_headers, language=language)
    assert r.status_code == 200
    assert fake.calls[0]["ent"] == "en_vip"


async def test_unsupported_language(client, auth_headers, fake):
    r = await post(client, auth_headers, language="fr-FR")
    assert r.status_code == 400
    assert r.json() == {"error": "Unsupported language"}
    assert fake.calls == []


@pytest.mark.parametrize("reference", ["", "   \n\t "])
async def test_reference_required(client, auth_headers, fake, reference):
    r = await post(client, auth_headers, reference=reference)
    assert r.status_code == 400
    assert r.json() == {"error": "Reference text is required"}
    assert fake.calls == []


@pytest.mark.parametrize(
    "wav",
    [
        b"not a wav at all",
        make_wav(rate=44100),
        make_wav(channels=2),
        make_wav(width=1),
    ],
    ids=["garbage", "44.1k", "stereo", "8bit"],
)
async def test_invalid_wav(client, auth_headers, fake, wav):
    r = await post(client, auth_headers, wav=wav)
    assert r.status_code == 400
    assert r.json() == {"error": BAD_WAV}
    assert fake.calls == []


async def test_audio_too_long(client, auth_headers, fake, monkeypatch):
    monkeypatch.setattr(speech_module, "MAX_ASSESSMENT_SECONDS", 0.25)
    r = await post(client, auth_headers)
    assert r.status_code == 400
    assert r.json() == {"error": "Audio is too long"}
    assert fake.calls == []


async def test_file_too_large(client, auth_headers, fake, monkeypatch):
    monkeypatch.setattr(speech_module, "MAX_ASSESSMENT_BYTES", 1000)
    r = await post(client, auth_headers)
    assert r.status_code == 413
    assert r.json() == {"error": "Audio file is too large"}
    assert fake.calls == []


@pytest.mark.parametrize(
    "error,status,message",
    [
        (XfyunError("bad param secret-text", code=10163), 400, "Invalid assessment parameters"),
        (XfyunError("x", code=48195), 400, "Invalid assessment parameters"),
        (XfyunError("x", code=11200), 503, "Speech evaluation is not authorized"),
        (XfyunError("x", code=60114), 400, "Audio is too long"),
        (XfyunError("x", code=10114), 400, "Audio is too long"),
        (XfyunError("leaky provider text", code=None), 502, "Upstream unavailable"),
        (XfyunError("x", code=99999), 502, "Upstream unavailable"),
        (XfyunNotConfigured(), 503, "Pronunciation assessment is not configured"),
    ],
)
async def test_error_mapping(client, auth_headers, fake, error, status, message):
    fake.error = error
    r = await post(client, auth_headers)
    assert r.status_code == status
    assert r.json() == {"error": message}


async def test_unparsable_result_is_502(client, auth_headers, fake):
    fake.xml = "<not xml"
    r = await post(client, auth_headers)
    assert r.status_code == 502
    assert r.json() == {"error": "Upstream unavailable"}


async def test_non_multipart(client, auth_headers, fake):
    r = await client.post(URL, headers=auth_headers, json={"reference": "x"})
    assert r.status_code == 400
    assert fake.calls == []


async def test_missing_file_field(client, auth_headers, fake):
    r = await client.post(URL, headers=auth_headers, data={"reference": "x", "language": "en-US"})
    assert r.status_code == 400
    assert fake.calls == []


@pytest.mark.parametrize("settings_overrides", [{"ai_rate_limit_per_minute": 2}], indirect=True)
async def test_rate_limited(client, auth_headers, fake):
    statuses = [(await post(client, auth_headers)).status_code for _ in range(3)]
    assert statuses == [200, 200, 429]


async def test_reference_length_cap(client, auth_headers, fake):
    ok = await post(client, auth_headers, reference="a" * 2000)
    assert ok.status_code == 200
    assert len(fake.calls) == 1
    r = await post(client, auth_headers, reference="a" * 2001)
    assert r.status_code == 400
    assert r.json() == {"error": "Reference text is too long"}
    r = await post(client, auth_headers, reference="  " + "a" * 2001 + "  ")
    assert r.status_code == 400
    assert len(fake.calls) == 1


async def test_malformed_multipart(client, auth_headers, fake):
    headers = {**auth_headers, "Content-Type": "multipart/form-data; boundary=xyz"}
    r = await client.post(URL, headers=headers, content=b"garbage without boundaries")
    assert r.status_code == 400
    assert fake.calls == []


async def test_streaming_body_too_large(client, auth_headers, fake, monkeypatch):
    monkeypatch.setattr(speech_module, "MAX_ASSESSMENT_BYTES", 1000)

    async def body():
        for _ in range(5):
            yield b"x" * 500

    headers = {**auth_headers, "Content-Type": "multipart/form-data; boundary=xyz"}
    r = await client.post(URL, headers=headers, content=body())
    assert "content-length" not in r.request.headers
    assert r.status_code == 413
    assert r.json() == {"error": "Audio file is too large"}
    assert fake.calls == []


async def test_not_configured_before_body(client, auth_headers, fake):
    fake.configured = False
    r = await post(client, auth_headers)
    assert r.status_code == 503
    assert r.json() == {"error": "Pronunciation assessment is not configured"}
    assert fake.calls == []


async def test_timeout_scales_with_duration(client, auth_headers, fake):
    await post(client, auth_headers, wav=make_wav(seconds=10))
    assert fake.calls[0]["timeout"] == pytest.approx(40.0, abs=0.01)


async def test_timeout_is_capped(client, auth_headers, fake):
    await post(client, auth_headers, wav=make_wav(seconds=300))
    assert fake.calls[0]["timeout"] == pytest.approx(330.0, abs=0.01)


async def test_reference_is_stripped_before_upstream(client, auth_headers, fake):
    padded = "  " + chr(10) + REFERENCE + " " + chr(9) + " "
    r = await post(client, auth_headers, reference=padded)
    assert r.status_code == 200
    assert fake.calls[0]["text"] == REFERENCE
