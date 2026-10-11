# app/agents/tutor/

导师模式「带我学」(spec `docs/superpowers/specs/2026-10-12-agents-design.md` §7;计划 `docs/superpowers/plans/2026-10-12-agents-tutor.md`)。
本目录有五个**纯模块**(只用标准库与彼此,联机导师 A5 直接复用,`test_tutor_core_modules_are_pure` 强制)和三个有状态模块
(`service.py`、`handler.py`、`memory_bridge.py`)。表 `agent_tutor_sessions` 追加在迁移 `0016`;REST 在 `routers/agents_tutor.py`。

## What lives here
- `plan.py` – 出题计划:`Goal`、`PlanItem`、`PlanSources`、`build_plan`、`clean_goal`、`sources_from`(上下文来源结果 → 词与弱点)。
  主题 / 场景是固定键,目标里没有自由文本
- `machine.py` – 不可变 `TutorState` + `next_state(state, event)`;事件 `Asked / Answered / HintUsed / Skipped / Finished`;
  `new_state`(别名 `initial_state`)、`difficulty`、`to_dict / from_dict`(读取时夹取、容错)、`InvalidTransition`
- `parse.py` – `<<META>>` 协议(标记容忍大小写、空白与 «META» 等括号变体):`parse_meta`、`StreamFilter`(跨增量剥离标记)、`resolve`(缺失 / 无效的回落规则)
- `prompt.py` – `tutor_block`(每回合都变的模式块,放在历史之后)、`question_line`、`clean`、`MAX_TOKENS = 350`、`OPENING_USER_TEXT`
- `recap.py` – `build_recap`、`memory_candidates`(≤ 3 条,不含词与回答)、`summary_text`
- `service.py` – 会话存取:`start`(幂等、每日上限 `limits.SCOPE_TUTOR_USER`、并发唯一约束兜底)、`hint / skip / finish`、
  `apply_turn`(回合后推进;`version` 乐观锁)、`out / meta_out`、闲置 30 分钟 = `expired`;来源只经 `routers/agents_tutor.py` 预取传入
- `handler.py` – `TutorModeHandler`(`runtime(app).modes.register`,`main.py` 的 A3 锚点):`prepare` 校验阶段并给模式块,
  `finish` 用原始全文解析 META、回落、推进状态机,返回 `meta` 事件数据(A1 的 `Event.to_dict` 不发值为 null 的键:缺键 = null)
- `memory_bridge.py` – 唯一调用 A2 记忆接口处:`worker.submit_tutor(TutorFinished)` 写回顾,`MemoryStore.add` 写 ≤ 3 条确定性候选

## Allowed dependencies
五个纯模块:标准库 + 彼此(`machine → plan`、`parse → plan`、`prompt → machine, plan`、`recap → machine, plan`)。
词汇数据只经上下文来源结果(`SourceResult.params`)进入 `plan.sources_from`;**不要**导入 `wordbook`。

## Tests
`uv run pytest -q tests/test_agents_tutor_{plan,machine,parse,prompt,recap,models,api,turn,contract}.py tests/test_architecture.py tests/test_migrations.py`
助手 `tests/agents_tutor_helpers.py`(`fake_stream` 替换 `llm.complete_stream`、`install_sources` 换掉 `runtime(app).registry` 里的来源);
导师回合后紧接着再发请求前先 `await asyncio.gather(*list(runtime(app).tasks))`(内存 SQLite 共用一条连接)。
契约夹具 `tests/fixtures/agents_tutor_contract.json`(`CONTRACT_UPDATE=1` 重录)。
性质测试用固定种子 `random.Random`(无 hypothesis,R-T9):状态机 2,000 条随机事件序列、META 过滤器 3,000 例拆分模糊。

## Pitfalls
- 题号、题型、是否结束、难度升降、跳过 / 提示 / 重试语义只由 `machine.py` 决定;模型的 META 只提供 `verdict`、`hint`、`say`。
- 进入提示词的字符串(学习者文本、词、记忆短语、听写句)一律先 `prompt.clean`(去控制字符 / 引号,`<` `>` 换形近字符)。
- 日志与错误里不得出现用户回答、题目、提示、词;摘要与记忆候选只含题型、主题代码与数字。
- `META` 过滤必须保持「任意拆分下输出等于 `parse_meta` 的可见部分」;改 `StreamFilter` 先跑 `test_fuzz_chunk_splits_*`。
- 回合生成中 `hint / skip` 返回 409「Tutor is generating」:`handler.prepare` 调 `service.mark_generating`,`finish` 清除;orchestrator 没有中止钩子,所以带 30 s TTL(进程内)。`finish` 并发幂等:版本冲突时重读,已结束就返回同一份总结,`on_recap` 只由胜出者调用。
