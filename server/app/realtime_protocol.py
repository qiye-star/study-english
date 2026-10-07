"""实时通话协议(计划 R12)。网页端 web/src/features/realtime/protocol.ts 与此逐字对应。

线上 JSON 一律 snake_case。上行二进制 = 16 kHz PCM16LE;下行二进制 = 4 字节大端 turn_id + 24 kHz PCM16LE。
校验严格且有界:超长、类型不符、未知字段/类型一律 ProtocolError(调用方以 4400 关闭)。
"""
import struct
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

CLOSE_NORMAL = 1000
CLOSE_UNAUTHORIZED = 4001
CLOSE_DISABLED = 4003
CLOSE_NOT_FOUND = 4004
CLOSE_IDLE = 4008
CLOSE_MAX_DURATION = 4009
CLOSE_MESSAGE_LIMIT = 4013
CLOSE_BUSY = 4029
CLOSE_PROTOCOL = 4400
CLOSE_UPSTREAM = 4502
CLOSE_REASONS: dict[int, str] = {
    CLOSE_NORMAL: "normal", CLOSE_UNAUTHORIZED: "unauthorized", CLOSE_DISABLED: "disabled",
    CLOSE_NOT_FOUND: "not_found", CLOSE_IDLE: "idle_timeout", CLOSE_MAX_DURATION: "max_duration",
    CLOSE_MESSAGE_LIMIT: "message_limit", CLOSE_BUSY: "busy", CLOSE_PROTOCOL: "protocol", CLOSE_UPSTREAM: "upstream",
}
MAX_UPLINK_FRAME = 32_000
MAX_SYSTEM_PROMPT = 8000
MAX_CLIENT_TEXT = 16_384


class ProtocolError(Exception):
    pass


class _Msg(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class StartMsg(_Msg):
    type: Literal["start"]
    system_prompt: str = Field("", max_length=MAX_SYSTEM_PROMPT)
    model: str = Field("", max_length=200)
    temperature: float = Field(0.7, ge=0, le=2)
    voice: str = Field(pattern=r"^[A-Za-z0-9_-]{3,100}$")
    language: str = Field("en", pattern=r"^[a-z]{2}(-[A-Za-z]{2})?$")
    save_recordings: bool = False


class UtteranceEndMsg(_Msg):
    type: Literal["utterance_end"]


class UtteranceCancelMsg(_Msg):
    """撤回进行中的一句(网页端切到按住说话、按得太短):丢弃已收到的音频,不识别、不回复。"""
    type: Literal["utterance_cancel"]


class InterruptMsg(_Msg):
    type: Literal["interrupt"]


class HangupMsg(_Msg):
    type: Literal["hangup"]


ClientMessage = Annotated[
    Union[StartMsg, UtteranceEndMsg, UtteranceCancelMsg, InterruptMsg, HangupMsg], Field(discriminator="type")
]
_ADAPTER: TypeAdapter = TypeAdapter(ClientMessage)


def parse_client_message(text: str) -> StartMsg | UtteranceEndMsg | UtteranceCancelMsg | InterruptMsg | HangupMsg:
    if not isinstance(text, str):
        raise ProtocolError("expected a text message")
    if len(text) > MAX_CLIENT_TEXT:
        raise ProtocolError("message too large")
    try:
        return _ADAPTER.validate_json(text)
    except (ValidationError, ValueError, RecursionError):
        # 不带原因与输入:消息里可能有用户提示词
        raise ProtocolError("invalid message") from None


def check_uplink(data: bytes) -> None:
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise ProtocolError("invalid audio frame")
    if not data or len(data) > MAX_UPLINK_FRAME or len(data) % 2:
        raise ProtocolError("invalid audio frame")


def audio_frame(turn_id: int, pcm: bytes) -> bytes:
    if type(turn_id) is not int or not 0 <= turn_id <= 0xFFFFFFFF:
        raise ValueError("turn_id must be an unsigned 32-bit integer")
    if len(pcm) % 2:
        raise ValueError("pcm must be 16-bit aligned")
    return struct.pack(">I", turn_id) + bytes(pcm)
