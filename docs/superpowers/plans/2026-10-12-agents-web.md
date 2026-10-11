# 智能体 · 网页外壳与对话集成(A4)Implementation Plan

> **执行前先读 `docs/superpowers/plans/2026-10-12-agents-INDEX.md`:合并顺序、迁移链与跨计划冲突的裁决以它为准(与本计划冲突时,INDEX 优先)。**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `web/src/features/agents/` 建立智能体的网页公开面:可在 iOS Safari 上工作的 SSE 回合客户端(`useAgentTurn` / `runAgentTurn`)、过程胶囊与过程卡(D1:默认折叠、生成中自动展开)、来源标签、角色 chip / 选择 / 编辑(D2 工具默认全开、D3 人设默认公开、试聊一句)、举报角色、智能体设置页 `/me/agents`;对话页**只在会话配置带 `agent_persona_id` 时**改走 `/api/agents/turn`(旧会话一字节不变),增量文本照旧进入现有逐句 TTS,压缩过程随助手消息写入 `messages.agent_trace` 并在刷新后从存储渲染;「带我学」入口与导师条的插槽;全部懒加载,主包净增量 ≤ 0.2 kB gzip。

**Architecture:** `features/agents` 是新 feature,对外只有 `index.ts`。组件在 `lazy-parts.tsx` 里包成 `React.lazy` + `Suspense`,`runAgentTurn` 用 `import("./turn-stream")` 按需加载解析器;agents 的文案放在 `locales/`(不进 `**/i18n/*.json` 的主包 glob),由懒加载块调用 `i18n.addResourceBundle` 并入。对话页在 `send()` 里按 `conversation.config.agentPersonaId` 二选一:旧路径 `streamChatCompletion`,新路径 `runAgentTurn`;两条路径共用同一个 `onDelta(full)` → `patch` + `autoSpeakProgress`,TTS 管线不改。为守住主包预算,对话详情页 `ConversationPage` 改为路由懒加载(与背单词 Z-h 同法)。新增跨 feature 边只有 `chat->agents`(冻结边 16 → 17);`rooms->agents` 由 A5 在真正使用时加(18)。

**Tech Stack:** React 18 + TypeScript + Tailwind 3(redesign v3 令牌)+ lucide-react + Radix(经 `~/components/bottom-sheet`、`@renderer/components/ui/switch`)+ i18next;vitest + Testing Library + jsdom;Playwright(chromium-mobile)。不新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-12-agents-design.md`(§1 D1–D3、§3.4、§4.3–§4.5、§5、§9.1、§9.3、§11、§12、§13);视觉稿 `docs/superpowers/design/agents-v1/mockup.html`(6 屏);令牌 `web/src/styles/theme.css`、`docs/superpowers/design/redesign-v3/design-notes.md`。跨计划冲突以 `plans/2026-10-12-agents-INDEX.md` 为准。

## Global Constraints

- **旧会话不变**:没有 `config.agentPersonaId` 的会话,请求、保存体、DOM 与现在完全相同(`conversation-page.test.tsx` 全部原样通过,唯一的改动是一个用例把 `/api/agents/*` 请求排除在计数之外,见 I3)。提示、复盘、实时通话在智能体会话里仍走旧提示词路径(R-W12)。
- **隐私**:令牌只在 `Authorization` 头;URL 里没有文本、词、令牌或 `client_turn_id`(`POST` 体);代码里不 `console.*` 用户文本、人设、词或令牌;`AgentTurnError.message` 只含错误码。测试断言 URL `search` 为空、请求不带查询串、`console` 未被调用。
- **D1/D2/D3**:过程卡生成中强制展开、结束折叠;角色编辑器工具开关默认全开;`prompt_public` 默认开;用户级工具开关默认全开(以服务端设置为准,前端只显示)。
- **一色一义**(agents 视觉稿):蓝 = 操作 / 进行中,青 = 词汇与查词工具,琥珀 = 读个人数据的工具 / 提示 / 仅你可见,绿 = 完成,红 = 失败(只用于过程里的失败行)。角色头像用中性 `Avatar`(R-W5)。触控 ≥ 44px(`hit-expand`、`min-h-tap`、`min-h-row`);深色与减少动态(`motion-reduce:animate-none`);界面不用 emoji;只用 `theme.css` 令牌。
- **i18n**:新文案键前缀 `web.agents.*`(R-W3),en 与 zh-CN 键集相同;放在 `features/agents/locales/{en,zh-CN}.json`(懒加载)。对话页唯一新增的主包文案是 `web.chat.settingsForm.personaNote`(`features/chat/i18n`)。英文标签在 360 px 不换行溢出(Z2 的 Playwright 断言 + `locales.test.ts` 的长度规则)。
- **体积**:主包(入口块 + 其 modulepreload 块)gzip 净增量 ≤ 0.2 kB,以 H0 记录的基线为准,`web/scripts/check-main-bundle.mjs` 超出即失败(R-W2,不放宽)。
- **每个任务结束**:`yarn web:typecheck && cd web && yarn vitest run src/features/agents src/architecture.test.ts <任务列出的其他测试>`;车道合并前 `yarn web:typecheck && yarn web:test && yarn web:build`。提交 conventional(`feat(web): …`、`test(web): …`、`chore(web): …`、`docs: …`),一个任务一个提交,信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。不跑长套件以外的东西;E2E 只在 Z2。
- **写计划时的实跑(P-A0)**:本计划的代码与测试**没有在写计划时运行过**(只核对了真实源码:`conversation-page.tsx`、`api/ai.ts`、`api/client.ts`、`architecture.test.ts`、`i18n/index.ts`、`wordbook/lazy-pages.tsx`、`me-page.tsx`、`e2e/support/upstream-guard.ts` 等)。执行者第一次运行时以真实结果为准修正选择器与文案断言,但不得改动本计划的裁定与接口名。

---

## 文件结构与共享文件插入点

```
web/src/features/agents/
  CLAUDE.md                     新(若 A2/A3 已建:追加 A4 段)
  index.ts                      公开面(若 A2/A3 已建:只追加,R-W1)
  lazy-parts.tsx                part() 懒加载包装 + 全部组件包装
  types.ts                      线上形状(camelCase)与 TurnEvent / LiveTrace / AgentView
  agents-api.ts                 REST:config / personas / settings / report / try
  use-agents-data.ts            useAgentsConfig / useAgentSettings / usePersonas(缓存)
  locales.ts  locales/en.json  locales/zh-CN.json  locales.test.ts
  sse.ts  trace.ts  step-labels.ts
  turn-stream.ts                streamAgentTurn(fetch + ReadableStream,懒加载块)
  use-agent-turn.ts             runAgentTurn(动态导入垫片)+ useAgentTurn
  process-capsule.tsx  process-card.tsx  step-sheet.tsx  source-chips.tsx
  persona-chip.tsx  persona-editor-sheet.tsx  persona-picker.tsx  report-persona-sheet.tsx
  agent-settings-page.tsx  me-row.tsx  chat-parts.tsx
  *.test.ts(x)、agents-contract.test.ts
web/src/features/chat/
  chat-api.ts  ui-message.ts  message-bubble.tsx  conversation-page.tsx  conversation-settings-sheet.tsx
  lazy-pages.tsx(新)  index.ts  i18n/{en,zh-CN}.json  conversation-page.agent.test.tsx(新)  conversation-page.test.tsx(一处)
  CLAUDE.md
web/src/app.tsx  web/src/pages/me-page.tsx  web/src/architecture.test.ts
web/scripts/main-bundle.mjs  main-bundle.d.mts  check-main-bundle.mjs  main-bundle-baseline.json  CLAUDE.md
web/src/build/main-bundle.test.ts  web/package.json
web/e2e/agents.spec.ts  web/e2e/support/upstream-guard.ts  web/src/test/e2e-upstream-guard.test.ts  web/e2e/CLAUDE.md
web/CLAUDE.md  web/src/CLAUDE.md  web/src/features/CLAUDE.md  web/README.md  docs/superpowers/plans/e2e-results.md
docker-compose.e2e.yml(一行,若 A1 未加)
```

| 共享文件(A2 / A3 / A5 也会改) | 本计划的插入点 |
|---|---|
| `web/src/features/agents/index.ts` | 若已存在(A2/A3 先合并):保留其全部导出;A4 的导出追加在文件末尾 `// ---- A4 agents-web ----` 注释之后。A2/A3 若导出的是**非懒加载**组件(`MemoryPage`、`TutorBar`、`TutorRecapCard`),N1 改为从 `lazy-parts.tsx` 导出同名懒包装(路径见 Cross-plan assumptions) |
| `web/src/features/agents/lazy-parts.tsx` | 本计划新建;每个任务在 `// ---- parts ----` 之后追加一行 `export const X = part(...)`;A5 若要新包装,追加在末尾 |
| `web/src/features/agents/CLAUDE.md` | 若已存在:在「What lives here」末尾追加 A4 文件,新增「Public surface」「Bundle」两节 |
| `web/src/architecture.test.ts` | `CROSS_FEATURE_BASELINE` 的 `"chat->realtime",` 之后追加 `"chat->agents",`,`toBe(16)` → `toBe(17)`;scanner 用例追加两行(I1)。A5 再追加 `"rooms->agents"`、`toBe(18)` |
| `web/src/app.tsx` | `import { VocabularyPage }` 之后一行导入;`<Route path="/me" …/>` 之后两条路由(若 A2 已加 `/me/agents/memory` 则只加 `/me/agents`) |
| `web/src/pages/me-page.tsx` | `<WordbookMeRow />` 之后一行 `<AgentsMeRow />` |
| `web/src/features/chat/i18n/{en,zh-CN}.json` | `web.chat.settingsForm` 对象末尾追加 `personaNote` |
| `web/e2e/support/upstream-guard.ts` + `src/test/e2e-upstream-guard.test.ts` | 在 `OWN_LINKS` 之后加 `OWN_AGENTS`;`isOwnBackendPath` 末尾 `|| OWN_AGENTS.test(pathname)`;测试两张表末尾各追加一段(A2 的记忆端点由 A2 追加) |
| `docker-compose.e2e.yml` | server `environment` 里 `LINKS_ENABLED` 行之后 `AGENTS_ENABLED: "true"`(已存在则不动) |
| `web/package.json` | `scripts` 末尾追加 `"bundle:check"` |
| `web/README.md` | 「学习联动」节之后新增「智能体(计划 2026-10-12)」节 |

## 并行车道、文件归属与合并顺序

| 车道 | 任务 | 独占文件 | 依赖 |
|---|---|---|---|
| **hooks / api H**(串行) | H0–H4 | `web/scripts/main-bundle*.{mjs,d.mts,json}`、`check-main-bundle.mjs`、`scripts/CLAUDE.md`、`src/build/main-bundle.test.ts`、`web/package.json`;agents 的 `types.ts`、`agents-api.ts(+test)`、`use-agents-data.ts`、`locales*`、`sse.ts(+test)`、`trace.ts(+test)`、`step-labels.ts`、`turn-stream.ts(+test)`、`use-agent-turn.ts(+test)`、`agents-contract.test.ts`;`index.ts` / `lazy-parts.tsx` 的骨架 | A1 已合并(H4 需要契约样例) |
| **web components W**(串行) | W1–W5 | `process-capsule.tsx`、`process-card.tsx`、`step-sheet.tsx`、`source-chips.tsx`、`process.test.tsx`、`persona-chip.tsx`、`persona-editor-sheet.tsx(+test)`、`persona-picker.tsx(+test)`、`report-persona-sheet.tsx(+test)`、`agent-settings-page.tsx(+test)`、`me-row.tsx(+test)` | H1、H2 |
| **chat integration I**(串行) | I1–I5 | `features/chat/{chat-api.ts,ui-message.ts,message-bubble.tsx,conversation-page.tsx,conversation-settings-sheet.tsx,lazy-pages.tsx,index.ts,i18n/*,conversation-page.agent.test.tsx,conversation-page.test.tsx,CLAUDE.md}`、`features/agents/chat-parts.tsx(+test)`、`src/architecture.test.ts` | H3、W1、W3(I3)、A3 的 `TutorStartSheet`/`TutorBar`(I4) |
| **nav / routes N** | N1–N2 | `src/app.tsx`、`src/pages/me-page.tsx`、`src/pages/me-page.test.tsx`(一个用例)、`e2e/support/upstream-guard.ts`、`src/test/e2e-upstream-guard.test.ts` | N1:W5;N2:无(须在 I3 之前合并) |
| **final Z** | Z1–Z3 | `features/agents/CLAUDE.md`、`web/CLAUDE.md`、`web/src/CLAUDE.md`、`web/src/features/CLAUDE.md`、`web/README.md`、`web/e2e/agents.spec.ts`、`web/e2e/CLAUDE.md`、`docker-compose.e2e.yml`(一行)、`docs/superpowers/plans/e2e-results.md` | 全部 |

`index.ts` 与 `lazy-parts.tsx` 在本计划内是**只追加**的共享文件:创建它们的是 H1,之后每个任务只追加自己那一行(见各任务的 Files)。

**合并顺序(本计划内)**:H0 → H1 → H2 → H3 → W1 → W2 → W3 → W4 → W5 → N2 → I1 → I2 → I3 → I4 → I5 → N1 → H4 → Z1 → Z2 → Z3。(H4 只依赖 A1 的样例,可提前到 H3 之后任何位置。)
**跨计划**:W → R → A1 → A2 → A3 → **A4** → A5(spec §12)。A5 rebase 到 A4 之后再加 `rooms->agents`。

**评审波**:W、I 车道合并前各一次 `/code-review high`;I 车道额外 `security-review`(URL / 日志 / 错误里没有文本与令牌、`client_turn_id` 规则、旧会话不变);视觉对照(视觉稿 1–3、5、6 vs 真实页面,浏览器窗格 375×812 与 360×740,浅色 + 深色)。

## 本计划的裁定

- **R-W1 公开面只追加。** spec §12 的合并顺序让 A2、A3 先于 A4 合并,而 `architecture.test.ts` 要求每个 feature 目录都有 `index.ts`,所以 `features/agents/index.ts` 很可能已由 A2/A3 建立。A4 不删任何已有导出,只在末尾追加;A4 的组件导出一律是懒包装。*若错*:若 A2/A3 没建,H1 直接创建(同一份内容),无代价。
- **R-W2 主包预算 = 入口块 + modulepreload 块的 gzip 净增量。** 基线在 H0(A3 合并后、A4 写任何代码前)由脚本记录;agents 全部懒加载(组件 `React.lazy`、`runAgentTurn` 动态导入、文案懒加载)。对话页本身在主包里,集成代码(约 1–2 kB 压缩前)必然超过 0.2 kB,所以 I5 把 `ConversationPage` 改为路由懒加载(与 `wordbook/lazy-pages.tsx` 的裁定 Z-h 同法)以抵消,并在 `main-bundle-baseline.json` 与 README 同时写出「净增量」和「仅 agents 部分」两个数。*为什么*:spec 写明超过即失败、不放宽;懒加载对话详情页对用户的代价只是首次打开会话多一个已被 SW 缓存的块。*若错*(评审认为不应懒加载对话页):回退 I5,预算按「仅 agents 部分」评估,需 INDEX 裁定。
- **R-W3 文案键 `web.agents.*`,放在 `locales/`。** spec §11.6 写「`i18n/{en,zh-CN}.json`,前缀 `agents.*`」;但 `i18n/index.ts` 的 `import.meta.glob("../**/i18n/*.json", { eager: true })` 会把整份文案打进主包(几 kB),与 R-A2 冲突;现有约定是 `web.<feature>.*`。所以文案放 `features/agents/locales/`,懒加载块导入 `./locales` 时 `addResourceBundle`;`locales.test.ts` 自带 en/zh-CN 键集一致检查。A2/A3 的文案若在 `memory/i18n`、`tutor/i18n`(eager)不受影响,但建议他们同样改到各自 `locales/`(写入 Cross-plan assumptions)。*若错*:文案搬回 `i18n/`,主包 +约 3 kB gzip。
- **R-W4 冻结边只加 `chat->agents`(16 → 17)。** `architecture.test.ts` 的「the cross-feature baseline lists only edges that still exist」会让一条尚无人使用的 `rooms->agents` 立刻失败,所以由 A5 在第一处房间代码导入 `~/features/agents` 的同一提交里加(17 → 18)。agents 不导入任何别的 feature(包括 chat),因此没有桶循环。理由写在基线注释里:对话需要过程胶囊、角色切换、回合客户端,这些是 agents 的产品身份,不是可以挂在扩展点上的可选联动(扩展点受 `LINKS_ENABLED` 控制,而 spec §3.3 R-A1 规定 agents 不受它控制)。
- **R-W5 角色头像中性;失败红、跳过中性。** 视觉稿第 5 屏用蓝 / 琥珀 / 绿给头像上色,与「一色一义」及 `Avatar` 的约定(伙伴 = 中性)冲突,取中性首字头像。服务端把超时的来源记为 `skip`(spec §4.6),视觉稿第 3 屏把超时画成红色失败;裁定:`fail` = 红色失败行 + 「重试」,`skip` = 中性行「太慢,这次没用上」,不用红色(跳过是设计内的预算行为)。
- **R-W6 D2 / D3 优先于视觉稿。** 第 6 屏写「工具默认只开查词」,与 D2 冲突:编辑器新建时 5 个工具全开。第 5 屏提示「看不到人设原文」,与 D3 冲突:提示改为「成员会看到角色名、简介和公开的人设原文(可在角色里关闭)」,编辑器有 `prompt_public` 开关(默认开)。
- **R-W7 角色音色不试听。** 现有 `VoicePicker`(含试听)在 `features/chat` 内部,且依赖 `useTtsPlayer` 与 `AuthContext`;agents 导入 chat 会新增 `agents->chat` 边并与 `chat->agents` 成环,移到 `components/` 又违反底层不得导入 `auth/` 的规则。编辑器的音色是一个原生 `<select>`(`voicesFor(ai, ai.defaultTts.model)`,值为音色 id,空 = 服务端默认),不试听。*代价*:用户选音色前听不到;选中角色后对话页的朗读即用该音色。试听列入「不做」。
- **R-W8 「试聊一句」用 `POST /api/agents/personas/try`。** spec §4.5 没有可用于未保存角色的端点(`/turn` 需要已保存的 `persona_id` 与 `conversation_id`)。在前端拼提示词直调 `/api/ai/chat/completions` 会绕开安全前言(违反 §9.1),所以消费 A1 的 `try` 端点(形状见 Cross-plan assumptions);若返回 404,按钮下显示「试聊暂不可用」并不再请求。
- **R-W9 功能开关来自 `GET /api/agents/config`。** spec §4.5 没有列开关端点;与 rank / rooms / wordbook / links 一致,网页读 `/api/agents/config`;404 视为关闭(旧服务端)。对话页只在会话加载后由懒加载的角色控件请求一次(按 `ApiClient` 缓存)。
- **R-W10 回合 id 与重试规则。** `client_turn_id` 由客户端生成(`crypto.randomUUID`,旧 iOS 回落到 `getRandomValues` 拼 v4)。**从不自动重试、从不自动重连**(费用可预测)。用户点「重试」时:上一次以**传输失败**结束(网络错误、读流中断、60 s 无数据超时、流结束但没有 `done`/`error`)或 `busy`(409 / `error{code:"busy"}`)→ 沿用同一个 id(服务端返回同一结果或 409,spec §4.4);上一次以服务端 `error` 事件或其他 HTTP 拒绝结束 → 新 id。错误对象上的 `retryId` 携带这一决定,对话页把它记在错误气泡上。
- **R-W11 自己的 SSE 解析器,不用 EventSource。** `EventSource` 只能 GET 且鉴权只能放 URL(违反隐私规则)。解析器保留 `event:` 名(`api/ai.ts` 的 `createSseParser` 丢弃了它)、合并多行 `data:`、忽略 `:` 注释心跳、接受 CRLF 与任意分块位置;读流只用 `response.body.getReader()` + `Promise.race(abort)`,**不用** `for await (… of response.body)`(iOS Safari 不支持流的异步迭代)、不用 `TextDecoderStream`;`response.body` 为 null 时整体读文本再解析。
- **R-W12 对话只在一个点分岔。** `send()` 里 `conversation.config.agentPersonaId` 有值 → `runAgentTurn`,否则原样 `streamChatCompletion`。两者共用 `onDelta(full)`(`patch` + `autoSpeakProgress`),所以 `sentence-stream` / `useAutoSpeak` / `useTtsPlayer` 收到的增量完全一样。智能体路径忽略本地的系统提示词、场景、难度、教练模式(服务端按角色拼提示,spec §3.1);语法检查与发音评测照旧并行。实时通话、提示、复盘在智能体会话里仍用旧提示词路径(写进「不做」)。
- **R-W13 只有助手一条的回合走简单保存。** 「重新生成」(失败行的「重试」与工具详情里的按钮)= 先 `DELETE /api/messages/{id}` 删掉服务端那条助手消息,再用同一句重跑,只保存新的助手消息;导师开场 / 继续(`text=null`)同样只有助手一条。这两种回合在已排队的保存之后直接 `createMessages([assistant])`,失败只提示「未保存」,不进入带核对的重试队列;失败的回合不留错误气泡(否则 `dropFailedTail` 会连带丢掉前一条已保存的消息),改为移除气泡并 toast。*代价*:极少数网络抖动下可能缺一条或多一条助手消息(刷新可见),换来对话页改动最小。
- **R-W14 `show_process=false`。** 生成中只显示一行「正在回复…」,结束后不显示胶囊与来源标签;过程仍随消息保存,重新打开开关后历史消息的胶囊恢复。
- **R-W15 角色 chip 在顶栏返回键右侧**(视觉稿头像位置):中性头像 + 名字(截断,最宽 132 px)+ 下拉箭头;无角色时显示星光图标 +「角色」。控件把解析出的角色回传给对话页,助手气泡头像取角色名首字。对话标题与副标题不变。
- **R-W16 设置与角色列表缓存按用户 id。** 同一个 `ApiClient` 可能先后服务两个账号,所以 `useAgentSettings` / `usePersonas` 的缓存键是 `user.id`;开关配置(全局)按 `ApiClient` 缓存。
- **R-W17 选角色时带上角色音色。** 角色有 `voice` 时,对话页写入 `{ agentPersonaId, ttsModel: ai.defaultTts.model, ttsVoice: voice }`;没有则只写 id。取消角色只删除 `agentPersonaId` 键。
- **R-W18 「带我学」插槽。** 入口放在输入条的「不会说?」提示行右侧(32 px 视觉 / 44 px 命中的蓝色药丸),只在会话有角色且 `config.tutorEnabled` 时出现;点开 A3 的 `TutorStartSheet`;开始后对话页进入导师模式(请求 `mode:"tutor"`、带 `tutor_session_id`),智能体先开口(`text=null`);`meta` 事件交给 A3 的 `TutorBar`;`TutorBar.onContinue` 再跑一个 `text=null` 回合(服务端语义由 A3 定义)。
- **R-W19 默认角色不自动套用到会话。** `default_persona_id` 只决定选择面板里的预选项与 A5 的房间默认值;新建会话仍是普通会话,直到用户在顶栏选角色(保持「旧路径不变」最强的形式)。

---

## Hooks / API lane (H)

### Task H0: 主包体积脚本与基线

**Files:**
- Create: `web/scripts/main-bundle.mjs`、`web/scripts/main-bundle.d.mts`、`web/scripts/check-main-bundle.mjs`、`web/scripts/main-bundle-baseline.json`(由脚本生成)、`web/src/build/main-bundle.test.ts`
- Modify: `web/package.json`(`scripts` 末尾)、`web/scripts/CLAUDE.md`

**Interfaces:**
- Produces:`mainChunkFiles(html: string): string[]`、`gzipKb(buf: Uint8Array): number`、`checkDelta(baseKb, nowKb, maxDeltaKb) → { delta, ok }`;CLI `node scripts/check-main-bundle.mjs [--record] [--max-delta=0.2]`;`yarn workspace web bundle:check`

- [ ] **Step 1: 写失败测试** — `web/src/build/main-bundle.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkDelta, gzipKb, mainChunkFiles } from "../../scripts/main-bundle.mjs";

describe("main bundle size check (spec 2026-10-12-agents R-A2)", () => {
  it("counts the entry script and its modulepreload chunks, never lazy chunks or CSS", () => {
    const html = [
      '<script type="module" crossorigin src="/assets/index-AbC12.js"></script>',
      '<link rel="modulepreload" crossorigin href="/assets/vendor-x9.js">',
      '<link rel="stylesheet" crossorigin href="/assets/index-Q1.css">',
    ].join("\n");
    expect(mainChunkFiles(html)).toEqual(["assets/index-AbC12.js", "assets/vendor-x9.js"]);
  });

  it("fails loudly when the page has no module entry", () => {
    expect(() => mainChunkFiles("<html></html>")).toThrow(/entry/);
  });

  it("measures gzip in kB and compares against the baseline with the 0.2 kB budget", () => {
    expect(gzipKb(new TextEncoder().encode("a".repeat(10_000)))).toBeLessThan(1);
    expect(checkDelta(514.33, 514.5, 0.2)).toEqual({ delta: 0.17, ok: true });
    expect(checkDelta(514.33, 514.6, 0.2)).toEqual({ delta: 0.27, ok: false });
    expect(checkDelta(514.33, 510, 0.2).ok).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/build/main-bundle.test.ts`(模块不存在)。

- [ ] **Step 3: 实现**

`web/scripts/main-bundle.mjs`:

```js
// 主包体积(spec 2026-10-12-agents R-A2):入口 <script type="module"> 与它的 modulepreload 块,gzip 后的 kB。
// 懒加载块与 CSS 不计入(CSS 另行打印,仅供参考)。
import { gzipSync } from "node:zlib";

export function mainChunkFiles(html) {
  const entry = html.match(/<script[^>]*type="module"[^>]*src="\/?([^"]+\.js)"/);
  if (!entry) throw new Error("no module entry script in dist/index.html");
  const preloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="\/?([^"]+\.js)"/g)].map((m) => m[1]);
  return [entry[1], ...preloads.filter((f) => f !== entry[1])];
}

export function gzipKb(buf) {
  return gzipSync(buf, { level: 9 }).length / 1000;
}

export function checkDelta(baseKb, nowKb, maxDeltaKb) {
  const delta = Math.round((nowKb - baseKb) * 100) / 100;
  return { delta, ok: delta <= maxDeltaKb };
}
```

`web/scripts/main-bundle.d.mts`:

```ts
export function mainChunkFiles(html: string): string[];
export function gzipKb(buf: Uint8Array): number;
export function checkDelta(baseKb: number, nowKb: number, maxDeltaKb: number): { delta: number; ok: boolean };
```

`web/scripts/check-main-bundle.mjs`:

```js
// 用法(先 yarn web:build):node scripts/check-main-bundle.mjs [--record] [--max-delta=0.2]
// --record 把当前值写成基线(只在计划指定的提交上做,并提交 main-bundle-baseline.json)。
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDelta, gzipKb, mainChunkFiles } from "./main-bundle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../dist");
const baselinePath = path.join(here, "main-bundle-baseline.json");
const html = readFileSync(path.join(dist, "index.html"), "utf8");
const files = mainChunkFiles(html);
const kb = Math.round(files.reduce((sum, f) => sum + gzipKb(readFileSync(path.join(dist, f))), 0) * 100) / 100;
const css = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="\/?([^"]+\.css)"/g)].map((m) => m[1]);
const cssKb = Math.round(css.reduce((sum, f) => sum + gzipKb(readFileSync(path.join(dist, f))), 0) * 100) / 100;
console.log(`main bundle: ${kb} kB gzip (${files.join(", ")}); css ${cssKb} kB gzip (not budgeted)`);
if (process.argv.includes("--record")) {
  writeFileSync(baselinePath, `${JSON.stringify({ gzipKb: kb, cssGzipKb: cssKb, recordedAt: new Date().toISOString().slice(0, 10) }, null, 2)}\n`);
  console.log(`baseline recorded: ${baselinePath}`);
  process.exit(0);
}
const maxArg = process.argv.find((a) => a.startsWith("--max-delta="));
const max = maxArg ? Number(maxArg.split("=")[1]) : 0.2;
const base = JSON.parse(readFileSync(baselinePath, "utf8"));
const { delta, ok } = checkDelta(base.gzipKb, kb, max);
console.log(`delta vs baseline ${base.gzipKb} kB: ${delta >= 0 ? "+" : ""}${delta} kB (budget ${max} kB)`);
if (!ok) process.exit(1);
```

`web/package.json` 的 `scripts` 末尾追加:`"bundle:check": "node scripts/check-main-bundle.mjs"`。

`web/scripts/CLAUDE.md` 的「What lives here」追加一行:`- main-bundle.mjs (+ .d.mts) / check-main-bundle.mjs — main-chunk gzip size (entry + modulepreload) vs main-bundle-baseline.json; budget per plan (agents: +0.2 kB). Run after yarn web:build.`

- [ ] **Step 4: 记录基线** — 在 A3 已合并、A4 尚无代码的提交上:`yarn web:build && cd web && node scripts/check-main-bundle.mjs --record`;把输出的两行原样贴进提交说明。
- [ ] **Step 5: 跑测试** — `cd web && yarn vitest run src/build/main-bundle.test.ts`。
- [ ] **Step 6: 提交** — `chore(web): main bundle size check and agents baseline`。

### Task H1: 类型、REST、数据钩子、懒加载文案与公开面骨架

**Files:**
- Create: `web/src/features/agents/{types.ts,agents-api.ts,agents-api.test.ts,use-agents-data.ts,locales.ts,locales/en.json,locales/zh-CN.json,locales.test.ts,lazy-parts.tsx}`
- Create or append: `web/src/features/agents/index.ts`(R-W1)

**Interfaces:**
- Produces:类型 `ToolKey`、`TOOL_KEYS`、`TOOL_FIELD`、`ToolField`、`PERSONA_LEVELS`、`PersonaLevel`、`PERSONA_STYLES`、`PersonaStyle`、`TUTOR_KINDS`、`TutorKind`、`Persona`、`PersonaDraft`、`isBuiltin`、`AgentSettings`、`AgentSettingsPatch`、`AgentsConfig`、`AGENTS_DISABLED`、`StepGroup`、`StepStatus`、`AgentStep`、`AgentThought`、`TurnMeta`、`AgentTrace`、`TurnErrorCode`、`TurnEvent`、`LiveTrace`、`AgentTurnRequest`、`AgentTurnResult`、`AgentView`;`agentsApi`、`ReportReason`、`personaErrorKey`;`useAgentsConfig()`、`useAgentSettings(enabled)`、`usePersonas(enabled)`、`resetAgentsCaches()`;`ensureAgentsI18n()`;`part()`

- [ ] **Step 1: 写失败测试**

`web/src/features/agents/agents-api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { agentsApi, personaErrorKey } from "./agents-api";
import { TOOL_KEYS, type PersonaDraft } from "./types";

const DRAFT: PersonaDraft = {
  name: "Quiz", intro: "Friday quiz", prompt: "Ask me five questions.", level: "B1", style: "strict",
  voice: null, tools: [...TOOL_KEYS], promptPublic: true, deepThink: false,
};

describe("agentsApi (spec §4.5)", () => {
  it("sends persona drafts and settings patches as snake_case, ids encoded in the path, nothing in the query", async () => {
    const mock = createFetchMock({
      "POST /api/agents/personas": () => json({ id: "p1", owner_id: "u1", ...DRAFT, prompt_public: true, deep_think: false, disabled_at: null, created_at: null, updated_at: null }),
      "PATCH /api/agents/personas/p%2F1": () => json({ id: "p/1" }),
      "PATCH /api/agents/settings": () => json({ show_process: false }),
      "POST /api/agents/personas/try": () => json({ text: "Hi, I am Quiz." }),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const created = await agentsApi.createPersona(api, DRAFT);
    expect(created.promptPublic).toBe(true);
    await agentsApi.updatePersona(api, "p/1", { promptPublic: false });
    await agentsApi.patchSettings(api, { showProcess: false, tools: { learnedWords: false } });
    expect((await agentsApi.tryPersona(api, DRAFT, "Hello")).text).toBe("Hi, I am Quiz.");
    const bodies = mock.calls.map((c) => JSON.parse(String(c.body)) as Record<string, unknown>);
    expect(bodies[0]).toMatchObject({ prompt_public: true, deep_think: false, tools: ["lookup", "learned_words", "weak_words", "due_words", "memory"] });
    expect(bodies[1]).toEqual({ prompt_public: false });
    expect(bodies[2]).toEqual({ show_process: false, tools: { learned_words: false } });
    expect(bodies[3]).toMatchObject({ text: "Hello", persona: { name: "Quiz", prompt_public: true } });
    expect(mock.calls.every((c) => c.url.search === "")).toBe(true);
  });

  it("maps persona write errors by status, never by server wording", () => {
    expect(personaErrorKey(new ApiError(409, "anything"))).toBe("web.agents.editor.errors.limit");
    expect(personaErrorKey(new ApiError(429, "anything"))).toBe("web.agents.editor.errors.limit");
    expect(personaErrorKey(new ApiError(422, "anything"))).toBe("web.agents.editor.errors.invalid");
    expect(personaErrorKey(new ApiError(403, "anything"))).toBe("web.agents.errors.disabled");
    expect(personaErrorKey(new ApiError(0, "Network error"))).toBe("web.agents.editor.errors.failed");
    expect(personaErrorKey(new Error("x"))).toBe("web.agents.editor.errors.failed");
  });
});
```

`web/src/features/agents/locales.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { ensureAgentsI18n } from "./locales";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

type Dict = Record<string, unknown>;
const keysOf = (d: unknown, prefix = ""): string[] =>
  d && typeof d === "object" ? Object.entries(d as Dict).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k)) : [prefix];
const at = (d: unknown, path: string): unknown => path.split(".").reduce<unknown>((acc, k) => (acc as Dict | undefined)?.[k], d);

describe("agents locales (R-W3: lazy, outside the eager i18n glob)", () => {
  it("has the same keys in en and zh-CN, all under web.agents", () => {
    expect(keysOf(en).sort()).toEqual(keysOf(zh).sort());
    expect(keysOf(en).every((k) => k.startsWith("web.agents."))).toBe(true);
  });

  it("merges into i18next once loaded", () => {
    ensureAgentsI18n();
    expect(i18n.getFixedT("zh-CN")("web.agents.process.summary", { seconds: 4 })).toBe("思考 4 秒");
    expect(i18n.getFixedT("en")("web.agents.process.toolsUsed", { count: 2 })).toBe("used 2 tools");
  });

  it("keeps the one-line English labels short enough for a 360 px row (Z2 checks the real layout)", () => {
    const short = ["web.agents.chip.choose", "web.agents.picker.all", "web.agents.picker.builtin", "web.agents.picker.mine",
      "web.agents.tutor.entry", "web.agents.process.status.run", "web.agents.process.status.done", "web.agents.process.status.fail",
      "web.agents.process.status.skip", "web.agents.process.retry", "web.agents.editor.tryButton", "web.agents.editor.save"];
    for (const key of short) expect(String(at(en, key)).length, key).toBeLessThanOrEqual(12);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/agents`。

- [ ] **Step 3: 实现**

`web/src/features/agents/types.ts`:

```ts
/**
 * agents 的线上形状(spec 2026-10-12-agents §4.2–§4.4)。ApiClient 把响应键深度转成 camelCase、请求体键转回 snake_case,
 * 所以这里一律 camelCase;值(如工具键 "learned_words")不受影响。字段名以 A1 录制的 agents_contract.json 为准(H4 逐键核对)。
 */
export const TOOL_KEYS = ["lookup", "learned_words", "weak_words", "due_words", "memory"] as const;
export type ToolKey = (typeof TOOL_KEYS)[number];
/** 用户设置里 tools 是对象,它的键会被 camelCase:两种写法用这张表对应。 */
export const TOOL_FIELD = {
  lookup: "lookup", learned_words: "learnedWords", weak_words: "weakWords", due_words: "dueWords", memory: "memory",
} as const satisfies Record<ToolKey, string>;
export type ToolField = (typeof TOOL_FIELD)[ToolKey];

export const PERSONA_LEVELS = ["A2", "B1", "B2", "C1"] as const;
export type PersonaLevel = (typeof PERSONA_LEVELS)[number];
export const PERSONA_STYLES = ["friendly", "strict", "humor", "concise"] as const;
export type PersonaStyle = (typeof PERSONA_STYLES)[number];
export const TUTOR_KINDS = ["ask", "words", "repeat", "retell", "roleplay", "dictate"] as const;
export type TutorKind = (typeof TUTOR_KINDS)[number];

export interface Persona {
  id: string;
  /** 内置角色为 null */
  ownerId: string | null;
  name: string;
  intro: string;
  /** 人设原文:内置、本人、或 promptPublic 时才有;否则 null(D3) */
  prompt: string | null;
  level: PersonaLevel;
  style: PersonaStyle;
  voice: string | null;
  tools: ToolKey[];
  promptPublic: boolean;
  deepThink: boolean;
  /** 管理员停用(spec §9.1):使用处显示「已停用」 */
  disabledAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
export type PersonaDraft = Pick<Persona, "name" | "intro" | "level" | "style" | "voice" | "tools" | "promptPublic" | "deepThink"> & { prompt: string };
export const isBuiltin = (p: Pick<Persona, "id">): boolean => p.id.startsWith("builtin:");

export interface AgentSettings {
  tools: Record<ToolField, boolean>;
  memoryEnabled: boolean;
  shareInRooms: boolean;
  showProcess: boolean;
  defaultPersonaId: string | null;
  tutor: { length: number; mix: TutorKind[] };
}
export type AgentSettingsPatch = Partial<Omit<AgentSettings, "tools" | "tutor">> & {
  tools?: Partial<Record<ToolField, boolean>>;
  tutor?: Partial<AgentSettings["tutor"]>;
};

export interface AgentsConfig {
  enabled: boolean;
  tutorEnabled: boolean;
  memoryEnabled: boolean;
  roomsEnabled: boolean;
  promptMaxChars: number;
  personasMax: number;
}
export const AGENTS_DISABLED: AgentsConfig = Object.freeze({
  enabled: false, tutorEnabled: false, memoryEnabled: false, roomsEnabled: false, promptMaxChars: 800, personasMax: 10,
});

export type StepGroup = "context" | "tool";
export type StepStatus = "run" | "done" | "fail" | "skip";
export interface AgentStep {
  id: string;
  group: StepGroup;
  /** persona | memory | history | learned_words | weak_words | due_words | word_lookup(spec §4.6) */
  key: string;
  status: StepStatus;
  labelKey: string;
  /** 只允许词本身与计数(spec §4.4) */
  params?: Record<string, string | number>;
  ms?: number;
  private: boolean;
}
export interface AgentThought {
  source: "summary" | "reasoning";
  text: string;
}
export interface TurnMeta {
  stepIndex: number;
  stepsTotal: number;
  verdict?: "good" | "ok" | "weak" | "skip";
  kind?: TutorKind;
  done?: boolean;
}
/** done.trace:服务端压缩过程(≤ 4 KB),随助手消息写入 messages.agent_trace。 */
export interface AgentTrace {
  v: number;
  ms: number;
  steps: AgentStep[];
  thought: AgentThought | null;
}
export type TurnErrorCode = "disabled" | "limit" | "llm_unavailable" | "bad_request" | "busy";
export type TurnEvent =
  | { type: "start"; turnId: string }
  | { type: "step"; step: AgentStep }
  | { type: "thought"; thought: AgentThought }
  | { type: "delta"; text: string }
  | { type: "meta"; meta: TurnMeta }
  | { type: "done"; usage: { in: number; out: number } | null; trace: AgentTrace | null; textLen: number }
  | { type: "error"; code: TurnErrorCode };

/** 生成中的过程(界面状态);startedAt 是客户端毫秒时间。 */
export interface LiveTrace {
  turnId: string | null;
  startedAt: number;
  steps: AgentStep[];
  thought: AgentThought | null;
  meta: TurnMeta | null;
  phase: "prep" | "streaming" | "done" | "error";
}
export interface AgentTurnRequest {
  personaId: string;
  conversationId: string;
  /** null 仅用于导师模式的开场 / 继续 */
  text: string | null;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  mode: "chat" | "tutor";
  tutorSessionId: string | null;
  /** 不传则生成新的;重试时按 R-W10 传入上一次错误的 retryId */
  clientTurnId?: string;
}
export interface AgentTurnResult {
  text: string;
  trace: AgentTrace | null;
  turnId: string | null;
  meta: TurnMeta | null;
  clientTurnId: string;
}
/** 对话气泡上的智能体状态:生成中 live、完成后 trace、失败后可沿用的 retryId。 */
export interface AgentView {
  live?: LiveTrace | null;
  trace?: AgentTrace | null;
  retryId?: string;
}
```

`web/src/features/agents/agents-api.ts`:

```ts
import { ApiError, type ApiClient } from "~/api/client";
import type { AgentSettings, AgentSettingsPatch, AgentsConfig, Persona, PersonaDraft } from "./types";

export type ReportReason = "unsafe" | "offensive" | "spam" | "other";

const personaPath = (id: string) => `/api/agents/personas/${encodeURIComponent(id)}`;

/** spec §4.5 的 REST(登录用户)。`config` 与 `try` 两个端点由 A1 提供(R-W8、R-W9,见 Cross-plan assumptions)。 */
export const agentsApi = {
  config: (api: ApiClient, signal?: AbortSignal) => api.request<AgentsConfig>("GET", "/api/agents/config", { signal }),
  personas: (api: ApiClient) => api.request<{ personas: Persona[] }>("GET", "/api/agents/personas"),
  persona: (api: ApiClient, id: string) => api.request<Persona>("GET", personaPath(id)),
  createPersona: (api: ApiClient, draft: PersonaDraft) => api.request<Persona>("POST", "/api/agents/personas", { json: draft }),
  updatePersona: (api: ApiClient, id: string, patch: Partial<PersonaDraft>) => api.request<Persona>("PATCH", personaPath(id), { json: patch }),
  deletePersona: (api: ApiClient, id: string) => api.request<{ id: string }>("DELETE", personaPath(id)),
  reportPersona: (api: ApiClient, id: string, report: { reason: ReportReason; note?: string }) =>
    api.request<{ ok: boolean }>("POST", `${personaPath(id)}/report`, { json: report }),
  tryPersona: (api: ApiClient, draft: PersonaDraft, text: string) =>
    api.request<{ text: string }>("POST", "/api/agents/personas/try", { json: { persona: draft, text }, timeoutMs: 30_000 }),
  settings: (api: ApiClient) => api.request<AgentSettings>("GET", "/api/agents/settings"),
  patchSettings: (api: ApiClient, patch: AgentSettingsPatch) => api.request<AgentSettings>("PATCH", "/api/agents/settings", { json: patch }),
};

/** 角色写操作的错误 → 文案键。按状态码判断:服务端的英文文案不是契约。 */
export function personaErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409 || err.status === 429) return "web.agents.editor.errors.limit";
    if (err.status === 400 || err.status === 422) return "web.agents.editor.errors.invalid";
    if (err.status === 403 || err.status === 404) return "web.agents.errors.disabled";
  }
  return "web.agents.editor.errors.failed";
}
```

`web/src/features/agents/use-agents-data.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { ApiError, type ApiClient } from "~/api/client";
import { useAuth } from "~/auth/auth-context";
import { agentsApi } from "./agents-api";
import { AGENTS_DISABLED, type AgentSettings, type AgentsConfig, type Persona } from "./types";

export type LoadState = "loading" | "ready" | "error";

// 开关是全局的:按 ApiClient 缓存;设置与角色列表属于账号:按用户 id 缓存(R-W16)
const configCache = new WeakMap<ApiClient, Promise<AgentsConfig>>();
const settingsCache = new Map<string, Promise<AgentSettings>>();
const personasCache = new Map<string, Promise<Persona[]>>();

/** 测试与账号切换用。WeakMap 无法清空:测试每次新建 ApiClient。 */
export function resetAgentsCaches(): void {
  settingsCache.clear();
  personasCache.clear();
}

function loadConfig(api: ApiClient): Promise<AgentsConfig> {
  let pending = configCache.get(api);
  if (!pending) {
    pending = agentsApi.config(api).catch((err: unknown) => {
      // 旧服务端没有这个接口 / 功能关闭:视为关闭(并记住);其他失败不记住,下次挂载再试
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return AGENTS_DISABLED;
      configCache.delete(api);
      throw err;
    });
    configCache.set(api, pending);
  }
  return pending;
}

function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let pending = cache.get(key);
  if (!pending) {
    pending = load().catch((err: unknown) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, pending);
  }
  return pending;
}

/** `GET /api/agents/config`(R-W9)。拿到之前 config 为 null。 */
export function useAgentsConfig() {
  const { api } = useAuth();
  const [config, setConfig] = useState<AgentsConfig | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setState("loading");
    loadConfig(api).then(
      (c) => { if (alive) { setConfig(c); setState("ready"); } },
      () => { if (alive) setState("error"); },
    );
    return () => { alive = false; };
  }, [api, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { config, state, retry } as const;
}

/** 用户级智能体设置;enabled=false 时不请求。setSettings 同时更新缓存(其他页面再挂载即读到新值)。 */
export function useAgentSettings(enabled = true) {
  const { api, user } = useAuth();
  const key = user?.id ?? "";
  const [settings, setLocal] = useState<AgentSettings | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !key) return;
    let alive = true;
    setState("loading");
    cached(settingsCache, key, () => agentsApi.settings(api)).then(
      (s) => { if (alive) { setLocal(s); setState("ready"); } },
      () => { if (alive) setState("error"); },
    );
    return () => { alive = false; };
  }, [api, key, enabled, attempt]);
  const setSettings = useCallback((next: AgentSettings) => {
    if (key) settingsCache.set(key, Promise.resolve(next));
    setLocal(next);
  }, [key]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { settings, state, setSettings, retry } as const;
}

/** 内置 + 我的角色;reload() 丢掉缓存重新取(创建 / 编辑 / 删除之后)。 */
export function usePersonas(enabled = true) {
  const { api, user } = useAuth();
  const key = user?.id ?? "";
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !key) return;
    let alive = true;
    setState("loading");
    cached(personasCache, key, () => agentsApi.personas(api).then((r) => r.personas)).then(
      (list) => { if (alive) { setPersonas(list); setState("ready"); } },
      () => { if (alive) setState("error"); },
    );
    return () => { alive = false; };
  }, [api, key, enabled, attempt]);
  const reload = useCallback(() => {
    personasCache.delete(key);
    setAttempt((n) => n + 1);
  }, [key]);
  return { personas, state, reload } as const;
}
```

`web/src/features/agents/locales.ts`:

```ts
import i18n from "~/i18n";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

/**
 * agents 的文案不进主包(R-W3):`**\/i18n/*.json` 由 i18n/index.ts 急切合并,这里的 locales/ 不在那个 glob 里。
 * 每个懒加载入口模块都 `import "./locales"`,模块求值时并入 i18next(深合并,不覆盖已有键)。
 */
let loaded = false;
export function ensureAgentsI18n(): void {
  if (loaded) return;
  loaded = true;
  i18n.addResourceBundle("en", "translation", en, true, false);
  i18n.addResourceBundle("zh-CN", "translation", zh, true, false);
}
ensureAgentsI18n();
```

`web/src/features/agents/locales/en.json`:

```json
{
  "web": {
    "agents": {
      "common": { "close": "Close", "retry": "Retry" },
      "meRow": { "title": "Agents", "hint": "Personas, tools and memory" },
      "chip": { "choose": "Persona", "label": "Persona: {{name}}. Tap to change", "disabled": "Disabled" },
      "process": {
        "replying": "Replying…",
        "preparing": "Preparing reply",
        "done": "Done",
        "summary": "Thought for {{seconds}}s",
        "toolsUsed_one": "used {{count}} tool",
        "toolsUsed_other": "used {{count}} tools",
        "expand": "Show steps",
        "collapse": "Hide steps",
        "elapsed": "{{seconds}}s",
        "context": "Context",
        "contextCount": "Context · {{count}}",
        "toolsTitle": "Tools",
        "toolsCount": "Tools · {{count}}",
        "count": "{{count}} items",
        "status": { "run": "Running", "done": "Done", "fail": "Failed", "skip": "Skipped" },
        "doneMs": "Done {{ms}}ms",
        "failed": "{{name}} failed",
        "failedNote": "The reply did not use this",
        "skippedNote": "Too slow, not used this time",
        "retry": "Retry",
        "regenerate": "Regenerate",
        "thought": "Approach",
        "thoughtSummary": "the model's own summary, not raw reasoning",
        "thoughtReasoning": "the model's reasoning",
        "detailTitle": "Tool call",
        "detailHint": "Parameters, status and time",
        "detailTool": "Tool",
        "detailParams": "Parameters",
        "detailStatus": "Status",
        "detailTime": "Time",
        "detailMs": "{{ms}} ms",
        "privacy": "Parameters only show the word itself, never your full conversation or account details."
      },
      "steps": {
        "persona": "Persona", "memory": "Memory", "history": "Recent messages", "learned_words": "Your learned words",
        "weak_words": "Your weak words", "due_words": "Words due today", "word_lookup": "Look up", "other": "Step"
      },
      "sources": { "lookup": "Dictionary · {{word}}" },
      "errors": {
        "disabled": "Agents or this persona are turned off.",
        "limit": "You have reached today's agent limit. Try again tomorrow.",
        "llm_unavailable": "The AI service is unavailable. Please try again.",
        "bad_request": "This message could not be sent to the agent.",
        "busy": "The previous reply is still being generated. Try again in a moment.",
        "interrupted": "The connection dropped before the reply finished. Retry to get it.",
        "timeout": "The reply timed out. Retry to get it."
      },
      "picker": {
        "title": "Choose a persona",
        "subtitle": "Used in chats and rooms",
        "tabsLabel": "Persona list",
        "all": "All",
        "builtin": "Built-in",
        "mine": "Mine",
        "create": "Create my persona",
        "limit": "Up to {{max}}",
        "note": "Only you can pick your personas. In a room, members see the name, the intro and the persona text if it is public (you can turn that off in the persona).",
        "none": "No persona",
        "noneHint": "A plain conversation",
        "empty": "You have not created a persona yet.",
        "edit": "Edit {{name}}",
        "loadFailed": "Could not load personas."
      },
      "editor": {
        "createTitle": "Create persona",
        "editTitle": "Edit persona",
        "name": "Name",
        "intro": "Intro",
        "prompt": "Persona",
        "promptCount": "{{used}} / {{max}}",
        "level": "English level",
        "style": "Speaking style",
        "styles": { "friendly": "Friendly", "strict": "Strict", "humor": "Funny", "concise": "Concise" },
        "voice": "Voice",
        "voiceDefault": "Server default",
        "tools": "Tools",
        "promptPublic": "Show persona text in rooms",
        "promptPublicHint": "Room members can read the persona text. Name and intro are always visible.",
        "safety": "Your persona comes after our safety rules and cannot change them. Personas that break the rules are disabled by admins.",
        "tryButton": "Try a line",
        "tryLabel": "Line to try",
        "tryDefault": "Hi! Can you introduce yourself?",
        "tryFailed": "Could not try this persona. Please try again.",
        "tryUnavailable": "Trying is not available right now.",
        "save": "Save",
        "delete": "Delete persona",
        "deleteConfirm": "Tap again to delete",
        "errors": {
          "name": "Name is 1 to 20 characters.",
          "prompt": "Persona text is required and must fit the limit.",
          "limit": "You have reached the persona limit.",
          "invalid": "Some fields are not valid.",
          "failed": "Could not save. Please try again."
        }
      },
      "tools": { "lookup": "Look up words", "learned_words": "Read learned words", "weak_words": "Read weak words", "due_words": "Read due words", "memory": "Read memory" },
      "toolHints": {
        "lookup": "Local dictionary only",
        "learned_words": "Only yours; in rooms only you see this step",
        "weak_words": "Only yours",
        "due_words": "Only yours",
        "memory": "Only your own memory"
      },
      "report": {
        "title": "Report persona",
        "reason": "Reason",
        "reasons": { "unsafe": "Unsafe content", "offensive": "Offensive", "spam": "Spam or ads", "other": "Other" },
        "note": "Details (optional)",
        "submit": "Submit report",
        "done": "Report sent. An admin will review it.",
        "failed": "Could not send the report. Please try again."
      },
      "settings": {
        "title": "Agents",
        "disabled": "Agents are not enabled on this server.",
        "groups": { "personas": "Personas", "tools": "Tools", "memory": "Memory", "rooms": "Rooms", "display": "Display", "tutor": "Teach me" },
        "defaultPersona": "Default persona",
        "defaultNone": "Not set",
        "myPersonas": "My personas",
        "myPersonasHint": "Create, edit or delete",
        "toolsHint": "Turned off here, no persona uses it.",
        "memoryEnabled": "Remember me",
        "memoryEnabledHint": "Agents keep short notes about your goals and progress",
        "memoryManage": "Manage memory",
        "shareInRooms": "Use my learning data in rooms",
        "shareWarning": "Replies in a room are visible to everyone. Agents will not read out your learning data item by item.",
        "showProcess": "Show thinking steps",
        "showProcessHint": "Collapsed by default, opens while replying",
        "tutorLength": "Questions per session",
        "tutorLengthValue": "{{count}} questions",
        "tutorMix": "Question types",
        "kinds": { "ask": "Ask", "words": "Use words", "repeat": "Repeat", "retell": "Retell", "roleplay": "Role-play", "dictate": "Dictation" },
        "saveFailed": "Could not save. Please try again."
      },
      "tutor": { "entry": "Teach me" }
    }
  }
}
```

`web/src/features/agents/locales/zh-CN.json`(与 en 同一棵键树):

```json
{
  "web": {
    "agents": {
      "common": { "close": "关闭", "retry": "重试" },
      "meRow": { "title": "智能体", "hint": "角色、工具与记忆" },
      "chip": { "choose": "角色", "label": "角色:{{name}},点按更换", "disabled": "已停用" },
      "process": {
        "replying": "正在回复…",
        "preparing": "正在准备回复",
        "done": "已完成",
        "summary": "思考 {{seconds}} 秒",
        "toolsUsed_one": "用了 {{count}} 个工具",
        "toolsUsed_other": "用了 {{count}} 个工具",
        "expand": "展开过程",
        "collapse": "收起过程",
        "elapsed": "{{seconds}}s",
        "context": "上下文",
        "contextCount": "上下文 · {{count}} 项",
        "toolsTitle": "工具",
        "toolsCount": "工具 · {{count}} 项",
        "count": "{{count}} 个",
        "status": { "run": "进行中", "done": "完成", "fail": "失败", "skip": "已跳过" },
        "doneMs": "完成 {{ms}}ms",
        "failed": "{{name}} 失败",
        "failedNote": "回复未使用这一项",
        "skippedNote": "太慢,这次没用上",
        "retry": "重试",
        "regenerate": "重新生成",
        "thought": "思路",
        "thoughtSummary": "模型自述,非原始推理",
        "thoughtReasoning": "模型推理原文",
        "detailTitle": "工具调用",
        "detailHint": "参数、状态和耗时",
        "detailTool": "工具",
        "detailParams": "参数",
        "detailStatus": "状态",
        "detailTime": "耗时",
        "detailMs": "{{ms}} ms",
        "privacy": "参数里只显示词本身,不会显示你的完整对话或账号信息。"
      },
      "steps": {
        "persona": "角色设定", "memory": "记忆", "history": "最近对话", "learned_words": "你的已学词",
        "weak_words": "你的易错词", "due_words": "今天到期的词", "word_lookup": "查词", "other": "步骤"
      },
      "sources": { "lookup": "词典 · {{word}}" },
      "errors": {
        "disabled": "智能体或这个角色已停用。",
        "limit": "今天的智能体次数已用完,明天再来。",
        "llm_unavailable": "AI 服务暂时不可用,请重试。",
        "bad_request": "这条消息没能交给智能体。",
        "busy": "上一条还在生成,稍后重试。",
        "interrupted": "连接中断,回复没有收完。点重试取回。",
        "timeout": "回复超时,点重试取回。"
      },
      "picker": {
        "title": "选择角色",
        "subtitle": "对话和联机房间通用",
        "tabsLabel": "角色列表",
        "all": "全部",
        "builtin": "内置",
        "mine": "我的",
        "create": "创建我的角色",
        "limit": "最多 {{max}} 个",
        "note": "我的角色只有你自己能选;在联机房间里使用时,成员会看到角色名、简介和公开的人设原文(可在角色里关闭)。",
        "none": "不使用角色",
        "noneHint": "普通对话",
        "empty": "还没有自己的角色。",
        "edit": "编辑 {{name}}",
        "loadFailed": "角色没能加载。"
      },
      "editor": {
        "createTitle": "创建角色",
        "editTitle": "编辑角色",
        "name": "名称",
        "intro": "简介",
        "prompt": "人设",
        "promptCount": "{{used}} / {{max}}",
        "level": "英文水平",
        "style": "说话风格",
        "styles": { "friendly": "友好", "strict": "严格", "humor": "幽默", "concise": "简洁" },
        "voice": "音色",
        "voiceDefault": "服务端默认",
        "tools": "可用工具",
        "promptPublic": "在联机房间公开人设原文",
        "promptPublicHint": "房间成员可以查看人设原文;名称和简介总是可见。",
        "safety": "人设放在我们的安全规则之后,不能改变安全规则。违规角色会被管理员停用。",
        "tryButton": "试聊一句",
        "tryLabel": "试聊的一句话",
        "tryDefault": "Hi! Can you introduce yourself?",
        "tryFailed": "没能试聊,请重试。",
        "tryUnavailable": "试聊暂不可用。",
        "save": "保存",
        "delete": "删除角色",
        "deleteConfirm": "再点一次删除",
        "errors": {
          "name": "名称 1–20 个字。",
          "prompt": "人设不能为空,且不能超过上限。",
          "limit": "角色数已达上限。",
          "invalid": "有字段不符合要求。",
          "failed": "没能保存,请重试。"
        }
      },
      "tools": { "lookup": "查词", "learned_words": "读已学词", "weak_words": "读易错词", "due_words": "读到期词", "memory": "读记忆" },
      "toolHints": {
        "lookup": "只读本地词典",
        "learned_words": "只读你自己的,联机里仅你可见",
        "weak_words": "只读你自己的",
        "due_words": "只读你自己的",
        "memory": "只读你自己的记忆"
      },
      "report": {
        "title": "举报角色",
        "reason": "原因",
        "reasons": { "unsafe": "不安全内容", "offensive": "冒犯", "spam": "垃圾或广告", "other": "其他" },
        "note": "补充说明(可选)",
        "submit": "提交举报",
        "done": "已提交,管理员会处理。",
        "failed": "没能提交,请重试。"
      },
      "settings": {
        "title": "智能体",
        "disabled": "智能体未开启。",
        "groups": { "personas": "角色", "tools": "工具", "memory": "记忆", "rooms": "联机", "display": "显示", "tutor": "带我学" },
        "defaultPersona": "默认角色",
        "defaultNone": "未设置",
        "myPersonas": "我的角色",
        "myPersonasHint": "创建、编辑或删除",
        "toolsHint": "这里关掉后,所有角色都不会使用这一项。",
        "memoryEnabled": "记住我",
        "memoryEnabledHint": "智能体会记下你的目标和进步",
        "memoryManage": "管理记忆",
        "shareInRooms": "在联机房间里使用我的学习数据",
        "shareWarning": "房间里的回复所有人可见;智能体不会逐条念出你的学习数据。",
        "showProcess": "显示思考过程",
        "showProcessHint": "默认折叠,回复时自动展开",
        "tutorLength": "每次题数",
        "tutorLengthValue": "{{count}} 题",
        "tutorMix": "题型",
        "kinds": { "ask": "提问", "words": "用词造句", "repeat": "跟读", "retell": "复述", "roleplay": "情景对话", "dictate": "听写" },
        "saveFailed": "没能保存,请重试。"
      },
      "tutor": { "entry": "带我学" }
    }
  }
}
```

`web/src/features/agents/lazy-parts.tsx`:

```tsx
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

/**
 * 懒加载包装(R-W2):主包里只有这个函数与每个组件一行包装;实现、文案在各自的块里。
 * fallback 默认为空(页面里的局部块);页面级组件传一个占位。
 */
export function part<P extends object>(load: () => Promise<ComponentType<P>>, fallback: ReactNode = null): ComponentType<P> {
  const Lazy = lazy(async () => ({ default: await load() })) as unknown as ComponentType<Record<string, unknown>>;
  function Part(props: P) {
    return (
      <Suspense fallback={fallback}>
        <Lazy {...(props as Record<string, unknown>)} />
      </Suspense>
    );
  }
  return Part;
}

export const pageFallback = <div aria-busy="true" className="min-h-40" />;

// ---- parts ----
```

`web/src/features/agents/index.ts`(新建;已存在则把下面 `// ---- A4 agents-web ----` 之后的内容追加到末尾):

```ts
// agents 的公共接口:其他目录只能从这里引入 agents(由 src/architecture.test.ts 约束)。
// ---- A4 agents-web ----
// 组件一律从 lazy-parts 导出懒加载包装(R-W2);类型导出在编译后消失。
export type {
  AgentSettings, AgentStep, AgentThought, AgentTrace, AgentTurnRequest, AgentTurnResult, AgentView, AgentsConfig, LiveTrace,
  Persona, PersonaDraft, ToolKey, TurnEvent, TurnMeta,
} from "./types";
export { agentsApi } from "./agents-api";
```

- [ ] **Step 4: 跑测试** — `yarn web:typecheck && cd web && yarn vitest run src/features/agents src/architecture.test.ts src/i18n`。
- [ ] **Step 5: 提交** — `feat(web): agents types, REST client, data hooks and lazy locales`。

### Task H2: SSE 解析器与过程归并

**Files:**
- Create: `web/src/features/agents/{sse.ts,sse.test.ts,trace.ts,trace.test.ts,step-labels.ts}`

**Interfaces:**
- Produces:`RawSseEvent`、`createAgentSseParser(onEvent)`、`parseTurnEvent(raw) → TurnEvent | null`;`startLive(now)`、`reduceLive(live, event)`(delta 在 streaming 阶段返回同一对象)、`liveAsTrace(live, now)`、`summarize({ ms, steps }) → { seconds, tools }`、`sourcesOf(steps)`;`stepLabel(t, step)`、`stepTitle(t, step)`、`stepSub(t, step)`、`formatParams(params)`

- [ ] **Step 1: 写失败测试**

`web/src/features/agents/sse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAgentSseParser, parseTurnEvent, type RawSseEvent } from "./sse";

const collect = (chunks: string[]) => {
  const out: RawSseEvent[] = [];
  const parser = createAgentSseParser((e) => out.push(e));
  for (const c of chunks) parser.push(c);
  parser.flush();
  return out;
};

describe("agent SSE parser (spec §4.4, R-W11)", () => {
  it("keeps event names, joins multi-line data, skips comment heartbeats and survives any chunk split", () => {
    const body = ': ping\n\nevent: start\ndata: {"turn_id":"t1"}\n\nevent: delta\ndata: {"text":"Hel"}\r\n\r\nevent: delta\ndata: {"text":\ndata: "lo"}\n\n';
    const whole = collect([body]);
    expect(whole.map((e) => e.event)).toEqual(["start", "delta", "delta"]);
    expect(whole[2].data).toBe('{"text":\n"lo"}');
    for (let cut = 1; cut < body.length; cut++) expect(collect([body.slice(0, cut), body.slice(cut)])).toEqual(whole);
  });

  it("emits a trailing block without a blank line on flush", () => {
    expect(collect(['event: done\ndata: {"text_len":2}'])).toEqual([{ event: "done", data: '{"text_len":2}' }]);
  });

  it("maps every event type of the spec and camelCases keys", () => {
    const step = { id: "s1", group: "tool", key: "word_lookup", status: "done", label_key: "agents.step.word_lookup", params: { word: "abandon" }, ms: 90, private: false };
    expect(parseTurnEvent({ event: "start", data: '{"turn_id":"t1"}' })).toEqual({ type: "start", turnId: "t1" });
    expect(parseTurnEvent({ event: "step", data: JSON.stringify(step) })).toEqual({
      type: "step", step: { id: "s1", group: "tool", key: "word_lookup", status: "done", labelKey: "agents.step.word_lookup", params: { word: "abandon" }, ms: 90, private: false },
    });
    expect(parseTurnEvent({ event: "thought", data: '{"source":"summary","text":"Give a synonym first."}' }))
      .toEqual({ type: "thought", thought: { source: "summary", text: "Give a synonym first." } });
    expect(parseTurnEvent({ event: "delta", data: '{"text":"Hi"}' })).toEqual({ type: "delta", text: "Hi" });
    expect(parseTurnEvent({ event: "meta", data: '{"step_index":2,"steps_total":8,"verdict":"good","kind":"ask","done":false}' }))
      .toEqual({ type: "meta", meta: { stepIndex: 2, stepsTotal: 8, verdict: "good", kind: "ask", done: false } });
    const trace = { v: 1, ms: 3400, steps: [step], thought: null };
    expect(parseTurnEvent({ event: "done", data: JSON.stringify({ usage: { in: 10, out: 20 }, trace, text_len: 12 }) })).toEqual({
      type: "done", usage: { in: 10, out: 20 }, textLen: 12,
      trace: { v: 1, ms: 3400, thought: null, steps: [{ ...step, labelKey: step.label_key, label_key: undefined }].map(({ label_key: _drop, ...s }) => s) },
    });
    expect(parseTurnEvent({ event: "error", data: '{"code":"limit"}' })).toEqual({ type: "error", code: "limit" });
  });

  it("ignores unknown events, bad JSON and malformed steps; an unknown error code is llm_unavailable", () => {
    expect(parseTurnEvent({ event: "future", data: "{}" })).toBeNull();
    expect(parseTurnEvent({ event: "delta", data: "not json" })).toBeNull();
    expect(parseTurnEvent({ event: "step", data: '{"id":"s1","group":"weird","status":"done"}' })).toBeNull();
    expect(parseTurnEvent({ event: "error", data: '{"code":"mystery"}' })).toEqual({ type: "error", code: "llm_unavailable" });
    expect(parseTurnEvent({ event: "done", data: '{"trace":{"steps":"x"}}' })).toEqual({ type: "done", usage: null, trace: null, textLen: 0 });
  });
});
```

`web/src/features/agents/trace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { liveAsTrace, reduceLive, sourcesOf, startLive, summarize } from "./trace";
import type { AgentStep } from "./types";

const step = (id: string, over: Partial<AgentStep> = {}): AgentStep =>
  ({ id, group: "tool", key: "word_lookup", status: "run", labelKey: "x", private: false, ...over });

describe("live trace reducer (spec §5)", () => {
  it("upserts steps by id, records thought and meta, and moves through the phases", () => {
    let live = startLive(1000);
    live = reduceLive(live, { type: "start", turnId: "t1" });
    live = reduceLive(live, { type: "step", step: step("a") });
    live = reduceLive(live, { type: "step", step: step("a", { status: "done", ms: 90, params: { word: "give up" } }) });
    live = reduceLive(live, { type: "thought", thought: { source: "summary", text: "x" } });
    expect(live.steps).toEqual([step("a", { status: "done", ms: 90, params: { word: "give up" } })]);
    expect(live.phase).toBe("prep");
    const streaming = reduceLive(live, { type: "delta", text: "Hi" });
    expect(streaming.phase).toBe("streaming");
    expect(reduceLive(streaming, { type: "delta", text: "!" })).toBe(streaming); // 增量不触发重绘
    expect(reduceLive(streaming, { type: "done", usage: null, trace: null, textLen: 3 }).phase).toBe("done");
    expect(reduceLive(streaming, { type: "error", code: "limit" }).phase).toBe("error");
    expect(liveAsTrace(streaming, 3500)).toEqual({ v: 1, ms: 2500, steps: streaming.steps, thought: streaming.thought });
  });

  it("summarizes whole seconds (at least 1) and successful tools only", () => {
    expect(summarize({ ms: 3400, steps: [step("a", { status: "done" }), step("b", { status: "fail" }), step("c", { group: "context", status: "done" })] }))
      .toEqual({ seconds: 3, tools: 1 });
    expect(summarize({ ms: 120, steps: [] })).toEqual({ seconds: 1, tools: 0 });
  });

  it("lists sources from successful tools, one chip per key + word", () => {
    const steps = [
      step("a", { status: "done", params: { word: "give up" } }), step("b", { status: "done", params: { word: "give up" } }),
      step("c", { status: "done", key: "learned_words", params: { count: 6 } }), step("d", { status: "fail", key: "weak_words" }),
      step("e", { status: "done", group: "context", key: "persona" }),
    ];
    expect(sourcesOf(steps).map((s) => s.id)).toEqual(["a", "c"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/agents/sse.test.ts src/features/agents/trace.test.ts`。

- [ ] **Step 3: 实现**

`web/src/features/agents/sse.ts`:

```ts
import camelcaseKeys from "camelcase-keys";
import type { AgentStep, AgentThought, AgentTrace, TurnErrorCode, TurnEvent, TurnMeta } from "./types";

/** 一个 SSE 块:event 名 + 合并后的 data。 */
export interface RawSseEvent {
  event: string;
  data: string;
}

const BOUNDARY = /\r?\n\r?\n/;

/**
 * R-W11:保留 `event:` 名;多行 `data:` 以 \n 合并;`:` 开头的注释(心跳)与没有 data 的块忽略;CRLF 与任意分块位置都可。
 */
export function createAgentSseParser(onEvent: (e: RawSseEvent) => void) {
  let buffer = "";
  const emit = (block: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      const at = line.indexOf(":");
      const field = at < 0 ? line : line.slice(0, at);
      const value = at < 0 ? "" : line.slice(at + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length) onEvent({ event, data: data.join("\n") });
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let match: RegExpExecArray | null;
      while ((match = BOUNDARY.exec(buffer))) {
        emit(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
    },
    flush() {
      if (buffer.trim()) emit(buffer);
      buffer = "";
    },
  };
}

const ERROR_CODES: readonly TurnErrorCode[] = ["disabled", "limit", "llm_unavailable", "bad_request", "busy"];
const STATUSES = ["run", "done", "fail", "skip"];
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function toStep(d: Obj): AgentStep | null {
  if (typeof d.id !== "string" || (d.group !== "context" && d.group !== "tool") || !STATUSES.includes(String(d.status))) return null;
  return {
    id: d.id,
    group: d.group,
    key: typeof d.key === "string" ? d.key : "",
    status: d.status as AgentStep["status"],
    labelKey: typeof d.labelKey === "string" ? d.labelKey : "",
    ...(isObj(d.params) ? { params: d.params as Record<string, string | number> } : {}),
    ...(typeof d.ms === "number" ? { ms: d.ms } : {}),
    private: d.private === true,
  };
}

function toThought(d: unknown): AgentThought | null {
  if (!isObj(d) || (d.source !== "summary" && d.source !== "reasoning") || typeof d.text !== "string") return null;
  return { source: d.source, text: d.text };
}

function toTrace(d: unknown): AgentTrace | null {
  if (!isObj(d) || !Array.isArray(d.steps) || typeof d.ms !== "number") return null;
  const steps = d.steps.filter(isObj).map(toStep).filter((s): s is AgentStep => !!s);
  return { v: typeof d.v === "number" ? d.v : 1, ms: d.ms, steps, thought: toThought(d.thought) };
}

/** 一个 SSE 块 → 回合事件;未知事件、坏 JSON、残缺字段返回 null(向前兼容)。 */
export function parseTurnEvent(raw: RawSseEvent): TurnEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw.data);
  } catch {
    return null;
  }
  if (!isObj(payload)) return null;
  const d = camelcaseKeys(payload, { deep: true }) as Obj;
  switch (raw.event) {
    case "start":
      return typeof d.turnId === "string" ? { type: "start", turnId: d.turnId } : null;
    case "step": {
      const step = toStep(d);
      return step ? { type: "step", step } : null;
    }
    case "thought": {
      const thought = toThought(d);
      return thought ? { type: "thought", thought } : null;
    }
    case "delta":
      return typeof d.text === "string" ? { type: "delta", text: d.text } : null;
    case "meta":
      if (typeof d.stepIndex !== "number" || typeof d.stepsTotal !== "number") return null;
      return { type: "meta", meta: d as unknown as TurnMeta };
    case "done": {
      const usage = isObj(d.usage) && typeof d.usage.in === "number" && typeof d.usage.out === "number" ? { in: d.usage.in, out: d.usage.out } : null;
      return { type: "done", usage, trace: toTrace(d.trace), textLen: typeof d.textLen === "number" ? d.textLen : 0 };
    }
    case "error":
      return { type: "error", code: ERROR_CODES.includes(d.code as TurnErrorCode) ? (d.code as TurnErrorCode) : "llm_unavailable" };
    default:
      return null;
  }
}
```

(注:`sse.test.ts` 第三个用例里 `done.trace` 的期望值用 `toStep` 的输出形状;若执行者觉得那行写法难读,改为直接写出 camelCase 的步骤对象 `{ id: "s1", group: "tool", key: "word_lookup", status: "done", labelKey: "agents.step.word_lookup", params: { word: "abandon" }, ms: 90, private: false }`,语义不变。)

`web/src/features/agents/trace.ts`:

```ts
import type { AgentStep, AgentTrace, LiveTrace, TurnEvent } from "./types";

export function startLive(now: number): LiveTrace {
  return { turnId: null, startedAt: now, steps: [], thought: null, meta: null, phase: "prep" };
}

/** 回合事件 → 新的生成中过程。streaming 阶段的 delta 返回同一个对象,调用方据此跳过重绘。 */
export function reduceLive(live: LiveTrace, event: TurnEvent): LiveTrace {
  switch (event.type) {
    case "start":
      return { ...live, turnId: event.turnId };
    case "step": {
      const at = live.steps.findIndex((s) => s.id === event.step.id);
      const steps = at < 0 ? [...live.steps, event.step] : live.steps.map((s, i) => (i === at ? { ...s, ...event.step } : s));
      return { ...live, steps };
    }
    case "thought":
      return { ...live, thought: event.thought };
    case "delta":
      return live.phase === "streaming" ? live : { ...live, phase: "streaming" };
    case "meta":
      return { ...live, meta: event.meta };
    case "done":
      return { ...live, phase: "done" };
    case "error":
      return { ...live, phase: "error" };
  }
}

/** 生成中的过程用存储形状展示:界面只认 AgentTrace 一种形状。 */
export function liveAsTrace(live: LiveTrace, now: number): AgentTrace {
  return { v: 1, ms: Math.max(0, now - live.startedAt), steps: live.steps, thought: live.thought };
}

/** 折叠胶囊一行的两个数:整秒(至少 1)与成功的工具数。 */
export function summarize(view: Pick<AgentTrace, "ms" | "steps">): { seconds: number; tools: number } {
  return {
    seconds: Math.max(1, Math.round(view.ms / 1000)),
    tools: view.steps.filter((s) => s.group === "tool" && s.status === "done").length,
  };
}

/** 回复下方的来源标签:成功的工具步骤,同一 key + 词只出一个。 */
export function sourcesOf(steps: AgentStep[]): AgentStep[] {
  const seen = new Set<string>();
  return steps.filter((s) => {
    if (s.group !== "tool" || s.status !== "done") return false;
    const id = `${s.key}:${String(s.params?.word ?? "")}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
```

`web/src/features/agents/step-labels.ts`:

```ts
import type { TFunction } from "i18next";
import type { AgentStep } from "./types";

/** 步骤名按 key 取文案(服务端新增的 key 显示通用「步骤」,不显示原始键)。 */
export const stepLabel = (t: TFunction, step: AgentStep): string =>
  t(`web.agents.steps.${step.key}`, { defaultValue: t("web.agents.steps.other") });

/** 「查词 · abandon」:参数里只有词本身(spec §4.4)。 */
export function stepTitle(t: TFunction, step: AgentStep): string {
  const word = step.params?.word;
  return typeof word === "string" && word ? `${stepLabel(t, step)} · ${word}` : stepLabel(t, step);
}

export function stepSub(t: TFunction, step: AgentStep): string {
  const count = step.params?.count;
  return typeof count === "number" ? t("web.agents.process.count", { count }) : "";
}

export function formatParams(params: AgentStep["params"]): string {
  const entries = Object.entries(params ?? {});
  return entries.length ? entries.map(([k, v]) => `${k}: ${String(v)}`).join(" · ") : "—";
}
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/features/agents`。
- [ ] **Step 5: 提交** — `feat(web): agents SSE parser and live trace reducer`。

### Task H3: 回合客户端 `streamAgentTurn`、`runAgentTurn` 与 `useAgentTurn`

**Files:**
- Create: `web/src/features/agents/{turn-stream.ts,turn-stream.test.ts,use-agent-turn.ts,use-agent-turn.test.tsx}`
- Append: `web/src/features/agents/index.ts`

**Interfaces:**
- Produces:`AgentErrorCode`、`AgentTurnError { code, retryId, agentText }`、`TurnHandlers { onDelta?, onTrace?, onMeta? }`、`newTurnId()`、`codeForStatus(status)`、`AGENTS_HISTORY_MAX = 20`、`streamAgentTurn(api, req, handlers?, signal?, opts?)`;`runAgentTurn(api, req, handlers?, signal?)`、`useAgentTurn(api) → { status, live, text, result, error, run, retry, abort }`
- Consumes:`POST /api/agents/turn`(spec §4.4)

- [ ] **Step 1: 写失败测试**

`web/src/features/agents/turn-stream.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { AgentTurnError, streamAgentTurn } from "./turn-stream";
import type { AgentTurnRequest, LiveTrace } from "./types";

const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const sse = (parts: string[], close = true) => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(enc.encode(p))); if (close) c.close(); } }), {
    headers: { "Content-Type": "text/event-stream" },
  });
};
const STEP = { id: "s1", group: "tool", key: "word_lookup", status: "done", label_key: "agents.step.word_lookup", params: { word: "give up" }, ms: 90, private: false };
const TRACE = { v: 1, ms: 3200, steps: [STEP], thought: { source: "summary", text: "Synonym first." } };
const HAPPY = [ev("start", { turn_id: "t1" }), ev("step", { ...STEP, status: "run" }), ev("step", STEP), ev("delta", { text: "Hello " }),
  ev("delta", { text: "there!" }), ev("done", { usage: { in: 1, out: 2 }, trace: TRACE, text_len: 12 })];
const REQ: AgentTurnRequest = {
  personaId: "builtin:coach", conversationId: "c1", text: "Hi", history: [{ role: "assistant", content: "Earlier" }], mode: "chat", tutorSessionId: null,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function client(handler: Handler) {
  const mock = createFetchMock({ "POST /api/agents/turn": handler });
  return { mock, api: new ApiClient({ getToken: () => "secret-token", fetchImpl: mock.fetch }) };
}

describe("streamAgentTurn (spec §4.4, R-W10, R-W11)", () => {
  it("posts snake_case with a fresh v4 client_turn_id, keeps the token in the header only, streams deltas and the trace", async () => {
    const log = vi.spyOn(console, "log");
    const { mock, api } = client(() => sse(HAPPY));
    const fulls: string[] = [];
    const phases: LiveTrace["phase"][] = [];
    const result = await streamAgentTurn(api, REQ, { onDelta: (full) => fulls.push(full), onTrace: (l) => phases.push(l.phase) });
    const call = mock.calls[0];
    expect(call.url.pathname).toBe("/api/agents/turn");
    expect(call.url.search).toBe("");
    expect(call.headers.get("Authorization")).toBe("Bearer secret-token");
    const body = JSON.parse(String(call.body));
    expect(body).toEqual({
      persona_id: "builtin:coach", conversation_id: "c1", text: "Hi", history: [{ role: "assistant", content: "Earlier" }],
      mode: "chat", tutor_session_id: null, client_turn_id: expect.stringMatching(UUID),
    });
    expect(fulls).toEqual(["Hello ", "Hello there!"]);
    expect(phases[0]).toBe("prep");
    expect(phases.at(-1)).toBe("done");
    expect(result).toMatchObject({ text: "Hello there!", turnId: "t1", clientTurnId: body.client_turn_id });
    expect(result.trace?.steps[0]).toMatchObject({ key: "word_lookup", labelKey: "agents.step.word_lookup", params: { word: "give up" } });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("sends at most the last 20 history entries and reuses a given client_turn_id", async () => {
    const { mock, api } = client(() => sse(HAPPY));
    const history = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    await streamAgentTurn(api, { ...REQ, history, clientTurnId: "11111111-1111-4111-8111-111111111111" });
    const body = JSON.parse(String(mock.calls[0].body));
    expect(body.history).toHaveLength(20);
    expect(body.history[0].content).toBe("m10");
    expect(body.client_turn_id).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("an error event throws its code with translated text and no retry id (the next try is a new turn)", async () => {
    const { api } = client(() => sse([ev("start", { turn_id: "t1" }), ev("error", { code: "limit" })]));
    const err = await streamAgentTurn(api, REQ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AgentTurnError);
    expect(err).toMatchObject({ code: "limit", retryId: undefined, agentText: i18n.getFixedT("en")("web.agents.errors.limit") });
    expect((err as Error).message).toBe("agent turn failed: limit");
  });

  it("busy keeps the same client_turn_id for the retry", async () => {
    const { api } = client(() => json({ error: "Turn in progress" }, 409));
    const err = (await streamAgentTurn(api, { ...REQ, clientTurnId: "id-1" }).catch((e: unknown) => e)) as AgentTurnError;
    expect(err).toMatchObject({ code: "busy", retryId: "id-1" });
  });

  it("a stream that ends without done is a transport failure that keeps the same id", async () => {
    const { mock, api } = client(() => sse([ev("start", { turn_id: "t1" }), ev("delta", { text: "Hel" })]));
    const err = (await streamAgentTurn(api, REQ).catch((e: unknown) => e)) as AgentTurnError;
    expect(err.code).toBe("interrupted");
    expect(err.retryId).toBe(JSON.parse(String(mock.calls[0].body)).client_turn_id);
  });

  it("a silent stream times out (idle) and keeps the id", async () => {
    const { api } = client(() => sse([ev("start", { turn_id: "t1" })], false));
    const err = (await streamAgentTurn(api, REQ, {}, undefined, { idleMs: 20 }).catch((e: unknown) => e)) as AgentTurnError;
    expect(err).toMatchObject({ code: "timeout", retryId: expect.stringMatching(UUID) });
  });

  it("a user abort rejects with the plain aborted error, never an agent error", async () => {
    const { api } = client(() => sse([ev("delta", { text: "Hi" })], false));
    const controller = new AbortController();
    const err = await streamAgentTurn(api, REQ, { onDelta: () => controller.abort() }, controller.signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("Request aborted");
  });

  it.each([[404, "disabled"], [403, "disabled"], [429, "limit"], [422, "bad_request"], [503, "llm_unavailable"]] as const)(
    "maps HTTP %i before the stream to %s", async (status, code) => {
      const { api } = client(() => json({ error: "whatever" }, status));
      await expect(streamAgentTurn(api, REQ)).rejects.toMatchObject({ code, retryId: undefined });
    });

  it("a network error before any response keeps the id (the server may have the turn)", async () => {
    const api = new ApiClient({ getToken: () => "t", fetchImpl: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch });
    await expect(streamAgentTurn(api, { ...REQ, clientTurnId: "id-2" })).rejects.toMatchObject({ code: "interrupted", retryId: "id-2" });
  });

  it("reads the whole body when the response has no stream (old WebKit)", async () => {
    const text = HAPPY.join("");
    const api = new ApiClient({ getToken: () => "t", fetchImpl: (async () => ({ ok: true, status: 200, body: null, text: async () => text }) as unknown as Response) as typeof fetch });
    expect((await streamAgentTurn(api, REQ)).text).toBe("Hello there!");
  });

  it("an empty reply is llm_unavailable", async () => {
    const { api } = client(() => sse([ev("done", { trace: TRACE, text_len: 0 })]));
    await expect(streamAgentTurn(api, REQ)).rejects.toMatchObject({ code: "llm_unavailable" });
  });
});
```

`web/src/features/agents/use-agent-turn.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock } from "~/test/fetch-mock";
import { useAgentTurn } from "./use-agent-turn";
import type { AgentTurnRequest } from "./types";

const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const sse = (parts: string[]) => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(enc.encode(p))); c.close(); } }));
};
const REQ: Omit<AgentTurnRequest, "clientTurnId"> = { personaId: "builtin:coach", conversationId: "c1", text: "Hi", history: [], mode: "chat", tutorSessionId: null };

describe("useAgentTurn", () => {
  it("runs one turn, exposes live text and the result, and retries a transport failure with the same id", async () => {
    let n = 0;
    const mock = createFetchMock({
      "POST /api/agents/turn": () => (++n === 1 ? sse([ev("delta", { text: "Hel" })]) : sse([ev("delta", { text: "Hello" }), ev("done", { trace: null, text_len: 5 })])),
    });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const { result } = renderHook(() => useAgentTurn(api));
    await act(async () => { await result.current.run(REQ); });
    expect(result.current.status).toBe("error");
    await act(async () => { await result.current.retry(); });
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.text).toBe("Hello");
    const ids = mock.calls.map((c) => JSON.parse(String(c.body)).client_turn_id);
    expect(ids[1]).toBe(ids[0]);
  });

  it("aborts the request on unmount", async () => {
    const mock = createFetchMock({ "POST /api/agents/turn": () => new Promise<Response>(() => undefined) });
    const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
    const { result, unmount } = renderHook(() => useAgentTurn(api));
    act(() => { void result.current.run(REQ); });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    unmount();
    expect(mock.calls[0].signal?.aborted).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/agents/turn-stream.test.ts src/features/agents/use-agent-turn.test.tsx`。

- [ ] **Step 3: 实现**

`web/src/features/agents/turn-stream.ts`:

```ts
import "./locales";
import { ApiError, type ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { markLatency } from "~/lib/latency";
import { createAgentSseParser, parseTurnEvent, type RawSseEvent } from "./sse";
import { reduceLive, startLive } from "./trace";
import type { AgentTurnRequest, AgentTurnResult, LiveTrace, TurnErrorCode, TurnMeta } from "./types";

export type AgentErrorCode = TurnErrorCode | "interrupted" | "timeout";
export const AGENTS_HISTORY_MAX = 20;
const DEFAULT_IDLE_MS = 60_000;

/**
 * 回合失败。message 只含错误码(不带用户文本或上游原文,spec §4.4);agentText 是已翻译的文案,对话页直接显示;
 * retryId 非空 = 重试时沿用这个 client_turn_id(R-W10)。
 */
export class AgentTurnError extends Error {
  readonly agentText: string;
  constructor(readonly code: AgentErrorCode, readonly retryId: string | undefined) {
    super(`agent turn failed: ${code}`);
    this.name = "AgentTurnError";
    this.agentText = i18n.t(`web.agents.errors.${code}`);
  }
}

export interface TurnHandlers {
  onDelta?(full: string, piece: string): void;
  onTrace?(live: LiveTrace): void;
  onMeta?(meta: TurnMeta): void;
}

/** RFC 4122 v4;没有 randomUUID 的旧 iOS 用 getRandomValues 拼。 */
export function newTurnId(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 流开始之前的 HTTP 拒绝 → 错误码(按状态码,不依赖服务端英文文案)。 */
export function codeForStatus(status: number): AgentErrorCode | null {
  if (status === 403 || status === 404) return "disabled";
  if (status === 429) return "limit";
  if (status === 409) return "busy";
  if (status === 400 || status === 422) return "bad_request";
  if (status >= 500) return "llm_unavailable";
  return null;
}

/**
 * 一个回合:POST /api/agents/turn → 读 SSE(R-W11)。从不自动重试(R-W10)。
 * 用户中止 → ApiError(0, "Request aborted")(与 streamChatCompletion 一致,调用方据 live() 静默);
 * 传输失败 → AgentTurnError(interrupted|timeout, 同一 id);服务端 error 事件 → AgentTurnError(code, busy 才带 id)。
 */
export async function streamAgentTurn(
  api: ApiClient,
  req: AgentTurnRequest,
  handlers: TurnHandlers = {},
  signal?: AbortSignal,
  opts: { idleMs?: number; now?: () => number } = {},
): Promise<AgentTurnResult> {
  const clientTurnId = req.clientTurnId ?? newTurnId();
  const now = opts.now ?? (() => Date.now());
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
  const body: AgentTurnRequest = { ...req, clientTurnId, history: req.history.slice(-AGENTS_HISTORY_MAX) };
  const controller = new AbortController();
  let idleFired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abortOuter = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abortOuter, { once: true });
  const armIdle = () => {
    if (timer) clearTimeout(timer);
    if (idleMs > 0) timer = setTimeout(() => { idleFired = true; controller.abort(); }, idleMs);
  };
  // 传输层失败:服务端可能已经在跑或跑完这一回合,重试必须沿用同一个 id
  const transport = (): Error => (signal?.aborted ? new ApiError(0, "Request aborted") : new AgentTurnError(idleFired ? "timeout" : "interrupted", clientTurnId));
  // 用对象保存闭包里写入的结果:let 变量在回调里赋值后 TS 的收窄会出错
  const st: { live: LiveTrace; full: string; first: boolean; result: AgentTurnResult | null; failure: AgentTurnError | null } = {
    live: startLive(now()), full: "", first: true, result: null, failure: null,
  };
  const onEvent = (raw: RawSseEvent) => {
    if (st.result || st.failure) return;
    const event = parseTurnEvent(raw);
    if (!event) return;
    const next = reduceLive(st.live, event);
    if (next !== st.live) {
      st.live = next;
      handlers.onTrace?.(next);
    }
    if (event.type === "delta") {
      st.full += event.text;
      if (st.first) {
        st.first = false;
        markLatency("reply_first_delta");
      }
      handlers.onDelta?.(st.full, event.text);
    } else if (event.type === "meta") {
      handlers.onMeta?.(event.meta);
    } else if (event.type === "done") {
      st.result = { text: st.full, trace: event.trace, turnId: st.live.turnId, meta: st.live.meta, clientTurnId };
    } else if (event.type === "error") {
      st.failure = new AgentTurnError(event.code, event.code === "busy" ? clientTurnId : undefined);
    }
  };
  try {
    armIdle();
    let response: Response;
    try {
      response = await api.request<Response>("POST", "/api/agents/turn", { json: body, as: "raw", signal: controller.signal });
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) throw transport();
      const code = err instanceof ApiError ? codeForStatus(err.status) : null;
      if (code) throw new AgentTurnError(code, code === "busy" ? clientTurnId : undefined);
      throw err;
    }
    handlers.onTrace?.(st.live); // 请求已被接受:界面立刻显示「正在准备回复」
    const parser = createAgentSseParser(onEvent);
    if (!response.body) {
      parser.push(await response.text());
    } else {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const aborted = new Promise<never>((_, reject) => {
        const fail = () => reject(transport());
        if (controller.signal.aborted) fail();
        else controller.signal.addEventListener("abort", fail, { once: true });
      });
      aborted.catch((): void => undefined);
      try {
        for (;;) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await Promise.race([reader.read(), aborted]);
          } catch (err) {
            if (err instanceof AgentTurnError || err instanceof ApiError) throw err;
            throw transport();
          }
          if (chunk.done) break;
          armIdle();
          parser.push(decoder.decode(chunk.value, { stream: true }));
          if (st.result || st.failure) break;
        }
      } catch (err) {
        await reader.cancel().catch((): void => undefined);
        throw err;
      }
      if (st.result || st.failure) await reader.cancel().catch((): void => undefined);
      parser.push(decoder.decode());
    }
    parser.flush();
    if (st.failure) throw st.failure;
    if (!st.result) throw transport();
    if (!st.result.text.trim()) throw new AgentTurnError("llm_unavailable", undefined);
    return st.result;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", abortOuter);
  }
}
```

`web/src/features/agents/use-agent-turn.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "~/api/client";
import type { TurnHandlers } from "./turn-stream";
import type { AgentTurnRequest, AgentTurnResult, LiveTrace } from "./types";

/** 命令式入口(对话页用):解析器与文案按需加载,主包只多这几行(R-W2)。 */
export async function runAgentTurn(api: ApiClient, req: AgentTurnRequest, handlers?: TurnHandlers, signal?: AbortSignal): Promise<AgentTurnResult> {
  const { streamAgentTurn } = await import("./turn-stream");
  return streamAgentTurn(api, req, handlers, signal);
}

export interface AgentTurnState {
  status: "idle" | "running" | "done" | "error";
  live: LiveTrace | null;
  text: string;
  result: AgentTurnResult | null;
  error: unknown;
}
const IDLE: AgentTurnState = { status: "idle", live: null, text: "", result: null, error: null };

/**
 * 有状态的封装(导师条、房间私有面板等):同一时刻只跑一个回合;卸载即中止;
 * retry() 按 R-W10 决定是否沿用上一次的 client_turn_id(错误对象的 retryId)。
 */
export function useAgentTurn(api: ApiClient) {
  const [state, setState] = useState<AgentTurnState>(IDLE);
  const ctl = useRef<AbortController | null>(null);
  const last = useRef<{ req: AgentTurnRequest; retryId?: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ctl.current?.abort();
    };
  }, []);
  const exec = useCallback(async (req: AgentTurnRequest, handlers: TurnHandlers = {}) => {
    if (ctl.current) return null;
    const controller = new AbortController();
    ctl.current = controller;
    last.current = { req };
    const set = (patch: Partial<AgentTurnState>) => {
      if (mounted.current && ctl.current === controller) setState((s) => ({ ...s, ...patch }));
    };
    setState({ ...IDLE, status: "running" });
    try {
      const result = await runAgentTurn(api, req, {
        onDelta: (full, piece) => { set({ text: full }); handlers.onDelta?.(full, piece); },
        onTrace: (live) => { set({ live }); handlers.onTrace?.(live); },
        onMeta: handlers.onMeta,
      }, controller.signal);
      set({ status: "done", result, text: result.text });
      return result;
    } catch (error) {
      last.current = { req, retryId: (error as { retryId?: string } | null)?.retryId };
      set({ status: controller.signal.aborted ? "idle" : "error", error });
      return null;
    } finally {
      if (ctl.current === controller) ctl.current = null;
    }
  }, [api]);
  const run = useCallback((req: Omit<AgentTurnRequest, "clientTurnId">, handlers?: TurnHandlers) => exec({ ...req }, handlers), [exec]);
  const retry = useCallback((handlers?: TurnHandlers) => {
    const prev = last.current;
    return prev ? exec({ ...prev.req, clientTurnId: prev.retryId }, handlers) : Promise.resolve(null);
  }, [exec]);
  const abort = useCallback(() => ctl.current?.abort(), []);
  return { ...state, run, retry, abort } as const;
}
```

`index.ts` 追加:`export { runAgentTurn, useAgentTurn } from "./use-agent-turn";`

- [ ] **Step 4: 跑测试** — `yarn web:typecheck && cd web && yarn vitest run src/features/agents`。
- [ ] **Step 5: 提交** — `feat(web): agent turn SSE client with idempotent retry rules`。

### Task H4: 网页契约测试(A1 的样例)

**Files:**
- Create: `web/src/features/agents/agents-contract.test.ts`

**Interfaces:**
- Consumes:`server/tests/fixtures/agents_contract.json`(A1 录制,按名取;键名表见 Cross-plan assumptions C2)

- [ ] **Step 1: 写测试**

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { createAgentSseParser, parseTurnEvent } from "./sse";
import type { AgentSettings, AgentStep, AgentTrace, AgentsConfig, Persona, TurnEvent } from "./types";

/**
 * 跨计划契约(spec §11.3):A1 用真实应用 + 假 LLM 录制 agents_contract.json(CONTRACT_UPDATE=1 重录)。
 * 这里按名读取并逐键核对 web 的类型;键名若与 A1 不同,只改下面 FIXTURE 一处。
 */
const here = path.dirname(fileURLToPath(import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const C: Record<string, any> = JSON.parse(readFileSync(path.resolve(here, "../../../../server/tests/fixtures/agents_contract.json"), "utf8"));
const FIXTURE = {
  config: "config", personas: "personas", persona: "persona_created", settings: "settings",
  turnSse: "turn_sse", turnErrorSse: "turn_error_sse", message: "message_with_trace", tryLine: "persona_try", report: "persona_report",
} as const;

const keys = (r: Record<string, true>) => Object.keys(r).sort();
const camel = (v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true }) as Record<string, unknown>;
const keysOf = (v: unknown) => Object.keys(camel(v)).sort();
const events = (body: string): TurnEvent[] => {
  const out: TurnEvent[] = [];
  const parser = createAgentSseParser((raw) => { const e = parseTurnEvent(raw); if (e) out.push(e); });
  parser.push(body);
  parser.flush();
  return out;
};

const PERSONA: Record<keyof Persona, true> = { id: true, ownerId: true, name: true, intro: true, prompt: true, level: true, style: true, voice: true,
  tools: true, promptPublic: true, deepThink: true, disabledAt: true, createdAt: true, updatedAt: true };
const SETTINGS: Record<keyof AgentSettings, true> = { tools: true, memoryEnabled: true, shareInRooms: true, showProcess: true, defaultPersonaId: true, tutor: true };
const CONFIG: Record<keyof AgentsConfig, true> = { enabled: true, tutorEnabled: true, memoryEnabled: true, roomsEnabled: true, promptMaxChars: true, personasMax: true };
const STEP: Record<keyof AgentStep, true> = { id: true, group: true, key: true, status: true, labelKey: true, params: true, ms: true, private: true };
const TRACE: Record<keyof AgentTrace, true> = { v: true, ms: true, steps: true, thought: true };

describe("agents contract (server/tests/fixtures/agents_contract.json)", () => {
  it("has every recording this lane reads", () => {
    expect(Object.values(FIXTURE).filter((k) => !(k in C))).toEqual([]);
  });

  it("REST payloads match the web types key by key", () => {
    expect(keysOf(C[FIXTURE.config])).toEqual(keys(CONFIG));
    expect(keysOf(C[FIXTURE.persona])).toEqual(keys(PERSONA));
    for (const p of C[FIXTURE.personas].personas) expect(keysOf(p)).toEqual(keys(PERSONA));
    expect(C[FIXTURE.personas].personas.some((p: { id: string }) => p.id.startsWith("builtin:"))).toBe(true);
    expect(keysOf(C[FIXTURE.settings])).toEqual(keys(SETTINGS));
    expect(Object.keys(C[FIXTURE.settings].tools).sort()).toEqual(["due_words", "learned_words", "lookup", "memory", "weak_words"]);
    expect(Object.values(C[FIXTURE.settings].tools).every((v) => v === true)).toBe(true); // D2:默认全开
    expect(C[FIXTURE.persona].prompt_public).toBe(true); // D3:默认公开
    expect(typeof C[FIXTURE.tryLine].text).toBe("string");
    expect(C[FIXTURE.report]).toBeTruthy();
  });

  it("the recorded turn parses into the event types of spec §4.4 with the web's step and trace shapes", () => {
    const list = events(C[FIXTURE.turnSse]);
    const types = list.map((e) => e.type);
    expect(types[0]).toBe("start");
    expect(types).toContain("step");
    expect(types).toContain("delta");
    expect(types.at(-1)).toBe("done");
    const rawStep = String(C[FIXTURE.turnSse]).split("\n\n").find((b) => b.startsWith("event: step"))!;
    const stepData = JSON.parse(rawStep.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
    expect(keysOf(stepData).filter((k) => k !== "params" && k !== "ms")).toEqual(keys(STEP).filter((k) => k !== "params" && k !== "ms"));
    const done = list.at(-1) as Extract<TurnEvent, { type: "done" }>;
    expect(done.trace).not.toBeNull();
    expect(Object.keys(done.trace!).sort()).toEqual(keys(TRACE));
    expect(JSON.stringify(done.trace).length).toBeLessThanOrEqual(4096);
  });

  it("an error event carries only a code", () => {
    const raw = String(C[FIXTURE.turnErrorSse]).split("\n\n").find((b) => b.startsWith("event: error"))!;
    const data = JSON.parse(raw.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
    expect(Object.keys(data)).toEqual(["code"]);
  });

  it("stored assistant messages carry agent_trace in the trace shape", () => {
    expect(Object.keys(camel(C[FIXTURE.message].agent_trace)).sort()).toEqual(keys(TRACE));
  });
});
```

- [ ] **Step 2: 跑测试** — `cd web && yarn vitest run src/features/agents/agents-contract.test.ts`。键不一致时**改 web 类型去贴合样例**(A1 是形状所有者),并同步改 `sse.ts` 的 `toStep` / `toTrace` 与本计划受影响的测试;`FIXTURE` 表是唯一允许因命名差异而改的地方。
- [ ] **Step 3: 提交** — `test(web): agents contract against the server fixture`。

---

## Web components lane (W)

### Task W1: 过程胶囊、过程卡、工具详情面板与来源标签

**Files:**
- Create: `web/src/features/agents/{process-capsule.tsx,process-card.tsx,step-sheet.tsx,source-chips.tsx,process.test.tsx}`
- Append: `lazy-parts.tsx`、`index.ts`

**Interfaces:**
- Produces:`ProcessCapsuleProps { live?, trace?, generating, showProcess?, onRegenerate?, label?, testId? }`、`ProcessCapsule`;`ProcessCard`;`StepSheet({ step, onClose, onRegenerate? })`;`SourceChipsProps { trace }`、`SourceChips`
- 公开面追加:`ProcessCapsule`、`SourceChips`(懒包装)

- [ ] **Step 1: 写失败测试** — `web/src/features/agents/process.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ProcessCapsule } from "./process-capsule";
import { SourceChips } from "./source-chips";
import { resetAgentsCaches } from "./use-agents-data";
import type { AgentStep, AgentTrace, LiveTrace } from "./types";

const step = (id: string, over: Partial<AgentStep> = {}): AgentStep =>
  ({ id, group: "tool", key: "word_lookup", status: "done", labelKey: "x", params: { word: "abandon" }, ms: 90, private: false, ...over });
const TRACE: AgentTrace = {
  v: 1, ms: 3400,
  steps: [step("c1", { group: "context", key: "persona", params: undefined }), step("t1"), step("t2", { key: "weak_words", status: "fail", params: undefined })],
  thought: { source: "summary", text: "Give a synonym first." },
};
const LIVE: LiveTrace = { turnId: "t", startedAt: Date.now(), steps: [step("t1", { status: "run" })], thought: null, meta: null, phase: "prep" };

function render(ui: React.ReactElement, settings: Record<string, unknown> | null = null) {
  const mock = createFetchMock({ "GET /api/agents/settings": () => (settings ? json(settings) : json({ error: "Not Found" }, 404)) });
  return renderWithProviders(ui, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
}

describe("ProcessCapsule (spec §5, D1)", () => {
  beforeEach(() => resetAgentsCaches());

  it("is expanded while generating and collapses into one line when done", async () => {
    const view = render(<ProcessCapsule live={LIVE} generating />);
    expect(screen.getByTestId("agent-process-card")).toHaveAttribute("data-state", "running");
    expect(screen.getByText("Preparing reply")).toBeInTheDocument();
    expect(screen.getByTestId("agent-tool-row")).toHaveTextContent("Look up · abandon");
    expect(screen.getByText("Running")).toBeInTheDocument();
    view.rerender(<ProcessCapsule trace={TRACE} generating={false} />);
    const capsule = await screen.findByTestId("agent-capsule");
    expect(capsule).toHaveTextContent("Thought for 3s · used 1 tool");
    expect(capsule).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("agent-process-card")).toBeNull();
    await userEvent.click(capsule);
    expect(screen.getByTestId("agent-process-card")).toHaveAttribute("data-state", "done");
    await userEvent.click(screen.getByTestId("agent-process-collapse"));
    expect(screen.getByTestId("agent-capsule")).toBeInTheDocument();
  });

  it("labels the thought source and shows a failed tool as a red row with retry only when regenerating is possible", async () => {
    const onRegenerate = vi.fn();
    const view = render(<ProcessCapsule trace={TRACE} generating={false} onRegenerate={onRegenerate} />);
    await userEvent.click(await screen.findByTestId("agent-capsule"));
    expect(screen.getByTestId("agent-thought")).toHaveTextContent("Approach · the model's own summary, not raw reasoning");
    const failed = screen.getAllByTestId("agent-tool-row").find((r) => r.getAttribute("data-status") === "fail")!;
    expect(failed).toHaveTextContent("Your weak words failed");
    expect(failed).toHaveTextContent("The reply did not use this");
    await userEvent.click(screen.getByTestId("agent-tool-retry"));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    view.rerender(<ProcessCapsule trace={TRACE} generating={false} />);
    expect(screen.queryByTestId("agent-tool-retry")).toBeNull();
  });

  it("shows a skipped source as neutral, not as a failure (R-W5)", async () => {
    render(<ProcessCapsule trace={{ ...TRACE, steps: [step("t3", { key: "due_words", status: "skip", params: undefined })] }} generating={false} />);
    await userEvent.click(await screen.findByTestId("agent-capsule"));
    expect(screen.getByTestId("agent-tool-row")).toHaveTextContent("Too slow, not used this time");
    expect(screen.queryByTestId("agent-tool-retry")).toBeNull();
  });

  it("opens the tool detail sheet with the word only and the privacy note", async () => {
    render(<ProcessCapsule trace={TRACE} generating={false} />);
    await userEvent.click(await screen.findByTestId("agent-capsule"));
    await userEvent.click(screen.getAllByTestId("agent-tool-row")[0]);
    const sheet = await screen.findByTestId("agent-step-sheet");
    expect(sheet).toHaveTextContent("word: abandon");
    expect(sheet).toHaveTextContent("90 ms");
    expect(sheet).toHaveTextContent("never your full conversation");
  });

  it("with show_process off: only 'Replying…' while generating, nothing afterwards (R-W14)", async () => {
    const off = { tools: {}, memory_enabled: true, share_in_rooms: true, show_process: false, default_persona_id: null, tutor: { length: 8, mix: ["ask"] } };
    const view = render(<ProcessCapsule live={LIVE} generating />, off);
    expect(await screen.findByTestId("agent-process-quiet")).toHaveTextContent("Replying…");
    view.rerender(<ProcessCapsule trace={TRACE} generating={false} />);
    expect(screen.queryByTestId("agent-capsule")).toBeNull();
    expect(screen.queryByTestId("agent-process-quiet")).toBeNull();
  });

  it("shows a preparing pill before the first event and nothing for a finished turn without a trace", () => {
    const view = render(<ProcessCapsule live={null} generating />);
    expect(screen.getByTestId("agent-process-quiet")).toHaveTextContent("Preparing reply");
    view.rerender(<ProcessCapsule live={null} trace={null} generating={false} />);
    expect(screen.queryByTestId("agent-process-quiet")).toBeNull();
  });

  it("uses a caller label for the collapsed line (rooms)", async () => {
    render(<ProcessCapsule trace={TRACE} generating={false} showProcess label="Emma answered · for Lin" />);
    expect(await screen.findByTestId("agent-capsule")).toHaveTextContent("Emma answered · for Lin");
  });
});

describe("SourceChips", () => {
  beforeEach(() => resetAgentsCaches());

  it("renders one teal chip per successful tool and opens its details", async () => {
    render(<SourceChips trace={TRACE} />);
    const chips = await screen.findAllByTestId("agent-source");
    expect(chips.map((c) => c.textContent)).toEqual(["Dictionary · abandon"]);
    await userEvent.click(chips[0]);
    expect(await screen.findByTestId("agent-step-sheet")).toHaveTextContent("word: abandon");
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/agents/process.test.tsx`。

- [ ] **Step 3: 实现**

`web/src/features/agents/process-capsule.tsx`:

```tsx
import "./locales";
import { ChevronRightIcon, LoaderIcon, SparklesIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProcessCard } from "./process-card";
import { StepSheet } from "./step-sheet";
import { liveAsTrace, summarize } from "./trace";
import type { AgentStep, AgentTrace, LiveTrace } from "./types";
import { useAgentSettings } from "./use-agents-data";

export interface ProcessCapsuleProps {
  /** 生成中的过程 */
  live?: LiveTrace | null;
  /** 已存的压缩过程(刷新后,messages.agent_trace) */
  trace?: AgentTrace | null;
  generating: boolean;
  /** 覆盖用户设置 show_process(房间等调用方) */
  showProcess?: boolean;
  /** 失败行的「重试」与详情里的「重新生成」:只给最新一条回复(R-W13) */
  onRegenerate?: () => void;
  /** 折叠时整行文字的替代(联机:「Emma 已回答 · 对 Lin」) */
  label?: string;
  testId?: string;
}

/** 生成中每 100 ms 刷新一次用时;不生成时不计时。 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

const quietClass = "inline-flex items-center gap-1.5 self-start rounded-full bg-blue-tint px-2.5 py-1 text-meta font-medium text-blue";

/** 过程胶囊(spec §5、D1):生成中强制展开,结束后折叠成一行;点开看「上下文 → 工具 → 思路」。 */
export function ProcessCapsule({ live = null, trace = null, generating, showProcess, onRegenerate, label, testId = "agent-capsule" }: ProcessCapsuleProps) {
  const { t } = useTranslation();
  const { settings } = useAgentSettings(showProcess === undefined);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<AgentStep | null>(null);
  const now = useNow(generating);
  useEffect(() => {
    if (!generating) setOpen(false);
  }, [generating]);

  const show = showProcess ?? settings?.showProcess ?? true;
  if (!show) {
    return generating ? <span data-testid="agent-process-quiet" role="status" className={quietClass}>{t("web.agents.process.replying")}</span> : null;
  }
  const view: AgentTrace | null = live && (generating || !trace) ? liveAsTrace(live, now) : trace;
  if (!view) {
    return generating ? (
      <span data-testid="agent-process-quiet" role="status" className={quietClass}>
        <LoaderIcon aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />{t("web.agents.process.preparing")}
      </span>
    ) : null;
  }
  if (generating || open) {
    return (
      <>
        <ProcessCard view={view} generating={generating} onCollapse={generating ? undefined : () => setOpen(false)}
          onOpenStep={setDetail} onRegenerate={generating ? undefined : onRegenerate} />
        <StepSheet step={detail} onClose={() => setDetail(null)} onRegenerate={generating ? undefined : onRegenerate} />
      </>
    );
  }
  const { seconds, tools } = summarize(view);
  return (
    <button type="button" data-testid={testId} aria-expanded={false} aria-label={label ?? t("web.agents.process.expand")}
      onClick={() => setOpen(true)}
      className="inline-flex min-h-tap items-center self-start rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pl-2 pr-2.5 text-meta text-ink-2">
        <SparklesIcon aria-hidden className="h-3.5 w-3.5" />
        {label ?? (
          <span>
            <b className="font-medium text-ink">{t("web.agents.process.summary", { seconds })}</b>
            {tools > 0 && <> · {t("web.agents.process.toolsUsed", { count: tools })}</>}
          </span>
        )}
        <ChevronRightIcon aria-hidden className="h-3 w-3 text-ink-3" />
      </span>
    </button>
  );
}
```

`web/src/features/agents/process-card.tsx`:

```tsx
import {
  AlertTriangleIcon, BookOpenIcon, BookmarkIcon, BrainIcon, CalendarClockIcon, CheckIcon, ChevronDownIcon, CircleCheckIcon, FlameIcon,
  LightbulbIcon, LoaderIcon, MinusIcon, type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import { stepLabel, stepSub, stepTitle } from "./step-labels";
import type { AgentStep, AgentThought, AgentTrace } from "./types";

const TOOL_ICON: Record<string, LucideIcon> = {
  word_lookup: BookOpenIcon, learned_words: BookmarkIcon, weak_words: FlameIcon, due_words: CalendarClockIcon, memory: BrainIcon,
};
const sectionClass = "px-3 pb-1 pt-2 text-label font-semibold tracking-eyebrow text-ink-2";
const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function StatusIcon({ status }: { status: AgentStep["status"] }) {
  const base = "flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full";
  if (status === "done") return <span aria-hidden className={cn(base, "bg-green-tint text-green")}><CheckIcon className="h-3 w-3" /></span>;
  if (status === "run") return <span aria-hidden className={cn(base, "bg-blue-tint text-blue")}><LoaderIcon className="h-3 w-3 animate-spin motion-reduce:animate-none" /></span>;
  if (status === "fail") return <span aria-hidden className={cn(base, "bg-red-tint text-red")}><AlertTriangleIcon className="h-3 w-3" /></span>;
  return <span aria-hidden className={cn(base, "bg-surface-2 text-ink-2")}><MinusIcon className="h-3 w-3" /></span>;
}

function ContextRow({ step }: { step: AgentStep }) {
  const { t } = useTranslation();
  const sub = step.status === "skip" ? t("web.agents.process.skippedNote") : stepSub(t, step);
  return (
    <div data-testid="agent-context-row" data-status={step.status} className="flex items-center gap-2 px-3 py-1.5 text-sub">
      <StatusIcon status={step.status} />
      <span className="min-w-0 flex-1">
        <span className="block text-ink">{stepTitle(t, step)}</span>
        {sub && <span className="block text-meta text-ink-2">{sub}</span>}
      </span>
      {typeof step.ms === "number" && <span className="num flex-none text-meta text-ink-2">{(step.ms / 1000).toFixed(1)}s</span>}
    </div>
  );
}

function StatusPill({ step, onRetry }: { step: AgentStep; onRetry?: () => void }) {
  const { t } = useTranslation();
  const pill = "inline-flex h-6 flex-none items-center whitespace-nowrap rounded-full px-2 text-meta font-medium";
  if (step.status === "fail" && onRetry) {
    return (
      <button type="button" data-testid="agent-tool-retry" onClick={onRetry} className={cn(pill, "hit-expand bg-surface text-red", focusClass)}>
        {t("web.agents.process.retry")}
      </button>
    );
  }
  if (step.status === "run") return <span className={cn(pill, "bg-blue-tint text-blue")}>{t("web.agents.process.status.run")}</span>;
  if (step.status === "done") {
    return <span className={cn(pill, "bg-green-tint text-green")}>{typeof step.ms === "number" ? t("web.agents.process.doneMs", { ms: step.ms }) : t("web.agents.process.status.done")}</span>;
  }
  if (step.status === "fail") return <span className={cn(pill, "bg-surface text-red")}>{t("web.agents.process.status.fail")}</span>;
  return <span className={cn(pill, "border-[0.5px] border-hair bg-surface text-ink-2")}>{t("web.agents.process.status.skip")}</span>;
}

function ToolRow({ step, onOpen, onRetry }: { step: AgentStep; onOpen(): void; onRetry?: () => void }) {
  const { t } = useTranslation();
  const failed = step.status === "fail";
  const Icon = TOOL_ICON[step.key] ?? BookOpenIcon;
  const personal = step.key !== "word_lookup"; // 读个人数据的工具 = 琥珀;查词 = 青(一色一义)
  const note = failed ? t("web.agents.process.failedNote") : step.status === "skip" ? t("web.agents.process.skippedNote") : stepSub(t, step);
  return (
    <div className={cn("flex items-center gap-2 rounded-[10px] pr-2.5", failed ? "bg-red-tint" : "bg-surface-2")}>
      <button type="button" data-testid="agent-tool-row" data-status={step.status} onClick={onOpen}
        className={cn("flex min-h-tap min-w-0 flex-1 items-center gap-2.5 rounded-[10px] py-1.5 pl-2.5 text-left", focusClass)}>
        <span aria-hidden className={cn("flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg",
          failed ? "bg-surface text-red" : personal ? "bg-amber-tint text-amber" : "bg-teal-tint text-teal")}>
          {failed ? <AlertTriangleIcon className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sub font-medium", failed ? "text-red" : "text-ink")}>
            {failed ? t("web.agents.process.failed", { name: stepLabel(t, step) }) : stepTitle(t, step)}
          </span>
          {note && <span className={cn("block truncate text-meta", failed ? "text-red" : "text-ink-2")}>{note}</span>}
        </span>
      </button>
      <StatusPill step={step} onRetry={onRetry} />
    </div>
  );
}

function ThoughtBlock({ thought }: { thought: AgentThought }) {
  const { t } = useTranslation();
  return (
    <div data-testid="agent-thought" data-source={thought.source} className="mx-2 mb-2 rounded-[10px] bg-surface-2 px-3 py-2">
      <p className="mb-0.5 flex items-center gap-1 text-label text-ink-2">
        <LightbulbIcon aria-hidden className="h-3.5 w-3.5" />
        {t("web.agents.process.thought")} · {t(thought.source === "summary" ? "web.agents.process.thoughtSummary" : "web.agents.process.thoughtReasoning")}
      </p>
      <p className="whitespace-pre-wrap break-words text-sub leading-body text-ink">{thought.text}</p>
    </div>
  );
}

/** 展开的过程卡(视觉稿 1、2 屏)。完成后上下文合成一行,工具一行一个,思路单独一块并标明来源。 */
export function ProcessCard({ view, generating, onCollapse, onOpenStep, onRegenerate }: {
  view: AgentTrace;
  generating: boolean;
  onCollapse?: () => void;
  onOpenStep(step: AgentStep): void;
  onRegenerate?: () => void;
}) {
  const { t } = useTranslation();
  const context = view.steps.filter((s) => s.group === "context");
  const tools = view.steps.filter((s) => s.group === "tool");
  const doneContext = context.filter((s) => s.status === "done");
  return (
    <div data-testid="agent-process-card" data-state={generating ? "running" : "done"}
      className="overflow-hidden rounded-card border-[0.5px] border-hair bg-surface shadow-card dark:shadow-none">
      <div className="flex items-center gap-2 border-b-[0.5px] border-hair-2 px-3 py-2 text-meta text-ink-2">
        {generating
          ? <LoaderIcon aria-hidden className="h-4 w-4 animate-spin text-blue motion-reduce:animate-none" />
          : <CircleCheckIcon aria-hidden className="h-4 w-4 text-green" />}
        <b role={generating ? "status" : undefined} className="text-sub font-semibold text-ink">
          {t(generating ? "web.agents.process.preparing" : "web.agents.process.done")}
        </b>
        <span className="num ml-auto">{t("web.agents.process.elapsed", { seconds: (view.ms / 1000).toFixed(1) })}</span>
        {onCollapse && (
          <button type="button" data-testid="agent-process-collapse" aria-label={t("web.agents.process.collapse")} onClick={onCollapse}
            className={cn("hit-expand -mr-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-3", focusClass)}>
            <ChevronDownIcon aria-hidden className="h-4 w-4" />
          </button>
        )}
      </div>
      {context.length > 0 && (
        <>
          <p className={sectionClass}>{generating ? t("web.agents.process.context") : t("web.agents.process.contextCount", { count: context.length })}</p>
          {generating ? context.map((s) => <ContextRow key={s.id} step={s} />) : (
            <>
              {doneContext.length > 0 && (
                <div data-testid="agent-context-summary" className="flex items-center gap-2 px-3 py-1.5 text-sub text-ink">
                  <StatusIcon status="done" />
                  <span className="min-w-0 flex-1">{doneContext.map((s) => [stepTitle(t, s), stepSub(t, s)].filter(Boolean).join(" ")).join(" · ")}</span>
                </div>
              )}
              {context.filter((s) => s.status !== "done").map((s) => <ContextRow key={s.id} step={s} />)}
            </>
          )}
        </>
      )}
      {tools.length > 0 && (
        <>
          <p className={sectionClass}>{generating ? t("web.agents.process.toolsTitle") : t("web.agents.process.toolsCount", { count: tools.length })}</p>
          <ul className="space-y-1 px-2 pb-2">
            {tools.map((s) => <li key={s.id}><ToolRow step={s} onOpen={() => onOpenStep(s)} onRetry={onRegenerate} /></li>)}
          </ul>
        </>
      )}
      {view.thought && <ThoughtBlock thought={view.thought} />}
    </div>
  );
}
```

`web/src/features/agents/step-sheet.tsx`:

```tsx
import { RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { formatParams, stepLabel } from "./step-labels";
import type { AgentStep } from "./types";

/** 工具详情(视觉稿 3 屏):工具、参数(只有词本身)、状态、耗时;关闭 / 重新生成。 */
export function StepSheet({ step, onClose, onRegenerate }: { step: AgentStep | null; onClose(): void; onRegenerate?: () => void }) {
  const { t } = useTranslation();
  const rows: Array<[string, string, boolean]> = step ? [
    [t("web.agents.process.detailTool"), stepLabel(t, step), false],
    [t("web.agents.process.detailParams"), formatParams(step.params), true],
    [t("web.agents.process.detailStatus"), t(`web.agents.process.status.${step.status}`), false],
    [t("web.agents.process.detailTime"), typeof step.ms === "number" ? t("web.agents.process.detailMs", { ms: step.ms }) : "—", false],
  ] : [];
  return (
    <BottomSheet open={!!step} onOpenChange={(open) => { if (!open) onClose(); }}>
      <BottomSheetContent data-testid="agent-step-sheet" className="max-h-[85dvh] overflow-y-auto">
        <BottomSheetHeader title={t("web.agents.process.detailTitle")} description={t("web.agents.process.detailHint")} />
        <dl className="divide-y-[0.5px] divide-hair-2 overflow-hidden rounded-card border-[0.5px] border-hair">
          {rows.map(([label, value, mono]) => (
            <div key={label} className="flex gap-2.5 px-3 py-2.5 text-sub">
              <dt className="w-16 flex-none text-meta text-ink-2">{label}</dt>
              <dd className={mono ? "min-w-0 flex-1 break-all font-mono text-meta text-ink" : "min-w-0 flex-1 font-medium text-ink"}>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2.5 flex gap-2 rounded-[10px] bg-blue-tint px-3 py-2 text-meta text-blue">
          <ShieldCheckIcon aria-hidden className="mt-px h-4 w-4 flex-none" />{t("web.agents.process.privacy")}
        </p>
        <div className="mt-3.5 flex gap-2.5">
          <button type="button" onClick={onClose}
            className="h-11 flex-1 rounded-button bg-surface-2 text-body font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("web.agents.common.close")}
          </button>
          {onRegenerate && (
            <button type="button" data-testid="agent-regenerate" onClick={() => { onClose(); onRegenerate(); }}
              className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-button bg-blue text-body font-semibold text-on-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <RefreshCwIcon aria-hidden className="h-4 w-4" />{t("web.agents.process.regenerate")}
            </button>
          )}
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}
```

`web/src/features/agents/source-chips.tsx`:

```tsx
import "./locales";
import { BookOpenIcon, BookmarkIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StepSheet } from "./step-sheet";
import { stepLabel } from "./step-labels";
import { sourcesOf } from "./trace";
import type { AgentStep, AgentTrace } from "./types";
import { useAgentSettings } from "./use-agents-data";

export interface SourceChipsProps {
  trace: AgentTrace | null | undefined;
}

/** 回复下方的来源标签(视觉稿 2 屏,青色);点开看原步骤。show_process 关闭时不显示(R-W14)。 */
export function SourceChips({ trace }: SourceChipsProps) {
  const { t } = useTranslation();
  const { settings } = useAgentSettings();
  const [detail, setDetail] = useState<AgentStep | null>(null);
  const items = trace ? sourcesOf(trace.steps) : [];
  if (!items.length || settings?.showProcess === false) return null;
  return (
    <>
      <div data-testid="agent-sources" className="flex flex-wrap gap-1.5">
        {items.map((s) => {
          const word = s.params?.word;
          const Icon = s.key === "word_lookup" ? BookOpenIcon : BookmarkIcon;
          return (
            <button key={s.id} type="button" data-testid="agent-source" onClick={() => setDetail(s)}
              className="hit-expand inline-flex h-7 items-center gap-1 rounded-full bg-teal-tint px-2.5 text-meta font-medium text-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Icon aria-hidden className="h-3.5 w-3.5" />
              {s.key === "word_lookup" && typeof word === "string" ? t("web.agents.sources.lookup", { word }) : stepLabel(t, s)}
            </button>
          );
        })}
      </div>
      <StepSheet step={detail} onClose={() => setDetail(null)} />
    </>
  );
}
```

`lazy-parts.tsx` 在 `// ---- parts ----` 之后追加:

```tsx
export const ProcessCapsule = part<import("./process-capsule").ProcessCapsuleProps>(() => import("./process-capsule").then((m) => m.ProcessCapsule));
export const SourceChips = part<import("./source-chips").SourceChipsProps>(() => import("./source-chips").then((m) => m.SourceChips));
```

`index.ts` 追加:`export { ProcessCapsule, SourceChips } from "./lazy-parts";`

- [ ] **Step 4: 跑测试** — `yarn web:typecheck && cd web && yarn vitest run src/features/agents`。
- [ ] **Step 5: 提交** — `feat(web): agent process capsule, card, tool details and source chips`。

### Task W2: 角色 chip 与角色编辑器(含试聊一句)

**Files:**
- Create: `web/src/features/agents/{persona-chip.tsx,persona-editor-sheet.tsx,persona-editor-sheet.test.tsx}`
- Append: `lazy-parts.tsx`、`index.ts`

**Interfaces:**
- Produces:`PersonaChipProps { persona, pendingId?, disabled?, onClick }`、`PersonaChip`;`NAME_MAX = 20`、`INTRO_MAX = 60`、`draftOf(persona)`、`validateDraft(draft, promptMax)`、`PersonaEditorSheetProps { open, onOpenChange, persona, onSaved, onDeleted? }`、`PersonaEditorSheet`
- 公开面追加:`PersonaChip`、`PersonaEditorSheet`

- [ ] **Step 1: 写失败测试** — `web/src/features/agents/persona-editor-sheet.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { PersonaEditorSheet } from "./persona-editor-sheet";
import { resetAgentsCaches } from "./use-agents-data";
import type { Persona } from "./types";

const CONFIG = { enabled: true, tutor_enabled: true, memory_enabled: true, rooms_enabled: true, prompt_max_chars: 800, personas_max: 10 };
const MINE: Persona = { id: "p1", ownerId: "12345678", name: "Quiz", intro: "Friday quiz", prompt: "Ask five questions.", level: "B1", style: "strict",
  voice: null, tools: ["lookup"], promptPublic: false, deepThink: false, disabledAt: null, createdAt: null, updatedAt: null };

function setup(routes: Record<string, Handler>, persona: Persona | null = null) {
  const mock = createFetchMock({ "GET /api/agents/config": () => json(CONFIG), ...routes });
  const onSaved = vi.fn();
  const onDeleted = vi.fn();
  renderWithProviders(<PersonaEditorSheet open onOpenChange={() => undefined} persona={persona} onSaved={onSaved} onDeleted={onDeleted} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return { mock, onSaved, onDeleted };
}
const bodyOf = (mock: ReturnType<typeof createFetchMock>, path: string) =>
  JSON.parse(String(mock.calls.find((c) => c.url.pathname === path && c.method !== "GET")!.body));

describe("PersonaEditorSheet (mockup 6, D2, D3)", () => {
  beforeEach(() => { resetAgentsCaches(); resetServerAiConfigCache(); });

  it("starts a new persona with every tool on and the persona text public, counts characters and saves snake_case", async () => {
    const { mock, onSaved } = setup({ "POST /api/agents/personas": () => json({ ...MINE, id: "p9", owner_id: "12345678", prompt_public: true }) });
    for (const key of ["lookup", "learned_words", "weak_words", "due_words", "memory"]) {
      expect(screen.getByTestId(`agent-editor-tool-${key}`)).toHaveAttribute("data-state", "checked");
    }
    expect(screen.getByTestId("agent-editor-prompt-public")).toHaveAttribute("data-state", "checked");
    expect(screen.getByTestId("agent-editor-save")).toBeDisabled();
    await userEvent.type(screen.getByTestId("agent-editor-name"), "  Quiz ");
    await userEvent.type(screen.getByTestId("agent-editor-prompt"), "Ask five questions.");
    expect(await screen.findByTestId("agent-editor-prompt-count")).toHaveTextContent("19 / 800");
    await userEvent.click(screen.getByTestId("agent-editor-style-strict"));
    await userEvent.click(screen.getByTestId("agent-editor-tool-memory"));
    await userEvent.click(screen.getByTestId("agent-editor-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(bodyOf(mock, "/api/agents/personas")).toEqual({
      name: "Quiz", intro: "", prompt: "Ask five questions.", level: "B1", style: "strict", voice: null,
      tools: ["lookup", "learned_words", "weak_words", "due_words"], prompt_public: true, deep_think: false,
    });
  });

  it("tries a line without saving and shows the reply; a 404 hides trying for good", async () => {
    let available = true;
    const { mock } = setup({ "POST /api/agents/personas/try": () => (available ? json({ text: "Hello, I am Quiz." }) : json({ error: "Not Found" }, 404)) });
    await userEvent.type(screen.getByTestId("agent-editor-name"), "Quiz");
    await userEvent.type(screen.getByTestId("agent-editor-prompt"), "Ask five questions.");
    await userEvent.click(screen.getByTestId("agent-editor-try"));
    expect(await screen.findByTestId("agent-editor-try-reply")).toHaveTextContent("Hello, I am Quiz.");
    expect(bodyOf(mock, "/api/agents/personas/try")).toMatchObject({ text: "Hi! Can you introduce yourself?", persona: { name: "Quiz" } });
    expect(mock.calls.some((c) => c.url.pathname === "/api/agents/personas" && c.method === "POST")).toBe(false);
    available = false;
    await userEvent.click(screen.getByTestId("agent-editor-try"));
    expect(await screen.findByText("Trying is not available right now.")).toBeInTheDocument();
    expect(screen.getByTestId("agent-editor-try")).toBeDisabled();
  });

  it("edits an existing persona and deletes it only after a second tap", async () => {
    const { mock, onDeleted } = setup({ "DELETE /api/agents/personas/p1": () => json({ id: "p1" }) }, MINE);
    expect(screen.getByTestId("agent-editor-name")).toHaveValue("Quiz");
    expect(screen.getByTestId("agent-editor-tool-memory")).toHaveAttribute("data-state", "unchecked");
    await userEvent.click(screen.getByTestId("agent-editor-delete"));
    expect(mock.calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(screen.getByTestId("agent-editor-delete")).toHaveTextContent("Tap again to delete");
    await userEvent.click(screen.getByTestId("agent-editor-delete"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("p1"));
  });

  it("shows the limit message on 409 and keeps the sheet open", async () => {
    const { onSaved } = setup({ "POST /api/agents/personas": () => json({ error: "Persona limit reached" }, 409) });
    await userEvent.type(screen.getByTestId("agent-editor-name"), "Quiz");
    await userEvent.type(screen.getByTestId("agent-editor-prompt"), "Ask.");
    await userEvent.click(screen.getByTestId("agent-editor-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent("You have reached the persona limit.");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/agents/persona-editor-sheet.test.tsx`。

- [ ] **Step 3: 实现**

`web/src/features/agents/persona-chip.tsx`:

```tsx
import "./locales";
import { ChevronDownIcon, SparklesIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar } from "~/components/avatar";
import { cn } from "~/lib/cn";
import type { Persona } from "./types";

export interface PersonaChipProps {
  persona: Persona | null;
  /** 会话里记着的角色 id(列表还没取到时用于测试与 data 属性) */
  pendingId?: string | null;
  disabled?: boolean;
  onClick(): void;
}

/** 顶栏角色 chip(R-W15):中性首字头像 + 名字 + 下拉;无角色时星光图标 +「角色」。 */
export function PersonaChip({ persona, pendingId = null, disabled = false, onClick }: PersonaChipProps) {
  const { t } = useTranslation();
  const name = persona?.name ?? null;
  const label = name ? t("web.agents.chip.label", { name }) : t("web.agents.chip.choose");
  return (
    <button type="button" data-testid="agent-persona-chip" data-persona={persona?.id ?? pendingId ?? ""} aria-label={label} title={label}
      disabled={disabled} onClick={onClick}
      className="hit-expand inline-flex h-8 max-w-[132px] flex-none items-center gap-1.5 rounded-full bg-surface-2 pl-1 pr-2 text-sub font-medium text-ink transition-colors duration-fast disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {name ? (
        <span aria-hidden className="flex-none"><Avatar name={name} className="h-6 w-6 text-label" /></span>
      ) : (
        <span aria-hidden className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-surface text-ink-2">
          <SparklesIcon className="h-3.5 w-3.5" />
        </span>
      )}
      <span className={cn("truncate whitespace-nowrap", persona?.disabledAt && "line-through")}>{name ?? t("web.agents.chip.choose")}</span>
      <ChevronDownIcon aria-hidden className="h-3.5 w-3.5 flex-none text-ink-3" />
    </button>
  );
}
```

`web/src/features/agents/persona-editor-sheet.tsx`:

```tsx
import "./locales";
import { ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@renderer/components/ui/switch";
import { ApiError } from "~/api/client";
import { loadServerAiConfig, voicesFor, type ServerAiConfig } from "~/api/server-config";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { cn } from "~/lib/cn";
import { agentsApi, personaErrorKey } from "./agents-api";
import { PERSONA_LEVELS, PERSONA_STYLES, TOOL_KEYS, type Persona, type PersonaDraft, type ToolKey } from "./types";
import { useAgentsConfig } from "./use-agents-data";

export const NAME_MAX = 20;
export const INTRO_MAX = 60;

/** 新建:工具全开(D2)、人设公开(D3)。编辑:沿用角色的值(人设原文只有本人能取到)。 */
export function draftOf(p: Persona | null): PersonaDraft {
  if (!p) return { name: "", intro: "", prompt: "", level: "B1", style: "friendly", voice: null, tools: [...TOOL_KEYS], promptPublic: true, deepThink: false };
  return { name: p.name, intro: p.intro, prompt: p.prompt ?? "", level: p.level, style: p.style, voice: p.voice, tools: [...p.tools], promptPublic: p.promptPublic, deepThink: p.deepThink };
}

export function validateDraft(d: PersonaDraft, promptMax: number): "name" | "prompt" | null {
  const name = d.name.trim();
  if (!name || name.length > NAME_MAX) return "name";
  if (!d.prompt.trim() || d.prompt.length > promptMax) return "prompt";
  return null;
}

const fieldClass = "mb-3.5 block";
const labelClass = "mb-1.5 flex justify-between text-meta text-ink-2";
const inputClass = "w-full rounded-[12px] border-0 bg-surface-2 px-3 py-2.5 text-base text-ink placeholder:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/30";
const chipClass = (on: boolean) => cn(
  "hit-expand h-8 rounded-full px-3 text-sub transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  on ? "bg-blue-tint font-semibold text-blue" : "bg-surface-2 text-ink-2",
);
const TOOL_TONE: Record<ToolKey, string> = {
  lookup: "bg-teal-tint text-teal", learned_words: "bg-amber-tint text-amber", weak_words: "bg-amber-tint text-amber",
  due_words: "bg-amber-tint text-amber", memory: "bg-amber-tint text-amber",
};

export interface PersonaEditorSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** null = 新建 */
  persona: Persona | null;
  onSaved(persona: Persona): void;
  onDeleted?(id: string): void;
}

type Trial = { text: string; state: "idle" | "loading" | "done" | "error" | "unavailable"; reply?: string };

/** 创建 / 编辑角色(视觉稿 6 屏)。音色不试听(R-W7);试聊一句不保存(R-W8)。 */
export function PersonaEditorSheet({ open, onOpenChange, persona, onSaved, onDeleted }: PersonaEditorSheetProps) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const { config } = useAgentsConfig();
  const promptMax = config?.promptMaxChars ?? 800;
  const uid = useId();
  const [draft, setDraft] = useState<PersonaDraft>(() => draftOf(persona));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [trial, setTrial] = useState<Trial>({ text: "", state: "idle" });
  const [ai, setAi] = useState<ServerAiConfig | null>(null);
  useEffect(() => {
    if (!open) return;
    setDraft(draftOf(persona));
    setError(null);
    setConfirmDelete(false);
    setTrial((prev) => ({ text: t("web.agents.editor.tryDefault"), state: prev.state === "unavailable" ? "unavailable" : "idle" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, persona]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadServerAiConfig(api).then((c) => { if (alive) setAi(c); }, (): void => undefined);
    return () => { alive = false; };
  }, [open, api]);

  const voices = ai ? voicesFor(ai, ai.defaultTts.model) : [];
  const invalid = validateDraft(draft, promptMax);
  const clean = (): PersonaDraft => ({ ...draft, name: draft.name.trim(), intro: draft.intro.trim(), prompt: draft.prompt.trim() });
  const toggleTool = (key: ToolKey, on: boolean) =>
    setDraft((d) => ({ ...d, tools: on ? TOOL_KEYS.filter((k) => k === key || d.tools.includes(k)) : d.tools.filter((k) => k !== key) }));

  const save = async () => {
    if (invalid || saving) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(persona ? await agentsApi.updatePersona(api, persona.id, clean()) : await agentsApi.createPersona(api, clean()));
    } catch (err) {
      setError(t(personaErrorKey(err)));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!persona || saving) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try {
      await agentsApi.deletePersona(api, persona.id);
      onDeleted?.(persona.id);
    } catch (err) {
      setError(t(personaErrorKey(err)));
    } finally {
      setSaving(false);
    }
  };
  const tryLine = async () => {
    if (invalid || !trial.text.trim() || trial.state === "loading" || trial.state === "unavailable") return;
    setTrial((s) => ({ ...s, state: "loading", reply: undefined }));
    try {
      const { text } = await agentsApi.tryPersona(api, clean(), trial.text.trim());
      setTrial((s) => ({ ...s, state: "done", reply: text }));
    } catch (err) {
      setTrial((s) => ({ ...s, state: err instanceof ApiError && err.status === 404 ? "unavailable" : "error" }));
    }
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent data-testid="agent-persona-editor" className="max-h-[92dvh] overflow-y-auto pb-0">
        <BottomSheetHeader title={t(persona ? "web.agents.editor.editTitle" : "web.agents.editor.createTitle")} />
        <label className={fieldClass}>
          <span className={labelClass}>{t("web.agents.editor.name")}</span>
          <input data-testid="agent-editor-name" className={inputClass} maxLength={NAME_MAX} value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className={fieldClass}>
          <span className={labelClass}>{t("web.agents.editor.intro")}</span>
          <input data-testid="agent-editor-intro" className={inputClass} maxLength={INTRO_MAX} value={draft.intro}
            onChange={(e) => setDraft({ ...draft, intro: e.target.value })} />
        </label>
        <label className={fieldClass}>
          <span className={labelClass}>
            {t("web.agents.editor.prompt")}
            <span data-testid="agent-editor-prompt-count" id={`${uid}-count`} className="num">
              {t("web.agents.editor.promptCount", { used: draft.prompt.length, max: promptMax })}
            </span>
          </span>
          <textarea data-testid="agent-editor-prompt" rows={4} maxLength={promptMax} aria-describedby={`${uid}-count`} value={draft.prompt}
            className={cn(inputClass, "min-h-24 resize-none leading-body")} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} />
        </label>
        <div className={fieldClass}>
          <span className={labelClass} id={`${uid}-level`}>{t("web.agents.editor.level")}</span>
          <div role="radiogroup" aria-labelledby={`${uid}-level`} className="flex flex-wrap gap-1.5">
            {PERSONA_LEVELS.map((level) => (
              <button key={level} type="button" role="radio" aria-checked={draft.level === level} data-testid={`agent-editor-level-${level}`}
                className={chipClass(draft.level === level)} onClick={() => setDraft({ ...draft, level })}>{level}</button>
            ))}
          </div>
        </div>
        <div className={fieldClass}>
          <span className={labelClass} id={`${uid}-style`}>{t("web.agents.editor.style")}</span>
          <div role="radiogroup" aria-labelledby={`${uid}-style`} className="flex flex-wrap gap-1.5">
            {PERSONA_STYLES.map((style) => (
              <button key={style} type="button" role="radio" aria-checked={draft.style === style} data-testid={`agent-editor-style-${style}`}
                className={chipClass(draft.style === style)} onClick={() => setDraft({ ...draft, style })}>{t(`web.agents.editor.styles.${style}`)}</button>
            ))}
          </div>
        </div>
        <label className={fieldClass}>
          <span className={labelClass}>{t("web.agents.editor.voice")}</span>
          <select data-testid="agent-editor-voice" className={inputClass} value={draft.voice ?? ""}
            onChange={(e) => setDraft({ ...draft, voice: e.target.value || null })}>
            <option value="">{t("web.agents.editor.voiceDefault")}</option>
            {voices.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </label>
        <p className={labelClass}>{t("web.agents.editor.tools")}</p>
        <div className="divide-y-[0.5px] divide-hair-2">
          {TOOL_KEYS.map((key) => (
            <div key={key} className="flex min-h-row items-center gap-2.5 py-1.5">
              <span aria-hidden className={cn("flex h-7 w-7 flex-none items-center justify-center rounded-[9px] text-label font-semibold", TOOL_TONE[key])}>
                {t(`web.agents.tools.${key}`).slice(0, 1)}
              </span>
              <label htmlFor={`${uid}-${key}`} className="min-w-0 flex-1 text-body text-ink">
                {t(`web.agents.tools.${key}`)}
                <span className="block text-meta text-ink-2">{t(`web.agents.toolHints.${key}`)}</span>
              </label>
              <Switch id={`${uid}-${key}`} data-testid={`agent-editor-tool-${key}`} checked={draft.tools.includes(key)} onCheckedChange={(on) => toggleTool(key, on)}
                className="hit-expand h-[26px] w-11 flex-none data-[state=checked]:bg-blue data-[state=unchecked]:bg-surface-2 data-[state=unchecked]:shadow-hair" />
            </div>
          ))}
          <div className="flex min-h-row items-center gap-2.5 py-1.5">
            <label htmlFor={`${uid}-public`} className="min-w-0 flex-1 text-body text-ink">
              {t("web.agents.editor.promptPublic")}
              <span className="block text-meta text-ink-2">{t("web.agents.editor.promptPublicHint")}</span>
            </label>
            <Switch id={`${uid}-public`} data-testid="agent-editor-prompt-public" checked={draft.promptPublic} onCheckedChange={(promptPublic) => setDraft({ ...draft, promptPublic })}
              className="hit-expand h-[26px] w-11 flex-none data-[state=checked]:bg-blue data-[state=unchecked]:bg-surface-2 data-[state=unchecked]:shadow-hair" />
          </div>
        </div>
        <p className="mt-2.5 flex gap-2 rounded-[10px] bg-amber-tint px-3 py-2 text-meta text-amber">
          <ShieldCheckIcon aria-hidden className="mt-px h-4 w-4 flex-none" />{t("web.agents.editor.safety")}
        </p>
        <label className="mt-3.5 block">
          <span className={labelClass}>{t("web.agents.editor.tryLabel")}</span>
          <input data-testid="agent-editor-try-text" className={inputClass} maxLength={200} value={trial.text}
            onChange={(e) => setTrial({ ...trial, text: e.target.value })} />
        </label>
        {trial.state === "done" && trial.reply && (
          <p data-testid="agent-editor-try-reply" className="mt-2 whitespace-pre-wrap rounded-card border-[0.5px] border-hair bg-surface px-3 py-2 text-body text-ink">{trial.reply}</p>
        )}
        {trial.state === "error" && <p role="status" className="mt-2 text-sub text-ink-2">{t("web.agents.editor.tryFailed")}</p>}
        {trial.state === "unavailable" && <p role="status" className="mt-2 text-sub text-ink-2">{t("web.agents.editor.tryUnavailable")}</p>}
        {error && <p role="alert" className="mt-2 text-sub text-red">{error}</p>}
        {!error && invalid && (draft.name || draft.prompt) && (
          <p className="mt-2 text-meta text-ink-2">{t(`web.agents.editor.errors.${invalid}`)}</p>
        )}
        {persona && (
          <button type="button" data-testid="agent-editor-delete" disabled={saving} onClick={() => void remove()}
            className="mt-3 inline-flex min-h-tap items-center gap-1.5 rounded-button px-1 text-sub font-semibold text-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Trash2Icon aria-hidden className="h-4 w-4" />{t(confirmDelete ? "web.agents.editor.deleteConfirm" : "web.agents.editor.delete")}
          </button>
        )}
        <div className="glass glass-edge-t sticky bottom-0 -mx-gutter mt-3 flex gap-2.5 px-gutter pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2.5">
          <button type="button" data-testid="agent-editor-try" disabled={!!invalid || trial.state === "loading" || trial.state === "unavailable"} onClick={() => void tryLine()}
            className="h-11 flex-1 whitespace-nowrap rounded-button bg-surface-2 text-body font-semibold text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("web.agents.editor.tryButton")}
          </button>
          <button type="button" data-testid="agent-editor-save" disabled={!!invalid || saving} onClick={() => void save()}
            className="h-11 flex-1 whitespace-nowrap rounded-button bg-blue text-body font-semibold text-on-blue disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("web.agents.editor.save")}
          </button>
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}
```

`lazy-parts.tsx` 追加:

```tsx
export const PersonaChip = part<import("./persona-chip").PersonaChipProps>(() => import("./persona-chip").then((m) => m.PersonaChip));
export const PersonaEditorSheet = part<import("./persona-editor-sheet").PersonaEditorSheetProps>(() => import("./persona-editor-sheet").then((m) => m.PersonaEditorSheet));
```

`index.ts` 追加:`export { PersonaChip, PersonaEditorSheet } from "./lazy-parts";`

- [ ] **Step 4: 跑测试** — `yarn web:typecheck && cd web && yarn vitest run src/features/agents`。
- [ ] **Step 5: 提交** — `feat(web): persona chip and editor with try-a-line`。

### Task W3: 角色选择面板

**Files:**
- Create: `web/src/features/agents/{persona-picker.tsx,persona-picker.test.tsx}`
- Append: `lazy-parts.tsx`、`index.ts`

**Interfaces:**
- Produces:`PickerTab = "all" | "builtin" | "mine"`、`PersonaPickerProps { open, onOpenChange, selectedId, onSelect?, allowNone?, mode?: "select" | "manage", initialTab? }`、`PersonaPicker`
- 公开面追加:`PersonaPicker`

- [ ] **Step 1: 写失败测试** — `web/src/features/agents/persona-picker.test.tsx`:

```tsx
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { PersonaPicker } from "./persona-picker";
import { resetAgentsCaches } from "./use-agents-data";

const persona = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, owner_id: id.startsWith("builtin:") ? null : "12345678", name, intro: `${name} intro`, prompt: null, level: "B1", style: "friendly",
  voice: null, tools: ["lookup"], prompt_public: true, deep_think: false, disabled_at: null, created_at: null, updated_at: null, ...over,
});
const LIST = [persona("builtin:coach", "Emma"), persona("builtin:interviewer", "Jack", { disabled_at: "2026-10-12T00:00:00Z" }), persona("p1", "Quiz")];

function setup(props: Partial<React.ComponentProps<typeof PersonaPicker>> = {}, max = 10) {
  const mock = createFetchMock({
    "GET /api/agents/config": () => json({ enabled: true, tutor_enabled: true, memory_enabled: true, rooms_enabled: true, prompt_max_chars: 800, personas_max: max }),
    "GET /api/agents/personas": () => json({ personas: LIST }),
  });
  const onSelect = vi.fn();
  renderWithProviders(<PersonaPicker open onOpenChange={() => undefined} selectedId="builtin:coach" onSelect={onSelect} allowNone {...props} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return { mock, onSelect };
}

describe("PersonaPicker (mockup 5)", () => {
  beforeEach(() => resetAgentsCaches());

  it("lists built-in and my personas with badges, filters by tab and marks the selected one", async () => {
    setup();
    const emma = await screen.findByTestId("agent-persona-builtin:coach");
    expect(emma).toHaveAttribute("aria-checked", "true");
    expect(emma).toHaveTextContent("Built-in");
    expect(screen.getByTestId("agent-persona-p1")).toHaveTextContent("Mine");
    expect(screen.getByTestId("agent-persona-builtin:interviewer")).toBeDisabled();
    expect(screen.getByTestId("agent-persona-builtin:interviewer")).toHaveTextContent("Disabled");
    await userEvent.click(screen.getByTestId("agent-picker-tab-mine"));
    expect(screen.queryByTestId("agent-persona-builtin:coach")).toBeNull();
    expect(screen.getByTestId("agent-persona-p1")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-persona-none")).toBeNull();
  });

  it("selects a persona or no persona", async () => {
    const { onSelect } = setup();
    await userEvent.click(await screen.findByTestId("agent-persona-p1"));
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: "p1", name: "Quiz" }));
    await userEvent.click(screen.getByTestId("agent-persona-none"));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("disables creating at the limit and shows the visibility note (D3)", async () => {
    setup({}, 1);
    const create = await screen.findByTestId("agent-persona-create");
    expect(create).toBeDisabled();
    expect(create).toHaveTextContent("Up to 1");
    expect(screen.getByText(/persona text if it is public/)).toBeInTheDocument();
  });

  it("opens the editor for my persona instead of a nested dialog", async () => {
    setup({ mode: "manage" });
    await userEvent.click(await screen.findByTestId("agent-persona-edit-p1"));
    const editor = await screen.findByTestId("agent-persona-editor");
    expect(within(editor).getByTestId("agent-editor-name")).toHaveValue("Quiz");
    expect(screen.queryByTestId("agent-persona-picker")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/agents/persona-picker.test.tsx`。

- [ ] **Step 3: 实现** — `web/src/features/agents/persona-picker.tsx`:

```tsx
import "./locales";
import { AlertTriangleIcon, CheckIcon, PencilIcon, PlusIcon, SparklesIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "~/components/avatar";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { IconButton } from "~/components/icon-button";
import { SegmentedControl } from "~/components/segmented-control";
import { cn } from "~/lib/cn";
import { PersonaEditorSheet } from "./persona-editor-sheet";
import { isBuiltin, type Persona } from "./types";
import { useAgentsConfig, usePersonas } from "./use-agents-data";

export type PickerTab = "all" | "builtin" | "mine";

export interface PersonaPickerProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  selectedId: string | null;
  onSelect?(persona: Persona | null): void;
  /** 显示「不使用角色」(对话、默认角色) */
  allowNone?: boolean;
  /** manage:点我的角色 = 编辑(设置页「我的角色」) */
  mode?: "select" | "manage";
  initialTab?: PickerTab;
}

const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function Badge({ builtin }: { builtin: boolean }) {
  const { t } = useTranslation();
  return (
    <span className={cn("flex-none rounded-[5px] px-1.5 text-label font-medium", builtin ? "bg-surface-2 text-ink-2" : "bg-blue-tint text-blue")}>
      {t(builtin ? "web.agents.picker.builtin" : "web.agents.picker.mine")}
    </span>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn("flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border-[1.5px]",
      on ? "border-blue bg-blue text-on-blue" : "border-hair")}>
      {on && <CheckIcon className="h-3.5 w-3.5" />}
    </span>
  );
}

/** 选择角色(视觉稿 5 屏):全部 / 内置 / 我的,创建入口;编辑器打开时本面板先关闭,不嵌套对话框。 */
export function PersonaPicker({ open, onOpenChange, selectedId, onSelect, allowNone = false, mode = "select", initialTab = "all" }: PersonaPickerProps) {
  const { t } = useTranslation();
  const { config } = useAgentsConfig();
  const { personas, state, reload } = usePersonas(open);
  const [tab, setTab] = useState<PickerTab>(initialTab);
  const [editing, setEditing] = useState<Persona | "new" | null>(null);
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  const all = personas ?? [];
  const mine = all.filter((p) => !isBuiltin(p));
  const list = all.filter((p) => tab === "all" || (tab === "builtin") === isBuiltin(p));
  const max = config?.personasMax ?? 10;
  const full = mine.length >= max;
  const select = mode === "select";

  return (
    <>
      <BottomSheet open={open && !editing} onOpenChange={onOpenChange}>
        <BottomSheetContent data-testid="agent-persona-picker" className="max-h-[85dvh] overflow-y-auto">
          <BottomSheetHeader title={t("web.agents.picker.title")} description={t("web.agents.picker.subtitle")} />
          <SegmentedControl label={t("web.agents.picker.tabsLabel")} value={tab} onChange={setTab} options={[
            { value: "all", label: t("web.agents.picker.all"), testId: "agent-picker-tab-all" },
            { value: "builtin", label: t("web.agents.picker.builtin"), testId: "agent-picker-tab-builtin" },
            { value: "mine", label: t("web.agents.picker.mine"), testId: "agent-picker-tab-mine" },
          ]} />
          {state === "error" && (
            <p role="alert" className="mt-3 flex items-center gap-2 text-sub text-ink-2">
              {t("web.agents.picker.loadFailed")}
              <button type="button" onClick={reload} className="min-h-tap font-semibold text-blue">{t("web.agents.common.retry")}</button>
            </p>
          )}
          <div role={select ? "radiogroup" : undefined} aria-label={t("web.agents.picker.title")} className="mt-2 divide-y-[0.5px] divide-hair-2">
            {allowNone && select && tab === "all" && (
              <button type="button" role="radio" aria-checked={selectedId === null} data-testid="agent-persona-none" onClick={() => onSelect?.(null)}
                className={cn("flex min-h-row w-full items-center gap-3 py-2 text-left", focusClass)}>
                <span aria-hidden className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-surface-2 text-ink-2">
                  <SparklesIcon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold text-ink">{t("web.agents.picker.none")}</span>
                  <span className="block truncate text-meta text-ink-2">{t("web.agents.picker.noneHint")}</span>
                </span>
                <Check on={selectedId === null} />
              </button>
            )}
            {list.map((p) => {
              const builtin = isBuiltin(p);
              const disabled = !!p.disabledAt;
              const editable = !builtin;
              const onRow = select ? () => onSelect?.(p) : editable ? () => setEditing(p) : undefined;
              return (
                <div key={p.id} className="flex items-center gap-1">
                  <button type="button" role={select ? "radio" : undefined} aria-checked={select ? p.id === selectedId : undefined}
                    data-testid={`agent-persona-${p.id}`} disabled={(select && disabled) || !onRow} onClick={onRow}
                    className={cn("flex min-h-row min-w-0 flex-1 items-center gap-3 py-2 text-left disabled:cursor-default", focusClass, select && disabled && "opacity-60")}>
                    <span aria-hidden className="flex-none"><Avatar name={p.name} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-body font-semibold text-ink">
                        <span className="truncate">{p.name}</span>
                        <Badge builtin={builtin} />
                        {disabled && <span className="flex-none rounded-[5px] bg-amber-tint px-1.5 text-label font-medium text-amber">{t("web.agents.chip.disabled")}</span>}
                      </span>
                      <span className="block truncate text-meta text-ink-2">{p.intro}</span>
                    </span>
                    {select && <Check on={p.id === selectedId} />}
                  </button>
                  {editable && (
                    <IconButton data-testid={`agent-persona-edit-${p.id}`} label={t("web.agents.picker.edit", { name: p.name })} className="text-ink-2" onClick={() => setEditing(p)}>
                      <PencilIcon />
                    </IconButton>
                  )}
                </div>
              );
            })}
          </div>
          {tab === "mine" && state === "ready" && mine.length === 0 && <p className="py-3 text-center text-meta text-ink-2">{t("web.agents.picker.empty")}</p>}
          {tab !== "builtin" && (
            <button type="button" data-testid="agent-persona-create" disabled={full} onClick={() => setEditing("new")}
              className={cn("mt-2.5 flex min-h-row w-full items-center gap-2.5 rounded-card border border-dashed border-hair px-3 text-body font-semibold text-blue disabled:opacity-50", focusClass)}>
              <PlusIcon aria-hidden className="h-[18px] w-[18px]" />{t("web.agents.picker.create")}
              {full && <span className="ml-auto text-meta font-normal text-ink-2">{t("web.agents.picker.limit", { max })}</span>}
            </button>
          )}
          <p className="mt-3.5 flex gap-2 rounded-[10px] bg-amber-tint px-3 py-2 text-meta text-amber">
            <AlertTriangleIcon aria-hidden className="mt-px h-4 w-4 flex-none" />{t("web.agents.picker.note")}
          </p>
        </BottomSheetContent>
      </BottomSheet>
      <PersonaEditorSheet open={!!editing} persona={editing === "new" ? null : editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        onSaved={(p) => {
          const created = editing === "new";
          setEditing(null);
          reload();
          if (select && created) onSelect?.(p);
        }}
        onDeleted={() => { setEditing(null); reload(); }} />
    </>
  );
}
```

`lazy-parts.tsx` 追加:`export const PersonaPicker = part<import("./persona-picker").PersonaPickerProps>(() => import("./persona-picker").then((m) => m.PersonaPicker));`
`index.ts` 追加:`export { PersonaPicker } from "./lazy-parts";`

- [ ] **Step 4: 跑测试** — `yarn web:typecheck && cd web && yarn vitest run src/features/agents`。
- [ ] **Step 5: 提交** — `feat(web): persona picker with built-in and my personas`。

### Task W4: 举报角色

**Files:**
- Create: `web/src/features/agents/{report-persona-sheet.tsx,report-persona-sheet.test.tsx}`
- Append: `lazy-parts.tsx`、`index.ts`

**Interfaces:**
- Produces:`ReportPersonaSheetProps { persona: Pick<Persona, "id" | "name"> | null, onClose(), onReported?() }`、`ReportPersonaSheet`(A5 在房间里给非本人角色使用;A4 只提供组件)
- 公开面追加:`ReportPersonaSheet`

- [ ] **Step 1: 写失败测试**

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ReportPersonaSheet } from "./report-persona-sheet";

describe("ReportPersonaSheet (spec §9.1)", () => {
  it("sends a reason and an optional note, then thanks the user and closes", async () => {
    const success = vi.spyOn(toast, "success");
    const mock = createFetchMock({ "POST /api/agents/personas/p%3A1/report": () => json({ ok: true }) });
    const onClose = vi.fn();
    renderWithProviders(<ReportPersonaSheet persona={{ id: "p:1", name: "Quiz" }} onClose={onClose} />,
      { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    expect(screen.getByTestId("agent-report-submit")).toBeDisabled();
    await userEvent.click(screen.getByTestId("agent-report-reason-offensive"));
    await userEvent.type(screen.getByTestId("agent-report-note"), "rude");
    await userEvent.click(screen.getByTestId("agent-report-submit"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ reason: "offensive", note: "rude" });
    expect(success).toHaveBeenCalledWith("Report sent. An admin will review it.");
  });

  it("keeps the sheet open with an error when sending fails", async () => {
    const mock = createFetchMock({ "POST /api/agents/personas/p1/report": () => json({ error: "x" }, 500) });
    const onClose = vi.fn();
    renderWithProviders(<ReportPersonaSheet persona={{ id: "p1", name: "Quiz" }} onClose={onClose} />,
      { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await userEvent.click(screen.getByTestId("agent-report-reason-spam"));
    await userEvent.click(screen.getByTestId("agent-report-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not send the report.");
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/agents/report-persona-sheet.test.tsx`。

- [ ] **Step 3: 实现** — `web/src/features/agents/report-persona-sheet.tsx`:

```tsx
import "./locales";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { cn } from "~/lib/cn";
import { agentsApi, type ReportReason } from "./agents-api";
import type { Persona } from "./types";

const REASONS: readonly ReportReason[] = ["unsafe", "offensive", "spam", "other"];
export const REPORT_NOTE_MAX = 200;

export interface ReportPersonaSheetProps {
  persona: Pick<Persona, "id" | "name"> | null;
  onClose(): void;
  onReported?(): void;
}

/** 举报角色(联机里成员可举报,spec §9.1)。只发原因与可选说明,不附带任何对话内容。 */
export function ReportPersonaSheet({ persona, onClose, onReported }: ReportPersonaSheetProps) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setReason(null);
    setNote("");
    setFailed(false);
  }, [persona?.id]);

  const submit = async () => {
    if (!persona || !reason || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await agentsApi.reportPersona(api, persona.id, { reason, ...(note.trim() ? { note: note.trim() } : {}) });
      toast.success(t("web.agents.report.done"));
      onReported?.();
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={!!persona} onOpenChange={(open) => { if (!open) onClose(); }}>
      <BottomSheetContent data-testid="agent-report-sheet" className="max-h-[85dvh] overflow-y-auto">
        <BottomSheetHeader title={t("web.agents.report.title")} description={persona?.name} />
        <p className="mb-1.5 text-meta text-ink-2" id="agent-report-reason">{t("web.agents.report.reason")}</p>
        <div role="radiogroup" aria-labelledby="agent-report-reason" className="divide-y-[0.5px] divide-hair-2 overflow-hidden rounded-card border-[0.5px] border-hair">
          {REASONS.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={reason === r} data-testid={`agent-report-reason-${r}`} onClick={() => setReason(r)}
              className={cn("flex min-h-row w-full items-center px-3 text-left text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                reason === r ? "font-semibold text-blue" : "text-ink")}>
              {t(`web.agents.report.reasons.${r}`)}
            </button>
          ))}
        </div>
        <label className="mt-3.5 block">
          <span className="mb-1.5 block text-meta text-ink-2">{t("web.agents.report.note")}</span>
          <textarea data-testid="agent-report-note" rows={3} maxLength={REPORT_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)}
            className="w-full resize-none rounded-[12px] border-0 bg-surface-2 px-3 py-2.5 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/30" />
        </label>
        {failed && <p role="alert" className="mt-2 text-sub text-red">{t("web.agents.report.failed")}</p>}
        <button type="button" data-testid="agent-report-submit" disabled={!reason || busy} onClick={() => void submit()}
          className="mt-3.5 h-12 w-full rounded-button bg-blue text-body font-semibold text-on-blue disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("web.agents.report.submit")}
        </button>
      </BottomSheetContent>
    </BottomSheet>
  );
}
```

`lazy-parts.tsx` 追加:`export const ReportPersonaSheet = part<import("./report-persona-sheet").ReportPersonaSheetProps>(() => import("./report-persona-sheet").then((m) => m.ReportPersonaSheet));`
`index.ts` 追加:`export { ReportPersonaSheet } from "./lazy-parts";`

- [ ] **Step 4: 跑测试** — `yarn web:typecheck && cd web && yarn vitest run src/features/agents`。
- [ ] **Step 5: 提交** — `feat(web): report persona sheet`。

### Task W5: 智能体设置页 `/me/agents` 与「我的」一行

**Files:**
- Create: `web/src/features/agents/{agent-settings-page.tsx,agent-settings-page.test.tsx,me-row.tsx,me-row.test.tsx}`
- Append: `lazy-parts.tsx`、`index.ts`

**Interfaces:**
- Produces:`AgentSettingsPage`(无 props)、`AgentsMeRow`(无 props)
- Consumes:`GET|PATCH /api/agents/settings`、A2 的 `/me/agents/memory` 路由
- 公开面追加:`AgentSettingsPage`(页面占位 fallback)、`AgentsMeRow`

- [ ] **Step 1: 写失败测试**

`web/src/features/agents/agent-settings-page.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { AgentSettingsPage } from "./agent-settings-page";
import { resetAgentsCaches } from "./use-agents-data";

const CONFIG = { enabled: true, tutor_enabled: true, memory_enabled: true, rooms_enabled: true, prompt_max_chars: 800, personas_max: 10 };
const SETTINGS = {
  tools: { lookup: true, learned_words: true, weak_words: true, due_words: true, memory: true },
  memory_enabled: true, share_in_rooms: true, show_process: true, default_persona_id: "builtin:coach", tutor: { length: 8, mix: ["ask", "words"] },
};
const PERSONAS = { personas: [{ id: "builtin:coach", owner_id: null, name: "Emma", intro: "Coach", prompt: null, level: "B1", style: "friendly", voice: null,
  tools: ["lookup"], prompt_public: true, deep_think: false, disabled_at: null, created_at: null, updated_at: null }] };

function setup(extra: Record<string, Handler> = {}) {
  const mock = createFetchMock({
    "GET /api/agents/config": () => json(CONFIG),
    "GET /api/agents/settings": () => json(SETTINGS),
    "GET /api/agents/personas": () => json(PERSONAS),
    ...extra,
  });
  renderWithProviders(<AgentSettingsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/me/agents" });
  return mock;
}

describe("AgentSettingsPage (spec §4.3, D2)", () => {
  beforeEach(() => resetAgentsCaches());

  it("shows every global tool on, the default persona, the room warning and the memory link", async () => {
    setup();
    for (const key of ["lookup", "learned_words", "weak_words", "due_words", "memory"]) {
      expect(await screen.findByTestId(`agent-setting-tool-${key}`)).toHaveAttribute("data-state", "checked");
    }
    expect(screen.getByTestId("agent-setting-default-persona")).toHaveTextContent("Emma");
    expect(screen.getByText(/Replies in a room are visible to everyone/)).toBeInTheDocument();
    expect(screen.getByTestId("agent-setting-memory-manage")).toHaveAttribute("href", "/me/agents/memory");
    expect(screen.getByTestId("agent-setting-tutor-length")).toHaveValue("8");
  });

  it("saves a switch optimistically as snake_case and rolls back when saving fails", async () => {
    let fail = false;
    const mock = setup({ "PATCH /api/agents/settings": (call) => (fail ? json({ error: "x" }, 500) : json({ ...SETTINGS, ...JSON.parse(String(call.body)) })) });
    const show = await screen.findByTestId("agent-setting-show-process");
    await userEvent.click(show);
    await waitFor(() => expect(show).toHaveAttribute("data-state", "unchecked"));
    expect(JSON.parse(String(mock.calls.find((c) => c.method === "PATCH")!.body))).toEqual({ show_process: false });
    fail = true;
    await userEvent.click(screen.getByTestId("agent-setting-tool-weak_words"));
    await waitFor(() => expect(screen.getByTestId("agent-setting-tool-weak_words")).toHaveAttribute("data-state", "checked"));
    expect(JSON.parse(String(mock.calls.filter((c) => c.method === "PATCH")[1].body))).toEqual({ tools: { weak_words: false } });
  });

  it("keeps at least one tutor question type", async () => {
    const mock = setup({ "PATCH /api/agents/settings": (call) => json({ ...SETTINGS, ...JSON.parse(String(call.body)) }) });
    await userEvent.click(await screen.findByTestId("agent-setting-kind-words"));
    await waitFor(() => expect(mock.calls.filter((c) => c.method === "PATCH")).toHaveLength(1));
    expect(screen.getByTestId("agent-setting-kind-ask")).toBeDisabled();
  });

  it("explains when agents are off", async () => {
    setup({ "GET /api/agents/config": () => json({ ...CONFIG, enabled: false }) });
    expect(await screen.findByText("Agents are not enabled on this server.")).toBeInTheDocument();
  });
});
```

`web/src/features/agents/me-row.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { AgentsMeRow } from "./me-row";

const render = (enabled: boolean) => renderWithProviders(<AgentsMeRow />, { api: new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock({
  "GET /api/agents/config": () => (enabled ? json({ enabled, tutor_enabled: true, memory_enabled: true, rooms_enabled: true, prompt_max_chars: 800, personas_max: 10 }) : json({ error: "Not Found" }, 404)),
}).fetch }) });

describe("AgentsMeRow", () => {
  it("links to /me/agents when agents are on", async () => {
    render(true);
    expect(await screen.findByTestId("me-agents")).toHaveAttribute("href", "/me/agents");
  });
  it("renders nothing when agents are off or the server is old", async () => {
    render(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("me-agents")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/agents/agent-settings-page.test.tsx src/features/agents/me-row.test.tsx`。

- [ ] **Step 3: 实现**

`web/src/features/agents/me-row.tsx`:

```tsx
import "./locales";
import { BotIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconChip } from "~/components/icon-chip";
import { ListRow } from "~/components/section-group";
import { useAgentsConfig } from "./use-agents-data";

/** 「我的 → 学习」里的一行;智能体关闭或旧服务端时不渲染。 */
export function AgentsMeRow() {
  const { t } = useTranslation();
  const { config } = useAgentsConfig();
  if (!config?.enabled) return null;
  return (
    <ListRow icon={<IconChip tone="gray" icon={BotIcon} />} title={t("web.agents.meRow.title")} subtitle={t("web.agents.meRow.hint")}
      to="/me/agents" testId="me-agents" />
  );
}
```

`web/src/features/agents/agent-settings-page.tsx`:

```tsx
import "./locales";
import {
  BookOpenIcon, BookmarkIcon, BrainIcon, CalendarClockIcon, EyeIcon, FlameIcon, GraduationCapIcon, UsersIcon, UserRoundIcon, type LucideIcon,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Switch } from "@renderer/components/ui/switch";
import { useAuth } from "~/auth/auth-context";
import { FeatureGate, type GateState } from "~/components/feature-gate";
import { IconChip } from "~/components/icon-chip";
import { ListRow, SectionGroup } from "~/components/section-group";
import type { Tone } from "~/components/tone";
import { PageHeader } from "~/layout/page-header";
import { cn } from "~/lib/cn";
import { agentsApi } from "./agents-api";
import { PersonaPicker } from "./persona-picker";
import { TOOL_FIELD, TOOL_KEYS, TUTOR_KINDS, type AgentSettings, type AgentSettingsPatch, type ToolKey, type TutorKind } from "./types";
import { useAgentSettings, useAgentsConfig, usePersonas } from "./use-agents-data";

const TOOL_ICON: Record<ToolKey, [LucideIcon, Tone]> = {
  lookup: [BookOpenIcon, "teal"], learned_words: [BookmarkIcon, "amber"], weak_words: [FlameIcon, "amber"], due_words: [CalendarClockIcon, "amber"], memory: [BrainIcon, "amber"],
};
const TUTOR_LENGTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function SwitchRow({ id, testId, icon, tone, title, hint, checked, onChange }: {
  id: string; testId: string; icon: LucideIcon; tone: Tone; title: ReactNode; hint?: ReactNode; checked: boolean; onChange(value: boolean): void;
}) {
  return (
    <div className="flex min-h-row items-center gap-3 py-2.5 pl-3.5 pr-3">
      <IconChip tone={tone} icon={icon} />
      <span className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-body font-medium tracking-[-0.005em] text-ink">{title}</label>
        {hint ? <span id={`${id}-hint`} className="mt-0.5 block text-meta text-ink-2">{hint}</span> : null}
      </span>
      <Switch id={id} data-testid={testId} checked={checked} onCheckedChange={onChange} aria-describedby={hint ? `${id}-hint` : undefined}
        className="hit-expand h-[26px] w-11 flex-none data-[state=checked]:bg-blue data-[state=unchecked]:bg-surface-2 data-[state=unchecked]:shadow-hair" />
    </div>
  );
}

/** 智能体设置(spec §4.3、D2):全局工具开关(默认全开)、记忆、联机共享、显示过程、默认角色、带我学默认值;记忆页由 A2 提供。 */
export function AgentSettingsPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const id = useId();
  const { config, state: configState, retry: retryConfig } = useAgentsConfig();
  const enabled = !!config?.enabled;
  const { settings, state: settingsState, setSettings, retry: retrySettings } = useAgentSettings(enabled);
  const { personas } = usePersonas(enabled);
  const [picker, setPicker] = useState<"default" | "manage" | null>(null);

  const gate: GateState = configState === "loading" ? "loading" : configState === "error" ? "error" : !enabled ? "disabled"
    : settings ? "ready" : settingsState === "error" ? "error" : "loading";

  /** 乐观更新:先显示新值,PATCH 失败退回原值并提示。 */
  const save = (patch: AgentSettingsPatch, next: AgentSettings) => {
    const prev = settings;
    setSettings(next);
    agentsApi.patchSettings(api, patch).then(setSettings, () => {
      if (prev) setSettings(prev);
      toast.error(t("web.agents.settings.saveFailed"));
    });
  };
  const defaultName = personas?.find((p) => p.id === settings?.defaultPersonaId)?.name;

  return (
    <div>
      <PageHeader title={t("web.agents.settings.title")} back="/me" />
      <div className="px-gutter pb-6">
        <FeatureGate state={gate} disabledText={t("web.agents.settings.disabled")} onRetry={() => { retryConfig(); retrySettings(); }}>
          {settings && config && (
            <>
              <SectionGroup title={t("web.agents.settings.groups.personas")}>
                <ListRow icon={<IconChip tone="gray" icon={UserRoundIcon} />} title={t("web.agents.settings.defaultPersona")}
                  value={<span data-testid="agent-setting-default-persona">{defaultName ?? t("web.agents.settings.defaultNone")}</span>}
                  onClick={() => setPicker("default")} />
                <ListRow icon={<IconChip tone="gray" icon={UserRoundIcon} />} title={t("web.agents.settings.myPersonas")}
                  subtitle={t("web.agents.settings.myPersonasHint")} onClick={() => setPicker("manage")} testId="agent-setting-my-personas" />
              </SectionGroup>

              <SectionGroup title={t("web.agents.settings.groups.tools")}>
                {TOOL_KEYS.map((key) => {
                  const field = TOOL_FIELD[key];
                  const [icon, tone] = TOOL_ICON[key];
                  return (
                    <SwitchRow key={key} id={`${id}-tool-${key}`} testId={`agent-setting-tool-${key}`} icon={icon} tone={tone}
                      title={t(`web.agents.tools.${key}`)} hint={t(`web.agents.toolHints.${key}`)} checked={settings.tools[field]}
                      onChange={(on) => save({ tools: { [field]: on } }, { ...settings, tools: { ...settings.tools, [field]: on } })} />
                  );
                })}
              </SectionGroup>
              <p className="mx-0.5 mt-1.5 text-meta text-ink-2">{t("web.agents.settings.toolsHint")}</p>

              {config.memoryEnabled && (
                <SectionGroup title={t("web.agents.settings.groups.memory")}>
                  <SwitchRow id={`${id}-memory`} testId="agent-setting-memory" icon={BrainIcon} tone="amber" title={t("web.agents.settings.memoryEnabled")}
                    hint={t("web.agents.settings.memoryEnabledHint")} checked={settings.memoryEnabled}
                    onChange={(memoryEnabled) => save({ memoryEnabled }, { ...settings, memoryEnabled })} />
                  <ListRow icon={<IconChip tone="gray" icon={BrainIcon} />} title={t("web.agents.settings.memoryManage")} to="/me/agents/memory" testId="agent-setting-memory-manage" />
                </SectionGroup>
              )}

              {config.roomsEnabled && (
                <SectionGroup title={t("web.agents.settings.groups.rooms")}>
                  <SwitchRow id={`${id}-share`} testId="agent-setting-share-in-rooms" icon={UsersIcon} tone="amber" title={t("web.agents.settings.shareInRooms")}
                    checked={settings.shareInRooms} onChange={(shareInRooms) => save({ shareInRooms }, { ...settings, shareInRooms })} />
                  <p className="mx-3.5 mb-3 rounded-[10px] bg-amber-tint px-3 py-2 text-meta text-amber">{t("web.agents.settings.shareWarning")}</p>
                </SectionGroup>
              )}

              <SectionGroup title={t("web.agents.settings.groups.display")}>
                <SwitchRow id={`${id}-process`} testId="agent-setting-show-process" icon={EyeIcon} tone="gray" title={t("web.agents.settings.showProcess")}
                  hint={t("web.agents.settings.showProcessHint")} checked={settings.showProcess}
                  onChange={(showProcess) => save({ showProcess }, { ...settings, showProcess })} />
              </SectionGroup>

              {config.tutorEnabled && (
                <SectionGroup title={t("web.agents.settings.groups.tutor")}>
                  <label className="flex min-h-row items-center gap-3 py-2.5 pl-3.5 pr-3">
                    <IconChip tone="blue" icon={GraduationCapIcon} />
                    <span className="min-w-0 flex-1 text-body font-medium text-ink">{t("web.agents.settings.tutorLength")}</span>
                    <select data-testid="agent-setting-tutor-length" value={String(settings.tutor.length)}
                      className="min-h-tap rounded-[10px] bg-surface-2 px-2 text-base text-ink"
                      onChange={(e) => {
                        const length = Number(e.target.value);
                        save({ tutor: { length } }, { ...settings, tutor: { ...settings.tutor, length } });
                      }}>
                      {TUTOR_LENGTHS.map((n) => <option key={n} value={String(n)}>{t("web.agents.settings.tutorLengthValue", { count: n })}</option>)}
                    </select>
                  </label>
                  <div className="px-3.5 pb-3 pt-1">
                    <p className="mb-2 text-meta text-ink-2">{t("web.agents.settings.tutorMix")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {TUTOR_KINDS.map((kind: TutorKind) => {
                        const on = settings.tutor.mix.includes(kind);
                        const last = on && settings.tutor.mix.length === 1;
                        return (
                          <button key={kind} type="button" aria-pressed={on} disabled={last} data-testid={`agent-setting-kind-${kind}`}
                            className={cn("hit-expand h-8 rounded-full px-3 text-sub transition-colors duration-fast disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              on ? "bg-blue-tint font-semibold text-blue" : "bg-surface-2 text-ink-2")}
                            onClick={() => {
                              const mix = on ? settings.tutor.mix.filter((k) => k !== kind) : TUTOR_KINDS.filter((k) => k === kind || settings.tutor.mix.includes(k));
                              save({ tutor: { mix } }, { ...settings, tutor: { ...settings.tutor, mix } });
                            }}>
                            {t(`web.agents.settings.kinds.${kind}`)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </SectionGroup>
              )}
            </>
          )}
        </FeatureGate>
      </div>
      {settings && (
        <PersonaPicker open={picker !== null} onOpenChange={(o) => { if (!o) setPicker(null); }}
          mode={picker === "manage" ? "manage" : "select"} initialTab={picker === "manage" ? "mine" : "all"} allowNone
          selectedId={settings.defaultPersonaId}
          onSelect={(p) => {
            setPicker(null);
            const defaultPersonaId = p?.id ?? null;
            save({ defaultPersonaId }, { ...settings, defaultPersonaId });
          }} />
      )}
    </div>
  );
}
```

`lazy-parts.tsx` 追加:

```tsx
export const AgentSettingsPage = part<object>(() => import("./agent-settings-page").then((m) => m.AgentSettingsPage), pageFallback);
export const AgentsMeRow = part<object>(() => import("./me-row").then((m) => m.AgentsMeRow));
```

`index.ts` 追加:`export { AgentSettingsPage, AgentsMeRow } from "./lazy-parts";`

- [ ] **Step 4: 跑测试** — `yarn web:typecheck && cd web && yarn vitest run src/features/agents`。
- [ ] **Step 5: 提交** — `feat(web): agent settings page and me row`。

---

## Nav lane (N) — N2 先于 I 车道合并

### Task N2: E2E 防漏守卫放行智能体的数据库端点

**Files:**
- Modify: `web/e2e/support/upstream-guard.ts`、`web/src/test/e2e-upstream-guard.test.ts`

- [ ] **Step 1: 改测试** — `e2e-upstream-guard.test.ts` 第一张表末尾追加:

```ts
    // 智能体(AGENTS_ENABLED 的 E2E 栈,agents-web N2):对话页加载时请求 /config;设置与角色只读写数据库
    "/api/agents/config", "/api/agents/settings", "/api/agents/personas", "/api/agents/personas/p1", "/api/agents/personas/builtin%3Acoach",
    "/api/agents/personas/p1/report",
```

第二张表末尾追加:

```ts
    // 回合、试聊、导师开始会触达 LLM:不放行(E2E 里用 page.route 模拟)
    "/api/agents/turn", "/api/agents/personas/try", "/api/agents/tutor/start", "/api/agents", "/api/agents/configx",
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/test/e2e-upstream-guard.test.ts`。

- [ ] **Step 3: 实现** — `upstream-guard.ts` 在 `OWN_LINKS` 定义之后追加,并在 `isOwnBackendPath` 的返回式末尾加 `|| OWN_AGENTS.test(pathname)`:

```ts
// 智能体(AGENTS_ENABLED):对话页每次加载请求 /config;设置、角色增删改与举报只读写数据库。
// /turn、/personas/try(LLM)与 /tutor/*(可能出题调用 LLM)不放行;记忆端点由 agents-memory 计划追加。
const OWN_AGENTS = /^\/api\/agents\/(config|settings|personas|personas\/(?!try$)[^/]+|personas\/[^/]+\/report)$/;
```

- [ ] **Step 4: 跑测试** — `cd web && yarn vitest run src/test/e2e-upstream-guard.test.ts && yarn web:typecheck`。
- [ ] **Step 5: 提交** — `test(e2e): let the agents config, settings and persona routes through the upstream guard`。

---

## Chat integration lane (I)

### Task I1: 对话类型、气泡插槽与存储过程的渲染;冻结边 `chat->agents`

**Files:**
- Modify: `web/src/features/chat/{chat-api.ts,ui-message.ts,message-bubble.tsx}`、`web/src/architecture.test.ts`
- Create: `web/src/features/chat/ui-message.agent.test.ts`

**Interfaces:**
- Produces:`ConversationConfig.agentPersonaId?: string`;`ChatMessage.agentTrace?: AgentTrace | null`;`NewMessage` 可带 `agentTrace`;`UiMessage.agent?: AgentView`;`fromServerMessage` 把助手消息的 `agentTrace` 放进 `agent.trace`;`MessageBubble` 新 props `before?: ReactNode`、`after?: ReactNode`(只用于助手气泡,不传时 DOM 不变)

- [ ] **Step 1: 写失败测试**

`web/src/features/chat/ui-message.agent.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fromServerMessage } from "./ui-message";

const TRACE = { v: 1, ms: 3000, steps: [], thought: null };

describe("fromServerMessage with agent traces (spec §4.4)", () => {
  it("puts a stored assistant trace on the bubble; user messages and old replies are unchanged", () => {
    expect(fromServerMessage({ id: "m2", conversationId: "c1", role: "assistant", content: "Hi", createdAt: "", agentTrace: TRACE }))
      .toEqual({ key: "m2", id: "m2", role: "assistant", content: "Hi", status: "done", agent: { trace: TRACE } });
    expect(fromServerMessage({ id: "m3", conversationId: "c1", role: "assistant", content: "Old", createdAt: "" }))
      .toEqual({ key: "m3", id: "m3", role: "assistant", content: "Old", status: "done" });
    expect(fromServerMessage({ id: "m1", conversationId: "c1", role: "user", content: "Q", createdAt: "", agentTrace: TRACE }))
      .not.toHaveProperty("agent");
  });
});
```

`architecture.test.ts`:在 `"guards plugins, register files and the cross-feature baseline"` 用例末尾追加两行:

```ts
    expect(violationsOf("features/chat/x.tsx", 'import { ProcessCapsule } from "~/features/agents";')).toEqual([]);
    expect(violationsOf("features/agents/x.tsx", 'import { VoicePicker } from "~/features/chat";')).toHaveLength(1);
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/chat/ui-message.agent.test.ts src/architecture.test.ts`(`chat->agents` 不在基线)。

- [ ] **Step 3: 实现**

`architecture.test.ts`:`CROSS_FEATURE_BASELINE` 的 `"chat->grammar", "chat->lookup", "chat->practice", "chat->realtime",` 之后追加 `"chat->agents",`;集合后的注释改为:

```ts
]); // L1 删去了五条 ->vocabulary / vocabulary->lookup 边(四处改用 <WordActions> 插槽);新增任何一条即失败。
// A4(agents-web R-W4):chat->agents —— 对话页用 agents 的过程胶囊、角色切换与回合客户端(spec 2026-10-12-agents §3.4、§9.3);
// agents 是产品本身(不受 LINKS_ENABLED 控制),不能挂在扩展点上;agents 不导入任何 feature,所以没有桶循环。A5 再加 rooms->agents。
```

`it("the cross-feature baseline lists only edges that still exist")` 里 `toBe(16)` 改为 `toBe(17)`。

`chat-api.ts`:顶部加 `import type { AgentTrace } from "~/features/agents";`;`ConversationConfig` 末尾(`recap?: StoredRecap;` 之后)追加:

```ts
  /** 智能体角色(spec §9.3):有值时回复走 /api/agents/turn;缺省 = 旧路径完全不变(R-W12) */
  agentPersonaId?: string;
```

`ChatMessage` 末尾(`assessment?: …` 之后)追加:

```ts
  /** 智能体回复的压缩过程(messages.agent_trace,≤ 4 KB);旧消息没有 */
  agentTrace?: AgentTrace | null;
```

`NewMessage` 改为:

```ts
export type NewMessage = Pick<ChatMessage, "role" | "content"> & MessageResultFields & { agentTrace?: AgentTrace };
```

`ui-message.ts`:顶部加 `import type { AgentView } from "~/features/agents";`;`UiMessage` 末尾追加 `/** 智能体回复:生成中 live、完成后 trace、失败后的 retryId(R-W10) */ agent?: AgentView;`;`fromServerMessage` 的 `if (m.role !== "user") return ui;` 改为:

```ts
  if (m.role !== "user") {
    if (m.role === "assistant" && m.agentTrace) ui.agent = { trace: m.agentTrace };
    return ui;
  }
```

`message-bubble.tsx`:props 解构加 `before, after`,类型加:

```ts
  /** 助手气泡上方(过程胶囊)与下方(来源标签)的插槽;不传时 DOM 与原来相同 */
  before?: ReactNode;
  after?: ReactNode;
```

把 `<div className={cn("min-w-0 rounded-card px-3 pb-2 pt-2.5 …` 这一整块气泡(直到它的闭合 `</div>`)赋给 `const bubble = ( … );`(放在 `return` 之前),然后 `return` 里原位置换成:

```tsx
        {!isUser && (before || after) ? (
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            {before}
            {bubble}
            {after}
          </div>
        ) : bubble}
```

- [ ] **Step 4: 跑测试** — `yarn web:typecheck && cd web && yarn vitest run src/features/chat src/architecture.test.ts`(chat 全部原样通过)。
- [ ] **Step 5: 提交** — `feat(web): chat message types and bubble slots for agent traces`。

### Task I2: 智能体会话的回合路径与过程保存

**Files:**
- Modify: `web/src/features/chat/conversation-page.tsx`
- Create: `web/src/features/chat/conversation-page.agent.test.tsx`

**Interfaces:**
- Consumes:`runAgentTurn`、`ProcessCapsule`、`SourceChips`、`type AgentTrace`(`~/features/agents`)
- Produces(对话页内部):`TurnExtras.agentTurnId?`、`TurnExtras.solo?: "opening" | "regenerate"`、`PendingSave.trace?`

- [ ] **Step 1: 写失败测试** — `web/src/features/chat/conversation-page.agent.test.tsx`:

```tsx
import "fake-indexeddb/auto";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import { resetAgentsCaches } from "~/features/agents/use-agents-data";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { COMPOSER_MODE_KEY } from "./composer-mode";
import { ConversationPage } from "./conversation-page";

const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const sse = (parts: string[]) => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(enc.encode(p))); c.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
};
const STEP = { id: "s1", group: "tool", key: "word_lookup", status: "done", label_key: "agents.step.word_lookup", params: { word: "give up" }, ms: 90, private: false };
const TRACE = { v: 1, ms: 3200, steps: [STEP], thought: null };
const HAPPY = [ev("start", { turn_id: "t1" }), ev("step", { ...STEP, status: "run" }), ev("step", STEP), ev("delta", { text: "Hello " }),
  ev("delta", { text: "there!" }), ev("done", { trace: TRACE, text_len: 12 })];
const CONFIG = { system_prompt: "SYS", model: "gpt-4o", temperature: 0.7, tts_model: "openai/tts-1", tts_voice: "alloy" };
const AGENTS = { enabled: true, tutor_enabled: true, memory_enabled: true, rooms_enabled: true, prompt_max_chars: 800, personas_max: 10 };
const PERSONAS = { personas: [{ id: "builtin:coach", owner_id: null, name: "Emma", intro: "Coach", prompt: null, level: "B1", style: "friendly",
  voice: null, tools: ["lookup"], prompt_public: true, deep_think: false, disabled_at: null, created_at: null, updated_at: null }] };

function routes(extra: Record<string, Handler> = {}, agentConfig: Record<string, unknown> = { ...CONFIG, agent_persona_id: "builtin:coach" }): Record<string, Handler> {
  return {
    "GET /api/config/gpt_providers": () => json({ enjoyai: { models: ["gpt-4o"] } }),
    "GET /api/config/default_gpt_preset": () => json({ configuration: { model: "gpt-4o" } }),
    "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: ["openai/tts-1"], voices: { openai: ["alloy"] } } }),
    "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "openai/tts-1", voice: "alloy" } } }),
    "GET /api/conversations/c1": () => json({ id: "c1", name: "Trip", config: agentConfig }),
    "GET /api/conversations/c1/messages": () => json({ messages: [{ id: "m0", conversation_id: "c1", role: "assistant", content: "Earlier reply" }] }),
    "GET /api/realtime/config": () => json({ enabled: false, max_minutes: 10, idle_timeout_seconds: 60, asr_mode: "buffered", sample_rate_in: 16000, sample_rate_out: 24000 }),
    "GET /api/agents/config": () => json(AGENTS),
    "GET /api/agents/personas": () => json(PERSONAS),
    "GET /api/agents/settings": () => json({ error: "Not Found" }, 404),
    "POST /api/ai/audio/speech": () => new Response(new Uint8Array([1])),
    "POST /api/conversations/c1/messages": () => json({ messages: [{ id: "m1" }, { id: "m2" }] }),
    "PATCH /api/conversations/c1": () => json({ id: "c1", name: "Hi", config: agentConfig }),
    ...extra,
  };
}
function setup(r: Record<string, Handler>) {
  const mock = createFetchMock(r);
  renderWithProviders(<ConversationPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat/c1", path: "/chat/:id" });
  return mock;
}
const callsTo = (mock: ReturnType<typeof createFetchMock>, method: string, path: string) => mock.calls.filter((c) => c.method === method && c.url.pathname === path);
const bodyOf = (call: { body: BodyInit | null | undefined }) => JSON.parse(String(call.body));
async function say(text: string) {
  await userEvent.type(await screen.findByTestId("chat-input"), text);
  await userEvent.click(screen.getByTestId("chat-send"));
}

beforeAll(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:tts"), revokeObjectURL: vi.fn() });
  Object.assign(HTMLMediaElement.prototype, { pause: vi.fn(), play: vi.fn(() => Promise.resolve()) });
});

describe("ConversationPage with a persona (spec §9.3, R-W12)", () => {
  beforeEach(() => { resetServerAiConfigCache(); resetAgentsCaches(); localStorage.removeItem(COMPOSER_MODE_KEY); });

  it("streams the reply from /api/agents/turn, never the old completions path, and saves the trace with the assistant message", async () => {
    const mock = setup(routes({ "POST /api/agents/turn": () => sse(HAPPY) }));
    await screen.findByText("Earlier reply");
    await say("Hi");
    await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Hello there!"));
    expect(callsTo(mock, "POST", "/api/ai/chat/completions")).toHaveLength(0);
    const turn = callsTo(mock, "POST", "/api/agents/turn")[0];
    expect(turn.url.search).toBe("");
    expect(bodyOf(turn)).toMatchObject({
      persona_id: "builtin:coach", conversation_id: "c1", text: "Hi", mode: "chat", tutor_session_id: null,
      history: [{ role: "assistant", content: "Earlier reply" }],
    });
    await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(1));
    expect(bodyOf(callsTo(mock, "POST", "/api/conversations/c1/messages")[0])).toEqual({ messages: [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello there!", agent_trace: { v: 1, ms: 3200, steps: [STEP], thought: null } },
    ] });
    expect(await screen.findByTestId("agent-capsule")).toHaveTextContent("Thought for 3s · used 1 tool");
    expect(await screen.findByTestId("agent-source")).toHaveTextContent("Dictionary · give up");
  });

  it("feeds the same deltas into auto-speak: the finished sentence is spoken", async () => {
    const mock = setup(routes({ "POST /api/agents/turn": () => sse(HAPPY) }));
    await screen.findByText("Earlier reply");
    await say("Hi");
    await waitFor(() => expect(callsTo(mock, "POST", "/api/ai/audio/speech").length).toBeGreaterThan(0));
  });

  it("shows the translated error and retries a server error as a new turn, a dropped stream with the same id", async () => {
    let n = 0;
    const mock = setup(routes({ "POST /api/agents/turn": () => {
      n += 1;
      if (n === 1) return sse([ev("error", { code: "limit" })]);
      if (n === 2) return sse([ev("start", { turn_id: "t2" }), ev("delta", { text: "Hel" })]);
      return sse(HAPPY);
    } }));
    await screen.findByText("Earlier reply");
    await say("Hi");
    expect(await screen.findByText("You have reached today's agent limit. Try again tomorrow.")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("message-retry"));
    expect(await screen.findByText("The connection dropped before the reply finished. Retry to get it.")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("message-retry"));
    await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Hello there!"));
    const ids = callsTo(mock, "POST", "/api/agents/turn").map((c) => bodyOf(c).client_turn_id);
    expect(ids[1]).not.toBe(ids[0]);
    expect(ids[2]).toBe(ids[1]);
    expect(screen.getAllByTestId("message-user")).toHaveLength(1);
  });

  it("renders the collapsed capsule from a stored trace after reload", async () => {
    setup(routes({
      "GET /api/conversations/c1/messages": () => json({ messages: [{ id: "m9", conversation_id: "c1", role: "assistant", content: "Stored", agent_trace: TRACE }] }),
    }));
    expect(await screen.findByTestId("agent-capsule")).toHaveTextContent("Thought for 3s · used 1 tool");
  });

  it("leaves a conversation without a persona on the old path", async () => {
    const mock = setup(routes({
      "POST /api/ai/chat/completions": () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "OK" } }] })}\n\ndata: [DONE]\n\n`),
    }, CONFIG));
    await screen.findByText("Earlier reply");
    await say("Hi");
    await waitFor(() => expect(callsTo(mock, "POST", "/api/ai/chat/completions")).toHaveLength(1));
    expect(callsTo(mock, "POST", "/api/agents/turn")).toHaveLength(0);
    await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(1));
    expect(bodyOf(callsTo(mock, "POST", "/api/conversations/c1/messages")[0])).toEqual({ messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "OK" }] });
    expect(screen.queryByTestId("agent-capsule")).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/chat/conversation-page.agent.test.tsx`。

- [ ] **Step 3: 实现**(`conversation-page.tsx`,只改下列位置)

(a) 导入:新增一行(`deleteMessage` 到 I4 再加进 `chat-api` 那组导入):

```ts
import { ProcessCapsule, SourceChips, runAgentTurn, type AgentTrace } from "~/features/agents";
```

(b) `interface TurnExtras` 末尾追加:

```ts
  /** 智能体回合重试时沿用的 client_turn_id(上一次是传输失败或 busy,R-W10) */
  agentTurnId?: string;
  /** 只有助手一条的回合:导师开场 / 继续(没有用户消息)或重新生成(用户消息已保存),R-W13 */
  solo?: "opening" | "regenerate";
```

(c) `interface PendingSave` 末尾追加 `/** 智能体回复的压缩过程,随助手消息保存 */ trace?: AgentTrace | null;`

(d) `saveOne` 里的 `post` 改为:

```ts
    const post = (f: MessageResultFields) => createMessages(api, entry.conversationId, [
      { role: "user", content: entry.content, ...f }, { role: "assistant", content: entry.reply, ...(entry.trace ? { agentTrace: entry.trace } : {}) }]);
```

(e) 用下面的 `send` 整体替换原 `send`(其余逻辑逐行保留,改动处有注释):

```ts
  const send = useCallback(async (text: string, base: UiMessage[], turn: TurnExtras = {}) => {
    const content = text.trim();
    const results = resultsRef.current;
    if ((!content && turn.solo !== "opening") || !conversation || !results || busyRef.current) return;
    busyRef.current = true;
    // R-W12:唯一的分岔点。没有角色的会话走原路径,请求与保存体不变
    const agentId = conversation.config.agentPersonaId;
    const gen = genRef.current;
    const history = base.filter((m) => m.status === "done").map(({ role, content: c }) => ({ role, content: c }));
    const userKey = turn.userKey ?? nextKey("u");
    const botKey = nextKey("a");
    const baseKeys = new Set(base.map((m) => m.key));
    const controller = new AbortController();
    abortRef.current = controller;
    autoSpeakBegin(botKey); // 之前的回复从此过期
    const live = () => mountedRef.current && !controller.signal.aborted;
    const patch = (key: string, change: Partial<UiMessage>) => {
      if (live()) setMessages((prev) => prev.map((m) => (m.key === key ? { ...m, ...change } : m)));
    };
    forceScrollRef.current = true;
    // 函数式更新:保留同一帧里刚到达的结果补丁;重试时沿用原用户气泡(含语音与评测状态)
    setMessages((prev) => {
      const previous = prev.find((m) => m.key === userKey);
      const user: UiMessage = { ...previous, key: userKey, role: "user", content, status: "done", ...(turn.voice ? { voice: turn.voice } : {}) };
      const bot: UiMessage = { key: botKey, role: "assistant", content: "", status: "streaming", ...(agentId ? { agent: { live: null } } : {}) };
      return [...prev.filter((m) => baseKeys.has(m.key) && m.key !== userKey), ...(turn.solo === "opening" ? [] : [user]), bot];
    });
    setSending(true);
    if (!turn.solo) {
      results.start(userKey, {
        text: content,
        wav: turn.wav,
        grammar: { enabled: optionsRef.current.grammarCheck, context: lastAssistantText(base) },
      }); // R1:与回复并行;同一 key 只发起一次(重试不重复评测)
    }
    const finish = () => {
      // 不清空 abortRef:保存/改名阶段切换会话时,清理函数仍能让 live() 变 false
      if (abortRef.current === controller) busyRef.current = false;
      if (live()) setSending(false);
    };
    const current = messagesRef.current.find((m) => m.key === userKey);
    const coach = optionsRef.current.coachMode ? coachNote(coachCandidates(base, current)) : null;
    let reply = "";
    let trace: AgentTrace | null = null;
    try {
      // 两条路径共用同一个增量回调:sentence-stream / 自动朗读收到的东西完全一样
      const onDelta = (full: string) => { patch(botKey, { content: full }); if (live()) autoSpeakProgress(botKey, full); };
      if (agentId) {
        const result = await runAgentTurn(api, {
          personaId: agentId, conversationId: conversation.id, text: turn.solo === "opening" ? null : content, history,
          mode: "chat", tutorSessionId: null, clientTurnId: turn.agentTurnId,
        }, { onDelta, onTrace: (l) => patch(botKey, { agent: { live: l } }) }, controller.signal);
        reply = result.text;
        trace = result.trace;
      } else {
        reply = await streamChatCompletion(api,
          { messages: buildChatMessages(config, history, content, HISTORY_LIMIT, coach), model: config.model, temperature: config.temperature },
          onDelta, controller.signal);
      }
      if (!reply.trim()) throw new ApiError(502, "Empty AI response");
      patch(botKey, { content: reply, status: "done", ...(agentId ? { agent: { trace } } : {}) });
      if (live()) autoSpeakComplete(botKey, reply, "done");
      if (optionsRef.current.bilingual && canTranslateRef.current && live()) showTranslation(botKey, reply);
    } catch (err) {
      // 离开页面/中止时 live() 为 false,patch 不生效,也不弹错误;
      // 流式失败:部分回复被错误气泡取代,且不保存;这一轮保持 open,等待重试或被丢弃
      const agentErr = err as { agentText?: string; retryId?: string } | null;
      const message = agentErr?.agentText ?? translateServerError(tRef.current, err, CHAT_SERVER_ERRORS);
      if (turn.solo) {
        // R-W13:只有助手一条的回合失败不留错误气泡(dropFailedTail 会连带丢掉前一条已保存的消息),只提示
        if (live()) {
          setMessages((prev) => prev.filter((m) => m.key !== botKey));
          toast.error(message);
        }
      } else {
        patch(botKey, { status: "error", content: message, ...(agentId ? { agent: agentErr?.retryId ? { retryId: agentErr.retryId } : undefined } : {}) });
      }
      if (live()) autoSpeakComplete(botKey, "", "error"); // 最终结果:这个 key 不再读
      finish();
      return;
    }
    finish();
    if (controller.signal.aborted) return;
    if (turn.solo) {
      // R-W13:排在已排队的保存之后,单独保存助手消息;失败只提示,不进带核对的重试队列
      await flushSaves();
      try {
        const { messages: saved } = await createMessages(api, conversation.id, [{ role: "assistant", content: reply, ...(trace ? { agentTrace: trace } : {}) }]);
        patchByKey(botKey, { id: saved[0]?.id });
        if (genRef.current === gen) knownTailRef.current = saved[0]?.id;
      } catch {
        if (live()) toast.error(tRef.current("web.chat.notSaved"));
      }
      return;
    }
    const entry: PendingSave = {
      gen, results, conversationId: conversation.id, userKey, botKey, content, reply, saved: false, trace,
    };
    pendingSavesRef.current.push(entry);
    syncPendingSaves();
    const outcome = await flushSaves();
    if (!entry.saved && !entry.dropped && outcome === "failed" && live()) toastNotSaved();
  }, [api, config, conversation, flushSaves, syncPendingSaves, showTranslation, toastNotSaved, autoSpeakBegin, autoSpeakComplete, autoSpeakProgress, patchByKey]);
```

(f) `retry` 里的 `void send(user.content, messages.slice(0, -2), { userKey: user.key });` 改为:

```ts
    void send(user.content, messages.slice(0, -2), { userKey: user.key, agentTurnId: last.agent?.retryId });
```

(g) 消息列表里 `<MessageBubble …` 增加两个 props(放在 `partnerName={partnerVoice}` 之后):

```tsx
              before={m.agent ? <ProcessCapsule live={m.agent.live} trace={m.agent.trace} generating={m.status === "streaming"} /> : null}
              after={m.agent?.trace ? <SourceChips trace={m.agent.trace} /> : null}
```

- [ ] **Step 4: 跑测试** — `yarn web:typecheck && cd web && yarn vitest run src/features/chat src/features/agents src/architecture.test.ts`(`conversation-page.test.tsx` 全部原样通过)。
- [ ] **Step 5: 提交** — `feat(web): agent conversations stream from /api/agents/turn and keep their trace`。

### Task I3: 顶栏角色控件与设置面板说明

**Files:**
- Create: `web/src/features/agents/{chat-parts.tsx,chat-parts.test.tsx}`
- Append: `web/src/features/agents/lazy-parts.tsx`、`web/src/features/agents/index.ts`
- Modify: `web/src/features/chat/{conversation-page.tsx,conversation-settings-sheet.tsx,conversation-page.test.tsx,i18n/en.json,i18n/zh-CN.json}`、`web/src/features/chat/conversation-page.agent.test.tsx`(追加一个用例)

**Interfaces:**
- Produces:`ChatPersonaControlProps { personaId, disabled, onChange(persona | null), onResolved?(persona | null) }`、`ChatPersonaControl`(公开面,懒包装)
- 对话页:`choosePersona(persona)`、`personaName` 状态

- [ ] **Step 1: 写失败测试**

`web/src/features/agents/chat-parts.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ChatPersonaControl } from "./chat-parts";
import { resetAgentsCaches } from "./use-agents-data";

const persona = (id: string, name: string) => ({ id, owner_id: null, name, intro: "", prompt: null, level: "B1", style: "friendly", voice: null,
  tools: ["lookup"], prompt_public: true, deep_think: false, disabled_at: null, created_at: null, updated_at: null });

function setup(enabled: boolean, personaId: string | null) {
  const mock = createFetchMock({
    "GET /api/agents/config": () => json({ enabled, tutor_enabled: true, memory_enabled: true, rooms_enabled: true, prompt_max_chars: 800, personas_max: 10 }),
    "GET /api/agents/personas": () => json({ personas: [persona("builtin:coach", "Emma"), persona("builtin:waiter", "Mia")] }),
  });
  const onChange = vi.fn();
  const onResolved = vi.fn();
  renderWithProviders(<ChatPersonaControl personaId={personaId} disabled={false} onChange={onChange} onResolved={onResolved} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return { mock, onChange, onResolved };
}

describe("ChatPersonaControl (spec §9.3, R-W15)", () => {
  beforeEach(() => resetAgentsCaches());

  it("renders nothing when agents are off", async () => {
    const { mock } = setup(false, null);
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    expect(screen.queryByTestId("agent-persona-chip")).toBeNull();
  });

  it("shows the conversation's persona, reports it, and changes it through the picker", async () => {
    const { onChange, onResolved } = setup(true, "builtin:coach");
    const chip = await screen.findByTestId("agent-persona-chip");
    await waitFor(() => expect(chip).toHaveTextContent("Emma"));
    expect(onResolved).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Emma" }));
    await userEvent.click(chip);
    await userEvent.click(await screen.findByTestId("agent-persona-builtin:waiter"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "builtin:waiter" }));
  });

  it("offers a persona to an old conversation and does not fire for the same choice", async () => {
    const { onChange } = setup(true, null);
    const chip = await screen.findByTestId("agent-persona-chip");
    expect(chip).toHaveTextContent("Persona");
    await userEvent.click(chip);
    await userEvent.click(await screen.findByTestId("agent-persona-none"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

`conversation-page.agent.test.tsx` 追加:

```tsx
  it("picks a persona for an old conversation by writing only agent_persona_id", async () => {
    const mock = setup(routes({}, CONFIG));
    await userEvent.click(await screen.findByTestId("agent-persona-chip"));
    await userEvent.click(await screen.findByTestId("agent-persona-builtin:coach"));
    await waitFor(() => expect(callsTo(mock, "PATCH", "/api/conversations/c1")).toHaveLength(1));
    expect(bodyOf(callsTo(mock, "PATCH", "/api/conversations/c1")[0]).config).toEqual({ ...CONFIG, agent_persona_id: "builtin:coach" });
  });
```

`conversation-page.test.tsx` 里 `"cancel discards the recording without any request and releases the microphone"` 用例:把 `const before = mock.calls.length;` 改为 `const own = () => mock.calls.filter((c) => !c.url.pathname.startsWith("/api/agents/")).length;` 与 `const before = own();`,把 `expect(mock.calls.length).toBe(before);` 改为 `expect(own()).toBe(before);`(懒加载的角色控件会在任意时刻请求一次 `/api/agents/config`)。

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/agents/chat-parts.test.tsx src/features/chat/conversation-page.agent.test.tsx`。

- [ ] **Step 3: 实现**

`web/src/features/agents/chat-parts.tsx`:

```tsx
import "./locales";
import { useEffect, useState } from "react";
import { PersonaChip } from "./persona-chip";
import { PersonaPicker } from "./persona-picker";
import type { Persona } from "./types";
import { useAgentsConfig, usePersonas } from "./use-agents-data";

export interface ChatPersonaControlProps {
  personaId: string | null;
  disabled: boolean;
  /** 选了不同的角色(null = 不使用角色) */
  onChange(persona: Persona | null): void;
  /** 解析出的当前角色(助手头像用) */
  onResolved?(persona: Persona | null): void;
}

/** 对话顶栏的角色控件(懒加载块):智能体关闭时什么都不渲染,旧会话因此完全不变。 */
export function ChatPersonaControl({ personaId, disabled, onChange, onResolved }: ChatPersonaControlProps) {
  const { config } = useAgentsConfig();
  const enabled = !!config?.enabled;
  const { personas } = usePersonas(enabled);
  const [open, setOpen] = useState(false);
  const persona = personaId ? personas?.find((p) => p.id === personaId) ?? null : null;
  useEffect(() => {
    onResolved?.(persona);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona?.id, persona?.name]);
  if (!enabled) return null;
  return (
    <>
      <PersonaChip persona={persona} pendingId={personaId} disabled={disabled} onClick={() => setOpen(true)} />
      <PersonaPicker open={open} onOpenChange={setOpen} selectedId={personaId} allowNone
        onSelect={(p) => {
          setOpen(false);
          if ((p?.id ?? null) !== personaId) onChange(p);
        }} />
    </>
  );
}
```

`lazy-parts.tsx` 追加:`export const ChatPersonaControl = part<import("./chat-parts").ChatPersonaControlProps>(() => import("./chat-parts").then((m) => m.ChatPersonaControl));`
`index.ts` 追加:`export { ChatPersonaControl } from "./lazy-parts";`

`conversation-page.tsx`:

(a) agents 导入行扩展为 `import { ChatPersonaControl, ProcessCapsule, SourceChips, runAgentTurn, type AgentTrace, type Persona } from "~/features/agents";`

(b) `const [recapOpen, setRecapOpen] = useState(false);` 之后追加:

```ts
  /** 当前角色名(ChatPersonaControl 解析后回传,R-W15):助手头像取它的首字 */
  const [personaName, setPersonaName] = useState<string | null>(null);
```

(c) `saveSettings` 定义之后追加:

```ts
  /** 选择 / 更换 / 取消角色(spec §9.3):只写 agentPersonaId(与角色音色,R-W17);取消时删掉这个键 */
  const choosePersona = (persona: Persona | null) => {
    const voice = persona?.voice && ai ? { ttsModel: ai.defaultTts.model, ttsVoice: persona.voice } : {};
    void saveSettings({ agentPersonaId: persona?.id, ...voice }).catch((): void => undefined);
  };
```

(d) `GlassTopBar` 的 `leading` 改为:

```tsx
        leading={(
          <>
            <IconButton label={t("web.common.back")} onClick={() => navigate("/chat")}>
              <ChevronLeftIcon />
            </IconButton>
            {conversation && (
              <ChatPersonaControl personaId={conversation.config.agentPersonaId ?? null} disabled={sending || voiceBusy || !!call || settling}
                onChange={choosePersona} onResolved={(p) => setPersonaName(p?.name ?? null)} />
            )}
          </>
        )}
```

(e) `<MessageBubble … partnerName={partnerVoice}` 改为 `partnerName={personaName ?? partnerVoice}`。

`conversation-settings-sheet.tsx`:`<div className="space-y-section pb-1">` 之后、第一个 `<Group` 之前插入:

```tsx
          {config.agentPersonaId && (
            <p data-testid="settings-persona-note" className="rounded-[10px] bg-surface-2 px-3 py-2 text-meta text-ink-2">{t("web.chat.settingsForm.personaNote")}</p>
          )}
```

`features/chat/i18n/en.json` 的 `web.chat.settingsForm` 末尾追加 `"personaNote": "This conversation uses a persona: the persona decides the role prompt, scenario and level. Voice and learning switches still apply."`;`zh-CN.json` 同位置追加 `"personaNote": "这个对话使用了角色:角色提示、场景与难度由角色决定;音色和学习开关照常生效。"`。

- [ ] **Step 4: 跑测试** — `yarn web:typecheck && cd web && yarn vitest run src/features/chat src/features/agents src/i18n src/architecture.test.ts`。
- [ ] **Step 5: 提交** — `feat(web): persona chip in the conversation header`。

### Task I4: 重新生成与「带我学」插槽

**Files:**
- Modify: `web/src/features/agents/chat-parts.tsx`、`web/src/features/agents/chat-parts.test.tsx`(追加)、`web/src/features/chat/conversation-page.tsx`、`web/src/features/chat/conversation-page.agent.test.tsx`(追加)
- Append: `lazy-parts.tsx`、`index.ts`(若 A3 已导出 `TutorBar` 且为非懒加载,在 lazy-parts 里改成懒包装,见 R-W1)

**Interfaces:**
- Produces:`TutorEntryProps { personaId, conversationId, disabled, onStarted(sessionId) }`、`TutorEntry`;对话页 `regenerate()`、`startTutor(sessionId)`、`continueTutor()`、`endTutor()`、`tutor` 状态
- Consumes(A3):`./tutor/tutor-start-sheet` 的 `TutorStartSheet({ open, onOpenChange, personaId, conversationId, onStarted(sessionId) })`;公开面 `TutorBar({ sessionId, meta, busy, onContinue, onEnd })`

- [ ] **Step 1: 写失败测试**

`chat-parts.test.tsx` 追加(文件顶部加 `vi.mock`):

```tsx
vi.mock("./tutor/tutor-start-sheet", () => ({
  TutorStartSheet: ({ open, onStarted }: { open: boolean; onStarted(id: string): void }) =>
    open ? <button type="button" data-testid="fake-tutor-start" onClick={() => onStarted("ts1")}>start</button> : null,
}));
// …
import { TutorEntry } from "./chat-parts";

describe("TutorEntry (R-W18)", () => {
  beforeEach(() => resetAgentsCaches());
  const render = (personaId: string | null, tutorEnabled = true) => {
    const onStarted = vi.fn();
    renderWithProviders(<TutorEntry personaId={personaId} conversationId="c1" disabled={false} onStarted={onStarted} />, { api: new ApiClient({
      getToken: () => "t", fetchImpl: createFetchMock({ "GET /api/agents/config": () => json({ enabled: true, tutor_enabled: tutorEnabled, memory_enabled: true, rooms_enabled: true, prompt_max_chars: 800, personas_max: 10 }) }).fetch,
    }) });
    return onStarted;
  };

  it("opens the tutor start sheet and hands over the session id", async () => {
    const onStarted = render("builtin:coach");
    await userEvent.click(await screen.findByTestId("agent-tutor-entry"));
    await userEvent.click(await screen.findByTestId("fake-tutor-start"));
    expect(onStarted).toHaveBeenCalledWith("ts1");
  });

  it("is hidden without a persona or when the tutor is off", async () => {
    render(null);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("agent-tutor-entry")).toBeNull();
  });
});
```

`conversation-page.agent.test.tsx` 追加:

```tsx
  it("regenerates the latest reply from a failed tool row: deletes it, reruns the same line and saves only the new reply", async () => {
    const failed = { ...STEP, id: "s2", key: "weak_words", status: "fail", params: undefined };
    let n = 0;
    const mock = setup(routes({
      "POST /api/agents/turn": () => (++n === 1
        ? sse([ev("step", failed), ev("delta", { text: "First." }), ev("done", { trace: { ...TRACE, steps: [failed] }, text_len: 6 })])
        : sse(HAPPY)),
      "POST /api/conversations/c1/messages": (call) => json({ messages: JSON.parse(String(call.body)).messages.length === 2 ? [{ id: "m1" }, { id: "m2" }] : [{ id: "m3" }] }),
      "DELETE /api/messages/m2": () => json({ id: "m2" }),
    }));
    await screen.findByText("Earlier reply");
    await say("Hi");
    await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(1));
    await userEvent.click(await screen.findByTestId("agent-capsule"));
    await userEvent.click(await screen.findByTestId("agent-tool-retry"));
    await waitFor(() => expect(screen.getAllByTestId("message-assistant").at(-1)).toHaveTextContent("Hello there!"));
    expect(callsTo(mock, "DELETE", "/api/messages/m2")).toHaveLength(1);
    expect(bodyOf(callsTo(mock, "POST", "/api/agents/turn")[1])).toMatchObject({ text: "Hi", history: [{ role: "assistant", content: "Earlier reply" }] });
    await waitFor(() => expect(callsTo(mock, "POST", "/api/conversations/c1/messages")).toHaveLength(2));
    expect(bodyOf(callsTo(mock, "POST", "/api/conversations/c1/messages")[1]).messages).toEqual([
      { role: "assistant", content: "Hello there!", agent_trace: { v: 1, ms: 3200, steps: [STEP], thought: null } },
    ]);
    expect(screen.getAllByTestId("message-user")).toHaveLength(1);
  });
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/agents/chat-parts.test.tsx src/features/chat/conversation-page.agent.test.tsx`。

- [ ] **Step 3: 实现**

`chat-parts.tsx` 追加:

```tsx
import { GraduationCapIcon } from "lucide-react";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

// A3 的开始面板(agents/tutor/*):只在点「带我学」后加载
const TutorStartSheet = lazy(() => import("./tutor/tutor-start-sheet").then((m) => ({ default: m.TutorStartSheet })));

export interface TutorEntryProps {
  personaId: string | null;
  conversationId: string;
  disabled: boolean;
  onStarted(sessionId: string): void;
}

/** 输入条提示行右侧的「带我学」入口(R-W18):有角色且导师开启时才出现。 */
export function TutorEntry({ personaId, conversationId, disabled, onStarted }: TutorEntryProps) {
  const { t } = useTranslation();
  const { config } = useAgentsConfig();
  const [open, setOpen] = useState(false);
  if (!config?.enabled || !config.tutorEnabled || !personaId) return null;
  return (
    <>
      <button type="button" data-testid="agent-tutor-entry" disabled={disabled} onClick={() => setOpen(true)}
        className="hit-expand ml-2 inline-flex h-8 flex-none items-center gap-1 whitespace-nowrap rounded-full bg-blue-tint px-2.5 text-sub font-semibold text-blue disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <GraduationCapIcon aria-hidden className="h-4 w-4" />{t("web.agents.tutor.entry")}
      </button>
      {open && (
        <Suspense fallback={null}>
          <TutorStartSheet open onOpenChange={setOpen} personaId={personaId} conversationId={conversationId}
            onStarted={(sessionId: string) => { setOpen(false); onStarted(sessionId); }} />
        </Suspense>
      )}
    </>
  );
}
```

(把 `GraduationCapIcon`、`lazy`、`Suspense`、`useTranslation` 合并进文件顶部已有的导入。)

`lazy-parts.tsx` 追加:`export const TutorEntry = part<import("./chat-parts").TutorEntryProps>(() => import("./chat-parts").then((m) => m.TutorEntry));`
`index.ts` 追加:`export { TutorEntry } from "./lazy-parts";`(`TutorBar` 由 A3 导出;若是非懒加载组件,在 `lazy-parts.tsx` 追加 `export const TutorBar = part<import("./tutor/tutor-bar").TutorBarProps>(() => import("./tutor/tutor-bar").then((m) => m.TutorBar));` 并把 `index.ts` 里 A3 的 `TutorBar` 导出改为从 `./lazy-parts` 导出。)

`conversation-page.tsx`:

(a) agents 导入行扩展为 `import { ChatPersonaControl, ProcessCapsule, SourceChips, TutorBar, TutorEntry, runAgentTurn, type AgentTrace, type Persona, type TurnMeta } from "~/features/agents";`;`chat-api` 导入里确认有 `deleteMessage`。

(b) `personaName` 状态之后追加:

```ts
  /** 导师模式(带我学,A3,R-W18):进行中的会话;meta 来自回合的 meta 事件 */
  const [tutor, setTutor] = useState<{ sessionId: string; meta: TurnMeta | null } | null>(null);
  const tutorRef = useRef<{ sessionId: string } | null>(null);
```

(c) 加载 effect 里 `setRecapOpen(false);` 之后追加 `setTutor(null);` 与 `tutorRef.current = null;`。

(d) `send` 里 `runAgentTurn(...)` 调用改为带上导师字段与 meta 回调:

```ts
        const tutorNow = tutorRef.current;
        const result = await runAgentTurn(api, {
          personaId: agentId, conversationId: conversation.id, text: turn.solo === "opening" ? null : content, history,
          mode: tutorNow ? "tutor" : "chat", tutorSessionId: tutorNow?.sessionId ?? null, clientTurnId: turn.agentTurnId,
        }, {
          onDelta,
          onTrace: (l) => patch(botKey, { agent: { live: l } }),
          onMeta: (meta) => { if (live() && tutorNow && tutorRef.current === tutorNow) setTutor({ sessionId: tutorNow.sessionId, meta }); },
        }, controller.signal);
```

(e) `retry` 定义之后追加:

```ts
  /**
   * R-W13:重新生成最新一条智能体回复(过程卡失败行的「重试」、工具详情的「重新生成」)。
   * 先删服务端那条助手消息,再用同一句重跑,只保存新的助手消息。prime 在点击的同步阶段。
   */
  const regenerate = async () => {
    const list = messagesRef.current;
    const last = list[list.length - 1];
    const user = list[list.length - 2];
    if (!last?.id || last.role !== "assistant" || user?.role !== "user" || !user.id || busyRef.current
      || voiceStateRef.current !== "idle" || pendingSavesRef.current.length > 0 || !conversationRef.current?.config.agentPersonaId) return;
    autoSpeak.prime();
    try {
      await deleteMessage(api, last.id);
    } catch (err) {
      toast.error(translateServerError(tRef.current, err, CHAT_SERVER_ERRORS));
      return;
    }
    knownTailRef.current = user.id;
    void send(user.content, messagesRef.current.slice(0, -2), { userKey: user.key, solo: "regenerate" });
  };

  /** 导师模式:继续(智能体出下一题 / 开场),text = null 的回合;失败的尾部先丢弃(与发送同一规则)。 */
  const continueTutor = () => {
    if (!tutorRef.current || busyRef.current || voiceStateRef.current !== "idle") return;
    const { kept, dropped } = dropFailedTails(messagesRef.current);
    abandonDropped(dropped);
    void send("", kept, { solo: "opening" });
  };
  /** A3 的开始面板回调:进入导师模式,智能体先开口(spec §7.1)。 */
  const startTutor = (sessionId: string) => {
    tutorRef.current = { sessionId };
    setTutor({ sessionId, meta: null });
    continueTutor();
  };
  const endTutor = () => {
    tutorRef.current = null;
    setTutor(null);
  };
```

(f) `before={m.agent ? <ProcessCapsule … /> : null}` 改为带上重新生成(只给最新且已保存的一条):

```tsx
              before={m.agent ? (
                <ProcessCapsule live={m.agent.live} trace={m.agent.trace} generating={m.status === "streaming"}
                  onRegenerate={m.key === lastKey && m.id && !sending ? () => void regenerate() : undefined} />
              ) : null}
```

(g) 输入条:`{autoSpeak.blocked && (` 那一块之后、提示行 `<div aria-hidden={hintsUnavailable || undefined}` 之前插入:

```tsx
        {tutor && conversation && (
          <TutorBar sessionId={tutor.sessionId} meta={tutor.meta} busy={sending} onContinue={continueTutor} onEnd={endTutor} />
        )}
```

提示行按钮 `data-testid="chat-hints"` 的 className 里 `w-full` 改为 `min-w-0 flex-1`;该按钮之后(同一个父 `div` 内)追加:

```tsx
          {conversation && (
            <TutorEntry personaId={conversation.config.agentPersonaId ?? null} conversationId={conversation.id}
              disabled={hintsUnavailable || !!tutor} onStarted={startTutor} />
          )}
```

- [ ] **Step 4: 跑测试** — `yarn web:typecheck && cd web && yarn vitest run src/features/chat src/features/agents src/architecture.test.ts`。
- [ ] **Step 5: 提交** — `feat(web): regenerate agent replies and reserve the teach-me slot in chat`。

### Task I5: 对话详情页懒加载与体积验收

**Files:**
- Create: `web/src/features/chat/lazy-pages.tsx`
- Modify: `web/src/features/chat/index.ts`、`web/src/features/chat/CLAUDE.md`

- [ ] **Step 1: 写失败测试** — 追加到 `web/src/features/chat/conversation-page.agent.test.tsx`:

```tsx
import { ConversationPage as RoutedConversationPage } from "~/features/chat";
// …
describe("routed ConversationPage (R-W2)", () => {
  it("is a lazy route component that renders the real page", async () => {
    const mock = createFetchMock(routes({}, CONFIG));
    renderWithProviders(<RoutedConversationPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat/c1", path: "/chat/:id" });
    expect(await screen.findByText("Earlier reply")).toBeInTheDocument();
    expect(RoutedConversationPage).not.toBe(ConversationPage);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/chat/conversation-page.agent.test.tsx`(`not.toBe` 失败)。

- [ ] **Step 3: 实现**

`web/src/features/chat/lazy-pages.tsx`:

```tsx
import { lazy, Suspense } from "react";

const Page = lazy(() => import("./conversation-page").then((m) => ({ default: m.ConversationPage })));

/**
 * 对话详情页按路由懒加载(agents-web R-W2,与 wordbook/lazy-pages.tsx 的 Z-h 同法):会话列表仍随主包;
 * 详情页(录音、通话、复盘、智能体集成)各自成块,抵消智能体集成在主包里的字节。测试直接导入 ./conversation-page。
 */
export function ConversationPage() {
  return (
    <Suspense fallback={<div aria-busy="true" className="flex-1" />}>
      <Page />
    </Suspense>
  );
}
```

`features/chat/index.ts`:`export { ConversationPage } from "./conversation-page";` 改为 `export { ConversationPage } from "./lazy-pages"; // 路由懒加载(R-W2);不要在这里静态导出页面模块`。

`features/chat/CLAUDE.md`:「What lives here」Pages 一行后追加 `- lazy-pages.tsx — the routed ConversationPage is lazy (agents-web R-W2); tests import ./conversation-page directly.`;「Pitfalls」追加 `- Agent conversations (config.agentPersonaId) stream from /api/agents/turn via ~/features/agents runAgentTurn; the onDelta path into sentence-stream/auto-speak is shared with the old path. Without a persona nothing changes.`

- [ ] **Step 4: 跑测试与体积** — `yarn web:typecheck && yarn web:test && yarn web:build && cd web && node scripts/check-main-bundle.mjs`。必须通过(净增量 ≤ 0.2 kB)。另做一次「仅 agents 部分」的测量:临时把 `features/chat/index.ts` 改回静态导出并 `yarn web:build && node scripts/check-main-bundle.mjs`,记下数值后撤销临时改动;两个数都写进提交说明(Z1 写进 README)。确认 `dist/assets/index-*.js` 里没有 `agents/turn`、`web.agents.process` 字样(`grep -c` 为 0)。
- [ ] **Step 5: 提交** — `perf(web): lazy-load the conversation page to keep the agents budget`。

---

## Nav lane (N)

### Task N1: 路由与「我的」入口

**Files:**
- Modify: `web/src/app.tsx`、`web/src/pages/me-page.tsx`、`web/src/pages/me-page.test.tsx`

**Interfaces:**
- Consumes:`AgentSettingsPage`、`AgentsMeRow`、`MemoryPage`(A2,`~/features/agents`)

- [ ] **Step 1: 写失败测试** — `me-page.test.tsx` 追加:

```tsx
  it("shows the agents row when agents are on", async () => {
    const mock = createFetchMock({ ...ROUTES,
      "GET /api/agents/config": () => json({ enabled: true, tutor_enabled: true, memory_enabled: true, rooms_enabled: true, prompt_max_chars: 800, personas_max: 10 }) });
    renderWithProviders(<MePage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    expect(await screen.findByTestId("me-agents")).toHaveAttribute("href", "/me/agents");
  });
```

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/pages/me-page.test.tsx`。

- [ ] **Step 3: 实现**

`app.tsx`:`import { VocabularyPage } from "~/features/vocabulary";` 之后加 `import { AgentSettingsPage, MemoryPage } from "~/features/agents";`(若 A2 已加该导入,合并成一行);`<Route path="/me" element={<MePage />} />` 之后加:

```tsx
            <Route path="/me/agents" element={<AgentSettingsPage />} />
            <Route path="/me/agents/memory" element={<MemoryPage />} />
```

(A2 若已加 `/me/agents/memory`,只加第一条。两条都在 `AppShell` 之下,底部导航按前缀 `/me` 高亮「我的」。)

`me-page.tsx`:导入 `import { AgentsMeRow } from "~/features/agents";`;`<WordbookMeRow />` 之后加 `<AgentsMeRow />`。

- [ ] **Step 4: 跑测试** — `yarn web:typecheck && cd web && yarn vitest run src/pages src/layout src/components/maintenance-screen.test.tsx src/architecture.test.ts`。
- [ ] **Step 5: 提交** — `feat(web): /me/agents route and agents row on the me page`。

---

## Final lane (Z)

### Task Z1: 文档

**Files:**
- Modify or create: `web/src/features/agents/CLAUDE.md`
- Modify: `web/CLAUDE.md`、`web/src/CLAUDE.md`、`web/src/features/CLAUDE.md`、`web/README.md`

- [ ] **Step 1: `web/src/features/agents/CLAUDE.md`**(已存在则把下列各节合并进去,不删 A2/A3 的内容)

```markdown
# web/src/features/agents/

Agents (spec docs/superpowers/specs/2026-10-12-agents-design.md): shared by 1:1 chat and rooms. Server owns the loop;
this feature owns the web public surface (§13), the SSE turn client, process display, personas and agent settings.

## What lives here
- `index.ts` — public surface. Components are lazy wrappers from `lazy-parts.tsx` (`part()`); never export a component module statically.
- `types.ts` (wire shapes, camelCase), `agents-api.ts` (REST), `use-agents-data.ts` (config per ApiClient; settings/personas per user id).
- Turn: `sse.ts` (parser keeping event names), `trace.ts` (live trace reducer), `turn-stream.ts` (fetch + reader, lazy chunk),
  `use-agent-turn.ts` (`runAgentTurn` dynamic-import shim + `useAgentTurn`).
- Process: `process-capsule.tsx`, `process-card.tsx`, `step-sheet.tsx`, `source-chips.tsx`, `step-labels.ts`.
- Personas: `persona-chip.tsx`, `persona-picker.tsx`, `persona-editor-sheet.tsx`, `report-persona-sheet.tsx`.
- Settings: `agent-settings-page.tsx` (`/me/agents`), `me-row.tsx`. Chat bridge: `chat-parts.tsx` (`ChatPersonaControl`, `TutorEntry`).
- `locales/{en,zh-CN}.json` + `locales.ts` — strings (`web.agents.*`), loaded lazily; every lazy entry module does `import "./locales"`.
- Sub-features: `memory/` (agents-memory plan), `tutor/` (agents-tutor plan).

## Public surface
`useAgentTurn`, `runAgentTurn`, `agentsApi`, `ProcessCapsule`, `SourceChips`, `PersonaChip`, `PersonaPicker`, `PersonaEditorSheet`,
`ReportPersonaSheet`, `ChatPersonaControl`, `TutorEntry`, `AgentSettingsPage`, `AgentsMeRow`, `MemoryPage`, `TutorBar`, `TutorRecapCard`,
types `Persona`, `PersonaDraft`, `AgentStep`, `AgentTrace`, `AgentView`, `LiveTrace`, `TurnEvent`, `TurnMeta`, `AgentSettings`, `AgentsConfig`.
Importers: chat (frozen edge chat->agents), rooms (rooms->agents, added by the rooms plan), pages/app.

## Allowed dependencies
- `lib/`, `api/`, `components/`, `layout/`, `auth/`, `i18n/`, `@renderer/*`. Never another feature (agents is imported, it never imports).

## Test
- `cd web && yarn vitest run src/features/agents` · contract: `agents-contract.test.ts` reads `server/tests/fixtures/agents_contract.json`.
- Bundle: `yarn web:build && cd web && node scripts/check-main-bundle.mjs` (+0.2 kB gzip budget vs `scripts/main-bundle-baseline.json`).

## Pitfalls
- Never put text, words, tokens or `client_turn_id` in a URL or a log; `AgentTurnError.message` is the code only.
- No EventSource, no `for await` over `response.body` (iOS Safari), no automatic retry. Retry keeps `client_turn_id` only after a
  transport failure or `busy` (the error's `retryId`).
- Strings live in `locales/`, not `i18n/` (the eager glob would put them in the main bundle).
- Process display: collapsed by default, forced open while generating (D1); `show_process=false` shows only "Replying…".
- Persona avatars are neutral; red only for failed steps; skipped sources are neutral.
```

- [ ] **Step 2: 上层文档**
  - `web/src/features/CLAUDE.md` 第一行的 feature 列表加 `agents`;「Rules」末尾加:`- agents is a provider feature: chat (and rooms) import it; it never imports another feature.`
  - `web/src/CLAUDE.md`「Pitfalls」追加:`- Lazy-loaded features (wordbook pages, agents, the routed ConversationPage) keep the main chunk small; check with web/scripts/check-main-bundle.mjs after yarn web:build.`
  - `web/CLAUDE.md`「Commands」追加 `yarn workspace web bundle:check`(先 build);「Pitfalls」追加:`- Agents strings are lazy (features/agents/locales); agents SSE uses fetch + reader (iOS Safari), never EventSource or URL tokens.`

- [ ] **Step 3: `web/README.md`** — 「学习联动」节之后新增:

```markdown
## 智能体(计划 2026-10-12)

服务端开关 `AGENTS_ENABLED`(默认关,见 `server/README.md`「智能体」)。关闭时网页与原来一样:对话页加载会话后只多请求一次 `GET /api/agents/config`,「我的」没有「智能体」一行,直达 `/me/agents` 显示「智能体未开启」。

- **对话**:顶栏返回键右侧的角色 chip(无角色时显示「角色」),点开选择面板(全部 / 内置 / 我的、创建我的角色)。只有选了角色的会话才改走 `POST /api/agents/turn`(SSE:start / step / thought / delta / meta / done / error);没有角色的旧会话请求与保存体完全不变。回复的增量文本与旧路径进入同一个逐句朗读管线。助手气泡上方是过程胶囊:生成中自动展开(上下文 → 工具 → 思路),结束后折叠成「思考 N 秒 · 用了 M 个工具」;回复下方是来源标签。压缩过程随助手消息写入 `messages.agent_trace`,刷新后胶囊仍在。工具失败显示红色失败行与「重试」(= 重新生成最新一条回复);超时跳过的来源显示为中性行。
- **重试规则**:从不自动重试。传输失败(断网、读流中断、60 秒无数据)或「上一条还在生成」后点重试,沿用同一个 `client_turn_id`(服务端幂等);服务端明确拒绝(次数用完、停用等)后点重试是新的一轮。
- **角色**:名称、简介、人设(计数,上限来自服务端)、水平、风格、音色(下拉,不试听)、5 个工具开关(默认全开)、「在联机房间公开人设原文」(默认开)、「试聊一句」(不保存)。举报角色的面板供联机房间使用。
- **设置**(`/me/agents`):全局工具开关(默认全开)、记住我与「管理记忆」(`/me/agents/memory`,记忆计划)、在联机房间里使用我的学习数据(写明「房间里的回复所有人可见」)、显示思考过程、默认角色、带我学题数与题型。
- **带我学**:有角色的会话在输入条「不会说?」一行右侧显示入口(开始面板与导师条见导师计划)。
- **体积**:智能体界面、文案与 SSE 解析器全部懒加载;对话详情页改为路由懒加载。主包:净增量 <填 I5 实测> kB gzip,仅智能体部分 <填 I5 实测> kB(基线 `web/scripts/main-bundle-baseline.json`)。
- 契约:`src/features/agents/agents-contract.test.ts` 逐键核对 `server/tests/fixtures/agents_contract.json`。E2E:`e2e/agents.spec.ts`(回合用契约样例模拟,零上游)。
- **未在真机验证**(清单见 `docs/superpowers/plans/e2e-results.md`「智能体」):iOS Safari 与主屏 PWA 上 fetch 流式读取的逐块到达(反向代理须关闭 SSE 缓冲)、生成中过程卡的展开 / 折叠与滚动跟随、iOS 上「带我学」开场回复的自动朗读(开始面板的网络往返之后不在点击手势里,可能降级为「点此朗读」)、安卓 Chrome 中低端机上 100 ms 计时刷新的耗电与流畅度、角色编辑器在软键盘弹出时的保存条位置(`visualViewport`)、VoiceOver / TalkBack 读胶囊(折叠按钮)与过程卡的「正在准备回复」状态、深色模式下失败行与工具图块的对比度、360 px 真机上的英文标签。
```

- [ ] **Step 4: 提交** — `docs: agents web shell notes`。

### Task Z2: E2E 与 360 px 标签检查

**Files:**
- Create: `web/e2e/agents.spec.ts`
- Modify: `web/e2e/CLAUDE.md`、`docker-compose.e2e.yml`(若 A1 未加 `AGENTS_ENABLED: "true"`)、`docs/superpowers/plans/e2e-results.md`

- [ ] **Step 1: 写 spec**

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { loginViaUi, registerViaApi } from "./support/auth";
import { mockUpstreams } from "./support/mock-upstreams";

// 契约样例与服务端测试共用(A1 录制);回合 SSE 原样回放,零上游
const CONTRACT = JSON.parse(readFileSync(path.resolve(__dirname, "../../server/tests/fixtures/agents_contract.json"), "utf8"));
test.use({ locale: "zh-CN" });

/** 注册 + 界面登录;用注册返回的令牌经 API 建一个空会话(令牌只在请求头,不进 URL 与日志)。 */
async function signInWithConversation(page: Page, request: APIRequestContext): Promise<string> {
  const creds = await registerViaApi(request);
  const r = await request.post("/api/conversations", { headers: { Authorization: `Bearer ${creds.token}` }, data: { name: "Agent E2E", config: {} } });
  expect(r.ok()).toBe(true);
  await loginViaUi(page, creds.username, creds.password);
  await expect(page).toHaveURL(/\/practice$/);
  return (await r.json()).id as string;
}

async function noOverflow(page: Page, selector: string) {
  const overflowing = await page.locator(selector).evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  expect(overflowing).toEqual([]);
}

test("agents: pick a persona, stream a mocked turn, capsule survives reload, settings hide the process", async ({ page, request }) => {
  const upstreams = await mockUpstreams(page);
  await page.route("**/api/agents/turn", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: CONTRACT.turn_sse }));
  const id = await signInWithConversation(page, request);
  await page.goto(`/chat/${id}`);
  await page.getByTestId("agent-persona-chip").click();
  await page.locator('[data-testid^="agent-persona-builtin:"]').first().click();
  await expect(page.getByTestId("agent-persona-chip")).not.toHaveText("角色");
  await page.getByTestId("chat-input").fill("Hi");
  const turnRequest = page.waitForRequest("**/api/agents/turn");
  await page.getByTestId("chat-send").click();
  expect(new URL((await turnRequest).url()).search).toBe("");
  await expect(page.getByTestId("agent-capsule")).toContainText("思考");
  await page.reload();
  await expect(page.getByTestId("agent-capsule")).toBeVisible(); // 来自 messages.agent_trace
  await page.goto("/me/agents");
  await page.getByTestId("agent-setting-show-process").click();
  await page.goto(`/chat/${id}`);
  await expect(page.getByTestId("message-assistant").last()).toBeVisible();
  await expect(page.getByTestId("agent-capsule")).toHaveCount(0);
  expect(upstreams.unmocked).toEqual([]);
});

test("agents: English labels fit a 360 px phone", async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await mockUpstreams(page);
  const id = await signInWithConversation(page, request);
  await page.goto("/me");
  await page.getByTestId("me-language").selectOption("en");
  await page.goto(`/chat/${id}`);
  await expect(page.getByTestId("agent-persona-chip")).toBeVisible();
  await noOverflow(page, '[data-testid="agent-persona-chip"] span');
  await page.getByTestId("agent-persona-chip").click();
  await noOverflow(page, '[data-testid^="agent-picker-tab-"], [data-testid="agent-persona-create"]');
  await page.getByTestId("agent-persona-create").click();
  await noOverflow(page, '[data-testid="agent-editor-try"], [data-testid="agent-editor-save"], [data-testid^="agent-editor-style-"]');
  await page.goto("/me/agents");
  await noOverflow(page, '[data-testid^="agent-setting-kind-"]');
});
```

(语言经「我的 → 语言」下拉切到 English,存在本机设置里,之后的页面沿用。)

- [ ] **Step 2: E2E 栈** — `docker-compose.e2e.yml` 的 server `environment` 若没有 `AGENTS_ENABLED`,在 `LINKS_ENABLED` 行之后追加 `AGENTS_ENABLED: "true"        # agents.spec.ts;回合在 spec 里用契约样例模拟,零上游`。`web/e2e/CLAUDE.md` 的 Specs 列表追加 `agents`(`/api/agents/turn` mocked from the contract fixture, zero upstream; needs `AGENTS_ENABLED=true`)。
- [ ] **Step 3: 运行** — `yarn web:e2e --project=chromium-mobile agents`(需 E2E 栈;改了 env 后 `docker compose -p enjoy-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d --build --wait`)。若本环境没有 Docker:不运行,在 `e2e-results.md` 新增「智能体」节,把 `agents.spec.ts` 标「写好未在 Docker 栈运行」,并把 README 的真机清单逐项抄过去标「未验证」。
- [ ] **Step 4: 提交** — `test(e2e): agents persona, mocked turn, stored capsule and 360 px labels`。

### Task Z3: 评审波与合并验收

- [ ] `/code-review high`(W 车道、I 车道各一次)与 `security-review`(I 车道 + 整个 A4):URL / 日志 / 错误 / 测试快照里没有文本、词、令牌、`client_turn_id`;`client_turn_id` 规则;旧会话请求与保存体不变;回合错误只显示翻译文案。
- [ ] 视觉对照:视觉稿 1(生成中)、2(完成展开)、3(工具详情与失败)、5(角色选择)、6(创建角色)vs 真实页面,浏览器窗格 375×812 与 360×740,浅色 + 深色;差异只允许本计划裁定过的(R-W5、R-W6、R-W7、R-W15)。
- [ ] 全量:`yarn web:typecheck && yarn web:test && yarn web:build && cd web && node scripts/check-main-bundle.mjs`;E2E 见 Z2。
- [ ] 真机清单(README「智能体」未验证项)交给用户,结果写入 `e2e-results.md`。

---

## 验证矩阵

| 要求(spec) | 证据 |
|---|---|
| §3.4 公开面只经 `index.ts`、新增边写明原因 | `architecture.test.ts`(I1:基线 17、scanner 两行) |
| §3.4 / R-A2 懒加载、主包 ≤ 0.2 kB | `main-bundle.test.ts`(H0)、`check-main-bundle.mjs`(I5、Z3)、dist grep(I5) |
| §4.3 设置键与默认全开(D2) | `agents-contract.test.ts`、`agent-settings-page.test.tsx` |
| §4.4 SSE 事件全集、错误只带 code | `sse.test.ts`、`turn-stream.test.ts`、`agents-contract.test.ts` |
| §4.4 `client_turn_id` 幂等与重试 | `turn-stream.test.ts`(busy / 中断 / 超时 / 网络)、`use-agent-turn.test.tsx`、`conversation-page.agent.test.tsx` |
| iOS Safari:无 EventSource、无异步迭代、无 body 回落 | `turn-stream.ts` 代码审阅 + 「reads the whole body when the response has no stream」;真机未验证 |
| 隐私:URL 无查询串、令牌只在头、不打日志 | `turn-stream.test.ts`、`conversation-page.agent.test.tsx`、Z2 |
| §4.4 trace 随助手消息保存、刷新后渲染 | `conversation-page.agent.test.tsx`(保存体、重载胶囊)、`ui-message.agent.test.ts`、Z2 |
| §5 / D1 折叠、生成中展开、失败行重试、思路来源、show_process | `process.test.tsx` |
| §6.7 增量进入现有逐句 TTS | `conversation-page.agent.test.tsx`(`/api/ai/audio/speech` 被请求) |
| §9.1 举报、停用显示 | `report-persona-sheet.test.tsx`、`persona-picker.test.tsx` |
| §9.3 头部 chip、旧会话不受影响 | `chat-parts.test.tsx`、`conversation-page.agent.test.tsx`(旧路径用例、PATCH 只加一个键)、`conversation-page.test.tsx` 全绿 |
| D3 人设默认公开、提示文案 | `persona-editor-sheet.test.tsx`、`persona-picker.test.tsx` |
| 带我学插槽 | `chat-parts.test.tsx`(TutorEntry);A3 的导师条测试 |
| §11.6 i18n en/zh 键集一致、360 px | `locales.test.ts`、`i18n.test.ts`(chat 新键)、Z2 |
| §11.9 文档如实 | Z1 README 未验证清单、`e2e-results.md` |

## 不做

- 角色音色试听(R-W7);「深度思考」开关的界面(`deep_think` 原样保留、新建为 false)。
- 智能体会话里的实时通话、提示、复盘仍用旧提示词路径,不接角色与记忆(R-W12)。
- 新建会话自动套用默认角色(R-W19)。
- 自动重试与断线自动续传(R-W10)。
- 记忆页与记忆 REST(agents-memory 计划);导师开始面板、导师条、总结卡与导师状态机(agents-tutor 计划);房间侧的一切(agents-rooms 计划,含 `rooms->agents` 边与 `ReportPersonaSheet` 的入口)。
- 管理后台的智能体页(agents-core 计划)。
- 段位 / 联动接入导师(spec §7.4)。

## Cross-plan assumptions

服务端(A1 agents-core 拥有;形状以 `server/tests/fixtures/agents_contract.json` 为准,H4 逐键核对):

- **C1** `GET /api/agents/config` → `{ enabled, tutor_enabled, memory_enabled, rooms_enabled, prompt_max_chars, personas_max }`;功能关闭时仍 200 且 `enabled:false`(404 也按关闭处理)。spec §4.5 未列,本计划依赖它(R-W9)。
- **C2** 契约样例键名:`config`、`personas`(`{personas:[…]}`,内置 id 以 `builtin:` 开头)、`persona_created`、`settings`、`turn_sse`(一整段原始 SSE 文本:start → step(run/done) → delta… → done,含 `trace`)、`turn_error_sse`(含 `event: error`)、`message_with_trace`(一条带 `agent_trace` 的助手消息,即 `GET …/messages` 的单项)、`persona_try`(`{text}`)、`persona_report`。名字不同则只改 `agents-contract.test.ts` 的 `FIXTURE` 表。
- **C3** 角色对象键:`id, owner_id, name, intro, prompt(非本人且不公开时 null), level, style, voice, tools(键列表), prompt_public, deep_think, disabled_at, created_at, updated_at`;`POST /personas` 与 `PATCH /personas/{id}` 接受 `{name, intro, prompt, level, style, voice, tools, prompt_public, deep_think}`(PATCH 部分字段);`DELETE` 返回 `{id}`;超出数量 409 或 429,校验失败 422/400,停用 403/404。
- **C4** `POST /api/agents/personas/{id}/report` 体 `{ reason: "unsafe"|"offensive"|"spam"|"other", note?: string(≤200) }`,返回 2xx JSON。
- **C5** `POST /api/agents/personas/try` 体 `{ persona: <PersonaDraft 的 snake_case>, text }` → `{ text }`(非流式、套安全前言、计入每日回合上限、不写任何会话);不存在时 404(R-W8)。
- **C6** `GET|PATCH /api/agents/settings`:`{ tools:{lookup,learned_words,weak_words,due_words,memory}, memory_enabled, share_in_rooms, show_process, default_persona_id, tutor:{length, mix} }`,PATCH 接受部分键(含嵌套 `tools` / `tutor` 的部分键)并返回完整对象。
- **C7** `POST /api/agents/turn` 按 spec §4.4;流开始前的拒绝用 HTTP 状态(403/404 停用、409 同 id 进行中、422/400 坏请求、429 上限、5xx 上游不可用);`done.trace` 形状 `{ v, ms, steps:[step…], thought:{source,text}|null }`(≤ 4 KB);`step.params` 只含词与计数;建议响应头 `X-Accel-Buffering: no` 与周期 `: ping` 注释(解析器忽略注释)。
- **C8** `POST /api/conversations/{id}/messages` 的消息项接受可选 `agent_trace`(仅 `role="assistant"`,≤ 4 KB,否则 422);`GET …/messages` 与 `message_out` 返回 `agent_trace`(旧消息为 null);`conversations.config` 允许任意新增键 `agent_persona_id`(已有 JSON 字段,spec §9.3)。
- **C9** E2E 栈:`AGENTS_ENABLED=true` 时内置角色可用、`/config`、`/settings`、`/personas` 只读写数据库(不触达上游)。

兄弟计划(网页):

- **C10 A2(memory)**:`features/agents/index.ts` 已存在时导出 `MemoryPage`(无 props,路由 `/me/agents/memory`),实现在 `features/agents/memory/memory-page.tsx`;若 A2 已在 `app.tsx` 加了该路由,N1 不重复加。A2 的文案建议放 `memory/locales/` 以免进入主包(R-W3);若放在 `memory/i18n/`,它的体积计入 A2,不计入 A4 的基线(H0 在 A3 合并后记录)。
- **C11 A3(tutor)**:`features/agents/tutor/tutor-start-sheet.tsx` 导出 `TutorStartSheet({ open, onOpenChange, personaId, conversationId, onStarted(sessionId: string) })`(它自己调用 `POST /api/agents/tutor/start`);公开面导出 `TutorBar({ sessionId, meta: TurnMeta | null, busy: boolean, onContinue(): void, onEnd(): void })`(含跳过 / 结束按钮与 `meta.done` 后的总结卡 `TutorRecapCard`);`text=null` 且带 `tutor_session_id` 的回合 = 开场或出下一题。签名不同由 INDEX 裁定后改 `chat-parts.tsx` 与 `conversation-page.tsx` 的调用处。
- **C12 A5(rooms)**:只从 `~/features/agents` 导入;在第一处使用的提交里把 `"rooms->agents"` 加进 `CROSS_FEATURE_BASELINE` 并把计数改为 18(R-W4);房间里的过程用 `ProcessCapsule` 的 `showProcess` / `label` props(「<角色> 已回答 · 对 <昵称>」)与 `live` / `trace`;举报用 `ReportPersonaSheet`;私有 WS 事件 `agent_step` / `agent_thought` 的数据形状与 SSE 的 `step` / `thought` 相同,可直接用 `reduceLive` 的输入形状(A5 自行把 WS 帧转成 `TurnEvent`)。A5 的主包增量单独评估,基线为 A4 合并后重新 `--record`。
- **C13 INDEX**:`plans/2026-10-12-agents-INDEX.md` 若对 C1、C5、i18n 前缀(R-W3)或对话页懒加载(R-W2)另有裁定,以 INDEX 为准并在本计划追加 Addendum。

### 本计划发现的 spec 问题(未改 spec,已按上面的裁定处理)

1. 合并顺序 A2、A3 先于 A4,但 spec §13 说 A4 拥有 `features/agents/index.ts`;架构测试要求 feature 目录有 `index.ts`,所以 A2/A3 必须先建 —— R-W1 只追加。
2. 要求 A4「加 chat->agents 和 rooms->agents」做不到:基线测试拒绝尚不存在的边 —— R-W4,`rooms->agents` 归 A5。
3. 主包 +0.2 kB 与「文案进 `i18n/`」及「对话页在主包」互相矛盾 —— R-W2、R-W3。
4. spec §4.5 缺功能开关端点与「试聊一句」端点;`/turn` 要求已保存的角色与会话 —— R-W8、R-W9、C1、C5。
5. 视觉稿与 D2(工具默认只开查词)、D3(看不到人设原文)、一色一义(彩色头像)冲突;超时在 §4.6 是 `skip`、在视觉稿是红色失败 —— R-W5、R-W6。
6. spec §4.4 说「前端随 assistant 消息写入 `messages.agent_trace`」,但没有写现有消息接口要接受这个字段 —— C8。
7. i18n 前缀写成 `agents.*`,与现有 `web.<feature>.*` 约定不一致 —— R-W3。
