"""/api/admin/* 段位规则与段位操作(管理后台 v2 spec §5,lane rank C5)。薄路由:逻辑在 app/admin/rank_*。

角色(spec §4.2):查看 viewer;草稿与单人操作 operator;单人重置/定级 operator + 二次验证;发布、全体重置与撤销
superadmin + 二次验证。RANK_ENABLED=false 时照常可用(开放前先配置规则)。每个写操作在同一事务写审计。"""
from contextlib import AsyncExitStack
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from pydantic import AfterValidator, BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import audit, rank_ops
from app.admin import rank_rules_admin as rra
from app.admin.perms import AdminContext, require, require_operator_step_up, require_step_up
from app.admin.rank_sim import simulate
from app.core.deps import get_session
from app.models import AdminAudit, PromotionMatch, RankProfile, iso_utc
from app.rank import ledger
from app.rank import match as matches
from app.rank.rules_store import rank_rules
from app.rank.scenarios import scenario_by_key
from app.rank.tiers import TIERS, tier_key

router = APIRouter(prefix="/api/admin")
MATCHES_PER_PAGE = 50


class DraftIn(BaseModel):
    from_version: int | None = Field(None, ge=1)


class DraftSaveIn(BaseModel):
    rules: dict
    note: str = Field("", max_length=200)


def _reason(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("Reason is required")
    return v


Reason = Annotated[str, Field(max_length=200), AfterValidator(_reason)]


class ReasonIn(BaseModel):
    reason: Reason


class DayIn(BaseModel):
    day: str = Field(max_length=10)


class AdjustIn(ReasonIn):
    delta: int = Field(ge=-1000, le=1000)


class AchievementIn(BaseModel):
    key: str = Field(max_length=48)
    granted: bool


class ResetIn(ReasonIn):
    tier: int = Field(0, ge=0, le=6)
    division: int = Field(3, ge=0, le=3)
    rp: int = Field(0, ge=0, le=2000)


class ResetAllIn(ReasonIn):
    confirm: str = Field("", max_length=40)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _error(e: Exception) -> JSONResponse:
    if isinstance(e, rra.RulesError):
        body: dict = {"error": e.error}
        if e.details and "fields" in e.details:
            body["fields"] = e.details["fields"]
        elif e.details:
            body["details"] = e.details
        return JSONResponse(body, status_code=e.status)
    if isinstance(e, rank_ops.RankOpError):
        return JSONResponse({"error": e.error}, status_code=e.status)
    raise e


# ---- rules ----------------------------------------------------------------------------------------------------

@router.get("/rank/rules")
async def rules_overview(request: Request, _: AdminContext = Depends(require("viewer")),
                         session: AsyncSession = Depends(get_session)):
    cache = rank_rules(request.app)
    out = await rra.overview(session, cache)
    current = (await cache.current())[1]
    out["season_started"] = _now().date() >= current.season.anchor
    return out


@router.get("/rank/rules/versions/{version}")
async def rules_version(version: int, _: AdminContext = Depends(require("viewer")),
                        session: AsyncSession = Depends(get_session)):
    try:
        return await rra.version_detail(session, version)
    except rra.RulesError as e:
        return _error(e)


@router.post("/rank/rules/draft", status_code=201)
async def draft_create(body: DraftIn, request: Request, ctx: AdminContext = Depends(require("operator")),
                       session: AsyncSession = Depends(get_session)):
    try:
        row = await rra.create_draft(session, ctx.actor, from_version=body.from_version, cache=rank_rules(request.app))
    except rra.RulesError as e:
        return _error(e)
    return {"rules": row.rules, "note": row.note}


@router.put("/rank/rules/draft")
async def draft_save(body: DraftSaveIn, ctx: AdminContext = Depends(require("operator")),
                     session: AsyncSession = Depends(get_session)):
    try:
        row = await rra.save_draft(session, ctx.actor, body.rules, body.note)
    except rra.RulesError as e:
        return _error(e)
    return {"rules": row.rules, "note": row.note}


@router.delete("/rank/rules/draft", status_code=204)
async def draft_delete(ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    try:
        await rra.delete_draft(session, ctx.actor)
    except rra.RulesError as e:
        return _error(e)


@router.post("/rank/rules/draft/validate")
async def draft_validate(request: Request, _: AdminContext = Depends(require("operator")),
                         session: AsyncSession = Depends(get_session)):
    try:
        return {"errors": await rra.validate_draft(session, rank_rules(request.app), _now().date())}
    except rra.RulesError as e:
        return _error(e)


@router.post("/rank/rules/draft/simulate")
async def draft_simulate(request: Request, _: AdminContext = Depends(require("operator")),
                         session: AsyncSession = Depends(get_session)):
    try:
        draft = await rra.draft_rules(session)
    except rra.RulesError as e:
        return _error(e)
    return await simulate(session, draft, (await rank_rules(request.app).current())[1], _now())


@router.post("/rank/rules/draft/publish")
async def draft_publish(body: ReasonIn, request: Request, ctx: AdminContext = Depends(require_step_up),
                        session: AsyncSession = Depends(get_session)):
    try:
        return {"version": await rra.publish(session, request.app, ctx.actor, reason=body.reason)}
    except rra.RulesError as e:
        return _error(e)


# ---- overview & everyone ----------------------------------------------------------------------------------------

@router.get("/rank/overview")
async def overview(_: AdminContext = Depends(require("viewer")), session: AsyncSession = Depends(get_session)):
    now = _now()
    by_tier = dict((await session.execute(select(RankProfile.tier, func.count()).group_by(RankProfile.tier))).all())
    since = now - timedelta(days=7)
    statuses = dict((await session.execute(
        select(PromotionMatch.status, func.count()).where(PromotionMatch.started_at >= since)
        .group_by(PromotionMatch.status))).all())
    active = await session.scalar(select(func.count()).select_from(PromotionMatch)
                                  .where(PromotionMatch.status == "active")) or 0
    cooldown = await session.scalar(select(func.count()).select_from(RankProfile)
                                    .where(RankProfile.cooldown_until > now)) or 0
    profiles = sum(by_tier.values())
    return {
        "tiers": [{"key": t.key, "users": int(by_tier.get(t.index, 0))} for t in TIERS],
        "profiles": profiles,
        "matches_7d": {k: int(statuses.get(k, 0)) for k in ("passed", "failed", "grading_failed", "voided")},
        "active_matches": int(active), "cooldown_users": int(cooldown),
        "reset_confirm": f"RESET {profiles} USERS",
        "last_reset": await rank_ops.latest_reset(session, now),
    }


@router.post("/rank/reset-all")
async def reset_all(body: ResetAllIn, ctx: AdminContext = Depends(require_step_up),
                    session: AsyncSession = Depends(get_session)):
    n = await session.scalar(select(func.count()).select_from(RankProfile)) or 0
    expected = f"RESET {n} USERS"
    if body.confirm != expected:
        return JSONResponse({"error": "Confirmation required", "details": {"confirm": expected}}, status_code=409)
    ids = list((await session.scalars(select(RankProfile.user_id))).all())

    async def op():
        batch, users = await rank_ops.reset_all(session, ctx.actor, reason=body.reason, now=_now())
        return {"batch_id": batch, "users": users}
    return await _users_op(ids, session, op)


@router.post("/rank/reset-all/{batch_id}/undo")
async def reset_all_undo(batch_id: str, ctx: AdminContext = Depends(require_step_up),
                         session: AsyncSession = Depends(get_session)):
    ids = await rank_ops.batch_users(session, batch_id)

    async def op():
        restored, skipped = await rank_ops.undo_reset(session, ctx.actor, batch_id, _now())
        return {"users": restored, "skipped": skipped}
    return await _users_op(ids, session, op)


async def _users_op(user_ids: list[int], session: AsyncSession, op):
    """Bulk profile edits hold every affected user's sync lock (ascending ids, so two bulk ops cannot deadlock)
    across the commit, like `_user_op` (review m2)."""
    async with AsyncExitStack() as stack:
        for uid in sorted(set(user_ids)):
            await stack.enter_async_context(ledger.user_lock(uid))
        try:
            out = await op()
        except rank_ops.RankOpError as e:
            await session.rollback()
            return _error(e)
        await session.commit()
        return out


@router.post("/rank/clear-cooldowns")
async def clear_cooldowns(body: ReasonIn, ctx: AdminContext = Depends(require("operator")),
                          session: AsyncSession = Depends(get_session)):
    n = await rank_ops.clear_all_cooldowns(session, ctx.actor, reason=body.reason)
    await session.commit()
    return {"users": n}


# ---- one user ---------------------------------------------------------------------------------------------------

@router.get("/users/{user_id}/rank")
async def user_rank(user_id: int, request: Request, _: AdminContext = Depends(require("viewer")),
                    session: AsyncSession = Depends(get_session)):
    rules = (await rank_rules(request.app).current())[1]
    try:
        return await rank_ops.user_rank(session, user_id, _now(), rules, settings=request.app.state.settings)
    except rank_ops.RankOpError as e:
        return _error(e)


async def _user_op(user_id: int, session: AsyncSession, op):
    """Run a profile edit and commit while holding the user's sync lock (no lost update against /api/rank/me)."""
    async with ledger.user_lock(user_id):
        try:
            out = await op()
        except rank_ops.RankOpError as e:
            await session.rollback()
            return _error(e)
        await session.commit()
        return out


@router.post("/users/{user_id}/rank/clear-cooldown", status_code=204)
async def user_clear_cooldown(user_id: int, ctx: AdminContext = Depends(require("operator")),
                              session: AsyncSession = Depends(get_session)):
    return await _user_op(user_id, session, lambda: rank_ops.clear_cooldown(session, ctx.actor, user_id))


@router.post("/users/{user_id}/rank/reset-attempts")
async def user_reset_attempts(user_id: int, body: DayIn, ctx: AdminContext = Depends(require("operator")),
                              session: AsyncSession = Depends(get_session)):
    async def op():
        return {"deleted": await rank_ops.reset_attempts(session, ctx.actor, user_id, body.day)}
    return await _user_op(user_id, session, op)


@router.post("/users/{user_id}/rank/adjust")
async def user_adjust(user_id: int, body: AdjustIn, request: Request, ctx: AdminContext = Depends(require("operator")),
                      session: AsyncSession = Depends(get_session)):
    rules = (await rank_rules(request.app).current())[1]
    return await _user_op(user_id, session, lambda: rank_ops.adjust_points(
        session, ctx.actor, user_id, body.delta, reason=body.reason, now=_now(), rules=rules))


@router.post("/users/{user_id}/rank/achievement", status_code=204)
async def user_achievement(user_id: int, body: AchievementIn, ctx: AdminContext = Depends(require("operator")),
                           session: AsyncSession = Depends(get_session)):
    return await _user_op(user_id, session, lambda: rank_ops.set_achievement(
        session, ctx.actor, user_id, body.key, body.granted, _now()))


@router.post("/users/{user_id}/rank/reset")
async def user_reset(user_id: int, body: ResetIn, request: Request, ctx: AdminContext = Depends(require_operator_step_up),
                     session: AsyncSession = Depends(get_session)):
    rules = (await rank_rules(request.app).current())[1]

    async def op():
        return {"batch_id": await rank_ops.reset_user(
            session, ctx.actor, user_id, tier=body.tier, division=body.division, rp=body.rp, reason=body.reason,
            now=_now(), rules=rules)}
    return await _user_op(user_id, session, op)


# ---- matches ----------------------------------------------------------------------------------------------------

@router.get("/rank/matches")
async def match_list(request: Request, user_id: int | None = Query(None), status: str | None = Query(None, max_length=16),
                     page: int = Query(1, ge=1, le=10000), _: AdminContext = Depends(require("viewer")),
                     session: AsyncSession = Depends(get_session)):
    """No transcripts here: only the detail endpoint shows them (and audits the view)."""
    query = select(PromotionMatch).order_by(PromotionMatch.started_at.desc())
    if user_id is not None:
        query = query.where(PromotionMatch.user_id == user_id)
    if status:
        query = query.where(PromotionMatch.status == status)
    rows = (await session.scalars(query.offset((page - 1) * MATCHES_PER_PAGE).limit(MATCHES_PER_PAGE + 1))).all()
    cache = rank_rules(request.app)
    items = []
    for m in rows[:MATCHES_PER_PAGE]:
        rules = await _match_rules(cache, m)
        items.append(rank_ops.match_row_out(m, rules))
    return {"items": items, "page": page, "next": page + 1 if len(rows) > MATCHES_PER_PAGE else None}


async def _match_rules(cache, m: PromotionMatch):
    try:
        return await cache.for_version(m.rules_version)
    except KeyError:
        return None


async def _get_match(session: AsyncSession, match_id: str) -> PromotionMatch | None:
    return await session.get(PromotionMatch, match_id[:64])


@router.get("/rank/matches/{match_id}")
async def match_detail(match_id: str, request: Request, ctx: AdminContext = Depends(require("viewer")),
                       session: AsyncSession = Depends(get_session)):
    m = await _get_match(session, match_id)
    if m is None:
        return JSONResponse({"error": "Match not found"}, status_code=404)
    seen = await session.scalar(select(AdminAudit.id).where(
        AdminAudit.action == "rank.match.view", AdminAudit.session_id == ctx.session.id,
        AdminAudit.target_id == m.id).limit(1))
    if seen is None:  # the transcript is user content: log the first view per session
        await audit.record(session, ctx.actor, "rank.match.view", target_type="match", target_id=m.id)
        await session.commit()
    rules = await _match_rules(rank_rules(request.app), m)
    try:
        s = scenario_by_key(m.scenario_key, rules=rules)
        scenario = {"key": s.key, "title_zh": s.title_zh, "title_en": s.title_en, "brief_zh": s.brief_zh,
                    "role": s.role, "setting": s.setting, "functions": list(s.functions)}
    except KeyError:
        scenario = {"key": m.scenario_key, "title_zh": m.scenario_key, "title_en": "", "brief_zh": "", "role": "",
                    "setting": "", "functions": []}
    return {
        "match": rank_ops.match_row_out(m, rules) | {
            "turn_limit": m.turn_limit, "expires_at": iso_utc(m.expires_at), "grade_attempts": m.grade_attempts,
            "turns": [{k: t.get(k) for k in ("role", "text", "pron", "fluency", "english", "echo", "short", "duration_ms")}
                      for t in m.turns or [] if isinstance(t, dict)]},
        "scenario": scenario,
        "result": m.result,
        "user_id": m.user_id,
    }


@router.post("/rank/matches/{match_id}/void")
async def match_void(match_id: str, body: ReasonIn, request: Request, ctx: AdminContext = Depends(require("operator")),
                     session: AsyncSession = Depends(get_session)):
    m = await _get_match(session, match_id)
    if m is None:
        return JSONResponse({"error": "Match not found"}, status_code=404)
    rules = await _match_rules(rank_rules(request.app), m)
    rules = rules if rules is not None else (await rank_rules(request.app).current())[1]
    return await _user_op(m.user_id, session, lambda: rank_ops.void_match(
        session, ctx.actor, m.id, reason=body.reason, now=_now(), rules=rules))


@router.post("/rank/matches/{match_id}/regrade")
async def match_regrade(match_id: str, request: Request, ctx: AdminContext = Depends(require("operator")),
                        session: AsyncSession = Depends(get_session)):
    from app.routers.rank import MATCH_ERRORS, build_deps

    m = await _get_match(session, match_id)
    if m is None:
        return JSONResponse({"error": "Match not found"}, status_code=404)
    if m.status != "grading_failed":
        return JSONResponse({"error": "Only matches whose grading failed can be re-graded"}, status_code=409)
    settings = request.app.state.settings
    rules = None if m.rules_version is None else await _match_rules(rank_rules(request.app), m)
    profile = await ledger.load_profile(session, m.user_id, _now())
    try:
        verdict = await matches.finish_match(session, build_deps(request, settings, m.user_id), m, profile, _now(),
                                             settings, rules=rules)
    except matches.MatchError as e:
        await audit.record(session, ctx.actor, "rank.match.regrade", target_type="match", target_id=m.id,
                           summary=e.code, result="error")
        await session.commit()
        status, message = MATCH_ERRORS[e.code]
        return JSONResponse({"error": message}, status_code=status)
    await audit.record(session, ctx.actor, "rank.match.regrade", target_type="match", target_id=m.id,
                       summary=f"{m.status} total {m.total}")
    await session.commit()
    return {"status": m.status, "total": m.total, "result": verdict, "new_tier": tier_key(profile.tier)}
