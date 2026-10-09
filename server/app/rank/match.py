"""Promotion-match orchestration (spec 2026-10-09 §3, plan P-4/P-5). Upstreams are injected through
MatchDeps so tests never reach a vendor. Never logs transcripts, prompts or judge output."""
import logging
import random
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import PromotionMatch, RankProfile, iso_utc
from app.providers.llm import LlmUnavailable
from app.rank import grading, ledger
from app.rank.scenarios import pick_scenario, scenario_by_key
from app.rank.tiers import after_failed_match, promote, tier_key
from app.services import usage
from app.services.stats import as_utc
from app.speech.asr import AsrError
from app.speech.asr_stream import wav_to_pcm

logger = logging.getLogger(__name__)
ACTIVE = "active"
OPEN = ("active", "grading_failed")
RECENT_SCENARIOS = 3
PCM_BYTES_PER_SECOND = 32000
MAX_AI_LINE = 600
MAX_TRANSCRIPT = 2000


class MatchError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass
class MatchDeps:
    transcribe: Callable[[bytes], Awaitable[str]]
    assess: Callable[[bytes, str], Awaitable[dict | None]]
    examiner: Callable[[list[dict]], Awaitable[str]]
    judge: Callable[[list[dict]], Awaitable[str]]


def _user_turns(match: PromotionMatch) -> int:
    return sum(1 for t in match.turns if t["role"] == "user")


def _num(data: dict | None, key: str) -> float | None:
    value = data.get(key) if isinstance(data, dict) else None
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _fail(profile: RankProfile, now: datetime, settings: Settings) -> None:
    ledger.apply_state(profile, after_failed_match(ledger.state_of(profile)), now)
    profile.cooldown_until = now + timedelta(minutes=settings.rank_match_cooldown_minutes)


async def active_match(session: AsyncSession, user_id: int) -> PromotionMatch | None:
    return await session.scalar(select(PromotionMatch).where(
        PromotionMatch.user_id == user_id, PromotionMatch.status.in_(OPEN))
        .order_by(PromotionMatch.started_at.desc()).limit(1))


async def _expire_if_needed(session: AsyncSession, match: PromotionMatch, profile: RankProfile,
                            now: datetime, settings: Settings) -> bool:
    if match.status == ACTIVE and as_utc(match.expires_at) <= now:
        match.status, match.finished_at = "expired", now
        _fail(profile, now, settings)
        await session.commit()
        return True
    return False


async def start_match(session: AsyncSession, user_id: int, now: datetime, *, settings: Settings,
                      offset_minutes: int, rng: random.Random) -> PromotionMatch:
    profile = await ledger.sync(session, user_id, now, offset_minutes, settings.rank_daily_rp_cap)
    current = await active_match(session, user_id)
    if current is not None and not await _expire_if_needed(session, current, profile, now, settings):
        raise MatchError("in_progress")
    status = await ledger.promotion_for(session, profile, now, settings, offset_minutes)
    if status.state != "eligible":
        raise MatchError(status.state)
    utc_day, day = usage.utc_day(now), usage.local_day(now, offset_minutes)
    if not await usage.consume(session, "rank_match_global", "*", utc_day, settings.rank_matches_global_daily):
        raise MatchError("global_cap")
    if not await usage.consume(session, "rank_match", str(user_id), day, settings.rank_match_daily_attempts):
        await usage.refund(session, "rank_match_global", "*", utc_day)
        raise MatchError("no_attempts")
    target = profile.tier + 1
    recent = set((await session.scalars(select(PromotionMatch.scenario_key).where(PromotionMatch.user_id == user_id)
                                        .order_by(PromotionMatch.started_at.desc()).limit(RECENT_SCENARIOS))).all())
    scenario = pick_scenario(target, recent, rng)
    attempts = await session.scalar(select(func.count()).select_from(PromotionMatch).where(
        PromotionMatch.user_id == user_id, PromotionMatch.to_tier == target))
    match = PromotionMatch(
        user_id=user_id, from_tier=profile.tier, to_tier=target, scenario_key=scenario.key, status=ACTIVE,
        turn_limit=grading.TURNS[target], turns=[{"role": "ai", "text": scenario.opener}],
        threshold=grading.THRESHOLDS[target], attempt_no=int(attempts or 0) + 1, started_at=now,
        expires_at=now + timedelta(minutes=settings.rank_match_minutes))
    session.add(match)
    await session.commit()
    logger.info("rank match started tier=%d scenario=%s", target, scenario.key)
    return match


async def add_turn(session: AsyncSession, deps: MatchDeps, match: PromotionMatch, profile: RankProfile,
                   wav: bytes, now: datetime, settings: Settings) -> dict:
    if await _expire_if_needed(session, match, profile, now, settings):
        raise MatchError("expired")
    if match.status != ACTIVE or _user_turns(match) >= match.turn_limit:
        raise MatchError("not_active")
    pcm = wav_to_pcm(wav)
    if pcm is None:
        raise MatchError("bad_audio")
    seconds = len(pcm) / PCM_BYTES_PER_SECOND
    if seconds < grading.MIN_SECONDS:
        raise MatchError("too_short")
    if seconds > grading.MAX_SECONDS:
        raise MatchError("too_long")
    try:
        transcript = (await deps.transcribe(wav)).strip()[:MAX_TRANSCRIPT]
    except AsrError:
        raise MatchError("upstream") from None
    assessment = None
    if grading.words(transcript):
        try:
            assessment = await deps.assess(pcm, transcript)
        except Exception as e:  # plan P-4: a failed assessment only drops this turn's speech score
            logger.info("rank match assessment failed error=%s", type(e).__name__)
    last_ai = next(t["text"] for t in reversed(match.turns) if t["role"] == "ai")
    turn = {"role": "user", "text": transcript, "pron": _num(assessment, "pronunciation_score"),
            "fluency": _num(assessment, "fluency_score"), "english": grading.is_english(transcript),
            "echo": grading.is_echo(transcript, last_ai), "short": grading.is_short(transcript),
            "duration_ms": round(seconds * 1000)}
    index = _user_turns(match) + 1
    done = index == match.turn_limit
    ai_line = None
    if not done:
        scenario = scenario_by_key(match.scenario_key)
        try:
            ai_line = (await deps.examiner(grading.examiner_messages(scenario, match.to_tier, [*match.turns, turn])))[:MAX_AI_LINE]
        except LlmUnavailable:
            raise MatchError("upstream") from None
    match.turns = [*match.turns, turn, *([{"role": "ai", "text": ai_line}] if ai_line else [])]
    await session.commit()
    return {"turn_index": index, "transcript": transcript, "ai_line": ai_line, "done": done}


async def _judge_once(deps: MatchDeps, match: PromotionMatch) -> grading.Judge:
    scenario = scenario_by_key(match.scenario_key)
    messages = grading.judge_messages(scenario, match.to_tier, match.turns)
    for _ in range(2):
        try:
            return grading.parse_judge(await deps.judge(messages), scenario.functions)
        except grading.JudgeFormatError:
            continue
        except LlmUnavailable:
            break
    raise MatchError("grading_failed")


def _facts(match: PromotionMatch) -> list[grading.TurnFacts]:
    return [grading.TurnFacts(t.get("pron"), t.get("fluency"), bool(t.get("english")), bool(t.get("echo")), bool(t.get("short")))
            for t in match.turns if t["role"] == "user"]


async def finish_match(session: AsyncSession, deps: MatchDeps, match: PromotionMatch, profile: RankProfile,
                       now: datetime, settings: Settings) -> dict:
    if match.status not in OPEN:
        raise MatchError("not_active")
    if await _expire_if_needed(session, match, profile, now, settings):
        raise MatchError("expired")
    if _user_turns(match) < match.turn_limit:
        raise MatchError("not_done")
    try:
        judge = await _judge_once(deps, match)
    except MatchError:
        match.status = "grading_failed"
        await session.commit()
        raise
    facts = _facts(match)
    result = grading.verdict(judge, facts, match.to_tier)
    if grading.is_borderline(result.total, result.threshold):
        try:
            result = grading.verdict(grading.average(judge, await _judge_once(deps, match)), facts, match.to_tier)
        except MatchError:
            pass  # keep the first verdict
    if result.passed:
        ledger.apply_state(profile, promote(ledger.state_of(profile)), now)
        profile.tier_started_at, profile.cooldown_until = now, None
        match.status = "passed"
    else:
        _fail(profile, now, settings)
        match.status = "failed"
    match.total, match.finished_at = result.total, now
    match.result = grading.verdict_out(result) | {
        "new_tier": tier_key(profile.tier) if result.passed else None,
        "cooldown_until": None if result.passed else iso_utc(profile.cooldown_until)}
    await session.commit()
    logger.info("rank match finished tier=%d passed=%s total=%d", match.to_tier, result.passed, result.total)
    return match.result


async def abandon_match(session: AsyncSession, match: PromotionMatch, profile: RankProfile, now: datetime,
                        settings: Settings) -> None:
    if match.status not in OPEN:
        raise MatchError("not_active")
    match.status, match.finished_at = "abandoned", now
    _fail(profile, now, settings)
    await session.commit()


def match_out(match: PromotionMatch) -> dict:
    s = scenario_by_key(match.scenario_key)
    return {
        "id": match.id, "status": match.status, "from_tier": tier_key(match.from_tier), "to_tier": tier_key(match.to_tier),
        "scenario": {"key": s.key, "title_zh": s.title_zh, "title_en": s.title_en, "brief_zh": s.brief_zh,
                     "functions": list(s.functions)},
        "turn_limit": match.turn_limit, "turns": [{"role": t["role"], "text": t["text"]} for t in match.turns],
        "attempt_no": match.attempt_no, "started_at": iso_utc(match.started_at), "expires_at": iso_utc(match.expires_at),
        "finished_at": iso_utc(match.finished_at) if match.finished_at else None,
    }
