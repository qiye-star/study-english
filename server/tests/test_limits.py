import httpx
import pytest


@pytest.mark.parametrize("settings_overrides", [{"ai_rate_limit_per_minute": 2}], indirect=True)
async def test_ai_routes_are_rate_limited_per_user(client, auth_headers, respx_mock):
    respx_mock.post("https://llm.test/v1/chat/completions").mock(return_value=httpx.Response(200, json={}))
    for _ in range(2):
        r = await client.post("/api/ai/chat/completions", json={"model": "gpt-4o"}, headers=auth_headers)
        assert r.status_code == 200
    r = await client.post("/api/ai/chat/completions", json={"model": "gpt-4o"}, headers=auth_headers)
    assert r.status_code == 429 and "error" in r.json()
    r = await client.post("/api/ai/audio/speech", json={"input": "x", "model": "tts-1"}, headers=auth_headers)
    assert r.status_code == 429
    r = await client.post("/api/speech/tokens", json={}, headers=auth_headers)
    assert r.status_code == 429
    # 其他用户不受影响
    r2 = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    bob = {"Authorization": f"Bearer {r2.json()['access_token']}"}
    r = await client.post("/api/ai/chat/completions", json={"model": "gpt-4o"}, headers=bob)
    assert r.status_code == 200


async def test_unauthenticated_gets_401_not_429(client):
    r = await client.post("/api/ai/chat/completions", json={})
    assert r.status_code == 401


async def test_login_field_length_limits(client):
    r = await client.post("/api/sessions", json={"username": "a" * 65, "password": "x"})
    assert r.status_code == 422
    r = await client.post("/api/sessions", json={"username": "alice", "password": "x" * 129})
    assert r.status_code == 422


async def test_oversized_json_body_is_413(client, auth_headers):
    r = await client.post(
        "/api/ai/chat/completions",
        content=b"{" + b" " * (1024 * 1024 + 10) + b"}",
        headers={**auth_headers, "content-type": "application/json"},
    )
    assert r.status_code == 413 and r.json() == {"error": "Request body too large"}


async def test_multipart_is_exempt_from_small_limit(client, auth_headers, respx_mock):
    respx_mock.post("https://whisper.test/v1/audio/transcriptions").mock(
        return_value=httpx.Response(200, json={"text": "ok"})
    )
    r = await client.post(
        "/api/ai/audio/transcriptions",
        files={"file": ("a.mp3", b"x" * (2 * 1024 * 1024), "audio/mpeg")},
        data={"model": "whisper-1"},
        headers=auth_headers,
    )
    assert r.status_code == 200
