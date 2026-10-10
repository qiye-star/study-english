"""把联动装到应用上(main.create_app 调用;测试不跑 lifespan 也能用)。"""
from sqlalchemy.ext.asyncio import AsyncSession

from app.links import prefs
from app.links.gate import LinkGate
from app.links.registry import LINKS


def install(app) -> None:
    bus = app.state.learning_bus
    gate = LinkGate(app)
    app.state.link_gate = gate
    bus.set_gate(gate)
    for spec in LINKS:
        if spec.install is not None:
            spec.install(app, bus)


async def config_out(app, session: AsyncSession, user_id: int) -> dict:
    """GET /api/links/config 与 PUT /api/links/prefs 的响应(spec §7.2):每个联动的全局开关、用户偏好与有效值。"""
    settings = app.state.settings
    mine = await prefs.load(session, user_id)
    out = []
    for spec in LINKS:
        on = bool(getattr(settings, spec.flag, False))
        user = mine.get(spec.key, True)
        out.append({"key": spec.key, "global": on, "user": user, "effective": bool(settings.links_enabled and on and user)})
    return {"enabled": bool(settings.links_enabled), "links": out}
