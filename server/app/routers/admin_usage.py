"""/api/admin/* 用量与费用(lane ops, E2)。每个端点必须声明最低角色:Depends(require(...))。"""
from fastapi import APIRouter

router = APIRouter(prefix="/api/admin")
