"""S3Store over moto: the shared contract plus S3-only behaviour (plan L1 Task 3, R5)."""
import hashlib
import logging

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from app.storage import BlobNotFound, StorageError
from app.storage import s3 as s3_module
from tests.storage_contract import *  # noqa: F401,F403  (the shared contract cases run against S3Store)
from tests.storage_helpers import BUCKET, moto_bucket, quiet_botocore, s3_store


@pytest.fixture
def store():
    with moto_bucket() as bucket:
        yield s3_store(bucket)


async def test_every_write_stores_the_sha256_as_metadata(store, tmp_path):
    data = b"payload-for-digest"
    digest = hashlib.sha256(data).hexdigest()
    info = await store.put_bytes("library/1/a/media.mp4", data)
    assert info.sha256 == digest
    source = tmp_path / "src.bin"
    source.write_bytes(data)
    info = await store.put_file("library/1/a/copy.mp4", source)
    assert info.sha256 == digest
    assert (await store.stat("library/1/a/copy.mp4")).sha256 == digest


async def test_content_type_is_kept(store):
    await store.put_bytes("library/1/a/media.mp4", b"v", content_type="video/mp4")
    assert (await store.stat("library/1/a/media.mp4")).content_type == "video/mp4"


async def test_large_files_go_through_multipart_upload_with_the_right_digest(store, tmp_path, monkeypatch):
    monkeypatch.setattr(s3_module, "MULTIPART_THRESHOLD", 5 * 1024 * 1024)
    data = bytes(range(256)) * (6 * 1024 * 4)  # 6 MiB
    source = tmp_path / "big.mp4"
    source.write_bytes(data)
    info = await store.put_file("library/1/a/big.mp4", source)
    assert info.size == len(data)
    assert info.sha256 == hashlib.sha256(data).hexdigest()
    assert await store.get_bytes("library/1/a/big.mp4") == data


async def test_delete_prefix_crosses_listing_pages(store):
    # raw puts keep this fast; 1001 keys forces a second ListObjectsV2 page
    for i in range(1001):
        store._client.put_object(Bucket=BUCKET, Key=f"library/7/item/{i:05d}.bin", Body=b"x")
    store._client.put_object(Bucket=BUCKET, Key="library/70/keep.bin", Body=b"y")
    assert await store.delete_prefix("library/7/") == 1001
    assert await store.stat("library/70/keep.bin") is not None
    assert [info async for info in store.list("library/7/")] == []


async def test_delete_prefix_falls_back_to_single_deletes_when_batch_delete_is_unsupported(store, monkeypatch):
    for name in ("a", "b", "c"):
        await store.put_bytes(f"recordings/1/{name}.wav", b"x")

    def not_implemented(**kwargs):
        raise ClientError({"Error": {"Code": "NotImplemented", "Message": "nope"}}, "DeleteObjects")

    monkeypatch.setattr(store._client, "delete_objects", not_implemented)
    assert await store.delete_prefix("recordings/1/") == 3
    assert [info async for info in store.list("recordings/1/")] == []


async def test_missing_key_maps_to_blob_not_found(store):
    with pytest.raises(BlobNotFound):
        await store.get_bytes("library/1/none/media.mp4")
    assert await store.stat("library/1/none/media.mp4") is None


async def test_access_denied_maps_to_denied(store, monkeypatch):
    def denied(**kwargs):
        raise ClientError({"Error": {"Code": "AccessDenied", "Message": "SECRET-BUCKET-NAME"}}, "HeadObject")

    monkeypatch.setattr(store._client, "head_object", denied)
    with pytest.raises(StorageError) as caught:
        await store.stat("library/1/a/media.mp4")
    assert caught.value.code == "denied"
    assert "SECRET" not in str(caught.value)


async def test_connection_failure_maps_to_unavailable_without_the_endpoint(store, monkeypatch):
    def down(**kwargs):
        raise EndpointConnectionError(endpoint_url="https://SECRET-ENDPOINT.test/SECRET-BUCKET/library/1/a")

    monkeypatch.setattr(store._client, "head_object", down)
    with pytest.raises(StorageError) as caught:
        await store.get_bytes("library/1/a/media.mp4")
    assert caught.value.code == "unavailable"
    assert "SECRET" not in str(caught.value)
    assert not isinstance(caught.value, FileNotFoundError)


async def test_probe_reports_ok_and_no_bucket(store):
    assert await store.probe() == "ok"
    missing = s3_store("bucket-that-does-not-exist")
    assert await missing.probe() == "no_bucket"


async def test_repr_and_errors_do_not_show_the_bucket_or_keys(store):
    assert BUCKET not in repr(store)
    assert "testing" not in repr(store)
    with pytest.raises(BlobNotFound) as caught:
        await store.get_bytes("library/1/secret-item/media.mp4")
    assert BUCKET not in str(caught.value)
    assert "secret-item" not in str(caught.value)


async def test_botocore_is_kept_at_warning_level(store, caplog):
    assert quiet_botocore()
    caplog.set_level(logging.DEBUG)
    await store.put_bytes("library/1/a/media.mp4", b"x")
    assert not [r for r in caplog.records if r.name.startswith("botocore")]
