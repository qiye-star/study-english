"""Promotion-match orchestration (spec 2026-10-09 §3, plan P-4/P-5). Upstreams are injected through
MatchDeps so tests never reach a vendor. Never logs transcripts, prompts or judge output.

Concurrency (review #1/#2): the DB allows one open match per user (partial unique index, migration 0007);
turns, finish and abandon on one match run one at a time (`_claim`, single worker); the verdict is written with a
compare-and-set on the status; a match whose from_tier no longer matches the profile is voided, never graded.

Rules (admin v2 §5.2): every entry point takes `rules=None` (a RankRules; None = built-in constants and Settings).
start_match records `rules_version`; callers pass that version's rules to the later steps (the match is pinned)."""
import logging
import random
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
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
MAX_GRADE_ATTEMPTS = 3  # /finish calls that may each run the judge (up to 4 calls) before the match is voided
GRADING_GRACE = timedelta(hours=24)  # a grading_failed match can be re-graded until expires_at + this
_busy: set[str] = set()  # match ids with a /turns, /finish or /abandon in flight (single worker)


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


def is_busy(match_id: str) -> bool:
    """A /turns, /finish or /abandon on this match is in flight (admin void/regrade must not interleave)."""
    return match_id in _busy


def _user_turns(match: PromotionMatch) -> int:
    return sum(1 for t in match.turns if t["role"] == "user")


def _num(data: dict | None, key: str) -> float | None:
    value = data.get(key) if isinstance(data, dict) else None
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


@asynccontextmanager
async def _claim(session: AsyncSession, match: PromotionMatch, profile: RankProfile) -> AsyncIterator[None]:
    """One request at a time per match; both rows are reloaded so a request never acts on a stale copy."""
    if match.id in _busy:
        raise MatchError("busy")
    _busy.add(match.id)
    try:
        await session.refresh(match)
        await session.refresh(profile)
        yield
    finally:
        _busy.discard(match.id)


async def _void_if_stale(session: AsyncSession, match: PromotionMatch, profile: RankProfile, now: datetime) -> None:
    """The profile moved off the match's from_tier (another match, or a demotion): never grade or promote it."""
    if match.status in OPEN and match.from_tier != profile.tier:
        match.status, match.finished_at = "expired", now
        await session.commit()
        raise MatchError("not_active")


def _fail(profile: RankProfile, now: datetime, settings: Settings, rules=None) -> None:
    ledger.apply_state(profile, after_failed_match(ledger.state_of(profile), rules=rules), now)
    minutes = rules.match.cooldown_minutes if rules is not None else settings.rank_match_cooldown_minutes
    profile.cooldown_until = now + timedelta(minutes=minutes)


async def active_match(session: AsyncSession, user_id: int) -> PromotionMatch | None:
    return await session.scalar(select(PromotionMatch).where(
        PromotionMatch.user_id == user_id, PromotionMatch.status.in_(OPEN))
        .order_by(PromotionMatch.started_at.desc()).limit(1))


async def _expire_if_needed(session: AsyncSession, match: PromotionMatch, profile: RankProfile,
                            now: datetime, settings: Settings, rules=None) -> bool:
    if match.status == ACTIVE and as_utc(match.expires_at) <= now:
        match.status, match.finished_at = "expired", now
        _fail(profile, now, settings, rules)
        await session.commit()
        return True
    if match.status == "grading_failed" and as_utc(match.expires_at) + GRADING_GRACE <= now:
        match.status, match.finished_at = "expired", now  # our grading failed, not the learner: no penalty
        await session.commit()
        return True
    return False


async def start_match(session: AsyncSession, user_id: int, now: datetime, *, settings: Settings,
                      offset_minutes: int, rng: random.Random, rules=None,
                      rules_version: int | None = None) -> PromotionMatch:
    profile = await ledger.sync(session, user_id, now, offset_minutes, settings.rank_daily_rp_cap, rules=rules)
    current = await active_match(session, user_id)
    # an expired leftover is failed with the current rules (its own version only matters for grading)
    if current is not None and not await _expire_if_needed(session, current, profile, now, settings, rules):
        raise MatchError("in_progress")
    status = await ledger.promotion_for(session, profile, now, settings, rules=rules)
    if status.state != "eligible":
        raise MatchError(status.state)
    from_tier = profile.tier
    target = from_tier + 1
    utc_day = day = usage.utc_day(now)  # attempts per UTC day, never the client's offset (review #8)
    if not await usage.consume(session, "rank_match_global", "*", utc_day, settings.rank_matches_global_daily):
        raise MatchError("global_cap")
    if not await usage.consume(session, "rank_match", str(user_id), day,
                               await ledger.daily_attempts(session, user_id, now, settings, rules=rules)):
        await usage.refund(session, "rank_match_global", "*", utc_day)
        raise MatchError("no_attempts")
    recent = set((await session.scalars(select(PromotionMatch.scenario_key).where(PromotionMatch.user_id == user_id)
                                        .order_by(PromotionMatch.started_at.desc()).limit(RECENT_SCENARIOS))).all())
    scenario = pick_scenario(target, recent, rng, rules=rules)
    attempts = await session.scalar(select(func.count()).select_from(PromotionMatch).where(
        PromotionMatch.user_id == user_id, PromotionMatch.to_tier == target))
    match = PromotionMatch(
        user_id=user_id, from_tier=from_tier, to_tier=target, scenario_key=scenario.key, status=ACTIVE,
        turn_limit=grading.turns_for(target, rules=rules), turns=[{"role": "ai", "text": scenario.opener}],
        threshold=grading.threshold_for(target, rules=rules), attempt_no=int(attempts or 0) + 1, started_at=now,
        expires_at=now + timedelta(minutes=rules.match.match_minutes if rules is not None else settings.rank_match_minutes),
        rules_version=rules_version)
    session.add(match)
    try:
        await session.commit()
    except IntegrityError:  # a concurrent start won the one-open-match-per-user index
        await session.rollback()
        await usage.refund(session, "rank_match", str(user_id), day)
        await usage.refund(session, "rank_match_global", "*", utc_day)
        raise MatchError("in_progress") from None
    logger.info("rank match started tier=%d scenario=%s", target, scenario.key)
    return match


async def add_turn(session: AsyncSession, deps: MatchDeps, match: PromotionMatch, profile: RankProfile,
                   wav: bytes, now: datetime, settings: Settings, *, rules=None) -> dict:
    async with _claim(session, match, profile):
        return await _add_turn(session, deps, match, profile, wav, now, settings, rules)


async def _add_turn(session: AsyncSession, deps: MatchDeps, match: PromotionMatch, profile: RankProfile,
                    wav: bytes, now: datetime, settings: Settings, rules=None) -> dict:
    await _void_if_stale(session, match, profile, now)
    if await _expire_if_needed(session, match, profile, now, settings, rules):
        raise MatchError("expired")
    if match.status != ACTIVE or _user_turns(match) >= match.turn_limit:
        raise MatchError("not_active")
    pcm = wav_to_pcm(wav)
    if pcm is None:
        raise MatchError("bad_audio")
    seconds = len(pcm) / PCM_BYTES_PER_SECOND
    min_seconds, max_seconds = ((rules.match.min_seconds, rules.match.max_seconds) if rules is not None
                                else (grading.MIN_SECONDS, grading.MAX_SECONDS))
    if seconds < min_seconds:
        raise MatchError("too_short")
    if seconds > max_seconds:
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
        scenario = scenario_by_key(match.scenario_key, rules=rules)
        try:
            ai_line = (await deps.examiner(grading.examiner_messages(scenario, match.to_tier, [*match.turns, turn],
                                                                     rules=rules)))[:MAX_AI_LINE]
        except LlmUnavailable:
            raise MatchError("upstream") from None
    match.turns = [*match.turns, turn, *([{"role": "ai", "text": ai_line}] if ai_line else [])]
    await session.commit()
    return {"turn_index": index, "transcript": transcript, "ai_line": ai_line, "done": done}


async def _judge_once(deps: MatchDeps, match: PromotionMatch, rules=None) -> grading.Judge:
    scenario = scenario_by_key(match.scenario_key, rules=rules)
    messages = grading.judge_messages(scenario, match.to_tier, match.turns, rules=rules)
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
                       now: datetime, settings: Settings, *, rules=None) -> dict:
    async with _claim(session, match, profile):
        return await _finish(session, deps, match, profile, now, settings, rules)


async def _finish(session: AsyncSession, deps: MatchDeps, match: PromotionMatch, profile: RankProfile,
                  now: datetime, settings: Settings, rules=None) -> dict:
    if match.status not in OPEN:
        raise MatchError("not_active")
    if await _expire_if_needed(session, match, profile, now, settings, rules):
        raise MatchError("expired")
    await _void_if_stale(session, match, profile, now)
    if _user_turns(match) < match.turn_limit:
        raise MatchError("not_done")
    seen_status, attempt = match.status, (match.grade_attempts or 0) + 1
    match.grade_attempts = attempt
    await session.commit()
    try:
        judge = await _judge_once(deps, match, rules)
    except MatchError:
        if attempt >= MAX_GRADE_ATTEMPTS:
            match.status, match.finished_at = "expired", now  # no penalty: the failure is ours
        else:
            match.status = "grading_failed"
        await session.commit()
        raise
    facts = _facts(match)
    result = grading.verdict(judge, facts, match.to_tier, rules=rules)
    if grading.is_borderline(result.total, result.threshold, rules=rules):
        try:
            result = grading.verdict(grading.average(judge, await _judge_once(deps, match, rules)), facts, match.to_tier,
                                     rules=rules)
        except MatchError:
            pass  # keep the first verdict
    final = "passed" if result.passed else "failed"
    claimed = await session.execute(  # compare-and-set: only one grader may write a verdict
        update(PromotionMatch).where(PromotionMatch.id == match.id, PromotionMatch.status == seen_status,
                                     PromotionMatch.grade_attempts == attempt)
        .values(status=final).execution_options(synchronize_session=False))
    if claimed.rowcount != 1:
        await session.rollback()
        raise MatchError("not_active")
    await session.refresh(profile)
    await _void_if_stale(session, match, profile, now)
    if result.passed:
        ledger.apply_state(profile, promote(ledger.state_of(profile)), now)
        profile.tier_started_at, profile.cooldown_until = now, None
        match.status = "passed"
    else:
        _fail(profile, now, settings, rules)
        match.status = "failed"
    match.total, match.finished_at = result.total, now
    match.result = grading.verdict_out(result) | {
        "new_tier": tier_key(profile.tier) if result.passed else None,
        "cooldown_until": None if result.passed else iso_utc(profile.cooldown_until)}
    await session.commit()
    logger.info("rank match finished tier=%d passed=%s total=%d", match.to_tier, result.passed, result.total)
    return match.result


async def abandon_match(session: AsyncSession, match: PromotionMatch, profile: RankProfile, now: datetime,
                        settings: Settings, *, rules=None) -> None:
    async with _claim(session, match, profile):
        if match.status not in OPEN:
            raise MatchError("not_active")
        match.status, match.finished_at = "abandoned", now
        if match.from_tier == profile.tier:  # a stale match is closed without penalising the new tier
            _fail(profile, now, settings, rules)
        await session.commit()


def match_out(match: PromotionMatch, *, rules=None) -> dict:
    s = scenario_by_key(match.scenario_key, rules=rules)
    return {
        "id": match.id, "status": match.status, "from_tier": tier_key(match.from_tier), "to_tier": tier_key(match.to_tier),
        "scenario": {"key": s.key, "title_zh": s.title_zh, "title_en": s.title_en, "brief_zh": s.brief_zh,
                     "functions": list(s.functions)},
        "turn_limit": match.turn_limit, "turns": [{"role": t["role"], "text": t["text"]} for t in match.turns],
        "attempt_no": match.attempt_no, "started_at": iso_utc(match.started_at), "expires_at": iso_utc(match.expires_at),
        "finished_at": iso_utc(match.finished_at) if match.finished_at else None,
    }
