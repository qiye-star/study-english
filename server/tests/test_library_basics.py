"""跟读库的路径、错误种类与每日计数 / 准入(spec §5.1、§6.6、§8)。"""
import pytest

from app.core import config as config_module
from app.library import errors, limits, paths
from app.models import DailyUsage, LibraryItem, User
from sqlalchemy import select

ITEM = "0f0e0d0c-0b0a-4908-8706-050403020100"


# ---- paths ----

def test_layout_and_escape_checks(tmp_path):
    assert paths.item_rel(12345678, ITEM) == f"library/12345678/{ITEM}"
    assert paths.tmp_rel(ITEM) == f"library/_tmp/{ITEM}"
    assert paths.item_dir(tmp_path, 12345678, ITEM) == (tmp_path / "library" / "12345678" / ITEM).resolve()
    for bad in ("../x", "..", ITEM.upper(), ITEM + "/..", "", "a" * 36):
        with pytest.raises(ValueError):
            paths.tmp_rel(bad)
    for bad in (0, -1, True, "12"):
        with pytest.raises(ValueError):
            paths.user_rel(bad)
    with pytest.raises(ValueError):
        paths.absolute(tmp_path, "../outside")
    with pytest.raises(ValueError):
        paths.absolute(tmp_path, ".")


def test_remove_user_files_takes_the_user_dir_and_their_staging_only(tmp_path):
    other = "11111111-2222-4333-8444-555555555555"
    for rel in (f"library/7/{ITEM}/media.mp4", f"library/_tmp/{ITEM}/in.mp4", f"library/8/{other}/media.mp4",
                f"library/_tmp/{other}/in.mp4"):
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / rel).write_bytes(b"x")
    paths.remove_user_files(tmp_path, 7, [ITEM, "not-an-id"])
    assert not (tmp_path / "library/7").exists() and not (tmp_path / f"library/_tmp/{ITEM}").exists()
    assert (tmp_path / f"library/8/{other}/media.mp4").exists() and (tmp_path / f"library/_tmp/{other}").exists()


def test_disk_free_walks_up_to_an_existing_parent(tmp_path):
    assert paths.disk_free(tmp_path / "a" / "b" / "c") > 0
    assert paths.file_bytes(tmp_path / "missing") == 0


# ---- errors ----

def test_error_kinds_match_the_spec():
    assert errors.TRANSIENT == {"upstream", "network", "ytdlp_transient"}
    assert {"too_large", "too_long", "quota", "corrupt", "no_audio", "bad_subtitle", "no_subtitles", "disk_full",
            "unsupported_format", "upload_expired"} == errors.PERMANENT
    assert {"drm", "blocked", "login_required", "unsupported_site", "ytdlp_failed"} <= errors.LINK
    assert not (errors.PERMANENT & errors.LINK) and not (errors.TRANSIENT & (errors.PERMANENT | errors.LINK))
    assert all(len(k) <= 24 for k in errors.ALL)  # library_items.error_kind is String(24)
    assert errors.LibraryError("corrupt").kind == "corrupt" and str(errors.LibraryError("corrupt")) == "corrupt"
    assert errors.LibraryError("max_items").kind == "max_items"  # an admission code (never stored)
    with pytest.raises(ValueError):
        errors.LibraryError("Traceback: secret text")
    assert errors.is_transient("network") and not errors.is_transient("drm") and not errors.is_transient(None)


# ---- daily counters and admission ----

async def _user(app, uid=12345678, name="u1"):
    async with app.state.sessionmaker() as s:
        s.add(User(id=uid, username=name, password_hash="x"))
        await s.commit()
    return uid


async def test_reserve_and_release_by_amount(app):
    async with app.state.sessionmaker() as s:
        assert await limits.reserve(s, "library_asr", "7", "2026-10-13", 30, 100)
        assert await limits.reserve(s, "library_asr", "7", "2026-10-13", 70, 100)
        assert not await limits.reserve(s, "library_asr", "7", "2026-10-13", 1, 100)
        assert not await limits.reserve(s, "library_asr", "8", "2026-10-13", 101, 100)
        assert await limits.reserve(s, "library_asr", "8", "2026-10-13", 0, 0)
        await limits.release(s, "library_asr", "7", "2026-10-13", 40)
        await limits.release(s, "library_asr", "7", "2026-10-13", 500)
        await limits.release(s, "library_asr", "9", "2026-10-13", 5)  # no row: nothing happens
        row = await s.scalar(select(DailyUsage).where(DailyUsage.subject == "7"))
    assert row.count == 0


async def test_used_bytes_counts_stored_media_and_announced_uploads(app):
    uid = await _user(app)
    async with app.state.sessionmaker() as s:
        s.add_all([
            LibraryItem(user_id=uid, kind="video", source="upload", title="a", status="ready", library_bytes=100),
            LibraryItem(user_id=uid, kind="video", source="upload", title="b", status="uploading", upload_total=50),
            LibraryItem(user_id=uid, kind="video", source="upload", title="c", status="processing", upload_total=7),
            LibraryItem(user_id=uid, kind="video", source="upload", title="d", status="canceled", upload_total=999),
            LibraryItem(user_id=uid, kind="audio", source="upload", title="e", status="failed", upload_total=999,
                        library_bytes=3),
        ])
        await s.commit()
        assert await limits.used_bytes(s, uid) == 100 + 50 + 7 + 3
        assert await limits.item_count(s, uid) == 4
        assert await limits.uploads_in_progress(s, uid) == 1


@pytest.fixture
def settings_overrides():
    return {"library_enabled": True, "library_max_items": 2, "library_quota_mb": 1, "library_imports_daily_per_user": 3}


async def _refused(session, app, uid, **kw) -> str | None:
    try:
        await limits.admit_new_item(session, app, uid, **kw)
    except errors.LibraryError as e:
        return e.kind
    return None


async def test_admit_checks_in_order_and_spends_the_daily_count_last(app, monkeypatch):
    monkeypatch.setattr(config_module, "media_tools_present", lambda: True)
    uid = await _user(app)
    async with app.state.sessionmaker() as s:
        assert await _refused(s, app, uid, size_bytes=limits.MB + 1, upload=True) == "quota"
        assert await _refused(s, app, uid, size_bytes=10, upload=True) is None
        s.add_all([LibraryItem(user_id=uid, kind="video", source="upload", title=t, status="uploading", upload_total=1)
                   for t in "ab"])
        await s.commit()
        assert await _refused(s, app, uid, size_bytes=10, upload=True) == "max_items"
        count = await s.scalar(select(DailyUsage.count).where(DailyUsage.scope == "library_imports"))
        assert count == 1  # refused requests never spent it
        await limits.refund_new_item(s, app, uid)
        assert await s.scalar(select(DailyUsage.count).where(DailyUsage.scope == "library_imports")) == 0


async def test_admit_parallel_uploads_and_daily_cap(app, monkeypatch):
    monkeypatch.setattr(config_module, "media_tools_present", lambda: True)
    app.state.settings = app.state.settings.model_copy(update={"library_max_items": 100, "library_quota_mb": 100})
    uid = await _user(app)
    async with app.state.sessionmaker() as s:
        s.add_all([LibraryItem(user_id=uid, kind="video", source="upload", title=t, status="uploading", upload_total=1)
                   for t in "ab"])
        await s.commit()
        assert await _refused(s, app, uid, size_bytes=1, upload=True) == "uploads"
        for _ in range(3):
            assert await _refused(s, app, uid) is None
        assert await _refused(s, app, uid) == "daily"


async def test_admit_is_unavailable_without_ffmpeg(app, monkeypatch):
    monkeypatch.setattr(config_module, "media_tools_present", lambda: False)
    uid = await _user(app)
    async with app.state.sessionmaker() as s:
        assert await _refused(s, app, uid, size_bytes=1, upload=True) == "unavailable"


def test_http_errors_are_fixed_english_texts():
    e = errors.http_error(errors.LibraryError("daily"))
    assert (e.status_code, e.detail) == (429, "Daily import limit reached")
    assert errors.http_error(errors.LibraryError("drm")).status_code == 400
    assert errors.api_error("ticket").status_code == 401
    assert errors.KINDS == errors.ALL and not (errors.ADMIT - {"quota"}) & errors.KINDS
