# Enjoy 自建后端

一个轻量的 FastAPI 服务,替代 enjoy.bot:提供账号密码认证、配置快照,并把 AI 请求代理到你自己的上游(LLM / TTS / Whisper / Azure Speech)。

## 接口一览

```
Electron 客户端 ──(apiUrl)──▶ server (FastAPI, uv)
                                ├ /up                           健康检查
                                ├ /api/sessions, /api/users, /api/me   认证
                                ├ /api/config/{key}             配置快照
                                ├ /api/ai/chat/completions      ──▶ 上游 LLM(OpenAI 兼容,SSE 透传)
                                ├ /api/ai/audio/speech          ──▶ openai/* → 上游 TTS;azure/speech → Azure TTS;volcengine/* → 豆包语音 TTS
                                ├ /api/ai/audio/transcriptions  ──▶ 上游 Whisper(multipart 透传)
                                ├ /api/speech/tokens            ──▶ Azure issueToken(服务端缓存 8 分钟)
                                ├ /api/speech/assessments       ──▶ 讯飞 ISE 发音评测(multipart 上传 WAV)
                                └ 其余 POST/PUT/DELETE /api/**  鉴权后返回 {}(同步占位)
                              DB: users / access_tokens / speech_tokens
```

默认 STT:客户端拿到 token 后直连 Azure,音频不经过后端。发音评测:客户端上传音频到 `/api/speech/assessments`,由后端调用讯飞 ISE。

> **警告:`REGISTRATION_MODE=open` 部署在公网时,任何人都能注册并消耗你的 LLM / TTS / Whisper / Azure 密钥额度。**
> 公网部署请使用 `invite` 或 `closed`(`server/.env.example` 默认即为 `closed`)。

## 快速开始

```bash
cp server/.env.example server/.env
# 编辑 server/.env,填写上游地址与密钥
# .env.example 默认 REGISTRATION_MODE=closed:创建第一批账号时,先临时改为 open(或 invite + INVITE_CODE),
# 注册完毕后改回 closed 并 `docker compose up -d` 重启。
docker compose up -d --build   # 需要 Docker Compose >= 2.20(depends_on 的 required: false)
docker compose ps          # server 应为 healthy
curl localhost:8000/up     # {"status":"ok"}
```

## 本地开发

```bash
cd server
uv sync
uv run pytest
uv run uvicorn app.main:create_app --factory --reload
```

注意:`.env.example` 中的 SQLite 路径 `sqlite+aiosqlite:////data/app.db` 是给 Docker 用的;本地 `uv run` 请改用 `DATABASE_URL=sqlite+aiosqlite:///./data/app.db`(或不设置,默认即此值)。

使用 Postgres 跑测试套件(先创建 `enjoy_test` 库):

```bash
docker compose exec postgres psql -U enjoy -d enjoy -c 'CREATE DATABASE enjoy_test;'
cd server && TEST_DATABASE_URL=postgresql+asyncpg://enjoy:change-me@localhost:5432/enjoy_test uv run pytest -q
```

## 切换数据库

- SQLite(默认):`DATABASE_URL=sqlite+aiosqlite:////data/app.db`,数据在 compose 卷 `enjoy-data` 中。
- Postgres:把 `DATABASE_URL` 改为 `postgresql+asyncpg://enjoy:<密码>@postgres:5432/enjoy`(密码与 `POSTGRES_PASSWORD` 一致),并用 `docker compose --profile postgres up -d --build` 启动。

`POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` 由 compose 自己读取,**不再**从 `server/.env` 传入(避免把上游密钥给数据库容器)。请复制根目录的 `.env.example` 为 `.env`(与 `docker-compose.yml` 同目录),或在 shell 中导出这些变量;未设置时默认值为 `enjoy` / `change-me` / `enjoy`。密码须与 `DATABASE_URL` 中的一致。

**注意:切换数据库不会迁移已有数据**,新库是空的。

## 注册保护

`REGISTRATION_MODE`:

- `open`:任何人可注册(默认)
- `invite`:注册时必须提供与 `INVITE_CODE` 相同的邀请码
- `closed`:关闭注册

注册与登录接口按 IP 限流,上限由 `RATE_LIMIT_PER_MINUTE` 控制(每分钟次数)。

## 上游服务选择

LLM 上游只需支持 chat completions(含流式)与 JSON 模式(`response_format: json_object`)。客户端只用 JSON 模式(`withStructuredOutput(..., {method: "jsonMode"})`),不使用 tool calling。

DeepSeek 示例(官方 OpenAI 兼容地址,请求发往 `/chat/completions`):

```bash
UPSTREAM_LLM_BASE_URL=https://api.deepseek.com
LLM_MODELS=deepseek-v4-pro,deepseek-v4-flash
DEFAULT_LLM_MODEL=deepseek-v4-flash
```

注意:DeepSeek V4 模型默认运行在 thinking 模式,该模式不支持强制 `tool_choice`(本客户端不使用)。

TTS(`openai/*` 模型走 OpenAI 兼容的 `/audio/speech`,或 `azure/speech`)与 Whisper(`/audio/transcriptions`,OpenAI 兼容,需返回带 word/segment 时间戳的 `verbose_json`)必须指向真正提供这些确切接口的服务。

> **警告:`api.openai.com` 只是模板默认值。** 若 LLM 换成其他厂商,TTS / Whisper 的地址与密钥也要相应检查,不要沿用默认值指向不提供这些接口的服务。

**豆包语音合成(`volcengine/*` TTS)**:在 `TTS_MODELS` 中加入 `volcengine/seed-tts-2.0`(模型名即火山的资源 ID;仅支持 2.0,官方音色列表中的 1.0 音色不提供),并配置:

```env
TTS_MODELS=openai/tts-1,azure/speech,volcengine/seed-tts-2.0
VOLCENGINE_TTS_KEY=<豆包语音控制台的 API Key,UUID 格式,不是方舟 Key>
```

音色列表来自官方「音色列表」页面(https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1)中「豆包语音合成模型 2.0」的部分,保存在 `app/static_config/volcengine_voices.json`(每行 `[显示名, voice_type, 语言, 性别 M/F]`),共 158 个,仅收录英文(en-US、en-GB)和中文(zh-CN)。前缀为 `ICL_` 的声音复刻预置音色未收录:按官方文档它们需要资源 ID `seed-icl-2.0`,`seed-tts-2.0` 无法调用。服务启动时会校验该文件(格式损坏则无法启动)。刷新方法:重新读取官方页面,按同样的格式更新该 JSON 后重启服务。

需要先在豆包语音控制台开通「语音合成大模型 2.0」,开通后可能有几分钟的生效延迟(期间会返回未授权,服务端表现为 502)。英文(美式)音色示例:`en_male_tim_uranus_bigtts`(Tim)、`en_female_dacey_uranus_bigtts`(Dacey)、`en_female_stokie_uranus_bigtts`(Stokie)。

**火山方舟转写(`chat` 模式)**:Whisper 上游也可以改用支持音频输入的对话模型:

```env
UPSTREAM_WHISPER_MODE=chat
UPSTREAM_WHISPER_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
UPSTREAM_WHISPER_KEY=<方舟 API Key>
UPSTREAM_WHISPER_MODEL=doubao-seed-2-0-lite-260428
```

- 转写由大模型完成,返回 `{"text": "...", "segments": []}`,没有时间戳(客户端会在本地对齐),可能做少量润色。
- 仅支持 wav / mp3,音频不超过 18 MB(18,000,000 字节;base64 后 ≤ 24 MB,低于方舟 25 MB 的限制)。
- 方舟 API Key 与「豆包语音」控制台的 UUID 格式 Key 不是同一种,不能混用。
- 默认 `UPSTREAM_WHISPER_MODE=openai`,行为不变。

## 成本保护

- `/api/ai/*`、`POST /api/speech/tokens` 与 `POST /api/speech/assessments` 按用户限流,上限由 `AI_RATE_LIMIT_PER_MINUTE` 控制(默认 60,超出返回 429)。
- 聊天请求的 `n` 最多 4;`max_tokens` / `max_completion_tokens` 超过 `LLM_MAX_TOKENS`(默认 4096)会被压到该值,请求未带则保持缺省。
- 非 multipart 请求体超过 1 MiB 返回 413;转写与发音评测上传(multipart)上限 25 MiB。讯飞免费额度可能远低于用户限流上限。

## 必须使用 HTTPS

密码与访问令牌在网络上传输,公网部署必须放在 HTTPS 反向代理之后。Caddyfile 示例:

```
your.domain {
    reverse_proxy 127.0.0.1:8000
}
```

`docker-compose.yml` 默认只把服务发布到 `127.0.0.1:8000:8000`,这是有意的安全默认:同一台主机上的反向代理转发到 `127.0.0.1:8000`(上面的示例即如此;Nginx 同理使用 `proxy_pass http://127.0.0.1:8000;`)。如需不经代理直接对外暴露(不推荐,密码将以明文传输),把端口映射改为 `0.0.0.0:8000:8000`。

并在 `server/.env` 中设置 `TRUST_PROXY_HEADERS=true`,让限流使用 `X-Forwarded-For` 中的真实客户端 IP。

重要:这与端口绑定相关——只有当服务仅能通过你的反向代理访问时才应启用 `TRUST_PROXY_HEADERS=true`。启用后,反向代理必须**覆盖**(而不是追加)`X-Forwarded-For`,否则客户端可以伪造该头绕过限流。Caddy 默认会覆盖来自不受信任来源的该头;Nginx 请使用 `proxy_set_header X-Forwarded-For $remote_addr;`(不要用 `$proxy_add_x_forwarded_for`)。

另外,反向代理需允许较大的请求体(音频上传转写),例如 Nginx 的 `client_max_body_size 25m;`。

## 让客户端指向它

- `VITE_API_URL` 在构建/开发时从 `enjoy/.env` 读取(默认 `http://localhost:8000`),例如 `VITE_API_URL=https://your.domain`。
- 主进程运行时环境变量 `WEB_API_URL` 以及应用内「高级 → API 地址」设置会覆盖它;对已打包好的客户端请使用这两种方式。

## 发音评测(讯飞)

发音评测由后端调用讯飞开放平台的语音评测(ISE)完成。在 `server/.env` 中配置(密钥只放在被 git 忽略的 `.env`,不要提交):

```
XFYUN_APP_ID=
XFYUN_API_KEY=
XFYUN_API_SECRET=
# XFYUN_WS_URL=wss://ise-api.xfyun.cn/v2/open-ise   # 默认官方地址,一般无需修改
```

三项密钥在讯飞开放平台控制台(语音评测应用)中获取;未配置时接口返回 503 `Pronunciation assessment is not configured`。如密钥泄露,请在讯飞控制台重置 APIKey / APISecret,更新 `.env` 后重启服务。

`POST /api/speech/assessments`(需登录,按用户限流,与 `/api/ai/*` 共用 `AI_RATE_LIMIT_PER_MINUTE`),multipart 字段:

- `file`:WAV,16 kHz、16 bit、单声道
- `reference`:参考文本(去除首尾空白后最多 2000 字符,超出返回 400)
- `language`:`en`、`en-*`、`en_*`;目前只支持英文(Only English is supported at the moment),其他返回 400

返回客户端评分界面使用的结构(snake_case,分数 0–100):总分、准确度、流畅度、完整度,以及逐词/音节/音素明细。

限制:

- 必须提供参考文本,为空返回 400(不做无参考文本的评测)。
- 音频必须是 16 kHz 单声道 16 bit WAV,时长不超过 5 分钟,文件不超过 25 MiB。
- 讯飞没有语调指标,因此不返回 `prosody_score`。
- 等待讯飞结果的超时按音频时长计算:`30 + 时长(秒)`,上限 330 秒。长音频时,反向代理的读超时必须不小于约 5 分钟(Nginx 需设置 `proxy_read_timeout`,Caddy 默认即可)。
- 讯飞免费额度可能远低于每用户的限流上限,请留意额度消耗。

## 冒烟脚本与配置快照

```bash
cd server
uv run python scripts/smoke.py --base-url http://localhost:8000     # 端到端检查(需要真实上游才能全部通过)
uv run python scripts/fetch_config.py                               # 刷新配置快照
# 可选:发音评测检查(需要配置讯飞密钥;未配置时为 SKIP)
uv run python scripts/smoke.py --wav sample.wav --reference "Hello, nice to meet you." --language en-US
```

上游未配置的检查会返回 503,并被报告为 SKIP;没有配置上游凭据时,注册检查通过,AI 相关检查为 SKIP。TTS 检查会读取 `/api/config/tts_providers_v2` 中实际配置的模型,对每个模型各跑一次(`tts <model>`);未配置任何 TTS 模型时为一行 SKIP。

## 构建说明

`server/uv.lock` 中的包地址指向清华 PyPI 镜像(`pypi.tuna.tsinghua.edu.cn`),在中国大陆没问题,其他地区可能很慢或无法访问。如需改用官方源重新锁定:

```bash
cd server && uv lock --default-index https://pypi.org/simple
```

然后重新构建镜像。

## 已知限制

- 仅支持单 worker(限流与 Azure token 缓存都在进程内)。
- 手机端使用官方网页版账号,与自建后端的账号不互通。
- 桌面客户端在创建 segment 后仍会把片段音频上传到 `storage.enjoy.bot`(`enjoy/src/main/db/models/segment.ts`、`main/storage.ts`)。这是上游既有行为,不在本后端覆盖范围内。
- 配置快照来自官方公开接口,需要时用 `fetch_config.py` 手动刷新。
