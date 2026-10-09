"""Room WebSocket protocol (spec 2026-10-09 §7.3). web/src/features/rooms/protocol.ts mirrors this file
field for field; its test reads the constants below from this file. Wire JSON is snake_case.
Validation is strict and bounded: unknown types/fields, wrong types and oversize frames raise ProtocolError
(the caller closes with 4400).

Protocol v2 (spec 2026-10-10 §9, R2-16) only adds: `hello.v` (default 1), `say.reply_to`, the client messages
`typing / react / voice_translate / voice_retry`, five server events and new codes. v1 and v2 clients get the same
frames; `welcome.protocol` tells the web which version the server speaks."""
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
MAX_SEQ = 2**31 - 1
PROTOCOL_VERSION = 2
# Lowercase, no underscores: the web camelcases object keys, so reactions travel as [{key, user_ids}] (R2-15).
REACTION_KEYS = ("like", "love", "haha", "wow", "clap", "thanks")
ACTIVITY_STATES = ("typing", "recording", "idle")

SERVER_EVENT_TYPES = (
    "welcome", "message", "ack", "presence", "ai_typing", "ai_failed", "assist_reply", "assist_failed",
    "room_update", "notice", "error", "closed", "pong", "message_hidden",
    "activity", "reaction", "voice_update", "join_request", "join_request_closed",
)
ERROR_CODES = ("rate_limited", "empty", "bad_assist", "bad_reply", "bad_seq")
NOTICE_CODES = ("ai_off", "ai_busy", "ai_quota", "voice_off", "voice_quota", "translate_quota", "retry_limit")
AI_FAILED_CODES = ("upstream", "quota", "restart")
ASSIST_FAILED_CODES = ("upstream", "quota", "format")


class ProtocolError(Exception):
    pass


class _Msg(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class HelloMsg(_Msg):
    type: Literal["hello"]
    last_seq: int = Field(ge=0)
    v: Literal[1, 2] = 1


class SayMsg(_Msg):
    type: Literal["say"]
    client_id: str = Field(min_length=1, max_length=MAX_ID)
    text: str = Field(min_length=1, max_length=MAX_SAY_RAW)
    assist_id: str | None = Field(None, max_length=MAX_ID)
    reply_to: int | None = Field(None, ge=1, le=MAX_SEQ)


class AssistMsg(_Msg):
    type: Literal["assist"]
    request_id: str = Field(min_length=1, max_length=MAX_ID)
    text: str = Field(min_length=1, max_length=MAX_ASSIST_TEXT)


class PingMsg(_Msg):
    type: Literal["ping"]


class TypingMsg(_Msg):
    type: Literal["typing"]
    state: Literal["typing", "recording", "idle"]


class ReactMsg(_Msg):
    type: Literal["react"]
    seq: int = Field(ge=1, le=MAX_SEQ)
    key: Literal["like", "love", "haha", "wow", "clap", "thanks"]
    on: bool


class VoiceTranslateMsg(_Msg):
    type: Literal["voice_translate"]
    seq: int = Field(ge=1, le=MAX_SEQ)


class VoiceRetryMsg(_Msg):
    type: Literal["voice_retry"]
    seq: int = Field(ge=1, le=MAX_SEQ)


AnyClientMessage = Union[HelloMsg, SayMsg, AssistMsg, PingMsg, TypingMsg, ReactMsg, VoiceTranslateMsg, VoiceRetryMsg]
ClientMessage = Annotated[AnyClientMessage, Field(discriminator="type")]
_ADAPTER: TypeAdapter = TypeAdapter(ClientMessage)


def parse_client_message(raw: str) -> AnyClientMessage:
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
