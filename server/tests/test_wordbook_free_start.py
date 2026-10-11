"""自由复习抽取(计划 2026-10-12-wordbook-learned-review S4)。"""
import random
from datetime import timedelta

from sqlalchemy import func, select, update

from app.models import VocabularyItem, WordbookEvent, utcnow
from app.wordbook import plan as planning
from app.wordbook import quiz, service, store
from app.wordbook.index import dictionary
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"
OFFSET = 480
WORDS = ("talk", "ability", "able", "abandon", "absorb", "accept")


async def login(app, client, tmp_path, **overrides):
    enable_wordbook(app, make_data_dir(tmp_path, ("junior", "senior")), wordbook_books="junior,senior", **overrides)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    for key in WORDS:
        await client.post(f"{URL}/answers", headers=h, json={
            "book_id": "junior", "key": key, "mode": "learn", "qtype": "recall", "rating": "know",
            "tz_offset_minutes": OFFSET})
    return h


async def start(client, h, **body):
    return await client.post(f"{URL}/free/start", headers=h, json={
        "scope": "all", "mode": "choice", "count": 10, "tz_offset_minutes": OFFSET, **body})


async def test_choice_set_has_a_question_per_card_and_the_right_option(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    r = await start(client, h)
    assert r.status_code == 200
    out = r.json()
    assert set(out) == {"set_id", "scope", "mode", "items"} and len(out["set_id"]) == 12
    assert sorted(i["card"]["key"] for i in out["items"]) == sorted(WORDS)
    for item in out["items"]:
        q = item["question"]
        assert item["book_id"] == "junior" and q["key"] == item["card"]["key"]
        assert q["qtype"] in {"meaning", "word", "cloze"} and len(q["options"]) >= 2
        card = await dictionary(app).card("junior", q["key"])
        assert (quiz.correct_option(q["qtype"], card)) in q["options"]


async def test_browse_has_no_questions_and_recall_and_spell_use_existing_types(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    browse = (await start(client, h, mode="browse")).json()["items"]
    assert browse and all(i["question"] is None for i in browse)
    recall = (await start(client, h, mode="recall")).json()["items"]
    assert {i["question"]["qtype"] for i in recall} == {"recall"} and recall[0]["question"]["options"] is None
    spell = (await start(client, h, mode="spell")).json()["items"]
    assert spell and {i["question"]["qtype"] for i in spell} == {"spell"}
    assert all(" " not in i["card"]["key"] and i["question"]["length"] == len(i["card"]["word"]) for i in spell)


async def test_count_caps_the_set_and_a_small_pool_returns_fewer(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    assert len((await start(client, h, count=10)).json()["items"]) == len(WORDS)
    enable_wordbook(app, make_data_dir(tmp_path, ("junior", "senior")), wordbook_books="junior,senior")
    assert (await start(client, h, count=5)).status_code == 422  # 只接受 10 / 20 / 50


async def test_yesterday_and_last7_use_local_days(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    assert (await start(client, h, scope="yesterday")).json() == {"error": "No words to review"}
    yesterday = planning.day_end(utcnow(), OFFSET, -2) + timedelta(hours=1)
    old = utcnow() - timedelta(days=30)
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word.in_(["talk", "able"])).values(created_at=yesterday))
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == "absorb").values(created_at=old))
        await s.commit()
    got = lambda r: sorted(i["card"]["key"] for i in r.json()["items"])  # noqa: E731
    assert got(await start(client, h, scope="yesterday")) == ["able", "talk"]
    assert got(await start(client, h, scope="last7")) == sorted(w for w in WORDS if w != "absorb")


async def test_book_tier_and_weak_scopes(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == "talk").values(box=5))
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == "able").values(box=1, lapses=2))
        await s.commit()
    keys = lambda r: sorted(i["card"]["key"] for i in r.json()["items"])  # noqa: E731
    assert keys(await start(client, h, scope="tier", tier="mastered")) == ["talk"]
    assert keys(await start(client, h, scope="weak")) == ["able"]
    assert len(keys(await start(client, h, scope="book", book="junior"))) == len(WORDS)
    assert (await start(client, h, scope="book")).json() == {"error": "Invalid scope"}                 # 缺书
    assert (await start(client, h, scope="tier")).json() == {"error": "Invalid scope"}                 # 缺熟练度
    assert (await start(client, h, scope="book", book="cet4")).json() == {"error": "Invalid scope"}    # 未启用的书
    assert (await start(client, h, scope="book", book="senior")).json() == {"error": "No words to review"}  # 启用了但没有词


async def test_the_client_cannot_name_words(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    assert (await start(client, h, keys=["talk"])).status_code == 422
    assert (await start(client, h, key="talk")).status_code == 422


async def test_start_writes_no_events_and_spends_no_answers(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    async with app.state.sessionmaker() as s:
        before = await s.scalar(select(func.count()).select_from(WordbookEvent))
    await start(client, h)
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(WordbookEvent)) == before


async def test_daily_start_limit(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    monkeypatch.setattr(store, "FREE_STARTS_DAILY_MAX", 1)
    assert (await start(client, h)).status_code == 200
    r = await start(client, h)
    assert (r.status_code, r.json()) == (429, {"error": "Daily free-review limit reached"})


async def test_an_empty_pool_does_not_cost_a_start(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    monkeypatch.setattr(store, "FREE_STARTS_DAILY_MAX", 1)
    assert (await start(client, h, scope="yesterday")).status_code == 409
    assert (await start(client, h)).status_code == 200


async def test_injected_rng_makes_the_draw_reproducible(app, client, tmp_path):
    await login(app, client, tmp_path)
    async with app.state.sessionmaker() as s:
        from app.models import User
        uid = await s.scalar(select(User.id))
        args = dict(scope="all", mode="browse", count=10, book=None, tier=None, offset=OFFSET, now=utcnow())
        a = await service.free_start(s, dictionary(app), uid, app.state.settings, rng=random.Random(7), **args)
        b = await service.free_start(s, dictionary(app), uid, app.state.settings, rng=random.Random(7), **args)
    assert [i["card"]["key"] for i in a["items"]] == [i["card"]["key"] for i in b["items"]]


async def test_free_choice_qtype_offers_cloze_only_when_a_sentence_can_be_blanked(app, client, tmp_path):
    await login(app, client, tmp_path)
    ability = await dictionary(app).card("junior", "ability")  # 例句里只有变形或没有原形时没有 cloze
    talk = await dictionary(app).card("junior", "talk")
    for card in (ability, talk):
        seen = {quiz.free_choice_qtype(card, random.Random(i)) for i in range(80)}
        assert {"meaning", "word"} <= seen <= {"meaning", "word", "cloze"}
        assert ("cloze" in seen) == bool(quiz.cloze_example(card))
    assert quiz.free_spellable(talk) is True


async def test_words_never_reach_the_logs(app, client, tmp_path, caplog):
    caplog.set_level("INFO")  # DEBUG 会带出 aiosqlite 的 SQL 参数(测试环境才开),与路由无关
    h = await login(app, client, tmp_path)
    await start(client, h, mode="spell")
    assert "ability" not in caplog.text and "absorb" not in caplog.text
