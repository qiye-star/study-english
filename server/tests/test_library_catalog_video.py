"""精选库保留视频画面(plan 2026-10-15-catalog-keep-video):真实 ffmpeg 生成几秒的小视频 + 现成 SRT,走管理端上传 →
导入任务 → 发布 → 用户添加 → 媒体票据 + Range。不识别、不翻译、不联网;没有 ffmpeg 的机器整文件跳过。"""
import shutil
import subprocess

import pytest

from app.library.media import Ffmpeg
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.background import drain_background
from tests.library_helpers import SRT, library_settings
from tests.test_admin_api import register
from tests.test_admin_catalog import BASE, upload_catalog

HAVE_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
pytestmark = pytest.mark.skipif(not HAVE_FFMPEG, reason="ffmpeg / ffprobe not installed")


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, **library_settings(tmp_path, library_catalog_enabled=True)}


def tiny_video(path, *, vcodec: str = "libx264", seconds: int = 6) -> bytes:
    """320x240 10 fps test picture + 440 Hz tone in mp4. `libx264` = the copy path, `mpeg4` forces a transcode."""
    subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", f"testsrc=size=320x240:rate=10:duration={seconds}",
                    "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-shortest",
                    "-c:v", vcodec, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", str(path)],
                   check=True, timeout=120)
    return path.read_bytes()


async def import_and_add(app, client, data: bytes) -> tuple[str, str, dict, dict]:
    """(catalog id, the user's copy id, user headers, admin headers): upload with the SRT, run the job, publish, add."""
    admin = await login_as(app, client, "operator")
    cid = await upload_catalog(client, admin, data, subs=SRT, title="Tiny")
    await drain_background(app, timeout=120)
    item = (await client.get(f"{BASE}/{cid}", headers=admin)).json()["item"]
    assert item["status"] == "ready", item
    assert (await client.post(f"{BASE}/{cid}/publish", headers=admin, json={})).status_code == 200
    _uid, h = await register(client, "anna")
    r = await client.post(f"/api/library/catalog/{cid}/add", headers=h)
    assert r.status_code == 200, r.text
    return cid, r.json()["item"]["id"], h, admin


async def fetch_media(client, h, item_id: str, tmp_path):
    """(content type, probe of the served bytes); also proves a 206 Range answer on the copy's ticket URL."""
    url = (await client.post(f"/api/library/items/{item_id}/media-ticket", headers=h)).json()["url"]
    full = await client.get(url)
    assert full.status_code == 200
    part = await client.get(url, headers={"Range": "bytes=0-1023"})
    assert part.status_code == 206 and part.content == full.content[:1024]
    assert part.headers["content-range"] == f"bytes 0-1023/{len(full.content)}"
    out = tmp_path / "served.bin"
    out.write_bytes(full.content)
    return full.headers["content-type"], await Ffmpeg().probe(out, home=tmp_path)


async def test_a_catalog_copy_streams_decodable_audio(app, client, tmp_path):
    """Task 0 gate (R-KV11): the copy plays at all. Red here = a separate playback bug, fixed before Task 1."""
    _cid, item, h, _admin = await import_and_add(app, client, tiny_video(tmp_path / "src.mp4"))
    mime, info = await fetch_media(client, h, item, tmp_path)
    assert info.has_audio and 5500 <= info.duration_ms <= 6500
    assert mime in ("audio/mp4", "video/mp4")


@pytest.mark.xfail(strict=True, reason="plan 2026-10-15-catalog-keep-video: Task 3 removes this marker")
async def test_a_catalog_copy_of_a_video_keeps_the_picture(app, client, tmp_path):
    _cid, item, h, _admin = await import_and_add(app, client, tiny_video(tmp_path / "src.mp4", vcodec="mpeg4"))
    assert (await client.get(f"/api/library/items/{item}", headers=h)).json()["item"]["kind"] == "video"
    mime, info = await fetch_media(client, h, item, tmp_path)
    assert mime == "video/mp4" and info.has_video and info.has_audio
    assert (info.vcodec, info.acodec, info.height) == ("h264", "aac", 240)
