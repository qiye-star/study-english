"""管理端「跟读库」(计划 docs/superpowers/plans/2026-10-13-video-import-admin.md;spec 2026-10-13-video-import §5.2、§12、E10)。

条目直接写库造数据(学习者端点由 S1 测);删除与取消经 S1 的 `app.library.store`(计划 R-A3)。"""
import json
import logging
import os
import shutil
import stat
import uuid
from dataclasses import replace
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.admin import library_admin
from app.admin.doctor import CODES, _cookies_state, diagnose
from app.models import AdminAudit, DailyUsage, LibraryItem, LibrarySegment, User, UserQuotaOverride, utcnow
from app.services.usage import utc_day
from tests.admin_helpers import ADMIN_ENABLED, assert_no_secrets, login_as
from tests.conftest import make_settings
from tests.test_admin_doctor import OK

LIBRARY_CODES = {"library_ffmpeg_missing", "library_ytdlp_missing", "library_asr_unavailable", "library_cookies_missing"}
NO_ASR = {"upstream_whisper_base_url": ""}  # make_settings 默认配了 Whisper;流式识别默认没开


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "data"), "library_enabled": True}


def lib_codes(settings, facts=OK) -> dict:
    return {f.code: f for f in diagnose(settings, facts) if f.code.startswith("library_")}


def fake_stat(mode: int):
    return lambda _path: os.stat_result((mode, 0, 0, 1, 0, 0, 10, 0, 0, 0))


def test_new_codes_are_registered():
    assert LIBRARY_CODES <= set(CODES)


def test_nothing_is_reported_while_the_library_is_off():
    facts = replace(OK, library_ffmpeg_ok=False, library_ytdlp_ok=False, library_cookies="missing")
    s = make_settings(library_enabled=False, library_link_import_enabled=True, library_asr_enabled=True,
                      library_ytdlp_cookies_file="/srv/cookies.txt", **NO_ASR)
    assert lib_codes(s, facts) == {}


def test_healthy_library_has_no_findings():
    s = make_settings(library_enabled=True, library_link_import_enabled=True, library_asr_enabled=True)
    assert lib_codes(s) == {}


def test_missing_ffmpeg_is_an_error():
    found = lib_codes(make_settings(library_enabled=True), replace(OK, library_ffmpeg_ok=False))
    assert set(found) == {"library_ffmpeg_missing"}
    assert found["library_ffmpeg_missing"].level == "error"
    assert found["library_ffmpeg_missing"].keys == ("library_enabled",)


def test_missing_ytdlp_only_matters_with_link_import_on():
    facts = replace(OK, library_ytdlp_ok=False)
    assert lib_codes(make_settings(library_enabled=True), facts) == {}
    found = lib_codes(make_settings(library_enabled=True, library_link_import_enabled=True), facts)
    assert found["library_ytdlp_missing"].level == "warn"
    assert found["library_ytdlp_missing"].keys == ("library_link_import_enabled",)


def test_asr_switch_without_a_recognizer():
    assert lib_codes(make_settings(library_enabled=True, library_asr_enabled=True)) == {}  # Whisper 已配
    found = lib_codes(make_settings(library_enabled=True, library_asr_enabled=True, **NO_ASR))
    assert found["library_asr_unavailable"].level == "warn"
    assert found["library_asr_unavailable"].keys == ("library_asr_enabled",)
    assert lib_codes(make_settings(library_enabled=True, **NO_ASR)) == {}  # 子开关没开就不报


def test_cookie_file_states():
    assert _cookies_state("") == "unset"
    assert _cookies_state("   ") == "unset"
    assert _cookies_state(None) == "unset"

    def boom(_path):
        raise FileNotFoundError("nope")

    assert _cookies_state("/x", stat_fn=boom, posix=True) == "missing"
    assert _cookies_state("/x", stat_fn=fake_stat(stat.S_IFDIR | 0o700), posix=True) == "missing"
    assert _cookies_state("/x", stat_fn=fake_stat(stat.S_IFREG | 0o644), posix=True) == "too_open"
    assert _cookies_state("/x", stat_fn=fake_stat(stat.S_IFREG | 0o600), posix=True) == "ok"
    assert _cookies_state("/x", stat_fn=fake_stat(stat.S_IFREG | 0o400), posix=True) == "ok"
    assert _cookies_state("/x", stat_fn=fake_stat(stat.S_IFREG | 0o644), posix=False) == "ok"  # Windows 不判权限


def test_cookie_findings_never_echo_the_path():
    path = "/srv/secret-dir/yt-cookies.txt"
    s = make_settings(library_enabled=True, library_ytdlp_cookies_file=path)
    messages = set()
    for state in ("missing", "too_open"):
        found = lib_codes(s, replace(OK, library_cookies=state))
        assert set(found) == {"library_cookies_missing"}
        assert found["library_cookies_missing"].level == "warn"
        assert found["library_cookies_missing"].keys == ("library_ytdlp_cookies_file",)
        assert path not in found["library_cookies_missing"].message_zh
        messages.add(found["library_cookies_missing"].message_zh)
    assert len(messages) == 2  # 不存在与权限过宽是两种文案
    assert lib_codes(s, replace(OK, library_cookies="ok")) == {}


async def test_doctor_endpoint_gathers_library_facts(app, client, monkeypatch):
    monkeypatch.setattr("app.admin.doctor._library_ffmpeg_ok", lambda: False)
    monkeypatch.setattr("app.admin.doctor._library_ytdlp_ok", lambda: True)
    await login_as(app, client, "viewer")
    r = await client.get("/api/admin/doctor")
    assert r.status_code == 200, r.text
    found = {f["code"]: f for f in r.json()["findings"]}
    assert found["library_ffmpeg_missing"]["level"] == "error"
    assert "library_ytdlp_missing" not in found and "library_cookies_missing" not in found


# ---- 读端点(AS2) ----------------------------------------------------------------------------------------------

API = "/api/admin/library"
ALICE, BOB = 10000101, 10000102
TITLE = "Secret Title Alpha"
URL = "https://media.example.com/watch?v=secret-path-123"
SENTENCE = "Secret sentence alpha"  # D8:句子、译文、分析都是内容(R-A21),管理端永不读
ZH = "秘密译文阿尔法"
ANALYSIS = "Secret analysis alpha"
CONTENT_MARKERS = (SENTENCE, ZH, ANALYSIS)
ROW_KEYS = {"id", "user_id", "username", "kind", "source", "status", "stage", "progress", "error_kind",
            "duration_ms", "bytes", "sub_source", "source_host", "created_at"}
NO_STATUS = {"uploading": 0, "queued": 0, "processing": 0, "ready": 0, "failed": 0, "canceled": 0}


async def add_users(app):
    async with app.state.sessionmaker() as s:
        s.add(User(id=ALICE, username="alice", password_hash="x"))
        s.add(User(id=BOB, username="bob", password_hash="x"))
        await s.commit()


async def add_item(app, user_id, *, status="ready", kind="video", source="link", nbytes=1_000_000,
                   error_kind=None, stage=None, progress=100, age_minutes=0, media=False, segments=False) -> str:
    """一个条目,所有列显式给值(计划 R-A18:列名以 S1 的 models.LibraryItem 为准,不一致只改这里)。
    media=True 时按 spec §5.1 的布局写一个假媒体文件。"""
    item_id = str(uuid.uuid4())
    now = utcnow() - timedelta(minutes=age_minutes)
    rel = f"library/{user_id}/{item_id}/media.{'mp4' if kind == 'video' else 'm4a'}"
    if media:
        path = app.state.settings.resolved_data_dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"\0" * 16)
    link = source == "link"
    async with app.state.sessionmaker() as s:
        s.add(LibraryItem(
            id=item_id, user_id=user_id, kind=kind, source=source, title=TITLE, status=status, stage=stage,
            progress=progress, error_kind=error_kind, attempts=0, next_run_at=None,
            source_host="www.youtube.com" if link else None, source_url=URL if link else None,
            upload_total=nbytes, upload_received=nbytes, duration_ms=61_000, media_path=rel if media else None,
            poster_path=None, media_mime="video/mp4" if kind == "video" else "audio/mp4", library_bytes=nbytes,
            sub_source="platform" if status == "ready" else None, asr_seconds=0,
            seg_count=3 if status == "ready" else 0, resume_ms=0, resume_idx=0, rate_pct=100,
            created_at=now, updated_at=now, last_opened_at=None))
        if segments:  # D8:带句子、译文、分析的内容行,用来证明管理端哪里都不读 library_segments
            for idx in range(2):
                s.add(LibrarySegment(item_id=item_id, idx=idx, start_ms=idx * 3000, end_ms=idx * 3000 + 2500,
                                     text=SENTENCE, zh=ZH, zh_lang="zh-CN", analysis=ANALYSIS, analysis_lang="zh-CN"))
        await s.commit()
    return item_id


async def segment_count(app, item_id: str) -> int:
    async with app.state.sessionmaker() as s:
        return len((await s.scalars(select(LibrarySegment.idx).where(LibrarySegment.item_id == item_id))).all())


def no_content(text: str) -> None:
    assert TITLE not in text and "secret-path-123" not in text and "media.example.com" not in text
    for marker in CONTENT_MARKERS:
        assert marker not in text


@pytest.fixture
def tools(monkeypatch):
    async def ffmpeg():
        return "7.1"

    monkeypatch.setattr(library_admin, "ffmpeg_version", ffmpeg)
    monkeypatch.setattr(library_admin, "ytdlp_version", lambda: "2026.09.30")


async def test_overview_counts_numbers_only(app, client, tools):
    await add_users(app)
    await add_item(app, ALICE, nbytes=3_000_000, segments=True)
    await add_item(app, ALICE, status="failed", kind="audio", source="upload", nbytes=500_000, error_kind="corrupt")
    await add_item(app, BOB, status="processing", stage="transcode", progress=40, nbytes=0)
    await add_item(app, BOB, status="queued", nbytes=0)
    async with app.state.sessionmaker() as s:
        day = utc_day(utcnow())
        s.add(DailyUsage(scope="library_asr", subject="*", day=day, count=1500))
        s.add(DailyUsage(scope="library_asr", subject=str(ALICE), day=day, count=1500))
        await s.commit()
    await login_as(app, client, "viewer")
    r = await client.get(API)
    assert r.status_code == 200, r.text
    body = r.json()
    s = app.state.settings
    assert body["enabled"] is True
    assert body["totals"] == {"items": 4, "bytes": 3_500_000, "users": 2}
    assert body["by_status"] == {**NO_STATUS, "queued": 1, "processing": 1, "ready": 1, "failed": 1}
    assert body["queue"] == {"queued": 1, "processing": 1, "running": 0, "concurrency": s.library_job_concurrency}
    assert body["asr"]["enabled"] is False and body["asr"]["today_minutes"] == 25.0
    assert body["asr"]["global_daily_minutes"] == s.library_asr_minutes_global_daily
    assert body["tools"] == {"ffmpeg": "7.1", "ytdlp": "2026.09.30"}
    assert body["link"]["enabled"] is False
    assert body["link"]["cookies_configured"] is False and body["link"]["proxy_configured"] is False
    assert body["limits"] == {"quota_mb": s.library_quota_mb, "max_items": s.library_max_items,
                              "max_upload_mb": s.library_max_upload_mb,
                              "max_duration_minutes": s.library_max_duration_minutes}
    assert body["purge_confirm"] == "PURGE 1 ITEMS"
    assert body["ai"] == {"enabled": False, "available": False, "today_translated": 0, "today_analysed": 0,
                          "global_daily": s.library_ai_daily_global,
                          "translate_daily_per_user": s.library_translate_daily_per_user,
                          "analysis_daily_per_user": s.library_analysis_daily_per_user}
    no_content(r.text)
    assert_no_secrets(body, s)


async def test_overview_reports_cookie_and_proxy_presence_only(app, client, tools):
    app.state.settings = app.state.settings.model_copy(update={
        "library_link_import_enabled": True, "library_ytdlp_cookies_file": "/run/secrets/yt-cookies.txt",
        "library_ytdlp_proxy": "http://user:pa55word@proxy.example:8080"})
    await login_as(app, client, "viewer")
    r = await client.get(API)
    assert r.status_code == 200, r.text
    link = r.json()["link"]
    assert link["enabled"] is True and link["cookies_configured"] is True and link["proxy_configured"] is True
    assert "yt-cookies" not in r.text and "pa55word" not in r.text and "proxy.example" not in r.text


async def test_overview_ai_block_counts_todays_sentences_from_daily_usage(app, client, tools):
    await add_users(app)
    await add_item(app, ALICE, segments=True)  # 句子行存在也不会被读(R-A20、R-A21)
    day = utc_day(utcnow())
    old_day = utc_day(utcnow() - timedelta(days=2))
    async with app.state.sessionmaker() as s:
        # 译文:全站行与每人行都有(取较大者,不重复相加)
        s.add(DailyUsage(scope="library_translate", subject="*", day=day, count=120))
        s.add(DailyUsage(scope="library_translate", subject=str(ALICE), day=day, count=100))
        s.add(DailyUsage(scope="library_translate", subject=str(BOB), day=day, count=20))
        # 分析:只有每人行
        s.add(DailyUsage(scope="library_analysis", subject=str(ALICE), day=day, count=3))
        s.add(DailyUsage(scope="library_analysis", subject=str(BOB), day=day, count=1))
        # 别的日子、别的 scope 都不算
        s.add(DailyUsage(scope="library_translate", subject="*", day=old_day, count=999))
        s.add(DailyUsage(scope="library_asr", subject="*", day=day, count=600))
        await s.commit()
    await login_as(app, client, "viewer")
    ai = (await client.get(API)).json()["ai"]
    assert (ai["today_translated"], ai["today_analysed"]) == (120, 4)
    assert ai["enabled"] is False

    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": True})
    r = await client.get(API)
    assert r.status_code == 200, r.text
    ai = r.json()["ai"]
    s = app.state.settings
    assert ai["enabled"] is True
    assert (ai["global_daily"], ai["translate_daily_per_user"], ai["analysis_daily_per_user"]) == (
        s.library_ai_daily_global, s.library_translate_daily_per_user, s.library_analysis_daily_per_user)
    no_content(r.text)


async def test_items_filter_and_page_without_content(app, client, monkeypatch):
    await add_users(app)
    ready = await add_item(app, ALICE, age_minutes=3, segments=True)
    failed = await add_item(app, ALICE, status="failed", kind="audio", source="upload", error_kind="no_subtitles",
                            age_minutes=2)
    busy = await add_item(app, BOB, status="processing", stage="transcribe", progress=70, age_minutes=1)
    await login_as(app, client, "viewer")

    r = await client.get(f"{API}/items")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [i["id"] for i in body["items"]] == [busy, failed, ready]  # 新的在前
    assert (body["total"], body["page"], body["next"]) == (3, 1, None)
    assert all(set(i) == ROW_KEYS for i in body["items"])
    row = body["items"][1]
    assert (row["username"], row["kind"], row["source"], row["status"], row["error_kind"], row["source_host"]) == (
        "alice", "audio", "upload", "failed", "no_subtitles", None)
    assert body["items"][2]["source_host"] == "www.youtube.com" and body["items"][2]["bytes"] == 1_000_000
    assert body["items"][2]["duration_ms"] == 61_000 and body["items"][2]["sub_source"] == "platform"
    no_content(r.text)

    assert [i["id"] for i in (await client.get(f"{API}/items", params={"status": "failed"})).json()["items"]] == [failed]
    assert [i["id"] for i in (await client.get(f"{API}/items", params={"kind": "audio"})).json()["items"]] == [failed]
    by_bob = (await client.get(f"{API}/items", params={"user_id": BOB})).json()
    assert [i["id"] for i in by_bob["items"]] == [busy]
    assert (by_bob["items"][0]["stage"], by_bob["items"][0]["progress"], by_bob["total"]) == ("transcribe", 70, 1)

    monkeypatch.setattr(library_admin, "PAGE_SIZE", 2)
    first = (await client.get(f"{API}/items")).json()
    assert len(first["items"]) == 2 and first["next"] == 2
    second = (await client.get(f"{API}/items", params={"page": 2})).json()
    assert [i["id"] for i in second["items"]] == [ready] and second["next"] is None


@pytest.mark.parametrize("query", [{"status": "bogus"}, {"kind": "image"}, {"user_id": 0}, {"page": 0}])
async def test_items_rejects_bad_filters(app, client, query):
    await login_as(app, client, "viewer")
    assert (await client.get(f"{API}/items", params=query)).status_code == 422


async def test_top_users_by_bytes(app, client):
    await add_users(app)
    await add_item(app, ALICE, nbytes=100)
    await add_item(app, ALICE, nbytes=200)
    await add_item(app, BOB, nbytes=5_000)
    await login_as(app, client, "viewer")
    r = await client.get(f"{API}/top-users")
    assert r.status_code == 200, r.text
    assert r.json() == {"users": [{"user_id": BOB, "username": "bob", "items": 1, "bytes": 5_000},
                                  {"user_id": ALICE, "username": "alice", "items": 2, "bytes": 300}]}


async def test_user_usage_honours_quota_overrides(app, client):
    await add_users(app)
    await add_item(app, ALICE, nbytes=7_000)
    await add_item(app, ALICE, status="failed", nbytes=0)
    async with app.state.sessionmaker() as s:
        s.add(UserQuotaOverride(user_id=ALICE, key="library_quota_mb", value=5000, expires_at=None, note="",
                                updated_by="test", updated_at=utcnow()))
        await s.commit()
    await login_as(app, client, "viewer")
    r = await client.get(f"{API}/users/{ALICE}")
    assert r.status_code == 200, r.text
    assert r.json() == {"user_id": ALICE, "enabled": True, "items": 2, "bytes": 7_000, "quota_mb": 5000,
                        "max_items": app.state.settings.library_max_items,
                        "by_status": {**NO_STATUS, "ready": 1, "failed": 1}}
    bob = (await client.get(f"{API}/users/{BOB}")).json()
    assert (bob["items"], bob["bytes"], bob["quota_mb"]) == (0, 0, app.state.settings.library_quota_mb)
    missing = await client.get(f"{API}/users/10009999")
    assert missing.status_code == 404 and missing.json() == {"error": "User not found"}


def test_parse_ffmpeg_version():
    line = "ffmpeg version 5.1.6-0+deb12u1 Copyright (c) 2000-2024 the FFmpeg developers"
    assert library_admin.parse_ffmpeg_version(line) == "5.1.6-0+deb12u1"
    assert library_admin.parse_ffmpeg_version("ffmpeg version n7.1 Copyright") == "n7.1"
    assert library_admin.parse_ffmpeg_version("") is None
    assert library_admin.parse_ffmpeg_version("Usage: ffmpeg [options]") is None


async def test_ffmpeg_version_is_none_without_ffmpeg(monkeypatch):
    monkeypatch.setattr("app.admin.library_admin.shutil.which", lambda _name: None)
    assert await library_admin.ffmpeg_version() is None


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="本机没有 ffmpeg(UNVERIFIED:在容器里再跑)")
async def test_ffmpeg_version_reads_the_real_binary():
    assert await library_admin.ffmpeg_version()


async def test_tool_versions_are_cached_per_process(app, monkeypatch):
    calls = []

    async def ffmpeg():
        calls.append(1)
        return "7.1"

    monkeypatch.setattr(library_admin, "ffmpeg_version", ffmpeg)
    monkeypatch.setattr(library_admin, "ytdlp_version", lambda: None)
    assert await library_admin.tool_versions(app) == {"ffmpeg": "7.1", "ytdlp": None}
    assert await library_admin.tool_versions(app) == {"ffmpeg": "7.1", "ytdlp": None}
    assert len(calls) == 1


# ---- 写端点与隐私(AS3) ---------------------------------------------------------------------------------------

async def audit_rows(app, action: str) -> list:
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(AdminAudit).where(AdminAudit.action == action))).all())


async def item_ids(app) -> set[str]:
    async with app.state.sessionmaker() as s:
        return set((await s.scalars(select(LibraryItem.id))).all())


async def test_delete_needs_operator_and_the_typed_phrase(app, client):
    await add_users(app)
    item = await add_item(app, ALICE, nbytes=4_096, media=True, segments=True)
    assert await segment_count(app, item) == 2
    media = app.state.settings.resolved_data_dir / "library" / str(ALICE) / item / "media.mp4"
    assert media.exists()
    url = f"{API}/items/{item}/delete"
    phrase = f"DELETE {item[:8]}"

    viewer = await login_as(app, client, "viewer")
    denied = await client.post(url, headers=viewer, json={"reason": "clean up", "confirm": phrase})
    assert denied.status_code == 403

    operator = await login_as(app, client, "operator")
    wrong = await client.post(url, headers=operator, json={"reason": "clean up", "confirm": "DELETE"})
    assert wrong.status_code == 409
    assert wrong.json() == {"error": "Confirmation required", "details": {"confirm": phrase}}
    assert item in await item_ids(app)

    r = await client.post(url, headers=operator, json={"reason": "clean up", "confirm": phrase})
    assert r.status_code == 200, r.text
    assert r.json() == {"deleted": item, "bytes": 4_096}
    assert item not in await item_ids(app)
    assert not media.exists()  # S1 的 delete_item 清目录(spec §5.1 的布局)
    assert await segment_count(app, item) == 0  # 句子、译文、分析随条目一起删(spec §4「显式删」;缺陷归 S1)
    (row,) = await audit_rows(app, "library.item.delete")
    assert (row.target_type, row.target_id, row.after, row.reason, row.summary) == (
        "library_item", item, {"bytes": 4_096}, "clean up", "")
    again = await client.post(url, headers=operator, json={"reason": "again", "confirm": phrase})
    assert again.status_code == 404 and again.json() == {"error": "Item not found"}


async def test_item_ids_must_be_uuids(app, client):
    operator = await login_as(app, client, "operator")
    bad = await client.post(f"{API}/items/not-a-uuid/delete", headers=operator, json={"reason": "x", "confirm": "x"})
    assert bad.status_code == 422
    unknown = await client.post(f"{API}/items/{uuid.uuid4()}/cancel", headers=operator, json={"reason": "x"})
    assert unknown.status_code == 404


async def test_cancel_only_running_items(app, client):
    await add_users(app)
    queued = await add_item(app, BOB, status="queued", nbytes=0)
    ready = await add_item(app, BOB)
    operator = await login_as(app, client, "operator")
    r = await client.post(f"{API}/items/{queued}/cancel", headers=operator, json={"reason": "stuck job"})
    assert r.status_code == 200, r.text
    assert r.json() == {"id": queued, "status": "canceled"}
    async with app.state.sessionmaker() as s:
        assert (await s.get(LibraryItem, queued)).status == "canceled"
    (row,) = await audit_rows(app, "library.item.cancel")
    assert (row.target_type, row.target_id, row.before, row.reason) == (
        "library_item", queued, {"status": "queued"}, "stuck job")
    again = await client.post(f"{API}/items/{ready}/cancel", headers=operator, json={"reason": "stuck job"})
    assert again.status_code == 409 and again.json() == {"error": "Item is not running"}


async def test_purge_failed_items(app, client, tools):
    await add_users(app)
    await add_item(app, ALICE, status="failed", nbytes=100, error_kind="corrupt")
    await add_item(app, BOB, status="failed", nbytes=50, error_kind="drm")
    keep = await add_item(app, BOB)
    canceled = await add_item(app, BOB, status="canceled", nbytes=0)
    operator = await login_as(app, client, "operator")
    assert (await client.get(API)).json()["purge_confirm"] == "PURGE 2 ITEMS"

    wrong = await client.post(f"{API}/purge-failed", headers=operator,
                              json={"reason": "weekly", "confirm": "PURGE 3 ITEMS"})
    assert wrong.status_code == 409 and wrong.json()["details"] == {"confirm": "PURGE 2 ITEMS"}
    r = await client.post(f"{API}/purge-failed", headers=operator, json={"reason": "weekly", "confirm": "PURGE 2 ITEMS"})
    assert r.status_code == 200, r.text
    assert r.json() == {"deleted": 2, "bytes": 150, "more": False}
    assert await item_ids(app) == {keep, canceled}  # 已取消的不清(R-A14)
    (row,) = await audit_rows(app, "library.purge_failed")
    assert (row.target_type, row.target_id, row.after, row.summary) == (
        "library", "failed", {"count": 2, "bytes": 150}, "")
    empty = await client.post(f"{API}/purge-failed", headers=operator,
                              json={"reason": "weekly", "confirm": "PURGE 0 ITEMS"})
    assert empty.status_code == 409 and empty.json() == {"error": "Nothing to purge"}


async def test_purge_is_capped_per_call(app, client, monkeypatch):
    await add_users(app)
    for _ in range(3):
        await add_item(app, ALICE, status="failed", nbytes=10)
    monkeypatch.setattr(library_admin, "PURGE_LIMIT", 2)
    operator = await login_as(app, client, "operator")
    r = await client.post(f"{API}/purge-failed", headers=operator, json={"reason": "weekly", "confirm": "PURGE 3 ITEMS"})
    assert r.status_code == 200, r.text
    assert r.json() == {"deleted": 2, "bytes": 20, "more": True}
    assert len(await item_ids(app)) == 1


async def test_no_titles_or_urls_in_logs_responses_or_audit(app, client, tools, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    await add_users(app)
    keep = await add_item(app, ALICE, segments=True)
    await add_item(app, ALICE, status="failed", error_kind="blocked", segments=True)
    queued = await add_item(app, BOB, status="queued", nbytes=0, segments=True)
    async with app.state.sessionmaker() as s:  # D8:今日译文 / 分析计数也在响应里,但只是数字
        s.add(DailyUsage(scope="library_translate", subject="*", day=utc_day(utcnow()), count=7))
        await s.commit()
    operator = await login_as(app, client, "operator")
    texts = []
    for path in (API, f"{API}/items", f"{API}/top-users", f"{API}/users/{ALICE}"):
        r = await client.get(path)
        assert r.status_code == 200, (path, r.text)
        texts.append(r.text)
    texts.append((await client.post(f"{API}/items/{queued}/cancel", headers=operator,
                                    json={"reason": "privacy run"})).text)
    texts.append((await client.post(f"{API}/items/{keep}/delete", headers=operator,
                                    json={"reason": "privacy run", "confirm": f"DELETE {keep[:8]}"})).text)
    texts.append((await client.post(f"{API}/purge-failed", headers=operator,
                                    json={"reason": "privacy run", "confirm": "PURGE 1 ITEMS"})).text)
    for text in texts:
        no_content(text)
    no_content(caplog.text)
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(AdminAudit).where(AdminAudit.action.like("library.%")))).all()
    assert sorted(r.action for r in rows) == ["library.item.cancel", "library.item.delete", "library.purge_failed"]
    no_content(json.dumps([[r.summary, r.before, r.after, r.target_id] for r in rows], ensure_ascii=False,
                          default=str))


def test_admin_library_urls_carry_only_ids():
    from app.main import create_app
    from tests.test_admin_routes_guarded import api_routes
    paths = sorted({p for p, _ in api_routes(create_app(make_settings()).routes) if p.startswith(API)})
    assert paths == sorted([API, f"{API}/items", f"{API}/top-users", f"{API}/users/{{user_id}}",
                            f"{API}/items/{{item_id}}/delete", f"{API}/items/{{item_id}}/cancel",
                            f"{API}/purge-failed"])
