import httpx
import pytest
import respx

from app.providers.llm import LlmUnavailable, complete
from tests.conftest import make_settings

URL = "https://llm.test/v1/chat/completions"


def _ok(content):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


@respx.mock
async def test_returns_stripped_content_and_clamps_tokens():
    route = respx.post(URL).mock(return_value=_ok("  Hello there.  "))
    async with httpx.AsyncClient() as http:
        out = await complete(http, make_settings(llm_max_tokens=100), [{"role": "user", "content": "hi"}],
                             model="gpt-4o", max_tokens=700, temperature=0)
    assert out == "Hello there."
    body = route.calls[0].request.read()
    assert b'"max_tokens":100' in body.replace(b" ", b"") and b'"stream":false' in body.replace(b" ", b"")
    assert route.calls[0].request.headers["authorization"] == "Bearer llm-secret"


@pytest.mark.parametrize("response,kind", [
    (httpx.Response(500), "http"),
    (httpx.Response(200, json={"choices": []}), "format"),
    (httpx.Response(200, json={"choices": [{"message": {"content": "   "}}]}), "empty"),
])
@respx.mock
async def test_failures_map_to_kinds(response, kind):
    respx.post(URL).mock(return_value=response)
    async with httpx.AsyncClient() as http:
        with pytest.raises(LlmUnavailable) as e:
            await complete(http, make_settings(), [], model="gpt-4o", max_tokens=10, temperature=0)
    assert e.value.kind == kind


@respx.mock
async def test_network_error_and_missing_config():
    respx.post(URL).mock(side_effect=httpx.ConnectError("boom"))
    async with httpx.AsyncClient() as http:
        with pytest.raises(LlmUnavailable) as e:
            await complete(http, make_settings(), [], model="gpt-4o", max_tokens=10, temperature=0)
        assert e.value.kind == "network"
        with pytest.raises(LlmUnavailable) as e:
            await complete(http, make_settings(upstream_llm_base_url=""), [], model="gpt-4o", max_tokens=10, temperature=0)
        assert e.value.kind == "config"


@respx.mock
async def test_logs_never_contain_prompt_or_reply(caplog):
    respx.post(URL).mock(return_value=httpx.Response(502))
    async with httpx.AsyncClient() as http:
        with pytest.raises(LlmUnavailable):
            await complete(http, make_settings(), [{"role": "user", "content": "SECRET-PROMPT"}], model="gpt-4o", max_tokens=10, temperature=0)
    assert "SECRET-PROMPT" not in caplog.text and "llm-secret" not in caplog.text
