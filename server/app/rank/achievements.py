"""Achievements (spec 2026-10-09 §4): static catalogue + dynamic season badges `season_{n}_{tier}`."""
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import insert_ignore
from app.models import PromotionMatch, RoomMember, RoomMessage, UserAchievement, XpEvent, iso_utc
from app.rank.tiers import TIERS, Season, season_of


@dataclass(frozen=True)
class Achievement:
    key: str
    group: str
    icon: str


@dataclass(frozen=True)
class Snapshot:
    best_streak: int = 0
    best_tier: int = 0
    promotions: int = 0
    first_try: int = 0
    best_pron: int = 0
    pron85: int = 0
    chat_turns: int = 0
    vocab_reviews: int = 0
    rooms_joined: int = 0
    assisted_sends: int = 0
    season_promotions: int = 0


_RULES: tuple[tuple[Achievement, Callable[[Snapshot], bool]], ...] = (
    (Achievement("streak_3", "streak", "flame"), lambda s: s.best_streak >= 3),
    (Achievement("streak_7", "streak", "flame"), lambda s: s.best_streak >= 7),
    (Achievement("streak_30", "streak", "flame"), lambda s: s.best_streak >= 30),
    (Achievement("streak_100", "streak", "flame"), lambda s: s.best_streak >= 100),
    (Achievement("first_promotion", "rank", "trending-up"), lambda s: s.promotions >= 1),
    (Achievement("first_try", "rank", "target"), lambda s: s.first_try >= 1),
    (Achievement("tier_gold", "rank", "shield-star"), lambda s: s.best_tier >= 2),
    (Achievement("tier_diamond", "rank", "diamond"), lambda s: s.best_tier >= 4),
    (Achievement("tier_master", "rank", "crown"), lambda s: s.best_tier >= 6),
    (Achievement("pron_90", "speech", "microphone"), lambda s: s.best_pron >= 90),
    (Achievement("pron_85_x20", "speech", "chart-line"), lambda s: s.pron85 >= 20),
    (Achievement("chat_100", "chat", "messages"), lambda s: s.chat_turns >= 100),
    (Achievement("vocab_100", "vocab", "cards"), lambda s: s.vocab_reviews >= 100),
    (Achievement("room_first", "rooms", "users-group"), lambda s: s.rooms_joined >= 1),
    (Achievement("room_assisted_10", "rooms", "wand"), lambda s: s.assisted_sends >= 10),
    (Achievement("season_climber", "season", "flag"), lambda s: s.season_promotions >= 1),
)
CATALOG: tuple[Achievement, ...] = tuple(a for a, _ in _RULES)
_BY_KEY = {a.key: a for a in CATALOG}


def earned(s: Snapshot) -> set[str]:
    return {a.key for a, rule in _RULES if rule(s)}


def longest_streak(days: set[date]) -> int:
    best = 0
    for day in days:
        if day - timedelta(days=1) in days:
            continue
        length = 0
        while day + timedelta(days=length) in days:
            length += 1
        best = max(best, length)
    return best


def _utc(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


async def _count(session: AsyncSession, stmt) -> int:
    return int(await session.scalar(stmt) or 0)


async def snapshot(session: AsyncSession, user_id: int, best_tier: int, season: Season | None) -> Snapshot:
    ev = XpEvent.user_id == user_id
    active = {date.fromisoformat(d) for d in (await session.scalars(
        select(XpEvent.day).where(ev, XpEvent.kind == "active_day"))).all()}
    passed = (PromotionMatch.user_id == user_id, PromotionMatch.status == "passed")
    season_promotions = 0
    if season is not None:
        season_promotions = await _count(session, select(func.count()).select_from(PromotionMatch).where(
            *passed, PromotionMatch.finished_at >= _utc(season.starts_on),
            PromotionMatch.finished_at < _utc(season.ends_on + timedelta(days=1))))
    return Snapshot(
        best_streak=longest_streak(active),
        best_tier=best_tier,
        promotions=await _count(session, select(func.count()).select_from(PromotionMatch).where(*passed)),
        first_try=await _count(session, select(func.count()).select_from(PromotionMatch).where(*passed, PromotionMatch.attempt_no == 1)),
        best_pron=await _count(session, select(func.max(XpEvent.score)).where(ev, XpEvent.kind == "assessment")),
        pron85=await _count(session, select(func.count()).select_from(XpEvent).where(ev, XpEvent.kind == "assessment", XpEvent.score >= 85)),
        chat_turns=await _count(session, select(func.count()).select_from(XpEvent).where(ev, XpEvent.kind == "chat_turn")),
        vocab_reviews=await _count(session, select(func.count()).select_from(XpEvent).where(ev, XpEvent.kind == "vocab_review")),
        rooms_joined=await _count(session, select(func.count()).select_from(RoomMember).where(RoomMember.user_id == user_id)),
        assisted_sends=await _count(session, select(func.count()).select_from(RoomMessage).where(
            RoomMessage.sender_id == user_id, RoomMessage.assisted.is_(True), RoomMessage.lane == "public")),
        season_promotions=season_promotions,
    )


async def season_badges(session: AsyncSession, user_id: int, today: date, anchor: date, weeks: int) -> set[str]:
    """For each ended season the user was active in: the highest tier held (xp_events.tier) or reached (passed matches)."""
    current = season_of(today, anchor, weeks)
    if current is None:
        return set()
    badges = set()
    for n in range(1, current.id):
        start = anchor + timedelta(days=(n - 1) * weeks * 7)
        end = start + timedelta(days=weeks * 7 - 1)
        held = await session.scalar(select(func.max(XpEvent.tier)).where(
            XpEvent.user_id == user_id, XpEvent.day >= start.isoformat(), XpEvent.day <= end.isoformat()))
        reached = await session.scalar(select(func.max(PromotionMatch.to_tier)).where(
            PromotionMatch.user_id == user_id, PromotionMatch.status == "passed",
            PromotionMatch.finished_at >= _utc(start), PromotionMatch.finished_at < _utc(end + timedelta(days=1))))
        best = max((v for v in (held, reached) if v is not None), default=None)
        if best is not None:
            badges.add(f"season_{n}_{TIERS[best].key}")
    return badges


async def unlock_new(session: AsyncSession, user_id: int, keys: set[str], now: datetime) -> list[str]:
    have = set((await session.scalars(select(UserAchievement.key).where(UserAchievement.user_id == user_id))).all())
    new = []
    for key in sorted(keys - have):  # ON CONFLICT DO NOTHING: a concurrent /me may unlock the same key (review #10)
        inserted = await session.execute(insert_ignore(session, UserAchievement).values(
            user_id=user_id, key=key, unlocked_at=now))
        if inserted.rowcount:
            new.append(key)
    if new:
        await session.commit()
    return new


def _season_meta(key: str) -> Achievement:
    tier = key.rsplit("_", 1)[1]
    icon = next((t.icon for t in TIERS if t.key == tier), "flag")
    return Achievement(key, "season", icon)


async def listing(session: AsyncSession, user_id: int) -> list[dict]:
    rows = {k: at for k, at in (await session.execute(select(UserAchievement.key, UserAchievement.unlocked_at)
                                                       .where(UserAchievement.user_id == user_id))).all()}
    items = [*CATALOG, *(_season_meta(k) for k in sorted(rows) if k.startswith("season_") and k not in _BY_KEY)]
    return [{"key": a.key, "group": a.group, "icon": a.icon,
             "unlocked_at": iso_utc(rows[a.key]) if a.key in rows else None} for a in items]
