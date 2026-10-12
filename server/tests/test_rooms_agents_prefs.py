"""rooms_agents.install: the lane's prefs carry the user's zh_note (plan addressing-server T4)."""
from app.routers import rooms as rooms_router
from tests.test_rooms_agents_api import agents_client, room_of  # noqa: F401 (fixture)


def test_install_prefs_carry_zh_note(agents_client):
    app, client = agents_client
    _room, _alice, alice_id, bob, bob_id = room_of(client)
    assert client.patch("/api/agents/settings", json={"zh_note": "never"}, headers=bob).status_code == 200
    rt = rooms_router.runtime(app)
    assert client.portal.call(rt.agents.deps.prefs, bob_id).zh_note == "never"
    assert client.portal.call(rt.agents.deps.prefs, alice_id).zh_note == "auto"
