# app/agents/memory/

智能体记忆(spec `docs/superpowers/specs/2026-10-12-agents-design.md` §8;计划 `docs/superpowers/plans/2026-10-12-agents-memory.md`)。
五层:短期(`agent_thread_states`:线程摘要 + 待整理文本)、会话回顾(`agent_recaps`)、长期 / 角色记忆(`agent_memory_items`,
`persona_id` 为空 = 共享)、用户档案(`agent_profiles`)、墓碑(`agent_memory_tombstones`,只存哈希)。迁移 `0016_agent_memory`。

## What lives here
- `tombstones.py` 规范化、哈希、敏感过滤(邮箱 / URL / 密钥 / 长数字 / 手机号)、脱敏、墓碑读写
- `profile.py` 档案六键(单词键,R-M7)、逐键校验、用户编辑 vs 智能体提议
- `retrieve.py` 纯函数打分与 `<memory>` 组块(`build_block`)
- `store.py` 全部数据库读写(`MemoryStore`)、`drop_conversation`、`memory_counts`
- 后续任务(S5+)再加:`extract / summarize / cache / source / worker / setup`

## Allowed dependencies
`app.core`、`app.models`、`app.providers`、`app.services`;agents 内只许 `app.agents.context`、`app.agents.settings`。
编排(orchestrator)不导入本包:它只经注册表与钩子认识记忆。

## Tests
`uv run pytest -q tests/test_agents_memory_*.py tests/test_migrations.py tests/test_architecture.py`
助手:`tests/agents_memory_helpers.py`(`enable_agents`、`user_prefs`、`FakeRecord`(正文字段 `text`)、`FakeLLM`、`FakeDeps`)。

## Pitfalls
- 日志、错误、URL 里永不出现记忆文本、用户文本、档案值、用户 id。本包不写日志。
- SQLite 不强制外键:删除对话靠 `drop_conversation`,删除用户靠 `admin/users_admin.USER_ROWS`;新增指向 users / conversations 的表要同步两处。
- 用户删除与清空写墓碑;智能体的 delete 与容量淘汰不写(R-M9)。置顶条目智能体不能改、不能删,也永不淘汰。
- JSON 列要整体赋新值(`row.pending_texts = [...]`),原地修改不会被 SQLAlchemy 察觉。
- 0016 与 A3 共用:A3 在迁移里两处锚点注释处追加 `agent_tutor_sessions`;改表结构前看计划 R-M1。
