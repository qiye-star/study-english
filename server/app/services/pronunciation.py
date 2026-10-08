"""Pronunciation-assessment (iFlytek ISE) request limits shared by the speech router and realtime
calls."""
from fastapi import HTTPException

MAX_REFERENCE_CHARS = 2000
TIMEOUT_BASE_SECONDS = 30
TIMEOUT_CAP_SECONDS = 330


def _ise_entry(language: str) -> str:
    # English only for now: the result converter is validated against English
    # results; iFlytek's Chinese format (pinyin phones, other scores) differs.
    code = language.strip().lower()
    if code == "en" or code.startswith(("en-", "en_")):
        return "en_vip"
    raise HTTPException(400, "Unsupported language")
