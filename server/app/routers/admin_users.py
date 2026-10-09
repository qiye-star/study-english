"""/api/admin/* 用户治理、配额与邀请码(lane community, D1-D3)。每个端点必须声明最低角色:Depends(require(...))。"""
from fastapi import APIRouter

router = APIRouter(prefix="/api/admin")
