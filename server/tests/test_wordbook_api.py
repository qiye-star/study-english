import pytest

from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"


async def login(app, client, tmp_path, **overrides):
    enable_wordbook(app, make_data_dir(tmp_path), **overrides)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


DISABLED_PATHS = [("GET", "/books"), ("PUT", "/enrollment"), ("GET", "/today")]  # S3–S5 各自追加自己的路径


@pytest.mark.parametrize("method,path", DISABLED_PATHS)
async def test_disabled_routes_404(client, auth_headers, method, path):
    r = await client.request(method, URL + path, headers=auth_headers, json={})
    assert r.status_code == 404 and r.json() == {"error": "Wordbook is disabled"}


@pytest.mark.parametrize("method,path", DISABLED_PATHS)
async def test_routes_require_login(app, client, tmp_path, method, path):
    enable_wordbook(app, make_data_dir(tmp_path))
    assert (await client.request(method, URL + path, json={})).status_code == 401


async def test_config_lists_enabled_books_with_availability(app, client, tmp_path):
    h = await login(app, client, tmp_path, wordbook_books="junior,toefl")
    body = (await client.get(f"{URL}/config", headers=h)).json()
    assert body["enabled"] is True and body["defaults"] == {"daily_new": 20, "review_cap": 100}
    assert [(b["id"], b["available"]) for b in body["books"]] == [("junior", True), ("toefl", False)]
    assert body["ai_available"] is False


async def test_enroll_today_and_books(app, client, tmp_path):
    h = await login(app, client, tmp_path, wordbook_books="junior,senior")
    await client.post("/api/vocabulary", headers=h, json={"word": "accept", "source": "lookup"})
    empty = (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": 480})).json()
    assert empty == {"enrollment": None, "book": None, "plan": None, "progress": None, "tomorrow_due": 0}
    r = await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book", "daily_new": 10})
    assert r.status_code == 200 and r.json()["status"] == "active" and r.json()["daily_new"] == 10
    assert r.json()["review_cap"] == 100 and r.json()["order_mode"] == "book" and "seed" not in r.json()
    today = (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": 480})).json()
    assert today["book"]["id"] == "junior" and today["book"]["available"] is True
    assert today["progress"] == {"words": 14, "learned": 1, "mastered": 0, "remaining": 13}
    assert today["plan"] == {"new_target": 10, "new_done": 0, "new_left": 10, "review_due": 1, "review_done": 0,
                             "review_left": 1, "backlog_guard": False}
    assert today["tomorrow_due"] == 1
    books = (await client.get(f"{URL}/books", headers=h)).json()["books"]
    assert [(b["id"], b["enrolled"], b["active"], b["learned"]) for b in books] == [
        ("junior", True, True, 1), ("senior", False, False, 0)]
    assert books[0]["words"] == 14 and set(books[0]) == {"id", "title_zh", "title_en", "level", "words", "learned",
                                                          "mastered", "enrolled", "active"}


async def test_reenrolling_keeps_settings_unless_given(app, client, tmp_path):
    h = await login(app, client, tmp_path, wordbook_books="junior,senior")
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "daily_new": 10})
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "senior"})
    again = (await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior"})).json()
    assert (again["daily_new"], again["order_mode"], again["status"]) == (10, "shuffle", "active")


async def test_enrollment_errors(app, client, tmp_path):
    h = await login(app, client, tmp_path, wordbook_books="junior,senior")
    r = await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "toefl"})
    assert r.status_code == 404 and r.json() == {"error": "Book not found"}
    assert (await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "daily_new": 1})).status_code == 422
    assert (await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "x": 1})).status_code == 422
    assert (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": 900})).status_code == 422
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "senior"})
    r = await client.get(f"{URL}/today", headers=h)
    assert r.status_code == 503 and r.json() == {"error": "Wordbook data unavailable"}


async def test_disabling_the_active_book_keeps_enrollment(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior"})
    app.state.settings = app.state.settings.model_copy(update={"wordbook_books": "senior"})
    today = (await client.get(f"{URL}/today", headers=h)).json()
    assert today["enrollment"]["book_id"] == "junior" and today["book"] is None and today["plan"] is None
