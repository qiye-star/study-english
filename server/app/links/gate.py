"""effective(link, user) = links_enabled ∧ link_<key>_enabled ∧ 用户偏好(缺省开)(spec §4.6)。"""
import time
from collections import OrderedDict

from fastapi import Depends, HTTPException, Request

from app.core.deps import current_user, limited_user
from app.links import prefs
from app.links.spec import LINK_KEYS, flag_of
from app.models import User

TTL_SECONDS = 30.0
MAX_USERS = 10_000


class LinkGate:
    def __init__(self, app, *, clock=time.monotonic) -> None:
        self._app = app
        self._clock = clock
        self._cache: OrderedDict[int, tuple[float, dict[str, bool]]] = OrderedDict()

    async def __call__(self, link: str, user_id: int) -> bool:
        settings = self._app.state.settings
        if link not in LINK_KEYS or not settings.links_enabled or not getattr(settings, flag_of(link), False):
            return False
        return (await self.prefs(user_id)).get(link, True)

    async def prefs(self, user_id: int) -> dict[str, bool]:
        now = self._clock()
        hit = self._cache.get(user_id)
        if hit is not None and hit[0] > now:
            self._cache.move_to_end(user_id)
            return hit[1]
        async with self._app.state.sessionmaker() as session:
            mine = await prefs.load(session, user_id)
        self._cache[user_id] = (now + TTL_SECONDS, mine)
        self._cache.move_to_end(user_id)
        while len(self._cache) > MAX_USERS:
            self._cache.popitem(last=False)
        return mine

    def invalidate(self, user_id: int) -> None:
        self._cache.pop(user_id, None)


def require_link(key: str, *, limited: bool = False):
    """联动接口的依赖:对当前用户无效时 404 `Link is off`。写接口用 limited=True(限流)。"""
    dependency = limited_user if limited else current_user

    async def guard(request: Request, user: User = Depends(dependency)) -> User:
        if not await request.app.state.link_gate(key, user.id):
            raise HTTPException(404, "Link is off")
        return user

    return guard
