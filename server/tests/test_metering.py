import io
import wave
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.core import metering
from app.core.metering import METER, Meter, flush, provider_of, record, rollup_and_prune
from app.models import UpstreamCall, UsageDaily

NOW = datetime(2026, 10, 9, 9, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def clean_meter():
    METER.drain()
    yield
    METER.drain()


def test_provider_names():
    assert provider_of("https://api.deepseek.com/v1") == "deepseek"
    assert provider_of("https://ark.cn-beijing.volces.com/api/v3") == "ark"
    assert provider_of("wss://openspeech.bytedance.com/api/v3/sauc") == "volcengine"
    assert provider_of("https://api.openai.com/v1") == "openai"
    assert provider_of("https://eastus.tts.speech.microsoft.com/x") == "azure"
    assert provider_of("wss://ise-api.xfyun.cn/v2/open-ise") == "xfyun"
    assert provider_of("https://llm.test/v1") == "llm.test"
    assert len(provider_of("https://" + "a" * 60 + ".example/v1")) == 32


def test_feature_prefixes():
    assert metering.feature_for("/api/ai/chat/completions") == "chat"
    assert metering.feature_for("/api/ai/audio/speech") == "audio"
    assert metering.feature_for("/api/rooms/ws") == "rooms"
    assert metering.feature_for("/api/roomsx") == "other"
    assert metering.feature_for("/") == "other"


def test_meter_drops_oldest_when_full_and_record_uses_context():
    m = Meter(capacity=2)
    metering.bind_user(42)
    try:
        with metering.feature_scope("rank"):
            for i in range(3):
                record("llm", "deepseek", f"m{i}", 200, 10, units_in=5, units_out=7, unit="tokens", meter=m)
    finally:
        metering.bind_user(None)
    rows = m.drain()
    assert [r.model for r in rows] == ["m1", "m2"] and m.dropped == 1
    assert (rows[0].feature, rows[0].user_id, rows[0].unit) == ("rank", 42, "tokens")


def test_requeue_keeps_order_and_capacity():
    m = Meter(capacity=3)
    old = [metering.CallRecord(NOW, None, "x", "llm", "p", f"o{i}", 200, 1, 0, 0, "calls") for i in range(2)]
    record("llm", "p", "new", 200, 1, meter=m)
    m.requeue(old)
    assert [r.model for r in m.drain()] == ["o0", "o1", "new"]
    m2 = Meter(capacity=2)
    record("llm", "p", "new", 200, 1, meter=m2)
    m2.requeue(old)
    assert [r.model for r in m2.drain()] == ["o1", "new"] and m2.dropped == 1


async def test_middleware_tags_features_per_request(app, client, auth_headers, respx_mock):
    respx_mock.post("https://llm.test/v1/chat/completions").respond(
        200, json={"choices": [{"message": {"content": "hi"}}], "usage": {"prompt_tokens": 11, "completion_tokens": 3}})
    r = await client.post("/api/ai/chat/completions", headers=auth_headers,
                          json={"model": "gpt-4o", "messages": [{"role": "user", "content": "hello"}]})
    assert r.status_code == 200
    rows = METER.drain()
    assert len(rows) == 1
    row = rows[0]
    assert (row.feature, row.kind, row.provider, row.model, row.units_in, row.units_out, row.unit) == \
           ("chat", "llm", "llm.test", "gpt-4o", 11, 3, "tokens")
    assert row.user_id is not None
    assert metering.current_user_id() is None  # the request's binding does not leak out of it


async def test_flush_and_rollup(app):
    old = NOW - timedelta(days=100)
    for at, status in ((old, 200), (old, 429), (NOW, 200)):
        METER.record(metering.CallRecord(at, 7, "chat", "llm", "deepseek", "v4", status, 100, 10, 5, "tokens"))
    assert await flush(app.state.sessionmaker) == 3
    async with app.state.sessionmaker() as s:
        assert await rollup_and_prune(s, NOW, 90) == (1, 2)
        await s.commit()
        daily = (await s.scalars(select(UsageDaily))).all()
        assert [(d.day, d.calls, d.errors, d.units_in, d.user_id) for d in daily] == [(old.date().isoformat(), 2, 1, 20, 7)]
        assert await s.scalar(select(func.count()).select_from(UpstreamCall)) == 1
    # a second batch for the same bucket accumulates into the same usage_daily row
    METER.record(metering.CallRecord(old, 7, "chat", "llm", "deepseek", "v4", 200, 100, 1, 1, "tokens"))
    await flush(app.state.sessionmaker)
    async with app.state.sessionmaker() as s:
        assert await rollup_and_prune(s, NOW, 90) == (1, 1)
        await s.commit()
        assert [(d.calls, d.units_in) for d in (await s.scalars(select(UsageDaily))).all()] == [(3, 21)]


async def test_flush_failure_requeues():
    def broken():
        raise RuntimeError("db down")

    record("llm", "p", "m", 200, 1)
    assert await flush(broken) == 0
    assert METER.depth == 1


def test_record_never_raises_or_logs_text(caplog):
    record("llm", "x" * 500, "y" * 500, 200, -5)  # odd input is clamped, not raised
    record("llm", "p", "m", "not-a-number", 1)  # swallowed
    rows = METER.drain()
    assert len(rows) == 1
    row = rows[0]
    assert len(row.provider) <= 32 and len(row.model) <= 64 and row.ms == 0
    assert caplog.records == []


def _wav(ms: int, rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\0\0" * (rate * ms // 1000))
    return buf.getvalue()


def test_audio_units_from_wav_header_or_bytes():
    assert metering.audio_units(_wav(1500)) == (1500, "audio_ms")
    multipart = b"--b\r\nContent-Disposition: form-data; name=\"file\"\r\n\r\n" + _wav(250) + b"\r\n--b--\r\n"
    assert metering.audio_units(multipart) == (250, "audio_ms")
    assert metering.audio_units(b"ID3\x00mp3data") == (11, "bytes")
    assert metering.audio_units(b"RIFF\x00\x00") == (6, "bytes")
