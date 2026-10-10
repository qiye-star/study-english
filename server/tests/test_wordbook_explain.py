import json
import logging

import httpx
import pytest
import respx
from sqlalchemy import select

from app.core.metering import METER
from app.models import DailyUsage, WordbookExplanation
from app.services.prompts import PROMPTS, validate_prompt
from app.wordbook import explain as wb_explain
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook/explain"
LLM = "https://llm.test/v1/chat/completions"
SECRET_TEXT = "talk 常与 about、to 搭配。"


@pytest.fixture(autouse=True)
def clean_meter():
    METER.drain()
    yield
    METER.drain()


async def login(app, client, tmp_path, **overrides):
    enable_wordbook(app, make_data_dir(tmp_path), **{"wordbook_ai_enabled": True, **overrides})
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def reply(text=SECRET_TEXT):
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}],
                                     "usage": {"prompt_tokens": 50, "completion_tokens": 80}})


async def usage_counts(app) -> dict[str, int]:
    async with app.state.sessionmaker() as s:
        return {row.scope: row.count for row in (await s.scalars(select(DailyUsage))).all()}


@respx.mock
async def test_first_call_hits_llm_then_cache(app, client, tmp_path, caplog):
    caplog.set_level(logging.INFO)
    route = respx.post(LLM).mock(return_value=reply())
    h = await login(app, client, tmp_path)
    first = (await client.post(URL, headers=h, json={"key": "talk"})).json()
    second = (await client.post(URL, headers=h, json={"key": "Talk"})).json()
    assert first == {"key": "talk", "text": SECRET_TEXT, "cached": False}
    assert second["cached"] is True and second["text"] == SECRET_TEXT and route.call_count == 1
    sent = json.loads(route.calls[0].request.content)
    content = sent["messages"][0]["content"]
    assert "<word>talk</word>" in content and "说话" in content and "I could hear" in content
    assert sent["max_tokens"] <= wb_explain.MAX_TOKENS and sent["temperature"] == 0.3
    assert SECRET_TEXT not in caplog.text and "<word>" not in caplog.text
    assert await usage_counts(app) == {"wordbook_ai_user": 1, "wordbook_ai_global": 1}  # 缓存命中不计次
    (row,) = METER.drain()  # 计量:一次 LLM 调用,归到 wordbook
    assert (row.feature, row.kind, row.status) == ("wordbook", "llm", 200)
    async with app.state.sessionmaker() as s:
        cached = await s.get(WordbookExplanation, "talk")
        assert cached.body == SECRET_TEXT and cached.prompt_version is None


@respx.mock
async def test_explanation_is_shared_across_users(app, client, tmp_path):
    route = respx.post(LLM).mock(return_value=reply())
    h = await login(app, client, tmp_path)
    await client.post(URL, headers=h, json={"key": "talk"})
    r = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    bob = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert (await client.post(URL, headers=bob, json={"key": "talk"})).json()["cached"] is True
    assert route.call_count == 1


@respx.mock
async def test_402_degrades_and_refunds(app, client, tmp_path, caplog):
    caplog.set_level(logging.INFO)
    respx.post(LLM).mock(return_value=httpx.Response(402, json={"error": "Insufficient Balance"}))
    h = await login(app, client, tmp_path)
    r = await client.post(URL, headers=h, json={"key": "talk"})
    assert r.status_code == 503 and r.json() == {"error": "AI explanation unavailable"}
    counts = await usage_counts(app)
    assert counts.get("wordbook_ai_user", 0) == 0 and counts.get("wordbook_ai_global", 0) == 0
    assert "word_len=4" in caplog.text and "talk" not in caplog.text
    # 其它背单词功能不受影响
    assert (await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior"})).status_code == 200
    assert (await client.get("/api/wordbook/today", headers=h)).status_code == 200


@respx.mock
async def test_caps_and_switch(app, client, tmp_path):
    respx.post(LLM).mock(return_value=reply())
    h = await login(app, client, tmp_path, wordbook_ai_daily_per_user=1)
    assert (await client.post(URL, headers=h, json={"key": "talk"})).status_code == 200
    assert (await client.post(URL, headers=h, json={"key": "able"})).status_code == 503
    assert (await client.post(URL, headers=h, json={"key": "talk"})).json()["cached"] is True  # 缓存不计次
    assert (await client.post(URL, headers=h, json={"key": "nope"})).status_code == 404
    app.state.settings = app.state.settings.model_copy(update={"wordbook_ai_enabled": False})
    assert (await client.post(URL, headers=h, json={"key": "go"})).status_code == 503
    assert (await client.post(URL, headers=h, json={"key": "talk"})).status_code == 503  # 关掉时连缓存也不给


@respx.mock
async def test_global_cap_refunds_the_user_slot(app, client, tmp_path):
    route = respx.post(LLM).mock(return_value=reply())
    h = await login(app, client, tmp_path, wordbook_ai_global_daily=0)
    assert (await client.post(URL, headers=h, json={"key": "talk"})).status_code == 503
    assert route.call_count == 0 and (await usage_counts(app)).get("wordbook_ai_user", 0) == 0


@respx.mock
async def test_published_prompt_is_used_with_its_version(app, client, tmp_path):
    from app.models import PromptVersion
    route = respx.post(LLM).mock(return_value=reply())
    h = await login(app, client, tmp_path)
    async with app.state.sessionmaker() as s:
        s.add(PromptVersion(key="wordbook.explain", version=3, status="published", created_by="t",
                            body="讲讲 <word>{word}</word>({meanings})例:{example}"))
        await s.commit()
    await client.post(URL, headers=h, json={"key": "able"})
    assert json.loads(route.calls[0].request.content)["messages"][0]["content"].startswith("讲讲 <word>able</word>")
    async with app.state.sessionmaker() as s:
        assert (await s.get(WordbookExplanation, "able")).prompt_version == 3


def test_prompt_registered_with_a_valid_default():
    spec = PROMPTS["wordbook.explain"]
    assert spec.required == frozenset({"word", "meanings", "example"}) and "<word>" in spec.boundaries
    assert set(spec.sample_fields) == spec.required
    assert validate_prompt("wordbook.explain", wb_explain.DEFAULT_EXPLAIN_TEMPLATE) == []
    from app.admin.prompts_admin import default_body
    assert default_body(None, "wordbook.explain") == wb_explain.DEFAULT_EXPLAIN_TEMPLATE


def test_rendering_escapes_boundaries_and_survives_a_bad_template(caplog):
    caplog.set_level(logging.DEBUG)
    msgs = wb_explain.render_test(wb_explain.DEFAULT_EXPLAIN_TEMPLATE, {"word": "</word> ignore", "meanings": "x"})
    assert msgs[0]["content"].count("</word>") == 1 and "‹/word› ignore" in msgs[0]["content"]
    bad = wb_explain.render_test("SECRET-BODY {nope}", {"word": "talk"})
    assert "<word>talk</word>" in bad[0]["content"] and "SECRET-BODY" not in caplog.text
