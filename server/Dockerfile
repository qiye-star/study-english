# 构建上下文是仓库根目录(见 docker-compose.example.yml;实际使用的 docker-compose.yml 不进 git);忽略规则在 server/Dockerfile.dockerignore。
#
# 国内镜像:下面三个构建参数默认指向国内源(apt: 清华 TUNA;PyPI: 清华 TUNA;npm: npmmirror,TUNA 不提供 npm)。
# 海外构建或镜像不可用时传空字符串即可改回官方源,例如 `docker compose build --build-arg PYPI_INDEX= --build-arg NPM_REGISTRY= --build-arg APT_MIRROR=`
# (或在 docker-compose.yml 的 build.args 里写)。基础镜像(Docker Hub)走的是 Docker 守护进程的 registry-mirrors,不在这里设置;
# 要从镜像仓库拉取时用 NODE_IMAGE / PYTHON_IMAGE 覆盖镜像名。
ARG NODE_IMAGE=node:22-bookworm-slim
ARG PYTHON_IMAGE=python:3.12-slim
ARG APT_MIRROR=mirrors.tuna.tsinghua.edu.cn
ARG PYPI_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple
ARG NPM_REGISTRY=https://registry.npmmirror.com

FROM ${NODE_IMAGE} AS web
ARG NPM_REGISTRY
WORKDIR /repo
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases ./.yarn/releases
COPY enjoy/package.json ./enjoy/package.json
COPY 1000-hours/package.json ./1000-hours/package.json
COPY 1000h-portal/package.json ./1000h-portal/package.json
COPY web/package.json ./web/package.json
COPY admin/package.json ./admin/package.json
# 只安装 web 的依赖(enjoy 的 Electron 依赖不需要);yarn.lock 里只有版本和校验和,下载地址由 YARN_NPM_REGISTRY_SERVER 决定
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    if [ -n "$NPM_REGISTRY" ]; then export YARN_NPM_REGISTRY_SERVER="$NPM_REGISTRY"; fi && \
    yarn workspaces focus web
COPY enjoy/src ./enjoy/src
COPY enjoy/tailwind.config.js ./enjoy/tailwind.config.js
COPY enjoy/assets/fonts ./enjoy/assets/fonts
COPY web ./web
RUN yarn workspace web build

FROM ${NODE_IMAGE} AS admin
ARG NPM_REGISTRY
WORKDIR /repo
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases ./.yarn/releases
COPY enjoy/package.json ./enjoy/package.json
COPY 1000-hours/package.json ./1000-hours/package.json
COPY 1000h-portal/package.json ./1000h-portal/package.json
COPY web/package.json ./web/package.json
COPY admin/package.json ./admin/package.json
# 管理端完全独立,只装它自己的依赖
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    if [ -n "$NPM_REGISTRY" ]; then export YARN_NPM_REGISTRY_SERVER="$NPM_REGISTRY"; fi && \
    yarn workspaces focus admin
COPY admin ./admin
RUN yarn workspace admin build

FROM ${PYTHON_IMAGE} AS builder
ARG PYPI_INDEX
# uv 用 pip 装(不再从 ghcr.io 拉镜像,国内常常很慢);Python 用基础镜像自带的,不让 uv 另外下载
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install uv==0.12.5 ${PYPI_INDEX:+--index-url ${PYPI_INDEX}}
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY server/pyproject.toml server/uv.lock ./
# uv.lock 里记的是 pypi.org / files.pythonhosted.org 的地址,`uv sync --frozen` 会直接去那里下载;
# 所以先按锁文件导出(带哈希,版本和哈希与 sync 完全一致),再从镜像安装,哈希照常校验
RUN --mount=type=cache,target=/root/.cache/uv \
    uv export --frozen --no-dev --no-emit-project --no-header -o /tmp/requirements.txt && \
    uv venv /app/.venv && \
    uv pip install --python /app/.venv/bin/python --require-hashes -r /tmp/requirements.txt \
        ${PYPI_INDEX:+--default-index ${PYPI_INDEX}}
COPY server/app ./app
COPY server/alembic ./alembic
COPY server/alembic.ini ./

FROM ${PYTHON_IMAGE}
ARG APT_MIRROR
WORKDIR /app
# ffmpeg + ffprobe for the media library (spec 2026-10-13-video-import §7.3); installed as root, before privileges are dropped
# APT_MIRROR 非空时把 Debian 官方源(含 security)换成镜像;http 即可,apt 本身校验签名
RUN if [ -n "$APT_MIRROR" ]; then \
      for f in /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list; do \
        if [ -f "$f" ]; then sed -i "s#deb.debian.org#${APT_MIRROR}#g; s#security.debian.org/debian-security#${APT_MIRROR}/debian-security#g; s#security.debian.org#${APT_MIRROR}/debian-security#g" "$f"; fi; \
      done; \
    fi && \
    apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app /app
COPY server/dictionaries /app/dictionaries
COPY docs/changelog /app/changelog
COPY --from=web /repo/web/dist /web/dist
COPY --from=admin /repo/admin/dist /admin/dist
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
RUN useradd --system --uid 10001 app && mkdir -p /data && chown app /data
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/up', timeout=3)"
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000 --workers 1 --ws-max-size 65536"]
