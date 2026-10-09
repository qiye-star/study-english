"""/api/admin/* 提示词版本(lane prompts, G1-G4)。每个端点必须声明最低角色:Depends(require(...))。"""
from fastapi import APIRouter

router = APIRouter(prefix="/api/admin")
