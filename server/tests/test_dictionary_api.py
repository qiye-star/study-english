"""POST /api/dictionary/lookup (spec 2026-10-13-defs-default-lookup-ios §3.2): auth, shapes, limits, rate limit,
no word in the URL, nothing logged, nothing stored."""
import logging

import pytest
from sqlalchemy import func, select

from app.models import VocabularyItem, WordbookEvent
from app.wordbook.forms import FILE_NAME
from tests.test_admin_routes_guarded import api_routes
from tests.wordbook_helpers import enable_wordbook, make_data_dir, make_defs_dir

URL = "/api/dictionary/lookup"
FORMS = b"children\tchild\nwent\tgo\n"


def use_data(app, tmp_path) -> None:
    """Point the app at the mini book + English definitions + forms. The wordbook switch stays OFF on purpose."""
    data = make_data_dir(tmp_path)
    (make_defs_dir(tmp_path) / FILE_NAME).write_bytes(FORMS)
    app.state.settings = app.state.settings.model_copy(update={"wordbook_data_dir": str(data)})
    for name in ("wordbook_dict", "dict_lookup"):
        if hasattr(app.state, name):
            delattr(app.state, name)


async def login(client, name="alice") -> dict:
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def ask(client, h, text, **extra):
    return await client.post(URL, headers=h, json={"text": text, **extra})


async def test_needs_a_login(app, client, tmp_path):
    use_data(app, tmp_path)
    assert (await client.post(URL, json={"text": "talk"})).status_code == 401
    assert (await client.post(URL, json={"text": "talk"}, headers={"Authorization": "Bearer nope"})).status_code == 401


async def test_a_hit_has_the_documented_shape_and_works_with_the_wordbook_switched_off(app, client, tmp_path):
    use_data(app, tmp_path)
    assert app.state.settings.wordbook_enabled is False
    h = await login(client)
    r = await ask(client, h, "Talk!")
    assert r.status_code == 200
    body = r.json()
    assert list(body) == ["hit", "word", "phonetic", "defs_zh", "defs_en", "phrases", "source", "def_lang"]
    assert body["hit"] is True and body["word"] == "talk" and body["source"] == "dict"
    assert body["def_lang"] in ("both", "zh", "en")
    assert body["defs_zh"][0] == {"pos": "v", "text": "说话；谈话"} and body["defs_en"][0] == {"pos": "v", "text": "speak to someone"}
    assert body["phrases"] == [{"en": "talk about", "zh": "谈论某事"}]


async def test_an_inflected_form_and_a_phrase(app, client, tmp_path):
    use_data(app, tmp_path)
    h = await login(client)
    went = (await ask(client, h, "went")).json()
    assert went["word"] == "went" and went["lemma"] == "go" and went["defs_zh"][0]["text"] == "去；走"
    phrase = (await ask(client, h, "be able to")).json()
    assert phrase["defs_zh"] == [{"pos": "", "text": "能够"}] and phrase["defs_en"] == [] and "phrases" not in phrase


@pytest.mark.parametrize("text", ["zebra", "a b c d", "x" * 41, "谈话", "...", "x" * 1000])
async def test_a_miss_is_exactly_hit_false(app, client, tmp_path, text):
    use_data(app, tmp_path)
    r = await ask(client, await login(client), text)
    assert r.status_code == 200 and r.json() == {"hit": False}


async def test_the_answer_follows_the_users_def_lang(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    (make_defs_dir(tmp_path) / FILE_NAME).write_bytes(FORMS)
    h = await login(client)
    assert (await client.patch("/api/wordbook/enrollment", headers=h, json={"def_lang": "zh"})).status_code == 200
    assert (await ask(client, h, "talk")).json()["def_lang"] == "zh"
    other = await login(client, "bob")
    assert (await ask(client, other, "talk")).json()["def_lang"] in ("both", "en")  # bob never chose: not alice's value


@pytest.mark.parametrize("body", [{}, {"text": ""}, {"text": "x" * 1001}, {"text": 5}, {"text": "talk", "extra": 1}, {"word": "talk"}])
async def test_invalid_bodies_are_422_without_echoing_the_input(app, client, tmp_path, body):
    use_data(app, tmp_path)
    r = await client.post(URL, headers=await login(client), json=body)
    assert r.status_code == 422 and set(r.json()) == {"error"} and "x" * 50 not in r.text


async def test_get_is_not_allowed_and_the_word_is_never_a_path_or_query_parameter(app):
    seen = 0
    for path, route in api_routes(app.routes):
        if path.startswith("/api/dictionary"):
            seen += 1
            assert "{" not in path and not route.dependant.query_params and route.methods == {"POST"}, path
    assert seen == 1


async def test_it_shares_the_ai_rate_limit_bucket(app, client, tmp_path):
    use_data(app, tmp_path)
    h = await login(client)
    app.state.user_limiter.limit = 2
    assert [(await ask(client, h, "talk")).status_code for _ in range(3)] == [200, 200, 429]
    assert (await ask(client, h, "talk")).json() == {"error": "Too many requests, please try again later"}
    other = await login(client, "bob")
    assert (await ask(client, other, "talk")).status_code == 200  # per user


async def test_nothing_is_logged_and_nothing_is_stored(app, client, tmp_path, caplog):
    use_data(app, tmp_path)
    h = await login(client)
    caplog.set_level(logging.DEBUG)
    caplog.clear()
    for text in ("talk", "went", "be able to", "zebra", "a b c d", "谈话", "x" * 100):
        await ask(client, h, text)
    await client.post(URL, headers=h, json={"text": ""})
    await client.post(URL, json={"text": "talk"})
    for word in ("talk", "went", "be able to", "zebra", "谈话"):
        assert word not in caplog.text, word
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(WordbookEvent)) == 0
        assert await s.scalar(select(func.count()).select_from(VocabularyItem)) == 0


async def test_it_answers_without_any_dictionary_files(app, client, tmp_path):
    app.state.settings = app.state.settings.model_copy(update={"wordbook_data_dir": str(tmp_path / "nowhere")})
    r = await ask(client, await login(client), "talk")
    assert r.status_code == 200 and r.json() == {"hit": False}
