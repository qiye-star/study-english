# 账号体系 v2:邮箱验证、找回密码、昵称头像、邀请码

- 日期:2026-10-14 · 状态:§9 的 7 项已按推荐确认;**§6 已按用户修订(用户码改为固定永久码),修订部分待确认后再出计划**
- 范围:邮箱注册 / 登录 / 找回密码、老用户强制绑定邮箱、昵称与头像、邀请码 v2(管理员一次性码 + 用户永久码)。**手机号、第三方登录不在本期**,只预留接口。
- 不使用 Casdoor / 外部 IdP(只有邮箱,后续只加手机号,自研更轻)。
- 约定:本文件被批准前,不写代码;批准后单独出一份计划,与本文冲突时以本文为准。

## 1. 现状(已核对代码)

- 注册 `POST /api/users`(`routers/sessions.py`):`username + password + invite_code`;邀请码在**创建用户的同一事务**里扣次数,注册失败会还回去。
- 登录 `POST /api/sessions`:只支持 `provider=password`,用户名 + 密码,用户不存在也做一次等耗时哈希(防枚举)。
- `current_user`(`core/deps.py`):Bearer → `AccessToken` → `User`,**之后所有业务只认 `user.id`**。因此登录方式的变化不影响房间、排位、智能体、生词本。
- `User.username` 同时是登录名、**房间里的显示名**(`rooms/store.py`、`summary_store.py`、`admin/*` 约 20 处查询)和删除确认字符串。
- `AccessToken` 没有过期时间。服务端没有任何发邮件的代码。
- 邀请码已有:`InviteCode`(只存 SHA-256、`max_uses`、`expires_at`、`revoked_at`、`label`),管理端可建;环境变量 `INVITE_CODE` 是不限次数的旧码。
- 桌面端 `enjoy/` 也调用 `/api/users`、`/api/sessions`(**本期未核对它传哪些字段,计划 Task 0 必须核对**)。

## 2. 总体结构

四个可独立合并、可独立回退的阶段,按顺序:

| 阶段 | 内容 | 对用户可见的变化 |
|---|---|---|
| P1 地基 | `nickname`、`user_identities`、token 过期与撤销、`current_user` 分级 | 房间里显示昵称;token 30 天过期 |
| P2 邮箱 | 验证码、SMTP、注册 / 登录 / 找回密码、强制绑定 | 注册要邮箱验证码;老用户被要求绑定 |
| P3 头像 | 上传、处理、存储、展示、举报与管理 | 可设置头像 |
| P4 邀请码 v2 | 管理员批量一次性码、用户永久码、归属记录 | "我的邀请码"面板 |

P1 不改变任何接口行为;P2 是唯一会"破坏"桌面端旧流程的阶段(见 §8)。

## 3. P1 地基

**昵称与显示名。** `users.nickname`(1–20 字,可重复,不含控制字符)。`username` 保留为**登录名**,注册后不可改。所有"显示给别人看"的地方读 `COALESCE(nickname, username)`,**手机号 / 邮箱永远不作为显示名**。删除用户的确认字符串仍用 `username`。

**身份表。** `user_identities(id, user_id→users CASCADE, provider, subject_hmac, subject_enc, verified_at, created_at)`,唯一约束 `(provider, subject_hmac)`。本期 `provider` 只有 `email`(密码仍在 `users.password_hash`,不迁移)。
- `subject_hmac` = HMAC-SHA256(`IDENTITY_PEPPER`, 规范化值),用于登录查找和唯一性;`subject_enc` = `secretbox` 加密的原值,仅用于发信和管理端脱敏展示。
- 邮箱规范化:去空白、转小写;**唯一性键额外去掉 `+标签`**(防一个邮箱注册多个账号);不处理 Gmail 点号。
- `IDENTITY_PEPPER` 是只读环境变量,**丢失或更换会让所有邮箱登录失效**:写入 `.env.example` 注释和 README 备份说明,不做热改。
- 冗余 `users.email_verified_at`(绑定时同一事务更新),供 `current_user` 做强制绑定判断而不额外查表。

**Token。** `access_tokens` 加 `expires_at`(默认 30 天,`ACCESS_TOKEN_TTL_DAYS`)、`last_used_at`(滑动续期,**最多每小时写一次**,避免每个请求一次写库)。现有 token 迁移时一律设为"迁移时刻 + TTL",**避免部署时全员掉线**。改密、重置密码、管理员停用 / 重置:撤销该用户全部 token。

**`current_user` 分级。** 保持 `current_user` 为唯一入口,在其中加一条判断:强制绑定生效且 `email_verified_at IS NULL` → `403 {"error":"email_binding_required"}`。另提供 `current_user_unbound`(不做该判断),只用于:`GET /api/me`、绑定邮箱的两个端点、登出、`GET /api/announcements`。

## 4. P2 邮箱

### 4.1 验证码(通用,为短信预留)
表 `verification_codes(id, channel, purpose, target_hmac, user_id?, code_hmac, expires_at, attempts, consumed_at, created_at)`。
- `channel`:`email`(以后 `sms`);`purpose`:`register` / `reset` / `bind` / `change_email`。
- 6 位数字,`secrets` 生成;`code_hmac` 用 HMAC 存(6 位数字明文哈希可被离线穷举)。
- 有效期 10 分钟;最多试错 5 次后作废;同一目标重发冷却 60 秒;同一目标每天最多 `EMAIL_CODES_PER_TARGET_DAILY`(默认 10);每 IP 每小时上限(沿用 `auth_rate_limit` 之外再加一层发送上限);**全局每日上限 `EMAIL_DAILY_GLOBAL`,必须小于 SMTP 服务商的日限额**。
- 新码生成时,同一 `(target, purpose)` 的旧码作废。校验用 `secrets.compare_digest`,一次性。
- **防枚举:** 发码接口无论邮箱是否已注册都立即返回同样的 200;真正的发送放进后台任务,响应耗时一致。`register` 用途遇到已注册邮箱:不发码,改发一封"该邮箱已注册,可直接登录或找回密码"的通知。发送失败不向客户端泄露(只记计数)。
- 日志、错误、审计、URL 里**不得出现邮箱和验证码**;每个端点和后台任务用 `caplog` 断言。

### 4.2 发信(QQ 邮箱 SMTP)
- `providers/email.py`:`send(to, subject, body)` 接口;实现 `smtp`(`smtplib` 放线程里,STARTTLS/SSL 可配)与 `console`(开发,只打印"已发送"不打印内容),测试用假后端。**接口不绑定 QQ**,以后换腾讯云 SES / 阿里云邮件推送只换实现。
- 配置:`EMAIL_BACKEND`、`SMTP_HOST`(`smtp.qq.com`)、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD`(**QQ 授权码,按密钥处理**:`secret=True`,不进日志 / 审计 / 导出)、`SMTP_FROM`;全部进 `settings_registry`,中文注释。
- 每次发送 `metering.record(kind="email", provider="smtp", ...)`(只记状态和耗时,**不记收件人和内容**)。
- **QQ 邮箱的风险(如实写给你):** 发件人就是你的 QQ 邮箱;免费邮箱有日发送上限、可能被限速或临时封禁;发到其他邮箱容易进垃圾箱;SPF/DKIM 不在你控制下。对小规模内测可接受,**面向陌生人公开前建议换事务邮件服务**。管理后台"体检"增加 SMTP 连通探测(只连接 + 认证,不发信)。

### 4.3 接口
| 接口 | 说明 |
|---|---|
| `POST /api/email/code {email, purpose}` | 发码;`purpose ∈ register|reset`;登录前可用,限流 |
| `POST /api/users` | 新增必填 `email`、`email_code`、`nickname`;`username`、`password`、`invite_code` 照旧。**验证码、邀请码、新用户在同一事务**,任一失败全部回滚(验证码次数计入 `attempts` 的除外) |
| `POST /api/sessions` | `username` 字段**同时接受用户名或邮箱**(含 `@` 走邮箱查找);等耗时防枚举保留 |
| `POST /api/password/reset {email, code, new_password}` | 找回密码;成功后撤销全部 token,**不自动登录** |
| `POST /api/me/email/code`、`POST /api/me/email` | 老用户 / 换绑邮箱:`bind` 只需验证码;`change_email` 还需当前密码;新邮箱已被占用时同样不泄露 |
| `GET /api/me` | 增加 `email_masked`、`email_verified`、`nickname`、`avatar_url` |

**邮箱域名策略** `EMAIL_DOMAIN_MODE=any|allowlist|blocklist`(默认 `blocklist`,内置常见临时邮箱域名,管理员可改;`allowlist` 为国内主流邮箱)。这一条比验证码本身更能挡批量注册。

### 4.4 强制绑定老用户
- 开关 `EMAIL_BINDING_REQUIRED`(热改)+ 截止时间 `EMAIL_BINDING_DEADLINE`:**截止前**只在网页顶部横幅提示;**截止后**所有 `current_user` 接口返回 `email_binding_required`,前端跳到绑定页。
- 管理员、`disabled` 用户不受影响;管理员可在管理端为用户清除 / 重置邮箱(step-up + 审计)。
- 忘记密码又没绑邮箱的老用户:仍只能找管理员重置(管理端已有)。**这类用户需要提前通知。**

## 5. P3 头像

- **注册后上传**,不在注册请求里收文件(未登录上传是存储滥用入口):`POST /api/me/avatar`(登录用户)。
- 限制:上传 ≤ 2 MB;只接受 JPEG / PNG / WebP,**服务端用 Pillow 重新编码**为 256×256 WebP(去掉 EXIF / 元数据,拒绝畸形文件);像素上限防解压炸弹。
- 存放 `DATA_DIR/avatars/<随机 128 位 id>.webp`,`users.avatar_id`;**换头像 = 换 id**,旧文件在提交后删除。`GET /api/avatars/{id}` 不需要鉴权(`<img>` 不能带 Bearer),靠不可猜的 id;`Content-Type` 固定、`X-Content-Type-Options: nosniff`、`Cache-Control: immutable`。
- 展示:`me` 页、房间成员列表 / 消息。**房间展示需要给 WS 载荷增加 `avatar_url` 字段(协议只增不改,夹具重录)**,这是 P3 里影响面最大的一步,单独成任务。
- **陌生人互相可见的头像属于用户生成内容。** 必须有:成员举报入口、管理端一键移除头像(审计)、`AVATAR_UPLOAD_ENABLED` 总开关。是否接入自动内容审核,见 §9。

## 6. P4 邀请码 v2

### 6.1 数据
`invite_codes` 新增:`kind`(`admin` / `user`)、`owner_user_id`(nullable,管理员码为空)、`code_enc`(**仅 `kind=user`**,`secretbox` 加密,供本人再次查看);`expires_at` 为空即永久。**每个用户同一时间只有一个有效的用户码**(部分唯一索引:`owner_user_id` 且未撤销)。新表 `invite_redemptions(code_id, user_id UNIQUE, redeemed_at)`:谁用了哪个码,**一个用户只能有一条**,这是以后付费分成 / 奖励的归属依据。
- **管理员码**:随机,保持"只存哈希、只在生成时显示一次"(现有行为)。
- **用户码(2026-10-14 用户修订):和管理员码一样随机生成,但永久有效。** 用户第一次点"生成我的邀请码"时随机生成并保存,之后不变、不过期;因为要能再次查看,额外用 `secretbox` 加密存一份(哈希用于校验)。
  - **不用用户 ID 派生、不允许自定义:** 用户 ID 公开,可预测的码会让邀请码闸门失效;所以只能是随机。
  - **轮换:** 码泄露时,管理员或用户本人(二次确认)可"更换":旧码撤销,随机生成新码。平时不更换,所以对用户来说是永久的。
- 码格式:10 位,字符表去掉易混字符(`I L O U 0 1`),显示为 `XXXXX-XXXXX`,约 50 bit;大小写与分隔符无关(沿用 `normalise`)。校验失败走注册接口既有限流,**另加按 IP 的邀请码错误计数**。
- 环境变量 `INVITE_CODE`(不限次数旧码)保留但标为**不推荐**:无归属、不可单独撤销。

### 6.2 规则
- **管理员码**:批量生成(一次 ≤ 100 个,`max_uses=1`,可设过期、标签),生成后一次性展示并可下载 CSV;可撤销;列表显示使用者(用户名)。
- **用户码**:永久(无过期)、**可多次使用**,但有**累计使用上限**:`INVITES_USER_CODE_MAX_USES`(默认 10)。永久指"码不变、不过期",不是"不限次数"。账号注册满 `INVITES_USER_MIN_ACCOUNT_DAYS`(默认 7)天且邮箱已验证,才能生成自己的码(生成动作本身有限流)。
  - **为什么必须有累计上限:** 一个不变的多次码一旦被发到公开群,就等于开放注册,而成本闸门正依赖邀请码(这是推荐方案 A 被改为 B 带来的风险,上限是对它的缓解)。
  - 上限可用现有 `quotas` 覆盖机制**按人调整**:调大(以后可作为付费权益)、设为 0(**滥用时管理员收回某人的邀请权**);管理员也可直接撤销 / 轮换某人的码。
  - 达到上限后,注册时提示"该邀请码已用完",邀请者在"我的"页看到已用 N / 上限 M。
- 被邀请者被停用时,邀请者的"被停用邀请数"在管理端可见,供人工判断。
- **本期不做**:奖励、积分、付费、分成。只记录归属,不触发任何后续逻辑。

### 6.3 界面
- 网页"我的"页新增"我的邀请码":未生成时显示"生成我的邀请码"按钮;生成后显示固定的码、已用 N / 上限 M、被邀请的人(昵称,不含邮箱)、复制与分享按钮;"更换邀请码"藏在二次确认里,并说明旧码会失效。
- **分享链接把码放在 URL 的 `#` 片段**(`/register#invite=XXXXX-XXXXX`)——片段不会发给服务器,不会进代理和访问日志;注册页读取后立即清掉地址栏。**不要放在 query 里。**
- 管理端:邀请码页增加批量生成、CSV、按 `kind`/所有者筛选、归属关系查看。

## 7. 隐私与安全硬规则(沿用项目规则)
- 邮箱、验证码、邀请码、SMTP 授权码、token:不进日志、错误、审计、URL(邀请码仅限 `#` 片段)、测试快照。
- 管理员默认只看脱敏邮箱(`a***@qq.com`);查看完整邮箱不提供。
- 删除用户:级联删除身份、验证码、头像文件;`invite_redemptions` 保留(`user_id` 置空前先脱敏),邀请码归属不可追溯到已删除用户的个人信息。
- 数据库泄露的最坏情形:邮箱只有 HMAC + 密文,验证码只有 HMAC;**但 `IDENTITY_PEPPER` 与 `SETTINGS_ENCRYPTION_KEY` 同时泄露则可还原**——两者不得放在同一处备份。

## 8. 兼容性与已知代价
- **桌面端 `enjoy/`**:注册接口新增必填字段,桌面端旧注册流程会失败;强制绑定生效后,桌面端登录会收到 `email_binding_required` 且不会显示绑定界面。**桌面用户需要先在网页完成注册 / 绑定。**不改 `enjoy/`(项目规则),需要你接受这一点,或另行决定。
- 部署顺序:P1 → P2 先让 `EMAIL_BINDING_REQUIRED=false` 上线并设置截止时间,公告后再生效。
- 迁移:每个阶段各自一个迁移,SQLite(batch)+ Postgres 双路径和往返测试;**部署前备份 PostgreSQL**。当前迁移头以代码为准(`app/CLAUDE.md` 写 `0019`,计划 Task 0 必须核对)。

## 9. 需要你确认(括号内是我的推荐)
1. **昵称与用户名**:`username` = 登录账号(不可改),`nickname` = 给别人看的名字,注册时必填。(推荐如此;若你原意是"用户名就是显示名",请告诉我。)
2. **用户邀请码**:~~每个码一次性(A)~~ → **用户修订为每人一个固定永久码(B),见 §6**;码随机生成并永久保存;缓解:累计使用上限默认 10、可按人调整、可更换。
3. **强制绑定的截止时间**:公告多久?(推荐 7 天,先横幅后强制。)
4. **桌面端**:接受"先在网页注册 / 绑定"?(推荐接受。)
5. **头像审核**:仅举报 + 管理员移除 + 总开关(推荐先这样),还是上线前就接自动内容审核?
6. **邮箱域名策略**:默认 `blocklist`(推荐),还是只允许国内主流邮箱?
7. **QQ SMTP**:接受它只适合小规模内测,公开前换事务邮件服务?(推荐接受,接口已留好。)
