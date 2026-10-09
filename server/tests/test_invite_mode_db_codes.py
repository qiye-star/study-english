"""Integration (admin v2 §7): invite mode works with DB invite codes only — INVITE_CODE in .env is optional."""
from datetime import datetime, timezone

import pytest

from app.admin.doctor import gather_facts, diagnose
from app.models import UpstreamCall
from tests.admin_helpers import ADMIN_ENABLED, login_as


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED, "registration_mode": "invite", "invite_code": ""}


async def _register(client, name, code):
    return await client.post("/api/users", json={"username": name, "password": "password123", "invite_code": code})


async def test_invite_mode_without_env_code_uses_db_codes(app, client):
    assert (await _register(client, "nobody", "")).status_code == 403
    async with app.state.sessionmaker() as s:
        assert "invite_without_codes" in [f.code for f in diagnose(app.state.settings, await gather_facts(s, app))]
    h = await login_as(app, client, "operator")
    code = (await client.post("/api/admin/invites", headers=h, json={"label": "班级", "max_uses": 1})).json()["code"]
    async with app.state.sessionmaker() as s:
        assert "invite_without_codes" not in [f.code for f in diagnose(app.state.settings, await gather_facts(s, app))]
    assert (await _register(client, "user_b1", code)).status_code == 200
    assert (await _register(client, "user_b2", code)).status_code == 403
    assert (await _register(client, "user_b3", "")).status_code == 403  # an empty env code never matches


async def test_doctor_reports_models_without_prices(app, client):
    async with app.state.sessionmaker() as s:
        s.add(UpstreamCall(at=datetime.now(timezone.utc), kind="llm", provider="openai", model="mystery-model",
                           feature="chat", status=200, ms=10, units_in=1, unit="tokens"))
        await s.commit()
    async with app.state.sessionmaker() as s:
        facts = await gather_facts(s, app)
    assert facts.missing_prices == ("llm:mystery-model",)
    assert "missing_prices" in [f.code for f in diagnose(app.state.settings, facts)]
