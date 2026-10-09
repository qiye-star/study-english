"""/api/admin/* 管理员账号与会话(lane settings, B5)。每个端点必须声明最低角色:Depends(require(...))。"""
from fastapi import APIRouter

router = APIRouter(prefix="/api/admin")
