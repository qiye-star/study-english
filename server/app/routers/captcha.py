"""人机验证的两个公开端点(spec 2026-10-20-captcha-altcha §6.1、§6.2;计划 S8)。

- `GET /api/captcha/config`:`{"mode": ...}`,无计算、不限流。
- `GET /api/captcha/challenge`:签发一个 ALTCHA v2 挑战,按 IP 每分钟限流。
没有查询参数(隐私:没有东西进 URL);不记录任何载荷、签名、nonce 或密钥。
"""
import asyncio
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from app.core import captcha
from app.core.deps import client_ip
from app.routers.captcha_guard import CAPTCHA_NOT_CONFIGURED, CAPTCHA_OFF

router = APIRouter(prefix="/api/captcha")

NO_STORE = {"Cache-Control": "no-store"}
LIMITED = "Too many requests, please try again later"  # 与其他端点的现有文案一致


@router.get("/config")
async def captcha_config(request: Request) -> JSONResponse:
    return JSONResponse({"mode": request.app.state.settings.captcha_mode}, headers=NO_STORE)


@router.get("/challenge")
async def captcha_challenge(request: Request) -> JSONResponse:
    s = request.app.state.settings  # 每次请求读取(热改)
    if s.captcha_mode == "off":
        raise HTTPException(404, CAPTCHA_OFF)
    if not s.captcha_secret:
        raise HTTPException(503, CAPTCHA_NOT_CONFIGURED)
    ip = client_ip(request)
    if not request.app.state.captcha_limiter.allow(ip):
        raise HTTPException(429, LIMITED)
    flagged = request.app.state.login_failures.ip_flagged(ip)  # R-C15:被标记的 IP 拿到更难的挑战
    counter = captcha.pick_counter(s.captcha_counter_max, s.captcha_flagged_multiplier, flagged)
    body = await asyncio.to_thread(
        captcha.issue, s.captcha_secret, cost=s.captcha_cost, counter=counter,
        ttl=s.captcha_ttl_seconds, now=int(time.time()))
    return JSONResponse(body, headers=NO_STORE)
