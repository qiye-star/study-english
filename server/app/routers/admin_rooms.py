"""/api/admin/* 房间治理与举报(lane community, D4);房间运行时经 app.routers.rooms.runtime(app) 获取。每个端点必须声明最低角色:Depends(require(...))。"""
from fastapi import APIRouter

router = APIRouter(prefix="/api/admin")
