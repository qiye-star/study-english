"""段位规则的读取与进程内缓存(管理后台 v2 spec §5.2)。草稿与发布在 app/admin/rank_rules_admin.py。

`rank_rules(app)` 懒建缓存并注册 `on_revision(app, "rank_rules", cache.invalidate)`:任何进程发布新版本都会
bump config_revisions['rank_rules'],修订号轮询随后让缓存失效。未发布任何版本时用 v0 = rules_from_settings
(每次按当前生效设置推出,不缓存,所以 rank_* 设置热更新立即可见)。"""
from collections import OrderedDict

from sqlalchemy import select

from app.core.runtime_settings import on_revision
from app.models import RankRuleSet
from app.rank.rules import RankRules, rules_from_json, rules_from_settings

VERSION_CACHE = 8


async def load_published(session) -> tuple[int | None, dict | None]:
    row = await session.scalar(select(RankRuleSet).where(RankRuleSet.status == "published")
                               .order_by(RankRuleSet.version.desc()).limit(1))
    return (row.version, row.rules) if row else (None, None)


async def load_version(session, version: int) -> dict | None:
    row = await session.scalar(select(RankRuleSet).where(RankRuleSet.version == version))
    return row.rules if row else None


class RulesCache:
    def __init__(self, sessionmaker, settings_getter):
        self._sm, self._settings = sessionmaker, settings_getter
        self._current: tuple[int, RankRules] | None = None
        self._loaded = False
        self._versions: OrderedDict[int, RankRules] = OrderedDict()

    def invalidate(self) -> None:
        self._current, self._loaded = None, False

    def v0(self) -> RankRules:
        return rules_from_settings(self._settings())

    async def current(self) -> tuple[int | None, RankRules]:
        if not self._loaded:
            async with self._sm() as s:
                version, data = await load_published(s)
            self._current = (version, rules_from_json(data)) if version is not None else None
            self._loaded = True
        if self._current is None:
            return None, self.v0()
        return self._current

    async def for_version(self, version: int | None) -> RankRules:
        """Rules a match was pinned to (None = v0). Published versions are immutable, so they cache forever (LRU)."""
        if version is None:
            return self.v0()
        if version not in self._versions:
            async with self._sm() as s:
                data = await load_version(s, version)
            if data is None:
                raise KeyError(version)
            self._versions[version] = rules_from_json(data)
            while len(self._versions) > VERSION_CACHE:
                self._versions.popitem(last=False)
        self._versions.move_to_end(version)
        return self._versions[version]


def rank_rules(app) -> RulesCache:
    cache = getattr(app.state, "rank_rules", None)
    if cache is None:
        cache = RulesCache(app.state.sessionmaker, lambda: app.state.settings)
        app.state.rank_rules = cache
        on_revision(app, "rank_rules", cache.invalidate)
    return cache
