"""/api/admin/prompts* 提示词版本(lane prompts, G1–G4;spec §11)。每个端点声明最低角色:Depends(require(...))。

正文、试运行样例与输出只出现在请求/响应里,不写日志与审计。
"""
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import prompts_admin as pa
from app.admin.perms import AdminContext, require, require_step_up
from app.core.deps import get_session

router = APIRouter(prefix="/api/admin")


class DraftCreateIn(BaseModel):
    from_version: int | None = None


class DraftIn(BaseModel):
    body: str = Field(max_length=250_000)
    note: str = Field("", max_length=200)


class PublishIn(BaseModel):
    reason: str = Field(max_length=200)

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("reason is required")
        return v.strip()


class TestIn(BaseModel):
    body: str = Field(max_length=250_000)
    sample: dict[str, str] = Field(default_factory=dict, max_length=8)


def _error(exc: pa.PromptError) -> JSONResponse:
    payload: dict = {"error": exc.error}
    if exc.details is not None:
        payload["details"] = exc.details
    return JSONResponse(payload, status_code=exc.status)


@router.get("/prompts")
async def list_prompts(_: AdminContext = Depends(require("viewer")), session: AsyncSession = Depends(get_session)):
    return await pa.overview(session)


@router.get("/prompts/{key}")
async def get_prompt(key: str, request: Request, _: AdminContext = Depends(require("viewer")),
                     session: AsyncSession = Depends(get_session)):
    try:
        return await pa.detail(session, request.app, key)
    except pa.PromptError as exc:
        return _error(exc)


@router.post("/prompts/{key}/draft", status_code=201)
async def create_draft(key: str, payload: DraftCreateIn, request: Request,
                       ctx: AdminContext = Depends(require("operator")), session: AsyncSession = Depends(get_session)):
    try:
        return await pa.create_draft(session, request.app, ctx.actor, key, from_version=payload.from_version)
    except pa.PromptError as exc:
        return _error(exc)


@router.put("/prompts/{key}/draft")
async def save_draft(key: str, payload: DraftIn, ctx: AdminContext = Depends(require("operator")),
                     session: AsyncSession = Depends(get_session)):
    try:
        return await pa.save_draft(session, ctx.actor, key, payload.body, payload.note)
    except pa.PromptError as exc:
        return _error(exc)


@router.delete("/prompts/{key}/draft", status_code=204)
async def delete_draft(key: str, ctx: AdminContext = Depends(require("operator")),
                       session: AsyncSession = Depends(get_session)):
    try:
        await pa.delete_draft(session, ctx.actor, key)
    except pa.PromptError as exc:
        return _error(exc)
    return Response(status_code=204)


@router.post("/prompts/{key}/draft/publish")
async def publish(key: str, payload: PublishIn, request: Request, ctx: AdminContext = Depends(require_step_up),
                  session: AsyncSession = Depends(get_session)):
    try:
        return {"version": await pa.publish(session, request.app, ctx.actor, key, reason=payload.reason)}
    except pa.PromptError as exc:
        return _error(exc)


@router.post("/prompts/{key}/test")
async def test_prompt(key: str, payload: TestIn, request: Request, ctx: AdminContext = Depends(require("superadmin")),
                      session: AsyncSession = Depends(get_session)):
    try:
        return await pa.test_run(session, request.app, ctx.actor, key, payload.body, payload.sample)
    except pa.PromptError as exc:
        return _error(exc)
