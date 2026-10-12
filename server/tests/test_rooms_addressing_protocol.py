"""say.to, voice_unclear and the persona-id shape (plan addressing-server R1; spec addressing §3.4)."""
import json
import re
from pathlib import Path

import pytest

from app.rooms import protocol
from app.rooms.protocol import MAX_ID, NOTICE_CODES, PROTOCOL_VERSION, ProtocolError, event, parse_client_message
from app.rooms.rules import is_persona_id


def say(**extra) -> str:
    return json.dumps({"type": "say", "client_id": "c", "text": "hi", **extra})


def test_say_to_is_an_optional_string_id_and_the_frame_stays_strict():
    assert parse_client_message(say()).to is None
    assert parse_client_message(say(to=None)).to is None
    assert parse_client_message(say(to="builtin:coach")).to == "builtin:coach"
    msg = parse_client_message(say(reply_to=3, to="builtin:coach"))
    assert (msg.reply_to, msg.to) == (3, "builtin:coach")
    for bad in (5, ["x"], True, "x" * (MAX_ID + 1)):
        with pytest.raises(ProtocolError):
            parse_client_message(say(to=bad))
    with pytest.raises(ProtocolError):
        parse_client_message(say(extra="x"))  # unknown fields are still refused


def test_voice_unclear_is_appended_after_agent_off_and_the_version_is_unchanged():
    assert NOTICE_CODES[-2:] == ("agent_off", "voice_unclear") and PROTOCOL_VERSION == 2
    assert event("notice", code="voice_unclear") == {"type": "notice", "code": "voice_unclear"}


def test_the_web_mirror_reads_the_field_with_exactly_this_spelling():
    src = Path(protocol.__file__).read_text(encoding="utf-8")
    say_class = src[src.index("class SayMsg"):src.index("class AssistMsg")]
    assert re.search(r"\n\s+to: str \| None", say_class)  # web/src/features/rooms/protocol.test.ts (Cross-plan S-1)


@pytest.mark.parametrize("value,ok", [
    ("builtin:coach", True), ("builtin:a", True), ("0b6c1f3e-2a4d-4c5e-9f00-1234567890ab", True),
    ("builtin:Coach", False), ("builtin:", False), ("builtin:coach\n", False), (" builtin:coach", False),
    ("0B6C1F3E-2A4D-4C5E-9F00-1234567890AB", False), ("../etc", False), ("", False), (None, False), (5, False),
    ("builtin:" + "a" * 33, False),
])
def test_is_persona_id_checks_the_shape_only(value, ok):
    assert is_persona_id(value) is ok
