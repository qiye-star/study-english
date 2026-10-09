import pytest
from sqlalchemy import update

from app.models import AdminAudit
from tests.admin_helpers import ADMIN_ENABLED, login_as


@pytest.fixture
def settings_overrides(request):
    return {**ADMIN_ENABLED, **getattr(request, "param", {})}


async def test_viewer_sees_only_own_entries_and_operator_verifies(app, client):
    await login_as(app, client, "superadmin", "boss")
    client.cookies.clear()
    await login_as(app, client, "viewer", "vic")
    items = (await client.get("/api/admin/audit")).json()["items"]
    assert items and {i["actor"] for i in items} == {"vic"}
    r = await client.get("/api/admin/audit", params={"actor": "boss"})
    assert {i["actor"] for i in r.json()["items"]} == {"vic"}
    assert (await client.get("/api/admin/audit/verify")).status_code == 403
    client.cookies.clear()
    await login_as(app, client, "operator", "ops")
    assert {i["actor"] for i in (await client.get("/api/admin/audit")).json()["items"]} >= {"boss", "vic", "ops"}
    assert (await client.get("/api/admin/audit/verify")).json() == {"ok": True, "broken_at": None}


async def test_filters_pagination_prefix_and_broken_chain(app, client):
    await login_as(app, client, "superadmin", "boss")
    await client.post("/api/admin/login", json={"username": "boss", "password": "wrong-password-1"})
    r = await client.get("/api/admin/audit", params={"action_prefix": "auth.login."})
    actions = {i["action"] for i in r.json()["items"]}
    assert actions == {"auth.login.fail"}
    assert (await client.get("/api/admin/audit", params={"action_prefix": "auth%"})).status_code == 400
    page = (await client.get("/api/admin/audit", params={"limit": 1})).json()
    assert len(page["items"]) == 1 and page["next_before_id"] is not None
    older = (await client.get("/api/admin/audit", params={"limit": 1, "before_id": page["next_before_id"]})).json()
    assert older["items"][0]["id"] < page["items"][0]["id"]
    async with app.state.sessionmaker() as s:
        await s.execute(update(AdminAudit).where(AdminAudit.id == 1).values(summary="tampered"))
        await s.commit()
    assert (await client.get("/api/admin/audit/verify")).json() == {"ok": False, "broken_at": 1}
