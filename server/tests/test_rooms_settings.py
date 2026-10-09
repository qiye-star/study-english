import pytest

from app.rooms.rules import clean_settings, default_level
from tests.test_rooms_ws import login, make_client

LATEST = 2_147_483_647


@pytest.fixture
def c(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch, rooms_max_members=8)
    yield client
    client.__exit__(None, None, None)


def test_clean_settings_rules():
    ok, errors = clean_settings({"name": "  美食  角 ", "scenario": "cafe", "level": "B2", "join_mode": "approval",
                                 "max_members": 6, "ai_public": False, "allow_voice": True},
                                site_max_members=8, partial=False)
    assert errors == {} and ok["name"] == "美食 角" and ok["max_members"] == 6
    _, errors = clean_settings({"name": "x" * 31, "scenario": "mars", "level": "C2", "join_mode": "password",
                                "max_members": 9}, site_max_members=8, partial=True)
    assert errors == {"name": "too_long", "scenario": "unknown", "level": "unknown", "join_mode": "unknown",
                      "max_members": "range"}
    assert clean_settings({"max_members": 6}, site_max_members=5, partial=True)[1] == {"max_members": "range"}
    assert [default_level(t) for t in (None, 0, 1, 2, 3, 4, 5, 6)] == ["A2", "A1", "A2", "B1", "B1", "B2", "C1", "C1"]
    # whitespace and control characters do not count towards the 30 code points; blank names mean "default/no change"
    assert clean_settings({"name": " " * 40 + "ok"}, site_max_members=8, partial=True) == ({"name": "ok"}, {})
    assert clean_settings({"name": "   "}, site_max_members=8, partial=True) == ({}, {})
    assert clean_settings({"max_members": 1}, site_max_members=8, partial=True)[1] == {"max_members": "range"}


def test_create_with_seven_settings_and_defaults(c):
    alice, _ = login(c, "alice")
    room = c.post("/api/rooms", json={"scenario": "cafe", "join_mode": "approval", "max_members": 3,
                                      "ai_public": False, "allow_voice": False}, headers=alice).json()["room"]
    assert (room["name"], room["topic"], room["scenario"], room["level"], room["join_mode"], room["max_members"],
            room["ai_public"], room["allow_voice"]) == ("alice的房间", "alice的房间", "cafe", "A2", "approval", 3,
                                                       False, False)
    bad = c.post("/api/rooms", json={"scenario": "mars"}, headers=alice)
    assert bad.status_code == 400 and bad.json() == {"error": "Invalid settings", "fields": {"scenario": "unknown"}}
    legacy = c.post("/api/rooms", json={"topic": "旅行"}, headers=alice).json()["room"]
    assert legacy["name"] == "旅行" and legacy["max_members"] == 4


def test_owner_edits_settings_with_one_system_message(c):
    alice, _ = login(c, "alice")
    bob, _ = login(c, "bob")
    room = c.post("/api/rooms", json={}, headers=alice).json()["room"]
    c.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    r = c.patch(f"/api/rooms/{room['id']}", json={"name": "美食角", "level": "B1", "allow_voice": False},
                headers=alice)
    assert r.status_code == 200 and r.json()["room"]["name"] == "美食角"
    msgs = c.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": LATEST}, headers=alice).json()["messages"]
    system = [m for m in msgs if m["kind"] == "system" and m["text"] == "settings"]
    assert system[-1]["meta"] == {"changes": [{"field": "name", "value": "美食角"}, {"field": "level", "value": "B1"},
                                              {"field": "allow_voice", "value": False}]}
    assert c.patch(f"/api/rooms/{room['id']}", json={"max_members": 1}, headers=alice).status_code == 400
    assert c.patch(f"/api/rooms/{room['id']}", json={"max_members": 2}, headers=alice).status_code == 200
    carol, _ = login(c, "carol")
    assert c.post("/api/rooms/join", json={"code": room["code"]}, headers=carol).status_code == 409  # full at 2
    assert c.patch(f"/api/rooms/{room['id']}", json={"name": "x"}, headers=bob).status_code == 403
    # An unchanged value and a legacy `topic` patch: no new settings message for the former, `name` for the latter
    before = len(c.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": LATEST}, headers=alice).json()["messages"])
    assert c.patch(f"/api/rooms/{room['id']}", json={"level": "B1"}, headers=alice).status_code == 200
    legacy = c.patch(f"/api/rooms/{room['id']}", json={"topic": "旅" * 40}, headers=alice).json()["room"]
    assert legacy["name"] == "旅" * 30 and legacy["topic"] == "旅" * 30
    msgs = c.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": LATEST}, headers=alice).json()["messages"]
    assert len(msgs) == before + 1 and msgs[-1]["meta"] == {"changes": [{"field": "name", "value": "旅" * 30}]}


def test_max_members_cannot_drop_below_current_members(c):
    alice, _ = login(c, "alice")
    room = c.post("/api/rooms", json={"max_members": 3}, headers=alice).json()["room"]
    for name in ("bob", "carol"):
        c.post("/api/rooms/join", json={"code": room["code"]}, headers=login(c, name)[0])
    r = c.patch(f"/api/rooms/{room['id']}", json={"max_members": 2}, headers=alice)
    assert r.status_code == 409 and r.json() == {"error": "Below current members"}


def test_closed_rooms_cannot_be_edited(c):
    alice, _ = login(c, "alice")
    room = c.post("/api/rooms", json={}, headers=alice).json()["room"]
    c.post(f"/api/rooms/{room['id']}/close", headers=alice)
    assert c.patch(f"/api/rooms/{room['id']}", json={"name": "x"}, headers=alice).status_code == 404
