import pytest

async def test_lookup_returns_pending_record(client, auth_headers):
    r = await client.post(
        "/api/lookups",
        json={"word": "hello", "context": "hello world", "native_language": "zh-CN"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["id"] and body["word"] == "hello" and body["context"] == "hello world"
    assert body["status"] == "pending"
    assert body["meaning"] is None and body["meaning_options"] == []


async def test_lookup_requires_auth(client):
    r = await client.post("/api/lookups", json={"word": "a", "context": "b"})
    assert r.status_code == 401


async def test_update_lookup_is_acknowledged(client, auth_headers):
    r = await client.put("/api/lookups/abc", json={"meaning": {"word": "a"}}, headers=auth_headers)
    assert r.status_code == 200 and r.json() == {}


async def test_translations_list_is_empty(client, auth_headers):
    r = await client.get(
        "/api/translations", params={"md5": "x", "translated_language": "zh-CN"}, headers=auth_headers
    )
    assert r.status_code == 200
    assert r.json() == {"translations": [], "page": 1, "next": None, "last": 1}


async def test_create_translation_is_acknowledged(client, auth_headers):
    r = await client.post("/api/translations", json={"md5": "x"}, headers=auth_headers)
    assert r.status_code == 200 and r.json() == {}


async def test_sync_writes_are_accepted_and_discarded(client, auth_headers):
    for method, path in [
        ("POST", "/api/mine/recordings"),
        ("POST", "/api/mine/pronunciation_assessments"),
        ("DELETE", "/api/mine/audios/1"),
        ("POST", "/api/notes"),
    ]:
        r = await client.request(method, path, json={"x": 1}, headers=auth_headers)
        assert r.status_code == 200 and r.json() == {}, (method, path)


async def test_sync_writes_require_auth(client):
    assert (await client.post("/api/mine/recordings", json={})).status_code == 401


async def test_unknown_get_is_404_not_405(client, auth_headers):
    for headers in (auth_headers, {}):
        r = await client.get("/api/posts", headers=headers)
        assert r.status_code == 404
        assert r.json() == {"error": "Not Found"}


async def test_catch_all_does_not_shadow_login(client):
    await client.post("/api/users", json={"username": "alice", "password": "password123"})
    r = await client.post(
        "/api/sessions", json={"provider": "password", "username": "alice", "password": "password123"}
    )
    assert r.status_code == 200 and r.json()["access_token"]


async def test_enrollments_and_transcriptions_require_auth(client):
    for path in ("/api/enrollments", "/api/transcriptions"):
        assert (await client.get(path)).status_code == 401


@pytest.mark.parametrize(
    "path,key,params",
    [
        ("/api/enrollments", "enrollments", {"page": 2, "items": 5}),
        ("/api/transcriptions", "transcriptions", {"target_md5": "abc", "items": 10}),
    ],
)
async def test_enrollments_and_transcriptions_are_empty_pages(client, auth_headers, path, key, params):
    for p in (None, params):
        r = await client.get(path, params=p, headers=auth_headers)
        assert r.status_code == 200
        assert r.json() == {key: [], "page": 1, "next": None, "last": 1}
