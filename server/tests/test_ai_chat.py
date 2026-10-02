import json

import httpx
import pytest

URL = "https://llm.test/v1/chat/completions"
BODY = {"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]}


async def test_requires_auth(client):
    assert (await client.post("/api/ai/chat/completions", json=BODY)).status_code == 401


async def test_forwards_with_server_key(client, auth_headers, respx_mock):
    route = respx_mock.post(URL).mock(return_value=httpx.Response(200, json={"id": "x", "choices": []}))
    r = await client.post("/api/ai/chat/completions", json=BODY, headers=auth_headers)
    assert r.status_code == 200 and r.json()["id"] == "x"
    sent = route.calls.last.request
    assert sent.headers["authorization"] == "Bearer llm-secret"
    assert json.loads(sent.content)["model"] == "gpt-4o"


async def test_unlisted_model_is_rewritten_to_default(client, auth_headers, respx_mock):
    route = respx_mock.post(URL).mock(return_value=httpx.Response(200, json={}))
    await client.post(
        "/api/ai/chat/completions", json={**BODY, "model": "expensive-model"}, headers=auth_headers
    )
    assert json.loads(route.calls.last.request.content)["model"] == "gpt-4o"


async def test_extra_fields_are_preserved(client, auth_headers, respx_mock):
    route = respx_mock.post(URL).mock(return_value=httpx.Response(200, json={}))
    extra = {"response_format": {"type": "json_object"}, "tools": [{"type": "function"}], "temperature": 0.2}
    await client.post("/api/ai/chat/completions", json={**BODY, **extra}, headers=auth_headers)
    sent = json.loads(route.calls.last.request.content)
    for key, value in extra.items():
        assert sent[key] == value


async def test_upstream_error_status_and_body_are_passed_through(client, auth_headers, respx_mock):
    respx_mock.post(URL).mock(return_value=httpx.Response(429, json={"error": {"message": "slow down"}}))
    r = await client.post("/api/ai/chat/completions", json=BODY, headers=auth_headers)
    assert r.status_code == 429
    assert r.json()["error"]["message"] == "slow down"


async def test_streaming_is_passed_through(client, auth_headers, respx_mock):
    sse = b'data: {"choices":[{"delta":{"content":"he"}}]}\n\ndata: {"choices":[{"delta":{"content":"llo"}}]}\n\ndata: [DONE]\n\n'
    respx_mock.post(URL).mock(
        return_value=httpx.Response(200, content=sse, headers={"content-type": "text/event-stream"})
    )
    r = await client.post(
        "/api/ai/chat/completions", json={**BODY, "stream": True}, headers=auth_headers
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    assert r.content == sse


async def test_upstream_unreachable_is_502(client, auth_headers, respx_mock):
    respx_mock.post(URL).mock(side_effect=httpx.ConnectError("boom"))
    r = await client.post("/api/ai/chat/completions", json=BODY, headers=auth_headers)
    assert r.status_code == 502
    assert r.json()["error"] == "Upstream unavailable"


@pytest.mark.parametrize("settings_overrides", [{"upstream_llm_base_url": ""}], indirect=True)
async def test_unconfigured_upstream_is_503(client, auth_headers):
    r = await client.post("/api/ai/chat/completions", json=BODY, headers=auth_headers)
    assert r.status_code == 503
    assert r.json()["error"] == "LLM upstream is not configured"


async def test_invalid_json_body_is_400(client, auth_headers):
    r = await client.post(
        "/api/ai/chat/completions",
        content=b"not json",
        headers={**auth_headers, "content-type": "application/json"},
    )
    assert r.status_code == 400
    assert r.json()["error"] == "Invalid JSON body"


async def test_non_dict_json_body_is_400(client, auth_headers):
    r = await client.post(
        "/api/ai/chat/completions", json=["not", "a", "dict"], headers=auth_headers
    )
    assert r.status_code == 400
    assert r.json()["error"] == "Invalid JSON body"


async def test_streaming_upstream_connect_error_is_502(client, auth_headers, respx_mock):
    respx_mock.post(URL).mock(side_effect=httpx.ConnectError("boom"))
    r = await client.post(
        "/api/ai/chat/completions", json={**BODY, "stream": True}, headers=auth_headers
    )
    assert r.status_code == 502
    assert r.json()["error"] == "Upstream unavailable"


async def test_streaming_upstream_4xx_preserves_status_and_body(client, auth_headers, respx_mock):
    error_body = b'data: {"error": {"message": "rate limited"}}\n\n'
    respx_mock.post(URL).mock(
        return_value=httpx.Response(429, content=error_body, headers={"content-type": "text/event-stream"})
    )
    r = await client.post(
        "/api/ai/chat/completions", json={**BODY, "stream": True}, headers=auth_headers
    )
    assert r.status_code == 429
    assert r.content == error_body


@pytest.mark.parametrize("status", [401, 403])
async def test_upstream_auth_failure_is_502(client, auth_headers, respx_mock, status):
    respx_mock.post("https://llm.test/v1/chat/completions").mock(
        return_value=httpx.Response(status, text="bad key")
    )
    r = await client.post("/api/ai/chat/completions", json=BODY, headers=auth_headers)
    assert r.status_code == 502
    assert r.json()["error"] == "Upstream authentication failed"


@pytest.mark.parametrize("status", [401, 403])
async def test_streaming_upstream_auth_failure_is_502(client, auth_headers, respx_mock, status):
    respx_mock.post("https://llm.test/v1/chat/completions").mock(
        return_value=httpx.Response(status, text="bad key")
    )
    r = await client.post(
        "/api/ai/chat/completions", json={**BODY, "stream": True}, headers=auth_headers
    )
    assert r.status_code == 502
    assert r.json()["error"] == "Upstream authentication failed"


import json as _json


async def _sent_body(client, auth_headers, respx_mock, body):
    route = respx_mock.post(URL).mock(return_value=httpx.Response(200, json={}))
    r = await client.post("/api/ai/chat/completions", json=body, headers=auth_headers)
    assert r.status_code == 200
    return _json.loads(route.calls.last.request.content)


async def test_n_and_token_limits_are_clamped(client, auth_headers, respx_mock):
    sent = await _sent_body(
        client, auth_headers, respx_mock,
        {"model": "gpt-4o", "n": 100, "max_tokens": 999999, "max_completion_tokens": 999999},
    )
    assert sent["n"] == 4 and sent["max_tokens"] == 4096 and sent["max_completion_tokens"] == 4096


async def test_small_limits_untouched_and_absent_stay_absent(client, auth_headers, respx_mock):
    sent = await _sent_body(client, auth_headers, respx_mock, {"model": "gpt-4o", "n": 2, "max_tokens": 10})
    assert sent["n"] == 2 and sent["max_tokens"] == 10 and "max_completion_tokens" not in sent
    sent = await _sent_body(client, auth_headers, respx_mock, {"model": "gpt-4o"})
    assert not {"n", "max_tokens", "max_completion_tokens"} & set(sent)


async def test_non_numeric_limit_is_400(client, auth_headers):
    r = await client.post(
        "/api/ai/chat/completions", json={"model": "gpt-4o", "max_tokens": "9999999"}, headers=auth_headers
    )
    assert r.status_code == 400
