"""托管 admin/dist(管理端 SPA)于 /admin。必须在 web(全站 SPA 回退)之前注册。"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.core.config import Settings
from app.core.deps import get_settings
from app.routers.web import spa_response

router = APIRouter()

# server/app/routers/admin_web.py → 仓库根/admin/dist;镜像内 /app/app/routers/admin_web.py → /admin/dist
DEFAULT_DIST = Path(__file__).resolve().parents[3] / "admin" / "dist"


def admin_dist_dir(settings: Settings) -> Path:
    return Path(settings.admin_dist_dir) if settings.admin_dist_dir else DEFAULT_DIST


@router.api_route("/admin", methods=["GET", "HEAD"], include_in_schema=False)
@router.api_route("/admin/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
async def admin_app(path: str = "", settings: Settings = Depends(get_settings)):
    if not settings.admin_enabled:
        raise HTTPException(404, "Not Found")
    return spa_response(admin_dist_dir(settings), path)
