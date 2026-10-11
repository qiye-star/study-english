import pytest

from app.links.gate import LinkGate
from app.links.spec import LINK_KEYS, flag_of
from app.models import UserLinkPref, utcnow
from tests.links_helpers import enable_links, user_id_of


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


async def make_user(client, name="alice"):
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return await user_id_of(client, h), h


async def set_pref(app, uid, key, enabled):
    async with app.state.sessionmaker() as s:
        s.add(UserLinkPref(user_id=uid, link_key=key, enabled=enabled, updated_at=utcnow()))
        await s.commit()


@pytest.mark.parametrize("master,flag,pref,expected", [
    (False, True, None, False), (True, False, None, False), (True, True, None, True),
    (True, True, True, True), (True, True, False, False), (False, False, False, False),
])
async def test_three_level_truth_table(app, client, master, flag, pref, expected):
    uid, _ = await make_user(client)
    app.state.settings = app.state.settings.model_copy(update={"links_enabled": master, flag_of("mistakes"): flag})
    if pref is not None:
        await set_pref(app, uid, "mistakes", pref)
    assert await LinkGate(app)("mistakes", uid) is expected


async def test_prefs_are_cached_for_30_seconds_and_invalidated(app, client):
    uid, _ = await make_user(client)
    enable_links(app)
    clock = Clock()
    gate = LinkGate(app, clock=clock)
    assert await gate("chat_words", uid) is True
    await set_pref(app, uid, "chat_words", False)
    assert await gate("chat_words", uid) is True  # cached
    clock.t += 31
    assert await gate("chat_words", uid) is False
    gate.invalidate(uid)
    assert (await gate.prefs(uid))["chat_words"] is False


async def test_unknown_link_is_off(app, client):
    uid, _ = await make_user(client)
    enable_links(app)
    assert await LinkGate(app)("nope", uid) is False


async def test_require_link_guards_an_endpoint(app, client):
    from fastapi import APIRouter, Depends

    from app.links.gate import require_link
    router = APIRouter()

    @router.get("/api/links/__probe")
    async def probe(user=Depends(require_link("mistakes"))):
        return {"ok": user.id}

    app.include_router(router)
    app.router.routes.insert(0, app.router.routes.pop())  # ahead of the stubs' /api/** fallback
    uid, h = await make_user(client)
    assert (await client.get("/api/links/__probe")).status_code == 401
    off = await client.get("/api/links/__probe", headers=h)
    assert (off.status_code, off.json()) == (404, {"error": "Link is off"})
    enable_links(app)
    assert (await client.get("/api/links/__probe", headers=h)).json() == {"ok": uid}


async def test_the_bus_gate_applies_the_three_levels_to_registered_links_only(app, client):
    from datetime import datetime, timezone

    from app.core.learning_events import MessageSent
    uid, _ = await make_user(client)
    enable_links(app, link_chat_words_enabled=False)
    seen = []

    async def handler(event):
        seen.append(event.user_id)
    bus = app.state.learning_bus
    bus.subscribe(MessageSent, "chat_words", handler)  # a registered link, globally off
    bus.subscribe(MessageSent, "diagnostics", handler)  # not a link: only the master switch applies
    bus.publish(MessageSent(user_id=uid, conversation_id="c", message_id="m", text="hi",
                            at=datetime.now(timezone.utc)))
    await bus.drain()
    assert seen == [uid]
    # Ruling(L5):chat_words 自己的处理器也订阅了 MessageSent,所以这里每个订阅者各记一次 skipped,一个都没执行
    assert bus.stats()["chat_words"]["handled"] == 0 and bus.stats()["chat_words"]["skipped"] >= 1
    assert bus.stats()["diagnostics"]["handled"] == 1


def test_every_link_key_has_a_settings_flag():
    from app.core.config import Settings
    assert all(flag_of(k) in Settings.model_fields for k in LINK_KEYS)
