"""goals v2:PATCH /enrollment、有效值与兼容、立即生效、relearn 口径、/today 的 paused / streak / goal(spec 2026-10-11)。"""
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.models import WordbookEnrollment, WordbookEvent, utcnow
from app.services.usage import local_day
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"
TZ = 480


async def login(app, client, tmp_path, **overrides):
    enable_wordbook(app, make_data_dir(tmp_path), **overrides)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    assert r.status_code == 200, r.text
    return h


async def today(client, h) -> dict:
    r = await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": TZ})
    assert r.status_code == 200, r.text
    return r.json()


async def learn(client, h, key):
    return await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "key": key, "mode": "learn",
                                                                "qtype": "meaning", "known": True,
                                                                "tz_offset_minutes": TZ})


async def patch(client, h, **body):
    return await client.patch(f"{URL}/enrollment", headers=h, json=body)


async def user_id_of(app) -> int:
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(WordbookEnrollment.user_id).limit(1))


async def test_patch_applies_immediately_and_never_deletes_progress(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    for key in ("talk", "ability", "able"):
        assert (await learn(client, h, key)).status_code == 200
    r = await patch(client, h, daily_new=5)
    assert r.status_code == 200 and r.json()["daily_new"] == 5
    plan = (await today(client, h))["plan"]
    assert (plan["new_target"], plan["new_done"], plan["new_left"]) == (5, 3, 2)
    await patch(client, h, daily_new=2)  # 调低到已学数以下:不删进度
    t = await today(client, h)
    assert (t["plan"]["new_left"], t["progress"]["learned"]) == (0, 3)
    assert (await learn(client, h, "abandon")).json() == {"error": "Daily new-word limit reached"}
    await patch(client, h, daily_new=4)  # 再调高:当天马上多一个
    assert (await today(client, h))["plan"]["new_left"] == 1
    assert (await learn(client, h, "abandon")).status_code == 200


async def test_unlimited_reviews_and_validation(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    r = await patch(client, h, review_unlimited=True)
    assert r.status_code == 200 and (r.json()["review_unlimited"], r.json()["review_cap"]) == (True, 0)
    r = await patch(client, h, review_cap=1000)
    assert (r.json()["review_unlimited"], r.json()["review_cap"]) == (False, 1000)
    for body, error in (({}, "No changes"), ({"review_cap": 100, "review_unlimited": True}, "Conflicting review cap")):
        r = await patch(client, h, **body)
        assert r.status_code == 422 and r.json() == {"error": error}
    for body in ({"daily_new": 0}, {"daily_new": 201}, {"review_cap": 9}, {"review_cap": 1001},
                 {"review_unlimited": False}, {"order_mode": "random"}, {"book_id": "junior"}):
        assert (await patch(client, h, **body)).status_code == 422, body


async def test_order_change_restarts_the_cursor_but_keeps_learned_words(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn(client, h, "talk")
    r = await patch(client, h, order_mode="shuffle")
    assert r.status_code == 200 and r.json()["order_mode"] == "shuffle"
    async with app.state.sessionmaker() as s:
        assert (await s.scalar(select(WordbookEnrollment))).cursor == 0
    assert (await today(client, h))["progress"]["learned"] == 1


async def test_admin_ranges_are_enforced_and_old_values_are_clamped(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await patch(client, h, daily_new=150, review_unlimited=True)
    app.state.settings = app.state.settings.model_copy(update={
        "wordbook_daily_new_max": 50, "wordbook_review_unlimited": False, "wordbook_review_cap_max": 300})
    r = await patch(client, h, daily_new=60)
    assert r.status_code == 422 and r.json() == {"error": "Daily new words out of range"}
    assert (await patch(client, h, review_unlimited=True)).json() == {"error": "Unlimited reviews are off"}
    t = await today(client, h)
    e = t["enrollment"]
    assert (e["daily_new"], e["review_cap"], e["review_unlimited"]) == (50, 300, False)
    assert t["plan"]["new_target"] == 50
    async with app.state.sessionmaker() as s:  # 无迁移、不回写:库里仍是用户上次保存的值
        row = await s.scalar(select(WordbookEnrollment))
        assert (row.daily_new, row.review_cap) == (150, 0)
    cfg = (await client.get(f"{URL}/config", headers=h)).json()
    assert cfg["limits"] == {"daily_new": {"min": 1, "max": 50}, "review_cap": {"min": 10, "max": 300},
                             "review_unlimited": False, "bonus_max": 50}


async def test_put_enrollment_accepts_the_wider_ranges(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    r = await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "daily_new": 1,
                                                              "review_unlimited": True})
    assert r.status_code == 200 and (r.json()["daily_new"], r.json()["review_unlimited"]) == (1, True)
    assert (await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "daily_new": 0})).status_code == 422


async def test_relearn_counts_toward_the_daily_limit(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await patch(client, h, daily_new=2)
    async with app.state.sessionmaker() as s:  # 很久以前在别的书里学过 ability(行已不在)
        s.add(WordbookEvent(user_id=await user_id_of(app), book_id="cet4", kind="learn", word="ability", item_id=None,
                            qtype=None, outcome="known", credit=100, day="2026-01-01",
                            created_at=utcnow() - timedelta(days=300)))
        await s.commit()
    assert (await learn(client, h, "ability")).status_code == 200
    assert (await learn(client, h, "talk")).status_code == 200
    assert (await learn(client, h, "able")).json() == {"error": "Daily new-word limit reached"}
    async with app.state.sessionmaker() as s:
        kinds = (await s.scalars(select(WordbookEvent.kind).where(WordbookEvent.book_id == "junior")
                                 .order_by(WordbookEvent.id))).all()
    assert kinds == ["relearn", "learn"]


async def test_goal_is_recorded_once_and_the_streak_counts_back(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await patch(client, h, daily_new=1)
    first = await today(client, h)
    assert first["plan"]["goal_met"] is False and first["streak"] == {"current": 0, "today_met": False}
    assert first["paused"] is None
    d = date.fromisoformat(local_day(utcnow(), TZ))
    async with app.state.sessionmaker() as s:  # 前两天已达标
        for back in (1, 2):
            s.add(WordbookEvent(user_id=await user_id_of(app), book_id="junior", kind="goal", word="goal", item_id=None,
                                qtype=None, outcome="met", credit=0, day=(d - timedelta(days=back)).isoformat(),
                                created_at=utcnow()))
        await s.commit()
    assert (await today(client, h))["streak"] == {"current": 2, "today_met": False}
    await learn(client, h, "talk")  # 「我认识」→ 盒 2、4 天后到期:今天没有到期复习
    t = await today(client, h)
    assert t["plan"]["goal_met"] is True and t["streak"] == {"current": 3, "today_met": True}
    await today(client, h)
    async with app.state.sessionmaker() as s:
        assert len((await s.scalars(select(WordbookEvent.day).where(WordbookEvent.kind == "goal"))).all()) == 3


async def test_goal_is_not_written_during_maintenance(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await patch(client, h, daily_new=1)
    await learn(client, h, "talk")
    app.state.settings = app.state.settings.model_copy(update={"maintenance_mode": "read_only"})
    t = await today(client, h)
    assert t["plan"]["goal_met"] is True and t["streak"]["today_met"] is False


async def test_settings_changes_are_rate_limited(app, client, tmp_path, monkeypatch):
    from app.wordbook import store
    monkeypatch.setattr(store, "SETTINGS_DAILY_MAX", 2)
    h = await login(app, client, tmp_path)
    assert (await patch(client, h, daily_new=0)).status_code == 422  # 校验失败不占次数
    for n in (10, 11):
        assert (await patch(client, h, daily_new=n)).status_code == 200
    r = await patch(client, h, daily_new=12)
    assert r.status_code == 429 and r.json() == {"error": "Too many settings changes today"}


@pytest.mark.parametrize("offset", [-600, 0, 840])
async def test_today_shape_for_a_fresh_user(app, client, tmp_path, offset):
    enable_wordbook(app, make_data_dir(tmp_path))
    r = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    body = (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": offset})).json()
    assert body == {"enrollment": None, "book": None, "plan": None, "progress": None, "tomorrow_due": 0,
                    "paused": None, "streak": {"current": 0, "today_met": False}}
