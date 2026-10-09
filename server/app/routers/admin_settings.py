"""/api/admin/settings*:运行时设置(spec §3)。业务在 app/admin/settings_service.py。
每个端点声明最低角色:Depends(require(...))。危险修改的二次验证/理由/输入确认由服务层按值判定(403 Step-up required)。"""
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin import audit, doctor, probes, settings_service as svc
from app.admin.perms import AdminContext, require, step_up_until
from app.core.deps import get_session
from app.core.runtime_settings import OverrideError, compose
from app.core.settings_registry import SPECS

router = APIRouter(prefix="/api/admin")
MAX_IMPORT_BYTES = 256 * 1024


def stepped_up(ctx: AdminContext, settings, now: datetime | None = None) -> bool:
    return step_up_until(settings, ctx.session) is not None


def _error(exc: svc.SettingsError) -> JSONResponse:
    body: dict[str, Any] = {"error": exc.error}
    if exc.fields:
        body["fields"] = exc.fields
    if exc.details:
        body["details"] = exc.details
    return JSONResponse(body, status_code=exc.status)


def _result(r: svc.SaveResult) -> dict:
    return {"revision": r.revision, "changed": r.changed, "pending_restart": r.pending_restart,
            "apply_errors": r.apply_errors}


def _totp_guard(ctx: AdminContext, changes: dict) -> None:
    """Spec §3.2: switching ADMIN_REQUIRE_TOTP on needs the acting superadmin to have TOTP bound already."""
    if changes.get("admin_require_totp") is True and not ctx.totp_enabled:
        raise svc.SettingsError(409, "Bind TOTP first", fields={"admin_require_totp": "Bind TOTP first"})


class PatchIn(BaseModel):
    changes: dict[str, Any] = Field(min_length=1, max_length=100)
    reason: str = Field("", max_length=200)
    confirm: str | None = Field(None, max_length=64)
    confirm_pairs: list[str] = Field(default_factory=list, max_length=20)


class RevertIn(BaseModel):
    reason: str = Field("", max_length=200)
    confirm: str | None = Field(None, max_length=64)
    acknowledge_conflicts: bool = False


class ImportApplyIn(BaseModel):
    payload: dict[str, Any]
    reason: str = Field("", max_length=200)
    confirm: str | None = Field(None, max_length=64)


@router.get("/settings")
async def list_settings(request: Request, _: AdminContext = Depends(require("viewer")),
                        session: AsyncSession = Depends(get_session)):
    return await svc.list_settings(session, request.app)


@router.patch("/settings")
async def patch_settings(body: PatchIn, request: Request, ctx: AdminContext = Depends(require("superadmin")),
                         session: AsyncSession = Depends(get_session)):
    try:
        _totp_guard(ctx, body.changes)
        result = await svc.save(session, request.app, ctx.actor, body.changes, reason=body.reason,
                                confirm=body.confirm, confirm_pairs=body.confirm_pairs,
                                stepped_up=stepped_up(ctx, request.app.state.settings))
    except svc.SettingsError as exc:
        return _error(exc)
    return _result(result)


@router.delete("/settings/{key}")
async def reset_setting(key: str, request: Request, reason: str = Query("", max_length=200),
                        confirm: str | None = Query(None, max_length=64),
                        ctx: AdminContext = Depends(require("superadmin")),
                        session: AsyncSession = Depends(get_session)):
    try:
        result = await svc.save(session, request.app, ctx.actor, {key[:64]: None}, reason=reason, confirm=confirm,
                                stepped_up=stepped_up(ctx, request.app.state.settings), action="settings.reset")
    except svc.SettingsError as exc:
        return _error(exc)
    return _result(result)


@router.get("/settings/revisions")
async def list_revisions(before_id: int | None = Query(None, ge=1), limit: int = Query(30, ge=1, le=100),
                         _: AdminContext = Depends(require("viewer")), session: AsyncSession = Depends(get_session)):
    return await svc.list_revisions(session, before_id=before_id, limit=limit)


@router.post("/settings/revisions/{revision_id}/revert")
async def revert_revision(revision_id: int, body: RevertIn, request: Request,
                          ctx: AdminContext = Depends(require("superadmin")),
                          session: AsyncSession = Depends(get_session)):
    try:
        result = await svc.revert(session, request.app, ctx.actor, revision_id, reason=body.reason,
                                  confirm=body.confirm, stepped_up=stepped_up(ctx, request.app.state.settings),
                                  acknowledge_conflicts=body.acknowledge_conflicts)
    except svc.SettingsError as exc:
        return _error(exc)
    return _result(result)


@router.get("/settings/export")
async def export_settings(request: Request, ctx: AdminContext = Depends(require("superadmin")),
                          session: AsyncSession = Depends(get_session)):
    data = await svc.export_overrides(session, request.app)
    await audit.record(session, ctx.actor, "settings.export", target_type="setting",
                       summary=f"{len(data['overrides'])} override(s)")
    await session.commit()
    name = f"enjoy-settings-{datetime.now(timezone.utc):%Y%m%d}.json"
    return JSONResponse(data, headers={"Content-Disposition": f'attachment; filename="{name}"',
                                       "Cache-Control": "no-store"})


@router.post("/settings/import/preview")
async def import_preview(request: Request, _: AdminContext = Depends(require("superadmin")),
                         session: AsyncSession = Depends(get_session)):
    raw = await request.body()
    if len(raw) > MAX_IMPORT_BYTES:
        return JSONResponse({"error": "File too large"}, status_code=413)
    try:
        payload = json.loads(raw)
        return await svc.import_preview(session, request.app, payload)
    except ValueError:
        return JSONResponse({"error": "Unsupported file"}, status_code=400)
    except svc.SettingsError as exc:
        return _error(exc)


@router.get("/doctor")
async def get_doctor(request: Request, _: AdminContext = Depends(require("viewer")),
                     session: AsyncSession = Depends(get_session)):
    facts = await doctor.gather_facts(session, request.app)
    return {"findings": [doctor.finding_out(f) for f in doctor.diagnose(request.app.state.settings, facts)]}


class ProbeIn(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict, max_length=20)
    allow_cost: bool = False
    confirm_pairs: list[str] = Field(default_factory=list, max_length=20)


@router.post("/probes/{upstream}")
async def run_probe(upstream: str, request: Request, body: ProbeIn | None = None,
                    ctx: AdminContext = Depends(require("superadmin")), session: AsyncSession = Depends(get_session)):
    """Test an upstream with the saved values or with unsaved form values (an empty secret = keep the saved one)."""
    if upstream not in probes.UPSTREAMS:
        return JSONResponse({"error": "Unknown upstream"}, status_code=404)
    body = body or ProbeIn()
    current = request.app.state.settings
    values = {k: v for k, v in body.values.items() if not (k in SPECS and SPECS[k].secret and v in ("", None))}
    candidate = current
    if values:
        bad = [k for k in values if k not in SPECS or SPECS[k].env_only]
        if bad:
            return JSONResponse({"error": "Setting is read-only", "fields": {k[:64]: "Setting is read-only"
                                                                             for k in bad}}, status_code=400)
        try:
            candidate = compose(current, values)
        except OverrideError as exc:
            return JSONResponse({"error": "Invalid settings", "fields": exc.fields}, status_code=422)
        # The saved key may go to an unsaved endpoint only with the same step-up a save would need (review M2).
        if svc.pair_violations(values, current) and not stepped_up(ctx, current):
            return JSONResponse({"error": "Step-up required"}, status_code=403)
        pairs = [k for k in svc.pair_violations(values, current) if k not in set(body.confirm_pairs)]
        if pairs:
            return JSONResponse({"error": "Key would be sent to a new host",
                                 "details": {"pairs": pairs, "hosts": svc.pair_hosts(values, pairs)}},
                                status_code=409)
    result = await probes.probe(candidate, upstream, allow_cost=body.allow_cost)
    await audit.record(session, ctx.actor, "probe.run", target_type="upstream", target_id=upstream,
                       summary=result.code, result="ok" if result.ok else "error")
    await session.commit()
    return result.out()


@router.post("/settings/import/apply")
async def import_apply(body: ImportApplyIn, request: Request, ctx: AdminContext = Depends(require("superadmin")),
                       session: AsyncSession = Depends(get_session)):
    if len(json.dumps(body.payload, ensure_ascii=False).encode()) > MAX_IMPORT_BYTES:
        return JSONResponse({"error": "File too large"}, status_code=413)
    try:
        overrides = body.payload.get("overrides")
        _totp_guard(ctx, {str(k).lower(): v for k, v in overrides.items()} if isinstance(overrides, dict) else {})
        result = await svc.import_apply(session, request.app, ctx.actor, body.payload, reason=body.reason,
                                        confirm=body.confirm, stepped_up=stepped_up(ctx, request.app.state.settings))
    except svc.SettingsError as exc:
        return _error(exc)
    return _result(result)
