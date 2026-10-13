# 跟读库 · 实测结果

## W1 网页库与播放器(计划 2026-10-13-video-import-web-library)

### L0 主包基线
- 提交:bc3640a3
- `node scripts/check-main-bundle.mjs --record`:未运行(本次执行者被禁止构建);基线仍是 2026-10-12 的 396.86 kB gzip(`web/scripts/main-bundle-baseline.json` 未改)。待办:有构建许可时在 W1 无代码的提交上重录,或在 L16 之前由后续执行者处理。
- S1 契约夹具(`server/tests/fixtures/library_contract.json`):不存在;L3 跳过,后续补。
- R-L1 核对:全部成立(Step 2 的 grep 全部命中;`CROSS_FEATURE_BASELINE.size` 为 18;`src/features/library` 尚不存在)。

### LA 外观设置的主包增量(R-L35)
- 构建与 `check-main-bundle.mjs --max-delta=1000` 未运行(本次执行者被禁止构建),基线未重录;主包增量待量(未验证)。目标测试 95 个用例通过,`yarn web:typecheck` 无错误。

### L16 合并前实测
(L16 填写)

### 未验证(W1)
(L16 填写)

## W2 网页跟读与评测(plans/2026-10-13-video-import-web-shadow.md)

### 预检(Task 0,2026-10-13)
本次基底只含 W1(分支 feat/library-web,最新提交 64e298c1),**不含 S1 服务端库代码**,涉及服务端的项标 PENDING。

| 项 | 结果 |
|---|---|
| S1 / W1 已合并 | W1:64e298c1(底部标签、懒加载路由)及其前序;S1:PENDING(`server/app/routers/library.py`、`server/tests/fixtures/library_contract.json` 不在基底) |
| ShadowPanel / SegmentText props(W1 ↔ W2) | `ShadowPanelProps` = R-SH02 原文(itemId、segment、active、durationMs、prevEndMs、nextStartMs、player、onSegmentSaved),`SegmentTextProps` = { segment, active },一致;无缺项;`LibrarySegment` 来自 `./library-api`(含可选 zh/zhLang/analysis/analysisLang),`PlayerHandle` 来自 `./use-media-player` |
| 「译」开关怎么传给 ShadowPanel | **不传**。W1 在 `player-page.tsx` 里自己调 `useTranslations`(W1 在 `use-translations.ts` 放了 W2 接缝:`UseTranslationsArgs` / `TranslationsState`,`translate`/`pending`/`notice`),`segment-list.tsx` 只渲染 `segment.zh` 与骨架。所以 ShadowPanel 不需要 `translate` prop;Task 10 的实现要替换 W1 的 `use-translations.ts`(保持其导出),Task 12 不渲染 `useRowTranslation`(见缺口) |
| onSegmentSaved 是否函数式更新 | 是(`setSegments((list) => list.map(...))`,player-page.tsx:140) |
| 效果组件 | `./fx` 已导出 ClickSpark、CountUp、GradientText、BlurText、GlassSurface(`fx/index.ts`),五个都转出 W1,无本地后备(签名在 Task 4 逐个核对) |
| useLibraryConfig 的 ai 字段 | 有(`LibraryConfig.ai: boolean`) |
| locales 子树结构 | `{"web":{"library":{…,"shadow":{…}}}}`,`locales.ts` 在模块求值时 `addResourceBundle`;W1 已预置一个小的 `shadow` 子树(record、stop、assessing、listenMine… 共 19 键),Task 2 整棵替换 |
| 改句 / 记成绩 / 译文 / 分析的错误文本与状态码 | PENDING(无服务端代码)。W1 的 `library-api.ts` 假设 429 = 额度满(`isAiLimited`);Task 2 的 `SHADOW_SERVER_ERRORS` 先用计划假设的键 |
| 契约夹具键名 | PENDING(夹具不在基底);`attempts-contract.test.ts` 以「夹具缺失则 skipIf」写 |
| speech SOURCES / practice_items Literal 含 library | **否**(基底里 `SOURCES = ("practice", "chat")`、`Literal["chat","lookup","grammar","manual"]`);服务端由 S1 加,PENDING |
| 跨 feature 基线 | N = 18 → Task 5 改为 19;库此前未导入 practice(grep 无命中) |

### W2 缺口(交 Z)
- 重复:W1 的 `library-api.ts` 已有 `translateSegments`、`analyzeSegment`、`isAiLimited`、`MAX_TRANSLATE_BATCH`;计划 R-SH29 要求 W2 在 `attempts-api.ts` 里另写一份(W2 不依赖 W1 未承诺的导出名),记为「重复,Z 去重」。
- 译文接线与计划假设不同:译文开关与批量取译文由 W1 的 `player-page.tsx` + `use-translations.ts` 接缝承担,ShadowPanel 无 `translate` prop。
- `web/src/features/library/CLAUDE.md` 不在基底(任务说明说 W1 写了,实际没有);未创建。
- S1 相关(错误文本、夹具键名、`source=library`)全部 PENDING,待服务端合并后复核。
