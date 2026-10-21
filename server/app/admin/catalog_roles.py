"""精选库的角色标注(plan L5 S10 / R4、R7、R21):管理端读写目录条目的角色,保存后同步到所有已有副本;智能建议只返回草稿。

审计只记 id、动作与数字(`catalog.roles.edit` `{lines, roles, copies}`、`catalog.roles.suggest` `{lines}`);角色名、句子与
模型回复不进审计、日志、错误或 URL。已发布的目录条目可以改角色(角色不改文字,R4.4)。
"""
from app.admin import audit
from app.admin.catalog_admin import CatalogAdminError, get_row
from app.library import catalog_store, roles, roles_ai
from app.library.ai import AiUnavailable
from app.models import utcnow


async def get_roles(session, catalog_id: str) -> dict:
    row = await get_row(session, catalog_id)
    segs = await catalog_store.segments_of(session, row.id)
    return roles.roles_out(row.role_names, segs, editable=True, locked=None)


async def put_roles(session, actor, catalog_id: str, *, names: dict, speakers: list[dict]) -> dict:
    """Save the catalog's roles, copy them to every existing copy (R4.2), audit the numbers, commit."""
    row = await get_row(session, catalog_id)
    if row.status != "ready":
        raise CatalogAdminError(409, "Item is not ready")
    try:
        await roles.apply_catalog(session, row, names=names, speakers=speakers)
    except ValueError:
        raise CatalogAdminError(400, "Invalid roles") from None
    copies = await roles.sync_catalog_roles(session, row.id)
    segs = await catalog_store.segments_of(session, row.id)
    labelled = sum(1 for seg in segs if seg.speaker)
    await audit.record(session, actor, "catalog.roles.edit", target_type="catalog_item", target_id=row.id,
                       after={"lines": labelled, "roles": len(row.role_names or {}), "copies": copies})
    await session.commit()
    return {**roles.roles_out(row.role_names, segs, editable=True, locked=None), "copies": copies}


async def suggest(session, app, actor, catalog_id: str, *, seg_from: int, seg_to: int) -> dict:
    """Draft labels for a run of at most ADMIN_SUGGEST_MAX_LINES sentences (R7). Nothing is saved; the admin saves with PUT."""
    row = await get_row(session, catalog_id)
    if row.status != "ready":
        raise CatalogAdminError(409, "Item is not ready")
    segs = await catalog_store.segments_of(session, row.id)
    if not 0 <= seg_from <= seg_to < len(segs):
        raise CatalogAdminError(400, "Invalid clip")
    if seg_to - seg_from + 1 > roles_ai.ADMIN_SUGGEST_MAX_LINES:
        raise CatalogAdminError(400, "Too many sentences")
    chosen = segs[seg_from:seg_to + 1]
    try:
        out = await roles_ai.suggest_catalog(session, app.state.http, app.state.settings, catalog_id=row.id,
                                             texts=[seg.text for seg in chosen], now=utcnow())
    except AiUnavailable as e:
        if e.kind == "global_cap":
            raise CatalogAdminError(429, "AI is busy today") from None
        raise CatalogAdminError(503, "AI is unavailable") from None
    await audit.record(session, actor, "catalog.roles.suggest", target_type="catalog_item", target_id=row.id,
                       after={"lines": len(chosen)})
    await session.commit()
    return {"speakers": [{"idx": seg_from + position, "speaker": letter} for position, letter in sorted(out.items())]}
