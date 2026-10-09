import pytest

from tests.admin_helpers import ADMIN_ENABLED


@pytest.fixture
def settings_overrides(request):
    return getattr(request, "param", {**ADMIN_ENABLED, "admin_lockout_threshold": 3, "admin_lockout_minutes": 15})


async def test_lock_after_threshold_even_with_right_password(client):
    for _ in range(3):
        assert (await client.post("/api/admin/login", json={"username": "root", "password": "bad-password-1"})).status_code == 401
    r = await client.post("/api/admin/login", json={"username": "root", "password": "correct-horse-battery"})
    assert r.status_code == 429 and r.json() == {"error": "Too many attempts"}


async def test_unknown_usernames_are_counted_identically(client):
    for _ in range(3):
        await client.post("/api/admin/login", json={"username": "ghost", "password": "bad-password-1"})
    r = await client.post("/api/admin/login", json={"username": "ghost", "password": "bad-password-1"})
    assert r.status_code == 429


@pytest.mark.parametrize("settings_overrides", [{**ADMIN_ENABLED, "admin_ip_allowlist": "10.0.0.0/8"}], indirect=True)
async def test_ip_allowlist_hides_admin_entirely(client):
    assert (await client.post("/api/admin/login", json={"username": "root", "password": "x" * 12})).status_code == 404
    assert (await client.get("/admin")).status_code == 404
