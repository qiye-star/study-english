# 构建上下文是仓库根目录(见 docker-compose.yml);忽略规则在 server/Dockerfile.dockerignore。

FROM node:22-bookworm-slim AS web
WORKDIR /repo
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases ./.yarn/releases
COPY enjoy/package.json ./enjoy/package.json
COPY 1000-hours/package.json ./1000-hours/package.json
COPY 1000h-portal/package.json ./1000h-portal/package.json
COPY web/package.json ./web/package.json
# 只安装 web 的依赖(enjoy 的 Electron 依赖不需要)
RUN --mount=type=cache,target=/root/.yarn/berry/cache yarn workspaces focus web
COPY enjoy/src ./enjoy/src
COPY enjoy/tailwind.config.js ./enjoy/tailwind.config.js
COPY enjoy/assets/fonts ./enjoy/assets/fonts
COPY web ./web
RUN yarn workspace web build

FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
COPY server/pyproject.toml server/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project
COPY server/app ./app
COPY server/alembic ./alembic
COPY server/alembic.ini ./

FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /app /app
COPY --from=web /repo/web/dist /web/dist
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
RUN useradd --system --uid 10001 app && mkdir -p /data && chown app /data
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/up', timeout=3)"
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000 --workers 1 --ws-max-size 65536"]
