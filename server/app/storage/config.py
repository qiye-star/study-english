"""Builds the stores from settings and installs them on the app (plan 2026-10-21-l1-object-storage, R9).

Profiles: "local" (the data directory), "s3" (STORAGE_BACKEND, S3_*) and "s3_fallback" (STORAGE_FALLBACK,
S3_FALLBACK_*). Error messages name environment variables only, never their values.
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.storage.base import BlobStore, StorageError
from app.storage.local import LocalStore
from app.storage.s3 import S3Store

PROFILES = ("local", "s3", "s3_fallback")
_REQUIRED = ("bucket", "access_key", "secret_key")


def _s3_settings(settings, profile: str) -> dict:
    prefix = "s3_fallback_" if profile == "s3_fallback" else "s3_"
    return {
        "endpoint": getattr(settings, f"{prefix}endpoint"),
        "bucket": getattr(settings, f"{prefix}bucket"),
        "access_key": getattr(settings, f"{prefix}access_key"),
        "secret_key": getattr(settings, f"{prefix}secret_key"),
        "region": getattr(settings, f"{prefix}region"),
        "path_style": getattr(settings, f"{prefix}path_style"),
    }


def _env_name(profile: str, field: str) -> str:
    stem = "S3_FALLBACK_" if profile == "s3_fallback" else "S3_"
    return stem + field.upper()


def validate(settings) -> None:
    """Refuse bad storage settings at startup. Messages name the variables, never the values."""
    if settings.storage_fallback:
        raise RuntimeError("storage: the read fallback is not available yet")
    if settings.storage_backend == "s3":
        values = _s3_settings(settings, "s3")
        for field in _REQUIRED:
            if not values[field]:
                raise RuntimeError(f"storage: {_env_name('s3', field)} is required")


def build_store(settings, profile: str) -> BlobStore:
    if profile == "local":
        return LocalStore(settings.resolved_data_dir)
    if profile not in ("s3", "s3_fallback"):
        raise RuntimeError("storage: unknown profile")
    values = _s3_settings(settings, profile)
    for field in _REQUIRED:
        if not values[field]:
            raise RuntimeError(f"storage: {_env_name(profile, field)} is required")
    return S3Store.from_settings(**values)


async def _storage_error(_: Request, exc: StorageError) -> JSONResponse:
    if exc.code == "not_found":
        return JSONResponse({"error": "Not Found"}, status_code=404)
    if exc.code == "unavailable":
        return JSONResponse({"error": "Storage unavailable"}, status_code=503)
    return JSONResponse({"error": "Storage error"}, status_code=500)


def install(app: FastAPI) -> None:
    """Called from `create_app` before the library installs. `get_store(app)` reads `app.state.storage` each time."""
    settings = app.state.settings
    validate(settings)
    app.state.storage = build_store(settings, settings.storage_backend)
    app.add_exception_handler(StorageError, _storage_error)
