# 对话里的跟读弹窗(Shadow Sheet)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对话模块里点「跟读」不再跳到练习页,而是在原地打开一块**悬浮的玻璃底部弹窗**:先听范读、录音、评测,成绩(评分环、三项分数条、行内逐词着色、点词查词、我的录音 / 标准发音、收藏、再练一次 / 下一句 / 完成、「查看完整详情」)就在弹窗里。七个入口(对话「不会说?」提示、语法纠正、复盘、转写详情、句子列表面板、选词查词里的「跟读这段」、「单词操作」面板里的「跟读这个词」)行为一致;另外三处从别的页面发起的「快速跟读一句 / 一个词」(发音弱词页、进度页弱词、段位赛结果页的练习建议)按 R-S01 一并迁移;多句入口(句子列表面板)带「第 n / m 句」与上一句 / 下一句。录音与评测中关闭要先确认。练习页本身的行为一字不变(`practice-page.test.tsx` 兜底),成绩仍以 `save: true` 保存进练习历史。

**Architecture:** 全部在 `web/src/features/practice/` 内,无服务端改动、无新依赖、不改 `enjoy/`、不放宽 `architecture.test.ts`(跨 feature 基线仍是 19 条,不加边)。
1. **钩子 `useShadowSession`**(`use-shadow-session.ts`,主包):把练习页里「录音 → 16 kHz WAV → `assessPronunciation(save:true)` → 保留录音以便重试」的状态机原样抽出,**练习页与弹窗共用**;练习页的全部现有用例不改一字、必须保持全绿(Task 1 先跑基线)。
2. **上下文 + 宿主**(`shadow/shadow-context.tsx`、`shadow/shadow-host.tsx`,主包,极小):`ShadowSheetProvider` 包住 `layout/app-shell.tsx` 的整个壳,`ShadowSheetHost` 与 `LookupLayer` 并列挂载;`useShadowSheet().open({ text, list?, index?, source })` / `close()`(稳定引用,调用方不会因弹窗开关重渲染);没有 Provider 时回退为 `goPractice`(旧行为)。宿主用 `React.lazy` 才加载弹窗块。
3. **懒加载块**(只在第一次打开时下载):`shadow/shadow-sheet.tsx`(弹窗本体)、`shadow/shadow-result.tsx`(`ShadowResult` 简化结果)、`shadow/shadow-fx.tsx`(CountUp / ClickSpark / 动效开关)、`shadow/word-tap.ts`(分词、逐词着色、点词 = 程序化选区)、`shadow/shadow-locales.ts` + `shadow/locales/{en,zh-CN}.json`(文案不进主包)、`shadow/shadow-sheet.css`(`.shs-*` 玻璃样式,不改 `theme.css`)。
4. **弹窗是非模态的 Radix Dialog(`modal={false}`)+ 自己的遮罩**,关闭确认画在弹窗内部(不是第二个弹层):选词操作条(`lookup-bar.tsx`,`z-40`,在 Portal 之外)因此仍可点,查词抽屉(`z-50`)仍叠在弹窗之上;理由见 R-S06。
5. **七个入口 + 三处从别的页面发起的快速跟读**各自改成「先关自己的面板 → `useShadowSheet().open(...)`」,每个入口一条「点跟读 → 弹窗出现且不导航」的测试。「单词操作」面板的入口由 `practice/register-word-actions.tsx` 贡献,它在查词抽屉之上又叠了一层模态面板:面板先自己 `close()`,`LookupLayer` 再在弹窗打开时收起查词抽屉(新的 `useShadowSheetOpen()`,R-S21),所以不会出现弹窗与抽屉并存。

**Tech Stack:** React 18 + TypeScript(`tsc --noEmit`,未开 `strict`)+ Tailwind 3(redesign v3 令牌)+ lucide-react 0.479 + i18next + sonner + `@radix-ui/react-dialog` ^1.1.6;vitest 3 + Testing Library + jsdom 26。录音沿用 `~/audio/use-recorder` / `~/audio/convert` / `~/audio/audio-focus`,范读沿用 `useTtsPlayer`(`~/features/chat`,practice→chat 边已在基线)。不引入 wavesurfer。

**Spec:** `docs/superpowers/specs/2026-10-14-shadow-sheet-design.md`(**有约束力**):§1 D1–D6;§2 现状(已核对,见下方裁定);§3.1 架构、§3.2 行为、§3.3 视觉;§4 隐私 / 验证 / 不做。视觉依据 `docs/superpowers/design/shadow-sheet-v1/mockup-glass.html`(玻璃版,冲突时以它为准;规则见 `2026-10-13-video-import-design.md` §11.4a)与同目录 `mockup.html`(结构与状态)。房规样式:`plans/2026-10-13-lookup-dictionary.md`、`plans/2026-10-13-video-import-web-shadow.md`。

## Global Constraints

- **隐私。** 参考句、录音、评测文本不进日志与 URL:路径只含评测 uuid(`/practice/assessments/:id`),句子只在 multipart / JSON 体里;代码里不写 `console.*`;错误经 `describeAudioError` / `translateServerError` 映射成固定文案(`PRACTICE_SERVER_ERRORS`),原始服务端文本不上屏;「我的录音」是本页内存里的 blob URL,换句 / 重录 / 卸载时 `revokeObjectURL`;不写 `localStorage` / `sessionStorage`。
- **分层不放宽。** `src/architecture.test.ts` 一字不改:`CROSS_FEATURE_BASELINE` 仍是 19 条。新代码只用已有的边:`chat->practice`、`lookup->practice`、`practice->chat`;`layout/` 不是 feature,经 `~/features/practice` 引入 Provider / Host 合规。`test/render.tsx` 在扫描里算「产品代码」,**不得**为了套 Provider 去引 `~/features/practice/...`(R-S05)。
- **不改 `enjoy/`、不改 `server/`、不向第三方发请求。** 全部上游调用走现有 `/api/speech/assessments`、`/api/ai/audio/speech`、`/api/practice-items`。
- **主包体积。** Provider、Host、钩子是主包代码,必须小;弹窗、结果组件、效果、分词、文案、样式只能经 `import()` 进入(`shadow-lazy.test.ts` 守着,Task 14)。`web/scripts/main-bundle-baseline.json`(396.86 kB gzip,预算 +0.2 kB)**不在本计划里修改**:体积只在用户要求时实测(`yarn web:build` + `node scripts/check-main-bundle.mjs --max-delta=1000`,只读不 `--record`)。
- **iOS(`web/CLAUDE.md` Pitfalls)。** `getUserMedia` 必须在点按手势里:`toggle()` 在 `await recorder.start()` 之前只做同步动作;`tts.play` 在点击处理函数里同步调用,中间不 `await`;录音开始前同步停掉范读与「我的录音」(音频路由);不引入第二个 `AudioContext`。
- **视觉。** 只用 `rgb(var(--ink))` 一类令牌与 `.shs-root` 作用域变量(设计稿数值);深浅色跟随 `html.dark`;一屏模糊层只有弹窗本身 1 层(上限 3;全站底栏已占 1 层,顶栏胶囊是第 2 层,所以弹窗是第 3 层);动画只用 `transform` / `opacity` / `background-position`;`html.lite`(`layout/glass-quality.ts`)、`prefers-reduced-motion`、`prefers-reduced-transparency`、不支持 `backdrop-filter` 全部降级;触控目标 ≥ 44 px;界面不用 emoji。
- **工作树是 CRLF**(`core.autocrlf=true`):改现有文件用 Edit 工具,新文件用 Write 工具。
- **每个任务结束:** 在仓库根 `yarn web:typecheck`,再 `cd web && yarn vitest run <任务列出的测试文件> src/architecture.test.ts`。**只跑本任务列出的测试**;`yarn web:test` 全量、`yarn web:build`、`yarn web:e2e`(花钱)、容器重建只在用户要求时跑。在 git worktree 里先把根目录与 `web/` 的 `node_modules` 用 junction / symlink 指到主检出,不要重装。
- **提交:** conventional(`feat(web): …`、`test(web): …`、`refactor(web): …`、`docs: …`),一个任务一个提交,提交后上面两条命令全绿;信息最后一行是 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`。用 heredoc 提交:

  ```bash
  git commit -F - <<'EOF'
  feat(web): <subject>

  Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
  EOF
  ```

- **写计划时的实跑(如实):** 本计划的代码与测试**没有在写计划时运行过**(写计划是只读文档任务,没有改任何源码)。写计划时读过的真实源码:`web/src/features/practice/{practice-page.tsx,practice-page.test.tsx,assessment-api.ts,assessment-page.tsx,mobile-score-result.tsx,save-practice-item.ts,practice-items-api.ts,index.ts,CLAUDE.md,i18n/*.json}`、六个调用点(`features/chat/{conversation-page.tsx,grammar-details.tsx,recap-sheet.tsx,sentence-practice-sheet.tsx,turn-detail-sheet.tsx}`、`features/lookup/lookup-layer.tsx`)及其测试、`features/lookup/{lookup-bar.tsx,use-text-selection.ts}`、`features/chat/{read-aloud-action.tsx,use-tts-player.ts}`、`features/library/{shadow-panel.tsx,use-shadowing.ts,word-tap.ts,score-card.tsx,shadow-fx.tsx,library.css,library-css.test.ts,library-lazy.test.ts,locales.ts,fx/*}`、`layout/{app-shell.tsx,glass-quality.ts,layout.test.tsx}`、`components/{bottom-sheet.tsx,score-tone.ts,icon-button.tsx}`、`audio/{use-recorder.ts,recorder.ts,audio-focus.ts,describe-error.ts}`、`api/server-config.ts`、`test/{render.tsx,fetch-mock.ts,fake-media.ts,setup.ts}`、`architecture.test.ts`、`app.tsx`、`i18n/index.ts`、`build/main-bundle.test.ts`、`scripts/{main-bundle.mjs,check-main-bundle.mjs}`、`e2e/{chat,lookup}.spec.ts`、`server/app/routers/speech.py`、`server/app/services/chat_recordings.py`、设计稿 `mockup-glass.html`。执行者第一次运行时以真实结果为准修正选择器与断言(尤其 jsdom 对 Radix 非模态 Dialog、`HTMLMediaElement.play`、`URL.createObjectURL` 的行为),但不得改动本计划的裁定与接口名。
- **没有真机运行过的一律写「未验证」**(`docs/CLAUDE.md`);fake 只证明逻辑。真机清单在 Task 15 创建的 `docs/superpowers/plans/2026-10-14-shadow-sheet-device-checklist.md`。

## 任务一览

| # | 任务 | 提交 |
|---|---|---|
| 0 | 预检(只读 + 基线测试) | 无 |
| 1 | 抽出 `useShadowSession`,练习页行为不变 | `refactor(web): extract useShadowSession from the practice page` |
| 2 | 上下文、宿主、应用壳挂载、骨架弹窗 | `feat(web): shadow sheet provider and lazy host in the app shell` |
| 3 | 纯函数与效果:分词 / 逐词着色 / 点词选区 / 提示、CountUp、ClickSpark | `feat(web): shadow sheet word tap and effects helpers` |
| 4 | 懒加载文案 + 结果组件 `ShadowResult` | `feat(web): shadow sheet result component and lazy copy` |
| 5 | 弹窗本体(全部状态)替换骨架 | `feat(web): shadow sheet with record, assess and result states` |
| 6 | 玻璃样式 + 样式守卫测试 | `feat(web): shadow sheet glass styling` |
| 7–12 | spec 列出的前六个入口各一个提交:句子列表、提示、语法、复盘、转写详情、选词查词 | `feat(web): <entry> opens the shadow sheet` |
| 12A | 第七个入口:「单词操作」面板的「跟读这个词」+ 弹窗打开时收起查词抽屉 | `feat(web): the word-actions shadow row opens the shadow sheet` |
| 12B | 迁移:发音弱词页(逐词「跟读」与「连读这 5 个」) | `feat(web): weak words open the shadow sheet` |
| 12C | 迁移:进度页弱词的话筒 | `feat(web): progress weak words open the shadow sheet` |
| 12D | 迁移:段位赛结果页的练习建议(drill) | `feat(web): the rank drill opens the shadow sheet` |
| 13 | 录音 / 评测中关闭先确认 | `feat(web): confirm before closing the shadow sheet mid-recording` |
| 14 | 懒加载守卫测试 | `test(web): keep the shadow sheet out of the main bundle` |
| 15 | 文档(五份 CLAUDE.md、README)与真机清单 | `docs: shadow sheet notes and device checklist` |

共 20 个任务(Task 0–15 加 12A–12D),19 个提交(Task 0 无提交)。入口合计 10 个:spec 的 7 个 + 按 R-S01 迁移的 3 个。

## 对 spec「核对」项的裁定(读真实代码得出)

| spec 核对项 | 结论 |
|---|---|
| §2 调用点 | 全仓 grep(`web/src` 下所有 `goPractice` / `navigate("/practice", …)`)得到 12 处带参考文本的跳转:**spec 的前六个**(`conversation-page.tsx:1392` 的 `onPractice`(提示)、`grammar-details.tsx:57`、`recap-sheet.tsx:102`(`practice()` 被语法项与弱词两处用)、`sentence-practice-sheet.tsx:59`、`turn-detail-sheet.tsx:95`、`lookup-layer.tsx:217`);**第七个**(用户后补):`practice/register-word-actions.tsx:17`(「单词操作」面板的「跟读这个词」,经 `plugins/word-actions/more-button.tsx` 的 `WordActionsSheet` 渲染,面板在查词抽屉之上);**按 R-S01 一并迁移的三处**:`plugins/pron-shadow/weak-words-page.tsx:41`(`navigate("/practice", { state: { reference } })`)、`progress/progress-page.tsx:141`、`rank/match-page.tsx:76`;**保留跳转的三处**:`practice/practice-list-page.tsx:138`(练习页自己的清单)、`practice/assessment-page.tsx:107`(完整详情页的「再练一次」,在练习 feature 内且目的就是回到练习页的输入框)、练习页的 `today-words-sheet` / `sources-strip`(经 `Slot` 的 `pick` 就地填入输入框,不是导航)。`goPractice` 继续导出(练习清单、无 Provider 回退)。 |
| §2 练习页内联流程 | 已逐行核对:`useRecorder({env, onAutoStop})` → `toAssessmentWav` → `assessPronunciation(api,{wav, reference: reference.trim(), language:"en-US", save:true, signal})` → 无 `assessmentId` 抛 `ApiError(500,"Could not save the recording")` → `setKept(null); navigate(...)`;上传前 `setKept(recording)` 保留录音,失败后可重试;`submitting` ref 防重复提交;卸载中止上传。练习页的 15 个状态 / 错误 / 卸载用例(`practice-page.test.tsx`)全部依赖这些细节,抽取必须逐字保持(R-S02)。 |
| §3.1 评测保存时传不传 `source` | **不传**(R-S03)。`server/app/routers/speech.py` 的 `SOURCES = ("practice","chat","library")`,缺省 `practice`;`GET /api/assessments` 默认只列 `source=practice`,所以不传才会出现在「练习 → 历史」里(spec D6 / §3.2 要求);传 `chat` 更危险:`cleanup_orphan_chat_recordings`(`server/app/services/chat_recordings.py`)会删掉「没有任何消息引用且超过宽限期」的 `source=chat` 评测,弹窗的成绩没有消息引用,会被清掉。`open()` 的 `source` 只用于「收藏」(`PracticeItemSource`)。 |
| §3.1 嵌套弹层陷阱 | `features/wordbook/CLAUDE.md`:嵌套 enjoy 的 `AlertDialog` 会使两套 `@radix-ui/react-focus-scope` 递归。本计划弹窗里**没有第二个 Radix 弹层**:关闭确认是弹窗内的覆盖层(`role="alertdialog"` 的普通 div);弹窗本身与查词抽屉都用同一份 `@radix-ui/react-dialog`(`components/bottom-sheet.tsx` 同源)。 |
| §3.1 `useTtsPlayer` 与「录音时停止范读」 | `useTtsPlayer(api,{onError,onNothingToRead})` 返回 `states / play / stop`;`play(key,text,model,voice)` 的同步段先 `primeAudioElement`,同键再点即停;`claimAudio(stop)` 让「我的录音」停下。练习页用 `tts.stop()` 在 `toggle` 里先停再开录;钩子用 `beforeRecord` 回调承接(练习页传 `stopTts`)。 |
| §3.2 视口锁 | `layout/CLAUDE.md`:`html`/`body` 是 `position: fixed; overflow: hidden`,文档不滚。弹窗 `position: fixed`,`max-height: min(85dvh, calc(var(--app-height, 100dvh) - 24px))`,内容区 `.shs-scroll` 自己 `overflow-y: auto; overscroll-behavior: contain`;弹窗里没有文本输入框,所以软键盘不会把它顶起(R-S11)。 |
| §3.2 选词操作条叠放 | `lookup-bar.tsx`:`absolute bottom-[calc(4.5rem+safe-area)] z-40`,渲染在 `AppShell` 根 div 里、**在 Portal 之外**;`BottomSheetContent` 是 `z-50` 且 Radix 模态会给 body 加 `pointer-events:none`,所以「模态弹窗 + 操作条」组合下操作条被盖住且点不到。弹窗因此做成非模态、`z-index` 35(遮罩)/ 36(弹窗)< 40(操作条)< 50(查词抽屉)(R-S06)。录音 / 评测中把参考句的 `data-lookup-context` 去掉,`readSelection` 就读不到选区,操作条不会出现(spec「录音中暂停选词操作条」)。叠在弹窗底部按钮上的位置**未验证**(真机清单)。 |
| §3.3 玻璃降级 | `layout/glass-quality.ts` 给 `<html>` 加 `.lite`(`deviceMemory ≤ 4`),所以选择器写 `html.lite .shs-sheet`;库的做法(`library.css`)同理。 |
| 架构:共享效果放哪 | 见 R-S07:**不动库**,在 practice 内本地重写一小组(≈ 150 行)。 |
| 测试里如何提供 Provider | 见 R-S05:`features/practice/shadow/test-utils.tsx` 的 `WithShadowSheet`,测试文件用深路径导入(扫描对 `.test.` 文件豁免规则 2)。 |
| 主包预算 | `main-bundle-baseline.json` = 396.86 kB gzip、预算 0.2 kB(`build/main-bundle.test.ts` 只测脚本函数,不测当前体积;预算由 `check-main-bundle.mjs` 在构建后检查)。本计划主包增量只有钩子 + Provider + Host,**未实测**,体积结果留给用户要求时(Global Constraints)。 |

## 本计划的裁定

- **R-S01 入口范围(规则:凡是「从另一个页面发起、只练一句 / 一个词」的入口都迁移;练习页自己的清单与历史、详情页的「再练一次」保持原样):** 迁移 spec 的七个入口(前六个 + 用户后补的「单词操作」面板「跟读这个词」),另按规则迁移三处:发音弱词页(`plugins/pron-shadow/weak-words-page.tsx`:逐词「跟读」与「连读这 5 个」,联动功能 `pron_shadow`)、进度页弱词话筒(`progress-page.tsx`)、段位赛结果页的练习建议(`rank/match-page.tsx` 的 `onDrill`:先 `savePracticeItem(…,"manual")` 再打开弹窗,`.finally` 的次序不变)。它们都是「在别的页面点一下就练」,留在原页比跳走更顺,而且 `rank->practice`、`progress->practice` 已在基线、`plugins/` 不是 feature,**不加任何跨 feature 边**。**不迁移:** `practice-list-page.tsx`(练习页自己的清单,用户本来就在练习 feature 里,跳回输入框练习是它的本意)、`assessment-page.tsx` 的「再练一次」(同上,详情页本身)、练习页内的 `learningSources` / `practiceHome` 插槽(就地填输入框,不是导航)。`goPractice` 因此只剩练习清单、详情页与无 Provider 回退三处使用,继续导出。`ShadowSource` 相应加上 `"manual"`(`PracticeItemSource` 的子集:`chat | grammar | lookup | manual`),弱词 / drill 用 `"manual"`,单词操作面板用 `target.source === "lookup" ? "lookup" : "manual"`。
- **R-S02 钩子契约:** `useShadowSession({ reference, recorderEnv?, starter?, maxDurationMs?, beforeRecord?, onAssessed?, keepAudio?, silenceError? })`。默认选项下与练习页原逻辑逐字等价(包括 `submitting` 守卫、成功时先 `setKept(null)` 再回调、卸载中止、失败保留录音);`keepAudio`(保留转换后的 WAV 的 blob URL 供「我的录音」)、`silenceError`(PCM 路径判定没有前景语音时不上传)、`starter` 只有弹窗 / 测试用。**`keepAudio` 默认关**:练习页的第一组用例没有 mock `URL.createObjectURL`(jsdom 没有它),默认开会让它们抛错。新增 `reset()`(中止上传、取消录音、清空状态、世代号 `gen` 让迟到的结果与错误被丢弃)只给弹窗换句 / 再练一次用。练习页保持自己的 `data-state` 计算(`processing / recording / error / kept / idle`),钩子另给 `phase`(`idle | recording | assessing | result | error`)给弹窗。
- **R-S03 评测不带 `source`:** 见上表。`ShadowSource = "chat" | "grammar" | "lookup"`(`PracticeItemSource` 的子集),只用于收藏。
- **R-S04 上下文形状:** 两个 React context:稳定的 `{open, close}`(`useShadowSheet()` 读它,所以 `ConversationPage` 这样的大组件不会因弹窗开关重渲染)与 `request`(只有 Host 读)。`open` 归一化(`normalizeShadowInput`):文本经 `practiceReference`(折叠空白、截到 2000)、`list` 里的空句被丢掉并保持 `index` 指向同一句、`text` 与 `list[index]` 不一致时以 `list` 为准、没有可练的内容时 `open` 什么也不做。没有 Provider 时 `useShadowSheet().open` 回退为 `goPractice(navigate, text)`(用 ref 取最新的 `navigate`,返回的对象引用稳定),这样没有挂壳的测试 / 页面不会静默失效。路径变化时 Host 关闭弹窗(浏览器返回也算)。
- **R-S05 测试接线:** `test/render.tsx` 的 `renderWithProviders` 是全部测试共用的,而且 `architecture.test.ts` 把它当产品代码(`isTest` 只认 `.test.ts(x)`),规则 2 禁止它引 `~/features/practice/shadow/...`;改成引 `~/features/practice` 又会让每个测试文件冷编译 practice 整棵依赖(含 wavesurfer),`test/setup.ts` 的注释记录过类似的 10 秒钩子超时。所以不改 `render.tsx`:`shadow/test-utils.tsx` 导出 `WithShadowSheet`(Provider + Host),六个入口的测试文件自己包一层(测试文件对规则 2 豁免)。
- **R-S06 非模态弹窗:** `DialogPrimitive.Root open modal={false}` + 自己的 `div` 遮罩(Portal 内、同属 `.shs-root`)。`onInteractOutside` 里 `preventDefault`(点操作条 / 查词抽屉不会关掉弹窗),遮罩点击、Escape、右上 ×、下拉抓手都走同一个 `requestClose`。`onCloseAutoFocus` 也 `preventDefault`(没有触发器可还)。`pointer-events: auto` 写在 `.shs-scrim, .shs-sheet` 上:来源面板(模态)的 200 ms 退出动画期间 body 还带 `pointer-events:none`,弹窗不能因此点不动。弹窗没有退出动画(关闭即卸载),只有入场动画。
- **R-S07 共享效果:** 设计稿的「拍板 6」建议把玻璃令牌抽成两边懒块共用的小样式文件。**不这么做**:`library.css` 有测试钉死(`library-css.test.ts`:模糊层恰为 3、`.lib-*` 选择器、体积 < 22 kB),`features/library/fx/*` 与 `shadow-fx.tsx` 各有测试,库已合并并经过评审;把它们搬到 `components/` / `lib/` 要同时改库的三组测试,风险大于收益。裁定:practice 内**本地重写**:`shadow/shadow-fx.tsx`(`motionAllowed`、`useCountUp`、`ClickSpark`)与 `shadow/word-tap.ts`(分词 / 逐词着色 / `selectWord`,算法与 `features/library/word-tap.ts` 相同,类型用 practice 自己的 `AssessmentWordBrief`)。样式是自己的 `.shs-*`。后续如要去重,把两份纯函数提到 `lib/word-tap.ts`、`lib/motion.ts`,库那边改成 re-export(单独的计划)。
- **R-S08 样式:** `shadow/shadow-sheet.css`,只在 `.shs-root` 内生效(Radix 把遮罩与内容渲染到 `body` 下,所以两者各自带 `.shs-root`),令牌 `--shs-*` 取设计稿数值(浅色强面 `.62`、深色 `.17`、高光边 `.85` / `.26`、blur 34px、saturate 2);次要文字色按设计稿「文字对比」条加深 / 提亮,所以用 `--shs-ink-2/3`;强调色(绿 / 琥珀 / 蓝 / 青 / 红)用全站令牌 `rgb(var(--green))` 等。随懒加载块进入(`shadow-sheet.tsx` 导入),不进主包、不改 `theme.css`。
- **R-S09 懒加载与文案:** Host 里 `lazy(() => import("./shadow-sheet"))`,`key={request.id}`;弹窗、结果、效果、分词、文案、样式只在这个块里。文案放 `shadow/locales/{en,zh-CN}.json`(**不在** `i18n/` 目录下,所以不被 `i18n/index.ts` 的 `import.meta.glob("../**/i18n/*.json")` 急切合并),由 `shadow-locales.ts` 在块求值时 `addResourceBundle`(同库的 `locales.ts`)。西班牙语回退到英文。
- **R-S10 降级:** `html.lite .shs-sheet`(去模糊、实色)、`@media (prefers-reduced-motion)`(全部静止,模糊保留)、`@media (prefers-reduced-transparency)`、`@supports not backdrop-filter`;`useCountUp` / `ClickSpark` 在 `motionAllowed()` 为 false 时直接给终态。
- **R-S11 视口:** 见上表。弹窗高度随状态变化时只做内容淡入,不动画高度(设计稿要点)。
- **R-S12 录音上限:** 弹窗 60 s(设计稿「最长 1 分钟」、库的 `SHADOW_MAX_MS` 同值),练习页仍是 5 分钟默认。到上限自动提交(与练习页相同:`stoppedBy === "max_duration"` 才自动评测,切后台 / 麦克风断开的录音保留为 `kept`)。
- **R-S13 波形:** 设计稿注明「正式版由麦克风音量驱动」,但 `useRecorder` 不暴露音量,要加就得改 `audio/` 的采集引擎。裁定:**模拟波形**(CSS `scaleY` 的 34 根竖条,与设计稿同),录音中动、评测中定格变淡;音量驱动留作后续。这是对设计稿的偏离,清单里标明。
- **R-S14 逐词着色:** 用**参考句**分词(`tokenizeSentence`),把评测的逐词结果(`briefWords`)按顺序向前最多看 3 个对齐(`wordTones`;`Insertion` 不参与;`Mispronunciation` / `Omission` 记为 `low`)。颜色用 `score-tone`(≥85 绿 / 70–84 琥珀 / <70 灰,spec §3.1);设计稿里 <70 画成红色波浪线,与 spec 的「灰」冲突,**取 spec**:灰色 + 保留波浪下划线(不只靠颜色)。提示条 `tipFor` 只由色调决定(`good` / `fair` / `weak`,弱词最多列 3 个),不编造发音建议。
- **R-S15 点词查词:** 点词 = 程序化选中该词(`selectWord`:`Selection.selectAllChildren`),`LookupLayer` 的 `useTextSelection` 在 `selectionchange` 稳定 300 ms 后自己显示操作条(与库的 R-SH15 同一做法),参考句与逐词卡都是 `data-lookup-context` 容器。**不新增 practice→lookup 边。** 用户刚拖选了别的文字时 `selectWord` 不覆盖。
- **R-S16 关闭语义:** 录音中 / 评测中 / 申请麦克风中(`starting`)关闭先确认;「放弃」= **关闭弹窗**(设计稿的静态页做不到关闭,所以演示里放弃回到待录音,那是演示的权宜);确认出现时 Escape / 点遮罩 = 「继续」;录音结束(进入 result / error / idle)时确认自动消失;卸载时钩子自己中止上传、取消录音、释放麦克风。
- **R-S17 音频:** 范读 = `useTtsPlayer` 的键 `"reference"`(按钮同键再点即停);「我的录音」= 转换后的 16 kHz WAV 的 blob URL(不是原始 webm,iOS 回放更稳)放进普通 `<audio>`,用 `claimAudio` / `releaseAudio` 与 TTS 互斥(与库的 `use-shadowing.ts` 同法);`beforeRecord` 同步停掉两者。
- **R-S18 句子列表入口:** 只把「能练的」句子(≤ `MAX_PRACTICE_TEXT`)作为 `list` 传入,`index` 取点中句在这个子列表里的位置,上一句 / 下一句不会落到被截断的超长句上。列表面板自己保持现有外观(spec §3.1:调用方先关自己的面板再 `open`;设计稿里「同一块玻璃换内容」的交叉淡入**不做**,偏离在清单里标明)。
- **R-S19 不做的设计稿装饰(已被文末 Addendum 2026-10-14 的 R-S22 部分取代:极光改为要做,仅 SpotlightCard 不做):** SoftAurora 色块(设计稿「拍板 4」,spec 未采纳,且是 3 个常驻模糊光斑)与 SpotlightCard 跟随高光(纯装饰)不做;保留入场动画、主按钮光带、录音脉冲 / 光晕、流光字、圆环 + 数字滚动、横条伸出、逐词浮入、收藏火花。需要时按真机清单反馈再加。
- **R-S20 公共出口:** `features/practice/index.ts` 只新增 `ShadowSheetProvider`、`ShadowSheetHost`、`useShadowSheet`、`useShadowSheetOpen`(Task 12A)、类型 `ShadowOpenInput` / `ShadowSource`;不导出任何懒加载模块、不导出 `useShadowSession`(只有练习页与弹窗用,都在 practice 内)。
- **R-S21 「单词操作」入口与查词抽屉:** 读真实代码:`ShadowRow`(`practice/register-word-actions.tsx`,扩展点 `wordActionsMenu`,联动 `word_actions`)在 `plugins/word-actions/word-actions-sheet.tsx` 里渲染,而那是一个**模态**面板,又叠在查词抽屉(`LookupLayer` 的 `BottomSheet`)之上。旧行为靠跳转:`close()` 关掉面板,`navigate` 是 PUSH,`LookupLayer` 里「路径变了就收起」的 effect 顺带收起抽屉。改成弹窗后没有导航,抽屉会留在弹窗下面。裁定:`ShadowRow` 先 `close()`(面板自己关,与现状同),再 `open(...)`;`LookupLayer` 用 `useShadowSheetOpen()`(只读 `request !== null`,无 Provider 时恒为 false)在弹窗**打开的那一刻**收起抽屉并清选区(effect 只依赖这个布尔值,所以弹窗已开时用户再从弹窗里选词打开查词抽屉不会被它关掉)。这样任何路径(「跟读这段」自己关抽屉、「跟读这个词」靠这个 effect)都满足「先关自己的面板,不叠两层弹窗」,也没有嵌套模态(面板与抽屉在弹窗打开前就已关闭)。`lookup-layer.tsx` 里按路径收起的旧 effect 保留(它还服务于「查看词卡」等真正的导航)。

## 文件结构与共享文件风险

```
web/src/
  features/practice/
    use-shadow-session.ts                 新(Task 1,主包)
    use-shadow-session.test.tsx           新(Task 1)
    practice-page.tsx                     [改](Task 1;其测试不改)
    index.ts                              [改](Task 2)
    CLAUDE.md                             [改](Task 15)
    shadow/
      shadow-context.tsx(+ .test.tsx)     新(Task 2,主包)
      shadow-host.tsx                     新(Task 2,主包)
      test-utils.tsx                      新(Task 2,仅测试用)
      shadow-sheet.tsx(+ .test.tsx)       新(Task 2 骨架;Task 5 整体替换;Task 13 改)
      word-tap.ts(+ .test.ts)             新(Task 3,懒)
      shadow-fx.tsx(+ .test.tsx)          新(Task 3,懒)
      shadow-locales.ts、locales/{en,zh-CN}.json、shadow-locales.test.ts   新(Task 4,懒)
      shadow-result.tsx(+ .test.tsx)      新(Task 4,懒)
      shadow-sheet.css、shadow-css.test.ts   新(Task 6,懒)
      shadow-lazy.test.ts                 新(Task 14)
  layout/app-shell.tsx                    [共享](Task 2)  layout/app-shell-shadow.test.tsx 新  layout/CLAUDE.md [改](Task 15)
  features/chat/{sentence-practice-sheet,conversation-page,grammar-details,recap-sheet,turn-detail-sheet}.tsx + 对应测试   [共享](Task 7–11)
  features/lookup/{lookup-layer.tsx,lookup-layer.test.tsx}   [共享](Task 12、12A)
  features/practice/register-word-actions.tsx、shadow/shadow-context.tsx(+ test)、index.ts   [改](Task 12A)
  plugins/word-actions/{lookup-shadow.test.tsx,more-button.test.tsx}   [改](Task 12A)
  plugins/pron-shadow/{weak-words-page.tsx,weak-words-page.test.tsx}   [共享](Task 12B)
  features/progress/{progress-page.tsx,progress-page.test.tsx}   [共享](Task 12C)
  features/rank/{match-page.tsx,match-page.test.tsx}   [共享](Task 12D)
  features/{chat,lookup}/CLAUDE.md        [改](Task 15)
web/e2e/{chat,lookup}.spec.ts             [改,不运行](Task 9、11、12)
web/README.md                             [共享·只追加一条](Task 15)
docs/superpowers/plans/2026-10-14-shadow-sheet-device-checklist.md   新(Task 15)
```

共享文件风险:(1) `conversation-page.tsx` 是超大文件,只动三行(导入、一个 hook、`onPractice`),并行计划若也改它会文本冲突,按行手工合并;(2) `lookup-layer.tsx` / `app-shell.tsx` 各只动几行;(3) `docs/superpowers/plans/2026-10-13-review-after-answer.md` 等并行计划不碰 practice / chat 的这些文件(只读核对过 git status:它们是未跟踪文档);(4) `web/README.md` 只追加一条,位置在「对话增强」一节末尾。

---

## Task 0:预检(只读 + 基线测试)

**Files:** 无改动。

- [ ] **Step 1:** `git status --short` 与 `git branch --show-current`:确认在本计划的工作分支上,工作树里与本计划文件无关的改动(如 `.gitignore`、`CLAUDE.md`、`docs/`)不要碰、不要提交。确认设计稿在:`ls docs/superpowers/design/shadow-sheet-v1/`(应有 `mockup.html` 与 `mockup-glass.html`)。
- [ ] **Step 2:** 确认行号锚点(都用 Grep,不是凭记忆):
  - `grep -rn "goPractice" web/src --include=*.tsx` 与 `grep -rn 'navigate("/practice"' web/src --include=*.tsx`:应共有 12 处带参考文本的跳转(六个 spec 入口 + `register-word-actions.tsx` + `plugins/pron-shadow/weak-words-page.tsx` + `progress-page.tsx` + `rank/match-page.tsx` 待迁移;`practice-list-page.tsx`、`assessment-page.tsx` 保留);
  - `grep -n "const navigate = useNavigate" web/src/features/chat/conversation-page.tsx`:恰好 1 处(Task 8 在它后面加一行);
  - `grep -n "CROSS_FEATURE_BASELINE.size" web/src/architecture.test.ts`:`toBe(19)`。
- [ ] **Step 3:** 跑基线并**记下通过数**(Task 1 之后练习页的数字必须不变):

```bash
cd web && yarn vitest run src/features/practice src/features/chat/sentence-practice-sheet.test.tsx src/features/chat/grammar-details.test.tsx src/features/lookup/lookup-layer.test.tsx src/layout/layout.test.tsx src/architecture.test.ts
```

期望全绿。若基线就有失败,**停下回报**,不要往下做(失败与本计划无关时要如实记录,不要"顺手修")。

---

## Task 1:抽出 `useShadowSession`,练习页行为不变

**Files:** Create `web/src/features/practice/use-shadow-session.ts`、`use-shadow-session.test.tsx`;Modify `web/src/features/practice/practice-page.tsx`。**`practice-page.test.tsx` 不改。**

- [ ] **Step 1(基线):** `cd web && yarn vitest run src/features/practice/practice-page.test.tsx` → 全绿,记下通过数(Task 0 已记)。这是本任务的安全网。
- [ ] **Step 2(先写钩子测试,红):** Create `web/src/features/practice/use-shadow-session.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import type { RecordingResult, RecordingSession } from "~/audio/recorder";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { useShadowSession, type ShadowSessionOptions } from "./use-shadow-session";

vi.mock("~/audio/convert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/audio/convert")>()),
  toAssessmentWav: vi.fn(async () => ({ wav: new Blob(["RIFF"], { type: "audio/wav" }), durationMs: 1000 })),
}));

const OK = {
  pronunciation_score: 88, accuracy_score: 90, fluency_score: 80, completeness_score: 100, assessment_id: "a1",
  detail_result: { words: [{ word: "hello", pronunciation_assessment: { accuracy_score: 99, error_type: "None" } }] },
};

function setup(routes: Record<string, Handler>, options: Partial<ShadowSessionOptions> = {}, envOverrides = {}) {
  const mock = createFetchMock(routes);
  const fake = createFakeRecorderEnv(envOverrides);
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
  const view = renderHook(() => useShadowSession({ reference: "  Hello world  ", recorderEnv: fake.env, ...options }), { wrapper });
  return { mock, fake, ...view };
}

const assessCalls = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.url.pathname === "/api/speech/assessments");

describe("useShadowSession", () => {
  beforeEach(() => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:mine"), revokeObjectURL: vi.fn() });
  });

  it("records, assesses with save=true and no source, and keeps the scored words", async () => {
    const onAssessed = vi.fn();
    const { result, mock } = setup({ "POST /api/speech/assessments": () => json(OK) }, { onAssessed });
    expect(result.current.phase).toBe("idle");
    await act(async () => { await result.current.toggle(); });
    expect(result.current.phase).toBe("recording");
    await act(async () => { await result.current.toggle(); });
    await waitFor(() => expect(result.current.phase).toBe("result"));
    expect(result.current.result).toEqual({
      assessmentId: "a1",
      scores: { pronunciationScore: 88, accuracyScore: 90, fluencyScore: 80, completenessScore: 100 },
      words: [{ word: "hello", accuracyScore: 99, errorType: "None" }],
    });
    expect(result.current.kept).toBeNull();
    expect(onAssessed).toHaveBeenCalledWith("a1");
    const form = assessCalls(mock)[0].body as FormData;
    expect(form.get("reference")).toBe("Hello world");
    expect(form.get("language")).toBe("en-US");
    expect(form.get("save")).toBe("true");
    expect(form.get("source")).toBeNull(); // R-S03:不带 source,成绩才会出现在练习历史里
  });

  it("keeps the recording after a failed upload and retries it", async () => {
    let attempt = 0;
    const { result, mock } = setup({
      "POST /api/speech/assessments": () => (++attempt === 1 ? json({ error: "Upstream unavailable" }, 502) : json(OK)),
    });
    await act(async () => { await result.current.toggle(); });
    await act(async () => { await result.current.toggle(); });
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.error).toContain("assessment service is unavailable");
    expect(result.current.kept).not.toBeNull();
    await act(async () => { await result.current.assessKept(); });
    await waitFor(() => expect(result.current.phase).toBe("result"));
    expect(assessCalls(mock)).toHaveLength(2);
    expect(result.current.kept).toBeNull();
  });

  it("keeps audio that stopped in the background, and can discard it without uploading", async () => {
    const { result, mock, fake } = setup({});
    await act(async () => { await result.current.toggle(); });
    await act(async () => fake.setHidden());
    await waitFor(() => expect(result.current.kept).not.toBeNull());
    expect(result.current.phase).toBe("error");
    expect(result.current.kept?.stoppedBy).toBe("background");
    act(() => result.current.discardKept());
    expect(result.current.phase).toBe("idle");
    expect(assessCalls(mock)).toHaveLength(0);
  });

  it("does not submit twice on a double tap", async () => {
    const { result, mock, fake } = setup({ "POST /api/speech/assessments": () => json(OK) });
    await act(async () => { await result.current.toggle(); });
    await act(async () => fake.setHidden());
    await waitFor(() => expect(result.current.kept).not.toBeNull());
    await act(async () => { void result.current.assessKept(); void result.current.assessKept(); });
    await waitFor(() => expect(result.current.phase).toBe("result"));
    expect(assessCalls(mock)).toHaveLength(1);
  });

  it("rejects a silent recording before upload when silenceError is set", async () => {
    const starter = async (): Promise<RecordingSession> => ({
      startedAt: 0,
      result: new Promise<RecordingResult>(() => undefined),
      stop: async () => ({ blob: new Blob(["x"]), mimeType: "audio/wav", durationMs: 400, stoppedBy: "user", noSpeech: true }),
      cancel: vi.fn(),
    });
    const { result, mock } = setup({}, { starter, silenceError: "quiet please" });
    await act(async () => { await result.current.toggle(); });
    await act(async () => { await result.current.toggle(); });
    expect(result.current.error).toBe("quiet please");
    expect(result.current.kept).toBeNull();
    expect(result.current.phase).toBe("error");
    expect(assessCalls(mock)).toHaveLength(0);
  });

  it("calls beforeRecord synchronously before the microphone is requested", async () => {
    const order: string[] = [];
    const base = createFakeRecorderEnv();
    const env = { ...base.env, getUserMedia: async (c: MediaStreamConstraints) => { order.push("mic"); return base.env.getUserMedia!(c); } };
    const { result } = setup({}, { recorderEnv: env, beforeRecord: () => order.push("before") });
    await act(async () => { await result.current.toggle(); });
    expect(order).toEqual(["before", "mic"]);
  });

  it("keeps the assessed WAV as a blob URL only when keepAudio is on, and drops it on the next recording", async () => {
    const on = setup({ "POST /api/speech/assessments": () => json(OK) }, { keepAudio: true });
    await act(async () => { await on.result.current.toggle(); });
    await act(async () => { await on.result.current.toggle(); });
    await waitFor(() => expect(on.result.current.phase).toBe("result"));
    expect(on.result.current.mineUrl).toBe("blob:mine");
    await act(async () => { await on.result.current.toggle(); }); // 开始下一次录音
    expect(on.result.current.mineUrl).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mine");
    on.unmount();

    vi.mocked(URL.createObjectURL).mockClear();
    const off = setup({ "POST /api/speech/assessments": () => json(OK) });
    await act(async () => { await off.result.current.toggle(); });
    await act(async () => { await off.result.current.toggle(); });
    await waitFor(() => expect(off.result.current.phase).toBe("result"));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(off.result.current.mineUrl).toBeNull();
  });

  it("reset aborts the upload, drops the late response and returns to idle", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { result, mock } = setup({ "POST /api/speech/assessments": async () => { await gate; return json(OK); } });
    await act(async () => { await result.current.toggle(); });
    await act(async () => { await result.current.toggle(); });
    await waitFor(() => expect(assessCalls(mock)).toHaveLength(1));
    expect(result.current.phase).toBe("assessing");
    const signal = assessCalls(mock)[0].signal!;
    act(() => result.current.reset());
    expect(signal.aborted).toBe(true);
    expect(result.current.phase).toBe("idle");
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 10)); });
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.phase).toBe("idle");
  });

  it("releases the microphone when unmounted mid-recording", async () => {
    const { result, fake, unmount } = setup({});
    await act(async () => { await result.current.toggle(); });
    expect(fake.track.stop).not.toHaveBeenCalled();
    unmount();
    await waitFor(() => expect(fake.track.stop).toHaveBeenCalled());
  });

  it("aborts the upload when unmounted mid-upload", async () => {
    const { result, mock, unmount } = setup({ "POST /api/speech/assessments": () => new Promise<Response>(() => undefined) });
    await act(async () => { await result.current.toggle(); });
    await act(async () => { await result.current.toggle(); });
    await waitFor(() => expect(assessCalls(mock)).toHaveLength(1));
    expect(assessCalls(mock)[0].signal?.aborted).toBe(false);
    unmount();
    expect(assessCalls(mock)[0].signal?.aborted).toBe(true);
  });
});
```

运行 `cd web && yarn vitest run src/features/practice/use-shadow-session.test.tsx` → 红(模块不存在)。

- [ ] **Step 3(实现钩子):** Create `web/src/features/practice/use-shadow-session.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "~/api/client";
import { toAssessmentWav } from "~/audio/convert";
import { describeAudioError } from "~/audio/describe-error";
import type { RecorderEnv, RecordingResult } from "~/audio/recorder";
import { useRecorder, type RecordingStarter } from "~/audio/use-recorder";
import { useAuth } from "~/auth/auth-context";
import {
  PRACTICE_SERVER_ERRORS, assessPronunciation, briefWords, type AssessmentScores, type AssessmentWordBrief,
} from "./assessment-api";

export type ShadowPhase = "idle" | "recording" | "assessing" | "result" | "error";

export interface ShadowSessionResult {
  assessmentId: string;
  scores: AssessmentScores;
  words: AssessmentWordBrief[];
}

export interface ShadowSessionOptions {
  /** 参考文本;上传前 trim */
  reference: string;
  recorderEnv?: RecorderEnv;
  /** 测试注入的录音启动器(透传给 useRecorder) */
  starter?: RecordingStarter;
  /** 录音上限;缺省沿用 useRecorder 的默认(练习页:5 分钟) */
  maxDurationMs?: number;
  /** 每次真正开始录音之前同步调用:停掉范读 / 我的录音,不把扬声器录进麦克风;getUserMedia 仍在这次点按的手势里 */
  beforeRecord?: () => void;
  /** 评测并保存成功后调用(练习页:跳到完整详情页);弹窗不传,结果留在 session.result */
  onAssessed?: (assessmentId: string) => void;
  /** 保留转换后的 WAV 的 blob URL(session.mineUrl),供「我的录音」播放。默认关:练习页不需要,jsdom 里也没有 createObjectURL */
  keepAudio?: boolean;
  /** 传入时,PCM 路径判定没有前景语音的录音不上传,直接报这条错误;练习页不传(行为不变) */
  silenceError?: string;
}

/**
 * 「录音 → 16 kHz WAV → 评测并保存 → 保留录音以便重试」的状态机(spec 2026-10-14-shadow-sheet §3.1)。
 * 原样取自练习页(上传前 setKept 保留录音、submitting 防重复提交、成功后先 setKept(null) 再回调、卸载中止上传),
 * 练习页与跟读弹窗共用;默认选项下与练习页原逻辑逐字等价,由 practice-page.test.tsx 兜底。
 * 评测不带 source:服务端缺省 "practice",成绩出现在练习历史里(R-S03)。
 */
export function useShadowSession(options: ShadowSessionOptions) {
  const { reference, recorderEnv, starter, maxDurationMs, keepAudio = false } = options;
  const { t } = useTranslation();
  const { api } = useAuth();
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState<RecordingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShadowSessionResult | null>(null);
  const [mineUrl, setMineUrl] = useState<string | null>(null);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const inflight = useRef<AbortController | null>(null);
  const gen = useRef(0); // reset() 之后,迟到的上传结果与错误一律丢弃
  const urlRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const setMine = useCallback((url: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setMineUrl(url);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inflight.current?.abort(); // 卸载时中止进行中的上传
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, []);

  const submit = useCallback(
    async (recording: RecordingResult) => {
      if (submitting.current) return; // 防止重复提交
      submitting.current = true;
      const g = gen.current;
      setKept(recording); // 上传成功前一直保留录音,失败后可重试
      setBusy(true);
      setError(null);
      const controller = new AbortController();
      inflight.current = controller;
      try {
        const silence = optionsRef.current.silenceError;
        if (silence && recording.noSpeech) {
          setKept(null);
          setError(silence);
          return;
        }
        const { wav } = await toAssessmentWav(recording.blob);
        if (g !== gen.current) return;
        if (keepAudio) setMine(URL.createObjectURL(wav));
        const res = await assessPronunciation(api, { wav, reference: reference.trim(), language: "en-US", save: true, signal: controller.signal });
        if (!mounted.current || g !== gen.current) return;
        if (!res.assessmentId) throw new ApiError(500, "Could not save the recording");
        setKept(null);
        setResult({
          assessmentId: res.assessmentId,
          scores: {
            pronunciationScore: res.pronunciationScore,
            accuracyScore: res.accuracyScore,
            fluencyScore: res.fluencyScore,
            completenessScore: res.completenessScore,
          },
          words: briefWords(res.detailResult?.words),
        });
        optionsRef.current.onAssessed?.(res.assessmentId);
      } catch (err) {
        // 非 JSON 的 2xx 等未知错误由 translateServerError 落到通用文案
        if (mounted.current && g === gen.current) setError(describeAudioError(t, err, PRACTICE_SERVER_ERRORS));
      } finally {
        if (g === gen.current) {
          submitting.current = false;
          if (inflight.current === controller) inflight.current = null;
          if (mounted.current) setBusy(false);
        }
      }
    },
    [api, reference, t, keepAudio, setMine],
  );

  const recorder = useRecorder({
    env: recorderEnv,
    starter,
    maxDurationMs,
    onAutoStop: (rec) => (rec.stoppedBy === "max_duration" ? void submit(rec) : setKept(rec)),
  });
  const cancelRecorder = recorder.cancel;

  const toggle = async () => {
    if (recorder.state === "recording") {
      const rec = await recorder.stop();
      if (rec) await submit(rec);
      return;
    }
    if (recorder.state !== "idle") return; // "starting" 时 stop() 无效,不允许操作
    setError(null);
    setKept(null);
    setResult(null);
    setMine(null);
    optionsRef.current.beforeRecord?.(); // 同步动作,getUserMedia 仍在这次点按的手势里
    await recorder.start();
  };

  const assessKept = () => (kept ? submit(kept) : Promise.resolve());
  const discardKept = () => {
    setKept(null);
    setError(null);
  };

  /** 丢弃一切:中止上传、取消录音、清空状态。换句 / 再练一次用;练习页不用。 */
  const reset = useCallback(() => {
    gen.current += 1;
    inflight.current?.abort();
    inflight.current = null;
    submitting.current = false;
    cancelRecorder();
    setBusy(false);
    setKept(null);
    setError(null);
    setResult(null);
    setMine(null);
  }, [cancelRecorder, setMine]);

  const recording = recorder.state === "recording";
  const shownError = error ?? (recorder.error ? describeAudioError(t, recorder.error) : null);
  const phase: ShadowPhase = busy ? "assessing" : recording ? "recording" : shownError || kept ? "error" : result ? "result" : "idle";
  return {
    phase,
    busy,
    recording,
    starting: recorder.state === "starting",
    recorderState: recorder.state,
    elapsedMs: recorder.elapsedMs,
    kept,
    error: shownError,
    result,
    mineUrl,
    toggle,
    assessKept,
    discardKept,
    reset,
  };
}
```

- [ ] **Step 4:** `cd web && yarn vitest run src/features/practice/use-shadow-session.test.tsx` → 全绿(若 jsdom 对 `act` 时序有出入,按真实结果修正**测试**的 `waitFor`,不要改钩子的语义)。
- [ ] **Step 5(重构练习页,用 Edit 工具):** `web/src/features/practice/practice-page.tsx`:
  1. 导入:`import { useCallback, useEffect, useRef, useState } from "react";` → `import { useEffect, useRef, useState } from "react";`;删除这些导入行:`import { ApiError } from "~/api/client";`、`import { describeAudioError } from "~/audio/describe-error";`、`import type { RecorderEnv, RecordingResult } from "~/audio/recorder";`(改为只留 `import type { RecorderEnv } from "~/audio/recorder";`)、`import { useRecorder } from "~/audio/use-recorder";`、`import { PRACTICE_SERVER_ERRORS, assessPronunciation } from "./assessment-api";`;`import { MAX_RECORDING_MS, toAssessmentWav } from "~/audio/convert";` → `import { MAX_RECORDING_MS } from "~/audio/convert";`;在 `import { PRACTICE_DRAFT_KEY as DRAFT_KEY, readJson, writeJson } from "~/lib/storage";` 之后加 `import { useShadowSession } from "./use-shadow-session";`。(`Button`、`useNavigate`、`toast`、`useAuth`、`loadServerAiConfig` 仍在用,保留。)
  2. 删掉这一段状态(`reference` 的 `useState` 之后):
```tsx
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState<RecordingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inflight.current?.abort(); // 卸载时中止进行中的上传
    };
  }, []);

```
  3. 把 `const submit = useCallback(` … 一直到 `const canRecord = …;` 这一整段(`submit`、`recorder`、`toggle`、`recording`、`shownError`、`status`、`canRecord`)替换为:
```tsx
  const session = useShadowSession({
    reference,
    recorderEnv,
    beforeRecord: stopTts, // 不要把扬声器的范读录进麦克风
    onAssessed: (id) => navigate(`/practice/assessments/${id}`),
  });
  const { busy, recording, kept, error: shownError, elapsedMs, recorderState, toggle } = session;
  const status = busy ? "processing" : recording ? "recording" : shownError ? "error" : kept ? "kept" : "idle";
  // 停止按钮只在状态确为 "recording" 时可用;"starting" 期间整体禁用
  const canRecord = recording || (reference.trim().length > 0 && !busy && recorderState === "idle");
```
  4. JSX 里四处:`{formatClock(recorder.elapsedMs)}` → `{formatClock(elapsedMs)}`;`recorder.state !== "idle" || busy` → `recorderState !== "idle" || busy`;`onClick={() => void submit(kept)}` → `onClick={() => void session.assessKept()}`;`onClick={() => { setKept(null); setError(null); }}` → `onClick={session.discardKept}`。`onClick={toggle}` 不变。
- [ ] **Step 6:** 运行(这是本任务的验收):

```bash
yarn web:typecheck
cd web && yarn vitest run src/features/practice src/plugins/pron-shadow/practice-integration.test.tsx src/layout/feature-flags.test.tsx src/architecture.test.ts
```

期望:`practice-page.test.tsx` 的通过数与 Task 0 记录一致、零失败;钩子的十个用例全绿。**若练习页任何一条失败:不要改练习页的测试,回头改钩子,直到它们原样通过。**
- [ ] **Step 7: 提交** `refactor(web): extract useShadowSession from the practice page`。

---

## Task 2:上下文、宿主、应用壳挂载、骨架弹窗

**Files:** Create `web/src/features/practice/shadow/{shadow-context.tsx,shadow-context.test.tsx,shadow-host.tsx,test-utils.tsx,shadow-sheet.tsx}`、`web/src/layout/app-shell-shadow.test.tsx`;Modify `web/src/features/practice/index.ts`、`web/src/layout/app-shell.tsx`。

- [ ] **Step 1(测试,红):** Create `web/src/features/practice/shadow/shadow-context.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useNavigate } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "~/test/render";
import { ShadowSheetProvider, normalizeShadowInput, useShadowSheet, type ShadowOpenInput } from "./shadow-context";
import { ShadowSheetHost } from "./shadow-host";

describe("normalizeShadowInput", () => {
  it("collapses whitespace in a single sentence and has no neighbours", () => {
    expect(normalizeShadowInput({ text: "  Hello \n  world ", source: "chat" })).toEqual({ items: ["Hello world"], index: 0, source: "chat" });
  });

  it("truncates to the practice limit", () => {
    const next = normalizeShadowInput({ text: "a".repeat(2500), source: "lookup" });
    expect(next?.items[0]).toHaveLength(2000);
  });

  it("keeps the whole list and the tapped index", () => {
    expect(normalizeShadowInput({ text: "B.", list: ["A.", "B.", "C."], index: 1, source: "chat" })).toEqual({
      items: ["A.", "B.", "C."], index: 1, source: "chat",
    });
  });

  it("drops blank list entries but keeps the index on the same sentence", () => {
    expect(normalizeShadowInput({ text: "C.", list: ["A.", "  ", "C."], index: 2, source: "chat" })).toEqual({
      items: ["A.", "C."], index: 1, source: "chat",
    });
  });

  it("finds the text in the list when no index is given, and falls back to the first sentence", () => {
    expect(normalizeShadowInput({ text: "B.", list: ["A.", "B."], source: "chat" })?.index).toBe(1);
    expect(normalizeShadowInput({ text: "Z.", list: ["A.", "B."], source: "chat" })?.index).toBe(0);
  });

  it("a one-item list is a single sentence; nothing to practise yields null", () => {
    expect(normalizeShadowInput({ text: "A.", list: ["A."], index: 0, source: "chat" })?.items).toEqual(["A."]);
    expect(normalizeShadowInput({ text: "   ", source: "chat" })).toBeNull();
    expect(normalizeShadowInput({ text: " ", list: [" ", ""], source: "chat" })).toBeNull();
  });
});

function Opener({ input, label = "open" }: { input: ShadowOpenInput; label?: string }) {
  const { open } = useShadowSheet();
  return <button type="button" data-testid={label} onClick={() => open(input)}>{label}</button>;
}

function Nav() {
  const go = useNavigate();
  return <button type="button" data-testid="go" onClick={() => go("/elsewhere")}>go</button>;
}

describe("useShadowSheet without a provider", () => {
  it("falls back to the practice page with the sentence as reference", async () => {
    renderWithProviders(<Opener input={{ text: "  Hello   there. ", source: "chat" }} />, { route: "/chat/c1" });
    await userEvent.click(screen.getByTestId("open"));
    expect(screen.getByTestId("location")).toHaveTextContent("/practice");
    expect(JSON.parse(screen.getByTestId("location").getAttribute("data-state")!)).toEqual({ reference: "Hello there." });
  });
});

describe("ShadowSheetProvider + ShadowSheetHost", () => {
  it("opens the sheet in place without navigating", async () => {
    renderWithProviders(
      <ShadowSheetProvider><Opener input={{ text: "Hello there.", source: "chat" }} /><ShadowSheetHost /></ShadowSheetProvider>,
      { route: "/chat/c1" },
    );
    expect(screen.queryByTestId("shadow-sheet")).toBeNull();
    await userEvent.click(screen.getByTestId("open"));
    expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent("Hello there.");
    expect(screen.getByTestId("location")).toHaveTextContent("/chat/c1");
    expect(screen.getByTestId("location").getAttribute("data-state")).toBe("null");
  });

  it("closes from the sheet's close button", async () => {
    renderWithProviders(
      <ShadowSheetProvider><Opener input={{ text: "Hello there.", source: "chat" }} /><ShadowSheetHost /></ShadowSheetProvider>,
    );
    await userEvent.click(screen.getByTestId("open"));
    await userEvent.click(await screen.findByTestId("shadow-close"));
    expect(screen.queryByTestId("shadow-sheet")).toBeNull();
  });

  it("closes when the route changes (including browser back)", async () => {
    renderWithProviders(
      <ShadowSheetProvider><Opener input={{ text: "Hello there.", source: "chat" }} /><Nav /><ShadowSheetHost /></ShadowSheetProvider>,
    );
    await userEvent.click(screen.getByTestId("open"));
    expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("go"));
    expect(screen.queryByTestId("shadow-sheet")).toBeNull();
  });

  it("a second open replaces the first request", async () => {
    renderWithProviders(
      <ShadowSheetProvider>
        <Opener input={{ text: "First one.", source: "chat" }} label="a" />
        <Opener input={{ text: "Second one.", source: "grammar" }} label="b" />
        <ShadowSheetHost />
      </ShadowSheetProvider>,
    );
    await userEvent.click(screen.getByTestId("a"));
    expect(await screen.findByTestId("shadow-reference")).toHaveTextContent("First one.");
    await userEvent.click(screen.getByTestId("b"));
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent("Second one.");
  });

  it("ignores an open request with nothing to practise", async () => {
    renderWithProviders(
      <ShadowSheetProvider><Opener input={{ text: "   ", source: "chat" }} /><ShadowSheetHost /></ShadowSheetProvider>,
    );
    await userEvent.click(screen.getByTestId("open"));
    expect(screen.queryByTestId("shadow-sheet")).toBeNull();
  });
});
```

运行 `cd web && yarn vitest run src/features/practice/shadow/shadow-context.test.tsx` → 红。

- [ ] **Step 2(实现):** Create `web/src/features/practice/shadow/shadow-context.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { PracticeItemSource } from "../practice-items-api";
import { goPractice, practiceReference } from "../save-practice-item";

/** 入口来源,只用于「收藏」(PracticeItemSource 的子集);评测本身不带 source(R-S03) */
export type ShadowSource = Extract<PracticeItemSource, "chat" | "grammar" | "lookup" | "manual">;

export interface ShadowOpenInput {
  /** 要跟读的句子;给了 list 时以 list[index] 为准 */
  text: string;
  /** 多句入口(句子列表面板)传整张列表,弹窗显示「第 n / m 句」与上一句 / 下一句 */
  list?: string[];
  index?: number;
  source: ShadowSource;
}

export interface ShadowRequest {
  id: number;
  items: string[];
  index: number;
  source: ShadowSource;
}

export interface ShadowSheetApi {
  open(input: ShadowOpenInput): void;
  close(): void;
}

/** 归一化:空白折叠并截到上限;空句丢掉但 index 仍指向同一句;没有可练的内容返回 null。 */
export function normalizeShadowInput(input: ShadowOpenInput): Omit<ShadowRequest, "id"> | null {
  const single = practiceReference(input.text);
  const cleaned = (input.list ?? []).map(practiceReference);
  const wanted = input.index ?? cleaned.indexOf(single);
  const usable = cleaned.flatMap((text, i) => (text ? [{ text, i }] : []));
  if (usable.length === 0) return single ? { items: [single], index: 0, source: input.source } : null;
  const at = usable.findIndex((u) => u.i === wanted);
  return { items: usable.map((u) => u.text), index: at >= 0 ? at : 0, source: input.source };
}

const ApiContext = createContext<ShadowSheetApi | null>(null);
const RequestContext = createContext<ShadowRequest | null>(null);

/**
 * 全局单例弹窗的状态(挂在 layout/app-shell.tsx,包住整个壳)。两个 context:稳定的 {open, close} 给调用方
 * (弹窗开关不会让 ConversationPage 这样的大组件重渲染),request 只给 ShadowSheetHost。
 */
export function ShadowSheetProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ShadowRequest | null>(null);
  const seq = useRef(0);
  const open = useCallback((input: ShadowOpenInput) => {
    const next = normalizeShadowInput(input);
    if (!next) return;
    seq.current += 1;
    setRequest({ id: seq.current, ...next });
  }, []);
  const close = useCallback(() => setRequest(null), []);
  const api = useMemo<ShadowSheetApi>(() => ({ open, close }), [open, close]);
  return (
    <ApiContext.Provider value={api}>
      <RequestContext.Provider value={request}>{children}</RequestContext.Provider>
    </ApiContext.Provider>
  );
}

/**
 * 调用方先关闭自己的面板,再 open(不叠两层弹窗)。返回对象引用稳定。
 * 没有 Provider(没挂壳的页面 / 测试)时回退为旧行为:跳到练习页并预填参考文本。
 */
export function useShadowSheet(): ShadowSheetApi {
  const api = useContext(ApiContext);
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const fallback = useMemo<ShadowSheetApi>(
    () => ({ open: (input) => goPractice(navigateRef.current, input.text), close: () => undefined }),
    [],
  );
  return api ?? fallback;
}

/** 只给 ShadowSheetHost 用 */
export function useShadowHost(): { request: ShadowRequest | null; api: ShadowSheetApi | null } {
  return { request: useContext(RequestContext), api: useContext(ApiContext) };
}
```

Create `web/src/features/practice/shadow/shadow-host.tsx`:

```tsx
import { lazy, Suspense, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import type { RecorderEnv } from "~/audio/recorder";
import { useShadowHost } from "./shadow-context";

// 弹窗本体、结果、效果、分词、文案、样式都在这个块里,第一次打开才下载(R-S09;shadow-lazy.test.ts 守着)
const LazySheet = lazy(async () => ({ default: (await import("./shadow-sheet")).ShadowSheet }));

/** 与 LookupLayer 并列挂在应用壳里。路径变化(含浏览器返回)时关闭弹窗。 */
export function ShadowSheetHost({ recorderEnv }: { recorderEnv?: RecorderEnv }) {
  const { request, api } = useShadowHost();
  const { pathname } = useLocation();
  const shownAt = useRef(pathname);
  useEffect(() => {
    if (pathname === shownAt.current) return;
    shownAt.current = pathname;
    api?.close();
  }, [pathname, api]);
  if (!request || !api) return null;
  return (
    <Suspense fallback={null}>
      <LazySheet key={request.id} request={request} onClose={api.close} recorderEnv={recorderEnv} />
    </Suspense>
  );
}
```

Create `web/src/features/practice/shadow/test-utils.tsx`(测试文件用深路径导入它;产品代码从不导入):

```tsx
import type { ReactNode } from "react";
import type { RecorderEnv } from "~/audio/recorder";
import { ShadowSheetProvider } from "./shadow-context";
import { ShadowSheetHost } from "./shadow-host";

/** 测试里套上 Provider + Host(R-S05):`renderWithProviders(<WithShadowSheet>…</WithShadowSheet>)`。必须在 Router 里。 */
export function WithShadowSheet({ children, recorderEnv }: { children: ReactNode; recorderEnv?: RecorderEnv }) {
  return (
    <ShadowSheetProvider>
      {children}
      <ShadowSheetHost recorderEnv={recorderEnv} />
    </ShadowSheetProvider>
  );
}
```

Create `web/src/features/practice/shadow/shadow-sheet.tsx`(**骨架,Task 5 整体替换**;保证 Host 的动态导入有目标,并让本任务的测试有真东西可点;`data-testid` 与最终版一致):

```tsx
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { RecorderEnv } from "~/audio/recorder";
import type { ShadowRequest } from "./shadow-context";

export interface ShadowSheetProps {
  request: ShadowRequest;
  onClose(): void;
  recorderEnv?: RecorderEnv;
}

export function ShadowSheet({ request, onClose }: ShadowSheetProps) {
  return (
    <DialogPrimitive.Root open modal={false} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content data-testid="shadow-sheet" aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()} className="fixed inset-x-2 bottom-2 z-[36] rounded-sheet bg-surface p-4 text-ink">
          <DialogPrimitive.Title>Read aloud</DialogPrimitive.Title>
          <p data-testid="shadow-reference">{request.items[request.index]}</p>
          <button type="button" data-testid="shadow-close" onClick={onClose}>Close</button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
```

- [ ] **Step 3(公共出口):** `web/src/features/practice/index.ts` 末尾追加:

```ts
export { ShadowSheetProvider, useShadowSheet, type ShadowOpenInput, type ShadowSource } from "./shadow/shadow-context";
export { ShadowSheetHost } from "./shadow/shadow-host";
```

- [ ] **Step 4(应用壳,用 Edit 工具):** `web/src/layout/app-shell.tsx`:在 `import { LookupLayer } from "~/features/lookup";` 后加 `import { ShadowSheetHost, ShadowSheetProvider } from "~/features/practice";`;把 `return (` 之后的整棵树包进 `<ShadowSheetProvider>`,并在 `<LookupLayer />` 后加 `<ShadowSheetHost />`。改完整个返回值是:

```tsx
  return (
    <ShadowSheetProvider>
      <div className="relative flex flex-col bg-background" style={{ height: "var(--app-height, 100dvh)" }}>
        <ScrollRootProvider value={scrollRoot}>
          <main
            ref={setScrollRoot}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-[calc(3.5rem+env(safe-area-inset-bottom))]"
          >
            <Outlet />
          </main>
        </ScrollRootProvider>
        <BottomNav />
        <LookupLayer />
        <ShadowSheetHost />
      </div>
    </ShadowSheetProvider>
  );
```
  同时把文件顶部的注释补一句:`弹窗(ShadowSheetHost)与查词层并列,Provider 包住整个壳,各页面经 useShadowSheet() 打开。`

- [ ] **Step 5(壳的测试):** Create `web/src/layout/app-shell-shadow.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { useShadowSheet } from "~/features/practice";
import { createFetchMock } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { AppShell } from "./app-shell";

function Page() {
  const { open } = useShadowSheet();
  return <button type="button" data-testid="open-shadow" onClick={() => open({ text: "Hello there.", source: "chat" })}>open</button>;
}

describe("AppShell shadow sheet", () => {
  it("provides the shadow sheet to every page under the shell", async () => {
    const mock = createFetchMock({});
    renderWithProviders(
      <Routes><Route element={<AppShell />}><Route path="*" element={<Page />} /></Route></Routes>,
      { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat/c1" },
    );
    await userEvent.click(screen.getByTestId("open-shadow"));
    expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent("Hello there.");
    expect(screen.getByTestId("location")).toHaveTextContent("/chat/c1");
  });
});
```

- [ ] **Step 6:**

```bash
yarn web:typecheck
cd web && yarn vitest run src/features/practice/shadow/shadow-context.test.tsx src/layout/app-shell-shadow.test.tsx src/layout/layout.test.tsx src/architecture.test.ts
```
全绿(架构测试:`layout → practice` 不是 feature 边,基线仍 19)。
- [ ] **Step 7: 提交** `feat(web): shadow sheet provider and lazy host in the app shell`。

---

## Task 3:纯函数与效果(分词 / 逐词着色 / 点词选区 / 提示、CountUp、ClickSpark)

**Files:** Create `web/src/features/practice/shadow/{word-tap.ts,word-tap.test.ts,shadow-fx.tsx,shadow-fx.test.tsx}`。都是懒块里的模块(R-S07:与 `features/library/{word-tap.ts,fx/*}` 同一算法的本地版本,不跨 feature 导入)。

- [ ] **Step 1(测试,红):** Create `web/src/features/practice/shadow/word-tap.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import type { AssessmentWordBrief } from "../assessment-api";
import { lowWords, selectWord, tipFor, tokenizeSentence, wordTones } from "./word-tap";

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

describe("wordTones", () => {
  it("aligns scored words in order, skips insertions and marks omissions and mispronunciations low", () => {
    const words: AssessmentWordBrief[] = [
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
    const words: AssessmentWordBrief[] = [
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

describe("lowWords and tipFor", () => {
  const tokens = tokenizeSentence("Could I get a medium latte, please?");
  const tones = ["good", "good", "fair", "good", "low", "low", "good"] as const;

  it("lists the low-tone words in sentence order, at most `limit`", () => {
    expect(lowWords(tokens, [...tones])).toEqual(["medium", "latte"]);
    expect(lowWords(tokens, [...tones], 1)).toEqual(["medium"]);
  });

  it("does not list the same word twice", () => {
    const t2 = tokenizeSentence("Go go go");
    expect(lowWords(t2, ["low", "low", "low"])).toEqual(["Go"]);
  });

  it("picks the tip from the weak words first, then from the score", () => {
    expect(tipFor(95, ["latte"])).toEqual({ kind: "weak", words: ["latte"] });
    expect(tipFor(90, [])).toEqual({ kind: "good", words: [] });
    expect(tipFor(75, [])).toEqual({ kind: "fair", words: [] });
    expect(tipFor(60, [])).toEqual({ kind: "fair", words: [] });
  });
});

describe("selectWord", () => {
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
    expect(b.closest("[data-lookup-context]")).not.toBeNull();
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

Create `web/src/features/practice/shadow/shadow-fx.test.tsx`:

```tsx
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClickSpark, countUpValue, motionAllowed, useCountUp } from "./shadow-fx";

describe("motionAllowed", () => {
  afterEach(() => document.documentElement.classList.remove("lite"));

  it("is true by default, false on low-end devices (html.lite) and with prefers-reduced-motion", () => {
    expect(motionAllowed()).toBe(true);
    document.documentElement.classList.add("lite");
    expect(motionAllowed()).toBe(false);
    document.documentElement.classList.remove("lite");
    const win = { document, matchMedia: () => ({ matches: true }) } as unknown as Window;
    expect(motionAllowed(win)).toBe(false);
  });
});

describe("countUpValue / useCountUp", () => {
  it("eases out from 0 to the target", () => {
    expect(countUpValue(0, 80)).toBe(0);
    expect(countUpValue(1, 80)).toBe(80);
    expect(countUpValue(0.5, 80)).toBeGreaterThan(40);
  });

  it("gives the final value at once when animation is off", () => {
    const { result } = renderHook(() => useCountUp(88, { enabled: false }));
    expect(result.current).toBe(88);
  });

  it("rolls from 0 to the target with the animation frames", () => {
    const callbacks: Array<(now: number) => void> = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { callbacks.push(cb); return callbacks.length; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const { result } = renderHook(() => useCountUp(80, { enabled: true, durationMs: 1000 }));
    expect(result.current).toBe(0);
    act(() => callbacks.shift()!(0));
    act(() => callbacks.shift()!(500));
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(80);
    act(() => callbacks.shift()!(1000));
    expect(result.current).toBe(80);
  });
});

describe("ClickSpark", () => {
  it("bursts eight sparks on click and clears them afterwards", () => {
    vi.useFakeTimers();
    try {
      render(<ClickSpark><button type="button" data-testid="b">x</button></ClickSpark>);
      fireEvent.click(screen.getByTestId("b"));
      expect(document.querySelectorAll(".shs-spark")).toHaveLength(8);
      act(() => { vi.advanceTimersByTime(700); });
      expect(document.querySelectorAll(".shs-spark")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing when disabled or when motion is off", () => {
    render(<ClickSpark disabled><button type="button" data-testid="d">x</button></ClickSpark>);
    fireEvent.click(screen.getByTestId("d"));
    expect(document.querySelectorAll(".shs-spark")).toHaveLength(0);
    document.documentElement.classList.add("lite");
    try {
      render(<ClickSpark><button type="button" data-testid="e">x</button></ClickSpark>);
      fireEvent.click(screen.getByTestId("e"));
      expect(document.querySelectorAll(".shs-spark")).toHaveLength(0);
    } finally {
      document.documentElement.classList.remove("lite");
    }
  });

  it("clears its timer on unmount without warnings", () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const view = render(<ClickSpark><button type="button" data-testid="u">x</button></ClickSpark>);
      fireEvent.click(screen.getByTestId("u"));
      view.unmount();
      act(() => { vi.advanceTimersByTime(700); });
      expect(err).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
```

运行 `cd web && yarn vitest run src/features/practice/shadow/word-tap.test.ts src/features/practice/shadow/shadow-fx.test.tsx` → 红。

- [ ] **Step 2(实现):** Create `web/src/features/practice/shadow/word-tap.ts`:

```ts
import { scoreTone, type ScoreTone } from "~/components/score-tone";
import type { AssessmentWordBrief } from "../assessment-api";

/** 句子的一个片段:词(word = 从 0 起的词序号)或词之间的空白与标点(word = -1)。 */
export interface SentenceToken {
  text: string;
  word: number;
}

// 与 features/library/word-tap.ts 同一算法(R-S07:不能跨 feature 导入,所以本地一份)。
// 连字符 / 撇号只作词内连接符;归一化时去掉,"isn't" 能匹配评测返回的 "isnt"。
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

function toneOf(w: AssessmentWordBrief): ScoreTone | null {
  if (w.errorType === "Mispronunciation" || w.errorType === "Omission") return "low";
  return typeof w.accuracyScore === "number" ? scoreTone(w.accuracyScore) : null;
}

/**
 * 把评测的逐词结果按顺序对齐到句子的词上(向前最多看 lookahead 个),返回每个词的分数色调(下标 = 词序号);
 * 对不上的词为 null。多说的词(Insertion)在句子里没有位置,不参与对齐。
 */
export function wordTones(tokens: SentenceToken[], words: AssessmentWordBrief[] | undefined, lookahead = 3): Array<ScoreTone | null> {
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

/** 色调为 low 的词(句子里的原样写法,按出现顺序,忽略大小写去重,最多 limit 个)。 */
export function lowWords(tokens: SentenceToken[], tones: Array<ScoreTone | null>, limit = 3): string[] {
  const out: string[] = [];
  for (const token of tokens) {
    if (token.word < 0 || tones[token.word] !== "low") continue;
    if (out.some((w) => w.toLowerCase() === token.text.toLowerCase())) continue;
    out.push(token.text);
    if (out.length >= limit) break;
  }
  return out;
}

export type TipKind = "good" | "fair" | "weak";

/** 提示条的种类只由色调决定:有弱词 → weak;否则按总分 good(≥85)/ fair。不编造发音建议(R-S14)。 */
export function tipFor(mainScore: number, low: string[]): { kind: TipKind; words: string[] } {
  if (low.length > 0) return { kind: "weak", words: low };
  return { kind: scoreTone(mainScore) === "good" ? "good" : "fair", words: [] };
}

/**
 * 点词 = 程序化选中这个词(R-S15):全局 LookupLayer 在 selectionchange 稳定 300 ms 后自己显示选词操作条,
 * 上下文取最近的 [data-lookup-context](整句)。用户刚拖选了别的文字时不覆盖。返回是否改了选区。
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
```

Create `web/src/features/practice/shadow/shadow-fx.tsx`:

```tsx
import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";

/**
 * 低端机(html.lite)或系统开了「减少动态效果」时为 false:JS 驱动的效果直接给终态。
 * 与 features/library/fx/motion.ts 同一规则(R-S07:不能跨 feature 导入,本地一份)。
 */
export function motionAllowed(win: Window = window): boolean {
  if (win.document.documentElement.classList.contains("lite")) return false;
  try {
    return !win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

/** 数字滚动的缓动:ease-out cubic,progress ∈ [0, 1]。 */
export function countUpValue(progress: number, to: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return to * (1 - Math.pow(1 - p, 3));
}

/** 数字从当前值滚到 `to`;动效关闭(enabled === false 或 motionAllowed() 为 false)时直接给终值。 */
export function useCountUp(to: number, opts: { durationMs?: number; enabled?: boolean } = {}): number {
  const { durationMs = 1100 } = opts;
  const animate = opts.enabled ?? motionAllowed();
  const [value, setValue] = useState(animate ? 0 : to);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (!animate) {
      setValue(to);
      return undefined;
    }
    const from = latest.current;
    let id = 0;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const p = Math.min(1, (now - start) / durationMs);
      setValue(from + (to - from) * countUpValue(p, 1));
      if (p < 1) id = window.requestAnimationFrame(step);
    };
    id = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(id);
  }, [to, durationMs, animate]);

  return value;
}

const SPARK_COUNT = 8;
const SPARK_MS = 600;
const COLORS = ["rgb(var(--amber))", "rgb(var(--teal))", "rgb(var(--blue))", "rgb(var(--red))"];

interface Spark { id: number; x: number; y: number; dx: number; dy: number; color: string }
let nextId = 1;

/** 一次迸发:SPARK_COUNT 颗火花从点击处向四周散开(半径 26–40 px,方向均分,确定性,不用随机数)。 */
function burst(origin: { x: number; y: number }): Spark[] {
  return Array.from({ length: SPARK_COUNT }, (_, i) => {
    const angle = (i / SPARK_COUNT) * Math.PI * 2;
    const radius = 26 + (i % 3) * 7;
    return { id: nextId++, x: origin.x, y: origin.y, dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius, color: COLORS[i % COLORS.length] };
  });
}

/** 点击处迸出小火花(「收藏」):包住一个按钮;动效关闭 / disabled 时什么都不做;卸载时清掉定时器。 */
export function ClickSpark({ children, disabled = false }: { children: ReactNode; disabled?: boolean }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [sparks, setSparks] = useState<Spark[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const onClickCapture = (e: MouseEvent<HTMLSpanElement>) => {
    if (disabled || !motionAllowed()) return;
    const rect = hostRef.current?.getBoundingClientRect();
    const fresh = burst({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
    setSparks((list) => [...list, ...fresh]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setSparks((list) => list.filter((s) => !fresh.includes(s)));
    }, SPARK_MS);
    timers.current.add(timer);
  };

  return (
    <span ref={hostRef} className="shs-spark-host" onClickCapture={onClickCapture}>
      {children}
      {sparks.map((s) => (
        <i key={s.id} aria-hidden className="shs-spark"
          style={{ left: s.x - 3, top: s.y - 3, background: s.color, "--dx": `${s.dx}px`, "--dy": `${s.dy}px` } as CSSProperties} />
      ))}
    </span>
  );
}
```

- [ ] **Step 3:** `yarn web:typecheck` 然后 `cd web && yarn vitest run src/features/practice/shadow/word-tap.test.ts src/features/practice/shadow/shadow-fx.test.tsx src/architecture.test.ts` → 全绿。
- [ ] **Step 4: 提交** `feat(web): shadow sheet word tap and effects helpers`。

---

## Task 4:懒加载文案 + 结果组件 `ShadowResult`

**Files:** Create `web/src/features/practice/shadow/{shadow-locales.ts,shadow-locales.test.ts,shadow-result.tsx,shadow-result.test.tsx}`、`shadow/locales/en.json`、`shadow/locales/zh-CN.json`。

- [ ] **Step 1(文案):** Create `web/src/features/practice/shadow/locales/en.json`:

```json
{
  "web": {
    "practice": {
      "shadow": {
        "title": "Read aloud",
        "position": "{{n}} / {{total}}",
        "close": "Close",
        "reference": "Sentence",
        "prev": "Previous",
        "next": "Next",
        "hint": "Listen first, then tap Record and read along (up to 1 minute).",
        "listen": "Listen",
        "listening": "Playing",
        "listenUnavailable": "Listening is unavailable right now (could not load the voice settings).",
        "record": "Record",
        "retryRecord": "Try recording again",
        "stop": "Stop",
        "recording": "Recording",
        "assessing": "Assessing",
        "assessingLong": "Assessing · comparing word by word",
        "keptNote": "Your last recording was kept.",
        "assessKept": "Assess this recording",
        "discard": "Record again",
        "noSpeech": "No sound was picked up. Please speak up and try again.",
        "total": "Score",
        "wordsTitle": "Word by word · tap a word to look it up",
        "tip": {
          "good": "Clear and steady. Keep this rhythm.",
          "fair": "Close. Try once more, a little slower and clearer.",
          "weak": "{{words}} need work. Tap a word to look it up or listen, then try again."
        },
        "mine": "My recording",
        "stopMine": "Stop",
        "standard": "Standard",
        "fav": "Save",
        "faved": "Saved",
        "again": "Try again",
        "nextSentence": "Next sentence",
        "done": "Done",
        "details": "View full details",
        "confirm": {
          "title": "Discard this recording?",
          "body": "There is no score yet. Closing will discard this recording.",
          "keep": "Keep going",
          "drop": "Discard"
        }
      }
    }
  }
}
```

Create `web/src/features/practice/shadow/locales/zh-CN.json`:

```json
{
  "web": {
    "practice": {
      "shadow": {
        "title": "跟读",
        "position": "{{n}} / {{total}}",
        "close": "关闭",
        "reference": "参考句子",
        "prev": "上一句",
        "next": "下一句",
        "hint": "先听一遍范读,再点「录音」跟着说(最长 1 分钟)。",
        "listen": "听范读",
        "listening": "播放中",
        "listenUnavailable": "暂时无法使用范读(未能加载语音设置)。",
        "record": "录音",
        "retryRecord": "重试录音",
        "stop": "停止",
        "recording": "正在录音",
        "assessing": "评测中",
        "assessingLong": "评测中 · 正在逐词对比发音",
        "keptNote": "上一次的录音已保留,不会丢失。",
        "assessKept": "评测这段录音",
        "discard": "重录",
        "noSpeech": "没听到声音,请大声一点再试一次。",
        "total": "总分",
        "wordsTitle": "逐词 · 点单词查词",
        "tip": {
          "good": "很稳。保持这个节奏。",
          "fair": "接近了。放慢一点、读清楚一点,再试一次。",
          "weak": "{{words}} 读得不准。点单词可以查词或听发音,再练一次试试。"
        },
        "mine": "我的录音",
        "stopMine": "停止",
        "standard": "标准发音",
        "fav": "收藏",
        "faved": "已收藏",
        "again": "再练一次",
        "nextSentence": "下一句",
        "done": "完成",
        "details": "查看完整详情",
        "confirm": {
          "title": "放弃这次录音?",
          "body": "还没出成绩,关闭后这次录音会被丢弃。",
          "keep": "继续",
          "drop": "放弃"
        }
      }
    }
  }
}
```

Create `web/src/features/practice/shadow/shadow-locales.ts`:

```ts
import i18n from "~/i18n";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

/**
 * 跟读弹窗的界面文案不进主包(R-S09):`**\/i18n/*.json` 由 i18n/index.ts 急切合并,这里的 locales/ 不在那个 glob 里。
 * 懒块里每个用到 web.practice.shadow.* 的模块都 `import "./shadow-locales"`,求值时并入 i18next(深合并,不覆盖已有键)。
 */
let loaded = false;
export function ensureShadowI18n(): void {
  if (loaded) return;
  loaded = true;
  i18n.addResourceBundle("en", "translation", en, true, false);
  i18n.addResourceBundle("zh-CN", "translation", zh, true, false);
}

ensureShadowI18n();
```

Create `web/src/features/practice/shadow/shadow-locales.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(here, rel), "utf8");

function flatten(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
}

describe("shadow sheet copy", () => {
  it("has the same keys in English and Chinese", () => {
    expect(flatten(zh).sort()).toEqual(flatten(en).sort());
  });

  it("defines every literal web.practice.shadow.* key the lazy sources use", () => {
    const keys = new Set(flatten(en));
    for (const file of ["shadow-sheet.tsx", "shadow-result.tsx"]) {
      for (const m of read(file).matchAll(/"web\.practice\.shadow\.([A-Za-z.]+)"/g)) {
        expect(keys.has(`web.practice.shadow.${m[1]}`), `${file}: ${m[1]}`).toBe(true);
      }
    }
    for (const kind of ["good", "fair", "weak"]) expect(keys.has(`web.practice.shadow.tip.${kind}`)).toBe(true);
  });

  it("is not in the eager i18n files (it must stay out of the main bundle)", () => {
    expect(read("../i18n/en.json")).not.toContain("shadow");
    expect(read("../i18n/zh-CN.json")).not.toContain("shadow");
  });

  it("registers both languages when the module is imported", async () => {
    await import("./shadow-locales");
    expect(i18n.t("web.practice.shadow.title", { lng: "en" })).toBe("Read aloud");
    expect(i18n.t("web.practice.shadow.title", { lng: "zh-CN" })).toBe("跟读");
    expect(i18n.t("web.practice.shadow.position", { lng: "en", n: 2, total: 3 })).toBe("2 / 3");
  });
});
```
(`shadow-sheet.tsx` 此时是骨架、没有 `web.practice.shadow.` 键,该用例仍通过;Task 5 之后它会真正检查。)

- [ ] **Step 2(结果组件测试,红):** Create `web/src/features/practice/shadow/shadow-result.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssessmentScores, AssessmentWordBrief } from "../assessment-api";
import { ShadowResult, type ShadowResultProps } from "./shadow-result";

const REFERENCE = "Could I get a medium latte, please?";
const SCORES: AssessmentScores = { pronunciationScore: 82, accuracyScore: 80, fluencyScore: 85, completenessScore: 100 };
const WORDS: AssessmentWordBrief[] = [
  { word: "Could", accuracyScore: 95, errorType: "None" },
  { word: "I", accuracyScore: 95, errorType: "None" },
  { word: "get", accuracyScore: 75, errorType: "None" },
  { word: "a", accuracyScore: 95, errorType: "None" },
  { word: "medium", accuracyScore: 40, errorType: "Mispronunciation" },
  { word: "latte", accuracyScore: 50, errorType: "Mispronunciation" },
  { word: "please", accuracyScore: 90, errorType: "None" },
];

function setup(over: Partial<ShadowResultProps> = {}) {
  const fns = {
    onToggleMine: vi.fn(), onListen: vi.fn(), onFav: vi.fn(), onAgain: vi.fn(), onContinue: vi.fn(), onDetails: vi.fn(),
  };
  const view = render(
    <ShadowResult reference={REFERENCE} scores={SCORES} words={WORDS} mineUrl="blob:mine" playingMine={false}
      listenState="idle" canListen faved={false} favBusy={false} nextKind="next" {...fns} {...over} />,
  );
  return { ...fns, view };
}

describe("ShadowResult", () => {
  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.documentElement.classList.remove("lite");
  });

  it("shows the ring with the score tone and three sub-score bars with their own tones", () => {
    setup();
    const ring = screen.getByTestId("shadow-ring");
    expect(ring).toHaveAttribute("data-score", "82");
    expect(ring).toHaveAttribute("data-tone", "fair");
    const bars = screen.getAllByTestId("shadow-bar");
    expect(bars.map((b) => b.getAttribute("data-tone"))).toEqual(["fair", "good", "good"]);
    expect(bars[0]).toHaveTextContent("80");
    expect(bars[2]).toHaveTextContent("100");
  });

  it("rolls the ring number only when motion is allowed (final value otherwise)", () => {
    document.documentElement.classList.add("lite");
    setup();
    expect(screen.getByTestId("shadow-ring")).toHaveTextContent("82");
  });

  it("colours the words by score tone; punctuation stays outside the word spans", () => {
    setup();
    const words = screen.getByTestId("shadow-words");
    expect(words).toHaveAttribute("data-lookup-context");
    expect(words.textContent).toBe(REFERENCE);
    expect(within(words).getByText("Could")).toHaveAttribute("data-tone", "good");
    expect(within(words).getByText("get")).toHaveAttribute("data-tone", "fair");
    expect(within(words).getByText("medium")).toHaveAttribute("data-tone", "low");
    expect(within(words).getByText("latte")).toHaveAttribute("data-tone", "low");
    expect(within(words).queryByText("latte,")).toBeNull();
  });

  it("tapping a word selects exactly that word so the lookup bar can open", () => {
    setup();
    fireEvent.click(within(screen.getByTestId("shadow-words")).getByText("medium"));
    expect(window.getSelection()!.toString()).toBe("medium");
  });

  it("explains the weak words, praises a clean run, and nudges the in-between", () => {
    const { view } = setup();
    expect(screen.getByTestId("shadow-tip")).toHaveAttribute("data-kind", "weak");
    expect(screen.getByTestId("shadow-tip")).toHaveTextContent("medium, latte");
    view.unmount();
    setup({ scores: { ...SCORES, pronunciationScore: 92 }, words: WORDS.map((w) => ({ ...w, accuracyScore: 95, errorType: "None" })) });
    expect(screen.getByTestId("shadow-tip")).toHaveAttribute("data-kind", "good");
  });

  it("wires every action", async () => {
    const fns = setup();
    await userEvent.click(screen.getByTestId("shadow-mine"));
    await userEvent.click(screen.getByTestId("shadow-standard"));
    await userEvent.click(screen.getByTestId("shadow-fav"));
    await userEvent.click(screen.getByTestId("shadow-again"));
    await userEvent.click(screen.getByTestId("shadow-continue"));
    await userEvent.click(screen.getByTestId("shadow-details"));
    expect(fns.onToggleMine).toHaveBeenCalledTimes(1);
    expect(fns.onListen).toHaveBeenCalledTimes(1);
    expect(fns.onFav).toHaveBeenCalledTimes(1);
    expect(fns.onAgain).toHaveBeenCalledTimes(1);
    expect(fns.onContinue).toHaveBeenCalledTimes(1);
    expect(fns.onDetails).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("shadow-continue")).toHaveTextContent("Next sentence");
  });

  it("disables my recording without audio, shows it playing, and locks the saved star", () => {
    setup({ mineUrl: null });
    expect(screen.getByTestId("shadow-mine")).toBeDisabled();
    document.body.innerHTML = "";
    setup({ playingMine: true, faved: true, nextKind: "done", listenState: "playing" });
    expect(screen.getByTestId("shadow-mine")).toHaveAttribute("data-state", "playing");
    expect(screen.getByTestId("shadow-fav")).toBeDisabled();
    expect(screen.getByTestId("shadow-fav")).toHaveTextContent("Saved");
    expect(screen.getByTestId("shadow-continue")).toHaveTextContent("Done");
    expect(screen.getByTestId("shadow-standard")).toHaveAttribute("data-state", "playing");
  });

  it("cannot play the standard voice when there is no TTS configured", () => {
    setup({ canListen: false });
    expect(screen.getByTestId("shadow-standard")).toBeDisabled();
  });
});
```

运行 `cd web && yarn vitest run src/features/practice/shadow/shadow-locales.test.ts src/features/practice/shadow/shadow-result.test.tsx` → 红(`shadow-result` 不存在)。

- [ ] **Step 3(实现):** Create `web/src/features/practice/shadow/shadow-result.tsx`:

```tsx
import { ArrowUpRightIcon, ChevronRightIcon, LightbulbIcon, LoaderIcon, PlayIcon, RotateCcwIcon, ScanTextIcon, SparklesIcon, SquareIcon, StarIcon, Volume2Icon } from "lucide-react";
import { Fragment, useMemo, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { scoreTone } from "~/components/score-tone";
import { cn } from "~/lib/cn";
import type { AssessmentScores, AssessmentWordBrief } from "../assessment-api";
import "./shadow-locales";
import { ClickSpark, useCountUp } from "./shadow-fx";
import { lowWords, selectWord, tipFor, tokenizeSentence, wordTones } from "./word-tap";

const clamp = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
const rise = (n: number) => ({ "--d": n }) as CSSProperties;

/** 评分环:两个半圆各转一个角度(不重绘渐变);数字用 CountUp 滚动,终值放在 sr-only 里给读屏与测试。 */
export function ScoreRing({ score, caption, animate }: { score: number; caption: string; animate?: boolean }) {
  const value = useCountUp(score, { enabled: animate });
  const tone = scoreTone(score);
  const deg = (360 * value) / 100;
  return (
    <div className="shs-ring" data-testid="shadow-ring" data-score={Math.round(score)} data-tone={tone}>
      <div className="shs-ring-trk" />
      <div className="shs-ring-half shs-ring-half--r"><i style={{ transform: `rotate(${Math.min(deg, 180)}deg)` }} /></div>
      <div className="shs-ring-half shs-ring-half--l"><i style={{ transform: `rotate(${Math.max(0, deg - 180)}deg)` }} /></div>
      <b className={cn("shs-ring-num num", tone === "good" && "shs-gt")} aria-hidden>{Math.round(value)}</b>
      <span className="sr-only">{Math.round(score)}</span>
      <small aria-hidden>{caption}</small>
    </div>
  );
}

export interface ShadowResultProps {
  reference: string;
  scores: AssessmentScores;
  words: AssessmentWordBrief[];
  /** 本次评测的 WAV(blob URL);没有时「我的录音」不可用 */
  mineUrl: string | null;
  playingMine: boolean;
  /** 「标准发音」(与「听范读」同一个 TTS 键) */
  listenState: "idle" | "loading" | "playing" | "error";
  canListen: boolean;
  faved: boolean;
  favBusy: boolean;
  /** 单句入口 / 最后一句 = done;还有下一句 = next */
  nextKind: "next" | "done";
  onToggleMine(): void;
  onListen(): void;
  onFav(): void;
  onAgain(): void;
  onContinue(): void;
  onDetails(): void;
}

/**
 * 弹窗里的简化结果(spec §3.1、D3):评分环 + 三条分数条 + 行内逐词着色(点词查词,不带波形)+ 一句话提示 +
 * 我的录音 / 标准发音 / 收藏 + 再练一次 / 下一句(完成)+ 查看完整详情。评分色沿用 score-tone(≥85 绿 / 70–84 琥珀 / <70 灰)。
 * 每次评分由调用方以 assessmentId 作 key 重新挂载,所以入场动画每次都重放。
 */
export function ShadowResult({
  reference, scores, words, mineUrl, playingMine, listenState, canListen, faved, favBusy, nextKind,
  onToggleMine, onListen, onFav, onAgain, onContinue, onDetails,
}: ShadowResultProps) {
  const { t } = useTranslation();
  const main = clamp(scores.pronunciationScore);
  const tokens = useMemo(() => tokenizeSentence(reference), [reference]);
  const tones = useMemo(() => wordTones(tokens, words), [tokens, words]);
  const tip = tipFor(main, lowWords(tokens, tones));
  const stats = [
    ["accuracyScore", scores.accuracyScore],
    ["fluencyScore", scores.fluencyScore],
    ["completenessScore", scores.completenessScore],
  ] as const;
  const TipIcon = tip.kind === "good" ? SparklesIcon : LightbulbIcon;

  return (
    <div data-testid="shadow-result">
      <div className="shs-score shs-tint shs-rise" style={rise(0)}>
        <ScoreRing score={main} caption={t("web.practice.shadow.total")} />
        <div className="shs-bars">
          {stats.map(([key, value], i) => {
            const v = clamp(value);
            return (
              <div key={key} className="shs-bar" data-testid="shadow-bar" data-tone={scoreTone(v)}>
                <div className="shs-bar-l"><span>{t(`models.pronunciationAssessment.${key}`)}</span><b className="num">{Math.round(v)}</b></div>
                <div className="shs-bar-t"><b style={{ "--v": v / 100, "--d": i } as CSSProperties} /></div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="shs-words shs-tint shs-rise" style={rise(1)}>
        <div className="shs-eyebrow"><ScanTextIcon aria-hidden />{t("web.practice.shadow.wordsTitle")}</div>
        <p data-testid="shadow-words" data-lookup-context className="shs-sel">
          {tokens.map((tok, i) =>
            tok.word < 0 ? (
              <Fragment key={i}>{tok.text}</Fragment>
            ) : (
              <span key={i} data-word={tok.word} data-tone={tones[tok.word] ?? "none"} className="shs-wd"
                style={{ "--d": tok.word } as CSSProperties} onClick={(e) => selectWord(e.currentTarget)}>
                {tok.text}
              </span>
            ),
          )}
        </p>
      </div>

      <div className="shs-tip shs-rise" data-testid="shadow-tip" data-kind={tip.kind} style={rise(2)}>
        <TipIcon aria-hidden />
        <div>{t(`web.practice.shadow.tip.${tip.kind}`, { words: tip.words.join(", ") })}</div>
      </div>

      <div className="shs-mini shs-rise" style={rise(3)}>
        <button type="button" data-testid="shadow-mine" data-state={playingMine ? "playing" : "idle"}
          className="shs-chip shs-chip--blue" disabled={!mineUrl} onClick={onToggleMine}>
          {playingMine ? <SquareIcon aria-hidden /> : <PlayIcon aria-hidden />}
          {playingMine ? t("web.practice.shadow.stopMine") : t("web.practice.shadow.mine")}
        </button>
        <button type="button" data-testid="shadow-standard" data-state={listenState} className="shs-chip shs-tint"
          disabled={!canListen && listenState !== "playing"} onClick={onListen}>
          {listenState === "loading" ? <LoaderIcon aria-hidden className="shs-spin" /> : listenState === "playing" ? <SquareIcon aria-hidden /> : <Volume2Icon aria-hidden />}
          {t("web.practice.shadow.standard")}
        </button>
        <ClickSpark disabled={faved || favBusy}>
          <button type="button" data-testid="shadow-fav" className={cn("shs-chip shs-tint", faved && "shs-chip--faved")}
            disabled={faved || favBusy} onClick={onFav}>
            <StarIcon aria-hidden className={faved ? "fill-current" : undefined} />
            {faved ? t("web.practice.shadow.faved") : t("web.practice.shadow.fav")}
          </button>
        </ClickSpark>
      </div>

      <div className="shs-foot shs-rise" style={rise(4)}>
        <button type="button" data-testid="shadow-again" className="shs-btn shs-btn--ghost shs-tint" onClick={onAgain}>
          <RotateCcwIcon aria-hidden />{t("web.practice.shadow.again")}
        </button>
        <button type="button" data-testid="shadow-continue" data-kind={nextKind} className="shs-btn shs-btn--primary" onClick={onContinue}>
          {nextKind === "next" ? t("web.practice.shadow.nextSentence") : t("web.practice.shadow.done")}
          <ChevronRightIcon aria-hidden />
        </button>
      </div>

      <button type="button" data-testid="shadow-details" className="shs-link shs-rise" style={rise(5)} onClick={onDetails}>
        {t("web.practice.shadow.details")}<ArrowUpRightIcon aria-hidden />
      </button>
    </div>
  );
}
```

- [ ] **Step 4:** `yarn web:typecheck` 然后 `cd web && yarn vitest run src/features/practice/shadow/shadow-locales.test.ts src/features/practice/shadow/shadow-result.test.tsx src/architecture.test.ts` → 全绿。(`shadow-locales.test.ts` 里读 `../i18n/en.json` 断言不含 `shadow`:确认主 i18n 文件里没有这个词;若有现成键恰好含 "shadow"(如 `web.practice.home.shadowing` 含子串 `shadow`!),把断言改成 `not.toContain('"shadow":')`。**这是已知的会触发的情况**:`en.json` 里 `"shadowing": "Read aloud"` 含子串 "shadow",请直接用 `not.toContain('"shadow"')`(带引号)。)
- [ ] **Step 5: 提交** `feat(web): shadow sheet result component and lazy copy`。

---

## Task 5:弹窗本体(全部状态)替换骨架

**Files:** Replace `web/src/features/practice/shadow/shadow-sheet.tsx`(用 Write 整体覆盖 Task 2 的骨架);Create `web/src/features/practice/shadow/shadow-sheet.test.tsx`。

- [ ] **Step 1(测试,红):** Create `web/src/features/practice/shadow/shadow-sheet.test.tsx`:

```tsx
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFakeRecorderEnv } from "~/test/fake-media";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import type { ShadowRequest } from "./shadow-context";
import { ShadowSheet } from "./shadow-sheet";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

vi.mock("~/audio/convert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/audio/convert")>()),
  toAssessmentWav: vi.fn(async () => ({ wav: new Blob(["RIFF"], { type: "audio/wav" }), durationMs: 1000 })),
}));

const CONFIG_ROUTES: Record<string, Handler> = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy"] } } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
};

const REFERENCE = "Could I get a medium latte, please?";
const LIST = ["Try saying it politely.", "It sounds natural.", "Make it oat milk, if possible."];
const ASSESSED = {
  pronunciation_score: 88, accuracy_score: 80, fluency_score: 85, completeness_score: 100, assessment_id: "a1",
  detail_result: {
    words: [
      { word: "Could", pronunciation_assessment: { accuracy_score: 95, error_type: "None" } },
      { word: "I", pronunciation_assessment: { accuracy_score: 95, error_type: "None" } },
      { word: "get", pronunciation_assessment: { accuracy_score: 75, error_type: "None" } },
      { word: "a", pronunciation_assessment: { accuracy_score: 95, error_type: "None" } },
      { word: "medium", pronunciation_assessment: { accuracy_score: 40, error_type: "Mispronunciation" } },
      { word: "latte", pronunciation_assessment: { accuracy_score: 50, error_type: "Mispronunciation" } },
      { word: "please", pronunciation_assessment: { accuracy_score: 90, error_type: "None" } },
    ],
  },
};

function setup(options: {
  request?: Partial<ShadowRequest>; routes?: Record<string, Handler>; env?: Parameters<typeof createFakeRecorderEnv>[0]; onClose?: () => void;
} = {}) {
  const mock = createFetchMock({ ...CONFIG_ROUTES, ...options.routes });
  const fake = createFakeRecorderEnv(options.env);
  const onClose = options.onClose ?? vi.fn();
  const request: ShadowRequest = { id: 1, items: [REFERENCE], index: 0, source: "chat", ...options.request };
  const view = renderWithProviders(<ShadowSheet request={request} onClose={onClose} recorderEnv={fake.env} />, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat/c1",
  });
  return { mock, fake, onClose, view };
}

const assessCalls = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.url.pathname === "/api/speech/assessments");
const ASSESS_OK: Record<string, Handler> = { "POST /api/speech/assessments": () => json(ASSESSED) };

async function recordAndStop() {
  await userEvent.click(screen.getByTestId("shadow-record"));
  await userEvent.click(await screen.findByTestId("shadow-stop"));
}

describe("ShadowSheet", () => {
  beforeEach(() => {
    localStorage.clear();
    resetServerAiConfigCache();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:mine"), revokeObjectURL: vi.fn() });
    Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
  });

  it("shows the sentence as a lookup context, with no neighbours for a single sentence", () => {
    setup();
    expect(screen.getByTestId("shadow-sheet")).toHaveAttribute("data-phase", "idle");
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent(REFERENCE);
    expect(screen.getByTestId("shadow-reference")).toHaveAttribute("data-lookup-context");
    expect(screen.queryByTestId("shadow-position")).toBeNull();
    expect(screen.queryByTestId("shadow-prev")).toBeNull();
    expect(screen.queryByTestId("shadow-next")).toBeNull();
    expect(screen.getByTestId("shadow-hint")).toBeInTheDocument();
  });

  it("walks a sentence list with position, previous and next", async () => {
    setup({ request: { items: LIST, index: 0 } });
    expect(screen.getByTestId("shadow-position")).toHaveTextContent("1 / 3");
    expect(screen.getByTestId("shadow-prev")).toBeDisabled();
    await userEvent.click(screen.getByTestId("shadow-next"));
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent(LIST[1]);
    expect(screen.getByTestId("shadow-position")).toHaveTextContent("2 / 3");
    await userEvent.click(screen.getByTestId("shadow-next"));
    expect(screen.getByTestId("shadow-next")).toBeDisabled();
    await userEvent.click(screen.getByTestId("shadow-prev"));
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent(LIST[1]);
  });

  it("records, assesses with save=true and no source, and shows the result in place", async () => {
    const { mock } = setup({ routes: ASSESS_OK });
    await userEvent.click(screen.getByTestId("shadow-record"));
    expect(await screen.findByTestId("shadow-stop")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-sheet")).toHaveAttribute("data-phase", "recording");
    expect(screen.getByTestId("shadow-recording")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-timer")).toHaveTextContent("00:00");
    await userEvent.click(screen.getByTestId("shadow-stop"));
    expect(await screen.findByTestId("shadow-result")).toBeInTheDocument();
    const form = assessCalls(mock)[0].body as FormData;
    expect(form.get("reference")).toBe(REFERENCE);
    expect(form.get("language")).toBe("en-US");
    expect(form.get("save")).toBe("true");
    expect(form.get("source")).toBeNull();
    expect(screen.getByTestId("shadow-ring")).toHaveAttribute("data-score", "88");
    expect(screen.getByTestId("shadow-sheet")).toHaveAttribute("data-phase", "result");
    expect(screen.getByTestId("location")).toHaveTextContent("/chat/c1"); // 没有导航
  });

  it("pauses the selection bar and the sentence list while recording and assessing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setup({ request: { items: LIST, index: 1 }, routes: { "POST /api/speech/assessments": async () => { await gate; return json(ASSESSED); } } });
    await userEvent.click(screen.getByTestId("shadow-record"));
    await screen.findByTestId("shadow-stop");
    expect(screen.getByTestId("shadow-reference")).not.toHaveAttribute("data-lookup-context");
    expect(screen.getByTestId("shadow-prev")).toBeDisabled();
    expect(screen.getByTestId("shadow-next")).toBeDisabled();
    expect(screen.getByTestId("shadow-listen")).toBeDisabled();
    await userEvent.click(screen.getByTestId("shadow-stop"));
    expect(await screen.findByTestId("shadow-assessing")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-sheet")).toHaveAttribute("data-phase", "assessing");
    expect(screen.getByTestId("shadow-busy")).toBeDisabled();
    expect(screen.getByTestId("shadow-reference")).not.toHaveAttribute("data-lookup-context");
    await act(async () => { release(); });
    await screen.findByTestId("shadow-result");
  });

  it("explains microphone permission problems and offers to record again", async () => {
    setup({ env: { getUserMedia: async () => { throw Object.assign(new Error("x"), { name: "NotAllowedError" }); } } });
    await userEvent.click(screen.getByTestId("shadow-record"));
    expect(await screen.findByTestId("shadow-error")).toHaveTextContent("Microphone access was denied");
    expect(screen.getByTestId("shadow-sheet")).toHaveAttribute("data-phase", "error");
    expect(screen.getByTestId("shadow-record")).toHaveTextContent("Try recording again");
  });

  it("keeps the recording after a failed upload (translated error) and retries it", async () => {
    let attempt = 0;
    const { mock } = setup({
      routes: { "POST /api/speech/assessments": () => (++attempt === 1 ? json({ error: "Upstream unavailable" }, 502) : json(ASSESSED)) },
    });
    await recordAndStop();
    expect(await screen.findByTestId("shadow-error")).toHaveTextContent("assessment service is unavailable");
    expect(screen.getByTestId("shadow-error")).not.toHaveTextContent("Upstream");
    expect(screen.getByTestId("shadow-error")).toHaveTextContent("Your last recording was kept.");
    await userEvent.click(await screen.findByTestId("shadow-assess-kept"));
    expect(await screen.findByTestId("shadow-result")).toBeInTheDocument();
    expect(assessCalls(mock)).toHaveLength(2);
  });

  it("keeps audio recorded before going to the background and can discard it", async () => {
    const { mock, fake } = setup({ routes: ASSESS_OK });
    await userEvent.click(screen.getByTestId("shadow-record"));
    await screen.findByTestId("shadow-stop");
    await act(async () => fake.setHidden());
    expect(await screen.findByTestId("shadow-kept")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-error")).toHaveTextContent("went to the background");
    await userEvent.click(screen.getByTestId("shadow-discard"));
    expect(screen.queryByTestId("shadow-kept")).toBeNull();
    expect(screen.getByTestId("shadow-sheet")).toHaveAttribute("data-phase", "idle");
    expect(assessCalls(mock)).toHaveLength(0);
  });

  it("reads the sentence with the server default voice, and stops the reading when recording starts", async () => {
    const { mock } = setup({
      request: { items: ["Listen test sentence one."] },
      routes: { "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])) },
    });
    await waitFor(() => expect(screen.getByTestId("shadow-listen")).toBeEnabled());
    await userEvent.click(screen.getByTestId("shadow-listen"));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled(); // 静音解锁先于合成完成
    await waitFor(() => expect(screen.getByTestId("shadow-listen")).toHaveAttribute("data-state", "playing"));
    const body = JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/ai/audio/speech")!.body as string);
    expect(body).toEqual({ input: "Listen test sentence one.", model: "openai/tts-1", voice: "alloy" });
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    await userEvent.click(screen.getByTestId("shadow-record"));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("shadow-listen")).toHaveAttribute("data-state", "idle"));
  });

  it("explains when the voice settings cannot load, and still records", async () => {
    setup({
      routes: {
        "GET /api/config/gpt_providers": () => json({ error: "x" }, 500),
        "GET /api/config/default_gpt_preset": () => json({ error: "x" }, 500),
        "GET /api/config/tts_providers_v2": () => json({ error: "x" }, 500),
        "GET /api/config/default_tts_preset": () => json({ error: "x" }, 500),
        ...ASSESS_OK,
      },
    });
    expect(await screen.findByTestId("shadow-listen-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-listen")).toBeDisabled();
    await recordAndStop();
    expect(await screen.findByTestId("shadow-result")).toBeInTheDocument();
  });

  it("shows a translated toast, never the raw text, when the speech request fails", async () => {
    setup({ request: { items: ["Toast test sentence."] }, routes: { "POST /api/ai/audio/speech": () => json({ error: "boom" }, 500) } });
    await waitFor(() => expect(screen.getByTestId("shadow-listen")).toBeEnabled());
    await userEvent.click(screen.getByTestId("shadow-listen"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error).mock.calls[0][0]).not.toMatch(/^web\./);
    expect(vi.mocked(toast.error).mock.calls[0][0]).not.toContain("boom");
  });

  it("the result actions: save, standard voice, my recording, try again", async () => {
    const { mock } = setup({
      request: { source: "grammar" },
      routes: {
        ...ASSESS_OK,
        "POST /api/practice-items": () => json({ id: "p1", text: REFERENCE, source: "grammar", created_at: "t" }),
        "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])),
      },
    });
    await recordAndStop();
    await screen.findByTestId("shadow-result");

    await userEvent.click(screen.getByTestId("shadow-fav"));
    await waitFor(() => expect(screen.getByTestId("shadow-fav")).toBeDisabled());
    expect(screen.getByTestId("shadow-fav")).toHaveTextContent("Saved");
    const saved = mock.calls.find((c) => c.url.pathname === "/api/practice-items")!;
    expect(JSON.parse(saved.body as string)).toEqual({ text: REFERENCE, source: "grammar" });
    expect(toast.success).toHaveBeenCalledWith("Saved to your practice list.");

    await userEvent.click(screen.getByTestId("shadow-mine"));
    expect(screen.getByTestId("shadow-mine")).toHaveAttribute("data-state", "playing");
    await userEvent.click(screen.getByTestId("shadow-mine"));
    expect(screen.getByTestId("shadow-mine")).toHaveAttribute("data-state", "idle");

    await userEvent.click(screen.getByTestId("shadow-standard"));
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/ai/audio/speech")).toBe(true));

    await userEvent.click(screen.getByTestId("shadow-again"));
    expect(screen.queryByTestId("shadow-result")).toBeNull();
    expect(screen.getByTestId("shadow-sheet")).toHaveAttribute("data-phase", "idle");
    expect(assessCalls(mock)).toHaveLength(1);
  });

  it("continues to the next sentence of a list and finishes on the last one", async () => {
    const { onClose } = setup({ request: { items: LIST, index: 1 }, routes: ASSESS_OK });
    await recordAndStop();
    await screen.findByTestId("shadow-result");
    expect(screen.getByTestId("shadow-continue")).toHaveAttribute("data-kind", "next");
    await userEvent.click(screen.getByTestId("shadow-continue"));
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent(LIST[2]);
    expect(screen.getByTestId("shadow-sheet")).toHaveAttribute("data-phase", "idle");
    await recordAndStop();
    await screen.findByTestId("shadow-result");
    expect(screen.getByTestId("shadow-continue")).toHaveAttribute("data-kind", "done");
    await userEvent.click(screen.getByTestId("shadow-continue"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a single sentence finishes with Done", async () => {
    const { onClose } = setup({ routes: ASSESS_OK });
    await recordAndStop();
    await screen.findByTestId("shadow-result");
    expect(screen.getByTestId("shadow-continue")).toHaveTextContent("Done");
    await userEvent.click(screen.getByTestId("shadow-continue"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens the full detail page after closing the sheet", async () => {
    const { onClose } = setup({ routes: ASSESS_OK });
    await recordAndStop();
    await screen.findByTestId("shadow-result");
    await userEvent.click(screen.getByTestId("shadow-details"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("location")).toHaveTextContent("/practice/assessments/a1");
  });

  it("moving to another sentence drops the previous result", async () => {
    setup({ request: { items: LIST, index: 0 }, routes: ASSESS_OK });
    await recordAndStop();
    await screen.findByTestId("shadow-result");
    await userEvent.click(screen.getByTestId("shadow-continue"));
    expect(screen.queryByTestId("shadow-result")).toBeNull();
    expect(screen.getByTestId("shadow-record")).toBeInTheDocument();
  });

  it("releases the microphone when unmounted mid-recording, and never leaks the text into the URL", async () => {
    const { fake, view, mock } = setup();
    await userEvent.click(screen.getByTestId("shadow-record"));
    await screen.findByTestId("shadow-stop");
    expect(fake.track.stop).not.toHaveBeenCalled();
    view.unmount();
    await waitFor(() => expect(fake.track.stop).toHaveBeenCalled());
    expect(mock.calls.every((c) => !decodeURIComponent(c.url.href).includes("latte"))).toBe(true);
  });
});
```

运行 `cd web && yarn vitest run src/features/practice/shadow/shadow-sheet.test.tsx` → 红(骨架没有这些东西)。

- [ ] **Step 2(实现,Write 整体覆盖 `shadow-sheet.tsx`):**

```tsx
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeftIcon, ChevronRightIcon, LoaderIcon, MicIcon, MicOffIcon, QuoteIcon, SparklesIcon, SquareIcon, Volume2Icon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type TouchEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import { claimAudio, releaseAudio } from "~/audio/audio-focus";
import type { RecorderEnv } from "~/audio/recorder";
import { useAuth } from "~/auth/auth-context";
import { ttsErrorMessage, useTtsPlayer } from "~/features/chat";
import { cn } from "~/lib/cn";
import { formatClock } from "~/lib/format-clock";
import { savePracticeItem } from "../save-practice-item";
import { useShadowSession } from "../use-shadow-session";
import type { ShadowRequest } from "./shadow-context";
import "./shadow-locales";
import { ShadowResult } from "./shadow-result";

/** 弹窗里的录音上限(R-S12):设计稿「最长 1 分钟」;练习页仍是 5 分钟 */
export const SHEET_MAX_MS = 60_000;
const SWIPE_CLOSE_PX = 60;
const rise = (n: number) => ({ "--d": n }) as CSSProperties;

/** 模拟波形(R-S13):34 根竖条,高度与节奏由下标确定性给出;正式的音量驱动留作后续 */
const WAVE = Array.from({ length: 34 }, (_, i) => ({
  h: (0.35 + 0.6 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.45))).toFixed(2),
  dur: (0.38 + ((i * 37) % 30) / 100).toFixed(2),
  delay: -(((i * 53) % 70) / 100),
}));

function Wave({ still = false }: { still?: boolean }) {
  return (
    <div className={cn("shs-wave", still && "shs-wave--still")} aria-hidden>
      {WAVE.map((b, i) => (
        <i key={i} style={{ "--h": b.h, animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s` } as CSSProperties} />
      ))}
    </div>
  );
}

/** 「我的录音」回放(R-S17):普通 <audio>,claimAudio 与 TTS 互斥;stop 是稳定的同一个函数(claimAudio / releaseAudio 按引用比较) */
function useMinePlayback() {
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const mounted = useRef(true);
  const stop = useCallback(function stopMine() {
    audio.current?.pause();
    releaseAudio(stopMine);
    if (mounted.current) setPlaying(false);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      audio.current?.pause();
      releaseAudio(stop);
    };
  }, [stop]);
  const toggle = useCallback((url: string | null) => {
    if (!url) return;
    if (playing) {
      stop();
      return;
    }
    const el = audio.current ?? new Audio();
    audio.current = el;
    el.onended = () => stop();
    el.src = url;
    claimAudio(stop);
    setPlaying(true);
    try {
      void Promise.resolve(el.play()).catch(() => stop());
    } catch {
      stop();
    }
  }, [playing, stop]);
  return { playing, toggle, stop };
}

export interface ShadowSheetProps {
  request: ShadowRequest;
  onClose(): void;
  /** 测试注入的录音环境 */
  recorderEnv?: RecorderEnv;
}

/**
 * 对话里的跟读弹窗(spec 2026-10-14-shadow-sheet;设计稿 shadow-sheet-v1/mockup-glass.html)。
 * 非模态 Radix Dialog + 自己的遮罩(R-S06):选词操作条(z-40)仍可点,查词抽屉(z-50)叠在弹窗之上。
 * 状态来自 useShadowSession(与练习页共用):待录音 / 录音中 / 评测中 / 出错(保留录音可重试)/ 结果。
 */
export function ShadowSheet({ request, onClose, recorderEnv }: ShadowSheetProps) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const tRef = useRef(t);
  tRef.current = t;
  const items = request.items;
  const [index, setIndex] = useState(Math.min(request.index, Math.max(0, items.length - 1)));
  const text = items[index] ?? "";
  const multi = items.length > 1;
  const isLast = !multi || index >= items.length - 1;

  const [ai, setAi] = useState<ServerAiConfig | null>(null);
  const [aiFailed, setAiFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadServerAiConfig(api).then((c) => { if (alive) setAi(c); }).catch((): void => { if (alive) setAiFailed(true); });
    return () => { alive = false; };
  }, [api]);

  // 范读:点击的同步阶段先播放静音解锁 <audio>(iOS);卸载时自动中止并暂停
  const tts = useTtsPlayer(api, {
    onError: (err) => toast.error(ttsErrorMessage(tRef.current, err)),
    onNothingToRead: () => toast.error(tRef.current("web.chat.nothingToRead")),
  });
  const stopTts = tts.stop;
  const mine = useMinePlayback();
  const stopMine = mine.stop;

  const session = useShadowSession({
    reference: text,
    recorderEnv,
    maxDurationMs: SHEET_MAX_MS,
    keepAudio: true,
    silenceError: t("web.practice.shadow.noSpeech"),
    beforeRecord: () => {
      stopTts(); // 不要把扬声器的范读 / 我的录音录进麦克风(iOS 音频路由)
      stopMine();
    },
  });
  const { reset } = session;

  const [faved, setFaved] = useState(false);
  const [favPending, setFavPending] = useState(false);
  const favLock = useRef(false);

  // 换句(上一句 / 下一句 / 完成后的下一句):丢弃一切,范读与我的录音停下
  useEffect(() => {
    reset();
    stopTts();
    stopMine();
    setFaved(false);
  }, [text, reset, stopTts, stopMine]);
  useEffect(() => {
    if (!session.mineUrl) stopMine();
  }, [session.mineUrl, stopMine]);

  const phase = session.phase;
  const busyNav = session.recording || session.busy || session.starting;
  const selectable = !busyNav; // 录音 / 评测中暂停选词操作条(没有 data-lookup-context,readSelection 读不到)
  const listenState = tts.states.reference ?? "idle";
  const hasVoice = !!ai?.defaultTts.model;
  const canListen = !!text && hasVoice && !busyNav;
  const listen = () => {
    if (!ai || !hasVoice) return;
    void tts.play("reference", text, ai.defaultTts.model, ai.defaultTts.voice); // 同步段内 prime;不要在这之前 await
  };

  const fav = async () => {
    if (favLock.current || faved) return;
    favLock.current = true;
    setFavPending(true);
    try {
      if (await savePracticeItem(api, t, text, request.source)) setFaved(true);
    } finally {
      favLock.current = false;
      setFavPending(false);
    }
  };

  const keptNotice = session.kept && (session.kept.stoppedBy === "background" || session.kept.stoppedBy === "track_ended")
    ? t(session.kept.stoppedBy === "background" ? "web.recorder.background" : "web.recorder.trackEnded", { seconds: Math.round(session.kept.durationMs / 1000) })
    : null;
  const errorText = session.error ?? keptNotice ?? "";

  const requestClose = () => onClose();

  const touchStart = useRef<number | null>(null);
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (start !== null && e.changedTouches[0].clientY - start > SWIPE_CLOSE_PX) requestClose();
  };

  const onContinue = () => {
    if (isLast) onClose();
    else setIndex(index + 1);
  };
  const openDetails = (assessmentId: string) => {
    onClose(); // 先关弹窗再导航
    navigate(`/practice/assessments/${assessmentId}`);
  };

  return (
    <DialogPrimitive.Root open modal={false} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <DialogPrimitive.Portal>
        <div data-testid="shadow-scrim" className="shs-root shs-scrim" aria-hidden onClick={requestClose} />
        <DialogPrimitive.Content data-testid="shadow-sheet" data-phase={phase} aria-describedby={undefined}
          className="shs-root shs-sheet"
          onInteractOutside={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}>
          <div className="shs-grab-zone" onTouchStart={(e) => { touchStart.current = e.touches[0].clientY; }} onTouchEnd={onTouchEnd}>
            <span className="shs-grab" aria-hidden />
          </div>
          <div className="shs-top">
            <DialogPrimitive.Title className="shs-title">
              {t("web.practice.shadow.title")}
              {multi && (
                <span data-testid="shadow-position" className="shs-pos shs-tint">
                  {t("web.practice.shadow.position", { n: index + 1, total: items.length })}
                </span>
              )}
            </DialogPrimitive.Title>
            <button type="button" data-testid="shadow-close" className="shs-x shs-tint" aria-label={t("web.practice.shadow.close")} onClick={requestClose}>
              <XIcon aria-hidden />
            </button>
          </div>

          <div className="shs-scroll">
            {phase === "result" && session.result ? (
              <ShadowResult
                key={session.result.assessmentId}
                reference={text}
                scores={session.result.scores}
                words={session.result.words}
                mineUrl={session.mineUrl}
                playingMine={mine.playing}
                listenState={listenState}
                canListen={hasVoice}
                faved={faved}
                favBusy={favPending}
                nextKind={isLast ? "done" : "next"}
                onToggleMine={() => mine.toggle(session.mineUrl)}
                onListen={listen}
                onFav={() => void fav()}
                onAgain={() => { reset(); stopTts(); stopMine(); setFaved(false); }}
                onContinue={onContinue}
                onDetails={() => openDetails(session.result!.assessmentId)}
              />
            ) : (
              <>
                <div className="shs-ref shs-tint shs-rise" style={rise(1)}>
                  <div className="shs-eyebrow"><QuoteIcon aria-hidden />{t("web.practice.shadow.reference")}</div>
                  <p data-testid="shadow-reference" className="shs-sel" {...(selectable ? { "data-lookup-context": true } : {})}>{text}</p>
                </div>

                {multi && (
                  <div className="shs-nav shs-rise" style={rise(2)}>
                    <button type="button" data-testid="shadow-prev" className="shs-nav-btn shs-tint" disabled={busyNav || index === 0}
                      onClick={() => setIndex(index - 1)}>
                      <ChevronLeftIcon aria-hidden />{t("web.practice.shadow.prev")}
                    </button>
                    {items.length <= 8 && (
                      <div className="shs-dots" aria-hidden>
                        {items.map((_, i) => <i key={i} className={cn("shs-dot", i === index && "shs-dot--on")} />)}
                      </div>
                    )}
                    <button type="button" data-testid="shadow-next" className="shs-nav-btn shs-tint" disabled={busyNav || index >= items.length - 1}
                      onClick={() => setIndex(index + 1)}>
                      {t("web.practice.shadow.next")}<ChevronRightIcon aria-hidden />
                    </button>
                  </div>
                )}

                {phase === "idle" && <p data-testid="shadow-hint" className="shs-hint shs-rise" style={rise(3)}>{t("web.practice.shadow.hint")}</p>}

                {phase === "recording" && (
                  <div data-testid="shadow-recording" className="shs-rec shs-tint shs-rise" style={rise(3)}>
                    <div className="shs-timer shs-timer--live">
                      <span className="shs-pulse" aria-hidden />
                      {t("web.practice.shadow.recording")}
                      <span data-testid="shadow-timer" className="shs-clock num">{formatClock(session.elapsedMs)} <small>/ {formatClock(SHEET_MAX_MS)}</small></span>
                    </div>
                    <div className="shs-prog"><b style={{ transform: `scaleX(${Math.min(1, session.elapsedMs / SHEET_MAX_MS)})` }} /></div>
                    <Wave />
                  </div>
                )}

                {phase === "assessing" && (
                  <div data-testid="shadow-assessing" className="shs-rec shs-tint shs-rise" style={rise(3)}>
                    <div className="shs-timer">
                      <SparklesIcon aria-hidden className="shs-timer-icon" />
                      <span className="shs-shiny">{t("web.practice.shadow.assessingLong")}</span>
                    </div>
                    <div className="shs-indet"><b /></div>
                    <Wave still />
                  </div>
                )}

                {phase === "error" && (
                  <div role="alert" data-testid="shadow-error" className="shs-err shs-rise" style={rise(3)}>
                    <MicOffIcon aria-hidden />
                    <div>
                      {errorText}
                      {session.kept && session.error && <div className="shs-err-sub">{t("web.practice.shadow.keptNote")}</div>}
                    </div>
                  </div>
                )}

                {phase === "error" && session.kept && !session.busy && (
                  <div data-testid="shadow-kept" className="shs-kept shs-rise" style={rise(4)}>
                    <button type="button" data-testid="shadow-assess-kept" className="shs-btn shs-btn--primary" onClick={() => void session.assessKept()}>
                      {t("web.practice.shadow.assessKept")}
                    </button>
                    <button type="button" data-testid="shadow-discard" className="shs-btn shs-btn--ghost shs-tint" onClick={session.discardKept}>
                      {t("web.practice.shadow.discard")}
                    </button>
                  </div>
                )}

                <div className="shs-btns shs-rise" style={rise(5)}>
                  <button type="button" data-testid="shadow-listen" data-state={listenState} className="shs-btn shs-btn--ghost shs-tint"
                    disabled={!canListen && listenState !== "playing"} onClick={listen}>
                    {listenState === "loading" ? <LoaderIcon aria-hidden className="shs-spin" />
                      : listenState === "playing" ? <span className="shs-eq" aria-hidden><b /><b /><b /></span> : <Volume2Icon aria-hidden />}
                    {listenState === "playing" ? t("web.practice.shadow.listening") : t("web.practice.shadow.listen")}
                  </button>
                  {session.recording ? (
                    <button type="button" data-testid="shadow-stop" className="shs-btn shs-btn--stop" onClick={() => void session.toggle()}>
                      <SquareIcon aria-hidden className="fill-current" />{t("web.practice.shadow.stop")}
                    </button>
                  ) : session.busy ? (
                    <button type="button" data-testid="shadow-busy" className="shs-btn shs-btn--primary" disabled>
                      <LoaderIcon aria-hidden className="shs-spin" />{t("web.practice.shadow.assessing")}
                    </button>
                  ) : (
                    <button type="button" data-testid="shadow-record" className="shs-btn shs-btn--primary" disabled={session.starting || !text}
                      onClick={() => void session.toggle()}>
                      <MicIcon aria-hidden />{phase === "error" ? t("web.practice.shadow.retryRecord") : t("web.practice.shadow.record")}
                    </button>
                  )}
                </div>
                {aiFailed && <p data-testid="shadow-listen-unavailable" className="shs-note">{t("web.practice.shadow.listenUnavailable")}</p>}
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
```

- [ ] **Step 3:** `yarn web:typecheck`;然后 `cd web && yarn vitest run src/features/practice/shadow src/features/practice/use-shadow-session.test.tsx src/features/practice/practice-page.test.tsx src/architecture.test.ts`。全绿(`shadow-context.test.tsx` 里读 `shadow-reference` 的几处仍成立;`shadow-locales.test.ts` 现在真正扫描 `shadow-sheet.tsx` 里的字面键)。若 jsdom 里 Radix 非模态 Dialog 的焦点 / `aria-hidden` 行为与预期不同,以真实报错修**测试的查询方式**(按 `data-testid`,不按 role),不要把弹窗改回模态(R-S06)。
- [ ] **Step 4: 提交** `feat(web): shadow sheet with record, assess and result states`。

---

## Task 6:玻璃样式 + 样式守卫测试

**Files:** Create `web/src/features/practice/shadow/shadow-sheet.css`、`shadow-css.test.ts`;Modify `web/src/features/practice/shadow/shadow-sheet.tsx`(只加一行 CSS 导入)。

- [ ] **Step 1(守卫测试,红):** Create `web/src/features/practice/shadow/shadow-css.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "shadow-sheet.css"), "utf8");
const sheet = readFileSync(path.join(here, "shadow-sheet.tsx"), "utf8");

/** 取 `header {` 之后配对大括号里的内容。 */
function blockOf(source: string, header: RegExp): string {
  const m = header.exec(source);
  if (!m) throw new Error(`missing block: ${header}`);
  const open = source.indexOf("{", m.index);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unbalanced block: ${header}`);
}
/** 从某个分节注释开始到下一个分节注释(或文件末尾)。 */
function sectionAfter(source: string, title: string): string {
  const start = source.indexOf(title);
  if (start < 0) throw new Error(`missing section: ${title}`);
  const next = source.indexOf("/* =====", start + title.length);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("shadow-sheet.css (spec §3.3, mockup-glass)", () => {
  it("is pulled in by the lazy sheet only", () => {
    expect(sheet).toContain('import "./shadow-sheet.css";');
  });

  it("defines the glass tokens from the mockup on .shs-root, light and dark", () => {
    const light = blockOf(css, /^\.shs-root\s*\{/m);
    expect(light).toContain("--shs-blur: 34px;");
    expect(light).toContain("--shs-glass-strong: rgba(255, 255, 255, 0.62);");
    expect(light).toContain("--shs-glass-bd: rgba(255, 255, 255, 0.85);");
    expect(light).toContain("--shs-scrim: rgba(10, 14, 28, 0.3);");
    const dark = blockOf(css, /^\.dark \.shs-root\s*\{/m);
    expect(dark).toContain("--shs-glass-strong: rgba(120, 140, 230, 0.17);");
    expect(dark).toContain("--shs-glass-bd: rgba(255, 255, 255, 0.26);");
    expect(dark).toContain("--shs-scrim: rgba(2, 4, 10, 0.52);");
  });

  it("blurs exactly one surface (the sheet) with saturate 200% and the iOS prefix", () => {
    expect((css.match(/^\s+-webkit-backdrop-filter:\s*blur/gm) ?? []).length).toBe(1);
    const sheetBlock = blockOf(css, /^\.shs-sheet\s*\{/m);
    expect(sheetBlock).toContain("-webkit-backdrop-filter: blur(var(--shs-blur)) saturate(2);");
    expect(sheetBlock).toContain("backdrop-filter: blur(var(--shs-blur)) saturate(2);");
    // 遮罩、卡片、按钮、芯片只用半透明填充 + 高光边
    for (const header of [/^\.shs-scrim\s*\{/m, /^\.shs-tint\s*\{/m, /^\.shs-btn\s*\{/m, /^\.shs-confirm\s*\{/m, /^\.shs-err\s*\{/m]) {
      expect(blockOf(css, header)).not.toContain("backdrop-filter");
    }
  });

  it("is scoped: no rule styles html, body, :root or * outside the lite fallbacks", () => {
    expect(css).not.toMatch(/^(body|:root|\*)\s*[,{]/m);
    expect(css).not.toMatch(/^html\s*[,{]/m);
    for (const line of css.split("\n").filter((l) => l.startsWith("html.lite"))) expect(line, line).toMatch(/^html\.lite \.shs-/);
  });

  it("animates only transform, opacity and background-position", () => {
    const names = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(8);
    for (const name of names) {
      const body = blockOf(css, new RegExp(`@keyframes\\s+${name}\\s*\\{`));
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect(["transform", "opacity", "background-position"], `${name} animates ${p}`).toContain(p);
    }
  });

  const ANIMATED = [
    ".shs-scrim", ".shs-sheet", ".shs-rise", ".shs-btn--primary::after", ".shs-btn--stop::before", ".shs-pulse::after",
    ".shs-timer--live .shs-clock", ".shs-wave i", ".shs-shiny", ".shs-indet b", ".shs-bar-t b", ".shs-wd", ".shs-spark", ".shs-eq b",
  ];

  it("stills every animation under prefers-reduced-motion and on low-end devices", () => {
    const reduced = blockOf(css, /@media \(prefers-reduced-motion: reduce\)\s*\{/);
    const lite = sectionAfter(css, "降级:低端机");
    for (const selector of ANIMATED) {
      expect(reduced, `reduced-motion: ${selector}`).toContain(selector);
      expect(lite, `lite: ${selector}`).toContain(selector);
    }
    expect(reduced).toContain("animation: none;");
    expect(lite).toContain("animation: none;");
  });

  it("falls back to a solid sheet without backdrop-filter, on low-end devices and with reduced transparency", () => {
    const unsupported = blockOf(css, /@supports not \(\(-webkit-backdrop-filter: blur\(1px\)\) or \(backdrop-filter: blur\(1px\)\)\)\s*\{/);
    expect(unsupported).toContain(".shs-sheet");
    expect(unsupported).toContain("var(--shs-solid)");
    const lite = sectionAfter(css, "降级:低端机");
    expect(lite).toContain("html.lite .shs-sheet");
    expect(lite).toMatch(/backdrop-filter: none;/);
    expect(lite).toContain("background: var(--shs-solid);");
    const transparency = blockOf(css, /@media \(prefers-reduced-transparency: reduce\)\s*\{/);
    expect(transparency).toContain(".shs-sheet");
    expect(transparency).toContain("backdrop-filter: none;");
  });

  it("only paints text with a gradient where background-clip: text exists (otherwise the text would vanish)", () => {
    const guarded = blockOf(css, /@supports \(\(-webkit-background-clip: text\) or \(background-clip: text\)\)\s*\{/);
    expect(guarded).toContain(".shs-shiny");
    expect(guarded).toContain(".shs-gt");
    expect(guarded).toContain("color: transparent;");
    expect(css.replace(guarded, "")).not.toContain("color: transparent;");
  });

  it("keeps the sheet below the selection bar (z-index 40) and the lookup drawer (50)", () => {
    const z = (re: RegExp) => Number(/z-index:\s*(\d+);/.exec(blockOf(css, re))?.[1]);
    expect(z(/^\.shs-scrim\s*\{/m)).toBeLessThan(40);
    expect(z(/^\.shs-sheet\s*\{/m)).toBeLessThan(40);
    expect(z(/^\.shs-sheet\s*\{/m)).toBeGreaterThan(z(/^\.shs-scrim\s*\{/m));
    expect(z(/^\.shs-scrim\s*\{/m)).toBeGreaterThan(30); // 盖住全站底栏(z-30)
  });

  it("makes the sheet receive taps even while a modal sheet is still animating out, and scroll itself under the viewport lock", () => {
    expect(blockOf(css, /^\.shs-scrim,\s*\.shs-sheet\s*\{/m)).toContain("pointer-events: auto;");
    const sheetBlock = blockOf(css, /^\.shs-sheet\s*\{/m);
    expect(sheetBlock).toContain("position: fixed;");
    expect(sheetBlock).toContain("85dvh");
    expect(sheetBlock).toContain("var(--app-height, 100dvh)");
    const scroll = blockOf(css, /^\.shs-scroll\s*\{/m);
    expect(scroll).toContain("overflow-y: auto;");
    expect(scroll).toContain("overscroll-behavior: contain;");
  });

  it("keeps the sentence text selectable so the lookup bar still works", () => {
    const sel = blockOf(css, /^\.shs-sel\s*\{/m);
    expect(sel).toContain("-webkit-user-select: text;");
    expect(sel).toContain("user-select: text;");
  });

  it("stays small", () => {
    expect(css.length).toBeLessThan(16_000);
  });
});
```

运行 `cd web && yarn vitest run src/features/practice/shadow/shadow-css.test.ts` → 红。

- [ ] **Step 2(样式):** Create `web/src/features/practice/shadow/shadow-sheet.css`:

```css
/*
 * 对话里的跟读弹窗视觉层(计划 2026-10-14-shadow-sheet;spec §3.3;设计稿 docs/superpowers/design/shadow-sheet-v1/mockup-glass.html)。
 * 随懒加载块进入(shadow-sheet.tsx 导入),不进主包、不改 theme.css。只在 .shs-root 内生效:Radix 把遮罩与弹窗渲染到 body 下,所以两者各自带 .shs-root。
 * 规则(shadow-css.test.ts 守着):一屏模糊层只有弹窗本身 1 层(全站底栏 + 对话顶栏已占 2 层,合计 3);遮罩、卡片、按钮、芯片只用半透明填充 + 高光边;
 * 动画只用 transform / opacity / background-position;弹窗 z-index 低于选词操作条(40)与查词抽屉(50);文末是 html.lite、prefers-reduced-motion、
 * prefers-reduced-transparency、不支持 backdrop-filter 的降级。深浅色跟随 html.dark。
 */

/* ===== 令牌(设计稿数值) ===== */
.shs-root {
  --shs-solid: #ffffff;
  --shs-glass-strong: rgba(255, 255, 255, 0.62);
  --shs-glass-bd: rgba(255, 255, 255, 0.85);
  --shs-glass-hi: inset 0 1px 0 rgba(255, 255, 255, 0.9), inset 0 -1px 0 rgba(255, 255, 255, 0.25);
  --shs-glass-sh: 0 18px 40px -12px rgba(20, 30, 70, 0.45);
  --shs-chip: rgba(255, 255, 255, 0.55);
  --shs-chip-hi: inset 0 1px 0 rgba(255, 255, 255, 0.35);
  --shs-hair: rgba(17, 19, 24, 0.1);
  --shs-scrim: rgba(10, 14, 28, 0.3);
  --shs-blue-tint: rgba(36, 86, 219, 0.12);
  --shs-green-tint: rgba(21, 122, 59, 0.11);
  --shs-amber-tint: rgba(154, 75, 0, 0.1);
  --shs-red-tint: rgba(209, 36, 47, 0.1);
  --shs-ink-2: 79 88 106;
  --shs-ink-3: 125 132 150;
  --shs-wave1: #2456db;
  --shs-wave2: #0e9c8e;
  --shs-blur: 34px;
  color: rgb(var(--ink));
}
.dark .shs-root {
  --shs-solid: #1a1d25;
  --shs-glass-strong: rgba(120, 140, 230, 0.17);
  --shs-glass-bd: rgba(255, 255, 255, 0.26);
  --shs-glass-hi: inset 0 1px 0 rgba(255, 255, 255, 0.38), inset 0 0 22px rgba(255, 255, 255, 0.05), inset 0 -1px 0 rgba(255, 255, 255, 0.08);
  --shs-glass-sh: 0 18px 44px -10px rgba(0, 0, 0, 0.7);
  --shs-chip: rgba(255, 255, 255, 0.09);
  --shs-chip-hi: inset 0 1px 0 rgba(255, 255, 255, 0.12);
  --shs-hair: rgba(255, 255, 255, 0.13);
  --shs-scrim: rgba(2, 4, 10, 0.52);
  --shs-blue-tint: rgba(143, 176, 255, 0.18);
  --shs-green-tint: rgba(110, 224, 154, 0.13);
  --shs-amber-tint: rgba(242, 176, 86, 0.13);
  --shs-red-tint: rgba(255, 122, 132, 0.14);
  --shs-ink-2: 179 185 200;
  --shs-ink-3: 134 141 160;
  --shs-wave1: #8fb0ff;
  --shs-wave2: #5fd1c4;
}

/* ===== 遮罩(只压暗,不模糊)与弹窗(悬浮的强玻璃板:四周留 10px,圆角 34) ===== */
.shs-scrim,
.shs-sheet {
  pointer-events: auto; /* 来源面板(模态)的退出动画期间 body 仍带 pointer-events:none */
}
.shs-scrim {
  position: fixed;
  inset: 0;
  z-index: 35;
  background: var(--shs-scrim);
  animation: shs-fade 0.35s ease both;
}
.shs-sheet {
  position: fixed;
  left: 10px;
  right: 10px;
  bottom: calc(10px + env(safe-area-inset-bottom));
  z-index: 36;
  width: auto;
  max-width: min(640px, calc(100% - 20px));
  margin: 0 auto;
  max-height: min(85dvh, calc(var(--app-height, 100dvh) - 24px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-top: 8px;
  border-radius: 34px;
  background: var(--shs-glass-strong);
  -webkit-backdrop-filter: blur(var(--shs-blur)) saturate(2);
  backdrop-filter: blur(var(--shs-blur)) saturate(2);
  border: 1px solid var(--shs-glass-bd);
  box-shadow: var(--shs-glass-hi), var(--shs-glass-sh);
  animation: shs-sheet-in 0.62s cubic-bezier(0.2, 0.9, 0.25, 1.06) both;
}
.shs-sheet:focus { outline: none; }
/* 顶部 120px 的淡高光渐变(纯背景,不是模糊) */
.shs-sheet::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 120px;
  pointer-events: none;
  border-radius: 34px 34px 0 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.22), transparent);
}
.dark .shs-sheet::before { background: linear-gradient(180deg, rgba(160, 180, 255, 0.1), transparent); }
@keyframes shs-fade { from { opacity: 0; } }
@keyframes shs-sheet-in { from { opacity: 0; transform: translateY(60px) scale(0.97); } }
@keyframes shs-rise-in { from { opacity: 0; transform: translateY(10px); } }
.shs-rise { animation: shs-rise-in 0.42s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay: calc(var(--d, 0) * 45ms); }

/* ===== 顶栏、抓手、位置、关闭 ===== */
.shs-grab-zone { position: relative; flex: none; display: flex; justify-content: center; height: 14px; padding-top: 2px; touch-action: none; }
.shs-grab { width: 40px; height: 4px; border-radius: 2px; background: var(--shs-hair); }
.shs-top { position: relative; flex: none; display: flex; align-items: center; justify-content: space-between; height: 44px; padding: 0 14px 0 18px; }
.shs-title { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 600; }
.shs-tint { background: var(--shs-chip); border: 1px solid var(--shs-hair); box-shadow: var(--shs-chip-hi); }
.shs-pos { display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: 11px; font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; color: rgb(var(--shs-ink-2)); }
.shs-x { position: relative; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; color: rgb(var(--shs-ink-2)); }
.shs-x::before { content: ""; position: absolute; inset: -4px; } /* 视觉 36px,命中区 44px */
.shs-x svg { width: 18px; height: 18px; }
.shs-scroll { position: relative; flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 2px 14px calc(16px + 0px); }
.shs-sel { -webkit-user-select: text; user-select: text; }

/* ===== 参考句卡、上一句 / 下一句、提示 ===== */
.shs-ref { border-radius: 22px; padding: 13px 15px 14px; margin-top: 2px; }
.shs-eyebrow { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; color: rgb(var(--shs-ink-2)); }
.shs-eyebrow svg { width: 13px; height: 13px; }
.shs-ref p { margin-top: 6px; font-size: 19px; font-weight: 500; line-height: 1.5; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.shs-nav { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
.shs-nav-btn { position: relative; display: flex; align-items: center; gap: 3px; height: 36px; padding: 0 12px; border-radius: 18px; font-size: 13px; color: rgb(var(--ink)); user-select: none; }
.shs-nav-btn::before { content: ""; position: absolute; inset: -4px -2px; }
.shs-nav-btn svg { width: 16px; height: 16px; }
.shs-nav-btn:disabled { opacity: 0.35; pointer-events: none; }
.shs-dots { display: flex; gap: 6px; }
.shs-dot { width: 6px; height: 6px; border-radius: 3px; background: var(--shs-hair); }
.shs-dot--on { width: 16px; background: rgb(var(--blue)); }
.shs-hint { margin-top: 12px; text-align: center; font-size: 12.5px; color: rgb(var(--shs-ink-2)); }
.shs-note { margin-top: 8px; text-align: center; font-size: 12px; color: rgb(var(--shs-ink-2)); }

/* ===== 按钮:主按钮(斜向高光扫过)、玻璃幽灵、红色停止(外散光晕) ===== */
.shs-btns,
.shs-foot,
.shs-kept { display: flex; gap: 8px; margin-top: 14px; }
.shs-foot { margin-top: 12px; }
.shs-kept { margin-top: 10px; }
.shs-btn {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 0;
  height: 52px;
  border-radius: 26px;
  font-size: 16px;
  font-weight: 600;
  color: rgb(var(--ink));
  user-select: none;
  transition: transform 0.12s;
}
.shs-btn:active { transform: scale(0.97); }
.shs-btn svg { width: 19px; height: 19px; flex: none; }
.shs-btn:disabled { opacity: 0.45; pointer-events: none; }
.shs-btn--primary,
.shs-btn--stop {
  overflow: hidden;
  color: #fff;
  background: linear-gradient(180deg, #4b78f0, #2456db);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 10px 24px -8px rgba(36, 86, 219, 0.65);
}
.dark .shs-btn--primary { background: linear-gradient(180deg, #6d93ff, #3a63e0); }
.shs-btn--primary::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 46%;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent);
  transform: translateX(-130%) skewX(-22deg);
  animation: shs-sweep 3.2s ease-in-out infinite;
}
.shs-btn--primary:disabled::after { animation: none; opacity: 0; }
@keyframes shs-sweep {
  0%, 55% { transform: translateX(-130%) skewX(-22deg); }
  100% { transform: translateX(330%) skewX(-22deg); }
}
.shs-btn--stop { overflow: visible; background: linear-gradient(180deg, #ff6b74, #d1242f); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 10px 24px -8px rgba(209, 36, 47, 0.7); }
.shs-btn--stop::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  border: 2px solid #ff6b74;
  pointer-events: none;
  animation: shs-halo 1.4s ease-out infinite;
}
@keyframes shs-halo { from { opacity: 0.7; transform: scale(1); } to { opacity: 0; transform: scale(1.12, 1.35); } }
.shs-eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; }
.shs-eq b { width: 3px; height: 14px; border-radius: 2px; background: currentColor; transform-origin: bottom; animation: shs-eq 0.8s ease-in-out infinite; }
.shs-eq b:nth-child(2) { animation-delay: -0.3s; }
.shs-eq b:nth-child(3) { animation-delay: -0.55s; }
@keyframes shs-eq { 0%, 100% { transform: scaleY(0.3); } 50% { transform: scaleY(1); } }
.shs-spin { animation: shs-spin 1s linear infinite; }
@keyframes shs-spin { to { transform: rotate(360deg); } }

/* ===== 录音中:脉冲计时 + 细进度 + 模拟波形;评测中:流光字 + 来回细进度 ===== */
.shs-rec { margin-top: 12px; border-radius: 20px; padding: 11px 14px 12px; }
.shs-timer { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: rgb(var(--shs-ink-2)); }
.shs-timer-icon { width: 15px; height: 15px; color: rgb(var(--blue)); }
.shs-clock { margin-left: auto; font-size: 15px; font-weight: 600; color: rgb(var(--ink)); }
.shs-clock small { font-size: 12px; font-weight: 500; color: rgb(var(--shs-ink-3)); }
.shs-timer--live .shs-clock { animation: shs-tick 1s ease-in-out infinite; }
@keyframes shs-tick { 50% { opacity: 0.6; } }
.shs-pulse { position: relative; flex: none; width: 9px; height: 9px; border-radius: 50%; background: rgb(var(--red)); }
.shs-pulse::after { content: ""; position: absolute; inset: 0; border-radius: 50%; background: rgb(var(--red)); animation: shs-ping 1.2s ease-out infinite; }
@keyframes shs-ping { from { opacity: 0.7; transform: scale(1); } to { opacity: 0; transform: scale(2.8); } }
.shs-prog { height: 3px; margin-top: 9px; overflow: hidden; border-radius: 2px; background: var(--shs-hair); }
.shs-prog b { display: block; height: 100%; border-radius: 2px; background: linear-gradient(90deg, rgb(var(--red)), rgb(var(--amber))); transform-origin: left; transform: scaleX(0); transition: transform 1s linear; }
.shs-wave { display: flex; align-items: center; justify-content: space-between; height: 40px; margin-top: 9px; }
.shs-wave i { width: 3px; height: 36px; border-radius: 2px; background: linear-gradient(180deg, var(--shs-wave1), var(--shs-wave2)); transform: scaleY(0.25); animation: shs-wv 1s ease-in-out infinite alternate; }
@keyframes shs-wv { 0% { transform: scaleY(0.18); } 100% { transform: scaleY(var(--h, 0.8)); } }
.shs-wave--still i { animation: none; transform: scaleY(var(--h, 0.5)); opacity: 0.35; }
.shs-shiny { font-weight: 600; color: rgb(var(--shs-ink-2)); }
.shs-indet { height: 3px; margin-top: 10px; overflow: hidden; border-radius: 2px; background: var(--shs-hair); }
.shs-indet b { display: block; width: 40%; height: 100%; border-radius: 2px; background: linear-gradient(90deg, transparent, rgb(var(--blue)), rgb(var(--teal)), transparent); animation: shs-ind 1.3s ease-in-out infinite; }
@keyframes shs-ind { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
@keyframes shs-shine { from { background-position: 130% 0; } to { background-position: -90% 0; } }

/* ===== 出错、保留录音 ===== */
.shs-err { display: flex; gap: 10px; margin-top: 12px; padding: 12px 13px; border-radius: 18px; font-size: 13.5px; line-height: 1.55; color: rgb(var(--red)); background: var(--shs-red-tint); border: 1px solid var(--shs-red-tint); }
.shs-err svg { width: 20px; height: 20px; flex: none; }
.shs-err-sub { margin-top: 3px; font-size: 12.5px; color: rgb(var(--shs-ink-2)); }

/* ===== 结果:评分环(两个半圆旋转)、分数条、逐词、提示、芯片、脚部 ===== */
.shs-score { display: flex; align-items: center; gap: 16px; margin-top: 2px; padding: 12px 14px; border-radius: 22px; }
.shs-ring { --rc: rgb(var(--green)); position: relative; display: grid; place-items: center; flex: none; width: 84px; height: 84px; }
.shs-ring[data-tone="fair"] { --rc: rgb(var(--amber)); }
.shs-ring[data-tone="low"] { --rc: rgb(var(--ink-3)); }
.shs-ring::before { content: ""; position: absolute; inset: -6px; border-radius: 50%; background: radial-gradient(closest-side, var(--rc), transparent); opacity: 0.18; }
.shs-ring-trk,
.shs-ring-half {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 8px), #000 calc(100% - 7.5px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 8px), #000 calc(100% - 7.5px));
}
.shs-ring-trk { background: var(--shs-hair); }
.shs-ring-half--r { clip-path: inset(0 0 0 50%); }
.shs-ring-half--l { clip-path: inset(0 50% 0 0); }
.shs-ring-half i { position: absolute; inset: 0; border-radius: 50%; background: var(--rc); }
.shs-ring-half--r i { clip-path: inset(0 50% 0 0); }
.shs-ring-half--l i { clip-path: inset(0 0 0 50%); }
.shs-ring-num { position: relative; font-size: 27px; font-weight: 700; letter-spacing: -0.02em; }
.shs-ring[data-tone="fair"] .shs-ring-num { color: rgb(var(--amber)); }
.shs-ring[data-tone="low"] .shs-ring-num { color: rgb(var(--shs-ink-2)); }
.shs-ring[data-tone="good"] .shs-ring-num { color: rgb(var(--green)); }
.shs-ring small { position: absolute; bottom: 17px; font-size: 9.5px; font-weight: 600; color: rgb(var(--shs-ink-3)); }
.shs-bars { flex: 1; min-width: 0; }
.shs-bar { margin-bottom: 8px; }
.shs-bar:last-child { margin-bottom: 0; }
.shs-bar-l { display: flex; justify-content: space-between; font-size: 12.5px; color: rgb(var(--shs-ink-2)); }
.shs-bar-l b { color: rgb(var(--ink)); }
.shs-bar-t { height: 6px; margin-top: 4px; overflow: hidden; border-radius: 3px; background: var(--shs-hair); }
.shs-bar-t b {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: rgb(var(--green));
  transform-origin: left;
  transform: scaleX(var(--v));
  animation: shs-bar-in 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  animation-delay: calc(var(--d, 0) * 90ms + 150ms);
}
.shs-bar[data-tone="fair"] .shs-bar-t b { background: rgb(var(--amber)); }
.shs-bar[data-tone="low"] .shs-bar-t b { background: rgb(var(--ink-3)); }
@keyframes shs-bar-in { from { transform: scaleX(0); } }
.shs-words { margin-top: 10px; padding: 8px 14px 10px; border-radius: 20px; font-size: 19px; font-weight: 500; line-height: 1.7; }
.shs-words .shs-eyebrow { margin-bottom: 2px; }
.shs-wd { display: inline-block; cursor: pointer; animation: shs-wd-in 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both; animation-delay: calc(var(--d, 0) * 55ms + 250ms); }
@keyframes shs-wd-in { from { opacity: 0; transform: translateY(8px); } }
.shs-wd[data-tone="good"] { color: rgb(var(--green)); }
.shs-wd[data-tone="fair"] { color: rgb(var(--amber)); }
/* 低分:灰色(spec §3.1)+ 波浪线,不只靠颜色 */
.shs-wd[data-tone="low"] { color: rgb(var(--shs-ink-2)); text-decoration: underline wavy; text-underline-offset: 4px; text-decoration-thickness: 1.5px; }
.shs-tip { display: flex; gap: 8px; margin-top: 8px; padding: 9px 12px; border-radius: 16px; font-size: 13px; line-height: 1.5; border: 1px solid transparent; }
.shs-tip svg { width: 16px; height: 16px; margin-top: 1px; flex: none; }
.shs-tip[data-kind="good"] { color: rgb(var(--green)); background: var(--shs-green-tint); border-color: var(--shs-green-tint); }
.shs-tip[data-kind="fair"],
.shs-tip[data-kind="weak"] { color: rgb(var(--amber)); background: var(--shs-amber-tint); border-color: var(--shs-amber-tint); }
.shs-mini { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.shs-chip { position: relative; display: inline-flex; align-items: center; gap: 5px; height: 38px; padding: 0 13px; border-radius: 19px; font-size: 13.5px; color: rgb(var(--ink)); user-select: none; }
.shs-chip::before { content: ""; position: absolute; inset: -3px -2px; }
.shs-chip svg { width: 15px; height: 15px; }
.shs-chip:disabled { opacity: 0.45; }
.shs-chip--blue { color: rgb(var(--blue)); background: var(--shs-blue-tint); }
.shs-chip--faved { color: rgb(var(--amber)); opacity: 1; }
.shs-link { display: flex; align-items: center; justify-content: center; gap: 3px; width: 100%; min-height: 44px; margin-top: 4px; font-size: 13px; color: rgb(var(--shs-ink-2)); }
.shs-link svg { width: 14px; height: 14px; }
.shs-spark-host { position: relative; display: inline-flex; }
.shs-spark { position: absolute; z-index: 5; width: 6px; height: 6px; border-radius: 50%; pointer-events: none; animation: shs-spk 0.55s ease-out forwards; }
@keyframes shs-spk { from { opacity: 1; transform: translate(0, 0) scale(1); } to { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(0.3); } }
.shs-gt { color: rgb(var(--green)); }

/* ===== 关闭确认(弹窗内的覆盖层,不叠第二个弹层) ===== */
.shs-confirm { position: absolute; inset: 0; z-index: 5; display: flex; align-items: flex-end; padding: 12px; border-radius: 34px; background: var(--shs-scrim); animation: shs-fade 0.2s ease both; }
.shs-confirm-card { width: 100%; padding: 16px; border-radius: 24px; background: var(--shs-solid); border: 1px solid var(--shs-hair); animation: shs-rise-in 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.shs-confirm-card h5 { font-size: 16px; font-weight: 600; }
.shs-confirm-card p { margin-top: 4px; font-size: 13px; line-height: 1.5; color: rgb(var(--shs-ink-2)); }

/* ===== 文字渐变与流光:只有支持 background-clip: text 才透明(否则文字会消失) ===== */
@supports ((-webkit-background-clip: text) or (background-clip: text)) {
  .shs-shiny {
    background: linear-gradient(110deg, rgb(var(--shs-ink-2)) 35%, rgb(var(--ink)) 50%, rgb(var(--shs-ink-2)) 65%);
    background-size: 220% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
    animation: shs-shine 2.2s linear infinite;
  }
  .shs-gt {
    background: linear-gradient(90deg, rgb(var(--green)), rgb(var(--teal)));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
  }
}

/* ===== 降级:不支持 backdrop-filter:实色 ===== */
@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
  .shs-sheet { background: var(--shs-solid); }
}

/* ===== 降级:低端机 html.lite(layout/glass-quality.ts):去模糊、去动画、玻璃退为实色 ===== */
html.lite .shs-sheet {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  background: var(--shs-solid);
}
html.lite .shs-scrim,
html.lite .shs-sheet,
html.lite .shs-rise,
html.lite .shs-btn--primary::after,
html.lite .shs-btn--stop::before,
html.lite .shs-pulse::after,
html.lite .shs-timer--live .shs-clock,
html.lite .shs-wave i,
html.lite .shs-shiny,
html.lite .shs-indet b,
html.lite .shs-bar-t b,
html.lite .shs-wd,
html.lite .shs-spark,
html.lite .shs-eq b {
  animation: none;
}
html.lite .shs-wave i { transform: scaleY(var(--h, 0.5)); }
html.lite .shs-indet b { transform: translateX(75%); }
html.lite .shs-shiny { background: none; -webkit-text-fill-color: currentColor; color: rgb(var(--shs-ink-2)); }

/* ===== 降级:系统「减少动态效果」:全部静止(模糊保留) ===== */
@media (prefers-reduced-motion: reduce) {
  .shs-scrim,
  .shs-sheet,
  .shs-rise,
  .shs-btn--primary::after,
  .shs-btn--stop::before,
  .shs-pulse::after,
  .shs-timer--live .shs-clock,
  .shs-wave i,
  .shs-shiny,
  .shs-indet b,
  .shs-bar-t b,
  .shs-wd,
  .shs-spark,
  .shs-eq b {
    animation: none;
  }
  .shs-wave i { transform: scaleY(var(--h, 0.5)); }
  .shs-indet b { transform: translateX(75%); }
  .shs-prog b { transition: none; }
}

/* ===== 降级:系统「减少透明度」:弹窗一律实心 ===== */
@media (prefers-reduced-transparency: reduce) {
  .shs-sheet {
    background: var(--shs-solid);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}
```
(注意:测试 `html.lite` 行必须以 `html.lite .shs-` 开头:上面每个 `html.lite` 选择器行都满足。`html.lite .shs-shiny` 那行里写了 `-webkit-text-fill-color: currentColor; color: rgb(...)` 不含 `color: transparent;` ✓。`.shs-gt` 在 `@supports` 外的回退色是 `color: rgb(var(--green))`,✓。)

- [ ] **Step 3:** 在 `shadow-sheet.tsx` 的 `import "./shadow-locales";` 之前加一行 `import "./shadow-sheet.css";`(Edit)。
- [ ] **Step 4:** `yarn web:typecheck`;`cd web && yarn vitest run src/features/practice/shadow src/architecture.test.ts` → 全绿(`shadow-css.test.ts` 的 `-webkit-backdrop-filter` 计数:`.shs-sheet` 一处声明;媒体查询里写的是 `none`,不计。若计数不是 1,检查是否有别处写了 `blur(`)。
- [ ] **Step 5(目视,不是测试):** 用 `yarn web:dev` 打开对话页,点任一「跟读」(此时入口还没迁移,可在浏览器控制台临时 `document.dispatchEvent` 不可行 —— **本步骤延后到 Task 7 之后**,与真机清单一起做;此处只确认 CSS 被打进懒块:`yarn web:build` 不跑)。
- [ ] **Step 6: 提交** `feat(web): shadow sheet glass styling`。

---

## Task 7:入口一 · 句子列表面板(多句,带 list / index)

**Files:** Modify `web/src/features/chat/sentence-practice-sheet.tsx`、`sentence-practice-sheet.test.tsx`。

- [ ] **Step 1(测试,红),Edit `sentence-practice-sheet.test.tsx`:**
  1. 导入:在 `import { renderWithProviders } from "~/test/render";` 后加 `import { WithShadowSheet } from "~/features/practice/shadow/test-utils";`。
  2. `setup` 里把 `renderWithProviders(<><SentencePracticeSheet text={text} onClose={onClose} /><StateProbe /></>, {` 改为 `renderWithProviders(<WithShadowSheet><SentencePracticeSheet text={text} onClose={onClose} /><StateProbe /></WithShadowSheet>, {`。
  3. 把用例 `it("opens the practice page with the sentence as reference", …)` 整个替换为:

```tsx
  it("opens the shadow sheet on the tapped sentence with the whole list, without navigating", async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getAllByTestId("practice-sentence-go")[1]);
    expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent("Mr. Lee agrees.");
    expect(screen.getByTestId("shadow-position")).toHaveTextContent("2 / 3");
    expect(screen.getByTestId("location")).toHaveTextContent("/chat/c1");
    expect(JSON.parse(screen.getByTestId("state").textContent!)).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it("leaves too-long sentences out of the list, so next / previous never land on a truncated one", async () => {
    setup({}, `${"a".repeat(2100)}. Short one. Another one.`);
    await userEvent.click(screen.getAllByTestId("practice-sentence-go")[1]);
    expect(await screen.findByTestId("shadow-reference")).toHaveTextContent("Short one.");
    expect(screen.getByTestId("shadow-position")).toHaveTextContent("1 / 2");
  });
```
  运行 `cd web && yarn vitest run src/features/chat/sentence-practice-sheet.test.tsx` → 新用例红(仍在导航)。
- [ ] **Step 2(实现),Edit `sentence-practice-sheet.tsx`:**
  1. 删除 `import { useNavigate } from "react-router-dom";`;`import { MAX_PRACTICE_TEXT, goPractice, savePracticeItem } from "~/features/practice";` → `import { MAX_PRACTICE_TEXT, savePracticeItem, useShadowSheet } from "~/features/practice";`。
  2. `  const navigate = useNavigate();` → `  const { open: openShadow } = useShadowSheet();`。
  3. 在 `const sentences = useMemo(…)` 之后加:

```tsx
  /** 弹窗里的「上一句 / 下一句」只走能练的句子:超长的整句不会被截断后当参考句(R-S18) */
  const practicable = useMemo(() => sentences.filter((s) => s.length <= MAX_PRACTICE_TEXT), [sentences]);
```
  4. 把 `onClick={() => { onClose(); goPractice(navigate, sentence); }}>` 替换为:

```tsx
                  onClick={() => {
                    onClose(); // 先关自己的面板,再打开弹窗(不叠两层)
                    openShadow({
                      text: sentence,
                      list: practicable,
                      index: sentences.slice(0, i).filter((s) => s.length <= MAX_PRACTICE_TEXT).length,
                      source: "chat",
                    });
                  }}>
```
- [ ] **Step 3:** `yarn web:typecheck`;`cd web && yarn vitest run src/features/chat/sentence-practice-sheet.test.tsx src/features/practice/shadow src/architecture.test.ts` → 全绿。
- [ ] **Step 4: 提交** `feat(web): the sentence list opens the shadow sheet`。

---

## Task 8:入口二 · 「不会说?」提示(conversation-page 的 `onPractice`)

**Files:** Modify `web/src/features/chat/conversation-page.tsx`、`conversation-page.test.tsx`。

- [ ] **Step 1(测试,红),Edit `conversation-page.test.tsx`:**
  1. 导入:`import { renderWithProviders } from "~/test/render";` 之后加 `import { WithShadowSheet } from "~/features/practice/shadow/test-utils";`。
  2. `setup` 里 `const page = <><ConversationPage recorderEnv={recorderEnv} /><NavProbe /></>;` → `const page = <WithShadowSheet><ConversationPage recorderEnv={recorderEnv} /><NavProbe /></WithShadowSheet>;`(这一处改动对文件里所有用 `setup` 的用例生效;Task 9、10 的用例依赖它)。再 `grep -n "renderWithProviders(" web/src/features/chat/conversation-page.test.tsx`:若还有别处直接渲染 `ConversationPage` 而不经 `setup`,它们没有 Provider,回退为 `goPractice`,不受影响。
  3. 用例 `reads a hint aloud, saves it, and opens it for practice` 改名为 `reads a hint aloud, saves it, and opens it in the shadow sheet`,并把结尾两行

```tsx
      await userEvent.click(screen.getAllByTestId("hint-practice")[2]);
      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice"));
```
  替换为:

```tsx
      await userEvent.click(screen.getAllByTestId("hint-practice")[2]);
      expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
      expect(screen.getByTestId("shadow-reference")).toHaveTextContent("Just water, thanks.");
      expect(screen.getByTestId("location")).toHaveTextContent("/chat/c1");
      expect(screen.queryByTestId("shadow-position")).toBeNull(); // 单句入口:没有上一句 / 下一句
      expect(screen.queryByTestId("hints-sheet")).toBeNull(); // 先关自己的面板,不叠两层弹窗
```
  运行 `cd web && yarn vitest run src/features/chat/conversation-page.test.tsx -t "opens it in the shadow sheet"` → 红。
- [ ] **Step 2(实现),Edit `conversation-page.tsx`:**
  1. `import { goPractice, savePracticeItem } from "~/features/practice";` → `import { savePracticeItem, useShadowSheet } from "~/features/practice";`。
  2. 在 `  const navigate = useNavigate();`(`ConversationPage` 里唯一一处)后加一行 `  const { open: openShadow } = useShadowSheet();`。
  3. `onPractice={(text) => { setHintsOpen(false); goPractice(navigate, text); }}` → `onPractice={(text) => { setHintsOpen(false); openShadow({ text, source: "chat" }); }}`。
- [ ] **Step 3:** `yarn web:typecheck`;`cd web && yarn vitest run src/features/chat/conversation-page.test.tsx -t "hint" src/architecture.test.ts`(只跑提示相关用例;文件的其余用例在 Task 9–11 之后随各自任务再跑)→ 全绿。
- [ ] **Step 4: 提交** `feat(web): the chat hints open the shadow sheet`。

---

## Task 9:入口三 · 语法纠正(`grammar-details.tsx`)

**Files:** Modify `web/src/features/chat/grammar-details.tsx`、`grammar-details.test.tsx`、`conversation-page.test.tsx`(一处断言)、`web/e2e/chat.spec.ts`(不运行)。

- [ ] **Step 1(测试,红):**
  1. `grammar-details.test.tsx`:加导入 `import { WithShadowSheet } from "~/features/practice/shadow/test-utils";`;把 `setup` 替换为:

```tsx
function setup(save: Handler) {
  const mock = createFetchMock({ "POST /api/practice-items": save });
  const onClose = vi.fn();
  const view = renderWithProviders(<WithShadowSheet><GrammarDetails result={RESULT} onClose={onClose} /></WithShadowSheet>, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat/c1",
  });
  return { mock, view, onClose };
}
```
  并在文件末尾追加:

```tsx
describe("GrammarDetails practice button", () => {
  it("closes the details and opens the shadow sheet with the corrected sentence, without navigating", async () => {
    const { onClose } = setup(() => json({ id: "p1", text: "x", source: "grammar", created_at: "t" }));
    await userEvent.click(screen.getByTestId("grammar-practice"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent("She doesn't like coffee.");
    expect(screen.queryByTestId("shadow-position")).toBeNull();
    expect(screen.getByTestId("location")).toHaveTextContent("/chat/c1");
    expect(screen.getByTestId("location").getAttribute("data-state")).toBe("null");
  });
});
```
  2. `conversation-page.test.tsx` 的语法用例末尾(`await userEvent.click(screen.getByTestId("grammar-practice"));` 之后)把 `expect(screen.getByTestId("location")).toHaveTextContent("/practice");` 替换为:

```tsx
      expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
      expect(screen.getByTestId("shadow-reference")).toHaveTextContent("She doesn't like coffee.");
      expect(screen.getByTestId("location")).toHaveTextContent("/chat/c1");
```
  运行 `cd web && yarn vitest run src/features/chat/grammar-details.test.tsx` → 新用例红。
- [ ] **Step 2(实现),Edit `grammar-details.tsx`:** 删除 `import { useNavigate } from "react-router-dom";`;`import { goPractice, savePracticeItem } from "~/features/practice";` → `import { savePracticeItem, useShadowSheet } from "~/features/practice";`;`  const navigate = useNavigate();` → `  const { open: openShadow } = useShadowSheet();`;`onClick={() => { onClose(); goPractice(navigate, result.corrected); }}>` → `onClick={() => { onClose(); openShadow({ text: result.corrected, source: "grammar" }); }}>`。
- [ ] **Step 3(E2E 规格,不运行):** `web/e2e/chat.spec.ts` 语法用例末尾三行(`grammar-practice` 点击、`toHaveURL(/\/practice$/)`、`reference-input` 的 `toHaveValue(corrected)`)改为:

```ts
  await page.getByTestId("grammar-practice").click();
  await expect(page.getByTestId("shadow-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/chat\//);
  await expect(page.getByTestId("shadow-reference")).toContainText(corrected);
```
- [ ] **Step 4:** `yarn web:typecheck`;`cd web && yarn vitest run src/features/chat/grammar-details.test.tsx src/features/chat/conversation-page.test.tsx -t "grammar|corrected sentence" src/architecture.test.ts` → 全绿。
- [ ] **Step 5: 提交** `feat(web): grammar corrections open the shadow sheet`。

---

## Task 10:入口四 · 复盘(`recap-sheet.tsx`)

**Files:** Modify `web/src/features/chat/recap-sheet.tsx`、`conversation-page.test.tsx`。

- [ ] **Step 1(测试,红),Edit `conversation-page.test.tsx`(复盘 describe 里):** 把用例 `saves a corrected sentence to the practice list as a grammar item` 结尾两行

```tsx
      await userEvent.click(screen.getByTestId("recap-poor-word-practice"));
      await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice"));
```
  替换为:

```tsx
      await userEvent.click(screen.getByTestId("recap-poor-word-practice"));
      expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
      expect(screen.getByTestId("shadow-reference")).toHaveTextContent("meet");
      expect(screen.getByTestId("location")).toHaveTextContent("/chat/c1");
      expect(screen.queryByTestId("recap-sheet")).toBeNull(); // 先关复盘面板
```
  并在它后面(同一 describe 内)新增:

```tsx
    it("opens a recap grammar sentence in the shadow sheet", async () => {
      setup(routes({ "GET /api/conversations/c1/messages": () => json(LOADED) }));
      await screen.findByText("You too!");
      await userEvent.click(await headerOption("conversation-recap"));
      await userEvent.click(await screen.findByTestId("recap-grammar-practice"));
      expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
      expect(screen.getByTestId("shadow-reference")).toHaveTextContent("Yesterday I went home.");
      expect(screen.getByTestId("location")).toHaveTextContent("/chat/c1");
    });
```
  运行 `cd web && yarn vitest run src/features/chat/conversation-page.test.tsx -t "recap"` → 新 / 改的用例红。
- [ ] **Step 2(实现),Edit `recap-sheet.tsx`:** 删除 `import { useNavigate } from "react-router-dom";`;`import { goPractice, savePracticeItem } from "~/features/practice";` → `import { savePracticeItem, useShadowSheet } from "~/features/practice";`;`  const navigate = useNavigate();` → `  const { open: openShadow } = useShadowSheet();`;`const practice = (text: string) => { onOpenChange(false); goPractice(navigate, text); };` 替换为:

```tsx
  const practice = (text: string, source: "chat" | "grammar") => { onOpenChange(false); openShadow({ text, source }); };
```
  并把两处调用 `onClick={() => practice(g.sentence)}` → `onClick={() => practice(g.sentence, "grammar")}`,`onClick={() => practice(w)}` → `onClick={() => practice(w, "chat")}`。
- [ ] **Step 3:** `yarn web:typecheck`;`cd web && yarn vitest run src/features/chat/conversation-page.test.tsx -t "recap" src/architecture.test.ts` → 全绿。
- [ ] **Step 4: 提交** `feat(web): the chat recap opens the shadow sheet`。

---

## Task 11:入口五 · 转写详情(`turn-detail-sheet.tsx`)

**Files:** Modify `web/src/features/chat/turn-detail-sheet.tsx`、`voice-ui.test.tsx`、`web/e2e/chat.spec.ts`(不运行)。

- [ ] **Step 1(测试,红),Edit `voice-ui.test.tsx`:** 加导入 `import { WithShadowSheet } from "~/features/practice/shadow/test-utils";`(与其它 `~/` 导入放一起);把用例 `detail sheet loads the full result and opens practice with the sentence` 整个替换为:

```tsx
  it("detail sheet loads the full result and opens the shadow sheet with the sentence, without navigating", async () => {
    const { api } = apiFor({ "GET /api/assessments/a1": () => json({ id: "a1", reference_text: "Hello", language: "en-US", duration_ms: 1, scores: good, result: good, created_at: "t" }) });
    const onClose = vi.fn();
    const message: UiMessage = { key: "u1", role: "user", status: "done", content: "Hello, nice to meet you.", assessmentId: "a1" };
    renderWithProviders(<WithShadowSheet><TurnDetailSheet message={message} onClose={onClose} /></WithShadowSheet>, { api });
    await waitFor(() => expect(screen.getByTestId("assessment-scores")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("detail-practice"));
    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent("Hello, nice to meet you.");
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
  });
```
  运行 `cd web && yarn vitest run src/features/chat/voice-ui.test.tsx -t "detail sheet loads"` → 红。
- [ ] **Step 2(实现),Edit `turn-detail-sheet.tsx`:** 删除 `import { useNavigate } from "react-router-dom";`;导入行 `…, MobileScoreResult, goPractice, savePracticeItem } from "~/features/practice";` → `…, MobileScoreResult, savePracticeItem, useShadowSheet } from "~/features/practice";`;`  const navigate = useNavigate();` → `  const { open: openShadow } = useShadowSheet();`;`onClick={() => { onClose(); goPractice(navigate, message.content); }}>` → `onClick={() => { onClose(); openShadow({ text: message.content, source: "chat" }); }}>`。
- [ ] **Step 3(E2E 规格,不运行):** `web/e2e/chat.spec.ts` 详情用例里(`detail-practice` 点击起的三行,以及紧随其后「删除对话」之前要先关弹窗)改为:

```ts
  // 详情 → 跟读这句:原地打开跟读弹窗(不跳转),参考文本是这句
  await page.getByTestId("detail-practice").click();
  await expect(page.getByTestId("shadow-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/chat\//);
  await expect(page.getByTestId("shadow-reference")).toContainText(/fellow|americans|country|ask/i);
  await page.getByTestId("shadow-close").click(); // 遮罩盖住了底部导航:先关弹窗
  await expect(page.getByTestId("shadow-sheet")).toHaveCount(0);
```
  (其后的 `await page.getByTestId("nav-chat").click();` 保持不变。)
- [ ] **Step 4:** `yarn web:typecheck`;`cd web && yarn vitest run src/features/chat/voice-ui.test.tsx src/architecture.test.ts` → 全绿。
- [ ] **Step 5: 提交** `feat(web): the turn detail opens the shadow sheet`。

---

## Task 12:入口六 · 选词查词里的「跟读这段」(`lookup-layer.tsx`)

**Files:** Modify `web/src/features/lookup/lookup-layer.tsx`、`lookup-layer.test.tsx`、`web/e2e/lookup.spec.ts`(不运行)。

- [ ] **Step 1(测试,红),Edit `lookup-layer.test.tsx`:**
  1. 加导入 `import { WithShadowSheet } from "~/features/practice/shadow/test-utils";`。
  2. `Page` 替换为:

```tsx
function Page() {
  return (
    <WithShadowSheet>
      <p data-testid="ctx" data-lookup-context>ask not what your country can do for you</p>
      <p data-testid="plain">plain text here</p>
      <LookupLayer />
    </WithShadowSheet>
  );
}
```
  3. 用例 `offers practice and save for a selected sentence only` 末尾

```tsx
    await userEvent.click(screen.getByTestId("lookup-practice"));
    expect(screen.getByTestId("location")).toHaveTextContent("/practice");
    await waitFor(() => expect(screen.queryByTestId("lookup-drawer")).toBeNull());
```
  替换为:

```tsx
    await userEvent.click(screen.getByTestId("lookup-practice"));
    expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent("ask not what your country can do");
    expect(screen.queryByTestId("shadow-position")).toBeNull();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/); // 没有导航
    await waitFor(() => expect(screen.queryByTestId("lookup-drawer")).toBeNull()); // 先关查词面板
```
  运行 `cd web && yarn vitest run src/features/lookup/lookup-layer.test.tsx -t "offers practice and save"` → 红。
- [ ] **Step 2(实现),Edit `lookup-layer.tsx`:**
  1. `import { useLocation, useNavigate, useNavigationType } from "react-router-dom";` → `import { useLocation, useNavigationType } from "react-router-dom";`。
  2. `import { MAX_PRACTICE_TEXT, goPractice, savePracticeItem } from "~/features/practice";` → `import { MAX_PRACTICE_TEXT, savePracticeItem, useShadowSheet } from "~/features/practice";`。
  3. `  const navigate = useNavigate();` → `  const { open: openShadow } = useShadowSheet();`(`navigate` 在这个文件里只有跟读按钮用)。
  4. `onClick={() => { onOpenChange(false); goPractice(navigate, passageText); }}>` → `onClick={() => { onOpenChange(false); openShadow({ text: passageText, source: "lookup" }); }}>`。
- [ ] **Step 3(E2E 规格,不运行):** `web/e2e/lookup.spec.ts` 的 `practice and save a selected sentence from the lookup drawer` 末尾,从 `await page.getByTestId("lookup-practice").click();` 起到 `practice-list` 之前,改为:

```ts
  await page.getByTestId("lookup-practice").click();
  await expect(page.getByTestId("shadow-sheet")).toBeVisible();
  await expect(page).toHaveURL(/\/practice\/assessments\//); // 没有导航
  await expect(page.getByTestId("shadow-reference")).toContainText(SPEECH_REFERENCE);
  await page.getByTestId("shadow-close").click();
  await page.getByTestId("nav-practice").click();
  await page.getByTestId("practice-list").click();
```
  (最后一行 `practice-item` 的断言保持。)
- [ ] **Step 4:** `yarn web:typecheck`;`cd web && yarn vitest run src/features/lookup src/architecture.test.ts` → 全绿。(`plugins/word-actions/lookup-shadow.test.tsx` 此时没有 Provider,「跟读这个词」仍走无 Provider 回退的 `goPractice`,所以它还会通过;它在 Task 12A 才改成断言弹窗。)
- [ ] **Step 5(六个入口一起回归):**

```bash
cd web && yarn vitest run src/features/chat/sentence-practice-sheet.test.tsx src/features/chat/grammar-details.test.tsx src/features/chat/voice-ui.test.tsx src/features/chat/conversation-page.test.tsx src/features/lookup src/features/practice src/layout src/architecture.test.ts
```
  全绿(这是第一次跑整个 `conversation-page.test.tsx`,耗时较长;失败先看是不是 `setup` 的 `WithShadowSheet` 包装影响了无关用例)。
- [ ] **Step 6: 提交** `feat(web): the lookup drawer opens the shadow sheet`。

---

## Task 12A:入口七 · 「单词操作」面板的「跟读这个词」(`register-word-actions.tsx`)+ 弹窗打开时收起查词抽屉

**Files:** Modify `web/src/features/practice/register-word-actions.tsx`、`web/src/features/practice/shadow/shadow-context.tsx`、`shadow-context.test.tsx`、`web/src/features/practice/index.ts`、`web/src/features/lookup/lookup-layer.tsx`、`web/src/features/lookup/lookup-layer.test.tsx`、`web/src/plugins/word-actions/lookup-shadow.test.tsx`、`web/src/plugins/word-actions/more-button.test.tsx`。

背景(R-S21):这一行在 `plugins/word-actions/word-actions-sheet.tsx` 的模态面板里,面板又叠在查词抽屉上;旧行为靠 PUSH 导航让 `LookupLayer` 收起抽屉。改成弹窗后没有导航,所以弹窗打开时由 `LookupLayer` 自己收起抽屉。

- [ ] **Step 1(测试,红):**
  1. `shadow-context.test.tsx`:在导入处把 `import { ShadowSheetProvider, normalizeShadowInput, useShadowSheet, type ShadowOpenInput } from "./shadow-context";` 改为同时导入 `useShadowSheetOpen`,并在文件末尾追加:

```tsx
function OpenProbe() {
  return <span data-testid="shadow-open-probe">{String(useShadowSheetOpen())}</span>;
}

describe("useShadowSheetOpen", () => {
  it("is false without a provider and follows the sheet with one", async () => {
    const first = renderWithProviders(<OpenProbe />);
    expect(screen.getByTestId("shadow-open-probe")).toHaveTextContent("false");
    first.unmount();
    renderWithProviders(
      <ShadowSheetProvider><OpenProbe /><Opener input={{ text: "Hello there.", source: "chat" }} /><ShadowSheetHost /></ShadowSheetProvider>,
    );
    expect(screen.getByTestId("shadow-open-probe")).toHaveTextContent("false");
    await userEvent.click(screen.getByTestId("open"));
    expect(screen.getByTestId("shadow-open-probe")).toHaveTextContent("true");
    await userEvent.click(await screen.findByTestId("shadow-close"));
    expect(screen.getByTestId("shadow-open-probe")).toHaveTextContent("false");
  });

  it("accepts the manual source", () => {
    expect(normalizeShadowInput({ text: "Hi.", source: "manual" })).toEqual({ items: ["Hi."], index: 0, source: "manual" });
  });
});
```
  2. `plugins/word-actions/lookup-shadow.test.tsx`:加导入 `import { WithShadowSheet } from "~/features/practice/shadow/test-utils";`;把用例改名为 `shadowing from the lookup sheet closes the panel and the lookup sheet, and opens the shadow sheet`;`renderWithProviders(` 里的 `<>…</>` 换成 `<WithShadowSheet>…</WithShadowSheet>`(两个子元素 `<p data-testid="ctx" …>` 与 `<LookupLayer />` 不变);用例末尾三行(`waitFor(... "/practice")`、`expect(JSON.parse(...dataset.state!)).toEqual({ reference: ... })`、`waitFor(queryByTestId("lookup-drawer") toBeNull)`)替换为:

```tsx
  expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
  expect(screen.getByTestId("shadow-reference")).toHaveTextContent("ask not what your country can do for you");
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/chat\/c1$/); // 没有导航
  expect(screen.getByTestId("location").dataset.state).toBe("null");
  await waitFor(() => expect(screen.queryByTestId("lookup-drawer")).toBeNull()); // 查词抽屉被收起
  expect(screen.queryByRole("dialog", { name: "单词操作" })).toBeNull(); // 面板先关
```
  3. `plugins/word-actions/more-button.test.tsx`:加同样的导入;把 `shadowing navigates to practice with the example (or the word)` 整个替换为:

```tsx
  it("shadowing opens the shadow sheet with the example (or the word), without navigating", async () => {
    setLinkFlags(ON);
    renderWithProviders(
      <WithShadowSheet><WordActions testId="summary-word-add-0" variant="icon" target={{ word: "brew", example: "Brew the tea.", source: "recap" }} /></WithShadowSheet>,
      { ...api({}), route: "/rooms/r/1/summary" },
    );
    fireEvent.click(screen.getByTestId("summary-word-add-0-more"));
    fireEvent.click(await screen.findByRole("button", { name: /跟读这个词/ }));
    expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent("Brew the tea.");
    expect(screen.getByTestId("location")).toHaveTextContent("/rooms/r/1/summary");
    expect(screen.getByTestId("location").dataset.state).toBe("null");
    expect(screen.queryByRole("dialog", { name: "单词操作" })).toBeNull();
  });

  it("shadowing a word without an example reads the word itself", async () => {
    setLinkFlags(ON);
    renderWithProviders(
      <WithShadowSheet><WordActions testId="summary-word-add-1" variant="icon" target={{ word: "brew", source: "recap" }} /></WithShadowSheet>,
      { ...api({}), route: "/rooms/r/1/summary" },
    );
    fireEvent.click(screen.getByTestId("summary-word-add-1-more"));
    fireEvent.click(await screen.findByRole("button", { name: /跟读这个词/ }));
    expect(await screen.findByTestId("shadow-reference")).toHaveTextContent("brew");
  });
```
  运行 `cd web && yarn vitest run src/plugins/word-actions src/features/practice/shadow/shadow-context.test.tsx` → 新 / 改的用例红(`useShadowSheetOpen` 不存在;弹窗不出现)。
- [ ] **Step 2(实现):**
  1. `shadow/shadow-context.tsx`:在 `useShadowHost` 之前加:

```tsx
/** 弹窗当前是否打开(给 LookupLayer:弹窗打开时收起查词抽屉,R-S21)。没有 Provider 时恒为 false。 */
export function useShadowSheetOpen(): boolean {
  return useContext(RequestContext) !== null;
}
```
  2. `features/practice/index.ts`:把 `export { ShadowSheetProvider, useShadowSheet, type ShadowOpenInput, type ShadowSource } from "./shadow/shadow-context";` 改为 `export { ShadowSheetProvider, useShadowSheet, useShadowSheetOpen, type ShadowOpenInput, type ShadowSource } from "./shadow/shadow-context";`。
  3. `features/practice/register-word-actions.tsx` 整个文件替换为(Write 前先 Read;保留首行注释的含义):

```tsx
// 只被 web/src/plugins/word-actions 导入(architecture.test.ts):「单词操作」面板里的「跟读这个词」一行(spec §6.1)。
import { MicIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconChip } from "~/components/icon-chip";
import { ListRow } from "~/components/section-group";
import { contribute, type PointProps } from "~/lib/extension-points";
import { useShadowSheet } from "./shadow/shadow-context";

/** 有例句时跟读例句,否则跟读词本身;先关面板(查词抽屉由 LookupLayer 在弹窗打开时收起),再在原地打开跟读弹窗(R-S21)。 */
export function ShadowRow({ target, close }: PointProps["wordActionsMenu"]) {
  const { t } = useTranslation();
  const { open } = useShadowSheet();
  return (
    <ListRow testId="word-actions-shadow" icon={<IconChip tone="blue" icon={MicIcon} />}
      title={t("web.links.wordActions.shadow")} subtitle={t("web.links.wordActions.shadowHint")}
      onClick={() => { close(); open({ text: target.example ?? target.word, source: target.source === "lookup" ? "lookup" : "manual" }); }} />
  );
}

contribute({ point: "wordActionsMenu", id: "practice.shadow", order: 20, link: "word_actions", component: ShadowRow });
```
  (若 `target.source` 的类型联合里没有 `"lookup"` 导致比较报错,以 `~/lib/extension-points` 里 `WordTarget` 的真实类型为准改成合法的比较;语义不变。)
  4. `features/lookup/lookup-layer.tsx`:`import { MAX_PRACTICE_TEXT, savePracticeItem, useShadowSheet } from "~/features/practice";` → 加 `useShadowSheetOpen`;在 `const { open: openShadow } = useShadowSheet();` 后加 `  const shadowOpen = useShadowSheetOpen();`;在「按路径收起」的那个 `useEffect(...)`(以注释 `// 每次渲染比较路径` 结尾)之后加:

```tsx
  // 跟读弹窗打开时收起查词面板(含「单词操作」面板里的「跟读这个词」:它不导航,抽屉不会因路径变化而收起,R-S21)。
  // 只在弹窗「打开的那一刻」触发;弹窗已开时再从弹窗里选词打开抽屉不会被它关掉。
  useEffect(() => {
    if (shadowOpen && open) onOpenChange(false);
  }, [shadowOpen]); // eslint-disable-line react-hooks/exhaustive-deps
```
  5. `features/lookup/lookup-layer.test.tsx` 追加一个用例(`describe("LookupLayer", …)` 内,放在 `offers practice and save…` 之后):

```tsx
  it("collapses the drawer when the shadow sheet opens from somewhere else", async () => {
    const mock = createFetchMock({ "POST /api/ai/chat/completions": () => json({ choices: [{ message: { content: '{"word":"country","definition":"a nation"}' } }] }) });
    function OpenElsewhere() {
      const { open } = useShadowSheet();
      return <button type="button" data-testid="open-elsewhere" onClick={() => open({ text: "Hello there.", source: "manual" })}>x</button>;
    }
    // 不用 Page(它自带一层 WithShadowSheet):两个 Provider 不同步。这里只有外面这一层。
    renderWithProviders(
      <WithShadowSheet>
        <OpenElsewhere />
        <p data-testid="ctx" data-lookup-context>ask not what your country can do for you</p>
        <LookupLayer />
      </WithShadowSheet>,
      { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) },
    );
    await selectText("country");
    await userEvent.click(await screen.findByTestId("lookup-trigger"));
    await waitFor(() => expect(screen.getByTestId("lookup-result")).toHaveAttribute("data-status", "done"));
    await userEvent.click(screen.getByTestId("open-elsewhere"));
    expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("lookup-drawer")).toBeNull());
  });
```
  并加导入 `import { useShadowSheet } from "~/features/practice";`。(`selectText("country")` 按 `data-testid="ctx"` 取节点,内联的 `<p>` 带同一个 testid,所以不用改它。)
- [ ] **Step 3:** `yarn web:typecheck`;`cd web && yarn vitest run src/plugins/word-actions src/features/lookup src/features/practice/shadow/shadow-context.test.tsx src/plugins/pron-shadow src/architecture.test.ts` → 全绿。注意 `plugins/word-actions/word-actions-contract.test.ts`、`parity.test.tsx` 不应受影响;若 `register-word-actions` 的导入变化触发 `architecture.test.ts` 的「register 文件不得导入别的 feature」检查,说明引错了路径(必须是 `./shadow/shadow-context`,在 practice 内)。
- [ ] **Step 4: 提交** `feat(web): the word-actions shadow row opens the shadow sheet`。

---

## Task 12B:迁移 · 发音弱词页(`plugins/pron-shadow/weak-words-page.tsx`)

**Files:** Modify `web/src/plugins/pron-shadow/weak-words-page.tsx`、`weak-words-page.test.tsx`。联动功能 `pron_shadow` 打开时才有这页;迁移规则见 R-S01(从别的页面发起的快速跟读)。

- [ ] **Step 1(测试,红),Edit `weak-words-page.test.tsx`:** 加导入 `import { WithShadowSheet } from "~/features/practice/shadow/test-utils";`;把这三个用例整个替换为(其余用例不动):

```tsx
it("shadow uses the example sentence and opens the shadow sheet without navigating", async () => {
  renderWithProviders(<WithShadowSheet><WeakWordsPage /></WithShadowSheet>, { api: api(listing()) });
  fireEvent.click(within(await screen.findByTestId("weak-three")).getByRole("button", { name: "跟读:three" }));
  expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
  expect(screen.getByTestId("shadow-reference")).toHaveTextContent("Three trees.");
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
  expect(state()).toBeNull();
});

it("shadowing a word without an example uses the word", async () => {
  renderWithProviders(<WithShadowSheet><WeakWordsPage /></WithShadowSheet>, { api: api(listing()) });
  fireEvent.click(within(await screen.findByTestId("weak-world")).getByRole("button", { name: "跟读:world" }));
  expect(await screen.findByTestId("shadow-reference")).toHaveTextContent("world");
});

it("drills the top five words together in the shadow sheet", async () => {
  renderWithProviders(<WithShadowSheet><WeakWordsPage /></WithShadowSheet>, { api: api(listing()) });
  fireEvent.click(await screen.findByRole("button", { name: "连读这 5 个" }));
  expect(await screen.findByTestId("shadow-reference")).toHaveTextContent("three, world, rural, thought, squirrel");
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/);
});
```
  运行 `cd web && yarn vitest run src/plugins/pron-shadow/weak-words-page.test.tsx` → 红。
- [ ] **Step 2(实现),Edit `weak-words-page.tsx`:** 删除 `import { useNavigate } from "react-router-dom";`(`navigate` 在这个文件里只被 `shadow` 用;改完 `grep -n navigate` 应为空);在 `import { useAuth } from "~/auth/auth-context";` 之后加 `import { useShadowSheet } from "~/features/practice";`;`  const navigate = useNavigate();` → `  const { open: openShadow } = useShadowSheet();`;`const shadow = (reference: string) => navigate("/practice", { state: { reference } });` → `const shadow = (reference: string) => openShadow({ text: reference, source: "manual" });`。同时把组件上方注释里「交给练习页的参考文本」改为「在原地打开跟读弹窗」。
- [ ] **Step 3:** `yarn web:typecheck`;`cd web && yarn vitest run src/plugins/pron-shadow src/architecture.test.ts` → 全绿(`practice-integration.test.tsx` 渲染的是练习页,不受影响;`architecture.test.ts` 里 `plugins/` 经 `~/features/practice` 引入合规,不新增 feature 边)。
- [ ] **Step 4: 提交** `feat(web): weak words open the shadow sheet`。

---

## Task 12C:迁移 · 进度页弱词的话筒(`progress/progress-page.tsx`)

**Files:** Modify `web/src/features/progress/progress-page.tsx`、`progress-page.test.tsx`。

- [ ] **Step 1(测试,红),Edit `progress-page.test.tsx`:** 加导入 `import { WithShadowSheet } from "~/features/practice/shadow/test-utils";`;`page` 辅助函数改为:

```tsx
const page = (mock: ReturnType<typeof createFetchMock>) =>
  renderWithProviders(<WithShadowSheet><ProgressPage /></WithShadowSheet>, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/progress" });
```
  用例 `practices and saves a word` 末尾的 `await userEvent.click(screen.getByTestId("progress-word-practice"));` 与其后的 `waitFor(... "/practice")` 替换为:

```tsx
    await userEvent.click(screen.getByTestId("progress-word-practice"));
    expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent("think");
    expect(screen.getByTestId("location")).toHaveTextContent("/progress");
    expect(screen.getByTestId("location").getAttribute("data-state")).toBe("null");
```
  运行 `cd web && yarn vitest run src/features/progress/progress-page.test.tsx -t "practices and saves"` → 红。
- [ ] **Step 2(实现),Edit `progress-page.tsx`:** 删除 `import { useNavigate } from "react-router-dom";` 与 `  const navigate = useNavigate();`(`navigate` 在这个文件里只被 `goPractice` 用;改完 `grep -n navigate` 应为空);`import { goPractice, savePracticeItem } from "~/features/practice";` → `import { savePracticeItem, useShadowSheet } from "~/features/practice";`;在原来 `const navigate = …` 的位置加 `  const { open: openShadow } = useShadowSheet();`;`onClick={() => goPractice(navigate, w.word)}><MicIcon /></IconButton>` → `onClick={() => openShadow({ text: w.word, source: "manual" })}><MicIcon /></IconButton>`。
- [ ] **Step 3:** `yarn web:typecheck`;`cd web && yarn vitest run src/features/progress src/architecture.test.ts` → 全绿。
- [ ] **Step 4: 提交** `feat(web): progress weak words open the shadow sheet`。

---

## Task 12D:迁移 · 段位赛结果页的练习建议(`rank/match-page.tsx`)

**Files:** Modify `web/src/features/rank/match-page.tsx`、`match-page.test.tsx`。

- [ ] **Step 1(测试,红),Edit `match-page.test.tsx`:** 加导入 `import { WithShadowSheet } from "~/features/practice/shadow/test-utils";`;在 `describe("MatchPage", …)` 里、用例 `shows the result page for a finished match` 之后追加(沿用同一渲染方式;`CONTRACT.finish_fail` 的 `drillEn` 是 `I'd like a refund, please.`,见同文件 `MatchResult` 的用例):

```tsx
  it("the drill opens the shadow sheet after saving the sentence, without navigating", async () => {
    const mock = createFetchMock({
      [`GET /api/rank/matches/${id}`]: () => json(CONTRACT.finish_fail),
      "POST /api/practice-items": () => json({ id: "p1", text: "x", source: "manual", created_at: "2026-10-05T00:00:00+00:00" }),
    });
    renderWithProviders(<WithShadowSheet><MatchPage /></WithShadowSheet>, {
      api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: `/rank/match/${id}`, path: "/rank/match/:id",
    });
    fireEvent.click(await screen.findByTestId("match-drill"));
    expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent("I'd like a refund, please.");
    expect(screen.getByTestId("location")).toHaveTextContent(`/rank/match/${id}`);
    expect(JSON.parse(mock.calls.find((c) => c.url.pathname === "/api/practice-items")!.body as string)).toEqual({ text: "I'd like a refund, please.", source: "manual" });
  });
```
  (`fireEvent`、`createFetchMock`、`json`、`ApiClient`、`CONTRACT`、`id` 都是该文件已有的名字;若 `fireEvent` 没导入就补上。)运行 `cd web && yarn vitest run src/features/rank/match-page.test.tsx -t "drill opens"` → 红。
- [ ] **Step 2(实现),Edit `match-page.tsx`:** `import { goPractice, savePracticeItem } from "~/features/practice";` → `import { savePracticeItem, useShadowSheet } from "~/features/practice";`;在 `  const navigate = useNavigate();`(`navigate` 仍被 `BottomSheet` 的 `navigate("/rank")` 使用,保留)后加 `  const { open: openShadow } = useShadowSheet();`;`.finally(() => goPractice(navigate, text))` → `.finally(() => openShadow({ text, source: "manual" }))`。
- [ ] **Step 3:** `yarn web:typecheck`;`cd web && yarn vitest run src/features/rank/match-page.test.tsx src/features/rank/match-page.voice-only.test.tsx src/architecture.test.ts` → 全绿。
- [ ] **Step 4(十个入口一起回归):**

```bash
cd web && yarn vitest run src/features/chat/sentence-practice-sheet.test.tsx src/features/chat/grammar-details.test.tsx src/features/chat/voice-ui.test.tsx src/features/lookup src/plugins/word-actions src/plugins/pron-shadow src/features/progress src/features/rank/match-page.test.tsx src/features/practice src/layout src/architecture.test.ts
```
  全绿(`conversation-page.test.tsx` 整文件已在 Task 12 Step 5 跑过)。
- [ ] **Step 5: 提交** `feat(web): the rank drill opens the shadow sheet`。

---

## Task 13:录音 / 评测中关闭先确认

**Files:** Modify `web/src/features/practice/shadow/shadow-sheet.tsx`、`shadow-sheet.test.tsx`。

- [ ] **Step 1(测试,红):** 在 `shadow-sheet.test.tsx` 顶部导入处加 `import { useState } from "react";`,并在文件末尾追加:

```tsx
function Closable({ onClosed, env }: { onClosed: () => void; env: ReturnType<typeof createFakeRecorderEnv>["env"] }) {
  const [open, setOpen] = useState(true);
  return open ? (
    <ShadowSheet request={{ id: 1, items: [REFERENCE], index: 0, source: "chat" }} recorderEnv={env}
      onClose={() => { onClosed(); setOpen(false); }} />
  ) : null;
}

function setupClosable(routes: Record<string, Handler> = {}) {
  const mock = createFetchMock({ ...CONFIG_ROUTES, ...routes });
  const fake = createFakeRecorderEnv();
  const onClosed = vi.fn();
  renderWithProviders(<Closable onClosed={onClosed} env={fake.env} />, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat/c1",
  });
  return { mock, fake, onClosed };
}

describe("ShadowSheet close confirmation", () => {
  beforeEach(() => {
    localStorage.clear();
    resetServerAiConfigCache();
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:mine"), revokeObjectURL: vi.fn() });
    Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
  });

  it("closes at once when nothing is in progress", async () => {
    const { onClosed } = setupClosable();
    await userEvent.click(screen.getByTestId("shadow-close"));
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("shadow-sheet")).toBeNull();
  });

  it("asks before closing while recording; Keep going resumes, Discard closes and releases the microphone", async () => {
    const { fake, onClosed } = setupClosable();
    await userEvent.click(screen.getByTestId("shadow-record"));
    await screen.findByTestId("shadow-stop");
    await userEvent.click(screen.getByTestId("shadow-close"));
    expect(screen.getByTestId("shadow-confirm")).toBeInTheDocument();
    expect(onClosed).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("shadow-confirm-keep"));
    expect(screen.queryByTestId("shadow-confirm")).toBeNull();
    expect(screen.getByTestId("shadow-stop")).toBeInTheDocument(); // 仍在录音
    expect(fake.track.stop).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("shadow-scrim"));
    expect(screen.getByTestId("shadow-confirm")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("shadow-confirm-drop"));
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("shadow-sheet")).toBeNull();
    await waitFor(() => expect(fake.track.stop).toHaveBeenCalled());
  });

  it("Escape asks too, and a second Escape or a scrim tap dismisses the question (keep going)", async () => {
    setupClosable();
    await userEvent.click(screen.getByTestId("shadow-record"));
    await screen.findByTestId("shadow-stop");
    await userEvent.keyboard("{Escape}");
    expect(await screen.findByTestId("shadow-confirm")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("shadow-scrim"));
    expect(screen.queryByTestId("shadow-confirm")).toBeNull();
    expect(screen.getByTestId("shadow-sheet")).toBeInTheDocument();
  });

  it("asks while assessing; Discard aborts the upload and drops the late score", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { mock, onClosed } = setupClosable({ "POST /api/speech/assessments": async () => { await gate; return json(ASSESSED); } });
    await recordAndStop();
    await screen.findByTestId("shadow-assessing");
    await userEvent.click(screen.getByTestId("shadow-close"));
    expect(screen.getByTestId("shadow-confirm")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("shadow-confirm-drop"));
    expect(onClosed).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(assessCalls(mock)[0].signal?.aborted).toBe(true));
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.queryByTestId("shadow-sheet")).toBeNull();
  });

  it("the question goes away by itself when the score arrives", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setupClosable({ "POST /api/speech/assessments": async () => { await gate; return json(ASSESSED); } });
    await recordAndStop();
    await screen.findByTestId("shadow-assessing");
    await userEvent.click(screen.getByTestId("shadow-close"));
    expect(screen.getByTestId("shadow-confirm")).toBeInTheDocument();
    await act(async () => { release(); });
    expect(await screen.findByTestId("shadow-result")).toBeInTheDocument();
    expect(screen.queryByTestId("shadow-confirm")).toBeNull();
  });

  it("a downward swipe on the grabber asks as well", async () => {
    setupClosable();
    await userEvent.click(screen.getByTestId("shadow-record"));
    await screen.findByTestId("shadow-stop");
    const grab = screen.getByTestId("shadow-sheet").querySelector(".shs-grab-zone")!;
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.touchStart(grab, { touches: [{ clientY: 100 }] });
    fireEvent.touchEnd(grab, { changedTouches: [{ clientY: 200 }] });
    expect(screen.getByTestId("shadow-confirm")).toBeInTheDocument();
  });
});
```
  运行 `cd web && yarn vitest run src/features/practice/shadow/shadow-sheet.test.tsx -t "close confirmation"` → 红。
- [ ] **Step 2(实现),Edit `shadow-sheet.tsx`:**
  1. 在 `const [favPending, setFavPending] = useState(false);` 之前加 `const [confirming, setConfirming] = useState(false);`。
  2. 把 `  const requestClose = () => onClose();` 替换为:

```tsx
  // 录音 / 评测 / 申请麦克风中关闭先确认(R-S16);确认出现时再关一次(Escape / 遮罩)= 继续
  const requestClose = () => {
    if (confirming) {
      setConfirming(false);
      return;
    }
    if (busyNav) setConfirming(true);
    else onClose();
  };
  useEffect(() => {
    if (!busyNav) setConfirming(false); // 录音结束(出分 / 出错 / 取消)时问题自动消失
  }, [busyNav]);
```
  3. 在 `</div>`(`.shs-scroll` 的结束标签)与 `</DialogPrimitive.Content>` 之间加确认覆盖层:

```tsx
          {confirming && (
            <div data-testid="shadow-confirm" className="shs-confirm" role="alertdialog" aria-labelledby="shs-confirm-title" aria-describedby="shs-confirm-body">
              <div className="shs-confirm-card">
                <h5 id="shs-confirm-title">{t("web.practice.shadow.confirm.title")}</h5>
                <p id="shs-confirm-body">{t("web.practice.shadow.confirm.body")}</p>
                <div className="shs-btns">
                  <button type="button" data-testid="shadow-confirm-keep" className="shs-btn shs-btn--ghost shs-tint" onClick={() => setConfirming(false)}>
                    {t("web.practice.shadow.confirm.keep")}
                  </button>
                  <button type="button" data-testid="shadow-confirm-drop" className="shs-btn shs-btn--stop" onClick={onClose}>
                    {t("web.practice.shadow.confirm.drop")}
                  </button>
                </div>
              </div>
            </div>
          )}
```
  (`onClose` 卸载弹窗,钩子的卸载清理中止上传、取消录音、释放麦克风、回收 blob URL;**不要**在弹窗里再放第二个 Radix 弹层。)
- [ ] **Step 3:** `yarn web:typecheck`;`cd web && yarn vitest run src/features/practice/shadow src/architecture.test.ts` → 全绿。
- [ ] **Step 4: 提交** `feat(web): confirm before closing the shadow sheet mid-recording`。

---

## Task 14:懒加载守卫测试

**Files:** Create `web/src/features/practice/shadow/shadow-lazy.test.ts`。

- [ ] **Step 1:** Create `web/src/features/practice/shadow/shadow-lazy.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 主包守卫(R-S09):这些模块在主包里,不得静态导入弹窗块、文案、样式或效果。 */
const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(path.join(here, rel), "utf8");
const MAIN = ["shadow-context.tsx", "shadow-host.tsx", "../use-shadow-session.ts", "../index.ts"];
const LAZY_ONLY = ["shadow-sheet", "shadow-result", "shadow-fx", "word-tap", "shadow-locales", "shadow-sheet.css"];
const staticImports = (s: string) =>
  [...s.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g)]
    .map((m) => (m[1] ?? m[2]).replace(/\.(ts|tsx)$/, ""))
    .map((p) => p.replace(/^\.\/(shadow\/)?/, "").replace(/^\.\.\/shadow\//, ""));

describe("the shadow sheet stays out of the main bundle (R-S09)", () => {
  it("main-bundle modules never statically import the lazy chunk, its copy, styles or effects", () => {
    for (const f of MAIN) {
      for (const target of staticImports(src(f))) {
        expect(LAZY_ONLY, `${f} -> ${target}`).not.toContain(target);
      }
    }
  });

  it("the host reaches the sheet only through import()", () => {
    const host = src("shadow-host.tsx");
    expect(host).toContain('import("./shadow-sheet")');
    expect(host).toContain("lazy(");
    expect(host).not.toMatch(/from\s*["']\.\/shadow-sheet["']/);
  });

  it("the practice barrel exports the provider, host and hook, never the lazy modules or the session hook", () => {
    const index = src("../index.ts");
    expect(index).toContain('from "./shadow/shadow-context"');
    expect(index).toContain('from "./shadow/shadow-host"');
    for (const lazy of ["shadow-sheet", "shadow-result", "shadow-fx", "word-tap", "shadow-locales", "use-shadow-session"]) {
      expect(index, lazy).not.toContain(lazy);
    }
  });

  it("the sheet chunk pulls in its own copy and styles", () => {
    const sheet = src("shadow-sheet.tsx");
    expect(sheet).toContain('import "./shadow-locales";');
    expect(sheet).toContain('import "./shadow-sheet.css";');
    expect(src("shadow-result.tsx")).toContain('import "./shadow-locales";');
  });

  it("the copy is not in the eager i18n files and the lazy locales are not under an i18n directory", () => {
    expect(src("../i18n/en.json")).not.toContain('"shadow"');
    expect(src("../i18n/zh-CN.json")).not.toContain('"shadow"');
    expect(path.basename(path.dirname(path.join(here, "locales", "en.json")))).toBe("locales");
  });

  it("the app shell mounts the provider around the shell and the host beside the lookup layer", () => {
    const shell = readFileSync(path.resolve(here, "../../../layout/app-shell.tsx"), "utf8");
    expect(shell).toContain('from "~/features/practice"');
    expect(shell).toContain("<ShadowSheetProvider>");
    expect(shell).toContain("<ShadowSheetHost />");
    expect(shell.indexOf("<LookupLayer />")).toBeLessThan(shell.indexOf("<ShadowSheetHost />"));
  });

  it("test/render.tsx stays light: it never imports the practice feature (R-S05)", () => {
    const render = readFileSync(path.resolve(here, "../../../test/render.tsx"), "utf8");
    expect(render).not.toContain("features/practice");
  });
});
```
  运行 `cd web && yarn vitest run src/features/practice/shadow/shadow-lazy.test.ts` → 全绿。若第一条因路径规整失败(如 `index.ts` 的 `export … from "./shadow/shadow-host"` 被规整成 `shadow-host`,不在 `LAZY_ONLY` 里,应通过),按真实输出调整**规整函数**,不要放宽「主包不得静态导入懒模块」的语义。
- [ ] **Step 2:** `yarn web:typecheck`;`cd web && yarn vitest run src/features/practice/shadow src/architecture.test.ts` → 全绿。
- [ ] **Step 3(体积,只在用户要求时):** `yarn web:build` 后 `cd web && node scripts/check-main-bundle.mjs --max-delta=1000`(只打印,不加 `--record`,不改基线文件),把数字写进 Task 15 创建的清单文件的「体积」一节。**不要预先写数字。**
- [ ] **Step 4: 提交** `test(web): keep the shadow sheet out of the main bundle`。

---

## Task 15:文档与真机清单

**Files:** Modify `web/src/features/practice/CLAUDE.md`、`web/src/features/chat/CLAUDE.md`、`web/src/features/lookup/CLAUDE.md`、`web/src/layout/CLAUDE.md`、`web/README.md`;Create `docs/superpowers/plans/2026-10-14-shadow-sheet-device-checklist.md`。

- [ ] **Step 1:** `web/src/features/practice/CLAUDE.md`(Edit):
  - 在 `- \`mobile-score-result.tsx\` (score view reused by chat).` 之后加两行:

```
- `use-shadow-session.ts` — `useShadowSession`: record → WAV → assess (`save: true`, no `source`) → keep the recording for retry. Shared by `practice-page.tsx` and the shadow sheet (plan 2026-10-14-shadow-sheet); with default options it is the page's old logic verbatim (`keepAudio`, `silenceError`, `starter`, `maxDurationMs` are sheet/test-only).
- `shadow/` — the in-place read-aloud sheet opened from chat and lookup. Main bundle (tiny): `shadow-context.tsx` (`ShadowSheetProvider`, `useShadowSheet`, `normalizeShadowInput`), `shadow-host.tsx` (`ShadowSheetHost`, `lazy`). Lazy chunk only: `shadow-sheet.tsx`, `shadow-result.tsx` (`ShadowResult`), `shadow-fx.tsx`, `word-tap.ts`, `shadow-locales.ts` + `locales/`, `shadow-sheet.css` (`.shs-*`). `test-utils.tsx` (`WithShadowSheet`) is for tests only.
```
  - `## Public surface` 一行改为:`Public (\`index.ts\`): pages, assessment API + types, \`MAX_PRACTICE_TEXT\`, \`savePracticeItem\`/\`goPractice\`, \`MobileScoreResult\`, \`ShadowSheetProvider\`/\`ShadowSheetHost\`/\`useShadowSheet\`/\`useShadowSheetOpen\` (+ \`ShadowOpenInput\`, \`ShadowSource\`). …`(保留原句其余部分)。
  - `## Pitfalls` 末尾追加:

```
- Shadow sheet: callers close their own panel, then `useShadowSheet().open({ text, list?, index?, source })`; `source` only feeds 收藏. The assessment is saved **without** `source` (server default `practice`, so it shows in History; `source=chat` rows without a message are deleted by `cleanup_orphan_chat_recordings`).
- The sheet is a **non-modal** Radix Dialog with its own scrim (z-35/36 < selection bar z-40 < lookup drawer z-50): a modal one would make `lookup-bar.tsx` unclickable. The close confirmation is an in-sheet overlay, never a second dialog (nested focus scopes recurse, see wordbook/CLAUDE.md). While recording/assessing the reference loses `data-lookup-context` so the selection bar stays away.
- Lazy chunk: never import `shadow-sheet`, `shadow-result`, `shadow-fx`, `word-tap`, `shadow-locales` or the CSS from main-bundle files (`shadow-lazy.test.ts`); copy lives in `shadow/locales/` (not `i18n/`, which is merged eagerly). `word-tap.ts` / `shadow-fx.tsx` duplicate `features/library` helpers on purpose (features may not import each other's internals); lift both to `lib/` in a separate plan if you dedupe.
- Waveform is simulated (CSS), not mic-level driven; recording cap in the sheet is 60 s (page: 5 min). Device behaviour is unverified: see `docs/superpowers/plans/2026-10-14-shadow-sheet-device-checklist.md`.
- `test/render.tsx` must not import this feature (architecture rule 2 + cold-compile cost); tests wrap with `WithShadowSheet`.
```
- [ ] **Step 2:** `web/src/features/chat/CLAUDE.md`(Edit):`## Pitfalls` 末尾追加:

```
- Practice entries (hints in `conversation-page.tsx`, `grammar-details.tsx`, `recap-sheet.tsx`, `turn-detail-sheet.tsx`, `sentence-practice-sheet.tsx`) close their own sheet and then call `useShadowSheet().open(...)` from `~/features/practice`; they no longer `goPractice`. The sentence list passes only practicable sentences (≤ `MAX_PRACTICE_TEXT`) as `list`. Tests that tap these buttons wrap the UI in `WithShadowSheet` (`~/features/practice/shadow/test-utils`).
```
- [ ] **Step 3:** `web/src/features/lookup/CLAUDE.md`(Edit):`## Pitfalls` 末尾追加:

```
- 「跟读这段」(`lookup-practice`) closes the drawer, then opens the shadow sheet (`useShadowSheet` from `~/features/practice`); it no longer navigates. The sheet's sentences are `data-lookup-context` containers, so this layer's selection bar works over it (bar z-40 > sheet z-36); the word-actions panel's 「跟读这个词」 (contributed by practice's `register-word-actions.tsx`) closes its own panel and opens the sheet too; because it does not navigate, `LookupLayer` collapses the drawer itself when `useShadowSheetOpen()` turns true (only on that transition).
```
- [ ] **Step 4:** `web/src/layout/CLAUDE.md`(Edit):`- \`app-shell.tsx\` — shell with \`<Outlet>\`, bottom nav, global \`LookupLayer\`.` 改为 `- \`app-shell.tsx\` — shell with \`<Outlet>\`, bottom nav, global \`LookupLayer\` and the shadow sheet (\`ShadowSheetProvider\` wraps the shell, \`ShadowSheetHost\` sits next to \`LookupLayer\`; \`~/features/practice\`).`
- [ ] **Step 5:** `web/README.md`(Edit,只追加):在标题 `## 对话页增强(自动朗读、场景、提示、复盘、进度、词汇本、语速、难度)` 之前插入下面一条(前后各一个空行):

```
- **对话里的跟读弹窗**(计划 `2026-10-14-shadow-sheet`):对话「不会说?」提示、语法纠正、复盘、转写详情、句子列表面板、选词查词里的「跟读」不再跳到练习页,而是在原地打开底部玻璃弹窗(挂在应用壳里,与查词同层)。弹窗里:先听范读 → 录音(最长 60 秒)→ 16 kHz WAV → `POST /api/speech/assessments`(`save=true`,**不带 `source`**,所以成绩出现在「练习 → 历史」里)→ 就地显示评分环、三项分数、逐词着色(点词走选词操作条查词)、我的录音 / 标准发音、收藏、再练一次 / 下一句(多句入口带上一句 / 下一句)、「查看完整详情」(才跳到带波形的完整页)。录音或评测中关闭会先确认。弹窗本体、玻璃样式与文案随懒加载块进入,不进主包。同样的弹窗也用于「单词操作」面板的「跟读这个词」、发音弱词页、进度页弱词与段位赛练习建议;练习页自己的练习清单与详情页的「再练一次」仍是跳转。**未在真机验证:** iOS 麦克风授权与音频路由、玻璃模糊性能、选词操作条与弹窗底部按钮的叠放、弹窗在软键盘 / 视口锁下的表现,清单见 `docs/superpowers/plans/2026-10-14-shadow-sheet-device-checklist.md`。波形是模拟动画,不随麦克风音量变化。
```
- [ ] **Step 6:** Create `docs/superpowers/plans/2026-10-14-shadow-sheet-device-checklist.md`:

````markdown
# 对话里的跟读弹窗 · 真机验证清单

> **状态:未在真机验证(UNVERIFIED)。** 本清单随计划 `2026-10-14-shadow-sheet.md` 交付;下面所有勾选框在用户用真机测完之前一律保持空。
> 单元测试用的是假录音机、假评测、jsdom;它们只证明「该调用的调用了」,不证明 iOS 真的授权麦克风、真的出声、玻璃真的流畅。
> 范围:iPhone Safari(浏览器标签页与「添加到主屏幕」各测一次)与一台中低端 Android Chrome。

## 填写前先记

| 项 | 值 |
|---|---|
| 设备型号 / 系统版本 | (用户填) |
| 浏览器与是否添加到主屏幕 | (用户填) |
| 被测构建(`git rev-parse --short HEAD`) | (用户填) |
| 主包体积(`yarn web:build` 后 `node scripts/check-main-bundle.mjs --max-delta=1000`) | (用户填;**不要预先写数字**) |

## A. 十个入口(都应「原地弹出弹窗、不跳页」,参考句正确)

- [ ] A1 对话「不会说?」提示:点某条提示的话筒 → 弹窗出现,单句(没有「第 n / m 句」),提示面板已关。
- [ ] A2 语法纠正详情:点「跟读」→ 弹窗,参考句是改正后的句子;详情面板已关。
- [ ] A3 复盘:语法条目与弱词各点一次 → 弹窗,复盘面板已关。
- [ ] A4 语音 / 文字气泡的详情:点「跟读这句」→ 弹窗,参考句是这条消息。
- [ ] A5 助手回复下方「跟读」→ 句子列表 → 点第 2 句的话筒 → 弹窗显示「2 / n」,上一句 / 下一句可用,点「下一句」换句。
- [ ] A6 选中一句长文本 → 操作条 → 查词面板里「跟读这段」→ 弹窗;查词面板已关。(A7–A11 见下:第七个入口与三处按 R-S01 迁移的页面。)
- [ ] A7 「单词操作」面板(查词抽屉里单词旁的「更多」)→「跟读这个词」:面板与查词抽屉**都收起**,弹窗出现,参考句是例句(没有例句则是词本身);没有出现抽屉与弹窗叠在一起的画面。
- [ ] A8 发音弱词页(联动「发音弱词」开启时):逐词「跟读」与「连读这 5 个」→ 弹窗,留在原页。
- [ ] A9 进度页弱词的话筒 → 弹窗,留在进度页。
- [ ] A10 段位赛结果页的练习建议 → 先加入练习清单(提示不重复弹错),再弹出弹窗,留在结果页。
- [ ] A11 练习页自己的练习清单、详情页的「再练一次」**仍然是跳转到练习页输入框**(不是回归)。

## B. 录音与评测(iOS 重点)

- [ ] B1 首次点「录音」:iOS 弹出麦克风授权;允许后立即开始录音(`getUserMedia` 在点按手势里),计时走动,红色「停止」按钮出现。
- [ ] B2 拒绝授权:弹窗里出现「没有麦克风权限…」错误卡,不崩溃,按钮是「重试录音」;去设置允许后回来可重试。
- [ ] B3 先点「听范读」(正在播放)再点「录音」:范读立即停止,**范读没有被录进去**(回放「我的录音」只有自己的声音)。
- [ ] B4 录音 → 停止 → 评测中 → 出成绩;成绩与练习页同一句的成绩量级一致;「练习 → 历史」里出现这条记录。
- [ ] B5 「我的录音」可回放且声音正常(转换后的 WAV);回放中点「标准发音」,前一个立刻停止(音频互斥)。
- [ ] B6 录音中切到别的 App / 锁屏再回来:录音被保留,弹窗里出现「已保留」卡,可「评测这段录音」或「重录」。
- [ ] B7 录到 60 秒上限:自动停止并评测。
- [ ] B8 安静环境不说话录一段:提示「没听到声音」,没有产生评测请求(仅 PCM 采集路径会判定;MediaRecorder 路径不判定)。
- [ ] B9 评测失败(断网 / 服务端不可用):错误卡显示固定译文文案,录音保留,点「评测这段录音」可重试。

## C. 选词操作条与查词叠放

- [ ] C1 长按参考句选一个词:选词操作条出现在弹窗之上(z-40),**位置是否遮住弹窗底部的「听范读 / 录音」按钮?**(写下是否遮挡、遮挡多少 px;若遮挡严重,需要调整操作条的 `bottom`。)
- [ ] C2 出成绩后点逐词里的一个词:约 0.3 秒后操作条出现;点「查词」→ 查词抽屉叠在弹窗之上,可正常滚动与关闭;关闭后弹窗仍在、状态不变。
- [ ] C3 录音中 / 评测中长按参考句:操作条**不出现**(参考句暂停选词)。
- [ ] C4 查词抽屉打开时点「加入词汇本」「朗读」正常;关闭抽屉后选区被清掉。

## D. 玻璃与性能

- [ ] D1 深色与浅色各一次(「我的 → 外观」):弹窗是悬浮玻璃板(四周留边),后面的对话被模糊透出;正文对比度足够(尤其浅色下压在蓝色用户气泡上)。
- [ ] D2 iPhone Safari:模糊与饱和有效(不是纯色);边缘无明显接缝;`-webkit-backdrop-filter` 生效。
- [ ] D3 录音中(波形在动)滑动弹窗内容与滚动:是否掉帧?中低端 Android 上是否明显发热 / 卡顿?
- [ ] D4 低内存设备(`navigator.deviceMemory ≤ 4`,`<html class="lite">`):弹窗退为实色、无模糊、无动画;功能不变。可在桌面用 DevTools 给 `<html>` 手动加 `lite` 先看样子。
- [ ] D5 系统「减少动态效果」打开:入场、波形、光带、数字滚动全部静止,结果直接显示终值;「减少透明度」打开:弹窗实心。
- [ ] D6 评分环在 12 点与 6 点位置**有没有 1px 接缝**(两个半圆拼成,高分屏要看一眼)。
- [ ] D7 模拟波形是动画,不随音量变化(已知偏离设计稿的「音量驱动」,不算缺陷;记录用户是否介意)。

## E. 视口、软键盘与关闭

- [ ] E1 聊天输入框正聚焦、键盘已弹出时点「跟读」打开弹窗:键盘是否收起、弹窗位置是否正确、页面是否被顶起 / 跳动(视口锁 `html/body fixed` 下)。
- [ ] E2 竖屏 / 横屏切换:弹窗高度 ≤ 85dvh,内部滚动,按钮不被安全区遮住。
- [ ] E3 参考句很长(约 1000 字符):弹窗内容区可滚动,顶栏与关闭按钮不动。
- [ ] E4 录音中:下拉抓手、点遮罩、点 ×、系统返回手势(iOS 边缘滑动 / Android 返回)——前三者出现「放弃这次录音?」;**返回手势会直接关闭弹窗并释放麦克风**(路径变化即关,已知行为)。
- [ ] E5 「继续」回到录音(计时没有中断);「放弃」关闭弹窗,iOS 状态栏的麦克风指示灯熄灭。
- [ ] E6 来源面板(句子列表 / 复盘等,模态)关闭动画期间弹窗已出现:弹窗按钮**立刻可点**(不被 `pointer-events:none` 吃掉)。
- [ ] E7 底部导航被遮罩盖住、点不到;点遮罩 = 关闭(空闲时)。

## F. 回归抽查

- [ ] F1 练习页(`/practice`):输入文字 → 听范读 → 录音 → 评测 → 跳到详情页,行为与改动前一致(含切后台保留录音、失败重试)。
- [ ] F2 切换界面语言为英文 / 中文:弹窗文案随之切换,无 `web.practice.shadow.*` 原始键名漏出。

## 已知限制 / 设计取舍(不是缺陷,供验收时对照)

- 波形是模拟的(CSS),不随麦克风音量变化;弹窗内录音上限 60 秒(练习页 5 分钟)。
- 没有极光色块与跟随高光(设计稿的装饰,未采纳);句子列表面板保持原样式,与弹窗之间是「先关再开」,不是同一块玻璃的交叉淡入。
- 关闭弹窗没有退出动画(只有入场动画)。
- 逐词里 <70 分的词是灰色 + 波浪线(spec 的灰色语义),不是设计稿里的红色。
````
- [ ] **Step 7:** `yarn web:typecheck`(文档任务不改代码,确认没有误伤)。`cd web && yarn vitest run src/architecture.test.ts`。
- [ ] **Step 8: 提交** `docs: shadow sheet notes and device checklist`。

---

## 验证矩阵

| spec 要求 | 证明 |
|---|---|
| §3.1 共享钩子,练习页行为不变 | `use-shadow-session.test.tsx`(十个用例);`practice-page.test.tsx` **不改一字**、Task 1 前后通过数一致;`plugins/pron-shadow/practice-integration.test.tsx` |
| §3.1 全局单例弹窗挂在应用壳,懒加载 | `shadow-context.test.tsx`、`app-shell-shadow.test.tsx`;`shadow-lazy.test.ts`(Host 只经 `import()`、主包文件不静态导入懒模块、壳里 Provider 在外 Host 在 `LookupLayer` 之后) |
| §3.1 `open({text,list?,index?,source})` 调用方先关自己的面板 | 七个 spec 入口各一条测试(Task 7–12、12A):弹窗出现、参考句正确、`location` 不变、来源面板(与查词抽屉)已关;按 R-S01 迁移的三处各一条(Task 12B–12D);`lookup-layer.test.tsx` 的「collapses the drawer when the shadow sheet opens from somewhere else」 |
| §3.1 状态 `idle \| recording \| assessing \| result \| error`,保留录音以便重试 | `use-shadow-session.test.tsx`(`phase`、`kept`、重试、`discardKept`);`shadow-sheet.test.tsx`(`data-phase`、错误后重试、切后台保留) |
| §3.1 结果组件(环 + 三条分数条 + 行内着色 + 提示 + 我的录音 / 标准发音 / 收藏 + 再练 / 下一句 / 完成 + 完整详情) | `shadow-result.test.tsx`;`shadow-sheet.test.tsx`「the result actions…」「continues to the next sentence…」「opens the full detail page…」 |
| §3.1 评分色沿用 `score-tone`;不引入 wavesurfer | `shadow-result.test.tsx`(`data-tone`);`shadow/` 内无 wavesurfer / `@renderer/components/misc/wavesurfer-player` 导入(代码评审 + `architecture.test.ts`) |
| §3.2 多句入口:第 n / m 句、上一句 / 下一句;单句不显示 | `shadow-sheet.test.tsx`(列表与单句);`sentence-practice-sheet.test.tsx` |
| §3.2 录音 / 评测中关闭先确认 | Task 13 的五个用例(× / 遮罩 / Escape / 下拉 / 评测中 / 自动消失,放弃后中止上传并释放麦克风) |
| §3.2 错误显示在弹窗内,保留录音,文案沿用 `PRACTICE_SERVER_ERRORS` / `describeAudioError` | `shadow-sheet.test.tsx`(拒麦、502 译文、不含原始上游文本) |
| §3.2 录音中暂停选词操作条 | `shadow-sheet.test.tsx`「pauses the selection bar…」(`data-lookup-context` 消失) |
| §3.2 弹窗 ≤ 85dvh、内部滚动、视口锁 | `shadow-css.test.ts`(`85dvh`、`var(--app-height, 100dvh)`、`.shs-scroll` 的 `overflow-y: auto`);真机 E1–E3(未验证) |
| §3.2 `save:true` 照常保存;「查看完整详情」才导航 | `use-shadow-session.test.tsx`(FormData `save=true`、无 `source`);`shadow-sheet.test.tsx`「opens the full detail page…」 |
| §3.3 玻璃、深浅色、`.lite` / reduced-motion 降级、样式随懒加载块、不改 `theme.css` | `shadow-css.test.ts`(令牌、模糊层恰为 1、动画属性白名单、降级选择器、`@supports` 渐变字守卫、z-index);`shadow-lazy.test.ts`;视觉与性能真机 D1–D7(未验证) |
| §4 隐私:参考句、录音、评测文本不进日志与 URL;错误经固定文案 | `shadow-sheet.test.tsx` 末例(URL 不含句子文字);各错误用例断言不含原始文本;代码里无 `console.*` |
| §4 架构测试不放宽 | 每个任务都跑 `architecture.test.ts`;基线仍 19;`test/render.tsx` 不引 practice(`shadow-lazy.test.ts` 末例) |
| §4 未验证清单 | `2026-10-14-shadow-sheet-device-checklist.md`(A–F) |

## 不做

- 自动跟读模式(自动播范读后立刻录音)、弹窗内波形(wavesurfer)、改练习页的页面结构、改评测服务端(spec §4)。
- 把练习页自己的练习清单(`practice-list-page.tsx`)与详情页的「再练一次」(`assessment-page.tsx`)改成弹窗:它们就在练习 feature 里,跳回练习页输入框是本意(R-S01)。
- 麦克风音量驱动的波形(需改 `audio/` 采集引擎,R-S13);极光色块与 SpotlightCard 跟随高光(R-S19)。
- 把库与弹窗的 `word-tap` / 动效提到 `lib/` 去重(R-S07,留作单独计划)。
- 弹窗的退出动画、列表面板与弹窗之间「同一块玻璃」的交叉淡入(R-S18)。
- 改 `web/scripts/main-bundle-baseline.json`、改 `theme.css`、改 `enjoy/`、改 `server/`。

## 风险

- **练习页重构(最大风险)。** 抽钩子会动到现有练习页。缓解:Task 1 先跑基线并记通过数,钩子测试先于实现,重构后 `practice-page.test.tsx` 原样通过才算完成;默认选项下钩子与原逻辑逐字等价(`keepAudio` 默认关,不碰 `URL.createObjectURL`;`silenceError` 不传)。任何一条练习页用例失败都回头改钩子,不改练习页的测试。
- **非模态 Radix Dialog 在 jsdom / 真机上的行为未经验证。** 焦点管理、`onInteractOutside`、Escape 都按 Radix 1.1.x 的实现推断;模态弹窗打开时(查词抽屉)的 `aria-hidden` / `pointer-events` 对非模态弹窗的影响只在真机清单 C2、E6 里验证。若 Task 5 的测试在 jsdom 里与推断不符,先改测试的查询方式,不要退回模态(会让选词操作条不可点)。
- **选词操作条与弹窗底部按钮的叠放位置未验证。** 操作条固定在距底部 `4.5rem` 处,弹窗内「听范读 / 录音」大致也在这一带;若遮挡,需要调整操作条或弹窗内边距(真机清单 C1)。
- **iOS 全部行为未验证:** 麦克风授权在点按手势里、范读 / 我的录音 / 录音的音频路由切换、转换后 WAV 的回放、弹窗下的软键盘与视口锁。
- **玻璃模糊性能与耗电未验证。** 34px 模糊盖住大半屏,同时跑波形动画,中低端 Android 可能掉帧;靠 `html.lite`(`deviceMemory ≤ 4`,Safari 没有该 API 所以 iOS 永远是完整玻璃)与 reduced-motion / reduced-transparency 兜底,阈值要真机定。
- **本地重写的 `word-tap` / `shadow-fx` 与库里的版本会各自演化。** 已在 CLAUDE.md 里记录;去重是单独计划。
- **主包体积增量未实测。** 钩子 + Provider + Host 是主包代码;`check-main-bundle.mjs` 预算 0.2 kB 若被超过,在 Addendum 里记录实测数字并由用户决定是否 `--record`,不要擅自改基线。
- **懒块首次下载的延迟。** 第一次点「跟读」时弹窗块要下载,慢网下会有短暂无反应(Suspense fallback 为空);之后同会话内即时。是否预取留给真机反馈。
- **同一页面的并行改动。** `conversation-page.tsx`、`lookup-layer.tsx`、`app-shell.tsx`、`practice-page.tsx`、`progress-page.tsx`、`match-page.tsx`、`weak-words-page.tsx` 只动少数几行,但若并行计划同时改这些文件需要手工合并。
- **「单词操作」入口依赖查词抽屉的收起 effect。** 面板(模态)在抽屉(模态)之上,关闭顺序是面板 → 弹窗打开 → 抽屉由 `LookupLayer` 收起;三者在同一轮事件里切换,真机上是否出现一帧闪烁或焦点落点异常**未验证**(清单 A7)。若该 effect 与 Radix 焦点还原互相干扰,退路是让 `ShadowRow` 在 `open` 之前通过扩展点属性要求调用方先关抽屉(需要新计划)。
- **三处按 R-S01 迁移的页面没有真机验证**(弱词页受联动开关控制,默认关)。

## Addendum (2026-10-14)

用户在看过玻璃版设计稿后明确要求:**对话页平时不变,只有跟读弹窗出现时背景才变成彩色**(设计稿的 SoftAurora 效果,0.7 秒淡入,弹窗关闭后淡出)。这取代 R-S19 里「不做极光」的裁定;`docs/superpowers/specs/2026-10-14-shadow-sheet-design.md` D5 已写明。SpotlightCard 跟随高光仍不做。上文「不做」清单里关于极光的两句同样作废。

- **R-S22 弹窗背后的极光(Task 6 与 Task 5 各加一小步):**
  1. `shadow-sheet.tsx`(Task 5 的组件)在 `data-testid="shadow-scrim"` 的遮罩里面放一个 `<div className="shs-aurora" aria-hidden data-testid="shadow-aurora"><i /><i /><i /></div>`。遮罩只在弹窗打开时存在,所以「平时不变」由结构保证,不靠样式开关;关闭动画期间随遮罩一起淡出。
  2. `shadow-sheet.css`(Task 6)新增 `.shs-aurora`:`position:absolute; inset:0; overflow:hidden; pointer-events:none; opacity:0; animation: shs-aurora-in .7s ease forwards`(入场时 0 → 1),三个 `i` 为 320px 圆形色块,`filter: blur(50px)`(**元素自身的 CSS filter,不是 backdrop-filter,不计入「一屏模糊 ≤ 3」的玻璃层**;计划仍声明弹窗内玻璃层 ≤ 2),颜色取自 `--shs-blob1/2/3` 变量(深色:#4f6dff / #12b3a2 / #8f5a3a;浅色:#9db8ff / #b9f0e6 / #ffd7b0,取自 `design/video-import-v1/mockup-glass.html` 与 `shadow-sheet-v1/mockup-glass.html`),缓慢漂移动画 18s / 23s / 27s,只用 `transform`;遮罩背景色保持半透明,让彩色透出。
  3. 降级:`html.lite .shs-aurora { opacity: .5 }` 且关闭漂移动画;`@media (prefers-reduced-motion: reduce)` 下无入场与漂移动画(直接 opacity 1)。
  4. 测试:(a)Task 6 的样式守卫测试加断言:`.shs-aurora` 块含 `opacity: 0` 与 `pointer-events: none`,`.shs-aurora i` 含 `filter: blur(50px)` 且不含 `backdrop-filter`,`html.lite` 与 reduced-motion 分节里有对应规则,只动画 `transform` / `opacity`;(b)Task 5 的组件测试加断言:弹窗打开时 `shadow-aurora` 在 `shadow-scrim` 之内;弹窗关闭后两者都不在 DOM 里。
  5. 真机清单(Task 15)加一项:弹窗淡入 / 淡出时彩色背景是否出现、是否影响滚动或点击(应无),Safari 上模糊色块的帧率与耗电(未验证)。
- **入口清单**(取代 R-S01 对 spec 的「超出」):用户已确认「全部入口都改成弹窗」,所以计划里的 10 个入口(含 12B / 12C / 12D 的三处迁移)都属于范围;spec D2 已同步。
