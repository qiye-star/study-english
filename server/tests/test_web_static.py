from pathlib import Path

import pytest

INDEX = '<!doctype html><div id="root"></div>'
IMMUTABLE = "public, max-age=31536000, immutable"


@pytest.fixture
def dist(tmp_path) -> Path:
    d = tmp_path / "dist"
    (d / "assets").mkdir(parents=True)
    (d / "index.html").write_text(INDEX, encoding="utf-8")
    (d / "assets" / "index-abc123.js").write_text("console.log(1)", encoding="utf-8")
    (d / "assets" / "index-abc123.css").write_text("body{}", encoding="utf-8")
    (d / "sw.js").write_text("self.addEventListener('fetch', () => {})", encoding="utf-8")
    (d / "manifest.webmanifest").write_text('{"name":"Enjoy"}', encoding="utf-8")
    (tmp_path / "secret.txt").write_text("TOP-SECRET", encoding="utf-8")
    return d


@pytest.fixture
def settings_overrides(dist):
    return {"web_dist_dir": str(dist)}


async def test_root_serves_index(client):
    r = await client.get("/")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    assert r.headers["cache-control"] == "no-cache"
    assert r.text == INDEX


@pytest.mark.parametrize("path", ["/practice", "/practice/history", "/chat/abc", "/me", "/login"])
async def test_spa_fallback(client, path):
    r = await client.get(path)
    assert r.status_code == 200
    assert r.text == INDEX
    assert r.headers["cache-control"] == "no-cache"


async def test_hashed_assets_are_immutable(client):
    js = await client.get("/assets/index-abc123.js")
    assert js.status_code == 200
    assert "javascript" in js.headers["content-type"]
    assert js.headers["cache-control"] == IMMUTABLE
    css = await client.get("/assets/index-abc123.css")
    assert css.headers["content-type"].startswith("text/css")


async def test_missing_asset_is_404(client):
    r = await client.get("/assets/nope.js")
    assert r.status_code == 404
    assert r.json() == {"error": "Not Found"}


@pytest.mark.parametrize("path", ["/api", "/api/nope", "/api/conversations/x/unknown"])
async def test_api_paths_never_fall_back(client, auth_headers, path):
    r = await client.get(path, headers=auth_headers)
    assert r.status_code == 404
    assert r.json() == {"error": "Not Found"}


async def test_health_and_api_unaffected(client, auth_headers):
    assert (await client.get("/up")).json() == {"status": "ok"}
    assert (await client.get("/api/me", headers=auth_headers)).status_code == 200
    # 兜底写入仍由 stubs 处理
    assert (await client.post("/api/whatever", headers=auth_headers, json={})).json() == {}


async def test_vad_runtime_files_have_module_and_wasm_types(client, dist, monkeypatch):
    """onnxruntime-web 用 import() 加载 .mjs:非 JS 类型时 Safari/Chrome 都拒绝执行(VAD 加载失败)。
    不依赖系统的 mimetypes 表(精简镜像没有 /etc/mime.types,Windows 注册表可能乱配)。"""
    import starlette.responses

    vad = dist / "vad" / "0.0.31-ort1.30.0"
    vad.mkdir(parents=True)
    (vad / "ort-wasm-simd-threaded.mjs").write_text("export default 1", encoding="utf-8")
    (vad / "ort-wasm-simd-threaded.wasm").write_bytes(b"\0asm\1\0\0\0")
    monkeypatch.setattr(starlette.responses, "guess_type", lambda *a, **k: (None, None))  # 系统表里没有这两种
    mjs = await client.get("/vad/0.0.31-ort1.30.0/ort-wasm-simd-threaded.mjs")
    assert mjs.status_code == 200
    assert mjs.headers["content-type"].startswith("text/javascript")
    wasm = await client.get("/vad/0.0.31-ort1.30.0/ort-wasm-simd-threaded.wasm")
    assert wasm.headers["content-type"] == "application/wasm"


async def test_service_worker_and_manifest(client):
    sw = await client.get("/sw.js")
    assert sw.status_code == 200
    assert "javascript" in sw.headers["content-type"]
    assert sw.headers["cache-control"] == "no-cache"
    manifest = await client.get("/manifest.webmanifest")
    assert manifest.headers["content-type"].startswith("application/manifest+json")


@pytest.mark.parametrize(
    "path",
    ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt", "/..%2fsecret.txt", "/%00", "/foo%00.js"],
)
async def test_no_path_traversal(client, path):
    r = await client.get(path)
    assert r.status_code in (200, 404)
    assert "TOP-SECRET" not in r.text
    if r.status_code == 200:
        assert r.text == INDEX


async def test_post_to_spa_path_not_allowed(client):
    assert (await client.post("/practice")).status_code == 405


async def test_head_root(client):
    assert (await client.head("/")).status_code == 200


async def test_missing_dist_reports_not_built(app, client, tmp_path):
    app.state.settings.web_dist_dir = str(tmp_path / "nowhere")
    r = await client.get("/practice")
    assert r.status_code == 404
    assert r.json() == {"error": "Web app is not built"}
    assert (await client.get("/up")).status_code == 200
