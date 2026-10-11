# 智能体 + 已学词复习 + 房间重开 · 七份计划的总索引(INDEX)

- 日期:2026-10-12 · 只有文档,没有产品代码
- 本文是七份计划之间的**唯一裁决来源**:计划、spec 里与本文不一致的地方,以本文为准(spec 不改,本文 §4 列出修正)。每份计划开头都有一行指向本文。
- 七份计划是并行写的,彼此没看过对方;本文把它们对齐成**能按 §2 顺序执行**的一套。

## 1. 计划一览

| | 名称 | 计划 | 任务 | 车道 | 迁移 |
|---|---|---|---|---|---|
| **W** | 已学词页 + 自由复习 | `2026-10-12-wordbook-learned-review.md` | 15(S1–S6、W1–W7、Z1–Z2) | S、W、Z | 无 |
| **R** | 已结束房间隐藏 + 重新开启 | `2026-10-12-rooms-reopen.md` | 13(S1–S6、W1–W5、A1、Z1) | S、W、A、Z | `0014` |
| **A1** | 智能体服务端核心 | `2026-10-12-agents-core.md` | Task 0 + 22 | S、D、P、C、R、L、M、Z | `0015` |
| **A2** | 记忆管理 | `2026-10-12-agents-memory.md` | 17(Task 0、S1–S10、W1–W5、Z1) | S、W、Z | `0016`(新建) |
| **A3** | 导师模式「带我学」 | `2026-10-12-agents-tutor.md` | 18(S1–S9、W1–W7、Z1–Z2) | S、W、Z | 并入 `0016` |
| **A4** | 智能体前端壳 + 对话集成 | `2026-10-12-agents-web.md` | 20(H0–H4、W1–W5、I1–I5、N1–N2、Z1–Z3) | H、W、I、N、Z | 无 |
| **A5** | 联机集成 + 房间导师 | `2026-10-12-agents-rooms.md` | Task 0 + 20(S1–S7、T1–T3、A1、W0–W6、Z1–Z2) | S、T、A、W、Z | `0017` |

设计:`specs/2026-10-12-agents-design.md`、`specs/2026-10-12-wordbook-review-and-room-reopen-design.md`;视觉稿:`design/agents-v1/mockup.html`。合计约 125 个任务。

## 2. 合并顺序(权威)

**W → R → A1 → A2-S → A3-S → A4(全部)→ A2-W → A3-W → A5(S → T → A → W → Z)→ 全局验收。**

- 开发可以并行(每条车道各自的 worktree),**合并不能越过前一步**。
- **A2-S 和 A3-S 必须连续合并,中间不得部署**:`0016` 由 A2 新建,A3 往同一个文件追加 `agent_tutor_sessions`(A2 R-M1)。若有人在两者之间部署了 `0016`,A3 改用新迁移 `0017`、A5 顺延 `0018`。
- **A2、A3 的网页车道晚于 A4**(与各自计划原先的假设不同,见裁决 X10):`features/agents/index.ts`、路由、文案加载器由 A4 创建,A2-W / A3-W 只**追加**。
- A5 最后合并:它依赖 R(`reopened` 事件、`room_out.close_reason`)、A1–A4 的全部接口。
- 全局验收按用户偏好用 **Sonnet 5.5**(不用 Fable)。

| 后来的 | 必须等 | 原因 |
|---|---|---|
| A1 Task 0 | R 合并 | 迁移头必须是 `0014` |
| A2 Task 0 / S1 | A1 全部 | `0015`、`context.py`、`orchestrator.py`、`runtime(app)` |
| A3-S | A2-S | 追加到 `0016` 与 `models.py` 的 A2 区块 |
| A4 H0 | A3-S | 记录主包基线 |
| A2-W、A3-W | A4 | `index.ts`、路由、`locales.ts`、对话页槽位 |
| A5 Task 0 | R、A1–A4、A2-W、A3-W | 接口 grep 核对 |

## 3. 迁移链(线性)

`0013_learning_links` → `0014`(R:`rooms.opened_at`、`reopen_count`)→ `0015`(A1:`agent_personas`、`agent_user_settings`、`agent_persona_reports`、`messages.agent_trace`)→ `0016`(A2 五张表:`agent_memory_items`、`agent_profiles`、`agent_thread_states`、`agent_recaps`、`agent_memory_tombstones`;A3 追加 `agent_tutor_sessions`,含预留的 `room_id`)→ `0017`(A5:`rooms` 上两个可空 JSON 列,房间智能体配置与带练快照)。每个迁移:SQLite batch + Postgres 路径 + 往返测试 + `test_models_match_migrations` 绿;**部署前先备份 PostgreSQL**。

## 4. 裁决(与计划冲突时,以此为准)

### 4.1 接口对齐

- **X1 运行时入口只有一个。** `app.agents.orchestrator.runtime(app)`(A1 的 `AgentsRuntime`:`registry`、`modes`、`hooks`、`ledger`、`tasks`)是 A2/A3/A5 唯一的访问点;`deps_for(app)` 给出 `TurnDeps`。**不存在** `app.state.agent_registry / agent_hooks / agent_sources / agent_modes / agent_turn_deps`。改动点:A2 的 `install_memory`(`runtime(app).registry.register(MemorySource(app))`、`runtime(app).hooks.after_turn.append(...)`)、A3 的 `TutorMode` 注册(`runtime(app).modes.register(...)`)、A5 的 `rooms_agents.install`(用 `deps_for(app)`)。三者都放在 `install_agent_sources(app)` 之后,顺序 A1 → A2 → A3 → A5。
- **X2 `TurnRecord` 字段以 A1 为准**:`turn_id, user_id, persona_id, conversation_id, room_id, mode, tutor_session_id, in_room, text, reply, history_len, usage, at`。A2 里写 `user_text` 的地方一律改为 `text`(导师开场 `text=None`)。
- **X3 `ModeBlock` 与导师开场。** A1 增加(Addendum AX-1,已追加在 A1 计划末尾):`ModeBlock(text=None, max_tokens=None, user_text=None)`、`ModeError(code)`(映射为 SSE `error{code}`,HTTP 仍 200);`TurnRequest.text` 仅在 `mode="tutor"` 时允许 `None`;`text=None` 也用于「跳过后出下一题」(A3 R-T2);`Meta` 增加 `retry`、`say` 字段、`ModeHandler.finish` 收到**含 META 的原始全文**(A3 R-T5),模式块放在历史**之后**(A3 R-T6 与 A1 R-C4 一致)。
- **X4 `PersonaStore` 绑定会话**:`PersonaStore(session)`(A1)。A5 里写 `PersonaStore(sessionmaker)` 的地方改成 `async with sessions() as s: PersonaStore(s)`;A3 的 `get(user_id, persona_id)` 用法保持。
- **X5 额度作用域名以 A1 `limits.py` 为准**:`agents_tutor`(导师开始次数)、`agents_memory_extract`(记忆整理、会话摘要、回顾共用)。A3 的 `agent_tutor`、A5 的 `TUTOR_SCOPE` 改为 `SCOPE_TUTOR_USER`;房间带练与对话带练**共用同一计数**。
- **X6 导师纯模块的名字以 A3 为准**(`initial_state`、`next_state`、`Skipped()` / 答题事件类、`difficulty`、`TutorState.to_dict/from_dict`、`build_plan`、`parse_meta`、`StreamFilter`、`tutor_block`)。A5 的 `agent_tutor.py`「A3 适配块」按 A3 实际签名调整,A5 Task 0 grep 核对。
- **X7 网页组件签名以所有者为准**:`ProcessCapsule`、`PersonaPicker`、`Persona`、`AgentStep`、`AgentTrace`、`useAgentTurn` 以 A4 的实际定义为准(A5 的 W 车道调整调用处:`live`/`trace`/`showProcess`/`label` 属性);`TutorBar`、`TutorStartSheet`、`useTutorSession`、`TutorRecapCard` 以 A3 的实际定义为准(A4 只在对话页预留槽位,不 import 导师组件)。
- **X8 A1 追加两个端点与夹具键(Addendum AX-1)**:`POST /api/agents/personas/try`(`{persona, text}` → `{text}`,非流式、套安全前言、计入每日回合上限、不写会话)、`GET /api/agents/config`(已在 A1)。`agents_contract.json` 必须含键:`config`、`personas`、`persona_created`、`settings`、`turn_sse`、`turn_error_sse`、`message_with_trace`、`persona_try`、`persona_report`(A4 逐键读取)。
- **X9 管理端用量里的记忆计数**:A2 提供 `memory_counts(session)`,A1 的 `agents_admin.overview` 在返回字典末尾追加 `"memory_counts"`,由 A2-S 的最后一个任务接入(只有数字)。

### 4.2 前端

- **X10 `features/agents/index.ts`、路由 `/me/agents*`、文案加载器由 A4 创建。** A2 的 W1(原为「创建 index.ts 与 CLAUDE.md」)改为**修改**:只追加导出 `MemoryPage` 与类型、不删 A4 的内容;A3-W7 同理追加。A2-W / A3-W 晚于 A4。
- **X11 文案:统一前缀 `web.agents.*`,全部懒加载。** A2 的 `agents.memory.*` 改 `web.agents.memory.*`,放 `memory/locales/{en,zh-CN}.json`;A3 的 `tutor/i18n` 改 `tutor/locales/`(前缀已是 `web.agents.tutor.*`);它们通过 A4 的 `features/agents/locales.ts` 加载器并入(不进 `**/i18n/*.json` 的主包 glob)。服务端 SSE 的 `label_key` 仍是 `agents.step.<key>`,A4 的 `label_of` 映射到 `web.agents.step.<key>`,未知键回落 `web.agents.step.unknown`。房间侧文案 `web.rooms.agents.*`(A5,放 rooms 现有 `i18n/`)。
- **X12 主包预算按「每份计划相对上一个合并后基线」计量。** A4 的 H0 在 A3-S 合并后用 `--record` 记基线,每份计划合并后重录一次,累计结果写进 `plans/e2e-results.md`。A4 把 `ConversationPage` 改为路由懒加载、A5 把 `RoomPage` 改为懒加载:**均接受**(首次进入页面会多一次分包请求,显示现有的 Suspense 占位)。W 计划的文案进主包(上限 ≤ 1.5 kB gzip,代码本身 ≤ 0.2 kB)接受。
- **X13 冻结边:** A4 登记 `chat→agents`(16 → 17);A5 在第一处使用时登记 `rooms→agents`(→ 18)。A2-W、A3-W 的代码都在 `agents` 内部,不增加跨 feature 边。

### 4.3 服务端与协议

- **X14 上下文来源在 `create_app` 里无条件注册**(A1 R-C2),每个回合检查开关;这修正 spec §3.3 的「`AGENTS_ENABLED` 打开时才在生命周期里注册」(热改开关与不跑 lifespan 的测试都需要)。
- **X15 `room-page.tsx` 的冻结规则例外有两处**:R 的 WR-1 与 A5 的 AR-1,各是一行接线;R 先合并,A5 在 R 之后的内容上重做那一行。
- **X16 房间契约夹具重录两次**:R 的 `room_out.close_reason` 与 `reopened` 事件(重录全部 `rooms_*_contract.json`),A5 追加三个私有事件与房间智能体字段(再重录)。`protocol.py` 与 `protocol.ts` 的事件数组:R 在末尾追加 `reopened`,A5 在其**之后**追加,不得漏掉 `reopened`。
- **X17 接力与计费(A5 R-RA5、R-RA7)采纳**:`@ai` 优先于 `@名字`;智能体共用 `@ai` 的限制(一房间一个 AI 发言者、队列上限、频率窗口、每日上限);`ai_muted` 或公共 AI 关闭时智能体同样沉默;角色 A 的回复里 `@B` 触发恰好一次 B 的回合,B 的回合不写记忆、不再接力;联机回合先扣 `ROOMS_AI_*` 再让编排器扣 `AGENTS_TURNS_*`(取更严)。
- **X18 联机导师(A5 R-RA8)采纳**:状态每步落库;重启后带练处于暂停,房主可继续;带练回合不读私人数据、不写记忆;由开启带练的房主承担导师次数。
- **X19 记忆整理上限共用一个每日计数**(A2 R-M4):整理、会话摘要、回顾共用 `AGENTS_MEMORY_EXTRACT_DAILY_PER_USER`。「暂停记忆」= 既不写入也不使用;关闭「记忆」工具 = 只是回复里不使用(A2 R-M6)。
- **X20 管理员只看计数,不读记忆内容**(spec §8.5)不变;角色人设原文可供管理员审核,管理员搜索走 POST 体,避免进入访问日志(A1 R-C26)。

### 4.4 对 spec / 视觉稿的修正(spec 文件不改,以此为准)

| 位置 | 修正 |
|---|---|
| spec §3.3 | 见 X14 |
| spec §4.2 | 角色**没有**「角色标签」字段;联机里的小标签用角色名;视觉稿的「面试官」标签仅示意 |
| spec §4.4 | `text=null` 也用于跳过后出题;房间不使用 `conversation_id`;流开始前的拒绝是 HTTP 状态,开始后是 SSE `error` |
| spec §4.5 | 追加 `GET /api/agents/config`、`POST /api/agents/personas/try`、举报表 `agent_persona_reports`、导师 `GET /active` 与 `POST /{id}/hint`、记忆端点在 `routers/agents_memory.py`、导师端点在 `routers/agents_tutor.py` |
| spec §5 与 §9.2 | 取更严的:私有过程**只发给提问者** |
| spec §6.3 | 每回合变化的上下文和模式块放在历史之后、最后一条用户消息里,系统消息 + 历史在回合之间保持不变 |
| spec §10.1 | 追加 `AGENTS_CHAT_MAX_TOKENS`、`AGENTS_TUTOR_MAX_TOKENS` |
| spec §11.6 | i18n 前缀 `web.agents.*`(见 X11) |
| spec §13 | `TurnRecord` 字段见 X2;`runtime(app)` 见 X1 |
| 视觉稿第 5、6 屏 | **D2 / D3 优先**:工具开关默认全开;增加「公开人设原文」开关(默认开);联机里成员看得到人设原文(创建者可关)。头像颜色保持,但不承载含义(一色一义例外已在设计稿里说明);已按此修改 `design/agents-v1/mockup.html` |
| 视觉稿的超时行 | 超时记为 `skip`(中性),失败才是红色 |

## 5. 共享文件与追加锚点(后合并的在前一个基础上追加)

| 文件 | 顺序 | 说明 |
|---|---|---|
| `server/app/models.py` | R → A1 → A2 → A3 → A5 | 各自区块追加在文件末尾,带标题注释 |
| `server/alembic/versions/` | 见 §3 | 线性 |
| `server/app/main.py` | A1(导入、`install_agent_sources(app)`、include 路由)→ A2(`install_memory`,先 include `agents_memory`)→ A3(`TutorMode` 注册,include `agents_tutor`)→ A5(`rooms_agents.install`) | |
| `server/app/core/config.py`、`settings_registry.py`、`.env.example` | W 无 → R 无 → A1(组 `("agents","智能体")`)→ A2、A3(追加在本组末尾,`apply="hot"`) | 每个变量都有中文注释说明数字含义 |
| `server/app/core/quotas.py` | 只有 A1 改(四个新键) | A2/A3/A5 不再改 |
| `server/app/admin/users_admin.USER_ROWS` | A1 → A2 → A3 | 新表引用 `users.id` 就追加 |
| `server/tests/test_architecture.py` | A1(`agents` 层)→ A2/A3(各自子包)→ A5 | |
| `web/src/architecture.test.ts` | A4(`chat→agents`、新 feature)→ A5(`rooms→agents`) | |
| `web/src/features/agents/index.ts` | A4 创建 → A2-W → A3-W 追加 | |
| `web/src/features/rooms/room-page.tsx` | R(WR-1)→ A5(AR-1) | 一行接线 |
| 各层 `CLAUDE.md` | 各自追加 | 每个新目录都有 `CLAUDE.md` |

## 6. 每份计划需要照 INDEX 调整的清单

| 计划 | 调整 |
|---|---|
| A1 | 末尾追加 Addendum AX-1(X3、X8)、保证 `runtime(app)` 与 `deps_for(app)`(X1)、`USER_ROWS`、`memory_counts` 接口位(X9) |
| A2 | `user_text` → `text`(X2);注册方式按 X1;W1 改为追加 `index.ts`、文案改 `memory/locales/` + `web.agents.memory.*`(X10、X11);W 车道晚于 A4(§2) |
| A3 | 注册方式按 X1;作用域按 X5;i18n 目录改 `tutor/locales/`(X11);W 车道晚于 A4 |
| A4 | 保证 `locales.ts` 提供子模块注册入口(X11);只留槽位不 import 导师组件(X7);H0 基线时点(X12) |
| A5 | `PersonaStore` 用法(X4);作用域(X5);A3 适配块(X6);`ProcessCapsule` / `PersonaPicker` 属性(X7);事件数组顺序(X16);`room-page.tsx`(X15);`deps_for(app)`(X1) |
| W、R | 不需要调整;R 先于 A5 |

## 7. 验证矩阵(合并后,全局验收时跑)

| 项 | 命令 / 方式 | 预期 |
|---|---|---|
| 服务端全量 | `cd server && uv run pytest -q`(分文件跑) | 全绿 |
| 迁移 | `uv run alembic upgrade head` + `downgrade -4` + `upgrade head`(SQLite),`test_migrations.py` | 绿;**Postgres 未验证**,部署前备份 |
| 架构 | `test_architecture.py`、`web/src/architecture.test.ts` | 绿 |
| 网页 | `yarn web:typecheck && yarn web:test && yarn web:build` | 绿;记录主包累计增量 |
| 管理端 | `yarn --cwd admin test`(按仓库实际命令) | 绿 |
| E2E | 本地 Playwright(临时 SQLite 服务,假上游) | wordbook-learned、rooms-reopen、agents(对话 / 导师 / 记忆 / 设置)、rooms-agents 通过 |
| 速度 | A1 Z 车道的假上游基准写入 `agents-latency.md` | 数字只来自实测;**真实上游未验证** |
| 隐私 | 每个端点 / 后台任务的 `caplog` 断言 | 日志不含用户文本、记忆、人设、词、令牌 |

**未验证(如实标注,不得在文档里写成已验证):** 真实 DeepSeek / 豆包的流式格式、`reasoning_content`、usage 块、`thinking: disabled` 在流式请求上的效果、原生函数调用、真实首字时间;SSE 与 WebSocket 经反向代理;iOS Safari / Android 键盘、语音答题、VoiceOver / TalkBack;360 px 英文标签;Postgres 上的 `0014`–`0017`。

## 8. 风险

1. **A2/A3 共享 `0016`**:任何在两者之间的部署都会破坏迁移链(§2)。缓解:连续合并,部署前核对 `alembic heads`。
2. **懒加载 `ConversationPage` / `RoomPage`**(X12):首次进入多一次分包请求,弱网下占位更久。缓解:Suspense 占位沿用现有骨架;不接受就改回主包并放宽 A4 的预算,由用户决定。
3. **A1 的流式解析是新代码**,只在假上游下测过;真实上游的差异(分块边界、`[DONE]`、usage 位置)是首要真机 / 真上游检查项。
4. **联机里个人数据来源默认开启**(D2):回复公开可见。缓解:系统提示约束 + 设置页文案 + 用户可关(`share_in_rooms`)。
5. **自由复习的答错拉回到期**(W R-L):已加 24 小时与每日 20 次两道护栏,最坏每天多 20 个点。
6. **计划 31,000 行未执行**:多数测试代码未实跑(A3 的纯模块除外已实跑 44 项),执行者第一次运行时以真实结果为准。

## 9. 下一步(等你决定)

1. 是否按本索引的顺序开始实现(派发子代理、并行车道、Sonnet 5.5 做全局验收)。
2. §8 第 2 条(懒加载两个页面)是否接受。
3. 这些文件目前**未提交**:是否提交到 `feat/self-hosted-backend`。

## 10. 执行状态(2026-10-12 实施结束时)

- 所有车道已按 §2 的顺序实现并合并到 `feat/self-hosted-backend`(迁移头 `0017`);实施中由 Sonnet 5.5 写代码,另派四个只读评审(服务端智能体核心、记忆 / 导师 / 联机、前端、已学词 / 房间重开),其发现已全部修复或裁定(见各修复提交)。
- **没有运行**合并后的最终全量测试(服务端、网页、管理端)与本地 Playwright 端到端:按用户安排留到下次再测。各车道在自己的工作树里的全量结果已在对话中汇报,但合并后的整体结果未验证。
- 仍然**未验证**:真实上游(流式格式、推理内容、usage、函数调用、首字时间)、SSE / WebSocket 经反向代理、真机(iOS / Android、语音答题)、360 px 英文标签、Postgres 上的 `0014`–`0017`。
- 已知取舍:已学词前端使主包 +2.09 kB gzip(超过计划的 1.5 kB);对话详情页与房间页改为懒加载,主包整体约 397 kB(基线文件 517.05 kB 已过期,下次测试时重录)。
- 已知偶发:测试里共享的内存 SQLite 连接与后台任务可能互相影响,已加 `tests/background.py` 的统一等待 / 取消;负载很高时仍可能出现个别偶发失败(单独运行均通过),下次全量测试时关注。
