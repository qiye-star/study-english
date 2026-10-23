# web/src/plugins/

组合层(spec `docs/superpowers/specs/2026-10-11-learning-links-design.md` §8):把各 feature 的 `register*.ts(x)` 与联动自己的界面
登记进 `~/lib/extension-points`。`index.ts` 一行一个插件:删一行 = 删一个联动。

## What lives here
- `index.ts`(由 `main.tsx` 导入一次)、`core.ts`(核心贡献 `wordActions/vocabulary.add`、`selectionActions/chat.read-aloud`、`practiceHeaderActions/changelog.entry`(更新日志入口,懒加载);`test/setup.ts` 只导入它)
- `links/`(旗标加载 `appEffects/links.config`、「我的」一行 `meRows/links.row`、设置页路由 `/me/links`、`LINKS_SERVER_ERRORS`)
- 联动插件:`word-actions/`(「更多」按钮与「单词操作」面板)、`daily-tasks/`(练习页「今日任务」卡)、`mistakes/`(生词本「易错词」
  与 `/links/mistakes`)、`pron-shadow/`(跟读来源条、今日新词例句、`/links/weak-words`)、`chat-words/`(今日任务一行与词卡小标);
  段位点来源只在服务端(`rank_sources` 没有网页入口)
- `links-matrix.test.tsx`:全关只剩核心贡献、全开每个点的贡献、只开一个不带出别的联动

## Allowed dependencies
`lib/`、`api/`、`components/`、`layout/`、`auth/`、`settings/`、`i18n/`、`@renderer/*`;feature 只经 `~/features/<x>`(index)或
`~/features/<x>/register*`。只有 `main.tsx` 导入本目录(`test/setup.ts` 可导入 `core`)——`src/architecture.test.ts` 强制。

## Extension-point API(`~/lib/extension-points`)
- `contribute({ point, id, order?, link?, requiresLinks?, component })`:`link` = 该联动有效才可见;`requiresLinks` = 总开关开才可见;
  都不写 = 核心贡献(永远可见)。同一点 id 重复会抛错;按 `order` 再按 `id` 排序。
- `contributeRoute({ id, path, link? | requiresLinks?, component })`:app.tsx 把全部路由挂在 AppShell 下,由 `LinkRoute`
  按旗标渲染;旗标未到(仍是 `ALL_OFF` 本身)时什么都不渲染,到了但不可见则回首页 `HOME_PATH`(`/chat`)。
- 点与 props:`wordActions`(`WordActionProps`)、`wordActionsMenu`(+ `close`)、`dailyTasks`(`{ today }`)、`practiceHome`、
  `learningSources`(`{ pick }`)、`wordDetailSections`(`{ word }`,词卡未遮罩时才渲染)、`notebookViews`、`meRows`、`appEffects`、
  `selectionActions`(`{ text, testId }`,选词操作条;核心贡献 `chat.read-aloud` = 朗读)、`practiceHeaderActions`(无 props,练习页顶栏「练习清单」图标左边;核心贡献 `changelog.entry`)。

## Test
`cd web && yarn vitest run src/plugins`;联动测试自己导入所需插件并 `setLinkFlags(...)`;`test/setup.ts` 的 `afterEach` 已统一复位为全关。
`test/setup.ts` 只给依赖图里有 `~/lib/extension-points-react` 的测试文件加载核心贡献(`plugins/core`);纯逻辑测试里插槽是空的。

## Pitfalls
- 注册文件在启动时执行:只导入轻组件,重组件 / 页面用 `lazy()` + `Suspense`(见 `links/index.ts`);主包增长有验收上限(≤ 8 kB gzip)。
- 联动文案放各插件 `i18n/`(键 `web.links.<x>.*`),即使由 feature 的注册文件渲染;中英两份键一致。
- 旗标未加载前全关;任何贡献都不能假设旗标已到。服务端错误用 `LINKS_SERVER_ERRORS` 翻译。
- 液态玻璃(计划 2026-10-15-liquid-glass L10):插件 UI 跟随共享的 `LQ_*` 映射(`~/components/liquid`),只追加 `liquid:` 类,不再用色调;分数用 `ScoreDot` + 墨色数字。
