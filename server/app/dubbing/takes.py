"""配音记录(take)的建立、列表、详情与删除(plan L5 S8 / R6、R10、R23)。

不读写文件、不调用上游;逐句写入与收尾评分在 S9。角色名与句子不进输出以外的任何地方。
输出的 `lines` 是按句号排序的列表;每项的 `stale` 表示这一句的文字已经改过(与录音时的文字指纹不同)。
"""
import asyncio
import math
import weakref
from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.dubbing import clip, scoring
from app.dubbing.errors import api_error
from app.library import store
from app.models import LibraryAttempt, LibraryDub, LibraryItem, LibrarySegment, iso_utc, new_uuid

LIST_LIMIT = 20  # the item's take list shows the newest 20 of this user's takes


def expected_lines(segs: list[LibrarySegment], take: LibraryDub) -> list[int]:
    """The sentence indexes the take is about for its role; empty when the clip no longer fits the sentences."""
    if take.seg_to >= len(segs) or take.seg_from < 0:
        return []
    return clip.mine(segs, take.seg_from, take.seg_to, take.role)


async def create(session: AsyncSession, item: LibraryItem, *, user_id: int, seg_from: int, seg_to: int, role: str,
                 now: datetime) -> LibraryDub:
    """A new take for a ready item, after the clip and role rules (R6). Caller commits."""
    if item.status != "ready":
        raise api_error("not_ready")
    segs = await store.segments_of(session, item.id)
    problem = clip.check(segs, seg_from, seg_to, role)
    if problem is not None:
        raise api_error(problem)
    take = LibraryDub(id=new_uuid(), user_id=user_id, item_id=item.id, seg_from=seg_from, seg_to=seg_to, role=role,
                      status="recording", lines={}, created_at=now)
    session.add(take)
    return take


async def list_for_item(session: AsyncSession, user_id: int, item_id: str) -> list[LibraryDub]:
    rows = await session.scalars(select(LibraryDub).where(LibraryDub.user_id == user_id, LibraryDub.item_id == item_id)
                                 .order_by(LibraryDub.created_at.desc(), LibraryDub.id.desc())
                                 .limit(LIST_LIMIT))
    return list(rows.all())


async def get_owned(session: AsyncSession, user_id: int, dub_id: str) -> LibraryDub | None:
    if not store.is_item_id(dub_id):
        return None
    return await session.scalar(select(LibraryDub).where(LibraryDub.id == dub_id, LibraryDub.user_id == user_id))


async def stale_lines(session: AsyncSession, take: LibraryDub, segs: list[LibrarySegment]) -> set[int]:
    """Sentence indexes whose text changed since this take recorded them (LibraryAttempt.text_hash, R5/R10)."""
    now_hash = {seg.idx: store.text_hash(seg.text) for seg in segs}
    attempts = (await session.scalars(select(LibraryAttempt).where(LibraryAttempt.dub_id == take.id))).all()
    return {a.seg_idx for a in attempts if now_hash.get(a.seg_idx) not in (None, a.text_hash)}


def take_out(take: LibraryDub, expected: list[int], stale: set[int]) -> dict:
    lines = []
    for key, entry in sorted((take.lines or {}).items(), key=lambda kv: int(kv[0])):
        lines.append({**entry, "seg_idx": int(key), "stale": int(key) in stale})
    return {
        "id": take.id, "item_id": take.item_id, "seg_from": take.seg_from, "seg_to": take.seg_to, "role": take.role,
        "status": take.status, "expected": expected, "total_score": take.total_score, "summary": take.summary,
        "lines": lines, "created_at": iso_utc(take.created_at),
        "finished_at": iso_utc(take.finished_at) if take.finished_at else None,
    }


async def remove(session: AsyncSession, take: LibraryDub) -> None:
    """Remove the take row; its scored attempts stay in the practice history with the dub link cleared (R23). Caller
    commits."""
    await session.execute(update(LibraryAttempt).where(LibraryAttempt.dub_id == take.id).values(dub_id=None))
    await session.execute(delete(LibraryDub).where(LibraryDub.id == take.id))


# ---- per line (S9) ----

CAPTURES = ("pcm", "recorder")  # plan L5 R13: the web reports which capture path produced the window
REC_START_EARLY_MS = 1000  # R10: the recording may start this long before the sentence and this long after it
REC_START_LATE_MS = 500
_TAKE_LOCKS: "weakref.WeakValueDictionary[str, asyncio.Lock]" = weakref.WeakValueDictionary()


def lock_for(dub_id: str) -> asyncio.Lock:
    """One lock per take inside this process (single-worker assumption, as in library/CLAUDE.md). It serialises the
    read-modify-write of the take's `lines` map, so two sentences posted together both land (R11)."""
    lock = _TAKE_LOCKS.get(dub_id)
    if lock is None:
        lock = _TAKE_LOCKS[dub_id] = asyncio.Lock()
    return lock


def _percent(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return round(min(100.0, max(0.0, float(value))))


def timing_problem(seg: LibrarySegment, *, rec_start_ms: object, voiced_ms: object, capture: object,
                   duration_ms: int) -> bool:
    """True when the posted timing cannot be this sentence's (R10): window, capture path and voiced time."""
    if isinstance(rec_start_ms, bool) or not isinstance(rec_start_ms, int):
        return True
    if not seg.start_ms - REC_START_EARLY_MS <= rec_start_ms <= seg.start_ms + REC_START_LATE_MS:
        return True
    if capture not in CAPTURES:
        return True
    if voiced_ms is not None and (isinstance(voiced_ms, bool) or not isinstance(voiced_ms, int)
                                  or not 0 <= voiced_ms <= duration_ms):
        return True
    return False


def score_line(seg: LibrarySegment, assessment, *, rec_start_ms: int, voiced_ms: int | None, capture: str) -> dict:
    """One line's stored entry (R11): the ISE scores from the saved assessment and the synchronisation from its words."""
    result = assessment.result if isinstance(assessment.result, dict) else {}
    pron = _percent(result.get("pronunciation_score"))
    flu = _percent(result.get("fluency_score"))
    span = scoring.spoken_span(result, wav_ms=assessment.duration_ms)
    sync, basis = scoring.sync_score(seg_start_ms=seg.start_ms, seg_end_ms=seg.end_ms, rec_start_ms=rec_start_ms,
                                     capture=capture, span=span, voiced_ms=voiced_ms)
    original = seg.end_ms - seg.start_ms
    onset = ratio = None
    if span is not None:
        if capture == "pcm":
            onset = (rec_start_ms + span.start_ms) - seg.start_ms
        if original > 0:
            ratio = round(100 * (span.end_ms - span.start_ms) / original)
    elif voiced_ms is not None and original > 0:
        ratio = round(100 * voiced_ms / original)
    return {"assessment_id": assessment.id, "pronunciation": pron, "fluency": flu, "sync": sync, "sync_basis": basis,
            "score": scoring.line_score(pron, flu, sync), "onset_ms": onset, "ratio_pct": ratio}


def line_out(seg_idx: int, entry: dict) -> dict:
    return {"seg_idx": seg_idx, "pronunciation": entry.get("pronunciation"), "fluency": entry.get("fluency"),
            "sync": entry.get("sync"), "sync_basis": entry.get("sync_basis"), "score": entry.get("score")}
