import json

import httpx
import pytest

from app.core.config import send_thinking_param
from app.realtime_providers import openai_llm_stream
from app.stt import chat_body
from tests.conftest import make_settings

SSE = b'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'
DEEPSEEK = "deepseek.com"
ARK = "volces.com"


async def llm_body(respx_mock, base_url, **overrides):
    route = respx_mock.post(base_url.rstrip("/") + "/chat/completions").mock(
        return_value=httpx.Response(200, content=SSE))
    settings = make_settings(upstream_llm_base_url=base_url, **overrides)
    async with httpx.AsyncClient() as http:
        async for _ in openai_llm_stream(http, settings, "gpt-4o", 0.7)([]):
            pass
    return json.loads(route.calls.last.request.content)


async def test_default_openai_gets_no_thinking(respx_mock):
    assert "thinking" not in await llm_body(respx_mock, "https://api.openai.com/v1")


@pytest.mark.parametrize("base", ["https://api.deepseek.com", "https://api.deepseek.com/v1",
                                  "https://ark.cn-beijing.volces.com/api/v3", "https://API.DeepSeek.com:443/v1"])
async def test_default_known_hosts_get_thinking(respx_mock, base):
    assert (await llm_body(respx_mock, base))["thinking"] == {"type": "disabled"}


async def test_true_forces_and_false_suppresses(respx_mock):
    assert "thinking" in await llm_body(respx_mock, "https://api.openai.com/v1", realtime_llm_disable_thinking="true")
    assert "thinking" not in await llm_body(respx_mock, "https://api.deepseek.com", realtime_llm_disable_thinking="false")
    assert "thinking" in await llm_body(respx_mock, "https://api.openai.com/v1", realtime_llm_disable_thinking=True)
    assert "thinking" not in await llm_body(respx_mock, "https://api.deepseek.com", realtime_llm_disable_thinking=False)


@pytest.mark.parametrize("raw,expected", [
    ("AUTO", "auto"), (" True ", "true"), ("FALSE", "false"), ("1", "true"), ("0", "false"),
    ("yes", "true"), ("No", "false"), ("garbage", "auto"), ("", "auto"),
])
def test_setting_parses_robustly(raw, expected):
    assert make_settings(realtime_llm_disable_thinking=raw).realtime_llm_disable_thinking == expected
    assert make_settings(stt_disable_thinking=raw).stt_disable_thinking == expected


def test_defaults_are_auto():
    s = make_settings()
    assert s.realtime_llm_disable_thinking == "auto" and s.stt_disable_thinking == "auto"


@pytest.mark.parametrize("url", [
    "https://api.deepseek.com.evil.example/v1", "https://evildeepseek.com/v1", "https://deepseek.com.cn/v1",
    "https://api.openai.com/deepseek.com", "https://evil.example/?h=api.deepseek.com",
    "https://user@evil.example/volces.com", "https://notvolces.com/v1", "https://volces.com.evil.example",
    "", "not a url", "https://api.deepseek.com@evil.example/",
])
def test_lookalike_hosts_do_not_match(url):
    assert send_thinking_param("auto", url, (DEEPSEEK, ARK)) is False


@pytest.mark.parametrize("url", ["https://deepseek.com/v1", "https://api.deepseek.com", "https://x.y.volces.com/api/v3",
                                 "https://volces.com"])
def test_dot_boundary_hosts_match(url):
    assert send_thinking_param("auto", url, (DEEPSEEK, ARK)) is True


def test_stt_chat_body_follows_same_rule():
    ark = dict(upstream_whisper_base_url="https://ark.cn-beijing.volces.com/api/v3", upstream_whisper_model="m")
    assert chat_body(make_settings(**ark), b"x", "wav", None)["thinking"] == {"type": "disabled"}
    other = dict(upstream_whisper_base_url="https://whisper.test/v1", upstream_whisper_model="m")
    assert "thinking" not in chat_body(make_settings(**other), b"x", "wav", None)
    assert "thinking" in chat_body(make_settings(stt_disable_thinking="true", **other), b"x", "wav", None)
    assert "thinking" not in chat_body(make_settings(stt_disable_thinking="false", **ark), b"x", "wav", None)
