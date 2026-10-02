# 自建后端与客户端二次开发 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个兼容 enjoy.bot 接口子集的 Python 后端(账号密码登录、AI 代理、Azure token、配置快照),并对 Electron 客户端做最小改动,使其脱离官方服务器、无需用户配置 AI。

**Architecture:** `server/`(FastAPI + SQLAlchemy 2 async + Alembic,uv 管理依赖,Docker 打包)按客户端现有约定响应;客户端把默认 `apiUrl` 指向它,登录页换成账号密码表单,AI 设置入口隐藏。后端只存用户相关数据,同步类接口收下即丢。

**Tech Stack:** Python ≥3.11、uv、FastAPI、SQLAlchemy 2(async)、Alembic、argon2-cffi、httpx、pytest + pytest-asyncio + respx;客户端 Electron + React + TypeScript(Yarn 4)。

**Spec:** `docs/superpowers/specs/2026-10-02-self-hosted-backend-design.md`

## 全局约束

(每个任务都隐含遵守本节。数值与命名与设计文档一致。)

- 后端 JSON 一律 **snake_case**;错误体统一为 `{"error": "<message>"}`。
- 用户 `id` 为 **8 位数字**,以字符串返回(`/^\d{8}$/`)。
- 用户名:小写 `^[a-z0-9_]{3,32}$`;密码 8–128 位;argon2id。
- accessToken:`secrets.token_urlsafe(32)`,库内只存 SHA-256,不过期,不用 JWT。
- `GET /api/me` **不得**返回 `access_token`。
- 注册模式 `REGISTRATION_MODE=open|invite|closed`;登录/注册限流默认每 IP 每分钟 10 次。
- LLM:请求的 `model` 不在 `LLM_MODELS` 内时改写为 `DEFAULT_LLM_MODEL`;`stream:true` 必须 SSE 透传。
- TTS:`input` 最长 4096 字符;支持 `azure/speech` 与 `openai/<model>`;其他模型返回 400。
- Azure token 在服务端缓存 8 分钟(`TOKEN_TTL = 480` 秒)。
- 后端以**单 worker** 运行(限流器为进程内实现)。
- 不提供 `bugsnag_api_key`(返回 404)。
- 所有命令在 **Git Bash** 中执行(仓库根目录 `E:\workspace\everyone-can-use-english`,后端命令在 `server/` 下)。
- 提交信息格式 `<type>(<scope>): <说明>`,末尾追加一行 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`。
- 不修改 `1000-hours/`、`1000h-portal/`、`book/`;客户端只做设计文档第 9 节列出的改动。

## 文件结构

新增(后端):

| 路径 | 职责 |
|---|---|
| `server/pyproject.toml`, `server/uv.lock` | 依赖与 pytest 配置 |
| `server/app/config.py` | `Settings`(环境变量) |
| `server/app/db.py` | `Base`、`make_engine`、`ensure_sqlite_dir` |
| `server/app/models.py` | `User`、`AccessToken`、`SpeechToken` |
| `server/app/security.py` | 密码哈希、token 生成与哈希 |
| `server/app/ratelimit.py` | 进程内滑动窗口限流器 |
| `server/app/deps.py` | `get_settings`、`get_session`、`current_user`、`auth_rate_limit` |
| `server/app/errors.py` | 统一错误体 |
| `server/app/azure.py` | Azure token 缓存与 TTS(SSML) |
| `server/app/main.py` | `create_app()` 工厂 |
| `server/app/routers/health.py` | `GET /up` |
| `server/app/routers/sessions.py` | 注册、登录、`/api/me` |
| `server/app/routers/config_api.py` | `/api/config/{key}` |
| `server/app/routers/ai_chat.py` | `/api/ai/chat/completions` |
| `server/app/routers/ai_audio.py` | `/api/ai/audio/speech`、`/api/ai/audio/transcriptions` |
| `server/app/routers/speech.py` | `/api/speech/tokens` |
| `server/app/routers/stubs.py` | 词典/翻译占位 + 写入类接口占位(**必须最后注册**) |
| `server/app/static_config/*.json` | 配置快照 |
| `server/alembic/`, `server/alembic.ini` | 数据库迁移 |
| `server/scripts/fetch_config.py`, `server/scripts/smoke.py` | 快照下载、真实上游冒烟 |
| `server/tests/` | 测试 |
| `server/Dockerfile`, `docker-compose.yml`, `server/.env.example`, `server/README.md` | 部署 |

修改(客户端,均在 `enjoy/` 下):`src/constants/index.ts`、`forge.env.d.ts`、`src/api/client.ts`、`src/renderer/context/app-settings-provider.tsx`、`src/renderer/components/login/login-form.tsx`(+ 新增 `password-login-form.tsx`、`login/index.ts`)、`src/renderer/hooks/use-transcribe.tsx`、`src/renderer/components/preferences/{preferences,stt-settings}.tsx`、`src/renderer/components/conversations/{gpt-providers,tts-providers}.tsx`、`src/renderer/components/layouts/sidebar.tsx`、`src/renderer/components/preferences/user-settings.tsx`、`src/i18n/{en,zh-CN,es}.json`、`.env.example`。

## 阶段总览

| 阶段 | 目标 | 验收门槛(全部满足才进入下一阶段) |
|---|---|---|
| 0 | 分支与工具链 | 在新分支上,`uv`、`docker`、`yarn` 可用 |
| 1 | 后端骨架 + 认证 + 迁移 | 自动化测试全绿;迁移可建表;curl 走通注册/登录/`/me` |
| 2 | 配置快照 + 占位接口 | 测试全绿;快照文件齐全;客户端依赖的 config key 都能取到 |
| 3 | LLM 代理 | 测试全绿;**真实上游**流式对话、JSON 模式、tool call 通过 |
| 4 | Azure token + TTS + Whisper | 测试全绿;**真实上游**冒烟脚本全部 PASS |
| 5 | 客户端改动 | 类型检查无新增错误;手动端到端清单全部通过 |
| 6 | Docker / Postgres / 文档 | 镜像可构建;SQLite 与 Postgres 两种模式都跑通冒烟;测试在 Postgres 上通过 |

**规则:未满足本阶段验收门槛,不得开始下一阶段。** 可并行的工作见文末「可并行开发」。

---

## 阶段 0:准备

### Task 0.1:分支、工具链、提交文档

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 确认工具链**

Run: `uv --version && docker --version && docker compose version && python --version`
Expected: 四条命令都有版本输出(uv ≥ 0.5、Python ≥ 3.11)。

- [ ] **Step 2: 创建分支**

Run: `cd /e/workspace/everyone-can-use-english && git checkout -b feat/self-hosted-backend && git status --short`
Expected: 切换到新分支;状态里只有 `docs/` 下未跟踪文件。

- [ ] **Step 3: 追加忽略规则**

在根目录 `.gitignore` 末尾追加:

```gitignore

# self-hosted backend
server/.venv/
server/data/
server/.env
enjoy/.env
```

- [ ] **Step 4: 提交文档与忽略规则**

```bash
git add .gitignore docs/
git commit -m "docs: add self-hosted backend design and plan" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

**验收门槛 0:** `git branch --show-current` 输出 `feat/self-hosted-backend`。

---

## 阶段 1:后端骨架 + 认证 + 迁移

**阶段目标:** `server/` 可启动;注册、登录、`/api/me` 可用;限流与注册模式生效;迁移可在全新 SQLite 上建表。

### Task 1.1:项目脚手架(依赖、配置、数据库、模型、安全)

**Files:**
- Create: `server/pyproject.toml`, `server/app/__init__.py`, `server/app/config.py`, `server/app/db.py`, `server/app/models.py`, `server/app/security.py`
- Create: `server/tests/__init__.py`, `server/tests/test_security.py`, `server/tests/test_config.py`

**Interfaces:**
- Produces:
  - `Settings`(见下方字段)及属性 `llm_model_list: list[str]`、`tts_model_list: list[str]`
  - `Base`、`make_engine(url: str) -> AsyncEngine`、`ensure_sqlite_dir(url: str) -> None`
  - 模型 `User(id:int, username:str, password_hash:str, created_at)`、`AccessToken(id, user_id, token_hash, created_at)`
  - `hash_password(p) -> str`、`verify_password(h, p) -> bool`、`new_token() -> str`、`hash_token(t) -> str`

- [ ] **Step 1: 初始化 uv 项目**

Run:
```bash
cd /e/workspace/everyone-can-use-english && mkdir -p server/app/routers server/tests server/scripts && cd server
```

创建 `server/pyproject.toml`:

```toml
[project]
name = "enjoy-server"
version = "0.1.0"
description = "Self-hosted backend for the Enjoy desktop app"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "sqlalchemy[asyncio]>=2.0.30",
  "aiosqlite>=0.20",
  "asyncpg>=0.29",
  "alembic>=1.13",
  "argon2-cffi>=23.1",
  "httpx>=0.27",
  "pydantic-settings>=2.3",
  "python-multipart>=0.0.9",
]

[dependency-groups]
dev = [
  "pytest>=8",
  "pytest-asyncio>=0.23",
  "respx>=0.21",
]

[tool.uv]
package = false

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
pythonpath = ["."]
```

Run: `uv sync`
Expected: 创建 `.venv` 与 `uv.lock`,无报错。

- [ ] **Step 2: 写失败测试**

`server/tests/test_security.py`:

```python
from app.security import hash_password, hash_token, new_token, verify_password


def test_password_roundtrip():
    h = hash_password("correct horse")
    assert h != "correct horse"
    assert verify_password(h, "correct horse") is True
    assert verify_password(h, "wrong") is False


def test_verify_password_rejects_garbage_hash():
    assert verify_password("not-a-hash", "x") is False


def test_token_helpers():
    a, b = new_token(), new_token()
    assert a != b and len(a) >= 32
    assert hash_token(a) == hash_token(a)
    assert hash_token(a) != a and len(hash_token(a)) == 64
```

`server/tests/test_config.py`:

```python
from app.config import Settings


def test_model_lists_are_split_and_trimmed():
    s = Settings(_env_file=None, llm_models=" gpt-4o , gpt-4o-mini ,", tts_models="openai/tts-1,azure/speech")
    assert s.llm_model_list == ["gpt-4o", "gpt-4o-mini"]
    assert s.tts_model_list == ["openai/tts-1", "azure/speech"]


def test_defaults():
    s = Settings(_env_file=None)
    assert s.registration_mode == "open"
    assert s.default_llm_model in s.llm_model_list
    assert s.rate_limit_per_minute == 10
```

- [ ] **Step 3: 运行,确认失败**

Run: `uv run pytest -q`
Expected: FAIL / ERROR — `ModuleNotFoundError: No module named 'app.security'`(或 `app.config`)。

- [ ] **Step 4: 实现**

`server/app/__init__.py`:空文件。`server/tests/__init__.py`:空文件。

`server/app/config.py`:

```python
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


def _split(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite+aiosqlite:///./data/app.db"

    registration_mode: Literal["open", "invite", "closed"] = "open"
    invite_code: str = ""
    trust_proxy_headers: bool = False
    rate_limit_per_minute: int = 10

    upstream_llm_base_url: str = ""
    upstream_llm_key: str = ""
    llm_models: str = "gpt-4o-mini,gpt-4o"
    default_llm_model: str = "gpt-4o"

    upstream_tts_base_url: str = ""
    upstream_tts_key: str = ""
    tts_models: str = "openai/tts-1,azure/speech"

    upstream_whisper_base_url: str = ""
    upstream_whisper_key: str = ""

    azure_speech_key: str = ""
    azure_speech_region: str = ""

    app_version: str = "0.7.9"

    @property
    def llm_model_list(self) -> list[str]:
        return _split(self.llm_models)

    @property
    def tts_model_list(self) -> list[str]:
        return _split(self.tts_models)
```

`server/app/db.py`:

```python
from pathlib import Path

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


def ensure_sqlite_dir(url: str) -> None:
    parsed = make_url(url)
    if parsed.get_backend_name() == "sqlite" and parsed.database and parsed.database != ":memory:":
        Path(parsed.database).parent.mkdir(parents=True, exist_ok=True)


def make_engine(url: str) -> AsyncEngine:
    if url.startswith("sqlite") and ":memory:" in url:
        return create_async_engine(
            url, poolclass=StaticPool, connect_args={"check_same_thread": False}
        )
    ensure_sqlite_dir(url)
    return create_async_engine(url, pool_pre_ping=True)
```

`server/app/models.py`:

```python
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    # 8 位数字,由应用生成(客户端用 /^\d{8}$/ 识别本地用户目录)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AccessToken(Base):
    __tablename__ = "access_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
```

`server/app/security.py`:

```python
import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
```

- [ ] **Step 5: 运行,确认通过**

Run: `uv run pytest -q`
Expected: `5 passed`。

- [ ] **Step 6: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add server/
git commit -m "feat(server): scaffold uv project with settings, models and security helpers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 1.2:应用工厂、依赖、限流、错误体、健康检查

**Files:**
- Create: `server/app/ratelimit.py`, `server/app/deps.py`, `server/app/errors.py`, `server/app/main.py`
- Create: `server/app/routers/__init__.py`, `health.py`, `sessions.py`(先放空 router)、`config_api.py`、`ai_chat.py`、`ai_audio.py`、`speech.py`、`stubs.py`(均先放空 router)
- Create: `server/tests/conftest.py`, `server/tests/test_ratelimit.py`, `server/tests/test_app.py`

**Interfaces:**
- Consumes: Task 1.1 的 `Settings`、`make_engine`、`Base`、模型、`hash_token`
- Produces:
  - `create_app(settings: Settings | None = None) -> FastAPI`,`app.state` 含 `settings, engine, sessionmaker, http (httpx.AsyncClient), limiter`
  - `RateLimiter(limit, window=60.0, clock=time.monotonic).allow(key) -> bool`
  - `deps.get_settings(request) -> Settings`、`deps.get_session(request) -> AsyncIterator[AsyncSession]`、`deps.current_user(...) -> User`、`deps.auth_rate_limit(request) -> None`
  - 测试夹具 `make_settings(**overrides)`、`app`、`client`、`auth_headers`、`settings_overrides`(可 `indirect` 参数化)
  - 空 router 占位:各路由模块都暴露 `router: APIRouter`(`stubs.py` 前缀 `/api`,`ai_*.py` 前缀 `/api/ai`,`speech.py` 前缀 `/api/speech`,`config_api.py`、`sessions.py` 前缀 `/api`,`health.py` 无前缀)

- [ ] **Step 1: 写失败测试**

`server/tests/test_ratelimit.py`:

```python
from app.ratelimit import RateLimiter


def test_allows_up_to_limit_then_blocks():
    now = [0.0]
    rl = RateLimiter(limit=2, window=60.0, clock=lambda: now[0])
    assert rl.allow("ip") and rl.allow("ip")
    assert rl.allow("ip") is False


def test_window_slides():
    now = [0.0]
    rl = RateLimiter(limit=1, window=60.0, clock=lambda: now[0])
    assert rl.allow("ip")
    assert rl.allow("ip") is False
    now[0] = 60.0
    assert rl.allow("ip") is True


def test_keys_are_independent():
    rl = RateLimiter(limit=1)
    assert rl.allow("a") and rl.allow("b")
    assert rl.allow("a") is False
```

`server/tests/conftest.py`:

```python
import os

import httpx
import pytest

from app.config import Settings
from app.db import Base
from app.main import create_app

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:")


def make_settings(**overrides) -> Settings:
    values = dict(
        database_url=TEST_DATABASE_URL,
        rate_limit_per_minute=1000,
        llm_models="gpt-4o-mini,gpt-4o",
        default_llm_model="gpt-4o",
        tts_models="openai/tts-1,azure/speech",
        upstream_llm_base_url="https://llm.test/v1",
        upstream_llm_key="llm-secret",
        upstream_tts_base_url="https://tts.test/v1",
        upstream_tts_key="tts-secret",
        upstream_whisper_base_url="https://whisper.test/v1",
        upstream_whisper_key="wh-secret",
        azure_speech_key="az-secret",
        azure_speech_region="eastus",
    )
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.fixture
def settings_overrides(request):
    return getattr(request, "param", {})


@pytest.fixture
async def app(settings_overrides):
    application = create_app(make_settings(**settings_overrides))
    async with application.state.engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield application
    await application.state.http.aclose()
    await application.state.engine.dispose()


@pytest.fixture
async def client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def auth_headers(client):
    r = await client.post("/api/users", json={"username": "alice", "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}
```

`server/tests/test_app.py`:

```python
import pytest

from app.main import create_app
from tests.conftest import make_settings


async def test_health(client):
    r = await client.get("/up")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_unknown_route_uses_error_envelope(client):
    r = await client.get("/api/nope")
    assert r.status_code == 404
    assert "error" in r.json()


def test_invite_mode_requires_code():
    with pytest.raises(RuntimeError, match="INVITE_CODE"):
        create_app(make_settings(registration_mode="invite", invite_code=""))


def test_default_model_must_be_listed():
    with pytest.raises(RuntimeError, match="DEFAULT_LLM_MODEL"):
        create_app(make_settings(llm_models="gpt-4o-mini", default_llm_model="gpt-4o"))
```

- [ ] **Step 2: 运行,确认失败**

Run: `uv run pytest -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.ratelimit'`(以及 `app.main`)。

- [ ] **Step 3: 实现**

`server/app/ratelimit.py`:

```python
import time
from collections import defaultdict, deque
from collections.abc import Callable


class RateLimiter:
    """进程内滑动窗口限流器。仅适用于单 worker 部署。"""

    def __init__(self, limit: int, window: float = 60.0, clock: Callable[[], float] = time.monotonic):
        self.limit = limit
        self.window = window
        self._clock = clock
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = self._clock()
        hits = self._hits[key]
        while hits and now - hits[0] >= self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            return False
        hits.append(now)
        return True
```

`server/app/errors.py`:

```python
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            {"error": str(exc.detail)},
            status_code=exc.status_code,
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        if errors:
            first = errors[0]
            where = ".".join(str(p) for p in first.get("loc", ()) if p != "body")
            message = f"{where}: {first.get('msg', 'invalid request')}" if where else first.get("msg", "invalid request")
        else:
            message = "invalid request"
        return JSONResponse({"error": message}, status_code=422)
```

`server/app/deps.py`:

```python
from collections.abc import AsyncIterator

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models import AccessToken, User
from app.security import hash_token


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


async def current_user(
    request: Request, session: AsyncSession = Depends(get_session)
) -> User:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(401, "Unauthorized")
    result = await session.execute(
        select(User)
        .join(AccessToken, AccessToken.user_id == User.id)
        .where(AccessToken.token_hash == hash_token(token.strip()))
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(401, "Unauthorized")
    return user


def client_ip(request: Request) -> str:
    if request.app.state.settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"


async def auth_rate_limit(request: Request) -> None:
    if not request.app.state.limiter.allow(client_ip(request)):
        raise HTTPException(429, "Too many requests, please try again later")
```

`server/app/routers/__init__.py`:空文件。

`server/app/routers/health.py`:

```python
from fastapi import APIRouter

router = APIRouter()


@router.get("/up")
async def up() -> dict:
    return {"status": "ok"}
```

下列文件先各放一个空 router(后续阶段只往里填内容,避免多人同时改 `main.py`):

`server/app/routers/sessions.py`、`config_api.py`:

```python
from fastapi import APIRouter

router = APIRouter(prefix="/api")
```

`server/app/routers/speech.py`:

```python
from fastapi import APIRouter

router = APIRouter(prefix="/api/speech")
```

`server/app/routers/ai_chat.py`、`ai_audio.py`:

```python
from fastapi import APIRouter

router = APIRouter(prefix="/api/ai")
```

`server/app/routers/stubs.py`:

```python
from fastapi import APIRouter

router = APIRouter(prefix="/api")
```

`server/app/main.py`:

```python
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import Settings
from app.db import make_engine
from app.errors import install_error_handlers
from app.ratelimit import RateLimiter
from app.routers import ai_audio, ai_chat, config_api, health, sessions, speech, stubs


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    if settings.registration_mode == "invite" and not settings.invite_code:
        raise RuntimeError("REGISTRATION_MODE=invite requires INVITE_CODE")
    if settings.default_llm_model not in settings.llm_model_list:
        raise RuntimeError("DEFAULT_LLM_MODEL must be one of LLM_MODELS")

    engine = make_engine(settings.database_url)
    http = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        await http.aclose()
        await engine.dispose()

    app = FastAPI(title="enjoy-server", lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    app.state.http = http
    app.state.limiter = RateLimiter(settings.rate_limit_per_minute)

    install_error_handlers(app)
    # stubs 含 /api/** 的兜底写入路由,必须最后注册。
    for module in (health, sessions, config_api, speech, ai_chat, ai_audio, stubs):
        app.include_router(module.router)
    return app
```

- [ ] **Step 4: 运行,确认通过**

Run: `uv run pytest -q`
Expected: 全部通过(此前 5 个 + 本任务 7 个 = `12 passed`)。注意 `auth_headers` 夹具此时还未被使用,注册接口在 Task 1.3 实现。

- [ ] **Step 5: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add server/
git commit -m "feat(server): add app factory, deps, rate limiter, error envelope and health check" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 1.3:注册、登录、`/api/me`

**Files:**
- Modify: `server/app/routers/sessions.py`
- Create: `server/tests/test_auth.py`

**Interfaces:**
- Consumes: `deps.current_user`、`deps.get_session`、`deps.get_settings`、`deps.auth_rate_limit`、`hash_password`、`verify_password`、`new_token`、`hash_token`、模型 `User`/`AccessToken`
- Produces(HTTP 契约,客户端依赖):
  - `POST /api/users` `{username, password, invite_code?}` → 200 `{id: "12345678", name, created_at, access_token}`;409 用户名已存在;403 注册关闭/邀请码错误;422 校验失败
  - `POST /api/sessions` `{provider:"password", username, password}` → 200 同上;401 `Invalid username or password`;400 不支持的 provider
  - `GET /api/me` → 200 `{id, name, created_at}`(无 `access_token`);401

- [ ] **Step 1: 写失败测试**

`server/tests/test_auth.py`:

```python
import re

from sqlalchemy import select

from app.models import AccessToken


async def _register(client, username="alice", password="password123", **extra):
    return await client.post("/api/users", json={"username": username, "password": password, **extra})


async def test_register_returns_user_and_token(client):
    r = await _register(client, "Alice")
    assert r.status_code == 200
    body = r.json()
    assert re.fullmatch(r"\d{8}", body["id"])
    assert body["name"] == "alice"
    assert len(body["access_token"]) >= 32


async def test_register_duplicate_username_is_409(client):
    assert (await _register(client, "alice")).status_code == 200
    r = await _register(client, "ALICE")
    assert r.status_code == 409
    assert r.json()["error"] == "Username already taken"


async def test_register_rejects_short_password(client):
    r = await _register(client, "alice", "short")
    assert r.status_code == 422
    assert "error" in r.json()


async def test_register_rejects_bad_username(client):
    r = await _register(client, "a b")
    assert r.status_code == 422


async def test_login_success(client):
    reg = (await _register(client)).json()
    r = await client.post(
        "/api/sessions", json={"provider": "password", "username": "alice", "password": "password123"}
    )
    assert r.status_code == 200
    assert r.json()["id"] == reg["id"]
    assert r.json()["access_token"]


async def test_login_wrong_password_and_unknown_user_look_the_same(client):
    await _register(client)
    wrong = await client.post(
        "/api/sessions", json={"provider": "password", "username": "alice", "password": "nope-nope"}
    )
    unknown = await client.post(
        "/api/sessions", json={"provider": "password", "username": "ghost", "password": "nope-nope"}
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"error": "Invalid username or password"}


async def test_login_unsupported_provider(client):
    r = await client.post("/api/sessions", json={"provider": "github", "username": "a", "password": "b"})
    assert r.status_code == 400


async def test_me_requires_token(client):
    assert (await client.get("/api/me")).status_code == 401
    r = await client.get("/api/me", headers={"Authorization": "Bearer garbage"})
    assert r.status_code == 401


async def test_me_returns_profile_without_access_token(client, auth_headers):
    r = await client.get("/api/me", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "alice"
    assert re.fullmatch(r"\d{8}", body["id"])
    assert "access_token" not in body


async def test_token_is_stored_hashed(app, client):
    token = (await _register(client)).json()["access_token"]
    async with app.state.sessionmaker() as session:
        hashes = (await session.execute(select(AccessToken.token_hash))).scalars().all()
    assert hashes and token not in hashes and len(hashes[0]) == 64
```

- [ ] **Step 2: 运行,确认失败**

Run: `uv run pytest tests/test_auth.py -q`
Expected: FAIL — 注册返回 404(路由不存在)。

- [ ] **Step 3: 实现**

`server/app/routers/sessions.py`:

```python
import asyncio
import re
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.deps import auth_rate_limit, current_user, get_session, get_settings
from app.models import AccessToken, User
from app.security import hash_password, hash_token, new_token, verify_password

router = APIRouter(prefix="/api")

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,32}$")
INVALID_LOGIN = "Invalid username or password"
# 用户不存在时也做一次等耗时的校验,避免通过响应时间枚举用户名。
_DUMMY_HASH = hash_password("dummy-password")


class LoginIn(BaseModel):
    provider: str = "password"
    username: str
    password: str


class RegisterIn(BaseModel):
    username: str
    password: str = Field(min_length=8, max_length=128)
    invite_code: str | None = None

    @field_validator("username")
    @classmethod
    def _normalize_username(cls, value: str) -> str:
        value = value.strip().lower()
        if not USERNAME_RE.match(value):
            raise ValueError("must be 3-32 characters of letters, digits or underscore")
        return value


class UserOut(BaseModel):
    id: str
    name: str
    created_at: datetime
    access_token: str | None = None


def _user_out(user: User, token: str | None = None) -> UserOut:
    return UserOut(id=str(user.id), name=user.username, created_at=user.created_at, access_token=token)


async def _get_by_username(session: AsyncSession, username: str) -> User | None:
    result = await session.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()


async def _issue_token(session: AsyncSession, user: User) -> str:
    token = new_token()
    session.add(AccessToken(user_id=user.id, token_hash=hash_token(token)))
    await session.commit()
    return token


def _new_user_id() -> int:
    return secrets.randbelow(90_000_000) + 10_000_000


@router.post(
    "/users",
    response_model=UserOut,
    response_model_exclude_none=True,
    dependencies=[Depends(auth_rate_limit)],
)
async def register(
    payload: RegisterIn,
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    if settings.registration_mode == "closed":
        raise HTTPException(403, "Registration is closed")
    if settings.registration_mode == "invite" and not secrets.compare_digest(
        (payload.invite_code or "").encode(), settings.invite_code.encode()
    ):
        raise HTTPException(403, "Invalid invite code")

    password_hash = await asyncio.to_thread(hash_password, payload.password)
    for _ in range(5):
        user = User(id=_new_user_id(), username=payload.username, password_hash=password_hash)
        session.add(user)
        try:
            await session.commit()
            break
        except IntegrityError:
            await session.rollback()
            if await _get_by_username(session, payload.username):
                raise HTTPException(409, "Username already taken")
    else:
        raise HTTPException(500, "Could not allocate a user id")

    return _user_out(user, await _issue_token(session, user))


@router.post(
    "/sessions",
    response_model=UserOut,
    response_model_exclude_none=True,
    dependencies=[Depends(auth_rate_limit)],
)
async def login(payload: LoginIn, session: AsyncSession = Depends(get_session)):
    if payload.provider != "password":
        raise HTTPException(400, "Unsupported login provider")
    user = await _get_by_username(session, payload.username.strip().lower())
    if user is None:
        await asyncio.to_thread(verify_password, _DUMMY_HASH, payload.password)
        raise HTTPException(401, INVALID_LOGIN)
    if not await asyncio.to_thread(verify_password, user.password_hash, payload.password):
        raise HTTPException(401, INVALID_LOGIN)
    return _user_out(user, await _issue_token(session, user))


@router.get("/me", response_model=UserOut, response_model_exclude_none=True)
async def me(user: User = Depends(current_user)):
    return _user_out(user)
```

- [ ] **Step 4: 运行,确认通过**

Run: `uv run pytest -q`
Expected: 全部通过(`22 passed`)。

- [ ] **Step 5: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add server/
git commit -m "feat(server): add password registration, login and /api/me" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 1.4:注册模式与限流的集成测试

**Files:**
- Create: `server/tests/test_registration_modes.py`

**Interfaces:**
- Consumes: Task 1.3 的注册/登录接口与 Task 1.2 的 `settings_overrides` 夹具

- [ ] **Step 1: 写测试**

`server/tests/test_registration_modes.py`:

```python
import pytest

BODY = {"username": "alice", "password": "password123"}


@pytest.mark.parametrize("settings_overrides", [{"registration_mode": "closed"}], indirect=True)
async def test_closed_mode_rejects_registration(client):
    r = await client.post("/api/users", json=BODY)
    assert r.status_code == 403
    assert r.json()["error"] == "Registration is closed"


@pytest.mark.parametrize(
    "settings_overrides",
    [{"registration_mode": "invite", "invite_code": "letmein"}],
    indirect=True,
)
async def test_invite_mode_needs_the_right_code(client):
    assert (await client.post("/api/users", json=BODY)).status_code == 403
    assert (await client.post("/api/users", json={**BODY, "invite_code": "wrong"})).status_code == 403
    ok = await client.post("/api/users", json={**BODY, "invite_code": "letmein"})
    assert ok.status_code == 200


@pytest.mark.parametrize("settings_overrides", [{"registration_mode": "closed"}], indirect=True)
async def test_closed_mode_still_allows_login_of_existing_users(app, client):
    from app.models import User
    from app.security import hash_password

    async with app.state.sessionmaker() as session:
        session.add(User(id=12345678, username="bob", password_hash=hash_password("password123")))
        await session.commit()
    r = await client.post(
        "/api/sessions", json={"provider": "password", "username": "bob", "password": "password123"}
    )
    assert r.status_code == 200


@pytest.mark.parametrize("settings_overrides", [{"rate_limit_per_minute": 3}], indirect=True)
async def test_auth_endpoints_are_rate_limited(client):
    login = {"provider": "password", "username": "ghost", "password": "whatever1"}
    codes = [(await client.post("/api/sessions", json=login)).status_code for _ in range(5)]
    assert codes == [401, 401, 401, 429, 429]


@pytest.mark.parametrize("settings_overrides", [{"rate_limit_per_minute": 3}], indirect=True)
async def test_rate_limit_does_not_affect_other_endpoints(client):
    for _ in range(6):
        assert (await client.get("/up")).status_code == 200
```

- [ ] **Step 2: 运行**

Run: `uv run pytest tests/test_registration_modes.py -q`
Expected: `5 passed`(行为已在 Task 1.3 实现,此任务锁定契约;若失败,修复 `sessions.py` 而不是改测试)。

- [ ] **Step 3: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add server/tests/test_registration_modes.py
git commit -m "test(server): cover registration modes and auth rate limiting" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 1.5:Alembic 迁移

**Files:**
- Create: `server/alembic.ini`, `server/alembic/env.py`, `server/alembic/script.py.mako`, `server/alembic/versions/0001_users_and_access_tokens.py`
- Create: `server/tests/test_migrations.py`

**Interfaces:**
- Consumes: `Settings().database_url`、`Base.metadata`、`ensure_sqlite_dir`、`app.models`
- Produces: `alembic upgrade head` 可在 SQLite/Postgres 上创建 `users`、`access_tokens`

- [ ] **Step 1: 生成 alembic 模板**

Run: `cd /e/workspace/everyone-can-use-english/server && uv run alembic init -t async alembic`
Expected: 生成 `alembic.ini` 与 `alembic/`。

- [ ] **Step 2: 用下面内容完整替换 `server/alembic/env.py`**

```python
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app import models  # noqa: F401  (把表注册到 Base.metadata)
from app.config import Settings
from app.db import Base, ensure_sqlite_dir

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata
DATABASE_URL = Settings().database_url


def run_migrations_offline() -> None:
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=DATABASE_URL.startswith("sqlite"),
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    ensure_sqlite_dir(DATABASE_URL)
    engine = create_async_engine(DATABASE_URL, poolclass=pool.NullPool)
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
```

- [ ] **Step 3: 生成初始迁移**

Run:
```bash
cd /e/workspace/everyone-can-use-english/server
rm -f data/gen.db
DATABASE_URL=sqlite+aiosqlite:///./data/gen.db uv run alembic revision --autogenerate -m "users and access tokens" --rev-id 0001
rm -f data/gen.db
```
Expected: 生成 `alembic/versions/0001_users_and_access_tokens.py`,其中包含 `op.create_table('users'` 与 `op.create_table('access_tokens'`。用 `grep -c "create_table" alembic/versions/0001_users_and_access_tokens.py` 核对,输出 `2`。

- [ ] **Step 4: 写测试**

`server/tests/test_migrations.py`(同步测试,因为 `env.py` 内部使用 `asyncio.run`):

```python
import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config

ROOT = Path(__file__).resolve().parent.parent


def test_upgrade_head_creates_tables(tmp_path, monkeypatch):
    db = tmp_path / "m.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{db.as_posix()}")
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))

    command.upgrade(cfg, "head")

    con = sqlite3.connect(db)
    try:
        names = {row[0] for row in con.execute("select name from sqlite_master where type='table'")}
    finally:
        con.close()
    assert {"users", "access_tokens", "alembic_version"} <= names
```

- [ ] **Step 5: 运行全部测试**

Run: `uv run pytest -q`
Expected: 全部通过(`28 passed`)。

- [ ] **Step 6: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add server/
git commit -m "feat(server): add alembic async migrations for users and access tokens" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### 验收门槛 1(全部满足才能进入阶段 2)

在 `server/` 下依次执行并核对:

- [ ] `uv run pytest -q` → **0 failed**(预期 28 passed,以实际为准,不得有 failed/error)。
- [ ] 迁移可用:
  ```bash
  rm -f data/gate.db
  DATABASE_URL=sqlite+aiosqlite:///./data/gate.db uv run alembic upgrade head
  uv run python -c "import sqlite3;print(sorted(r[0] for r in sqlite3.connect('data/gate.db').execute(\"select name from sqlite_master where type='table'\")))"
  ```
  输出包含 `'access_tokens'`、`'alembic_version'`、`'users'`。
- [ ] 手动走通(另开一个终端运行服务):
  ```bash
  DATABASE_URL=sqlite+aiosqlite:///./data/gate.db uv run uvicorn app.main:create_app --factory --port 8000
  ```
  ```bash
  curl -s -X POST localhost:8000/api/users -H 'content-type: application/json' -d '{"username":"gate","password":"password123"}'
  curl -s -X POST localhost:8000/api/sessions -H 'content-type: application/json' -d '{"provider":"password","username":"gate","password":"password123"}'
  curl -s localhost:8000/api/me -H "authorization: Bearer <上一步的 access_token>"
  curl -s -o /dev/null -w '%{http_code}\n' localhost:8000/api/me
  ```
  预期:第 1、2 条返回含 8 位数字 `id` 与 `access_token` 的 JSON;第 3 条返回 `{"id":...,"name":"gate",...}` 且**不含** `access_token`;第 4 条输出 `401`。
- [ ] `git status --short` 干净(无未提交文件),`git log --oneline` 中有阶段 1 的 5 个提交。

---

## 阶段 2:配置快照 + 占位接口

**阶段目标:** 客户端启动、读取配置、AI 词典/翻译、各类同步调用都不会因后端缺接口而报错。

### Task 2.1:下载配置快照

**Files:**
- Create: `server/scripts/fetch_config.py`, `server/app/static_config/{ipa_mappings,gpt_providers,tts_providers_v2,chat_agent_templates,gpt_presets,default_gpt_preset,default_tts_preset,ytb_channels}.json`
- Create: `server/tests/test_static_config_files.py`

**Interfaces:**
- Produces: `app/static_config/<key>.json`(格式与官方 `GET https://enjoy.bot/api/config/<key>` 相同)

- [ ] **Step 1: 写失败测试**

`server/tests/test_static_config_files.py`:

```python
import json
from pathlib import Path

import pytest

STATIC = Path(__file__).resolve().parent.parent / "app" / "static_config"
KEYS = [
    "ipa_mappings",
    "gpt_providers",
    "tts_providers_v2",
    "chat_agent_templates",
    "gpt_presets",
    "default_gpt_preset",
    "default_tts_preset",
    "ytb_channels",
]


@pytest.mark.parametrize("key", KEYS)
def test_snapshot_exists_and_is_json(key):
    data = json.loads((STATIC / f"{key}.json").read_text(encoding="utf-8"))
    assert data, f"{key} snapshot is empty"
```

Run: `uv run pytest tests/test_static_config_files.py -q`
Expected: FAIL — `FileNotFoundError`(8 个)。

- [ ] **Step 2: 写下载脚本**

`server/scripts/fetch_config.py`:

```python
"""下载官方公开配置作为静态快照。仅在需要刷新快照时运行。

Usage: uv run python scripts/fetch_config.py
"""
import json
from pathlib import Path

import httpx

KEYS = [
    "ipa_mappings",
    "gpt_providers",
    "tts_providers_v2",
    "chat_agent_templates",
    "gpt_presets",
    "default_gpt_preset",
    "default_tts_preset",
    "ytb_channels",
]
OUT = Path(__file__).resolve().parent.parent / "app" / "static_config"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=30, follow_redirects=True) as http:
        for key in KEYS:
            r = http.get(f"https://enjoy.bot/api/config/{key}")
            r.raise_for_status()
            data = r.json()
            (OUT / f"{key}.json").write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            print(f"saved {key} ({len(r.content)} bytes)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: 运行脚本与测试**

Run: `uv run python scripts/fetch_config.py && uv run pytest tests/test_static_config_files.py -q`
Expected: 打印 8 行 `saved ...`;测试 `8 passed`。

- [ ] **Step 4: 精简 `gpt_providers.json` 只保留 `enjoyai`**

打开 `server/app/static_config/gpt_providers.json`,删除除 `"enjoyai"` 以外的所有顶层键,保存。
验证:`uv run python -c "import json;print(list(json.load(open('app/static_config/gpt_providers.json',encoding='utf-8'))))"`
Expected: `['enjoyai']`。

- [ ] **Step 5: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add server/
git commit -m "feat(server): snapshot public config from the official service" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2.2:`/api/config/{key}` 路由

**Files:**
- Modify: `server/app/routers/config_api.py`
- Create: `server/tests/test_config_api.py`

**Interfaces:**
- Consumes: `deps.get_settings`、`Settings.llm_model_list/tts_model_list/default_llm_model/app_version`、Task 2.1 的快照
- Produces: `GET /api/config/{key}`(无需鉴权):
  - `app_version` → `{"version": settings.app_version}`
  - 8 个快照 key → 快照内容,并应用覆盖(见下)
  - 其他 key(含 `bugsnag_api_key`、`discuss`)→ 404 `{"error": "Unknown config key"}`
  - 覆盖:`gpt_providers.enjoyai.models = LLM_MODELS`;`tts_providers_v2.enjoyai.models = TTS_MODELS`;`engine == "enjoyai"` 的预设,其 `configuration.model`(若存在)= `DEFAULT_LLM_MODEL`

- [ ] **Step 1: 写失败测试**

`server/tests/test_config_api.py`:

```python
async def test_ipa_mappings(client):
    r = await client.get("/api/config/ipa_mappings")
    assert r.status_code == 200
    assert r.json()["p"] == "p"


async def test_app_version(client):
    r = await client.get("/api/config/app_version")
    assert r.json() == {"version": "0.7.9"}


async def test_gpt_providers_models_come_from_settings(client):
    data = (await client.get("/api/config/gpt_providers")).json()
    assert list(data) == ["enjoyai"]
    assert data["enjoyai"]["models"] == ["gpt-4o-mini", "gpt-4o"]


async def test_tts_models_come_from_settings(client):
    data = (await client.get("/api/config/tts_providers_v2")).json()
    assert data["enjoyai"]["models"] == ["openai/tts-1", "azure/speech"]


async def test_presets_use_default_model(client):
    presets = (await client.get("/api/config/gpt_presets")).json()
    assert presets
    for preset in presets:
        cfg = preset.get("configuration", {})
        if preset.get("engine") == "enjoyai" and "model" in cfg:
            assert cfg["model"] == "gpt-4o"
    default = (await client.get("/api/config/default_gpt_preset")).json()
    assert default["configuration"]["model"] == "gpt-4o"


async def test_other_snapshots_are_served(client):
    for key in ("chat_agent_templates", "default_tts_preset", "ytb_channels"):
        assert (await client.get(f"/api/config/{key}")).status_code == 200


async def test_unknown_and_bugsnag_keys_are_404(client):
    for key in ("nope", "bugsnag_api_key", "discuss"):
        r = await client.get(f"/api/config/{key}")
        assert r.status_code == 404
        assert r.json()["error"] == "Unknown config key"
```

Run: `uv run pytest tests/test_config_api.py -q`
Expected: FAIL — 404 / KeyError。

- [ ] **Step 2: 实现**

`server/app/routers/config_api.py`:

```python
import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.config import Settings
from app.deps import get_settings

router = APIRouter(prefix="/api")

STATIC = Path(__file__).resolve().parent.parent / "static_config"
SNAPSHOT_KEYS = {
    "ipa_mappings",
    "gpt_providers",
    "tts_providers_v2",
    "chat_agent_templates",
    "gpt_presets",
    "default_gpt_preset",
    "default_tts_preset",
    "ytb_channels",
}


def _set_model(preset: dict, model: str) -> None:
    cfg = preset.get("configuration")
    if preset.get("engine") == "enjoyai" and isinstance(cfg, dict) and "model" in cfg:
        cfg["model"] = model


def apply_overrides(key: str, data, settings: Settings):
    if key == "gpt_providers" and "enjoyai" in data:
        data["enjoyai"]["models"] = settings.llm_model_list
    elif key == "tts_providers_v2" and "enjoyai" in data:
        data["enjoyai"]["models"] = settings.tts_model_list
    elif key == "gpt_presets":
        for preset in data:
            _set_model(preset, settings.default_llm_model)
    elif key == "default_gpt_preset":
        _set_model(data, settings.default_llm_model)
    return data


@router.get("/config/{key}")
async def get_config(key: str, settings: Settings = Depends(get_settings)):
    if key == "app_version":
        return {"version": settings.app_version}
    if key not in SNAPSHOT_KEYS:
        raise HTTPException(404, "Unknown config key")
    data = json.loads((STATIC / f"{key}.json").read_text(encoding="utf-8"))
    return apply_overrides(key, data, settings)
```

- [ ] **Step 3: 运行,确认通过**

Run: `uv run pytest tests/test_config_api.py -q`
Expected: `7 passed`。

- [ ] **Step 4: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add server/
git commit -m "feat(server): serve config snapshots with model list overrides" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2.3:占位接口(词典、翻译、同步类写入)

**Files:**
- Modify: `server/app/routers/stubs.py`
- Create: `server/tests/test_stubs.py`

**Interfaces:**
- Consumes: `deps.current_user`
- Produces:
  - `POST /api/lookups` → `{id, word, context, context_translation:null, status:"pending", meaning:null, meaning_options:[], created_at, updated_at}`(客户端据此在本地调用 LLM)
  - `PUT /api/lookups/{id}` → `{}`
  - `GET /api/translations` → `{translations:[], page:1, next:null, last:1}`
  - 任意其他 `POST|PUT|DELETE /api/**` → 鉴权后返回 `{}`;未登录 401
  - 其他 `GET /api/**` 仍为 404

- [ ] **Step 1: 写失败测试**

`server/tests/test_stubs.py`:

```python
async def test_lookup_returns_pending_record(client, auth_headers):
    r = await client.post(
        "/api/lookups",
        json={"word": "hello", "context": "hello world", "native_language": "zh-CN"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["id"] and body["word"] == "hello" and body["context"] == "hello world"
    assert body["status"] == "pending"
    assert body["meaning"] is None and body["meaning_options"] == []


async def test_lookup_requires_auth(client):
    r = await client.post("/api/lookups", json={"word": "a", "context": "b"})
    assert r.status_code == 401


async def test_update_lookup_is_acknowledged(client, auth_headers):
    r = await client.put("/api/lookups/abc", json={"meaning": {"word": "a"}}, headers=auth_headers)
    assert r.status_code == 200 and r.json() == {}


async def test_translations_list_is_empty(client, auth_headers):
    r = await client.get(
        "/api/translations", params={"md5": "x", "translated_language": "zh-CN"}, headers=auth_headers
    )
    assert r.status_code == 200
    assert r.json() == {"translations": [], "page": 1, "next": None, "last": 1}


async def test_create_translation_is_acknowledged(client, auth_headers):
    r = await client.post("/api/translations", json={"md5": "x"}, headers=auth_headers)
    assert r.status_code == 200 and r.json() == {}


async def test_sync_writes_are_accepted_and_discarded(client, auth_headers):
    for method, path in [
        ("POST", "/api/mine/recordings"),
        ("POST", "/api/mine/pronunciation_assessments"),
        ("DELETE", "/api/mine/audios/1"),
        ("POST", "/api/notes"),
    ]:
        r = await client.request(method, path, json={"x": 1}, headers=auth_headers)
        assert r.status_code == 200 and r.json() == {}, (method, path)


async def test_sync_writes_require_auth(client):
    assert (await client.post("/api/mine/recordings", json={})).status_code == 401


async def test_unknown_get_is_404_not_405(client, auth_headers):
    for headers in (auth_headers, {}):
        r = await client.get("/api/posts", headers=headers)
        assert r.status_code == 404
        assert r.json() == {"error": "Not Found"}


async def test_catch_all_does_not_shadow_login(client):
    await client.post("/api/users", json={"username": "alice", "password": "password123"})
    r = await client.post(
        "/api/sessions", json={"provider": "password", "username": "alice", "password": "password123"}
    )
    assert r.status_code == 200 and r.json()["access_token"]
```

Run: `uv run pytest tests/test_stubs.py -q`
Expected: FAIL — 404 / 405。

- [ ] **Step 2: 实现**

`server/app/routers/stubs.py`:

```python
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException

from app.deps import current_user
from app.models import User

router = APIRouter(prefix="/api")


@router.post("/lookups")
async def create_lookup(payload: dict = Body(default_factory=dict), _: User = Depends(current_user)):
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": uuid.uuid4().hex,
        "word": payload.get("word", ""),
        "context": payload.get("context", ""),
        "context_translation": None,
        "status": "pending",
        "meaning": None,
        "meaning_options": [],
        "created_at": now,
        "updated_at": now,
    }


@router.put("/lookups/{lookup_id}")
async def update_lookup(lookup_id: str, _: User = Depends(current_user)):
    return {}


@router.get("/translations")
async def list_translations(_: User = Depends(current_user)):
    return {"translations": [], "page": 1, "next": None, "last": 1}


@router.post("/translations")
async def create_translation(_: User = Depends(current_user)):
    return {}


# 兜底(必须保证本模块最后注册,真实路由才不会被遮住):
# 1) 客户端的同步类写入(录音、笔记、发音评测等)鉴权后收下即丢;
# 2) 未知的 GET 明确返回 404。若没有这条,Starlette 会因「路径匹配但方法不匹配」返回 405。
@router.api_route("/{path:path}", methods=["POST", "PUT", "DELETE"])
async def accept_and_discard(path: str, _: User = Depends(current_user)):
    return {}


@router.get("/{path:path}")
async def unknown_get(path: str):
    raise HTTPException(404, "Not Found")
```

- [ ] **Step 3: 运行全部测试**

Run: `uv run pytest -q`
Expected: 全部通过,0 failed。

- [ ] **Step 4: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add server/
git commit -m "feat(server): add lookup/translation stubs and accept-and-discard sync routes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### 验收门槛 2

- [ ] `uv run pytest -q` → **0 failed**。
- [ ] `ls server/app/static_config/*.json | wc -l` 输出 `8`。
- [ ] 启动服务后,以下请求全部 200(`curl -s -o /dev/null -w '%{http_code}\n' localhost:8000/api/config/<key>`):`ipa_mappings`、`app_version`、`gpt_providers`、`tts_providers_v2`、`chat_agent_templates`、`gpt_presets`、`default_gpt_preset`、`default_tts_preset`、`ytb_channels`;`bugsnag_api_key` 为 404。
- [ ] 用阶段 1 注册的 token 调 `POST /api/lookups`,返回 `"meaning": null`。
- [ ] 与客户端调用清单交叉核对:`cd enjoy && grep -rho 'config("[a-z_0-9]*")' src | sort -u`,列出的每个 key 要么在上面 200 列表里,要么是 `bugsnag_api_key` / `discuss`(后者对应的社区页会在阶段 5 隐藏)。

---

## 阶段 3:LLM 代理

**阶段目标:** `POST /api/ai/chat/completions` 以服务端密钥转发到上游,支持流式、JSON 模式和 tool call。

### Task 3.1:聊天补全代理

**Files:**
- Modify: `server/app/routers/ai_chat.py`
- Create: `server/tests/test_ai_chat.py`

**Interfaces:**
- Consumes: `deps.current_user`、`deps.get_settings`、`request.app.state.http`、`Settings.upstream_llm_*`、`llm_model_list`、`default_llm_model`
- Produces: `POST /api/ai/chat/completions`
  - 401 未登录;503 `LLM upstream is not configured`;502 `Upstream unavailable`
  - 请求体原样转发,仅:`model` 不在列表时改写为默认;`Authorization` 换成 `Bearer <UPSTREAM_LLM_KEY>`
  - 非流式:返回上游状态码与 body;流式(`stream:true`):SSE 逐块透传

- [ ] **Step 1: 写失败测试**

`server/tests/test_ai_chat.py`:

```python
import json

import httpx
import pytest

URL = "https://llm.test/v1/chat/completions"
BODY = {"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]}


async def test_requires_auth(client):
    assert (await client.post("/api/ai/chat/completions", json=BODY)).status_code == 401


async def test_forwards_with_server_key(client, auth_headers, respx_mock):
    route = respx_mock.post(URL).mock(return_value=httpx.Response(200, json={"id": "x", "choices": []}))
    r = await client.post("/api/ai/chat/completions", json=BODY, headers=auth_headers)
    assert r.status_code == 200 and r.json()["id"] == "x"
    sent = route.calls.last.request
    assert sent.headers["authorization"] == "Bearer llm-secret"
    assert json.loads(sent.content)["model"] == "gpt-4o"


async def test_unlisted_model_is_rewritten_to_default(client, auth_headers, respx_mock):
    route = respx_mock.post(URL).mock(return_value=httpx.Response(200, json={}))
    await client.post(
        "/api/ai/chat/completions", json={**BODY, "model": "expensive-model"}, headers=auth_headers
    )
    assert json.loads(route.calls.last.request.content)["model"] == "gpt-4o"


async def test_extra_fields_are_preserved(client, auth_headers, respx_mock):
    route = respx_mock.post(URL).mock(return_value=httpx.Response(200, json={}))
    extra = {"response_format": {"type": "json_object"}, "tools": [{"type": "function"}], "temperature": 0.2}
    await client.post("/api/ai/chat/completions", json={**BODY, **extra}, headers=auth_headers)
    sent = json.loads(route.calls.last.request.content)
    for key, value in extra.items():
        assert sent[key] == value


async def test_upstream_error_status_and_body_are_passed_through(client, auth_headers, respx_mock):
    respx_mock.post(URL).mock(return_value=httpx.Response(429, json={"error": {"message": "slow down"}}))
    r = await client.post("/api/ai/chat/completions", json=BODY, headers=auth_headers)
    assert r.status_code == 429
    assert r.json()["error"]["message"] == "slow down"


async def test_streaming_is_passed_through(client, auth_headers, respx_mock):
    sse = b'data: {"choices":[{"delta":{"content":"he"}}]}\n\ndata: {"choices":[{"delta":{"content":"llo"}}]}\n\ndata: [DONE]\n\n'
    respx_mock.post(URL).mock(
        return_value=httpx.Response(200, content=sse, headers={"content-type": "text/event-stream"})
    )
    r = await client.post(
        "/api/ai/chat/completions", json={**BODY, "stream": True}, headers=auth_headers
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    assert r.content == sse


async def test_upstream_unreachable_is_502(client, auth_headers, respx_mock):
    respx_mock.post(URL).mock(side_effect=httpx.ConnectError("boom"))
    r = await client.post("/api/ai/chat/completions", json=BODY, headers=auth_headers)
    assert r.status_code == 502
    assert r.json()["error"] == "Upstream unavailable"


@pytest.mark.parametrize("settings_overrides", [{"upstream_llm_base_url": ""}], indirect=True)
async def test_unconfigured_upstream_is_503(client, auth_headers):
    r = await client.post("/api/ai/chat/completions", json=BODY, headers=auth_headers)
    assert r.status_code == 503
    assert r.json()["error"] == "LLM upstream is not configured"
```

Run: `uv run pytest tests/test_ai_chat.py -q`
Expected: FAIL — 404 / 405。

- [ ] **Step 2: 实现**

`server/app/routers/ai_chat.py`:

```python
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from app.config import Settings
from app.deps import current_user, get_settings
from app.models import User

router = APIRouter(prefix="/api/ai")


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    _: User = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    if not settings.upstream_llm_base_url:
        raise HTTPException(503, "LLM upstream is not configured")

    body = await request.json()
    if body.get("model") not in settings.llm_model_list:
        body["model"] = settings.default_llm_model

    url = settings.upstream_llm_base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.upstream_llm_key}",
        "Content-Type": "application/json",
    }
    http: httpx.AsyncClient = request.app.state.http

    try:
        if body.get("stream"):
            upstream = await http.send(
                http.build_request("POST", url, json=body, headers=headers), stream=True
            )

            async def relay():
                try:
                    async for chunk in upstream.aiter_bytes():
                        yield chunk
                finally:
                    await upstream.aclose()

            return StreamingResponse(
                relay(),
                status_code=upstream.status_code,
                media_type=upstream.headers.get("content-type", "text/event-stream"),
            )

        upstream = await http.post(url, json=body, headers=headers)
    except httpx.HTTPError:
        raise HTTPException(502, "Upstream unavailable")

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )
```

- [ ] **Step 3: 运行,确认通过**

Run: `uv run pytest -q`
Expected: 全部通过,0 failed。

- [ ] **Step 4: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add server/
git commit -m "feat(server): proxy chat completions to the upstream LLM with SSE passthrough" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### 验收门槛 3

- [ ] `uv run pytest -q` → **0 failed**。
- [ ] 复制 `.env.example`(Task 6.2 才正式创建;此处先手工创建 `server/.env`),至少填入 `UPSTREAM_LLM_BASE_URL`、`UPSTREAM_LLM_KEY`、`LLM_MODELS`、`DEFAULT_LLM_MODEL`,启动服务后用**真实上游**核对(`$TOKEN` 为注册得到的 token,`$MODEL` 为 `DEFAULT_LLM_MODEL`):
  ```bash
  # 1. 非流式
  curl -s localhost:8000/api/ai/chat/completions -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
    -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Say OK\"}],\"max_tokens\":16}"
  # 2. 流式:应看到多行 data: 与 data: [DONE]
  curl -sN localhost:8000/api/ai/chat/completions -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
    -d "{\"model\":\"$MODEL\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"Count to 3\"}]}"
  # 3. JSON 模式(客户端 json.command.ts 依赖):返回内容应为合法 JSON
  curl -s localhost:8000/api/ai/chat/completions -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
    -d "{\"model\":\"$MODEL\",\"response_format\":{\"type\":\"json_object\"},\"messages\":[{\"role\":\"user\",\"content\":\"Reply with JSON {\\\"ok\\\":true}\"}]}"
  ```
  三条都得到正常结果。
- [ ] tool call(客户端 `withStructuredOutput` 依赖)返回 `tool_calls`:
  ```bash
  curl -s localhost:8000/api/ai/chat/completions -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"answer: 42\"}],\"tools\":[{\"type\":\"function\",\"function\":{\"name\":\"emit\",\"parameters\":{\"type\":\"object\",\"properties\":{\"answer\":{\"type\":\"string\"}},\"required\":[\"answer\"]}}}],\"tool_choice\":{\"type\":\"function\",\"function\":{\"name\":\"emit\"}}}"
  ```
  响应的 `choices[0].message.tool_calls` 非空。**若上游不支持 JSON 模式或 tool call,本阶段不通过**:换上游或在 `UPSTREAM_*` 前加一层兼容网关,不要改客户端。
- [ ] 用一个不在 `LLM_MODELS` 里的模型名发请求,请求仍成功(被改写为默认模型)。

---

## 阶段 4:Azure token + TTS + Whisper

**阶段目标:** 发音评测/默认 STT 的 token、两种 TTS、服务端 Whisper 转写全部可用。

### Task 4.1:Azure 服务(token 缓存 + SSML 合成)

**Files:**
- Create: `server/app/azure.py`, `server/tests/test_azure.py`

**Interfaces:**
- Produces:
  - `TOKEN_TTL = 480`;异常 `AzureNotConfigured`、`AzureError`
  - `build_ssml(text: str, voice: str) -> str`(voice 非法抛 `ValueError`)
  - `class AzureSpeech(http, key, region, clock=time.monotonic)`:`configured: bool`、`async get_token() -> str`、`async synthesize(text, voice) -> bytes`
  - `get_azure(request) -> AzureSpeech`(FastAPI 依赖,懒创建并缓存到 `app.state.azure`)

- [ ] **Step 1: 写失败测试**

`server/tests/test_azure.py`:

```python
import httpx
import pytest

from app.azure import TOKEN_TTL, AzureError, AzureNotConfigured, AzureSpeech, build_ssml

STS = "https://eastus.api.cognitive.microsoft.com/sts/v1.0/issueToken"
TTS = "https://eastus.tts.speech.microsoft.com/cognitiveservices/v1"


def test_ssml_has_language_and_voice():
    ssml = build_ssml("Hello", "en-US-AvaNeural")
    assert "xml:lang='en-US'" in ssml
    assert "name='en-US-AvaNeural'" in ssml
    assert ">Hello</voice>" in ssml


def test_ssml_escapes_text():
    assert "a &lt; b &amp; c" in build_ssml("a < b & c", "en-US-AvaNeural")


def test_ssml_supports_regional_voice_names():
    assert "xml:lang='zh-CN'" in build_ssml("你好", "zh-CN-liaoning-XiaobeiNeural")


@pytest.mark.parametrize("voice", ["", "x", "en-US-Ava'Neural", "en-US-Ava Neural", "en-US-<b>"])
def test_ssml_rejects_bad_voice(voice):
    with pytest.raises(ValueError):
        build_ssml("hi", voice)


async def test_token_is_cached_until_ttl(respx_mock):
    now = [0.0]
    route = respx_mock.post(STS).mock(
        side_effect=[httpx.Response(200, text="t1"), httpx.Response(200, text="t2")]
    )
    async with httpx.AsyncClient() as http:
        az = AzureSpeech(http, "k", "eastus", clock=lambda: now[0])
        assert await az.get_token() == "t1"
        assert await az.get_token() == "t1"
        assert route.call_count == 1
        now[0] = TOKEN_TTL + 1
        assert await az.get_token() == "t2"
        assert route.call_count == 2
    assert route.calls[0].request.headers["ocp-apim-subscription-key"] == "k"


async def test_not_configured_raises():
    async with httpx.AsyncClient() as http:
        az = AzureSpeech(http, "", "")
        assert az.configured is False
        with pytest.raises(AzureNotConfigured):
            await az.get_token()
        with pytest.raises(AzureNotConfigured):
            await az.synthesize("hi", "en-US-AvaNeural")


async def test_sts_failure_raises_azure_error(respx_mock):
    respx_mock.post(STS).mock(return_value=httpx.Response(401, text="denied"))
    async with httpx.AsyncClient() as http:
        with pytest.raises(AzureError):
            await AzureSpeech(http, "k", "eastus").get_token()


async def test_synthesize_posts_ssml(respx_mock):
    route = respx_mock.post(TTS).mock(return_value=httpx.Response(200, content=b"MP3"))
    async with httpx.AsyncClient() as http:
        audio = await AzureSpeech(http, "k", "eastus").synthesize("Hello", "en-US-AvaNeural")
    assert audio == b"MP3"
    req = route.calls.last.request
    assert req.headers["content-type"] == "application/ssml+xml"
    assert req.headers["x-microsoft-outputformat"] == "audio-24khz-48kbitrate-mono-mp3"
    assert b"name='en-US-AvaNeural'" in req.content
```

Run: `uv run pytest tests/test_azure.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.azure'`。

- [ ] **Step 2: 实现**

`server/app/azure.py`:

```python
import asyncio
import re
import time
from collections.abc import Callable
from xml.sax.saxutils import escape

import httpx
from fastapi import Request

TOKEN_TTL = 8 * 60  # 秒。Azure token 有效期约 10 分钟,提前 2 分钟刷新。
VOICE_RE = re.compile(r"^[A-Za-z]{2,3}-[A-Za-z0-9]{2,8}(-[A-Za-z0-9]+)+$")


class AzureNotConfigured(Exception):
    pass


class AzureError(Exception):
    pass


def build_ssml(text: str, voice: str) -> str:
    if not VOICE_RE.match(voice):
        raise ValueError("invalid voice")
    lang = "-".join(voice.split("-")[:2])
    return (
        f"<speak version='1.0' xml:lang='{lang}'>"
        f"<voice xml:lang='{lang}' name='{voice}'>{escape(text)}</voice>"
        f"</speak>"
    )


class AzureSpeech:
    def __init__(
        self,
        http: httpx.AsyncClient,
        key: str,
        region: str,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._http = http
        self._key = key
        self._region = region
        self._clock = clock
        self._token: str | None = None
        self._expires = 0.0
        self._lock = asyncio.Lock()

    @property
    def configured(self) -> bool:
        return bool(self._key and self._region)

    @property
    def region(self) -> str:
        return self._region

    async def get_token(self) -> str:
        if not self.configured:
            raise AzureNotConfigured()
        async with self._lock:
            if self._token and self._clock() < self._expires:
                return self._token
            resp = await self._http.post(
                f"https://{self._region}.api.cognitive.microsoft.com/sts/v1.0/issueToken",
                headers={"Ocp-Apim-Subscription-Key": self._key},
            )
            if resp.status_code != 200:
                raise AzureError(f"issueToken failed: {resp.status_code}")
            self._token = resp.text
            self._expires = self._clock() + TOKEN_TTL
            return self._token

    async def synthesize(self, text: str, voice: str) -> bytes:
        if not self.configured:
            raise AzureNotConfigured()
        ssml = build_ssml(text, voice)
        resp = await self._http.post(
            f"https://{self._region}.tts.speech.microsoft.com/cognitiveservices/v1",
            content=ssml.encode("utf-8"),
            headers={
                "Ocp-Apim-Subscription-Key": self._key,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
                "User-Agent": "enjoy-server",
            },
        )
        if resp.status_code != 200:
            raise AzureError(f"tts failed: {resp.status_code}")
        return resp.content


def get_azure(request: Request) -> AzureSpeech:
    state = request.app.state
    if not hasattr(state, "azure"):
        s = state.settings
        state.azure = AzureSpeech(state.http, s.azure_speech_key, s.azure_speech_region)
    return state.azure
```

- [ ] **Step 3: 运行,确认通过**

Run: `uv run pytest tests/test_azure.py -q`
Expected: 全部通过(`12 passed`)。

- [ ] **Step 4: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add server/
git commit -m "feat(server): add Azure speech service with token cache and SSML synthesis" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4.2:发音评测 token 接口(含 `speech_tokens` 表与迁移)

**Files:**
- Modify: `server/app/models.py`, `server/app/routers/speech.py`, `server/tests/test_migrations.py`
- Create: `server/alembic/versions/0002_speech_tokens.py`, `server/tests/test_speech_tokens.py`

**Interfaces:**
- Consumes: `get_azure`、`current_user`、`get_session`
- Produces:
  - 模型 `SpeechToken(id:int, user_id:int, purpose, target_type, target_id, state:str="issued", created_at)`
  - `POST /api/speech/tokens` body `{purpose?, target_type?, target_id?, input?}` → `{id:int, token:str, region:str}`;503 `Azure Speech is not configured`;502 `Azure unavailable`
  - `PUT /api/speech/tokens/{id}` body `{state:"consumed"|"revoked"}` → `{id, state}`;404(不是自己的);422(非法 state)

- [ ] **Step 1: 写失败测试**

`server/tests/test_speech_tokens.py`:

```python
import httpx
import pytest

STS = "https://eastus.api.cognitive.microsoft.com/sts/v1.0/issueToken"


async def test_requires_auth(client):
    assert (await client.post("/api/speech/tokens", json={})).status_code == 401


async def test_issues_token_with_region(client, auth_headers, respx_mock):
    respx_mock.post(STS).mock(return_value=httpx.Response(200, text="jwt-1"))
    r = await client.post(
        "/api/speech/tokens",
        json={"purpose": "transcribe", "target_type": "Audio", "target_id": 42},
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["id"], int)
    assert body["token"] == "jwt-1"
    assert body["region"] == "eastus"


async def test_empty_body_is_accepted(client, auth_headers, respx_mock):
    respx_mock.post(STS).mock(return_value=httpx.Response(200, text="jwt-1"))
    r = await client.post("/api/speech/tokens", json={}, headers=auth_headers)
    assert r.status_code == 200


async def test_token_is_cached_across_requests(client, auth_headers, respx_mock):
    route = respx_mock.post(STS).mock(return_value=httpx.Response(200, text="jwt-1"))
    for _ in range(3):
        await client.post("/api/speech/tokens", json={}, headers=auth_headers)
    assert route.call_count == 1


async def test_consume_and_revoke(client, auth_headers, respx_mock):
    respx_mock.post(STS).mock(return_value=httpx.Response(200, text="jwt-1"))
    tid = (await client.post("/api/speech/tokens", json={}, headers=auth_headers)).json()["id"]
    r = await client.put(f"/api/speech/tokens/{tid}", json={"state": "consumed"}, headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"id": tid, "state": "consumed"}
    r = await client.put(f"/api/speech/tokens/{tid}", json={"state": "revoked"}, headers=auth_headers)
    assert r.json()["state"] == "revoked"


async def test_invalid_state_is_422(client, auth_headers, respx_mock):
    respx_mock.post(STS).mock(return_value=httpx.Response(200, text="jwt-1"))
    tid = (await client.post("/api/speech/tokens", json={}, headers=auth_headers)).json()["id"]
    r = await client.put(f"/api/speech/tokens/{tid}", json={"state": "bogus"}, headers=auth_headers)
    assert r.status_code == 422


async def test_cannot_update_someone_elses_token(client, auth_headers, respx_mock):
    respx_mock.post(STS).mock(return_value=httpx.Response(200, text="jwt-1"))
    tid = (await client.post("/api/speech/tokens", json={}, headers=auth_headers)).json()["id"]
    other = await client.post("/api/users", json={"username": "bob", "password": "password123"})
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    r = await client.put(f"/api/speech/tokens/{tid}", json={"state": "consumed"}, headers=other_headers)
    assert r.status_code == 404


async def test_azure_failure_is_502(client, auth_headers, respx_mock):
    respx_mock.post(STS).mock(return_value=httpx.Response(500, text="oops"))
    r = await client.post("/api/speech/tokens", json={}, headers=auth_headers)
    assert r.status_code == 502
    assert r.json()["error"] == "Azure unavailable"


@pytest.mark.parametrize(
    "settings_overrides", [{"azure_speech_key": "", "azure_speech_region": ""}], indirect=True
)
async def test_unconfigured_is_503(client, auth_headers):
    r = await client.post("/api/speech/tokens", json={}, headers=auth_headers)
    assert r.status_code == 503
    assert r.json()["error"] == "Azure Speech is not configured"
```

Run: `uv run pytest tests/test_speech_tokens.py -q`
Expected: FAIL — 404/405。

- [ ] **Step 2: 增加模型**

在 `server/app/models.py` 末尾追加:

```python
class SpeechToken(Base):
    __tablename__ = "speech_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str | None] = mapped_column(String(32), nullable=True)
    target_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    state: Mapped[str] = mapped_column(String(16), default="issued")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
```

- [ ] **Step 3: 实现路由**

`server/app/routers/speech.py`:

```python
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.azure import AzureError, AzureNotConfigured, AzureSpeech, get_azure
from app.deps import current_user, get_session
from app.models import SpeechToken, User

router = APIRouter(prefix="/api/speech")


class SpeechTokenIn(BaseModel):
    model_config = ConfigDict(coerce_numbers_to_str=True, extra="ignore")

    purpose: str | None = Field(default=None, max_length=32)
    target_type: str | None = Field(default=None, max_length=32)
    target_id: str | None = Field(default=None, max_length=64)


class SpeechTokenState(BaseModel):
    state: Literal["consumed", "revoked"]


@router.post("/tokens")
async def create_token(
    payload: SpeechTokenIn,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    azure: AzureSpeech = Depends(get_azure),
):
    try:
        token = await azure.get_token()
    except AzureNotConfigured:
        raise HTTPException(503, "Azure Speech is not configured")
    except (AzureError, httpx.HTTPError):
        raise HTTPException(502, "Azure unavailable")

    row = SpeechToken(
        user_id=user.id,
        purpose=payload.purpose,
        target_type=payload.target_type,
        target_id=payload.target_id,
    )
    session.add(row)
    await session.commit()
    return {"id": row.id, "token": token, "region": azure.region}


@router.put("/tokens/{token_id}")
async def update_token(
    token_id: int,
    payload: SpeechTokenState,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(SpeechToken).where(SpeechToken.id == token_id, SpeechToken.user_id == user.id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Speech token not found")
    row.state = payload.state
    await session.commit()
    return {"id": row.id, "state": row.state}
```

- [ ] **Step 4: 生成迁移 0002 并更新迁移测试**

Run:
```bash
cd /e/workspace/everyone-can-use-english/server
rm -f data/gen.db
DATABASE_URL=sqlite+aiosqlite:///./data/gen.db uv run alembic upgrade head
DATABASE_URL=sqlite+aiosqlite:///./data/gen.db uv run alembic revision --autogenerate -m "speech tokens" --rev-id 0002
rm -f data/gen.db
grep -c "create_table" alembic/versions/0002_speech_tokens.py
```
Expected: 最后一行输出 `1`(只创建 `speech_tokens`)。

把 `server/tests/test_migrations.py` 中的断言改为:

```python
    assert {"users", "access_tokens", "speech_tokens", "alembic_version"} <= names
```

- [ ] **Step 5: 运行全部测试**

Run: `uv run pytest -q`
Expected: 全部通过,0 failed。

- [ ] **Step 6: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add server/
git commit -m "feat(server): issue Azure speech tokens and track their state" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4.3:TTS 与 Whisper 路由

**Files:**
- Modify: `server/app/routers/ai_audio.py`
- Create: `server/tests/test_ai_audio.py`

**Interfaces:**
- Consumes: `get_azure`、`AzureSpeech.synthesize`、`AzureNotConfigured`/`AzureError`、`Settings.upstream_tts_*`、`upstream_whisper_*`、`tts_model_list`
- Produces:
  - `POST /api/ai/audio/speech` body `{input, model, voice?, response_format?}`
    - `azure/speech` → Azure 合成,返回 `audio/mpeg`
    - `openai/<m>` → 上游 `POST {UPSTREAM_TTS_BASE_URL}/audio/speech`,body 里 `model` 去掉 `openai/` 前缀
    - 模型不在 `TTS_MODELS` / `input` > 4096 字符 / Azure 音色非法 → 400;未配置 → 503;上游/Azure 失败 → 502
  - `POST /api/ai/audio/transcriptions`(multipart)→ 原样转发到 `{UPSTREAM_WHISPER_BASE_URL}/audio/transcriptions`,换上游密钥;非 multipart → 400;未配置 → 503

- [ ] **Step 1: 写失败测试**

`server/tests/test_ai_audio.py`:

```python
import json

import httpx
import pytest

AZURE_TTS = "https://eastus.tts.speech.microsoft.com/cognitiveservices/v1"
OPENAI_TTS = "https://tts.test/v1/audio/speech"
WHISPER = "https://whisper.test/v1/audio/transcriptions"


async def test_speech_requires_auth(client):
    r = await client.post("/api/ai/audio/speech", json={"input": "hi", "model": "azure/speech"})
    assert r.status_code == 401


async def test_azure_speech(client, auth_headers, respx_mock):
    route = respx_mock.post(AZURE_TTS).mock(return_value=httpx.Response(200, content=b"MP3DATA"))
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "a < b", "model": "azure/speech", "voice": "en-US-AvaNeural"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.content == b"MP3DATA"
    assert r.headers["content-type"] == "audio/mpeg"
    sent = route.calls.last.request
    assert sent.headers["ocp-apim-subscription-key"] == "az-secret"
    assert b"a &lt; b" in sent.content and b"xml:lang='en-US'" in sent.content


async def test_azure_speech_rejects_bad_voice(client, auth_headers):
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "hi", "model": "azure/speech", "voice": "bad voice"},
        headers=auth_headers,
    )
    assert r.status_code == 400


async def test_azure_speech_failure_is_502(client, auth_headers, respx_mock):
    respx_mock.post(AZURE_TTS).mock(return_value=httpx.Response(500))
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "hi", "model": "azure/speech", "voice": "en-US-AvaNeural"},
        headers=auth_headers,
    )
    assert r.status_code == 502


async def test_openai_speech_strips_prefix_and_uses_server_key(client, auth_headers, respx_mock):
    route = respx_mock.post(OPENAI_TTS).mock(
        return_value=httpx.Response(200, content=b"AUDIO", headers={"content-type": "audio/mpeg"})
    )
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "hello", "model": "openai/tts-1", "voice": "alloy"},
        headers=auth_headers,
    )
    assert r.status_code == 200 and r.content == b"AUDIO"
    sent = route.calls.last.request
    assert sent.headers["authorization"] == "Bearer tts-secret"
    body = json.loads(sent.content)
    assert body["model"] == "tts-1" and body["input"] == "hello" and body["voice"] == "alloy"


async def test_unsupported_tts_model_is_400(client, auth_headers):
    r = await client.post(
        "/api/ai/audio/speech", json={"input": "hi", "model": "openai/tts-1-hd"}, headers=auth_headers
    )
    assert r.status_code == 400


async def test_too_long_input_is_400(client, auth_headers):
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "x" * 4097, "model": "openai/tts-1", "voice": "alloy"},
        headers=auth_headers,
    )
    assert r.status_code == 400


@pytest.mark.parametrize("settings_overrides", [{"upstream_tts_base_url": ""}], indirect=True)
async def test_openai_tts_unconfigured_is_503(client, auth_headers):
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "hi", "model": "openai/tts-1", "voice": "alloy"},
        headers=auth_headers,
    )
    assert r.status_code == 503


@pytest.mark.parametrize(
    "settings_overrides", [{"azure_speech_key": "", "azure_speech_region": ""}], indirect=True
)
async def test_azure_tts_unconfigured_is_503(client, auth_headers):
    r = await client.post(
        "/api/ai/audio/speech",
        json={"input": "hi", "model": "azure/speech", "voice": "en-US-AvaNeural"},
        headers=auth_headers,
    )
    assert r.status_code == 503


async def test_transcriptions_forward_multipart(client, auth_headers, respx_mock):
    route = respx_mock.post(WHISPER).mock(
        return_value=httpx.Response(200, json={"text": "hello", "segments": []})
    )
    r = await client.post(
        "/api/ai/audio/transcriptions",
        files={"file": ("audio.mp3", b"FAKE-AUDIO", "audio/mpeg")},
        data={"model": "whisper-1", "response_format": "verbose_json"},
        headers=auth_headers,
    )
    assert r.status_code == 200 and r.json()["text"] == "hello"
    sent = route.calls.last.request
    assert sent.headers["authorization"] == "Bearer wh-secret"
    assert sent.headers["content-type"].startswith("multipart/form-data")
    assert b"FAKE-AUDIO" in sent.content and b"whisper-1" in sent.content


async def test_transcriptions_reject_non_multipart(client, auth_headers):
    r = await client.post("/api/ai/audio/transcriptions", json={"a": 1}, headers=auth_headers)
    assert r.status_code == 400


@pytest.mark.parametrize("settings_overrides", [{"upstream_whisper_base_url": ""}], indirect=True)
async def test_transcriptions_unconfigured_is_503(client, auth_headers):
    r = await client.post(
        "/api/ai/audio/transcriptions",
        files={"file": ("a.mp3", b"x", "audio/mpeg")},
        headers=auth_headers,
    )
    assert r.status_code == 503


async def test_transcriptions_require_auth(client):
    r = await client.post(
        "/api/ai/audio/transcriptions", files={"file": ("a.mp3", b"x", "audio/mpeg")}
    )
    assert r.status_code == 401
```

Run: `uv run pytest tests/test_ai_audio.py -q`
Expected: FAIL — 404/405。

- [ ] **Step 2: 实现**

`server/app/routers/ai_audio.py`:

```python
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from app.azure import AzureError, AzureNotConfigured, AzureSpeech, get_azure
from app.config import Settings
from app.deps import current_user, get_settings
from app.models import User

router = APIRouter(prefix="/api/ai")

MAX_TTS_INPUT = 4096


class SpeechIn(BaseModel):
    input: str
    model: str
    voice: str = "alloy"
    response_format: str | None = None


@router.post("/audio/speech")
async def speech(
    payload: SpeechIn,
    request: Request,
    _: User = Depends(current_user),
    settings: Settings = Depends(get_settings),
    azure: AzureSpeech = Depends(get_azure),
):
    if payload.model not in settings.tts_model_list:
        raise HTTPException(400, f"Unsupported TTS model: {payload.model}")
    if len(payload.input) > MAX_TTS_INPUT:
        raise HTTPException(400, "Input is too long")

    if payload.model == "azure/speech":
        try:
            audio = await azure.synthesize(payload.input, payload.voice)
        except ValueError:
            raise HTTPException(400, "Invalid voice")
        except AzureNotConfigured:
            raise HTTPException(503, "Azure Speech is not configured")
        except (AzureError, httpx.HTTPError):
            raise HTTPException(502, "Azure unavailable")
        return Response(content=audio, media_type="audio/mpeg")

    if not settings.upstream_tts_base_url:
        raise HTTPException(503, "TTS upstream is not configured")
    http: httpx.AsyncClient = request.app.state.http
    try:
        upstream = await http.post(
            settings.upstream_tts_base_url.rstrip("/") + "/audio/speech",
            json={
                "model": payload.model.removeprefix("openai/"),
                "input": payload.input,
                "voice": payload.voice,
                "response_format": payload.response_format or "mp3",
            },
            headers={"Authorization": f"Bearer {settings.upstream_tts_key}"},
        )
    except httpx.HTTPError:
        raise HTTPException(502, "Upstream unavailable")
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "audio/mpeg"),
    )


@router.post("/audio/transcriptions")
async def transcriptions(
    request: Request,
    _: User = Depends(current_user),
    settings: Settings = Depends(get_settings),
):
    content_type = request.headers.get("content-type", "")
    if not content_type.startswith("multipart/form-data"):
        raise HTTPException(400, "Expected multipart/form-data")
    if not settings.upstream_whisper_base_url:
        raise HTTPException(503, "Whisper upstream is not configured")

    http: httpx.AsyncClient = request.app.state.http
    try:
        upstream = await http.post(
            settings.upstream_whisper_base_url.rstrip("/") + "/audio/transcriptions",
            content=await request.body(),
            headers={
                "Authorization": f"Bearer {settings.upstream_whisper_key}",
                "Content-Type": content_type,
            },
        )
    except httpx.HTTPError:
        raise HTTPException(502, "Upstream unavailable")
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "application/json"),
    )
```

- [ ] **Step 3: 运行全部测试**

Run: `uv run pytest -q`
Expected: 全部通过,0 failed。

- [ ] **Step 4: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add server/
git commit -m "feat(server): add TTS (azure + openai) and Whisper transcription proxies" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4.4:真实上游冒烟脚本

**Files:**
- Create: `server/scripts/smoke.py`

**Interfaces:**
- Consumes: 运行中的服务(`--base-url`),所有 `/api` 接口
- Produces: 逐项输出 `PASS/FAIL/SKIP`,有 FAIL 时退出码为 1

- [ ] **Step 1: 编写脚本**

`server/scripts/smoke.py`:

```python
"""对运行中的服务做真实上游冒烟测试。

Usage: uv run python scripts/smoke.py --base-url http://localhost:8000
会注册一个随机用户。未配置的能力(503)显示为 SKIP。
"""
import argparse
import json
import secrets
import sys

import httpx


class Skip(Exception):
    pass


def require_ok(r: httpx.Response) -> httpx.Response:
    if r.status_code == 503:
        raise Skip(r.json().get("error", "not configured"))
    if r.status_code >= 400:
        raise RuntimeError(f"{r.status_code} {r.text[:200]}")
    return r


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8000")
    args = parser.parse_args()

    http = httpx.Client(base_url=args.base_url, timeout=120)
    failures: list[str] = []
    state: dict = {}

    def check(name, fn):
        try:
            detail = fn()
            print(f"PASS  {name}  {detail or ''}")
        except Skip as exc:
            print(f"SKIP  {name}  ({exc})")
        except Exception as exc:  # noqa: BLE001
            failures.append(name)
            print(f"FAIL  {name}  {exc}")

    def register():
        name = "smoke_" + secrets.token_hex(4)
        r = require_ok(http.post("/api/users", json={"username": name, "password": "password123"}))
        body = r.json()
        assert len(body["id"]) == 8 and body["id"].isdigit(), body
        state["headers"] = {"Authorization": f"Bearer {body['access_token']}"}
        state["model"] = require_ok(http.get("/api/config/default_gpt_preset")).json()["configuration"]["model"]
        return f"user={name} model={state['model']}"

    def chat():
        r = require_ok(http.post("/api/ai/chat/completions", headers=state["headers"], json={
            "model": state["model"], "max_tokens": 16,
            "messages": [{"role": "user", "content": "Say OK"}],
        }))
        return r.json()["choices"][0]["message"]["content"][:40]

    def chat_stream():
        chunks = 0
        done = False
        with http.stream("POST", "/api/ai/chat/completions", headers=state["headers"], json={
            "model": state["model"], "stream": True,
            "messages": [{"role": "user", "content": "Count to 3"}],
        }) as r:
            if r.status_code == 503:
                raise Skip("LLM not configured")
            assert r.status_code == 200, r.read()
            for line in r.iter_lines():
                if line.startswith("data:"):
                    chunks += 1
                    done = done or "[DONE]" in line
        assert chunks > 1 and done, f"chunks={chunks} done={done}"
        return f"{chunks} chunks"

    def chat_json_mode():
        r = require_ok(http.post("/api/ai/chat/completions", headers=state["headers"], json={
            "model": state["model"], "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": 'Reply with the JSON {"ok": true}'}],
        }))
        json.loads(r.json()["choices"][0]["message"]["content"])

    def chat_tool_call():
        r = require_ok(http.post("/api/ai/chat/completions", headers=state["headers"], json={
            "model": state["model"],
            "messages": [{"role": "user", "content": "answer: 42"}],
            "tools": [{"type": "function", "function": {"name": "emit", "parameters": {
                "type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"]}}}],
            "tool_choice": {"type": "function", "function": {"name": "emit"}},
        }))
        assert r.json()["choices"][0]["message"].get("tool_calls"), "no tool_calls in response"

    def tts_openai():
        r = require_ok(http.post("/api/ai/audio/speech", headers=state["headers"], json={
            "model": "openai/tts-1", "voice": "alloy", "input": "Hello world"}))
        assert len(r.content) > 1000
        state["mp3"] = r.content
        return f"{len(r.content)} bytes"

    def tts_azure():
        r = require_ok(http.post("/api/ai/audio/speech", headers=state["headers"], json={
            "model": "azure/speech", "voice": "en-US-AvaNeural", "input": "Hello world"}))
        assert len(r.content) > 1000
        state["mp3"] = r.content
        return f"{len(r.content)} bytes"

    def whisper():
        if "mp3" not in state:
            raise Skip("no audio produced by the TTS checks")
        r = require_ok(http.post("/api/ai/audio/transcriptions", headers=state["headers"],
            files={"file": ("audio.mp3", state["mp3"], "audio/mpeg")},
            data={"model": "whisper-1", "response_format": "verbose_json"}))
        text = r.json()["text"].lower()
        assert "hello" in text, text
        return text.strip()

    def speech_token():
        r = require_ok(http.post("/api/speech/tokens", headers=state["headers"], json={"purpose": "transcribe"}))
        body = r.json()
        assert isinstance(body["id"], int) and body["token"].count(".") == 2 and body["region"], body
        require_ok(http.put(f"/api/speech/tokens/{body['id']}", headers=state["headers"], json={"state": "consumed"}))
        return f"region={body['region']}"

    for name, fn in [
        ("register", register),
        ("chat", chat),
        ("chat stream", chat_stream),
        ("chat json mode", chat_json_mode),
        ("chat tool call", chat_tool_call),
        ("tts openai/tts-1", tts_openai),
        ("tts azure/speech", tts_azure),
        ("whisper (tts -> stt round trip)", whisper),
        ("speech token", speech_token),
    ]:
        check(name, fn)
        if name == "register" and "register" in failures:
            break

    print("\nFAILED: " + ", ".join(failures) if failures else "\nAll checks passed (SKIP = not configured).")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add server/scripts/smoke.py
git commit -m "feat(server): add real-upstream smoke script" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### 验收门槛 4

- [ ] `uv run pytest -q` → **0 failed**。
- [ ] `server/.env` 填齐所有上游配置(LLM、TTS、Whisper、`AZURE_SPEECH_KEY`、`AZURE_SPEECH_REGION`,且 `TTS_MODELS` 含 `openai/tts-1` 与 `azure/speech`),启动服务后运行:
  ```bash
  uv run python scripts/smoke.py --base-url http://localhost:8000
  ```
  **预期:9 项全部 `PASS`,没有 `FAIL`,也没有 `SKIP`**(能力全选,不应出现 SKIP;出现即说明配置缺失,补齐再测)。
- [ ] 迁移链完整:`rm -f data/gate.db && DATABASE_URL=sqlite+aiosqlite:///./data/gate.db uv run alembic upgrade head && uv run alembic current` 输出 `0002 (head)`。
- [ ] `git status --short` 干净。

---

## 阶段 5:客户端改动

**阶段目标:** 客户端指向自建后端,账号密码登录,AI 无需配置,无依赖官方服务器的可见入口。

> 客户端目录:`enjoy/`。依赖尚未安装时先在仓库根目录运行 `corepack enable && yarn install`。

### Task 5.1:类型检查基线 + 默认服务器地址

**Files:**
- Modify: `enjoy/src/constants/index.ts:34`, `enjoy/forge.env.d.ts`
- Create: `enjoy/.env.example`

- [ ] **Step 1: 安装依赖并记录类型检查基线**

Run:
```bash
cd /e/workspace/everyone-can-use-english && corepack enable && yarn install
cd enjoy && yarn exec tsc --noEmit -p . 2>&1 | grep -c "error TS" | tee /tmp/tsc-baseline.txt
```
Expected: 输出一个数字(基线错误数,可能为 0 也可能非 0)。**记下该数字**,后续任务要求「不增加」。

- [ ] **Step 2: 改默认地址**

把 `enjoy/src/constants/index.ts` 中

```ts
export const WEB_API_URL = "https://enjoy.bot";
```

替换为:

```ts
export const WEB_API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8000";
```

在 `enjoy/forge.env.d.ts` 文件**第一行**之前插入:

```ts
/// <reference types="vite/client" />
```

创建 `enjoy/.env.example`:

```bash
# 构建/开发时使用的后端地址(复制为 enjoy/.env)
VITE_API_URL=http://localhost:8000
```

- [ ] **Step 3: 验证类型检查不增加错误**

Run: `cd /e/workspace/everyone-can-use-english/enjoy && yarn exec tsc --noEmit -p . 2>&1 | grep -c "error TS"`
Expected: 不大于 Step 1 记下的数字。

- [ ] **Step 4: 验证 `import.meta.env` 在主进程与渲染进程都生效**

先在另一个终端启动后端(阶段 4 的服务,`localhost:8000`),并创建 `enjoy/.env`,内容 `VITE_API_URL=http://localhost:8000`。
Run: `cd /e/workspace/everyone-can-use-english && yarn enjoy:start`(首次运行会先下载词典并拉取 Electron,耗时较长,国内网络可能需要代理)
Expected: 应用窗口打开,登录页「高级」Tab 的 API 地址显示 `http://localhost:8000`(该值来自主进程的 `settings.apiUrl()`)。
再把 `enjoy/.env` 改成 `VITE_API_URL=http://127.0.0.1:8000` 重启,地址应变化。**若地址不随 `.env` 变化,说明主进程构建没有替换 `import.meta.env`**:改用 `enjoy/vite.main.config.ts` / `vite.renderer.config.ts` 的 `define: { "import.meta.env.VITE_API_URL": JSON.stringify(process.env.VITE_API_URL) }`,并重复本步骤。

- [ ] **Step 5: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add enjoy/src/constants/index.ts enjoy/forge.env.d.ts enjoy/.env.example
git commit -m "feat(enjoy): read default API url from VITE_API_URL" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 5.2:移除 ActionCable 连接

**Files:**
- Modify: `enjoy/src/renderer/context/app-settings-provider.tsx`

- [ ] **Step 1: 删除 `createCable` 的调用**

把

```tsx
        EnjoyApp.userSettings.set(UserSettingKeyEnum.PROFILE, user);
        createCable(user.accessToken);
```

替换为:

```tsx
        EnjoyApp.userSettings.set(UserSettingKeyEnum.PROFILE, user);
```

- [ ] **Step 2: 删除 `createCable` 函数与不再使用的导入**

删除:

```tsx
  const createCable = async (token: string) => {
    if (!token) return;

    const wsUrl = await EnjoyApp.app.wsUrl();
    const consumer = createConsumer(wsUrl + "/cable?token=" + token);
    setCable(consumer);
  };

```

并把导入

```tsx
import { type Consumer, createConsumer } from "@rails/actioncable";
```

改为:

```tsx
import { type Consumer } from "@rails/actioncable";
```

(`sidebar.tsx` 里 `if (!cable) return;` 已对 `cable` 为空做了保护,无需改动。)

- [ ] **Step 3: 验证**

Run: `cd /e/workspace/everyone-can-use-english/enjoy && grep -rn "createCable\|createConsumer" src | head; yarn exec tsc --noEmit -p . 2>&1 | grep -c "error TS"`
Expected: grep 无输出;错误数不大于基线。

- [ ] **Step 4: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add enjoy/src/renderer/context/app-settings-provider.tsx
git commit -m "feat(enjoy): stop connecting to ActionCable" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 5.3:账号密码登录与注册

**Files:**
- Modify: `enjoy/src/api/client.ts:98-107`, `enjoy/src/renderer/components/login/login-form.tsx`, `enjoy/src/renderer/components/login/index.ts`, `enjoy/src/i18n/{en,zh-CN,es}.json`
- Create: `enjoy/src/renderer/components/login/password-login-form.tsx`

**Interfaces:**
- Consumes: 后端 `POST /api/sessions`、`POST /api/users`(阶段 1 契约)
- Produces: `Client.auth({provider:"password", username, password})`、`Client.register({username, password, inviteCode?})`,均返回 `Promise<UserType>`;组件 `PasswordLoginForm`

- [ ] **Step 1: 扩展 API 客户端**

把 `enjoy/src/api/client.ts` 中的 `auth` 方法

```ts
  auth(params: {
    provider: "mixin" | "github" | "bandu" | "email";
    code?: string;
    deviceCode?: string;
    phoneNumber?: string;
    email?: string;
    mixinId?: string;
  }): Promise<UserType> {
    return this.api.post("/api/sessions", decamelizeKeys(params));
  }
```

替换为:

```ts
  auth(params: {
    provider: "mixin" | "github" | "bandu" | "email" | "password";
    code?: string;
    deviceCode?: string;
    phoneNumber?: string;
    email?: string;
    mixinId?: string;
    username?: string;
    password?: string;
  }): Promise<UserType> {
    return this.api.post("/api/sessions", decamelizeKeys(params));
  }

  register(params: {
    username: string;
    password: string;
    inviteCode?: string;
  }): Promise<UserType> {
    return this.api.post("/api/users", decamelizeKeys(params));
  }
```

- [ ] **Step 2: 添加 i18n 文案**

先确认键名无冲突:

Run: `cd /e/workspace/everyone-can-use-english/enjoy && grep -n '"authUsername"\|"authPassword"\|"authRegister"\|"authInviteCode"\|"authSwitchToRegister"\|"authSwitchToLogin"' src/i18n/*.json`
Expected: 无输出。

用 Node 脚本追加键(保持原有顺序与 2 空格缩进):

```bash
cd /e/workspace/everyone-can-use-english/enjoy && node -e '
const fs = require("fs");
const add = {
  "en": { authUsername: "Username", authPassword: "Password", authRegister: "Register", authInviteCode: "Invite code (if required)", authSwitchToRegister: "No account? Register", authSwitchToLogin: "Already have an account? Log in" },
  "zh-CN": { authUsername: "用户名", authPassword: "密码", authRegister: "注册", authInviteCode: "邀请码(如需要)", authSwitchToRegister: "没有账号?去注册", authSwitchToLogin: "已有账号?去登录" },
  "es": { authUsername: "Username", authPassword: "Password", authRegister: "Register", authInviteCode: "Invite code (if required)", authSwitchToRegister: "No account? Register", authSwitchToLogin: "Already have an account? Log in" },
};
for (const [lang, keys] of Object.entries(add)) {
  const file = `src/i18n/${lang}.json`;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  Object.assign(data, keys);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
'
git diff --stat src/i18n
```
Expected: 三个文件各只新增 6 行(`insertions` 约 6–7,`deletions` ≤ 1,说明没有重排原有内容)。若 `deletions` 很大,`git checkout src/i18n` 回滚,改为手工在文件末尾追加这 6 个键。

- [ ] **Step 3: 新建登录表单组件**

`enjoy/src/renderer/components/login/password-login-form.tsx`:

```tsx
import { Button, Input, Label, toast } from "@renderer/components/ui";
import { useContext, useState } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import { t } from "i18next";

export const PasswordLoginForm = () => {
  const { login, webApi } = useContext(AppSettingsProviderContext);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [inviteCode, setInviteCode] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!webApi) return;

    setSubmitting(true);
    try {
      const user =
        mode === "login"
          ? await webApi.auth({ provider: "password", username, password })
          : await webApi.register({
              username,
              password,
              inviteCode: inviteCode || undefined,
            });
      if (user?.id && user?.accessToken) login(user);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="w-full" onSubmit={submit}>
      <div className="w-full grid gap-4 mb-6">
        <div className="grid gap-2">
          <Label htmlFor="username">{t("authUsername")}</Label>
          <Input
            id="username"
            className="h-10"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">{t("authPassword")}</Label>
          <Input
            id="password"
            className="h-10"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "register" ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {mode === "register" && (
          <div className="grid gap-2">
            <Label htmlFor="invite-code">{t("authInviteCode")}</Label>
            <Input
              id="invite-code"
              className="h-10"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
            />
          </div>
        )}
      </div>
      <Button
        type="submit"
        className="w-full"
        size="lg"
        data-testid="password-login-submit"
        disabled={submitting || !username || !password}
      >
        {mode === "login" ? t("login") : t("authRegister")}
      </Button>
      <Button
        type="button"
        variant="link"
        className="w-full mt-2"
        onClick={() => setMode(mode === "login" ? "register" : "login")}
      >
        {mode === "login" ? t("authSwitchToRegister") : t("authSwitchToLogin")}
      </Button>
    </form>
  );
};
```

- [ ] **Step 4: 导出并接入登录页**

`enjoy/src/renderer/components/login/index.ts` 追加一行:

```ts
export * from "./password-login-form";
```

在 `enjoy/src/renderer/components/login/login-form.tsx` 中:

1. 把导入

```tsx
import {
  UserSettings,
  LanguageSettings,
  GithubLoginButton,
  BanduLoginButton,
  MixinLoginButton,
  ProxySettings,
  ApiUrlSettings,
  NetworkState,
} from "@renderer/components";
import { EmailLoginForm } from "./email-login-form";
```

替换为:

```tsx
import {
  UserSettings,
  LanguageSettings,
  ProxySettings,
  ApiUrlSettings,
  NetworkState,
} from "@renderer/components";
import { PasswordLoginForm } from "./password-login-form";
```

2. 把 `login` Tab 内的

```tsx
            <EmailLoginForm />

            <div className="">
              <Separator className="my-4" />
              <div className="flex items-center justify-center text-xs text-muted-foreground mb-4">
                {t("youCanAlsoLoginWith")}
              </div>
              <div className="flex items-center space-x-2 justify-center">
                <GithubLoginButton />
                <MixinLoginButton />
                <BanduLoginButton />
              </div>
            </div>
```

替换为:

```tsx
            <PasswordLoginForm />
```

(邮箱/Mixin/Bandu/GitHub 的源文件保留不删,只是不再被登录页使用,减少合并冲突。)

- [ ] **Step 5: 验证**

Run: `cd /e/workspace/everyone-can-use-english/enjoy && yarn exec tsc --noEmit -p . 2>&1 | grep -c "error TS"`
Expected: 不大于基线。

手动:启动后端与客户端(`yarn enjoy:start`),在登录页:
1. 注册 `alice2` / `password123` → 自动进入应用。
2. 退出登录 → 用同一账号登录 → 进入应用。
3. 故意输错密码 → 出现红色错误 toast「Invalid username or password」。
4. 切到「已记住的用户」Tab,能看到刚才的 8 位数字用户并可直接选择。

- [ ] **Step 6: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add enjoy/
git commit -m "feat(enjoy): replace login methods with username/password login and registration" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 5.4:STT 改用服务端 Whisper

**Files:**
- Modify: `enjoy/src/renderer/hooks/use-transcribe.tsx`, `enjoy/src/renderer/components/preferences/stt-settings.tsx`, `enjoy/src/i18n/{en,zh-CN}.json`

**Interfaces:**
- Consumes: 后端 `POST /api/ai/audio/transcriptions`(OpenAI `verbose_json`,阶段 4)

- [ ] **Step 1: 取得 `apiUrl`**

在 `use-transcribe.tsx` 中把

```tsx
  const { EnjoyApp, user, webApi } = useContext(AppSettingsProviderContext);
```

改为:

```tsx
  const { EnjoyApp, user, webApi, apiUrl } = useContext(
    AppSettingsProviderContext
  );
```

- [ ] **Step 2: 重写 Cloudflare 分支**

把调用处

```tsx
    } else if (service === SttEngineOptionEnum.ENJOY_CLOUDFLARE) {
      result = await transcribeByCloudflareAi(blob);
```

改为:

```tsx
    } else if (service === SttEngineOptionEnum.ENJOY_CLOUDFLARE) {
      result = await transcribeByServerWhisper(
        new File([blob], "audio.mp3", { type: "audio/mp3" })
      );
```

并把整个 `transcribeByCloudflareAi` 函数(以 `const transcribeByCloudflareAi = async (` 开头、到其 `catch` 块结束)替换为:

```tsx
  const transcribeByServerWhisper = async (
    file: File
  ): Promise<{
    engine: string;
    model: string;
    transcript: string;
    segmentTimeline: TimelineEntry[];
  }> => {
    const client = new OpenAI({
      apiKey: user.accessToken,
      baseURL: `${apiUrl}/api/ai`,
      dangerouslyAllowBrowser: true,
      maxRetries: 0,
    });

    setOutput("Transcribing from server...");
    logger.info("Start transcribing from server whisper...");
    try {
      const res: {
        text: string;
        segments?: { text: string; start: number; end: number }[];
      } = (await client.audio.transcriptions.create({
        file,
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["word", "segment"],
      })) as any;

      setOutput("Server transcribe done");
      const segmentTimeline = (res.segments || []).map((segment) => {
        return {
          type: "segment" as TimelineEntryType,
          text: segment.text,
          startTime: segment.start,
          endTime: segment.end,
          timeline: [] as TimelineEntry[],
        };
      });

      return {
        engine: "enjoyai",
        model: "whisper-1",
        transcript: res.text,
        segmentTimeline,
      };
    } catch (err) {
      throw new Error(t("openaiTranscribeFailed", { error: err.message }));
    }
  };
```

- [ ] **Step 3: 清理不再使用的导入**

Run: `cd /e/workspace/everyone-can-use-english/enjoy && grep -n "axios\|AI_WORKER_ENDPOINT\|CfWhipserOutputType\|parseText" src/renderer/hooks/use-transcribe.tsx`
对每个**只剩下导入行、再无其他使用**的标识符,删除对应导入(`axios`、`AI_WORKER_ENDPOINT` 预期会被删;`parseText` 若仍被别处使用则保留)。

- [ ] **Step 4: 精简 STT 设置**

在 `stt-settings.tsx` 删除这一行(隐藏需要用户自填密钥的 OpenAI 选项):

```tsx
            <SelectItem value={SttEngineOptionEnum.OPENAI}>OpenAI</SelectItem>
```

同时把 `enjoyCloudflare` 与 `enjoyCloudflareSpeechToTextDescription` 两个 i18n 键的**值**改为「服务器 Whisper」含义:

```bash
cd /e/workspace/everyone-can-use-english/enjoy && node -e '
const fs = require("fs");
const set = {
  "en": { enjoyCloudflare: "Server Whisper", enjoyCloudflareSpeechToTextDescription: "Transcribe with the Whisper model on your server." },
  "zh-CN": { enjoyCloudflare: "服务器 Whisper", enjoyCloudflareSpeechToTextDescription: "使用服务器上的 Whisper 模型进行语音转文字。" },
};
for (const [lang, keys] of Object.entries(set)) {
  const file = `src/i18n/${lang}.json`;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  Object.assign(data, keys);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
'
git diff --stat src/i18n
```
Expected: 改动行数很小(仅这两个键的值)。

- [ ] **Step 5: 验证**

Run: `yarn exec tsc --noEmit -p . 2>&1 | grep -c "error TS"`
Expected: 不大于基线。

手动:在应用里导入一段英文音频(「音频」页),转写引擎选「服务器 Whisper」,转写成功且产生分句时间轴;再选「Enjoy Azure」(默认),同样成功。

- [ ] **Step 6: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add enjoy/
git commit -m "feat(enjoy): transcribe via the server whisper endpoint instead of the hardcoded cloudflare worker" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 5.5:隐藏 AI 配置与依赖官方服务的入口

**Files:**
- Modify: `enjoy/src/renderer/components/conversations/gpt-providers.tsx`, `enjoy/src/renderer/components/conversations/tts-providers.tsx`, `enjoy/src/renderer/context/ai-settings-provider.tsx`, `enjoy/src/renderer/components/preferences/preferences.tsx`, `enjoy/src/renderer/components/layouts/sidebar.tsx`, `enjoy/src/renderer/components/preferences/user-settings.tsx`

- [ ] **Step 1: 只保留 `enjoyai` 引擎**

在 `gpt-providers.tsx` 的 `GPT_PROVIDERS` 对象里,删除 `openai` 与 `ollama` 两个条目(只保留 `enjoyai`)。
在 `tts-providers.tsx` 的 `TTS_PROVIDERS` 对象里,删除除 `enjoyai` 外的所有顶层条目。
验证顶层键:

Run: `cd /e/workspace/everyone-can-use-english/enjoy && grep -nE '^  [a-zA-Z]+: \{' src/renderer/components/conversations/gpt-providers.tsx src/renderer/components/conversations/tts-providers.tsx`
Expected: 每个文件只列出 `enjoyai` 一行。

- [ ] **Step 2: 删除对已移除条目的引用**

在 `ai-settings-provider.tsx` 的 `refreshGptProviders` 中,删除这两段:

```tsx
    try {
      const response = await fetch(providers["ollama"]?.baseUrl + "/api/tags");
      providers["ollama"].models = (await response.json()).models.map(
        (m: any) => m.name
      );
    } catch (e) {
      console.warn(`No ollama server found: ${e.message}`);
    }

    if (openai?.models) {
      providers["openai"].models = openai.models.split(",");
    }
```

查找其他引用并逐个处理:

Run: `grep -rn "ollama\|providers\[\"openai\"\]\|gptProviders\.openai\|GPT_PROVIDERS\.openai" src/renderer | grep -v "i18n"`
对每一处命中:若属于「选择/配置 OpenAI 或 Ollama 引擎」的逻辑,删除该分支;若是类型或 `engine === "openai"` 的兼容判断(如 `Conversation` 模型里的 `["openai","enjoyai"]`),保持不动。

- [ ] **Step 3: 精简偏好设置页**

在 `preferences.tsx` 中:
- 「advanced」Tab 删除 `<OpenaiSettings />` 及其后的 `<Separator />`。
- 「account」Tab 删除 `<EmailSettings />`、`<BalanceSettings />` 及各自后面的 `<Separator />`。
- 同步删除不再使用的导入(`OpenaiSettings`、`BalanceSettings`、`EmailSettings`)。

- [ ] **Step 4: 隐藏「课程」「社区」侧边栏入口**

Run: `grep -n 'href="/courses"\|href="/community"' src/renderer/components/layouts/sidebar.tsx`
打开 `sidebar.tsx`,删除这两个侧边栏条目对应的整个 JSX 块(各约 8–10 行,以 `href="/courses"` / `href="/community"` 所在的 `<SidebarItem ...>`/链接组件为边界,连同它们专用的图标导入一起删)。
验证:再次运行上面的 grep,**无输出**。

- [ ] **Step 5: 处理账号设置里的服务端依赖**

Run: `grep -n "updateProfile\|balance\|deposit\|email\|Email" src/renderer/components/preferences/user-settings.tsx`
删除所有调用 `webApi.updateProfile`、展示余额/充值/邮箱的控件(保留头像、用户名展示和退出登录)。

- [ ] **Step 6: 验证类型检查与残留的官方域名**

Run:
```bash
cd /e/workspace/everyone-can-use-english/enjoy
yarn exec tsc --noEmit -p . 2>&1 | grep -c "error TS"
grep -rn "enjoy\.bot\|ai-worker" src --include=*.ts --include=*.tsx | grep -v "i18n"
```
Expected: 错误数不大于基线;grep 的剩余命中只允许出现在以下已知位置:`constants/index.ts`(`STORAGE_WORKER_ENDPOINT(S)`、`DISCUSS_URL`、`AI_WORKER_ENDPOINT` 常量定义)、`main/window.ts` 与 `pages/community.tsx`(社区入口已隐藏)。其余命中逐个确认不影响主流程。

- [ ] **Step 7: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add enjoy/
git commit -m "feat(enjoy): lock AI engine to the server and hide unsupported entries" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 5.6:端到端验收清单

**Files:** 无代码改动;结果记录在 `docs/superpowers/plans/e2e-results.md`(新建,逐项写 ✅/❌ 与备注)。

- [ ] **Step 1: 环境**:后端运行并配好**真实**上游;`enjoy/.env` 指向它;`yarn enjoy:start`。DevTools(`Ctrl+Shift+I`)Network 面板过滤 `/api`。

- [ ] **Step 2: 逐项执行**(每项都要在 DevTools 中确认没有 4xx/5xx 的 `/api` 请求,除了清单里注明的)

| # | 操作 | 预期 |
|---|---|---|
| 1 | 全新用户注册 | 进入主界面,个人目录名为 8 位数字 |
| 2 | 退出 → 重新登录;再用「已记住的用户」进入 | 两种方式都成功 |
| 3 | 新建对话(默认 Ava),发一条英文消息 | 回复**流式**出现 |
| 4 | 对话里播放回复语音(`azure/speech`) | 有声音 |
| 5 | 新建角色把语音改为 `openai/tts-1` 并播放 | 有声音 |
| 6 | 对话里录音并评测发音 | 出现发音评分;请求中有 `POST /api/speech/tokens` 200 |
| 7 | 「发音评测」页新建评测 | 评分出现 |
| 8 | 导入一段英文音频,STT 选 Azure | 转写成功 |
| 9 | 同一段音频,STT 选「服务器 Whisper」 | 转写成功,有分句 |
| 10 | 在字幕里点击生词,查 AI 词典 | 显示释义(`POST /api/lookups` 200 且客户端调 `/api/ai/chat/completions`) |
| 11 | 触发一次翻译 | 译文出现 |
| 12 | 依次点开侧边栏每个入口 | 页面无崩溃;没有指向官方服务器的请求;无 `/api` 的 404/500(`/api/config/bugsnag_api_key` 的 404 除外,且仅打包版会发) |
| 13 | 偏好设置各 Tab | 无 OpenAI 密钥、邮箱、余额、充值入口 |
| 14 | 关闭服务端,再操作 AI | 出现可读的错误提示,应用不崩溃 |

- [ ] **Step 3: 提交结果**

```bash
cd /e/workspace/everyone-can-use-english
git add docs/superpowers/plans/e2e-results.md
git commit -m "docs: record client end-to-end results" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### 验收门槛 5

- [ ] `cd enjoy && yarn exec tsc --noEmit -p . 2>&1 | grep -c "error TS"` **不大于**基线数字。
- [ ] `grep -rn 'href="/courses"\|href="/community"' enjoy/src/renderer/components/layouts/sidebar.tsx` 无输出。
- [ ] `e2e-results.md` 的 14 项**全部 ✅**;出现 ❌ 的项必须修复后重测,不得带着 ❌ 进入阶段 6。
- [ ] `git status --short` 干净。

---

## 阶段 6:Docker、Postgres、文档

**阶段目标:** 一条命令起服务;SQLite 与 Postgres 两种模式都跑通;有完整的部署说明。

### Task 6.1:Dockerfile

**Files:**
- Create: `server/Dockerfile`, `server/.dockerignore`

- [ ] **Step 1: 写 Dockerfile**

`server/Dockerfile`:

```dockerfile
FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./

FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
RUN useradd --system --uid 10001 app && mkdir -p /data && chown app /data
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/up', timeout=3)"
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000 --workers 1"]
```

`server/.dockerignore`:

```
.venv
data
.env
tests
scripts
__pycache__
*.pyc
.pytest_cache
```

- [ ] **Step 2: 构建并确认运行镜像里没有 uv**

Run:
```bash
cd /e/workspace/everyone-can-use-english/server
docker build -t enjoy-server:dev .
docker run --rm --entrypoint sh enjoy-server:dev -c "which uv || echo no-uv; python --version"
```
Expected: 构建成功;输出 `no-uv` 与 `Python 3.12.x`。
若 `ghcr.io/astral-sh/uv:0.12.5` 拉取失败,把标签改成与本机 `uv --version` 一致的可用标签。

- [ ] **Step 3: 提交**

```bash
cd /e/workspace/everyone-can-use-english
git add server/Dockerfile server/.dockerignore
git commit -m "feat(server): add multi-stage Dockerfile built with uv" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 6.2:Compose 与环境变量模板

**Files:**
- Create: `docker-compose.yml`, `server/.env.example`

- [ ] **Step 1: 环境变量模板**

`server/.env.example`:

```bash
# ---- 数据库(二选一,改这一行即可切换)----
# SQLite(默认,数据在 compose 卷 /data 中)
DATABASE_URL=sqlite+aiosqlite:////data/app.db
# Postgres(同时用 `docker compose --profile postgres up -d`)
# DATABASE_URL=postgresql+asyncpg://enjoy:change-me@postgres:5432/enjoy
POSTGRES_USER=enjoy
POSTGRES_PASSWORD=change-me
POSTGRES_DB=enjoy

# ---- 注册 ----
# open: 任何人可注册 | invite: 需要 INVITE_CODE | closed: 关闭注册
REGISTRATION_MODE=open
INVITE_CODE=
# 部署在反向代理之后时设为 true,使用 X-Forwarded-For 做限流
TRUST_PROXY_HEADERS=false
RATE_LIMIT_PER_MINUTE=10

# ---- LLM(OpenAI 兼容)----
UPSTREAM_LLM_BASE_URL=https://api.openai.com/v1
UPSTREAM_LLM_KEY=
LLM_MODELS=gpt-4o-mini,gpt-4o
DEFAULT_LLM_MODEL=gpt-4o

# ---- TTS(openai/* 走这里;azure/speech 走下面的 Azure)----
UPSTREAM_TTS_BASE_URL=https://api.openai.com/v1
UPSTREAM_TTS_KEY=
TTS_MODELS=openai/tts-1,azure/speech

# ---- Whisper(服务端转写)----
UPSTREAM_WHISPER_BASE_URL=https://api.openai.com/v1
UPSTREAM_WHISPER_KEY=

# ---- Azure Speech(发音评测、默认 STT、azure/speech TTS)----
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=eastus

# 客户端检查更新时看到的版本号
APP_VERSION=0.7.9
```

- [ ] **Step 2: Compose**

`docker-compose.yml`(仓库根目录):

```yaml
services:
  server:
    build: ./server
    env_file: ./server/.env
    ports:
      - "8000:8000"
    volumes:
      - enjoy-data:/data
    depends_on:
      postgres:
        condition: service_healthy
        required: false
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    profiles: ["postgres"]
    env_file: ./server/.env
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - pg-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped

volumes:
  enjoy-data:
  pg-data:
```

- [ ] **Step 3: 验证配置语法**

Run: `cd /e/workspace/everyone-can-use-english && cp server/.env.example server/.env && docker compose config -q && docker compose --profile postgres config -q && echo OK`
Expected: 输出 `OK`。

- [ ] **Step 4: 提交**

```bash
git add docker-compose.yml server/.env.example
git commit -m "feat(server): add docker compose with optional postgres profile" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 6.3:两种数据库模式的实机验证

**Files:** 无代码改动。

- [ ] **Step 1: SQLite 模式**

在 `server/.env` 填入真实上游配置,`DATABASE_URL` 保持 SQLite。
Run:
```bash
cd /e/workspace/everyone-can-use-english
docker compose up -d --build
docker compose ps
```
Expected: `server` 状态 `healthy`。
Run: `cd server && uv run python scripts/smoke.py --base-url http://localhost:8000`
Expected: 9 项全部 `PASS`。
Run: `docker compose restart server && sleep 5 && curl -s localhost:8000/up`
Expected: `{"status":"ok"}`;之前注册的用户仍可登录(数据在卷里)。

- [ ] **Step 2: 切换到 Postgres**

```bash
docker compose down
```
编辑 `server/.env`:注释 SQLite 行,启用 `DATABASE_URL=postgresql+asyncpg://enjoy:change-me@postgres:5432/enjoy`(密码与 `POSTGRES_PASSWORD` 一致)。
Run:
```bash
docker compose --profile postgres up -d --build
docker compose ps
```
Expected: `postgres` 与 `server` 均 `healthy`。
Run:
```bash
cd server && uv run python scripts/smoke.py --base-url http://localhost:8000
docker compose exec postgres psql -U enjoy -d enjoy -c '\dt'
```
Expected: 冒烟 9 项 `PASS`;`\dt` 列出 `users`、`access_tokens`、`speech_tokens`、`alembic_version`。

- [ ] **Step 3: 在 Postgres 上跑测试套件**

```bash
docker compose exec postgres psql -U enjoy -d enjoy -c 'CREATE DATABASE enjoy_test;'
cd server && TEST_DATABASE_URL=postgresql+asyncpg://enjoy:change-me@localhost:5432/enjoy_test uv run pytest -q
```
Expected: 全部通过,0 failed。若迁移测试以外有因方言差异失败的用例,修复实现(不是改测试),并补一条回归测试。

### Task 6.4:文档

**Files:**
- Create: `server/README.md`
- Modify: `README.md`(仓库根,在「桌面版」小节后追加一小节)

- [ ] **Step 1: `server/README.md`**

内容必须包含(用代码块给出命令):

1. 它是什么(一句话)与接口一览(沿用设计文档第 3 节的图)。
2. 快速开始:`cp server/.env.example server/.env` → 填写 → `docker compose up -d --build`。
3. 本地开发:`cd server && uv sync && uv run pytest && uv run uvicorn app.main:create_app --factory --reload`。
4. 切换数据库:改 `DATABASE_URL` 与是否带 `--profile postgres`;**注意切换不会迁移数据**。
5. 注册保护:`REGISTRATION_MODE` 三种取值与 `INVITE_CODE`、限流。
6. **必须使用 HTTPS**:给一段 Caddyfile 示例(`your.domain { reverse_proxy server:8000 }`)并说明设置 `TRUST_PROXY_HEADERS=true`;提醒反向代理需允许大请求体(音频上传)。
7. 客户端如何指向它:`enjoy/.env` 的 `VITE_API_URL`,以及登录页「高级」里的 API 地址。
8. 冒烟脚本用法;刷新配置快照用法(`uv run python scripts/fetch_config.py`)。
9. 已知限制:单 worker、手机端用官方网页版账号不互通、配置快照来自官方公开接口。

- [ ] **Step 2: 根 `README.md`**

在「桌面版」小节后追加:

```markdown
## 自建后端(本分支)

本分支新增 `server/`,用于脱离 enjoy.bot 自行部署:账号密码登录、AI 服务由自己的上游提供。
详见 [server/README.md](./server/README.md) 与 [设计文档](./docs/superpowers/specs/2026-10-02-self-hosted-backend-design.md)。
```

- [ ] **Step 3: 提交**

```bash
git add server/README.md README.md
git commit -m "docs: document self-hosted deployment" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### 验收门槛 6(项目完成标准)

- [ ] `docker compose up -d --build` 一条命令起服务,`docker compose ps` 显示 `healthy`。
- [ ] SQLite 模式与 Postgres 模式下 `scripts/smoke.py` 均为 **9 项 PASS**。
- [ ] 测试套件在 SQLite(默认)与 Postgres(`TEST_DATABASE_URL`)下均 **0 failed**。
- [ ] 按 `server/README.md` 从零照做一遍(新克隆目录、仅按文档操作)可以起服务并让客户端登录——由不是原作者的人或全新的 Agent 会话执行验证。
- [ ] `git status --short` 干净;`git log --oneline` 能看到每个阶段的提交。

---

## 可并行开发

> 前提:**阶段 1 的验收门槛已通过**(此时认证契约、路由文件骨架、测试夹具都已固定)。下面的并行方式不改变「每个阶段必须通过自己的验收门槛」这一规则,只是允许在同一时间推进多个互不依赖的任务。

**1. 阶段 2、3、4 的后端任务可以三路并行。**

| 并行线 | 任务 | 独占文件(互不重叠) |
|---|---|---|
| A | Task 2.1–2.3 配置快照与占位接口 | `routers/config_api.py`、`routers/stubs.py`、`static_config/`、`scripts/fetch_config.py`、对应测试 |
| B | Task 3.1 LLM 代理 | `routers/ai_chat.py`、`tests/test_ai_chat.py` |
| C | Task 4.1–4.4 Azure / TTS / Whisper / 冒烟脚本 | `azure.py`、`routers/{speech,ai_audio}.py`、`models.py`(仅追加 `SpeechToken`)、`alembic/versions/0002_*`、`scripts/smoke.py`、对应测试 |

合并注意:
- 阶段 1 已预先在 `main.py` 注册了全部路由模块,**并行线不需要改 `main.py`**。
- 只有 C 线会改 `models.py` 与迁移;A、B 线不新增表,因此不会产生迁移冲突。
- `tests/conftest.py` 已含所有上游的假地址与密钥(`llm.test`、`tts.test`、`whisper.test`、`az-secret`),三条线共用,**不要各自修改**;确需新增夹具时放进各自的测试文件。
- 各线完成后分别过自己的验收门槛 2 / 3 / 4;三个门槛都通过后再合并,并重跑一次 `uv run pytest -q`。

**2. 阶段 5 的客户端任务可以与阶段 2–4 并行。**

阶段 1 通过后,认证接口契约(`POST /api/users`、`POST /api/sessions`、`GET /api/me`)已固定,客户端不必等 AI 接口:

| 客户端任务 | 可开始的时间 | 能验证的时间 |
|---|---|---|
| Task 5.1 默认地址 + 基线 | 阶段 1 通过后 | 立即(只需 `/up` 与登录) |
| Task 5.2 移除 ActionCable | 阶段 1 通过后 | 立即 |
| Task 5.3 账号密码登录 | 阶段 1 通过后 | 立即 |
| Task 5.5 隐藏入口 / 锁定引擎 | 阶段 1 通过后 | 部分立即;配置相关项需阶段 2 |
| Task 5.4 STT 改服务端 Whisper | 阶段 1 通过后可写代码 | **需阶段 4 通过后才能验证** |
| Task 5.6 端到端清单 | — | **必须等阶段 2、3、4 全部通过** |

约束:客户端任务之间有文件交集(`i18n/*.json`、`preferences.tsx` 等),同一时间由**一个**工作者串行做完 5.1→5.5,不要拆给多人。

**3. 阶段 6 的部分任务可以提前。**

| 任务 | 可开始的时间 | 说明 |
|---|---|---|
| Task 6.1 Dockerfile | 阶段 1 通过后 | 只依赖 `pyproject.toml`、`app/`、`alembic/`;镜像里应包含后续阶段新增的文件,所以**最终仍要在阶段 4 通过后重建并复测** |
| Task 6.2 compose / `.env.example` | 阶段 1 通过后 | 环境变量以 `config.py` 为准;阶段 3、4 新增变量时同步更新 |
| Task 6.4 文档初稿 | 任何时候 | 只能写已验证的内容,收尾时据实修订 |
| Task 6.3 实机验证 | **必须等阶段 4、5 通过** | 需要完整功能与真实上游 |

**4. 不可并行的部分(必须串行)**

- 阶段 1 内部:1.1 → 1.2 → 1.3 → 1.4 → 1.5(后一项依赖前一项的接口)。
- 阶段 4 内部:4.1 → 4.2 → 4.3 → 4.4(4.2、4.3 依赖 4.1 的 `get_azure`)。
- 阶段 5 内部:见上,单人串行。
- 最终的 Task 5.6 与 Task 6.3 / 门槛 6:全部功能合并之后做。

**5. 并行时的分工建议**

阶段 1 通过后,可开 3 个独立的 Agent 会话(各自使用 `superpowers:using-git-worktrees` 的独立工作树与分支):

- Agent-1:A 线(阶段 2),完成后接 Task 6.2。
- Agent-2:B 线(阶段 3),完成后接 Task 6.1。
- Agent-3:C 线(阶段 4)。
- 你本人(或第 4 个 Agent):客户端 Task 5.1→5.5。

四条线合并回 `feat/self-hosted-backend` 的顺序:A → B → C → 客户端;每次合并后跑一次 `uv run pytest -q`,全部合并后再统一过门槛 5 与门槛 6。
