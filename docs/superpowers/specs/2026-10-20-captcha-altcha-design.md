# 人机验证(ALTCHA 工作量证明)设计

- 日期:2026-10-20 · 状态:**用户已批准方向**(选型、默认关闭、端点策略、自托管校验);本文的裁定(§2)按「写设计时核对过的代码与资料」给出,其中 **R-C1(`always` 模式下登录的规则)偏离了用户的推荐,需要用户确认**。
- 计划:`docs/superpowers/plans/2026-10-20-captcha-altcha.md`
- 相关:`docs/superpowers/plans/2026-10-14-accounts-INDEX.md`(X1–X37 耦合与隐私规则沿用)、`server/README.md`「必须使用 HTTPS」「注册保护」

## 1. 背景与目标

注册、发邮箱验证码、找回密码目前只有按 IP 的进程内限流(`RATE_LIMIT_PER_MINUTE`、`EMAIL_CODES_PER_IP_HOURLY`)与按目标的数据库上限。廉价脚本换 IP 或慢速轮询就能持续触发发信、批量注册、撞库登录。目标:**提高廉价脚本的成本**,不引入第三方主机、不加 Cookie、不加新服务。

**选型(用户已批准,不再讨论):** ALTCHA(MIT,工作量证明;挑战在我们自己的 FastAPI 里签发并校验)。未选:Cap.js(要额外容器 + Valkey)、mCaptcha(AGPL、更新慢)、Anubis(保护整站而非 API 表单)、reCAPTCHA / hCaptcha / Turnstile(违反仓库规则「网页代码不向第三方主机发送用户数据」,且在国内不可靠)。

**不是目标:** 防通用爬虫与 DoS(那要靠反向代理限流 / WAF,见 §11);防有真实算力或打码平台的攻击者(§12)。

## 2. 裁定(本设计内的决定;R-C 编号与计划共用)

| # | 问题 | 裁定 | 理由 |
|---|---|---|---|
| **R-C1** | `always` 模式下登录是否必验 | **`always` = 登录也必验**(桌面端从此不能登录,作为「正在被攻击」的应急档);**`adaptive` = 推荐的生产档**,登录只在连续失败后才要求。**偏离用户推荐,待确认。** | 用户推荐「`always` 下登录仍为自适应」。但按已批准的端点策略,`adaptive` 与 `always` 对另外四个端点完全相同(都必验),若登录在两档下也相同,三值设置里就有两个值等价,没有意义。保留三值且语义各异,桌面端安全的选择是 `adaptive`;配置诊断在 `always` 时给 `warn`(§9)。若用户坚持「`always` 下登录仍自适应」,则应把设置改为 `off | on` 两值(计划 Task 0 第 1 项先请用户确认,再开工 S1)。 |
| **R-C2** | 缺少 / 无效时的状态码与错误名 | **`428`**,`{"error":"captcha_required"}`(需要但请求没带)/ `{"error":"captcha_invalid"}`(带了,但任何一种失败)。配置缺失(开着但没有 `CAPTCHA_SECRET`)→ `503 {"error":"Captcha is not configured"}` | 428 在本 API 里没有任何别的含义,客户端只看状态码就能判断「去做人机验证再重试」,不会与现有 403(`Account disabled`、`Invalid invite code`、`Wrong password`、`email_binding_required`、`Registration is closed`)混淆;运维只看访问日志的状态码就能统计被拦次数(INDEX §10.1 的习惯)。RFC 6585 的 428 原义是「要求条件请求」,这里是借用,写明。`captcha_invalid` 不区分过期 / 重放 / 算错 / 篡改 / 格式错 / 签名错。 |
| **R-C3** | 解答怎么随请求发送 | **请求头 `X-Captcha: <ALTCHA payload,base64>`**,不进 JSON 体、不进 URL | 五个端点的请求模型不用改(桌面端与旧网页不受影响);依赖函数直接读头,不必重复解析请求体;网页 `ApiClient` 加一个可选 `captcha` 选项即可。同源请求,不触发 CORS 预检。uvicorn 访问日志与 nginx 默认 `combined` 格式都不记录自定义请求头;我们自己永不记录(§8)。 |
| **R-C4** | 协议版本 | **ALTCHA v2,`PBKDF2/SHA-256`,确定性工作量(deterministic,服务端选 counter 并签 `keySignature`)** | v1(SHA-256 + `maxnumber`)在官方库里已标为 legacy;官方文档推荐 PBKDF2(SHA-256)为「适合大多数应用的默认值」;Python 端用标准库 `hashlib.pbkdf2_hmac`,不需要 `argon2-cffi`;确定性模式下每个用户的工作量可预期、服务端校验只需一次 HMAC(不必重算 KDF)。Argon2id / scrypt 需要额外 worker 与内存,手机上风险更大,本期不用。 |
| **R-C5** | 用官方库还是自己实现 | **用官方 PyPI 库 `altcha`,钉死 `==2.3.0`**(`uv add`,同提交 `uv.lock`),包在我们自己的适配模块 `app/core/captcha.py` 里,外加我们自己的严格检查(§6.3) | MIT、零依赖、2026-10-04 仍有提交、v2 的规范 JSON(按 UTF-16 码元排序键)必须与网页组件逐字节一致——自己实现最容易错的就是这一处。钉版本防止上游悄悄改格式;升级要过本计划的测试。若 Task 0 发现库的接口与本文不符,只改适配模块,不改对外接口。 |
| **R-C6** | 登录失败计数放哪里 | **进程内**(`core/ratelimit.RateLimiter` 的两个实例:按 IP、按登录名的带密钥摘要),不入库 | 失败登录正是攻击流量:入库会让每次错误密码多一次数据库写(放大);现有限流全是进程内(`core/ratelimit.py` 已写明只适用于单 worker),部署也是单 worker;计数只用于「要不要出人机验证」,丢失(重启)的后果只是攻击者多得几次免验证的尝试,仍受 `RATE_LIMIT_PER_MINUTE` 约束。多进程时阈值实际放大为进程数倍,写进已知限制。登录名不以明文作键:`blake2b(登录名, key=进程启动时随机的 16 字节)`,内存里也看不到原文。 |
| **R-C7** | 防重放存哪里 | **数据库新表 `captcha_replays`**(迁移 `0027_captcha_replay`),主键是挑战签名 | 必须「一次性」且多进程也准确;写入只发生在签名与解答都通过之后(伪造的载荷不会造成写入),所以不会被放大。 |
| **R-C8** | 登录在什么时候「被标记」 | 同一 IP 或同一登录名在 `CAPTCHA_LOGIN_WINDOW_MINUTES`(默认 15)内的失败(401)次数 ≥ `CAPTCHA_LOGIN_FAILURES`(默认 5) | 不存在的登录名也计数(否则「被标记」本身成了用户名探测口);被标记的登录名对任何 IP 都要求验证,这比「锁定账号」好:受害者仍能在网页上过验证后登录(§12 记录桌面端的代价)。成功登录不清零(防止攻击者用自己的账号刷掉 IP 计数)。 |
| **R-C9** | 依赖还是显式调用 | 五个端点都在处理函数里**显式调用** `await captcha_guard.enforce(request, session, scope, flagged=...)`,位置在计划里逐个钉死 | 登录需要先解析出登录名才能判断是否被标记;注册要让「注册已关闭」「请在网页注册」(桌面端看到的友好提示)先于人机验证返回,但人机验证必须先于密码哈希与任何查库。`Depends` 做不到这种顺序。 |
| **R-C10** | 校验与路由放哪里(分层) | `app/core/captcha_policy.py`(纯函数,只用标准库,加入架构测试的 `STDLIB_ONLY`)、`app/core/captcha.py`(ALTCHA 适配:签发 / 校验,第三方库 + 标准库)、`app/core/login_failures.py`(进程内计数)、`app/services/captcha_replay.py`(数据库:认领 / 清理)、`app/routers/captcha.py`(两个 GET 端点)、`app/routers/captcha_guard.py`(**不是路由**:`enforce()`,与 `live_connections.py` 同类,INDEX X30 的先例) | 不新增顶层包,`tests/test_architecture.py` 只**收紧**(追加 `STDLIB_ONLY`),不放宽;core 不导入 services;services 不读 `app.state`;`deps.py`、`sessions.py`、`account.py` 只改点名的位置(X36)。 |
| **R-C11** | `runtime_problems` 是否拒绝「开着但缺密钥」 | **不拒绝**:运行时失败即关闭(503),配置诊断报 `error` | `runtime_problems` 在启动时会让服务起不来,在 `reload_from_db` 里会把冲突的覆盖值整体丢弃退回环境基线——即把人机验证**悄悄关掉**(失败即放开),正与要求相反。 |
| **R-C12** | 网页怎么知道要不要显示组件 | 新端点 `GET /api/captcha/config` → `{"mode": ...}`;注册 / 找回 / 绑定页在 `mode != "off"` 时显示组件;登录页在 `mode == "always"` 时显示,`adaptive` 下只在收到 428 之后显示。任何页面收到 428 都显示组件并提示(热改后的兜底) | 不为了「探测」而加载组件代码;组件(约 34 kB gzip,README 自述,未实测)只在需要时懒加载。 |
| **R-C13** | 非安全上下文(纯 HTTP、局域网 IP) | **不支持**:组件包装层检测 `window.isSecureContext === false` 时不加载组件,显示本地化提示「需要 HTTPS 才能完成人机验证」,受保护的提交按钮保持可点但服务端会回 428 | 组件源码在非安全上下文直接抛 `Secure context (HTTPS) required.`(WebCrypto 只在安全上下文可用)。生产本来就必须 HTTPS(`server/README.md`);`http://localhost` 与 `*.localhost` 属于安全上下文,本机开发与 E2E(`http://localhost:8100`)不受影响;用手机经局域网 IP 调试时需关闭人机验证或走 HTTPS。 |
| **R-C14** | 一次性的边界 | 载荷在**签名与解答通过的那一刻**被认领(写入 `captcha_replays` 并提交),之后不论端点成功与否都已作废 | 防止「一个解答反复用于试错」;代价是失败后要再验一次——网页包装层在每次提交后自动重置并重新求解(§10)。 |
| **R-C15** | 难度按什么提高 | 签发挑战时,若请求 IP 已被登录失败计数标记,counter 乘以 `CAPTCHA_FLAGGED_MULTIPLIER`(默认 2) | 签发时不知道登录名,只能按 IP;难度只影响客户端的期望工作量,服务端校验成本不变(只验 HMAC)。 |

## 3. 端点策略

| 端点 | `off` | `adaptive` | `always` | 调用位置(处理函数内) |
|---|---|---|---|---|
| `POST /api/email/code` | 不验 | **必验** | **必验** | `email_ready` 检查之后、`email_ip_limiter` 之前(未过验证的请求不消耗该 IP 的发码额度) |
| `POST /api/me/email/code` | 不验 | **必验** | **必验** | `current_user_unbound` 之后、`email_ready` 之后、`_bind_purpose` 与当前密码校验之前(人机验证先于昂贵的密码校验) |
| `POST /api/users`(注册) | 不验 | **必验** | **必验** | `closed` 检查、邀请码失败额度检查、`_require_email_fields`(开关开时)之后;昵称查重与密码哈希之前 |
| `POST /api/password/reset` | 不验 | **必验** | **必验** | `email_ready` 检查之后、密码哈希之前 |
| `POST /api/sessions`(登录) | 不验 | **被标记时**必验(R-C8) | **必验**(R-C1) | `provider` 检查之后、查用户与校验密码之前;401 时记一次失败 |
| `GET /api/captcha/config` | 公开 | 公开 | 公开 | — |
| `GET /api/captcha/challenge` | 404 | 签发 | 签发 | 按 IP 每分钟限流 |

不受保护(有意):`POST /api/me/email`(绑定,需要已登录 + 邮件里的码)、改密(需要登录与当前密码,已有 `auth_rate_limit`)、登出、一切需要登录的业务接口。

## 4. 设置

全部在组 `registration`(注册与访问);除 `CAPTCHA_SECRET` 外都是热改(每次请求读 `request.app.state.settings`;限流器的上限 / 窗口经 hub 监听推送)。默认值是**初始值**,来自官方文档的推荐或与现有限流对齐,**不是实测结论**;上线前按计划 Z1 的实测调整。

| 字段 | 类型 / 默认 | 范围 | kind / apply | 说明(`.env.example` 中文注释要点) |
|---|---|---|---|---|
| `captcha_mode` | `Literal["off","adaptive","always"]` `"off"` | — | enum / hot | `off` 完全不验(升级后的默认,桌面端与老用户不受影响);`adaptive` 推荐;`always` 会让桌面端无法登录。danger:任何改动都确认 |
| `captcha_secret` | str `""` | 空或 ≥ 32 字符 | **secret,env-only**,restart | 签名密钥。生成:`python -c "import secrets; print(secrets.token_urlsafe(48))"`。更换会让未用完的挑战全部失效(最多 `CAPTCHA_TTL_SECONDS`),无其他后果;校验器错误信息不含值 |
| `captcha_ttl_seconds` | int `300` | 60–1800 | int / hot | 挑战有效期 |
| `captcha_cost` | int `5000` | 1–100000 | int / hot | PBKDF2 的 cost(官方文档推荐 5000;其精确含义 Task 0 核对)。danger:调低会降低脚本成本(只在调低方向提示)。**修订(2026-10-20):默认改为 `1000`**,见下方修订 |
| `captcha_counter_max` | int `10000` | 10–1000000 | int / hot | 服务端在 `[counter_max/2, counter_max]` 里均匀选 counter(官方推荐区间 5000–10000);danger:调低方向 |

> **修订(2026-10-20):** `captcha_cost` 的默认值由 `5000` 改为 `1000`。原因:计划「执行结果」Z1 在桌面 Chromium(Intel i5-14400)上实测,`(cost=5000, counter_max=10000)` 中位数约 14.2 秒(8.7–16.9 秒),不可用;`(cost=1000, counter_max=10000)` 中位数约 2.5 秒(1.96–2.94 秒)。`captcha_counter_max` 的默认值 10000 不变。真机(手机)未验证。上文表格中的 `5000` 与「官方文档推荐 5000」保留为历史记录。
| `captcha_flagged_multiplier` | int `2` | 1–10 | int / hot | 被标记 IP 的 counter 倍数(R-C15) |
| `captcha_login_failures` | int `5` | 1–100 | int / hot | 登录失败几次后要求验证;danger:调高方向 |
| `captcha_login_window_minutes` | int `15` | 1–1440 | int / hot | 失败计数窗口 |
| `captcha_challenges_per_minute` | int `20` | 1–1000 | int / hot | 同一 IP 每分钟可取几个挑战 |

`tests/test_settings_registry.py`:`EXPECTED_ENV_ONLY` 与 `EXPECTED_SECRETS` 各加 `captcha_secret`。E2E 的一次性栈把 `CAPTCHA_COST=1`、`CAPTCHA_COUNTER_MAX=10`(下限即为此留出)。

## 5. 数据模型

迁移 `0027_captcha_replay`(`down_revision = "0026"`,写设计时已核对真实 head 是 `0026`):

```
captcha_replays
  signature   String(64)  PRIMARY KEY     -- 挑战的 HMAC 签名(小写十六进制);不是用户数据
  expires_at  DateTime(timezone=True) NOT NULL, INDEX ix_captcha_replays_expires_at
```

- 只建新表,不改旧表:SQLite 与 Postgres 都用 `op.create_table`,不需要 batch 模式(batch 只用于 SQLite 上的 ALTER);降级 `drop_index` + `drop_table`。
- 没有用户 id、没有 IP、没有时间以外的任何东西。
- 认领:`core/db.insert_ignore(session, table).values(...)`(SQLite / Postgres 的 `ON CONFLICT DO NOTHING`,已核对),`rowcount == 1` 才算首次使用;随后立即提交。
- 清理:`admin/housekeeping.purge_expired` 追加 `captcha_replays`(`expires_at < now`),每日由 `admin/backups.daily_loop` 调用(已核对)。过期的签名本来就过不了 `expiresAt` 检查,删掉不会让重放复活。

## 6. API

### 6.1 `GET /api/captcha/config`

无需登录;`Cache-Control: no-store`;不限流(无计算,与 `GET /api/announcements` 同类)。

```json
200 {"mode": "off"}          // 或 "adaptive" / "always"
```

### 6.2 `GET /api/captcha/challenge`

无需登录;`Cache-Control: no-store`;按 IP 每分钟 `CAPTCHA_CHALLENGES_PER_MINUTE`。

| 情况 | 响应 |
|---|---|
| `captcha_mode == "off"` | `404 {"error":"Captcha is off"}` |
| 开着但 `CAPTCHA_SECRET` 为空 | `503 {"error":"Captcha is not configured"}` |
| 超出限流 | `429 {"error":"Too many requests, please try again later"}`(现有文案) |
| 正常 | `200` ALTCHA v2 挑战 JSON(下) |

```json
{
  "parameters": {
    "algorithm": "PBKDF2/SHA-256",
    "cost": 5000,
    "keyLength": 32,
    "keyPrefix": "<16 字节派生密钥前缀的十六进制>",
    "keySignature": "<hex>",
    "nonce": "<32 位十六进制>",
    "salt": "<32 位十六进制>",
    "expiresAt": 1792473600
  },
  "signature": "<64 位十六进制>"
}
```

(字段名取自 `altcha-lib-py` 的 `altcha/v2.py`;Task 0 用库本身生成一次核对,`signature` 覆盖 `parameters` 的规范 JSON。)签发调用 PBKDF2 一次,放 `asyncio.to_thread`。

### 6.3 受保护端点的校验(`captcha_guard.enforce`)

请求头 `X-Captcha`(R-C3)。按顺序,任何一步失败即停:

1. `captcha_policy.captcha_required(mode, scope, flagged)` 为假 → 直接放行(**此时即使带了头也不校验、不认领**)。
2. `CAPTCHA_SECRET` 为空 → `503 Captcha is not configured`(失败即关闭)。
3. 头缺失或去空白后为空 → `428 captcha_required`。
4. `core.captcha.verify(...)` 的我们自己的严格检查(全部不通过即 `captcha_invalid`):头长度 ≤ 4096 字节;严格 base64(`validate=True`);JSON 是对象,且有 `challenge.parameters` 与 `solution`;`parameters.algorithm == "PBKDF2/SHA-256"`;`parameters.keySignature` 存在(只接受我们签发的确定性挑战);`parameters.expiresAt` 是整数且 `now < expiresAt ≤ now + 1800 + 60`;`challenge.signature` 是 64 位小写十六进制。
5. 官方库 `verify_solution(...)` 的结果必须 `verified is True`(库内部用 `hmac.compare_digest` 比较签名与 `keySignature`)。
6. `services.captcha_replay.claim(session, signature, expires_at)` 返回假(已用过)→ `428 captcha_invalid`;返回真 → `await session.commit()`。
7. 写一行计时(只有数字与固定枚举):`timing event=captcha_verify scope=<scope> solve_ms=<客户端自报的 solution.time,夹到 0–600000 的整数>`(logger `app.timing`)。这是实测手机解题时间的来源(§12)。

密钥派生:`hmac_secret = HMAC-SHA256(CAPTCHA_SECRET, "altcha:challenge")`、`hmac_key_secret = HMAC-SHA256(CAPTCHA_SECRET, "altcha:key")`(十六进制),原始密钥不直接交给库。

### 6.4 错误体(固定英文字符串,不拼接输入)

```json
428 {"error":"captcha_required"}
428 {"error":"captcha_invalid"}
503 {"error":"Captcha is not configured"}
404 {"error":"Captcha is off"}            // 只在 /api/captcha/challenge
```

## 7. 安全分析

- **伪造:** 挑战参数(含 `expiresAt`、`keyPrefix`、`keySignature`、`cost`)被 HMAC 签名;客户端改任何一项签名都对不上。`keySignature = HMAC(派生密钥, hmac_key_secret)`,客户端只能靠真算出派生密钥来匹配。
- **重放:** 一次性(R-C7、R-C14);签名在有效期内可能被拦截者抢先使用——同源 HTTPS 下拦截即已失守,不在本设计范围。
- **过期:** 库只在 `expiresAt` 为数字时才查过期(Task 0 已列为核对项);我们自己的检查要求它必须存在且为整数(§6.3 第 4 步),且有上限,防止签发错误导致的长期有效挑战。
- **计时:** 所有秘密比较都是常数时间(库内 `hmac.compare_digest`);前缀比较(`startswith`)只在库的慢路径里用,而我们只接受带 `keySignature` 的快路径挑战。各种失败给同一错误、同一状态码;不追求失败路径之间的耗时相同(失败原因不是秘密)。
- **DoS:** 校验在写库之前完成(伪造载荷零写入);头长度上限 4096;签发要算一次 PBKDF2(cost 5000 的耗时由 Z1 实测),按 IP 限流且在线程里跑;大量 IP 的签发洪水与通用 DoS 需要反向代理层限流(§11)。`/api/captcha/config` 无计算。
- **进程内计数的内存:** 键数受请求速率 × 窗口约束(`RateLimiter` 每个窗口清扫一次空键)。
- **失败即关闭:** 模式开着、密钥缺失 → 503;只有 `off` 才放行(R-C11)。
- **反向代理:** `client_ip` 只在 `TRUST_PROXY_HEADERS=true` 时取 `X-Forwarded-For` 最右项(已核对 `core/deps.py`);否则所有用户共用代理的 IP,一个人失败五次就会让所有人的登录都要验证——配置诊断给 `warn`(§9)。

## 8. 隐私规则

- 载荷、解答、`derivedKey`、`nonce`、`salt`、签名、`CAPTCHA_SECRET` 不进日志、错误体、审计、URL、测试快照与契约夹具(夹具里写 `REDACTED`)。
- 登录名不进计数器的明文键(R-C6);不记录被标记的 IP 或登录名。
- 组件不连接任何第三方主机(源码里只有页脚的 altcha.org 链接,我们用 `hideFooter` 去掉;运行时无第三方请求**未经抓包验证**,Z1 用浏览器窗格网络面板核对);不设 Cookie(不启用 `setCookie`)。
- 网页不在 `localStorage` 保存载荷。

## 9. 配置诊断与管理端

| code | 级别 | 条件 | 消息要点(只写键名) |
|---|---|---|---|
| `captcha_secret_missing` | error | `captcha_mode != "off"` 且 `captcha_secret` 为空 | 受保护的注册 / 发码 / 找回密码全部返回 503 |
| `captcha_always_blocks_desktop` | warn | `captcha_mode == "always"` | 桌面端无法登录;生产请用 `adaptive` |
| `captcha_without_proxy_headers` | warn | `captcha_mode != "off"` 且 `trust_proxy_headers` 为假 | 经反向代理时所有用户共用一个 IP,登录失败计数会波及所有人 |

管理端设置页沿用设置注册表自动渲染(不改管理端前端);`settings_service.danger_reasons` 追加方向规则:`captcha_mode` 任何改动、`captcha_cost` / `captcha_counter_max` 调低、`captcha_login_failures` 调高(`captcha_login_window_minutes` 不设 danger:调短窗口只是更快放行被标记者,风险小于调高阈值,且已受 `RATE_LIMIT_PER_MINUTE` 约束)。

## 10. 网页 UX

- **组件放共享层** `web/src/components/captcha/`(不是 feature:账号页与登录页都要用,feature 之间不得互相导入,`architecture.test.ts` 的跨 feature 基线不变)。包装层 `CaptchaField` 用 `React.lazy` 加载 `captcha-widget.tsx`,后者 `import "altcha"` 与中英两个语言包;**主包不含组件代码**。文案:`components/captcha/locales/{en,zh-CN}.json`(不在 `**/i18n/` 下,不被急切 glob 捕获,INDEX X37 做法),`ensureCaptchaI18n()` 在组件模块求值时调用。组件自带的标签用 ALTCHA 内置的 `zh-cn` / `en` 翻译(由当前语言决定 `language` 属性)。
- **流程:** 页面挂载时取 `GET /api/captcha/config`(R-C12)。需要时显示组件(复选框样式,`auto="off"`,`hideFooter`),用户勾选后在后台求解,`verified` 事件给出载荷;提交时载荷经 `X-Captcha` 发送;**每次提交后**(无论成败)包装层 `reset()` 并在仍需要时自动 `verify()`,为下一步(注册页的第二步、找回密码的第二步)备好新载荷。收到 428 → 显示组件、提示「请先完成人机验证」/「人机验证已失效,请重试」。
- **未完成验证时**按钮可点,但不发请求,只显示提示(避免一次必然的 428)。
- **无障碍:** 组件自述符合 WCAG 2.2 AA(键盘、焦点、ARIA;**未独立核验**);我们的提示用 `role="alert"`;包装层容器有可见标签。
- **非安全上下文:** R-C13。
- **主包预算:** 只有 `ApiClient` 的选项、`captchaConfig()`、三条 `web.errors.*` 文案与登录页的接线进主包;预算 ≤ 0.6 kB gzip,**以实测为准**(基线 `web/scripts/main-bundle-baseline.json`,写设计时为 411.67 kB,2026-10-19)。组件分块大小单独实测并记录。

## 11. 部署(写进 `server/README.md` 的一节,由计划 Z2 落地;下面是要写的内容)

### 人机验证(ALTCHA)

1. 在 `server/.env` 设 `CAPTCHA_SECRET`(≥ 32 字符,新生成,与其他密钥一样不进仓库、不进日志);重启。
2. 管理后台把 `CAPTCHA_MODE` 设为 `adaptive`(热改)。配置诊断不应出现 `captcha_secret_missing`。
3. 反向代理后面必须 `TRUST_PROXY_HEADERS=true`(否则按 IP 的计数把所有人当成一个人)。
4. 人机验证**不能**防通用爬虫、慢速扫描或 DoS:那要在反向代理层限流 / 用 WAF。

Nginx / OpenResty(1Panel)示例——**只是示例,数字需按自己的流量调整,未在真实 1Panel 上验证**,改完先 `nginx -t`:

```nginx
# http 块(1Panel:「网站 → 设置 → OpenResty 配置」或 conf.d 下的全局片段;limit_*_zone 只能放在 http 块)
limit_req_zone  $binary_remote_addr zone=enjoy_auth:10m rate=10r/m;
limit_req_zone  $binary_remote_addr zone=enjoy_api:10m  rate=20r/s;
limit_conn_zone $binary_remote_addr zone=enjoy_conn:10m;

# server 块(站点配置)
limit_conn enjoy_conn 30;            # 每个 IP 的并发连接(含 WebSocket)
limit_req_status 429;
limit_conn_status 429;

location ~ ^/api/(sessions|users|email/code|me/email/code|password/reset|captcha/challenge)$ {
    limit_req zone=enjoy_auth burst=10 nodelay;
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;   # 覆盖,而不是追加(见「必须使用 HTTPS」一节)
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /api/ {
    limit_req zone=enjoy_api burst=40 nodelay;
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
# /api/realtime、/api/rooms/ws 的 WebSocket location 保持原样(Upgrade 头、读超时 ≥ 660s),它们同样受 limit_conn 约束
```

注意:正则 `location` 优先于前缀 `location /api/`;`^/api/sessions$` 不匹配 `DELETE /api/sessions/current`;注册流程一次大约 5 个请求落在 `enjoy_auth` 区(配置不算:config、challenge、email/code、challenge、users),`rate=10r/m burst=10` 留有余量。

## 12. 兼容性(桌面端 `enjoy/`,只读核对)

- 已核对 `enjoy/src/shared/api/client.ts`:登录 `POST /api/sessions` 发 `{provider, username, password}`;注册 `POST /api/users` 只发 `{username, password, invite_code?}`;不调用 `/api/email/code`、`/api/password/reset`、`/api/me/email/code`;错误由 axios 拦截器取 `err.response.data.error`,登录表单 `toast.error(err.message)` 原样显示。
- **`off`(默认):** 无任何变化。
- **`adaptive`:** 桌面端登录只在该 IP 或该登录名近 15 分钟失败 ≥ 5 次时失败,弹出原样的 `captcha_required`;窗口过后自动恢复。攻击者可以故意用某人的登录名失败 5 次,让此人的桌面端在窗口内无法登录(网页可以过验证后登录)——已知代价。桌面端注册:`EMAIL_REGISTRATION_REQUIRED=true`(默认)时本来就先得到「请在网页注册」的 400(该检查排在人机验证之前,R-C9);该开关关闭时得到 `captcha_required`。
- **`always`:** 桌面端无法登录(R-C1,诊断警告)。
- 不改 `enjoy/`。

## 13. 上线与回退

1. 部署新版本(`CAPTCHA_MODE` 默认 `off`,迁移 `0027` 只加一张表)。
2. 设 `CAPTCHA_SECRET`,重启;诊断无 `captcha_secret_missing`。
3. 管理后台 `CAPTCHA_MODE=adaptive`;在自己的手机上走一遍注册、找回密码、绑定,看 `app.timing` 里的 `solve_ms`。
4. 按实测调整 `CAPTCHA_COST` / `CAPTCHA_COUNTER_MAX`。
5. 只在被攻击时临时切 `always`,事后切回。
6. 回退:`CAPTCHA_MODE=off`(热改,立即生效);迁移可 `downgrade -1`(只删 `captcha_replays`)。

## 14. 不做的事

- 不接入 ALTCHA Sentinel / Cloud,不调用 `verify_server`;不用 Argon2id / scrypt;不做图片 / 音频「code challenge」;不改 `enjoy/`;不改管理端前端;不对已登录的业务接口加人机验证;不做账号锁定;不在 URL 或 Cookie 里放载荷;不把计数入库。

## 15. 如实的限制

- 工作量证明只提高廉价脚本的成本;有真实算力、GPU / 原生实现或打码平台的攻击者照样能过(原生代码求 PBKDF2 远快于手机浏览器)。
- **手机解题时间必须实测**(Z1 与上线后的 `solve_ms` 计时行);文档与代码里不写编造的秒数。官方文档未给出任何设备耗时数字。
- 挑战端点本身可以被刷:按 IP 限流;每次签发一次 PBKDF2(耗时实测);跨 IP 的洪水靠反向代理。
- 登录失败计数是进程内的(R-C6):重启清零;多进程时阈值放大为进程数倍。防重放表在数据库里,多进程准确。
- 非安全上下文不可用(R-C13)。
- 自适应登录依赖 `client_ip` 正确(`TRUST_PROXY_HEADERS`)。
- 组件的无障碍声明、无第三方请求、体积(README 自述 34 kB gzip、含全部语言 52 kB)均为厂商自述,以 Z1 实测为准。

## 16. 来源(写设计时核对,2026-10-20)

- 组件仓库与发布:https://github.com/altcha-org/altcha/releases 、CHANGELOG https://raw.githubusercontent.com/altcha-org/altcha/main/CHANGELOG.md (3.4.1,2026-10-19;3.3.0 为安全修复)
- npm 元数据:https://registry.npmjs.org/altcha/latest (`altcha` 3.4.1,MIT,依赖 `hash-wasm` ^4.12.0;导出 `.`、`./i18n/*`、`./external`、`./workers/*` 等)
- 组件 README(体积自述 34 kB / 52 kB gzip):https://raw.githubusercontent.com/altcha-org/altcha/main/README.md
- 组件文档(属性 `auto`、`challenge`、`display`、`language`;`configure()` 的 `hideFooter`、`minDuration`、`timeout`;事件与方法;要求 HTTPS):https://altcha.org/docs/integration/widget/
- 安全上下文排错(`localhost` 例外):https://altcha.org/docs/integration/troubleshooting.md
- 工作量证明与推荐参数(PBKDF2 SHA-256,cost 5000,确定性 counter 5000–10000):https://altcha.org/docs/integration/proof-of-work-captcha/
- 无障碍自述(WCAG 2.2 AA):https://altcha.org/legal/compliance/wcag.md ;隐私自述(无 Cookie、无指纹):https://altcha.org/legal/compliance/gdpr.md
- Python 库:https://pypi.org/pypi/altcha/json (`altcha` 2.3.0,2026-10-04,MIT,`requires_python >=3.9`,无依赖)、https://github.com/altcha-org/altcha-lib-py 、v2 源码 https://raw.githubusercontent.com/altcha-org/altcha-lib-py/main/altcha/v2.py 、v1 源码 https://raw.githubusercontent.com/altcha-org/altcha-lib-py/main/altcha/v1.py
- 中文语言包 `zh-cn` 存在:https://github.com/altcha-org/altcha/tree/main/src/i18n

**未核对(Task 0 / Z1 处理):** bundlephobia 体积(站点 503);`altcha/i18n/zh-cn` 的准确导入路径;`verify_solution` 的准确关键字参数名(`hmac_key_secret` 等);`cost` 对 PBKDF2 的精确含义;载荷 `solution.time` 的单位;`humanInteractionSignature`(默认开)是否给载荷加字段;组件 `verify()` 是否返回 Promise;运行时无第三方请求;任何设备上的解题耗时。
