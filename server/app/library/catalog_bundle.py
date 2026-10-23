"""Curated catalog bundles (plan L1 Task 21, R14): export one ready catalog item to `bundles/<id>/manifest.json` and
import it on another installation without running the pipeline (no recognition, no translation, no model spend).

The manifest holds catalog data only: no user, no copy count, no publication state, no audit. The media and poster
stay where they are (`library/_catalog/<id>/`); import checks that they are there, the right size and the right
sha256 before any row is written. Unknown optional keys are ignored; an unknown schema version is refused."""
from __future__ import annotations

import hashlib
import json
import logging
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select

from app.library import ai, catalog_store, store as library_store
from app.library.limits import TITLE_MAX
from app.models import CatalogItem, CatalogSegment
from app.storage import BlobNotFound, StorageError

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
KIND = "enjoy.catalog_bundle"
ROOT = "bundles"
MAX_MANIFEST_BYTES = 8 * 1024 * 1024
MAX_SEGMENTS = 20_000
TEXT_MAX, ZH_MAX, ANALYSIS_MAX, FLAGS_MAX = 2_000, 2_000, 4_000, 48
SUB_SOURCES = ("uploaded", "platform", "asr")
SOURCES = ("upload", "link")


class BundleError(Exception):
    """A refusal with an HTTP status and a fixed English message (the same texts the admin API returns)."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def manifest_key(catalog_id: str) -> str:
    return f"{ROOT}/{catalog_id}/manifest.json"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


async def _digest(blobs, key: str, known: str | None) -> str | None:
    """The object's sha256: the stored metadata when we wrote it, else a streamed copy to a scratch file."""
    if known:
        return known
    with tempfile.TemporaryDirectory(prefix="bundle-sha-") as scratch:
        target = Path(scratch) / "object"
        try:
            await blobs.download_to(key, target)
        except BlobNotFound:
            return None
        return _sha256_file(target)


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


async def export_bundle(session, blobs, catalog_id: str, now: datetime) -> dict:
    row = await catalog_store.get(session, catalog_id)
    if row is None:
        raise BundleError(404, "Not Found")
    if row.status != "ready" or row.retired_at is not None or not row.media_path:
        raise BundleError(409, "Item is not ready to export")
    media = await blobs.stat(row.media_path)
    if media is None:
        raise BundleError(409, "Bundle media is missing")
    media_sha = await _digest(blobs, row.media_path, media.sha256)
    poster = None
    if row.poster_path:
        pinfo = await blobs.stat(row.poster_path)
        if pinfo is not None:
            poster = {"key": row.poster_path, "bytes": pinfo.size,
                      "sha256": await _digest(blobs, row.poster_path, pinfo.sha256)}
    segs = (await session.scalars(select(CatalogSegment).where(CatalogSegment.catalog_id == catalog_id)
                                  .order_by(CatalogSegment.idx))).all()
    manifest = {
        "schema_version": SCHEMA_VERSION, "kind": KIND, "exported_at": now.astimezone(timezone.utc).isoformat(),
        "catalog_id": catalog_id,
        "item": {"title": row.title, "level": row.level, "tags": row.tags, "license_note": row.license_note,
                 "source": row.source, "source_host": row.source_host, "duration_ms": row.duration_ms,
                 "media_mime": row.media_mime, "sub_source": row.sub_source,
                 "low_confidence": bool(row.low_confidence), "ai_lang": row.ai_lang},
        "media": {"key": row.media_path, "bytes": media.size, "sha256": media_sha},
        "poster": poster,
        "segments": [{"idx": s.idx, "start_ms": s.start_ms, "end_ms": s.end_ms, "text": s.text, "zh": s.zh,
                      "zh_lang": s.zh_lang, "analysis": s.analysis, "analysis_lang": s.analysis_lang,
                      "flags": s.flags} for s in segs],
    }
    raw = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    await blobs.put_bytes(manifest_key(catalog_id), raw, content_type="application/json")
    logger.info("library catalog bundle exported catalog=%s segments=%d", catalog_id, len(segs))
    return {"catalog_id": catalog_id, "segments": len(segs), "bytes": media.size + (poster or {}).get("bytes", 0)}


def _text(value, limit: int, *, required: bool = False) -> str | None:
    if value is None:
        if required:
            raise BundleError(400, "Bundle is invalid")
        return None
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise BundleError(400, "Bundle is invalid")
    return value


def _lang(value) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or value not in ai.LANGS:
        raise BundleError(400, "Bundle is invalid")
    return value


def _int(value, low: int, high: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < low or (high is not None and value > high):
        raise BundleError(400, "Bundle is invalid")
    return value


def _segments(raw) -> list[dict]:
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_SEGMENTS:
        raise BundleError(400, "Bundle is invalid")
    out = []
    last_end = -1
    for position, seg in enumerate(raw):
        if not isinstance(seg, dict):
            raise BundleError(400, "Bundle is invalid")
        idx = _int(seg.get("idx"), 0)
        start, end = _int(seg.get("start_ms"), 0), _int(seg.get("end_ms"), 0)
        if idx != position or end < start or start < last_end:
            raise BundleError(400, "Bundle is invalid")  # contiguous indices, ordered non-overlapping times
        last_end = end
        out.append({
            "idx": idx, "start_ms": start, "end_ms": end,
            "text": _text(seg.get("text"), TEXT_MAX, required=True),
            "zh": _text(seg.get("zh"), ZH_MAX), "zh_lang": _lang(seg.get("zh_lang")),
            "analysis": _text(seg.get("analysis"), ANALYSIS_MAX), "analysis_lang": _lang(seg.get("analysis_lang")),
            "flags": _text(seg.get("flags"), FLAGS_MAX),
        })
    return out


async def _check_object(blobs, key: str, expected: dict) -> None:
    info = await blobs.stat(key)
    if info is None or info.size != _int(expected.get("bytes"), 0):
        raise BundleError(400, "Bundle media is missing")
    digest = await _digest(blobs, key, info.sha256)
    if digest is None or digest != expected.get("sha256"):
        raise BundleError(400, "Bundle is invalid")


async def import_bundle(session, blobs, catalog_id: str, now: datetime, *, audit=None) -> CatalogItem:
    """Imports the bundle and commits once. `audit`, if given, is awaited with the new row before that commit, so the
    caller's audit row and the import succeed or fail together (plan L1 T22). The library layer never imports admin."""
    try:
        raw = await blobs.get_bytes(manifest_key(catalog_id), max_bytes=MAX_MANIFEST_BYTES)
    except BlobNotFound:
        raise BundleError(404, "Bundle not found") from None
    except StorageError as exc:
        if exc.code == "too_large":
            raise BundleError(400, "Bundle is invalid") from None
        raise
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise BundleError(400, "Bundle is invalid") from None
    if not isinstance(data, dict) or data.get("kind") != KIND:
        raise BundleError(400, "Bundle is invalid")
    if data.get("schema_version") != SCHEMA_VERSION:
        raise BundleError(400, "Unsupported bundle version")
    if data.get("catalog_id") != catalog_id:
        raise BundleError(400, "Bundle is invalid")
    if await catalog_store.get(session, catalog_id) is not None:
        raise BundleError(409, "Item exists")

    item = data.get("item")
    if not isinstance(item, dict):
        raise BundleError(400, "Bundle is invalid")
    try:
        level = catalog_store.clean_level(item.get("level"))
        tags = catalog_store.clean_tags(item.get("tags").split(",") if isinstance(item.get("tags"), str) else None)
        license_note = catalog_store.clean_license(item.get("license_note"))
    except (ValueError, AttributeError):
        raise BundleError(400, "Bundle is invalid") from None
    title = library_store.clean_title(_text(item.get("title"), TITLE_MAX * 4) or "")
    source = item.get("source")
    if source not in SOURCES:
        raise BundleError(400, "Bundle is invalid")
    sub_source = item.get("sub_source")
    if sub_source is not None and sub_source not in SUB_SOURCES:
        raise BundleError(400, "Bundle is invalid")
    ai_lang = _lang(item.get("ai_lang")) or catalog_store.DEFAULT_AI_LANG
    duration_ms = _int(item.get("duration_ms"), 0)

    media = data.get("media")
    if not isinstance(media, dict) or not isinstance(media.get("key"), str):
        raise BundleError(400, "Bundle is invalid")
    prefix = f"library/_catalog/{catalog_id}/"  # == app.library.paths.catalog_rel(catalog_id) + "/"
    rest = media["key"][len(prefix):] if media["key"].startswith(prefix) else ""
    if not rest or "/" in rest:
        raise BundleError(400, "Bundle is invalid")  # the media must live under this item's shared directory
    await _check_object(blobs, media["key"], media)
    poster = data.get("poster")
    poster_key = None
    if poster is not None:
        if not isinstance(poster, dict) or poster.get("key") != f"{prefix}poster.jpg":
            raise BundleError(400, "Bundle is invalid")
        await _check_object(blobs, poster["key"], poster)
        poster_key = poster["key"]
    segments = _segments(data.get("segments"))

    row = CatalogItem(
        id=catalog_id, title=title, level=level, tags=",".join(tags) or None, license_note=license_note,
        source=source, source_host=(item.get("source_host") or None) if isinstance(item.get("source_host"), str)
        else None, source_url=None, status="ready", stage=None, progress=100, error_kind=None,
        duration_ms=duration_ms, media_path=media["key"], poster_path=poster_key,
        media_mime=item.get("media_mime") if isinstance(item.get("media_mime"), str) else None,
        media_bytes=media["bytes"] + (poster["bytes"] if poster_key else 0), sub_source=sub_source, asr_seconds=0,
        seg_count=len(segments), low_confidence=bool(item.get("low_confidence")), ai_lang=ai_lang, published=False,
        published_at=None, retired_at=None, created_at=now, updated_at=now)
    session.add(row)
    await session.flush()
    for seg in segments:
        session.add(CatalogSegment(catalog_id=catalog_id, **seg))
    if audit is not None:
        await audit(row)  # the audit row joins this transaction: it commits with the import or not at all
    await session.commit()
    logger.info("library catalog bundle imported catalog=%s segments=%d", catalog_id, len(segments))
    return row


async def list_bundles(blobs) -> list[dict]:
    """Bundles in the store, by listing only (no downloads). `catalog_id`, bytes and when they were written."""
    out = []
    async for info in blobs.list(f"{ROOT}/"):
        parts = info.key.split("/")
        if len(parts) == 3 and parts[2] == "manifest.json":
            out.append({"catalog_id": parts[1], "bytes": info.size, "exported_at": _iso(info.mtime)})
    return sorted(out, key=lambda item: item["exported_at"], reverse=True)
