# web/src/features/changelog/

更新日志(spec `docs/superpowers/specs/2026-10-14-changelog-design.md`;plan `docs/superpowers/plans/2026-10-14-changelog.md`):练习页顶栏入口 + 整页 `/practice/changelog`。

## What lives here
- **主包(很小)**:`index.ts`(只导出 `ChangelogPage`)、`lazy-pages.tsx`(懒加载页面包装)、`register.tsx`(扩展点 `practiceHeaderActions` 的核心贡献 `changelog.entry`,懒加载入口;只被 `plugins/core.ts` 导入)。
- **懒加载块**:`changelog-entry.tsx`(星花图标、红点、提示环、一次性小提示)、`changelog-page.tsx` + `entry-card.tsx` + `use-changelog-list.ts` + `use-near-end.ts`、`unread-store.ts`(内存里的未读数,按 api 实例 + 用户 id 分区)、`use-unread.ts`、`use-one-time-hint.ts` + `hint-pref.ts`、`api.ts`(接口与防御性解析)、`entries.ts`(月份分组 / 类型筛选 / 折叠 / 日期格式)、`locales.ts` + `locales/`(文案,不在 eager 的 `i18n/` 里)、`changelog.css`(提示环、气泡、跟读库标签色)。
- 契约:`changelog-contract.test.ts` 读 `server/tests/fixtures/changelog_contract.json`。

## Allowed dependencies
`lib/`、`api/`、`components/`、`layout/`、`auth/`、`i18n/`、`@renderer/*`。**不导入任何别的 feature**(`register.tsx` 尤其不行);练习页不导入本 feature,而是渲染扩展点插槽。

## Test
`cd web && yarn vitest run src/features/changelog`(懒加载块首次编译慢)。

## Pitfalls
- 主包守卫:`changelog-lazy.test.ts`;不要在 `index.ts` / `lazy-pages.tsx` / `register.tsx` 里静态导入页面、入口、api、store、文案或样式。
- 文案键 `web.changelog.*`,中英两份键与占位符一致(`locales.test.ts`);英文复数用 `_one/_other`(中文也写两个)。
- 取文用 `pickText(i18n.language, zh, en)`:英文为空时回退中文(D4)。
- 未读 store 按「api + 用户 id」分区;`AuthProvider` 的 api 在登出 / 登录之间是同一个对象,所以不能只按 api。
- 「新」角标来自加载时服务端给的 `is_new`,调完 `seen`(`SEEN_DELAY_MS` = 1 秒后)之后本次访问内不消失;离线缓存(`kv-cache` 键 `changelog:v1:first-page`)一律当已读(没有角标、不报 `seen`)。
- 提示的「已显示」在 `CHANGELOG_PREFS_KEY`(`lib/storage.ts`,`enjoy-web.changelog.prefs`),退出登录由 `auth/device-data.ts` 清除;提示可见 `HINT_VISIBLE_MS` = 8 秒。
- 真机行为未验证:见 `docs/superpowers/plans/2026-10-14-changelog-device-checklist.md`。
