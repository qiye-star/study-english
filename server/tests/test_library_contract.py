"""契约夹具 `fixtures/library_contract.json`(spec §9 末段):跑一遍真实接口,按形状核对;`CONTRACT_UPDATE=1` 重录。
网页 `web/src/features/library/library-contract.test.ts`(计划 W1)逐键读它。uuid / 时间由 `agents_helpers.stable` 固定;
媒体票据写成 `REDACTED`。`errors` 是服务端的固定英文错误文本(网页的 `LIBRARY_SERVER_ERRORS` 以它为准),
`error_kinds` 是 `error_kind` 的全部取值(网页的中文映射表必须覆盖)。"""
import httpx
import pytest
import respx

from app.library.errors import ALL
from app.models import Assessment
from app.routers.library import ERRORS
from tests.agents_helpers import check_contract
from tests.library_helpers import SRT, FakeAsr, enable, fake_media, library_settings, process, upload, use_fakes

LLM = "https://llm.test/v1/chat/completions"


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_ai_enabled=True, library_asr_enabled=True)


@respx.mock
async def test_library_contract(app, client, auth_headers, monkeypatch):
    enable(monkeypatch)
    use_fakes(app)
    reply = lambda text: httpx.Response(200, json={"choices": [{"message": {"content": text}}]})  # noqa: E731
    respx.post(LLM).mock(side_effect=[reply("1. 你好,我的朋友。\n2. 你今天好吗?"), reply("### 句子结构\n一句问候。")])
    h = auth_headers
    out = {"errors": {code: text for code, (_status, text) in sorted(ERRORS.items())}, "error_kinds": sorted(ALL)}
    out["config"] = (await client.get("/api/library/config", headers=h)).json()
    data = fake_media(6000)
    out["upload_start"] = (await client.post("/api/library/uploads", headers=h,
                                             json={"filename": "Talk.mp4", "size": len(data), "title": "Talk"})).json()
    item_id = out["upload_start"]["item_id"]
    out["upload_chunk"] = (await client.put(f"/api/library/uploads/{item_id}/chunks/0", headers=h,
                                            files={"chunk": ("blob", data, "application/octet-stream")})).json()
    out["upload_state"] = (await client.get(f"/api/library/uploads/{item_id}", headers=h)).json()
    out["upload_subtitles"] = (await client.put(f"/api/library/uploads/{item_id}/subtitles", headers=h,
                                                files={"file": ("t.srt", SRT, "application/x-subrip")})).json()
    out["upload_complete"] = (await client.post(f"/api/library/uploads/{item_id}/complete", headers=h)).json()
    await process(app)
    out["items"] = (await client.get("/api/library/items", headers=h)).json()
    out["item_detail"] = (await client.get(f"/api/library/items/{item_id}", headers=h)).json()
    out["item_patch"] = (await client.patch(f"/api/library/items/{item_id}", headers=h,
                                            json={"resume_ms": 1200, "resume_idx": 1, "rate_pct": 75})).json()
    out["segment_patch"] = (await client.patch(f"/api/library/items/{item_id}/segments/0", headers=h,
                                               json={"start_ms": 400})).json()
    zh = {"native_language": "zh-CN"}
    out["translate"] = (await client.post(f"/api/library/items/{item_id}/translate", headers=h,
                                          json={"indices": [0, 1], **zh})).json()
    out["analysis"] = (await client.post(f"/api/library/items/{item_id}/segments/0/analysis", headers=h, json=zh)).json()
    out["item_detail_with_ai"] = (await client.get(f"/api/library/items/{item_id}", headers=h)).json()["segments"]
    ticket = (await client.post(f"/api/library/items/{item_id}/media-ticket", headers=h)).json()
    ticket["url"] = ticket["url"].split("ticket=")[0].replace(item_id, "00000000-0000-4000-8000-000000000000") + "ticket=REDACTED"
    out["media_ticket"] = ticket
    uid = int((await client.get("/api/me", headers=h)).json()["id"])
    async with app.state.sessionmaker() as s:
        row = Assessment(user_id=uid, reference_text="Hello there, my friend.", language="en-US", duration_ms=1,
                         audio_bytes=1, scores={"pronunciation_score": 88}, result={}, audio_path="x", source="library")
        s.add(row)
        await s.commit()
        aid = row.id
    out["attempt_post"] = (await client.post(f"/api/library/items/{item_id}/attempts", headers=h,
                                             json={"seg_idx": 0, "assessment_id": aid})).json()
    out["attempts"] = (await client.get(f"/api/library/items/{item_id}/attempts", headers=h)).json()
    out["subtitles_replace"] = (await client.put(f"/api/library/items/{item_id}/subtitles", headers=h,
                                                 files={"file": ("t.srt", SRT, "application/x-subrip")})).json()
    out["error_example"] = (await client.post(f"/api/library/items/{item_id}/retry", headers=h)).json()
    other = (await client.post("/api/library/uploads", headers=h, json={"filename": "b.mp3", "size": 10})).json()
    out["cancel"] = (await client.post(f"/api/library/items/{other['item_id']}/cancel", headers=h)).json()
    use_fakes(app, asr=FakeAsr(["Hello there, my friend. How are you doing today?"]))
    asr_id = await upload(client, h, fake_media(6000, video=False), filename="Pod.m4a", title="Pod")
    await process(app)
    out["reprocess_error"] = (await client.post(f"/api/library/items/{item_id}/reprocess", headers=h)).json()
    out["reprocess"] = (await client.post(f"/api/library/items/{asr_id}/reprocess", headers=h)).json()
    out["delete"] = (await client.delete(f"/api/library/items/{item_id}", headers=h)).json()
    assert out["item_detail"]["item"]["status"] == "ready" and out["error_example"] == {"error": "Item has not failed"}
    assert out["reprocess"]["item"]["status"] == "queued" and out["reprocess_error"] == {"error": "Item cannot be reprocessed"}
    check_contract("library_contract", out)
