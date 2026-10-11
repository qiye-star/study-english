"""已学词汇总 / 列表 / 词卡(计划 2026-10-12-wordbook-learned-review S3)。"""
from datetime import timedelta

from sqlalchemy import update

from app.models import VocabularyItem, utcnow
from app.services.usage import local_day
from app.wordbook import plan as planning
from tests.test_admin_routes_guarded import api_routes
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"
OFFSET = 480


async def login(app, client, tmp_path, name="alice", **overrides):
    enable_wordbook(app, make_data_dir(tmp_path, ("junior", "senior")), wordbook_books="junior,senior", **overrides)
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    return h


async def rate(client, h, key, rating):
    r = await client.post(f"{URL}/answers", headers=h, json={
        "book_id": "junior", "key": key, "mode": "learn", "qtype": "recall", "rating": rating, "tz_offset_minutes": OFFSET})
    assert r.status_code == 200, r.text


async def learn_three(client, h):
    """talk 认识(盒 2)、ability 模糊(盒 1)、able 不认识(盒 0);按这个顺序建行,able 最新。"""
    for key, rating in (("talk", "know"), ("ability", "fuzzy"), ("able", "unknown")):
        await rate(client, h, key, rating)


async def query(client, h, **body):
    return await client.post(f"{URL}/learned/query", headers=h, json={"tz_offset_minutes": OFFSET, **body})


async def keys(client, h, **body):
    r = await query(client, h, **body)
    assert r.status_code == 200, r.text
    return [i["key"] for i in r.json()["items"]]


async def patch_rows(app, word, **values):
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == word).values(**values))
        await s.commit()


async def test_summary_counts_boxes_tiers_books_and_windows(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_three(client, h)
    yesterday = planning.day_end(utcnow(), OFFSET, -2) + timedelta(hours=1)
    await patch_rows(app, "talk", created_at=yesterday)
    await patch_rows(app, "ability", lapses=1)
    r = (await client.get(f"{URL}/learned/summary", headers=h, params={"tz_offset_minutes": OFFSET})).json()
    assert r["total"] == 3 and r["by_box"] == [1, 1, 1, 0, 0, 0]
    assert r["by_tier"] == {"learning": 2, "growing": 1, "mastered": 0}
    assert r["by_book"] == [{"book_id": "junior", "count": 3}]
    assert (r["weak"], r["yesterday"], r["last7"]) == (1, 1, 3)


async def test_list_is_newest_first_with_headword_tier_and_weak(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_three(client, h)
    await patch_rows(app, "ability", lapses=1)
    items = (await query(client, h)).json()["items"]
    assert [i["key"] for i in items] == ["able", "ability", "talk"]
    ability = items[1]
    assert set(ability) == {"book_id", "key", "word", "box", "tier", "learned_at", "due_at", "weak"}
    assert (ability["book_id"], ability["word"], ability["box"], ability["tier"], ability["weak"]) == (
        "junior", "ability", 1, "learning", True)
    assert items[0]["weak"] is False


async def test_filters(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_three(client, h)
    await patch_rows(app, "ability", lapses=1)
    today = local_day(utcnow(), OFFSET)
    assert await keys(client, h, tier="growing") == ["talk"]
    assert await keys(client, h, weak=True) == ["ability"]
    assert await keys(client, h, q="ab") == ["able", "ability"] and await keys(client, h, q="AB") == ["able", "ability"]
    assert await keys(client, h, q="%") == [] and await keys(client, h, q="a_") == []
    assert await keys(client, h, book="junior", tier="learning") == ["able", "ability"]
    assert len(await keys(client, h, since=today, until=today)) == 3            # until 含当天
    assert await keys(client, h, until="2000-01-01") == []                       # 都晚于这一天
    assert await keys(client, h, since="2999-01-01") == []


async def test_book_filter_rejects_disabled_books_and_hides_their_rows(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_three(client, h)
    enable_wordbook(app, make_data_dir(tmp_path, ("junior", "senior")), wordbook_books="senior")
    assert (await query(client, h, book="junior")).status_code == 404
    assert (await query(client, h, book="junior")).json() == {"error": "Book not found"}
    assert await keys(client, h) == []
    summary = (await client.get(f"{URL}/learned/summary", headers=h, params={"tz_offset_minutes": OFFSET})).json()
    assert summary["total"] == 0 and summary["by_book"] == []


async def test_cursor_walks_every_row_once(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_three(client, h)
    first = (await query(client, h, limit=2)).json()
    assert len(first["items"]) == 2 and first["next_cursor"]
    second = (await query(client, h, limit=2, cursor=first["next_cursor"])).json()
    assert len(second["items"]) == 1 and second["next_cursor"] is None
    assert sorted(i["key"] for i in first["items"] + second["items"]) == ["ability", "able", "talk"]


async def test_bad_cursor_and_bad_date_are_422(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    assert (await query(client, h, cursor="!!!")).json() == {"error": "Invalid cursor"}
    assert (await query(client, h, since="2026-13-45")).json() == {"error": "Invalid date"}
    assert (await query(client, h, q="x" * 31)).status_code == 422
    assert (await query(client, h, limit=51)).status_code == 422
    assert (await query(client, h, words=["talk"])).status_code == 422  # extra="forbid"


async def test_each_user_sees_only_their_own_words(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_three(client, h)
    r = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    bob = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert await keys(client, bob) == []
    assert (await client.post(f"{URL}/learned/card", headers=bob, json={"book_id": "junior", "key": "talk"})).status_code == 404


async def test_card_only_for_learned_words_of_that_book(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_three(client, h)
    ok = await client.post(f"{URL}/learned/card", headers=h, json={"book_id": "junior", "key": "talk"})
    assert ok.status_code == 200 and ok.json()["key"] == "talk" and ok.json()["senses"]
    for body in ({"book_id": "junior", "key": "abandon"}, {"book_id": "senior", "key": "talk"}):
        r = await client.post(f"{URL}/learned/card", headers=h, json=body)
        assert (r.status_code, r.json()) == (404, {"error": "Word not found"})


async def test_disabled_wordbook_hides_the_endpoints(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    enable_wordbook(app, make_data_dir(tmp_path), wordbook_enabled=False)
    assert (await query(client, h)).json() == {"error": "Wordbook is disabled"}
    assert (await client.get(f"{URL}/learned/summary", headers=h)).status_code == 404


async def test_prefix_and_words_never_reach_the_logs(app, client, tmp_path, caplog):
    caplog.set_level("INFO")  # DEBUG 会带出 aiosqlite 的 SQL 参数(测试环境才开),与路由无关
    h = await login(app, client, tmp_path)
    await learn_three(client, h)
    await query(client, h, q="zqxjv")
    await client.post(f"{URL}/learned/card", headers=h, json={"book_id": "junior", "key": "talk"})
    assert "zqxjv" not in caplog.text and "ability" not in caplog.text


async def test_new_routes_carry_no_word_in_the_url(app):
    seen = 0
    for path, route in api_routes(app.routes):  # FastAPI 把 include 的路由包了一层,用现成的遍历
        if path.startswith(f"{URL}/learned") or path.startswith(f"{URL}/free"):
            seen += 1
            assert "{" not in path, path  # 没有路径参数
            assert {p.name for p in route.dependant.query_params} <= {"tz_offset_minutes"}, path
    assert seen >= 3


async def test_out_of_range_dates_are_422_not_500(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    for body in ({"until": "9999-12-31", "tz_offset_minutes": 0}, {"until": "9999-12-31", "tz_offset_minutes": -840},
                 {"since": "0001-01-01", "tz_offset_minutes": 840}, {"since": "0001-01-01"},
                 {"until": "0001-01-01", "tz_offset_minutes": 840}):
        r = await client.post(f"{URL}/learned/query", headers=h, json={"tz_offset_minutes": OFFSET, **body})
        assert r.status_code == 422 and r.json() == {"error": "Invalid date"}, body
