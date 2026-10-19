"""头像端点(计划 S4、S5):上传 / 删除自己的头像、`/api/me` 的 `avatar_url`、公开读取。"""
import io
import logging
import re

import pytest
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User

TOO_LARGE = {"error": "Avatar file is too large"}
INVALID = {"error": "Invalid image"}
ID_RE = re.compile(r"/api/avatars/([0-9a-f]{32})")


@pytest.fixture
def settings_overrides(tmp_path):
    return {"data_dir": str(tmp_path)}


def image(fmt="PNG", size=(40, 30), color=(200, 30, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format=fmt)
    return buf.getvalue()


def upload_files(data: bytes, name="a.png", content_type="image/png"):
    return {"file": (name, data, content_type)}


async def upload(client, headers, data=None):
    return await client.post("/api/me/avatar", files=upload_files(data or image()), headers=headers)


def avatar_file(tmp_path, url: str):
    return tmp_path / "avatars" / f"{ID_RE.fullmatch(url).group(1)}.webp"


def stored_files(tmp_path):
    folder = tmp_path / "avatars"
    return sorted(p.name for p in folder.iterdir()) if folder.exists() else []


@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP"])
async def test_upload_returns_url_and_me_shows_the_same_url(client, auth_headers, tmp_path, fmt):
    r = await upload(client, auth_headers, image(fmt))
    assert r.status_code == 200, r.text
    url = r.json()["avatar_url"]
    assert ID_RE.fullmatch(url)
    assert avatar_file(tmp_path, url).read_bytes()[:4] == b"RIFF"  # re-encoded WebP only
    me = (await client.get("/api/me", headers=auth_headers)).json()
    assert me["avatar_url"] == url


async def test_second_upload_replaces_the_file_and_the_url(client, auth_headers, tmp_path):
    first = (await upload(client, auth_headers, image(color=(10, 10, 10)))).json()["avatar_url"]
    second = (await upload(client, auth_headers, image(color=(240, 240, 0)))).json()["avatar_url"]
    assert first != second
    assert not avatar_file(tmp_path, first).exists()  # deleted after the commit
    assert avatar_file(tmp_path, second).exists()
    assert (await client.get("/api/me", headers=auth_headers)).json()["avatar_url"] == second


async def test_delete_removes_the_file_and_the_field(client, auth_headers, tmp_path):
    url = (await upload(client, auth_headers)).json()["avatar_url"]
    r = await client.delete("/api/me/avatar", headers=auth_headers)
    assert r.status_code == 204
    assert not avatar_file(tmp_path, url).exists()
    assert "avatar_url" not in (await client.get("/api/me", headers=auth_headers)).json()
    again = await client.delete("/api/me/avatar", headers=auth_headers)  # idempotent
    assert again.status_code == 204


async def test_me_has_no_avatar_url_before_any_upload(client, auth_headers):
    assert "avatar_url" not in (await client.get("/api/me", headers=auth_headers)).json()


async def test_login_response_carries_the_avatar_url(client, auth_headers):
    url = (await upload(client, auth_headers)).json()["avatar_url"]
    r = await client.post("/api/sessions", json={"username": "alice", "password": "password123"})
    assert r.status_code == 200
    assert r.json()["avatar_url"] == url


async def test_too_large_body_is_rejected_while_streaming(client, auth_headers):
    r = await client.post("/api/me/avatar", files=upload_files(b"\x89PNG\r\n\x1a\n" + b"0" * (3 * 1024 * 1024)),
                          headers=auth_headers)
    assert r.status_code == 413
    assert r.json() == TOO_LARGE


async def test_file_just_over_two_mib_is_rejected_by_the_processor(client, auth_headers, tmp_path):
    data = b"\x89PNG\r\n\x1a\n" + b"0" * (2 * 1024 * 1024 + 1 - 8)
    r = await client.post("/api/me/avatar", files=upload_files(data), headers=auth_headers)
    assert r.status_code == 413
    assert r.json() == TOO_LARGE
    assert stored_files(tmp_path) == []


async def test_non_image_is_422_whatever_the_name_and_type_say(client, auth_headers):
    r = await client.post("/api/me/avatar",
                          files=upload_files(b"<svg xmlns='http://www.w3.org/2000/svg'/>", "a.png", "image/png"),
                          headers=auth_headers)
    assert r.status_code == 422
    assert r.json() == INVALID


async def test_gif_is_refused_even_though_pillow_can_read_it(client, auth_headers):
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (1, 2, 3)).save(buf, format="GIF")
    r = await client.post("/api/me/avatar", files=upload_files(buf.getvalue(), "a.jpg", "image/jpeg"),
                          headers=auth_headers)
    assert r.status_code == 422
    assert r.json() == INVALID


async def test_missing_file_field_is_refused(client, auth_headers):
    r = await client.post("/api/me/avatar", data={"note": "no file here"}, headers=auth_headers)
    assert r.status_code == 422
    assert r.json() == INVALID


async def test_eleventh_upload_in_an_hour_is_limited(client, auth_headers):
    for _ in range(10):
        assert (await upload(client, auth_headers)).status_code == 200
    r = await upload(client, auth_headers)
    assert r.status_code == 429


async def test_upload_needs_a_token(client):
    r = await client.post("/api/me/avatar", files=upload_files(image()))
    assert r.status_code == 401


async def test_delete_needs_a_token(client):
    assert (await client.delete("/api/me/avatar")).status_code == 401


async def test_upload_switch_off_is_403_and_delete_still_works(app, client, auth_headers, tmp_path):
    url = (await upload(client, auth_headers)).json()["avatar_url"]
    app.state.settings = app.state.settings.model_copy(update={"avatar_upload_enabled": False})
    r = await upload(client, auth_headers)
    assert r.status_code == 403
    assert r.json() == {"error": "Avatar upload is disabled"}
    # the stored avatar and its url are kept while the switch is off
    assert (await client.get("/api/me", headers=auth_headers)).json()["avatar_url"] == url
    assert avatar_file(tmp_path, url).exists()
    assert (await client.delete("/api/me/avatar", headers=auth_headers)).status_code == 204


async def test_unbound_user_is_blocked_while_binding_is_enforced(app, client, auth_headers, tmp_path):
    app.state.settings = app.state.settings.model_copy(
        update={"email_binding_required": True, "email_binding_deadline": "2020-01-01T00:00+00:00"})
    r = await upload(client, auth_headers)
    assert r.status_code == 403
    assert r.json() == {"error": "email_binding_required"}
    assert stored_files(tmp_path) == []


async def test_failed_commit_keeps_the_old_avatar_and_removes_the_new_file(client, auth_headers, tmp_path,
                                                                           monkeypatch):
    first = (await upload(client, auth_headers, image(color=(5, 5, 5)))).json()["avatar_url"]

    async def broken_commit(self):
        raise RuntimeError("database is down")

    monkeypatch.setattr(AsyncSession, "commit", broken_commit)
    with pytest.raises(RuntimeError):
        await upload(client, auth_headers, image(color=(250, 0, 0)))
    monkeypatch.undo()
    assert stored_files(tmp_path) == [avatar_file(tmp_path, first).name]  # no orphan, the old file stays
    assert (await client.get("/api/me", headers=auth_headers)).json()["avatar_url"] == first


async def test_database_row_points_at_the_new_avatar(app, client, auth_headers):
    url = (await upload(client, auth_headers)).json()["avatar_url"]
    async with app.state.sessionmaker() as session:
        row = (await session.execute(select(User.avatar_id).where(User.username == "alice"))).scalar_one()
    assert url == f"/api/avatars/{row}"


async def test_logs_never_carry_the_avatar_id_or_the_storage_path(client, auth_headers, tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    url = (await upload(client, auth_headers)).json()["avatar_url"]
    await client.delete("/api/me/avatar", headers=auth_headers)
    avatar_id = ID_RE.fullmatch(url).group(1)
    assert any("avatar" in record.getMessage() for record in caplog.records)
    assert avatar_id not in caplog.text
    assert str(tmp_path) not in caplog.text
    assert ".webp" not in caplog.text


# ---- S5: public read ----

PUBLIC_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Security-Policy": "default-src 'none'",
}


async def test_public_read_needs_no_token_and_serves_the_stored_bytes(client, auth_headers, tmp_path):
    url = (await upload(client, auth_headers)).json()["avatar_url"]
    r = await client.get(url)  # an <img> cannot send a Bearer token
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/webp"
    assert r.content == avatar_file(tmp_path, url).read_bytes()
    for name, value in PUBLIC_HEADERS.items():
        assert r.headers[name] == value, name


async def test_a_replaced_avatar_url_is_gone(client, auth_headers):
    old = (await upload(client, auth_headers, image(color=(1, 2, 3)))).json()["avatar_url"]
    await upload(client, auth_headers, image(color=(9, 9, 9)))
    r = await client.get(old)
    assert r.status_code == 404
    assert r.json() == {"error": "Not Found"}


async def test_a_deleted_avatar_url_is_gone(client, auth_headers):
    url = (await upload(client, auth_headers)).json()["avatar_url"]
    await client.delete("/api/me/avatar", headers=auth_headers)
    r = await client.get(url)
    assert r.status_code == 404
    assert r.json() == {"error": "Not Found"}


async def test_unknown_but_well_formed_id_looks_exactly_like_a_missing_one(client):
    r = await client.get("/api/avatars/" + "f" * 32)
    assert r.status_code == 404
    assert r.json() == {"error": "Not Found"}


async def test_malformed_ids_are_404_before_any_path_is_built(client, auth_headers, tmp_path):
    await upload(client, auth_headers)
    for bad in ["0" * 31, "0" * 33, "A" * 32, "g" * 32, "..%2F..%2Fetc%2Fpasswd", "%2e%2e%2fsecret"]:
        r = await client.get(f"/api/avatars/{bad}")
        assert r.status_code == 404, bad
        assert r.json() == {"error": "Not Found"}, bad


async def test_switch_off_hides_reads_but_keeps_the_file(app, client, auth_headers, tmp_path):
    url = (await upload(client, auth_headers)).json()["avatar_url"]
    app.state.settings = app.state.settings.model_copy(update={"avatar_upload_enabled": False})
    assert (await client.get(url)).status_code == 404
    assert avatar_file(tmp_path, url).exists()  # kept for when the switch is back on (R-V3)
    app.state.settings = app.state.settings.model_copy(update={"avatar_upload_enabled": True})
    assert (await client.get(url)).status_code == 200


async def test_a_row_without_its_file_is_404(client, auth_headers, tmp_path):
    url = (await upload(client, auth_headers)).json()["avatar_url"]
    avatar_file(tmp_path, url).unlink()
    assert (await client.get(url)).status_code == 404


async def test_public_read_logs_never_carry_the_id(client, auth_headers, tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    url = (await upload(client, auth_headers)).json()["avatar_url"]
    assert (await client.get(url)).status_code == 200
    assert (await client.get("/api/avatars/" + "e" * 32)).status_code == 404
    assert ID_RE.fullmatch(url).group(1) not in caplog.text
    assert str(tmp_path) not in caplog.text
