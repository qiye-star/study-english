from datetime import datetime, timezone

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
