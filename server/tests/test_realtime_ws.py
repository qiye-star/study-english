import asyncio
import json
import logging
import time

import anyio
import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect, WebSocketState

from app.speech.asr import AsrError
from app.core.db import Base
from app.main import create_app
from app.speech.realtime_asr import effective_realtime_asr
from app.realtime_protocol import StartMsg
from app import realtime_session
from app.realtime_session import RealtimeSession, Upstreams
from app.realtime_tickets import TicketStore
from app.routers import realtime as realtime_router
from tests.conftest import make_settings
from tests.test_realtime_session import Factory, FakeRecognizer, SlowAssessor, llm_of, tts_of

ENABLED = {
    "realtime_enabled": True,
    "volcengine_tts_key": "volc-secret",
    "tts_models": "openai/tts-1,azure/speech,volcengine/seed-tts-2.0",
}
START = {"type": "start", "voice": "en_female_dacey_uranus_bigtts", "system_prompt": "Be brief."}
PCM = b"\x01\x00" * 1600
REAL_BUILD_UPSTREAMS = getattr(realtime_router, "build_upstreams", None)  # captured before tests monkeypatch it


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def fake_upstreams(llm=None, recognizer=None, assessor=None):
    def build(app, settings, user_id, start):
        return Upstreams(Factory(recognizer() if recognizer else FakeRecognizer("hello there")), None, "buffered",
                         llm or llm_of("Sure. ", "Bye."), tts_of(), assessor)
    return build


def make_ws_app(tmp_path, monkeypatch, **overrides):
    settings = make_settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'rt.db'}", **{**ENABLED, **overrides})
    app = create_app(settings)
    monkeypatch.setattr(realtime_router, "build_upstreams", fake_upstreams())
    return app


def _start(app):
    client = TestClient(app)
    client.__enter__()

    async def create_all():
        async with app.state.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    client.portal.call(create_all)
    return client


@pytest.fixture
def ws_app(tmp_path, monkeypatch):
    app = make_ws_app(tmp_path, monkeypatch)
    client = _start(app)
    try:
        yield app, client
    finally:
        client.__exit__(None, None, None)


@pytest.fixture
def ws_factory(tmp_path, monkeypatch):
    """Like ws_app, but with settings overrides."""
    clients = []

    def make(**overrides):
        app = make_ws_app(tmp_path, monkeypatch, **overrides)
        client = _start(app)
        clients.append(client)
        return app, client

    yield make
    for client in clients:
        client.__exit__(None, None, None)


def login(client, name="alice"):
    token = client.post("/api/users", json={"username": name, "password": "password123"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def ticket_for(client, headers):
    cid = client.post("/api/conversations", json={"name": "c", "config": {}}, headers=headers).json()["id"]
    return cid, client.post("/api/realtime/ticket", json={"conversation_id": cid}, headers=headers).json()["ticket"]


def receive_until(ws, kind):
    events = []
    while True:
        message = ws.receive()
        if message["type"] == "websocket.close":
            raise AssertionError(f"closed {message.get('code')} before {kind}: {events}")
        if message.get("text"):
            events.append(json.loads(message["text"]))
        elif message.get("bytes"):
            events.append({"type": "_audio", "size": len(message["bytes"])})
        if events and events[-1]["type"] == kind:
            return events


def until_close(ws):
    """Collect events until the server closes; returns (events, close code)."""
    events = []
    while True:
        message = ws.receive()
        if message["type"] == "websocket.close":
            return events, message.get("code", 1000)
        if message.get("text"):
            events.append(json.loads(message["text"]))
        elif message.get("bytes"):
            events.append({"type": "_audio", "size": len(message["bytes"])})


def wait_for(predicate, timeout=3.0):
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError("condition not reached")
        time.sleep(0.01)


def session_tasks(client):
    async def collect():
        return [t for t in asyncio.all_tasks() if "RealtimeSession" in repr(t.get_coro())]
    return client.portal.call(collect)


# ---------------------------------------------------------------- happy path


def test_full_call_saves_messages(ws_app):
    app, client = ws_app
    headers = login(client)
    cid, ticket = ticket_for(client, headers)
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        assert receive_until(ws, "ready")[-1] == {"type": "ready", "asr": "buffered"}
        ws.send_bytes(PCM)
        ws.send_text(json.dumps({"type": "utterance_end"}))
        events = receive_until(ws, "reply_done")
        assert any(e["type"] == "_audio" for e in events)
        ws.send_text(json.dumps({"type": "hangup"}))
        assert until_close(ws)[1] == 1000  # a trailing state=listening may precede the close
    messages = client.get(f"/api/conversations/{cid}/messages", headers=headers).json()["messages"]
    assert [m["content"] for m in messages] == ["hello there", "Sure. Bye."]
    assert app.state.realtime_registry.active_count == 0


def test_call_end_logs_numbers_only_and_never_the_ticket(ws_app, caplog):
    _, client = ws_app
    headers = login(client)
    _, ticket = ticket_for(client, headers)
    caplog.set_level(logging.DEBUG)
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        receive_until(ws, "ready")
        ws.send_bytes(PCM)
        ws.send_text(json.dumps({"type": "utterance_end"}))
        receive_until(ws, "reply_done")
        ws.send_text(json.dumps({"type": "hangup"}))
        until_close(ws)
    wait_for(lambda: any("event=realtime_call" in r.getMessage() for r in caplog.records))
    line = next(r.getMessage() for r in caplog.records if "event=realtime_call" in r.getMessage())
    assert "close=1000" in line and "turns=1" in line and "interrupts=0" in line and "seconds=" in line
    text = "\n".join(r.getMessage() for r in caplog.records if not r.name.startswith("aiosqlite"))
    assert ticket not in text
    for secret in ("hello there", "Sure.", "Be brief."):
        assert secret not in text


def test_ready_reports_the_mode_the_recognizers_use(ws_factory):
    app, client = ws_factory()
    settings = app.state.settings
    upstreams = REAL_BUILD_UPSTREAMS(app, settings, 1, StartMsg(type="start", voice="en_female_dacey_uranus_bigtts"))
    headers = login(client)
    config = client.get("/api/realtime/config", headers=headers).json()
    assert upstreams.asr_mode == effective_realtime_asr(settings) == config["asr_mode"]


def test_each_turn_consumes_the_user_ai_quota(ws_factory):
    # ticket issuance spends one unit (limited_user), the first turn the second, the next turn is refused
    _, client = ws_factory(ai_rate_limit_per_minute=2)
    _, ticket = ticket_for(client, login(client))
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        receive_until(ws, "ready")
        ws.send_bytes(PCM)
        ws.send_text(json.dumps({"type": "utterance_end"}))
        receive_until(ws, "reply_done")
        ws.send_bytes(PCM)
        ws.send_text(json.dumps({"type": "utterance_end"}))
        events = receive_until(ws, "error")
        assert events[-1] == {"type": "error", "code": "rate_limited"}
        ws.send_text(json.dumps({"type": "hangup"}))
        assert until_close(ws)[1] == 1000


# ---------------------------------------------------------------- tickets / gate order


@pytest.mark.parametrize("query", ["", "?ticket=", "?ticket=forged"])
def test_bad_ticket_closes_4001(ws_app, query):
    _, client = ws_app
    with client.websocket_connect(f"/api/realtime{query}") as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_text()
    assert closed.value.code == 4001


def test_expired_ticket_closes_4001(ws_app):
    app, client = ws_app
    clock = FakeClock()
    app.state.realtime_tickets = TicketStore(60, clock=clock)
    _, ticket = ticket_for(client, login(client))
    clock.now += 61
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        assert until_close(ws)[1] == 4001
    assert app.state.realtime_registry.active_count == 0


def test_ticket_is_single_use(ws_app):
    _, client = ws_app
    _, ticket = ticket_for(client, login(client))
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps({"type": "hangup"}))  # not a start: protocol error
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_text()
        assert closed.value.code == 4400
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_text()
        assert closed.value.code == 4001


def test_second_concurrent_call_is_busy(ws_app):
    app, client = ws_app
    headers = login(client)
    _, first = ticket_for(client, headers)
    _, second = ticket_for(client, headers)
    with client.websocket_connect(f"/api/realtime?ticket={first}") as ws1:
        ws1.send_text(json.dumps(START))
        receive_until(ws1, "ready")
        with client.websocket_connect(f"/api/realtime?ticket={second}") as ws2:
            with pytest.raises(WebSocketDisconnect) as closed:
                ws2.receive_text()
            assert closed.value.code == 4029
        assert app.state.realtime_registry.active_count == 1  # the refused call freed nothing
        ws1.send_bytes(PCM)  # the first call is unaffected
        ws1.send_text(json.dumps({"type": "utterance_end"}))
        receive_until(ws1, "reply_done")
        ws1.send_text(json.dumps({"type": "hangup"}))
        assert until_close(ws1)[1] == 1000
    assert app.state.realtime_registry.active_count == 0


def test_global_limit_is_busy_for_another_user(ws_factory):
    app, client = ws_factory(realtime_max_sessions=1)
    _, first = ticket_for(client, login(client, "alice"))
    _, second = ticket_for(client, login(client, "bob"))
    with client.websocket_connect(f"/api/realtime?ticket={first}") as ws1:
        ws1.send_text(json.dumps(START))
        receive_until(ws1, "ready")
        with client.websocket_connect(f"/api/realtime?ticket={second}") as ws2:
            assert until_close(ws2)[1] == 4029
        ws1.send_text(json.dumps({"type": "hangup"}))
        assert until_close(ws1)[1] == 1000
    assert app.state.realtime_registry.active_count == 0


def test_deleted_conversation_closes_4004(ws_app):
    app, client = ws_app
    headers = login(client)
    cid, ticket = ticket_for(client, headers)
    client.delete(f"/api/conversations/{cid}", headers=headers)
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_text()
    assert closed.value.code == 4004
    assert app.state.realtime_registry.active_count == 0


def test_disabled_closes_4003(tmp_path):
    app = create_app(make_settings(database_url=f"sqlite+aiosqlite:///{tmp_path / 'x.db'}"))
    with TestClient(app) as client:
        with client.websocket_connect("/api/realtime?ticket=x") as ws:
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_text()
    assert closed.value.code == 4003


def test_disabled_is_checked_before_the_ticket_and_does_not_spend_it(ws_app):
    app, client = ws_app
    _, ticket = ticket_for(client, login(client))
    app.state.settings = app.state.settings.model_copy(update={"realtime_enabled": False})
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        assert until_close(ws)[1] == 4003
    assert len(app.state.realtime_tickets) == 1


def test_no_recognizer_closes_4502(ws_app, monkeypatch):
    app, client = ws_app

    def broken(app, settings, user_id, start):
        raise AsrError("config")

    monkeypatch.setattr(realtime_router, "build_upstreams", broken)
    _, ticket = ticket_for(client, login(client))
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        assert until_close(ws)[1] == 4502
    assert app.state.realtime_registry.active_count == 0


# ---------------------------------------------------------------- start message


def test_start_timeout_closes_4400(ws_app, monkeypatch):
    app, client = ws_app
    monkeypatch.setattr(realtime_router, "START_TIMEOUT", 0.2)
    _, ticket = ticket_for(client, login(client))
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        assert until_close(ws) == ([], 4400)
    wait_for(lambda: app.state.realtime_registry.active_count == 0)


@pytest.mark.parametrize("first", [b"\x00\x00", "not json", json.dumps({"type": "start"}),
                                   json.dumps({**START, "extra": 1})], ids=["bytes", "text", "no-voice", "extra"])
def test_bad_start_closes_4400(ws_app, first):
    app, client = ws_app
    _, ticket = ticket_for(client, login(client))
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        if isinstance(first, bytes):
            ws.send_bytes(first)
        else:
            ws.send_text(first)
        assert until_close(ws)[1] == 4400
    assert app.state.realtime_registry.active_count == 0


def test_client_gone_before_start_frees_the_slot(ws_app):
    app, client = ws_app
    _, ticket = ticket_for(client, login(client))
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.close(1001)
        wait_for(lambda: app.state.realtime_registry.active_count == 0)


# ---------------------------------------------------------------- in-call limits


def test_oversized_frame_closes_4400(ws_app):
    app, client = ws_app
    _, ticket = ticket_for(client, login(client))
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        receive_until(ws, "ready")
        ws.send_bytes(b"\x00\x00" * 16001)  # 32002 bytes > MAX_UPLINK_FRAME
        assert until_close(ws)[1] == 4400
    assert app.state.realtime_registry.active_count == 0


def test_idle_closes_4008(ws_app, monkeypatch):
    app, client = ws_app
    clock = FakeClock()
    monkeypatch.setattr(realtime_router, "session_clock", clock)
    _, ticket = ticket_for(client, login(client))
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        receive_until(ws, "ready")
        clock.now += app.state.settings.realtime_idle_timeout_seconds + 1
        ws.send_text(json.dumps({"type": "interrupt"}))  # wake the loop so it re-checks the clock
        assert until_close(ws)[1] == 4008
    assert app.state.realtime_registry.active_count == 0


def test_max_duration_closes_4009(ws_app, monkeypatch):
    app, client = ws_app
    clock = FakeClock()
    monkeypatch.setattr(realtime_router, "session_clock", clock)
    _, ticket = ticket_for(client, login(client))
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        receive_until(ws, "ready")
        clock.now += app.state.settings.realtime_max_minutes * 60 + 1
        ws.send_bytes(PCM)  # audio keeps idle away; the duration cap still applies
        assert until_close(ws)[1] == 4009
    assert app.state.realtime_registry.active_count == 0


def test_message_limit_closes_4013(ws_factory):
    app, client = ws_factory(max_messages_per_conversation=1)
    headers = login(client)
    cid, ticket = ticket_for(client, headers)
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        receive_until(ws, "ready")
        ws.send_bytes(PCM)
        ws.send_text(json.dumps({"type": "utterance_end"}))
        events, code = until_close(ws)
    assert code == 4013
    assert {"type": "error", "code": "message_limit"} in events
    messages = client.get(f"/api/conversations/{cid}/messages", headers=headers).json()["messages"]
    assert [m["content"] for m in messages] == ["hello there"]
    assert app.state.realtime_registry.active_count == 0


# ---------------------------------------------------------------- every exit path frees the slot


def test_client_hangs_up_mid_reply(ws_app, monkeypatch):
    app, client = ws_app
    closed = []
    monkeypatch.setattr(realtime_router, "build_upstreams",
                        fake_upstreams(llm_of("Sure. ", "Then ", hang=True, closed=closed)))
    _, ticket = ticket_for(client, login(client))
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        receive_until(ws, "ready")
        ws.send_bytes(PCM)
        ws.send_text(json.dumps({"type": "utterance_end"}))
        receive_until(ws, "_audio")  # the first sentence is being spoken; the LLM is still streaming
        ws.close(1001)  # the client goes away without a hangup message
        wait_for(lambda: app.state.realtime_registry.active_count == 0)
        wait_for(lambda: closed == [True])  # the LLM stream was closed
        wait_for(lambda: session_tasks(client) == [])


def test_unexpected_session_error_closes_1011_and_frees_the_slot(ws_app, monkeypatch, caplog):
    app, client = ws_app

    class Exploding(RealtimeSession):
        async def run(self, receive):
            raise RuntimeError("boom: user said hello there")

    monkeypatch.setattr(realtime_router, "RealtimeSession", Exploding)
    _, ticket = ticket_for(client, login(client))
    caplog.set_level(logging.INFO)
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        assert until_close(ws)[1] == 1011
    wait_for(lambda: app.state.realtime_registry.active_count == 0)
    assert "hello there" not in "\n".join(r.getMessage() for r in caplog.records)


def test_unexpected_build_error_closes_1011_and_frees_the_slot(ws_app, monkeypatch):
    app, client = ws_app

    def broken(app, settings, user_id, start):
        raise ValueError("nope")

    monkeypatch.setattr(realtime_router, "build_upstreams", broken)
    _, ticket = ticket_for(client, login(client))
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        assert until_close(ws)[1] == 1011
    assert app.state.realtime_registry.active_count == 0


class FakeSocket:
    """Just enough of starlette's WebSocket to drive the endpoint directly."""

    def __init__(self, app):
        self.app = app
        self.inbox: asyncio.Queue = asyncio.Queue()
        self.sent: list = []
        self.closed: list[int] = []
        self.application_state = WebSocketState.CONNECTING
        self.client_state = WebSocketState.CONNECTED

    async def accept(self):
        self.application_state = WebSocketState.CONNECTED

    async def receive(self):
        return await self.inbox.get()

    async def send_json(self, data):
        self.sent.append(data)

    async def send_bytes(self, data):
        self.sent.append(len(data))

    async def close(self, code=1000, reason=None):
        self.closed.append(code)
        self.application_state = WebSocketState.DISCONNECTED


def test_cancellation_mid_reply_frees_the_slot_and_leaks_no_tasks(ws_app, monkeypatch):
    """anyio cancel scopes re-deliver cancellation at every await: cleanup must not depend on awaiting."""
    app, client = ws_app
    closed = []
    monkeypatch.setattr(realtime_router, "build_upstreams",
                        fake_upstreams(llm_of("Sure. ", "Then ", hang=True, closed=closed)))
    _, ticket = ticket_for(client, login(client))

    async def scenario():
        socket = FakeSocket(app)
        for item in (json.dumps(START), PCM, json.dumps({"type": "utterance_end"})):
            key = "bytes" if isinstance(item, bytes) else "text"
            socket.inbox.put_nowait({"type": "websocket.receive", key: item})
        async with anyio.create_task_group() as tg:
            tg.start_soon(realtime_router.realtime_ws, socket, ticket)
            with anyio.fail_after(3):
                while not any(isinstance(s, int) for s in socket.sent):  # first audio frame sent
                    await anyio.sleep(0.01)
            assert app.state.realtime_registry.active_count == 1
            tg.cancel_scope.cancel()
        leaked = None
        for _ in range(300):  # cancelled turns still save what was spoken; give them time to finish
            leaked = [t for t in asyncio.all_tasks() if "RealtimeSession" in repr(t.get_coro())]
            if not leaked:
                break
            await asyncio.sleep(0.01)
        return app.state.realtime_registry.active_count, leaked

    active, leaked = client.portal.call(scenario)
    assert active == 0
    assert leaked == []
    assert closed == [True]


# ---------------------------------------------------------------- user hang-up: bounded wait before the close frame


def test_hangup_delivers_a_slow_assessment_before_the_close(ws_app, monkeypatch):
    app, client = ws_app
    assessor = SlowAssessor(delay=0.3)
    monkeypatch.setattr(realtime_router, "build_upstreams", fake_upstreams(assessor=assessor))
    _, ticket = ticket_for(client, login(client))
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        receive_until(ws, "ready")
        ws.send_bytes(PCM)
        ws.send_text(json.dumps({"type": "utterance_end"}))
        events = receive_until(ws, "reply_done")
        assert "assessment" not in [e["type"] for e in events]
        ws.send_text(json.dumps({"type": "hangup"}))
        events, code = until_close(ws)
    assert code == 1000
    assessment = next(e for e in events if e["type"] == "assessment")
    assert assessment["status"] == "done" and assessment["message_id"]
    wait_for(lambda: app.state.realtime_registry.active_count == 0)
    wait_for(lambda: session_tasks(client) == [])


def test_hangup_close_waits_at_most_the_grace_for_a_stuck_assessment(ws_app, monkeypatch):
    app, client = ws_app
    monkeypatch.setattr(realtime_session, "HANGUP_GRACE", 0.5)
    assessor = SlowAssessor(delay=None)  # Xfyun never answers
    monkeypatch.setattr(realtime_router, "build_upstreams", fake_upstreams(assessor=assessor))
    _, ticket = ticket_for(client, login(client))
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        receive_until(ws, "ready")
        ws.send_bytes(PCM)
        ws.send_text(json.dumps({"type": "utterance_end"}))
        receive_until(ws, "reply_done")
        wait_for(lambda: assessor.calls)
        started = time.monotonic()
        ws.send_text(json.dumps({"type": "hangup"}))
        events, code = until_close(ws)
        elapsed = time.monotonic() - started
    assert code == 1000
    assert 0.4 <= elapsed < 1.5
    assert "assessment" not in [e["type"] for e in events]
    # the slot is freed at the close frame; the drain keeps giving the assessment up to 10 s in the background
    wait_for(lambda: app.state.realtime_registry.active_count == 0, timeout=0.5)
    assert len(drain_tasks(app, client)) == 1 and not assessor.cancelled  # the fixture's shutdown cancels it


def test_idle_close_does_not_wait_for_a_pending_assessment(ws_app, monkeypatch):
    app, client = ws_app
    clock = FakeClock()
    monkeypatch.setattr(realtime_router, "session_clock", clock)
    assessor = SlowAssessor(delay=None)
    monkeypatch.setattr(realtime_router, "build_upstreams", fake_upstreams(assessor=assessor))
    _, ticket = ticket_for(client, login(client))
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        receive_until(ws, "ready")
        ws.send_bytes(PCM)
        ws.send_text(json.dumps({"type": "utterance_end"}))
        receive_until(ws, "reply_done")
        wait_for(lambda: assessor.calls)
        clock.now += app.state.settings.realtime_idle_timeout_seconds + 1
        started = time.monotonic()
        ws.send_text(json.dumps({"type": "interrupt"}))  # wake the loop so it re-checks the clock
        events, code = until_close(ws)
        elapsed = time.monotonic() - started
    assert code == 4008
    assert elapsed < 1.0  # HANGUP_GRACE (2.5 s) is not applied to a server-initiated close


def test_hangup_right_after_utterance_end_saves_the_last_words_without_a_reply(ws_app, monkeypatch):
    app, client = ws_app
    seen = []
    assessor = SlowAssessor(delay=0.2)
    monkeypatch.setattr(realtime_router, "build_upstreams", fake_upstreams(
        llm=llm_of("Never.", seen=seen), recognizer=lambda: FakeRecognizer("last words", delay=0.4), assessor=assessor))
    headers = login(client)
    cid, ticket = ticket_for(client, headers)
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps(START))
        receive_until(ws, "ready")
        ws.send_bytes(PCM)
        ws.send_text(json.dumps({"type": "utterance_end"}))
        ws.send_text(json.dumps({"type": "hangup"}))  # hang up while the recognizer is still finishing
        started = time.monotonic()
        events, code = until_close(ws)
        elapsed = time.monotonic() - started
    assert code == 1000
    assert elapsed < 3.0  # the web client waits at most 3 s for the close frame
    kinds = [e["type"] for e in events]
    assert "reply_delta" not in kinds and "reply_done" not in kinds and seen == []
    final = next(e for e in events if e["type"] == "transcript_final")
    assert final["text"] == "last words" and final["message_id"]
    assert kinds.index("transcript_final") < kinds.index("assessment")  # both before the close frame
    messages = client.get(f"/api/conversations/{cid}/messages", headers=headers).json()["messages"]
    assert [(m["role"], m["content"]) for m in messages] == [("user", "last words")]
    assert messages[0]["id"] == final["message_id"]
    wait_for(lambda: app.state.realtime_registry.active_count == 0)
    wait_for(lambda: session_tasks(client) == [])


# ---------------------------------------------------------------- the call slot is freed at the close frame; drain runs in the background


def drain_tasks(app, client):
    """The background drains (late assessments of calls that already closed) still running."""
    async def collect():
        return [t for t in app.state.realtime_drains if not t.done()]
    return client.portal.call(collect)


def await_drains(app, client, timeout=5.0):
    """Deterministic end of a test: wait until every background drain has finished."""
    async def wait():
        pending = set(app.state.realtime_drains)
        if pending:
            _, late = await asyncio.wait(pending, timeout=timeout)
            assert not late, "drain still running"
    client.portal.call(wait)


def hang_up_with_pending_assessment(client, ticket):
    """One turn, then a hang-up that closes before the (slow) assessment is done."""
    with client.websocket_connect(f"/api/realtime?ticket={ticket}") as ws:
        ws.send_text(json.dumps({**START, "save_recordings": True}))
        receive_until(ws, "ready")
        ws.send_bytes(PCM)
        ws.send_text(json.dumps({"type": "utterance_end"}))
        events = receive_until(ws, "reply_done")
        ws.send_text(json.dumps({"type": "hangup"}))
        more, code = until_close(ws)
    assert code == 1000
    return events + more


def test_slot_is_released_at_the_close_frame_not_after_the_drain(ws_app, monkeypatch):
    """Driven like uvicorn does (TestClient cancels the handler when the client leaves its `with`, which
    would hide a handler that keeps the slot while it drains)."""
    app, client = ws_app
    monkeypatch.setattr(realtime_session, "HANGUP_GRACE", 0.1)
    assessor = SlowAssessor(delay=3.0)
    monkeypatch.setattr(realtime_router, "build_upstreams", fake_upstreams(assessor=assessor))
    headers = login(client)
    _, first = ticket_for(client, headers)
    _, second = ticket_for(client, headers)

    def sent_types(socket):
        return [s["type"] for s in socket.sent if isinstance(s, dict)]

    async def until(predicate):
        with anyio.fail_after(2):
            while not predicate():
                await asyncio.sleep(0.01)

    async def scenario():
        old = FakeSocket(app)
        for item in (json.dumps({**START, "save_recordings": True}), PCM, json.dumps({"type": "utterance_end"})):
            key = "bytes" if isinstance(item, bytes) else "text"
            old.inbox.put_nowait({"type": "websocket.receive", key: item})
        old_handler = asyncio.create_task(realtime_router.realtime_ws(old, first))
        await until(lambda: "reply_done" in sent_types(old))
        old.inbox.put_nowait({"type": "websocket.receive", "text": json.dumps({"type": "hangup"})})
        await until(lambda: old.closed)
        new = FakeSocket(app)
        new.inbox.put_nowait({"type": "websocket.receive", "text": json.dumps(START)})
        new_handler = asyncio.create_task(realtime_router.realtime_ws(new, second))
        await until(lambda: new.closed or "ready" in sent_types(new))
        outcome = {"new_closed": list(new.closed), "ready": "ready" in sent_types(new),
                   "old_handler_done": old_handler.done(),
                   "draining": len([t for t in getattr(app.state, "realtime_drains", ()) if not t.done()])}
        new.inbox.put_nowait({"type": "websocket.receive", "text": json.dumps({"type": "hangup"})})
        await asyncio.wait_for(new_handler, 5)
        await asyncio.wait_for(old_handler, 5)
        drains = set(getattr(app.state, "realtime_drains", ()))
        if drains:
            await asyncio.wait(drains, timeout=5)
        return outcome, old.closed

    outcome, old_closed = client.portal.call(scenario)
    assert old_closed == [1000]
    assert outcome == {"new_closed": [], "ready": True, "old_handler_done": True, "draining": 1}
    assert not assessor.cancelled and len(assessor.calls) == 1
    assert app.state.realtime_registry.active_count == 0


def test_redial_right_after_a_hangup_gets_ready_while_the_old_assessment_drains(ws_app, monkeypatch):
    app, client = ws_app
    monkeypatch.setattr(realtime_session, "HANGUP_GRACE", 0.1)
    assessor = SlowAssessor(delay=3.0)  # outlives the hang-up grace: finished by the background drain
    monkeypatch.setattr(realtime_router, "build_upstreams", fake_upstreams(assessor=assessor))
    headers = login(client)
    _, ticket = ticket_for(client, headers)
    _, again = ticket_for(client, headers)
    started = time.monotonic()
    # TestClient only leaves the `with` once the handler has returned, i.e. once the slot is released
    events = hang_up_with_pending_assessment(client, ticket)
    assert "assessment" not in [e["type"] for e in events]
    with client.websocket_connect(f"/api/realtime?ticket={again}") as ws:
        ws.send_text(json.dumps(START))
        assert receive_until(ws, "ready")[-1]["type"] == "ready"  # not 4029
        assert time.monotonic() - started < 2.0  # one fake turn + 0.1 s grace, not the 3 s assessment
        assert len(drain_tasks(app, client)) == 1  # the old call's assessment is still running
        assert app.state.realtime_registry.active_count == 1  # only the new call holds a slot
        ws.send_text(json.dumps({"type": "hangup"}))
        until_close(ws)
    await_drains(app, client)
    assert not assessor.cancelled and len(assessor.calls) == 1
    assert app.state.realtime_registry.active_count == 0
    wait_for(lambda: session_tasks(client) == [])


def test_background_drain_still_saves_and_links_the_assessment(ws_factory, monkeypatch, tmp_path):
    from sqlalchemy import select

    from app.models import Assessment, Message
    from app.realtime_providers import make_assessor
    from tests.test_realtime_assessor import FakeXfyun

    app, client = ws_factory(data_dir=str(tmp_path / "data"))
    app.state.xfyun = FakeXfyun(delay=0.8)
    monkeypatch.setattr(realtime_session, "HANGUP_GRACE", 0.1)

    def build(app_, settings, user_id, start):
        return Upstreams(Factory(FakeRecognizer("hello there")), None, "buffered", llm_of("Sure."), tts_of(),
                         make_assessor(app_, settings, user_id, start.save_recordings))

    monkeypatch.setattr(realtime_router, "build_upstreams", build)
    headers = login(client)
    _, ticket = ticket_for(client, headers)
    events = hang_up_with_pending_assessment(client, ticket)
    assert "assessment" not in [e["type"] for e in events]
    assert app.state.realtime_registry.active_count == 0
    assert len(drain_tasks(app, client)) == 1
    await_drains(app, client)
    message_id = next(e for e in events if e["type"] == "transcript_final")["message_id"]

    async def linked():
        async with app.state.sessionmaker() as session:
            message = await session.get(Message, message_id)
            rows = (await session.scalars(select(Assessment))).all()
            return message.assessment_id, [r.id for r in rows]

    assessment_id, rows = client.portal.call(linked)
    assert assessment_id is not None and rows == [assessment_id]


def test_global_limit_does_not_count_draining_calls(ws_factory, monkeypatch):
    # REALTIME_MAX_SESSIONS counts live calls only: a call whose assessments are still finishing is not counted
    app, client = ws_factory(realtime_max_sessions=1)
    monkeypatch.setattr(realtime_session, "HANGUP_GRACE", 0.1)
    assessor = SlowAssessor(delay=3.0)
    monkeypatch.setattr(realtime_router, "build_upstreams", fake_upstreams(assessor=assessor))
    _, ticket = ticket_for(client, login(client, "alice"))
    _, other = ticket_for(client, login(client, "bob"))
    started = time.monotonic()
    hang_up_with_pending_assessment(client, ticket)  # returns once alice's handler (and slot) is done
    with client.websocket_connect(f"/api/realtime?ticket={other}") as ws:
        ws.send_text(json.dumps(START))
        assert receive_until(ws, "ready")[-1]["type"] == "ready"  # not 4029
        assert time.monotonic() - started < 2.0  # not after alice's 3 s assessment
        assert len(drain_tasks(app, client)) == 1
        assert app.state.realtime_registry.active_count == 1
        ws.send_text(json.dumps({"type": "hangup"}))
        until_close(ws)
    await_drains(app, client)
    assert app.state.realtime_registry.active_count == 0


def test_app_shutdown_cancels_outstanding_drains(tmp_path, monkeypatch, caplog):
    app = make_ws_app(tmp_path, monkeypatch)
    client = _start(app)
    monkeypatch.setattr(realtime_session, "HANGUP_GRACE", 0.1)
    assessor = SlowAssessor(delay=None)  # never answers: only the shutdown ends the drain
    monkeypatch.setattr(realtime_router, "build_upstreams", fake_upstreams(assessor=assessor))
    _, ticket = ticket_for(client, login(client))
    hang_up_with_pending_assessment(client, ticket)
    drains = drain_tasks(app, client)
    assert len(drains) == 1
    http = app.state.http
    real_aclose = http.aclose
    seen_at_http_close = []

    async def aclose():  # the lifespan closes http (then the engine) after it cancelled the drains
        seen_at_http_close.append((drains[0].done(), assessor.cancelled))
        await real_aclose()

    http.aclose = aclose
    caplog.set_level(logging.WARNING)
    started = time.monotonic()
    client.__exit__(None, None, None)  # lifespan shutdown
    assert time.monotonic() - started < 3.0
    assert seen_at_http_close == [(True, True)]  # done inside the lifespan, not by the loop's teardown
    assert drains[0].cancelled()
    assert assessor.cancelled
    assert not app.state.realtime_drains
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]


async def test_shutdown_helper_cancels_and_waits_briefly():
    from types import SimpleNamespace

    class StuckSession:
        cancelled = False

        async def drain(self, timeout):
            await asyncio.Event().wait()

        def cancel_pending(self):
            self.cancelled = True

    app = SimpleNamespace(state=SimpleNamespace(realtime_drains=set()))
    session = StuckSession()
    realtime_router.spawn_drain(app, session)
    (task,) = app.state.realtime_drains
    await asyncio.sleep(0)
    await realtime_router.cancel_drains(app)
    assert task.cancelled() and session.cancelled and not app.state.realtime_drains


async def test_drain_errors_are_logged_by_type_only(caplog):
    from types import SimpleNamespace

    class BrokenSession:
        async def drain(self, timeout):
            raise RuntimeError("user text: hello there")

        def cancel_pending(self):
            pass

    app = SimpleNamespace(state=SimpleNamespace(realtime_drains=set()))
    realtime_router.spawn_drain(app, BrokenSession())
    (task,) = app.state.realtime_drains
    await task
    await asyncio.sleep(0)  # done callbacks run on the next loop iteration
    assert not app.state.realtime_drains
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "RuntimeError" in text and "hello there" not in text
