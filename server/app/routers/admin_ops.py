"""/api/admin/* 公告、维护、系统状态、日志、清理与备份(lane ops, E3-E5)。每个端点必须声明最低角色:Depends(require(...))。"""
from fastapi import APIRouter

router = APIRouter(prefix="/api/admin")
