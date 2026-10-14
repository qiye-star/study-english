"""更新日志用户接口(计划 docs/superpowers/plans/2026-10-14-changelog.md S2;spec §2.1):已发布条目、未读数、已读位置。

条目直接写库造数据(管理接口在 S3);草稿 / 已归档的条目对用户不可见。"""
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import select

from app.models import ChangelogRead, User
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as

ENTRY_KEYS = {"id", "entry_date", "version", "title_zh", "title_en", "items", "published_at", "is_new"}


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "data")}


async def seed(app, day: str, title: str, *, published: bool = True, archived: bool = False, version=None, items=None) -> int:
    from app.models import ChangelogEntry

    now = datetime.now(timezone.utc)
    async with app.state.sessionmaker() as s:
        row = ChangelogEntry(entry_date=date.fromisoformat(day), version=version, title_zh=title, title_en="",
                             items=items or [{"tag": "new", "zh": f"{title}的内容", "en": ""}], created_by="test",
                             created_at=now, updated_at=now, published_at=now if published else None,
                             archived_at=now if archived else None)
        s.add(row)
        await s.commit()
        return row.id


async def register(client, name: str) -> dict:
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def listing(client, headers, **params):
    r = await client.get("/api/changelog", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


async def seen(client, headers, upto: int):
    r = await client.post("/api/changelog/seen", headers=headers, json={"upto_id": upto})
    assert r.status_code == 200, r.text
    return r.json()


async def test_login_is_required(client):
    assert (await client.get("/api/changelog")).status_code == 401
    assert (await client.post("/api/changelog/seen", json={"upto_id": 1})).status_code == 401


async def test_empty_log_has_no_latest_id(client, auth_headers):
    assert await listing(client, auth_headers) == {"entries": [], "next": None, "unread": 0, "latest_id": None}
    assert await seen(client, auth_headers, 5) == {"unread": 0, "last_seen_id": 0}  # nothing published: nothing is written


async def test_drafts_and_deleted_entries_are_invisible_and_the_order_is_by_date(app, client, auth_headers):
    a = await seed(app, "2026-10-12", "A", version="v1.1")
    b = await seed(app, "2026-10-14", "B")
    await seed(app, "2026-10-13", "C", published=False)
    await seed(app, "2026-10-15", "D", archived=True)
    body = await listing(client, auth_headers)
    assert set(body) == {"entries", "next", "unread", "latest_id"}
    assert [e["title_zh"] for e in body["entries"]] == ["B", "A"]
    assert all(set(e) == ENTRY_KEYS for e in body["entries"])
    assert body["entries"][1]["version"] == "v1.1" and body["entries"][0]["version"] is None
    assert body["entries"][0]["items"] == [{"tag": "new", "zh": "B的内容", "en": ""}]
    assert body["entries"][0]["published_at"].endswith("+00:00")
    assert body["next"] is None and body["latest_id"] == b and a < b


async def test_a_new_user_gets_at_most_three_unread(app, client, auth_headers):
    ids = [await seed(app, f"2026-10-{10 + i:02d}", f"T{i}") for i in range(5)]
    body = await listing(client, auth_headers)
    assert body["unread"] == 3
    flags = {e["id"]: e["is_new"] for e in body["entries"]}
    assert [flags[i] for i in ids] == [False, False, True, True, True]


async def test_a_new_user_with_two_entries_has_two_unread(app, client, auth_headers):
    await seed(app, "2026-10-13", "A")
    await seed(app, "2026-10-14", "B")
    body = await listing(client, auth_headers)
    assert body["unread"] == 2 and all(e["is_new"] for e in body["entries"])


async def test_seen_only_moves_forward_is_idempotent_and_clamped(app, client, auth_headers):
    ids = [await seed(app, f"2026-10-{10 + i:02d}", f"T{i}") for i in range(5)]
    assert await seen(client, auth_headers, ids[4]) == {"unread": 0, "last_seen_id": ids[4]}
    body = await listing(client, auth_headers)
    assert body["unread"] == 0 and not any(e["is_new"] for e in body["entries"])
    sixth = await seed(app, "2026-10-15", "T5")
    body = await listing(client, auth_headers)
    assert body["unread"] == 1 and [e["id"] for e in body["entries"] if e["is_new"]] == [sixth]
    assert await seen(client, auth_headers, ids[0]) == {"unread": 1, "last_seen_id": ids[4]}  # never backwards
    assert await seen(client, auth_headers, sixth) == {"unread": 0, "last_seen_id": sixth}
    assert await seen(client, auth_headers, sixth) == {"unread": 0, "last_seen_id": sixth}  # idempotent
    assert await seen(client, auth_headers, 10_000) == {"unread": 0, "last_seen_id": sixth}  # clamped to the newest published
    seventh = await seed(app, "2026-10-16", "T6")
    assert (await listing(client, auth_headers))["unread"] == 1  # the clamp did not mark a future entry as read
    assert seventh > sixth
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(ChangelogRead))).all()
    assert [(r.last_seen_id) for r in rows] == [sixth]


async def test_seen_never_moves_a_new_user_below_the_first_visit_baseline(app, client, auth_headers):
    ids = [await seed(app, f"2026-10-{10 + i:02d}", f"T{i}") for i in range(5)]
    assert await seen(client, auth_headers, ids[0]) == {"unread": 3, "last_seen_id": ids[1]}  # baseline = 4th newest id


async def test_unread_is_per_user(app, client, auth_headers):
    ids = [await seed(app, f"2026-10-{10 + i:02d}", f"T{i}") for i in range(5)]
    bob = await register(client, "bob")
    await seen(client, auth_headers, ids[4])
    assert (await listing(client, auth_headers))["unread"] == 0
    assert (await listing(client, bob))["unread"] == 3


async def test_seen_validation(client, auth_headers):
    for body in ({}, {"upto_id": 0}, {"upto_id": "x"}, {"upto_id": 1, "extra": 1}, {"upto_id": 2_147_483_648}):
        r = await client.post("/api/changelog/seen", headers=auth_headers, json=body)
        assert r.status_code == 422, body


async def test_cursor_pagination_by_date_then_id(app, client, auth_headers):
    ids = []
    for i in range(25):  # five entries per date, so the cursor must tie-break on id
        ids.append(await seed(app, f"2026-09-{1 + i // 5:02d}", f"T{i:02d}"))
    first = await listing(client, auth_headers)
    assert len(first["entries"]) == 20 and first["next"] is not None and first["unread"] == 3
    second = await listing(client, auth_headers, cursor=first["next"])
    assert len(second["entries"]) == 5 and second["next"] is None
    got = [e["id"] for e in first["entries"] + second["entries"]]
    assert len(set(got)) == 25
    expected = sorted(ids, key=lambda i: (1 + (i - ids[0]) // 5, i), reverse=True)
    assert got == expected
    one = await listing(client, auth_headers, limit=1)
    assert len(one["entries"]) == 1 and one["next"] is not None and one["unread"] == 3 and one["latest_id"] == ids[-1]
    assert one["entries"][0]["id"] == expected[0]


async def test_bad_cursor_and_limit_are_rejected_without_echo(client, auth_headers):
    for cursor in ("abc", "2026-13-45.3", "2026-10-14", "2026-10-14.x", "2026-10-14.1234567890"):
        r = await client.get("/api/changelog", headers=auth_headers, params={"cursor": cursor})
        assert r.status_code == 422 and r.json() == {"error": "Invalid cursor"}, cursor
    for limit in (0, 21, "x"):
        r = await client.get("/api/changelog", headers=auth_headers, params={"limit": limit})
        assert r.status_code == 422, limit


async def test_deleting_a_user_removes_their_read_position(app, client, auth_headers):
    ids = [await seed(app, f"2026-10-{10 + i:02d}", f"T{i}") for i in range(2)]
    bob = await register(client, "bob")
    await seen(client, auth_headers, ids[1])
    await seen(client, bob, ids[1])
    uid = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=h,
                             json={"confirm_username": "alice", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        remaining = [row.user_id for row in (await s.scalars(select(ChangelogRead))).all()]
        assert len(remaining) == 1 and uid not in remaining  # bob's position stays, alice's is gone
        assert await s.get(User, uid) is None
