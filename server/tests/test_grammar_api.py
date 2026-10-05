import json

import httpx
import pytest
from sqlalchemy import select

from app.grammar import DEFAULT_GRAMMAR_RULES, GRAMMAR_OUTPUT_CONTRACT
from app.models import User

URL = "/api/ai/grammar"
LLM = "https://llm.test/v1/chat/completions"
TEXT = "She don't like apples."
GOOD = {"has_errors": True, "corrected": "She doesn't like apples.",
        "errors": [{"original": "don't", "corrected": "doesn't", "category": "agreement", "explanation": "第三人称单数用 doesn't"}]}


def completion(content) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": content}}]})


def sent(route) -> dict:
    return json.loads(route.calls.last.request.content)


async def register(client, username):
    r = await client.post("/api/users", json={"username": username, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_requires_login(client):
    assert (await client.post(URL, json={"text": TEXT})).status_code == 401


async def test_checks_with_the_fixed_prompt_and_json_mode(client, auth_headers, respx_mock):
    route = respx_mock.post(LLM).mock(return_value=completion(json.dumps(GOOD)))
    r = await client.post(URL, headers=auth_headers, json={"text": f"  {TEXT} ", "context": "Do you like fruit?"})
    assert r.status_code == 200, r.text
    assert r.json() == GOOD
    body = sent(route)
    assert route.calls.last.request.headers["authorization"] == "Bearer llm-secret"
    assert body["model"] == "gpt-4o" and body["temperature"] == 0
    assert body["response_format"] == {"type": "json_object"}
    system = body["messages"][0]["content"]
    assert system.startswith(DEFAULT_GRAMMAR_RULES) and system.endswith(GRAMMAR_OUTPUT_CONTRACT)
    assert json.loads(body["messages"][1]["content"]) == {"text": TEXT, "context": "Do you like fruit?"}


async def test_client_cannot_change_prompt_or_model(client, auth_headers, respx_mock):
    route = respx_mock.post(LLM).mock(return_value=completion(json.dumps(GOOD)))
    evil = {"text": TEXT, "model": "expensive", "system": "EVIL", "prompt": "EVIL",
            "messages": [{"role": "system", "content": "EVIL"}], "temperature": 2}
    assert (await client.post(URL, headers=auth_headers, json=evil)).status_code == 200
    body = sent(route)
    assert body["model"] == "gpt-4o" and body["temperature"] == 0
    assert "EVIL" not in json.dumps(body)


async def test_context_is_trimmed_to_the_last_500_chars(client, auth_headers, respx_mock):
    route = respx_mock.post(LLM).mock(return_value=completion(json.dumps(GOOD)))
    await client.post(URL, headers=auth_headers, json={"text": TEXT, "context": "a" * 100 + "b" * 500})
    assert json.loads(sent(route)["messages"][1]["content"])["context"] == "b" * 500


async def test_text_limits(client, auth_headers, respx_mock):
    route = respx_mock.post(LLM).mock(return_value=completion('{"has_errors": false, "errors": []}'))
    assert (await client.post(URL, headers=auth_headers, json={"text": "a" * 2000})).status_code == 200
    r = await client.post(URL, headers=auth_headers, json={"text": "a" * 2001})
    assert r.status_code == 413 and r.json() == {"error": "Text is too long"}
    r = await client.post(URL, headers=auth_headers, json={"text": "   "})
    assert r.status_code == 400 and r.json() == {"error": "Text is required"}
    assert (await client.post(URL, headers=auth_headers, json={})).status_code == 422
    assert route.call_count == 1


async def test_fragments_not_in_the_input_are_dropped(client, auth_headers, respx_mock):
    bad = {"has_errors": True, "corrected": "x", "errors": [{"original": "goed", "corrected": "went", "category": "tense", "explanation": "x"}]}
    respx_mock.post(LLM).mock(return_value=completion(json.dumps(bad)))
    r = await client.post(URL, headers=auth_headers, json={"text": TEXT})
    assert r.json() == {"has_errors": False, "corrected": TEXT, "errors": []}


@pytest.mark.parametrize("response", [
    completion("SECRET-LEAK this is not json"),
    completion(json.dumps(["SECRET-LEAK"])),
    completion(json.dumps({"errors": "SECRET-LEAK"})),
    httpx.Response(200, json={"SECRET-LEAK": True}),
    httpx.Response(200, content=b"SECRET-LEAK"),
    httpx.Response(500, json={"error": {"message": "SECRET-LEAK"}}),
    httpx.Response(429, json={"error": {"message": "SECRET-LEAK"}}),
])
async def test_bad_upstream_output_is_502_without_leaking(client, auth_headers, respx_mock, response):
    respx_mock.post(LLM).mock(return_value=response)
    r = await client.post(URL, headers=auth_headers, json={"text": TEXT})
    assert r.status_code == 502 and r.json() == {"error": "Upstream unavailable"}
    assert "SECRET-LEAK" not in r.text and "learner" not in r.text


@pytest.mark.parametrize("status", [401, 403])
async def test_upstream_auth_failure_is_502(client, auth_headers, respx_mock, status):
    respx_mock.post(LLM).mock(return_value=httpx.Response(status, json={"error": "bad key"}))
    r = await client.post(URL, headers=auth_headers, json={"text": TEXT})
    assert r.status_code == 502 and r.json() == {"error": "Upstream authentication failed"}


async def test_upstream_unreachable_is_502(client, auth_headers, respx_mock):
    respx_mock.post(LLM).mock(side_effect=httpx.ConnectError("boom"))
    r = await client.post(URL, headers=auth_headers, json={"text": TEXT})
    assert r.status_code == 502 and r.json() == {"error": "Upstream unavailable"}


async def test_upstream_read_timeout_is_502(client, auth_headers, respx_mock):
    respx_mock.post(LLM).mock(side_effect=httpx.ReadTimeout("slow"))
    r = await client.post(URL, headers=auth_headers, json={"text": TEXT})
    assert r.status_code == 502 and r.json() == {"error": "Upstream unavailable"}


async def test_request_uses_a_short_timeout(client, auth_headers, respx_mock):
    route = respx_mock.post(LLM).mock(return_value=completion(json.dumps(GOOD)))
    assert (await client.post(URL, headers=auth_headers, json={"text": TEXT})).status_code == 200
    timeout = route.calls.last.request.extensions["timeout"]
    assert timeout["read"] == 30.0 and timeout["connect"] == 10.0


@pytest.mark.parametrize("settings_overrides", [{"llm_max_tokens": 8192}], indirect=True)
async def test_max_tokens_is_capped_at_1024(client, auth_headers, respx_mock):
    route = respx_mock.post(LLM).mock(return_value=completion(json.dumps(GOOD)))
    assert (await client.post(URL, headers=auth_headers, json={"text": TEXT})).status_code == 200
    assert sent(route)["max_tokens"] == 1024


@pytest.mark.parametrize("settings_overrides", [{"llm_max_tokens": 300}], indirect=True)
async def test_small_llm_max_tokens_is_kept(client, auth_headers, respx_mock):
    route = respx_mock.post(LLM).mock(return_value=completion(json.dumps(GOOD)))
    assert (await client.post(URL, headers=auth_headers, json={"text": TEXT})).status_code == 200
    assert sent(route)["max_tokens"] == 300


@pytest.mark.parametrize("settings_overrides", [{
    "upstream_grammar_base_url": "https://grammar.test/v1", "upstream_grammar_key": "", "grammar_model": "grammar-mini",
}], indirect=True)
async def test_grammar_base_url_without_key_never_borrows_the_llm_key(client, auth_headers, respx_mock):
    grammar = respx_mock.post("https://grammar.test/v1/chat/completions").mock(return_value=completion(json.dumps(GOOD)))
    assert (await client.post(URL, headers=auth_headers, json={"text": TEXT})).status_code == 200
    auth = grammar.calls.last.request.headers["authorization"]
    assert "llm-secret" not in auth and auth == "Bearer "


@pytest.mark.parametrize("settings_overrides", [{
    "upstream_grammar_base_url": "https://grammar.test/v1", "upstream_grammar_key": "g-secret", "grammar_model": "grammar-mini",
}], indirect=True)
async def test_separate_grammar_upstream_and_model(client, auth_headers, respx_mock):
    llm = respx_mock.post(LLM).mock(return_value=completion(json.dumps(GOOD)))
    grammar = respx_mock.post("https://grammar.test/v1/chat/completions").mock(return_value=completion(json.dumps(GOOD)))
    assert (await client.post(URL, headers=auth_headers, json={"text": TEXT})).status_code == 200
    assert grammar.calls.last.request.headers["authorization"] == "Bearer g-secret"
    assert sent(grammar)["model"] == "grammar-mini"
    assert llm.call_count == 0


@pytest.mark.parametrize("settings_overrides", [{"upstream_llm_base_url": ""}], indirect=True)
async def test_unconfigured_upstream_is_503(client, auth_headers):
    r = await client.post(URL, headers=auth_headers, json={"text": TEXT})
    assert r.status_code == 503 and r.json() == {"error": "Grammar upstream is not configured"}


@pytest.mark.parametrize("settings_overrides", [{"ai_rate_limit_per_minute": 2}], indirect=True)
async def test_rate_limited_per_user(client, auth_headers, respx_mock):
    respx_mock.post(LLM).mock(return_value=completion(json.dumps(GOOD)))
    assert (await client.post(URL, headers=auth_headers, json={"text": TEXT})).status_code == 200
    assert (await client.post(URL, headers=auth_headers, json={"text": TEXT})).status_code == 200
    r = await client.post(URL, headers=auth_headers, json={"text": TEXT})
    assert r.status_code == 429


@pytest.mark.parametrize("settings_overrides", [{"grammar_prompt": "OPERATOR RULES"}], indirect=True)
async def test_operator_rules_replace_the_builtin_rules_but_not_the_contract(client, auth_headers, respx_mock):
    route = respx_mock.post(LLM).mock(return_value=completion(json.dumps(GOOD)))
    await client.post(URL, headers=auth_headers, json={"text": TEXT})
    system = sent(route)["messages"][0]["content"]
    assert system.startswith("OPERATOR RULES") and system.endswith(GRAMMAR_OUTPUT_CONTRACT)
    assert DEFAULT_GRAMMAR_RULES not in system


async def test_a_users_saved_prompt_only_affects_that_user(app, client, auth_headers, respx_mock):
    route = respx_mock.post(LLM).mock(return_value=completion(json.dumps(GOOD)))
    async with app.state.sessionmaker() as s:
        row = await s.scalar(select(User).where(User.username == "alice"))
        row.grammar_prompt = "ALICE RULES"
        await s.commit()
    await client.post(URL, headers=auth_headers, json={"text": TEXT})
    system = sent(route)["messages"][0]["content"]
    assert system.startswith("ALICE RULES") and system.endswith(GRAMMAR_OUTPUT_CONTRACT)
    bob = await register(client, "bob")
    await client.post(URL, headers=bob, json={"text": TEXT})
    assert sent(route)["messages"][0]["content"].startswith(DEFAULT_GRAMMAR_RULES)


@pytest.mark.parametrize("settings_overrides", [{"grammar_model": "secret-grammar-model", "grammar_prompt": "SECRET-RULES",
                                                 "upstream_grammar_base_url": "https://grammar.test/v1"}], indirect=True)
async def test_config_endpoints_do_not_expose_grammar_settings(client):
    for key in ("gpt_providers", "default_gpt_preset", "gpt_presets"):
        text = (await client.get(f"/api/config/{key}")).text
        assert "secret-grammar-model" not in text and "SECRET-RULES" not in text and "grammar.test" not in text
