"""删用户 = 删其全部库文件与行(spec §4「显式删除」、§13);别人的条目不动。"""
import pytest
from sqlalchemy import func, select

from app.library import paths
from app.models import LibraryAttempt, LibraryItem, LibrarySegment
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as
from tests.library_helpers import SRT, enable, fake_media, library_settings, process, upload, use_fakes
from tests.test_admin_api import register


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, **library_settings(tmp_path)}


async def test_deleting_a_user_removes_their_library_rows_and_files(app, client, monkeypatch):
    enable(monkeypatch)
    use_fakes(app)
    dora, dh = await register(client, "dora")
    erin, eh = await register(client, "erin")
    mine = await upload(client, dh, fake_media(), subs=SRT)
    staged = await upload(client, dh, fake_media(), complete=False)
    theirs = await upload(client, eh, fake_media(), subs=SRT)
    await process(app)
    await process(app)
    async with app.state.sessionmaker() as s:
        s.add(LibraryAttempt(user_id=dora, item_id=mine, seg_idx=0, assessment_id=None, text_hash="0" * 16, score=1))
        await s.commit()
    data_dir = app.state.library.deps.data_dir
    assert paths.item_dir(data_dir, dora, mine).is_dir() and paths.tmp_dir(data_dir, staged).is_dir()
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{dora}", headers=h,
                             json={"confirm_username": "dora", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(LibraryItem).where(LibraryItem.user_id == dora)) == 0
        assert await s.scalar(select(func.count()).select_from(LibraryAttempt)) == 0
        assert await s.scalar(select(func.count()).select_from(LibrarySegment).where(
            LibrarySegment.item_id == mine)) == 0
        assert (await s.get(LibraryItem, theirs)).status == "ready"
    assert not (data_dir / "library" / str(dora)).exists() and not paths.tmp_dir(data_dir, staged).exists()
    assert paths.item_dir(data_dir, erin, theirs).is_dir()
