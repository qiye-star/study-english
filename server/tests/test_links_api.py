from app.links.registry import LINKS
from app.links.spec import LINK_KEYS
from tests.links_helpers import check_contract, enable_links

URL = "/api/links"


async def login(client, name="alice"):
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_registry_lists_the_six_links_in_spec_order():
    assert tuple(s.key for s in LINKS) == LINK_KEYS


async def test_config_when_master_is_off(client):
    h = await login(client)
    body = (await client.get(f"{URL}/config", headers=h)).json()
    assert body["enabled"] is False
    assert [l["key"] for l in body["links"]] == list(LINK_KEYS)
    assert all(l["effective"] is False and l["user"] is True and l["global"] is True for l in body["links"])
    r = await client.put(f"{URL}/prefs", headers=h, json={"key": "mistakes", "enabled": False})
    assert (r.status_code, r.json()) == (404, {"error": "Links are disabled"})


async def test_prefs_round_trip_and_validation(app, client):
    enable_links(app, link_chat_words_enabled=False)
    h = await login(client)
    on = (await client.get(f"{URL}/config", headers=h)).json()
    assert {l["key"]: (l["global"], l["effective"]) for l in on["links"]}["chat_words"] == (False, False)
    r = await client.put(f"{URL}/prefs", headers=h, json={"key": "mistakes", "enabled": False})
    assert r.status_code == 200
    mistakes = next(l for l in r.json()["links"] if l["key"] == "mistakes")
    assert (mistakes["user"], mistakes["effective"]) == (False, False)
    assert (await client.put(f"{URL}/prefs", headers=h, json={"key": "nope", "enabled": True})).json() == {"error": "Unknown link"}
    assert (await client.put(f"{URL}/prefs", headers=h, json={"key": "mistakes", "enabled": True, "x": 1})).status_code == 422
    assert (await client.get(f"{URL}/config")).status_code == 401
    other = await login(client, "bob")
    theirs = next(l for l in (await client.get(f"{URL}/config", headers=other)).json()["links"] if l["key"] == "mistakes")
    assert theirs["user"] is True  # prefs are per user
    check_contract("links_contract", {"config": on, "prefs": r.json(), "unknown": {"error": "Unknown link"}})


async def test_saving_a_pref_takes_effect_in_the_gate_at_once(app, client):
    enable_links(app)
    h = await login(client)
    uid = int((await client.get("/api/me", headers=h)).json()["id"])
    assert await app.state.link_gate("mistakes", uid) is True  # now cached
    await client.put(f"{URL}/prefs", headers=h, json={"key": "mistakes", "enabled": False})
    assert await app.state.link_gate("mistakes", uid) is False
    await client.put(f"{URL}/prefs", headers=h, json={"key": "mistakes", "enabled": True})
    assert await app.state.link_gate("mistakes", uid) is True


async def test_bus_and_gate_are_installed(app):
    assert app.state.learning_bus is not None and app.state.link_gate is not None
