"""每句译文与单句分析的接口(spec D8 / E11 / E12 / §9):开关、白名单语言、批量与额度、存进句子行、改字清空、
已发布的提示词;大模型用 respx 假上游(真实的 `providers/llm.complete` 路径,含计量)。"""
import json
import logging

import httpx
import pytest
import respx
from sqlalchemy import select

from app.core.metering import METER
from app.library import ai
from app.models import DailyUsage, PromptVersion
from tests.library_helpers import SRT, enable, fake_media, library_settings, process, upload, use_fakes

LLM = "https://llm.test/v1/chat/completions"
ZH = "1. 你好,我的朋友。\n2. 你今天好吗?"


@pytest.fixture
def settings_overrides(request, tmp_path):
    return library_settings(tmp_path, **{"library_ai_enabled": True, **getattr(request, "param", {})})


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)
    METER.drain()
    yield
    METER.drain()


def reply(text: str = ZH) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}],
                                     "usage": {"prompt_tokens": 40, "completion_tokens": 30}})


async def ready_item(app, client, headers) -> str:
    use_fakes(app)
    item_id = await upload(client, headers, fake_media(), subs=SRT)
    await process(app)
    return item_id


async def counts(app) -> dict[str, int]:
    async with app.state.sessionmaker() as s:  # only the AI counters (an upload also counts as an import)
        return {f"{r.scope}:{r.subject}": r.count for r in (await s.scalars(select(DailyUsage))).all()
                if r.scope in ("library_translate", "library_analysis", "library_ai")}


async def detail(client, headers, item_id) -> list[dict]:
    return (await client.get(f"/api/library/items/{item_id}", headers=headers)).json()["segments"]


def translate_url(item_id: str) -> str:
    return f"/api/library/items/{item_id}/translate"


def analysis_url(item_id: str, idx: int = 0) -> str:
    return f"/api/library/items/{item_id}/segments/{idx}/analysis"


@pytest.mark.parametrize("settings_overrides", [{"library_ai_enabled": False}, {"upstream_llm_base_url": ""}],
                         indirect=True, ids=["switch-off", "no-llm"])
async def test_switch_off_or_no_llm_means_404_and_config_says_so(app, client, auth_headers, settings_overrides):
    item_id = await ready_item(app, client, auth_headers)
    assert (await client.get("/api/library/config", headers=auth_headers)).json()["ai"] is False
    for url, body in ((translate_url(item_id), {"indices": [0], "native_language": "zh-CN"}),
                      (analysis_url(item_id), {"native_language": "zh-CN"})):
        r = await client.post(url, headers=auth_headers, json=body)
        assert (r.status_code, r.json()) == (404, {"error": "AI is disabled"})


async def test_everything_needs_a_login(client):
    item = "0f0e0d0c-0b0a-4908-8706-050403020100"
    assert (await client.post(translate_url(item), json={})).status_code == 401
    assert (await client.post(analysis_url(item), json={})).status_code == 401


@pytest.mark.parametrize("settings_overrides", [{"library_enabled": False}], indirect=True)
async def test_the_library_switch_closes_both_endpoints_first(client, auth_headers, settings_overrides):
    item = "0f0e0d0c-0b0a-4908-8706-050403020100"
    for url, body in ((translate_url(item), {"indices": [0], "native_language": "zh-CN"}),
                      (analysis_url(item), {"native_language": "zh-CN"})):
        r = await client.post(url, headers=auth_headers, json=body)
        assert (r.status_code, r.json()) == (404, {"error": "Library is disabled"})


@pytest.mark.parametrize("body, status, error", [
    ({"indices": [0], "native_language": "tlh"}, 400, "Unsupported language"),
    ({"indices": [], "native_language": "zh-CN"}, 422, None),
    ({"indices": list(range(21)), "native_language": "zh-CN"}, 422, None),
    ({"indices": [-1], "native_language": "zh-CN"}, 422, None),
    ({"indices": [0]}, 422, None),
    ({"indices": [0], "native_language": "zh-CN", "extra": 1}, 422, None),
], ids=["language", "empty", "too-many", "negative", "no-language", "extra-key"])
async def test_translate_validation(app, client, auth_headers, body, status, error):
    item_id = await ready_item(app, client, auth_headers)
    r = await client.post(translate_url(item_id), headers=auth_headers, json=body)
    assert r.status_code == status
    if error:
        assert r.json() == {"error": error}


@respx.mock
async def test_translate_batches_stores_and_serves_the_second_request_from_the_rows(app, client, auth_headers, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    route = respx.post(LLM).mock(return_value=reply())
    item_id = await ready_item(app, client, auth_headers)
    body = {"indices": [1, 0, 1], "native_language": "zh-CN"}
    r = await client.post(translate_url(item_id), headers=auth_headers, json=body)
    assert r.json() == {"segments": [{"idx": 0, "zh": "你好,我的朋友。"}, {"idx": 1, "zh": "你今天好吗?"}], "limited": False}
    sent = json.loads(route.calls[0].request.content)
    assert sent["model"] == "gpt-4o" and sent["messages"][0]["content"] == ai.TRANSLATE_SYSTEM
    prompt = sent["messages"][1]["content"]
    assert "Simplified Chinese" in prompt and "<text>\n1. Hello there, my friend.\n2. How are you doing today?\n</text>" in prompt
    segs = await detail(client, auth_headers, item_id)
    assert [(s["zh"], s["zh_lang"], s["has_analysis"]) for s in segs] == [
        ("你好,我的朋友。", "zh-CN", False), ("你今天好吗?", "zh-CN", False)]
    again = await client.post(translate_url(item_id), headers=auth_headers, json={"indices": [0], "native_language": "zh-CN"})
    assert again.json() == {"segments": [{"idx": 0, "zh": "你好,我的朋友。"}], "limited": False}
    assert route.call_count == 1  # stored translations cost nothing more
    spent = await counts(app)  # two sentences, counted once for the user and once site-wide
    assert sorted(spent.values()) == [2, 2] and {k.split(":")[0] for k in spent} == {"library_translate", "library_ai"}
    rows = METER.drain()
    assert [(m.feature, m.kind, m.status) for m in rows] == [("lib_translate", "llm", 200)]
    assert "你好" not in caplog.text and "Hello there" not in caplog.text


@respx.mock
async def test_unknown_indices_are_skipped_and_only_ready_items_translate(app, client, auth_headers):
    respx.post(LLM).mock(return_value=reply("1. 你好,我的朋友。"))
    item_id = await ready_item(app, client, auth_headers)
    r = await client.post(translate_url(item_id), headers=auth_headers, json={"indices": [0, 99], "native_language": "zh-CN"})
    assert r.json()["segments"] == [{"idx": 0, "zh": "你好,我的朋友。"}]
    uploading = await upload(client, auth_headers, fake_media(), complete=False)
    r = await client.post(translate_url(uploading), headers=auth_headers, json={"indices": [0], "native_language": "zh-CN"})
    assert (r.status_code, r.json()) == (409, {"error": "Item is not ready"})
    other = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    bob = {"Authorization": f"Bearer {other.json()['access_token']}"}
    r = await client.post(translate_url(item_id), headers=bob, json={"indices": [0], "native_language": "zh-CN"})
    assert r.status_code == 404  # someone else's item


@respx.mock
@pytest.mark.parametrize("settings_overrides", [{"library_translate_daily_per_user": 1}], indirect=True)
async def test_the_daily_allowance_limits_a_batch_and_says_so(app, client, auth_headers, settings_overrides):
    route = respx.post(LLM).mock(return_value=reply("1. 你好,我的朋友。"))
    item_id = await ready_item(app, client, auth_headers)
    body = {"indices": [0, 1], "native_language": "zh-CN"}
    r = await client.post(translate_url(item_id), headers=auth_headers, json=body)
    assert r.json() == {"segments": [{"idx": 0, "zh": "你好,我的朋友。"}], "limited": True}
    r = await client.post(translate_url(item_id), headers=auth_headers, json=body)
    assert r.status_code == 200 and r.json()["limited"] is True and len(r.json()["segments"]) == 1
    assert route.call_count == 1  # the second request had nothing it could afford: no call, the stored one comes back


@respx.mock
async def test_an_upstream_failure_is_503_and_gives_the_allowance_back(app, client, auth_headers):
    respx.post(LLM).mock(return_value=httpx.Response(502, json={"error": "SECRET-UPSTREAM"}))
    item_id = await ready_item(app, client, auth_headers)
    r = await client.post(translate_url(item_id), headers=auth_headers, json={"indices": [0, 1], "native_language": "zh-CN"})
    assert (r.status_code, r.json()) == (503, {"error": "AI is unavailable"})
    assert all(v == 0 for v in (await counts(app)).values())
    assert [s["zh"] for s in await detail(client, auth_headers, item_id)] == [None, None]
    rows = METER.drain()
    assert [(m.feature, m.status) for m in rows] == [("lib_translate", 502)]


@respx.mock
async def test_analysis_is_generated_on_click_stored_and_free_the_second_time(app, client, auth_headers, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    route = respx.post(LLM).mock(return_value=reply("### 句子结构\nSECRET-ANALYSIS"))
    item_id = await ready_item(app, client, auth_headers)
    r = await client.post(analysis_url(item_id, 1), headers=auth_headers, json={"native_language": "zh-CN"})
    assert r.json() == {"analysis": "### 句子结构\nSECRET-ANALYSIS", "cached": False}
    sent = json.loads(route.calls[0].request.content)
    assert sent["messages"][0]["content"].startswith("I speak Simplified Chinese. You're my English coach")
    assert sent["messages"][1] == {"role": "user", "content": "How are you doing today?"}
    r = await client.post(analysis_url(item_id, 1), headers=auth_headers, json={"native_language": "zh-CN"})
    assert r.json()["cached"] is True and route.call_count == 1
    r = await client.post(analysis_url(item_id, 1), headers=auth_headers, json={"native_language": "ja-JP"})
    assert r.json()["cached"] is False and route.call_count == 2  # another language is a new analysis
    seg = (await detail(client, auth_headers, item_id))[1]
    assert (seg["has_analysis"], seg["analysis_lang"]) == (True, "ja-JP") and "analysis" not in seg  # the text is not listed
    assert "SECRET-ANALYSIS" not in caplog.text and "How are you" not in caplog.text
    assert [(m.feature, m.kind) for m in METER.drain()] == [("lib_analysis", "llm")] * 2


@respx.mock
@pytest.mark.parametrize("settings_overrides", [{"library_analysis_daily_per_user": 1}], indirect=True)
async def test_analysis_limits_and_errors(app, client, auth_headers, settings_overrides):
    respx.post(LLM).mock(return_value=reply("### ok"))
    item_id = await ready_item(app, client, auth_headers)
    body = {"native_language": "zh-CN"}
    assert (await client.post(analysis_url(item_id, 0), headers=auth_headers, json=body)).status_code == 200
    r = await client.post(analysis_url(item_id, 1), headers=auth_headers, json=body)
    assert (r.status_code, r.json()) == (429, {"error": "Daily analysis limit reached"})
    assert (await client.post(analysis_url(item_id, 0), headers=auth_headers, json=body)).json()["cached"] is True
    r = await client.post(analysis_url(item_id, 7), headers=auth_headers, json=body)
    assert (r.status_code, r.json()) == (404, {"error": "Sentence not found"})
    r = await client.post(analysis_url(item_id, 0), headers=auth_headers, json={"native_language": "tlh"})
    assert (r.status_code, r.json()) == (400, {"error": "Unsupported language"})
    uploading = await upload(client, auth_headers, fake_media(), complete=False)
    assert (await client.post(analysis_url(uploading), headers=auth_headers, json=body)).status_code == 409


@respx.mock
@pytest.mark.parametrize("settings_overrides", [{"library_ai_daily_global": 1}], indirect=True)
async def test_the_site_wide_cap_is_its_own_message(app, client, auth_headers, settings_overrides):
    respx.post(LLM).mock(return_value=reply("1. 你好,我的朋友。"))
    item_id = await ready_item(app, client, auth_headers)
    r = await client.post(translate_url(item_id), headers=auth_headers, json={"indices": [0], "native_language": "zh-CN"})
    assert r.json()["limited"] is False
    r = await client.post(analysis_url(item_id, 1), headers=auth_headers, json={"native_language": "zh-CN"})
    assert (r.status_code, r.json()) == (429, {"error": "Daily AI limit reached"})


@respx.mock
async def test_an_analysis_upstream_failure_is_503(app, client, auth_headers):
    respx.post(LLM).mock(side_effect=httpx.ConnectError("boom"))
    item_id = await ready_item(app, client, auth_headers)
    r = await client.post(analysis_url(item_id, 0), headers=auth_headers, json={"native_language": "zh-CN"})
    assert (r.status_code, r.json()) == (503, {"error": "AI is unavailable"})
    assert all(v == 0 for v in (await counts(app)).values())


@respx.mock
async def test_editing_the_text_clears_translation_and_analysis_but_times_and_spacing_do_not(app, client, auth_headers):
    respx.post(LLM).mock(side_effect=[reply(), reply("### ok")])
    item_id = await ready_item(app, client, auth_headers)
    await client.post(translate_url(item_id), headers=auth_headers, json={"indices": [0, 1], "native_language": "zh-CN"})
    await client.post(analysis_url(item_id, 0), headers=auth_headers, json={"native_language": "zh-CN"})
    patch = f"/api/library/items/{item_id}/segments"
    await client.patch(f"{patch}/0", headers=auth_headers, json={"start_ms": 400, "text": " Hello  there, my friend. "})
    seg = (await detail(client, auth_headers, item_id))[0]
    assert (seg["zh"], seg["has_analysis"]) == ("你好,我的朋友。", True)  # only times and spacing changed
    r = await client.patch(f"{patch}/0", headers=auth_headers, json={"text": "Hello there, my dear friend."})
    assert (r.json()["segment"]["zh"], r.json()["segment"]["has_analysis"]) == (None, False)
    segs = await detail(client, auth_headers, item_id)
    assert (segs[0]["zh"], segs[0]["zh_lang"], segs[0]["analysis_lang"]) == (None, None, None)
    assert segs[1]["zh"] == "你今天好吗?"  # the neighbour keeps its translation


@respx.mock
async def test_a_published_prompt_is_used_and_a_bad_one_falls_back(app, client, auth_headers):
    route = respx.post(LLM).mock(return_value=reply("1. 一"))
    async with app.state.sessionmaker() as s:
        s.add_all([
            PromptVersion(key="library.translate", version=1, status="published", created_by="t",
                          body="Into {native_language}, tersely. <text>{text}</text>"),
            PromptVersion(key="library.analyze", version=1, status="published", created_by="t", body="Broken {oops}")])
        await s.commit()
    item_id = await ready_item(app, client, auth_headers)
    await client.post(translate_url(item_id), headers=auth_headers, json={"indices": [0], "native_language": "ja-JP"})
    sent = json.loads(route.calls[0].request.content)
    assert sent["messages"][1]["content"] == "Into Japanese, tersely. <text>1. Hello there, my friend.</text>"
    await client.post(analysis_url(item_id, 0), headers=auth_headers, json={"native_language": "ja-JP"})
    sent = json.loads(route.calls[1].request.content)
    assert sent["messages"][0]["content"].startswith("I speak Japanese. You're my English coach")  # the default again
