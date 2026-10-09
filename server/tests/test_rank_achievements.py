from datetime import date, datetime, timedelta, timezone

from app.models import PromotionMatch, Room, RoomMember, RoomMessage, User, XpEvent
from app.rank import achievements as ach

NOW = datetime(2027, 1, 5, 9, 0, tzinfo=timezone.utc)
UID = 12345678


def test_catalog_keys():
    assert [a.key for a in ach.CATALOG] == [
        "streak_3", "streak_7", "streak_30", "streak_100", "first_promotion", "first_try", "tier_gold",
        "tier_diamond", "tier_master", "pron_90", "pron_85_x20", "chat_100", "vocab_100", "room_first",
        "room_assisted_10", "season_climber"]


def test_earned_thresholds():
    assert ach.earned(ach.Snapshot()) == set()
    s = ach.Snapshot(best_streak=7, best_tier=2, promotions=2, first_try=1, best_pron=90, pron85=20, chat_turns=100,
                     vocab_reviews=100, rooms_joined=1, assisted_sends=10, season_promotions=1)
    assert ach.earned(s) == {"streak_3", "streak_7", "first_promotion", "first_try", "tier_gold", "pron_90",
                             "pron_85_x20", "chat_100", "vocab_100", "room_first", "room_assisted_10", "season_climber"}


def test_longest_streak():
    d = date(2026, 10, 1)
    days = {d + timedelta(days=i) for i in (0, 1, 2, 4, 5, 6, 7, 8)}
    assert ach.longest_streak(days) == 5 and ach.longest_streak(set()) == 0


async def test_snapshot_unlock_and_season_badge(app):
    async with app.state.sessionmaker() as s:
        s.add(User(id=UID, username="u", password_hash="x"))
        for i, day in enumerate(["2026-11-03", "2026-11-04", "2026-11-05"]):
            s.add(XpEvent(user_id=UID, kind="active_day", ref_id=day, points=5, day=day, tier=1, created_at=NOW))
        s.add(XpEvent(user_id=UID, kind="assessment", ref_id="a1", points=4, score=93, day="2026-11-05", tier=1, created_at=NOW))
        s.add(PromotionMatch(id="p1", user_id=UID, from_tier=1, to_tier=2, scenario_key="k", status="passed", turn_limit=5,
                             turns=[], threshold=65, attempt_no=1, started_at=datetime(2026, 11, 20, tzinfo=timezone.utc),
                             expires_at=NOW, finished_at=datetime(2026, 11, 20, 0, 10, tzinfo=timezone.utc)))
        s.add(Room(id="r1", code=None, last_code="111222", owner_id=UID, topic="", status="closed", created_at=NOW, last_active_at=NOW))
        s.add(RoomMember(room_id="r1", user_id=UID, role="owner", joined_at=NOW))
        s.add(RoomMessage(id="x", room_id="r1", seq=1, lane="public", sender_kind="user", sender_id=UID, kind="text",
                          text="hi", assisted=True, created_at=NOW))
        await s.commit()
        snap = await ach.snapshot(s, UID, best_tier=2, season=None)
        assert (snap.best_streak, snap.best_pron, snap.promotions, snap.first_try, snap.rooms_joined, snap.assisted_sends) == (3, 93, 1, 1, 1, 1)
        badges = await ach.season_badges(s, UID, date(2027, 1, 5), date(2026, 11, 2), 8)
        assert badges == {"season_1_gold"}
        new = await ach.unlock_new(s, UID, ach.earned(snap) | badges, NOW)
        assert "season_1_gold" in new and "streak_3" in new
        assert await ach.unlock_new(s, UID, ach.earned(snap) | badges, NOW) == []
        listing = await ach.listing(s, UID)
        assert len(listing) == 17 and listing[-1] == {"key": "season_1_gold", "group": "season", "icon": "shield-star",
                                                      "unlocked_at": listing[-1]["unlocked_at"]}
