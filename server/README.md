# Enjoy 自建后端

一个轻量的 FastAPI 服务,替代 enjoy.bot:提供账号密码认证、配置快照,并把 AI 请求代理到你自己的上游(LLM / TTS / Whisper / Azure Speech)。

## 接口一览

```
Electron 客户端 ──(apiUrl)──▶ server (FastAPI, uv)
                                ├ /up                           健康检查
                                ├ /api/sessions, /api/users, /api/me   认证
                                ├ /api/config/{key}             配置快照
                                ├ /api/ai/chat/completions      ──▶ 上游 LLM(OpenAI 兼容,SSE 透传)
                                ├ /api/ai/grammar               语法检查(登录 + 用户限流;请求 {text, context?};提示词与模型由服务端决定)
                                ├ /api/me/grammar-prompt        GET/PUT/DELETE 当前用户的语法检查规则(≤ 2000 字符;空串或 DELETE 恢复默认;返回 prompt、default_prompt、max_length)
                                ├ /api/ai/audio/speech          ──▶ openai/* → 上游 TTS;azure/speech → Azure TTS;volcengine/* → 豆包语音 TTS(火山模型可加 `stream=true` 分块透传)
                                ├ /api/ai/audio/transcriptions  ──▶ 上游 Whisper(multipart 透传)
                                ├ /api/speech/tokens            ──▶ Azure issueToken(服务端缓存 8 分钟)
                                ├ /api/speech/assessments       ──▶ 讯飞 ISE 发音评测(multipart 上传 WAV;`save=true` 时保存录音与记录)
                                ├ /api/realtime/config, /api/realtime/ticket, WS /api/realtime   实时语音通话(默认关,见「语音提速与实时通话」)
                                ├ /api/conversations[/{id}[/messages]], /api/messages/{id}   网页版对话(持久化)
                                ├ /api/assessments[/{id}[/audio]]       网页版评测记录与录音回放
                                ├ /api/practice-items[/{id}]            练习清单(GET/POST/DELETE;相同文本去重)
                                ├ /api/vocabulary[/{id}[/review]]       词汇本(GET ?due=true、POST 去重、DELETE、复习按盒子法推进)
                                ├ /api/stats?days=7|30|90&tz_offset_minutes=   学习进度(只读,按用户限流)
                                ├ 其余 POST/PUT/DELETE /api/**  鉴权后返回 {}(同步占位)
                                └ 其他 GET                       网页版(web/dist,SPA 回退到 index.html)
                              DB: users / access_tokens / speech_tokens / conversations / messages / assessments / vocabulary_items
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
docker compose up -d --build   # 需要 Docker Compose >= 2.20(depends_on 的 required: false);镜像同时构建并托管手机网页版(`web/`),构建上下文为仓库根目录
docker compose ps          # server 应为 healthy
curl localhost:8000/up     # {"status":"ok"}
```

## 本地开发

```bash
cd server
uv sync
uv run pytest
uv run alembic upgrade head   # 全新克隆必须先建表,否则每个 API 请求都会 500("no such table")
uv run uvicorn app.main:create_app --factory --reload
```

注意:`.env.example` 中的 SQLite 路径 `sqlite+aiosqlite:////data/app.db` 是给 Docker 用的;本地 `uv run` 请改用 `DATABASE_URL=sqlite+aiosqlite:///./data/app.db`(或不设置,默认即此值)。若使用 Postgres 的 `DATABASE_URL` 且未设置 `DATA_DIR`,录音目录会解析为 `/data`,本地运行请显式设置 `DATA_DIR`(例如 `DATA_DIR=./data`)。

使用 Postgres 跑测试套件(先创建 `enjoy_test` 库):

```bash
docker compose exec postgres psql -U enjoy -d enjoy -c 'CREATE DATABASE enjoy_test;'
cd server && TEST_DATABASE_URL=postgresql+asyncpg://enjoy:change-me@localhost:5432/enjoy_test uv run pytest -q
```

## 切换数据库

- SQLite(默认):`DATABASE_URL=sqlite+aiosqlite:////data/app.db`,数据在 compose 卷 `enjoy-data` 中。若把 `/data` 改为宿主机目录(bind mount)而非该命名卷,须执行 `chown -R 10001:10001 <目录>`(容器以 uid 10001 运行),否则保存评测会返回 500。
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

**火山大模型流式识别(`UPSTREAM_ASR_MODE=volc_stream`,可选)**:比方舟 `chat` 模式快得多(实测 4 s 片段约 1.0 s、13 s 片段约 2.1 s,方舟约 5 s)。

```env
UPSTREAM_ASR_MODE=volc_stream
# 以下为默认值,一般不用改
ASR_STREAM_URL=wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream
ASR_STREAM_RESOURCE_ID=volc.bigasr.sauc.duration
ASR_STREAM_TIMEOUT_SECONDS=30      # 实际超时 = min(该值 + 音频秒数, 120)
ASR_STREAM_MAX_CONCURRENCY=3       # 每进程并发上限,超出直接回退
# 留空则复用 VOLCENGINE_TTS_KEY
VOLCENGINE_ASR_KEY=
```

- 需要在豆包语音控制台开通「大模型流式语音识别」(小时版,资源 ID `volc.bigasr.sauc.duration`);与 TTS 共用同一个 UUID Key。
- 只有 16 kHz、单声道、16 位 PCM 的 WAV 走流式识别(网页端录音即为此格式);mp3 或其他采样率直接走 `UPSTREAM_WHISPER_MODE` 的路径。`UPSTREAM_WHISPER_MODE=openai` 时,只有 `response_format` 为空或 `json` 的请求走流式;`verbose_json`、`text`、`srt`、`vtt` 仍原样转发给 Whisper,响应格式不变。
- 流式识别失败(鉴权、额度、超时、协议错误、空结果、意外异常)时记录失败类别、`connect_id` 与上游 `logid`,并**自动回退**到 `UPSTREAM_WHISPER_MODE` 的路径。同一进程连续 3 次鉴权或额度失败后,60 秒内不再尝试流式,直接回退;并发已满的请求也直接回退。
- 未配置回退时:不适合流式的请求(mp3、非 16 kHz 等)返回 503 `Whisper upstream is not configured`;流式失败返回 502(鉴权失败为 `Upstream authentication failed`,其余为 `Upstream unavailable`),缺少密钥返回 503。
- 成功时返回 `{"text": "...", "segments": []}`(与 `chat` 模式相同,无时间戳);`language` 参数被忽略(模型自动识别中英文)。
- 日志只记录耗时、音频秒数和失败类别(成功时一行 `timing event=stt_volc_stream ...`,见「语音提速与实时通话」的耗时日志;失败时 `asr volc_stream failed ...`),不记录文本与密钥。

**语法检查模型**:默认用 `DEFAULT_LLM_MODEL` 和 LLM 上游(需支持 JSON 模式)。可用 `GRAMMAR_MODEL` 换模型,或用 `UPSTREAM_GRAMMAR_BASE_URL` / `UPSTREAM_GRAMMAR_KEY` 换到另一家 OpenAI 兼容服务。提示词由两部分组成:可替换的"检查规则"(内置默认 → `GRAMMAR_PROMPT` → `GRAMMAR_PROMPT_FILE`,文件优先;每个用户还可以在网页「我的」页改自己的规则并一键恢复默认)+ 服务端固定追加的输出格式要求(JSON 结构、类别、`original` 必须出自原文、最多 8 项)。模型输出会被严格校验,不合格返回 502,错误体不含上游内容。`GRAMMAR_PROMPT_FILE` 读不到或为空时服务拒绝启动。这些设置都不会通过 `/api/config` 暴露。

## 语音提速与实时通话(计划 2026-10-07)

> **验证状态**:本节描述行为与配置。哪些环节只用假上游/假设备测过、哪些用真实上游测过、哪些完全未验证,逐项记录在 `docs/superpowers/plans/e2e-results.md` 的「语音提速、按住说话与实时通话」一节;凡文中标"未验证"的,不要当作已通过。延迟数字只引用 `docs/superpowers/plans/2026-10-07-voice-latency.md`,本文不写性能数字。

### 新增配置项

默认值与 `server/.env.example` 一致(密钥相关项见前文,此处不重复)。

| 变量 | 默认 | 说明 |
|---|---|---|
| `STT_MAX_TOKENS` | `512` | `chat` 模式识别(`UPSTREAM_WHISPER_MODE=chat`,含 `volc_stream` 失败后的回退)的输出长度上限,只作异常输出封顶 |
| `STT_DISABLE_THINKING` | `auto` | 是否向识别请求加 `thinking: {"type": "disabled"}`:`auto` 只在 `UPSTREAM_WHISPER_BASE_URL` 的主机是 `volces.com`(含子域,方舟)时发送;`true` 总是发送;`false` 从不发送(大小写不敏感,旧的 `1/0/yes/no` 也认,无法识别按 `auto`)。2026-10-07 spike 中 `doubao-seed-2-0-lite-260428` 接受该参数;换了模型而上游返回 4xx 时设为 `false` |
| `UPSTREAM_ASR_MODE` | `chat` | 上传识别:`chat`(默认)或 `volc_stream`(火山流式识别,见上文);**语音消息(上传)始终走 `/api/ai/audio/transcriptions`**,通话识别另由 `REALTIME_ASR_MODE` 决定 |
| `ASR_STREAM_URL` | `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream` | 上传识别用的火山流式识别地址(`volc_stream` 模式) |
| `ASR_STREAM_RESOURCE_ID` | `volc.bigasr.sauc.duration` | 同上,资源 ID(通话识别也用它) |
| `ASR_STREAM_TIMEOUT_SECONDS` | `30` | 实际超时 = min(该值 + 音频秒数, 120) |
| `ASR_STREAM_MAX_CONCURRENCY` | `3` | 每进程并发上限;**上传识别与实时通话共用同一个并发闸门与熔断**(连续 3 次鉴权/额度失败后 60 s 内不再尝试流式) |
| `VOLCENGINE_ASR_KEY` | 空 | 留空则复用 `VOLCENGINE_TTS_KEY`(两种识别共用) |
| `ASR_REALTIME_URL` | `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async` | 通话流式识别地址(`REALTIME_ASR_MODE=stream`) |
| `REALTIME_ASR_MODE` | `buffered` | 通话识别:`buffered`(客户端 VAD 断句,整句上传识别)或 `stream`(`bigmodel_async` 边说边识别,有 partial)。`stream` 但没有流式识别密钥时**实际生效的是 `buffered`**;`GET /api/realtime/config` 的 `asr_mode` 就是实际生效值 |
| `REALTIME_ENABLED` | `false` | 实时通话总开关。**默认关;开启前确认火山 TTS、LLM、识别都可用** |
| `REALTIME_MAX_MINUTES` | `10`(1–60) | 单次通话最长分钟数,到点以 `4009` 挂断 |
| `REALTIME_IDLE_TIMEOUT_SECONDS` | `60`(10–600) | 连续这么久没有收到上行音频、且没有进行中的一轮,以 `4008` 挂断 |
| `REALTIME_MAX_SESSIONS` | `5`(1–100) | 全局并发通话数;每用户并发固定为 1。通话名额在发出关闭帧时即释放(挂断后可立即重拨),尚未完成的评测在后台最多再等 10 s 入库,不占名额、不计入此上限 |
| `REALTIME_TICKET_TTL_SECONDS` | `60`(10–300) | 一次性票据有效期 |
| `REALTIME_TTS_MODEL` | `volcengine/seed-tts-2.0` | 通话的逐句合成模型;必须是火山模型,且在 `TTS_MODELS` 里 |
| `REALTIME_TTS_SAMPLE_RATE` | `24000` | 通话下行 PCM 采样率(请求火山 `pcm` 输出)。24000 由 spike 时长推算,**听感核对未做**,未排除 22050 |
| `REALTIME_LLM_DISABLE_THINKING` | `auto` | 通话的 LLM 请求是否加 `thinking: {"type": "disabled"}`:`auto` 只在 `UPSTREAM_LLM_BASE_URL` 的主机是 `deepseek.com` 或 `volces.com`(含子域,不含相似域名)时发送;`true` 总是发送;`false` 从不发送(大小写不敏感,旧的 `1/0/yes/no` 也认,无法识别按 `auto`)。OpenAI、Azure 等会对未知参数返回 HTTP 400,所以 `auto` 不向它们发送。2026-10-07 真实上游各测一次:`deepseek-v4-flash-vision-exp` 与 `deepseek-v4-pro` 都返回 200;不加时两者都先输出 89–116 个推理 token(首个文字 1.4–1.9 s),加上后推理 token 为 0、首个文字 0.5–1.0 s。推理 token 也计入通话的 `max_tokens`(≤ 600)。经由自建网关转发 DeepSeek/方舟时主机不匹配,需显式设为 `true` |
| `LOG_LEVEL` | `INFO` | `app.*` 日志级别。下面的耗时日志是 INFO 级,设为 `WARNING` 会看不到。该项不在 `.env.example` 里,需要时自己加 |

`GET /api/realtime/config` 的 `enabled` 为真需要同时满足:`REALTIME_ENABLED=true`、已配置 `VOLCENGINE_TTS_KEY`、`REALTIME_TTS_MODEL` 在 `TTS_MODELS` 中、已配置 LLM 上游、至少一条识别路径可用(流式密钥,或 chat/Whisper 回退)。

`REALTIME_ASR_MODE=stream` 的取舍:2026-10-07 的 spike(按真实节奏推流)连接 9/9 成功、最后一包到最终结果 68–92 ms,但 9/9 次都把 "ask not" 识别成 "Not."(丢了 "ask"),chat 模式同一段是对的。通话转写会作为发音评测的参考文本,错词会影响评分。所以默认保持 `buffered`,是否打开 `stream` 请先在真机上自己核对准确度(**未验证**:真机、中文/中英混说、噪声)。流式识别连不上时,该次通话自动退到 `buffered` 并给客户端发 `degraded`。

识别提示词(chat 模式)要求"只转写最近、最清晰的说话人、忽略背景人声",没有清晰前景语音时只输出 `<none>`,服务端据此返回 `200 {"text": "", "segments": []}`;上游返回空串仍是 `502 Upstream unavailable`。这只能**降低**旁人声音的影响,不能排除;2026-10-07 spike 只用合成的双人声音验证过,真实嘈杂环境**未验证**。

### 新接口

**`POST /api/ai/audio/speech` 的 `stream=true`**:请求体新增可选 `stream`(默认 `false`,行为与以前逐字节相同)。模型是火山时,服务端先取到第一块音频再返回 `StreamingResponse`(`audio/mpeg`、`Cache-Control: no-store`、`X-Accel-Buffering: no`),因此第一块之前的错误仍是正常的 JSON 错误(502/503/400);第一块之后上游出错则截断响应并记日志(客户端会得到一段较短的音频)。模型不是火山时忽略 `stream`,整段返回。网页端的朗读**不依赖**它(`<audio>` 需要完整 blob),它的用途是通话的服务端内部与首块延迟测量。

**`GET /api/realtime/config`**(需登录):`{enabled, max_minutes, idle_timeout_seconds, asr_mode, sample_rate_in: 16000, sample_rate_out}`。

**`POST /api/realtime/ticket`**(需登录,按用户限流):请求 `{conversation_id}`,返回 `{ticket, expires_in}`。未开启返回 `503 Realtime is not enabled`;会话不属于该用户返回 404。票据一次性、进程内保存,每用户最多同时保留 5 张(再签发会挤掉最旧的)。

**`WS /api/realtime?ticket=<ticket>`**(票据是认证方式,不带 Bearer 头)。协议(JSON 一律 snake_case,与 `web/src/features/realtime/protocol.ts` 逐字对应,服务端定义见 `app/realtime_protocol.py`):

- 连接后 10 s 内必须发 `start`:`{type:"start", system_prompt(≤ 8000 字符), model, temperature(0–2), voice, language:"en", save_recordings}`;未知字段、类型不符、超长一律按协议错误处理。
- 上行二进制 = 16 kHz 单声道 PCM16LE,单帧 ≤ 32000 字节且为偶数字节;上行 JSON:`utterance_end`、`interrupt`、`hangup`。
- 下行 JSON:`ready {asr: "stream"|"buffered"}`、`state {state: "listening"|"thinking"|"speaking"}`、`transcript_partial`、`transcript_final {text, message_id}`、`reply_delta {turn_id, text}`、`reply_done {turn_id, message_id, interrupted}`、`assessment {message_id, status: "done"|"failed"|"quota", ...}`、`degraded {reason: "asr"}`、`error {code: "asr_failed"|"llm_failed"|"tts_failed"|"rate_limited"|"message_limit"}`。
- 下行二进制 = 4 字节大端 `turn_id` + `sample_rate_out` 的 PCM16LE;客户端丢弃 `turn_id` 不是当前轮的块。
- 服务端在 `transcript_final` 后立即保存用户消息(空转写不保存、不回复),回复结束保存助手消息;被打断时保存"已完整下发音频的句子"拼接 + `" …"`。LLM 上下文 = `start` 里的系统提示词 + 库里最近 20 条消息。发音评测在后台异步进行(讯飞,参考文本 = 转写),录音按既有规则保存并计入配额,超额下发 `assessment {status:"quota"}`,不阻断对话。

关闭码:

| 码 | 含义 |
|---|---|
| `1000` | 正常挂断(客户端 `hangup`,或发送失败/客户端消失后的清理) |
| `4001` | 票据无效、过期或已用过 |
| `4003` | 功能未开启(此时不消耗票据) |
| `4004` | 会话不存在或不属于该用户 |
| `4008` | 静音超时(`REALTIME_IDLE_TIMEOUT_SECONDS`) |
| `4009` | 超过最长时长(`REALTIME_MAX_MINUTES`) |
| `4013` | 会话消息已满(先下发 `error {code:"message_limit"}`) |
| `4029` | 该用户已有通话进行中,或全局并发已满 |
| `4400` | 协议错误(含 10 s 内没有合法 `start`、超长/奇数字节的音频帧) |
| `4502` | 上游不可用(开始时没有任何可用的识别路径) |
| `1011` | 服务端意外错误(不在原始协议表里;客户端显示通用错误文案) |

挂断收尾:收到客户端 `hangup` 后,服务端在发关闭帧之前最多再用 `HANGUP_GRACE`(2.5 s,从收到 `hangup` 起算,下面两步共用)——已发 `utterance_end`、还在识别的话语继续识别并保存用户消息、下发 `transcript_final`(但**不再开始回复**;还没发 `utterance_end` 的半句直接丢弃);然后等还没出结果的发音评测并下发它们的 `assessment`。正在回复的一轮仍立即取消、保存已说出的部分。超时未完成的识别被中止;超时的评测不取消,关闭后仍有 10 s 完成入库与关联,只是事件不再下发。网页端挂断后最多等 3 s 关闭帧。服务端发起的关闭(静音/时长超限、协议错误、发送失败、客户端未发 `hangup` 就断开)不做这段等待,立即关闭。

每一轮用户话语在第一帧音频到达时消耗一次 `AI_RATE_LIMIT_PER_MINUTE` 额度(所以噪声触发的空话语也会消耗);超限时下发 `error {code:"rate_limited"}`,本轮不识别、不回复,**不断开**。同时识别中的话语最多 3 个,超出的话语被静默丢弃(协议没有"忙"错误码,客户端收不到提示)。

### 耗时日志格式

只记事件名与数字,**绝不记录用户文本、转写、回复、提示词或密钥**。一行 `timing event=<event> k=v ...`,键按字母序,值为整数、`true`/`false` 或 `[A-Za-z0-9_.-]{1,40}` 字符串(其他一律 `?`)。事件(`app/timing.py`):

| event | 字段 | 说明 |
|---|---|---|
| `stt_chat` | `audio_bytes ms status` | chat 模式识别;`status` = 上游 HTTP 状态,`0` = 没有响应 |
| `stt_volc_stream` | `audio_bytes ms status` | 火山流式识别(上传路径与缓冲式通话识别);`200` 成功,`0` 失败 |
| `tts_volcengine` | `chars ms status stream` | 一次合成;`stream=true` 时 `ms` 是整个流结束的时间 |
| `tts_volcengine_first_chunk` | `chars ms` | `stream=true` 时第一块音频到达 |
| `realtime_call` | `close interrupts seconds turns` | 每次通话结束一行;`close` 是关闭码 |

格式示例(数字是占位,不是测量结果):

```
timing event=stt_chat audio_bytes=160044 ms=1234 status=200
timing event=realtime_call close=1000 interrupts=0 seconds=42 turns=3
```

延迟的测量方法与结果见 `docs/superpowers/plans/2026-10-07-voice-latency.md`。

### 实时通话的部署注意

- **反向代理必须转发 WebSocket**:`/api/realtime` 需要 `Upgrade` / `Connection` 头,读超时不得小于 `REALTIME_MAX_MINUTES`(留余量:默认 10 分钟时 `proxy_read_timeout` 至少 `660s`)。Nginx 示例:

  ```
  location /api/realtime {
      proxy_pass http://127.0.0.1:8000;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_read_timeout 660s;
      proxy_send_timeout 660s;
  }
  ```

  1Panel / OpenResty:在站点的反向代理里开启 WebSocket 支持并调长读超时。**未验证**:本项目没有在生产代理(1Panel / OpenResty)后面跑过 WebSocket,Caddy 的默认行为也未实测,需要你部署后自己确认(通话一接通就以 1006 断开,多半是代理没转发 Upgrade)。
- **票据在 URL 里**:浏览器 WebSocket 不能带自定义头,票据放在查询串 `?ticket=` 中。票据 60 s、一次性,风险有限。服务端已在 uvicorn 的 `uvicorn`、`uvicorn.error`、`uvicorn.access` 日志上做了脱敏(`ticket=[redacted]`,用真实 uvicorn 验证过);**反向代理的访问日志、浏览器地址历史/开发者工具里仍可能看到它**,需要时在代理里对该路径关闭或脱敏查询串。若在意,后续可改为首条 WS 消息或子协议携带票据(需同时改服务端与网页端协议)。
- **`--ws-max-size`**:uvicorn 默认接收的 WebSocket 消息上限是 16 MiB,应用层的 32000 字节上限(`4400`)是在整帧收下之后才校验。`server/Dockerfile` 已加 `--ws-max-size 65536`;本机直接运行时自己加上:`uv run uvicorn app.main:create_app --factory --ws-max-size 65536`。
- **单 worker**:票据、通话并发登记、限流、识别并发闸门与熔断、评测落盘锁都在进程内,**不支持多 worker**(`--workers 1`)。多 worker 下票据可能签在 A、兑换在 B 而失败,并发上限也会各算各的。

## 成本保护

- `/api/ai/*`、`POST /api/speech/tokens` 与 `POST /api/speech/assessments` 按用户限流,上限由 `AI_RATE_LIMIT_PER_MINUTE` 控制(默认 60,超出返回 429)。
- 语法检查 `POST /api/ai/grammar` 同样按用户限流;`text` ≤ 2000 字符(超出 413),`context` 只取最后 500 字符。一轮语音消息 = 转写 + 评测 + 回复 + 语法共 4 次上游调用,文字消息 = 回复 + 语法 2 次(网页端对少于 3 个英文单词或非英文的消息不查语法,并缓存同一文本的结果)。
- 聊天请求的 `n` 最多 4;`max_tokens` / `max_completion_tokens` 超过 `LLM_MAX_TOKENS`(默认 4096)会被压到该值,请求未带则保持缺省。
- 非 multipart 请求体超过 1 MiB 返回 413;转写与发音评测上传(multipart)上限 25 MiB。讯飞免费额度可能远低于用户限流上限。
- 手机网页版对话的**自动朗读默认开启**:每条新回复(以及场景开场白)各调用一次 TTS(见下条:按句朗读后变为每句一次);"不会说?"提示与复盘总结各调用一次 LLM(只在用户点击时)。按用户限流 `AI_RATE_LIMIT_PER_MINUTE` 同样覆盖 `/api/stats`。
- 按句朗读:网页端回复流到第一句结束就开始合成,最多预取 2 句,**自动朗读的 TTS 调用数从"每条回复一次"变为"每句一次"**(以句子文本为缓存键,相同句子不重复请求);手动点"朗读"仍按整条文本合成,多一次调用。
- 实时通话:每一轮 = 识别 ×1 + LLM ×1(流式,`max_tokens` ≤ 600)+ 每句 TTS ×1 + 讯飞评测 ×1(异步,录音计入配额);每用户并发 1 路、全局 `REALTIME_MAX_SESSIONS` 路、单次最长 `REALTIME_MAX_MINUTES` 分钟、静音 `REALTIME_IDLE_TIMEOUT_SECONDS` 秒自动挂断;每一轮计入 `AI_RATE_LIMIT_PER_MINUTE`。`REALTIME_ASR_MODE=stream` 按连接时长计费,**单价未知**,所以默认关闭并设上限;通话录音一律保存,配额消耗比语音消息更快。
- 语音消息识别:`STT_DISABLE_THINKING`(方舟上游 `auto` 即生效)与 `STT_MAX_TOKENS` 减少方舟输出;`UPSTREAM_ASR_MODE=volc_stream` 改走火山流式识别(另有计费,单价未知)。客户端判定没有前景语音的录音不会上传,不产生识别调用。

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

手机网页版的录音与「添加到主屏幕」同样依赖 HTTPS。

另外,反向代理需允许较大的请求体(音频上传转写),例如 Nginx 的 `client_max_body_size 25m;`。

## 手机网页版

同一个镜像同时托管手机网页版(`web/`,PWA):`docker compose up -d --build` 后访问 `https://<你的域名>/` 即可,API 与网页同源,无需 CORS。网页版只覆盖练习子集(登录、跟读评测、AI 对话、查词翻译)。

- **必须 HTTPS**:手机浏览器只在安全上下文里允许录音;iOS 的「添加到主屏幕」也需要 HTTPS。反向代理配置同上一节,请求体上限保持 `25m`(录音上传)。
- **数据**:对话、消息、评测记录存数据库;评测录音存 `DATA_DIR/recordings/<用户 ID>/`。`DATA_DIR` 留空时:SQLite 文件库取库文件所在目录,否则为 `/data`(默认 compose 卷)。备份时同时备份数据库与该目录。每个账号的对话/消息存储上限为 `MAX_CONVERSATIONS` x `MAX_MESSAGES_PER_CONVERSATION` x 20000 字符;公网部署建议使用 `REGISTRATION_MODE=invite` 或 `closed`。
- **上限**:`RECORDING_QUOTA_MB`(每用户录音总量,默认 500)、`CHAT_ORPHAN_GRACE_HOURS`(未关联任何消息的对话录音的保留小时数,默认 6,过期后在该用户下次保存对话录音时自动清理并释放配额)、`MAX_CONVERSATIONS`(默认 200)、`MAX_MESSAGES_PER_CONVERSATION`(默认 1000)、`MAX_PRACTICE_ITEMS`(练习清单条数,默认 500,超限 429)、`MAX_VOCAB_ITEMS`(词汇本条数,默认 2000,超限 429);单条录音 ≤ 5 分钟。超限分别返回 413(录音配额)/ 429(对话、消息数)。用户可在网页里删除旧录音。
- **前端目录**:`WEB_DIST_DIR` 指定网页构建产物目录;留空使用 `<仓库根>/web/dist`(Docker 镜像内为 `/web/dist`)。
- **更新**:前端资源带哈希(`/assets/*` 长期缓存),`index.html` 与 `sw.js` 不做强缓存;重新部署后用户刷新即得到新版本(service worker 只缓存 `/assets/*`,不做离线学习)。
- **接口**:`/api/conversations`、`/api/messages/{id}`、`/api/assessments`(见「接口一览」);`POST /api/speech/assessments` 加 `save=true` 时保存录音并在响应里返回 `assessment_id`,不带时与桌面端行为完全一致。对话消息可关联评测与语法结果(`PATCH /api/messages/{id}` 补写);删除消息/对话会同时删除对话录音(`source=chat` 的评测)及其文件;`GET /api/assessments` 默认只列跟读页的记录(`?source=chat|all` 可筛选)。词汇本复习:`POST /api/vocabulary/{id}/review` `{"grade": "forgot"|"hard"|"good"}`,间隔 1/2/4/7/15/30 天。两种 409:`Vocabulary item is not due`(未到期)与 `Vocabulary item was already reviewed`(连点/并发/丢响应后重试,该次复习已被应用过);网页端遇到任一 409 都应重新拉取待复习列表后继续,不当作硬错误。
- **学习进度** `GET /api/stats`:`days` 取 7/30/90;`tz_offset_minutes`(-720..840,默认 0)是客户端相对 UTC 的分钟数,按本地日期分桶(窗口内跨夏令时会有一小时误差)。只扫描最近 90 天内最多 5000 条用户消息与 2000 条评测(读差的词只看窗口内最近 200 条评测),超出时响应 `truncated: true`;连续天数最多 90。与 AI 接口共用每用户每分钟限额 `AI_RATE_LIMIT_PER_MINUTE`。数字来自自由说话评测,仅供参考。
- 开发与测试见 `web/README.md`。

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

- 自由说话评测/语法检查实测:`uv run python scripts/eval_free_speech.py --base-url http://127.0.0.1:8765`(默认端口 8765;需要 ffmpeg 与真实上游;用临时库运行,方法见 docs/superpowers/plans/2026-10-05-free-speech-evaluation.md;目前尚未运行)。

## 构建说明

`server/uv.lock` 中的包地址指向清华 PyPI 镜像(`pypi.tuna.tsinghua.edu.cn`),在中国大陆没问题,其他地区可能很慢或无法访问。如需改用官方源重新锁定:

```bash
cd server && uv lock --default-index https://pypi.org/simple
```

然后重新构建镜像。

Docker 构建会在 Node 阶段运行 `yarn workspaces focus web` 与 `yarn workspace web build`,只安装网页版依赖;忽略规则见 `server/Dockerfile.dockerignore`。

## 已知限制

- 仅支持单 worker(限流与 Azure token 缓存都在进程内;实时通话的票据、并发登记、识别闸门也在进程内,多 worker 不受支持)。
- 实时通话:旁人声音只能降低、不能消除(近讲门限、VAD 双条件、识别提示词三层都只是缓解);流式通话识别(`REALTIME_ASR_MODE=stream`)默认关,spike 发现它会丢词(见上文),spike 结论见 `docs/superpowers/plans/2026-10-07-voice-spike-results.md`;生产反向代理的 WebSocket 转发未验证;票据在 URL 里(见「实时通话的部署注意」);服务端意外错误以 `1011` 关闭,不在原始关闭码表里。
- 实时通话没有在真实 iOS/Android 设备、真实反向代理、真实 Docker 镜像上验证过,真机清单第 23–32 项见 `docs/superpowers/plans/e2e-results.md`。
- 手机端使用官方网页版账号,与自建后端的账号不互通。
- 桌面客户端在创建 segment 后仍会把片段音频上传到 `storage.enjoy.bot`(`enjoy/src/main/db/models/segment.ts`、`main/storage.ts`)。这是上游既有行为,不在本后端覆盖范围内。
- 练习清单(`practice_items`)与词汇本(`vocabulary_items`)的去重在应用层完成,没有唯一索引:两个并发的相同 POST 可能各插一行(见 `server/app/routers/practice_items.py` 的 "Known race" 注释)。词汇本沿用同一取舍。
- 配置快照来自官方公开接口,需要时用 `fetch_config.py` 手动刷新。
