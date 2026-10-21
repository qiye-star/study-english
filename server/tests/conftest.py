import contextlib
import os
import shutil
import tempfile

import httpx
import pytest

from app.core.config import Settings
from app.core.db import Base
from app.main import create_app
from tests.background import cancel_background, drain_background

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:")


def pytest_configure(config):
    """A private tmp_path root per session. pytest's default root (%TEMP%/pytest-of-<user>/pytest-N) is shared and
    rotated by every concurrent session (two halves of this suite, or another checkout), which on Windows left
    half-deleted `garbage-*` dirs behind."""
    if config.option.basetemp is None:
        config.option.basetemp = tempfile.mkdtemp(prefix="enjoy-server-pytest-")
        config.stash[_OWN_BASETEMP] = config.option.basetemp


def pytest_unconfigure(config):
    own = config.stash.get(_OWN_BASETEMP, None)
    if own:
        shutil.rmtree(own, ignore_errors=True)


_OWN_BASETEMP = pytest.StashKey[str]()


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
        # accounts v2 (INDEX X11): most tests register with username + password; the email-registration tests
        # switch it on explicitly
        email_registration_required=False,
    )
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.fixture
def settings_overrides(request):
    return getattr(request, "param", {})


@pytest.fixture
def storage_backend(request):
    """Object store behind `app.state.storage` for this test: "local" (default) or "s3" (moto). Parametrize with
    `indirect=True` to run a test on both (plan 2026-10-21-l1-object-storage R16)."""
    return getattr(request, "param", "local")


@pytest.fixture
async def app(settings_overrides, storage_backend):
    application = create_app(make_settings(**settings_overrides))
    with contextlib.ExitStack() as stack:
        if storage_backend == "s3":
            from tests.storage_helpers import moto_bucket, s3_store

            application.state.storage = s3_store(stack.enter_context(moto_bucket()))
        async with application.state.engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        yield application
        try:  # background tasks share the one StaticPool connection: finish them BEFORE the engine goes (tests/background.py)
            await drain_background(application, timeout=3.0)
        except TimeoutError:
            pass
        await cancel_background(application)
        await application.state.http.aclose()
        await application.state.engine.dispose()


@pytest.fixture
def store(app):
    from app.storage import get_store

    return get_store(app)


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
