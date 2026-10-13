# 跟读库 · 网页跟读与评测(W2)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **合并顺序(spec §15):S1 →(S2 ‖ A 服务端 ‖ W1)→ **W2(本计划)** → A 网页 → Z。** 本计划的任何任务都不得在 S1 与 W1 合并之前开始;Task 0 先核对这一点。**2026-10-13 按修订后的 spec(D8–D12、E9、E11、E12、§11.4a)更新过:新增的内容与覆盖旧文的裁定见文末 `## Addendum (2026-10-13)`;文中带「(Addendum)」字样的段落已按它改写。**

**Goal:** 在跟读库播放器页的**每个句子行**里(W1 的接缝 `ShadowPanel` / `SegmentText`,W1 计划 R-L16)提供跟读与学习工具:句子逐词渲染在一个 `data-lookup-context` 容器里,点词用程序化选区,选区稳定后由全局 `LookupLayer` 弹出**现有的选中操作条**(查词 / 朗读 / 加入生词本);**当前句**的操作行有「听原句」、麦克风、「听我的录音」与 ⋯ 菜单;麦克风按钮先暂停媒体再在同一次点按里开麦,录完转成 16 kHz WAV,走现有 `POST /api/speech/assessments`(`source=library`、`save=true`、参考文本 = 句子原文),在该句下展开**评分卡**(评分环 + `CountUp` 数字 + `GradientText` 评语 + 三项子分)并按逐词结果给句子里的词着色,再 `POST /api/library/items/{id}/attempts` 记一次成绩,卡片头显示该句最好成绩。⋯ 菜单(底部动作面板)含:**复制句子**、**AI 分析**(在该句下展开分析卡:加载骨架 → `BlurText` 逐字浮现 → 可收起、已生成的不再请求、失败可重试)、**加入练习清单**(`ClickSpark` 火花,`source="library"`)、**微调**(±0.2 s 起止与改字,`PATCH segments`)。**译文**:W1 控制条的「译」开关打开后,W2 按需批量取视野附近句子的译文(去重、每次 ≤ 20 句、额度满 / 失败只提示一次),经 `onSegmentSaved` 交给 W1 渲染。练习 feature 只改来源类型(`library`)。主包零增量(本车道的文案放 W1 的懒加载 `locales/`)。深色 / 浅色(D12)全部靠 `theme.css` 令牌,不写死颜色。

**Architecture:** 全部新代码在 `web/src/features/library/` 下本车道拥有的文件(spec §15,含 D8 增补)及其测试:`attempts-api.ts`(本车道的 HTTP:成绩 / 记成绩 / 改句 / 批量译文 / 句子分析 + 最好成绩缓存 + 纯函数)、`word-tap.ts`(分词、逐词着色、程序化选区、评分词色的小 store)、`save-sentence.tsx`(加入练习清单的 hook 与芯片)、`use-shadowing.ts`(录音 → 评测 → 记成绩的状态机与「听我的」)、`segment-editor.tsx`(微调)、`segment-menu.tsx`(⋯ 菜单)、`analysis-card.tsx`(AI 分析卡)、`use-translations.ts`(译文批量取)、`shadow-panel.tsx`(导出 W1 约定的 `ShadowPanel` 与 `SegmentText`,替换 W1 的占位)。另新增两个 spec 未列名的文件(理由见 R-SH24、R-SH25):`score-card.tsx`、`shadow-fx.tsx`(跟读卡用到的 5 个效果组件的**唯一接缝**,默认转出 W1 的 `./fx`,缺哪个就用文件里给出的本地后备)。本车道的文案是 W1 `locales/{en,zh-CN}.json` 里的 `web.library.shadow` 子树(W1 计划 R-L4 明确把它交给 W2,懒加载,不进主包)。库对练习的依赖只经 `~/features/practice` 的公开面(`assessPronunciation`、`briefWords`、`PRACTICE_SERVER_ERRORS`、`savePracticeItem`、`AssessmentScores` 类型),由此新增唯一一条跨 feature 边 `library->practice`(`architecture.test.ts` 基线 18 → 19,在第一次导入的同一提交里加)。库还导入 `~/settings/settings-context`(母语)与 `~/auth/auth-context`,它们不是 feature,不产生边。查词不导入 `lookup`:选区由 `Selection.selectAllChildren` 产生,`LookupLayer`(`layout/app-shell.tsx` 全局挂载)经 `selectionchange` 自己显示选中操作条。

**Tech Stack:** React 18 + TypeScript(`tsc --noEmit`,未开 `strict`)+ Tailwind 3(redesign v3 令牌)+ lucide-react 0.479 + i18next + sonner + Radix Dialog(经 `~/components/bottom-sheet`);vitest + Testing Library + jsdom 26(实现了 `Selection.selectAllChildren` 与 `selectionchange`);录音沿用 `~/audio/use-recorder`(可注入 `starter`)、`~/audio/convert::toAssessmentWav`、`~/audio/audio-focus`。不新增 npm 依赖(效果组件自写,spec §11.4a)。

**Spec:** `docs/superpowers/specs/2026-10-13-video-import-design.md`(**有约束力**):§1 D6、D8、D9、D11、D12;§2.1 E11、E12;§2.2(核对表:评测保存来源、练习清单来源、查词入口、跨 feature 边、文案进主包);§5.2(`library_ai_enabled` 等设置;`config.ai`);§9(attempts / segments / speech / translate / analysis 的 API);§11.4(播放器与跟读页:跟读、点词、双语、⋯ 菜单、加入练习清单、微调)、§11.4a(视觉与动效)、§11.5(文案、体积、测试)、§13(隐私、未验证)、§15(文件归属、D8 增补的归属、合并顺序)。设计稿:`docs/superpowers/design/video-import-v1/mockup-glass.html`(视觉的唯一依据,画面 D 评分、E AI 分析)与 `mockup.html`(布局)。**D10 的第二期清单不在本计划**(录音管理页、转写稿下载、每句笔记、重新识别、单句音频下载、素材摘要、音标)。开放问题 1–5 按推荐默认值(都只影响服务端的开关与限额,对本计划的代码没有影响)。前置计划:`plans/2026-10-13-video-import-server-core.md`(S1)、`plans/2026-10-13-video-import-web-library.md`(W1,尤其 R-L4、R-L13、R-L16)。房规样式:`plans/2026-10-12-agents-web.md`、`plans/2026-10-12-wordbook-definitions-server.md`、`plans/2026-10-13-lookup-dictionary.md`。

## Global Constraints

- **文件归属(spec §15,一个文件只有一个所有者)。** 本计划拥有:`web/src/features/library/{shadow-panel.tsx,use-shadowing.ts,attempts-api.ts,word-tap.ts,save-sentence.tsx,segment-editor.tsx,segment-menu.tsx,analysis-card.tsx,use-translations.ts}`、它们的 `*.test.ts(x)`、`features/practice/practice-items-api.ts`、`features/practice/assessment-api.ts`、`web/src/architecture.test.ts`。另外本计划**新建**(spec 未列名,理由见 R-SH24、R-SH25、R-SH11、R-SH32):`features/library/score-card.tsx`(+测试)、`features/library/shadow-fx.tsx`(+测试)、`features/library/attempts-contract.test.ts`、`features/library/shadow-locales.test.ts`、`features/library/shadow-theme.test.ts`;**修改**:W1 的 `features/library/locales/{en,zh-CN}.json` 里的 `web.library.shadow` 子树(W1 计划 R-L4 的唯一例外,整棵替换,不碰子树之外的键),以及三份 §15 没有分配给任何计划的 practice 文件(理由见 R-SH07):`features/practice/practice-list-page.tsx`(一行)、`features/practice/i18n/{en,zh-CN}.json`(一个键)、`features/practice/CLAUDE.md`(一行),和三份测试(`practice-items-api.test.ts`、`assessment-api.test.ts`、`practice-list-page.test.tsx` 各追加一个用例)。
- **绝不碰** W1 的其余文件:`library-api.ts`、`config.ts`、`locales.ts`、`fx/*`(效果组件与 `library.css`)、`upload-client.ts`、`library-list-page.tsx`、`add-sheet.tsx`、`import-form.tsx`、`player-page.tsx`、`use-media-player.ts`、`segment-list.tsx`、`resume.ts`、`register.tsx`、`index.ts`、`i18n/*`、`CLAUDE.md`、`library-contract.test.ts`、`web/src/app.tsx`、`web/src/plugins/`、`web/src/layout/*`、`web/src/settings/*`、`web/README.md`、`web/scripts/main-bundle-baseline.json`;也不碰任何 `server/`、`admin/`、`enjoy/` 文件。`shadow-panel.tsx` 由 W1 先建占位(导出 `ShadowPanel`、`SegmentText` 及其 props,W1 计划 R-L16),Task 12 整体替换,此后归本计划(spec §15 W1 行),**导出名与 W1 约定的 props 不得改**(`segment-list.tsx` 依赖它们),只许追加可选 props。
- **分层不放宽。** `src/architecture.test.ts` 只加一条 `library->practice`(R-SH06);库不导入 `lookup`、`chat` 或别的 feature(测试文件可以导入,architecture 测试豁免测试文件)。库内用相对导入(`./x`),对 practice 只用 `~/features/practice`。
- **隐私(spec §13)。** URL 里只有条目 uuid 与句序号;句子文字、译文、分析、词、令牌只在请求体(评测是 multipart,成绩 / 改句 / 译文 / 分析是 JSON 体)。代码里不 `console.*` 任何东西。测试断言请求没有查询串。录音 blob URL 只在本页内存里,卸载与换句时 `revokeObjectURL`。译文与分析只存在内存(组件状态与模块级缓存),不写 `localStorage` / `sessionStorage`。
- **iOS(`web/CLAUDE.md` Pitfalls)。** `getUserMedia` 必须在用户手势里:`toggle()` 在 `await recorder.start()` 之前只做同步动作(暂停媒体、停我的录音、复位状态),R-SH12。录音与播放不并行。麦克风在每条退出路径释放(`useRecorder` 自己在卸载时释放;换句时 `cancel()`)。
- **i18n。** 本车道的键都在 `web.library.shadow.*`,放在 W1 的懒加载 `locales/{en,zh-CN}.json` 的该子树里(R-SH33),两份键集一致;用到这些键的模块都 `import "./locales"`。练习的来源标签 `web.practice.list.sources.library` 是唯一一个进主包的新键。
- **视觉(D11、D12、spec §11.4a)。** 只用 `theme.css` 令牌与现有组件(`SurfaceCard`、`IconButton`、`ToneBadge`、`BottomSheet`、`@renderer` 的 `Button`)和 `shadow-fx.tsx` 的效果组件;**不写死颜色**(没有十六进制 / `rgb()` 字面量,没有 `bg-white`、`text-black` 一类;火花等需要颜色的地方用 `rgb(var(--green))` 这类令牌变量),这样 D12 的「外观:跟随系统 / 浅色 / 深色」开关(`html.dark`)切换时无需任何额外代码,`shadow-theme.test.ts` 守住;触控 ≥ 44 px(`IconButton` = `h-tap w-tap`,主按钮 `h-12`);分数色一律 `~/components/score-tone`(≥85 绿 / 70–84 琥珀 / <70 灰);动画只用 `transform` / `opacity` / `stroke-dashoffset`,并带 `motion-reduce:` 退化(`prefers-reduced-motion` 时静止);**列表里的卡片(评分卡、分析卡)不加 `backdrop-filter`**(§11.4a:一屏模糊层 ≤ 3);界面不用 emoji。
- **工作树是 CRLF**(`core.autocrlf=true`):改现有文件用 Edit 工具,新文件用 Write 工具。
- **每个任务结束:** 在仓库根 `yarn web:typecheck`,再 `cd web && yarn vitest run <任务列出的测试文件> src/architecture.test.ts`。**只跑本任务列出的测试**;`yarn web:test` 全量、`yarn web:build`、E2E、容器重建只在用户要求时跑(体积实测归 Z 车道)。
- **提交:** conventional(`feat(web): …`、`test(web): …`、`docs: …`),一个任务一个提交,提交后上面两条命令全绿;信息最后一行是 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`。用 heredoc 提交:

  ```bash
  git commit -F - <<'EOF'
  feat(web): <subject>

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
  EOF
  ```

- **写计划时的实跑(如实):** 本计划的代码与测试**没有在写计划时运行过**。写计划时只读了真实源码、设计稿与已写成的相邻计划,并据此裁定(见「本计划的裁定」里每条的「核对」):`web/src/features/practice/{assessment-api.ts,practice-items-api.ts,save-practice-item.ts,mobile-score-result.tsx,practice-page.tsx,practice-list-page.tsx,index.ts,i18n/en.json}`、`web/src/audio/{use-recorder.ts,recorder.ts,convert.ts,describe-error.ts,audio-focus.ts,wav.ts}`、`web/src/features/lookup/{use-text-selection.ts,lookup-layer.tsx,lookup-bar.tsx,index.ts,CLAUDE.md}`、`web/src/features/chat/voice-words.ts`、`web/src/architecture.test.ts`、`web/src/i18n/index.ts`、`web/src/api/{client.ts,error-messages.ts}`、`web/src/test/{fetch-mock.ts,render.tsx,setup.ts}`、`web/src/components/{icon-button.tsx,tone-badge.tsx,score-tone.ts,surface-card.tsx,bottom-sheet.tsx}`、`web/src/settings/settings-context.tsx`(`nativeLanguageCode`)、`web/tailwind.config.js`(令牌)、`server/app/routers/speech.py`、`enjoy/src/shared/commands/analyze.command.ts`(分析的分节格式)、`docs/superpowers/design/video-import-v1/mockup-glass.html`、`plans/2026-10-13-video-import-web-library.md`(W1:R-L4、R-L13、R-L16、`PlayerController`、`segment-list.tsx`、`useLibraryConfig`)、`web/node_modules/jsdom`(26.0.0)与 `lucide-react`(0.479.0)。执行者第一次运行时以真实结果为准修正选择器与文案断言,但不得改动本计划的裁定、文件归属与接口名。
- **没有真机或真上游运行过的一律写「未验证」**(spec §13、`docs/CLAUDE.md`);fake 只证明逻辑。

---

## 文件结构

```
web/src/features/library/
  attempts-api.ts              新:listAttempts / recordAttempt / patchSegment / translateSegments / analyzeSegment、SHADOW_SERVER_ERRORS、最好成绩缓存(loadBest / noteAttempt)、bestBySegment / mergeBest / mergeServerBest(Task 2)
  attempts-api.test.ts         新(Task 2)
  attempts-contract.test.ts    新:读 S1 录制的 server/tests/fixtures/library_contract.json(Task 2,键名由 Task 0 定)
  shadow-locales.test.ts       新:web.library.shadow 子树的键集一致、源码里用到的键都存在(Task 2)
  locales/en.json  locales/zh-CN.json   改:整棵替换 web.library.shadow 子树(Task 2,W1 R-L4)
  word-tap.ts                  新:tokenizeSentence / wordTones / selectWord / 评分词色 store(Task 3)
  word-tap.test.ts  word-scores.test.ts   新(Task 3)
  shadow-fx.tsx                新:效果组件接缝(Task 4)
  shadow-fx.test.tsx           新(Task 4)
  save-sentence.tsx            新:useSaveSentence + SaveSentenceChip(Task 5)
  save-sentence.test.tsx       新(Task 5)
  use-shadowing.ts             新:useShadowing(Task 6)
  use-shadowing.test.tsx       新(Task 6)
  score-card.tsx               新:ScoreCard(Task 7)
  score-card.test.tsx          新(Task 7)
  segment-editor.tsx           新:SegmentEditor + 纯函数(Task 8)
  segment-editor.test.tsx      新(Task 8)
  analysis-card.tsx            新:AnalysisCard + parseAnalysis(Task 9)
  analysis-card.test.tsx       新(Task 9)
  use-translations.ts          新:TranslationBatcher + useRowTranslation(Task 10)
  use-translations.test.tsx    新(Task 10)
  segment-menu.tsx             新:SegmentMenu(Task 11)
  segment-menu.test.tsx        新(Task 11)
  shadow-panel.tsx             替换 W1 占位:ShadowPanel + SegmentText(Task 12)
  shadow-panel.test.tsx        新(Task 12)
  shadow-theme.test.ts         新:W2 源码里没有写死的颜色(Task 12)
web/src/features/practice/
  practice-items-api.ts        PracticeItemSource + "library"(Task 1)
  assessment-api.ts            AssessmentSource = "practice" | "chat" | "library"(Task 1)
  practice-list-page.tsx       SOURCE 表 + library 一行(Task 1,R-SH07)
  i18n/en.json  i18n/zh-CN.json   sources.library(Task 1,R-SH07)
  CLAUDE.md                    一行(Task 1)
  practice-items-api.test.ts  assessment-api.test.ts  practice-list-page.test.tsx   各追加一个用例(Task 1)
web/src/architecture.test.ts   基线 + "library->practice"、size 19、两条扫描用例(Task 5)
docs/superpowers/plans/2026-10-13-video-import-results.md   追加「W2」一节(Task 0 起草,Task 13 补全)
```

| 共享 / 跨车道文件 | 本计划的插入点 |
|---|---|
| `web/src/architecture.test.ts` | `CROSS_FEATURE_BASELINE` 里 `"lookup->practice",` 之前插入 `"library->practice",`;注释段末尾追加 W2 理由两行;`toBe(18)` → `toBe(19)`(若 Task 0 读到的数字不是 18,改成「读到的数字 + 1」);「guards plugins…」用例末尾追加两行(Task 5) |
| `web/src/features/practice/practice-list-page.tsx` | `SOURCE` 表 `manual` 行之后一行 `library`;lucide 导入行追加 `FilmIcon` |
| `web/src/features/practice/i18n/{en,zh-CN}.json` | `web.practice.list.sources` 对象末尾追加 `library` |
| `web/src/features/library/locales/{en,zh-CN}.json` | 只换 `web.library.shadow` 这一棵子树(W1 R-L4);子树之外一字不动 |
| `web/src/features/library/shadow-panel.tsx` | W1 的占位文件,Task 12 整体替换(导出名与 W1 约定的 props 以 W1 计划 R-L16 为准,追加可选 props `translate`、`starter`) |
| `docs/superpowers/plans/2026-10-13-video-import-results.md` | 只**追加** `## W2 网页跟读与评测` 一节,不改别的车道的段落;文件不存在则新建,首行 `# 跟读库(video import)结果` |

## 车道与任务顺序

本计划是一条串行车道(各任务依赖前一个的文件):**T0 → T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13**。

- T0 只读与写结果文档;T1 只改 practice;T2、T3、T4 不导入 practice;**T5 是第一处 `library->practice` 导入,所以基线在 T5 的同一提交里加**(`architecture.test.ts` 的「baseline lists only edges that still exist」会让提前加的边失败)。
- T9(分析卡)、T10(译文)只依赖 T2、T4;T11(菜单)依赖 T5、T4;T12 依赖全部。
- 跨计划:S1 与 W1 必须都已合并(T0 Step 1 核对)。A 网页、Z 在本计划之后。

**评审波:** T6 之后与 T12 合并前各一次 `/code-review high`(重点:录音的每条退出路径释放麦克风、换句 / 卸载时丢弃迟到的评测结果与译文、URL 里没有文字、译文批量请求的去重与「额度满 / 失败只提示一次」、`onSegmentSaved` 被连续调用时 W1 不丢更新);视觉对照在浏览器窗格 375×812 与 360×740、**浅色 + 深色各看一次**播放器页(需要 W1 的页面与一个 `ready` 的条目;没有真机,结论只写「桌面浏览器模拟」)。

---

## 本计划的裁定

- **R-SH01 Task 0 是预检,不是 spike。** spec §15 的 Task 0 / spike 只点名了 S0(S1 车道)、S1 spike(S1 车道)、S2(S2 车道),没有给 W2 的。本计划的 Task 0 读已合并的 W1 / S1 真实代码,把本计划依赖的接口逐项核对(`ShadowPanel` 的 props、效果组件、`locales` 子树、`useLibraryConfig` 的 `ai` 字段、`onSegmentSaved` 的实现、服务端错误文本、契约夹具键名、`speech.py` 的 `SOURCES`、跨 feature 基线数字),结论追加到结果文档的 W2 一节。*若错*:无代价,只是多一次读代码。

- **R-SH02 `ShadowPanel` 的接口 = W1 计划 R-L16 的原文(Addendum 改写)。** W1 计划 R-L16 写定:
  ```ts
  export interface ShadowPanelProps { itemId: string; segment: LibrarySegment; active: boolean; durationMs: number;
    prevEndMs: number | null; nextStartMs: number | null; player: PlayerHandle | null; onSegmentSaved(next: LibrarySegment): void }
  export function ShadowPanel(props: ShadowPanelProps): ReactElement | null   // W1 占位返回 null
  export interface SegmentTextProps { segment: LibrarySegment; active: boolean }
  export function SegmentText(props: SegmentTextProps): ReactElement           // W1 占位渲染纯文本
  ```
  `LibrarySegment` 来自 `./library-api`,`PlayerHandle = Pick<PlayerController, "pause" | "playOnce" | "seekTo" | "getState">` 来自 `./use-media-player`;`segment-list.tsx` 在每一行渲染 `<SegmentText>`(句子文字,被一个点击 = 跳播的容器包住;当前有文本选区时容器不跳播;W2 的逐词点击要 `stopPropagation()`)与其下方的 `<ShadowPanel>`。`PlayerController` 的 `seekTo(idx)` / `playOnce(idx)` 的 `idx` 是句子在数组里的位置,W1 传 `segment.idx`(`idx` 从 0 起连续,C6,所以两者相等)。**本计划只追加两个可选 props**(`translate?: boolean` 见 C9;`starter?: RecordingStarter` 只给测试)。Task 0 Step 2 逐项核对 W1 真实代码;名字或语义有出入时,按 W1 的真实代码实现并把映射写进结果文档,**W2 不得修改 `player-page.tsx` 与 `segment-list.tsx`**。缺项处理:`player` 为 `null`(媒体还没就绪)时「听原句」禁用、暂停媒体改为暂停文档里所有 `video, audio` 元素;W1 没有传 `translate`(C9)→ 译文不会被取,记为 W2 缺口交 Z;缺 `onSegmentSaved` 或缺 `segment` / `active` / `itemId` 任何一个 → **停止(BLOCKED)**,在结果文档写明并交回用户。

- **R-SH03 控制在句子行里,只有当前句显示(Addendum 改写;取代原「当前句卡」偏离)。** spec §11.4 写「句子右侧的麦克风按钮」「在该句下展开 `MobileScoreResult`」,设计稿 D / E 画面是每行一个麦克风 / ⋯。W1 的行布局(R-L16)把 `ShadowPanel` 放在句子下方、整行宽度,所以:**操作行(听原句 · 跟读 · 听我的 · ⋯)放在句子正下方而不是右侧**;为了不给几百个句子行各挂一个录音机和一次成绩请求,**只有 `active` 的那一行渲染操作行与卡片**(点句子 = W1 的「跳到该句并播放」,同时成为当前句),其余行的 `ShadowPanel` 只渲染一个零高度的哨兵 `<div>`(给译文的视野检测用,R-SH27)。*代价*:要跟读另一句,先点那一句;非当前句没有 ⋯ 菜单。**核对**:`segment-list.tsx`(W1 L13)按 `seg.idx === current` 传 `active`,每行一个 `ShadowPanel`。*若用户要求每行都有话筒*:需要改 W1 的 `segment-list.tsx`,交 Z 或补充计划。

- **R-SH04 本车道文案 = W1 `locales/*.json` 的 `web.library.shadow` 子树(Addendum 改写;取代原 `shadow-locales/` 方案)。** **核对**:W1 计划 R-L3、R-L4:W1 把库的文案放进懒加载的 `locales/{en,zh-CN}.json`(`locales.ts` 在模块求值时 `addResourceBundle`,`i18n/` 目录只有入口卡两条进主包),并预置 `web.library.shadow.*`,「该子树归 W2,W2 可增删改其中的键(en 与 zh-CN 同步),W1 之后不再动」。所以 W2 不再自建 `shadow-locales/`(原方案的第二套加载机制会让两边的同名键互相遮盖),Task 2 用本计划的子树**整棵替换**两个文件里的 `web.library.shadow`;用到文案的模块都 `import "./locales"`。`shadow-locales.test.ts` 守住:两份子树键集一致、源码里出现的每个 `web.library.shadow.*` 字面量都存在。*结果*:W2 对主包零增量(推断,体积实测归 Z)。

- **R-SH05 成绩、改句、译文、分析的 HTTP 调用在 `attempts-api.ts`。** `PATCH …/segments/{idx}` 属于微调(W2 的功能),`POST …/translate` 与 `…/segments/{idx}/analysis`(D8)在 spec §15 里归 W1 的 `library-api.ts`,但 W2 的钩子与分析卡需要它们且 W2 不得依赖 W1 未承诺的导出名(W1 计划 R-L16 只承诺了 `LibrarySegment`、`PlayerHandle` 两个名字),所以四个调用都放进 W2 拥有的 `attempts-api.ts`(R-SH29)。不导入 W1 的 `library-api.ts` 的值,只 `import type { LibrarySegment }`。

- **R-SH06 跨 feature 边只加 `library->practice`(18 → 19),在 Task 5 加。** **核对**:`web/src/architecture.test.ts` 现有 `CROSS_FEATURE_BASELINE` 18 条,`expect(CROSS_FEATURE_BASELINE.size).toBe(18)`;「baseline lists only edges that still exist」会让没有导入支撑的边立刻失败,所以必须与第一处导入(`save-sentence.tsx` 的 `savePracticeItem`)同一提交。spec §2.2 的裁定原文:「库需要 `library->practice`(评测 API、`MobileScoreResult`、`savePracticeItem`),与已有的 `chat->practice` 同理;裁定:加这一条到基线并在注释写明理由,别的边一律不加」。W1 不能改 `architecture.test.ts`,所以 W1 合并时库不可能已导入 practice;Task 0 Step 9 仍复核一次。若 Task 0 读到的数字不是 18(别的计划在此期间增删了边),用「读到的数字 + 1」。`~/settings/settings-context`、`~/auth/auth-context`、`~/components/*` 不是 feature,不产生边。

- **R-SH07 偏离 §15:必须改三份未分配的 practice 文件。** **核对**:`web/src/features/practice/practice-list-page.tsx:23` 是 `const SOURCE: Record<PracticeItemSource, { tone: Tone; icon: LucideIcon }>`,给 `PracticeItemSource` 加 `"library"` 后不补这一行就 `tsc` 失败;第 141 行 `t(\`web.practice.list.sources.${item.source}\`)` 没有 `library` 键就显示键名。这两处(以及 `practice/i18n/{en,zh-CN}.json` 的一个键、`practice/CLAUDE.md` 的一行)在 §15 里没有分给任何计划,所以由引入该类型的本计划一并修改。图标 `FilmIcon`、色调 `gray`(该表的注释:「对话 = 蓝,其它来源中性」)。

- **R-SH08 评测来源类型。** **核对**:`assessment-api.ts::assessPronunciation` 的 `source?: "practice" | "chat"`;服务端 `server/app/routers/speech.py:35` 现在是 `SOURCES = ("practice", "chat")`,不在其中返回 400 `Invalid source`,由 S1 加 `"library"`(spec §9 末段)。本计划把类型抽成 `export type AssessmentSource = "practice" | "chat" | "library"`(不加进 practice 的 `index.ts`:库传字面量即可,`index.ts` 只导出别处用到的东西)。`practice_items` 同理(S1 加服务端 `Literal`)。

- **R-SH09 逐词着色由 W2 自己做。** spec §11.4 写「逐词着色」。**核对**:`mobile-score-result.tsx` 只画总分圆环与三条横条,**没有逐词着色**;对话里的逐词对齐 `markTranscript` / `isPoorWord` 在 `features/chat/voice-words.ts`,库导入 chat 会新增 `library->chat` 边(禁止)。所以 `word-tap.ts::wordTones` 自己按顺序对齐(向前看 3 个词,与 `markTranscript` 同一思路),规则:`Insertion` 不参与对齐;`Mispronunciation` / `Omission` → `low`;否则按 `scoreTone(accuracyScore)`;对不上的词不着色。颜色:`good` 绿字、`fair` 琥珀字、`low` 灰字加点状下划线(只靠颜色区分对色弱不友好,下划线补形状;设计稿 D 画面里的「红色波浪线」换成令牌灰 + 点状线,因为全站分数刻度没有红色,`score-tone.ts`)。分数与词来自 `briefWords(res.detailResult.words)`(practice 公开面)。着色的词要显示在 `SegmentText` 里(W1 渲染的、与 `ShadowPanel` 分开的组件),二者经 `word-tap.ts` 里的一个小 store 共享(R-SH31)。

- **R-SH10 参考文本 = 句子原文;单句录音上限 60 s。** 服务端在 `POST attempts` 时核对「参考文本与该句文本一致」(spec §9),所以参考文本直接用 `segment.text`,不经 `practiceReference` 的空白折叠(服务端 `speech.py` 自己 `strip()`;句子文字由 S1 写入,已是规整的)。句子 ≤ 600 字(§6.3),远低于 `MAX_REFERENCE_CHARS = 2000`。录音上限 `SHADOW_MAX_MS = 60_000`:句子最长 14 s(§6.3),60 s 足够且远低于服务端 300 s;到上限自动停并评测。

- **R-SH11 成绩与改句的响应形状宽容解析;契约测试键名由 Task 0 定。** spec §9 只给了 `GET attempts` 的行形状 `[{seg_idx, best_score, count, last_at}]`,没给 `POST attempts` 与 `PATCH segments` 的响应。所以:`listAttempts` 接受裸数组或 `{attempts: [...]}`;`recordAttempt` 不读响应;`patchSegment` 接受裸句子、`{segment: {...}}` 或空体,缺的字段用本地草稿补。`attempts-contract.test.ts` 读 S1 录制的 `server/tests/fixtures/library_contract.json`,键名(`KEYS`)由 Task 0 Step 7 按真实夹具填;夹具里缺某一项就删掉对应用例并在结果文档的「W2 缺口」记下(S1 的夹具不归本计划)。译文与分析的响应同样宽容解析(R-SH27、R-SH28),夹具里有它们的键时加契约用例,没有则 `it.skipIf`。

- **R-SH12 录音与播放不并行;开麦在手势内。** `toggle()` 开始录音时,在 `await recorder.start()` 之前**同步**地:停掉「我的录音」回放、调 `pauseMedia()`、复位状态;`useRecorder.start` → `defaultRecordingStarter` → `startRecording` / `startPcmRecording` 在第一个 `await` 之前就调用 `getUserMedia`(**核对**:`audio/use-recorder.ts`、`audio/recorder.ts::startRecording`),所以仍在点按手势里。录音中与评测中禁用「听原句」「AI 分析」「微调」;「听我的」只在录音机空闲时可用,它先 `pauseMedia()` 再播放,并经 `claimAudio` 让别的播放者(TTS)停下;「听原句」先停「我的录音」再调 `player.playOnce(idx)`。W1 的媒体元素不在 `claimAudio` 体系里(W1 的事),所以用户在播放器控制条上直接按播放时,「我的录音」不会自动停 —— 已知限制,写进结果文档。

- **R-SH13 没说话不上传;后台中断丢弃。** `RecordingResult.noSpeech === true`(PCM 采集的能量门限判定,**核对** `audio/recorder.ts` 的字段注释)→ 不调评测(省上游钱),显示「没听到声音」。`useRecorder` 的自动停止只在 `stoppedBy === "max_duration"` 时评测;`background` / `track_ended`(页面切后台、麦克风断开)丢弃,回到空闲(用户不在场,评一段残缺录音没有意义)。

- **R-SH14 记成绩失败不挡住结果。** 评测成功而 `POST attempts` 失败时:照样展示分数与逐词着色,卡片下方一行灰字「已评分,但没有记入本条素材的最好成绩」,**不**更新本地最好成绩(否则刷新后数字对不上);不弹 toast,不记日志。评测本身已保存在练习记录里(spec §4 `library_attempts` 段:「评测与录音本身仍属于现有的练习记录」)。

- **R-SH15 点词 = 程序化选区 → 现有选中操作条(Addendum 改写;更正原稿与 spec 的措辞)。** **核对**:`features/lookup/use-text-selection.ts::readSelection` 要求选区非折叠、锚点与焦点落在同一个 `closest("[data-lookup-context]")` 里、不在可编辑元素里,上下文取该容器的 `textContent`(超过 300 字才截句);`useTextSelection(300)` 在 `selectionchange` 稳定 300 ms 后上报;`lookup-layer.tsx` 在 `selection && suggested && !open` 时渲染 `<LookupBar>`(`data-testid="lookup-bar"`:查词 / 翻译按钮 `lookup-trigger`、朗读、加入生词本),**用户点操作条上的「查词」才打开抽屉**(spec §11.4 写的「300 ms 稳定后现有 `LookupLayer` 打开」按真实代码应读作「出现选中操作条」;`lookup/CLAUDE.md` 也写明它是 selection action bar)。所以句子用一个 `<p data-lookup-context>` 包住,每个词一个 `<span>`,点按时 `selection.removeAllRanges(); selection.selectAllChildren(span)`,点按处理里 `stopPropagation()`(W1 的容器点击 = 跳播);上下文自然是整句。若用户刚拖选了别的文字(选区非折叠且不等于这个词),不覆盖它。**核对**:jsdom 26.0.0 的 `Selection-impl.js` 实现了 `selectAllChildren` 并排队派发 `selectionchange`,单元测试可证明「选中了这个词」与「派发了事件」;Task 12 另有一个用例把真实的 `LookupLayer` 与 `SegmentText` 放在一起,断言点词后出现 `lookup-bar`(测试文件可以导入 `~/features/lookup`,architecture 测试豁免测试文件)。iOS Safari 上点按后选区是否保持、操作条是否出现**未验证**(spec §13)。

- **R-SH16 微调规则。** 每次 ±200 ms;起点不早于上一句终点(没有上一句 = 0),终点不晚于下一句起点(没有下一句 = 媒体时长;时长未知 = 不限);W1 传的是 `prevEndMs` / `nextStartMs`(数字或 `null`);句长至少 `MIN_SEGMENT_MS = 200`;越界时夹到边界,无处可移时保持不动。文字:空白折叠后 1–600 字且含字母(`/\p{L}/u`),否则禁用保存并提示。保存只发生了变化的键(`{start_ms?, end_ms?, text?}`);没变化 = 直接关闭。服务端仍是最终裁判(spec §9:「起止必须仍在媒体时长内且不与相邻句重叠;文本 ≤ 600 字、必须含字母」),它的拒绝经 `SHADOW_SERVER_ERRORS` 翻译。**文字改了,该句的 `zh` / `analysis` 也清空**(E11,服务端清;网页本地同步清,R-SH34)。

- **R-SH17 换句或改字即复位。** `useShadowing` 以 `${idx}\0${text}` 为键:变化时取消录音(释放麦克风)、中止进行中的评测请求、丢弃迟到的结果(代次计数 `gen`)、停「我的录音」并 `revokeObjectURL`、清结果与错误。改字后旧成绩对应的是旧文本,所以同样复位。迟到的评测若已成功记了成绩,最好成绩缓存仍会更新(那是真实的一次练习)。**(Addendum)** 因为只有当前句渲染操作行(R-SH03),当前句一变,旧句的 `ActivePanel` 整个卸载 —— 卸载与换句走同一套清理(麦克风、请求、blob URL、评分词色)。

- **R-SH18 存句子:不去重,按文本记「已存」。** `useSaveSentence` 调 `savePracticeItem(api, t, text, "library")`(**核对** `features/practice/save-practice-item.ts`:成功 toast `web.practice.list.saved`、失败 toast 翻译后的服务端错误,返回布尔)。spec §11.4:「已加入过的不去重(服务端本来也不去重,沿用)」,所以再点一次会再存一条;成功后显示实心星与「已加入练习清单」,换句即复位。**(Addendum)** 入口有两处,共用同一个 hook 实例(`ActivePanel` 里只调一次):评分卡里的芯片(设计稿 D 的「加入练习」)与 ⋯ 菜单里的条目(D8);两处都包 `ClickSpark`(spec §11.4a),菜单条目在保存结束后再停留 `SPARK_MS`(600 ms)才收起面板,让火花可见。

- **R-SH19 `SHADOW_SERVER_ERRORS` 的键是假设,Task 0 对齐。** spec §9:「错误文本是固定的英文字符串」,但没列出改句的错误文本。本计划假设 S1 用 `"Library item not found"`、`"Segment not found"`、`"Invalid segment times"`、`"Invalid segment text"`;Task 0 Step 6 读 `server/app/routers/library.py` 的真实 `HTTPException` 文本,在 Task 2 里按真实文本改映射表的**键**(值即 i18n 键不变),映射写进结果文档。评测错误沿用 `PRACTICE_SERVER_ERRORS`(spec §11.4)。分析 / 译文的错误按**状态码**处理(R-SH27、R-SH28),不依赖文本。

- **R-SH20 盲听由 W1 处理(Addendum 改写)。** 盲听是 W1 的功能(§15 W1 行,W1 R-L17:盲听时文字不在 DOM 里,只有「显示这句」按钮,W1 不渲染 `SegmentText`)。W2 不再有 `hideText` 与「点按显示」(原稿的该功能删除);盲听时评分仍在卡片里展示,着色只在文字显示时可见。译文在盲听时同样由 W1 隐藏(spec §11.4)。

- **R-SH21 不改段位、今日任务与联动。** spec §2.2 已裁定:库的跟读按练习计分(`rank/ledger.py`,服务端)、不计入今日任务(`links/daily_tasks.py` 只算 `practice`)。网页端什么都不做。

- **R-SH22 公开面不变。** `ShadowPanel` 与 `SegmentText` 只被 W1 的 `segment-list.tsx`(同一 feature)导入,`features/library/index.ts`(W1)不需要新增导出。

---

## 跨计划假设(本计划依赖的确切接口)

> 这些是写计划时对**尚未合并**的 W1 / S1 的假设;spec 只在 §15「D8 增补的归属」里给了归属,没有给签名,所以下面的签名是本计划的假设,Task 0 逐项对真实代码核对,有出入就改接缝文件(`shadow-fx.tsx`)或映射,**不改本计划的裁定**。

| 编号 | 来自 | spec 依据 | 本计划假设的确切形状 | Task 0 怎么核对 |
|---|---|---|---|---|
| C1 | W1 | §15 W1 行「`player-page.tsx` 引用 `shadow-panel.tsx`(W1 先放一个返回 `null` 的占位,之后归 W2)」;W1 计划 R-L16 | `shadow-panel.tsx` 导出 `ShadowPanel`、`ShadowPanelProps`、`SegmentText`、`SegmentTextProps`(R-SH02 的形状);`segment-list.tsx` 每行渲染 `<SegmentText>` 与其下方的 `<ShadowPanel>`;`LibrarySegment` 来自 `./library-api`、`PlayerHandle` 来自 `./use-media-player` | Step 2 |
| C2 | S1 | §9「`GET /api/library/items/{id}/attempts` → `[{seg_idx, best_score, count, last_at}]`」 | 裸数组或 `{attempts:[…]}`;`best_score` 可为 `null` | Step 7 |
| C3 | S1 | §9「`POST /api/library/items/{id}/attempts` `{seg_idx, assessment_id}`:服务端核对该评测属于本人、`source == "library"`、参考文本与该句文本一致,再记 `score`」 | 请求体 `{seg_idx, assessment_id}`;响应不读 | Step 6、7 |
| C4 | S1 | §9「`PATCH /api/library/items/{id}/segments/{idx}` `{start_ms?, end_ms?, text?}`」 | 请求只含变化的键;响应可为句子、`{segment}` 或空 | Step 6、7 |
| C5 | S1 | §9 末段「`routers/speech.py` 追加 `library` 作为合法 `source`;`routers/practice_items.py` 的 `source` 追加 `library`」 | 两处服务端已接受 `"library"` | Step 8 |
| C6 | S1 | §6.3 单句 ≤ 600 字;§4 `library_segments` 复合主键 `item_id + idx` | `idx` 从 0 起连续,所以 W1 传给 `PlayerController` 的数组位置等于 `segment.idx` | Step 7 |
| C7 | W1 | §11.1 `LookupLayer` 不变、§2.2「查词入口」 | W1 没有在 `segment-list.tsx` 里再放一个 `data-lookup-context` 包住句子(否则选区的 `closest()` 会命中更大的容器) | Step 2 |
| C8 | S1 | §9「`POST …/translate` `{indices: [int, ≤ 20], native_language}` → `[{idx, zh}]`;超额度时已有的照常返回、缺的不生成并带 `limited: true`;`library_ai_enabled` 关 404」「`POST …/segments/{idx}/analysis` `{native_language}` → `{analysis, cached}`;额度满 429」;§5.2 `config.ai` | 译文响应:裸数组,或带 `limited` 的对象(`items` / `translations` / `segments` 之一为数组);分析响应 `{analysis, cached}`;429 = 额度满,404 = AI 未开启 | Step 7 |
| C9 | W1 | §15「D8 增补的归属」W1:「`segment-list.tsx` 渲染译文行(只读 `segment.zh`)、控制条「译」开关、`library-api.ts` 的 `translate` / `analysis` 调用与类型」 | ① `LibrarySegment` 有可选字段 `zh?`、`zhLang?`、`analysis?`、`analysisLang?`(本计划用交叉类型自己声明,W1 没有也能编译);② W1 把「译」开关的状态以**可选 prop `translate?: boolean`** 传给每行的 `<ShadowPanel>`(开关是 W1 的状态,W2 需要知道才去取译文);③ `onSegmentSaved(next)` = 按 `idx` 替换列表里的那一句(函数式更新,连续调用不丢更新);④ W1 渲染译文行,骨架行也归 W1 | Step 2 |
| C10 | W1 | §11.4a「12 个效果(自写,不引入 reactbits 或任何新 npm 依赖)……样式与小组件只放在 `features/library/` 内」;§15 W1 行(`features/library/` 下除 W2 文件外的全部) | `web/src/features/library/fx`(目录或 `fx.tsx`)导出 `ClickSpark`、`CountUp`、`GradientText`、`BlurText`、`GlassSurface`,签名见 Task 4 | Step 3 |
| C11 | W1 / S1 | §5.2「关 = 两类端点 404、`config.ai: false`、网页不显示『译』与『分析』」 | W1 的 `config.ts` 导出 `useLibraryConfig(): LibraryConfig \| null`(W1 计划 L1),D8 增补后 `LibraryConfig` 有 `ai: boolean`;W2 用 `(config as { ai?: boolean } \| null)?.ai === true` 读它 | Step 4 |
| C12 | W1 | W1 计划 R-L3、R-L4 | `locales.ts` 在模块求值时 `addResourceBundle` 合并 `locales/{en,zh-CN}.json`;`web.library.shadow` 子树归 W2 | Step 5 |

---

## Task 0: 预检(读已合并的 W1 / S1 代码,起草结果文档的 W2 一节)

**Files:**
- Modify(追加): `docs/superpowers/plans/2026-10-13-video-import-results.md`

**Interfaces:**
- Consumes:W1 的 `shadow-panel.tsx` 占位、`segment-list.tsx`、`player-page.tsx`、`config.ts`、`fx/*`、`locales/*`;S1 的 `server/app/routers/library.py`、`server/app/routers/speech.py`、`server/app/routers/practice_items.py`、`server/tests/fixtures/library_contract.json`
- Produces:结果文档的 `## W2 网页跟读与评测` 一节(预检表);供 Task 2 / 4 / 9 / 10 / 12 使用的决定(错误文本键、契约键名、props 映射、效果组件映射)

- [ ] **Step 1: 确认前置已合并** — 在仓库根(Git Bash):

```bash
git log --oneline -30
ls server/app/routers/library.py server/tests/fixtures/library_contract.json \
   web/src/features/library/shadow-panel.tsx web/src/features/library/segment-list.tsx \
   web/src/features/library/player-page.tsx web/src/features/library/config.ts \
   web/src/features/library/locales.ts
```

任一文件不存在 → **停止(BLOCKED)**:本计划依赖 S1 与 W1 已合并(spec §15 合并顺序)。

- [ ] **Step 2: 核对 W1 的接缝(C1、C7、C9)**

```bash
cat web/src/features/library/shadow-panel.tsx
grep -n "ShadowPanel\|SegmentText\|translate\|onSegmentSaved\|data-lookup-context" web/src/features/library/segment-list.tsx
grep -n "onSegmentSaved" -B2 -A12 web/src/features/library/player-page.tsx
grep -rn "data-lookup-context" web/src/features/library/ --include=*.tsx
```

逐项对照 R-SH02 与 C9,把「W1 名字 ↔ 本计划名字」与结论写进结果文档:

1. `ShadowPanelProps` / `SegmentTextProps` 的字段名与类型是否就是 R-SH02 的原文。有出入就在 Task 12 里按 W1 的名字实现(测试里的 props 同步改名)。缺 `itemId` / `segment` / `active` / `onSegmentSaved` 任何一个 → **停止(BLOCKED)**。
2. `segment-list.tsx` 有没有把「译」开关传给 `<ShadowPanel>`(C9②),叫什么名字。**有**:Task 12 的 `translate` 按它的名字(同义映射写进结果文档);**没有**:在结果文档「W2 缺口」写「W1 未传译文开关,译文不会被取,Z 车道接线」,Task 10 的钩子照常实现与测试,Task 12 里不渲染译文的调用(删掉 `useRowTranslation` 那一行与对应用例)。
3. `onSegmentSaved` 在 `player-page.tsx` 里是不是**函数式更新**(`setSegments((prev) => prev.map(...))`)。**是**:连续调用安全。**不是**(用闭包里的旧列表):在结果文档「W2 缺口」写明,并在 `use-translations.ts` 里把 `APPLY_GAP_MS` 保持为 `0`(它让每条译文在各自的宏任务里应用,已是针对闭包问题的缓解,见 R-SH27),同时把「连续多条译文可能丢更新」记入风险。
4. `data-lookup-context` 不应出现在 W1 的任何组件里(C7);若出现在包住 `<SegmentText>` 的祖先元素上,记为 W2 缺口(选区的 `closest()` 先命中 `SegmentText` 自己的 `<p>`,所以实际不受影响,写明即可)。
5. 点击 = 跳播的容器是否在「当前有选区」时不跳播,以及它是否对 `SegmentText` 里的 `click` 事件做了 `stopPropagation()` 之外的处理(R-L16 说 W2 的逐词点击应 `stopPropagation()`)。

- [ ] **Step 3: 核对 W1 的效果组件(C10)**

```bash
ls web/src/features/library/fx* 2>/dev/null
grep -rn "export" web/src/features/library/fx* 2>/dev/null | head -40
```

Task 4 的 `shadow-fx.tsx` 默认从 `./fx` 转出五个组件 `ClickSpark`、`CountUp`、`GradientText`、`BlurText`、`GlassSurface`(签名见 Task 4)。逐个核对:**存在且签名兼容**的保持转出(必要时把 `export { X } from "./fx/某文件"` 的路径改成真实路径);**不存在或不兼容**的,把 `shadow-fx.tsx` 里该组件换成 Task 4 Step 3b 给出的本地后备。结论(每个组件:转出 / 后备)写进结果文档。

- [ ] **Step 4: 核对配置钩子(C11)**

```bash
grep -n "useLibraryConfig\|ai" web/src/features/library/config.ts | head -20
```

确认 `useLibraryConfig` 存在、返回 `LibraryConfig | null`;`ai` 字段在不在 `LibraryConfig` 里(不在也不阻塞:Task 12 用类型断言读它)。`GET /api/library/config` 的假响应形状抄 `web/src/features/library/test-fixtures.ts` 的 `CONFIG_RAW`,加 `ai: true`。

- [ ] **Step 5: 核对文案文件(C12)**

```bash
head -c 600 web/src/features/library/locales/en.json
grep -n '"shadow"' -A3 web/src/features/library/locales/en.json | head -12
cat web/src/features/library/locales.ts
```

确认 `web.library.shadow` 子树存在、`locales.ts` 的加载方式(`addResourceBundle` + 模块求值),以及两份 JSON 的嵌套结构(`{"web": {"library": {…, "shadow": {…}}}}`)。结构不同就在 Task 2 Step 4 按它的嵌套放子树。W1 的 `i18n/*.json`(eager)里不应有 `web.library.shadow`。

- [ ] **Step 6: 核对服务端错误文本(C3、C4、R-SH19)**

```bash
grep -n "HTTPException" server/app/routers/library.py
```

找出 `PATCH …/segments/{idx}`、`POST …/attempts`、`POST …/translate`、`POST …/segments/{idx}/analysis` 会返回的文本与状态码,记下与 R-SH19 四个假设键的对应关系(真实文本 → `web.library.shadow.errors.notFound | badTimes | badText`)。Task 2 Step 3 用真实文本作 `SHADOW_SERVER_ERRORS` 的键;没有对应的假设键删掉。再确认:AI 未开启 = 404、额度满 = 429(C8)。不一致就把差异写进结果文档,Task 9 / 10 按状态码分支处理的两处(`status === 429`、`status === 404`)按真实状态码改。

- [ ] **Step 7: 核对契约夹具(C2、C4、C6、C8、R-SH11)**

```bash
node -e "const c=require('./server/tests/fixtures/library_contract.json');const h=c.http||c;console.log(Object.keys(h).join('\n'))"
```

找出:attempt 列表、attempt 创建、segment PATCH、(若有)translate、analysis 五个响应的键名,填进 Task 2 `attempts-contract.test.ts` 的 `KEYS`;再打印 item 详情的 `segments` 前三项确认 `idx` 从 0 起连续:

```bash
node -e "const c=require('./server/tests/fixtures/library_contract.json');const h=c.http||c;for(const [k,v] of Object.entries(h)){if(v&&Array.isArray(v.segments)){console.log(k,JSON.stringify(v.segments.slice(0,3).map(s=>s.idx)))}}"
```

(只打印序号,不打印文字。)缺哪一项就在结果文档「W2 缺口」写「夹具缺 X,`attempts-contract.test.ts` 对应用例 `skipIf`」。

- [ ] **Step 8: 核对服务端来源(C5)**

```bash
grep -n "SOURCES" server/app/routers/speech.py
grep -n "Literal\[" server/app/routers/practice_items.py
```

两处都必须含 `"library"`;否则 **停止(BLOCKED)**(S1 未完成)。

- [ ] **Step 9: 核对跨 feature 基线与 W1 的导入(R-SH06)**

```bash
grep -n "CROSS_FEATURE_BASELINE.size" web/src/architecture.test.ts
grep -rn "features/practice" web/src/features/library/ || echo "library does not import practice yet"
grep -rn "web.library.shadow" web/src/features/library/i18n/ || echo "no shadow keys in W1 eager i18n"
```

记下 `toBe(N)` 的 N(写计划时 N = 18);库此时不应导入 practice;W1 的 `i18n/`(eager)不应有 `web.library.shadow`。

- [ ] **Step 10: 起草结果文档的 W2 一节** — 若文件不存在,先新建并写首行 `# 跟读库(video import)结果`;然后在文件**末尾追加**(不改别的段落):

```markdown
## W2 网页跟读与评测(plans/2026-10-13-video-import-web-shadow.md)

### 预检(Task 0,YYYY-MM-DD)
| 项 | 结果 |
|---|---|
| S1 / W1 已合并 | (提交号) |
| ShadowPanel / SegmentText props(W1 ↔ W2) | (逐项映射;缺项与处理) |
| 「译」开关怎么传给 ShadowPanel | (prop 名 / 无) |
| onSegmentSaved 是否函数式更新 | 是 / 否 |
| 效果组件(ClickSpark / CountUp / GradientText / BlurText / GlassSurface) | (每个:转出 W1 / 本地后备) |
| useLibraryConfig 的 ai 字段 | 有 / 无 |
| locales 子树结构 | (嵌套路径) |
| 改句 / 记成绩 / 译文 / 分析的错误文本与状态码 | (真实文本 → i18n 键;429 / 404 是否符合 C8) |
| 契约夹具键名 | attempts=…, attempt=…, segment=…, translate=…, analysis=…(缺项) |
| speech SOURCES / practice_items Literal 含 library | 是 / 否 |
| 跨 feature 基线 | N = … → Task 5 改为 N+1 |

### W2 缺口(交 Z)
- (Task 0 发现的每一项;没有就写「无」)
```

把 `YYYY-MM-DD` 与括号里的内容换成实际结果。

- [ ] **Step 11: 提交** — `git add docs/superpowers/plans/2026-10-13-video-import-results.md`,信息 `docs: video import W2 preflight results`(末行 Co-Authored-By)。

---

## Task 1: 练习的来源类型加 `library`

**Files:**
- Modify: `web/src/features/practice/practice-items-api.ts`、`web/src/features/practice/assessment-api.ts`、`web/src/features/practice/practice-list-page.tsx`、`web/src/features/practice/i18n/en.json`、`web/src/features/practice/i18n/zh-CN.json`、`web/src/features/practice/CLAUDE.md`
- Test(追加用例): `web/src/features/practice/practice-items-api.test.ts`、`web/src/features/practice/assessment-api.test.ts`、`web/src/features/practice/practice-list-page.test.tsx`

**Interfaces:**
- Produces:`PracticeItemSource = "chat" | "lookup" | "grammar" | "manual" | "library"`;`export type AssessmentSource = "practice" | "chat" | "library"`;`assessPronunciation(api, { …, source?: AssessmentSource })`

- [ ] **Step 1: 写失败测试**

`web/src/features/practice/practice-items-api.test.ts`:在 `describe("practice items api", …)` 里、`it("builds a practice reference", …)` 之前追加:

```ts
  it("accepts library as a source (spec 2026-10-13-video-import §2.2)", async () => {
    const mock = createFetchMock({ "POST /api/practice-items": () => json({ ...ITEM, source: "library" }) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const saved = await addPracticeItem(api, { text: "From a video.", source: "library" });
    expect(saved.source).toBe("library");
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ text: "From a video.", source: "library" });
  });
```

`web/src/features/practice/assessment-api.test.ts`:在最后一个 `it(…)` 之后追加:

```ts
  it("saves library shadowing with source=library", async () => {
    const mock = createFetchMock({ "POST /api/speech/assessments": () => json({ pronunciation_score: 70, assessment_id: "a2" }) });
    const client = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await assessPronunciation(client, { wav: new Blob(["RIFF"]), reference: "Hello world.", language: "en-US", save: true, source: "library" });
    const form = mock.calls[0].body as FormData;
    expect(form.get("source")).toBe("library");
    expect(form.get("reference")).toBe("Hello world.");
    expect(mock.calls[0].url.search).toBe("");
  });
```

`web/src/features/practice/practice-list-page.test.tsx`:在 `describe("PracticeListPage", …)` 里第一个 `it` 之后追加:

```ts
  it("labels sentences saved from the shadowing library", async () => {
    setup({ "GET /api/practice-items": () => json({ practice_items: [item("p1", "From a video.", "library")], page: 1, next: null }) });
    expect(await screen.findByTestId("practice-item")).toHaveTextContent("Shadowing library");
  });
```

- [ ] **Step 2: 跑测试确认失败** — `yarn web:typecheck`(两处 `"library"` 不在联合类型里:类型错误)与 `cd web && yarn vitest run src/features/practice/practice-list-page.test.tsx`(显示的是键名 `web.practice.list.sources.library`,断言失败)。

- [ ] **Step 3: 实现**

`web/src/features/practice/practice-items-api.ts` 第 4 行改为:

```ts
export type PracticeItemSource = "chat" | "lookup" | "grammar" | "manual" | "library";
```

`web/src/features/practice/assessment-api.ts`:在 `export const ASSESSMENT_TIMEOUT_MS = 330_000;` 之前插入:

```ts
/** 保存评测时的来源;服务端 routers/speech.py 的 SOURCES 必须同时含有它(library:跟读库,spec 2026-10-13-video-import §9)。 */
export type AssessmentSource = "practice" | "chat" | "library";

```

并把 `assessPronunciation` 的参数类型里 `source?: "practice" | "chat"` 改为 `source?: AssessmentSource`。

`web/src/features/practice/practice-list-page.tsx`:第 1 行的 lucide 导入改为

```ts
import { FilmIcon, MessagesSquareIcon, PencilIcon, SearchIcon, SpellCheckIcon, Trash2Icon, type LucideIcon } from "lucide-react";
```

`SOURCE` 表 `manual: { tone: "gray", icon: PencilIcon },` 之后加一行:

```ts
  library: { tone: "gray", icon: FilmIcon },
```

`web/src/features/practice/i18n/en.json` 的 `"sources"` 一行改为:

```json
        "sources": { "chat": "Chat", "lookup": "Dictionary", "grammar": "Grammar correction", "manual": "Added by you", "library": "Shadowing library" },
```

`web/src/features/practice/i18n/zh-CN.json` 的 `"sources"` 一行改为:

```json
        "sources": { "chat": "对话", "lookup": "查词", "grammar": "语法改正", "manual": "手动添加", "library": "跟读库" },
```

`web/src/features/practice/CLAUDE.md` 的「What lives here」第二条末尾追加一句:` Sources include `library` (shadowing library, plan 2026-10-13-video-import-web-shadow); `PracticeItemSource` / `AssessmentSource` must match the server.`

- [ ] **Step 4: 跑测试确认通过** — `yarn web:typecheck`;`cd web && yarn vitest run src/features/practice/practice-items-api.test.ts src/features/practice/assessment-api.test.ts src/features/practice/practice-list-page.test.tsx src/i18n/i18n.test.ts src/architecture.test.ts`。

- [ ] **Step 5: 提交** — `feat(web): accept library as a practice item and assessment source`。

---
## Task 2: 成绩 / 改句 / 译文 / 分析的 API、最好成绩缓存、本车道文案子树

**Files:**
- Create: `web/src/features/library/attempts-api.ts`、`attempts-api.test.ts`、`attempts-contract.test.ts`、`shadow-locales.test.ts`
- Modify: `web/src/features/library/locales/en.json`、`web/src/features/library/locales/zh-CN.json`(只换 `web.library.shadow` 子树,R-SH04)

**Interfaces:**
- Produces:`SegmentBest`、`SavedSegment`、`SegmentWithAi`、`SegmentPatch`、`TranslatedSegment`、`TranslateResult`、`AnalysisResult`、`SHADOW_SERVER_ERRORS`、`ANALYSIS_TIMEOUT_MS`、`BEST_TTL_MS`、`listAttempts(api, itemId, signal?) → Promise<SegmentBest[]>`、`recordAttempt(api, itemId, {segIdx, assessmentId}) → Promise<unknown>`、`patchSegment(api, itemId, idx, patch, base) → Promise<SavedSegment>`、`translateSegments(api, itemId, indices, nativeLanguage, signal?) → Promise<TranslateResult>`、`analyzeSegment(api, itemId, idx, nativeLanguage, signal?) → Promise<AnalysisResult>`、`bestBySegment(rows)`、`mergeBest(map, segIdx, score, at?)`、`mergeServerBest(server, local)`、`loadBest(api, itemId, now?) → Promise<Map<number, SegmentBest>>`、`peekBest(itemId)`、`noteAttempt(itemId, segIdx, score, at?) → Map`、`resetBestCache()`
- Consumes:`ApiClient.request`(响应 deep camelCase,请求 `json` deep snake_case;**核对** `web/src/api/client.ts`:选项 `json`、`signal`、`timeoutMs`)

- [ ] **Step 1: 写失败测试**

`web/src/features/library/attempts-api.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import {
  BEST_TTL_MS, SHADOW_SERVER_ERRORS, analyzeSegment, bestBySegment, listAttempts, loadBest, mergeBest, mergeServerBest, noteAttempt,
  patchSegment, peekBest, recordAttempt, resetBestCache, translateSegments, type SavedSegment,
} from "./attempts-api";

const client = (routes: Parameters<typeof createFetchMock>[0]) => {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};
const BASE: SavedSegment = { idx: 2, startMs: 1000, endMs: 3000, text: "Hello world." };

describe("library attempts api (spec §9)", () => {
  beforeEach(() => resetBestCache());

  it("lists best scores per sentence from a bare array, id encoded in the path, no query", async () => {
    const { api, mock } = client({
      "GET /api/library/items/i%2F1/attempts": () => json([
        { seg_idx: 0, best_score: 91, count: 2, last_at: "2026-10-13T00:00:00Z" },
        { seg_idx: 4, best_score: null, count: 0, last_at: null },
      ]),
    });
    expect(await listAttempts(api, "i/1")).toEqual([
      { segIdx: 0, bestScore: 91, count: 2, lastAt: "2026-10-13T00:00:00Z" },
      { segIdx: 4, bestScore: null, count: 0, lastAt: null },
    ]);
    expect(mock.calls[0].url.search).toBe("");
    expect(mock.calls[0].headers.get("Authorization")).toBe("Bearer t");
  });

  it("accepts a wrapped list and drops malformed rows", async () => {
    const { api } = client({
      "GET /api/library/items/i1/attempts": () => json({ attempts: [{ seg_idx: 1, best_score: 70, count: 1, last_at: null }, { best_score: 3 }] }),
    });
    expect(await listAttempts(api, "i1")).toEqual([{ segIdx: 1, bestScore: 70, count: 1, lastAt: null }]);
  });

  it("records an attempt with the assessment id in the JSON body", async () => {
    const { api, mock } = client({ "POST /api/library/items/i1/attempts": () => json({ seg_idx: 3, best_score: 82, count: 1 }) });
    await recordAttempt(api, "i1", { segIdx: 3, assessmentId: "a1" });
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ seg_idx: 3, assessment_id: "a1" });
    expect(mock.calls[0].url.search).toBe("");
  });

  it("patches only the given keys and returns the server's segment", async () => {
    const { api, mock } = client({
      "PATCH /api/library/items/i1/segments/2": () => json({ idx: 2, start_ms: 1400, end_ms: 3000, text: "Hello world." }),
    });
    expect(await patchSegment(api, "i1", 2, { startMs: 1400 }, BASE)).toEqual({ idx: 2, startMs: 1400, endMs: 3000, text: "Hello world." });
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ start_ms: 1400 });
  });

  it("falls back to the local edit when the response carries no segment, and unwraps {segment}", async () => {
    const empty = client({ "PATCH /api/library/items/i1/segments/2": () => new Response(null, { status: 200 }) });
    expect(await patchSegment(empty.api, "i1", 2, { text: "Hello there." }, BASE)).toEqual({ ...BASE, text: "Hello there." });
    const wrapped = client({
      "PATCH /api/library/items/i1/segments/2": () => json({ segment: { idx: 2, start_ms: 1000, end_ms: 3200, text: "Hello world." } }),
    });
    expect(await patchSegment(wrapped.api, "i1", 2, { endMs: 3200 }, BASE)).toEqual({ ...BASE, endMs: 3200 });
  });

  it("keeps best scores per sentence and merges a new attempt", () => {
    const map = bestBySegment([{ segIdx: 1, bestScore: 80, count: 2, lastAt: null }]);
    const next = mergeBest(map, 1, 86.6, "2026-10-13T01:00:00Z");
    expect(next.get(1)).toEqual({ segIdx: 1, bestScore: 87, count: 3, lastAt: "2026-10-13T01:00:00Z" });
    expect(map.get(1)!.count).toBe(2); // 不改原表
    expect(mergeBest(next, 1, 50, "x").get(1)!.bestScore).toBe(87);
    expect(mergeBest(new Map(), 5, 61.2, "y").get(5)).toEqual({ segIdx: 5, bestScore: 61, count: 1, lastAt: "y" });
  });

  it("prefers the server row unless this page has recorded more attempts", () => {
    const server = bestBySegment([{ segIdx: 1, bestScore: 90, count: 4, lastAt: null }, { segIdx: 2, bestScore: 70, count: 1, lastAt: null }]);
    const local = bestBySegment([{ segIdx: 1, bestScore: 60, count: 1, lastAt: null }, { segIdx: 3, bestScore: 75, count: 1, lastAt: null }]);
    const merged = mergeServerBest(server, local);
    expect(merged.get(1)!.bestScore).toBe(90);
    expect(merged.get(2)!.bestScore).toBe(70);
    expect(merged.get(3)!.bestScore).toBe(75);
  });
});

describe("best-score cache (plan W2 R-SH30)", () => {
  beforeEach(() => resetBestCache());

  it("fetches once per item, shares the in-flight request, and folds in local attempts", async () => {
    const { api, mock } = client({ "GET /api/library/items/i1/attempts": () => json([{ seg_idx: 1, best_score: 80, count: 2, last_at: null }]) });
    const [a, b] = await Promise.all([loadBest(api, "i1"), loadBest(api, "i1")]);
    expect(mock.calls).toHaveLength(1);
    expect(a).toBe(b);
    expect((await loadBest(api, "i1")).get(1)!.bestScore).toBe(80);
    expect(mock.calls).toHaveLength(1);
    expect(peekBest("i1")!.get(1)!.bestScore).toBe(80);
    const noted = noteAttempt("i1", 1, 90.2, "2026-10-13T02:00:00Z");
    expect(noted.get(1)).toMatchObject({ bestScore: 90, count: 3 });
    expect(peekBest("i1")).toBe(noted);
  });

  it("refetches after the ttl and keeps a local attempt the server snapshot does not yet include", async () => {
    const { api, mock } = client({ "GET /api/library/items/i1/attempts": () => json([{ seg_idx: 1, best_score: 80, count: 2, last_at: null }]) });
    await loadBest(api, "i1", 1_000);
    noteAttempt("i1", 1, 95, "x");
    const again = await loadBest(api, "i1", 1_000 + BEST_TTL_MS + 1);
    expect(mock.calls).toHaveLength(2);
    expect(again.get(1)).toMatchObject({ bestScore: 95, count: 3 });
  });

  it("notes an attempt even when the list was never fetched, and a later fetch merges instead of replacing", async () => {
    const { api } = client({ "GET /api/library/items/i2/attempts": () => json([{ seg_idx: 7, best_score: 60, count: 1, last_at: null }]) });
    noteAttempt("i2", 3, 77, "x");
    const loaded = await loadBest(api, "i2");
    expect(loaded.get(3)).toMatchObject({ bestScore: 77, count: 1 });
    expect(loaded.get(7)).toMatchObject({ bestScore: 60, count: 1 });
  });

  it("does not cache a failed fetch", async () => {
    let fail = true;
    const { api, mock } = client({ "GET /api/library/items/i3/attempts": () => (fail ? json({ error: "boom" }, 500) : json([])) });
    await expect(loadBest(api, "i3")).rejects.toBeInstanceOf(ApiError);
    fail = false;
    expect((await loadBest(api, "i3")).size).toBe(0);
    expect(mock.calls).toHaveLength(2);
  });
});

describe("translate and analysis calls (spec §9, D8)", () => {
  it("posts the indices and native language in the body, never in the URL", async () => {
    const { api, mock } = client({
      "POST /api/library/items/i1/translate": () => json([{ idx: 1, zh: "你好" }, { idx: 2, zh: "" }, { zh: "x" }]),
    });
    expect(await translateSegments(api, "i1", [1, 2], "zh-CN")).toEqual({ items: [{ idx: 1, zh: "你好" }], limited: false });
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ indices: [1, 2], native_language: "zh-CN" });
    expect(mock.calls[0].url.search).toBe("");
  });

  it("reads a wrapped result and the limited flag", async () => {
    const { api } = client({
      "POST /api/library/items/i1/translate": () => json({ items: [{ idx: 3, zh: "好" }], limited: true }),
    });
    expect(await translateSegments(api, "i1", [3, 4], "zh-CN")).toEqual({ items: [{ idx: 3, zh: "好" }], limited: true });
  });

  it("requests an analysis for one sentence and returns the stored text", async () => {
    const { api, mock } = client({
      "POST /api/library/items/i1/segments/2/analysis": () => json({ analysis: "### Grammar\nbe going to", cached: true }),
    });
    expect(await analyzeSegment(api, "i1", 2, "zh-CN")).toEqual({ analysis: "### Grammar\nbe going to", cached: true });
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ native_language: "zh-CN" });
    expect(mock.calls[0].url.search).toBe("");
  });

  it("treats an empty analysis as an error and keeps the status of a refusal", async () => {
    const empty = client({ "POST /api/library/items/i1/segments/2/analysis": () => json({ analysis: "  ", cached: false }) });
    await expect(analyzeSegment(empty.api, "i1", 2, "zh-CN")).rejects.toBeInstanceOf(ApiError);
    const full = client({ "POST /api/library/items/i1/segments/2/analysis": () => json({ error: "Daily limit reached" }, 429) });
    await expect(analyzeSegment(full.api, "i1", 2, "zh-CN")).rejects.toMatchObject({ status: 429 });
  });

  it("maps every server error to a key that exists in both languages", async () => {
    const en = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("./locales/en.json", import.meta.url), "utf8"));
    const zh = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("./locales/zh-CN.json", import.meta.url), "utf8"));
    const at = (d: unknown, key: string) => key.split(".").reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], d);
    expect(Object.keys(SHADOW_SERVER_ERRORS).length).toBeGreaterThan(0);
    for (const key of Object.values(SHADOW_SERVER_ERRORS)) {
      expect(typeof at(en, key), `en ${key}`).toBe("string");
      expect(typeof at(zh, key), `zh ${key}`).toBe("string");
    }
  });
});
```

`web/src/features/library/shadow-locales.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
type Dict = Record<string, unknown>;
const load = (name: string): Dict => JSON.parse(readFileSync(path.join(here, "locales", name), "utf8"));
const en = load("en.json");
const zh = load("zh-CN.json");
const at = (d: unknown, p: string): unknown => p.split(".").reduce<unknown>((acc, k) => (acc as Dict | undefined)?.[k], d);
const leaves = (d: unknown, prefix = ""): string[] =>
  d && typeof d === "object" ? Object.entries(d as Dict).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k)) : [prefix];

// W2 拥有的源文件(Task 2 时多数还不存在,存在才扫)
const W2_SOURCES = [
  "attempts-api.ts", "word-tap.ts", "save-sentence.tsx", "use-shadowing.ts", "score-card.tsx", "segment-editor.tsx",
  "analysis-card.tsx", "use-translations.ts", "segment-menu.tsx", "shadow-panel.tsx",
].filter((f) => existsSync(path.join(here, f)));

describe("web.library.shadow strings (plan W2 R-SH04)", () => {
  it("has the same keys in en and zh-CN", () => {
    const a = leaves(at(en, "web.library.shadow")).sort();
    const b = leaves(at(zh, "web.library.shadow")).sort();
    expect(a.length).toBeGreaterThan(30);
    expect(a).toEqual(b);
  });

  it("has the same interpolation placeholders in both languages", () => {
    const slots = (s: unknown) => (String(s).match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort().join(",");
    for (const key of leaves(at(en, "web.library.shadow"))) {
      expect(slots(at(en, `web.library.shadow.${key}`)), key).toBe(slots(at(zh, `web.library.shadow.${key}`)));
    }
  });

  it("defines every web.library.shadow.* literal the W2 sources use", () => {
    for (const file of W2_SOURCES) {
      const source = readFileSync(path.join(here, file), "utf8");
      for (const m of source.matchAll(/["'`](web\.library\.shadow\.[A-Za-z0-9_.]+?)["'`]/g)) {
        const key = m[1];
        if (key.endsWith(".")) continue;
        expect(typeof at(en, key), `${file}: ${key} in en`).toBe("string");
        expect(typeof at(zh, key), `${file}: ${key} in zh-CN`).toBe("string");
      }
    }
  });

  it("defines the keys built from templates (editor edges)", () => {
    for (const edge of ["start", "end"]) {
      for (const suffix of ["", "Earlier", "Later"]) {
        const key = `web.library.shadow.editor.${edge}${suffix}`;
        expect(typeof at(en, key), key).toBe("string");
        expect(typeof at(zh, key), key).toBe("string");
      }
    }
    for (const tone of ["good", "fair", "low"]) {
      expect(typeof at(en, `web.library.shadow.score.${tone}`)).toBe("string");
      expect(typeof at(zh, `web.library.shadow.score.${tone}`)).toBe("string");
    }
  });
});
```

`web/src/features/library/attempts-contract.test.ts`(`KEYS` 用 Task 0 Step 7 读到的真实键名替换;夹具缺的项把对应 `it` 改成 `it.skipIf(true)` 或删掉):

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { analyzeSegment, listAttempts, patchSegment, translateSegments } from "./attempts-api";

/** server/tests/fixtures/library_contract.json 由 S1 的 server/tests/test_library_contract.py 录制(spec §9)。键名见 W2 Task 0 Step 7。 */
const KEYS = {
  attempts: "attempts_list", attempt: "attempt_create", segment: "segment_patch", translate: "translate", analysis: "analysis",
} as const;
const here = path.dirname(fileURLToPath(import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const C: Record<string, any> = JSON.parse(readFileSync(path.resolve(here, "../../../../server/tests/fixtures/library_contract.json"), "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const H: Record<string, any> = C.http ?? C;
const api = (routes: Parameters<typeof createFetchMock>[0]) => new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock(routes).fetch });

describe("library shadowing payloads (recorded from the real server)", () => {
  it("attempt rows carry the fields the panel reads", async () => {
    const body = H[KEYS.attempts];
    const rows = Array.isArray(body) ? body : body.attempts;
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(camelcaseKeys(rows[0], { deep: true }))).toEqual(expect.arrayContaining(["segIdx", "bestScore", "count", "lastAt"]));
    const parsed = await listAttempts(api({ "GET /api/library/items/i1/attempts": () => json(body) }), "i1");
    expect(parsed).toHaveLength(rows.length);
    expect(typeof parsed[0].segIdx).toBe("number");
  });

  it("the attempt create response exists (the client does not read it)", () => {
    expect(H[KEYS.attempt]).toBeDefined();
  });

  it("the segment PATCH response parses into a segment", async () => {
    const body = H[KEYS.segment];
    const base = { idx: 0, startMs: 0, endMs: 1, text: "x" };
    const saved = await patchSegment(api({ "PATCH /api/library/items/i1/segments/0": () => json(body) }), "i1", 0, { endMs: 1 }, base);
    const raw = camelcaseKeys((body && body.segment) || body || {}, { deep: true }) as Record<string, unknown>;
    if (typeof raw.startMs === "number") expect(saved.startMs).toBe(raw.startMs);
    if (typeof raw.endMs === "number") expect(saved.endMs).toBe(raw.endMs);
    if (typeof raw.text === "string") expect(saved.text).toBe(raw.text);
    expect(saved.idx).toBe(0);
  });

  it.skipIf(!H[KEYS.translate])("the translate response parses into non-empty rows", async () => {
    const body = H[KEYS.translate];
    const parsed = await translateSegments(api({ "POST /api/library/items/i1/translate": () => json(body) }), "i1", [0], "zh-CN");
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(typeof parsed.items[0].idx).toBe("number");
    expect(parsed.items[0].zh.length).toBeGreaterThan(0);
  });

  it.skipIf(!H[KEYS.analysis])("the analysis response parses into text", async () => {
    const body = H[KEYS.analysis];
    const parsed = await analyzeSegment(api({ "POST /api/library/items/i1/segments/0/analysis": () => json(body) }), "i1", 0, "zh-CN");
    expect(parsed.analysis.length).toBeGreaterThan(0);
    expect(typeof parsed.cached).toBe("boolean");
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/attempts-api.test.ts src/features/library/shadow-locales.test.ts src/features/library/attempts-contract.test.ts`(模块不存在 / 子树键数不足)。

- [ ] **Step 3: 实现 API** — `web/src/features/library/attempts-api.ts`(`SHADOW_SERVER_ERRORS` 的**键**按 Task 0 Step 6 的真实文本改):

```ts
import { ApiError, type ApiClient } from "~/api/client";

/** 某一句的成绩汇总(GET …/attempts 的一行,spec §9)。 */
export interface SegmentBest {
  segIdx: number;
  bestScore: number | null;
  count: number;
  lastAt: string | null;
}

/** 一句的起止与文字(与 GET /api/library/items/{id} 的 segments 同形,camelCase;W1 的 LibrarySegment 是它的超集)。 */
export interface SavedSegment {
  idx: number;
  startMs: number;
  endMs: number;
  text: string;
}

/** D8 增补的可选字段(spec §4、§15 W1 行;W1 的 LibrarySegment 若已声明同名字段则兼容):译文 / 分析与它们的语言。 */
export type SegmentWithAi = SavedSegment & {
  zh?: string | null;
  zhLang?: string | null;
  analysis?: string | null;
  analysisLang?: string | null;
};

export interface SegmentPatch {
  startMs?: number;
  endMs?: number;
  text?: string;
}

/** 改句 / 记成绩的服务端错误 → 文案键(plan W2 R-SH19;键 = S1 routers/library.py 的固定英文文本)。译文与分析按状态码处理,不在这里。 */
export const SHADOW_SERVER_ERRORS: Record<string, string> = {
  "Library item not found": "web.library.shadow.errors.notFound",
  "Segment not found": "web.library.shadow.errors.notFound",
  "Invalid segment times": "web.library.shadow.errors.badTimes",
  "Invalid segment text": "web.library.shadow.errors.badText",
};

/** 句子分析要等大模型,比默认的 60 s 超时放宽一点。 */
export const ANALYSIS_TIMEOUT_MS = 120_000;

const itemPath = (itemId: string) => `/api/library/items/${encodeURIComponent(itemId)}`;

function toBest(row: unknown): SegmentBest[] {
  const r = row as Partial<SegmentBest> | null;
  if (!r || typeof r.segIdx !== "number") return [];
  return [{
    segIdx: r.segIdx,
    bestScore: typeof r.bestScore === "number" ? r.bestScore : null,
    count: typeof r.count === "number" ? r.count : 0,
    lastAt: typeof r.lastAt === "string" ? r.lastAt : null,
  }];
}

/** 每句最好成绩;接受裸数组或 {attempts: [...]}(R-SH11)。 */
export async function listAttempts(api: ApiClient, itemId: string, signal?: AbortSignal): Promise<SegmentBest[]> {
  const res = await api.request<unknown>("GET", `${itemPath(itemId)}/attempts`, { signal });
  const rows = Array.isArray(res) ? res : (res as { attempts?: unknown } | null)?.attempts;
  return Array.isArray(rows) ? rows.flatMap(toBest) : [];
}

/** 记一次跟读成绩;服务端核对评测属于本人、source=library、参考文本与该句一致(spec §9)。响应不读。 */
export function recordAttempt(api: ApiClient, itemId: string, input: { segIdx: number; assessmentId: string }): Promise<unknown> {
  return api.request("POST", `${itemPath(itemId)}/attempts`, { json: input });
}

/** 改一句的起止 / 文字;响应可为句子、{segment} 或空,缺的字段用本地值补(R-SH11)。 */
export async function patchSegment(api: ApiClient, itemId: string, idx: number, patch: SegmentPatch, base: SavedSegment): Promise<SavedSegment> {
  const res = await api.request<unknown>("PATCH", `${itemPath(itemId)}/segments/${encodeURIComponent(String(idx))}`, { json: patch });
  const inner = res && typeof res === "object" && "segment" in res ? (res as { segment: unknown }).segment : res;
  const r = (inner && typeof inner === "object" ? inner : {}) as Partial<SavedSegment>;
  return {
    idx: base.idx,
    startMs: typeof r.startMs === "number" ? r.startMs : patch.startMs ?? base.startMs,
    endMs: typeof r.endMs === "number" ? r.endMs : patch.endMs ?? base.endMs,
    text: typeof r.text === "string" ? r.text : patch.text ?? base.text,
  };
}

export interface TranslatedSegment {
  idx: number;
  zh: string;
}

export interface TranslateResult {
  items: TranslatedSegment[];
  /** 额度满:已有的照常返回,缺的没有生成(spec §9) */
  limited: boolean;
}

/** 批量译文(D8、E12:一次 ≤ 20 句)。响应接受裸数组或带 limited 的对象(R-SH27);空译文与坏行丢弃。 */
export async function translateSegments(
  api: ApiClient, itemId: string, indices: number[], nativeLanguage: string, signal?: AbortSignal,
): Promise<TranslateResult> {
  const res = await api.request<unknown>("POST", `${itemPath(itemId)}/translate`, { json: { indices, nativeLanguage }, signal });
  const obj = (res && typeof res === "object" && !Array.isArray(res) ? res : {}) as Record<string, unknown>;
  const rows = Array.isArray(res) ? res : [obj.items, obj.translations, obj.segments].find(Array.isArray);
  const items = (Array.isArray(rows) ? rows : []).flatMap((row): TranslatedSegment[] => {
    const r = row as Partial<TranslatedSegment> | null;
    return r && typeof r.idx === "number" && typeof r.zh === "string" && r.zh ? [{ idx: r.idx, zh: r.zh }] : [];
  });
  return { items, limited: obj.limited === true };
}

export interface AnalysisResult {
  /** 模型返回的原文(桌面端 analyze 提示词的分节 markdown,R-SH28) */
  analysis: string;
  cached: boolean;
}

/** 一句的 AI 分析(D8);空文本当作失败。额度满(429)与未开启(404)的状态码原样抛出(R-SH28)。 */
export async function analyzeSegment(
  api: ApiClient, itemId: string, idx: number, nativeLanguage: string, signal?: AbortSignal,
): Promise<AnalysisResult> {
  const res = await api.request<unknown>("POST", `${itemPath(itemId)}/segments/${encodeURIComponent(String(idx))}/analysis`, {
    json: { nativeLanguage }, signal, timeoutMs: ANALYSIS_TIMEOUT_MS,
  });
  const r = (res && typeof res === "object" ? res : {}) as { analysis?: unknown; cached?: unknown };
  if (typeof r.analysis !== "string" || !r.analysis.trim()) throw new ApiError(502, "Empty analysis");
  return { analysis: r.analysis, cached: r.cached === true };
}

export function bestBySegment(rows: SegmentBest[]): Map<number, SegmentBest> {
  return new Map(rows.map((r) => [r.segIdx, r]));
}

/** 本页刚记下的一次成绩并入汇总(不改原表);分数取整,与服务端的 SmallInteger 一致。 */
export function mergeBest(map: Map<number, SegmentBest>, segIdx: number, score: number, at: string = new Date().toISOString()): Map<number, SegmentBest> {
  const next = new Map(map);
  const prev = map.get(segIdx);
  const rounded = Math.round(score);
  next.set(segIdx, {
    segIdx,
    bestScore: prev && typeof prev.bestScore === "number" ? Math.max(prev.bestScore, rounded) : rounded,
    count: (prev ? prev.count : 0) + 1,
    lastAt: at,
  });
  return next;
}

/** 服务端汇总晚于本页的记录到达时:以服务端为准,除非本页已记得更多次(它的快照还没包含它们)。 */
export function mergeServerBest(server: Map<number, SegmentBest>, local: Map<number, SegmentBest>): Map<number, SegmentBest> {
  const next = new Map(server);
  for (const [k, v] of local) {
    const s = next.get(k);
    if (!s || v.count > s.count) next.set(k, v);
  }
  return next;
}

// ---- 最好成绩缓存(R-SH30):当前句一变,旧句的 ActivePanel 卸载、新句的挂载,不能每换一句就 GET 一次 ----

/** 缓存多久后重取(同一次观看里别的设备记的成绩不会立刻出现,可接受)。 */
export const BEST_TTL_MS = 5 * 60_000;

interface BestEntry {
  map: Map<number, SegmentBest>;
  /** 取自服务端的时间;只有本地记录、从未取过时为 0(下次 loadBest 会取并合并) */
  at: number;
}
const bestCache = new Map<string, BestEntry>();
const bestInflight = new Map<string, Promise<Map<number, SegmentBest>>>();

export function peekBest(itemId: string): Map<number, SegmentBest> | undefined {
  return bestCache.get(itemId)?.map;
}

/** 取条目的每句最好成绩:ttl 内命中缓存;并发请求合并成一次;失败不缓存(调用方自行忽略)。 */
export function loadBest(api: ApiClient, itemId: string, now: number = Date.now()): Promise<Map<number, SegmentBest>> {
  const hit = bestCache.get(itemId);
  if (hit && hit.at > 0 && now - hit.at < BEST_TTL_MS) return Promise.resolve(hit.map);
  const pending = bestInflight.get(itemId);
  if (pending) return pending;
  const request = listAttempts(api, itemId)
    .then((rows) => {
      const merged = mergeServerBest(bestBySegment(rows), bestCache.get(itemId)?.map ?? new Map()); // 在回调里读缓存:期间可能已记了新成绩
      bestCache.set(itemId, { map: merged, at: now });
      return merged;
    })
    .finally(() => {
      bestInflight.delete(itemId);
    });
  bestInflight.set(itemId, request);
  return request;
}

/** 本页记下一次成绩(POST attempts 成功后调);返回合并后的新表。 */
export function noteAttempt(itemId: string, segIdx: number, score: number, at?: string): Map<number, SegmentBest> {
  const cur = bestCache.get(itemId);
  const map = mergeBest(cur?.map ?? new Map(), segIdx, score, at);
  bestCache.set(itemId, { map, at: cur?.at ?? 0 });
  return map;
}

/** 只给测试:清空缓存与在途请求。 */
export function resetBestCache(): void {
  bestCache.clear();
  bestInflight.clear();
}
```

- [ ] **Step 4: 换文案子树** — 对 `web/src/features/library/locales/en.json` 与 `zh-CN.json`,用 Edit 工具把 `web.library.shadow` 这一个对象(W1 预置的那一棵,从 `"shadow": {` 到它的闭合 `}`)整棵替换为下面的内容;**子树之外一字不动**,嵌套路径以 Task 0 Step 5 的记录为准(下面示例是 `web → library → shadow`):

`locales/en.json` 的 `shadow` 对象:

```json
"shadow": {
  "best": "Best {{score}}",
  "record": "Shadow",
  "stop": "Stop",
  "assessing": "Scoring…",
  "listenOriginal": "Play the original sentence",
  "listenMine": "Play my recording",
  "stopMine": "Stop my recording",
  "more": "More actions",
  "save": "Add to practice list",
  "saved": "Added to practice list",
  "noSpeech": "We did not hear you. Try again a little louder.",
  "attemptNotSaved": "Scored, but not added to this item's best scores.",
  "translateLimited": "Today's translation limit is used up. Sentences already translated stay available.",
  "translateFailed": "Could not load translations. Turn the translation switch off and on to try again.",
  "menu": {
    "title": "Sentence actions",
    "description": "Choose what to do with this sentence.",
    "copy": "Copy sentence",
    "copied": "Sentence copied.",
    "copySelected": "Sentence selected. Copy it manually.",
    "copyFailed": "Could not copy the sentence.",
    "analysis": "AI analysis",
    "analysisClose": "Hide AI analysis",
    "edit": "Adjust timing and text"
  },
  "score": {
    "good": "Great pronunciation",
    "fair": "Pretty good",
    "low": "Keep practising"
  },
  "analysis": {
    "title": "AI analysis",
    "loading": "Analysing this sentence…",
    "retry": "Retry",
    "collapse": "Collapse",
    "expand": "Expand",
    "limited": "Today's analysis limit is used up.",
    "unavailable": "AI analysis is not available."
  },
  "editor": {
    "title": "Adjust sentence",
    "start": "Start",
    "end": "End",
    "startEarlier": "Start 0.2 s earlier",
    "startLater": "Start 0.2 s later",
    "endEarlier": "End 0.2 s earlier",
    "endLater": "End 0.2 s later",
    "text": "Text",
    "save": "Save",
    "saving": "Saving…",
    "cancel": "Cancel",
    "saved": "Sentence updated.",
    "invalidText": "The text must contain letters (600 characters max)."
  },
  "errors": {
    "notFound": "This sentence no longer exists. Reload the page.",
    "badTimes": "Those times overlap a neighbouring sentence or fall outside the media.",
    "badText": "The text must contain letters (600 characters max)."
  }
}
```

`locales/zh-CN.json` 的 `shadow` 对象:

```json
"shadow": {
  "best": "最好 {{score}}",
  "record": "跟读",
  "stop": "停止",
  "assessing": "评分中…",
  "listenOriginal": "听原句",
  "listenMine": "听我的录音",
  "stopMine": "停止播放我的录音",
  "more": "更多操作",
  "save": "加入练习清单",
  "saved": "已加入练习清单",
  "noSpeech": "没听到声音,请大声一点再试一次。",
  "attemptNotSaved": "已评分,但没有记入本条素材的最好成绩。",
  "translateLimited": "今日译文额度已用完,已翻译的句子仍可查看。",
  "translateFailed": "译文加载失败,关闭再打开「译」可重试。",
  "menu": {
    "title": "句子操作",
    "description": "选择对这一句要做的操作。",
    "copy": "复制句子",
    "copied": "已复制句子。",
    "copySelected": "已选中句子,请手动复制。",
    "copyFailed": "无法复制句子。",
    "analysis": "AI 分析",
    "analysisClose": "收起 AI 分析",
    "edit": "微调"
  },
  "score": {
    "good": "发音很棒",
    "fair": "不错,还能更好",
    "low": "再练一练"
  },
  "analysis": {
    "title": "AI 分析",
    "loading": "正在分析这句话…",
    "retry": "重试",
    "collapse": "收起",
    "expand": "展开",
    "limited": "今日 AI 分析额度已用完。",
    "unavailable": "AI 分析暂不可用。"
  },
  "editor": {
    "title": "微调句子",
    "start": "起点",
    "end": "终点",
    "startEarlier": "起点提前 0.2 秒",
    "startLater": "起点推后 0.2 秒",
    "endEarlier": "终点提前 0.2 秒",
    "endLater": "终点推后 0.2 秒",
    "text": "文字",
    "save": "保存",
    "saving": "保存中…",
    "cancel": "取消",
    "saved": "句子已更新。",
    "invalidText": "文字必须包含字母(最多 600 字)。"
  },
  "errors": {
    "notFound": "这一句已不存在,请刷新页面。",
    "badTimes": "时间与相邻句重叠,或超出了媒体时长。",
    "badText": "文字必须包含字母(最多 600 字)。"
  }
}
```

(英文复数规则:本子树没有需要复数的键。W1 自己的 `locales.test.ts` 会再检查两份文件的键集一致。)

- [ ] **Step 5: 跑测试确认通过** — `yarn web:typecheck`;`cd web && yarn vitest run src/features/library/attempts-api.test.ts src/features/library/shadow-locales.test.ts src/features/library/attempts-contract.test.ts src/features/library/locales.test.ts src/i18n/i18n.test.ts src/architecture.test.ts`(`locales.test.ts` 是 W1 的文件,只跑不改;不存在就从命令里去掉)。

- [ ] **Step 6: 提交** — `feat(web): library shadowing attempts, translate and analysis API with the shadow strings`。

---

## Task 3: 分词、逐词着色、点词选区、评分词色 store

**Files:**
- Create: `web/src/features/library/word-tap.ts`、`web/src/features/library/word-tap.test.ts`、`web/src/features/library/word-scores.test.ts`

**Interfaces:**
- Produces:`SentenceToken { text; word }`(`word` = 词序号,非词片段为 `-1`)、`tokenizeSentence(text)`、`WordScore`(与 practice 的 `AssessmentWordBrief` 同形)、`wordTones(tokens, words?, lookahead = 3) → Array<ScoreTone | null>`(按词序号)、`selectWord(el, doc?) → boolean`、`publishWordScores(idx, text, words)`、`clearWordScores(idx, text)`、`useScoredWords(idx, text) → WordScore[] | null`
- Consumes:`scoreTone`(`~/components/score-tone`)。**不导入 practice**(基线在 Task 5 才加)。

- [ ] **Step 1: 写失败测试** — `web/src/features/library/word-tap.test.ts`:

```ts
import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectWord, tokenizeSentence, wordTones, type WordScore } from "./word-tap";

describe("tokenizeSentence", () => {
  it("keeps every character and numbers the words in order", () => {
    const tokens = tokenizeSentence("Well-known, isn't it? 3 cats.");
    expect(tokens.map((t) => t.text).join("")).toBe("Well-known, isn't it? 3 cats.");
    const words = tokens.filter((t) => t.word >= 0);
    expect(words.map((t) => t.text)).toEqual(["Well-known", "isn't", "it", "3", "cats"]);
    expect(words.map((t) => t.word)).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns one gap token for text without words, nothing for empty text", () => {
    expect(tokenizeSentence("...")).toEqual([{ text: "...", word: -1 }]);
    expect(tokenizeSentence("")).toEqual([]);
  });
});

describe("wordTones (plan W2 R-SH09)", () => {
  it("aligns scored words in order, skips insertions and marks omissions and mispronunciations low", () => {
    const words: WordScore[] = [
      { word: "i", accuracyScore: 98, errorType: "None" },
      { word: "uh", accuracyScore: 10, errorType: "Insertion" },
      { word: "would", accuracyScore: 75, errorType: "None" },
      { word: "like", accuracyScore: 90, errorType: "Omission" },
      { word: "a", accuracyScore: 50, errorType: "None" },
      { word: "cup", accuracyScore: 92, errorType: "Mispronunciation" },
      { word: "coffee", accuracyScore: 88, errorType: "None" },
    ];
    expect(wordTones(tokenizeSentence("I would like a cup of coffee."), words)).toEqual(["good", "fair", "low", "low", "low", null, "good"]);
  });

  it("ignores case, apostrophes and hyphens when matching", () => {
    const words: WordScore[] = [
      { word: "isnt", accuracyScore: 95, errorType: "None" },
      { word: "well-known", accuracyScore: 60, errorType: "None" },
    ];
    expect(wordTones(tokenizeSentence("Isn't well-known"), words)).toEqual(["good", "low"]);
  });

  it("leaves every word uncoloured without a result or without a score", () => {
    expect(wordTones(tokenizeSentence("Hi there"), undefined)).toEqual([null, null]);
    expect(wordTones(tokenizeSentence("Hi"), [{ word: "hi", accuracyScore: null, errorType: null }])).toEqual([null]);
  });
});

describe("selectWord (plan W2 R-SH15)", () => {
  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
  });
  const mount = () => {
    document.body.innerHTML = '<p data-lookup-context><span id="a">Hello</span> <span id="b">world</span>.</p>';
    return { a: document.getElementById("a")!, b: document.getElementById("b")! };
  };

  it("selects exactly the tapped word inside its lookup context", () => {
    const { b } = mount();
    expect(selectWord(b)).toBe(true);
    const sel = document.getSelection()!;
    expect(sel.toString()).toBe("world");
    expect(sel.anchorNode).toBe(b);
    expect(b.closest("[data-lookup-context]")).not.toBeNull();
  });

  it("fires selectionchange so the global lookup layer can open", async () => {
    const { a } = mount();
    const spy = vi.fn();
    document.addEventListener("selectionchange", spy);
    try {
      selectWord(a);
      await waitFor(() => expect(spy).toHaveBeenCalled());
    } finally {
      document.removeEventListener("selectionchange", spy);
    }
  });

  it("keeps a selection the user dragged over several words", () => {
    const { a, b } = mount();
    const range = document.createRange();
    range.setStart(a.firstChild!, 0);
    range.setEnd(b.firstChild!, 3);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(selectWord(b)).toBe(false);
    expect(sel.toString()).toBe("Hello wor");
  });
});
```

`web/src/features/library/word-scores.test.ts`(评分词色 store,R-SH31):

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { clearWordScores, publishWordScores, useScoredWords, type WordScore } from "./word-tap";

const A: WordScore[] = [{ word: "hello", accuracyScore: 95, errorType: "None" }];
const B: WordScore[] = [{ word: "next", accuracyScore: 60, errorType: "None" }];

afterEach(() => {
  act(() => {
    clearWordScores(1, "Hello world.");
    clearWordScores(2, "Next one.");
  });
});

describe("scored-words store (plan W2 R-SH31)", () => {
  it("serves the published words only to the exact sentence they belong to", () => {
    const mine = renderHook(() => useScoredWords(1, "Hello world."));
    const otherIdx = renderHook(() => useScoredWords(2, "Hello world."));
    const edited = renderHook(() => useScoredWords(1, "Hello there."));
    expect(mine.result.current).toBeNull();
    act(() => publishWordScores(1, "Hello world.", A));
    expect(mine.result.current).toBe(A);
    expect(otherIdx.result.current).toBeNull();
    expect(edited.result.current).toBeNull();
  });

  it("clears only its own entry", () => {
    const mine = renderHook(() => useScoredWords(1, "Hello world."));
    act(() => publishWordScores(1, "Hello world.", A));
    act(() => clearWordScores(2, "Hello world."));
    expect(mine.result.current).toBe(A);
    act(() => clearWordScores(1, "Hello world."));
    expect(mine.result.current).toBeNull();
  });

  it("keeps a single entry: publishing another sentence replaces the previous one", () => {
    const first = renderHook(() => useScoredWords(1, "Hello world."));
    const second = renderHook(() => useScoredWords(2, "Next one."));
    act(() => publishWordScores(1, "Hello world.", A));
    act(() => publishWordScores(2, "Next one.", B));
    expect(first.result.current).toBeNull();
    expect(second.result.current).toBe(B);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/word-tap.test.ts src/features/library/word-scores.test.ts`(模块不存在)。

- [ ] **Step 3: 实现** — `web/src/features/library/word-tap.ts`:

```ts
import { useSyncExternalStore } from "react";
import { scoreTone, type ScoreTone } from "~/components/score-tone";

/** 句子的一个片段:词(word = 从 0 起的词序号)或词之间的空白与标点(word = -1)。 */
export interface SentenceToken {
  text: string;
  word: number;
}

/** 评测的逐词结果(与 ~/features/practice 的 AssessmentWordBrief 同形;这里不导入 practice)。 */
export interface WordScore {
  word: string;
  accuracyScore: number | null;
  errorType: string | null;
}

// 连字符 / 撇号只作词内连接符(与对话转写的对齐同一写法);归一化时去掉,"isn't" 能匹配评测返回的 "isnt"。
const TOKEN = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const norm = (s: string) => s.toLowerCase().replace(/['’-]/g, "");

export function tokenizeSentence(text: string): SentenceToken[] {
  const out: SentenceToken[] = [];
  let cursor = 0;
  let n = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    if (start > cursor) out.push({ text: text.slice(cursor, start), word: -1 });
    out.push({ text: match[0], word: n });
    n += 1;
    cursor = start + match[0].length;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), word: -1 });
  return out;
}

function toneOf(w: WordScore): ScoreTone | null {
  if (w.errorType === "Mispronunciation" || w.errorType === "Omission") return "low";
  return typeof w.accuracyScore === "number" ? scoreTone(w.accuracyScore) : null;
}

/**
 * 把评测的逐词结果按顺序对齐到句子的词上(向前最多看 lookahead 个),返回每个词的分数色调(下标 = 词序号);
 * 对不上的词为 null。多说的词(Insertion)在句子里没有位置,不参与对齐(plan W2 R-SH09)。
 */
export function wordTones(tokens: SentenceToken[], words: WordScore[] | undefined, lookahead = 3): Array<ScoreTone | null> {
  const count = tokens.reduce((m, t) => Math.max(m, t.word + 1), 0);
  const tones: Array<ScoreTone | null> = new Array(count).fill(null);
  const scored = (words ?? []).filter((w) => w.errorType !== "Insertion" && w.word);
  let next = 0;
  for (const token of tokens) {
    if (token.word < 0) continue;
    const key = norm(token.text);
    for (let k = next; k < Math.min(scored.length, next + lookahead); k++) {
      if (norm(scored[k].word) === key) {
        tones[token.word] = toneOf(scored[k]);
        next = k + 1;
        break;
      }
    }
  }
  return tones;
}

/**
 * 点词 = 程序化选中这个词(plan W2 R-SH15):全局 LookupLayer 在 selectionchange 稳定 300 ms 后自己打开,上下文取
 * 最近的 [data-lookup-context](整句)。用户刚拖选了别的文字时不覆盖。返回是否改了选区。
 */
export function selectWord(el: HTMLElement, doc: Document = el.ownerDocument): boolean {
  const sel = doc.getSelection();
  if (!sel) return false;
  const current = sel.isCollapsed ? "" : sel.toString().trim();
  if (current && current !== (el.textContent ?? "").trim()) return false;
  sel.removeAllRanges();
  sel.selectAllChildren(el);
  return true;
}

// ---- 评分词色 store(R-SH31) ----
// ShadowPanel(评分)与 SegmentText(显示句子)是 W1 在同一行里渲染的两个互不嵌套的组件;「刚评过的那一句的逐词结果」经这个模块级小 store 共享。
// 只保留一条:换句 / 卸载时由 ShadowPanel 清掉自己的那条(clearWordScores 只清 idx 与文字都相同的条目)。
interface ScoredSentence {
  idx: number;
  text: string;
  words: WordScore[];
}
let current: ScoredSentence | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of [...listeners]) listener();
};

export function publishWordScores(idx: number, text: string, words: WordScore[]): void {
  current = { idx, text, words };
  emit();
}

export function clearWordScores(idx: number, text: string): void {
  if (current && current.idx === idx && current.text === text) {
    current = null;
    emit();
  }
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** 这一句刚评过的逐词结果;不是这一句(或文字已改)返回 null。快照是稳定引用,useSyncExternalStore 不会无限重渲。 */
export function useScoredWords(idx: number, text: string): WordScore[] | null {
  return useSyncExternalStore(
    subscribe,
    () => (current && current.idx === idx && current.text === text ? current.words : null),
    () => null,
  );
}
```

- [ ] **Step 4: 跑测试确认通过** — `yarn web:typecheck`;`cd web && yarn vitest run src/features/library/word-tap.test.ts src/features/library/word-scores.test.ts src/architecture.test.ts`。

- [ ] **Step 5: 提交** — `feat(web): tap-to-select words, per-word score tones and a scored-words store for library sentences`。

---

## Task 4: 效果组件接缝 `shadow-fx.tsx`(spec §11.4a)

**Files:**
- Create: `web/src/features/library/shadow-fx.tsx`、`web/src/features/library/shadow-fx.test.tsx`

**Interfaces:**
- Produces(本计划其余任务**只**从 `./shadow-fx` 取效果组件,不直接导入 `./fx`):
  - `ClickSpark(props: { children: ReactNode; className?: string; disabled?: boolean }): JSX.Element` —— 包住一个可点击元素,点击时在点按处迸出一小圈火花(一次性);减少动态效果时不动;卸载时清掉所有定时器与火花。
  - `CountUp(props: { to: number; durationMs?: number; className?: string }): JSX.Element` —— `<span>`,数字从 0 滚到 `Math.round(to)` 并停在那里;减少动态效果时直接显示终值。
  - `GradientText(props: { children: ReactNode; className?: string }): JSX.Element` —— 渐变色字(令牌 `green → teal → blue`)。
  - `BlurText(props: { text: string; className?: string; stepMs?: number }): JSX.Element` —— 文字逐字(中日韩)/ 逐词(其余)从模糊到清晰依次浮现;`textContent` 始终等于 `text`;减少动态效果时直接显示。
  - `GlassSurface(props: HTMLAttributes<HTMLElement> & { as?: ElementType; strong?: boolean; tint?: boolean }): JSX.Element` —— 半透明玻璃面(列表里的卡片**不带 `backdrop-filter`**,只是半透明填充 + 发丝高光边,§11.4a)。
- Consumes:W1 的 `./fx`(C10;spec §11.4a 把 12 个效果归在 `features/library/` 内,§15 把该目录除 W2 文件外的全部归 W1)。Task 0 Step 3 决定每个组件是转出还是用后备。

设计稿依据:`mockup-glass.html` 的 `.spark`(9 颗、6 px、半径 26–40 px、0.55 s)、`.gt`(渐变字)、`.bw`(每字 18 ms 的逐字浮现,8 px 模糊 + 6 px 位移)、`countUp`(1.1 s 缓出)。**不引入 reactbits 或任何 npm 依赖。**

- [ ] **Step 1: 写失败测试** — `web/src/features/library/shadow-fx.test.tsx`(这五条断言的是 spec §11.4a 的组件契约,转出 W1 的实现时同样成立):

```tsx
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlurText, ClickSpark, CountUp, GlassSurface, GradientText } from "./shadow-fx";

const matchMedia = (reduce: boolean) => (query: string) => ({
  matches: reduce && query.includes("reduce"), media: query, onchange: null,
  addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined,
  dispatchEvent: () => false,
});

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  vi.useRealTimers();
  window.matchMedia = originalMatchMedia; // 仓库里的先例:直接改写再还原 window.matchMedia
});

describe("library effects (spec §11.4a)", () => {
  it("CountUp ends on the rounded target value", async () => {
    render(<span data-testid="v"><CountUp to={85.6} /></span>);
    await waitFor(() => expect(screen.getByTestId("v")).toHaveTextContent("86"), { timeout: 3000 });
  });

  it("CountUp shows the target at once when motion is reduced", () => {
    window.matchMedia = matchMedia(true) as unknown as typeof window.matchMedia;
    render(<span data-testid="v"><CountUp to={42} /></span>);
    expect(screen.getByTestId("v")).toHaveTextContent("42");
  });

  it("BlurText always carries the full text, for Latin and CJK alike", () => {
    const { container } = render(<BlurText text="So, Rachel, 你好。what now?" />);
    expect(container).toHaveTextContent("So, Rachel, 你好。what now?");
  });

  it("ClickSpark leaves no timers behind after a burst or an unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(<ClickSpark><button type="button">go</button></ClickSpark>);
    fireEvent.click(screen.getByText("go"));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(screen.getByText("go"));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ClickSpark does not swallow the click", () => {
    const onClick = vi.fn();
    render(<ClickSpark><button type="button" onClick={onClick}>go</button></ClickSpark>);
    fireEvent.click(screen.getByText("go"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("GradientText and GlassSurface render their children and pass attributes through", () => {
    render(<GlassSurface data-testid="glass" tint><GradientText>great</GradientText></GlassSurface>);
    expect(screen.getByTestId("glass")).toHaveTextContent("great");
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/shadow-fx.test.tsx`(模块不存在)。

- [ ] **Step 3: 实现(默认:转出 W1 的组件)** — `web/src/features/library/shadow-fx.tsx`:

```ts
/**
 * 跟读卡(评分卡、分析卡、菜单)用到的 5 个效果组件的唯一接缝(plan 2026-10-13-video-import-web-shadow R-SH25)。
 * 组件本身由 W1 的 ./fx 提供(spec §11.4a:自写、不引入新依赖、只放在 features/library/ 内);Task 0 核对后,
 * 缺哪个就把这一行换成 Task 4 Step 3b 的本地后备。W2 其余文件只从这里取,不直接导入 ./fx。
 */
export { BlurText, ClickSpark, CountUp, GlassSurface, GradientText } from "./fx";
```

- [ ] **Step 3b: 本地后备(只在 Task 0 Step 3 发现 W1 缺组件或签名不兼容时用)** — 把 `shadow-fx.tsx` 整个换成下面的内容(五个组件都在这里自带;只缺一两个时,保留 W1 能提供的转出,把缺的从下面剪过去):

```tsx
import { useEffect, useMemo, useRef, useState, type ElementType, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

/**
 * 本地后备(plan W2 R-SH25):与 W1 的 ./fx 同一契约(spec §11.4a)。颜色只用令牌变量,深浅色自动跟随(D12);
 * 动画只用 transform / opacity / filter,prefers-reduced-motion 时静止;列表里的玻璃面不带 backdrop-filter。
 */
const reducedMotion = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function CountUp({ to, durationMs = 900, className }: { to: number; durationMs?: number; className?: string }) {
  const target = Math.round(Number.isFinite(to) ? to : 0);
  const [value, setValue] = useState(() => (reducedMotion() ? target : 0));
  useEffect(() => {
    if (reducedMotion() || typeof requestAnimationFrame !== "function") {
      setValue(target);
      return undefined;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - t0) / durationMs));
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return <span className={cn("num", className)}>{value}</span>;
}

export function GradientText({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("bg-gradient-to-r from-green via-teal to-blue bg-clip-text font-bold text-transparent", className)}>{children}</span>;
}

const SPARK_COLORS = ["rgb(var(--amber))", "rgb(var(--teal))", "rgb(var(--blue))", "rgb(var(--green))"];
const SPARK_COUNT = 9;
const SPARK_MS = 600;

interface SparkDot {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  color: string;
}

function Spark({ x, y, dx, dy, color }: Omit<SparkDot, "id">) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.animate?.(
      [{ transform: "translate(0px, 0px) scale(1)", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(0.3)`, opacity: 0 }],
      { duration: 550, easing: "ease-out", fill: "forwards" },
    );
  }, [dx, dy]);
  return <i ref={ref} data-spark aria-hidden className="pointer-events-none absolute z-10 block h-1.5 w-1.5 rounded-full" style={{ left: x - 3, top: y - 3, background: color }} />;
}

export function ClickSpark({ children, className, disabled }: { children: ReactNode; className?: string; disabled?: boolean }) {
  const box = useRef<HTMLSpanElement>(null);
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  const [sparks, setSparks] = useState<SparkDot[]>([]);
  useEffect(
    () => () => {
      for (const id of timers.current) window.clearTimeout(id);
      timers.current = [];
    },
    [],
  );
  const burst = (e: MouseEvent) => {
    if (disabled || reducedMotion()) return;
    const rect = box.current?.getBoundingClientRect();
    const x = rect ? e.clientX - rect.left : 0;
    const y = rect ? e.clientY - rect.top : 0;
    const batch: SparkDot[] = Array.from({ length: SPARK_COUNT }, (_, i) => {
      const angle = (i / SPARK_COUNT) * Math.PI * 2;
      const radius = 26 + (i % 3) * 7;
      seq.current += 1;
      return { id: seq.current, x, y, dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius, color: SPARK_COLORS[i % SPARK_COLORS.length] };
    });
    const ids = new Set(batch.map((s) => s.id));
    setSparks((cur) => [...cur, ...batch]);
    timers.current.push(window.setTimeout(() => setSparks((cur) => cur.filter((s) => !ids.has(s.id))), SPARK_MS));
  };
  return (
    <span ref={box} className={cn("relative inline-block", className)} onClickCapture={burst}>
      {children}
      {sparks.map((s) => <Spark key={s.id} x={s.x} y={s.y} dx={s.dx} dy={s.dy} color={s.color} />)}
    </span>
  );
}

const CJK = "\\u3400-\\u9fff\\uf900-\\ufaff";
const UNIT = new RegExp(`[${CJK}]|[^\\s${CJK}]+|\\s+`, "g");
const MAX_UNITS = 400;

/** 逐字(中日韩)/ 逐词(其余)切分;超过 MAX_UNITS 个单元的尾部并成一个单元,避免几千个 span。textContent 恒等于 text。 */
function splitUnits(text: string): string[] {
  const units = text.match(UNIT) ?? [];
  return units.length <= MAX_UNITS ? units : [...units.slice(0, MAX_UNITS), units.slice(MAX_UNITS).join("")];
}

function Unit({ text, delay }: { text: string; delay: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (reducedMotion()) return;
    ref.current?.animate?.(
      [{ opacity: 0, filter: "blur(8px)", transform: "translateY(6px)" }, { opacity: 1, filter: "blur(0px)", transform: "none" }],
      { duration: 500, delay, easing: "ease", fill: "backwards" },
    );
  }, [delay]);
  return <span ref={ref} className="inline-block whitespace-pre-wrap">{text}</span>;
}

export function BlurText({ text, className, stepMs = 18 }: { text: string; className?: string; stepMs?: number }) {
  const units = useMemo(() => splitUnits(text), [text]);
  return <span className={className}>{units.map((u, i) => <Unit key={i} text={u} delay={i * stepMs} />)}</span>;
}

export function GlassSurface({
  as: Tag = "div", strong = false, tint = false, className, ...rest
}: HTMLAttributes<HTMLElement> & { as?: ElementType; strong?: boolean; tint?: boolean }) {
  return (
    <Tag
      className={cn(
        "rounded-card shadow-hair",
        tint ? "bg-blue-tint" : strong ? "bg-surface-2" : "bg-surface-2/70",
        className,
      )}
      {...rest}
    />
  );
}
```

- [ ] **Step 4: 跑测试确认通过** — `yarn web:typecheck`;`cd web && yarn vitest run src/features/library/shadow-fx.test.tsx src/architecture.test.ts`。转出 W1 的实现时,若某条断言因实现细节失败(例如 W1 的 `CountUp` 不尊重 `matchMedia`),**不改 W1 的文件**:把该组件换成 Step 3b 的后备并在结果文档记 W2 缺口。

- [ ] **Step 5: 提交** — `feat(web): effect adapter for the library shadow cards`。

---

## Task 5: 把句子存进练习清单(第一条 `library->practice` 边;ClickSpark)

**Files:**
- Create: `web/src/features/library/save-sentence.tsx`、`web/src/features/library/save-sentence.test.tsx`
- Modify: `web/src/architecture.test.ts`

**Interfaces:**
- Produces:`SaveState = "idle" | "saving" | "saved"`、`SaveSentenceState { state; save(): Promise<boolean> }`、`useSaveSentence(text) → SaveSentenceState`、`SaveSentenceChip({ save, className? })`(`data-testid="shadow-save"`,`data-state`;包 `ClickSpark`)
- Consumes:`savePracticeItem(api, t, text, "library")`(`~/features/practice`,R-SH18)、`ClickSpark`(`./shadow-fx`)

`useSaveSentence` 在 `ActivePanel` 里**只调一次**,返回的对象同时交给评分卡里的芯片(设计稿 D 的「加入练习」)与 ⋯ 菜单里的条目(D8),两处共用「已加入」状态(R-SH18)。

- [ ] **Step 1: 写失败测试** — `web/src/features/library/save-sentence.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { SaveSentenceChip, useSaveSentence } from "./save-sentence";

const SAVED = { id: "p1", text: "Hello world.", source: "library", created_at: "2026-10-13T00:00:00Z" };

function Harness({ text }: { text: string }) {
  const save = useSaveSentence(text);
  return <SaveSentenceChip save={save} />;
}

function setup(handler: () => Response) {
  const mock = createFetchMock({ "POST /api/practice-items": handler });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const view = render(<TestProviders api={api}><Harness text="Hello world." /></TestProviders>);
  const rerender = (text: string) => view.rerender(<TestProviders api={api}><Harness text={text} /></TestProviders>);
  return { mock, rerender };
}

describe("add to practice list (spec §11.4, plan W2 R-SH18)", () => {
  it("saves the sentence with source=library and shows the saved state", async () => {
    const { mock } = setup(() => json(SAVED));
    expect(screen.getByTestId("shadow-save")).toHaveAccessibleName("Add to practice list");
    await userEvent.click(screen.getByTestId("shadow-save"));
    await waitFor(() => expect(screen.getByTestId("shadow-save")).toHaveAttribute("data-state", "saved"));
    expect(screen.getByTestId("shadow-save")).toHaveAccessibleName("Added to practice list");
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ text: "Hello world.", source: "library" });
    expect(mock.calls[0].url.search).toBe("");
  });

  it("saves again on a second tap (no client-side dedupe)", async () => {
    const { mock } = setup(() => json(SAVED));
    await userEvent.click(screen.getByTestId("shadow-save"));
    await waitFor(() => expect(screen.getByTestId("shadow-save")).toHaveAttribute("data-state", "saved"));
    await userEvent.click(screen.getByTestId("shadow-save"));
    await waitFor(() => expect(mock.calls).toHaveLength(2));
  });

  it("stays unsaved when the server refuses", async () => {
    const { mock } = setup(() => json({ error: "Practice item limit reached" }, 409));
    await userEvent.click(screen.getByTestId("shadow-save"));
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("shadow-save")).not.toBeDisabled());
    expect(screen.getByTestId("shadow-save")).toHaveAttribute("data-state", "idle");
  });

  it("resets when the sentence changes", async () => {
    const { rerender } = setup(() => json(SAVED));
    await userEvent.click(screen.getByTestId("shadow-save"));
    await waitFor(() => expect(screen.getByTestId("shadow-save")).toHaveAttribute("data-state", "saved"));
    rerender("Another one.");
    expect(screen.getByTestId("shadow-save")).toHaveAttribute("data-state", "idle");
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/save-sentence.test.tsx`(模块不存在)。

- [ ] **Step 3: 实现** — `web/src/features/library/save-sentence.tsx`:

```tsx
import { StarIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { useAuth } from "~/auth/auth-context";
import { savePracticeItem } from "~/features/practice";
import "./locales";
import { ClickSpark } from "./shadow-fx";

export type SaveState = "idle" | "saving" | "saved";

export interface SaveSentenceState {
  state: SaveState;
  /** 存一次(不去重,服务端也不去重);返回是否成功。成功 / 失败的 toast 由 savePracticeItem 发。 */
  save(): Promise<boolean>;
}

/**
 * 把这一句存进练习清单(source="library",spec §11.4)。成功后 state 为 "saved" 直到句子变化(plan W2 R-SH18)。
 * 在 ActivePanel 里只调一次,结果同时交给评分卡的芯片与 ⋯ 菜单的条目。
 */
export function useSaveSentence(text: string): SaveSentenceState {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [savedText, setSavedText] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      const ok = await savePracticeItem(api, t, text, "library");
      if (ok && mounted.current) setSavedText(text);
      return ok;
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [api, t, text]);

  const state: SaveState = busy ? "saving" : savedText === text ? "saved" : "idle";
  return { state, save };
}

/** 评分卡里的「加入练习」芯片(设计稿 D):点按迸出火花(ClickSpark,spec §11.4a),已加入后星变实心、转琥珀色。 */
export function SaveSentenceChip({ save, className }: { save: SaveSentenceState; className?: string }) {
  const { t } = useTranslation();
  const saved = save.state === "saved";
  return (
    <ClickSpark>
      <button
        type="button"
        data-testid="shadow-save"
        data-state={save.state}
        disabled={save.state === "saving"}
        onClick={() => void save.save()}
        className={cn(
          "inline-flex min-h-tap items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-sub transition-colors duration-fast",
          "hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60",
          saved ? "text-amber" : "text-ink",
          className,
        )}
      >
        <StarIcon aria-hidden className={cn("h-4 w-4 flex-none", saved && "fill-current")} />
        {t(saved ? "web.library.shadow.saved" : "web.library.shadow.save")}
      </button>
    </ClickSpark>
  );
}
```

- [ ] **Step 4: 跑架构测试确认它因新边失败** — `cd web && yarn vitest run src/architecture.test.ts`:应报 `features/library/save-sentence.tsx: "~/features/practice" — new cross-feature edge library->practice; use an extension point`。

- [ ] **Step 5: 加基线(R-SH06)** — `web/src/architecture.test.ts`:

`CROSS_FEATURE_BASELINE` 的第一行改为(在 `"lookup->practice"` 之前插入 `"library->practice"`):

```ts
  "chat->agents", "chat->grammar", "chat->lookup", "chat->practice", "chat->realtime", "library->practice", "lookup->practice",
```

在 A5 的那段注释(以 `// (spec 2026-10-12-agents §9.2);两者都是 lazy-parts 的懒包装` 开头的那一行)之后追加两行:

```ts
// W2(video-import-web-shadow R-SH06):library->practice —— 跟读库的跟读用 practice 的评测 API、savePracticeItem 与 AssessmentScores 类型
// (spec 2026-10-13-video-import §2.2、§11.4),与 chat->practice 同理;practice 不导入 library,没有桶循环。别的 library 边一律不加。
```

「guards plugins, register files and the cross-feature baseline」用例的最后一个 `expect` 之后追加:

```ts
    expect(violationsOf("features/library/x.tsx", 'import { savePracticeItem } from "~/features/practice";')).toEqual([]);
    expect(violationsOf("features/library/x.tsx", 'import { useTtsPlayer } from "~/features/chat";')).toHaveLength(1);
    expect(violationsOf("features/library/x.tsx", 'import { LookupLayer } from "~/features/lookup";')).toHaveLength(1);
```

「the cross-feature baseline lists only edges that still exist」里 `expect(CROSS_FEATURE_BASELINE.size).toBe(18);` 改为 `toBe(19)`(Task 0 读到的数字不是 18 时,用它 + 1)。

- [ ] **Step 6: 跑测试确认通过** — `yarn web:typecheck`;`cd web && yarn vitest run src/features/library/save-sentence.test.tsx src/architecture.test.ts`。

- [ ] **Step 7: 提交** — `feat(web): save a library sentence to the practice list`。

---

## Task 6: `useShadowing`:录音 → 评测 → 记成绩、听我的录音

**Files:**
- Create: `web/src/features/library/use-shadowing.ts`、`web/src/features/library/use-shadowing.test.tsx`

**Interfaces:**
- Produces:`SHADOW_MAX_MS = 60_000`、`ShadowPhase = "idle" | "starting" | "recording" | "assessing" | "done" | "error"`、`ShadowTarget { idx; text }`、`ShadowResult { segIdx; scores; words; assessmentId; attemptSaved }`、`UseShadowingOptions { itemId; segment; pauseMedia; starter? }`、`useShadowing(opts) → { phase; error; result; best; elapsedMs; canPlayMine; playingMine; toggle(); playMine(); stopMine() }`
- Consumes:`useRecorder`(`starter` 注入)、`toAssessmentWav`、`describeAudioError`、`claimAudio` / `releaseAudio`、`assessPronunciation` / `briefWords` / `PRACTICE_SERVER_ERRORS` / `AssessmentScores` / `AssessmentWordBrief`(practice)、Task 2 的 `loadBest` / `noteAttempt` / `peekBest` / `recordAttempt`

**(Addendum)** 与旧稿的差别:不再在每次挂载时 `GET attempts`,改用 Task 2 的模块级最好成绩缓存(`ActivePanel` 随当前句反复挂载 / 卸载,R-SH30);其余逻辑不变。

- [ ] **Step 1: 写失败测试** — `web/src/features/library/use-shadowing.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import type { RecordingResult, RecordingSession } from "~/audio/recorder";
import { encodeWavPcm16 } from "~/audio/wav";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { resetBestCache } from "./attempts-api";
import "./locales";
import { useShadowing, type UseShadowingOptions } from "./use-shadowing";

/** 已是 16 kHz 单声道 16 位的 WAV:toAssessmentWav 走直通路径,不需要解码。 */
const WAV = new Blob([encodeWavPcm16(new Float32Array(1600).fill(0.1), 16000)], { type: "audio/wav" });
const ASSESS = {
  pronunciation_score: 82, accuracy_score: 80, fluency_score: 85, completeness_score: 100,
  detail_result: { display: "Hello world.", words: [
    { word: "hello", pronunciation_assessment: { accuracy_score: 95, error_type: "None" } },
    { word: "world", pronunciation_assessment: { accuracy_score: 40, error_type: "Mispronunciation" } },
  ] },
  assessment_id: "a1",
};

/** 录音会话:result 在 stop() 时才完成(立即完成的 result 会被 useRecorder 当成「录音自己结束了」)。 */
function fakeStarter(log: string[], extra: Partial<RecordingResult> = {}) {
  return async (): Promise<RecordingSession> => {
    log.push("mic");
    let done!: (r: RecordingResult) => void;
    const result = new Promise<RecordingResult>((resolve) => { done = resolve; });
    const stop = () => {
      done({ blob: WAV, mimeType: "audio/wav", durationMs: 1000, stoppedBy: "user", ...extra });
      return result;
    };
    return { startedAt: 0, result, stop, cancel: vi.fn() };
  };
}

function setup(routes: Record<string, Handler>, extra: Partial<RecordingResult> = {}) {
  const log: string[] = [];
  const mock = createFetchMock({ "GET /api/library/items/i1/attempts": () => json([]), ...routes });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const pauseMedia = vi.fn(() => { log.push("pause"); });
  const initialProps: UseShadowingOptions = {
    itemId: "i1", segment: { idx: 3, text: "Hello world." }, pauseMedia, starter: fakeStarter(log, extra),
  };
  const hook = renderHook((p: UseShadowingOptions) => useShadowing(p), {
    initialProps, wrapper: ({ children }) => <TestProviders api={api}>{children}</TestProviders>,
  });
  return { hook, mock, log, pauseMedia, initialProps };
}

const posts = (mock: ReturnType<typeof createFetchMock>, pathname: string) =>
  mock.calls.filter((c) => c.method === "POST" && c.url.pathname === pathname);

async function recordOnce(hook: ReturnType<typeof setup>["hook"]) {
  await act(async () => { await hook.result.current.toggle(); });
  expect(hook.result.current.phase).toBe("recording");
  await act(async () => { await hook.result.current.toggle(); });
}

describe("useShadowing (spec §11.4)", () => {
  beforeEach(() => {
    resetBestCache();
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:mine"), revokeObjectURL: vi.fn() });
    Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
  });

  it("pauses the media before the mic, assesses the exact sentence as source=library, then records the attempt", async () => {
    const { hook, mock, log } = setup({
      "POST /api/speech/assessments": () => json(ASSESS),
      "POST /api/library/items/i1/attempts": () => json({ seg_idx: 3, best_score: 82, count: 1 }),
    });
    await recordOnce(hook);
    expect(log).toEqual(["pause", "mic"]);
    await waitFor(() => expect(hook.result.current.phase).toBe("done"));
    const form = posts(mock, "/api/speech/assessments")[0].body as FormData;
    expect(form.get("source")).toBe("library");
    expect(form.get("save")).toBe("true");
    expect(form.get("reference")).toBe("Hello world.");
    expect(form.get("language")).toBe("en-US");
    expect(JSON.parse(posts(mock, "/api/library/items/i1/attempts")[0].body as string)).toEqual({ seg_idx: 3, assessment_id: "a1" });
    expect(hook.result.current.result).toMatchObject({ segIdx: 3, assessmentId: "a1", attemptSaved: true, scores: { pronunciationScore: 82 } });
    expect(hook.result.current.result!.words.map((w) => w.word)).toEqual(["hello", "world"]);
    expect(hook.result.current.best).toMatchObject({ segIdx: 3, bestScore: 82, count: 1 });
    expect(hook.result.current.canPlayMine).toBe(true);
    expect(mock.calls.every((c) => c.url.search === "")).toBe(true);
  });

  it("does not upload a recording without speech", async () => {
    const { hook, mock } = setup({ "POST /api/speech/assessments": () => json(ASSESS) }, { noSpeech: true });
    await recordOnce(hook);
    await waitFor(() => expect(hook.result.current.phase).toBe("error"));
    expect(hook.result.current.error).toBe(i18n.t("web.library.shadow.noSpeech"));
    expect(posts(mock, "/api/speech/assessments")).toHaveLength(0);
  });

  it("shows the existing practice error when the recording quota is full and records nothing", async () => {
    const { hook, mock } = setup({ "POST /api/speech/assessments": () => json({ error: "Recording storage quota exceeded" }, 413) });
    await recordOnce(hook);
    await waitFor(() => expect(hook.result.current.phase).toBe("error"));
    expect(hook.result.current.error).toBe(i18n.t("web.practice.errors.quota"));
    expect(posts(mock, "/api/library/items/i1/attempts")).toHaveLength(0);
    expect(hook.result.current.result).toBeNull();
  });

  it("still shows the score when recording the attempt fails, without a local best", async () => {
    const { hook } = setup({
      "POST /api/speech/assessments": () => json(ASSESS),
      "POST /api/library/items/i1/attempts": () => json({ error: "boom" }, 500),
    });
    await recordOnce(hook);
    await waitFor(() => expect(hook.result.current.phase).toBe("done"));
    expect(hook.result.current.result!.attemptSaved).toBe(false);
    expect(hook.result.current.best).toBeNull();
  });

  it("drops a late result after the sentence changes", async () => {
    let release: (() => void) | undefined;
    const { hook, mock, initialProps } = setup({
      "POST /api/speech/assessments": () => new Promise<Response>((resolve) => { release = () => resolve(json(ASSESS)); }),
    });
    await act(async () => { await hook.result.current.toggle(); });
    act(() => { void hook.result.current.toggle(); });
    await waitFor(() => expect(release).toBeDefined());
    expect(hook.result.current.phase).toBe("assessing");
    hook.rerender({ ...initialProps, segment: { idx: 4, text: "Next one." } });
    expect(hook.result.current.phase).toBe("idle");
    await act(async () => {
      release!();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(hook.result.current.result).toBeNull();
    expect(hook.result.current.phase).toBe("idle");
    expect(posts(mock, "/api/library/items/i1/attempts")).toHaveLength(0);
  });

  it("shows the best score recorded earlier for the current sentence", async () => {
    const { hook } = setup({
      "GET /api/library/items/i1/attempts": () => json([{ seg_idx: 3, best_score: 91.6, count: 2, last_at: "2026-10-13T00:00:00Z" }]),
    });
    await waitFor(() => expect(hook.result.current.best).toMatchObject({ segIdx: 3, bestScore: 91.6, count: 2 }));
  });

  it("asks for the best scores once, however often the panel remounts", async () => {
    const first = setup({});
    await waitFor(() => expect(first.mock.calls.filter((c) => c.url.pathname === "/api/library/items/i1/attempts")).toHaveLength(1));
    first.hook.unmount();
    const second = setup({});
    await new Promise((r) => setTimeout(r, 0));
    expect(second.mock.calls.filter((c) => c.url.pathname === "/api/library/items/i1/attempts")).toHaveLength(0);
  });

  it("plays my recording after pausing the media, and toggles it off", async () => {
    const { hook, pauseMedia } = setup({
      "POST /api/speech/assessments": () => json(ASSESS),
      "POST /api/library/items/i1/attempts": () => json({}),
    });
    await recordOnce(hook);
    await waitFor(() => expect(hook.result.current.phase).toBe("done"));
    act(() => hook.result.current.playMine());
    expect(pauseMedia).toHaveBeenCalledTimes(2);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(hook.result.current.playingMine).toBe(true);
    act(() => hook.result.current.playMine());
    expect(hook.result.current.playingMine).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/use-shadowing.test.tsx`(模块不存在)。

- [ ] **Step 3: 实现** — `web/src/features/library/use-shadowing.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "~/api/client";
import { claimAudio, releaseAudio } from "~/audio/audio-focus";
import { toAssessmentWav } from "~/audio/convert";
import { describeAudioError } from "~/audio/describe-error";
import type { RecordingResult } from "~/audio/recorder";
import { useRecorder, type RecordingStarter } from "~/audio/use-recorder";
import { useAuth } from "~/auth/auth-context";
import {
  PRACTICE_SERVER_ERRORS, assessPronunciation, briefWords, type AssessmentScores, type AssessmentWordBrief,
} from "~/features/practice";
import { loadBest, noteAttempt, peekBest, recordAttempt, type SegmentBest } from "./attempts-api";
import "./locales";

/** 单句录音上限(plan W2 R-SH10):句子最长 14 s(spec §6.3),60 s 足够且远低于服务端的 300 s。 */
export const SHADOW_MAX_MS = 60_000;

export type ShadowPhase = "idle" | "starting" | "recording" | "assessing" | "done" | "error";

export interface ShadowTarget {
  idx: number;
  text: string;
}

export interface ShadowResult {
  segIdx: number;
  scores: AssessmentScores;
  words: AssessmentWordBrief[];
  assessmentId: string;
  /** POST attempts 是否成功(失败时只展示分数,不更新最好成绩,R-SH14) */
  attemptSaved: boolean;
}

export interface UseShadowingOptions {
  itemId: string;
  segment: ShadowTarget | null;
  /** 暂停库的媒体(W1 播放器);录音与播放不并行(R-SH12) */
  pauseMedia: () => void;
  /** 测试注入的录音启动器(透传给 useRecorder) */
  starter?: RecordingStarter;
}

type OwnPhase = "idle" | "assessing" | "done" | "error";

/**
 * 跟读一句(spec §11.4):开麦前同步暂停媒体 → useRecorder 录音 → 16 kHz WAV → POST /api/speech/assessments
 * (source=library,参考文本 = 句子原文)→ POST attempts。换句 / 改字 / 卸载即复位并丢弃迟到的结果(R-SH17)。
 */
export function useShadowing({ itemId, segment, pauseMedia, starter }: UseShadowingOptions) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [phase, setPhase] = useState<OwnPhase>("idle");
  const [result, setResult] = useState<ShadowResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mineUrl, setMineUrl] = useState<string | null>(null);
  const [playingMine, setPlayingMine] = useState(false);
  const [best, setBest] = useState<Map<number, SegmentBest>>(() => peekBest(itemId) ?? new Map());
  const gen = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const segRef = useRef(segment);
  segRef.current = segment;
  const pauseRef = useRef(pauseMedia);
  pauseRef.current = pauseMedia;
  const tRef = useRef(t);
  tRef.current = t;

  // 稳定的同一个函数:claimAudio / releaseAudio 按引用比较
  const stopMine = useCallback(function stop() {
    audio.current?.pause();
    releaseAudio(stop);
    if (mounted.current) setPlayingMine(false);
  }, []);

  const setMine = useCallback((url: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    if (mounted.current) setMineUrl(url);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      gen.current += 1;
      inflight.current?.abort();
      audio.current?.pause();
      releaseAudio(stopMine);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null; // 麦克风由 useRecorder 自己的卸载清理释放
    };
  }, [stopMine]);

  useEffect(() => {
    let alive = true;
    loadBest(api, itemId)
      .then((map) => {
        if (alive) setBest(map);
      })
      .catch((): void => undefined); // 成绩只用于展示:取不到就不显示「最好成绩」
    return () => {
      alive = false;
    };
  }, [api, itemId]);

  const submit = useCallback(async (recording: RecordingResult, target: ShadowTarget, g: number) => {
    if (g !== gen.current) return;
    if (recording.noSpeech) {
      // R-SH13:没有前景语音,不花上游的钱
      setError(tRef.current("web.library.shadow.noSpeech"));
      setPhase("error");
      return;
    }
    const controller = new AbortController();
    inflight.current = controller;
    setError(null);
    setPhase("assessing");
    try {
      const { wav } = await toAssessmentWav(recording.blob);
      if (g !== gen.current) return;
      setMine(URL.createObjectURL(wav));
      const res = await assessPronunciation(api, {
        wav, reference: target.text, language: "en-US", save: true, source: "library", signal: controller.signal,
      });
      if (g !== gen.current) return;
      if (!res.assessmentId) throw new ApiError(500, "Could not save the recording");
      const scores: AssessmentScores = {
        pronunciationScore: res.pronunciationScore,
        accuracyScore: res.accuracyScore,
        fluencyScore: res.fluencyScore,
        completenessScore: res.completenessScore,
      };
      let attemptSaved = true;
      try {
        await recordAttempt(api, itemId, { segIdx: target.idx, assessmentId: res.assessmentId });
      } catch {
        attemptSaved = false; // R-SH14:不挡住结果,不弹 toast,不记日志
      }
      if (attemptSaved) {
        // 这是真实的一次练习:即使换句 / 卸载了,缓存也要记上
        const next = noteAttempt(itemId, target.idx, scores.pronunciationScore);
        if (mounted.current) setBest(next);
      }
      if (g !== gen.current) return;
      setResult({
        segIdx: target.idx, scores, words: briefWords(res.detailResult?.words), assessmentId: res.assessmentId, attemptSaved,
      });
      setPhase("done");
    } catch (err) {
      if (g !== gen.current) return;
      setError(describeAudioError(tRef.current, err, PRACTICE_SERVER_ERRORS));
      setPhase("error");
    } finally {
      if (inflight.current === controller) inflight.current = null;
    }
  }, [api, itemId, setMine]);

  const recorder = useRecorder({
    starter,
    maxDurationMs: SHADOW_MAX_MS,
    onAutoStop: (rec) => {
      const target = segRef.current;
      // R-SH13:只有到达上限才自动评测;切后台 / 麦克风断开的录音丢弃
      if (rec.stoppedBy === "max_duration" && target) void submit(rec, target, gen.current);
    },
  });
  const cancelRecording = recorder.cancel;

  const segKey = segment ? `${segment.idx}\u0000${segment.text}` : "";
  useEffect(() => {
    gen.current += 1;
    inflight.current?.abort();
    inflight.current = null;
    cancelRecording();
    stopMine();
    setMine(null);
    setResult(null);
    setError(null);
    setPhase("idle");
  }, [segKey, cancelRecording, stopMine, setMine]);

  const recorderState = recorder.state;
  const toggle = useCallback(async () => {
    if (recorderState === "recording") {
      const target = segRef.current;
      const g = gen.current;
      const rec = await recorder.stop();
      if (rec && target) await submit(rec, target, g);
      return;
    }
    if (recorderState !== "idle" || phase === "assessing" || !segRef.current) return;
    // R-SH12:以下都是同步动作,getUserMedia 仍在这次点按的手势里
    stopMine();
    pauseRef.current();
    setError(null);
    setResult(null);
    setPhase("idle");
    await recorder.start();
  }, [recorderState, phase, recorder, stopMine, submit]);

  const playMine = useCallback(() => {
    const url = urlRef.current;
    if (!url || recorderState !== "idle") return;
    if (playingMine) {
      stopMine();
      return;
    }
    pauseRef.current();
    const el = audio.current ?? new Audio();
    audio.current = el;
    el.onended = () => stopMine();
    el.src = url;
    claimAudio(stopMine);
    setPlayingMine(true);
    try {
      void Promise.resolve(el.play()).catch(() => stopMine());
    } catch {
      stopMine();
    }
  }, [recorderState, playingMine, stopMine]);

  const recorderError = recorder.error ? describeAudioError(t, recorder.error) : null;
  const shownPhase: ShadowPhase =
    recorderState === "starting" ? "starting"
      : recorderState === "recording" ? "recording"
        : recorderError && phase === "idle" ? "error"
          : phase;
  return {
    phase: shownPhase,
    error: error ?? recorderError,
    result,
    best: segment ? best.get(segment.idx) ?? null : null,
    elapsedMs: recorder.elapsedMs,
    canPlayMine: mineUrl !== null,
    playingMine,
    toggle,
    playMine,
    stopMine,
  };
}
```

- [ ] **Step 4: 跑测试确认通过** — `yarn web:typecheck`;`cd web && yarn vitest run src/features/library/use-shadowing.test.tsx src/architecture.test.ts`。

- [ ] **Step 5: 提交** — `feat(web): useShadowing records, scores and logs library sentence attempts`。

---

## Task 7: 评分卡 `ScoreCard`(CountUp + GradientText,设计稿 D)

**Files:**
- Create: `web/src/features/library/score-card.tsx`、`web/src/features/library/score-card.test.tsx`

**Interfaces:**
- Produces:`ScoreCardProps { scores: AssessmentScores; attemptSaved: boolean; save: SaveSentenceState }`、`ScoreCard(props)`(`data-testid="assessment-scores"`、`data-tone`;子元素 `score-ring-arc`、`score-main`、`score-headline`、`shadow-attempt-unsaved`、`shadow-save`)
- Consumes:`CountUp`、`GradientText`、`GlassSurface`(`./shadow-fx`)、`SaveSentenceChip` / `SaveSentenceState`(Task 5)、`scoreTone` / `scoreToneClass`(`~/components/score-tone`)、`AssessmentScores`(`~/features/practice`,类型)

**(Addendum,R-SH24)** spec §11.4 写「展开 `MobileScoreResult`」;spec §11.4a 与设计稿 D 的评分结果是另一张卡:评分环从 0 转到分数并**数字滚动**(`CountUp`)、「发音很棒」是**渐变字**(`GradientText`)、下面一排「加入练习」(`ClickSpark`)。practice 的 `MobileScoreResult` 是静态圆环,无法加入这两个效果,也不能改(practice 不归本车道),所以库里自己画这张卡;三项子分沿用 `models.pronunciationAssessment.*` 现有文案键。分数色仍是全站刻度(≥85 绿 / 70–84 琥珀 / <70 灰,`score-tone.ts`);只有 ≥ 85 时评语用渐变字(设计稿:「分数高时渐变色字」)。卡片是 `GlassSurface`(半透明填充,**无 `backdrop-filter`**,§11.4a)。

- [ ] **Step 1: 写失败测试** — `web/src/features/library/score-card.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import "./locales";
import { ScoreCard } from "./score-card";
import { useSaveSentence } from "./save-sentence";

const SCORES = { pronunciationScore: 86, accuracyScore: 84, fluencyScore: 82, completenessScore: 100 };

function Harness({ scores = SCORES, attemptSaved = true }: { scores?: typeof SCORES; attemptSaved?: boolean }) {
  const save = useSaveSentence("Hello world.");
  return <ScoreCard scores={scores} attemptSaved={attemptSaved} save={save} />;
}

function setup(props: Parameters<typeof Harness>[0] = {}) {
  const api = new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock({}).fetch });
  return render(<TestProviders api={api}><Harness {...props} /></TestProviders>);
}

describe("ScoreCard (spec §11.4a, plan W2 R-SH24)", () => {
  it("rolls the numbers up to the scores and fills the ring", async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId("score-main")).toHaveTextContent("86"), { timeout: 3000 });
    const card = screen.getByTestId("assessment-scores");
    await waitFor(() => expect(card).toHaveTextContent("84"), { timeout: 3000 });
    expect(card).toHaveTextContent("82");
    expect(card).toHaveTextContent("100");
    const arc = screen.getByTestId("score-ring-arc");
    await waitFor(() => expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(2 * Math.PI * 30 * 0.14, 3));
  });

  it("uses the score scale for the headline, with gradient text only for a high score", () => {
    const { unmount } = setup();
    expect(screen.getByTestId("assessment-scores")).toHaveAttribute("data-tone", "good");
    expect(screen.getByTestId("score-headline")).toHaveTextContent(i18n.t("web.library.shadow.score.good"));
    unmount();
    setup({ scores: { ...SCORES, pronunciationScore: 74 } });
    expect(screen.getByTestId("assessment-scores")).toHaveAttribute("data-tone", "fair");
    expect(screen.getByTestId("score-headline")).toHaveTextContent(i18n.t("web.library.shadow.score.fair"));
  });

  it("calls a low score low and survives out-of-range numbers", () => {
    setup({ scores: { pronunciationScore: 41, accuracyScore: 50, fluencyScore: Number.NaN, completenessScore: 140 } });
    expect(screen.getByTestId("assessment-scores")).toHaveAttribute("data-tone", "low");
    expect(screen.getByTestId("score-headline")).toHaveTextContent(i18n.t("web.library.shadow.score.low"));
  });

  it("says when the attempt was not added to the best scores, and offers the add-to-practice chip", () => {
    setup({ attemptSaved: false });
    expect(screen.getByTestId("shadow-attempt-unsaved")).toHaveTextContent(i18n.t("web.library.shadow.attemptNotSaved"));
    expect(screen.getByTestId("shadow-save")).toHaveAttribute("data-state", "idle");
  });

  it("hides the note when the attempt was recorded", () => {
    setup({ attemptSaved: true });
    expect(screen.queryByTestId("shadow-attempt-unsaved")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/score-card.test.tsx`(模块不存在)。

- [ ] **Step 3: 实现** — `web/src/features/library/score-card.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { scoreTone, scoreToneClass, type ScoreTone } from "~/components/score-tone";
import type { AssessmentScores } from "~/features/practice";
import { SaveSentenceChip, type SaveSentenceState } from "./save-sentence";
import "./locales";
import { CountUp, GlassSurface, GradientText } from "./shadow-fx";

const R = 30;
const C = 2 * Math.PI * R;
const STROKE: Record<ScoreTone, string> = { good: "stroke-green", fair: "stroke-amber", low: "stroke-ink-3" };
const clamp = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

export interface ScoreCardProps {
  scores: AssessmentScores;
  /** POST attempts 是否成功;失败时只说一句,分数照常显示(R-SH14) */
  attemptSaved: boolean;
  save: SaveSentenceState;
}

/**
 * 一次跟读的评分卡(设计稿 D,spec §11.4a):评分环从 0 转到分数 + 数字滚动(CountUp),评语 ≥ 85 用渐变字(GradientText),
 * 三项子分,「加入练习」芯片(ClickSpark)。每次评分重新挂载(调用方以 assessmentId 作 key),所以动画每次都从 0 开始;
 * 减少动态效果时环直接到位、数字直接是终值(CountUp 自己处理,环用 motion-reduce:transition-none)。
 */
export function ScoreCard({ scores, attemptSaved, save }: ScoreCardProps) {
  const { t } = useTranslation();
  const main = clamp(scores.pronunciationScore);
  const tone = scoreTone(main);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof requestAnimationFrame !== "function") {
      setReady(true);
      return undefined;
    }
    const id = requestAnimationFrame(() => setReady(true)); // 先以 0 画一帧,再过渡到目标值
    return () => cancelAnimationFrame(id);
  }, []);
  const headline = t(`web.library.shadow.score.${tone}`);
  const stats = [
    ["accuracyScore", scores.accuracyScore],
    ["fluencyScore", scores.fluencyScore],
    ["completenessScore", scores.completenessScore],
  ] as const;

  return (
    <GlassSurface tint data-testid="assessment-scores" data-tone={tone} className="p-3.5">
      <div className="flex items-center gap-3.5">
        <div className="relative h-[72px] w-[72px] flex-none">
          <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90" aria-hidden>
            <circle cx="36" cy="36" r={R} fill="none" strokeWidth="6" className="stroke-hair" />
            <circle
              data-testid="score-ring-arc" cx="36" cy="36" r={R} fill="none" strokeWidth="6" strokeLinecap="round"
              className={cn(STROKE[tone], "transition-[stroke-dashoffset] duration-1000 ease-standard motion-reduce:transition-none")}
              strokeDasharray={C} strokeDashoffset={ready ? C * (1 - main / 100) : C}
            />
          </svg>
          <span data-testid="score-main" className={cn("absolute inset-0 flex items-center justify-center text-[22px] font-semibold", scoreToneClass(main))}>
            <CountUp to={main} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div data-testid="score-headline" className="text-title font-semibold">
            {tone === "good" ? <GradientText>{headline}</GradientText> : <span className={scoreToneClass(main)}>{headline}</span>}
          </div>
          <div className="mt-1 text-meta text-ink-2">{t("pronunciationAssessment")}</div>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        {stats.map(([key, value]) => (
          <div key={key} className="min-w-0">
            <dt className="truncate text-meta text-ink-2">{t(`models.pronunciationAssessment.${key}`)}</dt>
            <dd className={cn("text-body font-semibold", scoreToneClass(clamp(value)))}><CountUp to={clamp(value)} /></dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <SaveSentenceChip save={save} />
      </div>
      {!attemptSaved && (
        <p data-testid="shadow-attempt-unsaved" className="mt-2 text-meta text-ink-2">{t("web.library.shadow.attemptNotSaved")}</p>
      )}
    </GlassSurface>
  );
}
```

- [ ] **Step 4: 跑测试确认通过** — `yarn web:typecheck`;`cd web && yarn vitest run src/features/library/score-card.test.tsx src/architecture.test.ts`。

- [ ] **Step 5: 提交** — `feat(web): library score card with rolling numbers and gradient headline`。

---

## Task 8: 微调面板 `SegmentEditor`(相邻句边界取自 W1 传的 `prevEndMs` / `nextStartMs`)

**Files:**
- Create: `web/src/features/library/segment-editor.tsx`、`web/src/features/library/segment-editor.test.tsx`

**Interfaces:**
- Produces:`NUDGE_MS = 200`、`MIN_SEGMENT_MS = 200`、`MAX_SEGMENT_TEXT = 600`、`Bounds`、`segmentBounds(prevEndMs, nextStartMs, durationMs)`、`nudge(draft, edge, delta, bounds)`、`cleanSegmentText(text)`、`segmentPatch(orig, draft) → SegmentPatch | null`、`formatMs(ms)`、`SegmentEditor(props: SegmentEditorProps)`
- Consumes:`patchSegment`、`SHADOW_SERVER_ERRORS`(Task 2)、`translateServerError`

- [ ] **Step 1: 写失败测试** — `web/src/features/library/segment-editor.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import {
  MAX_SEGMENT_TEXT, SegmentEditor, cleanSegmentText, formatMs, nudge, segmentBounds, segmentPatch,
} from "./segment-editor";

const SEG = { idx: 2, startMs: 1000, endMs: 3000, text: "Hello world." };

describe("segment editor rules (plan W2 R-SH16)", () => {
  it("bounds a sentence by its neighbours, else by 0 and the media duration", () => {
    expect(segmentBounds(900, 3300, 10_000)).toEqual({ min: 900, max: 3300 });
    expect(segmentBounds(900, null, 10_000)).toEqual({ min: 900, max: 10_000 });
    expect(segmentBounds(null, null, null)).toEqual({ min: 0, max: Number.POSITIVE_INFINITY });
  });

  it("nudges by 0.2 s, clamps to the bounds and keeps at least 0.2 s of sentence", () => {
    const b = { min: 900, max: 3300 };
    expect(nudge({ startMs: 1000, endMs: 3000 }, "start", -200, b).startMs).toBe(900);
    expect(nudge({ startMs: 2700, endMs: 3000 }, "start", 200, b).startMs).toBe(2800);
    expect(nudge({ startMs: 1000, endMs: 3200 }, "end", 200, b).endMs).toBe(3300);
    expect(nudge({ startMs: 1000, endMs: 1300 }, "end", -200, b).endMs).toBe(1200);
    expect(nudge({ startMs: 1000, endMs: 1100 }, "start", -200, { min: 1000, max: 3300 })).toEqual({ startMs: 1000, endMs: 1100 });
  });

  it("cleans text: folds whitespace, requires a letter, at most 600 characters", () => {
    expect(cleanSegmentText("  Hello   world. ")).toBe("Hello world.");
    expect(cleanSegmentText("123")).toBeNull();
    expect(cleanSegmentText("   ")).toBeNull();
    expect(cleanSegmentText("a".repeat(MAX_SEGMENT_TEXT))).toHaveLength(MAX_SEGMENT_TEXT);
    expect(cleanSegmentText("a".repeat(MAX_SEGMENT_TEXT + 1))).toBeNull();
  });

  it("patches only what changed; null when the text is invalid", () => {
    expect(segmentPatch(SEG, { startMs: 1000, endMs: 3000, text: "Hello  world. " })).toEqual({});
    expect(segmentPatch(SEG, { startMs: 1200, endMs: 3000, text: "Hello world." })).toEqual({ startMs: 1200 });
    expect(segmentPatch(SEG, { startMs: 1000, endMs: 3000, text: "Hello there." })).toEqual({ text: "Hello there." });
    expect(segmentPatch(SEG, { startMs: 1000, endMs: 3000, text: "42" })).toBeNull();
  });

  it("formats times as m:ss.t", () => {
    expect(formatMs(0)).toBe("0:00.0");
    expect(formatMs(1400)).toBe("0:01.4");
    expect(formatMs(75_400)).toBe("1:15.4");
  });
});

function setup(handler?: Handler) {
  const mock = createFetchMock(handler ? { "PATCH /api/library/items/i1/segments/2": handler } : {});
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <TestProviders api={api}>
      <SegmentEditor itemId="i1" segment={SEG} prevEndMs={900} nextStartMs={3300} durationMs={10_000} onSaved={onSaved} onClose={onClose} />
    </TestProviders>,
  );
  return { mock, onSaved, onClose };
}

describe("SegmentEditor", () => {
  it("moves the start later twice and saves only start_ms", async () => {
    const { mock, onSaved, onClose } = setup(() => json({ idx: 2, start_ms: 1400, end_ms: 3000, text: "Hello world." }));
    await userEvent.click(screen.getByTestId("segment-start-later"));
    await userEvent.click(screen.getByTestId("segment-start-later"));
    expect(screen.getByTestId("segment-start")).toHaveTextContent("0:01.4");
    await userEvent.click(screen.getByTestId("segment-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ idx: 2, startMs: 1400, endMs: 3000, text: "Hello world." }));
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ start_ms: 1400 });
    expect(mock.calls[0].url.search).toBe("");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes without a request when nothing changed", async () => {
    const { mock, onClose } = setup();
    await userEvent.click(screen.getByTestId("segment-save"));
    expect(onClose).toHaveBeenCalled();
    expect(mock.calls).toHaveLength(0);
  });

  it("disables saving for text without letters", async () => {
    setup();
    await userEvent.clear(screen.getByTestId("segment-text"));
    await userEvent.type(screen.getByTestId("segment-text"), "123");
    expect(screen.getByTestId("segment-text-invalid")).toHaveTextContent(i18n.t("web.library.shadow.editor.invalidText"));
    expect(screen.getByTestId("segment-save")).toBeDisabled();
  });

  it("shows the translated server refusal and keeps the editor open", async () => {
    const { onSaved, onClose } = setup(() => json({ error: "Invalid segment times" }, 400));
    await userEvent.click(screen.getByTestId("segment-end-earlier"));
    await userEvent.click(screen.getByTestId("segment-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("web.library.shadow.errors.badTimes"));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

(若 Task 0 改了 `SHADOW_SERVER_ERRORS` 的键,最后一个用例里的 `"Invalid segment times"` 换成对应的真实文本。)

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/segment-editor.test.tsx`(模块不存在)。

- [ ] **Step 3: 实现** — `web/src/features/library/segment-editor.tsx`:

```tsx
import { MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { IconButton } from "~/components/icon-button";
import { SHADOW_SERVER_ERRORS, patchSegment, type SavedSegment, type SegmentPatch } from "./attempts-api";
import "./locales";

export const NUDGE_MS = 200;
export const MIN_SEGMENT_MS = 200;
export const MAX_SEGMENT_TEXT = 600;

export interface Bounds {
  min: number;
  max: number;
}

interface Span {
  startMs: number;
  endMs: number;
}

/** 起点不早于上一句终点(没有 = 0),终点不晚于下一句起点(没有 = 媒体时长;时长未知 = 不限)。 */
export function segmentBounds(prevEndMs: number | null, nextStartMs: number | null, durationMs: number | null): Bounds {
  return {
    min: prevEndMs ?? 0,
    max: nextStartMs ?? durationMs ?? Number.POSITIVE_INFINITY,
  };
}

/** 移动起点或终点 delta 毫秒,夹在边界内并保留至少 MIN_SEGMENT_MS;无处可移时原样返回(R-SH16)。 */
export function nudge<T extends Span>(draft: T, edge: "start" | "end", delta: number, bounds: Bounds): T {
  if (edge === "start") {
    const lo = bounds.min;
    const hi = draft.endMs - MIN_SEGMENT_MS;
    if (lo > hi) return draft;
    return { ...draft, startMs: Math.min(Math.max(draft.startMs + delta, lo), hi) };
  }
  const lo = draft.startMs + MIN_SEGMENT_MS;
  const hi = bounds.max;
  if (lo > hi) return draft;
  return { ...draft, endMs: Math.min(Math.max(draft.endMs + delta, lo), hi) };
}

const fold = (s: string) => s.replace(/\s+/g, " ").trim();

/** 空白折叠后 1–600 字且含字母;否则 null(与 spec §9 的服务端规则一致)。 */
export function cleanSegmentText(text: string): string | null {
  const v = fold(text);
  return v && v.length <= MAX_SEGMENT_TEXT && /\p{L}/u.test(v) ? v : null;
}

/** 只含变化的键;文字无效时返回 null。 */
export function segmentPatch(orig: SavedSegment, draft: Span & { text: string }): SegmentPatch | null {
  const text = cleanSegmentText(draft.text);
  if (text === null) return null;
  const patch: SegmentPatch = {};
  if (draft.startMs !== orig.startMs) patch.startMs = draft.startMs;
  if (draft.endMs !== orig.endMs) patch.endMs = draft.endMs;
  if (text !== fold(orig.text)) patch.text = text;
  return patch;
}

/** 毫秒 → "m:ss.t"(十分之一秒,微调步长 0.2 s 需要这个精度)。 */
export function formatMs(ms: number): string {
  const tenths = Math.max(0, Math.round(ms / 100));
  const minutes = Math.floor(tenths / 600);
  const rest = tenths % 600;
  return `${minutes}:${String(Math.floor(rest / 10)).padStart(2, "0")}.${rest % 10}`;
}

export interface SegmentEditorProps {
  itemId: string;
  segment: SavedSegment;
  /** 上一句的终点(没有 = null);W1 的 prevEndMs */
  prevEndMs: number | null;
  /** 下一句的起点(没有 = null);W1 的 nextStartMs */
  nextStartMs: number | null;
  durationMs: number | null;
  onSaved: (segment: SavedSegment) => void;
  onClose: () => void;
}

const EDGES = ["start", "end"] as const;

export function SegmentEditor({ itemId, segment, prevEndMs, nextStartMs, durationMs, onSaved, onClose }: SegmentEditorProps) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [draft, setDraft] = useState({ startMs: segment.startMs, endMs: segment.endMs, text: segment.text });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const bounds = segmentBounds(prevEndMs, nextStartMs, durationMs);
  const patch = segmentPatch(segment, draft);

  const move = (edge: "start" | "end", delta: number) => setDraft((d) => nudge(d, edge, delta, bounds));

  const save = async () => {
    if (!patch || saving) return;
    if (!Object.keys(patch).length) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await patchSegment(api, itemId, segment.idx, patch, segment);
      if (!mounted.current) return;
      toast.success(t("web.library.shadow.editor.saved"));
      onSaved(saved);
      onClose();
    } catch (err) {
      if (mounted.current) setError(translateServerError(t, err, SHADOW_SERVER_ERRORS));
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <div data-testid="segment-editor" className="mt-3 space-y-3 rounded-button bg-surface-2 p-3">
      <div className="eyebrow">{t("web.library.shadow.editor.title")}</div>
      {EDGES.map((edge) => (
        <div key={edge} className="flex items-center gap-1.5">
          <span className="w-12 flex-none text-sub text-ink-2">{t(`web.library.shadow.editor.${edge}`)}</span>
          <IconButton label={t(`web.library.shadow.editor.${edge}Earlier`)} data-testid={`segment-${edge}-earlier`}
            disabled={saving} onClick={() => move(edge, -NUDGE_MS)}>
            <MinusIcon aria-hidden />
          </IconButton>
          <span data-testid={`segment-${edge}`} className="num min-w-[64px] text-center text-body text-ink">
            {formatMs(edge === "start" ? draft.startMs : draft.endMs)}
          </span>
          <IconButton label={t(`web.library.shadow.editor.${edge}Later`)} data-testid={`segment-${edge}-later`}
            disabled={saving} onClick={() => move(edge, NUDGE_MS)}>
            <PlusIcon aria-hidden />
          </IconButton>
        </div>
      ))}
      <label className="block">
        <span className="text-sub text-ink-2">{t("web.library.shadow.editor.text")}</span>
        <textarea data-testid="segment-text" rows={3} maxLength={MAX_SEGMENT_TEXT} value={draft.text} disabled={saving}
          onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
          className="mt-1 w-full resize-none rounded-button border-0 bg-surface px-3 py-2 text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </label>
      {!patch && (
        <p data-testid="segment-text-invalid" className="text-meta text-destructive">{t("web.library.shadow.editor.invalidText")}</p>
      )}
      {error && <p role="alert" data-testid="segment-error" className="text-sub text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" data-testid="segment-cancel" className="h-tap flex-1" disabled={saving} onClick={onClose}>
          {t("web.library.shadow.editor.cancel")}
        </Button>
        <Button data-testid="segment-save" className="h-tap flex-1" disabled={!patch || saving} onClick={() => void save()}>
          {saving ? t("web.library.shadow.editor.saving") : t("web.library.shadow.editor.save")}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过** — `yarn web:typecheck`;`cd web && yarn vitest run src/features/library/segment-editor.test.tsx src/architecture.test.ts`。

- [ ] **Step 5: 提交** — `feat(web): segment editor with 0.2 s nudges and text fixes`。

---
## Task 9: AI 分析卡 `AnalysisCard`(BlurText、缓存、重试、收起)

**Files:**
- Create: `web/src/features/library/analysis-card.tsx`、`web/src/features/library/analysis-card.test.tsx`

**Interfaces:**
- Produces:`AnalysisSection { title: string | null; body: string }`、`parseAnalysis(text) → AnalysisSection[]`、`resetAnalysisCache()`、`AnalysisCardProps { itemId: string; segment: SegmentWithAi }`、`AnalysisCard(props)`(`data-testid="analysis-card"`、`data-status="loading" | "done" | "error"`;子元素 `analysis-loading`、`analysis-toggle`、`analysis-retry`、`analysis-error`)
- Consumes:`analyzeSegment`、`SegmentWithAi`、`SHADOW_SERVER_ERRORS`(Task 2)、`BlurText`、`GlassSurface`(`./shadow-fx`)、`nativeLanguageCode` / `useSettings`(`~/settings/settings-context`)、`translateServerError`、`ApiError`

**R-SH28(Addendum)分析卡的行为(spec §11.4「每句『更多』菜单」、E11、E12):** 分析**只在用户从 ⋯ 菜单点「AI 分析」时**请求,不自动触发、不预取。卡片出现 → 立即请求(`POST …/segments/{idx}/analysis`,体 `{native_language}`);等待时是骨架;完成后按桌面端 `analyze` 提示词规定的分节显示。**核对**:`enjoy/src/shared/commands/analyze.command.ts` 的系统提示词要求模型以母语返回三节 markdown:`### Sentence Structure` / `### Grammar` / `### Vocabulary/Phrases`(标题文字可能被模型译成母语),所以按「以 `#` 开头的行 = 一节的标题」切分,不依赖标题文字;没有任何标题时整段当一节。刚生成的分析(服务端 `cached: false`)用 `BlurText` 逐字浮现(设计稿 E,只在生成完成的那一次);服务端已缓存的、本页缓存命中的、W1 随句子带来的(`segment.analysis` 且 `analysisLang` 与母语一致或未给)直接显示,**不请求、不动画**。卡片可**收起**(头部按钮,收起后再展开不重新请求、也不重播动画);失败(含额度满 429、AI 未开启 404)显示固定文案与「重试」。本页缓存是模块级 `Map`(键 = 条目 + 句序号 + 母语 + 句子原文,最多 200 条,只在内存里,不进任何存储),句子文字被改后键变了,旧分析自然失效(服务端同时清掉它,E11)。卡片是 `GlassSurface`(无 `backdrop-filter`)。

- [ ] **Step 1: 写失败测试** — `web/src/features/library/analysis-card.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { AnalysisCard, parseAnalysis, resetAnalysisCache } from "./analysis-card";
import "./locales";

const SEG = { idx: 2, startMs: 1000, endMs: 3000, text: "So, Rachel, what are you going to do now?" };
const TEXT = "### Sentence Structure\nA wh-question.\n\n### Grammar\nbe going to + verb\n\n### Vocabulary/Phrases\nwhat now";
const ROUTE = "POST /api/library/items/i1/segments/2/analysis";

function setup(handler: Handler, segment: Parameters<typeof AnalysisCard>[0]["segment"] = SEG) {
  const mock = createFetchMock({ [ROUTE]: handler });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const view = render(<TestProviders api={api}><AnalysisCard itemId="i1" segment={segment} /></TestProviders>);
  const again = () => view.rerender(<TestProviders api={api}><AnalysisCard itemId="i1" segment={segment} /></TestProviders>);
  return { mock, view, again };
}

describe("parseAnalysis (plan W2 R-SH28)", () => {
  it("splits on markdown headings, whatever language they are in", () => {
    expect(parseAnalysis(TEXT)).toEqual([
      { title: "Sentence Structure", body: "A wh-question." },
      { title: "Grammar", body: "be going to + verb" },
      { title: "Vocabulary/Phrases", body: "what now" },
    ]);
    expect(parseAnalysis("### 句子结构\r\n疑问句\r\n### 语法\r\nbe going to")).toEqual([
      { title: "句子结构", body: "疑问句" },
      { title: "语法", body: "be going to" },
    ]);
  });

  it("keeps text before the first heading and falls back to one section without headings", () => {
    expect(parseAnalysis("Intro line\n## Grammar\nx")).toEqual([{ title: null, body: "Intro line" }, { title: "Grammar", body: "x" }]);
    expect(parseAnalysis("Just a paragraph.\nSecond line.")).toEqual([{ title: null, body: "Just a paragraph.\nSecond line." }]);
    expect(parseAnalysis("### Grammar\n")).toEqual([{ title: null, body: "### Grammar" }]);
  });
});

describe("AnalysisCard (spec §11.4, plan W2 R-SH28)", () => {
  beforeEach(() => resetAnalysisCache());

  it("shows a skeleton, then the sections, and asks for the native language in the body", async () => {
    const { mock } = setup(() => json({ analysis: TEXT, cached: false }));
    expect(screen.getByTestId("analysis-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("analysis-card")).toHaveAttribute("data-status", "done"));
    const card = screen.getByTestId("analysis-card");
    expect(card).toHaveTextContent("Sentence Structure");
    expect(card).toHaveTextContent("be going to + verb");
    expect(card).toHaveTextContent("Vocabulary/Phrases");
    expect(JSON.parse(mock.calls[0].body as string).native_language).toMatch(/^(en-US|zh-CN|es-ES)$/);
    expect(mock.calls[0].url.search).toBe("");
  });

  it("does not ask again for an analysis it already has, even after the card was closed", async () => {
    const first = setup(() => json({ analysis: TEXT, cached: false }));
    await waitFor(() => expect(screen.getByTestId("analysis-card")).toHaveAttribute("data-status", "done"));
    first.view.unmount();
    const second = setup(() => json({ analysis: "other", cached: false }));
    expect(screen.getByTestId("analysis-card")).toHaveAttribute("data-status", "done");
    expect(screen.getByTestId("analysis-card")).toHaveTextContent("be going to + verb");
    expect(second.mock.calls).toHaveLength(0);
  });

  it("shows a stored analysis that came with the sentence without a request", () => {
    const { mock } = setup(() => json({ analysis: "never", cached: false }), { ...SEG, analysis: TEXT, analysisLang: null });
    expect(screen.getByTestId("analysis-card")).toHaveAttribute("data-status", "done");
    expect(mock.calls).toHaveLength(0);
  });

  it("collapses and expands without a second request", async () => {
    const { mock } = setup(() => json({ analysis: TEXT, cached: false }));
    await waitFor(() => expect(screen.getByTestId("analysis-card")).toHaveAttribute("data-status", "done"));
    await userEvent.click(screen.getByTestId("analysis-toggle"));
    expect(screen.getByTestId("analysis-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("analysis-card")).not.toHaveTextContent("be going to + verb");
    await userEvent.click(screen.getByTestId("analysis-toggle"));
    expect(screen.getByTestId("analysis-card")).toHaveTextContent("be going to + verb");
    expect(mock.calls).toHaveLength(1);
  });

  it("offers a retry after a failure and recovers", async () => {
    let fail = true;
    const { mock } = setup(() => (fail ? json({ error: "boom" }, 500) : json({ analysis: TEXT, cached: false })));
    expect(await screen.findByTestId("analysis-error")).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByTestId("analysis-retry"));
    await waitFor(() => expect(screen.getByTestId("analysis-card")).toHaveAttribute("data-status", "done"));
    expect(mock.calls).toHaveLength(2);
  });

  it("says so when the daily limit is used up (429) or the feature is off (404)", async () => {
    const limited = setup(() => json({ error: "Daily analysis limit reached" }, 429));
    expect(await screen.findByTestId("analysis-error")).toHaveTextContent(i18n.t("web.library.shadow.analysis.limited"));
    limited.view.unmount();
    setup(() => json({ error: "Not Found" }, 404));
    expect(await screen.findByTestId("analysis-error")).toHaveTextContent(i18n.t("web.library.shadow.analysis.unavailable"));
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/analysis-card.test.tsx`(模块不存在)。

- [ ] **Step 3: 实现** — `web/src/features/library/analysis-card.tsx`:

```tsx
import { ChevronDownIcon, SparklesIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { nativeLanguageCode, useSettings } from "~/settings/settings-context";
import { SHADOW_SERVER_ERRORS, analyzeSegment, type SegmentWithAi } from "./attempts-api";
import "./locales";
import { BlurText, GlassSurface } from "./shadow-fx";

export interface AnalysisSection {
  title: string | null;
  body: string;
}

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

/**
 * 桌面端 analyze 提示词返回的 markdown 分节(### Sentence Structure / ### Grammar / ### Vocabulary/Phrases,标题可能被译成母语):
 * 以 # 开头的行是一节的标题,其后到下一个标题之前是正文;标题前的文字是无标题的一节;正文为空的节丢弃;一个标题都没有就整段当一节。
 */
export function parseAnalysis(text: string): AnalysisSection[] {
  const sections: AnalysisSection[] = [];
  let title: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    const body = lines.join("\n").trim();
    if (body) sections.push({ title, body });
    lines = [];
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      title = heading[1] || null;
    } else {
      lines.push(line);
    }
  }
  flush();
  return sections.length ? sections : [{ title: null, body: text.trim() }];
}

// 本页缓存:键 = 条目 + 句序号 + 母语 + 句子原文(改了字,键就变,旧分析自然失效)。只在内存里。
const MAX_CACHED = 200;
const analysisCache = new Map<string, string>();
const keyOf = (itemId: string, idx: number, lang: string, text: string) => `${itemId}\u0000${idx}\u0000${lang}\u0000${text}`;
function remember(key: string, text: string): void {
  analysisCache.delete(key);
  analysisCache.set(key, text);
  while (analysisCache.size > MAX_CACHED) analysisCache.delete(analysisCache.keys().next().value as string);
}

/** 只给测试:清空缓存。 */
export function resetAnalysisCache(): void {
  analysisCache.clear();
}

function analysisError(t: TFunction, err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return t("web.library.shadow.analysis.limited"); // 额度满(spec §9)
    if (err.status === 404) return t("web.library.shadow.analysis.unavailable"); // library_ai_enabled 关
  }
  return translateServerError(t, err, SHADOW_SERVER_ERRORS);
}

type State =
  | { status: "loading" }
  | { status: "done"; text: string; fresh: boolean }
  | { status: "error"; message: string };

export interface AnalysisCardProps {
  itemId: string;
  segment: SegmentWithAi;
}

/** 一句的 AI 分析卡(spec §11.4、设计稿 E):骨架 → BlurText 逐字浮现 → 可收起、命中缓存不再请求、失败可重试。 */
export function AnalysisCard({ itemId, segment }: AnalysisCardProps) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const { language } = useSettings();
  const native = nativeLanguageCode(language);
  const key = keyOf(itemId, segment.idx, native, segment.text);
  const sent = segment.analysis && (!segment.analysisLang || segment.analysisLang === native) ? segment.analysis : undefined;
  const stored = analysisCache.get(key) ?? sent;
  const [state, setState] = useState<State>(() => (stored ? { status: "done", text: stored, fresh: false } : { status: "loading" }));
  const [collapsed, setCollapsed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const hadStored = useRef(Boolean(stored));

  const run = useCallback(async () => {
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    setState({ status: "loading" });
    try {
      const res = await analyzeSegment(api, itemId, segment.idx, native, ctl.signal);
      if (ctl.signal.aborted || !mounted.current) return;
      remember(key, res.analysis);
      setState({ status: "done", text: res.analysis, fresh: !res.cached });
    } catch (err) {
      if (ctl.signal.aborted || !mounted.current) return;
      setState({ status: "error", message: analysisError(t, err) });
    }
  }, [api, itemId, segment.idx, native, key, t]);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    mounted.current = true;
    if (!hadStored.current) void runRef.current(); // 只在挂载时请求;命中缓存 / 随句子带来的不请求
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  const toggle = () => {
    // 收起后再展开不重播动画
    setState((s) => (s.status === "done" && s.fresh ? { ...s, fresh: false } : s));
    setCollapsed((v) => !v);
  };

  return (
    <GlassSurface tint data-testid="analysis-card" data-status={state.status} className="p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-meta text-ink-2">
          <SparklesIcon aria-hidden className="h-3.5 w-3.5" />
          {t("web.library.shadow.analysis.title")}
        </span>
        <button
          type="button" data-testid="analysis-toggle" aria-expanded={!collapsed} onClick={toggle}
          className="-mr-2 inline-flex min-h-tap items-center gap-1 rounded-button px-2 text-meta text-ink-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {collapsed ? t("web.library.shadow.analysis.expand") : t("web.library.shadow.analysis.collapse")}
          <ChevronDownIcon aria-hidden className={cn("h-4 w-4 transition-transform duration-fast motion-reduce:transition-none", !collapsed && "rotate-180")} />
        </button>
      </div>
      {!collapsed && (
        <div className="mt-1" aria-live="polite">
          {state.status === "loading" && (
            <div role="status" data-testid="analysis-loading" aria-label={t("web.library.shadow.analysis.loading")} className="space-y-2 py-1">
              {["w-11/12", "w-full", "w-8/12"].map((w) => (
                <div key={w} className={cn("h-3 animate-pulse rounded-inline bg-surface-2 motion-reduce:animate-none", w)} />
              ))}
            </div>
          )}
          {state.status === "error" && (
            <div>
              <p role="alert" data-testid="analysis-error" className="text-sub text-ink-2">{state.message}</p>
              <Button variant="outline" data-testid="analysis-retry" className="mt-2 h-tap" onClick={() => void run()}>
                {t("web.library.shadow.analysis.retry")}
              </Button>
            </div>
          )}
          {state.status === "done" && (
            <div className="select-text">
              {parseAnalysis(state.text).map((section, i) => (
                <section key={i} className="mt-2.5 first:mt-0">
                  {section.title && <h4 className="text-meta font-semibold text-teal">{section.title}</h4>}
                  {section.body.split(/\n+/).map((paragraph, j) => (
                    <p key={j} className="mt-0.5 text-sub leading-[1.7] text-ink">
                      {state.fresh ? <BlurText text={paragraph} /> : paragraph}
                    </p>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </GlassSurface>
  );
}
```

- [ ] **Step 4: 跑测试确认通过** — `yarn web:typecheck`;`cd web && yarn vitest run src/features/library/analysis-card.test.tsx src/architecture.test.ts`。

- [ ] **Step 5: 提交** — `feat(web): AI analysis card for library sentences`。

---

## Task 10: 译文批量取 `use-translations.ts`(视野附近、去重、额度满 / 失败只提示一次)

**Files:**
- Create: `web/src/features/library/use-translations.ts`、`web/src/features/library/use-translations.test.tsx`

**Interfaces:**
- Produces:`TRANSLATE_BATCH = 20`、`NEAR_MARGIN_PX = 800`、`FLUSH_DELAY_MS = 150`、`APPLY_GAP_MS = 0`、`TranslateNotice = "limited" | "failed"`、`TranslationRow { near; hasZh; apply(zh) }`、`BatcherOptions`、`TranslationBatcher`(`register / unregister / setNear / setHasZh / setEnabled / dispose`)、`RowTranslationOptions`、`useRowTranslation(opts)`
- Consumes:`translateSegments`(Task 2)、`nativeLanguageCode` / `useSettings`、`useAuth`、`ApiError`、`toast`(sonner)

**R-SH27(Addendum)译文怎么取、怎么交给 W1:**
- **谁渲染、谁取。** W1 渲染译文行(只读 `segment.zh`,骨架行也归 W1,C9④);W2 只负责「取」并把结果交回:`onSegmentSaved({ ...segment, zh, zhLang })`(C9③,W1 按 `idx` 替换那一句)。「译」开关是 W1 的状态,以可选 prop `translate` 传给每行的 `ShadowPanel`(C9②);开关关 = 不请求。
- **每行一个哨兵,条目一个批处理器。** W1 的每一行都渲染 `<ShadowPanel>`(R-SH03),所以每行调一次 `useRowTranslation`,把自己登记到**按条目共享**的 `TranslationBatcher`(模块级注册表,最后一行卸载时销毁)。批处理器收集「视野附近、还没有译文、不在途、没失败过」的句子,**每次 ≤ 20 句**(spec §9、E12),按句序号升序、顺序请求(同一时刻最多一个请求),请求前防抖 `FLUSH_DELAY_MS`。**去重**:在途的、已有译文的、本会话失败过的句子都不再请求;文字被改后(`hasZh` 变回 false)重新可取。
- **「视野附近」= 行元素与视口之间 800 px 以内。** spec E12 写「视野内及前后各 10 句」。句子行高度不一(带译文的行更高),按句数算要知道每行位置;用 `IntersectionObserver`(`rootMargin: "800px 0px"`)观察每一行**更近似、也更便宜**(一行约 70–90 px,800 px 约 ±10 句)。**观察的是行元素 `closest("li")`,不是哨兵自己**:W1 的行带 `content-visibility: auto`(R-L17),屏幕外行的**内容**不渲染,哨兵在里面会被浏览器当作不可见,近处检测会缩到浏览器自己的 content-visibility 余量(约半屏)。没有 `IntersectionObserver` 的环境(极旧浏览器)把所有行当作「近处」;**注意** `web/src/test/setup.ts` 给 jsdom 装了一个永不触发的 `IntersectionObserver` 空壳,所以用到 `translate` 的测试要先 `vi.stubGlobal("IntersectionObserver", undefined)`(本任务与 Task 12 的测试都这样做)。这是偏离 spec 字面的近似,写进结果文档。
- **额度满与失败只提示一次,不逐句报错。** 服务端 `limited: true`(已有的照常返回、缺的没生成)→ 应用已有的、停止请求、提示 `translateLimited`;请求失败 → 这批句子记为失败(不自动重试)、提示 `translateFailed`;**429 / 404(AI 未开启)立即停止**,连续 2 次失败也停止(防止服务端挂了时每滚一屏就打一次);提示用 `toast.info`,每次「开 → 关」会话只一次。关掉「译」再打开 = 新会话,清空失败 / 停止状态,可重试。
- **应用结果的方式。** 一批 20 句返回后,**每句在各自的宏任务里应用**(`APPLY_GAP_MS = 0` 的 `setTimeout`):W1 的 `onSegmentSaved` 若不是函数式更新,同一个宏任务里连续调用会因闭包里的旧列表丢更新;分开应用时每次调用之前 W1 已重渲、行拿到的是新的回调。W1 是函数式更新时这个间隔无害(Task 0 Step 2 核对)。
- **隐私。** 句子文字只在请求体里(请求只发句序号 `indices` 与母语码,文字在服务端按序号取);译文只进内存里的 `segment.zh`,不写任何存储。

- [ ] **Step 1: 写失败测试** — `web/src/features/library/use-translations.test.tsx`:

```tsx
import { render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import type { TranslateResult } from "./attempts-api";
import "./locales";
import {
  NEAR_MARGIN_PX, TRANSLATE_BATCH, TranslationBatcher, useRowTranslation, type TranslateNotice, type TranslationRow,
} from "./use-translations";

const toastInfo = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { info: toastInfo, error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

type Translate = (indices: number[], signal: AbortSignal) => Promise<TranslateResult>;

function makeBatcher(translate: Translate) {
  const notices: TranslateNotice[] = [];
  const batcher = new TranslationBatcher({ translate, notify: (kind) => notices.push(kind), delayMs: 0, applyGapMs: 0 });
  const applied: Array<[number, string]> = [];
  const row = (idx: number, over: Partial<TranslationRow> = {}): TranslationRow => ({
    near: true, hasZh: false, apply: (zh) => applied.push([idx, zh]), ...over,
  });
  return { batcher, notices, applied, row };
}
const ok = (indices: number[]): TranslateResult => ({ items: indices.map((idx) => ({ idx, zh: `zh${idx}` })), limited: false });
const range = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + i);

describe("TranslationBatcher (spec §9, E12; plan W2 R-SH27)", () => {
  it("requests at most 20 sentences per call, in order, one call at a time, and applies each result", async () => {
    const calls: number[][] = [];
    let running = 0;
    let overlap = false;
    const { batcher, applied, row } = makeBatcher(async (indices) => {
      running += 1;
      overlap = overlap || running > 1;
      calls.push(indices);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return ok(indices);
    });
    for (const i of range(45)) batcher.register(i, row(i));
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(applied).toHaveLength(45));
    expect(calls.map((c) => c.length)).toEqual([TRANSLATE_BATCH, TRANSLATE_BATCH, 5]);
    expect(calls[0]).toEqual(range(20));
    expect(overlap).toBe(false);
    expect(applied.slice(0, 3)).toEqual([[0, "zh0"], [1, "zh1"], [2, "zh2"]]);
    batcher.dispose();
  });

  it("skips sentences that already have a translation, are far from the viewport, or are already in flight", async () => {
    const calls: number[][] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { batcher, applied, row } = makeBatcher(async (indices) => {
      calls.push(indices);
      await gate;
      return ok(indices);
    });
    batcher.register(0, row(0, { hasZh: true }));
    batcher.register(1, row(1));
    batcher.register(2, row(2, { near: false }));
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual([1]);
    batcher.register(3, row(3)); // 登记在 1 在途时:不会重复请求 1
    release();
    await vi.waitFor(() => expect(applied.map((a) => a[0])).toEqual([1, 3]));
    expect(calls).toEqual([[1], [3]]);
    batcher.setNear(2, true); // 滚到它附近才取
    await vi.waitFor(() => expect(applied.map((a) => a[0])).toEqual([1, 3, 2]));
    batcher.dispose();
  });

  it("does nothing while disabled and starts when enabled", async () => {
    const calls: number[][] = [];
    const { batcher, applied, row } = makeBatcher(async (indices) => { calls.push(indices); return ok(indices); });
    batcher.register(0, row(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(applied).toHaveLength(1));
    batcher.dispose();
  });

  it("applies what came back, stops and says so once when the daily limit is reached", async () => {
    const calls: number[][] = [];
    const { batcher, applied, notices, row } = makeBatcher(async (indices) => {
      calls.push(indices);
      return { items: [{ idx: indices[0], zh: "zh" }], limited: true };
    });
    for (const i of range(3)) batcher.register(i, row(i));
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(notices).toEqual(["limited"]));
    expect(applied).toEqual([[0, "zh"]]);
    batcher.register(9, row(9));
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(1);
    expect(notices).toEqual(["limited"]);
    batcher.dispose();
  });

  it("marks a failed batch, says so once, stops after two failures in a row, and never retries the failed ones", async () => {
    const calls: number[][] = [];
    const { batcher, applied, notices, row } = makeBatcher(async (indices) => {
      calls.push(indices);
      throw new ApiError(500, "boom");
    });
    for (const i of range(45)) batcher.register(i, row(i));
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(2); // 第二次失败后停止,第三批没有发
    expect(notices).toEqual(["failed"]);
    expect(applied).toHaveLength(0);
    batcher.dispose();
  });

  it("stops at once on 404 (feature off) and on 429 (quota)", async () => {
    const off = makeBatcher(async () => { throw new ApiError(404, "Not Found"); });
    for (const i of range(30)) off.batcher.register(i, off.row(i));
    off.batcher.setEnabled(true);
    await vi.waitFor(() => expect(off.notices).toEqual(["failed"]));
    await new Promise((r) => setTimeout(r, 30));
    off.batcher.dispose();

    const calls: number[][] = [];
    const quota = makeBatcher(async (indices) => { calls.push(indices); throw new ApiError(429, "limit"); });
    for (const i of range(30)) quota.batcher.register(i, quota.row(i));
    quota.batcher.setEnabled(true);
    await vi.waitFor(() => expect(quota.notices).toEqual(["limited"]));
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toHaveLength(1);
    quota.batcher.dispose();
  });

  it("starts a fresh session when the switch is turned off and on again", async () => {
    let fail = true;
    const { batcher, applied, notices, row } = makeBatcher(async (indices) => {
      if (fail) throw new ApiError(500, "boom");
      return ok(indices);
    });
    batcher.register(1, row(1));
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(notices).toEqual(["failed"]));
    fail = false;
    batcher.setEnabled(false);
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(applied).toEqual([[1, "zh1"]]));
    batcher.dispose();
  });

  it("fetches again after a sentence's text was edited and its translation cleared", async () => {
    const calls: number[][] = [];
    const { batcher, row } = makeBatcher(async (indices) => { calls.push(indices); return ok(indices); });
    const r1 = row(1);
    batcher.register(1, r1);
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    batcher.setHasZh(1, false);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual([1]);
    batcher.dispose();
  });

  it("ignores results for sentences it did not ask for", async () => {
    const { batcher, applied, row } = makeBatcher(async (indices) => ({
      items: [...ok(indices).items, { idx: 99, zh: "stray" }],
      limited: false,
    }));
    batcher.register(1, row(1));
    batcher.register(99, row(99, { hasZh: true }));
    batcher.setEnabled(true);
    await vi.waitFor(() => expect(applied).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(applied).toEqual([[1, "zh1"]]);
    batcher.dispose();
  });

  it("drops a late result after dispose", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { batcher, applied, row } = makeBatcher(async (indices) => {
      await gate;
      return ok(indices);
    });
    batcher.register(1, row(1));
    batcher.setEnabled(true);
    await new Promise((r) => setTimeout(r, 20));
    batcher.dispose();
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(applied).toHaveLength(0);
  });
});

// ---- 钩子:行登记、IntersectionObserver、真实的 translateSegments ----

class FakeObserver {
  static instances: FakeObserver[] = [];
  observed = new Set<Element>();
  disconnected = false;
  constructor(public cb: (records: Array<{ target: Element; isIntersecting: boolean }>) => void, public options?: IntersectionObserverInit) {
    FakeObserver.instances.push(this);
  }
  observe(el: Element) { this.observed.add(el); }
  unobserve(el: Element) { this.observed.delete(el); }
  disconnect() { this.disconnected = true; this.observed.clear(); }
}

function Row({ itemId, idx, zh, enabled, onApply }: { itemId: string; idx: number; zh?: string; enabled: boolean; onApply: (idx: number, zh: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useRowTranslation({ itemId, idx, hasZh: Boolean(zh), enabled, rootRef: ref, apply: (value) => onApply(idx, value) });
  return <li data-testid={`row-${idx}`}><div ref={ref} /></li>;
}

function mount(routes: Record<string, Handler>, rows: Array<{ idx: number; zh?: string }>, enabled = true) {
  const mock = createFetchMock(routes);
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const onApply = vi.fn();
  const tree = (en: boolean) => (
    <TestProviders api={api}>
      <ul>{rows.map((r) => <Row key={r.idx} itemId="i1" idx={r.idx} zh={r.zh} enabled={en} onApply={onApply} />)}</ul>
    </TestProviders>
  );
  const view = render(tree(enabled));
  return { mock, onApply, view, setEnabled: (en: boolean) => view.rerender(tree(en)) };
}

const TRANSLATE = "POST /api/library/items/i1/translate";

describe("useRowTranslation", () => {
  beforeEach(() => {
    toastInfo.mockClear();
    FakeObserver.instances = [];
    // test/setup.ts 装了一个永远不触发的 IntersectionObserver 空壳:默认去掉它,让所有行都算「近处」;要测视野的用例自己换成 FakeObserver
    vi.stubGlobal("IntersectionObserver", undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks once for the rows that lack a translation and hands each result to its row", async () => {
    const { mock, onApply } = mount(
      { [TRANSLATE]: () => json([{ idx: 0, zh: "你好" }, { idx: 2, zh: "再见" }]) },
      [{ idx: 0 }, { idx: 1, zh: "有了" }, { idx: 2 }],
    );
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
    expect(onApply).toHaveBeenCalledWith(0, "你好");
    expect(onApply).toHaveBeenCalledWith(2, "再见");
    expect(mock.calls).toHaveLength(1);
    const body = JSON.parse(mock.calls[0].body as string);
    expect(body.indices).toEqual([0, 2]);
    expect(body.native_language).toMatch(/^(en-US|zh-CN|es-ES)$/);
    expect(mock.calls[0].url.search).toBe("");
  });

  it("does not request while the translation switch is off", async () => {
    const { mock, setEnabled, onApply } = mount({ [TRANSLATE]: () => json([{ idx: 0, zh: "你好" }]) }, [{ idx: 0 }], false);
    await new Promise((r) => setTimeout(r, 250));
    expect(mock.calls).toHaveLength(0);
    setEnabled(true);
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(0, "你好"));
  });

  it("tells the user once, with a fixed message, when the daily limit is used up", async () => {
    const { onApply } = mount({ [TRANSLATE]: () => json({ items: [{ idx: 0, zh: "你好" }], limited: true }) }, [{ idx: 0 }, { idx: 1 }]);
    await waitFor(() => expect(toastInfo).toHaveBeenCalledTimes(1));
    expect(toastInfo).toHaveBeenCalledWith(i18n.t("web.library.shadow.translateLimited"));
    expect(onApply).toHaveBeenCalledWith(0, "你好");
  });

  it("only asks for rows near the viewport, observing the row element with a wide margin", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { mock, onApply, view } = mount({ [TRANSLATE]: () => json([{ idx: 1, zh: "一" }]) }, [{ idx: 0 }, { idx: 1 }, { idx: 2 }]);
    const observer = FakeObserver.instances[0];
    expect(observer.options?.rootMargin).toBe(`${NEAR_MARGIN_PX}px 0px`);
    expect([...observer.observed].map((el) => el.tagName)).toEqual(["LI", "LI", "LI"]);
    await new Promise((r) => setTimeout(r, 250));
    expect(mock.calls).toHaveLength(0);
    observer.cb([{ target: view.getByTestId("row-1"), isIntersecting: true }]);
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(1, "一"));
    expect(JSON.parse(mock.calls[0].body as string).indices).toEqual([1]);
  });

  it("releases the observer when the last row unmounts", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { view } = mount({}, [{ idx: 0 }], false);
    const observer = FakeObserver.instances[0];
    view.unmount();
    expect(observer.disconnected).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/use-translations.test.tsx`(模块不存在)。

- [ ] **Step 3: 实现** — `web/src/features/library/use-translations.ts`:

```ts
import type { TFunction } from "i18next";
import { useEffect, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError, type ApiClient } from "~/api/client";
import { useAuth } from "~/auth/auth-context";
import { nativeLanguageCode, useSettings } from "~/settings/settings-context";
import { translateSegments, type TranslateResult } from "./attempts-api";
import "./locales";

/** 一次请求最多这么多句(spec §9、E12)。 */
export const TRANSLATE_BATCH = 20;
/** 行元素与视口之间这么近(px)才算「视野附近」;约等于 E12 的前后各 10 句(R-SH27)。 */
export const NEAR_MARGIN_PX = 800;
/** 滚动 / 登记的防抖。 */
export const FLUSH_DELAY_MS = 150;
/** 同一批里每句译文应用之间的间隔(宏任务),见 R-SH27「应用结果的方式」。 */
export const APPLY_GAP_MS = 0;
const MAX_CONSECUTIVE_FAILURES = 2;

export type TranslateNotice = "limited" | "failed";

export interface TranslationRow {
  near: boolean;
  hasZh: boolean;
  apply(zh: string): void;
}

export interface BatcherOptions {
  translate(indices: number[], signal: AbortSignal): Promise<TranslateResult>;
  /** 额度满 / 失败各只提示一次(每个「开 → 关」会话) */
  notify(kind: TranslateNotice): void;
  delayMs?: number;
  applyGapMs?: number;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 一个条目的译文批处理器(与 React 无关,便于测试):收集「近处、还没有译文、不在途、没失败过」的句子,
 * 每次 ≤ TRANSLATE_BATCH 句、同一时刻最多一个请求;额度满 / 404 / 连续失败后停止,关掉再打开才重新开始(R-SH27)。
 */
export class TranslationBatcher {
  private readonly rows = new Map<number, TranslationRow>();
  private readonly inflight = new Set<number>();
  private readonly failed = new Set<number>();
  private enabled = false;
  private stopped = false;
  private notified = false;
  private failures = 0;
  private running = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;

  constructor(private readonly opts: BatcherOptions) {}

  register(idx: number, row: TranslationRow): void {
    this.rows.set(idx, row);
    this.schedule();
  }

  unregister(idx: number): void {
    this.rows.delete(idx);
    this.inflight.delete(idx);
    this.failed.delete(idx);
  }

  setNear(idx: number, near: boolean): void {
    const row = this.rows.get(idx);
    if (!row || row.near === near) return;
    row.near = near;
    if (near) this.schedule();
  }

  setHasZh(idx: number, hasZh: boolean): void {
    const row = this.rows.get(idx);
    if (!row || row.hasZh === hasZh) return;
    row.hasZh = hasZh;
    if (!hasZh) {
      this.failed.delete(idx); // 文字被改、译文被清:可以重新取
      this.schedule();
    }
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled || this.disposed) return;
    this.enabled = on;
    if (on) {
      this.schedule();
      return;
    }
    // 关掉 = 这一轮结束:中止在途请求,清空状态,下次打开是新会话
    this.controller?.abort();
    this.controller = null;
    this.clearTimer();
    this.inflight.clear();
    this.failed.clear();
    this.stopped = false;
    this.notified = false;
    this.failures = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    this.controller?.abort();
    this.controller = null;
    this.clearTimer();
    this.rows.clear();
    this.inflight.clear();
    this.failed.clear();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (!this.enabled || this.stopped || this.disposed || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.opts.delayMs ?? FLUSH_DELAY_MS);
  }

  private pick(): number[] {
    const out: number[] = [];
    for (const idx of [...this.rows.keys()].sort((a, b) => a - b)) {
      const row = this.rows.get(idx);
      if (row && row.near && !row.hasZh && !this.inflight.has(idx) && !this.failed.has(idx)) out.push(idx);
      if (out.length >= TRANSLATE_BATCH) break;
    }
    return out;
  }

  private notifyOnce(kind: TranslateNotice): void {
    if (this.notified) return;
    this.notified = true;
    this.opts.notify(kind);
  }

  private async flush(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      while (this.enabled && !this.stopped && !this.disposed) {
        const batch = this.pick();
        if (!batch.length) break;
        const controller = new AbortController();
        this.controller = controller;
        for (const idx of batch) this.inflight.add(idx);
        let result: TranslateResult;
        try {
          result = await this.opts.translate(batch, controller.signal);
        } catch (err) {
          if (controller.signal.aborted || this.disposed) return;
          for (const idx of batch) {
            this.inflight.delete(idx);
            this.failed.add(idx);
          }
          const status = err instanceof ApiError ? err.status : 0;
          this.failures += 1;
          if (status === 429 || status === 404 || this.failures >= MAX_CONSECUTIVE_FAILURES) this.stopped = true;
          this.notifyOnce(status === 429 ? "limited" : "failed");
          continue;
        }
        if (controller.signal.aborted || this.disposed || !this.enabled) return;
        this.failures = 0;
        const asked = new Set(batch);
        const got = new Set<number>();
        for (const item of result.items) {
          const row = this.rows.get(item.idx);
          if (!row || !asked.has(item.idx)) continue; // 只应用我们请求过的、仍登记着的句子
          got.add(item.idx);
          this.inflight.delete(item.idx);
          row.hasZh = true;
          row.apply(item.zh);
          await pause(this.opts.applyGapMs ?? APPLY_GAP_MS);
          if (this.disposed || !this.enabled) return;
        }
        for (const idx of batch) {
          if (got.has(idx)) continue;
          this.inflight.delete(idx);
          if (!result.limited) this.failed.add(idx); // 没返回又不是额度满:当作失败,不反复请求
        }
        if (result.limited) {
          this.stopped = true;
          this.notifyOnce("limited");
        }
      }
    } finally {
      this.running = false;
    }
  }
}

// ---- 按条目共享的注册表:每行一个钩子,最后一行卸载时销毁 ----

interface Ctx {
  api: ApiClient;
  native: string;
  t: TFunction;
}

interface Entry {
  batcher: TranslationBatcher;
  observer: IntersectionObserver | null;
  byEl: Map<Element, number>;
  users: number;
  ctxRef: { current: Ctx };
}

const entries = new Map<string, Entry>();

function acquire(itemId: string, ctx: Ctx): Entry {
  let entry = entries.get(itemId);
  if (!entry) {
    const ctxRef = { current: ctx };
    const batcher = new TranslationBatcher({
      translate: (indices, signal) => translateSegments(ctxRef.current.api, itemId, indices, ctxRef.current.native, signal),
      notify: (kind) => {
        toast.info(ctxRef.current.t(kind === "limited" ? "web.library.shadow.translateLimited" : "web.library.shadow.translateFailed"));
      },
    });
    const created: Entry = { batcher, observer: null, byEl: new Map(), users: 0, ctxRef };
    if (typeof IntersectionObserver === "function") {
      created.observer = new IntersectionObserver(
        (records) => {
          for (const record of records) {
            const idx = created.byEl.get(record.target);
            if (idx !== undefined) created.batcher.setNear(idx, record.isIntersecting);
          }
        },
        { rootMargin: `${NEAR_MARGIN_PX}px 0px` },
      );
    }
    entries.set(itemId, created);
    entry = created;
  }
  entry.users += 1;
  entry.ctxRef.current = ctx;
  return entry;
}

function release(itemId: string): void {
  const entry = entries.get(itemId);
  if (!entry) return;
  entry.users -= 1;
  if (entry.users <= 0) {
    entry.batcher.dispose();
    entry.observer?.disconnect();
    entries.delete(itemId);
  }
}

export interface RowTranslationOptions {
  itemId: string;
  idx: number;
  /** 这一句已有(与当前母语一致的)译文 */
  hasZh: boolean;
  /** W1 的「译」开关 */
  enabled: boolean;
  /** 这一行的根元素(ShadowPanel 的哨兵);观察的是它的 closest("li") */
  rootRef: RefObject<HTMLElement>;
  /** 把一句译文交回 W1:onSegmentSaved({ ...segment, zh, zhLang }) */
  apply(zh: string): void;
}

/** 每个句子行调一次:把这一行登记到条目的批处理器,并让 IntersectionObserver 告诉它这一行是不是在视野附近。 */
export function useRowTranslation({ itemId, idx, hasZh, enabled, rootRef, apply }: RowTranslationOptions): void {
  const { api } = useAuth();
  const { t } = useTranslation();
  const { language } = useSettings();
  const ctx: Ctx = { api, native: nativeLanguageCode(language), t };
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const hasZhRef = useRef(hasZh);
  hasZhRef.current = hasZh;
  const entryRef = useRef<Entry | null>(null);

  useEffect(() => {
    const entry = acquire(itemId, ctxRef.current);
    entryRef.current = entry;
    const base = rootRef.current;
    const el = base ? base.closest("li") ?? base : null; // content-visibility:auto 会跳过屏幕外行的内容,所以观察行本身
    entry.batcher.register(idx, { near: entry.observer === null, hasZh: hasZhRef.current, apply: (zh) => applyRef.current(zh) });
    if (el && entry.observer) {
      entry.byEl.set(el, idx);
      entry.observer.observe(el);
    }
    return () => {
      entry.batcher.unregister(idx);
      if (el && entry.observer) {
        entry.observer.unobserve(el);
        entry.byEl.delete(el);
      }
      entryRef.current = null;
      release(itemId);
    };
  }, [itemId, idx, rootRef]);

  useEffect(() => {
    if (entryRef.current) entryRef.current.ctxRef.current = ctxRef.current; // 母语 / 语言变了,请求要用新的
  });
  useEffect(() => {
    entryRef.current?.batcher.setHasZh(idx, hasZh);
  }, [idx, hasZh]);
  useEffect(() => {
    entryRef.current?.batcher.setEnabled(enabled);
  }, [itemId, enabled]);
}
```

- [ ] **Step 4: 跑测试确认通过** — `yarn web:typecheck`;`cd web && yarn vitest run src/features/library/use-translations.test.tsx src/architecture.test.ts`。

- [ ] **Step 5: 提交** — `feat(web): batch-fetch sentence translations near the viewport`。

---

## Task 11: ⋯ 菜单 `SegmentMenu`(复制句子、AI 分析、加入练习清单、微调)

**Files:**
- Create: `web/src/features/library/segment-menu.tsx`、`web/src/features/library/segment-menu.test.tsx`

**Interfaces:**
- Produces:`SPARK_MS = 600`、`copySentence(text, idx) → Promise<"copied" | "selected" | "failed">`、`SegmentMenuProps`、`SegmentMenu(props)`(触发按钮 `data-testid="shadow-more"`;面板 `segment-menu`;条目 `menu-copy`、`menu-analysis`、`menu-save`、`menu-edit`)
- Consumes:`BottomSheet` / `BottomSheetContent` / `BottomSheetHeader`(`~/components/bottom-sheet`)、`IconButton`、`ClickSpark`(`./shadow-fx`)、`SaveSentenceState`(Task 5)、`toast`(sonner)

**R-SH26(Addendum)菜单是底部动作面板,不是浮在句子旁的弹层。** spec §11.4:「句子右侧话筒旁的 ⋯ 按钮展开:复制句子、AI 分析、加入练习清单、微调」。W1 的句子行带 `content-visibility: auto`(W1 R-L17),它隐含 `contain: paint`:行内向外溢出的绝对定位弹层会被裁掉。所以用现有的 `BottomSheet`(Radix Dialog,经 Portal 渲染到 body,手机上也是更顺手的动作面板;`lookup-layer.tsx` 与 W1 的添加素材弹层是同一做法)。触发按钮是操作行最右边的 ⋯(`IconButton`,44×44)。条目:
- **复制句子**:`navigator.clipboard.writeText`(在点按的同一个同步调用栈里发起,不丢手势);不可用或被拒时回退为选中句子文字(选区会让 `LookupLayer` 的操作条出现,提示「已选中句子,请手动复制」);都做不到提示失败。**只在网页端有**(spec §11.4)。
- **AI 分析**:只在 `config.ai` 为真时出现(spec §5.2);录音 / 评分中禁用;分析卡打开时文字变成「收起 AI 分析」,点按切换。
- **加入练习清单**:共用 `useSaveSentence` 的状态(R-SH18);点按迸出火花(`ClickSpark`),保存结束后面板再停留 `SPARK_MS`(600 ms)才收起,让火花可见;保存失败立即收起(toast 由 `savePracticeItem` 发)。
- **微调**:录音 / 评分中禁用;点按收起面板并打开句下的 `SegmentEditor`。

- [ ] **Step 1: 写失败测试** — `web/src/features/library/segment-menu.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import "./locales";
import type { SaveSentenceState } from "./save-sentence";
import { SegmentMenu, copySentence, type SegmentMenuProps } from "./segment-menu";

const toastApi = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastApi, Toaster: (): null => null }));

function Harness(over: Partial<SegmentMenuProps> & { save?: SaveSentenceState }) {
  const [open, setOpen] = useState(false);
  const props: SegmentMenuProps = {
    idx: 2, text: "Hello world.", aiEnabled: true, analysisOpen: false, busy: false,
    save: { state: "idle", save: vi.fn(async () => true) }, onAnalysis: vi.fn(), onEdit: vi.fn(),
    ...over, open, onOpenChange: setOpen,
  };
  return (
    <>
      <p data-segment-text="2">Hello world.</p>
      <SegmentMenu {...props} />
    </>
  );
}

const open = async () => {
  await userEvent.click(screen.getByTestId("shadow-more"));
  return screen.findByTestId("segment-menu");
};
const setClipboard = (value: unknown) => Object.defineProperty(navigator, "clipboard", { value, configurable: true });

describe("SegmentMenu (spec §11.4, plan W2 R-SH26)", () => {
  beforeEach(() => {
    Object.values(toastApi).forEach((fn) => fn.mockClear());
    setClipboard(undefined);
  });
  afterEach(() => {
    document.getSelection()?.removeAllRanges();
  });

  it("opens an action sheet with copy, analysis, add to practice and adjust", async () => {
    render(<Harness />);
    expect(screen.getByTestId("shadow-more")).toHaveAccessibleName(i18n.t("web.library.shadow.more"));
    await open();
    for (const id of ["menu-copy", "menu-analysis", "menu-save", "menu-edit"]) expect(screen.getByTestId(id)).toBeInTheDocument();
  });

  it("hides the analysis item when the AI features are off", async () => {
    render(<Harness aiEnabled={false} />);
    await open();
    expect(screen.queryByTestId("menu-analysis")).toBeNull();
    expect(screen.getByTestId("menu-copy")).toBeInTheDocument();
  });

  it("copies the sentence to the clipboard and closes", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<Harness />);
    await open();
    await userEvent.click(screen.getByTestId("menu-copy"));
    expect(writeText).toHaveBeenCalledWith("Hello world.");
    await waitFor(() => expect(toastApi.success).toHaveBeenCalledWith(i18n.t("web.library.shadow.menu.copied")));
    await waitFor(() => expect(screen.queryByTestId("segment-menu")).toBeNull());
  });

  it("falls back to selecting the sentence when the clipboard refuses", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    render(<Harness />);
    await open();
    await userEvent.click(screen.getByTestId("menu-copy"));
    await waitFor(() => expect(toastApi.info).toHaveBeenCalledWith(i18n.t("web.library.shadow.menu.copySelected")));
    expect(document.getSelection()!.toString()).toBe("Hello world.");
  });

  it("says so when it can neither copy nor select", async () => {
    expect(await copySentence("Nothing here.", 99)).toBe("failed");
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    expect(await copySentence("Hello world.", 99)).toBe("copied");
    setClipboard(undefined);
    expect(await copySentence("Hello world.", 2)).toBe("failed"); // 没有 data-segment-text="2" 的元素
  });

  it("toggles the analysis card and closes the sheet", async () => {
    const onAnalysis = vi.fn();
    const { rerender } = render(<Harness onAnalysis={onAnalysis} />);
    await open();
    expect(screen.getByTestId("menu-analysis")).toHaveTextContent(i18n.t("web.library.shadow.menu.analysis"));
    await userEvent.click(screen.getByTestId("menu-analysis"));
    expect(onAnalysis).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("segment-menu")).toBeNull());
    rerender(<Harness onAnalysis={onAnalysis} analysisOpen />);
    await open();
    expect(screen.getByTestId("menu-analysis")).toHaveTextContent(i18n.t("web.library.shadow.menu.analysisClose"));
  });

  it("disables analysis and adjusting while recording or scoring, but still copies and saves", async () => {
    const onEdit = vi.fn();
    render(<Harness busy onEdit={onEdit} />);
    await open();
    expect(screen.getByTestId("menu-analysis")).toBeDisabled();
    expect(screen.getByTestId("menu-edit")).toBeDisabled();
    expect(screen.getByTestId("menu-copy")).not.toBeDisabled();
    expect(screen.getByTestId("menu-save")).not.toBeDisabled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("opens the editor from the menu", async () => {
    const onEdit = vi.fn();
    render(<Harness onEdit={onEdit} />);
    await open();
    await userEvent.click(screen.getByTestId("menu-edit"));
    expect(onEdit).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("segment-menu")).toBeNull());
  });

  it("saves to the practice list, keeps the sheet for the spark, then closes it", async () => {
    const save: SaveSentenceState = { state: "idle", save: vi.fn(async () => true) };
    render(<Harness save={save} />);
    await open();
    await userEvent.click(screen.getByTestId("menu-save"));
    expect(save.save).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("segment-menu")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("segment-menu")).toBeNull(), { timeout: 3000 });
  });

  it("closes at once when saving fails, and shows the saved state afterwards", async () => {
    const failing: SaveSentenceState = { state: "idle", save: vi.fn(async () => false) };
    const { rerender } = render(<Harness save={failing} />);
    await open();
    await userEvent.click(screen.getByTestId("menu-save"));
    await waitFor(() => expect(screen.queryByTestId("segment-menu")).toBeNull(), { timeout: 400 });
    rerender(<Harness save={{ state: "saved", save: vi.fn(async () => true) }} />);
    await open();
    expect(screen.getByTestId("menu-save")).toHaveTextContent(i18n.t("web.library.shadow.saved"));
  });
});
```

(`rerender` 保留 `Harness` 的 `open` 状态:菜单已收起时,重渲后要再 `open()` 一次。)

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/segment-menu.test.tsx`(模块不存在)。

- [ ] **Step 3: 实现** — `web/src/features/library/segment-menu.tsx`:

```tsx
import { CopyIcon, EllipsisIcon, SlidersHorizontalIcon, SparklesIcon, StarIcon } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "@renderer/lib/utils";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { IconButton } from "~/components/icon-button";
import "./locales";
import type { SaveSentenceState } from "./save-sentence";
import { ClickSpark } from "./shadow-fx";

/** 加入练习清单成功后,面板再停留这么久(ms)让 ClickSpark 的火花播完。 */
export const SPARK_MS = 600;

/**
 * 复制句子(spec §11.4:只在网页端):优先 navigator.clipboard;不可用或被拒时回退为选中句子文字
 * (SegmentText 的 <p> 带 data-segment-text="<idx>");都做不到返回 "failed"。
 */
export async function copySentence(text: string, idx: number): Promise<"copied" | "selected" | "failed"> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return "copied";
    }
  } catch {
    /* 被拒(权限 / 非安全上下文):回退为选中文字 */
  }
  const el = document.querySelector<HTMLElement>(`[data-segment-text="${idx}"]`);
  const selection = document.getSelection();
  if (el && selection) {
    selection.removeAllRanges();
    selection.selectAllChildren(el);
    return "selected";
  }
  return "failed";
}

export interface SegmentMenuProps {
  idx: number;
  text: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** config.ai(spec §5.2):关闭时不显示「AI 分析」 */
  aiEnabled: boolean;
  /** 分析卡是否已打开(文字变为「收起」) */
  analysisOpen: boolean;
  /** 录音 / 评分中:分析与微调禁用 */
  busy: boolean;
  save: SaveSentenceState;
  onAnalysis(): void;
  onEdit(): void;
}

const ITEM = cn(
  "flex min-h-tap w-full items-center gap-3 rounded-button px-3 text-left text-body text-ink transition-colors duration-fast",
  "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:flex-none",
);

function Item({ icon, children, ...rest }: { icon: ReactNode; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={ITEM} {...rest}>
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

/** ⋯ 动作面板(R-SH26):复制句子 · AI 分析 · 加入练习清单 · 微调。 */
export function SegmentMenu({ idx, text, open, onOpenChange, aiEnabled, analysisOpen, busy, save, onAnalysis, onEdit }: SegmentMenuProps) {
  const { t } = useTranslation();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );

  const copy = () => {
    const pending = copySentence(text, idx); // 同步发起:仍在点按的手势里
    onOpenChange(false);
    void pending.then((how) => {
      if (how === "copied") toast.success(t("web.library.shadow.menu.copied"));
      else if (how === "selected") toast.info(t("web.library.shadow.menu.copySelected"));
      else toast.error(t("web.library.shadow.menu.copyFailed"));
    });
  };

  const saveAndClose = async () => {
    const ok = await save.save();
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => onOpenChange(false), ok ? SPARK_MS : 0);
  };

  const saved = save.state === "saved";
  return (
    <>
      <IconButton
        label={t("web.library.shadow.more")} data-testid="shadow-more" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => onOpenChange(true)}
      >
        <EllipsisIcon aria-hidden />
      </IconButton>
      <BottomSheet open={open} onOpenChange={onOpenChange}>
        <BottomSheetContent data-testid="segment-menu">
          <BottomSheetHeader title={t("web.library.shadow.menu.title")} description={t("web.library.shadow.menu.description")} srOnlyDescription />
          <div className="space-y-1">
            <Item data-testid="menu-copy" icon={<CopyIcon aria-hidden />} onClick={copy}>
              {t("web.library.shadow.menu.copy")}
            </Item>
            {aiEnabled && (
              <Item
                data-testid="menu-analysis" icon={<SparklesIcon aria-hidden />} disabled={busy}
                onClick={() => {
                  onOpenChange(false);
                  onAnalysis();
                }}
              >
                {t(analysisOpen ? "web.library.shadow.menu.analysisClose" : "web.library.shadow.menu.analysis")}
              </Item>
            )}
            <ClickSpark className="block w-full">
              <Item
                data-testid="menu-save" data-state={save.state} disabled={save.state === "saving"}
                icon={<StarIcon aria-hidden className={cn(saved && "fill-current text-amber")} />}
                onClick={() => void saveAndClose()}
              >
                {t(saved ? "web.library.shadow.saved" : "web.library.shadow.save")}
              </Item>
            </ClickSpark>
            <Item
              data-testid="menu-edit" icon={<SlidersHorizontalIcon aria-hidden />} disabled={busy}
              onClick={() => {
                onOpenChange(false);
                onEdit();
              }}
            >
              {t("web.library.shadow.menu.edit")}
            </Item>
          </div>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}
```

- [ ] **Step 4: 跑测试确认通过** — `yarn web:typecheck`;`cd web && yarn vitest run src/features/library/segment-menu.test.tsx src/architecture.test.ts`。Radix Dialog 在 jsdom 里的关闭动画若让 `queryByTestId("segment-menu")` 迟迟不为 null,`waitFor` 默认 1 s 通常够;不够就把该处 `timeout` 放宽到 2000,不改断言。

- [ ] **Step 5: 提交** — `feat(web): sentence action sheet with copy, AI analysis, add to practice and adjust`。

---

## Task 12: `ShadowPanel` 与 `SegmentText`(替换 W1 的占位)

**Files:**
- Modify(整体替换): `web/src/features/library/shadow-panel.tsx`
- Create: `web/src/features/library/shadow-panel.test.tsx`、`web/src/features/library/shadow-theme.test.ts`

**Interfaces:**
- Produces:`ShadowPanelProps`(W1 R-L16 的八个字段 + 可选 `translate?: boolean`、`starter?: RecordingStarter`)、`ShadowPanel(props)`、`SegmentTextProps { segment; active }`、`SegmentText(props)`、`mergeSaved(segment, saved)`
- Consumes:Task 2–11 的全部;`useLibraryConfig`(W1 的 `./config`,C11);`LibrarySegment`(`./library-api`,类型)与 `PlayerHandle`(`./use-media-player`,类型)(W1 R-L16)

**结构(R-SH03、R-SH23):**
- `SegmentText`(W1 渲染在每一行的句子容器里):`<p data-lookup-context data-segment-text="<idx>">`,每个词一个 `<span data-word>`;点词 = `stopPropagation()` + `selectWord`(不触发 W1 容器的「点句子 = 跳播」);刚评过的这一句按 `useScoredWords` 给词着色(R-SH09、R-SH31)。盲听时 W1 不渲染它(R-SH20)。
- `ShadowPanel`(W1 渲染在每一行句子的下面):外层 `<div ref data-shadow-row>` 在**每一行**都存在并调用 `useRowTranslation`(哨兵,R-SH27);**只有 `active` 的行**在里面渲染 `ActivePanel`:最好成绩徽标 · 操作行(听原句 · 跟读 · 听我的录音 · ⋯)· 错误行 · `ScoreCard` · `AnalysisCard` · `SegmentEditor`。当前句一变,旧句的 `ActivePanel` 整个卸载(麦克风、请求、blob URL、评分词色都在卸载时清理,R-SH17)。
- **R-SH34 改字的本地同步:** 微调保存后 `onSegmentSaved(mergeSaved(segment, saved))`:起止用服务端回的;**文字变了就把 `zh`、`zhLang`、`analysis`、`analysisLang` 置 `null`**(服务端同样清,E11),并收起分析卡 / 编辑器(文字一变,`useShadowing` 本来就复位,R-SH17);译文因 `hasZh` 变回 false 而自动重新可取。
- **R-SH23 与 W1 的接缝:** 导出名与 props 不得改;W1 没传 `translate` 时译文开关视为关(C9);`player` 为 `null` 时「听原句」禁用,暂停媒体改为暂停文档里所有 `video, audio`(R-SH02)。

- [ ] **Step 1: 写失败测试** — `web/src/features/library/shadow-panel.test.tsx`(若 Task 0 记录了不同的 prop 名,按 W1 的名字改本文件与 Step 3 的实现):

```tsx
import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import type { RecordingResult, RecordingSession } from "~/audio/recorder";
import { encodeWavPcm16 } from "~/audio/wav";
import { LookupLayer } from "~/features/lookup";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { resetAnalysisCache } from "./analysis-card";
import { resetBestCache } from "./attempts-api";
import type { LibrarySegment } from "./library-api";
import "./locales";
import { SegmentText, ShadowPanel, mergeSaved, type ShadowPanelProps } from "./shadow-panel";
import type { PlayerHandle } from "./use-media-player";

const toastApi = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastApi, Toaster: (): null => null }));

const WAV = new Blob([encodeWavPcm16(new Float32Array(1600).fill(0.1), 16000)], { type: "audio/wav" });
const ASSESS = {
  pronunciation_score: 82, accuracy_score: 80, fluency_score: 85, completeness_score: 100,
  detail_result: { display: "Hello world.", words: [
    { word: "hello", pronunciation_assessment: { accuracy_score: 95, error_type: "None" } },
    { word: "world", pronunciation_assessment: { accuracy_score: 40, error_type: "Mispronunciation" } },
  ] },
  assessment_id: "a1",
};
// spec §9 的 GET /api/library/config(ai = D8 增补,§5.2)
const CONFIG = (ai: boolean) => ({
  enabled: true, link_import: false, asr: false, ai,
  limits: { max_upload_mb: 500, max_duration_minutes: 90, quota_mb: 2000, used_bytes: 0, max_items: 100, chunk_bytes: 8_388_608, formats: ["mp4", "mp3"] },
});
const SEG = { idx: 1, startMs: 1000, endMs: 3000, text: "Hello world." } as LibrarySegment;

function starter() {
  return async (): Promise<RecordingSession> => {
    let done!: (r: RecordingResult) => void;
    const result = new Promise<RecordingResult>((resolve) => { done = resolve; });
    const stop = () => {
      done({ blob: WAV, mimeType: "audio/wav", durationMs: 1000, stoppedBy: "user" });
      return result;
    };
    return { startedAt: 0, result, stop, cancel: vi.fn() };
  };
}

const makePlayer = () => ({ pause: vi.fn(), playOnce: vi.fn(), seekTo: vi.fn(), getState: vi.fn() }) as unknown as PlayerHandle;

function setup(routes: Record<string, Handler> = {}, over: Partial<ShadowPanelProps> = {}, ai = true) {
  const mock = createFetchMock({
    "GET /api/library/config": () => json(CONFIG(ai)),
    "GET /api/library/items/i1/attempts": () => json([]),
    ...routes,
  });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const props: ShadowPanelProps = {
    itemId: "i1", segment: SEG, active: true, durationMs: 10_000, prevEndMs: 900, nextStartMs: 3300,
    player: makePlayer(), onSegmentSaved: vi.fn(), starter: starter(), ...over,
  };
  const tree = (p: ShadowPanelProps) => (
    <TestProviders api={api}>
      <SegmentText segment={p.segment} active={p.active} />
      <ShadowPanel {...p} />
    </TestProviders>
  );
  const view = render(tree(props));
  return { mock, props, view, rerender: (next: Partial<ShadowPanelProps>) => view.rerender(tree({ ...props, ...next })) };
}

describe("SegmentText (spec §11.4 点词查词, plan W2 R-SH15)", () => {
  afterEach(() => document.getSelection()?.removeAllRanges());

  it("renders one lookup context of tappable words; a word tap selects it and does not trigger the row's tap-to-play", () => {
    const rowTap = vi.fn();
    render(<div onClick={rowTap}><SegmentText segment={SEG} active /></div>);
    const sentence = document.querySelector("[data-lookup-context]") as HTMLElement;
    expect(sentence).toHaveTextContent("Hello world.");
    expect(sentence).toHaveAttribute("data-segment-text", "1");
    fireEvent.click(sentence.querySelector('[data-word="1"]') as HTMLElement);
    expect(document.getSelection()!.toString()).toBe("world");
    expect(rowTap).not.toHaveBeenCalled();
    fireEvent.click(sentence); // 点在词之外:照常冒泡给 W1 的容器(跳播)
    expect(rowTap).toHaveBeenCalledTimes(1);
  });

  it("makes the real LookupLayer show its selection action bar after a word is tapped", async () => {
    const api = new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock({}).fetch });
    render(<TestProviders api={api}><SegmentText segment={SEG} active /><LookupLayer /></TestProviders>);
    fireEvent.click(document.querySelector('[data-word="0"]') as HTMLElement);
    expect(await screen.findByTestId("lookup-bar", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByTestId("lookup-trigger")).toBeInTheDocument();
  });
});

describe("ShadowPanel (spec §11.4, D8; plan W2 R-SH03)", () => {
  beforeEach(() => {
    resetBestCache();
    resetAnalysisCache();
    toastApi.success.mockClear();
    toastApi.info.mockClear();
    toastApi.error.mockClear();
    // test/setup.ts 的 IntersectionObserver 空壳永不触发:去掉它,让所有行都算「近处」(Task 10)
    vi.stubGlobal("IntersectionObserver", undefined);
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:mine"), revokeObjectURL: vi.fn() });
    Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.getSelection()?.removeAllRanges();
  });

  it("renders controls only for the active row", () => {
    const { view } = setup({}, { active: false });
    expect(view.container.querySelector("[data-shadow-row]")).not.toBeNull();
    expect(screen.queryByTestId("shadow-panel")).toBeNull();
    expect(screen.queryByTestId("shadow-record")).toBeNull();
  });

  it("records, scores, rolls the score up and colours the words of the sentence, then shows the new best", async () => {
    const { mock, props } = setup({
      "POST /api/speech/assessments": () => json(ASSESS),
      "POST /api/library/items/i1/attempts": () => json({ seg_idx: 1, best_score: 82, count: 1 }),
    });
    await userEvent.click(screen.getByTestId("shadow-record"));
    await waitFor(() => expect(screen.getByTestId("shadow-record")).toHaveAttribute("data-state", "recording"));
    expect(props.player!.pause).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("shadow-record"));
    expect(await screen.findByTestId("assessment-scores")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("score-main")).toHaveTextContent("82"), { timeout: 3000 });
    const sentence = document.querySelector("[data-lookup-context]") as HTMLElement;
    expect((sentence.querySelector('[data-word="0"]') as HTMLElement).className).toContain("text-green");
    expect((sentence.querySelector('[data-word="1"]') as HTMLElement).className).toContain("underline");
    const form = mock.calls.find((c) => c.url.pathname === "/api/speech/assessments")!.body as FormData;
    expect(form.get("source")).toBe("library");
    expect(form.get("reference")).toBe("Hello world.");
    expect(await screen.findByTestId("shadow-best")).toHaveTextContent("Best 82");
    expect(screen.getByTestId("shadow-mine")).not.toBeDisabled();
    expect(mock.calls.every((c) => c.url.search === "")).toBe(true);
  });

  it("clears the score card and the word colours when another sentence becomes current", async () => {
    const { rerender } = setup({
      "POST /api/speech/assessments": () => json(ASSESS),
      "POST /api/library/items/i1/attempts": () => json({}),
    });
    await userEvent.click(screen.getByTestId("shadow-record"));
    await waitFor(() => expect(screen.getByTestId("shadow-record")).toHaveAttribute("data-state", "recording"));
    await userEvent.click(screen.getByTestId("shadow-record"));
    expect(await screen.findByTestId("assessment-scores")).toBeInTheDocument();
    act(() => rerender({ segment: { ...SEG, idx: 2, text: "Next one." } as LibrarySegment }));
    expect(screen.queryByTestId("assessment-scores")).toBeNull();
    expect(document.querySelector('[data-word="0"]')!.className).not.toContain("text-green");
  });

  it("plays the original sentence through the player, and disables it without a player", async () => {
    const { props } = setup();
    await userEvent.click(screen.getByTestId("shadow-listen"));
    expect(props.player!.playOnce).toHaveBeenCalledWith(1);
  });

  it("disables listening to the original while the media is not ready", () => {
    setup({}, { player: null });
    expect(screen.getByTestId("shadow-listen")).toBeDisabled();
  });

  it("shows the best score from earlier attempts", async () => {
    setup({ "GET /api/library/items/i1/attempts": () => json([{ seg_idx: 1, best_score: 91.6, count: 2, last_at: null }]) });
    expect(await screen.findByTestId("shadow-best")).toHaveTextContent("Best 92");
  });

  it("saves the sentence to the practice list from the menu", async () => {
    const { mock } = setup({ "POST /api/practice-items": () => json({ id: "p1", text: "Hello world.", source: "library", created_at: "x" }) });
    await userEvent.click(screen.getByTestId("shadow-more"));
    await userEvent.click(await screen.findByTestId("menu-save"));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/practice-items")).toBe(true));
    expect(JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/practice-items")!.body as string)).toEqual({ text: "Hello world.", source: "library" });
  });

  it("opens the AI analysis card from the menu and requests it once", async () => {
    const { mock } = setup({ "POST /api/library/items/i1/segments/1/analysis": () => json({ analysis: "### Grammar\nbe going to", cached: false }) });
    await userEvent.click(screen.getByTestId("shadow-more"));
    await userEvent.click(await screen.findByTestId("menu-analysis"));
    expect(await screen.findByTestId("analysis-card")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("analysis-card")).toHaveAttribute("data-status", "done"));
    expect(mock.calls.filter((c) => c.url.pathname.endsWith("/analysis"))).toHaveLength(1);
  });

  it("hides the AI analysis item when the server has the AI features off", async () => {
    const { mock } = setup({}, {}, false);
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/library/config")).toBe(true));
    await new Promise((r) => setTimeout(r, 50)); // 让配置的响应落到钩子里:否则「还没加载」与「关闭」分不开
    await userEvent.click(screen.getByTestId("shadow-more"));
    await screen.findByTestId("menu-copy");
    expect(screen.queryByTestId("menu-analysis")).toBeNull();
  });

  it("adjusts timing from the menu and hands the saved sentence to the player list", async () => {
    const { props } = setup({
      "PATCH /api/library/items/i1/segments/1": () => json({ idx: 1, start_ms: 1000, end_ms: 3200, text: "Hello world." }),
    }, { segment: { ...SEG, zh: "你好,世界。", zhLang: "zh-CN" } as LibrarySegment });
    await userEvent.click(screen.getByTestId("shadow-more"));
    await userEvent.click(await screen.findByTestId("menu-edit"));
    expect(await screen.findByTestId("segment-editor")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("segment-end-later"));
    await userEvent.click(screen.getByTestId("segment-save"));
    await waitFor(() => expect(props.onSegmentSaved).toHaveBeenCalledTimes(1));
    expect(props.onSegmentSaved).toHaveBeenCalledWith({ ...SEG, endMs: 3200, zh: "你好,世界。", zhLang: "zh-CN" });
    await waitFor(() => expect(screen.queryByTestId("segment-editor")).toBeNull());
  });

  it("clears the stored translation and analysis when the text is edited (E11)", () => {
    const base = { ...SEG, zh: "你好,世界。", zhLang: "zh-CN", analysis: "x", analysisLang: "zh-CN" } as LibrarySegment;
    expect(mergeSaved(base, { idx: 1, startMs: 1000, endMs: 3000, text: "Hello there." })).toEqual({
      ...SEG, text: "Hello there.", zh: null, zhLang: null, analysis: null, analysisLang: null,
    });
    expect(mergeSaved(base, { idx: 1, startMs: 1200, endMs: 3000, text: "Hello world." })).toEqual({ ...base, startMs: 1200 });
  });

  it("fetches the translation of a row when the translation switch is on, and hands it back", async () => {
    const { props, mock } = setup({ "POST /api/library/items/i1/translate": () => json([{ idx: 1, zh: "你好,世界。" }]) }, { translate: true, active: false });
    await waitFor(() => expect(props.onSegmentSaved).toHaveBeenCalledTimes(1));
    expect(props.onSegmentSaved).toHaveBeenCalledWith(expect.objectContaining({ idx: 1, text: "Hello world.", zh: "你好,世界。" }));
    expect(JSON.parse(mock.calls.find((c) => c.url.pathname.endsWith("/translate"))!.body as string).indices).toEqual([1]);
  });

  it("does not ask for translations while the switch is off", async () => {
    const { mock } = setup({}, { translate: false });
    await new Promise((r) => setTimeout(r, 300));
    expect(mock.calls.some((c) => c.url.pathname.endsWith("/translate"))).toBe(false);
  });
});
```

`web/src/features/library/shadow-theme.test.ts`(D12:深浅色切换只靠令牌,W2 的界面源码里不许写死颜色):

```ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const UI_FILES = [
  "shadow-panel.tsx", "score-card.tsx", "analysis-card.tsx", "segment-menu.tsx", "segment-editor.tsx", "save-sentence.tsx", "shadow-fx.tsx",
].filter((f) => existsSync(path.join(here, f)));

// 十六进制色、不带 var() 的 rgb()/rgba()/hsl()、tailwind 的 white / black 色类
const FORBIDDEN: Array<[string, RegExp]> = [
  ["hex colour", /#[0-9a-fA-F]{3,8}\b/],
  ["rgb()/rgba() literal", /\brgba?\((?!\s*var\()/],
  ["hsl() literal", /\bhsla?\(/],
  ["white/black colour class", /\b(?:bg|text|border|fill|stroke|ring|from|to|via)-(?:white|black)\b/],
];

describe("shadowing UI follows the theme tokens (D12, spec §11.4a)", () => {
  it("has files to scan", () => {
    expect(UI_FILES.length).toBeGreaterThan(3);
  });

  for (const [label, pattern] of FORBIDDEN) {
    it(`has no ${label} in the W2 UI sources`, () => {
      for (const file of UI_FILES) {
        const source = readFileSync(path.join(here, file), "utf8");
        expect(source.match(pattern)?.[0] ?? null, `${file}`).toBeNull();
      }
    });
  }
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/library/shadow-panel.test.tsx`(W1 的占位 `ShadowPanel` 返回 `null`、`SegmentText` 是纯文本,`mergeSaved` 不存在,用例失败)。

- [ ] **Step 3: 实现** — 用下面的内容**整体替换** `web/src/features/library/shadow-panel.tsx`(R-SH02 的缺项处理按 Task 0 的记录落实):

```tsx
import { HeadphonesIcon, LoaderIcon, MicIcon, SquareIcon, Volume2Icon } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import type { RecordingStarter } from "~/audio/use-recorder";
import { IconButton } from "~/components/icon-button";
import { scoreBadgeTone, type ScoreTone } from "~/components/score-tone";
import { ToneBadge } from "~/components/tone-badge";
import { formatClock } from "~/lib/format-clock";
import { nativeLanguageCode, useSettings } from "~/settings/settings-context";
import { AnalysisCard } from "./analysis-card";
import type { SavedSegment, SegmentWithAi } from "./attempts-api";
import { useLibraryConfig } from "./config";
import type { LibrarySegment } from "./library-api";
import "./locales";
import { useSaveSentence } from "./save-sentence";
import { ScoreCard } from "./score-card";
import { SegmentEditor } from "./segment-editor";
import { SegmentMenu } from "./segment-menu";
import type { PlayerHandle } from "./use-media-player";
import { useShadowing } from "./use-shadowing";
import { useRowTranslation } from "./use-translations";
import { clearWordScores, publishWordScores, selectWord, tokenizeSentence, useScoredWords, wordTones } from "./word-tap";

/** 逐词着色(R-SH09):低分另加点状下划线,不只靠颜色。 */
const WORD_TONE: Record<ScoreTone, string> = {
  good: "text-green",
  fair: "text-amber",
  low: "text-ink-2 underline decoration-dotted decoration-2 underline-offset-4",
};

export interface SegmentTextProps {
  segment: LibrarySegment;
  active: boolean;
}

/**
 * 句子文字(W1 的 segment-list 把它渲染在每一行的点击 = 跳播容器里,W1 计划 R-L16):一个 data-lookup-context 容器,
 * 每个词一个 span。点词 = 程序化选中该词(selectWord),稳定 300 ms 后全局 LookupLayer 出现选中操作条(R-SH15);
 * 词的点击 stopPropagation,不触发 W1 容器的跳播。刚评过的这一句按逐词结果着色(R-SH09、R-SH31)。
 * data-segment-text 给「复制句子」的选中文字回退用(segment-menu.tsx)。
 */
export function SegmentText({ segment }: SegmentTextProps): ReactElement {
  const tokens = useMemo(() => tokenizeSentence(segment.text), [segment.text]);
  const scored = useScoredWords(segment.idx, segment.text);
  const tones = useMemo(() => wordTones(tokens, scored ?? undefined), [tokens, scored]);
  return (
    <p data-lookup-context data-segment-text={segment.idx} className="select-text break-words">
      {tokens.map((tok, i) => {
        if (tok.word < 0) return <Fragment key={i}>{tok.text}</Fragment>;
        const tone = tones[tok.word];
        return (
          <span
            key={i} data-word={tok.word}
            className={cn("cursor-pointer rounded-inline active:bg-blue-tint", tone && WORD_TONE[tone])}
            onClick={(e) => {
              e.stopPropagation();
              selectWord(e.currentTarget);
            }}
          >
            {tok.text}
          </span>
        );
      })}
    </p>
  );
}

/** W1 的 segment-list.tsx 传入(R-SH02);translate、starter 是 W2 追加的可选 props。 */
export interface ShadowPanelProps {
  itemId: string;
  segment: LibrarySegment;
  /** 当前句:只有它渲染操作行与卡片 */
  active: boolean;
  durationMs: number;
  prevEndMs: number | null;
  nextStartMs: number | null;
  player: PlayerHandle | null;
  onSegmentSaved(next: LibrarySegment): void;
  /** W1 控制条的「译」开关(C9②);关 = 不取译文 */
  translate?: boolean;
  /** 测试注入的录音启动器 */
  starter?: RecordingStarter;
}

/** 微调保存后的新句子:起止与文字取服务端回的;文字变了就清掉译文与分析(E11,R-SH34)。 */
export function mergeSaved(segment: LibrarySegment, saved: SavedSegment): LibrarySegment {
  const next = { ...segment, startMs: saved.startMs, endMs: saved.endMs, text: saved.text };
  const textChanged = saved.text !== segment.text;
  return (textChanged ? { ...next, zh: null, zhLang: null, analysis: null, analysisLang: null } : next) as LibrarySegment;
}

const RECORD_BUTTON = cn(
  "inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-button bg-blue px-4 text-body font-semibold text-on-blue",
  "transition-colors duration-fast active:bg-blue/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:flex-none",
);

/**
 * 句子行下面的跟读区(spec §11.4、D8;R-SH03):每一行都挂一个哨兵给译文的视野检测(R-SH27),只有当前句渲染操作行与卡片。
 */
export function ShadowPanel(props: ShadowPanelProps): ReactElement | null {
  const { itemId, segment, active, translate = false, onSegmentSaved } = props;
  const { language } = useSettings();
  const native = nativeLanguageCode(language);
  const rootRef = useRef<HTMLDivElement>(null);
  const ai = segment as SegmentWithAi;
  const hasZh = Boolean(ai.zh) && (!ai.zhLang || ai.zhLang === native);
  useRowTranslation({
    itemId, idx: segment.idx, hasZh, enabled: translate, rootRef,
    apply: (zh) => onSegmentSaved({ ...segment, zh, zhLang: native } as LibrarySegment),
  });
  return (
    <div ref={rootRef} data-shadow-row={segment.idx} data-testid={active ? "shadow-panel" : undefined}>
      {active && <ActivePanel {...props} />}
    </div>
  );
}

function ActivePanel({ itemId, segment, durationMs, prevEndMs, nextStartMs, player, onSegmentSaved, starter }: ShadowPanelProps) {
  const { t } = useTranslation();
  const config = useLibraryConfig();
  const aiEnabled = (config as { ai?: boolean } | null)?.ai === true; // C11:W1 的类型可能还没有 ai
  const { idx, text } = segment;
  const pauseMedia = useCallback(() => {
    if (player) player.pause();
    else document.querySelectorAll<HTMLMediaElement>("video, audio").forEach((m) => m.pause());
  }, [player]);
  const shadow = useShadowing({ itemId, segment: { idx, text }, pauseMedia, starter });
  const save = useSaveSentence(text);
  const [menuOpen, setMenuOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    // 文字变了(微调改字):分析是旧文字的,收起;编辑器随保存关闭(R-SH34)
    setAnalysisOpen(false);
    setEditing(false);
  }, [text]);

  const result = shadow.result;
  useEffect(() => {
    if (!result) return undefined;
    publishWordScores(idx, text, result.words); // SegmentText 按它给词着色(R-SH31)
    return () => clearWordScores(idx, text);
  }, [result, idx, text]);

  const { phase, best } = shadow;
  const recording = phase === "recording";
  const busy = phase === "assessing" || phase === "starting";

  return (
    <div className="space-y-2 px-1.5 pb-2 pt-1">
      {best && typeof best.bestScore === "number" && (
        <div data-testid="shadow-best" className="flex justify-end">
          <ToneBadge tone={scoreBadgeTone(best.bestScore)}>{t("web.library.shadow.best", { score: Math.round(best.bestScore) })}</ToneBadge>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <IconButton
          label={t("web.library.shadow.listenOriginal")} data-testid="shadow-listen" disabled={!player || recording || busy}
          onClick={() => {
            shadow.stopMine();
            player?.playOnce(idx);
          }}
        >
          <Volume2Icon aria-hidden />
        </IconButton>
        <button
          type="button" data-testid="shadow-record" data-state={phase} className={RECORD_BUTTON} disabled={busy}
          aria-label={recording ? t("web.library.shadow.stop") : t("web.library.shadow.record")}
          onClick={() => void shadow.toggle()}
        >
          {busy ? <LoaderIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
            : recording ? <SquareIcon aria-hidden className="fill-current" /> : <MicIcon aria-hidden />}
          <span aria-hidden className="num">
            {phase === "assessing" ? t("web.library.shadow.assessing") : recording ? formatClock(shadow.elapsedMs) : t("web.library.shadow.record")}
          </span>
        </button>
        <IconButton
          label={shadow.playingMine ? t("web.library.shadow.stopMine") : t("web.library.shadow.listenMine")}
          data-testid="shadow-mine" data-state={shadow.playingMine ? "playing" : "idle"}
          disabled={!shadow.canPlayMine || recording || phase === "starting"} onClick={shadow.playMine}
        >
          {shadow.playingMine ? <SquareIcon aria-hidden /> : <HeadphonesIcon aria-hidden />}
        </IconButton>
        <SegmentMenu
          idx={idx} text={text} open={menuOpen} onOpenChange={setMenuOpen} aiEnabled={aiEnabled} analysisOpen={analysisOpen}
          busy={recording || busy} save={save} onAnalysis={() => setAnalysisOpen((v) => !v)} onEdit={() => setEditing(true)}
        />
      </div>
      {shadow.error && <p role="alert" data-testid="shadow-error" className="text-sub text-destructive">{shadow.error}</p>}
      {result && <ScoreCard key={result.assessmentId} scores={result.scores} attemptSaved={result.attemptSaved} save={save} />}
      {analysisOpen && <AnalysisCard itemId={itemId} segment={segment} />}
      {editing && (
        <SegmentEditor
          key={idx} itemId={itemId} segment={segment} prevEndMs={prevEndMs} nextStartMs={nextStartMs} durationMs={durationMs}
          onSaved={(saved) => onSegmentSaved(mergeSaved(segment, saved))} onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过** — `yarn web:typecheck`;`cd web && yarn vitest run src/features/library src/architecture.test.ts`(整个 `src/features/library` 目录:同时证明 W1 的句子列表与播放器测试在占位被替换后仍然通过;若 W1 的某个用例断言了「占位渲染为空 / 纯文本」(例如 `segment-list.test.tsx` 里「renders the W2 placeholder panel as nothing」那一条),那是对占位的断言 —— **不改 W1 的测试文件**,在结果文档记为 W2 缺口并交 Z,本步骤记为未全绿,**不提交**,先回报)。`ToneBadge`、`IconButton` 的 props 与 `rounded-inline` 等令牌以真实代码为准(`components/tone-badge.tsx`、`tailwind.config.js`)。

- [ ] **Step 5: 视觉检查(不在 CI 里)** — 若本机有 `yarn web:dev` 与一个 `ready` 的库条目(需要服务端开 `LIBRARY_ENABLED` 与 `LIBRARY_AI_ENABLED`,只在用户同意时操作),在浏览器窗格 375×812 与 360×740、**浅色 / 深色各看一次**(用 D12 的「外观」设置或系统偏好切换):操作行四个按钮一行不溢出、录音按钮文字不换行;评分卡的评分环、数字滚动、渐变评语在两种外观下都可读;分析卡逐字浮现;逐词着色可读(低分的点状下划线可见);⋯ 面板的条目触控 ≥ 44 px;`prefers-reduced-motion` 时全部静止。结论写「桌面浏览器模拟,非真机」。环境不具备就写「未做」。

- [ ] **Step 6: 提交** — `feat(web): library shadow panel and tappable sentence text replace the W1 placeholder`。

---

## Task 13: 结果文档(W2 一节补全)

**Files:**
- Modify(追加): `docs/superpowers/plans/2026-10-13-video-import-results.md`(只改 Task 0 写的 W2 一节)

- [ ] **Step 1: 补全「已验证 / 未验证」** — 在 W2 一节末尾追加(把括号换成实际内容;没跑过的一律「未验证」):

```markdown
### 自动化测试(Task 1–12,YYYY-MM-DD)
- 每个任务的目标测试与 `yarn web:typecheck` 全绿(列出最后一次运行的文件与用例数)。
- 跨 feature 基线 N → N+1(`library->practice`)。
- 效果组件:转出 W1 的 / 用本地后备的(逐个列出,Task 0 Step 3 的结论)。
- 全量 `yarn web:test`、`yarn web:build` 与主包体积:**未跑**(按计划只在用户要求时跑;体积归 Z)。W2 文案在 W1 的懒加载 `locales/` 里、W2 代码都在 W1 的懒块里,主包预期零增量(推断,未实测)。

### 与 spec 的偏离(设计如此,待用户复核)
| 项 | 偏离与理由 |
|---|---|
| 操作行在句子下面、只有当前句有(R-SH03) | spec §11.4「句子右侧的麦克风」;W1 的行布局把 `ShadowPanel` 放在句子下方,且为不给几百行各挂一个录音机 |
| 点词后出现的是选中操作条而不是直接开抽屉(R-SH15) | 按真实 `lookup-layer.tsx`;spec §11.4 的「LookupLayer 打开」应读作「操作条出现」 |
| 评分卡自己画,不用 `MobileScoreResult`(R-SH24) | spec §11.4a 要 CountUp / GradientText,practice 的静态圆环无法加 |
| ⋯ 菜单是底部动作面板(R-SH26) | W1 行的 `content-visibility: auto` 会裁掉溢出的弹层 |
| 译文「视野附近」按 800 px 近似 ±10 句(R-SH27) | 行高不一;`IntersectionObserver` 更便宜 |
| 译文 / 分析的 HTTP 调用在 `attempts-api.ts`(R-SH29) | spec §15 归 W1 的 `library-api.ts`,但 W2 不能依赖 W1 未承诺的导出名 |

### 未验证(需要真机 / 真上游)
| 项 | 状态 |
|---|---|
| iOS Safari:点词后程序化选区是否保持、`LookupLayer` 的操作条是否出现(R-SH15) | 未验证 |
| iOS Safari:先暂停 `<video>` 再开麦,录音后媒体恢复播放的音量与音频路由(听筒 / 扬声器)切换(R-SH12) | 未验证 |
| iOS Safari:`getUserMedia` 在 `pauseMedia()` 之后仍算同一手势 | 未验证 |
| iOS / Android:「听我的录音」(WAV blob URL)可播放 | 未验证 |
| iOS Safari:`navigator.clipboard.writeText` 在底部面板的点按里可用;回退选中文字的表现 | 未验证 |
| 真机:ClickSpark / CountUp / BlurText 的流畅度与耗电;低端机 `.lite` 降级 | 未验证 |
| 浏览器:`IntersectionObserver` 观察带 `content-visibility: auto` 的行(R-SH27) | 未验证 |
| 真实大模型:译文批量(≤ 20 句)与句子分析的质量、耗时、额度计数 | 未验证 |
| 真实评测上游:`source=library` 的评分、额度与 `recording_quota_mb` 计入 | 未验证 |
| 真实服务端:`POST attempts` 的「参考文本与该句一致」核对与 `best_score` 取整 | 未验证(只有契约夹具) |
| W1 的 `onSegmentSaved` 在连续多条译文到达时不丢更新 | (Task 0 Step 2 的结论;不是函数式更新则标「风险」) |
| 用户在控制条上直接播放时「我的录音」不会自动停(已知限制,R-SH12) | 设计如此 |
```

- [ ] **Step 2: 提交** — `git add docs/superpowers/plans/2026-10-13-video-import-results.md`,信息 `docs: video import W2 verification notes`。

---

## 验证矩阵

| spec 要求 | 证明 |
|---|---|
| §11.4 跟读:先暂停媒体、手势内开麦、`source=library`、`save=true`、参考文本 = 句子 | `use-shadowing.test.tsx` 第 1 例(`["pause","mic"]`、FormData 四个字段);`shadow-panel.test.tsx`「records, scores…」 |
| §11.4 / §11.4a 评分卡:环 + 数字滚动(`CountUp`)+ 渐变评语(`GradientText`)+ 逐词着色 | `score-card.test.tsx`;`shadow-fx.test.tsx`;`shadow-panel.test.tsx`(`score-main`、`text-green` / `underline`);`word-tap.test.ts` 的 `wordTones`;`word-scores.test.ts` |
| §11.4 `POST attempts` 与「每句最好成绩」 | `use-shadowing.test.tsx` 第 1、4、6、7 例;`attempts-api.test.ts`(含缓存);`attempts-contract.test.ts` |
| §11.4 听原句 ↔ 听我的录音 | `shadow-panel.test.tsx`「plays the original…」;`use-shadowing.test.tsx`「plays my recording…」 |
| §11.4 评测不可用 / 额度满用 `PRACTICE_SERVER_ERRORS` | `use-shadowing.test.tsx`「quota」 |
| §11.4 点词查词(程序化选区 → 现有选中操作条,无新跨 feature 边) | `word-tap.test.ts` 的 `selectWord` 三例;`shadow-panel.test.tsx` 的 `SegmentText` 两例(含真实 `LookupLayer` 的 `lookup-bar`);`architecture.test.ts` |
| §11.4 / D8 ⋯ 菜单:复制句子、AI 分析、加入练习清单、微调 | `segment-menu.test.tsx`;`shadow-panel.test.tsx`「saves… / opens the AI analysis… / adjusts timing… / hides…」 |
| §11.4 / D8 AI 分析卡:骨架、BlurText、缓存、重试、收起;分析不自动触发 | `analysis-card.test.tsx`;`shadow-panel.test.tsx`(只有点菜单才请求) |
| §11.4 / D8 / E12 译文:视野附近批量、≤ 20 句、去重、额度满 / 失败只提示一次 | `use-translations.test.tsx`;`shadow-panel.test.tsx`「fetches the translation…」 |
| §11.4a ClickSpark 在加入练习上 | `save-sentence.test.tsx`;`segment-menu.test.tsx`「saves… keeps the sheet…」;`shadow-fx.test.tsx` 的清理用例 |
| §11.4 加入练习清单(`source="library"`,不去重) | `save-sentence.test.tsx` |
| §11.4 微调 ±0.2 s、改文字、`PATCH segments`;E11 改字清译文 / 分析 | `segment-editor.test.tsx`;`shadow-panel.test.tsx`「adjusts timing… / clears the stored…」 |
| D12 深色 / 浅色:不写死颜色 | `shadow-theme.test.ts`;视觉检查(Task 12 Step 5,浅色 + 深色各一次) |
| §2.2 `PracticeItemSource` / 评测 `source` 加 `library` | Task 1 三个用例 + `yarn web:typecheck` |
| §2.2 / §11.5 架构:只多 `library->practice` | `architecture.test.ts`(基线 19、三条扫描用例) |
| §11.5 中英文键一致、用到的键都存在 | `shadow-locales.test.ts`、W1 的 `locales.test.ts`、`i18n/i18n.test.ts` |
| §13 URL 里没有文字 | 各 API / 钩子测试断言 `url.search === ""`;路径只含 uuid 与序号;译文请求只发 `indices` |

## 不做

- 每一行句子上都有话筒 / ⋯(R-SH03;需要改 W1 的 `segment-list.tsx`)。
- 自动跟读模式(D9:点话筒才录)、横屏全屏(D9)。
- 「我的录音」与原句的波形对比、逐音素展示。
- 在库里浏览或删除历史评测(用户在练习的历史页自己删,spec §4)。
- 让 W1 的媒体元素加入 `claimAudio` 体系(W1 的文件)。
- 改段位、今日任务、学习联动(R-SH21)。
- 网页端去重练习清单(spec §11.4)。
- D10 第二期清单:录音管理页、转写稿下载与打印、每句笔记、重新识别、单句音频下载、素材 AI 摘要、音标显示;**字幕译文的并排双栏视图**(spec §14,D8 只做「句下一行」,且那一行归 W1)。
- 12 个效果里不属于跟读卡的 8 个(SoftAurora、SpotlightCard、SpecularButton、ShinyText、Stepper、BorderGlow、GradualBlur、ElasticSlider 归 W1;W2 只用 GlassSurface、CountUp + GradientText、ClickSpark、BlurText 这 4 个)。
- 译文 / 分析写进任何本机存储(只在内存)。

## 风险

- **W1 接缝与本计划假设不一致(最大风险)。** R-SH02 取自 W1 计划 R-L16(已核对其文字),但 W1 计划此后还要按 D8 / D11 / D12 / E9 增补;C9(`translate` prop、`onSegmentSaved` 函数式更新)、C10(效果组件)、C11(`config.ai`)是对 W1 增补的假设。缓解:Task 0 逐项读真实代码,映射写进结果文档,缺项按 R-SH02 / Task 4 Step 3b / Task 10 的降级处理。
- **「译」开关没有传给 `ShadowPanel`。** 则译文不会被取(菜单、分析、跟读不受影响);记 W2 缺口交 Z。
- **`onSegmentSaved` 不是函数式更新。** 一批 20 句译文即使各自在宏任务里应用,W1 若用闭包里的旧列表仍可能丢更新;缓解见 Task 10 R-SH27 与 Task 0 Step 2。
- **S1 的错误文本、契约夹具键名、译文 / 分析的响应形状与状态码未知(R-SH11、R-SH19、C8)。** 缓解:Task 0 Step 6–7 读真实代码后改键;解析宽容;分析 / 译文按状态码(429 / 404)处理;夹具缺项写入「W2 缺口」。
- **iOS 行为全部未验证**(选区与操作条、音频路由、手势、WAV 回放、剪贴板、效果的流畅度)。
- **跨 feature 基线数字漂移**(其他计划在此期间增删边)。缓解:Task 0 Step 9 读实际数字,用「+1」。
- **W1 的测试若断言「占位为空 / 纯文本」**,Task 12 替换后会失败,而 W2 不能改 W1 的测试文件;缓解:Task 12 Step 4 停下回报。
- **句子行里的 Radix Dialog(⋯ 面板)与 `LookupLayer` 的抽屉同时存在**:同一时刻只会有一个打开(都是模态),但两者对选区的清理不同(`LookupLayer` 关闭时清选区);复制回退为「选中句子」时选区会让操作条出现,属预期。

---

## Addendum (2026-10-13)

> 约定(`docs/CLAUDE.md`):Addendum 里的裁定覆盖正文里更早的文字。本节在正文已按新设计**原地改写**之后追加,列出变了什么、为什么,以及本计划对 W1 / S1 的确切接口假设。

### 触发

用户要求:「按新设计更新全部计划,可以切换深色和浅色」。依据修订后的 spec(2026-10-13):

- **D8 / E11 / E12 / §9 / §5.2**:每句翻译(双语)、AI 分析、复制句子;译文与分析由服务端调大模型后存进句子行(`zh` / `zh_lang` / `analysis` / `analysis_lang`);批量取译文、分析只在点「分析」时生成;`config.ai`。
- **§15「D8 增补的归属」W2 行**:新增 `segment-menu.tsx`、`analysis-card.tsx`、`use-translations.ts`,「`shadow-panel` 不变」(= 导出名与 W1 约定的 props 不变)。
- **D9**:盲听 = 整页句子文字遮住(W1 处理);点话筒才录。
- **D11 / §11.4a**:深色优先、加强玻璃、12 个自写效果、只用在跟读库;W2 用其中 ClickSpark(加入练习)、CountUp / GradientText(评分卡)、BlurText(分析卡)、GlassSurface(两张卡)。
- **D12**:全站「外观:跟随系统 / 浅色 / 深色」开关(W1 车道实现);W2 只需不写死颜色,`shadow-theme.test.ts` 守住。
- **E9**:入口是独立底部标签(W1 的事,与 W2 无关)。
- **W1 计划 R-L16 / R-L4 已写成**:W2 的接缝不再是原稿假设的「面板级」`ShadowPanel`,而是每行一个的 `ShadowPanel` + `SegmentText`;W2 的文案子树放在 W1 的 `locales/`。
- 还核对了真实 `lookup-layer.tsx`:点词后出现的是**选中操作条**,用户点「查词」才开抽屉。

### 逐任务的变化

| 任务 | 变化 |
|---|---|
| 头部 / Global Constraints / 文件结构 / 任务顺序 | 目标、架构、文件归属(新增 3 个 D8 文件 + `score-card.tsx`、`shadow-fx.tsx`)、视觉规则(D11、D12)、任务顺序(T0–T13)按新设计重写 |
| R-SH02、R-SH03、R-SH04、R-SH15、R-SH17、R-SH18、R-SH20 | 原地改写:接缝取 W1 R-L16;控制在句子行里、只有当前句;文案进 W1 `locales/`;点词 → 选中操作条;换句 / 卸载同一套清理;存句子两处入口共用一个 hook;盲听归 W1 |
| T0 预检 | 核对对象改为 W1 的 R-L16 接缝、效果组件、`locales`、`useLibraryConfig.ai`、`onSegmentSaved` 实现与译文开关 |
| T1 练习来源 | 不变(随任务号顺序保留) |
| T2 API | 新增 `translateSegments`、`analyzeSegment`、最好成绩缓存(`loadBest` / `noteAttempt`)、`SegmentWithAi`;文案改为整棵替换 W1 `locales/` 里的 `web.library.shadow` 子树;`shadow-locales.ts` 与 `shadow-locales/` 取消,`shadow-locales.test.ts` 改为检查该子树 |
| T3 点词 | 新增评分词色 store(`publishWordScores` / `useScoredWords`) |
| T4(新)| `shadow-fx.tsx`:效果组件接缝(默认转出 W1 的 `./fx`,附本地后备) |
| T5 加入练习清单 | 星标 IconButton 改为 `useSaveSentence` + `SaveSentenceChip`(包 `ClickSpark`);基线任务号 4 → 5 |
| T6 `useShadowing` | 最好成绩改走缓存,不再每次挂载 `GET`;其余不变 |
| T7(新)| `ScoreCard`(`CountUp` + `GradientText` + `GlassSurface`),取代 `MobileScoreResult` |
| T8 微调 | 边界参数改为 W1 的 `prevEndMs` / `nextStartMs`;文案 import 改为 `./locales` |
| T9(新)| `AnalysisCard`(BlurText、缓存、重试、收起) |
| T10(新)| `use-translations.ts`(批处理器 + 每行钩子) |
| T11(新)| `SegmentMenu`(⋯ 底部动作面板) |
| T12 `ShadowPanel` | 整体重写:导出 `ShadowPanel` + `SegmentText`(W1 R-L16 的签名),每行哨兵 + 当前句 `ActivePanel`;`hideText` 删除 |
| T13 结果文档 | 增补新的偏离与未验证项 |

### 新增 / 覆盖的裁定

- **R-SH23 采用 W1 的逐行接缝(覆盖原 R-SH02 / R-SH03 的「面板级 ShadowPanel」)。** 原稿在 W1 计划尚不存在时假设了面板级的 `ShadowPanel`(`segments` + `activeIdx`)并写了 R-SH03 偏离(跟读控件在「当前句卡」)。W1 计划 R-L16 写定了逐行接缝后,W2 照它实现:`ShadowPanel` 每行一个、`SegmentText` 渲染句子。操作行放在句子下面(W1 把 `ShadowPanel` 放在句子下方),且为避免每行一个录音机,只有 `active` 行渲染操作行(R-SH03 已改写)。
- **R-SH24 评分卡自己画(见 Task 7)。**
- **R-SH25 效果组件只经 `shadow-fx.tsx` 取。** spec §11.4a 要求自写、不引入依赖、只放在 `features/library/`;§15 把该目录除 W2 文件外的全部归 W1,所以组件由 W1 提供(C10)。W2 的 5 个用到的组件(`ClickSpark`、`CountUp`、`GradientText`、`BlurText`、`GlassSurface`)统一从 `shadow-fx.tsx` 取:默认转出 W1 的 `./fx`,Task 0 发现缺失或不兼容时换成本文件里的本地后备(Task 4 Step 3b,约 100 行)。*若错*:两份实现并存,Z 车道合并。
- **R-SH26 ⋯ 菜单是底部动作面板(见 Task 11)。**
- **R-SH27 译文的取法(见 Task 10)。**
- **R-SH28 分析卡的行为(见 Task 9)。**
- **R-SH29 译文 / 分析的 HTTP 调用放在 W2 的 `attempts-api.ts`。** spec §15 把它们给 W1 的 `library-api.ts`;W2 的钩子与卡片需要它们,而 W1 计划只承诺了 `LibrarySegment`、`PlayerHandle`、`useLibraryConfig`、`locales` 这几个接口(R-L4、R-L16、L1),没有承诺 `translate` / `analysis` 的导出名。沿用 R-SH05 的先例,W2 在自己的文件里实现这两个调用(测试在 HTTP 层,所以与 W1 的函数名无关)。Task 0 若发现 W1 已有同行为的函数,记「重复,Z 去重」,不改。
- **R-SH30 最好成绩是模块级缓存。** `ActivePanel` 随当前句反复挂载 / 卸载(自动播放时每句一换),每次挂载都 `GET attempts` 会造成连续请求。`attempts-api.ts` 的 `loadBest` 按条目缓存 5 分钟、并发请求合并、失败不缓存;`noteAttempt` 把本页刚记下的成绩并入缓存;服务端快照晚于本页记录到达时 `mergeServerBest` 保留本页更多的计数。
- **R-SH31 评分词色经一个小 store 共享。** 着色发生在 `SegmentText`(W1 在行内渲染的句子),评分发生在 `ShadowPanel`(同一行的另一个组件),二者不嵌套、互不知道对方。`word-tap.ts` 里的 `publishWordScores` / `clearWordScores` / `useScoredWords` 是一个只保留一条记录的模块级 store(以 `idx` + 句子原文为键,改字即不匹配);`ActivePanel` 在评分后发布、卸载 / 换句时清除。
- **R-SH32 深色 / 浅色(D12)= 只用令牌。** W2 的界面源码里不写十六进制 / `rgb()` 字面量 / `bg-white` 一类;火花等需要颜色的地方用 `rgb(var(--amber))` 这类令牌变量;`html.dark` 由 W1 车道的外观设置切换,W2 无需任何额外代码。`shadow-theme.test.ts` 守住这条规则;视觉对照在浅色 + 深色各看一次(Task 12 Step 5)。
- **R-SH33 文案放 W1 的 `locales/` 的 `web.library.shadow` 子树(覆盖原 R-SH04 的 `shadow-locales/`)。** 理由与先例见 R-SH04 的改写;子树之外一字不动。
- **R-SH34 改字的本地同步。** 见 Task 12「结构」:`mergeSaved` 在文字变化时把 `zh` / `zhLang` / `analysis` / `analysisLang` 置 `null`,与服务端 E11 一致;`ActivePanel` 收起分析卡与编辑器。

### 对 W1 / S1 的确切接口假设(spec 依据;Task 0 逐项核对)

| 来自 | spec 依据 | 假设 |
|---|---|---|
| W1 | §15 W1 行 + W1 计划 R-L16 | `ShadowPanelProps { itemId; segment: LibrarySegment; active; durationMs: number; prevEndMs: number \| null; nextStartMs: number \| null; player: PlayerHandle \| null; onSegmentSaved(next: LibrarySegment): void }`;`SegmentTextProps { segment; active }`;`PlayerHandle` 有 `pause()`、`playOnce(idx)` |
| W1 | §15「D8 增补的归属」W1 | 可选 prop `translate?: boolean`(「译」开关);`LibrarySegment` 的可选 `zh` / `zhLang` / `analysis` / `analysisLang`;`onSegmentSaved` 按 `idx` 函数式替换;译文行与骨架行由 W1 渲染 |
| W1 | §11.4a、§15 W1 行 | `./fx` 导出 `ClickSpark`、`CountUp`、`GradientText`、`BlurText`、`GlassSurface`(签名见 Task 4) |
| W1 | §5.2、W1 计划 L1 | `useLibraryConfig(): LibraryConfig \| null`,D8 增补后含 `ai: boolean` |
| W1 | W1 计划 R-L3、R-L4 | `locales.ts` 在模块求值时合并 `locales/{en,zh-CN}.json`;`web.library.shadow` 子树归 W2 |
| S1 | §9「`POST …/translate`」 | `{indices: [int, ≤ 20], native_language}` → 裸数组 `[{idx, zh}]` 或带 `limited` 的对象;AI 关 404;额度满时已有的照常返回并带 `limited: true` |
| S1 | §9「`POST …/segments/{idx}/analysis`」 | `{native_language}` → `{analysis, cached}`;额度满 429;AI 关 404 |
| S1 | §9「`PATCH …/segments/{idx}`」、E11 | 改 `text` 时服务端清 `zh` / `analysis` |
| S1 | §9 `attempts` 两个端点 | 见 C2、C3 |

### 与 spec 的偏离(汇总)

1. 操作行在句子**下面**、只有**当前句**有(R-SH03):W1 的行布局与「不给几百行各挂一个录音机」。
2. 点词后出现的是**选中操作条**,不是直接开抽屉(R-SH15):按真实 `lookup-layer.tsx`,spec §11.4 的措辞按此读。
3. 评分卡自己画,不用 `MobileScoreResult`(R-SH24):§11.4a 的 CountUp / GradientText。
4. ⋯ 菜单是底部动作面板(R-SH26):`content-visibility: auto` 裁剪。
5. 译文「视野附近」= 行元素与视口 800 px 以内(R-SH27),近似 E12 的「前后各 10 句」。
6. 译文 / 分析的 HTTP 调用在 W2 的 `attempts-api.ts`(R-SH29),spec §15 归 W1 的 `library-api.ts`。
7. 新增两个 spec 未列名的文件:`score-card.tsx`、`shadow-fx.tsx`(R-SH24、R-SH25);修改三份未分配的 practice 文件(R-SH07);修改 W1 `locales/*.json` 的 `web.library.shadow` 子树(W1 R-L4 的授权)。

### 未验证(新增,全部并入 Task 13 的表)

iOS 上点词后选区与操作条;iOS 剪贴板与回退选中;ClickSpark / CountUp / BlurText 在真机的流畅度与耗电、`.lite` 降级;`IntersectionObserver` 对带 `content-visibility: auto` 的行的表现;真实大模型的译文 / 分析质量、耗时与额度计数;W1 的 `onSegmentSaved` 在连续多条译文到达时是否丢更新。
