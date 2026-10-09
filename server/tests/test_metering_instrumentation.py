"""Record points (admin v2 §8.1): every upstream call is metered, numbers only."""
import httpx
import pytest

from app.core import metering
from app.core.metering import METER
from app.providers import llm


@pytest.fixture(autouse=True)
def clean_meter():
    METER.drain()
    yield
    METER.drain()


def _only_row():
    rows = METER.drain()
    assert len(rows) == 1, rows
    assert "hello" not in repr(rows[0])
    return rows[0]


async def test_tts_passthrough_counts_characters(app, client, auth_headers, respx_mock):
    respx_mock.post("https://tts.test/v1/audio/speech").respond(200, content=b"mp3")
    r = await client.post("/api/ai/audio/speech", headers=auth_headers,
                          json={"model": "tts-1", "input": "hello world", "voice": "alloy"})
    assert r.status_code == 200
    row = _only_row()
    assert (row.feature, row.kind, row.provider, row.model, row.status) == ("audio", "tts", "tts.test", "tts-1", 200)
    assert (row.units_in, row.unit) == (len("hello world"), "chars")


async def test_streaming_chat_counts_relayed_bytes(app, client, auth_headers, respx_mock):
    sse = b'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n'
    respx_mock.post("https://llm.test/v1/chat/completions").respond(
        200, content=sse, headers={"content-type": "text/event-stream"})
    r = await client.post("/api/ai/chat/completions", headers=auth_headers,
                          json={"model": "gpt-4o", "stream": True, "messages": [{"role": "user", "content": "hello"}]})
    assert r.status_code == 200 and r.content == sse
    row = METER.drain()
    assert len(row) == 1
    row = row[0]
    assert (row.feature, row.kind, row.unit, row.units_out, row.status) == ("chat", "llm", "bytes", len(sse), 200)
    assert row.user_id is not None


async def test_upstream_auth_failure_is_still_recorded(app, client, auth_headers, respx_mock):
    respx_mock.post("https://llm.test/v1/chat/completions").respond(401, json={"error": "bad key"})
    r = await client.post("/api/ai/chat/completions", headers=auth_headers,
                          json={"model": "gpt-4o", "messages": [{"role": "user", "content": "hello"}]})
    assert r.status_code == 502
    row = _only_row()
    assert (row.kind, row.status) == ("llm", 401)


async def test_network_failure_is_recorded_as_status_0(app, client, auth_headers, respx_mock):
    respx_mock.post("https://llm.test/v1/chat/completions").mock(side_effect=httpx.ConnectError("boom"))
    r = await client.post("/api/ai/chat/completions", headers=auth_headers,
                          json={"model": "gpt-4o", "messages": [{"role": "user", "content": "hello"}]})
    assert r.status_code == 502
    assert _only_row().status == 0


async def test_server_side_completion_uses_the_feature_scope(app, respx_mock):
    respx_mock.post("https://llm.test/v1/chat/completions").respond(
        200, json={"choices": [{"message": {"content": "hi"}}], "usage": {"prompt_tokens": 4, "completion_tokens": 2}})
    with metering.feature_scope("rooms"):
        out = await llm.complete(app.state.http, app.state.settings, [{"role": "user", "content": "hello"}],
                                 model="gpt-4o", max_tokens=50, temperature=0.2)
    assert out == "hi"
    row = _only_row()
    assert (row.feature, row.kind, row.provider, row.model, row.units_in, row.units_out, row.unit) == \
           ("rooms", "llm", "llm.test", "gpt-4o", 4, 2, "tokens")


async def test_completion_without_usage_counts_bytes_and_errors_count(app, respx_mock):
    route = respx_mock.post("https://llm.test/v1/chat/completions")
    route.respond(200, json={"choices": [{"message": {"content": "hi"}}]})
    await llm.complete(app.state.http, app.state.settings, [{"role": "user", "content": "hello"}],
                       model="gpt-4o", max_tokens=50, temperature=0.2)
    row = _only_row()
    assert row.unit == "bytes" and row.units_out > 0
    route.respond(429, json={"error": "slow down"})
    with pytest.raises(llm.LlmUnavailable):
        await llm.complete(app.state.http, app.state.settings, [{"role": "user", "content": "hello"}],
                           model="gpt-4o", max_tokens=50, temperature=0.2)
    assert _only_row().status == 429
