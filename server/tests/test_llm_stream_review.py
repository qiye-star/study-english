"""评审 #6:complete_stream 的总期限与带内错误对象。"""
import json
import logging
import time

import pytest

from app.agents import trace
from app.agents.orchestrator import run_turn
from app.core import metering
from app.providers import llm
from tests.agents_helpers import FakeLLM, sse_body
from tests.test_agents_orchestrator import UID, setup
from tests.agents_helpers import make_deps, make_request
from tests.test_llm_stream import MESSAGES, collect


def _data(obj) -> bytes:
    return f"data: {json.dumps(obj)}\n\n".encode()


async def test_total_deadline_stops_a_slow_trickle_even_when_chunks_keep_arriving():
    parts = sse_body([f"w{i} " for i in range(40)], usage=None)
    fake = FakeLLM(parts=parts, delay=0.05)  # each gap is far below any read timeout
    start = time.monotonic()
    got = []
    with pytest.raises(llm.LlmUnavailable) as err:
        async with fake.client() as http:
            async for d in llm.complete_stream(http, __import__("tests.conftest", fromlist=["x"]).make_settings(), MESSAGES,
                                               model="m", max_tokens=10, temperature=0, total_timeout=0.3):
                got.append(d)
    assert err.value.kind == "timeout" and got  # partial text, then a failure
    assert time.monotonic() - start < 1.5
    assert fake.streams[0].closed


async def test_total_deadline_also_covers_a_silent_upstream():
    fake = FakeLLM(["x"], first_delay=5)
    from tests.conftest import make_settings
    start = time.monotonic()
    with pytest.raises(llm.LlmUnavailable) as err:
        async with fake.client() as http:
            async for _ in llm.complete_stream(http, make_settings(), MESSAGES, model="m", max_tokens=10,
                                               temperature=0, total_timeout=0.2):
                pass
    assert err.value.kind == "timeout" and time.monotonic() - start < 2


async def test_default_total_deadline_constant():
    assert 60 <= llm.STREAM_TOTAL_SECONDS <= 180


async def test_in_band_error_object_is_a_failure_without_leaking_its_body(caplog):
    caplog.set_level(logging.DEBUG)
    metering.METER.drain()
    parts = [_data({"choices": [{"index": 0, "delta": {"content": "Hel"}}]}),
             _data({"error": {"message": "upstream-secret-body", "code": 500}}), b"data: [DONE]\n\n"]
    with pytest.raises(llm.LlmUnavailable) as err:
        await collect(FakeLLM(parts=parts))
    assert err.value.kind == "upstream" and "upstream-secret-body" not in str(err.value) + caplog.text
    rec = [r for r in metering.METER.drain() if r.kind == "llm"][0]
    assert rec.status == 0  # not metered as a 200 success


async def test_in_band_error_before_any_text_is_upstream_not_empty():
    parts = [_data({"error": {"message": "overloaded"}}), b"data: [DONE]\n\n"]
    with pytest.raises(llm.LlmUnavailable) as err:
        await collect(FakeLLM(parts=parts))
    assert err.value.kind == "upstream"


async def test_a_truncated_turn_is_an_error_event_and_not_ok(app):
    parts = [_data({"choices": [{"index": 0, "delta": {"content": "Hel"}}]}),
             _data({"error": {"message": "boom"}})]
    await setup(app, FakeLLM(parts=parts))
    deps, _ = make_deps(app)
    events = [e async for e in run_turn(deps, make_request(UID))]
    assert events[-1] == trace.Error("llm_unavailable") and not any(isinstance(e, trace.Done) for e in events)
