import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.core.maintenance import decide
from app.core.runtime_settings import compose
from app.main import create_app
from tests.conftest import make_settings


@pytest.mark.parametrize("mode,method,path,kind,expected", [
    ("off", "POST", "/api/conversations", "http", None),
    ("read_only", "GET", "/api/conversations", "http", None),
    ("read_only", "POST", "/api/conversations", "http", "http_503"),
    ("read_only", "DELETE", "/api/conversations/x", "http", "http_503"),
    ("read_only", "POST", "/api/sessions", "http", None),
    ("read_only", "POST", "/api/admin/settings", "http", None),
    ("read_only", "GET", "/api/rooms/ws", "websocket", "ws_1013"),
    ("full", "GET", "/api/conversations", "http", "http_503"),
    ("full", "POST", "/api/sessions", "http", "http_503"),
    ("full", "GET", "/api/announcements", "http", None),
    ("full", "GET", "/api/admin/session", "http", None),
    ("full", "GET", "/api/administrator", "http", "http_503"),  # prefix match is per path segment
    ("full", "GET", "/up", "http", None),
    ("full", "GET", "/", "http", None),  # SPA still served so the web app can show the maintenance page
    ("full", "GET", "/admin/", "http", None),
    ("full", "GET", "/api/realtime", "websocket", "ws_1013"),
])
def test_decide(mode, method, path, kind, expected):
    assert decide(mode, method, path, kind) == expected


async def test_middleware_follows_hot_settings(app, client, auth_headers):
    app.state.settings_hub.publish(compose(app.state.base_settings, {"maintenance_mode": "read_only"}))
    r = await client.post("/api/conversations", headers=auth_headers, json={"name": "x"})
    assert r.status_code == 503 and r.json() == {"error": "Maintenance"} and r.headers["retry-after"] == "120"
    assert (await client.get("/api/conversations", headers=auth_headers)).status_code == 200
    login = await client.post("/api/sessions", json={"username": "alice", "password": "password123"})
    assert login.status_code == 200  # signing in still works in read-only mode
    app.state.settings_hub.publish(compose(app.state.base_settings, {"maintenance_mode": "full"}))
    assert (await client.get("/api/conversations", headers=auth_headers)).status_code == 503
    public = await client.get("/api/announcements")
    assert public.status_code == 200 and public.json()["maintenance"]["mode"] == "full"
    app.state.settings_hub.publish(compose(app.state.base_settings, {"maintenance_mode": "off"}))
    assert (await client.post("/api/conversations", headers=auth_headers, json={"name": "x"})).status_code == 200


def test_websocket_handshake_is_refused_with_1013():
    app = create_app(make_settings(maintenance_mode="read_only"))
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/rooms/ws?ticket=x") as ws:
            ws.receive_text()
    assert exc.value.code == 1013
