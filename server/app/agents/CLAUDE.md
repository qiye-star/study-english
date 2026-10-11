# app/agents/

智能体共用核心(spec `docs/superpowers/specs/2026-10-12-agents-design.md`;计划 `docs/superpowers/plans/2026-10-12-agents-core.md`)。
对话(`routers/agents.py` 的 SSE 回合)与联机(`app/rooms/`,计划 A5)共用一套代码。Off unless `AGENTS_ENABLED`
(路由 404;本包本身没有开关判断,除 `limits.effective_tools_mode`)。

## What lives here
- `trace.py` – 过程事件数据类 `Start / Step / Thought / Delta / Meta / Done / Error`(`.to_sse()` / `.to_dict()`)、
  `compact_trace`(≤ 4 KB,写进 `messages.agent_trace`)、`check_stored`(客户端回存的过程校验)、`clean_params`
- `context.py` – 上下文来源协议 `ContextSource`、`SourceCtx / SourceResult / SourceOutcome`、`SourceRegistry`、
  `enabled`(用户工具开关 × 角色工具 × 联机 `share_in_rooms` × `AGENTS_TOOLS_MODE`)、`prefetch`(并行,逐源超时,
  总预算 `PREFETCH_BUDGET_MS = 250`,超时 `skip`、异常 `fail`、`None` 记 `done`)
- `personas.py` – `Persona`、11 个内置角色(`builtin:*`,R-C1)、`clean_persona`(用户与管理员编辑共用)、`PersonaStore`
- `settings.py` – 用户级 `AgentSettings`、`DEFAULTS`、`load`(读时丢弃坏键)、`save`(严格校验,不提交)
- `prompt.py` – 纯函数:安全前言 → 角色 → 记忆块 | 历史 | 本轮(模式块 + `<context>` + `<user_message>`),`escape`
- `limits.py` – 每日回合额度(`consume_turn` / `refund_turn`,作用域常量供 A2/A3)、`personas_cap`、
  `effective_tools_mode`、进程内幂等 `TurnLedger`
- `orchestrator.py` – `run_turn(deps, req)`(异步生成器)、`TurnDeps` / `deps_for(app)`、`TurnRequest`、`ModeHandler` /
  `ModeBlock` / `StreamFilter` / `ChatMode` / `ModeRegistry`、`TurnHooks` / `TurnRecord`、`AgentsRuntime` / `runtime(app)`
- `memory/`(计划 A2)、`tutor/`(计划 A3):各自的 CLAUDE.md

## Allowed dependencies
`app.core`、`app.models`、`app.providers`、`app.speech`、`app.services`。**不能**导入 `rank / rooms / realtime / wordbook /
links / admin / routers`(连函数内延迟导入也不行;`tests/test_architecture.py::test_agents_layer_rules`)。
可被 `rooms / links / admin / routers / main` 导入。需要学习数据的来源写在 `app/links/agent_sources.py` 并注册进
`runtime(app).registry`(R-A1:不受 `LINKS_ENABLED` 控制)。

## Extension points(其他计划只经这些接入)
- 来源:`runtime(app).registry.register(source)`(`key`、`private`、`async load(ctx) -> SourceResult | None`)。
  `persona` / `history` 是内置步骤,不能注册。记忆来源键 `memory`(A2)放进 system 的 `<memory>` 块,其余放 `<context>`。
- 模式:`runtime(app).modes.register(handler)`(`name`、`prepare(req) -> ModeBlock`、`stream_filter()`、
  `finish(req, full_text) -> dict | None`,返回值经 `trace.Meta.from_dict` 发 `meta`)。`chat` 内置。
- 回合后:`runtime(app).hooks.after_turn.append(async fn(record: TurnRecord))`;在 `done` 之前用 `deps.spawn` 后台启动,
  失败只记异常类名。`TurnRecord.text / reply` 只在内存。
- 联机:`deps_for(app)` + `TurnRequest(in_room=True, room_id=…, conversation_id=None)`;`PersonaStore.get_shared`。

## Tests
`uv run pytest -q tests/test_agents_*.py tests/test_llm_stream.py tests/test_llm_probe_tools.py tests/test_links_agent_sources.py tests/test_admin_agents.py tests/test_conversations_agent_trace.py tests/test_architecture.py`
助手:`tests/agents_helpers.py`(`FakeLLM` 假上游、`use_fake_llm`、`enable_agents`、`parse_sse`、`new_conversation`、
`turn_body`、`check_contract`)。契约夹具 `tests/fixtures/agents_contract.json`(`CONTRACT_UPDATE=1` 重录)。

## Pitfalls
- 日志、异常消息、审计、URL、`error` 事件里永远没有用户文本、回复、人设、记忆、词或用户 id:只记来源键、模式名、
  异常类名、状态码与数字(`timing event=agent_turn ...`)。`step.params` 可以有词,但只进 SSE 与用户自己的 `agent_trace`。
- 嵌套异步生成器必须用 `contextlib.aclosing`(否则外层被关时内层不关,上游流挂到 GC)。路由用 `AgentStream`。
- 用户和工具来的文本进提示词前必须 `prompt.escape`(`<` `>` → `‹` `›`),人设永远排在安全前言之后。
- 读设置每次 `deps.settings()`;不要在模块里缓存 `Settings`。
- `TurnLedger`(幂等)与回合并发上限是**每进程**的;镜像只跑一个 worker。多 worker 时同一 `client_turn_id` 可能在两个进程各跑一次。
- 来源在 `prefetch` 里会被取消(超时 / 总预算):来源自己开会话(`async with sessionmaker()`),不要在取消点之后写库。
- `AGENTS_TOOLS_MODE=native` 在本版本与 `prefetch` 行为相同(R-C7);探测结果存 `app.state.agents_tools_probe`(每进程,重启丢)。
