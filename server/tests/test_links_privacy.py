"""Learning-link routes keep words, text and user ids out of URLs and logs (plan Global Constraints, privacy).

uvicorn's access log prints the request path and query string of every request, so anything in a URL ends
up in the server log; words travel only in JSON bodies."""
import logging
from datetime import datetime, timedelta, timezone

from tests.test_admin_routes_guarded import api_routes
from tests.links_helpers import drain, enable_links
from tests.wordbook_helpers import enable_wordbook, make_data_dir

ALLOWED_QUERY = {"page", "offset"}
WORD = "talk"  # in the junior test book
TEXT = "I talked with my teacher about quokkas"


def _link_routes(app):
    return [(p, r) for p, r in api_routes(app.routes) if p.startswith(("/api/links", "/api/admin/links"))]


def test_link_routes_have_no_path_parameters_and_only_paging_queries(app):
    routes = _link_routes(app)
    assert len(routes) >= 10
    for path, route in routes:
        params = {p.name for p in route.dependant.path_params}
        if path.startswith("/api/admin/links"):
            assert params <= {"key"}, path  # a link key, never user data
        else:
            assert params == set(), path
        assert {p.name for p in route.dependant.query_params} <= ALLOWED_QUERY, (path, route.methods)


class AccessLog:
    """What uvicorn.access would print: method, path and query string of each request."""

    def __init__(self, app):
        self.app, self.lines = app, []

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            self.lines.append(f'{scope["method"]} {scope["path"]}?{scope["query_string"].decode("latin-1")}')
        await self.app(scope, receive, send)


async def test_exercising_every_link_endpoint_logs_no_word_text_or_user_id(app, client, tmp_path, caplog):
    import httpx

    from tests.test_links_chat_words import learned
    enable_wordbook(app, make_data_dir(tmp_path))
    enable_links(app, rank_enabled=True)
    log = AccessLog(app)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=log), base_url="http://test") as c:
        r = await c.post("/api/users", json={"username": "quokka", "password": "password123"})
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        uid = int((await c.get("/api/me", headers=h)).json()["id"])
        await c.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
        await learned(app, uid, WORD, at=datetime.now(timezone.utc) - timedelta(hours=1))
        caplog.set_level(logging.DEBUG)
        log.lines.clear()
        conv = (await c.post("/api/conversations", headers=h, json={"name": "c"})).json()
        await c.post(f"/api/conversations/{conv['id']}/messages", headers=h,
                     json={"messages": [{"role": "user", "content": TEXT}]})
        await drain(app)
        calls = [
            ("GET", "/api/links/config", None), ("PUT", "/api/links/prefs", {"key": "mistakes", "enabled": True}),
            ("POST", "/api/links/wordbook/adopt", {"word": WORD}), ("POST", "/api/links/wordbook/card", {"word": WORD}),
            ("GET", "/api/links/today", None), ("GET", "/api/links/mistakes", None),
            ("POST", "/api/links/mistakes/dismiss", {"word": WORD}), ("GET", "/api/links/weak-words", None),
            ("POST", "/api/links/weak-words/dismiss", {"word": WORD}), ("GET", "/api/links/today-words", None),
            ("GET", "/api/links/chat-words", None),
        ]
        for method, url, body in calls:
            r = await c.request(method, url, headers=h, json=body)
            assert r.status_code == 200 and r.json() != {}, (method, url, r.status_code, r.text)  # {} = desktop stub
        assert (await c.get("/api/links/chat-words", headers=h)).json()["used_count"] == 1
    link_lines = [line for line in log.lines if "/api/links" in line]
    assert len(link_lines) >= len(calls)
    for line in link_lines:
        assert WORD not in line.lower() and "quokka" not in line and str(uid) not in line.split("?", 1)[1], line
    # the test client (httpx) and the database drivers' DEBUG statement traces are not the server's log
    server_logs = [r.getMessage() for r in caplog.records
                   if not r.name.startswith(("httpx", "httpcore", "aiosqlite", "sqlalchemy"))]
    assert not [m for m in server_logs if WORD in m.lower() or "quokka" in m.lower() or TEXT in m]
