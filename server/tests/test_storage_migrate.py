"""The migration command: manifest, copy, verify, resume and incremental runs (plan L1 Task 19, R12).

Two moto buckets (primary and fallback) and a local data directory; no real endpoint is contacted."""
import asyncio
from pathlib import Path

import boto3
import pytest

from app.core.config import Settings
from app.storage import migrate, manifest
from app.storage.local import LocalStore
from app.storage.s3 import S3Store
from tests.storage_helpers import FAKE_KEY, REGION, moto_bucket, s3_store

PRIMARY = "enjoy-primary-bucket"
FALLBACK = "enjoy-fallback-bucket"
ITEM = "11111111-2222-4333-8444-555555555555"
MEDIA = bytes(range(256)) * 64


def _settings(tmp_path: Path, **extra) -> Settings:
    base = dict(_env_file=None, data_dir=str(tmp_path / "data"), storage_backend="s3", s3_bucket=PRIMARY,
                s3_access_key=FAKE_KEY, s3_secret_key=FAKE_KEY, s3_region=REGION,
                s3_fallback_bucket=FALLBACK, s3_fallback_access_key=FAKE_KEY, s3_fallback_secret_key=FAKE_KEY,
                s3_fallback_region=REGION)
    base.update(extra)
    return Settings(**base)


@pytest.fixture
def buckets():
    with moto_bucket(PRIMARY):
        client = boto3.client("s3", region_name=REGION, aws_access_key_id=FAKE_KEY, aws_secret_access_key=FAKE_KEY)
        client.create_bucket(Bucket=FALLBACK)
        yield client


def _run(settings, *argv, out=None):
    args = migrate.parse_args(list(argv))
    lines = out if out is not None else []
    return asyncio.run(migrate.migrate(settings, args, out=lines.append)), lines


async def _keys(store, prefix="library/") -> list[str]:
    return sorted([info.key async for info in store.list(prefix)])


def test_local_to_s3_copies_verifies_and_leaves_the_source_alone(tmp_path, buckets):
    settings = _settings(tmp_path)
    local = LocalStore(Path(settings.resolved_data_dir))
    asyncio.run(local.put_bytes(f"library/{ITEM}/media.mp4", MEDIA))
    asyncio.run(local.put_bytes(f"recordings/7/{ITEM}.wav", b"RIFF"))
    before = (Path(settings.resolved_data_dir) / f"library/{ITEM}/media.mp4").stat()

    code, lines = _run(settings, "--from", "local", "--to", "s3")
    assert code == migrate.EXIT_OK
    assert lines == ["migrate objects=2 bytes=%d verified=2 failed=0" % (len(MEDIA) + 4)]
    primary = s3_store(PRIMARY)
    assert await_result(primary.get_bytes(f"library/{ITEM}/media.mp4")) == MEDIA
    assert await_result(primary.stat(f"library/{ITEM}/media.mp4")).sha256 is not None
    after = (Path(settings.resolved_data_dir) / f"library/{ITEM}/media.mp4").stat()
    assert (after.st_size, after.st_mtime_ns) == (before.st_size, before.st_mtime_ns)  # never touched
    manifest_path = migrate.default_manifest(settings, migrate.parse_args(["--from", "local", "--to", "s3"]))
    assert manifest_path.is_file()
    assert "library/" in manifest_path.read_text(encoding="utf-8")  # the operator file holds keys, as documented


def await_result(awaitable):
    return asyncio.run(awaitable)


def test_dry_run_writes_nothing_to_the_target(tmp_path, buckets):
    settings = _settings(tmp_path)
    asyncio.run(LocalStore(Path(settings.resolved_data_dir)).put_bytes(f"library/{ITEM}/media.mp4", MEDIA))
    code, lines = _run(settings, "--from", "local", "--to", "s3", "--dry-run")
    assert code == migrate.EXIT_OK
    assert lines == [f"dry run objects=1 to_copy=1 already_identical=0 bytes={len(MEDIA)}"]
    assert await_result(_keys(s3_store(PRIMARY))) == []


def test_fallback_to_primary_copies_from_the_old_bucket(tmp_path, buckets):
    settings = _settings(tmp_path)
    buckets.put_object(Bucket=FALLBACK, Key=f"library/{ITEM}/media.mp4", Body=MEDIA)
    code, _lines = _run(settings, "--from", "s3_fallback", "--to", "s3")
    assert code == migrate.EXIT_OK
    assert await_result(s3_store(PRIMARY).get_bytes(f"library/{ITEM}/media.mp4")) == MEDIA


def test_s3_back_to_local_restores_the_same_bytes(tmp_path, buckets):
    settings = _settings(tmp_path)
    asyncio.run(s3_store(PRIMARY).put_bytes(f"avatars/{'a' * 32}.webp", b"RIFF....WEBP"))
    code, _lines = _run(settings, "--from", "s3", "--to", "local", "--prefix", "avatars/")
    assert code == migrate.EXIT_OK
    assert (Path(settings.resolved_data_dir) / f"avatars/{'a' * 32}.webp").read_bytes() == b"RIFF....WEBP"


def test_a_second_run_copies_only_what_is_missing(tmp_path, buckets, monkeypatch):
    settings = _settings(tmp_path)
    local = LocalStore(Path(settings.resolved_data_dir))
    for n in range(3):
        asyncio.run(local.put_bytes(f"library/{ITEM}/part{n}.bin", bytes([n]) * 10))
    assert _run(settings, "--from", "local", "--to", "s3")[0] == migrate.EXIT_OK

    puts = []
    original = S3Store.put_file

    async def counting(self, key, path, **kwargs):
        puts.append(key)
        return await original(self, key, path, **kwargs)

    monkeypatch.setattr(S3Store, "put_file", counting)
    asyncio.run(s3_store(PRIMARY).delete(f"library/{ITEM}/part1.bin"))  # one object went missing on the target
    assert _run(settings, "--from", "local", "--to", "s3")[0] == migrate.EXIT_OK
    assert puts == [f"library/{ITEM}/part1.bin"]  # verified objects are not uploaded again


def test_a_torn_manifest_line_is_ignored(tmp_path):
    path = tmp_path / "m.jsonl"
    manifest.append(path, manifest.Entry("library/x/a.bin", 3, "d", manifest.VERIFIED))
    with open(path, "a", encoding="utf-8") as handle:
        handle.write('{"key":"library/x/b.bin","size":4,"sha')  # crashed mid-write
    loaded = manifest.load(path)
    assert set(loaded) == {"library/x/a.bin"} and loaded["library/x/a.bin"].state == manifest.VERIFIED


def test_verify_only_reports_drift_and_exits_2(tmp_path, buckets):
    settings = _settings(tmp_path)
    asyncio.run(LocalStore(Path(settings.resolved_data_dir)).put_bytes(f"library/{ITEM}/media.mp4", MEDIA))
    assert _run(settings, "--from", "local", "--to", "s3")[0] == migrate.EXIT_OK
    assert _run(settings, "--from", "local", "--to", "s3", "--verify-only")[1] == ["verify ok=1 missing=0 mismatch=0"]
    asyncio.run(s3_store(PRIMARY).put_bytes(f"library/{ITEM}/media.mp4", b"different"))
    code, lines = _run(settings, "--from", "local", "--to", "s3", "--verify-only")
    assert code == migrate.EXIT_FAILED and lines == ["verify ok=0 missing=0 mismatch=1"]


def test_the_same_profile_on_both_sides_is_a_precondition_failure(tmp_path):
    settings = _settings(tmp_path)
    with pytest.raises(migrate.MigrationError):
        migrate.check_args(migrate.parse_args(["--from", "s3", "--to", "s3"]))
    assert migrate.main(["--from", "s3", "--to", "s3"]) == migrate.EXIT_PRECONDITION


def test_output_carries_counts_only_never_keys(tmp_path, buckets):
    settings = _settings(tmp_path)
    asyncio.run(LocalStore(Path(settings.resolved_data_dir)).put_bytes(f"library/{ITEM}/media.mp4", MEDIA))
    _code, lines = _run(settings, "--from", "local", "--to", "s3")
    text = "\n".join(lines)
    assert ITEM not in text and "library/" not in text and "media.mp4" not in text
