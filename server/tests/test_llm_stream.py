"""providers.llm.complete_stream(spec 2026-10-12-agents §3.3、§6):SSE 解析、推理文字、用量、计量、错误类型、
关闭 / 取消时立即关闭上游响应、从不记录文本。全部用假上游。"""
import asyncio
import json
import logging

import httpx
import pytest

from app.core import metering
from app.providers import llm
from tests.agents_helpers import FakeLLM, Recording, sse_body
from tests.conftest import make_settings

MESSAGES = [{"role": "system", "content": "SECRET-PROMPT"}, {"role": "user", "content": "hi"}]


async def collect(fake: FakeLLM, settings=None, **kw) -> list[llm.Delta]:
    settings = settings or make_settings()
    async with fake.client() as http:
        return [d async for d in llm.complete_stream(http, settings, MESSAGES, model="m", max_tokens=300,
                                                     temperature=0.7, **kw)]


async def test_yields_reasoning_text_and_usage_in_arrival_order():
    fake = FakeLLM(["Hel", "lo"], reasoning=["think"], usage=(12, 5))
    out = await collect(fake)
    assert [(d.kind, d.text, d.usage) for d in out] == [
        ("reasoning", "think", None), ("text", "Hel", None), ("text", "lo", None), ("usage", "", (12, 5))]
    body = fake.requests[0]
    assert body["stream"] is True and body["stream_options"] == {"include_usage": True}
    assert body["messages"] == MESSAGES and body["model"] == "m" and body["temperature"] == 0.7


async def test_max_tokens_is_clamped_by_llm_max_tokens():
    fake = FakeLLM()
    await collect(fake, make_settings(llm_max_tokens=100))
    assert fake.requests[0]["max_tokens"] == 100


async def test_thinking_disabled_is_sent_to_known_hosts_unless_deep_think():
    deepseek = make_settings(upstream_llm_base_url="https://api.deepseek.com/v1")
    fake = FakeLLM()
    await collect(fake, deepseek)
    assert fake.requests[0]["thinking"] == {"type": "disabled"}
    fake = FakeLLM()
    await collect(fake, deepseek, thinking=True)
    assert "thinking" not in fake.requests[0]
    fake = FakeLLM()
    await collect(fake)  # llm.test: unknown host, auto mode -> no param
    assert "thinking" not in fake.requests[0]


async def test_http_error_raises_before_any_delta_without_logging_the_body(caplog):
    caplog.set_level(logging.DEBUG)
    with pytest.raises(llm.LlmUnavailable) as err:
        await collect(FakeLLM(status=402))
    assert (err.value.kind, err.value.status) == ("http", 402)
    assert "upstream-secret-body" not in caplog.text and "SECRET-PROMPT" not in caplog.text
    assert "status=402" in caplog.text


async def test_missing_upstream_is_a_config_error():
    with pytest.raises(llm.LlmUnavailable) as err:
        await collect(FakeLLM(), make_settings(upstream_llm_base_url=""))
    assert err.value.kind == "config"


class Broken(httpx.AsyncByteStream):
    async def __aiter__(self):
        yield sse_body(["Hel"], usage=None)[0]
        raise httpx.ReadError("boom")

    async def aclose(self):
        pass


async def test_network_error_mid_stream_raises_network_after_the_first_delta():
    async def handler(request):
        return httpx.Response(200, stream=Broken())
    got = []
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(llm.LlmUnavailable) as err:
            async for d in llm.complete_stream(http, make_settings(), MESSAGES, model="m", max_tokens=10,
                                               temperature=0):
                got.append(d.text)
    assert got == ["Hel"] and err.value.kind == "network"


async def test_stream_without_text_raises_empty():
    with pytest.raises(llm.LlmUnavailable) as err:
        await collect(FakeLLM(parts=[b"data: [DONE]\n\n"]))
    assert err.value.kind == "empty"


async def test_ignores_comments_unknown_events_and_bad_json():
    parts = [b": keep-alive\n\n", b"event: ping\n\n", b"data: {not json}\n\n", *sse_body(["ok"], usage=None)]
    out = await collect(FakeLLM(parts=parts))
    assert [(d.kind, d.text) for d in out] == [("text", "ok")]


async def test_closing_the_iterator_closes_the_upstream_response():
    fake = FakeLLM(["first", "never"], gate=asyncio.Event())
    async with fake.client() as http:
        stream = llm.complete_stream(http, make_settings(), MESSAGES, model="m", max_tokens=10, temperature=0)
        first = await stream.__anext__()
        assert first.text == "first" and not fake.streams[0].closed
        await stream.aclose()
    assert fake.streams[0].closed


async def test_cancelling_the_consumer_closes_the_upstream_response():
    fake = FakeLLM(["first", "never"], gate=asyncio.Event())
    seen = asyncio.Event()

    async def consume(http):
        async for _ in llm.complete_stream(http, make_settings(), MESSAGES, model="m", max_tokens=10, temperature=0):
            seen.set()

    async with fake.client() as http:
        task = asyncio.create_task(consume(http))
        await asyncio.wait_for(seen.wait(), 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert fake.streams[0].closed


async def test_metering_records_tokens_and_never_text():
    metering.METER.drain()
    await collect(FakeLLM(["SECRET-REPLY"], usage=(12, 5)))
    records = [r for r in metering.METER.drain() if r.kind == "llm"]
    assert len(records) == 1
    rec = records[0]
    assert (rec.status, rec.units_in, rec.units_out, rec.unit, rec.model) == (200, 12, 5, "tokens", "m")
    assert "SECRET" not in json.dumps([str(v) for v in rec.__dict__.values()])


async def test_metering_without_usage_counts_bytes_and_failures_count_status_zero():
    metering.METER.drain()
    await collect(FakeLLM(["abc"], usage=None))

    async def handler(request):
        return httpx.Response(200, stream=Broken())
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(llm.LlmUnavailable):
            async for _ in llm.complete_stream(http, make_settings(), MESSAGES, model="m", max_tokens=10,
                                               temperature=0):
                pass
    first, second = [r for r in metering.METER.drain() if r.kind == "llm"]
    assert first.unit == "bytes" and first.units_out > 0 and first.status == 200
    assert second.status == 0


async def test_reply_text_is_never_logged(caplog):
    caplog.set_level(logging.DEBUG)
    await collect(FakeLLM(["SECRET-REPLY"]))
    assert "SECRET" not in caplog.text


async def test_complete_keeps_working_and_reports_http_status():
    fake = FakeLLM(status=402)
    async with fake.client() as http:
        with pytest.raises(llm.LlmUnavailable) as err:
            await llm.complete(http, make_settings(), MESSAGES, model="m", max_tokens=10, temperature=0)
    assert (err.value.kind, err.value.status) == ("http", 402)
    fake = FakeLLM(["fine"])
    async with fake.client() as http:
        assert await llm.complete(http, make_settings(), MESSAGES, model="m", max_tokens=10, temperature=0) == "fine"
    assert fake.requests[0]["stream"] is False and "stream_options" not in fake.requests[0]
