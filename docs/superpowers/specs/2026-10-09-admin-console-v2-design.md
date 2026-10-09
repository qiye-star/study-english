# 管理后台 v2 — 设计文档

日期:2026-10-09 · 分支:`admin-v2-plan`(基于段位/联机计划分支)· 状态:草案(待产品负责人确认 §22)
实现计划:`docs/superpowers/plans/2026-10-09-admin-console-v2.md` · 视觉稿:`docs/superpowers/design/admin-v2/mockup.html`
前置:v1 只读管理端(`docs/superpowers/plans/2026-10-08-admin-console.md`)、段位赛与联机练习
(`docs/superpowers/specs/2026-10-09-rank-and-rooms-design.md`,正在实现;本文以"将存在"引用其表、模块与开关)。

产品文案用中文,代码标识符用英文。本文的数字(阈值、上限、间隔)都是**设计初值**,不是测得的数据。
费用一律是"估算"(按管理员录入的单价乘以计量单位),不是账单。

---

## 0. 一页摘要

| | v1(现状) | v2(本文) |
|---|---|---|
| 能力 | 只读:用户、对话、评测、录音、练习、词汇、概览 | 读写:运行时配置、段位规则、用户/房间治理、用量与费用、公告与维护、提示词、数据保留与备份、系统状态与日志 |
| 账号 | 环境变量单账号,无状态 HMAC token(Bearer,存 sessionStorage) | 环境变量账号保留为"应急超级管理员";另有库内管理员账号 + 三级角色;库内会话(HttpOnly Cookie + CSRF)、锁定、可选 TOTP、敏感操作二次验证 |
| 配置 | 只能改 `.env` 并重启容器 | 库内覆盖值叠加在 env 之上,由现有 `Settings` 模型校验;多数设置即时生效,少数"新会话生效"或"需重启";**永不写 `.env` 文件** |
| 审计 | 无 | 每个写操作一条审计记录(谁、何时、从哪、旧值→新值;密钥只记指纹),哈希链防篡改 |
| 段位 | — | 段位规则(点数、上限、阶段练习、晋级赛轮数/通过线/权重/门槛、情景池、考官/评委提示词)版本化:草稿 → 影响预演 → 发布;单人/全体重置(可撤销)、加减点、清冷却、重置次数、作废比赛 |

**三条底线**
1. Web 进程从不写 `.env`,也不改容器;配置只写数据库。数据库里的覆盖值坏了,容器照样能起来(无效覆盖被跳过并报警;`ADMIN_SETTINGS_SAFE_MODE=true` 一键忽略全部覆盖)。
2. 密钥只进不出:API 永不返回明文,日志与审计只见指纹;没有配置加密主密钥(`SETTINGS_ENCRYPTION_KEY`)时,密钥类设置在后台只读。
3. 所有写操作:角色校验 → (危险操作)二次验证 + 理由 + 输入确认 → 事务内写数据与审计 → 生效通知。

---

## 1. 目标、非目标、原则

**目标**
1. 运营者不登服务器就能改 `.env` 里能安全热改的一切,并知道每一项何时生效、改了什么、谁改的、怎么回滚。
2. 自定义段位赛:段位点规则、每日上限、阶段练习、晋级赛情景/轮数/通过线/权重/门槛/提示词,带版本与影响预演;重置段位与排位限制。
3. 治理:用户(停用、重置密码、配额)、房间(关闭、移出、禁 AI、举报处理)、邀请码。
4. 看得见成本:上游调用次数、错误率、估算费用、Top 用户;一键测试上游连接。
5. 运维:公告与维护模式、功能开关、提示词版本、数据清理、SQLite 备份、系统状态、脱敏日志。

**非目标(v2 不做)**
- 以用户身份登录(impersonation)。管理员只能看与改,不能"变成"某个用户。
- 从后台重启/重建容器、执行任意命令、编辑任意文件。
- 修改数据库连接、数据目录、管理端自身的引导账号与会话密钥(它们是 env-only,见 §3.1)。
- 段位结构变更(段位数量、key);段位显示名(仍由网页 i18n 提供)。
- 多实例/多 worker 部署的强一致(仍是单 worker;§3.6 的修订号轮询让多进程最终一致,但不作为支持目标)。
- 房间消息的批量清理工具(spec R-6:房间消息永久保留;手动清理工具列为以后)。

**原则**
- **只叠加,不改写**:env 是引导层,数据库覆盖是运行层;删掉覆盖即"恢复为 env"。
- **一个校验源**:有效配置永远由 `Settings(**merged)` 构造;覆盖值不能绕过 pydantic 的类型与 `Field(ge, le)` 约束,也不能绕过 `create_app` 里的跨字段检查(抽成 `runtime_problems()` 共用)。
- **快照不可变**:每个请求在开始时拿到一个 `Settings` 快照,整个请求内不变;改配置 = 原子替换 `app.state.settings`。
- **分层不破**:`core` 放注册表、合成、密钥箱、计量、维护中间件;`admin` 放业务;`routers` 放端点;由 `server/tests/test_architecture.py` 强制(§17)。
- **最小权限**:三级角色;危险操作要二次验证;所有拒绝也写审计。
- **能离线判的不调上游**:预演、校验、诊断都是纯函数;"测试连接"是显式按钮,并标注是否产生费用。

---

## 2. 现状与约束(读代码得出)

| 事实 | 位置 | 对 v2 的影响 |
|---|---|---|
| `get_settings` 每次读 `request.app.state.settings`,没有 `lru_cache` | `server/app/core/deps.py` | 替换 `app.state.settings` 即对新请求生效,不需要清缓存 |
| 启动时把部分设置"烤"进对象:`RateLimiter(limit)`、`TicketStore(ttl)`、`RealtimeRegistry(max)`、`grammar_rules`、`AsrGate(concurrency)`、懒建的 `app.state.azure/xfyun` 客户端 | `main.py`、`services/provider_clients.py`、`speech/asr.py`、`routers/ai_audio.py` | 需要"生效监听器"(§3.6)把新值推给这些对象,或标为需重启 |
| 实时通话在 `realtime_ws` 开头取 `settings = app.state.settings`,整通电话用这个快照 | `routers/realtime.py` | 通话类设置 = "新会话生效";进行中的通话不受影响 |
| 房间运行时 `runtime(app)` 懒建 `RoomLimits.from_settings(s)`、限流器、信号量(将存在,M6) | `routers/rooms.py` | 需要 `RoomsRuntime.reconfigure(settings)`(D 车道) |
| 段位常量在模块里:`TIERS`、`POINTS`、`STAGE_TASKS`、`THRESHOLDS`、`TURNS`、`LLM_WEIGHTS`、`scenarios.json`(将存在,R1/R2/R5) | `app/rank/*` | 引入 `RankRules`,以关键字参数 `rules=DEFAULT_RULES` 贯穿,默认值与常量逐项相等(§5.1) |
| 单 worker(`--workers 1`),SQLite 默认 | `server/Dockerfile` | 内存限流、内存日志缓冲可用;备份用 `VACUUM INTO` |
| `scripts/` 不在镜像里 | `server/Dockerfile` | 应急恢复命令放在 `app/admin/recover.py`(`python -m app.admin.recover`) |
| 管理前端:Vite + React 18 + react-router 7 + Tailwind 3,手机优先单列 + 底部 Tab,文案集中在 `strings.ts` | `admin/` | v2 改为响应式:≥1024 左侧导航 + 内容区;768–1023 图标侧栏;<768 保留底部 Tab;按功能分目录 |
| 迁移到 0005,段位/联机新增 0006 与 0007(`0007_rank_rooms_guards`) | `server/alembic/versions/` | v2 新增 `0008_admin_v2` |

---

## 3. 运行时配置

### 3.1 来源与优先级

```
           启动时一次                         运行中可变
.env / 环境变量 ──▶ base: Settings ──┐
                                     ├─▶ compose(base, overrides) ──▶ effective: Settings ──▶ app.state.settings
setting_overrides(数据库)───────────┘        │                                        (原子替换)
                                              └─ pydantic 校验 + spec 范围 + runtime_problems()
```

- **effective = base 叠加覆盖**。覆盖值优先于 env。删除覆盖 = 恢复为 env 值("恢复为 env")。
- **env-only(后台只读、不可覆盖)**:引导与安全边界类设置。后台展示其是否已设置(密钥类只显示"已设置/未设置 + 指纹"),旁边注明"只能在 `.env` 中修改并重启"。

| env-only 键 | 理由 |
|---|---|
| `DATABASE_URL` | 改了就连到别的库;含数据库密码(按密钥展示) |
| `DATA_DIR`、`WEB_DIST_DIR`、`ADMIN_DIST_DIR`、`BACKUP_DIR` | 文件系统路径,写错会让服务读写任意目录 |
| `ADMIN_USERNAME`、`ADMIN_PASSWORD`、`ADMIN_TOTP_SECRET` | 应急超级管理员;必须能在后台全坏时登录 |
| `ADMIN_SESSION_SECRET`、`SETTINGS_ENCRYPTION_KEY` | 会话与密钥箱的根密钥 |
| `ADMIN_SETTINGS_SAFE_MODE`、`ADMIN_IP_ALLOWLIST`、`ADMIN_COOKIE_SECURE` | 防止管理员把自己锁在外面或降低安全性 |
| `TRUST_PROXY_HEADERS` | 决定"客户端 IP"可信与否,是限流、锁定、IP 白名单的根 |
| `GRAMMAR_PROMPT_FILE` | 服务器上的文件路径;语法规则改为在"提示词"里编辑(§11) |
| `BUILD_SHA` | 构建产物信息 |

### 3.2 设置元数据注册表(`app/core/settings_registry.py`)

每个 `Settings` 字段**必须**有一条 `SettingSpec`(测试强制:新增字段而不登记 → 测试失败)。

```python
Apply = Literal["hot", "new_sessions", "restart"]
Kind = Literal["str", "text", "int", "float", "bool", "enum", "csv", "url", "date", "json", "secret"]

@dataclass(frozen=True)
class SettingSpec:
    key: str                     # Settings 字段名(小写);env 名 = key.upper()
    group: str                   # GROUPS 中的 key
    kind: Kind
    label_zh: str
    help_zh: str = ""
    apply: Apply = "hot"
    env_only: bool = False
    secret: bool = False         # 只进不出、加密存储
    danger: str | None = None    # 危险说明(非空即危险设置,§3.8)
    min: float | None = None     # 与 Field(ge/le) 取更严者;无 Field 约束的字段由这里补
    max: float | None = None
    choices: tuple[str, ...] | None = None   # 默认从 Literal 推导
    pair: str | None = None      # URL ↔ 密钥 配对(§3.5)
    managed_by: str | None = None  # "rank_rules":发布过段位规则后只读,去段位规则里改
```

分组(`GROUPS`,后台左侧二级导航):`registration` 注册与访问、`limits` 限流与配额、`llm` 大模型、`grammar` 语法检查、`tts` 语音合成、`asr` 语音识别、`assessment` 发音评测、`realtime` 实时通话、`rank` 段位赛、`rooms` 联机练习、`features` 功能开关、`admin` 管理端、`ops` 运维与维护、`system` 系统(env-only 只读项)。

**全量分类表**(`apply` 列:热 = hot,新 = new_sessions,重 = restart;"密" = secret;"危" = danger):

| 键 | 组 | 类型 | 生效 | 标记 | 备注 |
|---|---|---|---|---|---|
| `database_url` | system | secret | 重 | env-only | |
| `log_level` | ops | enum DEBUG/INFO/WARNING/ERROR | 热 | 危(DEBUG 噪声大) | 监听器重设 `app` logger 级别 |
| `registration_mode` | registration | enum | 热 | 危(`open`) | 每次注册读取 |
| `invite_code` | registration | secret | 热 | 密 | `invite` 模式需要非空(runtime_problems) |
| `trust_proxy_headers` | system | bool | 热 | env-only | |
| `rate_limit_per_minute` | limits | int 1–10000 | 热 | | 监听器改 `app.state.limiter.limit` |
| `ai_rate_limit_per_minute` | limits | int 1–10000 | 热 | 危(>600) | 改 `app.state.user_limiter.limit`;可按用户覆盖(§7.4) |
| `llm_max_tokens` | llm | int 64–32768 | 热 | | |
| `upstream_llm_base_url` | llm | url | 热 | 危;pair=`upstream_llm_key` | |
| `upstream_llm_key` | llm | secret | 热 | 密 | |
| `llm_models` | llm | csv | 热 | | `default_llm_model` 必须在其中 |
| `default_llm_model` | llm | str | 热 | | |
| `upstream_tts_base_url` / `upstream_tts_key` | tts | url / secret | 热 | 危+pair / 密 | |
| `tts_models` | tts | csv | 热 | | |
| `upstream_whisper_base_url` / `upstream_whisper_key` | asr | url / secret | 热 | 危+pair / 密 | |
| `upstream_whisper_mode`、`upstream_whisper_model` | asr | enum / str | 热 | | |
| `volcengine_tts_key`、`volcengine_tts_url` | tts | secret / url | 热 | 密 / 危+pair | |
| `upstream_asr_mode`、`asr_stream_url`、`asr_stream_resource_id`、`asr_stream_timeout_seconds` | asr | enum/url/str/float 5–120 | 热 | url 危+pair=`volcengine_asr_key` | |
| `asr_stream_max_concurrency` | asr | int 1–32 | 重 | | `AsrGate` 在首次使用时创建 |
| `volcengine_asr_key` | asr | secret | 热 | 密 | 空则复用 TTS key |
| `azure_speech_key`、`azure_speech_region` | assessment | secret / str | 热 | 密 / pair | 监听器丢弃 `app.state.azure` |
| `xfyun_app_id`、`xfyun_api_key`、`xfyun_api_secret`、`xfyun_ws_url` | assessment | str/secret/secret/url | 热 | 密;url 危+pair | 监听器丢弃 `app.state.xfyun` |
| `data_dir`、`web_dist_dir`、`admin_dist_dir` | system | str | 重 | env-only | |
| `recording_quota_mb`、`chat_orphan_grace_hours`、`max_conversations`、`max_messages_per_conversation`、`max_practice_items`、`max_vocab_items` | limits | int(上限见计划 A2) | 热 | | 可按用户覆盖 |
| `grammar_model`、`upstream_grammar_base_url`、`upstream_grammar_key` | grammar | str/url/secret | 热 | url 危+pair | |
| `grammar_prompt` | grammar | text ≤ `MAX_PROMPT_CHARS` | 热 | | 监听器的 prepare 阶段重跑 `load_grammar_rules`;被已发布的提示词版本覆盖(§11) |
| `grammar_prompt_file` | grammar | str | 重 | env-only | |
| `stt_max_tokens`、`stt_disable_thinking` | asr | int 32–4096 / enum | 热 | | |
| `asr_realtime_url`、`realtime_asr_mode` | realtime | url / enum | 新 | url 危+pair | |
| `realtime_enabled` | features | bool | 新 | 危(费用) | 关闭只拒绝新通话 |
| `realtime_max_minutes`、`realtime_idle_timeout_seconds`、`realtime_tts_model`、`realtime_tts_sample_rate`、`realtime_llm_disable_thinking` | realtime | int/int/str/enum 16000,24000/enum | 新 | | |
| `realtime_max_sessions` | realtime | int 1–100 | 热 | 危(>20) | 监听器 `RealtimeRegistry.set_max()`;不踢已在线 |
| `realtime_ticket_ttl_seconds` | realtime | int 10–300 | 热 | | `TicketStore.set_ttl()`,只影响新票据 |
| `rank_enabled` | features | bool | 热 | 危 | 将存在(S1) |
| `rank_daily_rp_cap`、`rank_match_daily_attempts`、`rank_match_cooldown_minutes`、`rank_match_minutes`、`rank_season_anchor`、`rank_season_weeks` | rank | int/date | 热 | managed_by=rank_rules | 发布过段位规则后只读(§5.2) |
| `rank_matches_global_daily`、`rank_judge_model` | rank | int / str | 热 | 前者 危(费用) | |
| `rooms_enabled` | features | bool | 热 | 危 | 关闭时在线房间连接以 4003 断开 |
| `rooms_ai_model`、`rooms_max_active`、`rooms_max_members`、`rooms_max_owned`、`rooms_idle_minutes`、`rooms_max_hours`、`rooms_ticket_ttl_seconds`、`rooms_assist_daily_per_user`、`rooms_ai_per_room_hour`、`rooms_ai_global_daily` | rooms | 见 S1 | 热 | `rooms_ai_global_daily` 危 | `RoomsRuntime.reconfigure()` |
| `rooms_ai_concurrency` | rooms | int 1–32 | 重 | | 信号量 |
| `room_message_retention_days` | rooms | int 0–3650 | 热 | 危(>0 会删除消息) | spec R-6:默认 0 = 永久保留 |
| `admin_username`、`admin_password`、`admin_session_secret`、`admin_totp_secret`、`settings_encryption_key`、`admin_settings_safe_mode`、`admin_ip_allowlist`、`admin_cookie_secure` | admin | — | 重 | env-only | |
| `admin_token_ttl_minutes` | admin | int 5–1440 | 热 | | 新会话生效 |
| `admin_idle_minutes` | admin | int 5–240 | 热 | | 会话空闲超时 |
| `admin_require_totp` | admin | bool | 热 | 危 | 打开前当前账号必须已绑定 TOTP |
| `admin_lockout_threshold`、`admin_lockout_minutes`、`admin_step_up_minutes`、`admin_audit_retention_days` | admin | int | 热 | | |
| `maintenance_mode`、`maintenance_message_zh`、`maintenance_message_en` | ops | enum off/read_only/full、text ≤ 280 | 热 | 前者 危 | §9 |
| `usage_prices_json`、`usage_currency`、`usage_raw_retention_days` | ops | json/str/int | 热 | | §8 |
| `backup_dir` | system | str | 重 | env-only | |
| `backup_keep`、`backup_hour_utc` | ops | int 1–60 / int -1–23 | 热 | | -1 = 不自动备份 |
| `app_version` | ops | str | 热 | | 客户端检查更新看到的版本号 |
| `build_sha` | system | str | 重 | env-only | |

新增设置(v2 引入,写进 `server/.env.example`):`SETTINGS_ENCRYPTION_KEY`、`ADMIN_SETTINGS_SAFE_MODE`、`ADMIN_IP_ALLOWLIST`、`ADMIN_COOKIE_SECURE`、`ADMIN_TOTP_SECRET`、`ADMIN_REQUIRE_TOTP`、`ADMIN_IDLE_MINUTES`、`ADMIN_LOCKOUT_THRESHOLD`、`ADMIN_LOCKOUT_MINUTES`、`ADMIN_STEP_UP_MINUTES`、`ADMIN_AUDIT_RETENTION_DAYS`、`MAINTENANCE_MODE`、`MAINTENANCE_MESSAGE_ZH`、`MAINTENANCE_MESSAGE_EN`、`USAGE_PRICES_JSON`、`USAGE_CURRENCY`、`USAGE_RAW_RETENTION_DAYS`、`BACKUP_DIR`、`BACKUP_KEEP`、`BACKUP_HOUR_UTC`、`BUILD_SHA`。

### 3.3 存储

```
setting_overrides   key PK String(64) | value Text | secret Bool | env_fp String(16) | revision Int | updated_at | updated_by String(64)
setting_revisions   id PK(= 修订号) | at | actor String(64) | reason String(200) | changes JSON | reverted_by Int?
config_revisions    name PK String(32) | revision Int | updated_at      -- 'settings' 'rank_rules' 'prompts'
```
- `value`:非密钥为 JSON 文本(`json.dumps(python_value)`);密钥为 `SecretBox.encrypt(明文)` 的 Fernet token。
- `env_fp`:保存覆盖时 env 值的指纹。之后若 `.env` 改了(指纹不同),后台在该项旁显示"env 已变更,覆盖仍生效"。
- `setting_revisions.changes`:`[{key, op: "set"|"reset", old, new}]`;非密钥存值,密钥存 `{"enc": token}`(回滚需要),**审计表里只存脱敏形式**(§3.7)。
- `config_revisions`:每类运行时配置一个单调递增的修订号;所有进程每 5 秒轮询一次(§3.6)。

### 3.4 校验

保存一组修改(一个"变更集")的流程,全部在 `app/admin/settings_service.py`:

1. **键检查**:键必须在注册表里;`env_only` 拒绝(400 `Setting is read-only`);`managed_by` 已生效时拒绝(409 `Managed by rank rules`)。
2. **类型强转** `coerce(spec, raw)`:前端送 JSON 值;`csv` 规范化(去空项、去首尾空白、去重保序);`url` 必须是 `http(s)://` 或 `ws(s)://`(按字段),无用户名密码部分、无片段;`json` 必须可解析并通过该键的 schema(如价格表)。
3. **范围**:`spec.min/max` 与 `Field(ge, le)` 双重(pydantic 本身也会拒)。
4. **合成**:`compose(base, {**现有覆盖, **本次})` → `Settings(_env_file=None, **merged)`;`ValidationError` 映射回字段 → 422 `{"error":"Invalid settings","fields":{"key":"msg"}}`。
5. **跨字段** `runtime_problems(settings)`:`invite` 模式要邀请码;`DEFAULT_LLM_MODEL ∈ LLM_MODELS`;(env)管理员密码 ≥ 12 位;`room_message_retention_days` 为 0 或 ≥ 1;`create_app` 改为调用同一函数,保证"能保存的配置一定能启动"。
6. **监听器预检(prepare)**:例如语法规则重新加载失败 → 拒绝保存。
7. **危险检查**(§3.8)与**配对检查**(§3.5)。
8. 通过后事务内:写/删 `setting_overrides`、追加 `setting_revisions`、`config_revisions['settings'] += 1`、写审计;提交后发布(§3.6)。

### 3.5 密钥

- **加密存储**:`SETTINGS_ENCRYPTION_KEY`(env-only,Fernet 32 字节 urlsafe base64;`.env.example` 写生成命令)。未设置时:所有密钥类设置在后台只读,显示"未配置加密主密钥,密钥只能在 `.env` 中修改";诊断页给出提示。依赖新增 `cryptography`(Fernet = AES-128-CBC + HMAC-SHA256,带时间戳,篡改即解密失败)。
- **只进不出**:读接口对密钥只返回 `{"set": bool, "source": "env"|"override"|"none", "fp": "a1b2c3d4"}`;`fp` = HMAC-SHA256(admin_secret, 值) 的前 8 个十六进制字符,仅用于"两处是不是同一个值"的比较,不可逆。表单里密钥输入框为 `type=password`、`autocomplete=off`,留空 = 不修改;"清除覆盖"是单独按钮。
- **永不记录**:密钥值不进日志、审计、错误信息、异常字符串(pydantic 的 `ValidationError` 文本可能回显输入,密钥字段的错误统一替换为 `invalid value`)。日志缓冲(§13)额外按"当前所有密钥值"做精确匹配脱敏。
- **主密钥轮换**:`python -m app.admin.recover rotate-key --old ... --new ...`(读 env 旧键解密、新键加密,事务内重写);后台不提供。
- **解密失败**(主密钥换了但没轮换):该覆盖被视为无效 → 跳过并在设置页标红"无法解密,请重新填写或清除",服务照常启动(用 env 值)。
- **URL ↔ 密钥配对守卫**:改了某个上游 `*_BASE_URL`/`*_URL` 而**没有同时**提交其配对密钥时,保存被拒(409 `Key would be sent to a new host`),除非请求里带 `confirm_pairs: ["upstream_llm_base_url"]` —— 界面上是一个明确的勾选:"我确认把现有密钥发送到新地址 {host}"。原因:改地址不换密钥 = 把现有密钥发给新主机,是最容易被忽视的泄露路径。只改路径不改主机(`host` 相同)不触发。

### 3.6 生效机制(热更新)

**快照与替换。** `Settings` 对象视为不可变。`SettingsHub.publish(new)` 依次:

1. `prepare` 阶段:逐个调用监听器的 `prepare(new)`(可抛错 → 整个保存回滚,见 §3.4 第 6 步);
2. `app.state.settings = new`(一次赋值,Python 层面原子);
3. `apply` 阶段:逐个调用 `apply(old, new)`;单个监听器失败只记日志(键名与异常类型,不含值)并在设置页显示"部分组件未能应用,建议重启",不回滚已提交的数据。

每个请求通过 `Depends(get_settings)` 拿到开始时的快照;同一请求内不会看到半新半旧的值。

**监听器(A3 注册核心项;车道按需自注册)**

| 监听器 | 触发键 | 动作 | 注册者 |
|---|---|---|---|
| logging | `log_level` | `configure_logging(new.log_level)` | A3 |
| limiter | `rate_limit_per_minute` | `app.state.limiter.limit = n` | A3 |
| user_limiter | `ai_rate_limit_per_minute` | `app.state.user_limiter.limit = n` | A3 |
| realtime_tickets | `realtime_ticket_ttl_seconds` | `TicketStore.set_ttl(n)`(新增方法) | A3 |
| realtime_registry | `realtime_max_sessions` | `RealtimeRegistry.set_max(n)`(新增方法;不踢在线) | A3 |
| provider_clients | `azure_*`、`xfyun_*` | 删除 `app.state.azure` / `app.state.xfyun`,下个请求按新值重建 | A3 |
| grammar_rules | `grammar_prompt` | prepare:`load_grammar_rules(new)`;apply:写 `app.state.grammar_rules`(除非提示词有已发布版本,§11) | A3 |
| log_secrets | 任一密钥 | 更新日志缓冲的精确脱敏集合 | E4 |
| rooms_runtime | `rooms_*` | `RoomsRuntime.reconfigure(new)`:换 `RoomLimits`、更新限流器上限、`rooms_enabled` 关 → `hub.close_all(4003)`;`maintenance_mode != off` → `hub.close_all(1012)` | D4(在 `runtime(app)` 首次创建时自注册) |
| metering_prices | `usage_prices_json` | 重新解析价格表 | E2 |

**"新会话生效"**:实时通话在连接开始时取快照(现状),所以 `realtime_*`、`asr_realtime_url` 等改动只影响之后的通话;界面在该项旁显示"新通话生效",保存后提示"当前 N 通通话仍按旧设置进行"(N = `RealtimeRegistry.active_count`)。关闭 `REALTIME_ENABLED` 不挂断进行中的通话(之后可加"结束全部通话",§14)。

**"需重启"**:值保存后立即进入数据库,但当前进程继续用旧值;设置页该项显示琥珀色"待重启"徽标与"当前生效值 / 重启后的值";系统页列出全部待重启项。重启由运维在服务器上执行(`docker compose restart server`),后台不提供重启按钮(§22-7)。启动时 lifespan 读取覆盖,于是"待重启"项自然生效。

**多进程/重启一致性。** 启动 lifespan:`await reload_from_db(app)`(读全部覆盖 → compose → publish)。后台任务 `watch_revisions(app)` 每 5 秒读 `config_revisions`,发现 `settings` 修订号变化就 `reload_from_db`;`rank_rules`、`prompts` 修订号变化则调用各自缓存的 `invalidate()`。单 worker 下发起修改的进程立即生效,其他进程(若有)≤ 5 秒内跟上。测试用 `httpx.ASGITransport`(不跑 lifespan)时显式调用 `reload_from_db`。

**无效覆盖不阻止启动。** `reload_from_db` 逐键 compose:某个覆盖值让校验失败(例如代码升级后范围收紧)→ 跳过该键、日志写一行 `settings override ignored key=<key> reason=<code>`、设置页标红;其他覆盖照常生效。`ADMIN_SETTINGS_SAFE_MODE=true` 时完全不读覆盖(后台顶部红条提示"安全模式:数据库覆盖已全部忽略")。

### 3.7 审计、历史、回滚、恢复为 env、导入导出

- **审计**:每个变更集一条 `settings.update`(或 `settings.reset` / `settings.revert` / `settings.import`)审计记录,`before/after` 只含被改的键;密钥键写 `{"set": true, "fp": "…"}`。
- **历史**:设置页"历史"抽屉按修订号列出:时间、操作人、理由、改了哪些键(非密钥显示旧→新)。
- **回滚**:"撤销此修订" = 以该修订的 `old` 值生成一个新变更集(仍走 §3.4 全部校验与危险检查);如果其中某键在之后又被改过,界面列出冲突键并要求逐项确认。不提供"回到某时刻"的批量穿越(容易误伤后来的修复)。
- **恢复为 env**:单项"恢复为 env"按钮 = 删除该覆盖(`op: reset`);"全部恢复为 env"在系统页,超级管理员 + 二次验证 + 输入 `RESET SETTINGS`。
- **导出**:`GET /api/admin/settings/export` → `{"format":"enjoy-admin-settings","version":1,"exported_at","app_version","overrides":{"RATE_LIMIT_PER_MINUTE":20,...},"secrets_omitted":["UPSTREAM_LLM_KEY",...]}`。密钥永不导出。
- **导入**:上传同格式 JSON → `POST /api/admin/settings/import/preview` 返回差异(新增/修改/不变/拒绝及原因)→ 界面确认 → `POST /api/admin/settings/import/apply`(作为一个变更集;未知键、env-only 键、密钥键一律拒绝;危险项照样要确认)。

### 3.8 危险设置保护

`danger` 非空的键,或满足"危险值"规则的修改(如 `registration_mode` 改为 `open`、`ai_rate_limit_per_minute > 600`、`room_message_retention_days > 0`、`maintenance_mode = full`、任何上游 URL 改主机),保存时:

1. 要求角色 `superadmin`;
2. 要求二次验证在 `ADMIN_STEP_UP_MINUTES`(默认 5)分钟内(§4.6);
3. 请求体带 `reason`(≥ 4 字)与 `confirm`:界面弹出"保存前差异"对话框,列出每一项旧→新与危险说明,用户在输入框里打出该键的 env 名(多项时打 `CONFIRM`)。

`danger` 文案写在注册表里(`danger="打开后任何人都能注册并消耗你的上游额度"`),前端直接展示。

### 3.9 故障恢复

| 情况 | 办法 |
|---|---|
| 覆盖值导致功能异常(但能启动) | 后台"恢复为 env"或撤销修订 |
| 后台无法登录 / 被锁 | env 应急账号(`ADMIN_USERNAME/ADMIN_PASSWORD`)始终可用;其锁定只按"用户名 + IP"计(§4.4) |
| 覆盖值导致服务启动后异常且后台不可用 | `.env` 设 `ADMIN_SETTINGS_SAFE_MODE=true` 并重启 → 只用 env;修好后去掉 |
| 需要命令行处理 | `docker compose exec server python -m app.admin.recover <cmd>`:`list-overrides`、`clear-overrides [--key K]`、`unlock <username>`、`reset-totp <username>`、`revoke-sessions`、`rotate-key`。每个命令写一条 `actor="cli"` 的审计 |

### 3.10 配置诊断与测试连接

- **诊断**(`app/admin/doctor.py`,纯函数 `diagnose(settings, facts) -> list[Finding]`):每条 `Finding(level: "error"|"warn"|"info", code, keys, message_zh)`。示例:`REALTIME_ENABLED` 已开但不可用(逐条给出原因:缺火山 TTS key / `REALTIME_TTS_MODEL` 不在 `TTS_MODELS` / 识别不可用)、段位晋级赛不可用、`registration_mode=open`、未设加密主密钥、超级管理员未绑定 TOTP、`ADMIN_COOKIE_SECURE=false`、有覆盖值 env 已漂移、有无效覆盖、有待重启项、SQLite 且未配置备份、`USAGE_PRICES_JSON` 缺少正在使用的模型的单价。概览页顶部显示 error/warn 计数。
- **测试连接**(`app/admin/probes.py`,超级管理员):对每个上游给一个按钮,可用"已保存的值"或"表单里尚未保存的值"(密钥未填则用已保存的)。只返回 `{ok, status, ms, code}`,`code ∈ {ok, auth, not_found, timeout, network, tls, bad_response, not_configured}`,**不返回上游响应体**,不跟随重定向,超时 8 秒。

| 上游 | 探测 | 费用 |
|---|---|---|
| LLM / 语法 LLM | `GET {base}/models` 带 key;404 时退回 1 token 的 chat completion(需勾选"允许产生少量费用") | 通常免费 |
| OpenAI 兼容 TTS / Whisper | `GET {base}/models` | 免费 |
| 豆包 TTS / 流式识别 | 仅 TCP+TLS 连通(不发鉴权请求) | 免费;界面注明"只验证连通性" |
| Azure Speech | `POST https://{region}.api.cognitive.microsoft.com/sts/v1.0/issueToken` | 免费 |
| 讯飞 ISE | 签名 URL 完成 WebSocket 握手后立即关闭 | 免费 |

所有探测写审计 `probe.run`(只记上游名与结果码)。地址只允许 http(s)/ws(s),探测前解析主机名并拒绝回环与私网地址(防 SSRF);若上游本来就在内网,探测返回 `blocked_private` 并在界面说明"内网上游请在服务器上用 `scripts/smoke.py` 验证",后台不提供放开开关。

---

## 4. 认证与权限

### 4.1 账号

- **应急超级管理员**:env 的 `ADMIN_USERNAME/ADMIN_PASSWORD`(v1 机制保留)。总是 `superadmin`,不能在后台删改;可用 `ADMIN_TOTP_SECRET`(env-only)开启 TOTP。v1 的"二者皆空则整个管理端 404"保持:**未设置 env 账号时管理端整体关闭**,库内账号也无法登录(防止忘了关后台)。
- **库内管理员**(`admin_accounts`):`username`(3–32,`[a-z0-9_.-]`,与 env 账号不能同名)、`password_hash`(argon2,复用 `core.security`)、`role`、`totp_enc`(SecretBox 加密)、`totp_last_step`(防重放)、`disabled_at`、`created_by`、`created_at`、`last_login_at`、`password_changed_at`。只有超级管理员能建/停用/改角色/重置 TOTP;最后一个启用中的库内超级管理员不能被降级(env 账号不计入)。

### 4.2 角色与权限矩阵

| 能力 | viewer 只读 | operator 运营 | superadmin 超级 |
|---|---|---|---|
| 概览、用户/对话/评测/录音(v1 全部) | ✓ | ✓ | ✓ |
| 段位/比赛/房间/举报 查看,用量与系统状态 | ✓ | ✓ | ✓ |
| 审计日志 | 只看自己的 | ✓ | ✓ |
| 日志查看器 | | ✓ | ✓ |
| 单个用户:停用/启用、撤销登录、重置密码、配额覆盖 | | ✓ | ✓ |
| 单个用户段位:清冷却、重置次数、加减点、作废比赛、成就 | | ✓ | ✓ |
| 单个用户段位重置/定级 | | ✓(二次验证) | ✓ |
| 房间:关闭、移出、禁 AI、处理举报;邀请码;公告 | | ✓ | ✓ |
| 运行时设置(含功能开关)、维护模式 | 只读(密钥只见状态) | 只读 | ✓ |
| 段位规则发布、全体段位重置/撤销 | 只读 | 只读 + 编辑草稿 | ✓ |
| 提示词发布、测试运行 | 只读 | 编辑草稿 | ✓ |
| 管理员账号、会话(他人)、备份下载、数据清理、删除用户、导入设置、测试连接 | | | ✓(多数要二次验证) |

实现:`app/admin/perms.py` 定义 `Role = Literal["viewer","operator","superadmin"]`、`RANK = {"viewer":0,"operator":1,"superadmin":2}`、依赖工厂 `require(role)`;每个端点在路由声明里写最低角色(测试遍历所有 `/api/admin/*` 路由断言都声明了角色,防遗漏)。

### 4.3 会话、Cookie、CSRF

- **库内会话** `admin_sessions`:`id`(UUID)、`token_hash`(SHA-256)、`account_id`(NULL = env 账号)、`username`、`created_at`、`last_seen_at`、`expires_at`(`ADMIN_TOKEN_TTL_MINUTES`)、`ip`、`user_agent`(截 120)、`mfa_at`、`step_up_at`、`csrf_hash`、`revoked_at`。空闲超过 `ADMIN_IDLE_MINUTES`(默认 30)视为过期。`last_seen_at` 每分钟最多写一次。
- **Cookie**:`ADMIN_COOKIE_SECURE=true`(默认)时名为 `__Host-enjoy_admin`,`Secure; HttpOnly; SameSite=Strict; Path=/`;本地 http 开发设 false,名为 `enjoy_admin`(无 Secure)。token 为 32 字节随机,只在 Set-Cookie 里出现一次,前端 JS 拿不到。
- **CSRF**:登录与 `GET /api/admin/session` 返回 `csrf_token`(随机,服务端存哈希);前端放内存,所有非 GET 请求带 `X-Admin-CSRF`。另校验 `Origin`(有则必须与 `Host` 同源)。SameSite=Strict + 双重提交 + Origin 三道。
- **v1 的 Bearer token 停用**(§22-2):`Authorization: Bearer` 对 `/api/admin/*` 一律 401。录音 `<audio>` 直接用 cookie 拉取,不再 blob 中转(保留 blob 方式也可)。
- **会话列表与撤销**:"我的会话"(设备、IP、最近活动、当前会话标记)可撤销任一;超级管理员可查看/撤销任何人的会话;改密码、停用账号、重置 TOTP 时撤销该账号全部会话。

### 4.4 限流与锁定

- 登录接口:沿用 `auth_rate_limit`(按 IP,`RATE_LIMIT_PER_MINUTE`)。
- 锁定:`admin_login_state(username, ip)` 计连续失败;达到 `ADMIN_LOCKOUT_THRESHOLD`(默认 5)锁 `ADMIN_LOCKOUT_MINUTES`(默认 15),再次触发翻倍,封顶 24 小时;成功清零。另有按用户名的全局计数(任意 IP,阈值 ×4)用于发现分布式猜测,只告警(写审计 + 诊断 warn)不锁 —— 避免攻击者锁死应急账号。
- 锁定期间不论密码对错都返回 429 `Too many attempts`(不泄露密码是否正确);不存在的用户名同样计数、同样响应(不泄露账号是否存在);密码校验对不存在的账号也跑一次 argon2(等时)。

### 4.5 IP 白名单

`ADMIN_IP_ALLOWLIST`(env-only,逗号分隔 CIDR,空 = 不限制):对 `/admin/**` 与 `/api/admin/**` 生效,判定用现有 `client_ip()`(受 `TRUST_PROXY_HEADERS` 控制);不在名单内一律 404(与"未启用"不可区分)。

### 4.6 TOTP 与二次验证

- **TOTP**(RFC 6238,SHA-1,6 位,30 秒,±1 步;标准库 `hmac` 实现,不加依赖):自愿绑定;`ADMIN_REQUIRE_TOTP=true` 时超级管理员必须绑定才能执行任何写操作(登录后引导绑定)。绑定流程:生成 base32 密钥 → 显示 `otpauth://` URI 与密钥文本(v2 不渲染二维码)→ 输入一次验证码确认 → 加密存储。同时生成 8 个一次性恢复码(只显示一次,存 argon2 哈希)。需要 `SETTINGS_ENCRYPTION_KEY`(否则不可绑定,诊断提示)。
- **登录**:有 TOTP 的账号两步:密码 → `mfa_required` → 验证码(或恢复码)。
- **二次验证(step-up)**:危险操作前要求重新输入密码(+ TOTP 若已绑定),成功后会话的 `step_up_at = now`,有效 `ADMIN_STEP_UP_MINUTES` 分钟。服务端在危险端点用 `require_step_up` 依赖检查,前端收到 403 `Step-up required` 弹出验证框后重试原请求。

### 4.7 审计日志

`admin_audit`(只追加):`id`、`at`、`actor`(用户名或 `cli`)、`role`、`session_id`、`ip`、`action`(如 `settings.update`、`rank.user.reset`、`room.close`、`auth.login.fail`)、`target_type`、`target_id`、`summary`(≤ 200,机器可读的短语,不含用户内容)、`before`/`after`(JSON,已脱敏)、`reason`、`result`(`ok`/`denied`/`error`)、`prev_hash`、`hash`。

- `hash = sha256(prev_hash + canonical_json(row 不含 hash))`,形成哈希链;`GET /api/admin/audit/verify` 校验整链(或区间),断链显示红条。不能防 DBA 改库,但能发现误删与篡改。
- 记录:登录成功/失败/锁定、登出、二次验证、所有写操作、权限拒绝、备份下载、日志查看(只记一次/会话)、导出、测试连接。
- **永不记录**:密码、验证码、恢复码、token、密钥明文、用户对话与转写、提示词全文(只记版本号)。
- 保留:`ADMIN_AUDIT_RETENTION_DAYS`(默认 365);清理通过 §12 的工具手动执行(本身也审计),清理后链从剩余首条重新起算并记录锚点。

---

## 5. 段位管理

### 5.1 规则模型(`app/rank/rules.py`,将存在的 rank 包内新增)

```python
class TierRule(BaseModel):        key: TierKey; division_rp: int = Field(ge=20, le=2000)
class PointsRule(BaseModel):
    assessment_bands: tuple[tuple[int, int], ...]   # ((85,4),(70,3),(0,1)):分数下限 → 点数,降序,最后一档下限为 0
    chat_turn: int = 1; vocab_review: int = 1; active_day: int = 5; streak_7: int = 15; stage_task: int = 10   # 各 0–100
    daily_cap: int = Field(60, ge=0, le=1000)
class StageTaskRule(BaseModel):   key: str; kind: Literal["assess","chat_turns","voice_turns","vocab_reviews","active_days"]
                                  target: int = Field(ge=1, le=1000); min_score: int | None = Field(None, ge=0, le=100)
class MatchRule(BaseModel):
    turns: dict[int, int]          # 目标段位 1–6 → 3–12
    thresholds: dict[int, int]     # 1–6 → 0–100
    llm_weights: dict[str, float]  # task/accuracy/range/interaction
    speech_weight: float           # 与 llm_weights 之和 = 1(±0.001)
    borderline: int = 3; gate_task_min: int = 2; gate_english_ratio: float = 0.7
    min_seconds: float = 1.5; max_seconds: float = 30.0
    daily_attempts: int = 3; cooldown_minutes: int = 30; match_minutes: int = 20; fail_keep: float = 0.8
    examiner_prompt: str; judge_prompt: str  # 模板,必须包含规定占位符(§11.2)
class SeasonRule(BaseModel):      anchor: date; weeks: int = Field(ge=1, le=52)
class ScenarioRule(BaseModel):    # 同 Scenario 字段 + enabled
class RankRules(BaseModel, frozen=True):
    tiers: tuple[TierRule, ...]; points: PointsRule; stage_tasks: dict[int, tuple[StageTaskRule, ...]]
    match: MatchRule; season: SeasonRule; scenarios: tuple[ScenarioRule, ...]
DEFAULT_RULES: RankRules           # 由 R1/R2/R5 的常量与 scenarios.json 构造;测试断言逐项相等
def rules_from_settings(s: Settings) -> RankRules   # v0:常量 + 当前 env 的 6 个 rank_* 数值
```

**贯穿方式(向后兼容)**:R1–R7 的函数增加仅关键字参数 `rules: RankRules = DEFAULT_RULES`(如 `division_rp(tier, *, rules=DEFAULT_RULES)`、`stage_progress(tier, events, *, rules=...)`、`verdict(judge, turns, target_tier, *, rules=...)`、`pick_scenario(target_tier, recent, rng, *, rules=...)`、`ledger.sync(..., rules=...)`、`match.start_match(..., rules=...)`)。不传即与现在完全一致,所以 rank 车道已有的测试无需修改;`routers/rank.py` 统一传入 `rank_rules(app).current`。

**校验(`validate_rules(rules, facts) -> list[str]`,发布前必须为空)**:段位数为 7 且 key 顺序不变;每个目标段位 1–6 至少 2 个启用情景,情景 key 唯一,`functions` 3–4 条且各 ≤ 120 字,`opener` 非空 ≤ 300;阶段任务 0–5 每段 1–4 项、6 为空;权重和为 1;通过线 0–100;`assessment_bands` 降序且末档为 0;提示词模板占位符完整;赛季在第 1 赛季开始后不可改(见 §5.4)。

### 5.2 版本化:草稿 → 预演 → 发布

```
rank_rule_sets  id PK | version Int?(发布时分配,唯一) | status draft|published|archived | rules JSON | note String(200)
                created_by | created_at | published_by | published_at
```
- 同一时刻最多一个草稿;"新建草稿"从当前已发布版本(没有则 v0 = `rules_from_settings`)复制。
- 编辑草稿:operator 及以上;发布:superadmin + 二次验证 + 理由。发布 = 事务内把旧 published 置 archived、草稿得到 `version = max+1`、`config_revisions['rank_rules'] += 1`、审计(只记版本号与差异摘要)。
- **已发布版本不可变**;"回滚到 vN" = 以 vN 为内容新建草稿再发布(版本号继续增长)。
- **比赛钉住版本**:`promotion_matches.rules_version`(0008 新增列,NULL = v0/默认)。比赛进行中规则改了,该场仍按开始时的版本出题、计轮、评分(`threshold` 本来就存在比赛行里)。
- **生效范围**:点数规则只影响之后同步入账的事件(不追溯重算已入账的 `xp_events`,§22-6);`division_rp` 变小时,超出的点数在下次同步时截到新上限(段位门封顶规则不变);阶段任务改动立即影响"是否可打晋级赛"的判断。
- **与 env 的关系**:发布过任一版本后,注册表中 `managed_by="rank_rules"` 的 6 个 env 设置在设置页只读并链接到段位规则;未发布前它们照常作为 v0 的来源。
- **运行时缓存**:`rank_rules(app) -> RulesCache`(懒建、自注册到修订号轮询;`current` 属性;`invalidate()`;`by_version(n)` 带 LRU 8)。

### 5.3 影响预演(`app/admin/rank_sim.py`)

`simulate(session, draft, current, now) -> Impact`,只读,单次耗时目标 < 2 秒(数据量:最近 14 天事件、最近 30 天比赛):

| 指标 | 算法 |
|---|---|
| 段位门变化 | 每个档案在当前/草稿规则下 `at_gate` 的人数;`rp > 新 division_rp` 将被截断的人数 |
| 阶段练习 | 每个档案按 `tier_started_at` 以来的 `xp_events` 计算"全部完成"人数(当前 vs 草稿) |
| 每日上限 | 最近 14 天每个"用户·日"按草稿点数规则重算候选点数(`kind` + `score` 足够),统计触顶的用户日占比与人均日点数 |
| 晋级赛判定 | 最近 30 天已结束比赛:用存下的维度分与轮次事实,按草稿权重/通过线/门槛重算,列出 通过→未通过、未通过→通过 的场数(仅提示,不改历史) |
| 情景池 | 每个目标段位启用情景数;被删除的情景是否被进行中的比赛使用(钉住版本,所以只提示) |
| 估算节奏 | 按"每天练 15 分钟 ≈ 40–60 点"(spec §2.2 的估算)给出每个段位预计天数,标"估算" |

### 5.4 赛季

v2 中赛季配置(`anchor`、`weeks`)**仅在第 1 赛季开始前可改**;开始后只读。原因:`season_of` 与赛季徽章都是由锚点推算的,中途改锚点会让历史赛季与已发徽章错位。显式的 `seasons` 表与"提前结束本赛季"列为以后(§14)。

### 5.5 单个用户的段位操作(`app/admin/rank_ops.py`)

| 操作 | 角色 | 效果 | 审计 action |
|---|---|---|---|
| 查看 | viewer | 段位、点数、阶段练习、冷却、今日剩余次数、最近事件、比赛列表(含每轮转写与分数、评委结果)、成就 | — |
| 清除冷却 | operator | `cooldown_until = NULL` | `rank.user.clear_cooldown` |
| 重置今日次数 | operator | 删除该用户本地日的 `daily_usage(scope='rank_match')` 行(按管理员所选日期) | `rank.user.reset_attempts` |
| 加/减点 | operator | 写 `xp_events(kind='admin_adjust', ref_id='audit:{audit_id}', points=±n)`;正数走 `add_rp`;负数只在本小段内减到 0(不降级,R-1);理由必填 | `rank.user.adjust_points` |
| 作废比赛 | operator | 状态 → `voided`(0008 允许);若该场是失败:恢复 `rp = division_rp`(比赛只能在段位门开始,所以失败前一定是满点)并清冷却;退还当日次数 | `rank.match.void` |
| 重新评分 | operator | 仅 `grading_failed` 的比赛,调用 rank 路由的 `finish` 逻辑 | `rank.match.regrade` |
| 授予/撤销成就 | operator | 写/删 `user_achievements` | `rank.user.achievement` |
| 重置段位 / 定级 | operator + 二次验证 | 设为指定 `tier/division/rp`(默认青铜 III 0 点),`tier_started_at = now`,清冷却;事件流水保留;先写快照 | `rank.user.reset` |
| 按用户覆盖每日次数 | operator | `user_quota_overrides(key='rank_match_daily_attempts')` | `quota.set` |

### 5.6 全体操作

- **全体段位重置**:superadmin + 二次验证 + 输入 `RESET {N} USERS`;全员回青铜 III 0 点(`tier_started_at = now`,清冷却;`xp_events` 流水保留)。只清赛季积分的模式需要赛季锚点表,与显式赛季表一起列为以后(§14-20)。执行前把全部 `rank_profiles` 写入 `rank_profile_snapshots(batch_id, user_id, data, at)`;"撤销本次重置"在 7 天内可用(恢复快照,之后快照删除)。
- **清除全部冷却 / 重置全站今日次数**:operator + 理由(用于事故后补偿,如评委上游故障)。
- **排行榜封禁**:v1/v2 没有排行榜;封禁列为以后(与 spec §14 P1-7 一起做)。

---

## 6. 联机房间管理

将存在的表:`rooms`、`room_members`、`room_messages`、`room_reports`;运行时 `RoomsRuntime`(`app.state.rooms`)。

| 功能 | 角色 | 说明 |
|---|---|---|
| 房间列表 | viewer | 筛选 open/closed、房间号、房主;列:话题、房间号、房主、成员数、在线数(`hub.online`)、消息数、最近活动、关闭原因 |
| 房间详情与记录 | viewer | 成员(角色、加入/离开/被移出)、消息时间线;公共通道默认展示,私聊助手通道需点"显示私聊"(写审计 `room.view_private`);房间消息永久保留(R-6),记录完整可查 |
| 关闭房间 | operator | `store.close(room_id, "admin", now)` + 广播 `closed{reason:"admin"}` + 4004 断开;网页新增文案 `closed_admin` |
| 移出成员 | operator | 标记 `kicked`,写系统消息 `kicked`,`hub.close_user(..., 4010)` |
| 禁用本房 AI | operator | `rooms.ai_muted = true`(0008 新增):`@ai` 与助手私聊都回 `notice{code:"ai_off"}`;恢复同理 |
| 举报队列 | operator | `room_reports` 增加 `resolved_at/resolved_by/resolution(dismissed|removed_message|kicked|closed_room)`;处理动作一键联动上面的操作 |
| 隐藏消息 | operator | `room_messages.hidden_at`(0008 新增):对成员显示"该消息已被管理员隐藏",不删除(与 R-6 一致) |
| 房间限额 | superadmin | 即 `rooms_*` 设置(§3.2),热更新 |
| 手动清理消息 | — | 以后(R-6) |

所有房间写操作经 `routers/admin_rooms.py`,它通过 `app.routers.rooms.runtime(app)` 取得 hub(routers 可以导入 routers;admin 包不导入 routers)。

---

## 7. 用户管理

| 功能 | 角色 | 说明 |
|---|---|---|
| 列表/搜索 | viewer | v1 已有;新增筛选"已停用"、排序"最近活跃/注册时间/录音占用" |
| 停用/启用 | operator | `users.disabled_at`(0008);`current_user` 对停用用户返回 403 `Account disabled`;停用时删除该用户全部 `access_tokens`、作废未用的语音 token,并把其房间连接以 4010 断开 |
| 撤销登录 | operator | 删除 `access_tokens`(用户在所有设备上需重新登录) |
| 重置密码 | operator | 服务端生成 16 位临时密码,**只在响应里出现一次**(界面"复制"后关闭即不可再看),同时撤销登录;不写日志、不进审计(审计只记"已重置") |
| 配额覆盖 | operator | `user_quota_overrides(user_id, key, value, expires_at?, note)`;键:`recording_quota_mb`、`max_conversations`、`max_messages_per_conversation`、`max_practice_items`、`max_vocab_items`、`ai_rate_limit_per_minute`、`rank_match_daily_attempts`、`rooms_assist_daily_per_user`、`rooms_max_owned`;读取统一走 `core/quotas.quota_for()`(放在 core,因为 `core/deps.limited_user` 也要读) |
| 删除用户 | superadmin + 二次验证 + 输入用户名 | 级联删除库内数据与录音目录;不可撤销;审计保留用户名与 id |
| 邀请码 | operator | `invite_codes`:多码、标签、可用次数、到期时间、撤销;明文只在创建时显示一次(存 SHA-256);`invite` 模式下 env 的 `INVITE_CODE` 与库内有效码都可用,使用时原子 +1 |
| 用户数据导出 | — | 以后(§14) |

---

## 8. 用量与成本

### 8.1 计量(`app/core/metering.py`)

- **记录点**:所有上游调用处调用 `metering.record(kind, provider, model, status, ms, units_in, units_out, unit)`。`kind ∈ {llm, tts, stt, asr_stream, assess_azure, assess_xfyun, probe}`;`feature` 与 `user_id` 来自 contextvar:`MeteringMiddleware` 按路径前缀设定 feature(`/api/ai/chat` → `chat`、`/api/ai/audio` → `audio`、`/api/ai/grammar` → `grammar`、`/api/speech` → `assessment`、`/api/realtime` → `realtime`、`/api/rank` → `rank`、`/api/rooms` → `rooms`、`/api/admin` → `admin`),`current_user` 绑定 user_id。
- **不阻塞请求**:记录进内存队列(上限 10 000 条,满了丢最旧的并计数),后台任务每 5 秒批量写 `upstream_calls`。重启丢失最多 5 秒的计量,可接受。
- **单位**:LLM 非流式取响应里的 `usage.prompt_tokens/completion_tokens`(`unit=tokens`);流式与拿不到 usage 的记输出字节数(`unit=bytes`);TTS 记字符数;识别记音频毫秒;评测记次数。**只记数字**,不记文本。
- **表**:`upstream_calls(id, at, user_id?, feature, kind, provider, model, status, ms, units_in, units_out, unit)`,索引 `(at)`、`(user_id, at)`;每小时把 2 天前的原始行汇总进 `usage_daily(day, feature, kind, provider, model, user_id?, calls, errors, units_in, units_out, ms_total)`,并删除超过 `USAGE_RAW_RETENTION_DAYS`(默认 90)的原始行。

### 8.2 仪表盘

- 时间范围 1/7/30/90 天;KPI:调用数、错误率、估算费用、P50/P95 耗时(原始行可用时)、活跃用户数。
- 按功能、按上游/模型的堆叠条;按日趋势;错误分解:`402`(余额不足)、`429`(限流)、`401/403`(鉴权)、`5xx`、`0`(网络/超时)。
- Top 用户(按估算费用/调用数),点进用户详情。
- **估算费用**:`USAGE_PRICES_JSON` = `{"llm:deepseek-v4-flash":{"in_per_1k":0.001,"out_per_1k":0.002},"tts:volcengine/seed-tts-2.0":{"per_1k_chars":0.3},"stt:*":{"per_minute":0.06},...}`,币种 `USAGE_CURRENCY`(默认 CNY);缺单价的项显示"—"并在诊断中提示。所有金额旁标"估算"。
- 上游健康:最近 15 分钟每个上游的成功率与最近一次错误码 + "测试连接"按钮(§3.10)。

---

## 9. 公告与维护模式

- **公告** `announcements`:`level`(`info`/`warning`)、`text_zh`/`text_en`(≤ 280)、`starts_at`、`ends_at?`、`dismissible`、`created_by`、`created_at`、`archived_at`。公开端点 `GET /api/announcements`(无需登录,返回生效中的公告 + 维护状态;`Cache-Control: max-age=60`)。网页在顶部显示横幅(info = 中性底 + ink 文字,warning = amber 色调,遵循一色一义;可关闭的记在 localStorage)。
- **维护模式** `MAINTENANCE_MODE`:
  - `read_only`:`/api/**` 上的非 GET 请求返回 503 `{"error":"Maintenance"}`;放行 `/api/admin/**`、`POST /api/sessions`(登录)、`/api/announcements`;新 WebSocket(实时通话、房间)握手前以 1013 拒绝;在线房间以 1012 断开(网页按"服务重启"重连并看到横幅)。
  - `full`:除 `/up`、`/api/admin/**`、`/api/announcements` 和静态资源外,`/api/**` 全部 503;网页显示维护页(文案来自 `MAINTENANCE_MESSAGE_ZH/EN`)。
  - 实现为纯 ASGI 中间件 `core/maintenance.py`,每次读 `app.state.settings.maintenance_mode`,与热更新天然一致。

## 10. 功能开关

`RANK_ENABLED`、`ROOMS_ENABLED`、`REALTIME_ENABLED` 在设置页"功能开关"分组集中展示,每项显示:开关、当前是否"可用"(派生属性 `rank_match_available`/`rooms_ai_available`/`realtime_available`,不可用时列原因,来自诊断)、影响面说明。关闭语义:

| 开关 | 关闭时 |
|---|---|
| `RANK_ENABLED` | `/api/rank/config` 返回 `enabled:false`,其余 404(S1 已定义);进行中的比赛保持 active,重新打开后可继续或按时限过期 |
| `ROOMS_ENABLED` | 房间 HTTP 404;在线连接以 4003 断开(监听器);数据保留 |
| `REALTIME_ENABLED` | 新票据/新通话被拒;进行中的通话打完 |

---

## 11. 提示词与情景

### 11.1 范围

| key | 内容 | 默认来源 | 占位符 |
|---|---|---|---|
| `grammar.rules` | 语法检查规则(输出格式由服务端追加,改不掉) | `GRAMMAR_PROMPT_FILE` > `GRAMMAR_PROMPT` > 内置 | 无 |
| `rooms.assist` | 联机助手组句系统提示(将存在,M4) | `app/rooms/assistant.py` 内置 | `{level}`、`{chat}`、`{draft}` |
| `rooms.answer` | `@ai` 公开回答系统提示(M4) | 同上 | `{topic}`、`{asker}`、`{chat}`、`{question}` |
| `config.chat_agent_templates` | 对话情景模板(JSON,`/api/config/chat_agent_templates`) | `static_config/chat_agent_templates.json` | JSON 校验 |
| 晋级赛考官/评委 | 属于段位规则(§5.1 `examiner_prompt`/`judge_prompt`),随规则版本发布 | R5 内置 | 考官:`{cefr}{role}{setting}{functions}`;评委:`{cefr}{title_en}{functions}` |
| 晋级赛情景 | 段位规则 `scenarios` | `scenarios.json` | — |

### 11.2 版本与校验

`prompt_versions(id, key, version?, status draft|published|archived, body Text, note, created_by, created_at, published_by, published_at)`;语义同段位规则(一个草稿、发布不可变、回滚 = 复制旧版再发布)。校验:长度上限(语法规则沿用 `MAX_PROMPT_CHARS`,其他 8000)、`clean_prompt` 清洗、**必需占位符全部出现且没有未知占位符**(`string.Formatter().parse` 解析)、提示词注入边界标签(`<learner>`、`<draft>`、`<chat>`、`<question>`)必须保留(纯文本检查)。发布 = superadmin + 理由;`config_revisions['prompts'] += 1`;运行时 `prompt_cache(app)` 自注册刷新。

### 11.3 试运行

`POST /api/admin/prompts/{key}/test`(superadmin):用草稿正文 + 管理员填的样例输入调一次上游(`max_tokens ≤ 400`),返回模型输出与耗时;计量 feature=`admin`;界面标注"会产生少量费用"。样例输入与输出不写日志与审计。

---

## 12. 数据保留、清理与备份

| 工具 | 角色 | 说明 |
|---|---|---|
| 孤儿录音扫描/删除 | superadmin + 二次验证(删除) | 列出数据目录中没有对应 `assessments` 行的文件(数量、字节、最多 20 个相对路径样例);先扫描后删除;两次之间文件集变化则要求重扫 |
| 审计清理 | superadmin + 二次验证 | 删除早于 `ADMIN_AUDIT_RETENTION_DAYS` 的审计;写锚点 |
| 计量原始行清理 | 自动(§8.1)+ 手动 | |
| 过期语音 token、过期管理员会话、过期锁定行 | 自动(每日)| |
| 房间消息 | 不提供 | R-6 永久保留;`ROOM_MESSAGE_RETENTION_DAYS>0` 由房间清扫执行(M7),后台只能改该设置(危险项) |
| **备份(SQLite)** | superadmin + 二次验证(下载) | `VACUUM INTO '{BACKUP_DIR}/app-YYYYmmdd-HHMMSS.db'` 生成一致性快照(在线、不锁写太久);列表/下载/删除;保留最近 `BACKUP_KEEP` 份;`BACKUP_HOUR_UTC` 每日自动一次;`BACKUP_DIR` 默认 `{DATA_DIR}/backups`。录音不在备份里(体积),说明用 `docker cp` 或卷备份 |
| 备份(Postgres) | — | 返回 409 并显示 `pg_dump` 指令说明;不在应用内执行外部命令 |
| 设置导出 | superadmin | §3.7 |

备份文件包含加密后的密钥与用户数据:下载链接一次性(短期签名,60 秒)、`Content-Disposition: attachment`、审计记录下载者与文件名。

## 13. 系统状态与日志

- **系统状态**(viewer):版本 `APP_VERSION` + `BUILD_SHA`、Python 版本、启动时间与运行时长、worker 数(1)、数据库后端、库大小(SQLite 文件大小 / Postgres `pg_database_size`)、Alembic 当前版本 vs head、数据目录磁盘总量/已用/可用、录音总字节、实时通话在线数、房间在线连接数、计量队列深度与丢弃数、后台任务存活(修订号轮询、计量刷写、房间清扫、自动备份)、设置修订号、安全模式、待重启项、诊断摘要。
- **日志查看器**(operator):`core/log_buffer.py` 环形缓冲(2000 条),挂在 `app` 与 `uvicorn.error` logger 上(不挂 access 日志);写入时格式化并脱敏:`ticket=…`(复用 `redact_query_secrets`)、`Bearer …`、`(key|token|secret|password|code)=…`、以及当前全部密钥值的精确匹配(≥ 6 字符);每条截 2000 字符。按级别、logger 前缀、关键字过滤,`after_id` 增量轮询(界面 5 秒自动刷新开关)。只在内存,重启即空;不读磁盘日志文件。

---

## 14. 功能清单与优先级

**Must(本计划 v2.0 实现)** —— 成本为相对工作量(S ≤ 0.5 天,M ≈ 1–2 天,L ≈ 3–4 天,单人估算)

| # | 功能 | 成本 | 价值 |
|---|---|---|---|
| 1 | 运行时设置(注册表、覆盖、校验、热更新、密钥箱、历史/回滚/恢复 env、导入导出、危险守卫、安全模式、恢复命令) | L | 核心诉求 |
| 2 | 管理员账号 + 三级角色 + 库内会话(Cookie/CSRF)+ 锁定 + IP 白名单 + TOTP + 二次验证 | L | 开放写操作的前提 |
| 3 | 审计日志(哈希链)+ 审计页 | M | 可追责 |
| 4 | 段位规则版本化(草稿/预演/发布)+ 规则编辑器 | L | 核心诉求 |
| 5 | 单人段位操作(重置、定级、加减点、清冷却、重置次数、作废/重评比赛、成就)+ 比赛审计页 | M | 核心诉求 |
| 6 | 全体段位重置(快照 + 7 天内撤销) | S | 核心诉求 |
| 7 | 用户治理(停用、撤销登录、重置密码、配额覆盖) | M | 基本运营 |
| 8 | 房间治理(列表、记录、关闭、移出、禁 AI、隐藏消息、举报队列) | M | spec §14 已预告 |
| 9 | 功能开关面板 + 配置诊断 | S | 高价值低成本 |
| 10 | 计量 + 用量/费用仪表盘 + 测试连接 | L | 控成本 |
| 11 | 维护模式 + 公告(含网页横幅) | M | 运维必需 |
| 12 | 系统状态 + 脱敏日志查看器 | M | 排障 |

**Should(本计划实现,排在 Must 之后的任务;时间不够可顺延)**

| # | 功能 | 成本 |
|---|---|---|
| 13 | 提示词版本管理(语法、房间助手、`@ai`、对话情景模板)+ 试运行 | M |
| 14 | 邀请码管理(多码、次数、到期) | S |
| 15 | SQLite 备份(手动 + 每日)+ 下载 | M |
| 16 | 数据清理工具(孤儿录音、审计、计量原始行) | S |
| 17 | 删除用户(含录音) | S |
| 18 | TOTP 恢复码 | S |

**Later(列入以后,不在本计划)**

| # | 功能 | 成本 | 说明 |
|---|---|---|---|
| 19 | "结束全部通话"按钮 | S | 需 `RealtimeRegistry` 持有连接引用 |
| 20 | 显式赛季表 + 提前结束赛季 | M | 解除 §5.4 的限制 |
| 21 | 排行榜封禁 | S | 等好友榜(spec P1-7) |
| 22 | 告警(上游错误率/费用阈值 → 邮件或 webhook) | M | 需出站通道,先只在诊断里提示 |
| 23 | 用户数据导出(个人数据包) | M | |
| 24 | TOTP 二维码渲染 | S | 引入前端二维码库 |
| 25 | 房间消息手动清理工具 | S | R-6:以后可选 |
| 26 | 定时任务页(各后台任务上次运行/下次运行/手动触发) | S | |
| 27 | 键盘命令面板 | S | |
| 28 | 只读 SQL 报表(预置查询) | M | 隐私风险,需单独评审 |

---

## 15. 数据模型(Alembic `0008_admin_v2`,`down_revision = '0007'`)

新表:`admin_accounts`、`admin_sessions`、`admin_login_state`、`admin_recovery_codes`、`admin_audit`、`setting_overrides`、`setting_revisions`、`config_revisions`、`rank_rule_sets`、`rank_profile_snapshots`、`prompt_versions`、`announcements`、`upstream_calls`、`usage_daily`、`user_quota_overrides`、`invite_codes`。

改旧表(SQLite 用 batch 模式):`users` + `disabled_at`;`promotion_matches` + `rules_version`(Integer, nullable),`status` 允许 `voided`(字符串列,无需约束变更);`rooms` + `ai_muted`(Boolean, default false);`room_messages` + `hidden_at`;`room_reports` + `resolved_at`、`resolved_by`、`resolution`。

列定义以实现计划 Task A1 的代码为准;`tests/test_migrations.py` 新增 0008 往返测试与"模型与迁移一致"断言。降级(downgrade)完整实现,但上线回滚的推荐方式是关掉新功能而不是降级(会丢审计)。

## 16. API 总览(全部 `/api/admin/*`,JSON,错误 `{"error": "..."}`)

| 组 | 端点(角色) |
|---|---|
| 会话 | `POST /login`、`POST /login/totp`、`POST /logout`、`GET /session`(含角色、csrf、权限)、`POST /step-up`、`GET/DELETE /sessions[/{id}]`、`POST /me/password`、`POST /me/totp/begin`、`POST /me/totp/confirm`、`DELETE /me/totp` |
| 账号 | `GET/POST /accounts`、`PATCH /accounts/{id}`、`POST /accounts/{id}/reset-totp`(superadmin) |
| 审计 | `GET /audit?actor=&action=&target=&before_id=`、`GET /audit/verify` |
| 设置 | `GET /settings`、`PATCH /settings`、`DELETE /settings/{key}`、`GET /settings/revisions`、`POST /settings/revisions/{id}/revert`、`GET /settings/export`、`POST /settings/import/preview`、`POST /settings/import/apply`、`GET /doctor`、`POST /probes/{upstream}` |
| 段位 | `GET /rank/rules`(published + draft + versions)、`POST /rank/rules/draft`、`PUT /rank/rules/draft`、`DELETE /rank/rules/draft`、`POST /rank/rules/draft/validate`、`POST /rank/rules/draft/simulate`、`POST /rank/rules/draft/publish`、`GET /rank/rules/versions/{v}`、`GET /users/{id}/rank`、`POST /users/{id}/rank/{action}`、`GET /rank/matches?user_id=&status=`、`GET /rank/matches/{id}`、`POST /rank/matches/{id}/void`、`POST /rank/matches/{id}/regrade`、`POST /rank/reset-all`、`POST /rank/reset-all/{batch}/undo`、`POST /rank/clear-cooldowns` |
| 用户 | `POST /users/{id}/disable`、`/enable`、`/revoke-tokens`、`/reset-password`、`DELETE /users/{id}`、`GET/PUT/DELETE /users/{id}/quotas[/{key}]`、`GET/POST /invites`、`DELETE /invites/{id}` |
| 房间 | `GET /rooms`、`GET /rooms/{id}`、`GET /rooms/{id}/messages?lane=&before_seq=`、`POST /rooms/{id}/close`、`POST /rooms/{id}/kick`、`POST /rooms/{id}/ai`、`POST /rooms/{id}/messages/{mid}/hide`、`GET /reports?status=`、`POST /reports/{id}/resolve` |
| 用量 | `GET /usage/summary?days=`、`GET /usage/top-users?days=&by=`、`GET /usage/health` |
| 运维 | `GET/POST /announcements`、`PATCH/DELETE /announcements/{id}`、`GET /system`、`GET /logs?level=&logger=&q=&after_id=`、`GET/POST /backups`、`POST /backups/{name}/link`、`GET /backups/download/{token}`、`DELETE /backups/{name}`、`POST /housekeeping/{tool}/scan`、`POST /housekeeping/{tool}/run` |
| 提示词 | `GET /prompts`、`GET /prompts/{key}`、`POST/PUT/DELETE /prompts/{key}/draft`、`POST /prompts/{key}/draft/publish`、`POST /prompts/{key}/test` |
| 公开 | `GET /api/announcements` |

v1 的只读端点全部保留(改为 cookie 会话 + `viewer`)。

## 17. 分层与模块

```
core     settings_registry.py  runtime_settings.py  secretbox.py  metering.py  maintenance.py  log_buffer.py   (+ deps.py 的停用检查与计量绑定)
core     quotas.py
services prompts.py                                                               (-> core, models, providers)
rank     rules.py  rules_store.py(规则缓存与存取)                                  (将存在的 rank 包内新增)
rooms    (store/connection 小改:admin 关闭原因、ai_muted、hidden_at)
admin    perms.py accounts.py sessions.py totp.py audit.py settings_service.py doctor.py probes.py rank_ops.py rank_sim.py
         users_admin.py invites.py rooms_admin.py usage.py announcements.py system.py housekeeping.py backups.py prompts_admin.py recover.py
routers  admin.py(v1,改依赖)  admin_auth.py admin_accounts.py admin_settings.py admin_rank.py admin_users.py admin_rooms.py
         admin_usage.py admin_ops.py admin_prompts.py announcements.py(公开)
```
- `tests/test_architecture.py` 规则不放宽:`core` 新模块只导入 `core`/`models`;`admin` 可导入 core…realtime、rank、rooms(S1 已加);`routers/admin_rooms.py` 通过 `app.routers.rooms` 取运行时。新增一条自测:`core` 导入 `app.admin` 必须报错(已有规则覆盖,补用例)。
- `app/admin/CLAUDE.md` 的"Strictly read-only"改为"写操作必须经 `perms.require` + 审计";`server/app/CLAUDE.md` 布局表同步。

## 18. 前端(`admin/`)

- **栈不变**:Vite 6 + React 18 + react-router 7 + Tailwind 3 + vitest;不引入 UI 库与图表库(柱状/趋势用内联 SVG,沿用 `activity-chart.tsx` 的做法)。
- **配色**:令牌名不变(`--accent`、`--good`…),值改为 redesign-v3 的语义色(`docs/superpowers/design/redesign-v3/design-notes.md`):`accent` = blue `#2456DB`(主操作、选中、进度),`good` = green(健康、通过、已生效),`warn` = amber(待重启、提醒、漂移),`bad` = red(危险操作文字、错误、断链),中性 `surface/surface-2/ink/ink-2/ink-3/hair`;teal 只留给词汇。一色一义:危险按钮是红字描边,不用红色大色块;"密钥"是中性锁形图标,不用颜色表达。暗色同 design-notes 的暗色表。
- **布局**:≥ 1024 左侧 232px 导航(分组:总览 / 用户与内容 / 段位 / 联机 / 用量 / 配置 / 运维 / 安全)+ 顶栏(环境标识、安全模式红条、维护模式琥珀条、当前账号与角色)+ 内容区(最大 1200);768–1023 左侧 64px 图标栏;< 768 沿用底部 Tab(5 项:概览、用户、段位、配置、更多)。数据表在窄屏折叠为卡片。
- **目录**:`admin/src/features/<area>/{api.ts,strings.ts,*.tsx,*.test.tsx,index.ts}`,area ∈ `settings, security, audit, rank, users, rooms, usage, ops, prompts`;v1 的 `pages/` 保留。
- **共享组件(A8)**:`ConfirmDialog`(理由 + 输入确认)、`StepUpDialog`、`DiffTable`(旧→新,密钥行显示"已更改 · 指纹")、`SecretField`、`ApplyBadge`(热/新会话/待重启)、`RoleGate`、`StatusDot`、`DataTable`、`Sparkline`/`BarChart`(SVG)。
- **API 客户端**:`credentials: "same-origin"`;非 GET 自动带 `X-Admin-CSRF`;401 → 跳登录;403 `Step-up required` → 弹 `StepUpDialog` 后重放一次;支持 `PATCH/PUT/DELETE`。
- 视觉稿:`docs/superpowers/design/admin-v2/mockup.html`(桌面 1440 与平板 1024 两种框)。

## 19. 测试策略

| 层 | 内容 | 工具 |
|---|---|---|
| 纯函数 | 注册表完整性(每个 `Settings` 字段都有 spec,env-only/secret 集合与本文一致)、`coerce`、`compose`、`runtime_problems`、配对守卫、危险判定、`SecretBox`、指纹、TOTP(RFC 6238 附录向量)、`RankRules` 默认值与常量逐项相等、规则校验、预演、占位符校验、价格计算、日志脱敏、诊断 | pytest |
| 数据层 | 覆盖读写/修订号/回滚冲突、无效覆盖跳过、安全模式、会话过期/空闲/撤销、锁定翻倍、审计哈希链、段位规则草稿发布与钉住版本、全体重置与撤销、配额覆盖、邀请码并发使用、计量批量写与汇总 | pytest + 内存 SQLite(`TEST_DATABASE_URL` 可跑 Postgres) |
| 路由 | 每个 `/api/admin/*` 都声明角色(遍历路由表);viewer/operator/superadmin 403 矩阵;CSRF 缺失/错误 403;Bearer 被拒;二次验证;IP 白名单 404;维护模式;热更新后新请求看到新值;密钥永不出现在任何响应体(对所有 GET 响应做全文扫描) | httpx ASGI + respx |
| 日志卫生 | 密码、token、密钥、CSRF、临时密码、提示词正文不进日志与审计 | `caplog` |
| 前端 | 客户端(CSRF、401、step-up 重放)、设置编辑器(分组、密钥掩码、待重启徽标、保存前差异、危险确认)、段位规则编辑(草稿/预演/发布)、用户段位面板、用量仪表盘、审计列表 | vitest + Testing Library |
| E2E | 登录 → 改一个热设置 → 网页侧行为变化(如关闭 `ROOMS_ENABLED` 后导航少一项)→ 撤销修订;段位规则草稿 → 预演 → 发布;维护模式 read_only 下网页提示 | Playwright(E2E 栈,不调真实上游) |

## 20. 上线与回滚

1. 合入后:未设置 `SETTINGS_ENCRYPTION_KEY` 也能运行(密钥只读);v1 的 Bearer 登录失效,管理员需刷新页面重新登录(cookie)。
2. 部署说明:设置 `SETTINGS_ENCRYPTION_KEY` 并**单独备份**(丢了 = 库里的密钥覆盖全部作废,需重填);反向代理必须 HTTPS(`__Host-` cookie 要求);建议设置 `ADMIN_IP_ALLOWLIST`。
3. 回滚:代码回退到 v1 后,0008 的表闲置无害;覆盖值不再生效(v1 不读),等于自动"恢复为 env"。

## 21. 风险与对策

| 风险 | 对策 |
|---|---|
| 后台被攻破 = 可改上游地址窃取密钥、开放注册 | 三级角色、TOTP、二次验证、IP 白名单、配对守卫、审计哈希链;env-only 守住根密钥与数据库 |
| 覆盖值让服务异常 | 统一校验源 + 监听器预检;无效覆盖跳过不阻止启动;安全模式;恢复命令 |
| 热更新组件遗漏(某对象仍用旧值) | 注册表的 `apply` 字段 + 测试:每个 `hot` 键要么被请求时读取,要么有监听器(维护一张"读取点"清单并在测试里断言监听器覆盖) |
| 段位规则改动让用户困惑或不公平 | 草稿 + 预演 + 发布理由 + 比赛钉住版本 + 不追溯点数;公告功能通知用户 |
| 计量拖慢请求 | 内存队列 + 批量写;队列满丢最旧 |
| 主密钥丢失 | 文档强调单独备份;解密失败的覆盖跳过不崩;`rotate-key` |
| 审计/计量表增长 | 保留期 + 汇总 + 清理工具 |
| CSRF / 会话劫持 | `__Host-` + HttpOnly + SameSite=Strict + 双重提交 + Origin 校验 + 空闲超时 |

## 22. 待定问题与默认裁定

1. **密钥能否在后台修改?** 默认:能,但仅当设置了 `SETTINGS_ENCRYPTION_KEY`;否则只读(状态 + 指纹)。
2. **停用 v1 Bearer token,改 Cookie 会话?** 默认:是(一次性重新登录)。
3. **角色分三级(viewer/operator/superadmin),viewer 仍可看对话与录音?** 默认:是(与 v1 一致);若要收紧,给 viewer 加"不可看内容"开关列为以后。
4. **段位结构(段位数量、key、显示名)不可在后台改?** 默认:是;只改数字、阶段练习、情景、提示词。
5. **赛季配置仅在第 1 赛季开始前可改?** 默认:是(显式赛季表列为以后)。
6. **点数规则改动不追溯?** 默认:不追溯;只影响之后入账的事件。
7. **后台不提供重启按钮?** 默认:不提供;"待重启"项由运维 `docker compose restart server`。
8. **IP 白名单 env-only?** 默认:是,防止管理员把自己锁在外面。
9. **管理端改用 redesign-v3 语义色(蓝色主色)?** 默认:是,只换令牌值、不换令牌名。
10. **房间消息管理端清理工具?** 默认:不做(spec R-6 永久保留,工具列为以后)。
11. **未设置 env 应急账号时,库内账号也不能登录?** 默认:是(保持 v1 的"默认关闭")。
12. **"测试连接"对 LLM 在 `/models` 不可用时发 1 token 请求?** 默认:需要勾选"允许少量费用"才发。

## 裁定 R-7(2026-10-09,产品负责人):管理端只做桌面网页端

- 覆盖上文所有"响应式 / 平板 / 手机"表述:管理前端**只支持桌面浏览器**,最小支持宽度 1024px,设计基准 1440px。
- 布局:左侧导航 + 内容区,多栏表格与右侧面板(影响预演、差异对比)保持桌面形态;**不做**图标侧栏(平板)与底部 Tab(手机)。
- 视口 < 1024px 时显示整页提示"请使用桌面浏览器访问管理后台"(仍可登录与退出,不渲染业务页),避免在小屏上误触危险操作。
- 视觉稿只需桌面 1440 一种框;视觉对照验收只在 1440 与 1280 两个宽度做。
- 节省的工作量(约 15–25%)不重新分配,保持任务数不变;已有 v1 手机页面随 v2 壳层一起替换为桌面布局。
