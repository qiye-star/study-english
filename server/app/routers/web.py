"""托管 web/dist(手机网页版)。必须最后注册:/api/** 与其他真实路由优先。"""

import mimetypes
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.config import Settings
from app.deps import get_settings

# Windows 注册表可能把 .js 映射成 text/plain,显式指定。
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/manifest+json", ".webmanifest")

router = APIRouter()

# VAD 运行时(onnxruntime-web)用 import() 加载 .mjs:非 JS 类型时浏览器拒绝执行模块脚本,VAD 加载失败。
# 精简镜像没有 /etc/mime.types,不能依赖系统表,按扩展名显式给出。
EXPLICIT_TYPES = {".mjs": "text/javascript", ".wasm": "application/wasm"}

# server/app/routers/web.py → 仓库根/web/dist;镜像内 /app/app/routers/web.py → /web/dist
DEFAULT_DIST = Path(__file__).resolve().parents[3] / "web" / "dist"
IMMUTABLE = "public, max-age=31536000, immutable"
NO_CACHE = "no-cache"


def dist_dir(settings: Settings) -> Path:
    return Path(settings.web_dist_dir) if settings.web_dist_dir else DEFAULT_DIST


def spa_response(root: Path, path: str) -> FileResponse:
    """root 下的静态文件;assets/ 外的未知路径回退到 index.html(SPA)。含目录逃逸防护。"""
    root = root.resolve()
    index = root / "index.html"
    if not index.is_file():
        raise HTTPException(404, "Web app is not built")
    if path:
        try:
            candidate = (root / path).resolve()
            is_file = candidate.is_relative_to(root) and candidate.is_file()
        except (ValueError, OSError):
            is_file = False
        if is_file:
            cache = IMMUTABLE if path.startswith("assets/") else NO_CACHE
            return FileResponse(candidate, headers={"Cache-Control": cache}, media_type=EXPLICIT_TYPES.get(candidate.suffix))
        if path.startswith("assets/"):
            raise HTTPException(404, "Not Found")
    return FileResponse(index, headers={"Cache-Control": NO_CACHE})


@router.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def web_app(path: str, settings: Settings = Depends(get_settings)):
    if path == "api" or path.startswith("api/"):
        raise HTTPException(404, "Not Found")
    return spa_response(dist_dir(settings), path)
