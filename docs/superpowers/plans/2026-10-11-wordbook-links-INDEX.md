# 背单词 v2 + 学习联动 · 三份计划的总索引(INDEX)

- 日期:2026-10-11 · 分支:`plans-v2`(自 `feat/self-hosted-backend` 2236645d,依次合并 `plan-recall`、`plan-goals`、`plan-links`)
- 本文是三份计划之间的**唯一裁决来源**:三份计划和 spec 里与本文不一致的地方,以本文为准(三份计划都已按本文改过,并在末尾加了「Index reconciliation」小节)。
- 只是文档,没有产品代码。

## 0. 目的

A、B、C 三份计划是并行写的,彼此没看过对方。本文把它们对齐成**能按 A → B → C 顺序执行**的一套计划:

1. 迁移号链(§5);
2. 两份以上计划都改的文件:谁先改、合并后长什么样、后改的计划锚点还在不在(§4);
3. 语义冲突:`answer()` 规则、事件 kind、`WordAnswered` 发布、段位点(§3);
4. 设置注册表键、i18n 前缀、测试 id(§6、§7);
5. 跨计划的测试核对(§9)、合并后的风险(§10)、验证矩阵(§11)与真机清单(§12)。

## 1. 三份计划

| | 名称 | spec | 计划 | 视觉稿 | 任务 | 车道 | 迁移 |
|---|---|---|---|---|---|---|---|
| **A** | 三档自评(认识 / 模糊 / 不认识)+ 复习「快速回忆」 | `specs/2026-10-11-wordbook-recall-design.md` | `plans/2026-10-11-wordbook-recall.md` | `design/wordbook-recall-v1/mockup.html` | 15(S1–S6、W1–W7、Z1–Z2) | 3:S、W、Z | 无 |
| **B** | 每日目标设置面板(范围、方案、加练、暂停、重置、连续达标) | `specs/2026-10-11-wordbook-goals-design.md` | `plans/2026-10-11-wordbook-goals.md` | `design/wordbook-goals-v1/mockup.html` | 11 个实施任务(GS1–GS5、GW1–GW6)+ 评审 Z1 | 3:GS、GW、Z | 无 |
| **C** | 学习联动(核心事件通道、`app/links/` 顶层、网页扩展点 / 插件、每用户开关、六个联动) | `specs/2026-10-11-learning-links-design.md` | `plans/2026-10-11-learning-links.md` | `design/learning-links-v1/mockup.html` | 26(Task 0、F1–F7、L6-1/2、L1-1…3、L2-1/2、L3-1/2、L4-1/2、L5-1…3、LA-1/2、Z1–Z2) | 9:F、L6、L1、L2、L3、L4、L5、LA、Z | `0013_learning_links`(`down_revision = "0012"`) |

合计 53 个任务、15 条车道。

## 2. 合并顺序与跨计划等待

**权威合并顺序:A 全部 → B 全部 → C 全部。** 各计划内部顺序不变(A:S1…S6 → W1…W7 → Z1 → Z2;B:GS1…GS5 → GW1…GW6 → Z1;C:Task 0 → F1…F7 → L6 → L1 → L2 → L3 → L4 → L5 → LA → Z1 → Z2)。

「开发」可以提前,「合并」不能越过前一个计划。下表是后一个计划的任务**必须等**的前一个计划的任务(没列出的任务只碰本计划独占文件,可与前一个计划并行开发,合并时 rebase):

| 后来的任务 | 必须等 | 原因(共享文件 / 依赖) |
|---|---|---|
| B GS1(`plan.py`)、B GW1(`goals-math.ts`) | 无 | 独占文件;可与 A 并行 |
| B GS2 | A S2 | `config.py` / `settings_registry.py` 的背单词段相邻插入 |
| B GS3、GS4 | A S4(实际取 A 的 S 车道全部合并) | `service.py` 的 `_learn_kind`、`answer()`、`config_out`;`store.py` 末尾 |
| B GS5 | A S6 | 契约录制接在 A 的 `answer_recall` / `answer_check` 之后 |
| B GW2 | A W1、A W7 | `wordbook-api.ts`(`WordbookConfig` 追加)、`wordbook-contract.test.ts` |
| B GW3、GW4 | A W3、A W5 | 两份 wordbook i18n JSON |
| B GW6 | A Z1 | 合并后的 `wordbook.spec.ts` 与学新词流程、`docker-compose.e2e.yml` |
| C Task 0 | A、B 全部合并(只在**合并前**检查) | `alembic heads` 必须是 `0012` |
| C F1、F3、F4、F6 | 无 | 独占文件(`core/learning_events.py`、迁移、`models.py`、`app/links/`、`lib/extension-points*`);A、B 不碰 `models.py`/`main.py`/迁移目录 |
| C F2 | B GS2 | 设置注册表 / `config.py`:C 追加在 A、B 的背单词段之后 |
| C F5 | A S4、B GS3 | `service.py` 的两个 `answer` 发布点要落在 A、B 合并后的形状上 |
| C F7 | A W3 | `word-card.tsx` 的新锚点 |
| C L2-2 | B GW2 | 需要 `DayPlan.goalMet` 类型与 `goals-test-fixtures.ts` |
| C L3-1 | A S4 | 易错词要认识 A 的 outcome |
| C L4-1 | B GS3 | `today_learned_keys` 改为 `{learn, relearn}` |
| C Z1 | A Z1 | `docker-compose.e2e.yml` 已有 A 的 env 行 |

## 3. 权威规则表

### 3.1 `/answers` 处理顺序(A + B 合并后,C 只附加发布)

| 步 | 规则 | 来源 |
|---|---|---|
| 1 | `book_or_fail`;`_validate`:`known:true` 只能 `mode=learn`(否则 422 `Known is only for new words`);`qtype=recall` 必须有合法 `rating`(422 `Rating is required`) | v1 review、A |
| 2 | `known:true` 改写为 `qtype=recall, rating=know, revealed_before=false, elapsed_ms=null`(同样受抽查) | A R-R7 |
| 3 | 读卡;`learning = mode=learn 且该用户没有这个词的行` → 必须是当前在学的书(409)且 `_day_plan(..., settings=settings).new_left > 0`(429)。`new_left` 含 B 的有效值夹取、今日加练、积压封顶、剩余词数 | v1 M1、B GP-1 |
| 4 | 到期复习的题型校验:v1 允许的题型 ∪ {`recall`(设置开且 `use_recall` 命中)} | v1 m2、A P-R2 |
| 5 | `consume_answer`(每人每 UTC 日 3,000 次;A 的抽查 pending 也扣一次) | v1、A R-R6 |
| 6 | `qtype=recall` → `_rating_answer`;否则 v1 客观题路径 | A |
| 7 | 新词建行的事件 kind 由 `_learn_kind` 决定(**两条路径共用**):该用户第一次学这个词 → `learn`;以前学过(别的书、删掉、重置后)→ `relearn` | **R-A2**(A 抽函数,B 改返回值) |
| 8 | 提交后:每写一条作答记录发布**恰好一次** `WordAnswered`(见 §3.4) | **R-E1**(C) |

### 3.2 盒子与 `reps`(合并后)

| 情形 | 写入 | `reps` / `last_reviewed_at` | 事件 kind |
|---|---|---|---|
| 新词自评:认识(未偷看、未抽中) | 盒 2,+4 天 | 0 / null | `learn` 或 `relearn` |
| 新词自评:认识被抽中(含 < 1 秒必抽) | 盒 1,+2 天(`outcome=know_chk`) | 0 / null | 同上 |
| 新词自评:模糊 / 偷看后认识 | 盒 1,+2 天 | 0 / null | 同上 |
| 新词自评:不认识 / 连续两次模糊 | 盒 0,+1 天 | 0 / null | 同上 |
| v1 客观题学新词(旧客户端) | 盒 0,+1 天 | 0 / null | 同上 |
| 当天新词的小测答错 / 抽查答错 | `set_learn_box` → 盒 0(`lapses + 1`) | **不加** / 不写 | `practice` |
| 当天抽查答对(`know_chk` 且盒 1) | `set_learn_box` → 盒 2 | 不加 / 不写 | `practice` |
| 当天再评(「记错了」等) | 只降不升 | 不加 / 不写 | `practice` |
| 到期复习(任何题型,含快速回忆 good/hard/forgot、抽查第二步) | `apply_review` | **+1** / 写 → 产生 `vocab_review` | `review` |
| 复习抽查第一步(pending) | 不写 | 不变 | **无事件** |
| 未到期:答对 / 认识 / 模糊 | 不改(R-W5) | 不变 | `practice` |
| 未到期:答错 / 不认识 / 「记错了」 | `apply_lapse`(盒 0 已忘则不写) | **不加**(v1 review B1) | `practice` |
| 盒 3 → 4(进入已掌握) | 只能由客观题完成;快速回忆不出现在盒 0 与盒 3 | | |
| C「加入词书学习」 | 新建盒 0、立即到期的行 | 0 | **无事件**(不计今日新词、无段位点) |

### 3.3 `wordbook_events.kind` 总表

| kind | 谁写 | 计入 `new_done` | 段位点 | 发布 `WordAnswered` |
|---|---|---|---|---|
| `learn` | `answer()` 两条学新词路径(`_learn_kind`) | 是 | `word_learned` +1(每词每人一生一次) | 是 |
| `relearn`(B) | 同上,以前学过 | 是 | 无 | 是(`kind="relearn"`) |
| `review` | 到期复习写入成功(`answer` / `spell_submit`) | 否 | 经 `vocabulary_items.reps` 产生 `vocab_review` +1 | 是 |
| `practice` | 未到期作答、当天小测 / 抽查 / 再评 | 否 | 无 | 是 |
| `blank` | `spell_submit` 未写盒的词 | 否 | 无 | 是 |
| `spell_set` | `spell_submit` 组完成 | 否 | `spelling_set` +2 | **否** |
| `bonus`(B) | `POST /bonus`(`credit` = 加练数) | 否(提高目标) | 无 | **否** |
| `goal`(B) | `GET /today` 达标时一天一行 | 否 | 无(与段位 `streak_7` 无关) | **否** |
| `reset`(B) | `POST /enrollment/reset` | 否 | 无 | **否** |

`new_done` = 今天(用户本地日)本书 `kind ∈ {learn, relearn}` 的**不同词数**。`new_target = 夹过的 daily_new + 今日加练`;积压时今天新词总数(含加练)≤ 5;不超过本书剩余新词数(B G-3、G-5)。

### 3.4 `WordAnswered` 发布(R-E1、R-E2)

- 发布点只有三处(四个附加点,都在 `await session.commit()` 之后):`answer()` 客观题路径;A 的 `_rating_answer()` 末尾提交之后(pending 分支已提前 return,不发布);`spell_submit()` 每个作答词一条。
- 每条作答记录恰好一次;`spell_set`、`bonus`、`goal`、`reset` 不发布;同一请求不重复发布;发布永不影响响应(总开关关时立即返回)。
- 字段:`kind ∈ {learn, relearn, review, practice, blank}`;`qtype` 含 `recall`;`outcome` = 写入事件的 outcome(客观题 `correct/typo/inflection/wrong`,自评 `know/know_chk/fuzzy/unknown`;旧行才有 `known`);自评 `credit = 100 if 有效评级 == know else 0`。

### 3.5 易错词怎么读 outcome(R-E3)

| outcome / kind | 易错词 |
|---|---|
| `wrong`、`inflection`(任何 kind) | 算错:`wrong_count + 1`、`ok_streak = 0`、重新打开 |
| `unknown` 且 `kind ∈ {review, practice}`(复习忘了、抽查答错、「记错了」、当天再评) | 算错 |
| `unknown` 且 `kind ∈ {learn, relearn}`(新词第一次标不认识) | 中性(新词不是错题) |
| `correct`、`know`、`known`(旧行) | 算对:`ok_streak + 1`,满 2 移出 |
| `fuzzy`、`know_chk`、`typo` | 中性 |

### 3.6 段位点(R-P*)

| 规则 | 内容 |
|---|---|
| R-P1 | 共享每日上限 `rank_daily_rp_cap`(默认 60)不变;`CAPPED` 既有种类(`assessment`、`voice_turn`、`chat_turn`、`vocab_review`、`word_learned`、`spelling_set`)照旧 |
| R-P2 | A:快速回忆与其它题型一样,**每次到期复习写入成功 1 点**(`vocab_review`,因为 `reps + 1`);抽查 pending、当天新词的小测 / 抽查 / 再评、未到期作答都**不**得分;「记错了」不收回已得的那 1 点(open,见 §13) |
| R-P3 | B:`relearn`、`bonus`、`goal`、`reset` 都不得分;重置前在路由层同步段位,已入账的点、成就不收回;加练学的新词照常 `word_learned`,与其它来源共享 60 点 |
| R-P4 | C:唯一新来源 `word_in_chat`(默认 1 点),只为 **`learn`** 事件记一次(唯一 `(user_id, learn_event_id)`),`relearn` 不是「今日词」;每人每 24 小时最多记 10 个用词;联动来源子上限 `sources_daily_cap = 5`,并且只吃共享上限的**剩余**额度:`grant = min(points, cap − core_used − extra_used, 5 − extra_used)`;既有种类的点数永不因联动减少,当天总和最坏是 `cap + 5`(spec C §5.4 已接受);联动来源不进阶段任务、活跃日、连续天数 |
| R-P5 | C 的易错词、发音弱词、「加入词书学习」不产生任何段位点 |

### 3.7 每日上限汇总

作答 3,000 次 / 人 / UTC 日(A 的 pending 计入)· 每日新词 `daily_new`(1–200,管理员可收窄)+ 加练(每次 ≤ 20,每天 ≤ `wordbook_bonus_max` 50)· 积压时新词总数 ≤ 5 · 设置 / 暂停 / 继续 / 加练共 60 次 / 人 / UTC 日 · 重置 2 次 / 人 / UTC 日 · 段位点 60 / 本地日(+ 联动最多 5)· 对话今日词 10 个 / 24 小时 · 易错词 / 弱词各活跃 ≤ 200。

### 3.8 其他裁定

- **R-D1** 「今天已学」口径与「今日新词」列表:`today_counts`、`today_learned_keys` 都按 `{learn, relearn}`(B);C 的跟读「今日新词例句」随之包含 `relearn`;C 的「对话用今日词」只认 `learn`(R-P4)。
- **R-T1** C 的今日任务「背单词」行完成 = `plan.goal_met ∨ (new_left = 0 ∧ review_left = 0)`;`plan` 为 null(B 的暂停 / 未选书)时整行不出现。
- **R-G2** B 的「约 N 天学完 / 稳定后每天复习 5N」按「新词进盒 0、全对」估算;A 让「认识」直接进盒 2,估算因此偏保守,数字与测试值不改。
- **R-W1** C 的 `wordDetailSections` 插槽只在词卡未遮罩时渲染(遮罩时不泄露释义相关内容);快速回忆正面没有插槽,背面有。

## 4. 共享文件:顺序与合并后形状

「锚点」= 后来的计划用来定位插入点的原文;都已核对在前一个计划改完之后仍然存在(不存在的已在后来的计划里改掉,见各计划的 Index reconciliation)。

| 文件 | 改的计划(顺序) | 合并后的形状 / 锚点 |
|---|---|---|
| `server/app/wordbook/service.py` | A → B → C | 导入:A 加 `replace`、`INTERVAL_DAYS`、`recall`、`use_recall`;B 加 `date`、`WORDBOOK_*_BOUNDS`、`GoalLimits`、`WordbookEvent`;C 在导入块末尾加 `learning_events`。错误常量:A 的 `RATING_REQUIRED`;B 的一组接在 `REPORT_LIMIT` 后。`config_out` 键序 `enabled, ai_available, defaults, learn(A), limits(B), books`。`enrollment_out` / `put_enrollment` / `_day_plan(..., *, settings=None)` / `today_out`:B 改写(A、C 不碰)。`learn_batch`:A 加 `drill`,B 在 `left = (await _day_plan(...)).new_left` 一行加 `settings=settings`。`review_batch`:A 加 `recall_ok`,B 在 `.review_left` 一行加 `settings=settings`。`answer()`:A 的分派(§3.1),B 在新词检查的 `_day_plan(...)` 加 `settings=settings`,C 在 `await session.commit()` 与 `# Ruling Z-e` 之间加发布。A 新增 `_answer_out`、`_learn_kind`(B 改其返回 `relearn`)、`_learn_day_quiz`、`_rating_answer`(C 在末尾 `commit()` 与 `checked = …` 之间加发布)、`_create_learned`。`spell_submit`:C 加 `answered` 列表与提交后的发布循环。文件末尾:B 的 `# ---- 每日目标(goals v2)----` 段 |
| `server/app/wordbook/store.py` | A → B | A:导入加 `timedelta`、`INTERVAL_DAYS`;末尾 `# ---- 背单词 v2 · 三档自评` 段(`last_rating`、`first_rating_on`、`set_learn_box`)。B:导入加 `delete`;`enroll()` 的 `or` 改 `is not None`;`today_counts` / `today_learned_keys` 改 `kind.in_(LEARN_KINDS)`;A 的段之后追加 `# ---- 每日目标` 段。C 不改(L4-1 只调用 `today_learned_keys`) |
| `server/app/routers/wordbook.py` | A → B | A:`ReviewIn.recall`、`AnswerIn.qtype/rating/revealed_before/elapsed_ms`、两处调用加参数。B:导入与 `NEW_MIN…REVIEW_MAX`、`EnrollmentIn` 放宽 + `review_unlimited`、末尾 5 个端点、`_settle_rank`(路由层导入 `app.rank`)。C 不改 |
| `server/app/core/config.py` | A、B → C | 背单词段最终顺序:`wordbook_enabled, wordbook_ai_enabled, wordbook_books, wordbook_daily_new(1–200), wordbook_review_cap(10–1000), [B 的 6 个范围键], wordbook_ai_model, wordbook_ai_global_daily, wordbook_ai_daily_per_user, [A 的 4 个键], wordbook_data_dir`;模块常量 `WORDBOOK_NEW_BOUNDS/REVIEW_BOUNDS`(B)在 `WORDBOOK_BOOK_IDS` 后;C 的 15 个键接在 `wordbook_data_dir` 之后 |
| `server/app/core/settings_registry.py` | A、B → C | `GROUPS`:C 在 `("wordbook", "背单词")` 后加 `("links", "学习联动")`。背单词条目:B 把 `wordbook_daily_new` / `wordbook_review_cap` 两条换成八条(原位);A 的 4 条在 `wordbook_ai_daily_per_user` 之后、`# admin` 之前;C 的 15 条在 `_ALL` 末尾 |
| `server/app/core/runtime_settings.py` | B | `runtime_problems` 加两条交叉校验 |
| `server/tests/wordbook_helpers.py` | A | `enable_wordbook` 默认 `wordbook_spot_check_pct=0`(B、C 的背单词测试因此不被抽查打乱) |
| `server/tests/test_wordbook_contract.py` + `fixtures/wordbook_contract.json` | A → B | `collect(app, client, tmp_path, monkeypatch)`;顺序:v1 流程 → A 的 `answer_recall` / `answer_check`(插在 `out["card"]` 之前,之后 `use_recall` 被打桩、`wordbook_spot_check_pct=100`)→ `card` → `explain_unavailable` → B 的 `out \|= await collect_goals(client, h)` → `return`。`KEYS` 含 A 的两个键;断言 `KEYS \| GOALS_KEYS`。B 的流程在 A 之后仍成立(今天已学 6 个 ≥ 新的每日 5 个、到期词只有一两个、远低于复习上限,加练可用)。每个计划合并时用 `CONTRACT_UPDATE=1` 重录一次。C 不碰(它有自己的 `links_*_contract.json`) |
| `server/tests/test_wordbook_learn.py` / `test_wordbook_api.py` / `test_wordbook_learn_limits.py` | A / B / B | A:「我认识」outcome 改 `know`。B:`/today` 新键、`daily_new: 1` 合法、`delete_then_relearn` 期望 `relearn`(依赖 R-A2) |
| `server/tests/test_settings_registry.py`、`test_migrations.py`、`test_architecture.py` | C | A、B 只依赖既有规则;C 追加测试、单 head 断言 `0012 → 0013`、`links` 分层 |
| `server/app/models.py`、`server/app/main.py`、`server/app/core/deps.py`、`server/app/admin/users_admin.py`、`server/app/rank/{ledger,rules}.py` | C | 只有 C 改;B 的路由调用 `ledger.sync`(签名不变,C 的附加四行在 `_sync` 内部,B 的重置前同步因此也会入账联动来源) |
| `web/src/features/wordbook/wordbook-api.ts` | A → B | A:`QType` + `recall`、`Rating`、`AnswerInput` / `AnswerResult` 追加、`WordbookConfig` 启用分支追加 `learn`、`learnBatch` 加 `drill`、`reviewBatch` 第三参数、错误表加一条。B:`WordbookConfig` 启用分支**再追加** `limits`(不整体替换)、`Enrollment` / `DayPlan` / `Today` 追加、错误表追加 13 条、末尾新函数。C 不改 |
| `web/src/features/wordbook/test-fixtures.ts` | A | `CONFIG` 加 `learn`;B 用独立的 `goals-test-fixtures.ts`(展开 `CONFIG`,自动带上 `learn`);C 的 L2-2 测试用 B 的 `GOAL_MET_TODAY` |
| `web/src/features/wordbook/wordbook-contract.test.ts` | A → B | `ANSWER` 键表加 3 键 + A 的 `it`;`TODAY` / `PLAN` / `ENROLLMENT` 加键 + B 的 `it`(两个 `it` 并存) |
| `web/src/features/wordbook/i18n/{zh-CN,en}.json` | A → B | A:`learn.*` 追加、删除 `learn.known`、新增 `recall` 对象(在 `quiz` 后)。B:新增 `goals` 子树、改 `home.settings` 文案。C 不改(文案在插件目录 `web.links.*`) |
| `web/src/features/wordbook/word-card.tsx` | A → C | A:`covered`、`onReveal`、`showExample`、`badge`、`regionRef`,释义 / 例句 / 短语包进 `{covered ? … : <div id={regionId}>…</div>}`。C:文件头导入 `Slot`;该块之后、`</SurfaceCard>` 之前 `{covered ? null : <Slot point="wordDetailSections" … />}` |
| `web/src/features/wordbook/{learn-page,review-page,session-machine,session-summary}.tsx/ts` | A | 只有 A |
| `web/src/features/wordbook/{home-page,books-page,use-today}.tsx/ts` | B | 只有 B |
| `web/src/features/practice/practice-page.tsx`、`web/src/pages/me-page.tsx`、`web/src/app.tsx`、`web/src/main.tsx`、`web/src/test/setup.ts`、`web/src/architecture.test.ts` | C | 只有 C(B 的 spec 里「可能改」实际没有改) |
| `server/app/wordbook/CLAUDE.md`、`web/src/features/wordbook/CLAUDE.md` | A → B | 各自在 What lives here / Pitfalls 末尾追加,A 的条目在前 |
| `server/app/CLAUDE.md`、`server/app/core/CLAUDE.md`、`server/app/rank/CLAUDE.md`、`server/app/links/CLAUDE.md`、`web/src/CLAUDE.md`、`web/src/features/CLAUDE.md`、`web/src/plugins/CLAUDE.md`、`server/README.md` | C | 只有 C |
| `web/README.md`、`docs/superpowers/plans/e2e-results.md` | A → B → C | 各自追加段落 |
| `docker-compose.e2e.yml` | A → C | server env:A 加 `WORDBOOK_SPOT_CHECK_PCT: "100"`,C 加 `LINKS_ENABLED: "true"` |
| `web/e2e/wordbook.spec.ts` | A | 学新词步骤改为「模糊」→ 下一个;B、C 的 E2E 各自定义学词步骤,不改它 |

## 5. 迁移链(统一)

| 号 | 内容 | `down_revision` | 计划 |
|---|---|---|---|
| 0012 | wordbook(现有 head) | 0011 | 已合并 |
| — | A:不新增(评级写在 `wordbook_events.outcome` / `qtype`) | | A |
| — | B:不新增(「不限」= `review_cap = 0`;新 kind 写进 `wordbook_events`) | | B |
| **0013** | `0013_learning_links`:`user_link_prefs`、`link_mistake_words`、`link_weak_words`、`link_word_uses`、`link_credits` | **0012** | C |

- **I-M1** C 的 Task 0:`alembic heads` 必须输出 `0012`。
- **I-M2 顺延规则**:如果 A 或 B 在实施中被迫加迁移,它取「当时 head + 1」(A 先:`0013`;B 其后),并在自己计划末尾写 Addendum;C 的迁移顺延为「C 开工时的 head + 1」,同时改:文件名、`revision` / `down_revision`、docstring、`test_00NN_learning_links_tables_round_trip` 的名字与 `upgrade/downgrade` 目标、`test_0011_…` 里的单 head 断言、C spec §10 / §15 / §17 / L-R11、C 计划 Global Constraints / Task 0 / F3 / 验收 7。
- `test_migrations.py::test_models_match_migrations` 在每个计划合并后都要绿。
- **I-M3 v1 背单词计划里的远期迁移号作废**:`plans/2026-10-10-wordbook.md` 的 P2-2(`0013_wordbook_passages`)与 P3-3(`0014_wordbook_custom`)是尚未排期的第二 / 三阶段任务,它们写下的号与本链冲突。开工时一律取「当时 head + 1」(C 合并后至少是 `0014` / `0015`),`down_revision` 取当时 head;本索引不改那份计划,开工者在其 Addendum 里记录实际号。

## 6. 设置注册表键

| 命名空间 | 计划 | 键 | 交叉校验 |
|---|---|---|---|
| `wordbook_*`(组「背单词」) | A | `wordbook_spot_check_pct`(33,0–100)、`wordbook_recall_enabled`(true)、`wordbook_autoplay`(true)、`wordbook_show_example`(true) | 无 |
| `wordbook_*`(组「背单词」) | B | 放宽 `wordbook_daily_new`(20,1–200)、`wordbook_review_cap`(100,10–1000);新增 `wordbook_daily_new_min/max`(1/200)、`wordbook_review_cap_min/max`(10/1000)、`wordbook_review_unlimited`(true)、`wordbook_bonus_max`(50,0–200) | `runtime_problems`:`daily_new_min ≤ daily_new ≤ daily_new_max`、`review_cap_min ≤ review_cap ≤ review_cap_max` |
| `links_*`(通道级)/ `link_<key>_*`(单个联动,组「学习联动」) | C | `links_enabled`(false)、`link_{word_actions,daily_tasks,mistakes,pron_shadow,chat_words,rank_sources}_enabled`(true)、`links_queue_max`、`links_handler_timeout_ms`、`links_breaker_failures`、`links_breaker_cooldown_seconds`、`links_retention_days`、`link_chat_words_daily_max`、`link_chat_words_llm_enabled`(false,danger)、`link_chat_words_llm_global_daily`(danger) | 无 |

- 无重复键;A、B 的键全在 `wordbook_` 下且互不重名;C 的测试 `{k for k in Settings.model_fields if k.startswith(("links_", "link_"))}` 不会误收 A、B 的键。
- 交叉校验不冲突:B 的两条只涉及 B 的键;A 的 `wordbook_spot_check_pct` 是单值范围;C 的 `sources_daily_cap` 在段位规则里(不是设置键),与 `link_chat_words_daily_max` 无约束关系。
- 全部 `apply="hot"`、经 `admin/settings_service.save` 写审计;只有 C 的大模型两项带 danger。

## 7. i18n 前缀与测试 id

- 前缀互不重叠:A 只在 `web.wordbook.learn.*`、`web.wordbook.recall.*`(并删除不再使用的 `web.wordbook.learn.known`,B、C 都不用它);B 只在 `web.wordbook.goals.*`(外加改 `web.wordbook.home.settings` 文案);C 在各插件目录的 `web.links.<x>.*`(feature 里的 `register-*.tsx` 也引用 `web.links.*`),外加 `features/rank` 一个标签与管理端 `strings.ts`。
- 服务端错误映射:A、B 追加到 `WORDBOOK_SERVER_ERRORS`(A 一条、B 十三条,原文不重复);C 用独立的 `LINKS_SERVER_ERRORS`(`Wordbook is disabled` 在两张表里含义相同,各自翻译)。
- 测试 id 无冲突:A `recall-cover`、`recall-card`、`rating-badge`、`summary-ratings`(并复用既有 `word-card`、`question-word`、`session-summary`);B `goals-*`、`wordbook-streak`、`wordbook-paused`(复用 `wordbook-action-learn`、`wordbook-legend`、`wordbook-book-junior`);C `daily-tasks-card`、`daily-task-<id>`、`notebook-mistakes`、`source-chip-*`、`me-links`、`<原 testId>-more`、`mistake-*`、`weak-*`。

## 8. E2E 栈

`docker-compose.e2e.yml` 的 server env 最终多两行:`WORDBOOK_SPOT_CHECK_PCT: "100"`(A)与 `LINKS_ENABLED: "true"`(C)。所有学新词的 E2E(`wordbook.spec.ts`、`wordbook-recall.spec.ts` 里不测抽查的部分、`wordbook-goals.spec.ts`、`links.spec.ts`)用「模糊」学词,结果与抽查比例无关。C 的 Z1 在打开总开关后重跑全部既有规格。

## 9. 跨计划测试核对(已逐条读过)

| 测试 | 与谁交互 | 结论 |
|---|---|---|
| B `test_wordbook_goals_api.py` / `_actions.py` 的 `learn()`(`known: true`) | A 的别名 → `_rating_answer` | 夹具默认不抽查 → 盒 2、+4 天,`goal_met` / 积压 / 加练断言不变;**但 relearn 必须改在 `_learn_kind`**(已改 B GS3) |
| B `test_relearn_counts_toward_the_daily_limit`、`test_reset_clears_only_this_books_rows_and_keeps_history`、v1 `test_delete_then_relearn_does_not_log_the_word_again` | A 的 `_rating_answer` | 依赖 R-A2;A 的 `last_rating` 不受插入的旧 `learn` 行影响(`qtype` 不是 `recall`) |
| A `test_rerating_the_same_day_only_lowers`(期望 `learn, practice, practice`、`new_done == 1`) | B 的 relearn | 再评时行已存在,走 `practice`,B 之后仍成立 |
| A `test_rating_on_a_new_word_obeys_the_daily_new_limit`(`PUT daily_new: 5`) | B 的范围校验 | 5 在 1–200 内,B 的积压修正不触发 |
| A / B 的契约录制 | 彼此 | 见 §4 契约行:B 的 `collect_goals` 在 A 的打桩之后仍然 200 |
| C `test_wordbook_answer_publishes_one_event_after_commit`(v1 选择题学新词) | A | 仍走客观题路径:`kind="learn"`、`outcome="wrong"` |
| C `test_spell_submit_publishes_one_event_per_word`(用 `known: true` 学词) | A | 学词走 `_rating_answer`(会各发布一条,测试在提交拼写前 `rec.seen.clear()`,不受影响) |
| C 新增 `test_rating_answers_publish_once_and_pending_checks_do_not` | A | 锁定 R-E1 |
| C `test_links_matrix.py` | A、B | `strip()` 去掉时间;B 的 `review_unlimited` 等新键在各开关组合下相同 → 仍逐键一致 |
| C `test_links_mistakes.py` 端到端(v1 选择题答错) | A | `kind="learn"`、`outcome="wrong"` → 进入;新增自评规则用例 |
| C `test_links_chat_words.py` | B | 新增 relearn 不算今日词用例 |
| C L2-2 的「背单词」行测试 | B | 改用 `goalMet`,用 B 的 `GOAL_MET_TODAY` |
| C `test_rank_extra_sources.py` 与「既有段位测试零改动」 | A、B | A、B 都不改 `test_rank_*.py`;`git diff` 的基线取 A、B 合并后的 main |

## 10. 合并后的风险

| 风险 | 来源 | 对策 |
|---|---|---|
| 两条学新词路径的 kind 不一致(relearn 漏掉) | A × B | R-A2:只有 `_learn_kind` 决定;B 的三个测试覆盖两条路径 |
| 联动漏掉或重复发布自评作答 | A × C | R-E1:三处发布点 + 新测试;pending 不发布 |
| 易错词被新词「不认识」淹没 / 「认识」不能移出 | A × C | R-E3 规则表 + 用例 |
| 重置 → 重学 → 对话刷联动段位点 | B × C | R-P4:只认 `learn`;子上限 5;每日 10 个 |
| 加练后今日任务从「完成」退回 | B × C | R-T1:用 `goal_met` |
| C「加入词书学习」绕过每日新词数(不写 learn,但让用户每天多进很多词)并可能触发积压保护 | B × C | 无段位点、`limited_user` 限流;积压保护会让当天新词降到 5;产品待定(§13) |
| E2E 栈 100% 抽查 / 联动全开影响其他规格 | A × B × C | 全部用「模糊」学词;C 的 Z1 重跑全部规格 |
| 契约样例三次重录互相覆盖 | A × B | 严格按 A → B 合并,每次合并后重录;C 不碰该样例 |
| `GET /today` 写 `goal`(有副作用的 GET),C 的今日任务卡也会触发 | B × C | 幂等(一天一行)、维护模式不写 |
| 「记错了」不收回已得的 `vocab_review` 点 | A | 每日上限兜底;收回要改段位账本(不在本期) |
| B 的估算对 A 的高盒入口偏保守 | A × B | R-G2,只多估不少估 |
| 迁移号再次冲突(含 v1 计划 P2-2 / P3-3 预写的 0013 / 0014) | 全部 | §5 I-M2、I-M3 顺延规则 |
| 多进程:联动偏好缓存 30 秒、事件通道每进程一条 | C | 文档化;处理器幂等 |
| 进程重启丢未处理事件 | C | 尽力而为;关键积分读源表 |
| 主包体积 | C | 插件懒加载,验收 ≤ 8 kB gzip 增长 |
| 上游 402 | C | 大模型用法检查默认关,开了也降级 |

## 11. 评审 / 验证矩阵

每个计划合并前跑各自的评审波(`/code-review high`、`security-review`、视觉对照);三份全部合并后在同一分支跑下表。

| 场景 | 设置 | 必须成立 |
|---|---|---|
| 1 全关 | `wordbook_enabled=false`、`links_enabled=false` | 既有全部测试通过;背单词接口 404;网页与合并前逐字节相同(C 的 `parity` / `links-matrix` 测试) |
| 2 只背单词 | `wordbook_enabled=true`、`links_enabled=false` | A:遮罩 / 三档 / 本轮小测 / 快速回忆 / 抽查;B:面板、加练、暂停、重置、连续达标;`/answers` 规则按 §3;`learning_bus` 队列为空、联动表零行 |
| 3 背单词 + 联动全开 | 再加 `links_enabled=true`(六个默认开) | 六个联动按 C spec §6;每条作答记录一条事件;易错词按 R-E3;今日任务「背单词」行按 R-T1;段位按 R-P4 |
| 4–9 每个联动单独开 | `links_enabled=true` + 只开 `link_<key>_enabled` | 只有该联动的入口、接口、表写入;其他联动 404 / 跳过(C 的 `test_links_matrix.py` 与 `links-matrix.test.tsx` 参数化) |
| 10 联动开、背单词关 | `wordbook_enabled=false`、`links_enabled=true` | 单词操作面板只有「加入生词本」「跟读这个词」;今日任务无「背单词」行;易错词无新增(无事件);对话今日词为空 |
| 11 A 的开关 | `wordbook_recall_enabled ∈ {T,F}` × `wordbook_spot_check_pct ∈ {0, 33, 100}` | 关:复习不出快速回忆、进行中的 recall 作答 422;0:不抽查(含太快必抽);100:每个「认识」都抽查 |
| 12 B 的范围收窄 | `wordbook_daily_new_max=50`、`wordbook_review_unlimited=false`、`wordbook_bonus_max=0` | 旧值读取时夹取、不回写;「不限」按上限;加练按钮禁用并写原因 |
| 13 旧客户端 | 不带 `recall`、用 `known:true` | 出题与 v1 相同;`known` 受抽查;B 的新键对旧网页无影响 |
| 14 维护模式 | `maintenance_mode=read_only` | 不写 `goal`;重置前不同步段位 |
| 15 迁移 | `alembic upgrade head` / `downgrade 0012` / `upgrade head` | 单 head `0013`;往返通过 |

全量命令:`cd server && uv run pytest -q`;`yarn web:typecheck && yarn web:test && yarn web:build`;`cd admin && yarn vitest run && yarn build`;E2E `yarn web:e2e --project=chromium-mobile`(E2E 栈,零上游)。

## 12. 真机清单(合并后一次走完;结果写进 `docs/superpowers/plans/e2e-results.md`,没验证的标「未验证」)

| 设备 / 环境 | 检查项 | 来自 |
|---|---|---|
| iPhone Safari + 主屏 PWA | 学新词:第一次点击后自动朗读可用、「不认识」点击后立即发声;三键 dock 与 Home 条 / Tab 栏不重叠;深色下遮罩与卡片可区分 | A §8.4 |
| iPhone Safari + 主屏 PWA | 目标面板:底部抽屉滑入、焦点困住、关闭后回到齿轮;重置确认输入框键盘不遮住红色按钮 | B §12.3 |
| iPhone Safari + 主屏 PWA | 「更多」底部面板打开 / 焦点回归 / 滚动穿透;「跟读这个词」跳转后录音权限仍在手势内;升级后 `/me/links`、`/links/mistakes`、`/links/weak-words` 可直达 | C §19 |
| 安卓 Chrome(中低端)+ **Gboard** | 快速回忆翻面动画不卡、玻璃 dock 不闪;步进器 `inputmode="numeric"` 弹出数字键盘、回车提交;练习页多一张卡后的滚动与玻璃顶栏;360px 宽下三个自评键各 ≥ 104px | A、B、C |
| 安卓 + **搜狗输入法** | 步进器输入全角数字(`３５`)被接受;重置确认框中文书名输入(拼音组字过程中不提前比对,组字结束后按钮才可点) | B §12.3 |
| **VoiceOver**(iOS) | 遮罩读「显示释义,已折叠」并能展开;自评结果只播报一次;方案卡 `radiogroup` 读出天数与复习估算;今日任务行读出完成状态;联动开关读出「管理员已关闭」 | A、B、C |
| TalkBack(安卓) | 同上(`aria-expanded`、`role="switch"` 的播报差异) | A、C |
| 两平台深色模式 | 遮罩 `surface-2`、琥珀 / 青色小标对比度 ≥ 4.5:1 | A、C |
| 真实上游(非 E2E 栈) | 「今日新词例句」跟读照常扣评测与录音配额 | C §19 |

## 13. 仍待决定(默认裁定已写进各 spec,不阻塞执行)

1. A §13:抽中的「认识」先记盒 1(可改 `PENDING_BOX`);复习不可偷看;快速回忆占比 40% 是常量;「记错了」不收回段位点。
2. B §17:达标不含拼写;加练只加新词;无连续冻结;重置换新种子;暂停时练习页大卡不显示「已暂停」(C 没有改大卡,§17.7 仍开着)。
3. C §18:聊天语音评测不收进发音弱词(L-R3);对话今日词用滚动 24 小时(L-R4);正确使用不算复习(L-R5);子上限 5(L-R6);总开关默认关(L-R7)。
4. 本索引新提出、需产品负责人确认的:R-E3(新词第一次标「不认识」不进易错词)、R-P4(重学的词不算「今日词」)、C「加入词书学习」不受每日新词数约束是否可以接受。
5. 全部真机项目前都是「未验证」。
6. v1 背单词计划(`plans/2026-10-10-wordbook.md`)P2-2 / P3-3 预写的迁移号 0013 / 0014 已被本链占用,开工时按 §5 I-M3 取新号(本索引未改那份计划)。
