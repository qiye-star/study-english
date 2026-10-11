# web/src/plugins/daily-tasks/

今日任务聚合卡(联动 `daily_tasks`,spec §6.2,计划 L2-2)。

## What lives here
- `index.ts`:导入四个 feature 提供方 `features/{wordbook,practice,chat,rank}/register-daily-tasks.tsx`,登记 `practiceHome/daily-tasks.card`
- `daily-tasks-card.tsx`(`DailyTasksCard`):拉一次 `GET /api/links/today`(失败 → `today=null`),渲染 `<Slot point="dailyTasks" props={{ today }} />`;
  用 `MutationObserver` 数行的 `data-state`,得出「n/m 完成」,没有行时整卡 `hidden`
- `today-api.ts`(`fetchTodayCounts`)、`i18n/`(`web.links.dailyTasks.*`,提供方的文案也在这里)
- 测试:`daily-tasks-card.test.tsx`、`daily-tasks-contract.test.ts`(读 `server/tests/fixtures/links_daily_tasks_contract.json`)

## Allowed dependencies
同 `../CLAUDE.md`;feature 只经 `~/features/<x>/register*`(提供方)。卡片不导入任何 feature 的组件。

## Test
`cd web && yarn vitest run src/plugins/daily-tasks`;测试 `import "./index"` 并 `setLinkFlags(...)` 打开本联动。

## Pitfalls
- 提供方行契约:外层元素带 `data-testid="daily-task-<id>"` 与 `data-state="done"|"todo"`,不可用时返回 `null`(不出行);
  卡片只靠这两个属性计数,提供方不向卡片回报、也不导入插件。
- 行的无障碍名 = 隐藏的 `doneLabel` / `todoLabel`(可见标题与数字 `aria-hidden`),读屏读出「背单词,已完成」。
- 段位提供方用 `loadRankMe`(新成就只返回一次,谁先拉到谁提示),同一 `ApiClient` 30 秒内复用结果。
- 贡献都写 `link: "daily_tasks"`;总开关或本联动关时插槽什么都不渲染、也不发请求(= 今天的练习页)。
