# 更新日志(服务端 + 网页 + 管理端 + 首批草稿)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 练习页顶栏「练习清单」图标左边多一个「更新日志」入口(星花图标;有未读时红点 + 慢速扩散的提示环,第一次出现未读时下方弹一条一次性小提示「有 N 条新更新」;没有任何已发布条目时整个入口不显示);点开进入整页 `/practice/changelog`(懒加载):按月份分组、类型筛选、首条展开、未读卡片带「新」角标、条目多于 2 条默认折叠、分页滚动加载、骨架 / 空 / 失败重试 / 离线缓存标注。日志存后端,每个用户的已读位置存服务端(多设备同步,新用户首次只把最近 3 条算未读)。管理后台(桌面)新增「更新日志」页:草稿 / 已发布列表 + 编辑器(日期、可选版本号、中英文标题、「类型标签 + 一句话」条目、预览、发布 / 下架 / 删除),沿用管理角色与审计链。仓库里 `docs/changelog/*.json` 是 Claude 起草的草稿源文件,用幂等的导入命令(按「日期 + 中文标题」去重)导入为草稿,由用户在管理端改完再发布;首批 8 条草稿(2026-10-11 … 2026-10-14)已随本计划写好。

**Architecture:** 服务端不新增分层包:逻辑放 `app/admin/changelog.py`(用户侧「公开页 + 已读」与管理侧「校验 + 增改发布下架删除 + 审计」同一个模块,与 `app/admin/announcements.py` 一个做法),路由两个新文件 `app/routers/changelog.py`(`/api/changelog`,登录即可)与 `app/routers/admin_changelog.py`(`/api/admin/changelog`,viewer 读、operator 写),都排在 `stubs` 之前;导入命令 `app/admin/changelog_import.py`(`python -m app.admin.changelog_import`,仿 `recover.py`)。两张新表由迁移 `0020` 建;删除用户时 `changelog_reads` 经 `USER_ROWS` 显式删除。网页新 feature `web/src/features/changelog/`:练习页**不**导入它(那会新增 `practice->changelog` 跨 feature 边,基线冻结在 19 条),而是在 `PageHeader` 的 `actions` 里渲染新扩展点 `practiceHeaderActions` 的插槽,changelog 在 `register.tsx` 里登记一个核心贡献(懒加载入口组件),由 `plugins/core.ts` 导入(R-2)。入口、页面、文案、样式全在懒加载块里,主包只增加 `register.tsx` 与 `lazy-pages.tsx`。已读与未读数放一个小的内存 store(`unread-store.ts`,按「api 实例 + 用户 id」分区),页面打开 1 秒后 `POST /api/changelog/seen`。管理端新 feature `admin/src/features/changelog/`(api / strings / icon / 页面 / 编辑器 / 预览),`layout.tsx` 只导入它的 `strings.ts` 与 `changelog-icon.tsx`。

**Tech Stack:** 服务端 Python 3.12(uv)、FastAPI + SQLAlchemy 2 async + pydantic v2 + Alembic、pytest + pytest-asyncio;网页 React 18 + react-router 6 + i18next + lucide-react + vitest(jsdom);管理端 React 18 + react-router 7 + Tailwind 3 + vitest。不新增任何依赖、不新增设置项、不改 `enjoy/`。

**Spec:** `docs/superpowers/specs/2026-10-14-changelog-design.md`(全部,唯一依据;D1–D6、§2.1–§2.3、§3、§4)。视觉依据:`docs/superpowers/design/changelog-v1/mockup.html`。先例:`app/admin/announcements.py` + `routers/admin_ops.py`(公告的管理 CRUD + 审计)、`app/routers/announcements.py`(公开接口)、`app/admin/recover.py`(命令行)、`app/routers/dictionary.py` + `tests/test_dictionary_contract.py`(契约夹具)、`web/src/features/library/{lazy-pages,locales,library-lazy.test}`(懒加载页与懒加载文案)、`web/src/features/chat/register-selection-actions.tsx`(核心贡献)、`admin/src/features/ops/announcements-page.tsx`(管理页)。

## Global Constraints

- **合并顺序(spec §4):** 服务端(Task S1 → S5)→ 网页(W1 → W4)‖ 管理端(A1 → A2)→ 文档(D1)→ 首批草稿导入(部署后的运维动作,见「收尾」)。W2 与 A1 的契约测试读 S5 录制的夹具,所以两者都在 S5 合并之后。W1 不依赖服务端。
- **分层与基线不放宽:** `server/tests/test_architecture.py` 与 `web/src/architecture.test.ts` 一字不改(`CROSS_FEATURE_BASELINE` 仍是 19 条,不加边)。新服务端模块全在 `app/admin/` 与 `app/routers/`;网页 `features/changelog/register.tsx` 不导入别的 feature,只被 `plugins/core.ts` 导入。
- **隐私(spec §3):** 更新日志是公开发布说明,但新模块里**没有任何 logging 调用**(`test_changelog_privacy.py` 静态钉住);错误体、审计行与日志里只出现条目 id 与动作,不出现标题或条目文字(校验错误只回字段名与规则);URL 里只有 `cursor`、`limit` 与条目 id。导入命令只打印数量与「文件名[序号]: 字段名」。
- **迁移:** 新迁移 `0020`(只建表,不改旧表);`tests/test_migrations.py` 与 `tests/test_library_models.py` 里钉住 head `0019` 的 6 处随之改成 `0020`(S1)。
- **不动用户的未提交改动:** 工作树里根 `CLAUDE.md`、`.gitignore`、`scripts/`、`.claude/` 有用户未提交的改动 / 未跟踪文件。**不要** `git add -A` / `git add .`,每次提交只按路径 `git add` 本任务列出的文件;本计划不编辑根 `CLAUDE.md`(命令说明放 `docs/CLAUDE.md` 与 `server/app/admin/CLAUDE.md`)。
- **工作树是 CRLF**(`core.autocrlf=true`):改现有文件用 Edit 工具,新文件用 Write。Edit 在 CRLF 文件里插入多行时可能出现混合换行,提交时 git 会规整,不用手工处理;锚点一律用**单行**文本。
- **测试只跑本任务列出的:** 服务端 `cd server && uv run pytest -q <列出的文件>`;网页 `cd web && yarn vitest run <列出的文件>`(网页类型检查 `yarn web:typecheck` 只在用户要求时);管理端 `cd admin && yarn vitest run <列出的文件>`。全量套件、E2E、`yarn web:build`、容器重建只在用户要求时做;主包体积检查见「收尾」。
- **提交:** conventional,一个任务一个提交,每个提交后本任务列出的测试全绿;信息以空行 + `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾。
- **首批草稿的内容归计划作者:** `docs/changelog/2026-10.json` 已写好(8 条,日期 2026-10-11 … 2026-10-14,全部 `version: null`),Task S4 只提交它并用测试校验;**不要**改措辞,发现与事实不符才停下报告。
- **验证口径(如实):** 写计划时先读真实代码,再把本计划的全部代码在**仓库外的临时副本**(会话 scratchpad;仓库里没有改任何文件)里按任务应用并运行过。读过的真实源码:`server/app/{models,main}.py`、`app/admin/{announcements,audit,recover,users_admin,perms}.py`、`app/routers/{announcements,admin_ops,dictionary}.py`、`app/core/{deps,db,errors}.py`、`alembic/versions/0013/0014/0018/0019`、`tests/{conftest,admin_helpers,test_announcements,test_admin_users,test_admin_recover,test_admin_routes_guarded,test_architecture,test_migrations,test_library_models,test_dictionary_contract,test_web_contract}.py`;网页 `src/{app.tsx,architecture.test.ts}`、`lib/{extension-points,extension-points-react,kv-cache,storage}`、`plugins/*`、`features/{practice,library,wordbook,chat,lookup}/…`、`layout/*`、`components/{announcement-banner,glass-top-bar,tone,list-card}`、`api/client.ts`、`auth/device-data.ts`、`test/{setup,render,fetch-mock}`、`build/main-bundle.test.ts`、`scripts/check-main-bundle.mjs`;管理端 `src/{app.tsx,components/{layout,confirm-dialog,role-gate,data-table,states}.tsx,features/{ops,library}/*,api/client.ts}`。在临时副本里的实际结果(jsdom / SQLite,Node 24):服务端 S1–S5 的新测试加 `test_migrations`、`test_library_models`、`test_admin_users`、`test_architecture`、`test_admin_routes_guarded`、`test_library_image`、`test_announcements` 共 110 个全绿;网页 W1–W4 的 `features/changelog` 49 个测试、`practice-page.test.tsx` 28 个(含新增 3 个)、`architecture.test.ts`、`links-matrix`、`extension-points`、`auth`、`lib` 全绿,`tsc --noEmit` 无错误;管理端 A1–A2 的 `features/changelog` 16 个测试加 `components`、`features/links`、`app.test.tsx` 共 43 个全绿,`tsc --noEmit` 无错误。这轮运行发现并已改进计划的问题:未登录 POST 返回 401(不是 403)、隐私测试里 aiosqlite 的 DEBUG 记录会打印 SQL 参数(改成只收 `app` 日志)、CSS 注释里的词触发了「无模糊层」断言、两处 TS 隐式 any、插入测试片段时多带了一行锚点。副本里没有运行的:全量套件、其他计划的契约测试(副本没带它们的夹具)、`yarn web:build`、E2E、真实 Postgres。执行者第一次在真实仓库运行时仍以真实结果为准修正**测试数据与超时**,不得改动本计划的裁定、接口名与隐私断言。没有真机 / 真浏览器运行过的一律在文末「未验证清单」。

---

## 文件结构

```
server/
  alembic/versions/0020_changelog.py        新(S1)
  app/models.py                             [改] ChangelogEntry、ChangelogRead(S1)
  app/admin/users_admin.py                  [改] USER_ROWS 加 ChangelogRead(S1)
  app/admin/changelog.py                    新:公开页 + 已读(S2);校验 + 管理操作 + 审计(S3)
  app/admin/changelog_import.py             新:导入命令(S4)
  app/routers/changelog.py                  新:/api/changelog(S2)
  app/routers/admin_changelog.py            新:/api/admin/changelog(S3)
  app/main.py                               [改] 导入名两处 + 路由顺序两处(S2、S3)
  Dockerfile、Dockerfile.dockerignore       [改] 镜像带上 docs/changelog(S4)
  tests/test_changelog_models.py            新(S1)
  tests/test_migrations.py、test_library_models.py   [改] head 钉子 0019 → 0020(S1)
  tests/test_changelog_api.py               新(S2)
  tests/test_admin_changelog.py             新(S3)
  tests/test_changelog_import.py            新(S4)
  tests/test_changelog_contract.py、fixtures/changelog_contract.json   新(S5)
  tests/test_changelog_privacy.py           新(S5)
docs/changelog/2026-10.json                 已写好,S4 提交
web/src/
  lib/extension-points.ts                   [改] 扩展点 practiceHeaderActions(W1)
  lib/extension-points.test.tsx、plugins/links-matrix.test.tsx   [改](W1、W3)
  features/practice/practice-page.tsx(+ test)   [改] PageHeader actions 里渲染插槽(W1、W3)
  lib/storage.ts、auth/device-data.ts       [改] CHANGELOG_PREFS_KEY 与退出登录清理(W3)
  plugins/core.ts                           [改] 导入 changelog/register(W3)
  app.tsx                                   [改] 路由 /practice/changelog(W4)
  features/changelog/
    index.ts                                新:只导出 ChangelogPage(W4)
    api.ts、api.test.ts、changelog-contract.test.ts   新(W2)
    entries.ts、entries.test.ts             新:分组 / 筛选 / 折叠 / 日期格式(W2)
    locales.ts、locales/{en,zh-CN}.json、locales.test.ts   新:懒加载文案(W2)
    changelog.css、changelog-css.test.ts    新:提示环、提示气泡、跟读库标签色(W2)
    unread-store.ts(+ test)、use-unread.ts、hint-pref.ts、use-one-time-hint.ts   新(W3)
    changelog-entry.tsx(+ test)、register.tsx、changelog-lazy.test.ts、changelog-prefs.test.ts   新(W3)
    use-changelog-list.ts、use-near-end.ts、entry-card.tsx、changelog-page.tsx(+ test)、lazy-pages.tsx   新(W4)
    CLAUDE.md                               新(D1)
admin/src/
  features/changelog/{api.ts,api.test.ts,strings.ts,changelog-icon.tsx,index.ts}   新(A1)
  features/changelog/{changelog-page.tsx,entry-editor.tsx,entry-preview.tsx}(+ tests)、CLAUDE.md   新(A2、D1)
  components/layout.tsx、app.tsx            [改] 导航项 + 路由(A1)
docs/                                       CLAUDE.md、本计划的真机清单 2026-10-14-changelog-device-checklist.md(D1)
server/app/{CLAUDE.md,admin/CLAUDE.md,routers/CLAUDE.md}、server/tests/CLAUDE.md、web/src/{lib,plugins,features}/CLAUDE.md、web/src/features/practice/CLAUDE.md、web/README.md   [改](D1)
```

## 任务组、依赖与合并顺序

| 组 | 任务 | 依赖 |
|---|---|---|
| **0 前置核对** | Task 0 | 无 |
| **S 服务端**(串行) | S1 迁移与模型 → S2 用户接口 → S3 管理接口 → S4 导入命令与首批草稿 → S5 契约夹具、隐私与路由表 | Task 0 |
| **W 网页**(串行) | W1 扩展点与练习页接线 → W2 接口、文案、样式、纯函数 → W3 入口 → W4 页面与路由 | W1 无依赖;W2 起依赖 S5 的夹具 |
| **A 管理端**(串行,与 W 并行) | A1 接口与导航 → A2 页面 | S5(夹具与接口) |
| **D 文档** | D1 | S、W、A 合并后 |

**本计划内合并顺序:** Task 0 → S1 → S2 → S3 → S4 → S5 → W1 → W2 → W3 → W4 ‖ A1 → A2 → D1。

---

## 本计划的裁定

> 格式:**裁定 / 为什么 / 猜错的代价**。spec 不改;spec 没说、标了「核对」或与真实代码对不上的地方在这里决定。依据写在括号里,都读过真实代码。

- **R-1 迁移号是 `0020`,上一个是 `0019`(spec「核对」)。** 依据:`ls server/alembic/versions` 末尾是 `0019_library_low_confidence.py`;`uv run alembic heads` 输出 `0019 (head)`;`docs/superpowers` 里没有别的计划占用 `0020`。**连带改动**:`tests/test_migrations.py` 有 5 处、`tests/test_library_models.py` 有 1 处钉着 `get_heads() == ["0019"]`(再加一处 `get_revision("0019")` 的链检查),新增迁移必须同提交改成 `["0020"]`(S1 Step 5);`server/app/CLAUDE.md` 的「head `0019`」在 D1 改。Task 0 再确认一次,若 head 已不是 `0019`,**停下**报告(要顺延编号)。*代价*:撞号会让 alembic 出现两个 head,`test_head_is_0020…` 立刻失败。
- **R-2 练习页经新扩展点 `practiceHeaderActions` 拿入口,不直接导入 `~/features/changelog`(spec「核对」)。** 依据:`practice-page.tsx` 已有三条跨 feature 导入(`~/features/chat`、`rank`、`wordbook`,都在 `CROSS_FEATURE_BASELINE` 里),`practice->changelog` 不在基线里,`architecture.test.ts` 的 `new cross-feature edge` 规则会失败,且「基线 19 条、新增即失败」写在 `features/CLAUDE.md`;现成机制是扩展点(`lib/extension-points.ts` 的 `PointProps` + `Slot`,先例 `selectionActions` 由 `features/chat/register-selection-actions.tsx` 贡献)。做法:`PointProps.practiceHeaderActions: Empty`,`POINT_NAMES` 末尾追加;`PracticePage` 的 `PageHeader actions` 变成 `<><Slot point="practiceHeaderActions" props={{}} /><Link … practice-list /></>`;`features/changelog/register.tsx` 用 `contribute({ point: "practiceHeaderActions", id: "changelog.entry", order: 0, component })` 登记**核心贡献**(没有 `link` / `requiresLinks`,旗标全关时也可见,与学习联动开关无关),由 `plugins/core.ts` 导入(`architecture.test.ts` 允许 `plugins/` 导入 `features/<x>/register*`;`test/setup.ts` 对能渲染插槽的测试自动加载 `plugins/core`)。`architecture.test.ts` 的「每个扩展点都被产品代码以 `point="…"` 渲染」「每个 `contribute` 的点名都真实存在」两条测试自动覆盖。*代价*:`links-matrix.test.tsx` 与 `extension-points.test.tsx` 里列点 / 列核心贡献的断言要同步(W1、W3 逐项写明)。
- **R-3 入口组件是懒加载的,主包只增加 `register.tsx`。** 依据:入口图标要等 `GET /api/changelog?limit=1` 回来(没有已发布条目就不显示),本来就是「请求回来后才出现」,懒加载块只是把「块下载」并进同一段等待,不额外造成版面跳动;`register.tsx` 里 `lazy(() => import("./changelog-entry"))` + `<Suspense fallback={null}>`,图标、提示、样式、文案(`./locales`)全在块里。spec 的「主包增量 ≤ 0.5 kB gzip」靠它达成,**只在用户要求构建时**用 `yarn bundle:check --max-delta=0.5` 实测(「收尾」)。`changelog-lazy.test.ts` 静态钉住主包文件不得静态导入懒模块(同 `library-lazy.test.ts`)。*代价*:无。
- **R-4 公开列表的顺序是 `entry_date DESC, id DESC`,不是 spec 字面的「发布时间倒序」(与 spec 的偏差 D-1)。** 依据:日志页按月份分组、卡片上显示的是 `entry_date`;若按 `published_at` 排,管理员从列表顶端(日期最新)往下逐条点「发布」,公开列表就会变成日期最旧的在最上面,月份标题还会反复出现;`entry_date` 排序与 mockup 一致,且 `published_at` 仍决定「是否可见」。游标 = `YYYY-MM-DD.<id>`(只含日期与整数 id,不含文字),严格正则校验,不合法 422 `{"error": "Invalid cursor"}`。*代价*:用户要求回到字面「发布时间倒序」时,只改 `public_page` 的 `order_by` 与游标两处。
- **R-5 `GET /api/changelog` 在 spec 的 `unread` 之外多返回三个字段(与 spec 的偏差 D-2,只增不改):顶层 `latest_id`(最大的已发布条目 id,没有则 `null`)、条目上的 `is_new`(该条是否比已读位置新)、可选查询参数 `limit`(1–20,默认 20)。** 依据:网页要在不拉整页的情况下画入口(`?limit=1`)并知道 `seen` 该报哪个 id;列表按日期排序后「前 `unread` 条」不等于「未读的那些条」,所以逐条 `is_new` 比让网页自己比较 id 更不容易出错;`latest_id` 为 `null` 就是「没有已发布条目」,入口据此隐藏。响应形状:`{entries:[{id, entry_date, version, title_zh, title_en, items:[{tag,zh,en}], published_at, is_new}], next, unread, latest_id}`。*代价*:无。
- **R-6 已读位置规则(spec §2.1 的细化)。** 有 `changelog_reads` 行 → 已读位置 = `last_seen_id`;没有行(新用户)→ 已读位置 = 「已发布条目按 id 倒序的第 4 个」的 id(不足 4 条则 0),所以首次最多 3 条未读(`FIRST_VISIT_UNREAD = 3`)。`unread` = 已发布且未归档且 `id > 已读位置` 的条数。`POST /seen {upto_id}`:`upto_id` 先夹到不超过最大已发布 id(防止把还没发布的条目预先标成已读),目标 = `max(当前有效已读位置, 夹后的 upto_id)`,所以只前进不后退、重复调用幂等;没有任何已发布条目时回 `{"unread": 0, "last_seen_id": 0}` 且不写库;写入用 `insert_ignore` + 条件 `UPDATE … WHERE last_seen_id < :target`(SQLite 与 Postgres 同一路径,无竞态)。`seen` 的响应是 `{unread, last_seen_id}`,网页用它直接更新红点。**已知限制**(写进文档、不修):已读位置按 **id** 比较(spec 规定),所以一条 id 较小的草稿在用户标记已读之后才发布,不会让该用户再亮红点;导入命令按日期升序建草稿,让 id 顺序与日期顺序一致,正常「写完一批再发布」的流程不受影响。
- **R-7 条目类型是 `new | improve | fix | library | other`。** spec D4 写「新功能 / 改进 / 修复 / 跟读库(可扩展到『其他』)」;`other` 现在就放进校验集合(一个常量 `TAGS`),网页对未知类型也一律按 `other` 显示(向前兼容),管理端下拉五项。*代价*:无。
- **R-8 校验与错误格式。** `entry_date` 严格 `YYYY-MM-DD`(先正则再 `date.fromisoformat`,避免 Python 3.11+ 接受 `20261014`、`2026-W42-1` 这类写法);`version` 可空,≤ 24 字符,`[0-9A-Za-z][0-9A-Za-z._+-]*`;`title_zh` 1–80 字;`title_en` ≤ 80 字(可空);`items` 1–20 条(spec 的上限 20),每条只允许键 `tag/zh/en`(多余键报 `items.<i>` 「unknown key」,**不回显键名**),`zh` 1–200 字、`en` ≤ 200 字(spec 的 200)。全部 `strip`。失败回 422 `{"error": "Invalid changelog entry", "fields": {"items.3.zh": "1–200 characters", …}}`(与公告的 422 形状一致:`fields` 在顶层),**字段名与规则里不含任何输入文字**。管理端请求体用宽松的 pydantic 模型(`items: list[dict[str, Any]]`,`extra="forbid"`),长度与枚举全部走手写校验,这样才有「逐键」错误;pydantic 自己的 422 只带 `字段: 规则`(`core/errors.py` 不回显输入)。
- **R-9 状态机:草稿 ⇄ 已发布,删除 = 软删除。** `published_at IS NULL` = 草稿;「发布」写 `published_at`;「下架」把它清回 `NULL`(条目回到草稿);「删除」写 `archived_at`(spec 的 `archived_at` 列),公开接口与管理列表都排除已归档条目,再删 / 再改已归档条目 404。「发布」「下架」幂等:状态没变就不写库、不写审计(同 `announcements.archive`)。*代价*:已归档行永远留在表里(几十行,无所谓),换来「导入命令不会把用户删掉的草稿复活」(R-12)。
- **R-10 审计:动作 `changelog.create|update|publish|unpublish|delete|import`,`target_type="changelog"`,`target_id=<条目 id>`,`summary` 留空,不写 `before` / `after` / `reason`(spec「只记条目 id 与动作,不记正文」)。** 与公告不同(公告把正文前 60 字写进 `summary`),这里严格按 spec。导入命令用 `audit.CLI_ACTOR`(`actor="cli"`),每创建一条草稿记一行 `changelog.import`(同一个事务里提交,链锁只持有一次提交的时间)。*代价*:审计里看不出改了什么;要查就看条目本身。
- **R-11 角色:读 = `require("viewer")`,写 = `require("operator")`(spec D6)。** 管理端导航项 `min: "viewer"`;编辑器的所有写按钮在 `RoleGate min="operator"` 里,查看者看到只读字段。`tests/test_admin_routes_guarded.py` 自动覆盖(不改它)。用户接口只要登录(`current_user`,不是 `limited_user`:读一个公开页与一次写已读位置不消耗上游额度)。
- **R-12 导入命令:位置、目录与幂等规则。** 位置 `server/app/admin/changelog_import.py`(`python -m app.admin.changelog_import [--dir DIR] [--dry-run]`;`app/admin` 已有 `recover.py` 这种命令行先例,`tests/test_architecture.py` 不用改)。目录:`--dir` 优先;否则依次找 `<app 包的上上级>/changelog`(镜像里 = `/app/changelog`)与 `<仓库根>/docs/changelog`(检出里),第一个存在的;都没有退出码 1。**镜像默认不含 `docs/`**(`Dockerfile.dockerignore` 是 `*` 加白名单),所以 S4 给 `server/Dockerfile` 加 `COPY docs/changelog /app/changelog`,给 `Dockerfile.dockerignore` 加 `!docs/changelog`,命令才能在容器里 `docker compose exec server python -m app.admin.changelog_import` 直接用(**不重建容器**,那是用户要求时才做的事)。幂等键 = `(entry_date, title_zh)`,与表里**所有**行比(包括已发布与已归档):已存在就跳过(不改内容、不改状态、不复活被删的草稿);改了中文标题 = 新草稿(写进文档)。全有或全无:任何一个文件 / 条目校验失败,退出码 2、什么都不写,只打印「文件名[序号]: 字段名」。创建的行 `created_by="import"`、`published_at=NULL`,按 `(entry_date, 文件名, 序号)` 升序建(id 随日期升序,见 R-6)。输出只有 `created N, skipped M`(`--dry-run` 为 `would create N, skipped M`),**不打印任何标题**。不放进迁移(spec §2.1)。
- **R-13 契约夹具:一份,服务端录制,网页与管理端各读一次。** `server/tests/fixtures/changelog_contract.json` 由 `test_changelog_contract.py` 录制(`CONTRACT_UPDATE=1` 重录),包含 `empty`、`list`、`probe`(`limit=1`)、`seen`、`admin_list`、`admin_entry`;时间戳固定成 `2026-10-14T00:00:00+00:00`,重录只会出现真实改动。网页 `changelog-contract.test.ts`、管理端 `api.test.ts` 逐键核对各自的解析函数(同 `dictionary-contract.test.ts`)。
- **R-14 网页未读 store:按「ApiClient 实例 + 用户 id」分区,60 秒内不重复请求,飞行中的请求去重。** 依据:`AuthProvider` 的 `api` 在登出 / 登录之间是同一个对象(`useMemo` 依赖是稳定的 `logout`),所以只按 api 分区不够,必须带用户 id;测试里每次 `renderWithProviders` 都新建 `ApiClient`,所以天然互不污染,不需要在别的测试文件里加复位。入口请求用 `?limit=1`(只要 `unread` 与 `latest_id`)。`markSeen` 失败静默(下次打开页面再报)。
- **R-15 一次性提示的「已显示」记在本机偏好里:`CHANGELOG_PREFS_KEY = "enjoy-web.changelog.prefs"`,JSON `{hintSeen: true}`(`lib/storage.ts` 新常量,同 `WORDBOOK_PREFS_KEY`),退出登录由 `clearDeviceData` 清除。** 第一次出现未读时写入并显示;显示后任意 `pointerdown`、点图标、未读归零或 8 秒后收起;之后同一设备不再出现(spec §2.2)。存储不可用时读到 false、写入静默丢弃(`readJson` / `writeJson` 已保证)。不含任何用户数据。
- **R-16 文案全部懒加载:`features/changelog/locales/{en,zh-CN}.json` + `locales.ts`(`ensureChangelogI18n`),不放 `i18n/`(那个目录被 `i18n/index.ts` 急切合并进主包)。** 键 `web.changelog.*`;入口、页面、卡片模块都 `import "./locales"`。英文复数用 `_one/_other`(中文两个都写,同 `web.library.sentences`)。跟随界面语言取文:`pickText(i18n.language, zh, en)`(`~/components/announcement-banner` 已有:中文界面取中文;其他语言取英文,英文为空时回退中文 —— 正是 spec D4「英文留空时显示中文」)。
- **R-17 日志页的几个行为裁定。** ① 首条展开:展示出来的第一张卡默认展开,其余超过 2 条的折叠为前 2 条 + 「展开全部 N 条」。② 筛选:芯片只在已加载条目里出现 ≥ 2 种类型时显示;按类型筛选既筛卡片内的条目,也隐藏没有匹配条目的卡片;类型是「已加载的」不是「全部的」(分页滚动会陆续补全)。③ 分页:底部哨兵用 `IntersectionObserver`(rootMargin 240px)自动触发 `loadMore`,**同时**始终显示「加载更多」按钮(iOS 上 `IntersectionObserver` 在内部滚动容器里的表现未验证,按钮是兜底);失败后按钮变成「重试」。④ `seen`:页面首屏数据就绪且不是离线缓存时,1 秒(`SEEN_DELAY_MS`)后用 `latest_id` 调 `POST /seen`,提前离开页面就不调(清定时器);「新」角标来自加载时的 `is_new`,调完 `seen` 之后本次访问内不消失。⑤ 离线:首页成功时把解析后的第一页写进 `~/lib/kv-cache`(键 `changelog:v1:first-page`,内容公开,退出登录时 `kvClear` 会清);首页请求失败且有缓存 → 显示缓存 + 「离线」提示 + 重试,不分页、不调 `seen`、`is_new` 一律当 `false`;没有缓存 → 失败态 + 重试。⑥ 月份、日期用 `toLocaleDateString(i18n.language, …)`,日期字符串手工拆成本地 `Date(y, m-1, d)`,不受时区影响。
- **R-18 跟读库类型标签用自带的紫色(`.cl-tag-library`)。** 依据:`web/src/styles/theme.css` 没有 purple 令牌(只有 blue / teal / amber / green / red),mockup 用紫色区分「跟读库」;颜色值取自 mockup(浅色 `#EFE9FF` / `#6a3df0`,深色 `rgba(183,156,255,.16)` / `#b79cff`),写在 `changelog.css`,深色用 `.dark` 选择器(与 `theme.css` 一致)。其余四类用 `TONE_CLASS`(new = blue、improve = teal、fix = amber、other = gray)。
- **R-19 管理端:导航项在「配置」组、「公告与维护」之后,`min: "viewer"`;路由 `/changelog`;仅桌面(`AppShell` 已对 < 1024px 渲染 `DesktopOnly`,不另写)。** 编辑器:左列表(日期降序,草稿 / 已发布徽标)+ 右编辑器;中英文用一个「语言」单选切换同时作用于标题与每条文字(同 mockup);「发布」= 先保存(新建或有改动)再发布,走 `ConfirmDialog`;「下架」「删除」也走 `ConfirmDialog`(删除 `danger`);预览是手机卡片样式的只读面板,取文规则与网页一致(英文为空回退中文)。`layout.tsx` 只导入 `features/changelog/{strings,changelog-icon}`(避免循环,同 library)。
- **R-20 删除用户时 `changelog_reads` 要显式删(SQLite 不执行外键级联)。** 依据:`tests/test_admin_users.py::test_delete_user_handles_every_table_that_references_users` 扫描所有指向 `users.id` 的外键,没进 `USER_ROWS` 就失败。S1 把 `(ChangelogRead, "user_id")` 加进 `USER_ROWS`;`changelog_entries.created_by` 是字符串(管理员名),不是外键。
- **R-21 首批草稿的事实依据与取舍。** 8 条都对应 `git log` 里已合并进 `feat/self-hosted-backend` 的功能:已学词页与自由复习(2026-10-11)、已结束房间与重新开启(10-11)、智能体角色 / 带我学 / 记忆 / 房间 @ai(10-12)、英文释义与选词即查(10-13,合并了「英文释义」「英文为默认」「选词操作条」「本地词典优先」)、跟读库上线(10-13,上传 / 链接导入、逐句播放与评分、译文与 AI 分析、玻璃界面 + 外观设置)、iPhone 输入框跳动修复(10-13)、对话里的跟读弹窗与更准的句子时间(10-14,含重新识别)、复习答题后的学习内容(10-14)。条目日期取功能合并的那天(不是写日志的这天)。全部 `version: null`(应用没有对用户可见的版本号)。语气是给终端用户的白话,没有迁移、工作树、接口等内部词,没有密钥。**只写了合并进主分支的行为,没有写「已部署验证」**:这些功能里,智能体、跟读库、背单词受部署开关控制(`AGENTS_ENABLED`、`LIBRARY_ENABLED`、`WORDBOOK_ENABLED`,默认关),所以发布前请用户按自己的部署确认哪些条目对用户可见,这是草稿存在的意义(D5)。

---

### Task 0: 前置核对(只读,不提交)

**Files:** 无改动。

- [ ] **Step 1: 逐项核对;任何一项不成立就停下报告,不要自作主张改计划。**

| # | 核对 | 怎么看 | 不成立时 |
|---|---|---|---|
| 1 | 迁移 head 仍是 `0019` | `cd server && uv run alembic heads` → `0019 (head)` | 停下:要顺延编号(R-1),所有 `0020` 与测试里的钉子一起改 |
| 2 | `main.py` 里 `stubs` 前有 `admin_library,` 一行、`health, announcements, sessions` 一行、导入元组里有 `admin_library` 与 `config_api` | `Grep "admin_library\|health, announcements" server/app/main.py` | 按真实文本调整 S2 / S3 的单行锚点 |
| 3 | 只有 6 处钉着 head `0019` | `Grep "get_heads\(\) == \[\"0019\"\]" server/tests`:`test_migrations.py` 5 处 + `test_library_models.py` 1 处 | 多了就一并改成 `0020`(S1 Step 5),少了就照实 |
| 4 | `CROSS_FEATURE_BASELINE` 仍是 19 条 | `Grep "toBe(19)" web/src/architecture.test.ts` | 照实:计划不加边,数字不动 |
| 5 | `PointProps` 与 `POINT_NAMES` 的现状(末项 `selectionActions`) | `Grep "selectionActions" web/src/lib/extension-points.ts` | 按真实末项调整 W1 的锚点 |
| 6 | 不存在 `web/src/features/changelog`、`admin/src/features/changelog`、`server/app/admin/changelog*.py` | `Glob "**/changelog*"`(排除 `node_modules` 与 `.claude/worktrees`) | 已存在 = 别的工作占用,停下报告 |
| 7 | `docs/changelog/2026-10.json` 存在且 8 条 | `python -I -c "import json;print(len(json.load(open('docs/changelog/2026-10.json',encoding='utf-8'))))"` → `8` | 缺文件:停下报告(计划作者应已写好) |
| 8 | `app.core.db.insert_ignore`、`audit.CLI_ACTOR`、`app.admin.perms.require` 存在 | `Grep "def insert_ignore\|CLI_ACTOR =\|^def require" server/app` | 停下报告 |

- [ ] **Step 2:** `git status --short` 记下用户未提交的文件(`CLAUDE.md`、`.gitignore`、`scripts/`、`.claude/`),全程不碰、不 `git add`。无提交。

---

## 服务端任务组(S)

### Task S1: 迁移 0020、两个模型、删除用户、head 钉子

**Files:**
- Create: `server/alembic/versions/0020_changelog.py`、`server/tests/test_changelog_models.py`
- Modify: `server/app/models.py`、`server/app/admin/users_admin.py`、`server/tests/test_migrations.py`(5 处)、`server/tests/test_library_models.py`

**Interfaces:**
- Produces(`app.models`):`ChangelogEntry(id, published_at, entry_date: date, version, title_zh, title_en, items: list, created_by, created_at, updated_at, archived_at)`、`ChangelogRead(user_id, last_seen_id, updated_at)`。

- [ ] **Step 1: 写失败测试** — 创建 `server/tests/test_changelog_models.py`:

```python
"""迁移 0020_changelog 与两张表(spec 2026-10-14-changelog-design §2.1,计划 2026-10-14-changelog S1)。"""
import sqlite3

from alembic import command
from alembic.script import ScriptDirectory

from tests.test_migrations import _config, _tables

TABLES = {"changelog_entries", "changelog_reads"}
ENTRY_COLUMNS = {"id", "published_at", "entry_date", "version", "title_zh", "title_en", "items", "created_by",
                 "created_at", "updated_at", "archived_at"}
READ_COLUMNS = {"user_id", "last_seen_id", "updated_at"}


def test_head_is_0020_and_the_chain_is_linear(tmp_path, monkeypatch):
    cfg, _db = _config(tmp_path, monkeypatch)
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == ["0020"]
    assert script.get_revision("0020").down_revision == "0019"


def test_0020_creates_both_tables_and_round_trips(tmp_path, monkeypatch):
    cfg, db = _config(tmp_path, monkeypatch)
    command.upgrade(cfg, "0019")
    assert not TABLES & _tables(db)
    command.upgrade(cfg, "0020")
    assert TABLES <= _tables(db)
    con = sqlite3.connect(db)
    try:
        entry_cols = {r[1]: r for r in con.execute("pragma table_info(changelog_entries)")}
        read_cols = {r[1] for r in con.execute("pragma table_info(changelog_reads)")}
        assert set(entry_cols) == ENTRY_COLUMNS and read_cols == READ_COLUMNS
        assert entry_cols["published_at"][3] == 0 and entry_cols["version"][3] == 0 and entry_cols["archived_at"][3] == 0
        assert entry_cols["entry_date"][3] == 1 and entry_cols["title_zh"][3] == 1 and entry_cols["items"][3] == 1
        fks = {(r[2], r[3], r[6].upper()) for r in con.execute("pragma foreign_key_list(changelog_reads)")}
        assert fks == {("users", "user_id", "CASCADE")}
        assert "ix_changelog_entries_entry_date" in {r[1] for r in con.execute("pragma index_list(changelog_entries)")}
        con.execute("insert into users (id, username, password_hash, created_at) values (12345678, 'u', 'x', '2026-10-14')")
        con.execute("insert into changelog_entries (entry_date, title_zh, title_en, items, created_by, created_at, updated_at) "
                    "values ('2026-10-14', '标题', '', '[]', 'test', '2026-10-14', '2026-10-14')")
        con.execute("insert into changelog_reads (user_id, last_seen_id, updated_at) values (12345678, 1, '2026-10-14')")
        con.commit()
    finally:
        con.close()
    command.downgrade(cfg, "0019")
    tables = _tables(db)
    assert not TABLES & tables and "users" in tables
    command.upgrade(cfg, "0020")
    assert TABLES <= _tables(db)
```

- [ ] **Step 2: 看它失败。** `cd server && uv run pytest -q tests/test_changelog_models.py` → 失败(没有 0020)。

- [ ] **Step 3: 迁移** — 创建 `server/alembic/versions/0020_changelog.py`:

```python
"""changelog: entries and per-user read position (spec 2026-10-14-changelog-design §2.1, plan 2026-10-14-changelog)

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-14 12:00:00.000000

New tables only (no ALTER on existing tables), so one path is safe on SQLite and Postgres. changelog_reads.user_id
references users.id ON DELETE CASCADE; SQLite enforces no FK cascade, so app/admin/users_admin.delete_user deletes
explicitly (USER_ROWS). changelog_entries.created_by is the admin's name, not a foreign key.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0020'
down_revision: Union[str, Sequence[str], None] = '0019'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        'changelog_entries',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('published_at', TZ, nullable=True),
        sa.Column('entry_date', sa.Date(), nullable=False),
        sa.Column('version', sa.String(24), nullable=True),
        sa.Column('title_zh', sa.String(80), nullable=False),
        sa.Column('title_en', sa.String(80), nullable=False),
        sa.Column('items', sa.JSON(), nullable=False),
        sa.Column('created_by', sa.String(64), nullable=False),
        sa.Column('created_at', TZ, nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
        sa.Column('archived_at', TZ, nullable=True),
    )
    op.create_index('ix_changelog_entries_entry_date', 'changelog_entries', ['entry_date'])
    op.create_table(
        'changelog_reads',
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('last_seen_id', sa.Integer(), nullable=False),
        sa.Column('updated_at', TZ, nullable=False),
    )


def downgrade() -> None:
    op.drop_table('changelog_reads')
    op.drop_index('ix_changelog_entries_entry_date', table_name='changelog_entries')
    op.drop_table('changelog_entries')
```

- [ ] **Step 4: 模型** — 改 `server/app/models.py`(Edit,单行锚点):
  1. `from datetime import datetime, timezone` → `from datetime import date, datetime, timezone`
  2. 在 `from sqlalchemy import (JSON, BigInteger, Boolean, DateTime, ForeignKey, …` 这一行把 `DateTime,` 前加 `Date, `(得到 `Boolean, Date, DateTime, ForeignKey`;锚点用 `BigInteger, Boolean, DateTime, ForeignKey` → `BigInteger, Boolean, Date, DateTime, ForeignKey`)。
  3. 把 `class UpstreamCall(Base):` 这一行替换为下面两个类 + 原行(新类放在 `Announcement` 之后):

```python
class ChangelogEntry(Base):
    """更新日志条目(spec 2026-10-14-changelog-design §2.1):`published_at` 为空 = 草稿,`archived_at` = 软删除。
    `items` = `[{"tag": new|improve|fix|library|other, "zh": str, "en": str}]`,由 `app/admin/changelog.py` 逐键校验。
    内容是公开的发布说明;日志与审计里不记内容。"""
    __tablename__ = "changelog_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    entry_date: Mapped[date] = mapped_column(Date, index=True)
    version: Mapped[str | None] = mapped_column(String(24), nullable=True)
    title_zh: Mapped[str] = mapped_column(String(80))
    title_en: Mapped[str] = mapped_column(String(80), default="")
    items: Mapped[list] = mapped_column(JSON)
    created_by: Mapped[str] = mapped_column(String(64))  # 管理员名或 "import",不是外键
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ChangelogRead(Base):
    """每个用户读到哪一条(只前进):`last_seen_id` 是 changelog_entries.id,不是外键(条目可被软删除)。"""
    __tablename__ = "changelog_reads"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    last_seen_id: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UpstreamCall(Base):
```

- [ ] **Step 5: 删除用户与 head 钉子。**
  - `server/app/admin/users_admin.py`(Edit,单行锚点):把 `    LibraryAttempt, LibraryItem, LibrarySegment,` 替换为 `    LibraryAttempt, LibraryItem, LibrarySegment,\n    ChangelogRead,`;把 `    (LibraryAttempt, "user_id"), (LibraryItem, "user_id"),  # segments go first, by item (no user_id column)` 替换为它自己 + `\n    (ChangelogRead, "user_id"),  # per-user changelog read position (plan 2026-10-14-changelog R-20)`。
  - `server/tests/test_migrations.py`:Edit `replace_all`,`get_heads() == ["0019"]` → `get_heads() == ["0020"]`(5 处;第一处行尾有注释 `# one head after the admin v2 merge`,子串仍匹配)。
  - `server/tests/test_library_models.py`:把
    ```python
    def test_head_is_0019_and_the_chain_is_linear(tmp_path, monkeypatch):
        cfg, _db = _config(tmp_path, monkeypatch)
        script = ScriptDirectory.from_config(cfg)
        assert script.get_heads() == ["0019"]
    ```
    的函数名改为 `test_chain_through_0019_is_linear_and_head_is_0020`,`["0019"]` 改 `["0020"]`(下面两行 `get_revision("0019")` / `("0018")` 不动);Edit 单行:`def test_head_is_0019_and_the_chain_is_linear` → `def test_chain_through_0019_is_linear_and_head_is_0020`;`    assert script.get_heads() == ["0019"]` → `    assert script.get_heads() == ["0020"]`。

- [ ] **Step 6: 跑本任务的测试,全绿。**
  `cd server && uv run pytest -q tests/test_changelog_models.py tests/test_migrations.py tests/test_library_models.py tests/test_admin_users.py tests/test_architecture.py`
  (重点:`test_models_match_migrations`、`test_user_foreign_keys_in_the_migrated_schema_carry_the_models_on_delete`、`test_delete_user_handles_every_table_that_references_users`。)

- [ ] **Step 7: 提交**(只 `git add` 上面列出的文件):

```
feat(server): changelog tables and migration 0020

changelog_entries (drafts, soft delete) and changelog_reads (per-user read
position, deleted with the user). Head pins in the migration tests move to 0020.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

### Task S2: 用户接口(公开页 + 已读)

**Files:**
- Create: `server/app/admin/changelog.py`(公开部分)、`server/app/routers/changelog.py`、`server/tests/test_changelog_api.py`
- Modify: `server/app/main.py`

**Interfaces:**
- Produces(`app.admin.changelog`):`TAGS`、`PAGE_SIZE = 20`、`FIRST_VISIT_UNREAD = 3`、`ChangelogError(status, message, fields=None)`、`parse_cursor(cursor) -> tuple[date, int] | None`、`async public_page(session, user_id, *, cursor, limit) -> dict`、`async mark_seen(session, user_id, upto_id) -> dict`、`async latest_id(session) -> int | None`、`public_out(row, seen) -> dict`;文件末尾有标记行 `# ---- admin (plan task S3 appends below) ----`。
- Produces(HTTP):`GET /api/changelog?cursor=&limit=`、`POST /api/changelog/seen`(形状见 R-5、R-6)。

- [ ] **Step 1: 写失败测试** — 创建 `server/tests/test_changelog_api.py`:

```python
"""更新日志用户接口(计划 docs/superpowers/plans/2026-10-14-changelog.md S2;spec §2.1):已发布条目、未读数、已读位置。

条目直接写库造数据(管理接口在 S3);草稿 / 已归档的条目对用户不可见。"""
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import select

from app.models import ChangelogRead, User
from tests.admin_helpers import ADMIN_ENABLED, PASSWORD, login_as

ENTRY_KEYS = {"id", "entry_date", "version", "title_zh", "title_en", "items", "published_at", "is_new"}


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "data")}


async def seed(app, day: str, title: str, *, published: bool = True, archived: bool = False, version=None, items=None) -> int:
    from app.models import ChangelogEntry

    now = datetime.now(timezone.utc)
    async with app.state.sessionmaker() as s:
        row = ChangelogEntry(entry_date=date.fromisoformat(day), version=version, title_zh=title, title_en="",
                             items=items or [{"tag": "new", "zh": f"{title}的内容", "en": ""}], created_by="test",
                             created_at=now, updated_at=now, published_at=now if published else None,
                             archived_at=now if archived else None)
        s.add(row)
        await s.commit()
        return row.id


async def register(client, name: str) -> dict:
    r = await client.post("/api/users", json={"username": name, "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def listing(client, headers, **params):
    r = await client.get("/api/changelog", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


async def seen(client, headers, upto: int):
    r = await client.post("/api/changelog/seen", headers=headers, json={"upto_id": upto})
    assert r.status_code == 200, r.text
    return r.json()


async def test_login_is_required(client):
    assert (await client.get("/api/changelog")).status_code == 401
    assert (await client.post("/api/changelog/seen", json={"upto_id": 1})).status_code == 401


async def test_empty_log_has_no_latest_id(client, auth_headers):
    assert await listing(client, auth_headers) == {"entries": [], "next": None, "unread": 0, "latest_id": None}
    assert await seen(client, auth_headers, 5) == {"unread": 0, "last_seen_id": 0}  # nothing published: nothing is written


async def test_drafts_and_deleted_entries_are_invisible_and_the_order_is_by_date(app, client, auth_headers):
    a = await seed(app, "2026-10-12", "A", version="v1.1")
    b = await seed(app, "2026-10-14", "B")
    await seed(app, "2026-10-13", "C", published=False)
    await seed(app, "2026-10-15", "D", archived=True)
    body = await listing(client, auth_headers)
    assert set(body) == {"entries", "next", "unread", "latest_id"}
    assert [e["title_zh"] for e in body["entries"]] == ["B", "A"]
    assert all(set(e) == ENTRY_KEYS for e in body["entries"])
    assert body["entries"][1]["version"] == "v1.1" and body["entries"][0]["version"] is None
    assert body["entries"][0]["items"] == [{"tag": "new", "zh": "B的内容", "en": ""}]
    assert body["entries"][0]["published_at"].endswith("+00:00")
    assert body["next"] is None and body["latest_id"] == b and a < b


async def test_a_new_user_gets_at_most_three_unread(app, client, auth_headers):
    ids = [await seed(app, f"2026-10-{10 + i:02d}", f"T{i}") for i in range(5)]
    body = await listing(client, auth_headers)
    assert body["unread"] == 3
    flags = {e["id"]: e["is_new"] for e in body["entries"]}
    assert [flags[i] for i in ids] == [False, False, True, True, True]


async def test_a_new_user_with_two_entries_has_two_unread(app, client, auth_headers):
    await seed(app, "2026-10-13", "A")
    await seed(app, "2026-10-14", "B")
    body = await listing(client, auth_headers)
    assert body["unread"] == 2 and all(e["is_new"] for e in body["entries"])


async def test_seen_only_moves_forward_is_idempotent_and_clamped(app, client, auth_headers):
    ids = [await seed(app, f"2026-10-{10 + i:02d}", f"T{i}") for i in range(5)]
    assert await seen(client, auth_headers, ids[4]) == {"unread": 0, "last_seen_id": ids[4]}
    body = await listing(client, auth_headers)
    assert body["unread"] == 0 and not any(e["is_new"] for e in body["entries"])
    sixth = await seed(app, "2026-10-15", "T5")
    body = await listing(client, auth_headers)
    assert body["unread"] == 1 and [e["id"] for e in body["entries"] if e["is_new"]] == [sixth]
    assert await seen(client, auth_headers, ids[0]) == {"unread": 1, "last_seen_id": ids[4]}  # never backwards
    assert await seen(client, auth_headers, sixth) == {"unread": 0, "last_seen_id": sixth}
    assert await seen(client, auth_headers, sixth) == {"unread": 0, "last_seen_id": sixth}  # idempotent
    assert await seen(client, auth_headers, 10_000) == {"unread": 0, "last_seen_id": sixth}  # clamped to the newest published
    seventh = await seed(app, "2026-10-16", "T6")
    assert (await listing(client, auth_headers))["unread"] == 1  # the clamp did not mark a future entry as read
    assert seventh > sixth
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(ChangelogRead))).all()
    assert [(r.last_seen_id) for r in rows] == [sixth]


async def test_seen_never_moves_a_new_user_below_the_first_visit_baseline(app, client, auth_headers):
    ids = [await seed(app, f"2026-10-{10 + i:02d}", f"T{i}") for i in range(5)]
    assert await seen(client, auth_headers, ids[0]) == {"unread": 3, "last_seen_id": ids[1]}  # baseline = 4th newest id


async def test_unread_is_per_user(app, client, auth_headers):
    ids = [await seed(app, f"2026-10-{10 + i:02d}", f"T{i}") for i in range(5)]
    bob = await register(client, "bob")
    await seen(client, auth_headers, ids[4])
    assert (await listing(client, auth_headers))["unread"] == 0
    assert (await listing(client, bob))["unread"] == 3


async def test_seen_validation(client, auth_headers):
    for body in ({}, {"upto_id": 0}, {"upto_id": "x"}, {"upto_id": 1, "extra": 1}, {"upto_id": 2_147_483_648}):
        r = await client.post("/api/changelog/seen", headers=auth_headers, json=body)
        assert r.status_code == 422, body


async def test_cursor_pagination_by_date_then_id(app, client, auth_headers):
    ids = []
    for i in range(25):  # five entries per date, so the cursor must tie-break on id
        ids.append(await seed(app, f"2026-09-{1 + i // 5:02d}", f"T{i:02d}"))
    first = await listing(client, auth_headers)
    assert len(first["entries"]) == 20 and first["next"] is not None and first["unread"] == 3
    second = await listing(client, auth_headers, cursor=first["next"])
    assert len(second["entries"]) == 5 and second["next"] is None
    got = [e["id"] for e in first["entries"] + second["entries"]]
    assert len(set(got)) == 25
    expected = sorted(ids, key=lambda i: (1 + (i - ids[0]) // 5, i), reverse=True)
    assert got == expected
    one = await listing(client, auth_headers, limit=1)
    assert len(one["entries"]) == 1 and one["next"] is not None and one["unread"] == 3 and one["latest_id"] == ids[-1]
    assert one["entries"][0]["id"] == expected[0]


async def test_bad_cursor_and_limit_are_rejected_without_echo(client, auth_headers):
    for cursor in ("abc", "2026-13-45.3", "2026-10-14", "2026-10-14.x", "2026-10-14.1234567890"):
        r = await client.get("/api/changelog", headers=auth_headers, params={"cursor": cursor})
        assert r.status_code == 422 and r.json() == {"error": "Invalid cursor"}, cursor
    for limit in (0, 21, "x"):
        r = await client.get("/api/changelog", headers=auth_headers, params={"limit": limit})
        assert r.status_code == 422, limit


async def test_deleting_a_user_removes_their_read_position(app, client, auth_headers):
    ids = [await seed(app, f"2026-10-{10 + i:02d}", f"T{i}") for i in range(2)]
    bob = await register(client, "bob")
    await seen(client, auth_headers, ids[1])
    await seen(client, bob, ids[1])
    uid = int((await client.get("/api/me", headers=auth_headers)).json()["id"])
    h = await login_as(app, client, "superadmin")
    await client.post("/api/admin/step-up", headers=h, json={"password": PASSWORD})
    r = await client.request("DELETE", f"/api/admin/users/{uid}", headers=h,
                             json={"confirm_username": "alice", "reason": "用户要求注销"})
    assert r.status_code == 200, r.text
    async with app.state.sessionmaker() as s:
        remaining = [row.user_id for row in (await s.scalars(select(ChangelogRead))).all()]
        assert len(remaining) == 1 and uid not in remaining  # bob's position stays, alice's is gone
        assert await s.get(User, uid) is None
```

- [ ] **Step 2: 看它失败。** `cd server && uv run pytest -q tests/test_changelog_api.py` → 404 / 导入错误。

- [ ] **Step 3: 服务模块(公开部分)** — 创建 `server/app/admin/changelog.py`:

```python
"""更新日志(spec 2026-10-14-changelog-design §2.1;计划 docs/superpowers/plans/2026-10-14-changelog.md)。

内容是公开的发布说明,不含用户数据;本模块没有任何日志调用,错误体与审计只带条目 id 与动作,不带标题或条目文字。
用户侧:`public_page`(已发布、按 entry_date 倒序、游标分页、带未读数与逐条 is_new)与 `mark_seen`(已读位置只前进)。
管理侧(任务 S3 追加在文件末尾):`validate`、`admin_listing`、`create`、`edit`、`publish`、`unpublish`、`remove`(软删除),
写操作在调用方的同一事务里写审计。
"""
import re
from datetime import date, datetime, timezone

from sqlalchemy import and_, func, or_, select, update

from app.core.db import insert_ignore
from app.models import ChangelogEntry, ChangelogRead, iso_utc

TAGS = ("new", "improve", "fix", "library", "other")
PAGE_SIZE = 20
FIRST_VISIT_UNREAD = 3  # a user without a read row sees at most this many entries as unread (spec D3)
CURSOR_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.(\d{1,9})$")


class ChangelogError(Exception):
    def __init__(self, status: int, message: str, fields: dict | None = None):
        super().__init__(message)
        self.status, self.message, self.fields = status, message, fields


def _live() -> tuple:
    """published and not deleted"""
    return (ChangelogEntry.published_at.is_not(None), ChangelogEntry.archived_at.is_(None))


def parse_cursor(cursor: str | None) -> tuple[date, int] | None:
    if not cursor:
        return None
    match = CURSOR_RE.match(cursor)
    if match is None:
        raise ChangelogError(422, "Invalid cursor")
    try:
        return date.fromisoformat(match.group(1)), int(match.group(2))
    except ValueError:
        raise ChangelogError(422, "Invalid cursor") from None


async def latest_id(session) -> int | None:
    return await session.scalar(select(func.max(ChangelogEntry.id)).where(*_live()))


async def _seen_id(session, user_id: int) -> int:
    """The user's read position: their row, or (first visit) the id of the 4th newest published entry, so at most
    FIRST_VISIT_UNREAD entries count as unread. A scalar select, never the identity map (a bulk UPDATE leaves
    loaded objects stale)."""
    stored = await session.scalar(select(ChangelogRead.last_seen_id).where(ChangelogRead.user_id == user_id))
    if stored is not None:
        return stored
    nth = await session.scalar(select(ChangelogEntry.id).where(*_live()).order_by(ChangelogEntry.id.desc())
                               .offset(FIRST_VISIT_UNREAD).limit(1))
    return nth or 0


async def _unread(session, seen: int) -> int:
    return await session.scalar(select(func.count()).select_from(ChangelogEntry).where(*_live(), ChangelogEntry.id > seen)) or 0


def public_out(row: ChangelogEntry, seen: int) -> dict:
    return {"id": row.id, "entry_date": row.entry_date.isoformat(), "version": row.version, "title_zh": row.title_zh,
            "title_en": row.title_en, "items": row.items, "published_at": iso_utc(row.published_at),
            "is_new": row.id > seen}


async def public_page(session, user_id: int, *, cursor: str | None, limit: int = PAGE_SIZE) -> dict:
    after = parse_cursor(cursor)
    seen = await _seen_id(session, user_id)
    query = select(ChangelogEntry).where(*_live()).order_by(ChangelogEntry.entry_date.desc(), ChangelogEntry.id.desc())
    if after is not None:
        day, last_id = after
        query = query.where(or_(ChangelogEntry.entry_date < day,
                                and_(ChangelogEntry.entry_date == day, ChangelogEntry.id < last_id)))
    rows = list((await session.scalars(query.limit(limit + 1))).all())
    page, more = rows[:limit], len(rows) > limit
    next_cursor = f"{page[-1].entry_date.isoformat()}.{page[-1].id}" if more and page else None
    return {"entries": [public_out(r, seen) for r in page], "next": next_cursor,
            "unread": await _unread(session, seen), "latest_id": await latest_id(session)}


async def mark_seen(session, user_id: int, upto_id: int) -> dict:
    """Advance the read position to `upto_id` (clamped to the newest published id; never backwards; idempotent)."""
    newest = await latest_id(session)
    if newest is None:
        return {"unread": 0, "last_seen_id": 0}
    target = max(await _seen_id(session, user_id), min(upto_id, newest))
    now = datetime.now(timezone.utc)
    await session.execute(insert_ignore(session, ChangelogRead.__table__).values(user_id=user_id, last_seen_id=0, updated_at=now))
    await session.execute(update(ChangelogRead).where(ChangelogRead.user_id == user_id, ChangelogRead.last_seen_id < target)
                          .values(last_seen_id=target, updated_at=now))
    await session.commit()
    seen = await _seen_id(session, user_id)
    return {"unread": await _unread(session, seen), "last_seen_id": seen}


# ---- admin (plan task S3 appends below) ----
```

- [ ] **Step 4: 路由** — 创建 `server/app/routers/changelog.py`:

```python
"""更新日志(用户侧,spec 2026-10-14-changelog-design §2.1):登录即可;内容是公开的发布说明,日志与错误里不记内容。

`GET /api/changelog?cursor=&limit=`:已发布条目(按 entry_date 倒序,每页 20),带 `unread`、`latest_id` 与逐条 `is_new`;
`POST /api/changelog/seen {upto_id}`:已读位置只前进、幂等。必须排在 `stubs` 之前。逻辑在 `app/admin/changelog.py`
(与公告同一做法:routers 可以导入 admin)。
"""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import changelog
from app.core.deps import current_user, get_session
from app.models import User

router = APIRouter(prefix="/api/changelog")


class SeenIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    upto_id: int = Field(ge=1, le=2_147_483_647)


@router.get("")
async def list_changelog(cursor: str | None = Query(None, max_length=32),
                         limit: int = Query(changelog.PAGE_SIZE, ge=1, le=changelog.PAGE_SIZE),
                         user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    try:
        return await changelog.public_page(session, user.id, cursor=cursor, limit=limit)
    except changelog.ChangelogError as e:
        return JSONResponse({"error": e.message}, status_code=e.status)


@router.post("/seen")
async def post_seen(body: SeenIn, user: User = Depends(current_user), session: AsyncSession = Depends(get_session)):
    return await changelog.mark_seen(session, user.id, body.upto_id)
```

- [ ] **Step 5: 接线** — `server/app/main.py`(Edit,单行锚点):
  1. 导入元组(`from app.routers import (` 里):把 `config_api, conversations, dictionary,` 替换为 `changelog, config_api, conversations, dictionary,`。
  2. 路由顺序(`for module in (` 里):把 `health, announcements, sessions,` 替换为 `health, announcements, changelog, sessions,`(必须在 `stubs` 之前,`stubs` 在最后一行)。

- [ ] **Step 6: 跑测试,全绿。** `cd server && uv run pytest -q tests/test_changelog_api.py tests/test_architecture.py tests/test_admin_routes_guarded.py`。

- [ ] **Step 7: 提交:**

```
feat(server): changelog public API with server-side read position

GET /api/changelog (published entries by date, cursor paging, unread count, per-entry
is_new, latest_id) and POST /api/changelog/seen (forward-only, clamped, idempotent).
A new user sees at most the latest three entries as unread.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

### Task S3: 管理接口(校验、增改发布下架删除、审计)

**Files:**
- Modify: `server/app/admin/changelog.py`(追加)、`server/app/main.py`
- Create: `server/app/routers/admin_changelog.py`、`server/tests/test_admin_changelog.py`

**Interfaces:**
- Produces(`app.admin.changelog`):`MAX_ITEMS = 20`、`MAX_TEXT = 200`、`MAX_TITLE = 80`、`MAX_VERSION = 24`、`validate(data: dict) -> dict`(列值,422 抛 `ChangelogError(422, "Invalid changelog entry", fields)`)、`admin_out(row) -> dict`、`async admin_listing(session) -> list[dict]`、`async create(session, actor, data) -> ChangelogEntry`、`async edit(session, actor, id, data)`、`async publish(session, actor, id)`、`async unpublish(session, actor, id)`、`async remove(session, actor, id)`。
- Produces(HTTP,`/api/admin/changelog`):`GET`(viewer)→ `{entries}`;`POST`(operator)201;`PATCH /{entry_id}`;`POST /{entry_id}/publish`;`POST /{entry_id}/unpublish`;`DELETE /{entry_id}` → `{"id", "deleted": true}`。管理条目形状:`{id, status: "draft"|"published", entry_date, version, title_zh, title_en, items, created_by, created_at, updated_at, published_at}`。

- [ ] **Step 1: 写失败测试** — 创建 `server/tests/test_admin_changelog.py`:

```python
"""更新日志管理端(计划 2026-10-14-changelog S3;spec §2.1、D6):校验、状态流转、角色、审计(只记 id 与动作)。"""
import pytest
from sqlalchemy import select

from app.models import AdminAudit
from tests.admin_helpers import ADMIN_ENABLED, login_as

URL = "/api/admin/changelog"
MARK = "ZQMARKER-ADMIN"


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED}


def body(**over) -> dict:
    base = {"entry_date": "2026-10-14", "version": None, "title_zh": "标题", "title_en": "",
            "items": [{"tag": "new", "zh": "一句话", "en": ""}]}
    return {**base, **over}


async def audits(app) -> list[AdminAudit]:
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(AdminAudit).where(AdminAudit.action.like("changelog.%")).order_by(AdminAudit.id))).all())


async def test_create_edit_publish_unpublish_delete_and_the_audit_trail(app, client):
    h = await login_as(app, client, "operator")
    r = await client.post(URL, headers=h, json=body(version="  v1.12 ", title_zh="  标题  ", title_en="Title"))
    assert r.status_code == 201, r.text
    entry = r.json()
    assert set(entry) == {"id", "status", "entry_date", "version", "title_zh", "title_en", "items", "created_by",
                          "created_at", "updated_at", "published_at"}
    assert entry["status"] == "draft" and entry["published_at"] is None and entry["created_by"] == "operator1"
    assert entry["version"] == "v1.12" and entry["title_zh"] == "标题" and entry["entry_date"] == "2026-10-14"
    eid = entry["id"]

    r = await client.patch(f"{URL}/{eid}", headers=h, json={"title_en": "New title", "version": None,
                                                           "items": [{"tag": "fix", "zh": "修好了", "en": "Fixed"}]})
    assert r.status_code == 200, r.text
    assert r.json()["version"] is None and r.json()["title_en"] == "New title" and r.json()["title_zh"] == "标题"
    assert r.json()["items"] == [{"tag": "fix", "zh": "修好了", "en": "Fixed"}]

    r = await client.post(f"{URL}/{eid}/publish", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "published" and r.json()["published_at"]
    assert (await client.post(f"{URL}/{eid}/publish", headers=h)).status_code == 200  # idempotent: no second audit row
    r = await client.post(f"{URL}/{eid}/unpublish", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "draft" and r.json()["published_at"] is None
    assert (await client.post(f"{URL}/{eid}/unpublish", headers=h)).status_code == 200
    r = await client.delete(f"{URL}/{eid}", headers=h)
    assert r.status_code == 200 and r.json() == {"id": eid, "deleted": True}

    rows = await audits(app)
    assert [a.action for a in rows] == ["changelog.create", "changelog.update", "changelog.publish",
                                        "changelog.unpublish", "changelog.delete"]
    for a in rows:
        assert (a.target_type, a.target_id, a.summary, a.before, a.after, a.reason) == ("changelog", str(eid), "", None, None, None)
        assert a.actor == "operator1" and a.result == "ok"


async def test_deleted_entries_are_gone_and_cannot_be_changed(app, client):
    h = await login_as(app, client, "operator")
    eid = (await client.post(URL, headers=h, json=body())).json()["id"]
    await client.delete(f"{URL}/{eid}", headers=h)
    assert (await client.get(URL)).json() == {"entries": []}
    for call in (client.patch(f"{URL}/{eid}", headers=h, json={"title_zh": "x"}), client.post(f"{URL}/{eid}/publish", headers=h),
                 client.post(f"{URL}/{eid}/unpublish", headers=h), client.delete(f"{URL}/{eid}", headers=h)):
        assert (await call).status_code == 404
    assert (await client.patch(f"{URL}/999", headers=h, json={"title_zh": "x"})).status_code == 404


async def test_listing_has_drafts_and_published_newest_date_first(app, client):
    h = await login_as(app, client, "operator")
    a = (await client.post(URL, headers=h, json=body(entry_date="2026-10-12", title_zh="A"))).json()["id"]
    b = (await client.post(URL, headers=h, json=body(entry_date="2026-10-14", title_zh="B"))).json()["id"]
    await client.post(f"{URL}/{a}/publish", headers=h)
    listed = (await client.get(URL)).json()["entries"]
    assert [(e["id"], e["status"]) for e in listed] == [(b, "draft"), (a, "published")]


async def test_roles_viewer_reads_operator_writes_and_a_visitor_gets_nothing(app, client):
    assert (await client.post(URL, json=body())).status_code in (401, 403)  # no session at all
    await login_as(app, client, "viewer")
    assert (await client.get(URL)).status_code == 200
    r = await client.post(URL, headers={"X-Admin-CSRF": "x"}, json=body())
    assert r.status_code == 403
    client.cookies.clear()
    assert (await client.get(URL)).status_code in (401, 403)
    h = await login_as(app, client, "operator")
    assert (await client.post(URL, headers=h, json=body())).status_code == 201


BAD = [
    ({}, {"entry_date", "title_zh", "items"}),
    (body(entry_date="2026-13-40"), {"entry_date"}),
    (body(entry_date="20261014"), {"entry_date"}),
    (body(entry_date="2026-W42-1"), {"entry_date"}),
    (body(title_zh="   "), {"title_zh"}),
    (body(title_zh="题" * 81), {"title_zh"}),
    (body(title_en="t" * 81), {"title_en"}),
    (body(version="v 1"), {"version"}),
    (body(version="v" * 25), {"version"}),
    (body(items=[]), {"items"}),
    (body(items=[{"tag": "new", "zh": "x", "en": ""}] * 21), {"items"}),
    (body(items=[{"tag": "wow", "zh": "x", "en": ""}]), {"items.0.tag"}),
    (body(items=[{"tag": "new", "zh": "", "en": ""}]), {"items.0.zh"}),
    (body(items=[{"tag": "new", "zh": "字" * 201, "en": ""}]), {"items.0.zh"}),
    (body(items=[{"tag": "new", "zh": "x", "en": "e" * 201}]), {"items.0.en"}),
    (body(items=[{"tag": "new", "zh": "x", "en": "", "extra": 1}]), {"items.0"}),
    (body(items=[{"tag": "new", "zh": "ok", "en": ""}, {"tag": "fix", "zh": "", "en": ""}]), {"items.1.zh"}),
]


@pytest.mark.parametrize("payload, keys", BAD)
async def test_validation_names_the_keys_and_never_echoes_text(app, client, payload, keys):
    h = await login_as(app, client, "operator")
    r = await client.post(URL, headers=h, json=payload)
    assert r.status_code == 422, r.text
    assert r.json()["error"] == "Invalid changelog entry" and set(r.json()["fields"]) == keys
    assert (await client.get(URL)).json() == {"entries": []}  # nothing was written


async def test_validation_errors_do_not_echo_the_offending_text(app, client):
    h = await login_as(app, client, "operator")
    r = await client.post(URL, headers=h, json=body(items=[{"tag": "new", "zh": MARK * 40, "en": ""}]))
    assert r.status_code == 422 and MARK not in r.text
    r = await client.post(URL, headers=h, json=body(items=[{"tag": MARK, "zh": "x", "en": "", MARK: 1}]))
    assert r.status_code == 422 and MARK not in r.text
    r = await client.post(URL, headers=h, json={**body(), MARK: 1})  # unknown top-level key: pydantic, field name only
    assert r.status_code == 422


async def test_accepts_the_edges_and_other_tags(app, client):
    h = await login_as(app, client, "operator")
    items = [{"tag": t, "zh": "字" * 200, "en": "e" * 200} for t in ("new", "improve", "fix", "library", "other")] * 4
    r = await client.post(URL, headers=h, json=body(title_zh="题" * 80, title_en="t" * 80, version="1.0.0-rc.1", items=items))
    assert r.status_code == 201 and len(r.json()["items"]) == 20
    r = await client.post(URL, headers=h, json=body(items=[{"tag": "other", "zh": "x"}]))  # `en` may be left out
    assert r.status_code == 201 and r.json()["items"] == [{"tag": "other", "zh": "x", "en": ""}]


async def test_patch_validates_the_merged_entry(app, client):
    h = await login_as(app, client, "operator")
    eid = (await client.post(URL, headers=h, json=body())).json()["id"]
    r = await client.patch(f"{URL}/{eid}", headers=h, json={"items": []})
    assert r.status_code == 422 and set(r.json()["fields"]) == {"items"}
    assert (await client.patch(f"{URL}/{eid}", headers=h, json={"entry_date": "2026-10-15"})).json()["entry_date"] == "2026-10-15"


async def test_publishing_reaches_users_and_unpublishing_hides_it_again(app, client, auth_headers):
    h = await login_as(app, client, "operator")
    eid = (await client.post(URL, headers=h, json=body())).json()["id"]
    assert (await client.get("/api/changelog", headers=auth_headers)).json()["entries"] == []
    await client.post(f"{URL}/{eid}/publish", headers=h)
    page = (await client.get("/api/changelog", headers=auth_headers)).json()
    assert [e["id"] for e in page["entries"]] == [eid] and page["latest_id"] == eid and page["unread"] == 1
    await client.post(f"{URL}/{eid}/unpublish", headers=h)
    page = (await client.get("/api/changelog", headers=auth_headers)).json()
    assert page["entries"] == [] and page["latest_id"] is None
```

- [ ] **Step 2: 看它失败。** `cd server && uv run pytest -q tests/test_admin_changelog.py` → 404 / 导入错误。

- [ ] **Step 3: 服务模块(管理部分)** — 先改 `server/app/admin/changelog.py` 的导入(Edit,单行锚点):
  - `from datetime import date, datetime, timezone` → 同一行 + 下一行 `from typing import Any`
  - `from app.core.db import insert_ignore` → `from app.admin import audit\nfrom app.admin.audit import Actor\nfrom app.core.db import insert_ignore`
  - 在 `CURSOR_RE = …` 之后(Edit 锚点 `CURSOR_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.(\d{1,9})$")`)追加常量:

```python
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")  # date.fromisoformat alone also takes 20261014 / 2026-W42-1
VERSION_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._+\-]*$")
MAX_ITEMS = 20
MAX_TEXT = 200
MAX_TITLE = 80
MAX_VERSION = 24
ITEM_KEYS = {"tag", "zh", "en"}
```

  再把标记行 `# ---- admin (plan task S3 appends below) ----` 替换为它自己 + 下面全部内容:

```python
def _text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) else None


def validate(data: dict) -> dict:
    """Strict, key by key. Returns the column values; on failure raises ChangelogError(422, fields) whose keys and rules
    never contain the offending text (plan R-8)."""
    fields: dict[str, str] = {}
    entry_date = None
    raw_date = data.get("entry_date")
    if isinstance(raw_date, str) and DATE_RE.match(raw_date.strip()):
        try:
            entry_date = date.fromisoformat(raw_date.strip())
        except ValueError:
            pass
    if entry_date is None:
        fields["entry_date"] = "must be a date like 2026-10-14"

    version = data.get("version")
    if version is None or (isinstance(version, str) and not version.strip()):
        version = None
    elif isinstance(version, str) and len(version.strip()) <= MAX_VERSION and VERSION_RE.match(version.strip()):
        version = version.strip()
    else:
        fields["version"] = f"at most {MAX_VERSION} letters, digits or . _ + -"

    title_zh = _text(data.get("title_zh"))
    if not title_zh or len(title_zh) > MAX_TITLE:
        fields["title_zh"] = f"1–{MAX_TITLE} characters"
    raw_en = data.get("title_en")
    title_en = "" if raw_en is None else _text(raw_en)
    if title_en is None or len(title_en) > MAX_TITLE:
        fields["title_en"] = f"at most {MAX_TITLE} characters"

    clean: list[dict] = []
    items = data.get("items")
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_ITEMS:
        fields["items"] = f"1–{MAX_ITEMS} items"
    else:
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                fields[f"items.{i}"] = "must be an object"
                continue
            if set(item) - ITEM_KEYS:
                fields[f"items.{i}"] = "unknown key"  # the key itself is never echoed
            tag = item.get("tag")
            zh = _text(item.get("zh"))
            raw_item_en = item.get("en")
            en = "" if raw_item_en is None else _text(raw_item_en)
            if not isinstance(tag, str) or tag not in TAGS:
                fields[f"items.{i}.tag"] = "must be one of " + ", ".join(TAGS)
            if not zh or len(zh) > MAX_TEXT:
                fields[f"items.{i}.zh"] = f"1–{MAX_TEXT} characters"
            if en is None or len(en) > MAX_TEXT:
                fields[f"items.{i}.en"] = f"at most {MAX_TEXT} characters"
            clean.append({"tag": tag, "zh": zh, "en": en})
    if fields:
        raise ChangelogError(422, "Invalid changelog entry", fields)
    return {"entry_date": entry_date, "version": version, "title_zh": title_zh, "title_en": title_en, "items": clean}


def admin_out(row: ChangelogEntry) -> dict:
    return {"id": row.id, "status": "published" if row.published_at is not None else "draft",
            "entry_date": row.entry_date.isoformat(), "version": row.version, "title_zh": row.title_zh,
            "title_en": row.title_en, "items": row.items, "created_by": row.created_by,
            "created_at": iso_utc(row.created_at), "updated_at": iso_utc(row.updated_at),
            "published_at": iso_utc(row.published_at) if row.published_at is not None else None}


async def admin_listing(session) -> list[dict]:
    rows = (await session.scalars(select(ChangelogEntry).where(ChangelogEntry.archived_at.is_(None))
                                  .order_by(ChangelogEntry.entry_date.desc(), ChangelogEntry.id.desc()).limit(500))).all()
    return [admin_out(r) for r in rows]


async def _get(session, entry_id: int) -> ChangelogEntry:
    row = await session.get(ChangelogEntry, entry_id)
    if row is None or row.archived_at is not None:
        raise ChangelogError(404, "Not Found")
    return row


async def _record(session, actor: Actor, action: str, row: ChangelogEntry) -> None:
    # id and action only: no summary, before/after or reason (spec §3, plan R-10)
    await audit.record(session, actor, action, target_type="changelog", target_id=row.id)


async def create(session, actor: Actor, data: dict) -> ChangelogEntry:
    now = datetime.now(timezone.utc)
    row = ChangelogEntry(**validate(data), created_by=actor.name[:64], created_at=now, updated_at=now)
    session.add(row)
    await session.flush()
    await _record(session, actor, "changelog.create", row)
    return row


async def edit(session, actor: Actor, entry_id: int, data: dict) -> ChangelogEntry:
    row = await _get(session, entry_id)
    current = {"entry_date": row.entry_date.isoformat(), "version": row.version, "title_zh": row.title_zh,
               "title_en": row.title_en, "items": row.items}
    for key, value in validate({**current, **data}).items():
        setattr(row, key, value)
    row.updated_at = datetime.now(timezone.utc)
    await _record(session, actor, "changelog.update", row)
    return row


async def publish(session, actor: Actor, entry_id: int) -> ChangelogEntry:
    row = await _get(session, entry_id)
    if row.published_at is None:
        row.published_at = row.updated_at = datetime.now(timezone.utc)
        await _record(session, actor, "changelog.publish", row)
    return row


async def unpublish(session, actor: Actor, entry_id: int) -> ChangelogEntry:
    row = await _get(session, entry_id)
    if row.published_at is not None:
        row.published_at = None
        row.updated_at = datetime.now(timezone.utc)
        await _record(session, actor, "changelog.unpublish", row)
    return row


async def remove(session, actor: Actor, entry_id: int) -> ChangelogEntry:
    """Soft delete (`archived_at`): the import command never revives it (plan R-9, R-12)."""
    row = await _get(session, entry_id)
    row.archived_at = row.updated_at = datetime.now(timezone.utc)
    await _record(session, actor, "changelog.delete", row)
    return row
```

- [ ] **Step 4: 路由** — 创建 `server/app/routers/admin_changelog.py`:

```python
"""更新日志管理端(spec 2026-10-14-changelog-design §2.1、D6):`/api/admin/changelog`。读 = viewer,写 = operator(`perms.require`);
写操作与审计同一事务,审计只记条目 id 与动作。薄端点:逻辑在 `app/admin/changelog.py`。
新增路由要同时改 `tests/test_changelog_privacy.py` 里钉住的路由表。"""
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import changelog
from app.admin.changelog import ChangelogError
from app.admin.perms import AdminContext, require
from app.core.deps import get_session

router = APIRouter(prefix="/api/admin/changelog")


class EntryIn(BaseModel):
    """Loose on purpose: lengths, dates and tags are checked key by key in `changelog.validate` (R-8)."""
    model_config = ConfigDict(extra="forbid")
    entry_date: str | None = None
    version: str | None = None
    title_zh: str | None = None
    title_en: str | None = None
    items: list[dict[str, Any]] | None = None


def _error(e: ChangelogError) -> JSONResponse:
    payload: dict[str, Any] = {"error": e.message}
    if e.fields:
        payload["fields"] = e.fields
    return JSONResponse(payload, status_code=e.status)


@router.get("")
async def list_entries(_: AdminContext = Depends(require("viewer")), session: AsyncSession = Depends(get_session)):
    return {"entries": await changelog.admin_listing(session)}


@router.post("", status_code=201)
async def create_entry(body: EntryIn, ctx: AdminContext = Depends(require("operator")),
                       session: AsyncSession = Depends(get_session)):
    try:
        row = await changelog.create(session, ctx.actor, body.model_dump())
    except ChangelogError as e:
        return _error(e)
    await session.commit()
    return changelog.admin_out(row)


@router.patch("/{entry_id}")
async def edit_entry(entry_id: int, body: EntryIn, ctx: AdminContext = Depends(require("operator")),
                     session: AsyncSession = Depends(get_session)):
    try:
        row = await changelog.edit(session, ctx.actor, entry_id, body.model_dump(exclude_unset=True))
    except ChangelogError as e:
        return _error(e)
    await session.commit()
    return changelog.admin_out(row)


@router.post("/{entry_id}/publish")
async def publish_entry(entry_id: int, ctx: AdminContext = Depends(require("operator")),
                        session: AsyncSession = Depends(get_session)):
    try:
        row = await changelog.publish(session, ctx.actor, entry_id)
    except ChangelogError as e:
        return _error(e)
    await session.commit()
    return changelog.admin_out(row)


@router.post("/{entry_id}/unpublish")
async def unpublish_entry(entry_id: int, ctx: AdminContext = Depends(require("operator")),
                          session: AsyncSession = Depends(get_session)):
    try:
        row = await changelog.unpublish(session, ctx.actor, entry_id)
    except ChangelogError as e:
        return _error(e)
    await session.commit()
    return changelog.admin_out(row)


@router.delete("/{entry_id}")
async def delete_entry(entry_id: int, ctx: AdminContext = Depends(require("operator")),
                       session: AsyncSession = Depends(get_session)):
    try:
        row = await changelog.remove(session, ctx.actor, entry_id)
    except ChangelogError as e:
        return _error(e)
    await session.commit()
    return {"id": row.id, "deleted": True}
```

- [ ] **Step 5: 接线** — `server/app/main.py`(Edit,单行锚点):
  1. 导入元组:`admin, admin_accounts, admin_agents, admin_library, agents,` → `admin, admin_accounts, admin_agents, admin_changelog, admin_library, agents,`
  2. 路由顺序:`        stubs, admin_web, web,` → `        admin_changelog,  # /api/admin/changelog (plan 2026-10-14-changelog S3); before stubs\n        stubs, admin_web, web,`

- [ ] **Step 6: 跑测试,全绿。** `cd server && uv run pytest -q tests/test_admin_changelog.py tests/test_changelog_api.py tests/test_admin_routes_guarded.py tests/test_architecture.py`。

- [ ] **Step 7: 提交:**

```
feat(server): changelog admin API with audit

/api/admin/changelog: list (viewer), create / edit / publish / unpublish / soft delete (operator).
Strict key-by-key validation that never echoes the text; audit rows carry only the entry id and the action.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

### Task S4: 导入命令、镜像带上草稿、首批草稿

**Files:**
- Create: `server/app/admin/changelog_import.py`、`server/tests/test_changelog_import.py`
- Modify: `server/Dockerfile`、`server/Dockerfile.dockerignore`
- Commit(已写好,不改措辞):`docs/changelog/2026-10.json`

**Interfaces:**
- Produces(`app.admin.changelog_import`):`default_dir() -> Path | None`、`load_dir(directory: Path) -> list[tuple[str, int, dict]]`(`(文件名, 序号, 校验后的列值)`;任何问题抛 `DraftFileError`,`args[0]` 是消息列表)、`async run(argv: list[str]) -> int`(0 成功 / 1 找不到目录 / 2 校验失败,什么都没写)、`main()`;`_sessionmaker()` 与 `recover.py` 同法,测试里 monkeypatch。
- 命令:`python -m app.admin.changelog_import [--dir DIR] [--dry-run]`;容器里 `docker compose exec server python -m app.admin.changelog_import`(镜像里默认目录 `/app/changelog`)。

- [ ] **Step 1: 写失败测试** — 创建 `server/tests/test_changelog_import.py`:

```python
"""更新日志草稿导入命令(计划 2026-10-14-changelog S4;spec D5、§2.1):幂等、只建草稿、全有或全无、不打印标题。"""
import json
from pathlib import Path

import pytest
from sqlalchemy import select

from app.admin import changelog_import
from app.models import AdminAudit, ChangelogEntry
from tests.admin_helpers import ADMIN_ENABLED, login_as

MARK = "ZQMARKER-IMPORT"
REPO = Path(__file__).resolve().parents[2]
SERVER = Path(__file__).resolve().parents[1]
INTERNAL_WORDS = ("migration", "alembic", "worktree", "sqlite", "postgres", "docker", "localhost", "api key", "token",
                  "secret", "endpoint", "uvicorn")


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED}


def use_db(app, monkeypatch):
    monkeypatch.setattr(changelog_import, "_sessionmaker", lambda: app.state.sessionmaker)


def entry(day: str, title: str, *, text: str = "一句话", **over) -> dict:
    base = {"entry_date": day, "version": None, "title_zh": title, "title_en": f"{title} (en)",
            "items": [{"tag": "new", "zh": text, "en": "one sentence"}]}
    return {**base, **over}


def write(directory: Path, name: str, entries) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / name).write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")


async def rows(app) -> list[ChangelogEntry]:
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(ChangelogEntry).order_by(ChangelogEntry.id))).all())


async def test_import_creates_drafts_once_in_date_order(app, monkeypatch, tmp_path, capsys):
    use_db(app, monkeypatch)
    write(tmp_path, "a.json", [entry("2026-10-12", "B 标题"), entry("2026-10-11", "A 标题")])
    assert await changelog_import.run(["--dir", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "created 2, skipped 0"
    got = await rows(app)
    assert [(r.entry_date.isoformat(), r.title_zh) for r in got] == [("2026-10-11", "A 标题"), ("2026-10-12", "B 标题")]
    assert all(r.published_at is None and r.archived_at is None and r.created_by == "import" for r in got)
    assert got[0].items == [{"tag": "new", "zh": "一句话", "en": "one sentence"}] and got[0].version is None
    assert await changelog_import.run(["--dir", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "created 0, skipped 2"
    assert len(await rows(app)) == 2


async def test_a_published_edited_or_deleted_entry_is_never_touched_again(app, client, monkeypatch, tmp_path, capsys):
    use_db(app, monkeypatch)
    write(tmp_path, "a.json", [entry("2026-10-11", "A"), entry("2026-10-12", "B"), entry("2026-10-13", "C")])
    assert await changelog_import.run(["--dir", str(tmp_path)]) == 0
    a, b, c = [r.id for r in await rows(app)]
    h = await login_as(app, client, "operator")
    assert (await client.post(f"/api/admin/changelog/{a}/publish", headers=h)).status_code == 200
    assert (await client.delete(f"/api/admin/changelog/{b}", headers=h)).status_code == 200
    assert (await client.patch(f"/api/admin/changelog/{c}", headers=h, json={"title_en": "Edited"})).status_code == 200
    write(tmp_path, "a.json", [entry("2026-10-11", "A", text="改过的内容"), entry("2026-10-12", "B"),
                               entry("2026-10-13", "C", text="又改了")])
    capsys.readouterr()
    assert await changelog_import.run(["--dir", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "created 0, skipped 3"
    state = {r.id: r for r in await rows(app)}
    assert len(state) == 3
    assert state[a].published_at is not None and state[a].items[0]["zh"] == "一句话"  # still published, text untouched
    assert state[b].archived_at is not None  # a deleted draft is not revived
    assert state[c].title_en == "Edited" and state[c].items[0]["zh"] == "一句话"


async def test_a_renamed_title_is_a_new_draft(app, monkeypatch, tmp_path, capsys):
    use_db(app, monkeypatch)
    write(tmp_path, "a.json", [entry("2026-10-11", "旧标题")])
    await changelog_import.run(["--dir", str(tmp_path)])
    write(tmp_path, "a.json", [entry("2026-10-11", "新标题")])
    capsys.readouterr()
    assert await changelog_import.run(["--dir", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "created 1, skipped 0"
    assert sorted(r.title_zh for r in await rows(app)) == ["新标题", "旧标题"]


async def test_the_same_key_in_two_files_is_created_once(app, monkeypatch, tmp_path, capsys):
    use_db(app, monkeypatch)
    write(tmp_path, "a.json", [entry("2026-10-11", "A")])
    write(tmp_path, "b.json", [entry("2026-10-11", "A", text="另一个文件里的同一条")])
    assert await changelog_import.run(["--dir", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "created 1, skipped 1"
    assert len(await rows(app)) == 1


async def test_dry_run_writes_nothing(app, monkeypatch, tmp_path, capsys):
    use_db(app, monkeypatch)
    write(tmp_path, "a.json", [entry("2026-10-11", "A"), entry("2026-10-12", "B")])
    assert await changelog_import.run(["--dir", str(tmp_path), "--dry-run"]) == 0
    assert capsys.readouterr().out.strip() == "would create 2, skipped 0"
    assert await rows(app) == []


async def test_an_invalid_entry_stops_everything_and_prints_no_text(app, monkeypatch, tmp_path, capsys):
    use_db(app, monkeypatch)
    write(tmp_path, "a.json", [entry("2026-10-11", "OK")])
    write(tmp_path, "b.json", [entry("2026-10-12", "Bad", text=MARK * 100)])  # 1500 characters
    (tmp_path / "c.json").write_text("{not json " + MARK, encoding="utf-8")
    (tmp_path / "d.json").write_text(json.dumps({"oops": MARK}), encoding="utf-8")
    write(tmp_path, "e.json", [{**entry("2026-10-13", MARK), "surprise": 1}])
    assert await changelog_import.run(["--dir", str(tmp_path)]) == 2
    captured = capsys.readouterr()
    text = captured.out + captured.err
    assert MARK not in text
    for expected in ("b.json[0]", "c.json", "d.json", "e.json[0]", "nothing was imported"):
        assert expected in text
    assert await rows(app) == []  # all or nothing: the valid file was not imported either


async def test_a_missing_directory_exits_with_one(app, monkeypatch, tmp_path, capsys):
    use_db(app, monkeypatch)
    assert await changelog_import.run(["--dir", str(tmp_path / "nope")]) == 1
    assert "not found" in capsys.readouterr().err


async def test_an_empty_directory_imports_nothing(app, monkeypatch, tmp_path, capsys):
    use_db(app, monkeypatch)
    assert await changelog_import.run(["--dir", str(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "created 0, skipped 0"


async def test_the_import_is_audited_by_the_cli_with_ids_only(app, monkeypatch, tmp_path):
    use_db(app, monkeypatch)
    write(tmp_path, "a.json", [entry("2026-10-11", "A"), entry("2026-10-12", "B")])
    await changelog_import.run(["--dir", str(tmp_path)])
    async with app.state.sessionmaker() as s:
        audits = list((await s.scalars(select(AdminAudit).where(AdminAudit.action == "changelog.import")
                                       .order_by(AdminAudit.id))).all())
    ids = [str(r.id) for r in await rows(app)]
    assert [a.target_id for a in audits] == ids
    assert all((a.actor, a.target_type, a.summary, a.before, a.after) == ("cli", "changelog", "", None, None) for a in audits)


def test_the_default_directory_is_the_checkout_drafts_folder():
    assert changelog_import.default_dir() == REPO / "docs" / "changelog"


def test_the_repo_drafts_are_valid_and_in_plain_words():
    directory = changelog_import.default_dir()
    assert directory is not None
    drafts = changelog_import.load_dir(directory)
    assert len(drafts) >= 6
    keys = [(v["entry_date"], v["title_zh"]) for _file, _index, v in drafts]
    assert len(keys) == len(set(keys))
    assert all(len(v["items"]) <= 4 for _file, _index, v in drafts)  # the drafting rule in docs/CLAUDE.md
    assert all(v["title_en"] and all(i["en"] for i in v["items"]) for _file, _index, v in drafts)  # English users are not left on Chinese
    text = " ".join([v["title_zh"] + " " + v["title_en"] + " " + " ".join(i["zh"] + " " + i["en"] for i in v["items"])
                     for _file, _index, v in drafts]).lower()
    for word in INTERNAL_WORDS:
        assert word not in text, word


async def test_the_repo_drafts_import_into_an_empty_database_once(app, monkeypatch, capsys):
    use_db(app, monkeypatch)
    assert await changelog_import.run([]) == 0
    created = int(capsys.readouterr().out.split()[1].rstrip(","))
    assert created >= 6 and len(await rows(app)) == created
    assert await changelog_import.run([]) == 0
    assert capsys.readouterr().out.startswith("created 0,")
    assert len(await rows(app)) == created


def test_the_image_ships_the_drafts():
    assert "COPY docs/changelog /app/changelog" in (SERVER / "Dockerfile").read_text(encoding="utf-8").splitlines()
    assert "!docs/changelog" in (SERVER / "Dockerfile.dockerignore").read_text(encoding="utf-8").splitlines()
```

- [ ] **Step 2: 看它失败。** `cd server && uv run pytest -q tests/test_changelog_import.py` → 导入错误。

- [ ] **Step 3: 命令** — 创建 `server/app/admin/changelog_import.py`:

```python
"""导入更新日志草稿(spec 2026-10-14-changelog-design D5、§2.1;计划 R-12):

    python -m app.admin.changelog_import [--dir DIR] [--dry-run]
    docker compose exec server python -m app.admin.changelog_import

读取目录里的 `*.json`(每个文件是 `[{entry_date, version|null, title_zh, title_en, items:[{tag, zh, en}]}]`),按
`(entry_date, title_zh)` 幂等创建**草稿**:表里已有同一键的行(草稿、已发布、已被删除的都算)就跳过,不改内容、不改状态、不复活。
全有或全无:任何文件或条目校验失败,退出码 2、什么都不写,只打印「文件名[序号]: 字段名」。输出只有数量,不打印标题。
没有 `--dir` 时依次找 `<app 包上上级>/changelog`(镜像里是 /app/changelog)与 `<仓库根>/docs/changelog`。不放进迁移。
每条新草稿记一行审计 `changelog.import`(actor `cli`,只有条目 id)。本模块没有任何日志调用。
"""
import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.admin import audit, changelog
from app.core.config import Settings
from app.core.db import make_engine
from app.models import ChangelogEntry

IMPORT_NAME = "import"  # created_by of imported drafts
ALLOWED_KEYS = {"entry_date", "version", "title_zh", "title_en", "items"}
HERE = Path(__file__).resolve()
_ENGINES: list = []  # engines this CLI created (disposed by main(); tests patch _sessionmaker instead)


class DraftFileError(Exception):
    """`args[0]` = the list of problems, each `file[index]: …` (never contains entry text)."""


def candidate_dirs() -> list[Path]:
    return [HERE.parents[2] / "changelog", HERE.parents[3] / "docs" / "changelog"]


def default_dir() -> Path | None:
    return next((p for p in candidate_dirs() if p.is_dir()), None)


def _sessionmaker():
    engine = make_engine(Settings().database_url)
    _ENGINES.append(engine)
    return async_sessionmaker(engine, expire_on_commit=False)


def load_dir(directory: Path) -> list[tuple[str, int, dict]]:
    problems: list[str] = []
    found: list[tuple[str, int, dict]] = []
    for path in sorted(directory.glob("*.json")):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            problems.append(f"{path.name}: not readable JSON")
            continue
        if not isinstance(raw, list):
            problems.append(f"{path.name}: must be a JSON array")
            continue
        for index, item in enumerate(raw):
            if not isinstance(item, dict) or set(item) - ALLOWED_KEYS:
                problems.append(f"{path.name}[{index}]: unexpected shape")
                continue
            try:
                found.append((path.name, index, changelog.validate(item)))
            except changelog.ChangelogError as exc:
                problems.append(f"{path.name}[{index}]: invalid {', '.join(sorted(exc.fields or {}))}")
    if problems:
        raise DraftFileError(problems)
    return found


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.admin.changelog_import",
                                     description="Import changelog drafts from JSON files (idempotent, drafts only).")
    parser.add_argument("--dir", help="folder with the *.json drafts (default: /app/changelog in the image, docs/changelog in a checkout)")
    parser.add_argument("--dry-run", action="store_true", help="count what would be created and write nothing")
    return parser


async def run(argv: list[str]) -> int:
    args = _parser().parse_args(argv)
    directory = Path(args.dir) if args.dir else default_dir()
    if directory is None or not directory.is_dir():
        print("changelog folder not found (use --dir)", file=sys.stderr)
        return 1
    try:
        drafts = load_dir(directory)
    except DraftFileError as exc:
        for line in exc.args[0]:
            print(line, file=sys.stderr)
        print("nothing was imported", file=sys.stderr)
        return 2
    drafts.sort(key=lambda d: (d[2]["entry_date"], d[0], d[1]))  # ids then follow the date order (plan R-6)
    created = skipped = 0
    now = datetime.now(timezone.utc)
    async with _sessionmaker()() as s:
        known = {(day, title) for day, title in (await s.execute(select(ChangelogEntry.entry_date, ChangelogEntry.title_zh))).all()}
        for _file, _index, values in drafts:
            key = (values["entry_date"], values["title_zh"])
            if key in known:
                skipped += 1
                continue
            known.add(key)
            created += 1
            if args.dry_run:
                continue
            row = ChangelogEntry(**values, created_by=IMPORT_NAME, created_at=now, updated_at=now)
            s.add(row)
            await s.flush()
            await audit.record(s, audit.CLI_ACTOR, "changelog.import", target_type="changelog", target_id=row.id)
        await s.commit()
    print(f"{'would create' if args.dry_run else 'created'} {created}, skipped {skipped}")
    return 0


async def _main(argv: list[str]) -> int:
    try:
        return await run(argv)
    finally:
        for engine in _ENGINES:
            await engine.dispose()
        _ENGINES.clear()


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(_main(sys.argv[1:] if argv is None else argv))


if __name__ == "__main__":
    raise SystemExit(main())
```

注意:`test_the_repo_drafts_import_into_an_empty_database_once` 里解析 `created N,` 的第二个词(`"created 8, skipped 0".split()[1]` = `"8,"`,代码里 `.rstrip(",")` 已处理)。

- [ ] **Step 4: 镜像带上草稿** — Edit(单行锚点):
  - `server/Dockerfile`:`COPY server/dictionaries /app/dictionaries` → 同一行 + 下一行 `COPY docs/changelog /app/changelog`
  - `server/Dockerfile.dockerignore`:`!server/dictionaries` → 同一行 + 下一行 `!docs/changelog`

- [ ] **Step 5: 跑测试,全绿。** `cd server && uv run pytest -q tests/test_changelog_import.py tests/test_architecture.py tests/test_library_image.py`(`test_library_image.py` 读同一个 Dockerfile,确认没被改坏)。若 `test_the_repo_drafts_are_valid_and_in_plain_words` 因为措辞命中 `INTERNAL_WORDS` 失败:**先看是不是误报**(比如 `token` 出现在合理的词里),是真的内部词才停下报告;不要删词表来过测试。

- [ ] **Step 6: 提交**(`git add server/app/admin/changelog_import.py server/tests/test_changelog_import.py server/Dockerfile server/Dockerfile.dockerignore docs/changelog/2026-10.json`):

```
feat(server): changelog draft import command and the first batch

python -m app.admin.changelog_import creates drafts from docs/changelog/*.json,
keyed by (entry_date, title_zh): published, edited and deleted entries are never
touched again; all or nothing; prints counts only. The image ships the folder.
First batch: eight drafts for 2026-10-11 .. 2026-10-14.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

### Task S5: 契约夹具、隐私扫描、路由表

**Files:**
- Create: `server/tests/test_changelog_contract.py`、`server/tests/fixtures/changelog_contract.json`(录制)、`server/tests/test_changelog_privacy.py`

- [ ] **Step 1: 契约测试** — 创建 `server/tests/test_changelog_contract.py`:

```python
"""GET /api/changelog、POST /api/changelog/seen 与管理端条目的载荷形状(spec 2026-10-14-changelog §2.1,计划 S5)。

网页 web/src/features/changelog/changelog-contract.test.ts 与管理端 admin/src/features/changelog/api.test.ts 逐键读同一个夹具。
重录:`CONTRACT_UPDATE=1 uv run pytest -q tests/test_changelog_contract.py`
(PowerShell:`$env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_changelog_contract.py; Remove-Item Env:CONTRACT_UPDATE`)。
时间戳固定成 STAMP,重录只会出现真实的形状改动。"""
import json
import os
from pathlib import Path

import pytest

from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.test_web_contract import shape

FIXTURE = Path(__file__).parent / "fixtures" / "changelog_contract.json"
URL = "/api/admin/changelog"
STAMP = "2026-10-14T00:00:00+00:00"
TIME_KEYS = ("published_at", "created_at", "updated_at")
KEYS = {"admin_entry", "admin_list", "empty", "list", "probe", "seen"}
ENTRY_KEYS = {"id", "entry_date", "version", "title_zh", "title_en", "items", "published_at", "is_new"}
ADMIN_KEYS = {"id", "status", "entry_date", "version", "title_zh", "title_en", "items", "created_by", "created_at",
              "updated_at", "published_at"}


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED}


def stable(entry: dict) -> dict:
    return {k: (STAMP if k in TIME_KEYS and v else v) for k, v in entry.items()}


def stable_page(page: dict) -> dict:
    return {**page, "entries": [stable(e) for e in page["entries"]]}


async def test_changelog_payloads_match_the_web_and_admin_contract(app, client, auth_headers):
    admin = await login_as(app, client, "operator")
    empty = (await client.get("/api/changelog", headers=auth_headers)).json()
    ids = []
    for day, version, title in (("2026-10-13", None, "第一条"), ("2026-10-14", "v1.12", "第二条")):
        created = await client.post(URL, headers=admin, json={
            "entry_date": day, "version": version, "title_zh": title, "title_en": f"{title} (en)",
            "items": [{"tag": "new", "zh": "新功能一句话", "en": "A new thing"}, {"tag": "library", "zh": "跟读库一句话", "en": ""}]})
        assert created.status_code == 201, created.text
        ids.append(created.json()["id"])
        assert (await client.post(f"{URL}/{ids[-1]}/publish", headers=admin)).status_code == 200
    listing = (await client.get("/api/changelog", headers=auth_headers)).json()
    probe = (await client.get("/api/changelog", headers=auth_headers, params={"limit": 1})).json()
    seen = (await client.post("/api/changelog/seen", headers=auth_headers, json={"upto_id": ids[-1]})).json()
    admin_list = (await client.get(URL)).json()
    actual = {
        "empty": empty, "list": stable_page(listing), "probe": stable_page(probe), "seen": seen,
        "admin_list": {"entries": [stable(e) for e in admin_list["entries"]]}, "admin_entry": stable(admin_list["entries"][0]),
    }
    assert set(actual) == KEYS
    if os.environ.get("CONTRACT_UPDATE"):
        FIXTURE.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert shape(actual) == shape(expected)
    # shape() only looks at the first list element and treats every leaf alike: pin the rest by hand
    assert expected["empty"] == {"entries": [], "next": None, "unread": 0, "latest_id": None}
    assert set(expected["list"]) == {"entries", "next", "unread", "latest_id"}
    assert len(expected["list"]["entries"]) == 2 and expected["list"]["next"] is None and expected["list"]["unread"] == 2
    for e in expected["list"]["entries"]:
        assert set(e) == ENTRY_KEYS and isinstance(e["is_new"], bool) and e["published_at"] == STAMP
        assert set(e["items"][0]) == {"tag", "zh", "en"}
    assert {e["version"] for e in expected["list"]["entries"]} == {None, "v1.12"}  # both wire forms of `version`
    assert [e["entry_date"] for e in expected["list"]["entries"]] == ["2026-10-14", "2026-10-13"]  # newest date first
    assert len(expected["probe"]["entries"]) == 1 and expected["probe"]["next"] is not None
    assert expected["seen"] == {"unread": 0, "last_seen_id": 2}
    assert {e["status"] for e in expected["admin_list"]["entries"]} == {"published"}
    assert set(expected["admin_entry"]) == ADMIN_KEYS and expected["admin_entry"]["created_at"] == STAMP
    raw = FIXTURE.read_text(encoding="utf-8")
    assert "access_token" not in raw and "csrf" not in raw.lower() and "password" not in raw.lower()
```

- [ ] **Step 2: 录制夹具** — `cd server`:PowerShell `$env:CONTRACT_UPDATE=1; uv run pytest -q tests/test_changelog_contract.py; Remove-Item Env:CONTRACT_UPDATE`(bash:`CONTRACT_UPDATE=1 uv run pytest -q tests/test_changelog_contract.py`)。再不带环境变量跑一次确认绿;目视检查 `tests/fixtures/changelog_contract.json`:六个键、`empty` 是 `{entries: [], next: null, unread: 0, latest_id: null}`、时间戳都是 `2026-10-14T00:00:00+00:00`、没有任何密钥。

- [ ] **Step 3: 隐私与路由表** — 创建 `server/tests/test_changelog_privacy.py`:

```python
"""更新日志的隐私与路由表(计划 2026-10-14-changelog S5;spec §3):日志、错误体、审计、命令输出与 URL 里都没有条目文字。"""
import json
import logging
from pathlib import Path

import pytest
from sqlalchemy import select

from app.admin import changelog_import
from app.main import create_app
from app.models import AdminAudit
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.conftest import make_settings
from tests.test_admin_routes_guarded import api_routes

MARK = "ZQMARKER-PRIVACY"
URL = "/api/admin/changelog"
APP_DIR = Path(__file__).resolve().parents[1] / "app"
MODULES = ("admin/changelog.py", "admin/changelog_import.py", "routers/changelog.py", "routers/admin_changelog.py")
PUBLIC_ROUTES = {("GET", "/api/changelog"), ("POST", "/api/changelog/seen")}
ADMIN_ROUTES = {("GET", "/api/admin/changelog"), ("POST", "/api/admin/changelog"),
                ("PATCH", "/api/admin/changelog/{entry_id}"), ("POST", "/api/admin/changelog/{entry_id}/publish"),
                ("POST", "/api/admin/changelog/{entry_id}/unpublish"), ("DELETE", "/api/admin/changelog/{entry_id}")}


@pytest.fixture
def settings_overrides():
    return {**ADMIN_ENABLED}


def test_the_route_table_is_pinned_and_urls_carry_only_ids_and_paging():
    """A new changelog route must be added here on purpose (and keep text out of its URL)."""
    found = {}
    for path, route in api_routes(create_app(make_settings()).routes):
        if path.startswith(("/api/changelog", "/api/admin/changelog")):
            for method in route.methods - {"HEAD"}:
                found[(method, path)] = route
    assert set(found) == PUBLIC_ROUTES | ADMIN_ROUTES
    for route in found.values():
        assert {p.name for p in route.dependant.path_params} <= {"entry_id"}
        assert {q.name for q in route.dependant.query_params} <= {"cursor", "limit"}


def test_the_changelog_modules_have_no_logging_or_printing_of_their_own():
    for rel in MODULES:
        source = (APP_DIR / rel).read_text(encoding="utf-8")
        assert "logging" not in source and "logger" not in source, rel
        if rel != "admin/changelog_import.py":  # the command prints counts and file names only
            assert "print(" not in source, rel


def write(directory: Path, name: str, entries) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / name).write_text(json.dumps(entries, ensure_ascii=False), encoding="utf-8")


async def test_no_entry_text_reaches_logs_errors_audit_or_command_output(app, client, auth_headers, caplog, monkeypatch,
                                                                         tmp_path, capsys):
    # scoped to logger "app" like the other privacy tests: aiosqlite's own DEBUG records print SQL parameters
    # (a site-wide fact at LOG_LEVEL=DEBUG; the default is INFO), which is not this feature's logging
    caplog.set_level(logging.DEBUG, logger="app")
    monkeypatch.setattr(changelog_import, "_sessionmaker", lambda: app.state.sessionmaker)
    admin = await login_as(app, client, "operator")
    good = {"entry_date": "2026-10-14", "version": None, "title_zh": f"{MARK} 标题", "title_en": f"{MARK} title",
            "items": [{"tag": "new", "zh": f"{MARK} 中文", "en": f"{MARK} english"}]}
    created = await client.post(URL, headers=admin, json=good)
    assert created.status_code == 201
    eid = created.json()["id"]
    too_long = {**good, "items": [{"tag": "new", "zh": MARK * 40, "en": ""}]}
    for call in (client.post(URL, headers=admin, json=too_long), client.patch(f"{URL}/{eid}", headers=admin, json=too_long)):
        r = await call
        assert r.status_code == 422 and MARK not in r.text
    assert (await client.patch(f"{URL}/{eid}", headers=admin, json={"title_en": f"{MARK} edited"})).status_code == 200
    await client.post(f"{URL}/{eid}/publish", headers=admin)
    served = await client.get("/api/changelog", headers=auth_headers)
    assert MARK in served.text  # the published content itself is served ...
    await client.post("/api/changelog/seen", headers=auth_headers, json={"upto_id": eid})
    await client.get("/api/changelog", headers=auth_headers, params={"cursor": "2026-10-14.1", "limit": 5})
    await client.get("/api/changelog", headers=auth_headers, params={"cursor": "bad"})
    await client.post(f"{URL}/{eid}/unpublish", headers=admin)
    await client.post(f"{URL}/{eid}/publish", headers=admin)
    await client.delete(f"{URL}/{eid}", headers=admin)
    write(tmp_path / "ok", "a.json", [{**good, "entry_date": "2026-10-15", "title_zh": f"{MARK} 另一条"}])
    write(tmp_path / "bad", "a.json", [{**good, "items": [{"tag": "new", "zh": MARK * 40, "en": ""}]}])
    assert await changelog_import.run(["--dir", str(tmp_path / "ok")]) == 0
    assert await changelog_import.run(["--dir", str(tmp_path / "ok")]) == 0
    assert await changelog_import.run(["--dir", str(tmp_path / "bad")]) == 2
    captured = capsys.readouterr()
    assert MARK not in captured.out + captured.err  # ... but never logged, audited or printed
    assert MARK not in caplog.text
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(AdminAudit).where(AdminAudit.action.like("changelog.%")))).all()
    assert len(rows) >= 7
    dumped = json.dumps([[a.action, a.target_type, a.target_id, a.summary, a.before, a.after, a.reason] for a in rows], default=str)
    assert MARK not in dumped
```

- [ ] **Step 4: 跑本任务的测试,全绿。** `cd server && uv run pytest -q tests/test_changelog_contract.py tests/test_changelog_privacy.py tests/test_changelog_api.py tests/test_admin_changelog.py tests/test_changelog_import.py tests/test_changelog_models.py tests/test_admin_routes_guarded.py tests/test_architecture.py`。

- [ ] **Step 5: 提交**(`git add server/tests/test_changelog_contract.py server/tests/fixtures/changelog_contract.json server/tests/test_changelog_privacy.py`):

```
test(server): changelog contract fixture, privacy scan and route table

The fixture pins the user and admin payloads for the web and admin tests; the privacy test
scans logs, error bodies, audit rows and command output for entry text and pins the route table.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

## 网页任务组(W)

### Task W1: 扩展点 `practiceHeaderActions` 与练习页接线

**Files:**
- Modify: `web/src/lib/extension-points.ts`、`web/src/lib/extension-points.test.tsx`、`web/src/plugins/links-matrix.test.tsx`、`web/src/features/practice/practice-page.tsx`、`web/src/features/practice/practice-page.test.tsx`

**Interfaces:**
- Produces(`~/lib/extension-points`):`PointProps.practiceHeaderActions: Empty`、`POINT_NAMES` 末项 `"practiceHeaderActions"`。`PracticePage` 的顶栏 `actions` = 该点的插槽 + 原来的「练习清单」链接。

- [ ] **Step 1: 改测试(先红)。**
  - `web/src/lib/extension-points.test.tsx`:Edit 单行:`      "wordDetailSections", "notebookViews", "meRows", "appEffects", "selectionActions"]);` → `      "wordDetailSections", "notebookViews", "meRows", "appEffects", "selectionActions", "practiceHeaderActions"]);`
  - `web/src/plugins/links-matrix.test.tsx`:Edit 单行:`    expect(ids("selectionActions")).toEqual(["chat.read-aloud"]);` → 同一行 + 下一行 `    expect(ids("practiceHeaderActions")).toEqual([]); // W3 登记核心贡献 changelog.entry 后改成 ["changelog.entry"]`
  - `web/src/features/practice/practice-page.test.tsx`:在 import 区加 `import { contribute } from "~/lib/extension-points";`(锚点:`import { renderWithProviders } from "~/test/render";` 之后一行);把下面的新用例**插在**单行 `  it("links to the progress page", () => {` 之前(该行本身保留):

```tsx
  it("renders contributions of the practiceHeaderActions point left of the practice list link", () => {
    contribute({ point: "practiceHeaderActions", id: "test.header", component: () => <button type="button" data-testid="test-header">x</button> });
    setup({});
    const mine = screen.getByTestId("test-header");
    const list = screen.getByTestId("practice-list");
    expect(mine.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
```

  `cd web && yarn vitest run src/lib/extension-points.test.tsx src/plugins/links-matrix.test.tsx src/features/practice/practice-page.test.tsx src/architecture.test.ts` → 红(点不存在 / 没有渲染)。

- [ ] **Step 2: 实现。**
  - `web/src/lib/extension-points.ts`(Edit 单行锚点):
    - `  selectionActions: { text: string; testId: string };` → 同一行 + 下面两行:
      ```ts
        /** 练习页顶栏右侧的图标按钮(计划 2026-10-14-changelog R-2):排在「练习清单」图标之前;核心贡献 `changelog.entry`(更新日志入口)。 */
        practiceHeaderActions: Empty;
      ```
    - `  "learningSources", "wordDetailSections", "notebookViews", "meRows", "appEffects", "selectionActions"];` → `  "learningSources", "wordDetailSections", "notebookViews", "meRows", "appEffects", "selectionActions", "practiceHeaderActions"];`
  - `web/src/features/practice/practice-page.tsx`:把 `PageHeader` 的 `actions` 改成(用单行锚点三处,或 Read 后整块替换;`Slot` 已在文件里导入):
    ```tsx
            actions={
              <>
                <Slot point="practiceHeaderActions" props={{}} />
                <Link to="/practice/list" data-testid="practice-list" aria-label={t("web.practice.list.title")} className={ICON_LINK}>
                  <ListChecksIcon aria-hidden />
                </Link>
              </>
            }
    ```
    (单行锚点法:`        actions={` → `        actions={\n          <>\n            <Slot point="practiceHeaderActions" props={{}} />`;`          </Link>` → `          </Link>\n          </>`。)

- [ ] **Step 3: 跑测试,全绿。** 同 Step 1 的命令。(`architecture.test.ts` 的「每个扩展点都被产品代码以 `point="…"` 渲染」现在靠 practice-page 里的 `point="practiceHeaderActions"` 通过;「每个 `contribute` 的点名真实存在」仍通过。)

- [ ] **Step 4: 提交**(`git add` 上面 5 个文件):

```
feat(web): practiceHeaderActions extension point on the practice header

The practice header renders a slot left of the practice-list link, so a feature can add a header
button without a new cross-feature import. No contribution yet.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

### Task W2: 接口客户端、纯函数、懒加载文案、样式、契约测试

**Files:**(全部新建,在 `web/src/features/changelog/`)
`api.ts`、`api.test.ts`、`changelog-contract.test.ts`、`entries.ts`、`entries.test.ts`、`locales.ts`、`locales/en.json`、`locales/zh-CN.json`、`locales.test.ts`、`changelog.css`、`changelog-css.test.ts`

**Interfaces:**
- Produces(`./api`):`TAGS`、`ChangelogTag`、`ChangelogItem`、`ChangelogEntry`、`ChangelogPage`、`SeenResult`、`parseChangelogPage(raw)`、`fetchChangelog(api, { cursor?, limit?, signal? })`、`postSeen(api, uptoId, signal?)`。
- Produces(`./entries`):`TagFilter`、`MonthGroup`、`COLLAPSED_ITEMS = 2`、`groupByMonth`、`presentTags`、`filterByTag`、`collapsedItems`、`formatMonth`、`formatDay`、`versionLabel`。
- Produces(`./locales`):`ensureChangelogI18n()`(求值时自动调用);键 `web.changelog.*`(见 JSON)。

- [ ] **Step 1: 写失败测试。**

`api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { fetchChangelog, parseChangelogPage, postSeen } from "./api";

const wire = {
  entries: [{
    id: 3, entry_date: "2026-10-14", version: "v1.12", title_zh: "标题", title_en: "", published_at: "2026-10-14T00:00:00+00:00", is_new: true,
    items: [{ tag: "new", zh: "一", en: "one" }, { tag: "weird", zh: "二", en: "" }],
  }],
  next: "2026-10-14.3", unread: 2, latest_id: 3,
};
const client = (routes: Parameters<typeof createFetchMock>[0]) => {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
};

describe("changelog api", () => {
  it("fetches a page with the cursor and limit in the query and parses the camelCased wire shape", async () => {
    const { mock, api } = client({ "GET /api/changelog": () => json(wire) });
    const page = await fetchChangelog(api, { cursor: "2026-10-15.9", limit: 5 });
    expect(mock.calls[0].url.search).toBe("?cursor=2026-10-15.9&limit=5");
    expect(page).toEqual({
      entries: [{
        id: 3, entryDate: "2026-10-14", version: "v1.12", titleZh: "标题", titleEn: "", publishedAt: "2026-10-14T00:00:00+00:00", isNew: true,
        items: [{ tag: "new", zh: "一", en: "one" }, { tag: "other", zh: "二", en: "" }], // an unknown tag shows as "other"
      }],
      next: "2026-10-14.3", unread: 2, latestId: 3,
    });
  });

  it("sends no query when none is given", async () => {
    const { mock, api } = client({ "GET /api/changelog": () => json({ entries: [], next: null, unread: 0, latest_id: null }) });
    expect(await fetchChangelog(api)).toEqual({ entries: [], next: null, unread: 0, latestId: null });
    expect(mock.calls[0].url.search).toBe("");
  });

  it("posts upto_id and parses the answer", async () => {
    const { mock, api } = client({ "POST /api/changelog/seen": () => json({ unread: 0, last_seen_id: 3 }) });
    expect(await postSeen(api, 3)).toEqual({ unread: 0, lastSeenId: 3 });
    expect(JSON.parse(String(mock.calls[0].body))).toEqual({ upto_id: 3 });
  });

  it("survives a malformed page: bad entries are dropped, numbers default", () => {
    expect(parseChangelogPage(null)).toEqual({ entries: [], next: null, unread: 0, latestId: null });
    const page = parseChangelogPage({
      entries: [null, { id: "x" }, { id: 1, entryDate: "2026-10-01", items: [] }, { id: 2, entryDate: "2026-10-02", items: [{ tag: "fix", zh: "", en: "" }, { tag: "fix", zh: "修", en: "" }] }],
      next: "", unread: -4, latestId: "9",
    });
    expect(page.entries.map((e) => e.id)).toEqual([2]);
    expect(page.entries[0].items).toEqual([{ tag: "fix", zh: "修", en: "" }]);
    expect(page.entries[0]).toMatchObject({ titleZh: "", titleEn: "", version: null, publishedAt: "", isNew: false });
    expect(page).toMatchObject({ next: null, unread: 0, latestId: null });
  });
});
```

`changelog-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import { parseChangelogPage } from "./api";

/** 契约(计划 R-13):`server/tests/fixtures/changelog_contract.json` 由 `test_changelog_contract.py` 录制,这里逐键核对网页解析。 */
const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(path.resolve(here, "../../../../server/tests/fixtures/changelog_contract.json"), "utf8")) as Record<string, Record<string, unknown>>;
const cc = (v: unknown) => camelcaseKeys(v as Record<string, unknown>, { deep: true });
const keys = (o: object) => Object.keys(o).sort();

describe("changelog contract", () => {
  it("has the six recorded answers", () => {
    expect(keys(contract)).toEqual(["admin_entry", "admin_list", "empty", "list", "probe", "seen"]);
  });
  it("an empty log is exactly four keys and parses to nothing", () => {
    expect(keys(contract.empty)).toEqual(["entries", "latest_id", "next", "unread"]);
    expect(parseChangelogPage(cc(contract.empty))).toEqual({ entries: [], next: null, unread: 0, latestId: null });
  });
  it("a page parses with every wire key accounted for", () => {
    expect(keys(contract.list)).toEqual(["entries", "latest_id", "next", "unread"]);
    const entries = contract.list.entries as Record<string, unknown>[];
    expect(keys(entries[0])).toEqual(["entry_date", "id", "is_new", "items", "published_at", "title_en", "title_zh", "version"]);
    const page = parseChangelogPage(cc(contract.list));
    expect(page.entries).toHaveLength(2);
    expect(page.unread).toBe(2);
    expect(page.latestId).toBe(2);
    expect(page.next).toBeNull();
    expect(page.entries[0]).toMatchObject({ entryDate: "2026-10-14", version: "v1.12", isNew: true });
    expect(page.entries[1].version).toBeNull();
    expect(page.entries[0].items.map((i) => i.tag)).toEqual(["new", "library"]);
  });
  it("the limit=1 probe carries a cursor for the rest", () => {
    const page = parseChangelogPage(cc(contract.probe));
    expect(page.entries).toHaveLength(1);
    expect(page.next).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
  it("seen answers with unread and lastSeenId", () => {
    expect(keys(contract.seen)).toEqual(["last_seen_id", "unread"]);
    expect(cc(contract.seen)).toEqual({ unread: 0, lastSeenId: 2 });
  });
});
```

`entries.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ChangelogEntry, ChangelogTag } from "./api";
import { collapsedItems, filterByTag, formatDay, formatMonth, groupByMonth, presentTags, versionLabel } from "./entries";

const entry = (id: number, entryDate: string, tags: ChangelogTag[]): ChangelogEntry => ({
  id, entryDate, version: null, titleZh: `标题${id}`, titleEn: "", publishedAt: "", isNew: false,
  items: tags.map((tag, i) => ({ tag, zh: `条目${id}-${i}`, en: "" })),
});

describe("changelog helpers", () => {
  it("groups consecutive entries by month and keeps the order", () => {
    const groups = groupByMonth([entry(4, "2026-10-14", ["new"]), entry(3, "2026-10-02", ["fix"]), entry(2, "2026-09-28", ["new"]), entry(1, "2026-09-01", ["new"])]);
    expect(groups.map((g) => [g.key, g.entries.map((e) => e.id)])).toEqual([["2026-10", [4, 3]], ["2026-09", [2, 1]]]);
    expect(groupByMonth([])).toEqual([]);
  });

  it("lists the present tags in the canonical order", () => {
    expect(presentTags([entry(1, "2026-10-01", ["fix", "new"]), entry(2, "2026-10-02", ["library", "fix"])])).toEqual(["new", "fix", "library"]);
    expect(presentTags([])).toEqual([]);
  });

  it("filters the items of each entry and drops entries without a match", () => {
    const entries = [entry(1, "2026-10-01", ["new", "fix"]), entry(2, "2026-10-02", ["improve"]), entry(3, "2026-10-03", ["fix", "fix"])];
    expect(filterByTag(entries, "all")).toBe(entries);
    const fixes = filterByTag(entries, "fix");
    expect(fixes.map((e) => [e.id, e.items.length])).toEqual([[1, 1], [3, 2]]);
    expect(filterByTag(entries, "library")).toEqual([]);
    expect(entries[0].items).toHaveLength(2); // the input is not mutated
  });

  it("collapses to the first two items unless expanded", () => {
    expect(collapsedItems([1, 2, 3], false)).toEqual([1, 2]);
    expect(collapsedItems([1, 2, 3], true)).toEqual([1, 2, 3]);
    expect(collapsedItems([1, 2], false)).toEqual([1, 2]);
    expect(collapsedItems([], false)).toEqual([]);
  });

  it("formats months and days in the UI language without a time zone shift", () => {
    expect(formatMonth("2026-10", "en")).toBe("October 2026");
    expect(formatMonth("2026-10", "zh-CN")).toBe("2026年10月");
    expect(formatDay("2026-10-14", "en")).toBe("October 14");
    expect(formatDay("2026-10-14", "zh-CN")).toBe("10月14日");
    expect(formatDay("garbage", "en")).toBe("garbage");
    expect(formatMonth("2026-10", "not a language")).toBe("2026-10");
  });

  it("labels versions", () => {
    expect(versionLabel(null)).toBeNull();
    expect(versionLabel("  ")).toBeNull();
    expect(versionLabel("1.12")).toBe("v1.12");
    expect(versionLabel("v1.12")).toBe("v1.12");
    expect(versionLabel("beta-2")).toBe("beta-2");
  });
});
```

`locales.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { ensureChangelogI18n } from "./locales";
import { TAGS } from "./api";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

type Dict = Record<string, unknown>;
const flatten = (d: unknown, prefix = ""): Record<string, string> =>
  d && typeof d === "object"
    ? Object.entries(d as Dict).reduce<Record<string, string>>((acc, [k, v]) => ({ ...acc, ...flatten(v, prefix ? `${prefix}.${k}` : k) }), {})
    : { [prefix]: String(d) };
const placeholders = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
const a = flatten(en);
const b = flatten(zh);

describe("changelog locales (R-16: lazy, outside the eager i18n glob)", () => {
  it("has the same keys and placeholders in en and zh-CN, all under web.changelog, no emoji", () => {
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(Object.keys(a).every((k) => k.startsWith("web.changelog."))).toBe(true);
    for (const k of Object.keys(a)) expect(placeholders(a[k]), k).toEqual(placeholders(b[k]));
    for (const [k, v] of [...Object.entries(a), ...Object.entries(b)]) {
      expect(v.trim(), k).not.toBe("");
      expect(v, k).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("names every tag", () => {
    for (const tag of TAGS) expect(a).toHaveProperty([`web.changelog.tag.${tag}`]);
  });

  it("merges into i18next once loaded, pluralises English counts and keeps other keys", () => {
    ensureChangelogI18n();
    expect(i18n.getFixedT("en")("web.changelog.hint", { count: 1 })).toBe("1 new update");
    expect(i18n.getFixedT("en")("web.changelog.hint", { count: 3 })).toBe("3 new updates");
    expect(i18n.getFixedT("zh-CN")("web.changelog.hint", { count: 3 })).toBe("有 3 条新更新");
    expect(i18n.getFixedT("en")("web.changelog.entryUnread", { count: 2 })).toBe("What's new, 2 unread updates");
    expect(i18n.getFixedT("zh-CN")("web.changelog.title")).toBe("更新日志");
    expect(i18n.getFixedT("en")("web.nav.practice")).toBe("Practice");
  });
});
```

`changelog-css.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "changelog.css"), "utf8");

describe("changelog.css", () => {
  it("animates the ring with transform and opacity only and stops it under reduced motion", () => {
    expect(css).toContain("@keyframes cl-pop");
    const keyframes = css.slice(css.indexOf("@keyframes cl-pop"), css.indexOf("}", css.indexOf("100%")) + 1);
    expect(keyframes).toMatch(/transform:\s*scale\(/);
    expect(keyframes).not.toMatch(/(width|height|top|left|margin)\s*:/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.cl-ring\s*\{\s*animation:\s*none/);
  });

  it("colours the library tag in light and dark from the mockup, and adds no blur layer", () => {
    expect(css).toMatch(/\.cl-tag-library\s*\{[^}]*#efe9ff[^}]*#6a3df0/i);
    expect(css).toMatch(/\.dark \.cl-tag-library\s*\{[^}]*rgba\(183, 156, 255, 0\.16\)[^}]*#b79cff/i);
    expect(css).not.toContain("backdrop-filter");
  });

  it("has the hint bubble with its arrow", () => {
    expect(css).toMatch(/\.cl-hint\s*\{/);
    expect(css).toMatch(/\.cl-hint::after\s*\{/);
  });
});
```

- [ ] **Step 2: 看它失败。** `cd web && yarn vitest run src/features/changelog` → 模块不存在。(契约测试还要求 S5 的夹具已存在。)

- [ ] **Step 3: 实现。**

`api.ts`:

```ts
import type { ApiClient } from "~/api/client";

/**
 * 更新日志接口(spec 2026-10-14-changelog §2.1;形状见 server/tests/fixtures/changelog_contract.json)。
 * ApiClient 已把响应键转成 camelCase。解析是防御性的:形状不对的条目丢掉,未知类型按 "other" 显示。
 */
export const TAGS = ["new", "improve", "fix", "library", "other"] as const;
export type ChangelogTag = (typeof TAGS)[number];
export interface ChangelogItem { tag: ChangelogTag; zh: string; en: string }
export interface ChangelogEntry {
  id: number;
  entryDate: string;
  version: string | null;
  titleZh: string;
  titleEn: string;
  items: ChangelogItem[];
  publishedAt: string;
  isNew: boolean;
}
export interface ChangelogPage { entries: ChangelogEntry[]; next: string | null; unread: number; latestId: number | null }
export interface SeenResult { unread: number; lastSeenId: number }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const isTag = (v: unknown): v is ChangelogTag => (TAGS as readonly unknown[]).includes(v);
const nonNull = <T>(v: T | null): v is T => v !== null;

function parseItem(raw: unknown): ChangelogItem | null {
  if (!isRecord(raw)) return null;
  const zh = str(raw.zh);
  const en = str(raw.en);
  if (!zh && !en) return null;
  return { tag: isTag(raw.tag) ? raw.tag : "other", zh, en };
}

function parseEntry(raw: unknown): ChangelogEntry | null {
  if (!isRecord(raw) || typeof raw.id !== "number" || typeof raw.entryDate !== "string") return null;
  const items = Array.isArray(raw.items) ? raw.items.map(parseItem).filter(nonNull) : [];
  if (items.length === 0) return null;
  return {
    id: raw.id,
    entryDate: raw.entryDate,
    version: typeof raw.version === "string" && raw.version ? raw.version : null,
    titleZh: str(raw.titleZh),
    titleEn: str(raw.titleEn),
    items,
    publishedAt: str(raw.publishedAt),
    isNew: raw.isNew === true,
  };
}

export function parseChangelogPage(raw: unknown): ChangelogPage {
  const r = isRecord(raw) ? raw : {};
  return {
    entries: Array.isArray(r.entries) ? r.entries.map(parseEntry).filter(nonNull) : [],
    next: typeof r.next === "string" && r.next ? r.next : null,
    unread: typeof r.unread === "number" && r.unread > 0 ? Math.floor(r.unread) : 0,
    latestId: typeof r.latestId === "number" ? r.latestId : null,
  };
}

export async function fetchChangelog(api: ApiClient, opts: { cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<ChangelogPage> {
  const raw = await api.request<unknown>("GET", "/api/changelog", {
    query: { cursor: opts.cursor, limit: opts.limit }, signal: opts.signal, timeoutMs: 15_000,
  });
  return parseChangelogPage(raw);
}

export async function postSeen(api: ApiClient, uptoId: number, signal?: AbortSignal): Promise<SeenResult> {
  const raw = await api.request<unknown>("POST", "/api/changelog/seen", { json: { uptoId }, signal, timeoutMs: 10_000 });
  const r = isRecord(raw) ? raw : {};
  return {
    unread: typeof r.unread === "number" && r.unread > 0 ? Math.floor(r.unread) : 0,
    lastSeenId: typeof r.lastSeenId === "number" ? r.lastSeenId : 0,
  };
}
```

`entries.ts`:

```ts
import { TAGS, type ChangelogEntry, type ChangelogTag } from "./api";

/** 日志页的纯函数:月份分组、类型筛选、折叠、日期格式。 */
export type TagFilter = ChangelogTag | "all";
export const COLLAPSED_ITEMS = 2;

export interface MonthGroup { key: string; entries: ChangelogEntry[] }

/** 相邻且同月的条目归一组(列表已按日期倒序;顺序不乱就不会出现重复的月份标题)。 */
export function groupByMonth(entries: ChangelogEntry[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const entry of entries) {
    const key = entry.entryDate.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else groups.push({ key, entries: [entry] });
  }
  return groups;
}

export function presentTags(entries: ChangelogEntry[]): ChangelogTag[] {
  const found = new Set(entries.flatMap((e) => e.items.map((i) => i.tag)));
  return TAGS.filter((tag) => found.has(tag));
}

/** 只留匹配类型的条目,没有匹配条目的卡片整张去掉;"all" 原样返回。 */
export function filterByTag(entries: ChangelogEntry[], tag: TagFilter): ChangelogEntry[] {
  if (tag === "all") return entries;
  return entries.flatMap((entry) => {
    const items = entry.items.filter((i) => i.tag === tag);
    return items.length ? [{ ...entry, items }] : [];
  });
}

export function collapsedItems<T>(items: T[], expanded: boolean, limit = COLLAPSED_ITEMS): T[] {
  return expanded || items.length <= limit ? items : items.slice(0, limit);
}

function localDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; // 本地日期,不经 UTC,不受时区影响
}

export function formatMonth(key: string, language: string): string {
  const date = localDate(`${key}-01`);
  if (!date) return key;
  try {
    return date.toLocaleDateString(language, { year: "numeric", month: "long" });
  } catch {
    return key;
  }
}

export function formatDay(entryDate: string, language: string): string {
  const date = localDate(entryDate);
  if (!date) return entryDate;
  try {
    return date.toLocaleDateString(language, { month: "long", day: "numeric" });
  } catch {
    return entryDate;
  }
}

/** 版本号显示:数字开头补 "v"(1.12 → v1.12),其余原样;空 = 不显示。 */
export function versionLabel(version: string | null): string | null {
  const v = version?.trim();
  if (!v) return null;
  return /^\d/.test(v) ? `v${v}` : v;
}
```

`locales.ts`:

```ts
import i18n from "~/i18n";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

/**
 * 更新日志的界面文案不进主包(计划 R-16):`**\/i18n/*.json` 由 i18n/index.ts 急切合并,这里的 locales/ 不在那个 glob 里。
 * 入口、页面、卡片模块都 `import "./locales"`,求值时并入 i18next(深合并,不覆盖已有键)。
 */
let loaded = false;
export function ensureChangelogI18n(): void {
  if (loaded) return;
  loaded = true;
  i18n.addResourceBundle("en", "translation", en, true, false);
  i18n.addResourceBundle("zh-CN", "translation", zh, true, false);
}

ensureChangelogI18n();
```

`locales/en.json`:

```json
{
  "web": {
    "changelog": {
      "title": "What's new",
      "entry": "What's new",
      "entryUnread_one": "What's new, 1 unread update",
      "entryUnread_other": "What's new, {{count}} unread updates",
      "hint_one": "1 new update",
      "hint_other": "{{count}} new updates",
      "filters": "Filter by type",
      "all": "All",
      "tag": { "new": "New", "improve": "Improved", "fix": "Fixed", "library": "Library", "other": "Other" },
      "newBadge": "New",
      "expandAll": "Show all {{count}}",
      "collapse": "Show less",
      "empty": "No updates yet",
      "error": "Could not load the updates",
      "offline": "Offline: showing the updates saved last time",
      "loadMore": "Load more",
      "loadMoreFailed": "Could not load more. Tap to retry",
      "end": "That is everything",
      "noMatch": "No updates of this type yet"
    }
  }
}
```

`locales/zh-CN.json`:

```json
{
  "web": {
    "changelog": {
      "title": "更新日志",
      "entry": "更新日志",
      "entryUnread_one": "更新日志,1 条未读",
      "entryUnread_other": "更新日志,{{count}} 条未读",
      "hint_one": "有 1 条新更新",
      "hint_other": "有 {{count}} 条新更新",
      "filters": "按类型筛选",
      "all": "全部",
      "tag": { "new": "新功能", "improve": "改进", "fix": "修复", "library": "跟读库", "other": "其他" },
      "newBadge": "新",
      "expandAll": "展开全部 {{count}} 条",
      "collapse": "收起",
      "empty": "还没有更新日志",
      "error": "没能加载更新日志",
      "offline": "离线:显示上次保存的更新日志",
      "loadMore": "加载更多",
      "loadMoreFailed": "没能加载更多,点按重试",
      "end": "已经是全部更新",
      "noMatch": "这个类型还没有更新"
    }
  }
}
```

`changelog.css`:

```css
/*
 * 更新日志的样式(计划 2026-10-14-changelog W2;设计 docs/superpowers/design/changelog-v1/mockup.html)。
 * 只有入口的扩散提示环与一次性小提示气泡、跟读库类型标签的紫色(theme.css 没有 purple 令牌,计划 R-18);其余全用 Tailwind 令牌。
 * 动画只用 transform / opacity;prefers-reduced-motion 下提示环静止。不加模糊层(顶栏已经是一层玻璃)。
 */
.cl-ring {
  position: absolute;
  inset: -3px;
  border-radius: 15px;
  border: 1.5px solid rgb(var(--blue));
  opacity: 0.7;
  pointer-events: none;
  animation: cl-pop 2.2s ease-out infinite;
}
@keyframes cl-pop {
  0% { transform: scale(0.9); opacity: 0.8; }
  100% { transform: scale(1.25); opacity: 0; }
}

.cl-hint {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  z-index: 40;
  max-width: 70vw;
  white-space: nowrap;
  border-radius: 10px;
  padding: 7px 11px;
  font-size: 12px;
  line-height: 1.3;
  background: rgb(var(--ink));
  color: rgb(var(--bg));
  box-shadow: 0 6px 18px -8px rgba(0, 0, 0, 0.4);
}
.cl-hint::after {
  content: "";
  position: absolute;
  top: -5px;
  right: 17px;
  border: 5px solid transparent;
  border-top: 0;
  border-bottom-color: rgb(var(--ink));
}

.cl-tag-library { background: #efe9ff; color: #6a3df0; }
.dark .cl-tag-library { background: rgba(183, 156, 255, 0.16); color: #b79cff; }

@media (prefers-reduced-motion: reduce) {
  .cl-ring { animation: none; opacity: 0.45; }
}
```

- [ ] **Step 4: 跑测试,全绿。** `cd web && yarn vitest run src/features/changelog`(`Intl` 输出依赖 Node 的完整 ICU;若 `formatMonth` 断言因 ICU 不同而失败,只改断言的期望字符串并在结果里记一笔,不要改实现)。

- [ ] **Step 5: 提交**(`git add web/src/features/changelog`):

```
feat(web): changelog api client, helpers, lazy copy and styles

Parsing is defensive (unknown tags show as "other"); the contract test reads the server fixture.
Month grouping, type filter and collapsing are pure functions. Copy lives outside the eager i18n glob.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

### Task W3: 入口(未读红点、提示环、一次性小提示)与登记

**Files:**(新建在 `web/src/features/changelog/`)`unread-store.ts`、`unread-store.test.ts`、`use-unread.ts`、`hint-pref.ts`、`use-one-time-hint.ts`、`changelog-entry.tsx`、`changelog-entry.test.tsx`、`register.tsx`、`changelog-lazy.test.ts`、`changelog-prefs.test.ts`;Modify:`web/src/lib/storage.ts`、`web/src/auth/device-data.ts`、`web/src/plugins/core.ts`、`web/src/plugins/links-matrix.test.tsx`、`web/src/features/practice/practice-page.test.tsx`

**Interfaces:**
- Produces(`./unread-store`):`UnreadState { status: "idle"|"loading"|"ready"|"error"; unread; latestId }`、`unreadSnapshot(api, userId)`、`subscribeUnread`、`refreshUnread(api, userId, force?)`、`markSeen(api, userId, uptoId)`、`SEEN_DELAY_MS = 1000`、`seenDelayMs()`、`setSeenDelayForTests(ms?)`、`resetUnreadForTests()`。
- Produces(`~/lib/storage`):`CHANGELOG_PREFS_KEY`。
- 效果:练习页顶栏出现 `data-testid="changelog-entry"` 的链接(`/practice/changelog`),有未读时 `changelog-dot` 与 `changelog-hint`(一次性)。

- [ ] **Step 1: 写失败测试。**

`unread-store.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { markSeen, refreshUnread, resetUnreadForTests, unreadSnapshot } from "./unread-store";

const page = (unread: number, latest: number | null) => json({ entries: [], next: null, unread, latest_id: latest });
function client(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  return { mock, api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) };
}
beforeEach(() => resetUnreadForTests());
afterEach(() => vi.restoreAllMocks());

describe("changelog unread store (R-14)", () => {
  it("loads unread and latest id with limit=1 and does not ask again within a minute", async () => {
    const { mock, api } = client({ "GET /api/changelog": () => page(2, 7) });
    expect(unreadSnapshot(api, "u1")).toEqual({ status: "idle", unread: 0, latestId: null });
    await refreshUnread(api, "u1");
    expect(unreadSnapshot(api, "u1")).toEqual({ status: "ready", unread: 2, latestId: 7 });
    expect(mock.calls[0].url.search).toBe("?limit=1");
    await refreshUnread(api, "u1");
    expect(mock.calls).toHaveLength(1);
    await refreshUnread(api, "u1", true);
    expect(mock.calls).toHaveLength(2);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    await refreshUnread(api, "u1");
    expect(mock.calls).toHaveLength(3);
  });

  it("shares one in-flight request", async () => {
    const { mock, api } = client({ "GET /api/changelog": () => page(1, 1) });
    await Promise.all([refreshUnread(api, "u1"), refreshUnread(api, "u1")]);
    expect(mock.calls).toHaveLength(1);
  });

  it("goes to the error state quietly when the request fails", async () => {
    const { api } = client({ "GET /api/changelog": () => json({ error: "boom" }, 500) });
    await refreshUnread(api, "u1");
    expect(unreadSnapshot(api, "u1")).toEqual({ status: "error", unread: 0, latestId: null });
  });

  it("never shows one user's state to another user or another client", async () => {
    const { mock, api } = client({ "GET /api/changelog": () => page(3, 9) });
    await refreshUnread(api, "u1");
    expect(unreadSnapshot(api, "u2")).toEqual({ status: "idle", unread: 0, latestId: null });
    expect(unreadSnapshot(client({}).api, "u1").status).toBe("idle");
    await refreshUnread(api, "u2");
    expect(mock.calls).toHaveLength(2);
    expect(unreadSnapshot(api, "u1").status).toBe("idle"); // u1's state was replaced, not leaked
  });

  it("markSeen reports upto_id, updates the count and ignores failures", async () => {
    const { mock, api } = client({
      "GET /api/changelog": () => page(2, 7),
      "POST /api/changelog/seen": () => json({ unread: 0, last_seen_id: 7 }),
    });
    await refreshUnread(api, "u1");
    await markSeen(api, "u1", 7);
    expect(JSON.parse(String(mock.calls[1].body))).toEqual({ upto_id: 7 });
    expect(unreadSnapshot(api, "u1")).toEqual({ status: "ready", unread: 0, latestId: 7 });
    const failing = client({ "GET /api/changelog": () => page(2, 7), "POST /api/changelog/seen": () => json({ error: "x" }, 500) });
    await refreshUnread(failing.api, "u1");
    await expect(markSeen(failing.api, "u1", 7)).resolves.toBeUndefined();
    expect(unreadSnapshot(failing.api, "u1").unread).toBe(2);
  });
});
```

`changelog-entry.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { CHANGELOG_PREFS_KEY } from "~/lib/storage";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ChangelogEntry } from "./changelog-entry";

const page = (unread: number, latest: number | null) => json({ entries: [], next: null, unread, latest_id: latest });
function setup(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  const view = renderWithProviders(<ChangelogEntry />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/practice" });
  return { mock, ...view };
}
beforeEach(() => localStorage.clear());

describe("ChangelogEntry", () => {
  it("renders nothing when nothing is published", async () => {
    const { mock } = setup({ "GET /api/changelog": () => page(0, null) });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("changelog-entry")).toBeNull();
  });

  it("renders nothing when the request fails", async () => {
    const { mock } = setup({ "GET /api/changelog": () => json({ error: "boom" }, 500) });
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("changelog-entry")).toBeNull();
  });

  it("is a quiet icon link when everything is read", async () => {
    setup({ "GET /api/changelog": () => page(0, 5) });
    const link = await screen.findByTestId("changelog-entry");
    expect(link).toHaveAttribute("href", "/practice/changelog");
    expect(link).toHaveAccessibleName("What's new");
    expect(screen.queryByTestId("changelog-dot")).toBeNull();
    expect(screen.queryByTestId("changelog-hint")).toBeNull();
  });

  it("shows the dot, counts unread in its name and shows the hint exactly once", async () => {
    const first = setup({ "GET /api/changelog": () => page(2, 5) });
    const link = await screen.findByTestId("changelog-entry");
    expect(link).toHaveAccessibleName("What's new, 2 unread updates");
    expect(screen.getByTestId("changelog-dot")).toBeInTheDocument();
    expect(await screen.findByTestId("changelog-hint")).toHaveTextContent("2 new updates");
    expect(JSON.parse(localStorage.getItem(CHANGELOG_PREFS_KEY)!)).toEqual({ hintSeen: true });
    first.unmount();
    setup({ "GET /api/changelog": () => page(2, 5) }); // a later visit: the dot is back, the hint is not
    await screen.findByTestId("changelog-dot");
    expect(screen.queryByTestId("changelog-hint")).toBeNull();
  });

  it("puts the hint away on the next press anywhere and keeps the dot", async () => {
    setup({ "GET /api/changelog": () => page(1, 5) });
    expect(await screen.findByTestId("changelog-hint")).toHaveTextContent("1 new update");
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByTestId("changelog-hint")).toBeNull());
    expect(screen.getByTestId("changelog-dot")).toBeInTheDocument();
  });

  it("does not show the hint when this device has shown it before", async () => {
    localStorage.setItem(CHANGELOG_PREFS_KEY, JSON.stringify({ hintSeen: true }));
    setup({ "GET /api/changelog": () => page(4, 9) });
    await screen.findByTestId("changelog-dot");
    expect(screen.queryByTestId("changelog-hint")).toBeNull();
  });
});
```

`changelog-prefs.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearDeviceData } from "~/auth/device-data";
import { CHANGELOG_PREFS_KEY } from "~/lib/storage";
import { readHintSeen, writeHintSeen } from "./hint-pref";

describe("changelog hint preference (R-15)", () => {
  beforeEach(() => localStorage.clear());

  it("is false until written, then true, and keeps other fields", () => {
    expect(readHintSeen()).toBe(false);
    localStorage.setItem(CHANGELOG_PREFS_KEY, JSON.stringify({ other: 1 }));
    writeHintSeen();
    expect(readHintSeen()).toBe(true);
    expect(JSON.parse(localStorage.getItem(CHANGELOG_PREFS_KEY)!)).toEqual({ other: 1, hintSeen: true });
  });

  it("is forgotten at logout", () => {
    writeHintSeen();
    clearDeviceData();
    expect(localStorage.getItem(CHANGELOG_PREFS_KEY)).toBeNull();
    expect(readHintSeen()).toBe(false);
  });

  it("survives unavailable storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    expect(readHintSeen()).toBe(false);
    expect(() => writeHintSeen()).not.toThrow();
    vi.restoreAllMocks();
  });
});
```

`changelog-lazy.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 主包守卫(计划 R-3):这些模块在主包里,不得静态导入懒模块、懒加载文案或样式。 */
const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(path.join(here, rel), "utf8");
const MAIN = ["index.ts", "lazy-pages.tsx", "register.tsx"];
const LAZY_ONLY = [
  "locales", "changelog-entry", "changelog-page", "entry-card", "unread-store", "use-unread", "use-one-time-hint", "hint-pref",
  "use-changelog-list", "use-near-end", "api", "entries", "changelog.css",
];
const staticImports = (s: string) =>
  [...s.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s*["']\.\/([^"']+)["']|(?:^|\n)\s*import\s*["']\.\/([^"']+)["']/g)]
    .map((m) => (m[1] ?? m[2]).replace(/\.(ts|tsx)$/, ""));

describe("changelog stays out of the main bundle (R-3)", () => {
  it("main-bundle modules never statically import lazy modules, the copy or the css", () => {
    for (const f of MAIN) {
      for (const target of staticImports(src(f))) expect(LAZY_ONLY, `${f} -> ./${target}`).not.toContain(target);
    }
  });

  it("the entry and the page are reached only through import()", () => {
    expect(src("register.tsx")).toContain('import("./changelog-entry")');
    expect(src("lazy-pages.tsx")).toContain('import("./changelog-page")');
    expect(src("index.ts")).toContain('from "./lazy-pages"');
  });

  it("is wired in without a new cross-feature edge", () => {
    expect(readFileSync(path.resolve(here, "../../plugins/core.ts"), "utf8")).toContain('import "~/features/changelog/register"');
    expect(readFileSync(path.resolve(here, "../../app.tsx"), "utf8")).toContain('path="/practice/changelog"');
    expect(readFileSync(path.resolve(here, "../practice/practice-page.tsx"), "utf8")).not.toContain("features/changelog");
    const register = src("register.tsx");
    expect(register).toContain('point: "practiceHeaderActions"');
    expect(register).not.toMatch(/\blink:|requiresLinks/); // a core contribution: visible with every learning link off
  });
});
```

`links-matrix.test.tsx`(Edit,单行锚点):
- `    expect(visibleIds(ALL_OFF)).toEqual(["appEffects/links.config", "selectionActions/chat.read-aloud", "wordActions/vocabulary.add"]);` → `    expect(visibleIds(ALL_OFF)).toEqual(["appEffects/links.config", "practiceHeaderActions/changelog.entry", "selectionActions/chat.read-aloud", "wordActions/vocabulary.add"]);`
- W1 加的那一行 `    expect(ids("practiceHeaderActions")).toEqual([]); // W3 登记…` → `    expect(ids("practiceHeaderActions")).toEqual(["changelog.entry"]);`

`practice-page.test.tsx`(在 `  it("links to the progress page", () => {` 之前插入):

```tsx
  it("shows the changelog entry left of the practice list when something is published", async () => {
    setup({ "GET /api/changelog": () => json({ entries: [], next: null, unread: 2, latest_id: 5 }) });
    const entry = await screen.findByTestId("changelog-entry", {}, { timeout: 10_000 });
    expect(entry).toHaveAttribute("href", "/practice/changelog");
    expect(entry.compareDocumentPosition(screen.getByTestId("practice-list")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }, 20_000);

  it("has no changelog entry when nothing is published", async () => {
    const { mock } = setup({ "GET /api/changelog": () => json({ entries: [], next: null, unread: 0, latest_id: null }) });
    await waitFor(() => expect(mock.calls.some((c) => c.url.pathname === "/api/changelog")).toBe(true), { timeout: 10_000 });
    expect(screen.queryByTestId("changelog-entry")).toBeNull();
  }, 20_000);
```

- [ ] **Step 2: 看它们失败。** `cd web && yarn vitest run src/features/changelog/unread-store.test.ts src/features/changelog/changelog-entry.test.tsx src/features/changelog/changelog-prefs.test.ts src/features/changelog/changelog-lazy.test.ts src/plugins/links-matrix.test.tsx src/features/practice/practice-page.test.tsx` → 缺模块 / 断言失败。

- [ ] **Step 3: 实现。**

`web/src/lib/storage.ts`:在文件末尾(`WORDBOOK_PREFS_KEY` 之后)追加(Edit 锚点:`export const WORDBOOK_PREFS_KEY = "enjoy-web.wordbook.prefs";`):

```ts

/** 更新日志的本机偏好(一次性小提示是否已显示,计划 2026-10-14-changelog R-15);登出时由 auth/device-data 清除。 */
export const CHANGELOG_PREFS_KEY = "enjoy-web.changelog.prefs";
```

`web/src/auth/device-data.ts`(Edit 单行):
- `import { PRACTICE_DRAFT_KEY, WORDBOOK_PREFS_KEY, removeKey } from "~/lib/storage";` → `import { CHANGELOG_PREFS_KEY, PRACTICE_DRAFT_KEY, WORDBOOK_PREFS_KEY, removeKey } from "~/lib/storage";`
- `export { PRACTICE_DRAFT_KEY, WORDBOOK_PREFS_KEY };` → `export { CHANGELOG_PREFS_KEY, PRACTICE_DRAFT_KEY, WORDBOOK_PREFS_KEY };`
- `    removeKey(WORDBOOK_PREFS_KEY);` → 同一行 + 下一行 `    removeKey(CHANGELOG_PREFS_KEY);`
- 函数上方注释里「背单词偏好」后加「更新日志提示」(可选,单行 Edit)。

`unread-store.ts`:

```ts
import type { ApiClient } from "~/api/client";
import { fetchChangelog, postSeen } from "./api";

/**
 * 更新日志入口的未读数(计划 2026-10-14-changelog R-14):一个很小的内存 store,按「ApiClient 实例 + 用户 id」分区
 * (AuthProvider 的 api 在登出 / 登录之间是同一个对象,所以必须带用户 id);60 秒内不重复请求,飞行中的请求去重。
 * 入口只要 `unread` 与 `latestId`,所以请求是 `?limit=1`。失败不抛(入口就不显示)。不含任何条目文字。
 */
export interface UnreadState { status: "idle" | "loading" | "ready" | "error"; unread: number; latestId: number | null }

const IDLE: UnreadState = Object.freeze({ status: "idle", unread: 0, latestId: null });
const FRESH_MS = 60_000;

/** 页面打开后多久标记已读(spec §2.2:1 秒)。 */
export const SEEN_DELAY_MS = 1000;
let seenDelay = SEEN_DELAY_MS;
export const seenDelayMs = (): number => seenDelay;
/** 仅测试:把延迟改短;不传 = 恢复默认。 */
export function setSeenDelayForTests(ms?: number): void {
  seenDelay = ms ?? SEEN_DELAY_MS;
}

interface Owner { api: ApiClient; userId: string | null }
let owner: Owner | null = null;
let state: UnreadState = IDLE;
let loadedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: UnreadState): void {
  state = next;
  for (const fn of [...listeners]) fn();
}

const owns = (api: ApiClient, userId: string | null): boolean => owner !== null && owner.api === api && owner.userId === userId;

export function subscribeUnread(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** 这个 api + 用户的状态;别人的状态不外泄(用户切换时第一帧也不会闪出上一个人的红点)。 */
export function unreadSnapshot(api: ApiClient, userId: string | null): UnreadState {
  return owns(api, userId) ? state : IDLE;
}

export function refreshUnread(api: ApiClient, userId: string | null, force = false): Promise<void> {
  if (!owns(api, userId)) {
    owner = { api, userId };
    loadedAt = 0;
    inflight = null;
    emit(IDLE);
  }
  if (inflight) return inflight;
  if (!force && state.status === "ready" && Date.now() - loadedAt < FRESH_MS) return Promise.resolve();
  const mine = owner;
  if (state.status !== "ready") emit({ ...state, status: "loading" });
  const request: Promise<void> = fetchChangelog(api, { limit: 1 })
    .then(
      (page) => {
        if (owner !== mine) return;
        loadedAt = Date.now();
        emit({ status: "ready", unread: page.unread, latestId: page.latestId });
      },
      () => {
        if (owner === mine && state.status !== "ready") emit({ ...state, status: "error" });
      },
    )
    .finally(() => {
      if (inflight === request) inflight = null;
    });
  inflight = request;
  return request;
}

/** 日志页调用:把已读位置报给服务端,成功后直接用返回的未读数更新红点;失败静默(下次打开页面再报)。 */
export async function markSeen(api: ApiClient, userId: string | null, uptoId: number): Promise<void> {
  try {
    const result = await postSeen(api, uptoId);
    if (owns(api, userId)) emit({ ...state, unread: result.unread });
  } catch {
    /* 下次打开页面再报 */
  }
}

export function resetUnreadForTests(): void {
  owner = null;
  state = IDLE;
  loadedAt = 0;
  inflight = null;
}
```

`use-unread.ts`:

```ts
import { useEffect, useSyncExternalStore } from "react";
import { useAuth } from "~/auth/auth-context";
import { refreshUnread, subscribeUnread, unreadSnapshot, type UnreadState } from "./unread-store";

/** 入口用:挂载时刷新(60 秒内不重复),按当前 api + 用户读状态。 */
export function useChangelogUnread(): UnreadState {
  const { api, user } = useAuth();
  const userId = user?.id ?? null;
  const state = useSyncExternalStore(subscribeUnread, () => unreadSnapshot(api, userId), () => unreadSnapshot(api, userId));
  useEffect(() => {
    void refreshUnread(api, userId);
  }, [api, userId]);
  return state;
}
```

`hint-pref.ts`:

```ts
import { CHANGELOG_PREFS_KEY, readJson, writeJson } from "~/lib/storage";

/**
 * 「第一次出现未读」小提示的本机记忆(计划 R-15):布尔 `hintSeen`,JSON 合并写入;退出登录由 clearDeviceData 清除。
 * 不含任何用户数据。存储不可用时读到 false、写入静默丢弃。
 */
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function readHintSeen(): boolean {
  return readJson(CHANGELOG_PREFS_KEY, isObject)?.hintSeen === true;
}

export function writeHintSeen(): void {
  const stored = readJson(CHANGELOG_PREFS_KEY, isObject) ?? {};
  writeJson(CHANGELOG_PREFS_KEY, { ...stored, hintSeen: true });
}
```

`use-one-time-hint.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { readHintSeen, writeHintSeen } from "./hint-pref";

export const HINT_VISIBLE_MS = 8000;

/**
 * 一次性小提示(spec §2.2、计划 R-15):第一次出现未读时显示并马上记下「已显示」;这一次的显示保持到任意 pointerdown、
 * 点图标、未读归零或 8 秒后;之后同一设备不再出现。
 */
export function useOneTimeHint(unread: number): { show: boolean; dismiss: () => void } {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (unread <= 0 || readHintSeen()) return;
    writeHintSeen();
    setShown(true);
  }, [unread]);
  const dismiss = useCallback(() => setShown(false), []);
  const visible = shown && unread > 0;
  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(dismiss, HINT_VISIBLE_MS);
    document.addEventListener("pointerdown", dismiss, { capture: true, once: true });
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", dismiss, { capture: true });
    };
  }, [visible, dismiss]);
  return { show: visible, dismiss };
}
```

`changelog-entry.tsx`:

```tsx
import { SparklesIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import "./changelog.css";
import "./locales";
import { useChangelogUnread } from "./use-unread";
import { useOneTimeHint } from "./use-one-time-hint";

/** 顶栏右侧 44px 图标链接,外观同练习页的「练习清单」(IconButton 的链接版)。 */
const ICON_LINK = cn(
  "relative inline-flex h-tap w-tap flex-none items-center justify-center rounded-button text-ink transition-colors duration-fast",
  "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:h-[22px] [&_svg]:w-[22px]",
);

/**
 * 练习页顶栏的「更新日志」入口(扩展点 practiceHeaderActions 的核心贡献,计划 R-2、R-3):星花图标(不用铃铛,以免被当成消息通知);
 * 没有任何已发布条目、或请求失败时整个不显示;有未读时右上角红点 + 慢速扩散的提示环,第一次出现未读时下方弹一条一次性小提示。
 */
export function ChangelogEntry() {
  const { t } = useTranslation();
  const state = useChangelogUnread();
  const hint = useOneTimeHint(state.unread);
  if (state.status === "idle" || state.latestId === null) return null;
  const unread = state.unread;
  return (
    <div className="relative flex-none">
      <Link
        to="/practice/changelog"
        data-testid="changelog-entry"
        aria-label={unread > 0 ? t("web.changelog.entryUnread", { count: unread }) : t("web.changelog.entry")}
        onClick={hint.dismiss}
        className={ICON_LINK}
      >
        {unread > 0 ? <span aria-hidden className="cl-ring" /> : null}
        <SparklesIcon aria-hidden />
        {unread > 0 ? (
          <span
            data-testid="changelog-dot"
            aria-hidden
            className="absolute right-2 top-2 h-[9px] w-[9px] rounded-full bg-red shadow-[0_0_0_2px_rgb(var(--bg))]"
          />
        ) : null}
      </Link>
      {hint.show ? (
        <div role="status" data-testid="changelog-hint" className="cl-hint">
          {t("web.changelog.hint", { count: unread })}
        </div>
      ) : null}
    </div>
  );
}
```

`register.tsx`:

```tsx
// 只被 web/src/plugins/ 导入(architecture.test.ts):练习页顶栏的「更新日志」入口(计划 2026-10-14-changelog R-2、R-3)。
// 核心贡献:无联动键,永远可见。入口组件(图标、红点、提示、文案、样式)在懒加载块里,主包只有这个文件。
import { lazy, Suspense } from "react";
import { contribute } from "~/lib/extension-points";

const Entry = lazy(async () => ({ default: (await import("./changelog-entry")).ChangelogEntry }));

function ChangelogEntrySlot() {
  return (
    <Suspense fallback={null}>
      <Entry />
    </Suspense>
  );
}

contribute({ point: "practiceHeaderActions", id: "changelog.entry", order: 0, component: ChangelogEntrySlot });
```

`web/src/plugins/core.ts`(Edit):`import "~/features/chat/register-selection-actions";` → 同一行 + 下一行 `import "~/features/changelog/register"; // 练习页顶栏的「更新日志」入口(计划 2026-10-14-changelog)`;并把第 1 行文件头注释里的「加入生词本、选词朗读」改成「加入生词本、选词朗读、更新日志入口」(单行 Edit)。

- [ ] **Step 4: 跑测试,全绿。**
  `cd web && yarn vitest run src/features/changelog src/plugins src/lib/extension-points.test.tsx src/features/practice/practice-page.test.tsx src/architecture.test.ts src/auth`
  (第一次运行懒加载块要冷编译,慢是正常的;`changelog-entry.test.tsx` 与 practice 的两个新用例已放宽超时。若别的 `PracticePage` 测试因多出的 `GET /api/changelog` 请求而出现「未处理的请求」类失败,**只在那个测试里**给 `createFetchMock` 加一个 `"GET /api/changelog"` 路由,不要改入口。)

- [ ] **Step 5: 提交**(`git add web/src/features/changelog web/src/lib/storage.ts web/src/auth/device-data.ts web/src/plugins/core.ts web/src/plugins/links-matrix.test.tsx web/src/features/practice/practice-page.test.tsx`;注意 `web/src/features/changelog` 此时已含 W2 与 W3 的全部文件,W2 的已提交过,git 只会加新增的):

```
feat(web): changelog entry with unread dot and one-time hint

A lazy core contribution to the practice header: star icon, red dot and slow ring while something is unread,
a one-time hint remembered on the device (cleared at logout). Hidden when nothing is published or the request fails.
The unread count lives in a small in-memory store keyed by client and user.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

### Task W4: 日志页、列表数据、分页、离线缓存、路由

**Files:**(新建在 `web/src/features/changelog/`)`use-changelog-list.ts`、`use-near-end.ts`、`entry-card.tsx`、`changelog-page.tsx`、`changelog-page.test.tsx`、`lazy-pages.tsx`、`index.ts`;Modify:`web/src/app.tsx`

**Interfaces:**
- Produces(`~/features/changelog`):`ChangelogPage`(懒加载页,`/practice/changelog`)。
- Produces(`./use-changelog-list`):`useChangelogList(): ChangelogList`、`mergeEntries`、`CACHE_KEY = "changelog:v1:first-page"`。
- 测试钩子:`data-testid`:`changelog-page`、`changelog-loading`、`changelog-error`、`changelog-retry`、`changelog-empty`、`changelog-offline`、`changelog-month`、`changelog-card-<id>`、`changelog-new-<id>`、`changelog-more-<id>`、`changelog-load-more`、`changelog-end`、`changelog-no-match`。

- [ ] **Step 1: 写失败测试** — `web/src/features/changelog/changelog-page.test.tsx`:

```tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { kvClear } from "~/lib/kv-cache";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ChangelogPage } from "./changelog-page";
import { resetUnreadForTests, setSeenDelayForTests } from "./unread-store";

const item = (tag: string, zh: string, en = "") => ({ tag, zh, en });
const entry = (id: number, day: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, entry_date: day, version: null, title_zh: `标题${id}`, title_en: `Title ${id}`, published_at: "2026-10-14T00:00:00+00:00",
  is_new: false, items: [item("new", `新功能${id}`, `New ${id}`)], ...over,
});
const THREE = [
  entry(3, "2026-10-14", { is_new: true, version: "1.12", items: [item("new", "新3", "New 3"), item("improve", "改3", "Improve 3"), item("fix", "修3", "Fix 3")] }),
  entry(2, "2026-10-13", { is_new: true, items: [item("new", "新2a", "New 2a"), item("improve", "改2", "Improve 2"), item("improve", "改2b", "Improve 2b")] }),
  entry(1, "2026-09-28", { title_en: "", items: [item("library", "库1", "")] }),
];
const body = (entries: unknown[], over: Record<string, unknown> = {}): Record<string, unknown> => ({ entries, next: null, unread: 2, latest_id: 3, ...over });
const SEEN_OK = { "POST /api/changelog/seen": () => json({ unread: 0, last_seen_id: 3 }) };

function setup(routes: Parameters<typeof createFetchMock>[0]) {
  const mock = createFetchMock(routes);
  const view = renderWithProviders(<ChangelogPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/practice/changelog" });
  return { mock, ...view };
}
const seenCalls = (mock: ReturnType<typeof createFetchMock>) => mock.calls.filter((c) => c.url.pathname === "/api/changelog/seen");

beforeEach(async () => {
  localStorage.clear();
  await kvClear();
  resetUnreadForTests();
  setSeenDelayForTests(0);
});
afterEach(async () => {
  setSeenDelayForTests();
  localStorage.removeItem("enjoy-web.settings");
  await i18n.changeLanguage("en");
});

describe("ChangelogPage", () => {
  it("shows a skeleton, then the log by month with the first card open and the rest collapsed", async () => {
    setup({ "GET /api/changelog": () => json(body(THREE)), ...SEEN_OK });
    expect(screen.getByTestId("changelog-loading")).toBeInTheDocument();
    const card3 = await screen.findByTestId("changelog-card-3");
    expect(screen.getAllByTestId("changelog-month").map((m) => m.textContent)).toEqual(["October 2026", "September 2026"]);
    for (const text of ["New 3", "Improve 3", "Fix 3"]) expect(within(card3).getByText(text)).toBeInTheDocument();
    expect(within(card3).getByText("v1.12")).toBeInTheDocument();
    expect(screen.getByTestId("changelog-more-3")).toHaveTextContent("Show less");
    const card2 = screen.getByTestId("changelog-card-2");
    expect(within(card2).getByText("Improve 2")).toBeInTheDocument();
    expect(within(card2).queryByText("Improve 2b")).toBeNull();
    expect(screen.getByTestId("changelog-more-2")).toHaveTextContent("Show all 3");
    await userEvent.click(screen.getByTestId("changelog-more-2"));
    expect(within(card2).getByText("Improve 2b")).toBeInTheDocument();
    expect(screen.queryByTestId("changelog-more-1")).toBeNull(); // one item: nothing to fold
    expect(within(screen.getByTestId("changelog-card-1")).getByText("标题1")).toBeInTheDocument(); // English blank -> Chinese
  });

  it("marks unread cards with a New badge that stays after the read position is reported", async () => {
    const { mock } = setup({ "GET /api/changelog": () => json(body(THREE)), ...SEEN_OK });
    await screen.findByTestId("changelog-card-3");
    expect(screen.getByTestId("changelog-new-3")).toHaveTextContent("New");
    expect(screen.getByTestId("changelog-new-2")).toBeInTheDocument();
    expect(screen.queryByTestId("changelog-new-1")).toBeNull();
    await waitFor(() => expect(seenCalls(mock)).toHaveLength(1));
    expect(JSON.parse(String(seenCalls(mock)[0].body))).toEqual({ upto_id: 3 });
    expect(screen.getByTestId("changelog-new-3")).toBeInTheDocument();
  });

  it("reports nothing when the page is left before the delay", async () => {
    setSeenDelayForTests(1000);
    const { mock, unmount } = setup({ "GET /api/changelog": () => json(body(THREE)), ...SEEN_OK });
    await screen.findByTestId("changelog-card-3");
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seenCalls(mock)).toHaveLength(0);
  });

  it("reads in Chinese in the Chinese UI", async () => {
    localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" }));
    await i18n.changeLanguage("zh-CN");
    setup({ "GET /api/changelog": () => json(body(THREE)), ...SEEN_OK });
    const card3 = await screen.findByTestId("changelog-card-3");
    expect(within(card3).getByText("标题3")).toBeInTheDocument();
    expect(within(card3).getByText("改3")).toBeInTheDocument();
    expect(screen.getAllByTestId("changelog-month").map((m) => m.textContent)).toEqual(["2026年10月", "2026年9月"]);
    expect(screen.getByTestId("changelog-new-3")).toHaveTextContent("新");
  });

  it("filters by type, hiding cards without a match", async () => {
    setup({ "GET /api/changelog": () => json(body(THREE)), ...SEEN_OK });
    await screen.findByTestId("changelog-card-3");
    const group = screen.getByRole("group", { name: "Filter by type" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "New", "Improved", "Fixed", "Library"]);
    await userEvent.click(within(group).getByRole("button", { name: "Fixed" }));
    const card3 = screen.getByTestId("changelog-card-3");
    expect(within(card3).getByText("Fix 3")).toBeInTheDocument();
    expect(within(card3).queryByText("New 3")).toBeNull();
    expect(screen.queryByTestId("changelog-card-2")).toBeNull();
    expect(screen.queryByTestId("changelog-card-1")).toBeNull();
    await userEvent.click(within(group).getByRole("button", { name: "All" }));
    expect(screen.getByTestId("changelog-card-2")).toBeInTheDocument();
  });

  it("has no filter row when the log has one type only", async () => {
    setup({ "GET /api/changelog": () => json(body([entry(1, "2026-10-01")], { unread: 0, latest_id: 1 })) });
    await screen.findByTestId("changelog-card-1");
    expect(screen.queryByRole("group", { name: "Filter by type" })).toBeNull();
  });

  it("shows the empty state and reports nothing", async () => {
    const { mock } = setup({ "GET /api/changelog": () => json(body([], { unread: 0, latest_id: null })), ...SEEN_OK });
    expect(await screen.findByTestId("changelog-empty")).toHaveTextContent("No updates yet");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seenCalls(mock)).toHaveLength(0);
  });

  it("shows a failure with a retry that loads the log", async () => {
    let calls = 0;
    setup({ "GET /api/changelog": () => (++calls === 1 ? json({ error: "boom" }, 500) : json(body(THREE))), ...SEEN_OK });
    expect(await screen.findByTestId("changelog-error")).toHaveTextContent("Could not load the updates");
    await userEvent.click(screen.getByTestId("changelog-retry"));
    expect(await screen.findByTestId("changelog-card-3")).toBeInTheDocument();
    expect(screen.queryByTestId("changelog-error")).toBeNull();
  });

  it("falls back to the last saved first page when offline, without badges and without reporting", async () => {
    const first = setup({ "GET /api/changelog": () => json(body(THREE)), ...SEEN_OK });
    await screen.findByTestId("changelog-card-3");
    first.unmount();
    const second = setup({ "GET /api/changelog": () => json({ error: "down" }, 500), ...SEEN_OK });
    expect(await screen.findByTestId("changelog-offline")).toHaveTextContent("Offline: showing the updates saved last time");
    expect(await screen.findByTestId("changelog-card-3")).toBeInTheDocument();
    expect(screen.queryByTestId("changelog-new-3")).toBeNull();
    expect(screen.queryByTestId("changelog-load-more")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seenCalls(second.mock)).toHaveLength(0);
  });

  it("loads more with the cursor, appends without duplicates and ends with a note", async () => {
    const { mock } = setup({
      "GET /api/changelog": (call) => (call.url.searchParams.get("cursor") ? json(body([THREE[1], THREE[2]], { next: null })) : json(body([THREE[0]], { next: "2026-10-14.3" }))),
      ...SEEN_OK,
    });
    await screen.findByTestId("changelog-card-3");
    expect(screen.queryByTestId("changelog-card-2")).toBeNull();
    expect(screen.queryByTestId("changelog-end")).toBeNull();
    await userEvent.click(screen.getByTestId("changelog-load-more"));
    expect(await screen.findByTestId("changelog-card-2")).toBeInTheDocument();
    expect(screen.getByTestId("changelog-card-1")).toBeInTheDocument();
    expect(mock.calls.filter((c) => c.url.pathname === "/api/changelog")[1].url.searchParams.get("cursor")).toBe("2026-10-14.3");
    expect(screen.queryByTestId("changelog-load-more")).toBeNull();
    expect(screen.getByTestId("changelog-end")).toHaveTextContent("That is everything");
    expect(screen.getAllByTestId(/^changelog-card-/)).toHaveLength(3);
  });

  it("turns a failed load-more into a retry button", async () => {
    let more = 0;
    setup({
      "GET /api/changelog": (call) => {
        if (!call.url.searchParams.get("cursor")) return json(body([THREE[0]], { next: "c1" }));
        return ++more === 1 ? json({ error: "boom" }, 500) : json(body([THREE[1]], { next: null }));
      },
      ...SEEN_OK,
    });
    await screen.findByTestId("changelog-card-3");
    await userEvent.click(screen.getByTestId("changelog-load-more"));
    await waitFor(() => expect(screen.getByTestId("changelog-load-more")).toHaveTextContent("Could not load more. Tap to retry"));
    await userEvent.click(screen.getByTestId("changelog-load-more"));
    expect(await screen.findByTestId("changelog-card-2")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 看它失败。** `cd web && yarn vitest run src/features/changelog/changelog-page.test.tsx src/features/changelog/changelog-lazy.test.ts` → 缺模块。

- [ ] **Step 3: 实现。**

`use-changelog-list.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "~/auth/auth-context";
import { kvGet, kvSet } from "~/lib/kv-cache";
import { fetchChangelog, parseChangelogPage, type ChangelogEntry } from "./api";

/** 内容是公开的发布说明,所以第一页可以放进本机缓存(退出登录时 kvClear 会清);键里没有用户信息。 */
export const CACHE_KEY = "changelog:v1:first-page";

export interface ChangelogList {
  status: "loading" | "ready" | "error";
  entries: ChangelogEntry[];
  latestId: number | null;
  hasMore: boolean;
  loadingMore: boolean;
  moreFailed: boolean;
  /** 首页请求失败,显示的是上次保存的第一页(不分页、不报已读、没有「新」角标) */
  offline: boolean;
  loadMore: () => void;
  reload: () => void;
}

interface State {
  status: ChangelogList["status"];
  entries: ChangelogEntry[];
  next: string | null;
  latestId: number | null;
  loadingMore: boolean;
  moreFailed: boolean;
  offline: boolean;
}
const LOADING: State = { status: "loading", entries: [], next: null, latestId: null, loadingMore: false, moreFailed: false, offline: false };

export function mergeEntries(current: ChangelogEntry[], more: ChangelogEntry[]): ChangelogEntry[] {
  const known = new Set(current.map((e) => e.id));
  return [...current, ...more.filter((e) => !known.has(e.id))];
}

export function useChangelogList(): ChangelogList {
  const { api } = useAuth();
  const [state, setState] = useState<State>(LOADING);
  const [tick, setTick] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const moreCtl = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    moreCtl.current?.abort();
    moreCtl.current = null;
    setState(LOADING);
    fetchChangelog(api, { signal: ctl.signal }).then(
      (page) => {
        if (ctl.signal.aborted) return;
        void kvSet(CACHE_KEY, page);
        setState({ status: "ready", entries: page.entries, next: page.next, latestId: page.latestId, loadingMore: false, moreFailed: false, offline: false });
      },
      async () => {
        if (ctl.signal.aborted) return;
        const cached = parseChangelogPage(await kvGet<unknown>(CACHE_KEY));
        if (ctl.signal.aborted) return;
        if (cached.entries.length > 0) {
          setState({
            status: "ready", entries: cached.entries.map((e) => ({ ...e, isNew: false })), next: null, latestId: cached.latestId,
            loadingMore: false, moreFailed: false, offline: true,
          });
        } else {
          setState({ ...LOADING, status: "error" });
        }
      },
    );
    return () => {
      ctl.abort();
      moreCtl.current?.abort();
      moreCtl.current = null;
    };
  }, [api, tick]);

  const loadMore = useCallback(() => {
    const cursor = stateRef.current.next;
    if (!cursor || moreCtl.current) return;
    const ctl = new AbortController();
    moreCtl.current = ctl;
    setState((s) => ({ ...s, loadingMore: true, moreFailed: false }));
    fetchChangelog(api, { cursor, signal: ctl.signal })
      .then(
        (page) => {
          if (!ctl.signal.aborted) setState((s) => ({ ...s, entries: mergeEntries(s.entries, page.entries), next: page.next, loadingMore: false }));
        },
        () => {
          if (!ctl.signal.aborted) setState((s) => ({ ...s, loadingMore: false, moreFailed: true }));
        },
      )
      .finally(() => {
        if (moreCtl.current === ctl) moreCtl.current = null;
      });
  }, [api]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return {
    status: state.status, entries: state.entries, latestId: state.latestId, hasMore: state.next !== null,
    loadingMore: state.loadingMore, moreFailed: state.moreFailed, offline: state.offline, loadMore, reload,
  };
}
```

`use-near-end.ts`:

```ts
import { useEffect, useRef } from "react";

/**
 * 哨兵进入视口(提前 240px)时调用 onNear(计划 R-17③)。滚动容器是应用壳的 <main>,IntersectionObserver 的 root 取默认视口即可。
 * 没有 IntersectionObserver 的环境什么都不做;「加载更多」按钮始终是兜底。
 */
export function useNearEnd(onNear: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const callback = useRef(onNear);
  callback.current = onNear;
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((hits) => {
      if (hits.some((h) => h.isIntersecting)) callback.current();
    }, { rootMargin: "240px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);
  return ref;
}
```

`entry-card.tsx`:

```tsx
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { pickText } from "~/components/announcement-banner";
import { TONE_CLASS } from "~/components/tone";
import type { ChangelogEntry, ChangelogTag } from "./api";
import { collapsedItems, formatDay, versionLabel } from "./entries";
import "./locales";

const CHIP = "mt-[2px] inline-flex h-5 flex-none items-center rounded-[7px] px-[7px] text-[11px] font-semibold leading-none";
const TAG_CLASS: Record<ChangelogTag, string> = {
  new: TONE_CLASS.blue, improve: TONE_CLASS.teal, fix: TONE_CLASS.amber, library: "cl-tag-library", other: TONE_CLASS.gray,
};

/** 一张日志卡(mockup 2):日期、可选版本号、标题、带类型标签的条目;未读的描边加「新」角标;超过 2 条默认折叠。 */
export function EntryCard({ entry, language, defaultExpanded }: { entry: ChangelogEntry; language: string; defaultExpanded: boolean }) {
  const { t } = useTranslation();
  const [toggled, setToggled] = useState<boolean | null>(null);
  const expanded = toggled ?? defaultExpanded;
  const shown = collapsedItems(entry.items, expanded);
  const foldable = entry.items.length > 2;
  const version = versionLabel(entry.version);
  const titleId = `changelog-title-${entry.id}`;
  return (
    <article
      data-testid={`changelog-card-${entry.id}`}
      aria-labelledby={titleId}
      className={cn("relative mt-2 rounded-card border-[0.5px] bg-surface px-3.5 pb-3 pt-3.5", entry.isNew ? "border-blue" : "border-hair")}
    >
      {entry.isNew ? (
        <span data-testid={`changelog-new-${entry.id}`} className="absolute right-3 top-3 rounded-lg bg-red-solid px-[7px] py-px text-[11px] font-bold text-white">
          {t("web.changelog.newBadge")}
        </span>
      ) : null}
      <div className="flex items-center gap-2 text-meta text-ink-3">
        <b className="font-semibold text-ink-2">{formatDay(entry.entryDate, language)}</b>
        {version ? <span>{version}</span> : null}
      </div>
      <h3 id={titleId} className="mt-1 pr-10 text-[17px] font-semibold tracking-[-0.01em] text-ink">
        {pickText(language, entry.titleZh, entry.titleEn)}
      </h3>
      <ul className="mt-2">
        {shown.map((item, i) => (
          <li key={i} className="flex gap-2 py-[3px] text-[14px] leading-[1.55] text-ink">
            <span className={cn(CHIP, TAG_CLASS[item.tag])}>{t(`web.changelog.tag.${item.tag}`)}</span>
            <span className="min-w-0 flex-1">{pickText(language, item.zh, item.en)}</span>
          </li>
        ))}
      </ul>
      {foldable ? (
        <button
          type="button"
          data-testid={`changelog-more-${entry.id}`}
          aria-expanded={expanded}
          onClick={() => setToggled(!expanded)}
          className="mt-1.5 inline-flex min-h-[32px] items-center gap-0.5 rounded-button text-[13px] text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? t("web.changelog.collapse") : t("web.changelog.expandAll", { count: entry.items.length })}
          {expanded ? <ChevronUpIcon aria-hidden className="h-3.5 w-3.5" /> : <ChevronDownIcon aria-hidden className="h-3.5 w-3.5" />}
        </button>
      ) : null}
    </article>
  );
}
```

注意:`bg-red-solid` 是 `tailwind.config.cjs` 里 `red.solid` 令牌(`rgb("red-solid")`,深浅色都是 `224 49 60`),`text-ink-3` 是同文件的 `ink.3` 令牌(`--ink-3`),`rounded-card`、`px-gutter`、`text-meta`、`text-sub`、`h-tap` / `min-h-tap` 在别的页面已在用;写计划时都读过。

`changelog-page.tsx`:

```tsx
import { CloudOffIcon, SparklesIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { useAuth } from "~/auth/auth-context";
import { PageHeader } from "~/layout/page-header";
import "./changelog.css";
import { EntryCard } from "./entry-card";
import { filterByTag, formatMonth, groupByMonth, presentTags, type TagFilter } from "./entries";
import "./locales";
import { markSeen, seenDelayMs } from "./unread-store";
import { useChangelogList } from "./use-changelog-list";
import { useNearEnd } from "./use-near-end";

const CHIP_BASE = "h-8 flex-none rounded-full px-[13px] text-[13px] transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const RETRY = "min-h-tap rounded-button px-4 font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Skeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t("web.common.loading")} data-testid="changelog-loading" className="mt-2 space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-card border-[0.5px] border-hair bg-surface p-3.5">
          <div className="h-3.5 w-[30%] rounded-[7px] bg-surface-2" />
          <div className="mt-2 h-[18px] w-[70%] rounded-[7px] bg-surface-2" />
          <div className="mt-2 h-3.5 rounded-[7px] bg-surface-2" />
          <div className="mt-2 h-3.5 w-[85%] rounded-[7px] bg-surface-2" />
        </div>
      ))}
    </div>
  );
}

function StateNote({ testId, icon, message, action }: { testId: string; icon: ReactNode; message: string; action?: ReactNode }) {
  return (
    <div data-testid={testId} className="flex flex-col items-center gap-2 px-6 py-14 text-center text-sub text-ink-2 [&_svg]:h-10 [&_svg]:w-10 [&_svg]:text-ink-3">
      {icon}
      <p>{message}</p>
      {action}
    </div>
  );
}

/**
 * 更新日志页 `/practice/changelog`(spec 2026-10-14-changelog §2.2、计划 R-17):按月份分组(最新在上)、类型筛选、首条展开、
 * 未读卡片带「新」角标、超过 2 条默认折叠、分页(滚动自动加载 + 「加载更多」按钮兜底)、骨架 / 空 / 失败重试 / 离线缓存。
 * 打开后 1 秒把已读位置报给服务端(提前离开就不报;离线缓存不报)。
 */
export function ChangelogPage() {
  const { t, i18n } = useTranslation();
  const { api, user } = useAuth();
  const userId = user?.id ?? null;
  const list = useChangelogList();
  const [tag, setTag] = useState<TagFilter>("all");

  useEffect(() => {
    if (list.status !== "ready" || list.offline || list.latestId === null) return;
    const latest = list.latestId;
    const timer = window.setTimeout((): void => { void markSeen(api, userId, latest); }, seenDelayMs());
    return () => window.clearTimeout(timer);
  }, [api, userId, list.status, list.offline, list.latestId]);

  const tags = useMemo(() => presentTags(list.entries), [list.entries]);
  const activeTag: TagFilter = tag !== "all" && tags.includes(tag) ? tag : "all";
  const shown = useMemo(() => filterByTag(list.entries, activeTag), [list.entries, activeTag]);
  const months = useMemo(() => groupByMonth(shown), [shown]);
  const sentinel = useNearEnd(list.loadMore, list.hasMore && !list.loadingMore && !list.moreFailed);
  const firstId = shown[0]?.id;

  let body: ReactNode;
  if (list.status === "loading") {
    body = <Skeleton />;
  } else if (list.status === "error") {
    body = (
      <StateNote testId="changelog-error" icon={<CloudOffIcon aria-hidden />} message={t("web.changelog.error")}
        action={<button type="button" data-testid="changelog-retry" onClick={list.reload} className={RETRY}>{t("web.common.retry")}</button>} />
    );
  } else if (list.entries.length === 0) {
    body = <StateNote testId="changelog-empty" icon={<SparklesIcon aria-hidden />} message={t("web.changelog.empty")} />;
  } else {
    body = (
      <>
        {list.offline ? (
          <p data-testid="changelog-offline" className="mt-2 flex items-center gap-2 rounded-button bg-surface-2 px-3 py-2 text-meta text-ink-2">
            <CloudOffIcon aria-hidden className="h-4 w-4 flex-none" />
            <span className="min-w-0 flex-1">{t("web.changelog.offline")}</span>
            <button type="button" onClick={list.reload} className="flex-none font-semibold text-blue">{t("web.common.retry")}</button>
          </p>
        ) : null}
        {tags.length >= 2 ? (
          <div role="group" aria-label={t("web.changelog.filters")} className="-mx-gutter flex gap-2 overflow-x-auto px-gutter pb-2 pt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(["all", ...tags] as TagFilter[]).map((value) => (
              <button key={value} type="button" aria-pressed={activeTag === value} onClick={() => setTag(value)}
                className={cn(CHIP_BASE, activeTag === value ? "bg-blue-tint font-semibold text-blue" : "bg-surface-2 text-ink-2")}>
                {value === "all" ? t("web.changelog.all") : t(`web.changelog.tag.${value}`)}
              </button>
            ))}
          </div>
        ) : null}
        {months.length === 0 ? (
          <p data-testid="changelog-no-match" className="px-6 py-10 text-center text-sub text-ink-2">{t("web.changelog.noMatch")}</p>
        ) : (
          months.map((group) => (
            <section key={group.key} aria-label={formatMonth(group.key, i18n.language)}>
              <h2 data-testid="changelog-month" className="mx-0.5 mb-0 mt-4 text-meta font-semibold tracking-[0.04em] text-ink-2">
                {formatMonth(group.key, i18n.language)}
              </h2>
              {group.entries.map((entry) => (
                <EntryCard key={entry.id} entry={entry} language={i18n.language} defaultExpanded={entry.id === firstId} />
              ))}
            </section>
          ))
        )}
        {list.hasMore ? (
          <div ref={sentinel} className="mt-3 flex justify-center">
            <button type="button" data-testid="changelog-load-more" disabled={list.loadingMore} onClick={list.loadMore} className={RETRY}>
              {list.moreFailed ? t("web.changelog.loadMoreFailed") : t("web.changelog.loadMore")}
            </button>
          </div>
        ) : !list.offline ? (
          <p data-testid="changelog-end" className="my-4 text-center text-meta text-ink-3">{t("web.changelog.end")}</p>
        ) : null}
      </>
    );
  }

  return (
    <div data-testid="changelog-page" className="flex flex-1 flex-col">
      <PageHeader title={t("web.changelog.title")} back="/practice" />
      <div className="px-gutter pb-6">{body}</div>
    </div>
  );
}
```

`lazy-pages.tsx`:

```tsx
import { LoaderIcon } from "lucide-react";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

/** 日志页按路由懒加载(计划 R-3,同 library/lazy-pages.tsx):页面、文案、样式都在懒加载块里,主包只有这个包装。 */
function PageLoading() {
  const { t } = useTranslation();
  return (
    <div data-testid="changelog-page-loading" className="flex justify-center py-16 text-ink-2">
      <LoaderIcon className="size-5 animate-spin" aria-label={t("web.common.loading")} />
    </div>
  );
}

const Page = lazy(async () => ({ default: (await import("./changelog-page")).ChangelogPage }));

export function ChangelogPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Page />
    </Suspense>
  );
}
```

`index.ts`:

```ts
// changelog 的公共接口(计划 2026-10-14-changelog):其他目录只能从这里引入(src/architecture.test.ts 约束)。
// 页面按路由懒加载(lazy-pages.tsx);练习页顶栏的入口经扩展点 `practiceHeaderActions` 贡献(register.tsx,只被 plugins/core.ts 导入),
// 不在这里导出。不要在这里静态导出页面模块、api、store、文案或样式。
export { ChangelogPage } from "./lazy-pages";
```

`web/src/app.tsx`(Edit 单行):
- `import { LibraryListPage, LibraryPlayerPage } from "~/features/library";` → 同一行 + 下一行 `import { ChangelogPage } from "~/features/changelog";`
- `            <Route path="/practice/list" element={<PracticeListPage />} />` → 同一行 + 下一行 `            <Route path="/practice/changelog" element={<ChangelogPage />} />`

- [ ] **Step 4: 跑测试,全绿。**
  `cd web && yarn vitest run src/features/changelog src/architecture.test.ts src/plugins`(日志页测试里 `findBy*` 默认 1 秒超时,冷编译慢时给 `changelog-page.test.tsx` 的 `findByTestId` 统一加 `{}, { timeout: 5000 }`,不改断言)。类型检查 `yarn web:typecheck` 只在用户要求时。

- [ ] **Step 5: 提交**(`git add web/src/features/changelog web/src/app.tsx`):

```
feat(web): changelog page with filters, pagination and offline cache

/practice/changelog (lazy): month groups, type filter, first card open, New badges from the server,
IntersectionObserver plus a Load more button, skeleton / empty / failure with retry, a saved first page
when offline. The read position is reported one second after the page opens.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

## 管理端任务组(A)

> 管理端是桌面专用(`AppShell` 已对 < 1024px 渲染 `DesktopOnly`)。测试用 vitest + Testing Library;页面测试用 `vi.mock("./api", importOriginal …)` 保留 `TAGS` 常量(自动 mock 会把数组清空),角色用 `vi.spyOn(session, "useAdminSession")`(同 `ops/announcements-page.test.tsx`)。

### Task A1: 接口客户端、文案、导航图标(含契约测试)

**Files:**(新建在 `admin/src/features/changelog/`)`api.ts`、`api.test.ts`、`strings.ts`、`changelog-icon.tsx`、`index.ts`

**Interfaces:**
- Produces(`./api`):`TAGS`、`ChangelogTag`、`ChangelogItem`、`EntryStatus`、`ChangelogEntry`、`ChangelogInput`、`listEntries()`、`createEntry(input)`、`updateEntry(id, input)`、`publishEntry(id)`、`unpublishEntry(id)`、`deleteEntry(id)`(snake → camel 手工映射,同 `ops/api.ts`)。
- Produces(`./strings`):`S`(zh-CN,A2 的页面与 `components/layout.tsx` 的导航项共用 `S.title`)。

- [ ] **Step 1: 写失败测试** — `admin/src/features/changelog/api.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../../api/client";
import { createEntry, deleteEntry, listEntries, publishEntry, unpublishEntry, updateEntry, type ChangelogInput } from "./api";

vi.mock("../../api/client", () => ({ request: vi.fn() }));

/** 契约(计划 R-13):`server/tests/fixtures/changelog_contract.json` 由 `test_changelog_contract.py` 录制。 */
const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(path.resolve(here, "../../../../server/tests/fixtures/changelog_contract.json"), "utf8")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const STAMP = "2026-10-14T00:00:00+00:00";

const input: ChangelogInput = {
  entryDate: "2026-10-14", version: "v1.12", titleZh: "标题", titleEn: "Title",
  items: [{ tag: "fix", zh: "修好了", en: "Fixed" }],
};
const wire = { entry_date: "2026-10-14", version: "v1.12", title_zh: "标题", title_en: "Title", items: [{ tag: "fix", zh: "修好了", en: "Fixed" }] };

beforeEach(() => vi.mocked(request).mockReset());

describe("changelog admin api", () => {
  it("lists entries and maps the recorded wire shape to camelCase", async () => {
    vi.mocked(request).mockResolvedValue(contract.admin_list);
    const entries = await listEntries();
    expect(request).toHaveBeenCalledWith("/api/admin/changelog");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      id: 2, status: "published", entryDate: "2026-10-14", version: "v1.12", titleZh: "第二条", titleEn: "第二条 (en)",
      items: [{ tag: "new", zh: "新功能一句话", en: "A new thing" }, { tag: "library", zh: "跟读库一句话", en: "" }],
      createdBy: "operator1", createdAt: STAMP, updatedAt: STAMP, publishedAt: STAMP,
    });
    expect(entries[1].version).toBeNull();
  });

  it("maps a draft: no published time", async () => {
    vi.mocked(request).mockResolvedValue({ entries: [{ ...contract.admin_entry, status: "draft", published_at: null }] });
    expect((await listEntries())[0]).toMatchObject({ status: "draft", publishedAt: null });
  });

  it("creates with snake_case keys", async () => {
    vi.mocked(request).mockResolvedValue(contract.admin_entry);
    expect((await createEntry(input)).id).toBe(2);
    expect(request).toHaveBeenCalledWith("/api/admin/changelog", { method: "POST", json: wire });
  });

  it("updates, publishes, unpublishes and deletes by id", async () => {
    vi.mocked(request).mockResolvedValue(contract.admin_entry);
    await updateEntry(5, input);
    expect(request).toHaveBeenLastCalledWith("/api/admin/changelog/5", { method: "PATCH", json: wire });
    await publishEntry(5);
    expect(request).toHaveBeenLastCalledWith("/api/admin/changelog/5/publish", { method: "POST" });
    await unpublishEntry(5);
    expect(request).toHaveBeenLastCalledWith("/api/admin/changelog/5/unpublish", { method: "POST" });
    vi.mocked(request).mockResolvedValue({ id: 5, deleted: true });
    await expect(deleteEntry(5)).resolves.toBeUndefined();
    expect(request).toHaveBeenLastCalledWith("/api/admin/changelog/5", { method: "DELETE" });
  });
});
```

- [ ] **Step 2: 看它失败。** `cd admin && yarn vitest run src/features/changelog` → 模块不存在。

- [ ] **Step 3: 实现。**

`api.ts`:

```ts
import { request } from "../../api/client";

/** 更新日志管理接口(/api/admin/changelog)。snake_case → camelCase,形状见 server/tests/fixtures/changelog_contract.json。 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const TAGS = ["new", "improve", "fix", "library", "other"] as const;
export type ChangelogTag = (typeof TAGS)[number];
export type EntryStatus = "draft" | "published";

export interface ChangelogItem {
  tag: ChangelogTag;
  zh: string;
  en: string;
}

export interface ChangelogEntry {
  id: number;
  status: EntryStatus;
  entryDate: string;
  version: string | null;
  titleZh: string;
  titleEn: string;
  items: ChangelogItem[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface ChangelogInput {
  entryDate: string;
  version: string | null;
  titleZh: string;
  titleEn: string;
  items: ChangelogItem[];
}

const toEntry = (r: any): ChangelogEntry => ({
  id: r.id,
  status: r.status === "published" ? "published" : "draft",
  entryDate: r.entry_date,
  version: r.version ?? null,
  titleZh: r.title_zh,
  titleEn: r.title_en ?? "",
  items: (r.items ?? []).map((i: any) => ({ tag: i.tag, zh: i.zh, en: i.en ?? "" })),
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  publishedAt: r.published_at ?? null,
});

const fromInput = (d: ChangelogInput) => ({
  entry_date: d.entryDate,
  version: d.version,
  title_zh: d.titleZh,
  title_en: d.titleEn,
  items: d.items.map((i) => ({ tag: i.tag, zh: i.zh, en: i.en })),
});

export async function listEntries(): Promise<ChangelogEntry[]> {
  const r = await request<{ entries: any[] }>("/api/admin/changelog");
  return r.entries.map(toEntry);
}

export async function createEntry(data: ChangelogInput): Promise<ChangelogEntry> {
  return toEntry(await request("/api/admin/changelog", { method: "POST", json: fromInput(data) }));
}

export async function updateEntry(id: number, data: ChangelogInput): Promise<ChangelogEntry> {
  return toEntry(await request(`/api/admin/changelog/${id}`, { method: "PATCH", json: fromInput(data) }));
}

export async function publishEntry(id: number): Promise<ChangelogEntry> {
  return toEntry(await request(`/api/admin/changelog/${id}/publish`, { method: "POST" }));
}

export async function unpublishEntry(id: number): Promise<ChangelogEntry> {
  return toEntry(await request(`/api/admin/changelog/${id}/unpublish`, { method: "POST" }));
}

export async function deleteEntry(id: number): Promise<void> {
  await request(`/api/admin/changelog/${id}`, { method: "DELETE" });
}
```

`strings.ts`:

```ts
/** features/changelog 的界面文案(zh-CN);`components/layout.tsx` 的导航项也用 `S.title`。 */
export const S = {
  title: "更新日志",
  create: "新建",
  list: "更新列表",
  filter: "状态筛选",
  all: "全部",
  empty: "还没有更新日志",
  pickOne: "从左边选一条来编辑,或新建一条。",
  intro: "这里写的日志会显示在手机端练习页顶栏的「更新日志」里。草稿用户看不到;发布后才会出现并产生未读红点。",
  status: { draft: "草稿", published: "已发布" },
  tags: { new: "新功能", improve: "改进", fix: "修复", library: "跟读库", other: "其他" },
  untitled: "(无标题)",
  readOnly: "只读:需要「运营」及以上角色才能修改。",
  editor: {
    createTitle: "新建更新",
    editTitle: "编辑更新",
    date: "发布日期",
    version: "版本号(可选)",
    lang: "语言",
    zh: "中文",
    en: "English",
    title: "标题",
    items: "条目(每条一个类型标签)",
    tag: (n: number) => `类型 ${n}`,
    text: (n: number) => `条目 ${n} 文字`,
    remove: (n: number) => `删除条目 ${n}`,
    add: "+ 添加条目",
    count: (n: number, max: number) => `${n}/${max}`,
    preview: "预览",
    save: "保存",
    publish: "发布",
    unpublish: "下架",
    remove_entry: "删除",
    note: "发布后所有用户可见;只有「已发布」的会出现在手机端并产生未读红点。每次发布 / 下架 / 修改都会写入审计。英文版留空时,英文用户看到中文。",
    order: "提示:按日期从早到晚逐条发布,用户的未读红点最准确。",
    invalid: {
      date: "请填写发布日期",
      version: "版本号最多 24 个字符,只能含字母、数字和 . _ + -",
      title: "请填写中文标题(最多 80 字)",
      titleEn: "英文标题最多 80 字",
      items: "条目要有 1 到 20 条",
      itemZh: (n: number) => `第 ${n} 条的中文不能为空(最多 200 字)`,
      itemEn: (n: number) => `第 ${n} 条的英文最多 200 字`,
    },
  },
  confirm: {
    publishTitle: "发布这条更新?",
    publishBody: "发布后所有用户都能看到,并在练习页顶栏出现未读红点。",
    unpublishTitle: "下架这条更新?",
    unpublishBody: "下架后用户看不到它,条目回到草稿。",
    deleteTitle: "删除这条更新?",
    deleteBody: "删除后无法恢复;已发布的条目会立即对用户消失。",
  },
};
```

`changelog-icon.tsx`:

```tsx
import type { SVGProps } from "react";

/** 导航「更新日志」:星花(与网页端入口同一个意象;1.75 描边、24 视框,同 components/icons)。 */
export const ChangelogIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
    <path d="M18.5 15v4M16.5 17h4" />
    <path d="M5.5 15.5v3M4 17h3" />
  </svg>
);
```

`index.ts`(A2 再加一行页面导出):

```ts
/** features/changelog 的公开出口(app.tsx 只从这里导入;layout 只导入 strings / changelog-icon,避免循环)。 */
export * from "./api";
```

- [ ] **Step 4: 跑测试,全绿。** `cd admin && yarn vitest run src/features/changelog/api.test.ts`;`yarn workspace admin typecheck` 只在用户要求时。

- [ ] **Step 5: 提交**(`git add admin/src/features/changelog`):

```
feat(admin): changelog api client, strings and nav icon

Maps the recorded server contract; list, create, edit, publish, unpublish and delete by id.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

### Task A2: 管理页(列表、编辑器、预览)、导航与路由

**Files:**(新建在 `admin/src/features/changelog/`)`entry-preview.tsx`、`entry-editor.tsx`、`changelog-page.tsx`、`changelog-page.test.tsx`;Modify:`admin/src/features/changelog/index.ts`、`admin/src/components/layout.tsx`、`admin/src/app.tsx`

**Interfaces:**
- Produces(`./index`):`ChangelogPage`。
- 导航:配置组、「公告与维护」之后,`{ to: "/changelog", label: "更新日志", min: "viewer" }`;路由 `/changelog`。

- [ ] **Step 1: 写失败测试** — `admin/src/features/changelog/changelog-page.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import * as api from "./api";
import { ChangelogPage } from "./changelog-page";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  listEntries: vi.fn(), createEntry: vi.fn(), updateEntry: vi.fn(), publishEntry: vi.fn(), unpublishEntry: vi.fn(), deleteEntry: vi.fn(),
}));

const STAMP = "2026-10-14T00:00:00+00:00";
const sessionOf = (role: "viewer" | "operator") => ({
  username: "u", role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null, totpEnabled: true, safeMode: false,
  maintenanceMode: "off" as const,
});
const entry = (id: number, status: api.EntryStatus, entryDate: string, titleZh: string, over: Partial<api.ChangelogEntry> = {}): api.ChangelogEntry => ({
  id, status, entryDate, version: null, titleZh, titleEn: "", items: [{ tag: "new", zh: `${titleZh}的内容`, en: "" }], createdBy: "operator1",
  createdAt: STAMP, updatedAt: STAMP, publishedAt: status === "published" ? STAMP : null, ...over,
});
const LIST = [
  entry(3, "draft", "2026-10-14", "草稿标题"),
  entry(2, "published", "2026-10-13", "已发布标题", { version: "v1.12", titleEn: "Published title" }),
  entry(1, "published", "2026-10-11", "更早的标题"),
];

const open = async () => {
  render(<MemoryRouter><ChangelogPage /></MemoryRouter>);
  await screen.findByRole("list", { name: "更新列表" });
};
const row = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.mocked(api.listEntries).mockReset().mockResolvedValue(LIST);
  for (const fn of [api.createEntry, api.updateEntry, api.publishEntry, api.unpublishEntry, api.deleteEntry]) vi.mocked(fn).mockReset();
  vi.mocked(api.createEntry).mockResolvedValue(entry(9, "draft", "2026-10-14", "新的标题"));
  vi.mocked(api.publishEntry).mockResolvedValue(entry(3, "published", "2026-10-14", "草稿标题"));
  vi.mocked(api.unpublishEntry).mockResolvedValue(entry(2, "draft", "2026-10-13", "已发布标题"));
  vi.mocked(api.deleteEntry).mockResolvedValue(undefined);
  vi.spyOn(session, "useAdminSession").mockReturnValue(sessionOf("operator"));
});

describe("ChangelogPage", () => {
  it("lists drafts and published entries with status badges and filters by status", async () => {
    await open();
    const list = screen.getByRole("list", { name: "更新列表" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("草稿")).toBeInTheDocument();
    expect(within(list).getAllByText("已发布")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "草稿" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "已发布" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows an empty state when there is nothing yet", async () => {
    vi.mocked(api.listEntries).mockResolvedValue([]);
    render(<MemoryRouter><ChangelogPage /></MemoryRouter>);
    expect(await screen.findByText("还没有更新日志")).toBeInTheDocument();
  });

  it("shows a failure with a retry", async () => {
    vi.mocked(api.listEntries).mockReset().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(LIST);
    render(<MemoryRouter><ChangelogPage /></MemoryRouter>);
    expect(await screen.findByText("boom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("list", { name: "更新列表" })).toBeInTheDocument();
  });

  it("opens an entry in the editor with its values", async () => {
    await open();
    await userEvent.click(row(/已发布标题/));
    expect(screen.getByLabelText("发布日期")).toHaveValue("2026-10-13");
    expect(screen.getByLabelText("版本号(可选)")).toHaveValue("v1.12");
    expect(screen.getByLabelText("标题")).toHaveValue("已发布标题");
    expect(screen.getByLabelText("条目 1 文字")).toHaveValue("已发布标题的内容");
    expect(screen.getByLabelText("类型 1")).toHaveValue("new");
    expect(screen.getByRole("button", { name: "下架" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发布" })).toBeNull();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled(); // nothing changed yet
  });

  it("creates a draft from the form with trimmed values", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "新建" }));
    fireEvent.change(screen.getByLabelText("发布日期"), { target: { value: "2026-10-14" } });
    await userEvent.type(screen.getByLabelText("标题"), "  新的标题 ");
    await userEvent.type(screen.getByLabelText("条目 1 文字"), "新的一句");
    await userEvent.selectOptions(screen.getByLabelText("类型 1"), "fix");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.createEntry).toHaveBeenCalledTimes(1));
    expect(api.createEntry).toHaveBeenCalledWith({
      entryDate: "2026-10-14", version: null, titleZh: "新的标题", titleEn: "", items: [{ tag: "fix", zh: "新的一句", en: "" }],
    });
    await waitFor(() => expect(api.listEntries).toHaveBeenCalledTimes(2)); // the list reloads
  });

  it("edits the English title and item text with the language switch", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "新建" }));
    fireEvent.change(screen.getByLabelText("发布日期"), { target: { value: "2026-10-14" } });
    await userEvent.type(screen.getByLabelText("标题"), "中文标题");
    await userEvent.type(screen.getByLabelText("条目 1 文字"), "中文句子");
    await userEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(screen.getByLabelText("标题")).toHaveValue("");
    await userEvent.type(screen.getByLabelText("标题"), "English title");
    await userEvent.type(screen.getByLabelText("条目 1 文字"), "English sentence");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(api.createEntry).toHaveBeenCalled());
    expect(api.createEntry).toHaveBeenCalledWith(expect.objectContaining({
      titleZh: "中文标题", titleEn: "English title", items: [{ tag: "new", zh: "中文句子", en: "English sentence" }],
    }));
  });

  it("keeps save disabled until the form is valid and caps the items at 20", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "新建" }));
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发布" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("标题"), "标题");
    await userEvent.type(screen.getByLabelText("条目 1 文字"), "一句");
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    const add = screen.getByRole("button", { name: "+ 添加条目" });
    for (let i = 0; i < 19; i += 1) await userEvent.click(add);
    expect(screen.getAllByLabelText(/^条目 \d+ 文字$/)).toHaveLength(20);
    expect(add).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled(); // 19 empty rows are invalid
    await userEvent.click(screen.getByRole("button", { name: "删除条目 20" }));
    expect(add).toBeEnabled();
  });

  it("publishes a draft after confirmation, saving first when the form changed", async () => {
    vi.mocked(api.updateEntry).mockResolvedValue(entry(3, "draft", "2026-10-14", "改过的标题"));
    await open();
    await userEvent.click(row(/草稿标题/));
    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("发布这条更新?")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "发布" }));
    await waitFor(() => expect(api.publishEntry).toHaveBeenCalledWith(3));
    expect(api.updateEntry).not.toHaveBeenCalled();
    // the same again with an unsaved change
    await userEvent.click(row(/草稿标题/));
    await userEvent.clear(screen.getByLabelText("标题"));
    await userEvent.type(screen.getByLabelText("标题"), "改过的标题");
    await userEvent.click(screen.getByRole("button", { name: "发布" }));
    dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "发布" }));
    await waitFor(() => expect(api.updateEntry).toHaveBeenCalledWith(3, expect.objectContaining({ titleZh: "改过的标题" })));
    expect(api.publishEntry).toHaveBeenCalledTimes(2);
  });

  it("unpublishes and deletes after confirmation", async () => {
    await open();
    await userEvent.click(row(/已发布标题/));
    await userEvent.click(screen.getByRole("button", { name: "下架" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "下架" }));
    await waitFor(() => expect(api.unpublishEntry).toHaveBeenCalledWith(2));
    await userEvent.click(row(/已发布标题/));
    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(within(screen.getByRole("dialog")).getByText("删除这条更新?")).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(api.deleteEntry).toHaveBeenCalledWith(2));
  });

  it("previews the phone card and falls back to Chinese when the English text is empty", async () => {
    await open();
    await userEvent.click(row(/已发布标题/));
    await userEvent.click(screen.getByRole("button", { name: "预览" }));
    const preview = screen.getByTestId("changelog-preview");
    expect(within(preview).getByText("已发布标题")).toBeInTheDocument();
    expect(within(preview).getByText("新功能")).toBeInTheDocument();
    expect(within(preview).getByText(/v1\.12/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(within(screen.getByTestId("changelog-preview")).getByText("Published title")).toBeInTheDocument();
    expect(within(screen.getByTestId("changelog-preview")).getByText("已发布标题的内容")).toBeInTheDocument(); // English item blank -> Chinese
  });

  it("is read-only for a viewer", async () => {
    vi.spyOn(session, "useAdminSession").mockReturnValue(sessionOf("viewer"));
    await open();
    expect(screen.queryByRole("button", { name: "新建" })).toBeNull();
    await userEvent.click(row(/已发布标题/));
    expect(screen.getByLabelText("标题")).toBeDisabled();
    expect(screen.getByLabelText("条目 1 文字")).toBeDisabled();
    for (const name of ["保存", "发布", "下架", "删除"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.getByText(/需要「运营」及以上角色/)).toBeInTheDocument();
  });

  it("is in the navigation for every role, after announcements", async () => {
    const { NAV } = await import("../../components/layout");
    const config = NAV.find((g) => g.group === "配置");
    expect(config?.items.find((i) => i.to === "/changelog")).toMatchObject({ label: "更新日志", min: "viewer" });
    const paths = config!.items.map((i) => i.to);
    expect(paths.indexOf("/changelog")).toBe(paths.indexOf("/announcements") + 1);
  });
});
```

- [ ] **Step 2: 看它失败。** `cd admin && yarn vitest run src/features/changelog` → 缺 `changelog-page`。

- [ ] **Step 3: 实现。**

`entry-preview.tsx`:

```tsx
import type { ChangelogItem, ChangelogTag } from "./api";
import { S } from "./strings";

const TAG_CLASS: Record<ChangelogTag, string> = {
  new: "bg-accent-soft text-accent",
  improve: "bg-good-soft text-good",
  fix: "bg-warn-soft text-warn",
  library: "bg-violet-100 text-violet-700",
  other: "bg-sunken text-fg-2",
};

export type PreviewLang = "zh" | "en";

/** 与网页端 pickText 同一规则:中文取中文;英文为空回退中文(spec D4)。 */
export const pick = (lang: PreviewLang, zh: string, en: string): string => (lang === "zh" ? zh || en : en || zh);

const versionText = (version: string): string => (/^\d/.test(version) ? `v${version}` : version);

/** 手机端日志卡的只读预览(宽 375,同 mockup 的卡片)。 */
export function EntryPreview({ lang, entryDate, version, titleZh, titleEn, items }: {
  lang: PreviewLang;
  entryDate: string;
  version: string;
  titleZh: string;
  titleEn: string;
  items: ChangelogItem[];
}) {
  const v = version.trim();
  return (
    <div data-testid="changelog-preview" className="w-[375px] max-w-full rounded-2xl border border-line bg-surface p-3.5">
      <p className="text-xs text-muted">
        <b className="font-semibold text-fg-2">{entryDate || "—"}</b>
        {v ? ` · ${versionText(v)}` : ""}
      </p>
      <h3 className="mt-1 text-md font-semibold">{pick(lang, titleZh.trim(), titleEn.trim()) || S.untitled}</h3>
      <ul className="mt-2 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className={`badge flex-none ${TAG_CLASS[item.tag]}`}>{S.tags[item.tag]}</span>
            <span className="min-w-0 flex-1 break-words">{pick(lang, item.zh.trim(), item.en.trim()) || "…"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`entry-editor.tsx`:

```tsx
import { useState } from "react";
import { hasRole, useAdminSession } from "../../api/session";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { errorText } from "../../hooks/use-async";
import {
  TAGS, createEntry, deleteEntry, publishEntry, unpublishEntry, updateEntry,
  type ChangelogEntry, type ChangelogInput, type ChangelogItem, type ChangelogTag,
} from "./api";
import { EntryPreview, type PreviewLang } from "./entry-preview";
import { S } from "./strings";

export const MAX_ITEMS = 20;
export const MAX_TEXT = 200;
export const MAX_TITLE = 80;
export const MAX_VERSION = 24;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;
const E = S.editor;

export interface Form { entryDate: string; version: string; titleZh: string; titleEn: string; items: ChangelogItem[] }

const pad = (n: number) => String(n).padStart(2, "0");
const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const blank = (): Form => ({ entryDate: today(), version: "", titleZh: "", titleEn: "", items: [{ tag: "new", zh: "", en: "" }] });
const fromEntry = (e: ChangelogEntry): Form => ({
  entryDate: e.entryDate, version: e.version ?? "", titleZh: e.titleZh, titleEn: e.titleEn, items: e.items.map((i) => ({ ...i })),
});
const toInput = (f: Form): ChangelogInput => ({
  entryDate: f.entryDate.trim(),
  version: f.version.trim() || null,
  titleZh: f.titleZh.trim(),
  titleEn: f.titleEn.trim(),
  items: f.items.map((i) => ({ tag: i.tag, zh: i.zh.trim(), en: i.en.trim() })),
});

/** 与服务端 `changelog.validate` 同一套规则(服务端仍会再校验);返回要显示的问题。 */
export function problemsOf(f: Form): string[] {
  const input = toInput(f);
  const out: string[] = [];
  if (!DATE_RE.test(input.entryDate)) out.push(E.invalid.date);
  if (input.version !== null && (input.version.length > MAX_VERSION || !VERSION_RE.test(input.version))) out.push(E.invalid.version);
  if (!input.titleZh || input.titleZh.length > MAX_TITLE) out.push(E.invalid.title);
  if (input.titleEn.length > MAX_TITLE) out.push(E.invalid.titleEn);
  if (input.items.length < 1 || input.items.length > MAX_ITEMS) out.push(E.invalid.items);
  input.items.forEach((item, i) => {
    if (!item.zh || item.zh.length > MAX_TEXT) out.push(E.invalid.itemZh(i + 1));
    if (item.en.length > MAX_TEXT) out.push(E.invalid.itemEn(i + 1));
  });
  return out;
}

type Confirm = "publish" | "unpublish" | "delete" | null;

/**
 * 更新日志编辑器(spec D6、计划 R-19):日期、版本号、中英文标题、条目列表(类型下拉 + 一句话)、预览、保存 / 发布 / 下架 / 删除。
 * 操作员及以上可写;查看者只读。「发布」= 有改动(或新建)就先保存再发布。父组件用 key 在条目变化时重新挂载本组件。
 */
export function EntryEditor({ initial, onChanged, onDeleted }: {
  initial: ChangelogEntry | null;
  onChanged: (id: number) => void;
  onDeleted: () => void;
}) {
  const canWrite = hasRole(useAdminSession(), "operator");
  const [form, setForm] = useState<Form>(() => (initial ? fromEntry(initial) : blank()));
  const [baseline] = useState(() => JSON.stringify(toInput(initial ? fromEntry(initial) : blank())));
  const [lang, setLang] = useState<PreviewLang>("zh");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const problems = problemsOf(form);
  const valid = problems.length === 0;
  const dirty = JSON.stringify(toInput(form)) !== baseline;
  const published = initial?.status === "published";
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const setItem = (i: number, patch: Partial<ChangelogItem>) => set({ items: form.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const titleKey = lang === "zh" ? "titleZh" : "titleEn";

  const save = async () => {
    if (!valid || busy || !canWrite) return;
    setBusy(true);
    setError(null);
    try {
      const saved = initial ? await updateEntry(initial.id, toInput(form)) : await createEntry(toInput(form));
      onChanged(saved.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    let id = initial?.id;
    if (!initial || dirty) id = (initial ? await updateEntry(initial.id, toInput(form)) : await createEntry(toInput(form))).id;
    await publishEntry(id as number);
    setConfirm(null);
    onChanged(id as number);
  };

  return (
    <section className="panel space-y-4 p-4" aria-label={initial ? E.editTitle : E.createTitle}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-md font-semibold">{initial ? E.editTitle : E.createTitle}</h2>
        <div className="flex items-center gap-2">
          <button type="button" aria-pressed={preview} className="btn-ghost btn-sm" onClick={() => setPreview((p) => !p)}>{E.preview}</button>
          {canWrite && (
            <>
              <button type="button" className="btn-ghost btn-sm" disabled={!valid || !dirty || busy} onClick={() => void save()}>{E.save}</button>
              {published ? (
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setConfirm("unpublish")}>{E.unpublish}</button>
              ) : (
                <button type="button" className="btn-primary btn-sm" disabled={!valid || busy} onClick={() => setConfirm("publish")}>{E.publish}</button>
              )}
              {initial && <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setConfirm("delete")}>{E.remove_entry}</button>}
            </>
          )}
        </div>
      </div>
      {!canWrite && <p className="text-sm text-muted">{S.readOnly}</p>}

      <div className="grid grid-cols-[160px_140px] gap-3">
        <label className="space-y-1">
          <span className="block text-xs font-medium text-fg-2">{E.date}</span>
          <input type="date" className="field-sm" value={form.entryDate} disabled={!canWrite} onChange={(e) => set({ entryDate: e.target.value })} />
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-medium text-fg-2">{E.version}</span>
          <input className="field-sm" value={form.version} maxLength={MAX_VERSION} disabled={!canWrite} onChange={(e) => set({ version: e.target.value })} />
        </label>
      </div>

      <div role="radiogroup" aria-label={E.lang} className="inline-flex gap-0.5 rounded-lg bg-sunken p-0.5">
        {(["zh", "en"] as const).map((l) => (
          <button key={l} type="button" role="radio" aria-checked={l === lang} onClick={() => setLang(l)}
            className={`min-h-[30px] min-w-[72px] rounded-[7px] px-3 text-sm font-medium ${l === lang ? "bg-surface text-fg shadow-card" : "text-muted"}`}>
            {l === "zh" ? E.zh : E.en}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs font-medium text-fg-2">
          <label htmlFor="changelog-title">{E.title}</label>
          <span className="num">{E.count(form[titleKey].length, MAX_TITLE)}</span>
        </div>
        <input id="changelog-title" className="field-sm" value={form[titleKey]} disabled={!canWrite} maxLength={MAX_TITLE + 20}
          onChange={(e) => set({ [titleKey]: e.target.value } as Partial<Form>)} />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-fg-2">{E.items}</p>
        {form.items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <select aria-label={E.tag(i + 1)} className="field-sm w-[104px]" value={item.tag} disabled={!canWrite}
              onChange={(e) => setItem(i, { tag: e.target.value as ChangelogTag })}>
              {TAGS.map((t) => <option key={t} value={t}>{S.tags[t]}</option>)}
            </select>
            <input aria-label={E.text(i + 1)} className="field-sm flex-1" value={lang === "zh" ? item.zh : item.en} disabled={!canWrite}
              maxLength={MAX_TEXT + 20} onChange={(e) => setItem(i, lang === "zh" ? { zh: e.target.value } : { en: e.target.value })} />
            <span className="num w-[52px] text-right text-xs text-muted">{E.count((lang === "zh" ? item.zh : item.en).length, MAX_TEXT)}</span>
            {canWrite && (
              <button type="button" aria-label={E.remove(i + 1)} className="btn-quiet btn-sm" disabled={form.items.length <= 1}
                onClick={() => set({ items: form.items.filter((_, j) => j !== i) })}>×</button>
            )}
          </div>
        ))}
        {canWrite && (
          <button type="button" className="btn-quiet btn-sm text-accent" disabled={form.items.length >= MAX_ITEMS}
            onClick={() => set({ items: [...form.items, { tag: "new", zh: "", en: "" }] })}>{E.add}</button>
        )}
      </div>

      {preview && <EntryPreview lang={lang} entryDate={form.entryDate} version={form.version} titleZh={form.titleZh} titleEn={form.titleEn} items={form.items} />}
      {canWrite && !valid && dirty && <p role="note" className="text-xs text-warn">{problems[0]}</p>}
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">{error}</p>}
      <p className="text-xs leading-relaxed text-muted">{E.note}</p>
      <p className="text-xs leading-relaxed text-muted">{E.order}</p>

      <ConfirmDialog open={confirm === "publish"} title={S.confirm.publishTitle} body={S.confirm.publishBody} confirmText={E.publish}
        onConfirm={publish} onClose={() => setConfirm(null)} />
      <ConfirmDialog open={confirm === "unpublish"} title={S.confirm.unpublishTitle} body={S.confirm.unpublishBody} confirmText={E.unpublish}
        onConfirm={async () => {
          await unpublishEntry((initial as ChangelogEntry).id);
          setConfirm(null);
          onChanged((initial as ChangelogEntry).id);
        }} onClose={() => setConfirm(null)} />
      <ConfirmDialog open={confirm === "delete"} title={S.confirm.deleteTitle} body={S.confirm.deleteBody} confirmText={E.remove_entry} danger
        onConfirm={async () => {
          await deleteEntry((initial as ChangelogEntry).id);
          setConfirm(null);
          onDeleted();
        }} onClose={() => setConfirm(null)} />
    </section>
  );
}
```

注:`btn-*`、`field-sm`、`panel`、`badge`、`num` 是 `admin/src/index.css` 现有工具类;`shadow-card` 来自 tailwind 配置。标题的 `<label>` 与计数分开放(计数在 label 里会让 `getByLabelText("标题")` 失配)。

`changelog-page.tsx`:

```tsx
import { useEffect, useState } from "react";
import { hasRole, useAdminSession } from "../../api/session";
import { Chips, Page } from "../../components/layout";
import { EmptyState, ErrorState, Skeleton } from "../../components/states";
import { errorText } from "../../hooks/use-async";
import { listEntries, type ChangelogEntry, type EntryStatus } from "./api";
import { EntryEditor } from "./entry-editor";
import { S } from "./strings";

type Filter = "all" | EntryStatus;

const BADGE: Record<EntryStatus, string> = { draft: "bg-warn-soft text-warn", published: "bg-good-soft text-good" };

/** 更新日志(spec D6):左列表(草稿 / 已发布)+ 右编辑器。查看者可读,操作员及以上可写;写操作都进审计(只记 id 与动作)。 */
export function ChangelogPage() {
  const canWrite = hasRole(useAdminSession(), "operator");
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | "new" | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    let live = true;
    setError(null);
    Promise.resolve(listEntries())
      .then((rows) => live && setEntries(rows ?? []))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [tick]);

  const shown = (entries ?? []).filter((e) => filter === "all" || e.status === filter);
  const current = typeof selected === "number" ? (entries ?? []).find((e) => e.id === selected) ?? null : null;

  return (
    <Page
      title={S.title}
      actions={canWrite ? <button type="button" className="btn-primary btn-sm" onClick={() => setSelected("new")}>{S.create}</button> : undefined}
    >
      <p className="text-sm text-fg-2">{S.intro}</p>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : entries === null ? (
        <Skeleton rows={3} />
      ) : entries.length === 0 && selected !== "new" ? (
        <EmptyState message={S.empty} />
      ) : (
        <div className="grid grid-cols-[340px_minmax(0,1fr)] items-start gap-4">
          <div className="space-y-3">
            <Chips<Filter> label={S.filter} value={filter} onChange={setFilter}
              options={[{ value: "all", label: S.all }, { value: "draft", label: S.status.draft }, { value: "published", label: S.status.published }]} />
            <ul aria-label={S.list} className="panel divide-y divide-line overflow-hidden">
              {shown.map((e) => (
                <li key={e.id}>
                  <button type="button" aria-current={selected === e.id ? "true" : undefined} onClick={() => setSelected(e.id)}
                    className={`block w-full px-3.5 py-3 text-left hover:bg-sunken ${selected === e.id ? "bg-accent-soft" : ""}`}>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      <span className="num">{e.entryDate}</span>
                      {e.version && <span>{e.version}</span>}
                      <span className={`badge ${BADGE[e.status]}`}>{S.status[e.status]}</span>
                    </span>
                    <span className="mt-0.5 block truncate font-semibold">{e.titleZh}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {selected === "new" ? (
            <EntryEditor key="new" initial={null} onChanged={(id) => { setSelected(id); reload(); }} onDeleted={() => undefined} />
          ) : current ? (
            <EntryEditor key={`${current.id}:${current.updatedAt}`} initial={current}
              onChanged={(id) => { setSelected(id); reload(); }} onDeleted={() => { setSelected(null); reload(); }} />
          ) : (
            <EmptyState message={S.pickOne} />
          )}
        </div>
      )}
    </Page>
  );
}
```

`index.ts`(追加一行):`export { ChangelogPage } from "./changelog-page";`

`admin/src/components/layout.tsx`(Edit 单行):
- `import { S as LIBRARY_STRINGS } from "../features/library/strings";` → 同一行 + 下面两行:
  `import { ChangelogIcon } from "../features/changelog/changelog-icon";`
  `import { S as CHANGELOG_STRINGS } from "../features/changelog/strings";`
- `      { to: "/announcements", label: I.announcements, icon: MegaphoneIcon, min: "operator" },` → 同一行 + 下一行 `      { to: "/changelog", label: CHANGELOG_STRINGS.title, icon: ChangelogIcon, min: "viewer" },`

`admin/src/app.tsx`(Edit 单行):
- `import { AgentsPage } from "./features/agents";` → 同一行 + 下一行 `import { ChangelogPage } from "./features/changelog";`
- `          <Route path="announcements" element={<AnnouncementsPage />} />` → 同一行 + 下一行 `          <Route path="changelog" element={<ChangelogPage />} />`

- [ ] **Step 4: 跑测试,全绿。** `cd admin && yarn vitest run src/features/changelog src/components/layout.test.tsx src/app.test.tsx src/features/links`(`links-page.test.tsx` 里有一个读 `NAV` 配置组的用例,确认没被新导航项影响)。

- [ ] **Step 5: 提交**(`git add admin/src/features/changelog admin/src/components/layout.tsx admin/src/app.tsx`):

```
feat(admin): changelog list, editor and preview

Left list (draft / published) and right editor: date, optional version, Chinese and English titles,
tagged one-sentence items, phone-card preview, save / publish / unpublish / delete with confirmation.
Operators write, viewers read. Navigation item after announcements.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

## 文档任务(D)

### Task D1: CLAUDE.md、README、起草规则、真机清单

**Files:**
- Create: `web/src/features/changelog/CLAUDE.md`、`admin/src/features/changelog/CLAUDE.md`、`docs/superpowers/plans/2026-10-14-changelog-device-checklist.md`
- Modify:`server/app/CLAUDE.md`、`server/app/admin/CLAUDE.md`、`server/app/routers/CLAUDE.md`、`server/tests/CLAUDE.md`、`docs/CLAUDE.md`、`web/src/lib/CLAUDE.md`、`web/src/plugins/CLAUDE.md`、`web/src/features/CLAUDE.md`、`web/src/features/practice/CLAUDE.md`、`web/README.md`(**不改根 `CLAUDE.md`**,见 Global Constraints)

- [ ] **Step 1: 修改现有文档**(Edit,单行锚点;锚点文本在写计划时读过,若与现状有出入,按语义插入同一位置):
  1. `server/app/CLAUDE.md`:把 `announcements/maintenance, backups, prompts` 替换为 `announcements/maintenance, changelog (entries, per-user read position, draft import), backups, prompts`;把 `is linear (head \`0019\`)` 替换为 `is linear (head \`0020\`)`。
  2. `server/app/admin/CLAUDE.md`:在 `- \`system.py\` – \`status(app, session)\` for \`GET /api/admin/system\`` 这一行**之前**插入两条 bullet:
     ```
     - `changelog.py` – 更新日志(spec 2026-10-14-changelog-design;plan `2026-10-14-changelog.md`):用户侧 `public_page`(已发布、按 `entry_date` 倒序、游标 `YYYY-MM-DD.<id>`、`unread` / `latest_id` / 逐条 `is_new`)与 `mark_seen`(已读位置只前进、夹到最大已发布 id、新用户首次最多 3 条未读);管理侧 `validate`(逐键、错误只回字段名)、`admin_listing`、`create` / `edit` / `publish` / `unpublish` / `remove`(软删除 `archived_at`),审计 `changelog.*` 只记条目 id 与动作(无 summary / before / after)。没有任何日志调用。路由 `routers/changelog.py`、`routers/admin_changelog.py`;已读按 **id** 比较(spec),id 较小的草稿在用户标记已读之后才发布不会再亮红点,所以导入命令按日期升序建草稿
     - `changelog_import.py` – `python -m app.admin.changelog_import [--dir DIR] [--dry-run]`:读 `*.json` 草稿(容器里 `/app/changelog`,检出里 `docs/changelog`),按 `(entry_date, title_zh)` 幂等建草稿(已发布 / 已编辑 / 已删除的都不动不复活;改标题 = 新草稿),全有或全无(失败退出 2),只打印数量;每条记审计 `changelog.import`(actor `cli`)。镜像靠 `COPY docs/changelog /app/changelog` 带上草稿,**重建容器只在用户要求时做**
     ```
     并把测试命令行里的 `tests/test_announcements.py tests/test_system_status.py` 替换为 `tests/test_announcements.py tests/test_changelog_*.py tests/test_system_status.py`。
  3. `server/app/routers/CLAUDE.md`:在 `` `announcements` (public `GET /api/announcements`: active banners + maintenance state), `` 之后追加:`` `changelog` (`/api/changelog`: `GET ?cursor=&limit=` published entries by `entry_date` desc with `unread` / `latest_id` / per-entry `is_new`, `POST /seen` forward-only read position; login only; only ids, `cursor` and `limit` in URLs; before `stubs`), `admin_changelog` (`/api/admin/changelog`: viewer list, operator create / edit / publish / unpublish / soft delete via `app/admin/changelog.py`; audit carries ids and actions only; before `stubs`; new routes go into the pinned table in `tests/test_changelog_privacy.py`), ``。
  4. `server/tests/CLAUDE.md`:在 `` `library_contract.json` (recorded by `test_library_contract.py`; web `library-contract.test.ts` reads it; tickets written `REDACTED`); `` 之后追加 `` `changelog_contract.json` (recorded by `test_changelog_contract.py`; web `changelog-contract.test.ts` and admin `features/changelog/api.test.ts` read it; timestamps fixed); ``;并在 `- \`fixtures/\` – ISE XML samples,` 这一行之前插入 bullet:`- \`test_changelog_privacy.py\` – caplog + audit + command-output scan for entry text, static no-logging check of the four changelog modules, pinned \`/api/changelog*\` and \`/api/admin/changelog*\` route table (new routes must be added there); \`test_changelog_import.py\` also validates every \`docs/changelog/*.json\``。
  5. `docs/CLAUDE.md`:在 Layout 的 `superpowers/design/<name>/` 那条 bullet 之后插入:
     ```
     - `changelog/YYYY-MM.json` — user-facing changelog **drafts** (spec `superpowers/specs/2026-10-14-changelog-design.md`, plan `superpowers/plans/2026-10-14-changelog.md`): one JSON array per month, `[{entry_date, version|null, title_zh, title_en, items:[{tag: new|improve|fix|library|other, zh, en}]}]`. **Claude writes them** after a feature is merged, deployed and checked, and only as drafts: `docker compose exec server python -m app.admin.changelog_import` (idempotent by `entry_date` + `title_zh`; `--dry-run` counts only; the image carries the folder after a rebuild, which happens only when the user asks); the user edits and publishes them in the admin console (更新日志). Writing rules: plain friendly words for end users (no internal terms such as migration, table, endpoint, worktree), no secrets or user data, one sentence per item, at most 4 items per entry, Chinese and English both filled, claim only what shipped, `version` stays null unless the user gives one. A renamed `title_zh` imports as a new draft. `server/tests/test_changelog_import.py` validates every file here.
     ```
  6. `web/src/lib/CLAUDE.md`:把 `Points include \`selectionActions\` (\`{ text, testId }\`, the select-to-lookup action bar).` 替换为 `Points include \`selectionActions\` (\`{ text, testId }\`, the select-to-lookup action bar) and \`practiceHeaderActions\` (no props; header icon buttons left of the practice-list link; core contribution \`changelog.entry\`).`
  7. `web/src/plugins/CLAUDE.md`:把 `` 核心贡献 `wordActions/vocabulary.add`、`selectionActions/chat.read-aloud`; `` 替换为 `` 核心贡献 `wordActions/vocabulary.add`、`selectionActions/chat.read-aloud`、`practiceHeaderActions/changelog.entry`(更新日志入口,懒加载); ``;把 `` `selectionActions`(`{ text, testId }`,选词操作条;核心贡献 `chat.read-aloud` = 朗读)。 `` 替换为同一句 + `` `practiceHeaderActions`(无 props,练习页顶栏「练习清单」图标左边;核心贡献 `changelog.entry`)。 ``。
  8. `web/src/features/CLAUDE.md`:首行的 feature 列表末尾加 `, changelog`。
  9. `web/src/features/practice/CLAUDE.md`:在 `- \`i18n/{en,zh-CN}.json\` — this feature's strings.` 之后插入 bullet:`- The page header renders \`<Slot point="practiceHeaderActions" />\` before the practice-list link; the changelog entry arrives through it (no import of \`~/features/changelog\`: that would be a new cross-feature edge, plan 2026-10-14-changelog R-2).`
  10. `web/README.md`:在 `## E2E(Playwright,真实上游)` 这一行之前插入:
      ```
      ## 更新日志(计划 2026-10-14)

      练习页顶栏「练习清单」图标左边有「更新日志」入口(星花图标;没有已发布条目时不显示;有未读时红点 + 提示环,第一次出现未读时一条一次性小提示,「已显示」记在本机 `enjoy-web.changelog.prefs`,退出登录清除)。点开进入整页 `/practice/changelog`(懒加载):月份分组、类型筛选、首条展开、「新」角标、超过 2 条折叠、滚动 + 按钮分页、离线时显示上次保存的第一页。未读数与已读位置在服务端(`GET /api/changelog`、`POST /api/changelog/seen`,多设备同步),内容由管理后台的「更新日志」页写。**未验证**:真机 iPhone 上的入口红点与提示环、页面滚动与分页、`IntersectionObserver` 自动加载;清单见 `docs/superpowers/plans/2026-10-14-changelog-device-checklist.md`。

      ```

- [ ] **Step 2: 新建 `web/src/features/changelog/CLAUDE.md`:**

```markdown
# web/src/features/changelog/

更新日志(spec `docs/superpowers/specs/2026-10-14-changelog-design.md`;plan `docs/superpowers/plans/2026-10-14-changelog.md`):练习页顶栏入口 + 整页 `/practice/changelog`。

## What lives here
- **主包(很小)**:`index.ts`(只导出 `ChangelogPage`)、`lazy-pages.tsx`(懒加载页面包装)、`register.tsx`(扩展点 `practiceHeaderActions` 的核心贡献 `changelog.entry`,懒加载入口;只被 `plugins/core.ts` 导入)。
- **懒加载块**:`changelog-entry.tsx`(星花图标、红点、提示环、一次性小提示)、`changelog-page.tsx` + `entry-card.tsx` + `use-changelog-list.ts` + `use-near-end.ts`、`unread-store.ts`(内存里的未读数,按 api 实例 + 用户 id 分区)、`use-unread.ts`、`use-one-time-hint.ts` + `hint-pref.ts`、`api.ts`(接口与防御性解析)、`entries.ts`(月份分组 / 类型筛选 / 折叠 / 日期格式)、`locales.ts` + `locales/`(文案,不在 eager 的 `i18n/` 里)、`changelog.css`(提示环、气泡、跟读库标签色)。
- 契约:`changelog-contract.test.ts` 读 `server/tests/fixtures/changelog_contract.json`。

## Allowed dependencies
`lib/`、`api/`、`components/`、`layout/`、`auth/`、`i18n/`、`@renderer/*`。**不导入任何别的 feature**(`register.tsx` 尤其不行);练习页不导入本 feature,而是渲染扩展点插槽。

## Test
`cd web && yarn vitest run src/features/changelog`(懒加载块首次编译慢,个别用例放宽了超时)。

## Pitfalls
- 主包守卫:`changelog-lazy.test.ts`;不要在 `index.ts` / `lazy-pages.tsx` / `register.tsx` 里静态导入页面、入口、api、store、文案或样式。
- 文案键 `web.changelog.*`,中英两份键与占位符一致(`locales.test.ts`);英文复数用 `_one/_other`(中文也写两个)。
- 取文用 `pickText(i18n.language, zh, en)`:英文为空时回退中文(D4)。
- 未读 store 按「api + 用户 id」分区;`AuthProvider` 的 api 在登出 / 登录之间是同一个对象,所以不能只按 api。
- 「新」角标来自加载时服务端给的 `is_new`,调完 `seen` 之后本次访问内不消失;离线缓存一律当已读(没有角标、不报 `seen`)。
- 提示的「已显示」在 `CHANGELOG_PREFS_KEY`(`lib/storage.ts`),退出登录由 `auth/device-data.ts` 清除。
- 真机行为未验证:见 `docs/superpowers/plans/2026-10-14-changelog-device-checklist.md`。
```

- [ ] **Step 3: 新建 `admin/src/features/changelog/CLAUDE.md`:**

```markdown
# admin/src/features/changelog/

管理后台「更新日志」页 `/admin/changelog`(spec 2026-10-14-changelog-design D6;plan `docs/superpowers/plans/2026-10-14-changelog.md`;桌面 ≥ 1024px):`api.ts`(`/api/admin/changelog`,snake → camel)、`strings.ts`(zh-CN,也给 `components/layout.tsx` 的导航项用 `S.title`)、`changelog-page.tsx`(左列表:全部 / 草稿 / 已发布;右编辑器)、`entry-editor.tsx`(日期、可选版本号、中英文标题、「类型 + 一句话」条目、预览、保存 / 发布 / 下架 / 删除)、`entry-preview.tsx`(手机卡片预览,取文规则同网页:英文为空回退中文)、`changelog-icon.tsx`、`index.ts`。

## Allowed dependencies
`../../api/*`、`../../components/*`、`../../hooks/*`、`../../lib/*`。不导入其他 feature。`components/layout.tsx` 只导入这里的 `strings.ts` 与 `changelog-icon.tsx`;`app.tsx` 只从 `index.ts` 导入。

## Test
`cd admin && yarn vitest run src/features/changelog`(`api.test.ts` 读 `server/tests/fixtures/changelog_contract.json`;页面测试用 `vi.mock("./api", importOriginal …)` 保留 `TAGS`,角色用 `vi.spyOn(session, "useAdminSession")`)。

## Pitfalls
- 校验规则与服务端 `app/admin/changelog.py::validate` 保持一致(标题 ≤ 80、版本 ≤ 24、条目 1–20 条、每条 ≤ 200 字);服务端仍会再校验,这里只是提前提示。
- 「发布」= 有改动(或新建)就先保存再发布;父组件用 `key = id:updatedAt` 在条目变化时重新挂载编辑器,所以编辑器里没有「同步 props」的逻辑。
- 删除是软删除(服务端 `archived_at`),导入命令不会复活被删的草稿。
- 审计只记条目 id 与动作:界面文案里不要承诺「审计里能看到改了什么」。
```

- [ ] **Step 4: 新建真机清单** — `docs/superpowers/plans/2026-10-14-changelog-device-checklist.md`:

```markdown
# 更新日志 · 真机与真实浏览器验证清单(未验证)

- 日期:2026-10-14 · 计划:`2026-10-14-changelog.md` · 状态:**全部未验证**。写计划与实现时,以下每一项都没有在真机或真实浏览器上跑过;单元测试在 jsdom 里通过不代表这些成立。
- 做完一项在方括号里写日期与结论(通过 / 失败 + 现象),失败的另记到「发现的问题」。

## A. iPhone Safari(浏览器标签页)与主屏幕 PWA

| # | 做什么 | 预期 | 结果 |
|---|---|---|---|
| A1 | 有已发布条目、有未读时打开练习页(360 / 390 / 430 px 宽) | 顶栏:标题 + 副标题 + 星花图标 + 「练习清单」图标,44 px 命中区,标题截断不挤压图标 | [ ] |
| A2 | 看红点与提示环 | 红点在星花右上角,带 2 px 背景色描边;提示环缓慢扩散,不卡顿、不抖动版面 | [ ] |
| A3 | 系统「减少动态效果」打开 | 提示环静止,红点仍在 | [ ] |
| A4 | 第一次出现未读 | 图标下方弹「有 N 条新更新」气泡,箭头对准星花,不被顶栏或内容遮挡;点别处消失;再次进入练习页不再出现 | [ ] |
| A5 | 退出登录再登录后再有未读 | 小提示可以再次出现(本机偏好随退出清除) | [ ] |
| A6 | 深色模式下看红点、提示环、气泡、各类型标签、「新」角标 | 对比度足够,跟读库标签是紫色 | [ ] |
| A7 | 点入口进日志页 | 整页打开;左上返回回练习页;1 秒后返回,红点消失 | [ ] |
| A8 | 在另一台设备读完日志,回到这台刷新练习页 | 红点消失(服务端已读位置同步;入口 60 秒内不重复请求,等一分钟或重开应用) | [ ] |
| A9 | 日志页滚动 | 惯性滚动顺滑;玻璃顶栏滚动后变玻璃;月份标题、首条展开、「展开全部 N 条」折叠 / 展开正常 | [ ] |
| A10 | 滚到底(条目多于 20 条时,先在管理端造够) | 自动加载下一页;**记录 `IntersectionObserver` 在应用壳的滚动容器里是否真的触发**;不触发时「加载更多」按钮能用 | [ ] |
| A11 | 类型筛选芯片 | 横向滚动不带动页面横向滚动;切换后卡片与条目正确过滤 | [ ] |
| A12 | 飞行模式下打开日志页(之前成功加载过) | 显示上次缓存的第一页 + 「离线」提示 + 重试;没有「新」角标;联网后点重试恢复 | [ ] |
| A13 | 直接打开 `/practice/changelog`(未登录 → 登录 → 回到) | 登录后回到日志页(或练习页),无白屏 | [ ] |
| A14 | 中文 / 英文 / 西班牙文界面 | 中文显示中文;英文显示英文,英文留空的条目显示中文;西班牙文按英文回退 | [ ] |
| A15 | 底栏与键盘 | 日志页没有输入框;底栏「练习」保持高亮 | [ ] |

## B. 管理端(桌面浏览器,≥ 1024 px)

| # | 做什么 | 预期 | 结果 |
|---|---|---|---|
| B1 | 1024 / 1280 / 1440 px 宽打开「配置 → 更新日志」 | 左列表 340 px + 右编辑器不溢出,无横向滚动 | [ ] |
| B2 | Safari 与 Chrome 里的日期控件 | `input type=date` 能选日期、值是 `YYYY-MM-DD` | [ ] |
| B3 | 新建 → 保存 → 发布(真实服务) | 手机端练习页出现红点;日志页有这条,「新」角标 | [ ] |
| B4 | 下架 → 删除 | 手机端刷新后消失;管理端列表不再显示已删除的 | [ ] |
| B5 | 查看者账号登录 | 能看列表与预览,不能新建 / 保存 / 发布 / 下架 / 删除 | [ ] |
| B6 | 预览 | 与手机端显示一致(英文为空回退中文;版本号补 v) | [ ] |
| B7 | 打开「审计日志」页 | `changelog.create|update|publish|unpublish|delete` 各一行,只有条目 id 与动作,没有标题或正文 | [ ] |

## C. 导入首批草稿(部署后,只在用户要求时做)

| # | 做什么 | 预期 | 结果 |
|---|---|---|---|
| C1 | 镜像带上草稿:重建容器后 `docker compose exec server ls /app/changelog` | 看到 `2026-10.json`(**重建容器只在用户要求时做**) | [ ] |
| C2 | `docker compose exec server python -m app.admin.changelog_import --dry-run` | `would create 8, skipped 0` | [ ] |
| C3 | 去掉 `--dry-run` 再执行,然后再执行一次 | 第一次 `created 8, skipped 0`,第二次 `created 0, skipped 8`;管理端出现 8 条草稿,日期升序 | [ ] |
| C4 | 逐条核对草稿事实 | 与实际部署一致;`AGENTS_ENABLED` / `LIBRARY_ENABLED` / `WORDBOOK_ENABLED` 关闭的功能,对应条目在发布前删除或改写 | [ ] |
| C5 | 按日期从早到晚逐条发布 | 用户的未读数 = 最近 3 条;红点与「新」角标正确 | [ ] |

## D. 体积

| # | 做什么 | 预期 | 结果 |
|---|---|---|---|
| D1 | `yarn web:build`,然后 `cd web && yarn bundle:check --max-delta=0.5` | 主包增量 ≤ 0.5 kB gzip;把实测数字写在这里(不预估) | [ ] |

## 发现的问题
(无)
```

- [ ] **Step 5: 检查与提交。** 无代码改动,不跑测试;`git diff --stat` 确认只有上面列出的文档。提交(`git add` 上面列出的文件):

```
docs: changelog notes, device checklist and drafting workflow

CLAUDE.md updates for the changelog modules, routers, tests and web / admin features, the web README section,
the rule that Claude drafts changelog entries as drafts (docs/changelog), and the unverified device checklist.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

## 收尾(只在用户要求时做;不属于任何任务的提交)

1. **全量检查:** `cd server && uv run pytest -q`(约 2.5 分钟,必要时按文件分两半);`yarn web:typecheck && yarn web:test`;`cd admin && yarn typecheck && yarn test`。
2. **主包体积:** `yarn web:build` 之后 `cd web && yarn bundle:check --max-delta=0.5`(spec 的目标 ≤ 0.5 kB gzip)。把实测数字写进真机清单 D1;超出就先查 `register.tsx` 是否被别的静态导入拖进了入口模块(`changelog-lazy.test.ts` 应已拦住)。
3. **部署与导入首批草稿:** 用户要求时 `scripts/deploy.sh`(会重建镜像,`COPY docs/changelog` 生效);容器起来后 `docker compose exec server python -m app.admin.changelog_import --dry-run`,再不带 `--dry-run` 执行;让用户在管理端「更新日志」里改完草稿、按日期从早到晚发布。
4. **以后每次功能合并并部署验证后:** Claude 按 `docs/CLAUDE.md` 的规则往 `docs/changelog/YYYY-MM.json` 追加草稿,再提醒用户执行导入命令;用户在管理端发布。

---

## 与 spec 的偏差(都已在上面的裁定里写明依据)

- **D-1 公开列表按 `entry_date DESC, id DESC` 排序,不是「发布时间倒序」(R-4)。** 原因:月份分组与卡片日期都是 `entry_date`;按发布时间排会让「从上往下逐条发布」变成日期最旧的在最上面。游标随之是 `YYYY-MM-DD.<id>`。
- **D-2 响应多三个字段(R-5):** 顶层 `latest_id`、条目 `is_new`、查询参数 `limit`;只增不改,`unread` 与 `cursor` 语义与 spec 一致。
- **D-3 类型集合现在就含 `other`(R-7):** spec 写「可扩展到『其他』」。
- **D-4 `seen` 把 `upto_id` 夹到最大已发布 id、新用户的有效已读位置不低于首次基线(R-6):** spec 只写「只前进不后退、幂等」,这是它的细化,不改语义。
- **D-5 导入命令要求镜像带上 `docs/changelog`(S4 改 `Dockerfile` 与 `Dockerfile.dockerignore`,R-12):** spec 只要求「读取 `docs/changelog/*.json`」,默认镜像不含 `docs/`。

## 风险与已知限制

- **已读按 id 比较(spec):** 一条 id 较小的草稿在用户标记已读之后才发布,不会让该用户再亮红点(R-6)。缓解:导入命令按日期升序建草稿;管理端编辑器提示「按日期从早到晚逐条发布」。
- **入口多一次请求:** 每次进练习页最多一次 `GET /api/changelog?limit=1`(60 秒内不重复);失败静默。
- **首批草稿依赖部署开关:** 智能体、跟读库、背单词受开关控制(默认关);发布前要按部署核对(R-21)。
- **`Intl` 与 `IntersectionObserver`:** 月份 / 日期格式依赖 Node 的完整 ICU(测试)与浏览器的 `Intl`;自动加载依赖 `IntersectionObserver` 在应用壳滚动容器里的表现(未验证),按钮是兜底。
- **工作树里用户未提交的改动:** 根 `CLAUDE.md`、`.gitignore`、`scripts/`、`.claude/`;每个提交只按路径添加,永不 `git add -A`。

## 未验证清单

- 代码与测试在**仓库外的临时副本**里跑通过(结果见 Global Constraints 的验证口径),但**还没有在真实仓库里跑过**:第一次在仓库里执行时(行尾 CRLF、真实 `node_modules`、与别的未合并改动并存)以真实结果为准修正测试数据、选择器、超时,裁定、接口名与隐私断言不改。
- 没有在真机 / 真实浏览器上验证:入口红点、提示环与一次性小提示的位置和动画、日志页滚动与分页(含 `IntersectionObserver`)、离线缓存、管理端真实布局 —— 见 `2026-10-14-changelog-device-checklist.md`。
- 主包增量(≤ 0.5 kB gzip)没有实测(构建只在用户要求时做)。
- 没有对真实 Postgres 跑迁移 `0020`(只建表、无 ALTER,预期无差别;`TEST_DATABASE_URL=… uv run pytest -q tests/test_changelog_models.py` 可在有 Postgres 时补跑)。
- 首批草稿的事实依据是 `git log` 与计划标题,没有逐条在部署环境里验证(R-21)。

