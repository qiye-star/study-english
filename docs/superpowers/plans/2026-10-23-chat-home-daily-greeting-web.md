# 对话主页与每日问候(网页)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已获批的演示页 `docs/design/chat-home-demo-v2.html`(用户:满意)重做网页对话模块:`/chat` 直接进入「今天的默认对话」;每天(或每次上线)在对话主页弹出全屏问候(问候文字是主角、不显示助手名字/头像、底部小字学习数据、逐行模糊落下、最后一行开始出现时启动约 5 s 倒计时 + 跳过、关闭时各行飞入对话里对应的问候气泡);左上角打开**左侧浮动历史抽屉**(约 82% 手机宽、上限 340 px、遮罩、Esc / 左滑 / 选中关闭、[+ 新建对话]、今天置顶、按日期分组);顶栏右侧通话按钮 + 设置按钮;设置面板(本对话角色 / 问候语言 中文·English·中英双语 / 问候时机 / 问候里提学习数据 / 重播今天的问候);新对话首次使用提示指向右上角设置。**硬性要求:现有语言对话的任何能力都不能丢**(§3 清单 64 项 + §4 对照矩阵)。

**Architecture:** 不新增 feature 目录,全部放 `web/src/features/chat/home/`(chat 的子目录,经 `features/chat/index.ts` 只导出路由组件与登出清理)。现有 `conversation-page.tsx` 不重写:先做**零行为变化**的「外框插槽」重构(FR3),新主页把同一个对话视图包进新外框(新顶栏、抽屉、设置面板、问候弹窗)。数据层沿用仓库现有做法(无 react-query:`ApiClient` + 模块级缓存 + `useEffect`,同 `use-rooms-enabled.ts` / `agents/use-agents-data.ts`)。App 打开检测用核心扩展点贡献 `appEffects/chat.home-open`(`features/chat/register-chat-home.tsx`,只被 `plugins/core.ts` 导入)。动画手写 CSS + Web Animations API,**零新依赖**。开关 `CHAT_HOME_ENABLED`(服务端,`GET /api/chat-home/config`)关 = 旧列表页原样。

**Tech Stack:** React 18 + react-router 7 + Tailwind 3 + Radix Dialog/Popover(已在依赖里)+ i18next;vitest + Testing Library(jsdom);Playwright(只在用户要求时跑)。不新增 npm 依赖,不改 `enjoy/`(需要的上游组件只经 `@renderer/*` / `web/src/shims`)。

**依据:** 服务端计划 `docs/superpowers/plans/2026-10-23-chat-home-daily-greeting.md`(下称「服务端计划」,其 §1 已商定设计(含第 22–31 条:用户 2026-10-23 采纳本计划原 §11 Q1–Q11 的推荐答案)、§3 裁定 R1–R17、§5 接口与 §5.1 前端契约是本计划的契约;冲突时以服务端计划为准);演示页 `docs/design/chat-home-demo-v2.html`(视觉 / 交互规格;v1 `chat-home-demo.html` 已作废)。

---

## Global Constraints

- **只读核对后再动手:** Task W0 核对本计划引用的文件、testid、行号仍成立(写计划时 head = `32306825`,主包基线 `web/scripts/main-bundle-baseline.json` = 410.03 kB gzip,2026-10-15)。
- **分层不放宽:** `web/src/architecture.test.ts` 一字不改(含 `CROSS_FEATURE_BASELINE`)。chat 只经 `~/features/agents`、`~/features/realtime`、`~/features/practice`、`~/features/lookup`、`~/features/grammar` 的 index(已在基线里);**不新增** `chat->progress` 边(时区偏移搬到 `lib/`,W1)。agents 新组件一律 `lazy-parts.tsx` 的 `/* @__PURE__ */ part(...)`。
- **不改 `enjoy/`**;上游 UI 只经 `@renderer/components/ui/*` 与 `web/src/shims`。
- **隐私(根 `CLAUDE.md`、服务端计划 Global Constraints、`server/app/links/CLAUDE.md`):** URL 里只有对话 id(`/chat/:id`)与固定路径(`/chat`、`/chat/new`);**永远没有**问候文本、消息文本、词、角色文本、用户 id。查询参数只有 `page`、`per_page`、`hide_idle_daily`、`tz_offset_minutes`。代码里不 `console.*` 问候正文 / 事实 / 消息;错误对象只带错误码。`localStorage` 只存日期与布尔标记(键见 FR8),**不存**问候正文或 `/today` 响应(只放内存,登出清空)。不向任何第三方主机发请求(全部同源 `/api/*`)。
- **液态玻璃:** 只追加 `liquid:` / `LQ_*` 类,不改已有 token 的值;新 token(问候极光色等)两套(light / dark)都加,并过 `styles/theme.test.ts`、`liquid-tokens`、`liquid-colour-guard`;**新组件不使用 backdrop-filter**(演示页「跳过」胶囊的 `blur(12px)` 去掉,问候底色本就不透明),所以 `styles/glass-budget.test.ts` 的 `BLUR_OWNERS` 不加行。
- **主包预算:** 新主页、抽屉、设置面板、问候弹窗全部懒加载;主包净增量 ≤ **0.5 kB gzip**(`yarn web:build && cd web && node scripts/check-main-bundle.mjs --max-delta=0.5`)。只有 W13 可以 `--record` 新基线(且只在变小或用户同意时)。
- **提交:** conventional(`feat(web): …`、`refactor(web): …`、`test(web): …`、`docs: …`),一个任务一个提交,每个提交后本任务列出的测试 + `yarn web:typecheck` 全绿;只按路径 `git add`,**不要** `git add -A`(工作树里有大量用户未提交改动)。提交信息以空行 + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。
- **测试只跑本任务列出的** + `yarn vitest run src/architecture.test.ts`;全量 `yarn web:test`、`yarn web:build`、主包检查在 W7、W13 跑;E2E、容器重建、部署只在用户要求时做。
- **README 同步:** `web/README.md` 记录行为与「真机未验证」项(`web/CLAUDE.md` 要求);截图按 `docs/CLAUDE.md` 在 UI 明显变化后替换(W13)。
- **上线后:** 合并、部署、验证后按 `docs/CLAUDE.md` 起草 changelog 条目并提醒用户导入(服务端计划已有同样一条,合并成一条「对话主页」草稿)。

---

## §1 已定的产品规则(摘自服务端计划 §1 / §3 与演示页,不再讨论)

1. `/chat` = 今天的默认对话(每天新建,用户本地日),历史在左侧抽屉;默认对话不计入 200 上限(R12);用户没回过的旧默认对话在列表里隐藏(`hide_idle_daily=true`,R11)。
2. 问候**恰好 3 段**(① 开场 + 连续天数 ② 待复习 + 昨天错点 ③ 今天怎么练;服务端 §1 第 21 条),首次打开当天一次 AI 调用生成,已存为当天对话的前 3 条助手消息(R4、R6);长度上限见服务端 §4(`zh` 每段 ≤ 60 字、合计 ≤ 160;`en` 每段 ≤ 160 字符、合计 ≤ 420;双语副句每段 ≤ 60、合计 ≤ 130;每段 ≤ 2 句、≤ 3 处强调;`max_tokens=600`),已按演示页三段核对放得下(服务端 §4 容量核对);`every_open` 只重放弹窗、**不追加消息**;`off` 不生成、不弹,但仍每天建空默认对话(R8)。
3. **弹窗只在对话主页 `/chat` 出现**;别的页面、深链(含 `/chat/:id`,即使它就是今天的对话)都不弹;「打开」发生在别处时记「本次打开待弹」,本次打开期间第一次进入 `/chat` 再弹;标记不持久化(R8)。「打开」= 冷启动,或从后台回到前台且隐藏 ≥ 30 min;`online` 事件不算。
4. `daily`:服务端 `first_view=true` 才弹,弹后调 `seen`(跨设备一次)。
5. 问候语言 `zh / en / bilingual`(演示页的 `both` = `bilingual`);`zh` 的 `lines` 纯中文;`bilingual` 每行 `en` 在上、`zh` 小字在下。改语言只影响以后每天 + 今天对话的回复提示(`zhNote` / `bilingual`),**今天已存的问候不重写**(R7)。
6. 弹窗只显示问候文字(`*…*` 强调高亮,R17),不显示助手名字 / 头像;学习数据以小字放底部,`include_stats=false` 时不显示(服务端返回 `facts={}`,R16)。对话里的问候是普通助手消息,沿用气泡(这里显示角色头像)。
7. 角色:默认 `builtin:partner`「学习伙伴」;每个对话在右上角设置里选 / 换;新对话先建后选(服务端 §1 第 5 条、R10)。
8. iOS:弹窗默认不自动出声(需要用户手势)。
9. **2026-10-23 用户采纳原 §11 Q1–Q11 的推荐答案(服务端 §1 第 22–31 条),已并入下文:** config 键 snake_case(FR0);v1 不做快捷回复胶囊、不做角色自动开场白(§13 以后的任务);通话按钮留在顶栏(FR4);抽屉按最近活动日分组、今天置顶(FR7、FR9);设置面板有「问候里提学习数据」开关(FR5);「重播今天的问候」保留为用户功能,只弹窗不追加(FR5、FR10);今天置顶的对话可以删除(FR7);单条消息复制 / 删除与手动改名不在范围(§13);保留强调高亮(FR19);长度与 `max_tokens` 已核对(上面第 2 条)。

---

## §2 本计划的裁定(FR = frontend ruling)

- **FR0 会话 config 的键名是 snake_case(已定,用户采纳;服务端 §1 第 22 条、R7、R10)。** `web/src/api/client.ts` 发送时 `decamelizeKeys(..., { deep: true })`、接收时 `camelcaseKeys(..., { deep: true })`;所以网页写进 `conversations.config` 的键**落库是 snake_case**(`conversation-page.agent.test.tsx`「writing only agent_persona_id」钉住了这一点:`agent_persona_id`、`auto_speak`、`tts_model`、`bilingual`)。服务端读写一律 `zh_note`、`agent_persona_id`(`DAILY_CONFIG_DEFAULTS` 的其他键也用 snake_case,camelCase 的 `zhNote` 不认);网页类型里叫 `zhNote` / `agentPersonaId`(客户端自动转换),网页代码**不手写** snake_case 键名。由契约夹具 `server/tests/fixtures/chat_home_contract.json` 的 `conversation.config` 钉住,W2 的契约测试断言 `zhNote` / `agentPersonaId` 能被 `ConversationConfig` 读出、`PATCH` 体里是 `zh_note` / `agent_persona_id`。
- **FR1 路由。** `CHAT_HOME_ENABLED` 开:`/chat` → `ChatHomeRoute`(今天的对话 + 可弹问候);`/chat/new` → 新对话草稿(只在本地,不建服务端对话,见 FR6);`/chat/:id` → 同一外框显示该对话(**从不弹问候**)。关(或 `/config` 失败 / 404 / 加载中超过 3 s):`/chat` → 旧 `ConversationsPage`、`/chat/:id` → 旧 `ConversationPage`(原样),`/chat/new` → `<Navigate to="/chat" replace>`。`app.tsx` 只改这三条 `<Route>` 的 element(换成 `~/features/chat` 导出的 `ChatIndexRoute` / `ChatNewRoute` / `ChatConversationRoute`,它们内部按开关选新旧),`bottom-nav.tsx` 不动(`/chat*` 仍高亮「对话」)。
- **FR2 开关读取。** `home/use-chat-home-config.ts`:`GET /api/chat-home/config` 按 `ApiClient` 缓存一次成功结果(同 `use-rooms-enabled.ts`:失败删缓存、下次挂载再试);返回 `{ status: "loading" | "on" | "off" }`。加载中渲染骨架(`aria-busy`),3 s 仍无结果按 `off` 渲染旧页面(避免卡死;下次挂载再试)。该钩子在主包里(很小),新主页本体懒加载。
- **FR3 对话视图零行为变化的外框插槽。** `ConversationPage` 加可选 props(全部缺省 = 现状,一字节 DOM 都不变):`conversationId?: string`(缺省读 `useParams`)、`chrome?: ConversationChrome`(`renderLeading(ctl)`、`renderActions(ctl)`、`renderTitle?(ctl)`、`beforeMessages?(ctl)`、`renderMessage?(m, defaultNode, ctl)`、`emptyState?(ctl)`、`onLoaded?(conversation)`)。`ctl` 是页面已有能力的只读句柄:`conversation`、`config`、`options`、`personaName`、`saveSettings`、`toggleBilingual`、`toggleAutoSpeak`、`openSettings`、`openRecap`、`startCall`、`callState`(`canCall / callDisabled / callBlockedReason / callButtonRef`)、`choosePersona`、`busy`(sending / voiceBusy / call / settling / tutor)。旧外框(返回按钮 + `ChatPersonaControl` 芯片 + `ConversationHeaderActions`)抽成 `classic-chrome.tsx`,作为缺省值。**`conversation-page.test.tsx`(226 个用例)与 `conversation-page.agent.test.tsx`(24 个)在 W4 提交里一字不改且全绿,是本次重设计的回归网。**
- **FR4 新外框的顶栏。** 左:历史按钮(`data-testid="chat-history-open"`,`aria-haspopup="dialog"`、`aria-controls`、`aria-expanded`)。中:标题(今天的对话 =「今天 · 周五」/ "Today · Fri";其他 = 对话名;副标题 = 角色名 ·「每日对话」或日期标签)。右:**通话按钮保留**(`data-testid="conversation-call"`,与现在同一 gating 与 `callButtonRef` 焦点归还)+ 设置按钮(`data-testid="chat-settings-open"`)。演示页右上角只有设置;通话是一键核心能力,收进面板会多一步,所以保留在顶栏、设置按钮左边(已定,用户采纳)。旧的「调整」弹出面板(`conversation-options`)在新外框里不出现,它的 5 行整体搬进设置面板,**testid 不变**(FR5)。
- **FR5 设置面板(`home/chat-settings-sheet.tsx`,复用 `~/components/bottom-sheet`)。** 自上而下:
  1. 「角色 · 本对话」:单选列表(`role="radiogroup"`,内置 + 自建角色,来自 agents 新懒组件 `PersonaRadioList`,行 testid 沿用 `agent-persona-<id>`)+ 末行「更多角色 / 管理…」打开现有 `PersonaPicker`(含「不使用角色」`agent-persona-none`、新建 / 编辑自建角色)。今天的默认对话额外一行开关「以后每天都用这个角色」(`chat-daily-persona`,写 `PATCH /api/chat-home/settings {daily_persona_id}`)。带学进行中整组禁用(同现在芯片)。智能体关闭(`useAgentsConfig().enabled=false`)时整节不渲染(同 `ChatPersonaControl`)。
  2. 「问候语言 · 全局」分段:中文 / English / 中英双语(`chat-greeting-lang-{zh|en|bilingual}`,`role="radio"`)。改动 = `PATCH /api/chat-home/settings {language}`;若当前是今天的默认对话,再经 `ctl.saveSettings` 写今天对话的 `zhNote` / `bilingual`(R7;走现有 config 写入链,不会互相覆盖)。提示文案「今天的问候不变,明天起生效;回复提示立即生效」。
  3. 「问候时机 · 全局」分段:每天首次 / 每次上线 / 关闭(`chat-greeting-trigger-{daily|every_open|off}`)+ 说明行(文案按服务端规则写,不照抄演示页的「3 秒」调试说明,见 §9)。这一节末尾是开关「问候里提学习数据」(`include_stats`,`chat-greeting-stats`,`role="switch"`,44 px;已定,用户采纳;服务端 R16):改动 = `PATCH /api/chat-home/settings {include_stats}`;成功后把 store 里今天问候的 `facts` 本地置为 `{}`(关)——与服务端读取时规则一致,弹窗 / 问候组的底部数据立即消失;打开时不本地补数据,下次 `POST /today` 返回什么就显示什么。说明文案「关闭后,问候不再提连续天数、待复习和错点;今天的问候正文不变,明天起生效」。`trigger=off` 时开关仍可改(影响以后)。
  4. 「本对话」:双语翻译(`conversation-bilingual`)、自动朗读(`conversation-autospeak`)、语速(`conversation-speed`)——组件与行为从 `conversation-header-actions.tsx` 搬来(抽成 `options-rows.tsx` 两处共用,旧弹出面板也改用它,DOM 不变)。
  5. 行:复盘(`conversation-recap` → 现有 `RecapSheet`)、更多对话设置(`conversation-settings` → 现有 `ConversationSettingsSheet`:场景 / 自定义场景 / 系统提示词 / 难度 / 模型 / 朗读模型与音色 / 自动朗读 / 双语 / 语法检查 / 教练模式,**原样**)、重播今天的问候(`chat-greeting-replay`;已定,用户采纳为用户功能,不只调试):只在当前对话 = 今天的默认对话、且 store 里有 `status==="ready"` 的问候(3 段)时显示;点击 → 关闭设置面板 → 用 store 里的同一组 `lines` 打开 `GreetingModal`(`mode="replay"`),**不调用** `/today`、不调 `seen`、不写本机 `shown`、**不向对话追加任何消息**;关闭时照常飞入对应气泡(FR14)。与 `trigger` 无关(`every_open` / `daily` 都可重播;`off` 的日子没有问候,所以不显示)。
  分段控件是 `radiogroup`,方向键切换,每段 44 px 命中;「完成」按钮 44 px。全局设置的读取用 `GET /api/chat-home/settings`(打开面板时取一次,模块缓存),失败时这两节显示重试行,不影响本对话的其他行。
- **FR6 新对话 = 本地草稿。** 抽屉里 [+ 新建对话] → `/chat/new`:空状态(演示页「新对话」:图标 + 「先选一个角色……」+ [选择角色] 主按钮)+ 次按钮 [从场景开始](打开**现有** `ScenarioSheet`,原样:预设 / 自定义场景 / 难度 / 生成并保存开场白 / 开场白朗读 `speakOpening`,成功后 `navigate(/chat/:id, { state })`,与旧列表同一回调)+ 设置按钮脉冲 + 首次使用提示气泡(FR8)。选了角色 → `POST /api/conversations {name: DEFAULT_CONVERSATION_NAME, config: {agentPersonaId, …角色音色}}` → `navigate(/chat/:id, { replace: true })`;用户不选角色直接在草稿输入框发送 → 先建无角色对话再发送(旧路径,保持「没有角色时完全不变」)。草稿不建服务端对话,所以随手点开不会留下空对话、不占 200 上限。智能体关闭时空状态只有 [直接开始] 与 [从场景开始]。角色对话**不自动生成开场白**(已定,用户采纳:v1 不做;演示页的 `opener` 是 mock,现有服务端没有「角色开场」回合;列为以后的任务,§13)。选好角色后显示的是 FR11 的空状态。
- **FR7 历史抽屉(`home/history-drawer.tsx`)。** Radix Dialog(已在主包依赖里)做模态外壳:焦点圈定、`aria-modal`、Esc 关闭、关闭后焦点回到历史按钮;内容是 `fixed` 左侧面板,宽 `min(82vw, 340px)`(手机内是 82cqw;页面里用 vw,因为抽屉是视口级 `fixed`),高 `100dvh`,`z-index` 高于底部标签栏与查词层;遮罩 `--scrim`(不模糊)。左滑关闭:手写 pointer 事件(横向位移 > 10 px 且 > 1.2 × 纵向才接管;松手位移超过 `min(80px, 25% 宽)` 关闭,否则回弹;接管后吞掉随后的 click),逻辑抽成纯函数 `home/swipe-close.ts`(可测)。内容:标题「对话」→ [+ 新建对话](`chat-history-new`)→ 今天置顶卡(`chat-history-today`,「今日 · 每日对话」+ 日期 + 问候 / 最后一条预览 + 小字数据;`aria-current` 指当前对话;**今天置顶规则:** 卡片来自 store 里 `POST /today` 的 `conversation`,不论它的 `updatedAt` 是什么都固定在最上面,分组列表按 id 把它去掉,不出现两次)→ 按最近活动日分组的历史(组标题 = FR9 的日期标签,行 `conversation-item`,行尾「更多」按钮 → 删除确认,沿用 `conversation-delete` / `conversation-delete-confirm` 与现有 `AlertDialog` 文案)→ [加载更多](`GET /api/conversations?page&per_page=20&hide_idle_daily=true&tz_offset_minutes`,按 id 去重,同现有列表)。选中一行 → 关闭抽屉 + `navigate(/chat/:id)`(今天置顶卡 → `/chat`,不会弹问候,因为标记已在本次打开消费或不存在)。加载 / 空 / 失败重试三态沿用现有列表文案。**今天置顶卡可以删除(已定,用户采纳;服务端 R4、§1 第 28 条):** 卡片行尾同样有「更多」→ 删除(`chat-history-today-delete`)→ 现有 `AlertDialog`,正文换成专用文案「删除今天的对话?你在里面的回复会被删除;今天的问候会保留,对话会重新开始。」(`conversation-delete-confirm` 同 testid)→ `DELETE /api/conversations/{id}` 成功后:清空 store 里的 `/today` 结果(`pendingModal` **不**置位)→ 立即 `POST /today`(复用当前 `tz_offset_minutes`、新的 `client_request_id`;这不是一次「打开」,不弹窗、不调 `seen`)→ 服务端按 R4 新建当天对话并写回 3 段问候(不调用 AI)→ store 更新为新的对话 id 与 `messageIds`;若当前就在 `/chat`,`ChatIndexRoute` 随 store 换成新对话(`ConversationPage` 以新 `conversationId` 重新加载);若在 `/chat/:旧id`,`replace` 到 `/chat`。重建请求失败 → FR11 的错误态 + 重试。删除失败 → 现有失败提示,store 不动。
- **FR8 首次使用提示。** 新对话第一次出现时,右上角设置按钮加脉冲环,并在其下方显示提示气泡(`role="note"`,「在这里选择角色 / 每个对话都可以有自己的角色,随时能换。」+ [知道了]);点「知道了」或打开设置面板即永久关闭。记在 `localStorage["enjoy.chatHome.roleHintSeen"]="1"`(try/catch;读写失败 = 每次显示,不报错)。`prefers-reduced-motion` 时无脉冲。
- **FR9 日期标签(`home/date-label.ts`,纯函数)。** `dateLabel(day, today, lang)`:同日「今天 / Today」,前一日「昨天 / Yesterday」,其余 zh `2026-10-21 周三`、en `Wed 2026-10-21`(星期用 `Intl.DateTimeFormat(lang, { weekday: "short" })`)。**分组键 = 最近活动日(所有行都用 `updatedAt` 的本地日,含默认对话)**,与服务端列表 `updated_at desc, id desc` 排序一致,同一组不会被拆散(已定,用户采纳;服务端 R11、§1 第 25 条;服务端在写消息、写回问候、`PATCH` 对话时刷新 `updated_at`)。默认对话的 `dailyDate`(服务端给的本地日字符串,不经时区换算)只用于它自己的行标题 =「每日对话 · 10月21日 周三」(本地化),所以即使它落在「今天」组也能看出是哪一天的。今天的默认对话不进分组(FR7 今天置顶规则)。
- **FR10 打开检测与问候时机(`home/chat-home-open.ts` + `register-chat-home.tsx`)。** 核心贡献 `contribute({ point: "appEffects", id: "chat.home-open", component: ChatHomeOpenEffect })`(无 `link`,永远挂载;文件只被 `plugins/core.ts` 导入;重的部分动态 `import()`)。行为:
  - 冷启动(组件首次挂载)与 `visibilitychange` 回到可见且隐藏 ≥ `RESUME_GAP_MS = 30 * 60_000`(`online` 事件不算)→ 若 config = on:`POST /api/chat-home/today {tz_offset_minutes, client_request_id}`(`client_request_id` 每次打开一个 uuid,重试复用),结果放模块级 store `home/chat-home-store.ts`(`useSyncExternalStore`)并把 `openSeq += 1`、`pendingModal = true`。
  - `status: "pending"` → 1.5 s 后重试,最多 4 次(R5);仍 pending → 本次打开不弹(标记保留,下次进入 `/chat` 时先重新 `POST /today` 一次)。网络失败 → 不弹、不重试风暴;对话主页显示「今天的对话加载失败 · 重试」(FR11),**绝不在客户端造对话**。
  - 跨过本地午夜而 App 一直在前台:进入 `/chat` 时若 `localDate(now) !== store.localDate` 视为一次「打开」重新 `POST /today`(服务端按偏移决定日)。
  - 弹窗条件(只在 `ChatIndexRoute` 里判断):`pendingModal && status==="ready" && greeting && lines.length===3 && trigger!=="off"`,且 `daily` 需 `greeting.firstView === true`、`every_open` 不看 `firstView`;再加本机防重:`localStorage["enjoy.chatHome.shown"] === localDate` 且 trigger=`daily` → 不弹(防止 `seen` 请求失败导致同一天同一设备反复弹;只存日期)。弹出即 `pendingModal = false`。
  - `seen`:弹窗**出现时**调 `POST /api/chat-home/greetings/{id}/seen`(幂等),失败静默并在下次打开重试一次;同时写本机 `shown` 日期。`every_open` 也调(服务端幂等,置位一次)。
  - trigger 读取:`/today` 响应不含 trigger,用 `GET /settings` 的缓存值;尚未取到时 `status==="off"` 即视为 off,否则取一次再判断(最多多一个请求)。
  - 不算「打开」的 `/today` 调用:删除今天的对话后的重建(FR7)与重播(FR5,根本不调用)都不置 `pendingModal`、不弹窗、不调 `seen`。
- **FR11 今天的对话(`ChatIndexRoute`)。** store `ready/off` → 渲染 `ConversationPage conversationId={today.conversation.id} chrome={homeChrome}`;loading → 骨架;error → 空态 + 重试(重试 = 重新 `POST /today`),抽屉仍可打开(历史列表独立加载)。`off` 或问候失败时今天的对话可能是空的 → `emptyState`:「今天还没有聊天 / 用英语说一句吧」(不出现「选择角色」,因为默认对话有角色)。
- **FR12 对话里的问候组。** 当前对话 = 今天的默认对话且 store 里有 `greeting.messageIds`:`renderMessage` 把这几条连续消息包成「问候组」(`data-testid="chat-greeting-group"`:小标题「✦ 今日问候 · 08:42」、第 1 条用 lead 样式、组尾小字数据;每个气泡 `data-gl={i}` 供飞入定位)。**可见文字**用 `lines[i]` 经 FR19 的 `EmphasisText` 渲染(带强调,演示页同款;双语 = 英文主句 + 中文副句小字),前提是 `stripEmphasis(line)` 拼出的正文与该消息 `content` 一致;不一致(例如被别处改过)→ 用原消息内容(MarkdownText 原样)。**气泡动作一律用原消息内容**,所以照旧:朗读(中文被 `speechText` 跳过)、翻译、跟读、查词(`data-lookup-context` 包在可见文字外层,查词读的是 DOM 文本,不含 `*`)。消息被单独删掉 / id 对不上 → 退回普通气泡(无组样式)。历史日子的问候没有标记,显示为普通助手气泡(服务端不返回旧日 `message_ids`;够用)。演示页切换语言时问候气泡原地换文——与 R7 冲突,**不做**(§9 偏差表)。
- **FR13 动画实现:手写 CSS + Web Animations API,零依赖。** 理由:主包预算 0.5 kB、懒块无硬上限但每 kB 都影响首开;演示页本就是原生实现(BlurText / SplitText / CountUp / Aurora 已用 WAAPI + CSS 重写,注释为证);framer-motion / gsap 都不在依赖里,引入会让懒块大一个数量级且没有必要。约定:所有 `el.animate` 经 `home/motion.ts` 的 `animate(el, kf, opts)` 包装——`typeof el.animate !== "function"`(jsdom)或减弱动效时直接跳到终态并同步调用 `onfinish`;`prefersReducedMotion()` 读 `matchMedia` 并订阅变化。减弱动效下:问候文字 240 ms 淡入、无逐字、无飞入(320 → 180 ms 淡出)、抽屉 / 面板无滑动、无脉冲 / 光泽 / 极光漂移;倒计时仍给满 5 s。
- **FR14 问候弹窗时间轴(照演示页 `buildGreeting` / `openGreeting` / `closeGreeting`)。** 0 背景淡入 200 ms(减弱 120)→ 150 日期逐词上浮 → 350 第 1 行 BlurText(lead 大字)→ 1350 第 2 行 → 2250 第 3 行(每行铺开 ≤ 1 s,英文按词、中文按字,`home/greeting-tokens.ts` 纯函数分词;双语副行在主行结束前 400 ms 以 SplitText 出现)→ 第 2 行开始后 500 ms 底部数据淡入 + CountUp(700 ms,从 60% 起数)。**倒计时在第 3 行(最后一行)开始出现时启动,5000 ms**(`COUNTDOWN_MS`),环形进度 + 秒数(服务端保证恰好 3 行;不是 3 行时根本不弹,FR10)。强调片段(FR19)在逐词 / 逐字铺开时保留 `<em>` 样式(分词结果带 `em` 标记)。轻点任意处 / [跳过] / Enter / Space / Esc 随时进入;指针悬停在「跳过」上(`(hover: hover)`)或页面隐藏时暂停倒计时。内容放不下时整体按 0.05 缩小到下限 0.72(`fitGreeting`,ResizeObserver,只读布局尺寸);按服务端 §4 上限(`en` 合计 ≤ 420 字符、`zh` ≤ 160 字、双语再加 ≤ 130 字副句)在 320×568 下应能放下,W8 用最长样例(服务端 §4 容量核对的最长填充)加一条结构断言,真机观感见 §8。关闭:逐行 FLIP 飞向对话里 `data-gl` 对应气泡(640 ms,行间 70 ms,72% 处到位后与气泡文字交叉淡化),日期与底部淡出,背景 520 ms 淡出;对话还没渲染好 / 行数不等 / 减弱动效 → 整体淡出。关闭后停留在 `/chat`,焦点回到打开前的元素或消息列表。
- **FR15 弹窗的无障碍。** Radix Dialog(`aria-modal`、`aria-label`「今日问候」、焦点圈定、背后 `aria-hidden`);逐字 span 一律 `aria-hidden`,另放一份 `sr-only` 的完整行文(读屏不会逐字念);底部数据也有完整的读屏文字(「连续学习 23 天,12 个词待复习」)。「跳过」是真按钮(44 px,`aria-label`「跳过问候,进入今天的对话」)。自动关闭不丢信息(内容就在对话里,WCAG 2.2.1 的「不丢失内容」情形),并在悬停 / 页面隐藏时暂停;倒计时数字 `aria-hidden`(不每秒播报)。对比度:小字 `--greet-ink-2` 在极光上 ≥ 4.5:1(演示页已校;W11 用 `theme.test.ts` 同款计算钉住)。
- **FR16 安全区与层级。** 弹窗:`fixed inset-0`,内边距 `max(32px, env(safe-area-inset-top)+20px)` / 底部 `calc(20px + env(safe-area-inset-bottom))`,盖住底部标签栏与查词层(`z-index` 取现有最高层之上,W0 读出现值);弹窗与抽屉打开时 `LookupLayer` 的选词不应触发(Radix 让背后 `aria-hidden` + `pointer-events:none`,W8 加测试)。抽屉头部 `max(12px, env(safe-area-inset-top)+8px)`、列表底部留 `env(safe-area-inset-bottom)`。对话页本体的输入条、`--dock-space`、`--tab-bar-space` 逻辑原样(FR3 不碰)。
- **FR17 i18n。** 新文案进 `web/src/features/chat/i18n/{en,zh-CN}.json` 的 `web.chat.home.*`(两份键一致;`locales` 测试会比对)。**界面语言**(i18n,`useSettings().language`)与**问候语言**(`chat_prefs.language`)是两件事:设置面板的分段标签固定写「中文 / English / 中英双语」(每种界面语言下都一样,便于辨认)。问候正文来自服务端,不翻译。
- **FR18 登出清理。** `features/chat/index.ts` 增加导出 `clearChatHomeCache`(清 store、config / settings 缓存、`openSeq`),由 `auth/device-data` 与现有 `clearHintsMemory` 等一起调用;`localStorage` 里的两个键也一并删除(只是标记,删了无害)。
- **FR19 强调渲染(已定,用户采纳;契约 = 服务端 R17)。** `home/emphasis.ts` 纯函数:`parseEmphasis(line): Array<{ text: string; em: boolean }>`、`stripEmphasis(line): string`。规则与服务端 `normalize_marks` 相同:只认单星号 `*…*`;合法 = 成对、不嵌套、内容 1–24 字符且不含 `*` / 换行 / `<` / `>`、每条 ≤ 3 处(`**x**` 先规范成 `*x*`);任何违规 → 整条当纯文本并去掉所有 `*`(服务端已保证不会出现,这里只是防御)。`home/emphasis-text.tsx` `EmphasisText` 把片段渲染成 React 文本节点与 `<em className="greet-em">`(样式取演示页 `em`),**禁止 `dangerouslySetInnerHTML`**(`home-skin.test.tsx` 读源码断言 `home/` 下没有它)。使用处:弹窗(FR14,分词保留 `em`)、问候组可见文字(FR12)、飞入克隆。读屏 / sr-only 全文、`aria-label`、朗读一律用 `stripEmphasis`。不支持任何其他标记(Markdown、链接、HTML)。

---

## §3 现有对话能力清单(读代码所得,共 64 项)

路径都相对 `web/src/`。「现有测试」是该能力目前的回归保护,W4 之后必须一直绿。

### A. 对话列表与生命周期
| # | 能力 | 位置 | 现有测试 |
|---|---|---|---|
| F01 | 对话列表分页(20 条 / 页,加载更多,按 id 去重,连点只取一次) | `features/chat/conversations-page.tsx`、`chat-api.ts` `listConversations` | `conversations-page.test.tsx`(appends the next page…) |
| F02 | 列表加载中 / 空 / 失败重试;切语言不丢已加载页 | 同上 | 同上(loading / retry / language) |
| F03 | 删除对话 + 确认框(失败提示) | 同上 `AlertDialog`,`deleteConversation` | 同上(lists and deletes / failed delete);E2E `chat.spec.ts`「stream, persist, read aloud and delete」 |
| F04 | 液态皮肤列表(「继续」英雄卡、分组面板、不模糊的新对话胶囊) | `conversation-list-liquid.tsx` | `conversations-page.test.tsx`(hero / empty state) |
| F05 | 新建:场景面板(自由 / 8 个预设 / 自定义场景 + 难度) | `scenario-sheet.tsx`、`scenarios.ts`、`levels.ts` | `conversations-page.test.tsx`、`scenarios.test.ts`、`levels.test.ts` |
| F06 | 场景开场白生成并保存;失败可重试、关闭 / 卸载 / 改选时删掉空对话;防连点 | `scenario-create.ts`、`scenario-sheet.tsx` | `scenario-create.test.ts`、`conversations-page.test.tsx`(6 个用例) |
| F07 | 开场白到达后自动朗读(路由 state `speakOpening`,刷新不再读) | `conversation-page.tsx` `speakOpeningRef` / `openingKey` | `conversation-page.test.tsx`;E2E「scenario: the opening line…」 |
| F08 | 首对消息保存后自动改名(`titleFrom`,默认名时) | `conversation-page.tsx` `renameAfterSave` | `conversation-page.test.tsx` |
| F09 | 服务端错误翻译(上限、未找到、上游、配额……) | `chat-api.ts` `CHAT_SERVER_ERRORS`、`~/api/error-messages` | `chat-api.test.ts`、页面测试 |

### B. 文字对话与智能体
| # | 能力 | 位置 | 现有测试 |
|---|---|---|---|
| F10 | 文字发送 + 流式回复(旧补全路径:系统提示词 / 场景 / 难度 / 历史上限) | `conversation-page.tsx` `send`、`chat-request.ts`、`~/api/ai` `streamChatCompletion` | `conversation-page.test.tsx`、`chat-request.test.ts`;E2E chat |
| F11 | 角色对话走 `/api/agents/turn` SSE | `send` 的 `agentId` 分支、`features/agents/turn-stream.ts`、`sse.ts` | `conversation-page.agent.test.tsx`、`agents/turn-stream.test.ts`、`sse.test.ts` |
| F12 | 保存队列串行化、"可能已保存"核对认领、永久失败丢弃、未保存提示 + 重试 | `conversation-page.tsx` `saveOne` / `drainSaves` / `flushSaves` | `conversation-page.test.tsx` |
| F13 | 失败回复重试(`message-retry`,同一用户气泡不重录不重评) | `retry`、`message-bubble.tsx` | 同上 |
| F14 | 新发送时丢弃失败尾部 | `chat-turns.ts` `dropFailedTails` | `chat-turns.test.ts` |
| F15 | 助手回复 Markdown 渲染 | `message-bubble.tsx` `MarkdownText` | 页面测试 |
| F16 | 只在底部附近时自动滚动 | `onListScroll` / `nearBottomRef` | 页面测试 |
| F17 | 重新生成最新的智能体回复(先存新再删旧,失败可重试) | `regenerate`、`ProcessCapsule onRegenerate` | `conversation-page.agent.test.tsx`(3 个) |
| F18 | 过程胶囊(实时 / 存储)与来源标签 | `features/agents/process-capsule.tsx`、`source-chips.tsx`、`trace-save.ts` | `agents/process.test.tsx`、`trace.test.ts`、`trace-save.test.ts` |
| F19 | 中文说明 `note_zh` 折叠(不朗读) | `AgentNote`、`withNote` | `conversation-page.agent.test.tsx` |
| F20 | 智能体关闭 / 回合 disabled → 「切回普通对话」 | `agentsOff` / `turnDisabled`、`agent-off-notice` | 同上(2 个) |
| F21 | 角色芯片 + 选择器(选 / 换 / 不用角色、角色音色、自建角色新建 / 编辑) | `features/agents/chat-parts.tsx` `ChatPersonaControl`、`persona-picker.tsx`、`persona-chip.tsx`、`persona-editor-sheet.tsx`;页面 `choosePersona` | `agents/persona-picker.test.tsx`、`persona-editor-sheet.test.tsx`、`conversation-page.agent.test.tsx` |
| F22 | 带我学(入口、开始面板、带学条、继续、结束、总结卡、语音作答切按住说话、带学中锁角色 / 无重新生成) | `TutorEntry` / `TutorBarSlot`、`features/agents/tutor/*` | `agents/tutor/*.test.tsx`、`conversation-page.agent.test.tsx`(5 个) |
| F23 | 教练模式(提示词里附教练提示) | `coach.ts`、`send` | `coach.test.ts`、页面测试 |

### C. 语音消息
| # | 能力 | 位置 | 现有测试 |
|---|---|---|---|
| F24 | 输入栏文字 / 语音切换并记住(登出清除) | `composer-mode.ts`、`chat-mode-toggle` | `composer-mode.test.ts`、页面测试 |
| F25 | 按住说话(上滑取消、上滑转文字、太短 / 未就绪提示、60 s 计时) | `hold-to-talk-button.tsx`、`~/components/hold-to-talk-bar`、`~/lib/hold-gesture`、`use-voice-turn.ts` `VOICE_MAX_MS` | `hold-to-talk-button.test.tsx`、`use-voice-turn.test.tsx`;E2E `hold-to-talk.spec.ts`(4 个) |
| F26 | 转写后发送;忙时保留草稿「发送这段」;转写失败重试;丢弃;处理中取消 | `onVoiceDraft` / `onVoiceTranscribed` / `sendDraft` / `discardDraft`、`chat-mic-cancel` | `use-voice-turn.test.tsx`、`voice-ui.test.tsx`、页面测试 |
| F27 | 语音气泡回放(本地 blob 或评测录音) | `voice-play-button.tsx` | `voice-ui.test.tsx`;E2E voice message |
| F28 | 转写文字按评测逐词着色 | `voice-transcript.tsx`、`voice-words.ts` | `voice-words.test.ts`、`voice-ui.test.tsx` |
| F29 | 音频焦点(录音时不播放)与 iOS 手势内解锁 | `~/audio/audio-focus`、`autoSpeak.prime`、`primeAudioElement` | `use-tts-player.test.tsx`、页面测试 |

### D. 评测与语法纠错
| # | 能力 | 位置 | 现有测试 |
|---|---|---|---|
| F30 | 语音回合发音评测 + 发音徽章 + 疑似混入他人声音提示 | `turn-results.ts`、`result-badges.tsx`、`mixed-voices.ts` | `turn-results.test.ts`、`result-badges.test.tsx`、`mixed-voices.test.ts` |
| F31 | 每条用户消息语法检查(开关、非英文 / 太短跳过)+ 语法徽章 + 重试 | `turn-results.ts`、`english-check.ts`、`GrammarBadge` | `turn-results.test.ts`、`english-check.test.ts`;E2E grammar |
| F32 | 回合详情抽屉(分数、逐词)+ 语法详情(改正句 → 跟读) | `turn-detail-sheet.tsx`、`grammar-details.tsx` | `grammar-details.test.tsx`、页面测试 |
| F33 | 结果随消息保存或晚到 PATCH;409 / 评测丢失处理 | `saveOne`、`turn-results.ts` | `turn-results.test.ts`、页面测试 |

### E. 朗读
| # | 能力 | 位置 | 现有测试 |
|---|---|---|---|
| F34 | 每个气泡「听」/ 停止(`message-tts`) | `conversation-page.tsx` `BubbleActions`、`use-tts-player.ts`、`tts.ts` | `use-tts-player.test.tsx`、`tts.test.ts`;E2E chat |
| F35 | 自动朗读(按句流水线;自动播放被拦时「点一下朗读 / 关闭」提示;乐观开关) | `use-auto-speak.ts`、`sentence-stream.ts`、`sentences.ts`、`autospeak-blocked` | `use-auto-speak*.test.tsx`(3 个)、`sentence-stream.test.ts`、`use-tts-player-queue.test.tsx` |
| F36 | 语速(全局,`conversation-speed`) | `~/lib/playback-rate`、`conversation-header-actions.tsx` | 页面测试 |
| F37 | 朗读模型 / 音色选择(试听)与近场提示 | `voice-picker.tsx`、`conversation-settings-sheet.tsx` | `voice-picker.test.tsx`、`conversation-settings-sheet.test.tsx` |
| F38 | 选词操作条「朗读」(核心贡献 `selectionActions/chat.read-aloud`) | `read-aloud-action.tsx`、`register-selection-actions.tsx`、`plugins/core.ts` | `read-aloud-action.test.tsx`、`plugins/links-matrix.test.tsx` |

### F. 翻译与查词
| # | 能力 | 位置 | 现有测试 |
|---|---|---|---|
| F39 | 单条翻译开关(缓存、失败重试;英文界面不显示) | `use-message-translations.ts`、`message-translation.tsx`、`message-translate` | `use-message-translations.test.tsx`;E2E translation |
| F40 | 双语模式:新回复自动翻译(弹出面板 + 设置面板两处开关) | `toggleBilingual`、`conversation-bilingual`、`settings-bilingual` | 页面测试、`conversation-settings-sheet.test.tsx`;E2E translation |
| F41 | 点词查词(两次点按)与长按选词查词;查词条抬到输入条上方(`--dock-space`) | `message-bubble.tsx` `data-lookup-context`、`~/features/lookup` `LookupLayer`(在 `layout/app-shell.tsx`)、`~/components/use-dock-space` | `tap-lookup-bubble.test.tsx`、`bubble-actions.test.tsx`;E2E `lookup.spec.ts` |
| F42 | 对话相关抽屉里的查词标记 | `grammar-details.tsx`、`recap-sheet.tsx`、`turn-detail-sheet.tsx`、tutor 组件 | `src/lookup-marks.chat.test.ts` |

### G. 学习辅助
| # | 能力 | 位置 | 现有测试 |
|---|---|---|---|
| F43 | 提示(3 条建议回复:填入输入框 / 朗读 / 跟读 / 收藏到练习清单) | `hints.ts`、`use-hints.ts`、`hints-sheet.tsx`、`chat-hints` | `hints.test.ts`;E2E hints |
| F44 | 复盘(生成、存进 config、朗读、表达加入生词本、差词) | `recap.ts`、`recap-sheet.tsx`、`WordActions` | `recap.test.ts`;E2E recap |
| F45 | 气泡「跟读」→ 选句面板 → 跟读抽屉 | `sentence-practice-sheet.tsx`、`~/features/practice` `useShadowSheet` | `sentence-practice-sheet.test.tsx` |
| F46 | 收藏句子到练习清单 | `savePracticeItem` | E2E「save a reply sentence…」 |
| F47 | 难度选择 + 难度说明 | `levels.ts`、`~/components/level-hint` | `levels.test.ts`、`conversation-settings-sheet.test.tsx` |
| F48 | 设置面板:场景 / 自定义场景 / 系统提示词(计数,≤ 7500)/ 模型 | `conversation-settings-sheet.tsx` | `conversation-settings-sheet.test.tsx` |

### H. 实时通话
| # | 能力 | 位置 | 现有测试 |
|---|---|---|---|
| F49 | 通话入口 gating(服务端开、AudioContext、AI 配置已到、未发送状态时阻止并说明)+ 火山音色解析 + 伙伴名 | `startCall`、`callVoice`、`callPartnerName`、`conversation-call` | 页面测试 |
| F50 | 通话界面(票据 → 麦克风 → VAD / 按住说话、字幕、字幕翻译、转文字草稿、打字发送、挂断、页面隐藏即挂断) | `features/realtime/*` | `realtime/*.test.ts(x)`(8 个文件) |
| F51 | 通话结束收尾(等关闭 → 重载 → 补取)、通话里每句语法检查、焦点还给通话按钮 | `closeCall`、`onCallUserMessage`、`callResultsRef` | 页面测试 |

### I. 设置与选项
| # | 能力 | 位置 | 现有测试 |
|---|---|---|---|
| F52 | 顶栏「调整」弹出面板(双语、自动朗读、语速、复盘、对话设置) | `conversation-header-actions.tsx` | 页面测试(按 testid) |
| F53 | 设置面板草稿 / 差异保存、config 写入链(互不覆盖) | `conversation-settings-sheet.tsx` `diffConfig`、页面 `saveSettings` | `conversation-settings-sheet.test.tsx`、页面测试 |

### J. 跨功能与平台
| # | 能力 | 位置 | 现有测试 |
|---|---|---|---|
| F54 | 今日任务「对话一次」行 → `/chat`(联动 daily_tasks) | `register-daily-tasks.tsx`、`plugins/daily-tasks` | `plugins/links-matrix.test.tsx` 等 |
| F55 | 「对话用今日词」任务行 → `/chat`、词卡小标(联动 chat_words) | `plugins/chat-words/*` | `plugins/chat-words/*.test.ts(x)` |
| F56 | 段位阶段任务 `chat_turns` / `voice_turns` → `/chat` | `features/rank/stage-tasks.tsx` | rank 测试 |
| F57 | 底部标签「对话」在 `/chat*` 高亮 | `layout/bottom-nav.tsx` | `layout/bottom-nav.test.tsx`、`feature-flags.test.tsx` |
| F58 | 对话页液态皮肤(输入条 `mat-chrome-bar`、石墨色自己气泡、副标题行、Rule 4) | `conversation-page.tsx`、`message-bubble.tsx` | `styles/glass-budget.test.ts`、`liquid-*` 守卫、页面测试 |
| F59 | 登出清理(朗读缓存、提示缓存、输入栏模式) | `features/chat/index.ts` → `auth/device-data` | auth 测试 |
| F60 | 对话页按路由懒加载(R-W2)+ 主包基线守卫 | `lazy-pages.tsx`、`scripts/check-main-bundle.mjs`、`main-bundle-baseline.json`(410.03 kB) | `conversation-page.agent.test.tsx`(lazy route)、`yarn bundle:check` |
| F61 | 角色设置页 `/me/agents`、记忆页 `/me/agents/memory`(对话之外,但角色来自这里) | `features/agents/agent-settings-page.tsx`、`memory/*` | `agents/*.test.tsx` |
| F62 | 联机房间(群聊、`@角色名` 叫 AI)——独立功能 `/rooms` | `features/rooms/*` | `rooms/*.test.ts(x)`;E2E rooms |
| F63 | 对话消息计入学习事件 / 段位点 / 连续天数(服务端 `MessageSent`) | 服务端;网页只经同样的 `POST /messages` | 服务端测试 |
| F64 | 手机上输入条始终可见、键盘弹起不跳(`use-app-height`) | `layout/use-app-height.ts`、页面布局 | `layout/use-app-height.test.ts`;E2E「composer stays visible」 |

**不存在、无需迁移(用户举例里提到,但代码里没有):** 单条消息「复制」按钮、单条消息「删除」(只在「重新生成」内部删旧回复)、附件 / 图片消息、对话改名入口(只有自动改名)。已定(用户采纳):不在本次范围,列为以后的任务(§13)。

---

## §4 功能对照矩阵(现有 → 新布局 → 改哪些文件 → 怎么验证)

「保持」= 组件与逻辑不动,只是换了外框。所有「保持」项在 **开关开** 的新外框里另由 `home/chat-home-parity.test.tsx`(W7 新增)按 testid 逐项点一遍(下表「新测试」列的 P-x 编号对应它的用例)。

| # | 新布局中的位置 | 改动文件 | 验证 |
|---|---|---|---|
| F01 | 历史抽屉列表(`hide_idle_daily=true`,加载更多) | 新 `home/history-drawer.tsx`、`home/use-history.ts`;`chat-api.ts` `listConversations(api, page, perPage, opts?)` 增可选参数(旧调用不变) | 现有 `conversations-page.test.tsx` 绿(开关关);新 `history-drawer.test.tsx`(分页、去重、连点);`chat-api.test.ts` 加查询参数用例 |
| F02 | 抽屉三态 | 同上 | 新 `history-drawer.test.tsx` |
| F03 | 抽屉历史行「更多」→ 删除确认(同 testid);今天置顶卡也可删除,删除后立即 `POST /today` 重建并写回问候(FR7) | `history-drawer.tsx`、`chat-home-store.ts`(`rebuildToday`) | 新测试 P-1;新 `history-drawer.test.tsx` 删除今天用例(见 §7);E2E `chat.spec.ts` 删除步骤改为模式无关 helper,`chat-home.spec.ts` 删今天的对话一次 |
| F04 | 开关关时原样;开关开时由抽屉取代 | 不改 `conversation-list-liquid.tsx` | 现有测试(开关关) |
| F05 | 新对话草稿的 [从场景开始] → 原 `ScenarioSheet` | 新 `home/new-chat.tsx`;`scenario-sheet.tsx` 不改 | 现有 `conversations-page.test.tsx`;新 `new-chat.test.tsx`(场景按钮打开同一面板、成功后跳 `/chat/:id` 带 state) |
| F06 | 同上(创建 / 失败 / 丢弃逻辑都在 `ScenarioSheet` 内) | 不改 | 现有测试;新 P-2 |
| F07 | 同上,导航带 `speakOpening` | 不改 `conversation-page.tsx` 的这段 | 现有页面测试;新 P-2 |
| F08 | 草稿建出的对话仍用默认名 → 自动改名;今天的默认对话名是日期,不会被改名 | 不改 | 现有页面测试;新 `new-chat.test.tsx` 断言建对话体 `name = DEFAULT_CONVERSATION_NAME` |
| F09 | 保持;新增 `/api/chat-home/*` 错误码映射 | `home/chat-home-api.ts` `CHAT_HOME_SERVER_ERRORS` | 新 `chat-home-api.test.ts` |
| F10–F16 | 对话视图本体,保持 | W4 只加外框插槽 | 现有 `conversation-page.test.tsx`(226)全绿;新 P-3(新外框里发送 / 流式 / 重试) |
| F17–F20 | 保持(过程胶囊、中文说明、切回普通对话都在对话视图里) | 不改 | 现有 `conversation-page.agent.test.tsx`(24);新 P-4 |
| F21 | 设置面板「角色 · 本对话」单选 + 「更多角色 / 管理…」打开原 `PersonaPicker`(不使用角色、自建角色);顶栏副标题显示角色名;旧芯片只在旧外框 | 新 agents 懒组件 `features/agents/persona-radio-list.tsx`(+ `lazy-parts.tsx` 一行、`index.ts` 一行);`home/chat-settings-sheet.tsx`;页面 `ctl.choosePersona` | 现有 agents 测试;新 `persona-radio-list.test.tsx`、`chat-settings-sheet.test.tsx`(选角色只写 `agent_persona_id`,与现有用例同断言;带学中禁用;智能体关闭时不渲染) |
| F22 | 保持(入口在输入条提示行、带学条在输入条上) | 不改 | 现有 tutor 测试 + agent 页面测试;新 P-5 |
| F23 | 保持(设置 → 更多对话设置 → 教练模式) | 不改 | 现有测试;新 P-6 |
| F24–F29 | 对话视图输入条,保持 | 不改 | 现有测试;新 P-7(新外框里按住说话发送一条) |
| F30–F33 | 保持 | 不改 | 现有测试;新 P-8 |
| F34 | 保持;问候气泡也有「听」(朗读用原消息正文,不含 `*`) | `home/greeting-group.tsx` 只包外层,可见文字用 `EmphasisText`(FR12、FR19) | 现有测试;新 `greeting-group.test.tsx`(问候气泡有 `message-tts` / `message-translate` / `message-practice`;朗读文本无 `*`) |
| F35 | 保持;自动朗读开关从「调整」面板搬到设置面板「本对话」,同 testid | 新 `options-rows.tsx`(两处共用) | 现有页面测试(旧外框用同一组件);新 P-9 |
| F36 | 设置面板「本对话 · 语速」 | 同上 | 同上 |
| F37 | 设置 → 更多对话设置(原面板) | 不改 | 现有测试;新 P-6 |
| F38 | 保持(核心贡献与页面无关) | 不改 | 现有测试 |
| F39 | 保持;问候气泡也可翻译 | 不改 | 现有测试;新 `greeting-group.test.tsx` |
| F40 | 设置面板「本对话 · 双语翻译」+ 更多对话设置;今天的默认对话另受问候语言影响(R7) | `options-rows.tsx`;`chat-settings-sheet.tsx` 改语言时写 `zhNote` / `bilingual` | 新 `chat-settings-sheet.test.tsx`(改「中英双语」→ `PATCH /api/chat-home/settings` + `PATCH /api/conversations/{today}` 体含 `zh_note: "always"`、`bilingual: true`) |
| F41 | 保持;弹窗 / 抽屉打开时背后不可查词 | 不改气泡 | 现有 `tap-lookup-bubble.test.tsx`;新 `greeting-modal.test.tsx` / `history-drawer.test.tsx` 断言背后 `aria-hidden`;新 `greeting-group.test.tsx` 断言问候气泡里有 `data-lookup-context`;E2E lookup |
| F42 | 保持 | 不改 | `lookup-marks.chat.test.ts` |
| F43 | 保持(输入条提示行) | 不改 | 现有测试;新 P-10 |
| F44 | 设置面板「复盘」行(同 testid `conversation-recap`) | `chat-settings-sheet.tsx` 调 `ctl.openRecap` | 新 P-11 |
| F45–F46 | 保持(气泡「跟读」、提示里的收藏) | 不改 | 现有测试 |
| F47–F48 | 设置 → 更多对话设置(原面板,`conversation-settings`) | 不改面板 | 现有 `conversation-settings-sheet.test.tsx`;新 P-6 |
| F49 | 新顶栏右侧通话按钮(同 testid、同 gating、同焦点归还) | `home/home-chrome.tsx` 用 `ctl.callState` | 现有页面测试(旧外框);新 P-12(新外框:有未发送状态时 `data-blocked`、点击提示) |
| F50 | 保持 | 不改 | 现有 realtime 测试 |
| F51 | 保持(收尾 / 重载在对话视图内) | 不改 | 现有页面测试;新 P-12 断言通话结束后焦点回到新顶栏的通话按钮 |
| F52 | 旧外框原样;新外框里整体并入设置面板(行组件共用、testid 不变) | `options-rows.tsx`、`conversation-header-actions.tsx` 改用它(DOM 不变) | 现有页面测试(按 testid 点「调整」面板)在 W4/W6 后不改且绿 |
| F53 | 保持;新面板的全局项不进 config 链,本对话项走 `ctl.saveSettings` | 不改链 | 现有测试;新 `chat-settings-sheet.test.tsx`(连续改两项不互相覆盖) |
| F54–F56 | 链接目标仍是 `/chat`(开关开 = 今天的对话;本次打开有待弹时会弹问候,符合 R8「第一次进入 `/chat`」) | 不改 | 现有 plugins / rank 测试;新 `chat-home-route.test.tsx`(从 `/practice` 进 `/chat` 弹一次,再进不弹) |
| F57 | 保持 | 不改 | `bottom-nav.test.tsx`、`feature-flags.test.tsx` |
| F58 | 新组件按液态规则追加 `liquid:` 类;不加模糊层 | 新 home 组件、`index.css` 只加 `home` 段的非模糊样式(或 Tailwind 类) | `glass-budget`、`liquid-colour-guard`、`liquid-variant`、`theme.test.ts`;新 `home-skin.test.tsx`(两种皮肤下 testid 唯一) |
| F59 | 保持 + `clearChatHomeCache` | `features/chat/index.ts`、`auth/device-data` | 现有 auth 测试 + 新用例(登出后 store 为空、两个 localStorage 键已删) |
| F60 | 新主页同样懒加载;主包 ≤ +0.5 kB | `features/chat/lazy-pages.tsx` 加 `ChatHomePage` 懒包装 | `yarn web:build && node scripts/check-main-bundle.mjs --max-delta=0.5`;新 `chat-home-lazy.test.tsx`(路由组件是懒的) |
| F61 | 不变;设置面板「更多角色 / 管理…」里的编辑仍是同一组件 | 不改 | 现有 agents 测试 |
| F62 | 不变(独立路由);服务端 R15 改名后房间里写 `@学习伙伴` | 不改网页 | 现有 rooms 测试;changelog 草稿写明 |
| F63 | 不变(同一保存接口);问候是助手消息,不计连续天数 | 不改 | 服务端测试 |
| F64 | 保持(对话视图布局未动);抽屉 / 弹窗另按 FR16 处理安全区 | 不改 `use-app-height.ts` | 现有测试;§8 真机清单 |

**演示页里有、现有代码里没有的新能力(已全部由用户拍板,§1 第 9 条):** 通话按钮留在顶栏(FR4);重播今天的问候保留为用户功能(FR5);今天置顶的对话可删除(FR7);「问候里提学习数据」开关(FR5);强调高亮(FR19)。角色开场白、快捷回复胶囊 v1 不做(§9、§13)。

---

## §5 新增 / 修改文件一览

```
web/src/lib/tz-offset.ts                         新:tzOffsetMinutes()/localDateString()(从 features/progress/stats-api.ts 搬来,progress 改为 re-export,行为不变)
web/src/features/chat/
  index.ts                                       改:导出 ChatIndexRoute / ChatNewRoute / ChatConversationRoute、clearChatHomeCache
  lazy-pages.tsx                                 改:+ ChatHomeShell 懒包装
  chat-api.ts                                    改:Conversation.dailyDate?、ConversationConfig.zhNote?、listConversations 可选 opts
  conversation-page.tsx                          改:conversationId / chrome 插槽(FR3),默认行为不变
  classic-chrome.tsx                             新:旧顶栏(返回 + 角色芯片 + 调整面板)抽出
  options-rows.tsx                               新:双语 / 自动朗读 / 语速 行(旧面板与新设置面板共用)
  conversation-header-actions.tsx                改:改用 options-rows(DOM、testid 不变)
  register-chat-home.tsx                         新:appEffects 核心贡献(只被 plugins/core.ts 导入)
  home/
    CLAUDE.md                                    新:本目录规则(隐私、懒加载、动画约定)
    chat-home-api.ts                             新:config / settings / today / seen 客户端 + 类型 + 错误码
    use-chat-home-config.ts                      新:开关钩子(主包)
    chat-home-store.ts                           新:今天的 /today 结果、openSeq、pendingModal、trigger 缓存(内存)
    chat-home-open.ts                            新:打开检测(冷启动 / 回前台 ≥ 30 min / 跨午夜)、pending 重试
    routes.tsx                                   新:ChatIndexRoute / ChatNewRoute / ChatConversationRoute(按开关选新旧)
    chat-home-shell.tsx                          新(懒):新外框 = 顶栏 + ConversationPage + 抽屉 + 设置面板 + 弹窗
    home-chrome.tsx                              新:新顶栏(历史 / 标题 / 通话 / 设置)
    history-drawer.tsx / use-history.ts / swipe-close.ts / date-label.ts
    chat-settings-sheet.tsx / segmented.tsx
    new-chat.tsx / role-hint.tsx / empty-day.tsx
    greeting-modal.tsx / greeting-tokens.ts / greeting-reveal.ts / greeting-fly.ts / countdown.ts / motion.ts
    greeting-group.tsx / greeting-stats.tsx / emphasis.ts / emphasis-text.tsx
    *.test.ts(x)
  i18n/{en,zh-CN}.json                           改:web.chat.home.*
web/src/features/agents/persona-radio-list.tsx   新(+ lazy-parts / index 各一行)
web/src/plugins/core.ts                          改:+ import "~/features/chat/register-chat-home"
web/src/app.tsx                                  改:三条 /chat 路由的 element
web/src/auth/device-data.ts                      改:登出调用 clearChatHomeCache
web/src/styles/theme.css + tailwind.config.cjs   改:新增 --greet-* / --aur-* token(两套)
web/e2e/chat-home.spec.ts                        新;web/e2e/chat.spec.ts 改为模式无关 helper;e2e/support/upstream-guard.ts + src/test/e2e-upstream-guard.test.ts 放行 /api/chat-home/*
web/README.md、web/src/features/chat/CLAUDE.md、web/CLAUDE.md(一行)  文档
```

---

## §6 数据层

### 6.1 客户端与类型(`home/chat-home-api.ts`)

形状以服务端夹具 `server/tests/fixtures/chat_home_contract.json` 为准(服务端 S10 产出;客户端 camelCase 由 `ApiClient` 转换):

```ts
export type GreetingLanguage = "zh" | "en" | "bilingual";
export type GreetingTrigger = "daily" | "every_open" | "off";
export interface ChatHomeConfig { enabled: boolean; llm: boolean }
export interface ChatPrefs { greetingTrigger: GreetingTrigger; language: GreetingLanguage; dailyPersonaId: string; includeStats: boolean }
export interface GreetingLine { en?: string; zh?: string }   // 可含 R17 的 *…* 强调,经 FR19 渲染
export interface GreetingFacts { streak?: number; due?: number; yesterdayMistakes?: number }
export interface TodayGreeting {
  id: string; messageIds: string[]; source: "llm" | "template"; language: GreetingLanguage;
  generatedAt: string;                                        // ISO UTC;问候组小标题「今日问候 · 08:42」
  lines: [GreetingLine, GreetingLine, GreetingLine];          // 恰好 3 段(服务端 §5.1)
  facts: GreetingFacts;                                       // include_stats=false → {}(R16)
  firstView: boolean;
}
export interface TodayResult {
  localDate: string; status: "ready" | "pending" | "off";
  conversation: Conversation & { dailyDate: string };        // 三种 status 都有(服务端 §5)
  greeting: TodayGreeting | null;                             // off → null
}

getChatHomeConfig(api, signal?)           // GET  /api/chat-home/config
getChatPrefs(api, signal?)                // GET  /api/chat-home/settings
patchChatPrefs(api, partial)              // PATCH /api/chat-home/settings(422 → { error: "invalid", field })
postToday(api, { tzOffsetMinutes, clientRequestId }, signal?)  // POST /api/chat-home/today
markGreetingSeen(api, greetingId)         // POST /api/chat-home/greetings/{id}/seen(id encodeURIComponent)
```

- `facts` 只读已知数字键(`streak`、`due`、`yesterday_mistakes`→`yesterdayMistakes`,以夹具为准);未知键忽略;值非有限数字丢弃。
- 防御:`lines` 不是恰好 3 条,或某行缺少该语言要求的键(`zh` / `en` / 双语两者)→ 视为无问候(不弹、问候组退回普通气泡,对话里照常显示消息)。
- 契约测试 `home/chat-home-contract.test.ts`:`import contract from "../../../../../server/tests/fixtures/chat_home_contract.json"`(`web/CLAUDE.md` 允许的「测试夹具」例外),逐键核对 `TodayResult` / `ChatPrefs`(含 `includeStats`)/ `ChatHomeConfig`,并断言 `conversation.config` 里的键是 snake_case 且能被 `ConversationConfig` 读成 `agentPersonaId` / `zhNote`(FR0)、`dailyDate` 与 `generatedAt` 存在、`lines` 长度 3、`include_stats=false` 一例的 `facts` 为 `{}`、每条 `lines` 经 `parseEmphasis` 后 ≤ 3 个 `em` 片段且 `stripEmphasis` 结果不含 `*`(R17)。

### 6.2 缓存与状态(无 react-query)

| 数据 | 存放 | 失效 |
|---|---|---|
| `config` | `WeakMap<ApiClient, Promise>`(成功缓存,失败删除) | 整页刷新 / 登出 |
| `settings` | 模块缓存 + 订阅;`PATCH` 成功后用响应覆盖 | 登出;打开设置面板时若 > 5 min 重新取 |
| `/today` 结果 | `chat-home-store`(内存,`useSyncExternalStore`);键 = `localDate` | 新的「打开」、跨午夜、登出;删除今天的对话后清空并**立即**重新 `POST /today`(`rebuildToday`,不置 `pendingModal`,FR7);关闭 `include_stats` 成功后本地把 `greeting.facts` 置 `{}`(FR5) |
| 本次打开待弹 | store `pendingModal`(内存) | 下一次「打开」重置;弹出即消费 |
| 今天已在本机弹过 | `localStorage["enjoy.chatHome.shown"] = "YYYY-MM-DD"` | 只存日期;登出删除 |
| 首次使用提示已读 | `localStorage["enjoy.chatHome.roleHintSeen"] = "1"` | 登出删除 |
| 历史列表 | `use-history.ts` 组件内状态;抽屉每次打开刷新第 1 页 | — |

`localStorage` 读写全部 try/catch,失败按「没有记录」处理(隐身模式等)。

### 6.3 「打开」与请求时序

```
App 挂载(任何路由) ──► ChatHomeOpenEffect
   config=on? ──否──► 什么都不做
     │是
     ▼
 POST /today(带 tz_offset_minutes)──pending──► 1.5 s × ≤4 重试
     │ready/off                         └─仍 pending──► 本次不弹(进入 /chat 时再试一次)
     ▼
 store = 结果;pendingModal = true
     │
 用户进入 /chat ──► ChatIndexRoute:FR10 条件满足? ──是──► GreetingModal(出现时 POST seen + 写 shown)
                                    └─否──► 直接显示今天的对话
 visibilitychange:hidden ≥ 30 min 后回到 visible ──► 同上(新的一次「打开」)
 抽屉删除今天的对话 ──► DELETE /api/conversations/{id} ──► POST /today(不是「打开」:pendingModal 不变、不弹)──► store 换成新对话
 设置面板「重播今天的问候」──► 用 store 里的 lines 打开弹窗(无请求、无 seen、不追加消息)
```

---

## §7 测试策略

**一直要绿的现有测试(回归网):** `src/features/chat/**`(41 个测试文件,含 `conversation-page.test.tsx` 226 例、`conversation-page.agent.test.tsx` 24 例、`conversations-page.test.tsx` 19 例、`tap-lookup-bubble.test.tsx`)、`src/features/agents/**`、`src/features/realtime/**`、`src/features/lookup/**`、`src/features/rooms/**`、`src/plugins/**`(含 `links-matrix.test.tsx`、`chat-words/*`)、`src/layout/*`(`bottom-nav`、`feature-flags`、`use-app-height`)、`src/lookup-marks*.test.ts`、`src/architecture.test.ts`、`src/styles/*`(`glass-budget`、`liquid-*`、`theme`)、`src/build/*`、`src/test/e2e-upstream-guard.test.ts`。规则:**W4 之后这些文件只允许新增用例,不允许修改已有断言**;如果某个已有断言必须改,停下在计划里写 Addendum 说明原因并请用户确认。

**新单元 / 组件测试(vitest + jsdom):**

| 文件 | 内容 |
|---|---|
| `lib/tz-offset.test.ts` | 范围夹紧、`-0`、`localDateString` 跨午夜(假时钟) |
| `home/chat-home-api.test.ts` | 每个请求的方法 / 路径 / 体(snake_case)/ 查询参数白名单;422 体解析;错误码翻译 |
| `home/chat-home-contract.test.ts` | §6.1 |
| `home/chat-home-store.test.ts` + `chat-home-open.test.ts` | 冷启动请求一次;回前台 < 30 min 不请求、≥ 30 min 请求且 `pendingModal` 复位;`online` 不触发;pending 重试 4 次后停;跨午夜进入 `/chat` 重取;`client_request_id` 重试复用;config off 零请求 |
| `home/chat-home-route.test.tsx` | 开关 on/off/404/加载超时 → 新 / 旧页面;`/chat/new` 开关关重定向;**弹窗只在 `/chat`**:冷启动于 `/practice` 再进 `/chat` 弹一次、再进不弹;冷启动直接打开 `/chat/:today` 不弹;`daily` + `firstView=false` 不弹;`every_open` 每次打开都弹且**不发任何 POST /messages**;`off` 不弹;本机 `shown` = 今天时 `daily` 不弹;`seen` 在弹窗出现时调用一次、失败不报错;`lines` 不是 3 条 → 不弹;**重播**:设置面板「重播今天的问候」打开弹窗,不发 `/today` / `seen` / `POST /messages`、对话消息数不变,非今天的对话里没有该入口;**删除今天的对话**后在 `/chat` 上:先 `DELETE` 再 `POST /today` 各一次、不弹窗、显示新对话 id 与 3 条问候气泡 |
| `home/greeting-tokens.test.ts` | 英文按词带标点、中文按字(标点并入前字)、混排、空串、超长行 stagger 压缩(`maxSpan`);强调片段分词后每个 token 带正确的 `em` 标记 |
| `home/emphasis.test.ts` | R17 / FR19:演示页三段原文(英文第 2 段 3 处)解析正确;`**x**` 规范成 `*x*`;4 处 / 不成对 / 嵌套 / 空 `**` / 内容 25 字符 / 内容含 `<` → 整条纯文本且无 `*`;`stripEmphasis` 去掉全部标记;HTML 字符串(`<b>x</b>` 之类)原样作为文本(渲染后 DOM 里没有 `<b>` 元素) |
| `home/countdown.test.ts` | 假时钟:从最后一行开始计 5000 ms 后回调一次;暂停 / 恢复;卸载清理 |
| `home/greeting-modal.test.tsx` | 只渲染问候文字(无角色名 / 头像);恰好 3 行,第 1 行 lead 样式;强调渲染为 `<em>`、sr-only 全文无 `*`;双语主副行;`zh` 无副行;`facts={}` 无底部数据;最长样例(服务端 §4 容量核对)下 `fitGreeting` 缩放 ≥ 0.72 的结构断言;`mode="replay"` 不调 `seen`;跳过 / 点任意处 / Enter / Space / Esc 关闭;悬停暂停;减弱动效(matchMedia 桩)下文字立即可见、仍 5 s;`role=dialog` + `aria-modal` + 焦点在弹窗内 + 关闭后焦点归还;逐字 span `aria-hidden` 且有 sr-only 全文;背后 `aria-hidden` |
| `home/greeting-fly.test.ts` | FLIP 计算(纯函数:源 / 目标矩形 + 字号 + 行高 → dx / dy / scale / lead);行数不等 → 回退淡出 |
| `home/greeting-group.test.tsx` | `messageIds` 命中时成组、`data-gl` 序号、lead 样式;可见文字带 `<em>` 强调,去标记后与消息正文不一致 → 用原正文;一条被删 → 普通气泡;问候气泡保留朗读 / 翻译 / 跟读 / `data-lookup-context`,朗读文本无 `*` |
| `home/history-drawer.test.tsx` | 打开 / 关闭(按钮、遮罩、Esc、选中);焦点圈定与归还;`aria-expanded`;今天置顶(`updatedAt` 比别的行旧也在最上面)、分组列表里没有今天的对话(按 id 去重)、`aria-current`;**按 `updatedAt` 本地日分组**:昨天的默认对话今天被回复 → 出现在「今天」组、标题仍是「每日对话 · 昨天的日期」;分页去重;删除历史行确认;**删除今天置顶卡**:专用确认文案 → `DELETE` → `POST /today` 一次(新 `client_request_id`)→ store 换新 id、不弹窗;删除失败 store 不变;重建失败显示重试;请求带 `hide_idle_daily=true` 与 `tz_offset_minutes`;URL 只有 id |
| `home/swipe-close.test.ts` | 纯函数:纵向优先不接管、阈值、回弹、接管后吞 click |
| `home/date-label.test.ts` | 今天 / 昨天 / 日期 + 星期(zh / en)、`dailyDate` 只用于默认对话行标题且不做时区换算、分组键 = `updatedAt` 本地日(跨午夜、负偏移) |
| `home/chat-settings-sheet.test.tsx` | 角色单选写 `agent_persona_id`;「更多角色」打开 `PersonaPicker`;带学中禁用;智能体关闭不渲染角色节;每日角色开关写 `daily_persona_id`;语言分段写 `/settings` + 今天对话 `zh_note` / `bilingual`(非今天的对话只写 `/settings`);时机分段与说明;**`include_stats` 开关**:`role="switch"`、关 → `PATCH /settings {include_stats:false}` 且 store 里今天的 `facts` 变 `{}`、失败回滚开关并提示;本对话三行同 testid;复盘 / 更多设置入口;**重播入口**只在今天的默认对话 + 有 ready 问候时出现,点击打开弹窗且不发请求;方向键切换分段;`/settings` 失败只影响全局两节 |
| `home/new-chat.test.tsx` | 草稿不发 `POST /api/conversations`;选角色后建对话(名 = 默认名、config 只含角色与角色音色)并 `replace` 到 `/chat/:id`;直接发送 → 建无角色对话后发送;[从场景开始] 打开原面板;智能体关闭时的空状态 |
| `home/role-hint.test.tsx` | 首次显示、知道了 / 打开设置后不再显示、localStorage 抛错时仍可用 |
| `home/chat-home-parity.test.tsx` | §4 的 P-1 … P-12:开关开的新外框里,按 testid 逐项走一遍现有能力(发送、重试、角色、带学、设置面板各项、按住说话、评测徽章、自动朗读、提示、复盘、通话入口与焦点) |
| `home/home-skin.test.tsx` | 经典 / 液态两种皮肤下新组件 testid 唯一、无新增模糊类;读源码断言 `features/chat/home/` 下没有 `dangerouslySetInnerHTML`(FR19) |
| `home/chat-home-lazy.test.tsx` | 新主页是懒路由组件;`register-chat-home.tsx` 不静态导入任何 `home/*` 重模块(读源码断言) |
| `agents/persona-radio-list.test.tsx` | 列表、选中态、`role=radio`、键盘 |

**每个任务:** `yarn web:typecheck` + 本任务列出的测试 + `yarn vitest run src/architecture.test.ts`。**W7、W13:** `yarn web:test`(全量)、`yarn web:build`、`node scripts/check-main-bundle.mjs --max-delta=0.5`。

**E2E(只在用户要求时跑;真实上游要花钱):** 新 `web/e2e/chat-home.spec.ts`(要求 E2E 栈 `CHAT_HOME_ENABLED=true`、`CHAT_GREETING_LLM_ENABLED=false` → 模板问候,零上游费用):首次进入 `/chat` 弹问候 → 跳过 → 今天的对话里有 3 条问候气泡;刷新不再弹(`daily`);设置面板「重播今天的问候」→ 弹出、关闭后消息数不变;设置改「每次上线」→ 模拟隐藏 ≥ 30 min 不现实,改为断言重新加载 + 清本机标记后弹出且消息数不变;关「问候里提学习数据」→ 重播时底部无数据;抽屉:删除今天的对话 → 仍在 `/chat`、3 条问候气泡回来、不弹窗;打开 / Esc / 新建对话 → 选角色 → 发一句;深链 `/chat/:id` 不弹。`chat.spec.ts`、`hold-to-talk.spec.ts`、`lookup.spec.ts` 改为模式无关(建对话走 API 或抽屉 helper),两种开关状态都能过。`upstream-guard.ts` + `src/test/e2e-upstream-guard.test.ts` 放行 `/api/chat-home/*`(自家后端;LLM 在 E2E 栈里关闭)。结果记 `docs/superpowers/plans/e2e-results.md`;没跑就标「未验证」。

---

## §8 真机手动清单(全部**未验证**,上线前由用户在 iPhone PWA + 一台 Android 上走一遍)

- [ ] 冷启动进 `/chat`:问候在 6 s 内出现(服务端上限)或直接进对话;逐行动画流畅、无闪出对话文字。
- [ ] 倒计时从最后一行开始约 5 s;跳过、点任意处有效;飞入对齐气泡(320×568 / 375×667 / 390×844 不裁切)。
- [ ] 系统「减弱动态效果」开:无逐字 / 飞入 / 滑动 / 脉冲,文字可读。
- [ ] 刘海与 Home 横条:弹窗、抽屉头尾、设置面板底部都不被遮。
- [ ] 抽屉左滑关闭与列表竖向滚动不打架;遮罩点关闭;底部标签栏被遮罩盖住。
- [ ] 后台 ≥ 30 min 回来 + 「每次上线」:弹同一组问候,对话消息数不变。
- [ ] 最长问候(双语 3 段)在 320×568 上不裁切;强调词高亮可读(两种皮肤、深色)。
- [ ] 重播今天的问候、删除今天的对话(问候回来、不弹窗)各走一次。
- [ ] 弹窗期间不自动出声;关闭后点气泡「听」能出声(iOS 手势解锁)。
- [ ] 新对话首次提示指向右上角;选角色后能聊;从场景开始的开场白会朗读。
- [ ] 通话、按住说话、点词查词、提示、复盘、跟读在新布局里各走一次。
- [ ] 深色模式 / 液态玻璃皮肤下小字对比度可读。

---

## §9 与演示页的偏差(都有依据,不是遗漏)

| 演示页 | 本计划 | 依据 |
|---|---|---|
| 切换问候语言时对话里的问候气泡原地换文 | 不换;提示「明天起生效」 | 服务端 R7:今天已存的问候不重写 |
| 「每次上线」= 切走 3 s 再回来 | 隐藏 ≥ 30 min 或冷启动 | 服务端 R8(3 s 是演示用) |
| 「关闭」说明「今天的对话里仍保留文字版问候」 | 「不再弹出,也不再生成新的问候;已有的保留」 | R8:off 不生成 |
| 底部数据含错点词「went → gone」 | 只显示数字(连续天数、待复习数、昨天错误数) | 服务端 `facts` 只存数字(隐私) |
| `*强调*` 词高亮(弹窗与问候气泡) | **同演示页**:高亮;契约 = 服务端 R17,渲染 = FR19(不用 `dangerouslySetInnerHTML`) | 用户采纳 |
| 3 段较长问候 | **同演示页**:恰好 3 段;服务端 §4 上限已按演示页最长填充核对能放下,`max_tokens=600` 足够;缩放到 0.72 兜底 | 服务端 §4 容量核对、§6.4 |
| 英文第 1 段带用户名「Owen」 | 不带名字 | 服务端 §6.1:v1 不把用户名发给模型 |
| 今日问候下的快捷回复胶囊 | 不做(现有「提示」行提供建议回复) | 用户采纳:v1 不做(§13) |
| 角色选好后自动出一句角色开场白 | 不做,显示空状态 | 用户采纳:v1 不做(§13) |
| 右上角只有设置 | 通话按钮 + 设置 | 用户采纳(FR4) |
| 「跳过」胶囊 `backdrop-filter` | 实色胶囊 | 液态玻璃模糊层预算 |
| 抽屉里的「重播问候」调试按钮 | 设置面板「重播今天的问候」,用户功能,只弹窗不追加 | 用户采纳(FR5) |
| 面板里没有「学习数据」开关 | 「问候时机」一节末尾加「问候里提学习数据」开关 | 用户采纳(FR5、服务端 R16) |

---

## §10 任务列表(网页;每个任务一个提交)

规模:S ≈ 半小时内、M ≈ 1–2 小时、L ≈ 半天。「后端依赖」指服务端计划的任务编号;标「无」的可以在服务端完成前做(用桩数据测试)。

### Task W0: 前置核对(只读,不提交)— S — 后端依赖:无
- [x] `git status` 记下用户未提交改动,之后只按路径 `git add`。
- [x] 核对 §3 每个文件 / testid 仍在(`grep -rn` testid 列表);`conversation-page.test.tsx` / `.agent.test.tsx` / `conversations-page.test.tsx` 用例数(226 / 24 / 19)。
- [x] 读出 `auth/` 里登出清理的实际文件名、底部标签栏 / 查词层 / BottomSheet 的 `z-index`、`appEffects` 点的 props 形状(`lib/extension-points.ts`)。
- [x] `cd web && yarn web:build && node scripts/check-main-bundle.mjs` 记下当前主包(基线 410.03 kB)。
- [ ] 确认服务端代码按服务端计划 §1 第 22 条用 snake_case 键(`zh_note` / `agent_persona_id`)落库(合并后 `grep -rn "zhNote\|agentPersonaId" server/app` 应为空);不一致 → 停下报告,W2 / W10 不开工。
- [ ] 不一致 → 停下报告,不要自行改裁定。

### Task W1: 时区工具搬到 lib — S — 后端依赖:无 — `refactor(web): move tzOffsetMinutes to lib`
- [x] `lib/tz-offset.ts`(`tzOffsetMinutes`、`localDateString(date)`);`features/progress/stats-api.ts` 改为从 lib 导入并 re-export(公开接口不变)。
- [x] 测试:`lib/tz-offset.test.ts`、`src/features/progress`、`architecture.test.ts`。

### Task W2: 契约与 API 客户端 — M — 后端依赖:S9、S10(夹具)— `feat(web): chat home api client and contract test`
- [x] `home/chat-home-api.ts`(§6.1)、`chat-api.ts` 增量字段(`dailyDate`、`zhNote`、`listConversations` 的 `opts`;旧调用与旧请求体不变)。
- [x] `home/emphasis.ts`(FR19 纯函数;契约测试要用)。
- [x] `home/chat-home-contract.test.ts` 读服务端夹具;`chat-home-api.test.ts`;`emphasis.test.ts`;`chat-api.test.ts` 新增用例。
- [x] `home/CLAUDE.md`(隐私、懒加载、动画约定、FR0)。

### Task W3: 开关钩子、store 与打开检测 — M — 后端依赖:无(桩),集成需 S9 — `feat(web): chat home config, store and app-open detection`
- [x] `use-chat-home-config.ts`、`chat-home-store.ts`、`chat-home-open.ts`、`register-chat-home.tsx`;`plugins/core.ts` 加一行 import。
- [x] `clearChatHomeCache` 导出 + 登出调用(FR18)。
- [x] 测试:`chat-home-store.test.ts`、`chat-home-open.test.ts`、`plugins/links-matrix.test.tsx`(全关时核心贡献多一个 `appEffects/chat.home-open`,如该测试枚举核心贡献则**新增**断言)、auth 测试、`architecture.test.ts`。

### Task W4: 对话页外框插槽(零行为变化)— L — 后端依赖:无 — `refactor(web): conversation page chrome slots (no behaviour change)`
- [x] `conversation-page.tsx` 加 `conversationId` / `chrome`(FR3);旧外框抽到 `classic-chrome.tsx`;`options-rows.tsx` 抽出并让 `conversation-header-actions.tsx` 使用(DOM 不变)。
- [x] **验收:** `conversation-page.test.tsx`、`conversation-page.agent.test.tsx`、`conversation-settings-sheet.test.tsx`、`bubble-actions.test.tsx`、`voice-ui.test.tsx`、`tap-lookup-bubble.test.tsx` 不改一行全绿;新增 `classic-chrome.test.tsx`(缺省 props 时快照与重构前一致:用重构前提交生成的 DOM 快照对比一次后删除快照,只留结构断言)。
- [x] 可与 W1–W3 并行;最先合并更安全。

### Task W5: 日期标签与历史抽屉 — M — 后端依赖:无(桩),`hide_idle_daily` 与删除今天后重建的集成需 S7、S9 — `feat(web): history drawer with date groups`
- [x] `date-label.ts`、`swipe-close.ts`、`use-history.ts`、`history-drawer.tsx`(FR7、FR9、FR16;按 `updatedAt` 本地日分组、今天置顶去重、今天置顶卡删除 + `chat-home-store` 的 `rebuildToday`)。
- [x] 测试:`date-label.test.ts`、`swipe-close.test.ts`、`history-drawer.test.tsx`。

### Task W6: 设置面板与角色单选 — M — 后端依赖:S2 / S9(`/settings`,含 `include_stats`),S7(R16 读取时 `facts` 规则),S8(`zh_note` 生效)— `feat(web): chat home settings sheet (role, greeting language, trigger, stats, replay)`
- [x] `features/agents/persona-radio-list.tsx`(+ `lazy-parts.tsx` `/* @__PURE__ */` 一行、`index.ts` 一行)。
- [x] `home/segmented.tsx`、`home/chat-settings-sheet.tsx`(FR5:含「问候里提学习数据」开关与「重播今天的问候」入口;重播先只发出 `onReplay` 回调,弹窗接线在 W10)。
- [x] 测试:`persona-radio-list.test.tsx`、`chat-settings-sheet.test.tsx`、`src/features/agents`、`architecture.test.ts`。

### Task W7: 新外框、路由与开关回退 — L — 后端依赖:W2、W3、W5、W6;集成需 S9 — `feat(web): chat home shell, routes and CHAT_HOME_ENABLED fallback`
- [x] `home-chrome.tsx`、`chat-home-shell.tsx`(懒)、`routes.tsx`、`new-chat.tsx`、`role-hint.tsx`、`empty-day.tsx`;`lazy-pages.tsx`、`index.ts`、`app.tsx` 三条路由(FR1、FR4、FR6、FR8、FR11)。
- [x] 测试:`chat-home-route.test.tsx`(先不含弹窗用例)、`new-chat.test.tsx`、`role-hint.test.tsx`、`chat-home-parity.test.tsx`、`chat-home-lazy.test.tsx`、`home-skin.test.tsx`;**全量** `yarn web:test`、`yarn web:build`、主包检查 `--max-delta=0.5`。

### Task W8: 问候弹窗(显示、倒计时、跳过、无障碍、减弱动效)— L — 后端依赖:无(桩)— `feat(web): greeting modal with multi-line reveal and countdown`
- [x] `motion.ts`、`greeting-tokens.ts`、`greeting-reveal.ts`、`countdown.ts`、`greeting-stats.tsx`、`emphasis-text.tsx`、`greeting-modal.tsx`(FR13–FR16、FR19;`mode: "open" | "replay"`;极光用 `filter: blur` 色斑,不用 backdrop-filter)。依赖 W2 的 `emphasis.ts`(若 W8 先做,先把 `emphasis.ts` 连同测试放进 W8,W2 改为复用)。
- [x] 测试:`greeting-tokens.test.ts`、`countdown.test.ts`、`greeting-modal.test.tsx`、`styles/glass-budget.test.ts`。

### Task W9: 对话里的问候组与飞入 — M — 后端依赖:S7(`message_ids`)集成 — `feat(web): greeting group in today's chat and fly-in transition`
- [x] `greeting-group.tsx`(经 `chrome.renderMessage`)、`greeting-fly.ts`(FR12、FR14 关闭段)。
- [x] 测试:`greeting-group.test.tsx`、`greeting-fly.test.ts`、`chat-home-parity.test.tsx`。

### Task W10: 问候时机接线 — M — 后端依赖:S7、S9 — `feat(web): greeting trigger rules (daily / every open / off) on the chat home only`
- [x] `ChatIndexRoute` 的弹窗条件、`seen`、本机 `shown`、pending 重试接 UI、跨午夜(FR10);设置面板「重播」接到 `GreetingModal mode="replay"`(FR5);删除今天后重建不弹窗(FR7、FR10)。
- [x] 测试:`chat-home-route.test.tsx` 补齐弹窗用例(§7 表)、`chat-home-open.test.ts`。

### Task W11: 文案、token 与皮肤收尾 — S/M — 后端依赖:无 — `feat(web): chat home copy (zh/en) and greeting tokens`
- [x] `i18n/{en,zh-CN}.json` 补全 `web.chat.home.*`(FR17);`theme.css` + `tailwind.config.cjs` 新 token(两套)与对比度断言。
- [x] 测试:`styles/theme.test.ts`、`liquid-*`、`glass-budget`、chat i18n 键一致性(若无现成测试,在 `home/locales.test.ts` 新增)。

### Task W12: E2E 适配(编写,运行等用户要求)— M — 后端依赖:全部 S 任务 — `test(web): chat home e2e and mode-agnostic chat specs`
- [x] `e2e/chat-home.spec.ts`;`chat.spec.ts` / `hold-to-talk.spec.ts` / `lookup.spec.ts` 的进入方式改为模式无关 helper(`e2e/support/chat.ts`);`upstream-guard.ts` + `src/test/e2e-upstream-guard.test.ts` 放行 `/api/chat-home/*`;`docker-compose.e2e.yml` 的环境变量说明写进 `web/README.md`(不改未跟踪的 compose 文件)。
- [x] 测试:`yarn web:typecheck`(含 e2e)、`src/test/e2e-upstream-guard.test.ts`。

### Task W13: 文档、主包、截图 — S — 后端依赖:无 — `docs(web): chat home and daily greeting`
- [ ] `web/README.md`(新布局、开关回退、未验证清单)、`features/chat/CLAUDE.md`(home/ 一行、外框插槽、FR0)、`web/CLAUDE.md` Pitfalls 一行;`docs/images/readme/` 对话截图替换(本地演示环境假数据,≤ 250 KB)。
- [x] `yarn web:test && yarn web:build && node scripts/check-main-bundle.mjs --max-delta=0.5`;主包变小时才 `--record`(提交 `main-bundle-baseline.json`)。
- [x] 本计划「未验证清单」按实际更新;勾选只在合并且测试通过后。

**依赖图:** `W0 → W1`;`W4` 只依赖 W0(建议最先合并);`W2` 依赖 S9 + S10;`W3` 依赖 W1(时区)、W2(类型);`W5`、`W8` 只依赖 W0(纯 UI,可并行;`W5` 的 `rebuildToday` 用 W3 的 store,未合并时先用桩;`W8` 与 W2 共用 `emphasis.ts`,谁先做谁带上);`W6` 依赖 W2、W4;`W7` 依赖 W2、W3、W4、W5、W6;`W9` 依赖 W7、W8;`W10` 依赖 W7、W8、W9;`W11` 可随时做,最晚在 W13 前;`W12` 依赖 W10 + 服务端全部;`W13` 最后。

**上线顺序:** 服务端合并(开关默认关)→ 网页 W0–W13 合并(开关关 = 旧界面,零可见变化)→ 用户要求时部署 → 管理后台打开 `CHAT_HOME_ENABLED`(热改)→ 真机清单 → changelog 草稿。**回退:** 管理后台关掉开关,网页下次读取 `/config` 即回旧列表(已建的默认对话在旧列表里以日期名出现、不隐藏,见 §12 K3)。旧列表页与 `ConversationListLiquid` 在本计划中保留;等新主页稳定一段时间后另立计划删除。

---

## §11 待用户确认的问题

**目前没有待确认的问题。** 原 Q1–Q11 已由用户 2026-10-23 全部按推荐答案采纳,并入服务端计划 §1 第 22–31 条与本计划:Q1 → FR0;Q2、Q3 → §9、§13(v1 不做);Q4 → FR4;Q5 → FR7、FR9、服务端 R11;Q6 → FR5、服务端 R16;Q7 → FR5、FR10;Q8 → FR7、服务端 R4;Q9 → §13;Q10 → FR19、服务端 R17;Q11 → §1 第 2 条、服务端 §4 容量核对与 §6.4(上限与 `max_tokens=600` 不变,强调上限 2 → 3 处)。

---

## §12 风险与已知限制

- **K1 回归面大:** `conversation-page.tsx` 1425 行、226 个用例;W4 只加插槽、不搬逻辑,并以「已有测试一字不改全绿」作为验收。新外框的回归由 `chat-home-parity.test.tsx` 补。
- **K2 动画与 jsdom:** jsdom 没有 `Element.animate` / 布局;动画逻辑拆成纯函数(分词、FLIP、倒计时、滑动阈值)单测,DOM 测试走「减弱动效 / 无 animate」终态路径。真实观感**只能真机验证**(§8)。
- **K3 开关来回切:** 开 → 关后,默认对话(名字是日期)出现在旧列表里且不隐藏;关 → 开不丢数据。可接受,写进 README。
- **K4 首屏等待:** 首次打开要等服务端问候(上限 6 s,服务端 K2);`/today` 在 App 启动时就发,进入 `/chat` 时多半已就绪;未就绪时直接显示对话,不卡住。真实时延**未测**。
- **K5 主包:** 新增主包代码只有开关钩子、store、打开检测、路由分发;预算 +0.5 kB,超出则把打开检测的请求部分改为动态 `import()`。
- **K6 iOS:** 抽屉左滑与 Safari 边缘返回手势可能冲突(抽屉在左侧,关闭方向是向左,冲突小);`100dvh`、`env(safe-area-inset-*)`、PWA 独立模式下的表现**未验证**。
- **K7 跨设备:** `daily` 的「只弹一次」靠服务端 `first_seen_at`;`seen` 失败时本机日期标记防重,另一台设备可能再弹一次(服务端未置位),可接受。
- **K8 定时器:** 倒计时与 pending 重试都在卸载 / 登出时清理;切到别的标签页时倒计时暂停,回来继续。
- **K9 文案长度:** 英文界面下设置面板分段「Every open」等需在 360 px 宽放下(每段 ≥ 44 px 命中;W11 用 `home-skin.test.tsx` 断言不换行或允许两行)。

---

## §13 以后的任务(不在本计划范围,用户 2026-10-23 裁定)

需要时各自另立计划(服务端计划 §11 有同一份清单):

- **问候下的快捷回复胶囊**(演示页「先练 have gone / 复习 12 个单词 / 随便聊聊」):需要服务端给建议;v1 由现有「提示」行提供建议回复。
- **新对话选好角色后的角色开场白**:需要服务端「无用户消息的角色开场回合」或固定文案;v1 显示空状态。
- **单条消息复制 / 删除**、**对话手动改名**、附件 / 图片消息:现有代码都没有,不在本次范围。

---

## 未验证清单

- 状态(2026-10-25):代码已合并进 main(尚未部署,`CHAT_HOME_ENABLED` 默认关)。任务勾选只表示代码与自动测试已合并;E2E 最终验证待完成,§8 真机清单、README 截图、管理端 `yarn admin:test` 仍未完成。
- 网页代码已按本计划写完并通过 vitest / 类型检查 / 构建(集成分支 `feat/chat-home-integ`);尚未合并、未部署。
- 服务端契约夹具已存在:`server/tests/fixtures/chat_home_contract.json`;`home/chat-home-contract.test.ts` 直接读它。store / 抽屉 / 设置面板的测试仍用手写样例 `chat-home-contract.stub.json`(稳定 id),它不是契约。
- 真机(iPhone PWA / Android)上的动画、安全区、抽屉手势、自动朗读——未验证(§8)。
- E2E `chat-home.spec.ts` 与改成模式无关入口的老规格——已编写并通过类型检查,**未运行**(要用户要求;栈需 `CHAT_HOME_ENABLED=true`、`CHAT_GREETING_LLM_ENABLED=false`)。
- 主包增量:见下方 Addendum(比基线小,基线已重录)。
- 问候长度与 `max_tokens` 的「放得下」结论只按演示页 mock 文本逐字计算(服务端 §4 容量核对),未用真实模型输出校准;最长问候在小屏上的排版只在 jsdom 做了结构断言,真机未验证。
- README 的对话截图(`docs/images/readme/`)未替换:没有可运行的本地演示环境(见 Addendum)。

## Addendum (2026-10-23,集成)

集成时相对本计划正文的偏差(都不改裁定、接口名与隐私规则):

- **新对话草稿没有输入框**:FR6 写「在草稿输入框直接发送」,但对话视图的输入条属于 `ConversationPage`,草稿没有对话可挂。改为空状态里的 [直接开始](= 旧列表的「自由对话」:`{scenario:{id:"free"}, level:"auto"}`),[选择角色] 与 [从场景开始] 不变;智能体关闭时没有 [选择角色] 与设置按钮。
- **问候组的 testid**:`ConversationPage` 的 `renderMessage` 是逐条调用,无法把三条消息包进同一个容器。每条消息的包装层是 `chat-greeting-line`(带 `data-gl` / `data-greet-target` 序号,供飞入定位),「✦ 今日问候 · 08:42」小标题是唯一的 `chat-greeting-group`(在第 0 条上),组尾数据是 `chat-greeting-facts`。某条消息被删:剩下的各自按问候行渲染,小标题随第 0 条消失。可见文字与存储正文不一致 → 该条退回原气泡。`MessageBubble` 新增可选 `body`(只替换助手气泡的可见内容)。
- **角色解析**:新外框里没有角色芯片,但页面仍需角色名与「智能体已关闭」,所以 `ChatPersonaControl` 加了 `headless` 属性(只解析,不渲染芯片与选择器)。
- **文案位置**:问候 / 抽屉 / 设置面板文案在 `home/locales/`(懒加载),不在 `i18n/`(那个 glob 会进主包,约 +1.2 kB)。`settings.language` 改为 `{title, zh, en, bilingual}`,三个语言标签走 i18n(固定写「中文 / English / 中英双语」);无人引用的键已删除。
- **旧列表页也改成懒块**(`lazy-pages.tsx` 的 `ConversationsPage`,`index.ts` 同名导出不变):为了给新路由分发腾出主包预算。开关关时旧列表首次渲染多一次小块请求,界面不变。
- **seen 失败的重试**:弹窗出现时 `seen` 失败静默;下一次 `daily` 打开时若本机已标记今天、服务端仍 `first_view`,静默重试一次(不弹)。
- **主包**:基线 410.03 kB;本分支 404.65 kB(−5.38 kB),`--max-delta=0.5` 通过,已按计划 W13 重录基线。
- **截图**:没有可运行的本地演示环境(宿主无 node / uv 服务),`docs/images/readme/` 未替换,上线前补。
