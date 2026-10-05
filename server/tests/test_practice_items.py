import asyncio
import uuid

import pytest

URL = "/api/practice-items"
TICK = 0.02  # Windows 时钟精度约 15 ms


async def register(client, username):
    r = await client.post("/api/users", json={"username": username, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def add(client, headers, text, source=None):
    body = {"text": text} if source is None else {"text": text, "source": source}
    return await client.post(URL, headers=headers, json=body)


@pytest.mark.parametrize("method,path", [("GET", URL), ("POST", URL), ("DELETE", f"{URL}/x")])
async def test_requires_login(client, method, path):
    assert (await client.request(method, path, json={"text": "x"})).status_code == 401


async def test_create_list_and_delete(client, auth_headers):
    r = await add(client, auth_headers, "  How are   you\ntoday? ", "chat")
    assert r.status_code == 200
    item = r.json()
    uuid.UUID(item["id"])
    assert item["text"] == "How are you today?" and item["source"] == "chat" and item["created_at"].endswith("+00:00")
    assert set(item) == {"id", "text", "source", "created_at"}
    await asyncio.sleep(TICK)
    second = (await add(client, auth_headers, "Second one.")).json()
    assert second["source"] == "manual"
    listed = (await client.get(URL, headers=auth_headers)).json()
    assert [i["id"] for i in listed["practice_items"]] == [second["id"], item["id"]]
    assert listed["page"] == 1 and listed["next"] is None
    r = await client.delete(f"{URL}/{item['id']}", headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"id": item["id"]}
    r = await client.delete(f"{URL}/{item['id']}", headers=auth_headers)
    assert r.status_code == 404 and r.json() == {"error": "Practice item not found"}


async def test_same_text_returns_the_existing_item(client, auth_headers):
    first = (await add(client, auth_headers, "Nice to meet you.", "chat")).json()
    again = await add(client, auth_headers, " Nice  to meet you. ", "grammar")
    assert again.status_code == 200 and again.json() == first
    assert len((await client.get(URL, headers=auth_headers)).json()["practice_items"]) == 1


@pytest.mark.parametrize("body", [{"text": ""}, {"text": "   "}, {"text": "a" * 2001}, {"text": "x", "source": "other"}, {}])
async def test_validation(client, auth_headers, body):
    assert (await client.post(URL, headers=auth_headers, json=body)).status_code == 422


async def test_pagination(client, auth_headers):
    for i in range(3):
        await add(client, auth_headers, f"Sentence {i}.")
        await asyncio.sleep(TICK)
    first = (await client.get(URL, headers=auth_headers, params={"per_page": 2})).json()
    assert [i["text"] for i in first["practice_items"]] == ["Sentence 2.", "Sentence 1."] and first["next"] == 2
    second = (await client.get(URL, headers=auth_headers, params={"per_page": 2, "page": 2})).json()
    assert [i["text"] for i in second["practice_items"]] == ["Sentence 0."] and second["next"] is None
    assert (await client.get(URL, headers=auth_headers, params={"per_page": 51})).status_code == 422


@pytest.mark.parametrize("settings_overrides", [{"max_practice_items": 2}], indirect=True)
async def test_limit_is_per_user_and_dedupe_still_works_when_full(client, auth_headers):
    a = (await add(client, auth_headers, "One.")).json()
    await add(client, auth_headers, "Two.")
    r = await add(client, auth_headers, "Three.")
    assert r.status_code == 429 and r.json() == {"error": "Practice item limit reached"}
    assert (await add(client, auth_headers, "One.")).json() == a
    bob = await register(client, "bob")
    assert (await add(client, bob, "Three.")).status_code == 200


async def test_isolation(client, auth_headers):
    item = (await add(client, auth_headers, "Private.")).json()
    bob = await register(client, "bob")
    assert (await client.get(URL, headers=bob)).json()["practice_items"] == []
    r = await client.delete(f"{URL}/{item['id']}", headers=bob)
    assert r.status_code == 404 and r.json() == {"error": "Practice item not found"}
    bobs = (await add(client, bob, "Private.")).json()
    assert bobs["id"] != item["id"]
