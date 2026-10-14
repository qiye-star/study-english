# 精选库 · 网页(车道 W)· 结果

- 日期:2026-10-14 · 分支 `feat/curated-cl-web` · 计划 `2026-10-14-curated-library-web.md`(Task 0–4;Task 0 设计稿 `docs/superpowers/design/curated-library-v1/mockup.html` 早已存在)
- 起因:站长反馈「跟读库里没有精选入口」(用户侧网页部分还没做)。站长要求直接实现,**设计稿闸门视为已通过**,并对设计稿的开放问题给出下列裁定(优先于计划正文)。
- INDEX 的名字、路由、形状**未改动**;已对照真实服务端核对(`server/app/routers/library_catalog.py`、`catalog_store.public_out`、`routers/library.py` 的 `config.catalog`、`errors.py`):`CatalogCard` 十个键、`{item, created}`、`config.catalog = library_available ∧ library_catalog_enabled`、三条错误文本都与计划类型一致,契约夹具键 `catalog_list / catalog_add / catalog_add_again` 已被契约测试覆盖。

## 站长裁定(设计稿开放点)

1. 分段文案「我的素材 / 精选」(不用「我的」,与底栏同名)。
2. ≤ 390 px 用紧凑行卡(小封面在左、文字在右);≥ 430 px 才 2 列(设计稿的做法)。CSS 用 `@media (min-width: 430px)`。
3. 徽标与颜色照设计稿:级别淡蓝;副本「精选」徽标中性玻璃 + 蓝色小星;许可说明 `ink-2` 80% 不透明,不用 `ink-3`。
4. 添加遇到 404(条目已下架):吐司(沿用 `catalogNotFound`「这条精选素材已下架。」)并立刻把卡片从列表去掉(`useCatalog.add`)。
5. 删除副本的确认有自己的正文(一个额外文案键 `catalog.deleteCopyBody`,取代计划里的 `deleteCopyNote` 补句)。
6. 副本完全不显示 ⋯ 按钮。
7. 播放页有封面的音频:16:9。
8. 「正在添加」保持主按钮蓝色(`aria-busy`,禁用但不变灰)。

## 已做

| 任务 | 提交主题 |
|---|---|
| 1 | `feat(web): catalog API and hook` |
| 2 | `feat(web): featured tab in the library` |
| 3 | `feat(web): featured copies in my library and the player` |
| 4 | `docs: featured library notes for the web app` + `fix(admin): label catalog copies in the library page source column` |

测试(仅定向):`cd web && yarn vitest run src/features/library src/architecture.test.ts`:见下「验证」。`yarn web:typecheck`(根目录)与管理端 `yarn typecheck` 通过。

## 裁定与偏差

1. **文案键 14 个**(≤ 15),都在懒加载的 `locales/{en,zh-CN}.json` 的 `web.library.catalog.*`:`tabs tabMine tabCatalog levels allLevels add adding added open badge noSpace empty emptyHint deleteCopyBody`。计划的 `deleteCopyNote` 换成 `deleteCopyBody`(裁定 5);多了无障碍用的 `tabs`、`levels`。
2. **`use-poster.ts` 的 `fetcher` 参数放进 Task 2 的提交**(计划放 Task 3):精选卡片要显示封面,否则 Task 2 要改两遍同一个文件。
3. **`use-catalog` 的 `adding` 是 `ReadonlySet<string>`**(计划是 `string | null`):用户可以连点两张不同的卡。同一张卡的并发点击仍只发一次请求并共享同一个 promise。
4. **`CatalogView` 不接收 `api` 属性**:测试用现有的 `renderWithProviders`(真实 `ApiClient` + 假 fetch),比计划里「只为测试的属性」更接近真实路径。
5. **已存译文与 `config.ai`**:`canTranslate = (ai || 有与母语一致的已存译文) && 母语 ≠ en-US`;`useTranslations` 收到的 `enabled = showTranslation && ai`,所以 AI 关着时不请求。旧测试「管理员关 AI 时隐藏开关」用的夹具本身带了一句已存译文,改为先去掉夹具里的译文(它正是 R-W6 要改变的情形),并补两条:有已存译文时可开 / 译文语言不是母语时不开。
6. **副本卡片的徽标**:只显示「精选」(设计稿画面 1),不显示「已就绪」与字幕来源;`ItemOut` 没有级别字段,所以「我的」里的副本不显示级别徽标(设计稿里那个灰色 B1 做不到,不为它改服务端)。
7. **`library-css.test.ts` 的体积上限 28 000 → 32 000**(精选分节约 4 kB 未压缩);gzip 目标不变,未实测。新增的结构测试检查:精选分节无 `backdrop-filter` / `@keyframes`、2 列只在 430 px 以上、许可说明颜色与不透明度、「添加中」仍是蓝色。
8. 模糊层数不变(仍是 3 处 `backdrop-filter` 声明);新增 transition 只有 `.lib-cat-open` 的背景色,已登记到 `html.lite` 与 `prefers-reduced-motion` 两段。转圈用 Tailwind `animate-spin`。
9. 管理端:`admin/src/features/library/strings.ts` 的 `S.source` 补一行 `catalog: "精选"`(跟读库页的来源列不再显示原文 `catalog`);这是 AU 结果文档裁定 6 留下的缺口,单独一个提交。
10. 新文件用 Write(LF),改旧文件用保留 CRLF 的脚本;Git 会提示 LF/CRLF 转换警告,无内容影响。
11. 没有改 `web/CLAUDE.md`(内容是通用命令与陷阱,没有跟读库专属内容);跟读库的说明写在 `features/library/CLAUDE.md` 与 `web/README.md`。没有碰 `docs/changelog`。

## 站长要看到「精选」入口要打开的开关(管理端 设置)

用户端看到「精选」分段的条件是 `GET /api/library/config` 的 `catalog` 为真,即:

1. **「跟读库」总开关**(设置 → 功能开关,`LIBRARY_ENABLED`),且服务器装有 ffmpeg / ffprobe(`library_available`);已经能看到跟读库就说明这一条已满足。
2. **「精选库(内置素材)」**(设置 → 跟读库分组,`LIBRARY_CATALOG_ENABLED`,**默认关**)。关着时用户看不到「精选」,已加入的副本照常可用。
3. (不影响入口,影响内容)管理端 内容 → 精选库:导入或上传素材、等处理完成、审核后**发布**。「共享分析每日句数」(`LIBRARY_CATALOG_AI_DAILY`)只影响用户点「分析」时的系统付费额度。

**空状态**:前两项打开、但还没有任何已发布条目时,「精选」页签显示「精选素材正在准备中 / 管理员发布后会出现在这里。」。服务端返回错误(例如精选库刚被关掉、网络失败)时显示现有的错误卡 + 重试。

## 验证

- `cd web && yarn vitest run src/features/library src/architecture.test.ts`:见本提交时的运行结果(报告里写数字)。
- `yarn web:typecheck`、`cd admin && yarn typecheck`、`cd admin && yarn vitest run src/features/library`。
- 没有跑全量测试、E2E、构建、容器重建。

## 未验证

- 真机(iOS Safari / 安卓 Chrome)上精选网格的滚动性能与玻璃效果(`SpotlightCard` 在长列表里)、封面懒加载。
- iOS / 安卓上播放共享的音频(Range 播放与单句循环精度;与上传条目同一机制,但编码不同)。
- 用真实目录(管理员真实导入并发布)走完整「添加 → 播放 → 删除副本 → 再添加」的流程;并发添加与下架竞争只在假服务端验证。
- 360 / 390 / 430 px 的实际版面:只有 CSS 结构测试,没有在真实浏览器里看过(jsdom 没有布局)。
