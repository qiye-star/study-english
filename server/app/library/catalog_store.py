"""精选库的数据库读写(spec 2026-10-14-curated-library §5、R1、E8):系统所有的目录条目与句子、输出形状、
任务队列,以及(Task 4)复制到用户库、引用数、回收与强制删除。

标题、许可说明、句子、译文只给界面;日志只有 id 与数字。目录只缓存 `ai_lang` 一种语言的译文与分析(E11)。
种类由 `media_mime` 推出(`kind_of`);媒体替换后 `sync_copies` 让副本跟随。"""
import logging
from datetime import datetime
from pathlib import Path

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.library import paths, store
from app.library.limits import TITLE_MAX
from app.library.segment import Sentence
from app.models import CatalogItem, CatalogSegment, LibraryItem, LibrarySegment, iso_utc, new_uuid, utcnow

logger = logging.getLogger(__name__)

LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")
TAGS_MAX, TAG_MAX, LICENSE_MAX, LIST_MAX = 5, 16, 300, 200
DEFAULT_AI_LANG = "zh-CN"
ACTIVE = ("uploading", "queued", "processing")


# ---- cleaning (spec R7) ----

def clean_level(raw: str | None) -> str | None:
    value = (raw or "").strip().upper()
    if not value:
        return None
    if value not in LEVELS:
        raise ValueError("level")
    return value


def clean_tags(raw: list[str] | None) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for tag in raw or []:
        if not isinstance(tag, str):
            raise ValueError("tags")
        value = " ".join(tag.split())
        if not value:
            continue
        if "," in value or len(value) > TAG_MAX:
            raise ValueError("tags")
        if value.casefold() in seen:
            continue
        seen.add(value.casefold())
        out.append(value)
    if len(out) > TAGS_MAX:
        raise ValueError("tags")
    return out


def clean_license(raw: str | None) -> str | None:
    value = " ".join((raw or "").split())
    if len(value) > LICENSE_MAX:
        raise ValueError("license_note")
    return value or None


def tags_of(row: CatalogItem) -> list[str]:
    return [t for t in (row.tags or "").split(",") if t]


def kind_of(row: CatalogItem) -> str:
    """video / audio, from the stored mime (plan 2026-10-15-catalog-keep-video R-KV3: no column, one source of truth)."""
    return "video" if (row.media_mime or "").startswith("video/") else "audio"


# ---- output shapes (INDEX §6) ----

def public_out(row: CatalogItem, added_item_id: str | None) -> dict:
    return {"id": row.id, "title": row.title, "level": row.level, "tags": tags_of(row),
            "license_note": row.license_note, "duration_ms": row.duration_ms, "seg_count": row.seg_count,
            "has_poster": row.poster_path is not None,
            "published_at": iso_utc(row.published_at) if row.published_at else None, "added_item_id": added_item_id}


def admin_out(row: CatalogItem, *, refs: int, translated: int, media_missing: bool) -> dict:
    progress = row.progress
    if row.status == "uploading" and row.upload_total:
        progress = min(100, row.upload_received * 100 // row.upload_total)
    return {
        "id": row.id, "title": row.title, "level": row.level, "tags": tags_of(row), "license_note": row.license_note,
        "source": row.source, "source_host": row.source_host, "status": row.status, "stage": row.stage,
        "progress": progress, "error_kind": row.error_kind, "duration_ms": row.duration_ms, "seg_count": row.seg_count,
        "translated": translated, "sub_source": row.sub_source, "low_confidence": row.low_confidence,
        "kind": kind_of(row), "media_bytes": row.media_bytes, "has_poster": row.poster_path is not None, "media_missing": media_missing,
        "ai_lang": row.ai_lang, "published": row.published,
        "published_at": iso_utc(row.published_at) if row.published_at else None,
        "retired": row.retired_at is not None, "refs": refs, "upload_received": row.upload_received,
        "upload_total": row.upload_total, "created_at": iso_utc(row.created_at), "updated_at": iso_utc(row.updated_at),
    }


def segment_admin_out(seg: CatalogSegment) -> dict:
    return {"idx": seg.idx, "start_ms": seg.start_ms, "end_ms": seg.end_ms, "text": seg.text, "zh": seg.zh,
            "zh_lang": seg.zh_lang, "has_analysis": bool(seg.analysis),
            "flags": seg.flags.split(",") if seg.flags else []}


# ---- create / read ----

async def create(session: AsyncSession, *, source: str, status: str, title: str, level: str | None, tags: list[str],
                 license_note: str | None, ai_lang: str, source_url: str | None = None,
                 source_host: str | None = None, upload_total: int = 0) -> CatalogItem:
    now = utcnow()
    row = CatalogItem(title=(title or "")[:TITLE_MAX], level=level, tags=",".join(tags) or None,
                      license_note=license_note, source=source, status=status, source_url=source_url,
                      source_host=(source_host or None) and source_host[:64], ai_lang=ai_lang,
                      upload_total=upload_total, upload_received=0, created_at=now, updated_at=now)
    session.add(row)
    await session.commit()
    return row


async def get(session: AsyncSession, catalog_id: str) -> CatalogItem | None:
    if not store.is_item_id(catalog_id):
        return None
    return await session.get(CatalogItem, catalog_id)


def _visible():
    return (CatalogItem.status == "ready", CatalogItem.published.is_(True), CatalogItem.retired_at.is_(None))


async def get_published(session: AsyncSession, catalog_id: str) -> CatalogItem | None:
    if not store.is_item_id(catalog_id):
        return None
    return await session.scalar(select(CatalogItem).where(CatalogItem.id == catalog_id, *_visible()))


async def list_published(session: AsyncSession, user_id: int) -> list[tuple[CatalogItem, str | None]]:
    rows = list((await session.scalars(select(CatalogItem).where(*_visible()).order_by(
        CatalogItem.published_at.desc(), CatalogItem.id.desc()).limit(LIST_MAX))).all())
    if not rows:
        return []
    mine = dict((await session.execute(select(LibraryItem.catalog_id, LibraryItem.id).where(
        LibraryItem.user_id == user_id, LibraryItem.catalog_id.in_([r.id for r in rows])))).all())
    return [(r, mine.get(r.id)) for r in rows]


async def list_all(session: AsyncSession) -> list[CatalogItem]:
    return list((await session.scalars(select(CatalogItem).order_by(CatalogItem.created_at.desc(),
                                                                    CatalogItem.id.desc()))).all())


async def segments_of(session: AsyncSession, catalog_id: str) -> list[CatalogSegment]:
    return list((await session.scalars(select(CatalogSegment).where(CatalogSegment.catalog_id == catalog_id)
                                       .order_by(CatalogSegment.idx))).all())


async def segment_at(session: AsyncSession, catalog_id: str, idx: int) -> CatalogSegment | None:
    """Always re-reads the row (`populate_existing`): `ai.analyze_catalog` must see what a concurrent request stored."""
    return await session.scalar(select(CatalogSegment).where(CatalogSegment.catalog_id == catalog_id,
                                                             CatalogSegment.idx == idx)
                                .execution_options(populate_existing=True))


async def write_segments(session: AsyncSession, row: CatalogItem, sentences: list[Sentence], *,
                         flags: list[tuple[str, ...]] | None = None) -> None:
    """Replace every sentence of a catalog item (caller commits)."""
    await session.execute(delete(CatalogSegment).where(CatalogSegment.catalog_id == row.id))
    session.add_all(
        CatalogSegment(catalog_id=row.id, idx=i, start_ms=s.start_ms, end_ms=s.end_ms, text=s.text,
                       flags=",".join(flags[i]) if flags is not None and i < len(flags) and flags[i] else None)
        for i, s in enumerate(sentences))
    row.seg_count = len(sentences)


async def set_translations(session: AsyncSession, catalog_id: str, entries: list[tuple[int, str, str]],
                           language: str) -> set[int]:
    """Store translations under the stale-text guard (same rule as `store.set_translations`). Commits."""
    stored = set()
    for idx, text, zh in entries:
        result = await session.execute(update(CatalogSegment).where(
            CatalogSegment.catalog_id == catalog_id, CatalogSegment.idx == idx, CatalogSegment.text == text)
            .values(zh=zh, zh_lang=language))
        if result.rowcount == 1:
            stored.add(idx)
    await session.commit()
    return stored


async def set_analysis(session: AsyncSession, catalog_id: str, idx: int, text: str, analysis: str,
                       language: str) -> bool:
    result = await session.execute(update(CatalogSegment).where(
        CatalogSegment.catalog_id == catalog_id, CatalogSegment.idx == idx, CatalogSegment.text == text)
        .values(analysis=analysis, analysis_lang=language))
    await session.commit()
    return result.rowcount == 1


# ---- the import queue (run by plan SI's CatalogJobs) ----

async def set_progress(session: AsyncSession, catalog_id: str, stage: str, progress: int, now: datetime) -> bool:
    result = await session.execute(update(CatalogItem).where(CatalogItem.id == catalog_id,
                                                             CatalogItem.status == "processing")
                                   .values(stage=stage, progress=max(0, min(100, progress)), updated_at=now))
    await session.commit()
    return result.rowcount == 1


async def claim_next(session: AsyncSession, now: datetime) -> CatalogItem | None:
    """The oldest queued item becomes `processing` (UPDATE ... WHERE status='queued' + row count: safe on Postgres)."""
    for catalog_id in (await session.scalars(select(CatalogItem.id).where(CatalogItem.status == "queued")
                                             .order_by(CatalogItem.created_at, CatalogItem.id).limit(5))).all():
        result = await session.execute(update(CatalogItem).where(CatalogItem.id == catalog_id,
                                                                 CatalogItem.status == "queued")
                                       .values(status="processing", stage=None, updated_at=now))
        await session.commit()
        if result.rowcount == 1:
            return (await session.execute(select(CatalogItem).where(CatalogItem.id == catalog_id)
                                          .execution_options(populate_existing=True))).scalar_one()
    return None


async def recover(session: AsyncSession, now: datetime) -> int:
    result = await session.execute(update(CatalogItem).where(CatalogItem.status == "processing")
                                   .values(status="queued", updated_at=now))
    await session.commit()
    return result.rowcount or 0


async def fail(session: AsyncSession, catalog_id: str, kind: str, now: datetime) -> bool:
    """A failed job: `failed` + kind. An item that already has sentences (a translate-only re-run, spec R9) goes back
    to `ready` and keeps the kind so the admin sees the attempt did not work."""
    kept = int(await session.scalar(select(CatalogItem.seg_count).where(CatalogItem.id == catalog_id)) or 0)
    values = dict(error_kind=kind, stage=None, updated_at=now)
    values.update(dict(status="ready", progress=100) if kept > 0 else dict(status="failed"))
    result = await session.execute(update(CatalogItem).where(CatalogItem.id == catalog_id,
                                                             CatalogItem.status == "processing").values(**values))
    await session.commit()
    return result.rowcount == 1


# ---- counts ----

async def refs(session: AsyncSession, catalog_id: str) -> int:
    return int(await session.scalar(select(func.count()).select_from(LibraryItem)
                                    .where(LibraryItem.catalog_id == catalog_id)) or 0)


async def ref_counts(session: AsyncSession, ids: list[str]) -> dict[str, int]:
    if not ids:
        return {}
    rows = (await session.execute(select(LibraryItem.catalog_id, func.count()).where(
        LibraryItem.catalog_id.in_(ids)).group_by(LibraryItem.catalog_id))).all()
    return {cid: int(n) for cid, n in rows}


async def translated_counts(session: AsyncSession, rows: list[CatalogItem]) -> dict[str, int]:
    if not rows:
        return {}
    lang = {r.id: r.ai_lang for r in rows}
    found = (await session.execute(select(CatalogSegment.catalog_id, CatalogSegment.zh_lang, func.count()).where(
        CatalogSegment.catalog_id.in_(list(lang)), CatalogSegment.zh.is_not(None))
        .group_by(CatalogSegment.catalog_id, CatalogSegment.zh_lang))).all()
    out = {cid: 0 for cid in lang}
    for cid, zh_lang, n in found:
        if zh_lang == lang[cid]:
            out[cid] += int(n)
    return out


def media_missing(data_dir: Path, row: CatalogItem) -> bool:
    """Only a ready item can miss its media (e.g. the database was restored without the data volume, spec R10)."""
    if row.status != "ready":
        return False
    if not row.media_path:
        return True
    try:
        return not paths.absolute(data_dir, row.media_path).is_file()
    except ValueError:
        return True


# ---- copy-on-add (spec D6, E8) ----

async def _copy_of(session: AsyncSession, user_id: int, catalog_id: str) -> LibraryItem | None:
    return await session.scalar(select(LibraryItem).where(LibraryItem.user_id == user_id,
                                                          LibraryItem.catalog_id == catalog_id))


async def add_to_library(session: AsyncSession, data_dir: Path, *, user_id: int, catalog_id: str,
                         now: datetime) -> tuple[LibraryItem, bool]:
    """(the user's copy, created). A second add returns the existing copy; a racing add loses on the unique index
    and reads the winner back. LookupError when the item is not published / ready / has no media. Commits."""
    existing = await _copy_of(session, user_id, catalog_id)
    if existing is not None:
        return existing, False
    row = await get_published(session, catalog_id)
    if row is None or media_missing(data_dir, row):
        raise LookupError(catalog_id)
    segs = await segments_of(session, row.id)
    item = LibraryItem(id=new_uuid(), user_id=user_id, kind=kind_of(row), source="catalog", title=row.title,
                       status="ready", stage=None, progress=100, duration_ms=row.duration_ms,
                       media_path=row.media_path, poster_path=row.poster_path, media_mime=row.media_mime,
                       library_bytes=0, upload_total=0, upload_received=0, sub_source=row.sub_source,
                       seg_count=len(segs), low_confidence=row.low_confidence, rebuildable=False,
                       catalog_id=row.id, created_at=now, updated_at=now)
    session.add(item)
    session.add_all(LibrarySegment(item_id=item.id, idx=s.idx, start_ms=s.start_ms, end_ms=s.end_ms, text=s.text,
                                   zh=s.zh, zh_lang=s.zh_lang, analysis=s.analysis, analysis_lang=s.analysis_lang,
                                   flags=s.flags) for s in segs)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        existing = await _copy_of(session, user_id, catalog_id)
        if existing is None:
            raise
        return existing, False
    logger.info("library catalog added item=%s catalog=%s sentences=%d", item.id, row.id, len(segs))
    return item, True


async def fill_translations(session: AsyncSession, item: LibraryItem, segs: list[LibrarySegment],
                            language: str) -> int:
    """Spec R3: copy the catalog's stored translations onto the user's copy for sentences that have none in
    `language`, only in the catalog's language and only where the user did not edit the text. Commits; returns how
    many were stored. The caller refreshes the rows it holds (expire_on_commit=False; never expire_all, R-SC6)."""
    if not item.catalog_id:
        return 0
    row = await get(session, item.catalog_id)
    if row is None or row.ai_lang != language:
        return 0
    want = {s.idx: s.text for s in segs if not (s.zh and s.zh_lang == language)}
    if not want:
        return 0
    found = [c for c in await segments_of(session, row.id)
             if c.idx in want and c.zh and c.zh_lang == language and store.same_text(c.text, want[c.idx])]
    if not found:
        return 0
    return len(await store.set_translations(session, item.id, [(c.idx, want[c.idx], c.zh) for c in found], language))


# ---- deletion (spec R1) ----

async def delete_rows(session: AsyncSession, catalog_id: str) -> None:
    """Explicit child delete (SQLite has no FK cascade); caller commits, then removes the files."""
    await session.execute(delete(CatalogSegment).where(CatalogSegment.catalog_id == catalog_id))
    await session.execute(delete(CatalogItem).where(CatalogItem.id == catalog_id))


async def collect_if_orphan(session: AsyncSession, store, data_dir: Path, catalog_id: str) -> bool:
    """A retired catalog item nobody uses any more: rows and files go. Commits."""
    row = await get(session, catalog_id)
    if row is None or row.retired_at is None or await refs(session, catalog_id) > 0:
        return False
    await delete_rows(session, catalog_id)
    await session.commit()
    await paths.remove_catalog_files(store, data_dir, catalog_id)
    logger.info("library catalog collected catalog=%s", catalog_id)
    return True


async def collect_retired(session: AsyncSession, store, data_dir: Path) -> int:
    ids = list((await session.scalars(select(CatalogItem.id).where(CatalogItem.retired_at.is_not(None)))).all())
    done = 0
    for catalog_id in ids:
        done += await collect_if_orphan(session, store, data_dir, catalog_id)
    return done


async def purge(session: AsyncSession, app, catalog_id: str) -> tuple[int, int]:
    """Spec R1 forced delete: every user's copy (rows, sentences, attempts; tickets revoked, copy dirs removed), then
    the catalog rows and files. Assessments in the practice history stay. Returns (copies, users). Commits.
    A running import job must be canceled by the caller first (plan SI)."""
    data_dir = app.state.library.deps.data_dir
    blobs = app.state.storage
    copies = [(r[0], r[1]) for r in (await session.execute(select(LibraryItem.id, LibraryItem.user_id).where(
        LibraryItem.catalog_id == catalog_id))).all()]
    for item_id, _user_id in copies:
        await store.delete_item_rows(session, item_id)
    await delete_rows(session, catalog_id)
    await session.commit()
    for item_id, user_id in copies:
        app.state.library.tickets.revoke_item(item_id)
        await paths.remove_item_files(blobs, data_dir, user_id, item_id)
    await paths.remove_catalog_files(blobs, data_dir, catalog_id)
    logger.info("library catalog purged catalog=%s copies=%d", catalog_id, len(copies))
    return len(copies), len({u for _i, u in copies})


async def sync_copies(session: AsyncSession, row: CatalogItem, now: datetime) -> int:
    """R-KV5: after a media replacement every user's copy follows the catalog's media (kind, file, mime, poster,
    duration). Sentences, titles, progress and `library_bytes` (0) stay. Caller commits; returns the copy count."""
    result = await session.execute(update(LibraryItem).where(LibraryItem.catalog_id == row.id).values(
        kind=kind_of(row), media_path=row.media_path, media_mime=row.media_mime, poster_path=row.poster_path,
        duration_ms=row.duration_ms, updated_at=now))
    return result.rowcount or 0
