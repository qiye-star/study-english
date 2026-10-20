"""人机验证的防重放认领与清理(计划 S6;spec §5、R-C7、R-C22)。"""
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import func, select

from app.admin import housekeeping
from app.models import CaptchaReplay
from app.services import captcha_replay

SIG = "c" * 64
NOW = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)
ROOT = Path(__file__).resolve().parent.parent


async def _count(s) -> int:
    return await s.scalar(select(func.count()).select_from(CaptchaReplay))


async def test_first_claim_wins_second_loses(app):
    async with app.state.sessionmaker() as s:
        assert await captcha_replay.claim(s, SIG, NOW + timedelta(minutes=5), NOW) is True
        await s.commit()
    async with app.state.sessionmaker() as s:
        assert await captcha_replay.claim(s, SIG, NOW + timedelta(minutes=5), NOW) is False
        await s.commit()
        assert await _count(s) == 1


async def test_claim_does_not_commit(app):
    async with app.state.sessionmaker() as s:
        assert await captcha_replay.claim(s, SIG, NOW + timedelta(minutes=5), NOW) is True
        await s.rollback()  # the caller owns the commit (R-C22): without it the claim disappears
        assert await _count(s) == 0
        assert await captcha_replay.claim(s, SIG, NOW + timedelta(minutes=5), NOW) is True
        await s.commit()  # once the caller commits, the row is there
        assert await _count(s) == 1


async def test_claim_does_not_break_the_session(app):
    async with app.state.sessionmaker() as s:
        await captcha_replay.claim(s, SIG, NOW + timedelta(minutes=5), NOW)
        await s.commit()
    async with app.state.sessionmaker() as s:
        assert await captcha_replay.claim(s, SIG, NOW + timedelta(minutes=5), NOW) is False
        assert await s.scalar(select(1)) == 1  # a conflict is not an error: no rollback needed


async def test_purge_removes_only_expired(app):
    async with app.state.sessionmaker() as s:
        s.add_all([
            CaptchaReplay(signature="1" * 64, expires_at=NOW - timedelta(seconds=1)),
            CaptchaReplay(signature="2" * 64, expires_at=NOW),
            CaptchaReplay(signature="3" * 64, expires_at=NOW + timedelta(hours=1)),
        ])
        await s.commit()
    async with app.state.sessionmaker() as s:
        assert await captcha_replay.purge(s, NOW) == 1
        await s.commit()
        left = {r.signature for r in (await s.scalars(select(CaptchaReplay))).all()}
    assert left == {"2" * 64, "3" * 64}  # expires_at < now: the row that expires exactly now stays


async def test_housekeeping_purges_captcha_replays(app):
    async with app.state.sessionmaker() as s:
        s.add(CaptchaReplay(signature="4" * 64, expires_at=NOW - timedelta(minutes=1)))
        await s.commit()
    async with app.state.sessionmaker() as s:
        counts = await housekeeping.purge_expired(s, NOW)
        await s.commit()
    assert counts["captcha_replays"] == 1


def test_service_reads_no_app_state():
    source = (ROOT / "app" / "services" / "captcha_replay.py").read_text(encoding="utf-8")
    for word in ("app.state", "request", "settings", "logging", "logger"):
        assert word not in source, word

