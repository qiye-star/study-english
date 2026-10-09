"""单个用户与全体的段位操作(管理后台 v2 spec §5.5–5.6)。

每个写函数先写审计(adjust_points 用审计 id 做 xp_events.ref_id)再改数据,由调用方提交(路由在
`ledger.user_lock(user_id)` 内提交,避免与同步互相覆盖)。减点不降级(R-1);重置前写快照,UNDO_DAYS 天内可撤销;
best_tier 是历史最高,重置不会降低它。"""
import re
import uuid
from datetime import datetime, timedelta

from sqlalchemy import delete, select, update

from app.admin import audit
from app.admin.audit import Actor
from app.core.db import insert_ignore
from app.core.quotas import overrides_for
from app.models import (
    AdminAudit, DailyUsage, PromotionMatch, RankProfile, RankProfileSnapshot, User, UserAchievement, XpEvent, iso_utc,
)
from app.rank import achievements, ledger
from app.rank import match as matches
from app.rank.scenarios import scenario_by_key
from app.rank.tiers import MASTER, TIERS, RankState, add_rp, at_gate, division_rp, tier_key
from app.services import usage
from app.services.stats import as_utc

UNDO_DAYS = 7
MAX_ADJUST = 1000
VOIDABLE = ("failed", "expired", "abandoned", "grading_failed")
PENALISED = ("failed", "expired", "abandoned")  # outcomes that cut rp and set a cooldown
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SEASON_KEY = re.compile(r"^season_[1-9]\d{0,3}_(" + "|".join(t.key for t in TIERS) + r")$")
SNAPSHOT_FIELDS = ("tier", "division", "rp", "stars", "best_tier", "tier_started_at", "cooldown_until")


class RankOpError(Exception):
    def __init__(self, status: int, error: str):
        super().__init__(error)
        self.status, self.error = status, error


def _iso(value: datetime | None) -> str | None:
    return iso_utc(value) if value is not None else None


def _state(p: RankProfile) -> dict:
    return {"tier": p.tier, "division": p.division, "rp": p.rp}


def profile_out(p: RankProfile, rules) -> dict:
    return {"tier": p.tier, "tier_key": tier_key(p.tier), "division": p.division, "rp": p.rp,
            "division_rp": division_rp(p.tier, rules=rules), "stars": p.stars, "best_tier": p.best_tier,
            "best_tier_key": tier_key(p.best_tier or 0), "tier_started_at": _iso(p.tier_started_at),
            "cooldown_until": _iso(p.cooldown_until), "at_gate": at_gate(ledger.state_of(p), rules=rules)}


async def _user(session, user_id: int) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise RankOpError(404, "User not found")
    return user


async def _existing_profile(session, user_id: int) -> RankProfile:
    await _user(session, user_id)
    profile = await session.get(RankProfile, user_id)
    if profile is None:
        raise RankOpError(404, "Rank profile not found")
    return profile


async def _profile(session, user_id: int, now: datetime) -> RankProfile:
    await _user(session, user_id)
    return await ledger.load_profile(session, user_id, now)


def match_row_out(m: PromotionMatch, rules=None) -> dict:
    try:
        title = scenario_by_key(m.scenario_key, rules=rules).title_zh
    except KeyError:
        title = m.scenario_key
    return {"id": m.id, "user_id": m.user_id, "status": m.status, "from_tier": tier_key(m.from_tier),
            "to_tier": tier_key(m.to_tier), "scenario_key": m.scenario_key, "scenario_title_zh": title,
            "total": m.total, "threshold": m.threshold, "attempt_no": m.attempt_no, "rules_version": m.rules_version,
            "started_at": _iso(m.started_at), "finished_at": _iso(m.finished_at)}


async def user_rank(session, user_id: int, now: datetime, rules, *, settings=None) -> dict:
    """Read-only view for the admin user page (never creates a profile)."""
    await _user(session, user_id)
    profile = await session.get(RankProfile, user_id)
    override = (await overrides_for(session, user_id, now)).get("rank_match_daily_attempts")
    limit = await ledger.daily_attempts(session, user_id, now, settings, rules=rules)
    day = usage.utc_day(now)
    used = int(await session.scalar(select(DailyUsage.count).where(
        DailyUsage.scope == "rank_match", DailyUsage.subject == str(user_id), DailyUsage.day == day)) or 0)
    out: dict = {"profile": None, "stage_tasks": [], "promotion": None,
                 "attempts_today": {"day": day, "used": used, "limit": limit, "left": max(0, limit - used)},
                 "quota_override": override}
    if profile is not None:
        tasks = await ledger.stage_progress_for(session, profile, rules=rules)
        promo = ledger.promotion_status(
            ledger.state_of(profile), tasks, now=now, cooldown_until=profile.cooldown_until,
            attempts_left=max(0, limit - used),
            available=settings.rank_match_available if settings is not None else True, rules=rules)
        out["profile"] = profile_out(profile, rules)
        out["stage_tasks"] = [{"key": t.key, "kind": t.kind, "done": t.done, "target": t.target,
                               "min_score": t.min_score, "complete": t.complete} for t in tasks]
        out["promotion"] = {"state": promo.state, "reason": promo.reason,
                            "cooldown_until": _iso(promo.cooldown_until), "attempts_left": promo.attempts_left,
                            "target_tier": None if promo.target_tier is None else tier_key(promo.target_tier)}
    events = (await session.scalars(select(XpEvent).where(XpEvent.user_id == user_id)
                                    .order_by(XpEvent.id.desc()).limit(10))).all()
    audit_ids = [int(e.ref_id.split(":", 1)[1]) for e in events
                 if e.kind == "admin_adjust" and e.ref_id.startswith("audit:") and e.ref_id[6:].isdigit()]
    notes = {}
    if audit_ids:
        notes = {r.id: r for r in (await session.scalars(select(AdminAudit).where(AdminAudit.id.in_(audit_ids)))).all()}
    out["recent_events"] = []
    for e in events:
        item = {"kind": e.kind, "points": e.points, "day": e.day, "tier": e.tier, "created_at": _iso(e.created_at)}
        if e.kind == "admin_adjust" and e.ref_id[6:].isdigit() and int(e.ref_id[6:]) in notes:
            row = notes[int(e.ref_id[6:])]
            item |= {"actor": row.actor, "reason": row.reason}
        out["recent_events"].append(item)
    rows = (await session.scalars(select(PromotionMatch).where(PromotionMatch.user_id == user_id)
                                  .order_by(PromotionMatch.started_at.desc()).limit(20))).all()
    out["matches"] = [match_row_out(m, rules) for m in rows]
    out["achievements"] = await achievements.listing(session, user_id)
    return out


async def clear_cooldown(session, actor: Actor, user_id: int) -> None:
    profile = await _existing_profile(session, user_id)
    await audit.record(session, actor, "rank.user.clear_cooldown", target_type="user", target_id=user_id,
                       before={"cooldown_until": _iso(profile.cooldown_until)})
    profile.cooldown_until = None


async def reset_attempts(session, actor: Actor, user_id: int, day: str) -> int:
    if not isinstance(day, str) or not _DAY.match(day):
        raise RankOpError(422, "Invalid day")
    await _user(session, user_id)
    await audit.record(session, actor, "rank.user.reset_attempts", target_type="user", target_id=user_id,
                       summary=f"day {day}")
    result = await session.execute(delete(DailyUsage).where(
        DailyUsage.scope == "rank_match", DailyUsage.subject == str(user_id), DailyUsage.day == day))
    return result.rowcount or 0


async def adjust_points(session, actor: Actor, user_id: int, delta: int, *, reason: str, now: datetime,
                        rules) -> dict:
    if isinstance(delta, bool) or not isinstance(delta, int) or delta == 0 or abs(delta) > MAX_ADJUST:
        raise RankOpError(422, "Invalid delta")
    profile = await _profile(session, user_id, now)
    before = _state(profile)
    state = ledger.state_of(profile)
    if delta > 0:
        state = add_rp(state, delta, rules=rules)
    else:
        state = RankState(state.tier, state.division, max(0, state.rp + delta), state.stars)  # never demotes (R-1)
    row = await audit.record(session, actor, "rank.user.adjust_points", target_type="user", target_id=user_id,
                             summary=f"delta {delta:+d}", before=before,
                             after={"tier": state.tier, "division": state.division, "rp": state.rp}, reason=reason)
    session.add(XpEvent(user_id=user_id, kind="admin_adjust", ref_id=f"audit:{row.id}", points=delta, score=None,
                        day=usage.utc_day(now), tier=profile.tier, created_at=now))
    ledger.apply_state(profile, state, now)
    await session.flush()
    return profile_out(profile, rules)


async def void_match(session, actor: Actor, match_id: str, *, reason: str, now: datetime, rules) -> dict:
    match = await session.get(PromotionMatch, match_id[:64])
    if match is None:
        raise RankOpError(404, "Match not found")
    if matches.is_busy(match.id):
        raise RankOpError(409, "Match is busy")
    if match.status not in VOIDABLE:
        raise RankOpError(409, "Match cannot be voided")
    profile = await session.get(RankProfile, match.user_id)
    before = {"status": match.status} | (_state(profile) if profile else {})
    restored = False
    if match.status in PENALISED and profile is not None and profile.tier == match.from_tier and profile.tier < MASTER:
        # a match only starts at the gate, so before the penalty the profile was division I, full
        ledger.apply_state(profile, RankState(profile.tier, 1, division_rp(profile.tier, rules=rules), profile.stars), now)
        profile.cooldown_until = None
        restored = True
    await audit.record(session, actor, "rank.match.void", target_type="match", target_id=match.id,
                       summary=f"{match.status} -> voided" + (" restored" if restored else ""), before=before,
                       after={"status": "voided"} | (_state(profile) if profile else {}), reason=reason)
    await session.execute(update(DailyUsage).where(
        DailyUsage.scope == "rank_match", DailyUsage.subject == str(match.user_id),
        DailyUsage.day == usage.utc_day(as_utc(match.started_at)), DailyUsage.count > 0)
        .values(count=DailyUsage.count - 1))
    match.status = "voided"
    match.finished_at = match.finished_at or now
    await session.flush()
    return match_row_out(match, rules) | {"restored": restored}


def _achievement_key_ok(key: str) -> bool:
    return isinstance(key, str) and (key in {a.key for a in achievements.CATALOG} or bool(_SEASON_KEY.match(key)))


async def set_achievement(session, actor: Actor, user_id: int, key: str, granted: bool, now: datetime) -> None:
    if not _achievement_key_ok(key):
        raise RankOpError(422, "Unknown achievement")
    await _user(session, user_id)
    await audit.record(session, actor, "rank.user.achievement", target_type="user", target_id=user_id,
                       summary=f"{'grant' if granted else 'revoke'} {key}", after={"key": key, "granted": granted})
    if granted:
        await session.execute(insert_ignore(session, UserAchievement).values(user_id=user_id, key=key, unlocked_at=now))
    else:
        await session.execute(delete(UserAchievement).where(UserAchievement.user_id == user_id,
                                                            UserAchievement.key == key))


def _snapshot(p: RankProfile) -> dict:
    return {k: (_iso(getattr(p, k)) if isinstance(getattr(p, k), datetime) else getattr(p, k)) for k in SNAPSHOT_FIELDS}


def _reset(p: RankProfile, tier: int, division: int, rp: int, now: datetime) -> None:
    p.tier, p.division, p.rp, p.stars = tier, division, rp, 0
    p.best_tier = max(p.best_tier or 0, tier)
    p.tier_started_at, p.cooldown_until, p.updated_at = now, None, now


async def reset_user(session, actor: Actor, user_id: int, *, tier: int = 0, division: int = 3, rp: int = 0,
                     reason: str, now: datetime, rules) -> str:
    if not 0 <= tier <= MASTER:
        raise RankOpError(422, "Invalid tier")
    if tier == MASTER:
        division = 0
        if not 0 <= rp < division_rp(tier, rules=rules):
            raise RankOpError(422, "Invalid rp")
    else:
        if division not in (1, 2, 3):
            raise RankOpError(422, "Invalid division")
        if not 0 <= rp <= division_rp(tier, rules=rules) or (division > 1 and rp >= division_rp(tier, rules=rules)):
            raise RankOpError(422, "Invalid rp")
    profile = await _profile(session, user_id, now)
    batch = str(uuid.uuid4())
    session.add(RankProfileSnapshot(batch_id=batch, user_id=user_id, data=_snapshot(profile), at=now))
    before = _state(profile)
    _reset(profile, tier, division, rp, now)
    await audit.record(session, actor, "rank.user.reset", target_type="user", target_id=user_id,
                       summary=f"{tier_key(tier)} {division} {rp}", before=before, after=_state(profile) | {"batch": batch},
                       reason=reason)
    await session.flush()
    return batch


async def reset_all(session, actor: Actor, *, reason: str, now: datetime) -> tuple[str, int]:
    batch = str(uuid.uuid4())
    profiles = (await session.scalars(select(RankProfile))).all()
    for p in profiles:
        session.add(RankProfileSnapshot(batch_id=batch, user_id=p.user_id, data=_snapshot(p), at=now))
        _reset(p, 0, 3, 0, now)
    await audit.record(session, actor, "rank.reset_all", target_type="rank", summary=f"{len(profiles)} users",
                       after={"batch": batch, "users": len(profiles)}, reason=reason)
    await session.flush()
    return batch, len(profiles)


async def latest_reset(session, now: datetime) -> dict | None:
    """The newest snapshot batch still inside the undo window (for the overview's undo button)."""
    row = await session.scalar(select(RankProfileSnapshot).order_by(RankProfileSnapshot.id.desc()).limit(1))
    if row is None or now - as_utc(row.at) > timedelta(days=UNDO_DAYS):
        return None
    n = len((await session.scalars(select(RankProfileSnapshot.id).where(RankProfileSnapshot.batch_id == row.batch_id))).all())
    return {"batch_id": row.batch_id, "at": _iso(row.at), "users": n,
            "undo_until": _iso(as_utc(row.at) + timedelta(days=UNDO_DAYS))}


async def undo_reset(session, actor: Actor, batch_id: str, now: datetime) -> int:
    rows = (await session.scalars(select(RankProfileSnapshot).where(RankProfileSnapshot.batch_id == batch_id[:36]))).all()
    if not rows:
        raise RankOpError(404, "Snapshot not found")
    if now - min(as_utc(r.at) for r in rows) > timedelta(days=UNDO_DAYS):
        raise RankOpError(410, "Snapshot expired")
    restored = 0
    for r in rows:
        p = await session.get(RankProfile, r.user_id)
        if p is None:
            continue
        for k in SNAPSHOT_FIELDS:
            value = r.data.get(k)
            if k in ("tier_started_at", "cooldown_until") and value is not None:
                value = datetime.fromisoformat(value.replace("Z", "+00:00"))
            setattr(p, k, value)
        p.updated_at = now
        restored += 1
    await audit.record(session, actor, "rank.reset.undo", target_type="rank", target_id=batch_id,
                       summary=f"{restored} users")
    await session.execute(delete(RankProfileSnapshot).where(RankProfileSnapshot.batch_id == batch_id[:36]))
    await session.flush()
    return restored


async def clear_all_cooldowns(session, actor: Actor, *, reason: str) -> int:
    n = len((await session.scalars(select(RankProfile.user_id).where(RankProfile.cooldown_until.is_not(None)))).all())
    await audit.record(session, actor, "rank.clear_cooldowns", target_type="rank", summary=f"{n} users", reason=reason)
    await session.execute(update(RankProfile).where(RankProfile.cooldown_until.is_not(None)).values(cooldown_until=None))
    return n
