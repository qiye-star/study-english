# 对话主页与每日问候(服务端 + 网页大纲)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对话页(`/chat`)改成「主对话」入口:顶部固定「今天的默认对话」,下方 [+ 新对话] 与按日期标注的历史列表(今天 / 昨天 / `2026-10-21 周三`)。每天第一次打开 App 时,AI 主动发一组有仪式感的问候(**恰好 3 段**,每段 1–2 句:时段 / 日期 + 连续天数 + 一句暖心话;待复习词数 + 昨天的错点;今天具体怎么练,见 §1 第 21 条与 §6),问候按「用户本地日」一次 AI 调用生成并缓存,同时作为当天默认对话的前几条助手消息存库,用户可以直接回复、AI 接着聊。默认对话每天新建一个,**不计入**每人对话数上限。默认角色「学习伙伴」(现有 `builtin:partner` 改名),可在对话右上角设置里换;新对话也在同一处选角色。用户设置:问候触发(每天首次 / 每次上线 / 关闭)与问候语言(中文 / 英文 / 中英双语)。问候提示词在管理后台可编辑(版本化、可恢复默认)。

**Architecture:** 服务端不新增顶层包。问候逻辑放 `app/agents/greeting/`(agents 的子包,与 `memory/`、`tutor/` 同级,只导入 core / models / providers / services 与 `app.agents.*`);需要背单词词典的学习数据由 links 层 `app/links/greeting_facts.py` 登记进问候的数据来源注册表(与 `app/links/agent_sources.py` 同一做法,R-A1 的先例)。新路由 `app/routers/chat_home.py`(`/api/chat-home/*`,排在 `stubs` 之前)。迁移 `0023`:`conversations.daily_date` + 唯一约束、新表 `chat_greetings`(问候多行存 JSON `lines`)、`chat_prefs`。问候提示词走现有「管理端可版本化提示词」通道(`app/services/prompts.py` `PROMPTS` + `prompt_versions` 表 + `app/admin/prompts_admin.py` + 管理端 `admin/src/features/prompts/`),不新建设置表。对话本身(消息存取、智能体回合、实时通话、语法 / 评测)沿用现有接口;只对 `POST /api/agents/turn` 加一个可选的「对话级 `zh_note`」覆盖(R7;`conversations.config` 的键一律 snake_case,见 R7 与 §1 第 22 条)。

**Tech Stack:** Python 3.12(uv)、FastAPI + SQLAlchemy 2 async + pydantic v2 + Alembic、pytest + pytest-asyncio;管理端 `admin/`(React + vitest);网页 React 18 + vitest(只写大纲)。不新增依赖,不改 `enjoy/`。

**Spec:** 暂无独立 spec。产品设计已与用户(owen)口头商定,原文要点与 2026-10-23 的答复收在下文「§1 已商定设计」;本计划获批后,如用户要求,再整理成 `docs/superpowers/specs/2026-10-23-chat-home-design.md`。演示页 v2 已获批:`docs/design/chat-home-demo-v2.html`(问候 3 段的内容与长度以它为准)。网页实现见姊妹计划 `docs/superpowers/plans/2026-10-23-chat-home-daily-greeting-web.md`(下称「网页计划」);本计划 §5.1 是两者之间的契约,§11 只留摘要。

---

## Global Constraints

- **只读核对后再动手:** Task 0 先核对本计划引用的文件与行号仍然成立(写计划时 head 为 `0022`,见下文 §2)。
- **分层不放宽:** `server/tests/test_architecture.py` 一字不改。`app/agents/greeting/` 不得导入 `wordbook / links / rank / rooms / realtime / routers / admin`(连函数内导入也不行);`app/links/greeting_facts.py` 只被 `main.py` 调用 `install`。`app/admin/prompts_admin.py` 可导入 `app.agents.greeting.prompt`(admin → agents 已允许)。
- **隐私(根 `CLAUDE.md` + `app/links/CLAUDE.md` + `app/agents/CLAUDE.md`):** URL 里只有 id、`tz_offset_minutes`、`page`、`per_page`、布尔开关;**永远没有**词、问候文本、消息文本、用户 id。日志只记事件名、状态、来源(`llm|template`)、错误类名、毫秒数与计数:`timing event=chat_greeting status=... source=... lines=... ms=...`。不记用户 id、问候正文、事实里的词、人设文本、提示词正文。`chat_greetings.facts` 只存数字(词只在内存里拼提示词);问候正文存在 `chat_greetings.lines` 与 `messages`,与现有对话数据同等对待(删除用户时一起删)。
- **迁移:** 新迁移 `0023`(SQLite batch + Postgres 安全路径 + 往返测试);钉住 head `0022` 的 4 个测试文件改成 `0023`(`tests/test_migrations.py`、`test_changelog_models.py`、`test_library_models.py`、`test_library_catalog_models.py`,以 Task 0 的 grep 为准)。
- **删除用户:** 新表都有 `user_id` 外键 → 加进 `app/admin/users_admin.USER_ROWS`。
- **开关:** 新设置 `CHAT_HOME_ENABLED`(默认 `False`,关 = `/api/chat-home/*` 除 `config` 外 404,网页保持旧对话列表)。问候走 LLM 另有 `CHAT_GREETING_LLM_ENABLED`(默认 `True`;关 = 只用模板,零成本)。所有设置每次请求读(`get_settings` / `app.state.settings`),注册进 `app/core/settings_registry.py`(管理端可热改)。线上 `AGENTS_ENABLED` 已开(用户确认),但它可热改,代码仍按 R10 兜底。
- **提交:** conventional,一个任务一个提交(`feat(server): …`、`feat(admin): …`、`test(server): …`、`docs: …`),每个提交后本任务列出的测试全绿;只按路径 `git add`,**不要** `git add -A`(工作树里有大量用户未提交改动)。提交信息以空行 + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。
- **测试只跑本任务列出的:** `cd server && uv run pytest -q <文件>`;管理端 `yarn admin:typecheck && yarn admin:test`;全量套件、E2E、容器重建、部署只在用户要求时做。
- **上线后:** 功能合并、部署并验证后,按 `docs/CLAUDE.md` 起草 `docs/changelog/2026-10.json`(或当月)条目并提醒用户导入。

---

## §1 已商定设计(用户原话要点)

1. 对话首页 = 「主对话」入口:今天的默认对话置顶,[+ 新对话] 按钮,下方历史列表。
2. 每天 AI 主动问候,有仪式感,可带学习数据(连续天数、待复习词、昨天的错误)。问候在当天第一次打开 App 时由 AI 生成并缓存当天;同时作为当天默认对话的开头助手消息,用户可直接回复,AI 接着聊。
3. 设置:问候触发 = 每天首次一次 / 每次上线 / 关闭。
4. 默认对话**每天新建**(不是一条无限长的线程)。历史列表每条标日期(今天 / 昨天 / 2026-10-21 + 星期)。
5. 新对话:用户先建,再在对话右上角设置里选角色;当天默认对话的角色也能改(默认「学习伙伴」)。
6. 问候 / 对话辅助语言:中文、英文或双语同时输出,用户可切换。
7. 整个对话模块重新布局(整体重设计,不是打补丁),合理复用现有服务端对话 / 实时逻辑。
8. 前端问候体验(之后再细化):进入时弹出带动画的问候弹窗,几秒后自动消失回到主对话页。演示页由别人并行设计。

**2026-10-23 用户对原 §10 问题的答复(已并入下文裁定):**

9. 默认对话**不计入** 200 个对话上限;用户从没回复过的旧默认对话只在历史列表里**隐藏**,不删除(R11、R12)。
10. 当天首次打开时**一次 AI 调用**生成 **2–3 条**短问候(结构化输出;**已被第 21 条改为恰好 3 段**),全部存库,作为当天对话的前几条助手消息;「每次上线」模式在当天之后的打开里**重放同一组**问候,不再调用 AI(R4、R6、R8)。
11. AI 聊天回复不能是纯中文;「中文」选项 = 英文回复 + 中文提示即可;「双语」= 两者都给(R7)。
12. 「当天第一次登录」= 当天(用户本地日)第一次打开 App(R2、R8)。
13. 「学习伙伴」= 把现有内置角色「聊天伙伴」改名,不新增角色(R15)。
14. 线上 `AGENTS_ENABLED` 已开启;角色缺失时仍要安全回落(R10)。
15. 问候提示词 v1 就要在管理后台可编辑:存储、管理端接口与界面、校验(长度、必需占位符、安全默认、恢复默认)与测试(R14)。
16. UI:问候弹窗只显示问候文字(不显示助手名字 / 头像),学习数据以小字放在底部(§11)。

**2026-10-23 用户对剩余 4 个问题(原 Q5、N1–N3)的答复(已并入下文裁定):**

17. 问候触发设为「关闭」时,**仍然每天建当天的空默认对话**(数据里每天都有一条记录);不生成问候、不调用 AI(R8)。
18. 问候弹窗**只在对话主页(`/chat` 入口页)出现**;别的页面、深链(含 `/chat/:id`)都不弹(R8、§11)。
19. 「中文」模式下问候正文**纯中文**(问候不是学习内容,不夹英文词);聊天回复仍按第 11 条(英文 + 中文提示,R7)。
20. 「每次上线」模式的重放**只弹窗,不在当天对话里再追加**(问候在首次生成时已写入一次,R4、R8)。

**2026-10-23 用户批准演示页 v2(`docs/design/chat-home-demo-v2.html`),覆盖第 10 条的「2–3 条短问候」:**

21. 每天的问候**恰好 3 段**,每段 1–2 句、比原来的「短消息」更详细,三段分工固定:① 时段 / 星期(日期)+ 连续天数 + 一句暖心话;② 今天待复习的词数 + 昨天的错点(说清错在哪、对的是什么);③ 今天具体怎么练(给出时长与做法,如「先花 10 分钟用现在完成时讲三件事,再把待复习的词过一遍」)。三种语言模式都是 3 段:「中文」纯中文(不含任何拉丁字母,错点用中文描述);「English」纯英文;「中英双语」每段 = 英文主句 + 较短的中文副句(副句可以带 `have gone` 这类原词)。演示页用 `*…*` 标出每段 1–3 个强调词(数字、错点;演示页英文第 2 段就有 3 处),弹窗高亮显示(§5.1、R17)。某项数据缺失(还没有连续天数、没有待复习、昨天没出错)时照样 3 段,换说法而不是空着(§6.3)。

**2026-10-23 用户采纳网页计划 Q1–Q11 的推荐答案(已并入下文裁定与网页计划):**

22. 对话 `config` 的键一律 **snake_case**:服务端读写 `zh_note`、`agent_persona_id`(及 `DAILY_CONFIG_DEFAULTS` 的其他键),不写 `zhNote` / `agentPersonaId`——网页 `ApiClient` 保存前会把键转成 snake_case(R7、R10)。
23. v1 **不做**问候下的快捷回复胶囊;新对话选好角色后**不自动**出角色开场白(列为以后的任务,§11)。
24. 通话按钮留在顶栏、设置按钮旁(纯网页,服务端无改动)。
25. 历史抽屉按**最近活动日**(`updated_at` 的本地日)分组,与列表 `updated_at desc, id desc` 排序一致;今天的默认对话单独置顶、不再出现在分组里(R11)。
26. 设置面板加「问候里提学习数据」开关(`include_stats`);关闭时提示词不带任何学习数据、模板问候走无数据说法、返回的 `facts` 为空(R16)。
27. 「重播今天的问候」作为用户功能保留:只弹窗,不重新生成、不向对话追加(网页计划;服务端无新接口)。
28. 今天置顶的默认对话**可以删除**;下次 `POST /today`(网页删除后立即调用)按 R4 用已存问候重建,不调用 AI、不重新弹窗(R4)。
29. 单条消息复制 / 删除、手动改名**不在本次范围**,另立任务(§11)。
30. 保留问候里的强调高亮,契约见 R17(`*…*` 标记、允许集合、违规即去标记、网页安全渲染)。
31. 核对 §4 长度上限与 `max_tokens=600` 能容纳演示页三段(三种语言,最长填充),结论与数字见 §4 / §6.4;强调上限由 2 处改为 3 处(演示页英文第 2 段有 3 处)。

---

## §2 现状调查(写计划时读过的代码)

### 2.1 服务端

| 关注点 | 位置 | 现状 |
|---|---|---|
| 对话 / 消息表 | `server/app/models.py` `Conversation`(`id, user_id, name, config JSON, created_at, updated_at`)、`Message`(`role, content, assessment_id, grammar, agent_trace, created_at`) | 没有「类型」或「日期」列;角色、场景、难度、双语都放在 `conversations.config`(≤ 16 KB) |
| 对话 REST | `server/app/routers/conversations.py` | `GET/POST /api/conversations`(列表按 `updated_at desc, id desc` 分页,约 221 行,`per_page ≤ 50`;`POST /messages` 把 `conversation.updated_at` 设为最后一条的 `created_at`(约 370 行),`PATCH` 也刷新 `updated_at`(约 278 行)——所以 `updated_at` = 最近活动时间,§1 第 25 条的分组依赖它)、`GET/PATCH/DELETE /api/conversations/{id}`、`GET/POST /api/conversations/{id}/messages`(按 `created_at asc, id asc` 排序;批量 ≤ 10 条,`agent_trace` 只许助手消息,用户消息提交后发 `learning_events.MessageSent`)、`PATCH/DELETE /api/messages/{id}`。删除对话会显式删消息、导师会话、记忆线程状态(`drop_conversation`)与 chat 来源的评测录音 |
| 配额 | `app/core/config.py` `max_conversations=200`、`max_messages_per_conversation=1000`;`app/core/quotas.effective` 可按用户覆盖;计数只在 `create_conversation`(`conversations.py` 约 241 行,`count(*) where user_id`) | 用户裁定:默认对话不计入 → 计数加 `daily_date IS NULL`(R12)。`app/admin/service.py` 的对话统计是管理端展示,不改 |
| 旧对话路径 | `app/routers/ai_chat.py` `POST /api/chat/completions` | 透明 LLM 代理;没有角色时网页走这条 |
| 智能体对话 | `app/routers/agents.py`(`/api/agents/config`、personas CRUD、`settings`、`POST /turn` SSE)、`app/agents/orchestrator.py` `run_turn` / `deps_for` / `runtime(app)` | 有角色(网页类型 `ConversationConfig.agentPersonaId`;经 `ApiClient` 的 `decamelizeKeys` 落库为 `config.agent_persona_id`,服务端目前不读它,角色 id 随回合请求带上)时走这条;历史由客户端随请求带上(`TurnRequest.history`),所以存进 `messages` 的问候会自然进入下一回合的历史。`turn` 先 `owned_conversation(...)`(约 300 行,返回值目前丢弃),再 `agent_settings.load(session, user.id)`(用户级 `zh_note`)作为 `TurnRequest.agent_settings`;**目前没有对话级 `zh_note`**。线上 `AGENTS_ENABLED` 已开(用户确认) |
| 角色 | `app/agents/personas.py`:11 个内置角色 `builtin:*`,代码常量、不进表(`_builtins()` 约 227 行:`_builtin("partner", "聊天伙伴", ...)`,人设末尾 `ENGLISH_ONLY = "Reply in English only."`)+ 用户自建(`agent_personas`);`PersonaStore.get(user_id, id)` | 改名只改这一处元组(R15),无数据迁移。仓库里 `聊天伙伴` 只出现在这里与旧计划文档;联机房间 `@名字` 路由(`app/rooms/agent_mentions.py`)按角色名匹配 → 改名后房间里要写 `@学习伙伴`;导师快照里的 `persona_name` 是运行时副本,进行中的那一轮仍显示旧名 |
| 用户级智能体设置 | `app/agents/settings.py`(`agent_user_settings` 一行 JSON,写时严格,未知键报错;`AgentSettings` frozen dataclass):`default_persona_id`、`zh_note (auto/always/never)`、工具开关等 | 不宜塞进新键(严格校验 + 属于 agents 设置页);新开 `chat_prefs` |
| 回复语言 | `app/agents/lang.py`:聊天模式下 `MarkerFilter → SentenceGate` 会**拿掉含中文的句子**,中文只经 `note_zh`(≤ 80 字)出现;`orchestrator.py` 约 353 / 417 行按 `agent.zh_note` 决定 | 用户裁定:聊天回复不需要纯中文,「中文」= 英文 + 中文提示(`zh_note=always`),管线不改(R7) |
| LLM 调用 | `app/providers/llm.py` `complete(http, settings, messages, *, model, max_tokens, temperature, timeout)`(非流式,自动计量,失败抛 `LlmUnavailable(kind)`,kind ∈ `config / network / http / format / empty`);**没有 `response_format` 参数** | 「结构化输出」= 提示词要求只输出 JSON + 服务端严格解析(§6.2),不改 `llm.py`;先例 `app/wordbook/explain.py` |
| 提示词安全 | `app/agents/prompt.py` `SAFETY_PREAMBLE`、`escape()` | 复用:人设与词进提示词前 `escape` |
| 每日额度 | `app/services/usage.consume/refund`(`daily_usage` 表,按 scope + subject + 日);`app/agents/limits.py` 的 scope 常量 | 新 scope `chat_greeting`(每人)与 `chat_greeting_global` |
| 管理端设置的两种存法 | ① `app/core/settings_registry.py` + `app/admin/settings_service.py`:标量运行时设置(int / bool / str,热改);② `app/services/prompts.py` `PROMPTS: dict[str, PromptSpec]`(`required` / `optional` 占位符、`boundaries`、`max_chars`、`sample_fields`)+ `prompt_versions` 表(草稿 → 发布,`config_revisions['prompts']` 多进程失效)+ `PromptCache` / `prompt_cache(app)`;`validate_prompt` 返回错误码(`empty / too_long / invalid_braces / missing_fields:… / unknown_fields:… / missing_boundary:…`) | 提示词正文属于 ②(R14),先例 `wordbook.explain`:`DEFAULT_EXPLAIN_TEMPLATE` + `render_test` + 发布版本坏了回落默认并只记 `warning`(不记正文) |
| 管理端提示词接口 | `app/routers/admin_prompts.py`:`GET /api/admin/prompts`、`GET /prompts/{key}`(含 `default_body`)、`POST/PUT/DELETE /prompts/{key}/draft`(`DraftCreateIn.from_version`)、`POST /prompts/{key}/draft/publish`(需 step-up + reason + etag)、`POST /prompts/{key}/test`;`app/admin/prompts_admin.py` `default_body(app, key)`、`test_messages(app, key, body, sample)`、`create_draft(..., from_version)` | **没有「恢复默认」**:回滚只能「以旧版本新建草稿」,没发布过时新建草稿会取默认正文;发布后想回到代码默认只能手抄 `default_body`。R14 加 `from_default` |
| 管理端提示词界面 | `admin/src/features/prompts/`(`prompts-page.tsx`、`prompt-editor-page.tsx`、`placeholder-checklist.tsx`、`test-run-panel.tsx`、`strings.ts` 的 `sampleLabels`) | 按 `spec_out` 通用渲染,新键自动出现;要补试运行样例字段的中文标签与「恢复默认」按钮 |
| 提示词键钉子 | `tests/test_prompts.py` 约 70 行 `assert set(PROMPTS) == {...}` | 新键要加进去(以 Task 0 grep 为准,管理端测试也可能数键) |
| 学习数据:连续天数 | `app/services/stats.py` `streak()`、`local_date()`、`local_midnight_utc()`;`/api/stats` 按「有用户消息或评测的本地日」算 | 直接复用这几个纯函数 |
| 学习数据:待复习 | `VocabularyItem.due_at <= now`(`app/links/agent_sources.DueWords` 同查询);背单词计划 `app/wordbook/service.today_out`(需词典索引) | 前者 agents 层可读;后者只能在 links 层(R3) |
| 学习数据:昨天的错误 | `LinkMistakeWord.last_wrong_at`(背单词答错,links 表;联动从未开过则为空)、`Message.grammar`(用户消息的语法结果,`stats.grammar_categories`)、`Assessment.result`(`stats.poor_words`,发音差的词) | 都是 models 里的表,agents 层可读 |
| 实时通话 | `app/realtime/*`、`app/routers/realtime.py`:票据绑定 `(user_id, conversation_id)`,`DbMessageStore` 按 `POST /messages` 同规则存消息 | 默认对话就是普通对话,通话照旧可用,不需改动 |
| 学习事件 | `app/core/learning_events.py`:只对**用户**消息发 `MessageSent` | 问候是助手消息,不触发段位 / 联动,不影响连续天数统计(只算用户消息与评测) |
| 删除用户 | `app/admin/users_admin.py` `USER_ROWS` | 新表要加 |
| 路由顺序 | `app/main.py` 第 121–140 行:真实 API 在 `stubs` 之前 | `chat_home` 放 `agents` 之后、`stubs` 之前 |
| 迁移 | `server/alembic/versions/` 线性,head `0022_curated_catalog` | 新增 `0023` |

### 2.2 网页(只为大纲)

- 路由 `web/src/app.tsx`:`/chat` → `ConversationsPage`,`/chat/:id` → `ConversationPage`(懒加载)。
- `web/src/features/chat/conversations-page.tsx`(列表,`formatDateTime`,经典 / 液态玻璃两套皮肤,`ConversationListLiquid`)、`scenario-sheet.tsx`(新建时选场景)、`conversation-page.tsx`(1425 行,编排)、`conversation-settings-sheet.tsx`(右上角设置:场景、难度、语音、双语、语法……)、`conversation-header-actions.tsx`。
- `chat-api.ts` 的 `ConversationConfig`:`agentPersonaId`(有值走 `/api/agents/turn`)、`bilingual`、`level`、`scenario`、`recap`……(网页侧 camelCase;`web/src/api/client.ts` 发送时 `decamelizeKeys(..., { deep: true })`、接收时 `camelcaseKeys`,所以**落库的键是 snake_case**:`agent_persona_id`、`auto_speak`、`tts_model`;`conversation-page.agent.test.tsx`「writing only agent_persona_id」钉住。服务端写入 config 也必须用 snake_case,§1 第 22 条)
- 角色选择组件已有:`web/src/features/agents/persona-picker.tsx`、`persona-chip.tsx`、`agent-settings-page.tsx`。网页里没有写死「聊天伙伴」(角色名来自服务端)。
- 时区约定:`web/src/features/progress/stats-api.ts` `tzOffsetMinutes()` → `tz_offset_minutes`(−720…840)。
- 分层由 `web/src/architecture.test.ts` 约束(跨 feature 基线冻结);液态玻璃规则见 `web/CLAUDE.md`。

---

## §3 本计划的裁定

- **R1 每日默认对话 = 普通对话 + `daily_date`。** `conversations` 加可空 `daily_date DATE` 与 `UniqueConstraint(user_id, daily_date)`(NULL 在 SQLite / Postgres 的唯一约束里互不冲突,无需部分索引)。普通对话 `daily_date IS NULL`。默认对话的消息、回合、通话、删除全部走现有接口。
- **R2 用户本地日 = 「当天第一次打开 App」。** 网页在 App 启动(任何路由)与从后台回到前台时调 `POST /api/chat-home/today`(建当天对话、预先生成问候,缩短进入对话主页时的等待;**是否弹窗另由 R8 只在对话主页决定**),带 `tz_offset_minutes`(沿用 `/api/stats` 约定与取值范围);服务端 `local_date(utcnow(), offset)` 决定「今天」。不看密码登录 / 会话续期。同一用户一天一个默认对话、一组问候(唯一约束保证幂等)。换时区导致的「多一天 / 少一天」接受,不做纠正(§9 K4)。
- **R3 学习数据来源。** `app/agents/greeting/facts.py` 定义 `GreetingFacts`(数字 + 最多 3 个词;「昨天的错点」原文对 `slip_wrong → slip_right` 也算进这 3 个词的额度)与来源协议 `FactSource(key, async load(ctx) -> dict | None)`、注册表 `facts_registry(app)`;内置来源(agents 层可读的表):`streak`(stats 规则)、`due_vocab`(`VocabularyItem`)、`yesterday_grammar`(昨天用户消息的语法类别计数 + 最常见类别 `slip_category` + 该类别里最近一处改正的原文对 `slip_wrong` / `slip_right`,各 ≤ 16 字符(更长的改正不取原文,只给类别与次数),只在内存里、只给 `en` / `bilingual` 用,R7)、`yesterday_pron`(昨天评测的差词)、`yesterday_wrong`(`LinkMistakeWord` 昨天答错)。需要词典的 `wordbook_today`(今天背单词计划里的复习数、背单词连续达标天数)放 `app/links/greeting_facts.py`,`main.py` 在 `install_agent_sources(app)` 下一行 `install_greeting_facts(app)`。每个来源自己开会话、只读、逐源超时 300 ms、总预算 600 ms,超时 / 异常 → 跳过(只记来源键与异常类名)。不受 `LINKS_ENABLED` 控制(与 R-A1 一致)。
- **R4 一次生成多行、缓存当天、可复原。** 新表 `chat_greetings`,唯一 `(user_id, local_date)`;`lines` JSON 数组保存**恰好 3 条**问候(§1 第 21 条),每条 `{"en"?: str, "zh"?: str}`(按语言给一个或两个键,§4),外加来源(`llm|template`)、语言、角色 id、事实数字、提示词版本、状态、`message_ids`(与 `lines` 一一对应)。每条写成一条 `Message(role="assistant")`,`created_at` 依次 +1 ms 保证顺序(列表按 `created_at, id` 排)。**复原只看对话是否换了:** `chat_greetings.conversation_id` 外键 `ON DELETE SET NULL`(且 `delete_conversation` 显式置空,见 S9);当天再进入时若 `conversation_id` 为空或不等于今天的默认对话 → 把缓存的全部 `lines` 原样写回新对话,不再调用 LLM。用户在原对话里单独删掉某条问候消息 → 尊重删除,不写回。**写回只在对话换了时发生;`every_open` 的重放永远不追加消息**(用户裁定,R8)。**删除今天的默认对话(用户裁定,§1 第 28 条):** 允许;`delete_conversation` 置空 `conversation_id` 后,下一次 `POST /today`(网页删除成功后立即调用,不算一次「打开」)新建当天对话(新 id)并写回全部 `lines`,不调用 LLM、不动额度;`first_seen_at` 保留,所以 `daily` 不会因此再弹一次。`off` 的日子只重建空对话。用户在被删对话里的回复随对话删除,不恢复。
- **R5 同时请求的认领。** 第一条请求插入 `status=pending` 行(插入失败 = 别人在做);输家返回 `{"status":"pending"}`,客户端 1.5 s 后重试,最多 4 次。`pending` 超过 60 s(进程崩溃)可被带 `updated_at` 守卫的 `UPDATE` 重新认领。`lines` 与 `message_ids` 在置 `ready` 的同一事务里写入,读者永远看不到半组问候。
- **R6 成本上限。** 每人每天最多 **1 次** LLM 调用(`usage.consume("chat_greeting", user, day, 1)`),一次调用产出全部 3 行;全站每天上限 `CHAT_GREETING_GLOBAL_DAILY`(默认 2000);`max_tokens=600`(双语 3 行的上限,估算见 §6.4),`temperature=0.8`,超时 `CHAT_GREETING_TIMEOUT_SECONDS`(默认 6)。任何失败(无上游配置、额度用尽、超时、HTTP 错误、输出不合格)→ **3 段模板问候**(§6.3),`source=template`,当天不再重试(问候已进对话,保持一致)。上游失败时退还每人额度(没有内容送达,与 agents 的退还口径一致)。「每次上线」触发**不会**重新生成,只重放已存的 `lines`(R8)。管理端当天发布新提示词也不重新生成当天已存的问候。
- **R7 语言。** 设置 `language ∈ {zh, en, bilingual}`(默认 `bilingual`)。**问候:** 模型一律输出 JSON `{"lines": [...]}`;`en` → 每行只有 `en`;`zh` → 每行只有 `zh`,**正文纯中文、不含任何拉丁字母**(用户裁定:问候不是学习内容;所以 `zh` 模式下提示词的事实块不放任何词,只放数字与中文的错点类别描述,`sample_review_word` / 差词 / `slip_wrong` / `slip_right` 一律省略,§6.1;解析器拒收含拉丁字母的 `zh` 行,§6.2);`bilingual` → 每行同时有 `en`(主句)与 `zh`(较短的中文副句,可带错点原词),存进消息为「英文 + 空行 + 中文」(朗读层 `speechText` 已会跳过中文)。接口返回拆开的 `lines` 给弹窗(§5.1)。**后续聊天回合(用户裁定:不需要纯中文,管线不改):** `en` → 不加提示;`zh` → 英文回复 + 中文提示(`zh_note=always`);`bilingual` → 英文回复 + 中文提示 + 现有自动翻译(`zh_note=always` 且 `config.bilingual=true`)。实现:默认对话的 `config` 写入可选键 `zh_note`(`always`,`en` 时不写);**config 键一律 snake_case**(用户裁定 §1 第 22 条:网页 `ApiClient` 保存前把键转成 snake_case,若服务端写 `zhNote`,网页第一次 `PATCH` config 就会把它改成 `zh_note`,服务端从此读不到)。`POST /api/agents/turn` 用 `owned_conversation` 的返回值,若 `config.zh_note ∈ {auto, always, never}` → `dataclasses.replace(agent, zh_note=...)` 覆盖用户级设置(只影响该对话;键缺失 / 非法 = 沿用用户设置;camelCase 的 `zhNote` 不认)。旧路径(无角色)只用 `config.bilingual`。用户当天改语言:写 `chat_prefs`(影响以后每天),网页另用现有 `PATCH /api/conversations/{id}` 改今天对话的 `zh_note` / `bilingual`(网页类型里叫 `zhNote`,请求体自动成 `zh_note`);今天已存的问候不重写。
- **R8 触发设置。** `greeting_trigger ∈ {daily, every_open, off}`(默认 `daily`)。「打开」= App 冷启动,或从后台回到前台且隐藏 ≥ 30 min(网络断开重连 `online` 事件**不算**)。
  - **弹窗只在对话主页(用户裁定):** 只有当前路由是对话主页入口 `/chat` 时才弹;其他页面、深链(含 `/chat/:id`、背单词深链)都不弹。若「打开」发生在别的页面,客户端记一个「本次打开待弹」标记,用户在这次打开期间第一次进入 `/chat` 时再弹(`daily` 另需 `first_view=true`);标记随下一次「打开」重置,不持久化。弹窗关闭后停留在对话主页。服务端不感知路由,只返回 `first_view`。
  - `daily`:服务端 `chat_greetings.first_seen_at` 为空时 `first_view=true`(跨设备只弹一次),客户端在对话主页弹窗**出现时**调 `seen` 置位(网页计划 FR10);当天没进过对话主页 = 当天不弹(问候仍在默认对话里)。
  - `every_open`:每次「打开」后第一次进入对话主页都弹出当天**同一组**已存问候;服务端只返回已存 `lines`,不调用 LLM,**也不向对话追加消息**(用户裁定;问候首次生成时已写入一次)。
  - `off`:不生成问候、不调用 AI、不弹窗;**默认对话仍每天在打开时创建**(空对话,用户裁定),所以每天都有一条默认对话记录;它在列表里的显隐按 R11(用户没回过的旧默认对话隐藏但保留)。
- **R9 模型。** `CHAT_GREETING_MODEL`(空 = `resolved_agents_model`,再空 = `default_llm_model`),在 `Settings` 加 `resolved_chat_greeting_model` 属性。
- **R10 角色与兜底。** `chat_prefs.daily_persona_id`(默认 `builtin:partner`,即「学习伙伴」)决定**以后每天**新建默认对话的 `config.agent_persona_id`(snake_case,§1 第 22 条);改当天对话的角色 = 现有 `PATCH /api/conversations/{id}`(改 config)。角色找不到(被删 / 被禁用 / id 格式坏)→ 回落 `builtin:partner`,并把 `chat_prefs.daily_persona_id` 留原值(不静默改写用户设置);`builtin:partner` 也取不到(防御性,理论不发生)→ 问候用无角色的中性语气、对话不写 `agent_persona_id`。线上 `AGENTS_ENABLED` 已开;若被热关,默认对话不写 `agent_persona_id`(走旧路径),问候仍用角色的名称与简介做语气参考。
- **R11 列表(只隐藏,不删除)。** `conversation_out` 增加 `daily_date`(ISO 日期或 `null`,增量字段)。`GET /api/conversations` 增加 `hide_idle_daily: bool = false`:为真时隐藏「不是今天、且没有用户消息」的默认对话(只有问候、用户没回的日子);数据保留,没有定时清理任务。网页新首页总是传 `true`。**排序与分组(用户裁定 §1 第 25 条):** 列表保持 `updated_at desc, id desc`(现状,补一条稳定分页的测试);网页按 `updated_at` 的**本地日**分组(最近活动日,与排序一致,同一组不会被拆散),组标题 = 今天 / 昨天 / 日期 + 星期;默认对话行的标题另显示它自己的 `daily_date`(「每日对话 · 10月21日 周三」),所以昨天的默认对话今天被回复后会出现在「今天」组里、仍看得出是哪天的。**今天置顶规则:** 今天的默认对话由 `POST /today` 提供、在抽屉顶部单独置顶,网页按 id 把它从分组列表里去掉(服务端列表不特殊处理它,`hide_idle_daily` 对今天的默认对话永不隐藏)。`updated_at` 的刷新点:写消息(含问候写入 / 写回)、`PATCH` 对话(改设置也算活动,接受)。
- **R12 配额(用户裁定:默认对话不计入)。** `create_conversation` 的计数改为 `user_id = :u AND daily_date IS NULL`;`ensure_today` 建默认对话时不做 `max_conversations` 检查(每人每天最多 1 个,唯一约束保证)。`max_messages_per_conversation` 对默认对话照常生效(问候 3 条计入)。管理端对话统计(`app/admin/service.py`)照常包含默认对话。
- **R13 隐私测试钉住路由表。** 新增 `tests/test_chat_home_privacy.py`:遍历 `/api/chat-home/*` 路由,断言路径参数只有 id、查询参数只在白名单(`tz_offset_minutes`);跑一次完整生成(假上游,含词的事实,已发布的自定义提示词),收集 `app` 日志,断言没有问候正文、词、用户 id、人设文本、提示词正文。
- **R14 问候提示词可在管理后台编辑(v1)。** 存储沿用版本化提示词通道,不新建表、不进 `settings_registry`(那里只放标量):
  - `PROMPTS["chat.daily_greeting"] = PromptSpec(key, "对话每日问候", "text", required={"language_rule", "facts"}, boundaries=("<facts>", "</facts>"), max_chars=4000, sample_fields=("persona", "language", "facts"), optional={"persona"})`。
  - 代码默认 `DEFAULT_GREETING_TEMPLATE`(`app/agents/greeting/prompt.py`,§6.1 全文);`prompts_admin.default_body` 返回它;默认正文 ≤ 2500 字(给管理员留余量,测试钉住)。
  - **固定部分不可编辑:** `SAFETY_PREAMBLE` 前缀与「输出 JSON 契约」后缀(§6.1,含「恰好 3 项」、三段分工、按语言的单段 / 合计长度上限与纯中文规则)由代码追加,管理员改不掉,所以编辑提示词不会破坏解析、长度与安全规则(与 `grammar.rules`「输出格式由服务端固定追加」同一做法)。管理员可编辑的是语气、内容取舍与写法;即使管理员在模板里写「写 5 段」「每段 100 词」,契约后缀与解析器(§6.2)仍按 3 段与 §4 上限执行,不合格 → 模板问候。
  - **校验:** 发布前走现有 `validate_prompt`(空、超 4000 字、花括号、缺 `{language_rule}` / `{facts}`、未知占位符、缺边界标签 → 不能发布);运行时 `service.generate` 经 `prompt_cache(app).get(...)` 读已发布版本,再跑一次 `validate_prompt`,不合格或 `format` 抛错 → 用代码默认并记 `published prompt ignored key=chat.daily_greeting reason=invalid`(不记正文)。渲染后的 `{facts}` ≤ 600 字、`{persona}` ≤ 300 字(代码截断),固定输出契约后缀 ≤ 1200 字,整条请求 ≤ 7000 字(4000 模板 + 前缀 + 契约 + 事实 + 角色的上限之和,测试钉住)。
  - **恢复默认:** `POST /api/admin/prompts/{key}/draft` 的 `DraftCreateIn` 加 `from_default: bool = False`(与 `from_version` 同时给 → 422),草稿正文 = `default_body(app, key)`;审计 `after={"from_default": true}`;再走现有发布流程(step-up + reason)。对所有键通用。
  - **试运行:** `prompts_admin.test_messages` 加 `key.startswith("chat.")` 分支 → `greeting.prompt.render_test(body, sample)`,模型 `resolved_chat_greeting_model`;样例与输出不保存(现有规则)。
  - `chat_greetings.prompt_version` 记录生成时用的已发布版本号(`null` = 代码默认 / 模板)。
- **R15 「学习伙伴」= 改名。** `personas._builtins()` 里 `builtin:partner` 的名称 `聊天伙伴 → 学习伙伴`;id、简介、人设、风格不变;无数据迁移(内置角色不进表)。影响:联机房间里 `@聊天伙伴` 不再匹配,要写 `@学习伙伴`(写进 changelog 草稿);用户自建角色若恰好也叫「学习伙伴」,`@` 路由按现有「最长优先 + 稳定顺序」处理,不额外处理。
- **R16 「问候里提学习数据」开关(用户裁定 §1 第 26 条)。** `chat_prefs.include_stats`(bool,默认 `true`,§4),网页设置面板「问候时机」一节末尾的开关经 `PATCH /settings {include_stats}` 写入。
  - **生成时为 `false`:** `ensure_today` **不调用** `facts.gather`(零事实查询);提示词 `{facts}` 只有 `local_date` / `time_of_day` / `focus_hint: free_talk` / `practice_minutes`,不出现连续天数、待复习、错点、任何词(§6.1);LLM 失败时模板走 `include_stats=false` 的三行(§6.3);`chat_greetings.facts = {}`。
  - **读取时为 `false`(当天生成后才关):** `POST /today` 返回的 `greeting.facts` 一律 `{}`(弹窗底部数据行立即消失);已存的 `lines` 不重写(与 R7「今天已存的不重写」一致,明天起正文才不提数据)。读取时为 `true` 而当天生成时为 `false` → 仍返回存下的 `{}`。
  - `every_open` 重放同样按读取时规则过滤 `facts`。
- **R17 强调标记契约(用户裁定 §1 第 30 条)。** `lines` 里的强调只用一种标记:**单星号 `*…*`**(演示页 `richText` 同款)。规则(`app/agents/greeting/parse.py` 的 `normalize_marks`,模板与解析共用;网页 `home/emphasis.ts` 按同一规则解析):
  - 先把 `**x**` 规范成 `*x*`;合法标记 = 成对、不嵌套、内容 1–24 字符、内容不含 `*`、换行、`<`、`>`;每条至多 **3** 处(演示页英文第 2 段:`*12 words*`、`*have went*`、`*have gone*`)。
  - **任何违规**(不成对、嵌套、空、超 24 字符、超过 3 处)→ 去掉**该条**全部 `*`,该条仍合格(强调是装饰,不因它丢掉整组问候)。所以存库的 `lines` 只可能是「纯文本」或「纯文本 + 1–3 处合法 `*…*`」,不会有落单的 `*`。
  - 除此之外没有任何标记语言:不支持 Markdown、HTML、链接;解析器去掉 `#` / 列表前缀,含 `<` `>` 的行判不合格(§6.2)。
  - `messages.content` 写入去掉标记后的正文(现有气泡、朗读、翻译不认识它);长度按去标记后计(§4)。
  - 网页只用 `lines` 渲染强调,并且**不使用 `dangerouslySetInnerHTML`**:解析成 `{text, em}` 片段后以 React 文本节点 + `<em>` 渲染(网页计划 FR12、FR19)。契约夹具里的 `lines` 带强调,网页契约测试用同一夹具校验。

---

## §4 数据模型与迁移 `0023`

```python
# server/app/models.py(片段)
class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (UniqueConstraint("user_id", "daily_date", name="uq_conversations_user_daily_date"),)
    ...
    daily_date: Mapped[date | None] = mapped_column(Date, nullable=True)  # 计划 2026-10-23 R1:每日默认对话的本地日


class ChatGreeting(Base):
    """每日问候(计划 2026-10-23 R4):每人每个本地日一行、恰好 3 条问候;facts 只存数字。"""
    __tablename__ = "chat_greetings"
    __table_args__ = (UniqueConstraint("user_id", "local_date", name="uq_chat_greetings_user_local_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    local_date: Mapped[date] = mapped_column(Date)
    conversation_id: Mapped[str | None] = mapped_column(ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True)
    message_ids: Mapped[list] = mapped_column(JSON, default=list)  # 与 lines 一一对应;不设外键:消息可被单独删除
    status: Mapped[str] = mapped_column(String(8))          # pending / ready
    source: Mapped[str | None] = mapped_column(String(8), nullable=True)  # llm / template
    language: Mapped[str] = mapped_column(String(10))       # zh / en / bilingual
    persona_id: Mapped[str] = mapped_column(String(64))
    lines: Mapped[list] = mapped_column(JSON, default=list)  # [{"en": "...", "zh": "..."}, ...] 恰好 3 条,键随语言;保留 *强调* 标记
    prompt_version: Mapped[int | None] = mapped_column(Integer, nullable=True)  # R14;null = 代码默认或模板
    facts: Mapped[dict] = mapped_column(JSON, default=dict)  # {"streak": 5, "due": 12, ...} 只有数字
    error_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)  # LlmUnavailable.kind / quota / invalid
    first_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ChatPrefs(Base):
    """对话主页的用户设置(一行 JSON,逐键校验在 app/agents/greeting/prefs.py)。没有行 = 默认值。"""
    __tablename__ = "chat_prefs"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
```

`lines` 的不变式(`app/agents/greeting/parse.py` 与 `templates.py` 都产出、`service` 写库前用 `check_lines` 再断言一次):`len == 3`(顺序即三段分工:① 开场 ② 复习与错点 ③ 今天怎么练);`en` 语言每条恰有 `en`,`zh` 恰有 `zh`,`bilingual` 两个都有。长度按「去掉 `*` 标记、合并空白后」的字符数计(数值取自演示页 v2 实测再留余量:演示页 `zh` 三段 35 / 49 / 43 字、合计 127;`en` 107 / 99 / 115 字符、合计 321,约 58 词;双语中文副句 21 / 38 / 28、合计 87)。

**容量核对(2026-10-23,§1 第 31 条;按演示页 `TODAY_GREETING` 三段原文逐字计算,未调用真实上游):** 最长填充 = 「下午好 / Good afternoon」+「周三 / Wednesday」+ 连续 9999 天 + 待复习 9999 + 每边 16 字符的错点原文对 + 去掉用户名(v1 不发送用户名,§6.1):`zh` 37 / 51 / 43、合计 131(上限 60 / 160,单段余量 ≥ 15%);`en` 110 / 115 / 115、合计 340(上限 160 / 420,约 55 词);双语副句 23 / 54 / 28、合计 105(上限 60 / 130)。三种语言都放得下,**上限不改**;句数(每段 ≤ 2)也都满足。唯一不满足的是强调数:演示页英文第 2 段有 3 处 `*…*`,原上限 2 处 → **改为 3 处**(R17)。网页计划引用同一组数字。

| 语言 | 字段 | 每条下限 | 每条上限 | 合计上限 |
|---|---|---|---|---|
| `zh` | `zh` | 12 字 | 60 字 | 160 字 |
| `en` | `en` | 30 字符 | 160 字符(约 30 词) | 420 字符(约 75 词) |
| `bilingual` | `en` | 30 字符 | 160 字符 | 420 字符 |
| `bilingual` | `zh`(副句) | 8 字 | 60 字(含错点原词) | 130 字 |

- 下限保证「详细」而不是一句「早上好」;每条至多 2 句(按 `。！？.!?` 计,句末省略号算一句),超过 → 不合格。
- **强调标记(R17):** 每条至多 3 处 `*…*`,成对、不嵌套、标记内 1–24 字符且不含 `*` / 换行 / `<` / `>`;`**x**` 先规范成 `*x*`;任何违规 → 去掉该条全部 `*`(不判不合格)。`lines` 保留合法标记供弹窗高亮(§5.1);写进 `messages.content` 时去掉标记(现有气泡与朗读不认识它)。
- `zh` 语言:`zh` 不得含拉丁字母(半角 `[A-Za-z]` 与全角 `[Ａ-Ｚａ-ｚ]`;阿拉伯数字、`→`、中文标点允许),纯中文(R7)。
- `bilingual`:每条**必须同时**有 `en` 与 `zh`,`en` 不含中文字符,`zh` 至少含 6 个中文字符(可以带错点原词这类拉丁字母,不受纯中文限制)。
- 消息正文 = `en` / `zh` / `en + "\n\n" + zh`(均已去标记)。

`greeting_trigger=off` 的日子有 `conversations`(`daily_date` 非空)而**没有** `chat_greetings` 行(R8)。

问候提示词**不在本迁移里**:它存在现有 `prompt_versions` 表(R14),新键无需迁移。

迁移 `server/alembic/versions/0023_chat_home.py`(`down_revision = "0022"`):
- `op.batch_alter_table("conversations")`:`add_column(daily_date Date nullable)` + `create_unique_constraint("uq_conversations_user_daily_date", ["user_id", "daily_date"])`(SQLite 走 batch 重建,Postgres 直接 ALTER)。
- `create_table("chat_greetings", …)`(查询走唯一约束的索引,不另建);`create_table("chat_prefs", …)`。
- `downgrade`:先删两张表,再 batch 删约束与列。
- 往返测试:`upgrade 0023 → downgrade 0022 → upgrade head`,并插入两条 `daily_date=NULL` 的同用户对话证明 NULL 不冲突、两条相同 `daily_date` 冲突;`lines` / `message_ids` JSON 往返。

`chat_prefs.data` 键(`app/agents/greeting/prefs.py`,读时丢弃坏键,写时严格):

| 键 | 值 | 默认 |
|---|---|---|
| `greeting_trigger` | `daily` / `every_open` / `off` | `daily` |
| `language` | `zh` / `en` / `bilingual` | `bilingual` |
| `daily_persona_id` | `personas.ID_RE` 匹配的 id | `builtin:partner` |
| `include_stats` | bool(问候里是否提学习数据,R16) | `true` |

---

## §5 服务端接口

全部在 `app/routers/chat_home.py`,`router = APIRouter(prefix="/api/chat-home")`,登录即可(`current_user`;生成接口用 `limited_user`)。错误体 `{"error": ...}`。

| 方法 + 路径 | 体 / 查询 | 返回 |
|---|---|---|
| `GET /config` | — | `{"enabled": bool, "llm": bool}`(开关关时也返回,供网页决定用新首页还是旧列表) |
| `GET /settings` | — | `chat_prefs` 全部键(含默认值) |
| `PATCH /settings` | JSON 部分键 | 新设置;非法 → 422 `{"error":"invalid", "field": "<键名>"}` |
| `POST /today` | `{"tz_offset_minutes": int, "client_request_id": uuid}` | 见下 |
| `POST /greetings/{greeting_id}/seen` | — | `{"first_seen_at": iso}`(幂等,只能置一次) |

管理端(R14,现有路由的增量):`POST /api/admin/prompts/{key}/draft` 体加 `from_default: bool`。

`POST /today`(用 POST:有副作用,且请求体不进访问日志):

```json
{
  "local_date": "2026-10-23",
  "status": "ready",                 // ready / pending / off
  "conversation": { ...conversation_out, "daily_date": "2026-10-23" },
  "greeting": {
    "id": "…", "message_ids": ["…", "…", "…"], "source": "llm", "language": "bilingual",
    "generated_at": "2026-10-23T00:42:10Z",
    "lines": [{"en": "…", "zh": "…"}, {"en": "…", "zh": "…"}, {"en": "…", "zh": "…"}],
    "facts": {"streak": 23, "due": 12, "yesterday_mistakes": 2},
    "first_view": true
  }
}
```

(原 `conversation_error: "limit"` 去掉:默认对话不受对话数上限约束,R12。)

### 5.1 前端契约(网页弹窗与今天对话消费的形状)

`tests/fixtures/chat_home_contract.json` 钉住,网页 `chat-home-api.ts` 的契约测试读同一夹具(§7、§11)。

```ts
type ChatHomeToday = {
  local_date: string;                       // "YYYY-MM-DD",用户本地日;弹窗顶部日期行由客户端本地化(演示页「10月23日 · 周五」)
  status: "ready" | "pending" | "off";      // pending → 1.5 s 后重试,最多 4 次(R5);off → greeting 为 null,不弹
  conversation: ConversationOut & { daily_date: string };
  greeting: null | {
    id: string;                             // 弹窗出现时 POST /greetings/{id}/seen(R8;网页计划 FR10)
    message_ids: string[];                  // 长度 3,与 lines 一一对应;用户单独删过的那条仍是原 id,网页在对话里找不到就跳过
    source: "llm" | "template";             // 只供调试 / 管理端,弹窗不区分
    language: "zh" | "en" | "bilingual";    // 生成时的语言;演示页设置里的 "both" = "bilingual"
    generated_at: string;                   // ISO UTC;对话里「今日问候 · 08:42」的时间
    lines: [GreetingLine, GreetingLine, GreetingLine];   // 恰好 3 条,按序显示
    facts: { streak?: number; due?: number; yesterday_mistakes?: number };  // 底部小字;缺键 = 不显示该项
    first_view: boolean;                    // daily:true 才弹;every_open 忽略它(R8)
  };
};
type GreetingLine = { en?: string; zh?: string };
```

- **按语言渲染:** `zh` → 每行显示 `zh`;`en` → 显示 `en`;`bilingual` → `en` 为主句、`zh` 为下方小字副句(演示页 `.gl` + `.gl-sub`)。第 1 条是大字 lead 行。客户端不重新组句、不翻译、不截断(长度已由服务端保证,§4);放不下时按演示页 `fitGreeting` 缩字号。
- **强调(R17):** 文本里合法的 `*…*`(每条 ≤ 3 处,内容 1–24 字符)渲染为 `<em>`(演示页 `richText`);服务端保证不会有落单的 `*`,网页解析器仍按 R17 同一规则防御(违规 → 整条去 `*` 当纯文本)。只用 React 文本节点渲染,不用 `dangerouslySetInnerHTML`;做无障碍文本 / 朗读 / 飞入克隆时去掉 `*`。
- **`facts`:** 只有数字;`include_stats=false`(生成时或读取时,R16)或来源全部缺失 → `{}`,底部数据行整行不显示;某项缺失(如还没有连续天数)→ 只隐藏该项。弹窗正文不依赖 `facts`(正文已写好)。
- **今天对话里的问候气泡:** 就是 `message_ids` 对应的 3 条普通助手消息(正文无标记)。网页按 `message_ids` 匹配后用 `lines` 渲染可见文字(带强调,演示页同款);匹配不上或去标记后与消息正文不一致 → 直接显示消息正文。气泡动作(朗读 / 翻译 / 跟读 / 查词)始终用消息正文(网页计划 FR12)。
- **长度(§4):** `zh` 每段 12–60 字、合计 ≤ 160;`en` 每段 30–160 字符、合计 ≤ 420;双语 `en` 同 `en`、`zh` 副句每段 8–60 字、合计 ≤ 130;每段 ≤ 2 句、≤ 3 处强调。网页按这些上限设计排版与 `fitGreeting` 缩放下限。
- **兼容:** 新增字段只增不改;未知字段忽略。`language` 与当前设置不一致(用户当天改了语言)时,弹窗仍按 `greeting.language` 显示当天已存的问候(R7:今天已存的不重写)。

服务流程 `app/agents/greeting/service.py` `ensure_today(deps, user, offset, now)`:
1. 读 `chat_prefs`;算 `day = local_date(now, offset)`。
2. **对话:** 查 `Conversation(user_id, daily_date=day)`;没有 → 直接插入(不查 `max_conversations`,R12;`name` = `"2026-10-23"`,网页按本地化显示;`config` = 默认对话模板:`agent_persona_id`(R10)、`bilingual` 与 `zh_note`(R7)、`auto_speak` 等沿用网页新建对话的默认值,**键一律 snake_case**(§1 第 22 条),由服务端常量 `DAILY_CONFIG_DEFAULTS` 给出并在契约夹具里钉住)。`IntegrityError` → 回滚后重读(并发安全)。
3. `greeting_trigger == off` → 第 2 步已建好当天空对话(用户裁定:关闭也每天建);不查 / 不建 `chat_greetings`、不收集事实、不调用 LLM;返回 `status=off`、`conversation`、`greeting=null`。
4. **问候:** 查 `ChatGreeting(user_id, local_date=day)`:
   - `ready`:若 `conversation_id` 为空或 ≠ 今天的对话 → 把全部 `lines` 按序写回(R4),更新 `conversation_id` / `message_ids`。否则不写任何消息。返回(**不调用 LLM**;`every_open` 的重放也走这里,只返回已存 `lines` 供弹窗,**不追加消息**)。
   - `pending` 且未过期 → 返回 `status=pending`。
   - 不存在 / 过期 → 认领(R5)→ 收集事实(R3,总预算 600 ms;`include_stats=false` 时跳过、事实为空,R16)→ 读提示词(R14)→ 生成(§6,一次调用)→ 一个事务里:按序写 3 条 `Message(role="assistant")`、`chat_greetings` 写 `lines` / `message_ids` / `prompt_version` 并置 `ready`、`conversation.updated_at`。
5. `first_view = first_seen_at is None`;当前 `include_stats=false` → 返回的 `facts = {}`(R16 读取时规则)。

不发 `learning_events`(助手消息)。不调用 `runtime(app).hooks.after_turn`(不是回合,不触发记忆整理)。

对 `conversations.py` 的小改动(S9):`conversation_out` 加 `daily_date`;`create_conversation` 计数加 `daily_date IS NULL`(R12);`list_conversations` 加 `hide_idle_daily`(子查询:`daily_date IS NULL OR daily_date = :today OR EXISTS(user message)`;`today` 需要 `tz_offset_minutes` 查询参数,缺省 0),排序保持 `updated_at desc, id desc`(R11);`create_conversation` 不允许客户端写 `daily_date`(模型字段不在 `ConversationIn` 里,天然满足,补测试)。对 `agents.py` 的小改动:`turn` 读对话级 `config.zh_note`(R7)。

---

## §6 问候生成(提示词、校验、模板)

### 6.1 提示词(纯函数 `app/agents/greeting/prompt.py`)

请求由三段拼成,只有中间一段可在管理后台编辑(R14):

```
[固定前缀,代码] {SAFETY_PREAMBLE}

[可编辑模板 = 已发布的 chat.daily_greeting,或 DEFAULT_GREETING_TEMPLATE]
  (DEFAULT_GREETING_TEMPLATE 全文,约 1400 字符,≤ 2500 由测试钉住:)
  <persona>{persona}</persona>
  You write today's opening for an English practice chat: exactly THREE separate messages, shown one after
  another as a small daily ritual. Be warm and personal, like a friend who knows how the learner is doing;
  never guilt-tripping, never salesy.
  Message 1: greet with the local time of day and weekday, mention the streak from <facts> (streak 0 or
    missing: celebrate a fresh start instead), and add one warm, specific line of encouragement.
  Message 2: say how many words are due today and describe yesterday's slip clearly (what was wrong and
    what is right). Nothing due: say so lightly. No slip: say yesterday went smoothly. Never invent numbers,
    words or mistakes that are not in <facts>.
  Message 3: one concrete plan for today that follows focus_hint and practice_minutes in <facts> (what to
    do, for how long, in what order), ending on an encouraging note. Not a list of questions.
  Style: each message 1-2 sentences; mark 1-3 key phrases per message (numbers, the slip) with single
    *asterisks*; no other markdown, no emoji, no headings, no quotes around messages, do not address the
    learner by name.
  {language_rule}
  [[user]]
  <facts>
  {facts}
  </facts>
  Write today's three messages now.

[固定后缀,代码,追加在 system 段末尾;数字按当前语言只渲染相关的那一行]
  Output contract (fixed): return JSON only, no prose, no code fences:
  {"lines": [item1, item2, item3]} with EXACTLY 3 items in this order: 1 opening, 2 review and yesterday's
  slip, 3 today's plan. Each item is {"en": "..."} | {"zh": "..."} | {"en": "...", "zh": "..."} as the
  language rule says. Limits per item, asterisks not counted, at most 2 sentences and 3 *marks* per item
  (single asterisks only, 1-24 characters inside, no other markup):
  en: 30-160 characters each, 420 in total.            # en / bilingual
  zh: 12-60 characters each, 160 in total, no Latin letters.   # zh
  zh: 8-60 characters each, 130 in total.              # bilingual
```

- **不发送用户名:** 演示页英文第 1 段里的「Owen」是 mock。v1 不把用户名放进提示词(少一项个人数据;`zh` 模式也不能出现拉丁字母),「暖心话」靠连续天数与具体的鼓励来体现。以后要加称呼另立裁定。
- `{language_rule}`(代码生成,三选一):
  - `en` → `Language: English only. Each item has only the key "en".`
  - `zh` → `语言:全部用简体中文写,不要出现任何英文单词、字母或拼音;错点用中文描述(例如「在现在完成时里把过去分词错用成了过去式」)。Each item has only the key "zh".`
  - `bilingual` → `Language: each item has "en" (the full English message) and "zh" (a shorter, natural one-sentence Chinese version; it may quote the English slip, e.g. have went → have gone).`
- `{facts}`(代码渲染,每行一项,≤ 600 字;缺的项整行省略,不写 0 或 unknown,让模型按模板里的「缺失时」说法写):

  ```
  local_date: 2026-10-23 (Friday), time_of_day: morning
  streak_days: 23
  words_due_today: 12
  yesterday_slip: "have went" -> "have gone" (category: present perfect)      # en / bilingual
  yesterday_slip_zh: 现在完成时(过去分词错用成过去式),2 处                     # zh:只有中文类别描述与数字
  yesterday_other: 3 wrong answers in word review; 2 words with weak pronunciation
  focus_hint: fix_slip        # fix_slip | review | free_talk,代码按优先级算出(与 §6.3 模板同一规则)
  practice_minutes: 10
  ```
  - `focus_hint`:有语法错点 → `fix_slip`;否则有背单词答错 / 发音差词 → `fix_slip`(对象是「昨天没掌握的词」);否则待复习 > 0 → `review`;否则 `free_talk`。`practice_minutes` 固定 10(常量 `PRACTICE_MINUTES`,与演示页一致)。
  - 类别描述来自 `GRAMMAR_CATEGORY_ZH` / `GRAMMAR_CATEGORY_EN` 常量表(键按 Task 0 核对的 `Message.grammar` 实际类别取;未知类别 → 「语法」/ `grammar`)。
  - `include_stats=false`(R16)→ 不收集事实,只有 `local_date` / `time_of_day` 与 `focus_hint: free_talk`、`practice_minutes`(模板里关于连续天数 / 待复习 / 错点的指令按「缺失时」说法执行,模型拿不到任何学习数据);`zh` 语言 → 不出现 `yesterday_slip` 与任何词(`yesterday_slip_zh` 只有中文描述与数字),问候纯中文(R7)。
- `[[user]]` 单独一行把模板分成 system / user 两段(与 `rooms.assist` 同一约定;没有这一行 = 整段作 system,事实块仍在边界标签内)。模板用 `str.format`,字面量花括号写 `{{ }}`。
- 词最多 3 个(含错点原文对)、每个 ≤ 32 字符(原文对每边 ≤ 16)、先 `escape`。整条请求 ≤ 7000 字(R14,测试钉住)。
- 前缀里没有随机数(便于上游前缀缓存);日期在 user 段。
- `render_messages(template, persona, language, facts) -> list[dict]` 给 service,`render_test(template, sample)` 给管理端试运行(样例 `persona` / `language` / `facts`,缺省用内置示例;`format` 失败回落默认并只记 `warning`)。

### 6.2 输出校验(`app/agents/greeting/parse.py`)

按顺序检查,任何一步失败 → 整组不合格(不截断、不补齐、不拿部分结果):

1. 去掉 ```` ``` ```` 围栏后 `json.loads`;顶层必须恰好一个键 `lines`,值是**恰好 3 项**的数组(2 项或 ≥ 4 项都不合格:三段分工是位置约定,截断或补齐都会错位)。
2. 每项是对象,键集合必须与语言一致(R7):`en` = `{"en"}`、`zh` = `{"zh"}`、`bilingual` = `{"en", "zh"}`(双语缺任一键 → 不合格);值为非空字符串。
3. 规范化:去 markdown 标记(`#`、行首 `- ` / `1. `)、合并空白、去首尾引号;按 R17 `normalize_marks` 处理强调(`**x**` → `*x*`;不成对 / 嵌套 / 空 / 超 24 字符 / 超过 3 处 → 去掉该条全部 `*`,不判不合格)。
4. 长度(去标记后计):每条上下限与合计上限按 §4 表;每条句数 ≤ 2。
5. 文字:`en` 不得含中文字符(`lang.py` 的同款正则);`zh` 语言的 `zh` 至少 1 个中文字符且**不得含拉丁字母**(半角 + 全角,R7);`bilingual` 的 `zh` 至少 6 个中文字符(拉丁字母允许);任何段含 `<` `>`、`http`、`www.` 或 emoji(`\p{Extended_Pictographic}` 的等价判断)→ 不合格。
6. 不合格 → `error_kind="invalid"` → 模板问候(R6)。

### 6.3 模板问候(`app/agents/greeting/templates.py`,恰好 3 条)

LLM 关闭、额度用尽、上游失败或输出不合格时使用;产出与 §6.2 同形、满足 §4 不变式的 3 条 `lines`(含 `*…*` 强调),三段分工与 LLM 版一致,只用和提示词相同的事实(同一 `GreetingFacts`、同一 `focus_hint` 规则)。纯函数,不进日志。

**占位符**(代码按 `local_date` / 时段 / 事实填):`{greet}`(`zh`:早上好 / 中午好 / 下午好 / 晚上好 / 夜深了;`en`:Good morning / Good afternoon / Good evening / Still up,时段边界同演示页 `timeOfDay`)、`{weekday}`(周五 / Friday)、`{part}`(上午 / morning …)、`{tail}`(暖心尾句,3 选 1,按 `sha256(user_id:local_date)` 选,稳定、每天不同:`zh` 这份坚持真的很了不起 / 一点一滴都在积累 / 慢慢来,你一直在进步;`en` that steady effort really adds up / every bit of practice counts / you're making real progress)、`{streak}`、`{due}`、`{minutes}`(= `PRACTICE_MINUTES` 10)、`{cat_zh}` / `{cat_en}`(错点类别)、`{n}`(错点数)、`{wrong}` / `{right}`(错点原文对,只用于 `en` 与双语副句)。

**错点片段**(第 2、3 段共用,按优先级取第一个可用的;`zh` 语言永远走中文描述,不带原词):

| 可用数据 | `{slip_zh}` | `{slip_en}` | 双语副句 `{slip_sub}` |
|---|---|---|---|
| 语法错点且有原文对 | 昨天在{cat_zh}上出了 *{n} 处小错* | yesterday's slip was *{wrong}* — the right form is *{right}* | 昨天的错点:{wrong} → {right} |
| 语法错点无原文对 | 同上 | yesterday you made *{n} small slips* with {cat_en} | 昨天{cat_zh}错了 {n} 处 |
| 背单词答错 / 发音差词 | 昨天有 *{n} 个词* 还没完全掌握 | *{n} words* tripped you up yesterday | 昨天有 {n} 个词没掌握 |

**三段文本**(`zh` 语言用 `zh` 列;`en` 语言用 `en` 列;双语 = `en` 列作 `en` + 副句列作 `zh`):

| 段 | 情形 | `zh` | `en` | 双语副句 |
|---|---|---|---|---|
| ① | 连续天数 ≥ 1 | {greet}!这个{weekday}{part},你已经连续学了 *{streak} 天*,{tail}。 | {greet}! It's {weekday} {part}, and you're on a *{streak}-day streak* — {tail}. | {greet}!{weekday}{part},你已连续学习 {streak} 天。 |
| ① | 没有连续天数(0 或来源缺失) | {greet}!这个{weekday}{part}是个*新的开始*,今天练一会儿,就是连续学习的第一天。 | {greet}! It's {weekday} {part} — a *fresh start*, and a little practice today makes it day one. | {greet}!{weekday}{part},今天就是新的第一天。 |
| ① | `include_stats=false` | {greet}!这个{weekday}{part},很高兴又见到你,我们一起轻松练一会儿英语吧。 | {greet}! It's {weekday} {part}, and it's good to see you — let's enjoy some easy English together. | {greet}!{weekday}{part},很高兴又见到你。 |
| ② | 有待复习 + 有错点 | 今天有 *{due} 个单词* 等你复习;{slip_zh},今天我们把它彻底说对。 | You have *{due} words* due for review, and {slip_en}. | {due} 个单词待复习;{slip_sub}。 |
| ② | 有待复习、无错点 | 今天有 *{due} 个单词* 等你复习;昨天没有要补的错点,状态很稳。 | You have *{due} words* due for review today, and yesterday went smoothly with no slips to fix. | {due} 个单词待复习;昨天没有错点。 |
| ② | 无待复习、有错点 | 今天没有待复习的单词;{slip_zh},正好用今天把它补上。 | Nothing is due for review today, and {slip_en} — a good chance to fix it. | 今天没有待复习;{slip_sub}。 |
| ② | 都没有(含来源缺失) | 今天没有待复习的单词,昨天也没有要补的错点,正好轻松练练口语。 | Nothing is due for review and there are no slips to fix, so it's a great day for relaxed speaking. | 今天没有待复习,也没有错点。 |
| ② | `include_stats=false` | 今天不看数据,只管轻松地说英语,说错了也完全没关系。 | Today is just about enjoying some easy English together — mistakes are completely fine. | 今天只管轻松说,说错也没关系。 |
| ③ | `fix_slip`(语法)+ 有待复习 | 建议先花 *{minutes} 分钟*:围绕{cat_zh}说三句和你有关的话,再把待复习的单词过一遍。 | Today, let's spend *{minutes} minutes* on three sentences about your life using {cat_en}, then clear your review list. | 今天先花 {minutes} 分钟围绕{cat_zh}说三句话,再过一遍单词。 |
| ③ | `fix_slip`(语法)、无待复习 | 建议先花 *{minutes} 分钟*:围绕{cat_zh}说三句和你有关的话,说完我陪你逐句看看。 | Today, let's spend *{minutes} minutes* on three sentences about your life using {cat_en}, and I'll check each one with you. | 今天先花 {minutes} 分钟围绕{cat_zh}说三句话。 |
| ③ | `fix_slip`(词) | 建议先花 *{minutes} 分钟*:把昨天没掌握的词各用一句话说出来,再轻松收尾。 | Today, let's spend *{minutes} minutes* using each word that tripped you up yesterday in one sentence of your own. | 今天先花 {minutes} 分钟把昨天的词各说一句。 |
| ③ | `review` | 建议先花 *{minutes} 分钟* 把 {due} 个单词过一遍,再挑两个词各说一句关于今天的话。 | Today, let's spend *{minutes} minutes* clearing your {due} review words, then use two of them in sentences about your day. | 今天先花 {minutes} 分钟复习单词,再用两个词各说一句。 |
| ③ | `free_talk`(含 `include_stats=false`) | 建议花 *{minutes} 分钟* 用英语聊聊你今天的计划,想到哪说到哪,我帮你说得更地道。 | Today, let's spend *{minutes} minutes* talking about your plans in English — say it your way, and I'll help polish it. | 今天花 {minutes} 分钟用英语聊聊你的计划。 |

(表格里的中文标点在实现中用全角 `!` `,` `;` `:`;`zh` 列在任何填充下都不含拉丁字母——`{cat_zh}` 来自中文常量表,数字允许。)

- **优雅降级:** 每个数据点独立缺失都有对应说法,永远 3 段,不出现「0 天」「0 个单词」或空占位;来源超时 / 报错与「值为 0」同等对待(只是不提)。连续天数为 1 时用 ① 第一行(「连续学了 1 天」)。
- **长度自检:** 单测用最长填充(`streak=9999`、`due=9999`、最长类别标签、每边 16 字符的原文对、最长时段 / 星期)断言每条与合计都在 §4 上限内;超出说明表格或常量表写长了,改文案而不是放宽上限。
- **强调自检(R17):** 模板输出经 `normalize_marks` 后标记不变(模板自身的标记全部合法:每条 ≤ 3 处,标记内 ≤ 24 字符——所以类别名放在标记外,如 `*{n} small slips* with {cat_en}`)。
- 纯函数,单测覆盖全部情形组合 × 三种语言;`zh` 语言输出永不含拉丁字母;个人词汇只会出现在 `en` / 双语的错点原文对里(与提示词同一来源、同一 ≤ 16 字符与 `escape` 规则)。

### 6.4 token 与成本估算(未用真实上游测量)

- **输入:** 安全前缀 + 默认模板(约 1400 字符)+ 输出契约(≤ 1200 字符)+ 角色(≤ 300)+ 事实(≤ 600)≈ 3500 字符 ≈ **900–1100 token**;管理员把模板写满 4000 字时 ≤ 7000 字符 ≈ **2000 token** 上限。前缀稳定,上游支持前缀缓存时可再省。
- **输出(按 §4 上限 + JSON 键与引号约 40 token + 强调星号 ≤ 18 个):** `en` ≤ 420 字符 ≈ 110 token → ≤ 150;`zh` ≤ 160 字 × 约 1.5 token/字 ≈ 240 → ≤ 280;`bilingual` ≈ 110 + 130 × 1.5 ≈ 305 → ≤ 350。按演示页实际长度(§4 容量核对:`en` 321–340、`zh` 127–131、副句 87–105)约为上限的 70–80%。悲观换算(中文 2 token/字):`zh` ≈ 360、`bilingual` ≈ 410,仍 < 600;模型若把中文写成 `\uXXXX` 转义,`zh` 最坏约 520,仍在 600 内。**结论(§1 第 31 条):`max_tokens=600` 足够三种语言的演示页三段,不改**;多写的输出会被解析器按长度拒收,而不是被截断成坏 JSON。
- **成本:** 每活跃用户每天 ≤ 1 次调用(R6),约 1–2k 输入 + ≤ 350 输出 token;全站上限 2000 次 / 天时最坏 ≈ 4M 输入 + 0.7M 输出 token / 天(按管理端配置的上游计量 `llm.complete` 自动记账)。金额取决于 `resolved_chat_greeting_model` 的单价,本计划不写具体数字;上线后从用量表核对。中文 token / 字的换算系数是经验估计,**未测**。

---

## §7 测试策略(pytest + 管理端 vitest)

| 文件 | 内容 |
|---|---|
| `tests/test_chat_home_models.py` | 0023 往返;head == `0023`;`daily_date` NULL 不冲突、同日冲突;`chat_greetings` 唯一;`lines` / `message_ids` JSON 往返;删除用户清掉新表(`users_admin.delete_user`) |
| `tests/test_chat_home_prefs.py` | 默认值(含 `include_stats=true`)、读时丢坏键、写时严格(未知键 / 非法值 → 字段名;`include_stats` 非 bool → `field=include_stats`)、`daily_persona_id` 格式 |
| `tests/test_agents_personas.py`(改) | `builtin:partner` 名称为「学习伙伴」,id / 人设不变 |
| `tests/test_chat_home_facts.py` | 每个内置来源的边界(本地日窗口、跨时区 `offset=-720/840`、空数据返回 None)、单源超时被跳过、总预算、来源异常只记类名;`yesterday_grammar` 的 `slip_category` / 原文对(超过 16 字符不取原文)与 `focus_hint` 优先级;links 来源在 `WORDBOOK_ENABLED=False` 时返回 None |
| `tests/test_chat_home_prompt.py` | 默认模板通过 `validate_prompt`;三种语言的 `language_rule`;固定前缀 / 输出契约总在(自定义模板删不掉),契约含「EXACTLY 3 items」与当前语言的长度上限(只渲染当前语言那一行);默认模板 ≤ 2500 字且含三段分工与「缺失时」说法;`[[user]]` 分段与无分段;`escape` 生效(词里带 `<` / 全角 `＜`);`{facts}` / `{persona}` 截断与整条 ≤ 7000(4000 字自定义模板 + 最长事实);缺失项整行省略(不出现 0 / unknown);空事实、`include_stats=false`(只剩日期、时段、`free_talk`;即使传入完整事实,渲染结果里也没有 `streak_days` / `words_due_today` / `yesterday_*` 行与任何词,R16);契约后缀含「3 *marks*」与「single asterisks only」;`zh` 语言的事实块不含任何拉丁字母词(有词与原文对的事实输入下也是,只有 `yesterday_slip_zh`);`render_test` 坏模板回落默认 |
| `tests/test_chat_home_parse.py` | 三种语言各一组合格的 3 条(取演示页 v2 原文,用户名「Owen」去掉;英文第 2 段的 3 处强调原样保留并合格);围栏 JSON;2 条 / 4 条 → 不合格(不截断不补齐);顶层多键 / 缺 `lines`;某项键与语言不符、双语缺 `zh` 或缺 `en`;英文段混中文;`zh` 无中文;`zh` 语言下 `zh` 含半角或全角拉丁字母 → 不合格、含数字与 `→` → 合格;`bilingual` 的 `zh` 段含 `have gone` → 合格、中文少于 6 字 → 不合格;每条低于下限 / 高于上限、合计超长(恰好等于上限合格,`*` 不计入长度);3 句 → 不合格;强调(R17):`**x**` 规范成 `*x*`、3 处保留、4 处 / 不成对 / 嵌套 / 空 `**` / 标记内 25 字符 → 去掉该条全部 `*` 后合格(别的条不受影响);存下的 `lines` 里没有落单的 `*`;含链接 / `<` / emoji;空串 |
| `tests/test_chat_home_templates.py` | 全情形组合(连续天数 有 / 0 / 缺失 × 待复习 有 / 无 × 错点 有原文对 / 只有类别 / 只有词 / 无 × `include_stats` 开 / 关)× 三种语言的快照(纯函数);每组恰好 3 条且通过 `check_lines`(§4,含下限);`normalize_marks` 不改变模板输出(标记全部合法,R17);`include_stats=false` 时三种语言都走无数据的三行、不含数字与词;`zh` 输出永不含拉丁字母;双语每条都有 `en` 与 `zh`;不出现「0 天」「0 个」或残留 `{`;最长填充仍在上限内;`focus_hint` 与 §6.1 规则一致;尾句同一天稳定、不同天变化 |
| `tests/test_chat_home_service.py` | 假上游(`tests/agents_helpers.FakeLLM` 非流式,`texts=('{"lines": [...]}',)`):首次生成写对话 + 3 条按序的消息 + 问候行(`message_ids` 长度 3 且对齐;消息正文已去 `*`,`lines` 保留);第二次调用(含 `every_open` 重放)不再请求上游(计数)、返回同一组 `lines`,且对话消息数不变(重放不追加);并发两次只调用一次上游、输家 `pending`、从不读到半组;`pending` 过期可重认领;上游 402 / 超时 / 格式错 / 2 条 / 4 条 / 超长 / `zh` 模式夹英文 / 额度用尽 → 3 段模板且退还额度(`error_kind` 记录类别);上游请求的 `max_tokens == 600`;`CHAT_GREETING_LLM_ENABLED=False` → 零上游请求;**删除今天的默认对话(R4、§1 第 28 条):** 经 `DELETE /api/conversations/{id}` 删除后同一天再 `POST /today` → 新对话 id、3 条消息按序写回且正文与原来相同、`message_ids` 换成新 id、零上游请求、额度不变、`first_view` 仍为 `false`(已 `seen` 时),`off` 的日子只重建空对话;单独删一条问候消息后再进入不写回;`off` 仍建当天空对话(0 条消息)、不建 `chat_greetings` 行、零上游请求,连续两天 `off` 各有一个默认对话;已有 200 个普通对话时仍能建默认对话;角色被删回落 partner 且 prefs 不被改写;`AGENTS_ENABLED=False` 时 config 不带 `agent_persona_id`;三种语言下 config 的 `zh_note` / `bilingual`,且 config 里**没有任何 camelCase 键**(§1 第 22 条);**`include_stats=false`(R16):** 事实来源一个都不被调用(计数桩)、上游请求里没有连续天数 / 待复习 / 错点行、`chat_greetings.facts == {}`、模板回落走无数据三行;当天生成后再关 `include_stats` → `POST /today` 返回 `facts == {}` 而 `lines` 不变;LLM 返回 4 处强调的一条 → 该条去标记后仍 `ready`、`source=llm`;已发布自定义提示词被使用、`prompt_version` 记录;已发布版本坏了(绕过发布校验直接写库)→ 用默认并记 warning(无正文) |
| `tests/test_chat_home_api.py` | 开关关 404(`config` 除外)、未登录 401、`seen` 幂等、`PATCH /settings` 422 体(含 `include_stats`)、`PATCH /settings {include_stats: false}` 往返、`tz_offset_minutes` 范围 |
| `tests/test_conversations.py`(改) | `daily_date` 出现在 `conversation_out`;`hide_idle_daily` 过滤(旧的只有问候的默认对话被隐藏但仍可 `GET` 到;今天的默认对话即使没有用户消息也不隐藏);排序 `updated_at desc, id desc` 且分页稳定(同一 `updated_at` 的两条按 id 排、翻页不重不漏);昨天的默认对话今天收到用户消息后 `updated_at` 变成今天、排到前面(R11 分组依据);客户端不能写 `daily_date`;默认对话不计入 `max_conversations`(上限 1 时仍能新建普通对话,只要普通对话为 0) |
| `tests/test_agents_turn_zh_note.py`(新) | 对话 `config.zh_note=always` 覆盖用户 `zh_note=never`(假上游请求里出现中文提示规则);键缺失 / 非法 → 沿用用户设置;camelCase 的 `config.zhNote=always` **不**生效(防回归,§1 第 22 条);经 `PATCH /api/conversations/{id}` 以 `{"config": {"zh_note": "always", ...}}` 写入后生效(模拟网页的 snake_case 请求体);不影响别的对话 |
| `tests/test_prompts.py` / `test_prompts_api.py`(改) | `PROMPTS` 键集合含 `chat.daily_greeting`;缺 `{language_rule}` / `{facts}` / 缺边界 / 超 4000 字 / 未知占位符 → 不能发布;模板里写「write 5 messages」也能发布,但运行时仍按契约与解析器只收 3 段(假上游返回 5 段 → 模板);`from_default=true` 新建草稿正文 = 默认(发布过自定义版本之后也一样)、与 `from_version` 同给 → 422、审计带 `from_default`;试运行走问候渲染 |
| `tests/test_chat_home_privacy.py` | R13 |
| `tests/test_chat_home_contract.py` + `tests/fixtures/chat_home_contract.json` | `POST /today`(`ready` 三种语言各一例、`pending`、`off` 的 `greeting=null`)、`GET/PATCH /settings`、`GET /config` 的响应形状(`check_contract`,`CONTRACT_UPDATE=1` 重录);断言 §5.1:`lines` 与 `message_ids` 长度 3、`generated_at` 存在、`include_stats=false` 时 `facts == {}`(另录一例)、`lines` 里至少一例带 3 处 `*…*` 强调且全部合法(R17)、`conversation.config` 的键全是 snake_case(含 `agent_persona_id`、`zh_note`、`bilingual`)且 `conversation.daily_date` 存在;网页 W2 读同一夹具 |
| `admin/src/features/prompts/*.test.tsx`(改) | 新键出现在列表;编辑页「以默认正文新建草稿」按钮(无草稿、运营及以上可见)调用 `from_default`;试运行样例字段显示中文标签 |
| 现有 | `test_architecture.py`、`test_migrations.py`、`test_admin_users.py`、`test_settings_registry*.py`(以 Task 0 实际文件名为准)、`test_admin_routes_guarded.py`、`test_rooms_addressing_*.py` 保持绿 |

---

## §8 任务列表(服务端 + 管理端;每个任务一个提交)

规模:S ≈ 半小时内、M ≈ 1–2 小时、L ≈ 半天。

### Task 0: 前置核对(只读,不提交)— S
- [x] `git status` 记下用户未提交改动,之后只按路径 `git add`。
- [x] 核对 head 仍是 `0022`:`ls server/alembic/versions`;`grep -rln '"0022"' server/tests` 列出要改的钉子。
- [x] 核对 `list_conversations` 仍按 `updated_at desc, id desc` 排序、`POST /messages` 与 `PATCH` 仍刷新 `conversations.updated_at`(R11 分组依据);`grep -rn "zhNote\|agentPersonaId" server/app` 确认服务端没有读写 camelCase 的 config 键(§1 第 22 条)。
- [x] 核对 §2.1 表中的符号仍在:`conversation_out`、`list_conversations`、`create_conversation` 的计数、`USER_ROWS`、`install_agent_sources`、`builtin:partner` / `聊天伙伴`、`llm.complete`、`usage.consume`、`stats.streak`、`PROMPTS`、`DraftCreateIn`、`default_body`、`test_messages`、`agents.turn` 里的 `owned_conversation`。
- [x] `grep -rn "聊天伙伴" server admin web/src` 确认只有 `personas.py`;`grep -rn "set(PROMPTS)\|wordbook.explain" server/tests admin/src` 找出数提示词键的测试。
- [x] 找到设置注册表的测试文件名与新设置需要更新的地方(`app/core/settings_registry.py`、`server/.env.example`)。
- [ ] 不一致 → 停下报告,不要自行改裁定。

### Task S1: 迁移 0023 与模型 — M — `feat(server): chat home tables (daily conversations, greetings, prefs)`
- [x] `app/models.py`:`Conversation.daily_date` + 唯一约束、`ChatGreeting`(`lines` / `message_ids` / `prompt_version`)、`ChatPrefs`(§4)。
- [x] `alembic/versions/0023_chat_home.py`。
- [x] `app/admin/users_admin.py` `USER_ROWS` 加 `(ChatGreeting, "user_id")`、`(ChatPrefs, "user_id")`(按「子表先删」放在 `Conversation` 前面)。
- [x] head 钉子 `0022 → 0023`(Task 0 列出的文件)。
- [x] 测试:`tests/test_chat_home_models.py`、`test_migrations.py`、`test_changelog_models.py`、`test_library_models.py`、`test_library_catalog_models.py`、`test_admin_users.py`。

### Task S2: 设置与用户偏好 — M — `feat(server): chat home settings and per-user prefs`
- [x] `app/core/config.py`:`chat_home_enabled=False`、`chat_greeting_llm_enabled=True`、`chat_greeting_model=""`、`chat_greeting_timeout_seconds=6`(1–20)、`chat_greeting_global_daily=2000`(0–100000)、`resolved_chat_greeting_model`。
- [x] `app/core/settings_registry.py` 注册(组 `chat_home`,中文说明);`server/.env.example` 加占位说明。
- [x] `app/agents/greeting/__init__.py`、`prefs.py`(`ChatPrefs` 数据类含 `greeting_trigger` / `language` / `daily_persona_id` / `include_stats`、`DEFAULTS`、`load`、`save` 只 flush)。
- [x] `app/agents/greeting/CLAUDE.md`(允许的依赖、隐私、扩展点、提示词固定前后缀不可编辑)。
- [x] 测试:`tests/test_chat_home_prefs.py`、设置注册表测试、`test_architecture.py`。

### Task S3: 「聊天伙伴」改名「学习伙伴」 — S — `feat(server): rename the built-in partner persona to 学习伙伴`
- [x] `app/agents/personas.py` `_builtins()`:`builtin:partner` 名称改「学习伙伴」;id、简介、人设不变(R15)。
- [x] 测试:`tests/test_agents_personas.py`(加名称断言)、`test_rooms_addressing_routing.py`、`test_rooms_addressing_voice.py`、`test_agents_orchestrator.py`、`test_links_agent_sources.py`。
- [x] 独立于其他任务,可最先合并。

### Task S4: 学习数据来源 — M — `feat(server): greeting facts registry and sources`
- [x] `app/agents/greeting/facts.py`:`FactCtx(user_id, offset, now, local_date)`、`FactSource` 协议、`FactsRegistry`、`facts_registry(app)`(挂 `app.state.greeting_facts`)、`gather(app, ctx)`(并行、逐源 300 ms、总 600 ms、合并成 `GreetingFacts`)。
- [x] 内置来源 `streak / due_vocab / yesterday_grammar / yesterday_pron / yesterday_wrong`(每个 ≤ 2 次查询、≤ 200 行,昨天窗口用 `local_midnight_utc`)。
- [x] `app/links/greeting_facts.py`:`WordbookToday`(背单词今日复习数、连续达标天数;`wordbook_enabled` 关或没有在学的书 → None);`install(app)`。
- [x] `app/main.py`:`install_agent_sources(app)` 下一行 `install_greeting_facts(app)`(单行锚点)。
- [x] 测试:`tests/test_chat_home_facts.py`、`test_architecture.py`。

### Task S5: 提示词模板、三段校验、三段模板(纯函数) — M — `feat(server): three-paragraph daily greeting prompt, parser and templates`
- [x] `app/agents/greeting/prompt.py`:`DEFAULT_GREETING_TEMPLATE`、`language_rule`、`render_facts`、`render_messages`(固定前缀 + 模板 + 固定输出契约,`[[user]]` 分段)、`render_test`(§6.1)。
- [x] `parse.py`(`{"lines": [...]}` 恰好 3 项,§6.2;`normalize_marks` 强调规则,R17)、`templates.py`(三段 × 三语言、降级表含 `include_stats=false` 三行(R16)、`GRAMMAR_CATEGORY_ZH/EN`、`PRACTICE_MINUTES`,§6.3)、`focus_hint` 规则(提示词与模板共用);`lines` 不变式断言函数 `check_lines` 与长度 / 强调常量表(§4:`MAX_MARKS_PER_LINE = 3`、`MAX_MARK_CHARS = 24`,一处定义,parse / templates / 契约后缀共用)。
- [x] 测试:`tests/test_chat_home_prompt.py`、`test_chat_home_parse.py`、`test_chat_home_templates.py`。

### Task S6: 管理端可编辑的问候提示词(服务端) — M — `feat(server): admin-versioned chat.daily_greeting prompt with reset to default`
- [x] `app/services/prompts.py` `PROMPTS` 加 `chat.daily_greeting`(R14 的 spec)。
- [x] `app/admin/prompts_admin.py`:`default_body` 返回 `greeting.prompt.DEFAULT_GREETING_TEMPLATE`;`test_messages` 加 `chat.` 分支;`create_draft(..., from_default)`(与 `from_version` 互斥 → `PromptError(422, "Choose one source")`;审计 `after` 带 `from_default`)。
- [x] `app/routers/admin_prompts.py`:`DraftCreateIn.from_default: bool = False`。
- [x] 测试:`tests/test_prompts.py`、`test_prompts_api.py`、`test_admin_routes_guarded.py`、`test_architecture.py`。

### Task S7: 生成服务 — L — `feat(server): ensure today's conversation and multi-line greeting (idempotent, capped, template fallback)`
- [x] `app/agents/greeting/service.py`:`ensure_today`、`claim`、`load_template`(`prompt_cache` + 运行时校验 + 回落默认)、`generate`(一次 `llm.complete` + 额度 + 超时 + 退还 + `parse`)、`write_lines`(按序写 3 条消息,`created_at` 递增,正文去掉 `*` 标记,`lines` 原样保留)、`restore_lines`(对话被删后重建时写回,R4)、`mark_seen`;scope 常量 `SCOPE_GREETING_USER="chat_greeting"`、`SCOPE_GREETING_GLOBAL="chat_greeting_global"`(放 `greeting/service.py`,不动 `agents/limits.py`);`DAILY_CONFIG_DEFAULTS`(键一律 snake_case:`agent_persona_id`、`zh_note`、`bilingual`、`auto_speak`……,§1 第 22 条)与按语言的 `zh_note` / `bilingual`。
- [x] `off` 分支只建对话、不碰 `chat_greetings`;重放分支(`ready` 且对话未换)不写消息;`zh` 语言渲染事实时剔除词(R7、R8);`include_stats=false` 跳过 `gather`、读取时 `facts` 返回 `{}`(R16)。
- [x] 日志一行:`timing event=chat_greeting status=ready source=llm|template error=<kind|-> lines=<n> ms=<n> facts=<n>`(`app.timing` 通道)。
- [x] 测试:`tests/test_chat_home_service.py`(§7 全部用例)。

### Task S8: 对话级 `zh_note` — S — `feat(server): per-conversation zh_note override for agent turns`
- [x] `app/routers/agents.py` `turn`:`conversation = await owned_conversation(...)`;`config.get("zh_note")` 合法 → `dataclasses.replace(agent, zh_note=...)`(R7;snake_case 键,camelCase `zhNote` 不认,§1 第 22 条)。合法值取 `app/agents/settings.py` 现有的 `zh_note` 取值集合,不复制字面量。
- [x] 测试:`tests/test_agents_turn_zh_note.py`、现有 `test_agents_*` 中 `turn` 相关文件(以 Task 0 grep 为准)。

### Task S9: 路由与对话列表小改 — M — `feat(server): /api/chat-home routes; daily_date, hide_idle_daily and quota exemption on conversations`
- [x] `app/routers/chat_home.py`(§5);`app/main.py` 导入名 + 路由顺序(`agents` 之后、`stubs` 之前,单行插入)。
- [x] `app/routers/conversations.py`:`conversation_out` 加 `daily_date`;`create_conversation` 计数加 `daily_date IS NULL`(R12);`list_conversations` 加 `hide_idle_daily` 与 `tz_offset_minutes`(排序不变:`updated_at desc, id desc`,R11);`delete_conversation` 显式 `UPDATE chat_greetings SET conversation_id=NULL, message_ids='[]'`(SQLite 默认不开外键级联,与现有显式删消息同理),并加测试。
- [x] 若有网页契约夹具钉住 `conversation_out` 形状(Task 0 `grep -rn conversation_out server/tests web/src`),同步重录并在提交说明里写明是增量字段。
- [x] 测试:`tests/test_chat_home_api.py`、`tests/test_conversations.py`、`test_conversations_agent_trace.py`、`test_admin_routes_guarded.py`。

### Task S10: 隐私与契约 — S — `test(server): chat home privacy scan and contract fixture`
- [x] `tests/test_chat_home_privacy.py`(R13,含已发布自定义提示词)、`tests/test_chat_home_contract.py` + 夹具。
- [x] 测试:上述两个文件。

### Task A1: 管理端界面 — S — `feat(admin): reset a prompt to its default; greeting sample labels`
- [x] `admin/src/features/prompts/api.ts`:`createDraft(key, { fromVersion?, fromDefault? })`。
- [x] `prompt-editor-page.tsx`:没有草稿时,在「新建草稿」旁加「以默认正文新建草稿」(运营及以上;已发布版本存在时才显示,否则两者等价);发布仍走现有确认对话框。
- [x] `strings.ts`:`resetToDefault` 文案;`sampleLabels` 加 `persona`(「角色名与简介」)、`language`(「语言:zh / en / bilingual」)、`facts`(「学习数据(每行一项)」);说明文案提示「安全前缀与 JSON 输出格式由服务端固定追加」。
- [ ] 测试:`yarn admin:typecheck && yarn admin:test`(改 `prompt-editor-page.test.tsx`、`prompts-page.test.tsx`)。

### Task D1: 文档 — S — `docs: chat home and daily greeting (server)`
- [x] `server/app/CLAUDE.md`(agents 行提到 `greeting/`;Pitfalls 里 head 改 `0023`)、`server/app/agents/CLAUDE.md`、`server/app/routers/CLAUDE.md`(`chat_home` 一行;`agents.turn` 的对话级 `zh_note`;对话 config 键一律 snake_case)、`server/app/links/CLAUDE.md`(`greeting_facts.py`)、`server/app/admin/CLAUDE.md`(`from_default`)、`server/README.md`(新设置、默认对话不计入上限、时区限制)。
- [x] 本计划文末「未验证清单」随实际情况更新;勾选只在合并且测试通过后。

### 网页任务组(W)— 见网页计划 §10(W0–W13)。

依赖:`0 → S1 → S2 → S4 → S7 → S9 → S10 → D1`;S3 只依赖 0(可最先做);S5 只依赖 S2(纯函数,可与 S4 并行);S6 依赖 S5;S7 依赖 S4、S5、S6;S8 只依赖 0(可与 S1–S7 并行,S7 写入的 `zh_note` 要它生效);A1 依赖 S6。**网页侧依赖本计划的:** W2 依赖 S9 + S10(夹具);W6 依赖 S2、S9(`/settings`)与 S8(`zh_note` 生效);W9、W10 依赖 S7 + S9;W12 依赖全部 S 任务(见网页计划 §10 依赖图)。

---

## §9 风险与已知限制

- **K1 数据增长:** 默认对话不计入上限(R12),每人每天至多 1 个对话 + 3 条问候消息,只隐藏不删除;一年约 365 个对话、≤ 1100 条问候消息 / 人(每条 ≤ 约 220 字符),可接受。没有清理任务;如以后要清理,另立计划。
- **K2 首屏延迟:** 首次打开要等 LLM(上限 6 s)。3 段详细问候比原来的短消息长(`max_tokens` 600,输出估算 ≤ 350 token,§6.4)。演示页的动画时长应覆盖这段;超时即模板,不会卡住。真实首字 / 完成时间**未测**(本机上游 402,参见 `docs/superpowers/plans/2026-10-12-agents-latency.md` 的口径)。
- **K3 成本:** 每活跃用户每天 1 次调用(约 1–2k 输入 + ≤ 350 输出 token,`max_tokens` 600,§6.4);全站上限兜底。`every_open` 只重放,不增加调用。
- **K4 时区:** 只用客户端偏移,跨时区旅行可能一天出现两个或零个默认对话;夏令时切换当天偏移变化同理。可接受,写进 README。
- **K5 多进程:** 认领靠数据库唯一约束,多 worker 也安全;额度在 `daily_usage` 表里,跨进程正确;提示词发布经 `config_revisions['prompts']` 让各进程失效缓存(现有机制)。
- **K6 中文:** 后续聊天回复始终是英文(+ 中文提示 / 自动翻译),符合用户裁定;`zh` 模式下问候本身是纯中文(用户裁定:问候不是学习内容),与随后英文回复风格不同,属预期。
- **K12 弹窗只在对话主页:** 当天从没进过对话主页的用户看不到弹窗(`daily` 的 `first_view` 一直为真,问候仍在当天默认对话里);`off` 模式下每天仍新建一个空默认对话,用户没回就按 R11 在列表里隐藏,数据量见 K1。
- **K7 历史长度:** 双语 3 段问候会占用下一回合的历史预算(`AGENTS_HISTORY_CHARS_MAX` 8000),合计 ≤ 420 + 130 + 分隔 ≈ 560 字符,影响很小。
- **K8 记忆:** 问候不经 `after_turn`,不进入记忆整理;下一回合的记忆整理会看到它作为历史。可接受。
- **K9 管理员改坏提示词:** 发布前校验 + 运行时再校验 + 固定前后缀 + 解析失败回落模板,最坏情况是当天问候变成模板,不会出错或泄露。管理员可写出语气不当的提示词——这是管理权限内的事,试运行可先看效果。
- **K10 改名影响房间:** 房间里 `@聊天伙伴` 失效(R15),写进 changelog 草稿。
- **K11 未验证:** 真实上游对 `{"lines": [...]}` JSON 输出的遵从度(三种语言;恰好 3 段、长度下限 / 上限、`zh` 模式不夹英文的命中率)、§6.4 的 token 估算、Postgres 上的 0023、真机上的弹窗时序,全部**未验证**。

## §10 待用户确认的问题

全部问题已由用户 2026-10-23 答复:原 Q1–Q4、Q6–Q8 并入 §1 第 9–16 条,原 Q5、N1–N3 并入 §1 第 17–20 条;网页计划 Q1–Q11 并入 §1 第 22–31 条;对应裁定见 R2、R4、R6–R8、R10–R17。**目前没有待确认的问题。**

---

## §11 网页摘要(详细计划见网页计划)

网页实现以 `docs/superpowers/plans/2026-10-23-chat-home-daily-greeting-web.md` 为准(FR0–FR19、W0–W13);这里只记与服务端相关的已定约束:

- `/chat` = 今天的默认对话(`POST /today` 提供);历史在左侧浮动抽屉(`GET /api/conversations?hide_idle_daily=true&tz_offset_minutes=…`),按 `updated_at` 本地日分组,今天的默认对话单独置顶并从分组里去掉(R11)。`CHAT_HOME_ENABLED` 关 = 旧列表页原样。
- 问候弹窗只在 `/chat` 入口页弹,出现时调 `seen`;`every_open` 只重放;`off` 不弹(R8)。弹窗只显示 `lines`(恰好 3 段,`*…*` 按 R17 安全渲染)与底部小字 `facts`,不显示助手名字 / 头像。「重播今天的问候」是用户功能:用内存里的 `/today` 结果再弹一次,不调用服务端、不追加消息(§1 第 27 条)。
- 右上角设置面板:本对话角色(写 `config.agent_persona_id`)、「以后每天都用这个角色」(`daily_persona_id`)、问候语言(`language`,今天的默认对话同时写 `zh_note` / `bilingual`)、问候时机(`greeting_trigger`)、「问候里提学习数据」(`include_stats`,R16)。通话按钮留在顶栏、设置按钮旁(§1 第 24 条)。
- 今天置顶卡可以删除:网页 `DELETE /api/conversations/{id}` 后立即 `POST /today`(不算一次「打开」,不弹窗),服务端按 R4 重建并写回问候(§1 第 28 条)。
- 对话 config 的键一律 snake_case(网页类型 camelCase,由 `ApiClient` 转换;§1 第 22 条)。

**以后的任务(不在本计划与网页计划范围内,§1 第 23、29 条):** 问候下的快捷回复胶囊(需要服务端给建议)、新对话选好角色后的角色开场白(需要「无用户消息的角色开场回合」或固定文案)、单条消息复制 / 删除、对话手动改名、附件 / 图片消息。需要时另立计划。

---

## 未验证清单

- 状态(2026-10-25):代码已合并进 main(尚未部署,`CHAT_HOME_ENABLED` 默认关)。任务勾选只表示代码与自动测试已合并;E2E 最终验证待完成,§8 真机清单、README 截图、管理端 `yarn admin:test` 仍未完成。
- 真实 LLM 上游(`{"lines": [...]}` JSON 输出遵从度、恰好 3 段与长度限制的命中率、三种语言、`complete` 的时延、§6.4 的 token 估算与中文 token / 字系数)——未调用。
- §4 的长度上下限取自演示页 v2 的 mock 文本再留余量,未用真实生成结果校准;模板问候表(§6.3)的最长填充是否在上限内由 Task S5 的单测确认。
- 迁移 0023 在 Postgres 上——未运行。
- 管理端「恢复默认」与问候试运行——未在浏览器里点过。
- 本计划中的代码片段尚未在仓库或副本中运行;执行者以真实测试结果修正测试数据与超时,不改裁定、接口名与隐私断言。
- 网页部分:详细实现计划见网页计划(未实施);§5.1 前端契约未经网页代码消费验证。
- 服务端实现(S1–S10)只在假上游与 SQLite 下测过;管理端 A1(`admin/src/features/prompts`)改动因本机没有 `node_modules` 未运行 `yarn admin:typecheck && yarn admin:test`——未验证。
- 服务端实现的小调整:无 `[[user]]` 分隔行的自定义模板,请求末尾补一条固定的 user 消息(`Write today's three messages now.`),避免只有 system 消息的请求;问候的每人额度键按用户**本地日**计(全站额度按 UTC 日)。
