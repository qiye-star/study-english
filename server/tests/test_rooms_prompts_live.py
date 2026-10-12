"""G2: a published rooms.assist version is used by live room sockets (no restart). `@ai` no longer has a template of
its own (plan addressing-server A1): it is the default agent."""
from sqlalchemy.orm import Session

from app.models import PromptVersion, utcnow
from app.routers import rooms as rooms_router
from tests import test_rooms_ws as rw

ASSIST_TPL = "NEW ASSIST for {level}. <chat>{chat}</chat> <draft>{draft}</draft>"


def publish(s: Session, key: str, body: str, version: int) -> None:
    s.add(PromptVersion(key=key, version=version, status="published", body=body, note="", created_by="root",
                        published_by="root", published_at=utcnow()))


def test_published_assist_template_reaches_the_assistant(tmp_path, monkeypatch):
    seen: list[list[dict]] = []
    real = rooms_router.deps_for

    def recording_deps(app_, rt, settings):
        deps = real(app_, rt, settings)

        async def complete(messages, max_tokens, temperature):
            seen.append(messages)
            return rw.ASSIST

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
            wa.send_text('{"type":"say","client_id":"q1","text":"@ai what does break the ice mean?"}')
            assert rw.until(wa, "notice")[-1] == {"type": "notice", "code": "agent_off"}  # agents off in this app
            assert len(seen) == 1  # and nothing else called the model
    finally:
        client.__exit__(None, None, None)
