"""Database <-> object store reconciliation (plan L1 Task 20, R12; spec section 6). Read-only: it lists and compares,
it never deletes. Output is counts per storage root; `--report` writes the keys to an operator file (mode 0600).

Storage must not import `app.library`, so the key formulas below are duplicated on purpose; the contract test in
tests/test_storage_reconcile.py asserts they equal `app.library.paths`."""
from __future__ import annotations

import json
import os
from collections import Counter
from pathlib import Path

from sqlalchemy import select

from app.models import Assessment, CatalogItem, LibraryItem, RoomVoice, User

ROOT_PREFIXES = ("library/", "recordings/", "room_audio/", "avatars/", "bundles/")


def transcript_key(user_id: int, item_id: str) -> str:
    return f"library/{user_id}/{item_id}/transcript.json"


def avatar_key(avatar_id: str) -> str:
    return f"avatars/{avatar_id}.webp"


async def db_references(session) -> set[str]:
    """Every object key the database points at. A catalog copy points at the catalog's own keys: a set removes the
    duplicate, so a copy is neither missing nor counted twice."""
    refs: set[str] = set()

    def add(*values) -> None:
        refs.update(v for v in values if v)

    for media, poster in (await session.execute(select(LibraryItem.media_path, LibraryItem.poster_path))).all():
        add(media, poster)
    for user_id, item_id in (await session.execute(select(LibraryItem.user_id, LibraryItem.id).where(
            LibraryItem.rebuildable.is_(True)))).all():
        refs.add(transcript_key(user_id, item_id))
    for media, poster in (await session.execute(select(CatalogItem.media_path, CatalogItem.poster_path))).all():
        add(media, poster)
    for (audio,) in (await session.execute(select(Assessment.audio_path))).all():
        add(audio)
    for audio, staging in (await session.execute(select(RoomVoice.audio_path, RoomVoice.staging_path))).all():
        add(audio, staging)
    for (avatar,) in (await session.execute(select(User.avatar_id).where(User.avatar_id.is_not(None)))).all():
        refs.add(avatar_key(avatar))
    return refs


async def store_keys(blobs, prefixes: tuple[str, ...]) -> set[str]:
    keys: set[str] = set()
    for prefix in prefixes:
        async for info in blobs.list(prefix):
            keys.add(info.key)
    return keys


def _root(key: str) -> str:
    return key.split("/", 1)[0]


async def reconcile(session, blobs, *, prefixes: tuple[str, ...] = ROOT_PREFIXES,
                    report: Path | None = None) -> dict:
    """{"db_only": {root: n}, "store_only": {root: n}} (db_only = the database points at an object the store lacks;
    store_only = the store holds an object no row points at). Never deletes anything."""
    refs = {k for k in await db_references(session) if any(k.startswith(p) for p in prefixes)}
    present = await store_keys(blobs, prefixes)
    db_only = sorted(refs - present)
    store_only = sorted(present - refs)
    if report is not None:
        _write_report(report, db_only, store_only)
    return {"db_only": dict(Counter(_root(k) for k in db_only)),
            "store_only": dict(Counter(_root(k) for k in store_only))}


def _write_report(path: Path, db_only: list[str], store_only: list[str]) -> None:
    """Keys are operator data (like the manifest): one JSON line each, created with mode 0600 where supported."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        for key in db_only:
            handle.write(json.dumps({"kind": "db_only", "key": key}) + "\n")
        for key in store_only:
            handle.write(json.dumps({"kind": "store_only", "key": key}) + "\n")
