"""FastAPI dependencies that hand routers one cached vendor client per app (on `app.state`).

They live outside `app.providers` so vendor clients stay free of FastAPI imports (server layering,
tests/test_architecture.py)."""
from fastapi import Request

from app.providers.azure import AzureSpeech
from app.providers.xfyun import XfyunIse


def get_azure(request: Request) -> AzureSpeech:
    state = request.app.state
    if not hasattr(state, "azure"):
        s = state.settings
        state.azure = AzureSpeech(state.http, s.azure_speech_key, s.azure_speech_region)
    return state.azure


def get_xfyun(request: Request) -> XfyunIse:
    state = request.app.state
    if not hasattr(state, "xfyun"):
        s = state.settings
        state.xfyun = XfyunIse(
            s.xfyun_app_id, s.xfyun_api_key, s.xfyun_api_secret, s.xfyun_ws_url
        )
    return state.xfyun
