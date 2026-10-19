"""Room learning summary data and the one-shot generator (spec 2026-10-10 §6.1, §11).

`SummaryStore` reads/writes `room_summaries` and loads the public chat lines; `SummaryRunner` claims a room
(`start`, atomic), checks the switch, eligibility and the global daily count, then makes ONE capped LLM call
(`rooms.summary`, SUMMARY_MAX_TOKENS, metered as feature `rooms_summary` with no user). Upstream errors refund the
daily count and mark `failed("upstream")`; bad output marks `failed("format")` without a refund. At most
`summary_attempts` tries per room. Logs carry only the room id, status and reason, never summary or chat text."""
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.core import metering
from app.models import RoomMessage, RoomSummary, RoomVoice, User, display_name
from app.rooms import assistant
from app.rooms.rules import RoomLimits
from app.rooms.store import AI_NAME
from app.rooms.summary import Line, SummaryFormatError, build_chat, eligible, parse_summary

logger = logging.getLogger(__name__)
GLOBAL_SCOPE = "room_summary_global"
GLOBAL_SUBJECT = "*"
OWNER_SCOPE = "room_summary_owner"
PROMPT_KEY = "rooms.summary"
MODEL_MAX = 64


class SummaryStore:
    def __init__(self, sessionmaker):
        self._sm = sessionmaker
        self._reruns: set[str] = set()  # rooms whose in-flight run was marked stale by a later close (process-local)

    def take_rerun(self, room_id: str) -> bool:
        """True once when the run that just ended was marked `rerun` by a second close (R-O5); the caller regenerates."""
        if room_id in self._reruns:
            self._reruns.discard(room_id)
            return True
        return False

    async def _new_messages(self, s, room_id: str, since: datetime) -> bool:
        """Any public, non-system message written since the room was reopened (a regeneration needs new input)."""
        return (await s.scalar(select(RoomMessage.id).where(
            RoomMessage.room_id == room_id, RoomMessage.lane == "public", RoomMessage.sender_kind != "system",
            RoomMessage.created_at >= since).limit(1))) is not None

    async def get(self, room_id: str) -> RoomSummary | None:
        async with self._sm() as s:
            return await s.get(RoomSummary, room_id)

    async def start(self, room_id: str, now: datetime, max_attempts: int, *, resume: bool = False,
                    since: datetime | None = None) -> bool:
        """Claim a generation: a new row becomes `pending` (attempts 1); a `failed` row (or a `done` row marked
        `stale`, see `fail`) with attempts left goes back to `pending` (attempts + 1). With `resume` (startup only) a
        `pending` row left by a restart with attempts left is claimed too. With `since` (the room's reopen time, R-O5):
        a row first claimed BEFORE it covers an earlier session, so a `done / skipped / failed` row is claimed for a
        fresh generation (attempts 1, created_at now) and its old `data` stays in place until `finish` overwrites it.
        Atomic, so a close listener and a retry cannot both generate."""
        if max_attempts <= 0:
            return False
        async with self._sm() as s:
            if await s.get(RoomSummary, room_id) is None:
                s.add(RoomSummary(room_id=room_id, status="pending", reason=None, attempts=1, created_at=now))
                try:
                    await s.commit()
                    return True
                except IntegrityError:  # someone else created it first
                    await s.rollback()
            if since is not None:
                # a close+reopen+close while the first run is still `pending`: mark it so its result is re-run
                marked = await s.execute(
                    update(RoomSummary).where(RoomSummary.room_id == room_id, RoomSummary.status == "pending",
                                              RoomSummary.created_at < since, RoomSummary.reason.is_(None))
                    .values(reason="rerun"))
                await s.commit()
                if marked.rowcount == 1:
                    return False
            if since is not None and await self._new_messages(s, room_id, since):
                result = await s.execute(
                    update(RoomSummary).where(RoomSummary.room_id == room_id,
                                              RoomSummary.status.in_(("done", "skipped", "failed")),
                                              RoomSummary.created_at < since)
                    .values(status="pending", reason=None, attempts=1, created_at=now, finished_at=None))
                await s.commit()
                if result.rowcount == 1:
                    return True
            states = ("failed", "pending") if resume else ("failed",)
            claimable = or_(RoomSummary.status.in_(states),
                            and_(RoomSummary.status == "done", RoomSummary.reason == "stale"))
            if since is not None and not await self._new_messages(s, room_id, since):
                # reopened but nothing new was said: keep the previous summary, no LLM call, no daily-cap charge
                claimable = and_(claimable, RoomSummary.data.is_(None))
            result = await s.execute(
                update(RoomSummary).where(RoomSummary.room_id == room_id, claimable,
                                          RoomSummary.attempts < max_attempts)
                .values(status="pending", reason=None, attempts=RoomSummary.attempts + 1, finished_at=None))
            await s.commit()
            return result.rowcount == 1

    async def _set(self, room_id: str, **values) -> None:
        async with self._sm() as s:
            await s.execute(update(RoomSummary).where(RoomSummary.room_id == room_id).values(**values))
            await s.commit()

    async def _note_rerun(self, room_id: str) -> None:
        async with self._sm() as s:
            row = await s.get(RoomSummary, room_id)
            if row is not None and row.reason == "rerun":
                self._reruns.add(room_id)

    async def finish(self, room_id: str, data: dict, model: str, now: datetime) -> None:
        await self._note_rerun(room_id)
        await self._set(room_id, status="done", reason=None, data=data, model=(model or "")[:MODEL_MAX] or None,
                        finished_at=now)

    async def _end_row(self, room_id: str, status: str, reason: str, now: datetime) -> None:
        """`failed` / `skipped` for a first summary. A row that already holds a summary (`data` is set: a
        regeneration after a reopen) goes back to `done` with reason `stale`, so the previous summary stays
        readable (R-O5); `data` is never cleared."""
        await self._note_rerun(room_id)
        async with self._sm() as s:
            row = await s.get(RoomSummary, room_id)
            if row is None:
                return
            if row.data is not None:
                row.status, row.reason = "done", "stale"
            else:
                row.status, row.reason = status, reason
            row.finished_at = now
            await s.commit()

    async def fail(self, room_id: str, reason: str, now: datetime) -> None:
        await self._end_row(room_id, "failed", reason, now)

    async def skip(self, room_id: str, reason: str, now: datetime) -> None:
        await self._end_row(room_id, "skipped", reason, now)

    async def pending(self, limit: int) -> list[str]:
        async with self._sm() as s:
            return list((await s.scalars(select(RoomSummary.room_id).where(RoomSummary.status == "pending")
                                         .order_by(RoomSummary.created_at, RoomSummary.room_id).limit(limit))).all())

    async def lines(self, room_id: str, limit: int) -> list[Line]:
        """The last `limit` public, visible member texts, transcribed voice messages and @ai answers, oldest
        first. Private assistant content and system messages never enter the summary."""
        stmt = (select(RoomMessage, display_name())
                .outerjoin(User, User.id == RoomMessage.sender_id)
                .outerjoin(RoomVoice, RoomVoice.message_id == RoomMessage.id)
                .where(RoomMessage.room_id == room_id, RoomMessage.lane == "public", RoomMessage.hidden_at.is_(None),
                       RoomMessage.text != "",
                       or_(and_(RoomMessage.sender_kind == "user", RoomMessage.kind == "text"),
                           and_(RoomMessage.sender_kind == "user", RoomMessage.kind == "voice",
                                RoomVoice.status == "done"),
                           and_(RoomMessage.sender_kind == "ai", RoomMessage.kind == "ai_answer")))
                .order_by(RoomMessage.seq.desc()).limit(limit))
        async with self._sm() as s:
            rows = (await s.execute(stmt)).all()
        lines = []
        for m, name in reversed(rows):
            if m.sender_kind == "ai":
                lines.append(Line(m.seq, None, AI_NAME, m.kind, m.text))
            elif m.sender_id is not None:
                lines.append(Line(m.seq, m.sender_id, name or "member", m.kind, m.text))
        return lines


@dataclass
class SummaryRunner:
    store: SummaryStore
    complete: Callable[[list[dict], int, float], Awaitable[str]]
    consume: Callable[[str, str, int], Awaitable[bool]]
    refund: Callable[[str, str], Awaitable[None]]
    template: Callable[[str], Awaitable[str | None]]
    room_info: Callable[[str], Awaitable[tuple[str, str, str] | None]]  # (level, scenario brief, "alice, bob")
    limits: Callable[[], RoomLimits]
    available: Callable[[], bool]  # settings.rooms_summary_available
    model: Callable[[], str]
    clock: Callable[[], datetime]
    owner_of: Callable[[str], Awaitable[int | None]] | None = None  # the room's owner, for the per-owner cap
    opened_of: Callable[[str], Awaitable[datetime | None]] | None = None  # reopen time, only for reopened rooms

    async def _claim_budget(self, room_id: str, limits: RoomLimits) -> list[tuple[str, str]] | None:
        """Per-owner daily count first (review m9), then the global one. Returns what was taken, None when out."""
        taken: list[tuple[str, str]] = []
        owner = await self.owner_of(room_id) if self.owner_of is not None else None
        if owner is not None:
            if not await self.consume(OWNER_SCOPE, str(owner), limits.summary_owner_daily):
                return None
            taken.append((OWNER_SCOPE, str(owner)))
        if not await self.consume(GLOBAL_SCOPE, GLOBAL_SUBJECT, limits.summary_global_daily):
            for scope, subject in taken:
                await self.refund(scope, subject)
            return None
        return [*taken, (GLOBAL_SCOPE, GLOBAL_SUBJECT)]

    async def run(self, room_id: str, *, resume: bool = False) -> str:
        """Claim and generate once; returns the final status. A room already done/skipped/pending (or out of
        attempts) is left as it is. `resume` re-claims a `pending` row left by a restart (startup only); one
        that has no attempts left is marked failed("restart") so it does not stay pending forever."""
        since = await self.opened_of(room_id) if self.opened_of is not None else None
        if not await self.store.start(room_id, self.clock(), self.limits().summary_attempts, resume=resume,
                                      since=since):
            row = await self.store.get(room_id)
            if row is None:
                return "none"
            if resume and row.status == "pending":
                await self.store.fail(room_id, "restart", self.clock())
                logger.info("rooms summary room=%s status=failed reason=restart", room_id)
                return "failed"
            return row.status
        return await self.generate(room_id)

    async def _end(self, room_id: str, status: str, reason: str) -> str:
        if status == "skipped":
            await self.store.skip(room_id, reason, self.clock())
        else:
            await self.store.fail(room_id, reason, self.clock())
        logger.info("rooms summary room=%s status=%s reason=%s", room_id, status, reason)
        return status

    async def generate(self, room_id: str) -> str:
        """Generate for a row the caller already claimed with `store.start` (status `pending`)."""
        try:
            status = await self._generate(room_id)
        except Exception as e:  # never leave a claimed row pending (DB hiccup, bad template, ...)
            logger.warning("rooms summary room=%s failed error=%s", room_id, type(e).__name__)
            try:
                await self.store.fail(room_id, "error", self.clock())
            except Exception:
                pass
            status = "failed"
        if self.store.take_rerun(room_id):  # a later close marked this run stale: regenerate with both sessions
            return await self.run(room_id)
        return status

    async def _generate(self, room_id: str) -> str:
        if not self.available():
            return await self._end(room_id, "skipped", "disabled")
        limits = self.limits()
        lines = await self.store.lines(room_id, limits.summary_context)
        if not eligible(lines, limits.summary_min_messages):
            return await self._end(room_id, "skipped", "few_messages")
        info = await self.room_info(room_id)
        if info is None:
            return await self._end(room_id, "skipped", "missing")
        taken = await self._claim_budget(room_id, limits)
        if taken is None:
            return await self._end(room_id, "skipped", "quota")
        level, scenario, members = info
        messages = assistant.summary_messages(level, scenario, members, build_chat(lines, limits.summary_max_chars),
                                              template=await self.template(PROMPT_KEY))
        try:
            metering.bind_user(None)
            with metering.feature_scope("rooms_summary"):
                raw = await self.complete(messages, assistant.SUMMARY_MAX_TOKENS, assistant.SUMMARY_TEMPERATURE)
        except Exception as e:
            logger.info("rooms summary upstream failed room=%s error=%s", room_id, type(e).__name__)
            for scope, subject in taken:
                await self.refund(scope, subject)
            return await self._end(room_id, "failed", "upstream")
        try:
            data = parse_summary(raw, lines)
        except SummaryFormatError:
            return await self._end(room_id, "failed", "format")
        await self.store.finish(room_id, data, self.model(), self.clock())
        logger.info("rooms summary room=%s status=done words=%d fixes=%d", room_id, len(data["words"]),
                    len(data["fixes"]))
        return "done"
