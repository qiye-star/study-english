# app/agents/tutor/

导师模式「带我学」(spec `docs/superpowers/specs/2026-10-12-agents-design.md` §7;计划 `docs/superpowers/plans/2026-10-12-agents-tutor.md`)。
本目录现有五个**纯模块**(只用标准库与彼此,联机导师 A5 直接复用);有状态部分(`service.py`、`handler.py`、
`memory_bridge.py`)在计划 S6+ 加入。

## What lives here
- `plan.py` – 出题计划:`Goal`、`PlanItem`、`PlanSources`、`build_plan`、`clean_goal`、`sources_from`(上下文来源结果 → 词与弱点)。
  主题 / 场景是固定键,目标里没有自由文本
- `machine.py` – 不可变 `TutorState` + `next_state(state, event)`;事件 `Asked / Answered / HintUsed / Skipped / Finished`;
  `new_state`(别名 `initial_state`)、`difficulty`、`to_dict / from_dict`(读取时夹取、容错)、`InvalidTransition`
- `parse.py` – `<<META>>` 协议:`parse_meta`、`StreamFilter`(跨增量剥离标记)、`resolve`(缺失 / 无效的回落规则)
- `prompt.py` – `tutor_block`(每回合都变的模式块,放在历史之后)、`question_line`、`clean`、`MAX_TOKENS = 350`、`OPENING_USER_TEXT`
- `recap.py` – `build_recap`、`memory_candidates`(≤ 3 条,不含词与回答)、`summary_text`

## Allowed dependencies
五个纯模块:标准库 + 彼此(`machine → plan`、`parse → plan`、`prompt → machine, plan`、`recap → machine, plan`)。
词汇数据只经上下文来源结果(`SourceResult.params`)进入 `plan.sources_from`;**不要**导入 `wordbook`。

## Tests
`uv run pytest -q tests/test_agents_tutor_{plan,machine,parse,prompt,recap}.py tests/test_architecture.py`
性质测试用固定种子 `random.Random`(无 hypothesis,R-T9):状态机 2,000 条随机事件序列、META 过滤器 3,000 例拆分模糊。

## Pitfalls
- 题号、题型、是否结束、难度升降、跳过 / 提示 / 重试语义只由 `machine.py` 决定;模型的 META 只提供 `verdict`、`hint`、`say`。
- 进入提示词的字符串(学习者文本、词、记忆短语、听写句)一律先 `prompt.clean`(去控制字符 / 引号,`<` `>` 换形近字符)。
- 日志与错误里不得出现用户回答、题目、提示、词;摘要与记忆候选只含题型、主题代码与数字。
- `META` 过滤必须保持「任意拆分下输出等于 `parse_meta` 的可见部分」;改 `StreamFilter` 先跑 `test_fuzz_chunk_splits_*`。
