"""`def_lang` preference (spec 2026-10-12-wordbook-definitions §4, plan R-DS3): stored per user, no migration."""
import logging

import pytest
from sqlalchemy import func, select

from app.models import WordbookEvent
from app.wordbook import store
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"


async def register(app, client, tmp_path, name="alice", **overrides):
    enable_wordbook(app, make_data_dir(tmp_path), **overrides)
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def config(client, h) -> dict:
    return (await client.get(f"{URL}/config", headers=h)).json()


async def pref_rows(app) -> list[tuple[int, str, str]]:
    async with app.state.sessionmaker() as s:
        rows = await s.execute(select(WordbookEvent.user_id, WordbookEvent.book_id, WordbookEvent.outcome)
                               .where(WordbookEvent.kind == store.DEF_PREF_KIND).order_by(WordbookEvent.id))
        return [tuple(r) for r in rows]


async def test_default_is_both_and_the_key_sits_next_to_the_other_config_keys(app, client, tmp_path):
    h = await register(app, client, tmp_path)
    cfg = await config(client, h)
    assert cfg["def_lang"] == "both" and {"enabled", "defaults", "learn", "limits", "books"} <= set(cfg)


async def test_disabled_config_is_unchanged(app, client, tmp_path):
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert (await client.get(f"{URL}/config", headers=h)).json() == {"enabled": False}


@pytest.mark.parametrize("value", ["zh", "en", "both"])
async def test_patch_saves_and_config_returns_it(app, client, tmp_path, value):
    h = await register(app, client, tmp_path)
    await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "en" if value == "both" else "both"})
    r = await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": value})
    assert r.status_code == 200 and r.json() == {"def_lang": value}  # no active book: only the preference comes back
    assert (await config(client, h))["def_lang"] == value


@pytest.mark.parametrize("bad", ["fr", "", "EN", 1, None, ["en"], {"x": 1}])
async def test_unknown_values_are_422_and_change_nothing(app, client, tmp_path, bad):
    h = await register(app, client, tmp_path)
    await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "zh"})
    r = await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": bad})
    assert r.status_code == 422  # None alone is "No changes", also 422
    assert (await config(client, h))["def_lang"] == "zh"


async def test_extra_keys_are_still_rejected(app, client, tmp_path):
    h = await register(app, client, tmp_path)
    assert (await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "en", "foo": 1})).status_code == 422


async def test_it_is_per_user(app, client, tmp_path):
    a = await register(app, client, tmp_path)
    r = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    b = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.patch(f"{URL}/enrollment", headers=a, json={"def_lang": "en"})
    assert (await config(client, a))["def_lang"] == "en" and (await config(client, b))["def_lang"] == "both"


async def test_with_an_active_book_the_response_is_the_enrollment_plus_def_lang(app, client, tmp_path):
    h = await register(app, client, tmp_path)
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    r = await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "en"})
    assert r.status_code == 200
    body = r.json()
    assert body["def_lang"] == "en" and body["book_id"] == "junior" and "daily_new" in body


async def test_goals_and_def_lang_in_one_request_cost_one_settings_use(app, client, tmp_path, monkeypatch):
    h = await register(app, client, tmp_path)
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    monkeypatch.setattr(store, "SETTINGS_DAILY_MAX", 2)
    assert (await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 7, "def_lang": "zh"})).status_code == 200
    assert (await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 8})).status_code == 200
    assert (await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 9})).status_code == 429
    assert (await config(client, h))["def_lang"] == "zh"


async def test_an_invalid_goal_with_a_def_lang_changes_neither(app, client, tmp_path):
    h = await register(app, client, tmp_path)
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    r = await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 5, "def_lang": "en"})
    assert r.status_code == 200
    app.state.settings = app.state.settings.model_copy(update={"wordbook_daily_new_max": 10})
    r = await client.patch(f"{URL}/enrollment", headers=h, json={"daily_new": 50, "def_lang": "zh"})
    assert r.status_code == 422
    assert (await config(client, h))["def_lang"] == "en"


async def test_an_unchanged_value_writes_nothing_and_costs_nothing(app, client, tmp_path, monkeypatch):
    h = await register(app, client, tmp_path)
    monkeypatch.setattr(store, "SETTINGS_DAILY_MAX", 1)
    for _ in range(3):
        assert (await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "both"})).status_code == 200
    assert await pref_rows(app) == []
    assert (await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "en"})).status_code == 200
    assert (await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "zh"})).status_code == 429
    assert [r[2] for r in await pref_rows(app)] == ["en"]


async def test_change_history_is_events_with_an_empty_book_id_and_the_latest_wins(app, client, tmp_path):
    h = await register(app, client, tmp_path)
    for value in ("en", "zh", "en"):
        await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": value})
    rows = await pref_rows(app)
    assert [(r[1], r[2]) for r in rows] == [("", "en"), ("", "zh"), ("", "en")]
    assert (await config(client, h))["def_lang"] == "en"


async def test_the_preference_rows_do_not_touch_plans_rank_or_the_admin_book_counts(app, client, tmp_path):
    h = await register(app, client, tmp_path)
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "en"})
    plan = (await client.get(f"{URL}/today", headers=h)).json()["plan"]
    assert plan["new_done"] == 0 and plan["review_done"] == 0 and plan["goal_met"] is False
    async with app.state.sessionmaker() as s:
        by_book = (await s.execute(select(WordbookEvent.book_id, func.count()).group_by(WordbookEvent.book_id))).all()
    assert [tuple(r) for r in by_book] == [("", 1)]  # nothing is attributed to "junior"


async def test_no_user_content_in_logs(app, client, tmp_path, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    h = await register(app, client, tmp_path)
    await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "en"})
    await config(client, h)
    assert "def_lang" not in caplog.text and "alice" not in caplog.text


async def test_patching_requires_the_wordbook_switch_and_a_login(app, client, tmp_path):
    h = await register(app, client, tmp_path, wordbook_enabled=False)
    assert (await client.patch(f"{URL}/enrollment", headers=h, json={"def_lang": "en"})).status_code == 404
    assert (await client.patch(f"{URL}/enrollment", json={"def_lang": "en"})).status_code == 401
