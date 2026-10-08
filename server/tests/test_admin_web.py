from pathlib import Path

import pytest

ENABLED = {"admin_username": "root", "admin_password": "correct-horse-battery"}


@pytest.fixture
def dists(tmp_path) -> tuple[Path, Path]:
    admin = tmp_path / "admin-dist"
    (admin / "assets").mkdir(parents=True)
    (admin / "index.html").write_text("<html>ADMIN</html>", encoding="utf-8")
    (admin / "assets" / "app.js").write_text("console.log('admin')", encoding="utf-8")
    web = tmp_path / "web-dist"
    web.mkdir()
    (web / "index.html").write_text("<html>WEB</html>", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("top secret", encoding="utf-8")
    return admin, web


@pytest.fixture
def settings_overrides(request, dists):
    admin, web = dists
    if hasattr(request, "param"):
        return {"admin_dist_dir": str(admin), "web_dist_dir": str(web), **request.param}
    return {**ENABLED, "admin_dist_dir": str(admin), "web_dist_dir": str(web)}


@pytest.mark.parametrize("path", ["/admin", "/admin/", "/admin/users/12", "/admin/assessments/abc"])
async def test_admin_spa_and_deep_links(client, path):
    r = await client.get(path)
    assert r.status_code == 200 and "ADMIN" in r.text
    assert r.headers["cache-control"] == "no-cache"


async def test_assets_are_immutable_and_missing_assets_404(client):
    r = await client.get("/admin/assets/app.js")
    assert r.status_code == 200 and r.headers["cache-control"].startswith("public, max-age=31536000")
    assert (await client.get("/admin/assets/nope.js")).status_code == 404


@pytest.mark.parametrize("path", ["/admin/../secret.txt", "/admin/%2e%2e/secret.txt", "/admin/..%2fsecret.txt"])
async def test_no_directory_escape(client, path):
    r = await client.get(path)
    assert "top secret" not in r.text


async def test_user_web_app_still_served_at_root(client):
    r = await client.get("/")
    assert "WEB" in r.text
    assert "WEB" in (await client.get("/practice")).text


async def test_admin_not_built_reports_404(app, client, tmp_path):
    app.state.settings.admin_dist_dir = str(tmp_path / "nowhere")
    assert (await client.get("/admin")).status_code == 404


@pytest.mark.parametrize("settings_overrides", [{}], indirect=True)
async def test_disabled_admin_is_404_and_does_not_fall_through_to_web(client):
    r = await client.get("/admin")
    assert r.status_code == 404
