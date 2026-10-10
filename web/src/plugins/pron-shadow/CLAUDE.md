# web/src/plugins/pron-shadow/

发音弱词 ↔ 跟读(spec §6.4):跟读来源条、今日新词例句、弱词页。F7 只放了 `index.ts` 桩(`export {};`);车道 L4 整体替换本目录并更新本文件。

## What lives here
- `index.ts`:登记本联动的贡献(learningSources / notebookViews + 路由)与 `i18n/`(`web.links.<x>.*`)

## Allowed dependencies
同 `../CLAUDE.md`;feature 只经 `~/features/<x>` 或 `~/features/<x>/register*`。

## Test
`cd web && yarn vitest run src/plugins/pron-shadow`;测试自己 `import "./index"` 并 `setLinkFlags(...)` 打开本联动。

## Pitfalls
- 贡献都写 `link: "<key>"`(联动键用下划线,如 `pron_shadow`);页面与面板 `lazy()`。
