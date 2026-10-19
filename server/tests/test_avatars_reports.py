"""头像举报(计划 S6、R-V6):只有同过房间的人可以举报;同一人对同一头像只记一次;每人每天 20 次。"""
import io
import logging
import re

import pytest
from PIL import Image
from sqlalchemy import func, select

from app.models import AvatarReport

NOT_FOUND = {"error": "User not found"}
ID_RE = re.compile(r"/api/avatars/([0-9a-f]{32})")


@pytest.fixture
def settings_overrides(tmp_path):
    return {"data_dir": str(tmp_path), "rooms_enabled": True}


def image(color=(200, 30, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), color).save(buf, format="PNG")
    return buf.getvalue()


async def register(client, name):
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, int(r.json()["id"])


async def upload_avatar(client, headers, color=(200, 30, 30)) -> str:
    r = await client.post("/api/me/avatar", files={"file": ("a.png", image(color), "image/png")}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["avatar_url"].rsplit("/", 1)[1]


async def make_room(client, owner_headers) -> dict:
    created = await client.post("/api/rooms", json={"topic": "reports"}, headers=owner_headers)
    return created.json()["room"]


async def join(client, headers, room) -> None:
    r = await client.post("/api/rooms/join", json={"code": room["code"]}, headers=headers)
    assert r.status_code == 200, r.text


async def report(client, headers, user_id, reason="inappropriate"):
    return await client.post("/api/avatar-reports", json={"user_id": str(user_id), "reason": reason}, headers=headers)


async def report_rows(app):
    async with app.state.sessionmaker() as session:
        return (await session.execute(select(func.count(AvatarReport.id)))).scalar_one()


@pytest.fixture
async def shared_room(client, auth_headers):
    """alice owns a room; bob (who has an avatar) is in it; carol is not."""
    room = await make_room(client, auth_headers)
    bob, bob_id = await register(client, "bob")
    carol, carol_id = await register(client, "carol")
    await join(client, bob, room)
    avatar = await upload_avatar(client, bob)
    return {"room": room, "alice": auth_headers, "bob": bob, "bob_id": bob_id, "carol": carol,
            "carol_id": carol_id, "avatar": avatar}


async def test_a_roommate_can_report_an_avatar_once(app, client, shared_room):
    r = await report(client, shared_room["alice"], shared_room["bob_id"])
    assert r.status_code == 201
    assert r.json() == {"ok": True}
    again = await report(client, shared_room["alice"], shared_room["bob_id"], reason="other")
    assert again.status_code == 200  # the same reporter and the same avatar: no second row
    assert await report_rows(app) == 1


async def test_a_user_outside_the_room_gets_the_same_answer_as_an_unknown_user(client, shared_room):
    outsider = await report(client, shared_room["carol"], shared_room["bob_id"])
    unknown = await report(client, shared_room["carol"], 987654321)
    assert outsider.status_code == 404 and outsider.json() == NOT_FOUND
    assert unknown.status_code == 404 and unknown.json() == NOT_FOUND


async def test_a_user_who_left_the_room_can_still_report_it(client, shared_room):
    left = await client.post(f"/api/rooms/{shared_room['room']['id']}/leave", headers=shared_room["bob"])
    assert left.status_code == 200, left.text
    r = await report(client, shared_room["alice"], shared_room["bob_id"])
    assert r.status_code == 201


async def test_target_without_an_avatar_is_404(client, shared_room, auth_headers):
    room = shared_room["room"]
    dave, dave_id = await register(client, "dave")
    await join(client, dave, room)
    r = await report(client, shared_room["alice"], dave_id)
    assert r.status_code == 404
    assert r.json() == {"error": "No avatar to report"}


async def test_a_new_avatar_can_be_reported_again(app, client, shared_room):
    assert (await report(client, shared_room["alice"], shared_room["bob_id"])).status_code == 201
    await upload_avatar(client, shared_room["bob"], color=(0, 200, 0))
    assert (await report(client, shared_room["alice"], shared_room["bob_id"])).status_code == 201
    assert await report_rows(app) == 2


async def test_reason_must_be_from_the_list(client, shared_room):
    r = await report(client, shared_room["alice"], shared_room["bob_id"], reason="rude words")
    assert r.status_code == 422


async def test_reporting_yourself_is_404_and_a_malformed_id_is_422(client, shared_room):
    own = await report(client, shared_room["bob"], shared_room["bob_id"])
    bad = await client.post("/api/avatar-reports", json={"user_id": "abc", "reason": "other"},
                            headers=shared_room["alice"])
    assert own.status_code == 404 and own.json() == NOT_FOUND
    assert bad.status_code == 422 and set(bad.json()) == {"error"}


async def test_reporting_needs_a_token(client, shared_room):
    r = await client.post("/api/avatar-reports", json={"user_id": str(shared_room["bob_id"]), "reason": "other"})
    assert r.status_code == 401


async def test_twenty_reports_a_day_then_429(client, shared_room):
    for _ in range(20):
        await report(client, shared_room["alice"], shared_room["bob_id"])
    r = await report(client, shared_room["alice"], shared_room["bob_id"])
    assert r.status_code == 429


async def test_report_logs_never_carry_the_avatar_id(client, shared_room, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    assert (await report(client, shared_room["alice"], shared_room["bob_id"])).status_code == 201
    assert any("report" in record.getMessage() for record in caplog.records)
    assert shared_room["avatar"] not in caplog.text


async def test_the_member_id_as_a_number_works_like_a_string(app, client, shared_room):
    # The web client sends the room member's id as a JSON number.
    created = await client.post("/api/avatar-reports", json={"user_id": shared_room["bob_id"], "reason": "other"},
                                headers=shared_room["alice"])
    assert created.status_code == 201, created.text
    assert created.json() == {"ok": True}
    again = await client.post("/api/avatar-reports", json={"user_id": shared_room["bob_id"], "reason": "other"},
                              headers=shared_room["alice"])
    assert again.status_code == 200
    assert await report_rows(app) == 1


async def test_a_numeric_and_a_string_id_store_the_same_report(app, client, shared_room):
    carol_headers = shared_room["carol"]
    await join(client, carol_headers, shared_room["room"])
    as_number = await client.post("/api/avatar-reports", json={"user_id": shared_room["bob_id"], "reason": "other"},
                                  headers=shared_room["alice"])
    as_string = await report(client, carol_headers, shared_room["bob_id"], reason="other")
    assert as_number.status_code == 201 and as_string.status_code == 201
    async with app.state.sessionmaker() as session:
        rows = (await session.execute(select(AvatarReport).order_by(AvatarReport.id))).scalars().all()
    assert len(rows) == 2
    assert {row.avatar_user_id for row in rows} == {shared_room["bob_id"]}
    assert len({row.avatar_id for row in rows}) == 1
    assert {row.reason for row in rows} == {"other"}


@pytest.mark.parametrize("bad", [True, 1.5, "abc", "1; drop", -3, 0, "0", "-3", 123456789012, "123456789012",
                                 2**31, None, [1], {"id": 1}, " 2", "2\n"])
async def test_an_invalid_member_id_is_422_and_never_echoed(client, shared_room, bad):
    r = await client.post("/api/avatar-reports", json={"user_id": bad, "reason": "other"},
                          headers=shared_room["alice"])
    assert r.status_code == 422, r.text
    assert set(r.json()) == {"error"}
    assert "drop" not in r.text and "abc" not in r.text and "1.5" not in r.text
    assert "123456789012" not in r.text and "12345678901" not in r.text


async def test_unknown_outside_and_self_are_the_same_404_for_numbers_and_strings(client, shared_room):
    cases = [
        (shared_room["alice"], 987654321),           # unknown user
        (shared_room["alice"], shared_room["carol_id"]),  # exists, but shares no room with alice
        (shared_room["bob"], shared_room["bob_id"]),      # reporting yourself
    ]
    for headers, uid in cases:
        by_number = await client.post("/api/avatar-reports", json={"user_id": uid, "reason": "other"},
                                      headers=headers)
        by_string = await report(client, headers, uid)
        assert by_number.status_code == 404 and by_number.json() == NOT_FOUND
        assert by_string.status_code == 404 and by_string.json() == NOT_FOUND
