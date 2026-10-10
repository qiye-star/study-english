"""Incremental RP sync from existing tables into `xp_events` (spec 2026-10-09 §2.2, plan P-1).

Each sync scans rows created since the profile's watermark (first sync: the last 14 days), at most
MAX_SYNC_ROWS per source. Events are idempotent by (user_id, kind, ref_id). Never logs user content."""
import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.quotas import quota_for
from app.models import Assessment, Conversation, Message, RankProfile, VocabularyItem, WordbookEvent, XpEvent
from app.rank import points as rules
from app.rank.points import EventRow, TaskProgress, stage_progress
from app.rank.tiers import MASTER, RankState, Season, add_rp, at_gate, clamp_rp
from app.services import usage
from app.services.stats import as_utc

SYNC_LOOKBACK_DAYS = 14
MAX_SYNC_ROWS = 2000
SAFETY = timedelta(seconds=30)
_sync_locks: dict[int, list] = {}  # user_id -> [asyncio.Lock, holders + waiters]


def state_of(p: RankProfile) -> RankState:
    return RankState(p.tier, p.division, p.rp, p.stars)


def apply_state(p: RankProfile, s: RankState, now: datetime) -> None:
    p.tier, p.division, p.rp, p.stars = s.tier, s.division, s.rp, s.stars
    p.best_tier = max(p.best_tier or 0, s.tier)
    p.updated_at = now


def blank_profile(user_id: int, now: datetime) -> RankProfile:
    """A new learner's profile, not added to any session."""
    return RankProfile(user_id=user_id, tier=0, division=3, rp=0, stars=0, best_tier=0,
                       tier_started_at=now - timedelta(days=SYNC_LOOKBACK_DAYS), updated_at=now)


async def load_profile(session: AsyncSession, user_id: int, now: datetime) -> RankProfile:
    profile = await session.get(RankProfile, user_id)
    if profile is not None:
        return profile
    profile = blank_profile(user_id, now)
    session.add(profile)
    try:
        await session.flush()
    except IntegrityError:  # a concurrent request created it first
        await session.rollback()
        profile = await session.get(RankProfile, user_id)
    return profile


def _score(scores: object) -> int | None:
    value = scores.get("pronunciation_score") if isinstance(scores, dict) else None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return round(value)


async def _collect(session: AsyncSession, user_id: int, since: datetime, now: datetime,
                   offset: int, rank_rules=None) -> tuple[list[rules.Candidate], datetime]:
    out: list[rules.Candidate] = []
    watermark = now - SAFETY
    a_rows = (await session.execute(
        select(Assessment.id, Assessment.created_at, Assessment.source, Assessment.scores)
        .where(Assessment.user_id == user_id, Assessment.created_at >= since)
        .order_by(Assessment.created_at).limit(MAX_SYNC_ROWS))).all()
    for id_, at, source, scores in a_rows:
        score = _score(scores)
        kind = "voice_turn" if source == "chat" else "assessment"
        out.append(rules.Candidate(kind, id_, usage.local_day(at, offset), rules.assessment_points(score, rules=rank_rules),
                                   score, as_utc(at)))
    m_rows = (await session.execute(
        select(Message.id, Message.created_at).join(Conversation, Conversation.id == Message.conversation_id)
        .where(Conversation.user_id == user_id, Message.role == "user", Message.created_at >= since)
        .order_by(Message.created_at).limit(MAX_SYNC_ROWS))).all()
    for id_, at in m_rows:
        out.append(rules.Candidate("chat_turn", id_, usage.local_day(at, offset), rules.points_for("chat_turn", rules=rank_rules), None,
                                   as_utc(at)))
    v_rows = (await session.execute(
        select(VocabularyItem.id, VocabularyItem.reps, VocabularyItem.last_reviewed_at)
        .where(VocabularyItem.user_id == user_id, VocabularyItem.last_reviewed_at >= since)
        .order_by(VocabularyItem.last_reviewed_at).limit(MAX_SYNC_ROWS))).all()
    for id_, reps, at in v_rows:
        out.append(rules.Candidate("vocab_review", f"{id_}:{reps}", usage.local_day(at, offset),
                                   rules.points_for("vocab_review", rules=rank_rules), None, as_utc(at)))
    # wordbook (spec 2026-10-10-wordbook §8): read the table through app.models only, never import app.wordbook
    w_rows = (await session.execute(
        select(WordbookEvent.id, WordbookEvent.kind, WordbookEvent.created_at)
        .where(WordbookEvent.user_id == user_id, WordbookEvent.kind.in_(("learn", "spell_set")),
               WordbookEvent.created_at >= since)
        .order_by(WordbookEvent.created_at).limit(MAX_SYNC_ROWS))).all()
    for id_, kind, at in w_rows:
        name, prefix = ("word_learned", "wl") if kind == "learn" else ("spelling_set", "ws")
        out.append(rules.Candidate(name, f"{prefix}:{id_}", usage.local_day(at, offset),
                                   rules.points_for(name, rules=rank_rules), None, as_utc(at)))
    for rows in (a_rows, m_rows, v_rows, w_rows):
        if len(rows) >= MAX_SYNC_ROWS:  # the timestamp is the last column of v_rows / w_rows, the second elsewhere
            last = rows[-1][-1] if (rows is v_rows or rows is w_rows) else rows[-1][1]
            watermark = min(watermark, as_utc(last))
    return out, watermark


@asynccontextmanager
async def _user_lock(user_id: int) -> AsyncIterator[None]:
    entry = _sync_locks.setdefault(user_id, [asyncio.Lock(), 0])
    entry[1] += 1
    try:
        async with entry[0]:
            yield
    finally:
        entry[1] -= 1
        if entry[1] == 0:
            _sync_locks.pop(user_id, None)


def user_lock(user_id: int):
    """The per-user sync lock; admin profile edits hold it across their commit so a concurrent sync cannot overwrite
    them with a stale copy (single worker)."""
    return _user_lock(user_id)


async def sync(session: AsyncSession, user_id: int, now: datetime, offset_minutes: int, daily_cap: int, *,
               rules=None) -> RankProfile:
    """One sync per user at a time (single worker): concurrent /me requests would compute the same fresh events
    and the loser would hit the xp_events unique index (review #10).

    `rules` (admin v2): a RankRules; when given its `points.daily_cap` replaces `daily_cap`, points come from it and an
    rp above a (lowered) division_rp is clamped to the new size."""
    async with _user_lock(user_id):
        return await _sync(session, user_id, now, offset_minutes,
                           daily_cap if rules is None else rules.points.daily_cap, rules)


async def _sync(session: AsyncSession, user_id: int, now: datetime, offset_minutes: int, daily_cap: int,
                rank_rules=None) -> RankProfile:
    profile = await load_profile(session, user_id, now)
    since = as_utc(profile.synced_at) if profile.synced_at else now - timedelta(days=SYNC_LOOKBACK_DAYS)
    candidates, watermark = await _collect(session, user_id, since, now, offset_minutes, rank_rules)
    seen = set((await session.execute(select(XpEvent.kind, XpEvent.ref_id).where(
        XpEvent.user_id == user_id, XpEvent.created_at >= since - timedelta(seconds=1)))).all())
    fresh = [c for c in candidates if (c.kind, c.ref_id) not in seen]
    days = {c.day for c in fresh}
    used: dict[str, int] = {}
    if days:
        used = {d: int(p or 0) for d, p in (await session.execute(
            select(XpEvent.day, func.sum(XpEvent.points)).where(
                XpEvent.user_id == user_id, XpEvent.day.in_(days), XpEvent.kind.in_(rules.CAPPED))
            .group_by(XpEvent.day))).all()}
    events = rules.cap_daily(fresh, used, daily_cap)
    known_active = set((await session.scalars(select(XpEvent.ref_id).where(
        XpEvent.user_id == user_id, XpEvent.kind == "active_day"))).all())
    for day in sorted(days - known_active):
        first = min(c.created_at for c in fresh if c.day == day)
        events.append(rules.Candidate("active_day", day, day, rules.points_for("active_day", rules=rank_rules), None,
                                      first))
    active_dates = {date.fromisoformat(d) for d in known_active | {e.day for e in events if e.kind == "active_day"}}
    known_streaks = set((await session.scalars(select(XpEvent.ref_id).where(
        XpEvent.user_id == user_id, XpEvent.kind == "streak_7"))).all())
    for end in rules.streak_ends(active_dates):
        ref = f"streak:{end.isoformat()}"
        if ref not in known_streaks:
            events.append(rules.Candidate("streak_7", ref, end.isoformat(), rules.points_for("streak_7", rules=rank_rules),
                                          None, now))
    state = clamp_rp(state_of(profile), rules=rank_rules)
    for e in events:
        session.add(XpEvent(user_id=user_id, kind=e.kind, ref_id=e.ref_id, points=e.points, score=e.score,
                            day=e.day, tier=profile.tier, created_at=e.created_at))
        state = add_rp(state, e.points, rules=rank_rules)
    await session.flush()
    apply_state(profile, state, now)
    done_refs = set((await session.scalars(select(XpEvent.ref_id).where(
        XpEvent.user_id == user_id, XpEvent.kind == "stage_task"))).all())
    stage_points = rules.points_for("stage_task", rules=rank_rules)
    for task in await stage_progress_for(session, profile, rules=rank_rules):
        ref = f"{profile.tier}:{task.key}"
        if task.complete and ref not in done_refs:
            session.add(XpEvent(user_id=user_id, kind="stage_task", ref_id=ref, points=stage_points,
                                score=None, day=usage.local_day(now, offset_minutes), tier=profile.tier, created_at=now))
            apply_state(profile, add_rp(state_of(profile), stage_points, rules=rank_rules), now)
    profile.synced_at = watermark
    await session.commit()
    return profile


async def stage_progress_for(session: AsyncSession, profile: RankProfile, *, rules=None) -> list[TaskProgress]:
    # Spec §2.3 counts from tier_started_at: events are stamped with the tier at sync time, so activity done before a
    # promotion but synced after it would otherwise count for the new tier (review #17).
    rows = (await session.execute(select(XpEvent.kind, XpEvent.score, XpEvent.day, XpEvent.points).where(
        XpEvent.user_id == profile.user_id, XpEvent.tier == profile.tier,
        XpEvent.created_at >= profile.tier_started_at))).all()
    return stage_progress(profile.tier, [EventRow(k, s, d, p) for k, s, d, p in rows], rules=rules)


@dataclass(frozen=True)
class Promotion:
    state: str
    reason: str | None
    cooldown_until: datetime | None
    attempts_left: int
    target_tier: int | None


def promotion_status(state: RankState, tasks: list[TaskProgress], *, now: datetime,
                     cooldown_until: datetime | None, attempts_left: int, available: bool, rules=None) -> Promotion:
    target = None if state.tier >= MASTER else state.tier + 1

    def result(name: str, reason: str | None = None) -> Promotion:
        return Promotion(name, reason, cooldown_until if name == "cooldown" else None, attempts_left, target)

    if target is None:
        return result("max_tier")
    if not available:
        return result("unavailable")
    if not at_gate(state, rules=rules):
        return result("locked", "rp")
    if not all(t.complete for t in tasks):
        return result("locked", "tasks")
    if cooldown_until is not None and now < as_utc(cooldown_until):
        return result("cooldown")
    if attempts_left <= 0:
        return result("no_attempts")
    return result("eligible")


async def daily_attempts(session: AsyncSession, user_id: int, now: datetime, settings: Settings, *, rules=None) -> int:
    """Per-user override (user_quota_overrides, via core.quotas.quota_for) > the rules' daily_attempts >
    RANK_MATCH_DAILY_ATTEMPTS. Read uncached: start_match spends against it."""
    if rules is not None:
        settings = settings.model_copy(update={"rank_match_daily_attempts": rules.match.daily_attempts})
    return await quota_for(session, settings, user_id, "rank_match_daily_attempts", now)


async def promotion_for(session: AsyncSession, profile: RankProfile, now: datetime, settings: Settings, *,
                        rules=None) -> Promotion:
    """Match attempts are counted per UTC day: a client-supplied offset could otherwise span 3 dates (review #8)."""
    tasks = await stage_progress_for(session, profile, rules=rules)
    limit = await daily_attempts(session, profile.user_id, now, settings, rules=rules)
    left = await usage.remaining(session, "rank_match", str(profile.user_id), usage.utc_day(now), limit)
    return promotion_status(state_of(profile), tasks, now=now, cooldown_until=profile.cooldown_until,
                            attempts_left=left, available=settings.rank_match_available, rules=rules)


async def recent_events(session: AsyncSession, user_id: int, limit: int = 5) -> list[XpEvent]:
    return list((await session.scalars(select(XpEvent).where(XpEvent.user_id == user_id, XpEvent.points > 0)
                                       .order_by(XpEvent.id.desc()).limit(limit))).all())


async def season_rp(session: AsyncSession, user_id: int, season: Season | None) -> int:
    if season is None:
        return 0
    value = await session.scalar(select(func.sum(XpEvent.points)).where(
        XpEvent.user_id == user_id, XpEvent.day >= season.starts_on.isoformat(), XpEvent.day <= season.ends_on.isoformat()))
    return int(value or 0)
