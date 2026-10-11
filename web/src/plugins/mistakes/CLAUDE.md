# web/src/plugins/mistakes/

联动插件 3 易错词(spec §6.3,车道 L3):生词本页「易错词 · n」入口与 `/links/mistakes` 页。只是一个视图——词条仍是用户生词本 / 词书里那一条,网页不复制、不写生词本。

## What lives here
- `index.ts`:登记 `notebookViews/mistakes.row`(order 10,`link: "mistakes"`)与路由 `/links/mistakes`(懒加载页)
- `mistakes-api.ts`:`MistakeItem`、`MistakesPageData`、`fetchMistakes(api, page, signal?)`、`dismissMistake(api, word)`
- `mistakes-row.tsx`:琥珀图标行,只拉第 1 页取 `total`;失败或 0 显示「暂无」
- `mistakes-page.tsx`:列表(错次数 · 多久前 · 盒子进度点 · `<WordActions>` · 「移出」乐观更新失败回滚)、加载更多、「去拼写练习」
- `i18n/`:`web.links.mistakes.*`(中英键必须完全相同,不用 `_one/_other` 复数键)
- 测试:`mistakes-page.test.tsx`(页面与入口)、`mistakes-contract.test.ts`(对 `server/tests/fixtures/links_mistakes_contract.json`)

## Allowed dependencies
同 `../CLAUDE.md`:`~/lib/*`、`~/components/*`、`~/api/*`、`~/auth/*`、`~/layout/*`、`@renderer/*` 与 `../links/links-api`(`LINKS_SERVER_ERRORS`)。不导入任何 feature。

## Test
`cd web && yarn vitest run src/plugins/mistakes`;测试自己 `import "./index"` 并 `setLinkFlags(...)` 打开本联动(`afterEach` 回到 `ALL_OFF`)。

## Pitfalls
- 服务端规则(什么算错 / 算对)只在 `server/app/links/mistakes.py`;网页不判断。
- 契约字段改名要同时重录服务端夹具(`CONTRACT_UPDATE=1`)。
- 联动关时整个入口与路由都不存在;不要在 vocabulary feature 里加任何易错词代码。
