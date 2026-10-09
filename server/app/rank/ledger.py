"""Incremental RP sync from existing tables into `xp_events` (spec 2026-10-09 §2.2, plan P-1).

Each sync scans rows created since the profile's watermark (first sync: the last 14 days), at most
MAX_SYNC_ROWS per source. Events are idempotent by (user_id, kind, ref_id). Never logs user content."""
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import Assessment, Conversation, Message, RankProfile, VocabularyItem, XpEvent
from app.rank import points as rules
from app.rank.tiers import MASTER, RankState, Season, add_rp, at_gate
from app.services import usage
from app.services.stats import as_utc

SYNC_LOOKBACK_DAYS = 14
MAX_SYNC_ROWS = 2000
SAFETY = timedelta(seconds=30)


def state_of(p: RankProfile) -> RankState:
    return RankState(p.tier, p.division, p.rp, p.stars)


def apply_state(p: RankProfile, s: RankState, now: datetime) -> None:
    p.tier, p.division, p.rp, p.stars = s.tier, s.division, s.rp, s.stars
    p.best_tier = max(p.best_tier or 0, s.tier)
    p.updated_at = now


async def load_profile(session: AsyncSession, user_id: int, now: datetime) -> RankProfile:
    profile = await session.get(RankProfile, user_id)
    if profile is not None:
        return profile
    profile = RankProfile(user_id=user_id, tier=0, division=3, rp=0, stars=0, best_tier=0,
                          tier_started_at=now - timedelta(days=SYNC_LOOKBACK_DAYS), updated_at=now)
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
                   offset: int) -> tuple[list[rules.Candidate], datetime]:
    out: list[rules.Candidate] = []
    watermark = now - SAFETY
    a_rows = (await session.execute(
        select(Assessment.id, Assessment.created_at, Assessment.source, Assessment.scores)
        .where(Assessment.user_id == user_id, Assessment.created_at >= since)
        .order_by(Assessment.created_at).limit(MAX_SYNC_ROWS))).all()
    for id_, at, source, scores in a_rows:
        score = _score(scores)
        kind = "voice_turn" if source == "chat" else "assessment"
        out.append(rules.Candidate(kind, id_, usage.local_day(at, offset), rules.assessment_points(score), score, as_utc(at)))
    m_rows = (await session.execute(
        select(Message.id, Message.created_at).join(Conversation, Conversation.id == Message.conversation_id)
        .where(Conversation.user_id == user_id, Message.role == "user", Message.created_at >= since)
        .order_by(Message.created_at).limit(MAX_SYNC_ROWS))).all()
    for id_, at in m_rows:
        out.append(rules.Candidate("chat_turn", id_, usage.local_day(at, offset), rules.POINTS["chat_turn"], None, as_utc(at)))
    v_rows = (await session.execute(
        select(VocabularyItem.id, VocabularyItem.reps, VocabularyItem.last_reviewed_at)
        .where(VocabularyItem.user_id == user_id, VocabularyItem.last_reviewed_at >= since)
        .order_by(VocabularyItem.last_reviewed_at).limit(MAX_SYNC_ROWS))).all()
    for id_, reps, at in v_rows:
        out.append(rules.Candidate("vocab_review", f"{id_}:{reps}", usage.local_day(at, offset),
                                   rules.POINTS["vocab_review"], None, as_utc(at)))
    for rows in (a_rows, m_rows, v_rows):
        if len(rows) >= MAX_SYNC_ROWS:
            watermark = min(watermark, as_utc(rows[-1][-1] if rows is v_rows else rows[-1][1]))
    return out, watermark


async def sync(session: AsyncSession, user_id: int, now: datetime, offset_minutes: int, daily_cap: int) -> RankProfile:
    profile = await load_profile(session, user_id, now)
    since = as_utc(profile.synced_at) if profile.synced_at else now - timedelta(days=SYNC_LOOKBACK_DAYS)
    candidates, watermark = await _collect(session, user_id, since, now, offset_minutes)
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
        events.append(rules.Candidate("active_day", day, day, rules.POINTS["active_day"], None, first))
    active_dates = {date.fromisoformat(d) for d in known_active | {e.day for e in events if e.kind == "active_day"}}
    known_streaks = set((await session.scalars(select(XpEvent.ref_id).where(
        XpEvent.user_id == user_id, XpEvent.kind == "streak_7"))).all())
    for end in rules.streak_ends(active_dates):
        ref = f"streak:{end.isoformat()}"
        if ref not in known_streaks:
            events.append(rules.Candidate("streak_7", ref, end.isoformat(), rules.POINTS["streak_7"], None, now))
    state = state_of(profile)
    for e in events:
        session.add(XpEvent(user_id=user_id, kind=e.kind, ref_id=e.ref_id, points=e.points, score=e.score,
                            day=e.day, tier=profile.tier, created_at=e.created_at))
        state = add_rp(state, e.points)
    await session.flush()
    apply_state(profile, state, now)
    done_refs = set((await session.scalars(select(XpEvent.ref_id).where(
        XpEvent.user_id == user_id, XpEvent.kind == "stage_task"))).all())
    for task in await stage_progress_for(session, profile):
        ref = f"{profile.tier}:{task.key}"
        if task.complete and ref not in done_refs:
            session.add(XpEvent(user_id=user_id, kind="stage_task", ref_id=ref, points=rules.POINTS["stage_task"],
                                score=None, day=usage.local_day(now, offset_minutes), tier=profile.tier, created_at=now))
            apply_state(profile, add_rp(state_of(profile), rules.POINTS["stage_task"]), now)
    profile.synced_at = watermark
    await session.commit()
    return profile


async def stage_progress_for(session: AsyncSession, profile: RankProfile) -> list[rules.TaskProgress]:
    rows = (await session.execute(select(XpEvent.kind, XpEvent.score, XpEvent.day).where(
        XpEvent.user_id == profile.user_id, XpEvent.tier == profile.tier))).all()
    return rules.stage_progress(profile.tier, [rules.EventRow(k, s, d) for k, s, d in rows])


@dataclass(frozen=True)
class Promotion:
    state: str
    reason: str | None
    cooldown_until: datetime | None
    attempts_left: int
    target_tier: int | None


def promotion_status(state: RankState, tasks: list[rules.TaskProgress], *, now: datetime,
                     cooldown_until: datetime | None, attempts_left: int, available: bool) -> Promotion:
    target = None if state.tier >= MASTER else state.tier + 1

    def result(name: str, reason: str | None = None) -> Promotion:
        return Promotion(name, reason, cooldown_until if name == "cooldown" else None, attempts_left, target)

    if target is None:
        return result("max_tier")
    if not available:
        return result("unavailable")
    if not at_gate(state):
        return result("locked", "rp")
    if not all(t.complete for t in tasks):
        return result("locked", "tasks")
    if cooldown_until is not None and now < as_utc(cooldown_until):
        return result("cooldown")
    if attempts_left <= 0:
        return result("no_attempts")
    return result("eligible")


async def promotion_for(session: AsyncSession, profile: RankProfile, now: datetime, settings: Settings,
                        offset_minutes: int) -> Promotion:
    tasks = await stage_progress_for(session, profile)
    left = await usage.remaining(session, "rank_match", str(profile.user_id), usage.local_day(now, offset_minutes),
                                 settings.rank_match_daily_attempts)
    return promotion_status(state_of(profile), tasks, now=now, cooldown_until=profile.cooldown_until,
                            attempts_left=left, available=settings.rank_match_available)


async def recent_events(session: AsyncSession, user_id: int, limit: int = 5) -> list[XpEvent]:
    return list((await session.scalars(select(XpEvent).where(XpEvent.user_id == user_id, XpEvent.points > 0)
                                       .order_by(XpEvent.id.desc()).limit(limit))).all())


async def season_rp(session: AsyncSession, user_id: int, season: Season | None) -> int:
    if season is None:
        return 0
    value = await session.scalar(select(func.sum(XpEvent.points)).where(
        XpEvent.user_id == user_id, XpEvent.day >= season.starts_on.isoformat(), XpEvent.day <= season.ends_on.isoformat()))
    return int(value or 0)
