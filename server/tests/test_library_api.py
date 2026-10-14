"""跟读库接口:开关、配置、分片上传、条目列表 / 详情 / 修改 / 删除 / 重试 / 取消(spec §8、§9)。"""
import pytest
from sqlalchemy import func, select

from app.core import config as config_module
from app.library import limits, paths
from app.models import DailyUsage, LibraryItem
from tests.library_helpers import SRT, FakeTools, enable, fake_media, library_settings, process, upload, use_fakes

CHUNK = limits.CHUNK_BYTES


@pytest.fixture
def settings_overrides(request, tmp_path):
    return library_settings(tmp_path, **getattr(request, "param", {}))


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    enable(monkeypatch)


def data_dir(app):
    return app.state.library.deps.data_dir


@pytest.mark.parametrize("settings_overrides", [{"library_enabled": False}], indirect=True)
async def test_switch_off_means_404_except_config(client, auth_headers):
    r = await client.get("/api/library/config", headers=auth_headers)
    assert r.status_code == 200 and r.json()["enabled"] is False
    for method, url in (("GET", "/api/library/items"), ("POST", "/api/library/uploads"),
                        ("GET", "/api/library/items/0f0e0d0c-0b0a-4908-8706-050403020100/media?ticket=x")):
        r = await client.request(method, url, headers=auth_headers, json={})
        assert r.status_code == 404 and r.json() == {"error": "Library is disabled"}, url


async def test_everything_needs_a_login(client):
    for method, url in (("GET", "/api/library/config"), ("GET", "/api/library/items"), ("POST", "/api/library/uploads")):
        assert (await client.request(method, url, json={})).status_code == 401


async def test_config_reports_switches_limits_and_usage(app, client, auth_headers, monkeypatch):
    r = await client.get("/api/library/config", headers=auth_headers)
    assert r.json() == {"enabled": True, "link_import": False, "asr": False, "ai": False, "catalog": False,
                          "limits": {
        "max_upload_mb": 500, "max_duration_minutes": 90, "quota_mb": 2000, "used_bytes": 0, "max_items": 100,
        "chunk_bytes": CHUNK, "formats": list(limits.UPLOAD_EXTENSIONS)}}
    monkeypatch.setattr(config_module, "media_tools_present", lambda: False)
    assert (await client.get("/api/library/config", headers=auth_headers)).json()["enabled"] is False
    monkeypatch.setattr(config_module, "media_tools_present", lambda: True)
    monkeypatch.setattr(config_module, "ytdlp_present", lambda: True)
    app.state.settings = app.state.settings.model_copy(update={"library_link_import_enabled": True,
                                                               "library_asr_enabled": True,
                                                               "library_ai_enabled": True})
    body = (await client.get("/api/library/config", headers=auth_headers)).json()
    assert (body["link_import"], body["asr"], body["ai"]) == (True, True, True)
    app.state.settings = app.state.settings.model_copy(update={"upstream_llm_base_url": ""})
    assert (await client.get("/api/library/config", headers=auth_headers)).json()["ai"] is False  # no LLM configured


async def test_chunked_upload_resumes_and_is_idempotent(app, client, auth_headers):
    use_fakes(app)
    data = fake_media() + b" " * (CHUNK + 10)
    r = await client.post("/api/library/uploads", headers=auth_headers, json={"filename": "Talk_one.MKV", "size": len(data)})
    item_id = r.json()["item_id"]
    assert r.json() == {"item_id": item_id, "chunk_bytes": CHUNK}
    part = lambda n: {"chunk": ("blob", data[n * CHUNK:(n + 1) * CHUNK], "application/octet-stream")}  # noqa: E731
    url = f"/api/library/uploads/{item_id}/chunks"
    assert (await client.put(f"{url}/1", headers=auth_headers, files=part(1))).status_code == 409  # out of order
    r = await client.put(f"{url}/0", headers=auth_headers, files=part(0))
    assert r.json()["upload_received"] == CHUNK
    r = await client.put(f"{url}/0", headers=auth_headers, files=part(0))  # resent after a lost response
    assert r.status_code == 200 and r.json()["upload_received"] == CHUNK
    short = {"chunk": ("blob", b"xx", "application/octet-stream")}
    assert (await client.put(f"{url}/1", headers=auth_headers, files=short)).json() == {"error": "Wrong chunk size"}
    assert (await client.post(f"/api/library/uploads/{item_id}/complete", headers=auth_headers)).status_code == 409
    state = (await client.get(f"/api/library/uploads/{item_id}", headers=auth_headers)).json()
    assert (state["upload_received"], state["upload_total"], state["status"]) == (CHUNK, len(data), "uploading")
    assert (await client.put(f"{url}/1", headers=auth_headers, files=part(1))).status_code == 200
    r = await client.post(f"/api/library/uploads/{item_id}/complete", headers=auth_headers)
    assert r.json()["item"]["status"] == "queued" and r.json()["item"]["title"] == "Talk one"
    assert (paths.tmp_dir(data_dir(app), item_id) / "in.mkv").read_bytes() == data
    assert (await client.put(f"{url}/2", headers=auth_headers, files=part(1))).json() == {"error": "Upload is not in progress"}


async def test_chunk_size_cap(app, client, auth_headers):
    item_id = (await client.post("/api/library/uploads", headers=auth_headers,
                                 json={"filename": "a.mp4", "size": CHUNK * 3})).json()["item_id"]
    big = {"chunk": ("blob", b"x" * (CHUNK + 1), "application/octet-stream")}
    r = await client.put(f"/api/library/uploads/{item_id}/chunks/0", headers=auth_headers, files=big)
    assert r.status_code == 413 and r.json() == {"error": "Chunk is too large"}


@pytest.mark.parametrize("body, status, error", [
    ({"filename": "notes.txt", "size": 10}, 400, "Unsupported file type"),
    ({"filename": "big.mp4", "size": 500 * 1_048_576 + 1}, 413, "File is too large"),
    ({"filename": "a.mp4", "size": 0}, 422, None),
    ({"filename": "a.mp4", "size": 1, "extra": 1}, 422, None),
], ids=["type", "size", "zero", "extra-key"])
async def test_upload_start_validation(client, auth_headers, body, status, error):
    r = await client.post("/api/library/uploads", headers=auth_headers, json=body)
    assert r.status_code == status
    if error:
        assert r.json() == {"error": error}


@pytest.mark.parametrize("settings_overrides", [{"library_quota_mb": 1, "library_imports_daily_per_user": 3}],
                         indirect=True)
async def test_upload_quota_parallel_and_daily_limits(app, client, auth_headers):
    r = await client.post("/api/library/uploads", headers=auth_headers, json={"filename": "a.mp4", "size": 1_048_577})
    assert (r.status_code, r.json()) == (409, {"error": "Library storage quota reached"})
    for _ in range(2):
        assert (await client.post("/api/library/uploads", headers=auth_headers,
                                  json={"filename": "a.mp4", "size": 10})).status_code == 200
    r = await client.post("/api/library/uploads", headers=auth_headers, json={"filename": "a.mp4", "size": 10})
    assert (r.status_code, r.json()) == (409, {"error": "Too many uploads in progress"})
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(DailyUsage.count).where(DailyUsage.scope == "library_imports")) == 2


async def test_upload_subtitles_are_validated_and_used(app, client, auth_headers):
    use_fakes(app)
    item_id = await upload(client, auth_headers, fake_media(), subs=None, complete=False)
    bad = {"file": ("x.srt", b"no cues here", "text/plain")}
    r = await client.put(f"/api/library/uploads/{item_id}/subtitles", headers=auth_headers, files=bad)
    assert (r.status_code, r.json()) == (400, {"error": "Invalid subtitle file"})
    r = await client.put(f"/api/library/uploads/{item_id}/subtitles", headers=auth_headers,
                         files={"file": ("x.srt", SRT, "application/x-subrip")})
    assert r.json() == {"cue_count": 2}
    await client.post(f"/api/library/uploads/{item_id}/complete", headers=auth_headers)
    await process(app)
    detail = (await client.get(f"/api/library/items/{item_id}", headers=auth_headers)).json()
    assert detail["item"]["status"] == "ready" and detail["item"]["sub_source"] == "uploaded"
    assert [s["text"] for s in detail["segments"]] == ["Hello there, my friend.", "How are you doing today?"]
    assert detail["item"]["last_opened_at"] is not None


async def test_items_are_private_paged_and_patchable(app, client, auth_headers):
    use_fakes(app)
    ids = [await upload(client, auth_headers, fake_media(), subs=SRT) for _ in range(2)]
    other = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    bob = {"Authorization": f"Bearer {other.json()['access_token']}"}
    assert (await client.get(f"/api/library/items/{ids[0]}", headers=bob)).status_code == 404
    assert (await client.get("/api/library/items", headers=bob)).json() == {"items": [], "next_cursor": None}
    listed = (await client.get("/api/library/items", headers=auth_headers)).json()
    assert [i["id"] for i in listed["items"]] == ids[::-1] and listed["next_cursor"] is None
    await process(app)
    r = await client.patch(f"/api/library/items/{ids[0]}", headers=auth_headers,
                           json={"title": "  New   name ", "resume_ms": 1500, "resume_idx": 1, "rate_pct": 75})
    item = r.json()["item"]
    assert (item["title"], item["resume_ms"], item["resume_idx"], item["rate_pct"]) == ("New name", 1500, 1, 75)
    for body, error in (({}, "No changes"), ({"resume_ms": 6001}, "Invalid resume position"),
                        ({"resume_idx": 2}, "Invalid resume position")):
        assert (await client.patch(f"/api/library/items/{ids[0]}", headers=auth_headers, json=body)).json() == {
            "error": error}
    assert (await client.patch(f"/api/library/items/{ids[0]}", headers=auth_headers,
                               json={"rate_pct": 200})).status_code == 422


async def test_delete_removes_rows_files_and_tickets(app, client, auth_headers):
    use_fakes(app)
    item_id = await upload(client, auth_headers, fake_media(), subs=SRT)
    await process(app)
    url = (await client.post(f"/api/library/items/{item_id}/media-ticket", headers=auth_headers)).json()["url"]
    assert (await client.delete(f"/api/library/items/{item_id}", headers=auth_headers)).json() == {"deleted": True}
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(LibraryItem)) == 0
    assert not paths.item_dir(data_dir(app), await _uid(client, auth_headers), item_id).exists()
    assert (await client.get(url)).status_code == 401
    assert (await client.delete(f"/api/library/items/{item_id}", headers=auth_headers)).status_code == 404


async def _uid(client, headers) -> int:
    return int((await client.get("/api/me", headers=headers)).json()["id"])


async def test_retry_and_cancel(app, client, auth_headers):
    use_fakes(app, FakeTools(fail={"normalize": "corrupt"}))
    item_id = await upload(client, auth_headers, fake_media(), subs=SRT)
    await process(app)
    assert (await client.get(f"/api/library/items/{item_id}", headers=auth_headers)).json()["item"]["error_kind"] == "corrupt"
    r = await client.post(f"/api/library/items/{item_id}/retry", headers=auth_headers)
    assert (r.status_code, r.json()) == (409, {"error": "Nothing left to retry"})  # the broken upload was dropped
    use_fakes(app, FakeTools(fail={"normalize": "disk_full"}))
    item_id = await upload(client, auth_headers, fake_media(), subs=SRT)
    await process(app)
    use_fakes(app)
    r = await client.post(f"/api/library/items/{item_id}/retry", headers=auth_headers)
    assert r.json()["item"]["status"] == "queued" and r.json()["item"]["error_kind"] is None
    assert (await client.post(f"/api/library/items/{item_id}/retry", headers=auth_headers)).json() == {
        "error": "Item has not failed"}
    r = await client.post(f"/api/library/items/{item_id}/cancel", headers=auth_headers)
    assert r.json()["item"]["status"] == "canceled" and r.json()["item"]["library_bytes"] == 0
    assert not paths.tmp_dir(data_dir(app), item_id).exists()
    assert (await client.post(f"/api/library/items/{item_id}/cancel", headers=auth_headers)).json() == {
        "error": "Item cannot be canceled"}
    assert await app.state.library.run_once() == 0


async def test_cancel_an_upload_in_progress(app, client, auth_headers):
    item_id = await upload(client, auth_headers, fake_media(), complete=False)
    assert (await client.post(f"/api/library/items/{item_id}/cancel", headers=auth_headers)).json()["item"][
        "status"] == "canceled"
    r = await client.put(f"/api/library/uploads/{item_id}/chunks/0", headers=auth_headers,
                         files={"chunk": ("b", b"x", "application/octet-stream")})
    assert r.json() == {"error": "Upload is not in progress"}
