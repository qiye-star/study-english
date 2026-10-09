"""维护模式(spec §9):纯 ASGI 中间件,每个请求读 `app.state.settings.maintenance_mode`,与热更新天然一致。

- `read_only`:`/api/**` 的写请求 503(放行登录 `POST /api/sessions`、管理端、公告);新 WebSocket 握手以 1013 拒绝。
  `GET /api/rank/me` 此时不做同步/解锁;进行中的实时通话在维护开启时以 1012 结束(routers/realtime 的设置监听)。
- `full`:除 `/up`、管理端、公告外 `/api/**` 全部 503;静态页面照常(网页据公告接口显示维护页)。
"""
import json

ALWAYS_ALLOWED = ("/up", "/api/admin", "/api/announcements")
READ_ONLY_ALLOWED_WRITES = (("POST", "/api/sessions"),)
SAFE = {"GET", "HEAD", "OPTIONS"}
RETRY_AFTER = "120"
WS_TRY_AGAIN_LATER = 1013


def decide(mode: str, method: str, path: str, scope_type: str) -> str | None:
    """None = pass, "http_503" or "ws_1013"."""
    if mode == "off" or any(path == p or path.startswith(p + "/") for p in ALWAYS_ALLOWED):
        return None
    if scope_type == "websocket":
        return "ws_1013"
    if not path.startswith("/api/"):
        return None
    if mode == "full":
        return "http_503"
    if method.upper() in SAFE or (method.upper(), path) in READ_ONLY_ALLOWED_WRITES:
        return None
    return "http_503"


_BODY = json.dumps({"error": "Maintenance"}).encode()


class MaintenanceMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        settings = getattr(getattr(scope.get("app"), "state", None), "settings", None)
        mode = getattr(settings, "maintenance_mode", "off")
        verdict = decide(mode, scope.get("method", "GET"), scope.get("path", ""), scope["type"])
        if verdict is None:
            return await self.app(scope, receive, send)
        if verdict == "ws_1013":
            message = await receive()  # websocket.connect; closing before accept rejects the handshake
            if message.get("type") == "websocket.connect":
                await send({"type": "websocket.close", "code": WS_TRY_AGAIN_LATER})
            return None
        await send({"type": "http.response.start", "status": 503, "headers": [
            (b"content-type", b"application/json"), (b"content-length", str(len(_BODY)).encode()),
            (b"retry-after", RETRY_AFTER.encode()), (b"cache-control", b"no-store")]})
        await send({"type": "http.response.body", "body": _BODY})
        return None
