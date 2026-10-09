from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models import Assessment, Conversation, Message, RankProfile, User, VocabularyItem, XpEvent
from app.rank import ledger, points
from app.rank.ledger import Promotion, promotion_status
from app.rank.points import TaskProgress
from app.rank.tiers import RankState

NOW = datetime(2026, 10, 9, 12, 0, tzinfo=timezone.utc)
UID = 12345678


async def seed_user(s, uid=UID):
    s.add(User(id=uid, username=f"u{uid}", password_hash="x"))
    await s.commit()


def assessment(i, score, at, source="practice", uid=UID):
    return Assessment(id=f"a{i}", user_id=uid, reference_text="r", language="en-US", duration_ms=1000, audio_bytes=10,
                      scores={"pronunciation_score": score}, result={}, audio_path="x", source=source, created_at=at)


async def test_sync_awards_points_once_and_is_idempotent(app):
    async with app.state.sessionmaker() as s:
        await seed_user(s)
        s.add_all([assessment(1, 90, NOW - timedelta(hours=1)), assessment(2, 75, NOW - timedelta(hours=1), source="chat")])
        s.add(Conversation(id="c1", user_id=UID, name="c", config={}))
        s.add_all([Message(id="m1", conversation_id="c1", role="user", content="hi", created_at=NOW - timedelta(minutes=30)),
                   Message(id="m2", conversation_id="c1", role="assistant", content="yo", created_at=NOW - timedelta(minutes=29))])
        await s.commit()
        profile = await ledger.sync(s, UID, NOW, 480, 60)
        assert profile.rp == 4 + 3 + 1 + 5  # assessment + voice_turn + chat_turn + active_day
        kinds = sorted((await s.scalars(select(XpEvent.kind).where(XpEvent.user_id == UID))).all())
        assert kinds == ["active_day", "assessment", "chat_turn", "voice_turn"]
        again = await ledger.sync(s, UID, NOW + timedelta(minutes=5), 480, 60)
        assert again.rp == 13
        assert await s.scalar(select(func.count()).select_from(XpEvent)) == 4


async def test_daily_cap_and_lookback(app):
    async with app.state.sessionmaker() as s:
        await seed_user(s)
        s.add_all([assessment(i, 95, NOW - timedelta(minutes=i)) for i in range(20)])
        s.add(assessment(99, 95, NOW - timedelta(days=15)))
        await s.commit()
        profile = await ledger.sync(s, UID, NOW, 0, 60)
        # 60 capped + 5 active day + 10 for the bronze "assess 10" stage task; the 15-day-old row is ignored
        assert (profile.division, profile.rp) == (3, 75)
        assert await s.scalar(select(func.count()).select_from(XpEvent).where(XpEvent.ref_id == "a99")) == 0


async def test_other_users_rows_are_ignored(app):
    async with app.state.sessionmaker() as s:
        await seed_user(s)
        await seed_user(s, 87654321)
        s.add(Conversation(id="c2", user_id=87654321, name="c", config={}))
        s.add(Message(id="m9", conversation_id="c2", role="user", content="hi", created_at=NOW - timedelta(minutes=1)))
        await s.commit()
        assert (await ledger.sync(s, UID, NOW, 0, 60)).rp == 0


async def test_vocab_reviews_and_stage_task_bonus(app, monkeypatch):
    monkeypatch.setitem(points.STAGE_TASKS, 0, (points.StageTask("vocab_reviews", "vocab_reviews", 2),))
    async with app.state.sessionmaker() as s:
        await seed_user(s)
        for i in range(2):
            s.add(VocabularyItem(id=f"v{i}", user_id=UID, word=f"w{i}", meaning="", source="manual", box=1,
                                 due_at=NOW, reps=1, lapses=0, last_reviewed_at=NOW - timedelta(minutes=5)))
        await s.commit()
        profile = await ledger.sync(s, UID, NOW, 0, 60)
        assert profile.rp == 1 + 1 + 5 + 10
        tasks = await ledger.stage_progress_for(s, profile)
        assert tasks[0].complete
        assert (await ledger.sync(s, UID, NOW + timedelta(minutes=1), 0, 60)).rp == 17


@pytest.mark.parametrize("state,tasks,kw,expected", [
    (RankState(tier=6, division=0), [], {}, ("max_tier", None)),
    (RankState(tier=2, division=1, rp=120), [], {"available": False}, ("unavailable", None)),
    (RankState(tier=2, division=2, rp=50), [], {}, ("locked", "rp")),
    (RankState(tier=2, division=1, rp=120), [TaskProgress("assess", "assess", 1, 20, 75, False)], {}, ("locked", "tasks")),
    (RankState(tier=2, division=1, rp=120), [], {"cooldown_until": NOW + timedelta(minutes=5)}, ("cooldown", None)),
    (RankState(tier=2, division=1, rp=120), [], {"attempts_left": 0}, ("no_attempts", None)),
    (RankState(tier=2, division=1, rp=120), [], {}, ("eligible", None)),
])
def test_promotion_status(state, tasks, kw, expected):
    args = {"now": NOW, "cooldown_until": None, "attempts_left": 3, "available": True, **kw}
    result = promotion_status(state, tasks, **args)
    assert isinstance(result, Promotion) and (result.state, result.reason) == expected
    assert result.target_tier == (None if state.tier == 6 else state.tier + 1)
