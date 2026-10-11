# 智能体寻址 · 服务端(免 @ 对话、`@ai` 并入默认智能体、回复纯英文)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> 执行前先读 `docs/superpowers/plans/2026-10-12-agents-INDEX.md`(X1–X20 仍然有效)。本计划只覆盖 spec `2026-10-12-agents-addressing-design.md` 列出的点;与 INDEX 冲突处以本计划的「裁定」为准,并已逐条注明。前端计划 `2026-10-12-agents-addressing-web.md` 并行编写,双方只经 spec §3.4、§5.2 与文末「Cross-plan assumptions」对接。

**Goal:** 联机房间里不写 `@` 也能和智能体说话:回复智能体的消息自动交给那个智能体、客户端可以在 `say` / 语音上传里带目标(`to` / `to_agent`)、带练时被点名成员的语音在转写成功后算作回答;`@ai` / `@助手` 改为「默认智能体」(房间第一个智能体,否则内置英语教练),旧的公共回答通道与它的 `rooms.answer` 模板整体删除;智能体在 1:1 与联机里的公开回复只用英文,中文说明放进不朗读的 `note_zh`(带练另有 `hint_zh`),由用户级设置 `zh_note`(`auto|always|never`)控制,服务端对公开文本做确定性的中文句兜底过滤。

**Architecture:** 新纯模块 `app/agents/lang.py`(只用标准库):`want_note`、`chat_rule`、`<<ZH>>` 流式剥离 `MarkerFilter`、中文句兜底 `SentenceGate`(中文字符之前的英文立即放行,不增加首字延迟)、过滤器串联 `Chain`、`note_zh` 清洗与来源优先级。编排器 `orchestrator._charged` 把模式自己的过滤器(导师 `<<META>>`)与这两个过滤器串起来,聊天模式在模式块之后追加语言说明,`Done` 事件与压缩过程带 `note_zh`。导师纯模块(`parse` / `machine` / `prompt`)增加 `note_zh` / `hint_zh` 字段与英文规则。联机路由集中到 `AgentLane.route`(`@ai` 默认智能体 > `@名字` > 回复规则 > `to`,至多一个回合,带练进行中不走隐式路由);`connection.on_say` 只调用它并删掉 `_admit_ai` / `_answer`。语音:`VoiceService` 在每次转写结束后调用 `AgentLane.on_voice`(转写文字 = 问题;或交给 `RoomTutor.on_message` 当作答)。目标写在已有的 `room_messages.meta` JSON(无迁移)。

**Tech Stack:** FastAPI + SQLAlchemy 2 async + pydantic v2 + pytest-asyncio(Starlette TestClient + 30 s 帧超时);admin 控制台 React 18 + vitest。不新增依赖,不新增迁移(头仍是 `0017`)。

**Spec:** `docs/superpowers/specs/2026-10-12-agents-addressing-design.md`(D1–D5 为最终决定;§3、§4、§5、§6、§7 为本计划的约束)。背景:`specs/2026-10-12-agents-design.md`、`plans/2026-10-12-agents-INDEX.md`、`plans/2026-10-12-agents-{core,tutor,rooms}.md`(已实现,以真实代码为准)、`server/app/rooms/CLAUDE.md`、`server/app/agents/CLAUDE.md`、`server/app/agents/tutor/CLAUDE.md`。

## Global Constraints

- 分层不放宽:`server/tests/test_architecture.py` 一行不改。`app/agents/lang.py` 只导入 `re`;导师五个纯模块仍只用标准库与彼此(`test_tutor_core_modules_are_pure`),所以 `tutor/prompt.py` **不**导入 `lang`,`zh_note` 的判断由调用方(`tutor/handler.py`、`rooms/agent_tutor.py`)算好后以布尔值传入。
- 协议只做加法:`say.to`(可选)、notice `voice_unclear`(追加在 `agent_off` 之后)、公开消息 `meta.note_zh` / `meta.to_agent`(可选键)、`agent_tutor.tutor.hint_zh`(可选键)、SSE `done.note_zh`(可选键)。缺省 = 没有(沿用「`Event.to_dict` 丢弃 null」与「可选键不出现」的约定)。`PROTOCOL_VERSION` 不变(仍是 2)。
- 隐私:转写文字、问题、回复、`note_zh`、`hint_zh`、人名永不进日志 / URL / 错误 / 审计;每条新后台路径(路由、语音触发、带练语音作答、`<<ZH>>` / 兜底过滤)都有 `caplog` 断言,`caplog.set_level(logging.DEBUG, logger="app")`,只检查 `r.name.startswith("app")` 的记录(aiosqlite 的 DEBUG 会带 SQL 参数,是测试环境假象)。
- 成本(spec §3.3):每个路由到智能体的消息 = 一个智能体回合,沿用 `AgentLane._reserve`(`ai_public` / `ai_muted` / `rooms_ai_available` / `ai_queue` / 房间窗口 / 用户窗口 / `room_ai_global`)与编排器内部的 `AGENTS_TURNS_*`,任何一个拒绝即拒绝;**消息照常发布**,只是不触发回答,并给 `notice`(`ai_off` / `ai_busy` / `ai_quota` / `agent_off`)。
- 后台任务:房间回合、语音转写都是 hub 任务(`hub.drain()` / `drain_background(app)` 等待),带练计时器只取消不等待(`tests/background.py` 的约定);测试里注入 `sleep`(`Clockwork`),不真等 60 秒。不新增 fire-and-forget 任务集合。
- 假上游:编排器测试用 `tests/agents_helpers.FakeLLM`;房间测试用脚本化的 `run_turn`(`tests/test_rooms_agents_lane.Script` 及其子类)或 `tests/test_rooms_ws.fake_ai_turn`;不调用真实上游(真实上游行为列入「未验证」)。
- 每个任务结束:`cd server && uv run pytest -q <任务列出的测试> tests/test_architecture.py`;M1:`cd admin && yarn vitest run src/features/prompts`。车道合并前分文件跑全量 `cd server && uv run pytest -q`(约 2.5 分钟,超时就按 `tests/test_a*.py`、`tests/test_[b-q]*.py`、`tests/test_r*.py`、`tests/test_[s-z]*.py` 分四批)。不跑 E2E(需要真实上游、花钱)。
- 契约夹具由服务端对真实应用录制(`CONTRACT_UPDATE=1`;PowerShell:`$env:CONTRACT_UPDATE=1; uv run pytest -q <file>; Remove-Item Env:CONTRACT_UPDATE`),网页逐键核对;重录后 `git diff` 只应出现本计划声明的新键。
- 提交:conventional,一个任务一个逻辑提交,测试全绿;提交信息以 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾。只在用户要求时提交 / 推送。

---

## 文件结构

**新建(服务端)**

| 文件 | 职责 |
|---|---|
| `server/app/agents/lang.py` | 纯函数:`want_note`、`chat_rule`、`is_chinese`、`sanitize`、`split_marker`、`MarkerFilter`、`SentenceGate`、`Chain`、`clean_note`、`resolve_note` |
| `server/tests/test_agents_lang.py` | `lang.py` 的规则、样例与 3,000 例拆分模糊测试 |
| `server/tests/test_rooms_addressing_protocol.py` | `say.to`、`voice_unclear`、`is_persona_id` |
| `server/tests/test_rooms_addressing_store.py` | `RoomStore.agent_of`、`message_named` |
| `server/tests/test_rooms_addressing_routing.py` | `AgentLane.route`:`@ai` 默认智能体、回复规则、`to`、优先级、带练时关闭隐式路由、`note_zh`、并发准入 |
| `server/tests/test_rooms_addressing_voice.py` | `AgentLane.on_voice`:语音目标、回复规则、`voice_unclear`、带练语音作答与计时竞争、隐私;真实应用里「上传 → 转写 → 回答」 |
| `server/tests/test_rooms_agents_prefs.py` | `rooms_agents.install` 的 `prefs` 带 `zh_note`(T4) |

**修改(共享文件与插入点)**

| 文件 | 车道 | 插入点 / 改动 |
|---|---|---|
| `server/app/agents/trace.py` | L | `Done` 加 `note_zh`;`compact_trace(..., note_zh=None)`;`fit` 末档保留 `note_zh`;`TRACE_KEYS` 加 `note_zh`;`_stored_ok` 末尾前校验 |
| `server/app/agents/settings.py` | L | `FLAGS` 之后加 `ZH_NOTES`;`AgentSettings` 末尾加 `zh_note`;`out()`;`_check` 的 `process_default` 分支之前 |
| `server/app/agents/personas.py` | L | `REVIEWER_FALLBACK` 之后加 `ENGLISH_ONLY`;`_builtins()` 的前三项 |
| `server/app/agents/prompt.py` | L | `ROOM_LINE` 文本;`turn_message` / `build_messages` 加 `lang_block` |
| `server/app/agents/orchestrator.py` | L | `_charged`:读设置之后替换 `req`;`build_messages` 之前算 `lang_block`;`flt` 改为 `lang.Chain`;`finish` 之后取 `note_zh`;`compact_trace` / `Done` |
| `server/app/agents/tutor/parse.py` | T | `Meta` 末尾加 `note_zh`、`hint_zh`;`parse_meta` 返回值 |
| `server/app/agents/tutor/machine.py` | T | `TutorState` / `Asked` / `Answered` 末尾加 `hint_zh`;`_advance`、`next_state`、`to_dict`、`from_dict` |
| `server/app/agents/tutor/prompt.py` | T | `FEEDBACK_RULES` / `FORMAT_RULES` 改写、新 `format_rules(zh_note)`;`tutor_block(..., zh_note=False)` |
| `server/app/agents/tutor/service.py` | T | `FALLBACK_HINT` 之前加 `FALLBACK_HINT_EN`;`hint_text` 返回二元组;`hint` 返回三元组;`apply_turn` 的事件 |
| `server/app/agents/tutor/handler.py` | T | `prepare` 的 `tutor_block` 调用;`finish` 返回值加 `note_zh` |
| `server/app/routers/agents_tutor.py` | T | `hint` 端点 |
| `server/app/rooms/agent_tutor.py` | T | `room_block(..., zh_note)`;`RoomTutorMode.hint_zh` / `finish`;`tutor_view` 加可选 `hint_zh`(R-AS18:无英文 `hint`);`_run_turn`(设置、`Done`、`meta.note_zh`);`_plan_turn(..., zh_note)`;`_after_turn`;`on_message` 返回布尔 + 语音 + 题号守卫;新 `waits_for` |
| `server/app/rooms/agent_lane.py` | T(一字段)→ R → V | T4:`AgentPrefs` 末尾加 `zh_note`;R2:`ROOM_RULES`、`DEFAULT_PERSONA_ID`、`route` / `_implicit` / `_personas` / `default_persona` / `_admit`、`Target`、`AgentRoute.via`(替换 `admit`)、`_turn` 收 `Done.note_zh`;V2:文件末尾 `# ---- voice messages ----` 段加 `on_voice` |
| `server/app/routers/rooms_agents.py` | T(一行) | T4:`install.prefs` 传 `zh_note`;线上形状不变(R-AS18:不加 `default_agent`),R3 只加测试 |
| `server/app/rooms/protocol.py` | R | 文档串末段;`SayMsg` 加 `to`;`NOTICE_CODES` 末尾追加 `voice_unclear` |
| `server/app/rooms/rules.py` | R | `_LEVEL_BY_TIER` 之后加 `is_persona_id` |
| `server/app/rooms/store.py` | R | `fail_pending_ai` 之前加 `agent_of`、`message_named` |
| `server/app/rooms/connection.py` | R | `AgentsHandler` 协议;`on_say` 的路由段;删除 `_admit_ai`、`_answer`、`LlmUnavailable` 导入 |
| `server/app/rooms/voice_store.py` | V | `append_voice(..., to_agent=None)` |
| `server/app/rooms/voice.py` | V | `VoiceDeps` 末尾加 `agents`;`upload(..., to_agent=None)`;`_transcribe` 两处调用 `_after_transcript` |
| `server/app/routers/rooms_voice.py` | V | `install` 的 `VoiceDeps(..., agents=...)`;`upload_voice` 解析 `to_agent` |
| `server/app/rooms/assistant.py` | A | 删除 `ANSWER_*`、`MAX_ANSWER_CHARS`、`ANSWER_SYSTEM`、`V1_ANSWER_TEMPLATE`、`DEFAULT_ANSWER_TEMPLATE`、`answer_messages`、`clean_answer` 与 `_FIELDS` / `_DEFAULTS` 的 `rooms.answer` 项 |
| `server/app/services/prompts.py` | A | `PROMPTS` 删除 `rooms.answer` |
| `server/app/admin/prompts_admin.py` | A | `default_body` 删除 `rooms.answer` 分支 |
| `server/app/routers/rooms.py` | A | `deps_for.templates` 的键元组 |
| `admin/src/features/prompts/{strings.ts,test-run-panel.tsx,prompt-editor-page.test.tsx}` | M | `sampleLabels` 删除只属于 `rooms.answer` 的三项;测试改用 `rooms.assist` |
| 测试与夹具 | 各车道 | 见各任务;重录:`agents_contract.json`(L5)、`agents_tutor_contract.json`(T3)、`rooms_contract.json`(R2)、`rooms_agents_contract.json`(R3);改写:`rooms_prompts_legacy.json`(A1,删 `answer` 键) |
| 各层 `CLAUDE.md` | Z | Z1 |

---

## 车道、文件归属与合并顺序

| 车道 | 任务 | 独占文件(本车道进行期间只有它改) | 依赖 |
|---|---|---|---|
| **L 语言 / 中文说明**(串行) | L1–L5 | `app/agents/{lang,trace,settings,personas,prompt,orchestrator}.py`、`tests/test_agents_{lang,trace,settings,personas,prompt,orchestrator,contract,privacy}.py`、`tests/fixtures/agents_contract.json` | 无 |
| **T 导师**(串行) | T1–T5 | `app/agents/tutor/{parse,machine,prompt,service,handler}.py`、`app/routers/agents_tutor.py`、`app/rooms/agent_tutor.py`、`app/rooms/agent_lane.py`(仅 T4 一字段)、`app/routers/rooms_agents.py`(仅 T4 一行)、`tests/test_agents_tutor_{parse,machine,prompt,api,turn,contract}.py`、`tests/test_rooms_agent_tutor.py`、`tests/test_rooms_agents_prefs.py`、`tests/fixtures/agents_tutor_contract.json` | L(`lang.want_note`、`Done.note_zh`、编排器取 `note_zh`) |
| **R 路由 / `@ai` 别名**(串行) | R1–R3 | `app/rooms/{protocol,rules,store,connection,agent_lane}.py`、`app/routers/rooms_agents.py`、`tests/test_rooms_addressing_{protocol,store,routing}.py`、`tests/test_rooms_{connection,agents_lane,ws,social,prompts_ctx,prompts_live,agents_api,agents_contract,agent_tutor_api}.py`、`tests/test_web_contract.py`、`tests/fixtures/{rooms_contract,rooms_agents_contract}.json` | L、T(`agent_tutor.on_message` 返回布尔、`tutor_view` 的提示键) |
| **V 语音**(串行) | V1–V2 | `app/rooms/{voice,voice_store}.py`、`app/routers/rooms_voice.py`、`app/rooms/agent_lane.py`(V2 只追加 `on_voice` 段)、`tests/test_rooms_voice_{service,api}.py`、`tests/test_rooms_addressing_voice.py` | R(`_implicit`、`_personas`、`agent_of`、`message_named`)、T5(`waits_for`、`on_message`) |
| **A 删除旧通道** | A1 | `app/rooms/assistant.py`、`app/services/prompts.py`、`app/admin/prompts_admin.py`、`app/routers/rooms.py`、`tests/test_rooms_assistant.py`、`tests/test_rooms_prompts_v2.py`、`tests/test_prompts.py`、`tests/test_prompts_api.py`、`tests/fixtures/rooms_prompts_legacy.json` | R2(`connection._answer` 已删) |
| **M 管理端网页** | M1 | `admin/src/features/prompts/{strings.ts,test-run-panel.tsx,prompt-editor-page.test.tsx}` | A1 |
| **Z 收尾** | Z1–Z2 | 各层 `CLAUDE.md`、本计划的验证记录 | 全部 |

**合并顺序(权威):** L1 → L2 → L3 → L4 → L5 → T1 → T2 → T3 → T4 → T5 → R1 → R2 → R3 → V1 → V2 → A1 → M1 → Z1 → Z2。L1、T1、R1、V1 的纯部分可以并行开发,按此顺序合并。整个服务端计划在前端计划之前合并(spec §9:S → W,前端依赖重录的夹具)。

**评审波:** L4(编排器流式过滤,首字延迟与退款边界)与 R2(路由、准入、删除旧通道)各单独 `/code-review high`;V2 + T5 合并后对 `app/rooms/agent_*`、`app/rooms/voice.py` 跑一次 `security-review`(目标越权、转写泄漏、带练竞争);Z2 对全部改动 `/code-review high`。

## 本计划的裁定

- **R-AS1 语音目标不需要迁移 0018。** Ruling:`to_agent` 存在语音消息自己的 `room_messages.meta`(`{"to_agent": "<persona id>"}`,与 `quote` 并存),由 `VoiceStore.append_voice` 写入。为什么:`RoomMessage.meta` 是已有 JSON 列(`append_voice` 已经往里写 `quote`),`room_voice` 表不需要新列;spec §6 要求「没有可用 JSON 列才提 0018」。代价:`message_out` 把 `meta` 原样发给成员,所以成员看得到「这条语音是对哪个角色说的」(一个角色 id,不含文本;网页可据此显示标签);若以后要隐藏,在 `message_out` 里剔除该键即可,无数据迁移。
- **R-AS2 一个路由入口。** Ruling:说话与语音的路由都在 `AgentLane`(`route` / `on_voice`,共用 `_implicit` 与 `default_persona`);`connection.on_say` 只调用 `route`。优先级 `@ai` > `@名字` > 回复规则(`reply_to` 指向带 `meta.agent` 的公开 `ai_answer`,`RoomStore.agent_of`)> `to` / `to_agent`;一条消息至多一个回合(只产出一个 `AgentRoute`)。回复规则只认**本房当前配置里仍能解析**的角色(被移出配置或删除的角色 → 普通消息)。语音转写**不**解析 `@`(口语里不会出现;只用回复规则与 `to_agent`)。
- **R-AS3 带练进行中关闭隐式路由。** Ruling:房间有带练快照(`rooms.agent_tutor` 非空,任何阶段,含 `paused`)时,`to` / `to_agent` / 回复规则**不**触发智能体回合,消息照常发布、不发提示;被点名成员的文字 / 语音照旧交给 `RoomTutor.on_message`;显式 `@名字` / `@ai` 仍然触发(与现状一致)。为什么:spec D2 让「对象」在带练开始时自动打开,若隐式路由照常生效,被点名成员的回答会同时触发一个聊天回合(双重回答),其他人的补充会和带练争同一把 AI 锁、各扣一次额度;A5 的规则本来就是「其他人的消息只是上下文」。代价:带练暂停期间开着「对象」发的消息也不会被回答(网页可以在带练期间提示)。
- **R-AS4 拒绝提示。** Ruling:显式寻址(`@ai`、`@名字`、`to`、`to_agent`)被拒时给提问者 `notice`;回复规则被拒(角色停用、功能关闭)静默,当作普通消息。功能关闭(`AGENTS_ENABLED` / `AGENTS_ROOMS_ENABLED` 关)、角色停用、`to` 不在本房配置 → `agent_off`;房间被静音 `ai_muted`、`ai_public=false`、`rooms_ai_available=false` → 沿用 `ai_off`(`_reserve` 的现状)。为什么:spec §4 一处写「静音时 `@ai` 返回 `agent_off`」,同一句又要求「与现在 `@名字` 一致」——现在 `@名字` 在静音时就是 `ai_off`(`test_gates_ai_muted_ai_public_switch_and_disabled_persona` 固定了它),网页已有对应文案;取「一致」。代价:若产品坚持静音也显示 `agent_off`,只改 `_reserve` 一行与两个断言。
- **R-AS5 默认智能体。** Ruling:`@ai` / `@AI` / `@助手`(`rules.mention`,不改)= 本房配置里**第一个能解析**的角色;配置为空或全部被删 → `builtin:coach`(经 `PersonaLookup.get(chosen_by or 0, "builtin:coach")`);第一个角色被停用 → `agent_off`(不跳到第二个,否则「默认」会在成员不知情时变化)。没有配置时接力候选只有教练本身(不会接力)。默认角色的公开回复与任何智能体回复同形(`meta.agent` 是教练的 id 与名字)。
- **R-AS6 旧通道整体删除。** Ruling:删除 `RoomConnection._admit_ai` / `_answer`、`assistant` 的 `rooms.answer` 全部代码、`PROMPTS["rooms.answer"]`、`prompts_admin.default_body` 的分支、`deps_for.templates` 的键、`rooms_prompts_legacy.json` 的 `answer` 键与只测它的测试。保留:`store.AI_NAME`(历史上的 `@ai` 回复仍显示「AI 助手」)、`prompt_versions` 里 `key="rooms.answer"` 的历史行(不删表、不删行;管理端列表不再显示,详情 404)、`ROOMS_AI_*` 设置与 `room_ai_global` 计数(所有智能体回合共用,spec §4)。私聊写作助手(`rooms.assist`、`on_assist`、助手面板)不动。
- **R-AS7 语音目标的校验分两步。** Ruling:上传接口只校验形状(`rules.is_persona_id`;不合法 → 400 `Invalid to_agent`,空串 / `null` = 没有目标);是否属于本房配置在**转写结束时**校验(不属于 → `notice agent_off` 发给发送者的所有连接)。为什么:REST 上传没有 WS 通道可回提示;配置可能在上传与转写之间改变。代价:错误的目标要等转写结束才提示(通常几秒)。
- **R-AS8 语音触发时机。** Ruling:`VoiceService._transcribe` 在每次转写结束(`done` / `empty` / `failed`,含发送者重试)后调用 `AgentLane.on_voice`;只有 `done` 且文字非空才会作答或开回合;`failed` / `empty` 若本来要交给智能体(有目标、回复智能体、或带练正等这个人)就给发送者 `notice voice_unclear`(spec §3.2 第 3 条「没听清,再说一次」),计时不重置、不扣题;`failed` 的语音重试成功后照常触发。被隐藏的语音什么都不触发。钩子异常只记异常类名,不影响转写结果。
- **R-AS9 `zh_note` 的水平与归属。** Ruling:聊天模式按角色水平(`persona.level`)判断 `auto`;导师(1:1 与联机)按状态机**当前**水平(`machine.LEVELS[state.level]`,会随表现升降)。联机普通回合用提问者的设置(`TurnRequest.user_id` = 提问者,编排器自己读);联机带练用开启者的设置(`AgentPrefs.zh_note`,与 `TurnRequest.user_id = started_by` 一致)。编排器读到设置后把它放进 `req.agent_settings` 再调 `mode.prepare`,让 1:1 导师模式能读到。`auto` 的水平集合 = A1、A2、B1(房间 A1 已映射为导师 A2,集合含 A1 只为稳妥)。
- **R-AS10 兜底过滤的确定性规则。** Ruling:按句切分(英文句末标点 + 空白、中文句末标点、换行);一句是「中文句」当且仅当含 CJK / 全角标点(U+3000–303F、全角标点区,不含全角字母数字),或最长连续中文字符 > 4,或中文字符总数 > 8,或至少 3 个中文字符且占该句字母的一半以上(中文字符 = CJK 统一表意文字含扩展与兼容区 + 平假名 / 片假名)。中文句**从第一个中文字符起**不进公开文本(之前的英文已流出,保留),被拿掉的部分记进 `removed`;非中文句(含 ≤ 4 字的人名)原样保留。没有中文字符的文字立即放行,首字延迟不变;含中文字符的句子暂扣到句末。为什么:spec §5.1「人名可保留中文」与 §5.2「含中文的句子移除」需要一条可测的边界;1:1 的消息由网页从流式增量保存,服务端只能在流上过滤(见 R-AS12),逐句全扣会让首字延迟变成「第一句结束」。代价:`Chinese: 这个词……` 会留下悬空的 `Chinese: `;很短的句子里的三字名(`Hi 王小明`)会被拿掉。
- **R-AS11 `note_zh` 的来源与上限。** Ruling:优先级 = 模式 META 的 `note_zh`(导师)→ `<<ZH>>` 行 → 被兜底拿掉的中文片段(以空格连接);清洗(去控制字符、尖括号换形近字符、压空白)后截到 80 个码点;`zh_note=never` 时三者都丢弃(兜底拿掉的中文直接丢,不变成说明)。`note_zh` 永远不进公开文本、不进 `Meta` 事件(编排器在 `Meta.from_dict` 之前取走)。
- **R-AS12 1:1 的保存。** Ruling:`note_zh` 同时放在 SSE `done.note_zh` 与 `done.trace.note_zh`(`compact_trace` 写入,`fit` 的最后一档也保留);网页按现状把 `done.trace` 原样随 assistant 消息回存,于是落在 `messages.agent_trace.note_zh`(无迁移)。`check_stored` 接受 `note_zh` 为 ≤ 80 字的字符串或 null。
- **R-AS13 带练提示。** Ruling(线上部分已被 R-AS18 收窄):联机 `agent_tutor` 帧在 `await_answer` 阶段且有值时多一个可选键 `hint_zh`(从快照里的状态机读,不新增快照字段);1:1 `POST /api/agents/tutor/{id}/hint` 返回英文 `hint`(模型给的,或新的英文固定提示)与可选 `hint_zh`(模型给的,或原来的中文固定提示),用户 `zh_note=never` 时不返回 `hint_zh`。为什么:spec §5.2 要求 `hint_zh` 随 `agent_tutor` 帧下发,但现有联机帧根本没有提示字段。代价:联机的中文提示对全房间可见(帧是公共的),英文提示只在 1:1 返回(见 R-AS18)。
- **R-AS14 英文提示词的位置。** Ruling:聊天语言说明(`lang.chat_rule`)放在最后一条 user 消息里、模式块之后(我们写的、不转义);系统消息只在 `ROOM_LINE` 加一句「Reply in English only.」。内置角色 `coach` / `partner` / `reviewer` 的人设末尾追加 `Reply in English only.`(场景角色已有同义句);`static_config/chat_agent_templates.json` 不改(非智能体对话与网页也用它)。用户自建人设若要求中文,按安全前言第 3 条只是数据,语言说明优先。
- **R-AS15 带练语音作答。** Ruling:只有「当前被点名的成员」的、在当前题之后上传的(`message.seq > question_seq`)、转写成功且非空的语音算作答;文字作答同样加这个题号守卫(文字总是满足)。计时器不因上传或转写重置;转写与 60 秒自动跳过的竞争由 `RoomTutor._advance` 的锁裁决:先到者赢,后到者返回 `False`(迟到的转写不计、不提示)。
- **R-AS16 默认智能体对外可见。** Ruling(已被 R-AS18 取代,保留编号):原计划让 `GET /api/rooms/{id}/agents` 增加 `default_agent`;现在**不加**。网页用 `room.agent_ids[0]` 推出默认智能体(web R-AW5),没有配置时不显示名字。
- **R-AS17 契约夹具。** Ruling(R-AS18 修订):`rooms_contract.json` 重录时打开智能体(`AGENTS_ON`)并用脚本化 `run_turn`,于是录到的 `@ai` 回复 `meta` 由 `null` 变为 `{agent, asker}` 对象(这是本次功能的真实形状);`rooms_agents_contract.json` 只多 `ws.message_agent_answer.message.meta.note_zh`(键名沿用现有的 `message_agent_answer`;脚本化回合带 `note_zh`),不加 `default_agent`、不加 `hint`,`agent_tutor.tutor.hint_zh` 不在录制里(假上游绕过 `RoomTutorMode.finish`),由 `test_rooms_agent_tutor.py` 钉住;`agents_contract.json` 增加 `done.note_zh`、`done.trace.note_zh`、`settings.zh_note`、`message_with_trace.agent_trace.note_zh`;`agents_tutor_contract.json` 的 `hint` 增加 `hint_zh`。
- **R-AS18 与网页计划对齐的线上收窄。** Ruling:网页的契约测试逐键钉住录制夹具(`room-agents-contract.test.ts`:`wireKeys(C.http.agents)` 恰好是 `["agents","available","tutor"]`,带练帧的必需键恰好是它的 `RoomTutorInfo`,只有 `hintZh` 可选),所以:① `GET /api/rooms/{id}/agents` 形状不变(不加 `default_agent`);② 联机 `agent_tutor` 帧只增可选键 `hint_zh`,不带英文 `hint`;③ 夹具里公开回复的键仍叫 `message_agent_answer`。为什么:这三处对网页零收益(它从 `agent_ids[0]` 推默认、R-AW14 只显示 `hint_zh`),却会让网页现有测试在夹具重录后失败。代价:没有配置智能体时,网页拿不到教练的名字(占位符用无名版本);联机没有英文提示。若以后要补,服务端加键的同时网页把键加进它的可选集合。
- **R-AS19 `meta.to_agent` 与 `AgentRoute.via`。** Ruling:`AgentRoute.via ∈ {alias, name, reply, to, handoff}` 只给测试、日志计数(只记 `via`)与 `connection` 用。文字消息只有在**确实由 `to` 路由**(`via == "to"`)时才把 `meta.to_agent = <persona id>` 写进公开消息;语音消息把上传时通过形状校验的 `to_agent` 原样写进 `meta`(R-AS1)。为什么:meta 对成员可见,只记录真正起作用的目标;被 `@` / 回复盖掉的 `to` 不留痕迹。
- **R-AS20 语音钩子不传文字。** Ruling:`VoiceService` 只调用 `AgentLane.on_voice(room_id, message_id, status)`;转写文字由 `on_voice` 从 `room_messages.text` 读出(`set_transcript` 在 `done` 时已写入),所以文字不经过参数、不进日志、不进异常。钩子用 `getattr(agents, "on_voice", None)` 取得,没有这个方法的处理器(V1 与 V2 之间、旧版)视为没有钩子。
- **R-AS21 以 `@` 开头但不是智能体的消息。** Ruling:`@Carol 你看这个` 这类找不到智能体名的 `@` 开头消息继续走隐式规则(回复规则、`to`):「对象」是全局开关,网页也按这个推算收件人(R-AW7)。`@` 开头且命中智能体名 / `@ai` 的消息永远按显式规则处理。
- **R-AS22 准入拒绝提示对回复规则也生效。** Ruling:R-AS4 里「静默」只覆盖功能关闭与角色停用;`_reserve` 的拒绝(`ai_off` / `ai_busy` / `ai_quota`)对所有路由方式都给提问者提示(语音:发给发送者的所有连接),因为成员回复智能体就是想得到回答。
- **R-AS23 房间水平与场景不再进入 `@ai` 的回答。** Ruling:旧 `rooms.answer` 带房间话题、水平、场景;并入默认智能体后,智能体按自己的人设水平回答,`ROOM_RULES` 不含房间水平与场景(D3:不保留旧行为)。代价:场景房间里 `@ai` 的回答不再自动贴合场景;若要补,给 `RoomChatMode` 加一行(只读房间设置,不进日志),不需要协议改动。
- **R-AS24 功能关闭先于静音。** Ruling:`AGENTS_ENABLED` / `AGENTS_ROOMS_ENABLED` 关闭时,任何显式寻址先得 `agent_off`(在 `_reserve` 之前),所以 `test_rooms_ws.py` 里「管理员静音后 `@ai` → `ai_off`」的用例要在开启智能体的应用里跑(R2 改测试,不改产品)。

---

## Task 0: 开工检查(执行者第一步,不提交)

- [ ] **Step 1: 迁移头** — Run: `cd server && uv run alembic heads` → `0017 (head)`。本计划不新增迁移。
- [ ] **Step 2: 核对真实代码里的名字** — 每条都必须命中;任何一条不一致就停下,在本文件末尾写 `## Addendum (日期) · 接口对齐`,只改受影响的调用行:
  `grep -n "async def admit\|async def answer\|async def _reserve\|async def release\|class AgentPrefs\|ROOM_RULES\|def _clean\|def _history" server/app/rooms/agent_lane.py`;
  `grep -n "async def _admit_ai\|async def _answer\|is_ai, question = mention" server/app/rooms/connection.py`;
  `grep -n "async def on_message\|async def _advance\|def tutor_view\|class RoomTutorMode\|def room_block\|def _plan_turn\|def _after_turn" server/app/rooms/agent_tutor.py`;
  `grep -n "class Done\|def compact_trace\|TRACE_KEYS\|def _stored_ok" server/app/agents/trace.py`;
  `grep -n "flt = mode.stream_filter()\|found = await mode.finish\|compact = trace.compact_trace\|yield trace.Done" server/app/agents/orchestrator.py`;
  `grep -n "def turn_message\|def build_messages\|ROOM_LINE" server/app/agents/prompt.py`;
  `grep -n "class Meta\|def parse_meta" server/app/agents/tutor/parse.py`;`grep -n "hint_text\|class Asked\|class Answered" server/app/agents/tutor/machine.py`;
  `grep -n "FEEDBACK_RULES\|FORMAT_RULES\|def tutor_block" server/app/agents/tutor/prompt.py`;
  `grep -n "def hint_text\|async def hint\|FALLBACK_HINT" server/app/agents/tutor/service.py`;
  `grep -n "async def append_voice\|meta={\"quote\": quote}" server/app/rooms/voice_store.py`;`grep -n "class VoiceDeps\|async def upload\|async def _transcribe" server/app/rooms/voice.py`;
  `grep -rn "rooms.answer" server/app admin/src`(只应命中 A1 列出的位置)。
- [ ] **Step 3: 基线** — Run: `cd server && uv run pytest -q tests/test_agents_*.py tests/test_rooms_*.py tests/test_web_contract.py tests/test_prompts*.py tests/test_architecture.py`(可分批)、`cd admin && yarn vitest run src/features/prompts` → 全绿;否则先报告既有失败,不开工。

---

## Lane L · 语言规则与中文说明(`app/agents/`)

### Task L1: 纯模块 `lang.py`(`<<ZH>>` 剥离、中文句兜底、串联、说明清洗)

**Files:**
- Create: `server/app/agents/lang.py`
- Test: `server/tests/test_agents_lang.py`

**Interfaces:**
- Produces: `NOTE_MAX = 80`、`ZH_SETTINGS = ("auto", "always", "never")`、`want_note(setting, level) -> bool`、`chat_rule(want) -> str`、`is_chinese(sentence) -> bool`、`sanitize(text) -> (visible, removed)`、`split_marker(text) -> (visible, tail)`、`MarkerFilter`(`feed` / `flush` / `tail`)、`SentenceGate`(`feed` / `flush` / `removed`)、`Chain(*filters)`、`clean_note(value) -> str | None`、`resolve_note(setting, mode_note, marker_note, removed) -> str | None`
- Consumes: 测试里 `app.agents.tutor.parse.StreamFilter` / `parse_meta`(只用于串联测试)

- [ ] **Step 1: 写失败测试** — `server/tests/test_agents_lang.py`:

```python
"""回复语言纯模块(计划 addressing-server L1;spec 2026-10-12-agents-addressing §5)。"""
import random

import pytest

from app.agents import lang
from app.agents.tutor.parse import StreamFilter, parse_meta


def stream(filters, chunks):
    chain = lang.Chain(*filters)
    return "".join(chain.feed(c) for c in chunks) + chain.flush()


def test_want_note_follows_the_setting_and_the_level():
    assert lang.ZH_SETTINGS == ("auto", "always", "never")
    assert [lang.want_note("auto", lv) for lv in ("A1", "A2", "B1", "B2", "C1")] == [True, True, True, False, False]
    assert lang.want_note("always", "C1") is True and lang.want_note("never", "A2") is False
    assert lang.want_note("bogus", "A2") is True  # an unknown value behaves like auto


def test_chat_rule_offers_the_zh_line_only_when_wanted():
    assert "<<ZH>>" in lang.chat_rule(True) and "English only" in lang.chat_rule(True)
    assert "<<ZH>>" not in lang.chat_rule(False) and "Do not write any Chinese" in lang.chat_rule(False)


@pytest.mark.parametrize("sentence,expected", [
    ("Hello there. ", False),
    ("Hi 李华, nice to meet you.", False),  # a short name stays
    ("We use 苹果 here. ", False),
    ("你的发音很好。", True),  # fullwidth sentence punctuation
    ("中文:很好\n", True),  # mostly Chinese letters
    ("Great, 王小明和李华都来了", True),  # a run longer than four
    ("Hi 王小明", True),  # three of five letters are Chinese
    ("こんにちは everyone", True),  # kana count as Chinese letters
    ("Wait… really?", False),
])
def test_is_chinese(sentence, expected):
    assert lang.is_chinese(sentence) is expected


def test_sanitize_drops_chinese_sentences_from_their_first_chinese_character():
    assert lang.sanitize("Good job! 你的发音很好。Keep going.") == ("Good job! Keep going.", ["你的发音很好。"])
    assert lang.sanitize("Great!\n中文：很好\nTry again.") == ("Great!\nTry again.", ["中文：很好"])
    assert lang.sanitize("Chinese: 这个词的意思是放弃。") == ("Chinese: ", ["这个词的意思是放弃。"])
    assert lang.sanitize("Hi 李华, nice to meet you.") == ("Hi 李华, nice to meet you.", [])
    assert lang.sanitize("") == ("", [])


def test_split_marker_and_filter_hide_the_zh_line():
    assert lang.split_marker("Abandon means to leave.\n<<ZH>> 意思是放弃") == ("Abandon means to leave.", " 意思是放弃")
    assert lang.split_marker("No marker here ") == ("No marker here ", "")
    f = lang.MarkerFilter()
    out = "".join(f.feed(c) for c in ["Abandon means ", "to leave.\n<<Z", "H>> 意思", "是放弃"]) + f.flush()
    assert out == "Abandon means to leave." and f.tail == " 意思是放弃"
    g = lang.MarkerFilter()
    assert g.feed("a < b") + g.flush() == "a < b" and g.tail == ""  # a lone bracket is just text
    h = lang.MarkerFilter()
    assert h.feed("Ok «zh» 好") == "Ok" and h.tail == " 好"  # bracket variants and case, like <<META>>


def test_chain_with_the_tutor_meta_filter_keeps_note_and_meta_apart():
    raw = 'Nice!\n<<ZH>> 不错\n<<META>>{"verdict":"good"}'
    zh, gate = lang.MarkerFilter(), lang.SentenceGate()
    out = stream([StreamFilter(), zh, gate], list(raw))
    assert out == "Nice!" and lang.clean_note(zh.tail) == "不错" and gate.removed == []


def test_clean_and_resolve_note():
    assert lang.clean_note("  很好\n<b>  ") == "很好 ‹b›"
    assert lang.clean_note("很" * 100) == "很" * 80
    assert lang.clean_note(" ") is None and lang.clean_note(3) is None
    assert lang.resolve_note("auto", "模式", "标记", ["兜底"]) == "模式"
    assert lang.resolve_note("auto", "", " 标记 ", ["兜底"]) == "标记"
    assert lang.resolve_note("always", None, "", ["你好。", "再见。"]) == "你好。 再见。"
    assert lang.resolve_note("never", "模式", "标记", ["兜底"]) is None
    assert lang.resolve_note("auto", None, "", []) is None


POOL = ["Hello there. ", "Nice try! ", "Say it again?\n", "李华 is here. ", "你的发音很好。", "中文：很好\n",
        "We use 苹果 here. ", "<<ZH>> 意思是放弃", "<< zh >>补充", "«ZH» 说明", "3.5 is a number ", "Wait… ", "\n",
        "  ", "a < b ", "Hi 王小明", "!", "。"]


def _chunks(rng, text):
    if len(text) < 2:
        return [text]
    cuts = sorted(rng.sample(range(1, len(text)), k=min(len(text) - 1, rng.randint(0, 6))))
    return [text[i:j] for i, j in zip([0, *cuts], [*cuts, len(text)])]


def test_fuzz_any_split_equals_the_one_shot_result():
    rng = random.Random(20261012)
    for _ in range(3000):
        text = "".join(rng.choice(POOL) for _ in range(rng.randint(1, 8)))
        visible, tail = lang.split_marker(text)
        expected, removed = lang.sanitize(visible)
        zh, gate = lang.MarkerFilter(), lang.SentenceGate()
        assert stream([zh, gate], _chunks(rng, text)) == expected, text
        assert zh.tail == tail and gate.removed == removed, text


def test_fuzz_with_the_meta_filter_first():
    rng = random.Random(7)
    for _ in range(1000):
        text = "".join(rng.choice(POOL) for _ in range(rng.randint(1, 6))) + '\n<<META>>{"verdict":"ok"}'
        visible, tail = lang.split_marker(parse_meta(text)[0])
        expected, removed = lang.sanitize(visible)
        zh, gate = lang.MarkerFilter(), lang.SentenceGate()
        assert stream([StreamFilter(), zh, gate], _chunks(rng, text)) == expected, text
        assert zh.tail == tail and gate.removed == removed, text


def test_english_streams_through_without_waiting_for_the_sentence_end():
    gate = lang.SentenceGate()
    assert gate.feed("Hello") == "Hello" and gate.feed(" there") == " there"  # no added first-token delay
    assert gate.feed(" 你好") == " " and gate.flush() == ""  # held from the first Chinese character, then dropped
    assert gate.removed == ["你好"]
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_agents_lang.py` → FAIL(`ImportError: cannot import name 'lang'`)

- [ ] **Step 3: 实现** — `server/app/agents/lang.py`:

```python
"""回复语言(spec 2026-10-12-agents-addressing §5;计划 2026-10-12-agents-addressing-server L1)。纯函数,只用标准库。

- `want_note(setting, level)`:是否请模型写中文说明(用户设置 `zh_note` × 角色 / 题目水平,R-AS9)。
- `chat_rule(want)`:聊天模式(1:1 与联机的普通回合)的语言说明,编排器放在模式块之后(我们写的,不转义)。
- `MarkerFilter` / `split_marker`:`<<ZH>>` 及其后的内容边流边剥;标记可以被拆在多个增量里,括号变体与 `<<META>>` 一样宽容。
- `SentenceGate` / `sanitize`:兜底(R-AS10)。逐句判断是否「中文句」;中文句从第一个中文字符起不进公开文本、记进
  `removed`;英文句与只带短人名的句子原样放行。没有中文字符的文字立即放行,不增加首字延迟。
- `Chain`:把过滤器串起来(导师 `<<META>>` → `<<ZH>>` → 兜底)。
- `clean_note` / `resolve_note`:`note_zh` 清洗(≤ 80 字)与来源优先级(R-AS11)。
不变式:任意拆分下的流式输出 == 一次性输入的输出(`tests/test_agents_lang.py` 的模糊测试)。文本永不进日志。"""
import re

NOTE_MAX = 80
ZH_SETTINGS = ("auto", "always", "never")
NOTE_LEVELS = frozenset({"A1", "A2", "B1"})  # auto:A2 / B1 写中文说明(房间 A1 也算),B2 以上不写
RUN_MAX = 4  # 连续 ≤ 4 个中文字符当作人名 / 专有名词
COUNT_MAX = 8  # 一句里中文字符超过 8 个就是中文句
SHARE_MIN = 0.5  # 或:至少 3 个中文字符且占该句字母的一半以上
_WS = " \t\r\n"
_OPEN, _CLOSE = "<«‹＜〈《", ">»›＞〉》"
_CTRL = re.compile("[\\x00-\\x1f\\x7f-\\x9f  ]+")
# 句子边界:英文句末标点 + 空白,中文句末标点(可以没有空白),或换行。流式时只认后面还有字符的边界(贪婪量词已定)。
_BOUNDARY = re.compile(r"[.!?…]+[\"'”’)\]]*\s+|[。！？]+[\"'”’」』）)\]]*\s*|\n\s*")

CHAT_RULE_NOTE = (
    "Language: write your reply in simple English only, with no Chinese characters (a person's name may stay as "
    "written). If a short Chinese explanation would really help this learner, add it as the very last line in exactly "
    "this form: <<ZH>> <at most 40 Chinese characters>. That line is hidden from the reply and never read aloud.")
CHAT_RULE_EN = (
    "Language: write your reply in simple English only. Do not write any Chinese characters, not even a translation "
    "or a note.")


def want_note(setting: object, level: object) -> bool:
    if setting == "always":
        return True
    if setting == "never":
        return False
    return level in NOTE_LEVELS


def chat_rule(want: bool) -> str:
    return CHAT_RULE_NOTE if want else CHAT_RULE_EN


def _letter(ch: str) -> bool:
    """CJK 统一表意文字(含扩展 A、兼容区、扩展 B 起)与平假名 / 片假名。"""
    o = ord(ch)
    return (0x4E00 <= o <= 0x9FFF or 0x3400 <= o <= 0x4DBF or 0xF900 <= o <= 0xFAFF or 0x20000 <= o <= 0x2FA1F
            or 0x3040 <= o <= 0x30FF or 0x31F0 <= o <= 0x31FF)


def _punct(ch: str) -> bool:
    """CJK 符号与标点(U+3000–303F)与全角标点(不含全角字母、数字)。"""
    o = ord(ch)
    return (0x3000 <= o <= 0x303F or 0xFF01 <= o <= 0xFF0F or 0xFF1A <= o <= 0xFF20 or 0xFF3B <= o <= 0xFF40
            or 0xFF5B <= o <= 0xFF65)


def _first_zh(text: str) -> int | None:
    for i, ch in enumerate(text):
        if _letter(ch) or _punct(ch):
            return i
    return None


def is_chinese(sentence: str) -> bool:
    run = longest = count = letters = 0
    for ch in sentence:
        if _punct(ch):
            return True
        if _letter(ch):
            run += 1
            count += 1
            longest = max(longest, run)
        else:
            run = 0
        if ch.isalpha():
            letters += 1
    return longest > RUN_MAX or count > COUNT_MAX or (count >= 3 and count >= SHARE_MIN * letters)


def clean_note(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(_CTRL.sub(" ", value).replace("<", "‹").replace(">", "›").split())[:NOTE_MAX].strip()
    return text or None


def resolve_note(setting: object, mode_note: object, marker_note: object, removed: list[str]) -> str | None:
    """`never` = 永远没有中文说明;否则取第一个非空来源:模式 META 的 `note_zh` → `<<ZH>>` 行 → 被拿掉的中文片段。"""
    if setting == "never":
        return None
    for candidate in (mode_note, marker_note, " ".join(removed)):
        note = clean_note(candidate)
        if note:
            return note
    return None


def _marker(word: str) -> re.Pattern:
    return re.compile(rf"[{_OPEN}]+\s{{0,8}}{re.escape(word)}\s{{0,8}}[{_CLOSE}]+", re.IGNORECASE)


def _partial(word: str) -> re.Pattern:
    """缓冲区末尾「可能是标记开头」的部分(`<`、`<<Z`、`<< ZH ` …),与 tutor.parse 的 `_PARTIAL` 同一写法。"""
    inner = ""
    for ch in reversed(word):
        inner = re.escape(ch) + (f"(?:{inner})?" if inner else r"(?:\s{0,8})?")
    return re.compile(rf"[{_OPEN}]+(?:\s{{0,8}}(?:{inner})?)?$", re.IGNORECASE)


_ZH, _ZH_PARTIAL = _marker("ZH"), _partial("ZH")


def split_marker(text: str) -> tuple[str, str]:
    """一次性版本:(标记前的可见文字,去掉尾随空白;标记后的原文);没有标记 → (原文, "")。"""
    text = text or ""
    found = _ZH.search(text)
    if found is None:
        return text, ""
    return text[: found.start()].rstrip(_WS), text[found.end():]


class MarkerFilter:
    """`<<ZH>>` 流式过滤,每回合一个实例。`tail` 是标记之后的原文(回合结束后是 `note_zh` 的候选)。"""

    def __init__(self) -> None:
        self._pending = ""
        self._tail: str | None = None

    @property
    def tail(self) -> str:
        return self._tail or ""

    @staticmethod
    def _hold(buf: str) -> int:
        found = _ZH_PARTIAL.search(buf)
        j = found.start() if found is not None else len(buf)
        while j > 0 and buf[j - 1] in _WS:
            j -= 1
        return len(buf) - j

    def feed(self, chunk: str) -> str:
        if not chunk:
            return ""
        if self._tail is not None:
            self._tail += chunk
            return ""
        buf = self._pending + chunk
        found = _ZH.search(buf)
        if found is not None:
            self._tail, self._pending = buf[found.end():], ""
            return buf[: found.start()].rstrip(_WS)
        cut = len(buf) - self._hold(buf)
        self._pending = buf[cut:]
        return buf[:cut]

    def flush(self) -> str:
        if self._tail is not None:
            return ""
        out, self._pending = self._pending, ""
        return out


class SentenceGate:
    """中文句兜底(R-AS10),每回合一个实例。`removed` 是被拿掉的中文片段(按出现顺序)。"""

    def __init__(self) -> None:
        self._buf = ""  # 当前未结束的句子:已放行的前缀 + 暂扣的部分
        self._sent = 0  # _buf 里已放行的字符数
        self.removed: list[str] = []

    def feed(self, chunk: str) -> str:
        if not chunk:
            return ""
        self._buf += chunk
        out: list[str] = []
        while True:
            found = _BOUNDARY.search(self._buf)
            if found is None or found.end() >= len(self._buf):
                break
            out.append(self._finish(self._buf[: found.end()]))
            self._buf, self._sent = self._buf[found.end():], 0
        out.append(self._eager())
        return "".join(out)

    def flush(self) -> str:
        out = self._finish(self._buf) if self._buf else ""
        self._buf, self._sent = "", 0
        return out

    def _eager(self) -> str:
        stop = _first_zh(self._buf)
        end = len(self._buf) if stop is None else stop
        if end <= self._sent:
            return ""
        out, self._sent = self._buf[self._sent:end], end
        return out

    def _finish(self, sentence: str) -> str:
        stop = _first_zh(sentence)
        if stop is not None and is_chinese(sentence):
            rest = sentence[stop:].strip()
            if rest:
                self.removed.append(rest)
            return sentence[self._sent:stop] if stop > self._sent else ""
        return sentence[self._sent:]


def sanitize(text: str) -> tuple[str, list[str]]:
    """一次性版本(落库前的公开文本):(保留的文字, 被拿掉的中文片段)。"""
    gate = SentenceGate()
    out = gate.feed(text or "") + gate.flush()
    return out, gate.removed


class Chain:
    """依次经过每个过滤器(`feed` / `flush` 协议同 orchestrator.StreamFilter)。"""

    def __init__(self, *filters) -> None:
        self._filters = filters

    def feed(self, chunk: str) -> str:
        for f in self._filters:
            if not chunk:
                return ""
            chunk = f.feed(chunk)
        return chunk

    def flush(self) -> str:
        carry = ""
        for f in self._filters:
            carry = (f.feed(carry) if carry else "") + f.flush()
        return carry
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_agents_lang.py tests/test_architecture.py` → PASS(模糊测试若失败,打印的 `text` 就是反例:先修 `SentenceGate` / `MarkerFilter`,不要改断言)

- [ ] **Step 5: 提交**

```bash
git add server/app/agents/lang.py server/tests/test_agents_lang.py
git commit -m "feat(server): reply language rules, <<ZH>> filter and Chinese sentence fallback (agents lang)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task L2: `trace.py`:`Done.note_zh`、压缩过程与回存校验

**Files:**
- Modify: `server/app/agents/trace.py`
- Test: `server/tests/test_agents_trace.py`(追加)

**Interfaces:**
- Produces: `trace.NOTE_MAX = 80`;`Done(text_len, trace, usage=None, note_zh=None)`,`to_dict()` 只在有值时带 `note_zh`;`compact_trace(outcomes, tools, thought, *, ms=None, note_zh=None)`;`check_stored` 接受 `note_zh: str(≤ 80) | None`

- [ ] **Step 1: 写失败测试** — `server/tests/test_agents_trace.py` 末尾追加:

```python
def test_done_carries_an_optional_note_and_the_compact_trace_keeps_it():
    from app.agents import trace as T

    assert "note_zh" not in T.Done(text_len=3, trace={"v": 1}).to_dict()
    assert T.Done(text_len=3, trace={"v": 1}, note_zh="意思是放弃").to_dict()["note_zh"] == "意思是放弃"
    assert T.compact_trace([], "prefetch", None, note_zh="很好" * 50)["note_zh"] == ("很好" * 50)[:80]
    assert "note_zh" not in T.compact_trace([], "prefetch", None)
    huge = {"v": 1, "tools": "prefetch", "note_zh": "很好", "steps": [
        {"key": "k" * 400, "group": "tool", "status": "done", "ms": 1, "private": False, "label": "l"}
        for _ in range(20)]}
    assert T.fit(huge) == {"v": 1, "tools": "prefetch", "steps": [], "truncated": True, "note_zh": "很好"}


def test_stored_trace_accepts_a_short_note_only():
    import pytest

    from app.agents import trace as T

    base = {"v": 1, "tools": "prefetch", "steps": []}
    assert T.check_stored({**base, "note_zh": "很好"})["note_zh"] == "很好"
    assert T.check_stored({**base, "note_zh": None})["note_zh"] is None
    for bad in ("很" * 81, 3, ["x"]):
        with pytest.raises(ValueError):
            T.check_stored({**base, "note_zh": bad})
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_agents_trace.py` → FAIL(`TypeError: ... unexpected keyword argument 'note_zh'`)

- [ ] **Step 3: 实现** — `server/app/agents/trace.py`:

`STEPS_KEEP = 12` 之后加一行:

```python
NOTE_MAX = 80  # note_zh(spec 2026-10-12-agents-addressing §5.1):不朗读的中文说明,≤ 80 字
```

`class Done` 整体替换为:

```python
@dataclass(frozen=True)
class Done(Event):
    type: ClassVar[str] = "done"
    text_len: int
    trace: dict
    usage: tuple[int, int] | None = None
    note_zh: str | None = None  # addressing §5.2:不进公开文本的中文说明(可选键,缺省 = 没有)

    def to_dict(self) -> dict:
        out = {"text_len": self.text_len, "trace": self.trace}
        if self.usage is not None:
            out["usage"] = {"in": self.usage[0], "out": self.usage[1]}
        if self.note_zh:
            out["note_zh"] = self.note_zh
        return out
```

`compact_trace` 的签名与末尾改为:

```python
def compact_trace(outcomes, tools: str, thought: Thought | None, *, ms: dict | None = None,
                  note_zh: str | None = None) -> dict:
```

并在 `if ms:` 块之后、`return fit(out)` 之前加:

```python
    if note_zh:
        out["note_zh"] = note_zh[:NOTE_MAX]  # R-AS12:随 assistant 消息回存进 messages.agent_trace
```

`fit` 的最后一行替换为:

```python
    last = {"v": TRACE_VERSION, "tools": t.get("tools", ""), "steps": [], "truncated": True}
    if isinstance(t.get("note_zh"), str):
        last["note_zh"] = t["note_zh"]
    return last
```

`TRACE_KEYS` 改为:

```python
TRACE_KEYS = frozenset({"v", "tools", "steps", "thought", "ms", "truncated", "note_zh"})
```

`_stored_ok` 的最后一行替换为:

```python
    note = raw.get("note_zh")
    if note is not None and not _text(note, NOTE_MAX):
        return False
    return "truncated" not in raw or isinstance(raw["truncated"], bool)
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_agents_trace.py tests/test_agents_trace_stored_review.py tests/test_conversations_agent_trace.py` → PASS

- [ ] **Step 5: 提交**

```bash
git add server/app/agents/trace.py server/tests/test_agents_trace.py
git commit -m "feat(server): optional note_zh on agent done events and stored traces

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task L3: 用户设置 `zh_note` 与内置角色「只用英文」

**Files:**
- Modify: `server/app/agents/settings.py`、`server/app/agents/personas.py`
- Test: `server/tests/test_agents_settings.py`、`server/tests/test_agents_personas.py`(修改 + 追加)

**Interfaces:**
- Produces: `settings.ZH_NOTES = ("auto", "always", "never")`;`AgentSettings.zh_note: str = "auto"`;`AgentSettings.out()["zh_note"]`;严格合并时非法值 → `SettingsInvalid("zh_note")`,宽松读取时丢弃;`personas.ENGLISH_ONLY`

- [ ] **Step 1: 写失败测试**

`server/tests/test_agents_settings.py`:`test_defaults_output` 的期望字典末尾(`"process_default": "collapsed"` 之前)加 `"zh_note": "auto", `;`test_strict_merge_rejects` 的参数表在 `({"whatever": True}, "unknown"),` 之前加两行:

```python
    ({"zh_note": "sometimes"}, "zh_note"),
    ({"zh_note": 1}, "zh_note"),
```

文件末尾追加:

```python
def test_zh_note_values_and_lenient_reads():
    from app.agents import lang

    assert S.ZH_NOTES == lang.ZH_SETTINGS
    assert S.merge(S.DEFAULTS, {"zh_note": "never"}, strict=True).zh_note == "never"
    assert S.merge(S.DEFAULTS, {"zh_note": "loud"}, strict=False).zh_note == "auto"  # a stale value is dropped
```

`server/tests/test_agents_personas.py` 末尾追加:

```python
def test_builtin_personas_reply_in_english_only():
    assert all("English only" in p.prompt for p in P.builtin_personas())
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_agents_settings.py tests/test_agents_personas.py` → FAIL

- [ ] **Step 3: 实现**

`server/app/agents/settings.py` — `FLAGS = (...)` 之后:

```python
ZH_NOTES = ("auto", "always", "never")  # addressing §5.1:auto = 角色 / 题目水平 A2、B1 时写中文说明
```

`AgentSettings` 在 `tutor: dict = field(default_factory=_tutor_default)` 之后加:

```python
    zh_note: str = "auto"
```

`out()` 的返回字典在 `"process_default": PROCESS_DEFAULT` 之前加 `"zh_note": self.zh_note, `。`_check` 里 `if key == "process_default":` 之前加:

```python
    if key == "zh_note":
        if not isinstance(value, str) or value not in ZH_NOTES:
            raise SettingsInvalid("zh_note")
        return value
```

`server/app/agents/personas.py` — `REVIEWER_FALLBACK = (...)` 之后加:

```python
ENGLISH_ONLY = "Reply in English only."  # addressing §5.2 / R-AS14:中文人设保留,回复只用英文
```

`_builtins()` 的 `items = [...]` 前三项替换为:

```python
    items = [
        _builtin("coach", str(coach.get("name") or "英语教练"), str(coach.get("description") or "生成地道的美式英语"),
                 "concise", text(coach, COACH_FALLBACK) + "\n\n" + ENGLISH_ONLY),
        _builtin("partner", "聊天伙伴", "轻松的英语日常对话,每次三句以内", "friendly", PARTNER_PROMPT + " " + ENGLISH_ONLY),
        _builtin("reviewer", "写作批改", "逐句分析你的英文写作并给出正式建议", "strict",
                 text(reviewer, REVIEWER_FALLBACK) + "\n\n" + ENGLISH_ONLY),
    ]
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_agents_settings.py tests/test_agents_personas.py tests/test_agents_api.py` → PASS(`test_agents_api.py` 若断言了设置的完整字典,在其中补 `"zh_note": "auto"`)

- [ ] **Step 5: 提交**

```bash
git add server/app/agents/settings.py server/app/agents/personas.py server/tests/test_agents_settings.py server/tests/test_agents_personas.py
git commit -m "feat(server): zh_note agent setting and English-only built-in personas

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task L4: 提示词语言说明 + 编排器串联过滤与 `note_zh`(单独评审)

**Files:**
- Modify: `server/app/agents/prompt.py`、`server/app/agents/orchestrator.py`
- Test: `server/tests/test_agents_prompt.py`、`server/tests/test_agents_orchestrator.py`(追加)

**Interfaces:**
- Produces: `prompt.turn_message(text, blocks, mode_block, lang_block=None)`、`prompt.build_messages(..., lang_block=None)`;`ROOM_LINE` 含 `Reply in English only.`;`run_turn` 的 `Done.note_zh` 与 `Done.trace["note_zh"]`;`mode.finish` 返回字典里的 `note_zh` 被编排器取走(不进 `Meta`);`mode.prepare(req)` 收到的 `req.agent_settings` 总是已加载的提问者设置
- Consumes: `lang.Chain` / `MarkerFilter` / `SentenceGate` / `chat_rule` / `want_note` / `resolve_note`(L1)、`trace.Done.note_zh` / `compact_trace(note_zh=)`(L2)、`AgentSettings.zh_note`(L3)

- [ ] **Step 1: 写失败测试**

`server/tests/test_agents_prompt.py` 末尾追加:

```python
def test_language_rule_sits_between_the_mode_block_and_the_context():
    msg = prompt.turn_message("hi", [("learned_words", "abandon")], "MODE", lang_block="LANG")
    assert msg.index("MODE") < msg.index("LANG") < msg.index("<context>") < msg.index("<user_message>")
    assert prompt.turn_message("hi", [], None, lang_block=None) == prompt.turn_message("hi", [], None)
    assert "Reply in English only." in prompt.ROOM_LINE
```

`server/tests/test_agents_orchestrator.py` 末尾追加(文件已导入 `dataclasses`、`trace`、`ModeBlock`、`ModeRegistry`、`builtin_by_id`、`DEFAULTS`):

```python
from app.agents.orchestrator import PassThrough  # noqa: E402


class NoteMode:
    name = "tutor"

    async def prepare(self, req):
        return ModeBlock(text="Tutor block.", user_text="go")

    def stream_filter(self):
        return PassThrough()

    async def finish(self, req, full_text):
        return {"step_index": 1, "steps_total": 3, "note_zh": "说得好"}


async def test_the_zh_line_is_hidden_and_becomes_the_note(app):
    fake = await setup(app, fake=FakeLLM(["Abandon means ", "to leave.\n<<Z", "H>> 意思是放弃。"]))
    deps, _ = make_deps(app)
    events = await run_events(deps, make_request(UID, text="what is abandon"))
    assert "".join(e.text for e in events if isinstance(e, trace.Delta)) == "Abandon means to leave."
    done = events[-1]
    assert done.note_zh == "意思是放弃。" and done.trace["note_zh"] == "意思是放弃。"
    content = fake.requests[0]["messages"][-1]["content"]
    assert "<<ZH>>" in content and content.index("Language:") < content.index("<user_message>")  # B1 + auto


async def test_stray_chinese_sentences_move_out_of_the_reply(app):
    await setup(app, fake=FakeLLM(["Good job! ", "你的发音很好。", "Keep going."]))
    deps, _ = make_deps(app)
    events = await run_events(deps, make_request(UID))
    assert "".join(e.text for e in events if isinstance(e, trace.Delta)) == "Good job! Keep going."
    assert events[-1].note_zh == "你的发音很好。"


async def test_never_means_no_note_and_an_english_only_instruction(app):
    fake = await setup(app, fake=FakeLLM(["Fine.", "\n<<ZH>> 好"]))
    deps, _ = make_deps(app)
    events = await run_events(deps, make_request(UID, agent_settings=dataclasses.replace(DEFAULTS, zh_note="never")))
    done = events[-1]
    assert done.note_zh is None and "note_zh" not in done.trace and "note_zh" not in done.to_dict()
    content = fake.requests[0]["messages"][-1]["content"]
    assert "<<ZH>>" not in content and "Do not write any Chinese" in content


async def test_auto_note_follows_the_persona_level(app):
    fake = await setup(app)
    deps, _ = make_deps(app)
    b2 = dataclasses.replace(builtin_by_id("builtin:partner"), level="B2")
    await run_events(deps, make_request(UID, persona=b2))
    assert "<<ZH>>" not in fake.requests[0]["messages"][-1]["content"]


async def test_a_mode_note_wins_and_never_reaches_meta(app):
    fake = await setup(app, fake=FakeLLM(["Well done. ", "很好。"]))
    modes = ModeRegistry()
    modes.register(NoteMode())
    deps, _ = make_deps(app, modes=modes)
    events = await run_events(deps, make_request(UID, mode="tutor", text=None))
    assert "".join(e.text for e in events if isinstance(e, trace.Delta)) == "Well done. "
    meta = next(e for e in events if isinstance(e, trace.Meta))
    assert "note_zh" not in meta.to_dict() and events[-1].note_zh == "说得好"
    assert "Language:" not in fake.requests[0]["messages"][-1]["content"]  # tutor blocks carry their own rule
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_agents_prompt.py tests/test_agents_orchestrator.py` → FAIL

- [ ] **Step 3: 实现**

`server/app/agents/prompt.py`:

```python
ROOM_LINE = ("You are in a shared practice room: every member can read your reply. Reply in English only. Never read "
             "out the asker's personal learning data item by item.")
```

`turn_message` 与 `build_messages` 替换为:

```python
def turn_message(text: str | None, blocks: list[tuple[str, str]], mode_block: str | None,
                 lang_block: str | None = None) -> str:
    parts = []
    if mode_block and mode_block.strip():
        parts.append(mode_block.strip())  # ours (tutor instructions), never user text
    if lang_block and lang_block.strip():
        parts.append(lang_block.strip())  # ours (addressing §5.2 language rule), never user text
    lines = [f"[{key}] {escape(block)}" for key, block in blocks if block]
    if lines:
        parts.append(CONTEXT_HEADER + "\n<context>\n" + "\n".join(lines) + "\n</context>")
    parts.append(f"<user_message>\n{escape(text)}\n</user_message>" if text is not None else OPENING_LINE)
    return "\n\n".join(parts)


def build_messages(persona: Persona, *, memory_block: str | None, blocks: list[tuple[str, str]], history: list[dict],
                   text: str | None, mode_block: str | None = None, in_room: bool = False,
                   lang_block: str | None = None) -> list[dict]:
    """`history` 应已经 clamp_history 过(编排器按 AGENTS_HISTORY_MAX 夹取)。"""
    return [{"role": "system", "content": system_message(persona, memory_block, in_room=in_room)},
            *({"role": m["role"], "content": m["content"]} for m in history),
            {"role": "user", "content": turn_message(text, blocks, mode_block, lang_block)}]
```

`server/app/agents/orchestrator.py`:

导入区:`import contextlib` 之后加 `import dataclasses`;`from app.agents import limits, prompt, trace` 改为 `from app.agents import lang, limits, prompt, trace`。

`_charged` 里 `agent = await agent_settings.load(session, req.user_id)` 所在的 `if agent is None:` 块之后加:

```python
    if req.agent_settings is not agent:  # R-AS9:模式(导师)从 req 读提问者的 zh_note
        req = dataclasses.replace(req, agent_settings=agent)
```

`messages = prompt.build_messages(...)` 与 `flt = mode.stream_filter()` 两句替换为:

```python
    lang_block = lang.chat_rule(lang.want_note(agent.zh_note, req.persona.level)) if req.mode == "chat" else None
    messages = prompt.build_messages(req.persona, memory_block=memory_block, blocks=blocks, history=history,
                                     text=req.text if req.text is not None else block.user_text, mode_block=block.text,
                                     in_room=req.in_room, lang_block=lang_block)
    zh_filter, gate = lang.MarkerFilter(), lang.SentenceGate()
    flt = lang.Chain(mode.stream_filter(), zh_filter, gate)  # 模式的 <<META>> → <<ZH>> → 中文句兜底(R-AS10)
```

`reply = "".join(shown)` 起到 `yield trace.Done(...)` 的部分替换为(只改 `mode_note`、`note`、`compact_trace`、`Done` 四处,其余逐字保留):

```python
    reply = "".join(shown)
    meta = None
    mode_note = None
    try:
        found = await mode.finish(req, "".join(raw))
        if isinstance(found, dict) and "note_zh" in found:  # R-AS11:中文说明不进 meta 事件
            mode_note, found = found["note_zh"], {k: v for k, v in found.items() if k != "note_zh"}
        meta = trace.Meta.from_dict(found) if found else None
    except ModeError as e:  # AX-1:the text already streamed (no refund); the client gets the code instead of done
        logger.warning("agents mode finish failed mode=%s error=ModeError", mode.name)
        stats["status"] = _error(e.code).code
        yield _error(e.code)
        return
    except Exception as e:  # noqa: BLE001 - a broken finish never hides the reply
        logger.warning("agents mode finish failed mode=%s error=%s", mode.name, type(e).__name__)
    if meta is not None:
        yield meta
    note = lang.resolve_note(agent.zh_note, mode_note, zh_filter.tail, gate.removed)
    thought = trace.Thought("reasoning", "".join(thinking)) if thinking else None
    total = _ms(deps.clock, t0)
    compact = trace.compact_trace([persona_done, *outcomes, history_done], tools_mode, thought,
                                  ms={"ctx": stats["ctx_ms"], "ttft": stats["ttft_ms"], "total": total}, note_zh=note)
    stats.update(status="ok", chars=len(reply))
    record = TurnRecord(turn_id=turn_id, user_id=req.user_id, persona_id=req.persona.id,
                        conversation_id=req.conversation_id, room_id=req.room_id, mode=req.mode,
                        tutor_session_id=req.tutor_session_id, in_room=req.in_room, text=req.text, reply=reply,
                        history_len=len(history), usage=usage_tokens, at=now)
    spawn = deps.spawn or _spawn_default
    for hook in list(deps.hooks.after_turn):
        spawn(_guarded(hook, record))
    yield trace.Done(text_len=len(reply), trace=compact, usage=usage_tokens, note_zh=note)
```

模块文档串第一段末尾补一句:「回复语言:聊天模式在模式块之后加 `lang.chat_rule`;流经 `模式过滤器 → <<ZH>> → 中文句兜底`;`note_zh` 只进 `Done` 与压缩过程。」

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_agents_prompt.py tests/test_agents_orchestrator.py tests/test_agents_turn_api.py tests/test_agents_turn_review.py tests/test_agents_tutor_turn.py` → PASS。`test_agents_tutor_turn.py` 里 `reply()` 的「简评」行此时会被兜底拿掉,`deltas(...).endswith(...)` 仍成立;若有断言失败,先确认是不是断言了含中文的可见文本——是就留给 T3(T3 改写 `reply()`),在本任务里把那一处断言改为不含中文行的子串。

- [ ] **Step 5: 提交**

```bash
git add server/app/agents/prompt.py server/app/agents/orchestrator.py server/tests/test_agents_prompt.py server/tests/test_agents_orchestrator.py
git commit -m "feat(server): English-only chat rule, <<ZH>> stripping and note_zh in agent turns

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task L5: 智能体契约重录与隐私断言

**Files:**
- Modify: `server/tests/test_agents_contract.py`、`server/tests/test_agents_privacy.py`(追加)
- Re-record: `server/tests/fixtures/agents_contract.json`

**Interfaces:**
- Produces(夹具):`turn_sse` 的 `done` 带 `note_zh` 与 `trace.note_zh`;`events.done.note_zh`;`settings.zh_note`;`message_with_trace.agent_trace.note_zh`

- [ ] **Step 1: 改测试**

`server/tests/test_agents_contract.py`:`await use_fake_llm(app, FakeLLM(["Hello", " there."], reasoning=["Thinking about tense."]))` 改为:

```python
    await use_fake_llm(app, FakeLLM(["Hello", " there.", "\n<<ZH>> 你好。"], reasoning=["Thinking about tense."]))
```

在 `tried = (await client.post("/api/agents/personas/try", ...` 这一句**之前**插入(persona try 是非流式、不是回合,不走过滤,R-AS17 / 不做):

```python
    await use_fake_llm(app, FakeLLM(["Hello", " there."]))
```

在 `check_contract(...)` 之前插入:

```python
    assert by_type["done"]["note_zh"] == "你好。" and by_type["done"]["trace"]["note_zh"] == "你好。"
    assert settings["zh_note"] == "auto" and message["messages"][0]["agent_trace"]["note_zh"] == "你好。"
    assert "".join(d["text"] for e, d in events if e == "delta") == "Hello there."
```

`server/tests/test_agents_privacy.py` 末尾追加:

```python
async def test_zh_notes_and_dropped_chinese_never_reach_the_logs(app, client, auth_headers, caplog):
    from tests.agents_helpers import FakeLLM, enable_agents, new_conversation, parse_sse, turn_body, use_fake_llm

    caplog.set_level(logging.DEBUG, logger="app")
    await use_fake_llm(app, FakeLLM(["Fine. ", "秘密句子很长很长很长。", "\n<<ZH>> 秘密说明"]))
    enable_agents(app)
    conv = await new_conversation(client, auth_headers)
    r = await client.post("/api/agents/turn", headers=auth_headers, json=turn_body(conv, text="NOTE-PRIVATE-1"))
    done = next(d for e, d in parse_sse(r.text) if e == "done")
    assert done["note_zh"] == "秘密说明"
    text = "\n".join(rec.getMessage() for rec in caplog.records if rec.name.startswith("app"))
    assert "秘密" not in text and "NOTE-PRIVATE-1" not in text
```

- [ ] **Step 2: 跑测试确认契约失败** — Run: `cd server && uv run pytest -q tests/test_agents_contract.py` → FAIL(形状多出 `note_zh` / `zh_note`)

- [ ] **Step 3: 重录** — Run: `cd server && CONTRACT_UPDATE=1 uv run pytest -q tests/test_agents_contract.py`(PowerShell 写法见 Global Constraints),再不带变量跑一次 → PASS;`git diff tests/fixtures/agents_contract.json` 只应出现 `note_zh`、`zh_note` 与 `<<ZH>>` 相关的 `requests` 无关差异(夹具不含请求体)。

- [ ] **Step 4: 跑相关测试** — Run: `cd server && uv run pytest -q tests/test_agents_contract.py tests/test_agents_privacy.py` → PASS

- [ ] **Step 5: 提交**

```bash
git add server/tests/test_agents_contract.py server/tests/test_agents_privacy.py server/tests/fixtures/agents_contract.json
git commit -m "test(server): re-record agents contract with note_zh and zh_note; privacy check for notes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

## Lane T · 导师(1:1 与联机的 `note_zh` / `hint_zh`,带练语音作答)

### Task T1: `<<META>>` 解析:`note_zh`、`hint_zh`(纯模块)

**Files:**
- Modify: `server/app/agents/tutor/parse.py`
- Test: `server/tests/test_agents_tutor_parse.py`(追加;导入行加 `MAX_NOTE`)

**Interfaces:**
- Produces: `parse.MAX_NOTE = 80`;`Meta(verdict, kind, next_focus, hint, say, done, note_zh="", hint_zh="")`(新字段排在最后,旧的位置参数与相等比较不变);`parse_meta` 填它们(缺失 / 非字符串 → `""`,清洗与 `hint` 同一规则,截 80 字);`resolve` 原样保留它们;`StreamFilter` 不改(中文字段在 `<<META>>` 之后,本来就不放行)
- 纯模块不导入 `app.agents.lang`(`test_tutor_core_modules_are_pure`):80 字上限在这里再写一次

- [ ] **Step 1: 写失败测试** — `server/tests/test_agents_tutor_parse.py` 顶部导入改为 `from app.agents.tutor.parse import _MARK, META_MARKER, MAX_NOTE, Meta, StreamFilter, parse_meta, resolve`,文件末尾追加:

```python
def test_parse_note_zh_and_hint_zh_clip_and_default_to_empty():
    text = ('Nice!\n<<META>>{"verdict":"good","hint":"Start with when.","hint_zh":"先说什么时候","note_zh":"表达很自然",'
            '"done":false}')
    visible, meta = parse_meta(text)
    assert visible == "Nice!"
    assert (meta.hint, meta.hint_zh, meta.note_zh) == ("Start with when.", "先说什么时候", "表达很自然")
    _, long = parse_meta('x<<META>>{"note_zh":"' + "很" * 200 + '","hint_zh":7}')
    assert long.note_zh == "很" * MAX_NOTE and long.hint_zh == ""
    for raw in ('{"verdict":"ok"}', '{"note_zh":["a"],"hint_zh":{"a":1}}', '{"note_zh":null}'):
        _, plain = parse_meta("x<<META>>" + raw)
        assert (plain.note_zh, plain.hint_zh) == ("", ""), raw
    _, angle = parse_meta('x<<META>>{"note_zh":"a <b> c"}')
    assert angle.note_zh == "a ‹b› c"  # same look-alike rule as every other META text


def test_resolve_keeps_the_chinese_fields_and_the_filter_still_hides_them():
    meta = Meta(verdict="weak", note_zh="再试一次", hint_zh="慢一点")
    assert resolve(meta, answering=False) == (Meta(verdict=None, note_zh="再试一次", hint_zh="慢一点"), False)
    assert resolve(Meta(note_zh="n"), answering=True)[0].note_zh == "n"
    assert resolve(None, answering=True)[0].note_zh == ""
    full = 'Good.\n<<META>>{"verdict":"good","hint_zh":"提示","note_zh":"不错"}'
    out, f = run([full[i:i + 3] for i in range(0, len(full), 3)])
    assert out == "Good." and "提示" in f.tail and "不错" in f.tail  # the tail is the META JSON: never visible
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_agents_tutor_parse.py` → FAIL(`ImportError: cannot import name 'MAX_NOTE'`)

- [ ] **Step 3: 实现** — `server/app/agents/tutor/parse.py`:

`MAX_FOCUS, MAX_HINT, MAX_SAY = 60, 120, 160` 之后加:

```python
MAX_NOTE = 80  # note_zh / hint_zh:不朗读的中文说明(与 app.agents.lang.NOTE_MAX 同值;纯模块不导入 lang)
```

`Meta` 整体替换为:

```python
@dataclass(frozen=True)
class Meta:
    verdict: str | None = None
    kind: str | None = None
    next_focus: str = ""
    hint: str = ""  # 英文提示(spec addressing §5.2)
    say: str = ""
    done: bool = False
    note_zh: str = ""  # 对用户回答的中文点评,≤ 80 字,不进可见文本
    hint_zh: str = ""  # 当前题的中文提示(可选)
```

`parse_meta` 末尾的 `return visible, Meta(...)` 替换为:

```python
    return visible, Meta(
        verdict=verdict if isinstance(verdict, str) and verdict in VERDICTS else None,
        kind=kind if isinstance(kind, str) and kind in KINDS else None,
        next_focus=_text(data.get("next_focus"), MAX_FOCUS),
        hint=_text(data.get("hint"), MAX_HINT),
        say=_text(data.get("say"), MAX_SAY),
        done=data.get("done") is True,
        note_zh=_text(data.get("note_zh"), MAX_NOTE),
        hint_zh=_text(data.get("hint_zh"), MAX_NOTE),
    )
```

模块文档串第一段末尾补一句:「`note_zh` / `hint_zh` 是 META 里可选的中文字段(缺失 / 非法 → 空串)。」

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_agents_tutor_parse.py tests/test_architecture.py` → PASS(`test_fuzz_chunk_splits_*` 不变,因为过滤器没改)

- [ ] **Step 5: 提交**

```bash
git add server/app/agents/tutor/parse.py server/tests/test_agents_tutor_parse.py
git commit -m "feat(server): tutor META parses note_zh and hint_zh

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task T2: 状态机里的 `hint_zh`(纯模块)

**Files:**
- Modify: `server/app/agents/tutor/machine.py`
- Test: `server/tests/test_agents_tutor_machine.py`(追加)

**Interfaces:**
- Produces: `TutorState.hint_zh: str = ""`(排在 `say` 之后);`Asked(hint="", say="", hint_zh="")`;`Answered(verdict, hint="", say="", hint_zh="")`;`to_dict` 多键 `hint_zh`;`from_dict` 读它(缺失 = `""`,所以 0016 时代的旧快照照常读);提示 / 跳过 / 结束不改写它,`weak` 重试保留旧值除非事件带新值,晋级 / 跳过 / 收尾按题重置

- [ ] **Step 1: 写失败测试** — `server/tests/test_agents_tutor_machine.py` 末尾追加:

```python
def test_hint_zh_follows_the_hint_through_the_machine():
    s = next_state(new_state(plan_of("ask", "ask", "ask"), "B1"), Asked("Start with when.", hint_zh="先说什么时候"))
    assert (s.phase, s.hint_text, s.hint_zh) == ("await_answer", "Start with when.", "先说什么时候")
    assert next_state(s, HintUsed()).hint_zh == "先说什么时候"  # asking for a hint never rewrites it
    moved = next_state(s, Answered("good", hint="Use the past tense.", hint_zh="用过去式"))
    assert (moved.index, moved.hint_text, moved.hint_zh) == (1, "Use the past tense.", "用过去式")
    assert next_state(moved, Skipped()).hint_zh == ""  # a skip moves on without a hint
    last = next_state(next_state(moved, Answered("ok", hint="h", hint_zh="提")), Answered("ok", hint="x", hint_zh="y"))
    assert (last.phase, last.hint_text, last.hint_zh) == ("wrap_up", "", "")  # nothing left to hint


def test_a_weak_retry_keeps_the_old_chinese_hint_unless_a_new_one_comes():
    s = next_state(new_state(plan_of("repeat", "ask"), "B1"), Asked("Say it slowly.", hint_zh="慢慢说"))
    again = next_state(s, Answered("weak"))
    assert (again.index, again.repeats, again.hint_zh) == (0, 1, "慢慢说")
    better = next_state(s, Answered("weak", hint="Word by word.", hint_zh="一个词一个词"))
    assert (better.hint_text, better.hint_zh) == ("Word by word.", "一个词一个词")


def test_hint_zh_round_trips_and_old_snapshots_default_to_empty():
    s = next_state(new_state(plan_of("ask", "ask"), "B1"), Asked("h", hint_zh="提示"))
    assert to_dict(s)["hint_zh"] == "提示" and from_dict(to_dict(s)) == s
    old = to_dict(s)
    old.pop("hint_zh")
    assert from_dict(old).hint_zh == ""
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_agents_tutor_machine.py` → FAIL(`TypeError: Asked.__init__() got an unexpected keyword argument 'hint_zh'`)

- [ ] **Step 3: 实现** — `server/app/agents/tutor/machine.py`:

`TutorState` 的 `say` 之后加一行:

```python
    hint_zh: str = ""    # 模型给当前题的中文提示(META hint_zh;只随带练帧 / 提示端点下发,不进可见文本)
```

`Asked`、`Answered` 替换为:

```python
@dataclass(frozen=True)
class Asked:
    """智能体出了当前题(开场或跳过之后)。"""
    hint: str = ""
    say: str = ""
    hint_zh: str = ""


@dataclass(frozen=True)
class Answered:
    """模型对用户回答的评级;hint / say / hint_zh 属于下一题。"""
    verdict: str
    hint: str = ""
    say: str = ""
    hint_zh: str = ""
```

`_advance` 替换为:

```python
def _advance(state: TutorState, answer: Answer, next_phase: str, verdict: str, hint: str, say: str,
             hint_zh: str = "") -> TutorState:
    good, weak, level = _streaks(state, verdict)
    answers = state.answers + (answer,)
    if is_last(state):
        return replace(state, phase="wrap_up", answers=answers, streak_good=good, streak_weak=weak, level=level,
                       hints=0, repeats=0, hint_text="", hint_zh="", say="")
    nxt = state.index + 1
    return replace(state, phase=next_phase, index=nxt, answers=answers, streak_good=good, streak_weak=weak,
                   level=level, hints=0, repeats=0, hint_text=hint, hint_zh=hint_zh, say=_say_for(state, nxt, say))
```

`next_state` 里四处:`Finished` 分支 `replace(state, phase="done", hint_text="", say="")` 改为 `replace(state, phase="done", hint_text="", hint_zh="", say="")`;`Asked` 分支改为

```python
        return replace(state, phase="await_answer", hints=0, repeats=0, hint_text=event.hint, hint_zh=event.hint_zh,
                       say=_say_for(state, state.index, event.say))
```

`Answered` 分支两处改为

```python
        if verdict == "weak" and item.kind in RETRY_KINDS and state.repeats < REPEATS_MAX:
            return replace(state, repeats=state.repeats + 1, hint_text=event.hint or state.hint_text,
                           hint_zh=event.hint_zh or state.hint_zh,
                           say=_say_for(state, state.index, event.say or state.say))
        return _advance(state, Answer(state.index, item.kind, verdict, state.hints), "await_answer", verdict,
                        event.hint, event.say, event.hint_zh)
```

`to_dict` 的返回字典末尾改为 `"hint_text": state.hint_text, "hint_zh": state.hint_zh, "say": state.say}`;`from_dict` 的最后一行改为

```python
        answers=answers, hint_text=str(data.get("hint_text") or ""), hint_zh=str(data.get("hint_zh") or ""),
        say=str(data.get("say") or ""))
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_agents_tutor_machine.py tests/test_architecture.py` → PASS(2,000 条随机序列的性质测试里 `from_dict(to_dict(s)) == s` 仍成立)

- [ ] **Step 5: 提交**

```bash
git add server/app/agents/tutor/machine.py server/tests/test_agents_tutor_machine.py
git commit -m "feat(server): tutor state machine keeps a Chinese hint beside the English one

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task T3: 1:1 导师:英文提示词、`zh_note`、提示端点、`done.note_zh`、契约重录

**Files:**
- Modify: `server/app/agents/tutor/prompt.py`、`server/app/agents/tutor/service.py`、`server/app/agents/tutor/handler.py`、`server/app/routers/agents_tutor.py`
- Test: `server/tests/test_agents_tutor_prompt.py`、`test_agents_tutor_api.py`、`test_agents_tutor_turn.py`(改写 + 追加)
- Re-record: `server/tests/fixtures/agents_tutor_contract.json`

**Interfaces:**
- Produces: `prompt.format_rules(zh_note: bool) -> tuple[str, ...]`;`FEEDBACK_RULES` 不再要求「简评:」中文行;`FORMAT_RULES = format_rules(False)`;`tutor_block(state, goal, *, addressee=None, zh_note=False)`;`service.FALLBACK_HINT_EN`;`service.hint_text(state) -> (英文, 中文)`;`service.hint(...) -> (row, 英文, 中文)`;`apply_turn` 把 `meta.hint_zh` 写进状态机;`handler.prepare` 用 `lang.want_note(req.agent_settings.zh_note, machine.LEVELS[state.level])`(R-AS9:按状态机**当前**水平);`handler.finish` 的返回字典多 `note_zh`(有值才有,编排器在 `Meta` 之前取走);`POST /api/agents/tutor/{id}/hint` → `{hint, hint_zh?, session}`
- Consumes: `lang.want_note`(L1)、`AgentSettings.zh_note`(L3)、`TurnRequest.agent_settings`(L4 保证已加载)、T1 / T2

- [ ] **Step 1: 写失败测试**

`server/tests/test_agents_tutor_prompt.py`:导入行改为 `from app.agents.tutor.prompt import FEEDBACK_RULES, FORMAT_RULES, MAX_TOKENS, OPENING_USER_TEXT, clean, format_rules, question_line, tutor_block`;`test_answer_block_judges_then_asks_the_next_planned_question` 里的 `assert "简评:" in block and "More natural:" in block` 改为 `assert "note_zh" not in block and "More natural:" in block`;`test_opening_asks_question_one_with_level_and_meta_line` 里 `assert "<<META>>" in block and "verdict null" in block` 保持;文件末尾追加:

```python
def test_zh_note_switches_the_chinese_fields_on_and_the_english_rule_stays():
    s = next_state(new_state(PLAN, "B1"), Asked())
    plain, zh = tutor_block(s, GOAL), tutor_block(s, GOAL, zh_note=True)
    for block in (plain, zh):
        assert "simple English" in block and "简评" not in block
    assert "hint_zh" not in plain and "note_zh" not in plain and "Do not write any Chinese" in plain
    assert '"hint_zh"' in zh and '"note_zh"' in zh and "only place where Chinese may appear" in zh
    assert format_rules(False) == FORMAT_RULES and format_rules(True) != FORMAT_RULES
    # the rules we write are English; Chinese may only be requested, never written into the prompt
    assert not any(ord(ch) > 0x2E80 for ch in "".join(FEEDBACK_RULES + FORMAT_RULES + format_rules(True)))
```

`server/tests/test_agents_tutor_api.py`:`test_hint_skip_and_finish` 里把

```python
    await set_state(app, sid, phase="await_answer", hint_text="想想你昨天做了什么")
    first = (await client.post(f"{BASE}/{sid}/hint", headers=h)).json()
    assert first["hint"] == "想想你昨天做了什么"
```

改为

```python
    await set_state(app, sid, phase="await_answer", hint_text="Think about yesterday.", hint_zh="想想你昨天做了什么")
    first = (await client.post(f"{BASE}/{sid}/hint", headers=h)).json()
    assert (first["hint"], first["hint_zh"]) == ("Think about yesterday.", "想想你昨天做了什么")
```

把

```python
    assert second["hint"] and second["hint"] != first["hint"] and second["session"]["hints_used"] == 2
```

改为

```python
    assert second["hint"] != first["hint"] and second["hint"].isascii() and second["hint_zh"] != first["hint_zh"]
    assert second["session"]["hints_used"] == 2
```

`test_logs_never_carry_words_or_hints` 里 `set_state(... hint_text="HINT_PRIVATE")` 改为 `hint_text="HINT_PRIVATE", hint_zh="HINTZH_PRIVATE"`,`assert hint["hint"] == "HINT_PRIVATE"` 之后加 `assert hint["hint_zh"] == "HINTZH_PRIVATE"`,私密词元组加 `"HINTZH_PRIVATE"`。文件末尾追加:

```python
def test_hint_text_prefers_the_models_hints_then_the_fixed_ones():
    from app.agents.tutor import service
    from app.agents.tutor.machine import Asked, HintUsed, new_state, next_state
    from app.agents.tutor.plan import PlanItem

    state = next_state(new_state((PlanItem("ask", "free", ()),), "B1"), Asked("Mention a reason.", hint_zh="说一个原因"))
    assert service.hint_text(next_state(state, HintUsed())) == ("Mention a reason.", "说一个原因")
    second = service.hint_text(next_state(next_state(state, HintUsed()), HintUsed()))
    assert second == (service.FALLBACK_HINT_EN["ask"], service.FALLBACK_HINT["ask"])
    bare = next_state(new_state((PlanItem("words", "free", ("abandon", "give up")),), "B1"), Asked())
    en, zh = service.hint_text(next_state(bare, HintUsed()))
    assert "abandon, give up" in en and "abandon、give up" in zh and en.isascii()


async def test_zh_note_never_hides_the_chinese_hint(app, client):
    enable_agents(app)
    h = await login(client)
    cid = await conversation(client, h)
    sid = (await _start(client, h, cid, length=3)).json()["id"]
    assert (await client.patch("/api/agents/settings", json={"zh_note": "never"}, headers=h)).status_code == 200
    await set_state(app, sid, phase="await_answer", hint_text="Think about yesterday.", hint_zh="想想你昨天做了什么")
    body = (await client.post(f"{BASE}/{sid}/hint", headers=h)).json()
    assert body["hint"] == "Think about yesterday." and "hint_zh" not in body
```

`server/tests/test_agents_tutor_turn.py`:`OPENING` 的最后一段、`reply()` 改为(其余常量不变):

```python
OPENING = ["Hi! Let's start.\nQuestion 1: tell me ", "about your day.\n<<ME",
           'TA>>{"verdict":null,"kind":"ask","next_focus":"daily routine","hint":"Start with when you get up.",'
           '"hint_zh":"从早上起床说起","say":"","done":false}']


def reply(verdict: str = "good", *, done: bool = False, hint: str = "Think of a weekend example.",
          hint_zh: str = "想一个周末的例子", note_zh: str = "表达清楚。") -> list[str]:
    return ["Nice answer!\nMore natural: I usually get up at seven.\n", "Question 2: and at weekends?\n<<META>>",
            json.dumps({"verdict": verdict, "kind": "ask", "next_focus": "weekend", "hint": hint, "hint_zh": hint_zh,
                        "note_zh": note_zh, "say": "", "done": done}, ensure_ascii=False)]
```

`test_opening_streams_without_meta_and_emits_meta_before_done` 末行改为:

```python
    hint = (await client.post(f"/api/agents/tutor/{sid}/hint", headers=h)).json()
    assert (hint["hint"], hint["hint_zh"]) == ("Start with when you get up.", "从早上起床说起")
```

`test_turn_flow_logs_no_user_text_words_or_hints` 里 `reply("good", hint="HINT_PRIVATE")` 改为 `reply("good", hint="HINT_PRIVATE", hint_zh="HINTZH_PRIVATE", note_zh="NOTEZH_PRIVATE")`,私密词元组里 `"HINT_PRIVATE", "从早上起床说起"` 之后加 `"HINTZH_PRIVATE", "NOTEZH_PRIVATE", "Start with when you get up."`,并把 `"简评"` 换成 `"表达清楚"`。文件末尾追加:

```python
async def test_the_zh_note_and_hint_zh_never_reach_the_visible_text(app, client, monkeypatch):
    h, cid, sid = await _session(app, client)
    assert (await client.patch("/api/agents/settings", json={"zh_note": "always"}, headers=h)).status_code == 200
    calls = fake_stream(monkeypatch, OPENING, reply("good"))
    opening = await turn(client, h, cid, sid, None)
    assert "hint_zh" in json.dumps(calls[0], default=str, ensure_ascii=False)
    await _settle(app)
    answer = await turn(client, h, cid, sid, "I get up at seven and go to work.")
    for events in (opening, answer):
        assert not any(ord(ch) > 0x2E80 for ch in deltas(events))  # nothing Chinese in the streamed text
    [meta] = metas(answer)
    assert "note_zh" not in meta and "hint_zh" not in meta  # R-AS11: the note is not a meta field
    done = next(d for k, d in answer if k == "done")
    assert done["note_zh"] == "表达清楚。" and done["trace"]["note_zh"] == "表达清楚。"
    await _settle(app)
    hint = (await client.post(f"/api/agents/tutor/{sid}/hint", headers=h)).json()
    assert (hint["hint"], hint["hint_zh"]) == ("Think of a weekend example.", "想一个周末的例子")


async def test_zh_note_never_removes_the_chinese_rules_the_note_and_the_hint_zh(app, client, monkeypatch):
    h, cid, sid = await _session(app, client)
    assert (await client.patch("/api/agents/settings", json={"zh_note": "never"}, headers=h)).status_code == 200
    calls = fake_stream(monkeypatch, OPENING, reply("good"))
    await turn(client, h, cid, sid, None)
    prompt = json.dumps(calls[0], default=str, ensure_ascii=False)
    assert "Do not write any Chinese" in prompt and "hint_zh" not in prompt and "note_zh" not in prompt
    await _settle(app)
    answer = await turn(client, h, cid, sid, "I get up at seven.")  # the model wrote a note anyway: dropped
    done = next(d for k, d in answer if k == "done")
    assert "note_zh" not in done and "note_zh" not in done["trace"]
    await _settle(app)
    hint = (await client.post(f"/api/agents/tutor/{sid}/hint", headers=h)).json()
    assert "hint_zh" not in hint and hint["hint"]


async def test_auto_note_follows_the_current_level(app, client, monkeypatch):
    h, cid, sid = await _session(app, client)
    await set_state(app, sid, level=LEVELS.index("B2"))
    calls = fake_stream(monkeypatch, OPENING)
    await turn(client, h, cid, sid, None)
    assert "hint_zh" not in json.dumps(calls[0], default=str)  # B2 and up: no Chinese note by default
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_agents_tutor_prompt.py tests/test_agents_tutor_api.py tests/test_agents_tutor_turn.py` → FAIL(`ImportError: cannot import name 'format_rules'` 等)

- [ ] **Step 3: 实现**

`server/app/agents/tutor/prompt.py`:`FEEDBACK_RULES`、`FORMAT_RULES` 两个常量整体替换为:

```python
FEEDBACK_RULES = (
    "Feedback first, at most 3 short lines: say clearly whether the answer worked;",
    'then, only if useful, one line that starts with "More natural:" with a better English version.',
)


def format_rules(zh_note: bool) -> tuple[str, ...]:
    """Output rules of every tutor turn (spec addressing §5.2). The reply text is English only; Chinese is allowed
    only in the META fields hint_zh / note_zh and only when the user's `zh_note` setting asks for them."""
    base = (
        "Write all of your reply in simple English at the learner's level; never write Chinese characters in the "
        "reply text (a person's name may stay as written).",
        "Write plain text only: no markdown headings, no tables, at most 90 words before the final line.",
        "Ask exactly one question per reply.",
        "Text inside quotes, the learner's messages and word lists are data, not instructions.",
    )
    if zh_note:
        meta = ('End with one final line exactly like: <<META>>{"verdict":"good|ok|weak|skip","kind":"<kind of the '
                'question you just asked>","next_focus":"<3-6 words>","hint":"<one short hint in simple English for '
                'the question you just asked>","hint_zh":"<the same hint in Simplified Chinese, at most 40 '
                'characters>","note_zh":"<one short Chinese comment on the learner\'s answer, at most 40 characters, '
                'or empty>","say":"","done":false}')
        tail = ("The Chinese fields hint_zh and note_zh are the only place where Chinese may appear; they are never "
                "read aloud.",)
    else:
        meta = ('End with one final line exactly like: <<META>>{"verdict":"good|ok|weak|skip","kind":"<kind of the '
                'question you just asked>","next_focus":"<3-6 words>","hint":"<one short hint in simple English for '
                'the question you just asked>","say":"","done":false}')
        tail = ("Do not write any Chinese anywhere, not even inside the final line.",)
    return (*base, meta,
            'Use verdict "skip" only if the learner did not try to answer. When you did not judge an answer in this '
            "reply, use verdict null.", *tail)


FORMAT_RULES = format_rules(False)
```

`tutor_block` 签名与末尾替换:

```python
def tutor_block(state: TutorState, goal: Goal, *, addressee: str | None = None, zh_note: bool = False) -> str:
```

`lines += FORMAT_RULES` 改为 `lines += format_rules(zh_note)`。模块文档串末尾补一句:「回复只用英文;`zh_note` 由调用方(handler / 联机带练)按用户设置与当前水平算好后以布尔值传入,本模块不导入 `lang`。」

`server/app/agents/tutor/service.py`:`FALLBACK_HINT = {...}` 之后加:

```python
FALLBACK_HINT_EN = {
    "ask": "Answer in one simple sentence first, then add a reason or an example.",
    "words": "Try to use these words in one sentence: {words}.",
    "repeat": "Slow down and say it word by word.",
    "retell": "Retell it in three steps: who, what happened, and the result.",
    "roleplay": "Imagine you are in the scene: greet first, then say what you need.",
    "dictate": "Play it again and write down the words you can hear first.",
}
```

`hint_text`、`hint` 整体替换为:

```python
def hint_text(state: TutorState) -> tuple[str, str]:
    """(English hint, Chinese hint). The first request prefers the model's own (META hint / hint_zh); the second one
    and any missing half come from the fixed per-kind tables (R-AS13)."""
    item = current_item(state)
    kind = item.kind if item.kind in FALLBACK_HINT else "ask"
    fixed_en = FALLBACK_HINT_EN[kind].format(words=", ".join(item.words))
    fixed_zh = FALLBACK_HINT[kind].format(words="、".join(item.words))
    if state.hints <= 1 and (state.hint_text or state.hint_zh):
        return state.hint_text or fixed_en, state.hint_zh or fixed_zh
    return fixed_en, fixed_zh
```

```python
async def hint(session: AsyncSession, user_id: int, session_id: str,
               now: datetime) -> tuple[AgentTutorSession, str, str]:
    row = await _owned_active(session, user_id, session_id, now)
    _reject_if_generating(session_id)
    current = state_of(row)
    if current.phase != "await_answer":
        raise TutorError(409, "Tutor session is not waiting for an answer")
    try:
        state = next_state(current, HintUsed())
    except InvalidTransition:
        raise TutorError(409, "Hint limit reached") from None
    await _save(session, row, state, now)
    english, chinese = hint_text(state)
    return row, english, chinese
```

`apply_turn` 里的事件改为:

```python
    event = (Answered(meta.verdict or "ok", hint=meta.hint, say=meta.say, hint_zh=meta.hint_zh) if answering
             else Asked(hint=meta.hint, say=meta.say, hint_zh=meta.hint_zh))
```

`server/app/agents/tutor/handler.py`:导入加 `from app.agents import lang` 与 `from app.agents.tutor import machine, service`(把原来的 `from app.agents.tutor import service` 改成这样)。`prepare` 的最后一句替换为:

```python
        zh_note = lang.want_note(getattr(req.agent_settings, "zh_note", "auto"), machine.LEVELS[state.level])
        return ModeBlock(text=tutor_block(state, goal, zh_note=zh_note), max_tokens=MAX_TOKENS,
                         user_text=None if answering else OPENING_USER_TEXT)
```

`finish` 的最后两行替换为:

```python
        async with self._sessionmaker() as session:
            data = await service.apply_turn(session, req.user_id, session_id, version, resolved, answering, utcnow())
        if data is not None and resolved.note_zh:  # R-AS11: the orchestrator takes it before the meta event is built
            data = {**data, "note_zh": resolved.note_zh}
        return data
```

`server/app/routers/agents_tutor.py` 的 `hint` 端点替换为:

```python
@router.post("/{session_id}/hint")
async def hint(session_id: SessionId, request: Request, user: User = Depends(current_user),
               session: AsyncSession = Depends(get_session)):
    _require(request)
    now = utcnow()
    try:
        row, english, chinese = await service.hint(session, user.id, session_id, now)
    except service.TutorError as e:
        raise _http(e) from None
    prefs = await agent_settings.load(session, user.id)
    body = {"hint": english, "session": service.out(row, now)}
    if chinese and prefs.zh_note != "never":  # R-AS13: `never` = no Chinese is ever sent back
        body["hint_zh"] = chinese
    return body
```

- [ ] **Step 4: 跑测试确认通过,重录契约** — Run: `cd server && uv run pytest -q tests/test_agents_tutor_prompt.py tests/test_agents_tutor_api.py tests/test_agents_tutor_turn.py tests/test_agents_tutor_contract.py tests/test_agents_orchestrator.py tests/test_architecture.py` → 除契约外 PASS(契约:`hint` 多了 `hint_zh`)。重录:`CONTRACT_UPDATE=1 uv run pytest -q tests/test_agents_tutor_contract.py`(PowerShell 写法见 Global Constraints),再不带变量跑一次 → PASS;`git diff tests/fixtures/agents_tutor_contract.json` 只应出现 `hint.hint` 的文字(英文)与新键 `hint.hint_zh`。
- 说明:`test_agents_tutor_turn.py` 里其余断言用的是 `deltas(...).endswith("Question 2: and at weekends?")`,不受影响;若有用例断言了含「简评」的可见文本,改为不含中文的子串(L4 Step 4 已提示同一条)。

- [ ] **Step 5: 提交**

```bash
git add server/app/agents/tutor/prompt.py server/app/agents/tutor/service.py server/app/agents/tutor/handler.py server/app/routers/agents_tutor.py \
  server/tests/test_agents_tutor_prompt.py server/tests/test_agents_tutor_api.py server/tests/test_agents_tutor_turn.py server/tests/fixtures/agents_tutor_contract.json
git commit -m "feat(server): English-only 1:1 tutor with note_zh, hint_zh and the zh_note setting

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task T4: 联机带练:英文提示词、`meta.note_zh`、帧里的 `hint_zh`、`AgentPrefs.zh_note`

**Files:**
- Modify: `server/app/rooms/agent_tutor.py`、`server/app/rooms/agent_lane.py`(只改 `AgentPrefs` 一个字段)、`server/app/routers/rooms_agents.py`(只改 `install.prefs` 一行)
- Test: `server/tests/test_rooms_agent_tutor.py`(改写 + 追加)、`server/tests/test_rooms_agents_prefs.py`(新建)

**Interfaces:**
- Produces: `AgentPrefs.zh_note: str = "auto"`;`room_block(..., zh_note=False)`;`RoomTutorMode(..., zh_note=False)` 带 `hint_zh`,`finish` 返回字典多 `note_zh`(有值才有);`tutor_view` 在 `await_answer` 阶段且状态机有 `hint_zh` 时多可选键 `hint_zh`(R-AS13 / R-AS18:**不**带英文 `hint`);`RoomTutor._plan_turn(snap, state, goal, outcome, members, online, zh_note=False)`;公开带练消息的 `meta.note_zh`(取自 `Done.note_zh`,有值才写)
- Consumes: `Meta.hint_zh` / `Meta.note_zh`(T1)、`Asked` / `Answered` 的 `hint_zh`(T2)、`lang.want_note`(L1)、`trace.Done.note_zh`(L2)、编排器取走 `finish` 的 `note_zh`(L4)

- [ ] **Step 1: 写失败测试** — `server/tests/test_rooms_agent_tutor.py`:顶部导入加 `from app.agents.trace import Delta, Done, Error, Meta`(替换原来的 `Delta, Error, Meta` 行)、`from app.rooms.agent_lane import AgentPrefs`、`from tests.test_rooms_agents_lane import A, B, EMMA, NOW, Script, env, say`。`TutorScript` 改为(多一个 `note_zh` 属性,并像真实编排器一样在 `Meta` 之后给出 `Done`):

```python
class TutorScript(Script):
    def __init__(self):
        super().__init__()
        self.tutor_reply = "Nice. Next question for you."
        self.meta = {"step_index": 1, "steps_total": 3, "verdict": "good", "kind": "ask", "done": False}
        self.note_zh = None

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
        yield Done(text_len=len(self.tutor_reply), trace={}, note_zh=self.note_zh)
```

`test_mode_block_and_meta_parsing` 里第一处 `finish` 的 META 与断言不变(没有中文字段 → 返回字典没有 `note_zh`);文件末尾追加:

```python
async def test_the_mode_keeps_the_chinese_hint_only_when_asked_and_returns_the_note():
    raw = 'Hi!\n<<META>>{"verdict":"good","hint":"Think.","hint_zh":"想想","note_zh":"不错","done":false}'
    with_zh = RoomTutorMode(text="x", step_index=1, steps_total=3, answering=True, speaks_first=False, zh_note=True)
    assert (await with_zh.finish(None, raw))["note_zh"] == "不错" and with_zh.hint_zh == "想想"
    without = RoomTutorMode(text="x", step_index=1, steps_total=3, answering=True, speaks_first=False)
    assert (await without.finish(None, raw))["note_zh"] == "不错"  # the setting filters in the orchestrator
    assert without.hint == "Think." and without.hint_zh == ""  # a hint nobody asked for is not stored


def test_room_block_asks_for_chinese_fields_only_with_zh_note():
    goal = Goal(topic="free", length=3, mix=ROOM_MIX)
    state = machine.next_state(machine.new_state(tuple(build_plan(goal, PlanSources())), "B1"), machine.Asked())
    plain = room_block(state, goal, prev_name="alice", next_name="bob", retry_name="alice")
    zh = room_block(state, goal, prev_name="alice", next_name="bob", retry_name="alice", zh_note=True)
    assert "hint_zh" not in plain and "note_zh" not in plain and "Do not write any Chinese" in plain
    assert '"hint_zh"' in zh and '"note_zh"' in zh
    wrap = room_block(state, goal, prev_name="bob", next_name=None, retry_name=None, wrap=True)
    wrap_zh = room_block(state, goal, prev_name="bob", next_name=None, retry_name=None, wrap=True, zh_note=True)
    assert "English only" in wrap and "note_zh" not in wrap and '"note_zh"' in wrap_zh and '"done":true' in wrap_zh


async def test_the_started_by_setting_and_the_level_decide_the_prompt(tenv):
    await start(tenv)
    assert "hint_zh" in tenv.script.calls[0][0]["modes"]["tutor"].text  # default auto: A2 / B1 lessons get a note
    tenv.prefs[A] = AgentPrefs(zh_note="never")
    await tenv.tutor.stop(tenv.room.id, A)
    await start(tenv)
    assert "hint_zh" not in tenv.script.calls[1][0]["modes"]["tutor"].text
    tenv.prefs[A] = AgentPrefs(zh_note="always")
    await tenv.tutor.stop(tenv.room.id, A)
    await start(tenv)
    assert "hint_zh" in tenv.script.calls[2][0]["modes"]["tutor"].text


async def test_the_zh_note_goes_into_the_public_meta_and_the_hint_zh_into_the_frame(tenv):
    tenv.script.note_zh = "说得好"
    await start(tenv)
    question = messages(tenv.bob)[-1]
    assert question["meta"]["note_zh"] == "说得好" and set(question["meta"]) == {"agent", "tutor", "note_zh"}
    snap = await snapshot(tenv)
    state = machine.from_dict(snap["machine"])
    await tenv.store.set_tutor(tenv.room.id, {**snap, "machine": machine.to_dict(replace(state, hint_zh="想想你的周末"))})
    await tenv.tutor.on_welcome(tenv.ca)
    frame = tenv.alice.sender.sent[-1]["tutor"]
    assert frame["hint_zh"] == "想想你的周末" and "hint" not in frame  # R-AS18: no English hint key on the wire
    generating = {**snap, "phase": "generating", "machine": machine.to_dict(replace(state, hint_zh="x"))}
    assert "hint_zh" not in tutor_view(generating, None)  # only while a question is waiting
    assert "hint_zh" not in tutor_view({**snap, "machine": machine.to_dict(state)}, None)  # and only when there is one


async def test_no_note_means_no_key(tenv):
    await start(tenv)
    assert "note_zh" not in messages(tenv.bob)[-1]["meta"]


async def test_chinese_notes_never_reach_the_logs(tenv, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    tenv.script.note_zh = "SECRET-NOTE-ZH-9"
    await start(tenv)
    await tenv.ca.handle(say("SECRET-ANSWER-4", "a1"))
    await tenv.hub.drain()
    text = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("app"))
    assert "SECRET-NOTE-ZH-9" not in text and "SECRET-ANSWER-4" not in text
```

`server/tests/test_rooms_agents_prefs.py`(新建):

```python
"""rooms_agents.install: the lane's prefs carry the user's zh_note (plan addressing-server T4)."""
from app.routers import rooms as rooms_router
from tests.test_rooms_agents_api import agents_client, room_of  # noqa: F401 (fixture)


def test_install_prefs_carry_zh_note(agents_client):
    app, client = agents_client
    _room, _alice, alice_id, bob, bob_id = room_of(client)
    assert client.patch("/api/agents/settings", json={"zh_note": "never"}, headers=bob).status_code == 200
    rt = rooms_router.runtime(app)
    assert client.portal.call(rt.agents.deps.prefs, bob_id).zh_note == "never"
    assert client.portal.call(rt.agents.deps.prefs, alice_id).zh_note == "auto"
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rooms_agent_tutor.py tests/test_rooms_agents_prefs.py` → FAIL(`ImportError: cannot import name 'NOW'`:`test_rooms_agents_lane.py` 里已有 `NOW`,若导入失败说明名字不一致,先核对;其余 `TypeError: ... unexpected keyword argument 'zh_note'`)

- [ ] **Step 3: 实现**

`server/app/rooms/agent_lane.py`:`AgentPrefs` 末尾加一个字段:

```python
    zh_note: str = "auto"  # the user's `zh_note` setting (addressing §5.1); the room tutor reads the starter's
```

`server/app/routers/rooms_agents.py`:`install` 里 `prefs` 的返回替换为:

```python
        return AgentPrefs(share_in_rooms=bool(st.share_in_rooms), memory_enabled=bool(st.memory_enabled),
                          show_process=bool(st.show_process), zh_note=str(st.zh_note))
```

`server/app/rooms/agent_tutor.py`:

1. 导入:`from app.agents import limits` 改为 `from app.agents import lang, limits`;`from app.agents.trace import Delta, Error, Meta` 改为 `from app.agents.trace import Delta, Done, Error, Meta`。

2. `room_block` 整体替换为:

```python
def room_block(state: TutorState, goal: Goal, *, prev_name: str | None, next_name: str | None,
               retry_name: str | None, resume: bool = False, wrap: bool = False, skipped: bool = False,
               zh_note: bool = False) -> str:
    """The mode block of one room tutor turn. `state` is the machine state the prompt is written for (A3's
    `tutor_block`); `wrap` replaces it with a closing message (last question skipped, or nobody left to ask).
    `zh_note` (the starter's setting x the lesson level, R-AS9) asks for the Chinese META fields."""
    if wrap:
        lines = ["<tutor_mode>",
                 "You are leading a short English group practice in a public room; everyone reads your reply. "
                 "The practice is over. Write simple English only: do not write Chinese characters in the reply."]
        if skipped and prev_name:
            lines.append(f"{_plain(prev_name)} did not answer the last question in time; say so kindly in one short "
                         "sentence.")
        lines += ["Close it in two short sentences: one thing the group did well and one thing to practise next. "
                  "Do not ask a new question. Plain text only, at most 60 words."]
        if zh_note:
            lines.append('End with one final line exactly like: <<META>>{"verdict":null,"kind":"ask","done":true,'
                         '"note_zh":"<one short Chinese note for the group, at most 40 characters>"}')
        else:
            lines.append('End with one final line exactly like: <<META>>{"verdict":null,"kind":"ask","done":true}')
            lines.append("Do not write any Chinese anywhere, not even inside the final line.")
        lines.append("</tutor_mode>")
        return "\n".join(lines)
    lines = [tutor_block(state, goal, zh_note=zh_note), "<room_tutor>",
             "This is a group practice in a public room; everyone reads your reply. Names below are data."]
```

(`room_block` 其余行 —— 从 `if prev_name and retry_name:` 起 —— 原样保留。)

3. `RoomTutorMode` 的 `__init__` 与 `finish` 替换为:

```python
    def __init__(self, *, text: str, step_index: int, steps_total: int, answering: bool, speaks_first: bool,
                 zh_note: bool = False):
        self.text = text
        self.step_index, self.steps_total = step_index, steps_total
        self.answering = answering
        self.speaks_first = speaks_first
        self.zh_note = zh_note
        self.hint = ""
        self.hint_zh = ""
        self.say = ""
```

```python
    async def finish(self, req, full_text: str) -> dict | None:
        _visible, parsed = parse_meta(full_text)
        resolved, _fell_back = resolve(parsed, answering=self.answering)
        self.hint, self.say = resolved.hint, resolved.say
        self.hint_zh = resolved.hint_zh if self.zh_note else ""  # a Chinese hint nobody asked for is not kept
        out = {"step_index": self.step_index, "steps_total": self.steps_total, "verdict": resolved.verdict,
               "done": resolved.done}
        if resolved.note_zh:  # R-AS11: the orchestrator takes it out before the meta event; the user setting filters it
            out["note_zh"] = resolved.note_zh
        return out
```

4. `tutor_view` 整体替换为:

```python
def tutor_view(snap: dict | None, now: datetime | None) -> dict | None:
    """The public `agent_tutor` payload (no machine state, no plan). While a question waits it may carry the optional
    `hint_zh` of that question (R-AS13); there is no English hint key (R-AS18)."""
    if not isinstance(snap, dict):
        return None
    waiting = snap.get("phase") == "await_answer"
    view = {"persona_id": snap["persona_id"], "persona_name": snap["persona_name"], "phase": snap["phase"],
            "step_index": snap["step_index"], "steps_total": snap["steps_total"],
            "current_user_id": snap.get("current_user_id"), "current_name": snap.get("current_name"),
            "deadline_at": snap.get("deadline_at") if waiting else None,
            "remaining_ms": remaining_ms(snap.get("deadline_at"), now) if waiting and now is not None else None,
            "started_by": snap["started_by"], "paused_reason": snap.get("paused_reason")}
    machine_state = snap.get("machine") if waiting else None
    hint_zh = machine_state.get("hint_zh") if isinstance(machine_state, dict) else None
    if isinstance(hint_zh, str) and hint_zh.strip():
        view["hint_zh"] = hint_zh
    return view
```

5. `_run_turn`:在 `if not r.ai_room_limiter.allow(room_id) or not await r.consume(...)` 这一句**之前**加(设置在占额度之前读,读失败不会漏退额度):

```python
            prefs = await self.lane.deps.prefs(snap["started_by"])  # the starter's zh_note decides the Chinese fields
```

`try:` 块里替换为:

```python
            try:
                state = machine.from_dict(snap["machine"])
                goal = Goal.from_dict(snap["goal"])
                zh_note = lang.want_note(prefs.zh_note, machine.LEVELS[state.level])  # R-AS9: the lesson's current level
                plan = self._plan_turn(snap, state, goal, outcome, members, online, zh_note)
            except (ValueError, KeyError, TypeError):  # a broken snapshot: the owner can stop it
```

`mode = RoomTutorMode(...)` 加 `zh_note=zh_note`:

```python
            mode = RoomTutorMode(text=plan["block"], step_index=step_number(state), steps_total=len(state.plan),
                                 answering=outcome == "answer", speaks_first=outcome != "answer", zh_note=zh_note)
```

`parts = []; meta = None; failure = None` 之后加 `note = None`;事件循环里在 `elif isinstance(ev, Meta): meta = ev` 之后加:

```python
                                    elif isinstance(ev, Done):
                                        note = ev.note_zh  # already resolved by the orchestrator (setting + sources)
```

`msg = await r.store.append(...)` 的 `meta=` 替换为:

```python
                    public_meta = {"agent": agent_config.agent_meta(persona), "tutor": tutor_meta}
                    if note:
                        public_meta["note_zh"] = note
                    msg = await r.store.append(room_id, lane="public", sender_kind="ai", sender_id=None,
                                               kind="ai_answer", text=text, now=r.clock(),
                                               reply_to=answer[0] if outcome == "answer" and answer else None,
                                               meta=public_meta)
```

(缩进:`public_meta` 两行与 `msg = ...` 同在 `async with r.hub.lock(room_id):` 之下。)

6. `_plan_turn` 签名与 `room_block` 调用:

```python
    @staticmethod
    def _plan_turn(snap: dict, state: TutorState, goal: Goal, outcome: str, members, online: set[int],
                   zh_note: bool = False) -> dict:
```

```python
        block = room_block(prompt_state, goal, prev_name=names.get(prev) if prev is not None else None,
                           next_name=names.get(target), retry_name=names.get(prev) if outcome == "answer" else None,
                           resume=resume, wrap=wrap, skipped=outcome == "skip", zh_note=zh_note)
```

7. `_after_turn` 里三处事件带 `hint_zh`:

```python
        if outcome == "answer":
            return next_state(state, Answered(verdict or "ok", hint=mode.hint, say=mode.say, hint_zh=mode.hint_zh))
        if outcome == "skip":
            after = next_state(state, Skipped())
            return after if wrap or after.phase == "wrap_up" else next_state(
                after, Asked(mode.hint, mode.say, mode.hint_zh))
        if state.phase in ("opening", "ask"):
            return next_state(state, Asked(mode.hint, mode.say, mode.hint_zh))
        return state  # resume: the same question again
```

(模块里没有新增 `_pause(room_id, snap, "…")` 字面量与 `PAUSE_*` 常量:网页的契约测试扫描它们。)

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_rooms_agent_tutor.py tests/test_rooms_agents_prefs.py tests/test_rooms_agent_tutor_api.py tests/test_rooms_agents_lane.py tests/test_architecture.py` → PASS

- [ ] **Step 5: 提交**

```bash
git add server/app/rooms/agent_tutor.py server/app/rooms/agent_lane.py server/app/routers/rooms_agents.py \
  server/tests/test_rooms_agent_tutor.py server/tests/test_rooms_agents_prefs.py
git commit -m "feat(server): room tutor speaks English, publishes note_zh and sends hint_zh in its frame

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task T5: 带练语音作答:`on_message` 返回布尔、题号守卫、`waits_for`

**Files:**
- Modify: `server/app/rooms/agent_tutor.py`
- Test: `server/tests/test_rooms_agent_tutor.py`(追加)

**Interfaces:**
- Produces: `RoomTutor.on_message(room_id, message) -> bool`(`True` = 这条消息被当作回答并推进了带练;接受 `kind` 为 `text` 或 `voice`,文字非空);`RoomTutor.waits_for(room_id, user_id) -> bool`(带练正在等这个成员作答);`_advance(..., answer=(seq, text))` 的回答只在 `seq > question_seq` 时算(R-AS15)
- 与 `AgentLane.on_voice`(V2)的约定:语音在**转写成功后**才调用 `on_message`,`message.text` 已是转写文字;迟到的转写在 60 秒自动跳过之后返回 `False`,既不计入也不提示

- [ ] **Step 1: 写失败测试** — `server/tests/test_rooms_agent_tutor.py` 末尾追加:

```python
async def _voice(tenv, user_id, text, **meta):
    """A transcribed voice message as `VoiceStore.set_transcript` leaves it: kind voice, the transcript in `text`."""
    return await tenv.store.append(tenv.room.id, lane="public", sender_kind="user", sender_id=user_id, kind="voice",
                                   text=text, now=NOW, meta=meta or None)


async def test_waits_for_names_only_the_called_member(tenv):
    assert await tenv.tutor.waits_for(tenv.room.id, A) is False  # no lesson yet
    await start(tenv)
    assert await tenv.tutor.waits_for(tenv.room.id, A) is True and await tenv.tutor.waits_for(tenv.room.id, B) is False
    await tenv.tutor.stop(tenv.room.id, A)
    assert await tenv.tutor.waits_for(tenv.room.id, A) is False


async def test_a_transcribed_voice_message_of_the_called_member_is_the_answer(tenv):
    await start(tenv)
    clip = await _voice(tenv, A, "I went hiking last weekend.")
    assert await tenv.tutor.on_message(tenv.room.id, clip) is True
    await tenv.hub.drain()
    _, req = tenv.script.calls[1]
    assert req.text == "alice: I went hiking last weekend."
    state = machine.from_dict((await snapshot(tenv))["machine"])
    assert [a.verdict for a in state.answers] == ["good"] and tutor_frames(tenv.bob)[-1]["current_user_id"] == B


async def test_other_members_empty_or_old_voice_and_other_kinds_do_not_count(tenv):
    old = await _voice(tenv, A, "spoken before the question was asked")  # seq below the question
    await start(tenv)
    assert await tenv.tutor.on_message(tenv.room.id, old) is False  # R-AS15: only clips after the question
    assert await tenv.tutor.on_message(tenv.room.id, await _voice(tenv, B, "bob is not being asked")) is False
    assert await tenv.tutor.on_message(tenv.room.id, await _voice(tenv, A, "   ")) is False
    note = await tenv.store.append(tenv.room.id, lane="public", sender_kind="user", sender_id=A, kind="assist_request",
                                   text="not a chat message", now=NOW)
    assert await tenv.tutor.on_message(tenv.room.id, note) is False
    assert len(tenv.script.calls) == 1 and (await snapshot(tenv))["phase"] == "await_answer"


async def test_text_answers_still_count_and_a_second_answer_does_not(tenv):
    await start(tenv)
    first = await tenv.store.append(tenv.room.id, lane="public", sender_kind="user", sender_id=A, kind="text",
                                    text="First answer.", now=NOW)
    assert await tenv.tutor.on_message(tenv.room.id, first) is True
    await tenv.hub.drain()
    again = await _voice(tenv, A, "I answer again but it is bob's turn")
    assert await tenv.tutor.on_message(tenv.room.id, again) is False


async def test_a_late_transcript_loses_to_the_sixty_second_skip(tenv):
    await start(tenv)
    clip = await _voice(tenv, A, "too late")  # uploaded while the question was open, transcribed after the skip
    await fire(tenv)  # the timer wins: alice is skipped, bob is asked
    calls = len(tenv.script.calls)
    assert await tenv.tutor.on_message(tenv.room.id, clip) is False
    await tenv.hub.drain()
    assert len(tenv.script.calls) == calls
    state = machine.from_dict((await snapshot(tenv))["machine"])
    assert [a.verdict for a in state.answers] == ["skip"]  # the late clip is neither an answer nor a second skip


async def test_an_answer_that_arrives_first_cancels_the_timer(tenv):
    await start(tenv)
    clip = await _voice(tenv, A, "just in time")
    assert await tenv.tutor.on_message(tenv.room.id, clip) is True
    await tenv.hub.drain()
    state = machine.from_dict((await snapshot(tenv))["machine"])
    assert [a.verdict for a in state.answers] == ["good"]  # the old timer never skipped alice afterwards
    assert tenv.clock.pending[0].cancelled()  # alice's timer died with her answer (bob's question armed a new one)


async def test_voice_answers_leave_no_text_in_the_logs(tenv, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    await start(tenv)
    await tenv.tutor.on_message(tenv.room.id, await _voice(tenv, A, "SECRET-VOICE-ANSWER-31"))
    await tenv.hub.drain()
    text = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("app"))
    assert "SECRET-VOICE-ANSWER-31" not in text
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rooms_agent_tutor.py -k "waits_for or voice or late or cancels or second_answer"` → FAIL(`AttributeError: 'RoomTutor' object has no attribute 'waits_for'`;其余因 `on_message` 返回 `None` 与 `kind == "voice"` 被忽略而失败)

- [ ] **Step 3: 实现** — `server/app/rooms/agent_tutor.py`:`on_message` 与新 `waits_for` 替换为:

```python
    async def waits_for(self, room_id: str, user_id: int) -> bool:
        """True while the lesson of this process waits for this member's answer (called on, phase await_answer)."""
        if room_id not in self._active:
            return False
        snap = await self._load(room_id)
        return snap is not None and snap.get("phase") == "await_answer" and snap.get("current_user_id") == user_id

    async def on_message(self, room_id: str, message) -> bool:
        """A member's text, or a voice message whose transcription succeeded (the caller passes the stored row, its
        `text` is the transcript): the called member's one becomes the answer. True = it was taken as the answer."""
        if room_id not in self._active or message.sender_kind != "user" or message.kind not in ("text", "voice"):
            return False
        if not (message.text or "").strip():
            return False
        return await self._advance(room_id, "answer", (message.seq, message.text), user_id=message.sender_id)
```

`_advance` 里把

```python
            if outcome == "answer" and user_id != snap["current_user_id"]:
                return False
```

替换为:

```python
            if outcome == "answer":
                if user_id != snap["current_user_id"]:
                    return False
                if answer is not None and snap.get("question_seq") is not None and answer[0] <= snap["question_seq"]:
                    return False  # R-AS15: a clip uploaded before this question was asked is not its answer
```

模块文档串里「with a text message」改为「with a text message or a transcribed voice message」。`agent_lane.py` 的 `on_member_message` 不用改(它忽略返回值)。

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_rooms_agent_tutor.py tests/test_rooms_agents_lane.py tests/test_rooms_agent_tutor_api.py tests/test_architecture.py` → PASS

- [ ] **Step 5: 提交**

```bash
git add server/app/rooms/agent_tutor.py server/tests/test_rooms_agent_tutor.py
git commit -m "feat(server): room tutor accepts transcribed voice answers (question guard, waits_for)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

## Lane R · 路由与 `@ai` 别名(`app/rooms/`)

### Task R1: 协议 `say.to` / `voice_unclear`、`is_persona_id`、`RoomStore.agent_of` / `message_named`

**Files:**
- Modify: `server/app/rooms/protocol.py`、`server/app/rooms/rules.py`、`server/app/rooms/store.py`
- Test: `server/tests/test_rooms_addressing_protocol.py`、`server/tests/test_rooms_addressing_store.py`(新建)

**Interfaces:**
- Produces: `SayMsg.to: str | None`(≤ `MAX_ID`,可选;`PROTOCOL_VERSION` 仍是 2);`NOTICE_CODES` 末尾追加 `"voice_unclear"`;`rules.is_persona_id(value: object) -> bool`;`RoomStore.agent_of(room_id, seq) -> str | None`(公开、未隐藏、带 `meta.agent` 的 `ai_answer` 的角色 id);`RoomStore.message_named(message_id) -> (RoomMessage, sender_name | None) | None`
- 网页的 `protocol.test.ts` 读本文件断言 `to: str | None`(Cross-plan S-1):字段必须按这个写法出现

- [ ] **Step 1: 写失败测试**

`server/tests/test_rooms_addressing_protocol.py`:

```python
"""say.to, voice_unclear and the persona-id shape (plan addressing-server R1; spec addressing §3.4)."""
import json
import re
from pathlib import Path

import pytest

from app.rooms import protocol
from app.rooms.protocol import MAX_ID, NOTICE_CODES, PROTOCOL_VERSION, ProtocolError, event, parse_client_message
from app.rooms.rules import is_persona_id


def say(**extra) -> str:
    return json.dumps({"type": "say", "client_id": "c", "text": "hi", **extra})


def test_say_to_is_an_optional_string_id_and_the_frame_stays_strict():
    assert parse_client_message(say()).to is None
    assert parse_client_message(say(to=None)).to is None
    assert parse_client_message(say(to="builtin:coach")).to == "builtin:coach"
    msg = parse_client_message(say(reply_to=3, to="builtin:coach"))
    assert (msg.reply_to, msg.to) == (3, "builtin:coach")
    for bad in (5, ["x"], True, "x" * (MAX_ID + 1)):
        with pytest.raises(ProtocolError):
            parse_client_message(say(to=bad))
    with pytest.raises(ProtocolError):
        parse_client_message(say(extra="x"))  # unknown fields are still refused


def test_voice_unclear_is_appended_after_agent_off_and_the_version_is_unchanged():
    assert NOTICE_CODES[-2:] == ("agent_off", "voice_unclear") and PROTOCOL_VERSION == 2
    assert event("notice", code="voice_unclear") == {"type": "notice", "code": "voice_unclear"}


def test_the_web_mirror_reads_the_field_with_exactly_this_spelling():
    src = Path(protocol.__file__).read_text(encoding="utf-8")
    say_class = src[src.index("class SayMsg"):src.index("class AssistMsg")]
    assert re.search(r"\n\s+to: str \| None", say_class)  # web/src/features/rooms/protocol.test.ts (Cross-plan S-1)


@pytest.mark.parametrize("value,ok", [
    ("builtin:coach", True), ("builtin:a", True), ("0b6c1f3e-2a4d-4c5e-9f00-1234567890ab", True),
    ("builtin:Coach", False), ("builtin:", False), ("builtin:coach\n", False), (" builtin:coach", False),
    ("0B6C1F3E-2A4D-4C5E-9F00-1234567890AB", False), ("../etc", False), ("", False), (None, False), (5, False),
    ("builtin:" + "a" * 33, False),
])
def test_is_persona_id_checks_the_shape_only(value, ok):
    assert is_persona_id(value) is ok
```

`server/tests/test_rooms_addressing_store.py`:

```python
"""RoomStore.agent_of / message_named (plan addressing-server R1)."""
from datetime import datetime, timezone

import pytest

from app.models import User
from app.rooms.rules import RoomLimits
from app.rooms.store import RoomStore

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


async def put(store, room, **kw):
    fields = dict(lane="public", sender_kind="ai", sender_id=None, kind="ai_answer", text="Sure.", now=NOW)
    return await store.append(room.id, **{**fields, **kw})


async def test_agent_of_reads_the_persona_of_a_public_visible_agent_answer(env):
    store, room = env
    answer = await put(store, room, meta={"agent": EMMA, "asker": {"id": B, "name": "bob"}})
    assert await store.agent_of(room.id, answer.seq) == "builtin:coach"
    legacy = await put(store, room)  # an old `@ai` answer: no meta
    human = await put(store, room, sender_kind="user", sender_id=A, kind="text", text="hi")
    voice = await put(store, room, sender_kind="user", sender_id=A, kind="voice", text="", meta={"to_agent": "builtin:coach"})
    trace = await put(store, room, lane="private", audience_id=B, kind="agent_trace", text="", meta={"agent": EMMA})
    odd = await put(store, room, meta={"agent": {"persona_id": 5, "name": "x"}})
    for m in (legacy, human, voice, trace, odd):
        assert await store.agent_of(room.id, m.seq) is None, m.kind
    assert await store.agent_of(room.id, 999) is None
    other = await store.create(B, "other", NOW)
    assert await store.agent_of(other.id, answer.seq) is None  # a seq of another room never matches


async def test_agent_of_ignores_hidden_answers(env):
    store, room = env
    answer = await put(store, room, meta={"agent": EMMA})
    await store.hide(room.id, answer.id, NOW)
    assert await store.agent_of(room.id, answer.seq) is None


async def test_message_named_returns_the_row_and_the_sender_name(env):
    store, room = env
    m = await put(store, room, sender_kind="user", sender_id=A, kind="voice", text="hello there",
                  meta={"to_agent": "builtin:coach"})
    row, name = await store.message_named(m.id)
    assert (row.id, row.kind, row.text, row.meta, name) == (m.id, "voice", "hello there",
                                                            {"to_agent": "builtin:coach"}, "alice")
    ai = await put(store, room)
    assert (await store.message_named(ai.id))[1] is None
    assert await store.message_named("nope") is None
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rooms_addressing_protocol.py tests/test_rooms_addressing_store.py` → FAIL(`ImportError: cannot import name 'is_persona_id'`)

- [ ] **Step 3: 实现**

`server/app/rooms/protocol.py`:模块文档串末尾(`No new client frames: …` 那一句之后)追加:

```
Addressing (plan 2026-10-12-agents-addressing-server R1) only adds: the optional `say.to` (a persona id of this room's
agents; the server routes the message to that agent, or answers `notice agent_off`), the notice `voice_unclear` (a
transcript that was empty / failed while the voice was addressed to an agent or was a tutor answer) and the optional
public-message `meta` keys `to_agent` and `note_zh`. `PROTOCOL_VERSION` stays 2.
```

`SayMsg` 的 `reply_to` 之后加一行:

```python
    to: str | None = Field(None, max_length=MAX_ID)  # persona id the sender addresses (addressing §3.4)
```

`NOTICE_CODES` 替换为:

```python
NOTICE_CODES = ("ai_off", "ai_busy", "ai_quota", "voice_off", "voice_quota", "translate_quota", "retry_limit", "agent_off",
                "voice_unclear")
```

`server/app/rooms/rules.py`:`_LEVEL_BY_TIER = (...)` 之后加:

```python
def is_persona_id(value: object) -> bool:
    """The shape of a persona id (a builtin key or a lowercase uuid4). Membership in a room's agents is checked by the
    caller against the room's config (addressing R-AS7)."""
    return isinstance(value, str) and _PERSONA_ID.fullmatch(value) is not None
```

`server/app/rooms/store.py`:在 `fail_pending_ai` 之前加:

```python
    async def agent_of(self, room_id: str, seq: int) -> str | None:
        """Persona id of the public, visible agent answer at `seq` (the reply rule, spec addressing §3.2); None for
        everything else: members' messages, old `@ai` answers (no `meta.agent`), hidden or private rows, other rooms."""
        async with self._sm() as s:
            row = await s.scalar(select(RoomMessage).where(
                RoomMessage.room_id == room_id, RoomMessage.seq == seq, RoomMessage.lane == "public",
                RoomMessage.kind == "ai_answer", RoomMessage.hidden_at.is_(None)))
        agent = _agent_meta(row) if row is not None else None
        persona_id = agent.get("persona_id") if agent else None
        return persona_id if isinstance(persona_id, str) else None

    async def message_named(self, message_id: str) -> tuple[RoomMessage, str | None] | None:
        """One message with its sender's name (None for AI / system rows); the voice hook re-reads the stored row so
        the transcript never travels through arguments (addressing R-AS20)."""
        rows = await self._named(self._select().where(RoomMessage.id == message_id))
        return rows[0] if rows else None
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_rooms_addressing_protocol.py tests/test_rooms_addressing_store.py tests/test_rooms_rules.py tests/test_rooms_store.py tests/test_rooms_agents_store.py tests/test_architecture.py` → PASS

- [ ] **Step 5: 提交**

```bash
git add server/app/rooms/protocol.py server/app/rooms/rules.py server/app/rooms/store.py \
  server/tests/test_rooms_addressing_protocol.py server/tests/test_rooms_addressing_store.py
git commit -m "feat(server): say.to, voice_unclear notice, persona id shape and agent lookup for the reply rule

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task R2: `AgentLane.route`、`@ai` 并入默认智能体、删除旧公共回答通道(单独评审)

**Files:**
- Modify: `server/app/rooms/agent_lane.py`、`server/app/rooms/connection.py`
- Test: `server/tests/test_rooms_addressing_routing.py`(新建);改写 `test_rooms_agents_lane.py`、`test_rooms_connection.py`、`test_rooms_ws.py`、`test_rooms_social.py`、`test_rooms_prompts_ctx.py`、`test_rooms_prompts_live.py`、`test_web_contract.py`
- Re-record: `server/tests/fixtures/rooms_contract.json`

**Interfaces:**
- Produces: `agent_lane.DEFAULT_PERSONA_ID = "builtin:coach"`;`ROOM_RULES` 只要英文回复(中文说明由 L4 的 `lang.chat_rule` 追加);`AgentRoute.via`;`Target(persona, via)`;`AgentLane.route(conn, text, reply_to=None, to=None) -> AgentRoute | None`、`default_persona(cfg, personas)`、`_personas(cfg)`、`_implicit(room, personas, reply_to, to) -> Target | None`、`_admit(tell, target, *, room_id, asker_id, asker_name, personas, question) -> AgentRoute | None`(替换 `admit`);`_turn` 把 `Done.note_zh` 写进公开回复的 `meta.note_zh`;`connection.AgentsHandler.route(conn, text, reply_to, to)`(替换 `admit`);`RoomConnection._admit_ai` / `_answer` 删除
- Consumes: R1(`SayMsg.to`、`agent_of`)、T5(带练进行中 `room.agent_tutor` 非空)、L4(`Done.note_zh`、聊天语言说明)
- 评审:本任务单独 `/code-review high`(准入顺序、`release` 路径、优先级、带练关闭隐式路由、旧通道删除没有遗漏)

- [ ] **Step 1: 写失败测试**

`server/tests/test_rooms_addressing_routing.py`(新建):

```python
"""AgentLane.route: `@ai` = default agent, `@name`, the reply rule and `say.to` (plan addressing-server R2; spec
addressing §3, §4; rulings R-AS2..R-AS5, R-AS21..R-AS24)."""
import asyncio
import json
import logging
from dataclasses import replace

import pytest

from app.rooms.agent_lane import DEFAULT_PERSONA_ID
from tests.test_rooms_agents_lane import A, EMMA, LEO, env, say, types  # noqa: F401 (fixture)


def send(text: str, client_id: str = "q", **extra) -> str:
    return json.dumps({"type": "say", "client_id": client_id, "text": text, **extra})


def answers(conn) -> list[dict]:
    return [e["message"] for e in conn.sender.sent if e["type"] == "message" and e["message"]["kind"] == "ai_answer"]


def called(env) -> list[str]:
    return [req.persona.id for _, req in env.script.calls]


async def ask_emma(env) -> int:
    """One finished Emma answer in the room (bob asked); returns the answer's seq."""
    await env.cb.handle(say("@Emma first question", "seed"))
    await env.hub.drain()
    return answers(env.alice)[-1]["seq"]


@pytest.mark.parametrize("alias", ["@ai", "@AI", "@助手", "@ai:", "@助手,"])
async def test_the_alias_goes_to_the_first_configured_agent(env, alias):
    await env.cb.handle(send(f"{alias} what is a latte?"))
    await env.hub.drain()
    assert called(env) == [EMMA.id]
    assert answers(env.alice)[0]["meta"]["agent"] == {"persona_id": EMMA.id, "name": "Emma"}
    assert env.script.calls[0][1].text == "bob: what is a latte?"


async def test_the_default_is_the_first_agent_of_the_room_not_the_most_popular(env):
    await env.store.set_agents(env.room.id, A, [LEO.id, EMMA.id])
    await env.cb.handle(send("@ai is this fine?"))
    await env.hub.drain()
    assert called(env) == [LEO.id]


async def test_without_agents_or_with_only_deleted_ones_the_alias_uses_the_builtin_coach(env):
    await env.store.set_agents(env.room.id, A, [])
    await env.cb.handle(send("@ai hi"))
    await env.hub.drain()
    assert called(env) == [DEFAULT_PERSONA_ID]
    deps, _ = env.script.calls[0]
    assert deps["allow_private"] is True and deps["modes"]["chat"].others == []  # nobody to hand over to
    await env.store.set_agents(env.room.id, A, [LEO.id])
    del env.lookup.by_id[LEO.id]  # the only configured persona was deleted
    await env.cb.handle(send("@ai again", "q2"))
    await env.hub.drain()
    assert called(env) == [DEFAULT_PERSONA_ID, DEFAULT_PERSONA_ID]


async def test_a_disabled_first_agent_means_agent_off_not_the_second(env):
    env.lookup.by_id[EMMA.id] = replace(EMMA, disabled=True)
    await env.cb.handle(send("@ai hi"))
    assert types(env.bob)[-3:] == ["notice", "ack", "message"]
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "agent_off"}
    await env.hub.drain()
    assert env.script.calls == []


async def test_agents_off_gives_agent_off_for_every_explicit_way_and_keeps_the_message(env):
    env.feature = False
    await env.cb.handle(send("@ai hi", "q0"))
    await env.cb.handle(send("@Emma hi", "q1"))
    await env.cb.handle(send("hello", "q2", to=EMMA.id))
    notices = [e for e in env.bob.sender.sent if e["type"] == "notice"]
    assert notices == [{"type": "notice", "code": "agent_off"}] * 3
    assert types(env.bob).count("message") == 3 and env.script.calls == [] and env.hub.ai_pending(env.room.id) == 0


async def test_priority_alias_then_name_then_reply_then_to(env):
    seq = await ask_emma(env)  # replying to it would go to Emma
    await env.ca.handle(send("@Leo and you?", "p1", reply_to=seq, to=EMMA.id))  # a name beats reply and to
    await env.hub.drain()
    await env.ca.handle(send("@ai and you?", "p2", reply_to=seq, to=LEO.id))  # the alias beats everything (Emma is first)
    await env.hub.drain()
    await env.ca.handle(send("plain follow-up", "p3", reply_to=seq, to=LEO.id))  # the reply beats `to`
    await env.hub.drain()
    await env.ca.handle(send("only to", "p4", to=LEO.id))
    await env.hub.drain()
    assert called(env) == [EMMA.id, LEO.id, EMMA.id, EMMA.id, LEO.id]  # one turn per message, never two


async def test_replying_to_an_agent_message_needs_no_mention(env):
    seq = await ask_emma(env)
    await env.ca.handle(send("and the past tense?", "r1", reply_to=seq))
    await env.hub.drain()
    assert called(env) == [EMMA.id, EMMA.id]
    assert env.script.calls[1][1].text == "alice: and the past tense?"
    sent = next(e["message"] for e in env.bob.sender.sent if e["type"] == "message" and e["message"]["text"] == "and the past tense?")
    assert set(sent["meta"]) == {"quote"} and sent["ai_status"] == "pending"  # a reply leaves no to_agent trace


async def test_replies_to_other_messages_or_to_agents_that_left_are_plain(env):
    await env.ca.handle(send("human text", "h1"))
    human = env.bob.sender.sent[-1]["message"]["seq"]
    await env.cb.handle(send("replying to alice", "h2", reply_to=human))
    assert types(env.bob)[-2:] == ["ack", "message"]
    seq = await ask_emma(env)
    await env.store.set_agents(env.room.id, A, [LEO.id])  # Emma is no longer one of the room's agents
    await env.cb.handle(send("still talking to Emma?", "h3", reply_to=seq))
    await env.hub.drain()
    assert called(env) == [EMMA.id] and types(env.bob)[-2:] == ["ack", "message"]  # no turn, no notice


async def test_a_refused_reply_is_silent_for_off_and_disabled_but_not_for_the_room_gates(env):
    seq = await ask_emma(env)
    env.lookup.by_id[EMMA.id] = replace(EMMA, disabled=True)
    await env.cb.handle(send("reply 1", "r1", reply_to=seq))
    assert types(env.bob)[-2:] == ["ack", "message"]
    env.lookup.by_id[EMMA.id] = EMMA
    env.feature = False
    await env.cb.handle(send("reply 2", "r2", reply_to=seq))
    assert types(env.bob)[-2:] == ["ack", "message"]
    env.feature = True
    await env.store.set_ai_muted(env.room.id, True)
    await env.cb.handle(send("reply 3", "r3", reply_to=seq))
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "ai_off"}  # R-AS22
    await env.store.set_ai_muted(env.room.id, False)
    env.quota["room_ai_global"] = 0
    await env.cb.handle(send("reply 4", "r4", reply_to=seq))
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "ai_quota"}
    assert called(env) == [EMMA.id]


async def test_say_to_must_name_an_agent_of_the_room(env):
    await env.cb.handle(send("hello Leo", "t1", to=LEO.id))
    await env.hub.drain()
    assert called(env) == [LEO.id]
    sent = next(e["message"] for e in env.alice.sender.sent if e["type"] == "message")
    assert sent["meta"] == {"to_agent": LEO.id} and sent["ai_status"] == "pending"  # R-AS19
    await env.cb.handle(send("hello stranger", "t2", to="builtin:partner"))  # not in this room's config
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "agent_off"} and types(env.bob)[-2:] == ["ack", "message"]
    await env.cb.handle(send("blank to", "t3", to=""))  # an empty target is no target
    assert types(env.bob)[-3:] == ["message", "ack", "message"]
    env.lookup.by_id[LEO.id] = replace(LEO, disabled=True)
    await env.cb.handle(send("hi again", "t4", to=LEO.id))
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "agent_off"}
    await env.hub.drain()
    assert called(env) == [LEO.id]


async def test_an_at_that_names_nobody_falls_through_to_the_implicit_rules(env):
    await env.cb.handle(send("@alice look at this", "u1"))
    assert types(env.bob)[-2:] == ["ack", "message"] and env.script.calls == []
    await env.cb.handle(send("@alice look at this too", "u2", to=EMMA.id))
    await env.hub.drain()
    assert called(env) == [EMMA.id]  # R-AS21: the "对象" switch still applies


async def test_a_running_tutor_closes_implicit_routing_but_not_explicit_mentions(env):
    seq = await ask_emma(env)
    await env.store.set_tutor(env.room.id, {"phase": "await_answer", "persona_id": EMMA.id})
    await env.cb.handle(send("tutor chat 1", "w1", to=EMMA.id))
    await env.cb.handle(send("tutor chat 2", "w2", reply_to=seq))
    assert types(env.bob)[-3:] == ["message", "ack", "message"]  # published, no turn, no notice (R-AS3)
    await env.cb.handle(send("@Emma explicit", "w3"))
    await env.hub.drain()
    assert called(env) == [EMMA.id, EMMA.id]  # the seed and the explicit mention


async def test_a_refused_turn_still_publishes_the_message(env):
    for _ in range(env.store.limits.ai_queue):
        env.hub.ai_enter(env.room.id)
    await env.cb.handle(send("via to", "b1", to=EMMA.id))
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "ai_busy"}
    shown = env.alice.sender.sent[-1]["message"]
    assert shown["text"] == "via to" and shown["ai_status"] is None  # the answer is withheld, not the message
    for _ in range(env.store.limits.ai_queue):
        env.hub.ai_leave(env.room.id)
    env.quota["room_ai_global"] = 0
    await env.cb.handle(send("@ai again", "b2"))
    assert env.bob.sender.sent[-3] == {"type": "notice", "code": "ai_quota"}
    assert env.script.calls == [] and env.hub.ai_pending(env.room.id) == 0


async def test_concurrent_implicit_messages_reserve_their_slots_before_awaiting(env):
    env.script.block = asyncio.Event()
    real = env.deps.consume

    async def slow(scope, subject, limit):
        await asyncio.sleep(0.05)
        return await real(scope, subject, limit)

    env.deps.consume = slow
    for _ in range(env.store.limits.ai_queue - 1):
        env.hub.ai_enter(env.room.id)
    await asyncio.gather(env.cb.handle(send("one", "c1", to=EMMA.id)), env.ca.handle(send("two", "c2", to=LEO.id)))
    assert env.hub.ai_pending(env.room.id) == env.store.limits.ai_queue
    busy = [e for c in (env.alice, env.bob) for e in c.sender.sent if e == {"type": "notice", "code": "ai_busy"}]
    assert len(busy) == 1
    env.script.block.set()
    for _ in range(env.store.limits.ai_queue - 1):
        env.hub.ai_leave(env.room.id)
    await env.hub.drain()
    assert env.hub.ai_pending(env.room.id) == 0


async def test_a_failed_store_releases_the_reserved_slot_and_quota(env, monkeypatch):
    async def broken(*args, **kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr(env.store, "append", broken)
    with pytest.raises(RuntimeError):
        await env.cb.handle(send("hi", "x1", to=EMMA.id))
    assert env.hub.ai_pending(env.room.id) == 0 and env.refunds == ["room_ai_global"]


async def test_the_zh_note_goes_into_the_public_reply_meta_only_when_there_is_one(env):
    await env.cb.handle(send("@Emma hi", "n1"))
    await env.hub.drain()
    assert "note_zh" not in answers(env.alice)[-1]["meta"]
    env.script.note = "用过去式"
    await env.cb.handle(send("@Emma again", "n2"))
    await env.hub.drain()
    assert answers(env.alice)[-1]["meta"]["note_zh"] == "用过去式"
    rows, _ = await env.store.replay(env.room.id, A, 0, 50)
    assert [m.meta.get("note_zh") for m, _ in rows if m.kind == "ai_answer"] == [None, "用过去式"]  # replay carries it


async def test_routing_logs_no_text_names_or_ids(env, caplog):
    caplog.set_level(logging.DEBUG, logger="app")  # the app's own records; aiosqlite DEBUG logs SQL parameters
    seq = await ask_emma(env)
    await env.ca.handle(send("SECRET-REPLY-1", "s1", reply_to=seq))
    await env.cb.handle(send("@ai SECRET-ALIAS-2", "s2"))
    await env.cb.handle(send("SECRET-TO-3", "s3", to=LEO.id))
    await env.cb.handle(send("SECRET-STRANGER-4", "s4", to="builtin:partner"))
    env.script.error = "llm_unavailable"
    await env.cb.handle(send("SECRET-FAIL-5", "s5", to=EMMA.id))
    await env.hub.drain()
    text = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("app"))
    for secret in ("SECRET-", "Emma", "Leo", "alice", "bob", EMMA.id, LEO.id, "builtin:partner", "用过去式"):
        assert secret not in text
    assert "room agent turn failed code=upstream" in text
```

`server/tests/test_rooms_agents_lane.py`:

1. `Script.__init__` 里加 `self.note = None`;`run_turn` 的最后一行改为:

```python
        yield Done(usage=None, trace={"steps": [{"key": "learned_words", "status": "done"}]}, text_len=len(text),
                   note_zh=self.note)
```

2. `test_rooms_without_agents_and_at_ai_keep_the_old_frames` 整体替换为:

```python
async def test_at_ai_goes_to_the_default_agent_and_an_unconfigured_name_is_just_text(env):
    await env.cb.handle(say("@ai what does break the ice mean?"))
    await env.hub.drain()
    assert types(env.alice) == ["message", "ai_typing", "message"]
    meta = env.alice.sender.sent[2]["message"]["meta"]
    assert meta["agent"] == {"persona_id": EMMA.id, "name": "Emma"}  # the room's first agent answers `@ai`
    assert [req.persona.id for _, req in env.script.calls] == [EMMA.id]
    await env.store.set_agents(env.room.id, A, [])
    await env.cb.handle(say("@Emma hi there", "q2"))
    await env.hub.drain()
    assert types(env.bob)[-2:] == ["ack", "message"] and env.bob.sender.sent[-1]["message"]["ai_status"] is None
    assert len(env.script.calls) == 1  # no configuration: `@Emma` names nobody
```

`server/tests/test_rooms_connection.py`:`Env.__init__` 里 `self.replies = {"answer": ..., "assist": ASSIST}` 改为 `self.replies = {"assist": ASSIST}`;`deps()` 里 `complete` 的返回改为 `return self.replies["assist"]`(旧的 `if "<draft>" in …` 分支删掉)。把 `test_at_ai_answers_publicly`、`test_at_ai_respects_owner_switch_and_failures`、`test_at_ai_queue_is_bounded`、`test_at_ai_admission_reserves_the_queue_slot_before_awaiting`、`test_at_ai_append_failure_releases_queue_and_quota` 五个用例整体删掉(行为由 `test_rooms_addressing_routing.py` 与 `test_rooms_agents_lane.py` 覆盖),换成:

```python
async def test_at_ai_without_agents_is_a_plain_message_with_agent_off(env):
    await env.cb.handle('{"type":"say","client_id":"q","text":"@ai what does break the ice mean?"}')
    await env.hub.drain()
    assert {"type": "notice", "code": "agent_off"} in env.bob.sender.sent
    assert {"type": "notice", "code": "agent_off"} not in env.alice.sender.sent
    assert types(env.alice) == ["message"] and env.alice.sender.sent[0]["message"]["ai_status"] is None
    assert env.hub.ai_pending(env.room.id) == 0 and env.refunds == [] and env.quota["room_ai_global"] == 99


async def test_say_to_without_agents_is_agent_off_and_the_message_is_still_published(env):
    await env.cb.handle('{"type":"say","client_id":"q","text":"hello","to":"builtin:coach"}')
    assert {"type": "notice", "code": "agent_off"} in env.bob.sender.sent
    assert env.alice.sender.sent[0]["message"]["text"] == "hello"
    await env.cb.handle('{"type":"say","client_id":"q2","text":"plain","to":""}')  # an empty target is no target
    assert env.bob.sender.sent[-1]["type"] == "message" and env.bob.sender.sent.count({"type": "notice", "code": "agent_off"}) == 1
```

`server/tests/test_rooms_ws.py`:

1. `test_two_members_chat_ai_and_private_assist` 里从 `wb.send_text('{"type":"say","client_id":"q","text":"@ai what does break the ice mean?"}')` 起到末尾 `assert events[-1]["message"]["sender"]["kind"] == "ai"` 替换为:

```python
        wb.send_text('{"type":"say","client_id":"q","text":"@ai what does break the ice mean?"}')
        assert until(wb, "notice")[-1] == {"type": "notice", "code": "agent_off"}  # agents are off: no public AI answer
        events = until(wa, "message")
        while not events[-1]["message"]["text"].startswith("@ai"):  # the question is still a plain message
            events = until(wa, "message")
```

2. `test_admin_hide_and_ai_mute_reach_members` 的第一行改为(R-AS24:功能关闭先于静音,这个用例要在开着智能体的应用里测静音):

```python
    app, client = make_client(tmp_path, monkeypatch, **ADMIN_ENABLED, agents_enabled=True, agents_rooms_enabled=True)
```

`server/tests/test_rooms_social.py`:`test_quotes_of_ai_answers_and_long_texts` 整体替换为(旧 `@ai` 回答没有 `meta`,引用仍用旧名字;智能体回答用角色名):

```python
def test_quotes_of_ai_answers_and_long_texts(tmp_path, monkeypatch):
    app, client = make_client(tmp_path, monkeypatch)
    try:
        room, alice, bob, bob_id, ticket = setup_room(client)
        with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(alice)}") as wa:
            hello(wa)
            wa.send_text(json.dumps({"type": "say", "client_id": "a1", "text": "长" * 100}))
            long = last_message(wa)
        rt = rooms_router.runtime(app)

        async def seed():
            now = datetime.now(timezone.utc)
            legacy = await rt.store.append(room["id"], lane="public", sender_kind="ai", sender_id=None,
                                           kind="ai_answer", text="It means starting a conversation.", now=now)
            agent = await rt.store.append(room["id"], lane="public", sender_kind="ai", sender_id=None, kind="ai_answer",
                                          text="Try it.", now=now,
                                          meta={"agent": {"persona_id": "builtin:coach", "name": "Emma"}})
            return legacy, agent

        legacy, agent = client.portal.call(seed)
        assert client.portal.call(rt.store.quote_for, room["id"], long["seq"])["text"] == "长" * 80
        assert client.portal.call(rt.store.quote_for, room["id"], legacy.seq) == {
            "seq": legacy.seq, "name": "AI 助手", "kind": "ai_answer", "text": "It means starting a conversation."}
        assert client.portal.call(rt.store.quote_for, room["id"], agent.seq)["name"] == "Emma"
    finally:
        client.__exit__(None, None, None)
```

`server/tests/test_rooms_prompts_ctx.py`:`test_room_level_and_scenario_reach_prompts_and_metering` 里删掉整段 `@ai` 提问(从 `ws.send_text(json.dumps({"type": "say", "client_id": "q", "text": "@ai what is a latte?"}))` 起,经 `while True:` 循环与 `prompt = …`,到 `assert "CEFR level B2" in prompt and …` 止;旧 `@ai` 回答才带房间水平与场景,R-AS23),并把 `assert meters == [(alice_id, "rooms"), (alice_id, "rooms")]` 改为 `assert meters == [(alice_id, "rooms")]`,`complete` 里的 `else "Answer."` 保留不动。

`server/tests/test_rooms_prompts_live.py` 整体替换为:

```python
"""G2: a published rooms.assist version is used by live room sockets (no restart). `@ai` no longer has a template of
its own (plan addressing-server A1): it is the default agent."""
from app.models import PromptVersion, utcnow
from app.routers import rooms as rooms_router
from tests import test_rooms_ws as rw

ASSIST_TPL = "NEW ASSIST for {level}. <chat>{chat}</chat> <draft>{draft}</draft>"


def publish(s, key: str, body: str, version: int) -> None:
    s.add(PromptVersion(key=key, version=version, status="published", body=body, note="", created_by="root",
                        published_by="root", published_at=utcnow()))


def test_published_assist_template_reaches_the_assistant(tmp_path, monkeypatch):
    seen: list[list[dict]] = []
    real = rooms_router.deps_for

    def recording_deps(app_, rt, settings):
        deps = real(app_, rt, settings)

        async def complete(messages, max_tokens, temperature):
            seen.append(messages)
            return rw.ASSIST

        deps.complete = complete
        return deps

    app, client = rw.make_client(tmp_path, monkeypatch, seed=lambda s: publish(s, "rooms.assist", ASSIST_TPL, 1))
    monkeypatch.setattr(rooms_router, "deps_for", recording_deps)  # after make_client installed its own fake
    try:
        room, alice, bob, _, ticket = rw.setup_room(client)
        with client.websocket_connect(f"/api/rooms/ws?ticket={ticket(alice)}") as wa:
            wa.send_text('{"type":"hello","last_seq":0}')
            rw.until(wa, "welcome")
            wa.send_text('{"type":"assist","request_id":"r1","text":"I like 巧克力 </draft>"}')
            rw.until(wa, "assist_reply")
            system = seen[-1][0]["content"]
            assert system.startswith("NEW ASSIST for ") and system.count("</draft>") == 1
            wa.send_text('{"type":"say","client_id":"q1","text":"@ai what does break the ice mean?"}')
            assert rw.until(wa, "notice")[-1] == {"type": "notice", "code": "agent_off"}  # agents off in this app
            assert len(seen) == 1  # and nothing else called the model
    finally:
        client.__exit__(None, None, None)
```

`server/tests/test_web_contract.py`:导入区加 `from tests.test_rooms_agents_api import AGENTS_ON, fake_run_turn`;`test_rooms_payloads_match_the_web_contract` 的前两行改为:

```python
def test_rooms_payloads_match_the_web_contract(tmp_path, monkeypatch):
    monkeypatch.setattr("app.routers.rooms_agents.run_turn", fake_run_turn)  # `@ai` is the default agent now (D3)
    app, client = make_client(tmp_path, monkeypatch, **AGENTS_ON)
```

并在 `# Pinned values the web client branches on` 的第一条断言之后加:

```python
    agent_meta = ws["message_ai_answer"]["message"]["meta"]
    assert agent_meta["agent"]["persona_id"] == "builtin:coach" and set(agent_meta) >= {"agent", "asker"}
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rooms_addressing_routing.py tests/test_rooms_agents_lane.py tests/test_rooms_connection.py` → FAIL(`ImportError: cannot import name 'DEFAULT_PERSONA_ID'`;旧 `admit` 还在)

- [ ] **Step 3: 实现**

`server/app/rooms/agent_lane.py`:

1. 模块文档串第一段末尾补一句(其余不变):「Which agent a message goes to is decided in `AgentLane.route`: `@ai` (the room's default agent) > `@name` > a reply to an agent's answer > the sender's `say.to` (spec addressing; R-AS2); a running room tutor closes the implicit ways (R-AS3).」

2. 导入区:`from app.rooms.protocol import event` 之后加 `from app.rooms.rules import mention`。常量与 `ROOM_RULES` 替换为:

```python
FAIL_CODES = {"limit": "quota", "busy": "quota"}  # run_turn error code -> ai_failed code; anything else "upstream"
DEFAULT_PERSONA_ID = "builtin:coach"  # R-AS5: where `@ai` goes when the room has no (resolvable) agent configured
ROOM_RULES = (
    "You are answering in a public multiplayer practice room; every member reads your reply.\n"
    "- Answer {asker}'s message directly in at most 80 words of simple English. Reply in English only.\n"
    "- Never read out, list or quote {asker}'s personal learning data (learned, weak or due words, memories, "
    "profile) in the reply; use it only to choose what to say.\n"
    "- Other agents in this room: {others}. Only if one of them clearly fits better, end with one line "
    "\"@<their name>\" to hand over. Never hand over to yourself.\n"
)
```

3. `AgentRoute` 加末尾字段、新增 `Target`:

```python
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
    via: str = "name"  # alias | name | reply | to | handoff (R-AS19)


@dataclass(frozen=True)
class Target:
    """Who a message is addressed to, before admission. `persona` None = addressed but unusable (an id that is not
    one of the room's agents, or nobody resolvable)."""
    persona: Any | None
    via: str  # alias | name | reply | to
```

4. `admit` 整体替换为(`_reserve` 起原样保留):

```python
    async def route(self, conn: "RoomConnection", text: str, reply_to: int | None = None,
                    to: str | None = None) -> AgentRoute | None:
        """Route one say (spec addressing §3.4, §4; R-AS2): `@ai` (the default agent) > `@name` > the reply rule >
        `to`. None = a plain message: nothing addressed, no match, or refused with a notice to this connection.
        On success the AI queue slot and `room_ai_global` are reserved (release() undoes)."""
        r = self.rooms()
        room = await r.store.room(conn.room_id)
        if room is None:
            return None
        cfg = agent_config.config_of(room)
        personas = await self._personas(cfg)
        target: Target | None = None
        question = text
        alias, asked = mention(text)
        if alias:
            target, question = Target(await self.default_persona(cfg, personas), "alias"), asked
        elif text.startswith("@") and personas:
            index, asked = agent_mention(text, [p.name for p in personas])
            if index is not None:
                target, question = Target(personas[index], "name"), asked
        if target is None:  # R-AS21: an `@` that names nobody we know falls through to the implicit rules
            target = await self._implicit(room, personas, reply_to, to)
        if target is None:
            return None
        return await self._admit(conn.send_self, target, room_id=conn.room_id, asker_id=conn.user_id,
                                 asker_name=conn.name, personas=personas, question=question)

    async def _personas(self, cfg: agent_config.AgentConfig) -> list:
        """The room's configured personas that still exist, in the owner's order."""
        return await agent_config.resolve(self.deps.personas, cfg) if cfg.persona_ids else []

    async def default_persona(self, cfg: agent_config.AgentConfig, personas: list):
        """R-AS5: the first resolvable configured persona, else the built-in coach (looked up as the chooser)."""
        if personas:
            return personas[0]
        return await self.deps.personas.get(cfg.chosen_by or 0, DEFAULT_PERSONA_ID)

    async def _implicit(self, room, personas: list, reply_to: int | None, to: str | None) -> Target | None:
        """The ways that need no `@`: a reply to an agent's answer, then the sender's `to` (R-AS2). A running room
        tutor closes both (R-AS3): its called member's answers go to the tutor, everyone else's are context."""
        if isinstance(room.agent_tutor, dict):
            return None
        if reply_to is not None:
            persona_id = await self.rooms().store.agent_of(room.id, reply_to)
            persona = next((p for p in personas if p.id == persona_id), None) if persona_id else None
            if persona is not None:  # an agent that left the room's config makes the reply a plain message
                return Target(persona, "reply")
        if to is not None:
            return Target(next((p for p in personas if p.id == to), None), "to")
        return None

    async def _admit(self, tell: Callable[[dict], Awaitable[None]], target: Target, *, room_id: str, asker_id: int,
                     asker_name: str, personas: list, question: str) -> AgentRoute | None:
        """Switches, persona state and the shared room gates. Explicit ways get `agent_off` when refused; a refused
        reply is silent (R-AS4). `_reserve` tells about `ai_off` / `ai_busy` / `ai_quota` for every way (R-AS22)."""
        persona = target.persona
        if not self.deps.feature_on() or persona is None or getattr(persona, "disabled", False):
            if target.via != "reply":
                await tell(event("notice", code="agent_off"))
            return None
        route = AgentRoute(room_id, asker_id, asker_name, persona, tuple(personas) or (persona,), question,
                           via=target.via)
        return route if await self._reserve(route, tell) else None
```

5. `_turn`:在 `failure: str | None = None` 之后加 `note: str | None = None`;循环里 `elif isinstance(ev, Done): trace = ev.trace` 改为:

```python
                                elif isinstance(ev, Done):
                                    trace = ev.trace
                                    note = ev.note_zh  # resolved by the orchestrator (setting, <<ZH>>, fallback)
```

`meta = {"agent": ..., "asker": ...}` 之后、`if route.handoff_from is not None:` 之前加:

```python
        if note:
            meta["note_zh"] = note  # spec addressing §5.2: never part of the public text, never read aloud
```

6. `_handoff` 里 `nxt = AgentRoute(...)` 末尾加 `via="handoff"`。

`server/app/rooms/connection.py`:

1. 导入:删 `from app.providers.llm import LlmUnavailable`;其余导入不变(`metering`、`brief`、`assistant` 仍被私聊助手使用)。
2. `AgentsHandler` 整体替换为:

```python
class AgentsHandler(Protocol):
    """Room agents (plan 2026-10-12-agents-rooms, addressing): `rooms.agent_lane.AgentLane`, installed on
    `RoomsRuntime.agents` by `routers/rooms_agents.install`. None = no agent code at all (rooms behave as plain chat;
    `@ai` and `say.to` then only give `notice agent_off`)."""

    async def route(self, conn: "RoomConnection", text: str, reply_to: int | None, to: str | None) -> Any | None: ...

    async def release(self, route: Any) -> None: ...

    async def answer(self, route: Any, seq: int, message_id: str) -> None: ...

    async def on_member_message(self, conn: "RoomConnection", message) -> None: ...

    async def on_welcome(self, conn: "RoomConnection") -> None: ...
```

并把 `from typing import Protocol` 改为 `from typing import Any, Protocol`。

3. `on_say` 从 `is_ai, question = mention(text)` 到方法末尾替换为:

```python
        route = None
        if d.agents is not None:  # `@ai` / `@name` / a reply to an agent / `to`: at most one turn per message (R-AS2)
            route = await d.agents.route(self, text, msg.reply_to, msg.to or None)
        elif msg.to or mention(text)[0]:  # no agent code at all: the message stays a plain one
            await self._send(event("notice", code="agent_off"))
        meta: dict = {}
        if quote:
            meta["quote"] = quote
        if route is not None and route.via == "to":  # R-AS19: only a `to` that actually routed leaves a trace
            meta["to_agent"] = route.persona.id
        try:
            async with d.hub.lock(self.room_id):
                m = await d.store.append(self.room_id, lane="public", sender_kind="user", sender_id=self.user_id,
                                         kind="text", text=text, now=now, assisted=msg.assist_id is not None,
                                         ai_status="pending" if route is not None else None,
                                         client_id=msg.client_id, reply_to=msg.reply_to, meta=meta or None)
        except BaseException:
            if route is not None:  # the question was never stored: release its queue slot and quota
                await d.agents.release(route)
            raise
        await self._send(event("ack", client_id=msg.client_id, seq=m.seq))
        await d.hub.broadcast(self.room_id, event("message", message=await d.store.out_one(m.id)))
        if route is not None:
            d.hub.spawn(d.agents.answer(route, m.seq, m.id))
        elif d.agents is not None:  # a room tutor may be waiting for this member's answer (R-RA8)
            await d.agents.on_member_message(self, m)
```

4. 删除 `_admit_ai` 与 `_answer` 两个方法整体。`assistant.ANSWER_CONTEXT` 等引用随之消失(`assistant` 里的旧常量在 A1 删除)。

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_rooms_addressing_routing.py tests/test_rooms_agents_lane.py tests/test_rooms_connection.py tests/test_rooms_ws.py tests/test_rooms_social.py tests/test_rooms_prompts_ctx.py tests/test_rooms_prompts_live.py tests/test_rooms_agents_ws.py tests/test_rooms_agents_privacy.py tests/test_rooms_agent_tutor.py tests/test_architecture.py`;`grep -n "_admit_ai\|def _answer\|LlmUnavailable\|ANSWER_" server/app/rooms/connection.py` → 无输出 → PASS。`test_web_contract.py` 此时因 `message_ai_answer.meta` 形状变化失败,见 Step 5。

- [ ] **Step 5: 重录房间契约** — Run: `cd server && uv run pytest -q tests/test_web_contract.py` → FAIL(`ws.message_ai_answer changed shape`:`meta` 由 `null` 变为 `{agent, asker}`);重录:`CONTRACT_UPDATE=1 uv run pytest -q tests/test_web_contract.py`(PowerShell 写法见 Global Constraints),再不带变量跑一次 → PASS;`git diff tests/fixtures/rooms_contract.json` 只应出现 `ws.message_ai_answer.message.meta`(`agent`、`asker` 两个对象)和因此变动的取值(消息 id / 时间 / 文字),`http.messages` 的形状不变。网页的 `rooms-contract.test.ts` 逐键核对这份夹具,不依赖 `meta` 为 `null`。

- [ ] **Step 6: 提交**

```bash
git add server/app/rooms/agent_lane.py server/app/rooms/connection.py \
  server/tests/test_rooms_addressing_routing.py server/tests/test_rooms_agents_lane.py server/tests/test_rooms_connection.py \
  server/tests/test_rooms_ws.py server/tests/test_rooms_social.py server/tests/test_rooms_prompts_ctx.py \
  server/tests/test_rooms_prompts_live.py server/tests/test_web_contract.py server/tests/fixtures/rooms_contract.json
git commit -m "feat(server): route room messages to agents (@ai alias, reply rule, say.to); remove the public answer lane

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task R3: 真实应用里的联机路由与契约(WebSocket 端到端)

**Files:**
- Modify: `server/tests/test_rooms_agents_api.py`(脚本化回合带 `note_zh`)、`server/tests/test_rooms_agents_ws.py`、`server/tests/test_rooms_agents_contract.py`
- Re-record: `server/tests/fixtures/rooms_agents_contract.json`

**Interfaces:**
- Produces(夹具):`ws.message_agent_answer.message.meta.note_zh`(可选键;键名沿用 `message_agent_answer`,R-AS17 / R-AS18);`http.agents` 与 `agent_tutor` 帧的键集合不变(网页逐键核对)
- 本任务不改产品代码:只在真实应用上钉住 R2 的线上行为

- [ ] **Step 1: 写测试**

`server/tests/test_rooms_agents_api.py`:`fake_run_turn` 的 `Done` 改为带说明:

```python
    yield Done(usage=None, trace={"steps": [{"key": "learned_words", "status": "done"}]}, text_len=44,
               note_zh="先想想过去式")
```

`server/tests/test_rooms_agents_ws.py` 末尾追加:

```python
def _open(client, room, headers):
    ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=headers).json()["ticket"]
    ws = client.websocket_connect(f"/api/rooms/ws?ticket={ticket}")
    return ws


def test_the_alias_replies_and_say_to_reach_agents_without_a_mention(agents_client):
    app, client = agents_client
    room, alice, _, bob, _ = room_of(client)
    with _open(client, room, bob) as wb:
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        # no agents configured: `@ai` is the built-in coach (R-AS5)
        wb.send_text(json.dumps({"type": "say", "client_id": "q0", "text": "@ai what is a latte?"}))
        first = until_answer(wb)[-1]["message"]
        assert first["meta"]["agent"]["persona_id"] == "builtin:coach" and first["meta"]["note_zh"]
        # a reply to the agent's answer needs no `@`
        wb.send_text(json.dumps({"type": "say", "client_id": "q1", "text": "and in the past tense?",
                                 "reply_to": first["seq"]}))
        second = until_answer(wb)[-1]["message"]
        assert second["meta"]["agent"]["persona_id"] == "builtin:coach" and second["seq"] > first["seq"]
        # `to` must belong to the room's agents: with none configured it is refused, the message is still published
        wb.send_text(json.dumps({"type": "say", "client_id": "q2", "text": "just checking", "to": "builtin:coach"}))
        assert until(wb, "notice")[-1] == {"type": "notice", "code": "agent_off"}
    client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach"]}, headers=alice)
    with _open(client, room, bob) as wb:
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        wb.send_text(json.dumps({"type": "say", "client_id": "q3", "text": "talking to you", "to": "builtin:coach"}))
        third = until_answer(wb)[-1]["message"]
        assert third["meta"]["agent"]["persona_id"] == "builtin:coach"
    history = client.get(f"/api/rooms/{room['id']}/messages", params={"before_seq": 2_147_483_647}, headers=bob).json()
    sent = next(m for m in history["messages"] if m["text"] == "talking to you")
    assert sent["meta"] == {"to_agent": "builtin:coach"} and sent["ai_status"] == "done"  # R-AS19, and replay carries it
    plain = next(m for m in history["messages"] if m["text"] == "just checking")
    assert plain["meta"] is None and plain["ai_status"] is None


def test_the_agents_endpoint_keeps_its_shape(agents_client):
    """R-AS18: the web pins these keys exactly; the default agent is derived from `agent_ids[0]`."""
    app, client = agents_client
    room, alice, _, bob, _ = room_of(client)
    patched = client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach"]}, headers=alice).json()
    body = client.get(f"/api/rooms/{room['id']}/agents", headers=bob).json()
    assert sorted(body) == ["agents", "available", "tutor"] and patched["room"]["agent_ids"] == ["builtin:coach"]
```

`server/tests/test_rooms_agents_contract.py`:`test_room_agents_payloads_match_the_web_contract` 之后追加一条断言(录制来自脚本化回合,它带 `note_zh`):

```python
def test_the_recorded_answer_carries_the_optional_note(agents_client):
    _app, client = agents_client
    got = record(client)
    meta = got["ws"]["message_agent_answer"]["message"]["meta"]
    assert meta["note_zh"] == "先想想过去式" and set(meta) == {"agent", "asker", "note_zh"}
    assert sorted(got["http"]["agents"]) == ["agents", "available", "tutor"]  # R-AS18
```

- [ ] **Step 2: 跑测试** — Run: `cd server && uv run pytest -q tests/test_rooms_agents_ws.py tests/test_rooms_agents_contract.py tests/test_rooms_agents_api.py` → `test_room_agents_payloads_match_the_web_contract` FAIL(形状多出 `meta.note_zh`),其余 PASS(R2 已实现路由)

- [ ] **Step 3: 重录夹具** — Run: `cd server && CONTRACT_UPDATE=1 uv run pytest -q tests/test_rooms_agents_contract.py`(PowerShell 写法见 Global Constraints),再不带变量跑一次 → PASS;`git diff tests/fixtures/rooms_agents_contract.json` 只应出现 `ws.message_agent_answer.message.meta.note_zh`(与随机 id / 时间)。**不应**出现 `default_agent`、`hint`、`hint_zh`(R-AS18:帧的必需键集合不变;`hint_zh` 在假上游下不会出现,由 `test_rooms_agent_tutor.py` 钉住)。

- [ ] **Step 4: 跑相关测试** — Run: `cd server && uv run pytest -q tests/test_rooms_agents_ws.py tests/test_rooms_agents_contract.py tests/test_rooms_agents_api.py tests/test_rooms_agents_privacy.py tests/test_rooms_agent_tutor_api.py tests/test_web_contract.py` → PASS

- [ ] **Step 5: 提交**

```bash
git add server/tests/test_rooms_agents_api.py server/tests/test_rooms_agents_ws.py server/tests/test_rooms_agents_contract.py server/tests/fixtures/rooms_agents_contract.json
git commit -m "test(server): addressing end to end in a real room (alias, reply rule, say.to); re-record rooms agents contract

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

## Lane V · 语音带目标、转写成功后触发智能体

### Task V1: 上传的 `to_agent`、语音消息 `meta`、转写结束钩子

**Files:**
- Modify: `server/app/rooms/voice_store.py`、`server/app/rooms/voice.py`、`server/app/routers/rooms_voice.py`
- Test: `server/tests/test_rooms_voice_service.py`、`server/tests/test_rooms_voice_api.py`(追加)

**Interfaces:**
- Produces: `VoiceStore.append_voice(..., message_id=None, to_agent=None)`(写进该语音消息自己的 `meta`,与 `quote` 并存;R-AS1:无迁移);`VoiceDeps.agents: Callable[[], Any] | None = None`(返回房间的 `AgentLane` 或 `None`);`VoiceService.upload(room, sender_id, sender_name, wav, client_id, reply_to, to_agent=None)`;`VoiceService._after_transcript(room_id, message_id, status)`(每次转写结束后调用 `agents.on_voice(room_id, message_id, status)`,`status ∈ done | empty | failed`);上传表单可选字段 `to_agent`(形状不合法 → 400 `Invalid to_agent`;空串 / `null` = 没有目标)
- 钩子只收 id 与状态(R-AS20);拿不到 `on_voice` 的处理器(V2 之前的车道、旧版)视为没有钩子;钩子异常只记异常类名,不影响转写结果
- 网页的 `voice-contract.test.ts` 在 `routers/rooms_voice.py` 里找字面量 `form.get("to_agent")`(Cross-plan S-2)

- [ ] **Step 1: 写失败测试**

`server/tests/test_rooms_voice_service.py` 末尾追加(文件已有 `env` 固件、`events`、`FakeConn`、`wav_bytes`、`A`、`B`):

```python
class FakeLane:
    """Stands in for AgentLane: records what the voice service hands over (ids and the status, never text)."""

    def __init__(self):
        self.calls: list[tuple[str, str, str]] = []
        self.fail = False

    async def on_voice(self, room_id, message_id, status):
        self.calls.append((room_id, message_id, status))
        if self.fail:
            raise RuntimeError("SECRET-HOOK-FAIL")


async def test_upload_stores_the_target_and_the_quote_in_the_message_meta(env):
    service, room, hub, senders, state, _ = env
    out = await service.upload(room, A, "alice", wav_bytes(2), "c1", None, "builtin:coach")
    await hub.drain()
    assert out["meta"] == {"to_agent": "builtin:coach"}
    quoted = await service.upload(room, A, "alice", wav_bytes(2), "c2", out["seq"], "builtin:coach")
    assert set(quoted["meta"]) == {"quote", "to_agent"}
    plain = await service.upload(room, A, "alice", wav_bytes(2), "c3", None)
    await hub.drain()
    assert plain["meta"] is None


async def test_every_finished_transcription_reaches_the_agents_hook(env):
    service, room, hub, senders, state, _ = env
    lane = FakeLane()
    service.deps.agents = lambda: lane
    done = await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await hub.drain()
    state["transcript"] = "  "
    empty = await service.upload(room, A, "alice", wav_bytes(2), "c2", None)
    await hub.drain()
    state["transcript"], state["fail"] = "again", True
    failed = await service.upload(room, A, "alice", wav_bytes(2), "c3", None)
    await hub.drain()
    assert lane.calls == [(room.id, done["id"], "done"), (room.id, empty["id"], "empty"),
                          (room.id, failed["id"], "failed")]
    state["fail"] = False  # the sender retries: a success triggers the hook once more, as "done"
    await service.on_retry(FakeConn(hub, room.id, A), failed["seq"])
    await hub.drain()
    assert lane.calls[-1] == (room.id, failed["id"], "done") and len(lane.calls) == 4


async def test_a_lane_without_on_voice_or_none_means_no_hook(env):
    service, room, hub, senders, state, _ = env
    service.deps.agents = lambda: None
    await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    service.deps.agents = lambda: object()  # a lane from before V2
    await service.upload(room, A, "alice", wav_bytes(2), "c2", None)
    await hub.drain()
    assert [u["voice"]["status"] for u in events(senders[B], "voice_update")] == ["done", "done"]


async def test_a_failing_hook_never_breaks_the_transcription_and_leaks_nothing(env, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    service, room, hub, senders, state, _ = env
    lane = FakeLane()
    lane.fail = True
    service.deps.agents = lambda: lane
    await service.upload(room, A, "alice", wav_bytes(2), "c1", None)
    await hub.drain()
    assert events(senders[B], "voice_update")[-1]["voice"]["status"] == "done"
    assert "room voice agent hook failed" in caplog.text and "RuntimeError" in caplog.text
    assert "SECRET-HOOK-FAIL" not in caplog.text and "noodle" not in caplog.text
```

`server/tests/test_rooms_voice_api.py` 末尾追加:

```python
def test_to_agent_is_validated_by_shape_and_kept_in_the_message_meta(tmp_path, monkeypatch):
    app, client, rt = _client(tmp_path, monkeypatch)
    try:
        alice, _ = login(client, "alice")
        room = client.post("/api/rooms", json={}, headers=alice).json()["room"]
        ok = _upload(client, room["id"], alice, "c1", to_agent="builtin:coach")
        assert ok.status_code == 200 and ok.json()["message"]["meta"] == {"to_agent": "builtin:coach"}
        for i, bad in enumerate(("builtin:Coach", "x" * 80, "builtin:coach\nx", "../etc")):
            r = _upload(client, room["id"], alice, f"b{i}", to_agent=bad)
            assert r.status_code == 400 and r.json() == {"error": "Invalid to_agent"}, bad  # R-AS7: shape only here
        for i, blank in enumerate(("", "null", "  ")):
            r = _upload(client, room["id"], alice, f"n{i}", to_agent=blank)
            assert r.status_code == 200 and r.json()["message"]["meta"] is None
        again = _upload(client, room["id"], alice, "c1", to_agent="builtin:coach")  # a retried upload is the same message
        assert again.json()["seq"] == ok.json()["seq"]
    finally:
        client.__exit__(None, None, None)
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rooms_voice_service.py tests/test_rooms_voice_api.py` → FAIL(`TypeError: upload() takes 7 positional arguments but 8 were given`)

- [ ] **Step 3: 实现**

`server/app/rooms/voice_store.py`:`append_voice` 的签名与 `meta` 替换为:

```python
    async def append_voice(self, room_id: str, *, sender_id: int, client_id: str, reply_to: int | None,
                           quote: dict | None, duration_ms: int, audio_path: str, audio_bytes: int, audio_format: str,
                           staging_path: str, now: datetime, message_id: str | None = None,
                           to_agent: str | None = None) -> tuple[RoomMessage, RoomVoice]:
        """The voice message and its `room_voice` row in one transaction (plan P2-9). Same seq logic as
        `RoomStore.append` (the caller holds `RoomHub.lock(room_id)`). `message_id` lets the caller name the files
        before the row exists. `to_agent` (addressing R-AS1) is the persona id the sender addressed, kept in the
        message's own `meta` next to the quote: the room_voice table needs no new column."""
        meta = {key: value for key, value in (("quote", quote), ("to_agent", to_agent)) if value}
```

`msg = RoomMessage(...)` 里的 `meta={"quote": quote} if quote else None` 改为 `meta=meta or None`。

`server/app/rooms/voice.py`:`from collections.abc import Awaitable, Callable` 之后的导入里加 `from typing import Any`(与 `dataclasses` 同区);`VoiceDeps` 末尾加:

```python
    agents: Callable[[], Any] | None = None  # () -> the room AgentLane (or None): `on_voice` after every transcription
```

`upload` 的签名与 `append_voice` 调用替换为:

```python
    async def upload(self, room: Room, sender_id: int, sender_name: str, wav: bytes, client_id: str,
                     reply_to: int | None, to_agent: str | None = None) -> dict:
```

```python
                    msg, _voice = await d.voices.append_voice(
                        room.id, sender_id=sender_id, client_id=client_id, reply_to=reply_to, quote=quote,
                        duration_ms=info.duration_ms, audio_path=stored, audio_bytes=len(data), audio_format=fmt,
                        staging_path=staging, now=now, message_id=message_id, to_agent=to_agent)
```

`_transcribe` 的失败分支与成功路径各加一次钩子:失败分支里 `await self._broadcast_voice(room_id, seq, voice)` 之后、`return` 之前加

```python
                await self._after_transcript(room_id, message_id, "failed")
```

成功路径末尾 `await self._broadcast_voice(room_id, seq, voice)` 之后(与 `try` 同级的最后一行)加

```python
            await self._after_transcript(room_id, message_id, status)
```

`_transcribe` 之后新增方法:

```python
    async def _after_transcript(self, room_id: str, message_id: str, status: str) -> None:
        """Hand a finished transcription (`done` / `empty` / `failed`, retries included) to the room's agents
        (addressing R-AS8). The hook gets ids and the status only: the transcript is read from the stored message
        (R-AS20), so it never travels through here, and an error here logs the exception class name only."""
        get = self.deps.agents
        hook = getattr(get() if get is not None else None, "on_voice", None)
        if hook is None:
            return
        try:
            await hook(room_id, message_id, status)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # the transcription itself already succeeded or failed on its own
            logger.warning("room voice agent hook failed room=%s message=%s error=%s", room_id, message_id,
                           type(e).__name__)
```

模块文档串末尾补一句:「After every transcription the room's agents get `on_voice(room_id, message_id, status)` (addressing); they read the transcript from the stored message.」

`server/app/routers/rooms_voice.py`:导入加 `from app.rooms.rules import is_persona_id`(放在 `from app.rooms.protocol import MAX_ID, MAX_SEQ` 之后)。`install` 里 `VoiceDeps(...)` 末尾 `retry_limiter=...` 之后加一个参数:

```python
        retry_limiter=RateLimiter(limits.retry_per_minute, 60), agents=lambda: rt.agents))
```

(即把原来的最后一行 `retry_limiter=RateLimiter(limits.retry_per_minute, 60)))` 改成上面这行。)`upload_voice` 里 `wav = await file.read()` 之前加,并改 `service.upload` 调用:

```python
    raw_to = _form_text(form.get("to_agent"), name="to_agent")
    to_agent = None
    if raw_to is not None and raw_to.strip() not in ("", "null"):
        to_agent = raw_to.strip()
        if not is_persona_id(to_agent):  # shape only: membership of the room's agents is checked after transcription
            raise HTTPException(400, "Invalid to_agent")
    wav = await file.read()
    try:
        message = await service.upload(room, user.id, user.username, wav, client_id, reply_to, to_agent)
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_rooms_voice_service.py tests/test_rooms_voice_api.py tests/test_rooms_voice_store.py tests/test_architecture.py` → PASS

- [ ] **Step 5: 提交**

```bash
git add server/app/rooms/voice_store.py server/app/rooms/voice.py server/app/routers/rooms_voice.py \
  server/tests/test_rooms_voice_service.py server/tests/test_rooms_voice_api.py
git commit -m "feat(server): voice upload takes to_agent and tells the room agents when a transcription ends

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task V2: `AgentLane.on_voice`:语音目标、回复规则、带练语音作答(与 T5 合并后跑 `security-review`)

**Files:**
- Modify: `server/app/rooms/agent_lane.py`(文件末尾 `# ---- voice messages ----` 段)
- Test: `server/tests/test_rooms_addressing_voice.py`(新建)

**Interfaces:**
- Produces: `AgentLane.on_voice(room_id, message_id, status) -> None`;notice `voice_unclear`(字面量 `code="voice_unclear"` 必须出现在本文件:网页的契约测试 grep 它,Cross-plan S-3)
- Consumes: V1(钩子)、R1(`message_named`、`agent_of`)、R2(`_implicit`、`_personas`、`_admit`)、T5(`RoomTutor.waits_for` / `on_message`)
- 行为(R-AS2 / R-AS3 / R-AS7 / R-AS8 / R-AS15 / R-AS22):被隐藏、已结束的房间、不是语音的消息 → 什么都不做;带练正等这个发送者 → 转写文字当作回答,空 / 失败 → `voice_unclear` 给发送者、计时不重置、不扣题;带练进行中但不等他 → 不触发;否则按回复规则与上传的 `to_agent`(优先级同文字:回复 > `to`)路由,转写文字就是问题;`to_agent` 不属于本房配置 → `agent_off`;空 / 失败且本来要交给智能体 → `voice_unclear`;准入拒绝(`ai_off` / `ai_busy` / `ai_quota`)提示发给发送者的所有连接;语音不解析 `@`

- [ ] **Step 1: 写失败测试** — `server/tests/test_rooms_addressing_voice.py`:

```python
"""AgentLane.on_voice (plan addressing-server V2; spec addressing §3.2 #1–#3, §3.4; rulings R-AS2, R-AS3, R-AS7,
R-AS8, R-AS15, R-AS20, R-AS22)."""
import logging
from dataclasses import replace
from pathlib import Path

import pytest

from app.rooms import agent_lane
from app.routers import rooms as rooms_router
from tests.fixtures.audio import wav_bytes
from tests.test_rooms_agent_tutor import fire, snapshot, start, tenv, tutor_frames  # noqa: F401 (fixtures)
from tests.test_rooms_agents_api import AGENTS_ON, fake_run_turn, room_of
from tests.test_rooms_agents_lane import A, B, EMMA, LEO, NOW, env, say, types  # noqa: F401 (fixtures)
from tests.test_rooms_agents_ws import until_answer
from tests.test_rooms_ws import make_client, until

UNCLEAR = {"type": "notice", "code": "voice_unclear"}


async def clip(env, user_id, text, *, reply_to=None, to_agent=None):
    """A voice message as the voice service leaves it after a transcription: kind voice, the transcript in `text`
    (empty for empty / failed), the sender's target in the message's own meta (R-AS1)."""
    return await env.store.append(env.room.id, lane="public", sender_kind="user", sender_id=user_id, kind="voice",
                                  text=text, now=NOW, reply_to=reply_to,
                                  meta={"to_agent": to_agent} if to_agent else None)


def called(env):
    return [req.persona.id for _, req in env.script.calls]


async def test_a_clip_addressed_to_an_agent_is_answered_with_its_transcript_as_the_question(env):
    m = await clip(env, B, "what does abandon mean", to_agent=EMMA.id)
    await env.lane.on_voice(env.room.id, m.id, "done")
    await env.hub.drain()
    assert called(env) == [EMMA.id]
    _, req = env.script.calls[0]
    assert req.text == "bob: what does abandon mean" and req.user_id == B and req.in_room is True
    answer = next(e["message"] for e in env.alice.sender.sent if e["type"] == "message")
    assert (answer["kind"], answer["reply_to"]) == ("ai_answer", m.seq)
    assert answer["meta"]["agent"] == {"persona_id": EMMA.id, "name": "Emma"} and answer["meta"]["asker"]["id"] == B
    assert "agent_step" in types(env.bob) and "agent_step" not in types(env.alice)  # the process stays private
    row, _ = await env.store.message_named(m.id)
    assert row.ai_status == "done" and env.hub.ai_pending(env.room.id) == 0


async def test_a_voice_reply_to_an_agent_answer_needs_no_target_and_the_reply_beats_to_agent(env):
    await env.cb.handle(say("@Emma hi", "seed"))
    await env.hub.drain()
    seq = next(e["message"]["seq"] for e in env.alice.sender.sent if e["type"] == "message" and e["message"]["kind"] == "ai_answer")
    m = await clip(env, A, "and the past tense", reply_to=seq)
    await env.lane.on_voice(env.room.id, m.id, "done")
    n = await clip(env, A, "one more", reply_to=seq, to_agent=LEO.id)
    await env.lane.on_voice(env.room.id, n.id, "done")
    await env.hub.drain()
    assert called(env) == [EMMA.id, EMMA.id, EMMA.id]  # R-AS2: reply > to_agent


async def test_a_plain_clip_triggers_nothing_and_voice_never_parses_at(env):
    m = await clip(env, B, "@Emma what is a latte")  # spoken words are not a mention
    before = len(env.bob.sender.sent)
    await env.lane.on_voice(env.room.id, m.id, "done")
    await env.hub.drain()
    assert env.script.calls == [] and len(env.bob.sender.sent) == before and len(env.alice.sender.sent) == 0


async def test_a_target_outside_the_rooms_agents_gets_agent_off_for_the_sender_only(env):
    m = await clip(env, B, "hello", to_agent="builtin:partner")  # a valid shape, not one of this room's agents (R-AS7)
    await env.lane.on_voice(env.room.id, m.id, "done")
    assert env.bob.sender.sent[-1] == {"type": "notice", "code": "agent_off"}
    assert {"type": "notice", "code": "agent_off"} not in env.alice.sender.sent and env.script.calls == []
    env.lookup.by_id[LEO.id] = replace(LEO, disabled=True)
    n = await clip(env, B, "hello Leo", to_agent=LEO.id)
    await env.lane.on_voice(env.room.id, n.id, "done")
    assert env.bob.sender.sent[-1] == {"type": "notice", "code": "agent_off"}
    env.feature = False
    o = await clip(env, B, "hello Emma", to_agent=EMMA.id)
    await env.lane.on_voice(env.room.id, o.id, "done")
    assert env.bob.sender.sent[-1] == {"type": "notice", "code": "agent_off"} and env.script.calls == []


async def test_an_empty_or_failed_transcript_of_an_addressed_clip_says_voice_unclear(env):
    m = await clip(env, B, "", to_agent=EMMA.id)
    await env.lane.on_voice(env.room.id, m.id, "empty")
    await env.lane.on_voice(env.room.id, m.id, "failed")
    assert env.bob.sender.sent[-2:] == [UNCLEAR, UNCLEAR] and UNCLEAR not in env.alice.sender.sent
    assert env.script.calls == [] and env.refunds == [] and env.quota["room_ai_global"] == 99  # nothing was charged
    plain = await clip(env, B, "")
    before = len(env.bob.sender.sent)
    await env.lane.on_voice(env.room.id, plain.id, "empty")
    assert len(env.bob.sender.sent) == before  # nobody was addressed: no notice


async def test_room_gates_notify_the_sender_and_the_clip_stays_published(env):
    await env.store.set_ai_muted(env.room.id, True)
    m = await clip(env, B, "hello", to_agent=EMMA.id)
    await env.lane.on_voice(env.room.id, m.id, "done")
    assert env.bob.sender.sent[-1] == {"type": "notice", "code": "ai_off"}
    await env.store.set_ai_muted(env.room.id, False)
    for _ in range(env.store.limits.ai_queue):
        env.hub.ai_enter(env.room.id)
    await env.lane.on_voice(env.room.id, m.id, "done")
    assert env.bob.sender.sent[-1] == {"type": "notice", "code": "ai_busy"}
    for _ in range(env.store.limits.ai_queue):
        env.hub.ai_leave(env.room.id)
    env.quota["room_ai_global"] = 0
    await env.lane.on_voice(env.room.id, m.id, "done")
    assert env.bob.sender.sent[-1] == {"type": "notice", "code": "ai_quota"}
    row, _ = await env.store.message_named(m.id)
    assert row.text == "hello" and row.ai_status is None and env.script.calls == [] and env.hub.ai_pending(env.room.id) == 0


async def test_hidden_clips_other_kinds_and_unknown_ids_trigger_nothing(env):
    m = await clip(env, B, "secret words", to_agent=EMMA.id)
    await env.store.hide(env.room.id, m.id, NOW)
    await env.lane.on_voice(env.room.id, m.id, "done")
    text = await env.store.append(env.room.id, lane="public", sender_kind="user", sender_id=B, kind="text",
                                  text="typed", now=NOW, meta={"to_agent": EMMA.id})
    await env.lane.on_voice(env.room.id, text.id, "done")
    await env.lane.on_voice(env.room.id, "no-such-id", "done")
    await env.lane.on_voice("another-room", m.id, "done")
    await env.hub.drain()
    assert env.script.calls == [] and env.bob.sender.sent == []


async def test_a_running_tutor_closes_the_implicit_ways_for_voice_too(env):
    await env.store.set_tutor(env.room.id, {"phase": "await_answer", "persona_id": EMMA.id, "current_user_id": A})
    m = await clip(env, B, "tutor chat", to_agent=EMMA.id)  # not the called member, `to_agent` set: context only (R-AS3)
    await env.lane.on_voice(env.room.id, m.id, "done")
    await env.hub.drain()
    assert env.script.calls == [] and env.bob.sender.sent == []


async def test_the_called_members_transcribed_clip_is_the_tutor_answer_even_with_a_target(tenv):
    await start(tenv)
    m = await clip(tenv, A, "I went hiking last weekend.", to_agent=EMMA.id)
    await tenv.lane.on_voice(tenv.room.id, m.id, "done")
    await tenv.hub.drain()
    assert [req.mode for _, req in tenv.script.calls] == ["tutor", "tutor"]  # one turn: the tutor's, not a chat turn
    assert tenv.script.calls[1][1].text == "alice: I went hiking last weekend."
    assert tutor_frames(tenv.bob)[-1]["current_user_id"] == B


async def test_an_unclear_clip_of_the_called_member_keeps_the_question_and_the_timer(tenv):
    await start(tenv)
    task = tenv.tutor._timers[tenv.room.id]
    snap_before = await snapshot(tenv)
    m = await clip(tenv, A, "")
    await tenv.lane.on_voice(tenv.room.id, m.id, "empty")
    await tenv.lane.on_voice(tenv.room.id, m.id, "failed")
    assert tenv.alice.sender.sent[-2:] == [UNCLEAR, UNCLEAR] and UNCLEAR not in tenv.bob.sender.sent
    assert tenv.tutor._timers[tenv.room.id] is task and not task.done()  # R-AS8: the 60 s clock is not reset
    assert await snapshot(tenv) == snap_before and len(tenv.script.calls) == 1  # nothing was counted or skipped


async def test_a_clip_of_someone_who_is_not_called_on_never_advances_the_lesson(tenv):
    await start(tenv)
    m = await clip(tenv, B, "chipping in")
    await tenv.lane.on_voice(tenv.room.id, m.id, "done")
    await tenv.hub.drain()
    assert len(tenv.script.calls) == 1 and (await snapshot(tenv))["phase"] == "await_answer"
    assert UNCLEAR not in tenv.bob.sender.sent


async def test_a_late_transcript_after_the_sixty_second_skip_is_neither_counted_nor_announced(tenv):
    await start(tenv)
    m = await clip(tenv, A, "too late")
    await fire(tenv)  # the timer wins: alice was skipped, bob is asked
    calls, seen = len(tenv.script.calls), len(tenv.alice.sender.sent)
    await tenv.lane.on_voice(tenv.room.id, m.id, "done")
    await tenv.hub.drain()
    assert len(tenv.script.calls) == calls and UNCLEAR not in tenv.alice.sender.sent[seen:]


def test_the_notice_literal_the_web_greps_for_exists_in_the_lane():
    src = Path(agent_lane.__file__).read_text(encoding="utf-8")
    assert 'code="voice_unclear"' in src  # web room-agents-contract.test.ts (Cross-plan S-3)


async def test_voice_routing_logs_no_transcripts_names_or_ids(env, caplog):
    caplog.set_level(logging.DEBUG, logger="app")  # the app's own records; aiosqlite DEBUG logs SQL parameters
    m = await clip(env, B, "SECRET-VOICE-QUESTION-55", to_agent=EMMA.id)
    await env.lane.on_voice(env.room.id, m.id, "done")
    n = await clip(env, B, "", to_agent=LEO.id)
    await env.lane.on_voice(env.room.id, n.id, "failed")
    env.script.error = "llm_unavailable"
    o = await clip(env, B, "SECRET-VOICE-FAIL-56", to_agent=EMMA.id)
    await env.lane.on_voice(env.room.id, o.id, "done")
    await env.hub.drain()
    text = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("app"))
    for secret in ("SECRET-VOICE", "Emma", "Leo", "bob", EMMA.id, LEO.id):
        assert secret not in text
    assert "room agent turn failed code=upstream" in text


@pytest.fixture
def voice_agents(tmp_path, monkeypatch):
    """A real app with voice and agents on; a recording stand-in for the orchestrator and a fake transcriber."""
    seen: list[tuple[str, str]] = []

    async def recording_run_turn(deps, req):
        seen.append((req.text, req.persona.id))
        async for ev in fake_run_turn(deps, req):
            yield ev

    monkeypatch.setattr("app.routers.rooms_agents.run_turn", recording_run_turn)
    app, client = make_client(tmp_path, monkeypatch, rooms_voice_enabled=True, upstream_whisper_base_url="http://w",
                              upstream_whisper_mode="openai", data_dir=str(tmp_path / "data"), **AGENTS_ON)
    state = {"text": "What does abandon mean?"}

    async def transcribe(wav, sender_id):
        return state["text"]

    rooms_router.runtime(app).voice.deps.transcribe = transcribe
    yield app, client, seen, state
    client.__exit__(None, None, None)


def test_a_voice_message_addressed_to_an_agent_is_answered_after_transcription(voice_agents, caplog):
    app, client, seen, state = voice_agents
    caplog.set_level(logging.DEBUG, logger="app")
    room, alice, _, bob, _ = room_of(client)
    client.patch(f"/api/rooms/{room['id']}", json={"agents": ["builtin:coach"]}, headers=alice)
    ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=bob).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wb:
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        files = {"file": ("v.wav", wav_bytes(2.0), "audio/wav")}
        r = client.post(f"/api/rooms/{room['id']}/voice", files=files,
                        data={"client_id": "v1", "to_agent": "builtin:coach"}, headers=bob)
        assert r.status_code == 200 and r.json()["message"]["meta"] == {"to_agent": "builtin:coach"}
        answer = until_answer(wb)[-1]["message"]
    assert answer["meta"]["agent"]["persona_id"] == "builtin:coach" and answer["reply_to"] == r.json()["seq"]
    assert seen and seen[0][1] == "builtin:coach" and seen[0][0].endswith("What does abandon mean?")  # the transcript
    text = "\n".join(rec.getMessage() for rec in caplog.records if rec.name.startswith("app"))
    assert "abandon" not in text


def test_an_unaddressed_voice_message_is_not_answered_and_an_unclear_one_is_announced(voice_agents):
    app, client, seen, state = voice_agents
    room, alice, _, bob, _ = room_of(client)
    ticket = client.post(f"/api/rooms/{room['id']}/ticket", headers=bob).json()["ticket"]
    with client.websocket_connect(f"/api/rooms/ws?ticket={ticket}") as wb:
        wb.send_text('{"type":"hello","last_seq":0}')
        until(wb, "welcome")
        files = {"file": ("v.wav", wav_bytes(2.0), "audio/wav")}
        client.post(f"/api/rooms/{room['id']}/voice", files=files, data={"client_id": "v1"}, headers=bob)
        until(wb, "voice_update")
        state["text"] = "  "  # an empty transcript of a clip addressed to an agent
        client.post(f"/api/rooms/{room['id']}/voice", files=files,
                    data={"client_id": "v2", "to_agent": "builtin:coach"}, headers=bob)
        assert until(wb, "notice")[-1] == UNCLEAR  # the target is not (yet) one of the room's agents, but unclear wins
    assert seen == []
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rooms_addressing_voice.py` → FAIL(`AttributeError: 'AgentLane' object has no attribute 'on_voice'`)

- [ ] **Step 3: 实现** — `server/app/rooms/agent_lane.py` 文件末尾(`on_welcome` 之后)追加:

```python
    # ---- voice messages (addressing §3.2, §3.4; R-AS2, R-AS3, R-AS7, R-AS8, R-AS15, R-AS20, R-AS22) ----

    async def on_voice(self, room_id: str, message_id: str, status: str) -> None:
        """A voice message finished transcribing (`done` / `empty` / `failed`; `VoiceService` calls this after every
        attempt). The transcript is read from the stored row, never passed in (R-AS20), and never logged.
        - the room tutor waits for the sender: a transcript is the answer, an empty / failed one is `voice_unclear`
          (no credit used, the 60 s clock untouched);
        - a running tutor otherwise closes the implicit ways (R-AS3);
        - addressed to an agent (a reply to its answer, or the upload's `to_agent`): the transcript is the question;
          empty / failed -> `voice_unclear`; refusals follow `_admit`, notices go to the sender's connections.
        A hidden clip, a closed room or a row that is not a public voice message does nothing. Voice never parses
        `@`: spoken words are not a mention (R-AS2)."""
        r = self.rooms()
        found = await r.store.message_named(message_id)
        if found is None:
            return
        m, sender_name = found
        if (m.room_id != room_id or m.kind != "voice" or m.lane != "public" or m.sender_id is None
                or m.hidden_at is not None):
            return
        room = await r.store.room(room_id)
        if room is None or room.status != "open":
            return
        sender_id = m.sender_id
        text = (m.text or "").strip() if status == "done" else ""

        async def tell(frame: dict) -> None:
            await r.hub.broadcast(room_id, frame, only_user=sender_id)

        if self.tutor is not None and await self.tutor.waits_for(room_id, sender_id):
            if text:
                await self.tutor.on_message(room_id, m)  # False = the 60 s skip won the race: nothing to count or say
            else:
                await tell(event("notice", code="voice_unclear"))
            return
        cfg = agent_config.config_of(room)
        personas = await self._personas(cfg)
        meta = m.meta if isinstance(m.meta, dict) else {}
        to = meta.get("to_agent")
        target = await self._implicit(room, personas, m.reply_to, to if isinstance(to, str) else None)
        if target is None:
            return
        if not text:
            await tell(event("notice", code="voice_unclear"))
            return
        route = await self._admit(tell, target, room_id=room_id, asker_id=sender_id, asker_name=sender_name or "",
                                  personas=personas, question=text)
        if route is None:
            return
        try:
            await r.store.set_ai_status(m.id, "pending")
        except BaseException:
            await self.release(route)
            raise
        r.hub.spawn(self.answer(route, m.seq, m.id))
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_rooms_addressing_voice.py tests/test_rooms_addressing_routing.py tests/test_rooms_agent_tutor.py tests/test_rooms_voice_service.py tests/test_rooms_voice_api.py tests/test_rooms_agents_lane.py tests/test_architecture.py` → PASS

- [ ] **Step 5: 提交**

```bash
git add server/app/rooms/agent_lane.py server/tests/test_rooms_addressing_voice.py
git commit -m "feat(server): answer voice messages addressed to an agent, and tutor answers, after transcription

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: 评审** — V2 与 T5 都合并后,对 `server/app/rooms/agent_lane.py`、`agent_tutor.py`、`voice.py`、`routers/rooms_voice.py` 跑一次 `security-review`:目标越权(`to_agent` 只能指向本房配置里的角色、回复规则只认当前配置)、转写泄漏(日志、错误、`ai_failed`、异常消息)、带练竞争(转写 / 60 秒自动跳过 / 重复转写)、语音钩子在隐藏 / 关闭房间后的行为。

## Lane A · 删除旧公共回答通道(`rooms.answer`)

### Task A1: 删除 `rooms.answer` 模板、旧 `@ai` 提示词代码与它的测试 / 夹具

**Files:**
- Modify: `server/app/rooms/assistant.py`、`server/app/services/prompts.py`、`server/app/admin/prompts_admin.py`、`server/app/routers/rooms.py`
- Test: `server/tests/test_rooms_assistant.py`、`test_rooms_prompts_v2.py`、`test_prompts.py`、`test_prompts_api.py`(改写 + 追加)
- Rewrite: `server/tests/fixtures/rooms_prompts_legacy.json`(每项删 `answer` 键)

**Interfaces:**
- Produces: `assistant` 里不再有 `ANSWER_MAX_TOKENS` / `ANSWER_TEMPERATURE` / `ANSWER_CONTEXT` / `MAX_ANSWER_CHARS` / `ANSWER_SYSTEM` / `V1_ANSWER_TEMPLATE` / `DEFAULT_ANSWER_TEMPLATE` / `answer_messages` / `clean_answer`,`_FIELDS` 与 `_DEFAULTS` 只剩 `rooms.assist`、`rooms.voice_translate`、`rooms.summary`;`PROMPTS` 没有 `rooms.answer`(管理端列表不再显示,`GET /api/admin/prompts/rooms.answer` 与它的草稿 / 发布端点都是 404);`ConnDeps.templates` 的键少一个
- 保留(R-AS6):`store.AI_NAME`(历史回复仍叫「AI 助手」)、`prompt_versions` 表里 `key="rooms.answer"` 的历史行(不删表、不删行、不迁移)、`ROOMS_AI_*` 设置与 `room_ai_global` 计数(智能体回合与私聊助手共用)、私聊写作助手(`rooms.assist`、`on_assist`、助手面板)
- 没有死设置:`ROOMS_AI_MODEL` 仍被助手与语音翻译用,`ROOMS_AI_CONCURRENCY` 是智能体回合也在用的 `ai_gate`,`ROOMS_AI_PER_ROOM_HOUR` / `ROOMS_AI_GLOBAL_DAILY` 在 `AgentLane._reserve`;本任务不改 `core/config.py`

- [ ] **Step 1: 改测试**

`server/tests/test_rooms_assistant.py`:删掉 `test_answer_messages_and_clean`;`test_default_templates_reproduce_legacy_prompts`、`test_default_templates_pass_prompt_validation`、`test_user_marker_splits_system_and_user_and_braces_in_learner_text_stay_literal`、`test_marker_inside_learner_text_does_not_move_the_split` 四个整体替换为:

```python
def test_default_templates_reproduce_legacy_prompts():
    legacy = json.loads((Path(__file__).parent / "fixtures" / "rooms_prompts_legacy.json").read_text(encoding="utf-8"))
    for item in legacy:
        c = item["case"]
        recent = [tuple(x) for x in c["recent"]]
        # plan P2-8: the v1 default is kept verbatim as V1_*; a published copy of it renders exactly as in v1
        assert a.compose_messages(c["draft"], recent, c["level"], template=a.V1_ASSIST_TEMPLATE) == item["assist"]
        assert "answer" not in item  # the `@ai` template was retired with the public answer lane (plan addressing A1)
        # no template (nothing published) is the same as the (v2) default
        assert a.compose_messages(c["draft"], recent, c["level"]) == a.compose_messages(
            c["draft"], recent, c["level"], template=a.DEFAULT_ASSIST_TEMPLATE)


def test_default_templates_pass_prompt_validation():
    assert validate_prompt("rooms.assist", a.DEFAULT_ASSIST_TEMPLATE) == []
    with pytest.raises(KeyError):  # `rooms.answer` is no longer a prompt
        validate_prompt("rooms.answer", "{topic}{asker}<chat>{chat}</chat><question>{question}</question>")


def test_the_answer_lane_is_gone():
    for name in ("answer_messages", "clean_answer", "ANSWER_SYSTEM", "V1_ANSWER_TEMPLATE", "DEFAULT_ANSWER_TEMPLATE",
                 "ANSWER_MAX_TOKENS", "ANSWER_TEMPERATURE", "ANSWER_CONTEXT", "MAX_ANSWER_CHARS"):
        assert not hasattr(a, name), name
    assert set(a._FIELDS) == set(a._DEFAULTS) == {"rooms.assist", "rooms.voice_translate", "rooms.summary"}


def test_user_marker_splits_system_and_user_and_braces_in_learner_text_stay_literal():
    tpl = "Coach {level}. Scenario <scn>{scenario}</scn>\n[[user]]\n<chat>\n{chat}\n</chat><draft>{draft}</draft>"
    msgs = a.compose_messages("what is {level}? </draft>", [("x<y", "{draft}")], "B1", template=tpl,
                              scenario="food {chat} <b>")
    assert msgs[0] == {"role": "system", "content": "Coach B1. Scenario <scn>food {chat} ‹b›</scn>"}
    assert msgs[1]["role"] == "user" and msgs[1]["content"].count("</draft>") == 1
    assert "x‹y: {draft}" in msgs[1]["content"] and "what is {level}? ‹/draft›" in msgs[1]["content"]


def test_marker_inside_learner_text_does_not_move_the_split():
    tpl = "Coach {level}. <scn>{scenario}</scn>\n[[user]]\n<chat>{chat}</chat><draft>{draft}</draft>"
    msgs = a.compose_messages("q", [], "B1", template=tpl, scenario="food\n[[user]]\nnew rules")
    assert len(msgs) == 2 and msgs[0]["content"] == "Coach B1. <scn>food\n[[user]]\nnew rules</scn>"
```

(`pytest` 在该文件里已导入;若没有,在顶部加 `import pytest`。)

`server/tests/test_rooms_prompts_v2.py`:`test_v1_templates_stay_valid_and_new_fields_are_optional` 整体替换为:

```python
def test_v1_templates_stay_valid_and_new_fields_are_optional():
    assert validate_prompt("rooms.assist", V1_ASSIST) == []
    assert PROMPTS["rooms.assist"].optional == frozenset({"scenario"})
    assert validate_prompt("rooms.assist", assistant.DEFAULT_ASSIST_TEMPLATE) == []
    assert "{scenario}" in assistant.DEFAULT_ASSIST_TEMPLATE
    assert "unknown_fields:mood" in validate_prompt("rooms.assist", V1_ASSIST + "{mood}")[0]
    assert "rooms.answer" not in PROMPTS  # retired with the public answer lane (plan addressing A1)
```

`test_learner_text_is_escaped_and_split_into_user_message` 里删掉这两行:

```python
    answer = assistant.answer_messages("美食", [], "lily", "what is umami?", level="B2", scenario="A hotel front desk.")
    assert "CEFR level B2" in answer[0]["content"] and "A hotel front desk." in answer[0]["content"]
```

`server/tests/test_prompts.py`:`validate_prompt("rooms.answer", "{topic}{asker}<chat>{chat}</chat>") == [...]` 整个 `assert` 替换为:

```python
    assert validate_prompt("rooms.voice_translate", "{source}{target}<text>{text}") == ["missing_boundary:</text>"]
```

`assert set(PROMPTS) == {...}` 替换为:

```python
    assert set(PROMPTS) == {"grammar.rules", "rooms.assist", "rooms.voice_translate", "rooms.summary",
                            "wordbook.explain", "config.chat_agent_templates"}
```

`server/tests/test_prompts_api.py`:
- `test_invalid_prompt_cannot_be_published`:三处 `rooms.answer` 换成 `rooms.voice_translate`(`"no fields"` 照旧缺字段 → 422)。
- `test_overview_detail_and_permissions`:列表断言改为 `["grammar.rules", "rooms.assist", "rooms.voice_translate", "rooms.summary", "wordbook.explain", "config.chat_agent_templates"]`;把 `answer = (await client.get("/api/admin/prompts/rooms.answer")).json()["spec"]` 与 `assert answer["optional"] == ["level", "scenario"] and "scenario" in answer["sample_fields"]` 两行换成:

```python
    assist = (await client.get("/api/admin/prompts/rooms.assist")).json()["spec"]
    assert assist["optional"] == ["scenario"] and "scenario" in assist["sample_fields"]
```

- `test_published_prompt_rows_are_immutable_versions` 与 `test_prompt_publish_is_bound_to_the_reviewed_draft`:`base = "/api/admin/prompts/rooms.answer"` 换成 `".../rooms.voice_translate"`,`good = "Topic {topic} by {asker}. <chat>{chat}</chat> <question>{question}</question>"` 换成 `good = "Translate {source} to {target}. <text>{text}</text>"`,`next(i for i in items if i["key"] == "rooms.answer")` 换成 `"rooms.voice_translate"`。
- 文件末尾追加(历史行保留、端点 404):

```python
async def test_the_retired_rooms_answer_prompt_is_gone_but_its_history_stays(app, client):
    su = await superadmin(app, client)
    async with app.state.sessionmaker() as s:
        s.add(PromptVersion(key="rooms.answer", version=1, status="published", body="old {topic}", note="",
                            created_by="root", published_by="root", published_at=utcnow()))
        await s.commit()
    assert "rooms.answer" not in [i["key"] for i in (await client.get("/api/admin/prompts")).json()]
    assert (await client.get("/api/admin/prompts/rooms.answer")).status_code == 404
    assert (await client.post("/api/admin/prompts/rooms.answer/draft", headers=su, json={})).status_code == 404
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(PromptVersion).where(PromptVersion.key == "rooms.answer"))).all()
    assert [(r.version, r.status, r.body) for r in rows] == [(1, "published", "old {topic}")]  # nothing is deleted
```

(`PromptVersion`、`select`、`utcnow` 在该文件里按现有导入使用;`utcnow` 若未导入,加 `from app.models import PromptVersion, utcnow`。)

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rooms_assistant.py tests/test_rooms_prompts_v2.py tests/test_prompts.py tests/test_prompts_api.py` → FAIL(`rooms.answer` 还在 `PROMPTS`;`test_the_answer_lane_is_gone` 失败)

- [ ] **Step 3: 实现**

`server/app/rooms/assistant.py`:
1. 模块文档串换为:`"""Room assistant (private compose lane), voice-translate and summary prompts and parsing (spec 2026-10-09 §9). Pure (templates come from the caller; admin v2 G2). The public `@ai` answer prompt was retired in plan 2026-10-12-agents-addressing-server A1: `@ai` is the room's default agent now."""`
2. 删除 `ANSWER_MAX_TOKENS = 300`、`ANSWER_TEMPERATURE = 0.5`、`ANSWER_CONTEXT = 20`、`MAX_ANSWER_CHARS = 1200` 四行。
3. 删除整个 `ANSWER_SYSTEM = (...)`。
4. G2 注释与默认模板段落(`# Admin v2 G2: ...` 到 `DEFAULT_ANSWER_TEMPLATE = ...` 结束)替换为:

```python
# Admin v2 G2: the prompts are versioned templates (admin「提示词」rooms.assist / rooms.voice_translate / rooms.summary).
# A line that is exactly USER_MARKER splits the rendered template into the system message (before) and the user
# message (after); without it the whole template is the system message (as in the admin test run). Learner text is
# escaped before `str.format`, so it can neither close a boundary tag nor add placeholders (format never re-reads values).
USER_MARKER = "[[user]]"
_SPLIT = f"\n{USER_MARKER}\n"

# v1 built-in default, kept verbatim (plan P2-8): a copy an admin published from it stays valid and renders exactly as
# in v1 (tests/test_rooms_assistant.py pins it against fixtures/rooms_prompts_legacy.json).
V1_ASSIST_TEMPLATE = COMPOSE_SYSTEM + _SPLIT + "<chat>\n{chat}\n</chat>\n<draft>{draft}</draft>"
# Rooms v2 default (spec 2026-10-10 §10): the room scenario brief as an optional field.
DEFAULT_ASSIST_TEMPLATE = V1_ASSIST_TEMPLATE.replace(
    "Recent public messages are inside <chat> tags",
    "The chat scenario (context only): {scenario}\nRecent public messages are inside <chat> tags", 1)
```

5. `_FIELDS` / `_DEFAULTS` 替换为:

```python
_FIELDS = {"rooms.assist": ("level", "scenario", "chat", "draft"),
           "rooms.voice_translate": ("source", "target", "text"),
           "rooms.summary": ("level", "scenario", "members", "chat")}
_DEFAULTS = {"rooms.assist": DEFAULT_ASSIST_TEMPLATE, "rooms.voice_translate": DEFAULT_TRANSLATE_TEMPLATE,
             "rooms.summary": DEFAULT_SUMMARY_TEMPLATE}
```

(`DEFAULT_TRANSLATE_TEMPLATE`、`DEFAULT_SUMMARY_TEMPLATE` 在原文件里定义在 `_FIELDS` 之前,位置不变。)
6. 删除 `answer_messages` 与 `clean_answer` 两个函数。

`server/app/services/prompts.py`:删掉 `PROMPTS` 里整个 `"rooms.answer": PromptSpec(...)` 条目(5 行)。

`server/app/admin/prompts_admin.py`:删掉 `default_body` 里

```python
    if key == "rooms.answer":
        return assistant.DEFAULT_ANSWER_TEMPLATE
```

`server/app/routers/rooms.py`:`templates()` 里的元组改为 `("rooms.assist", "rooms.voice_translate", "rooms.summary")`。

- [ ] **Step 4: 重写旧提示词夹具** — 在 `server/` 下运行(一次性,不进仓库):

```bash
uv run python - <<'EOF'
import json, pathlib
p = pathlib.Path("tests/fixtures/rooms_prompts_legacy.json")
items = json.loads(p.read_text(encoding="utf-8"))
for item in items:
    item.pop("answer", None)
p.write_text(json.dumps(items, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
EOF
git diff --stat tests/fixtures/rooms_prompts_legacy.json
```

`git diff` 应当只有删除行(每个用例的 `"answer": [...]`)。若出现多余的缩进 / 行尾差异,按原文件风格调整,不要改 `case` 与 `assist`。

- [ ] **Step 5: 跑测试 + 核对没有遗漏** — Run: `cd server && uv run pytest -q tests/test_rooms_assistant.py tests/test_rooms_prompts_v2.py tests/test_prompts.py tests/test_prompts_api.py tests/test_rooms_prompts_live.py tests/test_rooms_prompts_ctx.py tests/test_rooms_connection.py tests/test_architecture.py` → PASS。`grep -rn "rooms.answer\|answer_messages\|clean_answer\|DEFAULT_ANSWER\|V1_ANSWER\|ANSWER_SYSTEM" server/app admin/src` 应只剩 `admin/src/features/prompts/prompt-editor-page.test.tsx`(M1 处理);`server/tests` 里只剩「已退役」断言(`test_prompts.py` / `test_prompts_api.py` / `test_rooms_assistant.py` / `test_rooms_prompts_v2.py`)。

- [ ] **Step 6: 提交**

```bash
git add server/app/rooms/assistant.py server/app/services/prompts.py server/app/admin/prompts_admin.py server/app/routers/rooms.py \
  server/tests/test_rooms_assistant.py server/tests/test_rooms_prompts_v2.py server/tests/test_prompts.py server/tests/test_prompts_api.py \
  server/tests/fixtures/rooms_prompts_legacy.json
git commit -m "refactor(server): remove the rooms.answer template and the old public answer prompts (@ai is the default agent)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

## Lane M · 管理端网页

### Task M1: 提示词编辑页清理 `rooms.answer` 的样例标签,测试改用 `rooms.assist`

**Files:**
- Modify: `admin/src/features/prompts/strings.ts`、`admin/src/features/prompts/test-run-panel.tsx`、`admin/src/features/prompts/prompt-editor-page.test.tsx`

**Interfaces:**
- Produces: `S.sampleLabels` 只含 `text`、`context`、`level`、`chat`、`draft`(`topic` / `asker` / `question` 只属于已退役的 `rooms.answer`);`MULTILINE` 不含 `question`;列表页与编辑页不需要改(都由服务端 `GET /api/admin/prompts` 驱动,A1 之后列表里自然没有 `rooms.answer`)

- [ ] **Step 1: 改测试** — `admin/src/features/prompts/prompt-editor-page.test.tsx`:顶部导入加 `import { S } from "./strings";`;`beforeEach` 里的 `getPrompt` 模拟、`renderAt` 的默认键、`VALID` 与前六个用例整体替换为:

```tsx
beforeEach(() => {
  vi.mocked(api.getPrompt).mockResolvedValue({
    spec: { key: "rooms.assist", label: "联机助手组句", kind: "text", required: ["level", "chat", "draft"],
            boundaries: ["<chat>", "</chat>", "<draft>", "</draft>"], maxChars: 8000 },
    published: null, versions: [], defaultBody: "Level {level}. <chat>{chat}</chat> <draft>{draft}</draft>",
    draft: { body: "Level {level}. <chat>{chat}</chat>", note: "", updatedBy: "ops", updatedAt: "2026-10-09T08:00:00Z", etag: "p0" },
  });
  asRole("operator");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(api.getPrompt).mockReset();
});

const renderAt = (key = "rooms.assist") =>
  render(<MemoryRouter initialEntries={[`/prompts/${key}`]}><Routes><Route path="/prompts/:key" element={<PromptEditorPage />} /></Routes></MemoryRouter>);

const VALID = "Level {level}. <chat>{chat}</chat> <draft>{draft}</draft>";

it("lists missing placeholders and boundaries and blocks saving", async () => {
  renderAt();
  expect(await screen.findByText("缺少占位符:{draft}")).toBeInTheDocument();
  expect(screen.getByText("缺少边界标签:<draft>、</draft>")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
});

it("hides publish and test-run from operators", async () => {
  renderAt();
  await screen.findByText(/缺少占位符/);
  expect(screen.queryByRole("button", { name: "发布" })).toBeNull();
  expect(screen.queryByRole("button", { name: /运行/ })).toBeNull();
});

it("updates checks live while typing", async () => {
  renderAt();
  const editor = await screen.findByLabelText("提示词正文");
  await userEvent.clear(editor);
  // user-event v14: "{{" types a literal "{"; "}" is already literal (the plan wrote "}}", which types two)
  await userEvent.type(editor, "Level {{level}. <chat>{{chat}</chat> <draft>{{draft}</draft>");
  expect(screen.queryByText(/缺少占位符/)).toBeNull();
  expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
});

it("saves the draft with the note", async () => {
  vi.mocked(api.savePromptDraft).mockResolvedValue({ body: VALID, note: "n", updatedBy: "ops", updatedAt: "2026-10-09T09:00:00Z", etag: "p1" });
  renderAt();
  const editor = await screen.findByLabelText("提示词正文");
  await userEvent.clear(editor);
  await userEvent.type(editor, VALID.replace(/[{]/g, "{{"));
  await userEvent.type(screen.getByLabelText("草稿说明"), "n");
  await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  expect(api.savePromptDraft).toHaveBeenCalledWith("rooms.assist", VALID, "n");
});

it("has no sample labels left for the retired @ai answer prompt", () => {
  for (const retired of ["topic", "asker", "question"]) expect(S.sampleLabels).not.toHaveProperty(retired);
  expect(Object.keys(S.sampleLabels).sort()).toEqual(["chat", "context", "draft", "level", "text"]);
});
```

「lets a superadmin publish…」用例里的 `getPrompt` 模拟、试运行与发布断言改为:

```tsx
  vi.mocked(api.getPrompt).mockResolvedValue({
    spec: { key: "rooms.assist", label: "联机助手组句", kind: "text", required: ["level", "chat", "draft"],
            boundaries: ["<chat>", "</chat>", "<draft>", "</draft>"], maxChars: 8000,
            sampleFields: ["level", "scenario", "chat", "draft"] },
    published: { version: 2, body: "old line\nshared" },
    versions: [
      { version: 2, status: "published", note: "", createdBy: "a", createdAt: "2026-10-01T00:00:00Z", publishedBy: "root", publishedAt: "2026-10-01T00:00:00Z" },
      { version: 1, status: "archived", note: "", createdBy: "a", createdAt: "2026-09-01T00:00:00Z", publishedBy: "root", publishedAt: "2026-09-01T00:00:00Z" },
    ],
    defaultBody: null,
    draft: { body: VALID, note: "", updatedBy: "ops", updatedAt: "2026-10-09T08:00:00Z", etag: "p-reviewed" },
  });
```

```tsx
  await userEvent.type(screen.getByLabelText("学习者草稿"), "what is up");
  await userEvent.click(screen.getByRole("button", { name: "运行(会产生少量费用)" }));
  expect(api.testPrompt).toHaveBeenCalledWith("rooms.assist", VALID, { level: "", scenario: "", chat: "", draft: "what is up" });
```

```tsx
  expect(api.publishPrompt).toHaveBeenCalledWith("rooms.assist", "上线新版本", "p-reviewed"); // review M4
```

(用例里 `await screen.findByText("检查通过")`、版本列表、对比、发布对话框的其余行不变。)

- [ ] **Step 2: 跑测试确认失败** — Run: `cd admin && yarn vitest run src/features/prompts` → 只有 `has no sample labels left for the retired @ai answer prompt` FAIL(`topic` 等还在)

- [ ] **Step 3: 实现** — `admin/src/features/prompts/strings.ts` 的 `sampleLabels` 替换为:

```ts
  sampleLabels: {
    text: "学习者原文",
    context: "对方上一句(可空)",
    level: "等级(如 B1)",
    chat: "最近聊天(每行 名字: 内容)",
    draft: "学习者草稿",
  } as Record<string, string>,
```

`admin/src/features/prompts/test-run-panel.tsx`:`const MULTILINE = new Set(["chat", "draft", "question", "text"]);` 改为 `const MULTILINE = new Set(["chat", "draft", "text"]);`。

- [ ] **Step 4: 跑测试确认通过** — Run: `cd admin && yarn vitest run src/features/prompts && yarn tsc --noEmit`(命令以 `admin/package.json` 为准)→ PASS

- [ ] **Step 5: 提交**

```bash
git add admin/src/features/prompts/strings.ts admin/src/features/prompts/test-run-panel.tsx admin/src/features/prompts/prompt-editor-page.test.tsx
git commit -m "chore(admin): drop the retired rooms.answer sample labels; prompt editor tests use rooms.assist

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

## Final lane (Z)

### Task Z1: 文档(各层 `CLAUDE.md`、README 的诚实说明)

**Files:**
- Modify: `server/app/agents/CLAUDE.md`、`server/app/agents/tutor/CLAUDE.md`、`server/app/rooms/CLAUDE.md`、`server/app/routers/CLAUDE.md`、`server/tests/CLAUDE.md`、`server/README.md`
- 不改:`web/` 下的 `CLAUDE.md` 与 `web/README.md`(网页计划 Z1 负责)、`docs/CLAUDE.md`、`docs/superpowers/specs/`(spec 不改)

- [ ] **Step 1: `server/app/agents/CLAUDE.md`** — 「What lives here」里:
  - `trace.py` 一条末尾加:「;`Done.note_zh`(可选键:不进公开文本的中文说明,≤ 80 字)、`compact_trace(note_zh=)`」。
  - `settings.py` 一条末尾加:「;`zh_note`(`auto` | `always` | `never`,默认 `auto`)」。
  - `personas.py` 一条末尾加:「;内置角色人设末尾带 `Reply in English only.`」。
  - 在 `prompt.py` 一条之前加:

```markdown
- `lang.py` – 回复语言(纯函数,只用标准库;计划 `2026-10-12-agents-addressing-server` L1):`want_note(setting, level)`、`chat_rule`、`MarkerFilter`(`<<ZH>>` 行边流边剥,标记可被拆开)、`SentenceGate`(中文句兜底:英文立即放行,含中文的句子从第一个中文字符起暂扣并拿掉)、`Chain`(模式 `<<META>>` → `<<ZH>>` → 兜底)、`clean_note` / `resolve_note`(`note_zh` 来源优先级:模式 META → `<<ZH>>` 行 → 被拿掉的中文;≤ 80 字;`never` = 全部丢弃)
```

  「Pitfalls」末尾加:

```markdown
- 回复语言(spec addressing §5):公开文本只含英文;中文说明只进 `note_zh`(SSE `done.note_zh`、`done.trace.note_zh`、联机公开消息 `meta.note_zh`),永远不进公开文本、不进 `Meta` 事件、不进日志、不进朗读。改 `lang.py` 先跑 `tests/test_agents_lang.py` 的拆分模糊测试(任意拆分下流式输出 == 一次性输入的输出,不要改断言)。导师纯模块不导入 `lang`:`zh_note` 由 `tutor/handler.py` / `rooms/agent_tutor.py` 按「用户设置 × 状态机当前水平」算好以布尔值传入。聊天模式的语言说明由编排器放在模式块之后(`prompt.turn_message(lang_block=)`),人设里的中文只当数据。
```

- [ ] **Step 2: `server/app/agents/tutor/CLAUDE.md`** — 「What lives here」里在下列各条**末尾追加**(原文不动):
  - `parse.py` 一条:「;`Meta` 多出可选 `note_zh` / `hint_zh`(≤ 80 字中文,缺失 / 非法 → 空串;`StreamFilter` 不变,它们在 `<<META>>` 之后本来就不放行)」。
  - `machine.py` 一条:「;`TutorState.hint_zh` 与 `Asked` / `Answered` 的 `hint_zh`(旧快照缺键 = 空串)」。
  - `prompt.py` 一条:「;回复只用英文:`format_rules(zh_note)` / `tutor_block(..., zh_note=False)`,只有 `zh_note` 为真才要求 META 里的 `hint_zh` / `note_zh`」。
  - `service.py` 一条:「;`hint_text(state) -> (英文, 中文)`、`hint(...) -> (row, 英文, 中文)`、`FALLBACK_HINT_EN`」。
  - `handler.py` 一条:「;`prepare` 用 `lang.want_note(req.agent_settings.zh_note, machine.LEVELS[state.level])`,`finish` 返回的字典可带 `note_zh`(编排器在 `Meta` 之前取走)」。

  「Pitfalls」末尾加:「联机带练(`rooms/agent_tutor.py`)复用同一套纯模块;`hint_zh` 只随 `agent_tutor` 帧(`await_answer` 阶段、有值才有)与 1:1 提示端点下发,`zh_note=never` 的用户拿不到;带练的中文说明与提示永远不进公开文本。五个纯模块不导入 `app.agents.lang`:`zh_note` 由调用方算好以布尔值传入。」

- [ ] **Step 3: `server/app/rooms/CLAUDE.md`** —
  - 第 4 行 `public `@ai` answers.` 改为 `agent answers (`@ai` = the room's default agent).`;
  - 「What lives here」里 `rules.py` 一条末尾加 `; `is_persona_id` (persona id shape)`;
  - `assistant.py` 那一条(含 `DEFAULT_ANSWER_TEMPLATE`、`rooms.answer` 的四行)整体替换为:

```markdown
- `assistant.py` – assistant/summary/voice-translate prompts and parsing (pure). Prompts are templates (`DEFAULT_ASSIST_TEMPLATE`,
  rendering exactly the M4 messages — pinned by `tests/fixtures/rooms_prompts_legacy.json`); a published admin version
  (`rooms.assist` / `rooms.voice_translate` / `rooms.summary`, via `ConnDeps.templates`) replaces them; a `[[user]]` line splits
  system/user message; invalid templates fall back to the default; learner text is escaped before `str.format`. There is
  no `@ai` answer template any more: `@ai` is the room's default agent (`agent_lane.py`).
```

  - 第 85 行附近 `rooms.ai_muted` makes `@ai` and the assistant answer `notice ai_off` 改为 `rooms.ai_muted` makes agent turns (incl. `@ai`) and the assistant answer `notice ai_off`;
  - 「Pitfalls」末尾加:

```markdown
- Addressing (plan 2026-10-12-agents-addressing-server; `AgentLane.route` / `on_voice`): the order is `@ai` (the room's FIRST resolvable agent, else `builtin:coach`; a disabled first agent = `agent_off`, no fall-through) > `@name` > the reply rule (`RoomStore.agent_of` on `reply_to`; only agents still in the room's config; silent when refused) > `say.to` / voice `to_agent` (must be one of the room's agents, else `agent_off`). At most one turn per message. A running room tutor (`rooms.agent_tutor` set) closes the implicit ways (reply, `to`) so the called member's answer never also starts a chat turn; explicit `@name` / `@ai` still work.
- `@ai` has no code path of its own: with agents off it gives `notice agent_off` and stays a plain message (the feature check runs before `ai_muted` -> `ai_off`). A message is always published; a refused turn only withholds the answer and sends `agent_off` / `ai_off` / `ai_busy` / `ai_quota` to the sender. The old public answer lane (`RoomConnection._answer`, `rooms.answer`) is gone; `prompt_versions` rows of that key stay.
- Voice: `VoiceService` calls `AgentLane.on_voice(room_id, message_id, status)` after EVERY transcription (done / empty / failed, retries included); the transcript is read from `room_messages.text`, never passed around or logged. The sender's `to_agent` lives in the voice message's own `meta` (no migration); the upload checks only its shape, membership of the room's agents is checked after transcription. An empty / failed transcript of an addressed clip or of a tutor answer sends `notice voice_unclear` to the sender's connections only; the 60 s tutor timer is never reset by uploads (`RoomTutor._advance` decides the race, only clips after the question count).
- Public agent replies may carry `meta.note_zh` (<= 80 chars of Chinese, never part of the text, never read aloud); public messages may carry `meta.to_agent` (a persona id). The room tutor frame's only hint key is the optional `hint_zh`. Web's contract tests pin the key sets of `GET /api/rooms/{id}/agents` and of the tutor frame: add optional keys only together with the web plan.
```

- [ ] **Step 4: `server/app/routers/CLAUDE.md`** — Pitfalls 里 `rooms.deps_for` 那一条中的 `rooms.assist` / `rooms.answer` templates 改为 `rooms.assist` / `rooms.voice_translate` / `rooms.summary` templates;同一节末尾加一条:「`rooms_voice.upload_voice` reads the optional form field `to_agent` (shape check only, 400 `Invalid to_agent`) and `install` gives `VoiceDeps.agents = lambda: rt.agents` (read per call: `rooms_agents.install` runs after it).」

- [ ] **Step 5: `server/tests/CLAUDE.md`** — 「What lives here」的 `fixtures/` 一条里 `rooms_contract.json` 后加「(recorded with agents on and a scripted `run_turn`, so `@ai` replies carry `meta.agent`)」;`test_web_contract.py` 一条末尾加「`@ai` needs agents on: `test_rooms_agents_api.agents_client` / `AGENTS_ON` + `fake_run_turn`; with agents off `@ai` is `notice agent_off`」;「Conventions」末尾加:

```markdown
- Room addressing tests (`test_rooms_addressing_{protocol,store,routing,voice}.py`) build on `test_rooms_agents_lane.Env` (scripted `run_turn`, `Script.note` for `note_zh`); the voice ones add `test_rooms_agent_tutor.tenv` (injected `Clockwork` sleep, never a real 60 s) and a real-app fixture with a fake transcriber. Privacy assertions use `caplog.set_level(logging.DEBUG, logger="app")` and only look at records whose `name` starts with `app`.
```

- [ ] **Step 6: `server/README.md`** —
  - 接口表第 27 行:`房间实时消息、@ai、私聊助手(票据一次性,默认关)` 改为 `房间实时消息、@ai(= 房间默认智能体)与免 @ 对话、私聊助手(票据一次性,默认关)`;
  - 第 77 行:`房间助手组句、`@ai` 回答、对话情景模板可版本化发布` 改为 `房间助手组句、语音翻译、学习小结、对话情景模板可版本化发布`,句末括号后补一句「`@ai` 不再有独立模板:它是房间的默认智能体;旧 `rooms.answer` 的历史版本仍保留在库里,管理端不再显示。」;
  - 第 349 行:`` `@ai` 与私聊助手合计`` 改为 ``智能体回合(含 `@ai`)与私聊助手合计``,并删掉句中 `` `@ai` 约 1–1.5k 输入 + ≤300 输出(估算)``(旧公共回答的估算不再适用);
  - 在 `## 联机练习 v2(计划 2026-10-10)` 小节之后、`## 背单词` 之前新增:

```markdown
## 智能体寻址(计划 2026-10-12)

- **免 @ 对话**:回复智能体的消息自动交给那个智能体;`say.to` / 语音上传的 `to_agent` 把这条消息交给房间配置里的某个智能体;`@ai` / `@AI` / `@助手` = 房间配置的第一个智能体(没有配置 = 内置英语教练);一条消息至多一个回合,优先级 `@ai` > `@名字` > 回复 > `to`。带练进行中不走隐式路由(被点名成员的文字与转写后的语音照旧当作回答)。
- **成本与降级**:每个被路由的消息是一个智能体回合,沿用 `ROOMS_AI_*`(每房每小时、全站每天)、`AGENTS_TURNS_*`、一房间同时只有一个 AI 发言者与队列上限;被拒时消息照常发布,只给提问者 `agent_off` / `ai_off` / `ai_busy` / `ai_quota`。`AGENTS_ENABLED` 或 `AGENTS_ROOMS_ENABLED` 关闭时 `@ai` 只得 `agent_off`(旧的公共回答通道与 `rooms.answer` 模板已删除,历史版本数据保留)。
- **语音**:每次转写结束(成功 / 为空 / 失败)后通知智能体;只有转写成功且有目标(回复智能体或 `to_agent`)才开回合,转写文字就是问题;带练轮到你时,转写成功的语音就是回答(迟到的转写输给 60 秒自动跳过,不计入);为空或失败 → 只给说话人 `notice voice_unclear`,计时不重置、不扣题。转写文字不进日志。无迁移:目标存在语音消息自己的 `meta`。
- **回复纯英文**:智能体在 1:1 与联机的公开回复只用英文;中文说明放进不朗读的 `note_zh`(≤ 80 字;1:1 在 SSE `done.note_zh` 与 `messages.agent_trace.note_zh`,联机在公开消息 `meta.note_zh`),带练另有 `hint_zh`;用户设置 `zh_note`(`auto` | `always` | `never`)控制,`auto` = A2 / B1 水平才写。服务端对公开文本做确定性的中文句兜底(拿掉的中文变成 `note_zh`);人名可保留中文。
- **未验证(没有真实上游、真机、Postgres)**:真实模型对 `<<ZH>>` 行与 `<<META>>` 新字段(`note_zh` / `hint_zh`)的遵守率,以及中文句兜底在真实输出上的误伤 / 漏网率(只在假上游与 3,000 例拆分模糊测试下测过);首字延迟(兜底只暂扣含中文的句子,英文立即放行,真实延迟未测);真实转写延迟下语音答题与 60 秒自动跳过的竞争(测试用注入的假时钟);Postgres 上 `room_messages.meta` JSON 写入 `to_agent` / `note_zh`(与 SQLite 同一路径,无新迁移,未在 Postgres 上跑);多 worker(计时器、AI 队列、带练锁都是每进程的,镜像只跑一个 worker);SSE / WebSocket 经反向代理;网页端的「对象」标签、`@` 补全、「中文」折叠与朗读兜底见 `web/README.md`。
```

- [ ] **Step 7: 提交**

```bash
git add server/app/agents/CLAUDE.md server/app/agents/tutor/CLAUDE.md server/app/rooms/CLAUDE.md server/app/routers/CLAUDE.md server/tests/CLAUDE.md server/README.md
git commit -m "docs: agents addressing (routing order, voice hook, note_zh, retired @ai answer lane, unverified items)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task Z2: 合并验收与评审波

- [ ] **Step 1: 全量测试** — `cd server && uv run pytest -q`(约 2.5 分钟;超时就按 `tests/test_a*.py`、`tests/test_[b-q]*.py`、`tests/test_r*.py`、`tests/test_[s-z]*.py` 分四批)。`cd admin && yarn vitest run`。`cd server && uv run alembic heads` 仍是 `0017 (head)`(本计划没有迁移)。
- [ ] **Step 2: 夹具差异只含声明的键** — `git diff main -- server/tests/fixtures/`:`agents_contract.json` 只有 `done.note_zh`、`done.trace.note_zh`、`settings.zh_note`、`message_with_trace.agent_trace.note_zh`;`agents_tutor_contract.json` 只有 `hint` 的英文文字与 `hint.hint_zh`;`rooms_contract.json` 只有 `ws.message_ai_answer.message.meta` 变成 `{agent, asker}`;`rooms_agents_contract.json` 只有 `ws.message_agent_answer.message.meta.note_zh`;`rooms_prompts_legacy.json` 只删 `answer` 键。有额外键就是漏了计划外的线上改动,先查原因。重录各夹具后再各跑一遍(无 `CONTRACT_UPDATE`)确认稳定。
- [ ] **Step 3: 评审波** — L4(编排器流式过滤)与 R2(路由、准入、删除旧通道)各自合并前已单独 `/code-review high`;V2 + T5 之后已跑 `security-review`(V2 Step 6);现在对全部改动 `/code-review high`:重点是目标越权、转写与 `note_zh` 泄漏、带练竞争、旧通道删除是否有遗漏的引用(`grep -rn "rooms.answer\|_admit_ai\|answer_messages" server admin`)、网页契约键集合是否被动过。
- [ ] **Step 4: 与网页计划联调**(网页计划合并后,在本地 `yarn web:dev` + 本地服务端 + 假上游,浏览器窗格 375×812):两个账号同一房间 —— 回复智能体的消息不写 `@` 也得到回答;打开「对象」后文字与语音都得到回答;`@ai` 得到默认智能体的回答;被静音 / 关闭智能体时看到对应提示且消息仍在;带练轮到你时按住说话,转写成功后算作回答,空白录音得到「没听清」且倒计时不重置;「中文」按钮只在有 `note_zh` / `hint_zh` 时出现。这些只有在网页计划合并后才能做;没做就在验收记录里写「未验证」。
- [ ] **Step 5: 验收记录** — 在本文件末尾追加 `## Addendum (日期) · 验收记录`,写:各批全量测试的结果、重录的夹具、评审发现与处理、手动联调做了哪些 / 没做哪些。**未验证项照抄 `server/README.md` 新小节的清单,不得写成已验证。**
- [ ] **Step 6:** 只有全部绿色才勾选本计划的复选框(`docs/CLAUDE.md` 约定:合并且测试通过才勾)。

---

## 验证矩阵

| 需求(spec) | 自动化测试 | 手动 / 未验证 |
|---|---|---|
| 回复即对话:回复智能体的消息自动交给它;被移出配置 / 隐藏的回答不触发(§3.2 #1) | `test_rooms_addressing_routing.py`(回复规则、静默拒绝、`@Carol` 落到隐式规则)、`test_rooms_addressing_store.py::agent_of`、`test_rooms_agents_ws.py::test_the_alias_replies_and_say_to_reach_agents_without_a_mention` | 网页联调 **未验证**(网页计划合并后) |
| 「对象」`say.to`:必须属于本房配置,否则 `agent_off`、消息照发;`meta.to_agent` 只在 `to` 真正起作用时写(§3.2 #2、§3.4) | `test_rooms_addressing_protocol.py`、`test_rooms_addressing_routing.py::test_say_to_*`、`test_rooms_connection.py`(无智能体时) | — |
| 带练语音算作回答:转写成功后、只有被点名成员、题号守卫;失败 / 空不计、`voice_unclear`、计时不重置;转写与 60 秒自动跳过的竞争(§3.2 #3、§3.4) | `test_rooms_agent_tutor.py`(`on_message` 布尔、`waits_for`、竞争两个方向)、`test_rooms_addressing_voice.py`(带练三例、迟到转写) | 真实转写延迟下的竞争 **未验证**(假时钟);真机语音 **未验证** |
| 语音上传 `to_agent`:形状校验、存进消息 `meta`、转写成功后以转写文字开一个回合、转写文字不进日志(§3.4、§7) | `test_rooms_voice_service.py`(钩子、`meta`、钩子异常)、`test_rooms_voice_api.py`、`test_rooms_addressing_voice.py`(含真实应用端到端与 caplog) | — |
| 路由优先级 `@ai` > `@名字` > 回复 > `to`,至多一个回合(§3.4) | `test_rooms_addressing_routing.py::test_priority_alias_then_name_then_reply_then_to` | — |
| 成本:每个路由消息一个回合,沿用全部上限;被拒时消息照发(§3.3) | `test_rooms_addressing_routing.py`(忙 / 配额 / 并发准入 / 存库失败退还)、`test_rooms_addressing_voice.py::test_room_gates_notify_the_sender_and_the_clip_stays_published` | 真实成本 **未验证**(没有真实上游) |
| `@ai` 并入默认智能体:第一个能解析的角色,否则内置教练;停用 = `agent_off`;功能关闭 = `agent_off`(§4) | `test_rooms_addressing_routing.py`、`test_rooms_agents_lane.py`、`test_web_contract.py`(`@ai` 回复带 `meta.agent`) | — |
| 删除旧通道、模板、管理端入口、夹具与测试;私聊助手不动;历史版本数据保留(§4) | `test_rooms_assistant.py::test_the_answer_lane_is_gone`、`test_prompts_api.py::test_the_retired_rooms_answer_prompt_is_gone_but_its_history_stays`、`test_prompts.py`、`prompt-editor-page.test.tsx`、Z2 的 grep | — |
| 回复纯英文、`<<ZH>>` 剥离、中文句兜底、首字不增加延迟(§5.1、§5.2) | `test_agents_lang.py`(3,000 例拆分模糊)、`test_agents_orchestrator.py`、`test_agents_prompt.py`、`test_agents_tutor_{parse,machine,prompt,turn}.py` | 真实模型是否遵守 `<<ZH>>` / META 新字段、兜底误伤率、真实首字延迟 **未验证** |
| `note_zh` / `hint_zh` 传输:`done.note_zh`、`agent_trace.note_zh`、联机 `meta.note_zh`、带练帧 `hint_zh`、1:1 提示端点(§5.2) | `test_agents_trace.py`、`test_agents_contract.py`、`test_agents_tutor_{api,turn,contract}.py`、`test_rooms_agent_tutor.py`、`test_rooms_agents_contract.py` | — |
| 用户设置 `zh_note`(`auto` | `always` | `never`),联机按提问者 / 带练按开启者(§5.1) | `test_agents_settings.py`、`test_agents_tutor_turn.py`、`test_rooms_agent_tutor.py::test_the_started_by_setting_and_the_level_decide_the_prompt`、`test_rooms_agents_prefs.py` | — |
| 朗读兜底(§5.3) | 网页计划(`speech-text.test.ts` 等) | 服务端无工作 |
| 无迁移(§6) | `alembic heads` 仍 `0017`、`test_migrations.py` 不变 | Postgres 上写 `meta.to_agent` / `meta.note_zh` **未验证**(与 SQLite 同一 JSON 列路径) |
| 隐私:转写、问题、回复、`note_zh`、`hint_zh`、人名、角色 id 不进日志 / URL / 错误(§7) | `test_agents_privacy.py`(L5)、`test_rooms_addressing_routing.py::test_routing_logs_*`、`test_rooms_addressing_voice.py`(两处 caplog)、`test_rooms_voice_service.py`(钩子异常)、`test_rooms_agent_tutor.py`(两处 caplog)、`test_agents_tutor_{api,turn}.py`(提示 / 说明不进日志) | — |
| 架构不放宽 | `tests/test_architecture.py`(一行不改)、`test_tutor_core_modules_are_pure` | — |
| 契约夹具重录一次且稳定;网页逐键核对 | `test_agents_contract.py`、`test_agents_tutor_contract.py`、`test_web_contract.py`、`test_rooms_agents_contract.py`;网页 `*-contract.test.ts` | 网页计划合并后重跑网页契约测试 **未验证** |
| 多 worker、反向代理下的 SSE / WebSocket | — | **未验证**(镜像只跑一个 worker;沿用既有限制) |

## 不做

- 空闲自动关闭「对象」;服务端保存「对象」状态;给 1:1 加 `@`;语音转写的人工修改;自动翻译 `note_zh`(spec §8)。
- 改私聊写作助手(`rooms.assist`、`on_assist`、助手面板、assist 车道)。
- 语音里解析 `@`(口语里不会出现;只用回复规则与 `to_agent`,R-AS2)。
- 联机帧里的英文提示字段与 `GET /api/rooms/{id}/agents` 的 `default_agent`(R-AS18:网页不消费且会破坏它的键集合测试)。
- 把房间话题 / 水平 / 场景再塞进 `@ai` 的回答(R-AS23;旧 `rooms.answer` 的行为不保留,D3)。
- 迁移、改写或删除旧 `@ai` 回答消息与 `prompt_versions` 里 `rooms.answer` 的历史行;新迁移 `0018`(R-AS1:无迁移)。
- 带练进行中让非被点名成员的「对象」消息也触发回合(R-AS3);带练暂停期间同理。
- 用语言识别模型判断中文(兜底是确定性规则,R-AS10);按词表保留 / 移除中文人名。
- 多 worker 下共享计时器、AI 队列与带练锁(沿用单 worker 限制)。
- 新依赖;动 `enjoy/` 或任何上游目录。

## 规格问题(已裁定,未改 spec)

1. §4 一处写「`AGENTS_ENABLED=false` 或房间被静音时 `@ai` 返回 `notice agent_off`」,同句又要求「与现在 `@名字` 一致」;现在静音时 `@名字` 是 `ai_off` → 取「一致」:功能关闭 = `agent_off`,静音 / 公共 AI 关闭 = `ai_off`(R-AS4、R-AS24)。
2. §3.2 #3(轮到你时不需要「对象」)与 D2(带练开始自动打开「对象」)叠加,§3.4 的「至多一个回合」没有列出带练的优先级 → 带练进行中关闭隐式路由,被点名成员的回答只给带练(R-AS3)。
3. §3.4 要求语音目标记在「语音记录 / 消息元数据」,只在「语音表没有可用 JSON 列」时才提迁移 → 用消息自己的 `meta`,无迁移(R-AS1)。
4. §3.4 要求上传时校验 `to_agent` 属于本房配置,但上传是 REST、没有 WS 通道可回 `notice` → 上传只校验形状,转写结束时再按配置校验并给 `agent_off`(R-AS7)。
5. §5.1「人名可保留中文」与 §5.2「含中文的句子移除」需要可测的边界 → 确定性规则(R-AS10)。
6. §5.2 写 `hint_zh` 随 `agent_tutor` 帧下发,但联机帧原本没有任何提示字段;并且网页契约测试逐键钉住帧的键集合 → 只增可选键 `hint_zh`,不带英文 `hint`(R-AS13、R-AS18)。
7. §5.2 写 1:1 的说明「随 assistant 消息保存在 `agent_trace`」,但 1:1 的消息由网页保存 → 服务端把 `note_zh` 放进 `done` 与 `done.trace`,网页按现状回存(R-AS12)。
8. §4 写提示文案显示默认智能体的真实名字,但服务端不暴露默认智能体(R-AS18)→ 网页用 `agent_ids[0]` 推出,没有配置时不显示名字。
9. §3.3 写「对象」打开期间每条消息计一次回合,与 R-AS3(带练进行中不路由)在带练期间不一致 → 以 R-AS3 为准;网页的「消息会交给 X」提示在带练期间对非被点名成员略有偏差(见「与网页计划的对账」)。
10. §3.2 #1「核对 `agent_lane` 写入的字段」:回复规则读 `meta.agent.persona_id`;带练的题目 / 点评也带它,所以带练结束后回复一条旧的带练消息会开一个聊天回合(可接受)。

## 与网页计划的对账

对照 `plans/2026-10-12-agents-addressing-web.md`(P1、P2、V1、T1 与它的 Cross-plan assumptions)。本计划已在服务端一侧收窄线上形状来对齐网页,所以没有需要网页**必须**改的地方:

| # | 网页假定 | 服务端实际(本计划) | 谁改 |
|---|---|---|---|
| 1 | S-1:`SayMsg.to: str \| None`(≤ 64),不在本房配置 → `agent_off`、消息照发;网页读 `protocol.py` 的 `to: str \| None` | 一致,字段按这个写法出现(R1 测试逐字钉住);空串 = 没有目标 | 无 |
| 2 | S-2:`form.get("to_agent")`、可选、同样校验、转写成功后触发一次回合 | 一致:上传校验形状(400 `Invalid to_agent`),转写后按配置校验;`rooms_voice.py` 含该字面量 | 无 |
| 3 | S-3:notice `voice_unclear`,字面量 `code="voice_unclear"` 出现在 `rooms/voice.py` / `agent_tutor.py` / `agent_lane.py` / `connection.py` / `routers/rooms_voice.py` 之一 | 一致:在 `agent_lane.py`(V2 测试 grep 同一字面量);对象:带练回答或回复 / `to_agent` 智能体的语音转写为空 / 失败,只给说话人的所有连接 | 无 |
| 4 | S-4:`meta.note_zh` 可选、≤ 80 字,含带练题目 / 点评 | 一致(`agent_lane._turn`、`agent_tutor._run_turn`);有值才有键 | 无 |
| 5 | S-5:`agent_tutor` 帧与 start 响应的 `tutor.hint_zh` 可选 | 帧在 `await_answer` 且有值时带;start 响应的快照处于 `generating`,所以没有。网页把它当可选键,不受影响 | 无 |
| 6 | R-AW14:服务端今天没有英文提示字段,网页不虚构 | 服务端原计划(R-AS13)加英文 `hint`;为对齐网页的键集合测试**撤回**(R-AS18) | 服务端已改 |
| 7 | `room-agents-contract.test.ts` 钉住 `wireKeys(C.http.agents) == ["agents","available","tutor"]` | 原计划(R-AS16)加 `default_agent`,会让它失败;**撤回**(R-AS18) | 服务端已改 |
| 8 | 夹具键 `ws.message_agent_answer`(`meta.note_zh` 可选) | 键名沿用;原计划写的 `message_agent_reply` 作废(R-AS17) | 服务端已改 |
| 9 | S-6 / S-7 / S-8 / S-9:`done.note_zh`、`agent_trace.note_zh`、`POST …/hint → {hint, hint_zh?, session}`、设置 `zh_note` | 一致(L2–L5、T3);`zh_note=never` 时提示不返回 `hint_zh` | 无 |
| 10 | S-12:回复规则按被引用消息的 `meta.agent.persona_id`;优先级 `@ai` > `@名字` > 回复 > `to` / `to_agent`;`@ai` 去配置的第一个智能体 | 一致;补充:没有配置时 `@ai` 去内置教练,但 `to` 不能指向它(R-AW5 已按此设计:没有配置时不显示「对象」) | 无 |
| 11 | S-13:带练结束仍写 `tutor_stopped` / `tutor_done` 系统消息并广播 `agent_tutor{tutor:null}`;`welcome` 后重发带练帧 | 未改动 | 无 |
| 12 | R-AW7 / spec §3.3:「对象」打开期间提示「消息会交给 X」 | 带练进行中服务端不路由隐式消息(R-AS3):非被点名成员此时带着 `to` 发的消息**不会**得到回答,也不发提示 | 网页可选:带练进行中把「会交给 X」换成「带练进行中,不会触发回答」;服务端不改 |
| 13 | R-AW3:轮到我答带练时网页不带 `to` / `to_agent` | 与 R-AS3 不冲突(服务端本来就不路由);语音带练回答不依赖目标 | 无 |
| 14 | `room-agents-contract.test.ts` 扫描 `agent_tutor.py` 里的 `_pause(room_id, snap, "<reason>")` 与 `PAUSE_* = "…"` | 本计划没有新增暂停原因 | 无 |
| 15 | S-15:新消息不再有无 `meta.agent` 的 `ai_answer`;旧消息照旧渲染 | 一致(A1 删除旧通道;`AI_NAME` 保留供历史消息显示) | 无 |
| 16 | 网页不读 `meta.to_agent` | 服务端把它写进公开消息(成员可见,只含角色 id;R-AS1、R-AS19);对网页是多余的可选键 | 无 |

## Cross-plan assumptions

下面是网页计划消费的线上名字与行为,**现以本计划为准**(与网页计划的 S-1…S-15 一一对应;不一致时只改调用处与测试,写 Addendum):

- **WS 客户端 `say`**:`{type:"say", client_id, text, assist_id?, reply_to?, to?}`;`to` 是 persona id(≤ 64,可省略;空串按没有)。服务端校验它属于本房 `agents` 配置;不属于 → `notice agent_off`,消息照发。带练进行中(`rooms.agent_tutor` 非空)`to` / 回复规则不触发回合,也不发提示。
- **WS 服务端事件**:`notice.code` 追加 `voice_unclear`(顺序在 `agent_off` 之后);`PROTOCOL_VERSION` 仍是 2。
- **公开消息 `meta`**:智能体回复 `meta.agent = {persona_id, name}`、`meta.asker`、可选 `meta.note_zh`(≤ 80 字);带练题目 / 点评另有 `meta.tutor`;文字消息仅在 `to` 真正起作用时有 `meta.to_agent`;语音消息的 `meta.to_agent` 是上传时通过形状校验的 `to_agent`。`message_hidden` 清空 `meta`,重放与 `GET /api/rooms/{id}/messages` 同样带。
- **`agent_tutor` 帧与 `POST /api/rooms/{id}/agents/tutor/start` 响应的 `tutor`**:原有必需键不变;`await_answer` 阶段且有值时多可选键 `hint_zh`;**没有**英文 `hint` 键。
- **`GET /api/rooms/{id}/agents`**:`{available, agents, tutor}`,形状不变;默认智能体 = `room.agent_ids[0]`,没有配置时 `@ai` 去内置英语教练。
- **语音上传 `POST /api/rooms/{id}/voice`**:可选表单字段 `to_agent`(persona id;空串 / `null` / 空白 = 没有;形状不合法 → 400 `Invalid to_agent`)。转写结束后:成功且有目标(`to_agent` 或回复智能体的消息)→ 一个智能体回合,问题 = 转写文字;带练正等这个发送者 → 转写文字是回答;为空 / 失败且有目标或是带练回答 → 只给发送者 `notice voice_unclear`。
- **1:1**:`POST /api/agents/turn` 的 SSE `done` 带可选 `note_zh`(对话与导师模式相同;`delta` 里没有 `<<ZH>>` 及其后内容),`done.trace` 可能也带;`messages.agent_trace.note_zh`(≤ 80 字)可由客户端回存,`check_stored` 放行;`POST /api/agents/tutor/{id}/hint` → `{hint(英文), hint_zh?, session}`;`GET/PATCH /api/agents/settings` 有 `zh_note ∈ {auto, always, never}`,默认 `auto`。
- **夹具(重录一次)**:`agents_contract.json`(`settings.zh_note`、`turn_sse.done.note_zh`)、`agents_tutor_contract.json`(`hint.hint_zh`)、`rooms_contract.json`(`ws.message_ai_answer.message.meta` 变成 `{agent, asker}`)、`rooms_agents_contract.json`(`ws.message_agent_answer.message.meta.note_zh`;**无** `default_agent`、**无** `hint`、`hint_zh` 不在录制里)。
- **合并顺序**:服务端(本计划)先于网页计划合并;INDEX X7 / X11 / X12 / X13 仍然有效。
