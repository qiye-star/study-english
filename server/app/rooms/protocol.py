"""Room WebSocket protocol (spec 2026-10-09 §7.3). web/src/features/rooms/protocol.ts mirrors this file
field for field; its test reads the constants below from this file. Wire JSON is snake_case.
Validation is strict and bounded: unknown types/fields, wrong types and oversize frames raise ProtocolError
(the caller closes with 4400)."""
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

CLOSE_NORMAL = 1000
CLOSE_RESTART = 1012
CLOSE_UNAUTHORIZED = 4001
CLOSE_DISABLED = 4003
CLOSE_NOT_FOUND = 4004
CLOSE_KICKED = 4010
CLOSE_BUSY = 4029
CLOSE_PROTOCOL = 4400
CLOSE_REASONS: dict[int, str] = {
    CLOSE_NORMAL: "normal", CLOSE_RESTART: "restart", CLOSE_UNAUTHORIZED: "unauthorized",
    CLOSE_DISABLED: "disabled", CLOSE_NOT_FOUND: "not_found", CLOSE_KICKED: "kicked",
    CLOSE_BUSY: "busy", CLOSE_PROTOCOL: "protocol",
}
MAX_CLIENT_TEXT = 8192
MAX_SAY_RAW = 2000
MAX_ASSIST_TEXT = 500
MAX_ID = 64
HELLO_TIMEOUT = 10.0

SERVER_EVENT_TYPES = (
    "welcome", "message", "ack", "presence", "ai_typing", "ai_failed", "assist_reply", "assist_failed",
    "room_update", "notice", "error", "closed", "pong", "message_hidden",
)
ERROR_CODES = ("rate_limited", "empty", "bad_assist")
NOTICE_CODES = ("ai_off", "ai_busy", "ai_quota")
AI_FAILED_CODES = ("upstream", "quota", "restart")
ASSIST_FAILED_CODES = ("upstream", "quota", "format")


class ProtocolError(Exception):
    pass


class _Msg(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class HelloMsg(_Msg):
    type: Literal["hello"]
    last_seq: int = Field(ge=0)


class SayMsg(_Msg):
    type: Literal["say"]
    client_id: str = Field(min_length=1, max_length=MAX_ID)
    text: str = Field(min_length=1, max_length=MAX_SAY_RAW)
    assist_id: str | None = Field(None, max_length=MAX_ID)


class AssistMsg(_Msg):
    type: Literal["assist"]
    request_id: str = Field(min_length=1, max_length=MAX_ID)
    text: str = Field(min_length=1, max_length=MAX_ASSIST_TEXT)


class PingMsg(_Msg):
    type: Literal["ping"]


ClientMessage = Annotated[Union[HelloMsg, SayMsg, AssistMsg, PingMsg], Field(discriminator="type")]
_ADAPTER: TypeAdapter = TypeAdapter(ClientMessage)


def parse_client_message(raw: str) -> HelloMsg | SayMsg | AssistMsg | PingMsg:
    if len(raw) > MAX_CLIENT_TEXT:
        raise ProtocolError("frame too large")
    try:
        return _ADAPTER.validate_json(raw)
    except ValidationError:
        raise ProtocolError("invalid message") from None


def event(type_: str, **fields) -> dict:
    if type_ not in SERVER_EVENT_TYPES:
        raise ValueError(f"unknown event type {type_!r}")
    return {"type": type_, **fields}
