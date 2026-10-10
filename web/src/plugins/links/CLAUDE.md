# web/src/plugins/links/

学习联动的公共部分(spec §7.2、§8.3):每用户旗标加载、「我的 → 学习联动」设置页与入口行。

## What lives here
- `links-api.ts`(`LinksConfig`、`LinkItem`、`fetchLinksConfig`、`putLinkPref`、`LINKS_SERVER_ERRORS`)
- `links-config.tsx`(`LinksConfigLoader`:`appEffects` 贡献,登录后拉一次 `/api/links/config`,失败保持全关,卸载复位)
- `links-settings-page.tsx`(六个 `role="switch"`,管理员关闭的置灰;乐观更新、失败回滚 + toast;懒加载)
- `links-me-row.tsx`(`meRows` 贡献,`requiresLinks`)、`index.ts`(登记)、`i18n/`(`web.links.names|desc|settings|errors.*`)

## Allowed dependencies
同 `plugins/CLAUDE.md`;不导入任何 feature。

## Test
`cd web && yarn vitest run src/plugins/links`(含 `links-contract.test.ts`,读 `server/tests/fixtures/links_contract.json`)。

## Pitfalls
- 设置页保存成功后用服务端返回的配置 `setLinkFlags(flagsFromConfig(...))`,其他插槽立即跟着变。
- 其他联动插件的错误文案键也放在本目录 `errors` 下(共享表 `LINKS_SERVER_ERRORS`)。
