"""Storage privacy rules (plan L1 Task 18): no bucket, endpoint, key, credential or user id in logs, error strings or
repr, on success, on the normal miss paths, and on every failure path the layer can take.

Every test that asserts absence also asserts presence (a capture check or the layer's own log line), so a logging
setup that captures nothing cannot make these tests pass."""
import logging
import re

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError
from httpx import ASGITransport, AsyncClient

from app.library import paths
from app.main import create_app
from app.storage import BlobNotFound, StorageError
from app.storage.fallback import FallbackStore
from app.storage.local import LocalStore
from app.storage.s3 import S3Store
from tests.conftest import make_settings
from tests.storage_helpers import moto_bucket, s3_store

BUCKET = "bucket-secret-marker"
KEY = "library/7/secret-item-marker/media.mp4"
ENDPOINT = "https://SECRET-ENDPOINT-marker.test"
MARKERS = ("bucket-secret-marker", "secret-item-marker", "SECRET-AK-marker", "SECRET-SK-marker",
           "https://SECRET-ENDPOINT-marker.test", "7/secret-item")


@pytest.fixture
def s3(caplog):
    caplog.set_level(logging.DEBUG)  # everything the layer logs at any level is inspected below
    with moto_bucket(BUCKET):
        yield s3_store(BUCKET)


def _assert_clean(*texts: str) -> None:
    for text in texts:
        for marker in MARKERS:
            assert marker not in text, marker


def _capture_is_live(caplog) -> None:
    """Positive control: a record from the storage logger must reach caplog, or the absence checks mean nothing."""
    logging.getLogger("app.storage").warning("capture check")
    assert "capture check" in caplog.text


def _layer_line(caplog, pattern: str) -> None:
    """The layer's own log line (op and code only) must have been captured for this failure."""
    assert re.search(pattern, caplog.text), pattern


async def test_success_and_normal_misses_log_nothing_identifying(s3, caplog):
    await s3.put_bytes(KEY, b"media")
    assert await s3.get_bytes(KEY) == b"media"
    assert await s3.stat("library/7/none/x.mp4") is None
    assert await s3.delete("library/7/none/x.mp4") is False
    _capture_is_live(caplog)
    _assert_clean(caplog.text, repr(s3))


async def test_failures_carry_codes_not_bucket_or_key(s3, caplog, monkeypatch):
    def denied(**kwargs):
        raise ClientError({"Error": {"Code": "AccessDenied", "Message": f"{BUCKET} {KEY}"}}, "HeadObject")

    monkeypatch.setattr(s3._client, "head_object", denied)
    with pytest.raises(StorageError) as caught:
        await s3.get_bytes(KEY)
    assert caught.value.code == "denied"
    _layer_line(caplog, r"storage op=\w+ code=denied")
    _assert_clean(str(caught.value), caplog.text)


async def test_connection_failures_never_echo_the_endpoint(s3, caplog, monkeypatch):
    def down(**kwargs):
        raise EndpointConnectionError(endpoint_url=ENDPOINT + "/" + BUCKET)

    monkeypatch.setattr(s3._client, "head_object", down)
    with pytest.raises(StorageError) as caught:
        await s3.stat(KEY)
    assert caught.value.code == "unavailable"
    _layer_line(caplog, r"storage op=\w+ code=unavailable")
    _assert_clean(str(caught.value), caplog.text)


async def test_a_missing_object_is_a_plain_miss_without_its_key(s3, caplog):
    with pytest.raises(BlobNotFound) as caught:
        await s3.get_bytes(KEY)
    _capture_is_live(caplog)
    _assert_clean(str(caught.value), caplog.text)


async def test_a_raw_no_such_key_from_the_sdk_is_the_same_plain_miss(s3, caplog, monkeypatch):
    await s3.put_bytes(KEY, b"media")

    def no_such_key(**kwargs):
        raise ClientError({"Error": {"Code": "NoSuchKey", "Message": f"{BUCKET} {KEY}"}}, "GetObject")

    monkeypatch.setattr(s3._client, "get_object", no_such_key)
    with pytest.raises(BlobNotFound) as caught:
        await s3.open_range(KEY, 0, 10)
    _capture_is_live(caplog)
    _assert_clean(str(caught.value), caplog.text)


async def test_credentials_and_endpoint_stay_out_of_errors_repr_and_logs(caplog, monkeypatch):
    caplog.set_level(logging.DEBUG)
    store = S3Store.from_settings(endpoint=ENDPOINT, bucket=BUCKET, access_key="SECRET-AK-marker",
                                  secret_key="SECRET-SK-marker", region="us-east-1", path_style=True)

    def refused(**kwargs):
        raise ClientError({"Error": {"Code": "InvalidAccessKeyId",
                                     "Message": f"{ENDPOINT} {BUCKET} SECRET-AK-marker SECRET-SK-marker"}},
                          "PutObject")

    monkeypatch.setattr(store._client, "put_object", refused)
    with pytest.raises(StorageError) as caught:
        await store.put_bytes(KEY, b"media")
    assert caught.value.code == "denied"
    _layer_line(caplog, r"storage op=put_bytes code=denied")
    _assert_clean(str(caught.value), caplog.text, repr(store))


async def test_a_storage_outage_answers_503_with_a_fixed_body_and_no_leak(tmp_path, caplog):
    caplog.set_level(logging.DEBUG)
    app = create_app(make_settings(data_dir=str(tmp_path / "data")))

    @app.get("/api/storage-privacy-probe")
    async def boom():  # test-only route
        raise StorageError("unavailable", f"{BUCKET} {KEY} {ENDPOINT}")

    app.router.routes.insert(0, app.router.routes.pop())  # ahead of the catch-all API routes
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/storage-privacy-probe")
    assert response.status_code == 503
    assert response.json() == {"error": "Storage unavailable"}
    _capture_is_live(caplog)
    _assert_clean(response.text, caplog.text)


async def test_fallback_hits_log_the_operation_only(tmp_path, s3, caplog):
    await s3.put_bytes(KEY, b"old")
    store = FallbackStore(LocalStore(tmp_path / "new"), s3)
    assert await store.get_bytes(KEY) == b"old"
    assert store.hits == 1
    hit_lines = [r.getMessage() for r in caplog.records if "fallback hit" in r.getMessage()]
    assert hit_lines == ["storage fallback hit op=get_bytes"]
    _assert_clean(caplog.text)


async def test_a_failed_library_delete_logs_the_class_and_code_only(s3, caplog, monkeypatch, tmp_path):
    await s3.put_bytes(KEY, b"media")

    async def broken(prefix):
        raise StorageError("unavailable", f"{BUCKET} {prefix}")

    monkeypatch.setattr(s3, "delete_prefix", broken)
    await paths.remove_item_files(s3, tmp_path, 7, "11111111-2222-4333-8444-555555555555")
    lines = [r.getMessage() for r in caplog.records if "library delete failed" in r.getMessage()]
    assert lines == ["library delete failed op=delete_prefix code=unavailable"]
    _assert_clean(caplog.text)
