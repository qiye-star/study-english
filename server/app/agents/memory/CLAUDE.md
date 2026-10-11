# app/agents/memory/

智能体记忆(spec `docs/superpowers/specs/2026-10-12-agents-design.md` §8;计划 `docs/superpowers/plans/2026-10-12-agents-memory.md`)。
五层:短期(`agent_thread_states`:线程摘要 + 待整理文本)、会话回顾(`agent_recaps`)、长期 / 角色记忆(`agent_memory_items`,
`persona_id` 为空 = 共享)、用户档案(`agent_profiles`)、墓碑(`agent_memory_tombstones`,只存哈希)。

## What lives here
- `tombstones.py` 规范化、哈希、敏感过滤(邮箱含 at/dot 拼写、URL 含短链、密钥形态、pw: 口令、微信号、分隔或中文数字的长数字 / 手机号)、脱敏、墓碑读写
- `profile.py` 档案六键(单词键,R-M7)、逐键校验、用户编辑 vs 智能体提议
- `retrieve.py` 纯函数打分与 `<memory>` 组块(`build_block`)
- `store.py` 全部数据库读写(`MemoryStore`)、`drop_conversation`、`memory_counts`
- `extract.py` 抽取提示词与严格解析(≤ 3 个操作)
- `summarize.py` 滚动摘要与会话回顾
- `cache.py` 线程快照(5 分钟)
- `source.py` 上下文来源 `memory`(private)
- `worker.py` 回合后整理:触发规则、额度、退避、导师结束(`submit_tutor`)
- `setup.py` `install(app)`:注册来源与 after_turn 钩子,挂 `app.state.agent_memory`

## Allowed dependencies
`app.core`、`app.models`、`app.providers`、`app.services`;agents 内只许 `app.agents.context`、`app.agents.settings`。
只有本包、`app.agents.tutor`、`app.routers`、`app.admin`、`app.main` 可导入本包(`tests/test_architecture.py::test_agents_memory_boundaries_hold`)。
编排(orchestrator)不导入本包:它只经注册表与钩子认识记忆。

## Tests
`uv run pytest -q tests/test_agents_memory_*.py tests/test_migrations.py tests/test_architecture.py`
助手:`tests/agents_memory_helpers.py`(`enable_agents`、`user_prefs`、`ctx`、`FakeRecord`、`FakeLLM`、`FakeDeps`)。
契约:`tests/fixtures/agents_memory_contract.json`(`CONTRACT_UPDATE=1` 重录;网页 `memory-contract.test.ts` 逐键核对)。

## Pitfalls
- 日志、错误、URL 里永不出现记忆文本、用户文本、档案值、用户 id:只记任务名、计数、`LlmUnavailable.kind`、异常类名(caplog 测试守着)。
- SQLite 不强制外键:删除对话靠 `drop_conversation`,删除用户靠 `admin/users_admin.USER_ROWS`;新增指向 users / conversations 的表要同步两处。
- 用户删除与清空写墓碑;智能体的 delete 与容量淘汰不写(R-M9)。置顶条目智能体不能改、不能删,也永不淘汰。
- 用户写操作必须 `cache.invalidate_user`;后台整理不作废快照(R-M5)。
- JSON 列要整体赋新值(`row.pending_texts = [...]`),原地修改不会被 SQLAlchemy 察觉。
- 所有模型调用经 `MemoryWorker._call`:先扣 `agents_memory` 每日额度,失败退还;不要在别处直接调 `llm.complete`。
- `touch_thread` 并发创建同一线程会抛 IntegrityError(任务失败、只计数):不要为此加重试循环。
- 0016 与 A3 共用:改表结构前看计划 R-M1。
