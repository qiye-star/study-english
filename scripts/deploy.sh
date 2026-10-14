#!/usr/bin/env bash
# 本地一条命令部署:预检 -> 推送 -> SSH 到服务器 pull + compose build/up -> 健康检查。
# 配置见 scripts/deploy.env(模板 scripts/deploy.env.example)。
# 用法: scripts/deploy.sh [--skip-checks] [--dry-run]
#   --dry-run  只做本地分支/工作区检查,再用只读命令探测服务器(不 push、不 pull、不重建)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="$ROOT/scripts/deploy.env"
[ -f "$ENV_FILE" ] || { echo "缺少 $ENV_FILE,先 cp scripts/deploy.env.example scripts/deploy.env 并填写" >&2; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${DEPLOY_HOST:?deploy.env 缺少 DEPLOY_HOST}"
: "${DEPLOY_DIR:?deploy.env 缺少 DEPLOY_DIR}"
BRANCH="${DEPLOY_BRANCH:-main}"
REMOTE="${DEPLOY_REMOTE:-origin}"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:8000/up}"

SKIP_CHECKS=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --skip-checks) SKIP_CHECKS=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "未知参数: $arg" >&2; exit 1 ;;
  esac
done

current="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current" != "$BRANCH" ]; then
  echo "当前分支是 $current,服务器跑的是 $BRANCH。先合并到 $BRANCH 并切过去再部署。" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "工作区不干净,拒绝部署。先提交或 stash:" >&2
  git status --short >&2
  exit 1
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "==> dry-run: 只读探测 $DEPLOY_HOST:$DEPLOY_DIR(不会改动服务器)"
  ssh "$DEPLOY_HOST" bash -s <<DRY_SCRIPT
set -u
cd '$DEPLOY_DIR' || { echo "目录不存在: $DEPLOY_DIR" >&2; exit 1; }
echo "服务器分支: \$(git rev-parse --abbrev-ref HEAD)  提交: \$(git rev-parse --short HEAD)"
echo "已跟踪文件的未提交改动(应为空):"; git status --porcelain --untracked-files=no
for f in docker-compose.yml server/.env; do [ -f "\$f" ] && echo "存在: \$f" || echo "缺少: \$f"; done
docker compose config -q && echo "compose 配置有效" || echo "compose 配置有误"
curl -fsS '$HEALTH_URL' >/dev/null 2>&1 && echo "当前健康检查通过: $HEALTH_URL" || echo "当前健康检查未通过: $HEALTH_URL"
DRY_SCRIPT
  echo "==> dry-run 结束,本地提交: $(git rev-parse --short HEAD)"
  exit 0
fi

if [ "$SKIP_CHECKS" -eq 0 ]; then
  echo "==> server: pytest"
  (cd server && uv run pytest -q)
  echo "==> web: typecheck + test"
  yarn web:typecheck
  yarn web:test
else
  echo "==> 跳过预检 (--skip-checks)"
fi

echo "==> push $REMOTE $BRANCH"
git push "$REMOTE" "$BRANCH"

echo "==> 部署到 $DEPLOY_HOST:$DEPLOY_DIR"
# 变量在本地展开后传给远端;compose 文件和 server/.env 未跟踪,pull 不会动它们。
ssh "$DEPLOY_HOST" bash -s <<REMOTE_SCRIPT
set -euo pipefail
cd '$DEPLOY_DIR'
git fetch '$REMOTE' '$BRANCH'
git merge --ff-only 'FETCH_HEAD'
docker compose up -d --build
docker image prune -f >/dev/null
for i in \$(seq 1 30); do
  if curl -fsS '$HEALTH_URL' >/dev/null 2>&1; then
    echo "健康检查通过: $HEALTH_URL"
    exit 0
  fi
  sleep 2
done
echo "健康检查失败,最近日志:" >&2
docker compose logs --tail=50 server >&2
exit 1
REMOTE_SCRIPT

echo "==> 部署完成 ($(git rev-parse --short HEAD))"
