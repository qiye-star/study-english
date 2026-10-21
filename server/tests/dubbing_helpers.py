"""L5 配音测试助手(plan S7–S9):开关设置、直接写库造 ready 条目、造用户。不接触真实上游。"""
from sqlalchemy import select

from app.models import LibraryItem, LibrarySegment, User, utcnow
from tests.library_helpers import library_settings

LLM_BASE = "https://llm.test/v1/chat/completions"


def dubbing_settings(tmp_path, **extra) -> dict:
    return library_settings(tmp_path, **{"dubbing_enabled": True, **extra})


async def make_user(app, uid: int, username: str) -> int:
    async with app.state.sessionmaker() as s:
        s.add(User(id=uid, username=username, password_hash="x"))
        await s.commit()
    return uid


async def user_id_of(app, username: str = "alice") -> int:
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(User.id).where(User.username == username))


async def make_item(app, uid: int, lines, *, status: str = "ready", catalog_id: str | None = None,
                    role_names: dict | None = None, speakers: list | None = None) -> str:
    """A library item with sentences `lines` = [(start_ms, end_ms, text), ...]; `speakers` aligns with `lines`."""
    now = utcnow()
    async with app.state.sessionmaker() as s:
        item = LibraryItem(user_id=uid, kind="audio", source="catalog" if catalog_id else "upload", title="t",
                           status=status, seg_count=len(lines), catalog_id=catalog_id, role_names=role_names,
                           created_at=now, updated_at=now)
        s.add(item)
        await s.flush()
        for i, (start, end, text) in enumerate(lines):
            s.add(LibrarySegment(item_id=item.id, idx=i, start_ms=start, end_ms=end, text=text,
                                 speaker=speakers[i] if speakers else None))
        await s.commit()
        return item.id


def five_lines() -> list[tuple[int, int, str]]:
    return [(0, 900, "Hello there."), (1000, 1900, "How are you?"), (2000, 2900, "I am fine."),
            (3000, 3900, "Good."), (4000, 4900, "Bye.")]
