# 跟读库 · 管理端(服务端 + 管理后台网页)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **执行前先读 spec §15「计划拆分、文件归属与合并顺序」。** 本计划是车道 **A 管理端**,只在 S1 合并之后开始;服务端任务组(AS)与 S2、W1 可并行,网页任务组(AW)在 AS 合并之后。

**Goal:** 给自托管管理后台加上「跟读库」:服务端 `app/admin/library_admin.py` + `routers/admin_library.py`(`/api/admin/library*`)提供总览(条目数、总字节、按状态计数、队列、今日识别分钟 / 全站上限、AI 译文与分析开关与今日译文 / 分析句数(D8)、ffmpeg 与 yt-dlp 版本、链接开关与 cookies / 代理「已配置 / 未配置」)、条目列表(分页 + 按状态 / 所有者 / 种类筛选,**每行只有数字、状态、种类、阶段、来源主机名,没有标题 / 网址 / 文字**)、按占用排行、单个用户的占用、单条删除与取消(操作员 + 输入确认 + 理由,审计 `library.item.delete` / `library.item.cancel`)、清理全部失败项(审计 `library.purge_failed`,只记数量与字节);配置诊断 `admin/doctor.py` 新增四个发现 `library_ffmpeg_missing` / `library_ytdlp_missing` / `library_asr_unavailable` / `library_cookies_missing`;管理后台网页新增 `/library` 页(仅桌面,侧栏「内容」组)、用户详情页的「跟读库」占用条。

**Architecture:** 管理层只**读** S1 的表(`LibraryItem`、`DailyUsage`、`UserQuotaOverride`)并只经**两个适配函数**调用 S1 的 `app.library.store`(删除、取消),不自己清文件、不自己停任务(R-A3)。所有查询只选非内容列(R-A7);审计行只含条目 id、字节数、数量与管理员填的理由(R-A6)。工具版本(ffmpeg 子进程 `-version` 的第一行、`importlib.metadata` 的 yt-dlp 版本)每进程缓存 10 分钟(R-A9)。诊断保持「纯函数 `diagnose(settings, Facts)` + `gather_facts`」的结构,四个新事实字段都带「健康」默认值,现有 `test_admin_doctor.py` 不动(R-A12)。网页是一个 feature 目录 `admin/src/features/library/`(`api.ts` 做 snake → camel、`strings.ts` 中文文案、`library-page.tsx`、`user-library-usage.tsx`、`library-icon.tsx`、`index.ts`),`layout.tsx` 只导入它的 `strings.ts` 与 `library-icon.tsx`(避免循环),`app.tsx` 加一条路由,`user-detail-page.tsx` 插一个组件。

**Tech Stack:** 服务端 Python 3.12(uv)、FastAPI + SQLAlchemy 2 async + pydantic v2、pytest + pytest-asyncio;管理端 React 18 + react-router 7 + Tailwind 3 + vitest + Testing Library(jsdom)。不新增依赖、不新增迁移、不新增设置项。

**Spec:** `docs/superpowers/specs/2026-10-13-video-import-design.md`(本车道:§12 全部、§5.2 末段「`config_doctor` 新增发现」与 D8 的四个新设置、E10、E11 / E12 的计量口径、§13 隐私硬规则、§15 的 A 行与「D8 增补的归属」;开放问题 1–5 按推荐默认值;2026-10-13 修订后的 D8–D12 对本车道的影响见文末「Addendum (2026-10-13)」,其中的裁定 R-A19–R-A23 覆盖更早的文字)。先例:`app/admin/wordbook_admin.py` + `routers/admin_wordbook.py` + `admin/src/features/wordbook/`(总览 + 表 + 理由对话框)、`app/admin/agents_admin.py`(分页 `page/next`、`*AdminError`)、`routers/admin_rank.py::reset_all`(输入确认短语 + 409 `details.confirm`)。

## Global Constraints

- **合并顺序(跨计划,spec §15):S1 → (S2 ‖ AS ‖ W1) → W2 → AW → Z。** AS 依赖 S1 的模型、设置、`QUOTA_KEYS`、`app.library.store`、`tests/test_architecture.py` 里 `admin` 可导入 `library`、`main.py` 的 `admin_library` 锚点;AW 依赖 AS 已合并(网页按 AS 的真实响应形状写)。Task A0 逐项核对,任何一项不成立就**停下**报告编排者,不要去改 S1 的文件。
- **文件归属(spec §15 的 A 行,一个文件只有一个所有者):** 本计划独占 `server/app/admin/library_admin.py`、`server/app/routers/admin_library.py`、`server/app/admin/doctor.py`(只加四个发现)、`server/tests/test_admin_library.py`、`admin/src/features/library/*`、`admin/src/components/layout.tsx`、`admin/src/app.tsx`、`admin/src/pages/user-detail-page.tsx`、`server/app/admin/CLAUDE.md`;另按 spec §15「A 只在锚点处追加两行」改 `server/app/main.py` 两行。结果文档 `docs/superpowers/plans/2026-10-13-video-import-results.md` 只**追加**本车道一节(A0)。**不碰** S1 的 `test_library_privacy.py`、`test_architecture.py`、`routers/CLAUDE.md`、`tests/CLAUDE.md`、`core/*`、`models.py`,也不碰无主的 `admin/README.md`、`admin/src/strings.ts`、`admin/src/features/users/strings.ts`(见「与 spec 的偏差」D-3)。
- **隐私(spec E10、§13):** 管理端的任何响应、日志、审计、URL 里都不出现标题、文件名、网址(只允许主机名)、字幕或转写文字、cookies 路径、代理地址;测试用一个带标记的标题与网址逐个端点扫描响应、`caplog`(限定 `logger="app"`)与审计行(AS3 的隐私测试)。URL 里只有条目 uuid、用户 id、状态、种类、页码。
- **权限:** 每个 `/api/admin/library*` 端点声明角色:读 = `require("viewer")`,写 = `require("operator")`(spec §12「操作员角色 + 输入确认,不需要 step-up」);`tests/test_admin_routes_guarded.py` 自动覆盖(不改它)。写操作的审计行与改动同一事务提交(顺序见 R-A3)。
- **工作树是 CRLF**(`core.autocrlf=true`):改现有文件用 Edit 工具,新文件用 Write。
- **测试只跑本任务列出的:** 服务端 `cd server && uv run pytest -q <列出的文件>`;管理端 `cd admin && yarn vitest run src/features/library` + `yarn workspace admin typecheck`。全量套件、E2E、容器重建只在用户要求时做。
- **提交:** conventional(`feat(server): …`、`test(server): …`、`feat(admin): …`、`docs: …`),一个任务一个提交,每个提交后本任务列出的测试全绿;信息以空行 + `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾。
- **验证口径(如实):** 写计划时**没有**运行本计划的任何代码(S1 尚未写成;本计划只核对了当前真实源码:`app/admin/{doctor,wordbook_admin,agents_admin,users_admin,audit,perms}.py`、`routers/{admin_wordbook,admin_agents,admin_rank,admin_users}.py`、`core/{quotas,config}.py`、`models.py`、`main.py`、`tests/{conftest,admin_helpers,test_admin_doctor,test_admin_wordbook,test_admin_routes_guarded}.py`、`admin/src/{app.tsx,components/*,hooks/*,lib/format.ts,api/client.ts,pages/user-detail-page.tsx,features/wordbook/*,features/agents/*}`)。凡依赖 S1 的地方都写成「假设 + A0 核对」;执行者第一次运行时以真实结果为准修正选择器与断言里的**测试数据**,不得改动本计划的裁定、接口名与隐私断言。没有真机 / 真上游运行过的,一律在文末「未验证清单」。

---

## 文件结构

```
server/
  app/admin/library_admin.py        新:overview / items / top_users / user_usage(AS2);
                                    delete_item / cancel_item / purge_failed + S1 适配(AS3)
  app/routers/admin_library.py      新:/api/admin/library*(AS2 读,AS3 写)
  app/admin/doctor.py               [本车道] CODES + Facts 三个字段 + _library_findings + 三个事实收集函数(AS1)
  app/main.py                       [S1 所有,spec 允许 A 在锚点追加两行](AS2)
  app/admin/CLAUDE.md               [本车道](AS4)
  tests/test_admin_library.py       新:诊断(AS1)、读端点(AS2)、写端点 + 隐私 + URL(AS3)
admin/src/
  features/library/api.ts           新:类型、camel、请求函数(AW1)
  features/library/api.test.ts      新(AW1)
  features/library/strings.ts       新:全部中文文案(AW1)
  features/library/library-icon.tsx 新:导航图标(AW1)
  features/library/index.ts         新:公开出口(AW1 建,AW2 / AW3 各追加一行)
  features/library/library-page.tsx 新(AW2)
  features/library/library-page.test.tsx 新(AW2)
  features/library/user-library-usage.tsx 新(AW3)
  features/library/user-library-usage.test.tsx 新(AW3)
  features/library/CLAUDE.md        新(AW3)
  components/layout.tsx             [本车道] 导入 + 一个导航项(AW2)
  app.tsx                           [本车道] 导入 + 一条路由(AW2)
  pages/user-detail-page.tsx        [本车道] 导入 + 一个组件(AW3)
docs/superpowers/plans/2026-10-13-video-import-results.md   只追加「A 管理端 · 前置核对」一节(A0)
```

## 任务组、依赖与合并顺序

| 组 | 任务 | 依赖 |
|---|---|---|
| **A0 前置核对** | A0 | S1 已合并 |
| **AS 服务端**(串行) | AS1 诊断 → AS2 读端点 → AS3 写端点与隐私 → AS4 文档 | A0 |
| **AW 管理后台网页**(串行) | AW1 接口与文案 → AW2 页面、导航、路由 → AW3 用户详情占用与 CLAUDE.md | AS 全部合并(spec §15「A 的网页部分在 A 服务端之后」)且 W2 已合并(spec 的合并顺序;AW 与 W2 没有共同文件,若编排者允许可提前) |

**本计划内合并顺序:** A0 → AS1 → AS2 → AS3 → AS4 → AW1 → AW2 → AW3。

---

## 本计划的裁定

> 格式:**裁定 / 为什么 / 猜错的代价**。spec 不改;spec 没说或与代码对不上的地方在这里决定。所有「核对」项都读了真实代码,依据写在括号里。

- **R-A1 本车道没有 spike;Task A0 是「前置核对」,结果追加到 `2026-10-13-video-import-results.md`。** spec §15 的 Task 0 列表只给 S1(S0、S1 spike)和 S2 指名 spike,A 行没有。但本计划依赖 S1 的七个接口,必须在动手前逐项读真实代码确认,所以 A0 只做核对并把结论写进结果文档的独立一节(追加,不覆盖)。*代价*:无。
- **R-A2 管理端端点不受 `LIBRARY_ENABLED` 控制。** spec E1 的「关 = 404」说的是 `/api/library/*`(学习者端点);管理端与先例一致(`wordbook_admin.overview` 在背单词关闭时仍返回数据,页面写「总开关已关闭;这里的数据仍可查看」)。总览返回 `enabled`,网页据此显示提示与「去设置」链接(`/settings/library`,组 id 由 S1 的 `GROUPS` 加 `("library","跟读库")`,spec §2.2)。*代价*:关掉功能后管理员仍能看到旧条目的占用并删除——这是想要的(清磁盘)。
- **R-A3 删除与取消只经 S1 的 `app.library.store`,顺序是「S1 调用 → 审计 → 提交」。** 依据:spec §4「`library.store.delete_item` 与删用户都要显式删 … 并清目录」、§6.5「取消 → 终止子进程、清 `_tmp`、条目标 `canceled`」;这些逻辑属于 S1,管理端复制一份迟早分叉。两个调用集中在 `library_admin.py` 顶部的 `_s1_delete` / `_s1_cancel`,A0 核对真实签名后**只改这两个函数**。为什么审计放在 S1 调用之后:`audit.record` 会拿审计链的写锁(`audit._lock_head`,`UPDATE audit_head`,在 SQLite 上是 RESERVED 锁)直到提交;S1 的取消要等运行中的任务停下,那个任务可能用自己的会话写进度,若审计先拿锁就会互等到 busy timeout(`app/admin/CLAUDE.md`「commit promptly after `audit.record`」)。若 S1 的函数不提交,删除与审计在同一事务;若它自己提交,审计紧随其后另一个事务。*代价*:后一种情况下,进程恰好在两次提交之间崩溃会留下「已删除但没有审计行」(窗口是一次 `INSERT`);可接受,且 A0 会记录 S1 是否自己提交。
- **R-A4 输入确认短语:单条删除 `DELETE <条目 id 前 8 位>`,清理失败项 `PURGE <当前失败数> ITEMS`。** spec §12 只说「输入确认」。管理员看不到标题(E10),所以短语只能用 id;前 8 位(uuid 的第一段)足够防误点。清理失败项沿用 `admin_rank.reset_all` 的「数量进短语」:总览返回 `purge_confirm`,数字变了旧短语失效(409 + `details.confirm` 给出新短语,与 rank 一致)。理由:服务端 1–200 字(与其他 `ReasonIn` 一致),网页 `ConfirmDialog` 要求 ≥ 4 字。取消不需要输入确认(可恢复:用户可重新导入),只要理由。*代价*:无。
- **R-A5 「今日识别分钟」读 `daily_usage(scope="library_asr", subject="*", day=utc_day(now))`,值是秒,显示时除以 60 保留 1 位。** 依据:spec §6.4.7「在 `daily_usage` 里按『秒』预留(`scope="library_asr"`,`subject` = 用户 id 与 `*`)」;`DailyUsage` 模型是 `(scope, subject, day, count)`(`models.py:217`),`utc_day` 在 `services/usage.py`。注意现有背单词的全站计数用的 subject 是 `"all"`(`wordbook_admin.overview`),而 spec 对库写的是 `"*"`;A0 读 S1 的 `app/library/limits.py` 确认,若 S1 导出了常量(如 `ASR_SCOPE` / `GLOBAL_SUBJECT`)就改为导入它们,若取值不同以 S1 为准并写进结果文档。*代价*:取值不一致时总览显示 0(测试会先发现)。
- **R-A6 审计:动作 `library.item.delete`(`target_type="library_item"`、`target_id=<id>`、`after={"bytes": n}`)、`library.item.cancel`(`before={"status": 原状态}`)、`library.purge_failed`(`target_type="library"`、`target_id="failed"`、`after={"count": n, "bytes": b}`);`summary` 一律留空,不写用户名。** spec §12「审计 `library.item.delete`,只记条目 id 与字节数」「审计只记数量」。与 `user.delete`(summary 写用户名)不同,这里连所有者都不写,严格按 spec。动作名 ≤ 48 字符(`audit.record` 截断到 48)。*代价*:审计里看不出删的是谁的条目;要查就按 id 对照(删除后查不到,这是 E10 的取舍)。
- **R-A7 列表每行的键:`id, user_id, username, kind, source, status, stage, progress, error_kind, duration_ms, bytes, sub_source, source_host, created_at`。** spec §12 列了「用户名、种类、状态、阶段、时长、字节数、字幕来源、来源主机名、创建时间」;追加的 `id`(删除 / 取消要用)、`user_id`(链接到用户详情)、`source`(上传 / 链接)、`progress`(处理中的进度)、`error_kind`(失败原因的英文常量,spec §6.6)都不是内容。字节数的键叫 `bytes`(不是列名 `library_bytes`),与其他管理页一致。**永不选** `title`、`source_url`、`media_path`、`poster_path`,也不查 `library_segments` / `library_attempts`。排序 `created_at DESC, id DESC`;分页沿用 `agents_admin.personas` 的 `page` / `next`(每页 50),另给 `total`。*代价*:无。
- **R-A8 队列数字:`queued` / `processing` 来自数据库计数,`running` = 本进程 `app.state.library.pending` 的长度(没有 worker 对象时 0),`concurrency` = `library_job_concurrency`。** 依据 spec §6.1「`app.state.library` … 运行中的任务放在 `self.pending`(集合)」。数据库计数跨进程正确;`running` 只是本进程(容器固定 `--workers 1`,spec §2.2)。*代价*:A0 发现 S1 把 worker 放在别的名字下时,只改 `overview` 里那一行 `getattr`。
- **R-A9 工具版本:ffmpeg = `ffmpeg -version` 标准输出第一行的第三个词(`ffmpeg version <v> …`),yt-dlp = `importlib.metadata.version("yt-dlp")`;每进程缓存 10 分钟;没有就 `null`(网页显示「未安装」)。** 子进程用 `create_subprocess_exec`(不经 shell)、`stdin=DEVNULL`、`stderr=DEVNULL`、5 s 超时、只读第一行;不走 S1 的 `library/media.py::run`(其签名 A0 前未知,且这里只需要一个固定命令)。yt-dlp 不 import(import 很慢),只读包元数据。*代价*:yt-dlp 若不是以发行版包安装(例如源码目录)会显示「未安装」;spec §7.3 规定以 Python 依赖安装,所以不会发生。
- **R-A10 cookies 与代理只给布尔值:`link.cookies_configured`、`link.proxy_configured`。** spec §12 只要求 cookies「已配置 / 未配置」;代理也是 env-only 密钥(spec §5.2「`secret`(可能含账号口令)」),管理员同样需要知道「是否走代理」,所以一并给布尔值。测试断言路径与代理地址都不出现在响应里。*代价*:无。
- **R-A11 用户详情的占用来自新端点 `GET /api/admin/library/users/{user_id}`:`{user_id, enabled, items, bytes, quota_mb, max_items, by_status}`,配额取 `core.quotas.quota_for`(含按用户覆盖)。** spec §12 只说「用户详情页显示该用户的库占用」,没给端点;v1 的用户详情(`admin/service.py`、`api/endpoints.ts::getUser`)不属于本车道,所以放在本车道的路由里。不存在的用户 404。配额覆盖面板本身不用改:它遍历 `QUOTA_KEYS`(`users_admin.quotas`),S1 把两个键加进去后自动出现(标签见 D-3)。*代价*:用户详情多一次请求。
- **R-A12 诊断:四个发现都只在 `library_enabled` 时检查;`library_ffmpeg_missing` 是 error,其余 warn;cookies 一个代码两种文案(不存在 / 权限过宽);权限只在 POSIX 上检查;消息不含路径。** 条件:ffmpeg = `shutil.which("ffmpeg")` 与 `which("ffprobe")` 都在;yt-dlp = `importlib.util.find_spec("yt_dlp")` 且只在 `library_link_import_enabled` 时报;识别 = `library_asr_enabled` 且 `not (asr_stream_usable(s) or whisper_fallback_configured(s))`(直接用 `core/config.py` 末尾的两个纯函数,spec §2.2「识别可用性判断」,不依赖 S1 的属性名);cookies = 配了路径且 `stat` 失败 / 不是普通文件 → `missing`,POSIX 上 `S_IMODE & 0o077 != 0` → `too_open`(spec §7.2「文件权限比 `0600` 宽时 doctor 报」)。Windows 上 `st_mode` 的权限位没有意义,所以不判。`Facts` 新字段默认值是「健康」(`True` / `"unset"`),现有 `tests/test_admin_doctor.py::OK` 不用改。键名只写设置键,不写值(`doctor.py` 文件头「消息只含键名,不含值」)。*代价*:在 Windows 上部署时 cookies 权限过宽不会被提示(容器是 Linux,不受影响)。
- **R-A13 诊断的测试放在 `tests/test_admin_library.py`。** `test_admin_doctor.py` 不在本车道的文件里(spec §15);复用它的 `OK` 夹具(`from tests.test_admin_doctor import OK`,与 `test_admin_wordbook.py` 同法)。
- **R-A14 「清理失败项」只删 `failed`,不删 `canceled`;每次最多 500 个,返回 `more`。** spec §12 写「清理所有失败项」;已取消的条目由 S1 的 7 天清理处理(spec §6.5)。500 个上限避免一次请求里串行删上千个目录;`more: true` 时网页提示再点一次(总览的 `purge_confirm` 会给出新数字)。*代价*:失败项超过 500 个时要点多次。
- **R-A15 隐私与 URL 的测试在本车道的 `test_admin_library.py` 里。** spec §13 的 `test_library_privacy.py` 属于 S1,覆盖「库的每个端点」(`/api/library/*`);管理端端点由本车道自测:逐端点扫描响应、`caplog`、审计行,并钉住 `/api/admin/library*` 的完整路由表(路径参数只有 `item_id` / `user_id`)。*代价*:新增管理端路由必须同时改这个测试(写在 `app/admin/CLAUDE.md`)。
- **R-A16 `main.py` 只加两处:`from app.routers import (...)` 里加 `admin_library`,路由元组里加 `admin_library`。** spec §15「S1 … 为 `admin_library` 留带标签的锚点注释,A 只在锚点处追加两行」。A0 找锚点原文;若 S1 没留锚点,就把 `admin_library` 放在 `admin_agents` 之后(两处都是),它必须在 `stubs` 之前(`stubs` 兜底 `/api/**` 写入,`app/CLAUDE.md`)。*代价*:无。
- **R-A17 网页:一个页面 `/library`,侧栏「内容」组「词书」之后,`min: "viewer"`;删除 / 取消 / 清理按钮包在 `RoleGate min="operator"` 里;用户筛选用查询参数 `?user=<id>`(从用户详情跳过来),状态与种类用 `Chips`。** spec §12「`layout.tsx` 加导航项(`min: "viewer"` 可看,删除按钮要 `operator`),`app.tsx` 加路由;窄屏沿用现有『仅桌面』占位页」。`AppShell` 已对 `< 1024px` 渲染 `DesktopOnly`(`layout.tsx`),不另写。`camel` 在本 feature 里复制一份(feature 之间不互相导入,`features/agents/CLAUDE.md` 的约定)。*代价*:无。
- **R-A18 测试数据的 `LibraryItem(...)` 构造集中在 `tests/test_admin_library.py::add_item`,所有列显式给值。** 列名与可空性来自 spec §4 的表;S1 的真实模型若有出入(多列、少列、某列 NOT NULL),A0 记录,执行者**只改 `add_item`**,不改断言。*代价*:无。
- **R-A19(D8)总览新增 `ai` 块:`{enabled, available, today_translated, today_analysed, global_daily, translate_daily_per_user, analysis_daily_per_user}`,全是开关与数字。** 依据 spec §5.2(`library_ai_enabled` / `library_translate_daily_per_user` / `library_analysis_daily_per_user` / `library_ai_daily_global`)、§15「A 管理端:`overview` 增加今日译文 / 分析句数」、§5.2 的 `library_ai_available` 属性(S1 的 D8 增补)。`enabled` = `library_ai_enabled`,`available` = `getattr(settings, "library_ai_available", False)`。`limits` 保持原样不动(AS2 测试对它做整体相等断言),AI 的上限都放进 `ai`。*代价*:S1 若把属性改名,只改 `overview` 里这一行 `getattr`(A0 第 7 项)。
- **R-A20(D8)「今日译文 / 分析句数」读 `daily_usage`,不读 `library_segments`。** 依据 E10 / E11:`library_segments` 里有 `text`、`zh`、`analysis`(都是内容),管理端**永不查询该表**,而且该表没有生成时间,数不出「今天」;spec §5.2 把额度按「句」计且「命中已存的不计」,计数口径正好是「今天花了多少额度」,存在 `daily_usage`。scope 名 spec 没写,本计划**假设** `library_translate` 与 `library_analysis`(与 `library_asr`、metering 前缀 `library_translate` / `library_analysis` 同风格),A0 第 11 项读 S1 真实代码确认;为了不依赖 S1 是只写全站行(`subject="*"`)、只写每人行、还是两者都写,取值用 `max(全站行, 每人行之和)`(`_day_total`)。全站合计上限 `library_ai_daily_global` 是两类之和,页面分别显示两个数字与上限,不在服务端求和。*代价*:S1 用了别的 scope 名时总览显示 0(AS2 的测试会先发现);只在「全站行」与「每人行」都不存在时才真的为 0。
- **R-A21(D8)隐私:管理端对句子、译文、分析的态度与对标题 / 网址一致 —— 不选、不读、不记。** 测试用带标记的句子、译文、分析(`SENTENCE` / `ZH` / `ANALYSIS`)写进 `library_segments`,逐端点扫描响应、`caplog` 与审计行(扩展 `no_content`);删除条目的测试额外断言该条目的句子行被 S1 一并删除(缺陷归 S1,处理方式同 `media.exists()` 一行)。*代价*:无。
- **R-A22(D8)设置页不用改:`GROUPS` 的 `("library","跟读库")` 与四个 AI 设置由 S1 的登记表一次性加好,管理端「设置」页按服务端返回的分组渲染,自动出现。** 依据 `admin/src/features/settings/settings-page.tsx` 的 `groups` 来自接口(没有写死的分组表)。本计划只在总览页保留指向 `/settings/library` 的链接,并把 AI 开关的状态与今日数字显示出来;**不**新增配额覆盖键(spec §2.2 只要求 `library_quota_mb`、`library_max_items` 进 `QUOTA_KEYS`)。*代价*:无。
- **R-A23(D11 / D12 / E9 / D10 与管理端)全部与本车道无关,明确不做:** 深色优先的强玻璃(D11)只用在 `web/` 的跟读库页面;「外观:跟随系统 / 浅色 / 深色」(D12)是 `web/src/settings` 的全站设置;独立底部标签(E9)是网页导航;管理后台沿用现有 `admin/src/index.css` 的样式,**不加玻璃、不加外观开关**。D10 的第二期清单(录音管理、转写稿下载、重新识别、摘要等)也不进管理端。*代价*:无。

---

### Task A0: 前置核对(S1 的接口)

**Files:**
- Modify(追加一节):`docs/superpowers/plans/2026-10-13-video-import-results.md`(不存在就创建,第一行写 `# 跟读库(video import)· 实测结果`,下面空一行)

- [ ] **Step 1: 确认 S1 已合并且迁移头。** `cd server && uv run alembic heads` → 记录输出(spec 期望 `0018`,若 S1 顺延就记真实号;本车道不建迁移,只记录)。
- [ ] **Step 2: 逐项读真实代码(用 Grep / Read 工具),把结果填进下表;任何一行「不成立 / 不同」按右列处理。**

| # | 核对 | 怎么看 | 不成立时 |
|---|---|---|---|
| 1 | `app.models.LibraryItem` 的列名与可空性与 spec §4 一致(`id, user_id, kind, source, title, status, stage, progress, error_kind, attempts, next_run_at, source_host, source_url, upload_total, upload_received, duration_ms, media_path, poster_path, media_mime, library_bytes, sub_source, asr_seconds, seg_count, resume_ms, resume_idx, rate_pct, created_at, updated_at, last_opened_at`) | `Grep "class LibraryItem" -A45 server/app/models.py` | 只改 `tests/test_admin_library.py::add_item`(R-A18);若 `status` / `kind` / `library_bytes` / `source_host` / `user_id` / `created_at` 改了名,停下报告 |
| 2 | `app.library.store` 有删除函数(spec 名 `delete_item`):真实签名、是否自己 `commit`、是否取消运行中的任务并删 `library/<uid>/<id>/` 与 `library/_tmp/<id>/` | `Grep "^async def \|^def " server/app/library/store.py`,读 `delete_item` 全文 | 只改 `library_admin._s1_delete`(R-A3);若根本没有可复用的删除函数,停下报告 |
| 3 | 取消函数(spec §6.5 `POST …/cancel` 背后的那个):名字、签名、所在模块(`store` 或 `worker`) | 读 `routers/library.py` 的 cancel 端点调用了什么 | 只改 `library_admin._s1_cancel` 与 AS3 Step 3 的 import;没有可复用函数就停下报告 |
| 4 | 识别计数:`daily_usage` 的 `scope` / 全站 `subject` 取值,是否导出常量 | `Grep "library_asr" server/app/library` | 按 R-A5 改 `ASR_SCOPE` / `ASR_GLOBAL_SUBJECT`(或改为导入 S1 常量)与 AS2 测试里的 `DailyUsage(...)` |
| 5 | worker 对象与运行中集合:`app.state.library.pending` | `Grep "pending" server/app/library/worker.py`、`Grep "state.library" server/app/main.py` | 只改 `overview` 的 `running` 一行(R-A8) |
| 6 | `core/quotas.py::QUOTA_KEYS` 含 `library_quota_mb`、`library_max_items` | `Grep "library_" server/app/core/quotas.py` | 停下报告(S1 的文件) |
| 7 | 设置字段与属性存在:`library_enabled, library_asr_enabled, library_link_import_enabled, library_quota_mb, library_max_items, library_max_upload_mb, library_max_duration_minutes, library_asr_minutes_global_daily, library_job_concurrency, library_link_allow_generic, library_ytdlp_cookies_file, library_ytdlp_proxy`;属性 `library_available, library_asr_available, library_link_available`;D8 增补:字段 `library_ai_enabled, library_translate_daily_per_user, library_analysis_daily_per_user, library_ai_daily_global`、属性 `library_ai_available`(R-A19) | `Grep "library_" server/app/core/config.py` | 名字不同就按真实名字改 `library_admin.py` / `doctor.py` 的引用并在结果里列出;缺字段停下报告 |
| 8 | `tests/test_architecture.py` 的 `admin` 允许集合含 `"library"` | `Grep "\"admin\":" -A2 server/tests/test_architecture.py` | 停下报告(spec §3「`admin` 的允许列表追加 `library`」是 S1 的改动) |
| 9 | `main.py` 的 `admin_library` 锚点原文与位置(在 `stubs` 之前) | `Grep "admin_library" server/app/main.py` | 没有锚点就按 R-A16 的后备位置 |
| 10 | 本机有没有 ffmpeg / ffprobe、yt-dlp 版本 | `where ffmpeg`(PowerShell)或 `command -v ffmpeg`;`cd server && uv run python -c "import importlib.metadata as m; print(m.version('yt-dlp'))"` | 只记录(AS2 的真实 ffmpeg 测试在没有 ffmpeg 时跳过) |
| 11 | D8 的额度计数:译文与分析在 `daily_usage` 里的 `scope` 取值与 `subject`(全站 `*` 行、每人行,还是只有其一),是否导出常量(R-A20) | `Grep "library_translate\|library_analysis" server/app/library`、读 `app/library/ai.py` 与 `limits.py` | 改 `library_admin.AI_TRANSLATE_SCOPE` / `AI_ANALYSIS_SCOPE`(或改为导入 S1 常量)与 AS2 测试里 `DailyUsage(...)` 的 scope;若 S1 只存「两类合计」一个 scope 而没有分开计数,**停下**报告编排者(总览要分别显示两个数字,spec §15) |
| 12 | `app.models.LibrarySegment` 的列(`item_id, idx, start_ms, end_ms, text, zh, zh_lang, analysis, analysis_lang`,spec §4)与 `add_item(..., segments=True)` 写入的行一致 | `Grep "class LibrarySegment" -A15 server/app/models.py` | 只改 `tests/test_admin_library.py::add_item` 的 `segments` 分支(R-A18 / R-A21) |

- [ ] **Step 3: 追加结果一节**(把方括号换成真实结论,不编造):

```markdown
## A 管理端 · 前置核对(计划 2026-10-13-video-import-admin.md Task A0)

- 日期 / 基于提交:[YYYY-MM-DD / git rev-parse --short HEAD]
- alembic heads:[输出]
- LibraryItem 列:[与 spec §4 一致 / 差异列表];add_item 是否调整:[是/否]
- 删除函数:[模块.函数(签名)];自己提交:[是/否];取消运行中任务并清两个目录:[是/否]
- 取消函数:[模块.函数(签名)]
- 识别计数:scope=[…] 全站 subject=[…](常量:[有/无])
- worker:app.state.library.pending [存在/改名为 …]
- QUOTA_KEYS 含 library_quota_mb / library_max_items:[是/否]
- 设置字段与属性(含 D8 的四个 AI 设置与 library_ai_available):[齐全 / 差异]
- AI 额度计数:译文 scope=[…] 分析 scope=[…] 全站 subject=[…](全站行 / 每人行 / 两者;常量:[有/无])
- LibrarySegment 列:[与 spec §4 一致 / 差异];add_item 的 segments 分支是否调整:[是/否]
- test_architecture 中 admin 可导入 library:[是/否]
- main.py 锚点:[原文 / 没有,用后备位置]
- 本机 ffmpeg:[有(版本)/ 无];yt-dlp:[版本 / 未安装]
- 结论:[可以开始 AS1 / 停在第 N 项,原因]
```

- [ ] **Step 4: 提交**(只有这一个文档改动):

```
docs: record video-import admin preflight against the merged server core

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

## 服务端任务组(AS)

### Task AS1: 配置诊断的四个发现

**Files:**
- Modify: `server/app/admin/doctor.py`
- Create: `server/tests/test_admin_library.py`(第一部分)

**Interfaces:**
- Produces(`app/admin/doctor.py`):`CODES` 追加四项;`Facts.library_ffmpeg_ok: bool = True`、`Facts.library_ytdlp_ok: bool = True`、`Facts.library_cookies: str = "unset"`(`unset | ok | missing | too_open`);`_library_findings(s, f) -> list[Finding]`;`_library_ffmpeg_ok() -> bool`、`_library_ytdlp_ok() -> bool`、`_cookies_state(path, *, stat_fn=os.stat, posix=os.name == "posix") -> str`。
- Consumes:`app.core.config.asr_stream_usable`、`whisper_fallback_configured`(已存在);S1 的设置字段 `library_enabled`、`library_link_import_enabled`、`library_asr_enabled`、`library_ytdlp_cookies_file`(spec §5.2)。

- [ ] **Step 1: 写失败测试** — 创建 `server/tests/test_admin_library.py`:

```python
"""管理端「跟读库」(计划 docs/superpowers/plans/2026-10-13-video-import-admin.md;spec 2026-10-13-video-import §5.2、§12、E10)。

条目直接写库造数据(学习者端点由 S1 测);删除与取消经 S1 的 `app.library.store`(计划 R-A3)。"""
import os
import stat
from dataclasses import replace

import pytest

from app.admin.doctor import CODES, _cookies_state, diagnose
from tests.admin_helpers import ADMIN_ENABLED, login_as
from tests.conftest import make_settings
from tests.test_admin_doctor import OK

LIBRARY_CODES = {"library_ffmpeg_missing", "library_ytdlp_missing", "library_asr_unavailable", "library_cookies_missing"}
NO_ASR = {"upstream_whisper_base_url": ""}  # make_settings 默认配了 Whisper;流式识别默认没开


@pytest.fixture
def settings_overrides(tmp_path):
    return {**ADMIN_ENABLED, "data_dir": str(tmp_path / "data"), "library_enabled": True}


def lib_codes(settings, facts=OK) -> dict:
    return {f.code: f for f in diagnose(settings, facts) if f.code.startswith("library_")}


def fake_stat(mode: int):
    return lambda _path: os.stat_result((mode, 0, 0, 1, 0, 0, 10, 0, 0, 0))


def test_new_codes_are_registered():
    assert LIBRARY_CODES <= set(CODES)


def test_nothing_is_reported_while_the_library_is_off():
    facts = replace(OK, library_ffmpeg_ok=False, library_ytdlp_ok=False, library_cookies="missing")
    s = make_settings(library_enabled=False, library_link_import_enabled=True, library_asr_enabled=True,
                      library_ytdlp_cookies_file="/srv/cookies.txt", **NO_ASR)
    assert lib_codes(s, facts) == {}


def test_healthy_library_has_no_findings():
    s = make_settings(library_enabled=True, library_link_import_enabled=True, library_asr_enabled=True)
    assert lib_codes(s) == {}


def test_missing_ffmpeg_is_an_error():
    found = lib_codes(make_settings(library_enabled=True), replace(OK, library_ffmpeg_ok=False))
    assert set(found) == {"library_ffmpeg_missing"}
    assert found["library_ffmpeg_missing"].level == "error"
    assert found["library_ffmpeg_missing"].keys == ("library_enabled",)


def test_missing_ytdlp_only_matters_with_link_import_on():
    facts = replace(OK, library_ytdlp_ok=False)
    assert lib_codes(make_settings(library_enabled=True), facts) == {}
    found = lib_codes(make_settings(library_enabled=True, library_link_import_enabled=True), facts)
    assert found["library_ytdlp_missing"].level == "warn"
    assert found["library_ytdlp_missing"].keys == ("library_link_import_enabled",)


def test_asr_switch_without_a_recognizer():
    assert lib_codes(make_settings(library_enabled=True, library_asr_enabled=True)) == {}  # Whisper 已配
    found = lib_codes(make_settings(library_enabled=True, library_asr_enabled=True, **NO_ASR))
    assert found["library_asr_unavailable"].level == "warn"
    assert found["library_asr_unavailable"].keys == ("library_asr_enabled",)
    assert lib_codes(make_settings(library_enabled=True, **NO_ASR)) == {}  # 子开关没开就不报


def test_cookie_file_states():
    assert _cookies_state("") == "unset"
    assert _cookies_state("   ") == "unset"
    assert _cookies_state(None) == "unset"

    def boom(_path):
        raise FileNotFoundError("nope")

    assert _cookies_state("/x", stat_fn=boom, posix=True) == "missing"
    assert _cookies_state("/x", stat_fn=fake_stat(stat.S_IFDIR | 0o700), posix=True) == "missing"
    assert _cookies_state("/x", stat_fn=fake_stat(stat.S_IFREG | 0o644), posix=True) == "too_open"
    assert _cookies_state("/x", stat_fn=fake_stat(stat.S_IFREG | 0o600), posix=True) == "ok"
    assert _cookies_state("/x", stat_fn=fake_stat(stat.S_IFREG | 0o400), posix=True) == "ok"
    assert _cookies_state("/x", stat_fn=fake_stat(stat.S_IFREG | 0o644), posix=False) == "ok"  # Windows 不判权限


def test_cookie_findings_never_echo_the_path():
    path = "/srv/secret-dir/yt-cookies.txt"
    s = make_settings(library_enabled=True, library_ytdlp_cookies_file=path)
    messages = set()
    for state in ("missing", "too_open"):
        found = lib_codes(s, replace(OK, library_cookies=state))
        assert set(found) == {"library_cookies_missing"}
        assert found["library_cookies_missing"].level == "warn"
        assert found["library_cookies_missing"].keys == ("library_ytdlp_cookies_file",)
        assert path not in found["library_cookies_missing"].message_zh
        messages.add(found["library_cookies_missing"].message_zh)
    assert len(messages) == 2  # 不存在与权限过宽是两种文案
    assert lib_codes(s, replace(OK, library_cookies="ok")) == {}


async def test_doctor_endpoint_gathers_library_facts(app, client, monkeypatch):
    monkeypatch.setattr("app.admin.doctor._library_ffmpeg_ok", lambda: False)
    monkeypatch.setattr("app.admin.doctor._library_ytdlp_ok", lambda: True)
    await login_as(app, client, "viewer")
    r = await client.get("/api/admin/doctor")
    assert r.status_code == 200, r.text
    found = {f["code"]: f for f in r.json()["findings"]}
    assert found["library_ffmpeg_missing"]["level"] == "error"
    assert "library_ytdlp_missing" not in found and "library_cookies_missing" not in found
```

- [ ] **Step 2: 运行,确认失败** — `cd server && uv run pytest -q tests/test_admin_library.py`。预期:`ImportError: cannot import name '_cookies_state'`。

- [ ] **Step 3: 实现** — 对 `server/app/admin/doctor.py` 做六处 Edit。

(a)标准库导入:

old:
```python
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal
```
new:
```python
import importlib.util
import os
import shutil
import stat as stat_mod
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal
```

(b)配置函数导入:

old: `from app.core.config import realtime_asr_configured`
new: `from app.core.config import asr_stream_usable, realtime_asr_configured, whisper_fallback_configured`

(c)`CODES`:

old:
```python
    "links_breaker_open", "links_dropping", "agents_unavailable", "agents_native_unverified",
)
```
new:
```python
    "links_breaker_open", "links_dropping", "agents_unavailable", "agents_native_unverified",
    "library_ffmpeg_missing", "library_ytdlp_missing", "library_asr_unavailable", "library_cookies_missing",
)
```

(d)`Facts` 末尾:

old:
```python
    agents_probe_ok: bool = False  # last native function calling probe passed (this process; plan R-C7)
```
new:
```python
    agents_probe_ok: bool = False  # last native function calling probe passed (this process; plan R-C7)
    library_ffmpeg_ok: bool = True  # ffmpeg and ffprobe on PATH (video import spec §5.2)
    library_ytdlp_ok: bool = True  # the yt_dlp module can be found (link import)
    library_cookies: str = "unset"  # LIBRARY_YTDLP_COOKIES_FILE: unset | ok | missing | too_open
```

(e)`_realtime_reasons` 之后、`def diagnose` 之前插入 `_library_findings`,并在 `diagnose` 里排序前调用它:

old:
```python
def diagnose(s, f: Facts) -> list[Finding]:
    out: list[Finding] = []
```
new:
```python
def _library_findings(s, f: Facts) -> list[Finding]:
    """跟读库(spec 2026-10-13-video-import §5.2):只在总开关打开时检查;消息只写键名,不写路径或代理地址。"""
    out: list[Finding] = []
    if not f.library_ffmpeg_ok:
        out.append(Finding("error", "library_ffmpeg_missing", ("library_enabled",),
                           "跟读库已开启,但服务器上找不到 ffmpeg / ffprobe:上传与链接导入都无法处理"))
    if getattr(s, "library_link_import_enabled", False) and not f.library_ytdlp_ok:
        out.append(Finding("warn", "library_ytdlp_missing", ("library_link_import_enabled",),
                           "链接导入已打开,但服务器上没有安装 yt-dlp:链接页签会显示不可用"))
    if getattr(s, "library_asr_enabled", False) and not (asr_stream_usable(s) or whisper_fallback_configured(s)):
        out.append(Finding("warn", "library_asr_unavailable", ("library_asr_enabled",),
                           "跟读库自动转写已打开,但没有可用的语音识别(流式识别或 Whisper):没有字幕的素材会失败"))
    if f.library_cookies == "missing":
        out.append(Finding("warn", "library_cookies_missing", ("library_ytdlp_cookies_file",),
                           "LIBRARY_YTDLP_COOKIES_FILE 已配置,但文件不存在或不是普通文件"))
    elif f.library_cookies == "too_open":
        out.append(Finding("warn", "library_cookies_missing", ("library_ytdlp_cookies_file",),
                           "yt-dlp 的 cookies 文件权限比 0600 宽:它含账号会话,等同密钥,请改为只有服务进程可读"))
    return out


def diagnose(s, f: Facts) -> list[Finding]:
    out: list[Finding] = []
```

old:
```python
    rank = {"error": 0, "warn": 1, "info": 2}
    return sorted(out, key=lambda x: rank[x.level])
```
new:
```python
    if getattr(s, "library_enabled", False):
        out.extend(_library_findings(s, f))
    rank = {"error": 0, "warn": 1, "info": 2}
    return sorted(out, key=lambda x: rank[x.level])
```

(f)事实收集函数(插在 `def _backups` 之前)与 `gather_facts` 的返回:

old:
```python
def _backups(base) -> int:
```
new:
```python
def _library_ffmpeg_ok() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _library_ytdlp_ok() -> bool:
    """只找模块,不 import(yt_dlp 的 import 很慢)。"""
    try:
        return importlib.util.find_spec("yt_dlp") is not None
    except (ImportError, ValueError):
        return False


def _cookies_state(path: str | None, *, stat_fn: Callable[[str], os.stat_result] = os.stat,
                   posix: bool = os.name == "posix") -> str:
    """unset | ok | missing | too_open。权限只在 POSIX 上判(Windows 的 st_mode 没有权限位,计划 R-A12)。"""
    path = (path or "").strip()
    if not path:
        return "unset"
    try:
        info = stat_fn(path)
    except OSError:
        return "missing"
    if not stat_mod.S_ISREG(info.st_mode):
        return "missing"
    if posix and stat_mod.S_IMODE(info.st_mode) & 0o077:
        return "too_open"
    return "ok"


def _backups(base) -> int:
```

old:
```python
        agents_probe_ok=bool((getattr(app.state, "agents_tools_probe", None) or {}).get("ok")),
    )
```
new:
```python
        agents_probe_ok=bool((getattr(app.state, "agents_tools_probe", None) or {}).get("ok")),
        library_ffmpeg_ok=_library_ffmpeg_ok(), library_ytdlp_ok=_library_ytdlp_ok(),
        library_cookies=_cookies_state(getattr(app.state.settings, "library_ytdlp_cookies_file", "")),
    )
```

- [ ] **Step 4: 运行,确认通过** — `cd server && uv run pytest -q tests/test_admin_library.py tests/test_admin_doctor.py tests/test_architecture.py`。预期全绿(`test_admin_doctor.py` 不改也通过:新字段有健康默认值)。

- [ ] **Step 5: 提交**

```
feat(server): config doctor findings for the video library (ffmpeg, yt-dlp, ASR, cookies)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task AS2: 读端点(总览、条目、占用排行、单个用户)

**Files:**
- Create: `server/app/admin/library_admin.py`(第一部分)
- Create: `server/app/routers/admin_library.py`(第一部分)
- Modify: `server/app/main.py`(两处,R-A16)
- Modify: `server/tests/test_admin_library.py`(导入块 + 末尾追加)

**Interfaces:**
- Produces(`app/admin/library_admin.py`):常量 `PAGE_SIZE = 50`、`TOP_USERS = 10`、`STATUSES`、`ASR_SCOPE = "library_asr"`、`ASR_GLOBAL_SUBJECT = "*"`、`TOOLS_TTL_SECONDS = 600.0`、`AI_TRANSLATE_SCOPE = "library_translate"`、`AI_ANALYSIS_SCOPE = "library_analysis"`(R-A20);`async _day_total(session, scope, day) -> int`;`class LibraryAdminError(status, message, details=None)`;`purge_phrase(count) -> str`;`parse_ffmpeg_version(line) -> str | None`;`ytdlp_version() -> str | None`;`async ffmpeg_version() -> str | None`;`async tool_versions(app) -> {"ffmpeg", "ytdlp"}`;`async overview(session, app, now) -> dict`;`async items(session, *, status, user_id, kind, page) -> dict`;`async top_users(session, limit=TOP_USERS) -> list[dict]`;`async user_usage(session, settings, user_id, now) -> dict`。
- Produces(HTTP,全部 `require("viewer")`):
  - `GET /api/admin/library` → `{enabled, available, asr:{enabled, available, today_minutes, global_daily_minutes}, link:{enabled, available, allow_generic, cookies_configured, proxy_configured}, tools:{ffmpeg, ytdlp}, totals:{items, bytes, users}, by_status:{uploading, queued, processing, ready, failed, canceled}, queue:{queued, processing, running, concurrency}, ai:{enabled, available, today_translated, today_analysed, global_daily, translate_daily_per_user, analysis_daily_per_user}(D8,R-A19), limits:{quota_mb, max_items, max_upload_mb, max_duration_minutes}, purge_confirm}`
  - `GET /api/admin/library/items?status=&kind=&user_id=&page=` → `{items:[行(R-A7)], page, next, total}`
  - `GET /api/admin/library/top-users` → `{users:[{user_id, username, items, bytes}]}`
  - `GET /api/admin/library/users/{user_id}` → `{user_id, enabled, items, bytes, quota_mb, max_items, by_status}`;用户不存在 404 `{"error":"User not found"}`
- Consumes(S1,spec §4 / §5.2 / §6.1 / §6.4.7):`app.models.LibraryItem`;`Settings.library_*` 字段与 `library_available` / `library_asr_available` / `library_link_available` 属性;`core.quotas.quota_for(session, settings, user_id, "library_quota_mb" | "library_max_items", now)`;`app.state.library.pending`(可无);D8:`Settings.library_ai_enabled` / `library_translate_daily_per_user` / `library_analysis_daily_per_user` / `library_ai_daily_global` 与属性 `library_ai_available`(spec §5.2、§15「D8 增补的归属」),`daily_usage` 里译文 / 分析的计数(scope 名假设 `library_translate` / `library_analysis`,A0 第 11 项)。

- [ ] **Step 1: 写失败测试** — 先把 `server/tests/test_admin_library.py` 的导入块换掉(Edit):

old:
```python
import os
import stat
from dataclasses import replace

import pytest

from app.admin.doctor import CODES, _cookies_state, diagnose
from tests.admin_helpers import ADMIN_ENABLED, login_as
```
new:
```python
import json
import logging
import os
import shutil
import stat
import uuid
from dataclasses import replace
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.admin import library_admin
from app.admin.doctor import CODES, _cookies_state, diagnose
from app.models import AdminAudit, DailyUsage, LibraryItem, LibrarySegment, User, UserQuotaOverride, utcnow
from app.services.usage import utc_day
from tests.admin_helpers import ADMIN_ENABLED, assert_no_secrets, login_as
```

再在文件末尾追加(前面空两行):

```python
# ---- 读端点(AS2) ----------------------------------------------------------------------------------------------

API = "/api/admin/library"
ALICE, BOB = 10000101, 10000102
TITLE = "Secret Title Alpha"
URL = "https://media.example.com/watch?v=secret-path-123"
SENTENCE = "Secret sentence alpha"  # D8:句子、译文、分析都是内容(R-A21),管理端永不读
ZH = "秘密译文阿尔法"
ANALYSIS = "Secret analysis alpha"
CONTENT_MARKERS = (SENTENCE, ZH, ANALYSIS)
ROW_KEYS = {"id", "user_id", "username", "kind", "source", "status", "stage", "progress", "error_kind",
            "duration_ms", "bytes", "sub_source", "source_host", "created_at"}
NO_STATUS = {"uploading": 0, "queued": 0, "processing": 0, "ready": 0, "failed": 0, "canceled": 0}


async def add_users(app):
    async with app.state.sessionmaker() as s:
        s.add(User(id=ALICE, username="alice", password_hash="x"))
        s.add(User(id=BOB, username="bob", password_hash="x"))
        await s.commit()


async def add_item(app, user_id, *, status="ready", kind="video", source="link", nbytes=1_000_000,
                   error_kind=None, stage=None, progress=100, age_minutes=0, media=False, segments=False) -> str:
    """一个条目,所有列显式给值(计划 R-A18:列名以 S1 的 models.LibraryItem 为准,不一致只改这里)。
    media=True 时按 spec §5.1 的布局写一个假媒体文件。"""
    item_id = str(uuid.uuid4())
    now = utcnow() - timedelta(minutes=age_minutes)
    rel = f"library/{user_id}/{item_id}/media.{'mp4' if kind == 'video' else 'm4a'}"
    if media:
        path = app.state.settings.resolved_data_dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"\0" * 16)
    link = source == "link"
    async with app.state.sessionmaker() as s:
        s.add(LibraryItem(
            id=item_id, user_id=user_id, kind=kind, source=source, title=TITLE, status=status, stage=stage,
            progress=progress, error_kind=error_kind, attempts=0, next_run_at=None,
            source_host="www.youtube.com" if link else None, source_url=URL if link else None,
            upload_total=nbytes, upload_received=nbytes, duration_ms=61_000, media_path=rel if media else None,
            poster_path=None, media_mime="video/mp4" if kind == "video" else "audio/mp4", library_bytes=nbytes,
            sub_source="platform" if status == "ready" else None, asr_seconds=0,
            seg_count=3 if status == "ready" else 0, resume_ms=0, resume_idx=0, rate_pct=100,
            created_at=now, updated_at=now, last_opened_at=None))
        if segments:  # D8:带句子、译文、分析的内容行,用来证明管理端哪里都不读 library_segments
            for idx in range(2):
                s.add(LibrarySegment(item_id=item_id, idx=idx, start_ms=idx * 3000, end_ms=idx * 3000 + 2500,
                                     text=SENTENCE, zh=ZH, zh_lang="zh-CN", analysis=ANALYSIS, analysis_lang="zh-CN"))
        await s.commit()
    return item_id


async def segment_count(app, item_id: str) -> int:
    async with app.state.sessionmaker() as s:
        return len((await s.scalars(select(LibrarySegment.idx).where(LibrarySegment.item_id == item_id))).all())


def no_content(text: str) -> None:
    assert TITLE not in text and "secret-path-123" not in text and "media.example.com" not in text
    for marker in CONTENT_MARKERS:
        assert marker not in text


@pytest.fixture
def tools(monkeypatch):
    async def ffmpeg():
        return "7.1"

    monkeypatch.setattr(library_admin, "ffmpeg_version", ffmpeg)
    monkeypatch.setattr(library_admin, "ytdlp_version", lambda: "2026.09.30")


async def test_overview_counts_numbers_only(app, client, tools):
    await add_users(app)
    await add_item(app, ALICE, nbytes=3_000_000, segments=True)
    await add_item(app, ALICE, status="failed", kind="audio", source="upload", nbytes=500_000, error_kind="corrupt")
    await add_item(app, BOB, status="processing", stage="transcode", progress=40, nbytes=0)
    await add_item(app, BOB, status="queued", nbytes=0)
    async with app.state.sessionmaker() as s:
        day = utc_day(utcnow())
        s.add(DailyUsage(scope="library_asr", subject="*", day=day, count=1500))
        s.add(DailyUsage(scope="library_asr", subject=str(ALICE), day=day, count=1500))
        await s.commit()
    await login_as(app, client, "viewer")
    r = await client.get(API)
    assert r.status_code == 200, r.text
    body = r.json()
    s = app.state.settings
    assert body["enabled"] is True
    assert body["totals"] == {"items": 4, "bytes": 3_500_000, "users": 2}
    assert body["by_status"] == {**NO_STATUS, "queued": 1, "processing": 1, "ready": 1, "failed": 1}
    assert body["queue"] == {"queued": 1, "processing": 1, "running": 0, "concurrency": s.library_job_concurrency}
    assert body["asr"]["enabled"] is False and body["asr"]["today_minutes"] == 25.0
    assert body["asr"]["global_daily_minutes"] == s.library_asr_minutes_global_daily
    assert body["tools"] == {"ffmpeg": "7.1", "ytdlp": "2026.09.30"}
    assert body["link"]["enabled"] is False
    assert body["link"]["cookies_configured"] is False and body["link"]["proxy_configured"] is False
    assert body["limits"] == {"quota_mb": s.library_quota_mb, "max_items": s.library_max_items,
                              "max_upload_mb": s.library_max_upload_mb,
                              "max_duration_minutes": s.library_max_duration_minutes}
    assert body["purge_confirm"] == "PURGE 1 ITEMS"
    assert body["ai"] == {"enabled": False, "available": False, "today_translated": 0, "today_analysed": 0,
                          "global_daily": s.library_ai_daily_global,
                          "translate_daily_per_user": s.library_translate_daily_per_user,
                          "analysis_daily_per_user": s.library_analysis_daily_per_user}
    no_content(r.text)
    assert_no_secrets(body, s)


async def test_overview_reports_cookie_and_proxy_presence_only(app, client, tools):
    app.state.settings = app.state.settings.model_copy(update={
        "library_link_import_enabled": True, "library_ytdlp_cookies_file": "/run/secrets/yt-cookies.txt",
        "library_ytdlp_proxy": "http://user:pa55word@proxy.example:8080"})
    await login_as(app, client, "viewer")
    r = await client.get(API)
    assert r.status_code == 200, r.text
    link = r.json()["link"]
    assert link["enabled"] is True and link["cookies_configured"] is True and link["proxy_configured"] is True
    assert "yt-cookies" not in r.text and "pa55word" not in r.text and "proxy.example" not in r.text


async def test_overview_ai_block_counts_todays_sentences_from_daily_usage(app, client, tools):
    await add_users(app)
    await add_item(app, ALICE, segments=True)  # 句子行存在也不会被读(R-A20、R-A21)
    day = utc_day(utcnow())
    old_day = utc_day(utcnow() - timedelta(days=2))
    async with app.state.sessionmaker() as s:
        # 译文:全站行与每人行都有(取较大者,不重复相加)
        s.add(DailyUsage(scope="library_translate", subject="*", day=day, count=120))
        s.add(DailyUsage(scope="library_translate", subject=str(ALICE), day=day, count=100))
        s.add(DailyUsage(scope="library_translate", subject=str(BOB), day=day, count=20))
        # 分析:只有每人行
        s.add(DailyUsage(scope="library_analysis", subject=str(ALICE), day=day, count=3))
        s.add(DailyUsage(scope="library_analysis", subject=str(BOB), day=day, count=1))
        # 别的日子、别的 scope 都不算
        s.add(DailyUsage(scope="library_translate", subject="*", day=old_day, count=999))
        s.add(DailyUsage(scope="library_asr", subject="*", day=day, count=600))
        await s.commit()
    await login_as(app, client, "viewer")
    ai = (await client.get(API)).json()["ai"]
    assert (ai["today_translated"], ai["today_analysed"]) == (120, 4)
    assert ai["enabled"] is False

    app.state.settings = app.state.settings.model_copy(update={"library_ai_enabled": True})
    r = await client.get(API)
    assert r.status_code == 200, r.text
    ai = r.json()["ai"]
    s = app.state.settings
    assert ai["enabled"] is True
    assert (ai["global_daily"], ai["translate_daily_per_user"], ai["analysis_daily_per_user"]) == (
        s.library_ai_daily_global, s.library_translate_daily_per_user, s.library_analysis_daily_per_user)
    no_content(r.text)


async def test_items_filter_and_page_without_content(app, client, monkeypatch):
    await add_users(app)
    ready = await add_item(app, ALICE, age_minutes=3, segments=True)
    failed = await add_item(app, ALICE, status="failed", kind="audio", source="upload", error_kind="no_subtitles",
                            age_minutes=2)
    busy = await add_item(app, BOB, status="processing", stage="transcribe", progress=70, age_minutes=1)
    await login_as(app, client, "viewer")

    r = await client.get(f"{API}/items")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [i["id"] for i in body["items"]] == [busy, failed, ready]  # 新的在前
    assert (body["total"], body["page"], body["next"]) == (3, 1, None)
    assert all(set(i) == ROW_KEYS for i in body["items"])
    row = body["items"][1]
    assert (row["username"], row["kind"], row["source"], row["status"], row["error_kind"], row["source_host"]) == (
        "alice", "audio", "upload", "failed", "no_subtitles", None)
    assert body["items"][2]["source_host"] == "www.youtube.com" and body["items"][2]["bytes"] == 1_000_000
    assert body["items"][2]["duration_ms"] == 61_000 and body["items"][2]["sub_source"] == "platform"
    no_content(r.text)

    assert [i["id"] for i in (await client.get(f"{API}/items", params={"status": "failed"})).json()["items"]] == [failed]
    assert [i["id"] for i in (await client.get(f"{API}/items", params={"kind": "audio"})).json()["items"]] == [failed]
    by_bob = (await client.get(f"{API}/items", params={"user_id": BOB})).json()
    assert [i["id"] for i in by_bob["items"]] == [busy]
    assert (by_bob["items"][0]["stage"], by_bob["items"][0]["progress"], by_bob["total"]) == ("transcribe", 70, 1)

    monkeypatch.setattr(library_admin, "PAGE_SIZE", 2)
    first = (await client.get(f"{API}/items")).json()
    assert len(first["items"]) == 2 and first["next"] == 2
    second = (await client.get(f"{API}/items", params={"page": 2})).json()
    assert [i["id"] for i in second["items"]] == [ready] and second["next"] is None


@pytest.mark.parametrize("query", [{"status": "bogus"}, {"kind": "image"}, {"user_id": 0}, {"page": 0}])
async def test_items_rejects_bad_filters(app, client, query):
    await login_as(app, client, "viewer")
    assert (await client.get(f"{API}/items", params=query)).status_code == 422


async def test_top_users_by_bytes(app, client):
    await add_users(app)
    await add_item(app, ALICE, nbytes=100)
    await add_item(app, ALICE, nbytes=200)
    await add_item(app, BOB, nbytes=5_000)
    await login_as(app, client, "viewer")
    r = await client.get(f"{API}/top-users")
    assert r.status_code == 200, r.text
    assert r.json() == {"users": [{"user_id": BOB, "username": "bob", "items": 1, "bytes": 5_000},
                                  {"user_id": ALICE, "username": "alice", "items": 2, "bytes": 300}]}


async def test_user_usage_honours_quota_overrides(app, client):
    await add_users(app)
    await add_item(app, ALICE, nbytes=7_000)
    await add_item(app, ALICE, status="failed", nbytes=0)
    async with app.state.sessionmaker() as s:
        s.add(UserQuotaOverride(user_id=ALICE, key="library_quota_mb", value=5000, expires_at=None, note="",
                                updated_by="test", updated_at=utcnow()))
        await s.commit()
    await login_as(app, client, "viewer")
    r = await client.get(f"{API}/users/{ALICE}")
    assert r.status_code == 200, r.text
    assert r.json() == {"user_id": ALICE, "enabled": True, "items": 2, "bytes": 7_000, "quota_mb": 5000,
                        "max_items": app.state.settings.library_max_items,
                        "by_status": {**NO_STATUS, "ready": 1, "failed": 1}}
    bob = (await client.get(f"{API}/users/{BOB}")).json()
    assert (bob["items"], bob["bytes"], bob["quota_mb"]) == (0, 0, app.state.settings.library_quota_mb)
    missing = await client.get(f"{API}/users/10009999")
    assert missing.status_code == 404 and missing.json() == {"error": "User not found"}


def test_parse_ffmpeg_version():
    line = "ffmpeg version 5.1.6-0+deb12u1 Copyright (c) 2000-2024 the FFmpeg developers"
    assert library_admin.parse_ffmpeg_version(line) == "5.1.6-0+deb12u1"
    assert library_admin.parse_ffmpeg_version("ffmpeg version n7.1 Copyright") == "n7.1"
    assert library_admin.parse_ffmpeg_version("") is None
    assert library_admin.parse_ffmpeg_version("Usage: ffmpeg [options]") is None


async def test_ffmpeg_version_is_none_without_ffmpeg(monkeypatch):
    monkeypatch.setattr("app.admin.library_admin.shutil.which", lambda _name: None)
    assert await library_admin.ffmpeg_version() is None


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="本机没有 ffmpeg(UNVERIFIED:在容器里再跑)")
async def test_ffmpeg_version_reads_the_real_binary():
    assert await library_admin.ffmpeg_version()


async def test_tool_versions_are_cached_per_process(app, monkeypatch):
    calls = []

    async def ffmpeg():
        calls.append(1)
        return "7.1"

    monkeypatch.setattr(library_admin, "ffmpeg_version", ffmpeg)
    monkeypatch.setattr(library_admin, "ytdlp_version", lambda: None)
    assert await library_admin.tool_versions(app) == {"ffmpeg": "7.1", "ytdlp": None}
    assert await library_admin.tool_versions(app) == {"ffmpeg": "7.1", "ytdlp": None}
    assert len(calls) == 1
```

- [ ] **Step 2: 运行,确认失败** — `cd server && uv run pytest -q tests/test_admin_library.py`。预期:`ImportError: cannot import name 'library_admin' from 'app.admin'`。

- [ ] **Step 3: 实现** — 创建 `server/app/admin/library_admin.py`:

```python
"""管理端「跟读库」(spec 2026-10-13-video-import §12、E10;计划 2026-10-13-video-import-admin)。

管理员看不到内容:查询只选数字、状态、种类、阶段与来源主机名列,永不选 `title`、`source_url`、`media_path`、
`poster_path`,也不读 `library_segments` / `library_attempts`(计划 R-A7)。审计只记条目 id、字节数与数量(R-A6)。
条目的删除与取消只经 S1 的 `app.library.store`(R-A3),不在这里另写一套清理。"""
import asyncio
import importlib.metadata
import shutil
import time
from contextlib import suppress
from datetime import datetime

from sqlalchemy import func, select

from app.core.quotas import quota_for
from app.models import DailyUsage, LibraryItem, User, iso_utc
from app.services.usage import utc_day

PAGE_SIZE = 50
TOP_USERS = 10
STATUSES = ("uploading", "queued", "processing", "ready", "failed", "canceled")
ASR_SCOPE = "library_asr"  # spec §6.4.7:按秒计;subject = 用户 id 与 "*"(计划 R-A5)
ASR_GLOBAL_SUBJECT = "*"
AI_TRANSLATE_SCOPE = "library_translate"  # D8:按「句」计;scope 名是假设,A0 第 11 项核对(计划 R-A20)
AI_ANALYSIS_SCOPE = "library_analysis"
TOOLS_TTL_SECONDS = 600.0
VERSION_MAX = 40


class LibraryAdminError(Exception):
    def __init__(self, status: int, message: str, details: dict | None = None):
        super().__init__(message)
        self.status, self.message, self.details = status, message, details


def purge_phrase(count: int) -> str:
    return f"PURGE {count} ITEMS"


# ---- 工具版本(R-A9) ----

def parse_ffmpeg_version(line: str) -> str | None:
    parts = (line or "").split()
    if len(parts) >= 3 and parts[0] == "ffmpeg" and parts[1] == "version":
        return parts[2][:VERSION_MAX]
    return None


def ytdlp_version() -> str | None:
    """只读包元数据,不 import yt_dlp。"""
    try:
        return importlib.metadata.version("yt-dlp")[:VERSION_MAX]
    except importlib.metadata.PackageNotFoundError:
        return None


async def ffmpeg_version() -> str | None:
    """`ffmpeg -version` 标准输出的第一行;不经 shell,标准错误丢弃,5 s 超时。"""
    path = shutil.which("ffmpeg")
    if not path:
        return None
    try:
        proc = await asyncio.create_subprocess_exec(
            path, "-version", stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL)
    except (OSError, NotImplementedError):
        return None
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), 5.0)
    except asyncio.TimeoutError:
        with suppress(ProcessLookupError):
            proc.kill()
        with suppress(Exception):
            await proc.wait()
        return None
    lines = out.decode("utf-8", "replace").splitlines()
    return parse_ffmpeg_version(lines[0]) if lines else None


async def tool_versions(app) -> dict:
    """每进程缓存 10 分钟(总览每次打开都会调用)。"""
    cached = getattr(app.state, "library_tool_versions", None)
    now = time.monotonic()
    if cached is not None and cached[0] > now:
        return dict(cached[1])
    value = {"ffmpeg": await ffmpeg_version(), "ytdlp": ytdlp_version()}
    app.state.library_tool_versions = (now + TOOLS_TTL_SECONDS, value)
    return dict(value)


# ---- 查询 ----

_ROW_COLUMNS = (
    LibraryItem.id, LibraryItem.user_id, User.username, LibraryItem.kind, LibraryItem.source, LibraryItem.status,
    LibraryItem.stage, LibraryItem.progress, LibraryItem.error_kind, LibraryItem.duration_ms,
    LibraryItem.library_bytes, LibraryItem.sub_source, LibraryItem.source_host, LibraryItem.created_at,
)


def _row(r) -> dict:
    return {"id": r.id, "user_id": r.user_id, "username": r.username, "kind": r.kind, "source": r.source,
            "status": r.status, "stage": r.stage, "progress": int(r.progress or 0), "error_kind": r.error_kind,
            "duration_ms": r.duration_ms, "bytes": int(r.library_bytes or 0), "sub_source": r.sub_source,
            "source_host": r.source_host, "created_at": iso_utc(r.created_at)}


async def _status_counts(session, *where) -> dict[str, int]:
    rows = (await session.execute(
        select(LibraryItem.status, func.count()).where(*where).group_by(LibraryItem.status))).all()
    found = {status: int(count) for status, count in rows}
    return {status: found.get(status, 0) for status in STATUSES}


async def _day_total(session, scope: str, day) -> int:
    """某个 scope 今天的计数(R-A20):取「全站行(subject='*')」与「每人行之和」中较大的一个,
    这样 S1 只写全站行、只写每人行、或两者都写,都不会漏、也不会重复相加。只读 daily_usage,不碰 library_segments。"""
    base = (DailyUsage.scope == scope, DailyUsage.day == day)
    star = await session.scalar(select(func.coalesce(func.sum(DailyUsage.count), 0)).where(
        *base, DailyUsage.subject == ASR_GLOBAL_SUBJECT)) or 0
    users = await session.scalar(select(func.coalesce(func.sum(DailyUsage.count), 0)).where(
        *base, DailyUsage.subject != ASR_GLOBAL_SUBJECT)) or 0
    return int(max(star, users))


async def overview(session, app, now: datetime) -> dict:
    """形状 = admin `LibraryOverview` 的 snake_case;只有开关、数字与版本。"""
    s = app.state.settings
    by_status = await _status_counts(session)
    count, total, users = (await session.execute(
        select(func.count(LibraryItem.id), func.coalesce(func.sum(LibraryItem.library_bytes), 0),
               func.count(func.distinct(LibraryItem.user_id))))).one()
    asr_seconds = await session.scalar(select(DailyUsage.count).where(
        DailyUsage.scope == ASR_SCOPE, DailyUsage.subject == ASR_GLOBAL_SUBJECT, DailyUsage.day == utc_day(now))) or 0
    today = utc_day(now)
    translated = await _day_total(session, AI_TRANSLATE_SCOPE, today)
    analysed = await _day_total(session, AI_ANALYSIS_SCOPE, today)
    worker = getattr(app.state, "library", None)
    running = len(getattr(worker, "pending", None) or ())  # 本进程(R-A8)
    return {
        "enabled": bool(s.library_enabled),
        "available": bool(s.library_available),
        "asr": {"enabled": bool(s.library_asr_enabled), "available": bool(s.library_asr_available),
                "today_minutes": round(int(asr_seconds) / 60, 1),
                "global_daily_minutes": int(s.library_asr_minutes_global_daily)},
        "link": {"enabled": bool(s.library_link_import_enabled), "available": bool(s.library_link_available),
                 "allow_generic": bool(s.library_link_allow_generic),
                 "cookies_configured": bool((s.library_ytdlp_cookies_file or "").strip()),
                 "proxy_configured": bool((s.library_ytdlp_proxy or "").strip())},
        "ai": {"enabled": bool(s.library_ai_enabled), "available": bool(getattr(s, "library_ai_available", False)),
               "today_translated": translated, "today_analysed": analysed,
               "global_daily": int(s.library_ai_daily_global),
               "translate_daily_per_user": int(s.library_translate_daily_per_user),
               "analysis_daily_per_user": int(s.library_analysis_daily_per_user)},
        "tools": await tool_versions(app),
        "totals": {"items": int(count), "bytes": int(total), "users": int(users)},
        "by_status": by_status,
        "queue": {"queued": by_status["queued"], "processing": by_status["processing"], "running": running,
                  "concurrency": int(s.library_job_concurrency)},
        "limits": {"quota_mb": int(s.library_quota_mb), "max_items": int(s.library_max_items),
                   "max_upload_mb": int(s.library_max_upload_mb),
                   "max_duration_minutes": int(s.library_max_duration_minutes)},
        "purge_confirm": purge_phrase(by_status["failed"]),
    }


async def items(session, *, status: str | None, user_id: int | None, kind: str | None, page: int) -> dict:
    where = []
    if status:
        where.append(LibraryItem.status == status)
    if user_id is not None:
        where.append(LibraryItem.user_id == user_id)
    if kind:
        where.append(LibraryItem.kind == kind)
    total = await session.scalar(select(func.count(LibraryItem.id)).where(*where)) or 0
    rows = (await session.execute(
        select(*_ROW_COLUMNS).outerjoin(User, User.id == LibraryItem.user_id).where(*where)
        .order_by(LibraryItem.created_at.desc(), LibraryItem.id.desc())
        .offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE + 1))).all()
    return {"items": [_row(r) for r in rows[:PAGE_SIZE]], "page": page,
            "next": page + 1 if len(rows) > PAGE_SIZE else None, "total": int(total)}


async def top_users(session, limit: int = TOP_USERS) -> list[dict]:
    total = func.coalesce(func.sum(LibraryItem.library_bytes), 0)
    rows = (await session.execute(
        select(LibraryItem.user_id, User.username, func.count(LibraryItem.id), total)
        .outerjoin(User, User.id == LibraryItem.user_id)
        .group_by(LibraryItem.user_id, User.username)
        .order_by(total.desc(), LibraryItem.user_id)
        .limit(limit))).all()
    return [{"user_id": uid, "username": name, "items": int(n), "bytes": int(b)} for uid, name, n, b in rows]


async def user_usage(session, settings, user_id: int, now: datetime) -> dict:
    """用户详情页的占用条(R-A11);配额含按用户覆盖。"""
    if await session.get(User, user_id) is None:
        raise LibraryAdminError(404, "User not found")
    count, total = (await session.execute(
        select(func.count(LibraryItem.id), func.coalesce(func.sum(LibraryItem.library_bytes), 0))
        .where(LibraryItem.user_id == user_id))).one()
    return {"user_id": user_id, "enabled": bool(settings.library_enabled), "items": int(count), "bytes": int(total),
            "quota_mb": int(await quota_for(session, settings, user_id, "library_quota_mb", now)),
            "max_items": int(await quota_for(session, settings, user_id, "library_max_items", now)),
            "by_status": await _status_counts(session, LibraryItem.user_id == user_id)}
```

创建 `server/app/routers/admin_library.py`:

```python
"""/api/admin/library*:跟读库总览、条目、占用排行、单个用户占用;删除 / 取消 / 清理失败项(spec 2026-10-13-video-import §12)。
业务在 app/admin/library_admin.py。URL 里只有条目 uuid、用户 id、状态、种类与页码(没有标题或网址)。"""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import library_admin
from app.admin.perms import AdminContext, require
from app.core.deps import get_session
from app.models import utcnow

router = APIRouter(prefix="/api/admin/library")
ItemUuid = Annotated[str, Path(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")]
UserId = Annotated[int, Path(ge=1, le=2**31 - 1)]
Status = Literal["uploading", "queued", "processing", "ready", "failed", "canceled"]


def _error(e: library_admin.LibraryAdminError) -> JSONResponse:
    body: dict = {"error": e.message}
    if e.details:
        body["details"] = e.details
    return JSONResponse(body, status_code=e.status)


@router.get("")
async def library_overview(request: Request, _: AdminContext = Depends(require("viewer")),
                           session: AsyncSession = Depends(get_session)):
    return await library_admin.overview(session, request.app, utcnow())


@router.get("/items")
async def library_items(_: AdminContext = Depends(require("viewer")), session: AsyncSession = Depends(get_session),
                        status: Status | None = Query(None), kind: Literal["audio", "video"] | None = Query(None),
                        user_id: int | None = Query(None, ge=1, le=2**31 - 1),
                        page: int = Query(1, ge=1, le=10_000)):
    return await library_admin.items(session, status=status, user_id=user_id, kind=kind, page=page)


@router.get("/top-users")
async def library_top_users(_: AdminContext = Depends(require("viewer")),
                            session: AsyncSession = Depends(get_session)):
    return {"users": await library_admin.top_users(session)}


@router.get("/users/{user_id}")
async def library_user(user_id: UserId, request: Request, _: AdminContext = Depends(require("viewer")),
                       session: AsyncSession = Depends(get_session)):
    try:
        return await library_admin.user_usage(session, request.app.state.settings, user_id, utcnow())
    except library_admin.LibraryAdminError as e:
        return _error(e)
```

`server/app/main.py`(R-A16;两处 Edit,以 A0 第 9 项找到的锚点为准):在 `from app.routers import (...)` 的名字里加 `admin_library`,在 `for module in (...)` 的元组里加 `admin_library`。没有锚点时的后备写法——导入行:

old: `    admin, admin_accounts, admin_agents, agents,`
new: `    admin, admin_accounts, admin_agents, admin_library, agents,`

路由元组:

old: `        admin_prompts, admin_wordbook, admin_links, admin_agents, stubs, admin_web, web,`
new: `        admin_prompts, admin_wordbook, admin_links, admin_agents, admin_library, stubs, admin_web, web,`

(S1 若已改过这两行,old 字符串以真实内容为准;关键是 `admin_library` 在 `stubs` 之前。)

- [ ] **Step 4: 运行,确认通过** — `cd server && uv run pytest -q tests/test_admin_library.py tests/test_admin_routes_guarded.py tests/test_architecture.py`。

- [ ] **Step 5: 提交**

```
feat(server): admin library overview, item list, top users and per-user usage (no titles or URLs)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task AS3: 写端点(删除、取消、清理失败项)与隐私测试

**Files:**
- Modify: `server/app/admin/library_admin.py`(导入块 + 末尾追加)
- Modify: `server/app/routers/admin_library.py`(末尾追加)
- Modify: `server/tests/test_admin_library.py`(末尾追加)

**Interfaces:**
- Produces(`library_admin`):`PURGE_LIMIT = 500`、`CANCELLABLE`、`delete_phrase(item_id) -> str`、`_s1_delete(session, app, item)`、`_s1_cancel(session, app, item)`、`async delete_item(session, app, actor, item_id, *, reason, confirm) -> {"deleted", "bytes"}`、`async cancel_item(session, app, actor, item_id, *, reason) -> {"id", "status"}`、`async purge_failed(session, app, actor, *, reason, confirm) -> {"deleted", "bytes", "more"}`。
- Produces(HTTP,全部 `require("operator")`,非 GET 走 CSRF):
  - `POST /api/admin/library/items/{item_id}/delete` `{reason, confirm}` → 200 `{deleted, bytes}`;404 `Item not found`;409 `{"error":"Confirmation required","details":{"confirm":"DELETE xxxxxxxx"}}`
  - `POST /api/admin/library/items/{item_id}/cancel` `{reason}` → 200 `{id, status:"canceled"}`;404;409 `Item is not running`
  - `POST /api/admin/library/purge-failed` `{reason, confirm}` → 200 `{deleted, bytes, more}`;409 `Nothing to purge` 或 `Confirmation required` + `details.confirm`
- Consumes(S1,**假设的签名**,A0 第 2、3 项核对后只改两个适配函数):
  - spec §4「`library.store.delete_item` 与删用户都要显式删 `library_attempts`、`library_segments`、`library_items` 并清目录」→ 假设 `async def delete_item(session: AsyncSession, app: FastAPI, item: LibraryItem) -> None`:取消该条目运行中的任务、显式删三张表的行、删 `library/<uid>/<id>/` 与 `library/_tmp/<id>/`;提交与否不限(R-A3)。
  - spec §6.5「取消:`POST …/cancel`(`queued` / `processing` / `uploading` 可用)→ 终止子进程、清 `_tmp`、条目标 `canceled`」→ 假设 `async def cancel_item(session: AsyncSession, app: FastAPI, item: LibraryItem) -> None`,在 `app.library.store` 里。

- [ ] **Step 1: 写失败测试** — 在 `server/tests/test_admin_library.py` 末尾追加:

```python
# ---- 写端点与隐私(AS3) ---------------------------------------------------------------------------------------

async def audit_rows(app, action: str) -> list:
    async with app.state.sessionmaker() as s:
        return list((await s.scalars(select(AdminAudit).where(AdminAudit.action == action))).all())


async def item_ids(app) -> set[str]:
    async with app.state.sessionmaker() as s:
        return set((await s.scalars(select(LibraryItem.id))).all())


async def test_delete_needs_operator_and_the_typed_phrase(app, client):
    await add_users(app)
    item = await add_item(app, ALICE, nbytes=4_096, media=True, segments=True)
    assert await segment_count(app, item) == 2
    media = app.state.settings.resolved_data_dir / "library" / str(ALICE) / item / "media.mp4"
    assert media.exists()
    url = f"{API}/items/{item}/delete"
    phrase = f"DELETE {item[:8]}"

    viewer = await login_as(app, client, "viewer")
    denied = await client.post(url, headers=viewer, json={"reason": "clean up", "confirm": phrase})
    assert denied.status_code == 403

    operator = await login_as(app, client, "operator")
    wrong = await client.post(url, headers=operator, json={"reason": "clean up", "confirm": "DELETE"})
    assert wrong.status_code == 409
    assert wrong.json() == {"error": "Confirmation required", "details": {"confirm": phrase}}
    assert item in await item_ids(app)

    r = await client.post(url, headers=operator, json={"reason": "clean up", "confirm": phrase})
    assert r.status_code == 200, r.text
    assert r.json() == {"deleted": item, "bytes": 4_096}
    assert item not in await item_ids(app)
    assert not media.exists()  # S1 的 delete_item 清目录(spec §5.1 的布局)
    assert await segment_count(app, item) == 0  # 句子、译文、分析随条目一起删(spec §4「显式删」;缺陷归 S1)
    (row,) = await audit_rows(app, "library.item.delete")
    assert (row.target_type, row.target_id, row.after, row.reason, row.summary) == (
        "library_item", item, {"bytes": 4_096}, "clean up", "")
    again = await client.post(url, headers=operator, json={"reason": "again", "confirm": phrase})
    assert again.status_code == 404 and again.json() == {"error": "Item not found"}


async def test_item_ids_must_be_uuids(app, client):
    operator = await login_as(app, client, "operator")
    bad = await client.post(f"{API}/items/not-a-uuid/delete", headers=operator, json={"reason": "x", "confirm": "x"})
    assert bad.status_code == 422
    unknown = await client.post(f"{API}/items/{uuid.uuid4()}/cancel", headers=operator, json={"reason": "x"})
    assert unknown.status_code == 404


async def test_cancel_only_running_items(app, client):
    await add_users(app)
    queued = await add_item(app, BOB, status="queued", nbytes=0)
    ready = await add_item(app, BOB)
    operator = await login_as(app, client, "operator")
    r = await client.post(f"{API}/items/{queued}/cancel", headers=operator, json={"reason": "stuck job"})
    assert r.status_code == 200, r.text
    assert r.json() == {"id": queued, "status": "canceled"}
    async with app.state.sessionmaker() as s:
        assert (await s.get(LibraryItem, queued)).status == "canceled"
    (row,) = await audit_rows(app, "library.item.cancel")
    assert (row.target_type, row.target_id, row.before, row.reason) == (
        "library_item", queued, {"status": "queued"}, "stuck job")
    again = await client.post(f"{API}/items/{ready}/cancel", headers=operator, json={"reason": "stuck job"})
    assert again.status_code == 409 and again.json() == {"error": "Item is not running"}


async def test_purge_failed_items(app, client, tools):
    await add_users(app)
    await add_item(app, ALICE, status="failed", nbytes=100, error_kind="corrupt")
    await add_item(app, BOB, status="failed", nbytes=50, error_kind="drm")
    keep = await add_item(app, BOB)
    canceled = await add_item(app, BOB, status="canceled", nbytes=0)
    operator = await login_as(app, client, "operator")
    assert (await client.get(API)).json()["purge_confirm"] == "PURGE 2 ITEMS"

    wrong = await client.post(f"{API}/purge-failed", headers=operator,
                              json={"reason": "weekly", "confirm": "PURGE 3 ITEMS"})
    assert wrong.status_code == 409 and wrong.json()["details"] == {"confirm": "PURGE 2 ITEMS"}
    r = await client.post(f"{API}/purge-failed", headers=operator, json={"reason": "weekly", "confirm": "PURGE 2 ITEMS"})
    assert r.status_code == 200, r.text
    assert r.json() == {"deleted": 2, "bytes": 150, "more": False}
    assert await item_ids(app) == {keep, canceled}  # 已取消的不清(R-A14)
    (row,) = await audit_rows(app, "library.purge_failed")
    assert (row.target_type, row.target_id, row.after, row.summary) == (
        "library", "failed", {"count": 2, "bytes": 150}, "")
    empty = await client.post(f"{API}/purge-failed", headers=operator,
                              json={"reason": "weekly", "confirm": "PURGE 0 ITEMS"})
    assert empty.status_code == 409 and empty.json() == {"error": "Nothing to purge"}


async def test_purge_is_capped_per_call(app, client, monkeypatch):
    await add_users(app)
    for _ in range(3):
        await add_item(app, ALICE, status="failed", nbytes=10)
    monkeypatch.setattr(library_admin, "PURGE_LIMIT", 2)
    operator = await login_as(app, client, "operator")
    r = await client.post(f"{API}/purge-failed", headers=operator, json={"reason": "weekly", "confirm": "PURGE 3 ITEMS"})
    assert r.status_code == 200, r.text
    assert r.json() == {"deleted": 2, "bytes": 20, "more": True}
    assert len(await item_ids(app)) == 1


async def test_no_titles_or_urls_in_logs_responses_or_audit(app, client, tools, caplog):
    caplog.set_level(logging.DEBUG, logger="app")
    await add_users(app)
    keep = await add_item(app, ALICE, segments=True)
    await add_item(app, ALICE, status="failed", error_kind="blocked", segments=True)
    queued = await add_item(app, BOB, status="queued", nbytes=0, segments=True)
    async with app.state.sessionmaker() as s:  # D8:今日译文 / 分析计数也在响应里,但只是数字
        s.add(DailyUsage(scope="library_translate", subject="*", day=utc_day(utcnow()), count=7))
        await s.commit()
    operator = await login_as(app, client, "operator")
    texts = []
    for path in (API, f"{API}/items", f"{API}/top-users", f"{API}/users/{ALICE}"):
        r = await client.get(path)
        assert r.status_code == 200, (path, r.text)
        texts.append(r.text)
    texts.append((await client.post(f"{API}/items/{queued}/cancel", headers=operator,
                                    json={"reason": "privacy run"})).text)
    texts.append((await client.post(f"{API}/items/{keep}/delete", headers=operator,
                                    json={"reason": "privacy run", "confirm": f"DELETE {keep[:8]}"})).text)
    texts.append((await client.post(f"{API}/purge-failed", headers=operator,
                                    json={"reason": "privacy run", "confirm": "PURGE 1 ITEMS"})).text)
    for text in texts:
        no_content(text)
    no_content(caplog.text)
    async with app.state.sessionmaker() as s:
        rows = (await s.scalars(select(AdminAudit).where(AdminAudit.action.like("library.%")))).all()
    assert sorted(r.action for r in rows) == ["library.item.cancel", "library.item.delete", "library.purge_failed"]
    no_content(json.dumps([[r.summary, r.before, r.after, r.target_id] for r in rows], ensure_ascii=False,
                          default=str))


def test_admin_library_urls_carry_only_ids():
    from app.main import create_app
    from tests.test_admin_routes_guarded import api_routes
    paths = sorted({p for p, _ in api_routes(create_app(make_settings()).routes) if p.startswith(API)})
    assert paths == sorted([API, f"{API}/items", f"{API}/top-users", f"{API}/users/{{user_id}}",
                            f"{API}/items/{{item_id}}/delete", f"{API}/items/{{item_id}}/cancel",
                            f"{API}/purge-failed"])
```

- [ ] **Step 2: 运行,确认失败** — `cd server && uv run pytest -q tests/test_admin_library.py`。预期:新用例 404 / 405(端点还不存在)、`test_admin_library_urls_carry_only_ids` 断言失败。

- [ ] **Step 3: 实现** — `server/app/admin/library_admin.py` 的导入块(Edit):

old:
```python
from app.core.quotas import quota_for
from app.models import DailyUsage, LibraryItem, User, iso_utc
from app.services.usage import utc_day
```
new:
```python
from app.admin import audit
from app.core.quotas import quota_for
from app.library import store
from app.models import DailyUsage, LibraryItem, User, iso_utc
from app.services.usage import utc_day
```

(若 A0 第 3 项发现取消函数不在 `store` 里,这里改为导入它真实所在的模块,并只改 `_s1_cancel`。)

在 `library_admin.py` 末尾追加:

```python
# ---- 写操作(R-A3、R-A4、R-A6、R-A14) ----

PURGE_LIMIT = 500
CANCELLABLE = frozenset({"uploading", "queued", "processing"})


def delete_phrase(item_id: str) -> str:
    return f"DELETE {item_id[:8]}"


async def _s1_delete(session, app, item: LibraryItem) -> None:
    """S1 的删除:取消任务、显式删 attempts / segments / item、清两个目录。A0 核对后只改这里。"""
    await store.delete_item(session, app, item)


async def _s1_cancel(session, app, item: LibraryItem) -> None:
    """S1 的取消:终止子进程、清 `_tmp`、条目标 canceled。A0 核对后只改这里。"""
    await store.cancel_item(session, app, item)


async def _get(session, item_id: str) -> LibraryItem:
    item = await session.get(LibraryItem, item_id)
    if item is None:
        raise LibraryAdminError(404, "Item not found")
    return item


async def delete_item(session, app, actor, item_id: str, *, reason: str, confirm: str) -> dict:
    item = await _get(session, item_id)
    phrase = delete_phrase(item_id)
    if (confirm or "").strip() != phrase:
        raise LibraryAdminError(409, "Confirmation required", {"confirm": phrase})
    freed = int(item.library_bytes or 0)
    await _s1_delete(session, app, item)
    # 审计在 S1 调用之后(R-A3):不在等任务停下时持有审计链的写锁
    await audit.record(session, actor, "library.item.delete", target_type="library_item", target_id=item_id,
                       after={"bytes": freed}, reason=reason)
    await session.commit()
    return {"deleted": item_id, "bytes": freed}


async def cancel_item(session, app, actor, item_id: str, *, reason: str) -> dict:
    item = await _get(session, item_id)
    before = item.status
    if before not in CANCELLABLE:
        raise LibraryAdminError(409, "Item is not running")
    await _s1_cancel(session, app, item)
    await audit.record(session, actor, "library.item.cancel", target_type="library_item", target_id=item_id,
                       before={"status": before}, reason=reason)
    await session.commit()
    status = await session.scalar(select(LibraryItem.status).where(LibraryItem.id == item_id))
    return {"id": item_id, "status": status}


async def purge_failed(session, app, actor, *, reason: str, confirm: str) -> dict:
    ids = list((await session.scalars(
        select(LibraryItem.id).where(LibraryItem.status == "failed")
        .order_by(LibraryItem.created_at, LibraryItem.id))).all())
    if not ids:
        raise LibraryAdminError(409, "Nothing to purge")
    phrase = purge_phrase(len(ids))
    if (confirm or "").strip() != phrase:
        raise LibraryAdminError(409, "Confirmation required", {"confirm": phrase})
    deleted = freed = 0
    for item_id in ids[:PURGE_LIMIT]:
        item = await session.get(LibraryItem, item_id)
        if item is None or item.status != "failed":
            continue  # 期间被用户删除或重试了
        freed += int(item.library_bytes or 0)
        await _s1_delete(session, app, item)
        deleted += 1
    await audit.record(session, actor, "library.purge_failed", target_type="library", target_id="failed",
                       after={"count": deleted, "bytes": freed}, reason=reason)
    await session.commit()
    return {"deleted": deleted, "bytes": freed, "more": len(ids) > PURGE_LIMIT}
```

在 `server/app/routers/admin_library.py` 末尾追加:

```python
class ReasonIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=1, max_length=200)

    @field_validator("reason")
    @classmethod
    def _strip(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("reason is required")
        return value.strip()


class ConfirmIn(ReasonIn):
    confirm: str = Field("", max_length=40)


@router.post("/items/{item_id}/delete")
async def library_delete(item_id: ItemUuid, body: ConfirmIn, request: Request,
                         ctx: AdminContext = Depends(require("operator")),
                         session: AsyncSession = Depends(get_session)):
    try:
        return await library_admin.delete_item(session, request.app, ctx.actor, item_id, reason=body.reason,
                                               confirm=body.confirm)
    except library_admin.LibraryAdminError as e:
        await session.rollback()
        return _error(e)


@router.post("/items/{item_id}/cancel")
async def library_cancel(item_id: ItemUuid, body: ReasonIn, request: Request,
                         ctx: AdminContext = Depends(require("operator")),
                         session: AsyncSession = Depends(get_session)):
    try:
        return await library_admin.cancel_item(session, request.app, ctx.actor, item_id, reason=body.reason)
    except library_admin.LibraryAdminError as e:
        await session.rollback()
        return _error(e)


@router.post("/purge-failed")
async def library_purge_failed(body: ConfirmIn, request: Request, ctx: AdminContext = Depends(require("operator")),
                               session: AsyncSession = Depends(get_session)):
    try:
        return await library_admin.purge_failed(session, request.app, ctx.actor, reason=body.reason,
                                                confirm=body.confirm)
    except library_admin.LibraryAdminError as e:
        await session.rollback()
        return _error(e)
```

- [ ] **Step 4: 运行,确认通过** — `cd server && uv run pytest -q tests/test_admin_library.py tests/test_admin_routes_guarded.py tests/test_architecture.py`。若 `test_delete_needs_operator_and_the_typed_phrase` 只在「`media.exists()`」一行失败,说明 S1 的删除不清目录——这是 S1 的缺陷(spec §5.1 / §9),停下报告,不要在管理端补删文件。

- [ ] **Step 5: 提交**

```
feat(server): admin library delete, cancel and purge of failed items (operator, typed confirmation, audited)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task AS4: `app/admin/CLAUDE.md`

**Files:**
- Modify: `server/app/admin/CLAUDE.md`

- [ ] **Step 1: 三处 Edit。**

(a)`doctor.py` 一条的末尾:

old: ``read from `app.state.learning_bus` without importing `app.links`)``
new: ``read from `app.state.learning_bus` without importing `app.links`; 跟读库 `library_ffmpeg_missing` / `library_ytdlp_missing` / `library_asr_unavailable` / `library_cookies_missing`, only while `LIBRARY_ENABLED`, cookies permissions checked on POSIX only, messages never include the path)``

(b)在 `agents_admin.py` 一条之后插入一条(old 取 `agents_admin.py` 那一行的结尾 `管理员不能读任何记忆内容`):

old: `管理员不能读任何记忆内容`
new:
```
管理员不能读任何记忆内容
- `library_admin.py` – 跟读库(spec 2026-10-13-video-import §12、E10;plan `2026-10-13-video-import-admin.md`):`overview`(开关、计数、
  队列、今日识别分钟、AI 译文 / 分析开关与今日句数(只读 `daily_usage`,D8)、ffmpeg / yt-dlp 版本、cookies / 代理只给布尔值)、`items`(分页 + 状态 / 所有者 / 种类筛选)、`top_users`、
  `user_usage`;**只选数字、状态、种类、阶段与来源主机名,永不选 title / source_url / 路径,不读 `library_segments`(句子、译文 zh、分析 analysis 都是内容)**。`delete_item` / `cancel_item` /
  `purge_failed`(操作员 + 输入确认 `DELETE <id 前 8 位>` / `PURGE <n> ITEMS`,不需要 step-up)只经 `_s1_delete` / `_s1_cancel` 调
  `app.library.store`,审计在 S1 调用之后(`library.item.delete {bytes}`、`library.item.cancel`、`library.purge_failed {count, bytes}`,
  summary 留空)。新增 `/api/admin/library*` 路由要同时改 `tests/test_admin_library.py::test_admin_library_urls_carry_only_ids`
```

(c)允许的依赖:

old: ``, `app.wordbook`, `app.agents`.``
new: ``, `app.wordbook`, `app.agents`, `app.library`.``

- [ ] **Step 2: 运行** — `cd server && uv run pytest -q tests/test_admin_library.py tests/test_architecture.py`(文档改动,确认没误碰代码)。

- [ ] **Step 3: 提交**

```
docs(server): admin CLAUDE.md for the library admin module and doctor findings

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

## 管理后台网页任务组(AW)

> 开始前确认 AS1–AS4 已合并。下面的类型严格按 AS2 / AS3 的响应写;若 AS 执行中改了形状(只能经本计划的 Addendum),这里同步改。

### Task AW1: 接口、文案、图标、公开出口

**Files:**
- Create: `admin/src/features/library/api.ts`、`admin/src/features/library/api.test.ts`、`admin/src/features/library/strings.ts`、`admin/src/features/library/library-icon.tsx`、`admin/src/features/library/index.ts`

**Interfaces:**
- Produces(`api.ts`):类型 `LibraryStatus`、`LibraryKind`、`StatusFilter`、`KindFilter`、`ItemFilters`、`LibraryOverview`、`LibraryRow`、`LibraryItemsPage`、`LibraryTopUser`、`UserLibraryUsageData`;常量 `LIBRARY_STATUSES`、`CANCELLABLE`;函数 `camel`、`deletePhrase(id)`、`fetchLibraryOverview()`、`fetchLibraryItems(filters, page = 1)`、`fetchTopUsers()`、`fetchUserLibrary(userId)`、`deleteLibraryItem(id, reason, confirm)`、`cancelLibraryItem(id, reason)`、`purgeFailedItems(reason, confirm)`。
- Produces(`strings.ts`):`S`(全部中文文案,`S.title` 也给导航用)。`library-icon.tsx`:`LibraryIcon`。

- [ ] **Step 1: 写失败测试** — `admin/src/features/library/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  camel,
  cancelLibraryItem,
  deleteLibraryItem,
  deletePhrase,
  fetchLibraryItems,
  fetchLibraryOverview,
  fetchUserLibrary,
  purgeFailedItems,
} from "./api";

const ID = "3f2a9c1e-0000-4000-8000-000000000001";

function stub(body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("library admin api", () => {
  it("camelCases keys but keeps status names", () => {
    expect(camel({ by_status: { failed: 1 }, asr: { today_minutes: 2 }, purge_confirm: "PURGE 1 ITEMS" })).toEqual({
      byStatus: { failed: 1 },
      asr: { todayMinutes: 2 },
      purgeConfirm: "PURGE 1 ITEMS",
    });
  });

  it("reads the overview", async () => {
    stub({
      enabled: true,
      by_status: { failed: 2 },
      purge_confirm: "PURGE 2 ITEMS",
      tools: { ffmpeg: "7.1", ytdlp: null },
      ai: { enabled: true, available: true, today_translated: 120, today_analysed: 4, global_daily: 5000,
        translate_daily_per_user: 500, analysis_daily_per_user: 30 },
    });
    const o = await fetchLibraryOverview();
    expect(o.ai).toEqual({ enabled: true, available: true, todayTranslated: 120, todayAnalysed: 4, globalDaily: 5000,
      translateDailyPerUser: 500, analysisDailyPerUser: 30 });
    expect(o.byStatus.failed).toBe(2);
    expect(o.purgeConfirm).toBe("PURGE 2 ITEMS");
    expect(o.tools).toEqual({ ffmpeg: "7.1", ytdlp: null });
  });

  it("sends filters as query parameters and leaves out 'all'", async () => {
    const calls = stub({ items: [], page: 1, next: null, total: 0 });
    await fetchLibraryItems({ status: "failed", kind: "all", userId: "10000101" }, 2);
    expect(calls[0].url).toBe("/api/admin/library/items?status=failed&user_id=10000101&page=2");
    await fetchLibraryItems({ status: "all", kind: "video", userId: null });
    expect(calls[1].url).toBe("/api/admin/library/items?kind=video&page=1");
  });

  it("builds the delete phrase from the first 8 characters of the id", () => {
    expect(deletePhrase(ID)).toBe("DELETE 3f2a9c1e");
  });

  it("posts delete, cancel and purge with reason and phrase", async () => {
    const calls = stub({ ok: true });
    await deleteLibraryItem(ID, "清理旧素材", "DELETE 3f2a9c1e");
    await cancelLibraryItem(ID, "卡住了");
    await purgeFailedItems("每周清理", "PURGE 2 ITEMS");
    expect(calls.map((c) => [c.url, c.init.method])).toEqual([
      [`/api/admin/library/items/${ID}/delete`, "POST"],
      [`/api/admin/library/items/${ID}/cancel`, "POST"],
      ["/api/admin/library/purge-failed", "POST"],
    ]);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ reason: "清理旧素材", confirm: "DELETE 3f2a9c1e" });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ reason: "卡住了" });
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ reason: "每周清理", confirm: "PURGE 2 ITEMS" });
  });

  it("reads one user's usage", async () => {
    const calls = stub({ user_id: 10000101, enabled: true, items: 2, bytes: 10, quota_mb: 2000, max_items: 100, by_status: {} });
    const u = await fetchUserLibrary("10000101");
    expect(calls[0].url).toBe("/api/admin/library/users/10000101");
    expect([u.items, u.quotaMb, u.maxItems]).toEqual([2, 2000, 100]);
  });
});
```

- [ ] **Step 2: 运行,确认失败** — `cd admin && yarn vitest run src/features/library`。预期:`Failed to resolve import "./api"`。

- [ ] **Step 3: 实现** — `admin/src/features/library/api.ts`:

```ts
/** 跟读库管理接口(spec 2026-10-13-video-import §12;服务端 routers/admin_library.py)。wire 是 snake_case,这里转 camelCase。
 * 管理员看不到标题、网址与文字(E10):这里的类型里也没有这些字段。 */
import { request } from "../../api/client";

export type LibraryStatus = "uploading" | "queued" | "processing" | "ready" | "failed" | "canceled";
export type LibraryKind = "audio" | "video";
export type StatusFilter = LibraryStatus | "all";
export type KindFilter = LibraryKind | "all";

export const LIBRARY_STATUSES: LibraryStatus[] = ["uploading", "queued", "processing", "ready", "failed", "canceled"];
/** 可以取消的状态(与服务端 library_admin.CANCELLABLE 一致) */
export const CANCELLABLE: LibraryStatus[] = ["uploading", "queued", "processing"];

export interface LibraryOverview {
  enabled: boolean;
  available: boolean;
  asr: { enabled: boolean; available: boolean; todayMinutes: number; globalDailyMinutes: number };
  /** D8:译文与分析(R-A19);今日数字是句数,来自服务端的每日用量,不含任何句子文字 */
  ai: {
    enabled: boolean;
    available: boolean;
    todayTranslated: number;
    todayAnalysed: number;
    globalDaily: number;
    translateDailyPerUser: number;
    analysisDailyPerUser: number;
  };
  link: { enabled: boolean; available: boolean; allowGeneric: boolean; cookiesConfigured: boolean; proxyConfigured: boolean };
  tools: { ffmpeg: string | null; ytdlp: string | null };
  totals: { items: number; bytes: number; users: number };
  byStatus: Record<LibraryStatus, number>;
  queue: { queued: number; processing: number; running: number; concurrency: number };
  limits: { quotaMb: number; maxItems: number; maxUploadMb: number; maxDurationMinutes: number };
  purgeConfirm: string;
}

export interface LibraryRow {
  id: string;
  userId: number;
  username: string | null;
  kind: LibraryKind;
  source: "upload" | "link";
  status: LibraryStatus;
  stage: string | null;
  progress: number;
  errorKind: string | null;
  durationMs: number | null;
  bytes: number;
  subSource: string | null;
  sourceHost: string | null;
  createdAt: string;
}

export interface LibraryItemsPage { items: LibraryRow[]; page: number; next: number | null; total: number }
export interface LibraryTopUser { userId: number; username: string | null; items: number; bytes: number }
export interface UserLibraryUsageData {
  userId: number; enabled: boolean; items: number; bytes: number; quotaMb: number; maxItems: number;
  byStatus: Record<LibraryStatus, number>;
}
export interface ItemFilters { status: StatusFilter; kind: KindFilter; userId: string | null }

/** snake_case → camelCase(深层;与 features/wordbook/api.ts 相同,不跨 feature 导入)。 */
const camelKey = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
export function camel<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => camel(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[camelKey(k)] = camel(v);
    return out as T;
  }
  return value as T;
}

/** 单条删除要原样输入的短语(服务端 library_admin.delete_phrase) */
export const deletePhrase = (id: string) => `DELETE ${id.slice(0, 8)}`;

const enc = encodeURIComponent;

export const fetchLibraryOverview = async (): Promise<LibraryOverview> =>
  camel<LibraryOverview>(await request<unknown>("/api/admin/library"));

export const fetchLibraryItems = async (f: ItemFilters, page = 1): Promise<LibraryItemsPage> =>
  camel<LibraryItemsPage>(
    await request<unknown>("/api/admin/library/items", {
      query: {
        status: f.status === "all" ? undefined : f.status,
        kind: f.kind === "all" ? undefined : f.kind,
        user_id: f.userId ?? undefined,
        page,
      },
    }),
  );

export const fetchTopUsers = async (): Promise<{ users: LibraryTopUser[] }> =>
  camel<{ users: LibraryTopUser[] }>(await request<unknown>("/api/admin/library/top-users"));

export const fetchUserLibrary = async (userId: string): Promise<UserLibraryUsageData> =>
  camel<UserLibraryUsageData>(await request<unknown>(`/api/admin/library/users/${enc(userId)}`));

export const deleteLibraryItem = (id: string, reason: string, confirm: string) =>
  request<{ deleted: string; bytes: number }>(`/api/admin/library/items/${enc(id)}/delete`, { method: "POST", json: { reason, confirm } });

export const cancelLibraryItem = (id: string, reason: string) =>
  request<{ id: string; status: string }>(`/api/admin/library/items/${enc(id)}/cancel`, { method: "POST", json: { reason } });

export const purgeFailedItems = (reason: string, confirm: string) =>
  request<{ deleted: number; bytes: number; more: boolean }>("/api/admin/library/purge-failed", { method: "POST", json: { reason, confirm } });
```

`admin/src/features/library/strings.ts`:

```ts
/** features/library 的界面文案(zh-CN);`components/layout.tsx` 的导航项也用 `S.title`。 */
export const S = {
  title: "跟读库",
  off: "跟读库总开关已关闭(学习端看不到入口);这里的数据仍可查看。",
  toSettings: "去设置",
  state: { on: "跟读库已开启", unavailable: "跟读库已开启,但不可用(服务器缺少 ffmpeg)", off: "跟读库未开启" },
  asr: {
    off: "自动转写未开启",
    on: (today: string, cap: string) => `自动转写已开启 · 今日 ${today} / 上限 ${cap} 分钟`,
    unavailable: "没有可用的语音识别",
  },
  ai: {
    off: "译文与分析未开启",
    on: (translated: string, analysed: string, cap: string) =>
      `译文与分析已开启 · 今日译文 ${translated} 句 / 分析 ${analysed} 句 · 全站上限 ${cap} 句`,
    unavailable: "译文与分析已开启,但当前不可用",
    perUser: (translate: string, analysis: string) => `每人每天:译文 ${translate} 句 / 分析 ${analysis} 句`,
  },
  link: {
    off: "链接导入未开启",
    on: "链接导入已开启",
    unavailable: "链接导入已开启,但 yt-dlp 不可用",
    generic: "允许通用抓取器",
    cookies: (set: boolean) => `cookies:${set ? "已配置" : "未配置"}`,
    proxy: (set: boolean) => `代理:${set ? "已配置" : "未配置"}`,
  },
  tools: (ffmpeg: string | null, ytdlp: string | null) => `ffmpeg ${ffmpeg ?? "未安装"} · yt-dlp ${ytdlp ?? "未安装"}`,
  limits: (quota: string, items: string, upload: string, minutes: string) =>
    `每人 ${quota} MB / ${items} 条 · 单文件 ${upload} MB · 单条 ${minutes} 分钟`,
  privacy: "管理员看不到标题、网址、字幕与转写内容;这里只有大小、所有者、种类、状态、时长与来源主机名。",
  kpi: { items: "条目", bytes: "占用", users: "用户", queue: "排队 / 处理中 / 运行中" },
  topUsers: "按占用排行",
  topCols: { user: "用户", items: "条目", bytes: "占用" },
  topEmpty: "还没有人导入素材",
  items: "条目",
  filters: { status: "按状态筛选", kind: "按种类筛选", all: "全部" },
  userFilter: (id: string) => `只看用户 ${id}`,
  clearUser: "清除用户筛选",
  cols: {
    user: "用户",
    kind: "种类",
    source: "来源",
    status: "状态",
    duration: "时长",
    bytes: "大小",
    subs: "字幕",
    created: "创建时间",
    actions: "操作",
  },
  itemsEmpty: "没有符合条件的条目",
  status: {
    uploading: "上传中",
    queued: "排队中",
    processing: "处理中",
    ready: "就绪",
    failed: "失败",
    canceled: "已取消",
  } as Record<string, string>,
  kind: { audio: "音频", video: "视频" } as Record<string, string>,
  source: { upload: "上传", link: "链接" } as Record<string, string>,
  stage: {
    probe: "探测",
    fetch: "取回",
    transcode: "转码",
    subtitles: "字幕",
    transcribe: "转写",
    segment: "分句",
  } as Record<string, string>,
  subs: { uploaded: "上传字幕", platform: "平台字幕", asr: "自动识别" } as Record<string, string>,
  /** spec §6.6 的 error_kind */
  errors: {
    too_large: "文件过大",
    too_long: "时长超限",
    quota: "额度用尽",
    corrupt: "文件损坏",
    no_audio: "没有音轨",
    bad_subtitle: "字幕无法解析",
    no_subtitles: "没有字幕且未开自动转写",
    disk_full: "磁盘空间不足",
    unsupported_format: "格式不支持",
    upload_expired: "上传超时未完成",
    link_disabled: "链接导入已关闭",
    bad_url: "链接无效",
    drm: "受 DRM 保护",
    private: "私有内容",
    geo_blocked: "地区限制",
    login_required: "需要登录",
    blocked: "站点拒绝服务器",
    playlist_unsupported: "不支持播放列表",
    live_unsupported: "不支持直播",
    unsupported_site: "站点不支持",
    ytdlp_failed: "下载失败",
    upstream: "识别上游出错",
    network: "网络错误",
    ytdlp_transient: "下载暂时失败",
  } as Record<string, string>,
  progress: (stage: string, pct: string) => `${stage} · ${pct}%`,
  delete: "删除",
  deleteTitle: "删除这个条目",
  deleteBody: "删除媒体文件、封面、句子以及已生成的译文与分析;用户的评测与练习记录保留。正在处理的任务会先被取消。",
  cancel: "取消处理",
  cancelTitle: "取消处理这个条目",
  cancelBody: "终止正在进行的上传、下载、转码或转写;条目标为「已取消」,用户可以删除或重新导入。",
  purge: "清理失败项",
  purgeTitle: "清理全部失败项",
  purgeBody: (count: string) => `删除 ${count} 个失败条目及其文件(每次最多 500 个,超过时再点一次)。`,
  usage: {
    title: "跟读库",
    line: (items: string, max: string, used: string, quota: string) => `${items} / ${max} 条 · 已用 ${used} / 配额 ${quota} MB`,
    view: "查看条目",
    failed: "跟读库占用读取失败",
  },
};
```

`admin/src/features/library/library-icon.tsx`:

```tsx
import type { SVGProps } from "react";

/** 导航「跟读库」:带播放三角的胶片框(与 components/icons 同为 1.75 描边、24 视框)。 */
export const LibraryIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M7 5v14M17 5v14" />
    <path d="M10.5 9.5v5l4-2.5z" />
  </svg>
);
```

`admin/src/features/library/index.ts`:

```ts
/** features/library 的公开出口(app.tsx / pages 只从这里导入;layout 只导入 strings / library-icon,避免循环)。 */
export * from "./api";
```

- [ ] **Step 4: 运行,确认通过** — `cd admin && yarn vitest run src/features/library && cd .. && yarn workspace admin typecheck`。

- [ ] **Step 5: 提交**

```
feat(admin): library admin api client, strings and nav icon

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task AW2: `/library` 页面、导航项与路由

**Files:**
- Create: `admin/src/features/library/library-page.tsx`、`admin/src/features/library/library-page.test.tsx`
- Modify: `admin/src/features/library/index.ts`(追加一行)、`admin/src/components/layout.tsx`、`admin/src/app.tsx`

**Interfaces:**
- Produces:`LibraryPage`(路由 `/library`,读 `?user=<数字>` 作所有者筛选);`NAV` 「内容」组新增 `{ to: "/library", label: "跟读库", icon: LibraryIcon, min: "viewer" }`。
- Consumes:AW1 的 `api.ts` / `strings.ts`;`components/{confirm-dialog,data-table,layout(Page, Chips),role-gate,states,status-dot}`、`hooks/{use-async,use-paged}`、`lib/format`。

- [ ] **Step 1: 写失败测试** — `admin/src/features/library/library-page.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import { AppShell } from "../../components/layout";
import { LibraryPage } from "./library-page";

const ID1 = "3f2a9c1e-0000-4000-8000-000000000001";
const ID2 = "9b7d0c2a-0000-4000-8000-000000000002";
const overview = {
  enabled: true,
  available: true,
  asr: { enabled: true, available: true, today_minutes: 25, global_daily_minutes: 600 },
  ai: { enabled: true, available: true, today_translated: 120, today_analysed: 4, global_daily: 5000,
    translate_daily_per_user: 500, analysis_daily_per_user: 30 },
  link: { enabled: true, available: false, allow_generic: false, cookies_configured: true, proxy_configured: false },
  tools: { ffmpeg: "7.1", ytdlp: null },
  totals: { items: 2, bytes: 12582912, users: 2 },
  by_status: { uploading: 0, queued: 0, processing: 1, ready: 0, failed: 1, canceled: 0 },
  queue: { queued: 0, processing: 1, running: 1, concurrency: 1 },
  limits: { quota_mb: 2000, max_items: 100, max_upload_mb: 500, max_duration_minutes: 90 },
  purge_confirm: "PURGE 1 ITEMS",
};
const row = (over: Record<string, unknown> = {}) => ({
  id: ID1, user_id: 10000101, username: "alice", kind: "video", source: "link", status: "failed", stage: null,
  progress: 0, error_kind: "blocked", duration_ms: 61000, bytes: 12582912, sub_source: null,
  source_host: "www.youtube.com", created_at: "2026-10-13T09:00:00+00:00", ...over,
});
const items = {
  items: [
    row(),
    row({ id: ID2, user_id: 10000102, username: "bob", kind: "audio", source: "upload", status: "processing",
      stage: "transcribe", progress: 70, error_kind: null, source_host: null, bytes: 0 }),
  ],
  page: 1,
  next: null,
  total: 2,
};
const top = { users: [{ user_id: 10000101, username: "alice", items: 1, bytes: 12582912 }] };

function stubFetch(ov: unknown = overview) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const path = url.split("?")[0];
      const out =
        init?.method === "POST" ? { ok: true }
        : path === "/api/admin/library" ? ov
        : path === "/api/admin/library/top-users" ? top
        : items;
      return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

function signIn(role: session.Role) {
  session.setSession({
    username: role, role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: false, safeMode: false, maintenanceMode: "off",
  });
}

const renderPage = (entry = "/library") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <LibraryPage />
    </MemoryRouter>,
  );

const itemCalls = (calls: { url: string }[]) => calls.filter((c) => c.url.startsWith("/api/admin/library/items"));

beforeEach(() => signIn("operator"));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  session.resetSessionForTests();
});

describe("LibraryPage", () => {
  it("shows switches, numbers and rows without any content", async () => {
    stubFetch();
    renderPage();
    expect(await screen.findByText("自动转写已开启 · 今日 25 / 上限 600 分钟")).toBeTruthy();
    expect(screen.getByText("链接导入已开启,但 yt-dlp 不可用")).toBeTruthy();
    expect(screen.getByText("译文与分析已开启 · 今日译文 120 句 / 分析 4 句 · 全站上限 5,000 句")).toBeTruthy();
    expect(screen.getByText("每人每天:译文 500 句 / 分析 30 句")).toBeTruthy();
    expect(screen.getByText(/cookies:已配置/)).toBeTruthy();
    expect(screen.getByText("ffmpeg 7.1 · yt-dlp 未安装")).toBeTruthy();
    expect(await screen.findByText("站点拒绝服务器")).toBeTruthy();
    expect(screen.getByText("www.youtube.com")).toBeTruthy();
    expect(screen.getByText("转写 · 70%")).toBeTruthy();
    expect(screen.getAllByText("12.0 MB").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "alice" })[0].getAttribute("href")).toBe("/users/10000101");
  });

  it("shows the AI switch off, and on but unavailable (D8)", async () => {
    stubFetch({ ...overview, ai: { ...overview.ai, enabled: false, available: false } });
    renderPage();
    expect(await screen.findByText("译文与分析未开启")).toBeTruthy();
    expect(screen.queryByText(/每人每天:译文/)).toBeNull();
    cleanup();
    stubFetch({ ...overview, ai: { ...overview.ai, available: false } });
    renderPage();
    expect(await screen.findByText("译文与分析已开启,但当前不可用")).toBeTruthy();
  });

  it("hides write actions from viewers", async () => {
    signIn("viewer");
    stubFetch();
    renderPage();
    await screen.findByText("站点拒绝服务器");
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
    expect(screen.queryByRole("button", { name: "取消处理" })).toBeNull();
    expect(screen.queryByRole("button", { name: "清理失败项" })).toBeNull();
  });

  it("deletes an item only after the typed phrase and a reason", async () => {
    const calls = stubFetch();
    renderPage();
    fireEvent.click((await screen.findAllByRole("button", { name: "删除" }))[0]);
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "确认" });
    fireEvent.change(within(dialog).getByLabelText("理由"), { target: { value: "清理旧素材" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("输入 DELETE 3f2a9c1e 以确认"), { target: { value: "DELETE 3f2a9c1e" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.url === `/api/admin/library/items/${ID1}/delete`)).toBe(true));
    const post = calls.find((c) => c.url.endsWith("/delete"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ reason: "清理旧素材", confirm: "DELETE 3f2a9c1e" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("offers cancel only for running items", async () => {
    const calls = stubFetch();
    renderPage();
    const cancels = await screen.findAllByRole("button", { name: "取消处理" });
    expect(cancels).toHaveLength(1);
    fireEvent.click(cancels[0]);
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("理由"), { target: { value: "任务卡住了" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认" }));
    await waitFor(() => expect(calls.some((c) => c.url === `/api/admin/library/items/${ID2}/cancel`)).toBe(true));
    const post = calls.find((c) => c.url.endsWith("/cancel"));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ reason: "任务卡住了" });
  });

  it("purges failed items with the phrase from the overview", async () => {
    const calls = stubFetch();
    renderPage();
    await screen.findByText("站点拒绝服务器");
    fireEvent.click(screen.getByRole("button", { name: "清理失败项" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("理由"), { target: { value: "每周清理" } });
    fireEvent.change(within(dialog).getByLabelText("输入 PURGE 1 ITEMS 以确认"), { target: { value: "PURGE 1 ITEMS" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/admin/library/purge-failed")).toBe(true));
    const post = calls.find((c) => c.url === "/api/admin/library/purge-failed");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ reason: "每周清理", confirm: "PURGE 1 ITEMS" });
  });

  it("filters by status and kind through query parameters", async () => {
    const calls = stubFetch();
    renderPage();
    await screen.findByText("站点拒绝服务器");
    expect(itemCalls(calls)[0].url).toBe("/api/admin/library/items?page=1");
    fireEvent.click(screen.getByRole("button", { name: "失败" }));
    await waitFor(() => expect(itemCalls(calls).some((c) => c.url === "/api/admin/library/items?status=failed&page=1")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "音频" }));
    await waitFor(() =>
      expect(itemCalls(calls).some((c) => c.url === "/api/admin/library/items?status=failed&kind=audio&page=1")).toBe(true),
    );
  });

  it("takes the owner filter from ?user= and can clear it", async () => {
    const calls = stubFetch();
    renderPage("/library?user=10000101");
    await screen.findByText("站点拒绝服务器");
    expect(itemCalls(calls)[0].url).toBe("/api/admin/library/items?user_id=10000101&page=1");
    expect(screen.getByText(/只看用户 10000101/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清除用户筛选" }));
    await waitFor(() => expect(itemCalls(calls).at(-1)?.url).toBe("/api/admin/library/items?page=1"));
  });

  it("adds a nav item that viewers can see", () => {
    signIn("viewer");
    stubFetch();
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "跟读库" }).getAttribute("href")).toBe("/library");
  });
});
```

- [ ] **Step 2: 运行,确认失败** — `cd admin && yarn vitest run src/features/library`。预期:`Failed to resolve import "./library-page"`。

- [ ] **Step 3: 实现** — `admin/src/features/library/library-page.tsx`:

```tsx
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { DataTable, type Column } from "../../components/data-table";
import { Chips, Page } from "../../components/layout";
import { RoleGate } from "../../components/role-gate";
import { ErrorState, LoadMore, Skeleton } from "../../components/states";
import { StatusDot, type Tone } from "../../components/status-dot";
import { useAsync } from "../../hooks/use-async";
import { usePaged } from "../../hooks/use-paged";
import { formatBytes, formatDateTime, formatDuration } from "../../lib/format";
import {
  CANCELLABLE,
  LIBRARY_STATUSES,
  cancelLibraryItem,
  deleteLibraryItem,
  deletePhrase,
  fetchLibraryItems,
  fetchLibraryOverview,
  fetchTopUsers,
  purgeFailedItems,
  type KindFilter,
  type LibraryOverview,
  type LibraryRow,
  type LibraryTopUser,
  type StatusFilter,
} from "./api";
import { S } from "./strings";

const n = (v: number) => v.toLocaleString("en-US");

type Pending = { kind: "delete" | "cancel"; row: LibraryRow } | { kind: "purge"; phrase: string; count: number };

function Summary({ o }: { o: LibraryOverview }) {
  const state: [Tone, string] = !o.enabled ? ["neutral", S.state.off] : o.available ? ["good", S.state.on] : ["bad", S.state.unavailable];
  const asr: [Tone, string] = !o.asr.enabled
    ? ["neutral", S.asr.off]
    : [o.asr.available ? "good" : "warn", S.asr.on(n(o.asr.todayMinutes), n(o.asr.globalDailyMinutes))];
  const link: [Tone, string] = !o.link.enabled ? ["neutral", S.link.off] : o.link.available ? ["good", S.link.on] : ["warn", S.link.unavailable];
  const ai: [Tone, string] = !o.ai.enabled
    ? ["neutral", S.ai.off]
    : o.ai.available
      ? ["good", S.ai.on(n(o.ai.todayTranslated), n(o.ai.todayAnalysed), n(o.ai.globalDaily))]
      : ["warn", S.ai.unavailable];
  return (
    <div className="panel space-y-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <StatusDot tone={state[0]} label={state[1]} />
        <StatusDot tone={asr[0]} label={asr[1]} />
        {o.asr.enabled && !o.asr.available && <span className="text-warn">{S.asr.unavailable}</span>}
        <StatusDot tone={link[0]} label={link[1]} />
        <StatusDot tone={ai[0]} label={ai[1]} />
        <Link className="ml-auto text-accent hover:underline" to="/settings/library">
          {S.toSettings}
        </Link>
      </div>
      <p className="text-fg-2">
        {S.link.cookies(o.link.cookiesConfigured)} · {S.link.proxy(o.link.proxyConfigured)}
        {o.link.allowGeneric && (
          <>
            {" · "}
            <span className="text-warn">{S.link.generic}</span>
          </>
        )}
        {" · "}
        <span className="num">{S.tools(o.tools.ffmpeg, o.tools.ytdlp)}</span>
      </p>
      <p className="num text-fg-2">
        {S.limits(n(o.limits.quotaMb), n(o.limits.maxItems), n(o.limits.maxUploadMb), n(o.limits.maxDurationMinutes))}
      </p>
      {o.ai.enabled && (
        <p className="num text-fg-2">{S.ai.perUser(n(o.ai.translateDailyPerUser), n(o.ai.analysisDailyPerUser))}</p>
      )}
      {!o.enabled && <p className="text-fg-2">{S.off}</p>}
      <p className="text-2xs text-muted">{S.privacy}</p>
    </div>
  );
}

function Kpis({ o }: { o: LibraryOverview }) {
  const cells: [string, string][] = [
    [S.kpi.items, n(o.totals.items)],
    [S.kpi.bytes, formatBytes(o.totals.bytes)],
    [S.kpi.users, n(o.totals.users)],
    [S.kpi.queue, `${n(o.queue.queued)} / ${n(o.queue.processing)} / ${n(o.queue.running)}`],
  ];
  return (
    <dl className="panel grid grid-cols-4 gap-px overflow-hidden bg-line">
      {cells.map(([label, value]) => (
        <div key={label} className="bg-surface px-4 py-3">
          <dt className="text-2xs text-fg-2">{label}</dt>
          <dd className="num mt-1 text-md font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatusCell({ row }: { row: LibraryRow }) {
  const tone: Tone = row.status === "ready" ? "good" : row.status === "failed" ? "bad" : row.status === "canceled" ? "neutral" : "warn";
  return (
    <span className="block space-y-0.5">
      <StatusDot tone={tone} label={S.status[row.status] ?? row.status} />
      {row.status === "processing" && row.stage && (
        <span className="num block text-2xs text-muted">{S.progress(S.stage[row.stage] ?? row.stage, String(row.progress))}</span>
      )}
      {row.status === "failed" && row.errorKind && <span className="block text-2xs text-bad">{S.errors[row.errorKind] ?? row.errorKind}</span>}
    </span>
  );
}

const userLink = (userId: number, username: string | null) => (
  <Link className="font-medium text-accent hover:underline" to={`/users/${userId}`}>
    {username ?? String(userId)}
  </Link>
);

const TOP_COLUMNS: Column<LibraryTopUser>[] = [
  { key: "user", header: S.topCols.user, render: (u) => userLink(u.userId, u.username) },
  { key: "items", header: S.topCols.items, numeric: true, render: (u) => n(u.items) },
  { key: "bytes", header: S.topCols.bytes, numeric: true, render: (u) => formatBytes(u.bytes) },
];

/** /library:跟读库总览、占用排行、条目表(spec 2026-10-13-video-import §12;桌面版式 R-7)。没有任何标题或网址(E10)。 */
export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const rawUser = params.get("user");
  const userId = rawUser && /^\d{1,10}$/.test(rawUser) ? rawUser : null;
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [pending, setPending] = useState<Pending | null>(null);
  const overview = useAsync(fetchLibraryOverview, []);
  const top = useAsync(fetchTopUsers, []);
  const paged = usePaged<LibraryRow>((page) => fetchLibraryItems({ status, kind, userId }, page), [status, kind, userId]);

  const reloadAll = () => {
    overview.reload();
    top.reload();
    paged.reload();
  };

  const confirm = async (reason: string) => {
    if (!pending) return;
    if (pending.kind === "delete") await deleteLibraryItem(pending.row.id, reason, deletePhrase(pending.row.id));
    else if (pending.kind === "cancel") await cancelLibraryItem(pending.row.id, reason);
    else await purgeFailedItems(reason, pending.phrase);
    setPending(null);
    reloadAll();
  };

  const clearUser = () =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete("user");
        return next;
      },
      { replace: true },
    );

  const columns: Column<LibraryRow>[] = [
    { key: "user", header: S.cols.user, render: (r) => userLink(r.userId, r.username) },
    { key: "kind", header: S.cols.kind, render: (r) => S.kind[r.kind] ?? r.kind },
    {
      key: "source",
      header: S.cols.source,
      render: (r) => (
        <span className="block">
          {S.source[r.source] ?? r.source}
          {r.sourceHost && <span className="block text-2xs text-muted">{r.sourceHost}</span>}
        </span>
      ),
    },
    { key: "status", header: S.cols.status, render: (r) => <StatusCell row={r} /> },
    { key: "duration", header: S.cols.duration, numeric: true, render: (r) => (r.durationMs === null ? "—" : formatDuration(r.durationMs)) },
    { key: "bytes", header: S.cols.bytes, numeric: true, render: (r) => formatBytes(r.bytes) },
    { key: "subs", header: S.cols.subs, render: (r) => (r.subSource ? S.subs[r.subSource] ?? r.subSource : "—") },
    { key: "created", header: S.cols.created, render: (r) => <span className="num text-fg-2">{formatDateTime(r.createdAt)}</span> },
    {
      key: "actions",
      header: S.cols.actions,
      align: "right",
      render: (r) => (
        <RoleGate min="operator">
          <span className="inline-flex gap-1">
            {CANCELLABLE.includes(r.status) && (
              <button type="button" className="btn-ghost btn-sm" onClick={() => setPending({ kind: "cancel", row: r })}>
                {S.cancel}
              </button>
            )}
            <button type="button" className="btn-ghost btn-sm text-bad" onClick={() => setPending({ kind: "delete", row: r })}>
              {S.delete}
            </button>
          </span>
        </RoleGate>
      ),
    },
  ];

  const failed = overview.data?.byStatus.failed ?? 0;
  const dialog =
    pending?.kind === "delete"
      ? { title: S.deleteTitle, body: S.deleteBody, danger: true, typing: deletePhrase(pending.row.id) as string | undefined }
      : pending?.kind === "cancel"
        ? { title: S.cancelTitle, body: S.cancelBody, danger: false, typing: undefined }
        : pending?.kind === "purge"
          ? { title: S.purgeTitle, body: S.purgeBody(n(pending.count)), danger: true, typing: pending.phrase }
          : { title: "", body: "", danger: false, typing: undefined };

  return (
    <Page
      title={S.title}
      actions={
        <RoleGate min="operator">
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={!overview.data || failed === 0}
            onClick={() => overview.data && setPending({ kind: "purge", phrase: overview.data.purgeConfirm, count: failed })}
          >
            {S.purge}
          </button>
        </RoleGate>
      }
    >
      {overview.error ? (
        <ErrorState message={overview.error} onRetry={overview.reload} />
      ) : !overview.data ? (
        <Skeleton rows={3} />
      ) : (
        <>
          <Summary o={overview.data} />
          <Kpis o={overview.data} />
        </>
      )}

      <h2 className="pt-2 text-sm font-semibold">{S.topUsers}</h2>
      {top.error ? (
        <ErrorState message={top.error} onRetry={top.reload} />
      ) : !top.data ? (
        <Skeleton rows={2} />
      ) : (
        <div className="panel">
          <DataTable columns={TOP_COLUMNS} rows={top.data.users} empty={S.topEmpty} rowKey={(u) => u.userId} caption={S.topUsers} />
        </div>
      )}

      <h2 className="pt-2 text-sm font-semibold">{S.items}</h2>
      <div className="flex flex-wrap items-center gap-3">
        <Chips
          label={S.filters.status}
          value={status}
          onChange={setStatus}
          options={[{ value: "all" as StatusFilter, label: S.filters.all }, ...LIBRARY_STATUSES.map((s) => ({ value: s as StatusFilter, label: S.status[s] }))]}
        />
        <Chips
          label={S.filters.kind}
          value={kind}
          onChange={setKind}
          options={[
            { value: "all" as KindFilter, label: S.filters.all },
            { value: "audio" as KindFilter, label: S.kind.audio },
            { value: "video" as KindFilter, label: S.kind.video },
          ]}
        />
        {userId && (
          <button type="button" className="btn-ghost btn-sm" aria-label={S.clearUser} onClick={clearUser}>
            {S.userFilter(userId)} ×
          </button>
        )}
      </div>
      {paged.loading ? (
        <Skeleton rows={4} />
      ) : paged.error ? (
        <ErrorState message={paged.error} onRetry={paged.reload} />
      ) : (
        <div className="panel">
          <DataTable columns={columns} rows={paged.items} empty={S.itemsEmpty} rowKey={(r) => r.id} caption={S.items} />
        </div>
      )}
      <LoadMore paged={paged} />

      <ConfirmDialog
        open={pending !== null}
        title={dialog.title}
        body={dialog.body}
        danger={dialog.danger}
        requireTyping={dialog.typing}
        reasonRequired
        onConfirm={confirm}
        onClose={() => setPending(null)}
      />
    </Page>
  );
}
```

`admin/src/features/library/index.ts` 末尾追加一行:

```ts
export { LibraryPage } from "./library-page";
```

`admin/src/components/layout.tsx`(两处 Edit):

old:
```tsx
import { AgentIcon } from "../features/agents/agent-icon";
import { S as AGENTS_STRINGS } from "../features/agents/strings";
```
new:
```tsx
import { AgentIcon } from "../features/agents/agent-icon";
import { S as AGENTS_STRINGS } from "../features/agents/strings";
import { LibraryIcon } from "../features/library/library-icon";
import { S as LIBRARY_STRINGS } from "../features/library/strings";
```

old:
```tsx
      { to: "/wordbook", label: WORDBOOK_STRINGS.title, icon: BookIcon, min: "viewer" },
```
new:
```tsx
      { to: "/wordbook", label: WORDBOOK_STRINGS.title, icon: BookIcon, min: "viewer" },
      { to: "/library", label: LIBRARY_STRINGS.title, icon: LibraryIcon, min: "viewer" },
```

`admin/src/app.tsx`(两处 Edit):

old: `import { LinksPage } from "./features/links";`
new:
```tsx
import { LibraryPage } from "./features/library";
import { LinksPage } from "./features/links";
```

old: `          <Route path="wordbook" element={<WordbookPage />} />`
new:
```tsx
          <Route path="wordbook" element={<WordbookPage />} />
          <Route path="library" element={<LibraryPage />} />
```

- [ ] **Step 4: 运行,确认通过** — `cd admin && yarn vitest run src/features/library src/components/layout.test.tsx src/app.test.tsx && cd .. && yarn workspace admin typecheck`。(`layout.test.tsx` / `app.test.tsx` 只是回归跑,不改它们。)

- [ ] **Step 5: 提交**

```
feat(admin): library page with switches, usage, top users and item moderation (no titles or URLs)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

### Task AW3: 用户详情页的占用条与 feature `CLAUDE.md`

**Files:**
- Create: `admin/src/features/library/user-library-usage.tsx`、`admin/src/features/library/user-library-usage.test.tsx`、`admin/src/features/library/CLAUDE.md`
- Modify: `admin/src/features/library/index.ts`(追加一行)、`admin/src/pages/user-detail-page.tsx`

**Interfaces:**
- Produces:`UserLibraryUsage({ userId: string })`——总开关关且没有条目时不渲染;读取失败显示一行灰字;有数据时显示「条目 / 上限 · 已用 / 配额」和「查看条目」链接(`/library?user=<id>`)。
- Consumes:`fetchUserLibrary`(AW1)。

- [ ] **Step 1: 写失败测试** — `admin/src/features/library/user-library-usage.test.tsx`:

```tsx
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserLibraryUsage } from "./user-library-usage";

const body = {
  user_id: 10000101, enabled: true, items: 2, bytes: 12582912, quota_mb: 2000, max_items: 100,
  by_status: { uploading: 0, queued: 0, processing: 0, ready: 2, failed: 0, canceled: 0 },
};

function stub(out: unknown, status = 200) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(out), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

const renderUsage = () =>
  render(
    <MemoryRouter>
      <UserLibraryUsage userId="10000101" />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UserLibraryUsage", () => {
  it("shows items, bytes and the effective quota with a link to the filtered list", async () => {
    const calls = stub(body);
    renderUsage();
    expect(await screen.findByText("2 / 100 条 · 已用 12.0 MB / 配额 2,000 MB")).toBeTruthy();
    expect(calls).toEqual(["/api/admin/library/users/10000101"]);
    expect(screen.getByRole("link", { name: "查看条目" }).getAttribute("href")).toBe("/library?user=10000101");
  });

  it("renders nothing while the library is off and the user has no items", async () => {
    const calls = stub({ ...body, enabled: false, items: 0, bytes: 0 });
    const { container } = renderUsage();
    await waitFor(() => expect(calls).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).toBe("");
  });

  it("still shows old items after the library was switched off", async () => {
    stub({ ...body, enabled: false });
    renderUsage();
    expect(await screen.findByText("2 / 100 条 · 已用 12.0 MB / 配额 2,000 MB")).toBeTruthy();
  });

  it("shows a quiet line when the request fails", async () => {
    stub({ error: "boom" }, 500);
    renderUsage();
    expect(await screen.findByText("跟读库占用读取失败")).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行,确认失败** — `cd admin && yarn vitest run src/features/library`。预期:`Failed to resolve import "./user-library-usage"`。

- [ ] **Step 3: 实现** — `admin/src/features/library/user-library-usage.tsx`:

```tsx
import { Link } from "react-router-dom";
import { useAsync } from "../../hooks/use-async";
import { formatBytes } from "../../lib/format";
import { fetchUserLibrary } from "./api";
import { S } from "./strings";

const n = (v: number) => v.toLocaleString("en-US");

/** 用户详情页的「跟读库」占用条(spec §12;配额含按用户覆盖,覆盖本身在「治理」页签的配额表里改)。 */
export function UserLibraryUsage({ userId }: { userId: string }) {
  const { data, error } = useAsync(() => fetchUserLibrary(userId), [userId]);
  if (error) return <p className="text-xs text-muted">{S.usage.failed}</p>;
  if (!data || (!data.enabled && data.items === 0)) return null;
  return (
    <section aria-label={S.usage.title} className="panel fade-in flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="eyebrow">{S.usage.title}</p>
        <p className="num mt-0.5">{S.usage.line(n(data.items), n(data.maxItems), formatBytes(data.bytes), n(data.quotaMb))}</p>
      </div>
      <Link className="btn-ghost btn-sm shrink-0" to={`/library?user=${encodeURIComponent(userId)}`}>
        {S.usage.view}
      </Link>
    </section>
  );
}
```

`admin/src/features/library/index.ts` 末尾追加一行:

```ts
export { UserLibraryUsage } from "./user-library-usage";
```

`admin/src/pages/user-detail-page.tsx`(两处 Edit):

old: `import { UserRankPanel } from "../features/rank";`
new:
```tsx
import { UserLibraryUsage } from "../features/library";
import { UserRankPanel } from "../features/rank";
```

old:
```tsx
            </section>

            <div className="sticky z-10
```
new:
```tsx
            </section>

            <UserLibraryUsage userId={id} />

            <div className="sticky z-10
```

`admin/src/features/library/CLAUDE.md`:

```markdown
# admin/src/features/library/

## What lives here
管理后台「跟读库」页 `/admin/library`(spec 2026-10-13-video-import §12、E10;plan `docs/superpowers/plans/2026-10-13-video-import-admin.md`;
桌面 ≥ 1024px):`api.ts`(`/api/admin/library*`,snake → camel;`deletePhrase`)、`strings.ts`(zh-CN,也给 `components/layout.tsx`
的导航项用)、`library-page.tsx`(开关与版本、计数、占用排行、条目表:状态 / 种类筛选 + `?user=<id>` 所有者筛选;操作员可取消、删除、
清理失败项)、`user-library-usage.tsx`(用户详情页的占用条)、`library-icon.tsx`(导航图标)、`index.ts`。

## Allowed dependencies
`../../api/*`、`../../components/*`、`../../hooks/*`、`../../lib/*`。不导入其他 feature(`camel` 复制了一份)。
`components/layout.tsx` 只导入这里的 `strings.ts` 与 `library-icon.tsx`;`pages/user-detail-page.tsx` 与 `app.tsx` 只从 `index.ts` 导入。

## Test
`cd admin && yarn vitest run src/features/library`(fetch 打桩,角色用 `session.setSession`)。

## Pitfalls
- 管理员看不到内容:类型里没有标题、网址、字幕与句子,**不要加**;服务端也不返回(`tests/test_admin_library.py` 的隐私测试)。
- 开关只显示不修改:改开关去「设置 → 跟读库」(唯一写入路径 settings_service,含危险确认与审计)。
- 删除要输入 `DELETE <id 前 8 位>`,清理失败项要输入总览给的 `purge_confirm`(数字变了旧短语失效,服务端 409 给新短语);都要理由。
- `running` 是本进程的数字;队列与处理中来自数据库。工具版本每进程缓存 10 分钟。
```

- [ ] **Step 4: 运行,确认通过** — `cd admin && yarn vitest run src/features/library src/pages && cd .. && yarn workspace admin typecheck`。

- [ ] **Step 5: 提交**

```
feat(admin): show library usage on the user detail page

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

---

## 验证矩阵

| 验收(spec §13「必须由测试证明 … 管理端各项」) | 证明 |
|---|---|
| 四个诊断发现、只在总开关开时、消息不含路径 | AS1 `test_*`(纯函数)+ `test_doctor_endpoint_gathers_library_facts` |
| 总览数字、开关、版本、cookies / 代理只给布尔值 | AS2 `test_overview_*` |
| 条目分页与筛选、行里没有标题 / 网址 | AS2 `test_items_*` |
| 占用排行、单个用户占用含配额覆盖 | AS2 `test_top_users_by_bytes`、`test_user_usage_honours_quota_overrides` |
| 删除:操作员 + 输入确认 + 审计只记 id 与字节、清目录 | AS3 `test_delete_needs_operator_and_the_typed_phrase` |
| 取消、清理失败项(含上限) | AS3 `test_cancel_only_running_items`、`test_purge_*` |
| 响应 / 日志 / 审计没有内容;URL 只有 id | AS3 `test_no_titles_or_urls_in_logs_responses_or_audit`、`test_admin_library_urls_carry_only_ids` |
| 每个管理端路由声明角色 | 现有 `tests/test_admin_routes_guarded.py`(自动覆盖) |
| 网页:显示、角色隐藏、输入确认、筛选、导航、用户详情 | AW1–AW3 的 vitest |

## 未验证清单(合并后在结果文档逐条写「已做 / 未做」)

- **UNVERIFIED** 容器里 ffmpeg 的真实版本行(Debian 包形如 `ffmpeg version 5.1.x-0+deb12u1`)能被 `parse_ffmpeg_version` 解析:本机没有 ffmpeg 时 `test_ffmpeg_version_reads_the_real_binary` 跳过;Z 车道 `docker compose build` 后在容器里 `uv run pytest -q tests/test_admin_library.py -k real_binary`(只在用户要求重建容器时)。
- **UNVERIFIED** cookies 文件权限检查在真实 Linux 部署上的表现(测试用假 `stat`;Windows 开发机不判权限)。
- **UNVERIFIED** 总览与列表在 Postgres 上的行为(测试默认内存 SQLite;`TEST_DATABASE_URL=postgresql+asyncpg://... uv run pytest -q tests/test_admin_library.py` 未跑)。`top_users` 的 `ORDER BY coalesce(sum(...))` 与 `count(distinct)` 是标准 SQL,预期无差异。
- **UNVERIFIED** S1 的删除 / 取消在「运行中的任务」上与管理端的交互(本计划的测试只覆盖 `queued` 与非运行条目,运行中任务的终止由 S1 的测试覆盖);尤其 R-A3 的「审计在 S1 调用之后」在 SQLite 上是否完全避开锁等待,只在真实运行时可见。
- **UNVERIFIED** 管理后台页在真实桌面浏览器里的版式(没有视觉对照;只有 jsdom 测试)。
- **UNVERIFIED** 写计划时本计划的代码与测试一行都没有运行过(见 Global Constraints「验证口径」)。

## 不做

- 管理端查看或下载媒体、标题、网址、字幕、句子(E10)。
- 管理端修改跟读库开关(只链接到「设置 → 跟读库」,那一组由 S1 的设置登记表自动出现)。
- 按用户批量删除库条目(删除用户时由 S1 的 `users_admin.delete_user` 改动处理)。
- 清理「已取消」条目(S1 的 7 天清理负责,R-A14)。
- 窄屏适配(管理后台只支持桌面,沿用 `DesktopOnly`)。

## 与 spec 的偏差

- **D-1(补充,不改 spec 含义)** 列表行比 spec §12 多 `id`、`user_id`、`source`、`progress`、`error_kind`(都不是内容,R-A7);总览多 `link.proxy_configured` 布尔值(R-A10)。
- **D-2(补充)** spec §12 没有给用户详情占用的端点,本计划新增 `GET /api/admin/library/users/{user_id}`(R-A11);输入确认短语的具体写法由本计划定(R-A4)。
- **D-3(文件归属)** 三处显示上的小缺口落在**本车道不拥有、spec §15 也没有分配**的文件里,本计划不改,交给 Z 车道或编排者:(a)`admin/src/features/users/strings.ts` 的 `quota.labels` 缺 `library_quota_mb`(建议「跟读库容量(MB)」)、`library_max_items`(建议「跟读库条目上限」),在补上之前配额表显示原始键名(`quota-table.tsx` 的 `?? item.key` 回退);(b)`admin/src/strings.ts` 的 `practiceSource` 缺 `library`(建议「跟读库」),用户详情「练习」页签对来源为 `library` 的条目显示原始值;(c)`admin/README.md` 的功能表缺一行 `library`。另外 `server/app/routers/CLAUDE.md`(S1 所有)应列出 `admin_library`,若 S1 没写,由 Z 补。
- **D-4(测试位置)** 诊断测试放在 `tests/test_admin_library.py` 而不是 `test_admin_doctor.py`(后者不在本车道,R-A13);管理端的隐私与 URL 测试也在本车道文件里,不在 S1 的 `test_library_privacy.py`(R-A15)。
- **D-5(顺序)** spec 的合并顺序把「A 网页」放在 W2 之后;本计划的 AW 与 W2 没有共同文件,保留 spec 的顺序,但标明编排者可以让 AW 在 AS 合并后提前。

## Cross-plan assumptions(依赖 S1 的接口,A0 逐项核对)

| 依赖 | spec 依据 | 本计划假设的确切形状 |
|---|---|---|
| 表与模型 | §4「`library_items` … 列表」 | `app.models.LibraryItem`,列名同 spec §4,`id` 是 36 字符 uuid 字符串(小写、带连字符) |
| 删除 | §4「`library.store.delete_item` 与删用户都要显式删 … 并清目录」 | `async app.library.store.delete_item(session, app, item: LibraryItem) -> None`;可能自己提交 |
| 取消 | §6.5「取消 … 终止子进程、清 `_tmp`、条目标 `canceled`」 | `async app.library.store.cancel_item(session, app, item: LibraryItem) -> None`;调用后条目状态为 `canceled` |
| 识别计数 | §6.4.7「`daily_usage` 里按『秒』预留(`scope="library_asr"`,`subject` = 用户 id 与 `*`)」 | 全站一行 `DailyUsage(scope="library_asr", subject="*", day=utc_day(now))`,`count` 为秒 |
| worker | §6.1「`app.state.library` … 运行中的任务放在 `self.pending`(集合)」 | `getattr(app.state, "library", None).pending` 是可 `len()` 的集合 |
| 设置 | §5.2 表与「`Settings` 属性」 | 字段与属性名同 spec §5.2(见 A0 第 7 项) |
| 配额键 | §2.2「`library_quota_mb`、`library_max_items` 要加进去」 | `QUOTA_KEYS` 含这两个键,值等于设置字段名 |
| 分层 | §3「`admin` 的允许列表追加 `library`」 | `tests/test_architecture.py` 的 `"admin"` 集合含 `"library"` |
| `main.py` 锚点 | §15「S1 … 为 `admin_library` 留带标签的锚点注释」 | 锚点在路由元组中 `stubs` 之前 |
| 删用户 | §4「`delete_user` 的改动算 S1 的文件」 | 删用户时 S1 已清该用户的库行与目录;管理端不另做 |
| D8 设置 | §5.2 末四行、§15「D8 增补的归属:S1」 | `Settings.library_ai_enabled: bool`、`library_translate_daily_per_user: int`、`library_analysis_daily_per_user: int`、`library_ai_daily_global: int`;属性 `library_ai_available: bool`(R-A19) |
| D8 额度计数 | §5.2「每人每天生成译文的句数 / 分析次数 / 全站合计」、E12「额度按『句』计」 | `daily_usage` 里 `scope="library_translate"` 与 `scope="library_analysis"`,`count` 为句数;全站行 `subject="*"` 和 / 或每人行 `subject=<用户 id>`(`_day_total` 两种都能读,R-A20);A0 第 11 项核对 |
| D8 句子表 | §4「`library_segments` … `zh`、`zh_lang`、`analysis`、`analysis_lang`」 | `app.models.LibrarySegment(item_id, idx, start_ms, end_ms, text, zh, zh_lang, analysis, analysis_lang)`;`delete_item` 显式删它(只用于测试数据与删除断言,管理端代码从不查询该表) |

## Addendum (2026-10-13)

> 2026-10-13 修订的 spec(D8 译文与分析、D9 入口与跟读交互、D10 第二期清单、D11 强玻璃视觉、D12 外观开关、E9 独立底部标签、E11 / E12)对本车道的影响,以及上面各节已就地改动的清单。本节的裁定(R-A19–R-A23,写在「本计划的裁定」末尾)覆盖更早的文字;**没有新增任务**,仍是 A0 + AS1–AS4 + AW1–AW3 共 8 个任务,只是其中 AS2、AS3、AW1、AW2 的内容变了,A0 的核对表多了两行。

### 逐项对照修订后的 spec

| 修订项 | 对本车道的影响 | 处理 |
|---|---|---|
| **D8 / §5.2 / §15 A 行**:总览要显示译文 / 分析的今日句数与 AI 开关状态 | **有** | R-A19、R-A20;AS2 的 `overview` 多一个 `ai` 块;AW1 类型 / 文案、AW2 页面多一个状态点与一行每人上限 |
| **D8 / E11 / §4**:`library_segments` 新增 `zh`、`zh_lang`、`analysis`、`analysis_lang`(都是内容) | 隐私面扩大:管理端永不查询该表 | R-A21;测试的 `no_content` 加三个标记,AS2 / AS3 的数据造带句子行的条目;AS3 删除测试断言句子行随条目一起被 S1 删除;AW2 的删除确认文案提到译文与分析 |
| **§5.2 新设置 + `GROUPS`**:四个 AI 设置进「跟读库」组 | 无工作:设置页的分组来自服务端接口 | R-A22(已核对 `settings-page.tsx` 的 `groups` 来自 `list.groups`);总览页的「去设置」链接指向 `/settings/library`,不变 |
| **§12 管理端**(未变):`delete` 的审计只记 id 与字节、`purge_failed` 只记数量 | 重新对照,无变化 | R-A4、R-A6 不变;`library.item.delete` 的 `after` 仍只有 `{"bytes": n}`(译文与分析是随条目一起删掉的内容,不单独记) |
| **E9** 独立底部标签、**D9** 跟读 / 盲听 / 排序、**D10** 第二期清单、**D11** 强玻璃与 12 个效果、**D12** 外观开关 | 都是 `web/` 的事 | R-A23:管理后台不加玻璃、不加外观开关,也不做第二期功能;「不做」一节不变 |
| **§15 合并顺序** `S1 →(S2 ‖ A 服务端 ‖ W1)→ W2 → A 网页 → Z`、A 只在 `main.py` 的锚点追加两行 | 重新对照,与 R-A16 一致 | 无变化 |
| **§16 开放问题**按推荐默认值 | 总览读到的默认值:`library_enabled` / `library_asr_enabled` / `library_link_import_enabled` / `library_ai_enabled` 都默认关 | 测试里 `ai.enabled` 默认 `False`(AS2 `test_overview_counts_numbers_only` 的整体断言);无其他变化 |

### 就地改动清单(执行者照上面各任务的最新代码做,不要再按旧版)

- **Goal / Spec / 裁定**:Goal 一行与 Spec 一行加了 D8;新增 R-A19–R-A23。
- **A0**:核对表第 7 项补四个 AI 设置与 `library_ai_available`;新增第 11 项(AI 额度的 `daily_usage` scope 与 subject)、第 12 项(`LibrarySegment` 的列);结果模板加两行。
- **AS2**:Interfaces 加 `ai` 块、`AI_TRANSLATE_SCOPE` / `AI_ANALYSIS_SCOPE`、`_day_total`;测试导入 `LibrarySegment`,新增常量 `SENTENCE` / `ZH` / `ANALYSIS` / `CONTENT_MARKERS`,`add_item(..., segments=False)`、`segment_count`、`no_content` 扩展、`test_overview_ai_block_counts_todays_sentences_from_daily_usage`、`test_overview_counts_numbers_only` 里的 `ai` 整体断言;实现里 `_day_total` 与 `overview` 的 `ai` 键。`limits` 不变。
- **AS3**:删除与隐私测试带句子行(`segments=True`),并断言删除后句子行为 0。
- **AS4**:`library_admin.py` 的 CLAUDE.md 条目提到 AI 计数只读 `daily_usage`、不读 `library_segments`。
- **AW1**:`LibraryOverview.ai`、`api.test.ts` 的总览用例、`strings.ts` 的 `S.ai`、删除确认文案。
- **AW2**:页面 `Summary` 多一个 AI 状态点与每人上限行;测试夹具与新用例(`stubFetch(ov)`)。
- **AW3**:不变(用户详情的占用条不含 AI 用量;spec §12 没要求)。

### 本次重新检查后确认不变的点

- `library_admin.py` 的查询仍只选非内容列;`ai` 块只有布尔值与数字。
- 写端点、输入确认短语、审计动作名与载荷、角色(`viewer` 读 / `operator` 写,无 step-up)、`/api/admin/library*` 路由表(`test_admin_library_urls_carry_only_ids`)都不变:D8 没有新增管理端路由。
- 诊断仍是 spec §5.2 列的四个发现。**没有**为 `library_ai_enabled` 加第五个发现(例如「开了 AI 但没有大模型上游」):spec 只列四个,`ai.available` 为假时总览页已用黄色状态点提示;若要加,须先改 spec。

### 验证口径与未验证(追加)

- 本次修订只改了计划文档:**没有运行**任何代码或测试;AS2 / AS3 / AW1 / AW2 里新增的断言都按 S1 尚未写成的接口假设(`library_ai_*` 设置、`daily_usage` 的 scope 名、`LibrarySegment` 的列),A0 第 7、11、12 项逐项核对后再执行。
- **UNVERIFIED** AI 额度的 `daily_usage` scope 名(`library_translate` / `library_analysis`)与「全站行 / 每人行」的写法:读 S1 的 `app/library/ai.py` 之前是假设(R-A20);`_day_total` 取 `max(全站行, 每人行之和)` 是为了对两种写法都成立,不是 S1 的承诺。
- **UNVERIFIED** `library_ai_available` 的确切语义(是否包含「大模型上游已配置」):总览只原样显示它。
- **UNVERIFIED** 总览的 `ai` 数字在 Postgres 上的行为(两个 `sum(...)` 标准 SQL,预期无差异;未跑 `TEST_DATABASE_URL`)。
- 验证矩阵新增两行:**AI 开关与今日句数**由 AS2 `test_overview_ai_block_counts_todays_sentences_from_daily_usage`、`test_overview_counts_numbers_only` 与 AW1 / AW2 的 vitest 证明;**句子 / 译文 / 分析不出现在任何响应、日志、审计里,且随条目删除**由 AS3 `test_no_titles_or_urls_in_logs_responses_or_audit`、`test_delete_needs_operator_and_the_typed_phrase` 证明。

### 与 spec 的偏差(追加)

- **D-6(补充)** spec §15 只说「`overview` 增加今日译文 / 分析句数」,没有给字段;本计划定为 `ai` 块(R-A19),并多给了开关、可用性与三个上限数字,都不是内容。
- **D-7(口径)** 「今日句数」读 `daily_usage` 而不是数 `library_segments`(R-A20):后者是内容表且没有生成时间;两者在「命中已存的不计」的口径下含义也不同,额度口径才是管理员关心的。
