"""昵称的 HTTP 端点:PATCH /api/me、注册可选昵称、/api/me 字段(计划 S6;R-F12、INDEX X7、X8)。"""
import logging

from tests.test_admin_api import register


async def test_patch_me_sets_and_clears_nickname(client):
    _uid, headers = await register(client, "alice")
    r = await client.patch("/api/me", headers=headers, json={"nickname": "小明"})
    assert r.status_code == 200, r.text

    me = (await client.get("/api/me", headers=headers)).json()
    assert me["nickname"] == "小明"
    assert me["display_name"] == "小明"
    assert me["name"] == "alice"  # X7: the login name stays in `name`

    r = await client.patch("/api/me", headers=headers, json={"nickname": None})
    assert r.status_code == 200, r.text
    me = (await client.get("/api/me", headers=headers)).json()
    assert "nickname" not in me  # response_model_exclude_none: absent when unset
    assert me["display_name"] == "alice"


async def test_patch_me_requires_a_token(client):
    r = await client.patch("/api/me", json={"nickname": "小明"})
    assert r.status_code == 401


async def test_invalid_nickname_is_422_without_echo(client):
    _uid, headers = await register(client, "alice")
    r = await client.patch("/api/me", headers=headers, json={"nickname": "@SecretNick"})
    assert r.status_code == 422
    assert "SecretNick" not in r.text
    assert "error" in r.json()


async def test_patch_me_reserved_nickname_is_422(client):
    _uid, headers = await register(client, "alice")
    r = await client.patch("/api/me", headers=headers, json={"nickname": "AI 助手"})
    assert r.status_code == 422


async def test_nickname_rate_limit(client):
    _uid, headers = await register(client, "alice")
    for i in range(10):
        r = await client.patch("/api/me", headers=headers, json={"nickname": f"n{i}"})
        assert r.status_code == 200, r.text
    r = await client.patch("/api/me", headers=headers, json={"nickname": "n-over"})
    assert r.status_code == 429
    assert r.json() == {"error": "Too many requests, please try again later"}


async def test_register_accepts_optional_nickname(client):
    r = await client.post("/api/users", json={"username": "bob", "password": "password123", "nickname": "鲍勃"})
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    me = (await client.get("/api/me", headers=headers)).json()
    assert me["nickname"] == "鲍勃"
    assert me["display_name"] == "鲍勃"


async def test_register_without_nickname_still_works(client):
    r = await client.post("/api/users", json={"username": "carl", "password": "password123"})
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    me = (await client.get("/api/me", headers=headers)).json()
    assert "nickname" not in me
    assert me["display_name"] == "carl"


async def test_register_rejects_invalid_nickname(client):
    r = await client.post("/api/users", json={"username": "dana", "password": "password123", "nickname": "助手"})
    assert r.status_code == 422
    assert "助手" not in r.text


async def test_nickname_never_logged(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    _uid, headers = await register(client, "erin")
    assert (await client.patch("/api/me", headers=headers, json={"nickname": "秘密昵称"})).status_code == 200
    assert (await client.patch("/api/me", headers=headers, json={"nickname": "@BadNick"})).status_code == 422
    assert "秘密昵称" not in caplog.text
    assert "BadNick" not in caplog.text


# --- S6b: a nickname may not impersonate another login name or an official word ---------------------------------

async def test_nickname_equal_to_own_username_is_allowed(client):
    _uid, headers = await register(client, "alice")
    r = await client.patch("/api/me", headers=headers, json={"nickname": "alice"})
    assert r.status_code == 200, r.text
    r = await client.patch("/api/me", headers=headers, json={"nickname": "ALICE"})
    assert r.status_code == 200, r.text


async def test_nickname_equal_to_another_username_is_422_same_text(client):
    await register(client, "bobby")
    _uid, headers = await register(client, "alice")
    bad_shape = await client.patch("/api/me", headers=headers, json={"nickname": "@x"})
    taken = await client.patch("/api/me", headers=headers, json={"nickname": "bobby"})
    assert taken.status_code == 422
    assert taken.json() == bad_shape.json()  # the failing rule is not revealed
    assert "bobby" not in taken.text
    me = (await client.get("/api/me", headers=headers)).json()
    assert "nickname" not in me


async def test_another_username_check_is_case_insensitive(client):
    await register(client, "bobby")
    _uid, headers = await register(client, "alice")
    for variant in ("Bobby", "BOBBY", "  bobby "):
        r = await client.patch("/api/me", headers=headers, json={"nickname": variant})
        assert r.status_code == 422, variant
        assert "obby" not in r.text


async def test_official_words_are_422_on_patch(client):
    _uid, headers = await register(client, "alice")
    for word in ("admin", "Admin", "ROOT", "官方", "客服", "系统"):
        r = await client.patch("/api/me", headers=headers, json={"nickname": word})
        assert r.status_code == 422, word
        assert word not in r.text


async def test_register_nickname_equal_to_another_username_is_422(client):
    await register(client, "bobby")
    bad_shape = await client.post("/api/users", json={"username": "x1x", "password": "password123", "nickname": "@x"})
    r = await client.post("/api/users", json={"username": "carol", "password": "password123", "nickname": "Bobby"})
    assert r.status_code == 422
    assert r.json() == bad_shape.json()
    assert "obby" not in r.text
    # nothing was created
    r = await client.post("/api/sessions", json={"username": "carol", "password": "password123"})
    assert r.status_code == 401


async def test_register_nickname_equal_to_own_new_username_is_allowed(client):
    r = await client.post("/api/users", json={"username": "dave", "password": "password123", "nickname": "Dave"})
    assert r.status_code == 200, r.text


async def test_register_official_nickname_is_422(client):
    r = await client.post("/api/users", json={"username": "erin2", "password": "password123", "nickname": "Admin"})
    assert r.status_code == 422


async def test_impersonation_guard_logs_nothing(app, client, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    await register(client, "victimname")
    _uid, headers = await register(client, "mallory")
    assert (await client.patch("/api/me", headers=headers, json={"nickname": "victimname"})).status_code == 422
    assert (await client.patch("/api/me", headers=headers, json={"nickname": "官方"})).status_code == 422
    assert "victimname" not in caplog.text
    assert "官方" not in caplog.text
