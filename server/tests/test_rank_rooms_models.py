from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import DailyUsage, Room, RoomMessage, User, XpEvent

NOW = datetime(2026, 10, 9, 9, 0, tzinfo=timezone.utc)


async def _user(session, uid=12345678):
    session.add(User(id=uid, username=f"u{uid}", password_hash="x"))
    await session.commit()
    return uid


async def test_xp_event_is_unique_per_user_kind_ref(app):
    async with app.state.sessionmaker() as s:
        uid = await _user(s)
        s.add(XpEvent(user_id=uid, kind="chat_turn", ref_id="m1", points=1, day="2026-10-09", tier=0, created_at=NOW))
        await s.commit()
        s.add(XpEvent(user_id=uid, kind="chat_turn", ref_id="m1", points=1, day="2026-10-09", tier=0, created_at=NOW))
        with pytest.raises(IntegrityError):
            await s.commit()


async def test_closed_rooms_release_their_code(app):
    async with app.state.sessionmaker() as s:
        uid = await _user(s)
        s.add_all([
            Room(id="r1", code=None, last_code="482913", owner_id=uid, topic="", status="closed", created_at=NOW, last_active_at=NOW),
            Room(id="r2", code=None, last_code="482913", owner_id=uid, topic="", status="closed", created_at=NOW, last_active_at=NOW),
            Room(id="r3", code="482913", last_code="482913", owner_id=uid, topic="", status="open", created_at=NOW, last_active_at=NOW),
        ])
        await s.commit()
        s.add(Room(id="r4", code="482913", last_code="482913", owner_id=uid, topic="", status="open", created_at=NOW, last_active_at=NOW))
        with pytest.raises(IntegrityError):
            await s.commit()


async def test_room_seq_is_unique_and_daily_usage_unique(app):
    async with app.state.sessionmaker() as s:
        uid = await _user(s)
        s.add(Room(id="r1", code="111222", last_code="111222", owner_id=uid, topic="", status="open", created_at=NOW, last_active_at=NOW))
        s.add(RoomMessage(id="a", room_id="r1", seq=1, lane="public", sender_kind="user", sender_id=uid, kind="text", text="hi", created_at=NOW))
        await s.commit()
        s.add(RoomMessage(id="b", room_id="r1", seq=1, lane="public", sender_kind="user", sender_id=uid, kind="text", text="hi", created_at=NOW))
        with pytest.raises(IntegrityError):
            await s.commit()
        await s.rollback()
        s.add_all([DailyUsage(scope="room_assist", subject="1", day="2026-10-09", count=1),
                   DailyUsage(scope="room_assist", subject="1", day="2026-10-09", count=1)])
        with pytest.raises(IntegrityError):
            await s.commit()
