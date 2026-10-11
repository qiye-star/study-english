"""Tutor session delete cascades (R-T7): deleting a conversation / user also deletes tutor sessions on SQLite."""
import uuid

from sqlalchemy import func, select

from app.models import AgentTutorSession, utcnow


async def _add_session(app, user_id: int, conversation_id: str) -> None:
    async with app.state.sessionmaker() as s:
        s.add(AgentTutorSession(user_id=user_id, conversation_id=conversation_id, persona_id="builtin:coach",
                                client_start_id=str(uuid.uuid4()), status="active", goal={}, state={},
                                created_at=utcnow(), updated_at=utcnow()))
        await s.commit()


async def _count(app) -> int:
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(func.count()).select_from(AgentTutorSession))


async def test_deleting_a_conversation_deletes_its_tutor_sessions(app, client, auth_headers):
    cid = (await client.post("/api/conversations", json={"name": "t"}, headers=auth_headers)).json()["id"]
    uid = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    await _add_session(app, uid, cid)
    assert await _count(app) == 1
    r = await client.delete(f"/api/conversations/{cid}", headers=auth_headers)
    assert r.status_code < 300, r.text
    assert await _count(app) == 0


def test_delete_user_covers_tutor_sessions():
    from app.admin import users_admin
    assert (AgentTutorSession, "user_id") in users_admin.USER_ROWS
