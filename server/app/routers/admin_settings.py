"""/api/admin/* 运行时设置、诊断与测试连接(lane settings, B2/B3)。每个端点必须声明最低角色:Depends(require(...))。"""
from fastapi import APIRouter

router = APIRouter(prefix="/api/admin")
