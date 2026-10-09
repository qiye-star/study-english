"""/api/admin/* 段位规则与段位操作(lane rank, C5)。每个端点必须声明最低角色:Depends(require(...))。"""
from fastapi import APIRouter

router = APIRouter(prefix="/api/admin")
