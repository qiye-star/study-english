"""Storage wiring: settings, build_store / install / get_store, error mapping (plan L1 Task 4)."""
import pytest

from app.core import log_buffer
from app.core.config import Settings
from app.core.settings_registry import ENV_ONLY, SECRETS, SPECS
from app.main import create_app
from app.storage import StorageError, get_store
from app.storage.local import LocalStore
from app.storage.s3 import S3Store
from tests.conftest import make_settings

STORAGE_FIELDS = (
    "storage_backend", "storage_fallback",
    "s3_endpoint", "s3_bucket", "s3_access_key", "s3_secret_key", "s3_region", "s3_path_style",
    "s3_fallback_endpoint", "s3_fallback_bucket", "s3_fallback_access_key", "s3_fallback_secret_key",
    "s3_fallback_region", "s3_fallback_path_style",
)
S3_SECRET_FIELDS = ("s3_access_key", "s3_secret_key", "s3_fallback_access_key", "s3_fallback_secret_key")


def test_fourteen_storage_settings_exist_and_are_env_only():
    for key in STORAGE_FIELDS:
        assert key in Settings.model_fields, key
        assert key in ENV_ONLY, key
        assert SPECS[key].group == "ops", key
        assert SPECS[key].apply == "restart", key


def test_the_four_storage_keys_are_secrets_and_nothing_else_is():
    assert set(S3_SECRET_FIELDS) <= SECRETS
    assert not (set(STORAGE_FIELDS) - set(S3_SECRET_FIELDS)) & SECRETS


def test_default_backend_is_local_and_rooted_at_the_data_directory(tmp_path):
    app = create_app(make_settings(data_dir=str(tmp_path / "data")))
    store = get_store(app)
    assert isinstance(store, LocalStore)
    assert store.root == app.state.settings.resolved_data_dir


def test_s3_backend_without_a_bucket_is_refused_with_key_names_only():
    with pytest.raises(RuntimeError) as caught:
        create_app(make_settings(storage_backend="s3", s3_access_key="SECRET-AK-1", s3_secret_key="SECRET-SK-1"))
    message = str(caught.value)
    assert "S3_BUCKET" in message
    assert "SECRET" not in message


def test_s3_backend_without_keys_is_refused_with_key_names_only():
    with pytest.raises(RuntimeError) as caught:
        create_app(make_settings(storage_backend="s3", s3_bucket="enjoy"))
    assert "S3_ACCESS_KEY" in str(caught.value)


def test_s3_backend_builds_an_s3_store_from_settings():
    app = create_app(make_settings(storage_backend="s3", s3_bucket="enjoy", s3_access_key="AK",
                                   s3_secret_key="SK", s3_region="us-east-1", s3_path_style=True))
    store = get_store(app)
    assert isinstance(store, S3Store)
    assert "enjoy" not in repr(store)


def test_get_store_reads_app_state_every_time(tmp_path):
    app = create_app(make_settings(data_dir=str(tmp_path / "data")))
    replacement = object()
    app.state.storage = replacement
    assert get_store(app) is replacement


async def test_a_storage_outage_becomes_503_with_a_fixed_message(tmp_path):
    from httpx import ASGITransport, AsyncClient

    app = create_app(make_settings(data_dir=str(tmp_path / "data")))

    @app.get("/api/storage-probe-test")
    async def boom():  # noqa: D401  (test-only route)
        raise StorageError("unavailable", "bucket-name and key must not leak")

    app.router.routes.insert(0, app.router.routes.pop())  # ahead of the catch-all API routes registered by create_app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/storage-probe-test")
    assert response.status_code == 503
    assert response.json() == {"error": "Storage unavailable"}
    assert "bucket" not in response.text


def test_env_example_documents_every_storage_setting():
    from pathlib import Path

    text = (Path(__file__).resolve().parents[1] / ".env.example").read_text(encoding="utf-8")
    for key in STORAGE_FIELDS:
        assert f"{key.upper()}=" in text, key
    assert "S3_PATH_STYLE=true" in text  # the MinIO hint lives next to the placeholders
    assert "S3_SECRET_KEY=\n" in text  # placeholders only: no real key in the tracked example


def test_redaction_removes_the_current_s3_secret_value():
    secret = "SECRET-SK-redact-me"
    log_buffer.set_secrets([secret])
    try:
        assert secret not in log_buffer.redact(f"token {secret} end", frozenset([secret]))
    finally:
        log_buffer.set_secrets([])


def test_a_fallback_must_differ_from_the_primary_backend(tmp_path):
    with pytest.raises(RuntimeError) as caught:
        create_app(make_settings(data_dir=str(tmp_path), storage_fallback="local"))
    assert "must differ" in str(caught.value)


def test_a_local_primary_with_an_s3_fallback_needs_the_fallback_keys(tmp_path):
    with pytest.raises(RuntimeError) as caught:
        create_app(make_settings(data_dir=str(tmp_path), storage_fallback="s3_fallback",
                                 s3_fallback_bucket="old", s3_fallback_access_key="AK"))
    assert "S3_FALLBACK_SECRET_KEY" in str(caught.value)


def test_an_s3_primary_may_fall_back_to_local_and_the_wrapper_is_installed(tmp_path):
    from app.storage.fallback import FallbackStore

    app = create_app(make_settings(data_dir=str(tmp_path), storage_backend="s3", s3_bucket="enjoy",
                                   s3_access_key="AK", s3_secret_key="SK", storage_fallback="local"))
    store = get_store(app)
    assert isinstance(store, FallbackStore)
    assert isinstance(store.primary, S3Store) and isinstance(store.secondary, LocalStore)


def test_the_fallback_cannot_point_at_the_same_s3_bucket(tmp_path):
    with pytest.raises(RuntimeError) as caught:
        create_app(make_settings(data_dir=str(tmp_path), storage_backend="s3", s3_bucket="enjoy",
                                 s3_access_key="AK", s3_secret_key="SK", storage_fallback="s3_fallback",
                                 s3_fallback_bucket="enjoy", s3_fallback_access_key="AK",
                                 s3_fallback_secret_key="SK"))
    assert "different endpoint or bucket" in str(caught.value)


def test_the_compose_example_has_an_optional_minio_profile_bound_to_localhost():
    """plan L1 Task 24: MinIO and its bucket bootstrap sit behind the `minio` profile, bind to 127.0.0.1 only, and
    never carry a real password (only the placeholders); the server waits for the bootstrap only when it runs."""
    from pathlib import Path

    import yaml

    compose = yaml.safe_load((Path(__file__).resolve().parents[2] / "docker-compose.example.yml").read_text("utf-8"))
    services = compose["services"]
    assert services["minio"]["profiles"] == ["minio"] and services["minio-init"]["profiles"] == ["minio"]
    for port in services["minio"]["ports"]:
        assert str(port).startswith("127.0.0.1:")
    assert services["server"]["depends_on"]["minio-init"]["required"] is False
    assert "change-me-minio" in services["minio"]["environment"]["MINIO_ROOT_PASSWORD"]  # placeholder only
