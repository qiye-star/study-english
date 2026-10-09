import json
import logging
import os
from functools import partial
from pathlib import Path

from app.models import RoomSummary, utcnow
from app.routers import rooms as rooms_router
from app.routers import rooms_summary
from tests.test_rooms_ws import login, make_client
from tests.test_web_contract import shape

FIXTURE = Path(__file__).parent / "fixtures" / "rooms_v2_summary_contract.json"
SUMMARY = json.dumps({"overview_zh": "聊了面馆。", "words": [{"en": "noodles", "zh": "面条", "example": "Nice noodles."}],
                      "fixes": [{"seq": 1, "better": "I went there yesterday.", "note_zh": "过去时"}]})


def _say(client, rt, room_id, user_id, n):
    for i in range(n):
        client.portal.call(partial(rt.store.append, room_id, lane="public", sender_kind="user",
                                   sender_id=user_id, kind="text", text=f"I go there {i}", now=utcnow()))


def test_summary_after_close_is_member_only(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch, rooms_summary_enabled=True)
    try:
        rt = rooms_router.runtime(app)
        assert any(getattr(f, "__module__", "") == rooms_summary.__name__ for f in rt.close_listeners)

        async def complete(messages, max_tokens, temperature):
            return SUMMARY

        rt.summary_runner.complete = complete
        alice, alice_id = login(client, "alice")
        bob, _ = login(client, "bob")
        room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        r = client.get(f"/api/rooms/{room['id']}/summary", headers=alice)
        assert r.status_code == 409 and r.json() == {"error": "Room is still open"}
        _say(client, rt, room["id"], alice_id, 6)
        client.post(f"/api/rooms/{room['id']}/close", headers=alice)
        client.portal.call(rt.hub.drain)
        body = client.get(f"/api/rooms/{room['id']}/summary", headers=alice).json()
        assert body["summary"]["status"] == "done" and body["summary"]["reason"] is None
        assert body["summary"]["my_fixes"][0]["original"] == "I go there 0"
        assert body["summary"]["words"][0]["en"] == "noodles"
        assert client.get(f"/api/rooms/{room['id']}/summary", headers=bob).status_code == 404  # never a member
        assert client.post(f"/api/rooms/{room['id']}/summary/retry", headers=alice).status_code == 409
        if os.environ.get("CONTRACT_UPDATE"):
            FIXTURE.write_text(json.dumps({"http": {"summary": body}}, ensure_ascii=False, indent=2) + "\n",
                               encoding="utf-8")
        contract = json.loads(FIXTURE.read_text(encoding="utf-8"))
        assert shape(body) == shape(contract["http"]["summary"])
    finally:
        client.__exit__(None, None, None)


def test_fixes_only_for_their_author(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch, rooms_summary_enabled=True)
    try:
        rt = rooms_router.runtime(app)
        alice, alice_id = login(client, "alice")
        bob, bob_id = login(client, "bob")
        room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
        seqs = []
        for i in range(6):
            m = client.portal.call(partial(rt.store.append, room["id"], lane="public", sender_kind="user",
                                           sender_id=alice_id if i else bob_id, kind="text", text=f"hi {i}",
                                           now=utcnow()))
            seqs.append(m.seq)

        async def complete_bob(messages, max_tokens, temperature):
            return SUMMARY.replace('"seq": 1', f'"seq": {seqs[0]}')

        rt.summary_runner.complete = complete_bob
        client.post(f"/api/rooms/{room['id']}/close", headers=alice)
        client.portal.call(rt.hub.drain)
        mine = client.get(f"/api/rooms/{room['id']}/summary", headers=bob).json()["summary"]
        theirs = client.get(f"/api/rooms/{room['id']}/summary", headers=alice).json()["summary"]
        assert [f["original"] for f in mine["my_fixes"]] == ["hi 0"] and theirs["my_fixes"] == []
        assert mine["overview_zh"] == theirs["overview_zh"] == "聊了面馆。"
    finally:
        client.__exit__(None, None, None)


def test_retry_after_failure_and_disabled_skip(tmp_path, monkeypatch, caplog):
    caplog.set_level(logging.INFO, logger="app")
    app, client = make_client(tmp_path, monkeypatch, rooms_summary_enabled=True)
    try:
        rt = rooms_router.runtime(app)
        state = {"fail": True}

        async def complete(messages, max_tokens, temperature):
            if state["fail"]:
                raise RuntimeError("down")
            return SUMMARY

        rt.summary_runner.complete = complete
        alice, alice_id = login(client, "alice")
        room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        _say(client, rt, room["id"], alice_id, 6)
        assert client.post(f"/api/rooms/{room['id']}/summary/retry", headers=alice).json() == {
            "error": "Cannot retry"}
        client.post(f"/api/rooms/{room['id']}/close", headers=alice)
        client.portal.call(rt.hub.drain)
        failed = client.get(f"/api/rooms/{room['id']}/summary", headers=alice).json()["summary"]
        assert failed["status"] == "failed" and failed["reason"] == "upstream" and failed["my_fixes"] == []
        state["fail"] = False
        r = client.post(f"/api/rooms/{room['id']}/summary/retry", headers=alice)
        assert r.status_code == 200 and r.json()["summary"]["status"] == "pending"
        client.portal.call(rt.hub.drain)
        assert client.get(f"/api/rooms/{room['id']}/summary", headers=alice).json()["summary"]["status"] == "done"
        assert client.post(f"/api/rooms/{room['id']}/summary/retry", headers=alice).status_code == 409
        assert "I go there" not in caplog.text and "面馆" not in caplog.text

        # switched off: closing a room records skipped(disabled); stored summaries stay readable
        app.state.settings = app.state.settings.model_copy(update={"rooms_summary_enabled": False})
        other = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        client.post(f"/api/rooms/{other['id']}/close", headers=alice)
        client.portal.call(rt.hub.drain)
        skipped = client.get(f"/api/rooms/{other['id']}/summary", headers=alice).json()["summary"]
        assert skipped["status"] == "skipped" and skipped["reason"] == "disabled"
        assert client.get(f"/api/rooms/{room['id']}/summary", headers=alice).json()["summary"]["status"] == "done"
    finally:
        client.__exit__(None, None, None)


def test_none_and_startup_requeue(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch, rooms_summary_enabled=True)
    try:
        rt = rooms_router.runtime(app)

        async def complete(messages, max_tokens, temperature):
            return SUMMARY

        rt.summary_runner.complete = complete
        alice, alice_id = login(client, "alice")
        room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        _say(client, rt, room["id"], alice_id, 6)
        rt.close_listeners.clear()  # simulate a restart before the close listener ran
        client.post(f"/api/rooms/{room['id']}/close", headers=alice)
        client.portal.call(rt.hub.drain)
        assert client.get(f"/api/rooms/{room['id']}/summary", headers=alice).json() == {"summary": {"status": "none"}}

        async def interrupted():
            async with app.state.sessionmaker() as s:
                s.add(RoomSummary(room_id=room["id"], status="pending", attempts=1, created_at=utcnow()))
                await s.commit()

        client.portal.call(interrupted)
        assert len(rt.startup_listeners) == 1
        client.portal.call(rt.startup_listeners[0], rt)
        client.portal.call(rt.hub.drain)
        done = client.get(f"/api/rooms/{room['id']}/summary", headers=alice).json()["summary"]
        assert done["status"] == "done" and done["finished_at"] is not None
    finally:
        client.__exit__(None, None, None)


def test_my_rooms_carry_the_summary_status(tmp_path, monkeypatch):
    """Spec §6.1 entry: ended rows in 「我的房间」 show the summary as a subtitle, so /mine carries its status."""
    app, client = make_client(tmp_path, monkeypatch, rooms_summary_enabled=True)
    try:
        rt = rooms_router.runtime(app)

        async def complete(messages, max_tokens, temperature):
            return SUMMARY

        rt.summary_runner.complete = complete
        alice, alice_id = login(client, "alice")
        talked = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        _say(client, rt, talked["id"], alice_id, 6)
        client.post(f"/api/rooms/{talked['id']}/close", headers=alice)
        quiet = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        client.post(f"/api/rooms/{quiet['id']}/close", headers=alice)
        client.portal.call(rt.hub.drain)
        live = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        rows = {r["id"]: r for r in client.get("/api/rooms/mine", headers=alice).json()["rooms"]}
        assert rows[talked["id"]]["summary_status"] == "done"
        assert rows[quiet["id"]]["summary_status"] == "skipped"
        assert rows[live["id"]]["summary_status"] is None  # open rooms have no summary yet
    finally:
        client.__exit__(None, None, None)
