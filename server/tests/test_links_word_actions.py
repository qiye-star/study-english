import logging

from sqlalchemy import func, select

from app.models import LinkCredit, VocabularyItem, WordbookEnrollment, WordbookEvent, utcnow
from app.services.stats import as_utc
from tests.links_helpers import check_contract, enable_links
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/links/wordbook"


async def login(app, client, tmp_path, *, enroll=True, **flags):
    enable_wordbook(app, make_data_dir(tmp_path))
    enable_links(app, **flags)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    if enroll:
        await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    return h


async def test_adopt_creates_a_due_box0_item_without_a_learn_event(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    assert (await client.post(f"{URL}/adopt", headers=h, json={"word": " Talk "})).json() == {"status": "added", "book_id": "junior"}
    async with app.state.sessionmaker() as s:
        item = (await s.scalars(select(VocabularyItem))).one()
        assert (item.word, item.box, item.source, item.reps) == ("talk", 0, "wordbook:junior", 0)
        assert as_utc(item.due_at) <= utcnow()
        assert await s.scalar(select(func.count()).select_from(WordbookEvent)) == 0  # no learn event, no rank points
    assert (await client.post(f"{URL}/adopt", headers=h, json={"word": "talk"})).json()["status"] == "known"
    assert (await client.post(f"{URL}/adopt", headers=h, json={"word": "zebra"})).json() == {"status": "not_in_book", "book_id": "junior"}
    await client.post("/api/vocabulary", headers=h, json={"word": "ability", "source": "lookup"})
    assert (await client.post(f"{URL}/adopt", headers=h, json={"word": "ability"})).json()["status"] == "known"


async def test_adopt_without_an_active_book_and_when_switched_off(app, client, tmp_path):
    h = await login(app, client, tmp_path, enroll=False)
    assert (await client.post(f"{URL}/adopt", headers=h, json={"word": "talk"})).json() == {"status": "not_in_book", "book_id": None}
    app.state.settings = app.state.settings.model_copy(update={"link_word_actions_enabled": False})
    r = await client.post(f"{URL}/adopt", headers=h, json={"word": "talk"})
    assert (r.status_code, r.json()) == (404, {"error": "Link is off"})
    app.state.settings = app.state.settings.model_copy(update={"link_word_actions_enabled": True, "wordbook_enabled": False})
    r = await client.post(f"{URL}/adopt", headers=h, json={"word": "talk"})
    assert (r.status_code, r.json()) == (404, {"error": "Wordbook is disabled"})
    assert (await client.post(f"{URL}/adopt", headers=h, json={"word": ""})).status_code == 422


async def test_card_lookup_prefers_the_active_book_and_records_the_contract(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    body = (await client.get(f"{URL}/card", headers=h, params={"word": "Talk"})).json()
    assert body["book_id"] == "junior" and body["card"]["key"] == "talk" and body["item"] is None
    missing = await client.get(f"{URL}/card", headers=h, params={"word": "zebra"})
    assert (missing.status_code, missing.json()) == (404, {"error": "Word not found"})
    assert (await client.get(f"{URL}/card", headers=h, params={"word": "a\x00b"})).status_code == 422
    added = (await client.post(f"{URL}/adopt", headers=h, json={"word": "talk"})).json()
    after = (await client.get(f"{URL}/card", headers=h, params={"word": "talk"})).json()
    assert after["item"]["box"] == 0
    check_contract("links_word_actions_contract", {"adopt": added, "card": after, "missing": missing.json()})


async def test_adopted_words_come_up_in_review_and_ignore_the_daily_new_goal(app, client, tmp_path):
    # Owner ruling:「加入词书学习」不受 daily_new 限制;不推进书序游标、不算今日新词、不得段位点(L-R8)
    h = await login(app, client, tmp_path)
    await client.patch("/api/wordbook/enrollment", headers=h, json={"daily_new": 1})
    before = (await client.get("/api/wordbook/today", headers=h)).json()["plan"]
    for word in ("talk", "carry", "child"):
        assert (await client.post(f"{URL}/adopt", headers=h, json={"word": word})).json()["status"] == "added"
    after = (await client.get("/api/wordbook/today", headers=h)).json()["plan"]
    assert after["new_done"] == before["new_done"] == 0 and after["new_left"] == before["new_left"]
    review = (await client.post("/api/wordbook/review/batch", headers=h, json={"size": 10})).json()
    assert sorted(c["key"] for c in review["cards"]) == ["carry", "child", "talk"]
    async with app.state.sessionmaker() as s:
        assert (await s.scalars(select(WordbookEnrollment))).one().cursor == 0
        assert await s.scalar(select(func.count()).select_from(LinkCredit)) == 0


async def test_user_pref_off_and_master_off_hide_both_endpoints(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    r = await client.put("/api/links/prefs", headers=h, json={"key": "word_actions", "enabled": False})
    assert r.status_code == 200
    for r in (await client.post(f"{URL}/adopt", headers=h, json={"word": "talk"}),
              await client.get(f"{URL}/card", headers=h, params={"word": "talk"})):
        assert (r.status_code, r.json()) == (404, {"error": "Link is off"})
    await client.put("/api/links/prefs", headers=h, json={"key": "word_actions", "enabled": True})
    app.state.settings = app.state.settings.model_copy(update={"links_enabled": False})
    r = await client.get(f"{URL}/card", headers=h, params={"word": "talk"})
    assert (r.status_code, r.json()) == (404, {"error": "Link is off"})
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(VocabularyItem)) == 0


async def test_missing_book_data_is_503_and_logs_carry_no_words(app, client, tmp_path, caplog):
    h = await login(app, client, tmp_path)
    (tmp_path / "dict" / "junior.jsonl").unlink()
    if hasattr(app.state, "wordbook_dict"):  # 进程里已建索引时换一个新 store
        del app.state.wordbook_dict
    caplog.set_level(logging.DEBUG)
    r = await client.post(f"{URL}/adopt", headers=h, json={"word": "talk"})
    assert (r.status_code, r.json()) == (503, {"error": "Wordbook data unavailable"})
    r = await client.get(f"{URL}/card", headers=h, params={"word": "talk"})
    assert (r.status_code, r.json()) == (503, {"error": "Wordbook data unavailable"})
    # 只看服务端日志(测试客户端 httpx 自己会记录请求 URL)
    assert not [r for r in caplog.records if r.name.startswith("app") and "talk" in r.getMessage()]
