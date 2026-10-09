import json
import random
from datetime import datetime, timedelta, timezone

import pytest

from app.models import RankProfile, User
from app.providers.llm import LlmUnavailable
from app.rank import match as m
from app.rank import points
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


async def test_abandon_counts_as_failure(eligible):
    async with eligible.state.sessionmaker() as s:
        match = await m.start_match(s, UID, NOW, settings=SETTINGS, offset_minutes=0, rng=random.Random(0))
        profile = await s.get(RankProfile, UID)
        await m.abandon_match(s, match, profile, NOW, SETTINGS)
        assert match.status == "abandoned" and profile.rp == 96
        with pytest.raises(m.MatchError):
            await m.abandon_match(s, match, profile, NOW, SETTINGS)
