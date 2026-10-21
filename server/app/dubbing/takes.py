"""配音记录(take)的建立、列表、详情与删除(plan L5 S8 / R6、R10、R23)。

不读写文件、不调用上游;逐句写入与收尾评分在 S9。角色名与句子不进输出以外的任何地方。
输出的 `lines` 是按句号排序的列表;每项的 `stale` 表示这一句的文字已经改过(与录音时的文字指纹不同)。
"""
from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.dubbing import clip
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
