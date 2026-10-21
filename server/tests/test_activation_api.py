"""词汇激活接口的开关行为(plan L4 Task 4):关 = /api/activation/* 除 config 外 404;config 永远 200。"""


def enable(app, on: bool) -> None:
    app.state.settings = app.state.settings.model_copy(update={"activation_enabled": on})


async def test_config_is_200_either_way_and_says_whether_it_is_on(app, client, auth_headers):
    r = await client.get("/api/activation/config", headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"enabled": False}
    enable(app, True)
    r = await client.get("/api/activation/config", headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"enabled": True}


async def test_words_is_404_while_the_switch_is_off(client, auth_headers):
    r = await client.get("/api/activation/words?state=dormant", headers=auth_headers)
    assert r.status_code == 404
    assert r.json() == {"error": "Activation is off"}


async def test_words_answers_when_the_switch_is_on(app, client, auth_headers):
    enable(app, True)
    r = await client.get("/api/activation/words?state=dormant", headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["items"] == []  # nothing learned yet: the dormant list is empty


# ---- L4 Task 11: dormant / sprouting / active lists and the prompt hint (R8, R18) ----

from datetime import datetime, timedelta, timezone  # noqa: E402

from app.models import User, VocabularyItem, WordUsage  # noqa: E402
from tests.links_helpers import check_contract, user_id_of  # noqa: E402

NOW = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)


def ago(days: float) -> datetime:
    return NOW - timedelta(days=days)


async def seed_words(app, uid: int, rows: list[dict], usage: dict[str, dict] | None = None) -> None:
    async with app.state.sessionmaker() as s:
        for row in rows:
            s.add(VocabularyItem(user_id=uid, word=row["word"], source=row.get("source", "wordbook:junior"),
                                 box=row.get("box", 0), due_at=NOW, created_at=row["learned"]))
        for lemma, u in (usage or {}).items():
            s.add(WordUsage(user_id=uid, lemma=lemma, first_used_at=u["last"], last_used_at=u["last"],
                            use_count=u["uses"], shadow_count=0, session_count=u["sessions"], last_session="a" * 16,
                            sources="chat"))
        await s.commit()


async def test_lists_follow_the_three_states_and_the_counts(app, client, auth_headers, monkeypatch):
    enable(app, True)
    monkeypatch.setattr("app.routers.activation.utcnow", lambda: NOW)
    uid = await user_id_of(client, auth_headers)
    await seed_words(app, uid, [
        {"word": "dormantold", "learned": ago(40)},
        {"word": "dormantbox", "learned": ago(10), "box": 3},
        {"word": "sprout", "learned": ago(10)},
        {"word": "active", "learned": ago(10)},
        {"word": "fresh", "learned": ago(1)},
    ], usage={"sprout": {"last": ago(2), "uses": 1, "sessions": 1},
              "active": {"last": ago(1), "uses": 3, "sessions": 2}})
    body = (await client.get("/api/activation/words?state=dormant", headers=auth_headers)).json()
    assert body["state"] == "dormant" and body["counts"] == {"dormant": 2, "sprouting": 1, "active": 1}
    assert [w["word"] for w in body["items"]] == ["dormantbox", "dormantold"]  # box first, then learned time
    assert body["items"][0]["use_count"] == 0 and body["items"][0]["last_used_at"] is None
    assert body["next_page"] is None
    sprouting = (await client.get("/api/activation/words?state=sprouting", headers=auth_headers)).json()
    assert [w["word"] for w in sprouting["items"]] == ["sprout"] and sprouting["items"][0]["use_count"] == 1
    active = (await client.get("/api/activation/words?state=active", headers=auth_headers)).json()
    assert [w["word"] for w in active["items"]] == ["active"]
    assert (await client.get("/api/activation/words?state=fresh", headers=auth_headers)).status_code == 422


async def test_another_users_words_never_show_up(app, client, auth_headers, monkeypatch):
    enable(app, True)
    monkeypatch.setattr("app.routers.activation.utcnow", lambda: NOW)
    async with app.state.sessionmaker() as s:
        s.add(User(id=66666666, username="other", password_hash="x"))
        await s.commit()
    await seed_words(app, 66666666, [{"word": "theirs", "learned": ago(40)}])
    body = (await client.get("/api/activation/words?state=dormant", headers=auth_headers)).json()
    assert body["items"] == [] and body["counts"]["dormant"] == 0


async def test_the_dormant_list_pages_fifty_at_a_time(app, client, auth_headers, monkeypatch):
    enable(app, True)
    monkeypatch.setattr("app.routers.activation.utcnow", lambda: NOW)
    uid = await user_id_of(client, auth_headers)
    await seed_words(app, uid, [{"word": f"word{chr(97 + i // 26)}{chr(97 + i % 26)}", "learned": ago(40)}
                                for i in range(52)])
    first = (await client.get("/api/activation/words?state=dormant&page=0", headers=auth_headers)).json()
    second = (await client.get("/api/activation/words?state=dormant&page=1", headers=auth_headers)).json()
    assert len(first["items"]) == 50 and first["next_page"] == 1
    assert len(second["items"]) == 2 and second["next_page"] is None
    words = [w["word"] for w in first["items"] + second["items"]]
    assert len(set(words)) == 52


async def test_the_prompt_hint_picks_dormant_words_with_box_two_or_more(app, client, auth_headers, monkeypatch):
    enable(app, True)
    monkeypatch.setattr("app.routers.activation.utcnow", lambda: NOW)
    uid = await user_id_of(client, auth_headers)
    await seed_words(app, uid, [
        {"word": "lowbox", "learned": ago(40), "box": 1},
        {"word": "midbox", "learned": ago(40), "box": 2},
        {"word": "highbox", "learned": ago(40), "box": 4},
    ])
    hint = (await client.get("/api/activation/prompt-hint?offset=0", headers=auth_headers)).json()
    assert sorted(hint["words"]) == ["highbox", "midbox"]
    assert hint["block"] and len(hint["block"]) <= 300 and "highbox" in hint["block"]
    again = (await client.get("/api/activation/prompt-hint?offset=0", headers=auth_headers)).json()
    assert again == hint  # the same user on the same local day gets the same words


async def test_the_prompt_hint_is_empty_when_nothing_qualifies(app, client, auth_headers, monkeypatch):
    enable(app, True)
    monkeypatch.setattr("app.routers.activation.utcnow", lambda: NOW)
    assert (await client.get("/api/activation/prompt-hint?offset=0", headers=auth_headers)).json() == {
        "words": [], "block": None}


async def test_the_activation_contract_is_pinned(app, client, auth_headers, monkeypatch):
    enable(app, True)
    monkeypatch.setattr("app.routers.activation.utcnow", lambda: NOW)
    uid = await user_id_of(client, auth_headers)
    await seed_words(app, uid, [
        {"word": "talk", "learned": ago(40), "box": 2},
        {"word": "walk", "learned": ago(12)},
    ], usage={"walk": {"last": ago(1), "uses": 2, "sessions": 2}})
    actual = {
        "config": (await client.get("/api/activation/config", headers=auth_headers)).json(),
        "words_dormant": (await client.get("/api/activation/words?state=dormant", headers=auth_headers)).json(),
        "words_active": (await client.get("/api/activation/words?state=active", headers=auth_headers)).json(),
        "prompt_hint": (await client.get("/api/activation/prompt-hint?offset=0", headers=auth_headers)).json(),
    }
    check_contract("activation_contract", actual)
