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


async def test_activity_from_before_the_tier_never_counts_for_its_stage_tasks(app, monkeypatch):
    """Review #17: practice synced after a promotion is stamped with the new tier but happened before it."""
    monkeypatch.setitem(points.STAGE_TASKS, 3, (points.StageTask("vocab_reviews", "vocab_reviews", 2),))
    async with app.state.sessionmaker() as s:
        await seed_user(s)
        s.add(RankProfile(user_id=UID, tier=3, division=3, rp=0, stars=0, best_tier=3, tier_started_at=NOW,
                          synced_at=NOW - timedelta(hours=1), updated_at=NOW))
        for i in range(2):
            s.add(VocabularyItem(id=f"v{i}", user_id=UID, word=f"w{i}", meaning="", source="manual", box=1,
                                 due_at=NOW, reps=1, lapses=0, last_reviewed_at=NOW - timedelta(minutes=5)))
        await s.commit()
        profile = await ledger.sync(s, UID, NOW + timedelta(minutes=1), 0, 60)
        tasks = await ledger.stage_progress_for(s, profile)
        assert (tasks[0].done, tasks[0].complete) == (0, False)


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


async def test_concurrent_syncs_and_unlocks_do_not_collide(tmp_path, monkeypatch):
    """Review #10: two /me requests at once computed the same fresh events and the loser 500ed on the unique index."""
    import asyncio

    from app.core.db import Base
    from app.main import create_app
    from app.rank import achievements
    from tests.conftest import make_settings

    url = f"sqlite+aiosqlite:///{(tmp_path / 'l.db').as_posix()}"
    app_ = create_app(make_settings(rank_enabled=True, database_url=url))
    try:
        async with app_.state.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with app_.state.sessionmaker() as s:
            await seed_user(s)
            s.add_all([assessment(i, 95, NOW - timedelta(minutes=i)) for i in range(5)])
            await ledger.load_profile(s, UID, NOW)
            await s.commit()

        real_collect = ledger._collect

        async def slow_collect(*args):  # every request computes its fresh events before any of them commits
            out = await real_collect(*args)
            await asyncio.sleep(0.05)
            return out

        monkeypatch.setattr(ledger, "_collect", slow_collect)

        async def me():
            async with app_.state.sessionmaker() as s:
                profile = await ledger.sync(s, UID, NOW, 0, 60)
                new = await achievements.unlock_new(s, UID, {"pron_90", "room_first"}, NOW)
                return profile.rp, new

        results = await asyncio.gather(me(), me(), me())
        assert len({rp for rp, _ in results}) == 1
        assert sorted(k for _, new in results for k in new) == ["pron_90", "room_first"]
        async with app_.state.sessionmaker() as s:
            assert await s.scalar(select(func.count()).select_from(XpEvent).where(XpEvent.kind == "active_day")) == 1
    finally:
        await app_.state.http.aclose()
        await app_.state.engine.dispose()
