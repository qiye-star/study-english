# Enjoy 自建后端

一个轻量的 FastAPI 服务,替代 enjoy.bot:提供账号密码认证、配置快照,并把 AI 请求代理到你自己的上游(LLM / TTS / Whisper / Azure Speech)。

## 接口一览

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

发音评测与默认 STT:客户端拿到 token 后直连 Azure,音频不经过后端。

## 快速开始

```bash
cp server/.env.example server/.env
# 编辑 server/.env,填写上游地址与密钥
docker compose up -d --build
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

使用 Postgres 跑测试套件(先创建 `enjoy_test` 库):

```bash
docker compose exec postgres psql -U enjoy -d enjoy -c 'CREATE DATABASE enjoy_test;'
cd server && TEST_DATABASE_URL=postgresql+asyncpg://enjoy:change-me@localhost:5432/enjoy_test uv run pytest -q
```

## 切换数据库

- SQLite(默认):`DATABASE_URL=sqlite+aiosqlite:////data/app.db`,数据在 compose 卷 `enjoy-data` 中。
- Postgres:把 `DATABASE_URL` 改为 `postgresql+asyncpg://enjoy:<密码>@postgres:5432/enjoy`(密码与 `POSTGRES_PASSWORD` 一致),并用 `docker compose --profile postgres up -d --build` 启动。

**注意:切换数据库不会迁移已有数据**,新库是空的。

## 注册保护

`REGISTRATION_MODE`:

- `open`:任何人可注册(默认)
- `invite`:注册时必须提供与 `INVITE_CODE` 相同的邀请码
- `closed`:关闭注册

注册与登录接口按 IP 限流,上限由 `RATE_LIMIT_PER_MINUTE` 控制(每分钟次数)。

## 必须使用 HTTPS

密码与访问令牌在网络上传输,公网部署必须放在 HTTPS 反向代理之后。Caddyfile 示例:

```
your.domain {
    reverse_proxy server:8000
}
```

并在 `server/.env` 中设置 `TRUST_PROXY_HEADERS=true`,让限流使用 `X-Forwarded-For` 中的真实客户端 IP。

重要:启用 `TRUST_PROXY_HEADERS=true` 后,反向代理必须**覆盖**(而不是追加)`X-Forwarded-For`,否则客户端可以伪造该头绕过限流。Caddy 默认会覆盖来自不受信任来源的该头;Nginx 请使用 `proxy_set_header X-Forwarded-For $remote_addr;`(不要用 `$proxy_add_x_forwarded_for`)。

另外,反向代理需允许较大的请求体(音频上传转写),例如 Nginx 的 `client_max_body_size 25m;`。

## 让客户端指向它

- 构建/开发时:在 `enjoy/.env` 中设置 `VITE_API_URL=https://your.domain`。
- 如果客户端没有读到 `VITE_API_URL`,可以通过运行时环境变量 `WEB_API_URL` 设置,或在应用内「高级 → API 地址」(登录页的「高级」)中填写。

## 冒烟脚本与配置快照

```bash
cd server
uv run python scripts/smoke.py --base-url http://localhost:8000     # 端到端检查(需要真实上游才能全部通过)
uv run python scripts/fetch_config.py                               # 刷新配置快照
```

没有配置上游凭据时,注册检查通过,AI 相关检查会返回 503 而被跳过或失败。

## 已知限制

- 仅支持单 worker(限流与 Azure token 缓存都在进程内)。
- 手机端使用官方网页版账号,与自建后端的账号不互通。
- 配置快照来自官方公开接口,需要时用 `fetch_config.py` 手动刷新。
