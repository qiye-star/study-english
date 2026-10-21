# L5 影视配音 · 网页结果(W1–W11,A1 网页部分)

- 日期:2026-10-21 · 分支:`worktree-agent-a56299c9344f0b9fb`(由本车道的分支基线重置:`git reset --hard worktree-agent-ae33cce7641ad93d3`,基线 `eff09889`)
- 计划来源:`docs/superpowers/plans/10.21-plans/2026-10-21-l5-dubbing.md`、INDEX、spec §3 与 mockup §C 只存在于主检出目录(未提交);本车道只读取,没有复制进分支。
- 审批依据:**mockup §C**(`docs/superpowers/design/10.21-ui-v1/mockup.html`,用户已确认)。按指令**没有**新建 Task 0b 的设计稿;W3 起的界面任务据此开始。
- 测试口径:每个任务只跑它列出的测试文件 + `yarn web:typecheck`;没有推送,没有动主检出目录,没有重建或重启容器,没有跑 E2E。
- 服务端(S1–S12)只读:`server/` 没有改动;契约夹具 `server/tests/fixtures/dubbing_contract.json` 来自 `eff09889` 的服务端车道。

## 结果一览

| 任务 | 状态 | 提交 | 验证命令 → 结果 |
|---|---|---|---|
| W1 懒加载工具包 `dubbing-kit` | 完成 | `fd3ae94a` | `vitest run src/features/library` → 64 文件通过;`web:typecheck` → 0 |
| W2 骨架、接口、文案、契约测试 | 完成 | `6f13d91e` | `vitest run src/features/dubbing src/architecture.test.ts` → 5 文件 30 测试通过;typecheck → 0 |
| W3 片段与窗口(纯函数) | 完成 | `ca01d096` | `clip.test.ts windows.test.ts` → 27 通过 |
| W4 录制时间轴调度器 | 完成 | `759753ca` | `take-scheduler.test.ts` → 8 通过;typecheck → 0 |
| W5 整段采集与切片 | 完成 | `518af3d4` | `take-capture.test.ts src/audio` → 18 文件 235 测试通过;typecheck → 0 |
| W6 评测队列与录制编排 | 完成 | `346b0227` | `src/features/dubbing src/architecture.test.ts` → 12 文件 94 测试通过;typecheck → 0 |
| W7 入口卡、`/dub` 选素材页、路由 | 完成(`/dub/:itemId` 路由在 W8 加入,见偏差) | `55e09569` | `src/features/dubbing src/plugins src/architecture.test.ts src/features/library/library-lazy.test.ts` → 33 文件 通过;typecheck → 0 |
| W8 选片段、角色标注、选角色 | 完成 | `411a27ca` | `src/features/dubbing src/plugins src/architecture.test.ts` → 35 文件 198 测试通过;typecheck → 0 |
| W9 彩排与录制界面 | 完成 | `9c8df604` | `src/features/dubbing src/plugins src/architecture.test.ts` → 39 文件 214 测试通过;`src/styles/glass-budget.test.ts` → 5 通过;typecheck → 0 |
| W10 结果页与原声 / 我的回放 | 完成(ScoreCard 详情未做,见偏差) | `cdca2193` | `src/features/dubbing src/plugins src/architecture.test.ts` → 41 文件 226 测试通过;typecheck → 0 |
| W11 文档与真机清单 | 完成 | `4e39c778` | 同上;文档只改 `web/README.md`、`web/src/features/dubbing/CLAUDE.md` 与清单 |
| A1 网页部分 | 无需做 | — | 计划的 A1 全部在 `admin/`(`admin/src/features/catalog/`),网页没有钩子点;本车道未触碰 `admin/` |
| Task 0b 设计稿 | 未做(按指令) | — | 以 mockup §C 为审批依据 |

最后一轮(全部改动完成后):`vitest run src/features/library src/features/dubbing src/plugins src/architecture.test.ts src/styles/glass-budget.test.ts` → **106 文件,718 通过,1 跳过**(跳过的一项在 library 中已存在,与本车道无关);`yarn web:typecheck` → **0**。

## 逐任务记录

### W1 懒加载工具包(`fd3ae94a`)
- 新增 `web/src/features/library/dubbing-kit.ts`(只做再导出:`PlayerController`、`segmentIndexAt`、`Frames`/`MediaLike` 类型、`useMediaSource`、`LIBRARY_SERVER_ERRORS`、`getItem`、`isItemNotFound`、`listItems`、`tokenizeSentence`、`usePosterUrl`、`ScoreCard`)。
- `index.ts` 加两行:`export const loadDubbingKit = () => import("./dubbing-kit")` 与 `DubbingKit` 类型(不是 `export … from`,守卫不把它当静态导出)。
- 测试:`library-lazy.test.ts` 的 `LAZY_ONLY` 加 `dubbing-kit`,新断言;`dubbing-kit.test.ts` 钉住导出名集合。
- 偏差:`dubbing-kit.test.ts` 加了 30 s 超时。全目录并行时首次动态导入曾超过默认 5 s(一次性,单独运行通过);断言未改。

### W2 骨架、接口、文案(`6f13d91e`)
- `dubbing-api.ts`:全部 HTTP 调用与类型(驼峰,对应契约夹具);`DUBBING_SERVER_ERRORS` 与夹具的 16 个错误文本逐一对应;`isDubbingNotFound` / `isAiLimited` / `isAiUnavailable` 按状态码判断。
- `config.ts`(按 `ApiClient` 缓存,失败视为关闭,失败不缓存)、`use-dubbing-enabled.ts`、`index.ts`、`loader.ts`、`kit-context.tsx`、`locales.ts`、`locales/{en,zh-CN}.json`、`CLAUDE.md`。
- 测试:`dubbing-contract.test.ts`(键集合逐一相等,错误文本覆盖)、`dubbing-api.test.ts`、`locales.test.ts`(两语键一致、占位符一致、无空串、无 emoji)、`dubbing-lazy.test.ts`(主包守卫)。
- `architecture.test.ts`:基线加 `dubbing->library`,计数 19 → 20。

### W3 片段与窗口(`ca01d096`)
- `clip.ts`:`selectRange`(第一次点起点、第二次点终点、反向交换、第三次重新开始)、`clipStats`、`clipProblem`(码与服务端 R6 一致:`clip`、`clip_too_long`、`role_missing`)。
- `windows.ts`:`lineWindows`(−300 / +600 ms,被对方句子夹住,相邻重叠在间隙中点切开)、`muteAt`、`countdownAt`(3-2-1)、`phaseAt`。
- 测试 27 个,逐个分支手算核对。

### W4 录制时间轴调度器(`759753ca`)
- `take-scheduler.ts`:开始时跳到片段起点前的引导量(默认 1500 ms)、按窗口静音、窗口开 / 关各回调一次、片段结束加尾巴后暂停并回调、系统打断只报告一次、回跳不重开已关闭窗口、`destroy` 恢复不静音。
- 新增 `createTakeFrames()`(requestAnimationFrame 包装)供真实使用。

### W5 整段采集与切片(`518af3d4`)
- `take-capture.ts`:`startTakeCapture` 同步调用采集器(测试断言 `startPcm` 在 `start` 返回前被调用);PCM 路径只保留窗口内的帧、不裁静音、无声段不出 WAV、`voicedMs` 来自 `speechRuns`;回落路径整段录音,`finish()` 时按相对录音起点切片;轨道结束与切后台都视为打断并释放麦克风。
- 依赖经 `CaptureDeps` 注入(真实实现在 `browserCaptureDeps()`,只在 `use-dub-take.ts` 使用)。
- `src/audio` 没有改动;`src/audio` 测试在同一次运行中通过。

### W6 评测队列与录制编排(`346b0227`)
- `line-queue.ts`:并发 2;无声段不发请求(`no_speech`);评测失败按 `PRACTICE_SERVER_ERRORS` / `DUBBING_SERVER_ERRORS` 映射文案键;`drain(timeoutMs)` 超时的剩余与在途记 `timeout` 并取消;`abort()` 之后不再 `post`。
- `take-runner.ts`:状态机(`idle → starting → recording → finishing → done | error | interrupted`);顺序是 **开麦 → 放视频 → 等建 take**;建 take 失败释放麦克风、停止播放并进入 `error`;每句 WAV 的 object URL 在 `dispose` 时撤销。
- `use-dub-take.ts`:薄的 React 入口,真实依赖都在 `makeDeps` 里。
- 架构基线加 `dubbing->practice`,计数 20 → 21(`line-queue.ts` 是第一个真正的 practice 导入)。

### W7 入口卡与 `/dub`(`55e09569`)
- `register.tsx`(只被 `plugins/core.ts` 导入;`practiceHome` 核心贡献 `dubbing.entry`,order 10)、`entry-card.tsx`(配置关闭时渲染 `null`,开启时链接 `/dub`)、`dub-home-page.tsx`(只列 ready 且 ≥ 2 句的条目;角色状态按需取,失败不阻塞;「下一页」;空状态;配置关闭 → `/practice`)、`lazy-pages.tsx`(`DubHomeRoute` 懒加载)。
- `links-matrix.test.tsx`:全关与全开两处的 `practiceHome` 期望都加了 `dubbing.entry`(它是核心贡献,不受联动开关影响)。
- `app.tsx` 加 `/dub`。

### W8 选片段、角色标注、选角色(`411a27ca`)
- `clip-picker.tsx`(`clipReadiness`:与服务端同码;role 为 `null` 时只查范围与长度)、`role-labels.tsx`(循环 无 → A → … → F → 无;600 ms 防抖合并 PUT,只发改动句;卸载时提交;精选副本只读并显示说明;智能建议只出草稿,「采用」才进入保存;429 显示每日上限文案)、`role-picker.tsx`(句数 0 的角色不可选;改名 ≤ 24 字符,空名清除;副本不可改名)。
- `dub-item-page.tsx`(`/dub/:itemId`,加在本任务里)。
- 测试:16 个(`clip-picker` 5、`role-labels` 7、`role-picker` 4),覆盖循环、防抖与只保存改动、只读、建议草稿与采用、429 文案、句数与改名上限。

### W9 彩排与录制界面(`9c8df604`)
- `karaoke.ts`(按字母数线性估计词时间;标点至少算 1;减少动态效果时整句一次点亮)、`headphone-hint.tsx`(首次提示,localStorage 读写包 try/catch)、`rehearsal-view.tsx`(自己的句子 `data-mine` 加强;「开始录制」的 `onStart` 在点按事件里同步调用)、`recording-view.tsx`(倒计时、「轮到你」、逐句状态点、停止先确认)、`stage.tsx`(视频舞台,票据经 kit 的 `useMediaSource`)、`dub-session.tsx`(彩排与录制的会话,见偏差)。
- `take-runner.ts` 增加 `outcomes()`(录制中逐句状态);`use-dub-take.ts` 每 500 ms 轮询刷新。
- 测试:`karaoke.test.ts`、`headphone-hint.test.tsx`、`rehearsal-view.test.tsx`、`recording-view.test.tsx`;`take-runner.test.ts` 增加一项。

### W10 结果页(`cdca2193`)
- `compare-player.ts`:原声与我的互斥;音频焦点只在从空闲开始时申请一次;别的声音抢走焦点即停止;快速连点不叠音。
- `results-view.tsx`(总分与三项子分;逐句的分数、同步依据标签「按时间」/「按时长」/「无同步分」;缺句原因(客户端原因优先于服务端的 `not_recorded`);「句子已变化」;「原声」「我的」按钮;「再录一遍」「换片段」)、`dub-results.tsx`(装配:原声用视频舞台按句播放,`createTakeScheduler` 无窗口、不静音;播放器只创建一次,元素与句子经 ref 读取,避免重渲染停止播放)。
- 测试:`compare-player.test.ts` 6 个、`results-view.test.tsx` 6 个。

### W11 文档与真机清单(`4e39c778`)
- `web/README.md` 加「影视配音(计划 L5)」一节(入口、行为、未做、未验证、清单链接),放在「选词操作条」之前。
- `web/src/features/dubbing/CLAUDE.md` 补全文件清单与分层。
- `docs/superpowers/plans/10.21-plans/2026-10-21-l5-dubbing-device-checklist.md`:计划的 10 条设备清单,结果栏为空,全部标「未验证」。

## 偏差(与计划不同之处)

1. **Task 0b 未做**:按指令,以 mockup §C 为审批依据,没有新建设计稿。
2. **计划文件不在分支上**:只在主检出目录(未提交),本车道只读取。
3. **W1**:`dubbing-kit.test.ts` 加了 30 s 超时(全目录并行时一次性超时,断言未改)。
4. **W2**:`dubbing->practice` 基线推迟到 W6(那时才有真正的 practice 导入);计数 20(W2)→ 21(W6)。`lazy-pages.tsx` 推迟到 W7,W2 用 `loader.ts` 承担懒加载入口。西语文件未创建(R20 修订:只有 en 与 zh-CN)。
5. **W3**:`clipStats` 与 `clipReadiness` 带 `role` 参数;假设 `segs[i].idx === i`。
6. **W4**:新增 `createTakeFrames()`(计划未列)。
7. **W5**:采集依赖经 `CaptureDeps` 注入(计划写的是直接调用 `startPcmCapture` 等);`close(idx, mediaMs?)` 增加了可选的 `mediaMs`(回落路径需要);PCM 帧复制一份保存。
8. **W6**:编排的主体在 `take-runner.ts`(纯状态机),`use-dub-take.ts` 只是薄的 React 入口;计划里对 hook 的测试(真实采集的调用顺序)改为 runner 的假件测试加一个 hook 测试(mock 掉 runner)。
9. **W7**:`/dub/:itemId` 路由在 W8 加入(计划写在 W7);选素材页没有封面(没有用 `usePosterUrl`)。
10. **W8**:`dub-item-page.tsx` 没有单独的测试文件(由组件测试覆盖);建议接口的 503 文案只有代码路径,没有测试(429 有测试)。
11. **W9**:计划文件表里没有的文件:`dub-session.tsx`(彩排与录制的会话装配)与 `stage.tsx`;`dub-session.tsx` 与 `stage.tsx` 没有单独的测试(由类型检查与组件测试间接覆盖)。
12. **W10**:
    - **ScoreCard 详情弹层未做。** `ScoreCard` 的 `save` 需要库内部的 `SaveSentenceState` 与练习的保存流程,kit 没有导出;没有为此改动 library(R18 只允许加法,而这需要更多)。
    - **「从列表打开旧录音」与「未完成」列表未做。** 页面上没有列出历史录音的入口;「句子已变化」只在结果数据里出现。
    - `dub-results.tsx`(装配)没有单独的测试。
13. **服务端字段(R15/R11 的实现细节)**:网页端把角色名的键经 `decamelize` 转成小写(`"A"` → `"a"`),服务端的 `clean_role` 会转成大写。这是读代码确认的,没有发出真实请求验证。
14. **A1 网页部分**:计划的 A1 全部在 `admin/`,网页没有对应的钩子点,未做;`admin/` 未触碰,admin 测试未跑。

## 未验证(真机与真实上游)

- **真机(清单见 `2026-10-21-l5-dubbing-device-checklist.md`,全部未验证):** iOS / Android 上播放视频同时开麦的音频会话与回声;切后台、来电、锁屏后的停止与麦克风指示灯;PCM 与 MediaRecorder 哪条路径实际生效;蓝牙耳机的延迟;`beg_pos` 的实际起点与精度。
- **真实上游:** 讯飞 ISE 的逐词偏移(R12 a–c)、Omission 词的偏移、真实 LLM 的建议质量(所有测试都是假件)。
- **占位数值(未校准):** 12 句 / 90 秒、窗口 −300 / +600 ms、±400 ms 容忍、权重 60/20/20、并发 2、等待 60 s、建议额度。
- **字幕高亮** 是线性估计,不是真实词时间。
- **视觉:** 布局按 mockup §C 的结构实现,但没有对照设计稿做像素级检查;液态玻璃的层数只通过 `glass-budget.test.ts` 间接确认(本车道没有新增 `backdrop-filter` 或 `@keyframes`)。
- **浏览器中的实际播放** 没有在任何浏览器里打开过;所有组件都只在 jsdom 中测试。

## 未运行

- `yarn web:build`(计划 W10 要求确认 dubbing 与 kit 不进主包):按指令没有运行,**懒加载分块未验证**。
- 全量 `yarn web:test`、E2E(`yarn web:e2e`)、admin 测试、服务端测试:按指令没有运行。
- 容器构建 / 重启、推送:没有做。
- 服务端 `server/.env.example` 的两行(`DUBBING_ENABLED=false`、`DUBBING_SUGGEST_DAILY_PER_USER=120`)仍归 L1,本车道没有改(R22)。

## 合并注意

- 迁移号与服务端一致:本车道的网页改动不涉及迁移。
- 共享文件的锚点改动:`web/src/app.tsx`(两处:`/dub`、`/dub/:itemId`)、`web/src/plugins/core.ts`(一行)、`web/src/plugins/links-matrix.test.tsx`(两处期望)、`web/src/architecture.test.ts`(基线与计数)、`web/src/features/library/index.ts`(两行)、`web/src/features/library/library-lazy.test.ts`(一项与一条断言),合并时与 L1 / L3 / L4 / L6 的同文件改动可能冲突,按 INDEX §6 手工解决。
- 本车道没有改 `web/src/audio/**`、`features/rooms`、`features/chat` 或 `enjoy/`。
