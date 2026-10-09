from datetime import datetime, timezone

from app.models import DailyUsage, User
from app.services import usage
from app.services.usage import consume, local_day, refund, remaining, utc_day


def test_days():
    now = datetime(2026, 10, 9, 20, 30, tzinfo=timezone.utc)
    assert utc_day(now) == "2026-10-09"
    assert local_day(now, 480) == "2026-10-10"
    assert local_day(now, -720) == "2026-10-09"


async def test_consume_until_limit_then_refund(app):
    async with app.state.sessionmaker() as s:
        assert [await consume(s, "rank_match", "1", "2026-10-09", 2) for _ in range(3)] == [True, True, False]
        assert await remaining(s, "rank_match", "1", "2026-10-09", 2) == 0
        await refund(s, "rank_match", "1", "2026-10-09")
        assert await remaining(s, "rank_match", "1", "2026-10-09", 2) == 1
        assert await remaining(s, "rank_match", "2", "2026-10-09", 2) == 2
        assert await consume(s, "rank_match", "1", "2026-10-10", 0) is False


async def test_refund_never_goes_negative(app):
    async with app.state.sessionmaker() as s:
        await refund(s, "room_assist", "1", "2026-10-09")
        assert await remaining(s, "room_assist", "1", "2026-10-09", 3) == 3


async def test_lost_insert_race_keeps_caller_objects_loaded(app, monkeypatch):
    """Review #5: a concurrent insert of the same daily_usage row must not roll back (and expire) the caller's
    session; a later attribute load in async context would 500 with MissingGreenlet."""
    real_count, raced = usage._count, []

    async def racing_count(session, scope, subject, day):
        if not raced:
            raced.append(1)
            async with app.state.sessionmaker() as other:  # another request wins the INSERT
                other.add(DailyUsage(scope=scope, subject=subject, day=day, count=1))
                await other.commit()
            return 0
        return await real_count(session, scope, subject, day)

    async with app.state.sessionmaker() as s:
        s.add(User(id=7, username="u7", password_hash="x"))
        await s.commit()
        user = await s.get(User, 7)
        monkeypatch.setattr(usage, "_count", racing_count)
        assert await consume(s, "rank_match", "7", "2026-10-09", 5) is True
        assert user.username == "u7"  # still loaded: no rollback happened
        assert await remaining(s, "rank_match", "7", "2026-10-09", 5) == 3
        assert await consume(s, "rank_match", "7", "2026-10-09", 2) is False
        assert user.username == "u7"
