"""跟读库的数据库读写(spec §4、§9)。所有用户可见的查询都带 user_id:别人的 id 一律当作不存在。
SQLite 没有外键级联:删条目显式删 attempts → segments → item(`delete_item_rows`)。
除 `cancel_item` / `delete_item`(停任务、删文件,路由与管理端共用)外只读写库。标题、链接、句子文本永远不进日志。"""
import hashlib
import re
from datetime import datetime, timedelta
from pathlib import PurePath

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.library import paths
from app.storage import get_store
from app.library.limits import (
    ACTIVE, AUDIO_EXTENSIONS, FAILED_KEEP_DAYS, LIST_LIMIT, TITLE_MAX, UPLOAD_EXPIRE_HOURS,
)
from app.library.segment import Sentence
from app.models import LibraryAttempt, LibraryDub, LibraryItem, LibrarySegment, iso_utc, utcnow

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def is_item_id(value: str | None) -> bool:
    return isinstance(value, str) and _UUID.fullmatch(value) is not None


def clean_title(raw: str | None, fallback: str = "Untitled") -> str:
    title = " ".join((raw or "").split())[:TITLE_MAX].strip()
    return title or fallback


def title_from_filename(filename: str) -> str:
    stem = PurePath(filename.replace("\\", "/")).stem
    return clean_title(stem.replace("_", " "))


def extension_of(filename: str) -> str:
    return PurePath(filename.replace("\\", "/")).suffix.lower().lstrip(".")


def text_hash(text: str) -> str:
    return hashlib.sha256(" ".join(text.split()).encode("utf-8")).hexdigest()[:16]


def same_text(a: str, b: str) -> bool:
    return " ".join(a.split()) == " ".join(b.split())


# ---- output shapes (the web reads them through tests/fixtures/library_contract.json) ----

def item_out(row: LibraryItem) -> dict:
    progress = row.progress
    if row.status == "uploading" and row.upload_total:
        progress = min(100, row.upload_received * 100 // row.upload_total)
    return {
        "id": row.id, "kind": row.kind, "source": row.source, "title": row.title, "status": row.status,
        "stage": row.stage, "progress": progress, "error_kind": row.error_kind, "duration_ms": row.duration_ms,
        "seg_count": row.seg_count, "library_bytes": row.library_bytes, "sub_source": row.sub_source,
        "resume_ms": row.resume_ms, "resume_idx": row.resume_idx, "rate_pct": row.rate_pct,
        "low_confidence": row.low_confidence, "rebuildable": row.rebuildable,
        "has_poster": row.poster_path is not None, "catalog_id": row.catalog_id, "created_at": iso_utc(row.created_at),
        "last_opened_at": iso_utc(row.last_opened_at) if row.last_opened_at else None,
    }


def segment_out(row: LibrarySegment) -> dict:
    """D8:列表里带译文 `zh`(+ `zh_lang`,网页拿它和当前母语比,不一致就当没有);分析正文最长 4000 字、只在点「分析」时
    才取,列表只告诉有没有(`has_analysis` + `analysis_lang`)。"""
    return {"idx": row.idx, "start_ms": row.start_ms, "end_ms": row.end_ms, "text": row.text, "zh": row.zh,
            "zh_lang": row.zh_lang, "has_analysis": bool(row.analysis), "analysis_lang": row.analysis_lang,
            "flags": row.flags.split(",") if row.flags else []}


# ---- create / read ----

async def create_item(session: AsyncSession, *, user_id: int, kind: str, source: str, status: str, title: str,
                      source_url: str | None = None, source_host: str | None = None,
                      upload_total: int = 0) -> LibraryItem:
    """Insert and commit one item. Plan S2 creates link items with it (`source="link"`, `status="queued"`,
    `title=""` when the user gave none: the fetch stage's page title fills it in, R-SC22)."""
    now = utcnow()
    row = LibraryItem(user_id=user_id, kind=kind, source=source, title=(title or "")[:TITLE_MAX], status=status,
                      source_url=source_url, source_host=(source_host or None) and source_host[:64],
                      upload_total=upload_total, upload_received=0, created_at=now, updated_at=now)
    session.add(row)
    await session.commit()
    return row


async def create_upload(session: AsyncSession, user_id: int, *, title: str, size: int, ext: str) -> LibraryItem:
    """`kind` is a guess from the extension until the probe decides (spec §4)."""
    return await create_item(session, user_id=user_id, kind="audio" if ext in AUDIO_EXTENSIONS else "video",
                             source="upload", status="uploading", title=clean_title(title), upload_total=size)


async def get_owned(session: AsyncSession, user_id: int, item_id: str) -> LibraryItem | None:
    if not is_item_id(item_id):
        return None
    return await session.scalar(select(LibraryItem).where(LibraryItem.id == item_id, LibraryItem.user_id == user_id))


async def list_page(session: AsyncSession, user_id: int, cursor: str | None,
                    limit: int = LIST_LIMIT) -> tuple[list[LibraryItem], str | None]:
    """Newest first; `cursor` is the id of the last item of the previous page (unknown cursor = first page)."""
    query = select(LibraryItem).where(LibraryItem.user_id == user_id)
    anchor = await get_owned(session, user_id, cursor) if cursor else None
    if anchor is not None:
        query = query.where((LibraryItem.created_at < anchor.created_at)
                            | ((LibraryItem.created_at == anchor.created_at) & (LibraryItem.id < anchor.id)))
    rows = (await session.scalars(query.order_by(LibraryItem.created_at.desc(), LibraryItem.id.desc())
                                  .limit(limit + 1))).all()
    more = len(rows) > limit
    rows = list(rows[:limit])
    return rows, (rows[-1].id if more and rows else None)


async def segments_of(session: AsyncSession, item_id: str) -> list[LibrarySegment]:
    return list((await session.scalars(select(LibrarySegment).where(LibrarySegment.item_id == item_id)
                                       .order_by(LibrarySegment.idx))).all())


async def write_segments(session: AsyncSession, item: LibraryItem, sentences: list[Sentence], *,
                         flags: list[tuple[str, ...]] | None = None, keep_ai: bool = False) -> None:
    """Replace every sentence of the item (caller commits). Old attempts stay; their text hash decides (R-SC14).
    `flags` (plan v2 R-V14): one tuple of codes per sentence. `keep_ai` (rebuild, R-V16): a new sentence whose text is
    the same as an old one keeps that one's translation and analysis."""
    kept: dict[str, tuple] = {}
    # L5 R5: a new sentence takes the speaker of the old sentence with the same text (spaces collapsed); repeated
    # texts pair up in order; nothing left over means no speaker. Old rows are detached so the bulk delete is safe.
    speakers: dict[str, list[str | None]] = {}
    for old in await segments_of(session, item.id):
        key = " ".join(old.text.split())
        speakers.setdefault(key, []).append(old.speaker)
        if keep_ai:
            kept.setdefault(key, (old.zh, old.zh_lang, old.analysis, old.analysis_lang))
        session.expunge(old)
    await session.execute(delete(LibrarySegment).where(LibrarySegment.item_id == item.id))
    rows = []
    for i, s in enumerate(sentences):
        codes = flags[i] if flags is not None and i < len(flags) else ()
        key = " ".join(s.text.split())
        zh, zh_lang, analysis, analysis_lang = kept.get(key, (None, None, None, None))
        queue = speakers.get(key)
        speaker = queue.pop(0) if queue else None
        rows.append(LibrarySegment(item_id=item.id, idx=i, start_ms=s.start_ms, end_ms=s.end_ms, text=s.text,
                                   flags=",".join(codes) or None, zh=zh, zh_lang=zh_lang, analysis=analysis,
                                   analysis_lang=analysis_lang, speaker=speaker))
    session.add_all(rows)
    item.seg_count = len(sentences)
    item.resume_idx = min(item.resume_idx, max(0, len(sentences) - 1))


async def segments_at(session: AsyncSession, item_id: str, indices: list[int]) -> list[LibrarySegment]:
    """The sentences with these indices (unknown ones are simply absent), in index order."""
    if not indices:
        return []
    return list((await session.scalars(select(LibrarySegment).where(
        LibrarySegment.item_id == item_id, LibrarySegment.idx.in_(indices)).order_by(LibrarySegment.idx))).all())


def clear_ai(seg: LibrarySegment) -> None:
    """Spec E11: a sentence whose text changed keeps no translation or analysis (caller commits)."""
    seg.zh = seg.zh_lang = seg.analysis = seg.analysis_lang = None


async def set_translations(session: AsyncSession, item_id: str, entries: list[tuple[int, str, str]],
                           language: str) -> set[int]:
    """Store translations (commits). Each entry is (idx, the text the translation was made for, zh): a sentence edited
    while the model was working no longer matches and is skipped, so a stale translation never lands on new text.
    Returns the indices that were stored."""
    stored = set()
    for idx, text, zh in entries:
        result = await session.execute(update(LibrarySegment).where(
            LibrarySegment.item_id == item_id, LibrarySegment.idx == idx, LibrarySegment.text == text)
            .values(zh=zh, zh_lang=language))
        if result.rowcount == 1:
            stored.add(idx)
    await session.commit()
    return stored


async def set_analysis(session: AsyncSession, item_id: str, idx: int, text: str, analysis: str,
                       language: str) -> bool:
    """Store one analysis (commits) under the same stale-text guard as `set_translations`."""
    result = await session.execute(update(LibrarySegment).where(
        LibrarySegment.item_id == item_id, LibrarySegment.idx == idx, LibrarySegment.text == text)
        .values(analysis=analysis, analysis_lang=language))
    await session.commit()
    return result.rowcount == 1


async def delete_item_rows(session: AsyncSession, item_id: str) -> None:
    """Explicit child deletes (SQLite has no FK cascade); caller commits, then removes the files."""
    await session.execute(delete(LibraryDub).where(LibraryDub.item_id == item_id))  # L5 R23
    await session.execute(delete(LibraryAttempt).where(LibraryAttempt.item_id == item_id))
    await session.execute(delete(LibrarySegment).where(LibrarySegment.item_id == item_id))
    await session.execute(delete(LibraryItem).where(LibraryItem.id == item_id))


async def _cancel_reprocess(session: AsyncSession, app, item: LibraryItem) -> bool:
    """Canceling a re-recognition gives the item back as it was (R-R3): `ready`, with its media and sentences."""
    done = await session.execute(update(LibraryItem).where(
        LibraryItem.id == item.id, LibraryItem.status.in_(("queued", "processing")))
        .values(status="ready", stage=None, progress=100, error_kind=None, attempts=0, next_run_at=None,
                updated_at=utcnow()))
    await session.commit()
    if done.rowcount != 1:
        return False
    worker = app.state.library
    await worker.cancel(item.id)
    paths.remove_tree(paths.tmp_dir(worker.deps.data_dir, item.id))
    await session.refresh(item)
    return True


async def cancel_item(session: AsyncSession, app, item: LibraryItem) -> bool:
    """spec §6.5: an uploading / queued / processing item becomes `canceled`, its job and subprocesses stop, its
    staging and media files go, its tickets die. False = it was not active (nothing changed). Commits.
    A re-recognition (`seg_count > 0`) is reverted to `ready` instead and keeps its files (`_cancel_reprocess`).
    Shared by `POST /api/library/items/{id}/cancel` and the admin console (plan A)."""
    if item.seg_count > 0 and item.status in ("queued", "processing"):
        return await _cancel_reprocess(session, app, item)
    done = await session.execute(update(LibraryItem).where(LibraryItem.id == item.id, LibraryItem.status.in_(ACTIVE))
                                 .values(status="canceled", stage=None, updated_at=utcnow()))
    await session.commit()
    if done.rowcount != 1:
        return False
    worker = app.state.library
    await worker.cancel(item.id)
    worker.tickets.revoke_item(item.id)
    await paths.remove_item_files(get_store(app), app.state.library.deps.data_dir, item.user_id, item.id)
    await session.execute(update(LibraryItem).where(LibraryItem.id == item.id).values(
        media_path=None, poster_path=None, library_bytes=0, error_kind=None, source_url=None))
    await session.commit()
    await session.refresh(item)
    return True


async def delete_item(session: AsyncSession, app, item: LibraryItem) -> None:
    """spec §4 / §6.5: deleting implies canceling; then explicit deletes of attempts, sentences and the item, and
    both directories. Commits. Shared by `DELETE /api/library/items/{id}` and the admin console (plan A).
    Assessments and recordings made while shadowing stay (they belong to the practice history)."""
    item_id, user_id = item.id, item.user_id
    if item.status in ACTIVE:
        await cancel_item(session, app, item)
    await delete_item_rows(session, item_id)
    await session.commit()
    app.state.library.tickets.revoke_item(item_id)
    await paths.remove_item_files(get_store(app), app.state.library.deps.data_dir, user_id, item_id)


# ---- the worker's queue ----

async def claim(session: AsyncSession, now: datetime, limit: int) -> list[LibraryItem]:
    """Atomically move up to `limit` due queued items to `processing` (UPDATE ... WHERE status='queued' and check
    the row count, so two claimers never get the same item; safe on Postgres too)."""
    if limit <= 0:
        return []
    ids = (await session.scalars(
        select(LibraryItem.id).where(LibraryItem.status == "queued",
                                     (LibraryItem.next_run_at.is_(None)) | (LibraryItem.next_run_at <= now))
        .order_by(LibraryItem.created_at, LibraryItem.id).limit(limit))).all()
    claimed = []
    for item_id in ids:
        result = await session.execute(update(LibraryItem).where(LibraryItem.id == item_id,
                                                                 LibraryItem.status == "queued")
                                       .values(status="processing", stage=None, updated_at=now))
        if result.rowcount == 1:
            claimed.append(item_id)
    await session.commit()
    if not claimed:
        return []
    return list((await session.scalars(select(LibraryItem).where(LibraryItem.id.in_(claimed))
                                       .order_by(LibraryItem.created_at, LibraryItem.id))).all())


async def recover(session: AsyncSession, now: datetime) -> int:
    """Startup: items left `processing` by a stopped process go back to the queue (attempts unchanged)."""
    result = await session.execute(update(LibraryItem).where(LibraryItem.status == "processing")
                                   .values(status="queued", updated_at=now))
    await session.commit()
    return result.rowcount or 0


async def set_progress(session: AsyncSession, item_id: str, stage: str, progress: int, now: datetime) -> bool:
    """False = the item is no longer processing (canceled or deleted): the job must stop."""
    result = await session.execute(update(LibraryItem).where(LibraryItem.id == item_id,
                                                             LibraryItem.status == "processing")
                                   .values(stage=stage, progress=max(0, min(100, progress)), updated_at=now))
    await session.commit()
    return result.rowcount == 1


async def fail(session: AsyncSession, item_id: str, kind: str, *, retry_at: datetime | None, now: datetime) -> bool:
    """A failed job: transient with retries left -> back to `queued` with `next_run_at`; else `failed`.
    A re-recognition (the item still has its finished sentences, R-R2) is given back as it was instead: `ready`, with
    `error_kind` kept so the card can say the attempt did not work (R-R3)."""
    values = dict(error_kind=kind, updated_at=now, stage=None)
    if retry_at is not None:
        values.update(status="queued", next_run_at=retry_at, attempts=LibraryItem.attempts + 1)
    else:
        kept = int(await session.scalar(select(LibraryItem.seg_count).where(LibraryItem.id == item_id)) or 0)
        if kept > 0:
            values.update(status="ready", progress=100, attempts=0, next_run_at=None)
        else:
            values.update(status="failed", next_run_at=None)
    result = await session.execute(update(LibraryItem).where(LibraryItem.id == item_id,
                                                             LibraryItem.status == "processing").values(**values))
    await session.commit()
    return result.rowcount == 1


# ---- sweeps ----

async def expire_uploads(session: AsyncSession, now: datetime) -> list[str]:
    """Uploads idle for 24 h become failed(upload_expired); returns their ids (the caller deletes `_tmp`)."""
    cutoff = now - timedelta(hours=UPLOAD_EXPIRE_HOURS)
    ids = list((await session.scalars(select(LibraryItem.id).where(LibraryItem.status == "uploading",
                                                                   LibraryItem.updated_at < cutoff))).all())
    if ids:
        await session.execute(update(LibraryItem).where(LibraryItem.id.in_(ids), LibraryItem.status == "uploading")
                              .values(status="failed", error_kind="upload_expired", updated_at=now))
    await session.commit()
    return ids


async def stale_items(session: AsyncSession, now: datetime) -> list[tuple[int, str]]:
    """(user_id, item_id) of failed / canceled items untouched for 7 days: rows and files go."""
    cutoff = now - timedelta(days=FAILED_KEEP_DAYS)
    rows = (await session.execute(select(LibraryItem.user_id, LibraryItem.id).where(
        LibraryItem.status.in_(("failed", "canceled")), LibraryItem.updated_at < cutoff))).all()
    return [(r[0], r[1]) for r in rows]


async def statuses(session: AsyncSession, item_ids: list[str]) -> dict[str, str]:
    if not item_ids:
        return {}
    rows = (await session.execute(select(LibraryItem.id, LibraryItem.status)
                                  .where(LibraryItem.id.in_(item_ids)))).all()
    return {r[0]: r[1] for r in rows}


async def active_count(session: AsyncSession) -> int:
    return int(await session.scalar(select(func.count()).select_from(LibraryItem)
                                    .where(LibraryItem.status.in_(ACTIVE))) or 0)


# ---- attempts ----

async def add_attempt(session: AsyncSession, *, user_id: int, item_id: str, seg_idx: int, assessment_id: str,
                      text: str, score: int | None, now: datetime, dub_id: str | None = None) -> LibraryAttempt:
    """`dub_id` (plan L5 R10): the dubbing take this line belongs to; a dubbed line counts as a normal attempt."""
    existing = await session.scalar(select(LibraryAttempt).where(LibraryAttempt.item_id == item_id,
                                                                 LibraryAttempt.assessment_id == assessment_id))
    if existing is not None:  # the same assessment posted twice counts once
        return existing
    row = LibraryAttempt(user_id=user_id, item_id=item_id, seg_idx=seg_idx, assessment_id=assessment_id,
                         text_hash=text_hash(text), score=score, created_at=now, dub_id=dub_id)
    session.add(row)
    await session.commit()
    return row


async def best_attempts(session: AsyncSession, item_id: str, segments: list[LibrarySegment]) -> list[dict]:
    """Per sentence: best score, count and last time, counting only attempts made on the sentence's current text."""
    hashes = {s.idx: text_hash(s.text) for s in segments}
    rows = (await session.scalars(select(LibraryAttempt).where(LibraryAttempt.item_id == item_id)
                                  .order_by(LibraryAttempt.seg_idx, LibraryAttempt.created_at))).all()
    out: dict[int, dict] = {}
    for row in rows:
        if hashes.get(row.seg_idx) != row.text_hash:
            continue
        entry = out.setdefault(row.seg_idx, {"seg_idx": row.seg_idx, "best_score": None, "count": 0, "last_at": None})
        entry["count"] += 1
        if row.score is not None and (entry["best_score"] is None or row.score > entry["best_score"]):
            entry["best_score"] = row.score
        entry["last_at"] = iso_utc(row.created_at)
    return [out[k] for k in sorted(out)]
