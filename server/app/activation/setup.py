"""把词汇激活装到应用上(main.create_app 调用;测试不跑 lifespan 也能用)。

`require_activation` 是接口依赖:开关关 → 404 `Activation is off`。开关在每个请求上读 `app.state.settings`(热更新)。
"""
from fastapi import Depends, HTTPException, Request

from app.activation import agent_source, usage
from app.activation.indexer import Indexer
from app.activation.indexer import install as indexer_install
from app.core.deps import current_user, limited_user
from app.models import User


def require_activation(*, limited: bool = False):
    dependency = limited_user if limited else current_user

    async def guard(request: Request, user: User = Depends(dependency)) -> User:
        if not request.app.state.settings.activation_enabled:
            raise HTTPException(404, "Activation is off")
        return user

    return guard


def install(app) -> None:
    """Subscriptions for usage counting (chat, realtime, shadow) and the sentence index (library ready).
    The agents source is added by a later task of the L4 plan. Every subscription carries flag `activation_enabled`."""
    app.state.activation_indexer = Indexer(app)
    usage.install(app, app.state.learning_bus)
    indexer_install(app, app.state.learning_bus)
    agent_source.install(app)  # needs runtime(app): main.create_app calls this after the agents runtime is built
