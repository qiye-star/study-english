import pytest

from app.main import create_app
from tests.conftest import make_settings


async def test_health(client):
    r = await client.get("/up")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_unknown_route_uses_error_envelope(client):
    r = await client.get("/api/nope")
    assert r.status_code == 404
    assert "error" in r.json()


def test_invite_mode_requires_code():
    with pytest.raises(RuntimeError, match="INVITE_CODE"):
        create_app(make_settings(registration_mode="invite", invite_code=""))


def test_default_model_must_be_listed():
    with pytest.raises(RuntimeError, match="DEFAULT_LLM_MODEL"):
        create_app(make_settings(llm_models="gpt-4o-mini", default_llm_model="gpt-4o"))
