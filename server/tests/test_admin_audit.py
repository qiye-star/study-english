from sqlalchemy import update

from app.admin.audit import CLI_ACTOR, GENESIS, Actor, listing, record, redact_setting, verify
from app.models import AdminAudit

ROOT = Actor("root", "superadmin", "s1", "203.0.113.5")


async def test_records_chain_and_verify(app):
    async with app.state.sessionmaker() as s:
        a = await record(s, ROOT, "settings.update", target_type="setting", target_id="rate_limit_per_minute",
                         before={"rate_limit_per_minute": 10}, after={"rate_limit_per_minute": 20}, reason="spike")
        b = await record(s, CLI_ACTOR, "auth.unlock", target_type="admin", target_id="ops")
        await s.commit()
        assert a.prev_hash == GENESIS and b.prev_hash == a.hash and len(b.hash) == 64
        assert await verify(s) == (True, None)
        await s.execute(update(AdminAudit).where(AdminAudit.id == a.id).values(summary="tampered"))
        await s.commit()
        assert await verify(s) == (False, a.id)


async def test_listing_filters_and_paginates(app):
    async with app.state.sessionmaker() as s:
        for i in range(3):
            await record(s, ROOT, "room.close", target_type="room", target_id=f"r{i}")
        await record(s, Actor("ops", "operator", "s2", "198.51.100.1"), "user.disable", target_type="user", target_id=1)
        await s.commit()
        page = await listing(s, action="room.close", limit=2)
        assert [r["target_id"] for r in page["items"]] == ["r2", "r1"] and page["next_before_id"]
        page2 = await listing(s, action="room.close", before_id=page["next_before_id"], limit=2)
        assert [r["target_id"] for r in page2["items"]] == ["r0"] and page2["next_before_id"] is None
        assert [r["actor"] for r in (await listing(s, actor="ops"))["items"]] == ["ops"]


def test_redact_setting_masks_secrets_only():
    assert redact_setting("upstream_llm_key", "sk-live", "a1b2c3d4") == {"set": True, "fp": "a1b2c3d4"}
    assert redact_setting("upstream_llm_key", "", "") == {"set": False, "fp": ""}
    assert redact_setting("rate_limit_per_minute", 20, "") == 20


async def test_summary_and_reason_are_truncated(app):
    async with app.state.sessionmaker() as s:
        row = await record(s, ROOT, "x.y", summary="s" * 500, reason="r" * 500)
        assert len(row.summary) == 200 and len(row.reason) == 200
