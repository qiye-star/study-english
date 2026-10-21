# L4 · 词汇激活检测 + 语境化复习 · 实施计划

- 日期:2026-10-21 · 状态:只有文档,未实现、未提交
- 车道:**L4**(INDEX `docs/superpowers/plans/10.21-plans/2026-10-21-INDEX.md` §1)
- Spec:`docs/superpowers/specs/2026-10-21-object-storage-fsrs-dubbing-design.md` §2.1、§2.2、§2.4、§2.5、§5
- 裁决来源:INDEX(冻结迁移号 `0030`、冻结事件 `RealtimeTurnFinished` / `LibraryItemReady`、冻结端口 `ExampleProvider`、§6 文件所有权)。本计划与 INDEX 冲突时以 INDEX 为准;本计划需要 INDEX 改动的地方都写成「待 INDEX 补充」,不擅自改冻结接口。
- 合并顺序:L1 ‖ L3 ‖ L5 → **L4**。L4 只为迁移链等 L3(0028)与 L5(0029)合并,不依赖它们的代码。
- 测试口径(INDEX §2):每个任务只跑它列出的测试文件 + `server/tests/test_architecture.py`(服务端)或对应目录(网页)。不跑全量、不跑 E2E、不重建容器、不运行回填命令(用户要求时才做)。
- 文中 `文件:行号` 均为 2026-10-21 在 `feat/self-hosted-backend`(a377ecf0)上核对过的位置;L1/L3/L5 合并后行号会漂移,执行前按锚点文字重新定位。

## 0. 摸底结论(已验证,读代码所得)

**事件现状(今天真正发布的事件):**

| 事件 | 发布点 | 备注 |
|---|---|---|
| `MessageSent` | `server/app/routers/conversations.py:377-380`(commit 之后,只对 `role == "user"`) | 文字只在内存(`learning_events.py:77-88`,`repr=False`) |
| `AssessmentFinished` | `server/app/routers/speech.py:228-231`;`source ∈ ("practice","chat","library")`(`speech.py:35`) | 带 `weak_words` / `good_words` |
| `WordAnswered` | `server/app/wordbook/service.py:486、602、647、767` | 与 L4 无关 |
| 实时通话 | **无**。`realtime_session.py:509-514` 只向客户端下发 `transcript_final`;入库在 `realtime_providers.py:209-237`(`DbMessageStore._add` 在 `:226` commit),不发布任何事件 | spec §2.1 的「未验证」现确认为**确实没有** |
| 房间语音转写 | **无**。`rooms/voice.py:175-215` 写转写后只调 `_after_transcript`(给房间智能体) | |
| 库条目就绪 | **无**。`library/pipeline.py:347-363`、`library/catalog_import.py:305-315` 只记日志 | |

**事件通道的两个硬约束(决定了 R3、R4):**

1. `LearningBus.publish` 在 `learning_events.py:151` 以 `links_enabled` 为总闸:`LINKS_ENABLED=false` 时任何事件都进不了队列。L4 若照搬,就会出现「激活开了、联动关了 → 什么都收不到」。
2. 模块级 `publish()`(`learning_events.py:281-290`)读的是 contextvar,只在 `current_user` 里绑定(`core/deps.py:67`)。实时通话 WebSocket(`routers/realtime.py:201`,用票据不用 `current_user`)和库 worker / 精选库任务(后台任务)都**没有绑定**,调模块级 `publish` 会静默返回 False。

**其他已验证事实:**

- `library_segments` 没有单列 id:主键是 `(item_id, idx)`(`models.py:1046-1061`);`catalog_segments` 是 `(catalog_id, idx)`(`models.py:1119`)。精选库「添加」把句子**复制**进用户的 `library_segments`(`catalog_store.py:289-311`)。
- 置信度:条目级 `library_items.low_confidence`(`models.py:1036`),句级 `library_segments.flags`(非空 = 时间可疑)。
- 词形:`wordbook/forms.py` 的 `Forms.lemma_of(form)`(形式 → 原形,只覆盖七本书里出现的原形);进程内实例在 `lookup_service(app).forms`(`wordbook/lookup.py:66、139`)。`textnorm.py` 提供 `fold`(:53)、`tokenize`(:57)、`lemma_candidates`(:107)、`find_form`(:128)。
- 已学词 = `vocabulary_items.source` 以 `wordbook:` 开头(`wordbook/store.py:24`)。
- 选择题 cloze 判分与句子无关:`quiz.check_choice` 只比 `fold(choice) == card.key`(`quiz.py` `check_choice`);题型由 `(user_id, key, reps)` 种子决定,`_allowed_qtypes`(`service.py:377-385`)在答题时重算,而 `eligible_qtypes`(`quiz.py:47-58`)依赖词典 `cloze_example`(`quiz.py:38-44`)。
- 拼写句组(`cloze.py`)是无状态的:提交时按 `(key, sentence_id)` 从词卡重算(`cloze.py:52-75`、`service.py:714-725`),`sentence_id` 受路由正则 `SENTENCE_ID` 约束(`routers/wordbook.py:167、183`)。
- 智能体上下文来源注册表 `SourceRegistry.register`(`agents/context.py:73-84`);不在 `TOOL_OF`(`:16`)里的来源键不受工具开关限制,只受 `AGENTS_TOOLS_MODE=off` 与 `share_in_rooms` 约束(`:56-70`)。links 的来源在 `main.py:112` 注册,其后有 A2/A3/A5 锚点(`:113-116`)。
- 普通 AI 对话与实时通话的系统提示词由**网页**拼:`features/chat/conversation-page.tsx:743`(`buildChatMessages(..., coach)`)与 `:1426`(实时 `start.systemPrompt = effectiveSystemPrompt(config)`);只有智能体回合在服务端拼。
- 网页 i18n:`SUPPORTED_LANGUAGES = ["en","zh-CN","es"]`,但 `webMessages` 只合并 `en` / `zh-CN`,西语的 web 键回落英文(`web/src/i18n/index.ts:5、23、34`,`web/src/i18n/CLAUDE.md`)。
- 智能体步骤名按 `web.agents.step.<key>` 取文案,未知键显示通用「步骤」(`web/src/features/agents/step-labels.ts:9`);i18n 文件按 glob 合并,所以新键可以放在任一目录的 `i18n/`。

## 1. 裁定

- **R1 新顶层包。** `server/app/activation/` 是与 `links` 平级的顶层:可导入 `core, models, providers, speech, services, wordbook, agents`;**只有** `app/routers/` 与 `app/main.py` 导入它。不导入 `links`、`library`、`rank`、`rooms`、`realtime`(库、房间、实时的数据只经事件或 `app.models` 读)。`links` 也不导入它。架构测试新增 `test_activation_is_a_top_layer`。
- **R2 只存词元与计数。** `word_usage` 只有 `(user_id, lemma, first_used_at, last_used_at, use_count, shadow_count, session_count, last_session, sources)`;**永不**存消息文字、句子、转写;`last_session` 存会话标识的 sha256 前 16 位(不是原 id,也不是文字)。词、文本、用户 id 不进 URL、日志、异常、计数名、管理端错误。路由只允许查询参数 `page`、`offset`。
- **R3 事件通道按订阅分闸(core 的最小改动)。** `LearningBus.subscribe(event_type, link, handler, *, flag="links_enabled")`:每个订阅带自己的总开关名;`publish` 只在「该事件至少有一个订阅的 flag 为真」时入队,否则返回 False(**激活关时零队列成本**);`_dispatch` 时 flag 已关的订阅计 `skipped`。默认参数让现有 links 行为逐字不变。L4 的订阅一律 `flag="activation_enabled"`、名字以 `activation.` 开头(`links/setup.py:14-20` 的 `bus_gate` 对未登记的名字返回 True,不受联动三级开关影响)。
- **R4 后台发布者显式传 bus。** 实时通话与库 worker 不依赖 contextvar:`DbMessageStore(..., publish=None)`、`PipelineDeps.publish` 字段(默认空操作),由 `routers/realtime.py` / `library/worker.install` 传入 `app.state.learning_bus.publish`。请求内的发布点(精选库「添加」、重新分句)照旧用模块级 `learning_events.publish`。一律在 `commit()` 之后、永不抛错。
- **R5 两个新事件(INDEX §4 冻结,形状如下)。**
  - `RealtimeTurnFinished(user_id: int, conversation_id: str, message_id: str, text: str = field(repr=False), at, event_id)`:与 `MessageSent` 同构,`text` 截 `MAX_TEXT`、只在内存。
  - `LibraryItemReady(user_id: int | None, item_id: str | None, catalog_id: str | None, at, event_id)`:用户条目 `user_id + item_id`;精选库条目 `user_id=None + catalog_id`。不带任何文字。
  - 两者加入 `EVENT_TYPES`。房间语音**不**在冻结清单里 → 见 R14。
- **R6 匹配不用 LLM。** 一条文本 → `tokenize` → 每个词元的候选原形 `{fold(t)} ∪ lemma_candidates(t) ∪ {forms.lemma_of(fold(t))}` → 一次 `IN` 查询与该用户已学词(`vocabulary_items.word`,`source LIKE 'wordbook:%'`)求交。这就是「只针对已学词集合的倒排」:不把整个已学集合装进内存,单查询 ≤ 200 个候选(超出截断,计数 `activation.usage.truncated`)。多词词条不检测(spec §2.6 接受)。
- **R7 来源与「主动使用」。** `chat`(`MessageSent`)、`realtime`(`RealtimeTurnFinished`)、`room`(R14,待补)算主动使用:`use_count += 1`,会话变了 `session_count += 1`。`AssessmentFinished` 且 `source ∈ {"practice","library"}` 的 `good_words ∪ weak_words.word` 只记 `shadow`(`shadow_count += 1`),**不**改 `use_count` / `session_count`。`source == "chat"` 的评测忽略(同一条消息已由 `MessageSent` 计过)。`sources` 是逗号连接的去重来源集合(`chat,realtime,shadow`,≤ 32 字符)。
- **R8 三种状态(阈值是占位,待真实数据调)。** `GRACE_DAYS = 3`、`DORMANT_DAYS = 30`、`ACTIVE_SESSIONS = 2`,写在 `activation/states.py` 作代码常量(**不是设置项**,注释写明「占位,未用真实数据校准」)。
  - 沉睡:已学 ≥ `GRACE_DAYS` 天,且无 `word_usage` 行或 `last_used_at` 早于 `DORMANT_DAYS` 天;
  - 萌芽:窗口内 `use_count ≥ 1` 且 `session_count < ACTIVE_SESSIONS`;
  - 激活:窗口内 `session_count ≥ ACTIVE_SESSIONS`。
  - 学了不到 `GRACE_DAYS` 天、也没用过的词不进任何列表(「刚学」)。纯函数 `state_of(...)`,测试逐边界覆盖。
- **R9 FSRS 互不干扰(v1)。** 主动使用**不**改任何调度字段(`box / due_at / reps / lapses`,以及 L3 的 `stability / difficulty / fsrs_state / last_review`);activation 不导入 `services/vocabulary.py`、`wordbook/grading.py`、`wordbook/plan.py`。测试断言处理器前后 `vocabulary_items` 行逐列相等。spec §2.4(4)原话:避免把「用过」误当「记得」。
- **R10 句子倒排 `segment_lemma`。** 列 `(scope, owner_id, idx, lemma)`,主键全列;`scope ∈ {"lib","cat"}`,`owner_id` = `library_items.id` 或 `catalog_items.id`;`idx` 对应句子;`lemma` = `forms.lemma_of(fold(t)) or fold(t)`(每词元一个,去停用词与长度 < 3)。另有标记行 `idx = -1, lemma = "#v1"` 表示「此条目已按 v1 规则建过索引」:回填据此幂等,将来换规则只改版本号。查询一律 `idx >= 0`。**无外键**(两种 owner 共列;SQLite 无级联):
  - 用户删除:`admin/users_admin.py` 在删 `LibrarySegment` 的同一处(`:191`)先删该用户条目的 `segment_lemma`(共享锚点一行);
  - 单条目删除 / 精选库回收:不改 `library/store.py`、`catalog_store.py`;孤儿由 `activation/purge.py` 每日清扫,读侧一律 join `library_items`(属主 + `status='ready'`)所以孤儿不可见。
  - 索引过期(手动改句子、换字幕):读侧对候选句**重新** `find_form` 校验,过期行无害;重新分句会再发 `LibraryItemReady` 触发重建。
- **R11 索引在总线之外建。** 总线处理器只把 `(scope, owner_id)` 交给 `activation/indexer.py` 的进程内 `Indexer`(有界待办 ≤ 200、一次一个、分块 500 句、分词放 `asyncio.to_thread`),不在 2 秒处理器超时内做重活;`Indexer.pending` 加进 `server/tests/background.py::_task_sets`。重建 = 同一事务内删该 owner 全部行再插入,幂等。精选库副本(`library_items.catalog_id` 非空)若 `cat` 作用域已有索引,则按 `idx` 复制行而不重新分词。
- **R12 回填。** `python -m app.activation.backfill [--dry-run] [--chunk 50] [--limit N]`:扫 `status='ready'` 且没有 `#v1` 标记行的 `library_items` 与 `catalog_items`,分块提交、可中断续跑、幂等;只打印条目数与行数。**只在用户要求时运行**。
- **R13 例句端口 `ExampleProvider`(INDEX §4,L4 定义并拥有)。** 放 `server/app/wordbook/examples.py`(wordbook 层内,只读 `app.models`,不导入 library / activation)。
  - `DictionaryExampleProvider`:包装 `quiz.cloze_example`,行为逐字不变;
  - `LibraryExampleProvider`:只取**该用户自己** `ready` 且 `low_confidence = false` 的条目里 `flags IS NULL` 的句子;6–16 个词元;`find_form` 命中且命中词形折叠后等于词头(与 `quiz.cloze_example` 同规则,选项才不会因词形泄题);候选最多 50 条按 `(item_id, idx)` 排序后,用**独立哈希** `sha256("example:{user}:{key}:{reps}")` 取下标——**不消耗** `question_rng`,所以干扰项与选项顺序与今天逐字相同;返回 `start_ms / end_ms / item_id`,`zh` 取句子译文(可空);找不到回落词典。
  - `provider_for(settings)`:`activation_enabled and library_enabled` → Library(内含词典回落),否则 Dictionary。
- **R14 房间语音:已获批(INDEX §4 已纳入 `RoomVoiceTranscribed`,2026-10-21)。** INDEX §4 只冻结了两个新事件。房间语音需要第三个事件(建议 `RoomVoiceTranscribed(user_id, room_id, message_id, text repr=False)`,发布点 `rooms/voice.py:208-215` 的 `status == "done"` 分支、经 `VoiceDeps.publish` 注入)。本计划把它列为 **Task 17(阻塞)**:先由控制者改 INDEX §4,再开工;在此之前 `sources` 里没有 `room`。
- **R15 题型资格与拼写句组不变(v1)。** `eligible_qtypes` 仍按词典例句判断 cloze 资格(否则 `_allowed_qtypes` 的重算会与出题不一致,产生 409 `QTYPE_MISMATCH`);库例句只替换**已被选为 cloze 的题**的句子。`cloze.py` 拼写句组在 v1 **不改**:库句子要进句组,需要放宽 `SENTENCE_ID` 正则并在提交时按 owner 重查——列为第二步(§5),编辑点仍归 L4(INDEX §6),L3 不碰。
- **R16 题目形状向后兼容。** `Question` 加可选字段 `clip: dict | None = None`;`question_out` 只在非空时追加 `"clip": {"item_id", "start_ms", "end_ms"}`。旧网页忽略未知键;激活关时响应逐字不变(契约夹具默认用例不变)。片段只给用户自己的条目(播放走现有 `POST /api/library/items/{id}/media-ticket`,`routers/library.py:554-562`,每次重验属主)。
- **R17 功能开关。** `ACTIVATION_ENABLED`(`Settings.activation_enabled: bool = False`,热更新,注册表 group `features`)。关时:`/api/activation/*` 除 `GET /config` 外 404 `{"error": "Activation is off"}`;总线不入队(R3);`Indexer` 不收活;智能体来源直接返回 None(不开会话);例句端口用词典;网页「我的」入口与页面不出现(页面直达时回 `/practice`)。**不**设每用户开关(v1);需要时再加。
- **R18 对话注入。** 服务端:智能体回合经 `activation/agent_source.py` 的 `DormantWords`(键 `dormant_words`,`private = True`)注册进 `agents.orchestrator.runtime(app).registry`——不改 `agents/` 任何文件。普通对话 / 实时通话的提示词在网页拼,需要一个非 UI 的「提示补充」扩展点,涉及 `lib/extension-points.ts` 与 `features/chat` 两处不归 L4 的文件 → **Task 16 标为第二步候选**,开工前由控制者确认。选词:沉睡词中 `box ≥ 2` 的,按 `(user, 本地日)` 哈希稳定取 3 个(`HINT_WORDS = 3`、`HINT_MIN_BOX = 2`,占位)。
- **R19 i18n。** 新文案写 `zh-CN` 与 `en` 两份(键 `web.activation.*`);西语:**不做**(2026-10-21 用户裁定,英语学习平台,界面只需中英)。

## 2. 文件清单

| 新建(L4 独占) | 用途 |
|---|---|
| `server/app/activation/__init__.py`、`CLAUDE.md` | 包说明、依赖规则、陷阱 |
| `server/app/activation/matcher.py` | 纯函数:文本 → 候选原形;句子 → 索引词元 |
| `server/app/activation/states.py` | 纯函数 + 占位阈值:`state_of`、`session_key` |
| `server/app/activation/usage.py` | 三个处理器(chat / realtime / shadow)、`install(app, bus)` |
| `server/app/activation/indexer.py` | `Indexer`、`index_owner`、`LibraryItemReady` 处理器 |
| `server/app/activation/backfill.py` | 回填 CLI(`python -m app.activation.backfill`) |
| `server/app/activation/purge.py` | 孤儿 `segment_lemma` 每日清扫 |
| `server/app/activation/words.py` | 沉睡 / 萌芽 / 激活列表、提示词选词 |
| `server/app/activation/agent_source.py` | `DormantWords` 智能体来源 |
| `server/app/activation/setup.py` | `install(app)`:订阅、Indexer、智能体来源 |
| `server/app/routers/activation.py` | `/api/activation/*` |
| `server/app/wordbook/examples.py` | `ExampleProvider` 端口 + 两个实现 |
| `server/alembic/versions/0030_activation.py` | `word_usage`、`segment_lemma` |
| `server/tests/test_activation_*.py`、`server/tests/test_wordbook_examples.py` | 见各任务 |
| `web/src/features/activation/**`、`web/src/plugins/activation/index.ts` | 网页页面、接口、i18n、插件登记 |

| 修改(共享锚点 / INDEX 指定的最小编辑) | 位置 |
|---|---|
| `server/app/core/learning_events.py` | 两个事件、`EVENT_TYPES`、`subscribe(flag=)`(R3、R5) |
| `server/app/core/config.py`、`settings_registry.py` | `activation_enabled` |
| `server/app/models.py` | 末尾追加 `WordUsage`、`SegmentLemma` |
| `server/app/main.py` | `install_activation(app)` 一行、路由表一行、lifespan 清扫任务一行 |
| `server/app/realtime/realtime_providers.py`、`server/app/routers/realtime.py` | `DbMessageStore(publish=)` 与传参 |
| `server/app/library/pipeline.py`、`library/worker.py`、`library/catalog_import.py` | `PipelineDeps.publish` 与两个就绪点 |
| `server/app/routers/library_catalog.py`、`routers/library.py` | 「添加」与「重新分句」后发布 |
| `server/app/admin/users_admin.py` | 删除用户时删 `segment_lemma` |
| `server/app/wordbook/quiz.py`、`wordbook/service.py` | `build_question(example=)`、`Question.clip`、`review_batch` 调端口、`question_out` |
| `server/tests/test_architecture.py`、`server/tests/background.py` | 层规则、`_task_sets` |
| `web/src/plugins/index.ts`、`web/src/features/wordbook/{wordbook-api.ts,choice-question.tsx}` | 插件一行;cloze 播放原片 |

## 3. 任务

### Task 0:开工检查(执行者第一步)

- [ ] **Step 1** — 确认 L3、L5 已合并:`git fetch` 后把 L4 分支 rebase 到含 L3、L5 的基线。
- [ ] **Step 2** — `cd server && uv run alembic heads`:必须只有一个头,且为 L5 的 `0029_*`(INDEX §3)。不是 → 在本文末尾写 `## Addendum (日期)` 记录实际头,迁移改为「头 + 1」,`down_revision` 接到实际头,文件名、`revision`、测试名一起改。
- [ ] **Step 3** — 核对事件缺口(本计划 §0 表格):
  `rg -n "learning_events.publish|\.publish\(learning_events" server/app` 只应命中 `conversations.py`、`speech.py`、`wordbook/service.py`;
  `rg -n "transcript_final" server/app/realtime` 只在 `realtime_session.py`;`rg -n "publish" server/app/library server/app/rooms/voice.py` 无事件发布。
  若 L1/L3/L5 已在别处加了发布点或改了 `learning_events.py`,先停下写 Addendum,再按 INDEX 协调。
- [ ] **Step 4** — 核对 L1 合并后的锚点仍在:`pipeline.py` 里 `row.sub_source, row.status ... = ..., "ready"` 之后的 `await s.commit()`;`catalog_import.py` 的 `status="ready"` UPDATE 与 `if done.rowcount != 1`。L1 把落盘改成 `put_file` 后,发布点仍放在**数据库 commit 之后**、与存储写入无关。
- [ ] **Step 5** — worktree 按根 `CLAUDE.md` 联接 `node_modules`;基线只跑本计划会碰的测试:
  `cd server && uv run pytest -q tests/test_learning_events.py tests/test_architecture.py tests/test_wordbook_quiz.py tests/test_wordbook_contract.py tests/test_realtime_providers.py tests/test_library_worker.py tests/test_library_catalog_import.py tests/test_migrations.py tests/test_admin_users.py`;
  `cd web && yarn vitest run src/features/wordbook src/plugins`。全绿再开工(不跑全量)。
- 无提交。

### Task 1:事件通道按订阅分闸 + 两个新事件

**Files:** Modify `server/app/core/learning_events.py`、`server/app/core/CLAUDE.md`(What lives here 一行)、`server/tests/test_learning_events.py`(追加)

- [ ] **Step 1: 写失败测试**(追加到 `test_learning_events.py`)
  - `subscribe(..., flag="activation_enabled")` 的订阅:`links_enabled=False, activation_enabled=True` → `publish` 返回 True 并被处理;两者都关 → `publish` 返回 False 且 `queue()["size"] == 0`(零成本)。
  - 同一事件一个 links 订阅 + 一个 activation 订阅,只开 links → activation 订阅计 `skipped`,links 照常 `handled`。
  - 不带 `flag` 的旧订阅行为不变(现有用例全部保留不改)。
  - `RealtimeTurnFinished` 的 `repr` 不含文字、`text` 截到 `MAX_TEXT`;`LibraryItemReady(user_id=None, catalog_id=...)` 可发布(按用户配额键 `None` 计)。
  - `subscribe(未知事件类型)` 仍抛 `ValueError`。
- [ ] **Step 2: 确认失败** — `cd server && uv run pytest -q tests/test_learning_events.py` → FAIL。
- [ ] **Step 3: 实现** — `_subs` 的元素改为 `(link, handler, flag)`;`publish` 先算 `active = [s for s in subs if getattr(settings, s.flag, False)]`,为空返回 False,只给 `active` 计 `published`;`_dispatch` 时 flag 已关 → `skipped += 1`。新增两个 frozen dataclass 与 `EVENT_TYPES`。仍只用标准库(`STDLIB_ONLY`)。模块 docstring 补一句「每个订阅有自己的总开关名,默认 `links_enabled`」。
- [ ] **Step 4: 验证** — `uv run pytest -q tests/test_learning_events.py tests/test_architecture.py` → PASS。
- [ ] **Step 5: 提交** — `feat(core): per-subscription master flags and two learning events for activation`

### Task 2:`ACTIVATION_ENABLED` 设置

**Files:** Modify `server/app/core/config.py`、`server/app/core/settings_registry.py`;Test `server/tests/test_settings_registry.py`、`server/tests/test_config.py`(追加)

- [ ] **Step 1: 写失败测试** — 默认 False;注册表有 `activation_enabled`(group `features`,`bool`,热更新,中文标签「词汇激活」,`help_zh` 写「关闭 = 没有激活统计、沉睡词页与原片例句」)。
- [ ] **Step 2: 确认失败** — `uv run pytest -q tests/test_settings_registry.py tests/test_config.py` → FAIL。
- [ ] **Step 3: 实现** — 字段放在 `library_enabled` 附近;`.env.example` 的占位行属于 L1 的样例文件(INDEX §6),在本任务结果里记一句交给控制者合并时补,不在本车道改。
- [ ] **Step 4: 验证** — 同上 + `tests/test_architecture.py` → PASS。
- [ ] **Step 5: 提交** — `feat(server): ACTIVATION_ENABLED switch (default off)`

### Task 3:迁移 0030 与模型

**Files:** Create `server/alembic/versions/0030_activation.py`、`server/tests/test_activation_models.py`;Modify `server/app/models.py`(文件末尾追加)、`server/app/admin/users_admin.py`(`USER_ROWS` 一项 + `:191` 旁一行)、`server/tests/test_migrations.py`(round-trip 用例)

- [ ] **Step 1: 写失败测试**
  - `test_models_match_migrations` 保持绿(新表在模型与迁移里一致);`test_0030_round_trip`:upgrade → downgrade → upgrade(SQLite batch + Postgres 安全路径)。
  - `WordUsage`:主键 `(user_id, lemma)`,`user_id` 外键 `users.id ON DELETE CASCADE`,`lemma String(100)`,`sources String(32)`,`last_session String(16) nullable`,索引 `(user_id, last_used_at)`。
  - `SegmentLemma`:主键 `(scope, owner_id, idx, lemma)`,`scope String(3)`,`owner_id String(36)`,`lemma String(100)`;索引 `(lemma, scope)`;无外键(R10)。
  - 删除用户:有 `word_usage` 行与自己条目的 `segment_lemma` 行的用户删掉后两者都为 0;别人的行不受影响(`tests/test_admin_users.py` 追加)。
- [ ] **Step 2: 确认失败** — `uv run pytest -q tests/test_migrations.py tests/test_activation_models.py tests/test_admin_users.py` → FAIL。
- [ ] **Step 3: 实现** — 迁移 `revision = "0030_activation"`,`down_revision` = Task 0 记下的头;`users_admin.py` 在删 `LibrarySegment` 之前 `delete(SegmentLemma).where(SegmentLemma.scope == "lib", SegmentLemma.owner_id.in_(<该用户条目 id 子查询>))`;`USER_ROWS` 追加 `(WordUsage, "user_id")`。
- [ ] **Step 4: 验证** — 同 Step 2 + `tests/test_architecture.py` → PASS。
- [ ] **Step 5: 提交** — `feat(server): migration 0030 word_usage and segment_lemma`

### Task 4:包骨架、层规则、接线与开关行为

**Files:** Create `server/app/activation/{__init__,CLAUDE.md,setup.py}`、`server/app/routers/activation.py`、`server/tests/test_activation_api.py`;Modify `server/tests/test_architecture.py`、`server/app/main.py`(三处锚点)、`server/app/CLAUDE.md`(层表一行)

- [ ] **Step 1: 写失败测试**
  - `test_architecture.py`:`LAYERS` 加 `"activation"`;`ALLOWED["activation"] = {"activation","core","models","providers","speech","services","wordbook","agents"}`;`routers`、`main` 允许导入 `activation`;新增 `test_activation_is_a_top_layer(tmp_path)`(仿 `test_links_is_a_top_layer`):`links`/`wordbook`/`library`/`agents` 导入 activation 必须报错,activation 导入 `links`/`library`/`rooms`/`realtime`/`rank` 必须报错,导入 `wordbook.store`/`agents.context` 通过。
  - `test_activation_api.py`:开关关 → `GET /api/activation/config` 200 `{"enabled": false}`,`GET /api/activation/words` 404 `{"error": "Activation is off"}`;开 → 两者 200;总线上 `activation.*` 订阅已登记(`bus.links()`),关时 `publish(MessageSent)` 在 `links_enabled=False` 下返回 False。
- [ ] **Step 2: 确认失败** — `uv run pytest -q tests/test_architecture.py tests/test_activation_api.py` → FAIL。
- [ ] **Step 3: 实现** — `setup.install(app)`:建 `Indexer`(Task 8 前为空壳)、订阅(Task 6/8 填)、智能体来源(Task 12 填);`require_activation` 依赖(404)。`main.py`:`install_links(app)` 之后、agents 锚点之后各加一行(`install_activation(app)`),路由表在 `links, agents, agents_tutor,` 附近加 `activation,`(在 `stubs` 之前),lifespan 加 `tasks["activation_purge"]`(Task 10 前先不加)。`activation/CLAUDE.md` 写:包职责、允许依赖、处理器契约(同 links:自己开会话、幂等、≤ 6 次往返、单查询 ≤ 200 行、不记词 / 文本 / 用户 id)、R2/R9/R10 陷阱。
- [ ] **Step 4: 验证** — 同 Step 2 → PASS。
- [ ] **Step 5: 提交** — `feat(server): activation top layer skeleton, routes gated by ACTIVATION_ENABLED`

### Task 5:匹配与状态(纯函数)

**Files:** Create `server/app/activation/matcher.py`、`server/app/activation/states.py`、`server/tests/test_activation_matcher.py`、`server/tests/test_activation_states.py`

- [ ] **Step 1: 写失败测试**
  - `candidates(text, lemma_of) -> set[str]`:`"She went and talked"` 在 `lemma_of={"went":"go"}` 下含 `go`、`talk`;`bed` 不产生 `be`(沿用 `lemma_candidates` 的反验);空文本 / 纯中文 → 空集;超过 `CANDIDATES_MAX = 200` 截断并返回截断标志。
  - `segment_lemmas(text, lemma_of) -> set[str]`:每词元一个原形,去停用词与长度 < 3。
  - `states.state_of(learned_at, usage, now)`:R8 每个边界(第 3 天、第 30 天、`session_count` 1 → 2)、无 usage 行、shadow 不影响状态。
  - `session_key("conv", id)` 是 16 位十六进制且不含原 id。
- [ ] **Step 2: 确认失败** — `uv run pytest -q tests/test_activation_matcher.py tests/test_activation_states.py` → FAIL。
- [ ] **Step 3: 实现** — 只用 `wordbook.textnorm`;`lemma_of` 由调用方注入(生产用 `lookup_service(app).forms.lemma_of`,调用前 `await forms.warm()`)。阈值常量注明「占位,待调」。
- [ ] **Step 4: 验证** — 同 Step 2 + `tests/test_architecture.py` → PASS。
- [ ] **Step 5: 提交** — `feat(server): activation matcher and usage states (placeholder thresholds)`

### Task 6:使用记录处理器(chat / realtime / shadow)

**Files:** Create `server/app/activation/usage.py`、`server/tests/test_activation_usage.py`;Modify `server/app/activation/setup.py`

- [ ] **Step 1: 写失败测试**(`links_helpers.drain` 同款:发布后 `await drain(app)`)
  - 用户已学 `talk`、`go`(`vocabulary_items` 带 `wordbook:` 来源)。`MessageSent("I went there and talked")` → `word_usage` 两行,`use_count=1`、`session_count=1`、`sources="chat"`;同会话再发一条 → `use_count=2`、`session_count=1`;换会话 → `session_count=2`。
  - 未学的词不建行;手动加入生词本(非 `wordbook:` 来源)的词不建行。
  - `RealtimeTurnFinished` → `sources` 含 `realtime`。
  - `AssessmentFinished(source="practice", good_words=("talk",))` → `shadow_count=1`,`use_count` 不变;`source="chat"` → 无变化。
  - **R9**:处理前后该用户全部 `vocabulary_items` 行逐列相等。
  - 并发首插冲突(两条事件同一新词)只重试一次、最终计数正确(仿 `pron_shadow.handle` 的 `IntegrityError` 重试)。
  - 开关关:处理器不跑(`skipped`),表为空。
- [ ] **Step 2: 确认失败** — `uv run pytest -q tests/test_activation_usage.py` → FAIL。
- [ ] **Step 3: 实现** — 三个 `handle_*` 共用 `_record(app, user_id, lemmas, *, kind, session)`:一次 `IN` 查已学词、一次 `IN` 查现有 `word_usage`、批量 upsert(SQLite / Postgres 通用写法:读后写 + `IntegrityError` 重试)。订阅名 `activation.chat`、`activation.realtime`、`activation.shadow`,`flag="activation_enabled"`。计数只经 `bus.count("activation.chat", "matched", n)`。
- [ ] **Step 4: 验证** — `uv run pytest -q tests/test_activation_usage.py tests/test_learning_events.py tests/test_architecture.py` → PASS。
- [ ] **Step 5: 提交** — `feat(server): record active word use from chat, realtime and shadowing`

### Task 7:实时通话补发 `RealtimeTurnFinished`

**Files:** Modify `server/app/realtime/realtime_providers.py`(`DbMessageStore`,`:192-237`)、`server/app/routers/realtime.py`(`:250`);Test `server/tests/test_realtime_providers.py`(追加)、`server/tests/test_activation_usage.py`(追加一个端到端用例)

- [ ] **Step 1: 写失败测试**
  - `DbMessageStore(..., publish=fake)`:`add_user("hello")` commit 后 `fake` 收到一次 `RealtimeTurnFinished`(`message_id` 与返回值相同);`add_assistant` 不发布;`MessageLimitError` / `ConversationGoneError` 路径不发布;`publish` 抛异常不影响 `add_user` 返回。
  - 不传 `publish`(默认 None)行为与今天逐字相同。
  - 日志(`caplog`,logger `app`)不含消息文字。
- [ ] **Step 2: 确认失败** — `uv run pytest -q tests/test_realtime_providers.py` → FAIL。
- [ ] **Step 3: 实现** — `__init__(..., publish: Callable[[Any], bool] | None = None)`;`add_user` 在 `_add` 返回之后(即 commit 之后)`try: self._publish(RealtimeTurnFinished(...)) except Exception: pass`。路由在 `routers/realtime.py:250` 构造时传 `publish=app.state.learning_bus.publish`。`realtime` 层只导入 `app.core.learning_events`(核心层,允许)。
- [ ] **Step 4: 验证** — `uv run pytest -q tests/test_realtime_providers.py tests/test_activation_usage.py tests/test_architecture.py` → PASS。
- [ ] **Step 5: 提交** — `feat(server): realtime calls publish RealtimeTurnFinished after saving a user turn`

### Task 8:句子倒排 Indexer 与 `LibraryItemReady` 处理器

**Files:** Create `server/app/activation/indexer.py`、`server/tests/test_activation_index.py`;Modify `server/app/activation/setup.py`、`server/tests/background.py`(`_task_sets` 追加 `getattr(state, "activation_indexer", None).pending`)

- [ ] **Step 1: 写失败测试**
  - `index_owner(app, "lib", item_id)`:3 句的条目 → 每句的原形行 + 一行 `idx=-1, lemma="#v1"`;再跑一次行数不变(幂等);句子改字后再跑 → 旧词元消失。
  - 精选库副本:`cat` 作用域已有索引时,副本按 `idx` 复制行(不调用分词:注入计数的 `lemma_of` 断言 0 次)。
  - `LibraryItemReady(user_id=1, item_id=...)` 发布 → `drain` + `drain_background` 后有索引;`catalog_id` 同理。
  - 待办满(> 200)时新任务被丢弃并计 `activation.index.overflow`,不抛错;开关关时不入队。
  - 日志不含句子文字。
- [ ] **Step 2: 确认失败** — `uv run pytest -q tests/test_activation_index.py` → FAIL。
- [ ] **Step 3: 实现** — R10/R11;每块 ≤ 500 句,分词 `asyncio.to_thread`;读句子按 `(item_id)` 或 `(catalog_id)` 一次一块;`Indexer.pending` 为 `set[asyncio.Task]`(自删除)。
- [ ] **Step 4: 验证** — `uv run pytest -q tests/test_activation_index.py tests/test_learning_events.py tests/test_architecture.py` → PASS。
- [ ] **Step 5: 提交** — `feat(server): segment_lemma index built off the bus on LibraryItemReady`

### Task 9:四个就绪点补发 `LibraryItemReady`

**Files:** Modify `server/app/library/pipeline.py`(`PipelineDeps` `:92-101` 加字段;`:357` commit 之后)、`server/app/library/worker.py`(`install`,`:245-248` 传参)、`server/app/library/catalog_import.py`(`:312` `rowcount` 检查之后)、`server/app/routers/library_catalog.py`(`:46-50`,`created` 为真时)、`server/app/routers/library.py`(`rebuild_item` 的 `await session.commit()` 之后,`:381`);Test `server/tests/test_library_worker.py`、`server/tests/test_library_catalog_import.py`、`server/tests/test_library_catalog_api.py`、`server/tests/test_library_rebuild.py`(各追加一个用例)

- [ ] **Step 1: 写失败测试** — 用注入的 `publish` 记录器(`PipelineDeps.publish`)或已开的总线:上传条目跑到 ready 发布一次 `LibraryItemReady(user_id, item_id)`;失败 / 取消(`Aborted`)不发布;精选库导入 ready 发布 `catalog_id`;「添加」只在 `created=True` 时发布;重新分句成功后发布。`PipelineDeps` 不传 `publish` 时与今天相同(默认空操作)。
- [ ] **Step 2: 确认失败** — 跑上面四个测试文件 → FAIL。
- [ ] **Step 3: 实现** — `publish: Callable[[Any], bool] = _no_publish`;worker 传 `lambda e: state.learning_bus.publish(e)`(读 `state` 时取,测试替换总线后仍生效);catalog 任务复用 `app.state.library.deps`(`catalog_jobs.py:35-36`),无需另传。请求内两处用模块级 `learning_events.publish`。全部 `try/except` 吞异常。**只**加这几行,不碰 L1 的落盘接缝。
- [ ] **Step 4: 验证** — 四个测试文件 + `tests/test_activation_index.py tests/test_library_privacy.py tests/test_architecture.py` → PASS。
- [ ] **Step 5: 提交** — `feat(server): library publishes LibraryItemReady at the four ready points`

### Task 10:回填命令与孤儿清扫

**Files:** Create `server/app/activation/backfill.py`、`server/app/activation/purge.py`、`server/tests/test_activation_backfill.py`;Modify `server/app/main.py`(lifespan 一行 `tasks["activation_purge"]`)

- [ ] **Step 1: 写失败测试**
  - 回填:两个用户条目 + 一个精选库条目,其中一个已有 `#v1` → 只处理另外两个;`--dry-run` 只计数不写;`--chunk 1` 分批提交;中途异常后再跑能补完(幂等);输出只有数字(无标题、无 id 以外的内容,无句子)。
  - 清扫:删掉一个 `library_items` 行后 `purge_orphans` 删它的 `segment_lemma`,不动别的;一次最多删 `PURGE_BATCH = 5000` 行。
  - 开关关:清扫循环什么都不做。
- [ ] **Step 2: 确认失败** — `uv run pytest -q tests/test_activation_backfill.py` → FAIL。
- [ ] **Step 3: 实现** — CLI 仿 `app.admin.changelog_import`(`argparse`,建引擎 → 循环 → 打印 `items=… rows=…`);直接调用 `index_owner`(不经总线)。`purge.daily_loop(app, interval=21600.0)` 仿 `links/purge.py:23`。
- [ ] **Step 4: 验证** — `uv run pytest -q tests/test_activation_backfill.py tests/test_activation_index.py tests/test_architecture.py` → PASS。**不**对真实数据运行回填。
- [ ] **Step 5: 提交** — `feat(server): activation backfill command and orphan sweep`

### Task 11:沉睡词列表与提示词选词接口 + 隐私测试

**Files:** Create `server/app/activation/words.py`、`server/tests/test_activation_privacy.py`;Modify `server/app/routers/activation.py`、`server/tests/test_activation_api.py`

接口(全部 `require_activation`;只读,`current_user`):
- `GET /api/activation/config` → `{"enabled": bool}`(不受开关限制)
- `GET /api/activation/words?state=dormant|sprouting|active&page=` → `{"state", "items": [{"word", "book_id", "learned_at", "last_used_at", "use_count"}], "counts": {"dormant","sprouting","active"}, "next_page": int | null}`(每页 50;`state` 是固定枚举,不是词)
- `GET /api/activation/prompt-hint?offset=` → `{"words": [...≤3], "block": str | null}`(R18;`offset` = 本地时区分钟,与 wordbook 同义)

- [ ] **Step 1: 写失败测试**
  - 列表三态与 R8 一致;按 `box` 降序再按学习时间;分页稳定;别人的词不出现。
  - `prompt-hint` 同一用户同一本地日结果稳定,换日变化;没有合格词 → `{"words": [], "block": null}`。
  - 契约:`tests/fixtures/activation_contract.json`(`CONTRACT_UPDATE=1` 录制,时间固定)。
  - `test_activation_privacy.py`:① 路由表无路径参数、查询参数只允许 `page`、`offset`、`state`;② caplog(DEBUG,logger `app`)跑遍三个接口 + 三个处理器 + Indexer + 回填 + 清扫,断言独特词(如 `zygomorphic`)、消息文字、用户 id 不出现;③ `bus.recent_errors()` 里只有类名。
- [ ] **Step 2: 确认失败** — `uv run pytest -q tests/test_activation_api.py tests/test_activation_privacy.py` → FAIL。
- [ ] **Step 3: 实现** — 每次请求 ≤ 3 条查询;`learned_at` = `vocabulary_items.created_at`。
- [ ] **Step 4: 验证** — `CONTRACT_UPDATE=1` 录一次(PowerShell:`$env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_activation_api.py; Remove-Item Env:CONTRACT_UPDATE`),再 `uv run pytest -q tests/test_activation_api.py tests/test_activation_privacy.py tests/test_architecture.py` → PASS。
- [ ] **Step 5: 提交** — `feat(server): dormant word list and prompt hint endpoints`

### Task 12:智能体来源 `dormant_words`

**Files:** Create `server/app/activation/agent_source.py`、`server/tests/test_activation_agent_source.py`;Modify `server/app/activation/setup.py`

- [ ] **Step 1: 写失败测试**
  - 开关开、有沉睡词 → `SourceResult("agents.step.dormant_words", {"count": n, "words": [...≤3]}, block)`,`block` 是英文指令「学习者认识但还没用过的词;自然地创造机会让对方用上一两个,不要列出、不要考」;开关关 → None 且不开数据库会话(注入的 sessionmaker 断言未调用)。
  - `private is True`;在 `runtime(app).registry.keys()` 中;`AGENTS_TOOLS_MODE=off` 时 `agents.context.enabled` 返回 False(沿用现有规则,不改 agents)。
  - 取消安全:`prefetch` 超时取消时无半写状态(只读,本就没有写)。
- [ ] **Step 2: 确认失败** — `uv run pytest -q tests/test_activation_agent_source.py` → FAIL。
- [ ] **Step 3: 实现** — 复用 `words.hint_words`;`setup.install` 里 `runtime(app).registry.register(DormantWords(app))`(`agents.orchestrator.runtime`,同 `links/agent_sources.py` 的导入方式)。`main.py` 只需 Task 4 的那一行,且必须位于 `agents_runtime(app)`(`main.py:111`)之后。
- [ ] **Step 4: 验证** — `uv run pytest -q tests/test_activation_agent_source.py tests/test_agents_context.py tests/test_architecture.py` → PASS。
- [ ] **Step 5: 提交** — `feat(server): agents context source with 2-3 dormant words`

### Task 13:`ExampleProvider` 端口(`wordbook/examples.py`)

**Files:** Create `server/app/wordbook/examples.py`、`server/tests/test_wordbook_examples.py`;Modify `server/app/wordbook/CLAUDE.md`(What lives here 一行 + 陷阱一条)

接口(冻结名 `ExampleProvider`):

```python
@dataclass(frozen=True)
class Clip:
    item_id: str
    start_ms: int
    end_ms: int

@dataclass(frozen=True)
class ContextExample:
    en: str
    zh: str | None
    start: int          # 目标词在 en 里的起止(字符)
    end: int
    clip: Clip | None   # 只有用户自己的库句子才有

class ExampleProvider(Protocol):
    async def cloze_example(self, session, user_id: int, card: WordCard, reps: int) -> ContextExample | None: ...

def provider_for(settings) -> ExampleProvider: ...
```

- [ ] **Step 1: 写失败测试**
  - `DictionaryExampleProvider` 对 `tests/fixtures/wordbook/mini.jsonl` 的每张卡,结果与 `quiz.cloze_example` 逐字段一致(`clip is None`)。
  - `LibraryExampleProvider`:用户条目里有 `"I talk to my neighbor every single morning"`(8 词)→ 返回该句、`clip` 正确;5 词句、17 词句、`flags` 非空的句、`low_confidence` 条目、`status != ready` 条目、**别人的**条目、只以变形出现(`talked`)的句 → 都不选,回落词典;`segment_lemma` 行过期(句子已改字)→ 校验失败不选。
  - 稳定:同 `(user, key, reps)` 选同一句;换 `reps` 可能换句;**`question_rng` 的状态不被消耗**(调用前后从同一种子生成的序列相同)。
  - `provider_for`:`activation_enabled` 或 `library_enabled` 任一为假 → Dictionary。
  - 层:`examples.py` 不导入 `app.library` / `app.activation`(架构测试已覆盖)。
- [ ] **Step 2: 确认失败** — `uv run pytest -q tests/test_wordbook_examples.py` → FAIL。
- [ ] **Step 3: 实现** — R13;一次 join 查询(`segment_lemma` × `library_segments` × `library_items`)限 50 行;句子文字只在内存。
- [ ] **Step 4: 验证** — `uv run pytest -q tests/test_wordbook_examples.py tests/test_wordbook_quiz.py tests/test_architecture.py` → PASS。
- [ ] **Step 5: 提交** — `feat(server): wordbook ExampleProvider port with dictionary and library providers`

### Task 14:复习 cloze 题接上端口(`quiz.py` / `service.py` 最小编辑)

**Files:** Modify `server/app/wordbook/quiz.py`(`Question` `:24-29` 加 `clip`;`build_question` `:129-153` 的 cloze 分支 `:142-148`)、`server/app/wordbook/service.py`(`question_out` `:264-266`;`_question` `:313-326` 加 `example=` 透传;`review_batch` `:344-363`);Test `server/tests/test_wordbook_quiz.py`、`server/tests/test_wordbook_examples.py`、`server/tests/test_wordbook_contract.py`(追加)

- [ ] **Step 1: 写失败测试**
  - `build_question("cloze", card, ds, rng, example=ctx)`:`prompt.sentence` 用 `ctx.en` 挖空,`prompt.zh` = `ctx.zh or ""`,`options` 与不传 `example` 时**逐字相同且顺序相同**(同一种子);`Question.clip` = `ctx.clip`。
  - 不传 `example` → 与今天逐字相同(现有 `test_wordbook_quiz.py` 全部不改)。
  - `review_batch`:开关开且用户库里有合格句 → cloze 题带 `"clip": {"item_id","start_ms","end_ms"}`;其他题型、开关关、无合格句 → 没有 `clip` 键。
  - 作答:带 `clip` 的 cloze 题按原选项作答,`/answers` 判分与 `QTYPE_MISMATCH` 规则不变(R15)。
  - 契约:新增录制用例 `review_cloze_clip`(开关开 + 一条假库条目);默认用例逐字不变(`CONTRACT_UPDATE=1` 只新增键)。
- [ ] **Step 2: 确认失败** — `uv run pytest -q tests/test_wordbook_quiz.py tests/test_wordbook_examples.py tests/test_wordbook_contract.py` → FAIL。
- [ ] **Step 3: 实现** — `build_question(..., example: ContextExample | None = None)`(`quiz.py` 只导入 `examples` 的数据类,不导入 DB);`review_batch` 里只在 `qtype == "cloze"` 时 `await provider_for(settings).cloze_example(session, user_id, card, row.reps)`。`learn_batch`、`free_start`、`_rating_answer` 不动(第二步)。`cloze.py` 不改(R15)。
- [ ] **Step 4: 验证** — 录契约一次后:`uv run pytest -q tests/test_wordbook_quiz.py tests/test_wordbook_examples.py tests/test_wordbook_contract.py tests/test_wordbook_api.py tests/test_architecture.py` → PASS。
- [ ] **Step 5: 提交** — `feat(server): review cloze questions may use the learner's own clip`

### Task 15:网页「沉睡词」页与入口

**Files:** Create `web/src/features/activation/{index.ts,CLAUDE.md,activation-api.ts,activation-api.test.ts,activation-contract.test.ts,use-activation-config.ts,dormant-page.tsx,dormant-page.test.tsx,me-row.tsx,register.ts,i18n/en.json,i18n/zh-CN.json,i18n.test.ts}`、`web/src/plugins/activation/index.ts`;Modify `web/src/plugins/index.ts`(一行)

- [ ] **Step 1: 写失败测试**
  - `activation-api.test.ts`:`fetchActivationConfig`、`fetchWords(state, page)`(URL 只有 `state`、`page`)、失败返回 null 且不 toast。
  - `activation-contract.test.ts` 逐键核对 `server/tests/fixtures/activation_contract.json`。
  - `dormant-page.test.tsx`:三段切换(`SegmentedControl`),计数、空态(`EmptyState`)、加载更多;配置关 → 跳 `/practice`;配置未到 → 什么都不渲染;每个词行可点开词卡(复用 `wordDetailSections` 的现有入口,不导入 wordbook)。液态玻璃:只用 `~/components/liquid` 的 `LQ_*` 与 `liquid:` 类,正文文字在 `.plate` 上(Rule 4),不新增常驻模糊层(`styles/glass-budget.test.ts` 保持绿)。
  - `me-row.tsx`:配置开才渲染「沉睡词 n」一行。
  - i18n:`web.activation.*` 中英键一致;另含 `web.agents.step.dormant_words`(智能体步骤名,放本目录,按 glob 合并)。
- [ ] **Step 2: 确认失败** — `cd web && yarn vitest run src/features/activation src/plugins` → FAIL。
- [ ] **Step 3: 实现** — `register.ts`:`contribute({ point: "meRows", id: "activation.row", order: 85, component: MeRow })`、`contributeRoute({ id: "activation.page", path: "/me/activation", component: lazy(DormantPage) })`;不写 `link` / `requiresLinks`(激活不是联动,由组件自己读 `/api/activation/config` 决定显示)。`plugins/activation/index.ts` 只 `import "~/features/activation/register"`;`plugins/index.ts` 加一行。主包增量 ≤ 8 kB gzip(页面懒加载)。
- [ ] **Step 4: 验证** — `cd web && yarn vitest run src/features/activation src/plugins src/i18n src/architecture.test.ts && yarn typecheck` → PASS。
- [ ] **Step 5: 提交** — `feat(web): dormant words page and Me entry behind ACTIVATION_ENABLED`

### Task 16(用户已同意归 L4;**须排在 L6『联机并入对话』合并之后**,因两者都改 `features/chat/conversation-page.tsx`):普通对话 / 实时通话注入沉睡词

**原因:** 这两条路径的系统提示词在网页拼(`conversation-page.tsx:743`、`:1426`),要改 `web/src/lib/extension-points.ts`(加非 UI 的提示补充点)与 `features/chat`,都不归 L4(INDEX §6)。

**Files(确认后):** Modify `web/src/lib/extension-points.ts`(新增 `contributePromptHint({ id, load(signal) })` 与 `collectPromptHints(signal, timeoutMs = 300)`,纯 TS)、`web/src/features/chat/conversation-page.tsx`(两处:`coach` 拼接与实时 `start.systemPrompt` 拼接)、`web/src/features/activation/register.ts`(登记 `GET /api/activation/prompt-hint` 的 loader)

- [ ] **Step 1: 写失败测试** — 无登记 / 超时 / 失败 → 提示词逐字不变;有登记 → 追加一段英文指令(≤ 300 字符),实时 `systemPrompt` 仍受 `START_LIMITS.systemPrompt` 截断;同一会话内只取一次。
- [ ] **Step 2–4** — `cd web && yarn vitest run src/lib src/features/chat src/features/activation` → PASS。
- [ ] **Step 5: 提交** — `feat(web): chat and realtime prompts may mention dormant words`

### Task 17(已解除阻塞:INDEX §4 已补事件):房间语音转写计入主动使用

**Files(补充后):** `server/app/core/learning_events.py`(第三个事件)、`server/app/rooms/voice.py`(`VoiceDeps` `:57-69` 加 `publish`;`:208-215` `status == "done"` 之后发布,发送者 = `sender_id`)、`server/app/routers/rooms_voice.py`(`install` `:89` 传 `app.state.learning_bus.publish`)、`server/app/activation/usage.py`(`activation.room` 订阅,`session` = 房间)

- [ ] **Step 1–5** — 测试 `tests/test_rooms_voice_service.py`(追加)、`tests/test_activation_usage.py`;提交 `feat(server): room voice transcripts count as active word use`。在 INDEX 更新前**不开工**。

### Task 18:复习 cloze 播放原片(网页)

**Files:** Modify `web/src/features/wordbook/wordbook-api.ts`(`Question` `:32` 加 `clip?: { item_id: string; start_ms: number; end_ms: number }`)、`web/src/features/wordbook/choice-question.tsx`(cloze 分支 `:86-89` 下加 `ClipButton`)、`web/src/features/wordbook/wordbook-contract.test.ts`;Create `web/src/features/wordbook/clip-button.tsx`、`clip-button.test.tsx`

- [ ] **Step 1: 写失败测试**
  - 没有 `clip` → 不渲染按钮(旧服务端 / 开关关逐像素不变)。
  - 有 `clip`:点击时 `POST /api/library/items/{item_id}/media-ticket`(经 `~/api` 客户端;**不**导入 `features/library`,架构测试的跨 feature 基线不增加)→ 用返回的 `url` 建 `<audio>`,`currentTime = start_ms/1000`,到 `end_ms` 暂停;再次点击重播;票据失败 → 按钮置灰、无 toast;卸载时停止并释放。
  - 票据 URL 不进 console(测试 spy `console.*`)。
  - 契约:`review_cloze_clip` 用例的 `clip` 三个键类型正确。
- [ ] **Step 2: 确认失败** — `cd web && yarn vitest run src/features/wordbook` → FAIL。
- [ ] **Step 3: 实现** — 在用户手势内 `primeAudioElement`(iOS,见 `web/CLAUDE.md`);文案键放 `features/wordbook/i18n`(`web.wordbook.clip.play`,中英)。
- [ ] **Step 4: 验证** — `cd web && yarn vitest run src/features/wordbook src/architecture.test.ts && yarn typecheck` → PASS。
- [ ] **Step 5: 提交** — `feat(web): play the original clip in review cloze questions`

## 4. 顺序与依赖

Task 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 18;Task 16 已获同意(排在 L6 之后);Task 17 已解除阻塞(INDEX 已补事件)。

- 1 是一切订阅的前提;3 先于所有写表的任务;8 先于 9(发布前要有订阅,否则测试只能断言发布);13 依赖 8 的表与 10 无关;14 依赖 13;18 依赖 14 的契约用例。
- 服务端任务 1–14 只碰本计划列出的文件;共享文件(`main.py`、`models.py`、`test_architecture.py`、`background.py`、`users_admin.py`、`plugins/index.ts`)只在锚点追加,合并冲突手工解决并记入 results 文档(INDEX §6)。
- 与 L1:`pipeline.py` / `catalog_import.py` 只加发布行,L1 的 `put_file` 接缝不动;若 L1 改动了就绪处的结构,以「数据库 commit 之后」为准重新定位。
- 与 L3:不导入调度代码;`quiz.py` / `cloze.py` 的例句选择处归 L4,L3 不改;`build_question` 签名只追加关键字参数。
- 与 L5:只读 `library_segments.text / start_ms / end_ms / flags`,不读 `speaker`。

## 5. 第二步(本期不做,写清楚以免误以为遗漏)

1. 拼写句组(`cloze.py`)用库句子:需放宽 `SENTENCE_ID`(`routers/wordbook.py:167、183`)并在 `spell_submit` 按属主重查句子;编辑点归 L4。
2. cloze 资格放宽到「只有库句子的词」:需要让 `_allowed_qtypes` 在答题时也能确定性重算(可能要带例句来源标记),避免 409。
3. 学新词 / 自由复习的 cloze 也走端口(`learn_batch`、`free_start`)。
4. 精选库(`cat` 作用域)作为未添加用户的文字例句来源(无片段)。
5. 每用户开关、管理端激活统计视图。
6. 主动使用影响调度(R9 明确 v1 不做;如要做,须先有回放数据)。
7. Task 16、Task 17。

## 6. 风险与未验证项

- **阈值全是占位**(R8、R18、R13 的 6–16 词):未用真实用户数据校准。**未验证。**
- **词形覆盖**:`forms.txt` 只含七本书原形的变形;`lemma_candidates` 是规则法,同形异义(`saw`)可能误计;短语动词 / 多词词条不检测(spec §2.6 接受)。**未验证**误检率。
- **事件丢失**:总线进程内、重启丢未处理事件、队列满丢弃;`word_usage` 计数是尽力而为,不做回放去重(无 `event_id` 去重表)。可接受,因为状态只用于提示。
- **索引规模**:每句约 5–10 行;大库(数千句)一次重建的耗时与 SQLite 写放大**未测**;Indexer 一次一个、分块,不阻塞总线。回填在生产上的耗时**未验证**,只在用户要求时运行。
- **孤儿窗口**:单条目删除后 `segment_lemma` 最多保留到下次清扫(≤ 6 小时间隔);读侧 join 保证不可见,行里只有词元与 id,无文字。
- **过期索引**:手动改句子不重建索引;读侧重新 `find_form` 校验,只会漏选不会错选。
- **iOS 播放原片**:在复习页用票据 URL 起 `<audio>` 并跳到 `start_ms`,iOS Safari 的手势解锁与 Range 精度**未在真机验证**;视频条目只放音轨。
- **西语文案**:已裁定不做(R19)。
- **管理端**:`links/admin_view.py` 只遍历 `LINKS`,`activation.*` 订阅不会显示统计行,但会出现在「最近错误」与 doctor 的熔断计数里(只有类名)。可接受;是否加激活视图属第二步。
- **INDEX 待补**:房间语音事件(R14);`.env.example` 的 `ACTIVATION_ENABLED` 占位行归 L1 的样例文件,需控制者在合并时补一行。
- **`core/learning_events.py` 改动**:INDEX §6 没有列出它的所有者;本计划按 INDEX §4「新增事件由各自车道发布」把它当共享锚点,只追加,`subscribe` 默认参数保证现有行为不变。若控制者另有安排,以 INDEX 为准。

## 7. 设备清单(真机)

- iPhone(iOS Safari,PWA 与浏览器各一次):复习 cloze 播放原片(Task 18)——首次点击能出声、只播该句、切题停止。
- 任一安卓 Chrome:同上。
- 以上全部**未验证**,结果写入本车道 results 文档。
