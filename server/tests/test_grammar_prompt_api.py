import json

import httpx
import pytest

from app.grammar import DEFAULT_GRAMMAR_RULES, GRAMMAR_OUTPUT_CONTRACT

URL = "/api/me/grammar-prompt"
LLM = "https://llm.test/v1/chat/completions"
GOOD = {"has_errors": False, "corrected": "x", "errors": []}


async def register(client, username):
    r = await client.post("/api/users", json={"username": username, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.mark.parametrize("method", ["GET", "PUT", "DELETE"])
async def test_requires_login(client, method):
    r = await client.request(method, URL, json={"prompt": "x"})
    assert r.status_code == 401 and r.json() == {"error": "Unauthorized"}


async def test_default_state(client, auth_headers):
    r = await client.get(URL, headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == {"prompt": None, "default_prompt": DEFAULT_GRAMMAR_RULES, "max_length": 2000}


@pytest.mark.parametrize("settings_overrides", [{"grammar_prompt": "OPERATOR RULES"}], indirect=True)
async def test_default_prompt_reflects_the_operator_rules(client, auth_headers):
    assert (await client.get(URL, headers=auth_headers)).json()["default_prompt"] == "OPERATOR RULES"


async def test_save_cleans_and_persists(client, auth_headers):
    r = await client.put(URL, headers=auth_headers, json={"prompt": "  Be strict\x00 about\x07 articles.\r\nExplain in Chinese.  "})
    assert r.status_code == 200
    assert r.json()["prompt"] == "Be strict about articles.\nExplain in Chinese."
    assert (await client.get(URL, headers=auth_headers)).json()["prompt"] == "Be strict about articles.\nExplain in Chinese."


@pytest.mark.parametrize("blank", ["", "   ", "\x00\n"])
async def test_saving_blank_restores_the_default(client, auth_headers, blank):
    await client.put(URL, headers=auth_headers, json={"prompt": "custom"})
    r = await client.put(URL, headers=auth_headers, json={"prompt": blank})
    assert r.status_code == 200 and r.json()["prompt"] is None


async def test_length_limit_and_no_echo(client, auth_headers):
    assert (await client.put(URL, headers=auth_headers, json={"prompt": "a" * 2000})).status_code == 200
    secret = "SECRET-PROMPT-" + "b" * 2000
    r = await client.put(URL, headers=auth_headers, json={"prompt": secret})
    assert r.status_code == 422
    assert r.json() == {"error": "prompt: String should have at most 2000 characters"}
    assert "SECRET-PROMPT" not in r.text
    assert (await client.get(URL, headers=auth_headers)).json()["prompt"] == "a" * 2000
    assert (await client.put(URL, headers=auth_headers, json={})).status_code == 422


async def test_delete_restores_the_default(client, auth_headers):
    await client.put(URL, headers=auth_headers, json={"prompt": "custom"})
    r = await client.delete(URL, headers=auth_headers)
    assert r.status_code == 200 and r.json()["prompt"] is None
    assert (await client.delete(URL, headers=auth_headers)).json()["prompt"] is None  # 幂等


async def test_isolation(client, auth_headers):
    await client.put(URL, headers=auth_headers, json={"prompt": "alice only"})
    bob = await register(client, "bob")
    assert (await client.get(URL, headers=bob)).json()["prompt"] is None
    await client.delete(URL, headers=bob)
    assert (await client.get(URL, headers=auth_headers)).json()["prompt"] == "alice only"


async def test_grammar_check_uses_the_saved_prompt_until_reset(client, auth_headers, respx_mock):
    route = respx_mock.post(LLM).mock(return_value=httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(GOOD)}}]}))
    await client.put(URL, headers=auth_headers, json={"prompt": "MY RULES"})
    await client.post("/api/ai/grammar", headers=auth_headers, json={"text": "She don't like it."})
    system = json.loads(route.calls.last.request.content)["messages"][0]["content"]
    assert system.startswith("MY RULES") and system.endswith(GRAMMAR_OUTPUT_CONTRACT)
    await client.delete(URL, headers=auth_headers)
    await client.post("/api/ai/grammar", headers=auth_headers, json={"text": "She don't like it."})
    assert json.loads(route.calls.last.request.content)["messages"][0]["content"].startswith(DEFAULT_GRAMMAR_RULES)


async def test_saving_text_identical_to_the_default_stores_null(client, auth_headers):
    await client.put(URL, headers=auth_headers, json={"prompt": "custom"})
    r = await client.put(URL, headers=auth_headers, json={"prompt": "  " + DEFAULT_GRAMMAR_RULES + "\r\n"})
    assert r.status_code == 200 and r.json()["prompt"] is None
    assert (await client.get(URL, headers=auth_headers)).json()["prompt"] is None
