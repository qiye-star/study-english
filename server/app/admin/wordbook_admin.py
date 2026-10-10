"""管理端:词书文件与学习统计、重新加载词典、例句举报处理(spec 2026-10-10-wordbook §9)。

不返回用户内容(拼写输入、讲解正文)与文件绝对路径;审计只记书 id / 例句 id 与理由。"""
import asyncio
import hashlib
import json
from datetime import timedelta
from pathlib import Path
from typing import Literal

from sqlalchemy import func, select, update

from app.admin import audit
from app.models import (DailyUsage, VocabularyItem, WordbookEnrollment, WordbookEvent, WordbookExplanation,
                        WordbookHiddenSentence, WordbookReport, iso_utc, utcnow)
from app.services.usage import utc_day
from app.wordbook import store
from app.wordbook.books import BOOKS, enabled_books
from app.wordbook.index import DataUnavailable, dictionary
from app.wordbook.plan import MASTERED_BOX

REPORTS_LIMIT = 200


class WordbookAdminError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _manifest(data_dir: Path) -> dict[str, dict]:
    try:
        return {b["file"]: b for b in json.loads((data_dir / "SOURCE.json").read_text(encoding="utf-8"))["books"]}
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


async def _sha_ok(app, path: Path, expected: dict | None) -> bool | None:
    """与清单比对;不在清单里(或无文件)→ None。结果按 (路径, 大小, mtime) 缓存,文件变了才重算。"""
    if not expected or not isinstance(expected.get("sha256"), str):
        return None
    try:
        stat = path.stat()
    except OSError:
        return None
    cache = app.state.__dict__.setdefault("wordbook_sha_cache", {})
    slot = (str(path), stat.st_size, stat.st_mtime_ns)
    if slot not in cache:
        try:
            digest = await asyncio.to_thread(_sha256, path)  # Ruling A1-2: 最大 ~10 MB,放到线程里算
        except OSError:
            return None
        cache[slot] = digest == expected["sha256"]
    return cache[slot]


def _size(path: Path) -> int:
    try:
        return path.stat().st_size if path.is_file() else 0
    except OSError:
        return 0


async def _count(session, stmt) -> int:
    return int(await session.scalar(stmt) or 0)


async def _book(session, app, ds, spec, manifest: dict, now) -> dict:
    data_dir = Path(app.state.settings.resolved_wordbook_data_dir)
    path = data_dir / spec.file
    index = ds.loaded().get(spec.id)
    return {
        "id": spec.id, "title_zh": spec.title_zh, "enabled": True,
        "file": {"bytes": _size(path), "sha256_ok": await _sha_ok(app, path, manifest.get(spec.file)),
                 "entries": spec.entries, "unique": spec.unique},
        "index": {"loaded": index is not None, "keys": len(index) if index else 0,
                  "dropped": index.dropped if index else 0, "built_ms": index.built_ms if index else None,
                  "stale": ds.stale(spec.id)},
        "learners": await _count(session, select(func.count()).select_from(WordbookEnrollment).where(
            WordbookEnrollment.book_id == spec.id)),
        "learners_7d": await _count(session, select(func.count(func.distinct(WordbookEvent.user_id))).where(
            WordbookEvent.book_id == spec.id, WordbookEvent.created_at >= now - timedelta(days=7))),
        "learned": await _count(session, select(func.count()).select_from(WordbookEvent).where(
            WordbookEvent.book_id == spec.id, WordbookEvent.kind == "learn")),
        "mastered": await _count(session, select(func.count()).select_from(VocabularyItem).where(
            VocabularyItem.source == store.wordbook_source(spec.id), VocabularyItem.box >= MASTERED_BOX)),
        "reports_open": await _count(session, select(func.count()).select_from(WordbookReport).where(
            WordbookReport.book_id == spec.id, WordbookReport.status == "open")),
    }


async def overview(session, app, now) -> dict:
    """形状 = admin `WordbookAdmin` 的 snake_case;只列启用的书(目录顺序)。"""
    settings = app.state.settings
    ds = dictionary(app)
    manifest = _manifest(Path(settings.resolved_wordbook_data_dir))
    enabled = set(enabled_books(settings.wordbook_books))
    books = [await _book(session, app, ds, spec, manifest, now) for spec in BOOKS if spec.id in enabled]
    today_calls = await _count(session, select(DailyUsage.count).where(
        DailyUsage.scope == "wordbook_ai_global", DailyUsage.subject == "all", DailyUsage.day == utc_day(now)))
    return {"enabled": bool(settings.wordbook_enabled),
            "ai": {"enabled": bool(settings.wordbook_ai_enabled), "available": bool(settings.wordbook_ai_available),
                   "today_calls": today_calls, "global_daily": settings.wordbook_ai_global_daily,
                   "cached": await _count(session, select(func.count()).select_from(WordbookExplanation))},
            "books": books}


async def reload(session, app, actor, *, book_id: str | None, reason: str) -> None:
    dictionary(app).reload(book_id)
    await audit.record(session, actor, "wordbook.reload", target_type="wordbook", target_id=book_id or "all",
                       reason=reason)
    await session.commit()


async def reports(session, app) -> list[dict]:
    """待处理举报,按 (书, 词, 例句) 合并,次数多的在前。句子文本从词典现读(不存库)。"""
    rows = (await session.execute(
        select(WordbookReport.book_id, WordbookReport.word, WordbookReport.sentence_id,
               func.min(WordbookReport.id), func.count(), func.min(WordbookReport.reason),
               func.min(WordbookReport.created_at))
        .where(WordbookReport.status == "open")
        .group_by(WordbookReport.book_id, WordbookReport.word, WordbookReport.sentence_id)
        .order_by(func.count().desc(), func.min(WordbookReport.id))
        .limit(REPORTS_LIMIT))).all()
    ds = dictionary(app)
    out = []
    for book_id, word, sid, first_id, count, reason, created in rows:
        try:
            card = await ds.card(book_id, word)
        except DataUnavailable:
            card = None
        sentence = next((e.en for e in card.examples if e.id == sid), None) if card else None
        out.append({"id": first_id, "book_id": book_id, "word": word, "sentence_id": sid, "sentence": sentence,
                    "reason": reason, "count": int(count), "created_at": iso_utc(created)})
    return out


async def resolve(session, app, actor, report_id: int, *, action: Literal["hide", "dismiss"], reason: str) -> None:
    """处理一条举报:同一例句的全部待处理举报一起改状态;「屏蔽」另写屏蔽表并刷新内存里的屏蔽集。"""
    row = await session.get(WordbookReport, report_id)
    if row is None:
        raise WordbookAdminError(404, "Report not found")
    if row.status != "open":
        raise WordbookAdminError(409, "Report already resolved")  # Ruling A1-3
    status = "hidden" if action == "hide" else "dismissed"
    sentence_id, book_id = row.sentence_id, row.book_id
    await session.execute(update(WordbookReport).where(
        WordbookReport.sentence_id == sentence_id, WordbookReport.status == "open").values(status=status))
    if action == "hide" and await session.get(WordbookHiddenSentence, sentence_id) is None:
        # Ruling A1-4: created_at = 屏蔽时刻(计划写的是举报时刻)
        session.add(WordbookHiddenSentence(sentence_id=sentence_id, book_id=book_id, hidden_by=actor.name[:64],
                                           created_at=utcnow()))
    await audit.record(session, actor, "wordbook.sentence.hide" if action == "hide" else "wordbook.report.dismiss",
                       target_type="wordbook_sentence", target_id=sentence_id, reason=reason)
    await session.commit()
    if action == "hide":
        # 换屏蔽集并清空词卡缓存,学习端立即不再出这句(集成裁定 Z-d:用 S 车道的 store.load_hidden)
        await store.load_hidden(session, dictionary(app))
