import json
from datetime import datetime, timezone

from app.core import metering
from app.models import RoomMessage
from app.routers import rooms as rooms_router
from tests import test_rooms_ws as rw


def test_room_level_and_scenario_reach_prompts_and_metering(tmp_path, monkeypatch):
    seen, meters = [], []
    app, client = rw.make_client(tmp_path, monkeypatch)
    real = rw.REAL_DEPS_FOR

    def deps(app_, rt, settings):
        d = real(app_, rt, settings)

        async def complete(messages, max_tokens, temperature):
            seen.append(messages)
            meters.append((metering.current_user_id(), metering.current_feature()))
            return rw.ASSIST if "<draft>" in messages[-1]["content"] else "Answer."

        d.complete = complete
        return d

    monkeypatch.setattr(rooms_router, "deps_for", deps)
    try:
        alice, alice_id = rw.login(client, "alice")
        room = client.post("/api/rooms", json={"name": "Latte club", "scenario": "cafe", "level": "B2"},
                           headers=alice).json()["room"]
        ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=alice).json()["ticket"]
        with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as ws:
            ws.send_text('{"type":"hello","last_seq":0,"v":2}')
            rw.until(ws, "welcome")
            ws.send_text(json.dumps({"type": "assist", "request_id": "r1", "text": "我要一杯拿铁"}))
            rw.until(ws, "assist_reply")
            text = seen[-1][0]["content"] + seen[-1][-1]["content"]
            assert "level B2" in text and "coffee shop" in text
            ws.send_text(json.dumps({"type": "say", "client_id": "q", "text": "@ai what is a latte?"}))
            while True:
                events = rw.until(ws, "message")
                if events[-1]["message"]["kind"] == "ai_answer":
                    break
            prompt = seen[-1][0]["content"] + seen[-1][-1]["content"]
            assert "CEFR level B2" in prompt and "coffee shop" in prompt and "Latte club" in prompt
        assert meters == [(alice_id, "rooms"), (alice_id, "rooms")]
    finally:
        client.__exit__(None, None, None)


def test_transcribed_voice_joins_the_ai_context(tmp_path, monkeypatch):
    app, client = rw.make_client(tmp_path, monkeypatch)
    try:
        alice, alice_id = rw.login(client, "alice")
        room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        rt = rooms_router.runtime(app)
        now = datetime.now(timezone.utc)

        async def seed():
            for kind, text in (("voice", "I tried the noodles."), ("voice", ""), ("text", "Nice!"),
                               ("system", "joined")):
                await rt.store.append(room["id"], lane="public", sender_kind="system" if kind == "system" else "user",
                                      sender_id=None if kind == "system" else alice_id, kind=kind, text=text, now=now)
            hidden = await rt.store.append(room["id"], lane="public", sender_kind="user", sender_id=alice_id,
                                           kind="voice", text="hidden words", now=now)
            async with app.state.sessionmaker() as s:
                (await s.get(RoomMessage, hidden.id)).hidden_at = now
                await s.commit()
            return await rt.store.recent_public(room["id"], 10)

        assert client.portal.call(seed) == [("alice", "(voice) I tried the noodles."), ("alice", "Nice!")]
    finally:
        client.__exit__(None, None, None)
