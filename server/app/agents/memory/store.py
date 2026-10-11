"""智能体记忆的全部数据库读写(spec §8;接口名 §13)。每个方法自己开会话、自己提交,返回 ORM 行或数据类。
本模块从不写日志(调用方只记计数与异常类名)。"""
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.memory import profile as profile_rules
from app.agents.memory.retrieve import ItemView, eviction_order
from app.agents.memory.tombstones import TOMBSTONES_MAX, bury, buried, clean_text, redact, text_hash
from app.models import (
    AgentMemoryItem, AgentMemoryTombstone, AgentProfile, AgentRecap, AgentThreadState, Message, iso_utc, utcnow,
)
from app.services.stats import as_utc

ITEM_KINDS = ("fact", "preference", "goal", "weakness", "progress")
ITEM_SOURCES = ("chat", "tutor", "room")
RECAP_SOURCES = ("conversation", "tutor")
ITEM_TEXT_MAX = 200
RECAP_TEXT_MAX = 400
SUMMARY_MAX = 400
PENDING_TEXTS_MAX = 4
PENDING_TEXT_MAX = 300
PAGE_MAX = 50
EXPORT_VERSION = 1
LINE_ROLES = ("user", "assistant")


class MemoryNotFound(Exception):
    pass


@dataclass(frozen=True)
class ThreadKey:
    kind: str  # "conversation" | "room"
    id: str

    def where(self):
        column = AgentThreadState.conversation_id if self.kind == "conversation" else AgentThreadState.room_id
        return column == self.id


@dataclass(frozen=True)
class ProfileState:
    data: dict
    edited_keys: list
    proposals: dict


@dataclass(frozen=True)
class ThreadTouch:
    gap: bool                                        # 距上一回合 ≥ idle:本回合是「空闲后的下一次进入」
    gap_pending: tuple[str, ...]                     # 空闲前还没整理的用户文本
    gap_segment: tuple[datetime, datetime] | None    # 上一段的起止(段起点, 上一回合)
    turns: int                                       # 本段累计回合(抽取后清零)
    pending: tuple[str, ...]
    summary: str
    summarized_count: int
    rolls_since_recap: int


@dataclass(frozen=True)
class Line:
    role: str
    text: str


def to_view(row: AgentMemoryItem) -> ItemView:
    return ItemView(row.id, row.kind, row.text, row.importance, row.pinned, row.persona_id, row.updated_at,
                    row.last_used_at)


def _offset(cursor: str | None) -> int:
    if not cursor:
        return 0
    if not cursor.isdigit() or len(cursor) > 6:
        raise ValueError("cursor")
    return int(cursor)


def _page(rows: list, offset: int, limit: int) -> tuple[list, str | None]:
    return rows[:limit], (str(offset + limit) if len(rows) > limit else None)


class MemoryStore:
    def __init__(self, sessionmaker, *, clock=utcnow):
        self._sm = sessionmaker
        self._clock = clock

    # ---- 长期记忆 ----

    async def items(self, user_id: int, kind: str | None = None, persona_id: str | None = None,
                    cursor: str | None = None, limit: int = 30) -> tuple[list[AgentMemoryItem], str | None]:
        """persona_id="shared" = 只看共享;其他值 = 只看该角色。排序 pinned、updated_at、id 倒序(R-M13)。"""
        offset, limit = _offset(cursor), max(1, min(limit, PAGE_MAX))
        stmt = select(AgentMemoryItem).where(AgentMemoryItem.user_id == user_id)
        if kind:
            stmt = stmt.where(AgentMemoryItem.kind == kind)
        if persona_id == "shared":
            stmt = stmt.where(AgentMemoryItem.persona_id.is_(None))
        elif persona_id:
            stmt = stmt.where(AgentMemoryItem.persona_id == persona_id)
        stmt = stmt.order_by(AgentMemoryItem.pinned.desc(), AgentMemoryItem.updated_at.desc(),
                             AgentMemoryItem.id.desc()).offset(offset).limit(limit + 1)
        async with self._sm() as s:
            rows = list((await s.scalars(stmt)).all())
        return _page(rows, offset, limit)

    async def persona_counts(self, user_id: int) -> list[tuple[str | None, int]]:
        async with self._sm() as s:
            rows = (await s.execute(select(AgentMemoryItem.persona_id, func.count())
                                    .where(AgentMemoryItem.user_id == user_id)
                                    .group_by(AgentMemoryItem.persona_id))).all()
        return sorted(((pid, int(n)) for pid, n in rows), key=lambda r: (r[0] is not None, r[0] or ""))

    async def _views(self, s: AsyncSession, user_id: int, persona_id: str | None) -> list[ItemView]:
        cond = AgentMemoryItem.persona_id.is_(None)
        if persona_id:
            cond = or_(cond, AgentMemoryItem.persona_id == persona_id)
        rows = (await s.scalars(select(AgentMemoryItem).where(AgentMemoryItem.user_id == user_id, cond))).all()
        return [to_view(r) for r in rows]

    async def views(self, user_id: int, persona_id: str | None) -> list[ItemView]:
        """共享记忆 + 该角色的记忆(读取与抽取用)。"""
        async with self._sm() as s:
            return await self._views(s, user_id, persona_id)

    async def snapshot_inputs(self, user_id: int, persona_id: str | None,
                              key: ThreadKey | None) -> tuple[list[ItemView], dict, str]:
        """组块需要的全部输入,一次会话三次查询:条目、档案、线程摘要。"""
        async with self._sm() as s:
            views = await self._views(s, user_id, persona_id)
            prof = await s.get(AgentProfile, user_id)
            summary = ""
            if key is not None:
                summary = await s.scalar(select(AgentThreadState.summary)
                                         .where(AgentThreadState.user_id == user_id, key.where())) or ""
        return views, dict(prof.data) if prof else {}, summary

    async def _own(self, s: AsyncSession, user_id: int, item_id: str) -> AgentMemoryItem | None:
        return await s.scalar(select(AgentMemoryItem).where(AgentMemoryItem.id == item_id,
                                                            AgentMemoryItem.user_id == user_id))

    async def add(self, user_id: int, *, kind: str, text: str, importance: int, persona_id: str | None,
                  source: str) -> AgentMemoryItem | None:
        """None = 被拒绝(墓碑、空文本)。同一规范化文本已存在 → 不新建,刷新时间并取较高重要度。"""
        if kind not in ITEM_KINDS or source not in ITEM_SOURCES:
            raise ValueError("kind")
        text = clean_text(text)[:ITEM_TEXT_MAX]
        if not text:
            return None
        digest, now = text_hash(text), self._clock()
        async with self._sm() as s:
            if await buried(s, user_id, [digest]):
                return None
            row = await s.scalar(select(AgentMemoryItem).where(AgentMemoryItem.user_id == user_id,
                                                               AgentMemoryItem.text_hash == digest))
            if row is not None:
                row.importance, row.updated_at = max(row.importance, importance), now
                await s.commit()
                return row
            row = AgentMemoryItem(id=str(uuid.uuid4()), user_id=user_id, persona_id=persona_id, kind=kind, text=text,
                                  text_hash=digest, importance=importance, pinned=False, source=source,
                                  created_at=now, updated_at=now)
            s.add(row)
            try:
                await s.commit()
            except IntegrityError:  # the same text arrived from a parallel job
                await s.rollback()
                return None
            return row

    async def update(self, user_id: int, item_id: str, *, text: str | None = None, kind: str | None = None,
                     importance: int | None = None) -> bool:
        """智能体修改一条记忆。置顶的不改;新文本在墓碑里或与另一条重复 → 不改。"""
        async with self._sm() as s:
            row = await self._own(s, user_id, item_id)
            if row is None or row.pinned:
                return False
            if text is not None:
                text = clean_text(text)[:ITEM_TEXT_MAX]
                digest = text_hash(text)
                if not text or await buried(s, user_id, [digest]):
                    return False
                clash = await s.scalar(select(AgentMemoryItem.id).where(
                    AgentMemoryItem.user_id == user_id, AgentMemoryItem.text_hash == digest,
                    AgentMemoryItem.id != item_id))
                if clash is not None:
                    return False
                row.text, row.text_hash = text, digest
            if kind is not None:
                if kind not in ITEM_KINDS:
                    return False
                row.kind = kind
            if importance is not None:
                row.importance = importance
            row.updated_at = self._clock()
            await s.commit()
            return True

    async def delete(self, user_id: int, item_id: str, *, by_user: bool) -> bool:
        """用户删除 → 文本哈希进墓碑(以后不会被重新写入);智能体删除 → 不进墓碑、不删置顶(R-M9)。"""
        async with self._sm() as s:
            row = await self._own(s, user_id, item_id)
            if row is None or (not by_user and row.pinned):
                return False
            if by_user:
                await bury(s, user_id, [row.text_hash], self._clock())
            await s.delete(row)
            await s.commit()
            return True

    async def pin(self, user_id: int, item_id: str, pinned: bool) -> AgentMemoryItem:
        async with self._sm() as s:
            row = await self._own(s, user_id, item_id)
            if row is None:
                raise MemoryNotFound()
            row.pinned = pinned
            await s.commit()
            return row

    async def touch(self, user_id: int, ids: Iterable[str], at: datetime) -> None:
        ids = sorted(set(ids))
        if not ids:
            return
        async with self._sm() as s:
            await s.execute(update(AgentMemoryItem).where(AgentMemoryItem.user_id == user_id,
                                                          AgentMemoryItem.id.in_(ids)).values(last_used_at=at))
            await s.commit()

    async def evict(self, user_id: int, max_items: int) -> int:
        async with self._sm() as s:
            rows = (await s.scalars(select(AgentMemoryItem).where(AgentMemoryItem.user_id == user_id))).all()
            extra = len(rows) - max_items
            if extra <= 0:
                return 0
            victims = [v.id for v in eviction_order([to_view(r) for r in rows], self._clock())][:extra]
            if victims:
                await s.execute(delete(AgentMemoryItem).where(AgentMemoryItem.id.in_(victims)))
            await s.commit()
            return len(victims)

    # ---- 档案 ----

    async def profile(self, user_id: int) -> ProfileState:
        async with self._sm() as s:
            row = await s.get(AgentProfile, user_id)
        if row is None:
            return ProfileState({}, [], {})
        return ProfileState(dict(row.data), list(row.edited_keys), dict(row.proposals))

    async def _profile_row(self, s: AsyncSession, user_id: int) -> AgentProfile:
        row = await s.get(AgentProfile, user_id)
        if row is None:
            row = AgentProfile(user_id=user_id, data={}, edited_keys=[], proposals={}, updated_at=self._clock())
            s.add(row)
        return row

    async def patch_profile(self, user_id: int, values: dict, dismiss: list) -> ProfileState:
        """用户修改档案;不合法 → ProfileError(什么都不写)。"""
        async with self._sm() as s:
            row = await self._profile_row(s, user_id)
            data, edited, proposals = profile_rules.apply_user_patch(row.data, row.edited_keys, row.proposals,
                                                                     values, dismiss)
            row.data, row.edited_keys, row.proposals, row.updated_at = data, edited, proposals, self._clock()
            await s.commit()
            return ProfileState(data, edited, proposals)

    async def propose(self, user_id: int, key: str, value: object) -> str:
        async with self._sm() as s:
            row = await self._profile_row(s, user_id)
            data, proposals, outcome = profile_rules.apply_proposal(row.data, row.edited_keys, row.proposals,
                                                                    key, value)
            if outcome != "same":
                row.data, row.proposals, row.updated_at = data, proposals, self._clock()
                await s.commit()
            return outcome

    # ---- 回顾 ----

    async def recaps(self, user_id: int, cursor: str | None = None,
                     limit: int = 20) -> tuple[list[AgentRecap], str | None]:
        offset, limit = _offset(cursor), max(1, min(limit, PAGE_MAX))
        async with self._sm() as s:
            rows = list((await s.scalars(select(AgentRecap).where(AgentRecap.user_id == user_id)
                                         .order_by(AgentRecap.created_at.desc(), AgentRecap.id.desc())
                                         .offset(offset).limit(limit + 1))).all())
        return _page(rows, offset, limit)

    async def add_recap(self, user_id: int, *, source: str, text: str, persona_id: str | None = None,
                        conversation_id: str | None = None, tutor_session_id: str | None = None) -> AgentRecap | None:
        """写一条回顾;文本一律清洗并脱敏(A3 的导师回顾也经过这里)。"""
        if source not in RECAP_SOURCES:
            raise ValueError("source")
        text = redact(clean_text(text))[:RECAP_TEXT_MAX]
        if not text:
            return None
        row = AgentRecap(id=str(uuid.uuid4()), user_id=user_id, persona_id=persona_id, conversation_id=conversation_id,
                         tutor_session_id=tutor_session_id, source=source, text=text, created_at=self._clock())
        async with self._sm() as s:
            s.add(row)
            await s.commit()
        return row

    async def delete_recap(self, user_id: int, recap_id: str) -> bool:
        async with self._sm() as s:
            result = await s.execute(delete(AgentRecap).where(AgentRecap.id == recap_id, AgentRecap.user_id == user_id))
            await s.commit()
            return bool(result.rowcount)

    # ---- 短期(线程状态)----

    async def touch_thread(self, user_id: int, key: ThreadKey, *, at: datetime, text: str | None, count_turn: bool,
                           idle: timedelta) -> ThreadTouch:
        """记一回合:检测空闲间隔(并开新段)、把用户文本放进待整理队列。并发创建同一行会抛 IntegrityError(任务失败、只记类名)。"""
        async with self._sm() as s:
            row = await s.scalar(select(AgentThreadState).where(AgentThreadState.user_id == user_id, key.where()))
            if row is None:
                row = AgentThreadState(
                    user_id=user_id, conversation_id=key.id if key.kind == "conversation" else None,
                    room_id=key.id if key.kind == "room" else None, summary="", summarized_count=0,
                    rolls_since_recap=0, turns_since_extract=0, pending_texts=[], updated_at=at)
                s.add(row)
            prev = as_utc(row.last_turn_at) if row.last_turn_at is not None else None
            gap = prev is not None and as_utc(at) - prev >= idle
            gap_pending: tuple[str, ...] = ()
            gap_segment = None
            if gap:
                gap_pending = tuple(row.pending_texts or ())
                gap_segment = (as_utc(row.segment_started_at) if row.segment_started_at is not None else prev, prev)
                row.pending_texts, row.turns_since_extract, row.segment_started_at = [], 0, at
            if row.segment_started_at is None:
                row.segment_started_at = at
            if count_turn and text:
                clean = clean_text(text)[:PENDING_TEXT_MAX]
                if clean:
                    row.pending_texts = [*(row.pending_texts or []), clean][-PENDING_TEXTS_MAX:]
                row.turns_since_extract = (row.turns_since_extract or 0) + 1
            row.last_turn_at, row.updated_at = at, at
            touch = ThreadTouch(gap, gap_pending, gap_segment, row.turns_since_extract, tuple(row.pending_texts or ()),
                                row.summary or "", row.summarized_count or 0, row.rolls_since_recap or 0)
            await s.commit()
            return touch

    async def clear_pending(self, user_id: int, key: ThreadKey) -> None:
        async with self._sm() as s:
            await s.execute(update(AgentThreadState).where(AgentThreadState.user_id == user_id, key.where())
                            .values(pending_texts=[], turns_since_extract=0))
            await s.commit()

    async def save_summary(self, user_id: int, key: ThreadKey, *, summary: str, summarized_count: int,
                           rolls_since_recap: int) -> None:
        """只前进不后退(并发的旧结果不会覆盖新摘要)。"""
        async with self._sm() as s:
            await s.execute(update(AgentThreadState).where(
                AgentThreadState.user_id == user_id, key.where(),
                AgentThreadState.summarized_count <= summarized_count,
            ).values(summary=redact(clean_text(summary))[:SUMMARY_MAX], summarized_count=summarized_count,
                     rolls_since_recap=rolls_since_recap, updated_at=self._clock()))
            await s.commit()

    def _lines_of(self, conversation_id: str):
        return select(Message.role, Message.content).where(Message.conversation_id == conversation_id,
                                                           Message.role.in_(LINE_ROLES))

    async def message_count(self, conversation_id: str) -> int:
        async with self._sm() as s:
            return int(await s.scalar(select(func.count()).select_from(Message).where(
                Message.conversation_id == conversation_id, Message.role.in_(LINE_ROLES))) or 0)

    async def lines(self, conversation_id: str, *, offset: int, limit: int) -> list[Line]:
        async with self._sm() as s:
            rows = (await s.execute(self._lines_of(conversation_id).order_by(Message.created_at, Message.id)
                                    .offset(offset).limit(limit))).all()
        return [Line(role, content) for role, content in rows]

    async def lines_between(self, conversation_id: str, start: datetime, end: datetime, limit: int) -> list[Line]:
        """[start, end] 内的最后 limit 条,旧的在前。"""
        async with self._sm() as s:
            rows = (await s.execute(self._lines_of(conversation_id)
                                    .where(Message.created_at >= start, Message.created_at <= end)
                                    .order_by(Message.created_at.desc(), Message.id.desc()).limit(limit))).all()
        return [Line(role, content) for role, content in reversed(rows)]

    # ---- 管理 ----

    async def clear(self, user_id: int, scope: str, persona_id: str | None = None) -> dict:
        """scope="persona":该角色的长期记忆与回顾;scope="all":长期、回顾、线程状态、档案。被删条目进墓碑(R-M9)。"""
        if scope not in ("all", "persona") or (scope == "persona" and not persona_id):
            raise ValueError("scope")
        item_where = [AgentMemoryItem.user_id == user_id]
        recap_where = [AgentRecap.user_id == user_id]
        if scope == "persona":
            item_where.append(AgentMemoryItem.persona_id == persona_id)
            recap_where.append(AgentRecap.persona_id == persona_id)
        async with self._sm() as s:
            hashes = (await s.scalars(select(AgentMemoryItem.text_hash).where(*item_where)
                                      .order_by(AgentMemoryItem.updated_at.desc()))).all()
            await bury(s, user_id, list(hashes)[:TOMBSTONES_MAX], self._clock())
            items = (await s.execute(delete(AgentMemoryItem).where(*item_where))).rowcount
            recaps = (await s.execute(delete(AgentRecap).where(*recap_where))).rowcount
            threads, profile = 0, False
            if scope == "all":
                threads = (await s.execute(delete(AgentThreadState).where(AgentThreadState.user_id == user_id))).rowcount
                profile = bool((await s.execute(delete(AgentProfile).where(AgentProfile.user_id == user_id))).rowcount)
            await s.commit()
        return {"items": int(items or 0), "recaps": int(recaps or 0), "threads": int(threads or 0), "profile": profile}

    async def export(self, user_id: int) -> dict:
        async with self._sm() as s:
            items = (await s.scalars(select(AgentMemoryItem).where(AgentMemoryItem.user_id == user_id)
                                     .order_by(AgentMemoryItem.created_at, AgentMemoryItem.id))).all()
            recaps = (await s.scalars(select(AgentRecap).where(AgentRecap.user_id == user_id)
                                      .order_by(AgentRecap.created_at, AgentRecap.id))).all()
            threads = (await s.scalars(select(AgentThreadState).where(AgentThreadState.user_id == user_id)
                                       .order_by(AgentThreadState.id))).all()
            prof = await s.get(AgentProfile, user_id)
            tombstones = await s.scalar(select(func.count()).select_from(AgentMemoryTombstone)
                                        .where(AgentMemoryTombstone.user_id == user_id))
        opt = lambda value: iso_utc(value) if value is not None else None  # noqa: E731
        return {
            "version": EXPORT_VERSION,
            "exported_at": iso_utc(self._clock()),
            "profile": {"data": dict(prof.data) if prof else {}, "edited_keys": list(prof.edited_keys) if prof else [],
                        "proposals": dict(prof.proposals) if prof else {}},
            "items": [{"id": r.id, "kind": r.kind, "text": r.text, "importance": r.importance, "pinned": r.pinned,
                       "persona_id": r.persona_id, "source": r.source, "created_at": iso_utc(r.created_at),
                       "updated_at": iso_utc(r.updated_at), "last_used_at": opt(r.last_used_at)} for r in items],
            "recaps": [{"id": r.id, "source": r.source, "persona_id": r.persona_id,
                        "conversation_id": r.conversation_id, "tutor_session_id": r.tutor_session_id, "text": r.text,
                        "created_at": iso_utc(r.created_at)} for r in recaps],
            "threads": [{"conversation_id": r.conversation_id, "room_id": r.room_id, "summary": r.summary,
                         "pending_texts": list(r.pending_texts or []), "last_turn_at": opt(r.last_turn_at)}
                        for r in threads],
            "tombstones": int(tombstones or 0),
        }


async def drop_conversation(session: AsyncSession, conversation_id: str) -> None:
    """删除对话时由 routers/conversations.py 在同一事务里调用(不提交):短期状态与回顾随对话删除,
    长期记忆与档案保留(spec §8.5)。Postgres 有 ON DELETE CASCADE 兜底;SQLite 不强制外键,所以显式删除(R-M15)。"""
    await session.execute(delete(AgentRecap).where(AgentRecap.conversation_id == conversation_id))
    await session.execute(delete(AgentThreadState).where(AgentThreadState.conversation_id == conversation_id))


async def memory_counts(session: AsyncSession) -> dict[str, int]:
    """管理后台只看计数(spec §4.5、§8.5):不返回任何文本、用户 id 或角色 id。A1 的管理端调用。"""
    async def count(model, *where) -> int:
        stmt = select(func.count()).select_from(model)
        if where:
            stmt = stmt.where(*where)
        return int(await session.scalar(stmt) or 0)

    return {
        "items": await count(AgentMemoryItem),
        "pinned_items": await count(AgentMemoryItem, AgentMemoryItem.pinned.is_(True)),
        "users_with_items": int(await session.scalar(select(func.count(func.distinct(AgentMemoryItem.user_id)))) or 0),
        "profiles": await count(AgentProfile),
        "recaps": await count(AgentRecap),
        "thread_states": await count(AgentThreadState),
        "tombstones": await count(AgentMemoryTombstone),
    }
