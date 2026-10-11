"""原生函数调用探测(spec §6.2,计划 R-C7):一次非流式小调用,模型以 JSON 参数调用 lookup_word 才算通过。"""
import logging

import httpx

from app.core import metering
from app.providers import llm
from tests.agents_helpers import FakeLLM
from tests.conftest import make_settings


async def probe(fake: FakeLLM, settings=None) -> llm.ToolProbe:
    async with fake.client() as http:
        return await llm.probe_tools(http, settings or make_settings(), model="m")


async def test_ok_when_the_model_calls_the_tool_with_json_arguments():
    fake = FakeLLM(tool_call={"name": "lookup_word", "arguments": '{"word": "apple"}'})
    result = await probe(fake)
    assert (result.ok, result.code, result.status) == (True, "ok", 200)
    body = fake.requests[0]
    assert body["stream"] is False and body["tools"][0]["function"]["name"] == "lookup_word"
    assert body["tool_choice"] == "auto" and body["max_tokens"] == 64


async def test_plain_text_reply_is_no_tool_call():
    assert (await probe(FakeLLM(["I cannot use tools."]))).code == "no_tool_call"


async def test_bad_arguments_and_wrong_tool():
    assert (await probe(FakeLLM(tool_call={"name": "lookup_word", "arguments": "{oops"}))).code == "bad_arguments"
    assert (await probe(FakeLLM(tool_call={"name": "lookup_word", "arguments": '{"word": 3}'}))).code == "bad_arguments"
    assert (await probe(FakeLLM(tool_call={"name": "other", "arguments": '{"word": "a"}'}))).code == "no_tool_call"


async def test_http_network_and_config_failures(caplog):
    caplog.set_level(logging.DEBUG)
    result = await probe(FakeLLM(status=402))
    assert (result.ok, result.code, result.status) == (False, "http", 402)
    assert "upstream-secret-body" not in caplog.text

    async def boom(request):
        raise httpx.ConnectError("down")
    async with httpx.AsyncClient(transport=httpx.MockTransport(boom)) as http:
        assert (await llm.probe_tools(http, make_settings(), model="m")).code == "network"
    assert (await probe(FakeLLM(), make_settings(upstream_llm_base_url=""))).code == "config"


async def test_probe_is_metered_as_kind_probe():
    metering.METER.drain()
    await probe(FakeLLM(tool_call={"name": "lookup_word", "arguments": '{"word": "apple"}'}))
    kinds = [r.kind for r in metering.METER.drain()]
    assert kinds == ["probe"]
