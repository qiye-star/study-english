# 智能体 × 联机(Agents in Rooms,计划 A5)Implementation Plan

> **执行前先读 `docs/superpowers/plans/2026-10-12-agents-INDEX.md`:合并顺序、迁移链与跨计划冲突的裁决以它为准(与本计划冲突时,INDEX 优先)。**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把共用的「智能体」接进联机房间:房主在房间设置里最多选 2 个角色;成员用 `@名字` 提问,回复是普通公共消息(带角色名与「已回答 · 对 X」);读取个人数据的过程只发给提问者;角色 A 可以把问题接力给 B(最多 1 层);房主可以开启「带练」——智能体依次点名在线成员、60 秒未答自动跳过、其他人随时补充。管理端只读显示房间里的智能体,「禁用本房 AI」同时禁用智能体与带练。没有选角色的房间行为与现在逐帧一致。

**Architecture:** 服务端全部放在 `app/rooms/`(rooms 可以导入 agents,agents 不能导入 rooms,spec §3.3):纯模块 `agent_mentions.py`(`@名字` 路由与接力识别)、`tutor_rotation.py`(点名顺序与截止时间),`agent_config.py`(角色选择校验与对外视图),编排 `agent_lane.py`(`AgentLane`:准入、调用 A1 的 `run_turn(in_room=True)`、私有过程事件、公共回复、接力)与 `agent_tutor.py`(`RoomTutor`:用 A3 的纯状态机,点名、计时、持久化)。它们通过 `ConnDeps.agents` 挂进 `connection.py`(与 `voice` 同样的扩展点模式),由新路由 `routers/rooms_agents.py::install` 经 `app.state.rooms_extensions` 安装,`routers/rooms.py` 不导入它。房间级配置与带练快照放在 `rooms` 表的两个 JSON 列(迁移 `0017`)。WS 协议只做加法(3 个事件、1 个 notice code);带练的控制走 HTTP,作答就是普通 `say`。网页在 `features/rooms/agents/` 新目录实现,只经 `~/features/agents` 的公开面使用 `PersonaPicker` / `ProcessCapsule`;`RoomPage` 改为懒加载,保证主包不增长。

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + pydantic v2 + pytest-asyncio(Starlette TestClient + 30 s 帧超时);React 18 + Tailwind 3 + vitest + Testing Library;admin 控制台(React + vitest)。不新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-12-agents-design.md`(§3.3、§4.4、§5、§7.5、§8.3、§9.2、§11、§12、§13 为本计划的约束);视觉稿 `docs/superpowers/design/agents-v1/mockup.html` 第 4 屏。房间背景:`docs/superpowers/specs/2026-10-09-rank-and-rooms-design.md` §5、`docs/superpowers/specs/2026-10-10-rooms-v2-design.md`、`server/app/rooms/CLAUDE.md`、`web/src/features/rooms/CLAUDE.md`。前置计划(本计划只消费其接口,见文末「Cross-plan assumptions」):A1 `plans/2026-10-12-agents-core.md`、A2 `…-agents-memory.md`、A3 `…-agents-tutor.md`、A4 `…-agents-web.md`、R `…-rooms-reopen.md`。

## Global Constraints

- 分层不放宽:`server/tests/test_architecture.py` 中 `rooms → agents` 允许、`agents → rooms` 禁止(由 A1 加入);本计划的服务端代码只在 `app/rooms/`、`app/routers/`、`app/admin/`。`web/src/architecture.test.ts` 的 `rooms->agents` 边由 A4 登记,本计划只使用它;房间代码只从 `~/features/agents` 导入。
- 开关:一切新行为需要 `ROOMS_ENABLED` + `AGENTS_ENABLED` + `AGENTS_ROOMS_ENABLED`;带练另需 `AGENTS_TUTOR_ENABLED`。开关关闭时已存的配置保留、`@名字` 回 `notice{agent_off}`,不报错、不断线。
- **没有选角色的房间逐帧不变**:`@ai`、助手私聊、提示词(`tests/fixtures/rooms_prompts_legacy.json` 等现有夹具)、事件序列都不变;唯一的线上差异是房间对象多了 `agent_ids: []` 与 `/api/rooms/config` 多 3 个键(协议加法,契约夹具重录)。
- 协议只做加法;`protocol.test.ts` 继续读服务端 `protocol.py`;契约夹具由服务端对真实应用录制(`CONTRACT_UPDATE=1`),网页逐键核对。
- 迁移只新增 `server/alembic/versions/0017_room_agents.py`(`down_revision="0016"`);`tests/test_migrations.py::test_models_match_migrations` 保持绿。
- 隐私:日志、错误、审计、URL 里永不出现用户文本、提问、回复、人设原文、角色名、词、票据。每个新后台路径(回合、接力、带练回合、计时器、启动暂停)都有 `caplog` 断言。私有过程(`agent_step` / `agent_thought` / `agent_trace`)只发给提问者;公共消息的 `meta` 里不放过程。
- 成本:每个房间智能体回合同时受 `ROOMS_AI_*`(房间窗口、用户窗口、`room_ai_global`、队列上限)与 `AGENTS_TURNS_*`(A1 的 `run_turn` 内部)约束,任何一个拒绝即拒绝;失败退还 `room_ai_global`。
- 时间一律注入(`clock`、`sleep`),测试不真等 60 秒;后台任务在测试里用 `hub.drain()` 或 await 计时器任务;WS 测试每个帧读取都经 `tests/test_rooms_ws.py::receive`(30 s 超时)。
- 网页文案只放 `web/src/features/rooms/agents/i18n/{zh-CN,en}.json`(glob 自动深合并),前缀 `web.rooms.agents.*`(另补 `web.rooms.notice.agent_off`、`web.rooms.room.system.*` 五个键);页面测试断言中文文案(`beforeEach` 设 `localStorage["enjoy-web.settings"]={language:"zh-CN"}`,`afterEach` 删除并切回 `en`)。
- 每个任务结束:`cd server && uv run pytest -q <任务列出的测试> tests/test_architecture.py`;涉及网页:`yarn web:typecheck && cd web && yarn vitest run src/features/rooms src/architecture.test.ts`;涉及管理端:`cd admin && yarn vitest run src/features/rooms`。车道合并前跑全量 `cd server && uv run pytest -q`、`yarn web:typecheck && yarn web:test && yarn web:build`。不跑 E2E(需要真实上游、花钱)。
- 提交:conventional,一个任务一个逻辑提交,信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。

---

## 文件结构

**新建(服务端)**

| 文件 | 职责 |
|---|---|
| `server/alembic/versions/0017_room_agents.py` | `rooms.agent_config`、`rooms.agent_tutor`(JSON,可空) |
| `server/app/rooms/agent_mentions.py` | 纯函数:`agent_mention(text, names)`、`find_handoff(text, names, current)` |
| `server/app/rooms/agent_config.py` | `AgentConfig`、`config_of`、`resolve`、`validate`、`persona_out`、`agent_meta`、`PersonaLookup` |
| `server/app/rooms/agent_lane.py` | `AgentLane`、`AgentLaneDeps`、`AgentPrefs`、`AgentRoute`、`RoomChatMode` |
| `server/app/rooms/tutor_rotation.py` | 纯函数:`clamp_steps`、`initial_order`、`next_participant`、`remaining_ms` |
| `server/app/rooms/agent_tutor.py` | `RoomTutor`、`RoomTutorMode`、`tutor_rules`、`tutor_view`、`TutorError`、A3 适配块 |
| `server/app/routers/rooms_agents.py` | `install(app, rt)`;`GET /api/rooms/{id}/agents`、举报、带练 start/skip/stop/resume |
| `server/tests/fixtures/room_agent_mentions.json` | `@名字` 样例(服务端与网页共用) |
| `server/tests/fixtures/rooms_agents_contract.json` | 本计划的 HTTP/WS 契约(录制) |
| `server/tests/test_rooms_agents_{rules,protocol,store,pure,lane,api,ws,contract,privacy}.py`、`test_rooms_agent_tutor{,_api}.py`、`test_rooms_tutor_rotation.py`、`test_admin_rooms_agents.py` | 测试 |

**新建(网页,`web/src/features/rooms/agents/`)**:`i18n/{zh-CN,en}.json`、`agent-meta.ts`、`room-agents-api.ts`、`mentions.ts`、`countdown.ts`、`use-room-agents.ts`、`persona-sheet.tsx`、`agents-section.tsx`、`agent-answer.tsx`、`tutor-bar.tsx`、`tutor-start.tsx` 及各自 `*.test.ts(x)`、`room-agents-contract.test.ts`、`i18n.test.ts`;`web/src/features/rooms/room-page-lazy.tsx`(+测试)。

**修改(共享文件与插入点)**

| 文件 | 插入点 / 改动 |
|---|---|
| `server/app/models.py` | `class Room` 末尾(`invite_token` 一行之后)加两列 |
| `server/app/rooms/protocol.py` | `ACTIVITY_STATES` 之后加 `MAX_AGENTS`、`TUTOR_TURN_SECONDS`;`SERVER_EVENT_TYPES`、`NOTICE_CODES` 元组末尾追加 |
| `server/app/rooms/rules.py` | `clean_settings` 的 `for key in ("ai_public", "allow_voice")` 循环之后加 `agents` 分支 |
| `server/app/rooms/store.py` | `room_out` 返回字典末尾加 `agent_ids`;`recent_public`/`quote_for` 的 AI 名字;`assist_history` 只取助手两种 kind;`fail_pending_ai` 之前加 `set_agents`、`set_tutor`、`tutor_rooms`、`agent_context` |
| `server/app/rooms/connection.py` | `VoiceHandler` 之后加 `AgentsHandler`;`ConnDeps` 末尾加 `agents`;`on_say` 的 `mention()` 之后;`welcome` 末尾 |
| `server/app/routers/rooms.py` | `RoomsRuntime` 末尾加 `agents`、`agent_checker`、`shutdown_listeners`;`deps_for` 的 `ConnDeps(...)`;`PatchIn`;`update_room`;`rooms_config`;`ROOM_ERRORS`;`rooms_shutdown` |
| `server/app/main.py` | `app.state.rooms_extensions = (...)` 元组末尾加 `rooms_agents.install`;`include_router(rooms.router)` 之后加 `include_router(rooms_agents.router)`(在 `stubs` 之前) |
| `server/app/admin/rooms_admin.py` | `room_detail` 返回值加 `agents`、`tutor`;`admin_message_out` 对 `agent_trace` 不下发 `meta` |
| `admin/src/features/rooms/{api.ts,room-detail-page.tsx,strings.ts,test-fixtures.ts,room-detail-page.test.tsx}` | 只读「智能体」卡片 |
| `web/src/features/rooms/{protocol.ts,protocol.test.ts,rooms-contract.test.ts,room-state.ts,room-state.test.ts,rooms-api.ts,room-message-list.tsx,room-settings-sheet.tsx,room-page.tsx,index.ts}`、`create/rooms-v2-api.ts` | 见各任务 |
| `server/tests/fixtures/rooms_contract.json`(及其它带 `room` 对象的录制夹具) | 重录(只多 `agent_ids` 与 3 个 config 键) |
| `server/app/rooms/CLAUDE.md`、`server/app/CLAUDE.md`、`server/app/routers/CLAUDE.md`、`server/tests/CLAUDE.md`、`web/src/features/rooms/CLAUDE.md`、`web/README.md` | Z1 |

---

## 并行车道、文件归属与合并顺序

| 车道 | 任务 | 独占文件(本车道进行期间只有它改) | 依赖 |
|---|---|---|---|
| **S 服务端联机 × 智能体**(串行) | S1–S7 | `alembic/versions/0017_room_agents.py`、`app/models.py`(两列)、`app/rooms/{protocol,rules,store,connection,agent_mentions,agent_config,agent_lane}.py`、`app/routers/{rooms,rooms_agents}.py`、`app/main.py`、`tests/fixtures/{rooms_contract,room_agent_mentions,rooms_agents_contract}.json`(及 S3 重录的夹具)、`tests/test_rooms_agents_*.py`、`tests/test_migrations.py`(追加);网页镜像:`web/src/features/rooms/{protocol.ts,protocol.test.ts,rooms-contract.test.ts,room-state.ts(只加占位分支),rooms-api.ts}`、`create/rooms-v2-api.ts`(一行)、`agents/i18n/*`(S2 建、S6 补) | A1–A4、R 已合并 |
| **T 带练**(串行) | T1–T3 | `app/rooms/{tutor_rotation,agent_tutor}.py`、`app/routers/rooms_agents.py`(T3 起)、`tests/test_rooms_{tutor_rotation,agent_tutor,agent_tutor_api}.py`、`tests/fixtures/rooms_agents_contract.json`(T3 重录) | S7 |
| **A 管理端** | A1 | `app/admin/rooms_admin.py`、`admin/src/features/rooms/**`、`tests/test_admin_rooms_agents.py` | S3(T3 合并后再合并,以显示带练状态) |
| **W 网页**(串行) | W0–W6 | `web/src/features/rooms/agents/**`、`room-page-lazy.tsx`、`index.ts`、`room-state.ts`(+测试,W1 起)、`room-message-list.tsx`(+测试)、`room-settings-sheet.tsx`、`room-page.tsx`(W6,见 Addendum AR-1) | W0 无依赖;W1 起 ← S7(夹具)、T3(带练夹具) |
| **Z 收尾** | Z1–Z2 | 各层 `CLAUDE.md`、`web/README.md`、本计划的验证记录 | 全部 |

**合并顺序:** S1 → S2 → S3 → S4 → S5 → S6 → S7 → T1 → T2 → T3 → A1 → W0 → W1 → W2 → W3 → W4 → W5 → W6 → Z1 → Z2。T1、S4(纯函数)与 W0 可以并行开发,按上面的顺序合并。

**评审波:** S5、T2 各单独 `/code-review high`(并发、隐私、成本是风险最高的部分;spec §7.5 要求带练单独评审);S7 与 T3 合并后对 `app/rooms/agent_*` 跑一次 `security-review`(私有事件泄漏、举报与带练端点的越权、提示词注入面);Z2 对整个计划的改动跑 `/code-review high`。

## 本计划的裁定

- **R-RA1 存储(需要迁移 0017)。** Ruling:新增 `rooms.agent_config`(`{"persona_ids": [...], "chosen_by": <user_id>}`)与 `rooms.agent_tutor`(带练快照)两个可空 JSON 列,`JSON(none_as_null=True)`。为什么:`rooms` 没有可复用的 JSON 设置列(7 项设置都是独立列,核对 `models.py`);消息 `meta` 不能当配置存储;A3 的 `agent_tutor_sessions` 按用户/对话设计,房间多人点名不适配。代价:若 INDEX 决定把智能体配置放别处,要一次迁移搬数据(列可空,无回填,回滚只删两列)。
- **R-RA2 公共回复的形状。** Ruling:智能体回复存为 `kind="ai_answer"`、`sender_kind="ai"`、`reply_to=<提问 seq>`,`meta={"agent": {"persona_id", "name"}, "asker": {"id", "name"}, "handoff_from"?: {...}, "tutor"?: {...}}`。为什么:复用表情回应、引用、隐藏、`recent_public`、管理端时间线;旧客户端当作「AI 助手」回答显示,不会坏。代价:`sender_kind` 区分不出智能体,统计要看 `meta.agent`。
- **R-RA3 角色归属。** Ruling:角色按选择时的房主(`chosen_by`)解析;房主转移给继承人后角色仍有效;被删除的角色静默消失;被停用的角色 `@` 时回 `notice{agent_off}`。选择校验 = `rules.clean_settings`(形状,与房主/管理员编辑共用一条规则)+ `agent_config.validate`(内置或本人所有、未停用、不叫 `ai`/`助手`、两个不同名)。管理员不能改智能体(`ADMIN_SETTING_FIELDS` 不含 `agents`)。
- **R-RA4 `@名字` 路由。** Ruling:只认消息开头的 `@<角色名>` + 分隔符 + 问题(与 `@ai` 同规则),大小写不敏感、长名字优先;`@ai`/`@助手` 永远先匹配走旧路径;匹配不到就是普通消息(不回提示)。共用样例 `tests/fixtures/room_agent_mentions.json`。
- **R-RA5 与 `@ai` 共用一套闸门。** Ruling:智能体回合使用房间的 AI 锁(同一房间同一时刻只有一个 AI 在说话,`@ai` 与智能体按到达顺序串行)、AI 队列上限(`ai_queue`,默认 3,两者合计)、房间小时窗口、用户 10 分钟窗口与 `room_ai_global`;`AGENTS_TURNS_*` 由 `run_turn` 内部计数(返回 `Error{code:"limit"}` 时房间退还 `room_ai_global` 并广播 `ai_failed{quota}`)。房主关闭「群内 @AI」(`ai_public=false`)时智能体也不回答;管理员 `ai_muted` 同样。单回合总时限 45 s(`AGENT_TURN_TIMEOUT`)。
- **R-RA6 过程隐私。** Ruling:spec §5 说「private 步骤只发给提问者」,§9.2 说「过程只发给提问者」——取更严的:**全部** `agent_step` / `agent_thought` 只发给提问者(`hub.broadcast(only_user=asker)`),`private` 字段只用来显示琥珀色「仅你可见」。压缩过程存为私有行 `lane="private", audience_id=asker, kind="agent_trace", reply_to=<回复 seq>`(刷新后胶囊仍可用),从不放进公共 `meta`。`share_in_rooms=false` 时房间自己把私有上下文来源从注册表里去掉(不依赖 A1 是否也过滤);`show_process=false` 时不发过程帧,仍存 trace。`assist_history` 只取 `assist_request`/`assist_reply`,免得 trace 挤掉助手历史。管理端时间线对 `agent_trace` 不下发 `meta`。
- **R-RA7 接力。** Ruling:角色 A 的回复里任意位置出现 `@<本房另一个角色名>` 即触发 B 的一次回合(深度 1,B 的回复不再触发);B 的回合重新走准入(占队列、计费),被拒则不接力(只告诉提问者);B 回合不写记忆;B 回复的 `reply_to` 是 A 回复的 seq,`meta.handoff_from` 为 A。
- **R-RA8 带练的持久化级别。** Ruling:快照在每次状态转换时写入 `rooms.agent_tutor`;**重连**完全恢复(`welcome` 之后补发一帧 `agent_tutor`,倒计时按服务端给的 `remaining_ms` 计算,不依赖客户端时钟);**重启**后所有进行中的带练变为 `paused`(`paused_reason="restart"`),房主点「继续」重问当前成员——计时器只在进程内,不在重启后自动续跑。只有文字回答推进(语音消息算补充);带练回合不读任何私有来源、不写记忆;`AGENTS_TURNS_*` 计在开启者(房主)名下,每回合另计房间额度;带练回合不受 `ai_queue` 上限限制但仍经 AI 锁串行;每次开始计 `agent_tutor` 日额度(`AGENTS_TUTOR_DAILY_PER_USER`)。点名对象 = 开始时在线的成员(按加入顺序),之后加入的人排到队尾,离开的人跳过。
- **R-RA9 协议。** Ruling:新增服务端事件 `agent_step{turn_id, reply_to, step}`、`agent_thought{turn_id, reply_to, thought}`(私有)与 `agent_tutor{tutor}`(公共,`null` = 没有带练);新 notice `agent_off`;常量 `MAX_AGENTS=2`、`TUTOR_TURN_SECONDS=60`。不新增客户端帧(带练控制走 HTTP,作答是普通 `say`)。`ai_typing` **不加字段**:`rooms-contract.test.ts` 逐键比对录制的 `ai_typing`,网页从被回复消息的 `@名字` 推出「Emma 正在回答…」。
- **R-RA10 HTTP。** Ruling:房间对象加 `agent_ids`;`/api/rooms/config` 加 `agents_available`、`agent_tutor_available`、`max_agents`;`PATCH /api/rooms/{id}` 接受 `agents`(仅房主);新 `GET /api/rooms/{id}/agents`(成员)返回角色名、简介、水平、风格、是否内置/停用,`prompt_public` 时附人设原文;成员在房间里举报角色走 `POST /api/rooms/{id}/agents/{persona_id}/report`(成员 + 角色属于本房),内部调 A1 的举报。带练进行中改智能体 → 409 `Room tutor is running`。
- **R-RA11 网页懒加载。** Ruling:`features/rooms/index.ts` 导出的 `RoomPage` 改为自带 `Suspense` 的懒加载包装(`room-page-lazy.tsx`),房间页及其全部智能体界面离开主包(spec R-A2 的 0.2 kB 预算对本计划成立);`room-page.tsx` 冻结规则的例外见 Addendum AR-1。
- **R-RA12 角色标签。** Ruling:spec §4.2 没有「身份/职称」字段,视觉稿里的「面试官」无从取值;回复头部显示角色名 + 统一的「智能体」标签,点名字打开角色信息。代价:与视觉稿第 4 屏不完全一致(已列入 spec 问题)。
- **R-RA13 人设原文可见性。** Ruling:按 spec D3/§9.1——`prompt_public=true` 时成员可看原文;视觉稿第 5 屏的提示「看不到人设原文」与 spec 冲突,以 spec 为准。
- **R-RA14 不做公共流式。** Ruling:智能体回复只以最终消息发出(与 `@ai` 一致),提问者在等待期间看到私有过程胶囊;不新增 `agent_delta` 事件。
- **R-RA15 房间短期上下文。** Ruling:房间回合的历史直接取最近 20 条公共消息(`RoomStore.agent_context`),不使用 spec §8.1 的 `agent_thread_states`(房间线程)——A2 若在 `after_turn` 里按 `room_id` 维护,也只在提问者开启记忆的直接回合里被调用。

---

## Task 0: 开工检查(执行者第一步,不提交)

- [ ] **Step 1: 前置计划已合并** — Run: `cd server && uv run alembic heads` → 必须是唯一一行 `0016 (head)`。否则停下,等 A2/A3 合并。
- [ ] **Step 2: 核对消费的接口名** — 逐条确认存在且签名一致(文末「Cross-plan assumptions」A1-1…A4-4):
  `grep -n "async def run_turn\|class TurnDeps\|class TurnRequest\|class ModeBlock\|class TurnHooks" server/app/agents/orchestrator.py`;
  `grep -n "class Step\|class Thought\|class Delta\|class Meta\|class Done\|class Error\|def to_dict" server/app/agents/trace.py`;
  `grep -n "class SourceRegistry\|def sources\|def register" server/app/agents/context.py`;
  `grep -n "class PersonaStore\|async def get\|async def report\|def builtin_personas" server/app/agents/personas.py`;
  `grep -n "async def load\|share_in_rooms\|memory_enabled\|show_process" server/app/agents/settings.py`;
  `grep -n "def initial_state\|def next_state\|def difficulty\|class TutorEvent\|def to_dict\|def from_dict" server/app/agents/tutor/machine.py`;`grep -n "def build_plan" server/app/agents/tutor/plan.py`;`grep -n "def parse_meta\|class StreamFilter" server/app/agents/tutor/parse.py`;
  `grep -n "agent_turn_deps" server/app/main.py`;`grep -n "agents_enabled\|agents_rooms_enabled\|agents_tutor_enabled\|agents_tutor_daily_per_user" server/app/core/config.py`;`grep -n "class AgentPersona" server/app/models.py`;
  `grep -n "\"rooms\"" server/tests/test_architecture.py`(`rooms` 的允许集合含 `agents`);
  `grep -n "PersonaPicker\|ProcessCapsule\|type Persona\|AgentStep\|AgentTrace" web/src/features/agents/index.ts`;`grep -n "rooms->agents" web/src/architecture.test.ts`;`grep -n "glob" web/src/i18n/index.ts`(`../**/i18n/*.json`)。
  任何一项不一致:停下,在本文件末尾写 `## Addendum (日期) · 接口对齐`,列出实际名字并只改受影响任务里的调用行(A3 只影响 `agent_tutor.py` 的「A3 适配块」四个函数与 `test_a3_adapter_*`),再开工。
- [ ] **Step 3: 基线** — Run: `cd server && uv run pytest -q tests/test_rooms_*.py tests/test_web_contract.py tests/test_architecture.py`、`cd web && yarn vitest run src/features/rooms src/architecture.test.ts` → 全绿;记下 `yarn web:build` 后主入口 gzip 体积:`node -e "const z=require('zlib'),f=require('fs'),p=require('path');const d='web/dist/assets';for(const n of f.readdirSync(d).filter(n=>/^index-.*\.js$/.test(n)))console.log(n,z.gzipSync(f.readFileSync(p.join(d,n))).length)"`(W0 与 Z2 对比用)。

---

## Lane S · 服务端联机 × 智能体

### Task S1: 迁移 0017、`Room` 两列、`clean_settings` 的 `agents` 形状校验

**Files:**
- Create: `server/alembic/versions/0017_room_agents.py`
- Modify: `server/app/models.py`、`server/app/rooms/protocol.py`(只加 `MAX_AGENTS`)、`server/app/rooms/rules.py`、`server/tests/test_migrations.py`(追加)
- Test: `server/tests/test_rooms_agents_rules.py`

**Interfaces:**
- Produces(`app.models.Room`):`agent_config: dict | None`、`agent_tutor: dict | None`(`JSON(none_as_null=True)`)
- Produces(`app.rooms.protocol`):`MAX_AGENTS = 2`
- Produces(`app.rooms.rules.clean_settings`):`raw["agents"]`(list[str])→ `values["agents"]` 或 `errors["agents"] ∈ {"invalid","too_many","duplicate"}`;`[]` 合法(= 清空)

- [ ] **Step 1: 写失败测试**

`server/tests/test_migrations.py` 末尾追加(`_config`、`command`、`sqlite3` 已在文件中):

```python
def test_0017_room_agents_columns_round_trip(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "head")
    con = sqlite3.connect(db)
    assert {"agent_config", "agent_tutor"} <= {r[1] for r in con.execute("pragma table_info(rooms)")}
    con.close()
    command.downgrade(cfg, "0016")
    con = sqlite3.connect(db)
    assert not {"agent_config", "agent_tutor"} & {r[1] for r in con.execute("pragma table_info(rooms)")}
    con.close()
    command.upgrade(cfg, "head")
```

`server/tests/test_rooms_agents_rules.py`:

```python
from app.admin.rooms_admin import clean_admin_settings
from app.rooms.protocol import MAX_AGENTS
from app.rooms.rules import clean_settings

U1 = "0b6c1f3e-2a4d-4c5e-9f00-1234567890ab"


def clean(raw):
    return clean_settings(raw, site_max_members=8, partial=True)


def test_agents_shape_is_part_of_the_one_settings_rule():
    assert MAX_AGENTS == 2
    assert clean({"agents": ["builtin:coach", U1]}) == ({"agents": ["builtin:coach", U1]}, {})
    assert clean({"agents": []}) == ({"agents": []}, {})  # clearing is allowed
    for bad, code in (
        (["builtin:coach", "builtin:waiter", "builtin:reviewer"], "too_many"),
        (["builtin:coach", "builtin:coach"], "duplicate"),
        (["coach"], "invalid"), (["BUILTIN:coach"], "invalid"), ("builtin:coach", "invalid"), ([1], "invalid"),
        ([U1.upper()], "invalid"), (["builtin:" + "x" * 40], "invalid"),
    ):
        assert clean({"agents": bad}) == ({}, {"agents": code}), bad


def test_rooms_without_agents_get_the_old_results():
    assert clean({"name": "美食", "ai_public": False}) == ({"name": "美食", "ai_public": False}, {})
    assert clean({"agents": None, "level": "B2"}) == ({"level": "B2"}, {})


def test_operators_cannot_set_agents():
    assert clean_admin_settings({"agents": ["builtin:coach"], "name": "x"}, site_max_members=8) == ({"name": "x"}, {})
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rooms_agents_rules.py tests/test_migrations.py` → FAIL(`ImportError: MAX_AGENTS`;无 0017)

- [ ] **Step 3: 实现**

`server/app/models.py` — `class Room` 中 `invite_token` 一行之后:

```python
    # ---- agents in rooms (plan 2026-10-12-agents-rooms R-RA1, migration 0017); none_as_null: None is SQL NULL ----
    agent_config: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    agent_tutor: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)
```

`server/alembic/versions/0017_room_agents.py`:

```python
"""room agents: persona selection and room tutor snapshot (plan 2026-10-12-agents-rooms R-RA1)

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-12 12:00:00.000000

Two nullable JSON columns on `rooms`, no backfill. ADD COLUMN of a nullable column is a plain ALTER on SQLite and
Postgres (no table rewrite, no long lock); the downgrade uses batch mode for SQLite.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0017'
down_revision: Union[str, Sequence[str], None] = '0016'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('rooms', sa.Column('agent_config', sa.JSON(), nullable=True))
    op.add_column('rooms', sa.Column('agent_tutor', sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('rooms') as batch:
        batch.drop_column('agent_tutor')
        batch.drop_column('agent_config')
```

`server/app/rooms/protocol.py` — `ACTIVITY_STATES = (...)` 一行之后:

```python
MAX_AGENTS = 2  # personas a room owner can pick (spec 2026-10-12-agents §9.2)
```

`server/app/rooms/rules.py` — 文件头 import 区加 `from app.rooms.protocol import MAX_AGENTS`;常量区(`MAX_MEMBERS_CAP` 之后)加:

```python
# A persona id: a builtin key or a lowercase uuid4 (agents spec §4.2). Shape only; existence is checked by
# agent_config.validate against the owner (plan 2026-10-12-agents-rooms R-RA3).
_PERSONA_ID = re.compile(
    r"^(?:builtin:[a-z][a-z0-9_]{0,31}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$")
```

`clean_settings` 中 `for key in ("ai_public", "allow_voice"):` 循环之后、`return values, errors` 之前:

```python
    if raw.get("agents") is not None:  # owner only: ADMIN_SETTING_FIELDS never passes it (R-RA3)
        ids = raw["agents"]
        if not isinstance(ids, list) or not all(isinstance(i, str) and _PERSONA_ID.match(i) for i in ids):
            errors["agents"] = "invalid"
        elif len(ids) > MAX_AGENTS:
            errors["agents"] = "too_many"
        elif len(set(ids)) != len(ids):
            errors["agents"] = "duplicate"
        else:
            values["agents"] = list(ids)
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_rooms_agents_rules.py tests/test_migrations.py tests/test_rooms_rules.py tests/test_rooms_settings.py tests/test_architecture.py` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/alembic/versions/0017_room_agents.py server/app/models.py server/app/rooms/protocol.py server/app/rooms/rules.py server/tests/test_migrations.py server/tests/test_rooms_agents_rules.py
git commit -m "feat(server): room agent columns (0017) and the agents shape rule in clean_settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task S2: 协议加法(服务端 + 网页镜像)

**Files:**
- Modify: `server/app/rooms/protocol.py`、`web/src/features/rooms/protocol.ts`、`web/src/features/rooms/protocol.test.ts`、`web/src/features/rooms/rooms-contract.test.ts`、`web/src/features/rooms/room-state.ts`(占位分支)
- Create: `web/src/features/rooms/agents/i18n/zh-CN.json`、`web/src/features/rooms/agents/i18n/en.json`
- Test: `server/tests/test_rooms_agents_protocol.py`

**Interfaces:**
- Produces(`protocol.py`):`TUTOR_TURN_SECONDS = 60`;`SERVER_EVENT_TYPES += ("agent_step", "agent_thought", "agent_tutor")`;`NOTICE_CODES += ("agent_off",)`
- Produces(`protocol.ts`):`ROOM_AGENTS = { max: 2, tutorTurnSeconds: 60 }`、类型 `AgentStepWire`、`AgentThoughtWire`、`RoomTutorInfo`;`RoomEvent` 新增三个成员;`RoomMessage.kind` 加 `"agent_trace"`;notice code 加 `"agent_off"`

- [ ] **Step 1: 写失败测试**

`server/tests/test_rooms_agents_protocol.py`:

```python
import pytest

from app.rooms.protocol import (
    AI_FAILED_CODES, MAX_AGENTS, NOTICE_CODES, PROTOCOL_VERSION, SERVER_EVENT_TYPES, TUTOR_TURN_SECONDS, ProtocolError,
    event, parse_client_message,
)


def test_agent_events_are_additive():
    assert SERVER_EVENT_TYPES[-3:] == ("agent_step", "agent_thought", "agent_tutor")
    assert SERVER_EVENT_TYPES[:4] == ("welcome", "message", "ack", "presence")  # nothing before them moved
    assert NOTICE_CODES[-1] == "agent_off" and AI_FAILED_CODES == ("upstream", "quota", "restart")
    assert (MAX_AGENTS, TUTOR_TURN_SECONDS, PROTOCOL_VERSION) == (2, 60, 2)
    assert event("agent_tutor", tutor=None) == {"type": "agent_tutor", "tutor": None}


def test_no_new_client_frames():
    with pytest.raises(ProtocolError):
        parse_client_message('{"type":"agent_step"}')
```

`web/src/features/rooms/protocol.test.ts` — 在 `describe("protocol v2", ...)` 之后追加:

```ts
describe("agents in rooms (plan 2026-10-12-agents-rooms)", () => {
  it("mirrors the server constants", () => {
    expect(pyInt("MAX_AGENTS")).toBe(ROOM_AGENTS.max);
    expect(pyInt("TUTOR_TURN_SECONDS")).toBe(ROOM_AGENTS.tutorTurnSeconds);
    expect(ROOM_SERVER_EVENT_TYPES.slice(-3)).toEqual(["agent_step", "agent_thought", "agent_tutor"]);
  });
  it("parses the private process frames with camelCased keys", () => {
    const ev = parseRoomEvent(JSON.stringify({ type: "agent_step", turn_id: "t1", reply_to: 4,
      step: { id: "s1", group: "context", key: "learned_words", status: "done", label_key: "agents.step.learned_words", params: { count: 6 }, ms: 12, private: true } }));
    expect(ev).toEqual({ type: "agent_step", turnId: "t1", replyTo: 4,
      step: { id: "s1", group: "context", key: "learned_words", status: "done", labelKey: "agents.step.learned_words", params: { count: 6 }, ms: 12, private: true } });
    expect(parseRoomEvent('{"type":"agent_tutor","tutor":null}')).toEqual({ type: "agent_tutor", tutor: null });
  });
});
```

并把文件顶部的 import 改为(加 `ROOM_AGENTS`):

```ts
import {
  encodeAssist, encodeHello, encodePing, encodeReact, encodeSay, encodeTyping, encodeVoiceRetry, encodeVoiceTranslate, isTerminalClose,
  mentionsAi, parseRoomEvent, REACTION_GLYPHS, REACTION_KEYS, ROOM_AGENTS, ROOM_CLOSE, ROOM_LIMITS, ROOM_PROTOCOL_VERSION, ROOM_SERVER_EVENT_TYPES, roomWsUrl,
} from "./protocol";
```

`web/src/features/rooms/rooms-contract.test.ts` — `EVENTS` 对象末尾(`join_request_closed` 之后)追加三项,`CODES.notice` 加 `agent_off: true`:

```ts
  // agents in rooms: recorded in server/tests/fixtures/rooms_agents_contract.json (agents/room-agents-contract.test.ts)
  agent_step: { type: true, turnId: true, replyTo: true, step: true },
  agent_thought: { type: true, turnId: true, replyTo: true, thought: true },
  agent_tutor: { type: true, tutor: true },
```

```ts
  notice: { ai_off: true, ai_busy: true, ai_quota: true, voice_off: true, voice_quota: true, translate_quota: true, retry_limit: true, agent_off: true },
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rooms_agents_protocol.py`;`cd web && yarn vitest run src/features/rooms/protocol.test.ts` → FAIL

- [ ] **Step 3: 实现**

`server/app/rooms/protocol.py` — 模块文档字符串里,`frames; \`welcome.protocol\` tells the web which version the server speaks.` 这一行之后、结束的 `"""` 之前插入一个空行和下面三行:

```text
Agents in rooms (plan 2026-10-12-agents-rooms R-RA9) only add: the private events `agent_step` / `agent_thought`
(sent to the asker only), the public `agent_tutor`, the notice `agent_off` and MAX_AGENTS / TUTOR_TURN_SECONDS.
No new client frames: tutor controls are HTTP, answers are ordinary `say`.
```

`MAX_AGENTS` 一行之后:

```python
TUTOR_TURN_SECONDS = 60  # room tutor: a called-on member's time to answer before it is skipped (spec §7.5)
```

两个元组改为:

```python
SERVER_EVENT_TYPES = (
    "welcome", "message", "ack", "presence", "ai_typing", "ai_failed", "assist_reply", "assist_failed",
    "room_update", "notice", "error", "closed", "pong", "message_hidden",
    "activity", "reaction", "voice_update", "join_request", "join_request_closed",
    "agent_step", "agent_thought", "agent_tutor",
)
ERROR_CODES = ("rate_limited", "empty", "bad_assist", "bad_reply", "bad_seq")
NOTICE_CODES = ("ai_off", "ai_busy", "ai_quota", "voice_off", "voice_quota", "translate_quota", "retry_limit", "agent_off")
```

(上面按本计划写作时的代码给出;R 计划合并后两个元组里已有 R 追加的项(例如 `reopened`),一律保留,本计划的项接在最后。下面网页数组与 `EVENTS` 表同理。)

`web/src/features/rooms/protocol.ts`:

```ts
export const ROOM_SERVER_EVENT_TYPES = ["welcome", "message", "ack", "presence", "ai_typing", "ai_failed", "assist_reply", "assist_failed", "room_update", "notice", "error", "closed", "pong", "message_hidden",
  "activity", "reaction", "voice_update", "join_request", "join_request_closed", "agent_step", "agent_thought", "agent_tutor"] as const;
/** 联机智能体(plan 2026-10-12-agents-rooms):房主最多选 max 个角色;带练每人 tutorTurnSeconds 秒作答。 */
export const ROOM_AGENTS = { max: 2, tutorTurnSeconds: 60 } as const;
```

在 `RoomMemberInfo` 之后加:

```ts
/** 智能体过程的一步(只发给提问者;spec §4.4 的 step 形状,camelCase)。private = 读了个人数据,界面标「仅你可见」。 */
export interface AgentStepWire {
  id: string; group: "context" | "tool"; key: string; status: "run" | "done" | "fail" | "skip"; labelKey: string;
  params?: Record<string, unknown> | null; ms?: number | null; private: boolean;
}
/** summary = 模型自述(界面注明「非原始推理」),reasoning = 推理模型返回的文字。 */
export interface AgentThoughtWire { source: "summary" | "reasoning"; text: string }
/** 带练的公共状态(rooms.agent_tutor 的对外视图)。remainingMs 是服务端发出这一帧时的剩余毫秒,倒计时据此计算。 */
export interface RoomTutorInfo {
  personaId: string; personaName: string; phase: "generating" | "await_answer" | "paused"; stepIndex: number; stepsTotal: number;
  currentUserId: number | null; currentName: string | null; deadlineAt: string | null; remainingMs: number | null; startedBy: number;
  pausedReason: "restart" | "quota" | "upstream" | "ai_off" | "agent_off" | null;
}
```

`RoomMessage.kind` 改为 `"text" | "voice" | "ai_answer" | "system" | "assist_request" | "assist_reply" | "agent_trace"`;`RoomEvent` 的 notice 一行改为 `| { type: "notice"; code: "ai_off" | "ai_busy" | "ai_quota" | "voice_off" | "voice_quota" | "translate_quota" | "retry_limit" | "agent_off" }`,并在联合类型末尾(`join_request_closed` 之后)加:

```ts
  | { type: "agent_step"; turnId: string; replyTo: number; step: AgentStepWire }
  | { type: "agent_thought"; turnId: string; replyTo: number; thought: AgentThoughtWire }
  | { type: "agent_tutor"; tutor: RoomTutorInfo | null };
```

(原来的 `join_request_closed` 行末分号改为无分号。)

`web/src/features/rooms/room-state.ts` — `onEvent` 的 `switch` 末尾(`join_request_closed` 分支之后)加占位分支(W1 实现):

```ts
    case "agent_step":
    case "agent_thought":
    case "agent_tutor":
      return s; // plan 2026-10-12-agents-rooms W1 folds these
```

`web/src/features/rooms/agents/i18n/zh-CN.json`:

```json
{
  "web": {
    "rooms": {
      "notice": { "agent_off": "这个智能体现在不可用" }
    }
  }
}
```

`web/src/features/rooms/agents/i18n/en.json`:

```json
{
  "web": {
    "rooms": {
      "notice": { "agent_off": "This agent is not available right now" }
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_rooms_agents_protocol.py tests/test_rooms_protocol.py tests/test_rooms_protocol_v2.py`;`yarn web:typecheck && cd web && yarn vitest run src/features/rooms` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/app/rooms/protocol.py server/tests/test_rooms_agents_protocol.py web/src/features/rooms/protocol.ts web/src/features/rooms/protocol.test.ts web/src/features/rooms/rooms-contract.test.ts web/src/features/rooms/room-state.ts web/src/features/rooms/agents/i18n
git commit -m "feat(rooms): additive protocol for room agents (agent_step, agent_thought, agent_tutor, agent_off)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task S3: Store 与对外形状(`agent_ids`、config 键、上下文、契约重录)

**Files:**
- Modify: `server/app/rooms/store.py`、`server/app/routers/rooms.py`(只改 `rooms_config`)、`web/src/features/rooms/protocol.ts`(`RoomInfo.agentIds`)、`web/src/features/rooms/rooms-api.ts`(`RoomsConfig`)、`web/src/features/rooms/rooms-contract.test.ts`(`ROOM`、`CONFIG`)
- Re-record: `server/tests/fixtures/rooms_contract.json` 以及其它带 `room` 对象的录制夹具(见 Step 4)
- Test: `server/tests/test_rooms_agents_store.py`

**Interfaces:**
- Produces(`store.room_out`):末尾键 `"agent_ids": list[str]`
- Produces(`RoomStore`):`set_agents(room_id, owner_id, persona_ids) -> tuple[Room, bool]`(`RoomError("tutor_active")`)、`set_tutor(room_id, snapshot | None)`、`tutor_rooms() -> list[tuple[str, dict]]`、`agent_context(room_id, limit, *, before_seq) -> list[tuple[str, str, str | None]]`
- Produces(`/api/rooms/config`):`agents_available`、`agent_tutor_available`、`max_agents`
- Changes:`recent_public` / `quote_for` 对带 `meta.agent` 的回复用角色名;`assist_history` 只返回 `assist_request`/`assist_reply`

- [ ] **Step 1: 写失败测试**

`server/tests/test_rooms_agents_store.py`:

```python
from datetime import datetime, timezone

import pytest

from app.models import User
from app.rooms.rules import RoomLimits
from app.rooms.store import AI_NAME, RoomError, RoomStore, room_out

NOW = datetime(2026, 10, 12, 9, 0, tzinfo=timezone.utc)
A, B = 11111111, 22222222
EMMA = {"persona_id": "builtin:coach", "name": "Emma"}


@pytest.fixture
async def env(app):
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=A, username="alice", password_hash="x"), User(id=B, username="bob", password_hash="x")])
        await s.commit()
    store = RoomStore(app.state.sessionmaker, RoomLimits())
    room = await store.create(A, "面试", NOW)
    await store.join(room.code, B, NOW)
    return store, room


async def test_room_out_lists_agent_ids_and_set_agents_is_owner_only(env):
    store, room = env
    assert room_out(room, my_role="owner", member_count=2, online_count=0)["agent_ids"] == []
    with pytest.raises(RoomError) as e:
        await store.set_agents(room.id, B, ["builtin:coach"])
    assert e.value.code == "forbidden"
    updated, changed = await store.set_agents(room.id, A, ["builtin:coach", "builtin:interviewer"])
    assert changed and updated.agent_config == {"persona_ids": ["builtin:coach", "builtin:interviewer"], "chosen_by": A}
    assert room_out(updated, my_role=None, member_count=2, online_count=0)["agent_ids"] == ["builtin:coach", "builtin:interviewer"]
    _, again = await store.set_agents(room.id, A, ["builtin:coach", "builtin:interviewer"])
    assert again is False
    cleared, changed = await store.set_agents(room.id, A, [])
    assert changed and cleared.agent_config is None


async def test_tutor_snapshot_round_trip_and_blocks_agent_changes(env):
    store, room = env
    await store.set_agents(room.id, A, ["builtin:coach"])
    await store.set_tutor(room.id, {"phase": "await_answer", "run_id": "r1"})
    assert await store.tutor_rooms() == [(room.id, {"phase": "await_answer", "run_id": "r1"})]
    with pytest.raises(RoomError) as e:
        await store.set_agents(room.id, A, [])
    assert e.value.code == "tutor_active"
    await store.set_tutor(room.id, None)
    assert await store.tutor_rooms() == []
    assert (await store.room(room.id)).agent_tutor is None  # SQL NULL, not JSON 'null'


async def test_agent_answers_are_named_in_context_and_quotes(env):
    store, room = env
    q = await store.append(room.id, lane="public", sender_kind="user", sender_id=B, kind="text",
                           text="@Emma can I say this?", now=NOW)
    a = await store.append(room.id, lane="public", sender_kind="ai", sender_id=None, kind="ai_answer",
                           text="Sure.", now=NOW, reply_to=q.seq, meta={"agent": EMMA, "asker": {"id": B, "name": "bob"}})
    legacy = await store.append(room.id, lane="public", sender_kind="ai", sender_id=None, kind="ai_answer",
                                text="It means hello.", now=NOW, reply_to=q.seq)
    assert await store.recent_public(room.id, 10) == [("bob", "@Emma can I say this?"), ("Emma", "Sure."),
                                                      (AI_NAME, "It means hello.")]
    assert (await store.quote_for(room.id, a.seq))["name"] == "Emma"
    assert (await store.quote_for(room.id, legacy.seq))["name"] == AI_NAME
    assert await store.agent_context(room.id, 10, before_seq=legacy.seq) == [
        ("bob", "@Emma can I say this?", None), ("Emma", "Sure.", "builtin:coach")]


async def test_assist_history_ignores_agent_traces(env):
    store, room = env
    await store.append(room.id, lane="private", audience_id=B, sender_kind="user", sender_id=B, kind="assist_request",
                       text="巧克力", now=NOW)
    await store.append(room.id, lane="private", audience_id=B, sender_kind="ai", sender_id=None, kind="agent_trace",
                       text="", now=NOW, reply_to=1, meta={"turn_id": "t1", "trace": {"steps": []}})
    assert [m.kind for m, _ in await store.assist_history(room.id, B, 10)] == ["assist_request"]
```

`web/src/features/rooms/rooms-contract.test.ts` — `ROOM` 与 `CONFIG` 两个键表各加一个/三个键(其余不动):

```ts
const ROOM: Record<keyof RoomInfo, true> = { id: true, code: true, topic: true, status: true, locked: true, aiPublic: true, aiMuted: true, ownerId: true,
  myRole: true, memberCount: true, onlineCount: true, createdAt: true, closedAt: true,
  name: true, scenario: true, level: true, joinMode: true, maxMembers: true, allowVoice: true, agentIds: true };
```

```ts
const CONFIG: Record<keyof RoomsConfig, true> = { enabled: true, aiAvailable: true, maxMembers: true, maxText: true,
  scenarios: true, levels: true, defaultMaxMembers: true, nameMax: true, voiceAvailable: true, maxVoiceMs: true, summaryAvailable: true, reactions: true,
  agentsAvailable: true, agentTutorAvailable: true, maxAgents: true };
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rooms_agents_store.py` → FAIL(无 `agent_ids` / `set_agents`)

- [ ] **Step 3: 实现**

`server/app/rooms/store.py`:

在 `voice_out` 之前加:

```python
def _agent_meta(m: RoomMessage) -> dict | None:
    """`meta.agent` of a room agent's answer (plan 2026-10-12-agents-rooms R-RA2), else None."""
    agent = m.meta.get("agent") if isinstance(m.meta, dict) else None
    return agent if isinstance(agent, dict) and isinstance(agent.get("name"), str) else None


def _ai_name(m: RoomMessage, name: str | None) -> str:
    """Speaker label for AI context and quotes: the agent's name, the legacy assistant name, or the member."""
    if m.sender_kind != "ai":
        return name or ""
    agent = _agent_meta(m)
    return agent["name"] if agent else AI_NAME
```

`room_out` 返回字典末尾(`"allow_voice": room.allow_voice` 之后):

```python
            "max_members": room.max_members, "allow_voice": room.allow_voice,
            "agent_ids": list((room.agent_config or {}).get("persona_ids") or [])
            if isinstance(room.agent_config, dict) else []}
```

`recent_public` 的返回改为:

```python
        return [(_ai_name(m, n), f"(voice) {m.text}" if m.kind == "voice" else m.text) for m, n in reversed(rows)]
```

`quote_for` 的返回改为:

```python
        return {"seq": m.seq, "name": _ai_name(m, name), "kind": m.kind, "text": text[:QUOTE_MAX]}
```

`assist_history` 的 `where` 加一个条件:

```python
        rows = await self._named(self._select().where(RoomMessage.room_id == room_id, RoomMessage.lane == "private",
                                                      RoomMessage.audience_id == user_id,
                                                      RoomMessage.kind.in_(("assist_request", "assist_reply")))
                                 .order_by(RoomMessage.seq.desc()).limit(limit))
```

`fail_pending_ai` 之前加:

```python
    # ---- agents in rooms (plan 2026-10-12-agents-rooms) ----

    async def set_agents(self, room_id: str, owner_id: int, persona_ids: list[str]) -> tuple[Room, bool]:
        """Owner picks (already validated) persona ids; `chosen_by` = this owner (R-RA3). [] clears. A running room
        tutor blocks changes (`tutor_active`, R-RA15 of the router)."""
        async with self._sm() as s:
            room = await self._owned_room(s, room_id, owner_id)
            current = list((room.agent_config or {}).get("persona_ids") or []) if isinstance(room.agent_config, dict) else []
            if current == list(persona_ids):
                return room, False
            if isinstance(room.agent_tutor, dict):
                raise RoomError("tutor_active")
            room.agent_config = {"persona_ids": list(persona_ids), "chosen_by": owner_id} if persona_ids else None
            await s.commit()
            return room, True

    async def set_tutor(self, room_id: str, snapshot: dict | None) -> None:
        """The room tutor snapshot (agent_tutor.py); None = no tutor (SQL NULL)."""
        async with self._sm() as s:
            room = await s.get(Room, room_id)
            if room is not None:
                room.agent_tutor = dict(snapshot) if snapshot is not None else None
                await s.commit()

    async def tutor_rooms(self) -> list[tuple[str, dict]]:
        """Open rooms that have a tutor snapshot (startup: pause them, R-RA8)."""
        async with self._sm() as s:
            rows = (await s.execute(select(Room.id, Room.agent_tutor).where(
                Room.status == "open", Room.agent_tutor.is_not(None)))).all()
        return [(room_id, snap) for room_id, snap in rows if isinstance(snap, dict)]

    async def agent_context(self, room_id: str, limit: int, *, before_seq: int) -> list[tuple[str, str, str | None]]:
        """Recent public text before `before_seq` for an agent turn: (speaker, text, persona id of an agent answer)."""
        rows = await self._named(self._select().where(RoomMessage.room_id == room_id, RoomMessage.lane == "public",
                                                      RoomMessage.kind.in_(QUOTABLE), RoomMessage.text != "",
                                                      RoomMessage.hidden_at.is_(None), RoomMessage.seq < before_seq)
                                 .order_by(RoomMessage.seq.desc()).limit(limit))
        out: list[tuple[str, str, str | None]] = []
        for m, n in reversed(rows):
            agent = _agent_meta(m)
            out.append((_ai_name(m, n), f"(voice) {m.text}" if m.kind == "voice" else m.text,
                        agent.get("persona_id") if agent else None))
        return out
```

`server/app/routers/rooms.py` — `rooms_config` 返回值末尾加三个键(`"reactions": list(REACTION_KEYS)` 之后),并在 import 行 `from app.rooms.protocol import REACTION_KEYS` 改为 `from app.rooms.protocol import MAX_AGENTS, REACTION_KEYS`:

```python
            "summary_available": settings.rooms_summary_available, "reactions": list(REACTION_KEYS),
            "agents_available": bool(settings.agents_enabled and settings.agents_rooms_enabled
                                     and settings.rooms_ai_available),
            "agent_tutor_available": bool(settings.agents_enabled and settings.agents_rooms_enabled
                                          and settings.agents_tutor_enabled and settings.rooms_ai_available),
            "max_agents": MAX_AGENTS}
```

`web/src/features/rooms/protocol.ts` — `RoomInfo` 的 v2 行末尾加:

```ts
  name: string; scenario: string; level: string; joinMode: "code" | "approval"; maxMembers: number; allowVoice: boolean;
  /** 房主选的智能体角色 id(最多 ROOM_AGENTS.max 个;名字等经 GET /api/rooms/{id}/agents 读取)。旧服务端没有时为 undefined */
  agentIds?: string[];
```

`web/src/features/rooms/rooms-api.ts` — `RoomsConfig` 末尾加:

```ts
  voiceAvailable: boolean; maxVoiceMs: number; summaryAvailable: boolean; reactions: ReactionKey[];
  /** 联机智能体(plan 2026-10-12-agents-rooms);旧服务端没有时为 undefined = 不可用 */
  agentsAvailable?: boolean; agentTutorAvailable?: boolean; maxAgents?: number;
```

- [ ] **Step 4: 重录契约** — Run: `cd server && grep -l "CONTRACT_UPDATE" tests/test_*.py`,对列出的每个文件执行 `CONTRACT_UPDATE=1 uv run pytest -q <file>`,再不带变量跑一遍确认绿;`git diff --stat server/tests/fixtures` 只应出现房间对象多 `agent_ids` 与 config 多 3 个键(`git diff server/tests/fixtures | grep "^[-+] " | grep -v "agent_ids\|agents_available\|agent_tutor_available\|max_agents"` 只剩时间戳/随机 id 的变化)。若某个夹具出现其他差异:停下排查,不要提交。
- [ ] **Step 5: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_rooms_agents_store.py tests/test_rooms_store.py tests/test_rooms_store_v2.py tests/test_rooms_prompts_ctx.py tests/test_rooms_prompts_v2.py tests/test_rooms_assistant.py tests/test_web_contract.py tests/test_rooms_v2_core_contract.py`;`yarn web:typecheck && cd web && yarn vitest run src/features/rooms` → PASS
- [ ] **Step 6: 提交**

```bash
git add server/app/rooms/store.py server/app/routers/rooms.py server/tests/test_rooms_agents_store.py server/tests/fixtures web/src/features/rooms/protocol.ts web/src/features/rooms/rooms-api.ts web/src/features/rooms/rooms-contract.test.ts
git commit -m "feat(rooms): agent_ids on rooms, agents config keys, agent context and named agent answers

Contract fixtures re-recorded: only the additive agent_ids / config keys changed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task S4: 纯模块 `agent_mentions.py`、`agent_config.py` 与共用样例

**Files:**
- Create: `server/app/rooms/agent_mentions.py`、`server/app/rooms/agent_config.py`、`server/tests/fixtures/room_agent_mentions.json`
- Test: `server/tests/test_rooms_agents_pure.py`

**Interfaces:**
- Produces:`agent_mention(text: str, names: list[str]) -> tuple[int | None, str]`;`find_handoff(text: str, names: list[str], current: int) -> int | None`
- Produces(`agent_config`):`RESERVED_NAMES`、`PersonaLookup`(Protocol:`get(user_id, persona_id)`、`report(reporter_id, persona_id, reason)`)、`AgentConfig(persona_ids, chosen_by)`、`config_of(room)`、`is_builtin(id)`、`async resolve(lookup, cfg) -> list`、`async validate(lookup, owner_id, ids) -> tuple[list, str | None]`(错误码 `unknown|disabled|reserved_name|duplicate_name`)、`persona_out(p) -> dict`、`agent_meta(p) -> dict`

- [ ] **Step 1: 写样例与失败测试**

`server/tests/fixtures/room_agent_mentions.json`(网页 `agents/mentions.test.ts` 读同一文件):

```json
{
  "names": ["Emma", "Emma Lee", "点评官 Leo"],
  "cases": [
    {"text": "@Emma what does abandon mean?", "index": 0, "question": "what does abandon mean?"},
    {"text": "@emma: hi", "index": 0, "question": "hi"},
    {"text": "@Emma Lee can you help", "index": 1, "question": "can you help"},
    {"text": "@Emma Leeds is a city", "index": 0, "question": "Leeds is a city"},
    {"text": "@点评官 Leo 帮我看看这句", "index": 2, "question": "帮我看看这句"},
    {"text": "@Emma,你好", "index": 0, "question": "你好"},
    {"text": "  @Emma   spaced  ", "index": 0, "question": "spaced"},
    {"text": "@Emma", "index": null, "question": ""},
    {"text": "@Emma   ", "index": null, "question": ""},
    {"text": "@Emmanuel hi", "index": null, "question": ""},
    {"text": "hey @Emma hi", "index": null, "question": ""},
    {"text": "@ai what is this", "index": null, "question": ""},
    {"text": "Emma hi", "index": null, "question": ""}
  ]
}
```

`server/tests/test_rooms_agents_pure.py`:

```python
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.rooms import agent_config
from app.rooms.agent_mentions import agent_mention, find_handoff

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "room_agent_mentions.json").read_text(encoding="utf-8"))
U1 = "0b6c1f3e-2a4d-4c5e-9f00-1234567890ab"
U2 = "1c7d2f4e-3b5e-4d6f-8a11-234567890abc"


@dataclass
class FakePersona:
    id: str
    name: str
    owner_id: int | None = None
    intro: str = "英语教练"
    prompt: str = "You are a patient coach."
    level: str = "B1"
    style: str = "friendly"
    prompt_public: bool = True
    disabled_at: datetime | None = None


class FakeLookup:
    def __init__(self, *personas):
        self.by_id = {p.id: p for p in personas}
        self.reports = []

    async def get(self, user_id, persona_id):
        p = self.by_id.get(persona_id)
        return p if p is not None and p.owner_id in (None, user_id) else None

    async def report(self, reporter_id, persona_id, reason):
        self.reports.append((reporter_id, persona_id, reason))


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["text"])
def test_agent_mention_matches_the_shared_cases(case):
    assert agent_mention(case["text"], FIXTURE["names"]) == (case["index"], case["question"])


def test_handoff_finds_the_first_other_agent_anywhere():
    names = ["Emma", "Leo"]
    assert find_handoff("Good try. @Leo can check the grammar.", names, 0) == 1
    assert find_handoff("Ask @leo, or me.", names, 0) == 1
    assert find_handoff("I am @Emma and that is fine.", names, 0) is None  # never itself
    assert find_handoff("mail me at a@Leo.com", names, 0) is None  # not after a word character
    assert find_handoff("No hand-off here.", names, 0) is None


async def test_validate_owner_rule():
    owner, other = 7, 8
    lookup = FakeLookup(FakePersona("builtin:coach", "Emma"), FakePersona(U1, "Leo", owner_id=owner),
                        FakePersona(U2, "Max", owner_id=other), FakePersona("builtin:ai", "AI"),
                        FakePersona("builtin:twin", "emma"),
                        FakePersona("builtin:off", "Off", disabled_at=datetime(2026, 10, 12, tzinfo=timezone.utc)))
    found, problem = await agent_config.validate(lookup, owner, ["builtin:coach", U1])
    assert problem is None and [p.name for p in found] == ["Emma", "Leo"]
    for ids, code in (([U2], "unknown"), (["builtin:missing"], "unknown"), (["builtin:off"], "disabled"),
                      (["builtin:ai"], "reserved_name"), (["builtin:coach", "builtin:twin"], "duplicate_name")):
        assert await agent_config.validate(lookup, owner, ids) == ([], code), ids


async def test_config_resolve_and_views():
    class Room:
        agent_config = {"persona_ids": ["builtin:coach", U1, "builtin:gone"], "chosen_by": 7}

    cfg = agent_config.config_of(Room())
    assert cfg == agent_config.AgentConfig(("builtin:coach", U1, "builtin:gone"), 7)
    lookup = FakeLookup(FakePersona("builtin:coach", "Emma"), FakePersona(U1, "Leo", owner_id=7, prompt_public=False))
    personas = await agent_config.resolve(lookup, cfg)  # a deleted persona drops out (R-RA3)
    assert [p.name for p in personas] == ["Emma", "Leo"]
    assert agent_config.persona_out(personas[1]) == {
        "id": U1, "name": "Leo", "intro": "英语教练", "level": "B1", "style": "friendly", "builtin": False,
        "prompt_public": False, "prompt": None, "disabled": False}
    assert agent_config.persona_out(personas[0])["prompt"] == "You are a patient coach."
    assert agent_config.agent_meta(personas[0]) == {"persona_id": "builtin:coach", "name": "Emma"}

    class Empty:
        agent_config = None

    assert agent_config.config_of(Empty()) == agent_config.AgentConfig((), None)
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rooms_agents_pure.py` → FAIL(模块不存在)

- [ ] **Step 3: 实现**

`server/app/rooms/agent_mentions.py`:

```python
"""Pure `@name` routing for room agents (spec 2026-10-12-agents §9.2, plan A5 R-RA4/R-RA7). `@ai` / `@助手` keep
their own parser (`rules.mention`) and are matched first by the caller; a persona can never be named like them
(`agent_config.RESERVED_NAMES`). Shared cases: tests/fixtures/room_agent_mentions.json (the web mirrors this)."""
import re

_SEP = r"(?=$|[\s:：,，.!?！？])"
_LEAD = re.compile(r"^[\s:：,，]*")


def _order(names: list[str]) -> list[int]:
    """Indexes of non-empty names, longest first ("Emma Lee" before "Emma"); stable for equal lengths."""
    return sorted((i for i, n in enumerate(names) if n.strip()), key=lambda i: -len(names[i].strip()))


def agent_mention(text: str, names: list[str]) -> tuple[int | None, str]:
    """(index into `names`, question) when the message starts with @<name>, a separator and a question;
    (None, "") otherwise. Case-insensitive."""
    stripped = (text or "").strip()
    if not stripped.startswith("@"):
        return None, ""
    body = stripped[1:]
    for i in _order(names):
        match = re.match(re.escape(names[i].strip()) + _SEP, body, re.IGNORECASE)
        if match:
            question = _LEAD.sub("", body[match.end():], count=1).strip()
            return (i, question) if question else (None, "")
    return None, ""


def find_handoff(text: str, names: list[str], current: int) -> int | None:
    """Index of the first *other* agent written as `@<name>` anywhere in an agent's reply (hand-off, depth 1)."""
    best: tuple[int, int] | None = None
    for i in _order(names):
        if i == current:
            continue
        match = re.search(r"(?<![\w@])@" + re.escape(names[i].strip()) + _SEP, text or "", re.IGNORECASE)
        if match and (best is None or match.start() < best[0]):
            best = (match.start(), i)
    return None if best is None else best[1]
```

`server/app/rooms/agent_config.py`:

```python
"""Room agent selection (spec 2026-10-12-agents §9.1–9.2, plan A5 R-RA3/R-RA10). The owner picks up to MAX_AGENTS
personas: builtin ones or their own, not disabled, not named like @ai, no two with the same name. Stored on
`rooms.agent_config` with the chooser's id (`chosen_by`): personas resolve against the chooser even after ownership
passes to an heir. Persona objects come from app.agents (PersonaStore); here they are duck-typed (id, name, intro,
prompt, level, style, prompt_public, owner_id, disabled_at). Never logs names or prompts."""
from dataclasses import dataclass
from typing import Any, Protocol

RESERVED_NAMES = frozenset({"ai", "助手"})


class PersonaLookup(Protocol):
    async def get(self, user_id: int, persona_id: str) -> Any: ...

    async def report(self, reporter_id: int, persona_id: str, reason: str) -> None: ...


@dataclass(frozen=True)
class AgentConfig:
    persona_ids: tuple[str, ...]
    chosen_by: int | None


def config_of(room) -> AgentConfig:
    raw = room.agent_config if isinstance(getattr(room, "agent_config", None), dict) else {}
    ids = raw.get("persona_ids") or []
    chosen = raw.get("chosen_by")
    return AgentConfig(tuple(i for i in ids if isinstance(i, str)),
                       chosen if isinstance(chosen, int) and not isinstance(chosen, bool) else None)


def is_builtin(persona_id: str) -> bool:
    return persona_id.startswith("builtin:")


def _name_key(name: str) -> str:
    return " ".join((name or "").split()).casefold()


async def resolve(lookup: PersonaLookup, cfg: AgentConfig) -> list:
    """The configured personas that still exist, in the owner's order (a deleted one drops out)."""
    out = []
    for persona_id in cfg.persona_ids:
        persona = await lookup.get(cfg.chosen_by or 0, persona_id)
        if persona is not None:
            out.append(persona)
    return out


async def validate(lookup: PersonaLookup, owner_id: int, ids: list[str]) -> tuple[list, str | None]:
    """DB half of the owner's rule (the shape is checked by rules.clean_settings)."""
    personas = []
    for persona_id in ids:
        persona = await lookup.get(owner_id, persona_id)
        if persona is None or (not is_builtin(persona_id) and getattr(persona, "owner_id", None) != owner_id):
            return [], "unknown"
        if getattr(persona, "disabled_at", None) is not None:
            return [], "disabled"
        if _name_key(persona.name) in RESERVED_NAMES:
            return [], "reserved_name"
        personas.append(persona)
    keys = [_name_key(p.name) for p in personas]
    if len(set(keys)) != len(keys):
        return [], "duplicate_name"
    return personas, None


def persona_out(p) -> dict:
    """Member view (spec D3): name, intro, level, style; the prompt only when the creator left it public."""
    public = bool(getattr(p, "prompt_public", True))
    return {"id": p.id, "name": p.name, "intro": p.intro, "level": p.level, "style": p.style,
            "builtin": is_builtin(p.id), "prompt_public": public, "prompt": p.prompt if public else None,
            "disabled": getattr(p, "disabled_at", None) is not None}


def agent_meta(p) -> dict:
    """`meta.agent` of a public agent answer: id and name only."""
    return {"persona_id": p.id, "name": p.name}
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_rooms_agents_pure.py tests/test_architecture.py` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/app/rooms/agent_mentions.py server/app/rooms/agent_config.py server/tests/fixtures/room_agent_mentions.json server/tests/test_rooms_agents_pure.py
git commit -m "feat(rooms): @name routing, hand-off detection and the room agent selection rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task S5: `AgentLane` 与 `connection.py` 接线(风险最高,单独评审)

**Files:**
- Create: `server/app/rooms/agent_lane.py`
- Modify: `server/app/rooms/connection.py`
- Test: `server/tests/test_rooms_agents_lane.py`

**Interfaces:**
- Consumes:A1 `TurnRequest`、`ModeBlock`、`Step/Thought/Delta/Done/Error`;S3 `RoomStore.agent_context/set_agents`;S4 `agent_mention/find_handoff/agent_config.*`
- Produces(`agent_lane`):`AgentPrefs(share_in_rooms, memory_enabled, show_process)`、`AgentRoute`、`AgentLaneDeps(personas, run_turn, turn_deps, prefs, feature_on, tutor_on, tutor_daily, turn_timeout, new_id)`、`AgentLane(deps, rooms)`(`admit/release/answer/on_member_message/on_welcome`,属性 `tutor`,T2 设置)、`RoomChatMode`、常量 `GLOBAL`、`AGENT_CONTEXT`、`AGENT_TURN_TIMEOUT`;辅助 `_clean(parts)`、`_history(rows, persona_id)`(T2 复用)
- Produces(`connection`):`AgentsHandler`(Protocol)、`ConnDeps.agents: AgentsHandler | None = None`
- `turn_deps` 约定:关键字参数 `allow_private: bool`、`memory: bool`、`modes: dict[str, ModeHandler]`,返回传给 `run_turn` 的 `TurnDeps`

- [ ] **Step 1: 写失败测试**

`server/tests/test_rooms_agents_lane.py`:

```python
import asyncio
import json
import logging
from datetime import datetime, timezone

import pytest

from app.agents.trace import Delta, Done, Error, Step, Thought
from app.core.ratelimit import RateLimiter
from app.models import User
from app.rooms.agent_lane import AgentLane, AgentLaneDeps, AgentPrefs
from app.rooms.connection import ConnDeps, RoomConnection
from app.rooms.hub import Conn, RoomHub
from app.rooms.rules import RoomLimits
from app.rooms.store import RoomStore
from tests.test_rooms_agents_pure import FakeLookup, FakePersona
from tests.test_rooms_hub import FakeSender

NOW = datetime(2026, 10, 12, 9, 0, tzinfo=timezone.utc)
A, B = 11111111, 22222222
EMMA = FakePersona("builtin:coach", "Emma")
LEO = FakePersona("0b6c1f3e-2a4d-4c5e-9f00-1234567890ab", "Leo", owner_id=A)
STEP = dict(id="s1", group="context", key="learned_words", status="done", label_key="agents.step.learned_words",
            params={"count": 6}, ms=12, private=True)


class Script:
    """A fake orchestrator: records (deps, req) and yields A1's event dataclasses."""

    def __init__(self):
        self.replies = {EMMA.id: "Sure, try: I never abandon a project halfway.", LEO.id: "The grammar is right."}
        self.calls = []
        self.error = None
        self.block: asyncio.Event | None = None

    async def run_turn(self, deps, req):
        self.calls.append((deps, req))
        yield Step(**STEP)
        yield Thought(source="summary", text="look up abandon")
        if self.block is not None:
            await self.block.wait()
        if self.error is not None:
            yield Error(code=self.error)
            return
        text = self.replies[req.persona.id]
        yield Delta(text=text)
        yield Done(usage=None, trace={"steps": [{"key": "learned_words", "status": "done"}]}, text_len=len(text))


class Env:
    def __init__(self, app):
        self.hub = RoomHub()
        self.store = RoomStore(app.state.sessionmaker, RoomLimits())
        self.quota = {"room_assist": 99, "room_ai_global": 99}
        self.refunds: list[str] = []
        self.script = Script()
        self.prefs = {A: AgentPrefs(), B: AgentPrefs()}
        self.feature = True
        self.ai_on = True
        self.lookup = FakeLookup(EMMA, LEO)

        async def consume(scope, subject, limit):
            self.quota[scope] = self.quota.get(scope, 99) - 1
            return self.quota[scope] >= 0

        async def refund(scope, subject):
            self.refunds.append(scope)

        async def complete(messages, max_tokens, temperature):
            return "It means starting a conversation."

        async def prefs(user_id):
            return self.prefs[user_id]

        self.lane = AgentLane(AgentLaneDeps(personas=self.lookup, run_turn=self.script.run_turn,
                                            turn_deps=lambda **kw: kw, prefs=prefs, feature_on=lambda: self.feature,
                                            turn_timeout=5.0), rooms=lambda: self.deps)
        self.deps = ConnDeps(self.store, self.hub, lambda: self.store.limits, complete, consume, refund, lambda: NOW,
                             asyncio.Semaphore(2), RateLimiter(20), RateLimiter(30, 3600), RateLimiter(5, 600),
                             lambda: self.ai_on, agents=self.lane)


@pytest.fixture
async def env(app):
    async with app.state.sessionmaker() as s:
        s.add_all([User(id=A, username="alice", password_hash="x"), User(id=B, username="bob", password_hash="x")])
        await s.commit()
    e = Env(app)
    e.room = await e.store.create(A, "面试", NOW)
    await e.store.join(e.room.code, B, NOW)
    await e.store.set_agents(e.room.id, A, [EMMA.id, LEO.id])
    e.alice, e.bob = Conn(A, FakeSender()), Conn(B, FakeSender())
    e.hub.attach(e.room.id, e.alice)
    e.hub.attach(e.room.id, e.bob)
    e.ca = RoomConnection(e.deps, e.room.id, A, "alice", e.alice)
    e.cb = RoomConnection(e.deps, e.room.id, B, "bob", e.bob)
    return e


def types(conn):
    return [ev["type"] for ev in conn.sender.sent]


def say(text, client_id="q"):
    return json.dumps({"type": "say", "client_id": client_id, "text": text})


async def test_mention_runs_one_turn_and_keeps_the_process_private(env):
    await env.cb.handle(say("@Emma can I use abandon here?"))
    await env.hub.drain()
    assert types(env.bob) == ["ack", "message", "ai_typing", "agent_step", "agent_thought", "message", "message"]
    assert types(env.alice) == ["message", "ai_typing", "message"]
    question, answer = env.alice.sender.sent[0]["message"], env.alice.sender.sent[2]["message"]
    assert question["ai_status"] == "pending"
    assert (answer["kind"], answer["sender"]["kind"], answer["reply_to"]) == ("ai_answer", "ai", question["seq"])
    assert answer["meta"] == {"agent": {"persona_id": EMMA.id, "name": "Emma"}, "asker": {"id": B, "name": "bob"}}
    step = env.bob.sender.sent[3]
    assert step["reply_to"] == question["seq"] and step["step"]["key"] == "learned_words" and step["step"]["private"]
    trace = env.bob.sender.sent[-1]["message"]
    assert (trace["lane"], trace["kind"], trace["reply_to"]) == ("private", "agent_trace", answer["seq"])
    assert trace["meta"]["trace"] == {"steps": [{"key": "learned_words", "status": "done"}]}
    deps, req = env.script.calls[0]
    assert (req.user_id, req.in_room, req.mode, req.room_id, req.conversation_id) == (B, True, "chat", env.room.id, None)
    assert req.text == "bob: can I use abandon here?" and req.persona is EMMA
    assert deps["allow_private"] is True and deps["memory"] is True and deps["modes"]["chat"].name == "chat"
    rows, _ = await env.store.replay(env.room.id, A, 0, 10)
    assert rows[0][0].ai_status == "done" and all(m.kind != "agent_trace" for m, _ in rows)
    assert env.hub.ai_pending(env.room.id) == 0


async def test_rooms_without_agents_and_at_ai_keep_the_old_frames(env):
    await env.cb.handle(say("@ai what does break the ice mean?"))
    await env.hub.drain()
    assert types(env.alice) == ["message", "ai_typing", "message"]
    assert env.alice.sender.sent[2]["message"]["meta"] is None and env.script.calls == []
    await env.store.set_agents(env.room.id, A, [])
    await env.cb.handle(say("@Emma hi there", "q2"))
    await env.hub.drain()
    assert types(env.bob)[-2:] == ["ack", "message"] and env.bob.sender.sent[-1]["message"]["ai_status"] is None
    assert env.script.calls == []


async def test_unknown_names_are_plain_messages(env):
    await env.cb.handle(say("@Emmanuel hi"))
    await env.hub.drain()
    assert types(env.bob) == ["ack", "message"] and env.script.calls == []


async def test_gates_ai_muted_ai_public_switch_and_disabled_persona(env):
    # a refused route: notice (this connection only), then the message is stored as a plain one (ack + broadcast)
    await env.store.set_ai_muted(env.room.id, True)
    await env.cb.handle(say("@Emma hi"))
    assert types(env.bob)[-3:] == ["notice", "ack", "message"]
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "ai_off"}
    assert env.bob.sender.sent[-1]["message"]["ai_status"] is None
    assert {"type": "notice", "code": "ai_off"} not in env.alice.sender.sent
    await env.store.set_ai_muted(env.room.id, False)
    await env.store.update(env.room.id, A, ai_public=False)
    await env.cb.handle(say("@Emma hi", "q2"))
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "ai_off"}
    await env.store.update(env.room.id, A, ai_public=True)
    env.feature = False
    await env.cb.handle(say("@Emma hi", "q3"))
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "agent_off"}
    env.feature = True
    LEO.disabled_at = NOW
    try:
        await env.cb.handle(say("@Leo hi", "q4"))
        assert env.bob.sender.sent[-3] == {"type": "notice", "code": "agent_off"}
    finally:
        LEO.disabled_at = None
    await env.hub.drain()
    assert env.script.calls == [] and env.hub.ai_pending(env.room.id) == 0


async def test_queue_cap_and_daily_quota_are_shared_with_at_ai(env):
    for _ in range(env.store.limits.ai_queue):
        env.hub.ai_enter(env.room.id)
    await env.cb.handle(say("@Emma one more"))
    assert {"type": "notice", "code": "ai_busy"} in env.bob.sender.sent
    for _ in range(env.store.limits.ai_queue):
        env.hub.ai_leave(env.room.id)
    env.quota["room_ai_global"] = 0
    await env.cb.handle(say("@Emma and another", "q2"))
    assert {"type": "notice", "code": "ai_quota"} in env.bob.sender.sent
    assert env.hub.ai_pending(env.room.id) == 0


async def test_agents_turn_limit_and_upstream_failures_refund_and_fail_the_question(env):
    env.script.error = "limit"
    await env.cb.handle(say("@Emma hi"))
    await env.hub.drain()
    assert env.alice.sender.sent[-1] == {"type": "ai_failed", "reply_to": 1, "code": "quota"}
    assert env.refunds == ["room_ai_global"]
    env.script.error = "llm_unavailable"
    await env.cb.handle(say("@Emma hi again", "q2"))
    await env.hub.drain()
    assert env.alice.sender.sent[-1]["code"] == "upstream"
    rows, _ = await env.store.replay(env.room.id, A, 0, 10)
    assert [m.ai_status for m, _ in rows] == ["failed", "failed"]


async def test_a_hanging_turn_times_out(env):
    env.script.block = asyncio.Event()
    env.lane.deps.turn_timeout = 0.05
    await env.cb.handle(say("@Emma hi"))
    await env.hub.drain()
    assert env.alice.sender.sent[-1] == {"type": "ai_failed", "reply_to": 1, "code": "upstream"}
    assert env.hub.ai_pending(env.room.id) == 0


async def test_one_agent_turn_per_room_at_a_time(env):
    env.script.block = asyncio.Event()
    await env.cb.handle(say("@Emma first"))
    await env.ca.handle(say("@Leo second", "a1"))
    for _ in range(20):
        await asyncio.sleep(0.01)
    assert len(env.script.calls) == 1  # the second waits for the room's AI lock
    env.script.block.set()
    await env.hub.drain()
    assert [req.persona.id for _, req in env.script.calls] == [EMMA.id, LEO.id]


async def test_hand_off_runs_once_with_depth_one(env):
    env.script.replies[EMMA.id] = "Good question. @Leo can check the grammar."
    env.script.replies[LEO.id] = "Looks right to me. @Emma agrees."
    await env.cb.handle(say("@Emma is this sentence right?"))
    await env.hub.drain()
    assert [req.persona.id for _, req in env.script.calls] == [EMMA.id, LEO.id]  # never a third turn
    answers = [e["message"] for e in env.alice.sender.sent if e["type"] == "message" and e["message"]["kind"] == "ai_answer"]
    assert answers[1]["meta"]["handoff_from"] == {"persona_id": EMMA.id, "name": "Emma"}
    assert answers[1]["reply_to"] == answers[0]["seq"] and answers[1]["meta"]["asker"]["id"] == B
    deps, req = env.script.calls[1]
    assert deps["memory"] is False and req.user_id == B
    assert req.history[-1] == {"role": "user", "content": "Emma: Good question. @Leo can check the grammar."}


async def test_share_in_rooms_memory_and_show_process_preferences(env):
    env.prefs[B] = AgentPrefs(share_in_rooms=False, memory_enabled=False, show_process=False)
    await env.cb.handle(say("@Emma hi"))
    await env.hub.drain()
    deps, _ = env.script.calls[0]
    assert deps["allow_private"] is False and deps["memory"] is False
    assert "agent_step" not in types(env.bob) and "agent_thought" not in types(env.bob)
    assert env.bob.sender.sent[-1]["message"]["kind"] == "agent_trace"  # the trace is still kept


async def test_logs_never_carry_text_names_or_words(env, caplog):
    caplog.set_level(logging.DEBUG)
    env.script.replies[EMMA.id] = "SECRET-REPLY-5521"
    await env.cb.handle(say("@Emma SECRET-QUESTION-8810"))
    await env.hub.drain()
    env.script.error = "llm_unavailable"
    await env.cb.handle(say("@Emma SECRET-QUESTION-8811", "q2"))
    await env.hub.drain()
    for secret in ("SECRET-REPLY-5521", "SECRET-QUESTION-88", "Emma", "abandon", "bob"):
        assert secret not in caplog.text
    assert "room agent turn failed code=upstream" in caplog.text
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rooms_agents_lane.py` → FAIL(`ModuleNotFoundError: app.rooms.agent_lane`)

- [ ] **Step 3: 实现 `server/app/rooms/agent_lane.py`**

```python
"""Agent turns in a room (spec 2026-10-12-agents §4.4, §5, §9.2; plan A5 R-RA2/R-RA5/R-RA6/R-RA7).

A member's `@<persona> question` becomes one orchestrator turn (`run_turn`, `in_room=True`); the reply is a normal
public `ai_answer` message with `meta.agent`. The process (`agent_step` / `agent_thought`) and the compact trace (a
private `agent_trace` row) go only to the asker. Shares the `@ai` gates: the per-room AI lock (one AI speaker at a
time), the AI queue cap, the per-room / per-user windows, `room_ai_global`, `ai_public` and `ai_muted`.
Never logs text, names, prompts or words: only codes, kinds and depths."""
import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import aclosing
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from app.agents.orchestrator import ModeBlock, TurnRequest
from app.agents.trace import Delta, Done, Error, Step, Thought
from app.core import metering
from app.rooms import agent_config
from app.rooms.agent_mentions import agent_mention, find_handoff
from app.rooms.protocol import event
from app.rooms.store import message_out

if TYPE_CHECKING:
    from app.rooms.connection import ConnDeps, RoomConnection

logger = logging.getLogger(__name__)
GLOBAL = "*"
AGENT_CONTEXT = 20  # recent public messages given to a room agent turn (R-RA15)
AGENT_TURN_TIMEOUT = 45.0  # seconds for one whole turn, prefetch to the last delta (R-RA5)
MAX_AGENT_TEXT = 1200  # code points kept from an agent reply
HANDOFF_DEPTH = 1  # A may hand over to B once; B never hands over again (R-RA7)
FAIL_CODES = {"limit": "quota", "busy": "quota"}  # run_turn error code -> ai_failed code; anything else "upstream"
ROOM_RULES = (
    "You are answering in a public multiplayer practice room; every member reads your reply.\n"
    "- Answer {asker}'s question directly in at most 80 words. English first; add one short line starting with "
    "\"中文:\" only when a Chinese explanation helps.\n"
    "- Never read out, list or quote {asker}'s personal learning data (learned, weak or due words, memories, "
    "profile) in the reply; use it only to choose what to say.\n"
    "- Other agents in this room: {others}. Only if one of them clearly fits better, end with one line "
    "\"@<their name>\" to hand over. Never hand over to yourself.\n"
)


def _plain(value: str) -> str:
    """User-chosen names go into the mode block as one short line (no newlines, no prompt structure)."""
    return " ".join(str(value or "").split())[:40]


def _clean(parts: list[str]) -> str:
    return "".join(parts).strip()[:MAX_AGENT_TEXT].strip()


def _history(rows: list[tuple[str, str, str | None]], persona_id: str) -> list[dict]:
    """Room messages as chat history: this persona's own answers are `assistant`, everything else `user` with the
    speaker's name (the orchestrator clamps and escapes, spec §4.4)."""
    return [{"role": "assistant", "content": text} if pid == persona_id else {"role": "user", "content": f"{name}: {text}"}
            for name, text, pid in rows]


@dataclass(frozen=True)
class AgentPrefs:
    """The asker's agent settings that matter in a room (spec §4.3)."""
    share_in_rooms: bool = True
    memory_enabled: bool = True
    show_process: bool = True


@dataclass(frozen=True)
class AgentRoute:
    room_id: str
    asker_id: int
    asker_name: str
    persona: Any
    personas: tuple
    question: str
    depth: int = 0
    handoff_from: Any = None


@dataclass
class AgentLaneDeps:
    personas: agent_config.PersonaLookup
    run_turn: Callable[[Any, TurnRequest], AsyncIterator[Any]]
    turn_deps: Callable[..., Any]  # (*, allow_private: bool, memory: bool, modes: dict) -> app.agents TurnDeps
    prefs: Callable[[int], Awaitable[AgentPrefs]]
    feature_on: Callable[[], bool]
    tutor_on: Callable[[], bool] = lambda: False
    tutor_daily: Callable[[], int] = lambda: 20
    turn_timeout: float = AGENT_TURN_TIMEOUT
    new_id: Callable[[], str] = lambda: uuid.uuid4().hex


class RoomChatMode:
    """ModeHandler for `@<persona>` in a room (A1 protocol): the room rules ride in the mode block, after the safety
    preamble and the persona (A1's fixed prompt order); no stream filter, no meta."""
    name = "chat"

    def __init__(self, asker_name: str, others: list[str]):
        self.asker_name = _plain(asker_name)
        self.others = [_plain(n) for n in others]

    async def prepare(self, req) -> ModeBlock:
        others = ", ".join(f"@{n}" for n in self.others) or "none"
        return ModeBlock(text=ROOM_RULES.replace("{asker}", self.asker_name).replace("{others}", others),
                         max_tokens=300)

    def stream_filter(self):
        return None

    async def finish(self, req, full_text: str) -> dict | None:
        return None


class AgentLane:
    """`ConnDeps.agents` (connection.AgentsHandler). `rooms()` returns the live ConnDeps (hot-reloaded limits,
    the current AI gate); `tutor` is the RoomTutor installed by lane T (agent_tutor.py), None until then."""

    def __init__(self, deps: AgentLaneDeps, rooms: Callable[[], "ConnDeps"]):
        self.deps = deps
        self.rooms = rooms
        self.tutor = None

    async def admit(self, conn: "RoomConnection", text: str) -> AgentRoute | None:
        """Route a say that starts with "@": None = a plain message (no agents, no match, or refused with a notice
        to this connection). On success the AI queue slot and `room_ai_global` are reserved (release() undoes)."""
        if not text.startswith("@"):
            return None
        r = self.rooms()
        room = await r.store.room(conn.room_id)
        cfg = agent_config.config_of(room) if room is not None else None
        if cfg is None or not cfg.persona_ids:
            return None
        personas = await agent_config.resolve(self.deps.personas, cfg)
        index, question = agent_mention(text, [p.name for p in personas])
        if index is None:
            return None
        persona = personas[index]
        if not self.deps.feature_on() or getattr(persona, "disabled_at", None) is not None:
            await conn.send_self(event("notice", code="agent_off"))
            return None
        route = AgentRoute(conn.room_id, conn.user_id, conn.name, persona, tuple(personas), question)
        return route if await self._reserve(route, conn.send_self) else None

    async def _reserve(self, route: AgentRoute, tell: Callable[[dict], Awaitable[None]]) -> bool:
        r = self.rooms()
        room = await r.store.room(route.room_id)
        if not r.ai_available or room is None or room.status != "open" or not room.ai_public or room.ai_muted:
            await tell(event("notice", code="ai_off"))
            return False
        if r.hub.ai_pending(route.room_id) >= r.limits.ai_queue:
            await tell(event("notice", code="ai_busy"))
            return False
        r.hub.ai_enter(route.room_id)  # reserve before any await, like _admit_ai (review #11)
        if (not r.ai_room_limiter.allow(route.room_id) or not r.ai_user_limiter.allow(str(route.asker_id))
                or not await r.consume("room_ai_global", GLOBAL, r.limits.ai_global_daily)):
            r.hub.ai_leave(route.room_id)
            await tell(event("notice", code="ai_quota"))
            return False
        return True

    async def release(self, route: AgentRoute) -> None:
        """The question was never stored: give back the queue slot and the quota."""
        r = self.rooms()
        r.hub.ai_leave(route.room_id)
        await r.refund("room_ai_global", GLOBAL)

    async def answer(self, route: AgentRoute, seq: int, message_id: str) -> None:
        """Hub task: one turn under the room's AI lock, then at most one hand-off."""
        r = self.rooms()
        done = None
        try:
            async with r.hub.ai_lock(route.room_id):
                done = await self._turn(r, route, seq, message_id)
        finally:
            r.hub.ai_leave(route.room_id)
        if done is not None and route.depth < HANDOFF_DEPTH:
            await self._handoff(route, *done)

    async def _turn(self, r: "ConnDeps", route: AgentRoute, seq: int, message_id: str) -> tuple[int, str, str] | None:
        await r.hub.broadcast(route.room_id, event("ai_typing", reply_to=seq))
        turn_id = self.deps.new_id()
        parts: list[str] = []
        trace = None
        failure: str | None = None
        try:
            prefs = await self.deps.prefs(route.asker_id)
            # A hand-off sees the answer it continues (seq = that answer); a direct ask excludes its own question.
            rows = await r.store.agent_context(route.room_id, AGENT_CONTEXT,
                                               before_seq=seq if route.depth == 0 else seq + 1)
            others = [p.name for p in route.personas if p.id != route.persona.id]
            req = TurnRequest(user_id=route.asker_id, persona=route.persona, conversation_id=None,
                              room_id=route.room_id, text=self._input(route), history=_history(rows, route.persona.id),
                              mode="chat", tutor_session_id=None, client_turn_id=turn_id, in_room=True)
            deps = self.deps.turn_deps(allow_private=prefs.share_in_rooms,
                                       memory=prefs.memory_enabled and route.depth == 0,
                                       modes={"chat": RoomChatMode(route.asker_name, others)})
            metering.bind_user(route.asker_id)  # the asker pays (admin usage), like @ai
            with metering.feature_scope("rooms"):
                async with r.ai_gate:
                    async with asyncio.timeout(self.deps.turn_timeout):
                        async with aclosing(self.deps.run_turn(deps, req)) as events:
                            async for ev in events:
                                if isinstance(ev, Delta):
                                    parts.append(ev.text)
                                elif isinstance(ev, (Step, Thought)):
                                    if prefs.show_process:
                                        await self._private(route, turn_id, seq, ev)
                                elif isinstance(ev, Done):
                                    trace = ev.trace
                                elif isinstance(ev, Error):
                                    failure = ev.code
                                    break
        except asyncio.CancelledError:
            raise
        except Exception as e:  # LlmUnavailable, TimeoutError, anything unexpected: the question must not stay pending
            failure = "timeout" if isinstance(e, TimeoutError) else (getattr(e, "kind", None) or type(e).__name__)
        text = _clean(parts)
        if failure is not None or not text:
            code = FAIL_CODES.get(failure or "", "upstream")
            logger.info("room agent turn failed code=%s kind=%s depth=%d", code, failure or "empty", route.depth)
            await r.store.set_ai_status(message_id, "failed")
            await r.refund("room_ai_global", GLOBAL)
            await r.hub.broadcast(route.room_id, event("ai_failed", reply_to=seq, code=code))
            return None
        meta = {"agent": agent_config.agent_meta(route.persona), "asker": {"id": route.asker_id, "name": route.asker_name}}
        if route.handoff_from is not None:
            meta["handoff_from"] = agent_config.agent_meta(route.handoff_from)
        private = None
        async with r.hub.lock(route.room_id):
            answer = await r.store.append(route.room_id, lane="public", sender_kind="ai", sender_id=None,
                                          kind="ai_answer", text=text, now=r.clock(), reply_to=seq, meta=meta)
            if trace:
                private = await r.store.append(route.room_id, lane="private", audience_id=route.asker_id,
                                               sender_kind="ai", sender_id=None, kind="agent_trace", text="",
                                               now=r.clock(), reply_to=answer.seq,
                                               meta={"turn_id": turn_id, "trace": trace})
        await r.store.set_ai_status(message_id, "done")
        await r.hub.broadcast(route.room_id, event("message", message=message_out(answer, None)))
        if private is not None:
            await r.hub.broadcast(route.room_id, event("message", message=message_out(private, None)),
                                  only_user=route.asker_id)
        return answer.seq, answer.id, text

    @staticmethod
    def _input(route: AgentRoute) -> str:
        if route.handoff_from is None:
            return f"{route.asker_name}: {route.question}"
        return f"{route.asker_name}: {route.question}\n({_plain(route.handoff_from.name)} handed this question to you.)"

    async def _private(self, route: AgentRoute, turn_id: str, seq: int, ev) -> None:
        data = dict(ev.to_dict())
        data.pop("type", None)
        frame = (event("agent_step", turn_id=turn_id, reply_to=seq, step=data) if isinstance(ev, Step)
                 else event("agent_thought", turn_id=turn_id, reply_to=seq, thought=data))
        await self.rooms().hub.broadcast(route.room_id, frame, only_user=route.asker_id)

    async def _handoff(self, route: AgentRoute, answer_seq: int, answer_id: str, text: str) -> None:
        names = [p.name for p in route.personas]
        current = next(i for i, p in enumerate(route.personas) if p.id == route.persona.id)
        index = find_handoff(text, names, current)
        if index is None:
            return
        target = route.personas[index]
        if not self.deps.feature_on() or getattr(target, "disabled_at", None) is not None:
            return
        nxt = AgentRoute(route.room_id, route.asker_id, route.asker_name, target, route.personas, route.question,
                         depth=route.depth + 1, handoff_from=route.persona)
        r = self.rooms()

        async def tell(frame: dict) -> None:
            await r.hub.broadcast(route.room_id, frame, only_user=route.asker_id)

        if not await self._reserve(nxt, tell):
            return
        await r.store.set_ai_status(answer_id, "pending")
        r.hub.spawn(self.answer(nxt, answer_seq, answer_id))

    # ---- room tutor hooks (lane T installs `self.tutor`) ----

    async def on_member_message(self, conn: "RoomConnection", message) -> None:
        if self.tutor is not None:
            await self.tutor.on_message(conn.room_id, message)

    async def on_welcome(self, conn: "RoomConnection") -> None:
        if self.tutor is not None:
            await self.tutor.on_welcome(conn)
```

- [ ] **Step 4: 接线 `server/app/rooms/connection.py`**

`VoiceHandler` 类之后加:

```python
class AgentsHandler(Protocol):
    """Room agents (plan 2026-10-12-agents-rooms): `rooms.agent_lane.AgentLane`, installed on `RoomsRuntime.agents`
    by `routers/rooms_agents.install`. None = no agent code at all (rooms behave exactly as before)."""

    async def admit(self, conn: "RoomConnection", text: str) -> object | None: ...

    async def release(self, route: object) -> None: ...

    async def answer(self, route: object, seq: int, message_id: str) -> None: ...

    async def on_member_message(self, conn: "RoomConnection", message) -> None: ...

    async def on_welcome(self, conn: "RoomConnection") -> None: ...
```

`ConnDeps` 末尾(`clock_mono` 之后)加:

```python
    # ---- agents in rooms (plan 2026-10-12-agents-rooms) ----
    agents: AgentsHandler | None = None
```

`welcome` 末尾(`for message in rows:` 循环之后)加:

```python
        if d.agents is not None:  # a running room tutor re-sends its state after the replay (R-RA8)
            await d.agents.on_welcome(self)
```

`on_say` 从 `is_ai, question = mention(text)` 到方法结束替换为:

```python
        is_ai, question = mention(text)
        ask = await self._admit_ai() if is_ai else False
        route = None
        if not is_ai and d.agents is not None and text.startswith("@"):  # `@ai` always wins (R-RA4)
            route = await d.agents.admit(self, text)
        try:
            async with d.hub.lock(self.room_id):
                m = await d.store.append(self.room_id, lane="public", sender_kind="user", sender_id=self.user_id,
                                         kind="text", text=text, now=now, assisted=msg.assist_id is not None,
                                         ai_status="pending" if ask or route is not None else None,
                                         client_id=msg.client_id, reply_to=msg.reply_to,
                                         meta={"quote": quote} if quote else None)
        except BaseException:
            if ask:  # the question was never stored: release its queue slot and quota
                d.hub.ai_leave(self.room_id)
                await d.refund("room_ai_global", GLOBAL)
            if route is not None:
                await d.agents.release(route)
            raise
        await self._send(event("ack", client_id=msg.client_id, seq=m.seq))
        await d.hub.broadcast(self.room_id, event("message", message=await d.store.out_one(m.id)))
        if ask:
            d.hub.spawn(self._answer(m.seq, m.id, question))
        elif route is not None:
            d.hub.spawn(d.agents.answer(route, m.seq, m.id))
        elif d.agents is not None:  # a room tutor may be waiting for this member's answer (R-RA8)
            await d.agents.on_member_message(self, m)
```

- [ ] **Step 5: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_rooms_agents_lane.py tests/test_rooms_connection.py tests/test_rooms_social.py tests/test_rooms_prompts_live.py tests/test_architecture.py` → PASS(`test_rooms_connection.py` 不改一行仍绿 = 没有智能体的房间行为不变)
- [ ] **Step 6: 提交**

```bash
git add server/app/rooms/agent_lane.py server/app/rooms/connection.py server/tests/test_rooms_agents_lane.py
git commit -m "feat(rooms): @persona turns in rooms with private process, shared AI gates and one hand-off

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task S6: 路由与安装(`rooms_agents.py`、房主设置、成员读取、举报)

**Files:**
- Create: `server/app/routers/rooms_agents.py`
- Modify: `server/app/routers/rooms.py`、`server/app/main.py`、`web/src/features/rooms/create/rooms-v2-api.ts`(一行)、`web/src/features/rooms/agents/i18n/{zh-CN,en}.json`
- Test: `server/tests/test_rooms_agents_api.py`、`server/tests/test_rooms_agents_ws.py`

**Interfaces:**
- Produces(`RoomsRuntime`):`agents: object | None`、`agent_checker: Callable[[int, list[str]], Awaitable[tuple[str | None, list[str]]]] | None`、`shutdown_listeners: list[ShutdownListener]`
- Produces(HTTP):`PATCH /api/rooms/{id}` 的 `agents`;系统消息 `agents{names}` / `agents_off{}`;`GET /api/rooms/{id}/agents` → `{available, agents: [persona_out], tutor: tutor_view | null}`;`POST /api/rooms/{id}/agents/{persona_id}/report {reason}` → `{ok: true}`(404 `Agent not found`)
- Produces(`ROOM_ERRORS`):`"tutor_active": (409, "Room tutor is running")`
- Consumes:A1 `PersonaStore(sessionmaker)`、`agents.settings.load`、`app.state.agent_turn_deps`、`SourceRegistry.sources()/register()`、`TurnHooks(after_turn=[])`

- [ ] **Step 1: 写失败测试**

`server/tests/test_rooms_agents_api.py`:

```python
from datetime import datetime, timezone

import pytest

from app.agents.trace import Delta, Done, Meta, Step, Thought
from app.models import AgentPersona
from tests.test_rooms_ws import login, make_client

U1 = "0b6c1f3e-2a4d-4c5e-9f00-1234567890ab"
NOW = datetime(2026, 10, 12, 9, tzinfo=timezone.utc)
LATEST = 2_147_483_647
AGENTS_ON = {"agents_enabled": True, "agents_rooms_enabled": True, "agents_tutor_enabled": True}


async def fake_run_turn(deps, req):
    """Stands in for app.agents.orchestrator.run_turn (patched where rooms_agents looks it up)."""
    if req.mode == "tutor":
        yield Delta(text="Welcome! alice, tell me about your weekend.")
        yield Meta(step_index=1, steps_total=8, verdict="ok", kind="ask", done=False)
        return
    yield Step(id="s1", group="context", key="learned_words", status="done", label_key="agents.step.learned_words",
               params={"count": 6}, ms=12, private=True)
    yield Thought(source="summary", text="look up abandon")
    yield Delta(text="Sure, try: I never abandon a project halfway.")
    yield Done(usage=None, trace={"steps": [{"key": "learned_words", "status": "done"}]}, text_len=44)


@pytest.fixture
def agents_client(tmp_path, monkeypatch):
    monkeypatch.setattr("app.routers.rooms_agents.run_turn", fake_run_turn)
    app, client = make_client(tmp_path, monkeypatch, **AGENTS_ON)
    yield app, client
    client.__exit__(None, None, None)


def add_persona(app, client, owner_id, **over):
    fields = {"id": U1, "owner_id": owner_id, "name": "Leo", "intro": "点评官", "prompt": "You review grammar.",
              "level": "B1", "style": "strict", "voice": None, "tools": [], "prompt_public": False,
              "deep_think": False, "disabled_at": None, "created_at": NOW, "updated_at": NOW, **over}

    async def go():
        async with app.state.sessionmaker() as s:
            s.add(AgentPersona(**fields))
            await s.commit()

    client.portal.call(go)


def room_of(client):
    alice, alice_id = login(client, "alice")
    bob, bob_id = login(client, "bob")
    room = client.post("/api/rooms", json={"topic": "面试"}, headers=alice).json()["room"]
    client.post("/api/rooms/join", json={"code": room["code"]}, headers=bob)
    return room, alice, alice_id, bob, bob_id


def test_owner_sets_agents_and_members_read_them(agents_client):
    app, client = agents_client
    room, alice, alice_id, bob, _ = room_of(client)
    add_persona(app, client, alice_id)
    r = client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach", U1]}, headers=alice)
    assert r.status_code == 200 and r.json()["room"]["agent_ids"] == ["builtin:coach", U1]
    listed = client.get(f"/api/rooms/{room['id']}/agents", headers=bob).json()
    assert listed["available"] is True and listed["tutor"] is None
    assert next(a for a in listed["agents"] if a["id"] == U1) == {
        "id": U1, "name": "Leo", "intro": "点评官", "level": "B1", "style": "strict", "builtin": False,
        "prompt_public": False, "prompt": None, "disabled": False}
    coach = next(a for a in listed["agents"] if a["id"] == "builtin:coach")
    assert coach["builtin"] is True and coach["name"]
    history = client.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": LATEST}, headers=bob).json()["messages"]
    system = [m for m in history if m["kind"] == "system" and m["text"] == "agents"]
    assert system and "Leo" in system[-1]["meta"]["names"]
    assert client.patch(f"/api/rooms/{room['id']}", json={"agents": []}, headers=alice).json()["room"]["agent_ids"] == []
    history = client.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": LATEST}, headers=bob).json()["messages"]
    assert history[-1]["text"] == "agents_off"


def test_selection_errors(agents_client):
    app, client = agents_client
    room, alice, _, bob, bob_id = room_of(client)
    add_persona(app, client, bob_id)  # bob's persona is not alice's to pick

    def patch(body, headers=alice):
        return client.patch(f"/api/rooms/{room['id']}", json=body, headers=headers)

    assert patch({"agents": ["builtin:coach", "builtin:interviewer", U1]}).json() == {
        "error": "Invalid settings", "fields": {"agents": "too_many"}}
    assert patch({"agents": [U1]}).json()["fields"] == {"agents": "unknown"}
    assert patch({"agents": ["builtin:coach"], "name": "x" * 31}).json()["fields"] == {"name": "too_long"}
    assert patch({"agents": ["builtin:coach"]}, bob).status_code == 403
    carol, _ = login(client, "carol")
    assert client.get(f"/api/rooms/{room['id']}/agents", headers=carol).status_code == 404


def test_agents_switched_off(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)  # AGENTS_ENABLED stays false
    try:
        room, alice, *_ = room_of(client)
        r = client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach"]}, headers=alice)
        assert r.status_code == 400 and r.json()["fields"] == {"agents": "disabled"}
        cfg = client.get("/api/rooms/config", headers=alice).json()
        assert (cfg["agents_available"], cfg["agent_tutor_available"], cfg["max_agents"]) == (False, False, 2)
        assert client.get(f"/api/rooms/{room['id']}/agents", headers=alice).json() == {
            "available": False, "agents": [], "tutor": None}
    finally:
        client.__exit__(None, None, None)


def test_report_is_for_members_and_room_agents_only(agents_client, monkeypatch):
    app, client = agents_client
    room, alice, _, bob, bob_id = room_of(client)
    client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach"]}, headers=alice)
    calls = []

    async def report(reporter_id, persona_id, reason):
        calls.append((reporter_id, persona_id, reason))

    monkeypatch.setattr(app.state.rooms.agents.deps.personas, "report", report)
    base = f"/api/rooms/{room['id']}/agents"
    assert client.post(f"{base}/builtin:coach/report", json={"reason": "abuse"}, headers=bob).json() == {"ok": True}
    assert calls == [(bob_id, "builtin:coach", "abuse")]
    assert client.post(f"{base}/builtin:waiter/report", json={"reason": "abuse"}, headers=bob).status_code == 404
    assert client.post(f"{base}/builtin:coach/report", json={"reason": "nope"}, headers=bob).status_code == 400
    carol, _ = login(client, "carol")
    assert client.post(f"{base}/builtin:coach/report", json={"reason": "spam"}, headers=carol).status_code == 404
```

`server/tests/test_rooms_agents_ws.py`:

```python
import json

from tests.test_rooms_agents_api import agents_client, room_of  # noqa: F401 (fixture)
from tests.test_rooms_ws import until


def until_answer(ws):
    """Frames up to and including the next public ai_answer message (system/presence frames in between)."""
    events = []
    while True:
        events += until(ws, "message")
        if events[-1]["message"]["kind"] == "ai_answer":
            return events


def test_member_asks_an_agent_and_only_the_asker_sees_the_process(agents_client):
    app, client = agents_client
    room, alice, _, bob, _ = room_of(client)
    client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach"]}, headers=alice)
    name = client.get(f"/api/rooms/{room['id']}/agents", headers=alice).json()["agents"][0]["name"]

    def ticket(headers):
        return client.post(f"/api/rooms/{room['id']}/ticket", headers=headers).json()["ticket"]

    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(alice)}") as wa, \
            client.websocket_connect(f"/api/rooms/ws?ticket={ticket(bob)}") as wb:
        wa.send_text('{"type":"hello","last_seq":0}')
        until(wa, "welcome")
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        wb.send_text(json.dumps({"type": "say", "client_id": "q", "text": f"@{name} can I use abandon here?"}))
        bob_events = until_answer(wb)
        alice_events = until_answer(wa)
        assert [e["type"] for e in bob_events if e["type"].startswith("agent_")] == ["agent_step", "agent_thought"]
        assert not any(e["type"].startswith("agent_") for e in alice_events)
        answer = alice_events[-1]["message"]
        assert answer["meta"]["agent"]["persona_id"] == "builtin:coach"
        assert answer["meta"]["asker"]["name"] == "bob"
        trace = until(wb, "message")[-1]["message"]
        assert (trace["lane"], trace["kind"], trace["reply_to"]) == ("private", "agent_trace", answer["seq"])
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rooms_agents_api.py tests/test_rooms_agents_ws.py` → FAIL(无 `app.routers.rooms_agents`)

- [ ] **Step 3: 实现 `server/app/routers/rooms_agents.py`**

```python
"""Room agents endpoints and wiring (plan 2026-10-12-agents-rooms, lanes S and T). `install(app, rt)` is listed in
`app.state.rooms_extensions` (main.py): it puts the AgentLane on `rt.agents` and the persona check on
`rt.agent_checker` (routers/rooms.py never imports this module). Never logs persona text, names or user text."""
import dataclasses

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.agents import settings as agent_settings
from app.agents.context import SourceRegistry
from app.agents.orchestrator import TurnHooks, run_turn
from app.agents.personas import PersonaStore
from app.core.config import Settings
from app.core.deps import current_user
from app.models import User
from app.rooms import agent_config
from app.rooms.agent_lane import AgentLane, AgentLaneDeps, AgentPrefs
from app.rooms.protocol import MAX_ID
from app.rooms.store import REPORT_REASONS, RoomError
from app.routers.rooms import RoomsRuntime, _raise, deps_for, require_rooms, runtime

router = APIRouter(prefix="/api/rooms")


def feature_on(app) -> bool:
    s = app.state.settings
    return bool(s.agents_enabled and s.agents_rooms_enabled)


def tutor_on(app) -> bool:
    return feature_on(app) and bool(app.state.settings.agents_tutor_enabled)


def _public_only(registry) -> SourceRegistry:
    """The same context sources minus the private ones (share_in_rooms=false, room tutor; R-RA6/R-RA8)."""
    out = SourceRegistry()
    for source in registry.sources():
        if not source.private:
            out.register(source)
    return out


def install(app, rt: RoomsRuntime) -> None:
    """Called once by `routers.rooms.runtime(app)`; settings are read per call (hot reload)."""
    personas = PersonaStore(app.state.sessionmaker)

    async def prefs(user_id: int) -> AgentPrefs:
        async with app.state.sessionmaker() as s:
            st = await agent_settings.load(s, user_id)
        return AgentPrefs(share_in_rooms=bool(st.share_in_rooms), memory_enabled=bool(st.memory_enabled),
                          show_process=bool(st.show_process))

    def turn_deps(*, allow_private: bool, memory: bool, modes: dict):
        base = app.state.agent_turn_deps
        return dataclasses.replace(base, registry=base.registry if allow_private else _public_only(base.registry),
                                   hooks=base.hooks if memory else TurnHooks(after_turn=[]),
                                   modes={**base.modes, **modes})

    rt.agents = AgentLane(
        AgentLaneDeps(personas=personas, run_turn=run_turn, turn_deps=turn_deps, prefs=prefs,
                      feature_on=lambda: feature_on(app), tutor_on=lambda: tutor_on(app),
                      tutor_daily=lambda: int(app.state.settings.agents_tutor_daily_per_user)),
        rooms=lambda: deps_for(app, rt, app.state.settings))

    async def check(owner_id: int, ids: list[str]) -> tuple[str | None, list[str]]:
        if not feature_on(app):
            return "disabled", []
        found, problem = await agent_config.validate(personas, owner_id, ids)
        return problem, [p.name for p in found]

    rt.agent_checker = check


class AgentReportIn(BaseModel):
    reason: str = Field(max_length=32)


async def _member_room(request: Request, room_id: str, user: User):
    rt = runtime(request.app)
    try:
        room, member = await rt.store.membership(room_id[:MAX_ID], user.id)
    except RoomError as e:
        _raise(e)
    return rt, room, member


@router.get("/{room_id}/agents")
async def room_agents(room_id: str, request: Request, user: User = Depends(current_user),
                      _: Settings = Depends(require_rooms)):
    """Members see the room's agents: name, intro, level, style and, if public, the prompt (spec D3)."""
    rt, room, _member = await _member_room(request, room_id, user)
    lane: AgentLane = rt.agents
    if not feature_on(request.app):
        return {"available": False, "agents": [], "tutor": None}
    personas = await agent_config.resolve(lane.deps.personas, agent_config.config_of(room))
    tutor = await lane.tutor.public_view(room) if lane.tutor is not None else None
    return {"available": True, "agents": [agent_config.persona_out(p) for p in personas], "tutor": tutor}


@router.post("/{room_id}/agents/{persona_id}/report")
async def report_agent(room_id: str, persona_id: str, payload: AgentReportIn, request: Request,
                       user: User = Depends(current_user), _: Settings = Depends(require_rooms)):
    """A member reports one of this room's agents (spec §9.1); handled in the admin agents queue (A1)."""
    if payload.reason not in REPORT_REASONS:
        raise HTTPException(400, "Invalid reason")
    rt, room, _member = await _member_room(request, room_id, user)
    persona_id = persona_id[:MAX_ID]
    if persona_id not in agent_config.config_of(room).persona_ids:
        raise HTTPException(404, "Agent not found")
    await rt.agents.deps.personas.report(user.id, persona_id, payload.reason)
    return {"ok": True}
```

- [ ] **Step 4: 改 `server/app/routers/rooms.py`**

`RoomsRuntime` 中 `app: object | None = None` 之后加:

```python
    # ---- agents in rooms (plan 2026-10-12-agents-rooms); filled by routers/rooms_agents.install ----
    agents: object | None = None  # connection.AgentsHandler (rooms.agent_lane.AgentLane)
    agent_checker: "AgentChecker | None" = None
    shutdown_listeners: list["ShutdownListener"] = field(default_factory=list)
```

`StartupListener = ...` 一行之后加:

```python
ShutdownListener = Callable[[RoomsRuntime], Awaitable[None]]  # before sockets close at shutdown (room tutor timers)
AgentChecker = Callable[[int, list[str]], Awaitable[tuple[str | None, list[str]]]]  # (owner, ids) -> (error, names)
```

`ROOM_ERRORS` 字典末尾加 `"tutor_active": (409, "Room tutor is running"),`。

`deps_for` 的 `return ConnDeps(...)` 末尾改为:

```python
                    voice=rt.voice, react_limiter=rt.react_limiter, agents=rt.agents)
```

`PatchIn` 改为:

```python
class PatchIn(SettingsIn):
    topic: str | None = Field(None, max_length=200)  # v1 clients: written to `name`, cut to 30 (R2-1)
    locked: bool | None = None
    # Owner only, up to MAX_AGENTS persona ids (plan 2026-10-12-agents-rooms R-RA3); the list bound only caps the body
    agents: list[Annotated[str, Field(max_length=64)]] | None = Field(None, max_length=8)
```

(文件顶部 `from typing import Annotated`。)`update_room` 整体替换为:

```python
@router.patch("/{room_id}")
async def update_room(room_id: str, payload: PatchIn, request: Request, user: User = Depends(current_user),
                      settings: Settings = Depends(require_rooms)):
    """Owner edit of any subset of the seven settings plus `locked` and `agents` (spec 2026-10-10 §3.2; agents plan
    A5). One `settings` system message lists every setting that really changed; agents get their own message."""
    rt = runtime(request.app)
    raw = payload.model_dump(exclude_none=True, exclude={"topic", "locked"})
    if payload.topic is not None and payload.name is None:
        raw["name"] = clean_text(payload.topic, NAME_MAX) or ""
    values, errors = clean_settings(raw, site_max_members=settings.rooms_max_members, partial=True)
    agents = values.pop("agents", None)
    names: list[str] = []
    if agents is not None and not errors:
        if rt.agent_checker is None:
            errors["agents"] = "disabled"
        else:
            problem, names = await rt.agent_checker(user.id, agents)
            if problem is not None:
                errors["agents"] = problem
    if errors:
        return _invalid_settings(errors)
    room_id = room_id[:MAX_ID]
    agents_changed = False
    try:
        before = await rt.store.room(room_id)
        _room, changes = await rt.store.update_settings(room_id, user.id, values)
        if agents is not None:
            _room, agents_changed = await rt.store.set_agents(room_id, user.id, agents)
        room = await rt.store.update(room_id, user.id, locked=payload.locked)
    except RoomError as e:
        _raise(e)
    if changes:
        await system_message(rt, room.id, "settings", {"changes": changes})
    if agents_changed:  # names are stored for the web template only; never logged
        await system_message(rt, room.id, "agents" if agents else "agents_off",
                             {"names": ", ".join(names)} if agents else {})
    if before is not None and before.join_mode == "approval" and room.join_mode == "code":
        await settle_requests(rt, room.id)
    await rt.hub.broadcast(room.id, event("room_update", room=await _room_json(rt, room, None)))
    return {"room": await _room_json(rt, room, "owner")}
```

`rooms_shutdown` 中 `await rt.hub.close_all(CLOSE_RESTART)` 之前加:

```python
    for listener in list(rt.shutdown_listeners):
        try:
            await listener(rt)
        except Exception as e:
            logger.warning("rooms shutdown listener failed error=%s", type(e).__name__)
```

- [ ] **Step 5: 改 `server/app/main.py`** — import 区与其它 rooms 路由一起导入 `rooms_agents`;把 `app.state.rooms_extensions = (rooms_voice.install, rooms_summary.install)` 改为 `app.state.rooms_extensions = (rooms_voice.install, rooms_summary.install, rooms_agents.install)`;在 `app.include_router(rooms.router)` 那一行之后加 `app.include_router(rooms_agents.router)`(必须在 `stubs` 之前)。

- [ ] **Step 6: 网页错误表与文案(契约测试要求每个 `ROOM_ERRORS` 文案都有翻译)** — `web/src/features/rooms/create/rooms-v2-api.ts` 的 `ROOMS_V2_SERVER_ERRORS` 末尾加 `"Room tutor is running": "web.rooms.agents.errors.tutorActive",`;两个 `agents/i18n` 文件在 `"rooms"` 下增加:

zh-CN:

```json
      "agents": { "errors": { "tutorActive": "带练进行中,结束后再改智能体" } },
```

en:

```json
      "agents": { "errors": { "tutorActive": "The room tutor is running; change agents after it ends" } },
```

- [ ] **Step 7: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_rooms_agents_api.py tests/test_rooms_agents_ws.py tests/test_rooms_ws.py tests/test_rooms_api.py tests/test_rooms_settings.py tests/test_web_contract.py tests/test_architecture.py`;`cd web && yarn vitest run src/features/rooms` → PASS
- [ ] **Step 8: 提交**

```bash
git add server/app/routers/rooms_agents.py server/app/routers/rooms.py server/app/main.py server/tests/test_rooms_agents_api.py server/tests/test_rooms_agents_ws.py web/src/features/rooms/create/rooms-v2-api.ts web/src/features/rooms/agents/i18n
git commit -m "feat(rooms): owner picks room agents, members read and report them; lane installed as a rooms extension

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task S7: 智能体契约夹具与隐私测试

**Files:**
- Create: `server/tests/test_rooms_agents_contract.py`、`server/tests/fixtures/rooms_agents_contract.json`(录制)、`server/tests/test_rooms_agents_privacy.py`

**Interfaces:**
- Produces(夹具):`{"http": {"patch", "agents"}, "ws": {"agent_step", "agent_thought", "message_agent_answer", "message_agent_trace"}}`(T3 追加 `http.tutor_start`、`ws.agent_tutor`)

- [ ] **Step 1: 写录制/比对测试**

`server/tests/test_rooms_agents_contract.py`:

```python
"""Pins the room-agents payloads the web reads (web/src/features/rooms/agents/room-agents-contract.test.ts).
Regenerate after an intentional change: `CONTRACT_UPDATE=1 uv run pytest -q tests/test_rooms_agents_contract.py`.
Values are recorded as-is (ids and times vary); the comparison is by shape."""
import json
import os
from pathlib import Path

from tests.test_rooms_agents_api import agents_client, room_of  # noqa: F401 (fixture)
from tests.test_rooms_agents_ws import until_answer
from tests.test_rooms_ws import until

FIXTURE = Path(__file__).parent / "fixtures" / "rooms_agents_contract.json"


def shape(value):
    if isinstance(value, dict):
        return {k: shape(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [shape(value[0])] if value else []
    return type(value).__name__


def record(client) -> dict:
    room, alice, _, bob, _ = room_of(client)
    patch = client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach"]}, headers=alice).json()
    agents = client.get(f"/api/rooms/{room['id']}/agents", headers=bob).json()
    name = agents["agents"][0]["name"]
    ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=bob).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wb:
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        wb.send_text(json.dumps({"type": "say", "client_id": "q", "text": f"@{name} can I use abandon here?"}))
        events = until_answer(wb)
        trace = until(wb, "message")[-1]
    first = {e["type"]: e for e in reversed(events)}
    return {"http": {"patch": patch, "agents": agents},
            "ws": {"agent_step": first["agent_step"], "agent_thought": first["agent_thought"],
                   "message_agent_answer": events[-1], "message_agent_trace": trace}}


def test_room_agents_payloads_match_the_web_contract(agents_client):
    _app, client = agents_client
    got = record(client)
    if os.environ.get("CONTRACT_UPDATE"):
        FIXTURE.write_text(json.dumps(got, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    assert shape(json.loads(FIXTURE.read_text(encoding="utf-8"))) == shape(got)
```

`server/tests/test_rooms_agents_privacy.py`:

```python
"""caplog guard for every room-agents path (spec §11.5): no user text, replies, prompts, persona names, words or
tickets in any log record — success, failure, report and selection."""
import json
import logging

from app.providers.llm import LlmUnavailable
from tests.test_rooms_agents_api import U1, add_persona, agents_client, room_of  # noqa: F401 (fixture)
from tests.test_rooms_agents_ws import until_answer
from tests.test_rooms_ws import until

SECRETS = ("SECRET-Q-7731", "SECRET-P-4410", "SECRET-N", "abandon")


def test_room_agent_paths_log_no_text(agents_client, caplog, monkeypatch):
    app, client = agents_client
    caplog.set_level(logging.DEBUG)
    room, alice, alice_id, bob, _ = room_of(client)
    add_persona(app, client, alice_id, name="SECRET-N", prompt="SECRET-P-4410")
    client.patch(f"/api/rooms/{room['id']}", json={"agents": [U1]}, headers=alice)
    assert client.get(f"/api/rooms/{room['id']}/agents", headers=bob).json()["agents"][0]["prompt"] is None
    ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=bob).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wb:
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        wb.send_text(json.dumps({"type": "say", "client_id": "q", "text": "@SECRET-N SECRET-Q-7731 abandon?"}))
        until_answer(wb)

        async def broken(deps, req):
            raise LlmUnavailable("http")
            yield  # an async generator

        monkeypatch.setattr(app.state.rooms.agents.deps, "run_turn", broken)
        wb.send_text(json.dumps({"type": "say", "client_id": "q2", "text": "@SECRET-N SECRET-Q-7731 again"}))
        until(wb, "ai_failed")
    client.post(f"/api/rooms/{room['id']}/agents/{U1}/report", json={"reason": "abuse"}, headers=bob)
    for secret in (*SECRETS, ticket):
        assert secret not in caplog.text, secret
```

- [ ] **Step 2: 录制并确认** — Run: `cd server && CONTRACT_UPDATE=1 uv run pytest -q tests/test_rooms_agents_contract.py && uv run pytest -q tests/test_rooms_agents_contract.py tests/test_rooms_agents_privacy.py` → PASS;打开 `tests/fixtures/rooms_agents_contract.json` 核对:没有票据(只录了事件与 HTTP 响应)、`message_agent_answer.message.meta` 只有 `agent`/`asker`、`message_agent_trace.message.lane == "private"`。
- [ ] **Step 3: 提交**

```bash
git add server/tests/test_rooms_agents_contract.py server/tests/fixtures/rooms_agents_contract.json server/tests/test_rooms_agents_privacy.py
git commit -m "test(rooms): record the room agents contract and guard every agent path's logs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Lane T · 带练(房主开启「带练」,spec §7.5;单独评审)

### Task T1: 纯函数 `tutor_rotation.py`

**Files:**
- Create: `server/app/rooms/tutor_rotation.py`
- Test: `server/tests/test_rooms_tutor_rotation.py`

**Interfaces:**
- Produces:`MIN_STEPS=3`、`MAX_STEPS=12`、`DEFAULT_STEPS=8`;`clamp_steps(n: int | None) -> int`;`initial_order(member_ids: list[int], online: set[int]) -> list[int]`;`next_participant(order: list[int], last: int | None, active: list[int]) -> tuple[list[int], int | None]`;`remaining_ms(deadline_iso: str | None, now: datetime) -> int | None`

- [ ] **Step 1: 写失败测试**

```python
# server/tests/test_rooms_tutor_rotation.py
from datetime import datetime, timedelta, timezone

from app.models import iso_utc
from app.rooms.tutor_rotation import clamp_steps, initial_order, next_participant, remaining_ms

NOW = datetime(2026, 10, 12, 9, tzinfo=timezone.utc)


def test_steps_are_clamped_to_spec_range():
    assert [clamp_steps(n) for n in (None, 1, 3, 8, 12, 50)] == [8, 3, 3, 8, 12, 12]


def test_initial_order_is_online_members_in_join_order():
    assert initial_order([1, 2, 3, 4], {4, 2}) == [2, 4]
    assert initial_order([1, 2], set()) == []


def test_rotation_cycles_skips_leavers_and_appends_newcomers():
    order = [1, 2, 3]
    assert next_participant(order, None, [1, 2, 3]) == ([1, 2, 3], 1)
    assert next_participant(order, 1, [1, 2, 3]) == ([1, 2, 3], 2)
    assert next_participant(order, 3, [1, 2, 3]) == ([1, 2, 3], 1)
    assert next_participant(order, 1, [1, 3]) == ([1, 2, 3], 3)  # 2 left the room
    assert next_participant(order, 3, [1, 2, 3, 9]) == ([1, 2, 3, 9], 9)  # 9 joined: last in the round
    assert next_participant([5], 5, [5]) == ([5], 5)  # alone: asked again
    assert next_participant(order, 2, []) == ([1, 2, 3], None)
    assert next_participant(order, 7, [2, 3]) == ([1, 2, 3], 2)  # unknown last: from the top


def test_remaining_ms_from_an_iso_deadline():
    assert remaining_ms(iso_utc(NOW + timedelta(seconds=42)), NOW) == 42_000
    assert remaining_ms(iso_utc(NOW - timedelta(seconds=1)), NOW) == 0
    assert remaining_ms(None, NOW) is None
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rooms_tutor_rotation.py` → FAIL
- [ ] **Step 3: 实现**

```python
# server/app/rooms/tutor_rotation.py
"""Pure participant rotation and deadlines for the room tutor (spec 2026-10-12-agents §7.5, plan A5 R-RA8).
The order is fixed at start (online members in join order); members who join later go to the end, members who
left are skipped, nobody is ever removed from the order (so positions stay stable)."""
from datetime import datetime

MIN_STEPS, MAX_STEPS, DEFAULT_STEPS = 3, 12, 8  # questions per round (spec §7.2: 3–12, default 8)


def clamp_steps(n: int | None) -> int:
    return DEFAULT_STEPS if n is None else max(MIN_STEPS, min(MAX_STEPS, int(n)))


def initial_order(member_ids: list[int], online: set[int]) -> list[int]:
    return [u for u in member_ids if u in online]


def next_participant(order: list[int], last: int | None, active: list[int]) -> tuple[list[int], int | None]:
    """(order with newcomers appended, next user after `last`); None when no active member is in the order."""
    alive = set(active)
    order = list(order) + [u for u in active if u not in order]
    start = order.index(last) + 1 if last in order else 0
    for k in range(len(order)):
        user = order[(start + k) % len(order)]
        if user in alive:
            return order, user
    return order, None


def remaining_ms(deadline_iso: str | None, now: datetime) -> int | None:
    if not deadline_iso:
        return None
    deadline = datetime.fromisoformat(deadline_iso.replace("Z", "+00:00"))
    return max(0, int((deadline - now).total_seconds() * 1000))
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_rooms_tutor_rotation.py tests/test_architecture.py` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/app/rooms/tutor_rotation.py server/tests/test_rooms_tutor_rotation.py
git commit -m "feat(rooms): room tutor rotation and deadline helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task T2: `RoomTutor`(点名、作答、超时跳过、暂停与继续、持久化)

**Files:**
- Create: `server/app/rooms/agent_tutor.py`
- Test: `server/tests/test_rooms_agent_tutor.py`

**Interfaces:**
- Consumes:A3 `tutor.machine`(`initial_state`、`next_state`、`TutorEvent`、`difficulty`、`TutorState.to_dict/from_dict`)、`tutor.plan.build_plan`、`tutor.parse.parse_meta/StreamFilter`(只在「A3 适配块」里);A1 `TurnRequest`、`ModeBlock`、`Delta/Meta/Error`;S5 `AgentLane`;T1
- Produces:`TutorError(code)`;`tutor_view(snapshot | None, now) -> dict | None`;`tutor_rules(...) -> str`;`RoomTutorMode`;`RoomTutor(lane, *, sleep=asyncio.sleep, turn_seconds=60)`,方法 `start(room_id, user_id, persona_id, steps) -> dict`、`skip(room_id, user_id)`、`stop(room_id, user_id)`、`resume(room_id, user_id) -> dict`、`on_message(room_id, message)`、`on_welcome(conn)`、`public_view(room) -> dict | None`、`pause_all() -> int`、`on_close(room_id)`、`shutdown()`
- 快照字段(`rooms.agent_tutor`):`v, run_id, persona_id, persona_name, started_by, phase(generating|await_answer|paused), step_index, steps_total, order, current_user_id, current_name, question_seq, deadline_at, kinds, machine, paused_reason`
- 错误码:`disabled|forbidden|not_agent|active|ai_off|no_participants|quota|not_waiting|not_paused|not_found`

- [ ] **Step 1: 写失败测试**

`server/tests/test_rooms_agent_tutor.py`:

```python
import asyncio
import logging

import pytest

from app.agents.trace import Delta, Error, Meta
from app.rooms.agent_tutor import (
    KINDS, LEVELS, RoomTutor, RoomTutorMode, TutorError, _machine_feed, _machine_level, _machine_start, _plan_kinds,
    tutor_rules, tutor_view,
)
from tests.test_rooms_agents_lane import A, B, EMMA, Script, env, say  # noqa: F401 (fixture)


class TutorScript(Script):
    def __init__(self):
        super().__init__()
        self.tutor_reply = "Nice. Next question for you."
        self.meta = {"step_index": 1, "steps_total": 3, "verdict": "good", "kind": "ask", "done": False}

    async def run_turn(self, deps, req):
        if req.mode != "tutor":
            async for ev in super().run_turn(deps, req):
                yield ev
            return
        self.calls.append((deps, req))
        if self.block is not None:
            await self.block.wait()
        if self.error is not None:
            yield Error(code=self.error)
            return
        yield Delta(text=self.tutor_reply)
        if self.meta is not None:
            yield Meta(**self.meta)


class Clockwork:
    """Injected sleep: timers wait on futures the test resolves (no real 60 s waits)."""

    def __init__(self):
        self.pending: list[asyncio.Future] = []

    async def sleep(self, seconds):
        fut = asyncio.get_running_loop().create_future()
        self.pending.append(fut)
        await fut


@pytest.fixture
async def tenv(env):
    env.script = TutorScript()
    env.lane.deps.run_turn = env.script.run_turn
    env.lane.deps.tutor_on = lambda: True
    env.clock = Clockwork()
    env.tutor = RoomTutor(env.lane, sleep=env.clock.sleep)
    env.lane.tutor = env.tutor
    yield env
    await env.tutor.shutdown()


async def fire(env):
    """Let the current question's 60 s run out."""
    task = env.tutor._timers[env.room.id]
    while not env.clock.pending:
        await asyncio.sleep(0)
    env.clock.pending.pop(0).set_result(None)
    await task
    await env.hub.drain()


def tutor_frames(conn):
    return [ev["tutor"] for ev in conn.sender.sent if ev["type"] == "agent_tutor"]


def messages(conn):
    return [ev["message"] for ev in conn.sender.sent if ev["type"] == "message"]


async def start(env, steps=3):
    view = await env.tutor.start(env.room.id, A, EMMA.id, steps)
    await env.hub.drain()
    return view


async def test_start_calls_on_the_first_online_member(tenv):
    view = await start(tenv)
    assert (view["phase"], view["steps_total"], view["persona_name"]) == ("generating", 3, "Emma")
    deps, req = tenv.script.calls[0]
    assert (req.mode, req.text, req.user_id, req.in_room, req.tutor_session_id) == ("tutor", None, A, True, None)
    assert deps["allow_private"] is False and deps["memory"] is False and deps["modes"]["tutor"].name == "tutor"
    got = messages(tenv.bob)
    assert (got[0]["kind"], got[0]["text"], got[0]["meta"]) == ("system", "tutor_started", {"name": "Emma"})
    question = got[-1]
    assert question["meta"]["agent"] == {"persona_id": EMMA.id, "name": "Emma"}
    assert question["meta"]["tutor"] == {"step_index": 1, "steps_total": 3, "to_user_id": A, "to_name": "alice",
                                         "final": False, "verdict_for": None, "verdict": None}
    last = tutor_frames(tenv.bob)[-1]
    assert (last["phase"], last["current_user_id"], last["current_name"], last["remaining_ms"]) == (
        "await_answer", A, "alice", 60_000)
    snap = (await tenv.store.room(tenv.room.id)).agent_tutor
    assert snap["phase"] == "await_answer" and snap["question_seq"] == question["seq"] and snap["order"] == [A, B]


async def test_the_called_member_answers_others_only_chip_in(tenv):
    await start(tenv)
    await tenv.cb.handle(say("I think it is great.", "b1"))  # bob is not being asked: context only
    await tenv.hub.drain()
    assert len(tenv.script.calls) == 1
    await tenv.ca.handle(say("I went hiking.", "a1"))
    await tenv.hub.drain()
    _, req = tenv.script.calls[1]
    assert req.text == "alice: I went hiking."
    assert {"role": "user", "content": "bob: I think it is great."} in req.history
    q2 = messages(tenv.alice)[-1]
    assert q2["meta"]["tutor"]["to_user_id"] == B and q2["meta"]["tutor"]["step_index"] == 2
    assert (q2["meta"]["tutor"]["verdict_for"], q2["meta"]["tutor"]["verdict"]) == (A, "good")
    assert q2["reply_to"] is not None and tutor_frames(tenv.alice)[-1]["current_user_id"] == B


async def test_sixty_seconds_without_an_answer_skip_to_the_next_member(tenv):
    await start(tenv)
    tenv.script.meta = None  # no META line: the code decides the verdict (spec §7.3)
    await fire(tenv)
    _, req = tenv.script.calls[1]
    assert req.text is None
    tutor = messages(tenv.bob)[-1]["meta"]["tutor"]
    assert (tutor["verdict_for"], tutor["verdict"], tutor["to_user_id"]) == (A, "skip", B)


async def test_skip_by_the_called_member_or_the_owner(tenv):
    await start(tenv)
    with pytest.raises(TutorError) as e:
        await tenv.tutor.skip(tenv.room.id, B)
    assert e.value.code == "forbidden"
    await tenv.tutor.skip(tenv.room.id, A)
    await tenv.hub.drain()
    assert tutor_frames(tenv.bob)[-1]["current_user_id"] == B
    await tenv.tutor.skip(tenv.room.id, A)  # the owner may skip bob
    await tenv.hub.drain()
    assert tutor_frames(tenv.bob)[-1]["current_user_id"] == A


async def test_the_round_ends_with_a_wrap_up(tenv):
    await start(tenv)
    for conn, cid in ((tenv.ca, "a1"), (tenv.cb, "b1"), (tenv.ca, "a2")):
        await conn.handle(say("My answer.", cid))
        await tenv.hub.drain()
    assert len(tenv.script.calls) == 4
    got = messages(tenv.bob)
    wrap = [m for m in got if m["kind"] == "ai_answer"][-1]
    assert wrap["meta"]["tutor"]["final"] is True and wrap["meta"]["tutor"]["to_user_id"] is None
    assert (got[-1]["kind"], got[-1]["text"]) == ("system", "tutor_done")
    assert tutor_frames(tenv.bob)[-1] is None
    assert (await tenv.store.room(tenv.room.id)).agent_tutor is None and tenv.room.id not in tenv.tutor._timers


async def test_owner_stops_and_late_answers_do_nothing(tenv):
    await start(tenv)
    with pytest.raises(TutorError) as e:
        await tenv.tutor.stop(tenv.room.id, B)
    assert e.value.code == "forbidden"
    await tenv.tutor.stop(tenv.room.id, A)
    assert tutor_frames(tenv.bob)[-1] is None and messages(tenv.bob)[-1]["text"] == "tutor_stopped"
    await tenv.ca.handle(say("late answer", "a1"))
    await tenv.hub.drain()
    assert len(tenv.script.calls) == 1 and (await tenv.store.room(tenv.room.id)).agent_tutor is None


async def test_restart_pauses_reconnects_see_it_and_the_owner_resumes(tenv):
    await start(tenv)
    await tenv.tutor.shutdown()
    fresh = RoomTutor(tenv.lane, sleep=tenv.clock.sleep)  # a new process: no timers, nothing active
    tenv.lane.tutor = tenv.tutor = fresh
    assert await fresh.pause_all() == 1
    snap = (await tenv.store.room(tenv.room.id)).agent_tutor
    assert (snap["phase"], snap["paused_reason"], snap["deadline_at"]) == ("paused", "restart", None)
    await fresh.on_welcome(tenv.ca)
    assert tenv.alice.sender.sent[-1]["type"] == "agent_tutor"
    assert tenv.alice.sender.sent[-1]["tutor"]["paused_reason"] == "restart"
    await tenv.ca.handle(say("answer while paused", "a1"))
    await tenv.hub.drain()
    assert len(tenv.script.calls) == 1
    assert (await fresh.resume(tenv.room.id, A))["phase"] == "generating"
    await tenv.hub.drain()
    tutor = messages(tenv.bob)[-1]["meta"]["tutor"]
    assert (tutor["to_user_id"], tutor["step_index"], tutor["verdict_for"]) == (A, 1, None)  # the same question again
    with pytest.raises(TutorError) as e:
        await fresh.resume(tenv.room.id, A)
    assert e.value.code == "not_paused"


async def test_upstream_failure_and_ai_mute_pause_the_round(tenv):
    tenv.script.error = "llm_unavailable"
    await start(tenv)
    last = tutor_frames(tenv.bob)[-1]
    assert (last["phase"], last["paused_reason"]) == ("paused", "upstream")
    assert tenv.refunds == ["room_ai_global"]
    tenv.script.error = None
    await tenv.store.set_ai_muted(tenv.room.id, True)  # admin mute also mutes the tutor (R-RA5)
    await tenv.tutor.resume(tenv.room.id, A)
    await tenv.hub.drain()
    assert tutor_frames(tenv.bob)[-1]["paused_reason"] == "ai_off" and len(tenv.script.calls) == 1


async def test_start_rules(tenv):
    async def code(user_id, persona_id):
        with pytest.raises(TutorError) as e:
            await tenv.tutor.start(tenv.room.id, user_id, persona_id, 8)
        return e.value.code

    assert await code(B, EMMA.id) == "forbidden"
    assert await code(A, "builtin:waiter") == "not_agent"
    tenv.lane.deps.tutor_on = lambda: False
    assert await code(A, EMMA.id) == "disabled"
    tenv.lane.deps.tutor_on = lambda: True
    tenv.quota["agent_tutor"] = 0
    assert await code(A, EMMA.id) == "quota"
    tenv.quota["agent_tutor"] = 99
    tenv.hub.detach(tenv.room.id, tenv.alice)
    tenv.hub.detach(tenv.room.id, tenv.bob)
    assert await code(A, EMMA.id) == "no_participants"
    tenv.hub.attach(tenv.room.id, tenv.alice)
    tenv.hub.attach(tenv.room.id, tenv.bob)
    await tenv.tutor.start(tenv.room.id, A, EMMA.id, 8)
    assert await code(A, EMMA.id) == "active"
    await tenv.hub.drain()


def test_tutor_rules_and_view():
    text = tutor_rules(prev_name="alice", outcome="answer", next_name="bob", kind="words", level="B2", final=False)
    assert "feedback" in text and "bob" in text and "CEFR B2" in text and '"done":false' in text and "<<META>>" in text
    final = tutor_rules(prev_name="bob", outcome="skip", next_name=None, kind="ask", level="B1", final=True)
    assert "wrap up" in final and "did not answer" in final and '"done":true' in final
    assert tutor_view(None, None) is None


async def test_mode_block_and_meta_parsing():
    mode = RoomTutorMode(prev_name=None, outcome="open", next_name="alice", kind="ask", level="B1", final=False)
    block = await mode.prepare(None)
    assert block.max_tokens == 350 and "alice" in block.text
    meta = await mode.finish(None, 'Hi!\n<<META>>{"verdict":"good","kind":"ask","next_focus":"x","done":false}')
    assert meta["verdict"] == "good"
    assert await mode.finish(None, "no meta here") is None


def test_a3_adapter_plan_and_machine():
    kinds = _plan_kinds(5, "B1")
    assert len(kinds) == 5 and set(kinds) <= set(KINDS)
    state = _machine_start("B1")
    assert _machine_level(state) in LEVELS
    for _ in range(2):
        state = _machine_feed(state, "good")
    assert LEVELS.index(_machine_level(state)) >= LEVELS.index("B1")  # two good answers never lower it (spec §7.2)


async def test_tutor_logs_no_text(tenv, caplog):
    caplog.set_level(logging.DEBUG)
    tenv.script.tutor_reply = "SECRET-TUTOR-1"
    await start(tenv)
    await tenv.ca.handle(say("SECRET-ANSWER-2", "a1"))
    await tenv.hub.drain()
    tenv.script.error = "llm_unavailable"
    await fire(tenv)
    for secret in ("SECRET-TUTOR-1", "SECRET-ANSWER-2", "alice", "bob", "Emma"):
        assert secret not in caplog.text
    assert "room tutor paused reason=upstream" in caplog.text
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rooms_agent_tutor.py` → FAIL(模块不存在)

- [ ] **Step 3: 实现 `server/app/rooms/agent_tutor.py`**

```python
"""Room tutor 「带练」(spec 2026-10-12-agents §7.5; plan A5 lane T, R-RA8). The owner starts it with one of the
room's agents; the agent calls on members in turn; the called member has TUTOR_TURN_SECONDS to answer with a text
message. Other members may chip in: their messages are context, they never advance the round. A3's pure pieces
(plan, machine, META parsing) are used only through the adapter block; participants, timers and persistence live here.

Persistence (R-RA8): the snapshot in `rooms.agent_tutor` is rewritten on every transition; a reconnect gets an
`agent_tutor` frame after `welcome`. Timers are in-process tasks (not hub tasks: `hub.drain()` must not wait 60 s);
after a restart every running tutor is `paused` (reason `restart`) and the owner resumes. Tutor turns read no private
sources and write no memory; the starter pays the agent turn caps, the room pays its AI caps per turn.
Never logs answers, questions or names."""
import asyncio
import logging
import uuid
from contextlib import aclosing
from datetime import datetime, timedelta

from app.agents.orchestrator import ModeBlock, TurnRequest
from app.agents.trace import Delta, Error, Meta
from app.agents.tutor import machine as tutor_machine
from app.agents.tutor.parse import StreamFilter, parse_meta
from app.agents.tutor.plan import build_plan
from app.core import metering
from app.models import iso_utc
from app.rooms import agent_config
from app.rooms.agent_lane import AGENT_CONTEXT, GLOBAL, _clean, _history, _plain
from app.rooms.protocol import TUTOR_TURN_SECONDS, event
from app.rooms.store import RoomError, message_out
from app.rooms.tutor_rotation import clamp_steps, initial_order, next_participant, remaining_ms

logger = logging.getLogger(__name__)
TUTOR_SCOPE = "agent_tutor"  # daily starts per user, the same counter as the conversation tutor (A3)
VERDICTS = ("good", "ok", "weak", "skip")
LEVELS = ("A2", "B1", "B2", "C1")
KINDS = ("ask", "words", "repeat", "retell", "roleplay", "dictate")
KIND_TEXT = {
    "ask": "open question", "words": "make-a-sentence task with one useful word you give them",
    "repeat": "short sentence for them to repeat in writing", "retell": "short retell-in-your-own-words task",
    "roleplay": "one-line roleplay prompt", "dictate": "short sentence for them to type from memory",
}


class TutorError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _level(room_level: str) -> str:
    """Rooms go A1–C1, the tutor A2–C1 (spec §7.2)."""
    return room_level if room_level in LEVELS else ("A2" if room_level == "A1" else "B1")


# ---- A3 adapter (plan agents-tutor). Only these four functions touch app.agents.tutor.machine/plan; if A3's names
# differ, change them here and test_a3_adapter_plan_and_machine only (Task 0 Step 2). ----

def _plan_kinds(steps: int, level: str) -> list[str]:
    items = build_plan({"topic": "", "length": steps, "level": level, "mix": list(KINDS)}, [])
    kinds = [k if k in KINDS else "ask" for k in (getattr(i, "kind", "ask") for i in items)][:steps]
    return kinds + ["ask"] * (steps - len(kinds))


def _machine_start(level: str) -> dict:
    return tutor_machine.initial_state(level=level).to_dict()


def _machine_feed(data: dict, verdict: str) -> dict:
    state = tutor_machine.TutorState.from_dict(data)
    kind = "skip" if verdict == "skip" else "answer"
    return tutor_machine.next_state(state, tutor_machine.TutorEvent(kind=kind, verdict=verdict)).to_dict()


def _machine_level(data: dict) -> str:
    index = tutor_machine.difficulty(tutor_machine.TutorState.from_dict(data))
    return LEVELS[max(0, min(len(LEVELS) - 1, index))]

# ---- end of the A3 adapter ----


def tutor_rules(*, prev_name: str | None, outcome: str, next_name: str | None, kind: str, level: str,
                final: bool) -> str:
    """The tutor mode block (spec §7.3 output protocol: plain text, then one <<META>> line)."""
    lines = ["You are leading a short group speaking practice in a public room, like a friendly teacher. "
             "Everyone reads your reply."]
    if outcome == "answer" and prev_name:
        lines.append(f"- First give {_plain(prev_name)} brief feedback on their last message: right or not, one short "
                     "Chinese note starting with 中文:, and a more natural way to say it.")
    elif outcome == "skip" and prev_name:
        lines.append(f"- {_plain(prev_name)} did not answer in time; say so kindly in one short sentence.")
    else:
        lines.append("- Greet the room in one short sentence.")
    if final:
        lines.append("- Then wrap up: what the group did well and one thing to practise next. Do not ask a new question.")
    else:
        lines.append(f"- Then call on {_plain(next_name or '')} by name and give one {KIND_TEXT[kind]} at CEFR {level}.")
    lines.append("- Other members may chip in; thank them briefly. Keep it under 90 words. "
                 "Never read out anyone's personal learning data.")
    lines.append('- End with one separate line: <<META>>{"verdict":"good|ok|weak|skip","kind":"' + kind
                 + '","next_focus":"<a few words>","done":' + ("true" if final else "false") + "}")
    return "\n".join(lines) + "\n"


class RoomTutorMode:
    """A1 ModeHandler named "tutor", passed in TurnDeps.modes for room tutor turns only."""
    name = "tutor"

    def __init__(self, *, prev_name: str | None, outcome: str, next_name: str | None, kind: str, level: str,
                 final: bool):
        self.text = tutor_rules(prev_name=prev_name, outcome=outcome, next_name=next_name, kind=kind, level=level,
                                final=final)

    async def prepare(self, req) -> ModeBlock:
        return ModeBlock(text=self.text, max_tokens=350)

    def stream_filter(self):
        return StreamFilter()

    async def finish(self, req, full_text: str) -> dict | None:
        _visible, meta = parse_meta(full_text)
        return meta if isinstance(meta, dict) else None


def tutor_view(snap: dict | None, now: datetime | None) -> dict | None:
    """The public `agent_tutor` payload (no machine state, no plan)."""
    if not isinstance(snap, dict):
        return None
    waiting = snap.get("phase") == "await_answer"
    return {"persona_id": snap["persona_id"], "persona_name": snap["persona_name"], "phase": snap["phase"],
            "step_index": snap["step_index"], "steps_total": snap["steps_total"],
            "current_user_id": snap.get("current_user_id"), "current_name": snap.get("current_name"),
            "deadline_at": snap.get("deadline_at") if waiting else None,
            "remaining_ms": remaining_ms(snap.get("deadline_at"), now) if waiting and now is not None else None,
            "started_by": snap["started_by"], "paused_reason": snap.get("paused_reason")}


class RoomTutor:
    def __init__(self, lane, *, sleep=asyncio.sleep, turn_seconds: float = TUTOR_TURN_SECONDS):
        self.lane = lane
        self._sleep = sleep
        self.turn_seconds = turn_seconds
        self._locks: dict[str, asyncio.Lock] = {}
        self._timers: dict[str, asyncio.Task] = {}
        self._active: set[str] = set()  # rooms whose tutor this process started or resumed (cheap say filter)

    # ---- state helpers ----

    def _lock(self, room_id: str) -> asyncio.Lock:
        return self._locks.setdefault(room_id, asyncio.Lock())

    async def _load(self, room_id: str) -> dict | None:
        room = await self.lane.rooms().store.room(room_id)
        snap = room.agent_tutor if room is not None else None
        return dict(snap) if isinstance(snap, dict) else None

    async def _save(self, room_id: str, snap: dict | None) -> None:
        await self.lane.rooms().store.set_tutor(room_id, snap)

    async def _commit(self, room_id: str, snap: dict) -> bool:
        """Save a turn's result only if the same run is still generating (stop/restart may have happened)."""
        async with self._lock(room_id):
            current = await self._load(room_id)
            if current is None or current.get("run_id") != snap["run_id"] or current["phase"] != "generating":
                return False
            await self._save(room_id, snap)
            return True

    async def _broadcast(self, room_id: str, snap: dict | None) -> None:
        r = self.lane.rooms()
        await r.hub.broadcast(room_id, event("agent_tutor", tutor=tutor_view(snap, r.clock())))

    async def _system(self, room_id: str, key: str, meta: dict) -> None:
        r = self.lane.rooms()
        async with r.hub.lock(room_id):
            m = await r.store.append(room_id, lane="public", sender_kind="system", sender_id=None, kind="system",
                                     text=key, now=r.clock(), meta=meta)
        await r.hub.broadcast(room_id, event("message", message=message_out(m, None)))

    async def _is_owner(self, room_id: str, user_id: int) -> bool:
        try:
            room, member = await self.lane.rooms().store.membership(room_id, user_id)
        except RoomError:
            return False
        return room.status == "open" and member.role == "owner"

    def _arm(self, room_id: str, question_seq: int) -> None:
        self._disarm(room_id)
        self._timers[room_id] = asyncio.get_running_loop().create_task(self._expire(room_id, question_seq))

    def _disarm(self, room_id: str) -> None:
        task = self._timers.pop(room_id, None)
        if task is not None and task is not asyncio.current_task():
            task.cancel()

    async def _expire(self, room_id: str, question_seq: int) -> None:
        try:
            await self._sleep(self.turn_seconds)
            await self._advance(room_id, "skip", None, expect_seq=question_seq)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("room tutor timer failed error=%s", type(e).__name__)

    # ---- commands ----

    async def start(self, room_id: str, user_id: int, persona_id: str, steps: int | None) -> dict:
        r = self.lane.rooms()
        if not self.lane.deps.tutor_on():
            raise TutorError("disabled")
        if not await self._is_owner(room_id, user_id):
            raise TutorError("forbidden")
        async with self._lock(room_id):
            room = await r.store.room(room_id)
            cfg = agent_config.config_of(room)
            if persona_id not in cfg.persona_ids:
                raise TutorError("not_agent")
            personas = await agent_config.resolve(self.lane.deps.personas, cfg)
            persona = next((p for p in personas if p.id == persona_id), None)
            if persona is None or getattr(persona, "disabled_at", None) is not None:
                raise TutorError("not_agent")
            if isinstance(room.agent_tutor, dict):
                raise TutorError("active")
            if not r.ai_available or not room.ai_public or room.ai_muted:
                raise TutorError("ai_off")
            members = await r.store.members(room_id)
            order = initial_order([m.user_id for m in members], r.hub.online(room_id))
            if not order:
                raise TutorError("no_participants")
            if not await r.consume(TUTOR_SCOPE, str(user_id), self.lane.deps.tutor_daily()):
                raise TutorError("quota")
            total = clamp_steps(steps)
            level = _level(room.level)
            snap = {"v": 1, "run_id": uuid.uuid4().hex, "persona_id": persona.id, "persona_name": persona.name,
                    "started_by": user_id, "phase": "generating", "step_index": 0, "steps_total": total,
                    "order": order, "current_user_id": None, "current_name": None, "question_seq": None,
                    "deadline_at": None, "kinds": _plan_kinds(total, level), "machine": _machine_start(level),
                    "paused_reason": None}
            await self._save(room_id, snap)
            self._active.add(room_id)
        await self._system(room_id, "tutor_started", {"name": persona.name})
        await self._broadcast(room_id, snap)
        r.hub.spawn(self._turn(room_id, "open", None))
        return tutor_view(snap, r.clock())

    async def skip(self, room_id: str, user_id: int) -> None:
        snap = await self._load(room_id)
        if snap is None or snap["phase"] != "await_answer":
            raise TutorError("not_waiting")
        if user_id != snap["current_user_id"] and not await self._is_owner(room_id, user_id):
            raise TutorError("forbidden")
        if not await self._advance(room_id, "skip", None, expect_seq=snap["question_seq"]):
            raise TutorError("not_waiting")

    async def stop(self, room_id: str, user_id: int) -> None:
        if not await self._is_owner(room_id, user_id):
            raise TutorError("forbidden")
        async with self._lock(room_id):
            if await self._load(room_id) is None:
                raise TutorError("not_found")
            self._disarm(room_id)
            self._active.discard(room_id)
            await self._save(room_id, None)
        await self._broadcast(room_id, None)
        await self._system(room_id, "tutor_stopped", {})

    async def resume(self, room_id: str, user_id: int) -> dict:
        r = self.lane.rooms()
        if not self.lane.deps.tutor_on():
            raise TutorError("disabled")
        if not await self._is_owner(room_id, user_id):
            raise TutorError("forbidden")
        async with self._lock(room_id):
            snap = await self._load(room_id)
            if snap is None or snap["phase"] != "paused":
                raise TutorError("not_paused")
            snap.update(phase="generating", paused_reason=None, deadline_at=None)
            await self._save(room_id, snap)
            self._active.add(room_id)
        await self._broadcast(room_id, snap)
        r.hub.spawn(self._turn(room_id, "resume", None))
        return tutor_view(snap, r.clock())

    # ---- hooks from AgentLane / the rooms runtime ----

    async def on_message(self, room_id: str, message) -> None:
        if room_id not in self._active or message.sender_kind != "user" or message.kind != "text":
            return
        await self._advance(room_id, "answer", (message.seq, message.text), user_id=message.sender_id)

    async def on_welcome(self, conn) -> None:
        snap = await self._load(conn.room_id)
        if snap is not None:
            await conn.send_self(event("agent_tutor", tutor=tutor_view(snap, self.lane.rooms().clock())))

    async def public_view(self, room) -> dict | None:
        return tutor_view(room.agent_tutor if isinstance(room.agent_tutor, dict) else None, self.lane.rooms().clock())

    async def pause_all(self) -> int:
        """Startup listener: timers did not survive the restart, so running tutors wait for the owner (R-RA8)."""
        r = self.lane.rooms()
        paused = 0
        for room_id, snap in await r.store.tutor_rooms():
            if snap.get("phase") in ("generating", "await_answer"):
                await r.store.set_tutor(room_id, {**snap, "phase": "paused", "paused_reason": "restart",
                                                  "deadline_at": None})
                paused += 1
        logger.info("room tutor startup paused=%d", paused)
        return paused

    async def on_close(self, room_id: str) -> None:
        self._disarm(room_id)
        self._active.discard(room_id)
        await self._save(room_id, None)

    async def shutdown(self) -> None:
        tasks = list(self._timers.values())
        self._timers.clear()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    # ---- turns ----

    async def _advance(self, room_id: str, outcome: str, answer: tuple[int, str] | None, *,
                       user_id: int | None = None, expect_seq: int | None = None) -> bool:
        async with self._lock(room_id):
            snap = await self._load(room_id)
            if snap is None or snap["phase"] != "await_answer":
                return False
            if expect_seq is not None and snap["question_seq"] != expect_seq:
                return False
            if outcome == "answer" and user_id != snap["current_user_id"]:
                return False
            self._disarm(room_id)
            snap.update(phase="generating", deadline_at=None)
            await self._save(room_id, snap)
        await self._broadcast(room_id, snap)
        self.lane.rooms().hub.spawn(self._turn(room_id, outcome, answer))
        return True

    async def _pause(self, room_id: str, snap: dict, reason: str) -> None:
        paused = {**snap, "phase": "paused", "paused_reason": reason, "deadline_at": None}
        if await self._commit(room_id, paused):
            logger.info("room tutor paused reason=%s", reason)
            await self._broadcast(room_id, paused)

    async def _finish(self, room_id: str, snap: dict) -> None:
        async with self._lock(room_id):
            current = await self._load(room_id)
            if current is None or current.get("run_id") != snap["run_id"]:
                return
            self._disarm(room_id)
            self._active.discard(room_id)
            await self._save(room_id, None)
        await self._broadcast(room_id, None)
        await self._system(room_id, "tutor_done", {"name": snap["persona_name"]})

    async def _turn(self, room_id: str, outcome: str, answer: tuple[int, str] | None) -> None:
        r = self.lane.rooms()
        async with r.hub.ai_lock(room_id):  # one AI speaker per room, shared with @ai and @persona (R-RA5)
            snap = await self._load(room_id)
            if snap is None or snap["phase"] != "generating":
                return
            room = await r.store.room(room_id)
            if room is None or room.status != "open":
                return
            if not self.lane.deps.tutor_on() or not r.ai_available or not room.ai_public or room.ai_muted:
                return await self._pause(room_id, snap, "ai_off")
            personas = await agent_config.resolve(self.lane.deps.personas, agent_config.config_of(room))
            persona = next((p for p in personas if p.id == snap["persona_id"]), None)
            if persona is None or getattr(persona, "disabled_at", None) is not None:
                return await self._pause(room_id, snap, "agent_off")
            if not r.ai_room_limiter.allow(room_id) or not await r.consume("room_ai_global", GLOBAL,
                                                                            r.limits.ai_global_daily):
                return await self._pause(room_id, snap, "quota")
            members = await r.store.members(room_id)
            names = {m.user_id: m.name for m in members}
            prev = snap["current_user_id"] if outcome in ("answer", "skip") else None
            final = outcome in ("answer", "skip") and snap["step_index"] >= snap["steps_total"]
            order, target, step = snap["order"], None, snap["step_index"]
            if not final:
                if outcome == "resume" and snap["current_user_id"] in names:
                    target, step = snap["current_user_id"], max(1, step)
                else:
                    order, target = next_participant(order, snap["current_user_id"], [m.user_id for m in members])
                    step += 1
                final = target is None  # everyone left: wrap up now
            kind = snap["kinds"][min(step, len(snap["kinds"])) - 1] if not final and step >= 1 else "ask"
            mode = RoomTutorMode(prev_name=names.get(prev) if prev is not None else None,
                                 outcome=outcome if prev is not None else "open", next_name=names.get(target),
                                 kind=kind, level=_machine_level(snap["machine"]), final=final)
            rows = await r.store.agent_context(room_id, AGENT_CONTEXT, before_seq=room.last_seq + 1)
            req = TurnRequest(user_id=snap["started_by"], persona=persona, conversation_id=None, room_id=room_id,
                              text=f"{names.get(prev, '')}: {answer[1]}" if outcome == "answer" and answer else None,
                              history=_history(rows, persona.id), mode="tutor", tutor_session_id=None,
                              client_turn_id=self.lane.deps.new_id(), in_room=True)
            deps = self.lane.deps.turn_deps(allow_private=False, memory=False, modes={"tutor": mode})
            parts: list[str] = []
            meta = None
            failure = None
            try:
                metering.bind_user(snap["started_by"])
                with metering.feature_scope("rooms"):
                    async with r.ai_gate:
                        async with asyncio.timeout(self.lane.deps.turn_timeout):
                            async with aclosing(self.lane.deps.run_turn(deps, req)) as events:
                                async for ev in events:
                                    if isinstance(ev, Delta):
                                        parts.append(ev.text)
                                    elif isinstance(ev, Meta):
                                        meta = ev.to_dict()
                                    elif isinstance(ev, Error):
                                        failure = ev.code
                                        break
            except asyncio.CancelledError:
                raise
            except Exception as e:
                failure = "timeout" if isinstance(e, TimeoutError) else type(e).__name__
            text = _clean(parts)
            if failure is not None or not text:
                logger.info("room tutor turn failed kind=%s", failure or "empty")
                await r.refund("room_ai_global", GLOBAL)
                return await self._pause(room_id, snap, "upstream")
            verdict = (meta.get("verdict") if isinstance(meta, dict) and meta.get("verdict") in VERDICTS
                       else ("skip" if outcome == "skip" else "ok"))
            machine = _machine_feed(snap["machine"], verdict) if prev is not None else snap["machine"]
            tutor_meta = {"step_index": step, "steps_total": snap["steps_total"], "to_user_id": target,
                          "to_name": names.get(target), "final": final, "verdict_for": prev,
                          "verdict": verdict if prev is not None else None}
            async with r.hub.lock(room_id):
                msg = await r.store.append(room_id, lane="public", sender_kind="ai", sender_id=None, kind="ai_answer",
                                           text=text, now=r.clock(),
                                           reply_to=answer[0] if outcome == "answer" and answer else None,
                                           meta={"agent": agent_config.agent_meta(persona), "tutor": tutor_meta})
            await r.hub.broadcast(room_id, event("message", message=message_out(msg, None)))
            if final:
                return await self._finish(room_id, snap)
            deadline = r.clock() + timedelta(seconds=self.turn_seconds)
            done = {**snap, "phase": "await_answer", "step_index": step, "order": order, "current_user_id": target,
                    "current_name": names.get(target), "question_seq": msg.seq, "deadline_at": iso_utc(deadline),
                    "machine": machine, "paused_reason": None}
            if not await self._commit(room_id, done):
                return
        await self._broadcast(room_id, done)
        self._arm(room_id, msg.seq)
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_rooms_agent_tutor.py tests/test_rooms_agents_lane.py tests/test_architecture.py` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/app/rooms/agent_tutor.py server/tests/test_rooms_agent_tutor.py
git commit -m "feat(rooms): room tutor calls on members in turn with 60 s skip, pause on restart and resume

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task T3: 带练端点、安装接线、重连补发、契约重录

**Files:**
- Modify: `server/app/routers/rooms_agents.py`、`server/tests/test_rooms_agents_contract.py`
- Re-record: `server/tests/fixtures/rooms_agents_contract.json`
- Test: `server/tests/test_rooms_agent_tutor_api.py`

**Interfaces:**
- Produces(HTTP):`POST /api/rooms/{id}/agents/tutor/start {persona_id, steps?: 3..12}` → `{tutor}`;`POST …/tutor/skip` → `{ok}`;`POST …/tutor/stop` → `{ok}`;`POST …/tutor/resume` → `{tutor}`;`GET /api/rooms/{id}/agents` 的 `tutor` 开始有值
- 错误文案(网页 W1 映射):`Room tutor is off`(404)、`Only the owner can do that`(403)、`Not an agent of this room`(400)、`Room tutor is running`(409)、`AI is off in this room`(409)、`Nobody online to practise with`(409)、`Room tutor limit reached`(429)、`Nobody is being asked`(409)、`Room tutor is not paused`(409)、`Room tutor not found`(404)

- [ ] **Step 1: 写失败测试**

`server/tests/test_rooms_agent_tutor_api.py`:

```python
from tests.test_rooms_agents_api import agents_client, room_of  # noqa: F401 (fixture)
from tests.test_rooms_ws import until


def until_waiting(ws):
    events = []
    while True:
        events += until(ws, "agent_tutor")
        if events[-1]["tutor"] and events[-1]["tutor"]["phase"] == "await_answer":
            return events


def test_owner_runs_the_room_tutor_and_reconnects_see_it(agents_client):
    app, client = agents_client
    room, alice, alice_id, bob, _ = room_of(client)
    base = f"/api/rooms/{room['id']}"
    client.patch(base, json={"agents": ["builtin:coach"]}, headers=alice)

    def ticket(headers):
        return client.post(f"{base}/ticket", headers=headers).json()["ticket"]

    body = {"persona_id": "builtin:coach", "steps": 3}
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(alice)}") as wa, \
            client.websocket_connect(f"/api/rooms/ws?ticket={ticket(bob)}") as wb:
        wa.send_text('{"type":"hello","last_seq":0}')
        until(wa, "welcome")
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        assert client.post(f"{base}/agents/tutor/start", json=body, headers=bob).json() == {
            "error": "Only the owner can do that"}
        started = client.post(f"{base}/agents/tutor/start", json=body, headers=alice)
        assert started.status_code == 200 and started.json()["tutor"]["steps_total"] == 3
        assert until_waiting(wb)[-1]["tutor"]["current_user_id"] == alice_id
        assert client.post(f"{base}/agents/tutor/start", json=body, headers=alice).json() == {
            "error": "Room tutor is running"}
        assert client.get(f"{base}/agents", headers=bob).json()["tutor"]["phase"] == "await_answer"
        assert client.post(f"{base}/agents/tutor/skip", headers=bob).status_code == 403
        assert client.patch(base, json={"agents": []}, headers=alice).json() == {"error": "Room tutor is running"}
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(bob)}") as wb2:
        wb2.send_text('{"type":"hello","last_seq":0}')
        events = until(wb2, "agent_tutor")  # right after welcome and the replay (R-RA8)
        assert any(e["type"] == "welcome" for e in events) and events[-1]["tutor"]["phase"] == "await_answer"
        assert client.post(f"{base}/agents/tutor/stop", headers=alice).json() == {"ok": True}
        assert until(wb2, "agent_tutor")[-1]["tutor"] is None
    assert client.post(f"{base}/agents/tutor/resume", headers=alice).json() == {"error": "Room tutor is not paused"}
    assert client.post(f"{base}/agents/tutor/start", json={"persona_id": "builtin:coach", "steps": 2},
                       headers=alice).status_code == 422
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rooms_agent_tutor_api.py` → FAIL(404 路由不存在)

- [ ] **Step 3: 实现** — `server/app/routers/rooms_agents.py`:

import 区加 `from app.core.deps import current_user, limited_user`(替换原来只导入 `current_user` 的那行)与 `from app.rooms.agent_tutor import RoomTutor, TutorError`。

`install` 函数末尾(`rt.agent_checker = check` 之后)加:

```python
    tutor = RoomTutor(rt.agents)
    rt.agents.tutor = tutor

    async def pause_running(_rt) -> None:
        await tutor.pause_all()

    async def forget_closed(_rt, room_id: str, _reason: str) -> None:
        await tutor.on_close(room_id)

    async def stop_timers(_rt) -> None:
        await tutor.shutdown()

    rt.startup_listeners.append(pause_running)
    rt.close_listeners.append(forget_closed)
    rt.shutdown_listeners.append(stop_timers)
```

文件末尾加:

```python
TUTOR_ERRORS: dict[str, tuple[int, str]] = {
    "disabled": (404, "Room tutor is off"), "forbidden": (403, "Only the owner can do that"),
    "not_agent": (400, "Not an agent of this room"), "active": (409, "Room tutor is running"),
    "ai_off": (409, "AI is off in this room"), "no_participants": (409, "Nobody online to practise with"),
    "quota": (429, "Room tutor limit reached"), "not_waiting": (409, "Nobody is being asked"),
    "not_paused": (409, "Room tutor is not paused"), "not_found": (404, "Room tutor not found"),
}


class TutorStartIn(BaseModel):
    persona_id: str = Field(min_length=1, max_length=64)
    steps: int | None = Field(None, ge=3, le=12)


def _tutor_fail(e: TutorError):
    status, message = TUTOR_ERRORS[e.code]
    raise HTTPException(status, message) from None


async def _tutor_of(request: Request, room_id: str, user: User):
    rt, room, _member = await _member_room(request, room_id, user)
    if rt.agents is None or rt.agents.tutor is None:
        raise HTTPException(404, "Room tutor is off")
    return rt.agents.tutor, room


@router.post("/{room_id}/agents/tutor/start")
async def tutor_start(room_id: str, payload: TutorStartIn, request: Request, user: User = Depends(limited_user),
                      _: Settings = Depends(require_rooms)):
    tutor, room = await _tutor_of(request, room_id, user)
    try:
        return {"tutor": await tutor.start(room.id, user.id, payload.persona_id[:MAX_ID], payload.steps)}
    except TutorError as e:
        _tutor_fail(e)


@router.post("/{room_id}/agents/tutor/skip")
async def tutor_skip(room_id: str, request: Request, user: User = Depends(current_user),
                     _: Settings = Depends(require_rooms)):
    tutor, room = await _tutor_of(request, room_id, user)
    try:
        await tutor.skip(room.id, user.id)
    except TutorError as e:
        _tutor_fail(e)
    return {"ok": True}


@router.post("/{room_id}/agents/tutor/stop")
async def tutor_stop(room_id: str, request: Request, user: User = Depends(current_user),
                     _: Settings = Depends(require_rooms)):
    tutor, room = await _tutor_of(request, room_id, user)
    try:
        await tutor.stop(room.id, user.id)
    except TutorError as e:
        _tutor_fail(e)
    return {"ok": True}


@router.post("/{room_id}/agents/tutor/resume")
async def tutor_resume(room_id: str, request: Request, user: User = Depends(limited_user),
                       _: Settings = Depends(require_rooms)):
    tutor, room = await _tutor_of(request, room_id, user)
    try:
        return {"tutor": await tutor.resume(room.id, user.id)}
    except TutorError as e:
        _tutor_fail(e)
```

`server/tests/test_rooms_agents_contract.py` 的 `record` 改为(加带练两项;只有 bob 在线,所以点名 bob):

```python
def record(client) -> dict:
    room, alice, _, bob, _ = room_of(client)
    patch = client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach"]}, headers=alice).json()
    agents = client.get(f"/api/rooms/{room['id']}/agents", headers=bob).json()
    name = agents["agents"][0]["name"]
    ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=bob).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wb:
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        wb.send_text(json.dumps({"type": "say", "client_id": "q", "text": f"@{name} can I use abandon here?"}))
        events = until_answer(wb)
        trace = until(wb, "message")[-1]
        start = client.post(f"/api/rooms/{room['id']}/agents/tutor/start",
                            json={"persona_id": "builtin:coach", "steps": 3}, headers=alice).json()
        waiting = until_waiting(wb)[-1]
    first = {e["type"]: e for e in reversed(events)}
    return {"http": {"patch": patch, "agents": agents, "tutor_start": start},
            "ws": {"agent_step": first["agent_step"], "agent_thought": first["agent_thought"],
                   "message_agent_answer": events[-1], "message_agent_trace": trace, "agent_tutor": waiting}}
```

并在文件顶部加 `from tests.test_rooms_agent_tutor_api import until_waiting`。

- [ ] **Step 4: 重录与跑测试** — Run: `cd server && CONTRACT_UPDATE=1 uv run pytest -q tests/test_rooms_agents_contract.py && uv run pytest -q tests/test_rooms_agent_tutor_api.py tests/test_rooms_agents_contract.py tests/test_rooms_agents_api.py tests/test_rooms_agents_privacy.py tests/test_rooms_ws.py tests/test_architecture.py` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/app/routers/rooms_agents.py server/tests/test_rooms_agent_tutor_api.py server/tests/test_rooms_agents_contract.py server/tests/fixtures/rooms_agents_contract.json
git commit -m "feat(rooms): room tutor endpoints, restart pause and shutdown wiring; contract re-recorded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Lane A · 管理端

### Task A1: 房间详情里的智能体与带练(只读),过程记录不下发 `meta`

**Files:**
- Modify: `server/app/admin/rooms_admin.py`、`admin/src/features/rooms/api.ts`、`admin/src/features/rooms/room-detail-page.tsx`、`admin/src/features/rooms/strings.ts`、`admin/src/features/rooms/test-fixtures.ts`、`admin/src/features/rooms/room-detail-page.test.tsx`
- Test: `server/tests/test_admin_rooms_agents.py`

**Interfaces:**
- Produces(`GET /api/admin/rooms/{id}`):`agents: [{id, name, builtin, disabled, owner_id}]`、`tutor: {phase, step_index, steps_total, persona_id} | null`
- Changes:`admin_message_out` 对 `kind == "agent_trace"` 返回 `meta: null`(R-RA6)
- Consumes:A1 `app.agents.personas.builtin_personas()`、`app.models.AgentPersona`

- [ ] **Step 1: 写失败测试**

`server/tests/test_admin_rooms_agents.py`:

```python
"""Admin room detail shows the room's agents and tutor read-only (plan 2026-10-12-agents-rooms A1)."""
import json
from datetime import datetime, timezone

import pytest

from app.models import Room
from app.routers.rooms import runtime
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.test_admin_api import register

NOW = datetime(2026, 10, 12, 9, tzinfo=timezone.utc)
MISSING = "0b6c1f3e-2a4d-4c5e-9f00-1234567890ab"


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "rooms_enabled": True, "data_dir": str(tmp_path / "data")}


async def test_detail_lists_agents_and_tutor_and_hides_trace_meta(app, client):
    owner_id, ha = await register(client, "alice")
    room = (await client.post("/api/rooms", headers=ha, json={"topic": "面试"})).json()["room"]
    async with app.state.sessionmaker() as s:
        r = await s.get(Room, room["id"])
        r.agent_config = {"persona_ids": ["builtin:coach", MISSING], "chosen_by": owner_id}
        r.agent_tutor = {"phase": "await_answer", "step_index": 2, "steps_total": 8, "persona_id": "builtin:coach",
                         "run_id": "x", "machine": {"secret": "state"}}
        await s.commit()
    rt = runtime(app)
    async with rt.hub.lock(room["id"]):
        await rt.store.append(room["id"], lane="private", audience_id=owner_id, sender_kind="ai", sender_id=None,
                              kind="agent_trace", text="", now=NOW, reply_to=1,
                              meta={"trace": {"steps": [{"params": {"word": "abandon"}}]}})
    await login_as(app, client, "viewer")
    detail = (await client.get(f"/api/admin/rooms/{room['id']}")).json()
    assert [a["id"] for a in detail["agents"]] == ["builtin:coach"]  # a deleted persona drops out
    assert detail["agents"][0]["builtin"] is True and detail["agents"][0]["disabled"] is False
    assert detail["tutor"] == {"phase": "await_answer", "step_index": 2, "steps_total": 8, "persona_id": "builtin:coach"}
    timeline = (await client.get(f"/api/admin/rooms/{room['id']}/messages", params={"lane": "all"})).json()
    trace = next(m for m in timeline["messages"] if m["kind"] == "agent_trace")
    assert trace["meta"] is None and "abandon" not in json.dumps(timeline)


async def test_rooms_without_agents_show_empty(app, client):
    _, ha = await register(client, "alice")
    room = (await client.post("/api/rooms", headers=ha, json={"topic": "美食"})).json()["room"]
    await login_as(app, client, "viewer")
    detail = (await client.get(f"/api/admin/rooms/{room['id']}")).json()
    assert (detail["agents"], detail["tutor"]) == ([], None)
```

`admin/src/features/rooms/room-detail-page.test.tsx` 末尾追加:

```tsx
it("shows the room's agents and tutor read-only", async () => {
  vi.mocked(api.getRoom).mockResolvedValue(roomFixture({
    aiMuted: true,
    agents: [{ id: "builtin:coach", name: "Emma", builtin: true, disabled: false, ownerId: null },
      { id: "u1", name: "Leo", builtin: false, disabled: true, ownerId: 11111111 }],
    tutor: { phase: "await_answer", stepIndex: 2, stepsTotal: 8, personaId: "builtin:coach" },
  }));
  renderPage();
  const card = await screen.findByRole("region", { name: "智能体" });
  expect(within(card).getByText("Emma")).toBeInTheDocument();
  expect(within(card).getByText("内置")).toBeInTheDocument();
  expect(within(card).getByText("已停用")).toBeInTheDocument();
  expect(within(card).getByText("带练中 · 第 2/8 题")).toBeInTheDocument();
  expect(within(card).getByText("本房 AI 已禁用:智能体与带练也不会回答")).toBeInTheDocument();
  expect(within(card).queryByRole("button")).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_admin_rooms_agents.py`;`cd admin && yarn vitest run src/features/rooms` → FAIL

- [ ] **Step 3: 实现(服务端)** — `server/app/admin/rooms_admin.py`:

import 区:

```python
from app.agents.personas import builtin_personas
from app.models import AgentPersona, Room, RoomMember, RoomMessage, RoomReport, RoomVoice, User, iso_utc
```

`room_detail` 之前加:

```python
async def _agents_out(session, room: Room) -> list[dict]:
    """The room's agents for moderators: names and status only (prompts are reviewed on the admin agents page)."""
    raw = room.agent_config if isinstance(room.agent_config, dict) else {}
    builtin = {p.id: p for p in builtin_personas()}
    out = []
    for persona_id in raw.get("persona_ids") or []:
        if persona_id in builtin:
            out.append({"id": persona_id, "name": builtin[persona_id].name, "builtin": True, "disabled": False,
                        "owner_id": None})
            continue
        row = await session.get(AgentPersona, persona_id)
        if row is not None:
            out.append({"id": persona_id, "name": row.name, "builtin": False, "disabled": row.disabled_at is not None,
                        "owner_id": row.owner_id})
    return out


def _tutor_out(room: Room) -> dict | None:
    snap = room.agent_tutor if isinstance(room.agent_tutor, dict) else None
    if snap is None:
        return None
    return {"phase": snap.get("phase"), "step_index": snap.get("step_index"), "steps_total": snap.get("steps_total"),
            "persona_id": snap.get("persona_id")}
```

`room_detail` 返回字典里 `"settings": settings_out(room),` 之后加:

```python
            "agents": await _agents_out(session, room), "tutor": _tutor_out(room),
```

`admin_message_out` 中 `"text": m.text, "meta": m.meta,` 改为:

```python
            "text": m.text, "meta": None if m.kind == "agent_trace" else m.meta,  # process traces stay private (R-RA6)
```

- [ ] **Step 4: 实现(管理前端)**

`admin/src/features/rooms/api.ts` — `RoomDetail` 之前加类型,`RoomDetail` 加两个字段:

```ts
/** 房间里的智能体(plan 2026-10-12-agents-rooms A1):只读,人设原文在「智能体」页审核。 */
export interface RoomAgent { id: string; name: string; builtin: boolean; disabled: boolean; ownerId: number | null }
export interface RoomTutorState { phase: "generating" | "await_answer" | "paused" | null; stepIndex: number | null; stepsTotal: number | null; personaId: string | null }
```

```ts
export interface RoomDetail extends RoomRow {
  settings: RoomSettings;
  /** 旧服务端没有时为 undefined */
  agents?: RoomAgent[];
  tutor?: RoomTutorState | null;
```

(`RoomDetail` 其余字段不动。)

`admin/src/features/rooms/strings.ts` — `settings: {...}` 之后加:

```ts
  agents: {
    title: "智能体",
    empty: "房主没有选择智能体",
    builtin: "内置",
    disabled: "已停用",
    tutor: (step: number | null, total: number | null) => `带练中 · 第 ${step ?? 0}/${total ?? 0} 题`,
    tutorPaused: "带练已暂停",
    muted: "本房 AI 已禁用:智能体与带练也不会回答",
  },
```

并把 `detail.muteBody` 改为 `"@ai、助手私聊、智能体与带练在本房都会停止回答,直到恢复。"`(若 `room-detail-page.test.tsx` 断言了旧文案,同一提交里改那条断言)。

`admin/src/features/rooms/room-detail-page.tsx` — `SettingsCard` 之后加组件,并在 `<SettingsCard … />` 一行之后渲染 `<AgentsCard room={r} />`:

```tsx
const AG = S.agents;

/** 房间里的智能体与带练状态(只读;「禁用本房 AI」同时禁用它们,R-RA5)。 */
function AgentsCard({ room }: { room: RoomDetail }) {
  const agents = room.agents ?? [];
  const tutor = room.tutor ?? null;
  return (
    <section className="panel" aria-label={AG.title}>
      <div className="panel-head">
        <h2 className="text-sm font-semibold">{AG.title}</h2>
      </div>
      <div className="space-y-1.5 px-4 pb-3 text-sm">
        {agents.length === 0 ? <p className="text-fg-2">{AG.empty}</p> : agents.map((a) => (
          <div key={a.id} className="flex items-center gap-2">
            <span className="min-w-0 truncate font-medium">{a.name}</span>
            {a.builtin && <span className="badge">{AG.builtin}</span>}
            {a.disabled && <span className="badge bg-warn-soft text-warn">{AG.disabled}</span>}
          </div>
        ))}
        {tutor && <p className="text-fg-2">{tutor.phase === "paused" ? AG.tutorPaused : AG.tutor(tutor.stepIndex, tutor.stepsTotal)}</p>}
        {room.aiMuted && agents.length > 0 && <p className="text-warn">{AG.muted}</p>}
      </div>
    </section>
  );
}
```

`admin/src/features/rooms/test-fixtures.ts` — `roomFixture` 的默认值在 `reportCount: 1,` 之后加 `agents: [], tutor: null,`。

- [ ] **Step 5: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_admin_rooms_agents.py tests/test_admin_rooms.py tests/test_admin_rooms_v2.py tests/test_architecture.py`;`cd admin && yarn vitest run src/features/rooms` → PASS
- [ ] **Step 6: 提交**

```bash
git add server/app/admin/rooms_admin.py server/tests/test_admin_rooms_agents.py admin/src/features/rooms
git commit -m "feat(admin): room detail shows the room's agents and tutor read-only; agent traces stay private

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Lane W · 网页(`web/src/features/rooms/`)

### Task W0: `RoomPage` 懒加载(主包不增长,R-RA11)

**Files:**
- Create: `web/src/features/rooms/room-page-lazy.tsx`、`web/src/features/rooms/room-page-lazy.test.tsx`
- Modify: `web/src/features/rooms/index.ts`

**Interfaces:**
- Produces:`features/rooms` 公开面的 `RoomPage` 名字与签名不变(无参数组件),实现改为 `React.lazy(() => import("./room-page"))` + 自带 `Suspense`

- [ ] **Step 1: 写失败测试**

```tsx
// web/src/features/rooms/room-page-lazy.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RoomPage } from "./room-page-lazy";

vi.mock("./room-page", () => ({ RoomPage: () => <p>room view</p> }));

it("loads the room page lazily behind its own fallback", async () => {
  render(<RoomPage />);
  expect(screen.getByTestId("room-page-loading")).toHaveAttribute("aria-busy", "true");
  expect(await screen.findByText("room view")).toBeInTheDocument();
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd web && yarn vitest run src/features/rooms/room-page-lazy.test.tsx` → FAIL
- [ ] **Step 3: 实现**

```tsx
// web/src/features/rooms/room-page-lazy.tsx
import { lazy, Suspense } from "react";

/**
 * 房间页懒加载(plan 2026-10-12-agents-rooms R-RA11):房间页、助手、语音与智能体界面都不进主包(spec R-A2 的体积预算)。
 * 自带 Suspense,app.tsx 的路由不用改;占位与房间页同为可伸展的 flex 列,切换时不跳动。
 */
const Inner = lazy(() => import("./room-page").then((m) => ({ default: m.RoomPage })));

export function RoomPage() {
  return (
    <Suspense fallback={<div data-testid="room-page-loading" aria-busy="true" className="flex min-h-0 flex-1 flex-col" />}>
      <Inner />
    </Suspense>
  );
}
```

`web/src/features/rooms/index.ts` 的 `export { RoomPage } from "./room-page";` 改为 `export { RoomPage } from "./room-page-lazy";`。

- [ ] **Step 4: 跑测试与体积** — Run: `yarn web:typecheck && cd web && yarn vitest run src/features/rooms src/architecture.test.ts && cd .. && yarn web:build`;再跑 Task 0 Step 3 的 gzip 一行命令:主入口 `index-*.js` 的 gzip 字节数 **不大于** 基线(预期明显变小;把前后两个数字写进提交信息)。若变大:停下排查哪个模块仍被静态引入。若某个现有测试因 `RoomPage` 变成异步而失败(只可能是经 `index.ts` 渲染房间页的测试),把该断言改成 `findBy…`,同一提交。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/rooms/room-page-lazy.tsx web/src/features/rooms/room-page-lazy.test.tsx web/src/features/rooms/index.ts
git commit -m "perf(web): load the room page lazily so room features stay out of the main bundle

main entry gzip: <基线字节> -> <新字节>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(提交信息里的两个数字由执行者填实测值。)

---

### Task W1: 数据层(reducer、接口、`@名字`、倒计时、文案、契约)

**Files:**
- Create: `web/src/features/rooms/agents/{agent-meta.ts,room-agents-api.ts,mentions.ts,countdown.ts,use-room-agents.ts,fixtures.ts}`、测试 `agents/{agent-state.test.ts,room-agents-api.test.ts,mentions.test.ts,countdown.test.ts,room-agents-contract.test.ts,i18n.test.ts}`
- Modify: `web/src/features/rooms/room-state.ts`、`web/src/features/rooms/agents/i18n/{zh-CN,en}.json`(写成最终全集)

**Interfaces:**
- Produces(`room-state.ts`):`AgentRun { turnId; steps: AgentStepWire[]; thought: AgentThoughtWire | null; answerSeq: number | null }`;`RoomState` 新字段 `agentRuns: Record<number, AgentRun>`(键 = 提问 seq)、`agentTraces: Record<number, Record<string, unknown>>`(键 = 回复 seq)、`tutor: RoomTutorInfo | null`、`tutorAt: number`(收到 `agent_tutor` 的本地毫秒)
- Produces(`agent-meta.ts`):`AgentRef`、`AgentTutorMeta`、`AgentAnswerMeta`、`agentOf(m: RoomMessage): AgentAnswerMeta | null`
- Produces(`room-agents-api.ts`):`RoomAgent`、`RoomAgentsInfo`、`AgentReportReason`、`ROOM_AGENTS_SERVER_ERRORS`、`ROOM_AGENTS_ALL_ERRORS`、`fetchRoomAgents`、`updateRoomAgents`、`reportRoomAgent`、`startRoomTutor`、`skipRoomTutor`、`stopRoomTutor`、`resumeRoomTutor`
- Produces:`mentionsAgent(text, names) -> { index: number | null; question: string }`;`secondsLeft(tutor, receivedAt, now) -> number | null`;`useRoomAgents(api, roomId, agentIds, enabled) -> { info, refresh }`

- [ ] **Step 1: 写测试数据与失败测试**

`web/src/features/rooms/agents/fixtures.ts`(测试数据,不放进 `*.test.ts`):

```ts
import type { RoomInfo, RoomMessage, RoomTutorInfo } from "../protocol";
import type { RoomAgent } from "./room-agents-api";

export const ME = 12345678; // renderWithProviders' default user
export const EMMA: RoomAgent = { id: "builtin:coach", name: "Emma", intro: "英语教练", level: "B1", style: "friendly", builtin: true,
  promptPublic: true, prompt: "You are a patient coach.", disabled: false };
export const LEO: RoomAgent = { id: "u1", name: "Leo", intro: "点评官", level: "B2", style: "strict", builtin: false,
  promptPublic: false, prompt: null, disabled: false };
/** GET /api/rooms/r1/agents as the server sends it (snake_case). */
export const AGENTS_WIRE = { available: true, tutor: null, agents: [
  { id: "builtin:coach", name: "Emma", intro: "英语教练", level: "B1", style: "friendly", builtin: true, prompt_public: true, prompt: "You are a patient coach.", disabled: false },
] };
export const ROOM_INFO: RoomInfo = { id: "r1", code: "482913", topic: "面试", status: "open", locked: false, aiPublic: true, aiMuted: false,
  ownerId: ME, myRole: "owner", memberCount: 2, onlineCount: 2, createdAt: "", closedAt: null, name: "面试", scenario: "free", level: "B1",
  joinMode: "code", maxMembers: 4, allowVoice: true, agentIds: ["builtin:coach"] };
export const ROOM_WIRE = { id: "r1", code: "482913", topic: "面试", status: "open", locked: false, ai_public: true, ai_muted: false,
  owner_id: ME, my_role: "owner", member_count: 2, online_count: 2, created_at: "", closed_at: null, name: "面试", scenario: "free",
  level: "B1", join_mode: "code", max_members: 4, allow_voice: true, agent_ids: ["builtin:coach"] };
export const TUTOR: RoomTutorInfo = { personaId: "builtin:coach", personaName: "Emma", phase: "await_answer", stepIndex: 2, stepsTotal: 8,
  currentUserId: ME, currentName: "alice", deadlineAt: "2026-10-12T09:01:00Z", remainingMs: 42_000, startedBy: ME, pausedReason: null };
const BASE: RoomMessage = { seq: 1, id: "m1", lane: "public", kind: "text", sender: { kind: "user", id: 22, name: "bob" }, text: "hi",
  assisted: false, replyTo: null, aiStatus: null, meta: null, createdAt: "2026-10-12T09:00:00Z", quote: null, voice: null, reactions: [] };
export const msg = (over: Partial<RoomMessage>): RoomMessage => ({ ...BASE, id: `m${over.seq ?? 1}`, ...over });
export const answer = (seq: number, replyTo: number, meta: Record<string, unknown>, text = "Sure, try: I never abandon a project.") =>
  msg({ seq, kind: "ai_answer", replyTo, text, sender: { kind: "ai", id: null, name: null }, meta });
```

`web/src/features/rooms/agents/agent-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentStepWire } from "../protocol";
import { initialRoomState, roomReducer, type RoomState } from "../room-state";
import { answer, msg, TUTOR } from "./fixtures";

const step = (id: string, status: AgentStepWire["status"] = "done"): AgentStepWire =>
  ({ id, group: "context", key: "learned_words", status, labelKey: "agents.step.learned_words", private: true });
const fold = (s: RoomState, ...events: Parameters<typeof roomReducer>[1][]) => events.reduce(roomReducer, s);

describe("agents in the room reducer", () => {
  it("collects private steps per question, links the answer and keeps the trace", () => {
    let s = fold(initialRoomState(),
      { type: "event", event: { type: "agent_step", turnId: "t1", replyTo: 4, step: step("s1", "run") } },
      { type: "event", event: { type: "agent_step", turnId: "t1", replyTo: 4, step: step("s1") } },
      { type: "event", event: { type: "agent_thought", turnId: "t1", replyTo: 4, thought: { source: "summary", text: "x" } } });
    expect(s.agentRuns[4]).toEqual({ turnId: "t1", steps: [step("s1")], thought: { source: "summary", text: "x" }, answerSeq: null });
    s = fold(s, { type: "event", event: { type: "message", message: answer(5, 4, { agent: { personaId: "builtin:coach", name: "Emma" } }) } },
      { type: "event", event: { type: "message", message: msg({ seq: 6, lane: "private", kind: "agent_trace", replyTo: 5, text: "", meta: { trace: { steps: [] } } }) } });
    expect(s.agentRuns[4].answerSeq).toBe(5);
    expect(s.agentTraces[5]).toEqual({ steps: [] });
    expect(s.messages.map((m) => m.seq)).toEqual([5]); // the private trace never enters the public list
    expect(s.lastSeq).toBe(6);
  });

  it("a new turn for the same question starts a fresh run", () => {
    const s = fold(initialRoomState(),
      { type: "event", event: { type: "agent_step", turnId: "t1", replyTo: 4, step: step("s1") } },
      { type: "event", event: { type: "agent_step", turnId: "t2", replyTo: 4, step: step("s9") } });
    expect(s.agentRuns[4]).toMatchObject({ turnId: "t2", steps: [step("s9")] });
  });

  it("keeps the tutor with its receipt time; traces from history pages are kept too", () => {
    let s = fold(initialRoomState(), { type: "event", event: { type: "agent_tutor", tutor: TUTOR }, at: 1000 });
    expect([s.tutor, s.tutorAt]).toEqual([TUTOR, 1000]);
    s = fold(s, { type: "event", event: { type: "agent_tutor", tutor: null }, at: 2000 });
    expect(s.tutor).toBeNull();
    s = fold(s, { type: "prepend", messages: [msg({ seq: 2, lane: "private", kind: "agent_trace", replyTo: 1, text: "", meta: { trace: { n: 1 } } })] });
    expect(s.agentTraces[1]).toEqual({ n: 1 });
  });
});
```

`web/src/features/rooms/agents/mentions.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { mentionsAgent } from "./mentions";

const here = path.dirname(fileURLToPath(import.meta.url));
const F = JSON.parse(readFileSync(path.resolve(here, "../../../../../server/tests/fixtures/room_agent_mentions.json"), "utf8")) as {
  names: string[]; cases: { text: string; index: number | null; question: string }[] };

it.each(F.cases)("mentionsAgent($text) mirrors the server", ({ text, index, question }) => {
  expect(mentionsAgent(text, F.names)).toEqual({ index, question });
});
```

`web/src/features/rooms/agents/countdown.test.ts`:

```ts
import { expect, it } from "vitest";
import { secondsLeft } from "./countdown";
import { TUTOR } from "./fixtures";

it("counts down from the server's remaining time, not the client clock", () => {
  expect(secondsLeft(TUTOR, 10_000, 10_000)).toBe(42);
  expect(secondsLeft(TUTOR, 10_000, 12_100)).toBe(40);
  expect(secondsLeft(TUTOR, 10_000, 99_000)).toBe(0);
  expect(secondsLeft({ ...TUTOR, phase: "generating", remainingMs: null }, 0, 0)).toBeNull();
  expect(secondsLeft(null, 0, 0)).toBeNull();
});
```

`web/src/features/rooms/agents/room-agents-api.test.ts`:

```ts
import { expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { AGENTS_WIRE, ROOM_WIRE } from "./fixtures";
import { fetchRoomAgents, reportRoomAgent, resumeRoomTutor, skipRoomTutor, startRoomTutor, stopRoomTutor, updateRoomAgents } from "./room-agents-api";

it("talks to the room agents endpoints in snake_case", async () => {
  const tutor = { persona_id: "builtin:coach", persona_name: "Emma", phase: "generating", step_index: 0, steps_total: 5, current_user_id: null,
    current_name: null, deadline_at: null, remaining_ms: null, started_by: 1, paused_reason: null };
  const mock = createFetchMock({
    "GET /api/rooms/r1/agents": () => json(AGENTS_WIRE),
    "PATCH /api/rooms/r1": () => json({ room: ROOM_WIRE }),
    "POST /api/rooms/r1/agents/builtin%3Acoach/report": () => json({ ok: true }),
    "POST /api/rooms/r1/agents/tutor/start": () => json({ tutor }),
    "POST /api/rooms/r1/agents/tutor/skip": () => json({ ok: true }),
    "POST /api/rooms/r1/agents/tutor/stop": () => json({ ok: true }),
    "POST /api/rooms/r1/agents/tutor/resume": () => json({ tutor }),
  });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  expect((await fetchRoomAgents(api, "r1")).agents[0]).toMatchObject({ name: "Emma", promptPublic: true });
  expect((await updateRoomAgents(api, "r1", ["builtin:coach"])).agentIds).toEqual(["builtin:coach"]);
  expect(JSON.parse(String(mock.calls.at(-1)!.body))).toEqual({ agents: ["builtin:coach"] });
  await reportRoomAgent(api, "r1", "builtin:coach", "abuse");
  expect(JSON.parse(String(mock.calls.at(-1)!.body))).toEqual({ reason: "abuse" });
  expect((await startRoomTutor(api, "r1", "builtin:coach", 5)).stepsTotal).toBe(5);
  expect(JSON.parse(String(mock.calls.at(-1)!.body))).toEqual({ persona_id: "builtin:coach", steps: 5 });
  await skipRoomTutor(api, "r1");
  await stopRoomTutor(api, "r1");
  expect((await resumeRoomTutor(api, "r1")).personaName).toBe("Emma");
});
```

`web/src/features/rooms/agents/room-agents-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { parseRoomEvent, type AgentStepWire, type RoomEvent, type RoomMessage, type RoomTutorInfo } from "../protocol";
import { initialRoomState, roomReducer } from "../room-state";
import { agentOf } from "./agent-meta";
import type { RoomAgent } from "./room-agents-api";

/** server/tests/fixtures/rooms_agents_contract.json is recorded by server/tests/test_rooms_agents_contract.py. */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../../../server/tests/fixtures");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const C: { http: Record<string, any>; ws: Record<string, any> } = JSON.parse(readFileSync(path.join(root, "rooms_agents_contract.json"), "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const R: { ws: Record<string, any> } = JSON.parse(readFileSync(path.join(root, "rooms_contract.json"), "utf8"));
const keys = (r: Record<string, true>) => Object.keys(r).sort();
const wireKeys = (v: unknown) => Object.keys(camelcaseKeys(v as Record<string, unknown>, { deep: true })).sort();
const AGENT: Record<keyof RoomAgent, true> = { id: true, name: true, intro: true, level: true, style: true, builtin: true, promptPublic: true, prompt: true, disabled: true };
const STEP: Record<keyof AgentStepWire, true> = { id: true, group: true, key: true, status: true, labelKey: true, params: true, ms: true, private: true };
const TUTOR: Record<keyof RoomTutorInfo, true> = { personaId: true, personaName: true, phase: true, stepIndex: true, stepsTotal: true,
  currentUserId: true, currentName: true, deadlineAt: true, remainingMs: true, startedBy: true, pausedReason: true };
const ev = (raw: unknown) => parseRoomEvent(JSON.stringify(raw))!;

describe("room agents payloads (recorded from the real server)", () => {
  it("HTTP", () => {
    expect(wireKeys(C.http.agents)).toEqual(["agents", "available", "tutor"]);
    for (const a of C.http.agents.agents) expect(wireKeys(a)).toEqual(keys(AGENT));
    expect(C.http.patch.room.agent_ids).toEqual(["builtin:coach"]);
    expect(wireKeys(C.http.tutor_start.tutor)).toEqual(keys(TUTOR));
  });

  it("WebSocket frames", () => {
    const step = ev(C.ws.agent_step) as Extract<RoomEvent, { type: "agent_step" }>;
    expect(Object.keys(step.step).sort()).toEqual(keys(STEP));
    expect(ev(C.ws.agent_thought).type).toBe("agent_thought");
    const answer = (ev(C.ws.message_agent_answer) as { message: RoomMessage }).message;
    expect(agentOf(answer)).toMatchObject({ agent: { personaId: "builtin:coach" }, asker: { name: "bob" }, handoffFrom: null });
    const trace = (ev(C.ws.message_agent_trace) as { message: RoomMessage }).message;
    expect([trace.lane, trace.kind, trace.replyTo]).toEqual(["private", "agent_trace", answer.seq]);
    const tutor = ev(C.ws.agent_tutor) as Extract<RoomEvent, { type: "agent_tutor" }>;
    expect(Object.keys(tutor.tutor!).sort()).toEqual(keys(TUTOR));
  });

  it("the reducer folds them; welcome clears the tutor until the server re-sends it", () => {
    let s = initialRoomState();
    for (const name of ["agent_step", "agent_thought", "message_agent_answer", "message_agent_trace", "agent_tutor"]) {
      s = roomReducer(s, { type: "event", event: ev(C.ws[name]), at: 5 });
    }
    const answer = (ev(C.ws.message_agent_answer) as { message: RoomMessage }).message;
    expect(s.agentRuns[answer.replyTo!].answerSeq).toBe(answer.seq);
    expect(s.agentTraces[answer.seq]).toBeTruthy();
    expect([s.tutor?.phase, s.tutorAt]).toEqual(["await_answer", 5]);
    s = roomReducer(s, { type: "event", event: ev(R.ws.welcome) });
    expect(s.tutor).toBeNull();
  });
});
```

`web/src/features/rooms/agents/i18n.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { ROOM_AGENTS_SERVER_ERRORS } from "./room-agents-api";

type Dict = Record<string, unknown>;
const here = path.dirname(fileURLToPath(import.meta.url));
const load = (lng: string) => JSON.parse(readFileSync(path.join(here, "i18n", `${lng}.json`), "utf8")) as Dict;
const flat = (o: Dict, prefix = ""): string[] => Object.entries(o).flatMap(([k, v]) =>
  v && typeof v === "object" ? flat(v as Dict, `${prefix}${k}.`) : [`${prefix}${k}`]);
const get = (o: Dict, key: string) => key.split(".").reduce<unknown>((cur, k) => (cur as Dict | undefined)?.[k], o);

it("zh-CN and en have exactly the same keys", () => {
  expect(flat(load("en")).sort()).toEqual(flat(load("zh-CN")).sort());
});

it("every room-agents server error has copy in both languages", () => {
  for (const lng of ["en", "zh-CN"]) {
    for (const key of Object.values(ROOM_AGENTS_SERVER_ERRORS)) expect(get(load(lng), key), `${lng} ${key}`).toEqual(expect.any(String));
  }
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd web && yarn vitest run src/features/rooms/agents` → FAIL

- [ ] **Step 3: 实现**

`web/src/features/rooms/room-state.ts`:

import 行改为:

```ts
import type { ActivityState, AgentStepWire, AgentThoughtWire, JoinRequestInfo, ReactionInfo, RoomEvent, RoomInfo, RoomMemberInfo, RoomMessage, RoomTutorInfo } from "./protocol";
```

`AssistEntry` 之后加:

```ts
/** 一次智能体回合的私有过程(只有提问者收到;键是提问消息的 seq)。answerSeq:公共回复到达后填上。 */
export interface AgentRun { turnId: string; steps: AgentStepWire[]; thought: AgentThoughtWire | null; answerSeq: number | null }
```

`RoomState` 末尾(`protocol: number;` 之后)加:

```ts
  /** 联机智能体(plan 2026-10-12-agents-rooms):私有过程(键 = 提问 seq)、压缩过程(键 = 回复 seq)、带练状态与收到它的本地时间 */
  agentRuns: Record<number, AgentRun>;
  agentTraces: Record<number, Record<string, unknown>>;
  tutor: RoomTutorInfo | null;
  tutorAt: number;
```

`initialRoomState` 末尾加 `agentRuns: {}, agentTraces: {}, tutor: null, tutorAt: 0,`。`normalizeMessage` 之后加:

```ts
/** 私有 agent_trace 行(只属于本人):按它回复的公共消息 seq 存起来,刷新、重连、翻历史后过程胶囊仍可展开。 */
function withTraces(traces: RoomState["agentTraces"], incoming: RoomMessage[]): RoomState["agentTraces"] {
  let out = traces;
  for (const m of incoming) {
    if (m.lane !== "private" || m.kind !== "agent_trace" || m.replyTo === null) continue;
    const trace = (m.meta as { trace?: Record<string, unknown> } | null)?.trace;
    if (trace && out[m.replyTo] !== trace) out = { ...out, [m.replyTo]: trace };
  }
  return out;
}

function runFor(s: RoomState, replyTo: number, turnId: string): AgentRun {
  const run = s.agentRuns[replyTo];
  return run && run.turnId === turnId ? run : { turnId, steps: [], thought: null, answerSeq: null };
}
```

`welcome` 分支的返回对象加 `tutor: null,`(服务端在补发之后再发 `agent_tutor`)。`message` 分支改为:

```ts
    case "message": {
      const m = e.message;
      let messages = merge(s.messages, [m]);
      let aiTyping = s.aiTyping;
      let agentRuns = s.agentRuns;
      if (m.kind === "ai_answer" && m.replyTo !== null) {
        aiTyping = aiTyping.filter((x) => x !== m.replyTo);
        messages = messages.map((x) => (x.seq === m.replyTo ? { ...x, aiStatus: "done" as const } : x));
        const run = agentRuns[m.replyTo];
        if (run && run.answerSeq === null) agentRuns = { ...agentRuns, [m.replyTo]: { ...run, answerSeq: m.seq } };
      }
      const pending = s.pending.some((p) => p.seq === m.seq) ? s.pending.filter((p) => p.seq !== m.seq) : s.pending;
      const live = m.lane === "public" && m.seq > s.liveFrom && m.kind !== "system" && !(m.sender.kind === "user" && m.sender.id === s.me?.userId);
      return { ...s, messages, aiTyping, pending, announce: live ? m : s.announce, assist: pairReplayedReply(s.assist, m), lastSeq: Math.max(s.lastSeq, m.seq),
        agentRuns, agentTraces: withTraces(s.agentTraces, [m]) };
    }
```

S2 的占位分支替换为:

```ts
    case "agent_step": {
      const run = runFor(s, e.replyTo, e.turnId);
      return { ...s, agentRuns: { ...s.agentRuns, [e.replyTo]: { ...run, steps: [...run.steps.filter((x) => x.id !== e.step.id), e.step] } } };
    }
    case "agent_thought": {
      const run = runFor(s, e.replyTo, e.turnId);
      return { ...s, agentRuns: { ...s.agentRuns, [e.replyTo]: { ...run, thought: e.thought } } };
    }
    case "agent_tutor":
      return { ...s, tutor: e.tutor, tutorAt: at };
```

`roomReducer` 的 `prepend` 与 `history` 分支各加 `agentTraces: withTraces(s.agentTraces, a.messages),`(`history` 分支同时加 `tutor: null,`)。

`web/src/features/rooms/agents/agent-meta.ts`:

```ts
import type { RoomMessage } from "../protocol";

/** 公共智能体回复的 meta(服务端 R-RA2;经 camelcase-keys 后的形状)。 */
export interface AgentRef { personaId: string; name: string }
export interface AgentTutorMeta {
  stepIndex: number; stepsTotal: number; toUserId: number | null; toName: string | null; final: boolean;
  verdictFor: number | null; verdict: "good" | "ok" | "weak" | "skip" | null;
}
export interface AgentAnswerMeta { agent: AgentRef; asker: { id: number; name: string } | null; handoffFrom: AgentRef | null; tutor: AgentTutorMeta | null }

const ref = (v: unknown): AgentRef | null => {
  const r = v as Partial<AgentRef> | null | undefined;
  return r && typeof r.personaId === "string" && typeof r.name === "string" ? { personaId: r.personaId, name: r.name } : null;
};

/** 智能体回复 → 角色、提问者、接力来源、带练信息;普通 @ai 回复(meta 为空)与隐藏的消息返回 null。 */
export function agentOf(m: RoomMessage): AgentAnswerMeta | null {
  if (m.kind !== "ai_answer" || m.hidden || !m.meta) return null;
  const agent = ref(m.meta.agent);
  if (!agent) return null;
  const asker = m.meta.asker as { id?: unknown; name?: unknown } | undefined;
  const tutor = m.meta.tutor as AgentTutorMeta | undefined;
  return {
    agent,
    asker: asker && typeof asker.id === "number" && typeof asker.name === "string" ? { id: asker.id, name: asker.name } : null,
    handoffFrom: ref(m.meta.handoffFrom),
    tutor: tutor && typeof tutor.stepIndex === "number" ? tutor : null,
  };
}
```

`web/src/features/rooms/agents/room-agents-api.ts`:

```ts
import type { ApiClient } from "~/api/client";
import { ROOMS_ALL_SERVER_ERRORS } from "../create/rooms-v2-api";
import type { RoomInfo, RoomTutorInfo } from "../protocol";

/** GET /api/rooms/{id}/agents 的一项(成员视图;prompt 只在 promptPublic 时有值,spec D3)。 */
export interface RoomAgent {
  id: string; name: string; intro: string; level: string; style: string; builtin: boolean; promptPublic: boolean; prompt: string | null; disabled: boolean;
}
export interface RoomAgentsInfo { available: boolean; agents: RoomAgent[]; tutor: RoomTutorInfo | null }
export type AgentReportReason = "spam" | "abuse" | "other";

/** 服务端错误原文(routers/rooms_agents.py)→ i18n key。 */
export const ROOM_AGENTS_SERVER_ERRORS: Record<string, string> = {
  "Room tutor is running": "web.rooms.agents.errors.tutorActive",
  "Agent not found": "web.rooms.agents.errors.agentNotFound",
  "Room tutor is off": "web.rooms.agents.errors.tutorOff",
  "Not an agent of this room": "web.rooms.agents.errors.notAgent",
  "AI is off in this room": "web.rooms.agents.errors.aiOff",
  "Nobody online to practise with": "web.rooms.agents.errors.noParticipants",
  "Room tutor limit reached": "web.rooms.agents.errors.tutorQuota",
  "Nobody is being asked": "web.rooms.agents.errors.notWaiting",
  "Room tutor is not paused": "web.rooms.agents.errors.notPaused",
  "Room tutor not found": "web.rooms.agents.errors.tutorNotFound",
};
export const ROOM_AGENTS_ALL_ERRORS: Record<string, string> = { ...ROOMS_ALL_SERVER_ERRORS, ...ROOM_AGENTS_SERVER_ERRORS };

const rid = (id: string) => `/api/rooms/${encodeURIComponent(id)}`;

export function fetchRoomAgents(api: ApiClient, roomId: string, signal?: AbortSignal): Promise<RoomAgentsInfo> {
  return api.request<RoomAgentsInfo>("GET", `${rid(roomId)}/agents`, { signal });
}
/** 房主改智能体(最多 2 个;[] = 清空)。带练进行中 → 409 Room tutor is running。 */
export async function updateRoomAgents(api: ApiClient, roomId: string, ids: string[]): Promise<RoomInfo> {
  return (await api.request<{ room: RoomInfo }>("PATCH", rid(roomId), { json: { agents: ids } })).room;
}
export async function reportRoomAgent(api: ApiClient, roomId: string, personaId: string, reason: AgentReportReason): Promise<void> {
  await api.request("POST", `${rid(roomId)}/agents/${encodeURIComponent(personaId)}/report`, { json: { reason } });
}
export async function startRoomTutor(api: ApiClient, roomId: string, personaId: string, steps: number): Promise<RoomTutorInfo> {
  return (await api.request<{ tutor: RoomTutorInfo }>("POST", `${rid(roomId)}/agents/tutor/start`, { json: { personaId, steps } })).tutor;
}
export async function skipRoomTutor(api: ApiClient, roomId: string): Promise<void> {
  await api.request("POST", `${rid(roomId)}/agents/tutor/skip`, {});
}
export async function stopRoomTutor(api: ApiClient, roomId: string): Promise<void> {
  await api.request("POST", `${rid(roomId)}/agents/tutor/stop`, {});
}
export async function resumeRoomTutor(api: ApiClient, roomId: string): Promise<RoomTutorInfo> {
  return (await api.request<{ tutor: RoomTutorInfo }>("POST", `${rid(roomId)}/agents/tutor/resume`, {})).tutor;
}
```

`web/src/features/rooms/agents/mentions.ts`:

```ts
/** 与服务端 app/rooms/agent_mentions.agent_mention 相同(共用 server/tests/fixtures/room_agent_mentions.json);服务端是权威,这里只用于高亮与「正在回答」。 */
const SEP = String.raw`(?=$|[\s:：,，.!?！？])`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function mentionsAgent(text: string, names: string[]): { index: number | null; question: string } {
  const stripped = text.trim();
  if (!stripped.startsWith("@")) return { index: null, question: "" };
  const body = stripped.slice(1);
  const order = names.map((n, i) => [n.trim(), i] as const).filter(([n]) => n).sort((a, b) => b[0].length - a[0].length);
  for (const [name, i] of order) {
    const m = new RegExp(`^${escape(name)}${SEP}`, "iu").exec(body);
    if (m) {
      const question = body.slice(m[0].length).replace(/^[\s:：,，]*/u, "").trim();
      return question ? { index: i, question } : { index: null, question: "" };
    }
  }
  return { index: null, question: "" };
}
```

`web/src/features/rooms/agents/countdown.ts`:

```ts
import type { RoomTutorInfo } from "../protocol";

/** 剩余秒数:以服务端发出 agent_tutor 时的 remainingMs 为准,减去本地收到之后过去的时间(不依赖两端时钟一致)。 */
export function secondsLeft(tutor: RoomTutorInfo | null, receivedAt: number, now: number): number | null {
  if (!tutor || tutor.phase !== "await_answer" || tutor.remainingMs === null) return null;
  return Math.max(0, Math.ceil((tutor.remainingMs - Math.max(0, now - receivedAt)) / 1000));
}
```

`web/src/features/rooms/agents/use-room-agents.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "~/api/client";
import { fetchRoomAgents, type RoomAgentsInfo } from "./room-agents-api";

/** 房间智能体名单:agentIds 变化(room_update)或 refresh() 时重新读取;取不到就保持 null(界面不显示智能体信息)。 */
export function useRoomAgents(api: ApiClient, roomId: string, agentIds: readonly string[], enabled: boolean) {
  const key = agentIds.join(",");
  const [info, setInfo] = useState<RoomAgentsInfo | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled || !roomId) return;
    const ctrl = new AbortController();
    fetchRoomAgents(api, roomId, ctrl.signal).then(setInfo, (): void => undefined);
    return () => ctrl.abort();
  }, [api, roomId, key, enabled, nonce]);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { info, refresh };
}
```

`web/src/features/rooms/agents/i18n/zh-CN.json`(最终全集,覆盖 S2/S6 写入的内容):

```json
{
  "web": {
    "rooms": {
      "notice": { "agent_off": "这个智能体现在不可用" },
      "room": {
        "system": {
          "agents": "房主设置了智能体:{{names}}",
          "agents_off": "房主移除了智能体",
          "tutor_started": "{{name}} 开始带练",
          "tutor_stopped": "带练已结束",
          "tutor_done": "{{name}} 的带练结束了"
        }
      },
      "agents": {
        "tag": "智能体",
        "answeredFor": "{{name}} 已回答 · 对 {{asker}}",
        "handoff": "{{from}} → {{to}}",
        "typing": "{{name}} 正在回答…",
        "privateOnly": "仅你可见",
        "processLabel": "{{name}} 的思考过程",
        "section": {
          "title": "智能体",
          "hint": "最多选 2 个角色,成员用 @名字 提问。成员能看到角色名、简介,以及创建者公开的人设原文。",
          "add": "添加角色",
          "remove": "移除",
          "aiOff": "「群内 @AI」关闭时智能体也不会回答。",
          "duplicate": "这个角色已经选过了"
        },
        "sheet": {
          "prompt": "人设原文",
          "promptHidden": "创建者没有公开人设原文",
          "ask": "@{{name}} 提问",
          "report": "举报这个角色",
          "reported": "已举报,管理员会处理",
          "disabled": "已停用",
          "builtin": "内置",
          "reportReasons": { "spam": "垃圾内容", "abuse": "不当内容", "other": "其他" },
          "style": { "friendly": "友好", "strict": "严格", "humor": "幽默", "concise": "简洁" }
        },
        "tutor": {
          "title": "带练",
          "start": "开始带练",
          "steps": "{{count}} 题",
          "fewer": "少一题",
          "more": "多一题",
          "persona": "带练角色",
          "hint": "智能体会依次点名在线成员;60 秒没回答自动跳过,其他人可以随时补充。",
          "yourTurn": "轮到你了",
          "theirTurn": "轮到 {{name}}",
          "progress": "第 {{step}}/{{total}} 题",
          "generating": "{{name}} 正在出题…",
          "skip": "跳过",
          "stop": "结束带练",
          "resume": "继续",
          "secondsLeft": "剩余 {{count}} 秒",
          "paused": {
            "restart": "服务重启,带练已暂停",
            "quota": "今天的 AI 次数用完了,带练已暂停",
            "upstream": "AI 暂时不可用,带练已暂停",
            "ai_off": "本房 AI 已关闭,带练已暂停",
            "agent_off": "这个角色已停用,带练已暂停"
          }
        },
        "errors": {
          "tutorActive": "带练进行中,结束后再改智能体",
          "agentNotFound": "这个角色不在房间里",
          "tutorOff": "带练功能未开启",
          "notAgent": "请选择本房间的智能体",
          "aiOff": "本房 AI 已关闭",
          "noParticipants": "没有在线成员可以一起练",
          "tutorQuota": "今天的带练次数用完了",
          "notWaiting": "现在没有人在答题",
          "notPaused": "带练没有暂停",
          "tutorNotFound": "没有进行中的带练"
        }
      }
    }
  }
}
```

`web/src/features/rooms/agents/i18n/en.json`(同样的键;英文标签都很短,360 px 不换行溢出):

```json
{
  "web": {
    "rooms": {
      "notice": { "agent_off": "This agent is not available right now" },
      "room": {
        "system": {
          "agents": "The owner set the agents: {{names}}",
          "agents_off": "The owner removed the agents",
          "tutor_started": "{{name}} started a group practice",
          "tutor_stopped": "Group practice ended",
          "tutor_done": "{{name}} finished the group practice"
        }
      },
      "agents": {
        "tag": "Agent",
        "answeredFor": "{{name}} answered {{asker}}",
        "handoff": "{{from}} → {{to}}",
        "typing": "{{name}} is answering…",
        "privateOnly": "Only you can see this",
        "processLabel": "How {{name}} worked",
        "section": {
          "title": "Agents",
          "hint": "Pick up to 2 personas; members ask with @name. Members see the name, intro and any prompt its creator made public.",
          "add": "Add persona",
          "remove": "Remove",
          "aiOff": "Agents stay quiet while \"Group @AI\" is off.",
          "duplicate": "That persona is already picked"
        },
        "sheet": {
          "prompt": "Prompt",
          "promptHidden": "The creator keeps the prompt private",
          "ask": "Ask @{{name}}",
          "report": "Report this persona",
          "reported": "Reported. An admin will review it",
          "disabled": "Disabled",
          "builtin": "Built-in",
          "reportReasons": { "spam": "Spam", "abuse": "Inappropriate", "other": "Other" },
          "style": { "friendly": "Friendly", "strict": "Strict", "humor": "Humorous", "concise": "Concise" }
        },
        "tutor": {
          "title": "Practice",
          "start": "Start",
          "steps": "{{count}} Qs",
          "fewer": "One fewer question",
          "more": "One more question",
          "persona": "Practice persona",
          "hint": "The agent calls on online members in turn; no answer in 60 s skips. Anyone may chip in.",
          "yourTurn": "Your turn",
          "theirTurn": "{{name}}'s turn",
          "progress": "Q {{step}}/{{total}}",
          "generating": "{{name}} is asking…",
          "skip": "Skip",
          "stop": "End",
          "resume": "Resume",
          "secondsLeft": "{{count}} s left",
          "paused": {
            "restart": "Paused after a server restart",
            "quota": "Paused: today's AI limit is used up",
            "upstream": "Paused: AI is unavailable",
            "ai_off": "Paused: AI is off in this room",
            "agent_off": "Paused: this persona is disabled"
          }
        },
        "errors": {
          "tutorActive": "The room tutor is running; change agents after it ends",
          "agentNotFound": "That persona is not in this room",
          "tutorOff": "Group practice is turned off",
          "notAgent": "Pick one of this room's agents",
          "aiOff": "AI is off in this room",
          "noParticipants": "Nobody is online to practise with",
          "tutorQuota": "Today's practice limit is used up",
          "notWaiting": "Nobody is being asked right now",
          "notPaused": "The practice is not paused",
          "tutorNotFound": "No practice is running"
        }
      }
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过** — Run: `yarn web:typecheck && cd web && yarn vitest run src/features/rooms` → PASS
- [ ] **Step 5: 提交**

```bash
git add web/src/features/rooms/room-state.ts web/src/features/rooms/agents
git commit -m "feat(web): room agents data layer (private runs, traces, tutor state, API, @name mirror, copy)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task W2: 角色信息面板(名字、简介、公开时的人设原文、提问、举报)

**Files:**
- Create: `web/src/features/rooms/agents/persona-sheet.tsx`、`web/src/features/rooms/agents/persona-sheet.test.tsx`

**Interfaces:**
- Produces:`PersonaSheet({ open, onOpenChange, roomId, agent: RoomAgent | null, canAsk, onAsk(name) })`

- [ ] **Step 1: 写失败测试**

```tsx
// web/src/features/rooms/agents/persona-sheet.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { EMMA, LEO } from "./fixtures";
import { PersonaSheet } from "./persona-sheet";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
afterEach(async () => { vi.clearAllMocks(); localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

it("shows the public prompt, inserts an @mention and reports", async () => {
  const mock = createFetchMock({ "POST /api/rooms/r1/agents/builtin%3Acoach/report": () => json({ ok: true }) });
  const onAsk = vi.fn();
  renderWithProviders(<PersonaSheet open onOpenChange={() => {}} roomId="r1" agent={EMMA} canAsk onAsk={onAsk} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  expect(await screen.findByTestId("persona-prompt")).toHaveTextContent("You are a patient coach.");
  expect(screen.getByText("内置")).toBeInTheDocument();
  expect(screen.getByText("友好")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "@Emma 提问" }));
  expect(onAsk).toHaveBeenCalledWith("Emma");
  fireEvent.click(screen.getByRole("button", { name: "举报这个角色" }));
  fireEvent.click(screen.getByRole("button", { name: "不当内容" }));
  await waitFor(() => expect(JSON.parse(String(mock.calls.at(-1)!.body))).toEqual({ reason: "abuse" }));
  expect(await screen.findByRole("status")).toHaveTextContent("已举报,管理员会处理");
});

it("keeps a private prompt private and hides asking for a disabled persona", async () => {
  renderWithProviders(<PersonaSheet open onOpenChange={() => {}} roomId="r1" agent={{ ...LEO, disabled: true }} canAsk onAsk={vi.fn()} />);
  expect(await screen.findByText("创建者没有公开人设原文")).toBeInTheDocument();
  expect(screen.queryByTestId("persona-prompt")).toBeNull();
  expect(screen.getByText("已停用")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "@Leo 提问" })).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd web && yarn vitest run src/features/rooms/agents/persona-sheet.test.tsx` → FAIL
- [ ] **Step 3: 实现**

```tsx
// web/src/features/rooms/agents/persona-sheet.tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { ghostButton } from "../ui";
import { reportRoomAgent, ROOM_AGENTS_ALL_ERRORS, type AgentReportReason, type RoomAgent } from "./room-agents-api";

const REASONS: AgentReportReason[] = ["spam", "abuse", "other"];
const chip = "rounded-full px-2 py-0.5";

/**
 * 角色信息(spec D3 / §9.1):名字、简介、水平、风格;创建者公开时显示人设原文,否则说明「没有公开」。
 * 「@名字 提问」把提及插进输入框(不直接发送);举报走房间端点(成员 + 本房角色),同一角色本次只能举报一次。
 */
export function PersonaSheet({ open, onOpenChange, roomId, agent, canAsk, onAsk }: {
  open: boolean; onOpenChange(v: boolean): void; roomId: string; agent: RoomAgent | null; canAsk: boolean; onAsk(name: string): void;
}) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState<ReadonlySet<string>>(() => new Set());
  if (!agent) return null;
  const current = agent;
  async function report(reason: AgentReportReason) {
    try {
      await reportRoomAgent(api, roomId, current.id, reason);
      setReported((cur) => new Set(cur).add(current.id));
      setReporting(false);
      toast.success(t("web.rooms.agents.sheet.reported"));
    } catch (err) {
      toast.error(translateServerError(t, err, ROOM_AGENTS_ALL_ERRORS));
    }
  }
  return (
    <BottomSheet open={open} onOpenChange={(v) => { if (!v) setReporting(false); onOpenChange(v); }}>
      <BottomSheetContent className="max-h-[85dvh] overflow-y-auto">
        <BottomSheetHeader title={current.name} description={current.intro} />
        <div className="flex flex-wrap gap-1.5 text-label">
          {current.builtin && <span className={`${chip} bg-teal-tint text-teal`}>{t("web.rooms.agents.sheet.builtin")}</span>}
          {current.disabled && <span className={`${chip} bg-amber-tint text-amber`}>{t("web.rooms.agents.sheet.disabled")}</span>}
          <span className={`${chip} bg-surface-2 text-ink-2`}>{current.level}</span>
          <span className={`${chip} bg-surface-2 text-ink-2`}>{t(`web.rooms.agents.sheet.style.${current.style}`, { defaultValue: current.style })}</span>
        </div>
        <section className="mt-section">
          <h3 className="mx-0.5 mb-2 text-sub font-semibold text-ink-2">{t("web.rooms.agents.sheet.prompt")}</h3>
          {current.promptPublic && current.prompt ? (
            <p data-testid="persona-prompt" className="whitespace-pre-wrap break-words rounded-card border-[0.5px] border-hair bg-surface px-3 py-2.5 text-sub leading-dialogue text-ink">
              {current.prompt}
            </p>
          ) : <p className="mx-0.5 text-sub text-ink-2">{t("web.rooms.agents.sheet.promptHidden")}</p>}
        </section>
        <div className="mt-section space-y-2">
          {canAsk && !current.disabled && (
            <button type="button" className={ghostButton} onClick={() => { onAsk(current.name); onOpenChange(false); }}>
              {t("web.rooms.agents.sheet.ask", { name: current.name })}
            </button>
          )}
          {reported.has(current.id) ? (
            <p role="status" className="text-center text-sub text-ink-2">{t("web.rooms.agents.sheet.reported")}</p>
          ) : reporting ? REASONS.map((reason) => (
            <button key={reason} type="button" className={ghostButton} onClick={() => void report(reason)}>
              {t(`web.rooms.agents.sheet.reportReasons.${reason}`)}
            </button>
          )) : (
            <button type="button" className="tap-link block w-full text-center text-sub text-red" onClick={() => setReporting(true)}>
              {t("web.rooms.agents.sheet.report")}
            </button>
          )}
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}
```

- [ ] **Step 4: 跑测试确认通过** — Run: `yarn web:typecheck && cd web && yarn vitest run src/features/rooms/agents` → PASS
- [ ] **Step 5: 提交**

```bash
git add web/src/features/rooms/agents/persona-sheet.tsx web/src/features/rooms/agents/persona-sheet.test.tsx
git commit -m "feat(web): room persona sheet with public prompt, @ask and report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task W3: 房间设置里的「智能体」区(房主选择,成员查看)

**Files:**
- Create: `web/src/features/rooms/agents/agents-section.tsx`、`web/src/features/rooms/agents/agents-section.test.tsx`
- Modify: `web/src/features/rooms/room-settings-sheet.tsx`

**Interfaces:**
- Consumes:`PersonaPicker`(`~/features/agents`,A4;props `open`、`onOpenChange`、`selectedId`、`onSelect(persona)`)
- Produces:`RoomAgentsSection({ room, owner, live, onChanged })`

- [ ] **Step 1: 写失败测试**

```tsx
// web/src/features/rooms/agents/agents-section.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { RoomAgentsSection } from "./agents-section";
import { AGENTS_WIRE, ROOM_INFO, ROOM_WIRE } from "./fixtures";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));
vi.mock("~/features/agents", () => ({
  PersonaPicker: ({ open, onSelect }: { open: boolean; onSelect(p: { id: string; name: string }): void }) =>
    open ? <button type="button" onClick={() => onSelect({ id: "builtin:interviewer", name: "Max" })}>pick Max</button> : null,
}));

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
afterEach(async () => { vi.clearAllMocks(); localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

function setup(props: Partial<Parameters<typeof RoomAgentsSection>[0]> = {}) {
  const mock = createFetchMock({
    "GET /api/rooms/r1/agents": () => json(AGENTS_WIRE),
    "PATCH /api/rooms/r1": (call) => json({ room: { ...ROOM_WIRE, agent_ids: JSON.parse(String(call.body)).agents } }),
  });
  const onChanged = vi.fn();
  renderWithProviders(<RoomAgentsSection room={ROOM_INFO} owner live onChanged={onChanged} {...props} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return { mock, onChanged };
}
const patches = (mock: ReturnType<typeof createFetchMock>) =>
  mock.calls.filter((c) => c.url.pathname === "/api/rooms/r1").map((c) => JSON.parse(String(c.body)));

it("the owner adds a second persona and removes one", async () => {
  const { mock, onChanged } = setup();
  expect(await screen.findByText("Emma")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("room-agent-add-1"));
  fireEvent.click(screen.getByRole("button", { name: "pick Max" }));
  await waitFor(() => expect(patches(mock)).toEqual([{ agents: ["builtin:coach", "builtin:interviewer"] }]));
  expect(onChanged).toHaveBeenLastCalledWith(expect.objectContaining({ agentIds: ["builtin:coach", "builtin:interviewer"] }));
  fireEvent.click(screen.getByTestId("room-agent-remove-0"));
  await waitFor(() => expect(patches(mock).at(-1)).toEqual({ agents: [] }));
});

it("members only read the list and open the persona sheet", async () => {
  setup({ owner: false, room: { ...ROOM_INFO, aiPublic: false } });
  fireEvent.click(await screen.findByText("Emma"));
  expect(await screen.findByTestId("persona-prompt")).toHaveTextContent("You are a patient coach.");
  expect(screen.queryByTestId("room-agent-add-1")).toBeNull();
  expect(screen.queryByTestId("room-agent-remove-0")).toBeNull();
  expect(screen.getByText(/「群内 @AI」关闭时智能体也不会回答/)).toBeInTheDocument();
});

it("members of a room without agents see nothing", () => {
  setup({ owner: false, room: { ...ROOM_INFO, agentIds: [] } });
  expect(screen.queryByTestId("room-agents-section")).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd web && yarn vitest run src/features/rooms/agents/agents-section.test.tsx` → FAIL
- [ ] **Step 3: 实现**

```tsx
// web/src/features/rooms/agents/agents-section.tsx
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { PersonaPicker, type Persona } from "~/features/agents";
import { ROOM_AGENTS, type RoomInfo } from "../protocol";
import { PersonaSheet } from "./persona-sheet";
import { ROOM_AGENTS_ALL_ERRORS, updateRoomAgents, type RoomAgent } from "./room-agents-api";
import { useRoomAgents } from "./use-room-agents";

/**
 * 房间设置里的「智能体」(spec §9.2):房主最多选 ROOM_AGENTS.max 个角色(PersonaPicker 来自 ~/features/agents,只能选内置与自己的),
 * 每次改动即时保存(PATCH agents),失败 toast;成员只看名单,点名字看角色信息。没有角色的房间对成员不显示本区。
 */
export function RoomAgentsSection({ room, owner, live, onChanged }: {
  room: RoomInfo; owner: boolean; live: boolean; onChanged(room: RoomInfo): void;
}) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const ids = room.agentIds ?? [];
  const editable = owner && live;
  const { info, refresh } = useRoomAgents(api, room.id, ids, editable || ids.length > 0);
  const [picking, setPicking] = useState<number | null>(null);
  const [open, setOpen] = useState<RoomAgent | null>(null);
  const [busy, setBusy] = useState(false);
  if ((!editable && ids.length === 0) || (!owner && info?.available === false)) return null;
  const byId = new Map((info?.agents ?? []).map((a) => [a.id, a]));

  async function save(next: string[]) {
    setBusy(true);
    try {
      onChanged(await updateRoomAgents(api, room.id, next));
      refresh();
    } catch (err) {
      toast.error(translateServerError(t, err, ROOM_AGENTS_ALL_ERRORS));
    } finally {
      setBusy(false);
    }
  }
  function pick(slot: number, persona: Persona) {
    setPicking(null);
    if (ids.some((id, i) => id === persona.id && i !== slot)) {
      toast.error(t("web.rooms.agents.section.duplicate"));
      return;
    }
    const next = [...ids];
    next[slot] = persona.id;
    void save(next.filter(Boolean).slice(0, ROOM_AGENTS.max));
  }
  const slots = editable ? Array.from({ length: ROOM_AGENTS.max }, (_, i) => i) : ids.map((_, i) => i);

  return (
    <section data-testid="room-agents-section" className="mt-section">
      <h3 className="mx-0.5 mb-2 text-sub font-semibold tracking-[0.01em] text-ink-2">{t("web.rooms.agents.section.title")}</h3>
      <div className="divide-y-[0.5px] divide-hair-2 rounded-card border-[0.5px] border-hair bg-surface">
        {slots.map((slot) => {
          const id = ids[slot];
          if (!id) {
            return (
              <button key={`add-${slot}`} type="button" data-testid={`room-agent-add-${slot}`} disabled={busy || info?.available === false}
                className="flex min-h-row w-full items-center gap-2 px-3.5 text-body font-medium text-blue disabled:opacity-40"
                onClick={() => setPicking(slot)}>
                <PlusIcon aria-hidden className="size-4" />{t("web.rooms.agents.section.add")}
              </button>
            );
          }
          const agent = byId.get(id);
          return (
            <div key={id} className="flex min-h-row items-center gap-3 py-2 pl-3.5 pr-2">
              <button type="button" className="min-w-0 flex-1 text-left" disabled={!agent} onClick={() => agent && setOpen(agent)}>
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-body font-medium text-ink">{agent?.name ?? "…"}</span>
                  {agent?.disabled && <span className="flex-none rounded-full bg-amber-tint px-1.5 text-label text-amber">{t("web.rooms.agents.sheet.disabled")}</span>}
                </span>
                {agent?.intro && <span className="mt-0.5 block truncate text-meta text-ink-2">{agent.intro}</span>}
              </button>
              {editable && (
                <button type="button" data-testid={`room-agent-remove-${slot}`} aria-label={t("web.rooms.agents.section.remove")} disabled={busy}
                  className="inline-flex h-tap flex-none items-center rounded-[9px] px-2.5 text-ink-2 hover:bg-surface-2 disabled:opacity-40"
                  onClick={() => void save(ids.filter((x) => x !== id))}>
                  <XIcon aria-hidden className="size-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="mx-0.5 mt-1.5 text-meta text-ink-2">
        {t("web.rooms.agents.section.hint")}{!room.aiPublic && ` ${t("web.rooms.agents.section.aiOff")}`}
      </p>
      {editable && (
        <PersonaPicker open={picking !== null} onOpenChange={(v: boolean) => { if (!v) setPicking(null); }}
          selectedId={picking !== null ? ids[picking] ?? null : null} onSelect={(p: Persona) => { if (picking !== null) pick(picking, p); }} />
      )}
      <PersonaSheet open={open !== null} onOpenChange={(v) => { if (!v) setOpen(null); }} roomId={room.id} agent={open} canAsk={false} onAsk={() => {}} />
    </section>
  );
}
```

`web/src/features/rooms/room-settings-sheet.tsx` — import 加 `import { RoomAgentsSection } from "./agents/agents-section";`;在 `{owner && config && (<Group …><SettingsFields …/></Group>)}` 块之后加:

```tsx
          {config?.agentsAvailable !== false && (
            <RoomAgentsSection room={room} owner={owner} live={live} onChanged={onChanged} />
          )}
```

- [ ] **Step 4: 跑测试确认通过** — Run: `yarn web:typecheck && cd web && yarn vitest run src/features/rooms` → PASS(`room-settings-sheet.test.tsx` 不改仍绿:其房间没有 `agentIds`,成员视图不渲染本区;房主视图多出两个「添加角色」按钮,不影响原有断言)
- [ ] **Step 5: 提交**

```bash
git add web/src/features/rooms/agents/agents-section.tsx web/src/features/rooms/agents/agents-section.test.tsx web/src/features/rooms/room-settings-sheet.tsx
git commit -m "feat(web): owner picks up to two room agents in room settings; members read them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task W4: 消息渲染(角色标签、接力行、「已回答 · 对 X」、只给提问者的过程胶囊)

**Files:**
- Create: `web/src/features/rooms/agents/agent-answer.tsx`、`web/src/features/rooms/agents/agent-messages.test.tsx`
- Modify: `web/src/features/rooms/room-message-list.tsx`

**Interfaces:**
- Consumes:`ProcessCapsule`(`~/features/agents`,A4;props `steps`、`thought`、`trace`、`generating`、`label`)
- Produces:`AgentName`、`HandoffLine`、`AnsweredFor`、`PrivateProcess`;`RoomMessageListProps` 新增可选 `agentNames?: string[]`、`onOpenAgent?(personaId: string): void`

- [ ] **Step 1: 写失败测试**

```tsx
// web/src/features/rooms/agents/agent-messages.test.tsx
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { RoomMessageList } from "../room-message-list";
import { initialRoomState, type RoomState } from "../room-state";
import { answer, ME, msg } from "./fixtures";

vi.mock("~/features/agents", () => ({
  ProcessCapsule: (p: { generating: boolean; steps: unknown[]; trace: unknown }) =>
    <div data-testid="capsule" data-generating={String(p.generating)} data-steps={p.steps.length} data-trace={p.trace ? "yes" : "no"} />,
}));

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
afterEach(async () => { localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

const EMMA_META = { agent: { personaId: "builtin:coach", name: "Emma" } };
const question = (sender: number, name: string) => msg({ seq: 4, text: "@Emma can I use abandon?", sender: { kind: "user", id: sender, name }, aiStatus: "done" });
const step = { id: "s1", group: "context" as const, key: "learned_words", status: "done" as const, labelKey: "agents.step.learned_words", private: true };

function show(over: Partial<RoomState>, onOpenAgent = vi.fn()) {
  const state: RoomState = { ...initialRoomState(), status: "live", me: { userId: ME, role: "member" }, ...over };
  renderWithProviders(<RoomMessageList state={state} roomId="r1" reported={new Set()} autoText={false} onLoadEarlier={() => {}}
    onReport={() => {}} onReact={() => {}} onQuote={() => {}} onTranslateVoice={() => true} onRetryVoice={() => {}}
    agentNames={["Emma", "Leo"]} onOpenAgent={onOpenAgent} />);
  return onOpenAgent;
}

it("others see the agent tag and the answered-for line, never the process", () => {
  const onOpen = show({ messages: [question(22, "bob"), answer(5, 4, { ...EMMA_META, asker: { id: 22, name: "bob" } })],
    agentTraces: { 5: { steps: [] } } });
  expect(screen.getByText("智能体")).toBeInTheDocument();
  expect(screen.getByTestId("room-agent-answered")).toHaveTextContent("Emma 已回答 · 对 bob");
  expect(screen.queryByTestId("capsule")).toBeNull();
  fireEvent.click(screen.getByTestId("room-agent-name"));
  expect(onOpen).toHaveBeenCalledWith("builtin:coach");
});

it("the asker sees a private capsule live under the question while the agent answers", () => {
  show({ messages: [{ ...question(ME, "alice"), aiStatus: "pending" }], aiTyping: [4],
    agentRuns: { 4: { turnId: "t1", steps: [step], thought: null, answerSeq: null } } });
  expect(screen.getByText("仅你可见")).toBeInTheDocument();
  expect(screen.getByTestId("capsule")).toHaveAttribute("data-generating", "true");
  expect(screen.getByRole("status")).toHaveTextContent("Emma 正在回答…");
});

it("after the answer the asker's capsule uses the trace and no answered-for line is shown", () => {
  show({ messages: [question(ME, "alice"), answer(5, 4, { ...EMMA_META, asker: { id: ME, name: "alice" } })],
    agentRuns: { 4: { turnId: "t1", steps: [step], thought: null, answerSeq: 5 } }, agentTraces: { 5: { steps: [] } } });
  expect(screen.getByTestId("capsule")).toHaveAttribute("data-trace", "yes");
  expect(screen.getByTestId("capsule")).toHaveAttribute("data-generating", "false");
  expect(screen.queryByTestId("room-agent-answered")).toBeNull();
});

it("a hand-off shows the hand-off line; plain @ai answers keep the old card", () => {
  show({ messages: [question(22, "bob"), answer(5, 4, { ...EMMA_META, asker: { id: 22, name: "bob" } }),
    answer(6, 5, { agent: { personaId: "u1", name: "Leo" }, asker: { id: 22, name: "bob" }, handoffFrom: EMMA_META.agent }, "The grammar is right."),
    answer(7, 4, {}, "It means hello.")].map((m) => (m.seq === 7 ? { ...m, meta: null } : m)) });
  expect(screen.getByTestId("room-agent-handoff")).toHaveTextContent("Emma → Leo");
  expect(screen.getByText("AI 助手")).toBeInTheDocument();
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd web && yarn vitest run src/features/rooms/agents/agent-messages.test.tsx` → FAIL
- [ ] **Step 3: 实现**

```tsx
// web/src/features/rooms/agents/agent-answer.tsx
import { ArrowLeftRightIcon, LockIcon, SparklesIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProcessCapsule } from "~/features/agents";
import { cn } from "~/lib/cn";
import type { AgentRun } from "../room-state";
import type { AgentRef } from "./agent-meta";

/** 智能体回复卡片头部:角色名(点按看角色信息)+ 统一的「智能体」标签(R-RA12,spec 没有职称字段)。 */
export function AgentName({ agent, onOpen }: { agent: AgentRef; onOpen?(personaId: string): void }) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <button type="button" data-testid="room-agent-name" disabled={!onOpen} onClick={() => onOpen?.(agent.personaId)}
        className="min-w-0 truncate text-label font-semibold text-ink enabled:hover:underline">{agent.name}</button>
      <span className="flex-none rounded-full bg-teal-tint px-1.5 text-label text-teal">{t("web.rooms.agents.tag")}</span>
    </span>
  );
}

/** 接力提示(视觉稿第 4 屏 .handoff):A → B。 */
export function HandoffLine({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation();
  return (
    <p data-testid="room-agent-handoff" className="mb-1 flex items-center gap-1 self-start text-meta text-ink-2">
      <ArrowLeftRightIcon aria-hidden className="size-3.5" />{t("web.rooms.agents.handoff", { from, to })}
    </p>
  );
}

/** 给其他成员看的一行:「Emma 已回答 · 对 Lin」(不含提问者的个人数据,spec §5)。 */
export function AnsweredFor({ name, asker }: { name: string; asker: string }) {
  const { t } = useTranslation();
  return (
    <span data-testid="room-agent-answered" className="mt-0.5 flex items-center gap-1 text-label text-ink-2">
      <SparklesIcon aria-hidden className="size-3" />{t("web.rooms.agents.answeredFor", { name, asker })}
    </span>
  );
}

/** 只有提问者看得到的过程胶囊(琥珀色「仅你可见」);生成中展开、结束后折叠由 ProcessCapsule 负责(spec D1)。 */
export function PrivateProcess({ name, run, trace, generating, align }: {
  name: string; run?: AgentRun; trace?: Record<string, unknown>; generating: boolean; align: "start" | "end";
}) {
  const { t } = useTranslation();
  return (
    <div data-testid="room-agent-process" className={cn("mt-1 max-w-[92%]", align === "end" ? "self-end" : "self-start")}>
      <span className="mb-0.5 flex items-center gap-1 text-label font-semibold text-amber">
        <LockIcon aria-hidden className="size-3" />{t("web.rooms.agents.privateOnly")}
      </span>
      <ProcessCapsule steps={run?.steps ?? []} thought={run?.thought ?? null} trace={trace ?? null} generating={generating}
        label={t("web.rooms.agents.processLabel", { name })} />
    </div>
  );
}
```

`web/src/features/rooms/room-message-list.tsx`:

import 区加:

```tsx
import { AgentName, AnsweredFor, HandoffLine, PrivateProcess } from "./agents/agent-answer";
import { agentOf } from "./agents/agent-meta";
import { mentionsAgent } from "./agents/mentions";
```

`RoomMessageListProps` 末尾加:

```ts
  /** 联机智能体(plan 2026-10-12-agents-rooms):本房角色名(推出「Emma 正在回答…」)与点角色名打开角色信息 */
  agentNames?: string[];
  onOpenAgent?(personaId: string): void;
```

组件参数解构加 `agentNames, onOpenAgent`;`meId` 一行之后加:

```tsx
  const names = agentNames ?? [];
  /** 「正在输入」:被回复的是 @角色 的提问时显示角色名(ai_typing 不带角色字段,R-RA9) */
  const typingLabel = () => {
    const q = bySeq.get(state.aiTyping[state.aiTyping.length - 1]);
    const index = q && q.kind === "text" ? mentionsAgent(q.text, names).index : null;
    return index !== null ? t("web.rooms.agents.typing", { name: names[index] }) : t("web.rooms.room.aiTyping");
  };
```

`ai_answer` 分支整体替换为:

```tsx
    if (m.kind === "ai_answer") {
      const question = m.replyTo !== null ? bySeq.get(m.replyTo) : undefined;
      const agent = agentOf(m);
      const askedByMe = !!agent?.asker && agent.asker.id === meId;
      const trace = askedByMe ? state.agentTraces[m.seq] : undefined;
      const run = askedByMe && m.replyTo !== null ? state.agentRuns[m.replyTo] : undefined;
      return (
        <div key={m.id} data-seq={m.seq} data-message-id={m.id} className="flex w-full flex-col items-start">
          {agent?.handoffFrom && <HandoffLine from={agent.handoffFrom.name} to={agent.agent.name} />}
          <div className="flex max-w-[92%] gap-1">
          <div data-testid="room-message" data-kind="ai_answer" {...selectable(m)}
            className="min-w-0 rounded-card border-[0.5px] border-hair bg-surface px-3 py-2.5">
            {agent ? <AgentName agent={agent.agent} onOpen={onOpenAgent} />
              : <span className="block text-label font-semibold uppercase tracking-eyebrow text-ink-2">{t("web.rooms.room.aiName")}</span>}
            {agent?.asker && !askedByMe && <AnsweredFor name={agent.agent.name} asker={agent.asker.name} />}
            {question && (
              <p className="mt-1.5 line-clamp-2 border-l-2 border-hair pl-2 text-meta text-ink-2">{question.sender.name}: {question.text}</p>
            )}
            <AiAnswer text={m.text} />
          </div>
          {moreButton(m)}
          </div>
          {askedByMe && (trace || run) && <PrivateProcess name={agent!.agent.name} run={run} trace={trace} generating={false} align="start" />}
          {under(m, false, "start", false)}
        </div>
      );
    }
```

成员消息分支:在 `{under(m, mine, mine ? "end" : "start", !mine)}` 之前加(提问者自己的 `@角色` 提问在等待回复时显示实时胶囊):

```tsx
        {mine && m.aiStatus === "pending" && state.agentRuns[m.seq]?.answerSeq === null && (
          <PrivateProcess name={names[mentionsAgent(m.text, names).index ?? -1] ?? ""} run={state.agentRuns[m.seq]} generating align="end" />
        )}
```

列表末尾的「AI 正在输入」改为:

```tsx
      {state.aiTyping.length > 0 && (
        <p role="status" className="self-start text-meta text-ink-2">{typingLabel()}</p>
      )}
```

- [ ] **Step 4: 跑测试确认通过** — Run: `yarn web:typecheck && cd web && yarn vitest run src/features/rooms` → PASS(`room-message-list.test.tsx` 不改仍绿)
- [ ] **Step 5: 提交**

```bash
git add web/src/features/rooms/agents/agent-answer.tsx web/src/features/rooms/agents/agent-messages.test.tsx web/src/features/rooms/room-message-list.tsx
git commit -m "feat(web): agent answers in rooms with tag, hand-off line, answered-for line and an asker-only capsule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task W5: 带练界面(开始、轮到你了 + 倒计时、跳过/结束/继续、减少动态效果)

**Files:**
- Create: `web/src/features/rooms/agents/tutor-bar.tsx`、`web/src/features/rooms/agents/tutor-start.tsx`、`web/src/features/rooms/agents/tutor.test.tsx`
- Modify: `web/src/features/rooms/agents/agents-section.tsx`、`web/src/features/rooms/room-settings-sheet.tsx`

**Interfaces:**
- Produces:`TutorBar({ tutor, receivedAt, meId, isOwner, roomId, disabled })`;`TutorStart({ roomId, agents, onStarted })`;`RoomAgentsSection` 新增 `tutorAvailable: boolean`(房主、房间进行中、有可用角色、当前没有带练时显示 `TutorStart`)
- 常量:`TUTOR_STEPS = { min: 3, max: 12, initial: 8 }`(测试读取 `server/app/rooms/tutor_rotation.py` 核对)

- [ ] **Step 1: 写失败测试**

```tsx
// web/src/features/rooms/agents/tutor.test.tsx
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { EMMA, LEO, ME, TUTOR } from "./fixtures";
import { TutorBar } from "./tutor-bar";
import { TUTOR_STEPS, TutorStart } from "./tutor-start";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
afterEach(async () => { vi.useRealTimers(); vi.clearAllMocks(); localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

const ok = () => json({ ok: true });
function api(routes = {}) {
  const mock = createFetchMock({ "POST /api/rooms/r1/agents/tutor/skip": ok, "POST /api/rooms/r1/agents/tutor/stop": ok,
    "POST /api/rooms/r1/agents/tutor/resume": () => json({ tutor: null }), ...routes });
  return { mock, client: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
}

it("tells the called member it is their turn and counts down", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T09:00:00Z"));
  renderWithProviders(<TutorBar tutor={TUTOR} receivedAt={Date.now()} meId={ME} isOwner={false} roomId="r1" disabled={false} />);
  expect(screen.getByRole("status")).toHaveTextContent("轮到你了");
  expect(screen.getByText("第 2/8 题")).toBeInTheDocument();
  expect(screen.getByText("剩余 42 秒")).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(2_000); });
  expect(screen.getByText("剩余 40 秒")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "跳过" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "结束带练" })).toBeNull();
  // reduced motion: the ring only animates under motion-safe
  expect(screen.getByTestId("room-tutor-ring").getAttribute("class")).toContain("motion-safe:transition-[stroke-dashoffset]");
});

it("others see whose turn it is and the owner may skip them", async () => {
  const { mock, client } = api();
  renderWithProviders(<TutorBar tutor={{ ...TUTOR, currentUserId: 22, currentName: "bob" }} receivedAt={Date.now()}
    meId={ME} isOwner roomId="r1" disabled={false} />, { api: client });
  expect(screen.getByRole("status")).toHaveTextContent("轮到 bob");
  fireEvent.click(screen.getByRole("button", { name: "跳过" }));
  await waitFor(() => expect(mock.calls.at(-1)!.url.pathname).toBe("/api/rooms/r1/agents/tutor/skip"));
});

it("a paused round shows why; the owner resumes or ends it", async () => {
  const { mock, client } = api();
  renderWithProviders(<TutorBar tutor={{ ...TUTOR, phase: "paused", pausedReason: "restart", remainingMs: null }} receivedAt={0}
    meId={ME} isOwner roomId="r1" disabled={false} />, { api: client });
  expect(screen.getByRole("status")).toHaveTextContent("服务重启,带练已暂停");
  expect(screen.queryByTestId("room-tutor-countdown")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  await waitFor(() => expect(mock.calls.at(-1)!.url.pathname).toBe("/api/rooms/r1/agents/tutor/resume"));
  fireEvent.click(screen.getByRole("button", { name: "结束带练" }));
  await waitFor(() => expect(mock.calls.at(-1)!.url.pathname).toBe("/api/rooms/r1/agents/tutor/stop"));
});

it("renders nothing without a tutor", () => {
  const { container } = renderWithProviders(<TutorBar tutor={null} receivedAt={0} meId={ME} isOwner roomId="r1" disabled={false} />);
  expect(container.querySelector("[data-testid=room-tutor-bar]")).toBeNull();
});

it("the owner starts a round with a persona and a question count within the server's range", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const py = readFileSync(path.resolve(here, "../../../../../server/app/rooms/tutor_rotation.py"), "utf8");
  expect(py).toContain(`MIN_STEPS, MAX_STEPS, DEFAULT_STEPS = ${TUTOR_STEPS.min}, ${TUTOR_STEPS.max}, ${TUTOR_STEPS.initial}`);
  const { mock, client } = api({ "POST /api/rooms/r1/agents/tutor/start": () => json({ tutor: null }) });
  const onStarted = vi.fn();
  renderWithProviders(<TutorStart roomId="r1" agents={[EMMA, LEO]} onStarted={onStarted} />, { api: client });
  fireEvent.click(screen.getByRole("radio", { name: "Leo" }));
  fireEvent.click(screen.getByRole("button", { name: "少一题" }));
  expect(screen.getByTestId("room-tutor-steps")).toHaveTextContent("7 题");
  fireEvent.click(screen.getByRole("button", { name: "开始带练" }));
  await waitFor(() => expect(onStarted).toHaveBeenCalled());
  expect(JSON.parse(String(mock.calls.at(-1)!.body))).toEqual({ persona_id: "u1", steps: 7 });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd web && yarn vitest run src/features/rooms/agents/tutor.test.tsx` → FAIL
- [ ] **Step 3: 实现**

```tsx
// web/src/features/rooms/agents/tutor-start.tsx
import { MinusIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { cn } from "~/lib/cn";
import { smallGhostButton, smallPrimaryButton } from "../ui";
import { ROOM_AGENTS_ALL_ERRORS, startRoomTutor, type RoomAgent } from "./room-agents-api";

/** 与服务端 tutor_rotation.MIN_STEPS / MAX_STEPS / DEFAULT_STEPS 相同(测试读服务端文件核对)。 */
export const TUTOR_STEPS = { min: 3, max: 12, initial: 8 } as const;

/** 房主开启「带练」(spec §7.5):选带练角色(两个时)和题数,开始后由服务端点名在线成员。 */
export function TutorStart({ roomId, agents, onStarted }: { roomId: string; agents: RoomAgent[]; onStarted(): void }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const usable = agents.filter((a) => !a.disabled);
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [steps, setSteps] = useState<number>(TUTOR_STEPS.initial);
  const [busy, setBusy] = useState(false);
  if (!usable.length) return null;
  const chosen = usable.some((a) => a.id === personaId) ? personaId! : usable[0].id;
  async function start() {
    setBusy(true);
    try {
      await startRoomTutor(api, roomId, chosen, steps);
      onStarted();
    } catch (err) {
      toast.error(translateServerError(t, err, ROOM_AGENTS_ALL_ERRORS));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div data-testid="room-tutor-start" className="mt-2 rounded-card border-[0.5px] border-hair bg-surface px-3.5 py-3">
      <p className="text-body font-medium text-ink">{t("web.rooms.agents.tutor.title")}</p>
      <p className="mt-0.5 text-meta text-ink-2">{t("web.rooms.agents.tutor.hint")}</p>
      {usable.length > 1 && (
        <div role="radiogroup" aria-label={t("web.rooms.agents.tutor.persona")} className="mt-2 flex flex-wrap gap-1.5">
          {usable.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={a.id === chosen} onClick={() => setPersonaId(a.id)}
              className={cn("h-8 rounded-full px-3 text-sub", a.id === chosen ? "bg-blue text-on-blue" : "bg-surface-2 text-ink")}>{a.name}</button>
          ))}
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <button type="button" className={smallGhostButton} aria-label={t("web.rooms.agents.tutor.fewer")} disabled={steps <= TUTOR_STEPS.min}
          onClick={() => setSteps((n) => n - 1)}><MinusIcon aria-hidden /></button>
        <span data-testid="room-tutor-steps" className="min-w-[3.5rem] text-center text-sub tabular-nums text-ink">{t("web.rooms.agents.tutor.steps", { count: steps })}</span>
        <button type="button" className={smallGhostButton} aria-label={t("web.rooms.agents.tutor.more")} disabled={steps >= TUTOR_STEPS.max}
          onClick={() => setSteps((n) => n + 1)}><PlusIcon aria-hidden /></button>
        <button type="button" className={cn(smallPrimaryButton, "ml-auto")} disabled={busy} onClick={() => void start()}>
          {t("web.rooms.agents.tutor.start")}
        </button>
      </div>
    </div>
  );
}
```

```tsx
// web/src/features/rooms/agents/tutor-bar.tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { cn } from "~/lib/cn";
import { ROOM_AGENTS, type RoomTutorInfo } from "../protocol";
import { smallGhostButton } from "../ui";
import { secondsLeft } from "./countdown";
import { resumeRoomTutor, ROOM_AGENTS_ALL_ERRORS, skipRoomTutor, stopRoomTutor } from "./room-agents-api";

/** 等待作答时每秒刷新一次「现在」;不等待时不起计时器。 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/** 倒计时圆环:数字每秒更新;圆环的过渡只在 motion-safe 下(系统「减少动态效果」时不动画)。读屏只读 sr-only 的文字,不在 live 区里逐秒播报。 */
function Countdown({ seconds, urgent }: { seconds: number; urgent: boolean }) {
  const { t } = useTranslation();
  const r = 9;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(1, seconds / ROOM_AGENTS.tutorTurnSeconds)));
  return (
    <span data-testid="room-tutor-countdown" className="relative flex size-7 flex-none items-center justify-center">
      <svg aria-hidden viewBox="0 0 22 22" className="absolute inset-0 -rotate-90">
        <circle cx="11" cy="11" r={r} fill="none" strokeWidth="2" className="stroke-hair" />
        <circle data-testid="room-tutor-ring" cx="11" cy="11" r={r} fill="none" strokeWidth="2" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset}
          className={cn(urgent && seconds <= 10 ? "stroke-amber" : "stroke-blue",
            "motion-safe:transition-[stroke-dashoffset] motion-safe:duration-1000 motion-safe:ease-linear")} />
      </svg>
      <span aria-hidden className="text-label tabular-nums text-ink">{seconds}</span>
      <span className="sr-only">{t("web.rooms.agents.tutor.secondsLeft", { count: seconds })}</span>
    </span>
  );
}

/**
 * 带练条(输入条上方):第几题、轮到谁(轮到自己时蓝色「轮到你了」)、倒计时;被点名的人和房主可「跳过」,房主可「结束」,
 * 暂停时房主可「继续」。只有「轮到谁 / 暂停原因」在 live 区里(轮次变化时播报一次)。
 */
export function TutorBar({ tutor, receivedAt, meId, isOwner, roomId, disabled }: {
  tutor: RoomTutorInfo | null; receivedAt: number; meId: number | null; isOwner: boolean; roomId: string; disabled: boolean;
}) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const waiting = tutor?.phase === "await_answer";
  const now = useNow(waiting);
  const [busy, setBusy] = useState(false);
  if (!tutor) return null;
  const left = secondsLeft(tutor, receivedAt, now);
  const mine = waiting && tutor.currentUserId === meId;
  const label = tutor.phase === "paused" ? t(`web.rooms.agents.tutor.paused.${tutor.pausedReason ?? "upstream"}`)
    : tutor.phase === "generating" ? t("web.rooms.agents.tutor.generating", { name: tutor.personaName })
    : mine ? t("web.rooms.agents.tutor.yourTurn") : t("web.rooms.agents.tutor.theirTurn", { name: tutor.currentName ?? "?" });
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(translateServerError(t, err, ROOM_AGENTS_ALL_ERRORS));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div data-testid="room-tutor-bar" className={cn("mb-1.5 flex min-h-row items-center gap-2 rounded-card border-[0.5px] px-3 py-1.5 text-sub",
      mine ? "border-blue bg-blue-tint" : "border-hair bg-surface")}>
      <span className="flex-none font-semibold text-ink">{t("web.rooms.agents.tutor.title")}</span>
      <span className="flex-none tabular-nums text-ink-2">{t("web.rooms.agents.tutor.progress", { step: tutor.stepIndex, total: tutor.stepsTotal })}</span>
      <span role="status" aria-live="polite" className={cn("min-w-0 flex-1 truncate", mine ? "font-semibold text-blue" : "text-ink")}>
        {mine && <span aria-hidden className="mr-1 inline-block size-1.5 rounded-full bg-blue align-middle motion-safe:animate-pulse" />}{label}
      </span>
      {left !== null && <Countdown seconds={left} urgent={mine} />}
      {waiting && (mine || isOwner) && (
        <button type="button" className={smallGhostButton} disabled={busy || disabled} onClick={() => void act(() => skipRoomTutor(api, roomId))}>
          {t("web.rooms.agents.tutor.skip")}
        </button>
      )}
      {isOwner && tutor.phase === "paused" && (
        <button type="button" className={smallGhostButton} disabled={busy || disabled} onClick={() => void act(() => resumeRoomTutor(api, roomId))}>
          {t("web.rooms.agents.tutor.resume")}
        </button>
      )}
      {isOwner && (
        <button type="button" className={cn(smallGhostButton, "text-red")} disabled={busy || disabled} onClick={() => void act(() => stopRoomTutor(api, roomId))}>
          {t("web.rooms.agents.tutor.stop")}
        </button>
      )}
    </div>
  );
}
```

`agents-section.tsx`:参数加 `tutorAvailable`(类型 `tutorAvailable: boolean`),import 加 `import { TutorStart } from "./tutor-start";`;在说明文字 `<p …hint…>` 之后加:

```tsx
      {editable && tutorAvailable && !info?.tutor && (info?.agents.length ?? 0) > 0 && (
        <TutorStart roomId={room.id} agents={info!.agents} onStarted={refresh} />
      )}
```

`agents-section.test.tsx` 的 `setup` 渲染里加 `tutorAvailable={false}`。`room-settings-sheet.tsx` 的 `<RoomAgentsSection … />` 加 `tutorAvailable={!!config?.agentTutorAvailable}`。

- [ ] **Step 4: 跑测试确认通过** — Run: `yarn web:typecheck && cd web && yarn vitest run src/features/rooms` → PASS
- [ ] **Step 5: 提交**

```bash
git add web/src/features/rooms/agents web/src/features/rooms/room-settings-sheet.tsx
git commit -m "feat(web): room tutor start, your-turn bar with countdown, skip/end/resume, reduced motion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task W6: 房间页接线(Addendum AR-1)

**Files:**
- Modify: `web/src/features/rooms/room-page.tsx`
- Create: `web/src/features/rooms/agents/room-page-agents.test.tsx`

**Interfaces:**
- Consumes:W1 `useRoomAgents`、`agentOf`;W2 `PersonaSheet`;W4 `RoomMessageList` 的 `agentNames` / `onOpenAgent`;W5 `TutorBar`

- [ ] **Step 1: 写失败测试**

```tsx
// web/src/features/rooms/agents/room-page-agents.test.tsx
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { RoomPage } from "../room-page";
import { AGENTS_WIRE, ME, ROOM_WIRE } from "./fixtures";

vi.mock("~/features/agents", () => ({ ProcessCapsule: () => <div data-testid="capsule" />, PersonaPicker: (): null => null }));

class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(readonly url: string) { FakeWebSocket.last = this; queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  push(e: object) { act(() => this.onmessage?.({ data: JSON.stringify(e) })); }
}

const CONFIG = { enabled: true, ai_available: true, max_members: 8, max_text: 500, scenarios: [], levels: ["B1"], default_max_members: 4,
  name_max: 30, voice_available: false, max_voice_ms: 60000, summary_available: false, reactions: [], agents_available: true,
  agent_tutor_available: true, max_agents: 2 };
const TUTOR_WIRE = { persona_id: "builtin:coach", persona_name: "Emma", phase: "await_answer", step_index: 1, steps_total: 8,
  current_user_id: ME, current_name: "alice", deadline_at: "2026-10-12T09:01:00Z", remaining_ms: 60000, started_by: 22, paused_reason: null };

beforeEach(() => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  vi.stubGlobal("WebSocket", FakeWebSocket);
});
afterEach(async () => { vi.unstubAllGlobals(); localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

it("wires agent names, the persona sheet's @ask and the tutor bar into the room page", async () => {
  const mock = createFetchMock({
    "GET /api/rooms/config": () => json(CONFIG),
    "POST /api/rooms/r1/ticket": () => json({ ticket: "secret-ticket", expires_in: 60 }),
    "GET /api/rooms/r1/agents": () => json(AGENTS_WIRE),
  });
  renderWithProviders(<RoomPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/rooms/r/r1", path: "/rooms/r/:roomId" });
  await vi.waitFor(() => expect(FakeWebSocket.last).not.toBeNull());
  const ws = FakeWebSocket.last!;
  ws.push({ type: "welcome", room: { ...ROOM_WIRE, owner_id: 22, my_role: "member" }, me: { user_id: ME, role: "member" },
    members: [{ user_id: ME, name: "alice", role: "member", online: true }, { user_id: 22, name: "bob", role: "owner", online: true }],
    last_seq: 0, truncated: false, assist_history: [], protocol: 2, reactions: [], join_requests: [] });
  ws.push({ type: "message", message: { seq: 1, id: "m1", lane: "public", kind: "ai_answer", sender: { kind: "ai", id: null, name: null },
    text: "Sure.", assisted: false, reply_to: null, ai_status: null, created_at: "2026-10-12T09:00:00Z", hidden: false, quote: null, voice: null,
    reactions: [], meta: { agent: { persona_id: "builtin:coach", name: "Emma" }, asker: { id: 22, name: "bob" } } } });
  ws.push({ type: "agent_tutor", tutor: TUTOR_WIRE });
  expect(await screen.findByTestId("room-agent-answered")).toHaveTextContent("Emma 已回答 · 对 bob");
  expect(screen.getByTestId("room-tutor-bar")).toHaveTextContent("轮到你了");
  fireEvent.click(screen.getByTestId("room-agent-name"));
  fireEvent.click(await screen.findByRole("button", { name: "@Emma 提问" }));
  expect(screen.getByRole("textbox")).toHaveValue("@Emma ");
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd web && yarn vitest run src/features/rooms/agents/room-page-agents.test.tsx` → FAIL
- [ ] **Step 3: 实现** — `web/src/features/rooms/room-page.tsx`(冻结文件的例外,见 Addendum AR-1;只做下列接线,不放功能逻辑):

import 区加:

```tsx
import { agentOf } from "./agents/agent-meta";
import { PersonaSheet } from "./agents/persona-sheet";
import { TutorBar } from "./agents/tutor-bar";
import { useRoomAgents } from "./agents/use-room-agents";
```

`const voiceEnabled = …;` 一行之后加:

```tsx
  // 联机智能体(plan 2026-10-12-agents-rooms Addendum AR-1):角色名单、角色信息面板;带练条在输入条上方
  const agentIds = info?.agentIds ?? [];
  const { info: agentsInfo } = useRoomAgents(api, roomId, agentIds, agentIds.length > 0 && !ended);
  const agentNames = useMemo(() => (agentsInfo?.agents ?? []).map((a) => a.name), [agentsInfo]);
  const [agentSheet, setAgentSheet] = useState<string | null>(null);
```

`announceText` 里 `announced.kind === "ai_answer" ? t("web.rooms.room.aiName")` 改为 `announced.kind === "ai_answer" ? agentOf(announced)?.agent.name ?? t("web.rooms.room.aiName")`。

`<RoomMessageList …>` 末尾加 `agentNames={agentNames} onOpenAgent={setAgentSheet}`。

输入条 `above` 里 `<ActivityLine … />` 之后加:

```tsx
            <TutorBar tutor={state.tutor} receivedAt={state.tutorAt} meId={state.me?.userId ?? null} isOwner={isOwner} roomId={roomId} disabled={closed || offline} />
```

`<RoomSettingsSheet … />` 之后加:

```tsx
      <PersonaSheet open={agentSheet !== null} onOpenChange={(v) => { if (!v) setAgentSheet(null); }} roomId={roomId}
        agent={agentsInfo?.agents.find((a) => a.id === agentSheet) ?? null} canAsk={!closed}
        onAsk={(name) => { setDraft(`@${name} `); setTarget("group"); setVoiceMode("text"); }} />
```

- [ ] **Step 4: 跑测试确认通过** — Run: `yarn web:typecheck && cd web && yarn vitest run src/features/rooms src/architecture.test.ts && cd .. && yarn web:build` → PASS;再跑 Task 0 的 gzip 命令,主入口不大于 W0 提交时的数字。
- [ ] **Step 5: 提交**

```bash
git add web/src/features/rooms/room-page.tsx web/src/features/rooms/agents/room-page-agents.test.tsx
git commit -m "feat(web): wire room agents, persona sheet and tutor bar into the room page (Addendum AR-1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Final lane (Z)

### Task Z1: 文档(各层 `CLAUDE.md`、README 的未验证项)

**Files:**
- Modify: `server/app/rooms/CLAUDE.md`、`server/app/CLAUDE.md`、`server/app/routers/CLAUDE.md`、`server/tests/CLAUDE.md`、`web/src/features/rooms/CLAUDE.md`、`web/README.md`

- [ ] **Step 1: `server/app/rooms/CLAUDE.md`** — 首段末尾加一句:`Agents in rooms (plan 2026-10-12-agents-rooms, off unless AGENTS_ENABLED + AGENTS_ROOMS_ENABLED): owner-picked personas answer "@name" questions publicly, the process goes only to the asker, and an optional room tutor calls on members in turn.`;「What lives here」末尾加:

```markdown
- `agent_mentions.py` (pure: `@name` routing, hand-off detection; shared cases `tests/fixtures/room_agent_mentions.json`),
  `agent_config.py` (owner selection rule, member view, `chosen_by` resolution), `agent_lane.py` (`AgentLane`: admission
  shared with `@ai`, `run_turn(in_room=True)`, private `agent_step`/`agent_thought`, public `ai_answer` with
  `meta.agent`, private `agent_trace` row, one hand-off), `tutor_rotation.py` (pure), `agent_tutor.py` (`RoomTutor`:
  60 s turns, snapshot in `rooms.agent_tutor`, pause on restart; A3 adapter block)
```

「Allowed dependencies」改为:`app.core`, `app.models`, `app.providers`, `app.speech`, `app.services`, `app.agents` (agents never import rooms). Never `rank`, `realtime`, `admin` or `routers`. 并补 `Endpoints and lifespan hooks: …, rooms_agents.py`。「Tests」的命令不变(`test_rooms_*.py` 已覆盖),夹具清单加 `rooms_agents_contract.json`、`room_agent_mentions.json`。「Pitfalls」末尾加:

```markdown
- Agent process frames and `agent_trace` rows belong to the asker only (`only_user` / private lane); never put a trace
  or a step into public `meta`. `assist_history` reads only assist kinds so traces do not crowd it out.
- `@ai` always wins over `@persona`; rooms without `agent_config` must keep identical frames (existing tests pin it).
- Agent turns share the room AI lock, the AI queue cap and `room_ai_global` with `@ai`; `ai_muted` / `ai_public=false`
  silence agents and the tutor too. `AGENTS_TURNS_*` is counted inside `run_turn` (Error `limit` → refund + `quota`).
- The room tutor's timers are not hub tasks (`hub.drain()` must not wait 60 s) and do not survive a restart: running
  tutors become `paused` (`restart`) at startup. Persona names and prompts are user text: never log them.
```

- [ ] **Step 2: `server/app/CLAUDE.md`** — 表格 `rooms/` 一行末尾加「; agents in rooms (`agent_*`, `tutor_rotation`)」;「Allowed dependencies」的 `rank, rooms -> …` 一行改为 `rank -> core, models, providers, speech, services; rooms -> the same plus agents; never each other or realtime`(与 A1 的 agents 行一致,若 A1 已改则核对措辞);Pitfalls 的迁移链头改为 `head 0017`。
- [ ] **Step 3: `server/app/routers/CLAUDE.md`** — 列表里 `rooms (...)` 之后加 `rooms_agents` (/api/rooms/{id}/agents*: member view, report, room tutor; `install` is a rooms extension); Pitfalls 加:`rooms_agents.install` reads `app.state.agent_turn_deps` per turn and filters private sources itself when `share_in_rooms=false`.
- [ ] **Step 4: `server/tests/CLAUDE.md`** — fixtures 一行加 `room_agent_mentions.json`、`rooms_agents_contract.json`(recorded by `test_rooms_agents_contract.py`, `CONTRACT_UPDATE=1`)。
- [ ] **Step 5: `web/src/features/rooms/CLAUDE.md`** — 「What lives here」加 `agents/` 一行(数据层、角色信息、设置区、回复渲染、带练条;只经 `~/features/agents` 用 `PersonaPicker`/`ProcessCapsule`);「Slots」段落末尾加一句「`room-page.tsx` 的第四个例外:Addendum AR-1(智能体接线)」;「Public surface」注明 `RoomPage` 是懒加载包装(`room-page-lazy.tsx`);「Pitfalls」加:过程胶囊与 `agent_trace` 只属于提问者(reducer 以 `agentRuns`/`agentTraces` 保存,不进公共列表);带练倒计时用服务端 `remainingMs` + 本地收到时间,不比较两端时钟;`ai_typing` 不带角色名,「Emma 正在回答…」由被回复消息的 `@名字` 推出。
- [ ] **Step 6: `web/README.md`** — 在联机段落加「联机智能体与带练」小节,列出未验证项(见下方验证矩阵的「未验证」列)。
- [ ] **Step 7: 提交**

```bash
git add server/app/rooms/CLAUDE.md server/app/CLAUDE.md server/app/routers/CLAUDE.md server/tests/CLAUDE.md web/src/features/rooms/CLAUDE.md web/README.md
git commit -m "docs: agents in rooms (layers, pitfalls, fixtures, unverified items)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task Z2: 合并验收

- [ ] **Step 1:** `cd server && uv run pytest -q`(全量,~2.5 min;受限时按文件分两半);`yarn web:typecheck && yarn web:test && yarn web:build`;`cd admin && yarn vitest run`。
- [ ] **Step 2:** 体积:Task 0 的 gzip 命令,主入口 ≤ 基线(W0 起应更小);把三个数字(基线、W0 后、Z2)写进本文件末尾的 `## Addendum (日期) · 验收记录`。
- [ ] **Step 3:** `/code-review high`(整个计划的改动);`security-review`(私有事件、举报/带练端点越权、提示词注入面、日志)。
- [ ] **Step 4:** 本地手动(浏览器窗格 375×812,`yarn web:dev` + 本地服务端 + 假上游或真实上游):两个账号进同一房间,`@角色` 提问 → 提问者看到「仅你可见」胶囊、另一人只看到「已回答 · 对 X」;开启带练 → 被点名者「轮到你了」倒计时、另一人补充不推进、60 秒自动跳过;系统「减少动态效果」打开时圆环不动画。实际做了哪几项、没做哪几项,如实写进验收记录。
- [ ] **Step 5:** 只有全部绿色才勾选本计划的复选框(docs/CLAUDE.md 约定)。

---

## Addendum AR-1 · `room-page.tsx` 冻结规则的例外(W6)

`room-page.tsx` 在 rooms-v2 F5 之后冻结(只接线)。联机智能体需要三处接线:角色名单与角色信息面板(`useRoomAgents` + `PersonaSheet`,「@名字 提问」要写输入框草稿,草稿状态只在页面里)、带练条(放进输入条的 `above` 插槽)、读屏播报里的角色名。这些都无法从现有插槽完成(插槽拿不到 `setDraft`)。W6 只加上述四段接线代码,功能逻辑全在 `agents/`。代价:页面多 1 个 hook 与 1 个面板;若之后再有车道需要改页面,沿用同样的 Addendum 流程。

---

## 验证矩阵

| 需求(spec) | 自动化测试 | 手动 / 未验证 |
|---|---|---|
| 房主最多选 2 个角色,规则与管理员编辑同一条(§9.2) | `test_rooms_agents_rules.py`、`test_rooms_agents_pure.py::test_validate_owner_rule`、`test_rooms_agents_api.py::test_selection_errors`、`agents-section.test.tsx` | — |
| 成员看到名字/简介/公开人设(D3)、举报(§9.1) | `test_rooms_agents_api.py::{test_owner_sets…,test_report…}`、`persona-sheet.test.tsx` | — |
| `@名字` 路由,`@ai` 与无角色房间不变 | `test_rooms_agents_pure.py`(共用样例)、`mentions.test.ts`、`test_rooms_agents_lane.py::{test_rooms_without_agents…,test_unknown_names…}`、未改动的 `test_rooms_connection.py`/`test_rooms_ws.py`/`test_rooms_prompts_*.py` | — |
| 过程只给提问者(§5、§9.2) | `test_rooms_agents_lane.py::test_mention_runs…`、`test_rooms_agents_ws.py`、`agent-messages.test.tsx` | 真实反向代理下私有帧的到达顺序 **未验证** |
| `share_in_rooms`、`show_process`、记忆只来自提问者直接提问(§8.3) | `test_rooms_agents_lane.py::{test_share_in_rooms…,test_hand_off…}` | A1 是否也过滤私有来源 **由 A1 测试覆盖**,此处只验证房间侧过滤 |
| 成本两套上限取严(§9.2)、`ai_muted`/`ai_public` | `test_rooms_agents_lane.py::{test_gates…,test_queue_cap…,test_agents_turn_limit…}` | 真实上游计费 **未验证** |
| 一房一个 AI 回合、超时 | `test_rooms_agents_lane.py::{test_one_agent_turn…,test_a_hanging_turn…}` | — |
| 接力深度 1(§9.2) | `test_rooms_agents_lane.py::test_hand_off_runs_once…`、`agent-messages.test.tsx` | — |
| 带练:点名、补充、60 秒跳过、收尾、停止、重启暂停、继续(§7.5) | `test_rooms_tutor_rotation.py`、`test_rooms_agent_tutor.py`、`test_rooms_agent_tutor_api.py`、`tutor.test.tsx`、`room-page-agents.test.tsx` | 真实 60 秒等待、多设备同时作答、多 worker **未验证**;A3 状态机的难度自适应只做了 2 题的方向检查 |
| 协议加法与契约 | `test_rooms_agents_protocol.py`、`protocol.test.ts`、`rooms-contract.test.ts`、`test_rooms_agents_contract.py` + `room-agents-contract.test.ts` | — |
| 隐私日志(§11.5) | `test_rooms_agents_lane.py::test_logs…`、`test_rooms_agent_tutor.py::test_tutor_logs…`、`test_rooms_agents_privacy.py` | — |
| 管理端只读、禁用 AI 同时禁用智能体 | `test_admin_rooms_agents.py`、`room-detail-page.test.tsx` | — |
| 迁移 0017 | `test_migrations.py::test_0017…`、`test_models_match_migrations` | Postgres 路径(`TEST_DATABASE_URL`)**未在本机验证**,`JSON(none_as_null=True)` 的 `IS NULL` 查询在 Postgres 上需跑一次 |
| 主包体积 | Task 0/W0/Z2 的 gzip 对比 | — |
| i18n、360–375 px | `agents/i18n.test.ts` | 英文标签在 360 px 真机不溢出 **未验证**(只在浏览器窗格 375×812 看过则写明) |
| 减少动态效果、读屏 | `tutor.test.tsx`(类名) | iOS/Android 真机、VoiceOver/TalkBack **未验证** |

## 不做

- 智能体回复的公共流式输出(只发最终消息,R-RA14);新增 `agent_delta` 事件。
- 语音消息触发智能体或作为带练回答(语音只算补充)。
- `@` 自动补全、输入条占位文案改动(视觉稿第 4 屏的「发消息,@ 提到智能体…」)。
- 创建房间时选智能体(只在房间设置里选)。
- 管理员在房间页修改智能体或带练;管理端在房间页查看人设原文(在 A1 的「智能体」页审核)。
- 角色职称标签(spec 没有字段,R-RA12)。
- 带练进段位 / 学习联动(spec §7.4 第一阶段不接);带练总结卡、带练结果写入记忆或回顾。
- 重启后自动续跑带练计时(改为暂停,R-RA8);多进程 / 多 worker 下的带练与 AI 锁。
- 成员「不想被点名」的个人开关;按成员水平分别出题。
- 房间的 `agent_thread_states` 短期摘要(R-RA15)。
- `AGENTS_TOOLS_MODE=native` 在房间里的单独处理(沿用 A1 的行为)。

## 规格问题(已裁定,未改 spec)

1. 视觉稿第 5 屏写「房间成员会看到角色名和简介,看不到人设原文」,与 D3/§9.1(`prompt_public` 时可见)冲突 → R-RA13 按 spec。
2. 视觉稿第 4 屏有「面试官」等职称标签,§4.2 没有对应字段 → R-RA12。
3. §5 只要求 `private=true` 的步骤只给提问者,§9.2 要求「过程只发给提问者」→ R-RA6 取后者。
4. §9.2「接力深度最多 1 层,不自动连环触发」可读作「A 只建议、不自动触发 B」→ R-RA7 读作「A 的建议自动触发 B 一次」,B 不再触发。
5. R-A2(主包 ≤ 0.2 kB)与现状冲突:`RoomPage` 在主包里,任何房间侧改动都会计入 → R-RA11 懒加载房间页。
6. §7.5 没说房间带练的计费对象、私有数据与记忆 → R-RA8。
7. §8.1 说短期状态按 `room_id` 存 `agent_thread_states`,但没有说谁写、谁的 `memory_enabled` 生效 → R-RA15。
8. §4.4 的回合请求以 `conversation_id` 为必填、历史由客户端给;房间回合没有对话、历史由服务端从房间消息构造 → 本计划按 §13 的 `TurnRequest(room_id, conversation_id=None)` 调用。

## Cross-plan assumptions

本计划消费下列接口(Task 0 Step 2 逐条核对;不一致时写 Addendum,只改列出的调用处)。

**A1 agents-core**
- A1-1 `app.agents.orchestrator`:`TurnRequest(user_id, persona, conversation_id, room_id, text, history, mode, tutor_session_id, client_turn_id, in_room)` 关键字构造,`conversation_id=None` 合法,`mode ∈ {"chat","tutor"}`;`async run_turn(deps, req)` 是异步生成器,内部负责 `AGENTS_TURNS_*` 计数并以 `Error(code="limit")` 拒绝;`TurnDeps` 是 dataclass,含 `registry`、`hooks`、`modes`(dict:模式名 → ModeHandler),可用 `dataclasses.replace`;`TurnHooks(after_turn=[...])`;`ModeBlock(text: str, max_tokens: int | None)`;ModeHandler 协议 `name` / `async prepare(req)` / `stream_filter()`(返回 `None` 表示不过滤)/ `async finish(req, full_text)`;run_turn 以传入的 `modes[req.mode]` 为准(房间传入自己的 `chat` 与 `tutor`)。消费处:`agent_lane.py`、`agent_tutor.py`、`rooms_agents.install`。
- A1-2 `app.agents.trace`:`Step(id, group, key, status, label_key, params, ms, private)`、`Thought(source, text)`、`Delta(text)`、`Meta(**fields)`、`Done(usage, trace, text_len)`、`Error(code)` 关键字构造;`.to_dict()` 返回 spec §4.4 表格里的 data(若含 `type` 键,房间会去掉)。消费处:`agent_lane._private`、两个 lane 的事件循环、全部测试替身。
- A1-3 `app.agents.context.SourceRegistry()` 有 `register(source)` 与 `sources() -> list`,来源有 `private: bool`。消费处:`rooms_agents._public_only`。
- A1-4 `app.agents.personas.PersonaStore(sessionmaker)`:`async get(user_id, persona_id)`(内置角色对任何用户返回;自建角色只对所有者返回;被停用的也返回,带 `disabled_at`)、`async report(reporter_id, persona_id, reason)`;`builtin_personas()`;persona 对象有 `id, owner_id, name, intro, prompt, level, style, prompt_public, disabled_at`。内置 id 至少含 `builtin:coach`、`builtin:interviewer`(测试用)。消费处:`agent_config.py`、`rooms_agents.py`、`rooms_admin._agents_out`、API 测试。
- A1-5 `app.agents.settings.load(session, user_id)` 返回带 `share_in_rooms`、`memory_enabled`、`show_process` 的对象。消费处:`rooms_agents.install.prefs`。
- A1-6 `app.state.agent_turn_deps`(基础 `TurnDeps`,`main.py` 生命周期里建好,含 A2 的记忆 hook);Settings 字段 `agents_enabled`、`agents_rooms_enabled`、`agents_tutor_enabled`、`agents_tutor_daily_per_user`;模型 `app.models.AgentPersona`(列名按 spec §4.2);`test_architecture.py` 中 `rooms` 可导入 `agents`。
- A1-7 metering:`run_turn` 内若另设 `feature_scope`,以其为准;房间外层的 `feature_scope("rooms")` + `bind_user(提问者/开启者)` 只保证没有内部 scope 时归到 rooms。

**A2 agents-memory**
- A2-1 记忆整理注册在 `TurnHooks.after_turn`(随 `agent_turn_deps.hooks` 传入),只读 `TurnRecord` 里该回合的 `user_id` 与其输入文本;房间只在「提问者开启记忆的直接提问」时传入 hooks(接力、带练回合传空 hooks)。迁移 `0016` 已合并。

**A3 agents-tutor**
- A3-1 `app.agents.tutor.machine`:`initial_state(level=...)`、`next_state(state, TutorEvent(kind="answer"|"skip", verdict=...))`、`difficulty(state) -> int`(0..3 对应 A2..C1)、`TutorState.to_dict()` / `TutorState.from_dict(d)`(JSON 可序列化)。`app.agents.tutor.plan.build_plan(goal: dict, sources: list) -> list[PlanItem]`(`PlanItem.kind`)。`app.agents.tutor.parse.parse_meta(text) -> (visible, dict | None)`、`StreamFilter()`。只在 `agent_tutor.py` 的「A3 适配块」与 `test_a3_adapter_plan_and_machine` 使用。
- A3-2 对话导师的每日开始次数计在 `usage` 作用域 `"agent_tutor"`(主体 = 用户 id 字符串);房间带练共用同一计数(`TUTOR_SCOPE`)。若 A3 用了别的作用域名,改 `TUTOR_SCOPE` 一处。

**A4 agents-web**
- A4-1 `~/features/agents` 导出 `PersonaPicker`(props:`open`、`onOpenChange(v)`、`selectedId: string | null`、`onSelect(persona: Persona)`,单选,只列内置与本人角色)与类型 `Persona`(至少 `id`、`name`)。
- A4-2 `ProcessCapsule` props:`steps: AgentStep[]`、`thought: {source, text} | null`、`trace: AgentTrace | null`、`generating: boolean`、`label?: string`;`AgentStep` 与本计划的 `AgentStepWire` 结构相同(spec §4.4 step 的 camelCase)。
- A4-3 `web/src/architecture.test.ts` 已登记 `rooms->agents` 边(本计划不改架构测试)。
- A4-4 A4 的智能体界面自行懒加载;本计划的 W0 让房间页整体懒加载,两者不冲突。

**R rooms-reopen**
- R-1 迁移 `0014`(`opened_at`、`reopen_count`)与 `reopened` WS 事件已合并;重新开启的房间保留 `agent_config`,带练快照在关闭时已被 `on_close` 清空,所以重新开启后没有残留的带练。R 的 `reopened` 已追加在 `SERVER_EVENT_TYPES` 末尾:S2 在它**之后**追加本计划的三项(S2 Step 3 的元组照抄现有内容再加三项,不要漏掉 `reopened`);`test_rooms_agents_protocol.py` 只断言末尾三项与开头四项,与 R 的位置无关;`protocol.ts` 的数组同样保持 R 的项。
- R-2 管理员关闭房间(`routers/admin_rooms.py`)与成员/清扫关闭一样调用 `rooms.after_close` → `close_listeners`;若管理员关闭路径没有调用,带练快照会留在已关闭房间里(无害:`tutor_rooms()` 只查 `status="open"`),在 Addendum 里记录即可。

**INDEX**
- 共享文件的追加顺序以 `plans/2026-10-12-agents-INDEX.md` 为准;本计划在 `main.py`、`models.py`、各层 `CLAUDE.md` 的插入点见「文件结构」表。

