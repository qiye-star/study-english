import uuid

import pytest

from app.models import VocabularyItem, utcnow


async def register(client):
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    return int(r.json()["id"]), {"Authorization": f"Bearer {r.json()['access_token']}"}


async def seed(app, user_id, n_wordbook=3):
    async with app.state.sessionmaker() as s:
        for i in range(n_wordbook):
            s.add(VocabularyItem(id=str(uuid.uuid4()), user_id=user_id, word=f"w{i}", meaning="", example=None,
                                 source="wordbook:cet4", box=0, due_at=utcnow(), reps=0, lapses=0, created_at=utcnow()))
        await s.commit()


async def test_scope_filters_wordbook_rows_and_due_count(client, app):
    uid, h = await register(client)
    await client.post("/api/vocabulary", headers=h, json={"word": "mine", "source": "manual"})
    await seed(app, uid)
    mine = (await client.get("/api/vocabulary", headers=h)).json()
    every = (await client.get("/api/vocabulary?scope=all", headers=h)).json()
    assert [i["word"] for i in mine["vocabulary_items"]] == ["mine"] and mine["due_count"] == 1
    assert len(every["vocabulary_items"]) == 4 and every["due_count"] == 4
    due_mine = (await client.get("/api/vocabulary?due=true", headers=h)).json()
    assert [i["word"] for i in due_mine["vocabulary_items"]] == ["mine"]
    assert (await client.get("/api/vocabulary?scope=bogus", headers=h)).status_code == 422


async def test_adding_a_word_the_wordbook_has_adopts_it_into_the_notebook(client, app):
    """Review M2: POST /api/vocabulary for a wordbook word must show up in the default (mine) list."""
    uid, h = await register(client)
    await seed(app, uid, n_wordbook=1)
    async with app.state.sessionmaker() as s:
        from sqlalchemy import update
        await s.execute(update(VocabularyItem).values(box=3, reps=4))
        await s.commit()
    r = await client.post("/api/vocabulary", headers=h,
                          json={"word": "W0", "meaning": "my meaning", "example": "An example.", "source": "lookup"})
    assert r.status_code == 200
    body = r.json()
    assert (body["word"], body["source"], body["box"], body["reps"]) == ("w0", "lookup", 3, 4)  # progress kept
    assert (body["meaning"], body["example"]) == ("my meaning", "An example.")
    mine = (await client.get("/api/vocabulary", headers=h)).json()["vocabulary_items"]
    assert [i["id"] for i in mine] == [body["id"]]
    every = (await client.get("/api/vocabulary?scope=all", headers=h)).json()["vocabulary_items"]
    assert len(every) == 1  # adopted, not duplicated
    again = (await client.post("/api/vocabulary", headers=h, json={"word": "w0", "meaning": "other"})).json()
    assert (again["id"], again["meaning"], again["source"]) == (body["id"], "my meaning", "lookup")  # unchanged


async def test_adopting_keeps_the_wordbook_meaning_when_none_is_given(client, app):
    uid, h = await register(client)
    await seed(app, uid, n_wordbook=1)
    async with app.state.sessionmaker() as s:
        from sqlalchemy import update
        await s.execute(update(VocabularyItem).values(meaning="v. 说话", example="We talk."))
        await s.commit()
    body = (await client.post("/api/vocabulary", headers=h, json={"word": "w0", "source": "manual"})).json()
    assert (body["source"], body["meaning"], body["example"]) == ("manual", "v. 说话", "We talk.")


@pytest.mark.parametrize("settings_overrides", [{"max_vocab_items": 1}], indirect=True)
async def test_adopting_a_wordbook_word_respects_the_limit(client, app):
    uid, h = await register(client)
    await seed(app, uid, n_wordbook=2)
    assert (await client.post("/api/vocabulary", headers=h, json={"word": "w0"})).json()["source"] == "manual"
    r = await client.post("/api/vocabulary", headers=h, json={"word": "w1"})
    assert r.status_code == 429 and r.json() == {"error": "Vocabulary limit reached"}
    every = (await client.get("/api/vocabulary?scope=all", headers=h)).json()["vocabulary_items"]
    assert {i["word"]: i["source"] for i in every}["w1"] == "wordbook:cet4"


@pytest.mark.parametrize("settings_overrides", [{"max_vocab_items": 1}], indirect=True)
async def test_wordbook_rows_do_not_count_toward_the_limit(client, app):
    uid, h = await register(client)
    await seed(app, uid, n_wordbook=5)
    assert (await client.post("/api/vocabulary", headers=h, json={"word": "one"})).status_code == 200
    r = await client.post("/api/vocabulary", headers=h, json={"word": "two"})
    assert r.status_code == 429 and r.json() == {"error": "Vocabulary limit reached"}
