"""智能体三张表与 messages.agent_trace 的 ORM 行为、删除用户时的级联(SQLite 不执行外键级联)。"""
from sqlalchemy import func, select

from app.admin import users_admin
from app.admin.audit import CLI_ACTOR
from app.models import AgentPersona, AgentPersonaReport, AgentUserSettings, Conversation, Message, User, utcnow


async def _users(session, *ids):
    for uid in ids:
        session.add(User(id=uid, username=f"u{uid}", password_hash="x"))
    await session.commit()


async def test_persona_defaults_and_trace_column(app):
    async with app.state.sessionmaker() as s:
        await _users(s, 10000001)
        now = utcnow()
        s.add(AgentPersona(owner_id=10000001, name="Tom", prompt="Be kind.", tools=["lookup"], created_at=now,
                           updated_at=now))
        s.add(Conversation(id="c1", user_id=10000001, name="n", config={}, created_at=now, updated_at=now))
        s.add(Message(id="m1", conversation_id="c1", role="assistant", content="hi", agent_trace={"v": 1, "steps": []},
                      created_at=now))
        await s.commit()
        p = await s.scalar(select(AgentPersona))
        assert (p.intro, p.level, p.style, p.voice, p.prompt_public, p.deep_think, p.disabled_at) == (
            "", "B1", "friendly", None, True, False, None)
        assert len(p.id) == 36
        assert (await s.get(Message, "m1")).agent_trace == {"v": 1, "steps": []}


async def test_deleting_a_user_removes_their_personas_settings_and_reports(app):
    async with app.state.sessionmaker() as s:
        await _users(s, 10000001, 10000002)
        now = utcnow()
        mine = AgentPersona(owner_id=10000001, name="Mine", prompt="x", tools=[], created_at=now, updated_at=now)
        theirs = AgentPersona(owner_id=10000002, name="Theirs", prompt="y", tools=[], created_at=now, updated_at=now)
        s.add_all([mine, theirs, AgentUserSettings(user_id=10000001, data={"show_process": False}, updated_at=now)])
        await s.flush()
        # 2 reports alice's persona; alice reports bob's persona
        s.add_all([AgentPersonaReport(persona_id=mine.id, reporter_id=10000002, reason="spam", created_at=now),
                   AgentPersonaReport(persona_id=theirs.id, reporter_id=10000001, reason="other", created_at=now)])
        await s.commit()
        await users_admin.delete_user(s, CLI_ACTOR, app.state.settings, 10000001, store=app.state.storage,
                                      confirm_username="u10000001", reason="test", now=now)
        assert [p.name for p in (await s.scalars(select(AgentPersona))).all()] == ["Theirs"]
        assert await s.scalar(select(func.count()).select_from(AgentPersonaReport)) == 0
        assert await s.get(AgentUserSettings, 10000001) is None
