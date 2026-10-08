import pytest

BODY = {"username": "alice", "password": "password123"}


@pytest.mark.parametrize("settings_overrides", [{"registration_mode": "closed"}], indirect=True)
async def test_closed_mode_rejects_registration(client):
    r = await client.post("/api/users", json=BODY)
    assert r.status_code == 403
    assert r.json()["error"] == "Registration is closed"


@pytest.mark.parametrize(
    "settings_overrides",
    [{"registration_mode": "invite", "invite_code": "letmein"}],
    indirect=True,
)
async def test_invite_mode_needs_the_right_code(client):
    assert (await client.post("/api/users", json=BODY)).status_code == 403
    assert (await client.post("/api/users", json={**BODY, "invite_code": "wrong"})).status_code == 403
    ok = await client.post("/api/users", json={**BODY, "invite_code": "letmein"})
    assert ok.status_code == 200


@pytest.mark.parametrize("settings_overrides", [{"registration_mode": "closed"}], indirect=True)
async def test_closed_mode_still_allows_login_of_existing_users(app, client):
    from app.models import User
    from app.core.security import hash_password

    async with app.state.sessionmaker() as session:
        session.add(User(id=12345678, username="bob", password_hash=hash_password("password123")))
        await session.commit()
    r = await client.post(
        "/api/sessions", json={"provider": "password", "username": "bob", "password": "password123"}
    )
    assert r.status_code == 200


@pytest.mark.parametrize("settings_overrides", [{"rate_limit_per_minute": 3}], indirect=True)
async def test_auth_endpoints_are_rate_limited(client):
    login = {"provider": "password", "username": "ghost", "password": "whatever1"}
    codes = [(await client.post("/api/sessions", json=login)).status_code for _ in range(5)]
    assert codes == [401, 401, 401, 429, 429]


@pytest.mark.parametrize("settings_overrides", [{"rate_limit_per_minute": 3}], indirect=True)
async def test_rate_limit_does_not_affect_other_endpoints(client):
    for _ in range(6):
        assert (await client.get("/up")).status_code == 200
