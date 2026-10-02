from fastapi import HTTPException

AUTH_FAILURE_STATUSES = {401, 403}


def check_upstream_auth(status_code: int) -> None:
    """Upstream credential failures are our problem, not the client's session: map to 502."""
    if status_code in AUTH_FAILURE_STATUSES:
        raise HTTPException(502, "Upstream authentication failed")
