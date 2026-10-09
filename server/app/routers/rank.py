"""Rank endpoints (spec 2026-10-09 §7.1). Off unless RANK_ENABLED; the config endpoint always answers.
Never logs transcripts or judge output; the WAV body is size-limited like /api/speech/assessments."""
import random
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import UploadFile

from app.core.config import Settings
from app.core.deps import current_user, get_session, get_settings, limited_user
from app.models import PromotionMatch, User, iso_utc, utcnow
from app.providers import llm
from app.providers.xfyun_result import to_assessment
from app.rank import achievements, ledger
from app.rank import match as matches
from app.rank.tiers import TIERS, Season, season_of, tier_key
from app.services.pronunciation import _ise_entry
from app.services.provider_clients import get_xfyun
from app.services.uploads import parse_buffered_form, read_limited_body
from app.services.usage import local_day
from app.speech.asr import make_transcriber, shared_asr_gate

router = APIRouter(prefix="/api/rank")
MAX_TURN_BYTES = 2 * 1024 * 1024  # 30 s of 16 kHz mono PCM16 is ~0.96 MB
MULTIPART_OVERHEAD = 64 * 1024
EXAMINER_MAX_TOKENS = 120
JUDGE_MAX_TOKENS = 700
ASSESS_TIMEOUT = 40.0
HISTORY_PER_PAGE = 20
TZ_OFFSET = Query(0, ge=-720, le=840)
MATCH_ERRORS: dict[str, tuple[int, str]] = {
    "in_progress": (409, "Match in progress"), "locked": (403, "Not eligible"), "max_tier": (403, "Not eligible"),
    "cooldown": (429, "Cooldown"), "no_attempts": (429, "No attempts left"),
    "unavailable": (503, "Promotion matches are not available"), "global_cap": (503, "Daily match limit reached"),
    "expired": (410, "Match expired"), "not_active": (409, "Match is not active"),
    "bad_audio": (400, "Expected 16 kHz mono WAV"), "too_short": (400, "Audio too short"),
    "too_long": (400, "Audio too long"), "upstream": (502, "Upstream unavailable"),
    "not_done": (409, "Match is not finished"), "grading_failed": (502, "Grading failed"),
}


def require_rank(settings: Settings = Depends(get_settings)) -> Settings:
    if not settings.rank_enabled:
        raise HTTPException(404, "Rank is disabled")
    return settings


def _raise(e: matches.MatchError):
    status, message = MATCH_ERRORS[e.code]
    raise HTTPException(status, message) from None


def build_deps(request: Request, settings: Settings, user_id: int) -> matches.MatchDeps:
    http = request.app.state.http
    transcribe = make_transcriber(http, settings, "en", gate=shared_asr_gate(request.app.state, settings), uid=str(user_id))
    xfyun = get_xfyun(request)

    async def assess(pcm: bytes, text: str) -> dict | None:
        if not xfyun.configured:
            return None
        return to_assessment(await xfyun.evaluate(pcm, text, _ise_entry("en"), timeout=ASSESS_TIMEOUT), text)

    async def examiner(messages: list[dict]) -> str:
        return await llm.complete(http, settings, messages, model=settings.default_llm_model,
                                  max_tokens=EXAMINER_MAX_TOKENS, temperature=0.7)

    async def judge(messages: list[dict]) -> str:
        return await llm.complete(http, settings, messages, model=settings.resolved_rank_judge_model,
                                  max_tokens=JUDGE_MAX_TOKENS, temperature=0)

    return matches.MatchDeps(transcribe, assess, examiner, judge)


def _season(settings: Settings, offset: int = 0) -> tuple[Season | None, dict | None]:
    today = date.fromisoformat(local_day(utcnow(), offset))
    season = season_of(today, settings.rank_season_anchor, settings.rank_season_weeks)
    return season, (None if season is None else
                    {"id": season.id, "starts_on": season.starts_on.isoformat(), "ends_on": season.ends_on.isoformat()})


@router.get("/config")
async def rank_config(_: User = Depends(current_user), settings: Settings = Depends(get_settings)):
    if not settings.rank_enabled:
        return {"enabled": False, "match_available": False, "tiers": [], "season": None}
    return {"enabled": True, "match_available": settings.rank_match_available,
            "tiers": [{"key": t.key, "index": t.index, "cefr": t.cefr, "divisions": t.divisions,
                       "division_rp": t.division_rp} for t in TIERS],
            "season": _season(settings)[1]}


@router.get("/me")
async def rank_me(tz_offset_minutes: int = TZ_OFFSET, user: User = Depends(current_user),
                  session: AsyncSession = Depends(get_session), settings: Settings = Depends(require_rank)):
    now = utcnow()
    profile = await ledger.sync(session, user.id, now, tz_offset_minutes, settings.rank_daily_rp_cap)
    tasks = await ledger.stage_progress_for(session, profile)
    promo = await ledger.promotion_for(session, profile, now, settings, tz_offset_minutes)
    season, season_json = _season(settings, tz_offset_minutes)
    snap = await achievements.snapshot(session, user.id, profile.best_tier, season)
    today = date.fromisoformat(local_day(now, tz_offset_minutes))
    keys = achievements.earned(snap) | await achievements.season_badges(
        session, user.id, today, settings.rank_season_anchor, settings.rank_season_weeks)
    new = await achievements.unlock_new(session, user.id, keys, now)
    current = await matches.active_match(session, user.id)
    events = await ledger.recent_events(session, user.id)
    return {
        "tier": tier_key(profile.tier), "tier_index": profile.tier, "division": profile.division, "rp": profile.rp,
        "division_rp": TIERS[profile.tier].division_rp, "stars": profile.stars,
        "stage_tasks": [{"key": t.key, "kind": t.kind, "done": t.done, "target": t.target, "min_score": t.min_score,
                         "complete": t.complete} for t in tasks],
        "promotion": {"state": promo.state, "reason": promo.reason,
                      "cooldown_until": iso_utc(promo.cooldown_until) if promo.cooldown_until else None,
                      "attempts_left": promo.attempts_left,
                      "target_tier": None if promo.target_tier is None else tier_key(promo.target_tier)},
        "season": season_json, "season_rp": await ledger.season_rp(session, user.id, season),
        "recent_events": [{"kind": e.kind, "points": e.points, "day": e.day, "created_at": iso_utc(e.created_at)}
                          for e in events],
        "new_achievements": new, "active_match_id": current.id if current else None,
    }


@router.get("/achievements")
async def rank_achievements(user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
                            _: Settings = Depends(require_rank)):
    return {"achievements": await achievements.listing(session, user.id)}


async def _owned(session: AsyncSession, user: User, match_id: str) -> PromotionMatch:
    row = await session.get(PromotionMatch, match_id[:64])
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "Match not found")
    return row


@router.post("/matches")
async def start(tz_offset_minutes: int = TZ_OFFSET, user: User = Depends(limited_user),
                session: AsyncSession = Depends(get_session), settings: Settings = Depends(require_rank)):
    try:
        row = await matches.start_match(session, user.id, utcnow(), settings=settings,
                                        offset_minutes=tz_offset_minutes, rng=random.Random())
    except matches.MatchError as e:
        _raise(e)
    return {"match": matches.match_out(row)}


@router.get("/matches")
async def history(page: int = Query(1, ge=1, le=1000), user: User = Depends(current_user),
                  session: AsyncSession = Depends(get_session), _: Settings = Depends(require_rank)):
    rows = (await session.scalars(
        select(PromotionMatch).where(PromotionMatch.user_id == user.id)
        .order_by(PromotionMatch.started_at.desc())
        .offset((page - 1) * HISTORY_PER_PAGE).limit(HISTORY_PER_PAGE + 1))).all()
    items = [{k: v for k, v in matches.match_out(r).items() if k != "turns"} | {"total": r.total}
             for r in rows[:HISTORY_PER_PAGE]]
    return {"matches": items, "page": page, "next": page + 1 if len(rows) > HISTORY_PER_PAGE else None}


@router.get("/matches/{match_id}")
async def get_match(match_id: str, user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
                    _: Settings = Depends(require_rank)):
    row = await _owned(session, user, match_id)
    return {"match": matches.match_out(row), "verdict": row.result}


async def _wav(request: Request) -> bytes:
    if not request.headers.get("content-type", "").lower().startswith("multipart/form-data"):
        raise HTTPException(400, "Expected multipart/form-data")
    body = await read_limited_body(request, MAX_TURN_BYTES + MULTIPART_OVERHEAD)
    form = await parse_buffered_form(request, body)
    try:
        upload = form.get("file")
        if not isinstance(upload, UploadFile):
            raise HTTPException(400, "Audio file is required")
        return await upload.read()
    finally:
        await form.close()


@router.post("/matches/{match_id}/turns")
async def turn(match_id: str, request: Request, user: User = Depends(limited_user),
               session: AsyncSession = Depends(get_session), settings: Settings = Depends(require_rank)):
    row = await _owned(session, user, match_id)
    wav = await _wav(request)
    profile = await ledger.load_profile(session, user.id, utcnow())
    try:
        return await matches.add_turn(session, build_deps(request, settings, user.id), row, profile, wav, utcnow(),
                                      settings)
    except matches.MatchError as e:
        _raise(e)


@router.post("/matches/{match_id}/finish")
async def finish(match_id: str, request: Request, user: User = Depends(limited_user),
                 session: AsyncSession = Depends(get_session), settings: Settings = Depends(require_rank)):
    row = await _owned(session, user, match_id)
    profile = await ledger.load_profile(session, user.id, utcnow())
    try:
        verdict = await matches.finish_match(session, build_deps(request, settings, user.id), row, profile, utcnow(),
                                             settings)
    except matches.MatchError as e:
        _raise(e)
    return {"match": matches.match_out(row), "verdict": verdict}


@router.post("/matches/{match_id}/abandon")
async def abandon(match_id: str, user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
                  settings: Settings = Depends(require_rank)):
    row = await _owned(session, user, match_id)
    profile = await ledger.load_profile(session, user.id, utcnow())
    try:
        await matches.abandon_match(session, row, profile, utcnow(), settings)
    except matches.MatchError as e:
        _raise(e)
    return {"match": matches.match_out(row)}
