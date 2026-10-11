# 学习模块联动(Learning links)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用两个小机制把学习模块解耦并接上六个可插拔联动:服务端中性核心层里的进程内学习事件通道(模块只在提交后发布纯数据事件,联动逻辑在新的顶层 `app/links/`),网页里的类型化扩展点注册表(消费方只渲染插槽,提供方在 `register*.ts` 里登记、由 `web/src/plugins/index.ts` 一处列出);六个联动(单词操作位置、今日任务聚合卡、易错词、发音弱词 ↔ 跟读、对话用到今日词、段位点来源注册)各有管理端全局开关与每用户开关,全部关闭时 App 与今天完全一致。

**Architecture:** 服务端:`app/core/learning_events.py`(事件数据类 + `LearningBus` 有界队列、单消费任务、超时、熔断、计数;`bind`/`publish` 走 contextvar,`current_user` 绑定)、`app/core/rank_sources.py`(段位来源注册表);新顶层 `app/links/`(`spec`、`gate`、`prefs`、`setup`、`registry`、`purge`、`admin_view` 与六个联动模块),只被 `routers/` 与 `main.py` 导入;段位经新文件 `app/rank/extra_sources.py` 读 `app.models.LinkCredit`,`ledger._sync` 只附加一行导入 + 四行;迁移 `0013_learning_links` 建五张表。网页:`web/src/lib/extension-points.ts`(纯注册表 + 旗标)与 `extension-points-react.tsx`(`Slot`、`WordActions`、错误边界);`web/src/plugins/`(组合层:`core`、`links` 与五个联动插件);各 feature 的 `register*.ts(x)` 只被插件导入。管理端:`/api/admin/links` + `admin/src/features/links/`。

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + pydantic v2 + httpx/respx + pytest-asyncio(Python 3.12,uv);React 18 + react-router 7 + Tailwind 3 + vitest + Testing Library + lucide-react;admin:Vite 6 + React 18 + vitest;Playwright(E2E 大纲)。不新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-11-learning-links-design.md`(视觉稿 `docs/superpowers/design/learning-links-v1/mockup.html`)。前置:`docs/superpowers/specs/2026-10-10-wordbook-design.md`、`2026-10-09-rank-and-rooms-design.md`、`2026-10-09-admin-console-v2-design.md`、`docs/superpowers/design/redesign-v3/design-notes.md`。

## Global Constraints

- **合并顺序与迁移号:** 本计划(C)在 A(背单词回忆流程)与 B(目标/设置面板)**之后**合并:A → B → C。迁移只新增 `server/alembic/versions/0013_learning_links.py`(`revision = "0013"`,`down_revision = "0012"`)。A、B 都**不新增迁移**,所以 A、B 合并后 head 仍是 `0012`(INDEX 裁定 I-M1)。Task 0 的 `alembic heads` 必须输出 `0012`;若不是(A 或 B 在实施中被迫加了迁移),本计划的号顺延为「当时 head + 1」,并把本文与 spec 里所有 `0013` / `0012` 引用、文件名、测试名一起改掉(INDEX §5),再继续。
- **分层:** 由 `server/tests/test_architecture.py` 与 `web/src/architecture.test.ts` 强制,不放宽任何既有规则。服务端新层 `links` 可导入 `links, core, models, providers, speech, services, rank, rooms, wordbook`;只有 `routers`、`main` 可导入 `links`。`core/learning_events.py`、`core/rank_sources.py` 只用标准库。段位不导入 `app.links`(读 `app.models.LinkCredit`)。网页:`plugins/` 只被 `main.tsx`(与 `test/setup.ts` 导入 `plugins/core`)导入;`features/<x>/register*.ts(x)` 只被 `plugins/**` 导入且不导入其他 feature;feature→feature 导入对冻结在基线;`AddVocabularyButton` 只在 `features/vocabulary/` 内部引用。
- **全关等于今天:** `LINKS_ENABLED` 默认 `false`;关闭时 `publish` 立即返回 False、不入队;`/api/links/config` 返回 `{"enabled": false, "links": [...全部 effective=false]}`,其余 `/api/links/*` 404;网页插槽只渲染核心贡献(「加入生词本」),其 DOM 与直接渲染 `AddVocabularyButton` 逐字节相同。既有测试一个不改(Task L1 搬走的 `vocabularyFromLookup` 用例除外,原样搬到 lookup)。
- **尽力而为:** 联动失败不让主请求失败;处理器有超时、熔断、队列上限,幂等;关键积分继续读源表;联动段位点只吃共享每日上限的剩余额度且有子上限(spec §5.4)。
- **与 A/B 共享文件只做附加:** 精确插入点见「并行车道」表下的「共享文件插入点」;不改、不移动、不重排任何既有行。
- **隐私与日志:** `MessageSent.text` 只在内存;联动表不存正文;日志、审计、异常消息、管理端错误列表只含联动键、事件类名、异常类名、毫秒与计数——永不含词、文本、用户输入、用户 id。每个日志断言有 `caplog` 测试。
- **设置:** 新字段全部登记进 `app/core/settings_registry.py`(新组 `("links", "学习联动")`,`apply="hot"`),`tests/test_settings_registry.py` 保持绿;读设置一律经 `app.state.settings`(每次读)。
- **错误:** `{"error": "..."}`;新原文 `Links are disabled`、`Link is off`、`Unknown link`、`Word not found`、`Wordbook is disabled`、`Wordbook data unavailable`;网页映射表 `LINKS_SERVER_ERRORS`。
- **文案:** 联动文案统一放在插件目录 `web/src/plugins/<x>/i18n/{zh-CN,en}.json`,键前缀 `web.links.<x>.*`——即使由某个 feature 的 `register-*.tsx` 渲染(这样不碰 A/B 的 feature i18n 文件)。中英齐全;页面测试断言中文(`beforeEach` 设 `localStorage["enjoy-web.settings"]={language:"zh-CN"}` 并 `i18n.changeLanguage("zh-CN")`,`afterEach` 切回 `en`)。
- **视觉:** redesign-v3 一色一义:蓝 = 主操作/你;青 = 词汇/词书;琥珀 = 提醒/弱项;绿 = 完成/≥85;错误中性;红只用于危险。触控 ≥ 44px;深色模式;一屏 ≤ 3 层模糊;界面装饰不用 emoji。
- **每个新目录有 `CLAUDE.md`**(What lives here / Allowed dependencies / Test / Pitfalls)。
- **每个任务结束:** `cd server && uv run pytest -q <任务列出的测试> tests/test_architecture.py` 绿;涉及网页时 `yarn web:typecheck && cd web && yarn vitest run <任务列出的目录> src/architecture.test.ts` 绿;涉及管理端时 `cd admin && yarn vitest run src/features/links` 绿。车道合并前跑全量 `uv run pytest -q`、`yarn web:typecheck && yarn web:test && yarn web:build`、`cd admin && yarn vitest run && yarn build`。一个任务一个逻辑提交,conventional 格式,提交信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。
- 数字取自 spec;改数字先改 spec。

---

## 文件结构

```
server/
  alembic/versions/0013_learning_links.py
  app/core/learning_events.py        事件数据类、LearningBus、bind/publish(标准库)
  app/core/rank_sources.py           段位来源注册表(标准库)
  app/rank/extra_sources.py          读 LinkCredit、按剩余额度封顶(段位包内新文件)
  app/links/
    CLAUDE.md  __init__.py(空)
    spec.py        LinkSpec、LINK_KEYS、flag_of、WordIn
    gate.py        LinkGate(三级开关 + 每用户偏好缓存)、require_link 依赖
    prefs.py       user_link_prefs 读写
    registry.py    LINKS(六行;删一行 = 删一个联动)
    setup.py       install(app)、config_out
    purge.py       每日清理任务
    admin_view.py  管理端视图(计数、来源、错误、关闭人数)
    word_actions.py  daily_tasks.py  mistakes.py  pron_shadow.py  chat_words.py  rank_sources.py
  app/routers/links.py  app/routers/admin_links.py
  tests/links_helpers.py
  tests/test_learning_events.py  test_rank_sources.py  test_links_gate.py  test_links_api.py  test_links_publishers.py
  tests/test_links_matrix.py  test_links_word_actions.py  test_links_daily_tasks.py  test_links_mistakes.py
  tests/test_links_pron_shadow.py  test_links_chat_words.py  test_rank_extra_sources.py  test_admin_links.py
  tests/fixtures/links_contract.json  links_<key>_contract.json(每个有接口的联动一份)
web/src/
  lib/extension-points.ts  lib/extension-points-react.tsx  lib/extension-points.test.tsx
  plugins/CLAUDE.md  plugins/index.ts  plugins/core.ts  plugins/links-matrix.test.tsx
  plugins/links/        links-api.ts links-config.tsx links-settings-page.tsx links-me-row.tsx index.ts i18n/ *.test.tsx links-contract.test.ts
  plugins/word-actions/ index.ts more-button.tsx word-actions-sheet.tsx i18n/ *.test.tsx
  plugins/daily-tasks/  index.ts today-api.ts daily-tasks-card.tsx i18n/ *.test.tsx
  plugins/mistakes/     index.ts mistakes-api.ts mistakes-row.tsx mistakes-page.tsx i18n/ *.test.tsx
  plugins/pron-shadow/  index.ts pron-api.ts sources-strip.tsx today-words-sheet.tsx weak-words-row.tsx weak-words-page.tsx i18n/ *.test.tsx
  plugins/chat-words/   index.ts chat-words-api.ts used-badge.tsx chat-words-task.tsx i18n/ *.test.tsx
  features/vocabulary/  register.ts word-action.tsx register-word-actions.tsx
  features/wordbook/    register-word-actions.tsx link-actions.tsx register-daily-tasks.tsx
  features/practice/    register-word-actions.tsx register-daily-tasks.tsx
  features/chat/register-daily-tasks.tsx  features/rank/register-daily-tasks.tsx
  features/lookup/word-target.ts(+ test)
admin/src/features/links/{index.ts,api.ts,strings.ts,links-page.tsx,links-page.test.tsx}
web/e2e/links.spec.ts(Z1)
```

## 并行车道、文件归属与合并顺序

| 车道 | 任务 | 独占文件(本车道进行期间只有它改) | 依赖 |
|---|---|---|---|
| **foundation F**(串行) | F1–F7 | `server/app/core/{learning_events,rank_sources}.py`、`server/app/core/deps.py`(一行)、`server/app/core/{config,settings_registry}.py`(追加)、`server/.env.example`(追加)、`server/app/models.py`(追加)、`server/alembic/versions/0013_learning_links.py`、`server/tests/test_migrations.py`(追加)、`server/tests/test_settings_registry.py`(追加)、`server/app/admin/users_admin.py`(删除列表追加)、`server/app/links/{__init__,spec,gate,prefs,registry,setup,purge}.py`、`server/app/links/CLAUDE.md`、六个联动模块的 **F4 桩**、`server/app/routers/links.py`、`server/app/main.py`、`server/tests/test_architecture.py`、`server/app/CLAUDE.md`、`server/tests/links_helpers.py`、`server/tests/test_{learning_events,rank_sources,links_gate,links_api,links_publishers,links_matrix}.py`、`server/tests/fixtures/links_contract.json`、发布点 `server/app/wordbook/service.py` / `server/app/routers/{speech,conversations}.py` / `server/app/services/stats.py`(附加)、`web/src/lib/extension-points*`、`web/src/plugins/{index,core}.ts`、`web/src/plugins/CLAUDE.md`、`web/src/plugins/links/**`、五个联动插件的 **F7 桩** `web/src/plugins/<x>/index.ts`、`web/src/features/vocabulary/{register.ts,word-action.tsx}`、消费方插槽插入(`practice-page.tsx`、`me-page.tsx`、`vocabulary-page.tsx`、`wordbook/word-card.tsx`、`app.tsx`、`main.tsx`)、`web/src/test/setup.ts`、`web/src/architecture.test.ts` | Task 0 |
| **L6 rank_sources** | L6-1, L6-2 | `server/app/links/rank_sources.py`、`server/app/rank/{extra_sources,ledger,rules}.py`(ledger 一行导入 + 四行附加、rules 加两字段)、`server/app/rank/CLAUDE.md`、`server/tests/test_rank_extra_sources.py`、`admin/src/features/rank/{api.ts,rules-schema.ts,rules-schema.test.ts,strings.ts}` 与规则编辑器里点数分组所在文件、`web/src/features/rank/{rank-home-page.tsx,i18n/en.json,i18n/zh-CN.json}`(一个标签) | F |
| **L1 word_actions** | L1-1…L1-3 | `server/app/links/word_actions.py`、`server/tests/test_links_word_actions.py`、`server/tests/fixtures/links_word_actions_contract.json`、`web/src/plugins/word-actions/**`、`web/src/features/vocabulary/{register-word-actions.tsx,index.ts,save-vocabulary-item.ts,save-vocabulary-item.test.ts,CLAUDE.md}`、`web/src/features/wordbook/{register-word-actions.tsx,link-actions.tsx}`、`web/src/features/practice/register-word-actions.tsx`、`web/src/features/lookup/{word-target.ts,word-target.test.ts,lookup-layer.tsx,index.ts}`、`web/src/features/chat/conversation-page.tsx`(两行)、`web/src/features/progress/progress-page.tsx`(两行)、`web/src/features/rooms/extras/summary-page.tsx`(两行)、`web/src/architecture.test.ts`(基线减边;L1 期间独占,F 之后) | F |
| **L2 daily_tasks** | L2-1, L2-2 | `server/app/links/daily_tasks.py`、`server/tests/test_links_daily_tasks.py`、`server/tests/fixtures/links_daily_tasks_contract.json`、`web/src/plugins/daily-tasks/**`、`web/src/features/{wordbook,practice,chat,rank}/register-daily-tasks.tsx` | F |
| **L3 mistakes** | L3-1, L3-2 | `server/app/links/mistakes.py`、`server/tests/test_links_mistakes.py`、`server/tests/fixtures/links_mistakes_contract.json`、`web/src/plugins/mistakes/**` | F |
| **L4 pron_shadow** | L4-1, L4-2 | `server/app/links/pron_shadow.py`、`server/tests/test_links_pron_shadow.py`、`server/tests/fixtures/links_pron_shadow_contract.json`、`web/src/plugins/pron-shadow/**` | F |
| **L5 chat_words** | L5-1…L5-3 | `server/app/links/chat_words.py`、`server/tests/test_links_chat_words.py`、`server/tests/fixtures/links_chat_words_contract.json`、`web/src/plugins/chat-words/**` | F(段位入账的端到端断言在 L6 合并后 rebase) |
| **admin LA** | LA-1, LA-2 | `server/app/links/admin_view.py`、`server/app/routers/admin_links.py`、`server/app/admin/doctor.py`(两条发现)、`server/tests/test_admin_links.py`、`admin/src/features/links/**`、`admin/src/app.tsx`、`admin/src/components/layout.tsx`、`admin/src/features/usage/strings.ts` | F |
| **final Z** | Z1, Z2 | `web/src/plugins/links-matrix.test.tsx`、`web/src/architecture.test.ts`(删 `PENDING`)、`web/e2e/links.spec.ts`、`docker-compose.e2e.yml`(两行 env)、`server/README.md`、`web/README.md`、`server/app/links/CLAUDE.md`(补充)、`web/src/plugins/CLAUDE.md`(补充)、`docs/superpowers/plans/e2e-results.md` | 全部 |

**合并顺序:** Task 0 → F1 → F2 → F3 → F4 → F5 → F6 → F7 →(L6、L1、L2、L3、L4、L5、LA 并行开发,各自 rebase 到 F7)→ L6-1 → L6-2 → L1-1 → L1-2 → L1-3 → L2-1 → L2-2 → L3-1 → L3-2 → L4-1 → L4-2 → L5-1 → L5-2 → L5-3 → LA-1 → LA-2 → Z1 → Z2。各车道只替换自己的桩文件,`server/app/links/registry.py` 与 `web/src/plugins/index.ts` 在 F 里一次写全,车道不改。L5-3(段位入账端到端)在 L6 合并后 rebase。

**评审波:** 每条车道合并前跑 `/code-review high`;F 与 L5 另跑 `security-review`(事件里的消息正文只在内存、日志卫生、开关绕过、越权读写他人联动数据、大模型额度与 402 降级);网页车道合并前在浏览器窗格 375×812 浅色与深色截图,对照视觉稿对应帧;Z2 对整个分支跑 `security-review` 与真机清单(spec §19),未验证项写进 `e2e-results.md`。

### 共享文件插入点(A/B 也会改的文件;只附加,冲突一律「两边都保留」)

| 文件(归属) | 插入点(以锚点文本为准,行号为写计划时) | 任务 |
|---|---|---|
| `server/app/wordbook/service.py`(A、B) | 文件头导入块末尾加 `from app.core import learning_events`;`answer()` 客观题路径:锚点 `await session.commit()` + 下一行注释 `# Ruling Z-e`(A 合并后仍在,文字为「expected = 词头;correct_option = 选择题正确项原文(打字题为 null)」)之间插入一条 `learning_events.publish(...)`;A 的 `_rating_answer()`:锚点为函数末尾的 `await session.commit()` + 下一行 `checked = p.mode == "review" and p.choice is not None and rating == "know"` 之间插入第二条发布(INDEX R-E1;抽查 pending 分支那次带注释 `# 只扣了作答次数` 的 `commit()` 之后**不**发布);`spell_submit()`:锚点 `words, next_blank, seen = [], 0, set()`(现 401 行)之后插入 `answered: list = []`,锚点 `credit=credit, day=day, now=now)` 即循环内 `store.add_event(...)` 调用结束(现 415 行)之后插入一条 `answered.append(...)`,锚点 `await session.commit()`(现 429 行)之后插入两行发布循环 | F5 |
| `web/src/features/wordbook/word-card.tsx`(A) | 文件头加 `import { Slot } from "~/lib/extension-points-react";`;A 的 W3 把释义 / 例句 / 短语包进了 `{covered ? (<>…<RecallCover …/>…</>) : (<div id={regionId} …>…</div>)}`,所以旧锚点 `) : null}` + `</SurfaceCard>` 已不存在。新锚点:`WordCardView` 里该 `covered` 三元块的结尾 `)}` + `</SurfaceCard>` 之间插入 `{covered ? null : <Slot point="wordDetailSections" props={{ word: card.key }} />}`(遮罩时不渲染联动区;A 的 `RecallCard` 背面复用 `WordCardView`,因此背面也有插槽,正面没有) | F7 |
| `web/src/features/practice/practice-page.tsx`(仅 C;A、B 不改) | 文件头加 `import { Slot } from "~/lib/extension-points-react";`;锚点 `<WordbookCard className="mt-2" />`(现 173 行)之后插入 `<Slot point="practiceHome" props={{}} />`;锚点 `<SectionGroup title={t("web.practice.home.shadowing")} bare>`(现 174 行)改为在其**下一行** `<SurfaceCard className="p-3.5">` 之前插入 `<div id="shadowing" />`(不改 SectionGroup 本身);锚点 `<label htmlFor="reference"`(现 176 行)之前插入 `<Slot point="learningSources" props={{ pick: setReference }} />` | F7 |
| `web/src/pages/me-page.tsx`(仅 C;A、B 不改) | 文件头加导入;锚点 `<WordbookMeRow />`(现 191 行)之后插入 `<Slot point="meRows" props={{}} />` | F7 |
| `server/app/core/{config,settings_registry}.py`(A、B 都改背单词段)、`server/.env.example`、`server/app/models.py`、`server/app/main.py`、`server/tests/{test_migrations,test_settings_registry}.py`(这几个 A、B 不改) | `config.py`:锚点 `wordbook_data_dir: str = ""`(背单词段最后一行;A 的 4 个字段与 B 的 6 个字段都在它之前)之后追加;`settings_registry.py`:`GROUPS` 在 `("wordbook", "背单词")` 之后加一项,15 条追加在 `_ALL` 末尾(`# admin` 段之后);其余只在文件末尾或「学习联动」新分组内追加;`test_migrations.py` 的单 head 断言改为 `"0013"` | F2–F4 |
| `web/src/app.tsx`、`web/src/main.tsx`(仅 C;A、B 不改) | `main.tsx`:`import { App } from "./app";` 之前插入 `import "./plugins";`;`app.tsx`:导入块加 `routesFor`/`useLinkFlags`/`Slot`;`<Route element={<AppShell />}>` 改为 `<Route element={<><Slot point="appEffects" props={{}} /><AppShell /></>}>`,其内 `<Route path="/me" …/>` 之后插入 `{routes}`(`const routes = routesFor(useLinkFlags()).map(...)` 在 `AppRoutes` 顶部) | F7 |

## 本计划的裁定

- **P-L1** 事件通道选进程内有界队列 + 单消费任务(spec §4.1、L-R1);测试不跑 lifespan,一律 `await app.state.learning_bus.drain()`(`tests/links_helpers.drain`)。
- **P-L2** 发布只经 `app.core.learning_events.publish(event)`(contextvar,`current_user` 绑定);发布方不判断开关、不导入 `app.links`;发布语句一律在 `await session.commit()` 之后。
- **P-L3** `app/links/registry.py` 与 `web/src/plugins/index.ts` 在 F 里一次写全六个(网页五个 + core + links);车道只替换自己的桩文件,不改这两个列表。删除一个联动 = 删除列表里一行(Z2 用一次真实删除做验证,不提交)。
- **P-L4** 用户偏好缓存 30 秒;`PUT /api/links/prefs` 立即失效本进程缓存。
- **P-L5** 段位来源只吃剩余额度、子上限 5、不进阶段任务与活跃日(spec §5.4);`ledger.py` 只允许附加 L6-2 列出的四行与一行导入,`git diff` 审查。
- **P-L6** 每个联动的契约样例单独一个文件(`links_<key>_contract.json`),由该联动的测试录制(`CONTRACT_UPDATE=1` 重写),网页插件里的契约测试逐键核对;没有共享的录制脚本。
- **P-L7** 网页测试 `test/setup.ts` 只导入 `~/plugins/core`(核心贡献,= 全关);联动测试各自导入所需插件,并用 `setLinkFlags(...)` 打开;`afterEach` 统一 `setLinkFlags(ALL_OFF)`。
- **P-L8** 联动文案放插件目录 i18n(Global Constraints);feature 的 `register-*.tsx` 引用 `web.links.*` 键。
- **P-L9** 时间一律注入或取 `event.at`;测试不 sleep(唯一例外:通道超时用例等待 100 ms 的 `wait_for`)。
- **P-L10** 大模型用法检查不在通道处理器里等待(会阻塞单消费者):`chat_words` 用自己的 `JudgeRunner`(并发 2、待办 ≤ 50、单次 8 秒),满了直接按确定性结果入账(spec §6.5 的降级)。

---

## Task 0: 开工检查(执行者第一步)

- [ ] **Step 1** — 确认 A、B 已合并:`git fetch && git rebase origin/main`(或按团队流程把本分支 rebase 到含 A、B 的 main)。
- [ ] **Step 2** — Run: `cd server && uv run alembic heads` → 输出必须是 `0012 (head)`(A、B 不新增迁移)。不是 → 在本计划末尾写 Addendum 记录实际 head,按 INDEX §5 把本计划的迁移号顺延为「head + 1」(`down_revision` = 实际 head,文件名、`revision`、测试名 `test_00NN_…`、单 head 断言、spec §10 一起改),不得与已有号重复。
- [ ] **Step 3** — worktree 里按根 `CLAUDE.md` 把 `node_modules`(根与 `web/`、`admin/`)从主检出做 junction,不重新安装。
- [ ] **Step 4** — 基线:`cd server && uv run pytest -q`、`yarn web:typecheck && yarn web:test`、`cd admin && yarn vitest run` 全绿;记下 `yarn web:build` 的主包体积(验收比较用)。

---

## Foundation lane (F)

### Task F1: 核心学习事件通道 `app/core/learning_events.py`

**Files:**
- Create: `server/app/core/learning_events.py`、`server/tests/test_learning_events.py`
- Modify: `server/app/core/CLAUDE.md`(What lives here 加一行)

**Interfaces:**
- Produces: `WordAnswered(user_id, book_id, word, kind, qtype, outcome, credit, at, event_id)`、`WeakWord(word, score)`、`AssessmentFinished(user_id, assessment_id, source, score, weak_words, good_words, at, event_id)`、`MessageSent(user_id, conversation_id, message_id, text, at, event_id)`、`EVENT_TYPES`、`LearningBus(settings: Callable[[], Any], *, clock=time.monotonic)` 的 `subscribe(event_type, link, handler)`、`set_gate(gate)`、`links() -> tuple[str, ...]`、`publish(event) -> bool`、`async drain() -> int`、`async run()`、`count(link, name, n=1)`、`stats() -> dict[str, dict]`、`queue() -> dict`、`recent_errors() -> list[dict]`、`reset_breaker(link) -> bool`;模块函数 `bind(bus)`、`publish(event) -> bool`
- 设置读取(鸭子类型,F2 才加字段):`links_enabled`、`links_queue_max`、`links_handler_timeout_ms`、`links_breaker_failures`、`links_breaker_cooldown_seconds`

- [ ] **Step 1: 写失败测试** — `server/tests/test_learning_events.py`:

```python
import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.core import learning_events as le
from app.core.learning_events import AssessmentFinished, LearningBus, MessageSent, WeakWord, WordAnswered

AT = datetime(2026, 10, 11, 8, 0, tzinfo=timezone.utc)


def settings(**kw):
    base = dict(links_enabled=True, links_queue_max=1000, links_handler_timeout_ms=2000,
                links_breaker_failures=3, links_breaker_cooldown_seconds=60)
    return SimpleNamespace(**{**base, **kw})


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def answered(user_id=1, word="talk", outcome="wrong"):
    return WordAnswered(user_id=user_id, book_id="junior", word=word, kind="review", qtype="meaning",
                        outcome=outcome, credit=0, at=AT)


def make_bus(**kw):
    box = {"s": settings(**kw)}
    clock = Clock()
    return LearningBus(lambda: box["s"], clock=clock), box, clock


async def noop(event):
    return None


async def test_master_switch_off_publishes_nothing():
    bus, _, _ = make_bus(links_enabled=False)
    seen = []

    async def handler(e):
        seen.append(e)
    bus.subscribe(WordAnswered, "mistakes", handler)
    assert bus.publish(answered()) is False
    assert await bus.drain() == 0 and seen == []
    assert bus.stats()["mistakes"]["published"] == 0


async def test_events_without_subscribers_are_not_queued():
    bus, _, _ = make_bus()
    bus.subscribe(MessageSent, "chat_words", noop)
    assert bus.publish(answered()) is False
    assert bus.queue()["size"] == 0


def test_unknown_event_types_cannot_be_subscribed():
    bus, _, _ = make_bus()
    with pytest.raises(ValueError):
        bus.subscribe(dict, "x", noop)


async def test_order_and_isolation_between_links():
    bus, _, _ = make_bus()
    seen = []

    async def boom(e):
        raise RuntimeError(f"secret {e.word}")

    async def ok(e):
        seen.append(e.word)
    bus.subscribe(WordAnswered, "a", boom)
    bus.subscribe(WordAnswered, "b", ok)
    for w in ("one", "two"):
        assert bus.publish(answered(word=w)) is True
    assert await bus.drain() == 2
    assert seen == ["one", "two"]
    stats = bus.stats()
    assert (stats["a"]["failed"], stats["a"]["published"], stats["b"]["handled"]) == (2, 2, 2)
    first = bus.recent_errors()[0]
    assert {k: first[k] for k in ("link", "event", "error")} == {"link": "a", "event": "WordAnswered", "error": "RuntimeError"}
    assert set(first) == {"at", "link", "event", "error"}


async def test_timeout_is_counted_and_does_not_block_the_next_link():
    bus, _, _ = make_bus(links_handler_timeout_ms=100)
    seen = []

    async def slow(e):
        await asyncio.sleep(5)

    async def ok(e):
        seen.append(1)
    bus.subscribe(WordAnswered, "slow", slow)
    bus.subscribe(WordAnswered, "ok", ok)
    bus.publish(answered())
    await bus.drain()
    assert bus.stats()["slow"]["timeouts"] == 1 and seen == [1]


async def test_queue_limit_drops_counts_and_is_hot():
    bus, box, _ = make_bus(links_queue_max=2)
    bus.subscribe(WordAnswered, "m", noop)
    assert [bus.publish(answered()) for _ in range(3)] == [True, True, False]
    assert bus.queue() == {"size": 2, "max": 2, "dropped": 1}
    assert bus.stats()["m"]["dropped"] == 1
    box["s"] = settings(links_queue_max=5)
    assert bus.publish(answered()) is True


async def test_breaker_opens_cools_down_half_opens_and_closes():
    bus, _, clock = make_bus(links_breaker_failures=2, links_breaker_cooldown_seconds=60)
    calls, fail = [], {"on": True}

    async def handler(e):
        calls.append(1)
        if fail["on"]:
            raise ValueError()
    bus.subscribe(WordAnswered, "m", handler)
    for _ in range(3):
        bus.publish(answered())
    await bus.drain()
    s = bus.stats()["m"]
    assert (len(calls), s["failed"], s["breaker_skipped"], s["breaker"], s["breaker_opens"]) == (2, 2, 1, "open", 1)
    clock.t += 61
    assert bus.stats()["m"]["breaker"] == "half_open"
    bus.publish(answered())
    await bus.drain()  # a failure while half-open reopens at once
    assert (bus.stats()["m"]["breaker"], bus.stats()["m"]["breaker_opens"]) == ("open", 2)
    clock.t += 61
    fail["on"] = False
    bus.publish(answered())
    await bus.drain()
    assert (bus.stats()["m"]["breaker"], bus.stats()["m"]["handled"]) == ("closed", 1)


async def test_reset_breaker():
    bus, _, _ = make_bus(links_breaker_failures=1)

    async def boom(e):
        raise ValueError()
    bus.subscribe(WordAnswered, "m", boom)
    bus.publish(answered())
    await bus.drain()
    assert bus.stats()["m"]["breaker"] == "open"
    assert bus.reset_breaker("m") is True and bus.stats()["m"]["breaker"] == "closed"
    assert bus.reset_breaker("nope") is False


async def test_gate_skips_per_link_and_user_and_a_broken_gate_is_a_failure():
    bus, _, _ = make_bus()
    seen = []

    async def handler(e):
        seen.append(e.user_id)

    async def gate(link, user_id):
        if user_id == 3:
            raise RuntimeError("db down")
        return user_id != 2
    bus.subscribe(WordAnswered, "m", handler)
    bus.set_gate(gate)
    for uid in (1, 2, 3):
        bus.publish(answered(user_id=uid))
    await bus.drain()
    s = bus.stats()["m"]
    assert seen == [1] and (s["skipped"], s["failed"]) == (1, 1)


async def test_extra_counters():
    bus, _, _ = make_bus()
    bus.subscribe(MessageSent, "chat_words", noop)
    bus.count("chat_words", "llm_degraded")
    bus.count("chat_words", "llm_degraded", 2)
    assert bus.stats()["chat_words"]["extra"] == {"llm_degraded": 3}


async def test_module_publish_needs_a_bound_bus_and_bindings_do_not_leak():
    bus, _, _ = make_bus()
    bus.subscribe(MessageSent, "c", noop)
    ev = MessageSent(user_id=1, conversation_id="c1", message_id="m1", text="hello", at=AT)

    async def unbound():
        return le.publish(ev)

    async def bound():
        le.bind(bus)
        return le.publish(ev)
    assert await asyncio.create_task(unbound()) is False
    assert await asyncio.create_task(bound()) is True
    assert await asyncio.create_task(unbound()) is False


async def test_publish_never_raises():
    bus, _, _ = make_bus()

    def broken():
        raise RuntimeError("settings exploded")
    bus._settings = broken

    async def run():
        le.bind(bus)
        return le.publish(answered())
    assert await asyncio.create_task(run()) is False


def test_fields_are_truncated_and_text_is_not_in_repr():
    ev = MessageSent(user_id=1, conversation_id="c", message_id="m", text="x" * 5000, at=AT)
    assert len(ev.text) == 4000 and "xxxx" not in repr(ev)
    a = AssessmentFinished(user_id=1, assessment_id="a", source="practice", score=50,
                           weak_words=[WeakWord(f"w{i}", 10) for i in range(40)],
                           good_words=[f"g{i}" for i in range(70)], at=AT)
    assert (len(a.weak_words), len(a.good_words)) == (32, 64)
    assert isinstance(a.weak_words, tuple) and isinstance(a.good_words, tuple)
    assert len(answered(word="y" * 300).word) == 100 and len(answered().event_id) == 32


async def test_failures_never_log_text_words_or_messages(caplog):
    bus, _, _ = make_bus()

    async def boom(e):
        raise RuntimeError(f"bad {e.text}")
    bus.subscribe(MessageSent, "c", boom)
    bus.publish(MessageSent(user_id=7, conversation_id="c", message_id="m", text="my secret sentence", at=AT))
    with caplog.at_level("WARNING", logger="app.core.learning_events"):
        await bus.drain()
    assert "links failure link=c event=MessageSent error=RuntimeError" in caplog.text
    assert "secret" not in caplog.text and "bad" not in caplog.text
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_learning_events.py` → FAIL(`ModuleNotFoundError: app.core.learning_events`)

- [ ] **Step 3: 实现** — `server/app/core/learning_events.py`:

```python
"""学习事件通道(spec 2026-10-11-learning-links §4):进程内、有界、尽力而为。

发布方在提交之后调用 `publish(event)`,不知道谁在听;订阅方(`app/links`)在启动时 `subscribe`。
只依赖标准库(核心层)。日志只记联动键、事件类名、异常类名;永不记录词、文本、异常消息或用户 id。"""
import asyncio
import logging
import time
import uuid
from collections import deque
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

MAX_WORD = 100
MAX_TEXT = 4000
MAX_WEAK = 32
MAX_GOOD = 64
MAX_ERRORS = 50


def _event_id() -> str:
    return uuid.uuid4().hex


def _set(obj: object, name: str, value: object) -> None:
    object.__setattr__(obj, name, value)


@dataclass(frozen=True)
class WordAnswered:
    """背单词写入一行 wordbook_events(spell_set 除外)。kind ∈ learn|review|practice|blank。"""
    user_id: int
    book_id: str
    word: str
    kind: str
    qtype: str | None
    outcome: str
    credit: int
    at: datetime
    event_id: str = field(default_factory=_event_id)

    def __post_init__(self) -> None:
        _set(self, "word", self.word[:MAX_WORD])


@dataclass(frozen=True)
class WeakWord:
    word: str
    score: int | None


@dataclass(frozen=True)
class AssessmentFinished:
    """一次已保存的发音评测。SentencePracticed = source == "practice"(spec L-R2)。"""
    user_id: int
    assessment_id: str
    source: str
    score: int | None
    weak_words: tuple[WeakWord, ...]
    good_words: tuple[str, ...]
    at: datetime
    event_id: str = field(default_factory=_event_id)

    def __post_init__(self) -> None:
        _set(self, "weak_words", tuple(self.weak_words)[:MAX_WEAK])
        _set(self, "good_words", tuple(self.good_words)[:MAX_GOOD])


@dataclass(frozen=True)
class MessageSent:
    """用户在 AI 对话里发出的一条消息。text 只在内存里交给订阅者,任何地方都不记录、不入库。"""
    user_id: int
    conversation_id: str
    message_id: str
    text: str = field(repr=False)
    at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    event_id: str = field(default_factory=_event_id)

    def __post_init__(self) -> None:
        _set(self, "text", self.text[:MAX_TEXT])


EVENT_TYPES: tuple[type, ...] = (WordAnswered, AssessmentFinished, MessageSent)
Handler = Callable[[Any], Awaitable[None]]
Gate = Callable[[str, int], Awaitable[bool]]
_COUNTERS = ("published", "handled", "skipped", "failed", "timeouts", "dropped", "breaker_skipped", "breaker_opens",
             "last_ms")


@dataclass
class _Stats:
    published: int = 0
    handled: int = 0
    skipped: int = 0
    failed: int = 0
    timeouts: int = 0
    dropped: int = 0
    breaker_skipped: int = 0
    breaker_opens: int = 0
    last_ms: int = 0
    consecutive: int = 0
    open_until: float = 0.0
    half_open: bool = False
    extra: dict[str, int] = field(default_factory=dict)


def _int(settings: Any, name: str, default: int) -> int:
    try:
        return int(getattr(settings, name, default))
    except (TypeError, ValueError):
        return default


class LearningBus:
    def __init__(self, settings: Callable[[], Any], *, clock: Callable[[], float] = time.monotonic) -> None:
        self._settings = settings
        self._clock = clock
        self._subs: dict[type, list[tuple[str, Handler]]] = {}
        self._stats: dict[str, _Stats] = {}
        self._queue: deque = deque()
        self._wake = asyncio.Event()
        self._gate: Gate | None = None
        self._errors: deque = deque(maxlen=MAX_ERRORS)
        self._dropped = 0

    # ---- wiring ----
    def subscribe(self, event_type: type, link: str, handler: Handler) -> None:
        if event_type not in EVENT_TYPES:
            raise ValueError(f"unknown event type {getattr(event_type, '__name__', event_type)}")
        self._subs.setdefault(event_type, []).append((link, handler))
        self._stats.setdefault(link, _Stats())

    def set_gate(self, gate: Gate | None) -> None:
        self._gate = gate

    def links(self) -> tuple[str, ...]:
        return tuple(self._stats)

    # ---- publishing ----
    def publish(self, event: Any) -> bool:
        settings = self._settings()
        if not getattr(settings, "links_enabled", False):
            return False
        subs = self._subs.get(type(event))
        if not subs:
            return False
        if len(self._queue) >= max(1, _int(settings, "links_queue_max", 1000)):
            self._dropped += 1
            for link, _ in subs:
                self._stats[link].dropped += 1
            return False
        for link, _ in subs:
            self._stats[link].published += 1
        self._queue.append(event)
        self._wake.set()
        return True

    # ---- consuming ----
    async def drain(self) -> int:
        done = 0
        while self._queue:
            await self._dispatch(self._queue.popleft())
            done += 1
        return done

    async def run(self) -> None:
        while True:
            if not self._queue:
                self._wake.clear()
                await self._wake.wait()
            await self.drain()

    async def _dispatch(self, event: Any) -> None:
        settings = self._settings()
        timeout = max(0.1, _int(settings, "links_handler_timeout_ms", 2000) / 1000)
        for link, handler in list(self._subs.get(type(event), ())):
            st = self._stats[link]
            if st.open_until:
                if self._clock() < st.open_until:
                    st.breaker_skipped += 1
                    continue
                st.open_until, st.half_open = 0.0, True
            started = self._clock()
            try:
                if self._gate is not None and not await self._gate(link, event.user_id):
                    st.skipped += 1
                    continue
                await asyncio.wait_for(handler(event), timeout)
            except TimeoutError:
                st.timeouts += 1
                self._failure(link, st, event, "TimeoutError", settings)
            except Exception as exc:  # noqa: BLE001 - a link must never break the bus or the next link
                st.failed += 1
                self._failure(link, st, event, type(exc).__name__, settings)
            else:
                st.handled += 1
                st.consecutive, st.half_open = 0, False
            finally:
                st.last_ms = int((self._clock() - started) * 1000)

    def _failure(self, link: str, st: _Stats, event: Any, error: str, settings: Any) -> None:
        st.consecutive += 1
        if st.half_open or st.consecutive >= max(1, _int(settings, "links_breaker_failures", 5)):
            st.open_until = self._clock() + max(1, _int(settings, "links_breaker_cooldown_seconds", 60))
            st.consecutive, st.half_open = 0, False
            st.breaker_opens += 1
        name = type(event).__name__
        self._errors.append({"at": datetime.now(timezone.utc).isoformat(), "link": link, "event": name, "error": error})
        logger.warning("links failure link=%s event=%s error=%s", link, name, error)

    # ---- observability ----
    def count(self, link: str, name: str, n: int = 1) -> None:
        st = self._stats.setdefault(link, _Stats())
        st.extra[name] = st.extra.get(name, 0) + n

    def stats(self) -> dict[str, dict]:
        now = self._clock()
        out: dict[str, dict] = {}
        for link, st in self._stats.items():
            if st.open_until and now < st.open_until:
                state, left = "open", max(0, round(st.open_until - now))
            elif st.open_until or st.half_open:
                state, left = "half_open", 0
            else:
                state, left = "closed", 0
            out[link] = {**{k: getattr(st, k) for k in _COUNTERS}, "breaker": state, "open_seconds": left,
                         "extra": dict(st.extra)}
        return out

    def queue(self) -> dict:
        return {"size": len(self._queue), "max": max(1, _int(self._settings(), "links_queue_max", 1000)),
                "dropped": self._dropped}

    def recent_errors(self) -> list[dict]:
        return list(reversed(self._errors))

    def reset_breaker(self, link: str) -> bool:
        st = self._stats.get(link)
        if st is None:
            return False
        st.open_until, st.consecutive, st.half_open = 0.0, 0, False
        return True


_current: ContextVar[LearningBus | None] = ContextVar("learning_bus", default=None)


def bind(bus: LearningBus | None) -> None:
    """current_user 依赖里调用(同 metering.bind_user);只影响当前请求的上下文。"""
    _current.set(bus)


def publish(event: Any) -> bool:
    """提交之后调用。未绑定、总开关关、无订阅、队列满 → False;永不抛错。"""
    bus = _current.get()
    if bus is None:
        return False
    try:
        return bus.publish(event)
    except Exception as exc:  # noqa: BLE001 - publishing must never fail the request
        logger.warning("links publish failed error=%s", type(exc).__name__)
        return False
```

(`MessageSent.at` 带默认值只是为了让数据类字段顺序合法;三个发布点都显式传 `at`。)

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_learning_events.py tests/test_architecture.py` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/app/core/learning_events.py server/app/core/CLAUDE.md server/tests/test_learning_events.py
git commit -m "feat(server): in-process learning event channel in the core layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task F2: 段位来源注册表与「学习联动」设置

**Files:**
- Create: `server/app/core/rank_sources.py`、`server/tests/test_rank_sources.py`
- Modify: `server/app/core/config.py`(追加 15 个字段)、`server/app/core/settings_registry.py`(`GROUPS` 在 `("wordbook", "背单词")` 之后加 `("links", "学习联动")`;追加 15 条 spec)、`server/.env.example`(追加「学习联动」一节,全部注释掉的默认值)、`server/tests/test_settings_registry.py`(追加一个测试)、`server/app/core/CLAUDE.md`

**Interfaces:**
- Produces(`app.core.rank_sources`):`RankSource(kind, default_points, label_zh, label_en)`、`RESERVED_KINDS`、`register(source)`、`registered() -> tuple[RankSource, ...]`、`kinds() -> frozenset[str]`、`get(kind) -> RankSource | None`、`clear_for_tests()`
- Produces(`Settings`):`links_enabled`、`link_word_actions_enabled`、`link_daily_tasks_enabled`、`link_mistakes_enabled`、`link_pron_shadow_enabled`、`link_chat_words_enabled`、`link_rank_sources_enabled`、`links_queue_max`、`links_handler_timeout_ms`、`links_breaker_failures`、`links_breaker_cooldown_seconds`、`links_retention_days`、`link_chat_words_daily_max`、`link_chat_words_llm_enabled`、`link_chat_words_llm_global_daily`

- [ ] **Step 1: 写失败测试** — `server/tests/test_rank_sources.py`:

```python
import pytest

from app.core import rank_sources
from app.core.rank_sources import RankSource

SRC = RankSource(kind="word_in_chat", default_points=1, label_zh="对话用到新词", label_en="New word used in chat")


@pytest.fixture(autouse=True)
def clean():
    saved = rank_sources.registered()
    rank_sources.clear_for_tests()
    yield
    rank_sources.clear_for_tests()
    for s in saved:
        rank_sources.register(s)


def test_register_is_idempotent_for_the_same_source():
    rank_sources.register(SRC)
    rank_sources.register(SRC)
    assert rank_sources.registered() == (SRC,) and rank_sources.kinds() == frozenset({"word_in_chat"})
    assert rank_sources.get("word_in_chat") is SRC and rank_sources.get("nope") is None


def test_conflicting_or_reserved_or_malformed_kinds_are_refused():
    rank_sources.register(SRC)
    with pytest.raises(ValueError):
        rank_sources.register(RankSource("word_in_chat", 2, "x", "x"))
    for kind in ("chat_turn", "word_learned", "spelling_set", "stage_task", "Bad-Kind", "a" * 17, ""):
        with pytest.raises(ValueError):
            rank_sources.register(RankSource(kind, 1, "x", "x"))
    with pytest.raises(ValueError):
        rank_sources.register(RankSource("ok_kind", 101, "x", "x"))


def test_reserved_kinds_cover_every_existing_rank_kind():
    from app.rank.points import CAPPED, POINTS
    assert set(CAPPED) | set(POINTS) | {"assessment", "voice_turn"} <= rank_sources.RESERVED_KINDS
```

`server/tests/test_settings_registry.py` 末尾追加:

```python
def test_learning_links_settings():
    from app.core.config import Settings
    s = Settings(_env_file=None)
    assert s.links_enabled is False
    flags = [k for k in Settings.model_fields if k.startswith("link_") and k.endswith("_enabled")]
    assert sorted(flags) == sorted(["link_word_actions_enabled", "link_daily_tasks_enabled", "link_mistakes_enabled",
                                    "link_pron_shadow_enabled", "link_chat_words_enabled", "link_rank_sources_enabled",
                                    "link_chat_words_llm_enabled"])
    assert all(getattr(s, k) is (k != "link_chat_words_llm_enabled") for k in flags)
    links = {k for k, spec in SPECS.items() if spec.group == "links"}
    assert links == {k for k in Settings.model_fields if k.startswith(("links_", "link_"))}
    assert all(SPECS[k].apply == "hot" for k in links)
    assert SPECS["link_chat_words_llm_enabled"].danger and SPECS["link_chat_words_llm_global_daily"].danger
    assert (s.links_queue_max, s.links_handler_timeout_ms, s.links_breaker_failures,
            s.links_breaker_cooldown_seconds, s.links_retention_days, s.link_chat_words_daily_max,
            s.link_chat_words_llm_global_daily) == (1000, 2000, 5, 60, 90, 10, 200)
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rank_sources.py tests/test_settings_registry.py` → FAIL

- [ ] **Step 3: 实现**

`server/app/core/rank_sources.py`:

```python
"""段位点来源注册表(spec 2026-10-11-learning-links §5.1)。联动在启动时登记新来源;段位经 app.models.LinkCredit 读。

只依赖标准库。进程级注册表:同一内容重复登记是空操作(测试里会多次 create_app)。"""
import re
from dataclasses import dataclass

RESERVED_KINDS = frozenset({"assessment", "voice_turn", "chat_turn", "vocab_review", "active_day", "streak_7",
                            "stage_task", "word_learned", "spelling_set"})
_KIND = re.compile(r"^[a-z_]{1,16}$")


@dataclass(frozen=True)
class RankSource:
    kind: str
    default_points: int
    label_zh: str
    label_en: str


_sources: dict[str, RankSource] = {}


def register(source: RankSource) -> None:
    if not _KIND.fullmatch(source.kind) or source.kind in RESERVED_KINDS:
        raise ValueError(f"invalid rank source kind {source.kind!r}")
    if not 0 <= source.default_points <= 100:
        raise ValueError("default_points must be 0..100")
    existing = _sources.get(source.kind)
    if existing is not None and existing != source:
        raise ValueError(f"rank source {source.kind!r} already registered differently")
    _sources[source.kind] = source


def registered() -> tuple[RankSource, ...]:
    return tuple(_sources.values())


def kinds() -> frozenset[str]:
    return frozenset(_sources)


def get(kind: str) -> RankSource | None:
    return _sources.get(kind)


def clear_for_tests() -> None:
    _sources.clear()
```

`server/app/core/config.py`,在 wordbook 字段块之后追加——锚点是背单词段最后一行 `wordbook_data_dir: str = ""`(A 的 4 个 `wordbook_*` 字段与 B 的 6 个范围字段都在它之前;沿用文件里 `Field(默认, ge=, le=)` 的写法):

```python
    # 学习联动(spec 2026-10-11-learning-links §7.1);总开关关 = 与未安装联动完全相同
    links_enabled: bool = False
    link_word_actions_enabled: bool = True
    link_daily_tasks_enabled: bool = True
    link_mistakes_enabled: bool = True
    link_pron_shadow_enabled: bool = True
    link_chat_words_enabled: bool = True
    link_rank_sources_enabled: bool = True
    links_queue_max: int = Field(1000, ge=10, le=10000)
    links_handler_timeout_ms: int = Field(2000, ge=100, le=10000)
    links_breaker_failures: int = Field(5, ge=1, le=100)
    links_breaker_cooldown_seconds: int = Field(60, ge=5, le=3600)
    links_retention_days: int = Field(90, ge=7, le=365)
    link_chat_words_daily_max: int = Field(10, ge=1, le=50)
    link_chat_words_llm_enabled: bool = False
    link_chat_words_llm_global_daily: int = Field(200, ge=0, le=10000)
```

`server/app/core/settings_registry.py`,`_ALL` 末尾追加:

```python
    # 学习联动(设计文档 2026-10-11-learning-links §7.1)
    _s("links_enabled", "links", "bool", "学习联动总开关", help_zh="关闭 = 与未安装联动完全相同;各联动另有开关"),
    _s("link_word_actions_enabled", "links", "bool", "单词操作位置", help_zh="生词本按钮旁的「更多」菜单"),
    _s("link_daily_tasks_enabled", "links", "bool", "今日任务聚合卡"),
    _s("link_mistakes_enabled", "links", "bool", "易错词", help_zh="背单词答错的词进生词本「易错词」视图"),
    _s("link_pron_shadow_enabled", "links", "bool", "发音弱词与跟读"),
    _s("link_chat_words_enabled", "links", "bool", "对话用到今日词"),
    _s("link_rank_sources_enabled", "links", "bool", "联动段位点",
       danger="打开后联动可以给段位加点(每日最多段位规则里的 sources_daily_cap)"),
    _s("links_queue_max", "links", "int", "事件队列上限", help_zh="满了丢弃并计数"),
    _s("links_handler_timeout_ms", "links", "int", "单个处理器超时(毫秒)"),
    _s("links_breaker_failures", "links", "int", "熔断连续失败次数"),
    _s("links_breaker_cooldown_seconds", "links", "int", "熔断冷却(秒)"),
    _s("links_retention_days", "links", "int", "联动记录保留天数"),
    _s("link_chat_words_daily_max", "links", "int", "每人每日最多记录今日词"),
    _s("link_chat_words_llm_enabled", "links", "bool", "今日词大模型用法检查", danger=_COST),
    _s("link_chat_words_llm_global_daily", "links", "int", "用法检查全站每日次数", danger=_COST),
```

`server/.env.example` 末尾追加「# ---- 学习联动(spec 2026-10-11-learning-links)----」一节,每个键一行 `# KEY=默认值`,并写明「都在设置注册表里,可在管理端「设置 → 学习联动」热改(写审计)」。

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_rank_sources.py tests/test_settings_registry.py tests/test_config.py tests/test_runtime_settings.py tests/test_architecture.py` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/app/core/rank_sources.py server/app/core/config.py server/app/core/settings_registry.py server/app/core/CLAUDE.md server/.env.example server/tests/test_rank_sources.py server/tests/test_settings_registry.py
git commit -m "feat(server): rank source registry and learning-link settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task F3: 迁移 0013、模型、删除用户时清理

**Files:**
- Create: `server/alembic/versions/0013_learning_links.py`、`server/tests/test_links_models.py`
- Modify: `server/app/models.py`(末尾追加五个模型)、`server/tests/test_migrations.py`(追加 0013 往返测试;单 head 断言改 `"0013"`)、`server/app/admin/users_admin.py`(删除循环之后追加一个循环与一行导入)

**Interfaces:**
- Produces(`app.models`):`UserLinkPref`、`LinkMistakeWord`、`LinkWeakWord`、`LinkWordUse`、`LinkCredit`(字段见 spec §10)
- Consumes:Task 0 确认的 head `0012`

- [ ] **Step 1: 写失败测试**

`server/tests/test_migrations.py` 末尾追加:

```python
LINK_TABLES = {"user_link_prefs", "link_mistake_words", "link_weak_words", "link_word_uses", "link_credits"}


def test_0013_learning_links_tables_round_trip(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    assert ScriptDirectory.from_config(cfg).get_heads() == ["0013"]
    command.upgrade(cfg, "0012")
    assert not LINK_TABLES & _tables(db)
    command.upgrade(cfg, "0013")
    assert LINK_TABLES <= _tables(db)
    con = sqlite3.connect(db)
    try:
        pk = [r[1] for r in sorted(con.execute("pragma table_info(link_mistake_words)"), key=lambda r: r[5]) if r[5]]
        credit_idx = {r[1] for r in con.execute("pragma index_list(link_credits)")}
        uses_idx = {r[1] for r in con.execute("pragma index_list(link_word_uses)")}
        con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'x', '2026-10-11')")
        con.execute("insert into link_credits (user_id, kind, ref_id, created_at) values (12345678, 'word_in_chat', 'wic:1', '2026-10-11')")
        con.commit()
    finally:
        con.close()
    assert pk == ["user_id", "word"]
    assert "ix_link_credits_user_id_created_at" in credit_idx and "ix_link_word_uses_user_id_created_at" in uses_idx
    command.downgrade(cfg, "0012")
    assert not LINK_TABLES & _tables(db)
    command.upgrade(cfg, "head")
    assert LINK_TABLES <= _tables(db)
```

并把文件里已有的单 head 断言(在 `test_0011_…` 里,当前为 `["0012"]`;A、B 不新增迁移,不会改它)改为 `["0013"]`。

`server/tests/test_links_models.py`:

```python
import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models import LinkCredit, LinkMistakeWord, LinkWeakWord, LinkWordUse, UserLinkPref, utcnow
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as
from tests.test_admin_api import register

MODELS = (UserLinkPref, LinkMistakeWord, LinkWeakWord, LinkWordUse, LinkCredit)


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "data")}


async def seed(app, uid):
    now = utcnow()
    async with app.state.sessionmaker() as s:
        s.add(UserLinkPref(user_id=uid, link_key="mistakes", enabled=False, updated_at=now))
        s.add(LinkMistakeWord(user_id=uid, word="talk", book_id="junior", wrong_count=1, ok_streak=0,
                              last_event_at=now, last_wrong_at=now, cleared_at=None))
        s.add(LinkWeakWord(user_id=uid, word="three", hits=1, last_score=40, ok_streak=0, last_event_at=now,
                           last_weak_at=now, cleared_at=None))
        s.add(LinkWordUse(user_id=uid, word="talk", learn_event_id=1, message_id="m1", created_at=now))
        s.add(LinkCredit(user_id=uid, kind="word_in_chat", ref_id="wic:1", score=None, created_at=now))
        await s.commit()


async def test_credit_and_use_uniqueness(app, client):
    uid, _ = await register(client, "alice")
    await seed(app, uid)
    async with app.state.sessionmaker() as s:
        s.add(LinkCredit(user_id=uid, kind="word_in_chat", ref_id="wic:1", score=None, created_at=utcnow()))
        with pytest.raises(IntegrityError):
            await s.commit()
    async with app.state.sessionmaker() as s:
        s.add(LinkWordUse(user_id=uid, word="talk", learn_event_id=1, message_id="m2", created_at=utcnow()))
        with pytest.raises(IntegrityError):
            await s.commit()


async def test_deleting_a_user_deletes_their_link_rows(app, client):
    uid, _ = await register(client, "dora")
    await seed(app, uid)
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=h,
                             json={"confirm_username": "dora", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        for model in MODELS:
            assert await s.scalar(select(func.count()).select_from(model).where(model.user_id == uid)) == 0, model
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_migrations.py tests/test_links_models.py` → FAIL

- [ ] **Step 3: 实现**

`server/app/models.py` 末尾追加:

```python
# ---- 学习联动(设计文档 2026-10-11-learning-links §10)----

class UserLinkPref(Base):
    """每用户联动开关;没有行 = 开。"""
    __tablename__ = "user_link_prefs"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    link_key: Mapped[str] = mapped_column(String(24), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LinkMistakeWord(Base):
    """易错词(虚拟视图的状态;不复制 vocabulary_items)。"""
    __tablename__ = "link_mistake_words"
    __table_args__ = (Index("ix_link_mistake_words_user_id_cleared_at", "user_id", "cleared_at"),)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    word: Mapped[str] = mapped_column(String(100), primary_key=True)
    book_id: Mapped[str] = mapped_column(String(16))
    wrong_count: Mapped[int] = mapped_column(Integer, default=0)
    ok_streak: Mapped[int] = mapped_column(Integer, default=0)
    last_event_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_wrong_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    cleared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LinkWeakWord(Base):
    """发音弱词。"""
    __tablename__ = "link_weak_words"
    __table_args__ = (Index("ix_link_weak_words_user_id_cleared_at", "user_id", "cleared_at"),)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    word: Mapped[str] = mapped_column(String(100), primary_key=True)
    hits: Mapped[int] = mapped_column(Integer, default=0)
    last_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ok_streak: Mapped[int] = mapped_column(Integer, default=0)
    last_event_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_weak_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    cleared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LinkWordUse(Base):
    """对话里用到今日词:每个 learn 事件只记第一次;不存消息正文。"""
    __tablename__ = "link_word_uses"
    __table_args__ = (
        UniqueConstraint("user_id", "learn_event_id", name="uq_link_word_uses_user_learn"),
        Index("ix_link_word_uses_user_id_created_at", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    word: Mapped[str] = mapped_column(String(100))
    learn_event_id: Mapped[int] = mapped_column(Integer)
    message_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class LinkCredit(Base):
    """联动登记的段位点来源事实;段位经本模型读取(不导入 app.links)。"""
    __tablename__ = "link_credits"
    __table_args__ = (
        UniqueConstraint("user_id", "kind", "ref_id", name="uq_link_credits_user_kind_ref"),
        Index("ix_link_credits_user_id_created_at", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))
    ref_id: Mapped[str] = mapped_column(String(80))
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
```

`server/alembic/versions/0013_learning_links.py`:

```python
"""learning links tables (spec 2026-10-11-learning-links §10)

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-11 10:00:00.000000

New tables only (no ALTER on existing tables), so the same path is safe on SQLite and Postgres.
`alembic heads` before this migration: 0012 (head) — plans A (wordbook recall) and B (wordbook goals) add no migration;
merge order A -> B -> C (this). If A or B ever adds one, renumber this file to head + 1 (INDEX 2026-10-11 §5).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0013'
down_revision: Union[str, Sequence[str], None] = '0012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)


def _user(primary_key: bool = False) -> sa.Column:
    return sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=primary_key,
                     nullable=False)


def upgrade() -> None:
    op.create_table(
        'user_link_prefs',
        _user(primary_key=True),
        sa.Column('link_key', sa.String(24), primary_key=True),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
    )
    op.create_table(
        'link_mistake_words',
        _user(primary_key=True),
        sa.Column('word', sa.String(100), primary_key=True),
        sa.Column('book_id', sa.String(16), nullable=False),
        sa.Column('wrong_count', sa.Integer(), nullable=False),
        sa.Column('ok_streak', sa.Integer(), nullable=False),
        sa.Column('last_event_at', TZ, nullable=False),
        sa.Column('last_wrong_at', TZ, nullable=False),
        sa.Column('cleared_at', TZ, nullable=True),
    )
    op.create_index('ix_link_mistake_words_user_id_cleared_at', 'link_mistake_words', ['user_id', 'cleared_at'])
    op.create_table(
        'link_weak_words',
        _user(primary_key=True),
        sa.Column('word', sa.String(100), primary_key=True),
        sa.Column('hits', sa.Integer(), nullable=False),
        sa.Column('last_score', sa.Integer(), nullable=True),
        sa.Column('ok_streak', sa.Integer(), nullable=False),
        sa.Column('last_event_at', TZ, nullable=False),
        sa.Column('last_weak_at', TZ, nullable=False),
        sa.Column('cleared_at', TZ, nullable=True),
    )
    op.create_index('ix_link_weak_words_user_id_cleared_at', 'link_weak_words', ['user_id', 'cleared_at'])
    op.create_table(
        'link_word_uses',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        _user(),
        sa.Column('word', sa.String(100), nullable=False),
        sa.Column('learn_event_id', sa.Integer(), nullable=False),
        sa.Column('message_id', sa.String(36), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.UniqueConstraint('user_id', 'learn_event_id', name='uq_link_word_uses_user_learn'),
    )
    op.create_index('ix_link_word_uses_user_id_created_at', 'link_word_uses', ['user_id', 'created_at'])
    op.create_table(
        'link_credits',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        _user(),
        sa.Column('kind', sa.String(16), nullable=False),
        sa.Column('ref_id', sa.String(80), nullable=False),
        sa.Column('score', sa.Integer(), nullable=True),
        sa.Column('created_at', TZ, nullable=False),
        sa.UniqueConstraint('user_id', 'kind', 'ref_id', name='uq_link_credits_user_kind_ref'),
    )
    op.create_index('ix_link_credits_user_id_created_at', 'link_credits', ['user_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_link_credits_user_id_created_at', table_name='link_credits')
    op.drop_table('link_credits')
    op.drop_index('ix_link_word_uses_user_id_created_at', table_name='link_word_uses')
    op.drop_table('link_word_uses')
    op.drop_index('ix_link_weak_words_user_id_cleared_at', table_name='link_weak_words')
    op.drop_table('link_weak_words')
    op.drop_index('ix_link_mistake_words_user_id_cleared_at', table_name='link_mistake_words')
    op.drop_table('link_mistake_words')
    op.drop_table('user_link_prefs')
```

`server/app/admin/users_admin.py`:`from app.models import (…)` 块末尾追加 `LinkCredit, LinkMistakeWord, LinkWeakWord, LinkWordUse, UserLinkPref`(新起一行);既有的 `for model in (Conversation, …): await session.execute(delete(model)…)` 循环**之后**新增:

```python
    for model in (UserLinkPref, LinkMistakeWord, LinkWeakWord, LinkWordUse, LinkCredit):  # learning links (SQLite: no FK cascade)
        await session.execute(delete(model).where(model.user_id == user_id))
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_migrations.py tests/test_links_models.py tests/test_admin_users.py tests/test_architecture.py` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/alembic/versions/0013_learning_links.py server/app/models.py server/app/admin/users_admin.py server/tests/test_migrations.py server/tests/test_links_models.py
git commit -m "feat(server): migration 0013 learning-link tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task F4: `app/links/` 顶层、开关闸门、每用户偏好、配置接口、接线与架构测试

**Files:**
- Create: `server/app/links/{__init__,spec,gate,prefs,registry,setup,purge}.py`、`server/app/links/CLAUDE.md`、六个联动桩 `server/app/links/{word_actions,daily_tasks,mistakes,pron_shadow,chat_words,rank_sources}.py`、`server/app/routers/links.py`、`server/tests/links_helpers.py`、`server/tests/test_links_gate.py`、`server/tests/test_links_api.py`
- Modify: `server/app/main.py`、`server/app/core/deps.py`(一行)、`server/tests/test_architecture.py`、`server/app/CLAUDE.md`、`server/app/routers/CLAUDE.md`

**Interfaces:**
- Produces(`app.links.spec`):`LINK_KEYS: tuple[str, ...]`(顺序 `word_actions, daily_tasks, mistakes, pron_shadow, chat_words, rank_sources`)、`flag_of(key) -> str`、`LinkSpec(key, label_zh, label_en, install=None, router=None)`、`WordIn`(pydantic,`word` 经 `validate_word`)
- Produces(`app.links.gate`):`LinkGate(app, *, clock=time.monotonic)`,`await gate(link, user_id) -> bool`、`await gate.prefs(user_id) -> dict[str, bool]`、`gate.invalidate(user_id)`;`require_link(key, *, limited=False)` → FastAPI 依赖,返回 `User`,无效时 404 `Link is off`
- Produces(`app.links.prefs`):`load(session, user_id) -> dict[str, bool]`、`save(session, user_id, key, enabled, now) -> None`(提交)
- Produces(`app.links.registry`):`LINKS: tuple[LinkSpec, ...]`、`keys() -> tuple[str, ...]`
- Produces(`app.links.setup`):`install(app) -> None`(gate + 每个 `spec.install(app, bus)`)、`config_out(app, session, user_id) -> dict`
- Produces(`app.links.purge`):`purge(session, now, retention_days) -> dict[str, int]`、`daily_loop(app, interval=21600.0)`
- Produces(HTTP):`GET /api/links/config`、`PUT /api/links/prefs`(spec §7.2);`routers/links.py` 还 `include_router` 每个 `spec.router`
- Produces(`tests/links_helpers.py`):`enable_links(app, **overrides)`、`drain(app) -> int`、`check_contract(name, actual)`、`user_id_of(client, headers) -> int`
- Produces(`app.state`):`learning_bus: LearningBus`、`link_gate: LinkGate`;`background_tasks["links"]`、`["links_purge"]`

- [ ] **Step 1: 写失败测试**

`server/tests/test_architecture.py`:`LAYERS` 在 `"admin"` 前加 `"links"`;`ALLOWED` 加
`"links": {"links", "core", "models", "providers", "speech", "services", "rank", "rooms", "wordbook"}`,`"routers"` 与 `"main"` 的集合各加 `"links"`;文件头说明加一行 `links -> core, providers, speech, services, rank, rooms, wordbook (top layer: only routers and main import it)`。末尾追加:

```python
def test_links_is_a_top_layer(tmp_path):
    app = tmp_path / "app"
    for pkg in ("links", "rank", "admin", "wordbook", "services", "routers", "realtime", "core"):
        (app / pkg).mkdir(parents=True)
        (app / pkg / "__init__.py").write_text("", encoding="utf-8")
    (app / "__init__.py").write_text("", encoding="utf-8")
    (app / "rank" / "a.py").write_text("from app.links import mistakes\n", encoding="utf-8")
    (app / "admin" / "b.py").write_text("def f():\n    from app.links import gate\n", encoding="utf-8")
    (app / "wordbook" / "c.py").write_text("from app import links\n", encoding="utf-8")
    (app / "services" / "d.py").write_text("import app.links.spec\n", encoding="utf-8")
    (app / "core" / "e.py").write_text("from app.links.spec import LINK_KEYS\n", encoding="utf-8")
    (app / "links" / "f.py").write_text("from app.routers import links\n", encoding="utf-8")
    (app / "links" / "g.py").write_text("from app.realtime import x\n", encoding="utf-8")
    (app / "links" / "ok.py").write_text("from app.wordbook import store\nfrom app.rank import points\n"
                                         "from app.core import learning_events\n", encoding="utf-8")
    (app / "routers" / "ok.py").write_text("from app.links import registry\n", encoding="utf-8")
    found = violations(app)
    for bad in ("app/rank/a.py:1", "app/admin/b.py:2", "app/wordbook/c.py:1", "app/services/d.py:1", "app/core/e.py:1",
                "app/links/f.py:1", "app/links/g.py:1"):
        assert any(p.startswith(bad) for p in found), bad
    assert not any(p.startswith(("app/links/ok.py", "app/routers/ok.py")) for p in found)
```

`server/tests/links_helpers.py`:

```python
"""学习联动测试工具(计划 P-L1、P-L6)。"""
import json
import os
from pathlib import Path

from tests.test_web_contract import shape

FIXTURES = Path(__file__).parent / "fixtures"


def enable_links(app, **overrides) -> None:
    app.state.settings = app.state.settings.model_copy(update={"links_enabled": True, **overrides})


async def drain(app) -> int:
    return await app.state.learning_bus.drain()


async def user_id_of(client, headers) -> int:
    return int((await client.get("/api/me", headers=headers)).json()["id"])


def check_contract(name: str, actual: dict) -> None:
    """`CONTRACT_UPDATE=1` 重录 `fixtures/<name>.json`;否则按形状比较。样例里不能有令牌或密钥。"""
    fixture = FIXTURES / f"{name}.json"
    if os.environ.get("CONTRACT_UPDATE"):
        fixture.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    expected = json.loads(fixture.read_text(encoding="utf-8"))
    assert shape(actual) == shape(expected)
    raw = fixture.read_text(encoding="utf-8")
    assert "access_token" not in raw and "secret" not in raw
```

`server/tests/test_links_gate.py`:

```python
from types import SimpleNamespace

import pytest

from app.links.gate import LinkGate
from app.links.spec import LINK_KEYS, flag_of
from app.models import UserLinkPref, utcnow
from tests.links_helpers import enable_links, user_id_of


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


async def make_user(client, name="alice"):
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return await user_id_of(client, h), h


async def set_pref(app, uid, key, enabled):
    async with app.state.sessionmaker() as s:
        s.add(UserLinkPref(user_id=uid, link_key=key, enabled=enabled, updated_at=utcnow()))
        await s.commit()


@pytest.mark.parametrize("master,flag,pref,expected", [
    (False, True, None, False), (True, False, None, False), (True, True, None, True),
    (True, True, True, True), (True, True, False, False), (False, False, False, False),
])
async def test_three_level_truth_table(app, client, master, flag, pref, expected):
    uid, _ = await make_user(client)
    app.state.settings = app.state.settings.model_copy(update={"links_enabled": master, flag_of("mistakes"): flag})
    if pref is not None:
        await set_pref(app, uid, "mistakes", pref)
    assert await LinkGate(app)("mistakes", uid) is expected


async def test_prefs_are_cached_for_30_seconds_and_invalidated(app, client):
    uid, _ = await make_user(client)
    enable_links(app)
    clock = Clock()
    gate = LinkGate(app, clock=clock)
    assert await gate("chat_words", uid) is True
    await set_pref(app, uid, "chat_words", False)
    assert await gate("chat_words", uid) is True  # cached
    clock.t += 31
    assert await gate("chat_words", uid) is False
    gate.invalidate(uid)
    assert (await gate.prefs(uid))["chat_words"] is False


async def test_unknown_link_is_off(app, client):
    uid, _ = await make_user(client)
    enable_links(app)
    assert await LinkGate(app)("nope", uid) is False


def test_every_link_key_has_a_settings_flag():
    from app.core.config import Settings
    assert all(flag_of(k) in Settings.model_fields for k in LINK_KEYS)
```

`server/tests/test_links_api.py`:

```python
from app.links.registry import LINKS
from app.links.spec import LINK_KEYS
from tests.links_helpers import check_contract, enable_links

URL = "/api/links"


async def login(client, name="alice"):
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_registry_lists_the_six_links_in_spec_order():
    assert tuple(s.key for s in LINKS) == LINK_KEYS


async def test_config_when_master_is_off(client):
    h = await login(client)
    body = (await client.get(f"{URL}/config", headers=h)).json()
    assert body["enabled"] is False
    assert [l["key"] for l in body["links"]] == list(LINK_KEYS)
    assert all(l["effective"] is False and l["user"] is True and l["global"] is True for l in body["links"])
    r = await client.put(f"{URL}/prefs", headers=h, json={"key": "mistakes", "enabled": False})
    assert (r.status_code, r.json()) == (404, {"error": "Links are disabled"})


async def test_prefs_round_trip_and_validation(app, client):
    enable_links(app, link_chat_words_enabled=False)
    h = await login(client)
    on = (await client.get(f"{URL}/config", headers=h)).json()
    assert {l["key"]: (l["global"], l["effective"]) for l in on["links"]}["chat_words"] == (False, False)
    r = await client.put(f"{URL}/prefs", headers=h, json={"key": "mistakes", "enabled": False})
    assert r.status_code == 200
    mistakes = next(l for l in r.json()["links"] if l["key"] == "mistakes")
    assert (mistakes["user"], mistakes["effective"]) == (False, False)
    assert (await client.put(f"{URL}/prefs", headers=h, json={"key": "nope", "enabled": True})).json() == {"error": "Unknown link"}
    assert (await client.put(f"{URL}/prefs", headers=h, json={"key": "mistakes", "enabled": True, "x": 1})).status_code == 422
    assert (await client.get(f"{URL}/config")).status_code == 401
    other = await login(client, "bob")
    theirs = next(l for l in (await client.get(f"{URL}/config", headers=other)).json()["links"] if l["key"] == "mistakes")
    assert theirs["user"] is True  # prefs are per user
    check_contract("links_contract", {"config": on, "prefs": r.json(), "unknown": {"error": "Unknown link"}})


async def test_bus_and_gate_are_installed(app):
    assert app.state.learning_bus is not None and app.state.link_gate is not None
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_architecture.py tests/test_links_gate.py tests/test_links_api.py` → FAIL

- [ ] **Step 3: 实现**

`server/app/links/spec.py`:

```python
"""联动的静态描述(spec 2026-10-11-learning-links §6、§7)。"""
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services.vocabulary import MAX_WORD, validate_word

LINK_KEYS: tuple[str, ...] = ("word_actions", "daily_tasks", "mistakes", "pron_shadow", "chat_words", "rank_sources")


def flag_of(key: str) -> str:
    return f"link_{key}_enabled"


@dataclass(frozen=True)
class LinkSpec:
    key: str
    label_zh: str
    label_en: str
    install: Callable[[Any, Any], None] | None = None  # (app, bus) -> None:订阅事件、登记段位来源
    router: Any = None  # fastapi.APIRouter | None,挂在 /api/links 下

    @property
    def flag(self) -> str:
        return flag_of(self.key)


class WordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    word: str = Field(min_length=1, max_length=2 * MAX_WORD)

    @field_validator("word")
    @classmethod
    def _word(cls, value: str) -> str:
        return validate_word(value)
```

`server/app/links/prefs.py`:

```python
"""每用户联动开关(user_link_prefs);没有行 = 开。"""
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import UserLinkPref


async def load(session: AsyncSession, user_id: int) -> dict[str, bool]:
    rows = (await session.execute(select(UserLinkPref.link_key, UserLinkPref.enabled)
                                  .where(UserLinkPref.user_id == user_id))).all()
    return {k: bool(v) for k, v in rows}


async def save(session: AsyncSession, user_id: int, key: str, enabled: bool, now: datetime) -> None:
    row = await session.get(UserLinkPref, (user_id, key))
    if row is None:
        session.add(UserLinkPref(user_id=user_id, link_key=key, enabled=enabled, updated_at=now))
    else:
        row.enabled, row.updated_at = enabled, now
    await session.commit()
```

`server/app/links/gate.py`:

```python
"""effective(link, user) = links_enabled ∧ link_<key>_enabled ∧ 用户偏好(缺省开)(spec §4.6)。"""
import time
from collections import OrderedDict

from fastapi import Depends, HTTPException, Request

from app.core.deps import current_user, limited_user
from app.links import prefs
from app.links.spec import LINK_KEYS, flag_of
from app.models import User

TTL_SECONDS = 30.0
MAX_USERS = 10_000


class LinkGate:
    def __init__(self, app, *, clock=time.monotonic) -> None:
        self._app = app
        self._clock = clock
        self._cache: OrderedDict[int, tuple[float, dict[str, bool]]] = OrderedDict()

    async def __call__(self, link: str, user_id: int) -> bool:
        settings = self._app.state.settings
        if link not in LINK_KEYS or not settings.links_enabled or not getattr(settings, flag_of(link), False):
            return False
        return (await self.prefs(user_id)).get(link, True)

    async def prefs(self, user_id: int) -> dict[str, bool]:
        now = self._clock()
        hit = self._cache.get(user_id)
        if hit is not None and hit[0] > now:
            self._cache.move_to_end(user_id)
            return hit[1]
        async with self._app.state.sessionmaker() as session:
            mine = await prefs.load(session, user_id)
        self._cache[user_id] = (now + TTL_SECONDS, mine)
        self._cache.move_to_end(user_id)
        while len(self._cache) > MAX_USERS:
            self._cache.popitem(last=False)
        return mine

    def invalidate(self, user_id: int) -> None:
        self._cache.pop(user_id, None)


def require_link(key: str, *, limited: bool = False):
    """联动接口的依赖:对当前用户无效时 404 `Link is off`。写接口用 limited=True(限流)。"""
    dependency = limited_user if limited else current_user

    async def guard(request: Request, user: User = Depends(dependency)) -> User:
        if not await request.app.state.link_gate(key, user.id):
            raise HTTPException(404, "Link is off")
        return user

    return guard
```

六个桩(F4 只放 `SPEC`;对应车道整体替换文件)。例如 `server/app/links/mistakes.py`:

```python
"""易错词(spec §6.3)。F4 桩:只有 SPEC;处理器与接口由 L3 实现。"""
from app.links.spec import LinkSpec

SPEC = LinkSpec("mistakes", "易错词", "Mistakes")
```

其余五个同形:`word_actions` → `("word_actions", "单词操作位置", "Word actions")`、`daily_tasks` → `("daily_tasks", "今日任务聚合卡", "Daily tasks")`、`pron_shadow` → `("pron_shadow", "发音弱词与跟读", "Weak pronunciation & shadowing")`、`chat_words` → `("chat_words", "对话用到今日词", "New words in chat")`、`rank_sources` → `("rank_sources", "联动段位点", "Rank points from links")`。

`server/app/links/registry.py`:

```python
"""联动清单(计划 P-L3):删掉一行 = 删掉一个联动(它的订阅、接口与配置项一起消失)。"""
from app.links import chat_words, daily_tasks, mistakes, pron_shadow, rank_sources, word_actions
from app.links.spec import LinkSpec

LINKS: tuple[LinkSpec, ...] = (
    word_actions.SPEC,
    daily_tasks.SPEC,
    mistakes.SPEC,
    pron_shadow.SPEC,
    chat_words.SPEC,
    rank_sources.SPEC,
)


def keys() -> tuple[str, ...]:
    return tuple(s.key for s in LINKS)
```

`server/app/links/setup.py`:

```python
"""把联动装到应用上(main.create_app 调用;测试不跑 lifespan 也能用)。"""
from sqlalchemy.ext.asyncio import AsyncSession

from app.links import prefs
from app.links.gate import LinkGate
from app.links.registry import LINKS


def install(app) -> None:
    bus = app.state.learning_bus
    gate = LinkGate(app)
    app.state.link_gate = gate
    bus.set_gate(gate)
    for spec in LINKS:
        if spec.install is not None:
            spec.install(app, bus)


async def config_out(app, session: AsyncSession, user_id: int) -> dict:
    settings = app.state.settings
    mine = await prefs.load(session, user_id)
    out = []
    for spec in LINKS:
        on = bool(getattr(settings, spec.flag, False))
        user = mine.get(spec.key, True)
        out.append({"key": spec.key, "global": on, "user": user, "effective": bool(settings.links_enabled and on and user)})
    return {"enabled": bool(settings.links_enabled), "links": out}
```

`server/app/links/purge.py`:

```python
"""保留期清理(spec §12):link_word_uses 超过 links_retention_days、易错词 / 弱词移出超过 30 天的行。"""
import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import delete

from app.models import LinkMistakeWord, LinkWeakWord, LinkWordUse, utcnow

logger = logging.getLogger(__name__)
CLEARED_DAYS = 30


async def purge(session, now: datetime, retention_days: int) -> dict[str, int]:
    uses = await session.execute(delete(LinkWordUse).where(LinkWordUse.created_at < now - timedelta(days=retention_days)))
    cut = now - timedelta(days=CLEARED_DAYS)
    mistakes = await session.execute(delete(LinkMistakeWord).where(LinkMistakeWord.cleared_at < cut))
    weak = await session.execute(delete(LinkWeakWord).where(LinkWeakWord.cleared_at < cut))
    await session.commit()
    return {"word_uses": uses.rowcount, "mistakes": mistakes.rowcount, "weak_words": weak.rowcount}


async def daily_loop(app, interval: float = 21600.0) -> None:
    while True:
        try:
            async with app.state.sessionmaker() as session:
                counts = await purge(session, utcnow(), app.state.settings.links_retention_days)
            logger.info("links purge word_uses=%d mistakes=%d weak_words=%d", counts["word_uses"], counts["mistakes"],
                        counts["weak_words"])
        except Exception as exc:  # noqa: BLE001 - housekeeping must not die
            logger.warning("links purge failed error=%s", type(exc).__name__)
        await asyncio.sleep(interval)
```

`server/app/routers/links.py`:

```python
"""学习联动接口(spec 2026-10-11-learning-links §7.2、§11);各联动的子路由由 registry 挂进来。"""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import current_user, get_session, limited_user
from app.links import prefs
from app.links.registry import LINKS, keys
from app.links.setup import config_out
from app.models import User, utcnow

router = APIRouter(prefix="/api/links")


class PrefIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, max_length=24)
    enabled: bool


@router.get("/config")
async def get_config(request: Request, user: User = Depends(current_user),
                     session: AsyncSession = Depends(get_session)):
    return await config_out(request.app, session, user.id)


@router.put("/prefs")
async def put_pref(payload: PrefIn, request: Request, user: User = Depends(limited_user),
                   session: AsyncSession = Depends(get_session)):
    if not request.app.state.settings.links_enabled:
        raise HTTPException(404, "Links are disabled")
    if payload.key not in keys():
        raise HTTPException(422, "Unknown link")
    await prefs.save(session, user.id, payload.key, payload.enabled, utcnow())
    request.app.state.link_gate.invalidate(user.id)
    return await config_out(request.app, session, user.id)


for _spec in LINKS:
    if _spec.router is not None:
        router.include_router(_spec.router)
```

`server/app/core/deps.py`:`from app.core import metering` 改为 `from app.core import learning_events, metering`;`current_user` 里 `metering.bind_user(user.id)` 之后加一行
`learning_events.bind(getattr(request.app.state, "learning_bus", None))`。

`server/app/main.py`(只附加):
- 导入:`from app.core.learning_events import LearningBus`、`from app.links import purge as links_purge`、`from app.links.setup import install as install_links`;`from app.routers import (…)` 列表里加 `links`(以及 LA 的 `admin_links`,LA 再加)。
- `app.state.background_tasks = {}` 之后:`app.state.learning_bus = LearningBus(lambda: app.state.settings)`,然后 `install_links(app)`。
- lifespan:`tasks["backups"] = …` 之后加 `tasks["links"] = asyncio.create_task(app_.state.learning_bus.run())` 与 `tasks["links_purge"] = asyncio.create_task(links_purge.daily_loop(app_))`;`await _stop_tasks(tasks, exclude="metering")` 之后加
  `with suppress(asyncio.TimeoutError, Exception): await asyncio.wait_for(app_.state.learning_bus.drain(), 2.0)`(关停前最后处理一次,2 秒放弃)。
- 路由循环:`wordbook,` 之后加 `links,`(必须在 `stubs` 之前)。

`server/app/links/CLAUDE.md`:

```markdown
# app/links/

学习联动(spec `docs/superpowers/specs/2026-10-11-learning-links-design.md`)。顶层:订阅核心学习事件、实现六个联动。
Off unless `LINKS_ENABLED`(每个联动另有 `LINK_<KEY>_ENABLED` 与每用户开关)。

## What lives here
- `spec.py`(LinkSpec、LINK_KEYS、WordIn)、`gate.py`(三级开关 + 偏好缓存、`require_link`)、`prefs.py`、`registry.py`(LINKS:删一行 = 删一个联动)、
  `setup.py`(install、config_out)、`purge.py`(保留期清理)、`admin_view.py`(管理端视图)
- 联动:`word_actions.py`、`daily_tasks.py`、`mistakes.py`、`pron_shadow.py`、`chat_words.py`、`rank_sources.py`

## Allowed dependencies
`app.core`、`app.models`、`app.providers`、`app.speech`、`app.services`、`app.rank`、`app.rooms`、`app.wordbook`。
只有 `app/routers/` 与 `app/main.py` 可以导入本包(`tests/test_architecture.py`)。段位经 `app.models.LinkCredit` 读来源,不导入本包。

## Handler contract(spec §4.5)
`async def handle(app, event)`;自己开会话、自己提交;幂等;≤ 6 次往返、单查询 ≤ 200 行;不发上游请求(chat_words 的 JudgeRunner 除外);
不判断开关(gate 统一);日志不含词、文本、用户输入、用户 id。

## Tests
`uv run pytest -q tests/test_links_*.py tests/test_learning_events.py tests/test_rank_sources.py tests/test_rank_extra_sources.py tests/test_admin_links.py`
助手:`tests/links_helpers.py`(`enable_links`、`drain`、`check_contract`)。测试不跑 lifespan:发布后 `await drain(app)`。

## Pitfalls
- 发布语句只在发布方 `commit()` 之后;本包从不调用 `publish`。
- `MessageSent.text` 只在内存;不要把它写进表、日志、异常或管理端错误。
- 新联动:加模块 + registry 一行 + `Settings` 开关 + 注册表 spec + 网页插件;改 spec 先。
```

`server/app/CLAUDE.md` 分层表加 `| links/ | 学习联动(顶层):事件订阅与六个联动;只有 routers 与 main 导入 |`,「Allowed dependencies」加 `links -> core, models, providers, speech, services, rank, rooms, wordbook; only routers and main.py import it`,routers/main 行加 `links`;`server/app/routers/CLAUDE.md` 的 What lives here 加 `links`(/api/links/*)。

- [ ] **Step 4: 录契约并跑测试** — Run: `cd server && CONTRACT_UPDATE=1 uv run pytest -q tests/test_links_api.py`(PowerShell:`$env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_links_api.py; Remove-Item Env:CONTRACT_UPDATE`),再 `uv run pytest -q tests/test_architecture.py tests/test_links_gate.py tests/test_links_api.py tests/test_links_models.py tests/test_learning_events.py` → PASS;再跑 `uv run pytest -q tests/test_rank_*.py tests/test_wordbook_*.py tests/test_vocabulary_api.py tests/test_conversations.py` 确认 `current_user` 改动无副作用。
- [ ] **Step 5: 提交**

```bash
git add server/app/links server/app/routers/links.py server/app/main.py server/app/core/deps.py server/app/CLAUDE.md server/app/routers/CLAUDE.md server/tests/test_architecture.py server/tests/links_helpers.py server/tests/test_links_gate.py server/tests/test_links_api.py server/tests/fixtures/links_contract.json
git commit -m "feat(server): links top layer with gate, per-user prefs and config API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task F5: 三个发布点、`word_buckets` 与全开 / 全关矩阵

**Files:**
- Modify(只附加,见「共享文件插入点」):`server/app/wordbook/service.py`、`server/app/routers/speech.py`、`server/app/routers/conversations.py`、`server/app/services/stats.py`(新增 `word_buckets` 与 `GOOD_ACCURACY`)
- Create: `server/tests/test_links_publishers.py`、`server/tests/test_links_matrix.py`

**Interfaces:**
- Produces(`app.services.stats`):`GOOD_ACCURACY = 80`、`word_buckets(result) -> tuple[list[tuple[str, int | None]], list[str]]`(弱词集合与 `poor_words(result)` 相同;好词 = 无错误类型且准确度 ≥ 80,且不在弱词里)
- Produces(事件):`WordAnswered`(`answer()` 一次、`spell_submit()` 每词一次)、`AssessmentFinished`(保存后一次)、`MessageSent`(每条 user 消息一次)

- [ ] **Step 1: 写失败测试** — `server/tests/test_links_publishers.py`:

```python
import json
from pathlib import Path

import pytest

from app.core.learning_events import AssessmentFinished, MessageSent, WordAnswered
from app.services.stats import poor_words, word_buckets
from tests.links_helpers import enable_links
from tests.test_assessment_save import FakeXfyun, make_wav  # noqa: F401 - FakeXfyun used by the fixture below
from tests.test_assessment_save import fake, post  # noqa: F401 - pytest fixture re-export
from tests.wordbook_helpers import enable_wordbook, make_data_dir

TALK_MEANING = "v. 说话；谈话；n. 交谈"


@pytest.fixture
def settings_overrides(tmp_path):
    return {"data_dir": str(tmp_path / "data")}


class Recorder:
    def __init__(self, app, *types):
        self.seen = []
        for t in types:
            app.state.learning_bus.subscribe(t, f"rec_{t.__name__}", self.handle)

    async def handle(self, event):
        self.seen.append(event)


async def login(client, name="alice"):
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_wordbook_answer_publishes_one_event_after_commit(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    enable_links(app)
    rec = Recorder(app, WordAnswered)
    h = await login(client)
    await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    r = await client.post("/api/wordbook/answers", headers=h, json={"book_id": "junior", "tz_offset_minutes": 480,
                                                                    "key": "talk", "mode": "learn", "qtype": "meaning",
                                                                    "choice": "wrong option"})
    assert r.status_code == 200
    await app.state.learning_bus.drain()
    (e,) = rec.seen
    assert (e.book_id, e.word, e.kind, e.qtype, e.outcome, e.credit) == ("junior", "talk", "learn", "meaning", "wrong", 0)


async def test_master_off_publishes_nothing_and_responses_are_identical(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    rec = Recorder(app, WordAnswered)
    h = await login(client)
    await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    body = {"book_id": "junior", "tz_offset_minutes": 480, "key": "talk", "mode": "learn", "qtype": "meaning",
            "choice": TALK_MEANING}
    off = (await client.post("/api/wordbook/answers", headers=h, json=body)).json()
    assert app.state.learning_bus.queue()["size"] == 0 and rec.seen == []
    enable_links(app)
    on = (await client.post("/api/wordbook/answers", headers=h, json={**body, "mode": "review"})).json()
    assert set(off) == set(on)


async def test_spell_submit_publishes_one_event_per_word(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    enable_links(app)
    rec = Recorder(app, WordAnswered)
    h = await login(client)
    await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    for key in ("talk", "ability", "able", "accept", "careful", "carry"):
        await client.post("/api/wordbook/answers", headers=h, json={"book_id": "junior", "key": key, "mode": "learn",
                                                                    "qtype": "meaning", "known": True})
    sets = (await client.post("/api/wordbook/spell/sets", headers=h, json={"count": 1, "size": 3})).json()["sets"]
    if not sets:
        pytest.skip("mini book produced no spelling set")  # 夹具词书至少能组 3 句;没有就说明夹具变了
    line_answers = [{"key": l["key"], "sentence_id": l["sentence_id"],
                     "answers": [{"typed": "zzz", "hinted": False} for s in l["segments"] if s["t"] == "blank"]}
                    for l in sets[0]["lines"]]
    rec.seen.clear()
    r = await client.post("/api/wordbook/spell/submit", headers=h,
                          json={"book_id": "junior", "set_id": sets[0]["set_id"], "lines": line_answers})
    assert r.status_code == 200, r.text
    await app.state.learning_bus.drain()
    assert sorted(e.word for e in rec.seen) == sorted(l["key"] for l in line_answers)
    assert all(e.qtype == "spell_ctx" and e.outcome == "wrong" and e.kind in ("blank", "review") for e in rec.seen)


async def test_saved_assessment_publishes_assessment_finished(app, client, fake):
    enable_links(app)
    rec = Recorder(app, AssessmentFinished)
    h = await login(client)
    r = await post(client, h, save="true")
    assert r.status_code == 200
    await app.state.learning_bus.drain()
    (e,) = rec.seen
    assert e.assessment_id == r.json()["assessment_id"] and e.source == "practice"
    assert isinstance(e.weak_words, tuple) and isinstance(e.good_words, tuple)
    unsaved = await post(client, h)
    assert unsaved.status_code == 200
    await app.state.learning_bus.drain()
    assert len(rec.seen) == 1  # unsaved assessments are not published


async def test_user_messages_publish_message_sent_and_assistant_ones_do_not(app, client):
    enable_links(app)
    rec = Recorder(app, MessageSent)
    h = await login(client)
    conv = (await client.post("/api/conversations", headers=h, json={"name": "c"})).json()
    r = await client.post(f"/api/conversations/{conv['id']}/messages", headers=h, json={"messages": [
        {"role": "user", "content": "I talked a lot"}, {"role": "assistant", "content": "Nice"}]})
    assert r.status_code == 200
    await app.state.learning_bus.drain()
    (e,) = rec.seen
    assert (e.conversation_id, e.message_id, e.text) == (conv["id"], r.json()["messages"][0]["id"], "I talked a lot")


async def test_rating_answers_publish_once_and_pending_checks_do_not(app, client, tmp_path, monkeypatch):
    """INDEX R-E1:A 的三档自评每条作答记录发布一次;复习抽查第一步(pending,不写事件)不发布。"""
    from datetime import timedelta

    from sqlalchemy import update

    from app.models import VocabularyItem, utcnow
    from app.wordbook import service
    enable_wordbook(app, make_data_dir(tmp_path), wordbook_spot_check_pct=100)
    enable_links(app)
    monkeypatch.setattr(service, "use_recall", lambda user_id, key, reps, box: box in (1, 2, 4, 5))
    rec = Recorder(app, WordAnswered)
    h = await login(client)
    await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    base = {"book_id": "junior", "tz_offset_minutes": 480, "key": "talk", "qtype": "recall"}
    r = await client.post("/api/wordbook/answers", headers=h, json={**base, "mode": "learn", "rating": "fuzzy"})
    assert r.status_code == 200
    async with app.state.sessionmaker() as s:
        await s.execute(update(VocabularyItem).where(VocabularyItem.word == "talk")
                        .values(due_at=utcnow() - timedelta(hours=1)))
        await s.commit()
    pending = (await client.post("/api/wordbook/answers", headers=h,
                                 json={**base, "mode": "review", "rating": "know"})).json()
    assert pending["outcome"] == "pending"
    await client.post("/api/wordbook/answers", headers=h, json={**base, "mode": "review", "rating": "know", "choice": "x"})
    await app.state.learning_bus.drain()
    assert [(e.kind, e.qtype, e.outcome, e.credit) for e in rec.seen] == [
        ("learn", "recall", "fuzzy", 0), ("review", "recall", "unknown", 0)]


def test_word_buckets_agree_with_poor_words():
    fixture = Path(__file__).parent / "fixtures" / "ise_good.xml"
    from app.providers.xfyun_result import to_assessment
    result = to_assessment(fixture.read_text(encoding="utf-8"), "Hello, nice to meet you. I would like a cup of coffee, please.")
    weak, good = word_buckets(result)
    assert {w for w, _ in weak} == poor_words(result)
    assert not {w for w, _ in weak} & set(good)
    crafted = {"detail_result": {"words": [
        {"word": "Three,", "pronunciation_assessment": {"accuracy_score": 40, "error_type": "Mispronunciation"}},
        {"word": "three", "pronunciation_assessment": {"accuracy_score": 30, "error_type": "None"}},
        {"word": "tree", "pronunciation_assessment": {"accuracy_score": 92, "error_type": "None"}},
        {"word": "extra", "pronunciation_assessment": {"accuracy_score": 10, "error_type": "Insertion"}},
        {"word": "okay", "pronunciation_assessment": {"accuracy_score": 70, "error_type": "None"}}]}}
    assert word_buckets(crafted) == ([("three", 30)], ["tree"])
```

(`tests.test_assessment_save` 的 `post` 是同步返回协程的函数:`await post(client, h, save="true")`;`fake` 夹具从该模块导入即生效;`settings_overrides` 在本文件重定义同样的 `data_dir`。)

`server/tests/test_links_matrix.py`:

```python
"""全开 / 全关矩阵(spec §15):既有接口的响应在联动开关的任何组合下逐键相同;只有开时才写联动表。"""
import pytest
from sqlalchemy import func, select

from app.links.spec import LINK_KEYS, flag_of
from app.models import LinkCredit, LinkMistakeWord, LinkWeakWord, LinkWordUse
from tests.wordbook_helpers import enable_wordbook, make_data_dir

MATRIX = [{"links_enabled": False}, {"links_enabled": True},
          *({"links_enabled": True, **{flag_of(k): k == only for k in LINK_KEYS}} for only in LINK_KEYS)]


def strip(body):
    """去掉每次都会变的值(id、时间),只比较键与稳定值。"""
    if isinstance(body, dict):
        return {k: strip(v) for k, v in body.items() if k not in ("id", "created_at", "updated_at", "due_at", "started_at")}
    if isinstance(body, list):
        return [strip(v) for v in body]
    return body


async def scenario(app, client, tmp_path, flags):
    enable_wordbook(app, make_data_dir(tmp_path))
    app.state.settings = app.state.settings.model_copy(update=flags)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    out = {"enroll": (await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})).json()}
    out["wrong"] = (await client.post("/api/wordbook/answers", headers=h, json={
        "book_id": "junior", "tz_offset_minutes": 480, "key": "talk", "mode": "learn", "qtype": "meaning", "choice": "x"})).json()
    conv = (await client.post("/api/conversations", headers=h, json={"name": "c"})).json()
    out["messages"] = (await client.post(f"/api/conversations/{conv['id']}/messages", headers=h,
                                         json={"messages": [{"role": "user", "content": "We talked."}]})).json()
    out["vocab"] = (await client.get("/api/vocabulary", headers=h, params={"scope": "all"})).json()
    await app.state.learning_bus.drain()
    async with app.state.sessionmaker() as s:
        rows = {m.__tablename__: await s.scalar(select(func.count()).select_from(m))
                for m in (LinkMistakeWord, LinkWeakWord, LinkWordUse, LinkCredit)}
    return strip(out), rows


@pytest.mark.parametrize("flags", MATRIX)
async def test_existing_responses_do_not_depend_on_links(app, client, tmp_path, flags):
    body, rows = await scenario(app, client, tmp_path, flags)
    baseline = {"enroll", "wrong", "messages", "vocab"}
    assert set(body) == baseline and body["wrong"]["outcome"] == "wrong"
    if not flags["links_enabled"]:
        assert set(rows.values()) == {0}
```

(各联动车道在自己的测试文件里断言「开时」写了哪些行;本矩阵只锁定「既有响应不变」与「全关零写入」。)

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_links_publishers.py tests/test_links_matrix.py` → FAIL(`ImportError: word_buckets`)

- [ ] **Step 3: 实现**

`server/app/services/stats.py`(在 `poor_words` 之后新增,不改它):

```python
GOOD_ACCURACY = 80


def word_buckets(result: object) -> tuple[list[tuple[str, int | None]], list[str]]:
    """(弱词 [(词, 最低准确度)], 好词 [词])。弱词规则与 poor_words 相同(Insertion 不算;Mispronunciation/Omission
    或准确度 < 60);好词 = 无错误类型且准确度 ≥ 80,且同一评测里没有弱读。同一评测里每个词只出现一次。"""
    detail = result.get("detail_result") if isinstance(result, dict) else None
    words = detail.get("words") if isinstance(detail, dict) else None
    weak: dict[str, int | None] = {}
    good: dict[str, None] = {}
    for item in words if isinstance(words, list) else []:
        if not isinstance(item, dict):
            continue
        pa = item.get("pronunciation_assessment")
        pa = pa if isinstance(pa, dict) else {}
        kind = pa.get("error_type")
        score = _finite(pa.get("accuracy_score"))
        text = _EDGES.sub("", str(item.get("word") or "").lower())
        if not text or kind == "Insertion":
            continue
        if kind in ("Mispronunciation", "Omission") or (score is not None and score < POOR_ACCURACY):
            value = None if score is None else round(score)
            prev = weak.get(text)
            weak[text] = value if prev is None else (prev if value is None else min(prev, value))
        elif score is not None and score >= GOOD_ACCURACY and kind in (None, "None"):
            good[text] = None
    return list(weak.items()), [w for w in good if w not in weak]
```

`server/app/wordbook/service.py`(四处附加,锚点见「共享文件插入点」;以 A、B 合并后的文件为准):

```python
from app.core import learning_events  # 导入块末尾

# answer() 客观题路径:await session.commit() 之后、# Ruling Z-e 之前
    learning_events.publish(learning_events.WordAnswered(
        user_id=user_id, book_id=p.book_id, word=card.key, kind=kind, qtype=p.qtype, outcome=outcome, credit=credit,
        at=now))

# _rating_answer()(A 的三档自评):末尾 await session.commit() 之后、checked = … 之前。
# kind 可能是 learn / relearn(B)/ review / practice;pending 分支(只扣作答次数)已在前面 return,不会走到这里
    learning_events.publish(learning_events.WordAnswered(
        user_id=user_id, book_id=p.book_id, word=card.key, kind=kind, qtype=recall.RECALL_QTYPE, outcome=outcome,
        credit=100 if eff == "know" else 0, at=now))

# spell_submit():words, next_blank, seen = [], 0, set() 之后
    answered: list = []
# spell_submit():循环内 store.add_event(...) 之后
        answered.append(learning_events.WordAnswered(
            user_id=user_id, book_id=p.book_id, word=card.key, kind=kind, qtype=SPELL_QTYPE, outcome=outcome,
            credit=credit, at=now))
# spell_submit():await session.commit() 之后
    for event in answered:
        learning_events.publish(event)
```

`server/app/routers/speech.py`:导入 `from app.core import learning_events`、`from app.services.stats import word_buckets`、`from app.models import utcnow`(若已导入 models 则合并);`save_assessment(...)` 的 `try/except OSError` 块之后、`return {**result, "assessment_id": assessment_id}` 之前:

```python
    weak, good = word_buckets(result)
    score = result.get("pronunciation_score")
    learning_events.publish(learning_events.AssessmentFinished(
        user_id=user.id, assessment_id=assessment_id, source=source_value,
        score=round(score) if isinstance(score, (int, float)) and not isinstance(score, bool) else None,
        weak_words=tuple(learning_events.WeakWord(w, s) for w, s in weak), good_words=tuple(good), at=utcnow()))
```

`server/app/routers/conversations.py`:导入 `from app.core import learning_events`;`create_messages()` 的 `try: await session.commit() … except IntegrityError: …` 之后、`return` 之前:

```python
    for row in rows:
        if row.role == "user":
            learning_events.publish(learning_events.MessageSent(
                user_id=user.id, conversation_id=conversation.id, message_id=row.id, text=row.content, at=row.created_at))
```

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_links_publishers.py tests/test_links_matrix.py tests/test_stats.py tests/test_wordbook_learn.py tests/test_wordbook_spell.py tests/test_assessment_save.py tests/test_conversations.py tests/test_architecture.py` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/app/wordbook/service.py server/app/routers/speech.py server/app/routers/conversations.py server/app/services/stats.py server/tests/test_links_publishers.py server/tests/test_links_matrix.py
git commit -m "feat(server): publish learning events after commit from wordbook, assessments and chat

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task F6: 网页扩展点注册表 `lib/extension-points*`

**Files:**
- Create: `web/src/lib/extension-points.ts`、`web/src/lib/extension-points-react.tsx`、`web/src/lib/extension-points.test.tsx`
- Modify: `web/src/lib/CLAUDE.md`(What lives here 加一行,Pitfalls 加「注册表是进程单例;测试用 `createExtensionRegistry()`」)

**Interfaces:**
- Produces(`~/lib/extension-points`):`LINK_KEYS`、`LinkKey`、`LinkFlags`、`ALL_OFF`、`flagsFromConfig(config)`、`WordSource`、`WordTarget`、`MAX_WORD_TARGET`、`WordActionProps`、`TodayCounts`、`PointProps`、`PointName`、`POINT_NAMES`、`Contribution<N>`、`RouteContribution`、`visible(c, flags)`、`createExtensionRegistry()`,以及单例上的 `contribute`、`contributeRoute`、`contributionsFor`、`routesFor`、`getLinkFlags`、`setLinkFlags`、`subscribeLinkFlags`
- Produces(`~/lib/extension-points-react`):`useLinkFlags()`、`useContributions(point)`、`Slot`、`WordActions`

- [ ] **Step 1: 写失败测试** — `web/src/lib/extension-points.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_OFF, LINK_KEYS, MAX_WORD_TARGET, POINT_NAMES, contribute, createExtensionRegistry, flagsFromConfig, setLinkFlags,
  visible, type LinkFlags,
} from "./extension-points";
import { Slot, WordActions } from "./extension-points-react";

const on = (...keys: string[]): LinkFlags => ({
  enabled: true, links: Object.fromEntries(LINK_KEYS.map((k) => [k, keys.includes(k)])) as LinkFlags["links"],
});

afterEach(() => setLinkFlags(ALL_OFF));

describe("extension registry", () => {
  it("filters by link flag, master switch and sorts by order then id", () => {
    const r = createExtensionRegistry();
    const C = () => null;
    r.contribute({ point: "practiceHome", id: "b", order: 1, component: C });
    r.contribute({ point: "practiceHome", id: "a", order: 1, component: C });
    r.contribute({ point: "practiceHome", id: "core", order: 9, component: C });
    r.contribute({ point: "practiceHome", id: "linked", order: 0, link: "daily_tasks", component: C });
    r.contribute({ point: "practiceHome", id: "needs", order: 5, requiresLinks: true, component: C });
    expect(r.contributionsFor("practiceHome", ALL_OFF).map((c) => c.id)).toEqual(["a", "b", "core"]);
    expect(r.contributionsFor("practiceHome", on()).map((c) => c.id)).toEqual(["a", "b", "needs", "core"]);
    expect(r.contributionsFor("practiceHome", on("daily_tasks")).map((c) => c.id)).toEqual(["linked", "a", "b", "needs", "core"]);
    expect(r.contributionsFor("practiceHome", { ...on("daily_tasks"), enabled: false }).map((c) => c.id)).toEqual(["a", "b", "core"]);
  });

  it("rejects duplicate ids and duplicate routes", () => {
    const r = createExtensionRegistry();
    const C = () => null;
    r.contribute({ point: "meRows", id: "x", component: C });
    expect(() => r.contribute({ point: "meRows", id: "x", component: C })).toThrow(/duplicate/);
    r.contributeRoute({ id: "r", path: "/me/links", requiresLinks: true, component: C });
    expect(() => r.contributeRoute({ id: "r2", path: "/me/links", component: C })).toThrow(/duplicate/);
    expect(r.routesFor(ALL_OFF)).toEqual([]);
    expect(r.routesFor(on()).map((x) => x.path)).toEqual(["/me/links"]);
  });

  it("notifies flag subscribers only on change", () => {
    const r = createExtensionRegistry();
    const fn = vi.fn();
    const off = r.subscribeLinkFlags(fn);
    r.setLinkFlags(r.getLinkFlags());
    expect(fn).not.toHaveBeenCalled();
    r.setLinkFlags(on("mistakes"));
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    r.setLinkFlags(ALL_OFF);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("builds flags from the server config and ignores unknown keys", () => {
    const flags = flagsFromConfig({ enabled: true, links: [
      { key: "mistakes", effective: true }, { key: "chat_words", effective: false }, { key: "future_link", effective: true }] });
    expect(flags.enabled).toBe(true);
    expect(flags.links.mistakes).toBe(true);
    expect(flags.links.chat_words).toBe(false);
    expect(Object.keys(flags.links).sort()).toEqual([...LINK_KEYS].sort());
    expect(visible({ id: "x", link: "mistakes" }, flags)).toBe(true);
  });

  it("knows every point and keeps the vocabulary limits", async () => {
    expect(POINT_NAMES).toEqual(["wordActions", "wordActionsMenu", "dailyTasks", "practiceHome", "learningSources",
      "wordDetailSections", "notebookViews", "meRows", "appEffects"]);
    const { MAX_VOCAB_WORD, MAX_VOCAB_MEANING, MAX_VOCAB_EXAMPLE } = await import("~/features/vocabulary/vocabulary-api");
    expect(MAX_WORD_TARGET).toEqual({ word: MAX_VOCAB_WORD, meaning: MAX_VOCAB_MEANING, example: MAX_VOCAB_EXAMPLE });
  });
});

describe("<Slot>", () => {
  it("renders visible contributions with props, re-renders on flag change and isolates failures", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    contribute({ point: "learningSources", id: "test.core", component: ({ pick }) => <button onClick={() => pick("hi")}>core</button> });
    contribute({ point: "learningSources", id: "test.boom", link: "pron_shadow", component: () => { throw new Error("x"); } });
    contribute({ point: "learningSources", id: "test.linked", link: "pron_shadow", order: 1, component: () => <span>linked</span> });
    const pick = vi.fn();
    const { rerender } = render(<Slot point="learningSources" props={{ pick }} />);
    expect(screen.getByText("core")).toBeInTheDocument();
    expect(screen.queryByText("linked")).toBeNull();
    setLinkFlags(on("pron_shadow"));
    rerender(<Slot point="learningSources" props={{ pick }} />);
    expect(screen.getByText("linked")).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith("[slot] learningSources/test.boom failed");
    screen.getByText("core").click();
    expect(pick).toHaveBeenCalledWith("hi");
    warn.mockRestore();
    error.mockRestore();
  });

  it("<WordActions> adds no wrapper elements", () => {
    contribute({ point: "wordActions", id: "test.only", component: ({ testId }) => <i data-testid={testId} /> });
    const { container } = render(<WordActions target={{ word: "talk", source: "manual" }} testId="w" variant="icon" />);
    expect(container.innerHTML).toBe('<i data-testid="w"></i>');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd web && yarn vitest run src/lib/extension-points.test.tsx` → FAIL

- [ ] **Step 3: 实现** — `web/src/lib/extension-points.ts`:

```ts
import type { ComponentType } from "react";

/**
 * 扩展点注册表(spec 2026-10-11-learning-links §8):消费方渲染插槽,提供方登记贡献,彼此不导入。
 * 纯 TS(只类型导入 React);旗标 = 服务端 /api/links/config 的每用户 effective,未加载前全关。
 */
export const LINK_KEYS = ["word_actions", "daily_tasks", "mistakes", "pron_shadow", "chat_words", "rank_sources"] as const;
export type LinkKey = (typeof LINK_KEYS)[number];
export interface LinkFlags { enabled: boolean; links: Record<LinkKey, boolean> }
export const ALL_OFF: LinkFlags = Object.freeze({
  enabled: false,
  links: Object.freeze(Object.fromEntries(LINK_KEYS.map((k) => [k, false])) as Record<LinkKey, boolean>),
});

export function flagsFromConfig(config: { enabled: boolean; links: { key: string; effective: boolean }[] }): LinkFlags {
  const links = Object.fromEntries(LINK_KEYS.map((k) => [k, false])) as Record<LinkKey, boolean>;
  for (const l of config.links) if ((LINK_KEYS as readonly string[]).includes(l.key)) links[l.key as LinkKey] = l.effective === true;
  return { enabled: config.enabled === true, links };
}

export type WordSource = "lookup" | "recap" | "progress" | "manual";
/** 与 features/vocabulary 的 VocabularyInput 同形(由测试保持上限一致)。 */
export interface WordTarget { word: string; meaning?: string; example?: string; source: WordSource }
export const MAX_WORD_TARGET = { word: 100, meaning: 1000, example: 500 } as const;
export interface WordActionProps { target: WordTarget; testId: string; label?: string; variant: "icon" | "labeled" }
export interface TodayCounts { practiceToday: number; chatMessagesToday: number; conversationsToday: number }

type Empty = Record<string, never>;
export interface PointProps {
  wordActions: WordActionProps;
  wordActionsMenu: WordActionProps & { close: () => void };
  dailyTasks: { today: TodayCounts | null };
  practiceHome: Empty;
  learningSources: { pick: (text: string) => void };
  wordDetailSections: { word: string };
  notebookViews: Empty;
  meRows: Empty;
  appEffects: Empty;
}
export type PointName = keyof PointProps;
export const POINT_NAMES: readonly PointName[] = ["wordActions", "wordActionsMenu", "dailyTasks", "practiceHome",
  "learningSources", "wordDetailSections", "notebookViews", "meRows", "appEffects"];

interface Gated { id: string; link?: LinkKey; requiresLinks?: boolean }
export interface Contribution<N extends PointName> extends Gated { point: N; order?: number; component: ComponentType<PointProps[N]> }
export interface RouteContribution extends Gated { path: string; component: ComponentType }

/** 有联动键 → 总开关且该联动有效;requiresLinks → 总开关;都没有 = 核心贡献,永远可见。 */
export function visible(c: Gated, flags: LinkFlags): boolean {
  if (c.link) return flags.enabled && flags.links[c.link] === true;
  if (c.requiresLinks) return flags.enabled;
  return true;
}

export function createExtensionRegistry() {
  const byPoint = new Map<PointName, Contribution<PointName>[]>();
  const routes: RouteContribution[] = [];
  const listeners = new Set<() => void>();
  let flags: LinkFlags = ALL_OFF;
  return {
    contribute<N extends PointName>(c: Contribution<N>): void {
      const list = byPoint.get(c.point) ?? [];
      if (list.some((x) => x.id === c.id)) throw new Error(`duplicate contribution ${c.point}/${c.id}`);
      byPoint.set(c.point, [...list, c as unknown as Contribution<PointName>]);
    },
    contributeRoute(r: RouteContribution): void {
      if (routes.some((x) => x.id === r.id || x.path === r.path)) throw new Error(`duplicate route ${r.path}`);
      routes.push(r);
    },
    contributionsFor<N extends PointName>(point: N, f: LinkFlags = flags): Contribution<N>[] {
      return ((byPoint.get(point) ?? []) as unknown as Contribution<N>[])
        .filter((c) => visible(c, f))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
    },
    routesFor(f: LinkFlags = flags): RouteContribution[] {
      return routes.filter((r) => visible(r, f));
    },
    getLinkFlags: (): LinkFlags => flags,
    setLinkFlags(next: LinkFlags): void {
      if (next === flags) return;
      flags = next;
      for (const l of [...listeners]) l();
    },
    subscribeLinkFlags(fn: () => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

const registry = createExtensionRegistry();
export const { contribute, contributeRoute, contributionsFor, routesFor, getLinkFlags, setLinkFlags, subscribeLinkFlags } = registry;
```

`web/src/lib/extension-points-react.tsx`:

```tsx
import { Component, type ComponentType, type ReactNode, useSyncExternalStore } from "react";
import {
  contributionsFor, getLinkFlags, subscribeLinkFlags, type Contribution, type LinkFlags, type PointName, type PointProps,
  type WordActionProps,
} from "./extension-points";

export function useLinkFlags(): LinkFlags {
  return useSyncExternalStore(subscribeLinkFlags, getLinkFlags, getLinkFlags);
}

export function useContributions<N extends PointName>(point: N): Contribution<N>[] {
  return contributionsFor(point, useLinkFlags());
}

/** 一个贡献出错只让它自己消失;不打印 props(可能含词)。 */
class SlotBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { console.warn(`[slot] ${this.props.name} failed`); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function Slot<N extends PointName>({ point, props }: { point: N; props: PointProps[N] }) {
  const items = useContributions(point);
  return (
    <>
      {items.map((c) => {
        const C = c.component as ComponentType<PointProps[N]>;
        return <SlotBoundary key={c.id} name={`${point}/${c.id}`}><C {...props} /></SlotBoundary>;
      })}
    </>
  );
}

/** 「加入生词本」等单词动作的插槽(spec §6.1);全关时只有 vocabulary 的核心按钮。 */
export function WordActions(props: WordActionProps) {
  return <Slot point="wordActions" props={props} />;
}
```

- [ ] **Step 4: 跑测试确认通过** — Run: `yarn web:typecheck && cd web && yarn vitest run src/lib src/architecture.test.ts` → PASS
- [ ] **Step 5: 提交**

```bash
git add web/src/lib/extension-points.ts web/src/lib/extension-points-react.tsx web/src/lib/extension-points.test.tsx web/src/lib/CLAUDE.md
git commit -m "feat(web): typed extension-point registry and slot renderer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task F7: 插件组合层、核心贡献、联动设置页、消费方插槽与网页架构规则

**Files:**
- Create: `web/src/plugins/{CLAUDE.md,index.ts,core.ts}`、`web/src/plugins/links/{index.ts,links-api.ts,links-config.tsx,links-settings-page.tsx,links-me-row.tsx,links-settings-page.test.tsx,links-config.test.tsx,links-contract.test.ts}`、`web/src/plugins/links/i18n/{zh-CN,en}.json`、五个联动插件桩 `web/src/plugins/{word-actions,daily-tasks,mistakes,pron-shadow,chat-words}/index.ts`(内容 `export {};` + 一行注释「由车道 Lx 实现」)、`web/src/features/vocabulary/{register.ts,word-action.tsx}`
- Modify(只附加):`web/src/main.tsx`、`web/src/app.tsx`、`web/src/features/practice/practice-page.tsx`、`web/src/pages/me-page.tsx`、`web/src/features/vocabulary/vocabulary-page.tsx`、`web/src/features/wordbook/word-card.tsx`、`web/src/test/setup.ts`、`web/src/architecture.test.ts`、`web/src/CLAUDE.md`、`web/src/features/CLAUDE.md`、`web/src/features/vocabulary/CLAUDE.md`

**Interfaces:**
- Consumes:F6 的注册表;F4 的 `/api/links/config`、`/api/links/prefs`
- Produces(`plugins/links/links-api.ts`):`LinksConfig`、`LinkItem { key; global; user; effective }`、`fetchLinksConfig(api, signal?)`、`putLinkPref(api, key, enabled)`、`LINKS_SERVER_ERRORS`
- Produces(贡献):`wordActions/vocabulary.add`(核心,order 0)、`appEffects/links.config`(核心:登录后拉取旗标)、`meRows/links.row`(`requiresLinks`)、路由 `/me/links`(`requiresLinks`)
- Produces(消费方插槽):`practiceHome`、`learningSources`、`meRows`、`notebookViews`、`wordDetailSections`、`appEffects` + `routesFor`

- [ ] **Step 1: 写失败测试**

`web/src/architecture.test.ts`:在 `violationsOf` 里追加规则(保留既有规则原样),并在 `describe` 里追加用例:

```ts
const CROSS_FEATURE_BASELINE = new Set([
  "chat->grammar", "chat->lookup", "chat->practice", "chat->realtime", "chat->vocabulary", "lookup->practice",
  "lookup->vocabulary", "practice->chat", "practice->rank", "practice->wordbook", "progress->practice",
  "progress->vocabulary", "rank->chat", "rank->practice", "realtime->chat", "rooms->chat", "rooms->vocabulary",
  "vocabulary->chat", "vocabulary->lookup", "wordbook->chat", "wordbook->rank",
]); // L1 删去五条 ->vocabulary / vocabulary->lookup 边;新增任何一条即失败
const isRegister = (rel: string) => /^features\/[^/]+\/register(-[a-z-]+)?\.tsx?$/.test(rel);

// violationsOf 内,在 `if (target.kind !== "src" || isTest(rel)) continue;` 之后追加:
//   const to = …(沿用既有变量)
    if (topOf(to) === "plugins" && rel !== "main.tsx" && !rel.startsWith("plugins/")) {
      if (!(rel === "test/setup.ts" && to === "plugins/core")) out.push(`${rel}: "${spec}" — only main.tsx composes plugins/`);
    }
    if (isRegister(to) && !rel.startsWith("plugins/")) {
      out.push(`${rel}: "${spec}" — features/*/register* is imported only by plugins/`);
    }
    if (isRegister(rel) && feature && featureOf(rel) !== feature) {
      out.push(`${rel}: "${spec}" — a register file must not import another feature`);
    }
    if (feature && featureOf(rel) && featureOf(rel) !== feature && !CROSS_FEATURE_BASELINE.has(`${featureOf(rel)}->${feature}`)) {
      out.push(`${rel}: "${spec}" — new cross-feature edge ${featureOf(rel)}->${feature}; use an extension point`);
    }
```

并把既有规则 2 的判断改为允许插件经注册文件引用 feature(`plugins/**` 引用 `features/<x>/register*` 不算触达内部文件):在 `if (feature && featureOf(rel) !== feature && to !== …)` 条件里追加 `&& !(rel.startsWith("plugins/") && isRegister(to))`。

```ts
  it("guards plugins, register files and the cross-feature baseline", () => {
    expect(violationsOf("features/chat/x.tsx", 'import "~/plugins";')).toHaveLength(1);
    expect(violationsOf("lib/x.ts", 'import "~/plugins/core";')).toHaveLength(1);
    expect(violationsOf("main.tsx", 'import "./plugins";')).toEqual([]);
    expect(violationsOf("test/setup.ts", 'import "~/plugins/core";')).toEqual([]);
    expect(violationsOf("test/setup.ts", 'import "~/plugins";')).toHaveLength(1);
    expect(violationsOf("plugins/core.ts", 'import "~/features/vocabulary/register";')).toEqual([]);
    expect(violationsOf("pages/x.tsx", 'import "~/features/vocabulary/register";')).toHaveLength(2);
    expect(violationsOf("features/wordbook/register-daily-tasks.tsx", 'import { goPractice } from "~/features/practice";')).toHaveLength(2);
    expect(violationsOf("features/progress/x.tsx", 'import { RankCard } from "~/features/rank";')).toHaveLength(1);
    expect(violationsOf("features/practice/x.tsx", 'import { RankCard } from "~/features/rank";')).toEqual([]);
  });

  // 这三个点的产品渲染点在 L1-2 / L1-3 / L2-2 才出现;为让车道文件不相交,只由 Z1 删掉整个集合
  const PENDING = new Set(["wordActions", "wordActionsMenu", "dailyTasks"]);
  it("every extension point is rendered by product code and every contribution names a real point", async () => {
    const { POINT_NAMES } = await import("~/lib/extension-points");
    const product = files.filter((f) => !isTest(f)).map((f) => readFileSync(path.join(srcRoot, f), "utf8")).join("\n");
    for (const p of POINT_NAMES) {
      if (PENDING.has(p)) continue;
      const rendered = product.includes(`point="${p}"`) || (p === "wordActions" && product.includes("<WordActions"));
      expect(rendered, `point ${p} is rendered somewhere`).toBe(true);
    }
    for (const m of product.matchAll(/point:\s*"([A-Za-z]+)"/g)) expect(POINT_NAMES).toContain(m[1]);
  });
```

(F7 只登记 `vocabulary.add`,`wordActions` 的第一个产品渲染点在 L1-2,`wordActionsMenu` 在 L1-3,`dailyTasks` 在 L2-2,所以 F7 先用 `PENDING` 跳过这三个点;L 车道不改这个集合,Z1 删除 `PENDING`,用例无白名单运行。)

`web/src/plugins/links/links-settings-page.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { ALL_OFF, getLinkFlags, setLinkFlags } from "~/lib/extension-points";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { LinksSettingsPage } from "./links-settings-page";

const CONFIG = (mistakes = true) => ({
  enabled: true,
  links: [
    { key: "word_actions", global: true, user: true, effective: true },
    { key: "daily_tasks", global: true, user: true, effective: true },
    { key: "mistakes", global: true, user: mistakes, effective: mistakes },
    { key: "pron_shadow", global: true, user: true, effective: true },
    { key: "chat_words", global: false, user: true, effective: false },
    { key: "rank_sources", global: true, user: true, effective: true },
  ],
});

beforeEach(async () => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  await i18n.changeLanguage("zh-CN");
});
afterEach(async () => {
  localStorage.removeItem("enjoy-web.settings");
  await i18n.changeLanguage("en");
  setLinkFlags(ALL_OFF);
});

describe("LinksSettingsPage", () => {
  it("lists six switches, disables the ones the admin turned off and saves a toggle", async () => {
    const mock = createFetchMock({
      "GET /api/links/config": () => json(CONFIG()),
      "PUT /api/links/prefs": () => json(CONFIG(false)),
    });
    renderWithProviders(<LinksSettingsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    const mistakes = await screen.findByRole("switch", { name: /易错词/ });
    expect(mistakes).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByRole("switch")).toHaveLength(6);
    const chat = screen.getByRole("switch", { name: /对话用到今日词/ });
    expect(chat).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("管理员已关闭")).toBeInTheDocument();
    fireEvent.click(mistakes);
    await waitFor(() => expect(mistakes).toHaveAttribute("aria-checked", "false"));
    expect(JSON.parse(String(mock.calls.at(-1)!.body))).toEqual({ key: "mistakes", enabled: false });
    expect(getLinkFlags().links.mistakes).toBe(false);
  });

  it("rolls back and shows a toast when saving fails", async () => {
    const mock = createFetchMock({
      "GET /api/links/config": () => json(CONFIG()),
      "PUT /api/links/prefs": () => json({ error: "Links are disabled" }, 404),
    });
    renderWithProviders(<LinksSettingsPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    const mistakes = await screen.findByRole("switch", { name: /易错词/ });
    fireEvent.click(mistakes);
    await waitFor(() => expect(mistakes).toHaveAttribute("aria-checked", "true"));
  });
});
```

`web/src/plugins/links/links-config.test.tsx`:

```tsx
import { waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { ALL_OFF, getLinkFlags, setLinkFlags } from "~/lib/extension-points";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { LinksConfigLoader } from "./links-config";

afterEach(() => setLinkFlags(ALL_OFF));

it("loads effective flags after login and resets them on unmount; a failure keeps everything off", async () => {
  const mock = createFetchMock({ "GET /api/links/config": () => json({ enabled: true, links: [{ key: "mistakes", global: true, user: true, effective: true }] }) });
  const view = renderWithProviders(<LinksConfigLoader />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  await waitFor(() => expect(getLinkFlags().links.mistakes).toBe(true));
  view.unmount();
  expect(getLinkFlags()).toBe(ALL_OFF);
  const broken = createFetchMock({});
  renderWithProviders(<LinksConfigLoader />, { api: new ApiClient({ getToken: () => "t", fetchImpl: broken.fetch }) });
  await waitFor(() => expect(broken.calls).toHaveLength(1));
  expect(getLinkFlags()).toBe(ALL_OFF);
});
```

`web/src/plugins/links/links-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { expect, it } from "vitest";
import type { LinkItem, LinksConfig } from "./links-api";

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(path.resolve(here, "../../../../server/tests/fixtures/links_contract.json"), "utf8"));
const CONFIG: Record<keyof LinksConfig, true> = { enabled: true, links: true };
const ITEM: Record<keyof LinkItem, true> = { key: true, global: true, user: true, effective: true };

it("matches the server's /api/links/config and /prefs shapes", () => {
  for (const name of ["config", "prefs"]) {
    const body = camelcaseKeys(contract[name], { deep: true }) as LinksConfig;
    expect(Object.keys(body).sort()).toEqual(Object.keys(CONFIG).sort());
    expect(Object.keys(body.links[0]).sort()).toEqual(Object.keys(ITEM).sort());
  }
  expect(contract.unknown).toEqual({ error: "Unknown link" });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd web && yarn vitest run src/plugins src/architecture.test.ts` → FAIL

- [ ] **Step 3: 实现**

`web/src/plugins/index.ts`(由 `main.tsx` 导入一次;**删一行 = 删一个联动**):

```ts
// 组合层(spec 2026-10-11-learning-links §8.3)。顺序无关;每行一个插件。
import "./core"; // 核心贡献:加入生词本(任何开关下都在)
import "./links"; // 联动配置加载、我的 → 学习联动、/me/links
import "./word-actions"; // 1 单词操作位置
import "./daily-tasks"; // 2 今日任务聚合卡
import "./mistakes"; // 3 易错词
import "./pron-shadow"; // 4 发音弱词 ↔ 跟读
import "./chat-words"; // 5 对话用到今日词(6 段位点来源只在服务端)
```

`web/src/plugins/core.ts`:`import "~/features/vocabulary/register";`

`web/src/features/vocabulary/word-action.tsx`:

```tsx
import type { WordActionProps } from "~/lib/extension-points";
import { AddVocabularyButton } from "./add-vocabulary-button";

/** wordActions 插槽里的核心贡献:与原先直接渲染 AddVocabularyButton 完全相同(同 testId、无障碍名、状态)。 */
export function AddVocabularyAction({ target, testId, label, variant }: WordActionProps) {
  return <AddVocabularyButton testId={testId} label={label} withLabel={variant === "labeled"} input={target} />;
}
```

`web/src/features/vocabulary/register.ts`:

```ts
import { contribute } from "~/lib/extension-points";
import { AddVocabularyAction } from "./word-action";

contribute({ point: "wordActions", id: "vocabulary.add", order: 0, component: AddVocabularyAction });
```

`web/src/plugins/links/links-api.ts`:

```ts
import type { ApiClient } from "~/api/client";
import type { LinkKey } from "~/lib/extension-points";

export interface LinkItem { key: LinkKey; global: boolean; user: boolean; effective: boolean }
export interface LinksConfig { enabled: boolean; links: LinkItem[] }
export const LINKS_SERVER_ERRORS: Record<string, string> = {
  "Links are disabled": "web.links.errors.disabled",
  "Link is off": "web.links.errors.off",
  "Unknown link": "web.links.errors.unknown",
  "Word not found": "web.links.errors.wordNotFound",
  "Wordbook is disabled": "web.links.errors.wordbookOff",
  "Wordbook data unavailable": "web.links.errors.wordbookData",
};
export const fetchLinksConfig = (api: ApiClient, signal?: AbortSignal) => api.request<LinksConfig>("GET", "/api/links/config", { signal });
export const putLinkPref = (api: ApiClient, key: LinkKey, enabled: boolean) =>
  api.request<LinksConfig>("PUT", "/api/links/prefs", { json: { key, enabled } });
```

`web/src/plugins/links/links-config.tsx`:

```tsx
import { useEffect } from "react";
import { useAuth } from "~/auth/auth-context";
import { ALL_OFF, flagsFromConfig, setLinkFlags } from "~/lib/extension-points";
import { fetchLinksConfig } from "./links-api";

/** appEffects 贡献:登录后拉取一次每用户旗标;失败保持全关(= 今天);卸载(退出登录)时复位。 */
export function LinksConfigLoader() {
  const { api } = useAuth();
  useEffect(() => {
    const controller = new AbortController();
    fetchLinksConfig(api, controller.signal).then(
      (config) => { if (!controller.signal.aborted) setLinkFlags(flagsFromConfig(config)); },
      () => {},
    );
    return () => { controller.abort(); setLinkFlags(ALL_OFF); };
  }, [api]);
  return null;
}
```

`web/src/plugins/links/links-settings-page.tsx`:页头 `PageHeader title={t("web.links.settings.title")} back="/me"`;说明一段 `web.links.settings.lede`;`SectionGroup` 内六个 `ListRow`,每行标题 `web.links.names.<key>`、副标题 `web.links.desc.<key>`(全局关时副标题换成 `web.links.settings.adminOff`「管理员已关闭」),`trailing` 为开关按钮:`<button role="switch" aria-checked={effective} aria-disabled={!global} aria-label={title} data-testid={`link-switch-${key}`}>`(视觉沿用 settings 里现有开关的样式;命中区 44px);点击:乐观更新本地状态 → `putLinkPref` → 成功用返回的配置 `setLinkFlags(flagsFromConfig(...))` 并刷新列表;失败回滚并 `toast.error(translateServerError(t, err, LINKS_SERVER_ERRORS))`。加载中显示 `PageLoading` 等同骨架;加载失败显示重试。

`web/src/plugins/links/links-me-row.tsx`:`<ListRow icon={<IconChip tone="blue" icon={Link2Icon} />} title={t("web.links.settings.title")} subtitle={t("web.links.settings.rowSubtitle", { on, total })} to="/me/links" testId="me-links" />`(`on` = 有效联动数,来自 `useLinkFlags()`)。

`web/src/plugins/links/index.ts`:

```ts
import { contribute, contributeRoute } from "~/lib/extension-points";
import { LinksConfigLoader } from "./links-config";
import { LinksMeRow } from "./links-me-row";
import { LinksSettingsPage } from "./links-settings-page";

contribute({ point: "appEffects", id: "links.config", component: LinksConfigLoader });
contribute({ point: "meRows", id: "links.row", order: 90, requiresLinks: true, component: LinksMeRow });
contributeRoute({ id: "links.settings", path: "/me/links", requiresLinks: true, component: LinksSettingsPage });
```

`web/src/plugins/links/i18n/zh-CN.json`(en 同键英文):

```json
{
  "web": {
    "links": {
      "names": { "word_actions": "单词操作位置", "daily_tasks": "今日任务聚合卡", "mistakes": "易错词",
                 "pron_shadow": "发音弱词与跟读", "chat_words": "对话用到今日词", "rank_sources": "联动加段位点" },
      "desc": { "word_actions": "生词本按钮旁多一个「更多」:加入词书学习、跟读、看词卡",
                "daily_tasks": "练习页汇总今天该做的几件事",
                "mistakes": "背单词答错的词自动进生词本「易错词」",
                "pron_shadow": "跟读低分的词进「发音弱词」;今日新词例句一键跟读",
                "chat_words": "对话里用到今天学的新词会被记下来",
                "rank_sources": "联动记录可以给段位加少量积分" },
      "settings": { "title": "学习联动", "lede": "让背单词、跟读、对话和段位互相配合。每一项都可以单独关闭。",
                    "adminOff": "管理员已关闭", "rowSubtitle": "已开启 {{on}}/{{total}}", "saveFailed": "保存失败,已恢复" },
      "errors": { "disabled": "学习联动未开启", "off": "这个联动已关闭", "unknown": "未知的联动",
                  "wordNotFound": "词书里没有这个词", "wordbookOff": "背单词未开启", "wordbookData": "词书数据暂不可用" }
    }
  }
}
```

消费方插槽(只附加;锚点见「共享文件插入点」):`practice-page.tsx` 两处 + `<div id="shadowing" />`;`me-page.tsx` 一处;`vocabulary-page.tsx`:锚点 `<SectionGroup title={t("web.vocabulary.all")} bare>`(现 278 行)之前插入 `<Slot point="notebookViews" props={{}} />`;`word-card.tsx` 一处;`app.tsx`:`AppRoutes` 顶部 `const routes = routesFor(useLinkFlags()).map((r) => <Route key={r.id} path={r.path} element={<r.component />} />);`,`<Route element={<AppShell />}>` 换成 `<Route element={<><Slot point="appEffects" props={{}} /><AppShell /></>}>`,`<Route path="/me" element={<MePage />} />` 之后插入 `{routes}`;`main.tsx`:`import "./plugins";`。

`web/src/test/setup.ts`:`import "~/i18n";` 之后加 `import "~/plugins/core";`;`afterEach` 里加 `setLinkFlags(ALL_OFF)`(从 `~/lib/extension-points` 导入)。

`web/src/plugins/CLAUDE.md`:

```markdown
# web/src/plugins/

组合层(spec `docs/superpowers/specs/2026-10-11-learning-links-design.md` §8):把各 feature 的 `register*.ts(x)` 与联动自己的界面
登记进 `~/lib/extension-points`。`index.ts` 一行一个插件:删一行 = 删一个联动。

## What lives here
- `index.ts`(由 `main.tsx` 导入)、`core.ts`(核心贡献;`test/setup.ts` 只导入它)
- `links/`(旗标加载、学习联动设置页与「我的」一行)、`word-actions/`、`daily-tasks/`、`mistakes/`、`pron-shadow/`、`chat-words/`

## Allowed dependencies
`lib/`、`api/`、`components/`、`layout/`、`auth/`、`settings/`、`i18n/`、`@renderer/*`;feature 只经 `~/features/<x>`(index)或
`~/features/<x>/register*`。只有 `main.tsx` 导入本目录(`test/setup.ts` 可导入 `core`)。

## Test
`cd web && yarn vitest run src/plugins`;联动测试自己导入所需插件并 `setLinkFlags(...)`;`afterEach` 已统一复位为全关。

## Pitfalls
- 注册文件在启动时执行:只导入轻组件,重组件用 `lazy()`;主包增长有验收上限。
- 联动文案放各插件 `i18n/`(键 `web.links.<x>.*`),即使由 feature 的注册文件渲染。
- 旗标未加载前全关;任何贡献都不能假设旗标已到。
```

`web/src/CLAUDE.md` 的 Layers 加「`plugins/`:组合层,只被 `main.tsx` 导入」;`web/src/features/CLAUDE.md` Rules 加「跨 feature 新边被基线禁止;要联动就登记扩展点(`register*.ts(x)`,只被 plugins 导入)」;`features/vocabulary/CLAUDE.md` What lives here 加 `register.ts`、`word-action.tsx`。

- [ ] **Step 4: 跑测试确认通过** — Run: `yarn web:typecheck && cd web && yarn vitest run src/plugins src/lib src/architecture.test.ts src/features/practice src/features/vocabulary src/features/wordbook src/pages` → PASS(既有测试不改);`yarn web:test` 全量 → PASS;`yarn web:build` 记录主包体积(与 Task 0 比较,增长 ≤ 8 kB)。
- [ ] **Step 5: 视觉检查** — `yarn web:dev`,服务端 `LINKS_ENABLED=true`:「我的 → 学习」出现「学习联动 已开启 6/6」;进入后六个开关,对照视觉稿帧 05(浅色;深色按帧 06 的令牌);关掉总开关刷新:行消失、`/me/links` 回到练习页。
- [ ] **Step 6: 提交**

```bash
git add web/src/plugins web/src/features/vocabulary/register.ts web/src/features/vocabulary/word-action.tsx web/src/features/vocabulary/CLAUDE.md web/src/main.tsx web/src/app.tsx web/src/features/practice/practice-page.tsx web/src/pages/me-page.tsx web/src/features/vocabulary/vocabulary-page.tsx web/src/features/wordbook/word-card.tsx web/src/test/setup.ts web/src/architecture.test.ts web/src/CLAUDE.md web/src/features/CLAUDE.md
git commit -m "feat(web): plugin composition layer, link settings page and consumer slots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Lane L6 · 段位点来源注册(`rank_sources`)

### Task L6-1: `rank/extra_sources.py`、`PointsRule` 两个新字段、`ledger._sync` 附加四行(另一行导入)

**Files:**
- Create: `server/app/rank/extra_sources.py`、`server/tests/test_rank_extra_sources.py`
- Modify: `server/app/rank/ledger.py`(一行导入 + 四行附加,见 Step 3)、`server/app/rank/rules.py`(`PointsRule` 加两个字段 + 一行导入)、`server/app/rank/CLAUDE.md`

**Interfaces:**
- Produces(`app.rank.extra_sources`):`DEFAULT_SUB_CAP = 5`、`MAX_ROWS = 2000`、`points_of(source, rules) -> int`、`sub_cap(rules) -> int`、`async collect(session, user_id, since, now, offset_minutes, rules=None) -> tuple[list[Candidate], datetime | None]`、`async capped(session, user_id, extra, batch, daily_cap, rules=None) -> list[Candidate]`
- Produces(`PointsRule`):`sources: dict[str, int] = {}`(键 `^[a-z_]{1,16}$`,值 0–100)、`sources_daily_cap: int = 5`(0–100)
- Consumes:`app.core.rank_sources`(F2)、`app.models.LinkCredit`(F3)

- [ ] **Step 1: 写失败测试** — `server/tests/test_rank_extra_sources.py`:

```python
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import event, select

from app.core import rank_sources
from app.core.rank_sources import RankSource
from app.models import Conversation, LinkCredit, Message, RankProfile, XpEvent
from app.rank import extra_sources, ledger
from app.rank.rules import DEFAULT_RULES, rules_from_json, rules_json

SRC = RankSource("word_in_chat", 1, "对话用到新词", "New word used in chat")
DAY = datetime(2026, 10, 11, 4, 0, tzinfo=timezone.utc)  # 12:00 local at +480
NOW = DAY + timedelta(hours=1)


@pytest.fixture(autouse=True)
def registry():
    saved = rank_sources.registered()
    rank_sources.clear_for_tests()
    yield
    rank_sources.clear_for_tests()
    for s in saved:
        rank_sources.register(s)


def statements(engine):
    seen = []

    def before(conn, cursor, statement, params, context, executemany):
        seen.append(statement)
    event.listen(engine.sync_engine, "before_cursor_execute", before)
    return seen, lambda: event.remove(engine.sync_engine, "before_cursor_execute", before)


async def user(client, name):
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return int((await client.get("/api/me", headers=h)).json()["id"])


async def seed_messages(app, uid, n, at):
    async with app.state.sessionmaker() as s:
        conv = Conversation(id=str(uuid.uuid4()), user_id=uid, name="c", config={}, created_at=at, updated_at=at)
        s.add(conv)
        for i in range(n):
            s.add(Message(id=str(uuid.uuid4()), conversation_id=conv.id, role="user", content="x",
                          created_at=at + timedelta(seconds=i)))
        await s.commit()


async def seed_credits(app, uid, n, at, prefix="wic"):
    async with app.state.sessionmaker() as s:
        for i in range(n):
            s.add(LinkCredit(user_id=uid, kind="word_in_chat", ref_id=f"{prefix}:{i}", score=None,
                             created_at=at + timedelta(seconds=i)))
        await s.commit()


async def run_sync(app, uid, cap=60, rules=None):
    async with app.state.sessionmaker() as s:
        await ledger.sync(s, uid, NOW, 480, cap, rules=rules)
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(XpEvent).where(XpEvent.user_id == uid).order_by(XpEvent.created_at, XpEvent.id))).all()
    return [(e.kind, e.ref_id, e.points) for e in rows]


async def test_an_empty_registry_issues_no_query(app):
    seen, stop = statements(app.state.engine)
    async with app.state.sessionmaker() as s:
        assert await extra_sources.collect(s, 1, DAY - timedelta(days=1), NOW, 480) == ([], None)
        assert await extra_sources.capped(s, 1, [], [], 60) == []
    stop()
    assert seen == []


async def test_a_registered_source_without_rows_changes_nothing(app, client):
    a, b = await user(client, "a"), await user(client, "b")
    for uid in (a, b):
        await seed_messages(app, uid, 5, DAY)
    base = await run_sync(app, a)
    rank_sources.register(SRC)
    with_source = await run_sync(app, b)
    assert sorted((k, p) for k, _, p in base) == sorted((k, p) for k, _, p in with_source)


async def test_credits_only_take_the_leftover_and_never_reduce_core_points(app, client):
    rank_sources.register(SRC)
    a, b = await user(client, "a"), await user(client, "b")
    await seed_credits(app, b, 3, DAY - timedelta(minutes=30))  # earlier in the day than the chat
    for uid in (a, b):
        await seed_messages(app, uid, 4, DAY)
    plain, mixed = await run_sync(app, a, cap=5), await run_sync(app, b, cap=5)
    core = lambda events: sorted(p for k, _, p in events if k == "chat_turn")  # noqa: E731
    assert core(plain) == core(mixed) == [1, 1, 1, 1]
    assert [p for k, _, p in mixed if k == "word_in_chat"] == [1, 0, 0]  # cap 5 - 4 core points = 1 left
    assert len([k for k, _, _ in mixed if k == "word_in_chat"]) == 3  # trimmed rows stay (never re-evaluated)
    assert await run_sync(app, b, cap=5) == mixed  # idempotent


async def test_sub_cap_and_points_from_published_rules(app, client):
    rank_sources.register(SRC)
    a, b = await user(client, "a"), await user(client, "b")
    await seed_credits(app, a, 7, DAY)
    assert sorted(p for k, _, p in await run_sync(app, a) if k == "word_in_chat") == [0, 0, 1, 1, 1, 1, 1]
    rules = DEFAULT_RULES.model_copy(update={"points": DEFAULT_RULES.points.model_copy(
        update={"sources": {"word_in_chat": 3}, "sources_daily_cap": 4})})
    await seed_credits(app, b, 3, DAY)
    assert [p for k, _, p in await run_sync(app, b, rules=rules) if k == "word_in_chat"] == [3, 1, 0]


async def test_credits_alone_make_no_active_day_and_no_stage_progress(app, client):
    rank_sources.register(SRC)
    uid = await user(client, "a")
    await seed_credits(app, uid, 2, DAY)
    assert {k for k, _, _ in await run_sync(app, uid)} == {"word_in_chat"}
    async with app.state.sessionmaker() as s:
        tasks = await ledger.stage_progress_for(s, await s.get(RankProfile, uid))
    assert tasks and all(t.done == 0 for t in tasks)


def test_points_rule_fields_default_for_old_json_and_are_bounded():
    old = rules_json(DEFAULT_RULES)
    del old["points"]["sources"], old["points"]["sources_daily_cap"]
    parsed = rules_from_json(old)
    assert (parsed.points.sources, parsed.points.sources_daily_cap) == ({}, 5)
    assert rules_from_json(rules_json(DEFAULT_RULES)) == DEFAULT_RULES
    for bad in ({"Bad-Key": 1}, {"word_in_chat": 101}, {"x" * 17: 1}):
        data = rules_json(DEFAULT_RULES)
        data["points"]["sources"] = bad
        with pytest.raises(ValidationError):
            rules_from_json(data)
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_rank_extra_sources.py` → FAIL

- [ ] **Step 3: 实现**

`server/app/rank/extra_sources.py`:

```python
"""段位的联动来源(spec 2026-10-11-learning-links §5.3–5.4)。只经 app.models.LinkCredit 读;不导入 app.links。

既有种类的点数永远不因联动而变少:联动来源不进 cap_daily,只吃当天共享上限的剩余额度,并另有子上限。"""
from collections import defaultdict
from dataclasses import replace
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import rank_sources
from app.models import LinkCredit, XpEvent
from app.rank import points as rules_mod
from app.rank.points import Candidate
from app.services import usage
from app.services.stats import as_utc

DEFAULT_SUB_CAP = 5
MAX_ROWS = 2000


def points_of(source: rank_sources.RankSource, rules=None) -> int:
    if rules is None:
        return source.default_points
    return int(getattr(rules.points, "sources", {}).get(source.kind, source.default_points))


def sub_cap(rules=None) -> int:
    return DEFAULT_SUB_CAP if rules is None else int(getattr(rules.points, "sources_daily_cap", DEFAULT_SUB_CAP))


async def collect(session: AsyncSession, user_id: int, since: datetime, now: datetime, offset_minutes: int,
                  rules=None) -> tuple[list[Candidate], datetime | None]:
    """登记过的来源在 since 之后的事实 → 候选;注册表为空时不发查询。满 MAX_ROWS 时返回水位。"""
    sources = {s.kind: s for s in rank_sources.registered()}
    if not sources:
        return [], None
    rows = (await session.execute(
        select(LinkCredit.kind, LinkCredit.ref_id, LinkCredit.score, LinkCredit.created_at)
        .where(LinkCredit.user_id == user_id, LinkCredit.kind.in_(sources), LinkCredit.created_at >= since)
        .order_by(LinkCredit.created_at).limit(MAX_ROWS))).all()
    out = [Candidate(kind, ref, usage.local_day(at, offset_minutes), points_of(sources[kind], rules), score, as_utc(at))
           for kind, ref, score, at in rows]
    return out, (as_utc(rows[-1][3]) if len(rows) >= MAX_ROWS else None)


async def capped(session: AsyncSession, user_id: int, extra: list[Candidate], batch: list[Candidate], daily_cap: int,
                 rules=None) -> list[Candidate]:
    """grant = min(points, cap − core_used − extra_used, sub_cap − extra_used);被削到 0 的仍返回(写 0 分行)。"""
    if not extra:
        return []
    kinds = rank_sources.kinds()
    days = {c.day for c in extra}
    rows = (await session.execute(
        select(XpEvent.day, XpEvent.kind, func.sum(XpEvent.points))
        .where(XpEvent.user_id == user_id, XpEvent.day.in_(days), XpEvent.kind.in_(rules_mod.CAPPED | kinds))
        .group_by(XpEvent.day, XpEvent.kind))).all()
    core: dict[str, int] = defaultdict(int)
    mine: dict[str, int] = defaultdict(int)
    for day, kind, total in rows:
        (mine if kind in kinds else core)[day] += int(total or 0)
    for c in batch:
        if c.kind in rules_mod.CAPPED and c.day in days:
            core[c.day] += c.points
    limit = sub_cap(rules)
    out: list[Candidate] = []
    for c in sorted(extra, key=lambda x: (x.created_at, x.kind, x.ref_id)):
        grant = max(0, min(c.points, daily_cap - core[c.day] - mine[c.day], limit - mine[c.day]))
        mine[c.day] += grant
        out.append(replace(c, points=grant))
    return out
```

`server/app/rank/ledger.py`(只附加;`git diff` 只应出现这五行):导入块 `from app.rank.tiers import …` 之后加 `from app.rank import extra_sources`;`_sync` 里 `events = rules.cap_daily(fresh, used, daily_cap)` 之后加:

```python
    extra, extra_mark = await extra_sources.collect(session, user_id, since, now, offset_minutes, rank_rules)
    if extra_mark is not None:
        watermark = min(watermark, extra_mark)
    events += await extra_sources.capped(session, user_id, [c for c in extra if (c.kind, c.ref_id) not in seen], events,
                                         daily_cap, rank_rules)
```

`server/app/rank/rules.py`:导入加 `from typing import Annotated` 与 `StringConstraints`(from pydantic);`PointsRule` 里 `spelling_set` 之后加:

```python
    # learning links (spec 2026-10-11-learning-links §5.3): defaults keep older published rule JSON parseable
    sources: dict[Annotated[str, StringConstraints(pattern=r"^[a-z_]{1,16}$")], Annotated[int, Field(ge=0, le=100)]] = \
        Field(default_factory=dict)
    sources_daily_cap: int = Field(5, ge=0, le=100)
```

`server/app/rank/CLAUDE.md` What lives here 加 `extra_sources.py – learning-link point sources: reads app.models.LinkCredit for kinds in core.rank_sources, fills only the daily cap's leftover (sub-cap points.sources_daily_cap), never feeds stage tasks / active days. Never import app.links`;Rules threading 加一句「`points.sources` / `sources_daily_cap` 跟随规则版本」。

- [ ] **Step 4: 跑测试确认通过,并证明既有段位测试未改** — Run: `cd server && uv run pytest -q tests/test_rank_extra_sources.py tests/test_rank_*.py tests/test_admin_rank*.py tests/test_architecture.py` → PASS;`git diff --stat origin/main -- server/tests/test_rank_*.py server/tests/test_admin_rank*.py` 只列出新文件 `test_rank_extra_sources.py`(既有文件零改动);`git diff origin/main -- server/app/rank/ledger.py` 只有上述五行新增、零删除。
- [ ] **Step 5: 提交**

```bash
git add server/app/rank/extra_sources.py server/app/rank/ledger.py server/app/rank/rules.py server/app/rank/CLAUDE.md server/tests/test_rank_extra_sources.py
git commit -m "feat(server): rank reads learning-link point sources from the leftover daily cap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L6-2: `rank_sources` 联动说明、管理端规则编辑器往返、网页「最近获得」标签

**Files:**
- Modify: `server/app/links/rank_sources.py`(替换 F4 桩)、`admin/src/features/rank/{api.ts,rules-schema.ts,rules-schema.test.ts,strings.ts}`、`admin/src/features/rank/rules-tabs/points-tab.tsx`、`web/src/features/rank/rank-home-page.tsx`(`RECENT_KINDS` 加 `"word_in_chat"`)、`web/src/features/rank/i18n/{zh-CN,en}.json`(`recent.word_in_chat`)

**Interfaces:**
- Produces(admin):`PointsRule.sources?: Record<string, number>`、`PointsRule.sources_daily_cap?: number`、`RANGES.sources_daily_cap = [0, 100]`;`outOfRange` 检查这两个字段
- Consumes:L6-1 的规则字段

- [ ] **Step 1: 写失败测试** — `admin/src/features/rank/rules-schema.test.ts` 追加:

```ts
it("keeps learning-link sources when other point fields are edited and range-checks them", () => {
  const r = structuredClone(sampleRules()); // 文件里现有的样例构造函数
  r.points.sources = { word_in_chat: 2 };
  r.points.sources_daily_cap = 5;
  const edited = { ...r, points: { ...r.points, chat_turn: 3 } };
  expect(edited.points.sources).toEqual({ word_in_chat: 2 });
  expect(outOfRange(edited)).toEqual([]);
  edited.points.sources = { word_in_chat: 101 };
  edited.points.sources_daily_cap = 101;
  expect(outOfRange(edited)).toEqual(["points.sources.word_in_chat", "points.sources_daily_cap"]);
});
```

(若现有测试文件的样例构造函数名不同,用文件里已有的那个;不新增夹具。)`web/src/features/rank/rank-home-page.test.tsx` 不改;新增断言放进 `web/src/features/rank/i18n` 的键对齐由 `i18n.test.ts` 自动覆盖。

- [ ] **Step 2: 跑测试确认失败** — Run: `cd admin && yarn vitest run src/features/rank` → FAIL

- [ ] **Step 3: 实现**
- `server/app/links/rank_sources.py`:

```python
"""联动段位点(spec §6.6)。本联动不订阅事件:它是 gate 键(全站开关 + 每用户「联动加段位点」)。
具体来源由各联动登记(chat_words 登记 word_in_chat);段位经 app.rank.extra_sources 读取。"""
from app.links.spec import LinkSpec

SPEC = LinkSpec("rank_sources", "联动段位点", "Rank points from links")
```

- admin:`api.ts` 的 `PointsRule` 加两个可选字段(注释「学习联动(spec 2026-10-11 §5.3);旧规则没有,服务端按 {} / 5 解析」);`rules-schema.ts` 的 `RANGES` 加 `sources_daily_cap: [0, 100]`,`outOfRange` 在点数检查之后对 `Object.entries(r.points.sources ?? {})` 逐项 `check("points.sources." + k, "points", v)`,再 `check("points.sources_daily_cap", "sources_daily_cap", r.points.sources_daily_cap ?? 5)`;`points-tab.tsx` 在固定点数表之后加「联动来源」小节:`sources_daily_cap` 数字输入(标签 `strings.sourcesDailyCap`「联动来源每日上限」)与 `sources` 键值表(每行 kind 只读 + 点数输入;空时显示「还没有联动来源;启用学习联动后,来源列表见「学习联动」页」);编辑时用展开运算保留未改字段。
- web:`RECENT_KINDS` 集合加 `"word_in_chat"`;`zh-CN.json` 的 `recent` 加 `"word_in_chat": "对话用到新词"`,`en.json` 加 `"word_in_chat": "New word in chat"`。

- [ ] **Step 4: 跑测试确认通过** — Run: `cd admin && yarn vitest run src/features/rank`;`yarn web:typecheck && cd web && yarn vitest run src/features/rank src/i18n`;`cd server && uv run pytest -q tests/test_links_api.py tests/test_architecture.py` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/app/links/rank_sources.py admin/src/features/rank web/src/features/rank
git commit -m "feat(rank): link point sources in rank rules editor and recent-points label

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Lane L1 · 单词操作位置(`word_actions`)

### Task L1-1: 服务端「加入词书学习」与「查看词卡」接口

**Files:**
- Modify: `server/app/links/word_actions.py`(替换 F4 桩)
- Create: `server/tests/test_links_word_actions.py`、`server/tests/fixtures/links_word_actions_contract.json`(录制)

**Interfaces:**
- Produces(HTTP):`POST /api/links/wordbook/adopt {"word"}` → `{"status": "added"|"known"|"not_in_book", "book_id": str|null}`;`GET /api/links/wordbook/card?word=` → `{"book_id", "card", "item"}`,404 `Word not found`;背单词关 → 404 `Wordbook is disabled`;联动无效 → 404 `Link is off`;数据缺失 → 503 `Wordbook data unavailable`
- Consumes:`app.wordbook.{store,service,index,books}`(links 可以导入 wordbook)、`require_link`、`WordIn`

- [ ] **Step 1: 写失败测试** — `server/tests/test_links_word_actions.py`:

```python
from sqlalchemy import func, select

from app.models import VocabularyItem, WordbookEvent, utcnow
from app.services.stats import as_utc
from tests.links_helpers import check_contract, enable_links
from tests.wordbook_helpers import enable_wordbook, make_data_dir

URL = "/api/links/wordbook"


async def login(app, client, tmp_path, *, enroll=True, **flags):
    enable_wordbook(app, make_data_dir(tmp_path))
    enable_links(app, **flags)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    if enroll:
        await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    return h


async def test_adopt_creates_a_due_box0_item_without_a_learn_event(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    assert (await client.post(f"{URL}/adopt", headers=h, json={"word": " Talk "})).json() == {"status": "added", "book_id": "junior"}
    async with app.state.sessionmaker() as s:
        item = (await s.scalars(select(VocabularyItem))).one()
        assert (item.word, item.box, item.source, item.reps) == ("talk", 0, "wordbook:junior", 0)
        assert as_utc(item.due_at) <= utcnow()
        assert await s.scalar(select(func.count()).select_from(WordbookEvent)) == 0  # no learn event, no rank points
    assert (await client.post(f"{URL}/adopt", headers=h, json={"word": "talk"})).json()["status"] == "known"
    assert (await client.post(f"{URL}/adopt", headers=h, json={"word": "zebra"})).json() == {"status": "not_in_book", "book_id": "junior"}
    await client.post("/api/vocabulary", headers=h, json={"word": "ability", "source": "lookup"})
    assert (await client.post(f"{URL}/adopt", headers=h, json={"word": "ability"})).json()["status"] == "known"


async def test_adopt_without_an_active_book_and_when_switched_off(app, client, tmp_path):
    h = await login(app, client, tmp_path, enroll=False)
    assert (await client.post(f"{URL}/adopt", headers=h, json={"word": "talk"})).json() == {"status": "not_in_book", "book_id": None}
    app.state.settings = app.state.settings.model_copy(update={"link_word_actions_enabled": False})
    r = await client.post(f"{URL}/adopt", headers=h, json={"word": "talk"})
    assert (r.status_code, r.json()) == (404, {"error": "Link is off"})
    app.state.settings = app.state.settings.model_copy(update={"link_word_actions_enabled": True, "wordbook_enabled": False})
    r = await client.post(f"{URL}/adopt", headers=h, json={"word": "talk"})
    assert (r.status_code, r.json()) == (404, {"error": "Wordbook is disabled"})
    assert (await client.post(f"{URL}/adopt", headers=h, json={"word": ""})).status_code == 422


async def test_card_lookup_prefers_the_active_book_and_records_the_contract(app, client, tmp_path):
    h = await login(app, client, tmp_path)
    body = (await client.get(f"{URL}/card", headers=h, params={"word": "Talk"})).json()
    assert body["book_id"] == "junior" and body["card"]["key"] == "talk" and body["item"] is None
    missing = await client.get(f"{URL}/card", headers=h, params={"word": "zebra"})
    assert (missing.status_code, missing.json()) == (404, {"error": "Word not found"})
    assert (await client.get(f"{URL}/card", headers=h, params={"word": "a\x00b"})).status_code == 422
    added = (await client.post(f"{URL}/adopt", headers=h, json={"word": "talk"})).json()
    after = (await client.get(f"{URL}/card", headers=h, params={"word": "talk"})).json()
    assert after["item"]["box"] == 0
    check_contract("links_word_actions_contract", {"adopt": added, "card": after, "missing": missing.json()})
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_links_word_actions.py` → FAIL(404 Not Found)

- [ ] **Step 3: 实现** — `server/app/links/word_actions.py`:

```python
"""单词操作位置(spec §6.1):「加入词书学习」与「查看词卡」。不写 learn 事件、不得段位点、不推进书序游标(L-R8)。"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_session
from app.links.gate import require_link
from app.links.spec import LinkSpec, WordIn
from app.models import User, utcnow
from app.services.vocabulary import validate_word
from app.wordbook import service, store
from app.wordbook.books import enabled_books
from app.wordbook.index import DataUnavailable, dictionary

router = APIRouter(prefix="/wordbook")


def _wordbook_on(request: Request):
    settings = request.app.state.settings
    if not settings.wordbook_enabled:
        raise HTTPException(404, "Wordbook is disabled")
    return settings


@router.post("/adopt")
async def adopt(payload: WordIn, request: Request, user: User = Depends(require_link("word_actions", limited=True)),
                session: AsyncSession = Depends(get_session)):
    settings = _wordbook_on(request)
    e = await store.active_enrollment(session, user.id)
    if e is None or e.book_id not in enabled_books(settings.wordbook_books):
        return {"status": "not_in_book", "book_id": None}
    ds = dictionary(request.app)
    await service.ensure_hidden(session, ds)
    try:
        card = await ds.card(e.book_id, payload.word)
    except DataUnavailable:
        raise HTTPException(503, "Wordbook data unavailable")
    if card is None:
        return {"status": "not_in_book", "book_id": e.book_id}
    if await store.known_one(session, user.id, card.key) is not None:  # 任何来源的词条都算(R-W3)
        return {"status": "known", "book_id": e.book_id}
    now = utcnow()
    await store.create_item(session, user.id, e.book_id, card, box=0, due_at=now, now=now)
    await session.commit()
    return {"status": "added", "book_id": e.book_id}


@router.get("/card")
async def card(request: Request, word: str = Query(min_length=1, max_length=200),
               user: User = Depends(require_link("word_actions")), session: AsyncSession = Depends(get_session)):
    settings = _wordbook_on(request)
    try:
        key = validate_word(word)
    except ValueError:
        raise HTTPException(422, "Invalid word")
    ds = dictionary(request.app)
    await service.ensure_hidden(session, ds)
    e = await store.active_enrollment(session, user.id)
    enabled = enabled_books(settings.wordbook_books)
    books = [e.book_id] if e is not None and e.book_id in enabled else []
    books += [b for b in enabled if b not in books]
    for book_id in books:  # 同 service.find_card 的顺序,但要返回书 id
        try:
            found = await ds.card(book_id, key)
        except DataUnavailable:
            continue
        if found is not None:
            item = await store.known_one(session, user.id, found.key)
            return {"book_id": book_id, "card": service.card_out(found), "item": service.item_out(item)}
    raise HTTPException(404, "Word not found")


SPEC = LinkSpec("word_actions", "单词操作位置", "Word actions", router=router)
```

- [ ] **Step 4: 录契约并跑测试** — `CONTRACT_UPDATE=1 uv run pytest -q tests/test_links_word_actions.py`,再不带变量跑一次 + `tests/test_links_api.py tests/test_architecture.py` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/app/links/word_actions.py server/tests/test_links_word_actions.py server/tests/fixtures/links_word_actions_contract.json
git commit -m "feat(server): word-actions link adopts a word into wordbook study and shows its card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L1-2: 四处 `AddVocabularyButton` 换成 `<WordActions>`(行为逐字节相同)与查词目标搬家

**Files:**
- Create: `web/src/features/lookup/word-target.ts`、`web/src/features/lookup/word-target.test.ts`、`web/src/plugins/word-actions/parity.test.tsx`
- Modify: `web/src/features/chat/conversation-page.tsx`(导入一行 + 两处 JSX)、`web/src/features/lookup/lookup-layer.tsx`(导入两行 + 一处 JSX)、`web/src/features/progress/progress-page.tsx`(导入一行 + 一处 JSX)、`web/src/features/rooms/extras/summary-page.tsx`(导入一行 + 一处 JSX)、`web/src/features/vocabulary/{index.ts,save-vocabulary-item.ts,save-vocabulary-item.test.ts,CLAUDE.md}`、`web/src/features/lookup/CLAUDE.md`、`web/src/architecture.test.ts`(基线删五条边 + 一个新用例;不动 `PENDING`)

**Interfaces:**
- Produces(`features/lookup/word-target.ts`,lookup 内部):`wordTargetFromLookup(result: LookupResult, selection: TextSelectionInfo): WordTarget`
- Removes:`vocabularyFromLookup`(vocabulary 公共面);边 `chat->vocabulary`、`lookup->vocabulary`、`progress->vocabulary`、`rooms->vocabulary`、`vocabulary->lookup`

- [ ] **Step 1: 写失败测试**

`web/src/features/lookup/word-target.test.ts`(原 `save-vocabulary-item.test.ts` 的「maps a lookup result (R19)」两条断言原样搬来,另加两条边界):

```ts
import { describe, expect, it } from "vitest";
import { wordTargetFromLookup } from "./word-target";

const lookup = { word: "country", lemma: "country", pronunciation: "ˈkʌntri", pos: "noun", definition: "a nation", translation: "国家", contextTranslation: "" };

describe("wordTargetFromLookup (moved from vocabulary, R19)", () => {
  it("maps a lookup result exactly as vocabularyFromLookup did", () => {
    expect(wordTargetFromLookup(lookup, { text: "Country", context: "ask not what your  country can do" }))
      .toEqual({ word: "country", meaning: "noun · 国家 · a nation", example: "ask not what your country can do", source: "lookup" });
    expect(wordTargetFromLookup({ ...lookup, word: "", pos: "", definition: "" }, { text: " Hello ", context: "hello" }))
      .toEqual({ word: "Hello", meaning: "国家", example: undefined, source: "lookup" });
  });

  it("clips by code points", () => {
    const long = "𝒜".repeat(600);
    const t = wordTargetFromLookup({ ...lookup, definition: "d".repeat(2000) }, { text: "country", context: long });
    expect(Array.from(t.example ?? "")).toHaveLength(500);
    expect(Array.from(t.meaning ?? "")).toHaveLength(1000);
  });
});
```

`web/src/plugins/word-actions/parity.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { AddVocabularyButton } from "~/features/vocabulary";
import { WordActions } from "~/lib/extension-points-react";
import type { WordActionProps } from "~/lib/extension-points";
import { renderWithProviders } from "~/test/render";

const CASES: WordActionProps[] = [
  { testId: "lookup-vocab", variant: "labeled", target: { word: "country", meaning: "noun · 国家", example: "ask not", source: "lookup" } },
  { testId: "progress-word-vocab", variant: "icon", label: "Add to vocabulary: talk", target: { word: "talk", source: "progress" } },
  { testId: "summary-word-add-0", variant: "icon", target: { word: "brew", meaning: "冲泡", example: "Brew tea.", source: "recap" } },
  { testId: "recap-poor-word-vocab", variant: "icon", label: "Add to vocabulary: three", target: { word: "three", source: "recap" } },
];

describe("<WordActions> with every link off", () => {
  it.each(CASES)("renders exactly the old AddVocabularyButton ($testId)", (c) => {
    const old = renderWithProviders(<AddVocabularyButton testId={c.testId} label={c.label} withLabel={c.variant === "labeled"} input={c.target} />);
    const html = old.container.innerHTML;
    old.unmount();
    const now = renderWithProviders(<WordActions {...c} />);
    expect(now.container.innerHTML).toBe(html);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd web && yarn vitest run src/features/lookup/word-target.test.ts src/plugins/word-actions` → FAIL(`word-target` 不存在)

- [ ] **Step 3: 实现**
- `web/src/features/lookup/word-target.ts`:

```ts
import { MAX_WORD_TARGET, type WordTarget } from "~/lib/extension-points";
import { normalizeSelection, type LookupResult } from "./lookup";
import type { TextSelectionInfo } from "./use-text-selection";

const clip = (text: string, max: number): string => {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join("");
};

/** R19:查词结果 → 单词目标。释义 = 词性 · 母语释义 · 英文释义;例句 = 选区所在句(原 vocabulary 的 vocabularyFromLookup,逐项相同)。 */
export function wordTargetFromLookup(result: LookupResult, selection: TextSelectionInfo): WordTarget {
  const word = clip(normalizeSelection(result.word || selection.text), MAX_WORD_TARGET.word);
  const meaning = clip([result.pos, result.translation, result.definition].map((s) => s.trim()).filter(Boolean).join(" · "),
    MAX_WORD_TARGET.meaning);
  const context = clip(normalizeSelection(selection.context), MAX_WORD_TARGET.example);
  return { word, meaning, example: context && context.toLowerCase() !== word.toLowerCase() ? context : undefined, source: "lookup" };
}
```

- 四个消费方(每处 `import { AddVocabularyButton } from "~/features/vocabulary";` 换成 `import { WordActions } from "~/lib/extension-points-react";`;JSX 一一对应,props 不变义):
  - chat:`<AddVocabularyButton testId="recap-expression-vocab" label={…} input={{ word: text, meaning: zh, source: "recap" }} />` → `<WordActions testId="recap-expression-vocab" label={…} variant="icon" target={{ word: text, meaning: zh, source: "recap" }} />`;`recap-poor-word-vocab` 同理。
  - lookup:导入换成 `WordActions` 与 `import { wordTargetFromLookup } from "./word-target";`;`<AddVocabularyButton key={…} testId="lookup-vocab" input={vocabularyFromLookup(state.lookup, target)} withLabel />` → `<WordActions key={…} testId="lookup-vocab" variant="labeled" target={wordTargetFromLookup(state.lookup, target)} />`。
  - progress:`<WordActions testId="progress-word-vocab" label={…} variant="icon" target={{ word: w.word, source: "progress" }} />`。
  - rooms 小结:`<WordActions testId={`summary-word-add-${i}`} variant="icon" target={{ word: w.en, meaning: w.zh, example: w.example, source: "recap" }} />`(外层 `span` 与青色类名不动)。
- vocabulary:删除 `save-vocabulary-item.ts` 的 `vocabularyFromLookup` 与它对 `~/features/lookup` 的导入;`index.ts` 删去该导出;`save-vocabulary-item.test.ts` 删去已搬走的「maps a lookup result (R19)」用例与 `vocabularyFromLookup` 导入(其余用例不动);`CLAUDE.md` 同步公共面(`AddVocabularyButton` 仍导出——rooms 以外没人用时也保留,parity 测试用它)。
- `architecture.test.ts`:`CROSS_FEATURE_BASELINE` 删去 `chat->vocabulary`、`lookup->vocabulary`、`progress->vocabulary`、`rooms->vocabulary`、`vocabulary->lookup`;追加:

```ts
  it("AddVocabularyButton is used only inside features/vocabulary", () => {
    const users = files.filter((f) => !isTest(f) && !f.startsWith("features/vocabulary/")
      && readFileSync(path.join(srcRoot, f), "utf8").includes("AddVocabularyButton"));
    expect(users).toEqual([]);
  });
```
- `lookup/CLAUDE.md`:What lives here 加 `word-target.ts`;删去「依赖 vocabulary」的说明(若有)。

- [ ] **Step 4: 跑测试确认通过** — Run: `yarn web:typecheck && cd web && yarn vitest run src/features/chat src/features/lookup src/features/progress src/features/rooms src/features/vocabulary src/plugins src/architecture.test.ts` → PASS(chat / lookup / progress 既有测试不改仍绿:`*-vocab` testid 来自 `plugins/core` 登记的核心贡献)
- [ ] **Step 5: 提交**

```bash
git add web/src/features/lookup web/src/features/chat/conversation-page.tsx web/src/features/progress/progress-page.tsx web/src/features/rooms/extras/summary-page.tsx web/src/features/vocabulary web/src/plugins/word-actions/parity.test.tsx web/src/architecture.test.ts
git commit -m "refactor(web): word actions slot replaces four direct AddVocabularyButton imports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L1-3: 「更多」按钮与「单词操作」面板(加入生词本 / 加入词书学习 / 跟读这个词 / 查看词卡)

**Files:**
- Create: `web/src/plugins/word-actions/{more-button.tsx,word-actions-sheet.tsx,more-button.test.tsx,i18n/zh-CN.json,i18n/en.json}`、`web/src/features/vocabulary/register-word-actions.tsx`、`web/src/features/wordbook/{register-word-actions.tsx,link-actions.tsx,link-actions.test.tsx}`、`web/src/features/practice/register-word-actions.tsx`
- Modify: `web/src/plugins/word-actions/index.ts`(替换 F7 桩)

**Interfaces:**
- Produces(贡献):`wordActions/word-actions.more`(`link: "word_actions"`,order 100)、`wordActionsMenu/vocabulary.add`(order 0)、`wordActionsMenu/wordbook.adopt`(order 10)、`wordActionsMenu/practice.shadow`(order 20)、`wordActionsMenu/wordbook.card`(order 30),后四个都带 `link: "word_actions"`
- Produces(`features/wordbook/link-actions.tsx`,wordbook 内部):`AdoptRow`、`CardRow`、`adoptWord(api, word)`、`fetchLinkCard(api, word)`
- Consumes:L1-1 的接口;wordbook 的 `useWordbookEnabled`、`WordCardView`(同 feature 内,懒加载);practice 的 `goPractice`(同 feature 内)

- [ ] **Step 1: 写失败测试** — `web/src/plugins/word-actions/more-button.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { ALL_OFF, LINK_KEYS, setLinkFlags, type LinkFlags } from "~/lib/extension-points";
import { WordActions } from "~/lib/extension-points-react";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import "./index";

const ON: LinkFlags = { enabled: true, links: Object.fromEntries(LINK_KEYS.map((k) => [k, k === "word_actions"])) as LinkFlags["links"] };
const api = (routes: Parameters<typeof createFetchMock>[0]) => {
  const mock = createFetchMock({ "GET /api/wordbook/config": () => json({ enabled: true, ai_available: false, defaults: { daily_new: 20, review_cap: 100 }, books: [] }), ...routes });
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};

beforeEach(async () => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  await i18n.changeLanguage("zh-CN");
});
afterEach(async () => {
  localStorage.removeItem("enjoy-web.settings");
  await i18n.changeLanguage("en");
  setLinkFlags(ALL_OFF);
});

describe("word actions menu", () => {
  it("is absent while the link is off", () => {
    renderWithProviders(<WordActions testId="lookup-vocab" variant="labeled" target={{ word: "talk", source: "lookup" }} />, api({}));
    expect(screen.getByTestId("lookup-vocab")).toBeInTheDocument();
    expect(screen.queryByTestId("lookup-vocab-more")).toBeNull();
  });

  it("opens a sheet with four rows; adopting reports the server status", async () => {
    setLinkFlags(ON);
    const { mock, api: client } = api({ "POST /api/links/wordbook/adopt": () => json({ status: "added", book_id: "junior" }) });
    renderWithProviders(<WordActions testId="progress-word-vocab" variant="icon" target={{ word: "talk", source: "progress" }} />, { api: client });
    fireEvent.click(screen.getByRole("button", { name: "更多操作:talk" }));
    const sheet = await screen.findByRole("dialog", { name: "单词操作" });
    const rows = within(sheet).getAllByRole("button").map((b) => b.textContent);
    expect(rows.join("|")).toMatch(/加入生词本.*加入词书学习.*跟读这个词.*查看词卡/);
    fireEvent.click(within(sheet).getByRole("button", { name: /加入词书学习/ }));
    await waitFor(() => expect(within(sheet).getByText("已加入,下次复习出现")).toBeInTheDocument());
    expect(JSON.parse(String(mock.calls.find((c) => c.url.pathname.endsWith("/adopt"))!.body))).toEqual({ word: "talk" });
  });

  it("shadowing navigates to practice with the example (or the word)", async () => {
    setLinkFlags(ON);
    renderWithProviders(<WordActions testId="summary-word-add-0" variant="icon" target={{ word: "brew", example: "Brew the tea.", source: "recap" }} />,
      { ...api({}), route: "/rooms/r/1/summary" });
    fireEvent.click(screen.getByTestId("summary-word-add-0-more"));
    fireEvent.click(await screen.findByRole("button", { name: /跟读这个词/ }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice"));
    expect(JSON.parse(screen.getByTestId("location").dataset.state!)).toEqual({ reference: "Brew the tea." });
  });
});
```

`web/src/features/wordbook/link-actions.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { CardRow } from "./link-actions";

vi.mock("~/features/chat/use-tts-player", () => ({ useTtsPlayer: () => ({ states: {}, play: vi.fn(), stop: vi.fn() }) }));

it("shows the card in place and says when the word is not in any book", async () => {
  const card = { key: "talk", word: "talk", us: "tɔk", uk: "", senses: [{ pos: "v", text: "说话" }], phrases: [], examples: [] };
  const mock = createFetchMock({
    "GET /api/links/wordbook/card": (c) => c.url.searchParams.get("word") === "talk"
      ? json({ book_id: "junior", card, item: null }) : json({ error: "Word not found" }, 404),
  });
  const client = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const view = renderWithProviders(<CardRow target={{ word: "talk", source: "manual" }} testId="x" variant="icon" close={() => {}} />, { api: client });
  fireEvent.click(screen.getByRole("button", { name: /查看词卡|View card/ }));
  expect(await screen.findByTestId("word-card")).toBeInTheDocument();
  view.unmount();
  renderWithProviders(<CardRow target={{ word: "zebra", source: "manual" }} testId="x" variant="icon" close={() => {}} />, { api: client });
  fireEvent.click(screen.getByRole("button", { name: /查看词卡|View card/ }));
  expect(await screen.findByText(/词书里没有这个词|not in any word book/)).toBeInTheDocument();
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd web && yarn vitest run src/plugins/word-actions src/features/wordbook/link-actions.test.tsx` → FAIL

- [ ] **Step 3: 实现**
- `plugins/word-actions/more-button.tsx`:`MoreWordActions(props: WordActionProps)` — 44×44 ghost 图标按钮(`EllipsisIcon`),`data-testid={`${props.testId}-more`}`,`aria-label={t("web.links.wordActions.more", { word: props.target.word })}`(「更多操作:{{word}}」),点开 `WordActionsSheet`;关闭后焦点回到按钮(`BottomSheet` 的 `onOpenChange` + `ref.focus()`)。
- `plugins/word-actions/word-actions-sheet.tsx`:`BottomSheet` + `BottomSheetHeader title={t("web.links.wordActions.title")}`(「单词操作」),副标题显示词;主体 `<Slot point="wordActionsMenu" props={{ ...props, close }} />` 渲染为一个列表(每个贡献自己渲染一行 `ListRow`)。
- `plugins/word-actions/index.ts`:

```ts
import "~/features/vocabulary/register-word-actions";
import "~/features/wordbook/register-word-actions";
import "~/features/practice/register-word-actions";
import { contribute } from "~/lib/extension-points";
import { MoreWordActions } from "./more-button";

contribute({ point: "wordActions", id: "word-actions.more", order: 100, link: "word_actions", component: MoreWordActions });
```

- `features/vocabulary/register-word-actions.tsx`:`contribute({ point: "wordActionsMenu", id: "vocabulary.add", order: 0, link: "word_actions", component: AddRow })`;`AddRow` 是一行(图标青色 `BookPlusIcon`、标题「加入生词本」),点击调 `saveVocabularyItem(api, t, target)`(同按钮的去重/toast 逻辑),成功后行变为「已在生词本中」并禁用。
- `features/wordbook/link-actions.tsx`:`adoptWord(api, word)` = `api.request("POST", "/api/links/wordbook/adopt", { json: { word } })`;`fetchLinkCard(api, word)` = `api.request("GET", "/api/links/wordbook/card", { query: { word } })`。`AdoptRow`:`useWordbookEnabled()` 为假时不渲染;点击 → `adoptWord`;状态文案 `added` →「已加入,下次复习出现」、`known` →「已在学习中」、`not_in_book` →「当前词书里没有这个词」(行禁用);错误 → `translateServerError(t, err, LINKS_SERVER_ERRORS)` 的 toast(错误表从 `~/plugins/links/links-api` 不可导入——feature 不能导入 plugins——所以这里用本文件里的同名小表,键同 `web.links.errors.*`)。`CardRow`:点击后在行下方展开,`lazy(() => import("./word-card").then((m) => ({ default: m.WordCardView })))` 渲染词卡(带 `Suspense`);404 → 「词书里没有这个词」。
- `features/wordbook/register-word-actions.tsx`:登记 `wordbook.adopt`(order 10)与 `wordbook.card`(order 30),都 `link: "word_actions"`。
- `features/practice/register-word-actions.tsx`:登记 `practice.shadow`(order 20,`link: "word_actions"`):一行「跟读这个词」(蓝色 `MicIcon`),点击 `close(); goPractice(navigate, target.example ?? target.word)`。
- 文案 `plugins/word-actions/i18n/zh-CN.json`:`web.links.wordActions.{more:"更多操作:{{word}}", title:"单词操作", add:"加入生词本", inVocabulary:"已在生词本中", adopt:"加入词书学习", adopted:"已加入,下次复习出现", known:"已在学习中", notInBook:"当前词书里没有这个词", shadow:"跟读这个词", card:"查看词卡", noCard:"词书里没有这个词"}`;en 同键。

- [ ] **Step 4: 跑测试确认通过** — Run: `yarn web:typecheck && cd web && yarn vitest run src/plugins src/features/wordbook src/features/vocabulary src/features/practice src/architecture.test.ts` → PASS;`yarn web:build`(主包增长在上限内:词卡面板是懒加载)。
- [ ] **Step 5: 视觉检查** — 浏览器窗格 375×812:查词结果「加入生词本」旁出现「更多」;面板对照视觉稿帧 02(浅色);深色模式用帧 06 的令牌检查同一面板。关掉 `link_word_actions_enabled`:按钮消失,其余不变。
- [ ] **Step 6: 提交**

```bash
git add web/src/plugins/word-actions web/src/features/vocabulary/register-word-actions.tsx web/src/features/wordbook/register-word-actions.tsx web/src/features/wordbook/link-actions.tsx web/src/features/wordbook/link-actions.test.tsx web/src/features/practice/register-word-actions.tsx
git commit -m "feat(web): word actions menu with adopt, shadow and card actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Lane L2 · 今日任务聚合卡(`daily_tasks`)

### Task L2-1: 服务端 `GET /api/links/today`

**Files:**
- Modify: `server/app/links/daily_tasks.py`(替换桩)
- Create: `server/tests/test_links_daily_tasks.py`、`server/tests/fixtures/links_daily_tasks_contract.json`

**Interfaces:**
- Produces:`GET /api/links/today?offset=<-720..840>` → `{"practice_today", "chat_messages_today", "conversations_today"}`(用户本地日,只返回数字)

- [ ] **Step 1: 写失败测试**

```python
from datetime import timedelta

from app.models import utcnow
from tests.links_helpers import check_contract, enable_links
from tests.test_admin_api import register, seed_assessment


async def test_counts_today_in_the_users_local_day(app, client):
    enable_links(app)
    uid, h = await register(client, "alice")
    await seed_assessment(app, uid, source="practice")
    await seed_assessment(app, uid, source="chat")
    await seed_assessment(app, uid, source="practice", at=utcnow() - timedelta(days=2))
    for name in ("a", "b"):
        conv = (await client.post("/api/conversations", headers=h, json={"name": name})).json()
        await client.post(f"/api/conversations/{conv['id']}/messages", headers=h, json={"messages": [
            {"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]})
    body = (await client.get("/api/links/today", headers=h, params={"offset": 0})).json()
    assert body == {"practice_today": 1, "chat_messages_today": 2, "conversations_today": 2}
    assert (await client.get("/api/links/today", headers=h, params={"offset": 900})).status_code == 422
    check_contract("links_daily_tasks_contract", {"today": body})


async def test_off_for_the_user_is_404(app, client):
    enable_links(app)
    _, h = await register(client, "bob")
    await client.put("/api/links/prefs", headers=h, json={"key": "daily_tasks", "enabled": False})
    r = await client.get("/api/links/today", headers=h)
    assert (r.status_code, r.json()) == (404, {"error": "Link is off"})
```

(`seed_assessment` 的 `at` 参数与默认 `text` 见 `tests/test_admin_api.py`;若测试时刻靠近 UTC 午夜,`offset=0` 与 `seed_assessment` 默认的 `utcnow()` 仍在同一 UTC 日——两者都按 UTC 计。)

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_links_daily_tasks.py` → FAIL
- [ ] **Step 3: 实现** — `server/app/links/daily_tasks.py`:

```python
"""今日任务聚合卡(spec §6.2)的服务端计数:只返回数字,按用户本地日。"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_session
from app.links.gate import require_link
from app.links.spec import LinkSpec
from app.models import Assessment, Conversation, Message, User, utcnow
from app.services.stats import local_date, local_midnight_utc

router = APIRouter()


@router.get("/today")
async def today(offset: int = Query(0, ge=-720, le=840), user: User = Depends(require_link("daily_tasks")),
                session: AsyncSession = Depends(get_session)):
    start = local_midnight_utc(local_date(utcnow(), offset), offset)
    practice = await session.scalar(select(func.count()).select_from(Assessment).where(
        Assessment.user_id == user.id, Assessment.source == "practice", Assessment.created_at >= start))
    mine = (select(Message).join(Conversation, Conversation.id == Message.conversation_id)
            .where(Conversation.user_id == user.id, Message.role == "user", Message.created_at >= start).subquery())
    messages = await session.scalar(select(func.count()).select_from(mine))
    conversations = await session.scalar(select(func.count(func.distinct(mine.c.conversation_id))))
    return {"practice_today": int(practice or 0), "chat_messages_today": int(messages or 0),
            "conversations_today": int(conversations or 0)}


SPEC = LinkSpec("daily_tasks", "今日任务聚合卡", "Daily tasks", router=router)
```

- [ ] **Step 4: 录契约并跑测试** — `CONTRACT_UPDATE=1 uv run pytest -q tests/test_links_daily_tasks.py`,再正常跑 + `tests/test_architecture.py` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/app/links/daily_tasks.py server/tests/test_links_daily_tasks.py server/tests/fixtures/links_daily_tasks_contract.json
git commit -m "feat(server): daily-tasks link counts today's practice and chat

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L2-2: 练习页「今日任务」卡与四个提供方

**Files:**
- Create: `web/src/plugins/daily-tasks/{today-api.ts,daily-tasks-card.tsx,daily-tasks-card.test.tsx,daily-tasks-contract.test.ts,i18n/zh-CN.json,i18n/en.json}`、`web/src/features/{wordbook,practice,chat,rank}/register-daily-tasks.tsx`
- Modify: `web/src/plugins/daily-tasks/index.ts`(替换桩)

**Interfaces:**
- 裁定(行的外观):提供方在 feature 里,不能导入插件,本计划也不新增 `components/`;所以每个提供方自己用现有 `ListRow` + `IconChip` 渲染一行,完成态统一为尾部绿色 `CheckIcon` + `ink-2` 标题,文案键在插件 i18n(`web.links.dailyTasks.*`,计划 P-L8)。
- Produces(贡献):`practiceHome/daily-tasks.card`(`link: "daily_tasks"`)、`dailyTasks/wordbook.today`(order 10)、`dailyTasks/practice.shadow`(order 20)、`dailyTasks/chat.talk`(order 30)、`dailyTasks/rank.stage`(order 40),提供方都带 `link: "daily_tasks"`;每行必须带 `data-testid="daily-task-<id>"` 与 `data-state="done"|"todo"`
- Produces(`today-api.ts`):`fetchTodayCounts(api, offset, signal?) -> Promise<TodayCounts>`

- [ ] **Step 1: 写失败测试** — `web/src/plugins/daily-tasks/daily-tasks-card.test.tsx`:

```tsx
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { ALL_OFF, LINK_KEYS, setLinkFlags, type LinkFlags } from "~/lib/extension-points";
import { Slot } from "~/lib/extension-points-react";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import "./index";

const ON: LinkFlags = { enabled: true, links: Object.fromEntries(LINK_KEYS.map((k) => [k, k === "daily_tasks"])) as LinkFlags["links"] };
const PLAN = { new_target: 20, new_done: 20, new_left: 0, review_due: 30, review_done: 12, review_left: 18, backlog_guard: false };

function client(overrides: Record<string, () => Response> = {}) {
  const mock = createFetchMock({
    "GET /api/links/today": () => json({ practice_today: 1, chat_messages_today: 0, conversations_today: 0 }),
    "GET /api/wordbook/config": () => json({ enabled: true, ai_available: false, defaults: { daily_new: 20, review_cap: 100 }, books: [] }),
    "GET /api/wordbook/today": () => json({ enrollment: null, book: null, plan: PLAN, progress: null, tomorrow_due: 0 }),
    "GET /api/rank/config": () => json({ enabled: false, match_available: false, tiers: [], season: null }),
    ...overrides,
  });
  return new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
}

beforeEach(async () => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  await i18n.changeLanguage("zh-CN");
});
afterEach(async () => {
  localStorage.removeItem("enjoy-web.settings");
  await i18n.changeLanguage("en");
  setLinkFlags(ALL_OFF);
});

describe("今日任务卡", () => {
  it("renders nothing while the link is off", () => {
    const { container } = renderWithProviders(<Slot point="practiceHome" props={{}} />, { api: client() });
    expect(container.querySelector("[data-testid=daily-tasks-card]")).toBeNull();
  });

  it("aggregates the providers and counts what is done", async () => {
    setLinkFlags(ON);
    renderWithProviders(<Slot point="practiceHome" props={{}} />, { api: client() });
    const card = await screen.findByTestId("daily-tasks-card");
    await waitFor(() => expect(screen.getByTestId("daily-task-practice.shadow")).toHaveAttribute("data-state", "done"));
    expect(screen.getByTestId("daily-task-wordbook.today")).toHaveAttribute("data-state", "todo");
    expect(screen.getByTestId("daily-task-wordbook.today")).toHaveTextContent("复习 12/30");
    expect(screen.getByTestId("daily-task-chat.talk")).toHaveAttribute("data-state", "todo");
    expect(screen.queryByTestId("daily-task-rank.stage")).toBeNull(); // rank is off on this server
    expect(card).toHaveTextContent("1/3 完成");
    expect(screen.getByRole("link", { name: /跟读一句,已完成/ })).toBeInTheDocument();
  });
});
```

`web/src/plugins/daily-tasks/daily-tasks-contract.test.ts`(同 F7 契约测试的写法,核对 `links_daily_tasks_contract.json` 的 `today` 键与 `TodayCounts` 一致)。

- [ ] **Step 2: 跑测试确认失败** — Run: `cd web && yarn vitest run src/plugins/daily-tasks` → FAIL
- [ ] **Step 3: 实现**
- `today-api.ts`:`fetchTodayCounts(api, offset = -new Date().getTimezoneOffset(), signal)` = `api.request<TodayCounts>("GET", "/api/links/today", { query: { offset }, signal })`。
- `daily-tasks-card.tsx`:`DailyTasksCard` — `SurfaceCard data-testid="daily-tasks-card"` + 标题行「今日任务」与右侧 `n/m 完成`;拉取 `fetchTodayCounts` 一次(失败时 `today=null`,依赖它的行显示「—」);主体 `<Slot point="dailyTasks" props={{ today }} />`。**完成数的统计:** 提供方各自异步取数,不向卡片回报;卡片用一个挂在列表容器上的 `MutationObserver`(属性过滤 `data-state`、子节点增删)重新数 `[data-testid^=daily-task-]` 的 `data-state`,行数为 0 时整卡加 `hidden`(无行 = 不渲染,spec §6.2)。这样提供方既不导入插件,也不需要共享状态。
- 四个提供方(每个 `contribute({ point: "dailyTasks", id, order, link: "daily_tasks", component })`):
  - `wordbook.today`:`useWordbookEnabled()` 假 → `null`;`useWordbookToday(true)` 的 `plan`(`plan` 为 null,即 B 的暂停 / 未选书 → `null`);完成 = `plan.goalMet || (plan.newLeft === 0 && plan.reviewLeft === 0)`(B 的达标口径不含加练,所以加练后不会从「完成」退回「未完成」;INDEX R-T1;测试用 B 的 `goals-test-fixtures.ts` 里的 `GOAL_MET_TODAY`);副标题「新词 {{newDone}}/{{newTarget}} · 复习 {{reviewDone}}/{{reviewDue}}」;`to="/wordbook"`;图标青色 `BookOpenIcon`。
  - `practice.shadow`:完成 = `today.practiceToday >= 1`;标题「跟读一句」;点击 `navigate("/practice#shadowing")` 并 `document.getElementById("shadowing")?.scrollIntoView({ behavior: "smooth" })`;图标蓝色 `MicIcon`。
  - `chat.talk`:完成 = `today.chatMessagesToday >= 1`;标题「对话一次」;`to="/chat"`;图标蓝色 `MessagesSquareIcon`。
  - `rank.stage`:`fetchRankConfig` 关 → `null`;`fetchRankMe` 的 `stageTasks`,本模块内 `WeakMap<ApiClient, {at, promise}>` 30 秒复用;完成 = 全部 `complete`;副标题「阶段任务 {{done}}/{{total}}」;`to="/rank"`;图标琥珀 `TrophyIcon`。
  - 每行:`ListRow` 的 `aria-label` = `{{title}},已完成` / `{{title}},{{progress}}`;完成时尾部绿色 `CheckIcon` 与 `ink-2` 标题,未完成显示数字 + chevron。
- `index.ts`:`import "~/features/wordbook/register-daily-tasks"; import "~/features/practice/register-daily-tasks"; import "~/features/chat/register-daily-tasks"; import "~/features/rank/register-daily-tasks";` + `contribute({ point: "practiceHome", id: "daily-tasks.card", link: "daily_tasks", component: DailyTasksCard })`。
- 文案 `web.links.dailyTasks.{title:"今日任务", done:"{{done}}/{{total}} 完成", wordbook:"背单词", wordbookDetail:"新词 {{newDone}}/{{newTarget}} · 复习 {{reviewDone}}/{{reviewDue}}", shadow:"跟读一句", talk:"对话一次", rank:"段位阶段任务", rankDetail:"阶段任务 {{done}}/{{total}}", doneLabel:"{{title}},已完成", todoLabel:"{{title}},{{progress}}"}`。

- [ ] **Step 4: 跑测试确认通过** — Run: `yarn web:typecheck && cd web && yarn vitest run src/plugins src/features/wordbook src/features/practice src/features/chat src/features/rank src/architecture.test.ts` → PASS
- [ ] **Step 5: 视觉检查** — 375×812:练习页段位卡、背单词卡之下出现「今日任务」卡,对照视觉稿帧 01(浅色)与帧 06(深色)。
- [ ] **Step 6: 提交**

```bash
git add web/src/plugins/daily-tasks web/src/features/wordbook/register-daily-tasks.tsx web/src/features/practice/register-daily-tasks.tsx web/src/features/chat/register-daily-tasks.tsx web/src/features/rank/register-daily-tasks.tsx
git commit -m "feat(web): daily tasks card on the practice page fed by feature providers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Lane L3 · 易错词(`mistakes`)

### Task L3-1: 服务端处理器(`WordAnswered`)与列表 / 移出接口

**Files:**
- Modify: `server/app/links/mistakes.py`(替换桩)
- Create: `server/tests/test_links_mistakes.py`、`server/tests/fixtures/links_mistakes_contract.json`

**Interfaces:**
- Produces:`WRONG = {"wrong", "inflection"}`、`RIGHT = {"correct", "know", "known"}`、`LAPSE_KINDS = {"review", "practice"}`、`is_wrong(event) -> bool`(`outcome ∈ WRONG`,或 `outcome == "unknown"` 且 `kind ∈ LAPSE_KINDS`;INDEX R-E3)、`CLEAR_AFTER = 2`、`ACTIVE_MAX = 200`、`async handle(app, event: WordAnswered)`、`install(app, bus)`;`GET /api/links/mistakes?page=1..100` → `{"items": [{"word","wrong_count","last_wrong_at","meaning","box","due_at","book_id"}], "next", "total"}`(每页 20);`POST /api/links/mistakes/dismiss {"word"}` → `{"word"}`
- Consumes:`WordAnswered`(F1)、`LinkMistakeWord`(F3)、`require_link`、`WordIn`

- [ ] **Step 1: 写失败测试**

```python
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.learning_events import WordAnswered
from app.links import mistakes
from app.models import LinkMistakeWord
from tests.links_helpers import check_contract, drain, enable_links, user_id_of
from tests.wordbook_helpers import enable_wordbook, make_data_dir

T0 = datetime(2026, 10, 11, 8, 0, tzinfo=timezone.utc)


def ev(uid, word, outcome, minutes, kind="review"):
    return WordAnswered(user_id=uid, book_id="junior", word=word, kind=kind, qtype="meaning", outcome=outcome,
                        credit=0, at=T0 + timedelta(minutes=minutes))


async def login(app, client, name="alice", **flags):
    enable_links(app, **flags)
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return await user_id_of(client, h), h


async def row(app, uid, word):
    async with app.state.sessionmaker() as s:
        return await s.get(LinkMistakeWord, (uid, word))


async def test_wrong_answers_enter_and_two_right_answers_clear(app, client):
    uid, _ = await login(app, client)
    await mistakes.handle(app, ev(uid, "talk", "wrong", 0))
    await mistakes.handle(app, ev(uid, "talk", "inflection", 1))
    await mistakes.handle(app, ev(uid, "talk", "typo", 2))  # typos do not count
    r = await row(app, uid, "talk")
    assert (r.wrong_count, r.ok_streak, r.cleared_at) == (2, 0, None)
    await mistakes.handle(app, ev(uid, "talk", "correct", 3))
    assert (await row(app, uid, "talk")).cleared_at is None
    await mistakes.handle(app, ev(uid, "talk", "known", 4))
    assert (await row(app, uid, "talk")).cleared_at is not None
    await mistakes.handle(app, ev(uid, "talk", "wrong", 5))  # a new mistake reopens it
    r = await row(app, uid, "talk")
    assert (r.wrong_count, r.cleared_at) == (3, None)
    await mistakes.handle(app, ev(uid, "ability", "correct", 6))  # a right answer alone creates nothing
    assert await row(app, uid, "ability") is None


async def test_self_rating_outcomes_follow_the_index_rules(app, client):
    """A 的三档自评(INDEX R-E3):新词标「不认识」不算错;复习 / 当天再评的「不认识」算错;fuzzy、know_chk 中性;know 算对。"""
    uid, _ = await login(app, client)
    await mistakes.handle(app, ev(uid, "talk", "unknown", 0, kind="learn"))
    await mistakes.handle(app, ev(uid, "talk", "unknown", 1, kind="relearn"))
    assert await row(app, uid, "talk") is None
    await mistakes.handle(app, ev(uid, "talk", "unknown", 2, kind="review"))
    assert (await row(app, uid, "talk")).wrong_count == 1
    await mistakes.handle(app, ev(uid, "talk", "fuzzy", 3))
    await mistakes.handle(app, ev(uid, "talk", "know_chk", 4, kind="practice"))
    r = await row(app, uid, "talk")
    assert (r.ok_streak, r.cleared_at) == (0, None)
    await mistakes.handle(app, ev(uid, "talk", "know", 5))
    await mistakes.handle(app, ev(uid, "talk", "correct", 6))
    assert (await row(app, uid, "talk")).cleared_at is not None
    await mistakes.handle(app, ev(uid, "talk", "unknown", 7, kind="practice"))  # 「记错了」重新打开
    assert (await row(app, uid, "talk")).cleared_at is None


async def test_replays_and_older_events_are_ignored(app, client):
    uid, _ = await login(app, client)
    e = ev(uid, "talk", "wrong", 10)
    await mistakes.handle(app, e)
    await mistakes.handle(app, e)
    await mistakes.handle(app, ev(uid, "talk", "wrong", 5))
    assert (await row(app, uid, "talk")).wrong_count == 1


async def test_active_list_is_capped(app, client, monkeypatch):
    monkeypatch.setattr(mistakes, "ACTIVE_MAX", 3)
    uid, _ = await login(app, client)
    for i, word in enumerate(("a1", "a2", "a3", "a4")):
        await mistakes.handle(app, ev(uid, word, "wrong", i))
    async with app.state.sessionmaker() as s:
        active = (await s.scalars(select(LinkMistakeWord.word).where(LinkMistakeWord.cleared_at.is_(None)))).all()
    assert sorted(active) == ["a2", "a3", "a4"]


async def test_end_to_end_through_the_bus_list_and_dismiss(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    uid, h = await login(app, client)
    await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    await client.post("/api/wordbook/answers", headers=h, json={"book_id": "junior", "key": "talk", "mode": "learn",
                                                                "qtype": "meaning", "choice": "nope"})
    await drain(app)
    body = (await client.get("/api/links/mistakes", headers=h)).json()
    assert body["total"] == 1 and body["next"] is None
    (item,) = body["items"]
    assert (item["word"], item["wrong_count"], item["book_id"], item["box"]) == ("talk", 1, "junior", 0)
    assert item["meaning"]  # from the user's own vocabulary row (no copy)
    dismissed = (await client.post("/api/links/mistakes/dismiss", headers=h, json={"word": "Talk"})).json()
    assert dismissed == {"word": "talk"}
    assert (await client.get("/api/links/mistakes", headers=h)).json()["items"] == []
    check_contract("links_mistakes_contract", {"list": body, "dismiss": dismissed})


async def test_nothing_is_written_when_the_user_turned_it_off(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    uid, h = await login(app, client)
    await client.put("/api/links/prefs", headers=h, json={"key": "mistakes", "enabled": False})
    await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    await client.post("/api/wordbook/answers", headers=h, json={"book_id": "junior", "key": "talk", "mode": "learn",
                                                                "qtype": "meaning", "choice": "nope"})
    await drain(app)
    assert await row(app, uid, "talk") is None
    assert app.state.learning_bus.stats()["mistakes"]["skipped"] == 1
    assert (await client.get("/api/links/mistakes", headers=h)).status_code == 404
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_links_mistakes.py` → FAIL
- [ ] **Step 3: 实现** — `server/app/links/mistakes.py`:

```python
"""易错词(spec §6.3):背单词答错的词进生词本「易错词」虚拟视图;连续答对 2 次自动移出。不复制 vocabulary_items。"""
from functools import partial

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_session
from app.core.learning_events import WordAnswered
from app.links.gate import require_link
from app.links.spec import LinkSpec, WordIn
from app.models import LinkMistakeWord, User, VocabularyItem, iso_utc, utcnow
from app.services.stats import as_utc

WRONG = frozenset({"wrong", "inflection"})
RIGHT = frozenset({"correct", "know", "known"})  # known = A 之前写的旧行;A 之后 known:true 记为 know
LAPSE_KINDS = frozenset({"review", "practice"})  # 「不认识」只在已有词条上算错;新词第一次标不认识不算(INDEX R-E3)
CLEAR_AFTER = 2
ACTIVE_MAX = 200
PAGE = 20
M = LinkMistakeWord


def is_wrong(event: WordAnswered) -> bool:
    return event.outcome in WRONG or (event.outcome == "unknown" and event.kind in LAPSE_KINDS)


async def handle(app, event: WordAnswered) -> None:
    wrong = is_wrong(event)
    if not wrong and event.outcome not in RIGHT:
        return  # typo、fuzzy、know_chk、新词的 unknown:中性
    async with app.state.sessionmaker() as session:
        row = await session.get(M, (event.user_id, event.word))
        if row is None:
            if not wrong:
                return
            session.add(M(user_id=event.user_id, word=event.word, book_id=event.book_id, wrong_count=1, ok_streak=0,
                          last_event_at=event.at, last_wrong_at=event.at, cleared_at=None))
            try:
                await session.commit()
            except IntegrityError:  # a concurrent first insert won: fall back to the conditional update below
                await session.rollback()
                row = await session.get(M, (event.user_id, event.word), populate_existing=True)
            else:
                await _cap(session, event.user_id, event.at)
                return
        if as_utc(row.last_event_at) >= event.at:
            return  # replay or an older event
        if wrong:
            values = dict(wrong_count=M.wrong_count + 1, ok_streak=0, last_wrong_at=event.at, cleared_at=None,
                          book_id=event.book_id)
        elif row.cleared_at is not None:
            values = {}
        else:
            streak = row.ok_streak + 1
            values = dict(ok_streak=streak, cleared_at=event.at if streak >= CLEAR_AFTER else None)
        await session.execute(update(M).where(M.user_id == event.user_id, M.word == event.word,
                                              M.last_event_at < event.at)
                              .values(last_event_at=event.at, **values).execution_options(synchronize_session=False))
        await session.commit()
        if wrong:
            await _cap(session, event.user_id, event.at)


async def _cap(session: AsyncSession, user_id: int, at) -> None:
    active = await session.scalar(select(func.count()).select_from(M).where(M.user_id == user_id, M.cleared_at.is_(None)))
    extra = int(active or 0) - ACTIVE_MAX
    if extra <= 0:
        return
    oldest = (await session.scalars(select(M.word).where(M.user_id == user_id, M.cleared_at.is_(None))
                                    .order_by(M.last_wrong_at, M.word).limit(extra))).all()
    await session.execute(update(M).where(M.user_id == user_id, M.word.in_(oldest)).values(cleared_at=at)
                          .execution_options(synchronize_session=False))
    await session.commit()


router = APIRouter()


@router.get("/mistakes")
async def list_mistakes(page: int = Query(1, ge=1, le=100), user: User = Depends(require_link("mistakes")),
                        session: AsyncSession = Depends(get_session)):
    mine = (M.user_id == user.id, M.cleared_at.is_(None))
    total = await session.scalar(select(func.count()).select_from(M).where(*mine))
    rows = (await session.scalars(select(M).where(*mine).order_by(M.wrong_count.desc(), M.last_wrong_at.desc(), M.word)
                                  .offset((page - 1) * PAGE).limit(PAGE + 1))).all()
    words = [r.word for r in rows[:PAGE]]
    items: dict[str, VocabularyItem] = {}
    for v in (await session.scalars(select(VocabularyItem).where(VocabularyItem.user_id == user.id,
                                                                 VocabularyItem.word.in_(words))
                                    .order_by(VocabularyItem.created_at, VocabularyItem.id))).all():
        items.setdefault(v.word, v)  # 同用户同词最早一行(R17)
    out = []
    for r in rows[:PAGE]:
        v = items.get(r.word)
        out.append({"word": r.word, "wrong_count": r.wrong_count, "last_wrong_at": iso_utc(r.last_wrong_at),
                    "meaning": v.meaning if v else "", "box": v.box if v else None,
                    "due_at": iso_utc(v.due_at) if v else None, "book_id": r.book_id})
    return {"items": out, "next": page + 1 if len(rows) > PAGE else None, "total": int(total or 0)}


@router.post("/mistakes/dismiss")
async def dismiss(payload: WordIn, user: User = Depends(require_link("mistakes", limited=True)),
                  session: AsyncSession = Depends(get_session)):
    await session.execute(update(M).where(M.user_id == user.id, M.word == payload.word, M.cleared_at.is_(None))
                          .values(cleared_at=utcnow()).execution_options(synchronize_session=False))
    await session.commit()
    return {"word": payload.word}


def install(app, bus) -> None:
    bus.subscribe(WordAnswered, "mistakes", partial(handle, app))


SPEC = LinkSpec("mistakes", "易错词", "Mistakes", install=install, router=router)
```

- [ ] **Step 4: 录契约并跑测试** — `CONTRACT_UPDATE=1 uv run pytest -q tests/test_links_mistakes.py`,再正常跑 + `tests/test_links_matrix.py tests/test_architecture.py` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/app/links/mistakes.py server/tests/test_links_mistakes.py server/tests/fixtures/links_mistakes_contract.json
git commit -m "feat(server): mistakes link collects wrong wordbook answers into a virtual view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L3-2: 生词本「易错词」入口与 `/links/mistakes` 页

**Files:**
- Create: `web/src/plugins/mistakes/{mistakes-api.ts,mistakes-row.tsx,mistakes-page.tsx,mistakes-page.test.tsx,mistakes-contract.test.ts,i18n/zh-CN.json,i18n/en.json}`
- Modify: `web/src/plugins/mistakes/index.ts`(替换桩)

**Interfaces:**
- Produces:`MistakeItem { word; wrongCount; lastWrongAt; meaning; box: number|null; dueAt: string|null; bookId }`、`fetchMistakes(api, page, signal?)`、`dismissMistake(api, word)`;贡献 `notebookViews/mistakes.row`(order 10,`link: "mistakes"`)、路由 `/links/mistakes`(`link: "mistakes"`)

- [ ] **Step 1: 写失败测试** — `mistakes-page.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { ALL_OFF, LINK_KEYS, setLinkFlags, type LinkFlags } from "~/lib/extension-points";
import { Slot } from "~/lib/extension-points-react";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { MistakesPage } from "./mistakes-page";
import "./index";

const ON: LinkFlags = { enabled: true, links: Object.fromEntries(LINK_KEYS.map((k) => [k, k === "mistakes"])) as LinkFlags["links"] };
const ITEMS = [
  { word: "accommodate", wrong_count: 3, last_wrong_at: new Date(Date.now() - 2 * 864e5).toISOString(), meaning: "v. 容纳", box: 1, due_at: null, book_id: "cet4" },
  { word: "necessary", wrong_count: 1, last_wrong_at: new Date().toISOString(), meaning: "adj. 必要的", box: 0, due_at: null, book_id: "cet4" },
];

beforeEach(async () => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  await i18n.changeLanguage("zh-CN");
  setLinkFlags(ON);
});
afterEach(async () => {
  localStorage.removeItem("enjoy-web.settings");
  await i18n.changeLanguage("en");
  setLinkFlags(ALL_OFF);
});

it("notebook row shows the count and links to the page", async () => {
  const mock = createFetchMock({ "GET /api/links/mistakes": () => json({ items: ITEMS, next: null, total: 12 }) });
  renderWithProviders(<Slot point="notebookViews" props={{}} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  const link = await screen.findByRole("link", { name: /易错词/ });
  expect(link).toHaveAttribute("href", "/links/mistakes");
  expect(link).toHaveTextContent("12");
});

it("lists mistakes, dismisses one and shows the empty state", async () => {
  let items = [...ITEMS];
  const mock = createFetchMock({
    "GET /api/links/mistakes": () => json({ items, next: null, total: items.length }),
    "POST /api/links/mistakes/dismiss": () => { items = items.slice(1); return json({ word: "accommodate" }); },
  });
  renderWithProviders(<MistakesPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  const first = await screen.findByTestId("mistake-accommodate");
  expect(first).toHaveTextContent("错 3 次");
  expect(first).toHaveTextContent("v. 容纳");
  expect(within(first).getByTestId("mistake-accommodate-vocab")).toBeInTheDocument(); // <WordActions> core button
  fireEvent.click(within(first).getByRole("button", { name: "移出:accommodate" }));
  await waitFor(() => expect(screen.queryByTestId("mistake-accommodate")).toBeNull());
  items = [];
  fireEvent.click(within(screen.getByTestId("mistake-necessary")).getByRole("button", { name: "移出:necessary" }));
  expect(await screen.findByText("还没有易错词。")).toBeInTheDocument();
});
```

`mistakes-contract.test.ts`:同 F7 写法,核对 `links_mistakes_contract.json` 的 `list.items[0]` 键与 `MistakeItem` 一致、`dismiss` 为 `{word}`。

- [ ] **Step 2: 跑测试确认失败** — Run: `cd web && yarn vitest run src/plugins/mistakes` → FAIL
- [ ] **Step 3: 实现**
- `mistakes-row.tsx`:`ListRow` + 琥珀 `IconChip`(`AlertTriangleIcon`)+ 标题「易错词」+ 值 `total`(只拉第 1 页取 `total`;失败或 0 时显示「暂无」)+ chevron,`to="/links/mistakes"`,`testId="notebook-mistakes"`。
- `mistakes-page.tsx`:`PageHeader title="易错词" back="/vocabulary"`;顶部说明「背单词里答错的词会自动出现在这里;连续答对 2 次后自动移出」;列表每行 `data-testid={`mistake-${word}`}`:词(`lang="en"`)+ 释义一行 + 「错 {{count}} 次 · {{ago}}」(`ago` 用 `Intl.RelativeTimeFormat`)+ 盒子进度点(6 格,`box+1` 格青色,`box` 为 null 时不显示)+ `<WordActions testId={`mistake-${word}-vocab`} variant="icon" target={{ word, meaning, source: "manual" }} />` + 「移出」图标按钮(`aria-label="移出:{{word}}"`,中性色,点击后乐观移除,失败回滚 + toast);分页「加载更多」;底部 `Button`「去拼写练习」→ `/wordbook/spell`;空态「还没有易错词。」。
- `index.ts`:`contribute({ point: "notebookViews", id: "mistakes.row", order: 10, link: "mistakes", component: MistakesRow })`、`contributeRoute({ id: "mistakes.page", path: "/links/mistakes", link: "mistakes", component: MistakesPage })`。
- 文案 `web.links.mistakes.{title:"易错词", none:"暂无", lede:"背单词里答错的词会自动出现在这里;连续答对 2 次后自动移出", count:"错 {{count}} 次", dismiss:"移出:{{word}}", empty:"还没有易错词。", more:"加载更多", spell:"去拼写练习"}`。

- [ ] **Step 4: 跑测试确认通过** — Run: `yarn web:typecheck && cd web && yarn vitest run src/plugins src/features/vocabulary src/architecture.test.ts` → PASS
- [ ] **Step 5: 视觉检查** — 对照视觉稿帧 03(易错词页,浅色)。
- [ ] **Step 6: 提交**

```bash
git add web/src/plugins/mistakes
git commit -m "feat(web): mistakes view in the notebook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Lane L4 · 发音弱词 ↔ 跟读(`pron_shadow`)

### Task L4-1: 服务端处理器(`AssessmentFinished`)、弱词列表 / 移出、今日新词例句

**Files:**
- Modify: `server/app/links/pron_shadow.py`(替换桩)
- Create: `server/tests/test_links_pron_shadow.py`、`server/tests/fixtures/links_pron_shadow_contract.json`

**Interfaces:**
- Produces:`CLEAR_AFTER = 2`、`ACTIVE_MAX = 200`、`async handle(app, event: AssessmentFinished)`、`install(app, bus)`;`GET /api/links/weak-words` → `{"items": [{"word","hits","last_score","last_weak_at","example"}], "total"}`(≤ 50,按 `hits` 降序、`last_weak_at` 降序);`POST /api/links/weak-words/dismiss {"word"}` → `{"word"}`;`GET /api/links/today-words?offset=` → `{"items": [{"key","word","example": {"en","zh"}|null}]}`(≤ 20)
- Consumes:`AssessmentFinished`、`LinkWeakWord`、`app.wordbook.{store,service,index,books}`

- [ ] **Step 1: 写失败测试**

```python
from datetime import datetime, timedelta, timezone

from app.core.learning_events import AssessmentFinished, WeakWord
from app.links import pron_shadow
from app.models import LinkWeakWord
from tests.links_helpers import check_contract, drain, enable_links, user_id_of
from tests.wordbook_helpers import enable_wordbook, make_data_dir

T0 = datetime(2026, 10, 11, 8, 0, tzinfo=timezone.utc)


def ev(uid, minutes, weak=(), good=(), source="practice"):
    return AssessmentFinished(user_id=uid, assessment_id=f"a{minutes}", source=source, score=60,
                              weak_words=tuple(WeakWord(w, s) for w, s in weak), good_words=tuple(good),
                              at=T0 + timedelta(minutes=minutes))


async def login(app, client, name="alice"):
    enable_links(app)
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return await user_id_of(client, h), h


async def get(app, uid, word):
    async with app.state.sessionmaker() as s:
        return await s.get(LinkWeakWord, (uid, word))


async def test_weak_words_enter_and_clear_after_two_good_readings(app, client):
    uid, _ = await login(app, client)
    await pron_shadow.handle(app, ev(uid, 0, weak=[("three", 41), ("thought", None)]))
    await pron_shadow.handle(app, ev(uid, 1, weak=[("three", 52)]))
    r = await get(app, uid, "three")
    assert (r.hits, r.last_score, r.cleared_at) == (2, 52, None)
    await pron_shadow.handle(app, ev(uid, 2, good=["three"]))
    await pron_shadow.handle(app, ev(uid, 3, good=["three", "tree"]))
    assert (await get(app, uid, "three")).cleared_at is not None
    assert await get(app, uid, "tree") is None  # good readings alone create nothing
    assert (await get(app, uid, "thought")).last_score is None


async def test_chat_assessments_replays_and_older_events_are_ignored(app, client):
    uid, _ = await login(app, client)
    await pron_shadow.handle(app, ev(uid, 0, weak=[("three", 40)], source="chat"))
    assert await get(app, uid, "three") is None
    e = ev(uid, 5, weak=[("three", 40)])
    await pron_shadow.handle(app, e)
    await pron_shadow.handle(app, e)
    await pron_shadow.handle(app, ev(uid, 1, weak=[("three", 10)]))
    assert (await get(app, uid, "three")).hits == 1


async def test_list_dismiss_and_example_from_the_users_vocabulary(app, client):
    uid, h = await login(app, client)
    await client.post("/api/vocabulary", headers=h, json={"word": "three", "example": "Three trees.", "source": "manual"})
    from app.core.learning_events import bind, publish
    bind(app.state.learning_bus)  # go through the real channel (gate included) instead of calling handle()
    publish(ev(uid, 0, weak=[("three", 41), ("world", 55)]))
    await drain(app)
    body = (await client.get("/api/links/weak-words", headers=h)).json()
    assert body["total"] == 2
    three = next(i for i in body["items"] if i["word"] == "three")
    assert (three["hits"], three["last_score"], three["example"]) == (1, 41, "Three trees.")
    dismissed = (await client.post("/api/links/weak-words/dismiss", headers=h, json={"word": "world"})).json()
    assert dismissed == {"word": "world"}
    assert [i["word"] for i in (await client.get("/api/links/weak-words", headers=h)).json()["items"]] == ["three"]
    check_contract("links_pron_shadow_contract", {"list": body, "dismiss": dismissed,
                                                  "today_words": (await client.get("/api/links/today-words", headers=h)).json()})


async def test_today_words_lists_todays_new_words_with_their_first_example(app, client, tmp_path):
    enable_wordbook(app, make_data_dir(tmp_path))
    uid, h = await login(app, client)
    assert (await client.get("/api/links/today-words", headers=h)).json() == {"items": []}  # no active book
    await client.put("/api/wordbook/enrollment", headers=h, json={"book_id": "junior", "order_mode": "book"})
    for key in ("talk", "ability"):
        await client.post("/api/wordbook/answers", headers=h, json={"book_id": "junior", "key": key, "mode": "learn",
                                                                    "qtype": "meaning", "known": True,
                                                                    "tz_offset_minutes": 0})
    items = (await client.get("/api/links/today-words", headers=h, params={"offset": 0})).json()["items"]
    assert [i["key"] for i in items] == ["talk", "ability"]
    assert items[0]["example"]["en"].startswith("I could hear Sarah and Andy talking")
```

(第三个测试里用 `publish` + `bind` 走真实通道;`bind` 在测试任务的上下文里设置,与请求无关。)

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_links_pron_shadow.py` → FAIL
- [ ] **Step 3: 实现** — `server/app/links/pron_shadow.py`:

```python
"""发音弱词 ↔ 跟读(spec §6.4)。只收跟读评测(source="practice",L-R3);今日新词例句复用背单词词卡。"""
from functools import partial

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_session
from app.core.learning_events import AssessmentFinished
from app.links.gate import require_link
from app.links.spec import LinkSpec, WordIn
from app.models import LinkWeakWord, User, VocabularyItem, iso_utc, utcnow
from app.services.stats import as_utc
from app.services.usage import local_day
from app.wordbook import service, store
from app.wordbook.books import enabled_books
from app.wordbook.index import DataUnavailable, dictionary

CLEAR_AFTER = 2
ACTIVE_MAX = 200
LIST_MAX = 50
TODAY_MAX = 20
W = LinkWeakWord


async def handle(app, event: AssessmentFinished) -> None:
    if event.source != "practice":
        return
    weak = {w.word[:100]: w.score for w in event.weak_words if w.word}
    good = [g[:100] for g in event.good_words if g and g[:100] not in weak]
    if not weak and not good:
        return
    for attempt in range(2):  # one retry if a concurrent first insert collides
        async with app.state.sessionmaker() as session:
            rows = {r.word: r for r in (await session.scalars(select(W).where(
                W.user_id == event.user_id, W.word.in_(list(weak) + good)))).all()}
            for word, score in weak.items():
                row = rows.get(word)
                if row is None:
                    session.add(W(user_id=event.user_id, word=word, hits=1, last_score=score, ok_streak=0,
                                  last_event_at=event.at, last_weak_at=event.at, cleared_at=None))
                elif as_utc(row.last_event_at) < event.at:
                    row.hits, row.last_score, row.ok_streak = row.hits + 1, score, 0
                    row.last_weak_at, row.last_event_at, row.cleared_at = event.at, event.at, None
            for word in good:
                row = rows.get(word)
                if row is not None and row.cleared_at is None and as_utc(row.last_event_at) < event.at:
                    row.ok_streak += 1
                    row.last_event_at = event.at
                    if row.ok_streak >= CLEAR_AFTER:
                        row.cleared_at = event.at
            try:
                await session.commit()
            except IntegrityError:
                if attempt:
                    raise
                continue
            await _cap(session, event.user_id, event.at)
            return


async def _cap(session: AsyncSession, user_id: int, at) -> None:
    active = await session.scalar(select(func.count()).select_from(W).where(W.user_id == user_id, W.cleared_at.is_(None)))
    extra = int(active or 0) - ACTIVE_MAX
    if extra > 0:
        oldest = (await session.scalars(select(W.word).where(W.user_id == user_id, W.cleared_at.is_(None))
                                        .order_by(W.last_weak_at, W.word).limit(extra))).all()
        await session.execute(update(W).where(W.user_id == user_id, W.word.in_(oldest)).values(cleared_at=at)
                              .execution_options(synchronize_session=False))
        await session.commit()


router = APIRouter()


@router.get("/weak-words")
async def weak_words(user: User = Depends(require_link("pron_shadow")), session: AsyncSession = Depends(get_session)):
    mine = (W.user_id == user.id, W.cleared_at.is_(None))
    total = await session.scalar(select(func.count()).select_from(W).where(*mine))
    rows = (await session.scalars(select(W).where(*mine).order_by(W.hits.desc(), W.last_weak_at.desc(), W.word)
                                  .limit(LIST_MAX))).all()
    examples: dict[str, str | None] = {}
    for word, example in (await session.execute(select(VocabularyItem.word, VocabularyItem.example).where(
            VocabularyItem.user_id == user.id, VocabularyItem.word.in_([r.word for r in rows]))
            .order_by(VocabularyItem.created_at, VocabularyItem.id))).all():
        examples.setdefault(word, example)
    return {"items": [{"word": r.word, "hits": r.hits, "last_score": r.last_score,
                       "last_weak_at": iso_utc(r.last_weak_at), "example": examples.get(r.word)} for r in rows],
            "total": int(total or 0)}


@router.post("/weak-words/dismiss")
async def dismiss(payload: WordIn, user: User = Depends(require_link("pron_shadow", limited=True)),
                  session: AsyncSession = Depends(get_session)):
    await session.execute(update(W).where(W.user_id == user.id, W.word == payload.word, W.cleared_at.is_(None))
                          .values(cleared_at=utcnow()).execution_options(synchronize_session=False))
    await session.commit()
    return {"word": payload.word}


@router.get("/today-words")
async def today_words(request: Request, offset: int = Query(0, ge=-720, le=840),
                      user: User = Depends(require_link("pron_shadow")), session: AsyncSession = Depends(get_session)):
    settings = request.app.state.settings
    if not settings.wordbook_enabled:
        return {"items": []}
    e = await store.active_enrollment(session, user.id)
    if e is None or e.book_id not in enabled_books(settings.wordbook_books):
        return {"items": []}
    keys = (await store.today_learned_keys(session, user.id, e.book_id, local_day(utcnow(), offset)))[:TODAY_MAX]
    ds = dictionary(request.app)
    await service.ensure_hidden(session, ds)
    try:
        cards = await ds.cards(e.book_id, keys)
    except DataUnavailable:
        return {"items": []}
    items = []
    for key in keys:
        card = cards.get(key)
        if card is None:
            continue
        first = card.examples[0] if card.examples else None
        items.append({"key": key, "word": card.word, "example": {"en": first.en, "zh": first.zh} if first else None})
    return {"items": items}


def install(app, bus) -> None:
    bus.subscribe(AssessmentFinished, "pron_shadow", partial(handle, app))


SPEC = LinkSpec("pron_shadow", "发音弱词与跟读", "Weak pronunciation & shadowing", install=install, router=router)
```

- [ ] **Step 4: 录契约并跑测试** — `CONTRACT_UPDATE=1 uv run pytest -q tests/test_links_pron_shadow.py`,再正常跑 + `tests/test_links_publishers.py tests/test_architecture.py` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/app/links/pron_shadow.py server/tests/test_links_pron_shadow.py server/tests/fixtures/links_pron_shadow_contract.json
git commit -m "feat(server): weak-pronunciation link from shadowing assessments and today's example sentences

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L4-2: 跟读区来源条、今日新词例句面板、发音弱词页与生词本入口

**Files:**
- Create: `web/src/plugins/pron-shadow/{pron-api.ts,sources-strip.tsx,today-words-sheet.tsx,weak-words-row.tsx,weak-words-page.tsx,sources-strip.test.tsx,weak-words-page.test.tsx,pron-shadow-contract.test.ts,i18n/zh-CN.json,i18n/en.json}`
- Modify: `web/src/plugins/pron-shadow/index.ts`(替换桩)

**Interfaces:**
- Produces:`WeakWordItem { word; hits; lastScore: number|null; lastWeakAt; example: string|null }`、`TodayWord { key; word; example: {en; zh}|null }`、`fetchWeakWords`、`dismissWeakWord`、`fetchTodayWords`;贡献 `learningSources/pron.weak`(order 10)、`learningSources/pron.today`(order 20)、`notebookViews/pron.row`(order 20)、路由 `/links/weak-words`,全部 `link: "pron_shadow"`
- Consumes:practice 页 `learningSources` 的 `pick(text)`(F7 插入);`goPractice` 不可用(插件可以 `~/features/practice` 导入 index 的 `goPractice`——插件不受跨 feature 基线限制,但为一致仍只用路由 `navigate("/practice", { state: { reference } })`)

- [ ] **Step 1: 写失败测试** — `sources-strip.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { ALL_OFF, LINK_KEYS, setLinkFlags, type LinkFlags } from "~/lib/extension-points";
import { Slot } from "~/lib/extension-points-react";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import "./index";

const ON: LinkFlags = { enabled: true, links: Object.fromEntries(LINK_KEYS.map((k) => [k, k === "pron_shadow"])) as LinkFlags["links"] };

beforeEach(async () => {
  localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
  await i18n.changeLanguage("zh-CN");
  setLinkFlags(ON);
});
afterEach(async () => {
  localStorage.removeItem("enjoy-web.settings");
  await i18n.changeLanguage("en");
  setLinkFlags(ALL_OFF);
});

it("shows weak-word and today-word chips; picking a today word fills the reference", async () => {
  const mock = createFetchMock({
    "GET /api/links/weak-words": () => json({ items: [{ word: "three", hits: 3, last_score: 52, last_weak_at: "2026-10-11T08:00:00+00:00", example: null }], total: 6 }),
    "GET /api/links/today-words": () => json({ items: [{ key: "brew", word: "brew", example: { en: "She brewed a pot of tea.", zh: "她泡了一壶茶。" } }] }),
  });
  const pick = vi.fn();
  renderWithProviders(<Slot point="learningSources" props={{ pick }} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  expect(await screen.findByRole("link", { name: /发音弱词 6/ })).toHaveAttribute("href", "/links/weak-words");
  fireEvent.click(await screen.findByRole("button", { name: /今日新词 1/ }));
  fireEvent.click(await screen.findByRole("button", { name: /She brewed a pot of tea\./ }));
  expect(pick).toHaveBeenCalledWith("She brewed a pot of tea.");
});

it("hides chips that have nothing to offer", async () => {
  const mock = createFetchMock({
    "GET /api/links/weak-words": () => json({ items: [], total: 0 }),
    "GET /api/links/today-words": () => json({ items: [] }),
  });
  const { container } = renderWithProviders(<Slot point="learningSources" props={{ pick: vi.fn() }} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  await new Promise((r) => setTimeout(r, 0));
  expect(container.querySelector("[data-testid^=source-chip]")).toBeNull();
});
```

`weak-words-page.test.tsx`:渲染 `WeakWordsPage`,断言每行 `data-testid="weak-<word>"` 显示「最近 52 分 · 出现 3 次」、分数色阶类名(52 → `text-ink-2`,78 → `text-amber`)、「跟读」按钮跳转 `/practice` 且 `state.reference` 为例句(无例句时为单词)、「连读这 5 个」把前 5 个词以 `", "` 连接后作为 `reference`、「移出」后行消失;`pron-shadow-contract.test.ts` 核对 `links_pron_shadow_contract.json`。

- [ ] **Step 2: 跑测试确认失败** — Run: `cd web && yarn vitest run src/plugins/pron-shadow` → FAIL
- [ ] **Step 3: 实现**
- `sources-strip.tsx`:两个独立贡献(各自取数,没有内容时 `null`),外观为 32px 可视 / 44px 命中区的片(`seg` 风格,琥珀 = 弱词,青 = 今日新词),`data-testid="source-chip-weak"` / `"source-chip-today"`;弱词片是 `<Link to="/links/weak-words">`(「发音弱词 {{total}}」),今日新词片是按钮,打开 `TodayWordsSheet`。来源条整体的横向容器由 practice 页的插槽位置决定(F7 只放了插槽):每个片自带 `inline-flex` 与 `mr-2 mb-2`,不需要共同父元素。
- `today-words-sheet.tsx`:`BottomSheet`「今日新词例句」;每行按钮:词(`lang="en"`)+ 例句英文 + 中文小字,点击 `pick(example.en)` 并关闭;无例句的词显示「这个词没有例句」并禁用。
- `weak-words-row.tsx`:生词本入口「发音弱词 · {{total}}」(琥珀 `MicIcon` 片),`to="/links/weak-words"`。
- `weak-words-page.tsx`:`PageHeader title="发音弱词" back="/practice"`;顶部说明「跟读里读得不准的词。读准两次后自动移出。」;主按钮「连读这 5 个」(`navigate("/practice", { state: { reference: top5.join(", ") } })`);列表每行 `data-testid={`weak-${word}`}`:词 + 「最近 {{score}} 分 · 出现 {{hits}} 次」(色阶:< 70 `text-ink-2`、70–84 `text-amber`、≥ 85 `text-green`;null 显示「未评分」)+ 「跟读」(蓝,44px,`navigate("/practice", { state: { reference: example ?? word } })`)+ 「移出」(中性);空态「暂时没有发音弱词。」。
- `index.ts`:四个贡献 + 路由(见 Interfaces)。
- 文案 `web.links.pron.{weakChip:"发音弱词 {{total}}", todayChip:"今日新词 {{count}}", todayTitle:"今日新词例句", noExample:"这个词没有例句", title:"发音弱词", lede:"跟读里读得不准的词。读准两次后自动移出。", drillTop:"连读这 {{count}} 个", score:"最近 {{score}} 分", unscored:"未评分", hits:"出现 {{hits}} 次", shadow:"跟读", dismiss:"移出:{{word}}", empty:"暂时没有发音弱词。", row:"发音弱词"}`。

- [ ] **Step 4: 跑测试确认通过** — Run: `yarn web:typecheck && cd web && yarn vitest run src/plugins src/features/practice src/architecture.test.ts` → PASS
- [ ] **Step 5: 视觉检查** — 对照视觉稿帧 04(练习页来源条 + 发音弱词页);深色。
- [ ] **Step 6: 提交**

```bash
git add web/src/plugins/pron-shadow
git commit -m "feat(web): weak-pronunciation drill entry and today's example sentences for shadowing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Lane L5 · 对话用到今日词(`chat_words`)

### Task L5-1: 确定性检测处理器(`MessageSent`)与 `word_in_chat` 来源

**Files:**
- Modify: `server/app/links/chat_words.py`(替换桩)
- Create: `server/tests/test_links_chat_words.py`、`server/tests/fixtures/links_chat_words_contract.json`

**Interfaces:**
- Produces:`SOURCE = RankSource("word_in_chat", 1, "对话用到新词", "New word used in chat")`、`WINDOW = timedelta(hours=24)`、`TODAY_MAX = 200`、`matches(text: str, keys: Iterable[str]) -> set[str]`(纯)、`async handle(app, event: MessageSent)`、`install(app, bus)`(订阅 + `rank_sources.register(SOURCE)` + 建 `JudgeRunner`,L5-2);`GET /api/links/chat-words?offset=` → `{"today": [{"word","used"}], "used_count"}`
- Consumes:`app.wordbook.textnorm.{tokenize,lemma_candidates,find_form}`、`WordbookEvent`、`LinkWordUse`、`LinkCredit`、gate(`rank_sources`)

- [ ] **Step 1: 写失败测试**

```python
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.core import rank_sources
from app.core.learning_events import MessageSent
from app.links import chat_words
from app.links.chat_words import matches
from app.models import LinkCredit, LinkWordUse, WordbookEvent
from tests.links_helpers import check_contract, drain, enable_links, user_id_of

T0 = datetime(2026, 10, 11, 8, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize("text,keys,expected", [
    ("I talked to her yesterday.", {"talk"}, {"talk"}),
    ("We were carrying boxes.", {"carry"}, {"carry"}),
    ("The children went home.", {"child", "go"}, {"child", "go"}),
    ("I used to swim.", {"used to"}, {"used to"}),
    ("I went to bed.", {"be"}, set()),  # bed is not a form of be
    ("Talking talks talked", {"talk", "walk"}, {"talk"}),
    ("", {"talk"}, set()),
])
def test_matches_uses_lemmas_without_an_llm(text, keys, expected):
    assert matches(text, keys) == expected


async def login(app, client, name="alice", **flags):
    enable_links(app, **flags)
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return await user_id_of(client, h), h


async def learned(app, uid, *words, at=T0 - timedelta(hours=2)):
    ids = {}
    async with app.state.sessionmaker() as s:
        for w in words:
            e = WordbookEvent(user_id=uid, book_id="junior", kind="learn", word=w, item_id=None, qtype="meaning",
                              outcome="known", credit=100, day="2026-10-11", created_at=at)
            s.add(e)
            await s.flush()
            ids[w] = e.id
        await s.commit()
    return ids


def msg(uid, text, minutes=0, mid="m1"):
    return MessageSent(user_id=uid, conversation_id="c1", message_id=mid, text=text, at=T0 + timedelta(minutes=minutes))


async def counts(app, uid):
    async with app.state.sessionmaker() as s:
        uses = (await s.scalars(select(LinkWordUse.word).where(LinkWordUse.user_id == uid).order_by(LinkWordUse.word))).all()
        credits = (await s.scalars(select(LinkCredit.ref_id).where(LinkCredit.user_id == uid).order_by(LinkCredit.ref_id))).all()
    return list(uses), list(credits)


async def test_a_use_is_recorded_once_per_learned_word_and_credited(app, client):
    uid, _ = await login(app, client)
    ids = await learned(app, uid, "talk", "carry")
    await chat_words.handle(app, msg(uid, "I talked and talked."))
    await chat_words.handle(app, msg(uid, "Talking again.", 5, "m2"))  # same learned word: no second record
    uses, credits = await counts(app, uid)
    assert uses == ["talk"] and credits == [f"wic:{ids['talk']}"]


async def test_old_learns_are_not_todays_words_and_the_daily_cap_applies(app, client):
    uid, _ = await login(app, client, link_chat_words_daily_max=2)
    await learned(app, uid, "talk", at=T0 - timedelta(hours=30))
    await learned(app, uid, "go", "child", "carry")
    await chat_words.handle(app, msg(uid, "I talked, went with the children and carried bags."))
    uses, _ = await counts(app, uid)
    assert len(uses) == 2 and "talk" not in uses


async def test_no_credit_when_rank_sources_is_off_for_the_user(app, client):
    uid, h = await login(app, client)
    await client.put("/api/links/prefs", headers=h, json={"key": "rank_sources", "enabled": False})
    await learned(app, uid, "talk")
    await chat_words.handle(app, msg(uid, "talk"))
    assert await counts(app, uid) == (["talk"], [])


async def test_end_to_end_api_and_no_text_stored_or_logged(app, client, caplog):
    uid, h = await login(app, client)
    await learned(app, uid, "talk", "carry", at=datetime.now(timezone.utc) - timedelta(hours=1))
    conv = (await client.post("/api/conversations", headers=h, json={"name": "c"})).json()
    with caplog.at_level("DEBUG", logger="app"):
        await client.post(f"/api/conversations/{conv['id']}/messages", headers=h,
                          json={"messages": [{"role": "user", "content": "My secret: I talked a lot"}]})
        await drain(app)
    assert "secret" not in caplog.text
    body = (await client.get("/api/links/chat-words", headers=h)).json()
    assert body == {"today": [{"word": "talk", "used": True}, {"word": "carry", "used": False}], "used_count": 1}
    async with app.state.sessionmaker() as s:
        assert await s.scalar(select(func.count()).select_from(LinkWordUse)) == 1
    check_contract("links_chat_words_contract", {"chat_words": body})


async def test_relearned_words_are_not_todays_words(app, client):
    """B 的 relearn(删掉 / 重置后重学)不是今日词:word_in_chat 每词每人最多一次(INDEX R-P4)。"""
    uid, _ = await login(app, client)
    async with app.state.sessionmaker() as s:
        s.add(WordbookEvent(user_id=uid, book_id="junior", kind="relearn", word="talk", item_id=None, qtype="recall",
                            outcome="know", credit=100, day="2026-10-11", created_at=T0 - timedelta(hours=1)))
        await s.commit()
    await chat_words.handle(app, msg(uid, "I talked."))
    assert await counts(app, uid) == ([], [])


def test_install_registers_the_rank_source(app):
    assert rank_sources.get("word_in_chat") == chat_words.SOURCE
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_links_chat_words.py` → FAIL
- [ ] **Step 3: 实现** — `server/app/links/chat_words.py`(本任务先不含 `JudgeRunner`;L5-2 加):

```python
"""对话用到今日词(spec §6.5):按词形还原检测,不需要大模型;不改盒子(L-R5);消息正文只在内存。"""
from collections.abc import Iterable
from datetime import timedelta
from functools import partial

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import rank_sources
from app.core.deps import get_session
from app.core.learning_events import MessageSent
from app.links.gate import require_link
from app.links.spec import LinkSpec
from app.models import LinkCredit, LinkWordUse, User, WordbookEvent, utcnow
from app.wordbook.textnorm import find_form, lemma_candidates, tokenize

SOURCE = rank_sources.RankSource("word_in_chat", 1, "对话用到新词", "New word used in chat")
WINDOW = timedelta(hours=24)
TODAY_MAX = 200


def matches(text: str, keys: Iterable[str]) -> set[str]:
    forms: set[str] = set()
    for token in tokenize(text):
        forms |= lemma_candidates(token.text)
    out: set[str] = set()
    for key in keys:
        if " " in key:
            if find_form(text, key) is not None:
                out.add(key)
        elif key in forms:
            out.add(key)
    return out


async def todays_words(session: AsyncSession, user_id: int, at) -> dict[str, int]:
    """过去 24 小时内的 learn 事件:词 → 事件 id(L-R4)。只看 learn,不看 B 的 relearn(INDEX R-P4)。"""
    rows = (await session.execute(select(WordbookEvent.id, WordbookEvent.word).where(
        WordbookEvent.user_id == user_id, WordbookEvent.kind == "learn", WordbookEvent.created_at >= at - WINDOW,
        WordbookEvent.created_at <= at).order_by(WordbookEvent.id).limit(TODAY_MAX))).all()
    out: dict[str, int] = {}
    for id_, word in rows:
        out.setdefault(word, id_)
    return out


async def handle(app, event: MessageSent) -> None:
    settings = app.state.settings
    async with app.state.sessionmaker() as session:
        today = await todays_words(session, event.user_id, event.at)
        hit = matches(event.text, today) if today else set()
        if not hit:
            return
        used = set((await session.scalars(select(LinkWordUse.learn_event_id).where(
            LinkWordUse.user_id == event.user_id, LinkWordUse.learn_event_id.in_([today[w] for w in hit])))).all())
        recent = await session.scalar(select(func.count()).select_from(LinkWordUse).where(
            LinkWordUse.user_id == event.user_id, LinkWordUse.created_at >= event.at - WINDOW))
        room = max(0, settings.link_chat_words_daily_max - int(recent or 0))
        fresh = sorted(w for w in hit if today[w] not in used)[:room]
        if not fresh:
            return
        credit = await app.state.link_gate("rank_sources", event.user_id)
        for word in fresh:
            session.add(LinkWordUse(user_id=event.user_id, word=word, learn_event_id=today[word],
                                    message_id=event.message_id, created_at=event.at))
        credited = await _credits(app, event, fresh) if credit else []
        for word in credited:
            session.add(LinkCredit(user_id=event.user_id, kind=SOURCE.kind, ref_id=f"wic:{today[word]}", score=None,
                                   created_at=event.at))
        try:
            await session.commit()
        except IntegrityError:  # replay or a concurrent process recorded the same learn event first
            await session.rollback()


async def _credits(app, event: MessageSent, words: list[str]) -> list[str]:
    """确定性:全部计分。L5-2 在打开大模型用法检查时把它们交给 JudgeRunner(由它异步写 LinkCredit)。"""
    return words


router = APIRouter()


@router.get("/chat-words")
async def chat_words(offset: int = Query(0, ge=-720, le=840), user: User = Depends(require_link("chat_words")),
                     session: AsyncSession = Depends(get_session)):
    now = utcnow()
    today = await todays_words(session, user.id, now)
    used = set((await session.scalars(select(LinkWordUse.learn_event_id).where(
        LinkWordUse.user_id == user.id, LinkWordUse.learn_event_id.in_(list(today.values()) or [-1])))).all())
    items = [{"word": w, "used": today[w] in used} for w in today]
    return {"today": items, "used_count": sum(1 for i in items if i["used"])}


def install(app, bus) -> None:
    rank_sources.register(SOURCE)
    bus.subscribe(MessageSent, "chat_words", partial(handle, app))


SPEC = LinkSpec("chat_words", "对话用到今日词", "New words in chat", install=install, router=router)
```

(`offset` 参数保留在接口上以便将来按本地日;v1 用滚动 24 小时,与处理器一致。)

- [ ] **Step 4: 录契约并跑测试** — `CONTRACT_UPDATE=1 uv run pytest -q tests/test_links_chat_words.py`,再正常跑 + `tests/test_links_matrix.py tests/test_rank_sources.py tests/test_architecture.py` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/app/links/chat_words.py server/tests/test_links_chat_words.py server/tests/fixtures/links_chat_words_contract.json
git commit -m "feat(server): detect today's new words in chat by lemma and credit them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L5-2: 可选的大模型用法检查(`JudgeRunner`,默认关、限额、402 降级)

**Files:**
- Modify: `server/app/links/chat_words.py`、`server/tests/test_links_chat_words.py`(追加)

**Interfaces:**
- Produces:`LLM_SCOPE = "links_llm"`、`JUDGE_TIMEOUT = 8.0`、`JUDGE_CONCURRENCY = 2`、`JUDGE_PENDING_MAX = 50`、`render_judge(text, words) -> list[dict]`、`parse_judge(reply, words) -> set[str]`、`class JudgeRunner(app)`:`submit(event, words, ids) -> bool`(待办满 → False)、`async join()`(测试用)、`app.state.links_judge`
- 计数(经 `bus.count("chat_words", …)`):`llm_calls`、`llm_degraded`、`llm_rejected`、`llm_overflow`

- [ ] **Step 1: 写失败测试**(追加到 `test_links_chat_words.py`)

```python
import httpx
import respx

from app.links.chat_words import parse_judge


def test_parse_judge_is_strict_and_falls_back_to_all():
    assert parse_judge('{"ok": ["talk"]}', ["talk", "carry"]) == {"talk"}
    assert parse_judge('{"ok": ["zebra"]}', ["talk"]) == set()
    assert parse_judge("not json", ["talk"]) == {"talk"}
    assert parse_judge('{"ok": "talk"}', ["talk"]) == {"talk"}


@respx.mock
async def test_llm_judge_credits_only_approved_words(app, client):
    uid, _ = await login(app, client, link_chat_words_llm_enabled=True)
    ids = await learned(app, uid, "talk", "carry")
    respx.post("https://llm.test/v1/chat/completions").mock(return_value=httpx.Response(200, json={
        "choices": [{"message": {"content": '{"ok": ["talk"]}'}}], "usage": {"prompt_tokens": 5, "completion_tokens": 3}}))
    await chat_words.handle(app, msg(uid, "I talked and carried it."))
    await app.state.links_judge.join()
    uses, credits = await counts(app, uid)
    assert uses == ["carry", "talk"] and credits == [f"wic:{ids['talk']}"]
    assert app.state.learning_bus.stats()["chat_words"]["extra"]["llm_calls"] == 1


@respx.mock
async def test_out_of_balance_402_degrades_to_deterministic_credits(app, client, caplog):
    uid, _ = await login(app, client, link_chat_words_llm_enabled=True)
    await learned(app, uid, "talk")
    respx.post("https://llm.test/v1/chat/completions").mock(return_value=httpx.Response(402, json={"error": "balance"}))
    with caplog.at_level("INFO", logger="app"):
        await chat_words.handle(app, msg(uid, "My private sentence: I talked"))
        await app.state.links_judge.join()
    assert (await counts(app, uid))[1]  # credited anyway
    assert app.state.learning_bus.stats()["chat_words"]["extra"]["llm_degraded"] == 1
    assert "private" not in caplog.text


async def test_global_daily_cap_and_full_queue_degrade_without_calling_upstream(app, client, monkeypatch):
    uid, _ = await login(app, client, link_chat_words_llm_enabled=True, link_chat_words_llm_global_daily=0)
    await learned(app, uid, "talk")
    called = []
    monkeypatch.setattr("app.providers.llm.complete", lambda *a, **k: called.append(1))
    await chat_words.handle(app, msg(uid, "talked"))
    await app.state.links_judge.join()
    assert called == [] and (await counts(app, uid))[1]
    assert app.state.learning_bus.stats()["chat_words"]["extra"]["llm_degraded"] == 1
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_links_chat_words.py` → FAIL
- [ ] **Step 3: 实现**(在 `chat_words.py` 中)
- `render_judge(text, words)`:一条 system(「你是英语老师。判断下面学习者的句子里,这些单词的用法是否正确(拼写变形算对)。只输出 JSON:{"ok": [用法正确的词]}。」)+ 一条 user(`<learner>` 包裹的消息,尖括号换成形近字符,截断 600 字符;词表逗号分隔)。
- `parse_judge(reply, words)`:严格 `json.loads`;`ok` 是字符串列表 → 返回 `{w for w in ok} & set(words)`;任何解析失败 → `set(words)`(降级)。
- `JudgeRunner`:`asyncio.Semaphore(JUDGE_CONCURRENCY)`、`self.pending: set[asyncio.Task]`;`submit(event, words, ids)`:`len(pending) >= JUDGE_PENDING_MAX` → 计数 `llm_overflow` 并返回 False;否则 `create_task(self._run(...))` 放进集合(完成时移除)。`_run`:先 `usage.consume(session, LLM_SCOPE, "all", utc_day(event.at), settings.link_chat_words_llm_global_daily)`,失败 → 降级;成功 → `with metering.feature_scope("links"): text = await asyncio.wait_for(llm.complete(app.state.http, settings, render_judge(...), model=settings.default_llm_model, max_tokens=60, temperature=0), JUDGE_TIMEOUT)`,计数 `llm_calls`;`llm.LlmUnavailable` / `TimeoutError` → 计数 `llm_degraded`、日志 `links judge degraded kind=<kind>`(只记种类)、全部词计分;否则 `approved = parse_judge(text, words)`,未通过的计数 `llm_rejected`。最后用新会话写 `LinkCredit`(`IntegrityError` 吞掉)。`join()` = `await asyncio.gather(*self.pending, return_exceptions=True)`。
- `_credits(app, event, words)`:`settings.link_chat_words_llm_enabled` 为假 → 返回 `words`(确定性);为真 → `app.state.links_judge.submit(event, words, ids)` 成功则返回 `[]`(由 runner 写),待办满则计数 `llm_degraded` 并返回 `words`。为此 `_credits` 的签名改为 `(app, event, words, ids)`,`handle` 传 `{w: today[w] for w in fresh}`。
- `install`:加 `app.state.links_judge = JudgeRunner(app)`。关停时(`main.py` 无需改)未完成的判定随进程结束丢失,文档化为尽力而为。

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_links_chat_words.py tests/test_metering*.py tests/test_architecture.py` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/app/links/chat_words.py server/tests/test_links_chat_words.py
git commit -m "feat(server): optional capped LLM usage check for chat words with 402 fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task L5-3: 网页「对话用今日词」任务行与词卡小标;段位入账端到端

**Files:**
- Create: `web/src/plugins/chat-words/{chat-words-api.ts,chat-words-task.tsx,used-badge.tsx,chat-words.test.tsx,chat-words-contract.test.ts,i18n/zh-CN.json,i18n/en.json}`、`server/tests/test_links_chat_words_rank.py`
- Modify: `web/src/plugins/chat-words/index.ts`(替换桩)

**Interfaces:**
- Produces:`fetchChatWords(api, signal?) -> Promise<{ today: { word; used }[]; usedCount: number }>`(30 秒模块内复用);贡献 `dailyTasks/chat-words.task`(order 50)、`wordDetailSections/chat-words.badge`,都 `link: "chat_words"`
- Consumes:L6 已合并(段位读 `LinkCredit`)

- [ ] **Step 1: 写失败测试** — `server/tests/test_links_chat_words_rank.py`(L6 合并后 rebase 再写):

```python
from datetime import datetime, timedelta, timezone

from tests.links_helpers import drain, enable_links
from tests.test_links_chat_words import learned


async def test_a_chat_use_shows_up_in_rank_recent_points(app, client):
    enable_links(app, rank_enabled=True)
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    uid = int((await client.get("/api/me", headers=h)).json()["id"])
    await learned(app, uid, "talk", at=datetime.now(timezone.utc) - timedelta(hours=1))
    conv = (await client.post("/api/conversations", headers=h, json={"name": "c"})).json()
    await client.post(f"/api/conversations/{conv['id']}/messages", headers=h,
                      json={"messages": [{"role": "user", "content": "I talked"}]})
    await drain(app)
    me = (await client.get("/api/rank/me", headers=h, params={"tz": 0})).json()
    assert "word_in_chat" in [e["kind"] for e in me["recent_events"]]
```

`web/src/plugins/chat-words/chat-words.test.tsx`:旗标开 `chat_words` 与 `daily_tasks`;mock `/api/links/chat-words` 返回 `{today: [{word:"talk",used:true},{word:"carry",used:false},{word:"brew",used:false}], used_count: 1}`;断言 `dailyTasks` 插槽里 `daily-task-chat-words.task` 文案「对话用今日词 1/3」、`data-state="todo"`;今日词为 0 时该行不渲染;`wordDetailSections` 插槽 `props={{ word: "talk" }}` 显示青色小标「今天在对话里用过」,`word: "carry"` 不显示。`chat-words-contract.test.ts` 核对样例。

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_links_chat_words_rank.py`;`cd web && yarn vitest run src/plugins/chat-words` → FAIL
- [ ] **Step 3: 实现** — `chat-words-task.tsx`:完成 = `usedCount >= Math.min(3, today.length)`,目标 `min(3, today.length)`;`to="/chat"`;青色 `MessageSquareTextIcon`;`data-testid="daily-task-chat-words.task"`。`used-badge.tsx`:`today.find((t) => t.word === word && t.used)` 时显示 `ToneBadge tone="teal"`「今天在对话里用过」,否则 `null`。`index.ts` 登记两个贡献。文案 `web.links.chatWords.{task:"对话用今日词", taskDetail:"{{used}}/{{target}}", badge:"今天在对话里用过"}`。服务端无代码改动(端到端用例验证 L5-1 + L6-1 的组合)。
- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_links_chat_words_rank.py tests/test_rank_*.py`;`yarn web:typecheck && cd web && yarn vitest run src/plugins src/architecture.test.ts` → PASS
- [ ] **Step 5: 提交**

```bash
git add web/src/plugins/chat-words server/tests/test_links_chat_words_rank.py
git commit -m "feat(web): chat-words daily task and word-card badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Lane LA · 管理端

### Task LA-1: `GET /api/admin/links`、熔断复位(审计)、诊断两条

**Files:**
- Create: `server/app/links/admin_view.py`、`server/app/routers/admin_links.py`、`server/tests/test_admin_links.py`
- Modify: `server/app/main.py`(路由列表加 `admin_links`,在 `admin_wordbook` 之后)、`server/app/admin/doctor.py`(`Facts` 末尾加 `links_breakers_open: int = 0`、`links_dropped: int = 0`;`gather_facts(session, app)` 从 `getattr(app.state, "learning_bus", None)` 的 `stats()` / `queue()` 取这两个数(管理层读核心对象,不导入 `app.links`);`diagnose` 加两条 `Finding(level="warn", code=…, keys=("links_enabled",), message_zh=…)`)

**Interfaces:**
- Produces:`async view(app, session) -> dict`(spec §9 的结构:`enabled`、`queue`、`links[{key,label_zh,label_en,global,effective,stats,breaker,open_seconds,users_off}]`、`rank_sources[{kind,default_points,points,label_zh,label_en}]`、`errors`、`process_local: true`);`GET /api/admin/links`(viewer);`POST /api/admin/links/{key}/reset-breaker`(operator,CSRF,审计 `links.breaker.reset`,`target_type="link"`、`target_id=key`、无 reason 要求)→ `{"key","state":"closed"}`;未知键 404 `Unknown link`

- [ ] **Step 1: 写失败测试**

```python
import pytest
from sqlalchemy import select

from app.core.learning_events import WordAnswered
from app.models import AdminAudit, UserLinkPref, utcnow
from tests.admin_helpers import ADMIN_ENABLED, assert_no_secrets, login_as
from tests.links_helpers import enable_links


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED, "links_enabled": True, "links_breaker_failures": 1}


async def test_view_shows_counters_sources_and_errors_without_pii(app, client):
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    uid = int((await client.get("/api/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})).json()["id"])
    async with app.state.sessionmaker() as s:
        s.add(UserLinkPref(user_id=uid, link_key="mistakes", enabled=False, updated_at=utcnow()))
        await s.commit()
    bus = app.state.learning_bus

    async def boom(e):
        raise RuntimeError("talk")
    bus.subscribe(WordAnswered, "pron_shadow", boom)
    bus.publish(WordAnswered(user_id=uid + 1, book_id="junior", word="secretword", kind="review", qtype="meaning",
                             outcome="wrong", credit=0, at=utcnow()))
    await bus.drain()
    await login_as(app, client, "viewer")
    body = (await client.get("/api/admin/links")).json()
    assert body["enabled"] is True and body["process_local"] is True
    by_key = {l["key"]: l for l in body["links"]}
    assert set(by_key) == {"word_actions", "daily_tasks", "mistakes", "pron_shadow", "chat_words", "rank_sources"}
    assert by_key["mistakes"]["users_off"] == 1
    assert by_key["pron_shadow"]["breaker"] == "open"
    assert body["errors"][0] == {**body["errors"][0], "link": "pron_shadow", "event": "WordAnswered", "error": "RuntimeError"}
    assert [s["kind"] for s in body["rank_sources"]] == ["word_in_chat"]
    text = str(body)
    assert "secretword" not in text and "talk" not in text and str(uid) not in text
    assert_no_secrets(body, app.state.settings)


async def test_reset_breaker_needs_operator_and_is_audited(app, client):
    async def noop(e):
        return None
    app.state.learning_bus.subscribe(WordAnswered, "pron_shadow", noop)
    viewer = await login_as(app, client, "viewer")
    assert (await client.post("/api/admin/links/pron_shadow/reset-breaker", headers=viewer)).status_code == 403
    op = await login_as(app, client, "operator")
    r = await client.post("/api/admin/links/pron_shadow/reset-breaker", headers=op)
    assert r.json() == {"key": "pron_shadow", "state": "closed"}
    assert (await client.post("/api/admin/links/nope/reset-breaker", headers=op)).json() == {"error": "Unknown link"}
    async with app.state.sessionmaker() as s:
        audit = (await s.scalars(select(AdminAudit).where(AdminAudit.action == "links.breaker.reset"))).one()
    assert audit.target_id == "pron_shadow"


async def test_doctor_flags_open_breakers(app, client):
    from app.admin import doctor
    async def boom(e):
        raise ValueError()
    app.state.learning_bus.subscribe(WordAnswered, "mistakes", boom)
    app.state.learning_bus.publish(WordAnswered(user_id=1, book_id="b", word="w", kind="review", qtype=None,
                                                outcome="wrong", credit=0, at=utcnow()))
    await app.state.learning_bus.drain()
    async with app.state.sessionmaker() as s:
        facts = await doctor.gather_facts(s, app)
    assert facts.links_breakers_open == 1
    assert "links_breaker_open" in {f.code for f in doctor.diagnose(app.state.settings, facts)}
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd server && uv run pytest -q tests/test_admin_links.py` → FAIL
- [ ] **Step 3: 实现**
- `server/app/links/admin_view.py`:

```python
"""管理端「学习联动」视图(spec §9)。计数来自 app.state.learning_bus(进程内,重启清零);不含任何用户数据。"""
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import rank_sources
from app.links.registry import LINKS
from app.models import UserLinkPref
from app.rank import extra_sources
from app.rank.rules_store import rank_rules


async def view(app, session: AsyncSession) -> dict:
    settings = app.state.settings
    bus = app.state.learning_bus
    stats = bus.stats()
    off = dict((await session.execute(select(UserLinkPref.link_key, func.count()).where(UserLinkPref.enabled.is_(False))
                                      .group_by(UserLinkPref.link_key))).all())
    _, rules = await rank_rules(app).current()  # (published version | None, RankRules)
    links = []
    for spec in LINKS:
        s = stats.get(spec.key, {})
        on = bool(getattr(settings, spec.flag, False))
        links.append({"key": spec.key, "label_zh": spec.label_zh, "label_en": spec.label_en, "global": on,
                      "effective": bool(settings.links_enabled and on),
                      "stats": {k: s.get(k, 0) for k in ("published", "handled", "skipped", "failed", "timeouts",
                                                         "dropped", "breaker_skipped")} | {"extra": s.get("extra", {})},
                      "breaker": s.get("breaker", "closed"), "open_seconds": s.get("open_seconds", 0),
                      "users_off": int(off.get(spec.key, 0))})
    sources = [{"kind": src.kind, "default_points": src.default_points, "points": extra_sources.points_of(src, rules),
                "label_zh": src.label_zh, "label_en": src.label_en} for src in rank_sources.registered()]
    return {"enabled": bool(settings.links_enabled), "queue": bus.queue(), "links": links, "rank_sources": sources,
            "errors": bus.recent_errors(), "process_local": True}
```

- `server/app/routers/admin_links.py`:`router = APIRouter(prefix="/api/admin/links")`;`GET ""` 用 `Depends(perms.require("viewer"))`;`POST "/{key}/reset-breaker"` 用 `Depends(perms.require("operator"))`,键不在 `registry.keys()` → 404 `Unknown link`;`app.state.learning_bus.reset_breaker(key)`;`await audit.record(session, ctx.actor, "links.breaker.reset", target_type="link", target_id=key, summary=key)`;`await session.commit()`。`tests/test_admin_routes_guarded.py` 自动覆盖新路由。
- `doctor.py`:两条发现,文案 `links_breaker_open`「学习联动:{{n}} 个联动熔断中(看「学习联动」页的最近错误)」、`links_dropping`「学习联动:事件队列有丢弃,考虑调大 LINKS_QUEUE_MAX」。

- [ ] **Step 4: 跑测试确认通过** — Run: `cd server && uv run pytest -q tests/test_admin_links.py tests/test_admin_routes_guarded.py tests/test_admin_doctor*.py tests/test_architecture.py` → PASS
- [ ] **Step 5: 提交**

```bash
git add server/app/links/admin_view.py server/app/routers/admin_links.py server/app/main.py server/app/admin/doctor.py server/tests/test_admin_links.py
git commit -m "feat(admin): learning links status, breaker reset and doctor findings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task LA-2: 管理前端「学习联动」页

**Files:**
- Create: `admin/src/features/links/{index.ts,api.ts,strings.ts,links-page.tsx,links-page.test.tsx}`
- Modify: `admin/src/app.tsx`(路由 `links`)、`admin/src/components/layout.tsx`(导航「配置」组加「学习联动」)、`admin/src/features/usage/strings.ts`(功能标签 `links: "学习联动"`)

**Interfaces:**
- Produces:`LinksView`(镜像 LA-1 响应)、`fetchLinks()`、`resetBreaker(key)`;页面 `/admin/links`

- [ ] **Step 1: 写失败测试** — `links-page.test.tsx`(沿用 `admin/src/features/wordbook/wordbook-page.test.tsx` 的 fetch mock 与渲染方式):断言表格六行、`pron_shadow` 行熔断显示「打开」、`users_off` 列「1 人关闭」、「最近错误」列表显示 `pron_shadow · WordAnswered · RuntimeError`、「段位来源」表显示 `word_in_chat` 默认 1 点;viewer 角色看不到「复位熔断」按钮(`RoleGate`),operator 点击后发 `POST /api/admin/links/pron_shadow/reset-breaker` 并刷新;小字「本进程统计,重启清零」;总开关关时顶部显示「学习联动总开关已关闭」与「去设置」链接(`/settings/links`)。
- [ ] **Step 2: 跑测试确认失败** — Run: `cd admin && yarn vitest run src/features/links` → FAIL
- [ ] **Step 3: 实现** — 按 admin v2 约定(`features/<area>/{api.ts,strings.ts,*.tsx,index.ts}`、`DataTable`、`StatusDot`、`RoleGate`、`ConfirmDialog` 不需要——复位不是危险操作);配色:健康 = good、熔断打开 = bad 文字、半开 = warn;数字 `tabular-nums`;布局对照视觉稿帧 07(桌面 1440)。
- [ ] **Step 4: 跑测试确认通过** — Run: `cd admin && yarn vitest run && yarn build` → PASS
- [ ] **Step 5: 提交**

```bash
git add admin/src/features/links admin/src/app.tsx admin/src/components/layout.tsx admin/src/features/usage/strings.ts
git commit -m "feat(admin): learning links page with counters, sources and recent errors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Final lane (Z)

### Task Z1: 网页全开 / 全关矩阵、E2E 大纲与文档

**Files:**
- Create: `web/src/plugins/links-matrix.test.tsx`、`web/e2e/links.spec.ts`
- Modify: `docker-compose.e2e.yml`(server 加 `LINKS_ENABLED: "true"`;A 的 Z1 已加 `WORDBOOK_SPOT_CHECK_PCT: "100"`,保留)、`server/README.md`(「学习联动」一节:开关、每用户开关、队列/超时/熔断、隐私与保留、多进程说明、大模型用法检查费用)、`web/README.md`(行为与未验证项)、`server/app/links/CLAUDE.md`、`web/src/plugins/CLAUDE.md`(按最终实现补充)

- [ ] **Step 1: 写矩阵测试** — `web/src/plugins/links-matrix.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ALL_OFF, LINK_KEYS, POINT_NAMES, contributionsFor, routesFor, setLinkFlags, type LinkFlags } from "~/lib/extension-points";
import "~/plugins";

const allOn: LinkFlags = { enabled: true, links: Object.fromEntries(LINK_KEYS.map((k) => [k, true])) as LinkFlags["links"] };
const only = (key: (typeof LINK_KEYS)[number]): LinkFlags =>
  ({ enabled: true, links: Object.fromEntries(LINK_KEYS.map((k) => [k, k === key])) as LinkFlags["links"] });

afterEach(() => setLinkFlags(ALL_OFF));

describe("all-off / all-on matrix", () => {
  it("with every link off only core contributions remain (= today)", () => {
    const visible = POINT_NAMES.flatMap((p) => contributionsFor(p, ALL_OFF).map((c) => `${p}/${c.id}`));
    expect(visible.sort()).toEqual(["appEffects/links.config", "wordActions/vocabulary.add"]);
    expect(routesFor(ALL_OFF)).toEqual([]);
  });

  it("with every link on each point has its contributions", () => {
    const ids = (p: (typeof POINT_NAMES)[number]) => contributionsFor(p, allOn).map((c) => c.id);
    expect(ids("wordActions")).toEqual(["vocabulary.add", "word-actions.more"]);
    expect(ids("wordActionsMenu")).toEqual(["vocabulary.add", "wordbook.adopt", "practice.shadow", "wordbook.card"]);
    expect(ids("dailyTasks")).toEqual(["wordbook.today", "practice.shadow", "chat.talk", "rank.stage", "chat-words.task"]);
    expect(ids("practiceHome")).toEqual(["daily-tasks.card"]);
    expect(ids("learningSources")).toEqual(["pron.weak", "pron.today"]);
    expect(ids("notebookViews")).toEqual(["mistakes.row", "pron.row"]);
    expect(ids("wordDetailSections")).toEqual(["chat-words.badge"]);
    expect(ids("meRows")).toEqual(["links.row"]);
    expect(routesFor(allOn).map((r) => r.path).sort()).toEqual(["/links/mistakes", "/links/weak-words", "/me/links"]);
  });

  it.each(LINK_KEYS)("turning on only %s adds nothing from the other links", (key) => {
    const extra = POINT_NAMES.flatMap((p) => contributionsFor(p, only(key)).filter((c) => c.link && c.link !== key));
    expect(extra).toEqual([]);
  });
});
```

(`architecture.test.ts` 的 `PENDING` 此时应为空集合:Z1 把它删掉并让「每个点都被渲染」用例无白名单运行。)

- [ ] **Step 2: 写 E2E 大纲** — `web/e2e/links.spec.ts`(`chromium-mobile`,沿用其他 spec 的登录夹具;零上游——不评测、不调大模型):注册 → 练习页出现「今日任务」卡,「背单词」行未完成 → 选书「初中」→ 学新词一轮(A 的流程:每张遮罩词卡都点「模糊」,这样每个词都进本轮小测,与抽查比例无关),在小测里故意选错 1 个 → 回「我的 → 词汇本」:出现「易错词 · 1」,进入能看到该词 → 查词浮层(在一段对话文字上长按选词)「加入生词本」旁有「更多」,面板四行 → 「我的 → 学习联动」关掉「易错词」→ 生词本入口消失 → 打开回来入口恢复。
- [ ] **Step 3: 跑** — `docker compose -f docker-compose.e2e.yml up -d --build`;`yarn web:e2e --project=chromium-mobile web/e2e/links.spec.ts` → PASS;因为 E2E 栈现在 `LINKS_ENABLED=true`,再跑一次全部既有规格(`yarn web:e2e --project=chromium-mobile`):练习页多出的「今日任务」卡、生词本按钮旁的「更多」不得让既有规格失败(失败时修本计划的实现或该规格的选择器,不关联动);结果与日期写进 `docs/superpowers/plans/e2e-results.md`(未跑的写「未验证」与原因)。
- [ ] **Step 4: 提交**

```bash
git add web/src/plugins/links-matrix.test.tsx web/src/architecture.test.ts web/e2e/links.spec.ts docker-compose.e2e.yml server/README.md web/README.md server/app/links/CLAUDE.md web/src/plugins/CLAUDE.md docs/superpowers/plans/e2e-results.md
git commit -m "test(web): learning links on/off matrix, e2e flow and deployment docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task Z2: 评审波与合并验收

- [ ] **Step 1** — 全量:`cd server && uv run pytest -q`、`yarn web:typecheck && yarn web:test && yarn web:build`、`cd admin && yarn vitest run && yarn build` 全绿。
- [ ] **Step 2** — 可插拔性实测(不提交):在临时分支删掉 `server/app/links/registry.py` 的 `mistakes.SPEC` 一行与 `web/src/plugins/index.ts` 的 `import "./mistakes";` 一行 → 全量测试只有 `test_links_mistakes.py`、`mistakes-*.test.tsx`、矩阵里对应断言失败,其余全绿,应用照常启动、生词本无「易错词」入口;还原。
- [ ] **Step 3** — `/code-review high` 覆盖整个分支;`security-review` 覆盖 `app/core/learning_events.py`、`app/links/**`、`routers/{links,admin_links}.py`、发布点(消息正文不入库不入日志、他人数据不可读写——每个接口按 `user.id` 过滤、开关不可绕过、大模型额度与降级、管理端无 PII)。
- [ ] **Step 4** — 视觉对照(浏览器窗格 375×812 浅色 + 深色,桌面 1440 管理端)与真机清单(spec §19);勾选本计划已完成任务;未验证项写进 `e2e-results.md`。

---

## 验收标准

1. `LINKS_ENABLED=false`(默认):既有全部测试原样通过(L1 搬走的 `vocabularyFromLookup` 两条断言在 lookup 里原样存在);`test_links_matrix.py` 证明既有响应不变、联动表零写入;网页 `links-matrix.test.tsx` 与 `parity.test.tsx` 证明只剩核心贡献且 DOM 与今天相同。
2. 打开总开关:六个联动按 spec §6 工作;每个联动可由管理端全局关、可由用户在「我的 → 学习联动」关,关闭后接口 404、处理器跳过(`skipped` 计数)、网页入口消失。
3. 分层:服务端 `test_links_is_a_top_layer` 与网页插件 / 注册文件 / 跨 feature 基线规则通过;跨 feature 边从 21 条降到 16 条;`AddVocabularyButton` 只在 vocabulary 内部引用。
4. 段位:`git diff` 显示既有 `server/tests/test_rank_*.py` / `test_admin_rank*.py` 零改动且全绿;`ledger.py` 只有五行新增;`test_rank_extra_sources.py` 通过。
5. 健壮性:通道测试覆盖丢弃、超时、熔断、gate 异常、发布永不抛错;每个处理器的重放幂等用例通过;日志卫生用例通过。
6. 管理端:`/admin/links` 显示计数、熔断、关闭人数、段位来源、最近错误(无 PII);复位熔断有审计;诊断两条发现生效;设置页「学习联动」组可热改。
7. 迁移 0013 往返通过,`down_revision="0012"`,单 head。
8. `yarn web:build` 主包增长 ≤ 8 kB(与 Task 0 记录比较);新页面与面板懒加载。
9. 视觉稿七帧逐一对照截图;真机清单逐项标注已验证 / 未验证。


---

## Addendum (2026-10-11) · Index reconciliation(`plans/2026-10-11-wordbook-links-INDEX.md`)

本计划与 A(三档自评 / 快速回忆)、B(每日目标)对齐后的改动。任务 ID 不变;规则以 INDEX §3 为准。

| # | 位置 | 改了什么 | 原因 |
|---|---|---|---|
| C-1 | 全文与 spec(Global Constraints、Task 0、F3、验收 7;spec 头部、§1、§10、§15、§17、L-R11) | 迁移 `0015_learning_links`(`down_revision = "0014"`)改为 `0013_learning_links`(`down_revision = "0012"`);测试名 `test_0013_…`;单 head 断言 `["0012"]` → `["0013"]`;Task 0 的 heads 检查改为 `0012`,不符时按 INDEX §5 顺延而不是停工 | A、B 都不加迁移,实际 head 是 0012(INDEX §5) |
| C-2 | 共享文件插入点表、F5 实现、spec §4.2 / §16 | `WordAnswered` 发布点从两处变为三处(四个附加点):`answer()` 客观题路径、A 的 `_rating_answer()` 末尾提交之后、`spell_submit()`;抽查 pending 不发布;B 的 `bonus`/`goal`/`reset` 不发布;字段枚举加 `relearn`、`recall`、`know`/`know_chk`/`fuzzy`/`unknown` | A 之后三档自评走另一条提交路径,只插一处会漏掉全部自评作答(INDEX R-E1、R-E2) |
| C-3 | F5 Step 1 | 新增 `test_rating_answers_publish_once_and_pending_checks_do_not` | 锁定「每条作答记录恰好一次」 |
| C-4 | L3-1(接口、测试、实现)、spec §6.3 | 易错词规则:`RIGHT` 加 `know`;`unknown` 只在 `kind ∈ {review, practice}` 时算错(新词第一次标「不认识」不算);`fuzzy`、`know_chk` 中性;新增 `test_self_rating_outcomes_follow_the_index_rules` | A 新增的 outcome 原计划不认识:`known` 不再写入,「认识」答对不会移出(INDEX R-E3) |
| C-5 | L5-1(docstring、测试)、spec §6.5 | 「今日词」只认 `learn`,B 的 `relearn` 不算;新增 `test_relearned_words_are_not_todays_words` | 防止「重置 → 重学 → 对话」重复拿 `word_in_chat`(INDEX R-P4) |
| C-6 | spec §6.4 | 今日新词例句 = 本地日 `kind ∈ {learn, relearn}`(随 B 的 `store.LEARN_KINDS`,代码不改) | B 改了 `today_learned_keys` 的口径 |
| C-7 | L2-2、spec §6.2 | 今日任务「背单词」行完成 = `plan.goalMet ∨ (newLeft = 0 ∧ reviewLeft = 0)`;`plan` 为 null(B 的暂停)时不出现 | B 的加练会让 `newLeft` 重新大于 0;用 B 的达标口径(INDEX R-T1) |
| C-8 | 共享文件插入点表、spec §16 | `word-card.tsx` 锚点改为 A 的 `covered` 三元块之后,并且 `covered` 时不渲染插槽 | A 的 W3 删掉了原锚点 `) : null}` + `</SurfaceCard>` |
| C-9 | F2、共享文件插入点表、spec §16 | `config.py` 锚点写明为 `wordbook_data_dir: str = ""` 之后;practice / me / app / main 标为「仅 C」 | A、B 实际不改这些页面;A、B 都改背单词设置段 |
| C-10 | 架构说明、spec §3 / §5.3 | `ledger._sync` 的改动统一写为「一行导入 + 四行附加」 | 原 spec 写三行、L6-1 写五行(1 + 4),以 L6-1 为准 |
| C-11 | Z1 | E2E 学词改为每张卡点「模糊」;`docker-compose.e2e.yml` 保留 A 的 `WORDBOOK_SPOT_CHECK_PCT`;`LINKS_ENABLED=true` 后跑全部既有 E2E 规格 | A 改了学新词流程;总开关在 E2E 栈打开会影响其他规格的页面 |

开工前提(取代 Task 0 Step 1 的「等 A、B」):F1、F3、F4、F6 只碰本计划独占文件,可在 A、B 合并前开发;F2 等 B 的 GS2;F5 等 A 的 S4 与 B 的 GS3;F7 等 A 的 W3;L2-2 等 B 的 GW2;L3-1 等 A 的 S4;L4-1 等 B 的 GS3;**合并**一律在 A、B 全部合并之后(INDEX §2)。

## Addendum (2026-10-11) · Foundation lane 执行记录(F1–F7)

Task 0:`alembic heads` = `0012 (head)`,迁移号不顺延(`0013_learning_links`,`down_revision = "0012"`)。基线:服务端 2,931 通过;网页 188 文件 / 2,472 测试;管理端 43 / 187;主包 `index-*.js` 1,576,878 B(gzip 506.54 kB)。

- Ruling: F1 追加 `test_run_loop_processes_published_events_and_stops_on_cancel`(后台 `run()` 循环);`tests/test_architecture.py` 追加 `test_neutral_core_modules_use_the_standard_library_only`(`core/learning_events.py`、`core/rank_sources.py` 只用标准库,原来只写在文字里)。
- Ruling: F2 的 15 条设置追加在 `_ALL` 最末(ops 段之后);设置测试另断言 `("links", "学习联动") in GROUPS`。
- Ruling: F3 删除用户测试同时断言另一个用户的联动行不受影响;F4 另加 `purge()` 测试(`test_links_models.py`)。
- Ruling: F4 `tests/links_helpers.py` 自带 `shape()`(与 `test_web_contract.shape` 相同),不导入那个测试模块(它会连带导入 rooms WebSocket 测试依赖)。另加 `require_link` 端点守卫与「PUT prefs 立即失效本进程缓存」两条测试。
- Ruling: F5 通道 gate 由 `setup.install` 包一层:只有 registry 里的联动键走三级判断,其他订阅名(测试记录器、诊断)只受总开关约束(publish 已判断)。原因:计划的发布点测试用 `rec_WordAnswered` 之类的名字订阅,而 `LinkGate` 对未知键返回 False(`test_unknown_link_is_off`),两者不改一处必有一处失败。新增 `test_the_bus_gate_applies_the_three_levels_to_registered_links_only`。
- Ruling: F5 `test_spell_submit_publishes_one_event_per_word` 在 `rec.seen.clear()` 之前先 `drain()`(否则用 `known: true` 学词时排队的 6 条 learn 事件会在提交拼写后才被处理、混进断言);夹具组不出拼写组时改为断言失败而不是 `skip`。另加「处理器读库能看到已提交的事件行」与「处理器抛错不影响响应」两条。
- Ruling: F5 矩阵测试加强为逐值比较:全开与六个「只开一个」各自在全新应用上跑同一场景(选择题答错、三档自评「不认识」、对话、生词本、`/today`),去掉 id 与时间后与全关结果完全相等;全关另断言队列为空、`published` 全 0、五张联动表零行。
- Ruling: F6 注册表多一个 `allRoutes()`,`extension-points-react` 多一个 `<LinkRoute>`;`app.tsx` 把全部路由贡献挂在 AppShell 下、由 `LinkRoute` 决定:可见 → 渲染;旗标未到(仍是 `ALL_OFF` 本身)→ 不渲染;已到但不可见 → `<Navigate to="/practice">`。原因:按计划写 `routesFor(useLinkFlags())` 时,刷新或直达 `/me/links` 会在旗标到达前被 `*` 兜底送回练习页(spec §19「升级后可直达」)。代价:总开关关时访问 `/me/links` 先空白一瞬再回练习页(原来立即回)。
- Ruling: F6 `<WordActions>` 测试改为「插槽输出与直接渲染 `AddVocabularyButton` + 测试贡献的 DOM 完全相同」(核心贡献在测试里也已登记,原断言会撞上它)。
- Ruling: F7 `test/setup.ts` 不在文件顶部静态导入 `~/plugins/core`,改为全局 `beforeEach` 里 `await import("~/plugins/core")`:静态导入让 vocabulary 模块在各测试文件的 `vi.mock`(sonner、`~/features/chat` 等)登记之前求值,137 个既有测试失败。架构规则对动态导入同样适用。
- Ruling: F7 `isRegister` 正则的扩展名改为可选(`to` 已去掉扩展名,计划的正则对 `~/features/vocabulary/register` 永远不命中,`pages/x.tsx` 用例会得到 1 条而不是 2 条)。
- Ruling: F7 `vocabulary-page.tsx` 的 `notebookViews` 插槽放在 `{items.length > 0 && (` 之前(计划锚点落在该条件的 JSX 括号里,语法不成立;而且「易错词」等虚拟视图在生词本为空时也要能出现)。
- Ruling: F7 设置页懒加载(`lazy` + `Suspense fallback={null}`,单独 chunk 约 1.3 kB gzip);列表分组标题新键 `web.links.settings.group`;保存失败 toast 标题 `saveFailed`、描述为服务端错误翻译。每个插件桩目录与 `plugins/links/` 各有 `CLAUDE.md`(车道替换时一并更新)。
- 未做:F7 Step 5 浏览器视觉检查(留给 Z2 的视觉对照)。
- 发现(不在本计划范围):`admin/users_admin.delete_user` 不删除背单词表(`wordbook_enrollments`、`wordbook_events` 等)的行。

<<<<<<< HEAD
## Addendum (2026-10-11) · Lane L6 执行记录(L6-1、L6-2)

- Ruling: L6-1 `ledger._sync` 的附加严格是「一行导入 + 四行」(计划代码块实际是五行:`if` 拆成两行、`capped` 调用折行);改为 `watermark = watermark if extra_mark is None else min(watermark, extra_mark)` 一行、`extra = [... not in seen]` 一行,语义不变。`git diff` 对 `ledger.py` 只有这 5 行新增、零删除;既有 `test_rank_*.py` / `test_admin_rank*.py` 零改动且全绿。
- Ruling: L6-1 测试用户名 `"a"` / `"b"` 低于注册的最短用户名长度(`/api/users` 不返回令牌),改为 `"alpha"` / `"bravo"`。`run_sync` 多一个 `now` 参数。
- Ruling: L6-1 追加四条测试:注册表为空时 `_sync` 的 SQL 语句数与写入行与「去掉钩子」完全相同(spec §5.4 的证明,用 monkeypatch 把 `collect`/`capped` 换成空实现对照);较早同步入账的联动点计入之后同步的剩余额度(既有点数不减,当天最多超出子上限——spec 记录的上界);满 `MAX_ROWS` 时水位下移、下次同步补齐;`points_of`/`sub_cap` 跟随规则或默认值;另断言 `sources_daily_cap = 101` 被拒。
- Ruling: L6-1 `extra_sources` 查询的 `in_()` 参数用排序后的列表(语句文本稳定),按 `(created_at, id)` 排序;其余与计划代码相同。
- Ruling: L6-2 `rank_sources` 联动没有订阅、没有接口,因此没有 `links_rank_sources_contract.json`;`test_rank_extra_sources.py` 用 `enable_links` 断言 `/api/links/config` 里 `rank_sources` 跟随 `link_rank_sources_enabled`,并断言 `SPEC.install`/`SPEC.router` 为 `None`。
- Ruling: L6-2 管理端测试的样例构造函数是 `test-fixtures.ts` 的 `defaultRules()`(计划写 `sampleRules()`);另加 `rules-tabs/points-tab.test.tsx`(规则页真实往返:改「每轮文字对话」后保存的草稿保留 `sources`、可改来源点数与子上限;旧规则显示默认 5 与空提示,保存时不凭空写入这两个字段;越界禁止保存)。`rules-schema.ts` 新增 `sourcesDailyCap()`(缺省 5)。
- Ruling: L6-2 「影响预演不模拟联动来源」的说明放在点数页「联动来源」小节的提示里(预演页 `simulate-panel.tsx` 不在本车道独占文件内);来源列表 v1 取规则里的 `points.sources`(`GET /api/admin/links` 的 `rank_sources` 由 LA 提供,之后再接)。
- Ruling: L6-2 网页只加 `RECENT_KINDS` 一项与两条文案,`rank-home-page.test.tsx` 不改(按计划);键对齐由 i18n 测试覆盖。
=======
## Addendum (2026-10-11) · Lane L1 执行记录(word_actions)

- Ruling: L1-1 `GET /api/links/wordbook/card` 在**所有**启用的书都读不到数据(`DataUnavailable`)时返回 503 `Wordbook data unavailable`(接口说明里的「数据缺失 → 503」);计划代码一律 `continue` 后落到 404,会把数据故障说成「没有这个词」。部分书缺数据仍跳过(同 `service.find_card`)。
- Ruling: L1-1 按 owner 裁定,「加入词书学习」不受 `daily_new` 限制(建的是立即到期的 box 0 复习词条,不是今日新词);新增 `test_adopted_words_come_up_in_review_and_ignore_the_daily_new_goal`(`daily_new: 1` 时连加三个都 `added`、`plan.new_done/new_left` 不变、三个词出现在复习批次、游标仍 0、`link_credits` 零行)。另加用户偏好关 / 总开关关两个接口都 404 且零写入、书数据缺失 503 + 日志不含词的用例。
- Ruling: L1-1 日志卫生用例只检查 `app.*` 日志器:测试客户端 httpx 自己会把请求 URL(含 `?word=`)记进日志。观察(不在本车道范围):生产的 `uvicorn.access` 访问日志同样会带上 `?word=` 查询串(既有 `/api/wordbook/cards/{book}/{key}` 也把词放在路径里),接口形状按 spec §7.2 保留。
- Ruling: L1-2 `parity.test.tsx` 另导入本插件(`import "./index"`)并多一组「除 word_actions 外全开」的逐字节对照(四种用法各一):证明其他联动打开时插槽仍只渲染核心按钮;L1-3 再加「word_actions 开」时首个子节点与旧按钮逐字节相同、只多一个 `-more` 兄弟按钮。`word-target.test.ts` 的截断用例另断言词头按 100 个码点截断,上限取 `MAX_WORD_TARGET` 而不是写死数字。
- Ruling: L1-2 `architecture.test.ts` 除计划的「`AddVocabularyButton` 只在 vocabulary 内部引用」外,另加「基线里的每条边在源码中仍存在、基线共 16 条」:冻结集合只减不增,删了导入却没删基线会让以后的新边悄悄合法。其他车道若删掉某条跨 feature 导入,需同时删基线一行(Z1 合并时处理)。
- Ruling: L1-2 `save-vocabulary-item.test.ts` 删去已搬走用例后,文件顶部只为它服务的 `lookup` 常量一并删除(否则 tsc 报未使用);其余用例逐字未动。
- Ruling: L1-3 面板「加入生词本」一行与英文的文案用 App 里主按钮的现行说法「加入词汇本 / 已在词汇本中」(`web.vocabulary.add` / `inVocabulary` 的中英原文),不用计划与视觉稿的「生词本」:spec 要求这一行「同主按钮」,两个叫法并存会让用户以为是两个本子。`more-button.test.tsx` 的行序正则相应改为 `/加入词汇本.*加入词书学习.*跟读这个词.*查看词卡/`。每行按视觉稿帧 02 加一行副标题(`addHint`/`adoptHint`/`shadowHint`/`cardHint`),另加 `loading`(词卡加载图标的无障碍名)。
- Ruling: L1-3 「背单词关闭时两行词书动作不出现」放在 `features/wordbook/register-word-actions.tsx` 的包装组件里判断(`useWordbookEnabled()`),`AdoptRow` / `CardRow` 本身不判断:计划的 `link-actions.test.tsx` 直接渲染 `CardRow` 且不 mock `/api/wordbook/config`,判断放在行里时该用例永远看不到按钮。
- Ruling: L1-3 面板本身也懒加载(`more-button.tsx` 第一次点开才 `import("./word-actions-sheet")`,0.43 kB gzip);词卡懒加载时连同 `use-speaker` 一起加载(`Promise.all`),词卡上的朗读键可用,而不是计划写法里永远禁用的朗读键;`link-actions.test.tsx` 的 `useTtsPlayer` mock 补 `prime`,词卡常量标注 `Card` 类型(计划原样写 tsc 报 TS7018)。`adoptWord` 返回值经 ApiClient 自动 camelCase,类型为 `{status, bookId}`。
- Ruling: L1-3 「加入词书学习」有结果后整行变为不可点的说明行(`added` / `known` / `not_in_book` 三种文案;`not_in_book` 图标变灰),错误走 toast(本文件内与 `LINKS_SERVER_ERRORS` 同键的小表);「查看词卡」再次点击收起,非 404 错误 toast、404 显示「词书里没有这个词」(`role="status"`)。
- Ruling: L1-3 新增 `plugins/word-actions/word-actions-contract.test.ts`(P-L6:逐键对照 `links_word_actions_contract.json` 与 `AdoptResult` / `LinkCard` / `Card` / `ItemState`)。该文件静态导入本插件:没有 vi.mock 的小测试文件里,`test/setup.ts` 的 `beforeEach(import("~/plugins/core"))` 会在第一个用例里冷编译整条依赖链,机器繁忙时超过 10 秒钩子超时(`links-contract.test.ts` 等同类文件在并行车道同时跑 pytest 时也会这样超时,`--hookTimeout=60000` 下全绿;`test/setup.ts` 不在本车道范围,留给 Z1)。
- Ruling: L1-3 `architecture.test.ts` 扫描整棵源码树的用例(含 L1-2 新增的两个)改为每个文件只读一次(`sourceOf` 缓存)并给 30 秒超时:全量并行运行时同步读几百个文件超过默认 5 秒。规则本身不变。
- 未做:L1-3 Step 5 浏览器窗格视觉检查(需要本车道单独起服务端 + 开发服务器;与 F7 一样留给 Z2 的视觉对照)。主包 `index-*.js` 1,590,093 B(gzip 510.22 kB),比 foundation 结束时 +1.50 kB gzip,比 Task 0 基线累计 +3.68 kB(上限 8 kB)。
- Ruling: L1-3 查词面板(`LookupLayer`,AppShell 常驻)之上打开「单词操作」点「跟读这个词」时,只关了单词操作面板,查词面板留在跟读页上方。`lookup-layer.tsx` 加一处:路径变化且是前进导航(`useNavigationType() === "PUSH"`)时收起查词面板。联动关闭时查词面板里的跳转(「跟读这段」)都先自己关闭、面板是模态的,打开期间不会发生前进导航,所以全关行为不变;返回导航(POP)不处理,与今天相同。新增 `plugins/word-actions/lookup-shadow.test.tsx`;`lookup-layer.test.tsx` 未改。对话回顾与房间小结的面板随页面卸载,不需要处理。
>>>>>>> c-lane-l1
