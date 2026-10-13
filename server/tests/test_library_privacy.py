"""隐私(spec §13):跟读库的每个端点、worker 的成功 / 失败 / 重试路径、票据请求的访问日志行里,没有标题、文件名、
字幕与转写文字、上游 / 工具的错误原文、票据;路由 URL 里没有文字(路径参数只有 id 与序号,查询参数只有游标与票据)。
caplog 只收 `app` 日志(根 logger 的 DEBUG 会带上 aiosqlite 绑定的 SQL 参数,是测试环境的假象)。"""
import logging

import httpx
import pytest
import respx

from app.core.logging_setup import redact_query_secrets
from tests.library_helpers import FakeAsr, FakeTools, enable, fake_media, library_settings, process, upload, use_fakes

SECRETS = ("SECRET-TITLE", "SECRET-FILE", "SECRET-SUBTITLE", "SECRET-TRANSCRIPT", "SECRET-UPSTREAM", "SECRET-EDIT",
           "SECRET-TRANSLATION", "SECRET-ANALYSIS")  # the last two: D8 model output (translations, analyses)
LLM = "https://llm.test/v1/chat/completions"
SUBS = (b"1\n00:00:00,500 --> 00:00:03,000\nSECRET-SUBTITLE says hello there.\n\n"
        b"2\n00:00:03,200 --> 00:00:06,000\nAnd then we talk for a while.\n")
ROUTES = {
    ("GET", "/api/library/config"), ("POST", "/api/library/uploads"), ("GET", "/api/library/uploads/{item_id}"),
    ("PUT", "/api/library/uploads/{item_id}/chunks/{n}"), ("PUT", "/api/library/uploads/{item_id}/subtitles"),
    ("POST", "/api/library/uploads/{item_id}/complete"), ("GET", "/api/library/items"),
    ("GET", "/api/library/items/{item_id}"), ("PATCH", "/api/library/items/{item_id}"),
    ("DELETE", "/api/library/items/{item_id}"), ("POST", "/api/library/items/{item_id}/retry"),
    ("POST", "/api/library/items/{item_id}/cancel"), ("POST", "/api/library/items/{item_id}/reprocess"), ("PUT", "/api/library/items/{item_id}/subtitles"),
    ("PATCH", "/api/library/items/{item_id}/segments/{idx}"), ("POST", "/api/library/items/{item_id}/media-ticket"),
    ("POST", "/api/library/items/{item_id}/translate"), ("POST", "/api/library/items/{item_id}/segments/{idx}/analysis"),
    ("GET", "/api/library/items/{item_id}/media"), ("HEAD", "/api/library/items/{item_id}/media"),
    ("GET", "/api/library/items/{item_id}/poster"), ("POST", "/api/library/items/{item_id}/attempts"),
    ("GET", "/api/library/items/{item_id}/attempts"),
}
LATER = {("POST", "/api/library/imports")}  # plan S2 (server-import); its own privacy test covers the body
ALLOWED_PATH = {"item_id", "n", "idx"}
ALLOWED_QUERY = {"cursor", "ticket"}


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_asr_enabled=True, library_ai_enabled=True)


def leaked(caplog, extra: tuple[str, ...] = ()) -> list[str]:
    found = []
    for record in caplog.records:
        text = f"{record.getMessage()} {record.args!r} {record.exc_text or ''}".lower()
        found += [s for s in (*SECRETS, *extra) if s.lower() in text]
    return found


async def test_logs_never_carry_titles_names_texts_upstream_text_or_tickets(app, client, auth_headers, caplog,
                                                                             monkeypatch):
    caplog.set_level(logging.DEBUG, logger="app")
    enable(monkeypatch)
    use_fakes(app, asr=FakeAsr([RuntimeError("SECRET-UPSTREAM")] * 3 + ["SECRET-TRANSCRIPT is spoken here today."]))
    ok = await upload(client, auth_headers, fake_media(), filename="SECRET-FILE.mp4", title="SECRET-TITLE", subs=SUBS)
    asr = await upload(client, auth_headers, fake_media(4000, video=False), filename="SECRET-FILE.m4a")
    await process(app)
    await process(app)  # the transcription fails three times -> queued with backoff (upstream)
    from app.models import LibraryItem
    async with app.state.sessionmaker() as s:
        row = await s.get(LibraryItem, asr)
        row.next_run_at = None
        await s.commit()
    await process(app)
    await client.patch(f"/api/library/items/{ok}", headers=auth_headers, json={"title": "SECRET-TITLE again"})
    await client.patch(f"/api/library/items/{ok}/segments/0", headers=auth_headers, json={"text": "SECRET-EDIT words"})
    url = (await client.post(f"/api/library/items/{ok}/media-ticket", headers=auth_headers)).json()["url"]
    token = url.split("ticket=")[1]
    assert (await client.get(url)).status_code == 200
    await client.get(f"/api/library/items/{ok}/media?ticket=SECRET-UPSTREAM")
    use_fakes(app, FakeTools())

    class Boom(FakeTools):
        async def normalize(self, *a, **kw):
            raise RuntimeError("SECRET-UPSTREAM from a tool")

    use_fakes(app, Boom())
    await upload(client, auth_headers, fake_media(), filename="SECRET-FILE.mov", subs=SUBS)
    await process(app)
    await client.put(f"/api/library/items/{ok}/subtitles", headers=auth_headers,
                     files={"file": ("SECRET-FILE.srt", SUBS, "application/x-subrip")})
    await client.delete(f"/api/library/items/{ok}", headers=auth_headers)
    assert any("library" in r.name for r in caplog.records)  # the scan saw the library's own lines
    assert leaked(caplog, (token,)) == []


@respx.mock
async def test_ai_endpoints_never_log_sentences_translations_analyses_or_prompts(app, client, auth_headers, caplog,
                                                                                monkeypatch):
    """D8:句子文字会发给大模型上游,但日志里只有条目 id、失败种类与句数;成功、模型失败(HTTP / 网络)、额度用满
    各走一遍。上游错误原文、模型回复、提示词正文都不得出现在日志里。"""
    caplog.set_level(logging.DEBUG, logger="app")
    enable(monkeypatch)
    use_fakes(app)
    ok = await upload(client, auth_headers, fake_media(), filename="SECRET-FILE.mp4", title="SECRET-TITLE", subs=SUBS)
    await process(app)

    def reply(text):
        return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})

    respx.post(LLM).mock(side_effect=[
        reply("1. SECRET-TRANSLATION one\n2. SECRET-TRANSLATION two"), reply("### SECRET-ANALYSIS"),
        httpx.Response(502, json={"error": "SECRET-UPSTREAM"}), httpx.ConnectError("SECRET-UPSTREAM")])
    base = f"/api/library/items/{ok}"
    zh = {"native_language": "zh-CN"}
    assert (await client.post(f"{base}/translate", headers=auth_headers, json={"indices": [0, 1], **zh})).status_code == 200
    assert (await client.post(f"{base}/segments/0/analysis", headers=auth_headers, json=zh)).status_code == 200
    ja = {"native_language": "ja-JP"}
    assert (await client.post(f"{base}/translate", headers=auth_headers, json={"indices": [0], **ja})).status_code == 503
    assert (await client.post(f"{base}/segments/1/analysis", headers=auth_headers, json=ja)).status_code == 503
    app.state.settings = app.state.settings.model_copy(update={"library_analysis_daily_per_user": 0})
    assert (await client.post(f"{base}/segments/1/analysis", headers=auth_headers, json=zh)).status_code == 429
    assert (await client.post(f"{base}/segments/0/analysis", headers=auth_headers, json=zh)).status_code == 200  # stored
    await client.patch(f"{base}/segments/0", headers=auth_headers, json={"text": "SECRET-EDIT words"})
    assert any(r.name == "app.library.ai" for r in caplog.records)  # the scan saw the AI module's own lines
    assert leaked(caplog) == []


def test_access_log_lines_redact_the_ticket():
    line = 'GET /api/library/items/0f0e0d0c-0b0a-4908-8706-050403020100/media?ticket=abcDEF123_-xyz HTTP/1.1'
    assert "abcDEF123_-xyz" not in redact_query_secrets(line) and "ticket=[redacted]" in redact_query_secrets(line)


def test_library_routes_carry_no_text_in_urls(app):
    seen = set()
    for path, item in app.openapi()["paths"].items():
        if not path.startswith("/api/library"):
            continue
        for method, op in item.items():
            if method.upper() not in {"GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"}:
                continue
            key = (method.upper(), path)
            assert key in ROUTES | LATER, f"new library route needs a privacy test: {method} {path}"
            seen.add(key)
            params = op.get("parameters", [])
            assert {p["name"] for p in params if p["in"] == "path"} <= ALLOWED_PATH, path
            assert {p["name"] for p in params if p["in"] == "query"} <= ALLOWED_QUERY, path
    assert ROUTES <= seen
