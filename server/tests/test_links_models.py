import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import LinkCredit, LinkMistakeWord, LinkWeakWord, LinkWordUse, UserLinkPref, utcnow
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as
from tests.test_admin_api import register

MODELS = (UserLinkPref, LinkMistakeWord, LinkWeakWord, LinkWordUse, LinkCredit)


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "data")}


async def seed(app, uid):
    now = utcnow()
    async with app.state.sessionmaker() as s:
        s.add(UserLinkPref(user_id=uid, link_key="mistakes", enabled=False, updated_at=now))
        s.add(LinkMistakeWord(user_id=uid, word="talk", book_id="junior", wrong_count=1, ok_streak=0,
                              last_event_at=now, last_wrong_at=now, cleared_at=None))
        s.add(LinkWeakWord(user_id=uid, word="three", hits=1, last_score=40, ok_streak=0, last_event_at=now,
                           last_weak_at=now, cleared_at=None))
        s.add(LinkWordUse(user_id=uid, word="talk", learn_event_id=1, message_id="m1", created_at=now))
        s.add(LinkCredit(user_id=uid, kind="word_in_chat", ref_id="wic:1", score=None, created_at=now))
        await s.commit()


async def test_credit_and_use_uniqueness(app, client):
    uid, _ = await register(client, "alice")
    await seed(app, uid)
    async with app.state.sessionmaker() as s:
        s.add(LinkCredit(user_id=uid, kind="word_in_chat", ref_id="wic:1", score=None, created_at=utcnow()))
        with pytest.raises(IntegrityError):
            await s.commit()
    async with app.state.sessionmaker() as s:
        s.add(LinkWordUse(user_id=uid, word="talk", learn_event_id=1, message_id="m2", created_at=utcnow()))
        with pytest.raises(IntegrityError):
            await s.commit()


async def test_deleting_a_user_deletes_their_link_rows(app, client):
    uid, _ = await register(client, "dora")
    other, _ = await register(client, "erin")
    await seed(app, uid)
    await seed(app, other)
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=h,
                             json={"confirm_username": "dora", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        for model in MODELS:
            assert await s.scalar(select(func.count()).select_from(model).where(model.user_id == uid)) == 0, model
            assert await s.scalar(select(func.count()).select_from(model).where(model.user_id == other)) == 1, model


async def test_purge_drops_old_uses_and_long_cleared_rows_only(app, client):
    from datetime import timedelta

    from app.links.purge import purge
    uid, _ = await register(client, "fay")
    now = utcnow()
    old, fresh = now - timedelta(days=91), now - timedelta(days=1)
    async with app.state.sessionmaker() as s:
        s.add(LinkWordUse(user_id=uid, word="a", learn_event_id=1, message_id="m1", created_at=old))
        s.add(LinkWordUse(user_id=uid, word="b", learn_event_id=2, message_id="m2", created_at=fresh))
        for word, cleared in (("a", now - timedelta(days=31)), ("b", fresh), ("c", None)):
            s.add(LinkMistakeWord(user_id=uid, word=word, book_id="junior", wrong_count=1, ok_streak=0,
                                  last_event_at=now, last_wrong_at=now, cleared_at=cleared))
            s.add(LinkWeakWord(user_id=uid, word=word, hits=1, last_score=40, ok_streak=0, last_event_at=now,
                               last_weak_at=now, cleared_at=cleared))
        await s.commit()
    async with app.state.sessionmaker() as s:
        assert await purge(s, now, 90) == {"word_uses": 1, "mistakes": 1, "weak_words": 1}
    async with app.state.sessionmaker() as s:
        assert set((await s.scalars(select(LinkMistakeWord.word))).all()) == {"b", "c"}
        assert set((await s.scalars(select(LinkWordUse.word))).all()) == {"b"}
