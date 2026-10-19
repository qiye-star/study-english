# 账号体系 v2 · 地基 + 邮箱(P1 + P2)Implementation Plan

> **执行前先读 `docs/superpowers/plans/2026-10-14-accounts-INDEX.md`:合并顺序、迁移链与跨计划裁决以它为准。与 INDEX 冲突以 INDEX 为准。**

> **For agentic workers:** 一个任务一个逻辑提交;先写失败测试,看它失败,再实现;每个任务只跑本任务列出的定向测试(全量只在 Z2、且只在用户要求时)。步骤用 `- [ ]` 勾选,合并且测试通过后才勾。

- 日期:2026-10-14 · 状态:未开始
- Spec:`docs/superpowers/specs/2026-10-14-accounts-email-invites-design.md` §3(P1)、§4(P2)、§7、§8
- INDEX:`docs/superpowers/plans/2026-10-14-accounts-INDEX.md`
- 迁移:`0021_accounts_foundation`(S1)、`0022_accounts_email`(S10);Task 0 先核对 head

**Goal:** P1:昵称(注册时可填、可改,房间里显示昵称)、`user_identities` 表、token 30 天过期 + 滑动续期、登出与改密端点、`current_user` / `current_user_unbound` 分级。P2:6 位邮箱验证码(HMAC 存储、冷却、单目标 / 单 IP / 全局上限、防枚举)、可替换的发信后端(SMTP / console / 测试假后端)、邮箱注册、用户名或邮箱登录、找回密码、绑定 / 换绑邮箱、强制绑定(开关 + 截止时间,先横幅后强制)、邮箱域名策略、管理端(脱敏邮箱、清除邮箱、未绑定筛选、诊断、SMTP 体检)、网页页面与中英文案。

**Architecture:** 不新增分层包(INDEX X1)。`core/deps.py` 拆 `_authenticate` / `current_user` / `current_user_unbound`(X3);`providers/email.py` 是发信后端;`services/` 下新增 `nicknames`、`identities`、`email_domains`、`verification`、`mailer`;HTTP 在 `routers/sessions.py`(注册 / 登录 / 登出 / me)与新的 `routers/account.py`(发码、找回密码、改密、昵称、绑定邮箱);管理端逻辑在 `admin/user_email_admin.py`。网页新 feature `features/account/`(懒加载页面),登录页留在 `pages/`。

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + pytest-asyncio(Python 3.12,uv);标准库 `smtplib`、`ssl`、`hmac`、`secrets`、`email.message`、`unicodedata`。React 18 + react-router + vitest + Testing Library;管理端 React + vitest。**不新增依赖。**

## Global Constraints

- **隐私硬规则(spec §7)**:邮箱、验证码、SMTP 授权码、token、昵称不进日志、错误体、审计、URL、测试快照与夹具。每个新端点与后台任务都有 `caplog` 断言:把 `caplog` 设到 `logging.DEBUG`、**只收 `app` 日志器**(`caplog.set_level(logging.DEBUG, logger="app")`),断言测试用的邮箱、验证码、密码都不在 `caplog.text` 里。错误文案是固定英文字符串,不拼接输入。
- **设置**:每个新 `Settings` 字段都有 `SettingSpec`(`tests/test_settings_registry.py` 强制)与 `server/.env.example` 中文注释;secret 字段 `secret=True`(授权码、pepper);热改的字段每次请求读 `request.app.state.settings`,不缓存。
- **迁移**:SQLite `batch_alter_table` + Postgres 安全路径 + 往返测试 + `test_models_match_migrations`;同提交更新 head 钉子与 `server/app/CLAUDE.md` 的迁移头。
- **路由**:新路由在 `create_app` 的模块列表里紧跟 `sessions`,在 `stubs` 之前(X2);每个 `/api/admin/*` 声明角色(`tests/test_admin_routes_guarded.py`)。
- **分层**:`tests/test_architecture.py`、`web/src/architecture.test.ts` 不放宽、冻结边数不变。
- **网页**:文案在 `features/account/i18n/` 与 `pages/i18n/`,中英齐全,英文标签 360–375 px 不溢出;页面懒加载;主包预算 ≤ 1.5 kB gzip(X25)。
- **不改 `enjoy/`。** 桌面端的兼容代价见 INDEX §9 第 4 条。
- **提交**:conventional(`feat(server): …`、`feat(web): …`、`feat(admin): …`、`test(…)`、`docs: …`),信息以 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 结尾。

## 文件结构

```
server/
  alembic/versions/0021_accounts_foundation.py      新(S1)
  alembic/versions/0022_accounts_email.py           新(S10)
  app/models.py                                     User +nickname +email_verified_at;AccessToken +expires_at +last_used_at;
                                                    UserIdentity;display_name();VerificationCode;EmailDailyCount
  app/core/config.py、settings_registry.py          P1 两项、P2 十五项(S2、S11)
  app/core/deps.py                                  _authenticate / current_user / current_user_unbound;滑动续期;强制绑定(S3、S4、S21)
  app/core/metering.py                              KINDS + "email";FEATURE_PREFIXES(S15)
  app/providers/email.py                            新:EmailSender、SmtpSender、ConsoleSender、FakeSender、check()(S12)
  app/services/nicknames.py                         新(S6)
  app/services/identities.py                        新(S13)
  app/services/email_domains.py                     新(S13)
  app/services/verification.py                      新(S14)
  app/services/mailer.py                            新:Mailer、模板(S15)
  app/routers/sessions.py                           注册 / 登录 / 登出 / me(S4、S6、S17、S18、S21)
  app/routers/account.py                            新:/api/me/password、PATCH /api/me、/api/email/code、/api/password/reset、
                                                    /api/me/email/code、/api/me/email(S5、S6、S16、S19、S20)
  app/rooms/store.py、summary_store.py              显示名(S7)
  app/routers/rooms.py、rooms_voice.py、admin_rooms.py   显示名(S7)
  app/admin/service.py、rooms_admin.py              追加 nickname、按昵称搜索、未绑定筛选(S8、A1)
  app/admin/user_email_admin.py                     新:清除邮箱(A1)
  app/admin/users_admin.py                          USER_ROWS + 删除用户时按目标删码(S1、S22)
  app/admin/housekeeping.py                         purge_expired + 过期 token / 旧验证码(S9)
  app/admin/doctor.py、probes.py                    三条诊断、smtp 体检(A1、A2)
  app/routers/admin_users.py                        POST /users/{id}/email/clear(A1)
  app/main.py                                       account 路由、app.state.mailer(S15、S16)
  .env.example、README.md                           中文注释;IDENTITY_PEPPER 备份说明(S2、S11、Z2)
  tests/conftest.py                                 make_settings + email_registration_required=False(S11)
  tests/background.py                               + mailer.pending(S15)
  tests/test_settings_registry.py                   EXPECTED_ENV_ONLY / EXPECTED_SECRETS(S2、S11)
  tests/accounts_helpers.py                         新:enable_email(app)、fake_sender(app)、register_with_email(...)(S16)
  tests/test_accounts_*.py                          新(见各任务)
  tests/fixtures/accounts_contract.json             新(S23)
web/src/
  api/client.ts、api/types.ts、api/error-messages.ts      W1、W3
  auth/auth-context.tsx、auth/require-auth.tsx、auth/validation.ts   W2、W4、W6
  pages/login-page.tsx、pages/i18n/*                W4
  pages/me-page.tsx                                 W2、W7(各一行接线)
  features/account/                                 新:index.ts、lazy.tsx、register-page.tsx、forgot-password-page.tsx、
                                                    bind-email-page.tsx、binding-banner.tsx、account-section.tsx、
                                                    email-code-field.tsx、account-api.ts、i18n/{en,zh-CN}.json、CLAUDE.md、
                                                    accounts-contract.test.ts(W2–W7)
  app.tsx                                           三条路由、横幅(W4–W6)
admin/src/
  features/users/api.ts、strings.ts、user-email-card.tsx(新)、clear-email-dialog.tsx(新)   A3
  pages/users-page.tsx、user-detail-page.tsx        A3
  features/settings/probe-button.tsx                A2
```

## 并行车道与合并顺序

| 车道 | 任务 | 依赖 |
|---|---|---|
| **S**(串行) | Task 0 → S1 … S9(= F-P1)→ S10 … S23(= F-P2) | S10 要等 F-P1 全部合并 |
| **W** | W1–W2(P1)→ W3–W7(P2) | W1 可与 S1 并行;W2 在 S5、S6 后合并;W3 起在 S16 后;W7 的契约测试在 S23 后 |
| **A** | A1 → A2 → A3 | A1 在 S21 后;A3 在 A1、A2 后 |
| **Z** | Z1、Z2 | 全部之后 |

**评审波**:F-P1 合并前、F-P2 合并前各一次 `/code-review high` + `security-review`(重点:枚举、计时、日志卫生、token 生命周期、事务回滚、强制绑定的豁免面);W 车道合并前在浏览器窗格 375×812 浅色 + 深色走注册、登录(用户名 / 邮箱)、找回密码、绑定、横幅、强制跳转。

## 本计划的裁定(Ruling)

> 跨计划裁决见 INDEX §4(X1–X29);下面只列本计划内部的细节裁定。

- **R-F1 邮箱规范化与唯一性键**:`normalize_email(raw)` = 去首尾空白、转小写;只接受 ASCII,`local@domain`,总长 ≤ 254、local ≤ 64,domain 含点、只含 `[a-z0-9.-]`;拒绝 CR/LF 与空白(防头注入)。`identity_key(email)` = 规范化后去掉 local 部分第一个 `+` 及其后内容(不处理 Gmail 点号,spec §3)。`subject_hmac = HMAC-SHA256(pepper, "email:" + identity_key)`;`subject_enc = secretbox.encrypt(规范化后的原值,保留 +标签)`——发信发到用户输入的地址。登录时 `username` 含 `@` 就按 `identity_key` 查找。
- **R-F2 验证码存储**:`code_hmac = HMAC-SHA256(pepper, f"{purpose}:{target_hmac}:{code}")`,把码绑定到目标与用途,一个码不能拿去别的用途或别的邮箱用;校验 `hmac.compare_digest`。常量(spec 固定值,不做设置):有效期 10 分钟、最多 5 次试错、同目标重发冷却 60 秒。新码生成时把同一 `(target_hmac, purpose)` 未消费的旧码置 `consumed_at = now`(作废)。
- **R-F3 试错次数在独立事务里提交**:验证失败时先 `UPDATE verification_codes SET attempts = attempts + 1` 并提交,再返回 `400 {"error":"Invalid or expired code"}`;验证成功只在调用方的事务里置 `consumed_at`,调用方后续失败回滚时码可以再用(spec §4.3「验证码次数计入 attempts 的除外」)。错误文案对「没有码 / 过期 / 次数用完 / 不匹配」完全一样。
- **R-F4 全局日上限用数据库计数**:表 `email_daily_counts(day DATE PK, sent INT)`;发送前原子「认领」:`INSERT … ON CONFLICT DO NOTHING` 后 `UPDATE … SET sent = sent + 1 WHERE day = :d AND sent < :cap`,`rowcount == 0` 即达上限。通知邮件(「已注册」)同样占额度。多进程准确。
- **R-F5 单目标日上限**:数 `verification_codes` 里同 `target_hmac`、`created_at > now - 24h` 的行(包括从不发送的隐藏行,X10);冷却看同 `(target_hmac, purpose)` 最近一行的 `created_at`。单 IP 每小时上限用进程内 `RateLimiter(limit, window=3600)`,`app.state.email_ip_limiter`,热改走 hub 监听。
- **R-F6 通知邮件**:`register` 用途遇到已注册邮箱 → 写隐藏行 + 发「该邮箱已注册,可直接登录或找回密码」;`bind` / `change_email` 遇到已被别人占用的邮箱 → 写隐藏行 + 发「有人尝试把此邮箱绑定到另一个账号;如果不是你,可以忽略」;`reset` 遇到未注册邮箱 → 写隐藏行、不发信。隐藏行的码是随机生成、从不发送的,所以对应的注册 / 绑定必然得到同一个「无效验证码」错误。
- **R-F7 发码与注册的事务顺序**:`POST /api/users`(开关开)= 限流 → 校验字段 → 域名策略 → 哈希密码(线程)→ 查验证码(失败按 R-F3)→ 邀请码扣次数(现有 `invites.consume`)→ 新用户 + `user_identities` + `users.email_verified_at` + 码 `consumed_at` → 一次提交。用户名冲突 409、邮箱已被占用(竞态)→ 回滚并返回与「无效验证码」**相同**的 400(唯一约束兜底,不泄露)。
- **R-F8 滑动续期**:`_authenticate` 查 `(User, AccessToken)`;`last_used_at` 为空或早于 1 小时前时执行一次 `UPDATE access_tokens SET last_used_at = now, expires_at = now + TTL WHERE id = :id` 并提交(会话 `expire_on_commit=False`,已核对 `main.py`,提交后 `user` 对象仍可读)。新签发的 token 写 `expires_at = now + TTL`、`last_used_at = now`。SQLite 读回的时间是 naive,比较前补 UTC(仿 `services/invites._utc`)。
- **R-F9 改密 / 重置密码 / 换绑**:改密 = 校验当前密码(线程)→ 新密码哈希 → 删除该用户全部 `access_tokens` 与未兑现 `speech_tokens`(复用 `users_admin._drop_tokens` 的语义,但放在 `services` 层的新函数 `services/identities.revoke_sessions`,避免 routers 依赖 admin 内部函数)→ 签发新 token 返回 → `routers.admin_users.cut_connections(app, user_id)` 断开实时与房间(routers 可导入 routers)。重置密码同样撤销与断开,**不签发 token**。换绑邮箱不撤销 token。
- **R-F10 强制绑定的判定**:`binding_state(settings, now)` → `"none"`(开关关)/ `"pending"`(开关开且截止时间在未来)/ `"enforced"`(开关开且截止为空或已过)。`current_user` 在 `"enforced"` 且 `user.email_verified_at is None` 时 `raise HTTPException(403, "email_binding_required")`(错误体 `{"error":"email_binding_required"}`,沿用 `core/errors.py`)。
- **R-F11 默认房间名**用显示名(`f"{display}的房间"`),截到 `NAME_MAX`;昵称中的字符已受 INDEX X8 约束。
- **R-F12 昵称修改频率**:`PATCH /api/me` 每用户每小时 10 次(进程内 `RateLimiter`,超限 429 与现有文案一致)。
- **R-F13 网页注册流程是单页两步**:第一步填邮箱 → 「发送验证码」(60 秒倒计时,文案按 X10 的错误码区分「请稍后再试」与「邮箱域名不支持」);第二步填验证码、用户名、昵称、密码、邀请码(邀请模式时)。验证码输入框 `inputmode="numeric"`、`autocomplete="one-time-code"`、`maxlength=6`。

---

## Task 0:核对事实(只读,结果写回本节)

**目标:** 把 spec 里「未核对」的事项对照真实代码确认,结果记在下表的「结果」列(执行者更新);与预期不符时**停下报告**,不要自行改计划。

- [ ] **Step 1** 逐项核对(命令都是只读的):

| # | 事项 | 方法 | 写计划时的结果(执行者再确认) | 不符时 |
|---|---|---|---|---|
| 1 | 迁移头 | `cd server && uv run alembic heads`;`ls server/alembic/versions` | `0020 (head)`(`0020_changelog.py`);**不是** spec / `app/CLAUDE.md` 写的 `0019` | 若已是 `0021`(例如 alignment-v2 先合并),本计划 `0021/0022` 顺延,并改 INDEX §3 |
| 2 | head 钉子 | `Grep "get_heads\(\) == \[" server/tests` | 7 处:`test_migrations.py` 5、`test_library_models.py` 1、`test_changelog_models.py` 1 | 照实全部改 |
| 3 | 桌面端发给 `/api/users` 的字段 | 读 `enjoy/src/shared/api/client.ts::register`、`renderer/components/login/password-login-form.tsx` | `{username, password, invite_code?}`(axios + `decamelizeKeys`);没有邮箱、昵称 | — |
| 4 | 桌面端发给 `/api/sessions` 的字段 | `client.ts::auth`;`login-form.tsx` 只渲染 `PasswordLoginForm` | `{provider: "password", username, password}`;客户端里还有 `provider: "email"` + `code` 的 `EmailLoginForm` 与 `POST /api/sessions/login_code`、`PUT /api/users/{id}`,但登录页不渲染它们(今天它们落到 `stubs`) | — |
| 5 | 桌面端读 `UserType` 的字段 | `enjoy/src/shared/types/user.d.ts` | `id, name?, email?, avatarUrl?, accessToken?, …`;`name` 显示在侧栏并写进聊天提示词(X7) | — |
| 6 | 登出 / 撤销 token 端点 | `Grep "logout\|DELETE.*sessions" server/app/routers` | 用户侧**没有**;网页 `auth-context.logout` 只清本地;管理员有 `POST /api/admin/users/{id}/revoke-tokens`(删除行)。`DELETE /api/sessions` 今天会落进 `stubs` 的「收下即丢」 | — |
| 7 | 改密端点 | `Grep "password" server/app/routers/sessions.py` | 用户侧**没有**;只有管理员重置 | — |
| 8 | `User.username` 作为显示名的位置 | `Grep "\.username\|User\.username" server/app` | 见 INDEX X6:改 10 处直接 + 6 处间接;管理端约 35 处保持 | 多出的按 X6 归类后加进 S7 / S8 |
| 9 | 房间保留名 | `rooms/agent_config.RESERVED_NAMES`、`rooms/store.AI_NAME` | `{"ai", "助手"}`、`"AI 助手"` | 照实改 `services/nicknames.RESERVED` |
| 10 | 管理端邀请码 UI 与后端 | 读 `admin/src/features/users/{invites-page,create-invite-dialog}.tsx`、`app/routers/admin_users.py`、`app/admin/invites.py`、`app/services/invites.py` | 页面 `/invites`(operator);后端 `GET/POST /api/admin/invites`、`DELETE /api/admin/invites/{id}`;明文只在创建响应里出现一次(`no-store`);`consume` 是一条条件 UPDATE,不提交 | 本计划不改邀请码(在 I 计划) |
| 11 | 设置约定 | 读 `core/settings_registry.py`、`tests/test_settings_registry.py` | `_s` / `_env`;`EXPECTED_ENV_ONLY`、`EXPECTED_SECRETS` 在测试里写死;`date` kind 不接受空串(X12) | — |
| 12 | 配额约定 | `core/quotas.py` | `QUOTA_KEYS` 键 → 字段名;`effective(session, app, uid, key)` | 本计划不加配额键 |
| 13 | secretbox | `core/secretbox.py` | `box_for(settings)` 在 `SETTINGS_ENCRYPTION_KEY` 为空时返回 `None`(X9) | — |
| 14 | metering 调用约定 | `core/metering.py` | `record(kind, provider, model, status, ms, *, units_in, units_out, unit)`,永不抛;`KINDS` 是元组,没有运行期校验但用量页按 kind 汇总(X14) | 若有测试钉住 `KINDS`,同提交更新 |
| 15 | 分层规则 | `tests/test_architecture.py` 的 `ALLOWED` | providers → core;services → core、models、providers;routers 可导入 routers;没有新包(X1) | 若必须新包:停下报告 |
| 16 | 注册测试的数量 | `Grep "/api/users\"" server/tests -c` | 79 处 / 65 个文件(X11 的依据) | — |
| 17 | 会话 `expire_on_commit` | `app/main.py` | `async_sessionmaker(engine, expire_on_commit=False)`(R-F8 的依据) | 若为 True:滑动续期改为用独立会话写 |
| 18 | 后台任务等待 | `tests/background.py::_task_sets` | 没有邮件相关集合(S15 追加) | — |
| 19 | `test_me_returns_profile_without_access_token` | `tests/test_auth.py` | 只断言 `name`、`id`、无 `access_token`;加字段不破坏 | — |
| 20 | 维护模式白名单 | `core/maintenance.py` | `read_only` 只放行 `POST /api/sessions`;新的发码 / 重置 / 绑定在只读维护时 503 | 接受(写进 Z2 文档) |

- [ ] **Step 2** 把「结果」列更新后提交:`docs: accounts foundation plan task 0 findings`。

---

# F-P1 · 地基

### Task S1:迁移 0021 + 模型 + head 钉子

**目标:** `users.nickname`、`users.email_verified_at`、`user_identities`、`access_tokens.expires_at` / `last_used_at`;现有 token 回填 `expires_at`。

**Files:** Create `server/alembic/versions/0021_accounts_foundation.py`、`server/tests/test_accounts_models.py`;Modify `server/app/models.py`、`server/app/admin/users_admin.py`(`USER_ROWS` 加 `(UserIdentity, "user_id")`)、`server/tests/test_migrations.py`、`server/tests/test_library_models.py`、`server/tests/test_changelog_models.py`、`server/app/CLAUDE.md`(迁移头)。

- [ ] **先写失败测试** `tests/test_accounts_models.py`:
  - `test_head_is_0021_and_chain_is_linear`:`get_heads() == ["0021"]`,`get_revision("0021").down_revision == "0020"`。
  - `test_0021_round_trips_and_backfills_token_expiry`:`upgrade 0020` → 插一个用户与一条 token(`created_at` 任意)→ `upgrade 0021` → 该 token 的 `expires_at` 非空且约等于「现在 + 30 天」(±1 天)、`last_used_at` 为空 → `downgrade 0020` → 列与表都不在、旧数据仍在 → 再 `upgrade 0021`。
  - `test_user_identities_unique_per_provider_subject_and_per_user`:同 `(provider, subject_hmac)` 第二行 `IntegrityError`;同 `(user_id, provider)` 第二行 `IntegrityError`。
  - `test_deleting_user_cascades_identities`(经 `users_admin.delete_user`,沿用 `test_admin_users.py` 的辅助)。
- [ ] **实现**:
  - `User`:`nickname: Mapped[str | None] = mapped_column(String(32), nullable=True)`(长度校验 20 在服务层,列留余量);`email_verified_at: Mapped[datetime | None]`(`DateTime(timezone=True)`)。
  - `AccessToken`:`expires_at`、`last_used_at`(均可空,X4)。
  - `UserIdentity`(`user_identities`):`id` 自增、`user_id` FK `users.id` `ondelete="CASCADE"` + index、`provider String(16)`、`subject_hmac String(64)`、`subject_enc Text`、`verified_at DateTime(tz)`、`created_at`;`UniqueConstraint("provider", "subject_hmac", name="uq_user_identities_provider_subject")`、`UniqueConstraint("user_id", "provider", name="uq_user_identities_user_provider")`。
  - `display_name()`:`def display_name(): return func.coalesce(User.nickname, User.username)`(模块级函数,文档注释说明 X6)。
  - 迁移:`users` 用 `batch_alter_table` 加两列;`access_tokens` 加两列后 `UPDATE access_tokens SET expires_at = :t WHERE expires_at IS NULL`(`:t` = 迁移时刻 UTC + 30 天;注释说明为什么是常量 30 而不读设置);建 `user_identities`。降级:drop 表、batch drop 列。Postgres 上 `ADD COLUMN` 可空不重写表。
  - head 钉子 7 处改 `["0021"]`;`server/app/CLAUDE.md` 的「head `0019`」改为 `0021`。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_accounts_models.py tests/test_migrations.py tests/test_library_models.py tests/test_changelog_models.py tests/test_admin_users.py tests/test_architecture.py`
- [ ] **提交**:`feat(server): accounts foundation tables and migration 0021`

### Task S2:P1 设置(token 有效期、IDENTITY_PEPPER)

**Files:** Modify `server/app/core/config.py`、`server/app/core/settings_registry.py`、`server/.env.example`、`server/tests/test_settings_registry.py`;Create `server/tests/test_accounts_settings.py`。

- [ ] **先写失败测试** `test_accounts_settings.py`:
  - `test_access_token_ttl_defaults_to_30_and_is_bounded`:默认 30;`SPECS["access_token_ttl_days"]` 是 `int`、`apply="hot"`、`min=1`、`max=365`、组 `accounts`。
  - `test_identity_pepper_is_env_only_secret`:`SPECS["identity_pepper"].env_only and .secret`;`Settings(identity_pepper="short")` 校验失败(至少 32 个字符),空串允许。
  - `test_accounts_group_follows_registration`:`GROUPS` 里 `accounts` 紧跟 `registration`。
  - 更新 `EXPECTED_ENV_ONLY` / `EXPECTED_SECRETS`(加 `identity_pepper`)后 `test_settings_registry.py` 全绿。
- [ ] **实现**:`access_token_ttl_days: int = Field(30, ge=1, le=365)`;`identity_pepper: str = ""` + 校验器(非空时 ≥ 32 字符,错误信息不含值);`GROUPS` 插入 `("accounts", "账号与邮箱")`;`_env("identity_pepper", "secret", "身份 HMAC 密钥", group="accounts", help_zh="只读;丢失或更换会让所有邮箱登录失效;与加密主密钥分开备份")`;`_s("access_token_ttl_days", "accounts", "int", "登录有效天数", min=1, max=365, danger=…调长…)`。`.env.example` 新段落(中文注释:生成命令 `python -c "import secrets; print(secrets.token_urlsafe(48))"`;**丢失或更换的后果**;不得与 `SETTINGS_ENCRYPTION_KEY` 放在同一处备份)。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_accounts_settings.py tests/test_settings_registry.py tests/test_config.py`
- [ ] **提交**:`feat(server): token lifetime and identity pepper settings`

### Task S3:token 过期与滑动续期

**Files:** Modify `server/app/core/deps.py`、`server/app/routers/sessions.py`(`_issue_token` 写 `expires_at` / `last_used_at`);Create `server/tests/test_accounts_tokens.py`。

- [ ] **先写失败测试**:
  - `test_new_token_expires_after_ttl`:注册后该 token 行 `expires_at ≈ now + 30d`。
  - `test_expired_token_is_401`:把行的 `expires_at` 改成过去 → `GET /api/me` 401。
  - `test_null_expiry_is_accepted_and_filled_on_use`(X4):置 `expires_at = NULL, last_used_at = NULL` → 200,之后行上两列均非空。
  - `test_sliding_renewal_writes_at_most_once_per_hour`:`monkeypatch` `app.core.deps.utcnow`(在 deps 里引入可替换的 `utcnow`)→ 连续两次请求只写一次(`last_used_at` 不变);时钟推进 61 分钟后再请求,`expires_at` 前移。
  - `test_ttl_change_is_hot`:`app.state.settings` 换成 `access_token_ttl_days=1` 的副本后新登录的 token `expires_at ≈ now + 1d`。
  - `test_token_lifecycle_logs_nothing_sensitive`:`caplog`(`app` 日志器,DEBUG)不含 token、密码。
- [ ] **实现**:见 R-F8。查询条件 `or_(AccessToken.expires_at.is_(None), AccessToken.expires_at > now)`;`ttl = request.app.state.settings.access_token_ttl_days`。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_accounts_tokens.py tests/test_auth.py tests/test_architecture.py`
- [ ] **提交**:`feat(server): access tokens expire after 30 days with hourly sliding renewal`

### Task S4:`current_user_unbound` 与登出端点

**Files:** Modify `server/app/core/deps.py`、`server/app/routers/sessions.py`;Create `server/tests/test_accounts_logout.py`。

- [ ] **先写失败测试**:
  - `test_logout_deletes_only_the_current_token`:同一用户登录两次得到 A、B;`DELETE /api/sessions/current`(A)→ 204;A 再请求 401,B 仍 200。
  - `test_logout_requires_a_token`:无 token → 401。
  - `test_unbound_dependency_matches_current_user_today`:`current_user_unbound` 与 `current_user` 对有效 / 过期 / 停用 token 的结果一致(P1 阶段还没有强制绑定)。
  - `test_get_me_uses_unbound`:路由表里 `GET /api/me` 的依赖是 `current_user_unbound`(用 `app.routes` 查依赖调用,或在 S21 的行为测试里覆盖;这里先做结构断言)。
  - `test_logout_precedes_stubs`:`DELETE /api/sessions/current` 不再返回 `{}`(stubs 的形状),而是 204 空体。
- [ ] **实现**:`_authenticate(request, session) -> tuple[User, AccessToken]`;`current_user` / `current_user_unbound` 都调用它(X3);把当前 token 行放到 `request.state.access_token_id`,供登出删除。`@router.delete("/sessions/current", status_code=204)`,依赖 `current_user_unbound`,`dependencies=[Depends(auth_rate_limit)]` 不需要。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_accounts_logout.py tests/test_auth.py tests/test_stubs.py tests/test_architecture.py`
- [ ] **提交**:`feat(server): logout endpoint and the unbound auth dependency`

### Task S5:改密端点

**Files:** Create `server/app/routers/account.py`、`server/tests/test_accounts_password.py`;Modify `server/app/main.py`(`account` 紧跟 `sessions`)、`server/app/services/identities.py`(本任务先建文件,只放 `revoke_sessions(session, user_id) -> int`)。

- [ ] **先写失败测试**:
  - `test_change_password_rotates_every_token`:登录两次得 A、B;`POST /api/me/password {current_password, new_password}`(A)→ 200 `{access_token}`;A、B 都 401;新 token 200;旧密码登录 401,新密码 200。
  - `test_wrong_current_password_is_403_and_changes_nothing`:403 `{"error":"Wrong password"}`;A 仍可用。
  - `test_new_password_rules_match_registration`:少于 8 位 422。
  - `test_change_password_cuts_live_connections`:monkeypatch `app.routers.admin_users.cut_connections` 记录被调用的 user_id。
  - `test_change_password_logs_no_secrets`:`caplog` 不含新旧密码与 token。
- [ ] **实现**:R-F9;`Cache-Control: no-store`;`dependencies=[Depends(auth_rate_limit)]`(按 IP,防在线猜当前密码);依赖 `current_user`(改密受强制绑定约束,S21 之后)。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_accounts_password.py tests/test_architecture.py`
- [ ] **提交**:`feat(server): change password revokes every session`

### Task S6:昵称(规则、修改、注册可选、me 字段)

**Files:** Create `server/app/services/nicknames.py`、`server/tests/test_nicknames.py`、`server/tests/test_accounts_nickname_api.py`;Modify `server/app/routers/account.py`(`PATCH /api/me`)、`server/app/routers/sessions.py`(`RegisterIn.nickname` 可选、`UserOut` 加 `nickname`、`display_name`)。

- [ ] **先写失败测试** `test_nicknames.py`(纯函数,`clean_nickname(raw) -> str` 抛 `ValueError("invalid nickname")`):
  - 允许:`"小明"`、`"Emma Lee"`、`"  Emma   Lee "`→`"Emma Lee"`、20 个汉字、带 emoji(按码点计数)。
  - 拒绝:空串 / 全空白、21 个码点、`"​X"`(Cf)、`"a\nb"`、`"\x07"`、`"@Emma"`、`"AI"`、`"ai"`、`"助手"`、`"AI 助手"`、私用区字符。
  - NFC:`"é"` 规范为 `"é"`。
- [ ] **先写失败测试** `test_accounts_nickname_api.py`:
  - `test_patch_me_sets_and_clears_nickname`:`PATCH /api/me {"nickname":"小明"}` → 200,`GET /api/me` 的 `nickname == "小明"`、`display_name == "小明"`、`name == "alice"`;`{"nickname": null}` 清除后 `display_name == "alice"`。
  - `test_invalid_nickname_is_422_without_echo`:错误体不含输入。
  - `test_nickname_rate_limit`:第 11 次 429。
  - `test_register_accepts_optional_nickname`:开关关(X11)时注册带 `nickname` 生效、不带也成功。
  - `test_nickname_never_logged`:`caplog`。
- [ ] **实现**:R-F12;`UserOut` 新字段 `nickname: str | None`、`display_name: str`(`response_model_exclude_none=True` 会去掉 `None`,所以 `nickname` 为空时不出现——**契约里写明「可缺省」**,网页按可选处理)。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_nicknames.py tests/test_accounts_nickname_api.py tests/test_auth.py`
- [ ] **提交**:`feat(server): nicknames for display, editable via PATCH /api/me`

### Task S7:房间里显示昵称

**Files:** Modify `server/app/rooms/store.py`(5 处 + `username()` 改名 `display_name()`,保留 `username = display_name` 别名一个提交周期?**不保留**:调用点只有 routers 与 admin_rooms,同提交全部改)、`server/app/rooms/summary_store.py`、`server/app/routers/rooms.py`、`server/app/routers/rooms_voice.py`、`server/app/routers/admin_rooms.py`;Create `server/tests/test_rooms_display_name.py`。

- [ ] **先写失败测试**(房间测试辅助沿用 `tests/test_rooms_api.py` / `test_rooms_ws.py` 的方式):
  - `test_members_show_nickname_or_username`:一个有昵称、一个没有 → `GET /api/rooms/{id}` 的 `members[].name` 分别是昵称与用户名。
  - `test_message_sender_and_join_request_use_nickname`:WS `message.sender.name`、入房申请 `name` 是昵称。
  - `test_system_messages_snapshot_the_nickname`:`joined` / `left` / `kicked` / `owner` / `reopened` 的 `params.name` 是当时的昵称;改昵称后旧系统消息不变,发送者名变(X6 末条)。
  - `test_default_room_name_uses_display_name`:R-F11。
  - `test_summary_lines_use_display_name`:`SummaryStore.lines()` 的 `name` 是昵称。
  - `test_voice_message_sender_name_is_display_name`。
  - `test_agent_asker_name_is_display_name`:房间智能体回合的 `asker.name` 是昵称(沿用 `test_rooms_agents_*` 的假 LLM 辅助)。
- [ ] **实现**:所有 `select(..., User.username)` 改成 `select(..., display_name().label("name"))`;`user.username` 直接用的地方改成 `user.nickname or user.username`(写一个 `models.display_of(user)` 小函数,与 SQL 表达式一致)。房间契约夹具的**值**不变形状,所以不需要重录(若测试数据里有人设了昵称,值会变——本任务不给夹具里的用户设昵称)。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_rooms_display_name.py tests/test_rooms_api.py tests/test_rooms_ws.py tests/test_rooms_store.py tests/test_rooms_summary_api.py tests/test_web_contract.py tests/test_architecture.py`
- [ ] **提交**:`feat(server): rooms show nicknames instead of login names`

### Task S8:管理端追加昵称(服务端)

**Files:** Modify `server/app/admin/service.py`(`_user_row`、`get_user` 加 `nickname`;搜索 `q` 同时匹配 `User.nickname`)、`server/app/admin/rooms_admin.py`(成员行与消息行追加 `nickname`);Create `server/tests/test_admin_users_nickname.py`。

- [ ] **先写失败测试**:用户列表与详情含 `nickname`(可为 null);`q=小明` 能搜到昵称为「小明」的用户;房间详情成员与消息审核行含 `nickname`;`username` 字段不变(X6)。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_admin_users_nickname.py tests/test_admin_api.py tests/test_admin_rooms.py tests/test_admin_routes_guarded.py`
- [ ] **提交**:`feat(server): admin user and room views show nicknames beside usernames`

### Task S9:清理过期 token

**Files:** Modify `server/app/admin/housekeeping.py::purge_expired`;Modify `server/tests/test_housekeeping.py`。

- [ ] **先写失败测试** `test_purge_removes_tokens_expired_over_7_days`:过期 8 天的删、过期 1 天的留、`expires_at IS NULL` 的留;返回字典多 `access_tokens` 计数。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_housekeeping.py`
- [ ] **提交**:`feat(server): housekeeping purges long-expired access tokens`

### Task W1:网页 API 客户端(P1)

**Files:** Modify `web/src/api/client.ts`、`web/src/api/types.ts`、`web/src/api/client.test.ts`;记录主包基线 `web/scripts/main-bundle-baseline.json`(先单独提交,X25)。

- [ ] **Step 0**:`yarn web:build && node web/scripts/check-main-bundle.mjs --record`,单独提交 `chore(web): record the main bundle baseline before accounts v2`。
- [ ] **先写失败测试**(`test/fetch-mock.ts`):`logout()` 发 `DELETE /api/sessions/current` 且带 Bearer;`changePassword(cur, next)` 发 `POST /api/me/password`(snake_case 键)并返回 `accessToken`;`updateMe({nickname})` 发 `PATCH /api/me`;`me()` 解析 `nickname?`、`displayName`。
- [ ] **测试**:`cd web && yarn vitest run src/api`
- [ ] **提交**:`feat(web): api client for logout, password change and nickname`

### Task W2:登出走服务端、「我的」页昵称与改密

**Files:** Modify `web/src/auth/auth-context.tsx`(`logout` 先 best-effort 调 `api.logout()`,失败吞掉;`changePassword` 换存储的 token)、`web/src/api/auth-storage.ts`(`user` 加可选 `displayName`,形状校验不收紧)、`web/src/pages/me-page.tsx`(一行:`<AccountSection />`);Create `web/src/features/account/{index.ts,lazy.tsx,account-section.tsx,nickname-row.tsx,password-sheet.tsx,account-api.ts,i18n/en.json,i18n/zh-CN.json,CLAUDE.md}` 与对应测试。

- [ ] **先写失败测试**:
  - `auth-context.test.tsx`:`logout()` 调用 `DELETE /api/sessions/current` 且网络失败时仍清本地(从不抛);`changePassword` 成功后新 token 用于下一个请求。
  - `account-section.test.tsx`:显示 `displayName`;编辑昵称 → `PATCH`;服务端 422 显示本地化错误;改密弹层校验 8 位、成功提示。
  - `architecture.test.ts` 保持绿(新 feature 无跨 feature 边)。
- [ ] **实现注意**:`me-page.tsx` 的 `Avatar name` 改读 `displayName ?? name`;`AccountSection` 经 `features/account/lazy.tsx` 懒加载(`React.lazy`),Suspense 占位用现有的 `SectionGroup` 骨架;文案前缀 `web.account.*`。
- [ ] **测试**:`cd web && yarn typecheck && yarn vitest run src/auth src/features/account src/pages src/architecture.test.ts`
- [ ] **提交**:`feat(web): server-side logout, nickname and password change on the me page`

---

# F-P2 · 邮箱

### Task S10:迁移 0022(验证码与发信计数)

**Files:** Create `server/alembic/versions/0022_accounts_email.py`;Modify `server/app/models.py`、`server/app/admin/users_admin.py`(`USER_ROWS` 加 `(VerificationCode, "user_id")`)、head 钉子 7 处、`server/app/CLAUDE.md`;Modify `server/tests/test_accounts_models.py`。

- [ ] **先写失败测试**:`test_head_is_0022…`;`test_0022_round_trips`(建表 → 插行 → 降级删表 → 升级);`test_verification_codes_indexes`(`ix_verification_codes_target_purpose_created` 存在)。
- [ ] **实现**:`VerificationCode`(`verification_codes`):`id` 自增、`channel String(8)`、`purpose String(16)`、`target_hmac String(64)`、`user_id` FK CASCADE 可空 + index、`code_hmac String(64)`、`expires_at`、`attempts Integer default 0`、`consumed_at` 可空、`created_at` + index;`Index("ix_verification_codes_target_purpose_created", "target_hmac", "purpose", "created_at")`。`EmailDailyCount`(`email_daily_counts`):`day Date PK`、`sent Integer default 0`。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_accounts_models.py tests/test_migrations.py tests/test_library_models.py tests/test_changelog_models.py tests/test_admin_users.py`
- [ ] **提交**:`feat(server): verification code tables and migration 0022`

### Task S11:P2 设置

**Files:** Modify `server/app/core/config.py`、`settings_registry.py`、`server/.env.example`、`server/tests/test_settings_registry.py`、`server/tests/conftest.py`、`server/tests/test_accounts_settings.py`。

| 字段 | 类型 / 默认 | kind / apply | 说明(`.env.example` 中文注释要点) |
|---|---|---|---|
| `email_registration_required` | bool `True` | bool / hot | X11;关 = 旧注册方式(应急) |
| `email_backend` | `Literal["off","console","smtp"]` `"off"` | enum / hot | console 只打印「已发送」不打印地址与内容 |
| `smtp_host` | str `""` | str / hot,`pair="smtp_password"`,`danger=_URL_DANGER` | 例 `smtp.qq.com` |
| `smtp_port` | int `465`(1–65535) | int / hot | |
| `smtp_security` | `Literal["ssl","starttls"]` `"ssl"` | enum / hot | 465 用 ssl、587 用 starttls |
| `smtp_user` | str `""` | str / hot | 发件邮箱账号 |
| `smtp_password` | str `""` | **secret** / hot | QQ 授权码;不进日志 / 审计 / 导出 |
| `smtp_from` | str `""` | str / hot | 发件人;空 = `smtp_user` |
| `email_codes_per_target_daily` | int `10`(1–100) | int / hot | 同一邮箱 24 小时内最多几个码 |
| `email_codes_per_ip_hourly` | int `10`(1–1000) | int / hot | 同一 IP 每小时 |
| `email_daily_global` | int `200`(1–100000) | int / hot | **必须小于服务商日限额**;限额以服务商说明 / 实测为准 |
| `email_domain_mode` | `Literal["any","allowlist","blocklist"]` `"blocklist"` | enum / hot | |
| `email_domain_list` | str `""` | csv / hot | allowlist:空 = 内置国内主流;blocklist:追加到内置临时邮箱表 |
| `email_binding_required` | bool `False` | bool / hot | INDEX §10 |
| `email_binding_deadline` | str `""` | str / hot | X12;校验器:空或带时区 ISO 8601 |

- [ ] **先写失败测试**:每项都有 spec(组 `accounts`);`smtp_password` 在 `SECRETS`;`email_binding_deadline` 拒绝 `"2026-10-28"`(无时区)与乱写,接受 `"2026-10-28T00:00+08:00"`;`Settings.email_binding_deadline_at` 属性返回 aware datetime 或 None;`make_settings()` 默认 `email_registration_required is False`。
- [ ] **conftest**:`make_settings` 的 `values` 加 `email_registration_required=False`(带注释:新注册测试显式打开,X11)。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_accounts_settings.py tests/test_settings_registry.py tests/test_config.py tests/test_runtime_settings.py tests/test_auth.py`
- [ ] **提交**:`feat(server): email, SMTP and binding settings`

### Task S12:发信后端 `providers/email.py`

**Files:** Create `server/app/providers/email.py`、`server/tests/test_email_provider.py`。

- [ ] **先写失败测试**(monkeypatch `smtplib.SMTP_SSL` / `smtplib.SMTP` 为记录型假类,不连网):
  - `test_smtp_ssl_sends_one_message_with_fixed_headers`:`From` = `smtp_from or smtp_user`,`To` = 收件人,`Subject` 原样,`Content-Type: text/plain; charset="utf-8"`;调用 `login(user, password)`;`send_message` 一次。
  - `test_starttls_path_calls_starttls_before_login`。
  - `test_rejects_header_injection`:收件人或主题含 `\r`/`\n` → `EmailError("invalid")`,不连接。
  - `test_errors_never_include_password_or_address`:假 SMTP 抛 `SMTPAuthenticationError(535, b"...")` → `EmailError` 的 `str()` 只有 `"auth"`;`caplog` 不含授权码、收件人。
  - `test_console_sender_logs_only_sent`:`caplog` 只有 `email sent purpose=register`(无地址、无正文)。
  - `test_fake_sender_records_messages`:`FakeSender.outbox` 收到 `(to, subject, body)`。
  - `test_check_connects_and_logs_in_without_sending`(给 A2 体检用):不调用 `send_message`。
- [ ] **实现**:`class EmailError(Exception)`,`code ∈ {"auth","timeout","network","tls","rejected","invalid"}`、`status: int`(SMTP 应答码或 0)。`async def send(settings, to, subject, body, *, purpose) -> None` 在 `asyncio.to_thread` 里跑 `smtplib`;超时 10 秒;`ssl.create_default_context()`。`EmailSender` 协议、`SmtpSender`、`ConsoleSender`、`FakeSender`;`sender_for(settings, override=None)`。providers 不导入 FastAPI(架构测试)。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_email_provider.py tests/test_architecture.py`
- [ ] **提交**:`feat(server): pluggable email sender (SMTP, console, fake)`

### Task S13:身份与域名策略 `services/identities.py`、`services/email_domains.py`

**Files:** Create `server/app/services/email_domains.py`、`server/tests/test_identities.py`、`server/tests/test_email_domains.py`;Modify `server/app/services/identities.py`。

- [ ] **先写失败测试**:
  - `normalize_email` / `identity_key`(R-F1):`" A.B+tag@QQ.com "` → `"a.b+tag@qq.com"` / `"a.b@qq.com"`;拒绝非 ASCII、无点域名、含空白、超长。
  - `subject_hmac` 确定且依赖 pepper(换 pepper 结果不同);`encrypt_email` / `decrypt_email` 往返;`mask_email("alice@qq.com") == "a***@qq.com"`、单字符 local `"a***@qq.com"`。
  - `email_ready(settings) -> bool`(X9):缺 pepper、缺加密密钥、`email_backend == "off"` 任一 → False。
  - `find_user_by_email(session, settings, email)`、`bind_email(session, settings, user, email, now)`(写 / 更新 `user_identities` 并同步 `users.email_verified_at`,不提交)、`clear_email(session, user)`。
  - 域名策略:blocklist 默认拒绝内置临时邮箱(例 `mailinator.com`、子域 `x.mailinator.com`)、接受 `qq.com`;`email_domain_list` 追加生效;allowlist 空列表用内置国内主流(`qq.com`、`foxmail.com`、`163.com`、`126.com`、`yeah.net`、`sina.com`、`sina.cn`、`sohu.com`、`aliyun.com`、`139.com`、`189.cn`)、非空用设置值;`any` 全放行。
- [ ] **实现注意**:内置临时邮箱表 ~15 个知名域名,写在 `email_domains.py` 常量里并注释「不求全,管理员可追加」。所有函数不记录日志。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_identities.py tests/test_email_domains.py tests/test_architecture.py`
- [ ] **提交**:`feat(server): email identities (HMAC lookup, encrypted copy) and domain policy`

### Task S14:验证码服务 `services/verification.py`

**Files:** Create `server/app/services/verification.py`、`server/tests/test_verification.py`。

- [ ] **先写失败测试**(假时钟参数 `now`):
  - `issue()` 返回 `(code, row)`:6 位数字;库里只存 `code_hmac`(断言明文不在任何列);同 `(target, purpose)` 旧码被作废。
  - 冷却 60 秒内再 `issue` → `VerificationError("cooldown", retry_after=…)`;24 小时内第 11 个 → `"target_daily"`;全局认领(R-F4)到上限 → `"global_daily"`(只在要真的发信时认领:`issue(..., send=True)`)。
  - `verify()`:正确码 → 置 `consumed_at`(不提交);错码 → `attempts + 1` 已提交(新会话可见,R-F3);第 5 次失败后即使正确码也失败;过期失败;已消费失败;别的 `purpose` 的正确码失败;别的目标的正确码失败。
  - `hidden_issue()`(X10):写行但返回 None,随机码不可得。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_verification.py`
- [ ] **提交**:`feat(server): email verification codes with cooldowns, caps and attempt limits`

### Task S15:Mailer、模板、计量、后台等待

**Files:** Create `server/app/services/mailer.py`、`server/tests/test_mailer.py`;Modify `server/app/core/metering.py`(X14)、`server/app/main.py`(`app.state.mailer = Mailer(lambda: app.state.settings)`)、`server/tests/background.py`、`server/tests/test_metering.py`。

- [ ] **先写失败测试**:
  - `Mailer.enqueue(kind, to, *, code=None, lang="zh-CN")` 立即返回;任务进 `pending`;`drain_background(app)` 后 `FakeSender.outbox` 有一封;`kind ∈ {"register_code","reset_code","bind_code","already_registered","bind_conflict"}`,每种有中英文模板(主题 + 纯文本正文;码只出现在正文)。
  - 发送失败只计数(`mailer.failures`)与记一条 `email send failed code=auth`,不抛、不含地址。
  - 每次发送 `metering.record("email", <backend>, "-", status, ms)`:成功 200、`EmailError` 记 `status`、超时 0;断言 `METER` 里的记录没有地址(记录本来就没有该字段,断言 `model == "-"`)。
  - `FEATURE_PREFIXES` 让 `/api/email/code` 归到 `account`。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_mailer.py tests/test_metering.py tests/test_architecture.py`
- [ ] **提交**:`feat(server): background mailer with templates and metering`

### Task S16:发码端点 `POST /api/email/code`

**Files:** Modify `server/app/routers/account.py`;Create `server/tests/accounts_helpers.py`(`enable_email(app)`:设置开、注入 `FakeSender`、设 pepper 与加密钥;`last_code(app, email)`:从 outbox 解析码)、`server/tests/test_accounts_email_code.py`;Modify `server/app/main.py`(`app.state.email_ip_limiter`,hub 监听 `email_codes_per_ip_hourly`)。

- [ ] **先写失败测试**:
  - `test_register_code_for_new_email_is_sent`:200 `{"ok":true,"cooldown_seconds":60}`;排空后 outbox 一封含 6 位码。
  - `test_register_code_for_registered_email_sends_notice_not_code`:响应与上面**逐字节相同**(除时间无关);outbox 是「已注册」通知,不含 6 位数字。
  - `test_reset_code_for_unknown_email_sends_nothing_but_answers_the_same`。
  - `test_cooldown_and_daily_are_429_for_registered_and_unknown_alike`(X10)。
  - `test_ip_hourly_cap_429`、`test_global_cap_503`、`test_blocked_domain_422`、`test_email_not_configured_503`(X9)。
  - `test_purpose_must_be_register_or_reset`:`bind` → 422。
  - `test_email_code_logs_no_email_or_code`:`caplog`(`app`,DEBUG)对整个流程(含后台发送)不含邮箱、码。
  - `test_email_code_precedes_stubs`。
- [ ] **实现**:`dependencies=[Depends(auth_rate_limit)]`;语言取 `Accept-Language`(只取 `zh` / `en`)。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_accounts_email_code.py tests/test_architecture.py`
- [ ] **提交**:`feat(server): POST /api/email/code without account enumeration`

### Task S17:邮箱注册

**Files:** Modify `server/app/routers/sessions.py`;Create `server/tests/test_accounts_register.py`。

- [ ] **先写失败测试**(`enable_email` + `email_registration_required=True`):
  - `test_register_with_code_creates_user_identity_and_verified_flag`:返回 token;`GET /api/me` 的 `email_verified is True`、`email_masked == "a***@example.com"`、`nickname` 是提交值。
  - `test_missing_email_is_friendly_400`(X11 文案,桌面端兼容)。
  - `test_nickname_required_when_email_required`。
  - `test_wrong_code_is_400_and_counts_an_attempt`。
  - `test_invite_failure_rolls_back_code_consumption`:邀请模式 + 错误邀请码 → 403;同一验证码随后可用于成功注册(R-F7)。
  - `test_username_taken_rolls_back_and_keeps_code`。
  - `test_email_taken_race_returns_the_invalid_code_error`:直接插入同 `subject_hmac` 的身份后提交注册 → 与错码相同的 400。
  - `test_plus_tag_counts_as_the_same_email`:`a+x@example.com` 已注册时 `a@example.com` 的注册码是通知而不是码。
  - `test_switch_off_keeps_the_old_flow`(其余 79 处测试的保证)。
  - `test_register_logs_nothing_sensitive`。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_accounts_register.py tests/test_auth.py tests/test_invite_mode_db_codes.py tests/test_invites.py`
- [ ] **提交**:`feat(server): registration with a verified email in one transaction`

### Task S18:用户名或邮箱登录

**Files:** Modify `server/app/routers/sessions.py`;Create `server/tests/test_accounts_login.py`。

- [ ] **先写失败测试**:邮箱(大小写、空白、`+标签` 变体)登录成功;未知邮箱与错误密码返回同一 401 文案且都走一次哈希校验(用 monkeypatch 计数 `verify_password` 调用次数 = 1);停用用户在密码正确后 403;`LoginIn.username` 上限从 64 提到 254(邮箱长度);`caplog`。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_accounts_login.py tests/test_auth.py`
- [ ] **提交**:`feat(server): log in with a username or an email`

### Task S19:找回密码

**Files:** Modify `server/app/routers/account.py`;Create `server/tests/test_accounts_reset.py`。

- [ ] **先写失败测试**:`POST /api/password/reset {email, code, new_password}` → 204;全部 token 失效;不返回 token(spec「不自动登录」);旧密码失败、新密码成功;错码 400 计次数;未知邮箱与错码同一 400;`cut_connections` 被调用;`caplog` 不含邮箱、码、密码。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_accounts_reset.py`
- [ ] **提交**:`feat(server): password reset by email code revokes every session`

### Task S20:绑定与换绑邮箱

**Files:** Modify `server/app/routers/account.py`;Create `server/tests/test_accounts_bind.py`。

- [ ] **先写失败测试**:
  - `POST /api/me/email/code {email, purpose: bind|change_email}`:`bind` 只在当前无邮箱时允许(否则 409 `Email already bound`),`change_email` 只在已有邮箱时允许;占用邮箱 → 通知而非码,响应相同(R-F6)。
  - `POST /api/me/email {email, code, password?}`:`bind` 成功后 `email_verified`;`change_email` 缺密码 / 错密码 403 `Wrong password`;成功后 `email_masked` 更新、旧邮箱不再能登录、新邮箱能登录;token 不撤销。
  - 两个端点用 `current_user_unbound`(S21 之后,强制状态下仍可用——在 S21 的测试里断言)。
  - `caplog`。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_accounts_bind.py`
- [ ] **提交**:`feat(server): bind or change the account email with a code`

### Task S21:强制绑定与 `/api/me` 字段

**Files:** Modify `server/app/core/deps.py`、`server/app/routers/sessions.py`;Create `server/tests/test_accounts_binding_gate.py`。

- [ ] **先写失败测试**:
  - 开关关:未绑定用户一切照常;`GET /api/me` 的 `email_binding == {"state":"none","deadline":null}`。
  - 开 + 截止在未来:一切照常,`state == "pending"`、`deadline` 为 ISO 串。
  - 开 + 截止已过(或为空):未绑定用户 `GET /api/conversations` → 403 `{"error":"email_binding_required"}`;`GET /api/me`、`POST /api/me/email/code`、`POST /api/me/email`、`DELETE /api/sessions/current` 仍可用;`limited_user` 端点同样 403;已绑定用户不受影响;停用用户仍是 `Account disabled`(先于绑定检查)。
  - 热改:`app.state.settings` 换成开关关的副本后立即放行(每请求读设置)。
  - 票据端点 `POST /api/rooms/{room_id}/ticket`、`POST /api/realtime/ticket`、`POST /api/library/items/{item_id}/media-ticket`(已核对)对未绑定用户 403——WS 与媒体流因此无法新建;已建立的连接不主动断开(下次重连时生效)。
  - `GET /api/me` 的字段集合:`id, name, created_at, display_name, email_verified, email_binding`,以及可缺省的 `nickname`、`email_masked`。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_accounts_binding_gate.py tests/test_auth.py tests/test_architecture.py`
- [ ] **提交**:`feat(server): enforce email binding after the deadline`

### Task S22:删除用户时清理邮箱数据

**Files:** Modify `server/app/admin/users_admin.py::delete_user`;Modify `server/tests/test_admin_users.py`。

- [ ] **先写失败测试**:用户绑定邮箱后申请过 `reset`(行的 `user_id` 为空、`target_hmac` 是他的)→ 删除用户后该邮箱的身份、所有同 `target_hmac` 的验证码都不在;别的用户的码不受影响;审计 `after` 不含邮箱。
- [ ] **实现**:在删身份之前按身份的 `subject_hmac` 删 `verification_codes`(spec §7「级联删除身份、验证码」)。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_admin_users.py`
- [ ] **提交**:`feat(server): deleting a user removes their email identity and codes`

### Task S23:账号契约夹具

**Files:** Create `server/tests/test_accounts_contract.py`、`server/tests/fixtures/accounts_contract.json`。

- [ ] **先写失败测试**:驱动真实流程录制 X28 的七个键;`CONTRACT_UPDATE=1` 时重录,否则比较形状(沿用 `tests/links_helpers.check_contract` 的做法);录制前把 token 换成 `"REDACTED"`、邮箱掩码固定为 `a***@example.com`、时间固定。断言夹具文本不含测试邮箱、码、密码。
- [ ] **测试**:`cd server && CONTRACT_UPDATE=1 uv run pytest -q tests/test_accounts_contract.py && uv run pytest -q tests/test_accounts_contract.py`
- [ ] **提交**:`test(server): accounts contract fixture`

### Task A1:管理端服务端(脱敏邮箱、清除邮箱、未绑定筛选、诊断)

**Files:** Create `server/app/admin/user_email_admin.py`、`server/tests/test_admin_user_email.py`;Modify `server/app/admin/service.py`(列表 / 详情加 `email_masked`、`email_verified`;`list_users(..., email: Literal["all","bound","unbound"])`)、`server/app/routers/admin_users.py`(`POST /api/admin/users/{id}/email/clear`,`Depends(require_step_up)`,`ReasonIn`)、`server/app/routers/admin.py`(`GET /api/admin/users` 在此,已核对;加 `email` 查询参数)、`server/app/admin/doctor.py`、`server/tests/test_admin_doctor.py`。

- [ ] **先写失败测试**:
  - 列表 / 详情只给脱敏邮箱,响应里没有任何完整邮箱(用测试邮箱做全文断言)。
  - `email=unbound` 筛选。
  - 清除邮箱:需要 step-up(否则 403);删身份、`email_verified_at = NULL`;审计 `user.email.clear`,`summary` 为用户名,`before/after` 只有 `{"bound": true}` / `{"bound": false}`;同一事务。
  - 诊断:`email_not_configured`(`error`:`email_registration_required` 或 `email_binding_required` 开着但 `email_ready` 为假)、`email_console_backend`(`warn`)、`binding_without_deadline`(`warn`)。
  - `test_admin_routes_guarded.py` 绿。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_admin_user_email.py tests/test_admin_doctor.py tests/test_admin_api.py tests/test_admin_routes_guarded.py`
- [ ] **提交**:`feat(server): admin sees masked emails and can clear a user's email`

### Task A2:SMTP 体检

**Files:** Modify `server/app/admin/probes.py`(X22)、`server/tests/test_admin_probes.py`、`admin/src/features/settings/probe-button.tsx`(映射 `smtp_host: "smtp"`)及其测试。

- [ ] **先写失败测试**:未配置 → `not_configured`;主机解析到私网 → `blocked_private`(用测试 resolver);假 SMTP 认证失败 → `{"ok":false,"code":"auth"}`;成功 → `ok`;从不调用 `send_message`;返回体不含主机以外的任何值、不含授权码。管理端:设置页 `smtp_host` 行出现「测试连接」按钮。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_admin_probes.py`;`cd admin && yarn vitest run src/features/settings`
- [ ] **提交**:`feat(server): SMTP connectivity probe without sending mail`

### Task A3:管理端网页

**Files:** Modify `admin/src/features/users/{api.ts,strings.ts,index.ts}`、`admin/src/pages/{users-page.tsx,user-detail-page.tsx}` 与测试;Create `admin/src/features/users/{user-email-card.tsx,clear-email-dialog.tsx}` + 测试。

- [ ] **先写失败测试**:用户列表多「昵称」「邮箱」两列(脱敏 + 未绑定标签)与「未绑定邮箱」筛选;详情页邮箱卡片显示脱敏邮箱 / 未绑定;「清除邮箱」对话框要求原因并在 step-up 过期时走现有 step-up 流程;成功后刷新。
- [ ] **测试**:`cd admin && yarn typecheck && yarn vitest run src/features/users src/pages`
- [ ] **提交**:`feat(admin): nickname and masked email columns, clear email action`

### Task W3:网页 API(邮箱)与强制绑定钩子

**Files:** Modify `web/src/api/client.ts`(`ApiClientOptions.onBindingRequired`、`sendEmailCode`、`resetPassword`、`sendMyEmailCode`、`bindEmail`、`register` 新签名对象参数)、`web/src/api/types.ts`、`web/src/api/error-messages.ts` + 测试。

- [ ] **先写失败测试**:403 + `email_binding_required` 调 `onBindingRequired` 一次、不调 `onUnauthorized`;新错误文案映射到 i18n 键(`Invalid or expired code`、`Too many codes, please wait`、`Email temporarily unavailable`、`Email domain not allowed`、`Email is not configured`、`Wrong password`、`Email already bound`、`Email verification required: please register in the web app`);`register({...})` 发 `email_code` 等 snake_case 键。
- [ ] **测试**:`cd web && yarn vitest run src/api`
- [ ] **提交**:`feat(web): api client for email codes, reset and binding`

### Task W4:注册页(懒加载)与登录页

**Files:** Create `web/src/features/account/{register-page.tsx,email-code-field.tsx}` + 测试;Modify `web/src/features/account/{index.ts,lazy.tsx,i18n/*}`、`web/src/pages/login-page.tsx`(去掉注册模式;「用户名或邮箱」;「注册」「忘记密码」链接)、`web/src/pages/i18n/*`、`web/src/auth/{auth-context.tsx,validation.ts}`、`web/src/app.tsx`(`/register` 路由在 `RequireAuth` 之外)。

- [ ] **先写失败测试**:
  - 登录页:输入含 `@` 时不做用户名规范化(`normalizeUsername` 只用于非邮箱);链接存在;旧的注册切换消失。
  - 注册页(R-F13):发码按钮 60 秒倒计时与 429 / 422 / 503 提示;第二步字段校验(昵称规则的前端子集:1–20 字、非空);邀请码框保持现状——始终显示、可选(网页今天不知道注册模式,已核对 `pages/login-page.tsx`;不新增端点);成功后进入 `/practice`。
  - 不在 `localStorage` 写邮箱或码。
- [ ] **测试**:`cd web && yarn typecheck && yarn vitest run src/pages src/features/account src/auth src/architecture.test.ts`
- [ ] **提交**:`feat(web): register with an email code; log in with username or email`

### Task W5:找回密码页

**Files:** Create `web/src/features/account/forgot-password-page.tsx` + 测试;Modify `index.ts`、`lazy.tsx`、`i18n/*`、`web/src/app.tsx`(`/forgot-password`)。

- [ ] **先写失败测试**:两步(邮箱 → 码 + 新密码);成功后跳登录页并提示「请用新密码登录」;任何情况下文案不暗示邮箱是否注册(「如果该邮箱已注册,你会收到验证码」)。
- [ ] **测试**:`cd web && yarn vitest run src/features/account`
- [ ] **提交**:`feat(web): forgot password page`

### Task W6:绑定邮箱页、强制跳转与截止前横幅

**Files:** Create `web/src/features/account/{bind-email-page.tsx,binding-banner.tsx}` + 测试;Modify `web/src/auth/{auth-context.tsx,require-auth.tsx}`(X26)、`web/src/app.tsx`(`/account/email` 在 `RequireAuth` 内;`<BindingBanner />` 放在 `AnnouncementFrame` 的 `AnnouncementBanner` 之后)、`index.ts`、`lazy.tsx`、`i18n/*`。

- [ ] **先写失败测试**:任一请求得到 `email_binding_required` → 跳 `/account/email?required=1`,且该页不再被重定向(无循环);`pending` 状态显示横幅(含本地化的截止时间)与「去绑定」;`enforced` 状态下的绑定页说明「绑定后才能继续使用」;绑定成功后清除状态并回到原页面;`none` 不显示横幅;已绑定者看到换绑表单(需当前密码)。
- [ ] **测试**:`cd web && yarn vitest run src/features/account src/auth src/components/maintenance-screen.test.tsx`(没有 `app.test.tsx`;路由层的行为放在 `auth/require-auth.test.tsx`,`AnnouncementFrame` 的渲染沿用 `maintenance-screen.test.tsx` 的写法)
- [ ] **提交**:`feat(web): bind email page, forced redirect and pre-deadline banner`

### Task W7:「我的」页邮箱区块、文案审校、主包、契约

**Files:** Modify `web/src/features/account/account-section.tsx`(邮箱行:脱敏邮箱 / 未绑定 → 绑定页)、`i18n/*`;Create `web/src/features/account/accounts-contract.test.ts`;Modify `web/src/features/account/CLAUDE.md`、`web/src/CLAUDE.md`(features 列表)。

- [ ] **先写失败测试**:`accounts-contract.test.ts` 读 `server/tests/fixtures/accounts_contract.json` 的七个键并检查 `UserProfile` 字段;`i18n` 测试(`src/i18n/i18n.test.ts` 的键对齐检查)中英键集合一致。
- [ ] **手工**:浏览器窗格 360×740 与 375×812,英文,逐页截图检查标签不溢出(结果写进 PR 描述,标「模拟」)。
- [ ] **主包**:`yarn web:build && node web/scripts/check-main-bundle.mjs --max-delta=1.5`,数字写进 PR 描述。
- [ ] **测试**:`cd web && yarn typecheck && yarn vitest run src/features/account src/i18n src/architecture.test.ts src/build`
- [ ] **提交**:`feat(web): email status on the me page and accounts contract test`

### Task Z1:隐私总扫

**Files:** Create `server/tests/test_accounts_privacy.py`。

- [ ] **先写失败测试**:一个测试跑完整流程(发码 → 注册 → 登录(邮箱)→ 改昵称 → 改密 → 发重置码 → 重置 → 绑定 / 换绑 → 强制绑定 403 → 登出 → 管理员清除邮箱),全程 `caplog`(`app`,DEBUG)+ 收集所有响应体 + 审计表全部行 + `log_buffer` 内容,断言其中都不出现:测试邮箱(含大小写变体)、任何发出的验证码、密码、token、SMTP 授权码、昵称;断言 `access log` 风格的路径里没有邮箱(所有新端点的邮箱都在 POST 体)。
- [ ] **测试**:`cd server && uv run pytest -q tests/test_accounts_privacy.py`
- [ ] **提交**:`test(server): accounts privacy sweep`

### Task Z2:文档与验收

**Files:** Modify `server/README.md`(IDENTITY_PEPPER 与 SETTINGS_ENCRYPTION_KEY 分开备份;QQ SMTP 风险;发布步骤指向 INDEX §10)、`server/app/CLAUDE.md`、`server/app/core/CLAUDE.md`(deps 分级、metering `email`)、`server/app/services/CLAUDE.md`(新模块列表)、`server/app/providers/CLAUDE.md`(`email.py`)、`server/app/routers/CLAUDE.md`(`account`、新 sessions 端点、在 stubs 之前)、`server/app/admin/CLAUDE.md`、`web/src/features/CLAUDE.md`、`web/README.md`(行为与未验证项);本计划末尾「执行结果」。

- [ ] 跑本计划所有定向测试 + `tests/test_architecture.py`、`web/src/architecture.test.ts`;**全量只在用户要求时**。
- [ ] 在本文件末尾追加「执行结果」:每个车道的定向测试数、主包实测增量、未验证项(照抄 INDEX §8 中与本计划相关的条目)。
- [ ] **提交**:`docs: accounts foundation and email notes`

---

## 未验证(本计划范围)

真实 QQ SMTP 发信 / 到达率 / 垃圾箱 / 限额;Postgres 上的 `0021`、`0022`;反向代理后的 `client_ip`;多进程下的进程内限流;iOS / Android 上的 `one-time-code` 自动填充与键盘;360 px 英文标签(模拟以外);桌面端 `enjoy/` 的实际提示文案显示。
