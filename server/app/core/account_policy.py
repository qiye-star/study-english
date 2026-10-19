"""Account policy decisions that need only settings (INDEX X33): stdlib + Settings, no services, no email details."""
from datetime import datetime
from typing import Literal

from app.core.config import Settings

BindingState = Literal["none", "pending", "enforced"]


def binding_state(settings: Settings, now: datetime) -> BindingState:
    """`none` while the switch is off; `pending` until the deadline; `enforced` from the deadline on (an empty
    deadline means at once). `now` must be timezone-aware. Read per request, never cached (INDEX X12)."""
    if not settings.email_binding_required:
        return "none"
    deadline = settings.email_binding_deadline_at
    return "pending" if deadline is not None and now < deadline else "enforced"


def binding_deadline(settings: Settings) -> str | None:
    """The configured deadline as an ISO string, or None when the switch is off or no deadline is set."""
    deadline = settings.email_binding_deadline_at
    return deadline.isoformat() if settings.email_binding_required and deadline is not None else None
