"""Catalog bundles (plan L1 Task 21, R14): export a ready item to the store, import it on an empty catalog without
running the pipeline, and refuse anything that does not check out. Runs on the local and the moto S3 backend."""
import json

import pytest
from sqlalchemy import delete, select

from app.library import catalog_bundle
from app.library.catalog_bundle import BundleError
from app.models import CatalogItem, CatalogSegment, utcnow
from tests.catalog_helpers import SEGMENTS, make_catalog
from tests.library_helpers import library_settings


@pytest.fixture
def settings_overrides(tmp_path):
    return library_settings(tmp_path, library_catalog_enabled=True)


async def _export(app, cid) -> dict:
    async with app.state.sessionmaker() as s:
        return await catalog_bundle.export_bundle(s, app.state.storage, cid, utcnow())


async def _import(app, cid):
    async with app.state.sessionmaker() as s:
        return await catalog_bundle.import_bundle(s, app.state.storage, cid, utcnow())


async def _manifest(app, cid) -> dict:
    return json.loads((await app.state.storage.get_bytes(catalog_bundle.manifest_key(cid))).decode("utf-8"))


async def _put_manifest(app, cid, data: dict) -> None:
    await app.state.storage.put_bytes(catalog_bundle.manifest_key(cid), json.dumps(data).encode("utf-8"))


async def _forget(app, cid) -> None:
    """Simulate the other installation: the catalog row and its sentences are not there, the store still is."""
    async with app.state.sessionmaker() as s:
        await s.execute(delete(CatalogSegment).where(CatalogSegment.catalog_id == cid))
        await s.execute(delete(CatalogItem).where(CatalogItem.id == cid))
        await s.commit()


@pytest.mark.parametrize("storage_backend", ["local", "s3"], indirect=True)
async def test_export_writes_a_manifest_with_catalog_data_only(app, storage_backend):
    cid = await make_catalog(app)
    result = await _export(app, cid)
    assert result["segments"] == len(SEGMENTS)
    manifest = await _manifest(app, cid)
    assert (manifest["schema_version"], manifest["kind"], manifest["catalog_id"]) == (1, catalog_bundle.KIND, cid)
    assert manifest["media"]["key"].startswith(f"library/_catalog/{cid}/")
    assert manifest["media"]["sha256"] and manifest["poster"]["key"].endswith("poster.jpg")
    text = json.dumps(manifest)
    for forbidden in ("published", "asr_seconds", "user_id", "refs", "copies"):
        assert forbidden not in text


@pytest.mark.parametrize("storage_backend", ["local", "s3"], indirect=True)
async def test_import_recreates_the_item_unpublished_without_the_pipeline(app, storage_backend, monkeypatch):
    cid = await make_catalog(app, title="Round trip", published=True)
    await _export(app, cid)
    await _forget(app, cid)

    def no_pipeline(*args, **kwargs):
        raise AssertionError("an imported bundle must not run the pipeline")

    monkeypatch.setattr("app.library.catalog_import.process", no_pipeline)
    row = await _import(app, cid)
    assert (row.status, row.published, row.asr_seconds, row.source_url) == ("ready", False, 0, None)
    assert row.title == "Round trip" and row.seg_count == len(SEGMENTS)
    async with app.state.sessionmaker() as s:
        segs = (await s.scalars(select(CatalogSegment).where(CatalogSegment.catalog_id == cid)
                                .order_by(CatalogSegment.idx))).all()
    assert [(g.start_ms, g.end_ms, g.text, g.zh) for g in segs] == [
        (start, end, text, zh) for start, end, text, zh in SEGMENTS]
    assert await app.state.storage.get_bytes(row.media_path)


@pytest.mark.parametrize("storage_backend", ["local"], indirect=True)
async def test_an_existing_item_is_a_conflict(app, storage_backend):
    cid = await make_catalog(app)
    await _export(app, cid)
    with pytest.raises(BundleError) as caught:
        await _import(app, cid)
    assert (caught.value.status, caught.value.message) == (409, "Item exists")


@pytest.mark.parametrize("storage_backend", ["local"], indirect=True)
async def test_a_newer_schema_is_refused(app, storage_backend):
    cid = await make_catalog(app)
    await _export(app, cid)
    await _forget(app, cid)
    manifest = await _manifest(app, cid)
    manifest["schema_version"] = 2
    await _put_manifest(app, cid, manifest)
    with pytest.raises(BundleError) as caught:
        await _import(app, cid)
    assert (caught.value.status, caught.value.message) == (400, "Unsupported bundle version")


@pytest.mark.parametrize("storage_backend", ["local"], indirect=True)
@pytest.mark.parametrize("mutate, message", [
    (lambda m: m["media"].update(key="library/1/somebody/media.mp4"), "Bundle is invalid"),
    (lambda m: m["media"].update(sha256="0" * 64), "Bundle is invalid"),
    (lambda m: m["media"].update(bytes=m["media"]["bytes"] + 1), "Bundle media is missing"),
    (lambda m: m["segments"][1].update(idx=5), "Bundle is invalid"),
    (lambda m: m["segments"][1].update(start_ms=0), "Bundle is invalid"),
    (lambda m: m["segments"][0].update(text=""), "Bundle is invalid"),
    (lambda m: m["segments"][0].update(zh_lang="xx"), "Bundle is invalid"),
    (lambda m: m["item"].update(ai_lang="es"), "Bundle is invalid"),
])
async def test_a_bad_manifest_writes_nothing(app, storage_backend, mutate, message):
    cid = await make_catalog(app)
    await _export(app, cid)
    await _forget(app, cid)
    manifest = await _manifest(app, cid)
    mutate(manifest)
    await _put_manifest(app, cid, manifest)
    with pytest.raises(BundleError) as caught:
        await _import(app, cid)
    assert caught.value.message == message
    async with app.state.sessionmaker() as s:
        assert await s.get(CatalogItem, cid) is None


@pytest.mark.parametrize("storage_backend", ["local"], indirect=True)
async def test_a_missing_media_object_refuses_the_import(app, storage_backend):
    cid = await make_catalog(app)
    await _export(app, cid)
    await _forget(app, cid)
    manifest = await _manifest(app, cid)
    await app.state.storage.delete(manifest["media"]["key"])
    with pytest.raises(BundleError) as caught:
        await _import(app, cid)
    assert caught.value.message == "Bundle media is missing"


@pytest.mark.parametrize("storage_backend", ["local"], indirect=True)
async def test_unknown_optional_keys_are_ignored(app, storage_backend):
    cid = await make_catalog(app)
    await _export(app, cid)
    await _forget(app, cid)
    manifest = await _manifest(app, cid)
    manifest["future_field"] = {"x": 1}
    manifest["segments"][0]["future_note"] = "ok"
    await _put_manifest(app, cid, manifest)
    assert (await _import(app, cid)).seg_count == len(SEGMENTS)


@pytest.mark.parametrize("storage_backend", ["local"], indirect=True)
async def test_an_oversized_manifest_is_refused(app, storage_backend, monkeypatch):
    cid = await make_catalog(app)
    await _export(app, cid)
    await _forget(app, cid)
    monkeypatch.setattr(catalog_bundle, "MAX_MANIFEST_BYTES", 64)
    with pytest.raises(BundleError) as caught:
        await _import(app, cid)
    assert caught.value.message == "Bundle is invalid"


@pytest.mark.parametrize("storage_backend", ["local"], indirect=True)
async def test_a_retired_or_unready_item_is_not_exported(app, storage_backend):
    cid = await make_catalog(app, retired=True)
    with pytest.raises(BundleError) as caught:
        await _export(app, cid)
    assert caught.value.status == 409


@pytest.mark.parametrize("storage_backend", ["local", "s3"], indirect=True)
async def test_listing_bundles_does_not_download_them(app, storage_backend, monkeypatch):
    cid = await make_catalog(app)
    await _export(app, cid)

    async def no_download(*args, **kwargs):
        raise AssertionError("the listing must not download manifests")

    monkeypatch.setattr(app.state.storage, "get_bytes", no_download)
    listed = await catalog_bundle.list_bundles(app.state.storage)
    assert [(item["catalog_id"], item["bytes"] > 0) for item in listed] == [(cid, True)]
