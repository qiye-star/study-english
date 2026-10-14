"""副本的译文与分析的计费(spec 2026-10-14-curated-library R3、§8;INDEX §7 ai.*)。"""
import httpx
import pytest
import respx
from sqlalchemy import select

from app.core import metering
from app.library import ai, catalog_store, limits
from app.models import DailyUsage
from tests.catalog_helpers import make_catalog
from tests.library_helpers import library_settings
from tests.test_admin_api import register

LLM = "https://llm.test/v1/chat/completions"


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_catalog_enabled=True, library_ai_enabled=True)


def reply(text: str):
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})


async def _counts(app) -> dict[tuple[str, str], int]:
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(DailyUsage))).all()
        return {(r.scope, r.subject): r.count for r in rows}


async def _copy(client, cid):
    uid, h = await register(client, "anna")
    item = (await client.post(f"/api/library/catalog/{cid}/add", headers=h)).json()["item"]["id"]
    return uid, h, item


@respx.mock
async def test_shared_analysis_is_generated_once_for_everyone_and_charges_no_user(app, client, monkeypatch):
    seen_users = []
    real_record = metering.record

    def spy(*a, **kw):
        seen_users.append((metering.current_user_id(), metering.current_feature()))
        return real_record(*a, **kw)

    monkeypatch.setattr(metering, "record", spy)
    route = respx.post(LLM).mock(return_value=reply("### 句子结构\n问候。"))
    cid = await make_catalog(app)
    _uid, h, item = await _copy(client, cid)
    r = await client.post(f"/api/library/items/{item}/segments/0/analysis", headers=h, json={"native_language": "zh-CN"})
    assert r.status_code == 200 and r.json() == {"analysis": "### 句子结构\n问候。", "cached": False}
    _b, hb = await register(client, "ben")
    other = (await client.post(f"/api/library/catalog/{cid}/add", headers=hb)).json()["item"]["id"]
    r = await client.post(f"/api/library/items/{other}/segments/0/analysis", headers=hb,
                          json={"native_language": "zh-CN"})
    assert r.json()["cached"] is True and route.call_count == 1
    counts = await _counts(app)
    assert counts.get((limits.SCOPE_CATALOG_AI, limits.GLOBAL)) == 1
    assert not any(scope in (limits.SCOPE_ANALYSIS, limits.SCOPE_AI_GLOBAL) for scope, _s in counts)
    assert (None, ai.FEATURE_CAT_ANALYSIS) in seen_users
    async with app.state.sessionmaker() as s:
        assert (await catalog_store.segment_at(s, cid, 0)).analysis.startswith("### 句子结构")
    detail = (await client.get(f"/api/library/items/{item}", headers=h)).json()
    assert detail["segments"][0]["has_analysis"] is True  # also stored on the user's own row


@respx.mock
async def test_other_languages_and_edited_sentences_use_the_users_own_allowance(app, client):
    respx.post(LLM).mock(side_effect=[reply("### ja"), reply("### edited")])
    cid = await make_catalog(app)
    uid, h, item = await _copy(client, cid)
    r = await client.post(f"/api/library/items/{item}/segments/0/analysis", headers=h, json={"native_language": "ja-JP"})
    assert r.status_code == 200
    await client.patch(f"/api/library/items/{item}/segments/1", headers=h, json={"text": "How are you doing, pal?"})
    r = await client.post(f"/api/library/items/{item}/segments/1/analysis", headers=h, json={"native_language": "zh-CN"})
    assert r.status_code == 200
    counts = await _counts(app)
    assert counts[(limits.SCOPE_ANALYSIS, str(uid))] == 2
    assert counts.get((limits.SCOPE_CATALOG_AI, limits.GLOBAL)) is None


@respx.mock
async def test_the_system_cap_stops_shared_analyses_with_the_existing_429(app, client):
    respx.post(LLM).mock(return_value=reply("### x"))
    app.state.settings = app.state.settings.model_copy(update={"library_catalog_ai_daily": 0})
    cid = await make_catalog(app)
    _uid, h, item = await _copy(client, cid)
    r = await client.post(f"/api/library/items/{item}/segments/0/analysis", headers=h, json={"native_language": "zh-CN"})
    assert (r.status_code, r.json()) == (429, {"error": "Daily AI limit reached"})


@respx.mock
async def test_a_failed_shared_analysis_gives_the_system_count_back(app, client):
    respx.post(LLM).mock(return_value=httpx.Response(502, json={"error": "boom"}))
    cid = await make_catalog(app)
    _uid, h, item = await _copy(client, cid)
    r = await client.post(f"/api/library/items/{item}/segments/0/analysis", headers=h, json={"native_language": "zh-CN"})
    assert r.status_code == 503
    assert (await _counts(app)).get((limits.SCOPE_CATALOG_AI, limits.GLOBAL), 0) == 0


@respx.mock
async def test_translate_fills_from_the_catalog_before_spending(app, client):
    route = respx.post(LLM).mock(return_value=reply("1. 你好吗"))
    cid = await make_catalog(app, segments=[(0, 1000, "One.", None), (1000, 2000, "Two.", None)])
    uid, h, item = await _copy(client, cid)
    async with app.state.sessionmaker() as s:  # the admin translated after the user added the item
        await catalog_store.set_translations(s, cid, [(0, "One.", "一。"), (1, "Two.", "二。")], "zh-CN")
    r = await client.post(f"/api/library/items/{item}/translate", headers=h,
                          json={"indices": [0, 1], "native_language": "zh-CN"})
    assert r.json() == {"segments": [{"idx": 0, "zh": "一。"}, {"idx": 1, "zh": "二。"}], "limited": False}
    assert route.call_count == 0 and (limits.SCOPE_TRANSLATE, str(uid)) not in await _counts(app)


@respx.mock
async def test_translate_texts_needs_no_allowance(app):
    respx.post(LLM).mock(return_value=reply("1. 一\n2. 二"))
    out = await ai.translate_texts(app.state.http, app.state.settings, template=None, language="zh-CN",
                                   texts=["One.", "Two."])
    assert out == {0: "一", 1: "二"}
    assert await _counts(app) == {}
    respx.post(LLM).mock(return_value=reply("no numbers here"))
    with pytest.raises(ai.AiUnavailable):
        await ai.translate_texts(app.state.http, app.state.settings, template=None, language="zh-CN", texts=["One."])


@respx.mock
async def test_concurrent_first_requests_for_one_sentence_pay_once(app):
    """R-SC8: the per-sentence lock + re-read make two simultaneous first analyses cost one call and one count."""
    import asyncio
    from app.models import utcnow
    route = respx.post(LLM).mock(return_value=reply("### once"))
    cid = await make_catalog(app)

    async def one():
        async with app.state.sessionmaker() as s:
            return await ai.analyze_catalog(s, app.state.http, app.state.settings, catalog_id=cid, idx=0,
                                            text="Hello there, my friend.", language="zh-CN", template=None,
                                            now=utcnow())

    results = await asyncio.gather(one(), one())
    assert sorted(cached for _text, cached in results) == [False, True]
    assert route.call_count == 1
    assert (await _counts(app))[(limits.SCOPE_CATALOG_AI, limits.GLOBAL)] == 1
