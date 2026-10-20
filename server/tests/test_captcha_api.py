"""GET /api/captcha/config 与 /api/captcha/challenge(计划 S8;spec §6.1、§6.2、R-C12、R-C15)。

时间:挑战的过期由官方库按墙上时钟判断,所以这里用真实的 time.time()(见 test_captcha_core.py 的模块说明)。
"""
import logging
import time

import pytest

from app.core import captcha as captcha_module
from tests.captcha_helpers import SECRET, enable_captcha, header_for


async def test_config_reports_mode(app, client):
    r = await client.get("/api/captcha/config")
    assert r.status_code == 200 and r.json() == {"mode": "off"}
    assert r.headers["cache-control"] == "no-store"
    enable_captcha(app, "always")
    r = await client.get("/api/captcha/config")
    assert r.json() == {"mode": "always"}  # hot: the next request sees it


async def test_challenge_off_is_404(client):
    r = await client.get("/api/captcha/challenge")
    assert r.status_code == 404
    assert r.json() == {"error": "Captcha is off"}


async def test_challenge_without_secret_is_503(app, client):
    enable_captcha(app, "adaptive", captcha_secret="")
    r = await client.get("/api/captcha/challenge")
    assert r.status_code == 503
    assert r.json() == {"error": "Captcha is not configured"}


async def test_challenge_shape_and_no_store(app, client):
    enable_captcha(app, "adaptive")
    before = time.time()
    r = await client.get("/api/captcha/challenge")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"parameters", "signature"}
    assert body["parameters"]["cost"] == 1
    assert abs(body["parameters"]["expiresAt"] - (before + 300)) < 30
    assert r.headers["cache-control"] == "no-store"
    assert (await header_for(client))["X-Captcha"]  # a fresh one solves


@pytest.mark.parametrize("settings_overrides", [{"captcha_challenges_per_minute": 2}], indirect=True)
async def test_challenge_rate_limited_per_ip(app, client):
    enable_captcha(app, "adaptive")
    assert (await client.get("/api/captcha/challenge")).status_code == 200
    assert (await client.get("/api/captcha/challenge")).status_code == 200
    r = await client.get("/api/captcha/challenge")
    assert r.status_code == 429
    assert r.json() == {"error": "Too many requests, please try again later"}


async def test_challenge_limit_is_hot(app, client):
    enable_captcha(app, "adaptive")
    app.state.settings_hub.publish(app.state.settings.model_copy(update={"captcha_challenges_per_minute": 1}))
    assert (await client.get("/api/captcha/challenge")).status_code == 200
    assert (await client.get("/api/captcha/challenge")).status_code == 429


async def test_flagged_ip_gets_a_harder_challenge(app, client, monkeypatch):
    calls = []
    original = captcha_module.pick_counter

    def spy(counter_max, multiplier, flagged):
        calls.append((counter_max, multiplier, flagged))
        return original(counter_max, multiplier, flagged)

    monkeypatch.setattr(captcha_module, "pick_counter", spy)
    enable_captcha(app, "adaptive")
    assert (await client.get("/api/captcha/challenge")).status_code == 200
    assert calls[-1][2] is False
    # the test client's address is 127.0.0.1 (httpx ASGI default); record failures from it
    for i in range(app.state.settings.captcha_login_failures):
        app.state.login_failures.record("127.0.0.1", f"name{i}")
    assert (await client.get("/api/captcha/challenge")).status_code == 200
    assert calls[-1] == (10, 2, True)


async def test_routes_precede_stubs(client):
    r = await client.get("/api/captcha/config")
    assert r.status_code == 200 and "mode" in r.json()


def test_no_query_parameters(app):
    """隐私:两个公开端点没有任何查询参数(OpenAPI 里不应声明 parameters)。"""
    paths = app.openapi()["paths"]
    for path in ("/api/captcha/config", "/api/captcha/challenge"):
        assert not paths[path]["get"].get("parameters"), path


async def test_challenge_logs_nothing_secret(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    enable_captcha(app, "adaptive")
    r = await client.get("/api/captcha/challenge")
    body = r.json()
    hmac_secret, hmac_key_secret = captcha_module.derived_keys(SECRET)
    params = body["parameters"]
    for secret in (SECRET, hmac_secret, hmac_key_secret, params["nonce"], params["salt"], params["keySignature"],
                   body["signature"]):
        assert secret and secret not in caplog.text
