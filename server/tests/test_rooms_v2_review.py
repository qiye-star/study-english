"""Regression tests for the rooms v2 server review (docs/superpowers/plans/review-rooms-v2-server.md)."""
from tests.test_rooms_ws import login, make_client


def test_switching_to_approval_kills_a_link_a_member_handed_out(tmp_path, monkeypatch):
    """M1 (owner path): a member's link from the `code` days must not bypass approval afterwards."""
    app, client = make_client(tmp_path, monkeypatch)
    try:
        alice, _ = login(client, "alice")
        bob, _ = login(client, "bob")
        carol, _ = login(client, "carol")
        room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
        token = client.post(f"/api/rooms/{room['id']}/invite", headers=bob).json()["token"]
        r = client.patch(f"/api/rooms/{room['id']}", json={"join_mode": "approval"}, headers=alice)
        assert r.status_code == 200 and r.json()["room"]["join_mode"] == "approval"
        assert client.get(f"/api/rooms/invite/{token}", headers=carol).status_code == 404
        assert client.post(f"/api/rooms/invite/{token}/join", headers=carol).status_code == 404
        assert client.get(f"/api/rooms/{room['id']}", headers=carol).status_code == 404  # not a member
        fresh = client.post(f"/api/rooms/{room['id']}/invite", headers=alice).json()["token"]
        assert fresh != token
        assert client.post(f"/api/rooms/invite/{fresh}/join", headers=carol).status_code == 200
    finally:
        client.__exit__(None, None, None)
