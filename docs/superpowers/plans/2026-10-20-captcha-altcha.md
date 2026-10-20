# 人机验证(ALTCHA)Implementation Plan

> **执行前先读 spec `docs/superpowers/specs/2026-10-20-captcha-altcha-design.md`(尤其 §2 的 R-C1–R-C15)与 `docs/superpowers/plans/2026-10-14-accounts-INDEX.md` §4.4(X30–X37)。与 spec 冲突以本计划的「裁定」为准;本计划不改 spec。**

> **For agentic workers:** 一个任务一个逻辑提交;先写失败测试,看它失败,再实现;每个任务只跑本任务列出的定向测试(全量只在用户要求时)。步骤用 `- [ ]` 勾选,合并且测试通过后才勾。在 git worktree 里工作时,`node_modules`(根与 `web/`)从主检出联接,不要重装(根 `CLAUDE.md`)。

- 日期:2026-10-20 · 状态:未开始(只有文档;未提交)
- Spec:`docs/superpowers/specs/2026-10-20-captcha-altcha-design.md`
- INDEX(耦合与隐私规则):`docs/superpowers/plans/2026-10-14-accounts-INDEX.md` §4.4
- 迁移:`0027_captcha_replay`(S5);写计划时已核对真实 head 是 **`0026`**(`server/alembic/versions/0026_invites_v2.py`)

**Goal:** 自托管的 ALTCHA v2 工作量证明人机验证。`CAPTCHA_MODE=off|adaptive|always`(热改,默认 `off`);注册、两个发码端点、找回密码在开启时必验,登录在 `adaptive` 下连续失败后才验、在 `always` 下必验(R-C1);挑战由我们签发、我们校验,一次性(数据库防重放),失败即关闭;网页组件只在需要的页面懒加载。

**Architecture:** 不新增顶层包(INDEX X1)。服务端:`core/captcha_policy.py`(纯策略,只用标准库)、`core/captcha.py`(官方库 `altcha==2.3.0` 的适配:签发 / 校验 + 我们自己的严格检查)、`core/login_failures.py`(进程内失败计数)、`services/captcha_replay.py`(认领 / 清理,参数传入,不读 `app.state`)、`routers/captcha.py`(`GET /api/captcha/config`、`GET /api/captcha/challenge`)、`routers/captcha_guard.py`(**不是路由**,`enforce()`;与 `routers/live_connections.py` 同类,X30 先例)。五个端点在处理函数里显式调用 `enforce()`(R-C9)。网页:共享层 `components/captcha/`(懒加载组件 + 懒加载文案),`ApiClient` 加 `captcha` 选项 → `X-Captcha` 请求头(R-C3)。

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + pytest-asyncio(Python 3.12,uv);**新依赖** `altcha==2.3.0`(PyPI,MIT,零依赖)。React 18 + vitest + Testing Library;**新依赖** `altcha@3.4.1`(npm,MIT,依赖 `hash-wasm`),只在懒加载分块里。Playwright 1.51。

## Global Constraints

- **隐私硬规则:** ALTCHA 载荷(`X-Captcha` 的值)、`solution`(`counter`、`derivedKey`)、`nonce`、`salt`、`signature`、`keySignature`、`CAPTCHA_SECRET`、派生出的两把 HMAC 密钥,**不进日志、错误体、审计、URL、测试快照与契约夹具**;登录名不以明文进计数器的键(R-C6)。每个新端点与 `enforce()` 都有 `caplog` 断言:`caplog.set_level(logging.DEBUG, logger="app")`(只收 `app` 日志器;aiosqlite 的 DEBUG 会打印 SQL 参数),断言测试载荷、签名、nonce、密钥、测试密码都不在 `caplog.text` 里。错误文案是固定字符串(spec §6.4),不拼接输入。
- **设置:** 每个新 `Settings` 字段都有 `SettingSpec`(`tests/test_settings_registry.py` 强制)与 `server/.env.example` 中文注释;`captcha_secret` 是 env-only secret(`_env(..., "secret", ...)`),加进 `EXPECTED_ENV_ONLY` 与 `EXPECTED_SECRETS`;热改的字段每次请求读 `request.app.state.settings`;被启动时固化进对象的值(限流器的 `limit` / `window`)用 hub 监听推送。
- **迁移:** 新表用 `op.create_table`(SQLite 与 Postgres 同一路径,不需要 batch;batch 只用于 SQLite 上的 ALTER——本迁移没有 ALTER);往返测试(`upgrade 0026 → upgrade 0027 → downgrade 0026 → upgrade 0027`);`tests/test_migrations.py::test_models_match_migrations` 绿;**同一提交**把所有 head 钉子改成 `"0027"`(写计划时 `Grep "get_heads\(\) == \[" server/tests` 的结果是 **10 处 / 7 个文件**:`test_migrations.py` 4 处(第 365、432、497、548 行)、`test_accounts_models.py`、`test_avatars_models.py`、`test_changelog_models.py`、`test_invites_v2_models.py`、`test_library_catalog_models.py`、`test_library_models.py` 各 1 处;执行者先重新 grep),并把 `server/app/CLAUDE.md` 的「head `0026`」改为 `0027`。
- **分层(INDEX X31–X36):** 路由只做 HTTP(入参、错误码、调用);`services/captcha_replay.py` 只收参数(`session`、`signature`、`expires_at`、`now`),不读 `app.state`、不读设置;纯策略在 `core/captcha_policy.py`,只用标准库,并加入 `tests/test_architecture.py` 的 `STDLIB_ONLY`(这是**收紧**,允许);`core/*` 不导入 services;不新增顶层包;`deps.py`、`sessions.py`、`account.py`、`main.py` 只改任务点名的位置;路由模块之间只有「`sessions` / `account` → `captcha_guard`」这一条新边(R-C10,与 X30 同类)。
- **网页(X35、X37):** `components/captcha/` 是共享层,只依赖 `~/api`(类型)、`~/i18n`、`~/lib`;不导入任何 feature、`auth`、`pages`;文案在 `components/captcha/locales/{en,zh-CN}.json`(不在 `**/i18n/` 下),由 `ensureCaptchaI18n()` 懒合并;`web/src/architecture.test.ts` **不改**;不新增 feature→feature 边;组件不直接 `fetch`(配置走 `ApiClient`,挑战由 ALTCHA 组件按 `challenge` URL 自取——这是同源请求,写进 `components/captcha/CLAUDE.md`)。主包预算 ≤ 0.6 kB gzip(实测为准,W1 先 `--record` 基线)。
- **不改 `enjoy/`**(兼容结论见 spec §12);不改管理端前端;不碰 Docker(E 车道的一次性栈覆盖文件放会话 scratchpad,不进仓库;只有用户要求时才起栈)。
- **提交:** conventional(`feat(server): …`、`feat(web): …`、`test(web): …`、`docs: …`),一个任务一个提交,信息以下面这行结尾:
  `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`

## 文件结构

```
server/
  pyproject.toml、uv.lock                         + altcha==2.3.0(S2)
  alembic/versions/0027_captcha_replay.py         新(S5)
  app/models.py                                   CaptchaReplay(文件末尾,标题注释 `# ---- 人机验证 ----`)(S5)
  app/core/config.py、settings_registry.py        九个字段(S1)
  app/core/captcha_policy.py                      新:纯策略(S4)
  app/core/captcha.py                             新:ALTCHA 适配(S2 签发、S3 校验)
  app/core/login_failures.py                      新:进程内失败计数(S7)
  app/services/captcha_replay.py                  新:claim / purge(S6)
  app/routers/captcha.py                          新:GET /api/captcha/config、/challenge(S8)
  app/routers/captcha_guard.py                    新(不是路由):enforce()(S9)
  app/routers/account.py                          三处 enforce(S10)
  app/routers/sessions.py                         注册一处、登录一处 + 失败计数(S11、S12)
  app/main.py                                     app.state 两个对象 + 监听 + 路由顺序(S7、S8)
  app/admin/housekeeping.py                       purge_expired + captcha_replays(S6)
  app/admin/doctor.py                             三条诊断(A1)
  app/admin/settings_service.py                   danger 方向规则(A2)
  .env.example、README.md                         中文注释(S1);部署一节(Z2)
  tests/captcha_helpers.py                        新:enable_captcha(app)、solve(challenge)、header_for(client)(S8)
  tests/test_captcha_*.py                         新(见各任务)
  tests/fixtures/captcha_contract.json            新(S13)
  tests/test_settings_registry.py、test_architecture.py、test_housekeeping.py、test_admin_doctor.py   见各任务
web/
  package.json、yarn.lock                         + altcha@3.4.1(W2)
  scripts/main-bundle-baseline.json               W1 重新记录
  src/api/client.ts、types.ts、error-messages.ts  captcha 选项、captchaConfig()、三条错误映射(W1)
  src/i18n/{en,zh-CN}.json                        web.errors.captcha*(W1)
  src/components/captcha/                         新:index.ts、captcha-field.tsx(懒加载外壳)、captcha-widget.tsx(组件本体)、
                                                  use-captcha-gate.ts、locales.ts、locales/{en,zh-CN}.json、CLAUDE.md + 测试(W2、W3)
  src/features/account/{signup-page,forgot-password-page,bind-email-page,email-code-field,account-api}.tsx/ts   W4–W6
  src/pages/login-page.tsx、src/auth/auth-context.tsx   W7
  src/features/account/captcha-contract.test.ts   新(W8)
  e2e/support/captcha.ts、e2e/captcha.spec.ts、e2e/support/upstream-guard.ts、src/test/e2e-upstream-guard.test.ts   E1
docs/superpowers/plans/2026-10-20-captcha-altcha.md   Task 0 结果、执行结果(Task 0、Z1、Z2)
```

## 并行车道与合并顺序

| 车道 | 任务 | 依赖 |
|---|---|---|
| **S**(串行) | Task 0 → S1 → … → S14 | Task 0 第 1 项(R-C1 确认)之前不开工 |
| **A** | A1 → A2 | A1 在 S1 后;A2 在 S1 后 |
| **W** | W1 → W2 → W3 → W4 … W7 → W8 | W1–W3 可与 S 并行(用 `fetch-mock`);W4–W7 的接口形状以 S10–S12 为准;W8 在 S13 后 |
| **E** | E1 → E2 | 全部 S、W 合并后;E2 只在用户要求时运行 |
| **Z** | Z1 → Z2 → Z3(评审波) | Z1 在 W8 后;Z3 在合并前 |

**评审波(Z3,合并前):** 一次 `/code-review high` + `security-review`,重点:载荷校验的每一个拒绝分支、防重放的认领与提交顺序、`enforce()` 在五个端点里的位置(相对于密码哈希、查库、发码额度)、失败即关闭、计数器的键里没有明文、日志卫生、`captcha_required` 是否泄露「该登录名是否存在」(必须不泄露)。W 车道合并前在浏览器窗格 375×812 浅色 + 深色、中英两种语言走注册、找回密码、绑定、登录(`adaptive` 失败 5 次后出现组件 / `always` 直接出现)。

## 本计划的裁定(Ruling)

> spec §2 的 R-C1–R-C15 全部适用;下面是执行细节。

- **R-C16 精确的错误字符串**(定义为常量,测试逐字比较):`CAPTCHA_REQUIRED = "captcha_required"`、`CAPTCHA_INVALID = "captcha_invalid"`、`CAPTCHA_NOT_CONFIGURED = "Captcha is not configured"`、`CAPTCHA_OFF = "Captcha is off"`;状态码:前两个 428,第三个 503,第四个 404。定义在 `app/routers/captcha_guard.py`(`captcha.py` 从它导入 `CAPTCHA_OFF` 与 `CAPTCHA_NOT_CONFIGURED`)。
- **R-C17 作用域名**(`Scope = Literal["register", "email_code", "reset", "login"]`):`POST /api/users` → `register`;`POST /api/email/code` 与 `POST /api/me/email/code` → `email_code`;`POST /api/password/reset` → `reset`;`POST /api/sessions` → `login`。
- **R-C18 协议常量**(`core/captcha.py`):`ALGORITHM = "PBKDF2/SHA-256"`、`MAX_HEADER_BYTES = 4096`、`MAX_TTL_SECONDS = 1800`、`CLOCK_SKEW_SECONDS = 60`、`HEADER = "x-captcha"`(请求头名大小写不敏感)。
- **R-C19 counter 选择**:`base = secrets.randbelow(counter_max - counter_max // 2 + 1) + counter_max // 2`,`counter = max(1, min(base * (multiplier if flagged else 1), 0xFFFFFFFF))`。
- **R-C20 两把派生密钥**:`hmac_secret = hmac.new(secret.encode(), b"altcha:challenge", "sha256").hexdigest()`,`hmac_key_secret = hmac.new(secret.encode(), b"altcha:key", "sha256").hexdigest()`;不缓存在模块全局(每次由传入的 `secret` 计算,微秒级)。
- **R-C21 登录名的计数键**:`typed = payload.username.strip().lower()`;含 `@` 且 `identities.normalize_email` 不抛错时用 `identities.identity_key(normalize_email(typed))`,否则用 `typed`;再 `blake2b(key.encode(), key=<进程随机 16 字节>, digest_size=16).hexdigest()`。IP 键是 `client_ip(request)` 原值(只在内存)。
- **R-C22 认领后立即提交**:`enforce()` 在 `claim()` 返回真后 `await session.commit()`;这样后续的 `verification.verify`(若会话有待写入会抛 `RuntimeError`,已核对 `services/CLAUDE.md`)不受影响。
- **R-C23 网页把载荷当一次性**:每次带载荷的请求返回后(成功或失败),页面调用 `gate.consumed()`;收到 `ApiError` 且 `status === 428` 时 `gate.onServerError(err)` 返回 `true` 并显示组件。
- **R-C24 一次性 E2E 栈**:覆盖文件放会话 scratchpad(不进仓库),在 accounts 一次性栈的基础上加 `CAPTCHA_MODE=always`、一次性 `CAPTCHA_SECRET`、`CAPTCHA_COST=1`、`CAPTCHA_COUNTER_MAX=10`;API 侧的求解用容器里的官方库(`docker exec <project>-server-1 python -c ...`,与 `support/accounts.ts::codeFor` 同一模式),UI 侧由真实组件在浏览器里求解。`docker-compose.e2e.yml` 不改。

---

## Task 0:核对事实(只读,结果写回本节)

**目标:** 把 spec 里「未核对」的事项确认下来,结果写进下表「结果」列;与预期不符时**停下报告**,不要自行改裁定。

- [ ] **Step 1** 逐项核对:

| # | 事项 | 方法 | 写计划时的结果(执行者再确认) | 不符时 |
|---|---|---|---|---|
| 1 | **R-C1:`always` 下登录必验** | 问用户 | **已确认(用户裁定):** approved,`always` 下登录必须验证(紧急模式,会挡住桌面端,doctor 给警告);`adaptive` 为推荐的生产模式。与计划一致,`captcha_mode` 保持三值。 | 用户选「`always` 下登录仍自适应」→ 停下:`captcha_mode` 改为 `Literal["off","on"]`,S1/S4/A1 按两值改写后再开工 |
| 2 | 迁移头 | `cd server && uv run alembic heads` | **已核对:** `server/alembic/versions/` 最后一个文件是 `0026_invites_v2.py`;`grep down_revision` 得到链 0023→0024→0025→0026,单头 `0026`,未被占用。与计划一致。 | 已被占用 → 本计划顺延一个号,并在 INDEX §11 追加一行 |
| 3 | head 钉子 | `Grep "get_heads\(\) == \[" server/tests` | **已核对(grep 实测):** `get_heads() == [` 共 **11 处 / 7 个文件**:`test_accounts_models.py:29`、`test_avatars_models.py:29`、`test_changelog_models.py:18`、`test_invites_v2_models.py:51`、`test_library_catalog_models.py:26`、`test_library_models.py:16` 各 1 处;`test_migrations.py` 的 365、432、497、548、628 行共 5 处。**与计划不符:** 计划写 10 处 / test_migrations.py 4 处,漏了第 628 行。S 车道要改 11 处。 | 照实全部改 |
| 4 | Python 库 | `https://pypi.org/pypi/altcha/json` | **已核对(`https://pypi.org/pypi/altcha/json`):** 最新版 2.3.0,上传 2026-10-04T01:23:24;`requires_python >=3.9`;`requires_dist` 为空(无依赖);classifier `License :: OSI Approved :: MIT License`(license 字段为空)。仓库提交时间**未核对**(未访问 GitHub)。 | 版本更新:仍钉 2.3.0,除非 2.3.x 有安全修复 |
| 5 | 库的 v2 接口 | 在一次性目录 `uv run --with altcha==2.3.0 python -c "import altcha, inspect; print(inspect.signature(altcha.create_challenge)); print(inspect.signature(altcha.verify_solution)); print(inspect.signature(altcha.solve_challenge))"`(不在仓库里装) | **已核对(临时环境 `uv run --no-project --with altcha==2.3.0 python -I`):** `create_challenge(algorithm, cost, *, derive_key, counter, counter_mode='uint32', key_length=32, key_prefix='00', key_prefix_length, memory_cost, parallelism, expires_at, data, hmac_secret, hmac_key_secret, hmac_algorithm='SHA-256')`;`verify_solution(payload, hmac_secret, derive_key=None, *, hmac_key_secret, hmac_algorithm, counter_mode)` 返回 `VerifySolutionResult`(expired, invalid_signature, invalid_solution, time, verified, error);`solve_challenge(challenge, derive_key=None, *, counter_start, counter_step, timeout=90.0, counter_mode)`。名字与计划一致,`create_challenge` 另有可选参数。 | 名字不同:只改 S2/S3 适配函数内部,对外接口(`issue`、`verify`)不变 |
| 6 | 挑战 JSON 形状 | 用上面的库生成一次 PBKDF2 确定性挑战并 `to_dict()` | **已核对(生成一次挑战,只打印形状):** `to_dict()` = `{parameters: {algorithm, cost, keyLength, keyPrefix, nonce, salt, keySignature, expiresAt}, signature}`,与计划一致(值类型:expiresAt 为 int)。**注意:** 不传 `counter` 时没有 `keySignature` 与 `expiresAt`;`nonce`、`salt` 每次随机(`secrets.token_bytes`),所以只有传入 `counter`(预解)时挑战才是确定的,此时 `keyPrefix` 被改写为派生密钥的前缀(实测 32 个 hex 字符)。 | 照实改 spec §6.2 的示例(执行结果里记一笔) |
| 7 | `verify_solution` 的过期检查 | 读 `altcha/v2.py` | **已核对(`altcha/v2.py` 第 794–795 行):** 只有 `expiresAt` 为非零 int/float 且 `< time.time()` 时才返回 expired;为 0、空或非数字时跳过(之后由签名校验)。单位是秒(Unix 时间戳)。实测 expiresAt=1000 → expired=True。与计划一致:S3 必须要求 `expiresAt` 存在且为正数。 | — |
| 8 | `cost` 的含义 | 读 `altcha/v2.py::derive_key_pbkdf2` | **已核对(`altcha/v2.py` 第 495–503 行;`dist/workers/pbkdf2.js` 第 195 行 `iterations: cost`):** `cost` 就是 PBKDF2 的迭代次数(`hashlib.pbkdf2_hmac(digest, password, salt, cost, key_length)`),每个 counter 做一次完整派生。与计划的推测一致;`.env.example` 注释可写成「每次尝试的 PBKDF2 迭代次数」。本条不给耗时数字。 | 记下真实含义,写进 `.env.example` 注释 |
| 9 | `solution.time` 的单位 | 读源码 + 组件 `Widget.svelte` | **已核对(单位为毫秒):** 库 `Solution.time` 文档写 milliseconds,代码 `(time.monotonic() - start_time) * 1000`(`altcha/v2.py` 第 726 行);组件的 `timeDuration(start)` = `Math.floor((performance.now() - start) * 10) / 10`,即毫秒、0.1 毫秒精度(`dist/lib/index.js` 第 953 行、`dist/workers/pbkdf2.js` 第 46 行),组件载荷的 solution 来自它。与计划的推测一致:S9 的 solve_ms **不需要**乘 1000。 | 秒 → S9 的 `solve_ms` 乘 1000 |
| 10 | 组件版本 | `https://registry.npmjs.org/altcha/latest` | **已核对(`https://registry.npmjs.org/altcha/latest`):** latest = 3.4.1,MIT,依赖只有 `hash-wasm ^4.12.0`,发布于 2026-10-19T00:03:31Z。`npm pack altcha@3.4.1` 得到的 tarball sha1 与 registry 的 shasum 一致(51fe9667…)。与计划一致。 | 钉 3.4.1;更新的补丁版只在修安全问题时采用 |
| 11 | 组件 API | 读 `https://altcha.org/docs/integration/widget/` 与 `src/Widget.svelte` | **已核对(tarball `dist/external/altcha.js` 源码 + altcha.org/docs/integration/widget/):** `auto` = off/onfocus/onload/onsubmit(源码 6469、6768、6781 行);`challenge`(URL 或 JSON);`display` 默认 standard;`language`;`name` 默认 altcha;`type` 默认 checkbox;`workers`。`configure` 默认值(源码 6366–6400 行)含 hideFooter、hideLogo、minDuration、timeout、setCookie、humanInteractionSignature。事件:load、statechange、verified、expired(另有 codechallenge、serververification、outofmemory)。**verify() 是否返回 Promise:未核对**(公开文档只写「Initiates the verification process」;源码内部 `async function verify` 在第 7047 行,公开 API 的返回值未证实)。 | 照实写进 W2 |
| 12 | 中文语言包的导入路径 | `ls web/node_modules/altcha/dist/i18n`(W2 装好后)或 npm 包文件列表 | **已核对(tarball 文件列表 + package.json exports):** `dist/i18n/zh-cn.js` 存在(另有 zh-hk.js、zh-tw.js),`en.js` 存在;`exports` 含 `./i18n/*`,所以 `altcha/i18n/zh-cn` 与 `altcha/i18n/en` 路径有效。**未核对:** 在 W2 的 Vite 构建里实际导入(未装进 web/)。`dist/i18n` 里没有 `zh.js`。 | 照实改 W2 |
| 13 | `humanInteractionSignature`(默认开) | 读源码 | **已核对(源码 6503–6522、6615–6619 行):** `humanInteractionSignature` 默认 true 时只启用客户端 Collector;HIS 数据只在**服务端返回的 JSON 含 `his` 字段**时才 POST 到 `his.url`,载荷本身不加字段。我们的 `GET /api/captcha/challenge` 不返回 `his`,不会触发。服务端实测:在 `parameters` 与 `solution` 里加入未知字段后 `verified=True`(签名只覆盖已知参数)。结论:无影响,不需要 `configure({humanInteractionSignature:false})`。文档本身未说明是否加字段(未核对)。 | 若加字段且库忽略 → 无影响;若导致校验失败 → `configure({humanInteractionSignature:false})` |
| 14 | 非安全上下文 | 读 `Widget.svelte` | **已核对(源码 7064–7066 行):** `!isSecureContext` 时求解阶段抛 `Secure context (HTTPS) required.`(6508–6509 行只打日志)。**localhost 例外:未核对**:源码里没有 localhost 判断,由浏览器的 `isSecureContext` 决定;组件文档页未提及;计划所说的「排错文档」未访问。 | — |
| 15 | 桌面端调用 | 读 `enjoy/src/shared/api/client.ts`(`auth`、`register`)与 `renderer/components/login/password-login-form.tsx` | **已核对(`enjoy/src/shared/api/client.ts` 98–119 行;`enjoy/src/renderer/components/login/password-login-form.tsx` 22–30 行):** 登录 `auth({provider:'password', username, password})` → `POST /api/sessions`;注册 `register({username, password, inviteCode?})` → `POST /api/users`,键名经 decamelizeKeys 变为 `invite_code`;错误 client.ts 78–82 行 `err.message = err.response.data.error 或 ...`,表单 `toast.error(err.message)`。与计划一致。 | — |
| 16 | 现有登录失败计数 | `Grep "lockout\|failed_login" server/app` | **已核对(grep `lockout` 与 `failed_login`;`routers/sessions.py` 157、221 行;`core/deps.py` 99–100 行):** 用户登录**没有**失败计数,只有 `auth_rate_limit`,它用 `app.state.limiter`(`main.py` 92 行,按 IP,`rate_limit_per_minute` 默认 10,`config.py` 95 行)。管理员锁定 `admin/lockout.py` 用 ORM 模型 `AdminLoginState`。**与计划不符:** 表名是 `admin_login_state`(单数,`models.py` 368 行),计划写的 `admin_login_states` 不存在。 | — |
| 17 | `insert_ignore` | 读 `app/core/db.py` | **已核对(`server/app/core/db.py` 15–19 行):** `insert_ignore(session, table)` 按方言返回 `postgresql.insert` 或 `sqlite.insert` 的 `.on_conflict_do_nothing()`。与计划一致。 | — |
| 18 | `purge_expired` 的精确字典断言 | `Grep "purge_expired(" server/tests` | **已核对(grep `purge_expired(`):** `tests/test_housekeeping.py` 第 101–103 行整个字典断言(5 个键:admin_sessions、admin_login_state、speech_tokens、access_tokens、rank_profile_snapshots);`tests/test_admin_rank_ops.py` 第 198–199 行只取 `rank_profile_snapshots`。与计划一致,S6 同提交更新第 101 行。 | S6 同提交更新第 101 行 |
| 19 | CSP | `Grep "Content-Security-Policy" server/app web` | **已核对(grep `Content-Security-Policy`,在 `server/app` 与 `web` 的 py/ts/tsx/html/conf 中):** 只有 `server/app/routers/avatars.py` 第 92 行的头像响应 `default-src 'none'`;网页中没有 CSP。与计划一致,W2 不需要停下。 | 若已有 CSP:W2 先停下报告 |
| 20 | `Retry-After`、错误渲染 | 读 `app/core/errors.py` | **已核对(`server/app/core/errors.py` 8–11 行):** `StarletteHTTPException` 渲染为 `{"error": str(exc.detail)}`。`Retry-After` 由路由显式设置(例:`routers/account.py` 146、214 行)。与计划一致。 | — |

- [ ] **Step 2** 把「结果」列更新后提交:`docs: captcha plan task 0 findings`。

---

## S 车道 · 服务端

### Task S1:设置(九个字段)

**目标:** spec §4 的九个设置;`captcha_secret` 为 env-only secret。

**Files:** Modify `server/app/core/config.py`(在 `avatar_upload_enabled` 之后、`trust_proxy_headers` 之前插入一段,注释 `# 人机验证(spec 2026-10-20-captcha-altcha §4):除 CAPTCHA_SECRET 外全部热改`)、`server/app/core/settings_registry.py`(`registration` 组末尾,`invite_failures_per_ip_hourly` 之后)、`server/.env.example`、`server/tests/test_settings_registry.py`;Create `server/tests/test_captcha_settings.py`。

- [ ] **先写失败测试** `tests/test_captcha_settings.py`:
  - `test_defaults`:`Settings(_env_file=None)` 的 `(captcha_mode, captcha_secret, captcha_ttl_seconds, captcha_cost, captcha_counter_max, captcha_flagged_multiplier, captcha_login_failures, captcha_login_window_minutes, captcha_challenges_per_minute) == ("off", "", 300, 5000, 10000, 2, 5, 15, 20)`。
  - `test_bounds`:`field_bounds` 依次为 `ttl (60, 1800)`、`cost (1, 100000)`、`counter_max (10, 1000000)`、`multiplier (1, 10)`、`login_failures (1, 100)`、`window (1, 1440)`、`challenges (1, 1000)`。
  - `test_mode_choices`:`choices_for("captcha_mode") == ("off", "adaptive", "always")`。
  - `test_secret_is_env_only_and_secret`:`SPECS["captcha_secret"].env_only and SPECS["captcha_secret"].secret and SPECS["captcha_secret"].kind == "secret"`。
  - `test_secret_length_validated_without_echo`:`Settings(_env_file=None, captcha_secret="short-secret")` 抛 `ValidationError`,`"short-secret" not in str(exc)`;空串与 32 字符通过。
  - `test_all_captcha_keys_are_hot_in_registration_group`:除 `captcha_secret` 外 `apply == "hot"`,全部 `group == "registration"`。
  - `test_danger_strings_present`:`captcha_mode`、`captcha_cost`、`captcha_counter_max`、`captcha_login_failures` 有 `danger`。
- [ ] **实现:**
  - `captcha_mode: Literal["off", "adaptive", "always"] = "off"`;`captcha_secret: str = ""`(+ `@field_validator("captcha_secret")`:非空且 `len < 32` → `ValueError("CAPTCHA_SECRET must be at least 32 characters")`,仿 `_identity_pepper`);其余 `Field(默认, ge=, le=)`。
  - registry:`_env("captcha_secret", "secret", "人机验证签名密钥", group="registration", help_zh="只读环境变量;更换只会让未用完的挑战失效")`;`_s("captcha_mode", "registration", "enum", "人机验证", danger="off 会去掉注册与发码的人机验证;always 会让桌面端无法登录", help_zh="adaptive 推荐:注册 / 发码 / 找回密码必验,登录连续失败后才验")`;`_s("captcha_cost", ..., "int", "PoW 每次尝试的成本", danger="调低会降低脚本成本")`;`_s("captcha_counter_max", ..., "int", "PoW 工作量上限", danger="调低会降低脚本成本")`;`_s("captcha_login_failures", ..., "int", "登录失败几次后要求验证", danger=_WEAKER_LOGIN)`;其余无 danger。
  - `test_settings_registry.py`:`EXPECTED_ENV_ONLY` 与 `EXPECTED_SECRETS` 各加 `"captcha_secret",  # spec 2026-10-20-captcha-altcha §4`。
  - `.env.example`:新段落「# ---- 人机验证(ALTCHA,自托管) ----」,每个变量一行中文注释;`CAPTCHA_SECRET=` 写生成命令 `python -c "import secrets; print(secrets.token_urlsafe(48))"`,注明「开启 CAPTCHA_MODE 前必须设置;缺失时受保护的接口返回 503」;`CAPTCHA_MODE=off` 注明桌面端影响(spec §12)。
  - `make_settings` **不改**(默认 `off`,现有测试不受影响)。
- [ ] **测试:** `cd server && uv run pytest -q tests/test_captcha_settings.py tests/test_settings_registry.py tests/test_config.py`
- [ ] **提交:** `feat(server): captcha settings (mode, env-only secret, difficulty, login thresholds)`

### Task S2:ALTCHA 适配 · 签发(`core/captcha.py`)

**目标:** `issue()` 生成 v2 PBKDF2 确定性挑战;依赖钉死。

**Files:** Modify `server/pyproject.toml`、`server/uv.lock`(`cd server && uv add "altcha==2.3.0"`);Create `server/app/core/captcha.py`、`server/tests/test_captcha_core.py`。

- [ ] **先写失败测试** `tests/test_captcha_core.py`(假时钟用参数 `now: int`,不 monkeypatch `time`):
  - `test_issue_shape`:`c = issue(SECRET, cost=1, counter=5, ttl=300, now=1_000_000)` → `set(c) == {"parameters", "signature"}`;`c["parameters"]["algorithm"] == "PBKDF2/SHA-256"`、`["cost"] == 1`、`["expiresAt"] == 1_000_300`、有 `keySignature`、`keyPrefix`、`nonce`、`salt`;`re.fullmatch(r"[0-9a-f]{64}", c["signature"])`。
  - `test_issue_is_solvable_by_the_official_solver`:`altcha.solve_challenge(...)`(Task 0 第 5 项记下的调用方式)对 `issue(..., cost=1, counter=7, ...)` 能解出,解出的 counter == 7。
  - `test_two_issues_differ`:两次 `issue` 的 `nonce` 与 `signature` 都不同。
  - `test_secret_not_in_challenge`:`SECRET`、两把派生密钥(R-C20)都不在 `json.dumps(c)` 里。
  - `test_pick_counter`:`pick_counter(10000, 2, flagged=False)` 落在 `[5000, 10000]`(固定 `secrets.randbelow` 的 monkeypatch 取两端值);`flagged=True` 时是同一 base 的 2 倍;`pick_counter(10, 1, False) >= 5`;上限夹到 `0xFFFFFFFF`。
- [ ] **实现:**
  - 模块文档字符串:「ALTCHA v2 适配(spec R-C4、R-C5)。只依赖标准库与 `altcha`;不记录任何日志;从不保存或返回密钥。」
  - 常量见 R-C18;`def derived_keys(secret: str) -> tuple[str, str]`(R-C20);`def pick_counter(counter_max: int, multiplier: int, flagged: bool) -> int`(R-C19);`def issue(secret: str, *, cost: int, counter: int, ttl: int, now: int) -> dict`:调用 `altcha.create_challenge(ALGORITHM, cost, counter=counter, expires_at=now + ttl, hmac_secret=..., hmac_key_secret=...)` 并返回 `to_dict()`(或库的等价物)。**同步函数**(调用方用 `asyncio.to_thread`)。
  - `core` 允许第三方包(`server/app/core/CLAUDE.md`);**不要**把 `core/captcha.py` 加进 `STDLIB_ONLY`。
- [ ] **测试:** `cd server && uv run pytest -q tests/test_captcha_core.py tests/test_architecture.py`
- [ ] **提交:** `feat(server): issue ALTCHA v2 PBKDF2 challenges (altcha==2.3.0)`

### Task S3:ALTCHA 适配 · 校验(安全关键)

**目标:** `verify()` 只在载荷完全合法时返回 `Verified(signature, expires_at, solve_ms)`,否则返回 `None`;不抛异常、不记录日志。

**Files:** Modify `server/app/core/captcha.py`、`server/tests/test_captcha_core.py`。

- [ ] **先写失败测试**(辅助 `_solved(challenge) -> str`:用官方 `solve_challenge` 解出后拼成 base64 载荷;`NOW = 1_000_000`):
  - `test_valid_payload_verifies`:返回值非空,`.signature == challenge["signature"]`、`.expires_at == NOW + 300`、`.solve_ms` 是 `int` 且 `0 <= solve_ms <= 600000`。
  - 每一种拒绝各一个测试,都断言 `verify(...) is None`:
    - `test_rejects_none_and_empty`(`None`、`""`、`"   "`);
    - `test_rejects_oversized_header`(4097 字节的合法 base64 字符);
    - `test_rejects_non_base64`(`"!!!"`)与 `test_rejects_non_strict_base64`(中间夹换行);
    - `test_rejects_non_object_json`(`base64("[]")`、`base64("1")`、`base64("not json")`);
    - `test_rejects_wrong_secret`(用另一个 32 字符密钥校验);
    - `test_rejects_tampered_parameters`(改 `cost`、改 `expiresAt`、改 `keyPrefix`,每项各断言一次);
    - `test_rejects_tampered_signature`(末位十六进制字符翻转);
    - `test_rejects_wrong_solution`(`derivedKey` 末位翻转;`counter + 1`);
    - `test_rejects_expired`(`now = NOW + 301`);
    - `test_rejects_missing_expires_at`:用库**不带** `expires_at` 签发一个挑战并正确解出 → `None`(**变异提示:删掉我们自己的 `expiresAt` 必须存在的检查,这个测试必须失败**);
    - `test_rejects_far_future_expiry`:`ttl=1800+61` 签发 → `None`(变异提示:删掉上限检查必须失败);
    - `test_rejects_other_algorithm`:用库签发 `"SHA-256"` 算法的挑战并解出 → `None`(变异提示:删掉算法检查必须失败);
    - `test_rejects_probabilistic_challenge_without_key_signature`:不带 `counter` 签发(无 `keySignature`)并解出 → `None`;
    - `test_rejects_uppercase_or_short_signature`。
  - `test_verify_never_raises`:对 50 个随机字节串(`os.urandom` → base64)调用,全部返回 `None`、无异常。
  - `test_verify_logs_nothing`:`caplog`(`app`,DEBUG)在合法与非法载荷后都为空。
  - `test_comparisons_are_constant_time`:静态检查 `core/captcha.py` 源码里没有对 `signature` / `derivedKey` / `keySignature` 用 `==` 比较(`ast` 扫描 `Compare` 节点里出现这些名字的,断言为 0);签名比较交给库(库用 `hmac.compare_digest`,Task 0 第 7 项已读源码)。
- [ ] **实现**(顺序固定,任何一步失败 `return None`;整个函数体包在 `try/except Exception: return None`):
  1. `header is None or not header.strip()` → None;`len(header.encode()) > MAX_HEADER_BYTES` → None。
  2. `base64.b64decode(header.strip(), validate=True)` → `json.loads` → 必须 `dict`,有 `dict` 型 `challenge`(含 `dict` 型 `parameters`、`str` 型 `signature`)与 `dict` 型 `solution`。
  3. `params["algorithm"] == ALGORITHM`;`isinstance(params.get("keySignature"), str)`;`expires = params.get("expiresAt")` 是 `int`(不是 `bool`)且 `now < expires <= now + MAX_TTL_SECONDS + CLOCK_SKEW_SECONDS`;`re.fullmatch(r"[0-9a-f]{64}", signature)`。
  4. 库 `verify_solution(payload_obj_or_header, hmac_secret, hmac_key_secret=...)`:结果 `verified is True` 且 `expired` 为假。
  5. `solve_ms = max(0, min(600000, int(solution.get("time") or 0)))`(单位按 Task 0 第 9 项)。
  6. `return Verified(signature=signature, expires_at=expires, solve_ms=solve_ms)`(`@dataclass(frozen=True)`;`__repr__` 只显示 `expires_at` 与 `solve_ms`:`field(repr=False)` 用在 `signature` 上)。
- [ ] **测试:** `cd server && uv run pytest -q tests/test_captcha_core.py tests/test_architecture.py`
- [ ] **提交:** `feat(server): strict ALTCHA payload verification`

### Task S4:纯策略 `core/captcha_policy.py`

**Files:** Create `server/app/core/captcha_policy.py`、`server/tests/test_captcha_policy.py`;Modify `server/tests/test_architecture.py`(`STDLIB_ONLY` 追加 `"core/captcha_policy.py"`,注释 `# spec 2026-10-20-captcha-altcha R-C10`)。

- [ ] **先写失败测试**(穷举表):
  - `test_required_table`:对 `mode ∈ {off, adaptive, always}` × `scope ∈ {register, email_code, reset, login}` × `flagged ∈ {False, True}` 共 24 种,断言 `captcha_required(mode, scope, flagged)` 等于:`off` 全假;`adaptive`/`always` 下 `register`、`email_code`、`reset` 全真;`login` 在 `adaptive` 下等于 `flagged`,在 `always` 下全真。
  - `test_unknown_scope_or_mode_raises`:`ValueError`。
  - `test_mode_is_on`:`is_on("off") is False`,另两个为真。
  - `test_policy_module_is_stdlib_only`:由 `test_architecture.py::test_neutral_core_modules_use_the_standard_library_only` 覆盖(追加后跑它)。
- [ ] **实现:** `Mode = Literal["off","adaptive","always"]`、`Scope`(R-C17)、`ALWAYS_SCOPES = frozenset({"register","email_code","reset"})`;`def is_on(mode: str) -> bool`;`def captcha_required(mode: str, scope: str, flagged: bool) -> bool`。只导入 `typing`。
- [ ] **测试:** `cd server && uv run pytest -q tests/test_captcha_policy.py tests/test_architecture.py`
- [ ] **提交:** `feat(server): pure captcha policy (which scope needs a captcha in which mode)`

### Task S5:迁移 `0027_captcha_replay` + 模型 + head 钉子

**Files:** Create `server/alembic/versions/0027_captcha_replay.py`、`server/tests/test_captcha_models.py`;Modify `server/app/models.py`(文件末尾 `# ---- 人机验证 ----` + `CaptchaReplay`)、Global Constraints 列出的 10 处 head 钉子、`server/app/CLAUDE.md`(head `0027`)。

- [ ] **先写失败测试** `tests/test_captcha_models.py`(仿 `tests/test_invites_v2_models.py` 的 `_config` / `_tables` 辅助):
  - `test_head_is_0027_and_follows_0026`:`get_heads() == ["0027"]`,`get_revision("0027").down_revision == "0026"`。
  - `test_round_trip`:`upgrade 0026` → 表不在 → `upgrade 0027` → 表在、列集合 `== {"signature", "expires_at"}`、索引 `ix_captcha_replays_expires_at` 在 → `downgrade 0026` → 表不在 → `upgrade 0027`。
  - `test_signature_is_unique`:同一 `signature` 插两次 → 第二次 `IntegrityError`。
  - `test_no_user_or_ip_columns`:`CaptchaReplay.__table__.columns` 里没有名字含 `user`、`ip` 的列(隐私钉子)。
- [ ] **实现:** `class CaptchaReplay(Base)`:`__tablename__ = "captcha_replays"`;`signature: Mapped[str] = mapped_column(String(64), primary_key=True)`;`expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)`(索引名须与迁移一致:`Index("ix_captcha_replays_expires_at", "expires_at")` 写在 `__table_args__`,不用 `index=True`,以免名字不同)。迁移文档字符串说明「只建新表,两种方言同一路径;降级只丢这张表,丢的是已用过的签名,而它们最多 30 分钟后本来就过期」。
- [ ] **测试:** `cd server && uv run pytest -q tests/test_captcha_models.py tests/test_migrations.py tests/test_accounts_models.py tests/test_avatars_models.py tests/test_changelog_models.py tests/test_invites_v2_models.py tests/test_library_catalog_models.py tests/test_library_models.py tests/test_architecture.py`
- [ ] **提交:** `feat(server): captcha replay table and migration 0027`

### Task S6:防重放服务 `services/captcha_replay.py` + 清理

**Files:** Create `server/app/services/captcha_replay.py`、`server/tests/test_captcha_replay.py`;Modify `server/app/admin/housekeeping.py::purge_expired`、`server/tests/test_housekeeping.py`(第 101 行的字典加 `"captcha_replays": 0`)。

- [ ] **先写失败测试** `tests/test_captcha_replay.py`(用 `app.state.sessionmaker()` 开会话):
  - `test_first_claim_wins_second_loses`:`claim(s, SIG, exp, now)` → `True`;提交;同一 `SIG` 再 `claim` → `False`(**变异提示:把 `insert_ignore` 换成普通 `insert` 并吞掉异常返回 True,这个测试必须失败**)。
  - `test_claim_does_not_commit`:`claim` 之后另开一个会话看不到这一行(调用方负责提交,R-C22);调用方提交后能看到。
  - `test_claim_does_not_break_the_session`:冲突后同一会话还能执行 `select(1)`(`insert_ignore` 不需要回滚)。
  - `test_purge_removes_only_expired`:三行(过期 1 秒、刚好 `now`、未来)→ `purge(s, now)` 返回 1,剩两行(条件是 `expires_at < now`)。
  - `test_housekeeping_purges_captcha_replays`:`housekeeping.purge_expired` 的返回字典有 `captcha_replays` 键且计数正确。
  - `test_service_reads_no_app_state`:静态检查 `services/captcha_replay.py` 源码不含 `app.state`、`request`、`settings`。
- [ ] **实现:** `async def claim(session, signature: str, expires_at: datetime, now: datetime) -> bool`(`insert_ignore(session, CaptchaReplay.__table__).values(signature=signature, expires_at=expires_at)`,返回 `result.rowcount == 1`;`now` 参数保留给日后的就地清理,本期不用,注释说明——**不要**删掉参数);`async def purge(session, now: datetime) -> int`(`delete(...).where(CaptchaReplay.expires_at < now)`,返回 `rowcount or 0`,不提交)。`housekeeping.purge_expired` 调用 `captcha_replay.purge(session, now)` 并在返回字典追加 `"captcha_replays"`(admin → services 允许)。不记录日志。
- [ ] **测试:** `cd server && uv run pytest -q tests/test_captcha_replay.py tests/test_housekeeping.py tests/test_admin_rank_ops.py tests/test_architecture.py`
- [ ] **提交:** `feat(server): single-use captcha signatures with daily purge`

### Task S7:进程内登录失败计数 `core/login_failures.py`

**Files:** Create `server/app/core/login_failures.py`、`server/tests/test_captcha_login_failures.py`;Modify `server/app/main.py`(`app.state.login_failures = LoginFailures(settings.captcha_login_failures, settings.captcha_login_window_minutes * 60)`,放在 `invite_action_limiter` 那行之后;`register_core_listeners` 追加一个监听)。

- [ ] **先写失败测试**(假时钟:`LoginFailures(limit, window, clock=lambda: t[0])`):
  - `test_flags_after_limit_by_ip`:同一 IP、不同名字记 5 次 → `flagged(ip, "other")` 为真;另一个 IP + 新名字为假。
  - `test_flags_after_limit_by_name`:同一名字、5 个不同 IP → `flagged("9.9.9.9", name)` 为真。
  - `test_window_expires`:时钟推进 `window + 1` 后为假。
  - `test_name_key_is_not_plain`:记录名字 `"alice@example.com"` 之后,`repr(vars(counter))` 与内部两个 `RateLimiter._hits` 的所有键里都不含 `"alice"`(变异提示:直接用名字作键必须失败)。
  - `test_two_instances_use_different_keys`:两个实例对同一名字的内部键不同(进程随机密钥)。
  - `test_reconfigure_is_hot`:`reconfigure(limit=2, window=60)` 后 2 次即标记;`main.register_core_listeners` 的监听在 `app.state.settings_hub.publish(...)` 一个 `captcha_login_failures=2` 的新设置后生效(仿 `tests/test_hot_reload.py` 的写法)。
- [ ] **实现:** `class LoginFailures`:`__init__(self, limit: int, window_seconds: float, clock=time.monotonic)`,内部 `self._ip = RateLimiter(limit, window, clock)`、`self._name = RateLimiter(limit, window, clock)`、`self._key = secrets.token_bytes(16)`;`def _name_key(self, name: str) -> str`(`hashlib.blake2b(name.encode(), key=self._key, digest_size=16).hexdigest()`);`def record(self, ip: str, name: str) -> None`(两个 `allow`);`def flagged(self, ip: str, name: str | None) -> bool`(`self._ip.exhausted(ip) or (name is not None and self._name.exhausted(self._name_key(name)))`);`def ip_flagged(self, ip: str) -> bool`;`def reconfigure(self, limit: int, window_seconds: float) -> None`(两个限流器的 `limit`、`window` 一起改)。模块文档写明「进程内,只适用于单 worker(spec R-C6)」。监听:`hub.subscribe("login_failures", lambda o, n: state.login_failures.reconfigure(n.captcha_login_failures, n.captcha_login_window_minutes * 60), keys={"captcha_login_failures", "captcha_login_window_minutes"})`。
- [ ] **测试:** `cd server && uv run pytest -q tests/test_captcha_login_failures.py tests/test_ratelimit.py tests/test_hot_reload.py tests/test_architecture.py`
- [ ] **提交:** `feat(server): in-process login failure counters keyed by IP and hashed login name`

### Task S8:挑战与配置端点 `routers/captcha.py` + 测试辅助

**Files:** Create `server/app/routers/captcha.py`、`server/tests/captcha_helpers.py`、`server/tests/test_captcha_api.py`;Modify `server/app/main.py`(`app.state.captcha_limiter = RateLimiter(settings.captcha_challenges_per_minute)`;监听 `captcha_limiter`;路由列表里 `captcha` 紧跟 `invites_me`,在 `stubs` 之前)。

- [ ] **`tests/captcha_helpers.py`:** `SECRET = "test-captcha-secret-" + "x" * 20`;`def enable_captcha(app, mode="adaptive", **overrides)`(把 `app.state.settings` 换成 `model_copy(update={"captcha_mode": mode, "captcha_secret": SECRET, "captcha_cost": 1, "captcha_counter_max": 10, **overrides})`);`async def header_for(client) -> dict`(`GET /api/captcha/challenge` → 用官方 `solve_challenge` 解出 → `{"X-Captcha": <base64 载荷>}`);`def solve(challenge: dict) -> str`。
- [ ] **先写失败测试** `tests/test_captcha_api.py`:
  - `test_config_reports_mode`:默认 `200 {"mode":"off"}`、`Cache-Control: no-store`;`enable_captcha(app, "always")` 后 `{"mode":"always"}`;热改即时生效。
  - `test_challenge_off_is_404`:`404 {"error":"Captcha is off"}`。
  - `test_challenge_without_secret_is_503`:`captcha_mode="adaptive"`、`captcha_secret=""` → `503 {"error":"Captcha is not configured"}`。
  - `test_challenge_shape_and_no_store`:200;键集合 `{"parameters","signature"}`;`parameters["cost"] == 1`;`expiresAt` ≈ 现在 + 300;`Cache-Control: no-store`;`header_for` 能解出。
  - `test_challenge_rate_limited_per_ip`:`captcha_challenges_per_minute=2` → 第 3 次 `429 {"error":"Too many requests, please try again later"}`。
  - `test_flagged_ip_gets_a_harder_challenge`:monkeypatch `app.core.captcha.pick_counter` 记录调用参数;先让 `app.state.login_failures.record(ip, "x")` 达到阈值 → 下一次签发时 `flagged=True`(测试客户端 IP 用 `client_ip` 的同一来源,`httpx.ASGITransport(client=("1.2.3.4", 123))` 或读 `tests/conftest.py` 的现有做法)。
  - `test_routes_precede_stubs`:`GET /api/captcha/config` 的响应不是 stubs 的 404 形状。
  - `test_no_query_parameters`:两个路由的 `dependant.query_params` 为空(隐私:没有东西进 URL)。
  - `test_challenge_logs_nothing_secret`:`caplog`(`app`,DEBUG)不含 `SECRET`、派生密钥、`nonce`、`signature`。
- [ ] **实现:** `router = APIRouter(prefix="/api/captcha")`;`GET /config` 返回 `JSONResponse({"mode": settings.captcha_mode}, headers={"Cache-Control": "no-store"})`;`GET /challenge`:`off` → `HTTPException(404, CAPTCHA_OFF)`;无密钥 → `HTTPException(503, CAPTCHA_NOT_CONFIGURED)`;`request.app.state.captcha_limiter.allow(client_ip(request))` 为假 → 429(现有文案);`counter = captcha.pick_counter(s.captcha_counter_max, s.captcha_flagged_multiplier, request.app.state.login_failures.ip_flagged(ip))`;`body = await asyncio.to_thread(captcha.issue, s.captcha_secret, cost=s.captcha_cost, counter=counter, ttl=s.captcha_ttl_seconds, now=int(time.time()))`;返回 `no-store`。错误常量从 `app.routers.captcha_guard` 导入——**本任务先建 `captcha_guard.py`,只放四个常量**(S9 再加 `enforce`)。
- [ ] **测试:** `cd server && uv run pytest -q tests/test_captcha_api.py tests/test_stubs.py tests/test_architecture.py`
- [ ] **提交:** `feat(server): GET /api/captcha/config and /api/captcha/challenge`

### Task S9:`captcha_guard.enforce()`(安全关键)

**Files:** Modify `server/app/routers/captcha_guard.py`;Create `server/tests/test_captcha_guard.py`。

- [ ] **先写失败测试**(建一个只在测试里挂的小路由:`POST /test-captcha/{scope}`,处理函数里 `await captcha_guard.enforce(request, session, scope, flagged=flagged_query_param_free)`——`flagged` 用 `app.state` 上的测试开关传入,不进 URL;或直接单测 `enforce` 并用 `starlette.requests.Request` 构造请求):
  - `test_off_mode_never_checks`:`off` 时不带头 / 带垃圾头都放行,`captcha_replays` 无行。
  - `test_not_required_ignores_header`:`adaptive` + `login` + `flagged=False` + 合法头 → 放行,**无认领行**(spec §6.3 第 1 步)。
  - `test_missing_secret_fails_closed`:`adaptive` + 空密钥 + `register` → `503 Captcha is not configured`;`off` + 空密钥 → 放行(变异提示:把 503 分支删掉必须失败)。
  - `test_missing_header_is_captcha_required`:`428 {"error":"captcha_required"}`(空串、只有空白同样)。
  - `test_bad_header_is_captcha_invalid`:垃圾 → `428 {"error":"captcha_invalid"}`。
  - `test_valid_header_passes_once`:第一次放行并有一行认领(已提交:另开会话可见);同一头第二次 → `428 captcha_invalid`(**变异提示:去掉 `claim` 调用,这个测试必须失败**)。
  - `test_forged_payload_writes_nothing`:签名错的头 → 428 且 `captcha_replays` 0 行(先校验后写库)。
  - `test_expired_header_is_invalid`:monkeypatch `time.time` 推进 301 秒。
  - `test_header_from_other_secret_is_invalid`。
  - `test_timing_line_numbers_only`:`caplog` 收 `app.timing`,成功后有且只有一行 `timing event=captcha_verify scope=register solve_ms=<数字>`,不含签名、载荷。
  - `test_guard_logs_no_payload`:`caplog`(`app`,DEBUG)对成功与每种失败都不含载荷、签名、`nonce`、密钥。
- [ ] **实现:**
  ```python
  async def enforce(request: Request, session: AsyncSession, scope: Scope, *, flagged: bool = False) -> None:
      s = request.app.state.settings
      if not captcha_required(s.captcha_mode, scope, flagged):
          return
      if not s.captcha_secret:
          raise HTTPException(503, CAPTCHA_NOT_CONFIGURED)
      header = request.headers.get(HEADER)
      if header is None or not header.strip():
          raise HTTPException(428, CAPTCHA_REQUIRED)
      ok = captcha.verify(s.captcha_secret, header, now=int(time.time()))
      if ok is None:
          raise HTTPException(428, CAPTCHA_INVALID)
      if not await captcha_replay.claim(session, ok.signature, datetime.fromtimestamp(ok.expires_at, timezone.utc), utcnow()):
          raise HTTPException(428, CAPTCHA_INVALID)
      await session.commit()  # R-C14 / R-C22: used up now, whatever the endpoint does next
      timing_logger.info("timing event=captcha_verify scope=%s solve_ms=%d", scope, ok.solve_ms)
  ```
  计时行沿用 `core/timing.py` 的 logger(`app.timing`;读该文件选用现成的辅助函数,没有就用 `logging.getLogger("app.timing")`)。模块文档:「不是路由(同 `live_connections.py`);路由在处理函数里显式调用(spec R-C9)」。
- [ ] **测试:** `cd server && uv run pytest -q tests/test_captcha_guard.py tests/test_captcha_core.py tests/test_architecture.py`
- [ ] **提交:** `feat(server): captcha guard (fail closed, single use, no payload in logs)`

### Task S10:接入三个账号端点(`account.py`)

**Files:** Modify `server/app/routers/account.py`(三处,各一行 `await captcha_guard.enforce(...)`;导入 `from app.routers import captcha_guard`);Create `server/tests/test_captcha_account_endpoints.py`。

- [ ] **位置(逐字):**
  - `email_code`:在 `if not email_ready(settings): raise HTTPException(503, "Email is not configured")` 之后、`if not request.app.state.email_ip_limiter.allow(...)` 之前 → `await captcha_guard.enforce(request, session, "email_code")`。
  - `me_email_code`:在 `email_ready` 检查之后、`purpose = _bind_purpose(...)` 之前 → 同上 `"email_code"`。
  - `reset_password`:在 `email_ready` 检查之后、`password_hash = await asyncio.to_thread(hash_password, ...)` 之前 → `"reset"`。
- [ ] **先写失败测试**(`enable_email(app)` 来自 `tests/accounts_helpers.py` + `enable_captcha(app, "adaptive")`):
  - 每个端点各三条:无头 → `428 captcha_required`;垃圾头 → `428 captcha_invalid`;`header_for(client)` → 原有的成功响应(`email_code`:`200 {"ok":true,"cooldown_seconds":60}`;`me_email_code`:200;`reset`:按 `tests/test_accounts_reset.py` 的流程 204)。
  - `test_unsolved_requests_do_not_spend_the_ip_email_budget`:`email_codes_per_ip_hourly=1`;两次无头请求(428)之后,一次带头请求仍 200(变异提示:把 `enforce` 挪到 `email_ip_limiter` 之后必须失败)。
  - `test_reset_hashes_no_password_without_captcha`:monkeypatch `app.routers.account.hash_password` 计数;无头请求后计数为 0。
  - `test_me_email_code_checks_captcha_before_password`:`change_email` 场景,无头 + 错密码 → 428(不是 403 `Wrong password`)。
  - `test_off_mode_unchanged`:`captcha_mode="off"` 时三个端点不带头照常成功。
  - `test_logs_no_payload`:`caplog`。
- [ ] **测试:** `cd server && uv run pytest -q tests/test_captcha_account_endpoints.py tests/test_accounts_email_code.py tests/test_accounts_reset.py tests/test_accounts_bind.py tests/test_architecture.py`
- [ ] **提交:** `feat(server): captcha on email code requests and password reset`

### Task S11:接入注册(`sessions.py::register`)

**Files:** Modify `server/app/routers/sessions.py`(一行;导入 `captcha_guard`);Create `server/tests/test_captcha_register.py`。

- [ ] **位置(逐字):** 在 `if settings.email_registration_required: _require_email_fields(payload, settings)` 之后、`# a nickname may equal this account's own new login name` 那条注释之前 → `await captcha_guard.enforce(request, session, "register")`。
- [ ] **先写失败测试**(`enable_captcha(app, "adaptive")`):
  - 旧注册方式(`make_settings` 默认 `email_registration_required=False`):无头 → `428 captcha_required`;带头 → 200 且有 `access_token`。
  - `test_closed_registration_answers_first`:`registration_mode="closed"` + 无头 → `403 Registration is closed`。
  - `test_desktop_friendly_message_answers_first`:`email_registration_required=True` + 无 `email` + 无头 → `400 {"error":"Email verification required: please register in the web app"}`(spec §12 的桌面端结论;变异提示:把 `enforce` 挪到 `_require_email_fields` 之前必须失败)。
  - `test_no_password_hash_without_captcha`:monkeypatch `app.routers.sessions.hash_password` 计数为 0。
  - `test_email_registration_with_captcha`:`enable_email` + 开关开:先 `email/code`(带头)、再注册(**新的**头)→ 200;复用第一次的头 → `428 captcha_invalid`。
  - `test_username_taken_still_burns_the_captcha`:409 之后同一头再用 → 428(R-C14)。
  - `test_logs_no_payload`。
- [ ] **测试:** `cd server && uv run pytest -q tests/test_captcha_register.py tests/test_auth.py tests/test_accounts_register.py tests/test_invites.py tests/test_architecture.py`
- [ ] **提交:** `feat(server): captcha on registration after the desktop-visible checks`

### Task S12:接入登录(自适应)与失败计数

**Files:** Modify `server/app/routers/sessions.py::login`(加 `request: Request` 参数;两处);Create `server/tests/test_captcha_login.py`。

- [ ] **实现(逐字位置):**
  - 在 `typed = payload.username.strip().lower()` 之后插入:`ip = client_ip(request)`、`name_key = _failure_name(typed)`(本文件内的小函数,R-C21)、`await captcha_guard.enforce(request, session, "login", flagged=request.app.state.login_failures.flagged(ip, name_key))`。
  - 两处 `raise HTTPException(401, INVALID_LOGIN)` 之前各加 `request.app.state.login_failures.record(ip, name_key)`。`403 Account disabled` 与 428 **不**计数。
- [ ] **先写失败测试**(`enable_captcha(app, "adaptive", captcha_login_failures=3)`):
  - `test_login_free_until_flagged`:错密码 3 次(401)→ 第 4 次正确密码不带头 → `428 captcha_required`;带头 → 200。
  - `test_unknown_names_flag_the_same_way`:不存在的用户名错 3 次 → 第 4 次 428(**变异提示:只在用户存在时 `record` 必须让这个测试失败**——这是防枚举钉子)。
  - `test_name_flag_follows_the_name_across_ips`:同一名字从 3 个不同 IP 各错 1 次 → 第 4 个 IP 上该名字 428,另一个名字 200。
  - `test_email_variants_share_a_key`:`A@Example.com ` 与 `a@example.com` 的失败计到同一个键(R-C21)。
  - `test_always_mode_requires_captcha_for_every_login`:`enable_captcha(app, "always")` → 首次登录无头即 428(R-C1)。
  - `test_off_mode_never_flags`:`off` 下错 10 次后正确密码不带头仍 200。
  - `test_captcha_failure_is_not_counted`:被标记后发 5 次垃圾头(428)→ 计数不增加(断言 `login_failures._ip` 的命中数不变)。
  - `test_desktop_login_shape_unchanged`:`{"provider":"password","username":"alice","password":"..."}` 在 `adaptive` 未标记时 200,响应形状与现有 `tests/test_auth.py` 一致。
  - `test_login_logs_no_payload_or_name`:`caplog` 不含载荷、用户名、密码。
- [ ] **测试:** `cd server && uv run pytest -q tests/test_captcha_login.py tests/test_accounts_login.py tests/test_auth.py tests/test_architecture.py`
- [ ] **提交:** `feat(server): adaptive captcha on login after repeated failures`

### Task S13:契约夹具

**Files:** Create `server/tests/test_captcha_contract.py`、`server/tests/fixtures/captcha_contract.json`。

- [ ] **先写失败测试**:驱动真实请求录制键 `config_off`、`config_adaptive`、`challenge`(值里的 `nonce`、`salt`、`keyPrefix`、`keySignature`、`signature` 写 `"REDACTED"`,`expiresAt` 固定 `0`)、`error_required`、`error_invalid`、`error_not_configured`、`error_off`;`CONTRACT_UPDATE=1` 重录,否则比较(沿用 `tests/test_accounts_contract.py` 的做法)。断言夹具文本不含测试密钥、任何真实 `nonce` / `signature`。
- [ ] **测试:** `cd server && CONTRACT_UPDATE=1 uv run pytest -q tests/test_captcha_contract.py && uv run pytest -q tests/test_captcha_contract.py`
- [ ] **提交:** `test(server): captcha contract fixture`

### Task S14:隐私总扫

**Files:** Create `server/tests/test_captcha_privacy_sweep.py`。

- [ ] **先写失败测试**:一个测试跑完整流程(取配置 → 取挑战 → 发注册码 → 注册 → 登录失败到被标记 → 带头登录 → 发重置码 → 重置 → 绑定发码 → 重放一次 → 无密钥的 503 → 清理),全程 `caplog`(`app` 与 `app.timing`,DEBUG)+ 收集所有响应体 + `captcha_replays` 以外的所有审计 / 设置修订行 + `log_buffer` 内容,断言其中都不出现:每个用过的 `X-Captcha` 值、其中的 `signature`、`nonce`、`salt`、`derivedKey`、`CAPTCHA_SECRET`、两把派生密钥、测试用户名与密码;断言所有新路由的路径里没有查询参数。语料非空检查(至少收集到 3 个 428 响应体)。
- [ ] **测试:** `cd server && uv run pytest -q tests/test_captcha_privacy_sweep.py`
- [ ] **提交:** `test(server): captcha privacy sweep`

---

## A 车道 · 管理端(服务端)

### Task A1:配置诊断

**Files:** Modify `server/app/admin/doctor.py`(`CODES` 追加三个;新函数 `_captcha_findings(s)`,在 `diagnose` 里紧跟 `_email_findings` 调用)、`server/tests/test_admin_doctor.py`。

- [ ] **先写失败测试:**
  - `test_captcha_secret_missing_is_an_error`:`captcha_mode="adaptive"`、无密钥 → `error` `captcha_secret_missing`,`keys == ("captcha_mode", "captcha_secret")`;有密钥则无。
  - `test_captcha_always_warns_about_desktop`:`always` → `warn` `captcha_always_blocks_desktop`。
  - `test_captcha_without_proxy_headers_warns`:开着且 `trust_proxy_headers=False` → `warn` `captcha_without_proxy_headers`;`off` 时三条都没有。
  - 现有 `test_email_diagnostic_codes_are_registered_and_messages_hold_no_values` 的写法复制一份给三条新码:码在 `CODES` 里,消息不含测试密钥。
- [ ] **消息(中文,只写键名):** `captcha_secret_missing`:「已开启人机验证,但没有设置 CAPTCHA_SECRET:注册、发验证码与找回密码全部返回 503」;`captcha_always_blocks_desktop`:「CAPTCHA_MODE=always:桌面端无法登录;生产环境请用 adaptive」;`captcha_without_proxy_headers`:「已开启人机验证但未信任代理头:经反向代理时所有用户共用一个 IP,登录失败计数会波及所有人」。
- [ ] **测试:** `cd server && uv run pytest -q tests/test_admin_doctor.py`
- [ ] **提交:** `feat(server): config doctor findings for the captcha`

### Task A2:危险方向规则

**Files:** Modify `server/app/admin/settings_service.py::danger_reasons` 的 `rules` 字典;Modify `server/tests/test_admin_settings_service.py`。

- [ ] **先写失败测试:** `danger_reasons("captcha_mode", "off", "adaptive")` 非空(任何改动);`captcha_cost` 5000→1000 非空、1000→5000 为空;`captcha_counter_max` 同理;`captcha_login_failures` 5→10 非空、10→5 为空。
- [ ] **实现:** `"captcha_mode": True`、`"captcha_cost": _up(new, old)`、`"captcha_counter_max": _up(new, old)`、`"captcha_login_failures": _up(old, new)`(注释 `# captcha: only the weakening direction`)。
- [ ] **测试:** `cd server && uv run pytest -q tests/test_admin_settings_service.py tests/test_admin_settings_api.py`
- [ ] **提交:** `feat(server): confirm weakening captcha settings in the admin console`

---

## W 车道 · 网页

### Task W1:主包基线、`ApiClient` 与错误文案

**Files:** Modify `web/scripts/main-bundle-baseline.json`(Step 0 单独提交)、`web/src/api/client.ts`、`web/src/api/types.ts`、`web/src/api/error-messages.ts`、`web/src/i18n/en.json`、`web/src/i18n/zh-CN.json`、`web/src/api/client.test.ts`、`web/src/api/error-messages.test.ts`。

- [ ] **Step 0:** `yarn web:build && node web/scripts/check-main-bundle.mjs --record`,单独提交 `chore(web): record the main bundle baseline before the captcha`(数字只写进 PR 描述与本计划「执行结果」)。
- [ ] **先写失败测试**(`~/test/fetch-mock`):
  - `RequestOptions.captcha` 存在时请求带 `X-Captcha: <值>`,**不**出现在 URL 与 JSON 体里;不存在时没有该头。
  - `login("alice", "pw", "P")` 发 `X-Captcha: P`,体仍是 `{provider, username, password}`;`register(input, "P")` 同理且体里没有 `captcha` 键。
  - `captchaConfig()` 发 `GET /api/captcha/config`、`auth:false`,解析 `{mode}`。
  - 428 + `captcha_required` 得到 `ApiError(428, "captcha_required")`,**不**调用 `onUnauthorized` / `onBindingRequired`。
  - `translateServerError`:`captcha_required` → `web.errors.captchaRequired`、`captcha_invalid` → `web.errors.captchaInvalid`、`Captcha is not configured` → `web.errors.captchaNotConfigured`。
- [ ] **实现:** `RequestOptions` 加 `captcha?: string`;`request()` 里 `if (opts.captcha) headers["X-Captcha"] = opts.captcha`;`login(username, password, captcha?)`;`register(input, captcha?)`;`captchaConfig(): Promise<CaptchaConfig>`(`types.ts`:`export type CaptchaMode = "off" | "adaptive" | "always"; export interface CaptchaConfig { mode: CaptchaMode }`)。文案(中 / 英):`captchaRequired`「请先完成人机验证。」/ "Please complete the verification first.";`captchaInvalid`「人机验证已失效,请重试。」/ "Verification expired or failed. Please try again.";`captchaNotConfigured`「服务器暂未配置人机验证,请联系管理员。」/ "Verification is not configured on this server."。
- [ ] **测试:** `cd web && yarn vitest run src/api src/i18n`
- [ ] **提交:** `feat(web): send the captcha payload in X-Captcha and map captcha errors`

### Task W2:组件本体与懒加载外壳(`components/captcha/`)

**Files:** Modify `web/package.json`、`yarn.lock`(`yarn workspace web add altcha@3.4.1 --exact`);Create `web/src/components/captcha/{index.ts,captcha-field.tsx,captcha-widget.tsx,locales.ts,locales/en.json,locales/zh-CN.json,CLAUDE.md,captcha-field.test.tsx,captcha-widget.test.tsx}`。

- [ ] **先写失败测试**(`vi.mock("altcha", () => ({}))` 与语言包同样 mock;jsdom 里 `altcha-widget` 只是未知元素,测试直接派发 `CustomEvent`):
  - `captcha-widget.test.tsx`:渲染出 `<altcha-widget>`,属性 `challenge="/api/captcha/challenge"`、`auto="off"`、`language` 为 `zh-cn`(当前语言 `zh-CN`)或 `en`;派发 `verified`(`detail: {payload: "P"}`)→ `onPayload("P")`;派发 `expired` → `onPayload(null)`;`statechange` 的 `state: "error"` → `onPayload(null)` 并显示 `web.captcha.failed`;`ref.current.reset()` 调用元素的 `reset()`,`reset({again: true})` 之后调用 `verify()`。
  - `test_insecure_context`:`Object.defineProperty(window, "isSecureContext", {value: false})` → 不渲染 `<altcha-widget>`,显示 `role="alert"` 的 `web.captcha.insecureContext`。
  - `captcha-field.test.tsx`:外壳在挂载前不导入组件模块(`vi.mock` 计数工厂调用次数为 0),渲染后才加载;Suspense 占位有 `aria-busy="true"`。
  - 无障碍:容器有 `role="group"` 与 `aria-label`(`web.captcha.label`)。
  - 不写 `localStorage`(spy)。
- [ ] **实现:**
  - `captcha-widget.tsx` 顶部 `import "altcha";` 与两个语言包(路径按 Task 0 第 12 项);`import "./locales";`。元素加载后(`load` 事件)调用 `el.configure({ hideFooter: true })`。暴露 `forwardRef<CaptchaHandle>`:`reset(opts?: {again?: boolean})`。TS:在本文件声明 `JSX.IntrinsicElements["altcha-widget"]`。
  - `captcha-field.tsx`:`const Widget = lazy(() => import("./captcha-widget"))`;`isSecureContext` 检查在外壳里做(不安全时连组件分块都不加载)。
  - `locales.ts`:`ensureCaptchaI18n()`(仿 `features/account/locales.ts`:`addResourceBundle(lang, "translation", json, true, false)`,只执行一次);键 `web.captcha.{label,insecureContext,failed,loading}`,中英齐全;英文在 360 px 不溢出(长说明换行)。
  - `index.ts` 只导出 `CaptchaField`、`type CaptchaHandle`、`useCaptchaGate`(W3)。
  - `CLAUDE.md`:作用、允许的依赖(`~/api` 类型、`~/i18n`、`~/lib`)、「组件按 `challenge` URL 同源自取挑战,这是 `ApiClient` 之外唯一的请求,不带任何用户数据」、非安全上下文规则、测试命令。
- [ ] **测试:** `cd web && yarn typecheck && yarn vitest run src/components/captcha src/architecture.test.ts`
- [ ] **提交:** `feat(web): lazy ALTCHA widget in the shared components layer`

### Task W3:`useCaptchaGate(api, scope)`

**Files:** Create `web/src/components/captcha/use-captcha-gate.ts`、`use-captcha-gate.test.tsx`。

- [ ] **先写失败测试:**
  - 挂载时调 `api.captchaConfig()` 一次;`mode="off"` → `needed === false`;`adaptive` 下 `scope="register"` → `true`、`scope="login"` → `false`;`always` 下 `login` → `true`。
  - `onServerError(new ApiError(428, "captcha_required"))` 返回 `true`、`needed` 变 `true`、`payload` 变 `null`;别的错误返回 `false`、状态不变。
  - `consumed()`:`payload` 变 `null` 并调用 `handle.reset({again: needed})`。
  - `ready`:`needed && payload !== null` 或 `!needed`。
  - 配置请求失败(网络错误)→ 按 `off` 处理(服务端仍会用 428 兜底),不抛。
- [ ] **实现:** 返回 `{ needed, ready, payload, setPayload, handleRef, onServerError, consumed }`;`scope` 类型 `"register" | "email_code" | "reset" | "login"`(与服务端 R-C17 同名)。
- [ ] **测试:** `cd web && yarn vitest run src/components/captcha`
- [ ] **提交:** `feat(web): captcha gate hook (mode probe, 428 fallback, single-use payloads)`

### Task W4:注册页

**Files:** Modify `web/src/features/account/signup-page.tsx`、`email-code-field.tsx`(加可选 `captcha?: string` 与 `onCaptchaUsed?(err?: unknown)` 两个属性,发码时传给 API)、`account-api.ts`(`requestEmailCode`、`requestBindCode` 加可选最后参数 `captcha?: string`)、`signup-page.test.tsx`、`email-code-field.test.tsx`。

- [ ] **先写失败测试:**
  - `mode="off"`:页面不渲染组件,流程与现在完全一样(现有测试全绿)。
  - `mode="adaptive"`:组件渲染在「发送验证码」按钮之上;未验证就点发送 → 不发请求,显示 `web.errors.captchaRequired`;派发 `verified` 后点发送 → `POST /api/email/code` 带 `X-Captcha`;之后 `consumed()` 被调用;第二步「创建账号」用**新的**载荷(派发第二次 `verified`)发 `POST /api/users` 带 `X-Captcha`。
  - 服务端回 `428 captcha_invalid` → 显示 `web.errors.captchaInvalid`,组件重置。
  - 载荷不进 `localStorage`、不进 URL。
- [ ] **实现:** `const gate = useCaptchaGate(api, "register")`;发码用 `scope` 无关(同一个 gate,载荷一次一用);`register(input, gate.payload ?? undefined)`;每次请求返回后 `gate.consumed()`;`catch` 里先 `if (gate.onServerError(err))` 再走原有的 `translateServerError`。
- [ ] **测试:** `cd web && yarn vitest run src/features/account src/architecture.test.ts`
- [ ] **提交:** `feat(web): captcha on the sign-up page`

### Task W5:找回密码页

**Files:** Modify `web/src/features/account/forgot-password-page.tsx`、`account-api.ts`(`resetPassword` 加 `captcha?`)、`forgot-password-page.test.tsx`。

- [ ] **先写失败测试:** 同 W4 的四条,两步分别是 `POST /api/email/code`(`purpose: "reset"`)与 `POST /api/password/reset`,各带新载荷;成功后仍跳 `/login`(`notice: "passwordReset"`)。
- [ ] **测试:** `cd web && yarn vitest run src/features/account`
- [ ] **提交:** `feat(web): captcha on the forgot-password page`

### Task W6:绑定 / 换绑邮箱页

**Files:** Modify `web/src/features/account/bind-email-page.tsx`、`bind-email-page.test.tsx`。

- [ ] **先写失败测试:** 只有「发送验证码」(`POST /api/me/email/code`)需要载荷;`POST /api/me/email` **不带** `X-Captcha`;`mode="off"` 时无组件;428 兜底同 W4。
- [ ] **测试:** `cd web && yarn vitest run src/features/account`
- [ ] **提交:** `feat(web): captcha on email binding code requests`

### Task W7:登录页与 `AuthProvider`

**Files:** Modify `web/src/pages/login-page.tsx`、`web/src/auth/auth-context.tsx`(`login(username, password, captcha?)`、`register(input, captcha?)` 透传)、`web/src/pages/login-page.test.tsx`、`web/src/auth/auth-context.test.tsx`。

- [ ] **先写失败测试:**
  - `mode="adaptive"`:初始不渲染组件;一次登录得到 `428 captcha_required` → 显示组件与 `web.errors.captchaRequired`;派发 `verified` 后再登录带 `X-Captcha` → 成功跳转。
  - `mode="always"`:初始即渲染组件。
  - `mode="off"`:无组件,现有测试全绿。
  - `auth-context`:`login` 第三参透传到 `api.login`;`register` 第二参透传。
- [ ] **实现注意:** 登录页在主包里,只导入 `~/components/captcha` 的懒加载外壳与 hook(分块里才有组件)。
- [ ] **测试:** `cd web && yarn typecheck && yarn vitest run src/pages src/auth src/architecture.test.ts`
- [ ] **提交:** `feat(web): adaptive captcha on the login page`

### Task W8:契约测试、主包实测、文档

**Files:** Create `web/src/features/account/captcha-contract.test.ts`(读 `server/tests/fixtures/captcha_contract.json`,逐键检查 `CaptchaConfig` 与错误字符串和 W1 的映射一致);Modify `web/src/components/CLAUDE.md`(列出 `captcha/`)、`web/README.md`(行为与未验证项:真机、非安全上下文)。

- [ ] **主包:** `yarn web:build && node web/scripts/check-main-bundle.mjs --max-delta=0.6`;**实测**主包增量与组件分块(`web/dist/assets/` 里包含 `altcha` 的分块,`gzip -9` 后的字节数)写进 PR 描述与本计划「执行结果」。超预算:停下报告,不放宽。
- [ ] **测试:** `cd web && yarn typecheck && yarn vitest run src/features/account src/components/captcha src/i18n src/architecture.test.ts`
- [ ] **提交:** `test(web): captcha contract test and bundle notes`

---

## E 车道 · 端到端

### Task E1:求解辅助与规格

**Files:** Create `web/e2e/support/captcha.ts`、`web/e2e/captcha.spec.ts`;Modify `web/e2e/support/upstream-guard.ts`(`OWN_ACCOUNT` 加 `captcha\/(config|challenge)`)、`web/src/test/e2e-upstream-guard.test.ts`(两条新路径放行)、`web/e2e/CLAUDE.md`(列出新规格与「只在一次性栈运行」)。

- [ ] **`support/captcha.ts`:** `export async function captchaHeader(request: APIRequestContext): Promise<Record<string, string>>`:`GET /api/captcha/challenge` → `execFileSync("docker", ["exec", "-i", CONTAINER, "python", "-c", PY], {input: JSON.stringify(challenge)})`,`PY` 用容器里的官方库 `altcha.solve_challenge` 解出并打印 base64 载荷 → `{"X-Captcha": out}`。文件头注释照抄 `support/accounts.ts` 的警示(只用于一次性栈;难度由栈覆盖调到最小)。载荷不打印到测试输出。
- [ ] **`captcha.spec.ts`(`--project=chromium-mobile`;零上游):**
  - API:`POST /api/email/code` 无头 → 428 `captcha_required`;垃圾头 → 428 `captcha_invalid`;`captchaHeader` → 200;同一头重放 → 428 `captcha_invalid`。
  - UI 注册:`/register` 出现组件 → 点击复选框 → 等待「已验证」状态(用组件的可访问名或 `statechange` 后的 DOM,选择器按 Task 0 第 11 项)→ 发码 → `codeFor` → 第二步自动重新验证 → 创建账号成功。
  - UI 登录(栈为 `always`):`/login` 直接出现组件;验证后登录成功。
  - UI 找回密码:两步都过验证。
  - 页面文本与网络请求 URL 里没有载荷。
- [ ] **测试:** `cd web && yarn typecheck && yarn vitest run src/test/e2e-upstream-guard.test.ts && E2E_INVITE_CODE=dummy npx playwright test e2e/captcha.spec.ts --list`
- [ ] **提交:** `test(web): captcha e2e spec with a container-side solver`

### Task E2:在一次性栈上运行(只在用户要求时)

- [ ] 覆盖文件放会话 scratchpad(R-C24),在 accounts 一次性栈的覆盖基础上加 `CAPTCHA_MODE=always`、一次性 `CAPTCHA_SECRET`、`CAPTCHA_COST=1`、`CAPTCHA_COUNTER_MAX=10`;`docker compose -p enjoy-e2e ... up -d --build --wait`;`yarn web:e2e --project=chromium-mobile e2e/captcha.spec.ts`;结束后 `down -v`。结果写进 `docs/superpowers/plans/e2e-results.md`(新一节;未在 webkit 上跑的标「未验证」)。
- [ ] **提交:** `docs: captcha e2e results`

---

## Z 车道 · 实测、文档、评审

### Task Z1:实测(数字只来自这里)

- [ ] **服务端签发耗时:** 在开发机上 `cd server && uv run python -c "..."` 用 `core.captcha.issue` 对 `cost ∈ {1000, 5000, 10000}` 各签发 50 次取中位数(写清 CPU 型号);容器里同样测一次(用户要求起栈时)。
- [ ] **浏览器解题耗时:** 本机 `yarn web:dev` + 服务端 `CAPTCHA_MODE=adaptive`,浏览器窗格(Chromium,桌面与 375×812 模拟)在注册页对 `(cost, counter_max) ∈ {(5000, 10000), (5000, 5000), (1000, 10000)}` 各解 5 次,读 `app.timing` 的 `solve_ms`;**标「桌面浏览器 / 模拟」,不是真机**。
- [ ] **真机:** 列出要用户在自己的 iPhone / 安卓上做的步骤(上线后 `adaptive` 下注册一次,读 `solve_ms`);本任务不得填写真机数字。
- [ ] **组件分块大小与第三方请求:** `gzip -9` 实测分块字节数;浏览器窗格网络面板确认解题期间没有任何非本站请求。
- [ ] 根据实测给出 `CAPTCHA_COST` / `CAPTCHA_COUNTER_MAX` 的建议值(写进「执行结果」;改默认值需另开任务并经用户同意)。
- [ ] **提交:** `docs: captcha measurements`

### Task Z2:文档

**Files:** Modify `server/README.md`(在「## 注册保护」之后新增「## 人机验证(ALTCHA)」,内容照 spec §11 + §12 + §15 的要点;nginx 示例原样标「示例、未在真实 1Panel 上验证」)、`server/app/CLAUDE.md`(core 行加 captcha 三个模块;迁移头已在 S5 改)、`server/app/core/CLAUDE.md`、`server/app/services/CLAUDE.md`、`server/app/routers/CLAUDE.md`(`captcha`、`captcha_guard` 不是路由、五个调用点)、`server/tests/CLAUDE.md`(`captcha_helpers.py`、`test_captcha_*`、夹具)、`server/app/admin/CLAUDE.md`(三条诊断);本计划末尾「执行结果」。

- [ ] 跑本计划全部定向测试 + `tests/test_architecture.py`、`web/src/architecture.test.ts`;**全量只在用户要求时**。
- [ ] 「执行结果」:每个车道的定向测试数、主包与分块实测、Z1 的数字、未验证项。
- [ ] **提交:** `docs: captcha setup, limits and results`

### Task Z3:评审波(合并前)

- [ ] `/code-review high` + `security-review`,重点见「并行车道与合并顺序」;每个阻断项修复后补测试。
- [ ] 变异抽查(手工,改完即还原,不提交):逐个删掉 S3 的 `expiresAt` 必须存在 / 上限 / 算法 / `keySignature` 检查,S9 的 `claim` 调用与 503 分支,S12 的「未知用户名也计数」,确认对应测试变红。结果写进 PR 描述。
- [ ] 浏览器窗格检查(见上);结论标「模拟」。

---

## 未验证(本计划范围)

真机解题耗时(iOS Safari、安卓 Chrome、低端机);真实 1Panel / OpenResty 上的 `limit_req` / `limit_conn` 示例;多 worker 下的进程内失败计数;Postgres 上的 `0027`(只有 `create_table`,风险低但未跑);组件的无障碍(读屏、键盘)与 WCAG 声明;非安全上下文下的提示在真机上的表现;桌面端 `enjoy/` 收到 `captcha_required` 时的实际显示(未运行);官方库与组件今后版本的格式兼容。

## 执行结果

**W8(2026-10-20,`yarn web:build` + `node web/scripts/check-main-bundle.mjs --max-delta=0.65`,gzip -9,kB = 1000 字节):**
- 主包(入口 + modulepreload):412.29 kB gzip,相对基线 411.67 kB 增量 **+0.62 kB**(预算 0.65 kB,由协调者修订;通过)。
- 组件分块 `captcha-widget-*.js`(altcha + 语言包):**40.75 kB gzip**(原始 128.47 kB);外壳分块 `captcha-field-*.js`:**0.90 kB gzip**(原始 1.52 kB)。
- 未验证:真机解题耗时、深色模式、360–375 px 布局(见 spec §10 与 `web/README.md`)。

(执行者填写)

**Z1 实测(2026-10-20,UTC 09:04 起,约 6 分钟;数字只来自下面的脚本输出;真机未测,凡是真机相关全部「未验证」):**

- **机器:** Intel(R) Core(TM) i5-14400(10 核 / 16 线程;WMI `MaxClockSpeed` 2500 MHz);内存 31.73 GB;Windows 11 专业版 build 22621;Python 3.12.14;`altcha` 2.3.0(`server\.venv`);Chromium **134.0.6998.35**(Playwright 自带);容器内 `nproc` 同为 16。
- **测试栈:** `http://localhost:8100`(`enjoy-e2e-server-1`);`captcha_challenges_per_minute` 为栈的覆盖值 1000。测量结束后已恢复:`captcha_mode=off`、`captcha_cost=1`、`captcha_counter_max=10`(管理端读回核对),`/api/captcha/config` 为 `{"mode":"off"}`。

**方法:**

1. **服务端签发:** 直接调用 `app.core.captcha.issue`(本机 venv 与容器内 `/app/.venv`),counter 固定 5000;cost 1000 / 5000 / 10000 各 50 次,100000 为 5 次;单位毫秒。
2. **浏览器解题:** 临时 Playwright 规格(已删除、未提交);`captcha_mode=adaptive`,每次新加载 `/register`,勾选组件,从 click 到 `verified` 事件的 `performance.now()` 差值;每组 5 次。「桌面」为 1280×800;「模拟」为 Pixel 7 设备配置 + CDP `Emulation.setCPUThrottlingRate` 4 倍,**只是近似,不是真机**。
3. **服务端自报 `solve_ms`:** 每次解出的载荷发送一次到 `POST /api/password/reset`(错误的验证码 → 400,不发信)。服务端写的 `captcha_verify` 行用 `docker logs --since` 只抓这一个事件。30 次全部返回 400(即验证通过、随后因验证码错误失败),没有 428 / 429。

**表 1 服务端签发耗时(ms,counter 5000):**

| cost | 位置 | n | 中位数 | 最小 | 最大 |
|---|---|---|---|---|---|
| 1000 | 本机 | 50 | 0.36 | 0.35 | 5.97 |
| 5000 | 本机 | 50 | 1.59 | 1.42 | 2.16 |
| 10000 | 本机 | 50 | 3.16 | 2.85 | 4.08 |
| 100000 | 本机 | 5 | 31.18 | 30.10 | 32.00 |
| 1000 | 容器 | 50 | 0.18 | 0.17 | 1.49 |
| 5000 | 容器 | 50 | 1.11 | 0.70 | 5.00 |
| 10000 | 容器 | 50 | 2.14 | 1.36 | 4.10 |
| 100000 | 容器 | 5 | 14.78 | 14.12 | 15.48 |

**表 2 浏览器解题(ms,页面测得 click → verified;每组 n = 5):**

| (cost, counter_max) | 桌面 中位数(最小–最大) | 模拟慢机 中位数(最小–最大) |
|---|---|---|
| (5000, 10000) | 14210(8730–16910) | 15082(10187–16533) |
| (5000, 5000) | 6696(4076–7239) | 6798(6686–7049) |
| (1000, 10000) | 2544(1958–2939) | 3070(2568–8057) |

**表 3 服务端自报 `solve_ms`(ms,`captcha_verify` 行;每组 n = 5):**

| (cost, counter_max) | 桌面 中位数(最小–最大) | 模拟慢机 中位数(最小–最大) |
|---|---|---|
| (5000, 10000) | 14151(8645–16849) | 14934(10036–16360) |
| (5000, 5000) | 6650(4024–7188) | 6632(6414–6882) |
| (1000, 10000) | 2457(1908–2865) | 2517(2059–6450) |

- **观察(只是数据,不是推导):** 页面测得与服务端自报的中位数相差不到 0.5 s。解题时间大致随 cost × counter 成比例:5000/10000 与 1000/10000 的中位数比约 5.6(cost 比 5),5000/10000 与 5000/5000 的比约 2.1(counter 比 2)。
- **「模拟」不可用作慢机估计:** CPU 4 倍节流后中位数几乎没有变慢(仅 (1000,10000) 有一次 8 s 的离群值)。推测组件在 Web Worker 里求解、CDP 节流没有作用到 worker(**未验证**)。所以表 2、表 3 的模拟列不代表手机。
- **样本与范围:** 每组只有 5 次,最小与最大跨度大(例如 (5000,10000) 桌面 8.7–16.9 s),数字不作精确值。测试栈没有开 Postgres,多 worker 未测。

**分块大小(`yarn web:build` 之后 `gzip -9`,字节):**

| 文件 | 原始 | gzip -9 |
|---|---|---|
| `captcha-widget-DOrp_tDH.js`(组件 + altcha + 语言包) | 128477 | 40695 |
| `captcha-field-BJWfXTQV.js`(外壳) | 1189 | 622 |

- **主包**(`node web/scripts/check-main-bundle.mjs`,入口 `index-D4iaEZZb.js`):**412.5 kB** gzip。与文件中的基线 412.5 kB 相比增量 +0.00;相对裁定补记中的 411.67 kB 为 **+0.83 kB**,在 1.0 kB 预算内。
- 组件分块 40.7 kB gzip 高于 `altcha` 的 README 自述 34 kB;差异原因**未核对**。W8 记录的 40.75 kB 与本次数字不同(gzip 设定可能不同,未核对)。

**解题期间的网络请求:** 桌面与模拟两组的解题窗口内只看到两类 URL:`localhost:8100`(同源,`/api/captcha/*` 与页面资源)和 `blob:`(组件在页面内的 Worker 资源,不是网络请求)。**没有任何第三方主机。** 另做了一次探测(栈的难度,单次约 5 s):`http` `localhost:8100` 14 条(其中 `/api` 3 条)、`blob:` 16 条。Playwright 的 request 事件是否覆盖 Worker 自己发出的请求,**未验证**。

**建议(只是建议,未改任何默认值):**

- 按这些数字,默认 `CAPTCHA_COST=5000`、`CAPTCHA_COUNTER_MAX=10000` **对中档手机不宜直接采用**:连桌面级 CPU 的中位数也已经是 14.2 s(最大 16.9 s),手机通常更慢(**真机未测,未验证**)。
- 若真机明显超过几秒,先降 `CAPTCHA_COST`:cost 1000、counter_max 10000 时桌面中位数约 2.5 s;cost 5000、counter_max 5000 约 6.7 s。代价:脚本的计算成本按同一比例降低(cost 5000 → 1000 即 5 倍),这是有意的取舍。
- 改默认值需另开任务并经用户同意。
- **2026-10-20 负责人批准:** 默认 `captcha_cost` 由 5000 改为 1000(`captcha_counter_max` 仍为 10000)。依据即上面的桌面实测(中位数 2.5 s);真机仍未验证。配置、帮助文字、`server/.env.example`、`server/README.md` 与设计 spec 的修订行已同步。

**需要用户在自己的 iPhone / 安卓上做的步骤(真机数字全部未验证):**

1. 管理后台把 `captcha_mode` 设为 `adaptive`(会要求理由与确认词 `CAPTCHA_MODE`)。
2. 手机打开正式站点的注册页,点勾选框,用秒表粗略记下到「已验证」的时间(只作参考)。
3. 在找回密码页用一个错误的验证码提交一次。服务端先校验人机验证、再校验验证码,错误的验证码只返回 400、不发信(代码路径如此;在真实站点上**未验证**)。
4. 管理后台的日志查看器搜索 `captcha_verify`,读取 `solve_ms`(毫秒)。重复 5 次,记中位数(日志查看器能否显示 `app.timing` 行,**未验证**)。
5. 结果不合适时,在管理后台降低 `captcha_cost`(会要求确认),重复第 2–4 步。
6. 测完且不需要保持开启时,把 `captcha_mode` 改回 `off`。

**Z2 文档(2026-10-20,只改文档,未改应用源码):**

- **改动:** `server/README.md` 新增「人机验证(ALTCHA)」一节(保护的五个接口与有意不保护的接口及原因、三种模式、开启与紧急关闭步骤、可调参数与削弱防护的方向、反向代理与 nginx 示例(标注未在 1Panel 验证)、已知限制与未验证项);`server/app/CLAUDE.md`、`core/`、`routers/`、`services/`、`admin/`、`tests/` 的 CLAUDE.md 补齐验证码模块与测试。`server/.env.example` 的验证码注释逐条核对(范围、默认值、行为),与代码一致,未改动。
- **定向测试:** 在 `server` 下直接调用共享 venv 的 `python -m pytest` 运行 `tests/test_captcha_*.py` 与 `tests/test_architecture.py`,**133 通过**(未 `uv sync`,未装任何包);全量未跑。
- **核对时发现的不一致(本次未改代码,交负责人裁定):**
  1. 设计 spec §9 写 `captcha_login_window_minutes` 不设危险提示;代码与该设置的帮助文字都以「调短」为危险方向。文档以代码为准。
  2. `captcha_flagged_multiplier` 的帮助文字(`server/app/core/settings_registry.py`)写「被标记的 IP 或登录名」,但 `server/app/routers/captcha.py` 只按 IP 取倍数(`ip_flagged`)。`.env.example` 的注释只写 IP,与代码一致。
  3. `web/README.md` 记录的组件分块 40.75 kB(W8)与本次 `gzip -9` 实测 40.70 kB(40695 字节)不同;`altcha` 自述的 34 kB 也与之不同。两者的原因未核对。

## 裁定补记(2026-10-20,协调者):网页主包预算 0.6 → 0.65 → **1.0 kB**

- 依据实测:W7 登录页接线 +0.62 kB(超出估值 0.02);合并前评审要求的两项鲁棒性修复——登录页在懒加载块失败时不白屏(复用 `web.common.loadFailed` / `web.common.retry`,不加新字符串)、载荷在请求开始时一次性取走且忙碌状态一定结束——在主包里实测共 **+0.83 kB**(`check-main-bundle.mjs --max-delta=1.0`,基线 411.67 kB)。0.6 kB 是写计划时没有任何测量的估值。
- 裁定:验证码网页的主包预算为 **1.0 kB**;组件与 `hash-wasm` 仍只在懒加载块里(实测组件块 128.35 kB 原始 / 外壳 1.19 kB 原始,主包不含)。合并后基线重录为 412.5 kB。以后再增长要重新裁定,不得由实现者自行放宽。
