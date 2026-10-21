"""Storage test helpers (plan L1 Tasks 3, 7). Production code never imports this module.

`moto_bucket()` opens an in-memory S3 (moto) with one private bucket; `s3_store()` builds the real S3Store on top of
it through the same `from_settings` path the app uses. Nothing here talks to a real endpoint.
"""
import contextlib
import logging

import boto3
from moto import mock_aws

from app.storage.s3 import S3Store

BUCKET = "enjoy-test-bucket"
FAKE_KEY = "testing"
REGION = "us-east-1"


@contextlib.contextmanager
def moto_bucket(bucket: str = BUCKET):
    with mock_aws():
        client = boto3.client("s3", region_name=REGION, aws_access_key_id=FAKE_KEY, aws_secret_access_key=FAKE_KEY)
        if bucket:
            client.create_bucket(Bucket=bucket)
        yield bucket


def s3_store(bucket: str = BUCKET, *, path_style: bool = False) -> S3Store:
    return S3Store.from_settings(endpoint="", bucket=bucket, access_key=FAKE_KEY, secret_key=FAKE_KEY,
                                 region=REGION, path_style=path_style)


# ---- app-level helpers (plan L1 Task 7): every read and write goes through app.state.storage ----
async def put(app, key: str, data: bytes, *, content_type: str | None = None):
    from app.storage import get_store

    return await get_store(app).put_bytes(key, data, content_type=content_type)


async def read(app, key: str) -> bytes:
    from app.storage import get_store

    return await get_store(app).get_bytes(key)


async def exists(app, key: str) -> bool:
    from app.storage import get_store

    return await get_store(app).stat(key) is not None


async def keys_under(app, prefix: str) -> list[str]:
    from app.storage import get_store

    return [info.key async for info in get_store(app).list(prefix)]


def quiet_botocore() -> bool:
    return all(logging.getLogger(name).getEffectiveLevel() >= logging.WARNING
               for name in ("botocore", "boto3", "s3transfer", "urllib3"))
