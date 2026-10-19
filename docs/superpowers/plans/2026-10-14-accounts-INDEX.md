# 账号体系 v2 · 三份计划的总索引(INDEX)

- 日期:2026-10-14 · 状态:只有文档,没有产品代码;未提交
- Spec:`docs/superpowers/specs/2026-10-14-accounts-email-invites-design.md`(用户已批准;§6 的用户码按用户修订版执行)
- 本文是三份计划之间的**唯一裁决来源**:计划与本文冲突时以本文为准;spec 不改,本文 §5 列出对 spec 的修正建议(计划仍按 spec 执行,修正建议待用户确认)。
- 写计划时读过的真实代码(只读):`server/app/{models,main}.py`、`app/core/{deps,security,secretbox,quotas,metering,ratelimit,errors,bodylimit,config,settings_registry,runtime_settings}.py`、`app/routers/{sessions,stubs,admin_users,announcements,changelog}.py`、`app/services/invites.py`、`app/admin/{invites,users_admin,service,probes,doctor,housekeeping,backups}.py`、`app/rooms/{store,summary_store,connection,agent_mentions,agent_lane,protocol}.py`、`app/routers/{rooms,rooms_voice,admin_rooms}.py`、`tests/{conftest,background,test_architecture,test_settings_registry,test_auth}.py`、`alembic/versions/`;网页 `src/{app.tsx,architecture.test.ts}`、`api/{client,auth-storage}.ts`、`auth/auth-context.tsx`、`pages/login-page.tsx`、`components/avatar.tsx`、`features/rooms/{protocol.ts,room-settings-sheet.tsx}`、`scripts/check-main-bundle.mjs`;管理端 `src/app.tsx`、`features/users/*`、`features/settings/probe-button.tsx`;桌面端(只读)`enjoy/src/shared/api/client.ts`、`renderer/components/login/*`、`shared/types/user.d.ts`。**没有运行任何测试**;计划里的测试名与断言是要执行者先写的失败测试,执行者首次运行时以真实结果为准修正测试数据,不得改动裁定、接口名与隐私断言。

## 1. 计划一览

| | 名称 | 计划 | spec 阶段 | 任务 | 车道 | 迁移 |
|---|---|---|---|---|---|---|
| **F** | 地基 + 邮箱 | `2026-10-14-accounts-foundation-email.md` | P1 + P2 | 36(Task 0、S1–S23、A1–A3、W1–W7、Z1–Z2) | S、A、W、Z | `0021`(P1)、`0022`(P2) |
| **V** | 头像 | `2026-10-14-accounts-avatar.md` | P3 | 16(Task 0、S1–S9、W1–W4、A1、Z1) | S、W、A、Z | `0023` |
| **I** | 邀请码 v2 | `2026-10-14-invites-v2.md` | P4 | 16(Task 0、S1–S8、W1–W4、A1–A2、Z1) | S、W、A、Z | `0024` |

合计 68 个任务。F 计划内部分两次发布:**F-P1 = Task 0、S1–S9、W1–W2**;**F-P2 = S10–S23、A1–A3、W3–W7、Z1–Z2**。P1 不改变任何现有接口的行为(只加字段与新端点),可以单独上线与回退。

## 2. 合并顺序(权威)

**F-P1 → F-P2 → V → I → 全局验收。**

- 开发可并行(各车道各自的 worktree,`node_modules` 用联接/符号链接,见根 `CLAUDE.md`),**合并不能越过前一步**。
- V 依赖 F-P1(`GET /api/me` 的形状、`display_name()`、`current_user_unbound`);V 的 W 车道依赖 F 的 W1(`api/types.ts` 的 `UserProfile`)。
- I 依赖 F-P2(注册事务、`users.email_verified_at`、`services/identities.py`、注册页 `/register`)与 F-P1 的 `display_name()`。
- 同一计划内:S 车道按编号串行;W 车道从 W1 起可与 S 并行(用 fetch 模拟),涉及契约夹具的 W 任务在对应 S 任务之后合并;A 车道在它调用的服务端端点合并之后。

| 后来的 | 必须等 | 原因 |
|---|---|---|
| F Task 0 | 无 | 核对迁移头(见 §3) |
| F S10(P2 迁移) | F-P1 全部合并 | `0022` 的 `down_revision = "0021"` |
| V Task 0 | F 全部 | `0023`、`/api/me` 字段、`display_name()` |
| I Task 0 | F 全部(V 可在前) | `0024`、注册事务、邮箱已验证判断 |
| 全局验收 | F、V、I | 见 §7 |

## 3. 迁移链(线性)

**已核对的真实迁移头是 `0020`(`server/alembic/versions/0020_changelog.py`,提交 `692b84c0`),不是 spec 与 `server/app/CLAUDE.md` 写的 `0019`**(`app/CLAUDE.md` 的「head `0019`」已过期)。测试里钉着 head 的地方现在是 7 处:`tests/test_migrations.py` 5 处、`tests/test_library_models.py` 1 处、`tests/test_changelog_models.py` 1 处(均为 `get_heads() == ["0020"]`)。

**撞号风险:** `docs/superpowers/plans/2026-10-14-library-alignment-v2.md` 也计划用 `0020`(`0020_library_word_alignment.py`),写计划时它尚未实现,而 `0020` 已被 changelog 占用——它实施时必须顺延。本组计划的约定:

`0020_changelog` → `0021_accounts_foundation`(F-P1)→ `0022_accounts_email`(F-P2)→ `0023_accounts_avatar`(V)→ `0024_invites_v2`(I)

- 每份计划的 Task 0 先跑 `cd server && uv run alembic heads`;若 head 不是预期的前一个(例如 alignment-v2 先合并占了 `0021`),**本计划及其后的计划全部顺延一个号**,并在本 INDEX 的本节追加一行记录实际编号。
- 每个迁移:SQLite 走 `batch_alter_table`、Postgres 路径不重写大表;往返测试(`upgrade → downgrade -1 → upgrade`);`tests/test_migrations.py::test_models_match_migrations` 绿;同一提交把所有 head 钉子改成新号(Task 0 用 `Grep "get_heads\(\) == \[" server/tests` 列出准确清单)。
- **部署前备份 PostgreSQL**(`pg_dump`;管理后台的「备份」只覆盖数据库,Task 0 核对其范围,头像文件目录 `DATA_DIR/avatars/` 需另行备份,见 V 计划)。

**实际编号(2026-10-19 记录,执行前核对):** 写计划之后 `0021_library_word_alignment`、`0022_curated_catalog` 已合并,真实 head 是 **`0022`**。因此本组计划里出现的 `0021`/`0022`/`0023`/`0024` **一律读作 `0023`/`0024`/`0025`/`0026`**(`0023_accounts_foundation`、`0024_accounts_email`、`0025_accounts_avatar`、`0026_invites_v2`),`down_revision` 依次为 `0022`、`0023`、`0024`、`0025`;head 钉子(现为 8 处 `["0022"]`:`test_migrations.py` 5、`test_library_models.py` 1、`test_changelog_models.py` 1、`test_library_catalog_models.py` 1)每次改成新号。测试名里的 `0021` 等同理改名(如 `test_head_is_0023_and_chain_is_linear`)。

| 迁移(计划原编号) | 内容 |
|---|---|
| `0021` | `users.nickname`(可空)、`users.email_verified_at`(可空);新表 `user_identities`;`access_tokens.expires_at`、`access_tokens.last_used_at`(均可空,迁移内回填 `expires_at = 迁移时刻 + 30 天`) |
| `0022` | 新表 `verification_codes`、`email_daily_counts` |
| `0023` | `users.avatar_id`(可空、唯一);新表 `avatar_reports` |
| `0024` | `invite_codes.kind`(非空,默认 `admin`)、`owner_user_id`(可空,`ON DELETE SET NULL`)、`code_enc`(可空);部分唯一索引「每个所有者一个未撤销码」;新表 `invite_redemptions` |

## 4. 裁决(与计划冲突时,以此为准)

### 4.1 服务端结构

- **X1 不新增分层包,`tests/test_architecture.py` 不改。** 新模块全部落在现有包里:`providers/email.py`(发信后端;providers 只依赖 core,不用 FastAPI)、`services/{nicknames,identities,email_domains,verification,mailer,avatars,user_invites}.py`(services → core、models、providers)、`admin/{user_email_admin,avatars_admin}.py`、`routers/{account,avatars,invites_me,admin_avatars}.py`。`display_name()` 是 SQL 表达式,放 `app/models.py`(models 只依赖 core 与 SQLAlchemy)。若执行中发现必须新包,停下报告,不得放宽测试。
- **X2 新路由在 `create_app` 的列表里紧跟 `sessions`**(`sessions, account, avatars, invites_me, ...`),管理端的 `admin_avatars` 放在 `admin_changelog` 之后;全部在 `stubs` 之前(`stubs` 的 `GET /{path}` 兜底返回 404、写入兜底「收下即丢」,排在后面的真实路由会被遮住)。
- **X3 `current_user` 仍是唯一入口。** `core/deps.py` 抽出 `_authenticate()`(Bearer → 未过期 token → 用户 → 停用检查 → 滑动续期 → `metering.bind_user` / `learning_events.bind`),`current_user` = `_authenticate` + 强制绑定检查(F-P2 S21),`current_user_unbound` = 只有 `_authenticate`。`limited_user` 依赖 `current_user`,自动受强制绑定约束。用 `current_user_unbound` 的端点只有:`GET /api/me`、`POST /api/me/email/code`、`POST /api/me/email`、`DELETE /api/sessions/current`(登出)。`GET /api/announcements` 本来就不需要登录(已核对 `routers/announcements.py`),不需要改(§5 修正 3)。
- **X4 token 撤销 = 删除 `access_tokens` 行**(与现有管理员「撤销登录」`users_admin._drop_tokens` 一致),不加 `revoked_at` 列。`expires_at` 可空:`NULL` 视为有效、在第一次使用时由滑动续期写上(防止滚动部署期间旧进程写入的 token 立刻失效);`current_user` 条件 `expires_at IS NULL OR expires_at > now`。
- **X5 spec 假定存在、但代码里没有的两个端点由 F-P1 新增**:登出 `DELETE /api/sessions/current`(删除当前 token,204;网页登出今天只清本地,服务端 token 仍有效)与改密 `POST /api/me/password {current_password, new_password}`(删除该用户全部 token 后签发一个新 token 返回,并断开实时通话 / 房间连接)。桌面端 `enjoy/` 不调用这两个端点(已核对 `enjoy/src/shared/api/client.ts`),不受影响。
- **X6 `User.username` 的显示名改造范围(Task 0 已列清单,F S7/S8 执行):**
  - **改为 `COALESCE(nickname, username)`(给其他用户看)— 10 处直接 + 6 处间接:** `rooms/store.py` 第 177 行(默认房间名)、385(入房申请)、459(`RoomStore.username()`,改名 `display_name()`)、470(成员列表)、730(消息发送者);`rooms/summary_store.py` 148(学习小结的输入行);`routers/rooms.py` 355、620、665(系统消息里的 `user.username`);`routers/rooms_voice.py` 160(语音消息发送者)。经 `RoomStore.username()` 间接使用的:`routers/rooms.py` 278、602、622、746(746 是 WS 连接名,进而成为智能体的 `asker_name`)、`routers/admin_rooms.py` 81。
  - **保持 `username`(运营身份 / 审计 / 确认串)— 管理端约 35 处:** `admin/agents_admin.py`、`library_admin.py`、`rooms_admin.py`、`service.py`、`storage.py`、`usage.py`、`users_admin.py`(审计 `summary` 与删除确认串)。理由:管理端是运营者识别账号,不是「给别人看」;昵称是用户可控文本,不进入哈希链审计。F S8 只在**用户列表 / 详情**与**房间成员 / 消息审核**两处**追加** `nickname` 字段(加法),搜索同时匹配昵称。
  - **保持 `username`(登录名):** `routers/sessions.py` 的 `UserOut.name`(见 X7)、查找登录用户。
  - 已有房间系统消息的参数(`{"name": ...}`)是写入时的快照,不回改;消息的发送者名是读取时 join 出来的,改昵称后历史消息显示新昵称。
- **X7 `UserOut.name` 保持 = `username`**:桌面端 `UserType.name` 显示在侧栏、并写进聊天提示词,网页 `auth-storage` 用 `user.name` 判定会话形状;新字段 `nickname`、`display_name`、`email_masked`、`email_verified`、`email_binding`、`avatar_url` 全部是加法。网页显示自己的名字改读 `display_name`。
- **X8 昵称规则**(`services/nicknames.py`,纯函数):NFC 规范化、去首尾空白、内部连续空白压成一个空格;长度 1–20(按码点);拒绝 Unicode 类别 `Cc`、`Cf`、`Co`、`Cs`、`Zl`、`Zp`;不能以 `@` 开头;不能(忽略大小写)等于 `ai`、`助手`、`AI 助手`(房间 `@ai` 的保留名,`rooms/rules.mention`、`rooms/agent_config.RESERVED_NAMES`;Task 0 核对准确集合)。昵称是用户文本:不进日志、审计;进 LLM 提示词的路径沿用现有 `_plain` / `_flat` / `_escape`。
- **X9 邮箱功能需要两把钥匙:`IDENTITY_PEPPER`(新,env-only secret)与现有的 `SETTINGS_ENCRYPTION_KEY`**(`secretbox.box_for` 在后者为空时返回 `None`,今天它是可选的)。任一缺失或 `EMAIL_BACKEND=off` 时,所有发码 / 绑定 / 邮箱注册端点返回 `503 {"error":"Email is not configured"}`,配置诊断给 `error` 级 `email_not_configured`。两者**不得放在同一份备份**(spec §7)。
- **X10 发码接口的响应(补全 spec §4.1):** 每次请求**无论邮箱是否已注册**都同步写一行 `verification_codes`(已注册邮箱的 `register` 用途写一个从不发送的随机码,发「已注册」通知;未注册邮箱的 `reset` 用途写随机码、不发信)。因此冷却与每日上限对所有邮箱一视同仁,可以如实返回:冷却中 / 单目标日上限 → `429 {"error":"Too many codes, please wait"}`(带 `Retry-After`);单 IP 每小时上限 → 429 同文案;全局日上限 → `503 {"error":"Email temporarily unavailable"}`;域名策略拒绝 → `422 {"error":"Email domain not allowed"}`;其余 → `200 {"ok": true, "cooldown_seconds": 60}`。真正的发送在后台任务。这样不泄露「是否已注册」。
- **X11 `POST /api/users` 的邮箱必填受开关控制**:新设置 `EMAIL_REGISTRATION_REQUIRED`(热改,默认 `true`)。开:`email`、`email_code`、`nickname` 必填;缺 `email` 时返回 `400 {"error":"Email verification required: please register in the web app"}`(桌面端会把它当提示显示)。关:旧行为(只要用户名 + 密码 + 邀请码),`nickname` 可选。理由:79 处测试调用(65 个文件)以「用户名 + 密码」注册,`tests/conftest.py::make_settings` 加一行 `email_registration_required=False` 即可保持它们不变,新测试显式打开;运营者也多一个应急开关(SMTP 故障时临时关闭)。
- **X12 强制绑定截止时间用字符串**:`EMAIL_BINDING_DEADLINE: str = ""`(kind `str`,`Settings` 校验器要求空串或带时区的 ISO 8601 日期时间,例如 `2026-10-28T00:00+08:00`)。现有的 `date` kind 不接受空值(`runtime_settings.coerce` 对空串报错),且 spec 要的是时刻。`EMAIL_BINDING_REQUIRED=true` 且截止为空 = 立即强制(诊断警告 `binding_without_deadline`)。
- **X13 「管理员不受强制绑定影响」**:`users` 表没有管理员标记,管理后台用独立的 `admin_accounts` + Cookie 会话,本来就不经过 `current_user`。因此不需要豁免名单;停用用户在 `_authenticate` 里先得到 `403 Account disabled`。
- **X14 发信计量**:`core/metering.py` 的 `KINDS` 追加 `"email"`、`DAILY_UNIT["email"] = "calls"`、`FEATURE_PREFIXES` 追加 `("/api/email", "account")`、`("/api/me/email", "account")`;每次发送一条 `metering.record("email", "smtp"|"console", "-", status, ms)`:成功 200,SMTP 应答异常记其应答码(如 535),连不上记 0。从不传收件人、主题、正文。
- **X15 发信后台任务的可等待性**:`services/mailer.Mailer`(`app.state.mailer`,`pending: set[asyncio.Task]`),`tests/background.py::_task_sets` 追加它(否则共享 SQLite 连接的测试会偶发失败)。测试用 `providers.email.FakeSender` 通过 `app.state.email_sender_override` 注入,不是一个设置值。
- **X16 Pillow 是新依赖**(`server/pyproject.toml` 目前没有):V S1 `uv add pillow`,同提交 `uv.lock`;Docker 镜像用 manylinux 轮子,Task 0 核对 `server/Dockerfile` 的基础镜像。
- **X17 `avatar_url` 是相对路径** `/api/avatars/<id>`;网页同源可用。桌面端的 `UserType.avatarUrl` 若收到相对路径会按 `file://` 解析而显示失败,回落到首字头像——接受(不改 `enjoy/`)。
- **X18 邀请码格式**:新生成的码(管理员批量、用户码、管理员单个创建)统一 10 位、字符表 `ABCDEFGHJKMNPQRSTVWXYZ23456789`(30 个,去掉 `I L O U 0 1`),显示 `XXXXX-XXXXX`(约 49 bit)。现有管理员码是 12 位 `XXXX-XXXX-XXXX`、字符表含 `U`,**照常可用**(校验只比哈希,`normalise` 不变)。
- **X19 用户码的使用上限是实时的**:`invite_codes.max_uses` 对 `kind=user` 只是创建时的快照;兑换时用 `core.quotas.effective(session, app, owner_id, "invites_user_code_max_uses")` 的当前值做原子条件更新(`uses < :cap`)。所有者被停用时,其用户码不可兑换(按无效码处理)。上限按人累计:更换 / 撤销后新码的 `uses` 继承旧码,更换不会多给次数(I 计划 R-I8)。
- **X20 `open` 注册模式下忽略邀请码**(现状如此:只有 `invite` 模式才校验和扣次数),不写 `invite_redemptions`。
- **X21 管理员批量码的 CSV 在管理端浏览器里生成**(服务端只存哈希,生成后无法再导出);响应带 `Cache-Control: no-store`。
- **X22 SMTP 体检**:`admin/probes.py` 的 `UPSTREAMS` 追加 `"smtp"`;只连接 + TLS + 认证(`login`),不发信;主机先经 `resolve_public` 拒绝私网地址;8 秒超时;结果只有 `{ok,status,ms,code}`。管理端 `probe-button.tsx` 的映射追加 `smtp_host: "smtp"`。

### 4.2 前端

- **X23 新 feature `web/src/features/account/`**(F 创建,V、I 追加):注册页、找回密码页、绑定邮箱页、强制绑定横幅、「我的」页的账号区块(昵称 / 邮箱 / 改密 / 头像 / 我的邀请码)。页面一律 `React.lazy`(`features/account/lazy.tsx`),由 `app.tsx` 与 `pages/me-page.tsx` 经 `~/features/account` 引入——**不新增 feature→feature 边**(`architecture.test.ts` 的基线计数不变)。房间里的头像走共享层 `components/avatar.tsx` 新增的 `src` 属性,`rooms` 不导入 `account`。
- **X24 文案**:`features/account/i18n/{en,zh-CN}.json`,前缀 `web.account.*`(经 `src/i18n/index.ts` 的 `../**/i18n/*.json` glob 进入主包);登录页改动的文案放 `pages/i18n/`(`web.login.*`)。中英齐全;英文标签在 360–375 px 不溢出(按钮 `whitespace-nowrap`、标题 `truncate`,长说明换行)。
- **X25 主包预算(gzip)**:每份计划合并前后各跑一次 `yarn web:build && node web/scripts/check-main-bundle.mjs --max-delta=<预算>`;预算 F ≤ 1.5 kB(登录页、API 方法、横幅与文案进主包,页面懒加载)、V ≤ 0.4 kB、I ≤ 0.4 kB。基线文件 `web/scripts/main-bundle-baseline.json`(写计划时为 396.86 kB,记录于 2026-10-12,已知过期)由 F 的 W1 在开始前 `--record` 一次并单独提交;**实测数字只写进 PR 描述与 §8 执行状态,不在计划里编造**。
- **X26 强制绑定在网页上的形态**:`ApiClient` 新增 `onBindingRequired`(收到 `403` 且 `error === "email_binding_required"` 时调用);`AuthProvider` 置位 `bindingRequired`;`RequireAuth` 在该状态下把除绑定页以外的路由重定向到 `/account/email?required=1`。截止前的横幅数据来自 `GET /api/me` 的 `email_binding: {state: "none"|"pending"|"enforced", deadline}`,`AuthProvider` 登录后与启动时各取一次。
- **X27 分享链接只用 `#` 片段** `/register#invite=XXXXX-XXXXX`:注册页挂载时读 `location.hash`,填入邀请码框,立即 `history.replaceState` 清掉片段;邀请码不进 query、不进日志、不进 `localStorage`。

### 4.3 协议与契约

- **X28 新契约夹具** `server/tests/fixtures/accounts_contract.json`(F S23 录制:`me`、`me_unbound`、`register`、`login`、`email_code`、`password_changed`、`error_binding_required`),网页 `features/account/accounts-contract.test.ts` 逐键读取;`invites_contract.json`(I S8:`my_invite_none`、`my_invite`、`admin_batch`、`admin_list`)。样例里的 token、邀请码、邮箱写 `REDACTED` / `a***@example.com`。
- **X29 房间 WS 载荷加 `avatar_url`(V S8、S9)**:只增不改,`PROTOCOL_VERSION` 仍为 2。`connection.members_out` 每项加 `avatar_url`(可空),消息 `sender` 加 `avatar_url`(可空,系统 / AI 为 `null`)。重录全部 `rooms_*_contract.json`(`rooms_contract`、`rooms_v2_core_contract`、`rooms_v2_voice_contract`、`rooms_v2_summary_contract`、`rooms_reopen_contract`、`rooms_agents_contract`),diff 只应多出 `avatar_url` 键;网页 `protocol.ts` 的 `RoomMemberInfo`、`RoomSender` 加可选 `avatarUrl?: string | null`。

### 4.4 耦合约束(2026-10-19 用户要求"遵循项目规范、减少耦合";与 §4.1–4.3 冲突时以本节为准)

- **X30 `cut_connections` 不让用户路由依赖管理路由。** 把 `routers/admin_users.py::cut_connections` 原样搬到新的非路由模块 `app/routers/live_connections.py`(不含 `APIRouter`,只有该函数及其所需常量),`admin_users` 与 `account` 都从它导入;**由 F S5 完成**(该搬迁是一个独立的前置提交 `refactor(server): move cut_connections to a shared live_connections module`,行为不变)。因此计划里「`routers.admin_users.cut_connections`」处(R-F9、S5 测试、S19)一律改为 `app.routers.live_connections.cut_connections`,测试在**使用处**打补丁:`monkeypatch.setattr("app.routers.account.cut_connections", ...)`。
- **X31 路由只做 HTTP:** 校验入参、映射错误码、调用 services;业务规则、事务边界内的多步逻辑放 `services/*`。路由模块之间除 X30 外不互相导入。`sessions.py` 不再增长新端点:新端点进 `account.py`(已有规划),`sessions.py` 只改注册 / 登录 / 登出 / me 必须改的部分。
- **X32 services 不读 `app.state`、不读全局设置:** 需要的东西(`session`、`Settings`、时钟 `now`、`EmailSender`、`secretbox`、pepper)作为**参数**传入,由路由 / `main.py` 负责从 `app.state` 取。这样纯逻辑可单测,不依赖 FastAPI。`Mailer` 的发送后端由构造函数注入。
- **X33 core 只放无状态的策略与依赖:** 强制绑定的判定 `binding_state(settings, now)` 是纯函数,放新模块 `app/core/account_policy.py`(只依赖标准库与 `app.core.config.Settings`),`core/deps.py` 只调用它;`deps.py` 不导入 `services`、不知道邮箱细节。
- **X34 显示名只有一个来源:** SQL 用 `models.display_name()`,Python 对象用 `models.display_of(user)`;任何位置不得手写 `COALESCE(nickname, username)` 或 `user.nickname or user.username` 的第二份。
- **X35 网页:** `features/account` 只依赖共享层(`~/api`、`~/auth`、`~/components`、`~/i18n`、`~/lib`),对外只经 `index.ts` / `lazy.tsx` 暴露;`auth-context` 不导入 `features/account`——强制绑定通过 `ApiClient.onBindingRequired` 回调与 `AuthProvider` 状态传递(X26);`rooms` 等其他 feature 不导入 `account`,头像走共享的 `components/avatar.tsx`。组件不直接 `fetch`,一律经 `account-api.ts` → `ApiClient`。
- **X36 每个提交范围内聚:** 一个提交只做该任务列出的事;顺手重构另开提交;禁止为了方便把无关函数塞进已有大文件(`deps.py`、`sessions.py`、`models.py` 只改任务点名的位置)。

- **X37 账号页面文案不进主包(修正 X24;2026-10-19 实测依据):** W3–W5 实测主包 +2.31 kB gzip(预算 1.5 kB),主因是 `features/account/i18n/*.json` 被 `i18n/index.ts` 的 `../**/i18n/*.json` glob 急切并入。沿用智能体已有的做法(`features/agents/locales.ts`,R-W3):账号页面的文案放 `features/account/locales/{en,zh-CN}.json`(**不在** `**/i18n/` 目录下,不被 glob 捕获),新增 `features/account/locales.ts` 导出 `ensureAccountI18n()`(`addResourceBundle` 深合并、不覆盖已有键、只执行一次),每个懒加载入口(注册页、找回密码页、绑定页、横幅、账号区块)在模块求值时调用。**只有登录页本身用到的键**留在 `pages/i18n/`(`web.login.*`)。不放宽预算、不改共享的 `i18n/index.ts`。`web.errors.*` 里新增的邮箱相关错误文案同样移进账号 `locales/`(`translateServerError` 在账号页面内调用时,文案已并入)。

## 5. 对 spec 的修正建议(spec 文件不改;计划按本表执行,待用户确认)

| 位置 | 问题(已核对代码) | 本组计划的做法 |
|---|---|---|
| §8、§1 | 迁移头是 `0020`(changelog),不是 `0019`;alignment-v2 计划也占 `0020` | §3:本组用 `0021`–`0024`,Task 0 顺延规则 |
| §1 | 「`admin/*` 约 20 处」把管理端也算作显示名 | X6:管理端保持 `username`,只追加 `nickname` 字段 |
| §3 | 「登出」「改密」端点不存在(网页登出只清本地) | X5:F-P1 新增两个端点 |
| §3 | `GET /api/announcements` 本来就公开 | X3:不需要 `current_user_unbound` |
| §3 | `subject_enc` 依赖的 `SETTINGS_ENCRYPTION_KEY` 今天是可选的 | X9:邮箱功能要求两把钥匙都在 |
| §3 | token「撤销」的实现未说明 | X4:删除行(沿用管理员撤销),`expires_at` 可空 |
| §3 / §4.3 | 没有修改昵称的接口 | F S6:`PATCH /api/me {nickname}`(`current_user`,每用户每小时 10 次) |
| §4.1 | 冷却 / 日上限的响应码未定 | X10:429 / 503 / 422,不泄露注册状态 |
| §4.3 | `POST /api/users` 无条件必填会破坏 79 处测试与桌面端 | X11:`EMAIL_REGISTRATION_REQUIRED` 开关(默认开) |
| §4.4 | 「管理员不受影响」:`users` 没有管理员标记 | X13:管理后台本来不经过 `current_user` |
| §4.4 | 截止时间的类型 | X12:带时区的 ISO 字符串 |
| §5 | `avatar_url` 绝对 / 相对未定;桌面端 | X17:相对路径,桌面端回落首字 |
| §5 | Pillow 不在依赖里 | X16:新增依赖 |
| §6.1 | 现有管理员码 12 位、字符表含 `U` | X18:新码 10 位,旧码照用 |
| §6.2 | `open` 模式下邀请码是否记归属 | X20:忽略(现状) |
| 建议(不在本期) | 换绑邮箱时通知旧邮箱;用户码哈希改为带 pepper 的 HMAC(49 bit 码 + 无盐 SHA-256 在库泄露时可离线穷举) | 列为后续,本期不做 |

## 6. 共享文件与追加锚点(后合并的在前一个基础上追加,不重排)

| 文件 | 顺序 | 说明 |
|---|---|---|
| `server/app/models.py` | F-P1(`User` 两列在 `disabled_at` 之后;`AccessToken` 两列在 `created_at` 之后;`UserIdentity` 与 `display_name()` 追加文件末尾,标题注释 `# ---- 账号 v2 ----`)→ F-P2(`VerificationCode`、`EmailDailyCount` 末尾)→ V(`User.avatar_id` 在 `email_verified_at` 之后;`AvatarReport` 末尾)→ I(`InviteCode` 三列在 `revoked_at` 之后;`InviteRedemption` 末尾) | |
| `server/alembic/versions/` | 见 §3 | 线性 |
| `server/app/main.py` | F(`account` 紧跟 `sessions`;`app.state.mailer`)→ V(`avatars` 在 `account` 之后,`admin_avatars` 在 `admin_changelog` 之后)→ I(`invites_me` 在 `avatars` 之后) | 全部在 `stubs` 之前 |
| `server/app/core/config.py`、`settings_registry.py`、`server/.env.example` | F(新组 `("accounts", "账号与邮箱")` 插在 `registration` 之后)→ V(本组末尾追加 `avatar_upload_enabled`)→ I(`registration` 组末尾追加邀请码三项) | 每个变量中文注释;secret 用 `_s(..., "secret")` 或 `_env(..., "secret")` |
| `server/tests/test_settings_registry.py` | F(`EXPECTED_ENV_ONLY` + `identity_pepper`;`EXPECTED_SECRETS` + `identity_pepper`、`smtp_password`) | V、I 不加 secret |
| `server/tests/conftest.py` | F 只改 `make_settings`(`email_registration_required=False`) | 其余计划不改 |
| `server/tests/background.py` | F(`mailer.pending`) | |
| `server/app/core/quotas.py` | 只有 I(`invites_user_code_max_uses`) | |
| `server/app/core/metering.py` | 只有 F(X14) | |
| `server/app/admin/users_admin.py`(`USER_ROWS` / `USER_REFS_NULLED` / `delete_user`) | F(`UserIdentity`、`VerificationCode` + 按目标删码)→ V(`AvatarReport` 两列 + 删头像文件)→ I(`InviteRedemption.user_id` 置空、用户码撤销并清 `code_enc`) | `tests/test_admin_users.py` 会抓漏 |
| `server/app/admin/doctor.py` | F(`email_not_configured`、`email_console_backend`、`binding_without_deadline`)→ I(`legacy_invite_code`) | |
| `server/app/core/deps.py` | 只有 F | |
| `web/src/api/client.ts`、`api/types.ts` | F → V → I | 方法追加在 `me()` 之后 |
| `web/src/features/account/index.ts`、`lazy.tsx` | F 创建 → V → I 追加导出 | |
| `web/src/pages/me-page.tsx` | F(账号区块插槽)→ V(头像)→ I(我的邀请码) | 每个计划只加一行接线 |
| `web/src/app.tsx` | F(`/register`、`/forgot-password`、`/account/email` 路由;横幅) | |
| `web/src/components/avatar.tsx` | 只有 V(`src`) | |
| `web/src/features/rooms/protocol.ts`、`room-settings-sheet.tsx`、`room-message-list.tsx` | 只有 V | `room-page.tsx` **不改**(冻结) |
| `admin/src/features/users/*`、`admin/src/pages/users-page.tsx`、`user-detail-page.tsx` | F → V → I | |
| 各层 `CLAUDE.md` | 各自追加;`server/app/CLAUDE.md` 的迁移头每个迁移任务同步更新 | |

## 7. 验证矩阵(全局验收时跑;按用户偏好,只有用户要求时才跑全量)

| 项 | 命令 / 方式 | 预期 |
|---|---|---|
| 服务端全量 | `cd server && uv run pytest -q`(分文件跑,约 2.5 分钟以上) | 全绿 |
| 迁移 | `uv run alembic upgrade head`、`downgrade -4`、`upgrade head`(SQLite);`tests/test_migrations.py` | 绿;**Postgres 未验证** |
| 架构 | `tests/test_architecture.py`、`web/src/architecture.test.ts` | 绿,均未放宽 |
| 隐私 | 每个新端点与后台任务的 `caplog` 断言(只收 `app` 日志器,见 changelog 计划的教训:aiosqlite 的 DEBUG 会打印 SQL 参数)+ Z 车道的全文扫描 | 日志、错误体、审计、夹具里没有邮箱、验证码、邀请码、token、SMTP 授权码、昵称 |
| 网页 | `yarn web:typecheck && yarn web:test && yarn web:build` + `check-main-bundle.mjs` | 绿;预算见 X25 |
| 管理端 | `yarn admin:typecheck && yarn admin:test` | 绿 |
| 契约 | `accounts_contract.json`、`invites_contract.json`、重录后的 `rooms_*_contract.json` 与网页对应测试 | 绿 |
| 真实发信 | 手动:管理后台 SMTP 体检 + 自己的两个邮箱(QQ / 非 QQ)各收一次注册码、一次重置码 | **未验证**,由用户在部署后做 |

## 8. 未验证清单(如实标注,不得在文档里写成已验证)

- 真实 QQ 邮箱 SMTP:连接、授权码认证、实际日发送上限与限速、被临时封禁的条件、到达率、是否进垃圾箱(QQ 收件箱、网易、Gmail、Outlook 各自不同)。
- SPF / DKIM / DMARC 对到达率的影响(发件域不受我们控制)。
- PostgreSQL 上的 `0021`–`0024`(含部分唯一索引 `postgresql_where`)。
- 经反向代理时的 `client_ip`(按 IP 的发码与邀请码错误计数依赖 `TRUST_PROXY_HEADERS` 正确配置)。
- 多进程部署:所有按 IP / 按用户的进程内限流(`RateLimiter`)只在单 worker 下准确(现有限制,`core/ratelimit.py` 文档已写)。全局日上限与单目标限额在数据库里,多进程也准确。
- iOS Safari / Android Chrome:选择照片(含 HEIC)后的客户端缩放与上传、头像在真机上的渲染与缓存、`navigator.share`、剪贴板、键盘遮挡验证码输入框、`autocomplete="one-time-code"`。
- 360–375 px 下英文标签(只在 Playwright / 浏览器窗格模拟过的,也标「模拟」)。
- 桌面端 `enjoy/` 在 P2 之后的真实表现(注册失败提示、强制绑定后的 403 提示)——不改 `enjoy/`,也没有运行它。
- 头像的内容安全:没有自动审核,只有举报 + 人工移除 + 总开关。

## 9. 风险

1. **QQ SMTP 只适合小规模内测**(spec §4.2):限额与封禁不在我们控制下;一旦被封,注册与找回密码全部失效。缓解:`EMAIL_DAILY_GLOBAL` 设得明显低于服务商限额(限额以服务商说明 / 实测为准,文档不写数字);`EMAIL_REGISTRATION_REQUIRED` 可临时关闭;接口已与 QQ 解耦,公开前换事务邮件服务。
2. **`IDENTITY_PEPPER` 丢失或更换 = 所有邮箱登录与唯一性失效**(HMAC 对不上),且无法从密文恢复(密文用的是另一把钥匙,但查找靠 HMAC)。缓解:只读环境变量、不进管理后台、`.env.example` 与 `server/README.md` 写备份说明;与 `SETTINGS_ENCRYPTION_KEY` 分开备份。
3. **P2 上线时若未配好 SMTP**,`EMAIL_REGISTRATION_REQUIRED` 默认开会让注册返回 503。缓解:发布步骤要求先配置并体检(§10)。
4. **桌面端被「破坏」**(spec §8,用户已接受):旧注册流程失败;强制绑定生效后桌面端登录后的每个请求得到 `email_binding_required`,没有绑定界面。缓解:错误文案提示「请在网页注册 / 绑定」;公告。
5. **用户永久码被发到公开群**:等于开放注册直到用完上限。缓解:累计上限默认 10、按人调整 / 收回、轮换、按 IP 的错误计数、管理端能看到每个码的兑换者与被停用数。
6. **token 30 天过期**:长期不用的用户会被要求重新登录(活跃用户滑动续期不受影响)。迁移把现有 token 设为「迁移时刻 + 30 天」,部署时不会全员掉线。
7. **枚举防护有边界**:发码接口做到了「是否注册」不可区分;但 `change_email` 需要当前密码、注册时邀请码「已用完」与「无效」可区分(spec 要求提示「已用完」)。
8. **头像是陌生人可见的 UGC**:见 §8 最后一条;`AVATAR_UPLOAD_ENABLED` 可随时关闭(关闭时不能上传,`GET /api/avatars/{id}` 返回 404,载荷里的 `avatar_url` 保留、网页加载失败即回落首字头像;已有文件保留,重新打开即恢复;V 计划 R-V3)。
9. **Pillow 的安全更新**:新依赖带来新的 CVE 面;缓解:限制格式 / 尺寸 / 像素、重新编码、`uv lock --upgrade-package pillow` 列入运维习惯。
10. **合并期撞号**:见 §3。

## 10. 发布与回退(只有用户要求时才重建 / 重启容器)

**F-P1(无可见破坏):**
1. 备份 PostgreSQL(`pg_dump`);核对 `alembic heads`。
2. 在 `.env` 里加入 `IDENTITY_PEPPER`(新生成,单独备份;P1 还用不到它,但提前放好避免 P2 时遗漏)。
3. 用户要求时:`docker compose up -d --build`(容器启动时执行 `alembic upgrade head`)。
4. 观察:旧 token 仍可用;`GET /api/me` 多出 `nickname`、`display_name`;房间里显示昵称(未设置者仍是用户名)。
5. 回退:`alembic downgrade -1` 只删新列 / 新表;旧代码不认识的列不影响。

**F-P2(先不强制):**
1. 备份;确认 `SETTINGS_ENCRYPTION_KEY` 已设置。
2. 配置 `EMAIL_BACKEND=smtp`、`SMTP_*`(授权码当密钥处理)、`EMAIL_DAILY_GLOBAL`、`EMAIL_DOMAIN_MODE`;**`EMAIL_BINDING_REQUIRED=false`**。
3. 部署后在管理后台:配置诊断无 `email_not_configured`;SMTP 体检通过;用自己的两个邮箱走一遍注册与找回密码。
4. 发公告(公告横幅 + 更新日志草稿,见记忆里的「更新日志」约定)说明:要绑定邮箱、截止时间、桌面端需先在网页完成。
5. 公告 7 天后(spec §9 第 3 项推荐值):设置 `EMAIL_BINDING_DEADLINE`(带时区)再 `EMAIL_BINDING_REQUIRED=true`(都可热改);截止前网页显示横幅,截止后强制。
6. 回退:`EMAIL_BINDING_REQUIRED=false`(热改)即可解除强制;`EMAIL_REGISTRATION_REQUIRED=false` 恢复旧注册;迁移 `0022` 可 `downgrade`(会丢未用的验证码,无影响)。

**V、I:** 各自备份 → 部署 → V 用 `AVATAR_UPLOAD_ENABLED` 控制;I 先只给管理员批量码,确认无误后再在网页露出「我的邀请码」(该面板随 I 一起上线;要延后可把 `INVITES_USER_CODE_MAX_USES` 临时设为 0,所有人看到「暂不可生成」)。

### 10.1 通知老用户的清单(尤其是「忘了密码又没绑邮箱」的人)

- [ ] F-P2 部署后、强制前:管理后台用户列表用「未绑定邮箱」筛选(F A1 新增)导出人数(只看数量与用户名,不导出其他信息)。
- [ ] 公告横幅 + 更新日志:绑定截止时间、绑定入口、「桌面端请先在网页登录并绑定」。
- [ ] 对仍记得密码的用户:网页登录后顶部横幅引导绑定。
- [ ] 对忘了密码且没绑邮箱的用户:公告里写明「请联系管理员」;管理员在管理后台「重置密码」(已有功能,临时密码只显示一次),用户登录后立即绑定邮箱并改密。
- [ ] 截止前 1 天再发一次公告;截止后观察 `email_binding_required` 的 403 数量(访问日志只看状态码,不看内容)。
- [ ] 截止后仍有人无法登录:管理员可临时关闭 `EMAIL_BINDING_REQUIRED`(热改)而不影响已绑定的用户。

## 11. 执行状态

- 2026-10-14:三份计划与本索引写成;未提交、未执行。
- 2026-10-21:**F(地基 + 邮箱,P1 + P2)已合并到 `feat/self-hosted-backend`**(提交 `16c81d5d` 服务端、`e407cb25` 网页与管理端;迁移头 `0024`)。合并后实测:服务端定向 517 通过;网页类型检查通过、191 通过、主包 411.15 kB gzip(基线 410.03,增量 +1.12 kB,预算 1.5);管理端类型检查通过、287 通过。合并前评审:Opus 安全评审 1 个阻断(重置码发往输入地址而非保存地址,已修)+ 连接池耗尽(已修)+ 若干已知限制(写在 `server/README.md` 与 F 计划「执行结果」);Sonnet 复评无阻断,两个后续项已修。浏览器窗格(模拟)检查:注册两步、找回密码、登录在 360 与 375 px 英文下无溢出、无被截断的按钮。**仍未验证**:真实 QQ SMTP 投递与到达率、Postgres、真实多连接并发、桌面端实际表现、真机键盘与一次性验证码自动填充。**未开始:V(头像,迁移 `0025`)、I(邀请码 v2,迁移 `0026`)**,二者依赖 F 的接口,现已解除阻塞。
- 2026-10-19:用户批准开始执行(实现者用 Haiku 5.5,多车道并行);§5 的修正建议按计划执行;文档已提交。真实迁移 head 为 `0022`,编号顺延见 §3。执行顺序仍是 F-P1 → F-P2 → V → I;每一步合并前由更强的模型做评审(见各计划「评审波」)。
