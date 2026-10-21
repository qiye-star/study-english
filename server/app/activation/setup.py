"""把词汇激活装到应用上(main.create_app 调用;测试不跑 lifespan 也能用)。

`require_activation` 是接口依赖:开关关 → 404 `Activation is off`。开关在每个请求上读 `app.state.settings`(热更新)。
"""
from fastapi import Depends, HTTPException, Request

from app.activation import usage
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
    """Subscriptions for usage counting (chat, realtime, shadow). The sentence indexer and the agents source
    are added by later tasks of the L4 plan. Every subscription carries flag `activation_enabled`."""
    usage.install(app, app.state.learning_bus)
