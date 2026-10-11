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
- `memory/` 记忆五层、来源 `memory`、回合后整理(计划 A2;见 `memory/CLAUDE.md`)。`install` 在 `main.py` 里紧跟本层安装。

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
  `ModeBlock(text, max_tokens, user_text)`:`user_text` 是 `text=None` 的回合(仅导师:开场 / 跳过后出下一题)的用户消息;
  其他模式 `text=None` → `bad_request`。`finish` 收到含 `<<META>>` 的原始全文。`prepare` / `finish` 里抛
  `ModeError(code)`(`code` ∈ `trace.ERROR_CODES`,否则 `bad_request`)→ SSE `error{code}`(HTTP 仍 200);`prepare` 失败退还额度,
  `finish` 失败不退(文字已流出)且不触发 after_turn。
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
- 用户和工具来的文本进提示词前必须 `prompt.escape`(`<` `>` 与全角 `＜＞`、小写形式 `﹤﹥` → `‹` `›`),人设永远排在安全前言之后;
  人设清洗(`clean_persona`)用 NFKC。提示词总长有上界:历史按 `AGENTS_HISTORY_CHARS_MAX`(默认 8000)从最新往前整条取、不截断单条,
  人设名 / 正文、记忆块在 `prompt.system_message` 里有硬上限,来源块由 `prefetch` 截到 800 字。
- 额度退还边界(评审 #4 #5):`consume_turn` 之后,只要回复文字还没送到客户端就退(取消 / 断开 / 任意异常 / 上游失败);
  送出过文字就不退(学习者已看到内容)。`stats["delivered"]` 在 Delta 被消费后置位;`refund_once` 保证只退一次。
  `personas/try` 同样:无回复即退,并占用与回合共享的「每人同时 2 个」名额。
- 幂等账本(评审 #3 #9):条目带请求指纹(persona / conversation / text / mode / tutor_session 的 sha256);同一 `client_turn_id`
  换了内容 → 409。`AgentStream` 在自己的 finally 里 `release`(生成器从未启动时也释放);running 条目 180 s 后失效。
- 创建角色:`create_lock(user_id)` + `PersonaStore.create_capped`(锁内计数 + 插入 + 提交,Postgres 另锁用户行)。
- 读设置每次 `deps.settings()`;不要在模块里缓存 `Settings`。
- `TurnLedger`(幂等)与回合并发上限是**每进程**的;镜像只跑一个 worker。多 worker 时同一 `client_turn_id` 可能在两个进程各跑一次。
- 来源在 `prefetch` 里会被取消(超时 / 总预算):来源自己开会话(`async with sessionmaker()`),不要在取消点之后写库。
- `AGENTS_TOOLS_MODE=native` 在本版本与 `prefetch` 行为相同(R-C7);探测结果存 `app.state.agents_tools_probe`(每进程,重启丢)。
- 编排不得导入 `app.agents.memory`;记忆只经 `SourceRegistry` 与 `TurnHooks.after_turn` 接入(`test_agents_memory_boundaries_hold`)。

## Unverified
真实上游从未被调用(本机上游返回 402,无密钥);下列项目只在假上游下测过,**未验证**(详见 `docs/superpowers/plans/2026-10-12-agents-latency.md`):
- DeepSeek / 方舟流式响应的 `data:` 行格式与 `[DONE]` 结尾
- `reasoning_content` 字段名与出现位置(深度思考角色)
- `stream_options.include_usage` 的用量块(否则计量按字节)
- `thinking: {"type": "disabled"}` 在流式请求上被接受
- 原生函数调用(管理端探测结果码)
- 真实首字时间(`ttft_ms`;假上游下的服务端开销数字见 latency 文档,只代表本机)
- 0015 及之后的迁移在 Postgres 上
- 反向代理下 SSE 不被缓冲(Nginx `X-Accel-Buffering: no`;Caddy `flush_interval -1`)
