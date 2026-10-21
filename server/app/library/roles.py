"""句子角色(A–F)与角色显示名的库读写(plan L5 R3–R5)。

- `merge`、`roles_out`、`clean_role`、`clean_name` 是纯函数;`apply` / `apply_catalog` / `sync_catalog_roles` 读写库。
- 读写函数**不提交**,调用方在自己的事务里提交(与 `store.py` 的写函数一致)。
- 角色名与句子一样是用户内容:不进日志、审计、计量、URL;这里不记录任何文字,错误只抛固定的 `ValueError("roles")`。
- 配音(`app/dubbing`)只能导入本模块的角色规则;`library` 不得导入 `dubbing`(tests/test_architecture.py)。
"""
from sqlalchemy import select

from app.library import catalog_store, store
from app.models import CatalogItem, LibraryItem

# PLACEHOLDER limits (plan L5 R3): six role letters at most; a display name is 1..24 characters after space collapse.
ROLE_KEYS = ("A", "B", "C", "D", "E", "F")
MAX_ROLES = 6
NAME_MAX = 24


def clean_role(raw: object) -> str | None:
    """A role letter, upper-cased and trimmed; anything else (including non-strings) is None."""
    if not isinstance(raw, str):
        return None
    value = raw.strip().upper()
    return value if value in ROLE_KEYS else None


def clean_name(raw: object) -> str | None:
    """A role display name: spaces collapsed, 1..24 characters. None when it does not fit (never echoed)."""
    if not isinstance(raw, str):
        return None
    value = " ".join(raw.split())
    return value if 1 <= len(value) <= NAME_MAX else None


def merge(current_names: dict | None, current: dict[int, str | None], *, names: dict | None = None,
          speakers: list[dict] | None = None) -> tuple[dict[str, str], dict[int, str | None]]:
    """Apply one edit to a row's roles. Returns (the new role names, the sentences whose letter changed).

    `current` maps each sentence index to its letter (None = unlabelled). `names` maps a letter to a new name,
    or to None to remove that name. `speakers` is a list of {"idx", "speaker"} (speaker None clears the label).
    A name is kept only while its letter is used by some sentence or was named in this edit (R3). Any problem
    raises ValueError("roles") and nothing is changed."""
    final = dict(current_names or {})
    named: set[str] = set()
    for raw_key, value in (names or {}).items():
        letter = clean_role(raw_key)
        if letter is None:
            raise ValueError("roles")
        if value is None:
            final.pop(letter, None)
        else:
            cleaned = clean_name(value)
            if cleaned is None:
                raise ValueError("roles")
            final[letter] = cleaned
        named.add(letter)
    labels = dict(current)
    changes: dict[int, str | None] = {}
    for entry in speakers or []:
        if not isinstance(entry, dict):
            raise ValueError("roles")
        idx = entry.get("idx")
        if not isinstance(idx, int) or isinstance(idx, bool) or idx not in current:
            raise ValueError("roles")
        raw = entry.get("speaker")
        letter = None if raw is None else clean_role(raw)
        if raw is not None and letter is None:
            raise ValueError("roles")
        labels[idx] = letter
        changes[idx] = letter
    used = {letter for letter in labels.values() if letter}
    kept = {key: value for key, value in sorted(final.items()) if (key in used or key in named) and value}
    if len(kept) > MAX_ROLES:
        raise ValueError("roles")
    return kept, changes


def roles_out(role_names: dict | None, segs: list, *, editable: bool, locked: str | None) -> dict:
    """What the API returns for the roles of one row. `segs` are objects with `idx` and `speaker`."""
    names = [{"key": key, "name": value} for key, value in sorted((role_names or {}).items())]
    speakers = [{"idx": seg.idx, "speaker": seg.speaker} for seg in sorted(segs, key=lambda seg: seg.idx)]
    return {"names": names, "speakers": speakers, "editable": editable, "locked": locked}


async def apply(session, item: LibraryItem, *, names: dict | None = None, speakers: list[dict] | None = None) -> None:
    """Edit the roles of an owned library item (caller commits). A catalog copy is refused by the router, not here."""
    segs = await store.segments_of(session, item.id)
    by_idx = {seg.idx: seg for seg in segs}
    final, changes = merge(item.role_names, {seg.idx: seg.speaker for seg in segs}, names=names, speakers=speakers)
    for idx, letter in changes.items():
        by_idx[idx].speaker = letter
    item.role_names = final or None


async def apply_catalog(session, row: CatalogItem, *, names: dict | None = None,
                        speakers: list[dict] | None = None) -> None:
    """Edit the roles of a curated catalog item (caller commits). Copies follow only through `sync_catalog_roles`."""
    segs = await catalog_store.segments_of(session, row.id)
    by_idx = {seg.idx: seg for seg in segs}
    final, changes = merge(row.role_names, {seg.idx: seg.speaker for seg in segs}, names=names, speakers=speakers)
    for idx, letter in changes.items():
        by_idx[idx].speaker = letter
    row.role_names = final or None


async def sync_catalog_roles(session, catalog_id: str) -> int:
    """Copy the catalog's roles to every existing copy (plan L5 R4). Returns the number of copies.

    The copy's names are replaced as a whole. A sentence takes the catalog's letter only when the same index still has
    the same text: a learner who edited a sentence keeps their copy of it. Other catalog items' copies are not touched.
    Caller commits."""
    row = await catalog_store.get(session, catalog_id)
    if row is None:
        return 0
    source = {seg.idx: seg for seg in await catalog_store.segments_of(session, catalog_id)}
    copies = (await session.scalars(select(LibraryItem).where(LibraryItem.catalog_id == catalog_id))).all()
    for copy in copies:
        copy.role_names = dict(row.role_names) if row.role_names else None
        for seg in await store.segments_of(session, copy.id):
            src = source.get(seg.idx)
            if src is not None and store.same_text(src.text, seg.text):
                seg.speaker = src.speaker
    return len(copies)
