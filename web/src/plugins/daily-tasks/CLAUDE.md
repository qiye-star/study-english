# web/src/plugins/daily-tasks/

今日任务聚合卡(spec §6.2)。F7 只放了 `index.ts` 桩(`export {};`);车道 L2 整体替换本目录并更新本文件。

## What lives here
- `index.ts`:登记本联动的贡献(practiceHome / dailyTasks)与 `i18n/`(`web.links.<x>.*`)

## Allowed dependencies
同 `../CLAUDE.md`;feature 只经 `~/features/<x>` 或 `~/features/<x>/register*`。

## Test
`cd web && yarn vitest run src/plugins/daily-tasks`;测试自己 `import "./index"` 并 `setLinkFlags(...)` 打开本联动。

## Pitfalls
- 贡献都写 `link: "<key>"`(联动键用下划线,如 `pron_shadow`);页面与面板 `lazy()`。
