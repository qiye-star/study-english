import asyncio
import json
import random
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.db import Base
from app.main import create_app
from app.models import PromotionMatch, RankProfile, User
from app.providers.llm import LlmUnavailable
from app.rank import match as m
from app.rank import points
from app.services import usage
from app.services.stats import as_utc
from app.speech.asr import AsrError
from app.speech.stt import pcm_to_wav
from tests.conftest import make_settings

NOW = datetime(2026, 10, 9, 12, 0, tzinfo=timezone.utc)
UID = 12345678
SETTINGS = make_settings(rank_enabled=True)
WAV = pcm_to_wav(b"\x10\x00" * 16000 * 3)  # 3 s


def judge_json(task=3, dims=3):
    return json.dumps({"task": task, "accuracy": dims, "range": dims, "interaction": dims, "functions_met": [],
                       "strengths_zh": ["好"], "improve_zh": ["多练"], "drill_en": "Could I get a refund?"})


class Fakes:
    def __init__(self, judge_outputs=None, transcript="I would like a large latte with oat milk please"):
        self.judge_outputs = list(judge_outputs or [judge_json()])
        self.transcript = transcript
        self.examiner_calls = 0
        self.judge_calls = 0

    def deps(self):
        async def transcribe(wav):
            if self.transcript is None:
                raise AsrError("upstream")
            return self.transcript

        async def assess(pcm, text):
            return {"pronunciation_score": 80.0, "fluency_score": 70.0}

        async def examiner(messages):
            self.examiner_calls += 1
            return "Sure, anything else?"

        async def judge(messages):
            self.judge_calls += 1
            out = self.judge_outputs.pop(0)
            if isinstance(out, Exception):
                raise out
            return out

        return m.MatchDeps(transcribe, assess, examiner, judge)


@pytest.fixture
async def eligible(app, monkeypatch):
    monkeypatch.setitem(points.STAGE_TASKS, 2, ())
    async with app.state.sessionmaker() as s:
        s.add(User(id=UID, username="u", password_hash="x"))
        s.add(RankProfile(user_id=UID, tier=2, division=1, rp=120, stars=0, best_tier=2, tier_started_at=NOW,
                          synced_at=NOW, updated_at=NOW))
        await s.commit()
    return app


async def play(s, fakes, match, profile, n):
    for _ in range(n):
        out = await m.add_turn(s, fakes.deps(), match, profile, WAV, NOW + timedelta(minutes=1), SETTINGS)
    return out


async def test_full_match_pass_promotes(eligible):
    async with eligible.state.sessionmaker() as s:
        match = await m.start_match(s, UID, NOW, settings=SETTINGS, offset_minutes=0, rng=random.Random(0))
        assert (match.to_tier, match.turn_limit, match.threshold) == (3, 6, 68)
        fakes = Fakes()
        profile = await s.get(RankProfile, UID)
        last = await play(s, fakes, match, profile, 6)
        assert last == {"turn_index": 6, "transcript": fakes.transcript, "ai_line": None, "done": True}
        assert fakes.examiner_calls == 5
        result = await m.finish_match(s, fakes.deps(), match, profile, NOW + timedelta(minutes=8), SETTINGS)
        assert result["passed"] and result["new_tier"] == "platinum" and result["cooldown_until"] is None
        assert (profile.tier, profile.division, profile.rp) == (3, 3, 0) and match.status == "passed"
        assert m.match_out(match)["to_tier"] == "platinum"


async def test_fail_sets_cooldown_and_keeps_80_percent(eligible):
    async with eligible.state.sessionmaker() as s:
        match = await m.start_match(s, UID, NOW, settings=SETTINGS, offset_minutes=0, rng=random.Random(0))
        profile = await s.get(RankProfile, UID)
        fakes = Fakes([judge_json(task=1, dims=1)])
        await play(s, fakes, match, profile, 6)
        result = await m.finish_match(s, fakes.deps(), match, profile, NOW, SETTINGS)
        assert not result["passed"] and "task_low" in result["gates_failed"] and result["new_tier"] is None
        assert profile.rp == 96 and profile.cooldown_until is not None
        with pytest.raises(m.MatchError) as e:
            await m.start_match(s, UID, NOW + timedelta(minutes=1), settings=SETTINGS, offset_minutes=0, rng=random.Random(0))
        assert e.value.code == "locked"  # 96 < 120: back to practice before the cooldown even matters


async def test_borderline_triggers_second_judge(eligible):
    async with eligible.state.sessionmaker() as s:
        match = await m.start_match(s, UID, NOW, settings=SETTINGS, offset_minutes=0, rng=random.Random(0))
        profile = await s.get(RankProfile, UID)
        fakes = Fakes([judge_json(task=4, dims=2), judge_json(task=4, dims=3)])  # 70 vs 68: borderline
        await play(s, fakes, match, profile, 6)
        await m.finish_match(s, fakes.deps(), match, profile, NOW, SETTINGS)
        assert fakes.judge_calls == 2


async def test_bad_judge_output_marks_grading_failed_and_can_retry(eligible):
    async with eligible.state.sessionmaker() as s:
        match = await m.start_match(s, UID, NOW, settings=SETTINGS, offset_minutes=0, rng=random.Random(0))
        profile = await s.get(RankProfile, UID)
        fakes = Fakes(["nope", "still nope", judge_json(task=4, dims=4)])
        await play(s, fakes, match, profile, 6)
        with pytest.raises(m.MatchError) as e:
            await m.finish_match(s, fakes.deps(), match, profile, NOW, SETTINGS)
        assert e.value.code == "grading_failed" and match.status == "grading_failed"
        assert (await m.finish_match(s, fakes.deps(), match, profile, NOW, SETTINGS))["passed"]


async def test_turn_errors(eligible):
    async with eligible.state.sessionmaker() as s:
        match = await m.start_match(s, UID, NOW, settings=SETTINGS, offset_minutes=0, rng=random.Random(0))
        profile = await s.get(RankProfile, UID)
        fakes = Fakes()
        for wav, code in ((b"junk", "bad_audio"), (pcm_to_wav(b"\x00\x00" * 8000), "too_short"),
                          (pcm_to_wav(b"\x00\x00" * 16000 * 31), "too_long")):
            with pytest.raises(m.MatchError) as e:
                await m.add_turn(s, fakes.deps(), match, profile, wav, NOW, SETTINGS)
            assert e.value.code == code
        fakes.transcript = None
        with pytest.raises(m.MatchError) as e:
            await m.add_turn(s, fakes.deps(), match, profile, WAV, NOW, SETTINGS)
        assert e.value.code == "upstream" and len(match.turns) == 1  # nothing persisted (plan P-5)
        with pytest.raises(m.MatchError) as e:
            await m.finish_match(s, fakes.deps(), match, profile, NOW, SETTINGS)
        assert e.value.code == "not_done"


async def test_examiner_failure_persists_nothing(eligible):
    async with eligible.state.sessionmaker() as s:
        match = await m.start_match(s, UID, NOW, settings=SETTINGS, offset_minutes=0, rng=random.Random(0))
        profile = await s.get(RankProfile, UID)
        fakes = Fakes()
        deps = fakes.deps()

        async def broken(messages):
            raise LlmUnavailable("http")

        deps.examiner = broken
        with pytest.raises(m.MatchError) as e:
            await m.add_turn(s, deps, match, profile, WAV, NOW, SETTINGS)
        assert e.value.code == "upstream" and len(match.turns) == 1


async def test_expiry_attempt_limits_and_in_progress(eligible):
    settings = make_settings(rank_enabled=True, rank_match_daily_attempts=1, rank_match_cooldown_minutes=0)
    async with eligible.state.sessionmaker() as s:
        match = await m.start_match(s, UID, NOW, settings=settings, offset_minutes=0, rng=random.Random(0))
        with pytest.raises(m.MatchError) as e:
            await m.start_match(s, UID, NOW, settings=settings, offset_minutes=0, rng=random.Random(0))
        assert e.value.code == "in_progress"
        profile = await s.get(RankProfile, UID)
        with pytest.raises(m.MatchError) as e:
            await m.add_turn(s, Fakes().deps(), match, profile, WAV, NOW + timedelta(minutes=21), settings)
        assert e.value.code == "expired" and match.status == "expired" and profile.rp == 96


async def test_attempts_are_counted_per_utc_day_whatever_the_client_offset(eligible):
    """Review #8: switching tz_offset_minutes between calls must not unlock another day's attempts."""
    async with eligible.state.sessionmaker() as s:
        await m.start_match(s, UID, NOW, settings=SETTINGS, offset_minutes=-720, rng=random.Random(0))
        profile = await s.get(RankProfile, UID)
        left = SETTINGS.rank_match_daily_attempts - 1
        assert (await m.ledger.promotion_for(s, profile, NOW, SETTINGS)).attempts_left == left
        assert await usage.remaining(s, "rank_match", str(UID), "2026-10-09", SETTINGS.rank_match_daily_attempts) == left


async def test_abandon_counts_as_failure(eligible):
    async with eligible.state.sessionmaker() as s:
        match = await m.start_match(s, UID, NOW, settings=SETTINGS, offset_minutes=0, rng=random.Random(0))
        profile = await s.get(RankProfile, UID)
        await m.abandon_match(s, match, profile, NOW, SETTINGS)
        assert match.status == "abandoned" and profile.rp == 96
        with pytest.raises(m.MatchError):
            await m.abandon_match(s, match, profile, NOW, SETTINGS)


@pytest.fixture
async def file_app(tmp_path, monkeypatch):
    """A file-backed SQLite DB: separate sessions get separate connections, as in production."""
    monkeypatch.setitem(points.STAGE_TASKS, 2, ())
    url = f"sqlite+aiosqlite:///{(tmp_path / 'r.db').as_posix()}"
    application = create_app(make_settings(rank_enabled=True, database_url=url))
    async with application.state.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with application.state.sessionmaker() as s:
        s.add(User(id=UID, username="u", password_hash="x"))
        s.add(RankProfile(user_id=UID, tier=2, division=1, rp=120, stars=0, best_tier=2, tier_started_at=NOW,
                          synced_at=NOW, updated_at=NOW))
        await s.commit()
    yield application
    await application.state.http.aclose()
    await application.state.engine.dispose()


async def _start(app_):
    async with app_.state.sessionmaker() as s:
        try:
            return (await m.start_match(s, UID, NOW, settings=SETTINGS, offset_minutes=0, rng=random.Random(0))).id
        except m.MatchError as e:
            return e.code


async def test_concurrent_starts_create_one_match_and_refund_the_loser(file_app, monkeypatch):
    """Review #1: simultaneous POST /matches must not create two open matches."""
    real_promotion_for = m.ledger.promotion_for

    async def slow_promotion_for(*args, **kwargs):  # every request passes the open-match check first
        status = await real_promotion_for(*args, **kwargs)
        await asyncio.sleep(0.05)
        return status

    monkeypatch.setattr(m.ledger, "promotion_for", slow_promotion_for)
    results = await asyncio.gather(*(_start(file_app) for _ in range(3)))
    assert sorted(r == "in_progress" for r in results) == [False, True, True], results
    async with file_app.state.sessionmaker() as s:
        open_ = (await s.scalars(select(PromotionMatch).where(PromotionMatch.status.in_(m.OPEN)))).all()
        assert len(open_) == 1
        assert await usage.remaining(s, "rank_match", str(UID), "2026-10-09", SETTINGS.rank_match_daily_attempts) == 2
        assert await usage.remaining(s, "rank_match_global", "*", "2026-10-09", SETTINGS.rank_matches_global_daily) \
            == SETTINGS.rank_matches_global_daily - 1


async def test_open_match_is_unique_per_user_in_the_db(file_app):
    async with file_app.state.sessionmaker() as s:
        for _ in range(2):
            s.add(PromotionMatch(user_id=UID, from_tier=2, to_tier=3, scenario_key="x", status="active", turn_limit=6,
                                 turns=[], threshold=68, attempt_no=1, started_at=NOW, expires_at=NOW))
        with pytest.raises(IntegrityError):
            await s.commit()


async def test_stale_from_tier_never_promotes_twice(eligible):
    """Review #1: a match started at gold must not promote a user who is no longer gold."""
    async with eligible.state.sessionmaker() as s:
        match = await m.start_match(s, UID, NOW, settings=SETTINGS, offset_minutes=0, rng=random.Random(0))
        profile = await s.get(RankProfile, UID)
        fakes = Fakes()
        await play(s, fakes, match, profile, 6)
        profile.tier = 3  # promoted by another match meanwhile
        await s.commit()
        with pytest.raises(m.MatchError) as e:
            await m.finish_match(s, fakes.deps(), match, profile, NOW + timedelta(minutes=8), SETTINGS)
        assert e.value.code == "not_active" and match.status == "expired"
        assert profile.tier == 3 and fakes.judge_calls == 0


async def test_parallel_finish_grades_once(file_app):
    """Review #2: parallel /finish calls must not each run the judge and re-roll the verdict."""
    async with file_app.state.sessionmaker() as s:
        match = await m.start_match(s, UID, NOW, settings=SETTINGS, offset_minutes=0, rng=random.Random(0))
        profile = await s.get(RankProfile, UID)
        await play(s, Fakes(), match, profile, 6)
    fakes = Fakes([judge_json(task=4, dims=4)] * 4)
    deps = fakes.deps()
    real_judge = deps.judge

    async def slow_judge(messages):
        await asyncio.sleep(0.05)
        return await real_judge(messages)

    deps.judge = slow_judge

    async def finish():
        async with file_app.state.sessionmaker() as s:
            row = await s.get(PromotionMatch, match.id)
            prof = await s.get(RankProfile, UID)
            try:
                return (await m.finish_match(s, deps, row, prof, NOW + timedelta(minutes=8), SETTINGS))["passed"]
            except m.MatchError as e:
                return e.code

    results = await asyncio.gather(finish(), finish(), finish())
    assert sorted(map(str, results)) == ["True", "busy", "busy"], results
    assert fakes.judge_calls == 1
    async with file_app.state.sessionmaker() as s:
        assert (await s.get(RankProfile, UID)).tier == 3


async def test_parallel_turns_are_rejected(file_app):
    """Review #2: parallel /turns on one match must not each call the upstreams and overwrite each other."""
    async with file_app.state.sessionmaker() as s:
        match = await m.start_match(s, UID, NOW, settings=SETTINGS, offset_minutes=0, rng=random.Random(0))
    fakes = Fakes()
    deps = fakes.deps()
    real_examiner = deps.examiner

    async def slow_examiner(messages):
        await asyncio.sleep(0.05)
        return await real_examiner(messages)

    deps.examiner = slow_examiner

    async def turn():
        async with file_app.state.sessionmaker() as s:
            row = await s.get(PromotionMatch, match.id)
            prof = await s.get(RankProfile, UID)
            try:
                return (await m.add_turn(s, deps, row, prof, WAV, NOW + timedelta(minutes=1), SETTINGS))["turn_index"]
            except m.MatchError as e:
                return e.code

    assert sorted(map(str, await asyncio.gather(turn(), turn(), turn()))) == ["1", "busy", "busy"]
    assert fakes.examiner_calls == 1
    async with file_app.state.sessionmaker() as s:
        assert len((await s.get(PromotionMatch, match.id)).turns) == 3


async def test_grading_failed_is_capped_and_expires(eligible):
    """Review #2: a grading_failed match cannot be re-graded forever."""
    async with eligible.state.sessionmaker() as s:
        match = await m.start_match(s, UID, NOW, settings=SETTINGS, offset_minutes=0, rng=random.Random(0))
        profile = await s.get(RankProfile, UID)
        await play(s, Fakes(), match, profile, 6)
        fakes = Fakes(["nope"] * 2 * m.MAX_GRADE_ATTEMPTS)
        for _ in range(m.MAX_GRADE_ATTEMPTS):
            with pytest.raises(m.MatchError) as e:
                await m.finish_match(s, fakes.deps(), match, profile, NOW, SETTINGS)
            assert e.value.code == "grading_failed"
        assert match.status == "expired" and fakes.judge_calls == 2 * m.MAX_GRADE_ATTEMPTS
        assert profile.cooldown_until is None  # our grading failed, not the learner
        with pytest.raises(m.MatchError) as e:
            await m.finish_match(s, fakes.deps(), match, profile, NOW, SETTINGS)
        assert e.value.code == "not_active"

    async with eligible.state.sessionmaker() as s:
        match = await m.start_match(s, UID, NOW, settings=SETTINGS, offset_minutes=0, rng=random.Random(1))
        profile = await s.get(RankProfile, UID)
        await play(s, Fakes(), match, profile, 6)
        with pytest.raises(m.MatchError):
            await m.finish_match(s, Fakes(["nope", "nope"]).deps(), match, profile, NOW, SETTINGS)
        late = as_utc(match.expires_at) + m.GRADING_GRACE + timedelta(seconds=1)
        with pytest.raises(m.MatchError) as e:
            await m.finish_match(s, Fakes().deps(), match, profile, late, SETTINGS)
        assert e.value.code == "expired" and match.status == "expired"


async def test_per_user_override_of_daily_attempts_is_enforced_by_start_match(eligible):
    """Integration (lane D quota override × lane C rank): user_quota_overrides.rank_match_daily_attempts wins over
    the site-wide setting in start_match itself, and an expired override no longer counts."""
    from app.models import UserQuotaOverride

    settings = make_settings(rank_enabled=True, rank_match_daily_attempts=1, rank_match_cooldown_minutes=0)
    async with eligible.state.sessionmaker() as s:
        s.add(UserQuotaOverride(user_id=UID, key="rank_match_daily_attempts", value=2, updated_by="ops"))
        await s.commit()
        for _ in range(2):
            match = await m.start_match(s, UID, NOW, settings=settings, offset_minutes=0, rng=random.Random(0))
            await s.commit()
            profile = await s.get(RankProfile, UID)
            await m.abandon_match(s, match, profile, NOW, settings)
            profile.tier, profile.division, profile.rp, profile.cooldown_until = 2, 1, 120, None  # back at the gate
            await s.commit()
        assert (await m.ledger.promotion_for(s, profile, NOW, settings)).attempts_left == 0
        with pytest.raises(m.MatchError) as e:
            await m.start_match(s, UID, NOW, settings=settings, offset_minutes=0, rng=random.Random(0))
        assert e.value.code == "no_attempts"
        row = await s.get(UserQuotaOverride, (UID, "rank_match_daily_attempts"))
        row.value, row.expires_at = 5, NOW - timedelta(minutes=1)  # expired: back to the site-wide 1 (already used)
        await s.commit()
        assert await m.ledger.daily_attempts(s, UID, NOW, settings) == 1
        row.expires_at = None
        await s.commit()
        assert (await m.ledger.promotion_for(s, profile, NOW, settings)).attempts_left == 3


# ---- review M3: admin profile edits void the open match (never promote from a non-gate state) ----------------------

async def _played_match(s):
    match = await m.start_match(s, UID, NOW, settings=SETTINGS, offset_minutes=0, rng=random.Random(0))
    profile = await s.get(RankProfile, UID)
    fakes = Fakes()
    await play(s, fakes, match, profile, 6)
    return match, profile, fakes


@pytest.mark.parametrize("op", ["reset_same_tier", "cut_points", "reset_all"])
async def test_admin_edit_during_open_match_voids_it_and_finish_never_promotes(eligible, op):
    from app.admin import rank_ops
    from app.admin.audit import Actor
    from app.rank.rules import DEFAULT_RULES

    ops = Actor("ops", "operator", "s1", "127.0.0.1")
    later = NOW + timedelta(minutes=5)
    async with eligible.state.sessionmaker() as s:
        match, profile, fakes = await _played_match(s)
        async with eligible.state.sessionmaker() as admin:
            if op == "reset_same_tier":
                await rank_ops.reset_user(admin, ops, UID, tier=2, division=3, rp=0, reason="纠正", now=later,
                                          rules=DEFAULT_RULES)
            elif op == "cut_points":
                await rank_ops.adjust_points(admin, ops, UID, -100, reason="扣分", now=later, rules=DEFAULT_RULES)
            else:
                await rank_ops.reset_all(admin, ops, reason="新赛季", now=later)
            await admin.commit()
        with pytest.raises(m.MatchError) as e:
            await m.finish_match(s, fakes.deps(), match, profile, NOW + timedelta(minutes=8), SETTINGS)
        assert e.value.code == "not_active" and fakes.judge_calls == 0
        await s.refresh(profile)
        await s.refresh(match)
        assert profile.tier < 3 and match.status == "voided"


async def test_profile_reset_after_match_start_is_stale_even_without_admin_void(eligible):
    """Backstop: a tier_started_at later than the match start means the profile was edited mid-match."""
    async with eligible.state.sessionmaker() as s:
        match, profile, fakes = await _played_match(s)
        profile.division, profile.rp, profile.tier_started_at = 3, 0, NOW + timedelta(minutes=5)
        await s.commit()
        with pytest.raises(m.MatchError) as e:
            await m.finish_match(s, fakes.deps(), match, profile, NOW + timedelta(minutes=8), SETTINGS)
        assert e.value.code == "not_active" and profile.tier == 2


async def test_admin_edit_refuses_while_the_match_is_busy(eligible):
    from app.admin import rank_ops
    from app.admin.audit import Actor
    from app.rank.rules import DEFAULT_RULES

    async with eligible.state.sessionmaker() as s:
        match, _, _ = await _played_match(s)
    m._busy.add(match.id)
    try:
        async with eligible.state.sessionmaker() as admin:
            with pytest.raises(rank_ops.RankOpError) as exc:
                await rank_ops.reset_user(admin, Actor("ops", "operator", "s1", "ip"), UID, tier=2, division=3, rp=0,
                                          reason="x", now=NOW, rules=DEFAULT_RULES)
            assert exc.value.status == 409
    finally:
        m._busy.discard(match.id)
