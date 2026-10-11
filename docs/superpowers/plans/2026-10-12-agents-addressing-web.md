# 智能体免 @ 对话 · 网页计划(addressing W)Implementation Plan

> **执行前先读 `docs/superpowers/plans/2026-10-12-agents-INDEX.md`(X7、X11、X12、X13 仍然有效)与将来的 `plans/2026-10-12-agents-addressing-INDEX.md`(若已存在,与本计划冲突时以它为准)。**
> 服务端计划 `plans/2026-10-12-agents-addressing-server.md` **先合并**;本计划消费的线上名字全部列在末尾「Cross-plan assumptions」,Task P1/P2 的契约测试逐条钉住。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在联机房间里做「对象」标签(`对 Emma 说`,两个智能体时可选其一;按用户 + 房间记在本机;带练开始自动打开、结束 / 停止 / 房间关闭自动关闭,无空闲关闭;每条文字发言带 `to`、每条语音带 `to_agent`;常驻提示「消息会交给 Emma」;静音 / 公共 AI 关闭 / 角色停用时置灰并说明;回复智能体时显示「回复 Emma 中」)、`@` 补全(含「AI(默认智能体名)」别名,键盘 + 触屏,不打断输入法组字)、带练语音回答的界面(「直接说」「识别中…」「没听清,再说一次」)、朗读兜底 `speechText()`(任何朗读路径都不读中文 / 假名 / 全角标点)、「中文」折叠按钮(联机气泡、1:1 气泡、两种带练条的 `hint_zh`)、设置页 `zh_note`(自动 / 总是 / 从不);协议只做加法,新文案全部懒加载,主包增量 ≤ 0.2 kB gzip。

**Architecture:** 所有新逻辑放在已经懒加载的块里:房间侧在 `features/rooms/agents/`(纯模块 `target.ts`、`mention-suggest.ts`、`tutor-voice.ts` + 钩子 `use-agent-target.ts` + 组件 `target-row.tsx`),文案在新的懒加载目录 `rooms/agents/locales/`(不进 `**/i18n/*.json` 的主包 glob);1:1 侧经 `~/features/agents` 的懒包装 `AgentNote` 与纯函数 `withNote`;折叠按钮本体是无文案的低层组件 `components/zh-note-fold.tsx`(调用方传入已翻译的标签);朗读兜底是 `lib/speech-text.ts`,在 `chat/tts.ts` 的 `speakableText()` 末尾调用一次,`useTtsPlayer` 的 `play()` 与逐句队列、`useAutoSpeak` 的判断、带练「听一遍」因此全部经过它。`room-page.tsx` 只增加接线(Addendum AW-1)。不新增跨 feature 边(`rooms->agents`、`rooms->chat`、`chat->agents` 都已存在)。

**Tech Stack:** React 18 + TypeScript + Tailwind 3(redesign v3 令牌)+ lucide-react + i18next;vitest + Testing Library + user-event + jsdom;Playwright(chromium-mobile)。不新增依赖(性质测试用手写的种子随机数,不引入 fast-check)。

**Spec:** `docs/superpowers/specs/2026-10-12-agents-addressing-design.md`(D1–D5、§3、§4 的提示文案、§5、§7、§9);背景 `specs/2026-10-12-agents-design.md`;计划结构参照 `plans/2026-10-12-agents-web.md`(A4)与 `plans/2026-10-12-agents-rooms.md` 的 W 车道。

## Global Constraints

- **只增不改的协议**:`say` 只在「对象」生效时多一个 `to` 键(关闭时帧与现在逐字节相同,`protocol.test.ts` 现有的精确字符串断言不动);语音上传只在生效时多一个 `to_agent` 表单字段(`voice-contract.test.ts` 现有的「三个字段」断言不动)。
- **服务端是权威**:网页对「这条消息会交给谁」的显示只是提示;路由、配额、`agent_off` / `ai_quota` / `ai_busy` 全由服务端决定,网页只显示已有的 notice 横幅。
- **隐私**(spec §7、根 `CLAUDE.md`):`to` 只是角色 id;消息正文、转写、`note_zh`、`hint_zh` 不进 URL、日志、`console.*`、错误对象、测试快照;票据不出现在任何断言输出里(沿用 `room-page-agents.test.tsx` 的 `not.toContain("secret-ticket")`)。
- **朗读**:`note_zh` / `hint_zh` 从不拼进任何朗读入口的文本;朗读入口只取消息正文,并经 `speechText()` 去掉中文。
- **无计时器**:「对象」的自动开关只由状态推出(带练帧、带练结束的系统消息、房间关闭、REST 名单),不用 `setTimeout` / `setInterval`(D2)。
- **i18n**(INDEX X11):新文案 en 与 zh-CN 键集相同;房间侧放 `features/rooms/agents/locales/{en,zh-CN}.json`(键在 `web.rooms.*` 下),1:1 / 设置页放 `features/agents/locales/`(`web.agents.*`),带练条放 `features/agents/tutor/locales/`。**不往任何 `i18n/*.json`(主包)加键**。已有主包文案里的 `@ai` 字样不改(`@ai` 仍是有效别名,R-AW1)。
- **体积**(INDEX X12):主包(入口块 + modulepreload 块)gzip 增量 ≤ 0.2 kB,以 P0 记录的基线为准,`node web/scripts/check-main-bundle.mjs` 判定;Z1 报告前后数字。
- **一色一义 / 触控**:蓝 = 操作 / 进行中(「对象」按下态、提示文字),中性 = 说明;触控 ≥ 44 px(`h-tap`、`hit-expand`);减少动态(`motion-reduce:`);360 px 不横向滚动;界面不用 emoji;只用 `theme.css` 令牌。
- **架构**:`web/src/architecture.test.ts` 的冻结边保持 18 条;`agents/tutor/` 仍只可导入 `../locales`(可以导入 `~/components/*`);`room-page.tsx` 的改动只限 Addendum AW-1 列出的接线。
- **每个任务结束**:`yarn web:typecheck` + 任务列出的 vitest 文件 + `cd web && yarn vitest run src/architecture.test.ts`。车道合并前 `yarn web:typecheck && yarn web:test && yarn web:build`。提交 conventional(`feat(web): …`、`test(web): …`、`chore(web): …`、`docs: …`),一个任务一个提交,信息以 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾。
- **写计划时的实跑**:本计划的代码与测试**没有在写计划时运行过**,只核对了真实源码(`room-composer.tsx`、`room-page.tsx`、`use-room.ts`、`room-state.ts`、`protocol.ts`(+ `server/app/rooms/protocol.py`)、`rooms/agents/*`、`rooms/voice/{use-room-voice,voice-api,voice-input}.ts(x)`、`rooms/extras/text-tools.ts`、`room-message-list.tsx`、`chat/{tts,use-auto-speak,use-tts-player,message-bubble,conversation-page,ui-message,trace-save}.ts(x)`、`agents/{types,sse,trace,turn-stream,use-agent-turn,lazy-parts,index,locales,agent-settings-page}.ts(x)`、`agents/tutor/{tutor-api,tutor-bar,tutor-bar-panel,use-tutor-session}.ts(x)`、契约夹具与契约测试、`architecture.test.ts`、`lib/storage.ts`、`components/segmented-control.tsx`、`test/{render,fetch-mock}.tsx`)。执行者第一次运行时以真实结果为准修正选择器与文案断言,但不得改动本计划的裁定与接口名。

---

## 文件结构与共享文件插入点

```
web/src/lib/speech-text.ts (+ .test.ts)                       新:朗读兜底 speechText()
web/src/components/zh-note-fold.tsx (+ .test.tsx)             新:「中文」折叠(无文案,标签由调用方传入)
web/src/features/rooms/
  protocol.ts                 say.to、notice voice_unclear、RoomTutorInfo.hintZh、ROOM_NOTICE_VOICE_UNCLEAR
  room-state.ts               PendingSay.to
  use-room.ts                 say(text, assistId, replyTo, to)
  room-composer.tsx           @ 补全(combobox + listbox)、groupPlaceholder、mentions 属性
  room-message-list.tsx       联机气泡下的「中文」、朗读按钮按 spokenText 显示
  room-page.tsx               Addendum AW-1 接线
  agents/
    locales.ts  locales/en.json  locales/zh-CN.json  locales.test.ts     新:房间侧懒加载文案
    target.ts (+ .test.ts)            新:「对象」纯逻辑(状态、自动开关、收件人、置灰原因、存储)
    use-agent-target.ts (+ .test.tsx) 新:钩子
    target-row.tsx (+ .test.tsx)      新:「对 Emma 说」行
    mention-suggest.ts (+ .test.ts)   新:@ 补全纯逻辑
    tutor-voice.ts (+ .test.ts)       新:带练语音识别状态
    agent-meta.ts                     AgentAnswerMeta.noteZh
    tutor-bar.tsx                     「直接说」、识别中 / 没听清、hint_zh 折叠
  extras/text-tools.ts (+ 新 .test.ts) spokenText()
  voice/voice-api.ts  voice/use-room-voice.ts  voice/voice-contract.test.ts
web/src/features/agents/
  types.ts  sse.ts  trace.ts  turn-stream.ts  index.ts  lazy-parts.tsx  agent-note.tsx(新)
  agent-settings-page.tsx  locales/{en,zh-CN}.json  agents-contract.test.ts
  tutor/{tutor-api.ts,use-tutor-session.ts,tutor-bar.tsx,tutor-bar-panel.tsx,locales/*.json,tutor-contract.test.ts}
web/src/features/chat/
  tts.ts  message-bubble.tsx  conversation-page.tsx  (+ 测试)
web/e2e/agents-addressing.spec.ts(新)  web/e2e/CLAUDE.md
web/scripts/main-bundle-baseline.json(P0 重录)
文档:features/rooms/CLAUDE.md、features/agents/CLAUDE.md、features/chat/CLAUDE.md、src/lib/CLAUDE.md、src/components/CLAUDE.md、web/README.md、docs/superpowers/plans/e2e-results.md
```

| 共享文件 | 本计划的插入点 |
|---|---|
| `web/src/features/agents/index.ts` | 文件末尾新起一段 `// ---- addressing (plan 2026-10-12-agents-addressing-web) ----`;P2 追加 `withNote`,N3 追加 `AgentNote`,只追加 |
| `web/src/features/agents/lazy-parts.tsx` | `// ---- parts ----` 段末尾追加一行 `AgentNote`(N3) |
| `web/src/features/agents/locales/{en,zh-CN}.json` | `web.agents` 下新增 `note` 对象;`web.agents.settings` 末尾追加 `zhNote`、`zhNoteHint`、`zhNoteModes`;`web.agents.settings.groups` 末尾追加 `language`(P0) |
| `web/src/features/agents/tutor/locales/{en,zh-CN}.json` | `web.agents.tutor.bar` 末尾追加 `zhShow`、`zhHide`(P0) |
| `web/src/features/rooms/room-page.tsx` | 只做 Addendum AW-1 的接线(C3) |
| `web/src/features/rooms/agents/room-page-agents.test.tsx` | M2 把一处 `getByRole("textbox")` 改为 `getByRole("combobox")`;C3 追加用例 |
| `web/scripts/main-bundle-baseline.json` | P0 `--record` 一次;Z1 不重录,只比较 |

## 并行车道、文件归属与合并顺序

| 车道 | 任务 | 独占文件 | 依赖 |
|---|---|---|---|
| **P 协议 / 类型 / 文案**(串行,最先) | P0–P3 | `rooms/agents/locales*`、`rooms/protocol.ts(+test)`、`room-state.ts(+test)`、`use-room.ts`、`rooms/agents/agent-meta.ts`、`agent-state.test.ts`、`room-agents-contract.test.ts`;`agents/{types,sse,trace,turn-stream}.ts(+tests)`、`agents-contract.test.ts`、`agent-settings-page.tsx(+test)`、两份 agents `locales/*.json`、`index.ts` 的 P2 一行;`scripts/main-bundle-baseline.json` | 服务端计划已合并(夹具已重录) |
| **S 朗读兜底** | S1 | `lib/speech-text.ts(+test)`、`chat/tts.ts`、`chat/tts.test.ts`、`chat/use-auto-speak.test.tsx`、`rooms/extras/text-tools.ts`、`extras/text-tools.test.ts`(新) | 无 |
| **N 中文折叠** | N1–N3 | `components/zh-note-fold.tsx(+test)`、`room-message-list.tsx`、`agents/agent-messages.test.tsx`、`agents/agent-note.tsx`、`lazy-parts.tsx` 与 `index.ts` 的 N3 一行、`chat/message-bubble.tsx`、`chat/conversation-page.tsx`、`chat/conversation-page.agent.test.tsx`、`chat/trace-save.test.ts`、`chat/ui-message.agent.test.ts` | P2(类型)、S1(`spokenText`) |
| **V 语音** | V1 | `voice/voice-api.ts`、`voice/use-room-voice.ts(+test)`、`voice/voice-contract.test.ts` | P0(文案)、P1 |
| **T 带练条** | T1–T2 | `rooms/agents/tutor-bar.tsx`、`tutor-voice.ts(+test)`、`agents/tutor.test.tsx`;`agents/tutor/{tutor-api.ts,use-tutor-session.ts,tutor-bar.tsx,tutor-bar-panel.tsx,tutor-bar.test.tsx,tutor-bar-panel.test.tsx,tutor-contract.test.ts}` | P1、N1 |
| **M @ 补全** | M1–M2 | `rooms/agents/mention-suggest.ts(+test)`、`room-composer.tsx(+test)`、`room-page-agents.test.tsx` 的一处 | P0 |
| **C 「对象」** | C1–C3 | `rooms/agents/{target,use-agent-target,target-row}.ts(x)(+tests)`、`room-page.tsx`、`room-page-agents.test.tsx` 的新用例 | P1、M2、V1、T1 |
| **Z 收尾** | Z1–Z2 | 各层 `CLAUDE.md`、`web/README.md`、`web/e2e/agents-addressing.spec.ts`、`web/e2e/CLAUDE.md`、`docs/superpowers/plans/e2e-results.md` | 全部 |

**本计划内合并顺序**:P0 → P1 → P2 → P3 → S1 → N1 → N2 → N3 → V1 → T1 → T2 → M1 → M2 → C1 → C2 → C3 → Z1 → Z2。(S1、N1、M1、C1 是纯模块,可以并行开发,合并按此顺序。)

**跨计划**:服务端计划(S)全部合并 → 本计划(W)→ addressing INDEX 对齐。理由:P1/P2 的契约测试读服务端重录后的夹具与源码(`SayMsg.to`、`form.get("to_agent")`、`code="voice_unclear"`、`zh_note`、`note_zh`)。

**评审波**:C 车道合并前 `/code-review high`(自动开关的状态推导是本计划风险最高的部分);M、N 车道合并前各一次;全部合并后 `security-review`(URL / 日志 / 错误里没有正文、转写、中文说明、票据);视觉对照:浏览器窗格 375×812 与 360×740,浅色 + 深色,`room-target-row`、`room-mention-list`、三处「中文」折叠。

---

## 本计划的裁定

- **R-AW1 房间侧新文案懒加载;已有主包文案不改。** Ruling:新键放在 `features/rooms/agents/locales/{en,zh-CN}.json`,由 `rooms/agents/locales.ts` 在模块求值时 `addResourceBundle(deep, no-overwrite)`;用到这些键的模块(`target-row.tsx`、`tutor-bar.tsx`、`room-composer.tsx`、`room-message-list.tsx`)都 `import "./locales"`(或 `./agents/locales`),它们只在懒加载的房间页块里。新增的 notice `web.rooms.notice.voice_unclear` 也在懒加载文件里;`voice-contract.test.ts` 的「每个 notice 都有文案」检查改为合并主包文案与这份懒加载文案(V1)。主包里的「说点什么,或 @ai 提问」「回答中断,可以重新 @ai」等不改值:`@ai` 仍是有效别名;占位符改为在页面里传入懒加载的 `web.rooms.agents.composer.placeholder`(显示默认智能体名)。*为什么*:INDEX X11/X12 与本任务要求新文案不进主包。*若错*(评审要求所有房间文案都在 `i18n/`):把两份 JSON 合并进 `rooms/agents/i18n/`,主包约 +0.5 kB gzip。
- **R-AW2 `to` 只在生效时发送,并钉住服务端字段。** Ruling:`encodeSay` 只在 `to` 是非空字符串时写入 `to` 键(截到 `ROOM_LIMITS.id` = 64);`protocol.test.ts` 读 `server/app/rooms/protocol.py`,断言 `SayMsg` 有 `to: str | None` 字段、`PROTOCOL_VERSION` 与 `ROOM_PROTOCOL_VERSION` 相等。*为什么*:服务端 `_Msg` 是 `extra="forbid"`,未知键会被当成协议错误;同源部署下网页与服务端一起发布,但测试必须在服务端字段改名时失败。*若错*:服务端若把字段叫别的名字,只改 `encodeSay` 一处与测试正则。
- **R-AW3 轮到我答带练时不带 `to` / `to_agent`。** Ruling:`myTutorTurn(tutor, meId)` 为真(`phase === "await_answer"` 且 `currentUserId === 我`)时,页面传给 `say` 与语音的目标都是 `null`。*为什么*:spec §3.2 第 3 条说轮到你时「不需要开对象也不需要 @」,而 D2 让「对象」在带练开始时自动打开;两者叠加时同一条回答可能既被带练收下、又被路由成一次普通回合(spec §3.4「至多触发一个智能体回合」只列了 @ / 回复 / to 的优先级,没有列带练)。网页侧不带目标,不依赖服务端怎么排优先级。*代价*:轮到我时想顺便问智能体一个别的问题,需要等轮次过去或用 `@名字`(`@` 仍然生效,由服务端决定)。
- **R-AW4 「对象」的自动开关由状态推出。** Ruling:`target.ts::nextTarget` 只看四样东西:① `agent_tutor` 帧的签名 `startedBy:personaId:stepsTotal`(帧里没有会话 id)第一次出现 → 打开并对准带练角色,记下 `auto = {sig, sinceSeq}`(`sinceSeq = max(lastSeq, liveFrom)`);② `seq > sinceSeq` 的系统消息 `tutor_stopped` / `tutor_done`(服务端 `agent_tutor.py` 写入)→ 关闭;③ 房间结束(`status === "closed"` 或 `room.status === "closed"`)→ 关闭;④ 本页从本机存储恢复了 `auto`,而第一次读到的 `GET /api/rooms/{id}/agents` 的 `tutor` 为 `null`、本页也没收到带练帧 → 关闭(带练在离开期间结束、结束消息又不在补发页里时的兜底)。同一签名不会重复自动打开(重连时 `welcome` 先把带练清空、随后重发同一帧,用户中途手动关掉的不会被重新打开);结束时若帧还没清空,把签名记进 `ended`,帧变成 `null` 时清掉 `ended`,所以同一房主用同一角色、同样题数再开一次仍会自动打开。没有任何计时器。*若错*:签名相同、且结束消息与帧清空都丢失的极端情况下,下一次带练不会自动打开(用户可手动打开)。
- **R-AW5 默认智能体 = 房主选择的第一个;没有配置智能体时不显示「对象」。** Ruling:页面按 `room.agentIds` 的顺序排列 `GET /agents` 返回的角色,第一个是默认(spec §4);没有配置任何智能体时,`@` 补全只有「AI」别名(没有真名),占位符用 `placeholderNoName`,「对象」行不显示。*为什么*:spec §3.4 要求服务端只接受「属于本房间 `agents` 配置」的 `to`,内置 `builtin:coach` 只在没有配置时作为 `@ai` 的去处,不能作为 `to`;网页也拿不到它在房间里的名字(`GET /agents` 只在有配置时请求)。*若错*:服务端若把内置默认角色也放进 `GET /agents`,`roomAgents` 自然非空,「对象」自动出现,无需改代码。
- **R-AW6 自动打开对准带练角色;角色离开房间时回落到默认。** Ruling:自动打开时 `personaId = tutor.personaId`;任何时候 `personaId` 不在当前名单里(房主换了智能体),显示与发送都回落到默认智能体;名单为空时视为关闭。
- **R-AW7 提示显示「实际收件人」。** Ruling:「对象」行的状态文字按服务端优先级推算:`@ai` 别名 → 默认智能体;`@名字` → 该角色;引用了智能体的回复 → 那个智能体(显示「回复 Emma 中 · 消息会交给 Emma」);否则「对象」生效时 → 「消息会交给 Emma」;都没有 → 空。*为什么*:引用 Leo 的回复、同时「对象」是 Emma 时,服务端按回复规则交给 Leo,只写「交给 Emma」是错的提示。网页只显示,不改 `reply_to` 与 `to`(引用照旧经 `reply_to` 发出)。
- **R-AW8 朗读兜底放在 `speakableText()` 末尾。** Ruling:新纯函数 `lib/speech-text.ts::speechText`;`chat/tts.ts::speakableText` 在压缩空白之后、截断之前调用它。`useTtsPlayer.play()`、逐句队列 `push()`、`autoSpeakDecision`、房间「朗读」、带练「听一遍」、背单词 / 练习 / 词汇的朗读因此都经过它。不含中日字符的文本原样返回(旧路径逐字节不变,`tts.test.ts` 现有用例不动)。*代价*:全站不再朗读任何中文(包括旧的非智能体对话里教练的中文说明);全站的 TTS 音色都是英文音色,读中文本来就不可用。*若错*(有页面需要读中文):给 `play()` 加 `keepCjk` 选项,默认仍然剥掉。
- **R-AW9 房间「朗读」按钮按 `spokenText(m)` 决定是否显示;「译」不变。** Ruling:`text-tools.ts` 新增 `spokenText(m) = speechText(speakable(m))`;`room-message-list.tsx` 只有 `spokenText` 非空时才给 `onSpeak`(全中文消息不再显示「朗读」)。「译」仍用 `speakable(m)`,保留中文原文。
- **R-AW10 折叠按钮本体无文案,三处各用自己的懒加载文案。** Ruling:`components/zh-note-fold.tsx`(低层,只依赖 `lib/cn` 与 lucide)接收 `showLabel` / `hideLabel`;房间直接用(`web.rooms.agents.note.*`,房间页块已加载这些文案,不会晚出现);1:1 用 agents 的懒包装 `AgentNote`(`web.agents.note.*`,fallback 是同高 44 px 的占位,避免块到达时跳动);两种带练条直接用组件(各自的 `locales`)。*为什么*:`agents/tutor/` 不能导入 `../agent-note`(架构测试),chat 的文案在主包。
- **R-AW11 1:1 的中文说明随 `agent_trace` 由网页保存。** Ruling:1:1 的助手消息由网页 `createMessages` 保存(不是服务端),所以 `note_zh` 必须进入网页保存的 trace:`AgentTrace.noteZh`(可选),`withNote(result.trace, result.noteZh)` 合并(`done.note_zh` 优先于 `done.trace.note_zh`),经 `ApiClient` 的 snake_case 转成 `agent_trace.note_zh`;刷新后 `normalizeTrace` 读回。`traceForSave` 的前三级收缩保留它,只有「整条不保存」时一起丢。`done.trace` 为 `null`(目前不会发生)时说明不保存,只在本次界面显示。spec §5.2 写的是「随 assistant 消息保存」,没说谁保存,此处按真实代码裁定。
- **R-AW12 「没听清」由自己的语音状态推出,服务端提示是补充。** Ruling:带练轮到我时,记下那一刻列表的最大 seq;之后我发的最新一条语音 `voice.status === "pending"` → 「识别中…」,`empty` / `failed` → 「没听清,再说一次」;另外服务端的 notice `voice_unclear`(名字见 Cross-plan assumptions)也显示「没听清」。页面在「轮到我」时不再把这条 notice 显示在通用横幅里(避免同一句出现两次)。*为什么*:spec 只说「界面提示」,没有给线上名字;状态推导不依赖服务端是否发 notice。
- **R-AW13 `@` 补全只在消息开头。** Ruling:服务端的 `_MENTION` 与 `agent_mention` 都只认开头的 `@`;补全在光标前的文字是「开头的 `@词`(无空白)」时打开,候选 = 「AI(默认名)」别名 + 名字前缀匹配的未停用角色;全角「＠」同样触发并被替换成「@」;输入框 `role="combobox"`、`aria-autocomplete="list"`、`aria-activedescendant`;组字中(`isComposing` 或 `keyCode === 229`,覆盖 iOS、Android、搜狗)完全不拦截按键;选项 `onMouseDown` 阻止默认,点按不让输入框失焦(iOS 键盘不收起);失焦或 Esc 关闭。有智能体时输入框右侧的 `@` 键改为插入「@」并打开候选;没有 `mentions` 属性时保持原来的插入「@ai 」。
- **R-AW14 房间带练的 `hint_zh` 只在服务端发了才显示。** Ruling:房间带练帧今天没有任何提示字段;网页把 `RoomTutorInfo.hintZh` 作为可选键,有值时在带练条第二行显示「中文」折叠,没有则什么都不显示,不虚构英文提示字段。
- **R-AW15 「对象」存储键按用户 + 房间,登出不清。** Ruling:`enjoy-web.rooms.target.v1.<userId>.<roomId>`,值 `{on, personaId, auto, ended}`(只有布尔、角色 id、seq);读写经 `lib/storage` 的 `readJson` / `writeJson`(try/catch)。取不到 = 关闭;写不进时本次打开仍然有效(只是不记住)。不放进 `auth/device-data` 的登出清理(没有内容,键已按用户隔离)。
- **R-AW16 1:1 带练的 `note_zh` 也走 `done.note_zh`。** Ruling:网页只从 `done` 事件读说明(对话模式与导师模式相同),不从 `meta` 事件读;`TurnMeta` 不加字段。
- **R-AW17 `room-page.tsx` 的接线例外(Addendum AW-1)。** 见文末。
- **R-AW18 不新增跨 feature 边。** `AgentNote`、`withNote` 走已有的 `chat->agents`;房间只用自己的文件与 `components/`、`lib/`;`architecture.test.ts` 的 `CROSS_FEATURE_BASELINE.size` 仍是 18。
- **R-AW19 旧消息的「中文:」行切分保留。** `AiAnswer` 对旧的 `@ai` 回答仍按「中文:」行分两段显示;新消息没有这一行,没有 `meta.note_zh` 时不显示「中文」按钮。

---

## Lane P · 协议、类型与文案

### Task P0: 主包基线 + 全部新文案(懒加载)

**Files:**
- Create: `web/src/features/rooms/agents/locales.ts`、`web/src/features/rooms/agents/locales/en.json`、`web/src/features/rooms/agents/locales/zh-CN.json`、`web/src/features/rooms/agents/locales.test.ts`
- Modify: `web/src/features/agents/locales/{en,zh-CN}.json`、`web/src/features/agents/tutor/locales/{en,zh-CN}.json`、`web/scripts/main-bundle-baseline.json`(脚本生成)

**Interfaces:**
- Produces:`ensureRoomAgentsI18n()`(模块求值时自动调用);文案键 `web.rooms.notice.voice_unclear`、`web.rooms.agents.{target,mention,composer,tutor,note}.*`、`web.agents.note.{show,hide}`、`web.agents.settings.{zhNote,zhNoteHint,zhNoteModes.*,groups.language}`、`web.agents.tutor.bar.{zhShow,zhHide}`

- [ ] **Step 1: 记录基线**(服务端计划已合并、本计划尚无代码的提交上):`yarn web:build && cd web && node scripts/check-main-bundle.mjs --record`,把输出的两行原样贴进本任务的提交说明(INDEX §10 已说明 517.05 kB 的旧基线过期)。

- [ ] **Step 2: 写失败测试** — `web/src/features/rooms/agents/locales.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import i18n, { webMessages } from "~/i18n";
import "./locales";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

type Dict = Record<string, unknown>;
const keysOf = (d: unknown, prefix = ""): string[] =>
  d && typeof d === "object" ? Object.entries(d as Dict).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k)) : [prefix];
const at = (d: unknown, path: string): unknown => path.split(".").reduce<unknown>((acc, k) => (acc as Dict | undefined)?.[k], d);

describe("room agents lazy locales (plan addressing-web R-AW1)", () => {
  it("has the same keys in en and zh-CN, all under web.rooms", () => {
    expect(keysOf(en).sort()).toEqual(keysOf(zh).sort());
    expect(keysOf(en).every((k) => k.startsWith("web.rooms."))).toBe(true);
  });

  it("never repeats a key of the eager bundle (the no-overwrite merge would silently keep the eager value)", () => {
    for (const [lng, dict] of [["en", en], ["zh-CN", zh]] as const) {
      const eager = webMessages(lng);
      for (const key of keysOf(dict)) expect(at(eager, key), `${lng} ${key}`).toBeUndefined();
    }
  });

  it("is merged into i18next once the module is imported", () => {
    expect(i18n.getFixedT("zh-CN")("web.rooms.agents.target.to", { name: "Emma" })).toBe("对 Emma 说");
    expect(i18n.getFixedT("zh-CN")("web.rooms.notice.voice_unclear")).toBe("没听清,再说一次");
    expect(i18n.getFixedT("en")("web.rooms.agents.composer.placeholder", { name: "Emma" })).toBe("Say something, or ask @AI (Emma)");
    // the eager keys around them are still there
    expect(i18n.getFixedT("zh-CN")("web.rooms.agents.tutor.yourTurn")).toBe("轮到你了");
  });

  it("keeps one-line labels short enough for a 360 px composer row", () => {
    for (const key of ["web.rooms.agents.target.to", "web.rooms.agents.note.show", "web.rooms.agents.mention.alias"]) {
      expect(String(at(en, key)).replace("{{name}}", "Emma").length, key).toBeLessThanOrEqual(12);
    }
  });
});
```

- [ ] **Step 3: 跑测试确认失败** — `cd web && yarn vitest run src/features/rooms/agents/locales.test.ts`(模块不存在)。

- [ ] **Step 4: 实现**

`web/src/features/rooms/agents/locales.ts`:

```ts
import i18n from "~/i18n";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

/**
 * 联机「对象」、@ 补全、带练语音、「中文」折叠的文案(plan 2026-10-12-agents-addressing-web R-AW1):不进主包。
 * `**\/i18n/*.json` 由 i18n/index.ts 急切合并,这里的 locales/ 不在那个 glob 里。用到这些键的模块都 `import "./locales"`
 * (它们只在懒加载的房间页块里),模块求值时深合并、不覆盖已有键(locales.test.ts 保证没有重复键)。
 */
let loaded = false;
export function ensureRoomAgentsI18n(): void {
  if (loaded) return;
  loaded = true;
  i18n.addResourceBundle("en", "translation", en, true, false);
  i18n.addResourceBundle("zh-CN", "translation", zh, true, false);
}

ensureRoomAgentsI18n();
```

`web/src/features/rooms/agents/locales/zh-CN.json`:

```json
{
  "web": {
    "rooms": {
      "notice": { "voice_unclear": "没听清,再说一次" },
      "agents": {
        "target": {
          "to": "对 {{name}} 说",
          "goesTo": "消息会交给 {{name}}",
          "replying": "回复 {{name}} 中 · 消息会交给 {{name}}",
          "off": {
            "muted": "本房 AI 已被管理员关闭",
            "aiOff": "房主关闭了群内 AI",
            "unavailable": "AI 暂时不可用",
            "agentOff": "{{name}} 已停用"
          }
        },
        "mention": { "list": "选择智能体", "alias": "AI", "aliasOf": "AI({{name}})" },
        "composer": { "placeholder": "说点什么,或 @AI({{name}})提问", "placeholderNoName": "说点什么,或 @AI 提问" },
        "tutor": {
          "yourTurnSpeak": "轮到你了 · 直接说或打字回答",
          "yourTurnType": "轮到你了 · 打字回答",
          "recognizing": "识别中…",
          "unclear": "没听清,再说一次"
        },
        "note": { "show": "中文", "hide": "收起中文" }
      }
    }
  }
}
```

`web/src/features/rooms/agents/locales/en.json`:

```json
{
  "web": {
    "rooms": {
      "notice": { "voice_unclear": "Didn't catch that, please say it again" },
      "agents": {
        "target": {
          "to": "To {{name}}",
          "goesTo": "Messages go to {{name}}",
          "replying": "Replying to {{name}} · goes to {{name}}",
          "off": {
            "muted": "AI is turned off for this room",
            "aiOff": "The owner turned off group AI",
            "unavailable": "AI is unavailable right now",
            "agentOff": "{{name}} is disabled"
          }
        },
        "mention": { "list": "Choose an agent", "alias": "AI", "aliasOf": "AI ({{name}})" },
        "composer": { "placeholder": "Say something, or ask @AI ({{name}})", "placeholderNoName": "Say something, or ask @AI" },
        "tutor": {
          "yourTurnSpeak": "Your turn · just say or type it",
          "yourTurnType": "Your turn · type your answer",
          "recognizing": "Recognizing…",
          "unclear": "Didn't catch that, say it again"
        },
        "note": { "show": "Chinese", "hide": "Hide Chinese" }
      }
    }
  }
}
```

`web/src/features/agents/locales/zh-CN.json`(在 `web.agents` 下):新增对象 `"note": { "show": "中文", "hide": "收起中文" }`;`settings.groups` 末尾追加 `"language": "回复语言"`;`settings` 末尾(`saveFailed` 之后)追加:

```json
"zhNote": "中文说明",
"zhNoteHint": "回复只用英文;中文说明默认折叠,点「中文」才显示,永远不朗读。自动 = 角色水平 A2 / B1 时附上。",
"zhNoteModes": { "auto": "自动", "always": "总是", "never": "从不" }
```

`web/src/features/agents/locales/en.json` 同位置:`"note": { "show": "Chinese", "hide": "Hide Chinese" }`、`"language": "Reply language"`、

```json
"zhNote": "Chinese notes",
"zhNoteHint": "Replies are English only. A Chinese note stays folded until you tap Chinese and is never read aloud. Auto = for A2 / B1 personas.",
"zhNoteModes": { "auto": "Auto", "always": "Always", "never": "Never" }
```

`web/src/features/agents/tutor/locales/zh-CN.json` 的 `web.agents.tutor.bar` 末尾追加 `"zhShow": "中文", "zhHide": "收起中文"`;`en.json` 追加 `"zhShow": "Chinese", "zhHide": "Hide Chinese"`。

- [ ] **Step 5: 跑测试** — `cd web && yarn vitest run src/features/rooms/agents/locales.test.ts src/features/agents/locales.test.ts`(后者的键集一致检查覆盖 agents 的新增键)。
- [ ] **Step 6: 提交**

```bash
git add web/src/features/rooms/agents/locales.ts web/src/features/rooms/agents/locales web/src/features/rooms/agents/locales.test.ts \
  web/src/features/agents/locales web/src/features/agents/tutor/locales web/scripts/main-bundle-baseline.json
git commit -m "chore(web): lazy copy for agent addressing and a fresh main bundle baseline

<paste the two lines printed by check-main-bundle.mjs --record>

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task P1: 房间协议 `say.to`、`voice_unclear`、`hintZh`、`noteZh`

**Files:**
- Modify: `web/src/features/rooms/protocol.ts`、`web/src/features/rooms/protocol.test.ts`、`web/src/features/rooms/room-state.ts`、`web/src/features/rooms/room-state.test.ts`、`web/src/features/rooms/use-room.ts`、`web/src/features/rooms/agents/agent-meta.ts`、`web/src/features/rooms/agents/agent-state.test.ts`、`web/src/features/rooms/agents/room-agents-contract.test.ts`

**Interfaces:**
- Produces:`encodeSay({ …, to?: string | null })`;`ROOM_NOTICE_VOICE_UNCLEAR = "voice_unclear"`;notice 联合类型含 `"voice_unclear"`;`RoomTutorInfo.hintZh?: string | null`;`PendingSay.to?: string | null`;`useRoom().say(text, assistId?, replyTo?, to?)`;`AgentAnswerMeta.noteZh: string | null`、`NOTE_ZH_MAX = 80`

- [ ] **Step 1: 写失败测试**

`web/src/features/rooms/protocol.test.ts`,在 `describe("room protocol mirrors server/app/rooms/protocol.py")` 里追加(`server`、`pyInt` 已在文件顶部定义):

```ts
  it("say.to exists on the server model and the protocol version still matches (plan addressing-web R-AW2)", () => {
    const say = /class SayMsg\(_Msg\):([\s\S]*?)\nclass /.exec(server)![1];
    expect(say).toMatch(/\n\s+to: str \| None/);
    expect(pyInt("PROTOCOL_VERSION")).toBe(ROOM_PROTOCOL_VERSION);
  });
```

在 `describe("encoders and parser")` 里追加:

```ts
  it("adds say.to only while an agent is addressed, clipped to an id", () => {
    expect(JSON.parse(encodeSay({ clientId: "c", text: "hi" })!)).not.toHaveProperty("to");
    expect(JSON.parse(encodeSay({ clientId: "c", text: "hi", to: null })!)).not.toHaveProperty("to");
    expect(JSON.parse(encodeSay({ clientId: "c", text: "hi", to: "  " })!)).not.toHaveProperty("to");
    expect(JSON.parse(encodeSay({ clientId: "c", text: "hi", replyTo: 5, to: "builtin:coach" })!))
      .toEqual({ type: "say", client_id: "c", text: "hi", assist_id: null, reply_to: 5, to: "builtin:coach" });
    expect(JSON.parse(encodeSay({ clientId: "c", text: "hi", to: "x".repeat(100) })!).to).toHaveLength(ROOM_LIMITS.id);
  });

  it("parses the unclear-voice notice and the optional tutor hint_zh", () => {
    expect(parseRoomEvent('{"type":"notice","code":"voice_unclear"}')).toEqual({ type: "notice", code: ROOM_NOTICE_VOICE_UNCLEAR });
    const e = parseRoomEvent(JSON.stringify({ type: "agent_tutor", tutor: { persona_id: "p", hint_zh: "想想过去式" } }));
    expect((e as { tutor: { hintZh?: string } }).tutor.hintZh).toBe("想想过去式");
  });
```

(顶部导入补上 `ROOM_NOTICE_VOICE_UNCLEAR`、`ROOM_PROTOCOL_VERSION`、`parseRoomEvent`——已导入的不重复。)

`web/src/features/rooms/room-state.test.ts` 追加(导入 `encodeSay`):

```ts
it("keeps say.to on the pending entry so the resend after a reconnect still addresses the agent", () => {
  const s = roomReducer(initialRoomState(), { type: "say", pending: { clientId: "c1", text: "hi", assistId: null, seq: null, replyTo: null, to: "builtin:coach" } });
  expect(JSON.parse(encodeSay(s.pending[0])!).to).toBe("builtin:coach");
  const plain = roomReducer(initialRoomState(), { type: "say", pending: { clientId: "c2", text: "hi", assistId: null, seq: null } });
  expect(JSON.parse(encodeSay(plain.pending[0])!)).not.toHaveProperty("to");
});
```

`web/src/features/rooms/agents/agent-state.test.ts` 追加(导入 `agentOf`、`NOTE_ZH_MAX` from `./agent-meta`,`answer` from `./fixtures`):

```ts
it("agentOf reads meta.noteZh (clipped to 80) and treats blank or missing as none", () => {
  const agent = { agent: { personaId: "builtin:coach", name: "Emma" } };
  expect(agentOf(answer(5, 4, { ...agent, noteZh: "  abandon 指彻底放弃  " }))!.noteZh).toBe("abandon 指彻底放弃");
  expect(agentOf(answer(5, 4, { ...agent, noteZh: "   " }))!.noteZh).toBeNull();
  expect(agentOf(answer(5, 4, agent))!.noteZh).toBeNull();
  expect(Array.from(agentOf(answer(5, 4, { ...agent, noteZh: "长".repeat(200) }))!.noteZh!)).toHaveLength(NOTE_ZH_MAX);
});
```

`web/src/features/rooms/agents/room-agents-contract.test.ts`:把 `TUTOR` 记录加上可选键并改两处比较,另加两条用例:

```ts
const TUTOR: Record<keyof RoomTutorInfo, true> = { personaId: true, personaName: true, phase: true, stepIndex: true, stepsTotal: true,
  currentUserId: true, currentName: true, deadlineAt: true, remainingMs: true, startedBy: true, pausedReason: true, hintZh: true };
/** spec addressing §5.3:可选键缺省 = 没有 */
const TUTOR_OPTIONAL = ["hintZh"];
const required = (list: string[]) => list.filter((k) => !TUTOR_OPTIONAL.includes(k)).sort();
```

`it("HTTP tutor start")` 改为 `expect(required(wireKeys(C.http.tutor_start.tutor))).toEqual(required(keys(TUTOR)));`;`it("WebSocket tutor frame")` 改为 `expect(required(Object.keys(tutor.tutor!))).toEqual(required(keys(TUTOR)));`。追加:

```ts
  it("agent replies may carry meta.note_zh (optional); agentOf exposes it", () => {
    const answer = (ev(C.ws.message_agent_answer) as { message: RoomMessage }).message;
    const raw = C.ws.message_agent_answer.message.meta?.note_zh;
    expect(agentOf(answer)!.noteZh).toBe(typeof raw === "string" && raw.trim() ? raw.trim() : null);
  });

  it("the unclear-voice notice the web shows is sent by the server (Cross-plan S-3)", () => {
    const src = ["rooms/voice.py", "rooms/agent_tutor.py", "rooms/agent_lane.py", "rooms/connection.py", "routers/rooms_voice.py"]
      .map((f) => { try { return serverSrc(f); } catch { return ""; } }).join("\n");
    expect(src).toMatch(new RegExp(`code="${ROOM_NOTICE_VOICE_UNCLEAR}"`));
  });
```

(导入 `ROOM_NOTICE_VOICE_UNCLEAR` from `../protocol`。若服务端计划把提示叫了别的名字,只改 `protocol.ts` 的常量值与懒加载文案的键,见 Cross-plan S-3。)

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/rooms/protocol.test.ts src/features/rooms/room-state.test.ts src/features/rooms/agents/agent-state.test.ts src/features/rooms/agents/room-agents-contract.test.ts`。

- [ ] **Step 3: 实现**

`web/src/features/rooms/protocol.ts`:

1. `RoomTutorInfo` 末尾(`pausedReason` 之后)加:

```ts
  /** 带练提示的中文说明(spec 2026-10-12-agents-addressing §5.2,可选键;缺省 = 没有)。只在带练条的「中文」折叠里显示,不朗读 */
  hintZh?: string | null;
```

2. notice 联合类型改为 `code: "ai_off" | "ai_busy" | "ai_quota" | "voice_off" | "voice_quota" | "translate_quota" | "retry_limit" | "agent_off" | "voice_unclear"`,并在 `ROOM_AGENTS` 之后加:

```ts
/** 语音转写为空 / 失败时服务端给说话人的提示(plan addressing-web Cross-plan S-3);名字只在这里出现一次。 */
export const ROOM_NOTICE_VOICE_UNCLEAR = "voice_unclear" as const;
```

3. `encodeSay` 整体替换为:

```ts
/** to:「对象」生效时的智能体角色 id(spec addressing §3.4);关闭时不写这个键,帧与旧版逐字节相同(R-AW2)。 */
export function encodeSay(p: { clientId: string; text: string; assistId?: string | null; replyTo?: number | null; to?: string | null }): string | null {
  const text = clip(p.text, ROOM_LIMITS.sayRaw);
  if (!text) return null;
  const to = typeof p.to === "string" ? p.to.trim().slice(0, ROOM_LIMITS.id) : "";
  return JSON.stringify({ type: "say", client_id: p.clientId.slice(0, ROOM_LIMITS.id), text, assist_id: p.assistId ?? null,
    reply_to: validSeq(p.replyTo) ? p.replyTo : null, ...(to ? { to } : {}) });
}
```

`web/src/features/rooms/room-state.ts`:`PendingSay` 改为

```ts
/** 已发出、还没在列表里看到的消息。seq 来自 ack:消息本身(广播/补发)到达前气泡一直保留,断线重连时据 seq 为空判断要重发。
 *  replyTo:引用回复的 seq(v2;缺省 = null);to:「对象」的角色 id(addressing;缺省 = 没有)。重发时一并带上。 */
export interface PendingSay { clientId: string; text: string; assistId: string | null; seq: number | null; replyTo?: number | null; to?: string | null }
```

`web/src/features/rooms/use-room.ts`:`say` 替换为

```ts
  const say = useCallback((text: string, assistId: string | null = null, replyTo: number | null = null, to: string | null = null) => {
    const clientId = newId();
    const frame = encodeSay({ clientId, text, assistId, replyTo, to });
    if (!frame || !socketRef.current?.send(frame)) return false;
    dispatch({ type: "say", pending: { clientId, text: text.trim(), assistId, seq: null, replyTo, to } });
    return true;
  }, []);
```

(重连时的 `encodeSay(p)` 不用改:`p` 现在带 `to`。)

`web/src/features/rooms/agents/agent-meta.ts`:

```ts
/** 中文说明的上限(与服务端 note_zh ≤ 80 字一致,spec addressing §5.1)。 */
export const NOTE_ZH_MAX = 80;
const note = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? Array.from(s).slice(0, NOTE_ZH_MAX).join("") : null;
};
```

`AgentAnswerMeta` 加字段 `/** 公开消息 meta.note_zh(经 camelcase-keys);不朗读,界面折叠显示 */ noteZh: string | null`;`agentOf` 的返回对象末尾加 `noteZh: note(m.meta.noteZh),`。

- [ ] **Step 4: 跑测试** — 同 Step 2,全绿;`yarn web:typecheck`。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/rooms/protocol.ts web/src/features/rooms/protocol.test.ts web/src/features/rooms/room-state.ts web/src/features/rooms/room-state.test.ts \
  web/src/features/rooms/use-room.ts web/src/features/rooms/agents/agent-meta.ts web/src/features/rooms/agents/agent-state.test.ts \
  web/src/features/rooms/agents/room-agents-contract.test.ts
git commit -m "feat(web): room protocol additions for addressing (say.to, voice_unclear, hint_zh, note_zh)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task P2: 1:1 回合的 `note_zh`、设置 `zh_note` 的类型与契约

**Files:**
- Modify: `web/src/features/agents/types.ts`、`sse.ts`、`sse.test.ts`、`trace.ts`、`trace.test.ts`、`turn-stream.ts`、`turn-stream.test.ts`、`agents-contract.test.ts`、`index.ts`

**Interfaces:**
- Produces:`ZH_NOTE_MODES`、`ZhNoteMode`、`NOTE_ZH_MAX`;`AgentSettings.zhNote?: ZhNoteMode`;`AgentTrace.noteZh?: string`;`TurnEvent` 的 `done` 带 `noteZh?: string | null`;`AgentTurnResult.noteZh?: string | null`;`clipNote(v)`、`withNote(trace, note)`(`trace.ts`,`withNote` 从 `index.ts` 导出)

- [ ] **Step 1: 写失败测试**

`web/src/features/agents/sse.test.ts` 追加:

```ts
it("reads the optional done.note_zh apart from the trace (spec addressing §5.2)", () => {
  expect(parseTurnEvent({ event: "done", data: JSON.stringify({ trace: null, text_len: 3, note_zh: "  放弃 = give up  " }) }))
    .toMatchObject({ type: "done", noteZh: "放弃 = give up" });
  expect(parseTurnEvent({ event: "done", data: JSON.stringify({ trace: null, text_len: 3 }) })).toMatchObject({ type: "done", noteZh: null });
  const long = parseTurnEvent({ event: "done", data: JSON.stringify({ text_len: 1, note_zh: "长".repeat(120) }) }) as { noteZh: string };
  expect(Array.from(long.noteZh)).toHaveLength(80);
});
```

`web/src/features/agents/trace.test.ts` 追加(导入 `withNote`):

```ts
it("normalizeTrace keeps note_zh only as a non-blank string, clipped to 80 (stored agent_trace)", () => {
  expect(normalizeTrace({ v: 1, steps: [], note_zh: " 说明 " })!.noteZh).toBe("说明");
  expect(normalizeTrace({ v: 1, steps: [], note_zh: "" })).not.toHaveProperty("noteZh");
  expect(normalizeTrace({ v: 1, steps: [], note_zh: 3 })).not.toHaveProperty("noteZh");
  expect(normalizeTrace({ v: 1, steps: [] })).not.toHaveProperty("noteZh");
});

it("withNote puts the done note on the trace and leaves a missing trace or note alone (R-AW11)", () => {
  const trace = normalizeTrace({ v: 1, steps: [] })!;
  expect(withNote(trace, "新")).toEqual({ ...trace, noteZh: "新" });
  expect(withNote(trace, null)).toBe(trace);
  expect(withNote(null, "新")).toBeNull();
});
```

`web/src/features/agents/turn-stream.test.ts` 追加(若文件里已有同名的 `ev` / `REQ` 帮手,复用它们,不重复定义):

```ts
const evLine = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const NOTE_REQ = { personaId: "builtin:coach", conversationId: "c1", text: "hi", history: [], mode: "chat" as const, tutorSessionId: null };
function noteApi(body: string) {
  const mock = createFetchMock({ "POST /api/agents/turn": () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }) });
  return new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
}

it("returns done.note_zh as result.noteZh, falling back to trace.note_zh; the visible text never contains it", async () => {
  const both = [evLine("start", { turn_id: "t" }), evLine("delta", { text: "Hi." }),
    evLine("done", { trace: { v: 1, steps: [], note_zh: "旧" }, text_len: 3, note_zh: "新" })].join("");
  const r = await streamAgentTurn(noteApi(both), NOTE_REQ);
  expect(r.noteZh).toBe("新");
  expect(r.text).toBe("Hi.");
  const traceOnly = [evLine("start", { turn_id: "t" }), evLine("delta", { text: "Hi." }),
    evLine("done", { trace: { v: 1, steps: [], note_zh: "旧" }, text_len: 3 })].join("");
  expect((await streamAgentTurn(noteApi(traceOnly), NOTE_REQ)).noteZh).toBe("旧");
  const none = [evLine("start", { turn_id: "t" }), evLine("delta", { text: "Hi." }), evLine("done", { trace: null, text_len: 3 })].join("");
  expect((await streamAgentTurn(noteApi(none), NOTE_REQ)).noteZh).toBeNull();
});
```

(导入 `ApiClient` from `~/api/client`、`createFetchMock` from `~/test/fetch-mock`、`streamAgentTurn` from `./turn-stream`,已导入的不重复。)

`web/src/features/agents/agents-contract.test.ts`:

1. `SETTINGS` 记录加 `zhNote: true`;`TRACE` 记录加 `noteZh: true`;紧接着加 `const OPTIONAL_TRACE = ["noteZh"];`,并把两处 `expect(Object.keys(…).sort()).toEqual(keys(TRACE))` 改为 `expect(Object.keys(…).filter((k) => !OPTIONAL_TRACE.includes(k)).sort()).toEqual(keys(TRACE).filter((k) => !OPTIONAL_TRACE.includes(k)));`。
2. 在 `it("REST payloads match the web types key by key")` 末尾加 `expect(C[FIXTURE.settings].zh_note).toBe("auto"); // spec addressing §5.1 默认 auto`。
3. 追加用例:

```ts
  it("some recorded turn carries the optional done.note_zh, kept out of the visible text (spec addressing §5.2)", () => {
    const noted = Object.values(C).filter((v): v is Recorded =>
      Array.isArray(v) && v.some((e: { event?: string; data?: { note_zh?: unknown } }) => e?.event === "done" && typeof e.data?.note_zh === "string"));
    expect(noted.length).toBeGreaterThan(0);
    for (const list of noted) {
      const parsed = events(toSse(list));
      const raw = (list.find((e) => e.event === "done")!.data as { note_zh: string }).note_zh;
      const done = parsed.find((e): e is Extract<TurnEvent, { type: "done" }> => e.type === "done")!;
      expect(done.noteZh).toBe(raw.trim());
      const visible = parsed.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");
      expect(visible).not.toContain(raw.trim());
      expect(visible).not.toContain("<<ZH>>");
    }
  });
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/agents/sse.test.ts src/features/agents/trace.test.ts src/features/agents/turn-stream.test.ts src/features/agents/agents-contract.test.ts`。

- [ ] **Step 3: 实现**

`web/src/features/agents/types.ts`:

```ts
/** 是否生成中文说明(spec addressing §5.1):auto = 角色水平 A2 / B1 时生成。 */
export const ZH_NOTE_MODES = ["auto", "always", "never"] as const;
export type ZhNoteMode = (typeof ZH_NOTE_MODES)[number];
/** note_zh / hint_zh 的上限(服务端同样截断)。 */
export const NOTE_ZH_MAX = 80;
```

`AgentSettings` 在 `processDefault` 之前加 `/** 中文说明;旧服务端没有这个键时界面按 auto 显示 */ zhNote?: ZhNoteMode;`。`AgentTrace` 末尾加 `/** done.note_zh / agent_trace.note_zh(可选;不朗读,R-AW11) */ noteZh?: string;`。`TurnEvent` 的 done 改为 `| { type: "done"; usage: { in: number; out: number } | null; trace: AgentTrace | null; textLen: number; noteZh?: string | null }`。`AgentTurnResult` 末尾加 `noteZh?: string | null;`。

`web/src/features/agents/trace.ts`(导入 `NOTE_ZH_MAX`):

```ts
/** 中文说明:非空字符串才算,去首尾空白,按码点截到 80。 */
export function clipNote(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? Array.from(s).slice(0, NOTE_ZH_MAX).join("") : null;
}

/** done.note_zh 优先于 trace 里的 note_zh;没有过程时不附(R-AW11)。 */
export function withNote(trace: AgentTrace | null, note: string | null | undefined): AgentTrace | null {
  if (!trace || !note) return trace;
  return trace.noteZh === note ? trace : { ...trace, noteZh: note };
}
```

`normalizeTrace` 的 `return` 改为:

```ts
  const note = clipNote(d.noteZh);
  return { v: typeof d.v === "number" ? d.v : 1, ms: typeof ms === "number" ? ms : 0, steps, thought: toThought(d.thought), ...(note ? { noteZh: note } : {}) };
```

`web/src/features/agents/sse.ts`:导入 `clipNote`;`case "done"` 的返回改为 `return { type: "done", usage, trace: normalizeTrace(d.trace), textLen: typeof d.textLen === "number" ? d.textLen : 0, noteZh: clipNote(d.noteZh) };`。

`web/src/features/agents/turn-stream.ts`:`event.type === "done"` 分支改为

```ts
      st.result = { text: st.full, trace: event.trace, turnId: st.live.turnId, meta: st.live.meta, clientTurnId,
        noteZh: event.noteZh ?? event.trace?.noteZh ?? null };
```

`web/src/features/agents/index.ts` 末尾:

```ts
// ---- addressing (plan 2026-10-12-agents-addressing-web) ----
export { withNote } from "./trace";
```

- [ ] **Step 4: 跑测试** — 同 Step 2;再跑 `src/features/agents src/features/chat/ui-message.agent.test.ts`(确认没有回归)与 `yarn web:typecheck`。
- [ ] **Step 5: 提交** — `feat(web): carry note_zh through agent turns and declare the zh_note setting`(结尾带 Co-Authored-By 行,下同)。

### Task P3: 设置页「中文说明」(自动 / 总是 / 从不)

**Files:**
- Modify: `web/src/features/agents/agent-settings-page.tsx`、`web/src/features/agents/agent-settings-page.test.tsx`

**Interfaces:**
- Consumes:`ZH_NOTE_MODES`、`AgentSettings.zhNote`(P2);`SegmentedControl`(`~/components/segmented-control`,`role="radio"` + `aria-checked` + `data-testid={option.testId}`)

- [ ] **Step 1: 写失败测试** — `agent-settings-page.test.tsx` 的 `describe` 里追加:

```tsx
  it("offers the Chinese-note choice (server value, auto when missing) and saves a change as zh_note", async () => {
    const mock = setup({ "PATCH /api/agents/settings": (c) => json({ ...SETTINGS, zh_note: "never", ...JSON.parse(String(c.body)) }) });
    const auto = await screen.findByTestId("agent-setting-zh-note-auto");
    expect(auto).toHaveAttribute("aria-checked", "true"); // SETTINGS has no zh_note: shown as auto
    expect(screen.getByText(/never read aloud/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("agent-setting-zh-note-never"));
    expect(screen.getByTestId("agent-setting-zh-note-never")).toHaveAttribute("aria-checked", "true"); // optimistic
    await waitFor(() => expect(mock.calls.filter((c) => c.method === "PATCH")).toHaveLength(1));
    const patch = mock.calls.find((c) => c.method === "PATCH")!;
    expect(JSON.parse(String(patch.body))).toEqual({ zh_note: "never" });
    expect(patch.url.search).toBe("");
  });

  it("rolls the Chinese-note choice back when saving fails", async () => {
    setup({ "PATCH /api/agents/settings": () => json({ error: "boom" }, 500) });
    await userEvent.click(await screen.findByTestId("agent-setting-zh-note-always"));
    await waitFor(() => expect(screen.getByTestId("agent-setting-zh-note-auto")).toHaveAttribute("aria-checked", "true"));
  });
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/agents/agent-settings-page.test.tsx`。
- [ ] **Step 3: 实现** — `agent-settings-page.tsx`:导入 `LanguagesIcon`(lucide)、`SegmentedControl` from `~/components/segmented-control`、`ZH_NOTE_MODES, type ZhNoteMode` from `./types`;在「显示」分组(`groups.display`)之后插入:

```tsx
              <SectionGroup title={t("web.agents.settings.groups.language")}>
                <div className="px-3.5 py-2.5">
                  <div className="flex min-h-row flex-wrap items-center gap-x-3 gap-y-2">
                    <IconChip tone="gray" icon={LanguagesIcon} />
                    <span className="min-w-0 flex-1 text-body font-medium tracking-[-0.005em] text-ink">{t("web.agents.settings.zhNote")}</span>
                    <SegmentedControl<ZhNoteMode> label={t("web.agents.settings.zhNote")} value={settings.zhNote ?? "auto"}
                      onChange={(zhNote) => save({ zhNote })}
                      options={ZH_NOTE_MODES.map((mode) => ({ value: mode, label: t(`web.agents.settings.zhNoteModes.${mode}`), testId: `agent-setting-zh-note-${mode}` }))} />
                  </div>
                  <p className="mt-1.5 text-meta text-ink-2">{t("web.agents.settings.zhNoteHint")}</p>
                </div>
              </SectionGroup>
```

(乐观更新与逐键回滚沿用现有 `save()` / `undoPatch()`:`zhNote` 是普通键,`undoPatch` 恢复成 `base.zhNote`;`base.zhNote` 为 `undefined` 时 `applyPatch` 写回 `undefined`,界面仍显示 auto。)

- [ ] **Step 4: 跑测试** — 同 Step 2。浏览器窗格 360×740 看一眼:三段在标题右侧放不下时整体换到第二行(`flex-wrap`),不横向滚动。
- [ ] **Step 5: 提交** — `feat(web): zh_note choice on the agent settings page`。

---

## Lane S · 朗读兜底

### Task S1: `speechText()` 与它的三条接入

**Files:**
- Create: `web/src/lib/speech-text.ts`、`web/src/lib/speech-text.test.ts`、`web/src/features/rooms/extras/text-tools.test.ts`
- Modify: `web/src/features/chat/tts.ts`、`web/src/features/chat/tts.test.ts`、`web/src/features/chat/use-auto-speak.test.tsx`、`web/src/features/rooms/extras/text-tools.ts`

**Interfaces:**
- Produces:`speechText(text: string): string`;`spokenText(m: RoomMessage): string`(`text-tools.ts`)
- 不变:`speakableText()` 的签名与对 CJK-free 文本的输出

- [ ] **Step 1: 写失败测试**

`web/src/lib/speech-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { speechText } from "./speech-text";

/** 小而确定的随机数(mulberry32):不引入 fast-check,失败时用同一个种子能复现。 */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const PARTS = ["hello", "Great", "job", "I", "never", "give", "up", "42", "x", " ", " ", "\n", "\t", ",", ".", "!", "?", ":", "(", ")", "\"", "“", "”", "'", "-", "—",
  "你好", "很好", "中文", "放弃", "。", "，", "！", "？", "：", "（", "）", "「", "」", "ありがとう", "カタカナ", "ＡＢＣ", "１２", "𠀀", "　", "々"];
const FORBIDDEN = /[　-〿぀-ヿ㐀-䶿一-鿿＀-￯\u{20000}-\u{2fa1f}]/u;
const FORBIDDEN_ALL = new RegExp(FORBIDDEN.source, "gu");
const words = (s: string) => s.match(/[A-Za-z0-9]+/g) ?? [];

describe("speechText (spec addressing §5.3)", () => {
  it("drops Chinese, kana and full-width runs and tidies what is left", () => {
    expect(speechText("Good job! 很好。")).toBe("Good job!");
    expect(speechText("你好")).toBe("");
    expect(speechText("。，！")).toBe("");
    expect(speechText("Say hi to 小明!")).toBe("Say hi to!");
    expect(speechText("Try “放弃” (give up).")).toBe("Try (give up).");
    expect(speechText("I like ラーメン and sushi")).toBe("I like and sushi");
    expect(speechText("abc中def")).toBe("abc def"); // never glues two words together
    expect(speechText("（注意）Use the past tense — 过去式")).toBe("Use the past tense");
  });

  it("returns text without CJK unchanged, byte for byte (the old speech path does not move)", () => {
    for (const s of ["plain English,  twice", "  spaced  ", "C# and 5 * 3", "", "café — naïve"]) expect(speechText(s)).toBe(s);
  });

  it("holds its properties on 3000 random mixes", () => {
    const next = rng(20261012);
    for (let i = 0; i < 3000; i++) {
      const n = Math.floor(next() * 16);
      let input = "";
      for (let j = 0; j < n; j++) input += PARTS[Math.floor(next() * PARTS.length)];
      const out = speechText(input);
      const ctx = JSON.stringify(input);
      expect(out, ctx).not.toMatch(FORBIDDEN); // no Chinese, kana or full-width character survives
      expect(speechText(out), ctx).toBe(out); // idempotent
      expect(words(out), ctx).toEqual(words(input.replace(FORBIDDEN_ALL, " "))); // every English word / number kept, in order
      if (FORBIDDEN.test(input)) {
        expect(out, ctx).toBe(out.trim());
        expect(out, ctx).not.toMatch(/\s{2}/);
        if (out) expect(out, ctx).toMatch(/[A-Za-z0-9]/); // never a punctuation-only call to TTS
      }
    }
  });
});
```

`web/src/features/chat/tts.test.ts` 追加:

```ts
it("speakableText never hands Chinese to TTS (spec addressing §5.3, R-AW8)", () => {
  expect(speakableText("**Great!** 很好。")).toBe("Great!");
  expect(speakableText("中文说明:继续加油")).toBe("");
  expect(["Good job!", "很好。", "Keep going."].map(speakableText)).toEqual(["Good job!", "", "Keep going."]); // per-sentence queue input
});
```

`web/src/features/chat/use-auto-speak.test.tsx` 追加(导入 `autoSpeakDecision`,若已导入则复用):

```ts
it("skips auto-speak as empty when the reply is Chinese only", () => {
  expect(autoSpeakDecision({ enabled: true, status: "done", stale: false, alreadyRead: false, voiceIdle: true, hidden: false, hasVoice: true, text: "很好,继续。" }))
    .toBe("empty");
});
```

`web/src/features/rooms/extras/text-tools.test.ts`:

```ts
import { expect, it } from "vitest";
import { answer, msg } from "../agents/fixtures";
import { speakable, spokenText } from "./text-tools";

it("reads only the message body: meta.noteZh never enters what is spoken (spec addressing §5.3)", () => {
  const m = answer(5, 4, { agent: { personaId: "builtin:coach", name: "Emma" }, noteZh: "abandon 指彻底放弃" }, "Try: I never abandon a project.");
  expect(speakable(m)).toBe("Try: I never abandon a project.");
  expect(spokenText(m)).not.toContain("放弃");
});

it("spokenText strips Chinese for the speak button while speakable keeps it for translation (R-AW9)", () => {
  const mixed = msg({ text: "@ai 我想说 I give up" });
  expect(speakable(mixed)).toBe("我想说 I give up");
  expect(spokenText(mixed)).toBe("I give up");
  expect(spokenText(msg({ text: "全是中文" }))).toBe("");
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/lib/speech-text.test.ts src/features/chat/tts.test.ts src/features/chat/use-auto-speak.test.tsx src/features/rooms/extras/text-tools.test.ts`。

- [ ] **Step 3: 实现**

`web/src/lib/speech-text.ts`(保持短小:它随 `chat/tts.ts` 进主包):

```ts
// 朗读兜底(spec 2026-10-12-agents-addressing §5.3):中日统一表意文字、假名、CJK 标点、全角 / 半角形式、竖排标点、扩展 B–F。
const CJK = /[　-〿぀-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿︰-﹏＀-￯\u{20000}-\u{2fa1f}]+/gu;
const HAS_CJK = new RegExp(CJK.source, "u");

/**
 * 朗读前去掉所有中文 / 假名 / 全角片段(换成空格,不把两个英文词粘在一起),去掉因此变空的括号与引号,压缩空白;
 * 剩下没有字母或数字就返回空串(调用方据此不请求 TTS)。不含这些字符的文本原样返回。所有量词线性、无回溯。
 */
export function speechText(text: string): string {
  if (!HAS_CJK.test(text)) return text;
  const out = text
    .replace(CJK, " ")
    .replace(/[([{"“‘']\s*[)\]}"”’']/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([,.;:!?…])/g, "$1")
    .replace(/^[\s,.;:!?…—–-]+|[\s,;:—–-]+$/g, "");
  return /[A-Za-z0-9]/.test(out) ? out : "";
}
```

`web/src/features/chat/tts.ts`:导入 `import { speechText } from "~/lib/speech-text";`,`speakableText` 的最后一行改为

```ts
  return truncateAtSentence(speechText(text.replace(/\s+/g, " ").trim()), MAX_TTS_INPUT);
```

`web/src/features/rooms/extras/text-tools.ts` 末尾:

```ts
import { speechText } from "~/lib/speech-text";

/** 「朗读」按钮是否出现、朗读什么:正文(speakable)再去掉中文(R-AW9);「译」仍用 speakable,保留中文原文。 */
export const spokenText = (m: RoomMessage): string => speechText(speakable(m));
```

(`import` 放到文件顶部与现有导入一起。)

- [ ] **Step 4: 跑测试** — 同 Step 2;再跑 `src/features/chat/use-tts-player.test.tsx src/features/chat/use-tts-player-queue.test.tsx src/features/chat/use-auto-speak-pipeline.test.tsx src/features/chat/sentence-stream.test.ts`(英文用例的输入不含中文,结果应不变)。
- [ ] **Step 5: 提交** — `feat(web): never send Chinese to TTS (speechText fallback in speakableText)`。

---

## Lane N · 「中文」折叠

### Task N1: 低层组件 `ZhNoteFold`

**Files:**
- Create: `web/src/components/zh-note-fold.tsx`、`web/src/components/zh-note-fold.test.tsx`

**Interfaces:**
- Produces:`ZhNoteFold({ text, showLabel, hideLabel, testId?, className? })`;子节点 `${testId}-toggle`(按钮)、`${testId}-text`(说明)

- [ ] **Step 1: 写失败测试** — `web/src/components/zh-note-fold.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ZhNoteFold } from "./zh-note-fold";

it("renders nothing without a note", () => {
  const { container } = render(<><ZhNoteFold text={null} showLabel="中文" hideLabel="收起中文" /><ZhNoteFold text="   " showLabel="中文" hideLabel="收起中文" /></>);
  expect(container).toBeEmptyDOMElement();
});

it("is folded by default, toggles with aria-expanded and keeps the note out of the button's name", () => {
  render(<ZhNoteFold text="abandon 指彻底放弃" showLabel="中文" hideLabel="收起中文" testId="n" />);
  const toggle = screen.getByTestId("n-toggle");
  expect(toggle).toHaveAccessibleName("中文");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByTestId("n-text")).not.toBeVisible();
  expect(screen.getByTestId("n-text")).toHaveAttribute("lang", "zh-CN");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(toggle).toHaveAccessibleName("收起中文");
  expect(screen.getByTestId("n-text")).toBeVisible();
  expect(toggle.getAttribute("aria-controls")).toBe(screen.getByTestId("n-text").id);
});

it("gives the toggle a 44 px hit target and wraps long notes instead of widening the row", () => {
  render(<ZhNoteFold text={"很长的说明".repeat(10)} showLabel="中文" hideLabel="收起中文" testId="n" />);
  expect(screen.getByTestId("n-toggle").className).toContain("h-tap");
  expect(screen.getByTestId("n-text").className).toContain("break-words");
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/components/zh-note-fold.test.tsx`。
- [ ] **Step 3: 实现** — `web/src/components/zh-note-fold.tsx`:

```tsx
import { ChevronDownIcon } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "~/lib/cn";

export interface ZhNoteFoldProps {
  /** 中文说明(note_zh / hint_zh);空 = 不渲染 */
  text: string | null | undefined;
  /** 折叠 / 展开时的按钮文字:由调用方从自己的懒加载文案传入(本组件不含文案,R-AW10) */
  showLabel: string;
  hideLabel: string;
  testId?: string;
  className?: string;
}

/**
 * 「中文」折叠(spec 2026-10-12-agents-addressing §5.1):默认折叠,按钮 44 px 命中、aria-expanded / aria-controls;
 * 说明在 lang="zh-CN" 的段落里,不属于任何朗读入口的取值(朗读只取消息正文)。按钮在有说明时常驻,展开只在它下方追加,不挪动它。
 */
export function ZhNoteFold({ text, showLabel, hideLabel, testId = "zh-note", className }: ZhNoteFoldProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const note = text?.trim();
  if (!note) return null;
  return (
    <div data-testid={testId} className={cn("flex min-w-0 max-w-full flex-col items-start", className)}>
      <button type="button" data-testid={`${testId}-toggle`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}
        className="-mx-2 inline-flex h-tap min-w-tap items-center gap-1 rounded-[9px] px-2 text-meta font-medium text-ink-2 transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {open ? hideLabel : showLabel}
        <ChevronDownIcon aria-hidden className={cn("size-3.5 transition-transform duration-fast motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      <p id={id} lang="zh-CN" hidden={!open} data-testid={`${testId}-text`}
        className="-mt-1 max-w-full whitespace-pre-wrap break-words text-sub leading-dialogue text-ink-2">{note}</p>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试** — 同 Step 2;`yarn vitest run src/architecture.test.ts`(components 只导入 `lib/` 与 lucide)。
- [ ] **Step 5: 提交** — `feat(web): ZhNoteFold, a folded Chinese note with no copy of its own`。

### Task N2: 联机智能体气泡的「中文」与朗读按钮

**Files:**
- Modify: `web/src/features/rooms/room-message-list.tsx`、`web/src/features/rooms/agents/agent-messages.test.tsx`

**Interfaces:**
- Consumes:`AgentAnswerMeta.noteZh`(P1)、`spokenText`(S1)、`ZhNoteFold`(N1)、`web.rooms.agents.note.*`(P0)

- [ ] **Step 1: 写失败测试** — `agent-messages.test.tsx` 追加:

```tsx
it("folds the note_zh under an agent reply; old replies without it show no button (spec addressing §5.1)", () => {
  show({ messages: [question(ME, "alice"),
    answer(5, 4, { ...EMMA_META, asker: { id: ME, name: "alice" }, noteZh: "abandon 指彻底放弃" }),
    answer(6, 4, { ...EMMA_META, asker: { id: ME, name: "alice" } }, "Old reply")] });
  const toggles = screen.getAllByTestId("room-agent-note-toggle");
  expect(toggles).toHaveLength(1);
  expect(toggles[0]).toHaveAccessibleName("中文");
  expect(toggles[0]).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByTestId("room-agent-note-text")).not.toBeVisible();
  fireEvent.click(toggles[0]);
  expect(screen.getByTestId("room-agent-note-text")).toBeVisible();
  expect(screen.getByTestId("room-agent-note-text")).toHaveTextContent("abandon 指彻底放弃");
  expect(toggles[0]).toHaveAccessibleName("收起中文");
  // tapping the fold is not a tap on the bubble: the actions row stays closed
  expect(document.getElementById("room-actions-m5")).toBeNull();
});

it("offers 朗读 only when the message has something English to read (R-AW9)", () => {
  show({ messages: [msg({ seq: 7, text: "全是中文" }), msg({ seq: 8, text: "Mostly English 一点中文" })] });
  const more = screen.getAllByTestId("room-message-more");
  fireEvent.click(more[0]);
  expect(screen.queryByRole("button", { name: "朗读" })).toBeNull();
  fireEvent.click(more[1]);
  expect(screen.getByRole("button", { name: "朗读" })).toBeInTheDocument();
});
```

(`msg` 从 `./fixtures` 导入;「朗读」是 `message-actions.tsx` 现有的按钮名,若实际文案不同,以 `extras/i18n/zh-CN.json` 为准改断言。)

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/rooms/agents/agent-messages.test.tsx`。
- [ ] **Step 3: 实现** — `room-message-list.tsx`:
  1. 顶部导入:`import "./agents/locales";`、`import { ZhNoteFold } from "~/components/zh-note-fold";`,把 `import { isMostlyNative, speakable } from "./extras/text-tools";` 改为 `import { isMostlyNative, speakable, spokenText } from "./extras/text-tools";`。
  2. `under()` 里 `const text = textual(m) ? speakable(m) : "";` 之后加 `const spoken = text ? spokenText(m) : "";`,并把 `onSpeak={text ? () => speak(m) : undefined}` 改为 `onSpeak={spoken ? () => speak(m) : undefined}`。
  3. `ai_answer` 卡片里 `<AiAnswer text={m.text} />` 之后加:

```tsx
            {agent?.noteZh && (
              <ZhNoteFold text={agent.noteZh} showLabel={t("web.rooms.agents.note.show")} hideLabel={t("web.rooms.agents.note.hide")}
                testId="room-agent-note" className="mt-1" />
            )}
```

(`speak(m)` 照旧传 `speakable(m)`:`useTtsPlayer.play` 内部的 `speakableText` 已经去掉中文;`note_zh` 在 `meta` 里,从不进入 `speakable`。)

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/rooms`。
- [ ] **Step 5: 提交** — `feat(web): folded Chinese note under room agent replies`。

### Task N3: 1:1 气泡的「中文」(实时 + 刷新后)

**Files:**
- Create: `web/src/features/agents/agent-note.tsx`
- Modify: `web/src/features/agents/lazy-parts.tsx`、`web/src/features/agents/index.ts`、`web/src/features/chat/message-bubble.tsx`、`web/src/features/chat/conversation-page.tsx`、`web/src/features/chat/conversation-page.agent.test.tsx`、`web/src/features/chat/trace-save.test.ts`、`web/src/features/chat/ui-message.agent.test.ts`

**Interfaces:**
- Produces:`AgentNote({ text, testId? })`(`~/features/agents`,懒包装,fallback 为 44 px 占位);`MessageBubble` 新属性 `note?: ReactNode`
- Consumes:`withNote`、`AgentTurnResult.noteZh`、`AgentTrace.noteZh`(P2)

- [ ] **Step 1: 写失败测试**

`web/src/features/chat/conversation-page.agent.test.tsx` 的 `describe` 里追加:

```tsx
  it("shows done.note_zh folded under the reply, saves it in agent_trace and never sends it to TTS (spec addressing §5)", async () => {
    const NOTE = "give up 是放弃";
    const mock = setup(routes({ "POST /api/agents/turn": () => sse([...HAPPY.slice(0, -1), ev("done", { trace: TRACE, text_len: 12, note_zh: NOTE })]) }));
    await screen.findByText("Earlier reply");
    await say("Hi");
    await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Hello there!"));
    const bubble = screen.getAllByTestId("message-assistant").at(-1)!;
    const toggle = await within(bubble).findByRole("button", { name: "Chinese" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(bubble).getByTestId("agent-note-text")).not.toBeVisible();
    await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(1));
    const saved = bodyOf(callsTo(mock, "POST", "/api/conversations/c1/messages")[0]).messages.at(-1);
    expect(saved.content).toBe("Hello there!");
    expect(saved.agent_trace.note_zh).toBe(NOTE);
    await userEvent.click(within(bubble).getByTestId("message-tts"));
    await waitFor(() => expect(callsTo(mock, "POST", "/api/ai/audio/speech").length).toBeGreaterThan(0));
    for (const c of callsTo(mock, "POST", "/api/ai/audio/speech")) expect(String(c.body)).not.toContain("放弃");
  });

  it("renders the stored note after a reload and nothing for replies without one", async () => {
    setup(routes({
      "GET /api/conversations/c1/messages": () => json({ messages: [
        { id: "m8", conversation_id: "c1", role: "assistant", content: "Old", agent_trace: TRACE },
        { id: "m9", conversation_id: "c1", role: "assistant", content: "Stored", agent_trace: { ...TRACE, note_zh: "存下的说明" } }] }),
    }));
    await screen.findByText("Stored");
    expect(screen.getAllByRole("button", { name: "Chinese" })).toHaveLength(1);
  });
```

`web/src/features/chat/trace-save.test.ts` 追加:

```ts
it("keeps the Chinese note through every shrink step that still saves a trace (R-AW11)", () => {
  const big = { v: 1, ms: 1, noteZh: "说明", thought: { source: "summary" as const, text: "x".repeat(5000) },
    steps: [{ id: "s", group: "tool" as const, key: "word_lookup", status: "done" as const, labelKey: "agents.step.word_lookup", private: false }] };
  expect(traceForSave(big)!.noteZh).toBe("说明");
  expect(traceForSave({ v: 1, ms: 1, steps: [], thought: null, noteZh: "说明" })!.noteZh).toBe("说明");
});
```

`web/src/features/chat/ui-message.agent.test.ts` 追加:

```ts
it("fromServerMessage keeps agent_trace.note_zh on the trace", () => {
  const ui = fromServerMessage({ id: "m1", conversationId: "c1", role: "assistant", content: "Hi", agentTrace: { v: 1, steps: [], noteZh: "说明" } } as never);
  expect(ui.agent?.trace?.noteZh).toBe("说明");
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/chat/conversation-page.agent.test.tsx src/features/chat/trace-save.test.ts src/features/chat/ui-message.agent.test.ts`(后两条在 P2 之后应已通过;第一条因为没有折叠按钮而失败)。

- [ ] **Step 3: 实现**

`web/src/features/agents/agent-note.tsx`:

```tsx
import "./locales";
import { useTranslation } from "react-i18next";
import { ZhNoteFold } from "~/components/zh-note-fold";

export interface AgentNoteProps {
  text: string;
  testId?: string;
}

/** 对话气泡里的「中文」折叠(done.note_zh / agent_trace.note_zh,R-AW10):文案随 agents 的懒加载块并入。 */
export function AgentNote({ text, testId = "agent-note" }: AgentNoteProps) {
  const { t } = useTranslation();
  return <ZhNoteFold text={text} showLabel={t("web.agents.note.show")} hideLabel={t("web.agents.note.hide")} testId={testId} className="mt-1" />;
}
```

`web/src/features/agents/lazy-parts.tsx`:`pageFallback` 之后加 `const noteFallback = <span aria-hidden className="mt-1 block h-tap" />;`;`// ---- parts ----` 段末尾加

```ts
export const AgentNote = /* @__PURE__ */ part<import("./agent-note").AgentNoteProps>(() => import("./agent-note").then((m) => m.AgentNote), noteFallback);
```

`web/src/features/agents/index.ts` 的 addressing 段追加 `export { AgentNote } from "./lazy-parts";`。

`web/src/features/chat/message-bubble.tsx`:属性列表加 `note`,类型里加

```ts
  /** 助手气泡正文下方的「中文」折叠(智能体回复的 note_zh;只在完成后显示,不朗读) */
  note?: ReactNode;
```

渲染处在 `{!isUser && message.status === "done" && translation}` 之前加 `{!isUser && message.status === "done" && note}`。

`web/src/features/chat/conversation-page.tsx`:
  1. 第 18 行的 `~/features/agents` 导入加上 `AgentNote, withNote`。
  2. `trace = result.trace;` 改为 `trace = withNote(result.trace, result.noteZh);`。
  3. `<MessageBubble …>` 加属性 `note={m.agent?.trace?.noteZh ? <AgentNote text={m.agent.trace.noteZh} /> : null}`。
  (朗读按钮仍是 `tts.play(m.key, m.content, …)`:只读正文。)

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/chat src/features/agents src/architecture.test.ts`。
- [ ] **Step 5: 提交** — `feat(web): folded Chinese note under 1:1 agent replies, saved with agent_trace`。

---

## Lane V · 语音带目标

### Task V1: `to_agent` 表单字段

**Files:**
- Modify: `web/src/features/rooms/voice/voice-api.ts`、`web/src/features/rooms/voice/use-room-voice.ts`、`web/src/features/rooms/voice/use-room-voice.test.tsx`、`web/src/features/rooms/voice/voice-contract.test.ts`

**Interfaces:**
- Produces:`uploadVoice(api, roomId, wav, clientId, replyTo, toAgent?: string | null)`;`UseRoomVoiceOptions.toAgent?: string | null`
- `voice-input.tsx` 不改(Ruling:提示由输入条上方的「对象」行常驻显示,语音模式下同样可见;语音长条不再重复)

- [ ] **Step 1: 写失败测试**

`use-room-voice.test.tsx`:`setup` 的 `over` 类型加 `toAgent?: string | null`,`renderHook` 的选项里加 `...(over.toAgent !== undefined ? { toAgent: over.toAgent } : {})`;追加用例:

```tsx
  it("adds to_agent while an agent is addressed, keeps it on a resend, and never for assistant drafts", async () => {
    let fail = true;
    const { hook, mock } = setup("group", {
      "POST /api/rooms/r1/voice": () => (fail ? json({ detail: "boom" }, 503) : json({ seq: 5, message: { seq: 5, id: "m5", kind: "voice" } })),
    }, { toAgent: "builtin:coach" });
    await act(async () => { await hook.result.current.start(); });
    act(() => hook.result.current.finish("send"));
    await waitFor(() => expect(hook.result.current.failed).toBe(true));
    expect((mock.calls[0].body as FormData).get("to_agent")).toBe("builtin:coach");
    fail = false;
    act(() => hook.result.current.retryUpload?.());
    await waitFor(() => expect(mock.calls).toHaveLength(2));
    expect((mock.calls[1].body as FormData).get("to_agent")).toBe("builtin:coach");
    expect((mock.calls[1].body as FormData).get("client_id")).toBe("c1");
  });

  it("sends no to_agent when nothing is addressed", async () => {
    const { hook, mock } = setup("group", { "POST /api/rooms/r1/voice": () => json({ seq: 5, message: { seq: 5, id: "m5", kind: "voice" } }) }, { toAgent: null });
    await act(async () => { await hook.result.current.start(); });
    act(() => hook.result.current.finish("send"));
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    expect([...(mock.calls[0].body as FormData).keys()].sort()).toEqual(["client_id", "file", "reply_to"]);
  });
```

`voice-contract.test.ts`:
  1. 顶部导入 `import { deepMerge } from "~/i18n";`(与现有 `i18n, { webMessages }` 合并为一行)、`import roomAgentsEn from "../agents/locales/en.json";`、`import roomAgentsZh from "../agents/locales/zh-CN.json";`,加帮手:

```ts
/** 主包文案 + 房间页懒加载的 rooms/agents/locales(R-AW1:新 notice 的文案在后者里;页面渲染时两者都已加载)。 */
const roomCopy = (lng: "en" | "zh-CN") => deepMerge(webMessages(lng), (lng === "en" ? roomAgentsEn : roomAgentsZh) as Record<string, unknown>);
```

  2. `it("every socket notice/error code …")` 里的 `(webMessages(lng) as any).web.rooms` 改为 `(roomCopy(lng) as any).web.rooms`。
  3. 在 `describe("voice upload matches SV's recorded payload")` 里追加:

```ts
  it("to_agent is an optional form field the server reads (spec addressing §3.4)", async () => {
    expect(voicePy).toContain('form.get("to_agent")');
    const mock = createFetchMock({ "POST /api/rooms/r%201/voice": () => json(VOICE.http.upload) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    await uploadVoice(api, "r 1", new Blob([new Uint8Array(44)], { type: "audio/wav" }), "c1", null, "builtin:coach");
    const form = mock.calls[0].body as FormData;
    expect([...form.keys()].sort()).toEqual(["client_id", "file", "to_agent"]);
    expect(mock.calls[0].url.search).toBe("");
  });
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/rooms/voice`。

- [ ] **Step 3: 实现**

`voice-api.ts`(导入 `ROOM_LIMITS` 与类型一起 `import { ROOM_LIMITS, type RoomMessage } from "../protocol";`):

```ts
/** 上传一条语音(16 kHz 单声道 16 位 WAV)。同一 clientId 重复上传由服务端去重,返回原消息。
 *  toAgent:「对象」生效时的角色 id(spec addressing §3.4),转写成功后由服务端交给该智能体;null = 只发给房间。 */
export function uploadVoice(api: ApiClient, roomId: string, wav: Blob, clientId: string, replyTo: number | null,
  toAgent: string | null = null): Promise<{ seq: number; message: RoomMessage }> {
  const form = new FormData();
  form.append("file", new File([wav], "voice.wav", { type: "audio/wav" }));
  form.append("client_id", clientId);
  if (replyTo !== null) form.append("reply_to", String(replyTo));
  const to = toAgent?.trim().slice(0, ROOM_LIMITS.id);
  if (to) form.append("to_agent", to);
  return api.request("POST", voicePath(roomId), { form, timeoutMs: 120_000 });
}
```

`use-room-voice.ts`:
  1. `UseRoomVoiceOptions` 加 `/** 「对象」生效时的角色 id(R-AW3:轮到自己答带练时页面传 null);只用于发往群聊的语音 */ toAgent?: string | null;`。
  2. `interface FailedUpload { wav: Blob; clientId: string; replyTo: number | null; toAgent: string | null }`。
  3. `deliver` 里 `const { roomId, replyTo } = o;` 之后加 `const toAgent = o.target === "group" ? o.toAgent ?? null : null;`;`uploadVoice(api, roomId, wav, clientId, replyTo)` 改为 `uploadVoice(api, roomId, wav, clientId, replyTo, toAgent)`;`failedUpload.current = { wav, clientId, replyTo };` 改为 `failedUpload.current = { wav, clientId, replyTo, toAgent };`。
  4. `retryUpload` 里 `uploadVoice(api, opts.current.roomId, item.wav, item.clientId, item.replyTo)` 改为 `uploadVoice(api, opts.current.roomId, item.wav, item.clientId, item.replyTo, item.toAgent)`。

- [ ] **Step 4: 跑测试** — 同 Step 2。
- [ ] **Step 5: 提交** — `feat(web): room voice carries to_agent while an agent is addressed`。

---

## Lane T · 带练条

### Task T1: 房间带练条:「直接说」、识别中 / 没听清、`hint_zh`

**Files:**
- Create: `web/src/features/rooms/agents/tutor-voice.ts`、`web/src/features/rooms/agents/tutor-voice.test.ts`
- Modify: `web/src/features/rooms/agents/tutor-bar.tsx`、`web/src/features/rooms/agents/tutor.test.tsx`

**Interfaces:**
- Produces:`turnVoice(messages, meId, sinceSeq, notice): "none" | "recognizing" | "unclear"`、`maxSeq(messages)`;`TutorBar` 新可选属性 `messages?: readonly RoomMessage[]`、`notice?: string | null`、`voice?: boolean`

- [ ] **Step 1: 写失败测试**

`web/src/features/rooms/agents/tutor-voice.test.ts`:

```ts
import { expect, it } from "vitest";
import type { VoiceInfo } from "../protocol";
import { ME, msg } from "./fixtures";
import { maxSeq, turnVoice } from "./tutor-voice";

const voice = (status: VoiceInfo["status"]): VoiceInfo => ({ durationMs: 2000, status, transcript: status === "done" ? "I went there" : null, lang: null,
  translation: null, translationStatus: null, attempts: 1, audio: true });
const mine = (seq: number, status: VoiceInfo["status"]) => msg({ seq, kind: "voice", text: "", sender: { kind: "user", id: ME, name: "alice" }, voice: voice(status) });

it("only my voice messages after the turn started count; the latest decides (spec addressing §3.2 #3)", () => {
  expect(turnVoice([mine(3, "pending")], ME, 5, null)).toBe("none"); // sent before my turn
  expect(turnVoice([mine(6, "pending")], ME, 5, null)).toBe("recognizing");
  expect(turnVoice([mine(6, "empty")], ME, 5, null)).toBe("unclear");
  expect(turnVoice([mine(6, "failed")], ME, 5, null)).toBe("unclear");
  expect(turnVoice([mine(6, "empty"), mine(7, "pending")], ME, 5, null)).toBe("recognizing");
  expect(turnVoice([mine(6, "done")], ME, 5, null)).toBe("none");
  const other = msg({ seq: 8, kind: "voice", text: "", sender: { kind: "user", id: 22, name: "bob" }, voice: voice("pending") });
  expect(turnVoice([other], ME, 5, null)).toBe("none");
  expect(turnVoice([{ ...mine(9, "pending"), hidden: true }], ME, 5, null)).toBe("none");
});

it("the server's voice_unclear notice also means unclear, unless a newer attempt is being recognized", () => {
  expect(turnVoice([], ME, 5, "voice_unclear")).toBe("unclear");
  expect(turnVoice([mine(6, "pending")], ME, 5, "voice_unclear")).toBe("recognizing");
  expect(turnVoice([], ME, 5, "ai_busy")).toBe("none");
});

it("maxSeq is 0 for an empty list", () => {
  expect(maxSeq([])).toBe(0);
  expect(maxSeq([mine(4, "done"), mine(9, "done")])).toBe(9);
});
```

`web/src/features/rooms/agents/tutor.test.tsx` 追加(文件已有 `TUTOR`、`ME`、`msg` 可从 `./fixtures` 导入):

```tsx
const myVoice = (seq: number, status: "pending" | "empty" | "done") => msg({ seq, kind: "voice", text: "", sender: { kind: "user", id: ME, name: "alice" },
  voice: { durationMs: 2000, status, transcript: null, lang: null, translation: null, translationStatus: null, attempts: 1, audio: true } });

it("tells the called member to just speak (voice on) or type (voice off)", () => {
  const { unmount } = renderWithProviders(<TutorBar tutor={TUTOR} receivedAt={Date.now()} meId={ME} isOwner={false} roomId="r1" disabled={false} voice />);
  expect(screen.getByRole("status")).toHaveTextContent("轮到你了 · 直接说或打字回答");
  unmount();
  renderWithProviders(<TutorBar tutor={TUTOR} receivedAt={Date.now()} meId={ME} isOwner={false} roomId="r1" disabled={false} />);
  expect(screen.getByRole("status")).toHaveTextContent("轮到你了 · 打字回答");
});

it("shows 识别中… while my answer is being transcribed and 没听清 when it came back empty", () => {
  const base = { tutor: TUTOR, receivedAt: Date.now(), meId: ME, isOwner: false, roomId: "r1", disabled: false, voice: true };
  const { rerender } = renderWithProviders(<TutorBar {...base} messages={[myVoice(3, "done")]} />);
  rerender(<TutorBar {...base} messages={[myVoice(3, "done"), myVoice(4, "pending")]} />);
  expect(screen.getByRole("status")).toHaveTextContent("识别中…");
  rerender(<TutorBar {...base} messages={[myVoice(3, "done"), myVoice(4, "empty")]} />);
  expect(screen.getByRole("status")).toHaveTextContent("没听清,再说一次");
  rerender(<TutorBar {...base} messages={[myVoice(3, "done")]} notice="voice_unclear" />);
  expect(screen.getByRole("status")).toHaveTextContent("没听清,再说一次");
});

it("does not show my recognition state when it is someone else's turn", () => {
  renderWithProviders(<TutorBar tutor={{ ...TUTOR, currentUserId: 22, currentName: "bob" }} receivedAt={Date.now()} meId={ME} isOwner={false} roomId="r1"
    disabled={false} voice messages={[myVoice(9, "pending")]} />);
  expect(screen.getByRole("status")).toHaveTextContent("轮到 bob");
});

it("folds the tutor hint_zh when the server sends it, and shows nothing otherwise (R-AW14)", () => {
  const { unmount } = renderWithProviders(<TutorBar tutor={{ ...TUTOR, hintZh: "想想过去式" }} receivedAt={Date.now()} meId={ME} isOwner={false} roomId="r1" disabled={false} />);
  const toggle = screen.getByTestId("room-tutor-hint-zh-toggle");
  expect(toggle).toHaveAccessibleName("中文");
  fireEvent.click(toggle);
  expect(screen.getByTestId("room-tutor-hint-zh-text")).toHaveTextContent("想想过去式");
  unmount();
  renderWithProviders(<TutorBar tutor={TUTOR} receivedAt={Date.now()} meId={ME} isOwner={false} roomId="r1" disabled={false} />);
  expect(screen.queryByTestId("room-tutor-hint-zh")).toBeNull();
});
```

(`rerender` 来自 `renderWithProviders` 的返回值——它是 Testing Library 的 `render` 结果;若包装没有透传 `rerender`,改为在一个父组件里用 state 切换 `messages`。)

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/rooms/agents/tutor-voice.test.ts src/features/rooms/agents/tutor.test.tsx`。

- [ ] **Step 3: 实现**

`web/src/features/rooms/agents/tutor-voice.ts`:

```ts
import { ROOM_NOTICE_VOICE_UNCLEAR, type RoomMessage } from "../protocol";

export type TurnVoice = "none" | "recognizing" | "unclear";

export const maxSeq = (messages: readonly RoomMessage[]): number => messages.reduce((n, m) => Math.max(n, m.seq), 0);

/**
 * 轮到我时我发的语音的识别状态(spec addressing §3.2 第 3 条,R-AW12):只看 seq > sinceSeq(轮到我那一刻列表里最大的 seq)的、
 * 我自己的、没被隐藏的语音,最新一条在转写 → 识别中;为空 / 失败 → 没听清。服务端的 voice_unclear 提示也算没听清。
 * 识别成功由服务端推进带练(下一帧),这里什么都不显示。
 */
export function turnVoice(messages: readonly RoomMessage[], meId: number | null, sinceSeq: number, notice: string | null): TurnVoice {
  let last: RoomMessage | undefined;
  for (const m of messages) {
    if (m.seq > sinceSeq && m.kind === "voice" && !m.hidden && m.sender.kind === "user" && m.sender.id === meId) last = m;
  }
  const status = last?.voice?.status;
  if (status === "pending") return "recognizing";
  if (status === "empty" || status === "failed") return "unclear";
  return notice === ROOM_NOTICE_VOICE_UNCLEAR ? "unclear" : "none";
}
```

`web/src/features/rooms/agents/tutor-bar.tsx`:
  1. 顶部加 `import "./locales";`、`import { useMemo } from "react";`(与现有 `useEffect, useState` 合并)、`import { ZhNoteFold } from "~/components/zh-note-fold";`、`import type { RoomMessage } from "../protocol";`(与现有 protocol 导入合并)、`import { maxSeq, turnVoice } from "./tutor-voice";`。
  2. 组件签名改为:

```tsx
export function TutorBar({ tutor, receivedAt, meId, isOwner, roomId, disabled, messages = NO_MESSAGES, notice = null, voice = false }: {
  tutor: RoomTutorInfo | null; receivedAt: number; meId: number | null; isOwner: boolean; roomId: string; disabled: boolean;
  /** 房间消息(推出「识别中 / 没听清」);房间页传 state.messages */
  messages?: readonly RoomMessage[];
  /** 当前的 notice(voice_unclear 也算没听清) */
  notice?: string | null;
  /** 本房可发语音:轮到我时提示「直接说或打字回答」 */
  voice?: boolean;
}) {
```

  并在组件外加 `const NO_MESSAGES: readonly RoomMessage[] = [];`。
  3. 在 `const [busy, setBusy] = useState(false);` 之后(仍在 `if (!tutor) return null;` 之前)加:

```tsx
  const mine = waiting && tutor?.currentUserId === meId;
  // 轮到我的那一刻记下列表里最大的 seq:之后我发的语音才算这一题的回答(轮次键变化才重算)
  const turnKey = mine && tutor ? `${tutor.stepIndex}:${tutor.currentUserId}` : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sinceSeq = useMemo(() => maxSeq(messages), [turnKey]);
  const heard = mine ? turnVoice(messages, meId, sinceSeq, notice) : "none";
```

  4. 删除原来 `if (!tutor) return null;` 之后的 `const mine = …` 一行;`label` 的 `mine ? t("web.rooms.agents.tutor.yourTurn")` 分支改为

```tsx
    : mine ? (heard === "recognizing" ? t("web.rooms.agents.tutor.recognizing") : heard === "unclear" ? t("web.rooms.agents.tutor.unclear")
      : voice ? t("web.rooms.agents.tutor.yourTurnSpeak") : t("web.rooms.agents.tutor.yourTurnType"))
```

  5. 在最后一个按钮(「结束带练」)之后、外层 `</div>` 之前加:

```tsx
      {tutor.hintZh ? (
        <ZhNoteFold text={tutor.hintZh} showLabel={t("web.rooms.agents.note.show")} hideLabel={t("web.rooms.agents.note.hide")}
          testId="room-tutor-hint-zh" className="basis-full" />
      ) : null}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/rooms/agents`(原有「轮到你了」断言是子串匹配,仍通过)。
- [ ] **Step 5: 提交** — `feat(web): room tutor bar says just speak, shows recognizing / didn't catch that and the folded hint_zh`。

### Task T2: 1:1 带练条的 `hint_zh`

**Files:**
- Modify: `web/src/features/agents/tutor/tutor-api.ts`、`use-tutor-session.ts`、`tutor-bar.tsx`、`tutor-bar-panel.tsx`、`tutor-bar.test.tsx`、`tutor-bar-panel.test.tsx`、`tutor-contract.test.ts`

**Interfaces:**
- Produces:`TutorHintResult.hintZh?: string | null`;`useTutorSession().hintZh`;`TutorBarProps.hintZh?: string | null`

- [ ] **Step 1: 写失败测试**

`tutor-bar.test.tsx` 追加:

```tsx
it("folds the Chinese hint under the English hint; nothing without it", () => {
  const { unmount } = renderWithProviders(<TutorBar {...props({ hint: "Think about yesterday.", hintZh: "想想昨天" })} />);
  expect(screen.getByTestId("tutor-hint")).toHaveTextContent("Think about yesterday.");
  const toggle = screen.getByTestId("tutor-hint-zh-toggle");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(screen.getByTestId("tutor-hint-zh-text")).toHaveTextContent("想想昨天");
  unmount();
  renderWithProviders(<TutorBar {...props({ hint: "Think about yesterday." })} />);
  expect(screen.queryByTestId("tutor-hint-zh")).toBeNull();
});
```

(`props()` 是文件里现有的帮手;导入 `fireEvent`。)

`tutor-bar-panel.test.tsx` 追加(沿用文件里现有的会话 / 回合夹具与 mock 写法;若帮手名不同按文件实际改):

```tsx
it("keeps hint_zh out of 听一遍: listen speaks the last reply only", async () => {
  // 路由:GET 会话(await_answer),POST /hint 返回 { hint, hint_zh, session }
  // 渲染 TutorBarPanel,lastReply = "Tell me about your weekend.",onSpeak = vi.fn()
  // 点「提示」→ 出现「中文」折叠;点「听一遍」→ onSpeak 只收到 lastReply,不含「周末」
});
```

把上面的注释写成真实代码:路由 `"POST /api/agents/tutor/s1/hint": () => json({ hint: "Talk about Saturday.", hint_zh: "说说周末", session: SESSION_WAITING })`,断言 `await screen.findByTestId("tutor-hint-zh")`、点 `tutor-listen` 后 `expect(onSpeak).toHaveBeenCalledWith("Tell me about your weekend.")` 且 `expect(JSON.stringify(onSpeak.mock.calls)).not.toContain("周末")`(`SESSION_WAITING` 用文件里现有的 `await_answer` 会话样例)。

`tutor-contract.test.ts`:`HINT` 记录改为 `{ hint: true, hintZh: true, session: true }`,比较改为

```ts
  const OPTIONAL_HINT = ["hintZh"];
  expect(keys(camel<TutorHintResult>(contract.hint)).filter((k) => !OPTIONAL_HINT.includes(k)))
    .toEqual(keys(HINT).filter((k) => !OPTIONAL_HINT.includes(k)));
  const rawZh = (contract.hint as { hint_zh?: unknown }).hint_zh;
  if (rawZh !== undefined) expect(typeof rawZh).toBe("string");
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/agents/tutor`。

- [ ] **Step 3: 实现**
  1. `tutor-api.ts`:`export interface TutorHintResult { hint: string; /** 提示的中文说明(spec addressing §5.2,可选;缺省 = 没有) */ hintZh?: string | null; session: TutorSession }`。
  2. `use-tutor-session.ts`:在 `const [hint, setHint] = useState<string | null>(null);` 之后加 `const [hintZh, setHintZh] = useState<string | null>(null);`;文件里**每一处** `setHint(null);`(写计划时在第 50、69、81、103 行附近)后面紧跟 `setHintZh(null);`;`requestHint` 里 `setHint(r.hint);` 之后加 `setHintZh(typeof r.hintZh === "string" && r.hintZh.trim() ? r.hintZh.trim() : null);`;返回值改为 `{ session, busy, hint, hintZh, skip, requestHint, finish, resume } as const`。
  3. `tutor-bar.tsx`:导入 `import { ZhNoteFold } from "~/components/zh-note-fold";`;`TutorBarProps` 加 `hintZh?: string | null;`,解构里加 `hintZh`;在 `tutor-hint` 段落之后加

```tsx
      {hint && hintZh ? (
        <ZhNoteFold text={hintZh} showLabel={t("web.agents.tutor.bar.zhShow")} hideLabel={t("web.agents.tutor.bar.zhHide")} testId="tutor-hint-zh" className="mt-1" />
      ) : null}
```

  4. `tutor-bar-panel.tsx`:`<TutorBar … hint={tutor.hint}` 之后加 `hintZh={tutor.hintZh}`(`onListen` 不变:读 `say` 或 `lastReply`,从不读提示)。

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/agents src/architecture.test.ts`(tutor 只导入 `../locales` 与 `~/components/*`)。
- [ ] **Step 5: 提交** — `feat(web): folded hint_zh on the 1:1 tutor bar`。

---

## Lane M · `@` 补全

### Task M1: 纯逻辑 `mention-suggest.ts`

**Files:**
- Create: `web/src/features/rooms/agents/mention-suggest.ts`、`web/src/features/rooms/agents/mention-suggest.test.ts`

**Interfaces:**
- Produces:`MentionAgent { id; name; disabled? }`、`MentionOption { key; label; insert; personaId: string | null }`、`mentionQuery(value, caret): string | null`、`mentionOptions(agents, query, aliasLabel): MentionOption[]`、`applyMention(value, caret, option): { value; caret }`

- [ ] **Step 1: 写失败测试** — `mention-suggest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyMention, mentionOptions, mentionQuery, type MentionAgent } from "./mention-suggest";

const AGENTS: MentionAgent[] = [{ id: "builtin:coach", name: "Emma" }, { id: "u1", name: "Leo" }, { id: "u2", name: "Lena", disabled: true }];

describe("mentionQuery (only a leading @word, like the server's matcher)", () => {
  it.each([
    ["@", 1, ""], ["@Em", 3, "Em"], ["  @le", 5, "le"], ["＠e", 2, "e"], ["@助", 2, "助"],
    ["hi @Em", 6, null], ["@Emma ", 6, null], ["@Emma hi", 3, "Em"], ["", 0, null], ["@@", 2, null],
  ])("%j at %i → %j", (value, caret, expected) => {
    expect(mentionQuery(value as string, caret as number)).toBe(expected);
  });
});

describe("mentionOptions", () => {
  it("lists the AI alias first, then enabled agents by name prefix (case-insensitive)", () => {
    expect(mentionOptions(AGENTS, "", "AI(Emma)").map((o) => o.label)).toEqual(["AI(Emma)", "Emma", "Leo"]);
    expect(mentionOptions(AGENTS, "le", "AI(Emma)").map((o) => o.label)).toEqual(["Leo"]);
    expect(mentionOptions(AGENTS, "A", "AI(Emma)").map((o) => o.key)).toEqual(["alias"]);
    expect(mentionOptions(AGENTS, "助", "AI(Emma)").map((o) => o.key)).toEqual(["alias"]);
    expect(mentionOptions(AGENTS, "x", "AI")).toEqual([]);
  });

  it("inserts @AI for the alias and @Name for an agent, with a trailing space", () => {
    const [alias, emma] = mentionOptions(AGENTS, "", "AI(Emma)");
    expect([alias.insert, alias.personaId]).toEqual(["@AI ", null]);
    expect([emma.insert, emma.personaId]).toEqual(["@Emma ", "builtin:coach"]);
  });
});

describe("applyMention", () => {
  const emma = mentionOptions(AGENTS, "", "AI")[1];
  it("replaces the leading token (full-width ＠ too) and keeps the rest of the message", () => {
    expect(applyMention("@Em", 3, emma)).toEqual({ value: "@Emma ", caret: 6 });
    expect(applyMention("＠e can you help", 2, emma)).toEqual({ value: "@Emma can you help", caret: 6 });
    expect(applyMention("  @Emxx  tail", 5, emma)).toEqual({ value: "@Emma tail", caret: 6 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/rooms/agents/mention-suggest.test.ts`。
- [ ] **Step 3: 实现** — `mention-suggest.ts`:

```ts
/**
 * `@` 补全(spec addressing §3.2 第 4 条,R-AW13)。服务端只认消息开头的 `@名字` / `@ai` / `@助手`,补全也只在开头;
 * 全角「＠」(中文输入法)同样触发,插入时换成半角。服务端是权威,这里只帮用户拼写。
 */
export interface MentionAgent { id: string; name: string; disabled?: boolean }
export interface MentionOption {
  key: string;
  /** 列表里显示的文字(别名项:「AI(Emma)」) */
  label: string;
  /** 替换开头 @词 的文字,带结尾空格 */
  insert: string;
  /** 别名项为 null(由服务端交给默认智能体) */
  personaId: string | null;
}

const LEADING = /^\s*[@＠]([^\s@＠]*)$/u;
const ALIASES = ["ai", "助手"];

/** 光标前的文字是「开头的 @词(还没打空格)」时返回这个词(可为空串),否则 null。 */
export function mentionQuery(value: string, caret: number): string | null {
  const head = value.slice(0, Math.max(0, Math.min(caret, value.length)));
  const m = LEADING.exec(head);
  return m ? m[1] : null;
}

export function mentionOptions(agents: readonly MentionAgent[], query: string, aliasLabel: string): MentionOption[] {
  const q = query.toLowerCase();
  const out: MentionOption[] = [];
  if (ALIASES.some((a) => a.startsWith(q))) out.push({ key: "alias", label: aliasLabel, insert: "@AI ", personaId: null });
  for (const a of agents) {
    const name = a.name.trim();
    if (!a.disabled && name && name.toLowerCase().startsWith(q)) out.push({ key: a.id, label: name, insert: `@${name} `, personaId: a.id });
  }
  return out;
}

/** 用选中的项替换开头的 @词(到词尾为止),其余文字原样接在后面;返回新值与光标位置。 */
export function applyMention(value: string, caret: number, option: MentionOption): { value: string; caret: number } {
  const wordEnd = caret + (/^[^\s]*/u.exec(value.slice(caret))?.[0].length ?? 0);
  const tail = value.slice(wordEnd).replace(/^\s+/u, "");
  return { value: option.insert + tail, caret: option.insert.length };
}
```

- [ ] **Step 4: 跑测试** — 同 Step 2。
- [ ] **Step 5: 提交** — `feat(web): pure @ autocomplete helpers for room agents`。

### Task M2: 输入条的候选列表与占位符

**Files:**
- Modify: `web/src/features/rooms/room-composer.tsx`、`web/src/features/rooms/room-composer.test.tsx`、`web/src/features/rooms/agents/room-page-agents.test.tsx`(一处)

**Interfaces:**
- Produces:`RoomComposerProps.mentions?: { agents: readonly MentionAgent[]; defaultName: string | null }`、`RoomComposerProps.groupPlaceholder?: string`;测试 id `room-mention-list`、`room-mention-option`

- [ ] **Step 1: 写失败测试** — `room-composer.test.tsx`(顶部补 `import userEvent from "@testing-library/user-event";`、`import { useState } from "react";`):

```tsx
const MENTIONS = { agents: [{ id: "builtin:coach", name: "Emma" }, { id: "u1", name: "Leo" }], defaultName: "Emma" };

function Controlled(over: Partial<RoomComposerProps> & { onSendSpy?: () => void }) {
  const [value, setValue] = useState("");
  return (
    <RoomComposer disabled={false} offline={false} ai target="group" onClearTarget={() => {}} voice={{ available: false, mode: "text", onToggle: () => {}, input: null }}
      mentions={MENTIONS} {...over} value={value} onChange={setValue} onSend={over.onSendSpy ?? (() => {})} />
  );
}

describe("RoomComposer @ autocomplete (spec addressing §3.2 #4)", () => {
  beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
  afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

  it("opens on a leading @ with the AI alias named after the default agent, filters, and Enter picks instead of sending", async () => {
    const onSend = vi.fn();
    renderWithProviders(<Controlled onSendSpy={onSend} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "@");
    const list = screen.getByRole("listbox", { name: "选择智能体" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["AI(Emma)", "Emma", "Leo"]);
    expect(input).toHaveAttribute("aria-expanded", "true");
    await userEvent.type(input, "l");
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Leo"]);
    await userEvent.keyboard("{Enter}");
    expect(input).toHaveValue("@Leo ");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("moves with the arrow keys and closes on Escape until the text changes", async () => {
    renderWithProviders(<Controlled />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "@");
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1].id);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    await userEvent.type(input, "E");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("a tap picks without taking focus from the input (iOS keeps the keyboard)", async () => {
    renderWithProviders(<Controlled />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "＠");
    const emma = screen.getAllByRole("option")[1];
    const down = fireEvent.mouseDown(emma);
    expect(down).toBe(false); // default prevented: the input does not blur
    fireEvent.click(emma);
    expect(input).toHaveValue("@Emma ");
    expect(document.activeElement).toBe(input);
  });

  it("leaves keys alone while an IME is composing (iOS / Android / Sogou)", async () => {
    const onSend = vi.fn();
    renderWithProviders(<Controlled onSendSpy={onSend} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "@");
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(input).toHaveValue("@");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("closes on blur and never opens mid-message", async () => {
    renderWithProviders(<Controlled />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "@");
    fireEvent.blur(input);
    expect(screen.queryByRole("listbox")).toBeNull();
    await userEvent.clear(input);
    await userEvent.type(input, "hi @E");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("the @ key inserts a bare @ and opens the list when agents exist; shows the default agent in the placeholder", async () => {
    renderWithProviders(<Controlled groupPlaceholder="说点什么,或 @AI(Emma)提问" />);
    expect(screen.getByRole("combobox")).toHaveAttribute("placeholder", "说点什么,或 @AI(Emma)提问");
    fireEvent.click(screen.getByTestId("room-at-ai"));
    expect(screen.getByRole("combobox")).toHaveValue("@");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });
});
```

(顶部 `@testing-library/react` 的导入补上 `within`。)现有用例 `setup()` 不传 `mentions`:`@` 键仍插入「@ai 」、输入框仍是 `textbox`,不改。

`room-page-agents.test.tsx`:`expect(screen.getByRole("textbox")).toHaveValue("@Emma ");` 改为 `expect(screen.getByRole("combobox")).toHaveValue("@Emma ");`(房间页在 C3 之后传 `mentions`;在 C3 之前合并时这一行先改成 `screen.getByTestId("room-input")`,两种都对)。

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/rooms/room-composer.test.tsx`。

- [ ] **Step 3: 实现** — `room-composer.tsx`:

1. 导入:

```tsx
import "./agents/locales";
import { forwardRef, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { applyMention, mentionOptions, mentionQuery, type MentionAgent, type MentionOption } from "./agents/mention-suggest";
```

2. `RoomComposerProps` 末尾加:

```tsx
  /** `@` 补全候选(房间开了 AI 时由页面传入;agents 可为空,只剩「AI」别名);不传 = 没有补全,@ 键照旧插入「@ai 」 */
  mentions?: { agents: readonly MentionAgent[]; defaultName: string | null };
  /** 群聊占位文字(显示默认智能体名字,R-AW1);不传 = 原来的文案 */
  groupPlaceholder?: string;
```

3. 组件参数解构加 `mentions, groupPlaceholder`;`const placeholder = …` 改为 `const placeholder = assist ? t("web.rooms.assist.placeholder") : groupPlaceholder ?? t("web.rooms.room.placeholder");`;在它之后加:

```tsx
  // @ 补全(R-AW13):只在消息开头;组字中不拦截按键;选项按下不夺焦点
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const query = mentions && !assist && !voiceMode ? mentionQuery(value, caret) : null;
  const aliasLabel = mentions?.defaultName ? t("web.rooms.agents.mention.aliasOf", { name: mentions.defaultName }) : t("web.rooms.agents.mention.alias");
  const options: MentionOption[] = mentions && query !== null ? mentionOptions(mentions.agents, query, aliasLabel) : [];
  const open = focused && options.length > 0 && dismissed !== value;
  const current = Math.min(active, Math.max(0, options.length - 1));
  useEffect(() => { setActive(0); }, [query]);
  const pick = (option: MentionOption) => {
    const next = applyMention(value, caret, option);
    onChange(next.value);
    setCaret(next.caret);
    setDismissed(null);
    const input = inputRef.current;
    input?.focus();
    requestAnimationFrame(() => input?.setSelectionRange(next.caret, next.caret));
  };
```

4. `<input …>` 的属性改为(其余属性不变):

```tsx
            <input ref={inputRef} data-testid="room-input" disabled={disabled} value={value} maxLength={ROOM_LIMITS.text} enterKeyHint="send"
              aria-label={placeholder} placeholder={placeholder}
              role={mentions ? "combobox" : undefined} aria-autocomplete={mentions ? "list" : undefined} aria-expanded={mentions ? open : undefined}
              aria-controls={open ? listId : undefined} aria-activedescendant={open ? `${listId}-${current}` : undefined}
              onChange={(e) => { onChange(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                // 输入法组字中(iOS / Android 的 keyCode 229、搜狗):回车与方向键属于输入法,一律不拦截
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (open) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((i) => (Math.min(i, options.length - 1) + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(options[current]); return; }
                  if (e.key === "Escape") { e.preventDefault(); setDismissed(value); return; }
                }
                if (e.key === "Enter") { e.preventDefault(); if (!offline) onSend(); }
              }}
              className="h-full min-w-0 flex-1 truncate bg-transparent text-base text-ink placeholder:text-ink-2 focus-visible:outline-none disabled:opacity-60" />
```

5. 紧接 `<input>` 之后(仍在 `room-input-box` 里,它是 `relative`)加候选列表:

```tsx
            {open && (
              <ul id={listId} role="listbox" aria-label={t("web.rooms.agents.mention.list")} data-testid="room-mention-list"
                className="absolute inset-x-0 bottom-full z-40 mb-2 overflow-hidden rounded-card border-[0.5px] border-hair bg-surface py-1 shadow-card dark:shadow-none">
                {options.map((o, i) => (
                  <li key={o.key} id={`${listId}-${i}`} role="option" aria-selected={i === current} data-testid="room-mention-option"
                    onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}
                    className={cn("flex min-h-tap cursor-pointer items-center gap-2 px-3 text-body text-ink", i === current && "bg-surface-2")}>
                    <AtSignIcon aria-hidden className="size-4 flex-none text-ink-3" />
                    <span className="min-w-0 truncate">{o.label}</span>
                  </li>
                ))}
              </ul>
            )}
```

6. `@` 键的 `onClick` 改为:

```tsx
                onClick={() => {
                  if (mentions) { onChange("@"); setCaret(1); setDismissed(null); } // 有补全:插入 @ 并打开候选
                  else onChange(/^@ai\b/i.test(value) ? value : `@ai ${value}`);
                  inputRef.current?.focus();
                }}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/rooms/room-composer.test.tsx src/features/rooms/agents/room-page-agents.test.tsx`。浏览器窗格 360×740:列表在输入框正上方、宽度等于输入框,不超出屏幕。
- [ ] **Step 5: 提交** — `feat(web): @ autocomplete in the room composer (alias AI, keyboard, touch, IME-safe)`。

---

## Lane C · 「对象」

### Task C1: 纯逻辑 `target.ts`

**Files:**
- Create: `web/src/features/rooms/agents/target.ts`、`web/src/features/rooms/agents/target.test.ts`

**Interfaces:**
- Produces:`TargetState`、`TargetAuto`、`TARGET_OFF`、`targetKey(userId, roomId)`、`loadTarget(userId, roomId)`、`saveTarget(userId, roomId, s)`、`tutorSig(t)`、`tutorEnded(messages, sinceSeq)`、`nextTarget(s, input)`、`TargetBlock`、`targetBlock(p)`、`Recipient`、`recipientOf(p)`、`myTutorTurn(tutor, meId)`

- [ ] **Step 1: 写失败测试** — `target.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomMessage, RoomTutorInfo } from "../protocol";
import { answer, EMMA, LEO, ME, msg, TUTOR } from "./fixtures";
import {
  loadTarget, myTutorTurn, nextTarget, recipientOf, saveTarget, TARGET_OFF, targetBlock, targetKey, tutorEnded, tutorSig, type TargetState,
} from "./target";

const sys = (seq: number, text: string): RoomMessage => msg({ seq, kind: "system", text, sender: { kind: "system", id: null, name: null } });
const live = { messages: [] as RoomMessage[], seq: 10, closed: false };
const T: RoomTutorInfo = { ...TUTOR, startedBy: 22, currentUserId: 22 };

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("storage (R-AW15)", () => {
  it("round-trips per user and room, and treats garbage or a broken storage as off", () => {
    const s: TargetState = { on: true, personaId: "u1", auto: { sig: "22:p:8", sinceSeq: 3 }, ended: null };
    saveTarget(7, "r1", s);
    expect(loadTarget(7, "r1")).toEqual(s);
    expect(loadTarget(8, "r1")).toEqual(TARGET_OFF);
    expect(loadTarget(null, "r1")).toEqual(TARGET_OFF);
    localStorage.setItem(targetKey(7, "r2"), JSON.stringify({ on: "yes" }));
    expect(loadTarget(7, "r2")).toEqual(TARGET_OFF);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(loadTarget(7, "r1")).toEqual(TARGET_OFF);
  });
});

describe("nextTarget (D2, R-AW4)", () => {
  it("turns on for the tutor's persona when a tutor starts, once per tutor", () => {
    const on = nextTarget(TARGET_OFF, { ...live, tutor: T });
    expect(on).toEqual({ on: true, personaId: T.personaId, auto: { sig: tutorSig(T), sinceSeq: 10 }, ended: null });
    expect(nextTarget(on, { ...live, tutor: { ...T, stepIndex: 3, phase: "generating" } })).toBe(on);
  });

  it("respects a manual off across a reconnect (welcome clears the tutor, the same frame comes back)", () => {
    const manualOff: TargetState = { ...nextTarget(TARGET_OFF, { ...live, tutor: T }), on: false };
    const afterWelcome = nextTarget(manualOff, { ...live, tutor: null });
    expect(afterWelcome).toBe(manualOff);
    expect(nextTarget(afterWelcome, { ...live, tutor: T })).toBe(manualOff);
  });

  it("turns off when the tutor stops or finishes, and a later tutor with the same signature turns it on again", () => {
    const on = nextTarget(TARGET_OFF, { ...live, tutor: T });
    const ended = nextTarget(on, { ...live, tutor: T, messages: [sys(11, "tutor_stopped")] });
    expect(ended).toMatchObject({ on: false, auto: null, ended: tutorSig(T) });
    expect(nextTarget(ended, { ...live, tutor: T, messages: [sys(11, "tutor_stopped")] })).toBe(ended); // frame not cleared yet: stays off
    const cleared = nextTarget(ended, { ...live, tutor: null, messages: [sys(11, "tutor_stopped")] });
    expect(cleared.ended).toBeNull();
    expect(nextTarget(cleared, { ...live, seq: 20, tutor: T, messages: [sys(11, "tutor_stopped")] })).toMatchObject({ on: true, auto: { sinceSeq: 20 } });
    expect(nextTarget(on, { ...live, tutor: null, messages: [sys(12, "tutor_done")] })).toMatchObject({ on: false, auto: null, ended: null });
  });

  it("ignores an older tutor's end message and turns everything off when the room closes", () => {
    const on = nextTarget(TARGET_OFF, { ...live, tutor: T });
    expect(nextTarget(on, { ...live, tutor: T, messages: [sys(9, "tutor_done")] })).toBe(on);
    const manual: TargetState = { on: true, personaId: "u1", auto: null, ended: null };
    expect(nextTarget(manual, { ...live, tutor: null, closed: true })).toEqual({ on: false, personaId: "u1", auto: null, ended: null });
    expect(nextTarget(TARGET_OFF, { ...live, tutor: null, closed: true })).toBe(TARGET_OFF);
  });

  it("does nothing without a tutor when it was not auto-opened (no idle timer, D2)", () => {
    const manual: TargetState = { on: true, personaId: "u1", auto: null, ended: null };
    expect(nextTarget(manual, { ...live, tutor: null, messages: [sys(11, "tutor_done")] })).toBe(manual);
  });

  it("tutorEnded only counts stop / done system messages after sinceSeq", () => {
    expect(tutorEnded([sys(5, "tutor_started"), sys(6, "tutor_done")], 5)).toBe(true);
    expect(tutorEnded([sys(5, "tutor_done")], 5)).toBe(false);
    expect(tutorEnded([msg({ seq: 9, text: "tutor_done" })], 0)).toBe(false); // a member typing the word is not a system message
  });
});

describe("targetBlock (spec §3.3)", () => {
  it("explains why the chip is greyed, in a fixed order", () => {
    const ok = { aiMuted: false, aiPublic: true, aiAvailable: true, agent: EMMA };
    expect(targetBlock(ok)).toBeNull();
    expect(targetBlock({ ...ok, aiMuted: true, aiPublic: false })).toBe("muted");
    expect(targetBlock({ ...ok, aiPublic: false })).toBe("aiOff");
    expect(targetBlock({ ...ok, aiAvailable: false })).toBe("unavailable");
    expect(targetBlock({ ...ok, agent: { ...EMMA, disabled: true } })).toBe("agentOff");
  });
});

describe("recipientOf (server priority: @ai > @name > reply > to; R-AW7)", () => {
  const agents = [EMMA, LEO];
  const leoAnswer = answer(5, 4, { agent: { personaId: LEO.id, name: "Leo" } });
  it("follows the server's order", () => {
    expect(recipientOf({ draft: "@ai hi", quote: leoAnswer, agents, to: LEO.id })).toEqual({ personaId: EMMA.id, name: "Emma", via: "mention" });
    expect(recipientOf({ draft: "@Leo hi", quote: null, agents, to: EMMA.id })).toEqual({ personaId: LEO.id, name: "Leo", via: "mention" });
    expect(recipientOf({ draft: "sure", quote: leoAnswer, agents, to: EMMA.id })).toEqual({ personaId: LEO.id, name: "Leo", via: "reply" });
    expect(recipientOf({ draft: "sure", quote: msg({ seq: 3 }), agents, to: EMMA.id })).toEqual({ personaId: EMMA.id, name: "Emma", via: "target" });
    expect(recipientOf({ draft: "sure", quote: null, agents, to: null })).toBeNull();
  });
});

it("myTutorTurn is true only while the tutor waits for my answer (R-AW3)", () => {
  expect(myTutorTurn({ ...TUTOR, currentUserId: ME }, ME)).toBe(true);
  expect(myTutorTurn({ ...TUTOR, currentUserId: 22 }, ME)).toBe(false);
  expect(myTutorTurn({ ...TUTOR, currentUserId: ME, phase: "generating" }, ME)).toBe(false);
  expect(myTutorTurn(null, ME)).toBe(false);
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/rooms/agents/target.test.ts`。
- [ ] **Step 3: 实现** — `target.ts`:

```ts
import { readJson, writeJson } from "~/lib/storage";
import { mentionsAi, type RoomMessage, type RoomTutorInfo } from "../protocol";
import { agentOf } from "./agent-meta";
import { mentionsAgent } from "./mentions";
import type { RoomAgent } from "./room-agents-api";

/**
 * 「对象」标签的纯逻辑(spec 2026-10-12-agents-addressing §3.2 第 2 条、§3.3;D2;R-AW3–R-AW7、R-AW15)。
 * 状态只记在本机(按用户 + 房间);服务端不保存,客户端每次发送时带 to。
 */
export interface TargetAuto { sig: string; sinceSeq: number }
export interface TargetState {
  on: boolean;
  personaId: string | null;
  /** 由带练自动打开时:带练签名与当时的 seq(之后的结束消息才算这次带练结束) */
  auto: TargetAuto | null;
  /** 结束消息先于带练帧清空到达时记下签名,帧清空后清掉(同一签名的下一次带练仍会自动打开) */
  ended: string | null;
}
export const TARGET_OFF: TargetState = Object.freeze({ on: false, personaId: null, auto: null, ended: null }) as TargetState;

export const targetKey = (userId: number, roomId: string) => `enjoy-web.rooms.target.v1.${userId}.${roomId}`;
const isAuto = (v: unknown): v is TargetAuto =>
  !!v && typeof (v as TargetAuto).sig === "string" && Number.isInteger((v as TargetAuto).sinceSeq);
function isTarget(v: unknown): v is TargetState {
  const o = v as Partial<TargetState> | null;
  return !!o && typeof o === "object" && typeof o.on === "boolean" && (o.personaId === null || typeof o.personaId === "string")
    && (o.auto === null || isAuto(o.auto)) && (o.ended === null || typeof o.ended === "string");
}
/** 取不到(隐私模式、被禁用、内容不对)= 关闭。 */
export function loadTarget(userId: number | null, roomId: string): TargetState {
  if (userId === null || !roomId) return TARGET_OFF;
  return readJson(targetKey(userId, roomId), isTarget) ?? TARGET_OFF;
}
export function saveTarget(userId: number | null, roomId: string, s: TargetState): void {
  if (userId !== null && roomId) writeJson(targetKey(userId, roomId), s);
}

/** 带练帧没有会话 id:用开启者、角色、题数区分一次带练。 */
export const tutorSig = (t: RoomTutorInfo): string => `${t.startedBy}:${t.personaId}:${t.stepsTotal}`;
const ENDED = new Set(["tutor_stopped", "tutor_done"]);
export const tutorEnded = (messages: readonly RoomMessage[], sinceSeq: number): boolean =>
  messages.some((m) => m.kind === "system" && m.seq > sinceSeq && ENDED.has(m.text));

export interface TargetInput { tutor: RoomTutorInfo | null; messages: readonly RoomMessage[]; seq: number; closed: boolean }
/** 自动开关(R-AW4):带练第一次出现 → 打开;它的结束消息 / 房间关闭 → 关闭。没有变化时返回同一个对象。 */
export function nextTarget(s: TargetState, i: TargetInput): TargetState {
  if (i.closed) return s.on || s.auto || s.ended ? { ...s, on: false, auto: null, ended: null } : s;
  if (s.auto && tutorEnded(i.messages, s.auto.sinceSeq)) return { ...s, on: false, auto: null, ended: i.tutor ? tutorSig(i.tutor) : null };
  if (!i.tutor) return s.ended ? { ...s, ended: null } : s;
  const sig = tutorSig(i.tutor);
  if (s.auto?.sig === sig || s.ended === sig) return s;
  return { on: true, personaId: i.tutor.personaId, auto: { sig, sinceSeq: i.seq }, ended: null };
}

export type TargetBlock = "muted" | "aiOff" | "unavailable" | "agentOff";
/** 置灰原因(spec §3.3),顺序固定:管理员静音 > 房主关闭公共 AI > 服务端没有 AI > 角色停用。 */
export function targetBlock(p: { aiMuted: boolean; aiPublic: boolean; aiAvailable: boolean; agent: RoomAgent | null }): TargetBlock | null {
  if (p.aiMuted) return "muted";
  if (!p.aiPublic) return "aiOff";
  if (!p.aiAvailable) return "unavailable";
  if (p.agent?.disabled) return "agentOff";
  return null;
}

export interface Recipient { personaId: string; name: string; via: "mention" | "reply" | "target" }
/** 这条消息会交给谁(与服务端优先级一致:@ai 别名 > @名字 > 回复规则 > to;spec §3.4)。只用于提示。 */
export function recipientOf(p: { draft: string; quote: RoomMessage | null; agents: readonly RoomAgent[]; to: string | null }): Recipient | null {
  const find = (id: string | null | undefined, via: Recipient["via"]): Recipient | null => {
    const a = p.agents.find((x) => x.id === id);
    return a ? { personaId: a.id, name: a.name, via } : null;
  };
  if (mentionsAi(p.draft).ai) return find(p.agents[0]?.id, "mention");
  const named = mentionsAgent(p.draft, p.agents.map((a) => a.name)).index;
  if (named !== null) return find(p.agents[named]?.id, "mention");
  const replied = p.quote ? agentOf(p.quote) : null;
  if (replied) return find(replied.agent.personaId, "reply") ?? { personaId: replied.agent.personaId, name: replied.agent.name, via: "reply" };
  return find(p.to, "target");
}

/** 带练正在等我回答(R-AW3:这时不带 to / to_agent)。 */
export const myTutorTurn = (tutor: RoomTutorInfo | null, meId: number | null): boolean =>
  !!tutor && tutor.phase === "await_answer" && meId !== null && tutor.currentUserId === meId;
```

- [ ] **Step 4: 跑测试** — 同 Step 2。
- [ ] **Step 5: 提交** — `feat(web): pure state for the room agent target (auto on with the tutor, off when it ends)`。

### Task C2: 钩子 `useAgentTarget` 与「对 Emma 说」行

**Files:**
- Create: `web/src/features/rooms/agents/use-agent-target.ts`、`use-agent-target.test.tsx`、`target-row.tsx`、`target-row.test.tsx`

**Interfaces:**
- Produces:`useAgentTarget({ roomId, userId, agents, state, ended, info }): { on; personaId; agent; toggle(personaId) }`;`TargetRow({ agents, activeId, on, block, recipient, disabled, onToggle })`;测试 id `room-target-row`、`room-target-chip`、`room-target-status`

- [ ] **Step 1: 写失败测试**

`use-agent-target.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RoomMessage } from "../protocol";
import { initialRoomState, type RoomState } from "../room-state";
import { EMMA, LEO, msg, TUTOR } from "./fixtures";
import type { RoomAgentsInfo } from "./room-agents-api";
import { targetKey } from "./target";
import { useAgentTarget } from "./use-agent-target";

const sys = (seq: number, text: string): RoomMessage => msg({ seq, kind: "system", text, sender: { kind: "system", id: null, name: null } });
const liveState = (over: Partial<RoomState> = {}): RoomState => ({ ...initialRoomState(), status: "live", lastSeq: 10, liveFrom: 10, ...over });
type P = Parameters<typeof useAgentTarget>[0];
const base = (over: Partial<P> = {}): P => ({ roomId: "r1", userId: 7, agents: [EMMA, LEO], state: liveState(), ended: false, info: null, ...over });

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it("toggles per persona, falls back to the default agent and remembers the choice per user and room", () => {
  const { result } = renderHook((p: P) => useAgentTarget(p), { initialProps: base() });
  expect(result.current).toMatchObject({ on: false, personaId: EMMA.id });
  act(() => result.current.toggle(LEO.id));
  expect(result.current).toMatchObject({ on: true, personaId: LEO.id });
  expect(JSON.parse(localStorage.getItem(targetKey(7, "r1"))!)).toMatchObject({ on: true, personaId: LEO.id });
  act(() => result.current.toggle(LEO.id));
  expect(result.current.on).toBe(false);
});

it("auto-opens when a tutor starts and closes when it ends — no timers involved", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook((p: P) => useAgentTarget(p), { initialProps: base() });
  rerender(base({ state: liveState({ tutor: { ...TUTOR, currentUserId: 22 } }) }));
  expect(result.current).toMatchObject({ on: true, personaId: TUTOR.personaId });
  act(() => { vi.advanceTimersByTime(24 * 3600_000); });
  expect(result.current.on).toBe(true); // D2: never an idle auto-off
  rerender(base({ state: liveState({ tutor: null, messages: [sys(11, "tutor_done")], lastSeq: 11 }) }));
  expect(result.current.on).toBe(false);
  vi.useRealTimers();
});

it("closes a remembered auto-open when the REST roster says the tutor is gone", () => {
  localStorage.setItem(targetKey(7, "r1"), JSON.stringify({ on: true, personaId: EMMA.id, auto: { sig: "22:builtin:coach:8", sinceSeq: 3 }, ended: null }));
  const { result, rerender } = renderHook((p: P) => useAgentTarget(p), { initialProps: base() });
  expect(result.current.on).toBe(true);
  const info: RoomAgentsInfo = { available: true, agents: [EMMA, LEO], tutor: null };
  rerender(base({ info }));
  expect(result.current.on).toBe(false);
});

it("closes when the room ends and is off with no agents", () => {
  const { result, rerender } = renderHook((p: P) => useAgentTarget(p), { initialProps: base() });
  act(() => result.current.toggle(EMMA.id));
  rerender(base({ ended: true }));
  expect(result.current.on).toBe(false);
  rerender(base({ agents: [] }));
  expect(result.current).toMatchObject({ on: false, personaId: null, agent: null });
});

it("still toggles for this visit when storage is unavailable (starts off)", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  const { result } = renderHook((p: P) => useAgentTarget(p), { initialProps: base() });
  expect(result.current.on).toBe(false);
  act(() => result.current.toggle(EMMA.id));
  expect(result.current.on).toBe(true);
});
```

`target-row.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { EMMA, LEO } from "./fixtures";
import { TargetRow, type TargetRowProps } from "./target-row";

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

const setup = (over: Partial<TargetRowProps> = {}) => {
  const props: TargetRowProps = { agents: [EMMA], activeId: EMMA.id, on: false, block: null, recipient: null, disabled: false, onToggle: vi.fn(), ...over };
  renderWithProviders(<TargetRow {...props} />);
  return props;
};

it("shows 对 Emma 说 as a toggle and the standing hint while it is on", () => {
  const p = setup();
  const chip = screen.getByRole("button", { name: "对 Emma 说" });
  expect(chip).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByTestId("room-target-status")).toHaveTextContent("");
  fireEvent.click(chip);
  expect(p.onToggle).toHaveBeenCalledWith(EMMA.id);
});

it("says where the message goes: the target, or the agent being replied to", () => {
  setup({ on: true, recipient: { personaId: EMMA.id, name: "Emma", via: "target" } });
  expect(screen.getByRole("button", { name: "对 Emma 说" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("room-target-status")).toHaveTextContent("消息会交给 Emma");
});

it("shows the reply cue", () => {
  setup({ recipient: { personaId: LEO.id, name: "Leo", via: "reply" } });
  expect(screen.getByTestId("room-target-status")).toHaveTextContent("回复 Leo 中 · 消息会交给 Leo");
});

it("is a two-way picker with two agents", () => {
  const p = setup({ agents: [EMMA, LEO], on: true, activeId: LEO.id });
  expect(screen.getByRole("button", { name: "对 Emma 说" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "对 Leo 说" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "对 Emma 说" }));
  expect(p.onToggle).toHaveBeenCalledWith(EMMA.id);
});

it("greys the chips out with the reason (muted / AI off / disabled persona)", () => {
  setup({ on: true, block: "muted" });
  expect(screen.getByRole("button", { name: "对 Emma 说" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "对 Emma 说" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByTestId("room-target-status")).toHaveTextContent("本房 AI 已被管理员关闭");
});

it("names the disabled persona and keeps labels from widening a 360 px row", () => {
  setup({ block: "agentOff" });
  expect(screen.getByTestId("room-target-status")).toHaveTextContent("Emma 已停用");
  expect(screen.getByTestId("room-target-chip").className).toContain("max-w-[132px]");
  expect(screen.getByTestId("room-target-status").className).toContain("truncate");
});

it("renders nothing without agents and without a reply cue", () => {
  renderWithProviders(<TargetRow agents={[]} activeId={null} on={false} block={null} recipient={null} disabled={false} onToggle={() => {}} />);
  expect(screen.queryByTestId("room-target-row")).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/rooms/agents/use-agent-target.test.tsx src/features/rooms/agents/target-row.test.tsx`。

- [ ] **Step 3: 实现**

`use-agent-target.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomState } from "../room-state";
import type { RoomAgent, RoomAgentsInfo } from "./room-agents-api";
import { loadTarget, nextTarget, saveTarget, type TargetState } from "./target";

export interface AgentTarget {
  /** 开着且房间里有可对准的角色 */
  on: boolean;
  /** 实际对准的角色(选中的不在名单里时回落到默认,R-AW6);名单为空时 null */
  personaId: string | null;
  agent: RoomAgent | null;
  toggle(personaId: string): void;
}

/**
 * 「对象」开关(spec addressing §3.2 第 2 条,D2,R-AW4):按「用户 + 房间」记在本机;带练开始自动打开,结束(完成 / 停止 /
 * 房间关闭)自动关闭;没有计时器、没有空闲关闭。取不到本机存储时从「关」开始,本次打开仍有效(只是不记住,R-AW15)。
 */
export function useAgentTarget(p: { roomId: string; userId: number | null; agents: readonly RoomAgent[]; state: RoomState; ended: boolean; info: RoomAgentsInfo | null }): AgentTarget {
  const { roomId, userId, agents, state, ended, info } = p;
  const [s, setS] = useState<TargetState>(() => loadTarget(userId, roomId));
  const restored = useRef(s.auto !== null);
  const seq = Math.max(state.lastSeq, state.liveFrom);
  useEffect(() => {
    setS((cur) => nextTarget(cur, { tutor: state.tutor, messages: state.messages, seq, closed: ended }));
  }, [state.tutor, state.messages, seq, ended]);
  // 上次离开时带练还开着:第一次读到的 REST 名单说已经没有带练、本页也没收到带练帧 → 关闭(结束消息可能不在补发页里)
  useEffect(() => {
    if (!restored.current || !info) return;
    restored.current = false;
    if (info.tutor === null && state.tutor === null) setS((cur) => (cur.auto ? { ...cur, on: false, auto: null, ended: null } : cur));
  }, [info, state.tutor]);
  useEffect(() => { saveTarget(userId, roomId, s); }, [userId, roomId, s]);
  const agent = agents.find((a) => a.id === s.personaId) ?? agents[0] ?? null;
  const effective = agent?.id ?? null;
  const toggle = useCallback((personaId: string) => {
    setS((cur) => (cur.on && effective === personaId ? { ...cur, on: false, personaId } : { ...cur, on: true, personaId }));
  }, [effective]);
  return { on: s.on && agent !== null, personaId: effective, agent, toggle };
}
```

`target-row.tsx`:

```tsx
import "./locales";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import { ROOM_AGENTS } from "../protocol";
import type { RoomAgent } from "./room-agents-api";
import type { Recipient, TargetBlock } from "./target";

export interface TargetRowProps {
  agents: readonly RoomAgent[];
  /** 实际对准的角色(useAgentTarget.personaId) */
  activeId: string | null;
  on: boolean;
  block: TargetBlock | null;
  /** 这条消息会交给谁(recipientOf);null = 不提示 */
  recipient: Recipient | null;
  disabled: boolean;
  onToggle(personaId: string): void;
}

/**
 * 输入条上方的「对 Emma 说」行(spec addressing §3.2 第 2 条、§3.3):一个角色一个开关(两个角色 = 二选一);右侧常驻提示实际收件人
 * (「消息会交给 Emma」/「回复 Emma 中 · …」,R-AW7)或置灰原因。只对本人生效;单行、截断,360 px 不换行不跳动。
 */
export function TargetRow({ agents, activeId, on, block, recipient, disabled, onToggle }: TargetRowProps) {
  const { t } = useTranslation();
  if (!agents.length && !recipient) return null;
  const blockedName = agents.find((a) => a.id === activeId)?.name ?? "";
  const status = block ? t(`web.rooms.agents.target.off.${block}`, { name: blockedName })
    : recipient ? t(recipient.via === "reply" ? "web.rooms.agents.target.replying" : "web.rooms.agents.target.goesTo", { name: recipient.name }) : "";
  return (
    <div data-testid="room-target-row" className="mx-1 mb-1.5 flex min-h-8 min-w-0 items-center gap-1.5">
      {agents.slice(0, ROOM_AGENTS.max).map((a) => {
        const pressed = on && !block && a.id === activeId;
        return (
          <button key={a.id} type="button" data-testid="room-target-chip" aria-pressed={pressed} disabled={disabled || !!block || a.disabled}
            onClick={() => onToggle(a.id)}
            className={cn("hit-expand relative inline-flex h-7 max-w-[132px] flex-none items-center rounded-full px-2.5 text-meta font-semibold",
              "transition-colors duration-fast motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
              pressed ? "bg-blue text-on-blue" : "bg-surface-2 text-ink-2")}>
            <span className="truncate">{t("web.rooms.agents.target.to", { name: a.name })}</span>
          </button>
        );
      })}
      <span role="status" aria-live="polite" data-testid="room-target-status"
        className={cn("min-w-0 flex-1 truncate text-meta", block ? "text-ink-2" : "text-blue")}>{status}</span>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试** — 同 Step 2。
- [ ] **Step 5: 提交** — `feat(web): useAgentTarget and the 对 Emma 说 row`。

### Task C3: 房间页接线(Addendum AW-1)

**Files:**
- Modify: `web/src/features/rooms/room-page.tsx`、`web/src/features/rooms/agents/room-page-agents.test.tsx`

**Interfaces:**
- Consumes:C1、C2、M2(`mentions`、`groupPlaceholder`)、V1(`toAgent`)、T1(`messages`、`notice`、`voice`)、P1(`say(…, to)`、`ROOM_NOTICE_VOICE_UNCLEAR`)

- [ ] **Step 1: 写失败测试** — `room-page-agents.test.tsx` 追加(复用文件里的 `FakeWebSocket`、`CONFIG`、`TUTOR_WIRE`、`ROOM_WIRE`、`AGENTS_WIRE`、`ME`):

```tsx
const TARGET_KEY = `enjoy-web.rooms.target.v1.${ME}.r1`;
const says = (ws: FakeWebSocket) => ws.sent.map((f) => JSON.parse(f) as Record<string, unknown>).filter((f) => f.type === "say");
async function enterRoom() {
  const mock = createFetchMock({
    "GET /api/rooms/config": () => json(CONFIG),
    "POST /api/rooms/r1/ticket": () => json({ ticket: "secret-ticket", expires_in: 60 }),
    "GET /api/rooms/r1/agents": () => json(AGENTS_WIRE),
  });
  renderWithProviders(<RoomPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/rooms/r/r1", path: "/rooms/r/:roomId" });
  await vi.waitFor(() => expect(FakeWebSocket.last?.sent[0]).toBeTruthy());
  const ws = FakeWebSocket.last!;
  ws.push({ type: "welcome", room: { ...ROOM_WIRE, owner_id: 22, my_role: "member" }, me: { user_id: ME, role: "member" },
    members: [{ user_id: ME, name: "alice", role: "member", online: true }, { user_id: 22, name: "bob", role: "owner", online: true }],
    last_seq: 0, truncated: false, assist_history: [], protocol: 2, reactions: [], join_requests: [] });
  await screen.findByRole("button", { name: "对 Emma 说" });
  return ws;
}
async function send(text: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: text } });
  fireEvent.click(screen.getByTestId("room-send"));
}

it("the target chip adds say.to, shows the standing hint and is remembered per room (spec addressing §3.2 #2)", async () => {
  const ws = await enterRoom();
  expect(screen.getByRole("combobox")).toHaveAttribute("placeholder", "说点什么,或 @AI(Emma)提问");
  await send("plain");
  expect(says(ws).at(-1)).not.toHaveProperty("to");
  fireEvent.click(screen.getByRole("button", { name: "对 Emma 说" }));
  expect(screen.getByTestId("room-target-status")).toHaveTextContent("消息会交给 Emma");
  await send("hello coach");
  expect(says(ws).at(-1)).toMatchObject({ text: "hello coach", to: "builtin:coach" });
  expect(JSON.parse(localStorage.getItem(TARGET_KEY)!)).toMatchObject({ on: true, personaId: "builtin:coach" });
  expect(document.body.textContent).not.toContain("secret-ticket");
});

it("auto-opens for a member when a tutor starts and closes when it stops; never sends to while it is my turn (R-AW3, R-AW4)", async () => {
  const ws = await enterRoom();
  ws.push({ type: "agent_tutor", tutor: { ...TUTOR_WIRE, current_user_id: 22, current_name: "bob" } });
  expect(screen.getByRole("button", { name: "对 Emma 说" })).toHaveAttribute("aria-pressed", "true");
  ws.push({ type: "agent_tutor", tutor: { ...TUTOR_WIRE, current_user_id: ME } }); // now my turn
  await send("I went to the park");
  expect(says(ws).at(-1)).not.toHaveProperty("to");
  ws.push({ type: "message", message: { seq: 3, id: "m3", lane: "public", kind: "system", sender: { kind: "system", id: null, name: null }, text: "tutor_stopped",
    assisted: false, reply_to: null, ai_status: null, created_at: "2026-10-12T09:02:00Z", hidden: false, quote: null, voice: null, reactions: [], meta: {} } });
  ws.push({ type: "agent_tutor", tutor: null });
  expect(screen.getByRole("button", { name: "对 Emma 说" })).toHaveAttribute("aria-pressed", "false");
});

it("shows 回复 Emma 中 while quoting an agent reply and keeps reply_to as today", async () => {
  const ws = await enterRoom();
  ws.push({ type: "message", message: { seq: 2, id: "m2", lane: "public", kind: "ai_answer", sender: { kind: "ai", id: null, name: null }, text: "Try again.",
    assisted: false, reply_to: null, ai_status: null, created_at: "2026-10-12T09:00:00Z", hidden: false, quote: null, voice: null, reactions: [],
    meta: { agent: { persona_id: "builtin:coach", name: "Emma" }, asker: { id: ME, name: "alice" } } } });
  fireEvent.click(await screen.findByTestId("room-message-more"));
  fireEvent.click(screen.getByRole("button", { name: "引用" }));
  expect(screen.getByTestId("room-target-status")).toHaveTextContent("回复 Emma 中 · 消息会交给 Emma");
  await send("ok");
  expect(says(ws).at(-1)).toMatchObject({ reply_to: 2 });
  expect(says(ws).at(-1)).not.toHaveProperty("to");
});

it("hides the generic banner for voice_unclear during my turn (the tutor bar says it)", async () => {
  const ws = await enterRoom();
  ws.push({ type: "agent_tutor", tutor: { ...TUTOR_WIRE, current_user_id: ME } });
  ws.push({ type: "notice", code: "voice_unclear" });
  expect(screen.getByTestId("room-tutor-bar")).toHaveTextContent("没听清,再说一次");
  expect(screen.getAllByText("没听清,再说一次")).toHaveLength(1);
});
```

并在文件的 `afterEach` 里加 `localStorage.removeItem(TARGET_KEY);`(把 `TARGET_KEY` 定义放到 `afterEach` 之前)。「引用」是 `MessageActions` 现有的按钮名;若实际文案不同,以 `extras/i18n/zh-CN.json` 为准。

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/rooms/agents/room-page-agents.test.tsx`。

- [ ] **Step 3: 实现** — `room-page.tsx`(只做下列接线,见 Addendum AW-1):

1. 导入:

```tsx
import type { RoomAgent } from "./agents/room-agents-api";
import { myTutorTurn, recipientOf, targetBlock } from "./agents/target";
import { TargetRow } from "./agents/target-row";
import { useAgentTarget } from "./agents/use-agent-target";
```

并把 `import { ROOM_PROTOCOL_VERSION, type QuoteInfo, type RoomMessage } from "./protocol";` 改为 `import { ROOM_NOTICE_VOICE_UNCLEAR, ROOM_PROTOCOL_VERSION, type QuoteInfo, type RoomMessage } from "./protocol";`。

2. `RoomView` 里 `const { api } = useAuth();` 改为 `const { api, user } = useAuth();`。

3. 在 `const [agentSheet, setAgentSheet] = useState<string | null>(null);` 之后加:

```tsx
  // 「对象」与 @ 补全(plan 2026-10-12-agents-addressing-web Addendum AW-1):房主选择的顺序就是默认顺序,第一个是默认智能体(spec §4,R-AW5)
  const agentKey = agentIds.join(",");
  const roomAgents = useMemo(() => agentIds.map((id) => agentsInfo?.agents.find((a) => a.id === id)).filter((a): a is RoomAgent => !!a),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentKey, agentsInfo]);
  const addressee = useAgentTarget({ roomId, userId: user ? Number(user.id) : null, agents: roomAgents, state, ended, info: agentsInfo });
  const block = targetBlock({ aiMuted: !!info?.aiMuted, aiPublic: info?.aiPublic !== false,
    aiAvailable: !!config.aiAvailable && agentsInfo?.available !== false, agent: addressee.agent });
  const myTurn = myTutorTurn(state.tutor, state.me?.userId ?? null);
  /** 每条发言带的 to(R-AW3:轮到我答带练时不带;置灰时不带) */
  const sendTo = addressee.on && !block && !myTurn ? addressee.personaId : null;
  const recipient = !ended && !block && roomAgents.length ? recipientOf({ draft, quote, agents: roomAgents, to: sendTo }) : null;
  const defaultAgentName = roomAgents[0]?.name ?? null;
```

4. `useRoomVoice({ … })` 的参数里 `replyTo: quote?.seq ?? null,` 之后加 `toAgent: sendTo,`。

5. `send()` 里 `room.say(draft, null, quote?.seq ?? null)` 改为 `room.say(draft, null, quote?.seq ?? null, sendTo)`;`AssistDock` 的 `onSend={(text, assistId) => { if (room.say(text, assistId)) stick.current = true; }}` 改为 `onSend={(text, assistId) => { if (room.say(text, assistId, null, sendTo)) stick.current = true; }}`。

6. `const message = state.notice ? … : null;` 改为:

```tsx
  // 轮到我时「没听清」由带练条显示,不在通用横幅里重复(R-AW12)
  const noticeShown = state.notice && !(state.notice === ROOM_NOTICE_VOICE_UNCLEAR && myTurn) ? state.notice : null;
  const message = noticeShown ? t(`web.rooms.notice.${noticeShown}`) : state.error ? t(`web.rooms.errors.${state.error}`) : null;
```

7. `<RoomComposer …>` 加属性:

```tsx
        mentions={aiAvailable ? { agents: roomAgents, defaultName: defaultAgentName } : undefined}
        groupPlaceholder={aiAvailable ? (defaultAgentName ? t("web.rooms.agents.composer.placeholder", { name: defaultAgentName })
          : t("web.rooms.agents.composer.placeholderNoName")) : undefined}
```

8. `above` 里的 `<TutorBar … />` 加 `messages={state.messages} notice={state.notice} voice={voiceEnabled}`,并在它之后加:

```tsx
            {!ended && target === "group" && (
              <TargetRow agents={roomAgents} activeId={addressee.personaId} on={addressee.on} block={block} recipient={recipient}
                disabled={closed} onToggle={addressee.toggle} />
            )}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/rooms src/architecture.test.ts`。浏览器窗格 375×812 与 360×740(浅色 + 深色):两个角色时两枚开关 + 提示在一行;语音模式下这一行仍在;键盘弹起时输入条整体上移,行不重叠列表最后一条(列表底部留白随 `composerHeight` 变化,`ResizeObserver` 已处理)。
- [ ] **Step 5: 提交** — `feat(web): wire the agent target, @ autocomplete and tutor voice state into the room page (Addendum AW-1)`。

---

## Final lane (Z)

### Task Z1: 文档、Playwright、体积报告

**Files:**
- Create: `web/e2e/agents-addressing.spec.ts`
- Modify: `web/src/features/rooms/CLAUDE.md`、`web/src/features/agents/CLAUDE.md`、`web/src/features/chat/CLAUDE.md`、`web/src/lib/CLAUDE.md`、`web/src/components/CLAUDE.md`、`web/e2e/CLAUDE.md`、`web/README.md`、`docs/superpowers/plans/e2e-results.md`

- [ ] **Step 1: Playwright 用例** — `web/e2e/agents-addressing.spec.ts`(类型检查经 `yarn web:typecheck`;运行可选):

```ts
import { expect, test, type BrowserContext } from "@playwright/test";
import { signIn } from "./support/auth";

/**
 * 智能体免 @(计划 2026-10-12-agents-addressing-web Z1):「对象」开关在 say 帧里加 to、本机按房间记住、@ 补全、360 px 不横向滚动。
 * 需要 E2E 栈打开 ROOMS_ENABLED + AGENTS_ENABLED + AGENTS_ROOMS_ENABLED 并配好 LLM 上游(否则房主不能选智能体);设 E2E_AGENTS=1 才运行。
 * 零成本:ROOMS_AI_GLOBAL_DAILY=0 时服务端回 ai_quota,消息照常发布,不等真实回答。不打印帧内容以外的任何东西(票据只在 WS 地址里,不读取)。
 * 未覆盖(未验证):真实回答、语音 to_agent、带练自动开关、iOS / Android 输入法。
 */
test.skip(!process.env.E2E_AGENTS, "needs AGENTS_ENABLED on the E2E stack (set E2E_AGENTS=1)");

test("rooms addressing: target chip sends `to`, remembered per room, @ autocomplete", async ({ browser, request }) => {
  const contexts: BrowserContext[] = [];
  try {
    const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 360, height: 740 } });
    contexts.push(context);
    const page = await context.newPage();
    const creds = await signIn(page, request);
    const sent: Record<string, unknown>[] = [];
    page.on("websocket", (ws) => ws.on("framesent", (f) => {
      if (typeof f.payload !== "string") return;
      try { sent.push(JSON.parse(f.payload) as Record<string, unknown>); } catch { /* not JSON */ }
    }));

    await page.goto("/rooms");
    await page.getByTestId("room-create").click();
    await page.getByTestId("room-create-submit").click();
    await expect(page).toHaveURL(/\/rooms\/r\//);
    const roomId = new URL(page.url()).pathname.split("/").at(-1)!;
    // 房主经 REST 选内置教练(房间设置里的选择面板由 rooms-agents 的用例覆盖)
    const patch = await request.patch(`/api/rooms/${roomId}`, { headers: { Authorization: `Bearer ${creds.token}` }, data: { agents: ["builtin:coach"] } });
    expect(patch.status()).toBe(200);

    const chip = page.getByTestId("room-target-chip").first();
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("room-target-status")).toContainText("消息会交给");

    const input = page.getByTestId("room-input");
    await input.fill("hello coach");
    await page.getByTestId("room-send").click();
    await expect.poll(() => sent.filter((f) => f.type === "say").at(-1)?.to).toBe("builtin:coach");
    await expect(page.getByTestId("room-messages").getByTestId("room-message").filter({ hasText: "hello coach" })).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("room-target-chip").first()).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("room-target-chip").first().click();
    await page.getByTestId("room-input").fill("just the room");
    await page.getByTestId("room-send").click();
    await expect.poll(() => sent.filter((f) => f.type === "say" && f.text === "just the room").length).toBe(1);
    expect(sent.find((f) => f.text === "just the room")).not.toHaveProperty("to");

    await page.getByTestId("room-input").fill("");
    await page.getByTestId("room-input").pressSequentially("@");
    await expect(page.getByTestId("room-mention-list")).toBeVisible();
    await expect(page.getByTestId("room-mention-option").first()).toContainText("AI(");
    await page.getByTestId("room-mention-option").nth(1).click();
    await expect(page.getByTestId("room-input")).toHaveValue(/^@\S.* $/);

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  } finally {
    for (const c of contexts) await c.close();
  }
});
```

- [ ] **Step 2: 文档**
  - `web/src/features/rooms/CLAUDE.md`:「What lives here」的 `agents/` 一行补上「「对象」(`target.ts` 纯逻辑、`use-agent-target.ts`、`target-row.tsx`)、`@` 补全(`mention-suggest.ts`,输入条里的 combobox)、带练语音状态(`tutor-voice.ts`)、懒加载文案 `agents/locales/`(新文案只放这里,不放 `i18n/`)」;「Slots」末尾加「`room-page.tsx` 的第五个例外:Addendum AW-1(addressing 接线)」;「Pitfalls」加:「对象」只在本机(`enjoy-web.rooms.target.v1.<userId>.<roomId>`),自动开关只由带练帧 / `tutor_stopped`、`tutor_done` 系统消息 / 房间关闭推出,不要加计时器;轮到自己答带练时不带 `to`(R-AW3);`say` 的 `to` 关闭时不写键(服务端 `extra="forbid"`);`@` 补全只在消息开头,组字中(`isComposing` / `keyCode 229`)不拦截按键;`note_zh` 在 `meta` 里,朗读只取正文。
  - `web/src/features/agents/CLAUDE.md`:「What lives here」加 `agent-note.tsx`(懒包装 `AgentNote`);「Public surface」加 `withNote`、`AgentNote`;「Pitfalls」加:`done.note_zh` 优先于 `trace.note_zh`,1:1 的说明随网页保存的 `agent_trace` 一起保存(R-AW11);导师条的 `hint_zh` 用 `~/components/zh-note-fold`(tutor 不能导入 `../agent-note`)。
  - `web/src/features/chat/CLAUDE.md`:「Speech out」加「`speakableText` 末尾经 `~/lib/speech-text` 去掉中文 / 假名 / 全角片段;结果为空不请求 TTS」;`message-bubble.tsx` 的 `note` 插槽。
  - `web/src/lib/CLAUDE.md`:加 `speech-text.ts — speechText(): strip CJK / kana / full-width runs before TTS; identity for CJK-free text (in the main bundle via chat/tts.ts, keep it tiny)`。
  - `web/src/components/CLAUDE.md`:加 `zh-note-fold.tsx — folded Chinese note; no copy of its own (callers pass translated labels from their lazy locales)`。
  - `web/e2e/CLAUDE.md`:Specs 列表加 `agents-addressing`(需要 `E2E_AGENTS=1` 与智能体开关;零成本)。
  - `web/README.md`:在智能体一节末尾加「免 @ 对话(计划 2026-10-12-agents-addressing)」小节:做了什么(「对象」、`@` 补全、带练语音状态、「中文」折叠、朗读兜底、设置 `zh_note`);**未验证**:真机 iOS Safari / Android Chrome 的输入法(搜狗、Gboard、iOS 中文键盘)下 `@` 补全与组字、iOS 上候选点按是否收起键盘、VoiceOver / TalkBack 对 combobox 与折叠的播报、iOS 音频(朗读兜底后的空句跳过是否影响自动朗读解锁)、真实上游下 `<<ZH>>` 剥离后的英文质量、360 px 真机布局。
- [ ] **Step 3: 体积** — `yarn web:build && cd web && node scripts/check-main-bundle.mjs --max-delta=0.2`。把两行输出(当前值与相对 P0 基线的增量)写进 `docs/superpowers/plans/e2e-results.md` 的新小节「addressing-web(2026-10-12)」与本任务的提交说明。若超出 0.2 kB:先确认增量来自 `lib/speech-text.ts`(唯一进主包的新代码),压缩它的正则(合并区间、去掉注释不影响打包)后重测;仍超出则停下报告,不放宽预算。
- [ ] **Step 4: Playwright(可选)** — 有 E2E 栈与智能体开关时:`E2E_AGENTS=1 yarn web:e2e --project=chromium-mobile agents-addressing`;结果写进 `e2e-results.md`;没跑就写「未运行」。
- [ ] **Step 5: 提交** — `docs: agent addressing notes, unverified device behaviour, e2e spec and bundle numbers`。

### Task Z2: 合并验收

- [ ] `yarn web:typecheck && yarn web:test && yarn web:build`(全绿)。
- [ ] `cd web && yarn vitest run src/architecture.test.ts`(冻结边 18 条,无新增)。
- [ ] `node web/scripts/check-main-bundle.mjs --max-delta=0.2`(通过,数字与 Z1 一致)。
- [ ] `security-review`:URL / 日志 / 错误 / 测试快照里没有正文、转写、`note_zh`、`hint_zh`、票据;`to` 只是角色 id。
- [ ] 视觉对照(浏览器窗格,375×812 与 360×740,浅色 + 深色):`room-target-row`、`room-mention-list`、联机 / 1:1 / 两种带练条的「中文」折叠、设置页「回复语言」。
- [ ] 在本计划勾选框只在合并且测试通过后打勾(`docs/CLAUDE.md`)。

---

## Addendum AW-1 · `room-page.tsx` 冻结规则的例外(C3)

`room-page.tsx` 在 rooms-v2 F5 之后冻结(只接线)。本计划需要的接线无法从现有插槽完成:「对象」的 `to` 必须进入页面里的 `room.say(…)` 两处调用与 `useRoomVoice` 的参数;实际收件人提示要读页面里的 `draft` 与 `quote` 状态;`@` 补全与占位符要把默认智能体名传给输入条;带练条需要 `state.messages` / `state.notice` / 语音开关;「没听清」的横幅去重要改 `message` 的计算。C3 只加这些接线(一个钩子调用、四个派生值、五处属性、一个条件),功能逻辑全在 `agents/target.ts`、`use-agent-target.ts`、`target-row.tsx`、`mention-suggest.ts`、`tutor-voice.ts`。代价:页面多一个 hook 与一行组件;之后的车道若再改页面,沿用同样的 Addendum 流程。

---

## 验证矩阵

| 需求(spec) | 自动化测试 | 手动 / 未验证 |
|---|---|---|
| 「对象」开关、两个智能体可选其一(§3.2 #2) | `target-row.test.tsx`、`use-agent-target.test.tsx`、`room-page-agents.test.tsx` | 360 px 真机 **未验证**(浏览器窗格看过则写明) |
| 每条文字带 `to`、每条语音带 `to_agent`;关闭时帧不变(§3.4) | `protocol.test.ts`、`room-state.test.ts`、`use-room-voice.test.tsx`、`voice-contract.test.ts`、`room-page-agents.test.tsx` | 真实服务端路由由服务端计划覆盖 |
| 按用户 + 房间记在本机,取不到 = 关闭(§3.2 #2) | `target.test.ts`(storage)、`use-agent-target.test.tsx` | Safari 无痕模式 **未验证** |
| 带练开始自动开、结束 / 停止 / 关闭自动关,无空闲关闭(D2) | `target.test.ts`(nextTarget)、`use-agent-target.test.tsx`(假时钟 24 h)、`room-page-agents.test.tsx` | 多设备同时在线的带练 **未验证** |
| 常驻提示「消息会交给 Emma」、回复提示「回复 Emma 中」(§3.3、§3.2 #1) | `target-row.test.tsx`、`target.test.ts`(recipientOf)、`room-page-agents.test.tsx` | — |
| 静音 / 公共 AI 关闭 / 角色停用时置灰并说明(§3.3) | `target.test.ts`(targetBlock)、`target-row.test.tsx` | — |
| 带练语音:直接说、识别中、没听清(§3.2 #3) | `tutor-voice.test.ts`、`tutor.test.tsx`、`room-page-agents.test.tsx` | 真实转写延迟 **未验证** |
| `@` 补全:别名「AI(名字)」、键盘、触屏、不打断输入法、失焦 / Esc 关闭(§3.2 #4) | `mention-suggest.test.ts`、`room-composer.test.tsx` | iOS / Android / 搜狗真机输入法 **未验证**;VoiceOver / TalkBack **未验证** |
| 占位符「@AI(默认名)」(§4) | `room-composer.test.tsx`、`room-page-agents.test.tsx` | — |
| 朗读兜底:任何路径不读中文(§5.3) | `speech-text.test.ts`(3000 例性质)、`tts.test.ts`、`use-auto-speak.test.tsx`、`text-tools.test.ts`、`conversation-page.agent.test.tsx`(TTS 请求体) | iOS 自动朗读解锁 **未验证** |
| `note_zh` / `hint_zh` 不进朗读、默认折叠、点开才显示(§5.1) | `zh-note-fold.test.tsx`、`agent-messages.test.tsx`、`conversation-page.agent.test.tsx`、`tutor.test.tsx`、`tutor-bar.test.tsx`、`tutor-bar-panel.test.tsx` | — |
| 1:1 `done.note_zh` 实时 + 刷新后(§5.2) | `sse.test.ts`、`trace.test.ts`、`turn-stream.test.ts`、`agents-contract.test.ts`、`conversation-page.agent.test.tsx`、`trace-save.test.ts`、`ui-message.agent.test.ts` | 真实上游 **未验证** |
| 设置 `zh_note`(§5.1) | `agent-settings-page.test.tsx`、`agents-contract.test.ts` | — |
| 契约(§3.4、§5.2) | `room-agents-contract.test.ts`、`agents-contract.test.ts`、`tutor-contract.test.ts`、`voice-contract.test.ts`、`protocol.test.ts` | — |
| 懒加载文案、主包 ≤ 0.2 kB(§9) | `rooms/agents/locales.test.ts`、`agents/locales.test.ts`、`check-main-bundle.mjs` | — |
| 架构不放宽(§9) | `architecture.test.ts` | — |
| E2E | `web/e2e/agents-addressing.spec.ts`(`E2E_AGENTS=1`) | 运行与否写进 `e2e-results.md` |

## 不做

- 空闲自动关闭「对象」;服务端保存「对象」状态;给 1:1 加 `@`(spec §8)。
- `@` 补全出现在消息中间(服务端只认开头)、补全成员名字、补全时显示角色简介或头像。
- 「对象」行在助手停靠面板模式(`target === "assist"`)下显示;在已结束房间里显示。
- 自动翻译 `note_zh`;语音转写的人工修改;在语音长条上重复显示收件人(R:提示行已常驻)。
- 改主包里已有的 `@ai` 文案(R-AW1);删除旧消息的「中文:」行切分(R-AW19)。
- 房间带练的英文提示字段(服务端今天没有;R-AW14)。
- 1:1 导师 `meta` 事件里的说明(R-AW16)。
- 新的跨 feature 边;新依赖(fast-check 等)。

## 规格问题(已裁定,未改 spec)

1. §3.4 要求 `to` 属于本房间的 `agents` 配置,而 §4 让没有配置时 `@ai` 去内置 `builtin:coach` → 没有配置时「对象」不出现(R-AW5)。
2. §3.2 #3(轮到你时不需要对象)与 D2(带练开始自动打开对象)叠加,§3.4 的「至多一个回合」没有列出带练的优先级 → 轮到我时网页不带目标(R-AW3)。
3. D2「带练开始 / 结束」在线上没有会话 id,且 `welcome` 会先清空带练再重发 → 用签名 + 系统消息 + REST 兜底推导(R-AW4)。
4. §5.2 说 `hint_zh` 随 `agent_tutor` 帧下发,但房间带练帧今天没有任何提示字段 → 只在服务端发了才显示(R-AW14)。
5. §5.3 说网页有「统一的 `speakable(text)`」,实际有两个:房间的 `speakable(m)`(选取正文,也给「译」用)与对话的 `speakableText`(TTS 入口)→ 兜底放在 `speakableText`,房间按钮另用 `spokenText`(R-AW8、R-AW9)。
6. §5.2 写 1:1 的说明「随 assistant 消息保存在 `agent_trace`」,但 1:1 的消息是网页保存的 → 网页把 `note_zh` 放进它保存的 trace(R-AW11)。
7. §3.2 #3 的「没听清」没有线上名字 → 假定 `voice_unclear`(Cross-plan S-3),并以自己的语音状态推导为主(R-AW12)。
8. §4 的示例「@AI(英语教练)」用的是角色简介;同一节又说「显示默认智能体的真实名字」→ 显示名字(Emma),不显示简介。

## Cross-plan assumptions

本计划消费下列服务端线上名字与行为(P1/P2/V1/T2 的契约测试逐条钉住;不一致时只改列出的调用处与测试,写 Addendum):

- **S-1 `say.to`**:`server/app/rooms/protocol.py` 的 `SayMsg` 有 `to: str | None`(≤ `MAX_ID` = 64);不属于本房间 `agents` 配置 → `notice agent_off`,消息照常发布。消费:`protocol.ts::encodeSay`、`protocol.test.ts`。
- **S-2 语音 `to_agent`**:`routers/rooms_voice.py` 用 `form.get("to_agent")` 读取可选表单字段,同样校验;转写成功后触发一次智能体回合。消费:`voice-api.ts::uploadVoice`、`voice-contract.test.ts`。
- **S-3 notice `voice_unclear`**:转写为空 / 失败且该语音是带练回答或带了 `to_agent` 时,服务端只给说话人发 `event("notice", code="voice_unclear")`(写在 `rooms/voice.py`、`agent_tutor.py`、`agent_lane.py`、`connection.py` 或 `routers/rooms_voice.py` 之一)。消费:`ROOM_NOTICE_VOICE_UNCLEAR`、`room-agents-contract.test.ts`。名字不同 → 只改该常量与懒加载文案的键 `web.rooms.notice.<code>`。
- **S-4 `meta.note_zh`**:公开的智能体回复(含带练点评 / 题目)的 `RoomMessage.meta.note_zh`,可选、≤ 80 字;`message_hidden` 清空 `meta`;重放与 `GET /messages` 同样带。消费:`agent-meta.ts::agentOf`。
- **S-5 带练 `hint_zh`**:`agent_tutor` 帧与 `POST …/agents/tutor/start` 响应的 `tutor.hint_zh`,可选键(缺省 = 没有)。消费:`RoomTutorInfo.hintZh`、`room-agents-contract.test.ts`(可选键不参与键集比较)。
- **S-6 1:1 `done.note_zh`**:`/api/agents/turn` 的 SSE `done` 事件可选键 `note_zh`(对话模式与导师模式相同,R-AW16);`delta` 里永远没有 `<<ZH>>` 及其后的内容;`done.trace` 可能也带 `note_zh`(网页以 `done.note_zh` 为准)。消费:`sse.ts`、`turn-stream.ts`、`agents-contract.test.ts`(扫描所有录制的 SSE,至少一份带 `done.note_zh`,建议键名 `turn_sse_note`)。
- **S-7 `agent_trace.note_zh`**:网页随助手消息保存的 `agent_trace` 可以带 `note_zh`(≤ 80 字),`check_stored` 放行;`GET /api/conversations/{id}/messages` 原样返回。消费:`conversation-page.tsx`(经 `withNote`)、`normalizeTrace`。
- **S-8 1:1 提示 `hint_zh`**:`POST /api/agents/tutor/{id}/hint` → `{hint, hint_zh?, session}`(`hint` 改为英文)。消费:`tutor-api.ts`、`use-tutor-session.ts`、`tutor-contract.test.ts`(可选键)。
- **S-9 设置 `zh_note`**:`GET/PATCH /api/agents/settings` 有 `zh_note ∈ {"auto","always","never"}`,默认 `"auto"`;PATCH 接受 `{ "zh_note": … }`。消费:`AgentSettings.zhNote`、设置页、`agents-contract.test.ts`(`settings.zh_note === "auto"`)。
- **S-10 夹具重录**:`agents_contract.json`(`settings.zh_note`、至少一份带 `done.note_zh` 的 SSE)、`rooms_agents_contract.json`(`message_agent_answer.message.meta.note_zh` 可选、`agent_tutor.tutor.hint_zh` 可选)、`agents_tutor_contract.json`(`hint.hint_zh` 可选)。键缺省时网页测试按「没有」处理,不失败(除 S-9、S-6 的「至少一份」)。
- **S-11 协议版本**:`PROTOCOL_VERSION` 仍为 2(只增不改);若服务端改了,`protocol.test.ts` 失败,网页同步 `ROOM_PROTOCOL_VERSION`。
- **S-12 路由**:回复规则按被引用消息的 `meta.agent.persona_id`;优先级 `@ai` > `@名字` > 回复 > `to` / `to_agent`;`@ai` 去默认智能体 = `agents` 配置的第一个;网页显示的收件人只是提示(R-AW7)。
- **S-13 带练结束信号**:结束时仍写系统消息 `tutor_stopped` / `tutor_done` 并广播 `agent_tutor{tutor:null}`;`welcome` 之后重发当前带练帧(现状)。消费:`target.ts::tutorEnded`、`nextTarget`。
- **S-14 `GET /api/rooms/{id}/agents`**:返回 `{available, agents, tutor}`(现状);网页按 `room.agentIds` 排序,不依赖返回顺序。消费:`room-page.tsx`、`use-agent-target.ts`(REST 兜底)。
- **S-15 旧通道删除**:新消息不再有无 `meta.agent` 的 `ai_answer`;旧消息照旧渲染(R-AW19)。
- **INDEX**:X7(组件签名以所有者为准)、X11(文案懒加载与前缀)、X12(主包预算按每份计划相对基线)、X13(冻结边,本计划不增加)。
