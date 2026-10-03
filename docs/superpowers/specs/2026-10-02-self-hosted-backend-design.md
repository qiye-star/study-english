# 自建后端与客户端二次开发:设计文档

日期:2026-10-02
范围:`enjoy`(Electron 客户端,v0.7.9)+ 新增 `server/`(Python 后端)

## 1. 背景与目标

上游仓库只含 Electron 客户端。登录、AI 代理(`enjoyai` 引擎)、发音评测 token、
配置下发都依赖闭源的 `https://enjoy.bot`。本项目自用,目标:

1. 登录改为「账号 + 密码」,可自助注册,不需要验证码,不接 Casdoor。
2. AI 服务(LLM / TTS / STT / 发音评测)由自己的上游提供,用户不再手动配置。
3. 后端用 Docker 打包、uv 管理 Python 环境、SQLAlchemy 通过 `DATABASE_URL` 在 SQLite / Postgres 间切换。

不做:手机端(手机继续用官方网页版,账号不互通)、Casdoor、社区、关注、排行、付费、云端同步、验证码。

## 2. 核心判断

- 客户端后端地址本来就可配置(`enjoy/src/main/settings.ts` 的 `apiUrl()`),所以做**兼容式后端**:
  按客户端现有约定实现最小接口子集,客户端只做少量改动。
- 客户端的 JSON 约定:响应会被 `camelcase-keys` 深度转换,请求会被 `decamelize-keys` 转换,
  所以后端一律用 **snake_case**。错误体取 `error` 或 `message` 字段(`enjoy/src/api/client.ts`)。
- 后端只存**用户相关数据**。录音、笔记、词汇等都在客户端本地 SQLite,同步类接口收下即丢。

## 3. 架构

```
Electron 客户端 ──(apiUrl)──▶ server (FastAPI, uv)
                                ├ /up                           健康检查
                                ├ /api/sessions, /api/users, /api/me   认证
                                ├ /api/config/{key}             配置快照
                                ├ /api/ai/chat/completions      ──▶ 上游 LLM(OpenAI 兼容,SSE 透传)
                                ├ /api/ai/audio/speech          ──▶ openai/* → 上游 TTS;azure/speech → Azure TTS
                                ├ /api/ai/audio/transcriptions  ──▶ 上游 Whisper(multipart 透传)
                                ├ /api/speech/tokens            ──▶ Azure issueToken(服务端缓存 8 分钟)
                                └ 其余 POST/PUT/DELETE /api/**  鉴权后返回 {}(同步占位)
                              DB: users / access_tokens / speech_tokens
```

发音评测与默认 STT:客户端拿到 token 后**直连 Azure**,音频不经过后端。

## 4. 认证设计

- 用户 `id`:**8 位数字**(以字符串返回)。原因:`enjoy/src/main/settings.ts` 的 `sessions()` 用
  `/^\d{8}$/` 扫描本地资料库目录来识别「已记住的用户」,非 8 位数字的 id 会让该功能失效。
  生成方式:`secrets.randbelow(90_000_000) + 10_000_000`,唯一键冲突时重试。
- `username`:小写,`^[a-z0-9_]{3,32}$`,唯一。密码最短 8 位,最长 128 位,argon2id 哈希。
- accessToken:`secrets.token_urlsafe(32)`;库里只存 SHA-256;不过期;不使用 JWT。
- 接口:
  - `POST /api/sessions` `{provider:"password", username, password}`
  - `POST /api/users` `{username, password, invite_code?}`(注册,直接返回登录结果)
  - `GET /api/me`(**不返回** `access_token`,否则客户端 `refreshAccount` 会把本地 token 覆盖成空)
- 注册保护:`REGISTRATION_MODE=open|invite|closed`;登录/注册按 IP 限流(默认每分钟 10 次);
  登录失败统一报「用户名或密码错误」,并对不存在的用户做等时的假校验。

## 5. AI 代理设计

- **LLM**:`POST /api/ai/chat/completions`。校验 token → 若 `model` 不在 `LLM_MODELS` 内,改写为
  `DEFAULT_LLM_MODEL`(防止用户调用任意昂贵模型,也兼容客户端写死的 `gpt-4o`)→ 用服务端 key 转发。
  `stream:true` 时 SSE 透传(使用 `aiter_bytes`,不转发 `content-encoding`)。
  客户端只使用 JSON 模式(`response_format: json_object`,即 `withStructuredOutput(..., {method: "jsonMode"})`,
  见 `enjoy/src/commands/json.command.ts`),所以**上游必须支持 JSON 模式**;不需要 tool calling。
- **TTS**:`POST /api/ai/audio/speech`。`azure/speech` → 构造 SSML 调用 Azure TTS REST,返回 mp3;
  `openai/<model>` → 去掉前缀转发上游;其他模型 400;`input` 超过 4096 字符 400。
- **STT**:Azure 路径无需后端代码(共用 token 接口)。客户端原 `ENJOY_CLOUDFLARE` 选项写死
  `ai-worker.enjoy.bot` 且是 Cloudflare 专用返回格式,改为调用 `/api/ai/audio/transcriptions`
  (OpenAI `verbose_json`,复用客户端已有的 `transcribeByOpenAi` 解析逻辑)。
- **Azure token**:`POST /api/speech/tokens` 返回 `{id, token, region}`;`PUT /api/speech/tokens/{id}` 更新状态
  `consumed|revoked`。`speech_tokens` 表记录用户、用途、状态,便于看用量。

## 6. 配置快照

官方 `GET /api/config/{key}` 公开可取(无需鉴权)。把客户端用到的 key 快照为静态 JSON:
`ipa_mappings`、`gpt_providers`、`tts_providers_v2`、`chat_agent_templates`、`gpt_presets`、
`default_gpt_preset`、`default_tts_preset`、`ytb_channels`;`app_version` 由设置生成。
服务端在返回前覆盖:`gpt_providers.enjoyai.models = LLM_MODELS`;`tts_providers_v2.enjoyai.models = TTS_MODELS`;
预设里的 `configuration.model = DEFAULT_LLM_MODEL`。不提供 `bugsnag_api_key`(返回 404,不把崩溃日志发给上游项目)。
未知 key 返回 404。

## 7. AI 词典 / 翻译

`lookupWord`、`translate` 的 LLM 调用在**客户端**完成(`enjoy/src/renderer/hooks/use-ai-command.tsx`),
服务端只是缓存。因此用占位实现:`POST /api/lookups` 返回 `meaning:null` 的待处理记录,
`GET /api/translations` 返回空分页,其余写入收下即丢。客户端本地已有缓存(`EnjoyApp.cacheObjects`)。

## 8. 部署

- `server/Dockerfile`:多阶段,uv 构建虚拟环境,运行镜像不含 uv。
- `docker-compose.yml`:`server` 服务;`postgres` 服务放在 `postgres` profile。
- `DATABASE_URL` 决定数据库;Alembic 管理表结构(迁移不用方言专属类型)。切换数据库**不自动迁移数据**。
- 必须经 HTTPS 暴露(密码明文传输);compose 不内置反向代理。单 worker 运行(限流器是进程内的)。

## 9. 客户端改动

1. 默认服务器地址由构建时 `VITE_API_URL` 决定(`enjoy/.env`)。
2. 登录页改为「账号 + 密码 / 注册」表单,保留「已记住的用户」;从登录页移除邮箱、GitHub、Mixin、Bandu 登录
   (对应源文件保留不删,以减少与上游的合并冲突)。
3. 移除 `createCable` 调用(后端没有 ActionCable)。
4. STT 的 Cloudflare 选项改指向 `/api/ai/audio/transcriptions`;隐藏 OpenAI 密钥设置、引擎选择等 AI 配置入口,引擎固定为 `enjoyai`。
5. 隐藏侧边栏的「课程」「社区」入口,以及偏好设置里的邮箱、余额、充值入口。

## 10. 风险与未验证项

- 上游 LLM 是否支持 JSON 模式(客户端只用 JSON 模式,不需要 tool calling)、是否有 `whisper-1`:需用真实 key 验证(计划阶段 4 的冒烟脚本)。
- Azure 区域与 key 的有效性:同上。
- `import.meta.env.VITE_*` 在 electron-forge 的主进程构建中是否生效:计划阶段 5 有验证步骤。
- 上游项目正转向「网页版 + 桌面套壳」,本分支会长期与上游分叉,不指望合并上游。
