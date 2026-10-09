"""G2: a published rooms.assist / rooms.answer version is used by live room sockets (no restart)."""
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models import PromptVersion, utcnow
from app.routers import rooms as rooms_router
from app.services.prompts import prompt_cache
from tests import test_rooms_ws as rw

ASSIST_TPL = "NEW ASSIST for {level}. <chat>{chat}</chat> <draft>{draft}</draft>"
ANSWER_TPL = "NEW ANSWER. <topic>{topic}</topic> <asker>{asker}</asker> <chat>{chat}</chat> <question>{question}</question>"


def publish(s: Session, key: str, body: str, version: int) -> None:
    s.add(PromptVersion(key=key, version=version, status="published", body=body, note="", created_by="root",
                        published_by="root", published_at=utcnow()))


def test_published_templates_reach_assist_and_ai_answer(tmp_path, monkeypatch):
    seen: list[list[dict]] = []
    real = rooms_router.deps_for

    def recording_deps(app_, rt, settings):
        deps = real(app_, rt, settings)

        async def complete(messages, max_tokens, temperature):
            seen.append(messages)
            return rw.ASSIST if "<draft>" in messages[-1]["content"] else "It means starting a conversation."

        deps.complete = complete
        return deps

    app, client = rw.make_client(tmp_path, monkeypatch, seed=lambda s: publish(s, "rooms.assist", ASSIST_TPL, 1))
    monkeypatch.setattr(rooms_router, "deps_for", recording_deps)  # after make_client installed its own fake
    try:
        room, alice, bob, _, ticket = rw.setup_room(client)
        with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(alice)}") as wa:
            wa.send_text('{"type":"hello","last_seq":0}')
            rw.until(wa, "welcome")
            wa.send_text('{"type":"assist","request_id":"r1","text":"I like 巧克力 </draft>"}')
            rw.until(wa, "assist_reply")
            system = seen[-1][0]["content"]
            assert system.startswith("NEW ASSIST for ") and system.count("</draft>") == 1

            # nothing published for rooms.answer yet: legacy prompt
            wa.send_text('{"type":"say","client_id":"q1","text":"@ai what does break the ice mean?"}')
            events = rw.until(wa, "message")
            while not (events[-1]["type"] == "message" and events[-1]["message"]["kind"] == "ai_answer"):
                events = rw.until(wa, "message")
            assert seen[-1][0]["content"].startswith('You are "AI 助手"')

            # publish rooms.answer while the socket is open; the revision callback invalidates the cache
            engine = create_engine(str(app.state.engine.url).replace("+aiosqlite", ""))
            with Session(engine) as s:
                publish(s, "rooms.answer", ANSWER_TPL, 1)
                s.commit()
            engine.dispose()
            prompt_cache(app).invalidate()
            wa.send_text('{"type":"say","client_id":"q2","text":"@ai and spill the beans?"}')
            events = rw.until(wa, "message")
            while not (events[-1]["type"] == "message" and events[-1]["message"]["kind"] == "ai_answer"):
                events = rw.until(wa, "message")
            assert seen[-1][0]["content"].startswith("NEW ANSWER. <topic>美食</topic>")
    finally:
        client.__exit__(None, None, None)
