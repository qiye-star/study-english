import os

import httpx
import pytest

from app.config import Settings
from app.db import Base
from app.main import create_app

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:")


def make_settings(**overrides) -> Settings:
    values = dict(
        database_url=TEST_DATABASE_URL,
        rate_limit_per_minute=1000,
        llm_models="gpt-4o-mini,gpt-4o",
        default_llm_model="gpt-4o",
        tts_models="openai/tts-1,azure/speech",
        upstream_llm_base_url="https://llm.test/v1",
        upstream_llm_key="llm-secret",
        upstream_tts_base_url="https://tts.test/v1",
        upstream_tts_key="tts-secret",
        upstream_whisper_base_url="https://whisper.test/v1",
        upstream_whisper_key="wh-secret",
        azure_speech_key="az-secret",
        azure_speech_region="eastus",
    )
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.fixture
def settings_overrides(request):
    return getattr(request, "param", {})


@pytest.fixture
async def app(settings_overrides):
    application = create_app(make_settings(**settings_overrides))
    async with application.state.engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield application
    await application.state.http.aclose()
    await application.state.engine.dispose()


@pytest.fixture
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def auth_headers(client):
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}
