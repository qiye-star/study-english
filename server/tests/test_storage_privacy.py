"""Storage privacy rules (plan L1 Task 18): no bucket, endpoint, key, credential or user id in logs, error strings or
repr, on success, on the normal miss paths, and on every failure path the layer can take."""
import logging

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from app.library import paths
from app.storage import BlobNotFound, StorageError
from app.storage.fallback import FallbackStore
from app.storage.local import LocalStore
from tests.storage_helpers import moto_bucket, s3_store

BUCKET = "bucket-secret-marker"
KEY = "library/7/secret-item-marker/media.mp4"
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


async def test_success_and_normal_misses_log_nothing_identifying(s3, caplog):
    await s3.put_bytes(KEY, b"media")
    assert await s3.get_bytes(KEY) == b"media"
    assert await s3.stat("library/7/none/x.mp4") is None
    assert await s3.delete("library/7/none/x.mp4") is False
    _assert_clean(caplog.text, repr(s3))


async def test_failures_carry_codes_not_bucket_or_key(s3, caplog, monkeypatch):
    def denied(**kwargs):
        raise ClientError({"Error": {"Code": "AccessDenied", "Message": f"{BUCKET} {KEY}"}}, "HeadObject")

    monkeypatch.setattr(s3._client, "head_object", denied)
    with pytest.raises(StorageError) as caught:
        await s3.get_bytes(KEY)
    assert caught.value.code == "denied"
    _assert_clean(str(caught.value), caplog.text)


async def test_connection_failures_never_echo_the_endpoint(s3, caplog, monkeypatch):
    def down(**kwargs):
        raise EndpointConnectionError(endpoint_url="https://SECRET-ENDPOINT-marker.test/" + BUCKET)

    monkeypatch.setattr(s3._client, "head_object", down)
    with pytest.raises(StorageError) as caught:
        await s3.stat(KEY)
    assert caught.value.code == "unavailable"
    _assert_clean(str(caught.value), caplog.text)


async def test_a_missing_object_is_not_logged_as_an_error_with_its_key(s3, caplog):
    with pytest.raises(BlobNotFound) as caught:
        await s3.get_bytes(KEY)
    _assert_clean(str(caught.value), caplog.text)


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
