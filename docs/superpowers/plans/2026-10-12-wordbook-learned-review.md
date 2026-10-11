# 背单词 · 已学词页 + 随时自由复习 Implementation Plan

> **执行前先读 `docs/superpowers/plans/2026-10-12-agents-INDEX.md`:合并顺序、迁移链与跨计划冲突的裁决以它为准(与本计划冲突时,INDEX 优先)。**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 背单词首页新增「已学 N 词」入口,进入「已学词」页:熟练度分布条(点分段即筛选)、词书 / 易错 / 学习日期 / 英文前缀搜索筛选、游标分页列表、点一行打开词卡;并提供「自由复习」(昨天学的 / 最近 7 天 / 一本书 / 一个熟练度 / 易错词 / 随机抽 N 个 × 翻卡浏览、快速回忆、选择题、拼写)。自由复习不改盒子、不加段位点、不占每日复习上限、不计连续达标;答错的词在受限条件下改为「现在到期」进入正式复习队列。无数据库迁移,主包不因代码增长。

**Architecture:** 服务端新增纯模块 `app/wordbook/learned.py`(熟练度分档、易错判定、游标、日期窗口,无 I/O);`store.py` 末尾追加已学词分页 / 汇总 / 抽取池 / 「拉到今天到期」与两个计数器(无新表,计数用现有 `daily_usage`);`quiz.py` 追加两个纯函数(自由选择题题型、可拼写判定);`service.py` 追加 `learned_summary`、`learned_list`、`learned_card`、`free_start` 与 `/answers` 的 `free` 分支 `_free_answer`(与学新词 / 复习的 `_answer` 主路径完全隔离);`routers/wordbook.py` 追加 4 个端点(`GET /learned/summary`、`POST /learned/query`、`POST /learned/card`、`POST /free/start`)与 `AnswerIn.mode="free"`。网页在 `features/wordbook/` 内新增 `box-bar.tsx`、`use-learned.ts`、`learned-page.tsx`、`free-review-sheet.tsx`、`free-browse.tsx`、`free-batch.ts`;已学词页走 `lazy-pages.tsx`,复习页加 `?source=free`(批次经路由 state 传入,不进 URL)。

**Tech Stack:** FastAPI + SQLAlchemy 2 async + pydantic v2 + pytest-asyncio(Python 3.12,uv);React 18 + react-router + Tailwind 3 + Radix Dialog(`BottomSheet`)+ vitest + Testing Library + lucide-react;Playwright。不新增依赖,不新增迁移。

**Spec:** `docs/superpowers/specs/2026-10-12-wordbook-review-and-room-reopen-design.md` 第一部分(本计划只实现第一部分;第二部分归 R 计划)。项目规范:`docs/superpowers/specs/2026-10-12-agents-design.md` §11。前置:`2026-10-11-wordbook-recall`(三档自评、`_rating_answer`)、`2026-10-11-wordbook-goals`(`_day_plan`、计划事件口径)、`server/app/links/CLAUDE.md`(词不进 URL)。

## Global Constraints

- **迁移:不新增。** `alembic heads` 保持 `0013`;`0014` 归 R 计划。已学词读 `vocabulary_items`,作答流水写现有 `wordbook_events`(`kind="practice"`),计数器用现有 `daily_usage`。若实施中证明必须加列,先停下来改本计划与 INDEX,不要自行取号。
- **合并顺序(跨计划):W(本计划)→ R → A1 → … → A5**。本计划是第一个合并的,不依赖任何别的新计划;共享文件的锚点见下节,后合并的计划在本计划基础上追加。
- **盒子编号以代码为准:存储盒子是 0–5**(`INTERVAL_DAYS` 六项,`next_review` 封顶 5,盒 0 =「刚忘了」)。规格里的「盒子 1–6」按 0–5 理解:新学 = 盒 0–1,巩固中 = 盒 2–3,熟练 = 盒 4–5(与首页「已掌握」`plan.MASTERED_BOX = 4` 一致)。见 R-L1。
- **自由复习不得成为新的刷分路径**(见 R-L6、R-L7):自由作答永不调用 `apply_review` / `apply_lapse` / `set_learn_box`,所以永不改盒子、`reps`、`last_reviewed_at`(段位的 `vocab_review` 读的正是后两者);事件 `kind` 固定 `practice`(段位只读 `learn` / `spell_set`,计划只数 `learn`、`relearn`、`review`);「答错 → 今天到期」只改 `due_at`,且受 24 小时静默期与每人每 UTC 日 20 次的上限约束。
- **词、用户文本、英文前缀永不进 URL 与日志**(沿用 `links/CLAUDE.md`:「只读查询也用 POST + JSON 体」):新端点的查询参数只允许 `tz_offset_minutes`,路径参数不允许;`q` 只在 POST 体里(R-L4)。`caplog` 与路由内省测试覆盖每个新端点。
- **主包体积:新页面全部走 `lazy-pages.tsx`;**首页那一行、自由复习面板、浏览组件都在已有的懒加载块里。不可避免的主包增量只有三处:`lazy-pages.tsx` 一行、`index.ts` 导出、`app.tsx` 一条路由,以及 i18n JSON(`web/src/i18n/index.ts` 用 `import.meta.glob(..., { eager: true })` 把所有 `i18n/*.json` 并进主包,所以新增文案**必然**进主包)。验收口径(R-L13):用 `yarn web:build` 对比基线,主包 gzip 增量 ≤ 1.5 kB(其中代码 ≤ 0.2 kB,文案 ≤ 70 个键 × 中英);超出就删文案,不放宽。
- **i18n:** 新文案全部在 `web.wordbook.learned.*`(`web/src/features/wordbook/i18n/{zh-CN,en}.json`),中英齐全,英文计数用 `_one/_other`,英文标签在 360–375 px 下不换行溢出;页面测试设 `zh-CN` 并断言中文。
- **CLAUDE.md:** 每个新文件组更新对应的 `CLAUDE.md`(`server/app/wordbook/CLAUDE.md`、`server/app/routers/CLAUDE.md`、`web/src/features/wordbook/CLAUDE.md`),在各车道最后一个任务里完成。
- **契约:** 新增响应形状进 `server/tests/fixtures/wordbook_contract.json`(`CONTRACT_UPDATE=1` 重录),网页 `wordbook-contract.test.ts` 逐键核对,**不得 skip**。响应里没有以词(或书 id)为键的映射:`by_book` 是列表。
- **分层不变:** `tests/test_architecture.py`、`web/src/architecture.test.ts` 不放宽、不改。`learned.py` 只导入 `app.wordbook.plan`;`wordbook` 层仍不导入 `rank` / `links`。
- **不新增上限设置**(规格 §1.3):自由作答共用现有 `ANSWERS_DAILY_MAX`(3,000 / UTC 日);本计划额外加的两个计数器是 `store.py` 里的常量(`FREE_STARTS_DAILY_MAX = 200`、`FREE_PULLS_DAILY_MAX = 20`),不进设置注册表。
- 每个任务结束:`cd server && uv run pytest -q <任务列出的测试> tests/test_architecture.py`;涉及网页:`yarn web:typecheck && cd web && yarn vitest run src/features/wordbook src/architecture.test.ts`。车道合并前全量 `cd server && uv run pytest -q` 与 `yarn web:typecheck && yarn web:test && yarn web:build`。提交 conventional(`feat(server): …`、`feat(web): …`、`test(e2e): …`、`docs: …`),一个任务一个逻辑提交,信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。
- **验证口径(如实):** 写计划时只读了代码,**没有运行任何测试**;下面的测试与实现是按读到的真实代码写的,执行者第一次运行时以真实结果为准修正(尤其是 React 组件测试里的选择器、`createFetchMock` 对未登记路由的行为、SQLite 与 Postgres 的日期比较)。Postgres、真机、真实上游、反向代理 WebSocket 一律标「未验证」,见验证矩阵。

---

## 文件结构与共享文件插入点

```
server/app/wordbook/learned.py                    新:熟练度分档、易错判定、游标、日期窗口、常量(纯)
server/app/wordbook/quiz.py                       末尾追加:free_choice_qtype、free_spellable
server/app/wordbook/store.py                      末尾追加:LearnedRow、learned_page、learned_counts、free_pool、
                                                  pull_eligible、pull_due、consume_free_start、consume_free_pull
server/app/wordbook/service.py                    常量段 + 5 个错误;learned_summary / learned_list / learned_card /
                                                  free_start;_answer 里 3 行 free 分支;_free_answer
server/app/routers/wordbook.py                    AnswerIn.mode 加 "free";4 个端点
server/tests/test_wordbook_learned.py             新(纯规则)
server/tests/test_wordbook_learned_store.py       新(数据层)
server/tests/test_wordbook_learned_api.py         新(汇总 / 列表 / 词卡 / 隐私)
server/tests/test_wordbook_free_start.py          新
server/tests/test_wordbook_free_answers.py        新(规则表、刷分防护)
server/tests/test_wordbook_contract.py            + LEARNED_KEYS、collect_learned
server/tests/fixtures/wordbook_contract.json      重录
server/app/wordbook/CLAUDE.md  server/app/routers/CLAUDE.md   追加

web/src/features/wordbook/
  wordbook-api.ts                                 追加类型与 4 个函数、AnswerInput.mode、错误表
  i18n/{zh-CN,en}.json                            web.wordbook.learned 子树(W1 一次写完)
  learned-test-fixtures.ts                        新(snake_case 样例,只给测试)
  box-bar.tsx  use-learned.ts                     新
  learned-page.tsx                                新(懒加载页)
  free-review-sheet.tsx  free-browse.tsx  free-batch.ts   新
  review-page.tsx                                 ReviewSession 拆分 + source=free
  session-summary.tsx                             + note / homeLabel 两个可选 prop
  home-page.tsx                                   + 「已学词」一行
  lazy-pages.tsx  index.ts                        各一行
  *.test.ts(x)  wordbook-contract.test.ts  i18n.test.ts
web/src/app.tsx                                   + 一条路由
web/src/test/render.tsx                           route 对象可带 search(只追加)
web/src/features/wordbook/CLAUDE.md               追加
web/e2e/wordbook-learned.spec.ts                  新
```

| 共享文件 | 本计划的插入点(只追加,后合并的计划以此为锚点) |
|---|---|
| `server/app/wordbook/service.py` | 常量:`CONFIRM_MISMATCH = …` 这一行**之后**追加 5 个错误常量;import:`from app.wordbook import plan as planning` 之后加 `from app.wordbook import learned`,`from app.services.vocabulary import …` 一行加 `normalize_word`,`quiz` 的 import 括号里追加 `free_choice_qtype, free_spellable`;`import secrets`(与 `import random` 相邻);`_answer` 里 `_validate(p)` 之后插入 3 行 free 分支;`_rating_answer` 函数之后、`# ---- 按句拼写` 之前整段追加 `_free_answer`;文件末尾追加已学词与自由复习段 |
| `server/app/wordbook/store.py` | 文件末尾追加一段 `# ---- 已学词与自由复习`;顶部 import:`from sqlalchemy import delete, func, select` 改为 `from sqlalchemy import and_, delete, func, or_, select`;`from collections.abc import Iterable` 改为 `from collections.abc import Iterable, Sequence`;`from dataclasses import dataclass`;`from app.wordbook import learned` |
| `server/app/routers/wordbook.py` | `AnswerIn.mode` 一行;`/enrollment/reset` 之后(文件末尾)追加请求体类与 4 个端点;`from app.wordbook import learned` |
| `server/tests/test_wordbook_contract.py` | `GOALS_KEYS` 之后加 `LEARNED_KEYS`;`collect` 里 `out |= await collect_goals(...)` 之前加一行 `out |= await collect_learned(client, h)`;`collect_goals` 之前加函数;断言用 `KEYS \| GOALS_KEYS \| LEARNED_KEYS`;非空列表清单加 2 项 |
| `server/tests/fixtures/wordbook_contract.json` | 整文件重录;**W 是第一个合并的计划**,R / A* 不碰这个文件 |
| `web/src/features/wordbook/wordbook-api.ts` | `AnswerInput.mode` 一处;`WORDBOOK_SERVER_ERRORS` 末尾追加 5 条;类型与函数追加在 `fetchCard` 之后 |
| `web/src/features/wordbook/i18n/{zh-CN,en}.json` | 在 `web.wordbook` 对象里 `"goals"` 键**之前**插入 `"learned"` 对象 |
| `web/src/features/wordbook/lazy-pages.tsx` / `index.ts` | 各在 `WordbookSpellPage` 之后追加 `WordbookLearnedPage` |
| `web/src/app.tsx` | `<Route path="/wordbook/spell" …>` 之后追加 `/wordbook/learned` |

## 并行车道、文件归属与合并顺序

| 车道 | 任务 | 独占文件(车道进行期间只有它改) | 依赖 |
|---|---|---|---|
| **server S**(一个执行者,串行) | S1–S6 | 上表全部 `server/**` 文件 | — |
| **web W**(一个执行者,串行) | W1–W7 | 上表全部 `web/**` 文件(除 e2e) | W1–W6 按本计划的线上形状写,可与 S 并行(用 fetch 模拟);W7 需 S6 已合并 |
| **final Z** | Z1–Z2 | `web/e2e/wordbook-learned.spec.ts`、`web/README.md`(背单词段)、`docs/superpowers/plans/e2e-results.md`、`docker-compose.e2e.yml`(如需)、本计划文件(勾选与结果) | S、W 全部合并 |

**合并顺序(本计划内)**:S1 → S2 → S3 → S4 → S5 → S6 → W1 → … → W6(rebase 到 S6)→ W7 → Z1 → Z2。两条车道没有共同文件;唯一的跨车道输入是只读的 `server/tests/fixtures/wordbook_contract.json`(S6 写,W7 读)。

**评审波**:S 车道合并前 `/code-review high` + `security-review`(刷分路径、输入校验、日志与 URL 卫生、LIKE 转义、按用户隔离);W 车道合并前 `/code-review high` + 浏览器窗格 375×812 浅色 / 深色对照(没有视觉稿,按 `docs/superpowers/design/redesign-v3/design-notes.md` 与现有首页 / 目标面板的组件);Z2 对整个分支 `security-review` 与全量测试。

## 本计划的裁定

> 规格与代码不一致或没写清的地方,按下面裁定实施;**没有改规格**。「代价」= 裁定错了的后果。

- **R-L1 盒子编号与熟练度分档。** 规格写「盒子 1–6」「盒子 1–2 / 3–4 / 5–6」,代码里存储盒子是 0–5(`vocabulary.INTERVAL_DAYS` 六项,`next_review` 封顶 `MAX_BOX = 5`,盒 0 是刚忘)。裁定:`learning` = 盒 0–1、`growing` = 盒 2–3、`mastered` = 盒 4–5;`mastered` 的下界必须等于 `plan.MASTERED_BOX`(测试钉住),这样已学词页的「熟练」与首页进度条的「已掌握」同口径。线上用 `tier` 枚举(请求)与 `by_box: [6 个整数]` + `by_tier`(响应),不用「盒子 1–6」。代价:若产品想按另一种切分,改 `learned.TIERS` 一处与两条文案。
- **R-L2 「已学」的口径。** 已学词 = `vocabulary_items` 中 `source = 'wordbook:<启用的书>'` 的行(规格 §1.1 原话);`learned_at` = 该行 `created_at`;停用的书的词保留但不列出(同 R-W12)。**不含**经「生词本」加入、`source` 不是 `wordbook:*` 的词,所以「已学 N 词」可能小于首页书卡的「已学」(后者按 `known_words` 任何来源计)。代价:两个数字偶尔对不上;换成「任何来源」需要在词典索引里反查词书归属,成本高,不做。
- **R-L3 「易错」的定义。** 规格没定义。裁定:`lapses >= 1 且 box <= 3`(答错过、且还没站稳)。理由:`lapses` 在到期答错与当天降级时 + 1,已有数据;盒 ≥ 4 的词即使曾错过也不再算易错。自由答错**不**加 `lapses`(规格:盒子不变)。代价:自由复习里答错的词要等正式复习答错才进「易错词」;改口径只动 `learned.is_weak` 与 `store._learned_where` 两处。
- **R-L4 隐私:`q` 与所有查询走 POST 体。** 规格写 `GET /learned?…&q=`。`logging_setup.REDACTED_LOGGERS` 只脱敏 `ticket=` 与房间邀请路径,uvicorn 访问日志会记下查询串;`links/CLAUDE.md` 规定「词永远不进 URL,只读查询也用 POST + JSON 体」。英文前缀是词的一部分。裁定:列表改为 `POST /api/wordbook/learned/query`(体里放全部筛选 + `q` + `cursor`);汇总仍是 `GET /learned/summary`(只带 `tz_offset_minutes`,没有词);打开词卡用新增的 `POST /api/wordbook/learned/card`(体里放 `book_id` + `key`),**不**用既有 `GET /cards/{book_id}/{key}`(那条把词放在路径里,属于更早的遗留写法,本计划不改它,也不让新页面再依赖它;如需收口另开任务)。一个路由内省测试断言新路由没有路径参数、查询参数 ⊆ `{tz_offset_minutes}`。代价:多一个端点;换来新页面不增加任何 URL 泄漏。
- **R-L5 前缀搜索走用户自己的行,不碰词典索引。** `BookIndex.keys` 是文件顺序的元组,没有排序结构;建一个会多占内存(七本书索引合计约 7 MiB)。已学词只有几千行,`vocabulary_items.word LIKE 'prefix%' ESCAPE` 在 `(user_id, word)` 索引与用户自己的行上足够。`q` 先 `normalize_word`,再 `startswith(autoescape=True)`(`%`、`_` 被转义,测试覆盖)。中文释义不搜(规格 §1.6)。代价:无;超大用户(> 1 万行)时仍是单用户扫描。
- **R-L6 自由答错「今天到期」与既有防刷分裁定的关系。** 既有 R-W5:未到期答错 → `apply_lapse`(盒 0、明天到期、不产生 `vocab_review`)。规格 §1.3 要求自由答错:**盒子不变,仅 `due_at` 改为今天**,所以不能复用 `apply_lapse`。裁定:新增 `store.pull_due`(只 `UPDATE due_at = now WHERE due_at > now`)。**这会开一条新路径:** 答错 → 到期 → 正式复习答对 → `reps + 1` 与 `last_reviewed_at` → 段位 `vocab_review` + 1 点,循环可刷。防护三层:① 自由作答永不写 `reps` / `last_reviewed_at` / 盒子;② 24 小时内正式复习过的词不能被拉(`store.pull_eligible` 看 `last_reviewed_at`),所以同一个词「错一次 → 复习一次」每天最多一轮;③ 每人每 UTC 日最多拉 20 个词(`FREE_PULLS_DAILY_MAX`,用 `daily_usage` 范围 `wordbook_free_pulls`),超过后答错仍判分、返回 `applied: false`、不再入队。最坏情况每天多出 20 个 `vocab_review`(默认段位日上限 60 之内)。代价:故意答错的用户每天可多拿最多 20 点;若不可接受,把 `FREE_PULLS_DAILY_MAX` 调小(0 = 关掉入队,规则表其余不变)。
- **R-L7 什么算「答错」。** 选择题:`wrong`;拼写:`srs_grade == "forgot"`(即 `outcome == "wrong"`,笔误 / 词形不对不算);快速回忆:有效评级 `unknown`(`fuzzy` 不算,`know` 且偷看 → `fuzzy` 也不算)。自由快速回忆的有效评级只看这次的 `rating` 与 `revealed_before`,**不**看历史(`previous=None`):连续两次模糊记为不认识这条规则只属于正式学习 / 复习。代价:想把模糊也入队,改 `_free_answer` 里一个条件。
- **R-L8 自由作答的校验。** 词必须是该用户 `source == wordbook_source(book_id)` 的已学词,否则 404 `Word not found`;不检查 `qtype` 是不是服务端出的(没有会话状态,`set_id` 不校验)——自由作答对盒子 / 点数没有任何正向作用,客户端想答哪个已学词都只是练习,也没有新的判分信息泄露(`/answers` 本来就返回 `expected`)。`known: true` 与 `mode=free` 一起 → 422(沿用 `_validate`)。「客户端不能指定具体词来刷」由两点保证:抽取在服务端(`free_start` 只收范围 / 方式 / 数量),且作答没有奖励。
- **R-L9 抽取与种子。** 规格说「沿用抽查种子做法」。抽查种子是为了让客户端预测不了哪些词被抽查;自由复习要的是「再来一组就是新的一组」,用选书 `seed` 会让同一范围每次抽到同一批。裁定:用 `random.Random()`(系统熵播种)抽词与出题,`free_start(..., rng=None)` 可注入(与 `spell_sets` 同款),测试注入固定 rng。选书 `seed` 仍不出现在任何响应里。代价:同一请求不可复现。
- **R-L10 `free/start` 的形状。** 规格 `{scope, mode, count, book?, box?}` → `{set_id, cards}`。裁定:请求用 `tier`(不用 `box`,见 R-L1),`count ∈ {10, 20, 50}`(`Literal`);响应 `{set_id, scope, mode, items: [{book_id, card, question | null}]}`——「全部随机」会跨书,每条自带 `book_id`,作答才有 `book_id`;`question` 在翻卡浏览时为 `null`。`set_id` 是 12 位随机十六进制,只给客户端当 key,服务端不存、不校验。范围里没有可抽的词 → 409 `No words to review`;`book` / `tier` 缺失或书未启用 → 422 `Invalid scope`。昨天 / 最近 7 天也受 `count` 封顶(池更大时随机取 N 个);7 天 = 本地今天往前 7 个本地日(含今天)。
- **R-L11 题型复用。** 选择题用 `meaning` / `word` / 有可挖空例句时的 `cloze`(`quiz.free_choice_qtype`,与盒子无关);拼写用现有 `spell`(看释义拼词,TypingQuestion),只抽 `card.spellable` 且不含空格的词(多抽 3 倍再筛);快速回忆用现有 `recall`。不新写题型,不用 `spell_ctx` 句组(那是 `spell/` 的独立流程)。
- **R-L12 列表的词头与词典不可用。** 列表每页最多 50 行,词头(`card.word`,可能与规范化键大小写 / 标点不同)从词典读(`ds.cards`,LRU 命中);某本书的词典文件不可用 → 该书的行退回显示规范化键,不整页 503。`free_start` 与 `learned/card` 需要词卡,仍按既有 `cards_or_fail` 返回 503。
- **R-L13 主包口径。** 见 Global Constraints:代码 ≤ 0.2 kB gzip + 文案 ≤ 1.5 kB gzip 总增量;规格「不得增加主包体积」按「新页面不进主包」落实,文案是 eager 合并的已知例外,验收时如实记录实测数字。
- **R-L14 自由复习的页面承载。** 规格:复习页加 `source=free` 参数。裁定:`/wordbook/review?source=free`,批次经 `navigate(..., { state: { free } })` 传入(答案、词卡不进 URL;浏览器刷新会保留 history state);没有 state(直达 / 清了)→ 回 `/wordbook/learned`。翻卡浏览不发任何作答请求、不写事件,由 `free-browse.tsx` 在同一懒加载块里承载,不新增路由。`ReviewSession` 仍是原来的组件,只多一个 `free` 属性(`mode: "free"`、按条目取 `book_id`、跳过抽查与「今日计划」请求、小结不显示段位点)。
- **R-L15 联动层。** `WordAnswered` 照常发布一次,`kind="practice"`(规格 §1.3)。`links/mistakes.py` 的 `LAPSE_KINDS` 含 `practice`,所以自由答错的 `wrong` / `unknown` 会进「易错词」、连续答对 2 次会移出——这是联动层自己的决定,本计划不改它(列入 Cross-plan assumptions)。
- **R-L16 汇总窗口。** `yesterday` / `last7` 按请求的 `tz_offset_minutes` 的本地日计(`plan.day_end` 同款),按 `created_at`;`by_book` 是 `[{book_id, count}]` 列表(按启用书的顺序),不是映射。

---

## Lane server (S)

### Task S1: `learned.py` — 熟练度分档、易错、游标、日期窗口(纯)

**Files:**
- Create: `server/app/wordbook/learned.py`
- Test: `server/tests/test_wordbook_learned.py`

**Interfaces:**
- Produces:`Tier`、`TIERS: dict[str, tuple[int, int]]`、`WEAK_MIN_LAPSES = 1`、`WEAK_MAX_BOX = 3`、`PAGE_MAX = 50`、`PREFIX_MAX = 30`、`FREE_COUNTS = (10, 20, 50)`、`FREE_SCOPES`、`FREE_MODES`;`tier_of(box) -> str`、`is_weak(box, lapses) -> bool`、`encode_cursor(at, item_id) -> str`、`decode_cursor(text) -> tuple[datetime, str] | None`、`scope_window(scope, now, offset) -> tuple[datetime | None, datetime | None]`、`date_bounds(since, until, offset) -> tuple[datetime | None, datetime | None]`(坏日期抛 `ValueError`;`until` 含当天)。

- [ ] **Step 1: 写失败测试** — `server/tests/test_wordbook_learned.py`:

```python
"""已学词与自由复习的纯规则(计划 2026-10-12-wordbook-learned-review S1)。"""
from datetime import datetime, timezone

import pytest

from app.wordbook import learned
from app.wordbook.plan import MASTERED_BOX

UTC = timezone.utc
NOW = datetime(2026, 10, 12, 3, 0, tzinfo=UTC)  # 本地(UTC+8)10 月 12 日 11:00


@pytest.mark.parametrize("box,tier", [(-1, "learning"), (0, "learning"), (1, "learning"), (2, "growing"), (3, "growing"),
                                      (4, "mastered"), (5, "mastered"), (9, "mastered")])
def test_tier_of(box, tier):
    assert learned.tier_of(box) == tier


def test_tiers_cover_every_stored_box_exactly_once():
    boxes = sorted(b for lo, hi in learned.TIERS.values() for b in range(lo, hi + 1))
    assert boxes == [0, 1, 2, 3, 4, 5]


def test_mastered_starts_at_the_home_page_mastered_box():
    assert learned.TIERS["mastered"][0] == MASTERED_BOX


def test_weak_needs_a_lapse_and_a_low_box():
    assert learned.is_weak(1, 1) and learned.is_weak(3, 4)
    assert not learned.is_weak(4, 3) and not learned.is_weak(0, 0) and not learned.is_weak(2, 0)


def test_cursor_round_trip():
    at = datetime(2026, 10, 12, 3, 4, 5, 123456, tzinfo=UTC)
    assert learned.decode_cursor(learned.encode_cursor(at, "abc-123")) == (at, "abc-123")


@pytest.mark.parametrize("text", ["", "!!!", "bm9wZQ", "MjAyNi0xMC0xMlQwMzowMDowMHxhYmM"])  # 空、非法、没有分隔符、没有时区
def test_cursor_rejects_garbage(text):
    assert learned.decode_cursor(text) is None


def test_scope_windows_use_local_days():
    assert learned.scope_window("yesterday", NOW, 480) == (datetime(2026, 10, 10, 16, tzinfo=UTC),
                                                           datetime(2026, 10, 11, 16, tzinfo=UTC))
    assert learned.scope_window("last7", NOW, 480) == (datetime(2026, 10, 5, 16, tzinfo=UTC), None)  # 本地 10/6 00:00 起
    assert learned.scope_window("all", NOW, 480) == (None, None)


def test_date_bounds_include_the_until_day():
    assert learned.date_bounds("2026-10-01", "2026-10-03", 480) == (datetime(2026, 9, 30, 16, tzinfo=UTC),
                                                                    datetime(2026, 10, 3, 16, tzinfo=UTC))
    assert learned.date_bounds(None, None, 0) == (None, None)


@pytest.mark.parametrize("since,until", [("2026-13-01", None), (None, "nope")])
def test_date_bounds_reject_bad_days(since, until):
    with pytest.raises(ValueError):
        learned.date_bounds(since, until, 0)
```

> 第 4 个游标坏样例 `MjAy…` 是 `2026-10-12T03:00:00|abc`(`datetime.fromisoformat` 得到无时区时间 → `None`)。若执行者发现 base64 手算有误,用 `base64.urlsafe_b64encode(b"2026-10-12T03:00:00|abc")` 重新生成并改样例。

- [ ] **Step 2: 跑测试确认失败** — `cd server && uv run pytest -q tests/test_wordbook_learned.py`(ImportError)。
- [ ] **Step 3: 实现** — `server/app/wordbook/learned.py`:

```python
"""已学词与自由复习的纯规则(spec 2026-10-12 wordbook-review §1;无 I/O)。

存储盒子是 0–5(R-L1):新学 0–1、巩固中 2–3、熟练 4–5(熟练的下界 = plan.MASTERED_BOX)。"""
import base64
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from app.wordbook.plan import day_end

Tier = Literal["learning", "growing", "mastered"]
TIERS: dict[str, tuple[int, int]] = {"learning": (0, 1), "growing": (2, 3), "mastered": (4, 5)}
WEAK_MIN_LAPSES = 1   # R-L3:答错过
WEAK_MAX_BOX = 3      # 且还没站稳
PAGE_MAX = 50
PREFIX_MAX = 30
FREE_COUNTS = (10, 20, 50)
FREE_SCOPES = ("yesterday", "last7", "book", "tier", "weak", "all")
FREE_MODES = ("browse", "recall", "choice", "spell")


def tier_of(box: int) -> str:
    for name, (low, high) in TIERS.items():
        if low <= box <= high:
            return name
    return "mastered" if box > 5 else "learning"


def is_weak(box: int, lapses: int) -> bool:
    return lapses >= WEAK_MIN_LAPSES and box <= WEAK_MAX_BOX


def encode_cursor(at: datetime, item_id: str) -> str:
    """游标 = (created_at, id) 的 base64url;不含词。"""
    raw = f"{at.astimezone(timezone.utc).isoformat()}|{item_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(text: str) -> tuple[datetime, str] | None:
    try:
        raw = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4)).decode()
        stamp, item_id = raw.split("|", 1)
        at = datetime.fromisoformat(stamp)
    except ValueError:  # binascii.Error、UnicodeDecodeError、拆包失败都是 ValueError
        return None
    return (at, item_id) if at.tzinfo is not None and item_id else None


def scope_window(scope: str, now: datetime, offset: int) -> tuple[datetime | None, datetime | None]:
    """(起, 止) 的 UTC 时刻,止不含;None = 不限。昨天 = 本地昨天;最近 7 天 = 本地今天往前 7 个本地日(含今天)。"""
    if scope == "yesterday":
        return day_end(now, offset, -2), day_end(now, offset, -1)
    if scope == "last7":
        return day_end(now, offset, -7), None
    return None, None


def _local_midnight(day: str, offset: int) -> datetime:
    d = date.fromisoformat(day)  # 坏日期抛 ValueError
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc) - timedelta(minutes=offset)


def date_bounds(since: str | None, until: str | None, offset: int) -> tuple[datetime | None, datetime | None]:
    """学习日期范围(本地日,首尾都含)→ UTC 半开区间 [起, 止)。"""
    start = _local_midnight(since, offset) if since else None
    end = _local_midnight(until, offset) + timedelta(days=1) if until else None
    return start, end
```

- [ ] **Step 4: 跑测试确认通过** — `uv run pytest -q tests/test_wordbook_learned.py tests/test_architecture.py`。
- [ ] **Step 5: 提交** — `feat(server): learned-word tiers, weak rule, cursors and local-day windows`。

### Task S2: `store.py` — 已学词分页、汇总、抽取池、「拉到今天到期」与计数器

**Files:**
- Modify: `server/app/wordbook/store.py`(顶部 import 一处;文件末尾追加)
- Test: `server/tests/test_wordbook_learned_store.py`

**Interfaces:**
- Consumes:`learned`(S1)、既有 `usage.consume`、`wordbook_source`、`SOURCE_PREFIX`、`as_utc`。
- Produces:`LearnedRow(id, word, book_id, box, lapses, due_at, created_at)`、`FREE_STARTS_DAILY_MAX = 200`、`FREE_PULLS_DAILY_MAX = 20`、`FREE_PULL_QUIET = timedelta(hours=24)`、`learned_sources(book_ids) -> list[str]`、`learned_page(session, user_id, sources, *, tier, weak, since, until, prefix, after, limit) -> tuple[list[LearnedRow], bool]`、`learned_counts(session, user_id, sources, *, yesterday, last7_start) -> tuple[list[tuple[str, int, int]], int, int, int]`(按 (source, box) 的计数、易错数、昨天数、最近 7 天数)、`free_pool(session, user_id, sources, *, tier, weak, since, until) -> list[tuple[str, str]]`((word, book_id))、`pull_eligible(session, user_id, item_id, now) -> bool`、`pull_due(session, user_id, item_id, now) -> bool`、`consume_free_start`、`consume_free_pull`。

- [ ] **Step 1: 写失败测试** — `server/tests/test_wordbook_learned_store.py`:

```python
"""已学词的数据层(计划 2026-10-12-wordbook-learned-review S2)。"""
from datetime import timedelta

from sqlalchemy import select

from app.models import User, VocabularyItem, utcnow
from app.services.stats import as_utc
from app.wordbook import learned, store

SRC = "wordbook:junior"


async def user_id(app, client) -> int:
    await client.post("/api/users", json={"username": "alice", "password": "password123"})
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(User.id))


def row(uid, word, *, box=0, lapses=0, hours_ago=0.0, source=SRC, due_hours=24.0, reviewed_hours_ago=None):
    now = utcnow()
    return VocabularyItem(id=f"id-{word}", user_id=uid, word=word, meaning="", source=source, box=box, lapses=lapses,
                          due_at=now + timedelta(hours=due_hours), reps=0, created_at=now - timedelta(hours=hours_ago),
                          last_reviewed_at=None if reviewed_hours_ago is None else now - timedelta(hours=reviewed_hours_ago))


async def seed(app, *rows):
    async with app.state.sessionmaker() as s:
        s.add_all(rows)
        await s.commit()


def page(**kw):
    base = dict(tier=None, weak=False, since=None, until=None, prefix=None, after=None, limit=50)
    return {**base, **kw}


async def test_page_is_newest_first_and_cursor_continues(app, client):
    uid = await user_id(app, client)
    await seed(app, row(uid, "old", hours_ago=30), row(uid, "mid", hours_ago=20), row(uid, "new", hours_ago=10))
    async with app.state.sessionmaker() as s:
        first, more = await store.learned_page(s, uid, [SRC], **page(limit=2))
        assert [r.word for r in first] == ["new", "mid"] and more is True
        rest, more = await store.learned_page(s, uid, [SRC], **page(after=(first[-1].created_at, first[-1].id), limit=2))
        assert [r.word for r in rest] == ["old"] and more is False
        assert first[0].book_id == "junior"


async def test_filters_tier_weak_prefix_and_sources(app, client):
    uid = await user_id(app, client)
    await seed(app, row(uid, "ability", box=1, lapses=1), row(uid, "able", box=4), row(uid, "talk", box=2, lapses=2),
               row(uid, "other", source="manual"), row(uid, "abroad", box=3, lapses=1, source="wordbook:senior"))
    async with app.state.sessionmaker() as s:
        async def words(**kw):
            rows, _ = await store.learned_page(s, uid, kw.pop("sources", [SRC]), **page(**kw))
            return sorted(r.word for r in rows)
        assert await words() == ["ability", "able", "talk"]            # 非 wordbook 来源与别的书都不在
        assert await words(tier="mastered") == ["able"]
        assert await words(tier="growing") == ["talk"]
        assert await words(weak=True) == ["ability", "talk"]            # lapses ≥ 1 且 box ≤ 3
        assert await words(prefix="ab") == ["ability", "able"]
        assert await words(prefix="%") == [] and await words(prefix="a_") == []  # 通配符被转义
        assert await words(sources=[SRC, "wordbook:senior"], prefix="abr") == ["abroad"]


async def test_other_users_rows_are_never_listed(app, client):
    uid = await user_id(app, client)
    await seed(app, row(uid, "mine"), row(uid + 1, "theirs"))
    async with app.state.sessionmaker() as s:
        rows, _ = await store.learned_page(s, uid, [SRC], **page())
    assert [r.word for r in rows] == ["mine"]


async def test_counts_group_by_source_and_box(app, client):
    uid = await user_id(app, client)
    now = utcnow()
    await seed(app, row(uid, "a", box=0, hours_ago=1), row(uid, "b", box=2, lapses=1, hours_ago=50),
               row(uid, "c", box=2, source="wordbook:senior", hours_ago=5))
    async with app.state.sessionmaker() as s:
        grouped, weak, y, w = await store.learned_counts(
            s, uid, [SRC, "wordbook:senior"], yesterday=(now - timedelta(hours=60), now - timedelta(hours=40)),
            last7_start=now - timedelta(days=7))
    assert sorted(grouped) == [("wordbook:junior", 0, 1), ("wordbook:junior", 2, 1), ("wordbook:senior", 2, 1)]
    assert (weak, y, w) == (1, 1, 3)


async def test_free_pool_returns_word_and_book(app, client):
    uid = await user_id(app, client)
    await seed(app, row(uid, "a", box=1), row(uid, "b", box=5, source="wordbook:senior"))
    async with app.state.sessionmaker() as s:
        assert sorted(await store.free_pool(s, uid, [SRC, "wordbook:senior"], tier=None, weak=False, since=None, until=None)) \
            == [("a", "junior"), ("b", "senior")]
        assert await store.free_pool(s, uid, [SRC], tier="mastered", weak=False, since=None, until=None) == []


async def test_pull_due_moves_only_a_future_due_date_and_nothing_else(app, client):
    uid = await user_id(app, client)
    await seed(app, row(uid, "later", box=3, due_hours=48), row(uid, "overdue", box=3, due_hours=-5))
    now = utcnow()
    async with app.state.sessionmaker() as s:
        assert await store.pull_due(s, uid, "id-later", now) is True
        assert await store.pull_due(s, uid, "id-overdue", now) is False
        await s.commit()
    async with app.state.sessionmaker() as s:
        later = await s.get(VocabularyItem, "id-later")
        assert as_utc(later.due_at) == now
        assert (later.box, later.reps, later.lapses, later.last_reviewed_at) == (3, 0, 0, None)


async def test_pull_is_blocked_for_24_hours_after_a_real_review(app, client):
    uid = await user_id(app, client)
    await seed(app, row(uid, "fresh", reviewed_hours_ago=2), row(uid, "stale", reviewed_hours_ago=72), row(uid, "never"))
    now = utcnow()
    async with app.state.sessionmaker() as s:
        assert await store.pull_eligible(s, uid, "id-fresh", now) is False
        assert await store.pull_eligible(s, uid, "id-stale", now) is True
        assert await store.pull_eligible(s, uid, "id-never", now) is True
        assert await store.pull_eligible(s, uid, "id-missing", now) is False


async def test_free_counters_stop_at_their_daily_maximum(app, client, monkeypatch):
    uid = await user_id(app, client)
    monkeypatch.setattr(store, "FREE_PULLS_DAILY_MAX", 2)
    monkeypatch.setattr(store, "FREE_STARTS_DAILY_MAX", 1)
    async with app.state.sessionmaker() as s:
        assert [await store.consume_free_pull(s, uid, "2026-10-12") for _ in range(3)] == [True, True, False]
        assert [await store.consume_free_start(s, uid, "2026-10-12") for _ in range(2)] == [True, False]
        assert learned.PAGE_MAX == 50  # 常量没被测试改动
```

> 用户 id:`app` 夹具里第一个注册的用户 id 是 1,`uid + 1` 只是「另一个 id」;`vocabulary_items.user_id` 有外键,SQLite 测试库默认不强制外键。若执行者的测试库开了外键,把「别人的行」改为先注册 bob。

- [ ] **Step 2: 跑测试确认失败** — `uv run pytest -q tests/test_wordbook_learned_store.py`(AttributeError)。
- [ ] **Step 3: 实现** — 改 `store.py` 顶部 import:

```python
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import and_, delete, func, or_, select
...
from app.wordbook import learned
```

文件末尾追加:

```python
# ---- 已学词与自由复习(spec 2026-10-12 wordbook-review §1;计划 2026-10-12-wordbook-learned-review)----

FREE_STARTS_DAILY_MAX = 200           # 每人每 UTC 日开始自由复习的次数(挡住反复读词典;不是设置项)
FREE_PULLS_DAILY_MAX = 20             # 每人每 UTC 日最多把 20 个词「拉到今天到期」(R-L6 刷分防护 ③)
FREE_PULL_QUIET = timedelta(hours=24)  # 24 小时内正式复习过的词不能被拉(R-L6 防护 ②)


@dataclass(frozen=True)
class LearnedRow:
    id: str
    word: str
    book_id: str
    box: int
    lapses: int
    due_at: datetime
    created_at: datetime


def learned_sources(book_ids: Iterable[str]) -> list[str]:
    return [wordbook_source(b) for b in book_ids]


def _learned_where(user_id: int, sources: Sequence[str], *, tier: str | None, weak: bool, since: datetime | None,
                   until: datetime | None, prefix: str | None) -> list:
    conds = [VocabularyItem.user_id == user_id, VocabularyItem.source.in_(list(sources))]
    if tier is not None:
        low, high = learned.TIERS[tier]
        conds.append(VocabularyItem.box.between(low, high))
    if weak:
        conds += [VocabularyItem.lapses >= learned.WEAK_MIN_LAPSES, VocabularyItem.box <= learned.WEAK_MAX_BOX]
    if since is not None:
        conds.append(VocabularyItem.created_at >= since)
    if until is not None:
        conds.append(VocabularyItem.created_at < until)
    if prefix:  # R-L5:用户自己的行上的前缀匹配,% 与 _ 转义
        conds.append(VocabularyItem.word.startswith(prefix, autoescape=True))
    return conds


async def learned_page(session: AsyncSession, user_id: int, sources: Sequence[str], *, tier: str | None, weak: bool,
                       since: datetime | None, until: datetime | None, prefix: str | None,
                       after: tuple[datetime, str] | None, limit: int) -> tuple[list[LearnedRow], bool]:
    """已学词,新学的在前;游标 = (created_at, id)。多取一行判断还有没有下一页。"""
    stmt = select(VocabularyItem.id, VocabularyItem.word, VocabularyItem.source, VocabularyItem.box,
                  VocabularyItem.lapses, VocabularyItem.due_at, VocabularyItem.created_at).where(
        *_learned_where(user_id, sources, tier=tier, weak=weak, since=since, until=until, prefix=prefix))
    if after is not None:
        at, item_id = after
        stmt = stmt.where(or_(VocabularyItem.created_at < at,
                              and_(VocabularyItem.created_at == at, VocabularyItem.id < item_id)))
    found = (await session.execute(stmt.order_by(VocabularyItem.created_at.desc(), VocabularyItem.id.desc())
                                   .limit(limit + 1))).all()
    rows = [LearnedRow(r.id, r.word, r.source[len(SOURCE_PREFIX):], r.box, r.lapses, as_utc(r.due_at),
                       as_utc(r.created_at)) for r in found[:limit]]
    return rows, len(found) > limit


async def learned_counts(session: AsyncSession, user_id: int, sources: Sequence[str], *,
                         yesterday: tuple[datetime, datetime], last7_start: datetime
                         ) -> tuple[list[tuple[str, int, int]], int, int, int]:
    base = _learned_where(user_id, sources, tier=None, weak=False, since=None, until=None, prefix=None)
    grouped = (await session.execute(select(VocabularyItem.source, VocabularyItem.box, func.count())
                                     .where(*base).group_by(VocabularyItem.source, VocabularyItem.box))).all()

    async def count(*extra) -> int:
        return int(await session.scalar(select(func.count()).select_from(VocabularyItem).where(*base, *extra)) or 0)

    weak = await count(VocabularyItem.lapses >= learned.WEAK_MIN_LAPSES, VocabularyItem.box <= learned.WEAK_MAX_BOX)
    y = await count(VocabularyItem.created_at >= yesterday[0], VocabularyItem.created_at < yesterday[1])
    w = await count(VocabularyItem.created_at >= last7_start)
    return [(source, int(box), int(n)) for source, box, n in grouped], weak, y, w


async def free_pool(session: AsyncSession, user_id: int, sources: Sequence[str], *, tier: str | None, weak: bool,
                    since: datetime | None, until: datetime | None) -> list[tuple[str, str]]:
    """自由复习可抽的 (词, 书)。只有这个用户自己的已学词。"""
    rows = (await session.execute(select(VocabularyItem.word, VocabularyItem.source).where(
        *_learned_where(user_id, sources, tier=tier, weak=weak, since=since, until=until, prefix=None)))).all()
    return [(word, source[len(SOURCE_PREFIX):]) for word, source in rows]


async def pull_eligible(session: AsyncSession, user_id: int, item_id: str, now: datetime) -> bool:
    """这个词能不能被自由答错拉到今天到期:存在,且 24 小时内没有正式复习过(R-L6)。"""
    found = (await session.execute(select(VocabularyItem.id, VocabularyItem.last_reviewed_at).where(
        VocabularyItem.id == item_id, VocabularyItem.user_id == user_id))).first()
    if found is None:
        return False
    return found.last_reviewed_at is None or as_utc(found.last_reviewed_at) <= now - FREE_PULL_QUIET


async def pull_due(session: AsyncSession, user_id: int, item_id: str, now: datetime) -> bool:
    """自由复习答错:把还没到期的词改为「现在到期」(进入正式复习队列)。只动 due_at —— 盒子、reps、lapses、
    last_reviewed_at 都不变,所以不产生 vocab_review。已到期的词不动(返回 False)。不提交。"""
    result = await session.execute(
        update_(VocabularyItem)
        .where(VocabularyItem.id == item_id, VocabularyItem.user_id == user_id, VocabularyItem.due_at > now)
        .values(due_at=now).execution_options(synchronize_session=False))
    return result.rowcount == 1


async def consume_free_start(session: AsyncSession, user_id: int, day: str) -> bool:
    return await usage.consume(session, "wordbook_free_starts", str(user_id), day, FREE_STARTS_DAILY_MAX)


async def consume_free_pull(session: AsyncSession, user_id: int, day: str) -> bool:
    return await usage.consume(session, "wordbook_free_pulls", str(user_id), day, FREE_PULLS_DAILY_MAX)
```

- [ ] **Step 4: 跑测试确认通过** — `uv run pytest -q tests/test_wordbook_learned_store.py tests/test_wordbook_store.py tests/test_architecture.py`(`test_wordbook_store.py` 确认没有回归)。
- [ ] **Step 5: 提交** — `feat(server): learned-word queries, free-review pool and guarded due pull`。

### Task S3: 汇总、列表与词卡服务 + 三个端点(不含词的 URL)

**Files:**
- Modify: `server/app/wordbook/service.py`、`server/app/routers/wordbook.py`
- Test: `server/tests/test_wordbook_learned_api.py`

**Interfaces:**
- Consumes:S1、S2。
- Produces(HTTP):
  - `GET /api/wordbook/learned/summary?tz_offset_minutes=` → `{total, by_box: [6 个整数], by_tier: {learning, growing, mastered}, by_book: [{book_id, count}], weak, yesterday, last7}`
  - `POST /api/wordbook/learned/query` 体 `{book?, tier?, weak?, since?, until?, q?, cursor?, limit?, tz_offset_minutes}` → `{items: [{book_id, key, word, box, tier, learned_at, due_at, weak}], next_cursor | null}`
  - `POST /api/wordbook/learned/card` 体 `{book_id, key}` → 词卡(同 `GET /cards/…` 的 `card_out`);不是该用户已学的词 → 404 `Word not found`
  - 错误:422 `Invalid cursor` / `Invalid date`;`book` 未启用 → 404 `Book not found`;开关关 → 404 `Wordbook is disabled`。
- Produces(service):`LearnedQuery` 数据类、`learned_summary`、`learned_list`、`learned_card`、新错误常量。

- [ ] **Step 1: 写失败测试** — `server/tests/test_wordbook_learned_api.py`:

```python
"""已学词汇总 / 列表 / 词卡(计划 2026-10-12-wordbook-learned-review S3)。"""
from datetime import timedelta

from sqlalchemy import update

from app.models import VocabularyItem, utcnow
from app.services.usage import local_day
from app.wordbook import plan as planning
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"
OFFSET = 480


async def login(app, client, tmp_path, name="alice", **overrides):
    enable_wordbook(app, make_data_dir(tmp_path, ("junior", "senior")), wordbook_books="junior,senior", **overrides)
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    return h


async def rate(client, h, key, rating):
    r = await client.post(f"{URL}/answers", headers=h, json={
        "book_id": "junior", "key": key, "mode": "learn", "qtype": "recall", "rating": rating, "tz_offset_minutes": OFFSET})
    assert r.status_code == 200, r.text


async def learn_three(client, h):
    """talk 认识(盒 2)、ability 模糊(盒 1)、able 不认识(盒 0);按这个顺序建行,able 最新。"""
    for key, rating in (("talk", "know"), ("ability", "fuzzy"), ("able", "unknown")):
        await rate(client, h, key, rating)


async def query(client, h, **body):
    return await client.post(f"{URL}/learned/query", headers=h, json={"tz_offset_minutes": OFFSET, **body})


async def keys(client, h, **body):
    r = await query(client, h, **body)
    assert r.status_code == 200, r.text
    return [i["key"] for i in r.json()["items"]]


async def patch_rows(app, word, **values):
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == word).values(**values))
        await s.commit()


async def test_summary_counts_boxes_tiers_books_and_windows(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_three(client, h)
    yesterday = planning.day_end(utcnow(), OFFSET, -2) + timedelta(hours=1)
    await patch_rows(app, "talk", created_at=yesterday)
    await patch_rows(app, "ability", lapses=1)
    r = (await client.get(f"{URL}/learned/summary", headers=h, params={"tz_offset_minutes": OFFSET})).json()
    assert r["total"] == 3 and r["by_box"] == [1, 1, 1, 0, 0, 0]
    assert r["by_tier"] == {"learning": 2, "growing": 1, "mastered": 0}
    assert r["by_book"] == [{"book_id": "junior", "count": 3}]
    assert (r["weak"], r["yesterday"], r["last7"]) == (1, 1, 3)


async def test_list_is_newest_first_with_headword_tier_and_weak(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_three(client, h)
    await patch_rows(app, "ability", lapses=1)
    items = (await query(client, h)).json()["items"]
    assert [i["key"] for i in items] == ["able", "ability", "talk"]
    ability = items[1]
    assert set(ability) == {"book_id", "key", "word", "box", "tier", "learned_at", "due_at", "weak"}
    assert (ability["book_id"], ability["word"], ability["box"], ability["tier"], ability["weak"]) == (
        "junior", "ability", 1, "learning", True)
    assert items[0]["weak"] is False


async def test_filters(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_three(client, h)
    await patch_rows(app, "ability", lapses=1)
    today = local_day(utcnow(), OFFSET)
    assert await keys(client, h, tier="growing") == ["talk"]
    assert await keys(client, h, weak=True) == ["ability"]
    assert await keys(client, h, q="ab") == ["able", "ability"] and await keys(client, h, q="AB") == ["able", "ability"]
    assert await keys(client, h, q="%") == [] and await keys(client, h, q="a_") == []
    assert await keys(client, h, book="junior", tier="learning") == ["able", "ability"]
    assert len(await keys(client, h, since=today, until=today)) == 3            # until 含当天
    assert await keys(client, h, until="2000-01-01") == []                       # 都晚于这一天
    assert await keys(client, h, since="2999-01-01") == []


async def test_book_filter_rejects_disabled_books_and_hides_their_rows(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_three(client, h)
    enable_wordbook(app, make_data_dir(tmp_path, ("junior", "senior")), wordbook_books="senior")
    assert (await query(client, h, book="junior")).status_code == 404
    assert (await query(client, h, book="junior")).json() == {"error": "Book not found"}
    assert await keys(client, h) == []
    summary = (await client.get(f"{URL}/learned/summary", headers=h, params={"tz_offset_minutes": OFFSET})).json()
    assert summary["total"] == 0 and summary["by_book"] == []


async def test_cursor_walks_every_row_once(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_three(client, h)
    first = (await query(client, h, limit=2)).json()
    assert len(first["items"]) == 2 and first["next_cursor"]
    second = (await query(client, h, limit=2, cursor=first["next_cursor"])).json()
    assert len(second["items"]) == 1 and second["next_cursor"] is None
    assert sorted(i["key"] for i in first["items"] + second["items"]) == ["able", "ability", "talk"]


async def test_bad_cursor_and_bad_date_are_422(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    assert (await query(client, h, cursor="!!!")).json() == {"error": "Invalid cursor"}
    assert (await query(client, h, since="2026-13-45")).json() == {"error": "Invalid date"}
    assert (await query(client, h, q="x" * 31)).status_code == 422
    assert (await query(client, h, limit=51)).status_code == 422
    assert (await query(client, h, words=["talk"])).status_code == 422  # extra="forbid"


async def test_each_user_sees_only_their_own_words(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_three(client, h)
    r = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    bob = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert await keys(client, bob) == []
    assert (await client.post(f"{URL}/learned/card", headers=bob, json={"book_id": "junior", "key": "talk"})).status_code == 404


async def test_card_only_for_learned_words_of_that_book(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    await learn_three(client, h)
    ok = await client.post(f"{URL}/learned/card", headers=h, json={"book_id": "junior", "key": "talk"})
    assert ok.status_code == 200 and ok.json()["key"] == "talk" and ok.json()["senses"]
    for body in ({"book_id": "junior", "key": "abandon"}, {"book_id": "senior", "key": "talk"}):
        r = await client.post(f"{URL}/learned/card", headers=h, json=body)
        assert (r.status_code, r.json()) == (404, {"error": "Word not found"})


async def test_disabled_wordbook_hides_the_endpoints(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    enable_wordbook(app, make_data_dir(tmp_path), wordbook_enabled=False)
    assert (await query(client, h)).json() == {"error": "Wordbook is disabled"}
    assert (await client.get(f"{URL}/learned/summary", headers=h)).status_code == 404


async def test_prefix_and_words_never_reach_the_logs(app, client, tmp_path, caplog):
    caplog.set_level("DEBUG")
    h = await login(app, client, tmp_path)
    await learn_three(client, h)
    await query(client, h, q="zqxjv")
    await client.post(f"{URL}/learned/card", headers=h, json={"book_id": "junior", "key": "talk"})
    assert "zqxjv" not in caplog.text and "ability" not in caplog.text


def test_new_routes_carry_no_word_in_the_url(app):
    seen = 0
    for route in app.routes:
        path = getattr(route, "path", "")
        if path.startswith(f"{URL}/learned") or path.startswith(f"{URL}/free"):
            seen += 1
            assert "{" not in path, path  # 没有路径参数
            assert {p.name for p in route.dependant.query_params} <= {"tz_offset_minutes"}, path
    assert seen >= 3
```

> 说明:`rate()` 的 `know` 在 `wordbook_spot_check_pct=0`(`enable_wordbook` 默认)下建盒 2、`fuzzy` 盒 1、`unknown` 盒 0。`from app.wordbook import plan as planning` 在 `test_summary…` 里用于算昨天的时刻。

- [ ] **Step 2: 跑测试确认失败** — `uv run pytest -q tests/test_wordbook_learned_api.py`(404 / AttributeError)。
- [ ] **Step 3: 实现 service** — 在 `service.py` 的 `CONFIRM_MISMATCH = …` 之后追加常量,并按上节插入点改 import:

```python
INVALID_CURSOR = (422, "Invalid cursor")
INVALID_DATE = (422, "Invalid date")
INVALID_SCOPE = (422, "Invalid scope")
NOTHING_TO_REVIEW = (409, "No words to review")
FREE_LIMIT = (429, "Daily free-review limit reached")
```

文件末尾追加:

```python
# ---- 已学词与自由复习(spec 2026-10-12 wordbook-review §1;计划 2026-10-12-wordbook-learned-review)----

@dataclass(frozen=True)
class LearnedQuery:
    book: str | None
    tier: str | None
    weak: bool
    since: str | None
    until: str | None
    q: str | None
    cursor: str | None
    limit: int
    offset: int


def _learned_sources(settings: Settings, book: str | None) -> list[str]:
    enabled = enabled_books(settings.wordbook_books)  # R-L2:停用的书保留记录但不列出
    if book is not None:
        if book not in enabled:
            fail(BOOK_NOT_FOUND)
        enabled = (book,)
    return store.learned_sources(enabled)


async def learned_summary(session: AsyncSession, user_id: int, settings: Settings, offset: int, now) -> dict:
    enabled = enabled_books(settings.wordbook_books)
    grouped, weak, y_count, w_count = await store.learned_counts(
        session, user_id, store.learned_sources(enabled),
        yesterday=(planning.day_end(now, offset, -2), planning.day_end(now, offset, -1)),
        last7_start=planning.day_end(now, offset, -7))
    by_box, by_book = [0] * 6, {}
    for source, box, n in grouped:
        by_box[min(max(box, 0), 5)] += n
        book_id = source[len(store.SOURCE_PREFIX):]
        by_book[book_id] = by_book.get(book_id, 0) + n
    return {"total": sum(by_box), "by_box": by_box,
            "by_tier": {name: sum(by_box[lo:hi + 1]) for name, (lo, hi) in learned.TIERS.items()},
            "by_book": [{"book_id": b, "count": by_book[b]} for b in enabled if b in by_book],  # 列表,不是映射(R-L16)
            "weak": weak, "yesterday": y_count, "last7": w_count}


async def learned_list(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, p: LearnedQuery,
                       now) -> dict:
    sources = _learned_sources(settings, p.book)
    try:
        since, until = learned.date_bounds(p.since, p.until, p.offset)
    except ValueError:
        fail(INVALID_DATE)
    after = None
    if p.cursor is not None:
        after = learned.decode_cursor(p.cursor)
        if after is None:
            fail(INVALID_CURSOR)
    prefix = normalize_word(p.q) if p.q else None
    rows, more = await store.learned_page(session, user_id, sources, tier=p.tier, weak=p.weak, since=since, until=until,
                                          prefix=prefix, after=after, limit=p.limit)
    await ensure_hidden(session, ds)
    heads: dict[tuple[str, str], str] = {}
    for book_id in dict.fromkeys(r.book_id for r in rows):  # R-L12:词典不可用的书退回规范化键
        try:
            found = await ds.cards(book_id, [r.word for r in rows if r.book_id == book_id])
        except DataUnavailable:
            continue
        heads.update({(book_id, k): c.word for k, c in found.items()})
    items = [{"book_id": r.book_id, "key": r.word, "word": heads.get((r.book_id, r.word), r.word), "box": r.box,
              "tier": learned.tier_of(r.box), "learned_at": iso_utc(r.created_at), "due_at": iso_utc(r.due_at),
              "weak": learned.is_weak(r.box, r.lapses)} for r in rows]
    return {"items": items,
            "next_cursor": learned.encode_cursor(rows[-1].created_at, rows[-1].id) if more and rows else None}


async def learned_card(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, book_id: str,
                       key: str) -> dict:
    """已学词的词卡(POST 体里带词,不进 URL;R-L4)。不是这个用户这本书里的已学词 → 404。"""
    book_or_fail(settings, book_id)
    row = await store.known_one(session, user_id, key)
    if row is None or row.source != store.wordbook_source(book_id):
        fail(WORD_NOT_FOUND)
    return await card_detail(session, ds, settings, book_id, key)
```

- [ ] **Step 4: 实现路由** — `routers/wordbook.py` 顶部加 `from app.wordbook import learned`,文件末尾追加:

```python
# ---- 已学词(计划 2026-10-12-wordbook-learned-review;词与前缀只在 POST 体里,R-L4)----

DAY = r"^\d{4}-\d{2}-\d{2}$"


class LearnedQueryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    book: str | None = Field(None, max_length=16)
    tier: Literal["learning", "growing", "mastered"] | None = None
    weak: bool = False
    since: str | None = Field(None, pattern=DAY)
    until: str | None = Field(None, pattern=DAY)
    q: str | None = Field(None, max_length=learned.PREFIX_MAX)
    cursor: str | None = Field(None, max_length=200)
    limit: int = Field(learned.PAGE_MAX, ge=1, le=learned.PAGE_MAX)
    tz_offset_minutes: int = Field(0, ge=TZ_MIN, le=TZ_MAX)


class LearnedCardIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    book_id: str = Field(max_length=16)
    key: str = Field(min_length=1, max_length=100)


@router.get("/learned/summary")
async def wordbook_learned_summary(request: Request, tz_offset_minutes: int = Query(0, ge=TZ_MIN, le=TZ_MAX),
                                   user: User = Depends(current_user), session: AsyncSession = Depends(get_session),
                                   settings: Settings = Depends(require_wordbook)):
    return await service.learned_summary(session, user.id, settings, tz_offset_minutes, utcnow())


@router.post("/learned/query")
async def wordbook_learned_query(payload: LearnedQueryIn, request: Request, user: User = Depends(current_user),
                                 session: AsyncSession = Depends(get_session),
                                 settings: Settings = Depends(require_wordbook)):
    p = service.LearnedQuery(payload.book, payload.tier, payload.weak, payload.since, payload.until, payload.q,
                             payload.cursor, payload.limit, payload.tz_offset_minutes)
    try:
        return await service.learned_list(session, dictionary(request.app), user.id, settings, p, utcnow())
    except service.WordbookError as e:
        _raise(e)


@router.post("/learned/card")
async def wordbook_learned_card(payload: LearnedCardIn, request: Request, user: User = Depends(current_user),
                                session: AsyncSession = Depends(get_session),
                                settings: Settings = Depends(require_wordbook)):
    try:
        return await service.learned_card(session, dictionary(request.app), user.id, settings, payload.book_id,
                                          normalize_word(payload.key))
    except service.WordbookError as e:
        _raise(e)
```

- [ ] **Step 5: 跑测试确认通过** — `uv run pytest -q tests/test_wordbook_learned_api.py tests/test_wordbook_api.py tests/test_architecture.py tests/test_admin_routes_guarded.py`。
- [ ] **Step 6: 提交** — `feat(server): learned-word summary, filtered list and card endpoints`。

### Task S4: 自由复习抽取 `POST /free/start`

**Files:**
- Modify: `server/app/wordbook/quiz.py`(末尾追加两个纯函数)、`server/app/wordbook/service.py`、`server/app/routers/wordbook.py`
- Test: `server/tests/test_wordbook_free_start.py`(含对 `quiz.py` 两个函数的断言)

**Interfaces:**
- Produces:`quiz.free_choice_qtype(card, rng) -> QType`、`quiz.free_spellable(card) -> bool`;`service.free_start(session, ds, user_id, settings, *, scope, mode, count, book, tier, offset, now, rng=None) -> dict`;HTTP `POST /api/wordbook/free/start` 体 `{scope, mode, count, book?, tier?, tz_offset_minutes}` → `{set_id, scope, mode, items: [{book_id, card, question | null}]}`。错误:409 `No words to review`、422 `Invalid scope`、429 `Daily free-review limit reached`。

- [ ] **Step 1: 写失败测试** — `server/tests/test_wordbook_free_start.py`:

```python
"""自由复习抽取(计划 2026-10-12-wordbook-learned-review S4)。"""
import random
from datetime import timedelta

from sqlalchemy import func, select, update

from app.models import VocabularyItem, WordbookEvent, utcnow
from app.wordbook import plan as planning
from app.wordbook import quiz, service, store
from app.wordbook.index import dictionary
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"
OFFSET = 480
WORDS = ("talk", "ability", "able", "abandon", "absorb", "accept")


async def login(app, client, tmp_path, **overrides):
    enable_wordbook(app, make_data_dir(tmp_path, ("junior", "senior")), wordbook_books="junior,senior", **overrides)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    for key in WORDS:
        await client.post(f"{URL}/answers", headers=h, json={
            "book_id": "junior", "key": key, "mode": "learn", "qtype": "recall", "rating": "know",
            "tz_offset_minutes": OFFSET})
    return h


async def start(client, h, **body):
    return await client.post(f"{URL}/free/start", headers=h, json={
        "scope": "all", "mode": "choice", "count": 10, "tz_offset_minutes": OFFSET, **body})


async def test_choice_set_has_a_question_per_card_and_the_right_option(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    r = await start(client, h)
    assert r.status_code == 200
    out = r.json()
    assert set(out) == {"set_id", "scope", "mode", "items"} and len(out["set_id"]) == 12
    assert sorted(i["card"]["key"] for i in out["items"]) == sorted(WORDS)
    for item in out["items"]:
        q = item["question"]
        assert item["book_id"] == "junior" and q["key"] == item["card"]["key"]
        assert q["qtype"] in {"meaning", "word", "cloze"} and len(q["options"]) >= 2
        card = await dictionary(app).card("junior", q["key"])
        assert (quiz.correct_option(q["qtype"], card)) in q["options"]


async def test_browse_has_no_questions_and_recall_and_spell_use_existing_types(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    browse = (await start(client, h, mode="browse")).json()["items"]
    assert browse and all(i["question"] is None for i in browse)
    recall = (await start(client, h, mode="recall")).json()["items"]
    assert {i["question"]["qtype"] for i in recall} == {"recall"} and recall[0]["question"]["options"] is None
    spell = (await start(client, h, mode="spell")).json()["items"]
    assert spell and {i["question"]["qtype"] for i in spell} == {"spell"}
    assert all(" " not in i["card"]["key"] and i["question"]["length"] == len(i["card"]["word"]) for i in spell)


async def test_count_caps_the_set_and_a_small_pool_returns_fewer(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    assert len((await start(client, h, count=10)).json()["items"]) == len(WORDS)
    enable_wordbook(app, make_data_dir(tmp_path, ("junior", "senior")), wordbook_books="junior,senior")
    assert (await start(client, h, count=5)).status_code == 422  # 只接受 10 / 20 / 50


async def test_yesterday_and_last7_use_local_days(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    assert (await start(client, h, scope="yesterday")).json() == {"error": "No words to review"}
    yesterday = planning.day_end(utcnow(), OFFSET, -2) + timedelta(hours=1)
    old = utcnow() - timedelta(days=30)
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word.in_(["talk", "able"])).values(created_at=yesterday))
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == "absorb").values(created_at=old))
        await s.commit()
    got = lambda r: sorted(i["card"]["key"] for i in r.json()["items"])  # noqa: E731
    assert got(await start(client, h, scope="yesterday")) == ["able", "talk"]
    assert got(await start(client, h, scope="last7")) == sorted(w for w in WORDS if w != "absorb")


async def test_book_tier_and_weak_scopes(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == "talk").values(box=5))
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == "able").values(box=1, lapses=2))
        await s.commit()
    keys = lambda r: sorted(i["card"]["key"] for i in r.json()["items"])  # noqa: E731
    assert keys(await start(client, h, scope="tier", tier="mastered")) == ["talk"]
    assert keys(await start(client, h, scope="weak")) == ["able"]
    assert len(keys(await start(client, h, scope="book", book="junior"))) == len(WORDS)
    assert (await start(client, h, scope="book")).json() == {"error": "Invalid scope"}                 # 缺书
    assert (await start(client, h, scope="tier")).json() == {"error": "Invalid scope"}                 # 缺熟练度
    assert (await start(client, h, scope="book", book="cet4")).json() == {"error": "Invalid scope"}    # 未启用的书
    assert (await start(client, h, scope="book", book="senior")).json() == {"error": "No words to review"}  # 启用了但没有词


async def test_the_client_cannot_name_words(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    assert (await start(client, h, keys=["talk"])).status_code == 422
    assert (await start(client, h, key="talk")).status_code == 422


async def test_start_writes_no_events_and_spends_no_answers(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    async with app.state.sessionmaker() as s:
        before = await s.scalar(select(func.count()).select_from(WordbookEvent))
    await start(client, h)
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(WordbookEvent)) == before


async def test_daily_start_limit(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    monkeypatch.setattr(store, "FREE_STARTS_DAILY_MAX", 1)
    assert (await start(client, h)).status_code == 200
    r = await start(client, h)
    assert (r.status_code, r.json()) == (429, {"error": "Daily free-review limit reached"})


async def test_an_empty_pool_does_not_cost_a_start(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    monkeypatch.setattr(store, "FREE_STARTS_DAILY_MAX", 1)
    assert (await start(client, h, scope="yesterday")).status_code == 409
    assert (await start(client, h)).status_code == 200


async def test_injected_rng_makes_the_draw_reproducible(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    async with app.state.sessionmaker() as s:
        from app.models import User
        uid = await s.scalar(select(User.id))
        args = dict(scope="all", mode="browse", count=10, book=None, tier=None, offset=OFFSET, now=utcnow())
        a = await service.free_start(s, dictionary(app), uid, app.state.settings, rng=random.Random(7), **args)
        b = await service.free_start(s, dictionary(app), uid, app.state.settings, rng=random.Random(7), **args)
    assert [i["card"]["key"] for i in a["items"]] == [i["card"]["key"] for i in b["items"]]


async def test_free_choice_qtype_offers_cloze_only_when_a_sentence_can_be_blanked(app, client, tmp_path):
    await login(app, client, tmp_path)
    ability = await dictionary(app).card("junior", "ability")  # 例句里只有变形或没有原形时没有 cloze
    talk = await dictionary(app).card("junior", "talk")
    for card in (ability, talk):
        seen = {quiz.free_choice_qtype(card, random.Random(i)) for i in range(80)}
        assert {"meaning", "word"} <= seen <= {"meaning", "word", "cloze"}
        assert ("cloze" in seen) == bool(quiz.cloze_example(card))
    assert quiz.free_spellable(talk) is True


async def test_words_never_reach_the_logs(app, client, tmp_path, caplog):
    caplog.set_level("DEBUG")
    h = await login(app, client, tmp_path)
    await start(client, h, mode="spell")
    assert "ability" not in caplog.text and "absorb" not in caplog.text
```

> 说明:`test_count_caps…` 里第二段只是确认 `count=5` 被 `Literal[10, 20, 50]` 拒绝(422)。`ability` 的例句若没有原形出现,`cloze_example` 为 `None`,上面的断言按卡片实际情况判断,不硬编码哪个词有 cloze。

- [ ] **Step 2: 跑测试确认失败** — `uv run pytest -q tests/test_wordbook_free_start.py`。
- [ ] **Step 3: 实现 quiz 纯函数** — `quiz.py` 末尾追加:

```python
def free_choice_qtype(card: WordCard, rng: random.Random) -> QType:
    """自由复习的选择题题型(R-L11):与盒子无关;释义选词、看释义选词,有可挖空例句时再加例句选词。"""
    options: list[QType] = ["meaning", "word"]
    if cloze_example(card):
        options.append("cloze")
    return rng.choice(options)


def free_spellable(card: WordCard) -> bool:
    """自由复习的拼写题只抽可拼写的单词(与 eligible_qtypes 的 spell 条件一致)。"""
    return bool(card.spellable) and " " not in card.key
```

- [ ] **Step 4: 实现 service** — 按插入点加 `import secrets`、import `free_choice_qtype, free_spellable`,在 S3 追加的段落末尾追加:

```python
FREE_OVERSAMPLE = 3  # 拼写题多抽 3 倍再筛掉不可拼写的词


async def free_start(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, *, scope: str,
                     mode: str, count: int, book: str | None, tier: str | None, offset: int, now,
                     rng: random.Random | None = None) -> dict:
    """自由复习开始:服务端按范围抽词、出题(R-L9 / R-L10)。客户端不能指定词。先校验、再取池(空池不扣次数)、再扣次数。"""
    enabled = enabled_books(settings.wordbook_books)
    if scope == "book" and (book is None or book not in enabled):
        fail(INVALID_SCOPE)
    if scope == "tier" and tier is None:
        fail(INVALID_SCOPE)
    since, until = learned.scope_window(scope, now, offset)
    pool = await store.free_pool(session, user_id, store.learned_sources((book,) if scope == "book" else enabled),
                                 tier=tier if scope == "tier" else None, weak=scope == "weak", since=since, until=until)
    if not pool:
        fail(NOTHING_TO_REVIEW)
    if not await store.consume_free_start(session, user_id, utc_day(now)):
        fail(FREE_LIMIT)
    rng = rng or random.Random()
    pool.sort()
    picked = rng.sample(pool, min(len(pool), count * FREE_OVERSAMPLE if mode == "spell" else count))
    await ensure_hidden(session, ds)
    cards: dict[tuple[str, str], WordCard] = {}
    for book_id in dict.fromkeys(b for _, b in picked):
        found = await cards_or_fail(ds, book_id, [w for w, b in picked if b == book_id])
        cards.update({(book_id, k): c for k, c in found.items()})
    qrng = random.Random(rng.getrandbits(64))
    items: list[dict] = []
    for word, book_id in picked:
        card = cards.get((book_id, word))
        if card is None or (mode == "spell" and not free_spellable(card)):
            continue
        question = None
        if mode != "browse":
            qtype = "recall" if mode == "recall" else "spell" if mode == "spell" else free_choice_qtype(card, qrng)
            question = question_out(await _question(ds, await index_or_fail(ds, book_id), card, qtype, qrng))
        items.append({"book_id": book_id, "card": card_out(card), "question": question})
        if len(items) == count:
            break
    if not items:
        fail(NOTHING_TO_REVIEW)
    return {"set_id": secrets.token_hex(6), "scope": scope, "mode": mode, "items": items}
```

- [ ] **Step 5: 实现路由** — 追加:

```python
class FreeStartIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scope: Literal["yesterday", "last7", "book", "tier", "weak", "all"]
    mode: Literal["browse", "recall", "choice", "spell"]
    count: Literal[10, 20, 50]
    book: str | None = Field(None, max_length=16)
    tier: Literal["learning", "growing", "mastered"] | None = None
    tz_offset_minutes: int = Field(0, ge=TZ_MIN, le=TZ_MAX)


@router.post("/free/start")
async def wordbook_free_start(payload: FreeStartIn, request: Request, user: User = Depends(current_user),
                              session: AsyncSession = Depends(get_session),
                              settings: Settings = Depends(require_wordbook)):
    try:
        return await service.free_start(session, dictionary(request.app), user.id, settings, scope=payload.scope,
                                        mode=payload.mode, count=payload.count, book=payload.book, tier=payload.tier,
                                        offset=payload.tz_offset_minutes, now=utcnow())
    except service.WordbookError as e:
        _raise(e)
```

- [ ] **Step 6: 跑测试确认通过** — `uv run pytest -q tests/test_wordbook_free_start.py tests/test_wordbook_quiz.py tests/test_architecture.py`。
- [ ] **Step 7: 提交** — `feat(server): free-review draw by scope with server-side random picks`。

### Task S5: `/answers` 的 `mode="free"` — 规则表与刷分防护

**Files:**
- Modify: `server/app/routers/wordbook.py`(`AnswerIn.mode` 一行)、`server/app/wordbook/service.py`(`_answer` 3 行 + `_free_answer`)
- Test: `server/tests/test_wordbook_free_answers.py`

**Interfaces:**
- Consumes:S2(`pull_eligible`、`pull_due`、`consume_free_pull`)、既有 `consume_answer`、`check_choice`、`grade_blank`、`srs_grade`、`recall.effective_rating`、`recall.GRADE`、`_answer_out`、`learning_events.publish`。
- Produces:`POST /api/wordbook/answers` 接受 `mode: "free"`;响应形状不变(`applied` 在自由模式下 = 「这个词被加入了今天的复习」)。

**规则表(与规格 §1.3、R-L6、R-L7 一致,逐行有测试):**

| 情形 | 盒子 | `reps` / `last_reviewed_at` | 到期 | 事件 | 段位 | `applied` |
|---|---|---|---|---|---|---|
| 自由答对(任何题型,含到期的词) | 不变 | 不变 | 不变 | `practice` | 无 | false |
| 自由答错,词未到期、24h 内没复习、今日拉取未满 | 不变 | 不变 | `= now` | `practice` | 无 | true |
| 自由答错,但词已到期 / 24h 内复习过 / 今日拉取已满 | 不变 | 不变 | 不变 | `practice` | 无 | false |
| 快速回忆 `fuzzy`、拼写笔误 / 词形不对 | 不变 | 不变 | 不变 | `practice` | 无 | false |

- [ ] **Step 1: 写失败测试** — `server/tests/test_wordbook_free_answers.py`:

```python
"""自由复习作答:规则表与刷分防护(计划 2026-10-12-wordbook-learned-review S5;R-L6 / R-L7 / R-L8)。"""
from datetime import timedelta

from sqlalchemy import select, update

from app.core import learning_events
from app.models import User, VocabularyItem, WordbookEvent, XpEvent, utcnow
from app.services.stats import as_utc
from app.wordbook import store
from app.wordbook.entry import meaning_line
from app.wordbook.index import dictionary
from tests.test_wordbook_rank_abuse import me, task
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/wordbook"


async def login(app, client, tmp_path, **overrides):
    enable_wordbook(app, make_data_dir(tmp_path, ("junior", "senior")), wordbook_books="junior,senior", **overrides)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    await client.put(f"{URL}/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    for key in ("talk", "ability", "able"):  # 都是「认识」:盒 2,明天之后到期
        await client.post(f"{URL}/answers", headers=h, json={
            "book_id": "junior", "key": key, "mode": "learn", "qtype": "recall", "rating": "know", "tz_offset_minutes": 480})
    return h


async def free(client, h, **body):
    return await client.post(f"{URL}/answers", headers=h, json={"book_id": "junior", "mode": "free", "tz_offset_minutes": 480, **body})


async def choice(client, h, key, *, right: bool, qtype="word"):
    return await free(client, h, key=key, qtype=qtype, choice=key if right else "stop")


async def row(app, word) -> VocabularyItem:
    async with app.state.sessionmaker() as s:
        return await s.scalar(select(VocabularyItem).where(VocabularyItem.word == word))


async def events(app):
    async with app.state.sessionmaker() as s:
        return [(e.kind, e.word, e.qtype, e.outcome) for e in (await s.scalars(select(WordbookEvent).order_by(WordbookEvent.id))).all()]


async def patch(app, word, **values):
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == word).values(**values))
        await s.commit()


def frozen(r: VocabularyItem):
    return (r.box, r.reps, r.lapses, r.last_reviewed_at)


async def test_a_right_answer_changes_nothing_but_records_practice(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    before = await row(app, "talk")
    r = (await choice(client, h, "talk", right=True)).json()
    assert (r["correct"], r["outcome"], r["applied"], r["expected"]) == (True, "correct", False, "talk")
    after = await row(app, "talk")
    assert frozen(after) == frozen(before) and after.due_at == before.due_at
    assert (await events(app))[-1] == ("practice", "talk", "word", "correct")


async def test_a_wrong_answer_pulls_a_future_word_to_now_and_nothing_else(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    before = await row(app, "talk")
    r = (await choice(client, h, "talk", right=False)).json()
    assert (r["correct"], r["outcome"], r["grade"], r["applied"]) == (False, "wrong", "forgot", True)
    after = await row(app, "talk")
    assert frozen(after) == frozen(before)                       # 盒子、reps、lapses、last_reviewed_at 都不变
    assert as_utc(after.due_at) <= utcnow() and r["item"]["box"] == before.box
    batch = (await client.post(f"{URL}/review/batch", headers=h, json={"size": 5, "tz_offset_minutes": 480})).json()
    assert [c["key"] for c in batch["cards"]] == ["talk"]        # 进了正式复习队列
    assert (await events(app))[-1][0] == "practice"


async def test_an_already_due_word_is_left_alone(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    overdue = utcnow() - timedelta(days=3)
    await patch(app, "talk", due_at=overdue)
    for right in (True, False):
        r = (await choice(client, h, "talk", right=right)).json()
        assert r["applied"] is False
    after = await row(app, "talk")
    assert as_utc(after.due_at) == as_utc(overdue) and after.reps == 0 and after.last_reviewed_at is None


async def test_quick_recall_only_unknown_counts_as_wrong(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    know = (await free(client, h, key="talk", qtype="recall", rating="know")).json()
    peeked = (await free(client, h, key="ability", qtype="recall", rating="know", revealed_before=True)).json()
    unknown = (await free(client, h, key="able", qtype="recall", rating="unknown")).json()
    assert (know["rating"], know["applied"], know["spot_check"], know["check"]) == ("know", False, False, None)
    assert (peeked["rating"], peeked["applied"]) == ("fuzzy", False)      # 偷看 → 模糊,不算错
    assert (unknown["rating"], unknown["grade"], unknown["applied"]) == ("unknown", "forgot", True)
    assert (await row(app, "able")).box == 2


async def test_fuzzy_twice_does_not_become_unknown_in_free_mode(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    for _ in range(2):
        assert (await free(client, h, key="talk", qtype="recall", rating="fuzzy")).json()["rating"] == "fuzzy"


async def test_spelling_typo_is_neutral_and_wrong_pulls(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    typo = (await free(client, h, key="talk", qtype="spell", typed="talkk")).json()
    assert (typo["outcome"], typo["applied"]) == ("typo", False)
    wrong = (await free(client, h, key="talk", qtype="spell", typed="zqxjvw")).json()
    assert (wrong["outcome"], wrong["applied"]) == ("wrong", True)


async def test_a_word_reviewed_within_24_hours_is_not_pulled(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    reviewed = utcnow() - timedelta(hours=2)
    await patch(app, "talk", last_reviewed_at=reviewed, reps=1)
    before = await row(app, "talk")
    r = (await choice(client, h, "talk", right=False)).json()
    assert r["applied"] is False and (await row(app, "talk")).due_at == before.due_at


async def test_daily_pull_cap_still_grades_but_stops_queueing(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    monkeypatch.setattr(store, "FREE_PULLS_DAILY_MAX", 1)
    first = (await choice(client, h, "talk", right=False)).json()
    second = (await choice(client, h, "ability", right=False)).json()
    assert (first["applied"], second["applied"]) == (True, False) and second["correct"] is False
    assert as_utc((await row(app, "ability")).due_at) > utcnow()


async def test_validation(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    assert (await free(client, h, key="talk", qtype="meaning", known=True)).status_code == 422   # known 只给学新词
    assert (await free(client, h, key="talk", qtype="word")).status_code == 422                   # 缺 choice
    assert (await free(client, h, key="talk", qtype="spell")).status_code == 422                  # 缺 typed
    assert (await free(client, h, key="talk", qtype="recall")).json() == {"error": "Rating is required"}
    for body in ({"key": "abandon"}, {"key": "talk", "book_id": "senior"}):                        # 没学过 / 不是这本书学的
        r = await free(client, h, qtype="word", choice="x", **body)
        assert (r.status_code, r.json()) == (404, {"error": "Word not found"}), body


async def test_a_word_from_another_source_is_not_a_free_review_word(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    async with app.state.sessionmaker() as s:
        uid = await s.scalar(select(User.id))
        s.add(VocabularyItem(id="manual-1", user_id=uid, word="absorb", meaning="", source="manual", box=0,
                             due_at=utcnow() + timedelta(days=1), reps=0, lapses=0, created_at=utcnow()))
        await s.commit()
    r = await choice(client, h, "absorb", right=False)
    assert r.status_code == 404


async def test_free_answers_spend_the_shared_daily_answer_cap(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    monkeypatch.setattr(store, "ANSWERS_DAILY_MAX", 1)
    assert (await choice(client, h, "talk", right=True)).status_code == 200
    r = await choice(client, h, "talk", right=True)
    assert (r.status_code, r.json()) == (429, {"error": "Daily answer limit reached"})


async def test_free_answers_do_not_move_today_s_plan_or_the_goal(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    before = (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": 480})).json()["plan"]
    for _ in range(3):
        await choice(client, h, "talk", right=True)
    after = (await client.get(f"{URL}/today", headers=h, params={"tz_offset_minutes": 480})).json()["plan"]
    for key in ("new_done", "review_done", "bonus"):
        assert after[key] == before[key]


async def test_free_answers_publish_one_practice_event_each(app, client, tmp_path, monkeypatch):
    h = await login(app, client, tmp_path)
    seen = []
    monkeypatch.setattr(learning_events, "publish", seen.append)
    await choice(client, h, "talk", right=False)
    await free(client, h, key="ability", qtype="recall", rating="know")
    assert [(e.kind, e.word, e.qtype, e.outcome) for e in seen] == [
        ("practice", "talk", "word", "wrong"), ("practice", "ability", "recall", "know")]


async def test_free_answers_cannot_farm_rank_points(app, client, tmp_path):
    """R-L6:错 → 拉到今天到期 → 复习 是唯一能产生 vocab_review 的路径;自由作答本身一个点也不产生。"""
    h = await login(app, client, tmp_path, rank_enabled=True)
    for i in range(12):
        await choice(client, h, "talk", right=bool(i % 2))
        await free(client, h, key="ability", qtype="recall", rating="unknown")
    done = task(await me(client, h), "vocab_reviews")
    assert done["done"] == 0 and done["complete"] is False
    async with app.state.sessionmaker() as s:
        assert (await s.scalars(select(XpEvent).where(XpEvent.kind == "vocab_review"))).all() == []
        for word in ("talk", "ability"):
            r = (await s.scalars(select(VocabularyItem).where(VocabularyItem.word == word))).one()
            assert (r.reps, r.last_reviewed_at) == (0, None)


async def test_typed_text_and_words_are_not_logged(app, client, tmp_path, caplog):
    caplog.set_level("DEBUG")
    h = await login(app, client, tmp_path)
    await free(client, h, key="talk", qtype="spell", typed="zqxjvw")
    assert "zqxjvw" not in caplog.text


async def test_meaning_choice_is_graded_from_the_card(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    line = meaning_line(await dictionary(app).card("junior", "talk"))
    r = (await free(client, h, key="talk", qtype="meaning", choice=line)).json()
    assert (r["correct"], r["correct_option"]) == (True, line)
```

> **执行者注意:** `test_free_answers_cannot_farm_rank_points` 里 `ability` 的第一次 `unknown` 会把它拉到今天到期(这是规则允许的,最多 20 个/天),但**没有**发生正式复习,所以 `reps` 仍为 0——这正是要钉住的行为。`tests.test_wordbook_rank_abuse.me` 用 `tz_offset_minutes=480`,与本文件一致。

- [ ] **Step 2: 跑测试确认失败** — `uv run pytest -q tests/test_wordbook_free_answers.py`(422:`mode` 不接受 `free`)。
- [ ] **Step 3: 改路由** — `AnswerIn.mode: Literal["learn", "review"]` 改为 `Literal["learn", "review", "free"]`。
- [ ] **Step 4: 改 service** — `_answer` 里 `_validate(p)` 之后紧接着插入(`known` 与 `free` 并用已在 `_validate` 里 422):

```python
    if p.mode == "free":  # 随时自由复习:与学新词 / 复习的写盒子路径完全隔离(R-L6、R-L8)
        return await _free_answer(session, ds, user_id, settings, p, now)
```

在 `_rating_answer` 之后、`# ---- 按句拼写` 之前追加:

```python
# ---- 自由复习作答(spec 2026-10-12 §1.3;计划 2026-10-12-wordbook-learned-review S5)----

async def _free_answer(session: AsyncSession, ds: DictionaryStore, user_id: int, settings: Settings, p: AnswerInput,
                       now) -> dict:
    """永不改盒子 / reps / last_reviewed_at,事件 kind 固定 practice。答错且(未到期、24h 内没复习、今日拉取未满)时
    只把 due_at 改为现在(R-L6);其余一律不动。答对与到期的词原样不变。"""
    await ensure_hidden(session, ds)
    card = (await cards_or_fail(ds, p.book_id, [p.key])).get(p.key)
    if card is None:
        fail(WORD_NOT_FOUND)
    row = await store.known_one(session, user_id, card.key)
    if row is None or row.source != store.wordbook_source(p.book_id):
        fail(WORD_NOT_FOUND)
    if not await store.consume_answer(session, user_id, utc_day(now)):
        fail(ANSWER_LIMIT)
    diff = option = rating = None
    if p.qtype == recall.RECALL_QTYPE:  # R-L7:有效评级只看这一次,不看历史
        rating = recall.effective_rating(p.rating, revealed_before=p.revealed_before, previous=None)
        outcome, credit, correct, wrong, grade = rating, 100 if rating == "know" else 0, rating == "know", \
            rating == "unknown", recall.GRADE[rating]
    elif p.qtype in CHOICE_QTYPES:
        correct = check_choice(p.qtype, card, p.choice)
        outcome, credit, wrong = ("correct", 100, False) if correct else ("wrong", 0, True)
        grade, option = srs_grade(outcome, p.hinted), correct_option(p.qtype, card)
    else:
        result = grade_blank(card.word, card.key, p.typed, hinted=p.hinted)
        outcome, credit, diff = result.outcome, result.credit, [asdict(d) for d in result.diff] or None
        grade = srs_grade(outcome, p.hinted)
        correct, wrong = outcome == "correct", grade == "forgot"
    queued = False
    if wrong and row.due_at > now and await store.pull_eligible(session, user_id, row.item_id, now) \
            and await store.consume_free_pull(session, user_id, utc_day(now)):
        queued = await store.pull_due(session, user_id, row.item_id, now)
    await store.add_event(session, user_id=user_id, book_id=p.book_id, kind="practice", word=card.key,
                          item_id=row.item_id, qtype=p.qtype, outcome=outcome, credit=credit,
                          day=local_day(now, p.offset), now=now)
    await session.commit()
    learning_events.publish(learning_events.WordAnswered(
        user_id=user_id, book_id=p.book_id, word=card.key, kind="practice", qtype=p.qtype, outcome=outcome,
        credit=credit, at=now))
    return _answer_out(correct, outcome, grade, card, option, diff, await store.known_one(session, user_id, card.key),
                       queued, rating=rating)
```

> 注意:`_answer_out` 的 `correct` 对打字题沿用既有口径 `outcome == "correct"`(笔误不算对)。`p.rating` 在 `_validate` 里已保证非空(缺 → 422 `Rating is required`),`p.choice` / `p.typed` 同理。

- [ ] **Step 5: 跑测试确认通过** — `uv run pytest -q tests/test_wordbook_free_answers.py tests/test_wordbook_learn.py tests/test_wordbook_recall_api.py tests/test_wordbook_rank_abuse.py tests/test_rank_wordbook.py tests/test_architecture.py`(学新词 / 复习 / 防刷分既有测试必须原样通过)。
- [ ] **Step 6: 提交** — `feat(server): free-review answers that never touch boxes, reps or rank points`。

### Task S6: 契约样例、文档(服务端)

**Files:**
- Modify: `server/tests/test_wordbook_contract.py`、`server/tests/fixtures/wordbook_contract.json`(重录)、`server/app/wordbook/CLAUDE.md`、`server/app/routers/CLAUDE.md`

- [ ] **Step 1: 改契约测试** — 按插入点:

```python
LEARNED_KEYS = {"learned_summary", "learned_list", "learned_card", "free_start", "answer_free"}  # 计划 2026-10-12-wordbook-learned-review S6
```

`collect()` 里 `out |= await collect_goals(client, h)` 之前加 `out |= await collect_learned(client, h)`;`collect_goals` 之前加:

```python
async def collect_learned(client, h) -> dict:
    """已学词与自由复习(计划 2026-10-12-wordbook-learned-review S6):接在 collect() 之后(已学 6 个词)、重置之前。"""
    async def ok(r):
        assert r.status_code == 200, r.text
        return r.json()
    out = {"learned_summary": await ok(await client.get(f"{URL}/learned/summary", headers=h, params={"tz_offset_minutes": 0}))}
    out["learned_list"] = await ok(await client.post(f"{URL}/learned/query", headers=h, json={"limit": 2}))  # limit 2 → next_cursor 是字符串
    out["learned_card"] = await ok(await client.post(f"{URL}/learned/card", headers=h, json={"book_id": "junior", "key": "talk"}))
    out["free_start"] = await ok(await client.post(f"{URL}/free/start", headers=h, json={"scope": "all", "mode": "choice", "count": 10}))
    out["answer_free"] = await ok(await client.post(f"{URL}/answers", headers=h, json={  # able 盒 2、未到期:答错 → 入队
        "book_id": "junior", "key": "able", "mode": "free", "qtype": "word", "choice": "stop"}))
    return out
```

断言 `assert set(actual) == KEYS | GOALS_KEYS | LEARNED_KEYS`;非空列表清单加 `("learned_list", "items"), ("free_start", "items")`;末尾追加:

```python
    assert expected["learned_list"]["next_cursor"] and expected["answer_free"]["applied"] is True
    assert expected["free_start"]["items"][0]["question"]["options"]
    assert "by_book" in expected["learned_summary"] and isinstance(expected["learned_summary"]["by_book"], list)
```

- [ ] **Step 2: 重录** — `cd server && CONTRACT_UPDATE=1 uv run pytest -q tests/test_wordbook_contract.py`(PowerShell:`$env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_wordbook_contract.py; Remove-Item Env:CONTRACT_UPDATE`);再不带变量跑一次;`git diff --stat` 确认只是追加键,既有键(`today`、`answer_*` 等)没有变化;样例里没有令牌、本机路径、选书 `seed`。
- [ ] **Step 3: 文档** — `server/app/wordbook/CLAUDE.md`:`What lives here` 加 `learned.py` – 已学词熟练度分档(存储盒 0–5)、易错判定、游标、本地日窗口(纯);`Pitfalls` 追加:
  - 已学词 = `source='wordbook:<启用书>'`;盒子 0–5 分三档(`learned.TIERS`,熟练下界 = `plan.MASTERED_BOX`);响应没有映射(`by_book` 是列表)。
  - 词、前缀、游标永远不进 URL:`/learned/query`、`/learned/card`、`/free/start` 都是 POST 体;`test_wordbook_learned_api.py::test_new_routes_carry_no_word_in_the_url` 守着。`GET /cards/{book}/{key}` 是遗留写法,别再让新页面用。
  - `mode="free"`(`service._free_answer`):永不调用 `apply_review` / `apply_lapse` / `set_learn_box`;事件固定 `practice`;答错只可能 `pull_due`(`due_at = now`),受「24 小时内正式复习过不拉」与每日 20 次(`store.FREE_PULLS_DAILY_MAX`)约束。改这几条前先读 R-L6:`due_at = now` 会通向 `vocab_review`。
  - `free_start` 用系统熵 `random.Random()`(可注入),不用选书 `seed`;空池不扣 `FREE_STARTS_DAILY_MAX`(200)。
  - 契约样例新增 `learned_summary / learned_list / learned_card / free_start / answer_free`。
  `server/app/routers/CLAUDE.md` 的 `wordbook` 行追加 `learned/summary`、`learned/query`、`learned/card`、`free/start`(词只在 POST 体)。
- [ ] **Step 4: 全量服务端** — `cd server && uv run pytest -q`(约 2.5 分钟;执行者按文件分批跑也可)。
- [ ] **Step 5: 提交** — `test(server): wordbook contract covers learned words and free review` 与 `docs(server): learned words and free review notes`。

---

## Lane web (W)

### Task W1: API 类型与函数、错误表、`web.wordbook.learned.*` 文案

**Files:**
- Modify: `web/src/features/wordbook/wordbook-api.ts`、`web/src/features/wordbook/i18n/zh-CN.json`、`web/src/features/wordbook/i18n/en.json`、`web/src/features/wordbook/i18n.test.ts`、`web/src/features/wordbook/wordbook-api.test.ts`
- Create: `web/src/features/wordbook/learned-test-fixtures.ts`

**Interfaces:**
- Produces(类型,camelCase):`Tier`、`LearnedItem`、`LearnedPage`、`LearnedSummary`、`LearnedQuery`、`FreeScope`、`FreeMode`、`FreeCount`、`FreeItem`、`FreeSet`、`FreeRequest`;函数 `fetchLearnedSummary(api, signal?)`、`fetchLearned(api, query, signal?)`、`fetchLearnedCard(api, bookId, key, signal?)`、`startFree(api, req)`;`AnswerInput.mode` 增 `"free"`;`WORDBOOK_SERVER_ERRORS` 增 5 条。

- [ ] **Step 0: 记基线** — `yarn web:build`,记下主包(`index-*.js`)的 gzip 大小,写进 Z2 的结果表「基线」一列(R-L13 的比较对象)。
- [ ] **Step 1: 写失败测试** — `wordbook-api.test.ts` 追加:

```ts
import { fetchLearned, fetchLearnedCard, fetchLearnedSummary, startFree } from "./wordbook-api";

describe("learned words and free review api", () => {
  it("sends the prefix and every filter in the POST body, never in the URL", async () => {
    const { mock, api: client } = api({ "POST /api/wordbook/learned/query": () => json({ items: [], next_cursor: null }) });
    await fetchLearned(client, { q: "ab", tier: "growing", weak: true, since: "2026-10-01" });
    const call = mock.calls[0];
    expect(call.url.search).toBe("");
    expect(call.url.pathname).toBe("/api/wordbook/learned/query");
    expect(JSON.parse(String(call.body))).toEqual({ q: "ab", tier: "growing", weak: true, since: "2026-10-01", tz_offset_minutes: expect.any(Number) });
  });

  it("camelCases the summary and keeps by_book a list", async () => {
    const { api: client } = api({
      "GET /api/wordbook/learned/summary": () => json({
        total: 3, by_box: [1, 1, 1, 0, 0, 0], by_tier: { learning: 2, growing: 1, mastered: 0 }, by_book: [{ book_id: "junior", count: 3 }],
        weak: 1, yesterday: 0, last7: 3,
      }),
    });
    expect(await fetchLearnedSummary(client)).toEqual({
      total: 3, byBox: [1, 1, 1, 0, 0, 0], byTier: { learning: 2, growing: 1, mastered: 0 }, byBook: [{ bookId: "junior", count: 3 }],
      weak: 1, yesterday: 0, last7: 3,
    });
  });

  it("posts the card lookup and the free draw with snake_case bodies and no word in the URL", async () => {
    const { mock, api: client } = api({
      "POST /api/wordbook/learned/card": () => json({ key: "talk" }),
      "POST /api/wordbook/free/start": () => json({ set_id: "abc", scope: "all", mode: "browse", items: [] }),
    });
    await fetchLearnedCard(client, "junior", "talk");
    await startFree(client, { scope: "book", mode: "choice", count: 20, book: "junior" });
    expect(mock.calls.map((c) => c.url.search)).toEqual(["", ""]);
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ book_id: "junior", key: "talk" });
    expect(JSON.parse(String(mock.calls[1].body))).toMatchObject({ scope: "book", mode: "choice", count: 20, book: "junior" });
  });

  it("answers can be sent in free mode", async () => {
    const { mock, api: client } = api({ "POST /api/wordbook/answers": () => json({ correct: true, outcome: "correct", grade: "good", expected: "talk", diff: null, item: null, applied: false }) });
    await submitAnswer(client, { bookId: "junior", key: "talk", mode: "free", qtype: "word", choice: "talk" });
    expect(JSON.parse(String(mock.calls[0].body)).mode).toBe("free");
  });
});
```

(`submitAnswer` 已在该文件顶部导入。`createFetchMock` 的 `call.url` 是 `URL` 对象、`call.body` 是请求体字符串,与文件中既有用法一致。)

- [ ] **Step 2: 跑测试确认失败** — `cd web && yarn vitest run src/features/wordbook/wordbook-api.test.ts`。
- [ ] **Step 3: 实现 API** — `wordbook-api.ts`:`AnswerInput.mode` 改 `"learn" | "review" | "free"`;`WORDBOOK_SERVER_ERRORS` 末尾追加:

```ts
  "Invalid cursor": "web.wordbook.learned.errors.cursor",
  "Invalid date": "web.wordbook.learned.errors.date",
  "Invalid scope": "web.wordbook.learned.errors.scope",
  "No words to review": "web.wordbook.learned.errors.nothing",
  "Daily free-review limit reached": "web.wordbook.learned.errors.freeLimit",
```

文件末尾(`fetchCard` 之后)追加:

```ts
// ---- 已学词与自由复习(计划 2026-10-12-wordbook-learned-review)。词与前缀只放在 POST 体里,不进 URL(R-L4)。----
/** 熟练度三档:新学 = 盒 0–1,巩固中 = 盒 2–3,熟练 = 盒 4–5(R-L1)。 */
export type Tier = "learning" | "growing" | "mastered";
export interface LearnedItem { bookId: BookId; key: string; word: string; box: number; tier: Tier; learnedAt: string; dueAt: string; weak: boolean }
export interface LearnedPage { items: LearnedItem[]; nextCursor: string | null }
export interface LearnedSummary {
  total: number; byBox: number[]; byTier: Record<Tier, number>; byBook: { bookId: BookId; count: number }[];
  weak: number; yesterday: number; last7: number;
}
export interface LearnedQuery { book?: BookId; tier?: Tier; weak?: boolean; since?: string; until?: string; q?: string; cursor?: string; limit?: number }
export type FreeScope = "yesterday" | "last7" | "book" | "tier" | "weak" | "all";
export type FreeMode = "browse" | "recall" | "choice" | "spell";
export type FreeCount = 10 | 20 | 50;
export interface FreeRequest { scope: FreeScope; mode: FreeMode; count: FreeCount; book?: BookId; tier?: Tier }
export interface FreeItem { bookId: BookId; card: Card; question: Question | null }
export interface FreeSet { setId: string; scope: FreeScope; mode: FreeMode; items: FreeItem[] }

export const fetchLearnedSummary = (api: ApiClient, signal?: AbortSignal) =>
  api.request<LearnedSummary>("GET", "/api/wordbook/learned/summary", { query: { tz_offset_minutes: localOffsetMinutes() }, signal });

export const fetchLearned = (api: ApiClient, query: LearnedQuery, signal?: AbortSignal) =>
  api.request<LearnedPage>("POST", "/api/wordbook/learned/query", { json: { ...query, ...tz() }, signal });

export const fetchLearnedCard = (api: ApiClient, bookId: BookId, key: string, signal?: AbortSignal) =>
  api.request<Card>("POST", "/api/wordbook/learned/card", { json: { bookId, key }, signal });

export const startFree = (api: ApiClient, req: FreeRequest) =>
  api.request<FreeSet>("POST", "/api/wordbook/free/start", { json: { ...req, ...tz() } });
```

- [ ] **Step 4: 文案** — 两个 JSON 的 `web.wordbook` 对象里,在 `"goals": {` 键之前插入。`zh-CN.json`:

```json
      "learned": {
        "title": "已学词",
        "row": { "title": "已学词", "count_one": "已学 {{n}} 词", "count_other": "已学 {{n}} 词", "hint": "回顾、筛选、随时复习" },
        "box": { "label": "熟练度", "learning": "新学", "growing": "巩固中", "mastered": "熟练", "segment": "{{label}} {{n}} 词" },
        "search": { "label": "按英文前缀搜索", "placeholder": "单词开头,如 ab" },
        "filters": { "book": "词书", "allBooks": "全部词书", "weak": "易错", "since": "学于此日起", "until": "学于此日止", "clear": "清除筛选" },
        "list": { "label": "已学词", "learnedOn": "{{date}} 学", "weak": "易错", "dueNow": "已到期", "dueOn": "{{date}} 复习", "more": "加载更多", "end": "已显示全部" },
        "empty": { "title": "还没有已学的词", "body": "学几个新词,它们会出现在这里。", "cta": "去学新词", "filtered": "没有符合条件的词", "clear": "清除筛选" },
        "card": { "unavailable": "词卡暂时打不开" },
        "free": {
          "open": "自由复习", "title": "自由复习",
          "note": "不计段位点,不占每日复习上限;答错的词会加入今天的复习。",
          "scope": { "label": "范围", "yesterday": "昨天学的", "last7": "最近 7 天", "book": "某一本书", "tier": "某个熟练度", "weak": "易错词", "all": "随机抽取" },
          "pickBook": "词书", "pickTier": "熟练度",
          "mode": { "label": "方式", "browse": "翻卡浏览", "recall": "快速回忆", "choice": "选择题", "spell": "拼写" },
          "count": { "label": "数量", "n": "{{n}} 个" },
          "start": "开始", "starting": "准备中",
          "summary": { "note": "自由复习不计段位点,也不改变复习计划。", "queued_one": "{{n}} 个答错的词已加入今天的复习。", "queued_other": "{{n}} 个答错的词已加入今天的复习。", "back": "回到已学词" },
          "browse": { "title": "翻卡浏览", "progress": "{{n}} / {{total}}", "flip": "翻面", "prev": "上一个", "next": "下一个", "finish": "看完了", "done": "这一组看完了", "again": "再看一遍" }
        },
        "errors": { "cursor": "列表已过期,请刷新", "date": "日期不正确", "scope": "复习范围不正确", "nothing": "这个范围里还没有可复习的词", "freeLimit": "今天开始自由复习的次数已用完" }
      },
```

`en.json`:

```json
      "learned": {
        "title": "Learned words",
        "row": { "title": "Learned words", "count_one": "{{n}} word learned", "count_other": "{{n}} words learned", "hint": "Browse, filter and review any time" },
        "box": { "label": "Mastery", "learning": "New", "growing": "Growing", "mastered": "Strong", "segment": "{{label}}, {{n}} words" },
        "search": { "label": "Search by English prefix", "placeholder": "Start of a word, e.g. ab" },
        "filters": { "book": "Book", "allBooks": "All books", "weak": "Weak", "since": "Learned from", "until": "Learned until", "clear": "Clear filters" },
        "list": { "label": "Learned words", "learnedOn": "Learned {{date}}", "weak": "Weak", "dueNow": "Due now", "dueOn": "Due {{date}}", "more": "Load more", "end": "That's all" },
        "empty": { "title": "No learned words yet", "body": "Learn a few new words and they will show up here.", "cta": "Learn new words", "filtered": "No words match these filters", "clear": "Clear filters" },
        "card": { "unavailable": "The word card could not be opened" },
        "free": {
          "open": "Free review", "title": "Free review",
          "note": "No rank points and no daily review limit; words you miss are added to today's review.",
          "scope": { "label": "Range", "yesterday": "Yesterday", "last7": "Last 7 days", "book": "One book", "tier": "A mastery level", "weak": "Weak words", "all": "Random mix" },
          "pickBook": "Book", "pickTier": "Mastery",
          "mode": { "label": "Mode", "browse": "Flip cards", "recall": "Recall", "choice": "Choice", "spell": "Spelling" },
          "count": { "label": "How many", "n": "{{n}}" },
          "start": "Start", "starting": "Preparing",
          "summary": { "note": "Free review earns no rank points and does not change your review plan.", "queued_one": "{{n}} missed word was added to today's review.", "queued_other": "{{n}} missed words were added to today's review.", "back": "Back to learned words" },
          "browse": { "title": "Flip cards", "progress": "{{n}} / {{total}}", "flip": "Flip", "prev": "Previous", "next": "Next", "finish": "Done", "done": "You've seen this set", "again": "Go again" }
        },
        "errors": { "cursor": "The list expired, please refresh", "date": "That date is not valid", "scope": "That range is not valid", "nothing": "There are no words to review in this range yet", "freeLimit": "You have used today's free reviews" }
      },
```

`i18n.test.ts` 的「English counts are pluralised」里追加:

```ts
    expect(t("web.wordbook.learned.row.count", { count: 1, n: 1 })).toBe("1 word learned");
    expect(t("web.wordbook.learned.row.count", { count: 5, n: 5 })).toBe("5 words learned");
    expect(t("web.wordbook.learned.free.summary.queued", { count: 1, n: 1 })).toBe("1 missed word was added to today's review.");
```

中文用例里追加 `expect(i18n.t("web.wordbook.learned.row.count", { count: 3, n: 3 })).toBe("已学 3 词");`。文件里既有的「en / zh 键一致、占位符一致」测试会自动覆盖新子树。

- [ ] **Step 5: 样例** — `learned-test-fixtures.ts`(只给测试;snake_case):

```ts
// 已学词与自由复习的服务端响应样例(snake_case;计划 2026-10-12-wordbook-learned-review)。只被 *.test.ts(x) 引用。
import { card } from "./test-fixtures";

export const LEARNED_SUMMARY = {
  total: 6, by_box: [1, 2, 1, 1, 1, 0], by_tier: { learning: 3, growing: 2, mastered: 1 },
  by_book: [{ book_id: "cet4", count: 6 }], weak: 2, yesterday: 2, last7: 6,
};
export const LEARNED_ITEMS = [
  { book_id: "cet4", key: "accept", word: "accept", box: 1, tier: "learning", learned_at: "2026-10-12T02:00:00+00:00", due_at: "2026-10-13T02:00:00+00:00", weak: true },
  { book_id: "cet4", key: "carry", word: "carry", box: 3, tier: "growing", learned_at: "2026-10-11T02:00:00+00:00", due_at: "2026-10-01T02:00:00+00:00", weak: false },
  { book_id: "cet4", key: "talk", word: "talk", box: 5, tier: "mastered", learned_at: "2026-10-05T02:00:00+00:00", due_at: "2026-11-05T02:00:00+00:00", weak: false },
];
export const LEARNED_PAGE = { items: LEARNED_ITEMS, next_cursor: null as string | null };
export const FREE_SET = {
  set_id: "abcdef012345", scope: "all", mode: "choice",
  items: [
    { book_id: "cet4", card: card("accept"), question: { key: "accept", qtype: "word", prompt: { meaning: "vt. 接受" }, options: ["accept", "stop", "go", "child"], length: null } },
    { book_id: "cet4", card: card("talk"), question: { key: "talk", qtype: "spell", prompt: { meaning: "v. 说话", us: "tɔk" }, options: null, length: 4 } },
  ],
};
export const FREE_SET_BROWSE = { ...FREE_SET, mode: "browse", items: FREE_SET.items.map((i) => ({ ...i, question: null })) };
```

- [ ] **Step 6: 跑测试确认通过** — `yarn vitest run src/features/wordbook/wordbook-api.test.ts src/features/wordbook/i18n.test.ts && yarn web:typecheck`。
- [ ] **Step 7: 提交** — `feat(web): learned-word and free-review api types, errors and copy`。

### Task W2: `BoxBar` 与 `use-learned.ts`

**Files:**
- Create: `web/src/features/wordbook/box-bar.tsx`、`box-bar.test.tsx`、`use-learned.ts`、`use-learned.test.tsx`

**Interfaces:**
- Produces:`<BoxBar by={Record<Tier, number>} value={Tier | null} onChange={(tier: Tier | null) => void} />`(三个 ≥ 44px 的 `aria-pressed` 按钮;再点已选中的分段取消筛选);`useLearnedSummary(enabled) -> { summary, error, reload }`;`useLearnedList(query) -> { items, status: "loading" | "idle" | "more" | "error", error, hasMore, loadMore, reload }`;`useDebounced(value, ms)`。

- [ ] **Step 1: 写失败测试** — `box-bar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import { BoxBar } from "./box-bar";

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

const BY = { learning: 3, growing: 2, mastered: 1 };

describe("BoxBar", () => {
  it("shows the three tiers with counts and marks the selected one", () => {
    render(<BoxBar by={BY} value="growing" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "新学 3 词" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "巩固中 2 词" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "熟练 1 词" })).toBeTruthy();
  });

  it("selects a tier and clears it when the active one is pressed again", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<BoxBar by={BY} value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "熟练 1 词" }));
    expect(onChange).toHaveBeenLastCalledWith("mastered");
    rerender(<BoxBar by={BY} value="mastered" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "熟练 1 词" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("renders without dividing by zero when nothing is learned", () => {
    render(<BoxBar by={{ learning: 0, growing: 0, mastered: 0 }} value={null} onChange={() => {}} />);
    expect(screen.getByTestId("box-bar")).toBeTruthy();
  });
});
```

`use-learned.test.tsx`:

```tsx
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { LEARNED_ITEMS, LEARNED_SUMMARY } from "./learned-test-fixtures";
import { useLearnedList, useLearnedSummary } from "./use-learned";

const wrapper = (mock: ReturnType<typeof createFetchMock>) => ({ children }: { children: ReactNode }) => (
  <TestProviders api={new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch })}>{children}</TestProviders>
);
const bodies = (mock: ReturnType<typeof createFetchMock>) =>
  mock.calls.filter((c) => c.url.pathname.endsWith("/learned/query")).map((c) => JSON.parse(String(c.body)) as Record<string, unknown>);

describe("useLearnedSummary", () => {
  it("loads the summary and stays idle when disabled", async () => {
    const mock = createFetchMock({ "GET /api/wordbook/learned/summary": () => json(LEARNED_SUMMARY) });
    const { result } = renderHook(() => useLearnedSummary(true), { wrapper: wrapper(mock) });
    await waitFor(() => expect(result.current.summary?.total).toBe(6));
    const off = createFetchMock({});
    renderHook(() => useLearnedSummary(false), { wrapper: wrapper(off) });
    expect(off.calls).toHaveLength(0);
  });
});

describe("useLearnedList", () => {
  it("loads the first page, then appends the next one with the cursor", async () => {
    const pages = [{ items: LEARNED_ITEMS.slice(0, 2), next_cursor: "c1" }, { items: LEARNED_ITEMS.slice(2), next_cursor: null }];
    const mock = createFetchMock({ "POST /api/wordbook/learned/query": () => json(pages.shift()) });
    const { result } = renderHook(() => useLearnedList({}), { wrapper: wrapper(mock) });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.items).toHaveLength(2);
    expect(result.current.hasMore).toBe(true);
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.items.map((i) => i.key)).toEqual(["accept", "carry", "talk"]);
    expect(result.current.hasMore).toBe(false);
    expect(bodies(mock)[1].cursor).toBe("c1");
  });

  it("starts over when the query changes and ignores the stale response", async () => {
    let release: (() => void) | undefined;
    const mock = createFetchMock({
      "POST /api/wordbook/learned/query": async (call) => {
        const body = JSON.parse(String(call.body)) as { q?: string };
        if (!body.q) await new Promise<void>((resolve) => { release = resolve; });
        return json({ items: body.q ? [LEARNED_ITEMS[0]] : LEARNED_ITEMS, next_cursor: null });
      },
    });
    const { result, rerender } = renderHook(({ q }: { q?: string }) => useLearnedList(q ? { q } : {}), {
      wrapper: wrapper(mock), initialProps: {} as { q?: string },
    });
    rerender({ q: "ac" });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    release?.();
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.items.map((i) => i.key)).toEqual(["accept"]);
  });
});
```

(若 `createFetchMock` 的处理函数不支持返回 Promise,把第二个测试里的「挂起」改成可控的 `Promise` 包装,或直接删掉这个并发用例,保留前两个;其余断言不变。)

- [ ] **Step 2: 跑测试确认失败** — `yarn vitest run src/features/wordbook/box-bar.test.tsx src/features/wordbook/use-learned.test.tsx`。
- [ ] **Step 3: 实现** — `box-bar.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { fmt } from "./ui";
import type { Tier } from "./wordbook-api";

// 一色一义:新学 = 琥珀,巩固中 = 青浅底,熟练 = 青(与首页书卡「已掌握 / 已学」同色系)
const SEGMENTS: { tier: Tier; swatch: string }[] = [
  { tier: "learning", swatch: "bg-amber" },
  { tier: "growing", swatch: "bg-teal-tint shadow-[inset_0_0_0_0.5px_rgb(var(--teal)/0.35)]" },
  { tier: "mastered", swatch: "bg-teal" },
];

/**
 * 熟练度分布条(规格 §1.2):上面是比例条(装饰),下面三个 ≥ 44px 的分段按钮;点分段即筛选,再点取消。
 * 盒子 0–1 / 2–3 / 4–5(R-L1)。
 */
export function BoxBar({ by, value, onChange }: { by: Record<Tier, number>; value: Tier | null; onChange: (tier: Tier | null) => void }) {
  const { t } = useTranslation();
  const total = by.learning + by.growing + by.mastered;
  return (
    <div data-testid="box-bar">
      <div aria-hidden className="flex h-2.5 gap-px overflow-hidden rounded-[5px] bg-surface-2">
        {SEGMENTS.map(({ tier, swatch }) => (
          <i key={tier} className={cn("block h-full", swatch)} style={{ flex: total > 0 ? by[tier] : 0 }} />
        ))}
      </div>
      <div role="group" aria-label={t("web.wordbook.learned.box.label")} className="mt-2.5 grid grid-cols-3 gap-2">
        {SEGMENTS.map(({ tier, swatch }) => {
          const active = value === tier;
          const label = t(`web.wordbook.learned.box.${tier}`);
          return (
            <button key={tier} type="button" aria-pressed={active} aria-label={t("web.wordbook.learned.box.segment", { label, n: by[tier] })}
              onClick={() => onChange(active ? null : tier)}
              className={cn(
                "min-h-tap rounded-button border-[0.5px] px-2.5 py-1.5 text-left transition-colors duration-fast",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "border-blue bg-blue-tint" : "border-hair bg-surface active:bg-surface-2",
              )}>
              <span className="flex items-center text-meta text-ink-2">
                <i aria-hidden className={cn("mr-1 inline-block h-2 w-2 flex-none rounded-[2px]", swatch)} />
                <span className="truncate">{label}</span>
              </span>
              <b aria-hidden className="num block text-headline font-semibold text-ink">{fmt(by[tier])}</b>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

`use-learned.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "~/auth/auth-context";
import { fetchLearned, fetchLearnedSummary, type LearnedItem, type LearnedQuery, type LearnedSummary } from "./wordbook-api";

/** `GET /api/wordbook/learned/summary`。`enabled` 为假时不请求;失败时 error 为原始错误、summary 保持 null。 */
export function useLearnedSummary(enabled: boolean) {
  const { api } = useAuth();
  const [summary, setSummary] = useState<LearnedSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setError(null);
    fetchLearnedSummary(api, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setSummary(value); },
      (err: unknown) => { if (!controller.signal.aborted) setError(err); },
    );
    return () => controller.abort();
  }, [api, enabled, attempt]);
  return { summary, error, reload: useCallback(() => setAttempt((n) => n + 1), []) };
}

/** 输入框防抖:前缀搜索只在停手 `ms` 之后才发请求。 */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

type Status = "loading" | "idle" | "more" | "error";

/**
 * 已学词分页列表(`POST /api/wordbook/learned/query`,游标)。筛选条件变化 → 从头加载,旧请求的结果丢弃;
 * `loadMore` 带上一页的 cursor 追加。每页 50 条(服务端默认)。
 */
export function useLearnedList(query: Omit<LearnedQuery, "cursor" | "limit">) {
  const { api } = useAuth();
  const [items, setItems] = useState<LearnedItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const run = useRef(0);
  const key = JSON.stringify(query);
  useEffect(() => {
    const id = ++run.current;
    const controller = new AbortController();
    setStatus("loading");
    setError(null);
    fetchLearned(api, JSON.parse(key) as LearnedQuery, controller.signal).then(
      (page) => {
        if (run.current !== id) return;
        setItems(page.items);
        setNext(page.nextCursor);
        setStatus("idle");
      },
      (err: unknown) => {
        if (run.current !== id || controller.signal.aborted) return;
        setError(err);
        setStatus("error");
      },
    );
    return () => controller.abort();
  }, [api, key, attempt]);
  const loadMore = useCallback(async () => {
    if (!next || status !== "idle") return;
    const id = run.current;
    setStatus("more");
    try {
      const page = await fetchLearned(api, { ...(JSON.parse(key) as LearnedQuery), cursor: next });
      if (run.current !== id) return;
      setItems((prev) => [...prev, ...page.items]);
      setNext(page.nextCursor);
      setStatus("idle");
    } catch (err) {
      if (run.current !== id) return;
      setError(err);
      setStatus("error");
    }
  }, [api, key, next, status]);
  return { items, status, error, hasMore: next !== null, loadMore, reload: useCallback(() => setAttempt((n) => n + 1), []) };
}
```

- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 + `yarn web:typecheck`。
- [ ] **Step 5: 提交** — `feat(web): learned-word box bar and list hooks`。

### Task W3: 已学词页(列表、筛选、词卡抽屉)与路由

**Files:**
- Create: `web/src/features/wordbook/learned-page.tsx`、`learned-page.test.tsx`、`learned-lazy.test.ts`
- Modify: `lazy-pages.tsx`、`index.ts`、`web/src/app.tsx`

**Interfaces:**
- Consumes:W1、W2、既有 `PageHeader`、`SurfaceCard`、`ToneBadge`、`BottomSheet*`、`WordCardView`、`useSpeaker`、`PageError / PageLoading / PageNote`、`useWordbookConfig`。
- Produces:`WordbookLearnedPage`(`/wordbook/learned`,懒加载);页面里的「自由复习」按钮在 W4 接上(本任务先渲染按钮并打开 W4 的面板组件占位:`FreeReviewSheet` 由 W4 创建,所以本任务的按钮先 `disabled` 不渲染面板,W4 接线——见 W4 Step 4)。

页面结构(自上而下):`PageHeader`(标题「已学词」,返回 `/wordbook`)→ `BoxBar` → 搜索框(`type="search"`、`maxLength=30`、关闭自动大写 / 纠错 / 拼写检查)→ 筛选行(词书 `<select>`、易错开关、两个 `<input type="date">`、「清除筛选」)→ 列表(每行一个整行按钮:词头、熟练度徽标、易错徽标、学习日期、到期说明)→ 「加载更多」→ 空状态 → 底部 `DOCK` 的「自由复习」主按钮 → 点行打开词卡抽屉。

- [ ] **Step 1: 写失败测试** — `learned-page.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { LEARNED_ITEMS, LEARNED_PAGE, LEARNED_SUMMARY } from "./learned-test-fixtures";
import { WordbookLearnedPage } from "./learned-page";
import { CONFIG, card } from "./test-fixtures";

vi.mock("~/features/chat/use-tts-player", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/features/chat/use-tts-player")>()),
  useTtsPlayer: () => ({ states: {}, play: vi.fn(), playQueue: vi.fn(), stop: vi.fn(), prime: vi.fn() }),
}));

const TTS = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: [] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: {} }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: [], voices: {} } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "", voice: "alloy" } } }),
};

function setup(routes: Parameters<typeof createFetchMock>[0] = {}) {
  const mock = createFetchMock({
    ...TTS,
    "GET /api/wordbook/config": () => json(CONFIG),
    "GET /api/wordbook/learned/summary": () => json(LEARNED_SUMMARY),
    "POST /api/wordbook/learned/query": () => json(LEARNED_PAGE),
    "POST /api/wordbook/learned/card": () => json(card("accept")),
    ...routes,
  });
  renderWithProviders(<WordbookLearnedPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/learned" });
  return mock;
}
const queries = (mock: ReturnType<typeof createFetchMock>) =>
  mock.calls.filter((c) => c.url.pathname === "/api/wordbook/learned/query").map((c) => JSON.parse(String(c.body)) as Record<string, unknown>);

beforeEach(() => { resetServerAiConfigCache(); localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("WordbookLearnedPage", () => {
  it("shows the distribution bar and the newest words first", async () => {
    setup();
    const list = await screen.findByRole("list", { name: "已学词" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getAllByRole("button")[0]).toHaveTextContent("accept");
    expect(screen.getByRole("button", { name: "新学 3 词" })).toBeTruthy();
    expect(within(list).getAllByText("易错")).toHaveLength(1);   // 只有 accept 易错
    expect(within(list).getAllByText("已到期")).toHaveLength(1);  // carry 的到期日在过去
  });

  it("filters by tier when a segment is pressed and sends it in the body", async () => {
    const mock = setup();
    await screen.findByRole("list", { name: "已学词" });
    await userEvent.click(screen.getByRole("button", { name: "熟练 1 词" }));
    await waitFor(() => expect(queries(mock).at(-1)).toMatchObject({ tier: "mastered" }));
  });

  it("searches by prefix after the user stops typing, with no prefix in any URL", async () => {
    const mock = setup();
    await screen.findByRole("list", { name: "已学词" });
    await userEvent.type(screen.getByRole("searchbox", { name: "按英文前缀搜索" }), "ac");
    await waitFor(() => expect(queries(mock).at(-1)).toMatchObject({ q: "ac" }), { timeout: 2000 });
    expect(queries(mock).filter((b) => b.q === "a")).toHaveLength(0);   // 防抖:没有为中间状态发请求
    expect(mock.calls.every((c) => c.url.search === "" || c.url.pathname.endsWith("/summary"))).toBe(true);
  });

  it("filters weak words and clears every filter", async () => {
    const mock = setup();
    await screen.findByRole("list", { name: "已学词" });
    await userEvent.click(screen.getByRole("button", { name: "易错" }));
    await waitFor(() => expect(queries(mock).at(-1)).toMatchObject({ weak: true }));
    await userEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    await waitFor(() => expect(queries(mock).at(-1)).not.toHaveProperty("weak"));
  });

  it("loads more with the cursor", async () => {
    const pages = [{ items: LEARNED_ITEMS.slice(0, 2), next_cursor: "c1" }, { items: LEARNED_ITEMS.slice(2), next_cursor: null }];
    const mock = setup({ "POST /api/wordbook/learned/query": () => json(pages.shift()) });
    await screen.findByRole("list", { name: "已学词" });
    await userEvent.click(await screen.findByRole("button", { name: "加载更多" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(queries(mock)[1]).toMatchObject({ cursor: "c1" });
    expect(screen.queryByRole("button", { name: "加载更多" })).toBeNull();
  });

  it("opens the word card in a sheet through the POST lookup", async () => {
    const mock = setup();
    await userEvent.click((await screen.findAllByRole("button", { name: /accept/ }))[0]);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/wordbook/learned/card")).toBe(true));
    expect(JSON.parse(String(mock.calls.find((c) => c.url.pathname.endsWith("/learned/card"))?.body))).toEqual({ book_id: "cet4", key: "accept" });
    expect(await screen.findByText("accept 的释义")).toBeTruthy();
  });

  it("explains an empty library and links to learning", async () => {
    setup({
      "GET /api/wordbook/learned/summary": () => json({ ...LEARNED_SUMMARY, total: 0, by_tier: { learning: 0, growing: 0, mastered: 0 }, by_book: [] }),
      "POST /api/wordbook/learned/query": () => json({ items: [], next_cursor: null }),
    });
    expect(await screen.findByText("还没有已学的词")).toBeTruthy();
    expect(screen.getByRole("link", { name: "去学新词" })).toHaveAttribute("href", "/wordbook/learn");
  });

  it("tells the difference between an empty filter result and an empty library", async () => {
    setup({ "POST /api/wordbook/learned/query": () => json({ items: [], next_cursor: null }) });
    await userEvent.click(await screen.findByRole("button", { name: "易错" }));
    expect(await screen.findByText("没有符合条件的词")).toBeTruthy();
  });

  it("shows a translated error with a retry", async () => {
    setup({ "POST /api/wordbook/learned/query": () => json({ error: "Invalid cursor" }, { status: 422 }) });
    expect(await screen.findByText("列表已过期,请刷新")).toBeTruthy();
  });
});
```

`learned-lazy.test.ts`(钉住「不进主包」):

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(path.join(here, file), "utf8");

describe("the learned-words page stays out of the main bundle", () => {
  it("is reached only through lazy-pages.tsx", () => {
    expect(read("lazy-pages.tsx")).toMatch(/import\("\.\/learned-page"\)/);
    for (const file of ["index.ts", "lazy-pages.tsx", "home-page.tsx"]) {
      expect(read(file)).not.toMatch(/from "\.\/learned-page"|from "\.\/free-review-sheet"|from "\.\/free-browse"/);
    }
  });
});
```

(`json(body, { status })` 的签名以 `~/test/fetch-mock` 为准;若 `json` 只接 body,用该文件里既有的错误响应写法,参考 `home-page.test.tsx` 里的错误用例。)

- [ ] **Step 2: 跑测试确认失败** — `yarn vitest run src/features/wordbook/learned-page.test.tsx src/features/wordbook/learned-lazy.test.ts`。
- [ ] **Step 3: 实现页面** — `learned-page.tsx`:

```tsx
import { PlayIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { SurfaceCard } from "~/components/surface-card";
import { ToneBadge } from "~/components/tone-badge";
import { PageHeader } from "~/layout/page-header";
import { BoxBar } from "./box-bar";
import { PageError, PageLoading, PageNote } from "./page-status";
import { DOCK, GHOST, PRIMARY, bookTitle } from "./ui";
import { useDebounced, useLearnedList, useLearnedSummary } from "./use-learned";
import { useReturnFocus } from "./use-return-focus";
import { useSpeaker } from "./use-speaker";
import { useWordbookConfig } from "./use-wordbook-config";
import { WordCardView } from "./word-card";
import { WORDBOOK_SERVER_ERRORS, fetchLearnedCard, type BookId, type Card, type LearnedItem, type Tier } from "./wordbook-api";

const FIELD = "h-11 w-full rounded-button border-[0.5px] border-hair bg-surface px-3 text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const TIER_TONE: Record<Tier, "amber" | "teal" | "gray"> = { learning: "amber", growing: "gray", mastered: "teal" };

/** 点一行打开的词卡:`POST /learned/card`(词在体里,不在 URL),内容复用现有 WordCardView。 */
function CardSheet({ item, onClose }: { item: LearnedItem | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const speaker = useSpeaker();
  const back = useReturnFocus();
  const [card, setCard] = useState<Card | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!item) return;
    const controller = new AbortController();
    setCard(null);
    setFailed(false);
    fetchLearnedCard(api, item.bookId, item.key, controller.signal).then(
      (c) => { if (!controller.signal.aborted) setCard(c); },
      () => { if (!controller.signal.aborted) setFailed(true); },
    );
    return () => controller.abort();
  }, [api, item]);
  const config = useWordbookConfig();
  const showExample = (config?.enabled ? config.learn.showExample : true) ?? true;
  return (
    <BottomSheet open={item !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <BottomSheetContent className="max-h-[88vh] overflow-y-auto" {...back}>
        <BottomSheetHeader title={item?.word ?? ""} description={t("web.wordbook.learned.title")} srOnlyDescription />
        {card ? (
          <WordCardView card={card} showExample={showExample} onListen={speaker.listen} listening={speaker.active} canListen={speaker.available} />
        ) : failed ? <PageNote>{t("web.wordbook.learned.card.unavailable")}</PageNote> : <PageLoading />}
      </BottomSheetContent>
    </BottomSheet>
  );
}

function Row({ item, language, onOpen }: { item: LearnedItem; language: string; onOpen: () => void }) {
  const { t } = useTranslation();
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(language, { month: "short", day: "numeric" });
  const due = new Date(item.dueAt).getTime() <= Date.now();
  return (
    <li>
      <button type="button" onClick={onOpen}
        className="flex min-h-[56px] w-full items-center gap-3 px-3.5 py-2 text-left transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span className="min-w-0 flex-1">
          <span lang="en" className="block truncate text-body font-medium">{item.word}</span>
          <span className="mt-0.5 block truncate text-meta text-ink-2">
            {t("web.wordbook.learned.list.learnedOn", { date: fmtDate(item.learnedAt) })} · {due ? t("web.wordbook.learned.list.dueNow") : t("web.wordbook.learned.list.dueOn", { date: fmtDate(item.dueAt) })}
          </span>
        </span>
        {item.weak ? <ToneBadge tone="amber">{t("web.wordbook.learned.list.weak")}</ToneBadge> : null}
        <ToneBadge tone={TIER_TONE[item.tier]}>{t(`web.wordbook.learned.box.${item.tier}`)}</ToneBadge>
      </button>
    </li>
  );
}

/**
 * 已学词(规格 §1.2):熟练度分布条(点分段筛选)、词书 / 易错 / 学习日期 / 英文前缀搜索、游标分页、点一行打开词卡;
 * 底部「自由复习」(W4 的面板)。词与前缀只在 POST 体里发出(R-L4)。
 */
export function WordbookLearnedPage() {
  const { t, i18n } = useTranslation();
  const config = useWordbookConfig();
  const enabled = config?.enabled !== false;
  const { summary, error: summaryError, reload: reloadSummary } = useLearnedSummary(enabled);
  const [tier, setTier] = useState<Tier | null>(null);
  const [book, setBook] = useState<BookId | "">("");
  const [weak, setWeak] = useState(false);
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 250);
  const query = useMemo(() => ({
    ...(book ? { book } : {}), ...(tier ? { tier } : {}), ...(weak ? { weak: true } : {}),
    ...(since ? { since } : {}), ...(until ? { until } : {}), ...(q ? { q } : {}),
  }), [book, tier, weak, since, until, q]);
  const list = useLearnedList(query);
  const [opened, setOpened] = useState<LearnedItem | null>(null);
  const filtered = Object.keys(query).length > 0 || text.trim() !== "";
  const clear = () => { setTier(null); setBook(""); setWeak(false); setSince(""); setUntil(""); setText(""); };
  const books = config?.enabled ? config.books.filter((b) => summary?.byBook.some((x) => x.bookId === b.id)) : [];
  const header = <PageHeader title={t("web.wordbook.learned.title")} back="/wordbook" />;

  if (config?.enabled === false) return <div>{header}<PageNote>{t("web.wordbook.errors.disabled")}</PageNote></div>;
  if (summaryError) return <div>{header}<PageError message={translateServerError(t, summaryError, WORDBOOK_SERVER_ERRORS)} onRetry={reloadSummary} /></div>;
  if (!summary) return <div>{header}<PageLoading /></div>;
  const library = summary.total > 0;
  return (
    <div className="flex flex-1 flex-col">
      {header}
      <div className="px-gutter pb-4">
        {library ? (
          <>
            <div className="mt-2"><BoxBar by={summary.byTier} value={tier} onChange={setTier} /></div>
            <label className="relative mt-3 block">
              <span className="sr-only">{t("web.wordbook.learned.search.label")}</span>
              <SearchIcon aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-2" />
              <input type="search" role="searchbox" value={text} onChange={(e) => setText(e.target.value)} maxLength={30}
                inputMode="search" autoCapitalize="none" autoCorrect="off" spellCheck={false} lang="en"
                aria-label={t("web.wordbook.learned.search.label")} placeholder={t("web.wordbook.learned.search.placeholder")}
                className={cn(FIELD, "pl-9")} />
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <select aria-label={t("web.wordbook.learned.filters.book")} value={book} onChange={(e) => setBook(e.target.value as BookId | "")} className={FIELD}>
                <option value="">{t("web.wordbook.learned.filters.allBooks")}</option>
                {books.map((b) => <option key={b.id} value={b.id}>{bookTitle(b, i18n.language)}</option>)}
              </select>
              <button type="button" aria-pressed={weak} onClick={() => setWeak((w) => !w)}
                className={cn(GHOST, "h-11", weak && "border-blue bg-blue-tint")}>
                {t("web.wordbook.learned.filters.weak")}
              </button>
              <label className="text-meta text-ink-2">{t("web.wordbook.learned.filters.since")}
                <input type="date" value={since} max={until || undefined} onChange={(e) => setSince(e.target.value)} className={cn(FIELD, "mt-1")} />
              </label>
              <label className="text-meta text-ink-2">{t("web.wordbook.learned.filters.until")}
                <input type="date" value={until} min={since || undefined} onChange={(e) => setUntil(e.target.value)} className={cn(FIELD, "mt-1")} />
              </label>
            </div>
            {filtered ? <button type="button" onClick={clear} className="mt-2 min-h-tap rounded-button px-1 text-sub font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("web.wordbook.learned.filters.clear")}</button> : null}
          </>
        ) : null}
        {list.status === "error" ? (
          <PageError message={translateServerError(t, list.error, WORDBOOK_SERVER_ERRORS)} onRetry={list.reload} />
        ) : list.status === "loading" ? <PageLoading /> : list.items.length > 0 ? (
          <>
            <SurfaceCard className="mt-3 overflow-hidden p-0">
              <ul aria-label={t("web.wordbook.learned.list.label")} className="divide-y-[0.5px] divide-hair-2">
                {list.items.map((item) => <Row key={`${item.bookId}:${item.key}`} item={item} language={i18n.language} onOpen={() => setOpened(item)} />)}
              </ul>
            </SurfaceCard>
            {list.hasMore ? (
              <button type="button" disabled={list.status !== "idle"} onClick={() => void list.loadMore()} className={cn(GHOST, "mt-3 h-11 w-full")}>
                {t("web.wordbook.learned.list.more")}
              </button>
            ) : <p className="mt-3 text-center text-meta text-ink-2">{t("web.wordbook.learned.list.end")}</p>}
          </>
        ) : library ? (
          <div className="mt-6 text-center">
            <PageNote>{t("web.wordbook.learned.empty.filtered")}</PageNote>
            <button type="button" onClick={clear} className={cn(GHOST, "mt-3 h-11")}>{t("web.wordbook.learned.empty.clear")}</button>
          </div>
        ) : (
          <div className="mt-6 text-center">
            <p className="text-title font-semibold">{t("web.wordbook.learned.empty.title")}</p>
            <p className="mt-1 text-sub text-ink-2">{t("web.wordbook.learned.empty.body")}</p>
            <Link to="/wordbook/learn" className={cn(PRIMARY, "mt-4 h-11 w-full")}>{t("web.wordbook.learned.empty.cta")}</Link>
          </div>
        )}
      </div>
      {library ? (
        <div className={DOCK}>
          {/* W4 把这个按钮接到 FreeReviewSheet;在那之前它不渲染(没有可开的面板) */}
          <button type="button" className={cn(PRIMARY, "h-12 flex-1")} disabled><PlayIcon aria-hidden />{t("web.wordbook.learned.free.open")}</button>
        </div>
      ) : null}
      <CardSheet item={opened} onClose={() => setOpened(null)} />
    </div>
  );
}
```

> 说明:`ToneBadge` 的 `tone` 取值以 `~/components/tone-badge` 实际支持为准(首页用过 `teal`、`blue`、`gray`;`amber` 在 `goals` 里用过 `ToneBadge`/`StatTile`)——若没有 `amber` 就用 `gray` 并靠文字区分。`WordCardView` 的 `eyebrow`、`badge` 是可选的(`recall-card.tsx` 传了,`word-card.tsx` 其余调用点可以不传),若类型要求必传,传 `eyebrow={t("web.wordbook.learned.title")}`。

- [ ] **Step 4: 路由与懒加载** — `lazy-pages.tsx` 末尾追加 `export const WordbookLearnedPage = lazyPage(() => import("./learned-page"), "WordbookLearnedPage");`;`index.ts` 的最后一行 `export { … } from "./lazy-pages";` 加入 `WordbookLearnedPage`;`web/src/app.tsx` 的 import 列表加 `WordbookLearnedPage`,并在 `/wordbook/spell` 那一行之后加 `<Route path="/wordbook/learned" element={<WordbookLearnedPage />} />`。
- [ ] **Step 5: 跑测试确认通过** — `yarn vitest run src/features/wordbook/learned-page.test.tsx src/features/wordbook/learned-lazy.test.ts src/architecture.test.ts && yarn web:typecheck`。
- [ ] **Step 6: 提交** — `feat(web): learned words page with filters, search and word card sheet`。

### Task W4: 自由复习面板(范围 × 方式 × 数量)

**Files:**
- Create: `web/src/features/wordbook/free-batch.ts`、`free-batch.test.ts`、`free-review-sheet.tsx`、`free-review-sheet.test.tsx`
- Modify: `learned-page.tsx`(把底部按钮接到面板)

**Interfaces:**
- Produces:`FREE_PATH = "/wordbook/review?source=free"`、`toBatch(set: FreeSet): FreeBatch`、`readFreeState(state: unknown): FreeSet | null`、`uniqueKeys(questions)`;`<FreeReviewSheet open onOpenChange summary />`:选择范围(6 个,池为空的置灰:昨天 / 最近 7 天 / 易错看 `summary.yesterday / last7 / weak`,书看 `byBook`,熟练度看 `byTier`)、方式(4 个)、数量(10 / 20 / 50),「开始」调用 `startFree`,成功后 `navigate(FREE_PATH, { state: { free: set } })`。

- [ ] **Step 1: 写失败测试** — `free-batch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import camelcaseKeys from "camelcase-keys";
import { FREE_SET, FREE_SET_BROWSE } from "./learned-test-fixtures";
import { readFreeState, toBatch, uniqueKeys } from "./free-batch";
import type { FreeSet } from "./wordbook-api";

const set = (raw: unknown) => camelcaseKeys(raw as Record<string, unknown>, { deep: true }) as unknown as FreeSet;

describe("free batches", () => {
  it("turns a free set into the review page batch", () => {
    const batch = toBatch(set(FREE_SET));
    expect(batch.bookId).toBe("cet4");
    expect(batch.questions.map((q) => q.key)).toEqual(["accept", "talk"]);
    expect(Object.keys(batch.cards)).toEqual(["accept", "talk"]);
    expect(batch.bookOf).toEqual({ accept: "cet4", talk: "cet4" });
  });

  it("has no questions for browse sets", () => {
    expect(toBatch(set(FREE_SET_BROWSE)).questions).toEqual([]);
  });

  it("reads a set from router state and rejects anything else", () => {
    expect(readFreeState({ free: set(FREE_SET) })?.setId).toBe("abcdef012345");
    for (const bad of [null, undefined, {}, { free: { items: [] } }, { free: "x" }]) expect(readFreeState(bad)).toBeNull();
  });

  it("keeps question keys unique and in order", () => {
    expect(uniqueKeys([{ key: "a" }, { key: "b" }, { key: "a" }] as never)).toEqual(["a", "b"]);
  });
});
```

`free-review-sheet.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import camelcaseKeys from "camelcase-keys";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { FreeReviewSheet } from "./free-review-sheet";
import { FREE_SET, LEARNED_SUMMARY } from "./learned-test-fixtures";
import type { LearnedSummary } from "./wordbook-api";

const SUMMARY = camelcaseKeys(LEARNED_SUMMARY, { deep: true }) as unknown as LearnedSummary;

function setup(summary: LearnedSummary = SUMMARY, routes: Parameters<typeof createFetchMock>[0] = {}) {
  const mock = createFetchMock({ "POST /api/wordbook/free/start": () => json(FREE_SET), ...routes });
  renderWithProviders(<FreeReviewSheet open onOpenChange={() => {}} summary={summary} />, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/learned",
  });
  return mock;
}
const body = (mock: ReturnType<typeof createFetchMock>) => JSON.parse(String(mock.calls.find((c) => c.url.pathname.endsWith("/free/start"))?.body));

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("FreeReviewSheet", () => {
  it("starts a random mix of 20 choice questions by default settings the user picks", async () => {
    const mock = setup();
    await userEvent.click(screen.getByRole("radio", { name: "选择题" }));
    await userEvent.click(screen.getByRole("radio", { name: "20 个" }));
    await userEvent.click(screen.getByRole("button", { name: "开始" }));
    await waitFor(() => expect(body(mock)).toMatchObject({ scope: "all", mode: "choice", count: 20 }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/wordbook/review"));
    expect(JSON.parse(screen.getByTestId("location").getAttribute("data-state") ?? "null").free.setId).toBe("abcdef012345");
  });

  it("sends the book or the tier only for those scopes", async () => {
    const mock = setup();
    await userEvent.click(screen.getByRole("button", { name: "某一本书" }));
    await userEvent.click(screen.getByRole("button", { name: "开始" }));
    await waitFor(() => expect(body(mock)).toMatchObject({ scope: "book", book: "cet4" }));
  });

  it("disables scopes that have no words", () => {
    setup({ ...SUMMARY, yesterday: 0, last7: 0, weak: 0, byTier: { learning: 0, growing: 0, mastered: 6 } });
    expect(screen.getByRole("button", { name: "昨天学的" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "最近 7 天" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "易错词" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "随机抽取" })).not.toBeDisabled();
  });

  it("states the rules in one line and surfaces a translated error", async () => {
    setup(SUMMARY, { "POST /api/wordbook/free/start": () => json({ error: "No words to review" }, { status: 409 }) });
    expect(screen.getByText(/不计段位点/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "开始" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("这个范围里还没有可复习的词");
  });
});
```

(`SegmentedControl` 的选项按 `role="radio"` 渲染——若实际是 `button`,把 `getByRole("radio", …)` 改成对应角色;读 `segmented-control.tsx` 的渲染部分确认。)

- [ ] **Step 2: 跑测试确认失败** — `yarn vitest run src/features/wordbook/free-batch.test.ts src/features/wordbook/free-review-sheet.test.tsx`。
- [ ] **Step 3: 实现** — `free-batch.ts`:

```ts
import type { BookId, Card, FreeSet, Question } from "./wordbook-api";

/** 自由复习复用复习页:`?source=free`,批次经路由 state 传入(答案与词卡不进 URL;R-L14)。 */
export const FREE_PATH = "/wordbook/review?source=free";

export interface FreeBatch { bookId: BookId; questions: Question[]; cards: Record<string, Card>; bookOf: Record<string, BookId> }

export const uniqueKeys = (questions: Question[]) => questions.map((q) => q.key).filter((k, i, all) => all.indexOf(k) === i);

/** 按条目建「词 → 卡」「词 → 书」映射(客户端本地建,不依赖服务端的映射;全部随机会跨书)。 */
export function toBatch(set: FreeSet): FreeBatch {
  return {
    bookId: set.items[0].bookId,
    questions: set.items.flatMap((i) => (i.question ? [i.question] : [])),
    cards: Object.fromEntries(set.items.map((i) => [i.card.key, i.card])),
    bookOf: Object.fromEntries(set.items.map((i) => [i.card.key, i.bookId])),
  };
}

export function readFreeState(state: unknown): FreeSet | null {
  const free = (state as { free?: FreeSet } | null | undefined)?.free;
  return free && typeof free === "object" && Array.isArray(free.items) && free.items.length > 0 ? free : null;
}
```

`free-review-sheet.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { SegmentedControl } from "~/components/segmented-control";
import { FREE_PATH } from "./free-batch";
import { PRIMARY, bookTitle } from "./ui";
import { useReturnFocus } from "./use-return-focus";
import { useWordbookConfig } from "./use-wordbook-config";
import {
  WORDBOOK_SERVER_ERRORS, startFree, type BookId, type FreeCount, type FreeMode, type FreeScope, type LearnedSummary, type Tier,
} from "./wordbook-api";

const SCOPES: FreeScope[] = ["yesterday", "last7", "book", "tier", "weak", "all"];
const MODES: FreeMode[] = ["browse", "recall", "choice", "spell"];
const COUNTS: FreeCount[] = [10, 20, 50];
const TIERS: Tier[] = ["learning", "growing", "mastered"];

/** 这个范围里有没有词(没有就置灰):昨天 / 7 天 / 易错看汇总,书 / 熟练度看分布。 */
export function scopeCount(summary: LearnedSummary, scope: FreeScope): number {
  switch (scope) {
    case "yesterday": return summary.yesterday;
    case "last7": return summary.last7;
    case "weak": return summary.weak;
    case "book": return summary.byBook.length;
    case "tier": return TIERS.filter((t) => summary.byTier[t] > 0).length;
    default: return summary.total;
  }
}

/**
 * 自由复习面板(规格 §1.2):范围 × 方式 × 数量。点「开始」由服务端抽词出题(客户端不能指定词),
 * 成功后进入复习页的 `?source=free`。不计段位点、不占每日复习上限(面板里一句话说明)。
 */
export function FreeReviewSheet({ open, onOpenChange, summary }: { open: boolean; onOpenChange: (open: boolean) => void; summary: LearnedSummary }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const config = useWordbookConfig();
  const back = useReturnFocus();
  const [scope, setScope] = useState<FreeScope>("all");
  const [mode, setMode] = useState<FreeMode>("choice");
  const [count, setCount] = useState<FreeCount>(10);
  const [book, setBook] = useState<BookId | "">("");
  const [tier, setTier] = useState<Tier | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bookChoices = summary.byBook.map((b) => b.bookId);
  const effectiveBook = (book || bookChoices[0]) as BookId | undefined;
  const effectiveTier = (tier || TIERS.find((x) => summary.byTier[x] > 0)) as Tier | undefined;
  const bookName = (id: BookId) => {
    const found = config?.enabled ? config.books.find((b) => b.id === id) : undefined;
    return found ? bookTitle(found, i18n.language) : id;
  };

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const set = await startFree(api, {
        scope, mode, count, ...(scope === "book" && effectiveBook ? { book: effectiveBook } : {}), ...(scope === "tier" && effectiveTier ? { tier: effectiveTier } : {}),
      });
      navigate(FREE_PATH, { state: { free: set } });
    } catch (err) {
      setError(translateServerError(t, err, WORDBOOK_SERVER_ERRORS));
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent className="max-h-[88vh] overflow-y-auto" {...back}>
        <BottomSheetHeader title={t("web.wordbook.learned.free.title")} description={t("web.wordbook.learned.free.note")} />
        <p className="text-meta font-semibold text-ink-2">{t("web.wordbook.learned.free.scope.label")}</p>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {SCOPES.map((s) => (
            <button key={s} type="button" aria-pressed={scope === s} disabled={scopeCount(summary, s) === 0} onClick={() => setScope(s)}
              className={cn("min-h-tap rounded-button border-[0.5px] px-3 text-body font-medium transition-colors duration-fast",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
                scope === s ? "border-blue bg-blue-tint text-blue" : "border-hair bg-surface text-ink active:bg-surface-2")}>
              {t(`web.wordbook.learned.free.scope.${s}`)}
            </button>
          ))}
        </div>
        {scope === "book" ? (
          <select aria-label={t("web.wordbook.learned.free.pickBook")} value={effectiveBook ?? ""} onChange={(e) => setBook(e.target.value as BookId)}
            className="mt-2 h-11 w-full rounded-button border-[0.5px] border-hair bg-surface px-3 text-body">
            {bookChoices.map((id) => <option key={id} value={id}>{bookName(id)}</option>)}
          </select>
        ) : null}
        {scope === "tier" ? (
          <SegmentedControl className="mt-2" label={t("web.wordbook.learned.free.pickTier")} value={(effectiveTier ?? "learning") as Tier} onChange={setTier}
            options={TIERS.filter((x) => summary.byTier[x] > 0).map((x) => ({ value: x, label: t(`web.wordbook.learned.box.${x}`) }))} />
        ) : null}
        <p className="mt-4 text-meta font-semibold text-ink-2">{t("web.wordbook.learned.free.mode.label")}</p>
        <SegmentedControl className="mt-1.5" label={t("web.wordbook.learned.free.mode.label")} value={mode} onChange={setMode}
          options={MODES.map((m) => ({ value: m, label: t(`web.wordbook.learned.free.mode.${m}`) }))} />
        <p className="mt-4 text-meta font-semibold text-ink-2">{t("web.wordbook.learned.free.count.label")}</p>
        <SegmentedControl className="mt-1.5" label={t("web.wordbook.learned.free.count.label")} value={String(count) as "10" | "20" | "50"}
          onChange={(v) => setCount(Number(v) as FreeCount)}
          options={COUNTS.map((n) => ({ value: String(n) as "10" | "20" | "50", label: t("web.wordbook.learned.free.count.n", { n }) }))} />
        {error ? <p role="alert" className="mt-3 text-sub text-ink">{error}</p> : null}
        <button type="button" disabled={busy} onClick={() => void start()} className={cn(PRIMARY, "mt-4 h-12 w-full")}>
          {busy ? t("web.wordbook.learned.free.starting") : t("web.wordbook.learned.free.start")}
        </button>
      </BottomSheetContent>
    </BottomSheet>
  );
}
```

> 说明:`scope` 为 `"all"` 的「随机抽取」测试里 SegmentedControl 的 `value` 类型要求字符串联合,所以数量用 `"10" | "20" | "50"`。当前选中的范围若因汇总变化变成空池,「开始」会被服务端 409 `No words to review` 挡住并翻译显示,不需要前端再算。

- [ ] **Step 4: 接线** — `learned-page.tsx`:顶部 import `FreeReviewSheet`;加 `const [freeOpen, setFreeOpen] = useState(false);`;底部按钮改成 `onClick={() => setFreeOpen(true)}` 去掉 `disabled`;组件末尾 `<CardSheet … />` 之后加 `{library ? <FreeReviewSheet open={freeOpen} onOpenChange={setFreeOpen} summary={summary} /> : null}`;删掉那行「W4 把这个按钮接到…」的注释。`learned-page.test.tsx` 追加一个用例:点「自由复习」出现 `dialog` 且含「不计段位点」。
- [ ] **Step 5: 跑测试确认通过** — `yarn vitest run src/features/wordbook/free-batch.test.ts src/features/wordbook/free-review-sheet.test.tsx src/features/wordbook/learned-page.test.tsx src/features/wordbook/learned-lazy.test.ts && yarn web:typecheck`(`learned-lazy.test.ts` 钉住:`learned-page` 之外没有静态导入 `free-review-sheet`)。
- [ ] **Step 6: 提交** — `feat(web): free review sheet with scope, mode and count`。

### Task W5: 复习页 `source=free`、翻卡浏览、小结说明

**Files:**
- Create: `web/src/features/wordbook/free-browse.tsx`、`free-browse.test.tsx`、`review-free.test.tsx`
- Modify: `review-page.tsx`、`session-summary.tsx`、`web/src/test/render.tsx`(route 对象可带 `search`)

**Interfaces:**
- Produces:`<FreeBrowse set={FreeSet} />`(翻卡浏览:正面词头 + 音标,「翻面」→ 完整词卡,「上一个 / 下一个」,不发任何请求);`WordbookReviewPage` 读 `?source=free` 与路由 state;`SessionSummary` 新增可选 `note?: string`、`homeLabel?: string`。

- [ ] **Step 1: 测试夹具** — `web/src/test/render.tsx` 的 `RenderOptions.route` 类型改为 `string | { pathname: string; search?: string; state?: unknown }`(`initialEntries={[route]}` 已经原样传对象,不需要别的改动)。
- [ ] **Step 2: 写失败测试** — `free-browse.test.tsx`:

```tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import camelcaseKeys from "camelcase-keys";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { FreeBrowse } from "./free-browse";
import { FREE_SET_BROWSE } from "./learned-test-fixtures";
import { CONFIG } from "./test-fixtures";
import type { FreeSet } from "./wordbook-api";

vi.mock("~/features/chat/use-tts-player", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/features/chat/use-tts-player")>()),
  useTtsPlayer: () => ({ states: {}, play: vi.fn(), playQueue: vi.fn(), stop: vi.fn(), prime: vi.fn() }),
}));

const SET = camelcaseKeys(FREE_SET_BROWSE, { deep: true }) as unknown as FreeSet;

function setup() {
  const mock = createFetchMock({
    "GET /api/config/gpt_providers": () => json({ enjoyai: { models: [] } }),
    "GET /api/config/default_gpt_preset": () => json({ configuration: {} }),
    "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: [], voices: {} } }),
    "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "", voice: "alloy" } } }),
    "GET /api/wordbook/config": () => json(CONFIG),
  });
  renderWithProviders(<FreeBrowse set={SET} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/wordbook/review" });
  return mock;
}

beforeEach(() => { resetServerAiConfigCache(); localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("FreeBrowse", () => {
  it("shows the word first, flips to the full card, and walks through the set", async () => {
    setup();
    expect(await screen.findByTestId("recall-card")).toBeTruthy();
    expect(screen.queryByText("accept 的释义")).toBeNull();          // 翻面前没有释义
    await userEvent.click(screen.getByRole("button", { name: "翻面" }));
    expect(await screen.findByText("accept 的释义")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "下一个" }));
    expect(await screen.findByTestId("question-word")).toHaveTextContent("talk");
    expect(screen.getByRole("button", { name: "上一个" })).not.toBeDisabled();
  });

  it("finishes after the last card and never calls the server for answers", async () => {
    const mock = setup();
    await userEvent.click(await screen.findByRole("button", { name: "翻面" }));
    await userEvent.click(screen.getByRole("button", { name: "下一个" }));
    await userEvent.click(screen.getByRole("button", { name: "翻面" }));
    await userEvent.click(screen.getByRole("button", { name: "看完了" }));
    expect(await screen.findByText("这一组看完了")).toBeTruthy();
    expect(mock.calls.some((c) => c.url.pathname.includes("/answers"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "再看一遍" }));
    expect(await screen.findByTestId("question-word")).toHaveTextContent("accept");
  });
});
```

`review-free.test.tsx`(`?source=free` 的复习页行为):

```tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import camelcaseKeys from "camelcase-keys";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { resetServerAiConfigCache } from "~/api/server-config";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { FREE_SET } from "./learned-test-fixtures";
import { WordbookReviewPage } from "./review-page";
import { CONFIG } from "./test-fixtures";

vi.mock("~/features/chat/use-tts-player", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/features/chat/use-tts-player")>()),
  useTtsPlayer: () => ({ states: {}, play: vi.fn(), playQueue: vi.fn(), stop: vi.fn(), prime: vi.fn() }),
}));

const TTS = {
  "GET /api/config/gpt_providers": () => json({ enjoyai: { models: [] } }),
  "GET /api/config/default_gpt_preset": () => json({ configuration: {} }),
  "GET /api/config/tts_providers_v2": () => json({ enjoyai: { models: [], voices: {} } }),
  "GET /api/config/default_tts_preset": () => json({ configuration: { tts: { model: "", voice: "alloy" } } }),
};

function setup(state: unknown, routes: Parameters<typeof createFetchMock>[0] = {}) {
  const mock = createFetchMock({
    ...TTS,
    "GET /api/wordbook/config": () => json(CONFIG),
    "POST /api/wordbook/answers": (call) => {
      const b = JSON.parse(String(call.body)) as { key: string; choice?: string };
      const ok = b.choice === b.key;
      return json({ correct: ok, outcome: ok ? "correct" : "wrong", grade: ok ? "good" : "forgot", expected: b.key, correct_option: b.key, diff: null,
        item: { box: 2, due_at: "x" }, applied: !ok, rating: null, spot_check: false, check: null });
    },
    ...routes,
  });
  renderWithProviders(<WordbookReviewPage />, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
    route: { pathname: "/wordbook/review", search: "?source=free", state },
  });
  return mock;
}
const answers = (mock: ReturnType<typeof createFetchMock>) =>
  mock.calls.filter((c) => c.url.pathname === "/api/wordbook/answers").map((c) => JSON.parse(String(c.body)) as Record<string, unknown>);

beforeEach(() => { resetServerAiConfigCache(); localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("review page in free mode", () => {
  const state = { free: camelcaseKeys(FREE_SET, { deep: true }) };

  it("starts straight away, answers with mode free and each item's own book", async () => {
    const mock = setup(state);
    expect(await screen.findByTestId("choice-question")).toBeTruthy();
    expect(mock.calls.some((c) => c.url.pathname.endsWith("/review/batch") || c.url.pathname.endsWith("/today"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "accept" }));
    await waitFor(() => expect(answers(mock)[0]).toMatchObject({ mode: "free", book_id: "cet4", key: "accept", qtype: "word", choice: "accept" }));
  });

  it("summarises without rank points, says it does not change the plan, and counts queued words", async () => {
    setup(state);
    await userEvent.click(await screen.findByRole("button", { name: "stop" }));            // 答错 → applied: true
    await userEvent.click(await screen.findByRole("button", { name: "继续" }));
    // 错的词会回到队尾再练一次,这里直接答对两次走完
    for (let i = 0; i < 4 && !screen.queryByTestId("session-summary"); i += 1) {
      const options = await screen.findAllByRole("button", { name: /^(accept|talk)$/ });
      await userEvent.click(options[0]);
      await userEvent.click(await screen.findByRole("button", { name: "继续" }));
    }
    expect(await screen.findByTestId("session-summary")).toBeTruthy();
    expect(screen.getByText("自由复习不计段位点,也不改变复习计划。")).toBeTruthy();
    expect(screen.queryByText("段位点")).toBeNull();
    expect(screen.getByRole("button", { name: "回到已学词" })).toBeTruthy();
  });

  it("goes back to the learned words when there is no batch in the router state", async () => {
    setup(null);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/wordbook/learned"));
  });
});
```

(第二个用例的循环只是为了把一个会回队尾的错题走完;若实际题序与此不符,执行者按真实题序改成确定的点击序列——断言(无段位点、一行说明、「回到已学词」)不变。)

- [ ] **Step 3: 跑测试确认失败** — `yarn vitest run src/features/wordbook/free-browse.test.tsx src/features/wordbook/review-free.test.tsx`。
- [ ] **Step 4: 实现 `free-browse.tsx`**:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { PageNote } from "./page-status";
import { RecallCard } from "./recall-card";
import { SessionHeader, StepBar } from "./session-header";
import { DOCK, GHOST, PRIMARY } from "./ui";
import { useSpeaker } from "./use-speaker";
import { useWordbookConfig } from "./use-wordbook-config";
import type { FreeSet, Question } from "./wordbook-api";

/**
 * 翻卡浏览(规格 §1.2,「只翻面的轻量卡片页」):正面词头 + 音标,翻面是完整词卡;不判分、不发任何请求、不写事件(R-L14)。
 * 复用 RecallCard 的正反两面。
 */
export function FreeBrowse({ set }: { set: FreeSet }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const speaker = useSpeaker();
  const config = useWordbookConfig();
  const showExample = config?.enabled ? config.learn.showExample : true;
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [finished, setFinished] = useState(false);
  const { items } = set;
  const item = items[index];
  const last = index === items.length - 1;
  const listen = { onListen: speaker.listen, listening: speaker.active, canListen: speaker.available };
  const title = t("web.wordbook.learned.free.browse.title");

  if (finished) {
    return (
      <div className="flex flex-1 flex-col">
        <SessionHeader title={title} />
        <div className="px-gutter"><PageNote>{t("web.wordbook.learned.free.browse.done")}</PageNote></div>
        <div className={DOCK}>
          <button type="button" className={cn(GHOST, "h-12 flex-1")} onClick={() => navigate("/wordbook/learned")}>{t("web.wordbook.learned.free.summary.back")}</button>
          <button type="button" className={cn(PRIMARY, "h-12 flex-1")} onClick={() => { setIndex(0); setFlipped(false); setFinished(false); }}>
            {t("web.wordbook.learned.free.browse.again")}
          </button>
        </div>
      </div>
    );
  }
  const question: Question = { key: item.card.key, qtype: "recall", prompt: { word: item.card.word, us: item.card.us || item.card.uk }, options: null, length: null };
  const go = (to: number) => { setIndex(to); setFlipped(false); };
  return (
    <div className="flex flex-1 flex-col">
      <SessionHeader title={title} subtitle={t("web.wordbook.learned.free.browse.progress", { n: index + 1, total: items.length })} />
      <div className="px-gutter pb-4">
        <StepBar done={index} total={items.length} />
        <RecallCard key={item.card.key} question={question} card={item.card} face={flipped ? "back" : "front"} rating={null} showExample={showExample} {...listen} />
      </div>
      <div className={DOCK}>
        <button type="button" className={cn(GHOST, "h-12 flex-1")} disabled={index === 0} onClick={() => go(index - 1)}>{t("web.wordbook.learned.free.browse.prev")}</button>
        {flipped ? (
          <button type="button" className={cn(PRIMARY, "h-12 flex-1")} onClick={() => (last ? setFinished(true) : go(index + 1))}>
            {last ? t("web.wordbook.learned.free.browse.finish") : t("web.wordbook.learned.free.browse.next")}
          </button>
        ) : (
          <button type="button" className={cn(PRIMARY, "h-12 flex-1")} onClick={() => { speaker.prime(); setFlipped(true); }}>{t("web.wordbook.learned.free.browse.flip")}</button>
        )}
      </div>
    </div>
  );
}
```

> `SessionHeader` 的 `subtitle`、`StepBar` 的 `done / total` 与复习页的用法一致(见 `review-page.tsx` 的 quiz 渲染)。浏览模式的翻面按钮在第一次点击里调用 `speaker.prime()`(iOS 音频解锁规则,见 `CLAUDE.md` 的 Audio 条目)。

- [ ] **Step 5: 改复习页** — `review-page.tsx`,按下列锚点逐处修改(原文逐字取自当前文件):
  1. import:`import { Link, useNavigate } from "react-router-dom";` → `import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";`;新增 `import { FreeBrowse } from "./free-browse";`、`import { toBatch, readFreeState, uniqueKeys } from "./free-batch";`;`./wordbook-api` 的 import 加 `type FreeSet`。
  2. 类型:`type Batch = { bookId: BookId; questions: Question[]; cards: Record<string, Card> };` → 加 `bookOf?: Record<string, BookId>`;其下加 `const bookOf = (b: Batch, key: string) => b.bookOf?.[key] ?? b.bookId;`。
  3. 组件改名:`export function WordbookReviewPage() {` → `function ReviewSession({ free }: { free: FreeSet | null }) {`;文件末尾追加导出的包装:

```tsx
/** 复习页入口:`?source=free` 时批次来自路由 state(自由复习,R-L14);翻卡浏览是同一块里的轻量组件;没有 state → 回已学词。 */
export function WordbookReviewPage() {
  const [params] = useSearchParams();
  const { state } = useLocation();
  if (params.get("source") !== "free") return <ReviewSession free={null} />;
  const set = readFreeState(state);
  if (!set) return <Navigate to="/wordbook/learned" replace />;
  return set.mode === "browse" ? <FreeBrowse set={set} /> : <ReviewSession free={set} />;
}
```
  4. 初始状态:`useWordbookToday(true)` → `useWordbookToday(free === null)`(自由复习不要今日计划);`useState<Phase>("intro")` → `useState<Phase>(free ? "quiz" : "intro")`;`useState<Batch | null>(null)` → `useState<Batch | null>(() => (free ? toBatch(free) : null))`;`useState<SessionState>(() => startSession([]))` → `useState<SessionState>(() => startSession(free ? uniqueKeys(toBatch(free).questions) : []))`。
  5. `send` 与 `iWasWrong` 里的 `submitAnswer(api, { bookId: batch.bookId, key: question.key, mode: "review", …` 两处都改为 `bookId: bookOf(batch, question.key), key: question.key, mode: free ? "free" : "review", …`。
  6. 小结:`points: rankEnabled ? keys.filter((k) => first[k].applied).length : null` → `points: rankEnabled && !free ? keys.filter((k) => first[k].applied).length : null`;`<SessionSummary stats={stats} onHome={() => navigate("/wordbook")} {...listen} onAgain={newLeft > 0 ? … : undefined} againLabel=…` → `onHome={() => navigate(free ? "/wordbook/learned" : "/wordbook")}`,`onAgain={!free && newLeft > 0 ? () => navigate("/wordbook/learn") : undefined}`,并加 `note={free ? freeNote(keys.filter((k) => first[k].applied).length) : undefined}`、`homeLabel={free ? t("web.wordbook.learned.free.summary.back") : undefined}`,其中 `const freeNote = (queued: number) => [t("web.wordbook.learned.free.summary.note"), queued > 0 ? t("web.wordbook.learned.free.summary.queued", { n: queued, count: queued }) : ""].filter(Boolean).join(" ");` 定义在该分支内。
  7. quiz 页头:`<SessionHeader title={t("web.wordbook.review.title")}\n        subtitle={t("web.wordbook.session.count", …` 的 `title` 改为 `free ? t("web.wordbook.learned.free.title") : t("web.wordbook.review.title")`。
- [ ] **Step 6: 改小结** — `session-summary.tsx`:组件参数加 `note, homeLabel`(可选);在 `<p role="status" … {line}</p>` 之后加 `{note ? <p data-testid="summary-note" className="mt-1.5 text-meta text-ink-2">{note}</p> : null}`;底部「回到首页」按钮文案改 `{homeLabel ?? t("web.wordbook.summary.home")}`。类型:`{ stats: SessionStats; onAgain?: () => void; againLabel?: string; onHome: () => void; note?: string; homeLabel?: string }`。
- [ ] **Step 7: 跑测试确认通过** — `yarn vitest run src/features/wordbook` 全目录(既有 `review-page.test.tsx`、`session-summary.test.tsx` 必须原样通过:非自由路径的行为没有任何改变)`&& yarn web:typecheck`。
- [ ] **Step 8: 提交** — `feat(web): free review in the review page, flip-card browse and summary note`。

### Task W6: 首页「已学 N 词」一行

**Files:**
- Modify: `home-page.tsx`、`home-page.test.tsx`

- [ ] **Step 1: 写失败测试** — `home-page.test.tsx` 顶部加 `import { LEARNED_SUMMARY } from "./learned-test-fixtures";`,`setup` 的默认路由里加 `"GET /api/wordbook/learned/summary": () => json(LEARNED_SUMMARY)`(既有用例因此不会请求到未登记的路由),追加:

```tsx
  it("links to the learned words with the total", async () => {
    setup(GOALS_TODAY);
    const row = await screen.findByTestId("wordbook-action-learned");
    expect(row).toHaveAttribute("href", "/wordbook/learned");
    await waitFor(() => expect(row).toHaveTextContent("已学 6 词"));
  });

  it("keeps the row (without a count) when the summary cannot be loaded", async () => {
    setup(GOALS_TODAY, { "GET /api/wordbook/learned/summary": () => json({ error: "Wordbook data unavailable" }, { status: 503 }) });
    const row = await screen.findByTestId("wordbook-action-learned");
    expect(row).toHaveAttribute("href", "/wordbook/learned");
    expect(row).not.toHaveTextContent("已学 0");
  });

  it("does not ask for the summary before a book is chosen", async () => {
    const mock = setup(NO_BOOK_TODAY);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/wordbook/books"));
    expect(mock.calls.some((c) => c.url.pathname.endsWith("/learned/summary"))).toBe(false);
  });
```

(最后一个用例的前提:`useLearnedSummary(enabled)` 的 `enabled` 传 `Boolean(today?.enrollment)`;若 `createFetchMock` 对未登记路由直接抛错,第一步改默认路由就是为避免它。)

- [ ] **Step 2: 跑测试确认失败** — `yarn vitest run src/features/wordbook/home-page.test.tsx`。
- [ ] **Step 3: 实现** — `home-page.tsx`:import `ListChecksIcon`(lucide)与 `useLearnedSummary`;组件里 `const learnedSummary = useLearnedSummary(Boolean(today?.enrollment)).summary;`(放在 `useGoals` 之后);在第三个 `ListRow`(按句拼写)之后加:

```tsx
            <ListRow icon={<IconChip tone="gray" icon={ListChecksIcon} />} title={t("web.wordbook.learned.row.title")} testId="wordbook-action-learned"
              subtitle={t("web.wordbook.learned.row.hint")}
              value={learnedSummary ? <span className="num text-meta text-ink-2">{t("web.wordbook.learned.row.count", { n: learnedSummary.total, count: learnedSummary.total })}</span> : undefined}
              to="/wordbook/learned" />
```

(`ListRow` 的 `value` 可选;若类型要求必传,传 `null`。`IconChip` 的 `tone` 以实际支持为准,`gray` 在 `session-summary.tsx` 用过。)

- [ ] **Step 4: 跑测试确认通过** — `yarn vitest run src/features/wordbook/home-page.test.tsx src/features/wordbook/learned-lazy.test.ts && yarn web:typecheck`。
- [ ] **Step 5: 提交** — `feat(web): wordbook home links to the learned words`。

### Task W7: 契约测试、文档(网页)、体积核对

**Files:**
- Modify: `web/src/features/wordbook/wordbook-contract.test.ts`、`web/src/features/wordbook/CLAUDE.md`
- 前置:S6 已合并(契约样例含新键)。

- [ ] **Step 1: 写契约测试** — `wordbook-contract.test.ts`:import 追加 `LearnedItem, LearnedPage, LearnedSummary, FreeSet, FreeItem`;键表(紧接 `BLANK` 之后):

```ts
const LEARNED_SUMMARY_KEYS: Record<keyof LearnedSummary, true> = { total: true, byBox: true, byTier: true, byBook: true, weak: true, yesterday: true, last7: true };
const LEARNED_ITEM: Record<keyof LearnedItem, true> = { bookId: true, key: true, word: true, box: true, tier: true, learnedAt: true, dueAt: true, weak: true };
const LEARNED_PAGE: Record<keyof LearnedPage, true> = { items: true, nextCursor: true };
const FREE_SET_KEYS: Record<keyof FreeSet, true> = { setId: true, scope: true, mode: true, items: true };
const FREE_ITEM: Record<keyof FreeItem, true> = { bookId: true, card: true, question: true };
```

并追加(与既有 `describe` 同级的 `it`,放在 `describe("wordbook contract (server fixture)"` 里):

```ts
  it("learned words and free review payloads match", () => {
    const summary = cc<LearnedSummary>(c.learned_summary);
    expect(keysOf(summary)).toEqual(keys(LEARNED_SUMMARY_KEYS));
    expect(summary.byBox).toHaveLength(6);
    expect(Array.isArray(summary.byBook) && summary.byBook[0] && Object.keys(summary.byBook[0]).sort()).toEqual(["bookId", "count"]);
    expect(Object.keys(summary.byTier).sort()).toEqual(["growing", "learning", "mastered"]);
    const page = cc<LearnedPage>(c.learned_list);
    expect(keysOf(page)).toEqual(keys(LEARNED_PAGE));
    expect(typeof page.nextCursor).toBe("string");
    expect(keysOf(page.items[0])).toEqual(keys(LEARNED_ITEM));
    expect(keysOf(cc<Card>(c.learned_card))).toEqual(keys(CARD));
    const free = cc<FreeSet>(c.free_start);
    expect(keysOf(free)).toEqual(keys(FREE_SET_KEYS));
    expect(keysOf(free.items[0])).toEqual(keys(FREE_ITEM));
    expect(keysOf(free.items[0].card)).toEqual(keys(CARD));
    expect(keysOf(free.items[0].question as Question)).toEqual(keys(QUESTION));
    const answer = cc<AnswerResult>(c.answer_free);
    expect(keysOf(answer)).toEqual(keys(ANSWER));
    expect(answer.applied).toBe(true);
  });
```

- [ ] **Step 2: 跑测试** — `yarn vitest run src/features/wordbook/wordbook-contract.test.ts`(不得 skip;样例不存在就是 S6 没合并,先合并)。契约暴露的任何不一致,改 `wordbook-api.ts` 的类型(不改服务端样例)。
- [ ] **Step 3: 英文不溢出** — 浏览器窗格(375 × 812 与 360 宽)切英文,逐项目检:已学词页的分布条三个分段、筛选行、列表行(长词 + 两个徽标)、自由复习面板(6 个范围按钮、4 个方式分段)、浏览页底栏。任何换行溢出:缩短对应英文字符串(不改布局);结论写进 Z2 的结果。若浏览器窗格不可用,标「未验证」。
- [ ] **Step 4: 文档** — `web/src/features/wordbook/CLAUDE.md`:`What lives here` 追加一条 「Learned words & free review (spec `2026-10-12-wordbook-review-and-room-reopen-design.md` §1)」:`learned-page.tsx`(`/wordbook/learned`,懒加载;列表、筛选、词卡抽屉)、`box-bar.tsx`(分布条,点分段筛选)、`use-learned.ts`(`useLearnedSummary`、`useLearnedList` 游标、`useDebounced`)、`free-review-sheet.tsx`(范围 × 方式 × 数量)、`free-batch.ts`(`FREE_PATH`、`toBatch`、`readFreeState`)、`free-browse.tsx`(翻卡浏览,不发请求)、`learned-test-fixtures.ts`。`Pitfalls` 追加:
  - 已学词页、自由复习面板、浏览组件只经 `lazy-pages.tsx`(或页面内部)到达,`learned-lazy.test.ts` 守着;首页只多一行与一个汇总请求。文案是 eager 合并进主包的,新增键要克制(预算见计划 R-L13)。
  - 前缀 / 词只放 POST 体:`fetchLearned`、`fetchLearnedCard`、`startFree` 不得改成 GET 或把词拼进路径;`fetchCard`(GET `/cards/{book}/{key}`)是遗留写法,新页面不用。
  - 自由复习批次经 `navigate(FREE_PATH, { state: { free } })` 传给 `/wordbook/review?source=free`;`ReviewSession` 在 `free` 下用 `mode: "free"`、按条目取 `bookId`、不请求今日计划、小结不显示段位点;`applied` 在自由模式 = 「已加入今天的复习」。
  - 熟练度三档是盒 0–1 / 2–3 / 4–5(不是「1–6」);`LearnedSummary.byBook` 是列表。
  - 契约:`wordbook-contract.test.ts` 逐键核对 `learned_summary / learned_list / learned_card / free_start / answer_free`。
- [ ] **Step 5: 全量** — `yarn web:typecheck && yarn web:test && yarn web:build`。
- [ ] **Step 6: 提交** — `test(web): wordbook contract covers learned words and free review` 与 `docs(web): learned words and free review notes`。

---

## Final lane (Z)

### Task Z1: E2E 与文档

**Files:**
- Create: `web/e2e/wordbook-learned.spec.ts`
- Modify: `web/README.md`(背单词段)、`docs/superpowers/plans/e2e-results.md`(「背单词 · 已学词」一节)

- [ ] **Step 1: E2E(Playwright,零上游;栈 `docker-compose.e2e.yml` 已开 `WORDBOOK_ENABLED`,沿用 `wordbook.spec.ts` 的登录与夹具)**

```ts
test("wordbook: learned words page and free review", async ({ page }) => {
  // 1. 登录 → /wordbook/learn:用「认识」「模糊」「不认识」各学 1–2 个词(WORDBOOK_SPOT_CHECK_PCT=100 时「认识」会被抽查,按 wordbook-recall.spec.ts 的做法答完小测)
  // 2. 回 /wordbook:断言有「已学词」一行,计数与已学数一致;点进去 → /wordbook/learned
  // 3. 分布条三个分段数字之和 = 已学数;点「新学」→ 列表只剩盒 0–1 的词;再点一次取消
  // 4. 搜索框输入前缀(如 ab)→ 列表只含该前缀的词;断言本次所有请求的 URL 都不含 "ab"(page.on("request"))
  // 5. 点一行 → 抽屉里是词卡(释义可见);关闭后焦点回到那一行
  // 6. 「自由复习」→ 范围「随机抽取」、方式「翻卡浏览」、10 个 → 开始 → 翻面 / 下一个走完 → 「回到已学词」;断言期间没有 /api/wordbook/answers 请求
  // 7. 再来一次:方式「选择题」→ 故意答错一个、答对其余 → 小结显示「自由复习不计段位点…」与「1 个答错的词已加入今天的复习」,没有段位点卡片
  // 8. /api/wordbook/today:review_done 与 new_done 与自由复习前相同;review_due 比之前多 1(被拉到今天的那个词)
  // 9. 刷新自由复习页(无 history state 时)→ 回到 /wordbook/learned
});
```

- [ ] **Step 2: 运行** — `yarn web:e2e --project=chromium-mobile wordbook-learned wordbook.spec.ts wordbook-recall`(需 E2E 栈;改了 env 后重建)。结果写进 `e2e-results.md`:Docker E2E 栈、真机(iOS Safari / 安卓 Chrome)的日期选择器与搜索框(`inputMode="search"`、中文输入法组字时的前缀搜索)、VoiceOver / TalkBack 读分段按钮与列表、`<input type="date">` 在 iOS 上的外观 —— 逐项标「已验证 / 未验证」。
- [ ] **Step 3: 文档** — `web/README.md` 背单词段追加一小节「已学词与自由复习」:入口(首页「已学 N 词」)、筛选与前缀搜索(POST,词不进 URL)、自由复习的规则表(不改盒子 / 不加段位点 / 不占复习上限;答错在 24 小时静默期与每日 20 次上限内「加入今天的复习」)、翻卡浏览不发请求、主包增量(Z2 实测数字)、未验证清单。
- [ ] **Step 4: 提交** — `test(e2e): wordbook learned words and free review` 与 `docs: wordbook learned words notes`。

### Task Z2: 评审波与合并验收

- [ ] `/code-review high`(S、W 各一次)与 `security-review`(整个分支)。重点:
  - **刷分路径**(R-L6):`_free_answer` 里没有任何一处调用 `apply_review` / `apply_lapse` / `set_learn_box` / 写 `reps` / `last_reviewed_at`;`pull_due` 的 `WHERE due_at > now`;24 小时静默期与每日 20 次;`WordAnswered` 恰好一次、`kind="practice"`。
  - **输入校验**:`extra="forbid"`、`count ∈ {10,20,50}`、`limit ≤ 50`、`q ≤ 30`、`cursor ≤ 200`、日期正则;LIKE 转义;`book` 必须启用。
  - **隔离**:每条 SQL 都带 `user_id`;自由作答与词卡抽屉都要求 `source == wordbook:<book_id>`。
  - **日志 / URL**:`caplog` 用例与路由内省用例通过;没有任何新路径参数或词相关查询参数。
- [ ] 视觉(浏览器窗格 375×812,浅色 + 深色 + 英文):已学词页、自由复习面板、浏览页、复习页自由模式小结;键盘走一遍面板(Tab 顺序、Esc、焦点回到打开它的按钮)。
- [ ] 全量:`cd server && uv run pytest -q`;`yarn web:typecheck && yarn web:test && yarn web:build`;E2E。
- [ ] **主包体积(R-L13)**:`yarn web:build`,记录主包(`index-*.js`)gzip 大小,与 W1 Step 0 的基线对比,填下表;新页面在独立的懒加载块里(`learned-page-*.js`)。超出 1.5 kB 就删文案(不放宽预算)。

| | 基线(W1 Step 0) | 合并后 | 增量 | 预算 |
|---|---|---|---|---|
| 主包 gzip | 待填 | 待填 | 待填 | ≤ 1.5 kB(代码 ≤ 0.2 kB) |
| `learned-page` 块 gzip | — | 待填 | — | 不限(懒加载) |

- [ ] 真机清单与 Postgres(`TEST_DATABASE_URL`)、反向代理未验证项写进 `e2e-results.md`,不勾「已验证」。

## 验收标准

1. 首页有「已学 N 词」一行,N 等于已学词页的总数;书卡「已学」若不同,按 R-L2 解释。
2. 已学词页:分布条三段(盒 0–1 / 2–3 / 4–5)之和 = 总数,点分段即筛选、再点取消;词书、易错、学习日期(首尾含)、英文前缀搜索可叠加;列表新学在前、游标分页每页 50;点行打开词卡;空库有「去学新词」,筛选无结果有「清除筛选」。
3. 前缀与任何词都不出现在 URL、日志、`caplog`;新路由没有路径参数、查询参数只有 `tz_offset_minutes`(测试守着)。
4. 自由复习:范围(昨天 / 最近 7 天 / 一本书 / 一个熟练度 / 易错词 / 随机)× 方式(翻卡浏览 / 快速回忆 / 选择题 / 拼写)× 数量(10 / 20 / 50);抽词在服务端,客户端不能指定词;空池 409,池为空的范围在面板里置灰。
5. 自由作答对盒子、`reps`、`last_reviewed_at`、段位点、`review_done`、`new_done`、连续达标**零影响**(测试逐项断言,含「12 次交替答对答错后 `vocab_reviews` 仍为 0」);事件 `kind = practice`;`WordAnswered` 每次一条。
6. 自由答错:未到期、24 小时内没正式复习过、当天拉取未满 20 个时 `due_at = now`(进入正式复习队列),`applied: true`;否则只判分,`applied: false`;已到期的词不动。
7. 翻卡浏览不发任何作答请求;刷新后没有 state → 回已学词页。
8. 无迁移、无新设置;`alembic heads` 仍 `0013`;分层测试(服务端 + 网页)未放宽。
9. 契约样例含 `learned_summary / learned_list / learned_card / free_start / answer_free`,网页契约测试逐键核对且不 skip。
10. 主包 gzip 增量 ≤ 1.5 kB(代码 ≤ 0.2 kB),新页面全部懒加载(`learned-lazy.test.ts`)。
11. 三个 `CLAUDE.md`(wordbook、routers、web wordbook)已更新;中英文案齐全,英文在 360–375 px 下不换行溢出(或标未验证)。

## 规格覆盖自查(spec → task)

| spec | task |
|---|---|
| §1.1 状态(盒子、事件) | R-L1、R-L2、S2 |
| §1.2 首页入口「已学 N 词」 | S3(汇总)、W6 |
| §1.2 分布条与分段筛选 | S1(分档)、S3、W2(`BoxBar`)、W3 |
| §1.2 筛选:词书 / 熟练度 / 易错 / 日期 / 英文前缀 | S1、S2、S3、W3(R-L3、R-L4、R-L5) |
| §1.2 列表分页(游标,每页 50)、点行开词卡、空状态 | S2、S3、W2、W3(R-L12) |
| §1.2 自由复习范围与方式 | S4、W4、W5(R-L10、R-L11、R-L14) |
| §1.3 规则表(答对 / 答错 / 浏览) | S5(规则表与测试)、W5 |
| §1.3 `practice` 事件、`WordAnswered` 一次 | S5、R-L15 |
| §1.3 私有种子 / 客户端不能指定词 | S4(R-L8、R-L9) |
| §1.3 作答上限沿用、不新增设置 | S5(`consume_answer`)、Global Constraints |
| §1.4 接口 | S3、S4、S5(R-L4、R-L10 记录字段差异) |
| §1.5 前端文件与 `source=free`、懒加载、`web.wordbook.learned.*` | W1–W6、W3(`learned-lazy.test.ts`) |
| §1.6 不做 | 见下 |
| 规范:CLAUDE.md、架构测试、契约、i18n、日志、体积、未验证 | S6、W7、Z1、Z2 |

## 不做

- 中文释义搜索;按释义、例句、词性搜索(规格 §1.6)。
- 导出已学词;给已学词打自定义标签(规格 §1.6)。
- **自由复习的段位点**(规格 §1.6),以及任何让自由复习计入每日复习上限、连续达标、`review_done` 的做法。
- 自由复习的服务端会话 / 抽取结果持久化、`set_id` 校验、「继续上次的自由复习」。
- 翻卡浏览的任何服务端记录(不写事件、不统计)。
- 已学词页里的批量操作(批量删除、批量重置盒子、批量加入生词本)。
- 含「生词本加入、非词书来源」的词的「已学」口径(R-L2)。
- 新增迁移、新增设置项、新增管理端页面;改 `enjoy/`。
- 改既有 `GET /api/wordbook/cards/{book_id}/{key}`(遗留的词在路径里,另开任务收口)。
- 改正式复习 / 学新词的任何规则(`apply_lapse`、抽查、`_day_plan` 一概不动)。

## Cross-plan assumptions

- **合并顺序与锚点:** 本计划(W)第一个合并。后合并的 R(房间重新开启,迁移 `0014`)、A1–A5(智能体)在本计划之后追加:共享的 `server/app/main.py`、`models.py`、`config.py`、`settings_registry.py`、`.env.example`、两个 `architecture` 测试、i18n JSON(它们用各自前缀,不改 `web.wordbook.*`)、各层 `CLAUDE.md` 都不是本计划的写入目标;本计划只写 `server/app/wordbook/*`、`server/app/routers/wordbook.py` 与 `web/src/features/wordbook/*`(外加 `web/src/app.tsx` 一条路由与 `web/src/test/render.tsx` 的类型放宽)。
- **迁移:** `alembic heads` 在本计划合并后仍是 `0013`;R 取 `0014`,A1 取 `0015`,A2/A3 取 `0016`(以 INDEX 为准)。本计划不占号。
- **契约样例:** `server/tests/fixtures/wordbook_contract.json` 只由本计划(与既有 recall / goals)改;R 的是 `rooms_contract.json`,A* 的是 `agents_contract.json`,互不重叠。
- **学习联动(`LINKS_ENABLED`):** `links/mistakes.py` 的 `LAPSE_KINDS` 含 `practice`,自由答错 / 快速回忆「不认识」会进「易错词」、连续答对 2 次移出(R-L15)。本计划假设联动层保持这个口径;若联动层改为忽略自由复习,需要给事件加标记(例如 `qtype` 之外的字段),那是联动计划的改动,不在本计划内。`word_actions` 的「查看词卡」仍走既有路径。
- **智能体(A2 记忆 / A3 导师)可能读已学词:** 如需「已学词 / 易错词」作为上下文来源,请用 `store.learned_page` / `store.free_pool` / `learned.TIERS` / `learned.is_weak`(签名在本计划 S1–S2 固定),不要另写 SQL;读到的词只进提示词,不进日志与 URL(同本计划 R-L4)。`agents` 层可以导入 `wordbook`(分层允许 agents → wordbook?以 A1 的架构测试为准;本计划不改它)。
- **每日复习与「拉到今天到期」:** 正式复习的 `_day_plan` / `review_cap` 不区分「自然到期」与「被自由答错拉到期」;被拉的词会计入 `review_due`(规格 §1.3「进入正式复习队列」)。目标计划(goals)若以后要区分,需要在 `wordbook_events` 里留痕(本计划没有)。
- **搜索 / 词典:** 假设 `normalize_word` 的行为(NFC、折叠、小写)不变;`vocabulary_items.word` 存的是 `card.key`(规范化键)。
- **主包基线:** 假设 `web/src/i18n/index.ts` 继续用 eager glob;若 A4 / R 把某个 feature 的文案改成懒加载,本计划的文案预算(R-L13)可以放宽,但要在 INDEX 里记录,不在本计划里改。
