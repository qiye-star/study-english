"""词汇激活的隐私清单(plan L4 Task 11 / R2):路由表、日志、总线错误里没有词、文字、用户 id。"""
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.activation import backfill, purge
from app.core.learning_events import MessageSent
from app.models import VocabularyItem

AT = datetime(2026, 10, 21, 9, 0, tzinfo=timezone.utc)
SECRET_WORD = "zygomorphic"
SECRET_TEXT = "my zygomorphic secret sentence"
ALLOWED_QUERY = {"state", "page", "offset"}


def enable(app, on: bool = True) -> None:
    app.state.settings = app.state.settings.model_copy(update={"activation_enabled": on})


async def test_activation_routes_have_no_path_parameters_and_only_the_allowed_query_names(app):
    schema = app.openapi()["paths"]  # every included API route, with its parameters
    mine = {path: op for path, ops in schema.items() if path.startswith("/api/activation") for op in ops.values()}
    assert set(schema) >= {"/api/activation/config", "/api/activation/words", "/api/activation/prompt-hint"}
    assert {p for p in schema if p.startswith("/api/activation")} == {
        "/api/activation/config", "/api/activation/words", "/api/activation/prompt-hint"}
    for path, op in mine.items():
        params = op.get("parameters", [])
        assert not [p for p in params if p["in"] == "path"], path
        assert {p["name"] for p in params if p["in"] == "query"} <= ALLOWED_QUERY, path


async def test_no_activation_log_carries_words_text_or_user_ids(app, client, auth_headers, caplog, monkeypatch):
    caplog.set_level(logging.DEBUG)
    enable(app)
    from tests.links_helpers import user_id_of

    uid = await user_id_of(client, auth_headers)
    async with app.state.sessionmaker() as s:
        s.add(VocabularyItem(user_id=uid, word=SECRET_WORD, source="wordbook:junior", box=3, due_at=AT, created_at=AT))
        s.add(VocabularyItem(user_id=uid, word="talk", source="wordbook:junior", box=0, due_at=AT, created_at=AT))
        await s.commit()
    app.state.learning_bus.publish(MessageSent(user_id=uid, conversation_id="c1", message_id="m1", text=SECRET_TEXT,
                                               at=AT))
    app.state.learning_bus.publish(MessageSent(user_id=uid, conversation_id="c1", message_id="m2",
                                               text="we talked", at=AT))
    await app.state.learning_bus.drain()
    for path in ("/api/activation/config", "/api/activation/words?state=dormant",
                 "/api/activation/words?state=active", "/api/activation/prompt-hint?offset=0"):
        assert (await client.get(path, headers=auth_headers)).status_code == 200
    assert await purge.run_once(app) >= 0
    await backfill.run(app.state.sessionmaker, lemma_of=lambda _f: None)

    app_records = [f"{r.name} {r.getMessage()}" for r in caplog.records if r.name.startswith("app")]
    text = "\n".join(app_records)
    assert SECRET_WORD not in text and "secret" not in text and "we talked" not in text
    ours = [line for line in app_records if "activation" in line or "learning_events" in line]
    assert all(str(uid) not in line for line in ours), "a user id reached an activation log"


async def test_bus_error_records_carry_only_the_exception_class(app, client, auth_headers, monkeypatch):
    enable(app)
    from tests.links_helpers import user_id_of
    from app.activation import usage

    uid = await user_id_of(client, auth_headers)
    async with app.state.sessionmaker() as s:
        s.add(VocabularyItem(user_id=uid, word="talk", source="wordbook:junior", box=0, due_at=AT, created_at=AT))
        await s.commit()

    async def broken(app_, user_id, lemmas, **kwargs):
        raise ValueError(f"leaked {SECRET_WORD}")
    monkeypatch.setattr(usage, "_record_active", broken)
    app.state.learning_bus.publish(MessageSent(user_id=uid, conversation_id="c9", message_id="m9", text="we talked",
                                               at=AT))
    await app.state.learning_bus.drain()
    errors = app.state.learning_bus.recent_errors()
    assert errors and {e["error"] for e in errors} == {"ValueError"}
    assert SECRET_WORD not in repr(errors) and "leaked" not in repr(errors)
    assert all(set(e) == {"at", "link", "event", "error"} for e in errors)
